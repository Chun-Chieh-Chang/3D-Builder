import {
  DATUM_PLANES,
  evalAngle,
  evalLength,
  isDatumPlaneName,
  planeFrame,
  type ChamferFeature,
  type ExtrudeFeature,
  type FilletFeature,
  type Id,
  type PartDoc,
  type PlaneFrame,
  type Ref,
  type RefPlaneFeature,
  type RevolveFeature,
  type SketchFeature,
  type Vec3,
} from '@3db/model';
import { findProfiles, type ProfileResult, type SketchSolver, type SketchStatus, type SolvedSketch } from '@3db/sketch';
import { KernelError, type Kernel, type OpResult, type ShapeId, type Topology } from '@3db/kernel';
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
  /** The feature rebuilt, but something deserves a look (D1.6), e.g. a reference found by its geometry. */
  warnings?: string[];
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
  /**
   * Plane of every sketch that could be placed, including the sketch right at the `until` limit
   * (the one being edited), whose plane may be a face of the model before it; and of every
   * reference plane that was built.
   */
  frames: Map<Id, PlaneFrame>;
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

const add = (a: Vec3, b: Vec3, s = 1): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Rotates v about the unit axis k by angle t (Rodrigues). */
function rotate(v: Vec3, k: Vec3, t: number): Vec3 {
  const c = Math.cos(t);
  const s = Math.sin(t);
  const kxv = cross(k, v);
  const kv = dot(k, v);
  return [v[0] * c + kxv[0] * s + k[0] * kv * (1 - c), v[1] * c + kxv[1] * s + k[1] * kv * (1 - c), v[2] * c + kxv[2] * s + k[2] * kv * (1 - c)];
}

const concatNames = (a: ElementNames, b: ElementNames): ElementNames => ({
  faces: [...a.faces, ...b.faces],
  edges: [...a.edges, ...b.edges],
  vertices: [...a.vertices, ...b.vertices],
});

/**
 * Deterministic rebuild (B3.1): the result is a pure function of the document.
 * A failing feature is skipped and reported; later features keep evaluating (B3.3).
 */
export class Regenerator {
  private owned: ShapeId[] = [];
  /** Warnings of the feature being evaluated. */
  private warnings: string[] = [];
  /** Reference planes built so far in this rebuild (C3.2). */
  private planes = new Map<Id, PlaneFrame>();

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
    const frames: RebuildResult['frames'] = new Map();
    const results: FeatureResult[] = [];
    let body: BodyState | null = null;
    this.planes = new Map();

    doc.features.forEach((feature, index) => {
      const t = performance.now();
      this.warnings = [];
      const done = (r: Omit<FeatureResult, 'id' | 'ms'>) =>
        results.push({ id: feature.id, ms: performance.now() - t, ...r, ...(this.warnings.length > 0 ? { warnings: this.warnings } : {}) });
      if (index >= limit) {
        if (index === limit && feature.type === 'sketch') {
          try {
            frames.set(feature.id, this.frame(feature, body));
          } catch {
            // the edited sketch's plane is gone: the sketch reports it once it is evaluated
          }
        }
        return done({ status: 'rolledBack' });
      }
      if (feature.suppressed) return done({ status: 'suppressed' });
      try {
        switch (feature.type) {
          case 'sketch': {
            const s = this.sketch(feature, body);
            frames.set(feature.id, s.frame);
            const info = { status: s.solved.status, dof: s.solved.dof, conflicting: s.solved.conflicting, redundant: s.solved.redundant, problems: s.profiles.problems };
            if (s.solved.status === 'failed' || s.solved.status === 'over') {
              return done({ status: 'error', message: s.solved.status === 'over' ? '草圖過多定義' : (s.solved.message ?? '草圖無法求解'), sketch: info });
            }
            sketches.set(feature.id, s);
            return done({ status: 'ok', sketch: info });
          }
          case 'refPlane': {
            const frame = this.refPlane(feature, body);
            this.planes.set(feature.id, frame);
            frames.set(feature.id, frame);
            return done({ status: 'ok' });
          }
          case 'extrude':
          case 'revolve':
          case 'fillet':
          case 'chamfer': {
            const next =
              feature.type === 'extrude'
                ? this.extrude(feature, sketches, body)
                : feature.type === 'revolve'
                  ? this.revolve(feature, sketches, body)
                  : feature.type === 'fillet'
                    ? this.fillet(feature, body)
                    : this.chamfer(feature, body);
            if (body && body.shape !== next.shape) this.kernel.release(body.shape);
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
    return { features: results, body, sketches, frames, totalMs: performance.now() - t0 };
  }

  private resolve(ref: Ref, body: BodyState, what: string): number {
    // An empty reference is a selection box not filled in yet, not a lost reference.
    if (!ref.name) throw new FeatureError(`請選擇${what}`);
    const r = resolveRef(ref, body.names, body.topology);
    if (!r.ok) throw new FeatureError(`遺失參考：${what}找不到，請重新選擇`, [{ ref, reason: r.reason, candidates: r.candidates }]);
    this.noteFingerprint(r.via, what, body.names[ref.kind === 'edge' ? 'edges' : ref.kind === 'vertex' ? 'vertices' : 'faces'][r.index]!);
    return r.index;
  }

  /** A reference that only its geometry could pick out is a guess the user should confirm (never silent). */
  private noteFingerprint(via: string, what: string, found: string): void {
    if (via === 'fingerprint') this.warnings.push(`${what}依幾何指紋找到「${found}」（同名的有好幾個），請確認位置正確`);
  }

  // ------------------------------------------------------------------ sketches (C1.1)

  /**
   * A plane reference: a default plane, a reference plane built earlier in this rebuild, or a planar
   * face of the model so far.
   */
  private planeOf(ref: Ref, body: BodyState | null, labels: { what: string; notPlanar: string }): PlaneFrame {
    if (ref.kind === 'datum') {
      if (isDatumPlaneName(ref.name)) return DATUM_PLANES[ref.name];
      const plane = this.planes.get(ref.name);
      if (!plane) throw new FeatureError(`${labels.what}：參考的基準面不存在、已抑制或失敗`);
      return plane;
    }
    if (ref.kind !== 'face') throw new FeatureError('必須選擇基準面或平面');
    if (!body) throw new FeatureError(`${labels.what}不存在：它之前沒有本體`);
    const face = body.topology.faces[this.resolve(ref, body, labels.what)]!;
    if (face.surface !== 'plane' || !face.normal) throw new FeatureError(labels.notPlanar);
    return planeFrame(face.center, face.normal);
  }

  /** Where a sketch lies (C1.1): a default plane, a reference plane, or a planar face of the model before it. */
  private frame(f: SketchFeature, body: BodyState | null): PlaneFrame {
    return this.planeOf(f.plane, body, { what: '草圖所在的面', notPlanar: '草圖只能放在平面上' });
  }

  /**
   * Reference plane (C3.2): offset from a plane; through a straight edge at an angle to a plane
   * (at 0° parallel to it); or through three vertices. The frame follows the planeFrame rules, so a
   * sketch on it gets the same axes the same plane would get anywhere else.
   */
  private refPlane(f: RefPlaneFeature, body: BodyState | null): PlaneFrame {
    const d = f.def;
    const sign = d.reverse ? -1 : 1;
    const labels = { what: '參考面', notPlanar: '參考面必須是平面' };
    switch (d.mode) {
      case 'offset': {
        const base = this.planeOf(d.plane, body, labels);
        return { ...base, origin: add(base.origin, base.normal, evalLength(d.distance) * sign) };
      }
      case 'angle': {
        const base = this.planeOf(d.plane, body, labels);
        if (!body) throw new FeatureError('旋轉軸不存在：它之前沒有本體');
        const edge = body.topology.edges[this.resolve(d.axis, body, '旋轉軸')]!;
        if (edge.curve !== 'line' || !edge.dir) throw new FeatureError('旋轉軸必須是直線邊線');
        const k = unit(edge.dir);
        // The part of the plane's normal across the axis, turned about the axis.
        const across = sub(base.normal, add([0, 0, 0], k, dot(base.normal, k)));
        if (Math.hypot(...across) < 1e-9) throw new FeatureError('旋轉軸不能垂直於參考面');
        return planeFrame(edge.mid, rotate(unit(across), k, evalAngle(d.angle) * sign));
      }
      case 'threePoint': {
        if (d.points.length < 3) throw new FeatureError('三點基準面需要三個頂點');
        if (!body) throw new FeatureError('頂點不存在：它之前沒有本體');
        const [a, b, c] = d.points.map((ref, i) => body.topology.vertices[this.resolve(ref, body, `第 ${i + 1} 點`)]!.point) as [Vec3, Vec3, Vec3];
        const normal = cross(sub(b, a), sub(c, a));
        const size = Math.max(Math.hypot(...sub(b, a)), Math.hypot(...sub(c, a)), 1e-9);
        if (Math.hypot(...normal) < 1e-9 * size * size) throw new FeatureError('三點共線，無法決定平面');
        const n = unit(normal);
        return planeFrame(a, [n[0] * sign, n[1] * sign, n[2] * sign]);
      }
    }
  }

  private sketch(f: SketchFeature, body: BodyState | null) {
    const frame = this.frame(f, body);
    const solved = this.solver.solve(f);
    const profiles = solved.status === 'failed' ? { regions: [], problems: [] } : findProfiles(f, solved);
    return { frame, solved, profiles };
  }

  private profileOf(sketches: RebuildResult['sketches'], sketchId: Id) {
    const s = sketches.get(sketchId);
    if (!s) throw new FeatureError('父草圖不存在、已抑制或失敗');
    if (s.profiles.problems.length > 0) throw new FeatureError(`草圖不能用於特徵：${s.profiles.problems.join('；')}`);
    if (s.profiles.regions.length === 0) throw new FeatureError('草圖沒有封閉輪廓');
    return s;
  }

  // ------------------------------------------------------------------ extrude and revolve (C4.1–C4.3)

  /** How far along `dir` from `origin` the body reaches (0 when it lies entirely behind). */
  private reach(body: BodyState, origin: Vec3, dir: Vec3): number {
    const { min, max } = this.kernel.bounds(body.shape);
    let far = 0;
    for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) far = Math.max(far, dot(sub([x, y, z], origin), dir));
    return far;
  }

  private extrude(f: ExtrudeFeature, sketches: RebuildResult['sketches'], body: BodyState | null): BodyState {
    const s = this.profileOf(sketches, f.sketch);
    if (f.dir2) throw new FeatureError('方向 2 排在後續階段（P1）');
    if (f.op === 'cut' && !body) throw new FeatureError('除料需要既有的本體');
    const n = s.frame.normal;
    const d = f.dir1;
    // A boss grows along the sketch normal, a cut goes into the material (SolidWorks defaults).
    const sign = (f.op === 'cut' ? -1 : 1) * ('reverse' in d && d.reverse ? -1 : 1);
    const dir: Vec3 = [n[0] * sign, n[1] * sign, n[2] * sign];
    let tool: OpResult;
    switch (d.type) {
      case 'blind':
        tool = this.kernel.extrude(s.frame, s.profiles.regions, add([0, 0, 0], dir, evalLength(d.depth)));
        break;
      case 'midPlane': {
        const depth = evalLength(d.depth);
        tool = this.kernel.extrude(s.frame, s.profiles.regions, add([0, 0, 0], n, depth), -depth / 2);
        break;
      }
      case 'throughAll':
      case 'upToFace': {
        if (!body) throw new FeatureError(d.type === 'throughAll' ? '完全貫穿需要既有的本體' : '成形至某一面需要既有的本體');
        const length = this.reach(body, s.frame.origin, dir);
        if (length <= 1e-9) throw new FeatureError('這個方向上沒有本體（試試反轉方向）');
        const vector = add([0, 0, 0], dir, length * 1.01 + 1);
        tool =
          d.type === 'throughAll'
            ? this.kernel.extrude(s.frame, s.profiles.regions, vector)
            : this.kernel.extrude(s.frame, s.profiles.regions, vector, 0, { target: body.shape, face: this.resolve(d.face, body, '終止面') });
        break;
      }
    }
    return this.combine(f.id, f.op, tool, { featureId: f.id, sketchId: f.sketch }, body);
  }

  private revolve(f: RevolveFeature, sketches: RebuildResult['sketches'], body: BodyState | null): BodyState {
    const s = this.profileOf(sketches, f.sketch);
    if (f.op === 'cut' && !body) throw new FeatureError('除料需要既有的本體');
    const axis = s.solved.geometry.get(f.axis);
    if (axis?.type !== 'line') throw new FeatureError('旋轉軸不存在，請重新選擇');
    const [a, b] = [axis.a, axis.b];
    const side = (p: [number, number]) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const pts = s.profiles.regions.flatMap((r) => r.outer.flatMap((seg) => (seg.kind === 'line' ? [seg.a, seg.b] : seg.kind === 'arc' ? [seg.from, seg.to, seg.c] : [seg.c])));
    const scale = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    if (pts.some((p) => side(p) > 1e-9 * scale) && pts.some((p) => side(p) < -1e-9 * scale)) throw new FeatureError('輪廓跨過旋轉軸');

    const fr = s.frame;
    const at = (p: [number, number]): Vec3 => add(add(fr.origin, fr.xDir, p[0]), fr.yDir, p[1]);
    let k = unit(sub(at(b), at(a)));
    const origin = at(a);
    const d = f.dir1;
    const angle = evalAngle(d.angle);
    if (d.type === 'blind' && d.reverse) k = [-k[0], -k[1], -k[2]];
    // Two-sided: start half the angle back by turning the sketch plane about the axis first.
    const turn = d.type === 'midPlane' ? -angle / 2 : 0;
    const frame: PlaneFrame = {
      origin: add(origin, rotate(sub(fr.origin, origin), k, turn)),
      xDir: rotate(fr.xDir, k, turn),
      yDir: rotate(fr.yDir, k, turn),
      normal: rotate(fr.normal, k, turn),
    };
    const tool = this.kernel.revolve(frame, s.profiles.regions, { origin, dir: k }, angle);
    return this.combine(f.id, f.op, tool, { featureId: f.id, sketchId: f.sketch }, body);
  }

  /**
   * Names a new tool body by how it was swept, then adds it to (boss) or removes it from (cut) the
   * body so far. Faces of the result inherit the names of the faces they came from, on either side.
   */
  private combine(featureId: Id, op: 'boss' | 'cut', tool: OpResult, context: { featureId: Id; sketchId: Id }, body: BodyState | null): BodyState {
    const toolTopology = this.kernel.topology(tool.shape);
    const toolNames = nameElements(tool.faceOrigins, toolTopology, context);
    if (!body) return { shape: tool.shape, topology: toolTopology, names: toolNames, by: featureId };
    let r: OpResult;
    try {
      r = this.kernel.boolean(op === 'boss' ? 'fuse' : 'cut', body.shape, tool.shape);
    } finally {
      this.kernel.release(tool.shape);
    }
    if (op === 'cut') {
      const before = this.kernel.massProps(body.shape).volume;
      const after = this.kernel.massProps(r.shape).volume;
      if (after <= 1e-9 * before) {
        this.kernel.release(r.shape);
        throw new FeatureError('除料移除了整個本體');
      }
      if (Math.abs(before - after) <= 1e-9 * before) {
        this.kernel.release(r.shape);
        throw new FeatureError('除料沒有移除任何材料（試試反轉方向）');
      }
    }
    const topology = this.kernel.topology(r.shape);
    return { shape: r.shape, topology, names: nameElements(r.faceOrigins, topology, { featureId, input: concatNames(body.names, toolNames) }), by: featureId };
  }

  // ------------------------------------------------------------------ fillet and chamfer (C5.1, C5.3)

  private edgeIndices(refs: Ref[], body: BodyState): number[] {
    if (refs.length === 0) throw new FeatureError('尚未選擇邊線');
    const indices: number[] = [];
    const unresolved: Unresolved[] = [];
    for (const ref of refs) {
      const r = resolveRef(ref, body.names, body.topology);
      if (r.ok) {
        indices.push(r.index);
        this.noteFingerprint(r.via, '邊線', body.names.edges[r.index]!);
      } else unresolved.push({ ref, reason: r.reason, candidates: r.candidates });
    }
    if (unresolved.length > 0) throw new FeatureError(`遺失參考：${unresolved.length} 條邊線找不到，請重新選擇`, unresolved);
    return [...new Set(indices)];
  }

  private fillet(f: FilletFeature, body: BodyState | null): BodyState {
    if (!body) throw new FeatureError('圓角之前沒有本體');
    const r = this.kernel.fillet(body.shape, this.edgeIndices(f.edges, body), evalLength(f.radius));
    const topology = this.kernel.topology(r.shape);
    return { shape: r.shape, topology, names: nameElements(r.faceOrigins, topology, { featureId: f.id, role: 'fillet', input: body.names }), by: f.id };
  }

  private chamfer(f: ChamferFeature, body: BodyState | null): BodyState {
    if (!body) throw new FeatureError('導角之前沒有本體');
    const specs = this.edgeIndices(f.edges, body).map((edge) => {
      // The first distance is measured on the adjacent face whose persistent name sorts first
      // (the other one with 「反轉方向」): a choice that survives rebuilds, unlike face order.
      const faces = [...body.topology.edges[edge]!.faces].sort((a, b) => (body.names.faces[a]! < body.names.faces[b]! ? -1 : 1));
      const face = faces[f.flip ? faces.length - 1 : 0];
      if (face === undefined) throw new FeatureError('這條邊線沒有相鄰的面');
      return { edge, face };
    });
    const second = f.mode === 'distanceDistance' ? evalLength(f.second) : evalAngle(f.second);
    const r = this.kernel.chamfer(body.shape, specs, f.mode, evalLength(f.distance), second);
    const topology = this.kernel.topology(r.shape);
    return { shape: r.shape, topology, names: nameElements(r.faceOrigins, topology, { featureId: f.id, role: 'chamfer', input: body.names }), by: f.id };
  }
}
