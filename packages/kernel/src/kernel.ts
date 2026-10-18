import { t } from '@3db/i18n';
import type { BRepBuilderAPI_MakeShape, NCollection_List_TopoDS_Shape, TopoDS_Shape, TopoDS_Wire } from 'libcascade/single/init';
import { anyHit, buildBvh, nearestHitAt, triangleNormal } from './rays';
import { forEachSample } from './sampling';
import { escapeStepText } from './stepText';
import { inheritBodySurface } from './sameSurface';
import { planSectionPath } from './sectionPath';
import { sweepVolumeFloor } from './sweepFloor';
import { Arena, loadOcct, ShapeIndex, type LoadOptions, type OC } from './occt';
import {
  KernelError,
  type CurveGeometry,
  type EdgeInfo,
  type FaceInfo,
  type FaceOrigin,
  type Distance,
  type DraftFace,
  type DraftReport,
  type RingSide,
  type ThicknessClass,
  type ThicknessFace,
  type ThicknessReport,
  type ThicknessSpot,
  type UndercutClass,
  type UndercutFace,
  type UndercutReport,
  type GapReport,
  type GeometryReport,
  type ImportDiagnostics,
  type ImportOptions,
  type ImportResult,
  type MassProps,
  type MeshData,
  type StepAssemblyContents,
  type StepAssemblyPrototype,
  type StepComponent,
  type StepExportOptions,
  type MeshOptions,
  type ProjectedView,
  type ViewDirection,
  type OpResult,
  type ShapeId,
  type Topology,
  type Vec3,
  type VertexInfo,
  type SurfaceGeometry,
  type EdgeSample,
  type EdgeSamplingResult,
} from './types';

/** How far a surface made by offsetting may be from the gap asked for (mm): the check of every surface feature (ADR 0067). */
export const SURFACE_TOLERANCE = 0.05;

/** The class of a face from the share of its area seen along +pull, along -pull, and from neither: see `Kernel.undercutAnalysis`. */
function undercutClass(up: number, down: number, blocked: number): Exclude<UndercutClass, 'unknown'> {
  if (blocked >= 0.95) return 'undercut';
  if (blocked > 0.05) return 'partial';
  if (up >= 0.95 && down >= 0.95) return 'both';
  if (up >= 0.95) return 'up';
  if (down >= 0.95) return 'down';
  return 'split';
}

/** The class of a face whose samples run from `min` to `max` (radians) for a required draft: see `Kernel.draftAnalysis`. */
function draftClass(min: number, max: number, required: number): 'positive' | 'negative' | 'required' | 'straddle' {
  if (min >= required) return 'positive';
  if (max <= -required) return 'negative';
  return min < -required && max > required ? 'straddle' : 'required';
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

/**
 * How far an offset is from the gap asked for. With rounded joins (the default) every point of the result is `expected` from the source, so it is the largest
 * difference; with sharp joins the corners are farther by design, so only a result that comes nearer than `expected` is wrong.
 */
const gapError = (gap: GapReport, expected: number, sharp: boolean): number => (sharp ? Math.max(0, expected - gap.min) : gap.deviation);

/** Sketch-plane frame (structurally identical to @3db/model PlaneFrame; the kernel stays dependency-free). */
export interface Frame {
  origin: Vec3;
  xDir: Vec3;
  yDir: Vec3;
  normal: Vec3;
}

type P2 = [number, number];
export type Segment =
  | { kind: 'line'; a: P2; b: P2; source: string }
  | { kind: 'arc'; c: P2; r: number; from: P2; to: P2; ccw: boolean; source: string }
  | { kind: 'circle'; c: P2; r: number; source: string }
  | { kind: 'ellipse'; c: P2; rx: number; ry: number; angle: number; source: string }
  | { kind: 'spline'; points: P2[]; closed: boolean; source: string };

/** Counter-clockwise outer loop with clockwise holes (as produced by @3db/sketch findProfiles). */
export interface Region {
  outer: Segment[];
  holes: Segment[][];
}

/** What a sweep ends on besides its depth: a face of a shape (up to a face), or the surface of a whole body (up to a body). */
export type Until = { target: ShapeId; face: number } | { body: ShapeId };

/** A screw thread (螺牙): see `Kernel.thread`. */
export interface ThreadSpec {
  /** A point on the axis and the way it runs (any length). */
  axis: { origin: Vec3; dir: Vec3 };
  /** From one thread to the next along the axis; the lead (one turn) is pitch × starts. */
  pitch: number;
  /** How many threads run side by side (a whole number from 1). */
  starts: number;
  hand: 'right' | 'left';
  /** The stretch of the axis the thread covers, from `axis.origin` along `axis.dir`; from < to. */
  from: number;
  to: number;
  /** A tapered thread: the half angle of its cone (radians), the profile moving away from the axis along `axis.dir` (towards it when negative). */
  taper?: number;
  /** The whole thread turned about the axis (radians, counter-clockwise about `axis.dir`). */
  phase?: number;
  /** Fade-in turns at the start (tooth height transitions from 0 to full height). */
  fadeTurnsIn?: number;
  /** Fade-out turns at the end (tooth height transitions from full height to 0). */
  fadeTurnsOut?: number;
}

/** Limits of a thread: more starts, a steeper taper or more turns than these is refused, not tried. */
export const THREAD_MAX_STARTS = 16;
export const THREAD_MAX_TAPER = (30 * Math.PI) / 180;
export const THREAD_MAX_TURNS = 400;

/** A knurl (壓花): see `Kernel.knurl`. */
export interface KnurlSpec {
  /** A point on the axis and the way it runs (any length). */
  axis: { origin: Vec3; dir: Vec3 };
  /** The blank's outer radius: the surface the grooves are cut into (half the knurled diameter the drawing gives). */
  radius: number;
  /** How many grooves go round the circumference (a whole number). */
  count: number;
  /** The stretch of the axis the knurl covers, from `axis.origin` along `axis.dir`; from < to. */
  from: number;
  to: number;
  /** How deep a groove cuts in from `radius`. */
  depth: number;
  /** The full angle between a groove's two flanks (radians). */
  included: number;
  /**
   * 'straight' grooves run along the axis; 'helical' runs at `angle` to it, one hand. One call is one hand of grooves: a
   * diamond is both hands, and is cut as two of these in turn — a single tool holding both would have its solids crossing
   * each other, which OCCT does not resolve (see `Kernel.knurl`).
   */
  pattern: 'straight' | 'helical';
  /** The angle of a groove to the axis (radians) for 'helical'; ignored for 'straight'. */
  angle?: number;
  /** Which way a 'helical' groove winds. Default: 'right'. */
  hand?: 'right' | 'left';
  /** The whole pattern turned about the axis (radians, counter-clockwise about `axis.dir`). */
  phase?: number;
}

/** Limits of a knurl: more grooves, a steeper helix, a shallower V or a deeper cut than these is refused, not tried. */
export const KNURL_MIN_GROOVES = 3;
export const KNURL_MAX_GROOVES = 200;
export const KNURL_MAX_ANGLE = (45 * Math.PI) / 180;
export const KNURL_MIN_INCLUDED = (10 * Math.PI) / 180;
export const KNURL_MAX_INCLUDED = (170 * Math.PI) / 180;
/** The most whole turns one groove may be swept over: a knurl needing more is a screw, not a knurl. */
export const KNURL_MAX_TURNS = 40;
/** The most turn-pieces a knurl may be made of (grooves × hands × turns): a finer one is a file, not a knurl. */
export const KNURL_MAX_PIECES = 4000;
/**
 * How far a groove's cutter is carried past the blank, as a share of its depth: the cut has to break the surface, and a
 * cutter that stops exactly on it leaves a face of the tool and a face of the body on the same surface.
 */
export const KNURL_OVERSHOOT = 0.25;

/** One hand of a knurl's grooves, as `Kernel.knurlSet` needs it (everything `Kernel.knurl` has worked out once for both hands). */
interface KnurlSet {
  radius: number;
  count: number;
  from: number;
  to: number;
  depth: number;
  /** Half a groove's width where it leaves the blank (the cutter reaches `KNURL_OVERSHOOT · depth` past it). */
  half: number;
  /** How far out the cutter reaches: `radius` plus the overshoot. */
  reach: number;
  /** The angle of the groove to the axis: 0 for a straight one. */
  angle: number;
  /** +1 for a right hand groove, −1 for a left one. */
  hand: number;
  phase: number;
  /** '' for a single set, 'R' or 'L' for the two hands of a diamond: what tells their faces apart in their names. */
  tag: string;
  /** Whole turns the sweep starts before `from`. */
  back: number;
  /** Whole turns it runs for. */
  turns: number;
}

/** One direction of an extrusion: where it goes, its draft (radians, positive narrows along it) and what it ends on. */
export interface SweepSpec {
  vector: Vec3;
  offset?: number;
  draft?: number;
  until?: Until;
}

const T = {
  FACE: 'TopAbs_FACE',
  EDGE: 'TopAbs_EDGE',
  VERTEX: 'TopAbs_VERTEX',
} as const;

const add = (a: Vec3, b: Vec3, s = 1): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Area-weighted vertex normals. Vertices are per face, so smoothing never crosses a face boundary. */
function smoothNormals(positions: number[], indices: number[], faceRanges: number[]): Float32Array {
  const n = new Float32Array(positions.length);
  for (let r = 0; r < faceRanges.length; r += 3) {
    const end = faceRanges[r]! + faceRanges[r + 1]!;
    for (let t = faceRanges[r]!; t < end; t += 3) {
      const [a, b, c] = [indices[t]! * 3, indices[t + 1]! * 3, indices[t + 2]! * 3];
      const ux = positions[b]! - positions[a]!, uy = positions[b + 1]! - positions[a + 1]!, uz = positions[b + 2]! - positions[a + 2]!;
      const vx = positions[c]! - positions[a]!, vy = positions[c + 1]! - positions[a + 1]!, vz = positions[c + 2]! - positions[a + 2]!;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const v of [a, b, c]) {
        n[v] = n[v]! + nx;
        n[v + 1] = n[v + 1]! + ny;
        n[v + 2] = n[v + 2]! + nz;
      }
    }
  }
  for (let i = 0; i < n.length; i += 3) {
    const len = Math.hypot(n[i]!, n[i + 1]!, n[i + 2]!) || 1;
    n[i] = n[i]! / len;
    n[i + 1] = n[i + 1]! / len;
    n[i + 2] = n[i + 2]! / len;
  }
  return n;
}

/** The distance from a point to a polyline (x, y, x, y …). */
function distanceToPolyline(x: number, y: number, line: readonly number[]): number {
  let best = Infinity;
  for (let i = 0; i + 3 < line.length; i += 2) {
    const ax = line[i]!;
    const ay = line[i + 1]!;
    const dx = line[i + 2]! - ax;
    const dy = line[i + 3]! - ay;
    const len2 = dx * dx + dy * dy;
    const s = len2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(x - (ax + s * dx), y - (ay + s * dy)));
  }
  return best;
}

/** Whether a polyline lies wholly on others (within `eps`): its points, and the middle of each of its pieces, are on one of them. */
function lyingOn(line: readonly number[], others: readonly (readonly number[])[], eps: number): boolean {
  const samples: [number, number][] = [];
  for (let i = 0; i < line.length; i += 2) {
    samples.push([line[i]!, line[i + 1]!]);
    if (i + 3 < line.length) samples.push([(line[i]! + line[i + 2]!) / 2, (line[i + 1]! + line[i + 3]!) / 2]);
  }
  return samples.every(([x, y]) => others.some((o) => distanceToPolyline(x, y, o) <= eps));
}

/**
 * Coarse-grained facade over OCCT (A1). Every operation reports face provenance so the naming
 * layer can build persistent names (A1.8). Callers own returned shapes and must release them.
 */
export class Kernel {
  private shapes = new Map<ShapeId, TopoDS_Shape>();
  private nextId = 1;
  private fileSeq = 0;

  private constructor(readonly oc: OC) {}

  static async load(options: LoadOptions = {}): Promise<Kernel> {
    return new Kernel(await loadOcct(options));
  }

  // ------------------------------------------------------------------ handles

  private put(shape: TopoDS_Shape): ShapeId {
    const id = this.nextId++ as ShapeId;
    this.shapes.set(id, shape);
    return id;
  }

  private get(id: ShapeId): TopoDS_Shape {
    const s = this.shapes.get(id);
    if (!s) throw new KernelError(t('kernel.handleReleased', { id }));
    return s;
  }

  /** A point as a shape (a vertex), so that the exact distance can be measured from it to anything (E1.1); the caller releases it. */
  makeVertex(p: Vec3): ShapeId {
    const arena = new Arena();
    try {
      const made = arena.own(new this.oc.BRepBuilderAPI_MakeVertex(this.pnt(arena, p)));
      const vertex = arena.own(made.Vertex());
      return this.put(vertex.Oriented(vertex.Orientation())); // a handle of its own: the arena lets go of the ones above
    } finally {
      arena.dispose();
    }
  }

  /** A second handle to the same shape: releasing either leaves the other intact. */
  copy(id: ShapeId): ShapeId {
    const s = this.get(id);
    return this.put(s.Oriented(s.Orientation()));
  }

  release(id: ShapeId): void {
    this.shapes.get(id)?.delete();
    this.shapes.delete(id);
  }

  get liveShapes(): number {
    return this.shapes.size;
  }

  // ------------------------------------------------------------------ helpers

  private errorText(e: unknown): string {
    if (typeof WebAssembly !== 'undefined' && 'Exception' in WebAssembly && e instanceof WebAssembly.Exception) {
      try {
        const [type, message] = this.oc.getExceptionMessage(e);
        return message ? `${type}: ${message}` : type;
      } catch {
        return t('kernel.occtException');
      }
    }
    return e instanceof Error ? e.message : String(e);
  }

  private build(mk: BRepBuilderAPI_MakeShape, label: string, arena: Arena): TopoDS_Shape {
    try {
      mk.Build(arena.own(new this.oc.Message_ProgressRange()));
    } catch (e) {
      throw new KernelError(t('kernel.opFailedWhy', { label, why: this.errorText(e) }));
    }
    if (!mk.IsDone()) throw new KernelError(t('kernel.opFailed', { label }));
    return mk.Shape();
  }

  /** Drains an OCCT list into an array (copy first: the list may alias algorithm-internal storage). */
  private list(list: NCollection_List_TopoDS_Shape): TopoDS_Shape[] {
    const copy = new this.oc.NCollection_List_TopoDS_Shape(list);
    const out: TopoDS_Shape[] = [];
    while (!copy.IsEmpty()) {
      out.push(copy.First());
      copy.RemoveFirst();
    }
    copy.delete();
    list.delete();
    return out;
  }

  private pnt(arena: Arena, p: Vec3) {
    return arena.own(new this.oc.gp_Pnt(p[0], p[1], p[2]));
  }

  private dir(arena: Arena, v: Vec3) {
    return arena.own(new this.oc.gp_Dir(arena.own(new this.oc.gp_Vec(v[0], v[1], v[2]))));
  }

  private xyz(p: { X(): number; Y(): number; Z(): number }): Vec3 {
    return [p.X(), p.Y(), p.Z()];
  }

  // ------------------------------------------------------------------ modelling

  private wire(arena: Arena, frame: Frame, loop: Segment[], hole: boolean, sources: Map<TopoDS_Shape, string>): TopoDS_Wire {
    const oc = this.oc;
    const at = (p: P2): Vec3 => add(add(frame.origin, frame.xDir, p[0]), frame.yDir, p[1]);
    const circ = (c: P2, r: number) =>
      arena.own(new oc.gp_Circ(arena.own(new oc.gp_Ax2(this.pnt(arena, at(c)), this.dir(arena, frame.normal), this.dir(arena, frame.xDir))), r));
    const mw = arena.own(new oc.BRepBuilderAPI_MakeWire());
    for (const seg of loop) {
      let edge;
      if (seg.kind === 'line') {
        edge = arena.own(arena.own(new oc.BRepBuilderAPI_MakeEdge(this.pnt(arena, at(seg.a)), this.pnt(arena, at(seg.b)))).Edge());
      } else if (seg.kind === 'circle') {
        edge = arena.own(arena.own(new oc.BRepBuilderAPI_MakeEdge(circ(seg.c, seg.r))).Edge());
        if (hole) edge = arena.own(oc.TopoDS.Edge(arena.own(edge.Reversed())));
      } else if (seg.kind === 'ellipse') {
        let { rx, ry, angle } = seg;
        if (!(rx > 0 && ry > 0 && Number.isFinite(rx) && Number.isFinite(ry) && Number.isFinite(angle))) {
          throw new KernelError(t('kernel.wireNotClosed', { source: seg.source }));
        }
        if (rx < ry) {
          const tmp = rx;
          rx = ry;
          ry = tmp;
          angle += Math.PI / 2;
        }
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const majorDirVec: Vec3 = [
          frame.xDir[0] * cos + frame.yDir[0] * sin,
          frame.xDir[1] * cos + frame.yDir[1] * sin,
          frame.xDir[2] * cos + frame.yDir[2] * sin,
        ];
        const ax2 = arena.own(new oc.gp_Ax2(this.pnt(arena, at(seg.c)), this.dir(arena, frame.normal), this.dir(arena, majorDirVec)));
        const elips = arena.own(new oc.gp_Elips(ax2, rx, ry));
        edge = arena.own(arena.own(new oc.BRepBuilderAPI_MakeEdge(elips)).Edge());
        if (hole) edge = arena.own(oc.TopoDS.Edge(arena.own(edge.Reversed())));
      } else if (seg.kind === 'spline') {
        const pts = seg.points;
        if (pts.length < 2) {
          throw new KernelError(t('kernel.wireNotClosed', { source: seg.source }));
        }
        for (let i = 0; i < pts.length - 1; i++) {
          const pA = pts[i]!;
          const pB = pts[i + 1]!;
          if (Math.hypot(pB[0] - pA[0], pB[1] - pA[1]) < 1e-6) {
            throw new KernelError(t('kernel.wireNotClosed', { source: seg.source }));
          }
        }
        if (seg.closed && pts.length >= 3) {
          const pFirst = pts[0]!;
          const pLast = pts[pts.length - 1]!;
          if (Math.hypot(pLast[0] - pFirst[0], pLast[1] - pFirst[1]) < 1e-6) {
            throw new KernelError(t('kernel.wireNotClosed', { source: seg.source }));
          }
        }
        const totalPts = seg.closed ? pts.length + 1 : pts.length;
        const arr = arena.own(new oc.NCollection_Array1_gp_Pnt(1, totalPts));
        for (let i = 0; i < pts.length; i++) {
          arr.SetValue(i + 1, this.pnt(arena, at(pts[i]!)));
        }
        if (seg.closed) {
          arr.SetValue(totalPts, this.pnt(arena, at(pts[0]!)));
        }
        const approx = arena.own(new oc.GeomAPI_PointsToBSpline(arr));
        if (!approx.IsDone()) {
          throw new KernelError(t('kernel.wireNotClosed', { source: seg.source }));
        }
        edge = arena.own(arena.own(new oc.BRepBuilderAPI_MakeEdge(approx.Curve())).Edge());
        if (hole) edge = arena.own(oc.TopoDS.Edge(arena.own(edge.Reversed())));
      } else {
        const [p, q] = seg.ccw ? [seg.from, seg.to] : [seg.to, seg.from];
        edge = arena.own(arena.own(new oc.BRepBuilderAPI_MakeEdge(circ(seg.c, seg.r), this.pnt(arena, at(p)), this.pnt(arena, at(q)))).Edge());
        if (!seg.ccw) edge = arena.own(oc.TopoDS.Edge(arena.own(edge.Reversed())));
      }
      mw.Add(edge);
      if (!mw.IsDone()) throw new KernelError(t('kernel.wireNotClosed', { source: seg.source }));
      sources.set(arena.own(mw.Edge()), seg.source);
    }
    return arena.own(mw.Wire());
  }

  /** Faces (a compound when several) bounded by the sketch regions; `sources` maps wire edges to sketch entities. */
  private profile(arena: Arena, frame: Frame, regions: Region[], sources: Map<TopoDS_Shape, string>): TopoDS_Shape {
    const oc = this.oc;
    const plane = arena.own(
      new oc.gp_Pln(arena.own(new oc.gp_Ax3(this.pnt(arena, frame.origin), this.dir(arena, frame.normal), this.dir(arena, frame.xDir)))),
    );
    const faces = regions.map((r) => {
      const mf = arena.own(new oc.BRepBuilderAPI_MakeFace(plane, this.wire(arena, frame, r.outer, false, sources), true));
      for (const h of r.holes) mf.Add(this.wire(arena, frame, h, true, sources));
      if (!mf.IsDone()) throw new KernelError(t('kernel.noFace'));
      return arena.own(mf.Face());
    });
    if (faces.length === 1) return faces[0]!;
    const compound = arena.own(new oc.TopoDS_Compound());
    const builder = arena.own(new oc.TopoDS_Builder());
    builder.MakeCompound(compound);
    for (const face of faces) builder.Add(compound, face);
    return compound;
  }

  /** Provenance of a sweep (prism or revolution): side faces from profile edges, caps from the first/last profile. */
  /**
   * `swept` is the sweep's own record of what a profile edge generated. It is needed for full
   * revolutions: there BRepPrimAPI_MakeRevol.Generated returns nothing for edges square to the axis,
   * although the planar faces they sweep are in the result, and those faces would lose their names.
   */
  private sweepOrigins(
    mk: { Generated(s: TopoDS_Shape): NCollection_List_TopoDS_Shape; FirstShape(): TopoDS_Shape; LastShape(): TopoDS_Shape },
    out: TopoDS_Shape,
    sources: Map<TopoDS_Shape, string>,
    arena: Arena,
    swept?: (edge: TopoDS_Shape) => TopoDS_Shape | null,
  ): FaceOrigin[][] {
    const oc = this.oc;
    const outFaces = ShapeIndex.of(oc, out, T.FACE, arena);
    try {
      const origins: FaceOrigin[][] = outFaces.keys.map(() => []);
      const same = (a: FaceOrigin, b: FaceOrigin) => JSON.stringify(a) === JSON.stringify(b);
      const mark = (shapes: TopoDS_Shape[], origin: FaceOrigin) => {
        for (const s of shapes) {
          const i = outFaces.indexOf(s);
          if (i >= 0 && !origins[i]!.some((o) => same(o, origin))) origins[i]!.push(origin);
          s.delete();
        }
      };
      for (const [edge, source] of sources) {
        const origin: FaceOrigin = { rel: 'generated', kind: 'profileEdge', source };
        mark(this.list(mk.Generated(edge)), origin);
        const s = swept?.(edge);
        if (s) mark([s], origin);
      }
      const caps = (shape: TopoDS_Shape, which: 'start' | 'end') => {
        const idx = ShapeIndex.of(oc, shape, T.FACE, arena);
        mark(idx.keys.splice(0), { rel: 'cap', which });
        shape.delete();
      };
      caps(mk.FirstShape(), 'start');
      caps(mk.LastShape(), 'end');
      return origins;
    } finally {
      outFaces.dispose();
    }
  }

  /**
   * One sweep of the profile (C4.1): the tool shape (the caller deletes it) and the origins of its faces. Side faces originate from profile
   * edges (tagged with their sketch entity), caps from start/end. With a draft the side faces lean, then with `until` the sweep, made long
   * enough to pass it, ends on the surface of a face of `until.target` (up to a face) or of the whole body `until.body`
   * (up to a body); what it gains from that surface is the end cap.
   */
  private sweep(frame: Frame, regions: Region[], spec: SweepSpec, arena: Arena): { shape: TopoDS_Shape; origins: FaceOrigin[][] } {
    if (regions.length === 0) throw new KernelError(t('kernel.noExtrudeRegion'));
    const oc = this.oc;
    const f: Frame = { ...frame, origin: add(frame.origin, frame.normal, spec.offset ?? 0) };
    const sources = new Map<TopoDS_Shape, string>();
    const profile = this.profile(arena, f, regions, sources);
    const vec = arena.own(new oc.gp_Vec(spec.vector[0], spec.vector[1], spec.vector[2]));
    const mk = arena.own(new oc.BRepPrimAPI_MakePrism(profile, vec, false, true));
    let out = this.build(mk, t('feature.extrude'), arena);
    let origins = this.sweepOrigins(mk, out, sources, arena);
    if (spec.draft) {
      const sides = origins.flatMap((o, i) => (o.some((x) => x.rel === 'generated' && x.kind === 'profileEdge') ? [i] : []));
      const drafted = this.draftFaces(out, origins, sides, spec.vector, { origin: f.origin, normal: f.normal }, spec.draft, arena);
      out.delete();
      out = drafted.shape;
      origins = drafted.origins;
    }
    if (!spec.until) return { shape: out, origins };
    try {
      return 'body' in spec.until ? this.trimAtBody(out, origins, spec.until.body, spec.vector, arena) : this.trimAtFace(out, origins, spec.until, spec.vector, arena);
    } finally {
      out.delete();
    }
  }

  /** Extrudes sketch regions along `vector`, starting `offset` along the plane normal; `draft` leans the walls (radians, positive narrows along the sweep). */
  extrude(frame: Frame, regions: Region[], vector: Vec3, offset = 0, until?: Until, draft?: number): OpResult {
    const arena = new Arena();
    try {
      const r = this.sweep(frame, regions, { vector, offset, ...(until ? { until } : {}), ...(draft ? { draft } : {}) }, arena);
      return { shape: this.put(r.shape), faceOrigins: r.origins };
    } finally {
      arena.dispose();
    }
  }

  /**
   * Two sweeps from the same profile, one each way (direction 2, C4.1): fused into one body, the plane they share gone, coplanar walls merged
   * (and so named by the profile edge both came from).
   */
  extrudeBoth(frame: Frame, regions: Region[], first: SweepSpec, second: SweepSpec): OpResult {
    const oc = this.oc;
    const arena = new Arena();
    const a = this.sweep(frame, regions, first, arena);
    let b: { shape: TopoDS_Shape; origins: FaceOrigin[][] } | null = null;
    try {
      b = this.sweep(frame, regions, second, arena);
      const fa = ShapeIndex.of(oc, a.shape, T.FACE, arena);
      const fb = ShapeIndex.of(oc, b.shape, T.FACE, arena);
      try {
        const mk = this.boolOp('fuse', a.shape, b.shape, t('feature.extrude'), arena);
        const raw = mk.Shape();
        try {
          const sources = this.faceSources(mk, [...fa.keys, ...fb.keys], raw, arena);
          // the second direction's far cap is the start of the feature, as seen from the first
          const swap = (o: FaceOrigin): FaceOrigin => (o.rel === 'cap' ? { rel: 'cap', which: o.which === 'end' ? 'start' : 'end' } : o);
          const all = [...a.origins, ...b.origins.map((o) => o.map(swap))];
          const unified = this.unify(raw, sources.map((s) => s.flatMap((i) => all[i]!)), arena);
          return { shape: this.put(unified.shape), faceOrigins: unified.origins };
        } finally {
          raw.delete();
        }
      } finally {
        fa.dispose();
        fb.dispose();
      }
    } finally {
      a.shape.delete();
      b?.shape.delete();
      arena.dispose();
    }
  }

  /**
   * Leans faces of a shape (draft, C5.5): each of `faces` about its intersection with the neutral plane, pulled along `pull`; a positive angle
   * makes the shape narrower further along `pull`. A face that cannot lean is an error, never skipped. The result is the caller's.
   */
  private draftFaces(
    shape: TopoDS_Shape,
    origins: FaceOrigin[][],
    faces: number[],
    pull: Vec3,
    neutral: { origin: Vec3; normal: Vec3 },
    angle: number,
    arena: Arena,
  ): { shape: TopoDS_Shape; origins: FaceOrigin[][] } {
    const oc = this.oc;
    const index = ShapeIndex.of(oc, shape, T.FACE, arena);
    try {
      const mk = arena.own(new oc.BRepOffsetAPI_DraftAngle(shape));
      const direction = this.dir(arena, pull);
      const plane = arena.own(new oc.gp_Pln(this.pnt(arena, neutral.origin), this.dir(arena, neutral.normal)));
      for (const i of faces) {
        const face = arena.own(oc.TopoDS.Face(index.keys[i]!));
        mk.Add(face, direction, angle, plane, true);
        if (!mk.AddDone()) throw new KernelError(t('feature.draftFailed', { index: i }));
      }
      const out = this.build(mk, t('feature.draft'), arena);
      if (!this.valid(out)) {
        out.delete();
        throw new KernelError(t('feature.draftInvalid'));
      }
      // a leaned face is a new face: ModifiedShape says which one it became
      const outFaces = ShapeIndex.of(oc, out, T.FACE, arena);
      try {
        const next: FaceOrigin[][] = outFaces.keys.map(() => []);
        index.keys.forEach((f, i) => {
          const m = mk.ModifiedShape(f);
          const j = Math.max(outFaces.indexOf(m), outFaces.indexOf(f));
          m.delete();
          if (j >= 0) next[j]!.push(...(origins[i] ?? []));
        });
        return { shape: out, origins: next };
      } finally {
        outFaces.dispose();
      }
    } finally {
      index.dispose();
    }
  }

  /** Cuts a sweep off at the (unbounded) surface of a target face; faces it gains from that surface are the end cap. */
  private trimAtFace(tool: TopoDS_Shape, origins: FaceOrigin[][], until: { target: ShapeId; face: number }, vector: Vec3, arena: Arena): { shape: TopoDS_Shape; origins: FaceOrigin[][] } {
    const oc = this.oc;
    const targetFaces = ShapeIndex.of(oc, this.get(until.target), T.FACE, arena);
    try {
      const key = targetFaces.keys[until.face];
      if (!key) throw new KernelError(t('edit.faceOutOfRange', { index: until.face }));
      const face = arena.own(oc.TopoDS.Face(key));
      const props = arena.own(new oc.GProp_GProps());
      oc.BRepGProp.SurfaceProperties(face, props, false, false);
      const center = this.xyz(arena.own(props.CentreOfMass()));
      const len = Math.hypot(...vector) || 1;
      // A point just beyond the face along the extrusion: the half-space on that side is removed.
      const beyond = add(center, vector, Math.max(1e-3, 1e-5 * len) / len);
      // Bounded by the face's whole underlying surface (a plane is unbounded), not by the face itself:
      // a half-space made from the finite face would only trim profiles lying right under it.
      const surface = arena.own(oc.BRep_Tool.Surface(face));
      const unbounded = arena.own(arena.own(new oc.BRepBuilderAPI_MakeFace(surface, 1e-7)).Face());
      const halfSpace = arena.own(arena.own(new oc.BRepPrimAPI_MakeHalfSpace(unbounded, this.pnt(arena, beyond))).Solid());
      const toolFaces = ShapeIndex.of(oc, tool, T.FACE, arena);
      const cutterFaces = ShapeIndex.of(oc, halfSpace, T.FACE, arena);
      try {
        const cut = this.boolOp('cut', tool, halfSpace, t('feature.upToFace'), arena);
        const out = cut.Shape();
        const n = toolFaces.size;
        const sources = this.faceSources(cut, [...toolFaces.keys, ...cutterFaces.keys], out, arena);
        if (!sources.some((s) => s.some((i) => i >= n))) {
          out.delete();
          throw new KernelError(t('kernel.extrudeNotReached'));
        }
        const trimmed = sources.map((s) => s.flatMap((i): FaceOrigin[] => (i < n ? origins[i]! : [{ rel: 'cap', which: 'end' }])));
        return { shape: out, origins: trimmed };
      } finally {
        toolFaces.dispose();
        cutterFaces.dispose();
      }
    } finally {
      targetFaces.dispose();
    }
  }

  /**
   * Cuts a sweep off at the surface of a whole body (up to a body): the sweep minus the body, and of what is left the piece the sketch is on.
   * What it gains from the body's surface is the end cap.
   */
  private trimAtBody(tool: TopoDS_Shape, origins: FaceOrigin[][], body: ShapeId, vector: Vec3, arena: Arena): { shape: TopoDS_Shape; origins: FaceOrigin[][] } {
    const oc = this.oc;
    const target = this.get(body);
    const toolFaces = ShapeIndex.of(oc, tool, T.FACE, arena);
    const bodyFaces = ShapeIndex.of(oc, target, T.FACE, arena);
    try {
      const cut = this.boolOp('cut', tool, target, t('feature.upToBody'), arena);
      const raw = cut.Shape();
      const n = toolFaces.size;
      const sources = this.faceSources(cut, [...toolFaces.keys, ...bodyFaces.keys], raw, arena);
      if (!sources.some((s) => s.some((i) => i >= n))) {
        raw.delete();
        throw new KernelError(t('feature.bodyNotReached'));
      }
      const all = sources.map((s) => s.flatMap((i): FaceOrigin[] => (i < n ? origins[i]! : [{ rel: 'cap', which: 'end' }])));
      // beyond the body the cut may leave more pieces: the one nearest the start of the sweep is the feature
      const whole = this.put(raw);
      const pieces = this.splitSolids({ shape: whole, faceOrigins: all });
      this.release(whole);
      const len = Math.hypot(...vector) || 1;
      const along = (id: ShapeId) => {
        const { min, max } = this.bounds(id);
        let near = Infinity;
        for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) near = Math.min(near, (x * vector[0] + y * vector[1] + z * vector[2]) / len);
        return near;
      };
      const chosen = pieces.reduce((best, p) => (along(p.shape) < along(best.shape) - 1e-9 ? p : best));
      for (const p of pieces) if (p !== chosen) this.release(p.shape);
      const piece = this.get(chosen.shape);
      this.shapes.delete(chosen.shape); // the shape is the caller's now
      return { shape: piece, origins: chosen.faceOrigins };
    } finally {
      toolFaces.dispose();
      bodyFaces.dispose();
    }
  }

  /**
   * The face of `target` a sweep meets first (up to the next face, ADR 0017 section 5): the sweep is intersected with the body, and of the faces the
   * intersection takes from the body's, the nearest one beyond the start. Null when there is none in the way.
   */
  nextFace(target: ShapeId, frame: Frame, regions: Region[], vector: Vec3): number | null {
    const oc = this.oc;
    const arena = new Arena();
    const swept = this.sweep(frame, regions, { vector }, arena);
    const body = this.get(target);
    const toolFaces = ShapeIndex.of(oc, swept.shape, T.FACE, arena);
    const bodyFaces = ShapeIndex.of(oc, body, T.FACE, arena);
    try {
      let raw: TopoDS_Shape;
      let sources: number[][];
      try {
        const common = this.boolOp('common', swept.shape, body, t('feature.upToNext'), arena);
        raw = common.Shape();
        sources = this.faceSources(common, [...toolFaces.keys, ...bodyFaces.keys], raw, arena);
      } catch (e) {
        if (e instanceof KernelError) return null; // nothing in common: nothing in the way
        throw e;
      }
      const outFaces = ShapeIndex.of(oc, raw, T.FACE, arena);
      try {
        const len = Math.hypot(...vector) || 1;
        const start = (frame.origin[0] * vector[0] + frame.origin[1] * vector[1] + frame.origin[2] * vector[2]) / len;
        let best: { face: number; at: number } | null = null;
        outFaces.keys.forEach((f, k) => {
          const fromBody = sources[k]!.filter((i) => i >= toolFaces.size).map((i) => i - toolFaces.size);
          if (fromBody.length === 0) return;
          const props = arena.own(new oc.GProp_GProps());
          oc.BRepGProp.SurfaceProperties(f, props, false, false);
          const c = this.xyz(arena.own(props.CentreOfMass()));
          const at = (c[0] * vector[0] + c[1] * vector[1] + c[2] * vector[2]) / len - start;
          if (at > 1e-6 && (!best || at < best.at)) best = { face: fromBody[0]!, at };
        });
        return (best as { face: number } | null)?.face ?? null;
      } finally {
        outFaces.dispose();
        raw.delete();
      }
    } finally {
      swept.shape.delete();
      toolFaces.dispose();
      bodyFaces.dispose();
      arena.dispose();
    }
  }

  /**
   * Revolves sketch regions about an axis by `angle` radians, counter-clockwise about `axis.dir` (C4.3).
   * Naming like an extrusion: side faces from profile edges, caps where the revolution starts and ends.
   */
  revolve(frame: Frame, regions: Region[], axis: { origin: Vec3; dir: Vec3 }, angle: number): OpResult {
    if (regions.length === 0) throw new KernelError(t('kernel.noRevolveRegion'));
    const oc = this.oc;
    const arena = new Arena();
    try {
      const sources = new Map<TopoDS_Shape, string>();
      const profile = this.profile(arena, frame, regions, sources);
      const ax = arena.own(new oc.gp_Ax1(this.pnt(arena, axis.origin), this.dir(arena, axis.dir)));
      // Four arguments on purpose: with three, arity dispatch cannot tell (angle) from (copy).
      const mk = arena.own(new oc.BRepPrimAPI_MakeRevol(profile, ax, angle, false));
      const out = this.build(mk, t('feature.revolve'), arena);
      const sweep = arena.own(mk.Revol());
      const swept = (edge: TopoDS_Shape) => {
        const s = sweep.Shape(edge);
        if (!s.IsNull()) return s;
        s.delete();
        return null; // an edge on the axis sweeps nothing
      };
      return { shape: this.put(out), faceOrigins: this.sweepOrigins(mk, out, sources, arena, swept) };
    } finally {
      arena.dispose();
    }
  }

  /**
   * Sweeps sketch regions along a path of lines and arcs (C4.4, 掃出). `path` is in the plane of `pathFrame`, in the order it is walked; the
   * profile is where it is, on the plane of `frame` at the start of the path, and keeps its angle to the path ("follow path", a corrected Frenet
   * trihedron, which has no twist where the path turns the other way or runs straight). A side face is named for the profile edge and the path
   * edge that made it, `<profile source>@<path source>`; the ends are caps. A region with holes is its outer outline swept, less each hole swept.
   */
  sweepAlongPath(frame: Frame, regions: Region[], pathFrame: Frame, path: Segment[]): OpResult {
    if (regions.length === 0) throw new KernelError(t('feature.sweepNoProfile'));
    if (path.length === 0) throw new KernelError(t('feature.sweepNoPath'));
    const oc = this.oc;
    const arena = new Arena();
    try {
      const pathSources = new Map<TopoDS_Shape, string>();
      const spine = this.wire(arena, pathFrame, path, false, pathSources);
      const parts = regions.map((region) => this.sweepRegion(frame, region, spine, pathSources, arena));
      let whole = parts[0]!;
      if (parts.length > 1) {
        // separate regions are separate solids of one compound; a face keeps what its own sweep said it was
        const compound = arena.own(new oc.TopoDS_Compound());
        const builder = arena.own(new oc.TopoDS_Builder());
        builder.MakeCompound(compound);
        for (const p of parts) builder.Add(compound, p.shape);
        const index = ShapeIndex.of(oc, compound, T.FACE, arena);
        const origins: FaceOrigin[][] = index.keys.map(() => []);
        for (const p of parts) {
          const own = ShapeIndex.of(oc, p.shape, T.FACE, arena);
          own.keys.forEach((face, i) => {
            const j = index.indexOf(face);
            if (j >= 0) origins[j]!.push(...(p.origins[i] ?? []));
          });
          own.dispose();
        }
        index.dispose();
        whole = { shape: compound, origins };
      }
      if (!this.valid(whole.shape)) throw new KernelError(t('feature.sweepInvalid'));
      const id = this.put(whole.shape.Oriented(whole.shape.Orientation()));
      if (!(this.massProps(id).volume > 1e-9)) {
        this.release(id);
        throw new KernelError(t('feature.sweepInvalid'));
      }
      // a solid that is "valid" and yet folded over itself holds far less than the profile times the path
      const { floor } = sweepVolumeFloor(frame, regions, pathFrame, path);
      const volume = this.massProps(id).volume;
      if (volume < floor) {
        this.release(id);
        throw new KernelError(t('feature.sweepOverlap', { volume: volume.toFixed(1), floor: floor.toFixed(1) }));
      }
      return { shape: id, faceOrigins: whole.origins };
    } finally {
      arena.dispose();
    }
  }

  /** One region swept along `spine`: its outline, less its holes (each swept in the same way). The shape is the arena's. */
  private sweepRegion(frame: Frame, region: Region, spine: TopoDS_Wire, pathSources: Map<TopoDS_Shape, string>, arena: Arena): { shape: TopoDS_Shape; origins: FaceOrigin[][] } {
    const oc = this.oc;
    const one = (loop: Segment[], hole: boolean) => {
      const sources = new Map<TopoDS_Shape, string>();
      const wire = this.wire(arena, frame, loop, hole, sources);
      const mk = arena.own(new oc.BRepOffsetAPI_MakePipeShell(spine));
      mk.SetMode(false); // corrected Frenet
      mk.Add(wire, false, false);
      try {
        mk.Build(arena.own(new oc.Message_ProgressRange()));
        if (!mk.IsReady() || !mk.MakeSolid()) throw new KernelError(t('feature.sweepFailed', { why: t('feature.sweepNoSolid') }));
      } catch (e) {
        if (e instanceof KernelError) throw e;
        throw new KernelError(t('feature.sweepFailed', { why: this.errorText(e) }));
      }
      const shape = arena.own(mk.Shape());
      return { shape, origins: this.pipeOrigins(mk, shape, sources, pathSources, arena) };
    };
    let acc = one(region.outer, false);
    for (const hole of region.holes) {
      const tool = one(hole, true);
      const fa = ShapeIndex.of(oc, acc.shape, T.FACE, arena);
      const fb = ShapeIndex.of(oc, tool.shape, T.FACE, arena);
      const mk = this.boolOp('cut', acc.shape, tool.shape, t('feature.sweep'), arena);
      const raw = arena.own(mk.Shape());
      const sources = this.faceSources(mk, [...fa.keys, ...fb.keys], raw, arena);
      const all = [...acc.origins, ...tool.origins];
      fa.dispose();
      fb.dispose();
      acc = { shape: raw, origins: sources.map((s) => s.flatMap((i) => all[i]!)) };
    }
    return acc;
  }

  /** Where the faces of a pipe shell came from: a side face from a profile edge and a path edge (both must have made it), the ends from the first and last sections. */
  private pipeOrigins(mk: { Generated(s: TopoDS_Shape): NCollection_List_TopoDS_Shape; FirstShape(): TopoDS_Shape; LastShape(): TopoDS_Shape }, out: TopoDS_Shape, profile: Map<TopoDS_Shape, string>, path: Map<TopoDS_Shape, string>, arena: Arena): FaceOrigin[][] {
    const oc = this.oc;
    const faces = ShapeIndex.of(oc, out, T.FACE, arena);
    const origins: FaceOrigin[][] = faces.keys.map(() => []);
    /** The faces of `out` an edge made. */
    const made = (edge: TopoDS_Shape): Set<number> => {
      const set = new Set<number>();
      for (const s of this.list(mk.Generated(edge))) {
        const i = faces.indexOf(s);
        if (i >= 0) set.add(i);
        s.delete();
      }
      return set;
    };
    const byPath = [...path].map(([edge, source]) => ({ source, faces: made(edge) }));
    for (const [edge, source] of profile) {
      const mine = made(edge);
      for (const i of mine) {
        const along = byPath.filter((p) => p.faces.has(i));
        // a face no path edge claims is named for its profile edge alone: never nameless
        if (along.length === 0) origins[i]!.push({ rel: 'generated', kind: 'profileEdge', source });
        for (const p of along) origins[i]!.push({ rel: 'generated', kind: 'profileEdge', source: `${source}@${p.source}` });
      }
    }
    for (const [shape, which] of [[mk.FirstShape(), 'start'], [mk.LastShape(), 'end']] as const) {
      const ends = ShapeIndex.of(oc, shape, T.FACE, arena);
      for (const f of ends.keys) {
        const i = faces.indexOf(f);
        if (i >= 0) origins[i]!.push({ rel: 'cap', which });
      }
      ends.dispose();
      shape.delete();
    }
    faces.dispose();
    return origins;
  }

  /**
   * The tool of a screw thread (螺牙): the regions of a sketch whose plane holds the axis, carried round the axis in a screw motion (`pitch` × `starts`
   * along the axis per turn), one copy per start turned 360°/`starts` from the next, the whole turned by `phase` (counter-clockwise about `axis.dir`),
   * and cut off square to the axis at `from` and `to` (measured from `axis.origin` along `axis.dir`). The profile is where the sketch has it: the thread
   * runs through it. With `taper` (the half angle of a cone, radians) the profile moves away from the axis by tan(taper) per unit along the axis.
   *
   * How: the profile, moved back whole turns until it lies before `from`, is swept along a helix on a cylinder or cone about the axis with the binormal
   * held along the axis (the profile stays in a plane through the axis), for whole turns until it lies past `to`; a common with a cylinder from `from` to
   * `to` cuts it to length. The helix has one edge per turn, so a side face is one turn of one profile edge, named `<profile source>@helix<start>:<turn>`
   * (turn 0 is the one the profile is drawn in, counting on along the axis); the faces on the planes at `from` and `to` are the start and end caps.
   */
  thread(frame: Frame, regions: Region[], spec: ThreadSpec): OpResult {
    if (regions.length === 0) throw new KernelError(t('feature.threadNoProfile'));
    const { pitch, starts, from, to } = spec;
    const taper = spec.taper ?? 0;
    const phase = spec.phase ?? 0;
    const fadeTurnsIn = spec.fadeTurnsIn ?? 0;
    const fadeTurnsOut = spec.fadeTurnsOut ?? 0;
    if (!(Number.isFinite(pitch) && pitch > 0)) throw new KernelError(t('feature.threadBadPitch'));
    if (!(Number.isInteger(starts) && starts >= 1 && starts <= THREAD_MAX_STARTS)) throw new KernelError(t('feature.threadBadStarts', { max: String(THREAD_MAX_STARTS) }));
    if (!(Number.isFinite(from) && Number.isFinite(to) && to > from)) throw new KernelError(t('feature.threadBadLength'));
    if (!(Number.isFinite(taper) && Math.abs(taper) <= THREAD_MAX_TAPER)) throw new KernelError(t('feature.threadBadTaper', { max: String(Math.round((THREAD_MAX_TAPER * 180) / Math.PI)) }));
    if (!Number.isFinite(phase)) throw new KernelError(t('feature.threadBadPhase'));
    if (!(Number.isFinite(fadeTurnsIn) && fadeTurnsIn >= 0)) throw new KernelError(t('feature.threadBadFade'));
    if (!(Number.isFinite(fadeTurnsOut) && fadeTurnsOut >= 0)) throw new KernelError(t('feature.threadBadFade'));
    const lead = pitch * starts;
    const lIn = fadeTurnsIn * lead;
    const lOut = fadeTurnsOut * lead;
    if (lIn + lOut >= to - from) throw new KernelError(t('feature.threadFadeTooLong'));
    const len = Math.hypot(...spec.axis.dir);
    if (!(len > 0)) throw new KernelError(t('feature.threadNoAxis'));
    const Z: Vec3 = [spec.axis.dir[0] / len, spec.axis.dir[1] / len, spec.axis.dir[2] / len];
    const O = spec.axis.origin;
    const dotv = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

    // where the profile is: its points (arcs and circles sampled) as (along the axis, away from it)
    const at = (p: P2): Vec3 => add(add(frame.origin, frame.xDir, p[0]), frame.yDir, p[1]);
    const samples: Vec3[] = [];
    for (const r of regions)
      for (const s of r.outer) {
        if (s.kind === 'line') samples.push(at(s.a), at(s.b));
        else if (s.kind === 'ellipse') {
          const cosA = Math.cos(s.angle);
          const sinA = Math.sin(s.angle);
          for (let i = 0; i <= 64; i++) {
            const u = (2 * Math.PI * i) / 64;
            const x = s.rx * Math.cos(u);
            const y = s.ry * Math.sin(u);
            samples.push(at([s.c[0] + x * cosA - y * sinA, s.c[1] + x * sinA + y * cosA]));
          }
        } else if (s.kind === 'spline') {
          for (const p of s.points) samples.push(at(p));
        } else {
          const a0 = s.kind === 'circle' ? 0 : Math.atan2(s.from[1] - s.c[1], s.from[0] - s.c[0]);
          let sweep = s.kind === 'circle' ? 2 * Math.PI : Math.atan2(s.to[1] - s.c[1], s.to[0] - s.c[0]) - a0;
          if (s.kind === 'arc') {
            if (s.ccw && sweep <= 0) sweep += 2 * Math.PI;
            if (!s.ccw && sweep >= 0) sweep -= 2 * Math.PI;
          }
          for (let i = 0; i <= 64; i++) samples.push(at([s.c[0] + s.r * Math.cos(a0 + (sweep * i) / 64), s.c[1] + s.r * Math.sin(a0 + (sweep * i) / 64)]));
        }
      }
    const scale = Math.max(1, ...samples.map((p) => Math.hypot(...sub(p, O))));
    if (Math.abs(dotv(frame.normal, Z)) > 1e-7 || Math.abs(dotv(sub(O, frame.origin), frame.normal)) > 1e-7 * scale) throw new KernelError(t('feature.threadAxisOffPlane'));
    const radial = samples.map((p) => {
      const d = sub(p, O);
      return add(d, Z, -dotv(d, Z));
    });
    const mean = radial.reduce((m, w) => add(m, w, 1 / radial.length), [0, 0, 0] as Vec3);
    const mlen = Math.hypot(...mean);
    if (!(mlen > 1e-9 * scale)) throw new KernelError(t('feature.threadCrossesAxis'));
    const X: Vec3 = [mean[0] / mlen, mean[1] / mlen, mean[2] / mlen];
    const rs = radial.map((w) => dotv(w, X));
    const zs = samples.map((p) => dotv(sub(p, O), Z));
    const rMin = Math.min(...rs);
    const rMax = Math.max(...rs);
    const zMin = Math.min(...zs);
    const zMax = Math.max(...zs);
    if (!(rMin > 1e-6 * scale)) throw new KernelError(t('feature.threadCrossesAxis'));
    // a profile as wide as the pitch along the axis overlaps the next thread (of its own start one lead on, or of the next start one pitch on): nothing is
    // left between them, which is no thread; and joining such overlapping helical solids took 100–250 MB of WASM memory and 10 s each, which the heap never
    // gives back, so a run of them crashed the kernel
    if (zMax - zMin >= pitch - 1e-9 * scale) throw new KernelError(t('feature.threadProfileTooWide', { width: (zMax - zMin).toFixed(3), pitch: pitch.toFixed(3) }));

    // whole turns back to before `from`, whole turns on to past `to`
    const back = Math.ceil((zMax - from) / lead) + 1;
    const turns = back + Math.ceil((to - zMin) / lead) + 1;
    if (turns > THREAD_MAX_TURNS) throw new KernelError(t('feature.threadTooManyTurns', { turns: String(turns), max: String(THREAD_MAX_TURNS) }));
    const tan = Math.tan(taper);
    const shift0 = -back * lead; // along the axis, where the sweep starts
    const shift1 = shift0 + turns * lead;
    if (!(rMin + tan * shift0 > 1e-6 * scale && rMin + tan * shift1 > 1e-6 * scale)) throw new KernelError(t('feature.threadCrossesAxis'));

    const oc = this.oc;
    const arena = new Arena();
    try {
      // the helix: a line in the (angle, along the generatrix) parameters of a cylinder or cone through the middle of the profile
      const rRef = (rMin + rMax) / 2 + tan * shift0;
      const zRef = (zMin + zMax) / 2 + shift0;
      const ax3 = arena.own(new oc.gp_Ax3(this.pnt(arena, add(O, Z, zRef)), this.dir(arena, Z), this.dir(arena, X)));
      const surface = arena.own(taper === 0 ? new oc.Geom_CylindricalSurface(ax3, rRef) : new oc.Geom_ConicalSurface(ax3, taper, rRef));
      const dv = lead / Math.cos(taper);
      const hand = spec.hand === 'left' ? -1 : 1;
      const line = arena.own(new oc.Geom2d_Line(arena.own(new oc.gp_Pnt2d(0, 0)), arena.own(new oc.gp_Dir2d(hand * 2 * Math.PI, dv))));
      // one edge per turn: a boolean then meets each face along one turn of a helix, not along all of them, which keeps its intersection curves
      // tight (over 30 turns as one face the edges came out 5e-4 mm loose, enough to move the volume 1e-6 through a STEP file)
      const perTurn = Math.hypot(2 * Math.PI, dv);
      const mw = arena.own(new oc.BRepBuilderAPI_MakeWire());
      const pathSources = new Map<TopoDS_Shape, string>();
      for (let i = 0; i < turns; i++) {
        const edge = arena.own(arena.own(new oc.BRepBuilderAPI_MakeEdge(line, surface, i * perTurn, (i + 1) * perTurn)).Edge());
        if (!oc.BRepLib.BuildCurves3d(edge, 1e-7, oc.GeomAbs_Shape.GeomAbs_C1, 14, 30)) throw new KernelError(t('feature.threadFailed', { why: 'BuildCurves3d' }));
        mw.Add(edge);
        if (!mw.IsDone()) throw new KernelError(t('feature.threadFailed', { why: 'helix' }));
        pathSources.set(arena.own(mw.Edge()), `helix:${i - back}`); // the turn the profile is drawn in is 0
      }
      const spine = arena.own(mw.Wire());

      // one start: the profile moved back along the screw (a whole number of turns: straight back, and in for a taper), swept, less its holes
      const moved: Frame = { ...frame, origin: add(add(frame.origin, Z, shift0), X, tan * shift0) };
      const binormal = this.dir(arena, Z);
      const pipe = (loop: Segment[], hole: boolean) => {
        const sources = new Map<TopoDS_Shape, string>();
        const wire = this.wire(arena, moved, loop, hole, sources);
        const mk = arena.own(new oc.BRepOffsetAPI_MakePipeShell(spine));
        mk.SetMode(binormal);
        mk.SetTolerance(1e-6, 1e-6, 1e-4); // the default 1e-4 mm left a cut thread's volume 1.5e-5 off; this is 1e-7 for a quarter more time
        mk.Add(wire, false, false);
        try {
          mk.Build(arena.own(new oc.Message_ProgressRange()));
          if (!mk.IsReady() || !mk.MakeSolid()) throw new KernelError(t('feature.threadFailed', { why: t('feature.sweepNoSolid') }));
        } catch (e) {
          if (e instanceof KernelError) throw e;
          throw new KernelError(t('feature.threadFailed', { why: this.errorText(e) }));
        }
        let shape = arena.own(mk.Shape());
        const props = arena.own(new oc.GProp_GProps());
        oc.BRepGProp.VolumeProperties(shape, props, false, false, false);
        if (props.Mass() < 0) shape = arena.own(shape.Reversed());
        return { shape, origins: this.pipeOrigins(mk, shape, sources, pathSources, arena) };
      };
      const oneStart = (region: Region) => {
        let acc = pipe(region.outer, false);
        for (const hole of region.holes) {
          const tool = pipe(hole, true);
          const fa = ShapeIndex.of(oc, acc.shape, T.FACE, arena);
          const fb = ShapeIndex.of(oc, tool.shape, T.FACE, arena);
          const mk = this.boolOp('cut', acc.shape, tool.shape, t('feature.thread'), arena);
          const raw = arena.own(mk.Shape());
          const all = [...acc.origins, ...tool.origins];
          acc = { shape: raw, origins: this.faceSources(mk, [...fa.keys, ...fb.keys], raw, arena).map((s) => s.flatMap((i) => all[i]!)) };
          fa.dispose();
          fb.dispose();
        }
        return acc;
      };
      const base = regions.map(oneStart);

      // every start: the first one turned, its faces renamed for the helix they follow
      const axis1 = arena.own(new oc.gp_Ax1(this.pnt(arena, O), this.dir(arena, Z)));
      const pieces: { shape: TopoDS_Shape; origins: FaceOrigin[][] }[] = [];
      for (let k = 0; k < starts; k++) {
        const trsf = arena.own(new oc.gp_Trsf());
        trsf.SetRotation(axis1, phase + (2 * Math.PI * k) / starts);
        const rename = (o: FaceOrigin): FaceOrigin => (o.rel === 'generated' && o.kind === 'profileEdge' ? { ...o, source: o.source.replace(/@helix:(-?\d+)$/, `@helix${k + 1}:$1`) } : o);
        for (const b of base) {
          const mk = arena.own(new oc.BRepBuilderAPI_Transform(b.shape, trsf, true, false));
          const shape = arena.own(mk.Shape());
          const before = ShapeIndex.of(oc, b.shape, T.FACE, arena);
          const after = ShapeIndex.of(oc, shape, T.FACE, arena);
          const origins: FaceOrigin[][] = after.keys.map(() => []);
          before.keys.forEach((f, i) => {
            const image = arena.own(mk.ModifiedShape(f));
            const j = after.indexOf(image);
            if (j >= 0) origins[j]!.push(...b.origins[i]!.map(rename));
          });
          before.dispose();
          after.dispose();
          pieces.push({ shape, origins });
        }
      }

      // all starts as one shape, side by side: narrower than the pitch, no two of them touch
      const whole = this.compoundPieces(pieces, arena);

      // cut to length: a common with a cylinder or tapered envelope from `from` to `to`, wider than the thread ever gets
      const rOuter = Math.max(rMax + tan * shift0, rMax + tan * shift1) + Math.abs(zMax - zMin) + 1;
      let box: TopoDS_Shape;
      if (lIn > 0 || lOut > 0) {
        const z0 = from;
        const z1 = from + lIn;
        const z2 = to - lOut;
        const z3 = to;
        const rIn = Math.max(1e-5, rMin + tan * z0);
        const rOut = Math.max(1e-5, rMin + tan * z3);

        const poly = arena.own(new oc.BRepBuilderAPI_MakePolygon());
        poly.Add(this.pnt(arena, add(add(O, Z, z0), X, 0)));
        poly.Add(this.pnt(arena, add(add(O, Z, z0), X, rIn)));
        poly.Add(this.pnt(arena, add(add(O, Z, z1), X, rOuter)));
        poly.Add(this.pnt(arena, add(add(O, Z, z2), X, rOuter)));
        poly.Add(this.pnt(arena, add(add(O, Z, z3), X, rOut)));
        poly.Add(this.pnt(arena, add(add(O, Z, z3), X, 0)));
        poly.Close();

        const wire = arena.own(poly.Wire());
        const mkFace = arena.own(new oc.BRepBuilderAPI_MakeFace(wire, true));
        if (!mkFace.IsDone()) throw new KernelError(t('feature.threadFailed', { why: 'fadeFace' }));
        const face = arena.own(mkFace.Face());

        const ax1 = arena.own(new oc.gp_Ax1(this.pnt(arena, O), this.dir(arena, Z)));
        const revol = arena.own(new oc.BRepPrimAPI_MakeRevol(face, ax1, 2 * Math.PI, false));
        if (!revol.IsDone()) throw new KernelError(t('feature.threadFailed', { why: 'fadeRevol' }));
        box = arena.own(revol.Shape());
      } else {
        box = arena.own(arena.own(new oc.BRepPrimAPI_MakeCylinder(arena.own(new oc.gp_Ax2(this.pnt(arena, add(O, Z, from)), this.dir(arena, Z), this.dir(arena, X))), rOuter, to - from)).Shape());
      }
      const fa = ShapeIndex.of(oc, whole.shape, T.FACE, arena);
      const fb = ShapeIndex.of(oc, box, T.FACE, arena);
      const boxOrigins: FaceOrigin[][] = fb.keys.map((f) => {
        const props = arena.own(new oc.GProp_GProps());
        oc.BRepGProp.SurfaceProperties(f, props, false, false);
        const along = dotv(sub(this.xyz(arena.own(props.CentreOfMass())), O), Z);
        return Math.abs(along - from) < 1e-9 * scale ? [{ rel: 'cap', which: 'start' }] : Math.abs(along - to) < 1e-9 * scale ? [{ rel: 'cap', which: 'end' }] : [];
      });
      const mk = this.boolOp('common', whole.shape, box, t('feature.thread'), arena);
      const out = arena.own(mk.Shape());
      const all = [...whole.origins, ...boxOrigins];
      const origins = this.faceSources(mk, [...fa.keys, ...fb.keys], out, arena).map((s) => s.flatMap((i) => all[i]!));
      fa.dispose();
      fb.dispose();
      if (!this.valid(out)) throw new KernelError(t('feature.threadInvalid'));
      const id = this.put(out.Oriented(out.Orientation()));
      if (!(this.massProps(id).volume > 1e-9)) {
        this.release(id);
        throw new KernelError(t('feature.threadInvalid'));
      }
      return { shape: id, faceOrigins: origins };
    } finally {
      arena.dispose();
    }
  }

  /**
   * The tool of a knurl (壓花): one hand of straight or helical grooves on a cylinder, as one solid to cut from the body. The blank is a cylinder of
   * `radius` about the axis; a groove is a V cut in from it, `depth` deep with `included` between its flanks; `count` of them go round the
   * circumference, so the pattern closes on itself (the pitch along the circumference is 2π·radius/count). Straight grooves run along the axis;
   * helical ones wind about it at `angle`, one hand.
   *
   * How: one groove is built and the rest are copies of it turned 360°/count about the axis, so the expensive sweep happens once. A straight groove is
   * the V (in the plane square to the axis, so its flanks meet the surface at `included`) grown along it; a helical groove is the V (in a plane through
   * the axis, so that is where `included` is read) swept along a helix with the binormal held along the axis and then cut to length by a common with a
   * cylinder — the screw motion `thread` uses, over whole turns only. A side face is one turn of one flank of one groove, named
   * `<flank>@knurl<hand><groove>:<turn>` (turn 0 the turn the profile is drawn in, counting on along the axis; straight grooves have no turn and are
   * named `<flank>@groove<n>`); the faces square to the axis at `from` and `to` are the caps.
   *
   * A diamond is the two hands, so it is two of these cut in turn (see `KnurlFeature`): one tool holding both hands has its solids crossing one another,
   * and OCCT leaves the faces inside the crossing in the result, which then comes back as a body plus a solid per groove rather than one body.
   */
  knurl(spec: KnurlSpec): OpResult {
    const { radius, from, to, depth, included, pattern } = spec;
    const count = spec.count;
    const angle = pattern === 'straight' ? 0 : (spec.angle ?? 0);
    const phase = spec.phase ?? 0;
    const hand = spec.hand === 'left' ? -1 : 1;
    if (!(Number.isFinite(radius) && radius > 0)) throw new KernelError(t('feature.knurlBadRadius'));
    if (!(Number.isInteger(count) && count >= KNURL_MIN_GROOVES && count <= KNURL_MAX_GROOVES))
      throw new KernelError(t('feature.knurlBadCount', { min: String(KNURL_MIN_GROOVES), max: String(KNURL_MAX_GROOVES) }));
    if (!(Number.isFinite(from) && Number.isFinite(to) && to > from)) throw new KernelError(t('feature.knurlBadLength'));
    if (!(Number.isFinite(depth) && depth > 0 && depth < radius)) throw new KernelError(t('feature.knurlBadDepth', { radius: radius.toFixed(3) }));
    if (!(Number.isFinite(included) && included >= KNURL_MIN_INCLUDED && included <= KNURL_MAX_INCLUDED))
      throw new KernelError(
        t('feature.knurlBadIncluded', { min: String(Math.round((KNURL_MIN_INCLUDED * 180) / Math.PI)), max: String(Math.round((KNURL_MAX_INCLUDED * 180) / Math.PI)) }),
      );
    if (pattern !== 'straight' && !(Number.isFinite(angle) && angle > 0 && angle <= KNURL_MAX_ANGLE))
      throw new KernelError(t('feature.knurlBadAngle', { max: String(Math.round((KNURL_MAX_ANGLE * 180) / Math.PI)) }));
    if (!Number.isFinite(phase)) throw new KernelError(t('feature.knurlBadPhase'));
    const len = Math.hypot(...spec.axis.dir);
    if (!(len > 0)) throw new KernelError(t('feature.knurlNoAxis'));
    const Z: Vec3 = [spec.axis.dir[0] / len, spec.axis.dir[1] / len, spec.axis.dir[2] / len];
    const O = spec.axis.origin;

    // the grooves of one hand lie `spacing` apart: round the circumference for a straight one, along the axis for a helical one
    const circumference = 2 * Math.PI * radius;
    const spacing = pattern === 'straight' ? circumference / count : (circumference / count) * Math.tan(angle);
    const reach = radius + KNURL_OVERSHOOT * depth;
    const half = (depth + KNURL_OVERSHOOT * depth) * Math.tan(included / 2); // half a groove's width where it leaves the blank
    if (!(2 * half < spacing)) {
      const deepest = spacing / (2 * (1 + KNURL_OVERSHOOT) * Math.tan(included / 2));
      throw new KernelError(t('feature.knurlTooDeep', { depth: deepest.toFixed(3), spacing: spacing.toFixed(3) }));
    }
    const lead = circumference * Math.tan(angle);
    const back = pattern === 'straight' ? 0 : Math.ceil((half - from) / lead) + 1;
    const turns = pattern === 'straight' ? 0 : back + Math.ceil((to + half) / lead) + 1;
    if (turns > KNURL_MAX_TURNS)
      throw new KernelError(t('feature.knurlTooManyTurns', { turns: String(turns), max: String(KNURL_MAX_TURNS), angle: String(Math.round((angle * 180) / Math.PI)) }));
    const pieces = count * Math.max(1, turns);
    if (pieces > KNURL_MAX_PIECES) throw new KernelError(t('feature.knurlTooFine', { pieces: String(pieces), max: String(KNURL_MAX_PIECES) }));

    // a direction square to the axis, to measure the pattern round from
    let X: Vec3 = Math.abs(Z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const along = dot3(X, Z);
    X = [X[0] - along * Z[0], X[1] - along * Z[1], X[2] - along * Z[2]];
    const xLen = Math.hypot(...X);
    X = [X[0] / xLen, X[1] / xLen, X[2] / xLen];

    const oc = this.oc;
    const arena = new Arena();
    try {
      const sets: { shape: TopoDS_Shape; origins: FaceOrigin[][] }[] = [];
      for (const h of pattern === 'helical' ? [hand] : [0]) {
        sets.push(this.knurlSet(O, Z, X, { radius, count, from, to, depth, half, reach, angle, hand: h, phase, tag: angle === 0 ? '' : h < 0 ? 'L' : 'R', back, turns }, arena));
      }
      const whole = this.compoundPieces(sets, arena);
      if (!this.valid(whole.shape)) throw new KernelError(t('feature.knurlInvalid'));
      const id = this.put(whole.shape.Oriented(whole.shape.Orientation()));
      if (!(this.massProps(id).volume > 1e-9)) {
        this.release(id);
        throw new KernelError(t('feature.knurlInvalid'));
      }
      return { shape: id, faceOrigins: whole.origins };
    } finally {
      arena.dispose();
    }
  }

  /** One hand of a knurl's grooves: `count` copies of a single groove turned 360°/count about the axis. */
  private knurlSet(O: Vec3, Z: Vec3, X: Vec3, p: KnurlSet, arena: Arena): { shape: TopoDS_Shape; origins: FaceOrigin[][] } {
    const oc = this.oc;
    // the V: its point `depth` in from the blank, its flanks out past the surface, so the cut leaves only the two flanks
    const loop: Segment[] = [
      { kind: 'line', a: [p.radius - p.depth, 0], b: [p.reach, p.half], source: 'knurlFlankA' },
      { kind: 'line', a: [p.reach, p.half], b: [p.reach, -p.half], source: 'knurlRoot' },
      { kind: 'line', a: [p.reach, -p.half], b: [p.radius - p.depth, 0], source: 'knurlFlankB' },
    ];
    const straight = p.angle === 0;
    let base: { shape: TopoDS_Shape; origins: FaceOrigin[][] };
    if (straight) {
      // the V in the plane square to the axis: its x is the distance from the axis and its y the way round, and it grows along the axis
      const frame: Frame = { origin: add(O, Z, p.from), xDir: X, yDir: cross3(Z, X), normal: Z };
      const sources = new Map<TopoDS_Shape, string>();
      const wire = this.wire(arena, frame, loop, false, sources);
      const mkFace = arena.own(new oc.BRepBuilderAPI_MakeFace(wire, true));
      if (!mkFace.IsDone()) throw new KernelError(t('feature.knurlFailed', { why: 'face' }));
      const face = arena.own(mkFace.Face());
      const span = p.to - p.from;
      const mk = arena.own(new oc.BRepPrimAPI_MakePrism(face, arena.own(new oc.gp_Vec(Z[0] * span, Z[1] * span, Z[2] * span)), false, true));
      const shape = this.build(mk, t('feature.knurl'), arena);
      base = { shape, origins: this.sweepOrigins(mk, shape, sources, arena) };
    } else {
      base = this.knurlHelix(O, Z, X, loop, p, arena);
    }

    const axis = arena.own(new oc.gp_Ax1(this.pnt(arena, O), this.dir(arena, Z)));
    const copies: { shape: TopoDS_Shape; origins: FaceOrigin[][] }[] = [];
    for (let k = 0; k < p.count; k++) {
      const turn = arena.own(new oc.gp_Trsf());
      turn.SetRotation(axis, p.phase + (2 * Math.PI * k) / p.count);
      const rename = (o: FaceOrigin): FaceOrigin =>
        o.rel === 'generated' && o.kind === 'profileEdge'
          ? { ...o, source: straight ? `${o.source}@groove${k}` : o.source.replace(/@helix:(-?\d+)$/, `@knurl${p.tag}${k}:$1`) }
          : o;
      const mk = arena.own(new oc.BRepBuilderAPI_Transform(base.shape, turn, true, false));
      const shape = arena.own(mk.Shape());
      const before = ShapeIndex.of(oc, base.shape, T.FACE, arena);
      const after = ShapeIndex.of(oc, shape, T.FACE, arena);
      const origins: FaceOrigin[][] = after.keys.map(() => []);
      before.keys.forEach((f, i) => {
        const image = arena.own(mk.ModifiedShape(f));
        const j = after.indexOf(image);
        if (j >= 0) origins[j]!.push(...base.origins[i]!.map(rename));
      });
      before.dispose();
      after.dispose();
      copies.push({ shape, origins });
    }
    return this.compoundPieces(copies, arena);
  }

  /** One groove swept along a helix about the axis, cut square to the axis at `from` and `to`, with the origins of its faces. */
  private knurlHelix(O: Vec3, Z: Vec3, X: Vec3, loop: Segment[], p: KnurlSet, arena: Arena): { shape: TopoDS_Shape; origins: FaceOrigin[][] } {
    const oc = this.oc;
    const lead = 2 * Math.PI * p.radius * Math.tan(p.angle);
    const shift = -p.back * lead; // along the axis, where the sweep starts
    const rRef = (p.radius - p.depth + p.reach) / 2;

    // the helix: a line in the (angle, along the generatrix) parameters of the cylinder through the middle of the profile, one edge per turn
    const ax3 = arena.own(new oc.gp_Ax3(this.pnt(arena, add(O, Z, shift)), this.dir(arena, Z), this.dir(arena, X)));
    const surface = arena.own(new oc.Geom_CylindricalSurface(ax3, rRef));
    const line = arena.own(new oc.Geom2d_Line(arena.own(new oc.gp_Pnt2d(0, 0)), arena.own(new oc.gp_Dir2d(p.hand * 2 * Math.PI, lead))));
    const perTurn = Math.hypot(2 * Math.PI, lead);
    const mw = arena.own(new oc.BRepBuilderAPI_MakeWire());
    const pathSources = new Map<TopoDS_Shape, string>();
    for (let i = 0; i < p.turns; i++) {
      const edge = arena.own(arena.own(new oc.BRepBuilderAPI_MakeEdge(line, surface, i * perTurn, (i + 1) * perTurn)).Edge());
      if (!oc.BRepLib.BuildCurves3d(edge, 1e-7, oc.GeomAbs_Shape.GeomAbs_C1, 14, 30)) throw new KernelError(t('feature.knurlFailed', { why: 'BuildCurves3d' }));
      mw.Add(edge);
      if (!mw.IsDone()) throw new KernelError(t('feature.knurlFailed', { why: 'helix' }));
      pathSources.set(arena.own(mw.Edge()), `helix:${i - p.back}`); // the turn the profile is drawn in is 0
    }
    const spine = arena.own(mw.Wire());

    // the profile, moved back whole turns until it lies before `from`, swept with the binormal held along the axis (so it stays in a plane through it)
    const frame: Frame = { origin: add(O, Z, shift), xDir: X, yDir: Z, normal: cross3(X, Z) };
    const sources = new Map<TopoDS_Shape, string>();
    const wire = this.wire(arena, frame, loop, false, sources);
    const mk = arena.own(new oc.BRepOffsetAPI_MakePipeShell(spine));
    mk.SetMode(this.dir(arena, Z));
    mk.SetTolerance(1e-6, 1e-6, 1e-4);
    mk.Add(wire, false, false);
    try {
      mk.Build(arena.own(new oc.Message_ProgressRange()));
      if (!mk.IsReady() || !mk.MakeSolid()) throw new KernelError(t('feature.knurlFailed', { why: t('feature.sweepNoSolid') }));
    } catch (e) {
      if (e instanceof KernelError) throw e;
      throw new KernelError(t('feature.knurlFailed', { why: this.errorText(e) }));
    }
    let shape = arena.own(mk.Shape());
    const props = arena.own(new oc.GProp_GProps());
    oc.BRepGProp.VolumeProperties(shape, props, false, false, false);
    if (props.Mass() < 0) shape = arena.own(shape.Reversed());
    const origins = this.pipeOrigins(mk, shape, sources, pathSources, arena);

    // cut to length: a common with a cylinder from `from` to `to`, wider than the groove ever reaches
    const box = arena.own(
      arena.own(new oc.BRepPrimAPI_MakeCylinder(arena.own(new oc.gp_Ax2(this.pnt(arena, add(O, Z, p.from)), this.dir(arena, Z), this.dir(arena, X))), p.reach + 1, p.to - p.from)).Shape(),
    );
    const fa = ShapeIndex.of(oc, shape, T.FACE, arena);
    const fb = ShapeIndex.of(oc, box, T.FACE, arena);
    const boxOrigins: FaceOrigin[][] = fb.keys.map((f) => {
      const at = arena.own(new oc.GProp_GProps());
      oc.BRepGProp.SurfaceProperties(f, at, false, false);
      const along = dot3(sub3(this.xyz(arena.own(at.CentreOfMass())), O), Z);
      return Math.abs(along - p.from) < 1e-9 * p.radius
        ? [{ rel: 'cap' as const, which: 'start' as const }]
        : Math.abs(along - p.to) < 1e-9 * p.radius
          ? [{ rel: 'cap' as const, which: 'end' as const }]
          : [];
    });
    const common = this.boolOp('common', shape, box, t('feature.knurl'), arena);
    const out = arena.own(common.Shape());
    const all = [...origins, ...boxOrigins];
    const clipped = this.faceSources(common, [...fa.keys, ...fb.keys], out, arena).map((s) => s.flatMap((i) => all[i]!));
    fa.dispose();
    fb.dispose();
    return { shape: out, origins: clipped };
  }

  /** Several shapes as one compound, keeping for each of its faces the origins of the face it came from. */
  private compoundPieces(pieces: { shape: TopoDS_Shape; origins: FaceOrigin[][] }[], arena: Arena): { shape: TopoDS_Shape; origins: FaceOrigin[][] } {
    const oc = this.oc;
    let whole = pieces[0]!;
    for (const p of pieces.slice(1)) {
      const compound = arena.own(new oc.TopoDS_Compound());
      const builder = arena.own(new oc.TopoDS_Builder());
      builder.MakeCompound(compound);
      builder.Add(compound, whole.shape);
      builder.Add(compound, p.shape);
      const index = ShapeIndex.of(oc, compound, T.FACE, arena);
      const origins: FaceOrigin[][] = index.keys.map(() => []);
      for (const part of [whole, p]) {
        const own = ShapeIndex.of(oc, part.shape, T.FACE, arena);
        own.keys.forEach((f, i) => {
          const j = index.indexOf(f);
          if (j >= 0) origins[j]!.push(...part.origins[i]!);
        });
        own.dispose();
      }
      index.dispose();
      whole = { shape: compound, origins };
    }
    return whole;
  }

  /**
   * A body through two or more sections (C4.5, 疊層拉伸): each the outer outline of a region on its own frame, first to last. The faces are smooth
   * through all the sections (ruled when there are two); OCCT lines the sections up itself (the corner they start at, the way round, a different
   * number of edges, which it makes alike by splitting). A side face is named for the edge of the first section that made it
   * (`<source>`; the caller puts the first sketch before it), the ends are caps.
   */
  loft(sections: { frame: Frame; outer: Segment[] }[]): OpResult {
    if (sections.length < 2) throw new KernelError(t('feature.loftFewSections'));
    const oc = this.oc;
    const arena = new Arena();
    try {
      const first = new Map<TopoDS_Shape, string>();
      const mk = arena.own(new oc.BRepOffsetAPI_ThruSections(true, false, 1e-6));
      sections.forEach((s, i) => mk.AddWire(this.wire(arena, s.frame, s.outer, false, i === 0 ? first : new Map())));
      let out: TopoDS_Shape;
      try {
        out = arena.own(this.build(mk, t('feature.loft'), arena));
      } catch (e) {
        if (e instanceof KernelError) throw new KernelError(t('feature.loftFailed', { why: e.message }));
        throw e;
      }
      if (!this.valid(out)) throw new KernelError(t('feature.loftInvalid'));
      const id = this.put(out.Oriented(out.Orientation()));
      if (!(this.massProps(id).volume > 1e-9)) {
        this.release(id);
        throw new KernelError(t('feature.loftInvalid'));
      }
      const faces = ShapeIndex.of(oc, out, T.FACE, arena);
      const origins: FaceOrigin[][] = faces.keys.map(() => []);
      for (const [edge, source] of first) {
        for (const s of this.list(mk.Generated(edge))) {
          const i = faces.indexOf(s);
          if (i >= 0 && !origins[i]!.some((o) => o.rel === 'generated' && o.kind === 'profileEdge' && o.source === source)) origins[i]!.push({ rel: 'generated', kind: 'profileEdge', source });
          s.delete();
        }
      }
      for (const [shape, which] of [[mk.FirstShape(), 'start'], [mk.LastShape(), 'end']] as const) {
        const ends = ShapeIndex.of(oc, shape, T.FACE, arena);
        for (const f of ends.keys) {
          const i = faces.indexOf(f);
          if (i >= 0) origins[i]!.push({ rel: 'cap', which });
        }
        ends.dispose();
        shape.delete();
      }
      faces.dispose();
      return { shape: id, faceOrigins: origins };
    } finally {
      arena.dispose();
    }
  }

  private boolOp(op: 'fuse' | 'cut' | 'common', a: TopoDS_Shape, b: TopoDS_Shape, label: string, arena: Arena) {
    const oc = this.oc;
    let mk;
    try {
      // The constructor with arguments performs the operation; Build() would run it again.
      const range = arena.own(new oc.Message_ProgressRange());
      mk = arena.own(op === 'fuse' ? new oc.BRepAlgoAPI_Fuse(a, b, range) : op === 'cut' ? new oc.BRepAlgoAPI_Cut(a, b, range) : new oc.BRepAlgoAPI_Common(a, b, range));
    } catch (e) {
      throw new KernelError(t('kernel.opFailedWhy', { label, why: this.errorText(e) }));
    }
    if (mk.HasErrors() || !mk.IsDone()) throw new KernelError(t('kernel.opFailed', { label }));
    return mk;
  }

  /**
   * Boolean of `tool` into or out of `target` (A1.5), then coplanar faces are merged like SolidWorks
   * does. Face origins index the target's faces followed by the tool's (and likewise edges, vertices),
   * so the naming layer can inherit names from both inputs.
   */
  boolean(op: 'fuse' | 'cut' | 'common', target: ShapeId, tool: ShapeId): OpResult {
    const oc = this.oc;
    const arena = new Arena();
    const a = this.get(target);
    const b = this.get(tool);
    const index = (s: TopoDS_Shape) => ({ faces: ShapeIndex.of(oc, s, T.FACE, arena), edges: ShapeIndex.of(oc, s, T.EDGE, arena), verts: ShapeIndex.of(oc, s, T.VERTEX, arena) });
    const ia = index(a);
    const ib = index(b);
    try {
      const mk = this.boolOp(op, a, b, op === 'fuse' ? t('body.fuse') : op === 'cut' ? t('kernel.opCut') : t('body.common'), arena);
      const raw = mk.Shape();
      try {
        const origins = this.history(
          mk,
          { faces: [...ia.faces.keys, ...ib.faces.keys], edges: [...ia.edges.keys, ...ib.edges.keys], verts: [...ia.verts.keys, ...ib.verts.keys] },
          raw,
          arena,
        );
        const unified = this.unify(raw, origins, arena);
        const shape = this.put(unified.shape);
        // a piece the tool made on the surface of a body face it touches is named after the body face, whether or not the merge joined them (B3.1)
        const nBody = ia.faces.keys.length;
        const isBody = (o: FaceOrigin) => o.rel !== 'cap' && o.rel !== 'imported' && o.kind === 'face' && o.index < nBody;
        return { shape, faceOrigins: inheritBodySurface(unified.origins, this.topology(shape), isBody) };
      } finally {
        raw.delete();
      }
    } finally {
      for (const i of [ia, ib]) for (const x of Object.values(i)) x.dispose();
      arena.dispose();
    }
  }

  /**
   * Merges faces lying on the same surface; a merged face keeps the origins of all its pieces (G4 in ADR 0003).
   * Faces are not merged across an edge in keep: an edit that touches a few faces of a large imported body must not
   * regroup the faces far from it, whose names others may be using.
   */
  private unify(shape: TopoDS_Shape, origins: FaceOrigin[][], arena: Arena, keep: TopoDS_Shape[] = []): { shape: TopoDS_Shape; origins: FaceOrigin[][] } {
    const oc = this.oc;
    const u = arena.own(new oc.ShapeUpgrade_UnifySameDomain(shape, true, true, false));
    for (const e of keep) u.KeepShape(e);
    u.Build();
    const out = u.Shape();
    const history = arena.own(u.History());
    const before = ShapeIndex.of(oc, shape, T.FACE, arena);
    const after = ShapeIndex.of(oc, out, T.FACE, arena);
    try {
      const merged: FaceOrigin[][] = after.keys.map(() => []);
      before.keys.forEach((f, i) => {
        const modified = this.list(history.Modified(f));
        const targets = modified.length > 0 ? modified.map((m) => after.indexOf(m)) : [after.indexOf(f)];
        for (const m of modified) m.delete();
        for (const j of targets) if (j >= 0) merged[j]!.push(...origins[i]!);
      });
      return { shape: out, origins: merged };
    } finally {
      before.dispose();
      after.dispose();
    }
  }

  // ------------------------------------------------------------------ bodies (C7)

  /** How many solids a shape holds: a result with more than one has come apart. */
  solidCount(id: ShapeId): number {
    const arena = new Arena();
    const solids = ShapeIndex.of(this.oc, this.get(id), 'TopAbs_SOLID', arena);
    try {
      return solids.size;
    } finally {
      solids.dispose();
      arena.dispose();
    }
  }

  /**
   * The solids of a result as separate shapes, each with the origins of its own faces and the numbers those faces have in the
   * whole result (faces; an imported face keeps its origin's number). Largest first, ties by position, so the order is
   * the same on every rebuild. The result itself stays the caller's.
   */
  splitSolids(result: OpResult): (OpResult & { faces: number[] })[] {
    const oc = this.oc;
    const arena = new Arena();
    const whole = this.get(result.shape);
    const faces = ShapeIndex.of(oc, whole, T.FACE, arena);
    const solids = ShapeIndex.of(oc, whole, 'TopAbs_SOLID', arena);
    try {
      const pieces = solids.keys.map((solid) => {
        const own = ShapeIndex.of(oc, solid, T.FACE, arena);
        const indices = own.keys.map((f) => faces.indexOf(f));
        const origins = indices.map((i) => result.faceOrigins[i] ?? []);
        own.dispose();
        const props = arena.own(new oc.GProp_GProps());
        oc.BRepGProp.VolumeProperties(solid, props, false, false, false);
        return { solid, origins, indices, volume: props.Mass(), center: this.xyz(arena.own(props.CentreOfMass())) };
      });
      pieces.sort((a, b) => b.volume - a.volume || a.center[0] - b.center[0] || a.center[1] - b.center[1] || a.center[2] - b.center[2]);
      return pieces.map((p) => ({ shape: this.put(p.solid.Oriented(p.solid.Orientation())), faceOrigins: p.origins, faces: p.indices }));
    } finally {
      faces.dispose();
      solids.dispose();
      arena.dispose();
    }
  }

  /**
   * Splits a solid body by a planar frame (C7.4, ADR 0158).
   * Returns an array of OpResult for the resulting separate solids.
   */
  splitBody(targetId: ShapeId, plane: Frame): OpResult[] {
    if (this.solidCount(targetId) === 0) throw new KernelError(t('surface.notSolid'));
    const oc = this.oc;
    const arena = new Arena();
    const target = this.get(targetId);

    const b = this.bounds(targetId);
    const corners: Vec3[] = [
      [b.min[0], b.min[1], b.min[2]],
      [b.min[0], b.min[1], b.max[2]],
      [b.min[0], b.max[1], b.min[2]],
      [b.min[0], b.max[1], b.max[2]],
      [b.max[0], b.min[1], b.min[2]],
      [b.max[0], b.min[1], b.max[2]],
      [b.max[0], b.max[1], b.min[2]],
      [b.max[0], b.max[1], b.max[2]],
    ];
    const signedDists = corners.map((p) => dot(sub(p, plane.origin), plane.normal));
    const allPos = signedDists.every((d) => d > 1e-6);
    const allNeg = signedDists.every((d) => d < -1e-6);
    if (allPos || allNeg) {
      throw new KernelError(t('feature.splitNoIntersection'));
    }

    const index = (s: TopoDS_Shape) => ({
      faces: ShapeIndex.of(oc, s, T.FACE, arena),
      edges: ShapeIndex.of(oc, s, T.EDGE, arena),
      verts: ShapeIndex.of(oc, s, T.VERTEX, arena),
    });

    try {
      const pln = arena.own(new oc.gp_Pln(arena.own(new oc.gp_Ax3(this.pnt(arena, plane.origin), this.dir(arena, plane.normal), this.dir(arena, plane.xDir)))));
      const unbounded = arena.own(arena.own(new oc.BRepBuilderAPI_MakeFace(pln)).Face());
      const posPt = add(plane.origin, plane.normal, 1);
      const negPt = add(plane.origin, plane.normal, -1);
      const hsPos = arena.own(arena.own(new oc.BRepPrimAPI_MakeHalfSpace(unbounded, this.pnt(arena, posPt))).Solid());
      const hsNeg = arena.own(arena.own(new oc.BRepPrimAPI_MakeHalfSpace(unbounded, this.pnt(arena, negPt))).Solid());

      const cut1 = this.boolOp('cut', target, hsPos, t('feature.split'), arena);
      const cut2 = this.boolOp('cut', target, hsNeg, t('feature.split'), arena);

      const raw1 = cut1.Shape();
      const raw2 = cut2.Shape();

      const ia = index(target);
      const ihsPos = index(hsPos);
      const ihsNeg = index(hsNeg);

      try {
        const origins1 = this.history(cut1, { faces: [...ia.faces.keys, ...ihsPos.faces.keys], edges: [...ia.edges.keys, ...ihsPos.edges.keys], verts: [...ia.verts.keys, ...ihsPos.verts.keys] }, raw1, arena);
        const origins2 = this.history(cut2, { faces: [...ia.faces.keys, ...ihsNeg.faces.keys], edges: [...ia.edges.keys, ...ihsNeg.edges.keys], verts: [...ia.verts.keys, ...ihsNeg.verts.keys] }, raw2, arena);

        const unified1 = this.unify(raw1, origins1, arena);
        const unified2 = this.unify(raw2, origins2, arena);

        const id1 = this.put(unified1.shape);
        const id2 = this.put(unified2.shape);

        const res1: OpResult = { shape: id1, faceOrigins: unified1.origins };
        const res2: OpResult = { shape: id2, faceOrigins: unified2.origins };

        const vol1 = this.massProps(id1).volume;
        const vol2 = this.massProps(id2).volume;
        if (vol1 <= 1e-9 || vol2 <= 1e-9) {
          this.release(id1);
          this.release(id2);
          throw new KernelError(t('feature.splitNoIntersection'));
        }

        const solids1 = this.splitSolids(res1);
        const solids2 = this.splitSolids(res2);
        this.release(id1);
        this.release(id2);

        const all = [...solids1, ...solids2];
        if (all.length < 2) {
          for (const s of all) this.release(s.shape);
          throw new KernelError(t('feature.splitNoIntersection'));
        }
        return all.map((s) => ({ shape: s.shape, faceOrigins: s.faceOrigins }));
      } finally {
        for (const i of [ia, ihsPos, ihsNeg]) for (const x of Object.values(i)) x.dispose();
        raw1.delete();
        raw2.delete();
      }
    } finally {
      arena.dispose();
    }
  }

  /** One shape holding all of the given shapes: for showing, measuring and writing several bodies together. */
  join(ids: ShapeId[]): ShapeId {
    const arena = new Arena();
    try {
      return this.put(this.compound(ids.map((id) => this.get(id)), arena));
    } finally {
      arena.dispose();
    }
  }

  /** A copy that shares nothing with the original: two bodies made from one imported file must not share faces. */
  clone(id: ShapeId): ShapeId {
    const arena = new Arena();
    try {
      return this.put(arena.own(new this.oc.BRepBuilderAPI_Copy(this.get(id), true, false)).Shape());
    } finally {
      arena.dispose();
    }
  }

  /**
   * A copy of the shape moved by a transformation of space (patterns, C6.1–C6.3): the 3 × 4 matrix `m` in rows (a11 a12 a13 a14, a21 …, a31 …),
   * its first three columns square and of length one. A turn or a slide keeps the faces, edges and vertices in the order they had; a mirror (a matrix whose
   * determinant is −1) turns the solid inside out and OCCT makes it right again, so a mirrored solid has the volume of the one it came from.
   */
  transformed(id: ShapeId, m: readonly number[]): ShapeId {
    if (m.length !== 12 || !m.every(Number.isFinite)) throw new KernelError(t('kernel.badMotion'));
    // the 3 × 3 part must be a turn or a turn with a mirror (its rows square and of length one): OCCT takes a shear without a word
    const rows = [m.slice(0, 3), m.slice(4, 7), m.slice(8, 11)];
    const square = rows.every((a, i) => rows.every((b, j) => Math.abs(a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]! - (i === j ? 1 : 0)) < 1e-9));
    if (!square) throw new KernelError(t('kernel.motionNotRigid'));
    const oc = this.oc;
    const arena = new Arena();
    try {
      const trsf = arena.own(new oc.gp_Trsf());
      try {
        // SetValues takes the twelve coefficients; its arity is its own, so there is nothing to choose between
        (trsf as unknown as { SetValues(...a: number[]): void }).SetValues(...m);
      } catch (e) {
        throw new KernelError(t('kernel.badMotionWhy', { why: this.errorText(e) }));
      }
      return this.put(arena.own(new oc.BRepBuilderAPI_Transform(this.get(id), trsf, true, false)).Shape());
    } finally {
      arena.dispose();
    }
  }

  /** Constant-radius fillet on the given edges of `target` (C5.1). */
  fillet(target: ShapeId, edgeIndices: number[], radius: number): OpResult {
    if (edgeIndices.length === 0) throw new KernelError(t('kernel.filletNeedsEdge'));
    const oc = this.oc;
    const arena = new Arena();
    const shape = this.get(target);
    const faces = ShapeIndex.of(oc, shape, T.FACE, arena);
    const edges = ShapeIndex.of(oc, shape, T.EDGE, arena);
    const verts = ShapeIndex.of(oc, shape, T.VERTEX, arena);
    try {
      let out: TopoDS_Shape | null = null;
      let lastErr: any = null;
      let usedMk: any = null;
      for (const filletShape of [oc.ChFi3d_FilletShape.ChFi3d_Rational, oc.ChFi3d_FilletShape.ChFi3d_QuasiAngular, oc.ChFi3d_FilletShape.ChFi3d_Polynomial]) {
        try {
          const mk = arena.own(new oc.BRepFilletAPI_MakeFillet(shape, filletShape));
          for (const i of edgeIndices) {
            const e = edges.keys[i];
            if (!e) throw new KernelError(t('kernel.edgeOutOfRange', { index: i }));
            mk.Add(radius, arena.own(oc.TopoDS.Edge(e)));
          }
          const built = this.build(mk, t('feature.fillet'), arena);
          // A fillet OCCT reports as done may still be a body that fails BRepCheck — common on the wavy edges of knurls and threads, where three fillet
          // shapes are tried and the last one comes back "done" but corrupt. Refuse it here: handing a body that fails BRepCheck to whatever runs next is
          // what produces the downstream WASM crashes (AGENTS.md §3.5); a clear refusal is the honest outcome.
          if (!this.valid(built)) throw new KernelError(t('feature.filletInvalid'));
          out = built;
          usedMk = mk;
          break;
        } catch (err) {
          lastErr = err;
        }
      }
      if (!out || !usedMk) throw lastErr;
      return { shape: this.put(out), faceOrigins: this.history(usedMk, { faces: faces.keys, edges: edges.keys, verts: verts.keys }, out, arena) };
    } finally {
      faces.dispose();
      edges.dispose();
      verts.dispose();
      arena.dispose();
    }
  }

  /**
   * A full round fillet (完整圓角, F-3): the flat `center` face between two parallel flat sides is replaced by half a cylinder, tangent to both sides and to the
   * plane the face was in, so its radius is half the distance between the sides. Two fillets of that radius cannot do it (OCCT fails when they take the whole
   * face, ADR 0097); the strip over the half cylinder is cut away instead, which is exact. The center face has to be a rectangle (the volume that went is checked
   * against the half cylinder's, and a face that is not one, or sides that are lower than the radius, make it fail with that said). The new face takes the
   * origin of the center face it replaces.
   */
  fullRound(target: ShapeId, centerFace: number, side1: number[], side2: number[]): OpResult {
    const topo = this.topology(target);
    const plane = (i: number) => {
      const f = topo.faces[i];
      if (!f) throw new KernelError(t('edit.faceOutOfRange', { index: i }));
      if (f.surface !== 'plane' || !f.normal) throw new KernelError(t('kernel.fullRoundSides'));
      return { n: f.normal, c: f.center, area: f.area };
    };
    const [dotp, sub3] = [(a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]];
    const center = plane(centerFace);
    const groups = [side1, side2].map((g) => g.map(plane));
    const firsts = groups.map((g) => g[0]!);
    // the faces of a side lie in one plane
    for (const g of groups) for (const f of g) if (dotp(f.n, g[0]!.n) < 1 - 1e-9 || Math.abs(dotp(sub3(f.c, g[0]!.c), g[0]!.n)) > 1e-6) throw new KernelError(t('kernel.fullRoundSides'));
    const [a, b] = firsts as [typeof center, typeof center];
    if (dotp(a.n, b.n) > -1 + 1e-9 || Math.abs(dotp(a.n, center.n)) > 1e-9) throw new KernelError(t('kernel.fullRoundSides'));
    // the center face meets a face of each side
    const meets = (g: number[]) => topo.edges.some((e) => e.faces.includes(centerFace) && e.faces.some((f) => g.includes(f)));
    if (!meets(side1) || !meets(side2)) throw new KernelError(t('kernel.fullRoundNotAdjacent'));
    const w = Math.abs(dotp(sub3(b.c, a.c), a.n));
    const r = w / 2;
    const nC = center.n;
    const s: Vec3 = [-a.n[0], -a.n[1], -a.n[2]];
    const along = (v: Vec3): Vec3 => [s[1] * v[2] - s[2] * v[1], s[2] * v[0] - s[0] * v[2], s[0] * v[1] - s[1] * v[0]];
    const u = along(nC); // s × nC: the way the edges of the face run
    const box = this.bounds(target);
    const corners: Vec3[] = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => [k & 1 ? box.max[0] : box.min[0], k & 2 ? box.max[1] : box.min[1], k & 4 ? box.max[2] : box.min[2]]);
    const [lo, hi] = [Math.min(...corners.map((c) => dotp(c, u))), Math.max(...corners.map((c) => dotp(c, u)))];
    const margin = 1;
    // the origin of the profile: on the first side, r below the plane of the center face; and `margin` before the body along u
    const up = dotp(center.c, nC) - r - dotp(a.c, nC);
    const onSide: Vec3 = [a.c[0] + nC[0] * up, a.c[1] + nC[1] * up, a.c[2] + nC[2] * up];
    const shift = lo - margin - dotp(onSide, u);
    const origin: Vec3 = [onSide[0] + u[0] * shift, onSide[1] + u[1] * shift, onSide[2] + u[2] * shift];
    const H = r + margin;
    const profile: Region = {
      outer: [
        { kind: 'line', a: [0, 0], b: [0, H], source: 'l0' },
        { kind: 'line', a: [0, H], b: [w, H], source: 'l1' },
        { kind: 'line', a: [w, H], b: [w, 0], source: 'l2' },
        { kind: 'arc', c: [w / 2, 0], r, from: [w, 0], to: [0, 0], ccw: true, source: 'a0' },
      ],
      holes: [],
    };
    const length = hi - lo + 2 * margin;
    const tool = this.extrude({ origin, xDir: s, yDir: nC, normal: u }, [profile], [u[0] * length, u[1] * length, u[2] * length]);
    let result: OpResult;
    try {
      result = this.boolean('cut', target, tool.shape);
    } finally {
      this.release(tool.shape);
    }
    // the volume that went has to be the strip over the half cylinder, along the face: a face that is not a rectangle between the sides, or sides lower than r, are not
    const before = this.massProps(target).volume;
    const after = this.massProps(result.shape).volume;
    const expected = (w * r - (Math.PI * r * r) / 2) * (center.area / w);
    if (!(Math.abs(before - after - expected) <= 1e-6 * Math.max(1, expected))) {
      this.release(result.shape);
      throw new KernelError(t('kernel.fullRoundShape'));
    }
    // the origins that point at the tool's faces (after the target's) are the center face's: the new face is that face, rounded
    const n = topo.faces.length;
    const faceOrigins = result.faceOrigins.map((list) => {
      const own = list.filter((o) => 'kind' in o && o.kind === 'face' && 'index' in o && o.index < n && o.rel !== 'generated');
      return own.length > 0 ? own : [{ rel: 'modified', kind: 'face', index: centerFace } as FaceOrigin];
    });
    return { shape: result.shape, faceOrigins };
  }

  /**
   * Which of these edges the faces on both sides continue smoothly across (tangent continuity, fillet by face): a fillet's own seam, the edge between a
   * face and the round that meets it. The two faces' normals are compared at three places along the edge (the middle and near each end); an edge with
   * not exactly two faces (a seam, an edge of an open shell) is not smooth in this sense, the caller treats those by themselves.
   */
  smoothEdges(target: ShapeId, edgeIndices: number[]): boolean[] {
    const oc = this.oc;
    const arena = new Arena();
    const shape = this.get(target);
    const topo = this.topology(target);
    const faces = ShapeIndex.of(oc, shape, T.FACE, arena);
    const edges = ShapeIndex.of(oc, shape, T.EDGE, arena);
    try {
      const normalAt = (face: TopoDS_Shape, p: Vec3): Vec3 | null => {
        const f = arena.own(oc.TopoDS.Face(face));
        const uv = oc.GeomLib_Tool.Parameters(arena.own(oc.BRep_Tool.Surface(f)), this.pnt(arena, p), 1e-3);
        if (!uv.returnValue) return null;
        const ad = arena.own(new oc.BRepAdaptor_Surface(f, true));
        const d1 = ad.EvalD1(uv.U, uv.V);
        const c = cross3(this.xyz(arena.own(d1.D1U)), this.xyz(arena.own(d1.D1V)));
        arena.own(d1.Point);
        const len = Math.hypot(...c);
        return len < 1e-12 ? null : [c[0] / len, c[1] / len, c[2] / len];
      };
      return edgeIndices.map((i) => {
        const info = topo.edges[i];
        const key = edges.keys[i];
        if (!info || !key) throw new KernelError(t('kernel.edgeOutOfRange', { index: i }));
        const sides = [...new Set(info.faces)];
        if (sides.length !== 2) return false;
        const ad = arena.own(new oc.BRepAdaptor_Curve(arena.own(oc.TopoDS.Edge(key))));
        const [a, b] = [ad.FirstParameter(), ad.LastParameter()];
        return [0.5, 0.15, 0.85].every((k) => {
          const p = this.xyz(arena.own(ad.EvalD0(a + (b - a) * k)));
          const n1 = normalAt(faces.keys[sides[0]!]!, p);
          const n2 = normalAt(faces.keys[sides[1]!]!, p);
          return !!n1 && !!n2 && Math.abs(n1[0] * n2[0] + n1[1] * n2[1] + n1[2] * n2[2]) > 1 - 1e-6;
        });
      });
    } finally {
      faces.dispose();
      edges.dispose();
      arena.dispose();
    }
  }

  /**
   * Chamfer (C5.3). Each edge names the adjacent face its first distance is measured on:
   * distance–distance takes two lengths, angle–distance a length and an angle (radians).
   */
  chamfer(target: ShapeId, specs: { edge: number; face: number }[], mode: 'distanceDistance' | 'angleDistance', d1: number, d2: number): OpResult {
    if (specs.length === 0) throw new KernelError(t('kernel.chamferNeedsEdge'));
    const oc = this.oc;
    const arena = new Arena();
    const shape = this.get(target);
    const faces = ShapeIndex.of(oc, shape, T.FACE, arena);
    const edges = ShapeIndex.of(oc, shape, T.EDGE, arena);
    const verts = ShapeIndex.of(oc, shape, T.VERTEX, arena);
    try {
      const mk = arena.own(new oc.BRepFilletAPI_MakeChamfer(shape));
      for (const s of specs) {
        const e = edges.keys[s.edge];
        const f = faces.keys[s.face];
        if (!e || !f) throw new KernelError(t('kernel.edgeFaceOutOfRange', { edge: s.edge, face: s.face }));
        const edge = arena.own(oc.TopoDS.Edge(e));
        const face = arena.own(oc.TopoDS.Face(f));
        if (mode === 'distanceDistance') mk.Add(d1, d2, edge, face);
        else mk.AddDA(d1, d2, edge, face);
      }
      const out = this.build(mk, t('feature.chamfer'), arena);
      return { shape: this.put(out), faceOrigins: this.history(mk, { faces: faces.keys, edges: edges.keys, verts: verts.keys }, out, arena) };
    } finally {
      faces.dispose();
      edges.dispose();
      verts.dispose();
      arena.dispose();
    }
  }

  /**
   * Deletes faces and heals the gap (C10.2): the neighbours are extended until they meet, so a hole or a
   * fillet disappears and the body stays one valid solid (OCCT's defeaturing). Every face asked for must
   * really be gone afterwards; a face OCCT could not remove is an error, never a silent partial result.
   * Neighbours keep their origin ("modified"); no face is new.
   */
  deleteFaces(target: ShapeId, faceIndices: number[]): OpResult {
    if (faceIndices.length === 0) throw new KernelError(t('edit.noFacesToDelete'));
    const oc = this.oc;
    const arena = new Arena();
    const shape = this.get(target);
    const faces = ShapeIndex.of(oc, shape, T.FACE, arena);
    try {
      const df = arena.own(new oc.BRepAlgoAPI_Defeaturing());
      df.SetShape(shape);
      df.SetToFillHistory(true);
      for (const i of new Set(faceIndices)) {
        const f = faces.keys[i];
        if (!f) throw new KernelError(t('edit.faceOutOfRange', { index: i }));
        df.AddFaceToRemove(f);
      }
      try {
        df.Build(arena.own(new oc.Message_ProgressRange()));
      } catch (e) {
        throw new KernelError(t('edit.deleteFailed', { reason: this.errorText(e) }));
      }
      if (df.HasErrors() || !df.IsDone()) throw new KernelError(t('edit.deleteFailed', { reason: t('edit.cannotFillGap') }));
      const stuck = [...new Set(faceIndices)].filter((i) => !df.IsDeleted(faces.keys[i]!));
      if (stuck.length > 0) throw new KernelError(t('edit.deleteFailed', { reason: t('edit.facesNotRemoved', { n: stuck.length }) }));
      const out = df.Shape();
      if (!this.valid(out)) {
        out.delete();
        throw new KernelError(t('edit.deleteInvalid'));
      }
      const edges = ShapeIndex.of(oc, shape, T.EDGE, arena);
      const verts = ShapeIndex.of(oc, shape, T.VERTEX, arena);
      try {
        return { shape: this.put(out), faceOrigins: this.history(df, { faces: faces.keys, edges: [], verts: [] }, out, arena) };
      } finally {
        edges.dispose();
        verts.dispose();
      }
    } finally {
      faces.dispose();
      arena.dispose();
    }
  }

  /**
   * Leans the picked faces of a body (draft feature, C5.5) by angle about the neutral plane, pulled along pull; a positive angle narrows
   * them along pull. The faces keep their identity (modified), so their names do not change. A face that cannot lean is an error.
   */
  draft(target: ShapeId, faceIndices: number[], pull: Vec3, neutral: { origin: Vec3; normal: Vec3 }, angle: number): OpResult {
    if (faceIndices.length === 0) throw new KernelError(t('feature.draftNoFaces'));
    const arena = new Arena();
    const shape = this.get(target);
    const faces = ShapeIndex.of(this.oc, shape, T.FACE, arena);
    try {
      const origins = faces.keys.map((_, index): FaceOrigin[] => [{ rel: 'modified', kind: 'face', index }]);
      const r = this.draftFaces(shape, origins, [...new Set(faceIndices)], pull, neutral, angle, arena);
      return { shape: this.put(r.shape), faceOrigins: r.origins };
    } finally {
      faces.dispose();
      arena.dispose();
    }
  }

  /**
   * Hollows a body out (shell, C5.4): the faces asked for are taken away to open it, and the wall left is `thickness` thick, inside the old
   * surface or (`outward`) outside it. The faces that stay keep their origin; the inside of the wall is generated from the face it lies against;
   * a face that was opened is the rim of the wall. A shell OCCT cannot build (a wall thicker than the body allows) is an error.
   */
  shell(target: ShapeId, faceIndices: number[], thickness: number, outward: boolean): OpResult {
    if (faceIndices.length === 0) throw new KernelError(t('feature.shellNoFaces'));
    if (!(thickness > 0)) throw new KernelError(t('feature.shellThickness'));
    const oc = this.oc;
    const arena = new Arena();
    const shape = this.get(target);
    const faces = ShapeIndex.of(oc, shape, T.FACE, arena);
    try {
      const closing = arena.own(new oc.NCollection_List_TopoDS_Shape());
      for (const i of new Set(faceIndices)) {
        const f = faces.keys[i];
        if (!f) throw new KernelError(t('edit.faceOutOfRange', { index: i }));
        closing.Append(f);
      }
      const mk = arena.own(new oc.BRepOffsetAPI_MakeThickSolid());
      try {
        mk.MakeThickSolidByJoin(shape, closing, outward ? thickness : -thickness, 1e-4, oc.BRepOffset_Mode.BRepOffset_Skin, false, false, oc.GeomAbs_JoinType.GeomAbs_Intersection, false, arena.own(new oc.Message_ProgressRange()));
        mk.Build(arena.own(new oc.Message_ProgressRange()));
      } catch (e) {
        throw new KernelError(t('feature.shellFailed', { reason: this.errorText(e) }));
      }
      if (!mk.IsDone()) throw new KernelError(t('feature.shellFailed', { reason: t('feature.shellTooThick') }));
      const out = mk.Shape();
      if (!this.valid(out)) {
        out.delete();
        throw new KernelError(t('feature.shellFailed', { reason: t('feature.shellTooThick') }));
      }
      const outFaces = ShapeIndex.of(oc, out, T.FACE, arena);
      try {
        const origins: FaceOrigin[][] = outFaces.keys.map(() => []);
        faces.keys.forEach((f, index) => {
          const modified = this.list(mk.Modified(f));
          if (modified.length > 0) {
            for (const m of modified) {
              const j = outFaces.indexOf(m);
              if (j >= 0) origins[j]!.push({ rel: 'modified', kind: 'face', index });
              m.delete();
            }
          } else if (!mk.IsDeleted(f)) {
            const j = outFaces.indexOf(f);
            if (j >= 0) origins[j]!.push({ rel: 'same', kind: 'face', index });
          }
          for (const g of this.list(mk.Generated(f))) {
            const j = outFaces.indexOf(g);
            if (j >= 0) origins[j]!.push({ rel: 'generated', kind: 'face', index });
            g.delete();
          }
        });
        // OCCT can answer "done" and hand back the body untouched (an opened face with a fillet along its edge does): nothing generated is a failure
        if (!origins.some((o) => o.some((x) => x.rel === 'generated'))) {
          out.delete();
          throw new KernelError(t('feature.shellFailed', { reason: t('feature.shellNothingMade') }));
        }
        return { shape: this.put(out), faceOrigins: origins };
      } finally {
        outFaces.dispose();
      }
    } finally {
      faces.dispose();
      arena.dispose();
    }
  }

  /**
   * Moves a planar face `distance` along its outward normal (C10.1, negative = into the material); its
   * neighbours stretch or shrink to follow. OCCT has no face-offset operation in this build, so the
   * change is made as a slab: a plate on the face's plane, `distance` thick, cut down by the surface of
   * every face next to it (each extended past its own boundary, on the side of the face) and then fused
   * to or cut from the body. A slanted wall therefore stays slanted. A neighbour that continues the
   * face smoothly (a fillet round its edge) has no such "side", so it is refused rather than guessed.
   * Origins index the body's faces: the moved face keeps its own, the slab's side faces take their neighbour's.
   */
  moveFace(target: ShapeId, faceIndex: number, distance: number): OpResult {
    if (!Number.isFinite(distance) || Math.abs(distance) < 1e-9) throw new KernelError(t('edit.distanceZero'));
    const oc = this.oc;
    const arena = new Arena();
    const shape = this.get(target);
    const topo = this.topology(target);
    const info = topo.faces[faceIndex];
    if (!info) throw new KernelError(t('edit.faceOutOfRange', { index: faceIndex }));
    if (info.surface !== 'plane' || !info.normal) throw new KernelError(t('edit.planeOnly'));
    const n = info.normal;
    const faces = ShapeIndex.of(oc, shape, T.FACE, arena);
    const edges = ShapeIndex.of(oc, shape, T.EDGE, arena);
    const nTarget = faces.size;
    const slabFaces: ShapeIndex[] = [];
    try {
      const face = arena.own(oc.TopoDS.Face(faces.keys[faceIndex]!));
      const { min, max } = this.bounds(target);
      const reach = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) * 4 + Math.abs(distance) + 10;

      // The neighbours: every other face sharing an edge with this one, with those edges.
      const sharing = new Map<number, number[]>();
      topo.edges.forEach((e, ei) => {
        if (e.curve === 'degenerated' || !e.faces.includes(faceIndex)) return;
        for (const g of e.faces) if (g !== faceIndex) sharing.set(g, [...(sharing.get(g) ?? []), ei]);
      });

      /** Points along an edge (the middle, then near each end): where the neighbour's direction is looked at. */
      const along = (edge: TopoDS_Shape): Vec3[] => {
        const ad = arena.own(new oc.BRepAdaptor_Curve(arena.own(oc.TopoDS.Edge(edge))));
        const a = ad.FirstParameter();
        const b = ad.LastParameter();
        return [0.5, 0.15, 0.85].map((k) => this.xyz(arena.own(ad.EvalD0(a + (b - a) * k))));
      };

      /** The face's normal at a point of its surface under `p` (sign aside). */
      const normalAt = (g: TopoDS_Shape, p: Vec3): Vec3 => {
        const gFace = arena.own(oc.TopoDS.Face(g));
        const uv = oc.GeomLib_Tool.Parameters(arena.own(oc.BRep_Tool.Surface(gFace)), this.pnt(arena, p), 1e-3);
        if (!uv.returnValue) throw new KernelError(t('edit.noSurfacePoint'));
        const ad = arena.own(new oc.BRepAdaptor_Surface(gFace, true));
        const d1 = ad.EvalD1(uv.U, uv.V);
        const c = cross3(this.xyz(arena.own(d1.D1U)), this.xyz(arena.own(d1.D1V)));
        arena.own(d1.Point);
        const len = Math.hypot(...c) || 1;
        return [c[0] / len, c[1] / len, c[2] / len];
      };

      // A point of the face next to an edge, to tell on which side of the neighbour's surface the face lies.
      const insidePoint = (edge: TopoDS_Shape, ei: number): Vec3 => {
        const ad = arena.own(new oc.BRepAdaptor_Curve(arena.own(oc.TopoDS.Edge(edge))));
        const d1 = ad.EvalD1((ad.FirstParameter() + ad.LastParameter()) / 2);
        const tangent = this.xyz(arena.own(d1.D1));
        const m = this.xyz(arena.own(d1.Point));
        const w = cross3(n, tangent);
        const wl = Math.hypot(...w) || 1;
        const eps = Math.max(1e-5, Math.min(1e-3 * topo.edges[ei]!.length, 1e-2));
        for (const s of [1, -1]) {
          const p = add(m, w, (s * eps) / wl);
          const pnt = this.pnt(arena, p);
          const c = new oc.BRepClass_FaceClassifier(face, pnt, 1e-7, true, 0.1);
          try {
            if (c.State() === oc.TopAbs_State.TopAbs_IN) return p;
          } finally {
            c.delete();
          }
        }
        throw new KernelError(t('edit.noPointNearEdge'));
      };

      // How the neighbours stand to the face. Tangent to it: refused (no side to take). Square to it all along: the
      // face can simply be swept, whatever its shape. Anything else: the slab trimmed by the neighbours' surfaces.
      let square = true;
      for (const [g, via] of sharing) {
        for (const ei of via) {
          for (const p of along(edges.keys[ei]!)) {
            const ng = normalAt(faces.keys[g]!, p);
            const across = Math.abs(n[0] * ng[0] + n[1] * ng[1] + n[2] * ng[2]);
            if (across > 1 - 1e-6) throw new KernelError(t('edit.tangentNeighbour'));
            if (across > 1e-6) square = false;
          }
        }
      }

      const moved: FaceOrigin = { rel: 'modified', kind: 'face', index: faceIndex };
      const vector = arena.own(new oc.gp_Vec(n[0] * distance, n[1] * distance, n[2] * distance));
      interface Slab {
        shape: TopoDS_Shape;
        index: ShapeIndex;
        origins: FaceOrigin[][];
      }

      /** The face itself swept along its normal: its sides lie on the neighbours' planes already (all square to it). */
      const sweep = (): Slab => {
        const mkPrism = arena.own(new oc.BRepPrimAPI_MakePrism(face, vector, false, true));
        const shape = arena.own(this.build(mkPrism, t('edit.moveFace'), arena));
        const index = ShapeIndex.of(oc, shape, T.FACE, arena);
        slabFaces.push(index);
        const origins: FaceOrigin[][] = index.keys.map(() => []);
        for (const end of [mkPrism.FirstShape(), mkPrism.LastShape()]) {
          const i = index.indexOf(end);
          if (i >= 0) origins[i] = [moved];
          end.delete();
        }
        // a side of the sweep is named after the face across the edge it was swept from
        for (const ex = arena.own(new oc.TopExp_Explorer(face, T.EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE)); ex.More(); ex.Next()) {
          const edge = ex.Current();
          const ei = edges.indexOf(edge);
          const across = ei < 0 ? undefined : topo.edges[ei]!.faces.find((g) => g !== faceIndex);
          for (const s of this.list(mkPrism.Generated(edge))) {
            const i = index.indexOf(s);
            if (i >= 0 && across !== undefined) origins[i] = [{ rel: 'modified', kind: 'face', index: across }];
            s.delete();
          }
          edge.delete();
        }
        return { shape, index, origins };
      };

      /** A plate on the face's plane, `distance` along the normal, trimmed by each neighbour's surface. */
      const trim = (): Slab => {
        const plane = arena.own(new oc.gp_Pln(this.pnt(arena, info.center), this.dir(arena, n)));
        const plate = arena.own(arena.own(new oc.BRepBuilderAPI_MakeFace(plane, -reach, reach, -reach, reach)).Face());
        const mkPrism = arena.own(new oc.BRepPrimAPI_MakePrism(plate, vector, false, true));
        let shape = arena.own(this.build(mkPrism, t('edit.moveFace'), arena));
        let index = ShapeIndex.of(oc, shape, T.FACE, arena);
        slabFaces.push(index);
        let origins: FaceOrigin[][] = index.keys.map(() => []);
        const start = mkPrism.FirstShape();
        /** The face of the plate that lies on the face's own plane. */
        let base = index.indexOf(start);
        start.delete();
        for (const end of [mkPrism.FirstShape(), mkPrism.LastShape()]) {
          const i = index.indexOf(end);
          if (i >= 0) origins[i] = [moved];
          end.delete();
        }

        for (const [g, via] of sharing) {
          const gShape = faces.keys[g]!;
          const p = insidePoint(edges.keys[via[0]!]!, via[0]!);
          const surface = arena.own(oc.BRep_Tool.Surface(arena.own(oc.TopoDS.Face(gShape))));
          const unbounded = arena.own(arena.own(new oc.BRepBuilderAPI_MakeFace(surface, 1e-7)).Face());
          const half = arena.own(arena.own(new oc.BRepPrimAPI_MakeHalfSpace(unbounded, this.pnt(arena, p))).Solid());
          const halfIndex = ShapeIndex.of(oc, half, T.FACE, arena);
          slabFaces.push(halfIndex);
          const mk = this.boolOp('common', shape, half, t('edit.moveFace'), arena);
          const next = arena.own(mk.Shape());
          const sources = this.faceSources(mk, [...index.keys, ...halfIndex.keys], next, arena);
          const nSlab = index.size;
          const side: FaceOrigin = { rel: 'modified', kind: 'face', index: g };
          const before = origins;
          origins = sources.map((s) => s.flatMap((i): FaceOrigin[] => (i < nSlab ? before[i]! : [side])));
          shape = next;
          index = ShapeIndex.of(oc, shape, T.FACE, arena);
          slabFaces.push(index);
          if (index.size === 0) throw new KernelError(t('edit.noOverlap'));
          base = sources.findIndex((s) => s.includes(base));
        }
        // Each neighbour's surface cuts the whole plate, so a face that is not convex (an L, a ring) would lose its
        // far arms to the surface of an edge on the other arm. The slab's face on the plane must still be the face itself.
        const p = arena.own(new oc.GProp_GProps());
        oc.BRepGProp.SurfaceProperties(index.keys[base]!, p, false, false);
        if (Math.abs(p.Mass() - info.area) > 1e-6 * info.area) throw new KernelError(t('edit.notConvex'));
        return { shape, index, origins };
      };

      // Faces with curved neighbours (the wall of a hole) are trimmed when they can be: that keeps the wall one face with
      // its own name, where a sweep would leave a second face on the same cylinder. Square to every neighbour, a face
      // of any shape can be swept instead, and when every neighbour is a plane there is nothing to keep whole.
      const planarAround = [...sharing.keys()].every((g) => topo.faces[g]!.surface === 'plane');
      let made: Slab;
      if (square && planarAround) made = sweep();
      else if (!square) made = trim();
      else {
        try {
          made = trim();
        } catch (e) {
          if (!(e instanceof KernelError)) throw e;
          made = sweep();
        }
      }
      const slab = made.shape;
      const slabIndex = made.index;
      const slabOrigins = made.origins;

      const mk = this.boolOp(distance > 0 ? 'fuse' : 'cut', shape, slab, t('edit.moveFace'), arena);
      const raw = mk.Shape();
      try {
        const origins = this.history(mk, { faces: [...faces.keys, ...slabIndex.keys], edges: [], verts: [] }, raw, arena);
        // only the faces round the moved one may be regrouped (see unify)
        const touched = new Set([faceIndex, ...sharing.keys()]);
        const apart = topo.edges.flatMap((e, ei) => (e.faces.length > 0 && e.faces.every((g) => !touched.has(g)) ? [edges.keys[ei]!] : []));
        const unified = this.unify(raw, origins, arena, apart);
        if (!this.valid(unified.shape)) {
          unified.shape.delete();
          throw new KernelError(t('edit.moveInvalid'));
        }
        // A face of the slab is named after the face of the body it stands for.
        const same = (a: FaceOrigin, b: FaceOrigin) => JSON.stringify(a) === JSON.stringify(b);
        const faceOrigins = unified.origins.map((list) => {
          const out: FaceOrigin[] = [];
          for (const o of list) {
            const expanded = o.rel !== 'cap' && o.rel !== 'imported' && o.kind === 'face' && o.index >= nTarget ? slabOrigins[o.index - nTarget]! : [o];
            for (const x of expanded) if (!out.some((y) => same(x, y))) out.push(x);
          }
          return out;
        });
        const result = this.put(unified.shape);
        // Pushed into the material by more than the body is thick there, the sweep comes out of the far side:
        // what is taken away is then less than the face's area times the distance. Never hand that over as done.
        if (square && distance < 0) {
          // volumes of a body of thousands of faces are good to about 1e-6 of the whole, so only a clear shortfall counts
          const before = this.massProps(target).volume;
          const taken = before - this.massProps(result).volume;
          if (taken < info.area * -distance * (1 - 1e-3) - 1e-6 * before) {
            this.release(result);
            throw new KernelError(t('edit.moveTooFar'));
          }
        }
        return { shape: result, faceOrigins };
      } finally {
        raw.delete();
      }
    } finally {
      for (const s of slabFaces) s.dispose();
      faces.dispose();
      edges.dispose();
      arena.dispose();
    }
  }

  /** For each output face: the indices of the input faces it is (or was modified from). */
  private faceSources(mk: BRepBuilderAPI_MakeShape, inputs: TopoDS_Shape[], out: TopoDS_Shape, arena: Arena): number[][] {
    const outFaces = ShapeIndex.of(this.oc, out, T.FACE, arena);
    try {
      const sources: number[][] = outFaces.keys.map(() => []);
      inputs.forEach((f, index) => {
        if (mk.IsDeleted(f)) return;
        const modified = this.list(mk.Modified(f));
        const targets = modified.length > 0 ? modified.map((m) => outFaces.indexOf(m)) : [outFaces.indexOf(f)];
        for (const m of modified) m.delete();
        for (const j of targets) if (j >= 0) sources[j]!.push(index);
      });
      return sources;
    } finally {
      outFaces.dispose();
    }
  }

  /**
   * Generic provenance from a BRepBuilderAPI_MakeShape: same / modified faces and faces generated
   * from edges or vertices. Inputs are lists, so operations with two inputs pass them concatenated.
   */
  private history(
    mk: BRepBuilderAPI_MakeShape,
    inputs: { faces: TopoDS_Shape[]; edges: TopoDS_Shape[]; verts: TopoDS_Shape[] },
    out: TopoDS_Shape,
    arena: Arena,
  ): FaceOrigin[][] {
    const outFaces = ShapeIndex.of(this.oc, out, T.FACE, arena);
    try {
      const origins: FaceOrigin[][] = outFaces.keys.map(() => []);
      const mark = (shapes: TopoDS_Shape[], origin: FaceOrigin) => {
        for (const s of shapes) {
          const i = outFaces.indexOf(s);
          if (i >= 0) origins[i]!.push(origin);
          s.delete();
        }
      };
      inputs.faces.forEach((f, index) => {
        if (mk.IsDeleted(f)) return;
        const modified = this.list(mk.Modified(f));
        if (modified.length > 0) {
          mark(modified, { rel: 'modified', kind: 'face', index });
        } else {
          const i = outFaces.indexOf(f);
          if (i >= 0) origins[i]!.push({ rel: 'same', kind: 'face', index });
        }
      });
      inputs.edges.forEach((e, index) => mark(this.list(mk.Generated(e)), { rel: 'generated', kind: 'edge', index }));
      inputs.verts.forEach((v, index) => mark(this.list(mk.Generated(v)), { rel: 'generated', kind: 'vertex', index }));
      return origins;
    } finally {
      outFaces.dispose();
    }
  }

  // ------------------------------------------------------------------ queries

  topology(id: ShapeId): Topology {
    const oc = this.oc;
    const arena = new Arena();
    const shape = this.get(id);
    const faces = ShapeIndex.of(oc, shape, T.FACE, arena);
    const edges = ShapeIndex.of(oc, shape, T.EDGE, arena);
    const verts = ShapeIndex.of(oc, shape, T.VERTEX, arena);
    try {
      const children = (s: TopoDS_Shape, type: string, index: ShapeIndex): number[] => {
        const found = new Set<number>();
        const ex = arena.own(new oc.TopExp_Explorer(s, type as never, oc.TopAbs_ShapeEnum.TopAbs_SHAPE));
        for (; ex.More(); ex.Next()) {
          const c = ex.Current();
          const i = index.indexOf(c);
          if (i >= 0) found.add(i);
          c.delete();
        }
        return [...found];
      };
      const edgeFaces: number[][] = edges.keys.map(() => []);
      const vertexFaces: number[][] = verts.keys.map(() => []);
      const faceInfos: FaceInfo[] = faces.keys.map((f, fi) => {
        for (const ei of children(f, T.EDGE, edges)) edgeFaces[ei]!.push(fi);
        for (const vi of children(f, T.VERTEX, verts)) vertexFaces[vi]!.push(fi);
        return this.faceInfo(f, arena);
      });
      const edgeInfos: EdgeInfo[] = edges.keys.map((e, ei) => ({
        ...this.edgeInfo(e, arena),
        faces: edgeFaces[ei]!,
        vertices: children(e, T.VERTEX, verts),
      }));
      const vertexInfos: VertexInfo[] = verts.keys.map((v, vi) => ({
        point: this.xyz(arena.own(oc.BRep_Tool.Pnt(arena.own(oc.TopoDS.Vertex(v))))),
        faces: vertexFaces[vi]!,
      }));
      return { faces: faceInfos, edges: edgeInfos, vertices: vertexInfos };
    } finally {
      faces.dispose();
      edges.dispose();
      verts.dispose();
      arena.dispose();
    }
  }

  private faceInfo(f: TopoDS_Shape, arena: Arena): FaceInfo {
    const oc = this.oc;
    const face = arena.own(oc.TopoDS.Face(f));
    const ad = arena.own(new oc.BRepAdaptor_Surface(face, true));
    const type = ad.GetType();
    const props = arena.own(new oc.GProp_GProps());
    oc.BRepGProp.SurfaceProperties(face, props, false, false);
    const reversed = face.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED;
    const surface = String(type).replace('GeomAbs_', '').toLowerCase();
    const center = this.xyz(arena.own(props.CentreOfMass()));
    const xyz = (v: { X(): number; Y(): number; Z(): number; delete(): void }) => this.xyz(arena.own(v));
    // The face's outward normal at the middle of its parameter range: the surface's own normal
    // (∂u × ∂v), turned round on a reversed face. The frames that Plane(), Cylinder() … report do not
    // follow the parametrization for surfaces of revolution (a revolved line's plane may point either
    // way), so they give the axis and size, never the side.
    const d1 = ad.EvalD1((ad.FirstUParameter() + ad.LastUParameter()) / 2, (ad.FirstVParameter() + ad.LastVParameter()) / 2);
    const at = xyz(d1.Point);
    const n = cross3(xyz(d1.D1U), xyz(d1.D1V));
    const out: Vec3 = reversed ? [-n[0], -n[1], -n[2]] : n;
    /** Whether the outward normal points away from `from` (seen across `axis`, when given). */
    const away = (from: Vec3, axis?: Vec3) => {
      const v: Vec3 = [at[0] - from[0], at[1] - from[1], at[2] - from[2]];
      const r = axis ? sub3(v, scale3(axis, dot3(v, axis))) : v;
      return dot3(out, r) > 0;
    };
    let normal: Vec3 | null = null;
    let geometry: SurfaceGeometry | undefined;
    if (surface === 'plane') {
      const d = xyz(arena.own(arena.own(ad.Plane()).Axis()).Direction());
      normal = dot3(d, out) < 0 ? [-d[0], -d[1], -d[2]] : d;
      geometry = { type: 'plane', origin: center, normal };
    } else if (surface === 'cylinder') {
      const s = arena.own(ad.Cylinder());
      const axis = arena.own(s.Axis());
      const origin = xyz(axis.Location());
      const dir = xyz(axis.Direction());
      geometry = { type: 'cylinder', origin, axis: dir, radius: s.Radius(), convex: away(origin, dir) };
    } else if (surface === 'cone') {
      const s = arena.own(ad.Cone());
      const apex = xyz(s.Apex());
      const dir = xyz(arena.own(s.Axis()).Direction());
      geometry = { type: 'cone', apex, axis: dir, halfAngle: s.SemiAngle(), convex: away(apex, dir) };
    } else if (surface === 'sphere') {
      const s = arena.own(ad.Sphere());
      const c = xyz(s.Location());
      geometry = { type: 'sphere', center: c, radius: s.Radius(), convex: away(c) };
    } else if (surface === 'torus') {
      const s = arena.own(ad.Torus());
      const c = xyz(s.Location());
      const dir = xyz(arena.own(s.Axis()).Direction());
      // The tube's center line, where it passes the evaluated point.
      const v: Vec3 = [at[0] - c[0], at[1] - c[1], at[2] - c[2]];
      const radial = sub3(v, scale3(dir, dot3(v, dir)));
      const ring = scale3(radial, s.MajorRadius() / (Math.hypot(...radial) || 1));
      geometry = { type: 'torus', center: c, axis: dir, major: s.MajorRadius(), minor: s.MinorRadius(), convex: away([c[0] + ring[0], c[1] + ring[1], c[2] + ring[2]]) };
    }
    return { surface, area: props.Mass(), center, normal, ...(geometry ? { geometry } : {}) };
  }

  private edgeInfo(e: TopoDS_Shape, arena: Arena): Omit<EdgeInfo, 'faces' | 'vertices'> {
    const oc = this.oc;
    const edge = arena.own(oc.TopoDS.Edge(e));
    if (oc.BRep_Tool.Degenerated(edge)) return { curve: 'degenerated', length: 0, mid: [0, 0, 0], dir: null };
    const ad = arena.own(new oc.BRepAdaptor_Curve(edge));
    const type = String(ad.GetType()).replace('GeomAbs_', '').toLowerCase();
    const t0 = ad.FirstParameter();
    const t1 = ad.LastParameter();
    const props = arena.own(new oc.GProp_GProps());
    oc.BRepGProp.LinearProperties(edge, props, false, false);
    const p0 = this.xyz(arena.own(ad.EvalD0(t0)));
    const p1 = this.xyz(arena.own(ad.EvalD0(t1)));
    let dir: Vec3 | null = null;
    let geometry: CurveGeometry | undefined;
    if (type === 'line') {
      const d: Vec3 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
      const n = Math.hypot(...d) || 1;
      dir = [d[0] / n, d[1] / n, d[2] / n];
      geometry = { type: 'line', origin: p0, dir };
    } else if (type === 'circle') {
      const c = arena.own(ad.Circle());
      const axis = arena.own(c.Axis());
      geometry = { type: 'circle', center: this.xyz(arena.own(axis.Location())), normal: this.xyz(arena.own(axis.Direction())), radius: c.Radius() };
    } else if (type === 'bsplinecurve' || type === 'beziercurve' || type === 'othercurve' || type === 'ellipse') {
      const SAMPLES = 7;
      const samples: Vec3[] = [];
      for (let s = 0; s < SAMPLES; s++) {
        const t = t0 + (t1 - t0) * (s / (SAMPLES - 1));
        samples.push(this.xyz(arena.own(ad.EvalD0(t))));
      }
      geometry = { type: 'bspline', samples };
    }
    return { curve: type, length: props.Mass(), mid: this.xyz(arena.own(ad.EvalD0((t0 + t1) / 2))), dir, ...(geometry ? { geometry } : {}) };
  }

  /**
   * Samples a 3D edge along its arc length (C6.4, ADR 0166).
   * Supports equal spacing (dividing curve equally) or specified step distance.
   */
  sampleEdgeCurve(
    target: ShapeId,
    edgeIndex: number,
    options: { count: number; equal: boolean; spacing?: number; reverse?: boolean },
  ): EdgeSamplingResult {
    const oc = this.oc;
    const arena = new Arena();
    try {
      const shape = this.get(target);
      const edges = ShapeIndex.of(oc, shape, T.EDGE, arena);
      const edgeShape = edges.keys[edgeIndex];
      if (!edgeShape) throw new KernelError(t('kernel.edgeOutOfRange', { index: edgeIndex }));
      const edge = arena.own(oc.TopoDS.Edge(edgeShape));
      if (oc.BRep_Tool.Degenerated(edge)) throw new KernelError(t('kernel.edgeDegenerated'));

      const ad = arena.own(new oc.BRepAdaptor_Curve(edge));
      const t0 = ad.FirstParameter();
      const t1 = ad.LastParameter();

      const props = arena.own(new oc.GProp_GProps());
      oc.BRepGProp.LinearProperties(edge, props, false, false);
      const totalLength = props.Mass();
      if (!(totalLength > 1e-9)) throw new KernelError(t('kernel.edgeZeroLength'));

      const p0 = this.xyz(arena.own(ad.EvalD0(t0)));
      const p1 = this.xyz(arena.own(ad.EvalD0(t1)));
      const closed = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]) < 1e-6;

      const N = Math.round(options.count);
      if (!(N >= 2)) throw new KernelError(t('kernel.sampleCountTooSmall'));

      const evalAtParam = (u: number): EdgeSample => {
        const d1 = ad.EvalD1(u);
        const pt = this.xyz(arena.own(d1.Point));
        const tg = this.xyz(arena.own(d1.D1));
        const len = Math.hypot(...tg) || 1;
        const tangent: Vec3 = [tg[0] / len, tg[1] / len, tg[2] / len];
        return { point: pt, tangent, parameter: u };
      };

      const samples: EdgeSample[] = [];

      if (options.equal) {
        const div = closed ? N : N - 1;
        const ua = arena.own(new oc.GCPnts_UniformAbscissa(ad, div + 1, -1));
        const nb = ua.NbPoints();
        const countToTake = closed ? Math.min(N, nb - 1) : Math.min(N, nb);
        for (let i = 1; i <= countToTake; i++) {
          samples.push(evalAtParam(ua.Parameter(i)));
        }
        // Fallback in case GCPnts gave fewer points
        while (samples.length < N) {
          const frac = samples.length / (div || 1);
          const u = t0 + (t1 - t0) * frac;
          samples.push(evalAtParam(u));
        }
      } else {
        const step = options.spacing ?? 10;
        if (!(step > 1e-9)) throw new KernelError(t('kernel.spacingPositive'));
        samples.push(evalAtParam(t0));
        for (let i = 1; i < N; i++) {
          const s = i * step;
          if (s >= totalLength - 1e-9) {
            // Extrapolate beyond curve end along final tangent
            const last = samples[samples.length - 1]!;
            const delta = step;
            const pt: Vec3 = [
              last.point[0] + last.tangent[0] * delta,
              last.point[1] + last.tangent[1] * delta,
              last.point[2] + last.tangent[2] * delta,
            ];
            samples.push({ point: pt, tangent: last.tangent, parameter: t1 });
          } else {
            const ap = arena.own(new oc.GCPnts_AbscissaPoint(ad, s, t0));
            if (ap.IsDone()) {
              samples.push(evalAtParam(ap.Parameter()));
            } else {
              const u = t0 + (s / totalLength) * (t1 - t0);
              samples.push(evalAtParam(u));
            }
          }
        }
      }

      if (options.reverse) {
        samples.reverse();
        for (const s of samples) {
          s.tangent = [-s.tangent[0], -s.tangent[1], -s.tangent[2]];
        }
      }

      return { samples, length: totalLength, closed };
    } finally {
      arena.dispose();
    }
  }

  /**
   * Samples a 2D sketch path wire in 3D space along its arc length (C6.4, ADR 0166).
   */
  samplePathCurve(
    pathFrame: Frame,
    path: Segment[],
    options: { count: number; equal: boolean; spacing?: number; reverse?: boolean },
  ): EdgeSamplingResult {
    const oc = this.oc;
    const arena = new Arena();
    try {
      if (path.length === 0) throw new KernelError(t('feature.sweepNoPath'));
      const pathSources = new Map<TopoDS_Shape, string>();
      const spine = this.wire(arena, pathFrame, path, false, pathSources);
      const props = arena.own(new oc.GProp_GProps());
      oc.BRepGProp.LinearProperties(spine, props, false, false);
      const totalLength = props.Mass();
      if (!(totalLength > 1e-9)) throw new KernelError(t('kernel.edgeZeroLength'));

      const cc = arena.own(new oc.BRepAdaptor_CompCurve(spine, false));
      const t0 = cc.FirstParameter();
      const t1 = cc.LastParameter();
      const p0 = this.xyz(arena.own(cc.EvalD0(t0)));
      const p1 = this.xyz(arena.own(cc.EvalD0(t1)));
      const closed = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]) < 1e-6;

      const N = Math.round(options.count);
      if (!(N >= 2)) throw new KernelError(t('kernel.sampleCountTooSmall'));

      const evalAtParam = (u: number): EdgeSample => {
        const d1 = cc.EvalD1(u);
        const pt = this.xyz(arena.own(d1.Point));
        const tg = this.xyz(arena.own(d1.D1));
        const len = Math.hypot(...tg) || 1;
        const tangent: Vec3 = [tg[0] / len, tg[1] / len, tg[2] / len];
        return { point: pt, tangent, parameter: u };
      };

      const samples: EdgeSample[] = [];

      if (options.equal) {
        const div = closed ? N : N - 1;
        const ua = arena.own(new oc.GCPnts_UniformAbscissa(cc, div + 1, -1));
        const nb = ua.NbPoints();
        const countToTake = closed ? Math.min(N, nb - 1) : Math.min(N, nb);
        for (let i = 1; i <= countToTake; i++) {
          samples.push(evalAtParam(ua.Parameter(i)));
        }
        while (samples.length < N) {
          const frac = samples.length / (div || 1);
          const u = t0 + (t1 - t0) * frac;
          samples.push(evalAtParam(u));
        }
      } else {
        const step = options.spacing ?? 10;
        if (!(step > 1e-9)) throw new KernelError(t('kernel.spacingPositive'));
        samples.push(evalAtParam(t0));
        for (let i = 1; i < N; i++) {
          const s = i * step;
          if (s >= totalLength - 1e-9) {
            const last = samples[samples.length - 1]!;
            const delta = step;
            const pt: Vec3 = [
              last.point[0] + last.tangent[0] * delta,
              last.point[1] + last.tangent[1] * delta,
              last.point[2] + last.tangent[2] * delta,
            ];
            samples.push({ point: pt, tangent: last.tangent, parameter: t1 });
          } else {
            const ap = arena.own(new oc.GCPnts_AbscissaPoint(cc, s, t0));
            if (ap.IsDone()) {
              samples.push(evalAtParam(ap.Parameter()));
            } else {
              const u = t0 + (s / totalLength) * (t1 - t0);
              samples.push(evalAtParam(u));
            }
          }
        }
      }

      if (options.reverse) {
        samples.reverse();
        for (const s of samples) {
          s.tangent = [-s.tangent[0], -s.tangent[1], -s.tangent[2]];
        }
      }

      return { samples, length: totalLength, closed };
    } finally {
      arena.dispose();
    }
  }

  /**
   * Whether a shape contains non-elementary freeform surfaces (B-spline, Bezier, Offset, Other)
   * that require adaptive integration for volume accuracy.
   */
  private hasComplexSurfaces(shape: TopoDS_Shape, arena: Arena): boolean {
    const oc = this.oc;
    const ex = arena.own(new oc.TopExp_Explorer(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE));
    for (; ex.More(); ex.Next()) {
      const face = arena.own(oc.TopoDS.Face(ex.Current()));
      const ad = arena.own(new oc.BRepAdaptor_Surface(face, true));
      const type = String(ad.GetType()).replace('GeomAbs_', '').toLowerCase();
      if (type === 'bsplinesurface' || type === 'beziersurface' || type === 'offsetsurface' || type === 'othersurface') {
        return true;
      }
    }
    return false;
  }

  /**
   * Volume, area, centre and inertia. By default OCCT integrates with a fixed number of points per face, which is exact on planes and quadrics but
   * not on long B-spline faces: a thread's faces come out about 1e-4 of the volume off. With `eps` (or automatically when complex B-spline surfaces
   * are detected), the volume integrates adaptively until its relative error is below `eps`.
   */
  massProps(id: ShapeId, options: { eps?: number; adaptive?: boolean } = {}): MassProps {
    const oc = this.oc;
    const arena = new Arena();
    try {
      const shape = this.get(id);
      const v = arena.own(new oc.GProp_GProps());
      let eps = options.eps;
      const adaptive = options.adaptive ?? true;
      if (eps === undefined && adaptive && this.hasComplexSurfaces(shape, arena)) {
        eps = 1e-6;
      }
      if (eps !== undefined) oc.BRepGProp.VolumeProperties(shape, v, eps, false, false);
      else oc.BRepGProp.VolumeProperties(shape, v, false, false, false);
      const s = arena.own(new oc.GProp_GProps());
      oc.BRepGProp.SurfaceProperties(shape, s, false, false);
      const m = arena.own(v.MatrixOfInertia());
      const inertia: number[] = [];
      for (let r = 1; r <= 3; r++) for (let c = 1; c <= 3; c++) inertia.push(m.Value(r, c));
      return { volume: v.Mass(), area: s.Mass(), center: this.xyz(arena.own(v.CentreOfMass())), inertia };
    } finally {
      arena.dispose();
    }
  }

  /** A face, edge or vertex of a shape as a shape of its own (by its number in the order of topology), to measure (E1.1). The caller releases it. */
  subShape(id: ShapeId, kind: 'face' | 'edge' | 'vertex', index: number): ShapeId {
    const arena = new Arena();
    const list = ShapeIndex.of(this.oc, this.get(id), kind === 'face' ? T.FACE : kind === 'edge' ? T.EDGE : T.VERTEX, arena);
    try {
      const sub = list.keys[index];
      if (!sub) throw new KernelError(t('measure.noElement'));
      return this.put(sub.Oriented(sub.Orientation()));
    } finally {
      list.dispose();
      arena.dispose();
    }
  }

  /** The shortest distance between two shapes, exactly, whatever they are (a point and a face, a hole and a pin) (E1.1). */
  distance(a: ShapeId, b: ShapeId): Distance {
    const oc = this.oc;
    const arena = new Arena();
    try {
      // the binding's declarations ask for every optional argument; the two shapes are all that is needed
      const d = arena.own(new (oc.BRepExtrema_DistShapeShape as unknown as new (a: TopoDS_Shape, b: TopoDS_Shape) => InstanceType<OC['BRepExtrema_DistShapeShape']>)(this.get(a), this.get(b)));
      if (!d.IsDone() || d.NbSolution() < 1) throw new KernelError(t('measure.noDistance'));
      return { distance: d.Value(), pointA: this.xyz(arena.own(d.PointOnShape1(1))), pointB: this.xyz(arena.own(d.PointOnShape2(1))) };
    } finally {
      arena.dispose();
    }
  }

  /**
   * What two shapes have in common (E2.1): its volume, and the shape itself (null when it is empty or too small to be one: under minVolume). The caller releases the shape.
   */
  common(a: ShapeId, b: ShapeId, minVolume = 1e-6): { volume: number; shape: ShapeId | null } {
    const oc = this.oc;
    const arena = new Arena();
    try {
      const mk = this.boolOp('common', this.get(a), this.get(b), t('body.common'), arena);
      const props = arena.own(new oc.GProp_GProps());
      const shape = mk.Shape();
      oc.BRepGProp.VolumeProperties(shape, props, false, false, false);
      const volume = props.Mass();
      if (!(volume > minVolume)) {
        shape.delete();
        return { volume: Math.max(0, volume), shape: null };
      }
      return { volume, shape: this.put(shape) };
    } finally {
      arena.dispose();
    }
  }

  /** Checks a shape (E3.1): whether it is valid, which faces are not, whether its skin is closed, how many solids and how much volume it has. */
  check(id: ShapeId): GeometryReport {
    const oc = this.oc;
    const arena = new Arena();
    const shape = this.get(id);
    const faces = ShapeIndex.of(oc, shape, T.FACE, arena);
    const solids = ShapeIndex.of(oc, shape, 'TopAbs_SOLID', arena);
    try {
      const valid = this.valid(shape);
      const badFaces = valid ? [] : faces.keys.flatMap((f, i) => (arena.own(new oc.BRepCheck_Analyzer(f, true, false, false)).IsValid() ? [] : [i]));
      const free = arena.own(new oc.ShapeAnalysis_FreeBounds(shape, false, true, false));
      let freeEdges = 0;
      for (const wires of [free.GetClosedWires(), free.GetOpenWires()]) {
        const edges = ShapeIndex.of(oc, arena.own(wires), T.EDGE, arena);
        freeEdges += edges.size;
        edges.dispose();
      }
      const props = arena.own(new oc.GProp_GProps());
      oc.BRepGProp.VolumeProperties(shape, props, false, false, false);
      return { valid, solids: solids.size, faces: faces.size, badFaces, freeEdges, volume: props.Mass() };
    } finally {
      faces.dispose();
      solids.dispose();
      arena.dispose();
    }
  }

  /** Axis-aligned bounding box (sizes through-all and up-to-face extrusions). */
  bounds(id: ShapeId): { min: Vec3; max: Vec3 } {
    const arena = new Arena();
    try {
      const box = arena.own(new this.oc.Bnd_Box());
      this.oc.BRepBndLib.Add(this.get(id), box, false);
      return { min: this.xyz(arena.own(box.CornerMin())), max: this.xyz(arena.own(box.CornerMax())) };
    } finally {
      arena.dispose();
    }
  }

  isValid(id: ShapeId): boolean {
    return this.valid(this.get(id));
  }

  /**
   * Whether each point is inside a solid, outside it, or on its surface (within `tolerance`). One classifier serves all the points: building it is
   * what costs (on a thread's faces, megabytes of WASM memory each time, which the heap does not get back), so ask for many points at once.
   */
  classify(id: ShapeId, points: readonly Vec3[], tolerance = 1e-7): ('in' | 'out' | 'on')[] {
    const oc = this.oc;
    const arena = new Arena();
    try {
      const c = arena.own(new oc.BRepClass3d_SolidClassifier(this.get(id)));
      return points.map((p) => {
        const q = new oc.gp_Pnt(p[0], p[1], p[2]);
        try {
          c.Perform(q, tolerance);
        } finally {
          q.delete();
        }
        const s = c.State();
        return s === oc.TopAbs_State.TopAbs_IN ? 'in' : s === oc.TopAbs_State.TopAbs_ON ? 'on' : 'out';
      });
    } finally {
      arena.dispose();
    }
  }

  private valid(shape: TopoDS_Shape): boolean {
    const arena = new Arena();
    try {
      return arena.own(new this.oc.BRepCheck_Analyzer(shape, true, false, false)).IsValid();
    } finally {
      arena.dispose();
    }
  }

  // ------------------------------------------------------------------ tessellation (A4.1)

  /** A shape keeps the finest mesh it has had: BRepMesh refines one, never coarsens it. Mesh a shape once, with the setting it is to have. */
  mesh(id: ShapeId, options: MeshOptions = {}): MeshData {
    const oc = this.oc;
    const arena = new Arena();
    const shape = this.get(id);
    const faces = ShapeIndex.of(oc, shape, T.FACE, arena);
    const edges = ShapeIndex.of(oc, shape, T.EDGE, arena);
    try {
      let tolerance = options.tolerance;
      if (tolerance === undefined) {
        const box = arena.own(new oc.Bnd_Box());
        oc.BRepBndLib.Add(shape, box, false);
        const a = this.xyz(arena.own(box.CornerMin()));
        const b = this.xyz(arena.own(box.CornerMax()));
        tolerance = Math.min(1, Math.max(0.002, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * (options.relative ?? 5e-4)));
      }
      const angular = options.angular ?? 0.25;
      arena.own(new oc.BRepMesh_IncrementalMesh(shape, tolerance, false, angular, false));

      // Faces: per-face vertices (crisp edges between faces), winding flipped on reversed faces.
      const positions: number[] = [];
      const indices: number[] = [];
      const faceRanges: number[] = [];
      faces.keys.forEach((f, fi) => {
        const face = arena.own(oc.TopoDS.Face(f));
        const loc = arena.own(new oc.TopLoc_Location());
        const tri = oc.BRep_Tool.Triangulation(face, loc, 0);
        if (!tri) return;
        arena.own(tri); // an owning handle copy: deleting it leaves the face's triangulation intact
        const trsf = arena.own(loc.Transformation());
        const base = positions.length / 3;
        for (let n = 1; n <= tri.NbNodes(); n++) {
          const p = arena.own(arena.own(tri.Node(n)).Transformed(trsf));
          positions.push(p.X(), p.Y(), p.Z());
        }
        const reversed = face.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED;
        const start = indices.length;
        for (let k = 1; k <= tri.NbTriangles(); k++) {
          const t = arena.own(tri.Triangle(k));
          const { theN1, theN2, theN3 } = t.Get();
          indices.push(base + theN1 - 1, base + (reversed ? theN3 : theN2) - 1, base + (reversed ? theN2 : theN3) - 1);
        }
        faceRanges.push(start, indices.length - start, fi);
      });

      // Edges: tangential-deflection polylines, independent of the face tessellation.
      const edgePoints: number[] = [];
      const edgeRanges: number[] = [];
      edges.keys.forEach((e, ei) => {
        const edge = arena.own(oc.TopoDS.Edge(e));
        if (oc.BRep_Tool.Degenerated(edge)) return;
        const curve = arena.own(new oc.BRepAdaptor_Curve(edge));
        // Exactly three arguments: with six, arity-based dispatch picks the (first, last parameter) overload.
        const pts = arena.own(new oc.GCPnts_TangentialDeflection(curve, angular, tolerance));
        const start = edgePoints.length / 3;
        for (let i = 1; i <= pts.NbPoints(); i++) {
          const p = arena.own(pts.Value(i));
          edgePoints.push(p.X(), p.Y(), p.Z());
        }
        edgeRanges.push(start, edgePoints.length / 3 - start, ei);
      });

      return {
        positions: Float32Array.from(positions),
        normals: smoothNormals(positions, indices, faceRanges),
        indices: Uint32Array.from(indices),
        faceRanges: Int32Array.from(faceRanges),
        edgePoints: Float32Array.from(edgePoints),
        edgeRanges: Int32Array.from(edgeRanges),
      };
    } finally {
      faces.dispose();
      edges.dispose();
      arena.dispose();
    }
  }

  /**
   * The shape as lines seen from a direction (A4.4, Phase 5): exact hidden-line removal (`HLRBRep_Algo`). Visible are the sharp edges, the smooth ones that show
   * (the seam of a tangent fillet) and the outlines of curved faces; hidden are the same behind the material. Each edge is cut into a polyline as finely as the
   * tolerance (mm, default 1e-3 of the size, at most 0.05) and the angular step (radians, default 0.1) ask.
   */
  projectView(id: ShapeId, view: ViewDirection, options: { tolerance?: number; angular?: number; mesh?: boolean } = {}): ProjectedView {
    const oc = this.oc;
    const arena = new Arena();
    const unit = (v: Vec3): Vec3 => {
      const n = Math.hypot(v[0], v[1], v[2]);
      if (!(n > 0) || !Number.isFinite(n)) throw new KernelError(t('kernel.badViewDirection'));
      return [v[0] / n, v[1] / n, v[2] / n];
    };
    try {
      const d = unit(view.dir);
      // the sheet's x runs to the right of a viewer who looks along `dir` with `up` above: dir × up
      const rx = unit([d[1] * view.up[2] - d[2] * view.up[1], d[2] * view.up[0] - d[0] * view.up[2], d[0] * view.up[1] - d[1] * view.up[0]]);
      const shape = this.get(id);
      const box = arena.own(new oc.Bnd_Box());
      oc.BRepBndLib.Add(shape, box, false);
      const a = this.xyz(arena.own(box.CornerMin()));
      const b = this.xyz(arena.own(box.CornerMax()));
      const size = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const tolerance = options.tolerance ?? Math.min(0.05, Math.max(1e-3, size * 1e-3));
      const angular = options.angular ?? 0.1;
      const algo = arena.own(new oc.HLRBRep_Algo());
      algo.Add(shape, 0);
      const axes = arena.own(new oc.gp_Ax2(arena.own(new oc.gp_Pnt(0, 0, 0)), arena.own(new oc.gp_Dir(-d[0], -d[1], -d[2])), arena.own(new oc.gp_Dir(rx[0], rx[1], rx[2]))));
      algo.Projector(arena.own(new oc.HLRAlgo_Projector(axes)));
      algo.Update();
      algo.Hide();
      const lines = arena.own(new oc.HLRBRep_HLRToShape(algo));
      const polylines = (compound: TopoDS_Shape | null | undefined): number[][] => {
        const out: number[][] = [];
        if (!compound || compound.IsNull()) return out;
        arena.own(compound);
        for (const ex = arena.own(new oc.TopExp_Explorer(compound, T.EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE)); ex.More(); ex.Next()) {
          const edge = arena.own(oc.TopoDS.Edge(ex.Current()));
          if (oc.BRep_Tool.Degenerated(edge)) continue;
          const curve = arena.own(new oc.BRepAdaptor_Curve(edge));
          const pts = arena.own(new oc.GCPnts_TangentialDeflection(curve, angular, tolerance));
          const flat: number[] = [];
          for (let i = 1; i <= pts.NbPoints(); i++) {
            const p = arena.own(pts.Value(i));
            flat.push(p.X(), p.Y());
          }
          if (flat.length >= 4) out.push(flat);
        }
        return out;
      };
      const visible = [...polylines(lines.VCompound()), ...polylines(lines.OutLineVCompound())];
      // a hidden edge that lies wholly on a visible one (the back of the box under its front) is not drawn twice: the visible line is the one to see
      const hidden = [...polylines(lines.HCompound()), ...polylines(lines.OutLineHCompound())].filter((h) => !lyingOn(h, visible, Math.max(2 * tolerance, 1e-4)));
      // the tangent edges (B2.3): the smooth lines where two faces meet (a fillet meeting a face), apart from the lines above so that a view can leave
      // them out (showTangentEdges). The hidden ones are among them: a view that asks for its tangent edges has all of them, not only the seen ones.
      const tangent = [...polylines(lines.Rg1LineVCompound()), ...polylines(lines.Rg1LineHCompound())];
      let min: [number, number] | null = null;
      let max: [number, number] | null = null;
      for (const line of visible) {
        for (let i = 0; i < line.length; i += 2) {
          min = [Math.min(min?.[0] ?? Infinity, line[i]!), Math.min(min?.[1] ?? Infinity, line[i + 1]!)];
          max = [Math.max(max?.[0] ?? -Infinity, line[i]!), Math.max(max?.[1] ?? -Infinity, line[i + 1]!)];
        }
      }
      const seen: ProjectedView = { visible, hidden, box: min && max ? { min, max } : null, ...(tangent.length > 0 ? { tangent } : {}) };
      if (options.mesh) {
        // the faces, for shading (ADR 0146): the view's x and y as the lines have them (the projector's X is rx, its Y (−d) × rx), and z toward the viewer
        const zx: Vec3 = [-d[0], -d[1], -d[2]];
        const yx: Vec3 = [zx[1] * rx[2] - zx[2] * rx[1], zx[2] * rx[0] - zx[0] * rx[2], zx[0] * rx[1] - zx[1] * rx[0]];
        const m = this.mesh(id);
        const turn = (src: Float32Array): Float32Array => {
          const out = new Float32Array(src.length);
          for (let i = 0; i < src.length; i += 3) {
            const x = src[i]!;
            const y = src[i + 1]!;
            const z = src[i + 2]!;
            out[i] = x * rx[0] + y * rx[1] + z * rx[2];
            out[i + 1] = x * yx[0] + y * yx[1] + z * yx[2];
            out[i + 2] = x * zx[0] + y * zx[1] + z * zx[2];
          }
          return out;
        };
        seen.mesh = { positions: turn(m.positions), normals: turn(m.normals), indices: m.indices };
      }
      return seen;
    } catch (e) {
      if (e instanceof KernelError) throw e;
      throw new KernelError(t('kernel.projectFailed', { why: this.errorText(e) }));
    } finally {
      arena.dispose();
    }
  }

  /**
   * A section view of the shape (C16.3): the material on the viewer's side of the plane (`normal` points to the viewer) is taken away, and what is left is seen
   * from there as lines, with the outlines of the faces the cut made (to be hatched). The viewer looks along `-normal`; `up` is the sheet's up, square to it.
   */
  sectionView(id: ShapeId, plane: { origin: Vec3; normal: Vec3 }, up: Vec3, options: { tolerance?: number; angular?: number; mesh?: boolean } = {}): ProjectedView {
    const oc = this.oc;
    const n0 = plane.normal;
    const nl = Math.hypot(n0[0], n0[1], n0[2]);
    if (!(nl > 0)) throw new KernelError(t('kernel.badViewDirection'));
    const n: Vec3 = [n0[0] / nl, n0[1] / nl, n0[2] / nl];
    const made: ShapeId[] = [];
    const arena = new Arena();
    try {
      const box = arena.own(new oc.Bnd_Box());
      oc.BRepBndLib.Add(this.get(id), box, false);
      const a = this.xyz(arena.own(box.CornerMin()));
      const b = this.xyz(arena.own(box.CornerMax()));
      const size = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      // the tool: a block on the viewer's side of the plane, far bigger than the shape, put where the plane is
      const R = 2 * size + 10;
      const tool = this.halfSpace({ origin: plane.origin, normal: n }, R, made, arena);
      const cut = this.boolean('cut', id, tool);
      made.push(cut.shape);
      // the whole shape is on the viewer's side, so the cut takes all of it (a line put off the part, D-I5): nothing to see and nothing cut, said by the
      // empty `cut` rather than by the hidden-line removal failing on an empty shape
      if (this.topology(cut.shape).faces.length === 0) return { visible: [], hidden: [], box: null, cut: [] };
      const view: ViewDirection = { dir: [-n[0], -n[1], -n[2]], up };
      const seen = this.projectView(cut.shape, view, options);
      // the faces the cut made lie on the plane and face the viewer; their edges, in the view's coordinates
      const ul = Math.hypot(up[0], up[1], up[2]);
      const U: Vec3 = [up[0] / ul, up[1] / ul, up[2] / ul];
      const rx: Vec3 = [view.dir[1] * U[2] - view.dir[2] * U[1], view.dir[2] * U[0] - view.dir[0] * U[2], view.dir[0] * U[1] - view.dir[1] * U[0]];
      const rl = Math.hypot(rx[0], rx[1], rx[2]);
      const R3: Vec3 = [rx[0] / rl, rx[1] / rl, rx[2] / rl];
      const topo = this.topology(cut.shape);
      const onPlane = new Set(
        topo.faces.flatMap((f, i) => {
          if (f.surface !== 'plane' || !f.normal) return [];
          const parallel = Math.abs(f.normal[0] * n[0] + f.normal[1] * n[1] + f.normal[2] * n[2]) > 1 - 1e-9;
          const off = Math.abs((f.center[0] - plane.origin[0]) * n[0] + (f.center[1] - plane.origin[1]) * n[1] + (f.center[2] - plane.origin[2]) * n[2]);
          return parallel && off < 1e-6 * Math.max(1, size) ? [i] : [];
        }),
      );
      const tolerance = options.tolerance ?? Math.min(0.05, Math.max(1e-3, size * 1e-3));
      const angular = options.angular ?? 0.1;
      const outlines: number[][] = [];
      topo.edges.forEach((e, ei) => {
        if (!e.faces.some((f) => onPlane.has(f))) return;
        const edge = this.subShape(cut.shape, 'edge', ei);
        made.push(edge);
        const curve = arena.own(new oc.BRepAdaptor_Curve(arena.own(oc.TopoDS.Edge(this.get(edge)))));
        const pts = arena.own(new oc.GCPnts_TangentialDeflection(curve, angular, tolerance));
        const flat: number[] = [];
        for (let i = 1; i <= pts.NbPoints(); i++) {
          const p = arena.own(pts.Value(i));
          flat.push(p.X() * R3[0] + p.Y() * R3[1] + p.Z() * R3[2], p.X() * U[0] + p.Y() * U[1] + p.Z() * U[2]);
        }
        if (flat.length >= 4) outlines.push(flat);
      });
      return { ...seen, cut: outlines };
    } catch (e) {
      if (e instanceof KernelError) throw e;
      throw new KernelError(t('kernel.projectFailed', { why: this.errorText(e) }));
    } finally {
      for (const m of made) this.release(m);
      arena.dispose();
    }
  }

  /** A block of side 2R × 2R × R on the side of `plane` its normal (of length one) points to, its face on the plane: what takes away all on that side. */
  private halfSpace(plane: { origin: Vec3; normal: Vec3 }, R: number, made: ShapeId[], arena: Arena): ShapeId {
    const oc = this.oc;
    const n = plane.normal;
    const helper: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const d = helper[0] * n[0] + helper[1] * n[1] + helper[2] * n[2];
    const xr = [helper[0] - n[0] * d, helper[1] - n[1] * d, helper[2] - n[2] * d];
    const xl = Math.hypot(xr[0]!, xr[1]!, xr[2]!);
    const X: Vec3 = [xr[0]! / xl, xr[1]! / xl, xr[2]! / xl];
    const Y: Vec3 = [n[1] * X[2] - n[2] * X[1], n[2] * X[0] - n[0] * X[2], n[0] * X[1] - n[1] * X[0]];
    const block = this.put(arena.own(new oc.BRepPrimAPI_MakeBox(arena.own(new oc.gp_Pnt(-R, -R, 0)), 2 * R, 2 * R, R)).Shape());
    made.push(block);
    const tool = this.transformed(block, [X[0], Y[0], n[0], plane.origin[0], X[1], Y[1], n[1], plane.origin[1], X[2], Y[2], n[2], plane.origin[2]]);
    made.push(tool);
    return tool;
  }

  /**
   * A stepped or aligned section (D-I5, ADR 0143): what is on the viewer's side of the polyline `path` (the side `normal` points to from its first segment)
   * is taken away; an aligned section's material behind its second segment is then turned about the bend into the first segment's plane. Seen looking
   * against `normal` with `up` up, as `sectionView`; the outlines of the cut faces (those on the cutting planes) are given for hatching, and the lines where
   * the path changes way (a jog, the bend) are not drawn, as ISO 128-44 has it. An empty `cut` when the path misses the shape.
   */
  sectionViewPath(id: ShapeId, cut: { normal: Vec3; path: Vec3[]; aligned?: boolean }, up: Vec3, options: { tolerance?: number; angular?: number; mesh?: boolean } = {}): ProjectedView {
    const oc = this.oc;
    const n0 = cut.normal;
    const nl = Math.hypot(n0[0], n0[1], n0[2]);
    if (!(nl > 0)) throw new KernelError(t('kernel.badViewDirection'));
    if (cut.path.length < 2 || !cut.path.every((p) => p.length === 3 && p.every(Number.isFinite))) throw new KernelError(t('kernel.badSectionPath'));
    const n: Vec3 = [n0[0] / nl, n0[1] / nl, n0[2] / nl];
    const made: ShapeId[] = [];
    const arena = new Arena();
    try {
      const box = arena.own(new oc.Bnd_Box());
      oc.BRepBndLib.Add(this.get(id), box, false);
      const a = this.xyz(arena.own(box.CornerMin()));
      const b = this.xyz(arena.own(box.CornerMax()));
      const size = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const centre: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
      const p0 = cut.path[0]!;
      const span = cut.path.reduce((m, p) => Math.max(m, Math.hypot(p[0] - p0[0], p[1] - p0[1], p[2] - p0[2])), 0);
      const away = Math.hypot(centre[0] - p0[0], centre[1] - p0[1], centre[2] - p0[2]);
      // far enough past the path, and through the whole shape along the depth, that nothing on the viewer's side is left
      const reach = 2 * (away + size + span) + 10;
      const plan = planSectionPath(cut.path, n, !!cut.aligned, reach);
      const deep = Math.abs((centre[0] - p0[0]) * plan.depth[0] + (centre[1] - p0[1]) * plan.depth[1] + (centre[2] - p0[2]) * plan.depth[2]) + size + 10;
      const at = (u: number, v: number, w: number): Vec3 => [
        plan.origin[0] + u * plan.x[0] + v * plan.y[0] + w * plan.depth[0],
        plan.origin[1] + u * plan.x[1] + v * plan.y[1] + w * plan.depth[1],
        plan.origin[2] + u * plan.x[2] + v * plan.y[2] + w * plan.depth[2],
      ];
      const poly = arena.own(new oc.BRepBuilderAPI_MakePolygon());
      for (const [u, v] of plan.region) poly.Add(this.pnt(arena, at(u, v, -deep)));
      poly.Close();
      const mkFace = arena.own(new oc.BRepBuilderAPI_MakeFace(arena.own(poly.Wire()), true));
      if (!mkFace.IsDone()) throw new KernelError(t('kernel.opFailed', { label: t('kernel.sectionRegion') }));
      const prism = arena.own(new oc.BRepPrimAPI_MakePrism(arena.own(mkFace.Face()), arena.own(new oc.gp_Vec(plan.depth[0] * 2 * deep, plan.depth[1] * 2 * deep, plan.depth[2] * 2 * deep)), false, true));
      const tool = this.put(this.build(prism, t('kernel.sectionRegion'), arena));
      made.push(tool);
      const kept = this.boolean('cut', id, tool);
      made.push(kept.shape);
      if (this.topology(kept.shape).faces.length === 0) return { visible: [], hidden: [], box: null, cut: [] };
      let shown = kept.shape;
      if (plan.turn) {
        // what is behind the second segment, apart from the rest, turned into the first segment's plane
        const side = this.halfSpace(plan.turn.split, reach, made, arena);
        const behind = this.boolean('common', kept.shape, side);
        made.push(behind.shape);
        const rest = this.boolean('cut', kept.shape, side);
        made.push(rest.shape);
        const turned = this.transformed(behind.shape, plan.turn.rows);
        made.push(turned);
        shown = this.join([rest.shape, turned]);
        made.push(shown);
      }
      const view: ViewDirection = { dir: [-n[0], -n[1], -n[2]], up };
      const seen = this.projectView(shown, view, options);
      const ul = Math.hypot(up[0], up[1], up[2]);
      const U: Vec3 = [up[0] / ul, up[1] / ul, up[2] / ul];
      const rx: Vec3 = [view.dir[1] * U[2] - view.dir[2] * U[1], view.dir[2] * U[0] - view.dir[0] * U[2], view.dir[0] * U[1] - view.dir[1] * U[0]];
      const rl = Math.hypot(rx[0], rx[1], rx[2]);
      const R3: Vec3 = [rx[0] / rl, rx[1] / rl, rx[2] / rl];
      const along = (p: Vec3, q: Vec3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
      const tol = 1e-6 * Math.max(1, size);
      // the cut faces: planar, square to the view, on one of the cutting planes
      const topo = this.topology(shown);
      const onCut = new Set(
        topo.faces.flatMap((f, i) => {
          if (f.surface !== 'plane' || !f.normal) return [];
          if (Math.abs(along(f.normal, n)) <= 1 - 1e-9) return [];
          return plan.cuts.some((c) => Math.abs(along([f.center[0] - c.origin[0], f.center[1] - c.origin[1], f.center[2] - c.origin[2]], c.normal)) < tol) ? [i] : [];
        }),
      );
      const tolerance = options.tolerance ?? Math.min(0.05, Math.max(1e-3, size * 1e-3));
      const angular = options.angular ?? 0.1;
      const outlines: number[][] = [];
      topo.edges.forEach((e, ei) => {
        if (!e.faces.some((f) => onCut.has(f))) return;
        const edge = this.subShape(shown, 'edge', ei);
        made.push(edge);
        const curve = arena.own(new oc.BRepAdaptor_Curve(arena.own(oc.TopoDS.Edge(this.get(edge)))));
        const pts = arena.own(new oc.GCPnts_TangentialDeflection(curve, angular, tolerance));
        const flat: number[] = [];
        for (let i = 1; i <= pts.NbPoints(); i++) {
          const p = arena.own(pts.Value(i));
          flat.push(p.X() * R3[0] + p.Y() * R3[1] + p.Z() * R3[2], p.X() * U[0] + p.Y() * U[1] + p.Z() * U[2]);
        }
        if (flat.length >= 4) outlines.push(flat);
      });
      // a jog or the bend is seen edge on: the line where the cut faces either side of it meet (both its ends corners of the cut) is not drawn
      const corners = outlines.flatMap((l) => [[l[0]!, l[1]!], [l[l.length - 2]!, l[l.length - 1]!]] as [number, number][]);
      const isCorner = (x: number, y: number) => corners.some((c) => Math.abs(c[0] - x) < tol && Math.abs(c[1] - y) < tol);
      const onBend = (l: number[]) =>
        l.length >= 4 &&
        isCorner(l[0]!, l[1]!) &&
        isCorner(l[l.length - 2]!, l[l.length - 1]!) &&
        plan.bends.some((bd) => {
          const kx = along(bd.normal, R3);
          const ky = along(bd.normal, U);
          const k0 = along(bd.normal, bd.origin);
          for (let i = 0; i + 1 < l.length; i += 2) if (Math.abs(l[i]! * kx + l[i + 1]! * ky - k0) > tol) return false;
          return true;
        });
      return { ...seen, visible: seen.visible.filter((l) => !onBend(l)), hidden: seen.hidden.filter((l) => !onBend(l)), cut: outlines };
    } catch (e) {
      if (e instanceof KernelError) throw e;
      throw new KernelError(t('kernel.projectFailed', { why: this.errorText(e) }));
    } finally {
      for (const m of made) this.release(m);
      arena.dispose();
    }
  }

  /**
   * A local (partial) section (B1): only what lies inside the closed `outline` (given in the parent's view plane,
   * as 3D points on that plane) is cut, `depth` mm inwards from the side of the part the viewer sees; everything
   * outside the outline is shown as-is. Seen looking against `normal` with `up` up. The outlines of the faces the
   * cut made (on the depth plane) are given for hatching. The whole part uncut, with an empty `cut`, when the
   * outline misses the part; `badLocalSectionDepth` when the depth would reach past the material.
   */
  sectionViewLocal(id: ShapeId, outline: Vec3[], depth: number, plane: { origin: Vec3; normal: Vec3 }, up: Vec3, options: { tolerance?: number; angular?: number; mesh?: boolean } = {}): ProjectedView {
    const oc = this.oc;
    const n0 = plane.normal;
    const nl = Math.hypot(n0[0], n0[1], n0[2]);
    if (!(nl > 0)) throw new KernelError(t('kernel.badViewDirection'));
    if (!(depth > 0) || !Number.isFinite(depth)) throw new KernelError(t('kernel.badLocalSectionDepth'));
    if (!outline || outline.length < 3 || !outline.every((p) => p.length === 3 && p.every(Number.isFinite))) throw new KernelError(t('kernel.badLocalSectionOutline'));
    const n: Vec3 = [n0[0] / nl, n0[1] / nl, n0[2] / nl];
    const made: ShapeId[] = [];
    const arena = new Arena();
    try {
      const box = arena.own(new oc.Bnd_Box());
      oc.BRepBndLib.Add(this.get(id), box, false);
      const a = this.xyz(arena.own(box.CornerMin()));
      const b = this.xyz(arena.own(box.CornerMax()));
      const size = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      // where the part lies along the normal (its box corners projected on it): the cut starts at the side
      // the viewer sees and goes `depth` inwards — SolidWorks measures a local section's depth from the visible surface
      const along = (p: Vec3) => p[0] * n[0] + p[1] * n[1] + p[2] * n[2];
      const extent = (lo3: Vec3, hi3: Vec3): [number, number] => {
        let lo = 0, hi = 0;
        for (let i = 0; i < 3; i++) {
          const x0 = lo3[i]! * n[i]!; const x1 = hi3[i]! * n[i]!;
          lo += Math.min(x0, x1); hi += Math.max(x0, x1);
        }
        return [lo, hi];
      };
      const [partLo, partHi] = extent(a, b);
      /** The outline slid along the normal so that its plane sits at `target`. */
      const shiftOutline = (target: number): Vec3[] => {
        const d = target - along(plane.origin);
        return outline.map((p): Vec3 => [p[0] + n[0] * d, p[1] + n[1] * d, p[2] + n[2] * d]);
      };
      /** The outline's plane at `target`, extruded along -normal for `len` — the solid every cut tool is made of. */
      const prismOf = (target: number, len: number): ShapeId => {
        const pts = shiftOutline(target);
        // a closed outline repeats its first point; MakePolygon would make the closing segment degenerate
        const first = pts[0]!;
        const last = pts[pts.length - 1]!;
        const dup = Math.abs(last[0] - first[0]) < 1e-9 && Math.abs(last[1] - first[1]) < 1e-9 && Math.abs(last[2] - first[2]) < 1e-9;
        const poly = arena.own(new oc.BRepBuilderAPI_MakePolygon());
        for (const p of dup ? pts.slice(0, -1) : pts) poly.Add(this.pnt(arena, p));
        poly.Close();
        const mkFace = arena.own(new oc.BRepBuilderAPI_MakeFace(arena.own(poly.Wire()), true));
        if (!mkFace.IsDone()) throw new KernelError(t('kernel.opFailed', { label: t('kernel.sectionRegion') }));
        const vec = arena.own(new oc.gp_Vec(-n[0] * len, -n[1] * len, -n[2] * len));
        const prism = arena.own(new oc.BRepPrimAPI_MakePrism(arena.own(mkFace.Face()), vec, false, true));
        const shape = this.put(this.build(prism, t('kernel.sectionRegion'), arena));
        made.push(shape);
        return shape;
      };
      // the column of the part's material inside the outline: from in front of the part all the way through it
      const start = Math.max(along(plane.origin), partHi) + 1;
      const column = this.boolean('common', id, prismOf(start, start - partLo + depth + 10));
      made.push(column.shape);
      // the outline misses the part: nothing is cut, the whole part is seen (the drawing says 「沒有切到零件」)
      if (this.topology(column.shape).faces.length === 0) return { ...this.projectView(id, { dir: [-n[0], -n[1], -n[2]], up }, options), cut: [] };
      const cbBox = arena.own(new oc.Bnd_Box());
      oc.BRepBndLib.Add(this.get(column.shape), cbBox, false);
      const [colLo, colHi] = extent(this.xyz(arena.own(cbBox.CornerMin())), this.xyz(arena.own(cbBox.CornerMax())));
      // depth past the material: refused outright, never silently shortened (B1)
      if (colHi - colLo < depth) throw new KernelError(t('kernel.badLocalSectionDepth'));
      // the cut tool: the outline at the surface the viewer sees, `depth` inwards
      const tool = prismOf(colHi, depth);

      // cut the tool out of the part: only inside the outline and within depth is removed
      const kept = this.boolean('cut', id, tool);
      made.push(kept.shape);
      if (this.topology(kept.shape).faces.length === 0) return { visible: [], hidden: [], box: null, cut: [] };

      const view: ViewDirection = { dir: [-n[0], -n[1], -n[2]], up };
      const seen = this.projectView(kept.shape, view, options);

      // cut faces: planar, square to the view, `depth` below the surface the cut starts at
      const dOff = colHi - depth - along(plane.origin);
      const depthPlane: Vec3 = [plane.origin[0] + n[0] * dOff, plane.origin[1] + n[1] * dOff, plane.origin[2] + n[2] * dOff];
      const tol = 1e-6 * Math.max(1, size);
      const topo = this.topology(kept.shape);
      const onCut = new Set(
        topo.faces.flatMap((f, i) => {
          if (f.surface !== 'plane' || !f.normal) return [];
          const parallel = Math.abs(f.normal[0] * n[0] + f.normal[1] * n[1] + f.normal[2] * n[2]) > 1 - 1e-9;
          const off = Math.abs((f.center[0] - depthPlane[0]) * n[0] + (f.center[1] - depthPlane[1]) * n[1] + (f.center[2] - depthPlane[2]) * n[2]);
          return parallel && off < tol ? [i] : [];
        }),
      );

      const tolerance = options.tolerance ?? Math.min(0.05, Math.max(1e-3, size * 1e-3));
      const angular = options.angular ?? 0.1;
      const ul = Math.hypot(up[0], up[1], up[2]);
      const U: Vec3 = [up[0] / ul, up[1] / ul, up[2] / ul];
      const rx: Vec3 = [view.dir[1] * U[2] - view.dir[2] * U[1], view.dir[2] * U[0] - view.dir[0] * U[2], view.dir[0] * U[1] - view.dir[1] * U[0]];
      const rl = Math.hypot(rx[0], rx[1], rx[2]);
      const R3: Vec3 = [rx[0] / rl, rx[1] / rl, rx[2] / rl];
      const outlines: number[][] = [];
      topo.edges.forEach((e, ei) => {
        if (!e.faces.some((f) => onCut.has(f))) return;
        const edge = this.subShape(kept.shape, 'edge', ei);
        made.push(edge);
        const curve = arena.own(new oc.BRepAdaptor_Curve(arena.own(oc.TopoDS.Edge(this.get(edge)))));
        const pts = arena.own(new oc.GCPnts_TangentialDeflection(curve, angular, tolerance));
        const flat: number[] = [];
        for (let i = 1; i <= pts.NbPoints(); i++) {
          const p = arena.own(pts.Value(i));
          flat.push(p.X() * R3[0] + p.Y() * R3[1] + p.Z() * R3[2], p.X() * U[0] + p.Y() * U[1] + p.Z() * U[2]);
        }
        if (flat.length >= 4) outlines.push(flat);
      });
      return { ...seen, cut: outlines };
    } catch (e) {
      if (e instanceof KernelError) throw e;
      throw new KernelError(t('kernel.projectFailed', { why: this.errorText(e) }));
    } finally {
      for (const m of made) this.release(m);
      arena.dispose();
    }
  }

  // ------------------------------------------------------------------ surfaces (C8.1, C9.2–C9.4, Phase 4b)

  /**
   * How far a shape is from another (4b, ADR 0067): the distance from points of `sample`'s mesh (about `maxSamples` of them, spread over it) to `reference`. With
   * `expected`, `deviation` is the largest |distance − expected|: what a surface made by offsetting is checked by, since OCCT can give a valid shape that is not
   * the offset asked for. `worst` is the point of `sample` that is farthest from `expected`.
   */
  gapReport(sample: ShapeId, reference: ShapeId, expected = 0, maxSamples = 300): GapReport {
    const oc = this.oc;
    const mesh = this.mesh(sample, { tolerance: 0.1, angular: 0.3 });
    const n = mesh.positions.length / 3;
    if (n === 0) throw new KernelError(t('surface.nothingToMeasure'));
    const step = Math.max(1, Math.floor(n / maxSamples));
    const arena = new Arena();
    // a gap is to the surface: to a solid, its boundary (the distance from a point inside a solid to the solid is 0)
    let ref = this.get(reference);
    if (this.solidCount(reference) > 0) {
      const boundary = ShapeIndex.of(oc, ref, T.FACE, arena);
      ref = this.compound(boundary.keys, arena);
    }
    let min = Infinity;
    let max = 0;
    let sum = 0;
    let count = 0;
    let deviation = 0;
    let worst: Vec3 = [mesh.positions[0]!, mesh.positions[1]!, mesh.positions[2]!];
    try {
      for (let i = 0; i < n; i += step) {
        const p: Vec3 = [mesh.positions[3 * i]!, mesh.positions[3 * i + 1]!, mesh.positions[3 * i + 2]!];
        const vertex = arena.own(arena.own(new oc.BRepBuilderAPI_MakeVertex(this.pnt(arena, p))).Vertex());
        const d = arena.own(new (oc.BRepExtrema_DistShapeShape as unknown as new (a: TopoDS_Shape, b: TopoDS_Shape) => InstanceType<OC['BRepExtrema_DistShapeShape']>)(vertex, ref));
        if (!d.IsDone() || d.NbSolution() < 1) continue;
        const dist = d.Value();
        min = Math.min(min, dist);
        max = Math.max(max, dist);
        sum += dist;
        count++;
        if (Math.abs(dist - expected) > deviation) {
          deviation = Math.abs(dist - expected);
          worst = p;
        }
      }
    } finally {
      arena.dispose();
    }
    if (count === 0) throw new KernelError(t('surface.nothingToMeasure'));
    return { samples: count, min, max, mean: sum / count, deviation, worst };
  }

  /**
   * The faces `faceIndices` of a shape offset by `distance` along their normals (positive: outward), as a surface (a face, or a shell when they are connected) (C9.2, ADR 0067).
   * The faces are sewn first, so a region offsets as one piece. The result is measured against the faces it came from, and refused when it is not `distance`
   * from them to `tolerance` (0.05 mm): OCCT answers that it is done and gives a valid shape when the offset is more than the surface can bear. Every output face
   * has the face it was made from as its origin.
   */
  offsetFaces(target: ShapeId, faceIndices: number[], distance: number, options: { tolerance?: number; join?: 'arc' | 'intersection' } = {}): OpResult & { gap: GapReport } {
    if (faceIndices.length === 0) throw new KernelError(t('surface.noFaces'));
    if (!(Math.abs(distance) > 0) || !Number.isFinite(distance)) throw new KernelError(t('surface.zeroDistance'));
    const oc = this.oc;
    const arena = new Arena();
    const faces = ShapeIndex.of(oc, this.get(target), T.FACE, arena);
    const made: ShapeId[] = [];
    try {
      const picked = [...new Set(faceIndices)].map((i) => {
        const f = faces.keys[i];
        if (!f) throw new KernelError(t('edit.faceOutOfRange', { index: i }));
        return i;
      });
      const sewing = arena.own(new oc.BRepBuilderAPI_Sewing(1e-6, true, true, true, false));
      for (const i of picked) sewing.Add(faces.keys[i]!);
      sewing.Perform(arena.own(new oc.Message_ProgressRange()));
      const region = arena.own(sewing.SewedShape());
      const mk = arena.own(new oc.BRepOffsetAPI_MakeOffsetShape());
      try {
        mk.PerformByJoin(region, distance, 1e-4, oc.BRepOffset_Mode.BRepOffset_Skin, false, false, options.join === 'intersection' ? oc.GeomAbs_JoinType.GeomAbs_Intersection : oc.GeomAbs_JoinType.GeomAbs_Arc, false, arena.own(new oc.Message_ProgressRange()));
      } catch (e) {
        throw new KernelError(t('surface.offsetFailed', { why: this.errorText(e) }));
      }
      if (!mk.IsDone()) throw new KernelError(t('surface.offsetFailed', { why: t('surface.notDone') }));
      // the result is copied with its geometry: OCCT's offset surfaces refer to what the builder holds, which is let go with it
      const built = arena.own(mk.Shape());
      if (!this.valid(built)) throw new KernelError(t('surface.offsetFailed', { why: t('surface.invalid') }));
      const copier = arena.own(new oc.BRepBuilderAPI_Copy(built, true, false));
      const out = arena.own(copier.Shape());
      const id = this.put(out.Oriented(out.Orientation()));
      made.push(id);
      const regionId = this.put(region.Oriented(region.Orientation()));
      let gap: GapReport;
      try {
        gap = this.gapReport(id, regionId, Math.abs(distance));
      } finally {
        this.release(regionId);
      }
      const tolerance = options.tolerance ?? SURFACE_TOLERANCE;
      const wrong = gapError(gap, Math.abs(distance), options.join === 'intersection');
      if (wrong > tolerance) throw new KernelError(t('surface.gapTooBig', { distance: Math.abs(distance), worst: round3(wrong), tolerance }));
      // the face each output face was made from
      const outFaces = ShapeIndex.of(oc, out, T.FACE, arena);
      const sewn = ShapeIndex.of(oc, region, T.FACE, arena);
      try {
        const origins: FaceOrigin[][] = outFaces.keys.map(() => []);
        for (const index of picked) {
          const orig = faces.keys[index]!;
          // sewing may have rebuilt the face: the offset knows the sewn one
          const piece = sewing.IsModified(orig) ? arena.own(sewing.Modified(orig)) : orig;
          for (const g of [...this.list(mk.Generated(piece)), ...this.list(mk.Modified(piece))]) {
            const j = outFaces.indexOf(arena.own(copier.ModifiedShape(g)));
            if (j >= 0 && !origins[j]!.some((o) => 'index' in o && o.index === index)) origins[j]!.push({ rel: 'generated', kind: 'face', index });
            g.delete();
          }
        }
        // the faces a rounded join adds round an edge of the region come from that edge
        const edges = ShapeIndex.of(oc, this.get(target), T.EDGE, arena);
        try {
          const onPicked = new Set<number>();
          for (const index of picked) {
            const sub = ShapeIndex.of(oc, faces.keys[index]!, T.EDGE, arena);
            sub.keys.forEach((e) => onPicked.add(edges.indexOf(e)));
            sub.dispose();
          }
          for (const k of onPicked) {
            const orig = edges.keys[k]!;
            const edge = sewing.IsModifiedSubShape(orig) ? arena.own(sewing.ModifiedSubShape(orig)) : orig;
            for (const g of this.list(mk.Generated(edge))) {
              const j = outFaces.indexOf(arena.own(copier.ModifiedShape(g)));
              if (j >= 0 && origins[j]!.length === 0) origins[j]!.push({ rel: 'generated', kind: 'edge', index: k });
              g.delete();
            }
          }
        } finally {
          edges.dispose();
        }
        made.length = 0;
        return { shape: id, faceOrigins: origins, gap };
      } finally {
        outFaces.dispose();
        sewn.dispose();
      }
    } finally {
      for (const m of made) this.release(m);
      faces.dispose();
      arena.dispose();
    }
  }

  /**
   * The whole solid offset by `distance` (4b, ADR 0067): the gap all round. OCCT gives a closed shell, which a boolean will not take as a tool; it is made into
   * the solid it bounds. Measured like `offsetFaces`. A negative distance shrinks the solid.
   */
  offsetSolid(target: ShapeId, distance: number, options: { tolerance?: number; join?: 'arc' | 'intersection' } = {}): { shape: ShapeId; gap: GapReport } {
    if (!(Math.abs(distance) > 0) || !Number.isFinite(distance)) throw new KernelError(t('surface.zeroDistance'));
    if (this.solidCount(target) === 0) throw new KernelError(t('surface.notSolid'));
    const oc = this.oc;
    const arena = new Arena();
    try {
      const mk = arena.own(new oc.BRepOffsetAPI_MakeOffsetShape());
      try {
        mk.PerformByJoin(this.get(target), distance, 1e-4, oc.BRepOffset_Mode.BRepOffset_Skin, false, false, options.join === 'intersection' ? oc.GeomAbs_JoinType.GeomAbs_Intersection : oc.GeomAbs_JoinType.GeomAbs_Arc, false, arena.own(new oc.Message_ProgressRange()));
      } catch (e) {
        throw new KernelError(t('surface.offsetFailed', { why: this.errorText(e) }));
      }
      if (!mk.IsDone()) throw new KernelError(t('surface.offsetFailed', { why: t('surface.notDone') }));
      // copied with its geometry (see offsetFaces)
      const copier = arena.own(new oc.BRepBuilderAPI_Copy(arena.own(mk.Shape()), true, false));
      let out = arena.own(copier.Shape());
      if (String(out.ShapeType()) === 'TopAbs_SHELL') out = arena.own(arena.own(new oc.BRepBuilderAPI_MakeSolid(oc.TopoDS.Shell(out))).Solid());
      if (!this.valid(out)) throw new KernelError(t('surface.offsetFailed', { why: t('surface.invalid') }));
      const id = this.put(out.Oriented(out.Orientation()));
      const gap = this.gapReport(id, target, Math.abs(distance));
      const tolerance = options.tolerance ?? SURFACE_TOLERANCE;
      const wrong = gapError(gap, Math.abs(distance), options.join === 'intersection');
      if (wrong > tolerance || (distance > 0 && this.massProps(id).volume <= this.massProps(target).volume)) {
        this.release(id);
        throw new KernelError(t('surface.gapTooBig', { distance: Math.abs(distance), worst: round3(wrong), tolerance }));
      }
      return { shape: id, gap };
    } finally {
      arena.dispose();
    }
  }

  /**
   * Surfaces sewn into one (C9.3 縫織): shapes whose edges meet to `tolerance` become one shell; closed, and when `makeSolid` is asked, the solid it bounds. Reports the
   * edges left free (the open boundary) and those shared by more than two faces. Sewing does not make faces, so every face of the result is a face of the shapes put in
   * (counted one shape after the other) that is the same or was mended to meet its neighbours: `faceOrigins`.
   */
  knit(shapes: ShapeId[], tolerance = 1e-4, makeSolid = true): { shape: ShapeId; freeEdges: number; multipleEdges: number; solid: boolean; faceOrigins: FaceOrigin[][] } {
    if (shapes.length === 0) throw new KernelError(t('surface.nothingToKnit'));
    const oc = this.oc;
    const arena = new Arena();
    const inputs = shapes.map((s) => ShapeIndex.of(oc, this.get(s), T.FACE, arena));
    try {
      const sewing = arena.own(new oc.BRepBuilderAPI_Sewing(tolerance, true, true, true, false));
      for (const s of shapes) sewing.Add(this.get(s));
      try {
        sewing.Perform(arena.own(new oc.Message_ProgressRange()));
      } catch (e) {
        throw new KernelError(t('surface.knitFailed', { why: this.errorText(e) }));
      }
      const sewn = arena.own(sewing.SewedShape());
      const freeEdges = sewing.NbFreeEdges();
      const multipleEdges = sewing.NbMultipleEdges();
      const originsOf = (id: ShapeId): FaceOrigin[][] => {
        const out = ShapeIndex.of(oc, this.get(id), T.FACE, arena);
        try {
          const origins: FaceOrigin[][] = out.keys.map(() => []);
          let n = 0;
          for (const input of inputs) {
            for (const f of input.keys) {
              const piece = sewing.IsModified(f) ? arena.own(sewing.Modified(f)) : f;
              const k = out.indexOf(piece);
              if (k >= 0) origins[k]!.push({ rel: 'same', kind: 'face', index: n });
              n++;
            }
          }
          return origins;
        } finally {
          out.dispose();
        }
      };
      if (makeSolid && freeEdges === 0 && multipleEdges === 0) {
        const shells = ShapeIndex.of(oc, sewn, 'TopAbs_SHELL', arena);
        try {
          if (shells.size === 1) {
            const fix = arena.own(new oc.ShapeFix_Solid());
            const solid = arena.own(fix.SolidFromShell(arena.own(oc.TopoDS.Shell(shells.keys[0]!))));
            const id = this.put(solid.Oriented(solid.Orientation()));
            if (this.isValid(id) && this.massProps(id).volume > 0) return { shape: id, freeEdges, multipleEdges, solid: true, faceOrigins: originsOf(id) };
            this.release(id);
          }
        } finally {
          shells.dispose();
        }
      }
      const id = this.put(sewn.Oriented(sewn.Orientation()));
      return { shape: id, freeEdges, multipleEdges, solid: false, faceOrigins: originsOf(id) };
    } finally {
      for (const input of inputs) input.dispose();
      arena.dispose();
    }
  }

  /**
   * A surface patch over a boundary (C9.2 填補): the edges `edgeIndices` of `target`, each with the face beside it that the patch is to meet tangent (`support`, the
   * face's number, or null for an edge alone) when `continuity` is 'tangent'. Reports how far the patch is from the boundary (`g0`) and from the tangent (`g1`).
   * An edge alone gives a patch that is only as good as its boundary (ADR 0067: 1 mm against 0.02 mm with the supporting face on a sphere).
   */
  fillSurface(target: ShapeId, edgeIndices: number[], support: (number | null)[] = [], continuity: 'contact' | 'tangent' = 'tangent'): { shape: ShapeId; g0: number; g1: number } {
    if (edgeIndices.length === 0) throw new KernelError(t('surface.noEdges'));
    const oc = this.oc;
    const arena = new Arena();
    const shape = this.get(target);
    const edges = ShapeIndex.of(oc, shape, T.EDGE, arena);
    const faces = ShapeIndex.of(oc, shape, T.FACE, arena);
    try {
      const filling = arena.own(new oc.BRepFill_Filling(3, 15, 2, false, 1e-5, 1e-4, 0.01, 0.1, 8, 9));
      edgeIndices.forEach((ei, k) => {
        const e = edges.keys[ei];
        if (!e) throw new KernelError(t('kernel.edgeOutOfRange', { index: ei }));
        const si = support[k] ?? null;
        const f = si === null ? undefined : faces.keys[si];
        if (continuity === 'tangent' && f) filling.Add(arena.own(oc.TopoDS.Edge(e)), arena.own(oc.TopoDS.Face(f)), oc.GeomAbs_Shape.GeomAbs_G1, true);
        else filling.Add(arena.own(oc.TopoDS.Edge(e)), oc.GeomAbs_Shape.GeomAbs_C0, true);
      });
      try {
        filling.Build();
      } catch (e) {
        throw new KernelError(t('surface.fillFailed', { why: this.errorText(e) }));
      }
      if (!filling.IsDone()) throw new KernelError(t('surface.fillFailed', { why: t('surface.notDone') }));
      const patch = arena.own(filling.Face());
      if (!this.valid(patch)) throw new KernelError(t('surface.fillFailed', { why: t('surface.invalid') }));
      return { shape: this.put(patch.Oriented(patch.Orientation())), g0: filling.G0Error(), g1: continuity === 'tangent' ? filling.G1Error() : 0 };
    } finally {
      edges.dispose();
      faces.dispose();
      arena.dispose();
    }
  }

  /** A flat patch over a closed loop of edges of `target` that lie in one plane (C9.2 平坦曲面). */
  flatSurface(target: ShapeId, edgeIndices: number[]): ShapeId {
    if (edgeIndices.length === 0) throw new KernelError(t('surface.noEdges'));
    const oc = this.oc;
    const arena = new Arena();
    const edges = ShapeIndex.of(oc, this.get(target), T.EDGE, arena);
    try {
      const wire = arena.own(new oc.BRepBuilderAPI_MakeWire());
      for (const ei of edgeIndices) {
        const e = edges.keys[ei];
        if (!e) throw new KernelError(t('kernel.edgeOutOfRange', { index: ei }));
        wire.Add(arena.own(oc.TopoDS.Edge(e)));
      }
      if (!wire.IsDone()) throw new KernelError(t('surface.loopNotConnected'));
      const mk = arena.own(new oc.BRepBuilderAPI_MakeFace(arena.own(wire.Wire()), true));
      if (!mk.IsDone()) throw new KernelError(t('surface.loopNotFlat'));
      const face = arena.own(mk.Face());
      return this.put(face.Oriented(face.Orientation()));
    } finally {
      edges.dispose();
      arena.dispose();
    }
  }

  /** The volume of the mesh of a solid (the signed volumes of the tetrahedra the triangles make with the origin): what a viewer would see, which a solid that is not closed does not give. */
  private meshVolume(id: ShapeId): number {
    const m = this.mesh(id);
    const P = m.positions;
    let v = 0;
    for (let i = 0; i < m.indices.length; i += 3) {
      const a = m.indices[i]! * 3;
      const b = m.indices[i + 1]! * 3;
      const c = m.indices[i + 2]! * 3;
      v += (P[a]! * (P[b + 1]! * P[c + 2]! - P[b + 2]! * P[c + 1]!) - P[a + 1]! * (P[b]! * P[c + 2]! - P[b + 2]! * P[c]!) + P[a + 2]! * (P[b]! * P[c + 1]! - P[b + 1]! * P[c]!)) / 6;
    }
    return v;
  }

  /**
   * A surface made into a solid `thickness` thick (C9.4 厚面): positive toward the side its normals point to, negative the other way. OCCT can give the solid inside out
   * (a negative volume); it is turned the right way. Checked: valid, one solid, and its farthest point from the surface is the thickness.
   */
  thicken(surface: ShapeId, thickness: number, options: { tolerance?: number } = {}): { shape: ShapeId; gap: GapReport; faceOrigins: FaceOrigin[][] } {
    if (!(Math.abs(thickness) > 0) || !Number.isFinite(thickness)) throw new KernelError(t('surface.zeroThickness'));
    if (this.solidCount(surface) > 0) throw new KernelError(t('surface.notSurface'));
    const oc = this.oc;
    const arena = new Arena();
    const inFaces = ShapeIndex.of(oc, this.get(surface), T.FACE, arena);
    const inEdges = ShapeIndex.of(oc, this.get(surface), T.EDGE, arena);
    try {
      const mk = arena.own(new oc.BRepOffsetAPI_MakeThickSolid());
      try {
        mk.MakeThickSolidBySimple(this.get(surface), thickness);
        mk.Build(arena.own(new oc.Message_ProgressRange()));
      } catch (e) {
        throw new KernelError(t('surface.thickenFailed', { why: this.errorText(e) }));
      }
      if (!mk.IsDone()) throw new KernelError(t('surface.thickenFailed', { why: t('surface.notDone') }));
      // copied with its geometry, as an offset is: what the builder made may refer to what it holds
      const copier = arena.own(new oc.BRepBuilderAPI_Copy(arena.own(mk.Shape()), true, false));
      let id = this.put(copier.Shape());
      if (this.massProps(id).volume < 0) {
        const turned = this.get(id).Reversed();
        this.release(id);
        id = this.put(turned);
      }
      const check = this.check(id);
      if (!check.valid || check.solids !== 1 || this.massProps(id).volume <= 0) {
        this.release(id);
        throw new KernelError(t('surface.thickenFailed', { why: t('surface.invalid') }));
      }
      // OCCT's simple thickening does not intersect the offsets at an edge where two faces meet at an angle: the result passes the checks above and its volume is a number, but the
      // faces at that edge do not close the solid (measured: an L of two planes gives a volume that the mesh of the same solid does not agree with). The solid is measured twice,
      // by its faces and by its mesh, and what disagrees is refused.
      const byFaces = this.massProps(id).volume;
      const byMesh = this.meshVolume(id);
      if (Math.abs(byMesh - byFaces) > 0.005 * Math.abs(byFaces) + 1e-6) {
        this.release(id);
        throw new KernelError(t('surface.thickenSharp', { faces: round3(byFaces), mesh: round3(byMesh) }));
      }
      const gap = this.gapReport(id, surface, Math.abs(thickness));
      const tolerance = options.tolerance ?? SURFACE_TOLERANCE;
      if (Math.abs(gap.max - Math.abs(thickness)) > tolerance) {
        this.release(id);
        throw new KernelError(t('surface.thickenWrong', { thickness: Math.abs(thickness), got: round3(gap.max), tolerance }));
      }
      // where each face of the solid came from: the face of the surface that is still there, the face made from it, and the faces made from its edges
      const out = ShapeIndex.of(oc, this.get(id), T.FACE, arena);
      try {
        const origins: FaceOrigin[][] = out.keys.map(() => []);
        const into = (s: TopoDS_Shape): number => out.indexOf(arena.own(copier.ModifiedShape(s)));
        inFaces.keys.forEach((f, i) => {
          const same = into(f);
          if (same >= 0) origins[same]!.push({ rel: 'same', kind: 'face', index: i });
          for (const g of [...this.list(mk.Generated(f)), ...this.list(mk.Modified(f))]) {
            const j = into(g);
            if (j >= 0 && j !== same && origins[j]!.length === 0) origins[j]!.push({ rel: 'generated', kind: 'face', index: i });
            g.delete();
          }
        });
        inEdges.keys.forEach((e, i) => {
          for (const g of this.list(mk.Generated(e))) {
            const j = into(g);
            if (j >= 0 && origins[j]!.length === 0) origins[j]!.push({ rel: 'generated', kind: 'edge', index: i });
            g.delete();
          }
        });
        // the walls round the edges are not in the builder's history: such a face is the one an edge of the surface lies on
        const mids = this.topology(surface).edges.map((e) => e.mid);
        out.keys.forEach((face, j) => {
          if (origins[j]!.length > 0) return;
          const i = mids.findIndex((mid) => {
            const vertex = arena.own(arena.own(new oc.BRepBuilderAPI_MakeVertex(this.pnt(arena, mid))).Vertex());
            const d = arena.own(new (oc.BRepExtrema_DistShapeShape as unknown as new (a: TopoDS_Shape, b: TopoDS_Shape) => InstanceType<OC['BRepExtrema_DistShapeShape']>)(vertex, face));
            return d.IsDone() && d.NbSolution() > 0 && d.Value() < 1e-5;
          });
          if (i >= 0) origins[j]!.push({ rel: 'generated', kind: 'edge', index: i });
        });
        return { shape: id, gap, faceOrigins: origins };
      } finally {
        out.dispose();
      }
    } finally {
      inFaces.dispose();
      inEdges.dispose();
      arena.dispose();
    }
  }

  /**
   * A solid cut along a surface (C9.4 以曲面除料): the surface (a face or a shell) is swept along `dir` into a tool, and the solid keeps what is on the side of
   * the surface the direction points away from (`keep: 'behind'`) or toward (`'ahead'`). The surface has to reach across the solid.
   */
  cutWithSurface(target: ShapeId, surface: ShapeId, dir: Vec3, keep: 'behind' | 'ahead' = 'behind'): OpResult {
    const tool = this.surfaceTool(target, surface, dir);
    try {
      return this.boolean(keep === 'behind' ? 'cut' : 'common', target, tool.shape);
    } catch (e) {
      if (e instanceof KernelError) throw e;
      throw new KernelError(t('surface.cutFailed', { why: this.errorText(e) }));
    } finally {
      this.release(tool.shape);
    }
  }

  /**
   * The surface (a face or a shell) swept along `dir` far enough to clear `target` wherever the surface is: the solid that a cut with the surface takes away. The faces of
   * it that are the surface as it was are `generated` from the face of the surface, those made from an edge of the surface from that edge. It is the caller's to release.
   */
  surfaceTool(target: ShapeId, surface: ShapeId, dir: Vec3): OpResult {
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    if (!(len > 0)) throw new KernelError(t('kernel.badViewDirection'));
    if (this.solidCount(surface) > 0) throw new KernelError(t('surface.notSurface'));
    const oc = this.oc;
    const arena = new Arena();
    const inFaces = ShapeIndex.of(oc, this.get(surface), T.FACE, arena);
    const inEdges = ShapeIndex.of(oc, this.get(surface), T.EDGE, arena);
    let tool: ShapeId | null = null;
    try {
      const box = arena.own(new oc.Bnd_Box());
      oc.BRepBndLib.Add(this.get(target), box, false);
      const a = this.xyz(arena.own(box.CornerMin()));
      const b = this.xyz(arena.own(box.CornerMax()));
      // long enough to carry the surface clear across the solid, wherever the surface is
      const sb = this.bounds(surface);
      const far = Math.max(...sb.max.map(Math.abs), ...sb.min.map(Math.abs));
      const reach = 2 * Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) + 2 * far + 10;
      const sweep = arena.own(new oc.BRepPrimAPI_MakePrism(this.get(surface), arena.own(new oc.gp_Vec((dir[0] / len) * reach, (dir[1] / len) * reach, (dir[2] / len) * reach)), false, true));
      if (!sweep.IsDone()) throw new KernelError(t('surface.cutFailed', { why: t('surface.notDone') }));
      tool = this.put(sweep.Shape());
      if (this.solidCount(tool) === 0) throw new KernelError(t('surface.cutFailed', { why: t('surface.notClosedSweep') }));
      const out = ShapeIndex.of(oc, this.get(tool), T.FACE, arena);
      try {
        const origins: FaceOrigin[][] = out.keys.map(() => []);
        inFaces.keys.forEach((f, i) => {
          const j = out.indexOf(arena.own(sweep.FirstShape(f)));
          if (j >= 0) origins[j]!.push({ rel: 'generated', kind: 'face', index: i });
        });
        inEdges.keys.forEach((e, i) => {
          for (const g of this.list(sweep.Generated(e))) {
            const j = out.indexOf(g);
            if (j >= 0 && origins[j]!.length === 0) origins[j]!.push({ rel: 'generated', kind: 'edge', index: i });
            g.delete();
          }
        });
        const made = tool;
        tool = null;
        return { shape: made, faceOrigins: origins };
      } finally {
        out.dispose();
      }
    } catch (e) {
      if (e instanceof KernelError) throw e;
      throw new KernelError(t('surface.cutFailed', { why: this.errorText(e) }));
    } finally {
      if (tool !== null) this.release(tool);
      inFaces.dispose();
      inEdges.dispose();
      arena.dispose();
    }
  }

  /**
   * Only the faces `faceIndices` of a shape (C9.3 修剪, after a split): the others go, and what is left is a compound of those faces, which still share the edges they
   * shared. Every face of the result is the face it was (`faceOrigins`).
   */
  keepFaces(target: ShapeId, faceIndices: number[]): OpResult {
    const oc = this.oc;
    const arena = new Arena();
    const faces = ShapeIndex.of(oc, this.get(target), T.FACE, arena);
    try {
      const picked = [...new Set(faceIndices)].sort((x, y) => x - y);
      if (picked.length === 0) throw new KernelError(t('surface.noFaces'));
      const kept = picked.map((i) => {
        const f = faces.keys[i];
        if (!f) throw new KernelError(t('edit.faceOutOfRange', { index: i }));
        return f;
      });
      const id = this.put(this.compound(kept, arena));
      const out = ShapeIndex.of(oc, this.get(id), T.FACE, arena);
      try {
        const origins: FaceOrigin[][] = out.keys.map(() => []);
        picked.forEach((index, k) => {
          const j = out.indexOf(kept[k]!);
          if (j >= 0) origins[j]!.push({ rel: 'same', kind: 'face', index });
        });
        return { shape: id, faceOrigins: origins };
      } finally {
        out.dispose();
      }
    } finally {
      faces.dispose();
      arena.dispose();
    }
  }

  /**
   * 「互相修剪曲面」 (P-3, ADR 0109): two surface bodies cut at the curves where they cross, each into the pieces it is made of. One general fuse of the two (`BRepAlgoAPI_BuilderAlgo`,
   * with its history), then the faces of the result that lie on the same surface are merged again (a hole across the seam of a cylinder is one patch, not two). Each result is a
   * compound of the pieces of its own surface, and every piece says which face of its input it came from (`faceOrigins`, `modified`, or `same` when the face was not touched). Pieces of
   * the two surfaces that lie on each other (the same plane twice) are refused: a piece cannot be in two bodies. What is left to the caller: that nothing was cut (the surfaces do not
   * meet, or only touch), which shows as the same number of faces as went in.
   */
  trimSurfaces(a: ShapeId, b: ShapeId): { a: OpResult; b: OpResult } {
    if (this.solidCount(a) > 0 || this.solidCount(b) > 0) throw new KernelError(t('surface.notSurface'));
    const oc = this.oc;
    const arena = new Arena();
    const inputs = [ShapeIndex.of(oc, this.get(a), T.FACE, arena), ShapeIndex.of(oc, this.get(b), T.FACE, arena)];
    try {
      const args = arena.own(new oc.NCollection_List_TopoDS_Shape());
      args.Append(this.get(a));
      args.Append(this.get(b));
      const mk = arena.own(new oc.BRepAlgoAPI_BuilderAlgo());
      try {
        mk.SetArguments(args);
        mk.SetToFillHistory(true);
        mk.Build(arena.own(new oc.Message_ProgressRange()));
      } catch (e) {
        throw new KernelError(t('surface.trimFailed', { why: this.errorText(e) }));
      }
      if (mk.HasErrors() || !mk.IsDone()) throw new KernelError(t('surface.trimFailed', { why: t('surface.notDone') }));
      mk.SimplifyResult(true, true, 1e-9);
      const raw = arena.own(mk.Shape());
      if (!this.valid(raw)) throw new KernelError(t('surface.trimFailed', { why: t('surface.invalid') }));
      const out = ShapeIndex.of(oc, raw, T.FACE, arena);
      try {
        // the pieces each input face became: where they are in the whole result, and whether the face was touched at all
        const pieces = inputs.map((src) =>
          src.keys.map((face) => {
            const modified = this.list(mk.Modified(face));
            try {
              if (modified.length > 0) return { at: modified.map((m) => out.indexOf(m)).filter((j) => j >= 0), same: false };
              return { at: mk.IsDeleted(face) ? [] : [out.indexOf(face)].filter((j) => j >= 0), same: true };
            } finally {
              for (const m of modified) m.delete();
            }
          }),
        );
        const mine = pieces.map((p) => new Set(p.flatMap((x) => x.at)));
        if ([...mine[0]!].some((j) => mine[1]!.has(j))) throw new KernelError(t('surface.trimCoincident'));
        const made: ShapeId[] = [];
        try {
          const result = pieces.map((p, which): OpResult => {
            const at = [...mine[which]!].sort((x, y) => x - y);
            if (at.length === 0) throw new KernelError(t('surface.trimFailed', { why: t('surface.invalid') }));
            const id = this.put(this.compound(at.map((j) => out.keys[j]!), arena));
            made.push(id);
            const faces = ShapeIndex.of(oc, this.get(id), T.FACE, arena);
            try {
              const origins: FaceOrigin[][] = faces.keys.map(() => []);
              p.forEach((x, i) => {
                for (const j of x.at) {
                  const k = faces.indexOf(out.keys[j]!);
                  if (k >= 0) origins[k]!.push({ rel: x.same ? 'same' : 'modified', kind: 'face', index: i });
                }
              });
              return { shape: id, faceOrigins: origins };
            } finally {
              faces.dispose();
            }
          });
          return { a: result[0]!, b: result[1]! };
        } catch (e) {
          for (const id of made) this.release(id);
          throw e;
        }
      } finally {
        out.dispose();
      }
    } finally {
      for (const i of inputs) i.dispose();
      arena.dispose();
    }
  }

  /**
   * A one-face surface made longer past the edges `edgeIndices` by `length` (C9.3 延伸): the face is grown along its own parameters (`BRepLib::ExtendFace`, tried in
   * ADR 0071 on a plane, a cylinder, a cone and a freeform side). Which side of the face each edge is one of is found by trying them: extending a side takes the edge
   * from the boundary of the face, so the side that does is the edge's. A periodic side (the way round a cylinder) has no end to extend and is refused. The result
   * is checked: valid, larger, and the face it was lies within it.
   */
  extendFace(target: ShapeId, edgeIndices: number[], length: number, options: { tolerance?: number } = {}): OpResult {
    if (edgeIndices.length === 0) throw new KernelError(t('surface.noEdges'));
    if (!(length > 0) || !Number.isFinite(length)) throw new KernelError(t('surface.zeroDistance'));
    if (this.solidCount(target) > 0) throw new KernelError(t('surface.notSurface'));
    const oc = this.oc;
    const arena = new Arena();
    const faces = ShapeIndex.of(oc, this.get(target), T.FACE, arena);
    const topology = this.topology(target);
    try {
      if (faces.size !== 1) throw new KernelError(t('surface.extendOneFace'));
      const face = arena.own(oc.TopoDS.Face(faces.keys[0]!));
      type Sides = [boolean, boolean, boolean, boolean];
      const extendOn = (sides: Sides): TopoDS_Shape => {
        const out = arena.own(new oc.TopoDS_Face());
        oc.BRepLib.ExtendFace(face, length, sides[0], sides[1], sides[2], sides[3], out);
        return out;
      };
      const chosen: Sides = [false, false, false, false];
      for (const ei of edgeIndices) {
        const e = topology.edges[ei];
        if (!e) throw new KernelError(t('kernel.edgeOutOfRange', { index: ei }));
        const mid = arena.own(arena.own(new oc.BRepBuilderAPI_MakeVertex(this.pnt(arena, e.mid))).Vertex());
        let best = -1;
        let far = length / 4;
        for (let k = 0; k < 4; k++) {
          const sides: Sides = [k === 0, k === 1, k === 2, k === 3];
          let grown: TopoDS_Shape;
          try {
            grown = extendOn(sides);
          } catch {
            continue;
          }
          const boundary = ShapeIndex.of(oc, grown, T.EDGE, arena);
          try {
            const d = arena.own(new (oc.BRepExtrema_DistShapeShape as unknown as new (a: TopoDS_Shape, b: TopoDS_Shape) => InstanceType<OC['BRepExtrema_DistShapeShape']>)(mid, this.compound(boundary.keys, arena)));
            if (d.IsDone() && d.NbSolution() > 0 && d.Value() > far) {
              far = d.Value();
              best = k;
            }
          } finally {
            boundary.dispose();
          }
        }
        if (best < 0) throw new KernelError(t('surface.extendNoSide'));
        chosen[best] = true;
      }
      let grown: TopoDS_Shape;
      try {
        grown = extendOn(chosen);
      } catch (e) {
        throw new KernelError(t('surface.extendFailed', { why: this.errorText(e) }));
      }
      const id = this.put(grown.Oriented(grown.Orientation()));
      const fail = (why: string): never => {
        this.release(id);
        throw new KernelError(t('surface.extendFailed', { why }));
      };
      if (!this.isValid(id)) fail(t('surface.invalid'));
      const before = topology.faces[0]!.area;
      const after = this.topology(id).faces.reduce((a, f) => a + f.area, 0);
      if (!(after > before * (1 + 1e-6))) fail(t('surface.extendNoGrowth'));
      // what was there is still there: the old face's points are on the new one
      const kept = this.gapReport(target, id);
      if (kept.max > (options.tolerance ?? SURFACE_TOLERANCE)) fail(t('surface.extendMoved', { moved: round3(kept.max) }));
      return { shape: id, faceOrigins: [[{ rel: 'modified', kind: 'face', index: 0 }]] };
    } finally {
      faces.dispose();
      arena.dispose();
    }
  }

  /**
   * The faces of a shape converted to B-splines (so that another CAD reads them: an offset surface is an OCCT type); the shape is the same to 1e-4 mm.
   */
  toBSpline(id: ShapeId): ShapeId {
    const oc = this.oc;
    const arena = new Arena();
    try {
      try {
        const conv = arena.own(new oc.BRepBuilderAPI_NurbsConvert(this.get(id), true));
        const out = arena.own(conv.Shape());
        return this.put(out.Oriented(out.Orientation()));
      } catch (e) {
        // the converter stops on some faces that are B-splines already (the rounded join of an offset round a freeform edge: ADR 0067's limits)
        throw new KernelError(t('surface.bsplineFailed', { why: this.errorText(e) }));
      }
    } finally {
      arena.dispose();
    }
  }

  /**
   * Splits a face along curves projected onto it (C8.1 分割線): each closed loop of `loops` drawn in `frame` is projected along `dir` onto face `faceIndex` of the
   * target, and the face is cut along them. A line of sight crosses the shape more than once, and the projection has a wire on each crossing: only the nearest to the
   * drawn loop (the first one met) is used, unless `throughAll`. Where a region crosses the seam of a periodic face the cut leaves it in two pieces, which are
   * merged again with the edges of the loop kept. `regions` are the faces of the result that the loops bound (the numbers of the pieces inside them), and `regionLoops` the loop each is of.
   */
  splitByProjection(target: ShapeId, faceIndex: number, frame: Frame, loops: Segment[][], dir: Vec3, throughAll = false): OpResult & { regions: number[]; regionLoops: number[] } {
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    if (!(len > 0)) throw new KernelError(t('kernel.badViewDirection'));
    if (loops.length === 0) throw new KernelError(t('surface.nothingProjected'));
    const oc = this.oc;
    const arena = new Arena();
    const shape = this.get(target);
    const faces = ShapeIndex.of(oc, shape, T.FACE, arena);
    try {
      const face = faces.keys[faceIndex];
      if (!face) throw new KernelError(t('edit.faceOutOfRange', { index: faceIndex }));
      const centre = (s: TopoDS_Shape): Vec3 => {
        const box = arena.own(new oc.Bnd_Box());
        oc.BRepBndLib.Add(s, box, false);
        const lo = this.xyz(arena.own(box.CornerMin()));
        const hi = this.xyz(arena.own(box.CornerMax()));
        return [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
      };
      // each loop projected: the drawn loop's centre, and each projected wire's: the nearest along the line of sight is the first one met
      const used: { wire: TopoDS_Shape; loop: number }[] = [];
      loops.forEach((segments, li) => {
        const wire = this.wire(arena, frame, segments, false, new Map<TopoDS_Shape, string>());
        const proj = arena.own(new oc.BRepProj_Projection(wire, face, arena.own(this.dir(arena, [dir[0] / len, dir[1] / len, dir[2] / len]))));
        if (!proj.IsDone()) throw new KernelError(t('surface.nothingProjected'));
        const from = centre(wire);
        const found: { wire: TopoDS_Shape; along: number }[] = [];
        for (proj.Init(); proj.More(); proj.Next()) {
          const w = proj.Current();
          const c = centre(w);
          found.push({ wire: w, along: ((c[0] - from[0]) * dir[0] + (c[1] - from[1]) * dir[1] + (c[2] - from[2]) * dir[2]) / len });
        }
        // the projection runs both ways along the line; the sight is the way `dir` points
        const ahead = found.filter((f) => f.along > -1e-6);
        if (ahead.length === 0) throw new KernelError(t('surface.nothingProjected'));
        for (const u of throughAll ? ahead : [ahead.sort((x, y) => x.along - y.along)[0]!]) used.push({ wire: u.wire, loop: li });
      });
      const split = arena.own(new oc.BRepFeat_SplitShape(shape));
      for (const u of used) split.Add(arena.own(oc.TopoDS.Wire(u.wire)), arena.own(oc.TopoDS.Face(face)));
      try {
        split.Build(arena.own(new oc.Message_ProgressRange()));
      } catch (e) {
        throw new KernelError(t('surface.splitFailed', { why: this.errorText(e) }));
      }
      const cut = arena.own(split.Shape());
      // the loops' edges as the cut has them, kept while the pieces of one region are merged
      const loopEdges: { edge: TopoDS_Shape; loop: number }[] = [];
      for (const u of used) {
        const ex = arena.own(new oc.TopExp_Explorer(u.wire, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE));
        for (; ex.More(); ex.Next()) {
          const e = ex.Current();
          const modified = this.list(split.Modified(e));
          for (const m of modified.length > 0 ? modified : [e]) loopEdges.push({ edge: m, loop: u.loop });
        }
      }
      const unifier = arena.own(new oc.ShapeUpgrade_UnifySameDomain(cut, true, true, false));
      for (const e of loopEdges) unifier.KeepShape(e.edge);
      unifier.Build();
      const out = unifier.Shape();
      if (!this.valid(out)) {
        out.delete();
        throw new KernelError(t('surface.splitFailed', { why: t('surface.invalid') }));
      }
      const history = arena.own(unifier.History());
      const before = ShapeIndex.of(oc, shape, T.FACE, arena);
      const after = ShapeIndex.of(oc, out, T.FACE, arena);
      const edgesOut = ShapeIndex.of(oc, out, T.EDGE, arena);
      try {
        const origins: FaceOrigin[][] = after.keys.map(() => []);
        const regions: number[] = [];
        const regionLoops: number[] = [];
        // every face of the result comes from a face of the target (the split one gives several)
        before.keys.forEach((f, i) => {
          const pieces = i === faceIndex ? this.list(split.Modified(f)) : [f];
          const mapped: TopoDS_Shape[] = [];
          for (const p of pieces) {
            const merged = this.list(history.Modified(p));
            mapped.push(...(merged.length > 0 ? merged : [p]));
          }
          for (const m of mapped) {
            const j = after.indexOf(m);
            if (j >= 0 && !origins[j]!.some((o) => 'index' in o && o.index === i)) origins[j]!.push({ rel: i === faceIndex ? 'modified' : 'same', kind: 'face', index: i });
          }
        });
        // a piece of the split face is a region when every edge round it is an edge of a loop; the loop it is of is the first that bounds it
        const keep = new Map<number, number>();
        for (const e of loopEdges) {
          const k = edgesOut.indexOf(e.edge);
          if (k >= 0 && !keep.has(k)) keep.set(k, e.loop);
        }
        const around = (f: TopoDS_Shape): number[] => {
          const sub = ShapeIndex.of(oc, f, T.EDGE, arena);
          try {
            return sub.keys.map((e) => edgesOut.indexOf(e));
          } finally {
            sub.dispose();
          }
        };
        after.keys.forEach((f, j) => {
          if (!origins[j]!.some((o) => 'index' in o && o.index === faceIndex)) return;
          const es = around(f);
          if (es.length > 0 && es.every((k) => keep.has(k))) {
            regions.push(j);
            regionLoops.push(Math.min(...es.map((k) => keep.get(k)!)));
          }
        });
        return { shape: this.put(out), faceOrigins: origins, regions, regionLoops };
      } finally {
        before.dispose();
        after.dispose();
        edgesOut.dispose();
      }
    } finally {
      faces.dispose();
      arena.dispose();
    }
  }

  // ------------------------------------------------------------------ plastic part features (C4.11, Phase 6)

  /**
   * The solid of a lip or a groove (C4.11, ADR 0079): on the planar face `faceIndex` of `target`, a ring that follows the outer outline of the face. The outline is offset inward
   * (`BRepOffsetAPI_MakeOffset`) by `offset` and by `offset + width`, and the ring between the two is grown `height` along the outward normal of the face (`out`: a lip) or along
   * the inward one (`in`: what a groove takes away). The ring has to lie on the face (the face itself, with its holes: a ring over the cavity of a shell is refused), and it
   * has to be there: an offset that is larger than the face is wide fails. `sides` says what each face of the tool is, for its name: an end, or a side made from an
   * edge of the face's outline (the body's edge number) on the outer or the inner side of the ring. The tool is the caller's to release.
   */
  ringTool(target: ShapeId, faceIndex: number, offset: number, width: number, height: number, direction: 'out' | 'in'): { shape: ShapeId; sides: RingSide[]; area: number } {
    if (![offset, width, height].every(Number.isFinite) || !(offset >= 0) || !(width > 0) || !(height > 0)) throw new KernelError(t('lip.badSizes'));
    const oc = this.oc;
    const arena = new Arena();
    const topology = this.topology(target);
    const info = topology.faces[faceIndex];
    if (!info) throw new KernelError(t('edit.faceOutOfRange', { index: faceIndex }));
    if (info.surface !== 'plane' || !info.normal) throw new KernelError(t('lip.planeOnly'));
    const faces = ShapeIndex.of(oc, this.get(target), T.FACE, arena);
    const bodyEdges = ShapeIndex.of(oc, this.get(target), T.EDGE, arena);
    const made: ShapeId[] = [];
    try {
      const face = arena.own(oc.TopoDS.Face(faces.keys[faceIndex]!));
      const outer = arena.own(oc.BRepTools.OuterWire(face));
      const diagonal = (s: TopoDS_Shape) => {
        const box = arena.own(new oc.Bnd_Box());
        oc.BRepBndLib.Add(s, box, false);
        const lo = this.xyz(arena.own(box.CornerMin()));
        const hi = this.xyz(arena.own(box.CornerMax()));
        return Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]);
      };
      // the outline offset inward by d (the wire does not say which side is in: the one that is smaller is)
      const inward = (d: number): TopoDS_Shape => {
        if (d < 1e-12) return outer;
        const size = diagonal(outer);
        for (const sign of [-1, 1]) {
          const mk = arena.own(new oc.BRepOffsetAPI_MakeOffset(outer, oc.GeomAbs_JoinType.GeomAbs_Intersection, false));
          try {
            mk.Perform(sign * d);
            if (!mk.IsDone()) continue;
          } catch {
            continue;
          }
          const wires = ShapeIndex.of(oc, arena.own(mk.Shape()), 'TopAbs_WIRE', arena);
          if (wires.size !== 1) continue;
          const wire = arena.own(oc.TopoDS.Wire(wires.keys[0]!));
          if (diagonal(wire) < size - 1e-9) return wire;
        }
        throw new KernelError(t('lip.offsetFailed', { distance: d }));
      };
      const w1 = inward(offset);
      const w2 = inward(offset + width);
      const mkRing = arena.own(new oc.BRepBuilderAPI_MakeFace(w1 as never, true));
      mkRing.Add(arena.own(oc.TopoDS.Wire(w2.Reversed())));
      if (!mkRing.IsDone()) throw new KernelError(t('lip.offsetFailed', { distance: offset + width }));
      const ring = arena.own(mkRing.Face());
      const ringId = this.put(ring.Oriented(ring.Orientation()));
      made.push(ringId);
      const area = this.topology(ringId).faces.reduce((a, f) => a + f.area, 0);
      if (!(area > 1e-9)) throw new KernelError(t('lip.offsetFailed', { distance: offset + width }));
      const n = info.normal;
      const sign = direction === 'out' ? 1 : -1;
      const step: Vec3 = [n[0] * sign * height, n[1] * sign * height, n[2] * sign * height];
      const prism = (f: TopoDS_Shape) => {
        const mk = arena.own(new oc.BRepPrimAPI_MakePrism(f, arena.own(new oc.gp_Vec(step[0], step[1], step[2])), false, true));
        return mk.Shape();
      };
      const tool = this.put(prism(ring));
      made.push(tool);
      if (this.solidCount(tool) !== 1) throw new KernelError(t('lip.offsetFailed', { distance: offset + width }));
      // the ring must lie on the face (with its holes): what the ring and the face have in common, grown the same height, is all of the ring
      const common = this.boolean('common', tool, this.put(prism(face)));
      const shared = this.massProps(common.shape).volume;
      this.release(common.shape);
      if (!(shared >= area * height * (1 - 1e-6))) throw new KernelError(t('lip.notOnFace'));

      // what each face of the tool is
      const dirv: Vec3 = [n[0] * sign, n[1] * sign, n[2] * sign];
      const along = (p: Vec3) => p[0] * dirv[0] + p[1] * dirv[1] + p[2] * dirv[2];
      const base = along(info.center);
      const outline = ShapeIndex.of(oc, outer, T.EDGE, arena);
      const candidates = outline.keys.map((e) => ({ edge: e, index: bodyEdges.indexOf(e) }));
      const sides: RingSide[] = this.topology(tool).faces.map((f): RingSide => {
        if (f.surface === 'plane' && f.normal && Math.abs(f.normal[0] * dirv[0] + f.normal[1] * dirv[1] + f.normal[2] * dirv[2]) > 0.999) return { kind: 'cap', which: Math.abs(along(f.center) - base) < 1e-6 ? 'start' : 'end' };
        // a side: the edge of the outline it came from is the nearest one, seen from the plane of the face
        const lift = along(f.center) - base;
        const flat: Vec3 = [f.center[0] - dirv[0] * lift, f.center[1] - dirv[1] * lift, f.center[2] - dirv[2] * lift];
        const vertex = arena.own(arena.own(new oc.BRepBuilderAPI_MakeVertex(this.pnt(arena, flat))).Vertex());
        let best = { index: -1, distance: Infinity };
        for (const c of candidates) {
          const d = arena.own(new (oc.BRepExtrema_DistShapeShape as unknown as new (a: TopoDS_Shape, b: TopoDS_Shape) => InstanceType<OC['BRepExtrema_DistShapeShape']>)(vertex, c.edge));
          if (d.IsDone() && d.NbSolution() > 0 && d.Value() < best.distance) best = { index: c.index, distance: d.Value() };
        }
        return { kind: 'side', edge: best.index, inner: best.distance > offset + width / 2 };
      });
      made.pop();
      return { shape: tool, sides, area };
    } finally {
      for (const id of made) this.release(id);
      faces.dispose();
      bodyEdges.dispose();
      arena.dispose();
    }
  }

  // ------------------------------------------------------------------ analysis (E3.2, Phase 6)

  /**
   * Draft analysis (E3.2): the angle of every face's surface to the direction a mold opens along. For each face the surface's own normal is worked out at the nodes of its
   * mesh (the surface evaluated at the node's (u, v): exact; the mesh's own normals, averaged from its triangles, are 0.1° out on a 5° cone, ADR 0074), turned outward, and
   * the angle is asin(normal · pull). A face is `positive` when every sample is at least `required` (radians), `negative` when every one is at most −required,
   * `straddle` when it has both, `required` when it is nearer to the direction than that (a wall that has to be given draft). The mesh is made on a copy of the shape, as
   * fine as `angular` says (a shape is meshed once, at the first fineness asked: ADR 0074), so the answer does not depend on how the shape is shown.
   */
  draftAnalysis(id: ShapeId, pull: Vec3, required: number, options: { angular?: number } = {}): DraftReport {
    const len = Math.hypot(pull[0], pull[1], pull[2]);
    if (!(len > 0) || !Number.isFinite(len)) throw new KernelError(t('kernel.badViewDirection'));
    if (!(required >= 0) || !Number.isFinite(required)) throw new KernelError(t('analysis.badAngle'));
    const dir: Vec3 = [pull[0] / len, pull[1] / len, pull[2] / len];
    const oc = this.oc;
    const topology = this.topology(id);
    const copy = this.clone(id);
    const arena = new Arena();
    try {
      this.mesh(copy, { relative: 2e-3, angular: options.angular ?? 0.1 });
      const faces = ShapeIndex.of(oc, this.get(copy), T.FACE, arena);
      try {
        if (faces.size !== topology.faces.length) throw new KernelError(t('regen.internal', { why: 'the copy of the shape has other faces than the shape' }));
        const report: DraftFace[] = faces.keys.map((f, i) => {
          const face = arena.own(oc.TopoDS.Face(f));
          const loc = arena.own(new oc.TopLoc_Location());
          const tri = oc.BRep_Tool.Triangulation(face, loc, 0);
          let min = Infinity;
          let max = -Infinity;
          let samples = 0;
          if (tri && tri.HasUVNodes()) {
            arena.own(tri);
            const trsf = arena.own(loc.Transformation());
            const surface = arena.own(new oc.BRepAdaptor_Surface(face, true));
            const reversed = face.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED;
            for (let n = 1; n <= tri.NbNodes(); n++) {
              const uv = arena.own(tri.UVNode(n));
              const props = arena.own(new oc.BRepLProp_SLProps(surface, uv.X(), uv.Y(), 1, 1e-9));
              if (!props.IsNormalDefined()) continue; // the pole of a sphere, the apex of a cone
              const nd = arena.own(props.Normal());
              const v = arena.own(new oc.gp_Vec(nd.X(), nd.Y(), nd.Z()));
              v.Transform(trsf);
              const s = reversed ? -1 : 1;
              const a = Math.asin(Math.max(-1, Math.min(1, s * (v.X() * dir[0] + v.Y() * dir[1] + v.Z() * dir[2]))));
              min = Math.min(min, a);
              max = Math.max(max, a);
              samples++;
            }
          }
          const area = topology.faces[i]!.area;
          if (samples === 0) {
            // nothing to sample (a face too small to mesh, or all poles): a flat face has the one normal
            const n = topology.faces[i]!.normal;
            if (!n) return { face: i, kind: 'unknown', min: NaN, max: NaN, samples: 0, area };
            const a = Math.asin(Math.max(-1, Math.min(1, n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2])));
            return { face: i, kind: draftClass(a, a, required), min: a, max: a, samples: 0, area };
          }
          return { face: i, kind: draftClass(min, max, required), min, max, samples, area };
        });
        const totals = { positive: { faces: 0, area: 0 }, negative: { faces: 0, area: 0 }, required: { faces: 0, area: 0 }, straddle: { faces: 0, area: 0 }, unknown: { faces: 0, area: 0 } };
        for (const f of report) {
          totals[f.kind].faces++;
          totals[f.kind].area += f.area;
        }
        return { required, faces: report, totals };
      } finally {
        faces.dispose();
      }
    } finally {
      arena.dispose();
      this.release(copy);
    }
  }

  /**
   * Undercut analysis (E3.3): what of each face can be seen along the pull direction, from either end (a face that can be seen from neither cannot be formed by a mold that
   * just opens, and needs a slide). Every triangle of the mesh (made on a copy, as fine as `angular` and `tolerance` say) is a point: a ray starts a hair off its centre along
   * its outward normal and runs along `+pull` and `-pull` against all the other triangles (a bounding-volume tree: `anyHit`). The share of a face's area clear each way,
   * and clear neither way, makes its class. With more than `maxSamples` triangles every few are used, the same share of each face. A wall along the pull is clear
   * both ways (it is a draft problem, not an undercut).
   */
  undercutAnalysis(id: ShapeId, pull: Vec3, options: { angular?: number; tolerance?: number; maxSamples?: number; offset?: number } = {}): UndercutReport {
    const len = Math.hypot(pull[0], pull[1], pull[2]);
    if (!(len > 0) || !Number.isFinite(len)) throw new KernelError(t('kernel.badViewDirection'));
    const began = performance.now();
    const up: Vec3 = [pull[0] / len, pull[1] / len, pull[2] / len];
    const down: Vec3 = [-up[0], -up[1], -up[2]];
    const topology = this.topology(id);
    const copy = this.clone(id);
    try {
      // the mesh deviates from the surface by up to its tolerance, so a ray that starts a hair off a facet can meet the facets beside it where the surface curves along the
      // ray (the equator of a sphere seen from above): the rays start about the tolerance off the surface instead
      const size = this.bounds(id);
      const tolerance = options.tolerance ?? Math.min(1, Math.max(0.002, Math.hypot(size.max[0] - size.min[0], size.max[1] - size.min[1], size.max[2] - size.min[2]) * 2e-3));
      const mesh = this.mesh(copy, { tolerance, angular: options.angular ?? 0.2 });
      const bvh = buildBvh(mesh.positions, mesh.indices);
      const off = Math.max(1e-4, options.offset ?? 0.75 * tolerance);
      const faces = topology.faces.map(() => ({ up: 0, down: 0, blocked: 0, area: 0, samples: 0 }));
      const samples = forEachSample(mesh, { maxSamples: options.maxSamples ?? 60000 }, (face, triangle, point, nrm, w) => {
        const acc = faces[face];
        if (!acc) return;
        const o: Vec3 = [point[0] + nrm[0] * off, point[1] + nrm[1] * off, point[2] + nrm[2] * off];
        const clearUp = !anyHit(bvh, o, up, triangle);
        const clearDown = !anyHit(bvh, o, down, triangle);
        acc.area += w;
        acc.samples++;
        if (clearUp) acc.up += w;
        if (clearDown) acc.down += w;
        if (!clearUp && !clearDown) acc.blocked += w;
      });
      const report: UndercutFace[] = faces.map((f, i) => {
        const area = topology.faces[i]!.area;
        if (f.samples === 0 || !(f.area > 0)) return { face: i, kind: 'unknown', up: NaN, down: NaN, blocked: NaN, samples: 0, area };
        const [u, d, bl] = [f.up / f.area, f.down / f.area, f.blocked / f.area];
        return { face: i, kind: undercutClass(u, d, bl), up: u, down: d, blocked: bl, samples: f.samples, area };
      });
      const totals = {} as UndercutReport['totals'];
      for (const k of ['up', 'down', 'both', 'split', 'partial', 'undercut', 'unknown'] as const) totals[k] = { faces: 0, area: 0 };
      let undercutArea = 0;
      for (const f of report) {
        totals[f.kind].faces++;
        totals[f.kind].area += f.area;
        if (f.kind !== 'unknown') undercutArea += f.blocked * f.area;
      }
      return { faces: report, totals, undercutArea, triangles: Math.floor(mesh.indices.length / 3), samples, ms: performance.now() - began };
    } finally {
      this.release(copy);
    }
  }

  /**
   * Thickness analysis (E3.5): how thick the wall is at every point of the surface, as the distance along the inward normal to the next surface. Every triangle of the
   * mesh (made on a copy, as fine as `angular` and `tolerance` say) is a point: a ray starts at its centre, a hair into the material, and runs along minus its outward
   * normal to the nearest triangle of the mesh (a bounding-volume tree: `nearestHit`). Per face: the least, mean and greatest thickness and the shares thinner than `min`
   * and thicker than `max`; a face with no surface on the other side (a sheet) is `open`. ADR 0074: the edge face of an open shell is measured down the whole wall and so
   * comes out thick, which it is. With more than `maxSamples` triangles every few are used.
   */
  thicknessAnalysis(id: ShapeId, options: { min?: number; max?: number; angular?: number; tolerance?: number; maxSamples?: number } = {}): ThicknessReport {
    const { min, max } = options;
    if ((min !== undefined && !(min > 0)) || (max !== undefined && !(max > 0)) || (min !== undefined && max !== undefined && min > max)) throw new KernelError(t('analysis.badLimits'));
    const began = performance.now();
    const topology = this.topology(id);
    const copy = this.clone(id);
    try {
      const size = this.bounds(id);
      const tolerance = options.tolerance ?? Math.min(1, Math.max(0.002, Math.hypot(size.max[0] - size.min[0], size.max[1] - size.min[1], size.max[2] - size.min[2]) * 2e-3));
      const mesh = this.mesh(copy, { tolerance, angular: options.angular ?? 0.1 });
      const bvh = buildBvh(mesh.positions, mesh.indices);
      const into = 1e-4;
      const acc = topology.faces.map(() => ({ area: 0, thin: 0, thick: 0, open: 0, hit: 0, rows: [] as [number, number][], samples: 0 }));
      let thinnest: ThicknessSpot | null = null;
      let thickest: ThicknessSpot | null = null;
      const samples = forEachSample(mesh, { maxSamples: options.maxSamples ?? 60000 }, (face, triangle, point, nrm, w) => {
        const f = acc[face];
        if (!f) return;
        // the mesh's winding is outward: the ray goes the other way, into the material
        const dir: Vec3 = [-nrm[0], -nrm[1], -nrm[2]];
        const o: Vec3 = [point[0] + dir[0] * into, point[1] + dir[1] * into, point[2] + dir[2] * into];
        const found = nearestHitAt(bvh, o, dir, triangle);
        f.area += w;
        f.samples++;
        // the surface on the other side is one that faces this one (within 60 degrees of straight on); a ray that leaves through the face next to this one, near an edge, has
        // measured nothing of the wall
        let opposite = false;
        if (Number.isFinite(found.distance)) {
          const h = triangleNormal(bvh, found.triangle);
          opposite = h[0] * dir[0] + h[1] * dir[1] + h[2] * dir[2] > 0.5;
        }
        if (!opposite) {
          f.open += w;
          return;
        }
        const thickness = found.distance + into;
        f.hit += w;
        f.rows.push([thickness, w]);
        if (min !== undefined && thickness < min) f.thin += w;
        if (max !== undefined && thickness > max) f.thick += w;
        if (!thinnest || thickness < thinnest.thickness) thinnest = { thickness, point, face };
        if (!thickest || thickness > thickest.thickness) thickest = { thickness, point, face };
      });
      const faces: ThicknessFace[] = acc.map((f, i) => {
        const area = topology.faces[i]!.area;
        if (f.samples === 0 || !(f.area > 0)) return { face: i, kind: 'unknown', min: NaN, median: NaN, max: NaN, thinShare: NaN, thickShare: NaN, openShare: NaN, samples: 0, area };
        const [thin, thick, open] = [f.thin / f.area, f.thick / f.area, f.open / f.area];
        const kind: ThicknessClass = open >= 0.95 ? 'open' : thin > 0.05 ? 'thin' : thick > 0.5 ? 'thick' : 'ok';
        let least = NaN;
        let greatest = NaN;
        let median = NaN;
        if (f.rows.length > 0) {
          f.rows.sort((x, y) => x[0] - y[0]);
          least = f.rows[0]![0];
          greatest = f.rows[f.rows.length - 1]![0];
          let run = 0;
          for (const [value, w] of f.rows) {
            run += w;
            if (run >= f.hit / 2) {
              median = value;
              break;
            }
          }
        }
        return { face: i, kind, min: least, median, max: greatest, thinShare: thin, thickShare: thick, openShare: open, samples: f.samples, area };
      });
      const totals = {} as ThicknessReport['totals'];
      for (const k of ['thin', 'ok', 'thick', 'open', 'unknown'] as const) totals[k] = { faces: 0, area: 0 };
      for (const f of faces) {
        totals[f.kind].faces++;
        totals[f.kind].area += f.area;
      }
      return { least: min ?? null, greatest: max ?? null, faces, totals, thinnest, thickest, triangles: Math.floor(mesh.indices.length / 3), samples, ms: performance.now() - began };
    } finally {
      this.release(copy);
    }
  }

  // ------------------------------------------------------------------ exchange (F1, F2)

  /**
   * STEP AP214 through XCAF so the product carries the part name (F1.1). `Perform` is used instead of
   * `Transfer` + `Write`: the binding cannot pass a null "multi-file" prefix, and an empty string would
   * split geometry into external files.
   */
  exportStep(id: ShapeId, productName = 'Part', unit: 'MM' | 'INCH' = 'MM', options: StepExportOptions = {}): string {
    const oc = this.oc;
    const arena = new Arena();
    const path = `/export-${++this.fileSeq}.step`;
    const doc = new oc.TDocStd_Document(arena.own(new oc.TCollection_ExtendedString('XmlXCAF', false)));
    try {
      // The writer makes the library's STEP settings exist (before the first one is made, setting them does nothing), so it comes first.
      const w = arena.own(new oc.STEPCAFControl_Writer());
      oc.Interface_Static.SetCVal('write.step.unit', unit);
      // the schema is a setting of the library as a whole: it is put back below, so that the next export is not AP242 by accident
      oc.Interface_Static.SetCVal('write.step.schema', options.schema === 'AP242' ? 'AP242DIS' : 'AP214IS');
      // Attribute and tool wrappers are owned by the document; only the document itself is deleted.
      const shapeTool = oc.XCAFDoc_DocumentTool.ShapeTool(doc.Main());
      const label = shapeTool.AddShape(this.get(id), false, true);
      oc.TDataStd_Name.Set(label, arena.own(new oc.TCollection_ExtendedString(productName, true)));
      this.colorFaces(doc, label, id, options.faceColors ?? [], arena);
      w.SetNameMode(true);
      w.SetColorMode(true);
      let ok: boolean;
      try {
        ok = w.Perform(doc, path, arena.own(new oc.Message_ProgressRange()));
      } catch (e) {
        throw new KernelError(t('kernel.stepFailedWhy', { why: this.errorText(e) }));
      }
      if (!ok) throw new KernelError(t('kernel.stepFailed'));
      return escapeStepText(oc.FS.readFile(path, { encoding: 'utf8' }) as string);
    } finally {
      oc.Interface_Static.SetCVal('write.step.schema', 'AP214IS');
      doc.delete();
      try {
        oc.FS.unlink(path);
      } catch {
        // not written
      }
      arena.dispose();
    }
  }

  /** Gives faces their colors in a document about to be written (F1.3): `colors[i]` is "#rrggbb" for face i of the shape in the order of `topology`, or null. */
  private colorFaces(doc: InstanceType<OC['TDocStd_Document']>, root: Parameters<OC['TDataStd_Name']['Set']>[0], id: ShapeId, colors: readonly (string | null)[], arena: Arena): void {
    if (!colors.some(Boolean)) return;
    const oc = this.oc;
    const shapeTool = oc.XCAFDoc_DocumentTool.ShapeTool(doc.Main());
    const colorTool = oc.XCAFDoc_DocumentTool.ColorTool(doc.Main());
    const faces = ShapeIndex.of(oc, this.get(id), T.FACE, arena);
    colors.forEach((hex, i) => {
      const face = faces.keys[i];
      if (!hex || !face) return;
      const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
      if (!m) throw new KernelError(t('kernel.badColor', { color: hex }));
      // the numbers of a hex colour are sRGB, as STEP files write them (the other type would take them for linear light and brighten them)
      const rgb = m.slice(1).map((h) => parseInt(h, 16) / 255) as [number, number, number];
      const color = arena.own(new oc.Quantity_Color(rgb[0], rgb[1], rgb[2], oc.Quantity_TypeOfColor.Quantity_TOC_sRGB));
      const sub = shapeTool.AddSubShape(root, face);
      colorTool.SetColor(sub, color, oc.XCAFDoc_ColorType.XCAFDoc_ColorSurf);
    });
  }

  /**
   * STEP AP214 of an assembly (F1.2): one product per part (`parts`, the shape and its name), one
   * component per instance placing a part by its pose (`instances`: an index of `parts`, the
   * instance's name, position and unit quaternion x y z w); millimetres unless `unit` says.
   * A pose maps part coordinates to assembly coordinates, the same way `Component.placement` does.
   *
   * Sub-assemblies (C15.4): `subs` are assemblies of their own, each written once as a product and used by as many
   * components as refer to it (an instance with `sub` instead of `part`). A sub-assembly may use the ones before it in the list.
   */
  exportAssemblyStep(
    name: string,
    parts: readonly { shape: ShapeId; name: string; faceColors?: readonly (string | null)[] }[],
    instances: readonly StepComponent[],
    unit: 'MM' | 'INCH' = 'MM',
    subs: readonly { name: string; instances: readonly StepComponent[] }[] = [],
  ): string {
    if (instances.length === 0) throw new KernelError(t('kernel.noComponents'));
    const oc = this.oc;
    const arena = new Arena();
    const path = `/export-${++this.fileSeq}.step`;
    const doc = new oc.TDocStd_Document(arena.own(new oc.TCollection_ExtendedString('XmlXCAF', false)));
    const label = (l: { delete(): void }, text: string) => oc.TDataStd_Name.Set(l as never, arena.own(new oc.TCollection_ExtendedString(text, true)));
    try {
      oc.Interface_Static.SetCVal('write.step.unit', unit);
      const tool = oc.XCAFDoc_DocumentTool.ShapeTool(doc.Main());
      const root = tool.NewShape();
      label(root, name);
      const prototypes = parts.map((p) => {
        const l = tool.AddShape(this.get(p.shape), false, true);
        label(l, p.name);
        this.colorFaces(doc, l, p.shape, p.faceColors ?? [], arena); // the colors of the part's faces (F1.3), the same in every use of the product
        return l;
      });
      // `parent`: the label the component goes into; `before`: how many sub-assemblies it may use (all of them for the top level)
      const place = (parent: typeof root, inst: StepComponent, subLabels: (typeof root)[], before: number) => {
        const proto = inst.sub !== undefined ? (inst.sub >= 0 && inst.sub < before ? subLabels[inst.sub] : undefined) : prototypes[inst.part ?? -1];
        if (!proto) throw new KernelError(t('kernel.noPartForComponent', { name: inst.name }));
        // OCCT turns a quaternion that is not a unit one into a skewed matrix without a word.
        if (![...inst.position, ...inst.rotation].every(Number.isFinite) || Math.abs(Math.hypot(...inst.rotation) - 1) > 1e-9) {
          throw new KernelError(t('kernel.badPose', { name: inst.name }));
        }
        // SetRotation and SetTranslationPart each have one gp_Trsf overload; SetTransformation(q, v) shares its arity with another.
        const trsf = arena.own(new oc.gp_Trsf());
        const [qx, qy, qz, qw] = inst.rotation;
        trsf.SetRotation(arena.own(new oc.gp_Quaternion(qx, qy, qz, qw)));
        trsf.SetTranslationPart(arena.own(new oc.gp_Vec(inst.position[0], inst.position[1], inst.position[2])));
        const component = tool.AddComponent(parent, proto, arena.own(new oc.TopLoc_Location(trsf)));
        label(component, inst.name);
      };
      const subLabels: (typeof root)[] = [];
      subs.forEach((sub, i) => {
        const l = tool.NewShape();
        label(l, sub.name);
        subLabels.push(l);
        for (const inst of sub.instances) place(l, inst, subLabels, i);
      });
      for (const inst of instances) place(root, inst, subLabels, subLabels.length);
      tool.UpdateAssemblies();
      const w = arena.own(new oc.STEPCAFControl_Writer());
      w.SetNameMode(true);
      w.SetColorMode(true);
      let ok: boolean;
      try {
        ok = w.Perform(doc, path, arena.own(new oc.Message_ProgressRange()));
      } catch (e) {
        throw new KernelError(t('kernel.stepFailedWhy', { why: this.errorText(e) }));
      }
      if (!ok) throw new KernelError(t('kernel.stepFailed'));
      return escapeStepText(oc.FS.readFile(path, { encoding: 'utf8' }) as string);
    } finally {
      doc.delete();
      try {
        oc.FS.unlink(path);
      } catch {
        // not written
      }
      arena.dispose();
    }
  }

  /**
   * The structure of an assembly STEP (F2.8) through XCAF: every product once (a part with its shape and the colors of its faces, an
   * assembly with its components), each component with its name and its rigid motion in the assembly it is in. A file whose top is a
   * part has one product. A motion that is not rigid (a mirror, a scale) is refused: it cannot be a component's pose.
   * The shapes of the parts are the caller's to release.
   */
  readAssemblyStep(data: Uint8Array | string): StepAssemblyContents {
    const oc = this.oc;
    const arena = new Arena();
    const path = `/read-assembly-${++this.fileSeq}.step`;
    const doc = new oc.TDocStd_Document(arena.own(new oc.TCollection_ExtendedString('MDTV-XCAF', false)));
    const made: ShapeId[] = [];
    try {
      oc.FS.writeFile(path, data);
      const reader = arena.own(new oc.STEPCAFControl_Reader());
      reader.SetNameMode(true);
      reader.SetColorMode(true);
      let status: string;
      try {
        status = String(reader.ReadFile(path));
        if (status !== 'IFSelect_RetDone') throw new KernelError(t('stepasm.unreadable'));
        if (!reader.Transfer(doc, arena.own(new oc.Message_ProgressRange()))) throw new KernelError(t('stepasm.unreadable'));
      } catch (e) {
        if (e instanceof KernelError) throw e;
        throw new KernelError(t('kernel.stepFailedWhy', { why: this.errorText(e) }));
      }
      const tool = oc.XCAFDoc_DocumentTool.ShapeTool(doc.Main());
      const colorTool = oc.XCAFDoc_DocumentTool.ColorTool(doc.Main());
      const nameOf = (label: InstanceType<typeof oc.TDF_Label>): string | null => {
        const found = label.FindAttribute(oc.TDataStd_Name.GetID());
        if (!found.returnValue) return null;
        const attribute = found.anAttribute as unknown as { Get(): never };
        return new oc.TCollection_AsciiString(attribute.Get(), '\0').ToCString() || null;
      };
      /** "#rrggbb" of a color XCAF gives in linear light: the file's numbers are sRGB. */
      const hexOf = (c: InstanceType<typeof oc.Quantity_Color>): string => {
        const srgb = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
        return '#' + [c.Red(), c.Green(), c.Blue()].map((v) => Math.round(Math.min(1, Math.max(0, srgb(v))) * 255).toString(16).padStart(2, '0')).join('');
      };
      const colorOf = (shape: TopoDS_Shape): string | null => {
        for (const type of [oc.XCAFDoc_ColorType.XCAFDoc_ColorSurf, oc.XCAFDoc_ColorType.XCAFDoc_ColorGen]) {
          const c = arena.own(new oc.Quantity_Color());
          if (colorTool.GetColor(shape, type, c)) return hexOf(c);
        }
        return null;
      };

      const labels: InstanceType<typeof oc.TDF_Label>[] = [];
      const prototypes: StepAssemblyPrototype[] = [];
      const protoOf = (label: InstanceType<typeof oc.TDF_Label>): number => {
        const known = labels.findIndex((l) => l.IsEqual(label));
        if (known >= 0) return known;
        const index = labels.length;
        labels.push(label);
        const proto: StepAssemblyPrototype = { name: nameOf(label) };
        prototypes.push(proto); // before its components: a loop in a broken file ends at a product already known
        if (oc.XCAFDoc_ShapeTool.IsAssembly(label)) {
          const components = new oc.NCollection_Sequence_TDF_Label();
          oc.XCAFDoc_ShapeTool.GetComponents(label, components, false);
          proto.children = [];
          for (let i = 1; i <= components.Length(); i++) {
            const component = components.Value(i);
            const referred = new oc.TDF_Label();
            oc.XCAFDoc_ShapeTool.GetReferredShape(component, referred);
            const trsf = oc.XCAFDoc_ShapeTool.GetLocation(component).Transformation();
            const nodeName = nameOf(component) ?? nameOf(referred) ?? '';
            if (trsf.IsNegative() || Math.abs(trsf.ScaleFactor() - 1) > 1e-9) throw new KernelError(t('stepasm.notRigid', { name: nodeName }));
            const rotation: number[] = [];
            for (let r = 1; r <= 3; r++) for (let c = 1; c <= 3; c++) rotation.push(trsf.Value(r, c));
            const tr = trsf.TranslationPart();
            proto.children.push({ name: nameOf(component), prototype: protoOf(referred), rotation, translation: [tr.X(), tr.Y(), tr.Z()] });
          }
        } else {
          const shape = oc.XCAFDoc_ShapeTool.GetShape(label);
          const id = this.put(shape);
          made.push(id);
          proto.shape = id;
          const faces = ShapeIndex.of(oc, shape, T.FACE, arena);
          const colors: (string | null)[] = faces.keys.map(() => null);
          const subs = new oc.NCollection_Sequence_TDF_Label();
          oc.XCAFDoc_ShapeTool.GetSubShapes(label, subs);
          for (let i = 1; i <= subs.Length(); i++) {
            const sub = oc.XCAFDoc_ShapeTool.GetShape(subs.Value(i));
            const hex = colorOf(sub);
            if (!hex) continue;
            // a colored face, or a shell or solid whose faces all take the color
            const inside = ShapeIndex.of(oc, sub, T.FACE, arena);
            for (const f of inside.keys) {
              const at = faces.indexOf(f);
              if (at >= 0) colors[at] = hex;
            }
            inside.dispose();
          }
          faces.dispose();
          if (colors.some(Boolean)) proto.faceColors = colors;
          const whole = colorOf(shape);
          if (whole) proto.color = whole;
        }
        return index;
      };

      const roots = new oc.NCollection_Sequence_TDF_Label();
      tool.GetFreeShapes(roots);
      if (roots.Length() === 0) throw new KernelError(t('stepasm.noShapes'));
      let root: number;
      if (roots.Length() === 1) root = protoOf(roots.Value(1));
      else {
        // several free shapes: they are the components of an assembly the file does not name
        const children = Array.from({ length: roots.Length() }, (_, i) => ({ name: nameOf(roots.Value(i + 1)), prototype: protoOf(roots.Value(i + 1)), rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: [0, 0, 0] as Vec3 }));
        prototypes.push({ name: null, children });
        root = prototypes.length - 1;
      }
      made.length = 0; // handed over
      return { prototypes, root };
    } catch (e) {
      for (const id of made) this.release(id);
      throw e;
    } finally {
      doc.delete();
      try {
        oc.FS.unlink(path);
      } catch {
        // not written
      }
      arena.dispose();
    }
  }

  /**
   * STEP import (F2.1, F2.2): the file's solids, in millimetres whatever unit the file uses. A shape that
   * fails the validity check is healed by ShapeFix; a valid one is left exactly as read, since ShapeFix
   * always touches something. A file with surfaces and no solid has them sewn together (within
   * `options.sewTolerance`) and closed into solids, or is refused with how many edges stayed open.
   * Faces keep their order in the shape, which is what imported faces are named by; faces that belong to
   * no solid, next to solids, are left out. `diagnostics` says what was found and done, in numbers.
   */
  importStep(data: Uint8Array | string, options: ImportOptions = {}): ImportResult {
    const oc = this.oc;
    const arena = new Arena();
    const path = `/import-${++this.fileSeq}.step`;
    try {
      oc.FS.writeFile(path, data);
      const r = arena.own(new oc.STEPControl_Reader());
      let status;
      try {
        status = r.ReadFile(path);
      } catch (e) {
        throw new KernelError(t('import.cannotRead', { reason: this.errorText(e) }));
      }
      if (status !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) throw new KernelError(t('import.notStep'));
      r.TransferRoots(arena.own(new oc.Message_ProgressRange()));
      if (r.NbShapes() === 0) throw new KernelError(t('import.noShapes'));
      return this.repairImport(arena.own(r.OneShape()), options);
    } finally {
      try {
        oc.FS.unlink(path);
      } catch {
        // not written
      }
      arena.dispose();
    }
  }

  /**
   * What `importStep` does with a shape once it is read: check it, heal it if it fails, sew surfaces into solids if
   * it has none, count what it found (F2.2). Public so that defects a STEP reader would already have mended can be
   * made in memory and tested; the shape passed in stays the caller's.
   */
  repairImport(read: TopoDS_Shape, options: ImportOptions = {}): ImportResult {
    const oc = this.oc;
    const arena = new Arena();
    const warnings: string[] = [];
    try {
      const count = (s: TopoDS_Shape, type: string) => {
        const index = ShapeIndex.of(oc, s, type, arena);
        const n = index.size;
        index.dispose();
        return n;
      };
      const diagnostics: ImportDiagnostics = {
        solids: count(read, 'TopAbs_SOLID'),
        faces: count(read, T.FACE),
        looseFaces: 0,
        validBefore: this.valid(read),
        healed: false,
        sewn: false,
        sewTolerance: null,
        freeEdges: null,
        validAfter: true,
      };
      let current = read;
      if (!diagnostics.validBefore) {
        const fix = arena.own(new oc.ShapeFix_Shape(read));
        fix.Perform(arena.own(new oc.Message_ProgressRange()));
        current = arena.own(fix.Shape());
        diagnostics.healed = true;
        warnings.push(t('import.healed'));
      }

      let result: TopoDS_Shape;
      if (count(current, 'TopAbs_SOLID') === 0) {
        result = this.sewIntoSolids(current, options.sewTolerance ?? DEFAULT_SEW_TOLERANCE, diagnostics, warnings, arena);
      } else {
        const solids = ShapeIndex.of(oc, current, 'TopAbs_SOLID', arena);
        try {
          if (solids.size === 1) result = solids.keys[0]!.Oriented(solids.keys[0]!.Orientation());
          else result = this.compound(solids.keys, arena);
        } finally {
          solids.dispose();
        }
        diagnostics.looseFaces = count(current, T.FACE) - count(result, T.FACE);
        if (diagnostics.looseFaces > 0) warnings.push(t('import.looseFaces', { n: diagnostics.looseFaces }));
      }
      const id = this.put(result);
      diagnostics.validAfter = this.isValid(id);
      if (!diagnostics.validAfter) warnings.push(t('import.stillInvalid'));
      const faces = count(result, T.FACE);
      return { shape: id, faceOrigins: Array.from({ length: faces }, (_, index) => [{ rel: 'imported', index }]), warnings, diagnostics };
    } finally {
      arena.dispose();
    }
  }

  /** One shape holding all of `shapes` (a compound is only made when there are several). */
  private compound(shapes: TopoDS_Shape[], arena: Arena): TopoDS_Shape {
    const compound = arena.own(new this.oc.TopoDS_Compound());
    const builder = arena.own(new this.oc.BRep_Builder());
    builder.MakeCompound(compound);
    for (const s of shapes) builder.Add(compound, s);
    return compound.Oriented(compound.Orientation());
  }

  /**
   * Sews every face of a shape that has no solid into shells and closes each into a solid (F2.2). If
   * some edge stays with one face the surfaces do not enclose anything: that is reported, with the
   * count, instead of guessing a solid out of an open shell.
   */
  private sewIntoSolids(shape: TopoDS_Shape, tolerance: number, diagnostics: ImportDiagnostics, warnings: string[], arena: Arena): TopoDS_Shape {
    const oc = this.oc;
    const faces = ShapeIndex.of(oc, shape, T.FACE, arena);
    try {
      if (faces.size === 0) throw new KernelError(t('import.noSolid'));
      const sewing = arena.own(new oc.BRepBuilderAPI_Sewing(tolerance, true, true, true, false));
      for (const f of faces.keys) sewing.Add(f);
      sewing.Perform(arena.own(new oc.Message_ProgressRange()));
      diagnostics.sewn = true;
      diagnostics.sewTolerance = tolerance;
      diagnostics.freeEdges = sewing.NbFreeEdges();
      if (diagnostics.freeEdges > 0) throw new KernelError(t('import.openSurfaces', { n: diagnostics.freeEdges, tolerance }));
      const sewn = arena.own(sewing.SewedShape());
      const shells = ShapeIndex.of(oc, sewn, 'TopAbs_SHELL', arena);
      try {
        const fix = arena.own(new oc.ShapeFix_Solid());
        const solids = shells.keys.map((s) => arena.own(fix.SolidFromShell(arena.own(oc.TopoDS.Shell(s)))));
        if (solids.length === 0) throw new KernelError(t('import.noSolid'));
        warnings.push(t('import.sewn', { faces: faces.size, solids: solids.length, tolerance }));
        return solids.length === 1 ? solids[0]!.Oriented(solids[0]!.Orientation()) : this.compound(solids, arena);
      } finally {
        shells.dispose();
      }
    } finally {
      faces.dispose();
    }
  }
}
/** Sewing tolerance when a file has surfaces and no solid, in mm: more than the gaps files leave between faces, less than any feature. */
const DEFAULT_SEW_TOLERANCE = 0.01;

const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale3 = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
