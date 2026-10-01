import { t } from '@3db/i18n';
import {
  DATUM_PLANES,
  evalAngle,
  evalLength,
  isDatumPlaneName,
  planeFrame,
  resolveDoc,
  bodyFeature,
  type ChamferFeature,
  type CombineFeature,
  type DeleteFaceFeature,
  type DraftFeature,
  type Draft,
  type EndCondition,
  type ExtrudeFeature,
  type Feature,
  type FilletFeature,
  type Id,
  type ImportedBodyFeature,
  type MoveFaceFeature,
  type PartDoc,
  type PlaneFrame,
  type Ref,
  type RefPlaneFeature,
  type RevolveFeature,
  type ShellFeature,
  type SketchFeature,
  type Thin,
  type Vec3,
} from '@3db/model';
import { findProfiles, selectContours, ThinProblem, thinRegions, type ProfileResult, type SketchSolver, type SketchStatus, type SolvedSketch } from '@3db/sketch';
import { KernelError, type SweepSpec, type FaceOrigin, type ImportDiagnostics, type Kernel, type OpResult, type ShapeId, type Topology } from '@3db/kernel';
import { nameElements, nameFromFaces, resolveRef, type Candidate, type ElementNames } from '@3db/naming';
import { Bodies, type BodyState, type BodyView } from './bodies';
import { followReferences, ReferenceProblem } from './references';

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
  /** An imported body: what the file held and what was done to it (F2.2). */
  diagnostics?: ImportDiagnostics;
  ms: number;
}

/** One body of the result (C7.1): where its elements are in the numbering of RebuildResult.body, and what the document says of it. */
export interface BodyInfo {
  id: Id;
  /** The name the document gave it, else the name of the feature that made it (伸長1, 除料1#2). */
  name: string;
  reference: boolean;
  shape: ShapeId;
  face0: number;
  faces: number;
  edge0: number;
  edges: number;
  vertex0: number;
  vertices: number;
}

export interface RebuildResult {
  features: FeatureResult[];
  /** All the bodies seen as one: the body itself when there is one (odies), a view of them all (a compound) when there are several. */
  body: BodyView | null;
  bodies: BodyInfo[];
  sketches: Map<Id, { frame: PlaneFrame; solved: SolvedSketch; profiles: ProfileResult; sketch: SketchFeature }>;
  /**
   * Plane of every sketch that could be placed, including the sketch right at the `until` limit
   * (the one being edited), whose plane may be a face of the model before it; and of every
   * reference plane that was built.
   */
  frames: Map<Id, PlaneFrame>;
  totalMs: number;
}

/** Where imported data comes from, by SHA-256 (the part file's blobs; a Map will do). */
export interface BlobSource {
  get(sha256: string): Uint8Array | undefined;
}

/** A file read once: its solids (or why it could not be read), kept while the document uses it. */
type ImportedShape = { shape: ShapeId; faceOrigins: FaceOrigin[][]; warnings: string[]; diagnostics: ImportDiagnostics } | { error: string };

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

/** The axis of a face that is a surface of revolution: a point on it and its direction. */
function axisOf(face: Topology['faces'][number]): { point: Vec3; dir: Vec3 } | null {
  const g = face.geometry;
  if (g?.type === 'cylinder') return { point: g.origin, dir: g.axis };
  if (g?.type === 'cone') return { point: g.apex, dir: g.axis };
  if (g?.type === 'torus') return { point: g.center, dir: g.axis };
  return null;
}

/**
 * The faces of a hole, from one or more of its faces (「刪除鑽孔」):
 *  - a face joins when every face it touches is already in: the bottom of a blind hole, once its wall is;
 *  - so does the other half of a wall the CAD system split in two (a concave cylinder of the same radius on the same
 *    axis next to a face already in), and so does a cone or torus on that axis next to a face already in: the chamfer
 *    or round at the hole's mouth. Those rims are added, never grown from, so the faces round them stay out.
 * Nothing the rest of the body also uses is taken.
 */
export function holeFaces(topology: Topology, seeds: number[]): number[] {
  const touching = topology.faces.map(() => new Set<number>());
  for (const e of topology.edges) for (const a of e.faces) for (const b of e.faces) if (a !== b) touching[a]!.add(b);
  const inside = new Set(seeds);
  const wall = seeds.map((i) => topology.faces[i]!).filter((f) => f.geometry?.type === 'cylinder' && !f.geometry.convex);
  const onAxis = (g: Topology['faces'][number]): boolean => {
    const a = axisOf(g);
    if (!a) return false;
    return wall.some((w) => {
      const b = axisOf(w)!;
      const off = sub(a.point, b.point);
      const along = dot(off, b.dir);
      const away = Math.hypot(off[0] - b.dir[0] * along, off[1] - b.dir[1] * along, off[2] - b.dir[2] * along);
      return Math.abs(dot(a.dir, b.dir)) > 1 - 1e-9 && away < 1e-6 * Math.max(1, Math.hypot(...off));
    });
  };
  const sameRadius = (g: Topology['faces'][number]) => wall.some((w) => g.geometry?.type === 'cylinder' && !g.geometry.convex && Math.abs(g.geometry.radius - (w.geometry as { radius: number }).radius) < 1e-9);
  for (let grew = true; grew; ) {
    grew = false;
    for (const f of [...inside]) {
      for (const g of touching[f]!) {
        if (inside.has(g)) continue;
        const face = topology.faces[g]!;
        const enclosed = [...touching[g]!].every((h) => inside.has(h));
        const half = wall.length > 0 && sameRadius(face) && onAxis(face);
        if (enclosed || half) {
          inside.add(g);
          grew = true;
        }
      }
    }
  }
  // the rims: added once, after the wall is whole, and not grown from
  for (const f of [...inside]) {
    for (const g of touching[f]!) {
      const type = topology.faces[g]!.geometry?.type;
      if (!inside.has(g) && (type === 'cone' || type === 'torus') && onAxis(topology.faces[g]!)) inside.add(g);
    }
  }
  return [...inside];
}

/** Rotates v about the unit axis k by angle t (Rodrigues). */
function rotate(v: Vec3, k: Vec3, t: number): Vec3 {
  const c = Math.cos(t);
  const s = Math.sin(t);
  const kxv = cross(k, v);
  const kv = dot(k, v);
  return [v[0] * c + kxv[0] * s + k[0] * kv * (1 - c), v[1] * c + kxv[1] * s + k[1] * kv * (1 - c), v[2] * c + kxv[2] * s + k[2] * kv * (1 - c)];
}

/** Where an imported file is kept: its bytes and the tolerance its surfaces were sewn with decide what comes out. */
const importKey = (sha256: string, sewTolerance: string | undefined): string => {
  let tolerance = '';
  if (sewTolerance !== undefined) {
    try {
      tolerance = String(evalLength(sewTolerance));
    } catch {
      tolerance = sewTolerance; // reported by the feature itself
    }
  }
  return `${sha256}|${tolerance}`;
};

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
  /** What reading the file of the imported body being evaluated turned up (F2.2). */
  private diagnostics: ImportDiagnostics | null = null;
  /** Reference planes built so far in this rebuild (C3.2). */
  private planes = new Map<Id, PlaneFrame>();
  /** The imported files read so far in this rebuild: a second read of one gets a copy of its own. */
  private usedImports = new Set<string>();
  /**
   * Imported files by SHA-256. Reading a STEP file is slow and depends on nothing but its bytes, so
   * each one is read once and kept across rebuilds — a cache of derived data, not a second truth.
   */
  private imports = new Map<string, ImportedShape>();

  constructor(
    private readonly kernel: Kernel,
    private readonly solver: SketchSolver,
    private readonly blobs: BlobSource = new Map(),
  ) {}

  /** Releases every shape the regenerator holds; call before discarding it. */
  dispose(): void {
    this.releaseResult();
    for (const i of this.imports.values()) if ('shape' in i) this.kernel.release(i.shape);
    this.imports.clear();
  }

  /** The previous result's shapes: every rebuild starts by releasing them. */
  private releaseResult(): void {
    for (const id of this.owned.splice(0)) this.kernel.release(id);
  }

  rebuild(doc: PartDoc, options: RebuildOptions = {}): RebuildResult {
    this.releaseResult();
    const t0 = performance.now();
    const limit = Math.min(options.until ?? doc.features.length, doc.rollbackIndex ?? doc.features.length);
    const sketches: RebuildResult['sketches'] = new Map();
    const frames: RebuildResult['frames'] = new Map();
    const results: FeatureResult[] = [];
    let set = new Bodies([], this.kernel);
    this.planes = new Map();

    // Every expression becomes the number it stands for before anything is built: the solver and the kernel
    // only ever see numbers. A feature whose expression cannot be evaluated reports why instead of building.
    const { doc: resolved, problems } = resolveDoc(doc);
    // Files the document no longer imports (or no longer with these options) are let go.
    const wanted = new Set(resolved.features.flatMap((f) => (f.type === 'importedBody' ? resolved.blobs.filter((b) => b.id === f.blob).map((b) => importKey(b.sha256, f.sewTolerance)) : [])));
    for (const [key, i] of this.imports) {
      if (wanted.has(key)) continue;
      if ('shape' in i) this.kernel.release(i.shape);
      this.imports.delete(key);
    }
    this.usedImports = new Set();
    resolved.features.forEach((feature, index) => {
      const t = performance.now();
      this.warnings = [];
      this.diagnostics = null;
      const done = (r: Omit<FeatureResult, 'id' | 'ms'>) =>
        results.push({ id: feature.id, ms: performance.now() - t, ...r, ...(this.warnings.length > 0 ? { warnings: this.warnings } : {}), ...(this.diagnostics ? { diagnostics: this.diagnostics } : {}) });
      if (index >= limit) {
        if (index === limit && feature.type === 'sketch') {
          try {
            frames.set(feature.id, this.frame(feature, set));
          } catch {
            // the edited sketch's plane is gone: the sketch reports it once it is evaluated
          }
        }
        return done({ status: 'rolledBack' });
      }
      if (feature.suppressed) return done({ status: 'suppressed' });
      const problem = problems.get(feature.id);
      if (problem) return done({ status: 'error', message: problem });
      try {
        switch (feature.type) {
          case 'sketch': {
            const s = this.sketch(feature, set);
            frames.set(feature.id, s.frame);
            const info = { status: s.solved.status, dof: s.solved.dof, conflicting: s.solved.conflicting, redundant: s.solved.redundant, problems: s.profiles.problems };
            if (s.solved.status === 'failed' || s.solved.status === 'over') {
              return done({ status: 'error', message: s.solved.status === 'over' ? '草圖過多定義' : (s.solved.message ?? '草圖無法求解'), sketch: info });
            }
            sketches.set(feature.id, s);
            return done({ status: 'ok', sketch: info });
          }
          case 'refPlane': {
            const frame = this.refPlane(feature, set);
            this.planes.set(feature.id, frame);
            frames.set(feature.id, frame);
            return done({ status: 'ok' });
          }
          case 'extrude':
          case 'revolve':
          case 'fillet':
          case 'chamfer':
          case 'shell':
          case 'draft':
          case 'deleteFace':
          case 'moveFace':
          case 'combine':
          case 'importedBody': {
            const next =
              feature.type === 'extrude'
                ? this.extrude(feature, sketches, set)
                : feature.type === 'revolve'
                  ? this.revolve(feature, sketches, set)
                  : feature.type === 'fillet'
                    ? this.fillet(feature, set)
                    : feature.type === 'chamfer'
                      ? this.chamfer(feature, set)
                      : feature.type === 'draft'
                        ? this.draftFeature(feature, set)
                      : feature.type === 'shell'
                        ? this.shell(feature, set)
                        : feature.type === 'deleteFace'
                        ? this.deleteFace(feature, set)
                        : feature.type === 'moveFace'
                          ? this.moveFace(feature, set)
                          : feature.type === 'combine'
                            ? this.combineBodies(feature, set)
                            : this.importedBody(feature, doc, set);
            set = this.advance(set, next);
            return done({ status: 'ok' });
          }
        }
      } catch (e) {
        if (e instanceof FeatureError) return done({ status: 'error', message: e.message, ...(e.unresolved ? { unresolved: e.unresolved } : {}) });
        if (e instanceof KernelError) return done({ status: 'error', message: e.message });
        return done({ status: 'error', message: `內部錯誤：${e instanceof Error ? e.message : String(e)}` });
      }
    });

    // The result keeps the bodies and, for several, the compound that is their view.
    const view = set.view;
    const compound = set.keep();
    if (compound !== null) this.owned.push(compound);
    for (const b of set.list) this.owned.push(b.shape);
    const bodies: BodyInfo[] = view
      ? view.parts.map((p, i) => {
          const b = set.list[i]!;
          const make = resolved.features.find((x) => x.id === bodyFeature(b.id));
          const piece = b.id.includes('#') ? `#${b.id.split('#')[1]}` : '';
          return {
            id: b.id,
            name: doc.bodies[b.id]?.name ?? `${make?.name ?? bodyFeature(b.id)}${piece}`,
            reference: doc.bodies[b.id]?.reference === true,
            shape: b.shape,
            face0: p.face0,
            faces: p.faces,
            edge0: p.edge0,
            edges: p.edges,
            vertex0: p.vertex0,
            vertices: p.vertices,
          };
        })
      : [];
    return { features: results, body: view, bodies, sketches, frames, totalMs: performance.now() - t0 };
  }

  /**
   * The bodies after a feature: the old ones that are not among the new are let go (a feature makes the shapes it keeps
   * and says which it did away with by leaving them out), and so is the old view of them all.
   */
  private advance(old: Bodies, next: BodyState[]): Bodies {
    const kept = new Set(next.map((b) => b.shape));
    for (const b of old.list) if (!kept.has(b.shape)) this.kernel.release(b.shape);
    old.release();
    return new Bodies(next, this.kernel);
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
    const note = `${what}依幾何指紋找到「${found}」（同名的有好幾個），請確認位置正確`;
    if (via === 'fingerprint' && !this.warnings.includes(note)) this.warnings.push(note);
  }

  // ------------------------------------------------------------------ sketches (C1.1)

  /**
   * A plane reference: a default plane, a reference plane built earlier in this rebuild, or a planar
   * face of the model so far.
   */
  private planeOf(ref: Ref, set: Bodies, labels: { what: string; notPlanar: string }): PlaneFrame {
    if (ref.kind === 'datum') {
      if (isDatumPlaneName(ref.name)) return DATUM_PLANES[ref.name];
      const plane = this.planes.get(ref.name);
      if (!plane) throw new FeatureError(`${labels.what}：參考的基準面不存在、已抑制或失敗`);
      return plane;
    }
    if (ref.kind !== 'face') throw new FeatureError('必須選擇基準面或平面');
    const body = set.view;
    if (!body) throw new FeatureError(`${labels.what}不存在：它之前沒有本體`);
    const face = body.topology.faces[this.resolve(ref, body, labels.what)]!;
    if (face.surface !== 'plane' || !face.normal) throw new FeatureError(labels.notPlanar);
    return planeFrame(face.center, face.normal);
  }

  /** Where a sketch lies (C1.1): a default plane, a reference plane, or a planar face of the model before it. */
  private frame(f: SketchFeature, set: Bodies): PlaneFrame {
    return this.planeOf(f.plane, set, { what: '草圖所在的面', notPlanar: '草圖只能放在平面上' });
  }

  /**
   * Reference plane (C3.2): offset from a plane; through a straight edge at an angle to a plane
   * (at 0° parallel to it); or through three vertices. The frame follows the planeFrame rules, so a
   * sketch on it gets the same axes the same plane would get anywhere else.
   */
  private refPlane(f: RefPlaneFeature, set: Bodies): PlaneFrame {
    const d = f.def;
    const sign = d.reverse ? -1 : 1;
    const labels = { what: '參考面', notPlanar: '參考面必須是平面' };
    switch (d.mode) {
      case 'offset': {
        const base = this.planeOf(d.plane, set, labels);
        return { ...base, origin: add(base.origin, base.normal, evalLength(d.distance) * sign) };
      }
      case 'angle': {
        const base = this.planeOf(d.plane, set, labels);
        const body = set.view;
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
        const body = set.view;
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

  private sketch(f: SketchFeature, set: Bodies) {
    const frame = this.frame(f, set);
    // projected model edges and pierce points are put where the model has them now (C1.18)
    let followed = f;
    if (f.entities.some((e) => (e.type === 'point' ? e.pierce : e.ref))) {
      const body = set.view;
      if (!body) throw new FeatureError(t('reference.noModel'));
      try {
        followed = followReferences(f, { names: body.names, topology: body.topology, frame });
      } catch (e) {
        if (e instanceof ReferenceProblem) throw new FeatureError(e.message, e.unresolved);
        throw e;
      }
    }
    const solved = this.solver.solve(followed);
    const profiles = solved.status === 'failed' ? { regions: [], problems: [] } : findProfiles(followed, solved);
    return { frame, solved, profiles, sketch: followed };
  }

  /** A thin feature's profile (薄件): every closed outline of the sketch a ring, every open path a ribbon (C4.1, C4.3). */
  private thinProfile(s: RebuildResult['sketches'] extends Map<Id, infer V> ? V : never, thin: Thin, contours?: Id[][]) {
    if (contours) throw new FeatureError(t('thin.noContours'));
    const one = evalLength(thin.thickness);
    const th =
      thin.mode === 'mid' ? { inward: one / 2, outward: one / 2 } : thin.mode === 'two' ? { inward: one, outward: evalLength(thin.thickness2 ?? thin.thickness) } : thin.reverse ? { inward: 0, outward: one } : { inward: one, outward: 0 };
    try {
      const regions = thinRegions(s.sketch, s.solved, th);
      if (regions.length === 0) throw new FeatureError('草圖沒有可以做成薄件的輪廓');
      return { ...s, profiles: { regions, problems: [] } };
    } catch (e) {
      if (e instanceof ThinProblem) throw new FeatureError(e.message);
      throw e;
    }
  }

  /** The sketch of a boss or cut with the contours the feature chose (all of them when it chose none, C1.34). */
  private profileOf(sketches: RebuildResult['sketches'], sketchId: Id, contours?: Id[][], thin?: Thin) {
    const s = sketches.get(sketchId);
    if (!s) throw new FeatureError('父草圖不存在、已抑制或失敗');
    if (thin) return this.thinProfile(s, thin, contours);
    if (s.profiles.problems.length > 0) throw new FeatureError(`草圖不能用於特徵：${s.profiles.problems.join('；')}`);
    if (s.profiles.regions.length === 0) throw new FeatureError('草圖沒有封閉輪廓');
    if (!contours) return s;
    const { regions, missing } = selectContours(s.profiles.regions, contours);
    if (missing > 0) throw new FeatureError(t('regen.contourMissing', { n: missing }));
    return { ...s, profiles: { ...s.profiles, regions } };
  }

  // ------------------------------------------------------------------ extrude and revolve (C4.1–C4.3)

  /** How far along `dir` from `origin` the body reaches (0 when it lies entirely behind). */
  private reach(body: BodyState, origin: Vec3, dir: Vec3): number {
    const { min, max } = this.kernel.bounds(body.shape);
    let far = 0;
    for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) far = Math.max(far, dot(sub([x, y, z], origin), dir));
    return far;
  }

  /**
   * One direction of an extrusion (C4.1): where it goes and what it ends on. `dir` is the way it grows; the end conditions that need the
   * model before the feature (through all, up to a face, the next face, a vertex, a body, an offset from a face) look it up here.
   */
  private sweepOf(d: EndCondition, dir: Vec3, s: { frame: PlaneFrame; profiles: ProfileResult }, set: Bodies): SweepSpec {
    const body = set.view;
    const needBody = (what: string): BodyState => {
      if (!body) throw new FeatureError(t('feature.needsBody', { what }));
      return body;
    };
    const origin = s.frame.origin;
    /** A sweep long enough to pass everything of `of`. */
    const longer = (of: BodyState): Vec3 => {
      const length = this.reach(of, origin, dir);
      if (length <= 1e-9) throw new FeatureError(t('feature.nothingThatWay'));
      return add([0, 0, 0], dir, length * 1.01 + 1);
    };
    switch (d.type) {
      case 'blind':
        return { vector: add([0, 0, 0], dir, evalLength(d.depth)) };
      case 'midPlane': {
        const depth = evalLength(d.depth);
        const n = s.frame.normal;
        return { vector: add([0, 0, 0], n, depth), offset: -depth / 2 };
      }
      case 'throughAll':
        return { vector: longer(needBody(t('feature.throughAll'))) };
      case 'upToFace': {
        const b = needBody(t('feature.upToFace'));
        const owner = set.locate('face', this.resolve(d.face, b, t('feature.endFace')));
        return { vector: longer(b), until: { target: owner.body.shape, face: owner.local } };
      }
      case 'upToNext': {
        const b = needBody(t('feature.upToNext'));
        const vector = longer(b);
        const next = this.kernel.nextFace(b.shape, s.frame, s.profiles.regions, vector);
        if (next === null) throw new FeatureError(t('feature.noNextFace'));
        return { vector, until: { target: b.shape, face: next } };
      }
      case 'upToBody': {
        needBody(t('feature.upToBody'));
        if (!d.body.name) throw new FeatureError(t('feature.pickBody'));
        const other = set.list.find((x) => x.id === d.body.name);
        if (!other) throw new FeatureError(t('body.lost', { name: d.body.name }), [{ ref: d.body, reason: 'missing', candidates: [] }]);
        return { vector: longer(other), until: { body: other.shape } };
      }
      case 'upToVertex': {
        const b = needBody(t('feature.upToVertex'));
        const at = b.topology.vertices[this.resolve(d.vertex, b, t('feature.endVertex'))]!.point;
        const depth = dot(sub(at, origin), dir);
        if (depth <= 1e-9) throw new FeatureError(t('feature.vertexBehind'));
        return { vector: add([0, 0, 0], dir, depth) };
      }
      case 'offsetFromFace': {
        const b = needBody(t('feature.offsetFromFace'));
        const face = b.topology.faces[this.resolve(d.face, b, t('feature.endFace'))]!;
        if (face.surface !== 'plane' || !face.normal || Math.abs(dot(face.normal, s.frame.normal)) < 1 - 1e-6) throw new FeatureError(t('feature.offsetNeedsParallel'));
        const offset = evalLength(d.offset);
        const depth = dot(sub(face.center, origin), dir) + (d.beyond ? offset : -offset);
        if (depth <= 1e-9) throw new FeatureError(t('feature.offsetBehind'));
        return { vector: add([0, 0, 0], dir, depth) };
      }
    }
  }

  private extrude(f: ExtrudeFeature, sketches: RebuildResult['sketches'], set: Bodies): BodyState[] {
    const s = this.profileOf(sketches, f.sketch, f.contours, f.thin);
    const body = set.view;
    if (f.op === 'cut' && !body) throw new FeatureError('除料需要既有的本體');
    const n = s.frame.normal;
    // A boss grows along the sketch normal, a cut goes into the material (SolidWorks defaults); direction 2 goes the other way.
    const grow = f.op === 'cut' ? -1 : 1;
    const dirOf = (d: EndCondition, base: number): Vec3 => {
      const sign = base * ('reverse' in d && d.reverse ? -1 : 1);
      return [n[0] * sign, n[1] * sign, n[2] * sign];
    };
    const draftOf = (d: EndCondition, draft: Draft | undefined, which: string): number | undefined => {
      if (!draft) return undefined;
      if (d.type === 'midPlane') throw new FeatureError(t('feature.draftNotMid', { which }));
      // positive leans the walls in along the sweep: "outward" is the other way
      const angle = evalAngle(draft.angle);
      return draft.inward ? angle : -angle;
    };
    const first = { ...this.sweepOf(f.dir1, dirOf(f.dir1, grow), s, set), draft: draftOf(f.dir1, f.draft1, t('feature.dir1')) };
    const spec1: SweepSpec = { vector: first.vector, ...(first.offset === undefined ? {} : { offset: first.offset }), ...(first.until ? { until: first.until } : {}), ...(first.draft === undefined ? {} : { draft: first.draft }) };
    let tool: OpResult;
    if (f.dir2) {
      if (f.dir1.type === 'midPlane' || f.dir2.type === 'midPlane') throw new FeatureError(t('feature.mid2'));
      const second = { ...this.sweepOf(f.dir2, dirOf(f.dir2, -grow), s, set), draft: draftOf(f.dir2, f.draft2, t('feature.dir2')) };
      const spec2: SweepSpec = { vector: second.vector, ...(second.until ? { until: second.until } : {}), ...(second.draft === undefined ? {} : { draft: second.draft }) };
      tool = this.kernel.extrudeBoth(s.frame, s.profiles.regions, spec1, spec2);
    } else {
      tool = this.kernel.extrude(s.frame, s.profiles.regions, spec1.vector, spec1.offset ?? 0, spec1.until, spec1.draft);
    }
    return this.apply(f.id, f.op, tool, { featureId: f.id, sketchId: f.sketch }, set.list, f.merge !== false);
  }

  private revolve(f: RevolveFeature, sketches: RebuildResult['sketches'], set: Bodies): BodyState[] {
    const s = this.profileOf(sketches, f.sketch, f.contours, f.thin);
    if (f.op === 'cut' && !set.view) throw new FeatureError('除料需要既有的本體');
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
    return this.apply(f.id, f.op, tool, { featureId: f.id, sketchId: f.sketch }, set.list, f.merge !== false);
  }

  // ------------------------------------------------------------------ several bodies (C7)

  /**
   * Names a new tool body by how it was swept, then adds it to the bodies (boss) or removes it from them (cut). A boss
   * merges with every body it touches (`merge`, the default) and is a body of its own when it touches none, or when it is
   * not to merge; a cut works on every body it reaches. Faces of a result inherit the names of the faces they came from,
   * on either side. Returns the bodies after the feature; the shapes of those that were changed are new, the old ones are
   * the caller's to let go (`advance`).
   */
  private apply(featureId: Id, op: 'boss' | 'cut', tool: OpResult, context: { featureId: Id; sketchId?: Id }, list: readonly BodyState[], merge: boolean, bodyId: Id = featureId): BodyState[] {
    const k = this.kernel;
    const toolTopology = k.topology(tool.shape);
    const toolNames = nameElements(tool.faceOrigins, toolTopology, context);
    const made: ShapeId[] = [];
    try {
      if (op === 'cut') {
        const r = this.boolBodies(featureId, 'cut', list, tool.shape, toolNames, made);
        k.release(tool.shape);
        if (!r.changed) throw new FeatureError('除料沒有移除任何材料（試試反轉方向）');
        if (r.out.length === 0) throw new FeatureError('除料移除了整個本體');
        if (r.removed.length > 0) this.warnings.push(t('body.removedWhole', { names: r.removed.join(t('cmd.listSeparator')) }));
        return r.out;
      }
      let acc: BodyState = { id: bodyId, shape: tool.shape, topology: toolTopology, names: toolNames, by: featureId };
      if (!merge) return [...list, acc];
      const out: BodyState[] = [];
      let slot = -1;
      for (const b of list) {
        const r = k.boolean('fuse', b.shape, acc.shape);
        // Bodies that touch come out of the fuse as one solid; bodies apart come out as two, and stay apart.
        if (k.solidCount(r.shape) !== 1) {
          k.release(r.shape);
          out.push(b);
          continue;
        }
        made.push(r.shape);
        const topology = k.topology(r.shape);
        const joined: BodyState = { id: slot < 0 ? b.id : acc.id, shape: r.shape, topology, names: nameElements(r.faceOrigins, topology, { featureId, input: concatNames(b.names, acc.names) }), by: featureId };
        if (acc.shape !== tool.shape) k.release(acc.shape); // an earlier step of this very merge
        acc = joined;
        if (slot < 0) {
          slot = out.length;
          out.push(acc);
        } else out[slot] = acc;
      }
      if (slot < 0) out.push(acc);
      else k.release(tool.shape);
      return out;
    } catch (e) {
      for (const s of made) k.release(s);
      k.release(tool.shape); // the tool is the feature's own: whatever went wrong, it is not kept
      throw e;
    }
  }

  /**
   * A boolean of every body in `list` with one tool shape, cut (what the tool takes away) or common (what it shares): a
   * body the tool does not change stays as it is, one it takes entirely is gone (named in `removed`), and one that comes
   * apart becomes several: the largest keeps the id, the others are `<feature>#2`, `#3` … in order of size. The shapes made
   * are added to `made` so that a failure can let them go.
   */
  private boolBodies(featureId: Id, op: 'cut' | 'common', list: readonly BodyState[], toolShape: ShapeId, toolNames: ElementNames, made: ShapeId[], next = { piece: 2 }): { out: BodyState[]; changed: boolean; removed: Id[] } {
    const k = this.kernel;
    const out: BodyState[] = [];
    const removed: Id[] = [];
    let changed = false;
    for (const b of list) {
      const r = k.boolean(op, b.shape, toolShape);
      const before = k.massProps(b.shape).volume;
      const after = k.massProps(r.shape).volume;
      if (after <= 1e-9 * before) {
        k.release(r.shape);
        removed.push(b.id);
        changed = true;
        continue;
      }
      if (Math.abs(before - after) <= 1e-9 * before) {
        k.release(r.shape);
        out.push(b);
        continue;
      }
      changed = true;
      const context = { featureId, input: concatNames(b.names, toolNames) };
      if (k.solidCount(r.shape) <= 1) {
        made.push(r.shape);
        const topology = k.topology(r.shape);
        out.push({ id: b.id, shape: r.shape, topology, names: nameElements(r.faceOrigins, topology, context), by: featureId });
        continue;
      }
      // Named as the one result it came from, so the faces of the pieces keep the `#k` that told them apart there, then shared out.
      const whole = nameElements(r.faceOrigins, k.topology(r.shape), context);
      const pieces = k.splitSolids(r);
      k.release(r.shape);
      pieces.forEach((p, i) => {
        made.push(p.shape);
        const topology = k.topology(p.shape);
        out.push({ id: i === 0 ? b.id : `${featureId}#${next.piece++}`, shape: p.shape, topology, names: nameFromFaces(p.faces.map((j) => whole.faces[j]!), topology), by: featureId });
      });
    }
    return { out, changed, removed };
  }

  /** 「組合」 (C7.2): bodies added to the first, subtracted from it, or reduced to what they share with it. */
  private combineBodies(f: CombineFeature, set: Bodies): BodyState[] {
    const k = this.kernel;
    const find = (ref: Ref, what: string): BodyState => {
      if (!ref.name) throw new FeatureError(t('body.pick', { what }));
      const b = set.list.find((x) => x.id === ref.name);
      if (!b) throw new FeatureError(t('body.lost', { name: ref.name }), [{ ref, reason: 'missing', candidates: [] }]);
      return b;
    };
    const main = find(f.main, t('body.main'));
    if (f.tools.length === 0) throw new FeatureError(t('body.pickTools'));
    const tools = f.tools.map((r) => find(r, t('body.tool')));
    const made: ShapeId[] = [];
    let pieces: BodyState[] = [main];
    const next = { piece: 2 };
    const drop = (old: readonly BodyState[], now: readonly BodyState[]) => {
      // a shape made by an earlier tool of this feature and not kept is let go; the original bodies are the caller's
      for (const b of old) if (b !== main && !now.some((x) => x.shape === b.shape)) k.release(b.shape);
    };
    try {
      for (const tool of tools) {
        if (f.op === 'add') {
          const acc = pieces[0]!;
          const r = k.boolean('fuse', acc.shape, tool.shape);
          if (k.solidCount(r.shape) !== 1) {
            k.release(r.shape);
            throw new FeatureError(t('body.addApart', { name: tool.id }));
          }
          made.push(r.shape);
          const topology = k.topology(r.shape);
          const joined: BodyState = { id: main.id, shape: r.shape, topology, names: nameElements(r.faceOrigins, topology, { featureId: f.id, input: concatNames(acc.names, tool.names) }), by: f.id };
          drop(pieces, [joined]);
          pieces = [joined];
        } else {
          const r = this.boolBodies(f.id, f.op === 'subtract' ? 'cut' : 'common', pieces, tool.shape, tool.names, made, next);
          if (!r.changed && f.op === 'subtract') throw new FeatureError(t('body.subtractNothing', { name: tool.id }));
          if (r.out.length === 0) throw new FeatureError(t(f.op === 'subtract' ? 'body.subtractAll' : 'body.noCommon', { name: tool.id }));
          drop(pieces, r.out);
          pieces = r.out;
        }
      }
    } catch (e) {
      for (const s of made) k.release(s);
      throw e;
    }
    // the result takes the place of the main body; the tools are used up
    const used = new Set(tools.map((x) => x.id));
    return set.list.flatMap((b) => (b === main ? pieces : used.has(b.id) ? [] : [b]));
  }

  // ------------------------------------------------------------------ imported bodies (F2.1)

  /**
   * The solids of an imported file, each a body (and merged with the bodies it touches unless `merge` says not to). Their
   * faces are named `<feature>:f<k>` by the order the file gives them, so the same file always names them the same.
   */
  private importedBody(f: ImportedBodyFeature, doc: PartDoc, set: Bodies): BodyState[] {
    const blob = doc.blobs.find((b) => b.id === f.blob);
    if (!blob) throw new FeatureError('輸入的資料不存在');
    const key = importKey(blob.sha256, f.sewTolerance);
    let imported = this.imports.get(key);
    if (!imported) {
      const data = this.blobs.get(blob.sha256);
      if (!data) throw new FeatureError('找不到輸入的資料（零件檔中缺少），請重新輸入');
      try {
        const r = this.kernel.importStep(data, f.sewTolerance === undefined ? {} : { sewTolerance: evalLength(f.sewTolerance) });
        imported = { shape: r.shape, faceOrigins: r.faceOrigins, warnings: r.warnings, diagnostics: r.diagnostics };
      } catch (e) {
        imported = { error: e instanceof Error ? e.message : String(e) };
      }
      this.imports.set(key, imported);
    }
    if ('error' in imported) throw new FeatureError(imported.error);
    this.warnings.push(...imported.warnings);
    this.diagnostics = imported.diagnostics;
    // The kept shape never becomes a body itself: the bodies are released on the next rebuild. A second feature reading the
    // same file gets a copy that shares nothing, or the faces of the two bodies would be counted once in a view of both.
    const first = !this.usedImports.has(key);
    this.usedImports.add(key);
    const whole: OpResult = { shape: first ? this.kernel.copy(imported.shape) : this.kernel.clone(imported.shape), faceOrigins: imported.faceOrigins };
    const pieces = this.kernel.solidCount(whole.shape) > 1 ? this.kernel.splitSolids(whole) : [whole];
    if (pieces[0] !== whole) this.kernel.release(whole.shape);
    let list: readonly BodyState[] = set.list;
    try {
      pieces.forEach((p, i) => {
        list = this.apply(f.id, 'boss', p, { featureId: f.id }, list, f.merge !== false, i === 0 ? f.id : `${f.id}#${i + 1}`);
      });
    } catch (e) {
      // what the pieces before the failing one made is not in the old bodies: let it go
      const old = new Set(set.list.map((b) => b.shape));
      for (const b of list) if (!old.has(b.shape)) this.kernel.release(b.shape);
      throw e;
    }
    return [...list];
  }

  // ------------------------------------------------------------------ fillet and chamfer (C5.1, C5.3)

  private edgeIndices(refs: Ref[], body: BodyState): number[] {
    if (refs.length === 0) throw new FeatureError(t('edit.noEdgePicked'));
    const indices: number[] = [];
    const unresolved: Unresolved[] = [];
    for (const ref of refs) {
      const r = resolveRef(ref, body.names, body.topology);
      if (r.ok) {
        indices.push(r.index);
        this.noteFingerprint(r.via, '邊線', body.names.edges[r.index]!);
      } else unresolved.push({ ref, reason: r.reason, candidates: r.candidates });
    }
    if (unresolved.length > 0) throw new FeatureError(t('edit.edgesLost', { n: unresolved.length }), unresolved);
    return [...new Set(indices)];
  }

  /**
   * Runs an edit on each body that holds some of the references. The references are found among all the bodies at once, so
   * a lost one is reported with the nearest candidates of the whole model; each body is then given its own references
   * (and finds them again by name). Bodies no reference points into are left as they are, in their place.
   */
  private perBody(set: Bodies, refs: Ref[], kind: 'face' | 'edge', none: string, lost: (n: number) => string, edit: (body: BodyState, mine: Ref[]) => BodyState): BodyState[] {
    const view = set.view;
    if (!view) throw new FeatureError(none);
    if (refs.length === 0) throw new FeatureError(t(kind === 'edge' ? 'edit.noEdgePicked' : 'edit.noFacePicked'));
    const owners = new Map<BodyState, Ref[]>();
    const unresolved: Unresolved[] = [];
    for (const ref of refs) {
      const r = resolveRef(ref, view.names, view.topology);
      if (!r.ok) {
        unresolved.push({ ref, reason: r.reason, candidates: r.candidates });
        continue;
      }
      // Among all the bodies a name may be shared (the pieces of a split face); the body alone then finds it by name.
      this.noteFingerprint(r.via, kind === 'edge' ? '邊線' : t('edit.faceNoun'), view.names[kind === 'edge' ? 'edges' : 'faces'][r.index]!);
      const { body } = set.locate(kind, r.index);
      owners.set(body, [...(owners.get(body) ?? []), ref]);
    }
    if (unresolved.length > 0) throw new FeatureError(lost(unresolved.length), unresolved);
    const done: BodyState[] = [];
    try {
      return set.list.map((b) => {
        const mine = owners.get(b);
        if (!mine) return b;
        const edited = edit(b, mine);
        done.push(edited);
        return edited;
      });
    } catch (e) {
      for (const b of done) this.kernel.release(b.shape);
      throw e;
    }
  }

  // ------------------------------------------------------------------ direct editing (C10.1, C10.2)

  /** Faces of the body that the references name; lost ones are reported together, as for edges. */
  private faceIndices(refs: Ref[], body: BodyState): number[] {
    if (refs.length === 0) throw new FeatureError(t('edit.noFacePicked'));
    const indices: number[] = [];
    const unresolved: Unresolved[] = [];
    for (const ref of refs) {
      const r = resolveRef(ref, body.names, body.topology);
      if (r.ok) {
        indices.push(r.index);
        this.noteFingerprint(r.via, t('edit.faceNoun'), body.names.faces[r.index]!);
      } else unresolved.push({ ref, reason: r.reason, candidates: r.candidates });
    }
    if (unresolved.length > 0) throw new FeatureError(t('edit.facesLost', { n: unresolved.length }), unresolved);
    return [...new Set(indices)];
  }

  /** A result whose faces came from the faces of the body before it: they keep those names (and the body its id). */
  private edited(f: Feature, r: OpResult, body: BodyState): BodyState {
    const topology = this.kernel.topology(r.shape);
    return { id: body.id, shape: r.shape, topology, names: nameElements(r.faceOrigins, topology, { featureId: f.id, input: body.names }), by: f.id };
  }

  private draftFeature(f: DraftFeature, set: Bodies): BodyState[] {
    return this.perBody(set, f.faces, 'face', t('feature.noBodyForDraft'), (n) => t('edit.facesLost', { n }), (body, mine) => {
      const neutral = this.planeOf(f.neutral, set, { what: t('feature.neutralPlane'), notPlanar: t('feature.neutralNotPlanar') });
      // a face is the plane of the body's own surface, so the wall leans away from the body's side of it; a plane is as it is drawn
      const pull = f.neutral.kind === 'face' ? ([-neutral.normal[0], -neutral.normal[1], -neutral.normal[2]] as Vec3) : neutral.normal;
      const sign = f.reverse ? -1 : 1;
      const r = this.kernel.draft(body.shape, this.faceIndices(mine, body), [pull[0] * sign, pull[1] * sign, pull[2] * sign], { origin: neutral.origin, normal: neutral.normal }, evalAngle(f.angle));
      const topology = this.kernel.topology(r.shape);
      return { id: body.id, shape: r.shape, topology, names: nameElements(r.faceOrigins, topology, { featureId: f.id, input: body.names }), by: f.id };
    });
  }

  private shell(f: ShellFeature, set: Bodies): BodyState[] {
    return this.perBody(set, f.faces, 'face', t('feature.noBodyForShell'), (n) => t('edit.facesLost', { n }), (body, mine) => {
      const r = this.kernel.shell(body.shape, this.faceIndices(mine, body), evalLength(f.thickness), !!f.outward);
      const topology = this.kernel.topology(r.shape);
      return { id: body.id, shape: r.shape, topology, names: nameElements(r.faceOrigins, topology, { featureId: f.id, role: 'shell', input: body.names }), by: f.id };
    });
  }

  private deleteFace(f: DeleteFaceFeature, set: Bodies): BodyState[] {
    return this.perBody(set, f.faces, 'face', t('edit.noBodyForDelete'), (n) => t('edit.facesLost', { n }), (body, mine) => {
      const picked = this.faceIndices(mine, body);
      return this.edited(f, this.kernel.deleteFaces(body.shape, f.hole ? holeFaces(body.topology, picked) : picked), body);
    });
  }

  private moveFace(f: MoveFaceFeature, set: Bodies): BodyState[] {
    return this.perBody(set, [f.face], 'face', t('edit.noBodyForMove'), (n) => t('edit.facesLost', { n }), (body) => {
      const [face] = this.faceIndices([f.face], body);
      return this.edited(f, this.kernel.moveFace(body.shape, face!, evalLength(f.distance)), body);
    });
  }

  private fillet(f: FilletFeature, set: Bodies): BodyState[] {
    return this.perBody(set, f.edges, 'edge', t('edit.noBodyForFillet'), (n) => t('edit.edgesLost', { n }), (body, mine) => {
      const r = this.kernel.fillet(body.shape, this.edgeIndices(mine, body), evalLength(f.radius));
      const topology = this.kernel.topology(r.shape);
      return { id: body.id, shape: r.shape, topology, names: nameElements(r.faceOrigins, topology, { featureId: f.id, role: 'fillet', input: body.names }), by: f.id };
    });
  }

  private chamfer(f: ChamferFeature, set: Bodies): BodyState[] {
    return this.perBody(set, f.edges, 'edge', t('edit.noBodyForChamfer'), (n) => t('edit.edgesLost', { n }), (body, mine) => {
      const specs = this.edgeIndices(mine, body).map((edge) => {
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
      return { id: body.id, shape: r.shape, topology, names: nameElements(r.faceOrigins, topology, { featureId: f.id, role: 'chamfer', input: body.names }), by: f.id };
    });
  }
}
