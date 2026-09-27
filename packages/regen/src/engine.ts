import {
  DATUM_PLANES,
  evalLength,
  isDatumPlaneName,
  type ExtrudeFeature,
  type FilletFeature,
  type Id,
  type PartDoc,
  type PlaneFrame,
  type Ref,
  type SketchFeature,
} from '@3db/model';
import { findProfiles, type ProfileResult, type SketchSolver, type SketchStatus, type SolvedSketch } from '@3db/sketch';
import { KernelError, type Kernel, type ShapeId, type Topology } from '@3db/kernel';
import { nameElements, resolveRef, type Candidate, type ElementNames } from '@3db/naming';

export type FeatureStatus = 'ok' | 'error' | 'suppressed' | 'rolledBack';

export interface Unresolved {
  ref: Ref;
  reason: 'missing' | 'ambiguous';
  candidates: Candidate[];
}

export interface FeatureResult {
  id: Id;
  status: FeatureStatus;
  message?: string;
  sketch?: { status: SketchStatus; dof: number; conflicting: Id[]; redundant: Id[]; problems: string[] };
  unresolved?: Unresolved[];
  ms: number;
}

/** A body plus its persistent names — the state that flows forward through the history. */
export interface BodyState {
  shape: ShapeId;
  topology: Topology;
  names: ElementNames;
  /** Feature that produced this state. */
  by: Id;
}

export interface RebuildResult {
  features: FeatureResult[];
  body: BodyState | null;
  sketches: Map<Id, { frame: PlaneFrame; solved: SolvedSketch; profiles: ProfileResult }>;
  totalMs: number;
}

export interface RebuildOptions {
  /** Evaluate only features [0, until) — edit sessions look at the model before the edited feature. */
  until?: number;
}

class FeatureError extends Error {
  constructor(
    message: string,
    readonly unresolved?: Unresolved[],
  ) {
    super(message);
  }
}

/**
 * Deterministic rebuild (B3.1): the result is a pure function of the document.
 * A failing feature is skipped and reported; later features keep evaluating (B3.3).
 */
export class Regenerator {
  private owned: ShapeId[] = [];

  constructor(
    private readonly kernel: Kernel,
    private readonly solver: SketchSolver,
  ) {}

  /** Releases the shapes of the previous result; call before discarding the regenerator. */
  dispose(): void {
    for (const id of this.owned.splice(0)) this.kernel.release(id);
  }

  rebuild(doc: PartDoc, options: RebuildOptions = {}): RebuildResult {
    this.dispose();
    const t0 = performance.now();
    const limit = Math.min(options.until ?? doc.features.length, doc.rollbackIndex ?? doc.features.length);
    const sketches: RebuildResult['sketches'] = new Map();
    const results: FeatureResult[] = [];
    let body: BodyState | null = null;

    doc.features.forEach((feature, index) => {
      const t = performance.now();
      const done = (r: Omit<FeatureResult, 'id' | 'ms'>) => results.push({ id: feature.id, ms: performance.now() - t, ...r });
      if (index >= limit) return done({ status: 'rolledBack' });
      if (feature.suppressed) return done({ status: 'suppressed' });
      try {
        switch (feature.type) {
          case 'sketch': {
            const s = this.sketch(feature);
            const info = { status: s.solved.status, dof: s.solved.dof, conflicting: s.solved.conflicting, redundant: s.solved.redundant, problems: s.profiles.problems };
            if (s.solved.status === 'failed' || s.solved.status === 'over') {
              return done({ status: 'error', message: s.solved.status === 'over' ? '草圖過多定義' : (s.solved.message ?? '草圖無法求解'), sketch: info });
            }
            sketches.set(feature.id, s);
            return done({ status: 'ok', sketch: info });
          }
          case 'extrude': {
            const next = this.extrude(feature, sketches, body);
            this.replace(body, next);
            body = next;
            return done({ status: 'ok' });
          }
          case 'fillet': {
            const next = this.fillet(feature, body);
            this.replace(body, next);
            body = next;
            return done({ status: 'ok' });
          }
        }
      } catch (e) {
        if (e instanceof FeatureError) return done({ status: 'error', message: e.message, ...(e.unresolved ? { unresolved: e.unresolved } : {}) });
        if (e instanceof KernelError) return done({ status: 'error', message: e.message });
        return done({ status: 'error', message: `內部錯誤：${e instanceof Error ? e.message : String(e)}` });
      }
    });

    if (body) this.owned.push((body as BodyState).shape);
    return { features: results, body, sketches, totalMs: performance.now() - t0 };
  }

  /** Intermediate bodies are released as soon as the next state replaces them. */
  private replace(prev: BodyState | null, next: BodyState): void {
    if (prev && prev.shape !== next.shape) this.kernel.release(prev.shape);
  }

  private sketch(f: SketchFeature) {
    if (f.plane.kind !== 'datum' || !isDatumPlaneName(f.plane.name)) {
      throw new FeatureError('Phase 0 只支援在前/上/右基準面上繪製草圖');
    }
    const frame = DATUM_PLANES[f.plane.name];
    const solved = this.solver.solve(f);
    const profiles = solved.status === 'failed' ? { regions: [], problems: [] } : findProfiles(f, solved);
    return { frame, solved, profiles };
  }

  private extrude(f: ExtrudeFeature, sketches: RebuildResult['sketches'], body: BodyState | null): BodyState {
    const s = sketches.get(f.sketch);
    if (!s) throw new FeatureError('父草圖不存在、已抑制或失敗');
    if (s.profiles.problems.length > 0) throw new FeatureError(`草圖不能用於特徵：${s.profiles.problems.join('；')}`);
    if (s.profiles.regions.length === 0) throw new FeatureError('草圖沒有封閉輪廓');
    if (f.op === 'cut') throw new FeatureError('伸長除料排在 Phase 1（布林運算）');
    if (body) throw new FeatureError('合併到既有本體排在 Phase 1（布林運算）');
    if (f.dir2) throw new FeatureError('方向 2 排在 Phase 1');
    const n = s.frame.normal;
    let vector: [number, number, number];
    let offset = 0;
    switch (f.dir1.type) {
      case 'blind': {
        const d = evalLength(f.dir1.depth) * (f.dir1.reverse ? -1 : 1);
        vector = [n[0] * d, n[1] * d, n[2] * d];
        break;
      }
      case 'midPlane': {
        const d = evalLength(f.dir1.depth);
        vector = [n[0] * d, n[1] * d, n[2] * d];
        offset = -d / 2;
        break;
      }
      default:
        throw new FeatureError('此終止型態排在 Phase 1');
    }
    const r = this.kernel.extrude(s.frame, s.profiles.regions, vector, offset);
    const topology = this.kernel.topology(r.shape);
    return { shape: r.shape, topology, names: nameElements(r.faceOrigins, topology, { featureId: f.id, sketchId: f.sketch }), by: f.id };
  }

  private fillet(f: FilletFeature, body: BodyState | null): BodyState {
    if (!body) throw new FeatureError('圓角之前沒有本體');
    if (f.edges.length === 0) throw new FeatureError('尚未選擇邊線');
    const indices: number[] = [];
    const unresolved: Unresolved[] = [];
    for (const ref of f.edges) {
      const r = resolveRef(ref, body.names, body.topology);
      if (r.ok) indices.push(r.index);
      else unresolved.push({ ref, reason: r.reason, candidates: r.candidates });
    }
    if (unresolved.length > 0) {
      throw new FeatureError(`遺失參考：${unresolved.length} 條邊線找不到，請重新選擇`, unresolved);
    }
    const r = this.kernel.fillet(body.shape, [...new Set(indices)], evalLength(f.radius));
    const topology = this.kernel.topology(r.shape);
    return {
      shape: r.shape,
      topology,
      names: nameElements(r.faceOrigins, topology, { featureId: f.id, role: 'fillet', input: body.names }),
      by: f.id,
    };
  }
}
