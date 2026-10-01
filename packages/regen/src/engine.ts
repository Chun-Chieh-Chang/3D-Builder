import { t } from '@3db/i18n';
import {
  DATUM_PLANES,
  evalAngle,
  evalLength,
  isDatumPlaneName,
  patternInstances,
  planeFrame,
  resolveDoc,
  bodyFeature,
  type Axis3,
  type ChamferFeature,
  type CoordSysFeature,
  type CoordSystem,
  type CombineFeature,
  type DeleteFaceFeature,
  type DraftFeature,
  type HoleFeature,
  type Draft,
  type EndCondition,
  type ExtrudeFeature,
  type Feature,
  type FilletFeature,
  type Id,
  type ImportedBodyFeature,
  type LoftFeature,
  type MoveFaceFeature,
  type PatternFeature,
  type PartDoc,
  type PlaneFrame,
  type Ref,
  type RefAxisFeature,
  type RefPlaneFeature,
  type RefPointFeature,
  type RevolveFeature,
  type RibFeature,
  type ShellFeature,
  type SketchFeature,
  type SweepFeature,
  type Thin,
  type Vec3,
} from '@3db/model';
import { findOutlines, findProfiles, reversePath, selectContours, ThinProblem, thinRegions, type ProfileResult, type SketchSolver, type SketchStatus, type SolvedSketch } from '@3db/sketch';
import { KernelError, type SweepSpec, type FaceOrigin, type ImportDiagnostics, type Kernel, type OpResult, type ShapeId, type Topology } from '@3db/kernel';
import { nameElements, nameFromFaces, resolveRef, type Candidate, type ElementNames } from '@3db/naming';
import { Bodies, type BodyState, type BodyView } from './bodies';
import { followReferences, ReferenceProblem } from './references';
import { angleStep, slide, turn, type Motion } from './placements';

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
  /** The reference axes, reference points and coordinate systems that were built (C3.3–C3.5), by feature id. */
  axes: Map<Id, Axis3>;
  points: Map<Id, Vec3>;
  systems: Map<Id, CoordSystem>;
  totalMs: number;
}

/** The bodies as they were before the first seed of a pattern (C6): a handle on their shape, their names, and how many there were. */
interface Snapshot {
  shape: ShapeId | null;
  names: ElementNames;
  bodies: number;
}

/**
 * What the seeds of a pattern did (C6): the material they added to the bodies and the material they took from them, each as a shape with the names its
 * faces had, and whether they made a body of their own (so each instance does too). Null where they did none.
 */
interface Delta {
  added: { shape: ShapeId; names: ElementNames } | null;
  removed: { shape: ShapeId; names: ElementNames } | null;
  newBody: boolean;
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
  /** Reference axes, points and coordinate systems built so far in this rebuild (C3.3–C3.5). */
  private axes = new Map<Id, Axis3>();
  private points = new Map<Id, Vec3>();
  private systems = new Map<Id, CoordSystem>();
  /** Patterns (C6), for the rebuild in progress: the first seed's bodies before it, the delta of each pattern, why a pattern has none, and how each feature ended. */
  private snapshots = new Map<Id, Snapshot>();
  private deltas = new Map<Id, Delta>();
  private patternPlans = new Map<Id, { first: Id; last: Id; seeds: Id[] } | string>();
  private statuses = new Map<Id, FeatureStatus>();
  private featureNames = new Map<Id, string>();
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
    this.axes = new Map();
    this.points = new Map();
    this.systems = new Map();
    this.releasePatterns();
    this.statuses = new Map();

    // Every expression becomes the number it stands for before anything is built: the solver and the kernel
    // only ever see numbers. A feature whose expression cannot be evaluated reports why instead of building.
    const { doc: resolved, problems } = resolveDoc(doc);
    this.planPatterns(resolved);
    const firstSeeds = new Set([...this.patternPlans.values()].flatMap((p) => (typeof p === 'string' ? [] : [p.first])));
    const lastSeeds = new Map<Id, Id[]>();
    for (const [pattern, p] of this.patternPlans) if (typeof p !== 'string') lastSeeds.set(p.last, [...(lastSeeds.get(p.last) ?? []), pattern]);
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
      const done = (r: Omit<FeatureResult, 'id' | 'ms'>) => {
        this.statuses.set(feature.id, r.status);
        return results.push({ id: feature.id, ms: performance.now() - t, ...r, ...(this.warnings.length > 0 ? { warnings: this.warnings } : {}), ...(this.diagnostics ? { diagnostics: this.diagnostics } : {}) });
      };
      // a pattern's seeds are compared with the bodies as they were before the first of them
      if (firstSeeds.has(feature.id) && index < limit && !feature.suppressed) this.snapshots.set(feature.id, this.snapshot(set));
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
          case 'refAxis': {
            this.axes.set(feature.id, this.refAxis(feature, set));
            return done({ status: 'ok' });
          }
          case 'refPoint': {
            this.points.set(feature.id, this.refPoint(feature, set));
            return done({ status: 'ok' });
          }
          case 'coordSys': {
            this.systems.set(feature.id, this.coordSys(feature, set));
            return done({ status: 'ok' });
          }
          case 'extrude':
          case 'revolve':
          case 'sweep':
          case 'loft':
          case 'rib':
          case 'fillet':
          case 'chamfer':
          case 'shell':
          case 'hole':
          case 'draft':
          case 'deleteFace':
          case 'moveFace':
          case 'combine':
          case 'pattern':
          case 'importedBody': {
            const next =
              feature.type === 'extrude'
                ? this.extrude(feature, sketches, set)
                : feature.type === 'revolve'
                  ? this.revolve(feature, sketches, set)
                  : feature.type === 'sweep'
                  ? this.sweep(feature, sketches, set)
                  : feature.type === 'loft'
                  ? this.loft(feature, sketches, set)
                  : feature.type === 'rib'
                  ? this.rib(feature, sketches, set)
                  : feature.type === 'fillet'
                    ? this.fillet(feature, set)
                    : feature.type === 'chamfer'
                      ? this.chamfer(feature, set)
                      : feature.type === 'hole'
                        ? this.hole(feature, sketches, set)
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
                            : feature.type === 'pattern'
                              ? this.pattern(feature, set)
                              : this.importedBody(feature, doc, set);
            set = this.advance(set, next);
            for (const pattern of lastSeeds.get(feature.id) ?? []) this.captureDelta(pattern, set);
            return done({ status: 'ok' });
          }
        }
      } catch (e) {
        if (e instanceof FeatureError) return done({ status: 'error', message: e.message, ...(e.unresolved ? { unresolved: e.unresolved } : {}) });
        if (e instanceof KernelError) return done({ status: 'error', message: e.message });
        return done({ status: 'error', message: `內部錯誤：${e instanceof Error ? e.message : String(e)}` });
      }
    });

    this.releasePatterns();

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
    return { features: results, body: view, bodies, sketches, frames, axes: this.axes, points: this.points, systems: this.systems, totalMs: performance.now() - t0 };
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

  /** The model so far, which a reference to one of its elements is looked up in. */
  private modelFor(set: Bodies, what: string): BodyView {
    const body = set.view;
    if (!body) throw new FeatureError(t('datum.noModel', { what }));
    return body;
  }

  /** A straight model edge or a reference axis (C3.3) as a point on it and a direction. */
  private axisOfRef(ref: Ref, set: Bodies, what: string): Axis3 {
    if (ref.kind === 'datum') {
      const axis = this.axes.get(ref.name);
      if (!axis) throw new FeatureError(t('datum.axisMissing', { what }));
      return axis;
    }
    const body = this.modelFor(set, what);
    if (ref.kind === 'face') {
      // the axis of a cylinder, a cone or a torus
      const axis = axisOf(body.topology.faces[this.resolve(ref, body, what)]!);
      if (!axis) throw new FeatureError(t('datum.notRevolved'));
      // which way along its axis a surface of revolution runs is OCCT's to say and may change from one rebuild to the next: the axis of a face points
      // the way its first coordinate that is not zero grows, so that what turns about it always turns the same way
      const d = unit(axis.dir);
      const lead = d.find((c) => Math.abs(c) > 1e-9) ?? 1;
      return { origin: axis.point, dir: lead < 0 ? [-d[0], -d[1], -d[2]] : d };
    }
    const edge = body.topology.edges[this.resolve(ref, body, what)]!;
    if (edge.curve !== 'line' || !edge.dir) throw new FeatureError(t('datum.notLine', { what }));
    return { origin: edge.mid, dir: unit(edge.dir) };
  }

  /** A model vertex or a reference point (C3.5). */
  private pointOfRef(ref: Ref, set: Bodies, what: string): Vec3 {
    if (ref.kind === 'datum') {
      const point = this.points.get(ref.name);
      if (!point) throw new FeatureError(t('datum.pointMissing', { what }));
      return point;
    }
    const body = this.modelFor(set, what);
    return body.topology.vertices[this.resolve(ref, body, what)]!.point;
  }

  /**
   * Reference plane (C3.2): offset from a plane; through a straight edge or axis at an angle to a plane
   * (at 0° parallel to it); through three points; through a point parallel to a plane; through a point square to an axis; halfway between two
   * parallel planes; or touching a cylinder, parallel to a plane. The frame follows the planeFrame rules, so a
   * sketch on it gets the same axes the same plane would get anywhere else.
   */
  private refPlane(f: RefPlaneFeature, set: Bodies): PlaneFrame {
    const d = f.def;
    const sign = d.reverse ? -1 : 1;
    const labels = { what: '參考面', notPlanar: '參考面必須是平面' };
    const signed = (n: Vec3): Vec3 => [n[0] * sign, n[1] * sign, n[2] * sign];
    switch (d.mode) {
      case 'offset': {
        const base = this.planeOf(d.plane, set, labels);
        return { ...base, origin: add(base.origin, base.normal, evalLength(d.distance) * sign) };
      }
      case 'angle': {
        const base = this.planeOf(d.plane, set, labels);
        const axis = this.axisOfRef(d.axis, set, '旋轉軸');
        const k = axis.dir;
        // The part of the plane's normal across the axis, turned about the axis.
        const across = sub(base.normal, add([0, 0, 0], k, dot(base.normal, k)));
        if (Math.hypot(...across) < 1e-9) throw new FeatureError('旋轉軸不能垂直於參考面');
        return planeFrame(axis.origin, rotate(unit(across), k, evalAngle(d.angle) * sign));
      }
      case 'threePoint': {
        if (d.points.length < 3) throw new FeatureError('三點基準面需要三個頂點');
        const [a, b, c] = d.points.map((ref, i) => this.pointOfRef(ref, set, t('datum.nthPoint', { n: i + 1 }))) as [Vec3, Vec3, Vec3];
        const normal = cross(sub(b, a), sub(c, a));
        const size = Math.max(Math.hypot(...sub(b, a)), Math.hypot(...sub(c, a)), 1e-9);
        if (Math.hypot(...normal) < 1e-9 * size * size) throw new FeatureError('三點共線，無法決定平面');
        return planeFrame(a, signed(unit(normal)));
      }
      case 'parallel': {
        const base = this.planeOf(d.plane, set, labels);
        return planeFrame(this.pointOfRef(d.point, set, t('datum.through')), signed(base.normal));
      }
      case 'perpendicular': {
        const axis = this.axisOfRef(d.axis, set, t('datum.perpendicularTo'));
        return planeFrame(this.pointOfRef(d.point, set, t('datum.through')), signed(axis.dir));
      }
      case 'midplane': {
        const a = this.planeOf(d.plane, set, labels);
        const b = this.planeOf(d.plane2, set, { what: t('datum.secondPlane'), notPlanar: t('datum.secondPlaneNotPlanar') });
        const sin = Math.hypot(...cross(a.normal, b.normal));
        if (sin > 1e-9) throw new FeatureError(t('datum.midParallel', { angle: ((Math.asin(Math.min(1, sin)) * 180) / Math.PI).toFixed(2) }));
        const gap = dot(sub(b.origin, a.origin), a.normal);
        if (Math.abs(gap) < 1e-9) throw new FeatureError(t('datum.midCoincident'));
        return planeFrame(add(a.origin, a.normal, gap / 2), signed(a.normal));
      }
      case 'tangent': {
        const base = this.planeOf(d.plane, set, labels);
        const body = this.modelFor(set, t('datum.cylinderFace'));
        const face = body.topology.faces[this.resolve(d.face, body, t('datum.cylinderFace'))]!;
        const g = face.geometry;
        if (g?.type !== 'cylinder') throw new FeatureError(t('datum.tangentCylinder'));
        const axis = unit(g.axis);
        if (Math.abs(dot(base.normal, axis)) > 1e-6) throw new FeatureError(t('datum.tangentNotParallel'));
        return planeFrame(add(g.origin, base.normal, g.radius * sign), signed(base.normal));
      }
    }
  }

  /** Reference axis (C3.3): a straight edge, two points, the axis of a cylinder or cone, or where two planes meet. */
  private refAxis(f: RefAxisFeature, set: Bodies): Axis3 {
    const d = f.def;
    switch (d.mode) {
      case 'edge':
        return this.axisOfRef(d.edge, set, t('datum.edge'));
      case 'twoPoints': {
        if (d.points.length < 2) throw new FeatureError(t('datum.twoPointsNeedTwo'));
        const [a, b] = d.points.map((ref, i) => this.pointOfRef(ref, set, t('datum.nthPoint', { n: i + 1 }))) as [Vec3, Vec3];
        const v = sub(b, a);
        if (Math.hypot(...v) < 1e-9) throw new FeatureError(t('datum.twoPointsSame'));
        return { origin: a, dir: unit(v) };
      }
      case 'cylinder': {
        const body = this.modelFor(set, t('datum.cylinderFace'));
        const face = body.topology.faces[this.resolve(d.face, body, t('datum.cylinderFace'))]!;
        const g = face.geometry;
        if (g?.type !== 'cylinder' && g?.type !== 'cone') throw new FeatureError(t('datum.notRevolved'));
        return g.type === 'cylinder' ? { origin: g.origin, dir: unit(g.axis) } : { origin: g.apex, dir: unit(g.axis) };
      }
      case 'planes': {
        const labels = { what: '參考面', notPlanar: '參考面必須是平面' };
        const a = this.planeOf(d.plane, set, labels);
        const b = this.planeOf(d.plane2, set, { what: t('datum.secondPlane'), notPlanar: t('datum.secondPlaneNotPlanar') });
        const dir = cross(a.normal, b.normal);
        const len2 = dot(dir, dir);
        if (len2 < 1e-18) throw new FeatureError(t('datum.planesParallelNoLine'));
        // the point of both planes nearest the origin: ((h1 n2 − h2 n1) …) as the sum of the two planes' parts square to the line
        const h1 = dot(a.normal, a.origin);
        const h2 = dot(b.normal, b.origin);
        const p1 = cross(b.normal, dir);
        const p2 = cross(dir, a.normal);
        const origin: Vec3 = [(h1 * p1[0] + h2 * p2[0]) / len2, (h1 * p1[1] + h2 * p2[1]) / len2, (h1 * p1[2] + h2 * p2[2]) / len2];
        return { origin, dir: unit(dir) };
      }
    }
  }

  /** Reference point (C3.5): by coordinates, the centre of an edge or a face, or where an axis meets a plane. */
  private refPoint(f: RefPointFeature, set: Bodies): Vec3 {
    const d = f.def;
    switch (d.mode) {
      case 'coords':
        return [evalLength(d.x), evalLength(d.y), evalLength(d.z)];
      case 'center': {
        const body = this.modelFor(set, t('datum.centerOf'));
        const index = this.resolve(d.element, body, t('datum.centerOf'));
        if (d.element.kind === 'edge') {
          const edge = body.topology.edges[index]!;
          return edge.geometry?.type === 'circle' ? edge.geometry.center : edge.mid;
        }
        const face = body.topology.faces[index]!;
        return face.geometry?.type === 'sphere' ? face.geometry.center : face.center;
      }
      case 'axisPlane': {
        const axis = this.axisOfRef(d.axis, set, t('datum.axis'));
        const plane = this.planeOf(d.plane, set, { what: '參考面', notPlanar: '參考面必須是平面' });
        const along = dot(axis.dir, plane.normal);
        if (Math.abs(along) < 1e-9) throw new FeatureError(t('datum.axisParallelPlane'));
        return add(axis.origin, axis.dir, dot(sub(plane.origin, axis.origin), plane.normal) / along);
      }
    }
  }

  /** A direction a coordinate system takes from an element: a straight edge or an axis (as drawn), or the normal of a plane. */
  private directionOf(ref: Ref, set: Bodies, what: string): Vec3 {
    if (ref.kind === 'datum' && (isDatumPlaneName(ref.name) || this.planes.has(ref.name))) return this.planeOf(ref, set, { what, notPlanar: t('datum.dirKind', { what }) }).normal;
    if (ref.kind === 'datum' || ref.kind === 'edge') return this.axisOfRef(ref, set, what).dir;
    if (ref.kind === 'face') return this.planeOf(ref, set, { what, notPlanar: t('datum.dirKind', { what }) }).normal;
    throw new FeatureError(t('datum.dirKind', { what }));
  }

  /** Coordinate system (C3.4): X along one direction, Y as near the other as is square to X, Z = X × Y. */
  private coordSys(f: CoordSysFeature, set: Bodies): CoordSystem {
    const origin: Vec3 = f.origin ? this.pointOfRef(f.origin, set, t('datum.csOrigin')) : [0, 0, 0];
    const flip = (v: Vec3, on: boolean | undefined): Vec3 => (on ? [-v[0], -v[1], -v[2]] : v);
    const x = unit(flip(this.directionOf(f.x, set, t('datum.xDirection')), f.flipX));
    const y0 = flip(this.directionOf(f.y, set, t('datum.yDirection')), f.flipY);
    const z = cross(x, y0);
    if (Math.hypot(...z) < 1e-9 * Math.hypot(...y0)) throw new FeatureError(t('datum.coordParallel'));
    const zu = unit(z);
    return { origin, x, y: cross(zu, x), z: zu };
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

  /**
   * The sweep (C4.4): the closed outlines of one sketch carried along the path of another. The path is a single open run of lines and arcs with one
   * end on the plane of the profile, and does not run along that plane there; that end is where the sweep starts. Everything else is said, not guessed.
   */
  private sweep(f: SweepFeature, sketches: RebuildResult['sketches'], set: Bodies): BodyState[] {
    const s = this.profileOf(sketches, f.sketch, f.contours);
    if (f.op === 'cut' && !set.view) throw new FeatureError(t('feature.cutNeedsBody'));
    const p = sketches.get(f.path);
    if (!p) throw new FeatureError(t('feature.sweepPathGone'));
    const found = findOutlines(p.sketch, p.solved);
    if (found.problems.length > 0) throw new FeatureError(found.problems.join(t('cmd.listSeparator')));
    if (found.chains.length === 0 && found.loops.length === 0) throw new FeatureError(t('feature.sweepNoPath'));
    if (found.chains.length === 0) throw new FeatureError(t('feature.sweepPathClosed'));
    if (found.chains.length + found.loops.length > 1) throw new FeatureError(t('feature.sweepPathMany', { n: String(found.chains.length + found.loops.length) }));
    let path = found.chains[0]!;
    const at = (frame: PlaneFrame, q: [number, number]): Vec3 => add(add(frame.origin, frame.xDir, q[0]), frame.yDir, q[1]);
    const away = (q: [number, number]) => Math.abs(dot(sub(at(p.frame, q), s.frame.origin), s.frame.normal));
    const first = path[0]!;
    const last = path[path.length - 1]!;
    const head = first.kind === 'line' ? first.a : first.kind === 'arc' ? first.from : first.c;
    const tail = last.kind === 'line' ? last.b : last.kind === 'arc' ? last.to : last.c;
    const extent = Math.max(1, ...path.map((g) => (g.kind === 'line' ? Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]) : g.kind === 'arc' ? g.r : 0)));
    const tol = 1e-6 * extent;
    if (away(head) > tol) {
      if (away(tail) > tol) throw new FeatureError(t('feature.sweepPathOffPlane', { a: away(head).toFixed(3), b: away(tail).toFixed(3) }));
      path = reversePath(path);
    }
    // the way the path leaves the profile: it must cross the profile's plane, not run along it
    const start = path[0]!;
    const heading: [number, number] =
      start.kind === 'line'
        ? [start.b[0] - start.a[0], start.b[1] - start.a[1]]
        : start.kind === 'arc'
          ? (() => {
              const r: [number, number] = [start.from[0] - start.c[0], start.from[1] - start.c[1]];
              return start.ccw ? [-r[1], r[0]] : [r[1], -r[0]];
            })()
          : [1, 0];
    const dir = unit(add(add([0, 0, 0], p.frame.xDir, heading[0]), p.frame.yDir, heading[1]));
    if (Math.abs(dot(dir, s.frame.normal)) < 1e-3) throw new FeatureError(t('feature.sweepPathAlongPlane'));
    const tool = this.kernel.sweepAlongPath(s.frame, s.profiles.regions, p.frame, path);
    return this.apply(f.id, f.op, tool, { featureId: f.id, sketchId: f.sketch }, set.list, f.merge !== false);
  }

  /**
   * The loft (C4.5): the sketches of the sections, each with one closed outline and no hole, in the order the feature lists them. OCCT does the
   * rest, and what it makes must be a valid solid.
   */
  private loft(f: LoftFeature, sketches: RebuildResult['sketches'], set: Bodies): BodyState[] {
    if (f.sections.length < 2) throw new FeatureError(t('feature.loftFewSections'));
    if (f.op === 'cut' && !set.view) throw new FeatureError(t('feature.cutNeedsBody'));
    const sections = f.sections.map((id) => {
      const s = sketches.get(id);
      if (!s) throw new FeatureError(t('feature.loftSectionGone'));
      const { regions } = this.profileOf(sketches, id).profiles;
      if (regions.length !== 1) throw new FeatureError(t('feature.loftOneOutline', { name: s.sketch.name, n: String(regions.length) }));
      if (regions[0]!.holes.length > 0) throw new FeatureError(t('feature.loftNoHoles', { name: s.sketch.name }));
      return { frame: s.frame, outer: regions[0]!.outer };
    });
    const tool = this.kernel.loft(sections);
    return this.apply(f.id, f.op, tool, { featureId: f.id, sketchId: f.sections[0]! }, set.list, f.merge !== false);
  }

  /**
   * The rib (C4.7): the one line of the sketch becomes a wall of the thickness asked for, a rectangle square to the sketch plane along the line, and
   * grows from the line (in the sketch plane, square to the line) as far as the body: an extrusion up to the body, then joined to it. A rib that
   * grows away from the body, or past which there is nothing, says so.
   */
  private rib(f: RibFeature, sketches: RebuildResult['sketches'], set: Bodies): BodyState[] {
    const s = sketches.get(f.sketch);
    if (!s) throw new FeatureError(t('feature.ribSketchGone'));
    const body = set.view;
    if (!body) throw new FeatureError(t('feature.ribNeedsBody'));
    const found = findOutlines(s.sketch, s.solved);
    if (found.problems.length > 0) throw new FeatureError(found.problems.join(t('cmd.listSeparator')));
    const line = found.chains.length === 1 && found.loops.length === 0 && found.chains[0]!.length === 1 ? found.chains[0]![0]! : null;
    if (line?.kind !== 'line') throw new FeatureError(t('feature.ribOneLine', { n: String(found.chains.length + found.loops.length) }));
    const at = (q: [number, number]): Vec3 => add(add(s.frame.origin, s.frame.xDir, q[0]), s.frame.yDir, q[1]);
    const a = at(line.a);
    const along = sub(at(line.b), a);
    const length = Math.hypot(...along);
    const u = unit(along);
    const n = s.frame.normal;
    // the wall grows along (normal × the way the line is drawn): the normal of the frame of the line and its thickness
    const frame: PlaneFrame = { origin: a, xDir: u, yDir: n, normal: cross(u, n) };
    const dir: Vec3 = f.flip ? [-frame.normal[0], -frame.normal[1], -frame.normal[2]] : frame.normal;
    const thickness = evalLength(f.thickness);
    const [y0, y1] = f.side === 'mid' ? [-thickness / 2, thickness / 2] : f.side === 'positive' ? [0, thickness] : [-thickness, 0];
    const wall = (p: [number, number], q: [number, number], what: string) => ({ kind: 'line' as const, a: p, b: q, source: `${line.source}.${what}` });
    const outer = [wall([0, y0], [length, y0], 'neg'), wall([length, y0], [length, y1], 'end2'), wall([length, y1], [0, y1], 'pos'), wall([0, y1], [0, y0], 'end1')];
    const reach = this.reach(body, a, dir);
    if (reach <= 1e-9) throw new FeatureError(t('feature.ribAway'));
    let tool: OpResult;
    try {
      tool = this.kernel.extrude(frame, [{ outer, holes: [] }], add([0, 0, 0], dir, reach * 1.01 + 1), 0, { body: body.shape });
    } catch (e) {
      if (e instanceof KernelError && e.message === t('feature.bodyNotReached')) throw new FeatureError(t('feature.ribNotReached'));
      throw e;
    }
    return this.apply(f.id, 'boss', tool, { featureId: f.id, sketchId: f.sketch }, set.list, true);
  }

  // ------------------------------------------------------------------ patterns (C6)

  /** Lets go of what the patterns of a rebuild kept: the bodies before their first seeds, and what the seeds did. */
  private releasePatterns(): void {
    for (const s of this.snapshots.values()) if (s.shape !== null) this.kernel.release(s.shape);
    for (const d of this.deltas.values()) {
      if (d.added) this.kernel.release(d.added.shape);
      if (d.removed) this.kernel.release(d.removed.shape);
    }
    this.snapshots.clear();
    this.deltas.clear();
    this.patternPlans.clear();
  }

  /**
   * Which features each pattern repeats, or why it cannot: they must exist, be before the pattern, be built (not suppressed) and follow one another with
   * nothing between, since what is repeated is the difference between the bodies before the first of them and after the last.
   */
  private planPatterns(doc: PartDoc): void {
    this.featureNames = new Map(doc.features.map((f) => [f.id, f.name]));
    doc.features.forEach((f, index) => {
      if (f.type !== 'pattern' || f.suppressed) return;
      if (f.seeds.length === 0) return void this.patternPlans.set(f.id, t('pattern.noSeeds'));
      const at = f.seeds.map((id) => doc.features.findIndex((g) => g.id === id)).sort((a, b) => a - b);
      if (at.some((i) => i < 0 || i >= index)) return void this.patternPlans.set(f.id, t('pattern.seedMissing'));
      // between the first and the last seed there may be sketches and reference geometry, which leave the bodies as they are, but no other feature
      const between = doc.features.slice(at[0]!, at[at.length - 1]! + 1).find((g) => !f.seeds.includes(g.id) && g.type !== 'sketch' && g.type !== 'refPlane' && g.type !== 'refAxis' && g.type !== 'refPoint' && g.type !== 'coordSys');
      if (between) return void this.patternPlans.set(f.id, t('pattern.seedsApart', { name: between.name }));
      const suppressed = at.map((i) => doc.features[i]!).find((g) => g.suppressed);
      if (suppressed) return void this.patternPlans.set(f.id, t('pattern.seedSuppressed', { name: suppressed.name }));
      this.patternPlans.set(f.id, { first: doc.features[at[0]!]!.id, last: doc.features[at[at.length - 1]!]!.id, seeds: at.map((i) => doc.features[i]!.id) });
    });
  }

  private snapshot(set: Bodies): Snapshot {
    const view = set.view;
    return { shape: view ? this.kernel.copy(view.shape) : null, names: view ? view.names : { faces: [], edges: [], vertices: [] }, bodies: set.list.length };
  }

  /** What the seeds of `pattern` did, now that the last of them is built: the bodies after, less the bodies before (added), and the bodies before, less the bodies after (removed). */
  private captureDelta(pattern: Id, set: Bodies): void {
    const plan = this.patternPlans.get(pattern);
    if (!plan || typeof plan === 'string') return;
    const before = this.snapshots.get(plan.first);
    const after = set.view;
    if (!before || !after) return;
    const k = this.kernel;
    const part = (op: 'cut', target: ShapeId, tool: ShapeId | null, targetNames: ElementNames, toolNames: ElementNames, total: number): Delta['added'] => {
      if (tool === null) return { shape: k.copy(target), names: targetNames };
      const r = k.boolean(op, target, tool);
      if (k.massProps(r.shape).volume <= 1e-9 * Math.max(total, 1e-12)) {
        k.release(r.shape);
        return null;
      }
      const topology = k.topology(r.shape);
      return { shape: r.shape, names: nameElements(r.faceOrigins, topology, { featureId: pattern, input: concatNames(targetNames, toolNames) }) };
    };
    const total = Math.max(k.massProps(after.shape).volume, before.shape === null ? 0 : k.massProps(before.shape).volume);
    const added = part('cut', after.shape, before.shape, after.names, before.names, total);
    const removed = before.shape === null ? null : part('cut', before.shape, after.shape, before.names, after.names, total);
    this.deltas.set(pattern, { added, removed, newBody: added !== null && set.list.length > before.bodies });
  }

  /** The unit direction of a direction of a linear pattern: a straight edge, a reference axis, or the normal of a plane. */
  private patternDirection(ref: Ref, set: Bodies, what: string): Vec3 {
    return unit(this.directionOf(ref, set, what));
  }

  /** The count a pattern asks for (already a number: the document's expressions were worked out before the rebuild). */
  private patternCount(expr: string, what: string): number {
    const n = Math.round(Number(expr));
    if (!(n >= 2)) throw new FeatureError(t('pattern.countTooSmall', { what, value: expr }));
    return n;
  }

  /** Where each instance goes, as a motion of space, by its label (the seed, which stays, is not among them). */
  private placements(f: PatternFeature, set: Bodies): { label: string; motion: Motion }[] {
    const d = f.def;
    if (d.mode === 'linear') {
      const sign = (r?: boolean) => (r ? -1 : 1);
      const v1 = this.patternDirection(d.dir1.ref, set, t('pattern.direction1'));
      const n1 = this.patternCount(d.dir1.count, t('pattern.direction1'));
      const s1 = evalLength(d.dir1.spacing) * sign(d.dir1.reverse);
      if (!d.dir2) return patternInstances(n1, null).map((x) => ({ label: x.label, motion: slide([v1[0] * s1 * x.i, v1[1] * s1 * x.i, v1[2] * s1 * x.i]) }));
      const v2 = this.patternDirection(d.dir2.ref, set, t('pattern.direction2'));
      if (Math.hypot(...cross(v1, v2)) < 1e-9) throw new FeatureError(t('pattern.directionsParallel'));
      const n2 = this.patternCount(d.dir2.count, t('pattern.direction2'));
      const s2 = evalLength(d.dir2.spacing) * sign(d.dir2.reverse);
      return patternInstances(n1, n2).map((x) => ({
        label: x.label,
        motion: slide([v1[0] * s1 * x.i + v2[0] * s2 * x.j, v1[1] * s1 * x.i + v2[1] * s2 * x.j, v1[2] * s1 * x.i + v2[2] * s2 * x.j]),
      }));
    }
    const axis = this.axisOfRef(d.axis, set, t('pattern.rotationAxis'));
    const n = this.patternCount(d.count, t('pattern.count'));
    const step = angleStep(n, evalAngle(d.angle), d.equal) * (d.reverse ? -1 : 1);
    return patternInstances(n, null).map((x) => ({ label: x.label, motion: turn(axis.origin, axis.dir, step * x.i) }));
  }

  /** A pattern (C6.1, C6.2): a copy of what the seeds added, moved to each instance and joined like the seed was, and of what they took away, moved and cut. */
  private pattern(f: PatternFeature, set: Bodies): BodyState[] {
    const plan = this.patternPlans.get(f.id);
    if (typeof plan === 'string') throw new FeatureError(plan);
    if (!plan) throw new FeatureError(t('pattern.seedMissing'));
    const failed = plan.seeds.find((id) => this.statuses.get(id) !== 'ok');
    if (failed) throw new FeatureError(t('pattern.seedFailed', { name: this.featureNames.get(failed) ?? failed }));
    const delta = this.deltas.get(f.id);
    if (!delta || (!delta.added && !delta.removed)) throw new FeatureError(t('pattern.seedChangedNothing'));
    const k = this.kernel;
    const skip = new Set(f.skip ?? []);
    const instances = this.placements(f, set).filter((p) => !skip.has(p.label));
    if (instances.length === 0) throw new FeatureError(t('pattern.noInstances'));
    // the copy of what the seeds did that goes to each instance, made before any is used so that they can be compared with one another
    const pending = new Set<ShapeId>();
    const make = (part: NonNullable<Delta['added']>) =>
      instances.map((p) => {
        const shape = k.transformed(part.shape, p.motion);
        pending.add(shape);
        return { label: p.label, shape, names: nameFromFaces(part.names.faces.map((n) => `${f.id}:inst${p.label}:${n}`), k.topology(shape)) };
      });
    let current: readonly BodyState[] = set.list;
    const original = new Set(set.list.map((b) => b.shape));
    const drop = (old: readonly BodyState[], now: readonly BodyState[]) => {
      for (const b of old) if (!original.has(b.shape) && !now.some((x) => x.shape === b.shape)) k.release(b.shape);
    };
    try {
      const adds = delta.added ? make(delta.added) : [];
      const cuts = delta.removed ? make(delta.removed) : [];
      this.noOverlap(delta.added?.shape ?? null, adds);
      this.noOverlap(delta.removed?.shape ?? null, cuts);
      for (let i = 0; i < instances.length; i++) {
        const label = instances[i]!.label;
        const at = (run: () => BodyState[]): BodyState[] => {
          try {
            return run();
          } catch (e) {
            if (e instanceof FeatureError && e.message === t('feature.cutRemovedNothing')) throw new FeatureError(t('pattern.instanceMissesBody', { label }));
            throw e;
          }
        };
        if (adds[i]) {
          const tool = adds[i]!;
          pending.delete(tool.shape);
          const next = at(() => this.apply(f.id, 'boss', { shape: tool.shape, faceOrigins: [] }, { featureId: f.id }, current, !delta.newBody, `${f.id}#${label}`, tool.names));
          // an instance of a boss that joined the body must still touch it, or it is a piece floating in space
          if (!delta.newBody && next.length > current.length) {
            drop(current, next);
            current = next;
            throw new FeatureError(t('pattern.instanceFloats', { label }));
          }
          drop(current, next);
          current = next;
        }
        if (cuts[i]) {
          const tool = cuts[i]!;
          pending.delete(tool.shape);
          const next = at(() => this.apply(f.id, 'cut', { shape: tool.shape, faceOrigins: [] }, { featureId: f.id }, current, true, f.id, tool.names));
          drop(current, next);
          current = next;
        }
      }
      return [...current];
    } catch (e) {
      drop(current, []);
      throw e;
    } finally {
      for (const shape of pending) k.release(shape);
    }
  }

  /** The instances of one kind of delta must not run into one another or into the seed's own: the spacing is smaller than what is repeated. */
  private noOverlap(seed: ShapeId | null, tools: { label: string; shape: ShapeId }[]): void {
    const k = this.kernel;
    const all = [...(seed === null ? [] : [{ label: t('pattern.seedLabel'), shape: seed }]), ...tools.map((x) => ({ ...x, label: t('pattern.instanceName', { label: x.label }) }))].map((x) => ({ ...x, box: k.bounds(x.shape) }));
    const eps = 1e-7;
    const apart = (a: { min: Vec3; max: Vec3 }, b: { min: Vec3; max: Vec3 }) => [0, 1, 2].some((i) => a.max[i]! < b.min[i]! + eps || b.max[i]! < a.min[i]! + eps);
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        if (apart(all[i]!.box, all[j]!.box)) continue;
        const r = k.boolean('common', all[i]!.shape, all[j]!.shape);
        const shared = k.massProps(r.shape).volume;
        k.release(r.shape);
        if (shared > 1e-6 * Math.min(k.massProps(all[i]!.shape).volume, k.massProps(all[j]!.shape).volume)) throw new FeatureError(t('pattern.overlap', { a: all[i]!.label, b: all[j]!.label }));
      }
    }
  }

  // ------------------------------------------------------------------ several bodies (C7)

  /**
   * Names a new tool body by how it was swept, then adds it to the bodies (boss) or removes it from them (cut). A boss
   * merges with every body it touches (`merge`, the default) and is a body of its own when it touches none, or when it is
   * not to merge; a cut works on every body it reaches. Faces of a result inherit the names of the faces they came from,
   * on either side. Returns the bodies after the feature; the shapes of those that were changed are new, the old ones are
   * the caller's to let go (`advance`).
   */
  private apply(featureId: Id, op: 'boss' | 'cut', tool: OpResult, context: { featureId: Id; sketchId?: Id }, list: readonly BodyState[], merge: boolean, bodyId: Id = featureId, named?: ElementNames): BodyState[] {
    const k = this.kernel;
    const toolTopology = k.topology(tool.shape);
    const toolNames = named ?? nameElements(tool.faceOrigins, toolTopology, context);
    const made: ShapeId[] = [];
    try {
      if (op === 'cut') {
        const r = this.boolBodies(featureId, 'cut', list, tool.shape, toolNames, made);
        k.release(tool.shape);
        if (!r.changed) throw new FeatureError(t('feature.cutRemovedNothing'));
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

  /**
   * The hole wizard (C4.8): at every free point of the sketch a tool is turned from a profile (straight, counterbored or countersunk, ending flat at
   * its depth or past the body), and cut. Each face of a tool is named for its point and part (`<hole>:side:<sketch>.<point>.wall`, `.cbwall`,
   * `.cbfloor`, `.cone`, `.bottom`), so every face of every hole has a name of its own.
   */
  private hole(f: HoleFeature, sketches: RebuildResult['sketches'], set: Bodies): BodyState[] {
    const s = sketches.get(f.sketch);
    if (!s) throw new FeatureError(t('feature.sketchGone'));
    const body = set.view;
    if (!body) throw new FeatureError(t('feature.needsBody', { what: t('feature.hole') }));
    const used = new Set(s.sketch.entities.flatMap((e) => (e.type === 'line' ? [e.p1, e.p2] : e.type === 'circle' ? [e.center] : e.type === 'arc' ? [e.center, e.start, e.end] : [])));
    const points = s.sketch.entities.flatMap((e) => (e.type === 'point' && !e.construction && !used.has(e.id) && s.solved.geometry.get(e.id)?.type === 'point' ? [{ id: e.id, at: (s.solved.geometry.get(e.id) as { p: [number, number] }).p }] : []));
    if (points.length === 0) throw new FeatureError(t('feature.holeNoPoints'));
    const n = s.frame.normal;
    const down: Vec3 = f.reverse ? n : [-n[0], -n[1], -n[2]];
    const R = evalLength(f.diameter) / 2;
    const depth = f.end.type === 'blind' ? evalLength(f.end.depth) : this.reach(body, s.frame.origin, down) + 1;
    if (depth <= 1e-9) throw new FeatureError(t('feature.nothingThatWay'));
    const lead = 1; // the tool starts this far above the surface so that the cut is clean
    const ring: [number, number][] = [[0, -lead]];
    const edges: string[] = [];
    const step = (r: number, z: number, edge: string) => {
      ring.push([r, z]);
      edges.push(edge);
    };
    if (f.kind === 'counterbore') {
      const Rc = evalLength(f.cbDiameter ?? '0') / 2;
      const cbd = evalLength(f.cbDepth ?? '0');
      if (!(Rc > R) || !(cbd > 0) || cbd >= depth) throw new FeatureError(t('feature.holeCounterbore'));
      step(Rc, -lead, 'top');
      step(Rc, cbd, 'cbwall');
      step(R, cbd, 'cbfloor');
    } else if (f.kind === 'countersink') {
      const Rs = evalLength(f.csDiameter ?? '0') / 2;
      const half = evalAngle(f.csAngle ?? '90deg') / 2;
      const zc = (Rs - R) / Math.tan(half);
      if (!(Rs > R) || zc >= depth) throw new FeatureError(t('feature.holeCountersink'));
      step(Rs, -lead, 'top');
      step(Rs, 0, 'above');
      step(R, zc, 'cone');
    } else {
      step(R, -lead, 'top');
    }
    step(R, depth, 'wall');
    step(0, depth, 'bottom');
    edges.push('axis');
    // the loop counter-clockwise in (radius, depth)
    const area = ring.reduce((a, p, i) => a + (p[0] * ring[(i + 1) % ring.length]![1] - ring[(i + 1) % ring.length]![0] * p[1]), 0);
    let list: readonly BodyState[] = set.list;
    for (const pt of points) {
      const origin = add(add(s.frame.origin, s.frame.xDir, pt.at[0]), s.frame.yDir, pt.at[1]);
      const plane: PlaneFrame = { origin, xDir: s.frame.xDir, yDir: down, normal: cross(s.frame.xDir, down) };
      const loop = ring.map((a, i) => ({ kind: 'line' as const, a, b: ring[(i + 1) % ring.length]!, source: `${pt.id}.${edges[i]!}` }));
      const outer = area >= 0 ? loop : loop.map((l) => ({ ...l, a: l.b, b: l.a })).reverse();
      const tool = this.kernel.revolve(plane, [{ outer, holes: [] }], { origin, dir: down }, 2 * Math.PI);
      try {
        list = this.apply(f.id, 'cut', tool, { featureId: f.id, sketchId: f.sketch }, list, false);
      } catch (e) {
        if (e instanceof FeatureError) throw new FeatureError(t('feature.holeMissed', { id: pt.id }));
        throw e;
      }
    }
    return [...list];
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
