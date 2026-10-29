import { flatFlangeBend } from './flatPattern';
import { sheetConjugate, sheetMoveCurves, sheetMapFlat, unfoldSheetPieces, type SheetUnfoldSession, SHEET_IDENTITY, sheetHost, sheetCompose, sheetInverse, sheetPoint, sheetVector, sheetRows, sheetPlanar, sheetSplitPanels, sheetClipPanels, type SheetMapping, type SheetRigid } from './sheetMapping';
import { toothedProfile } from './gears';
import { gearParameters, type SpurGearFeature, type RackFeature } from '@3db/model';
import { t } from '@3db/i18n';
import { silhouetteProjector } from './silhouette';
import {
  DATUM_PLANES,
  evalAngle,
  evalLength,
  evalNumber,
  isDatumPlaneName,
  patternInstances,
  planeFrame,
  resolveDoc,
  systemFrame,
  bodyFeature,
  type Axis3,
  type ChamferFeature,
  type CoordSysFeature,
  type CoordSystem,
  type CombineFeature,
  type MoveCopyBodyFeature,
  type DeleteKeepBodyFeature,
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
  type DerivedBodyFeature,
  DOWEL_RANGE,
  type LoftFeature,
  type MirrorFeature,
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
  type ReliefShape,
  type OffsetSurfaceFeature,
  type SplitLineFeature,
  type KnitFeature,
  type MutualTrimFeature,
  type MidBendFeature,
  type JogFeature,
  type FillSurfaceFeature,
  type FlatSurfaceFeature,
  type TrimSurfaceFeature,
  type ExtendSurfaceFeature,
  type ThickenFeature,
  type LipGrooveFeature,
  type ScrewBossFeature,
  type BaseFlangeFeature,
  type EdgeFlangeFeature,
  type BreakCornerFeature,
  type HemFeature,
  type SnapHookFeature,
  type SnapCatchFeature,
  type VentFeature,
  type CutWithSurfaceFeature,
  type ShellFeature,
  type SplitFeature,
  type SketchAttach,
  type SketchFeature,
  type SweepFeature,
  type Thin,
  type Vec3,
  type ThreadFeature,
  type KnurlFeature,
  type CosmeticThreadFeature,
  type HelixFeature,
  type ProjectedCurveFeature,
  type RuledSurfaceFeature,
  type RadiatedSurfaceFeature,
  type ReplaceFaceFeature,
  lookupThread,
  validThreadTolerance,
  generateStandardThreadProfile,
  sketchAxisDir,
  modelRefOf,
} from '@3db/model';
import { bentPath, BendProblem, findOutlines, findProfiles, reversePath, ribbonOf, selectContours, ThinProblem, thinRegions, type ProfileResult, type SketchSolver, type SketchStatus, type SolvedSketch } from '@3db/sketch';
import { KernelError, SURFACE_TOLERANCE, type KnurlSpec, type Region, type Segment, type SweepSpec, type ThreadSpec, type FaceOrigin, type ImportDiagnostics, type Kernel, type OpResult, type ShapeId, type Topology } from '@3db/kernel';
import { nameElements, nameFromFaces, resolveRef, type Candidate, type ElementNames } from '@3db/naming';
import { Bodies, type BodyState, type BodyView } from './bodies';
import { followReferences, NO_NAMES, NO_TOPOLOGY, ReferenceProblem, type DatumScope } from './references';
import { notchOf, obroundFits, obroundRegion, type Notch } from './relief';
import { angleStep, curveMotion, mirror, slide, turn, type Motion } from './placements';

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
  /** What the feature measured of its own result and says to the user (an offset surface: the gap it found, 4b-3). */
  info?: string;
  ms: number;
}

/** One body of the result (C7.1): where its elements are in the numbering of RebuildResult.body, and what the document says of it. */
export interface BodyInfo {
  id: Id;
  /** The name the document gave it, else the name of the feature that made it (伸長1, 除料1#2). */
  name: string;
  reference: boolean;
  /** A surface body (4b): no solid, not a part (see `BodyState.surface`). */
  surface: boolean;
  /** A curve body (C8.3 helix): edges and no faces. */
  curve?: boolean;
  shape: ShapeId;
  face0: number;
  faces: number;
  edge0: number;
  edges: number;
  vertex0: number;
  vertices: number;
}

/** One bend of a sheet metal part (C11.1): what is recorded when it is made, and from which the flat pattern is worked out (ADR 0083, 0084). */
export interface SheetBend {
  feature: Id;
  /** The name of the bend in its sketch (`bend1`, …). */
  name: string;
  /** How far the sheet turns (radians). */
  angle: number;
  /** The inner radius of the bend. */
  radius: number;
  thickness: number;
  /** How wide the bend is along its axis. */
  width: number;
  kFactor: number;
  /** The bend allowance: the length the bend takes up in the flat pattern, angle · (radius + K · thickness). */
  allowance: number;
}

/** Where an edge flange or a hem was made, in the folded sheet, as the flat pattern needs it to put it back (ADR 0088). */
export interface FoldGeometry {
  /** The middle of the edge, and where the bend starts (the edge cut back by the trim). */
  mid: Vec3;
  origin: Vec3;
  /** The centre and the axis of the bend (the axis turns the sheet the way it was bent). */
  center: Vec3;
  axis: Vec3;
  /** Along the edge, the way the flange goes out from the sheet, and the way the bend bends. */
  e: Vec3;
  o: Vec3;
  m: Vec3;
  /** The strip along the edge (from `xa` to `xb`) and across the thickness along `m` (from `ylo` to `yhi`). */
  xa: number;
  xb: number;
  ylo: number;
  yhi: number;
  trim: number;
  /** The notches of the relief: along the edge from `x0` to `x1`, `deep` in from the edge. */
  notches: Notch[];
  /** The flat piece after the bend, along the edge: from `pa` to `pb` (the bend's own range, widened at an end where the corner is closed). */
  pa: number;
  pb: number;
  /** Where the flat piece after the bend starts, the way it goes and its thickness direction (to find the piece an edge picked later is on). */
  origin2: Vec3;
  d: Vec3;
  m2: Vec3;
}

/** How the base of a sheet metal part was made, for the flat pattern: a plate (the regions of a profile) or a bent sheet (the straight pieces and bends in the order of the path). */
export type SheetBase =
  | { kind: 'plate'; frame: PlaneFrame; regions: Region[]; dir: Vec3 }
  | {
      kind: 'bent';
      frame: PlaneFrame;
      width: number;
      flatLength: number;
      pieces: ({ type: 'straight'; length: number } | { type: 'bend'; bend: number; toward: boolean })[];
      /** Which side of the path the sheet is thick to, the way the sheet is wide (a unit vector), and each straight piece of the path (in the coordinates of the frame) with where it starts in the flat strip: for the flanges grown on it. */
      side: 'left' | 'right';
      dir: Vec3;
      straights: { a: [number, number]; b: [number, number]; at: number }[];
    };

/** The mid bend of a plate (S-3): where its line is (the ends of the zone, in the plane of the plate) and which way it folds, for the flat pattern. */
export interface SheetMidBend {
  feature: Id;
  a: Vec3;
  b: Vec3;
  up: Vec3;
  angle: number;
  radius: number;
  allowance: number;
  /** A point of the line (on the plate's lower face), the direction from the side that stays to the side that turns, the axis of the bend and the slide of the side that turns, to put a cut made after the bend back. */
  q: Vec3;
  side: Vec3;
  center: Vec3;
  axis: Vec3;
  slide: Vec3;
}

/** The material a feature made after the sheet took away (the volume of the sheet before it less the volume after it), in the folded part, for the flat pattern to put back (ADR 0113). The shape belongs to the rebuild. */
export interface SheetCut {
  feature: Id;
  shape: ShapeId;
}

/** One end of a flange that is mitred against its neighbour (斜接): the plane between them is `s` (half the gap, across the corner) off the halving plane, and the neighbour's outer face is at `xOuter` along the edge. */
export interface SheetMiter {
  s: number;
  xOuter: number;
}

/** One edge flange (C11.2) as the flat pattern needs it: the edge it grew from, and how much it took from the sheet and added to the flat pattern. */
export interface SheetFlange {
  feature: Id;
  /** The name of the edge it was made on. */
  edge: string;
  width: number;
  angle: number;
  radius: number;
  /** How much of the sheet was cut back at the edge (0 for `bendOutside`). */
  trim: number;
  /** The flat piece after the bend. */
  straight: number;
  /** The bend allowance. */
  allowance: number;
  /** How far it stops short of the ends of the edge (the start, the end), and the relief notches beside it ({width, depth} or null). */
  inset: [number, number];
  relief: { width: number; depth: number; shape: ReliefShape } | null;
  /** How far the flat piece goes on past the end of the bend at the start and at the end, to close the corner (0 where it does not). */
  corner: [number, number];
  /** The mitre at the start and at the end (null where there is none): see `SheetMiter`. */
  miter: [SheetMiter | null, SheetMiter | null];
  /** The flange (index in `SheetInfo.flanges`) whose flat piece the edge is on, or -1 for the base. */
  parent: number;
  /** Of a flange on the base: the straight piece of a bent base it is on (-1 for a plate). */
  host: number;
  fold: FoldGeometry;
}

/** What the sheet metal features of a part have recorded (null for a part that is not sheet metal). */
export interface SheetInfo {
  mapping?: SheetMapping;
  unfolding?: SheetUnfoldSession;
  thickness: number;
  radius: number;
  kFactor: number;
  bends: SheetBend[];
  flanges: SheetFlange[];
  /** Mid bends in feature order; manufacturing coordinates are tracked by the panel mapping. */
  midBends: SheetMidBend[];
  /** What the features after the sheet's own took away (holes, notches), in the order they were made. */
  cuts: SheetCut[];
  base: SheetBase | null;
  /** The length of the flat pattern of a bent base flange along its profile (the straight pieces and the allowances); null for a plate. */
  flatLength: number | null;
}

export interface RebuildResult {
  features: FeatureResult[];
  /** All the bodies seen as one: the body itself when there is one (bodies), a view of them all (a compound) when there are several. */
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
  /** The sheet metal data of the part (C11), recorded by its features as they were made. */
  sheet: SheetInfo | null;
  /** Cosmetic threads (C4.9, ADR 0156). Lightweight annotations, 0.00 MiB WASM Heap overhead. */
  cosmeticThreads: CosmeticThreadInfo[];
  totalMs: number;
}

export interface CosmeticThreadInfo {
  featureId: Id;
  targetFace: Ref;
  startEdge?: Ref;
  threadType: 'external' | 'internal';
  standardMode: 'standard' | 'custom';
  standardDesignation?: string;
  toleranceClass?: string;
  majorDiameter: number;
  minorDiameter: number;
  pitch: number;
  depth: number;
  endCondition: 'blind' | 'through';
  /** Cylinder axis origin (start point of thread). */
  origin: Vec3;
  /** Cylinder axis unit direction (along thread direction). */
  axis: Vec3;
  /** Cylinder radius (from actual target face geometry). */
  radius: number;
  /** Full length of the cylinder face. */
  cylinderLength: number;
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

/**
 * A part file another part is derived from (C7.5): its document and data, a `key` that names it (its project path, for finding a cycle) and, for the
 * files it is itself derived from, where to find them (paths in it are relative to it, so each file brings its own provider).
 */
export interface SourcePart {
  key: string;
  doc: PartDoc;
  blobs: BlobSource;
  sources?: SourceProvider;
}

/** Finds the part file at `path` (relative to the file that asks); undefined when there is none. */
export interface SourceProvider {
  get(path: string): SourcePart | undefined;
}

/** A master model rebuilt for a derived body: kept while the master document is the same object, so one master serves every body taken from it. */
interface Master {
  doc: PartDoc;
  regen: Regenerator;
  result: RebuildResult;
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

/**
 * The most grooves a hand of a diamond knurl may have (ADR 0124). A diamond is two cuts and its cost grows about as the square of the groove count — the
 * second hand's flanks intersect every groove of the first — so a dozen a hand is seconds and forty is minutes. This is the point past which the
 * rebuild is refused with the reason rather than left to run for hours.
 */
const KNURL_MAX_DIAMOND_GROOVES = 40;

const add = (a: Vec3, b: Vec3, s = 1): Vec3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];

/**
 * The names of a helix curve's elements (C8.3), one per edge and vertex in the order of `topology`: the wire has an edge per turn (and one for a part turn),
 * so turn k's edge is `<id>:helix:<k>`, the ends `<id>:start` and `<id>:end` and the vertices between turns `<id>:turn:<k>`. Which turn an element is on is
 * worked out from how far up the axis it is (`rise` per turn), not from the order the kernel lists them in; a spiral (`rise` 0) is a single edge.
 */
function helixNames(id: Id, topology: Topology, at: { start: Vec3; end: Vec3; origin: Vec3; axis: Vec3; rise: number }): ElementNames {
  const near = (p: Vec3, q: Vec3) => Math.hypot(...sub(p, q)) < 1e-6 * (1 + Math.hypot(...sub(at.end, at.start)));
  const turn = (p: Vec3) => (at.rise > 0 ? dot(sub(p, at.origin), at.axis) / at.rise : 0);
  const edges = topology.edges.map((e) => `${id}:helix:${Math.floor(turn(e.mid) + 1e-9)}`);
  const vertices = topology.vertices.map((v) => (near(v.point, at.start) ? `${id}:start` : near(v.point, at.end) ? `${id}:end` : `${id}:turn:${Math.round(turn(v.point))}`));
  // two elements of one name would make a reference to either pick the wrong one
  if (new Set(edges).size !== edges.length || new Set(vertices).size !== vertices.length) throw new Error(`helix ${id}: element names are not unique`);
  return { faces: [], edges, vertices };
}
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

/** The features that make the sheet itself: what they add and take away is in the data they record, not in `sheet.cuts`. */
const SHEET_FEATURES = new Set<string>(['baseFlange', 'edgeFlange', 'hem', 'midBend', 'jog', 'sheetUnfold', 'sheetRefold']);

const concatNames = (a: ElementNames, b: ElementNames): ElementNames => ({
  faces: [...a.faces, ...b.faces],
  edges: [...a.edges, ...b.edges],
  vertices: [...a.vertices, ...b.vertices],
});

/** How far (radians) a tangent fill may be from the tangent of the face beside it: about 1°. A patch that cannot meet the face tangent is refused, not passed off as tangent. */
const FILL_TANGENT_TOLERANCE = 0.02;

/**
 * Deterministic rebuild (B3.1): the result is a pure function of the document.
 * A failing feature is skipped and reported; later features keep evaluating (B3.3).
 */
/** The message for references that are not found among edges and faces: it says which of the two. */
const lostRefs = (n: number, unresolved: Unresolved[]): string =>
  unresolved.every((u) => u.ref.kind === 'face') ? t('edit.facesLost', { n }) : unresolved.every((u) => u.ref.kind === 'edge') ? t('edit.edgesLost', { n }) : t('edit.refsLost', { n });

/** A line of a solved sketch, or one of the sketch's axes (ADR 0170): the line a revolve or a thread turns about. */
function sketchLine(geometry: SolvedSketch['geometry'], id: Id): { a: [number, number]; b: [number, number] } | undefined {
  const dir = sketchAxisDir(id);
  if (dir) return { a: [0, 0], b: dir };
  const g = geometry.get(id);
  return g?.type === 'line' ? g : undefined;
}

export class Regenerator {
  private owned: ShapeId[] = [];
  /** Warnings of the feature being evaluated. */
  private warnings: string[] = [];
  /** What reading the file of the imported body being evaluated turned up (F2.2). */
  private diagnostics: ImportDiagnostics | null = null;
  /** What the feature being evaluated says of its result (`FeatureResult.info`). */
  private info: string | null = null;
  /** The sheet metal data recorded so far in this rebuild (C11). */
  private sheet: SheetInfo | null = null;
  /** The feature being built (what `advance` is for): the sheet's cuts are what the features after its own take away. */
  private current: Feature | null = null;
  /** Reference planes built so far in this rebuild (C3.2). */
  private planes = new Map<Id, PlaneFrame>();
  /** Reference axes, points and coordinate systems built so far in this rebuild (C3.3–C3.5). */
  private axes = new Map<Id, Axis3>();
  private points = new Map<Id, Vec3>();
  private systems = new Map<Id, CoordSystem>();
  /** The helix curve features of the document being rebuilt (C8.3): a sweep's path may name one instead of a sketch (ADR 0169). */
  private helixIds = new Set<Id>();
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
  /** The masters of derived bodies, by file key (C7.5), and which of them this rebuild used. */
  private masters = new Map<string, Master>();
  private mastersUsed = new Set<string>();
  /** What a derived body takes from its master and the document does not say: its name and whether it is a reference body. */
  private inherited = new Map<Id, { name: string; reference: boolean }>();
  private cosmeticThreads: CosmeticThreadInfo[] = [];

  constructor(
    private readonly kernel: Kernel,
    private readonly solver: SketchSolver,
    private readonly blobs: BlobSource = new Map(),
    /** Where the files that derived bodies come from are found (C7.5). */
    private sources?: SourceProvider,
    /** The keys of the files this one is a master's master of, up from the top: a file that comes round again is a cycle. */
    private readonly trail: readonly string[] = [],
  ) {}

  /** Where the files that derived bodies come from are found, for the rebuilds that follow (C7.5). */
  useSources(sources: SourceProvider | undefined): void {
    this.sources = sources;
  }

  /** Releases every shape the regenerator holds; call before discarding it. */
  dispose(): void {
    this.releaseResult();
    for (const i of this.imports.values()) if ('shape' in i) this.kernel.release(i.shape);
    this.imports.clear();
    for (const m of this.masters.values()) m.regen.dispose();
    this.masters.clear();
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
    this.inherited = new Map();
    this.mastersUsed = new Set();
    this.cosmeticThreads = [];
    this.helixIds = new Set(doc.features.filter((f) => f.type === 'helix').map((f) => f.id));

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
    this.sheet = null;
    this.current = null;
    resolved.features.forEach((feature, index) => {
      const started = performance.now();
      this.warnings = [];
      this.diagnostics = null;
      this.info = null;
      const done = (r: Omit<FeatureResult, 'id' | 'ms'>) => {
        this.statuses.set(feature.id, r.status);
        return results.push({ id: feature.id, ms: performance.now() - started, ...r, ...(this.warnings.length > 0 ? { warnings: this.warnings } : {}), ...(this.diagnostics ? { diagnostics: this.diagnostics } : {}), ...(this.info ? { info: this.info } : {}) });
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
      this.current = feature;
      try {
        if (this.sheet?.unfolding && ['baseFlange','edgeFlange','hem','midBend','jog'].includes(feature.type)) throw new FeatureError(t('sheetState.foldFirst'));
        switch (feature.type) {
          case 'sheetUnfold':
          case 'sheetRefold': {
            const next = this.sheetState(feature, set);
            set = this.advance(set, next);
            return done({ status: 'ok' });
          }
          case 'sketch': {
            const s = this.sketch(feature, set, sketches);
            frames.set(feature.id, s.frame);
            const info = { status: s.solved.status, dof: s.solved.dof, conflicting: s.solved.conflicting, redundant: s.solved.redundant, problems: s.profiles.problems };
            if (s.solved.status === 'failed' || s.solved.status === 'over') {
              return done({ status: 'error', message: s.solved.status === 'over' ? t('regen.sketchOver') : (s.solved.message ?? t('regen.sketchUnsolved')), sketch: info });
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
            const system = this.coordSys(feature, set);
            this.systems.set(feature.id, system);
            frames.set(feature.id, systemFrame(system)); // a sketch can lie on a coordinate system (ADR 0127)
            return done({ status: 'ok' });
          }
          case 'derivedBody': {
            set = this.advance(set, this.derivedBody(feature, set));
            return done({ status: 'ok' });
          }
          case 'offsetSurface': {
            set = this.advance(set, this.offsetSurface(feature, set));
            return done({ status: 'ok' });
          }
          case 'splitLine': {
            set = this.advance(set, this.splitLine(feature, sketches, set));
            return done({ status: 'ok' });
          }
          case 'trimSurface': {
            set = this.advance(set, this.trimSurface(feature, sketches, set));
            return done({ status: 'ok' });
          }
          case 'knit': {
            set = this.advance(set, this.knit(feature, set));
            return done({ status: 'ok' });
          }
          case 'midBend': {
            set = this.advance(set, this.midBend(feature, sketches, set));
            return done({ status: 'ok' });
          }
          case 'jog': {
            set = this.advance(set, this.jog(feature, sketches, set));
            return done({ status: 'ok' });
          }
          case 'mutualTrim': {
            set = this.advance(set, this.mutualTrim(feature, set));
            return done({ status: 'ok' });
          }
          case 'fillSurface': {
            set = this.advance(set, this.fillSurface(feature, set));
            return done({ status: 'ok' });
          }
          case 'flatSurface': {
            set = this.advance(set, this.flatSurface(feature, set));
            return done({ status: 'ok' });
          }
          case 'extendSurface': {
            set = this.advance(set, this.extendSurface(feature, set));
            return done({ status: 'ok' });
          }
          case 'thicken': {
            set = this.advance(set, this.thicken(feature, set));
            return done({ status: 'ok' });
          }
          case 'lipGroove': {
            set = this.advance(set, this.lipGroove(feature, set));
            return done({ status: 'ok' });
          }
          case 'screwBoss': {
            set = this.advance(set, this.screwBoss(feature, sketches, set));
            return done({ status: 'ok' });
          }
          case 'baseFlange': {
            set = this.advance(set, this.baseFlange(feature, sketches, set));
            return done({ status: 'ok' });
          }
          case 'edgeFlange': {
            set = this.advance(set, this.edgeFlange(feature, set));
            return done({ status: 'ok' });
          }
          case 'breakCorner': {
            set = this.advance(set, this.breakCorner(feature, set));
            return done({ status: 'ok' });
          }
          case 'hem': {
            set = this.advance(set, this.hem(feature, set));
            return done({ status: 'ok' });
          }
          case 'snapHook': {
            set = this.advance(set, this.snapHook(feature, sketches, set));
            return done({ status: 'ok' });
          }
          case 'snapCatch': {
            set = this.advance(set, this.cutSlots(feature, sketches, set));
            return done({ status: 'ok' });
          }
          case 'vent': {
            set = this.advance(set, this.cutSlots(feature, sketches, set));
            return done({ status: 'ok' });
          }
          case 'gear':
          case 'rack': {set=this.advance(set,this.toothedSolid(feature,set));return done({status:'ok'});}
          case 'cosmeticThread': {
            this.cosmeticThread(feature, set);
            return done({ status: 'ok' });
          }
          case 'ruledSurface':
          case 'radiatedSurface':
          case 'replaceFace': {
            set=this.advance(set,this.surfaceTools(feature,set));return done({status:'ok'});
          }
          case 'projectedCurve': {
            set = this.advance(set, this.projectedCurve(feature, sketches, set));
            return done({ status: 'ok' });
          }
          case 'helix': {
            set = this.advance(set, this.helix(feature, sketches, set));
            return done({ status: 'ok' });
          }
          case 'cutWithSurface': {
            set = this.advance(set, this.cutWithSurface(feature, set));
            return done({ status: 'ok' });
          }
          case 'split': {
            set = this.advance(set, this.splitBodies(feature, set));
            return done({ status: 'ok' });
          }
          case 'moveCopyBody': {
            set = this.advance(set, this.moveCopyBody(feature, set));
            return done({ status: 'ok' });
          }
          case 'deleteKeepBody': {
            set = this.advance(set, this.deleteKeepBody(feature, set));
            return done({ status: 'ok' });
          }
          case 'extrude':
          case 'revolve':
          case 'sweep':
          case 'thread':
          case 'knurl':
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
          case 'mirror':
          case 'importedBody': {
            const next =
              feature.type === 'extrude'
                ? this.extrude(feature, sketches, set)
                : feature.type === 'revolve'
                  ? this.revolve(feature, sketches, set)
                  : feature.type === 'sweep'
                  ? this.sweep(feature, sketches, set)
                  : feature.type === 'thread'
                  ? this.thread(feature, sketches, set)
                  : feature.type === 'knurl'
                    ? this.knurl(feature, set)
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
                              ? this.pattern(feature, sketches, set)
                              : feature.type === 'mirror'
                                ? this.mirror(feature, set)
                                : this.importedBody(feature, doc, set);
            set = this.advance(set, next);
            for (const pattern of lastSeeds.get(feature.id) ?? []) this.captureDelta(pattern, set);
            return done({ status: 'ok' });
          }
        }
      } catch (e) {
        if (e instanceof FeatureError) return done({ status: 'error', message: e.message, ...(e.unresolved ? { unresolved: e.unresolved } : {}) });
        if (e instanceof KernelError) return done({ status: 'error', message: e.message });
        return done({ status: 'error', message: t('regen.internal', { why: e instanceof Error ? e.message : String(e) }) });
      }
    });

    this.releasePatterns();
    // masters no derived body used this time are let go
    for (const [key, m] of this.masters) {
      if (this.mastersUsed.has(key)) continue;
      m.regen.dispose();
      this.masters.delete(key);
    }

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
            name: doc.bodies[b.id]?.name ?? this.inherited.get(b.id)?.name ?? `${make?.name ?? bodyFeature(b.id)}${piece}`,
            reference: doc.bodies[b.id]?.reference ?? this.inherited.get(b.id)?.reference ?? false,
            surface: !!b.surface,
            ...(b.curve ? { curve: true } : {}),
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
    return { features: results, body: view, bodies, sketches, frames, axes: this.axes, points: this.points, systems: this.systems, sheet: this.sheet, cosmeticThreads: this.cosmeticThreads, totalMs: performance.now() - t0 };
  }

  /**
   * The bodies after a feature: the old ones that are not among the new are let go (a feature makes the shapes it keeps
   * and says which it did away with by leaving them out), and so is the old view of them all.
   */
  private advance(old: Bodies, next: BodyState[]): Bodies {
    if (this.sheet?.unfolding && this.current && !SHEET_FEATURES.has(this.current.type) && next.length === 1) {
      const current = this.kernel.copy(next[0]!.shape);
      this.owned.push(current);
      this.sheet.unfolding.current = current;
    }
    if (this.sheet && this.current && !SHEET_FEATURES.has(this.current.type)) this.recordCut(old, next);
    const kept = new Set(next.map((b) => b.shape));
    for (const b of old.list) if (!kept.has(b.shape)) this.kernel.release(b.shape);
    old.release();
    return new Bodies(next, this.kernel);
  }

  /**
   * The material a feature after the sheet's own took out of the sheet (a hole, a notch): the body before less the body after, kept in `sheet.cuts` for the flat pattern, which cannot
   * know it from the data the sheet features recorded. Only when the part is one solid before and after and the volume went down; whatever the feature did not take away is not kept.
   */
  private recordCut(old: Bodies, next: BodyState[]): void {
    const sheet = this.sheet;
    const feature = this.current;
    if (!sheet || !feature || sheet.unfolding) return;
    const before = old.list.filter((b) => !b.surface);
    const after = next.filter((b) => !b.surface);
    if (before.length !== 1 || after.length !== 1 || before[0]!.shape === after[0]!.shape) return;
    const k = this.kernel;
    const vBefore = k.massProps(before[0]!.shape).volume;
    const vAfter = k.massProps(after[0]!.shape).volume;
    if (!(vBefore - vAfter > (sheet.mapping ? 1e-9 : 1e-6 * vBefore + 1e-9))) return;
    try {
      const r = k.boolean('cut', before[0]!.shape, after[0]!.shape);
      if (k.massProps(r.shape).volume <= 1e-9) return void k.release(r.shape);
      this.owned.push(r.shape);
      sheet.cuts.push({ feature: feature.id, shape: r.shape });
      if (sheet.mapping) {
        const own = (shape: ShapeId) => { this.owned.push(shape); return shape; };
        const beforePanels = sheet.mapping.panels.reduce((a,p) => a + k.massProps(p.shape).volume, 0);
        const panels = sheetClipPanels(k, sheet.mapping.panels, after[0]!.shape, own);
        const removed = beforePanels - panels.reduce((a,p) => a + k.massProps(p.shape).volume, 0);
        if (Math.abs(removed - (vBefore - vAfter)) > 1e-3 * (vBefore - vAfter) + 1e-6) sheet.mapping.notIncluded.push({ feature: feature.id, why: 'bend' });
        sheet.mapping.panels = panels;
      }
    } catch {
      // the difference could not be made: the flat pattern will not have this cut, and does not say it does
    }
  }

  private resolve(ref: Ref, body: BodyState, what: string): number {
    // An empty reference is a selection box not filled in yet, not a lost reference.
    if (!ref.name) throw new FeatureError(t('body.pick', { what }));
    const r = resolveRef(ref, body.names, body.topology);
    if (!r.ok) throw new FeatureError(t('regen.lostWhat', { what }), [{ ref, reason: r.reason, candidates: r.candidates }]);
    this.noteFingerprint(r.via, what, body.names[ref.kind === 'edge' ? 'edges' : ref.kind === 'vertex' ? 'vertices' : 'faces'][r.index]!);
    return r.index;
  }
  /** A reference that only its geometry could pick out is a guess the user should confirm (never silent). */
  private noteFingerprint(via: string, what: string, found: string): void {
    const note = t('regen.fingerprintNote', { what, found });
    if (via === 'fingerprint' && !this.warnings.includes(note)) this.warnings.push(note);
  }

  // ------------------------------------------------------------------ sketches (C1.1)

  /**
   * A plane reference: a default plane, a reference plane or a coordinate system built earlier in this
   * rebuild, or a planar face of the model so far.
   */
  private planeOf(ref: Ref, set: Bodies, labels: { what: string; notPlanar: string }): PlaneFrame {
    if (ref.kind === 'datum') {
      if (isDatumPlaneName(ref.name)) return DATUM_PLANES[ref.name];
      const system = this.systems.get(ref.name);
      const plane = this.planes.get(ref.name) ?? (system ? systemFrame(system) : undefined);
      if (!plane) throw new FeatureError(t('regen.planeMissing', { what: labels.what }));
      return plane;
    }
    if (ref.kind !== 'face') throw new FeatureError(t('cmd.mustPickPlane'));
    const body = set.view;
    if (!body) throw new FeatureError(t('datum.noModel', { what: labels.what }));
    const face = body.topology.faces[this.resolve(ref, body, labels.what)]!;
    if (face.surface !== 'plane' || !face.normal) throw new FeatureError(labels.notPlanar);
    return planeFrame(face.center, face.normal);
  }

  /** The reference geometry built so far, which a sketch's entities may follow (ADR 0172): the history is rebuilt in order, so only what is before it. */
  private datumScope(set: Bodies): DatumScope {
    const labels = { what: t('regen.whatSketchPlane'), notPlanar: t('sketch.planeOnly') };
    return {
      axis: (name) => (/^axis:[xyz]$/.test(name) || this.axes.has(name) ? this.axisOfRef({ kind: 'datum', name }, set, labels.what) : undefined),
      point: (name) => this.points.get(name),
      plane: (name) => (isDatumPlaneName(name) || this.planes.has(name) || this.systems.has(name) ? this.planeOf({ kind: 'datum', name }, set, labels) : undefined),
    };
  }

  /** Where a sketch lies (C1.1): a default plane, a reference plane, or a planar face of the model before it; its axes as the plane gives them, or as it is attached (ADR 0181). */
  private frame(f: SketchFeature, set: Bodies): PlaneFrame {
    const plane = this.planeOf(f.plane, set, { what: t('regen.whatSketchPlane'), notPlanar: t('sketch.planeOnly') });
    return f.attach ? this.attachedFrame(plane, f.attach, set) : plane;
  }

  /**
   * The frame of a sketch attached to the model (ADR 0181): the same plane, the origin moved to where a vertex or point lies (along the normal, onto the
   * plane), x along a straight edge or axis projected onto the plane, optionally turned half a turn about the normal. A direction square to the plane has
   * no projection and is refused, never replaced by a default.
   */
  private attachedFrame(plane: PlaneFrame, a: SketchAttach, set: Bodies): PlaneFrame {
    const n = plane.normal;
    let origin = plane.origin;
    let xDir = plane.xDir;
    let yDir = plane.yDir;
    if (a.origin) {
      const p = this.pointOfRef(a.origin, set, t('sketch.attachOrigin'));
      origin = sub(p, scale(n, dot(sub(p, plane.origin), n)));
    }
    if (a.x) {
      const dir = this.axisOfRef(a.x, set, t('sketch.attachX')).dir;
      const flat = sub(dir, scale(n, dot(dir, n)));
      if (Math.hypot(...flat) < 1e-9 * Math.hypot(...dir)) throw new FeatureError(t('sketch.attachXSquare'));
      xDir = unit(flat);
      yDir = cross(n, xDir);
    }
    if (a.flipX) {
      xDir = scale(xDir, -1);
      yDir = scale(yDir, -1);
    }
    return { origin, xDir, yDir, normal: n };
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
      if (ref.name === 'axis:x') return { origin: [0, 0, 0], dir: [1, 0, 0] };
      if (ref.name === 'axis:y') return { origin: [0, 0, 0], dir: [0, 1, 0] };
      if (ref.name === 'axis:z') return { origin: [0, 0, 0], dir: [0, 0, 1] };
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
    const labels = { what: t('slot.plane'), notPlanar: t('regen.refNotPlanar') };
    const signed = (n: Vec3): Vec3 => [n[0] * sign, n[1] * sign, n[2] * sign];
    switch (d.mode) {
      case 'offset': {
        const base = this.planeOf(d.plane, set, labels);
        return { ...base, origin: add(base.origin, base.normal, evalLength(d.distance) * sign) };
      }
      case 'angle': {
        const base = this.planeOf(d.plane, set, labels);
        const axis = this.axisOfRef(d.axis, set, t('pattern.rotationAxis'));
        const k = axis.dir;
        // The part of the plane's normal across the axis, turned about the axis.
        const across = sub(base.normal, add([0, 0, 0], k, dot(base.normal, k)));
        if (Math.hypot(...across) < 1e-9) throw new FeatureError(t('regen.axisPerpendicular'));
        return planeFrame(axis.origin, rotate(unit(across), k, evalAngle(d.angle) * sign));
      }
      case 'threePoint': {
        if (d.points.length < 3) throw new FeatureError(t('regen.threeVertices'));
        const [a, b, c] = d.points.map((ref, i) => this.pointOfRef(ref, set, t('datum.nthPoint', { n: i + 1 }))) as [Vec3, Vec3, Vec3];
        const normal = cross(sub(b, a), sub(c, a));
        const size = Math.max(Math.hypot(...sub(b, a)), Math.hypot(...sub(c, a)), 1e-9);
        if (Math.hypot(...normal) < 1e-9 * size * size) throw new FeatureError(t('regen.collinear'));
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
      case 'normalToCurve': {
        // the point must be on the curve: the place nearest it is found by the kernel and must be the point itself, not a place it is moved to (ADR 0174)
        const body = this.modelFor(set, t('slot.curve'));
        const edge = this.resolve(d.curve, body, t('slot.curve'));
        const p = this.pointOfRef(d.point, set, t('slot.throughPoint'));
        const near = this.kernel.edgeNearest(body.shape, edge, p);
        if (near.distance > 1e-6) throw new FeatureError(t('datum.pointNotOnCurve', { distance: near.distance.toFixed(4) }));
        return planeFrame(near.point, signed(near.tangent));
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
        const labels = { what: t('slot.plane'), notPlanar: t('regen.refNotPlanar') };
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
          if (d.element.fingerprint?.type === 'circle' && edge.geometry?.type !== 'circle') throw new FeatureError(t('entrance.circleChanged'));
          return edge.geometry?.type === 'circle' ? edge.geometry.center : edge.mid;
        }
        const face = body.topology.faces[index]!;
        return face.geometry?.type === 'sphere' ? face.geometry.center : face.center;
      }
      case 'axisPlane': {
        const axis = this.axisOfRef(d.axis, set, t('datum.axis'));
        const plane = this.planeOf(d.plane, set, { what: t('slot.plane'), notPlanar: t('regen.refNotPlanar') });
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

  private sketch(f: SketchFeature, set: Bodies, earlier: RebuildResult['sketches'] = new Map()) {
    const frame = this.frame(f, set);
    // projected model edges and pierce points are put where the model has them now (C1.18)
    let followed = f;
    if (f.entities.some((e) => modelRefOf(e))) {
      const body = set.view;
      // reference geometry needs no model (ADR 0172); an edge or a vertex does
      // reference geometry and other sketches need no model (ADR 0172, 0175); an edge or a vertex does
      if (!body && f.entities.some((e) => !['datum', 'sketch'].includes(modelRefOf(e)?.kind ?? 'datum'))) throw new FeatureError(t('reference.noModel'));
      try {
        followed = followReferences(f, {
          names: body?.names ?? NO_NAMES,
          topology: body?.topology ?? NO_TOPOLOGY,
          frame,
          datums: this.datumScope(set),
          ...(body ? { silhouettes: silhouetteProjector(this.kernel,body.shape,body.names,body.topology,frame).branch } : {}),
          // the sketches rebuilt before this one: the history is in order, so a sketch sees only those before it (ADR 0175)
          sketches: (id: Id) => {
            const s = earlier.get(id);
            return s && { frame: s.frame, geometry: s.solved.geometry };
          },
          // a curved edge's crossings with the plane are the kernel's to find (ADR 0173)
          ...(body ? { curves: { crossings: (i: number) => this.kernel.edgePlaneCrossings(body.shape, i, { origin: frame.origin, normal: frame.normal }) } } : {}),
        });
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
      if (regions.length === 0) throw new FeatureError(t('regen.noThinRegions'));
      return { ...s, profiles: { regions, problems: [] } };
    } catch (e) {
      if (e instanceof ThinProblem) throw new FeatureError(e.message);
      throw e;
    }
  }

  /** The sketch of a boss or cut with the contours the feature chose (all of them when it chose none, C1.34). */
  private profileOf(sketches: RebuildResult['sketches'], sketchId: Id, contours?: Id[][], thin?: Thin) {
    const s = sketches.get(sketchId);
    if (!s) throw new FeatureError(t('feature.sketchGone'));
    if (thin) return this.thinProfile(s, thin, contours);
    if (s.profiles.problems.length > 0) throw new FeatureError(t('regen.sketchUnusable', { problems: s.profiles.problems.join('; ') }));
    if (s.profiles.regions.length === 0) throw new FeatureError(t('regen.noClosedProfile'));
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
    if (f.op === 'cut' && !body) throw new FeatureError(t('feature.cutNeedsBody'));
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
    if (f.op === 'cut' && !set.view) throw new FeatureError(t('feature.cutNeedsBody'));
    const axis = sketchLine(s.solved.geometry, f.axis);
    if (!axis) throw new FeatureError(t('regen.axisGone'));
    const [a, b] = [axis.a, axis.b];
    const side = (p: [number, number]) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const pts = s.profiles.regions.flatMap((r) =>
      r.outer.flatMap((seg) =>
        seg.kind === 'line'
          ? [seg.a, seg.b]
          : seg.kind === 'arc'
            ? [seg.from, seg.to, seg.c]
            : seg.kind === 'ellipse'
              ? [
                  seg.c,
                  [seg.c[0] + seg.rx * Math.cos(seg.angle), seg.c[1] + seg.rx * Math.sin(seg.angle)] as [number, number],
                  [seg.c[0] - seg.rx * Math.cos(seg.angle), seg.c[1] - seg.rx * Math.sin(seg.angle)] as [number, number],
                  [seg.c[0] - seg.ry * Math.sin(seg.angle), seg.c[1] + seg.ry * Math.cos(seg.angle)] as [number, number],
                  [seg.c[0] + seg.ry * Math.sin(seg.angle), seg.c[1] - seg.ry * Math.cos(seg.angle)] as [number, number],
                ]
              : seg.kind === 'spline'
                ? seg.points
                : [seg.c],
      ),
    );
    const scale = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    if (pts.some((p) => side(p) > 1e-9 * scale) && pts.some((p) => side(p) < -1e-9 * scale)) throw new FeatureError(t('regen.crossesAxis'));

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
    // along a helix curve (ADR 0169): its body carries the helix; a failed or suppressed helix left none
    if (this.helixIds.has(f.path)) {
      const curve = set.list.find((b) => b.id === f.path && b.helix);
      if (!curve?.helix) throw new FeatureError(t('feature.sweepPathHelixGone'));
      const tool = this.kernel.sweepAlongHelix(s.frame, s.profiles.regions, { shape: curve.shape, edgeNames: curve.names.edges, path: curve.helix });
      return this.apply(f.id, f.op, tool, { featureId: f.id, sketchId: f.sketch }, set.list, f.merge !== false);
    }
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
    const head = first.kind === 'line' ? first.a : first.kind === 'arc' ? first.from : first.kind === 'spline' ? first.points[0]! : first.c;
    const tail = last.kind === 'line' ? last.b : last.kind === 'arc' ? last.to : last.kind === 'spline' ? last.points[last.points.length - 1]! : last.c;
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
          : start.kind === 'spline'
            ? [start.points[1]![0] - start.points[0]![0], start.points[1]![1] - start.points[0]![1]]
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

  /**
   * Real thread (C4.8, T-2): the tooth profile from a sketch containing the axis swept along a helix.
   * `op` is 'cut' or 'boss'; axis is resolved from Ref (cylinder/cone/torus face, straight edge, datum axis).
   */
  private thread(f: ThreadFeature, sketches: RebuildResult['sketches'], set: Bodies): BodyState[] {
    const isStandard = f.profileMode === 'standard';
    const op = f.op ?? f.operation ?? 'cut';
    if (op === 'cut' && !set.view) throw new FeatureError(t('feature.cutNeedsBody'));

    let axis: Axis3;
    let frame: PlaneFrame;
    let regions: Region[];
    let pitch: number;
    let zc = 0;

    if (isStandard) {
      if (!f.standardDesignation) throw new FeatureError(t('feature.threadNoStandard'));
      const entry = lookupThread(f.standardDesignation);
      if (!entry) throw new FeatureError(t('feature.threadUnknownStandard', { name: f.standardDesignation }));

      if (typeof f.axis === 'string') {
        if (f.axis === 'axis:x' || f.axis === 'axis:y' || f.axis === 'axis:z') {
          axis = this.axisOfRef({ kind: 'datum', name: f.axis }, set, t('feature.threadAxis'));
        } else if (f.sketch) {
          const s = sketches.get(f.sketch);
          if (!s) throw new FeatureError(t('feature.threadSketchGone'));
          const line = sketchLine(s.solved.geometry, f.axis);
          if (!line) throw new FeatureError(t('regen.axisGone'));
          const at2 = (p: [number, number]): Vec3 => add(add(s.frame.origin, s.frame.xDir, p[0]), s.frame.yDir, p[1]);
          axis = { origin: at2(line.a), dir: sub(at2(line.b), at2(line.a)) };
        } else {
          throw new FeatureError(t('feature.threadAxis'));
        }
      } else {
        axis = this.axisOfRef(f.axis, set, t('feature.threadAxis'));
      }
      const len = Math.hypot(...axis.dir);
      if (len < 1e-9) throw new FeatureError(t('feature.threadNoAxis'));
      const Z: Vec3 = [axis.dir[0] / len, axis.dir[1] / len, axis.dir[2] / len];
      const O = axis.origin;

      let X: Vec3 = Math.abs(Z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      const dotZX = Z[0] * X[0] + Z[1] * X[1] + Z[2] * X[2];
      X = [X[0] - dotZX * Z[0], X[1] - dotZX * Z[1], X[2] - dotZX * Z[2]];
      const xLen = Math.hypot(...X);
      X = [X[0] / xLen, X[1] / xLen, X[2] / xLen];
      const Y: Vec3 = [Z[1] * X[2] - Z[2] * X[1], Z[2] * X[0] - Z[0] * X[2], Z[0] * X[1] - Z[1] * X[0]];

      frame = { origin: O, xDir: X, yDir: Z, normal: Y };

      const target = f.standardTarget ?? 'external';
      const pts = generateStandardThreadProfile(entry, { op, target });

      const outer: Segment[] = pts.map((p, i) => ({
        kind: 'line',
        a: [p[0], p[1]],
        b: [pts[(i + 1) % pts.length]![0], pts[(i + 1) % pts.length]![1]],
        source: `stdProfile${i + 1}`,
      }));
      regions = [{ outer, holes: [] }];
      pitch = f.pitch ? evalLength(f.pitch) : entry.pitch;
      zc = 0;
      if (typeof f.axis !== 'string' && f.axis.kind === 'face') {
        try {
          const body = this.modelFor(set, t('feature.threadAxis'));
          const faceIdx = this.resolve(f.axis, body, t('feature.threadAxis'));
          if (faceIdx >= 0 && faceIdx < body.topology.faces.length) {
            const [lo, hi] = this.spanAlong(body, O, Z, faceIdx);
            zc = f.reverse ? hi : lo;
          }
        } catch {
          // fallback to 0
        }
      }
    } else {
      if (!f.sketch) throw new FeatureError(t('feature.threadSketchGone'));
      const s = sketches.get(f.sketch);
      if (!s) throw new FeatureError(t('feature.threadSketchGone'));

      // a line of the profile sketch (as a revolve's axis), else a reference
      if (typeof f.axis === 'string') {
        const line = s.solved.geometry.get(f.axis);
        if (line?.type !== 'line') throw new FeatureError(t('regen.axisGone'));
        const at2 = (p: [number, number]): Vec3 => add(add(s.frame.origin, s.frame.xDir, p[0]), s.frame.yDir, p[1]);
        axis = { origin: at2(line.a), dir: sub(at2(line.b), at2(line.a)) };
      } else axis = this.axisOfRef(f.axis, set, t('feature.threadAxis'));
      const len = Math.hypot(...axis.dir);
      if (len < 1e-9) throw new FeatureError(t('feature.threadNoAxis'));
      const Z: Vec3 = [axis.dir[0] / len, axis.dir[1] / len, axis.dir[2] / len];
      const O = axis.origin;

      pitch = evalLength(f.pitch!);
      frame = s.frame;
      regions = s.profiles.regions;
      if (regions.length === 0) throw new FeatureError(t('feature.threadNoProfile'));

      const at = (p: [number, number]): Vec3 => add(add(s.frame.origin, s.frame.xDir, p[0]), s.frame.yDir, p[1]);
      const dotv = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const subVec = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

      // the profile's extent along the axis (arcs and circles sampled, as the kernel does: an arc's centre and ends do not bound it)
      const samples: Vec3[] = [];
      for (const r of regions) {
        for (const seg of r.outer) {
          if (seg.kind === 'line') samples.push(at(seg.a), at(seg.b));
          else if (seg.kind === 'ellipse') {
            const cosA = Math.cos(seg.angle);
            const sinA = Math.sin(seg.angle);
            for (let i = 0; i <= 64; i++) {
              const u = (2 * Math.PI * i) / 64;
              const x = seg.rx * Math.cos(u);
              const y = seg.ry * Math.sin(u);
              samples.push(at([seg.c[0] + x * cosA - y * sinA, seg.c[1] + x * sinA + y * cosA]));
            }
          } else if (seg.kind === 'spline') {
            for (const p of seg.points) samples.push(at(p));
          } else {
            const a0 = seg.kind === 'circle' ? 0 : Math.atan2(seg.from[1] - seg.c[1], seg.from[0] - seg.c[0]);
            let sweep = seg.kind === 'circle' ? 2 * Math.PI : Math.atan2(seg.to[1] - seg.c[1], seg.to[0] - seg.c[0]) - a0;
            if (seg.kind === 'arc') {
              if (seg.ccw && sweep <= 0) sweep += 2 * Math.PI;
              if (!seg.ccw && sweep >= 0) sweep -= 2 * Math.PI;
            }
            for (let i = 0; i <= 64; i++) samples.push(at([seg.c[0] + seg.r * Math.cos(a0 + (sweep * i) / 64), seg.c[1] + seg.r * Math.sin(a0 + (sweep * i) / 64)]));
          }
        }
      }
      const zs = samples.map((p) => dotv(subVec(p, O), Z));
      // the thread starts at the profile's leading edge, so the tooth as drawn is cut whole: starting at its middle (as before) cut off the half
      // of the profile behind it, which showed as a short, broken first tooth and the thread shifted along the axis
      zc = f.reverse ? Math.max(...zs) : Math.min(...zs);
    }

    const len = Math.hypot(...axis.dir);
    const Z: Vec3 = [axis.dir[0] / len, axis.dir[1] / len, axis.dir[2] / len];
    const O = axis.origin;

    const n = f.starts ? evalNumber(f.starts) : 1;
    const starts = Math.abs(n - Math.round(n)) < 1e-9 ? Math.round(n) : n;
    const length = evalLength(f.length);
    const taper = f.taper ? evalAngle(f.taper) : 0;
    const phase = f.phase ? evalAngle(f.phase) : 0;
    const fadeTurnsIn = f.fadeTurnsIn ? evalNumber(f.fadeTurnsIn) : 0;
    const fadeTurnsOut = f.fadeTurnsOut ? evalNumber(f.fadeTurnsOut) : 0;

    const from = f.reverse ? zc - length : zc;
    const to = f.reverse ? zc : zc + length;

    const spec: ThreadSpec = {
      axis: { origin: O, dir: Z },
      pitch,
      starts,
      hand: f.hand,
      from,
      to,
      ...(taper !== 0 ? { taper } : {}),
      ...(phase !== 0 ? { phase } : {}),
      ...(fadeTurnsIn !== 0 ? { fadeTurnsIn } : {}),
      ...(fadeTurnsOut !== 0 ? { fadeTurnsOut } : {}),
    };

    let tool: OpResult;
    try {
      tool = this.kernel.thread(frame, regions, spec);
    } catch (e) {
      if (e instanceof KernelError) throw new FeatureError(e.message);
      throw e;
    }

    return this.apply(f.id, op, tool, { featureId: f.id, ...(f.sketch ? { sketchId: f.sketch } : {}) }, set.list, true);
  }

  /**
   * Where a face of the model lies along `axis`, measured from `O`: the least and the greatest of its vertices and the midpoints of its edges.
   * `[0, 0]` when the face has neither (there is nothing to measure it by).
   */
  private spanAlong(body: BodyState, O: Vec3, Z: Vec3, face: number | null): [number, number] {
    const points: Vec3[] = [];
    if (face === null) {
      for (const v of body.topology.vertices) points.push(v.point);
    } else {
      for (const v of body.topology.vertices) if (v.faces.includes(face)) points.push(v.point);
      for (const e of body.topology.edges) if (e.faces.includes(face)) points.push(e.mid);
    }
    if (points.length === 0) return [0, 0];
    const along = points.map((p) => dot(sub(p, O), Z));
    return [Math.min(...along), Math.max(...along)];
  }

  /**
   * Knurl (壓花, ADR 0124): the grooves of a straight, helical or diamond pattern cut into a cylinder about an axis. The blank is the cylinder of
   * `diameter`, so the body must already be that size there — a knurl that cuts nothing says so rather than doing nothing.
   *
   * A diamond is cut once per hand (see below). That makes it cost about the square of the groove count, because the second hand's flanks have to
   * intersect every groove the first one left: a dozen grooves a hand is a few seconds, forty is minutes. Past `KNURL_MAX_DIAMOND_GROOVES` the
   * rebuild is refused with the reason, rather than left to run for hours (AGENTS.md §2.1: refuse up front, do not hand a catastrophic operation
   * to the solver).
   */
  private knurl(f: KnurlFeature, set: Bodies): BodyState[] {
    if (!set.view) throw new FeatureError(t('feature.knurlNeedsBody'));
    const axis = this.axisOfRef(f.axis, set, t('feature.knurlAxis'));
    const len = Math.hypot(...axis.dir);
    if (!(len > 1e-9)) throw new FeatureError(t('feature.knurlNoAxis'));
    const Z: Vec3 = [axis.dir[0] / len, axis.dir[1] / len, axis.dir[2] / len];
    const O = axis.origin;

    // the end of the surface it starts from: the face the axis names, or the near end of the body when the axis is a datum
    const body = this.modelFor(set, t('feature.knurlAxis'));
    const faceIdx = f.axis.kind === 'face' ? this.resolve(f.axis, body, t('feature.knurlAxis')) : null;
    const [lo, hi] = this.spanAlong(body, O, Z, faceIdx);
    const zc = f.reverse ? hi : lo;
    const length = evalLength(f.length);
    const from = f.reverse ? zc - length : zc;
    const to = f.reverse ? zc : zc + length;

    const radius = evalLength(f.diameter) / 2;
    const count = evalNumber(f.count);
    if (f.pattern === 'diamond' && count > KNURL_MAX_DIAMOND_GROOVES)
      throw new FeatureError(t('feature.knurlDiamondTooFine', { count: String(count), max: String(KNURL_MAX_DIAMOND_GROOVES) }));
    const base = {
      axis: { origin: O, dir: Z },
      radius,
      count,
      from,
      to,
      depth: evalLength(f.depth),
      included: f.included ? evalAngle(f.included) : Math.PI / 2,
      ...(f.phase ? { phase: evalAngle(f.phase) } : {}),
    };
    const angle = f.angle ? evalAngle(f.angle) : Math.PI / 6;
    // One tool holds one hand of grooves: a tool holding both would have its solids crossing one another, and OCCT leaves
    // the faces inside the crossing in the result instead of resolving them. A diamond is therefore the two hands cut in
    // turn — which is the same material either way, since body \ (A ∪ B) = (body \ A) \ B.
    const specs: KnurlSpec[] =
      f.pattern === 'straight'
        ? [{ ...base, pattern: 'straight' }]
        : f.pattern === 'helical'
          ? [{ ...base, pattern: 'helical', angle, ...(f.hand ? { hand: f.hand } : {}) }]
          : [
              { ...base, pattern: 'helical', angle, hand: 'right' },
              { ...base, pattern: 'helical', angle, hand: 'left' },
            ];

    try {
      let list: BodyState[] = [...set.list];
      for (const spec of specs) {
        let tool: OpResult;
        try {
          tool = this.kernel.knurl(spec);
        } catch (e) {
          if (e instanceof KernelError) throw new FeatureError(e.message);
          throw e;
        }
        list = this.apply(f.id, 'cut', tool, { featureId: f.id }, list, true);
      }
      return list;
    } catch (e) {
      // the grooves cut nothing away: the blank is not the size the feature asks for, which is worth saying in its own words
      if (e instanceof FeatureError && e.message === t('feature.cutRemovedNothing')) throw new FeatureError(t('feature.knurlRemovedNothing', { diameter: (radius * 2).toFixed(3) }));
      throw e;
    }
  }

  /**
   * Cosmetic Thread (裝飾螺紋線, C4.9, ADR 0156):
   * A lightweight annotation on a cylindrical surface (shaft or hole).
   * Does NOT call OCCT boolean algorithms (0.00 MiB WASM Heap leakage).
   */
  private cosmeticThread(f: CosmeticThreadFeature, set: Bodies): void {
    if (!validThreadTolerance(f.toleranceClass, f.standardMode === 'standard' ? f.standardDesignation : undefined, f.threadType)) throw new FeatureError(t('cmd.badThreadTolerance'));
    if (!set.view) throw new FeatureError(t('feature.cosmeticThreadNeedsBody'));
    const body = this.modelFor(set, t('feature.cosmeticThread'));
    const faceIdx = this.resolve(f.targetFace, body, t('feature.cosmeticThread'));
    const face = body.topology.faces[faceIdx];
    if (!face || face.geometry?.type !== 'cylinder') {
      throw new FeatureError(t('feature.cosmeticThreadNotCylinder'));
    }

    const geom = face.geometry;
    const r = geom.radius;
    const axisDir = unit(geom.axis);

    // Collect all vertex projections on the cylinder axis to find its length [tMin, tMax]
    let tMin = Infinity;
    let tMax = -Infinity;
    for (const v of body.topology.vertices) {
      if (v.faces.includes(faceIdx)) {
        const tProj = dot(sub(v.point, geom.origin), axisDir);
        if (tProj < tMin) tMin = tProj;
        if (tProj > tMax) tMax = tProj;
      }
    }

    if (!Number.isFinite(tMin) || !Number.isFinite(tMax) || tMax <= tMin + 1e-6) {
      tMin = 0;
      tMax = 10;
    }
    const cylinderLength = tMax - tMin;

    // Determine start point and direction
    let startT = tMin;
    let dirSign = 1;

    if (f.startEdge) {
      const edgeIdx = this.resolve(f.startEdge, body, t('feature.cosmeticThread'));
      const edge = body.topology.edges[edgeIdx];
      if (edge) {
        const edgeMid = edge.mid;
        const edgeT = dot(sub(edgeMid, geom.origin), axisDir);
        // If start edge is closer to tMax, thread runs backward towards tMin
        if (Math.abs(edgeT - tMax) < Math.abs(edgeT - tMin)) {
          startT = tMax;
          dirSign = -1;
        } else {
          startT = tMin;
          dirSign = 1;
        }
      }
    }

    if (f.reverse) {
      dirSign = -dirSign;
      startT = dirSign === 1 ? tMin : tMax;
    }

    const threadDir: Vec3 = dirSign === 1 ? axisDir : [-axisDir[0], -axisDir[1], -axisDir[2]];
    const threadOrigin = add(geom.origin, axisDir, startT);

    // Evaluate depth
    let depth = cylinderLength;
    if (f.endCondition === 'blind') {
      depth = evalLength(f.depth);
      if (!(depth > 0) || !Number.isFinite(depth)) {
        throw new FeatureError(t('feature.cosmeticThreadBadDepth'));
      }
      depth = Math.min(depth, cylinderLength);
    }

    // Evaluate diameters & pitch
    let majorDiameter = 0;
    let minorDiameter = 0;
    let pitch = 0;

    if (f.standardMode === 'standard' && f.standardDesignation) {
      const std = lookupThread(f.standardDesignation);
      if (std) {
        majorDiameter = std.nominalDia;
        pitch = std.pitch;
        minorDiameter = f.threadType === 'external' ? std.extMinorDia : std.intMinorDia;
      }
    }

    if (!(majorDiameter > 0) || !(minorDiameter > 0) || !(pitch > 0)) {
      majorDiameter = evalLength(f.majorDiameter);
      minorDiameter = evalLength(f.minorDiameter);
      pitch = evalLength(f.pitch);
    }

    // Edge-case defense (AGENTS.md §2.1)
    if (!(majorDiameter > 0) || !(minorDiameter > 0) || !(pitch > 0) || majorDiameter <= minorDiameter) {
      throw new FeatureError(t('feature.cosmeticThreadBadDimensions'));
    }

    this.cosmeticThreads.push({
      featureId: f.id,
      targetFace: f.targetFace,
      startEdge: f.startEdge,
      threadType: f.threadType,
      standardMode: f.standardMode ?? 'custom',
      standardDesignation: f.standardDesignation,
      toleranceClass: f.toleranceClass,
      majorDiameter,
      minorDiameter,
      pitch,
      depth,
      endCondition: f.endCondition,
      origin: threadOrigin,
      axis: threadDir,
      radius: r,
      cylinderLength,
    });
  }

  /**
   * Helix and Spiral Curve (螺旋曲線與渦捲線, C8.3, ADR 0168):
   * Constructs a 3D space helix or planar Archimedean spiral wire from a reference circle.
   */
  private toothedSolid(f:SpurGearFeature|RackFeature,set:Bodies):BodyState[] {
    const p=gearParameters(f),frame=this.planeOf(f.plane,set,{what:t('feature.gear'),notPlanar:t('sketch.planeOnly')});
    const region=toothedProfile(p),tool=this.kernel.extrude(frame,[region],scale(frame.normal,p.width));
    if(!this.kernel.isValid(tool.shape)||this.kernel.solidCount(tool.shape)!==1) {this.kernel.release(tool.shape);throw new FeatureError(t('gear.invalid'));}
    return this.apply(f.id,'boss',tool,{featureId:f.id},set.list,false);
  }

  private surfaceTools(f:RuledSurfaceFeature|RadiatedSurfaceFeature|ReplaceFaceFeature,set:Bodies):BodyState[] {
    const owner=(ref:Ref)=>{
      const body=set.list.find(b=>(ref.kind==='edge'?b.names.edges:b.names.faces).includes(ref.name));
      if(!body)throw new FeatureError(t('reference.lost'),[{ref,reason:'missing',candidates:[]}]);
      return {body,index:this.resolve(ref,body,t('surfaceTools.pickEdges'))};
    };
    if(f.type==='replaceFace') {
      const {body,index}=owner(f.face),face=body.topology.faces[index]!;
      const plane=this.planeOf(f.replacement,set,{what:t('feature.replaceFace'),notPlanar:t('surfaceTools.parallelPlane')});
      if(body.surface||!face.normal||face.surface!=='plane'||Math.abs(dot(face.normal,plane.normal))<1-1e-9)throw new FeatureError(t('surfaceTools.parallelPlane'));
      const distance=dot(sub(plane.origin,face.center),face.normal);
      if(!Number.isFinite(distance)||Math.abs(distance)>1e6)throw new FeatureError(t('surfaceTools.range'));
      if(Math.abs(distance)<1e-9)throw new FeatureError(t('surfaceTools.distance'));
      const result=this.kernel.moveFace(body.shape,index,distance);
      const topology=this.kernel.topology(result.shape);
      if(!topology.faces.some(g=>g.surface==='plane'&&g.normal&&Math.abs(dot(g.normal,plane.normal))>1-1e-9&&Math.abs(dot(sub(g.center,plane.origin),plane.normal))<1e-6)){this.kernel.release(result.shape);throw new FeatureError(t('surfaceTools.invalid'));}
      return set.list.map(b=>b===body?this.edited(f,result,body):b);
    }
    let shape:ShapeId;
    if(f.type==='ruledSurface') {
      const a=owner(f.first),b=owner(f.second);shape=this.kernel.ruledSurface({shape:a.body.shape,edge:a.index},{shape:b.body.shape,edge:b.index},!!f.reverseSecond);
    } else {
      const a=owner(f.edge),plane=this.planeOf(f.plane,set,{what:t('feature.radiatedSurface'),notPlanar:t('surfaceTools.planarEdge')});
      shape=this.kernel.radiatedSurface(a.body.shape,a.index,plane.normal,evalLength(f.distance)*(f.reverse?-1:1));
    }
    this.owned.push(shape);const topology=this.kernel.topology(shape),names=nameFromFaces(topology.faces.map((_,i)=>`${f.id}:surface:${i}`),topology);
    return [...set.list,{id:f.id,by:f.id,shape,topology,names,surface:true}];
  }

  private projectedCurve(f: ProjectedCurveFeature, sketches: RebuildResult['sketches'], set: Bodies): BodyState[] {
    const paths = (id: Id) => {
      const s = sketches.get(id);
      if (!s) throw new FeatureError(t('projection.twoSketches'));
      const found = findOutlines(s.sketch, s.solved);
      if (found.problems.length) throw new FeatureError(found.problems.join('; '));
      const all = [...found.chains, ...found.loops.map(l=>l.loop)];
      if (!all.length) throw new FeatureError(t('projection.empty'));
      return { frame: s.frame, paths: all };
    };
    const a = paths(f.sketch);
    let shape: ShapeId;
    if (f.mode === 'sketchOnSketch') {
      if (!f.secondSketch || f.secondSketch === f.sketch) throw new FeatureError(t('projection.twoSketches'));
      const b = paths(f.secondSketch);
      shape = this.kernel.intersectSketchCurves(a.frame, a.paths, b.frame, b.paths);
    } else {
      const targets = (f.faces ?? []).map(ref => {
        const body = set.list.find(b=>b.names.faces.includes(ref.name));
        if (!body) throw new FeatureError(t('projection.faces'), [{ ref, reason: 'missing', candidates: [] }]);
        return { shape: body.shape, face: this.resolve(ref, body, t('projection.faces')) };
      });
      shape = this.kernel.projectedCurve(a.frame, a.paths, targets, f.direction ? this.directionOf(f.direction, set, t('feature.projectedCurve')) : a.frame.normal);
    }
    this.owned.push(shape);
    const topology = this.kernel.topology(shape);
    // Geometry-ranked names, aligned with the actual topology, never with an assumed number of sketch segments.
    const namesOf = (points: Vec3[], kind: string) => {
      const order = points.map((point, index)=>({point,index})).sort((a,b)=>a.point[0]-b.point[0] || a.point[1]-b.point[1] || a.point[2]-b.point[2]);
      const names: string[] = []; order.forEach((v,i)=>{names[v.index]=`${f.id}:${kind}:${i}`;}); return names;
    };
    const names: ElementNames = { faces: [], edges: namesOf(topology.edges.map(e=>e.mid), 'curve'), vertices: namesOf(topology.vertices.map(v=>v.point), 'vertex') };
    return [...set.list, { id: f.id, by: f.id, shape, topology, names, surface: true, curve: true }];
  }

  private helix(f: HelixFeature, sketches: RebuildResult['sketches'], set: Bodies): BodyState[] {
    let center: Vec3;
    let normal: Vec3;
    let radius: number;
    let refDir: Vec3 | undefined;

    if (f.circle.kind === 'edge') {
      const body = this.modelFor(set, t('pm.helix.circle'));
      const edgeIndex = this.resolve(f.circle, body, t('pm.helix.circle'));
      const edge = body.topology.edges[edgeIndex]!;
      if (edge.geometry?.type !== 'circle') {
        throw new FeatureError(t('helix.noCircle'));
      }
      center = edge.geometry.center;
      normal = edge.geometry.normal;
      radius = edge.geometry.radius;
      refDir = [edge.mid[0] - center[0], edge.mid[1] - center[1], edge.mid[2] - center[2]];
    } else if (f.circle.kind === 'datum') {
      const s = sketches.get(f.circle.name);
      if (!s) throw new FeatureError(t('helix.noCircle'));
      // the reference is the sketch, not one of its entities: it has to have exactly one circle or arc (construction geometry aside), as in
      // SolidWorks; with two the helix would silently take whichever came first
      const circles = [...s.solved.geometry.values()].filter((g): g is Extract<typeof g, { type: 'circle' | 'arc' }> => (g.type === 'circle' || g.type === 'arc') && !g.construction);
      if (circles.length === 0) throw new FeatureError(t('helix.noCircle'));
      if (circles.length > 1) throw new FeatureError(t('helix.ambiguousCircle', { count: String(circles.length) }));
      const geom = circles[0]!;
      const foundCircle = { center: [geom.c[0], geom.c[1]] as [number, number], radius: geom.r };
      const fr = s.frame;
      center = add(add(fr.origin, fr.xDir, foundCircle.center[0]), fr.yDir, foundCircle.center[1]);
      normal = fr.normal;
      radius = foundCircle.radius;
      refDir = fr.xDir;
    } else {
      throw new FeatureError(t('helix.noCircle'));
    }

    const definedBy = f.definedBy ?? 'pitchAndRev';
    let pitch = 0;
    let revolutions = 0;
    let height = 0;
    const isSpiral = definedBy === 'spiral';

    if (definedBy === 'pitchAndRev') {
      if (!f.pitch) throw new FeatureError(t('helix.invalidPitch'));
      if (!f.revolutions) throw new FeatureError(t('helix.invalidRevolutions'));
      pitch = evalLength(f.pitch);
      revolutions = evalNumber(f.revolutions);
      height = pitch * revolutions;
    } else if (definedBy === 'heightAndRev') {
      if (!f.height) throw new FeatureError(t('helix.invalidHeight'));
      if (!f.revolutions) throw new FeatureError(t('helix.invalidRevolutions'));
      height = evalLength(f.height);
      revolutions = evalNumber(f.revolutions);
      if (!(revolutions > 1e-6)) throw new FeatureError(t('helix.invalidRevolutions'));
      pitch = height / revolutions;
    } else if (definedBy === 'heightAndPitch') {
      if (!f.height) throw new FeatureError(t('helix.invalidHeight'));
      if (!f.pitch) throw new FeatureError(t('helix.invalidPitch'));
      height = evalLength(f.height);
      pitch = evalLength(f.pitch);
      if (!(pitch > 1e-6)) throw new FeatureError(t('helix.invalidPitch'));
      revolutions = height / pitch;
    } else if (definedBy === 'spiral') {
      if (!f.pitch) throw new FeatureError(t('helix.invalidPitch'));
      if (!f.revolutions) throw new FeatureError(t('helix.invalidRevolutions'));
      pitch = evalLength(f.pitch);
      revolutions = evalNumber(f.revolutions);
      height = 0;
    }

    const startAngle = f.startAngle ? evalAngle(f.startAngle) : 0;
    const clockwise = f.clockwise ?? true;
    const reverse = f.reverse ?? false;
    const taperAngle = f.taperAngle ? evalAngle(f.taperAngle) : 0;
    const taperOutward = f.taperOutward ?? false;

    const res = this.kernel.helixCurve({
      center,
      normal,
      refDir,
      radius,
      pitch,
      revolutions,
      height,
      startAngle,
      clockwise,
      reverse,
      taperAngle,
      taperOutward,
      isSpiral,
    });

    this.owned.push(res.shape);
    const topology = this.kernel.topology(res.shape);
    const names = helixNames(f.id, topology, {
      start: res.startPoint,
      end: res.endPoint,
      origin: center,
      axis: scale(normal, (reverse ? -1 : 1) / Math.hypot(...normal)),
      rise: isSpiral ? 0 : pitch,
    });

    this.info = t('helix.info', {
      mode: t(`pm.helix.${definedBy}`),
      radius: radius.toFixed(2),
      length: res.totalLength.toFixed(2),
    });

    const axis = scale(normal, (reverse ? -1 : 1) / Math.hypot(...normal));
    const newBody: BodyState = {
      id: f.id,
      shape: res.shape,
      topology,
      names,
      by: f.id,
      surface: true,
      curve: true,
      helix: {
        origin: center,
        axis,
        start: res.startPoint,
        end: res.endPoint,
        pitch,
        revolutions,
        hand: clockwise ? 1 : -1,
        spiral: isSpiral,
        taper: isSpiral ? 0 : (taperOutward ? 1 : -1) * taperAngle,
      },
    };

    return [...set.list, newBody];
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
      if ((f.type !== 'pattern' && !(f.type === 'mirror' && f.target === 'features')) || f.suppressed) return;
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
  private placements(f: PatternFeature, sketches: RebuildResult['sketches'], set: Bodies): { label: string; motion: Motion }[] {
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
    if (d.mode === 'circular') {
      const axis = this.axisOfRef(d.axis, set, t('pattern.rotationAxis'));
      const n = this.patternCount(d.count, t('pattern.count'));
      const step = angleStep(n, evalAngle(d.angle), d.equal) * (d.reverse ? -1 : 1);
      return patternInstances(n, null).map((x) => ({ label: x.label, motion: turn(axis.origin, axis.dir, step * x.i) }));
    }
    // Curve-driven pattern (C6.4, ADR 0166)
    const n = this.patternCount(d.count, t('pattern.count'));
    const spacing = d.spacing !== undefined && d.spacing.trim() !== '' ? evalLength(d.spacing) : undefined;
    if (!d.equal && spacing !== undefined && !(spacing > 1e-9)) {
      throw new FeatureError(t('pattern.spacingPositive'));
    }
    let samples: { point: Vec3; tangent: Vec3 }[];
    if (d.path.kind === 'edge') {
      const body = this.modelFor(set, t('pattern.curvePath'));
      const edgeIndex = this.resolve(d.path, body, t('pattern.curvePath'));
      const res = this.kernel.sampleEdgeCurve(body.shape, edgeIndex, {
        count: n,
        equal: d.equal,
        spacing,
        reverse: d.reverse,
      });
      samples = res.samples;
    } else if (d.path.kind === 'datum') {
      const p = sketches.get(d.path.name);
      if (!p) throw new FeatureError(t('pattern.curvePathMissing'));
      const found = findOutlines(p.sketch, p.solved);
      const pathSegments = found.chains[0] ?? found.loops[0]?.loop;
      if (!pathSegments || pathSegments.length === 0) {
        throw new FeatureError(t('pattern.curvePathNoGeometry'));
      }
      const res = this.kernel.samplePathCurve(p.frame, pathSegments, {
        count: n,
        equal: d.equal,
        spacing,
        reverse: d.reverse,
      });
      samples = res.samples;
    } else {
      throw new FeatureError(t('pattern.curvePathInvalid'));
    }

    if (samples.length < 2) throw new FeatureError(t('pattern.noInstances'));
    const seedSample = samples[0]!;
    return samples.slice(1).map((s, idx) => ({
      label: String(idx + 1),
      motion: curveMotion(seedSample.point, seedSample.tangent, s.point, s.tangent, d.alignment),
    }));
  }

  /** What the seeds of a pattern or a mirror did, or why there is nothing to repeat. */
  private deltaOf(f: PatternFeature | MirrorFeature): Delta {
    const plan = this.patternPlans.get(f.id);
    if (typeof plan === 'string') throw new FeatureError(plan);
    if (!plan) throw new FeatureError(t('pattern.seedMissing'));
    const failed = plan.seeds.find((id) => this.statuses.get(id) !== 'ok');
    if (failed) throw new FeatureError(t('pattern.seedFailed', { name: this.featureNames.get(failed) ?? failed }));
    const delta = this.deltas.get(f.id);
    if (!delta || (!delta.added && !delta.removed)) throw new FeatureError(t('pattern.seedChangedNothing'));
    return delta;
  }

  /** A pattern (C6.1, C6.2): a copy of what the seeds added, moved to each instance and joined like the seed was, and of what they took away, moved and cut. */
  private pattern(f: PatternFeature, sketches: RebuildResult['sketches'], set: Bodies): BodyState[] {
    const delta = this.deltaOf(f);
    const skip = new Set(f.skip ?? []);
    const instances = this.placements(f, sketches, set).filter((p) => !skip.has(p.label));
    if (instances.length === 0) throw new FeatureError(t('pattern.noInstances'));
    return this.repeat(f, set, delta, instances.map((p) => ({ ...p, prefix: `inst${p.label}` })), {
      overlap: true,
      misses: (label) => t('pattern.instanceMissesBody', { label }),
      floats: (label) => t('pattern.instanceFloats', { label }),
    });
  }

  /** A mirror (C6.3) of features: what the seeds added and took away, reflected across the plane and joined and cut like the seed was. */
  private mirrorFeatures(f: MirrorFeature, set: Bodies): BodyState[] {
    const delta = this.deltaOf(f);
    return this.repeat(f, set, delta, [{ label: '1', motion: this.mirrorMotion(f, set), prefix: 'mirror' }], {
      overlap: false,
      misses: () => t('mirror.cutMissesBody'),
      floats: () => t('mirror.bossFloats'),
    });
  }

  private mirrorMotion(f: MirrorFeature, set: Bodies): Motion {
    const plane = this.planeOf(f.plane, set, { what: t('mirror.plane'), notPlanar: t('mirror.planeNotPlanar') });
    return mirror(plane.origin, plane.normal);
  }

  /** A mirror of whole bodies: each reflected into a body of its own (`merge: false`), or joined to every body it touches, the original too. */
  private mirrorBodies(f: MirrorFeature, set: Bodies): BodyState[] {
    if (f.bodies.length === 0) throw new FeatureError(t('mirror.pickBodies'));
    const k = this.kernel;
    const motion = this.mirrorMotion(f, set);
    const original = new Set(set.list.map((b) => b.shape));
    let current: readonly BodyState[] = set.list;
    const drop = (old: readonly BodyState[], now: readonly BodyState[]) => {
      for (const b of old) if (!original.has(b.shape) && !now.some((x) => x.shape === b.shape)) k.release(b.shape);
    };
    try {
      f.bodies.forEach((ref, i) => {
        if (!ref.name) throw new FeatureError(t('mirror.pickBodies'));
        const body = set.list.find((b) => b.id === ref.name);
        if (!body) throw new FeatureError(t('body.lost', { name: ref.name }), [{ ref, reason: 'missing', candidates: [] }]);
        const shape = k.transformed(body.shape, motion);
        const names = nameFromFaces(body.names.faces.map((n) => `${f.id}:mirror:${n}`), k.topology(shape));
        const next = this.apply(f.id, 'boss', { shape, faceOrigins: [] }, { featureId: f.id }, current, f.merge !== false, `${f.id}#${i + 1}`, names);
        drop(current, next);
        current = next;
      });
      return [...current];
    } catch (e) {
      drop(current, []);
      throw e;
    }
  }

  private mirror(f: MirrorFeature, set: Bodies): BodyState[] {
    return f.target === 'features' ? this.mirrorFeatures(f, set) : this.mirrorBodies(f, set);
  }

  /**
   * Copies of what the seeds did, one for each instance, put on the bodies in turn: what they added joined (or standing apart, if the seed's did), what
   * they took away cut. An instance that does not meet the bodies is an error that names it.
   */
  private repeat(f: PatternFeature | MirrorFeature, set: Bodies, delta: Delta, instances: { label: string; motion: Motion; prefix: string }[], check: { overlap: boolean; misses: (label: string) => string; floats: (label: string) => string }): BodyState[] {
    const k = this.kernel;
    // the copy of what the seeds did that goes to each instance, made before any is used so that they can be compared with one another
    const pending = new Set<ShapeId>();
    const make = (part: NonNullable<Delta['added']>) =>
      instances.map((p) => {
        const shape = k.transformed(part.shape, p.motion);
        pending.add(shape);
        return { label: p.label, shape, names: nameFromFaces(part.names.faces.map((n) => `${f.id}:${p.prefix}:${n}`), k.topology(shape)) };
      });
    let current: readonly BodyState[] = set.list;
    const original = new Set(set.list.map((b) => b.shape));
    const drop = (old: readonly BodyState[], now: readonly BodyState[]) => {
      for (const b of old) if (!original.has(b.shape) && !now.some((x) => x.shape === b.shape)) k.release(b.shape);
    };
    try {
      const adds = delta.added ? make(delta.added) : [];
      const cuts = delta.removed ? make(delta.removed) : [];
      if (check.overlap) {
        this.noOverlap(delta.added?.shape ?? null, adds);
        this.noOverlap(delta.removed?.shape ?? null, cuts);
      }
      for (let i = 0; i < instances.length; i++) {
        const label = instances[i]!.label;
        const at = (run: () => BodyState[]): BodyState[] => {
          try {
            return run();
          } catch (e) {
            if (e instanceof FeatureError && e.message === t('feature.cutRemovedNothing')) throw new FeatureError(check.misses(label));
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
            throw new FeatureError(check.floats(label));
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
        if (r.out.length === 0) throw new FeatureError(t('regen.cutRemovedAll'));
        if (r.removed.length > 0) this.warnings.push(t('body.removedWhole', { names: r.removed.join(t('cmd.listSeparator')) }));
        return r.out;
      }
      let acc: BodyState = { id: bodyId, shape: tool.shape, topology: toolTopology, names: toolNames, by: featureId };
      if (!merge) return [...list, acc];
      const out: BodyState[] = [];
      let slot = -1;
      for (const b of list) {
        if (b.surface) {
          out.push(b); // a surface body is not joined to
          continue;
        }
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
      if (b.surface) {
        out.push(b); // a surface body is not cut
        continue;
      }
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

  /** 「分割實體」 (C7.4, ADR 0158): splits bodies by a datum plane or planar face. */
  private splitBodies(f: SplitFeature, set: Bodies): BodyState[] {
    const plane = this.planeOf(f.tool, set, { what: t('pm.split.tool'), notPlanar: t('feature.splitToolNotPlanar') });
    const k = this.kernel;

    const findTarget = (ref: Ref): BodyState => {
      if (!ref.name) throw new FeatureError(t('body.pick', { what: t('pm.split.targets') }));
      const b = set.list.find((x) => x.id === ref.name);
      if (!b) throw new FeatureError(t('body.lost', { name: ref.name }), [{ ref, reason: 'missing', candidates: [] }]);
      if (b.surface) throw new FeatureError(t('surface.notSolid'));
      return b;
    };

    const hasTargets = !!(f.targets && f.targets.length > 0);
    const targetCandidates = hasTargets
      ? f.targets!.map(findTarget)
      : set.list.filter((b) => !b.surface);

    if (targetCandidates.length === 0) {
      throw new FeatureError(t('feature.splitNoIntersection'));
    }

    const made: ShapeId[] = [];
    let nextPiece = 2;
    const splitMap = new Map<BodyState, BodyState[]>();

    try {
      for (const target of targetCandidates) {
        let results: OpResult[];
        try {
          results = k.splitBody(target.shape, plane);
        } catch (e) {
          if (hasTargets) {
            throw e instanceof KernelError ? new FeatureError(e.message) : e;
          }
          continue;
        }

        const pieces: BodyState[] = [];
        results.forEach((r, idx) => {
          made.push(r.shape);
          const topology = k.topology(r.shape);
          const context = {
            featureId: f.id,
            role: 'split',
            input: {
              faces: [...target.names.faces, `${f.id}:cut`],
              edges: target.names.edges,
              vertices: target.names.vertices,
            },
          };
          const names = nameElements(r.faceOrigins, topology, context);
          const bodyId = idx === 0 ? target.id : `${f.id}#${nextPiece++}`;
          pieces.push({ id: bodyId, shape: r.shape, topology, names, by: f.id });
        });

        splitMap.set(target, pieces);
      }

      if (splitMap.size === 0) {
        throw new FeatureError(t('feature.splitNoIntersection'));
      }

      const out: BodyState[] = [];
      for (const b of set.list) {
        const pieces = splitMap.get(b);
        if (pieces) {
          out.push(...pieces);
        } else {
          out.push(b);
        }
      }
      return out;
    } catch (e) {
      for (const s of made) k.release(s);
      throw e;
    }
  }

  /** 「移動/複製本體」 (C7.3, ADR 0164): translates or rotates bodies, optionally copying them. */
  private moveCopyBody(f: MoveCopyBodyFeature, set: Bodies): BodyState[] {
    const k = this.kernel;

    const findTarget = (ref: Ref): BodyState => {
      if (!ref.name) throw new FeatureError(t('body.pick', { what: t('pm.moveCopyBody.targets') }));
      const b = set.list.find((x) => x.id === ref.name);
      if (!b) throw new FeatureError(t('body.lost', { name: ref.name }), [{ ref, reason: 'missing', candidates: [] }]);
      return b;
    };

    let targetCandidates: BodyState[];
    if (f.targets && f.targets.length > 0) {
      targetCandidates = f.targets.map(findTarget);
    } else if (set.list.length === 1) {
      targetCandidates = [set.list[0]!];
    } else {
      throw new FeatureError(t('feature.moveCopyNoTargets'));
    }

    const dx = f.dx !== undefined && f.dx.trim() !== '' ? evalLength(f.dx) : 0;
    const dy = f.dy !== undefined && f.dy.trim() !== '' ? evalLength(f.dy) : 0;
    const dz = f.dz !== undefined && f.dz.trim() !== '' ? evalLength(f.dz) : 0;
    const angle = f.rotationAngle !== undefined && f.rotationAngle.trim() !== '' ? evalAngle(f.rotationAngle) : 0;

    if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz) || !Number.isFinite(angle)) {
      throw new FeatureError(t('feature.moveCopyInvalidInput'));
    }

    let matrix: number[];
    if (Math.abs(angle) > 1e-9) {
      let axis: Axis3;
      if (f.rotationAxis === 'x') {
        axis = { origin: [0, 0, 0], dir: [1, 0, 0] };
      } else if (f.rotationAxis === 'y') {
        axis = { origin: [0, 0, 0], dir: [0, 1, 0] };
      } else if (f.rotationAxis === 'z' || !f.rotationAxis) {
        axis = { origin: [0, 0, 0], dir: [0, 0, 1] };
      } else if (typeof f.rotationAxis === 'object') {
        axis = this.axisOfRef(f.rotationAxis, set, t('feature.moveCopyAxis'));
      } else {
        axis = { origin: [0, 0, 0], dir: [0, 0, 1] };
      }

      const len = Math.hypot(...axis.dir);
      if (len < 1e-9) throw new FeatureError(t('feature.moveCopyNoAxis'));
      const ux = axis.dir[0] / len;
      const uy = axis.dir[1] / len;
      const uz = axis.dir[2] / len;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const v = 1 - c;

      const r00 = c + ux * ux * v;
      const r01 = ux * uy * v - uz * s;
      const r02 = ux * uz * v + uy * s;

      const r10 = uy * ux * v + uz * s;
      const r11 = c + uy * uy * v;
      const r12 = uy * uz * v - ux * s;

      const r20 = uz * ux * v - uy * s;
      const r21 = uz * uy * v + ux * s;
      const r22 = c + uz * uz * v;

      const ox = axis.origin[0];
      const oy = axis.origin[1];
      const oz = axis.origin[2];

      const rox = r00 * ox + r01 * oy + r02 * oz;
      const roy = r10 * ox + r11 * oy + r12 * oz;
      const roz = r20 * ox + r21 * oy + r22 * oz;

      const tx = ox - rox + dx;
      const ty = oy - roy + dy;
      const tz = oz - roz + dz;

      matrix = [
        r00, r01, r02, tx,
        r10, r11, r12, ty,
        r20, r21, r22, tz,
      ];
    } else {
      matrix = [
        1, 0, 0, dx,
        0, 1, 0, dy,
        0, 0, 1, dz,
      ];
    }

    const made: ShapeId[] = [];
    const transformedMap = new Map<BodyState, BodyState>();

    try {
      let copyIndex = 1;
      for (const target of targetCandidates) {
        const newShape = k.transformed(target.shape, matrix);
        made.push(newShape);
        const topology = k.topology(newShape);

        if (f.copy) {
          const bodyId = targetCandidates.length === 1 ? `${f.id}#copy` : `${f.id}#copy${copyIndex++}`;
          const copyNames: ElementNames = {
            faces: target.names.faces.map((n) => `${f.id}:copy:${n}`),
            edges: target.names.edges.map((n) => `${f.id}:copy:${n}`),
            vertices: target.names.vertices.map((n) => `${f.id}:copy:${n}`),
          };
          transformedMap.set(target, {
            id: bodyId,
            shape: newShape,
            topology,
            names: copyNames,
            by: f.id,
            ...(target.surface ? { surface: true } : {}),
          });
        } else {
          transformedMap.set(target, {
            id: target.id,
            shape: newShape,
            topology,
            names: target.names,
            by: f.id,
            ...(target.surface ? { surface: true } : {}),
          });
        }
      }

      this.info = t(f.copy ? 'feature.moveCopyInfoCopy' : 'feature.moveCopyInfoMove', {
        dx: dx.toFixed(2),
        dy: dy.toFixed(2),
        dz: dz.toFixed(2),
        angle: ((angle * 180) / Math.PI).toFixed(1),
      });

      if (f.copy) {
        const copies = [...transformedMap.values()];
        return [...set.list, ...copies];
      } else {
        return set.list.map((b) => transformedMap.get(b) ?? b);
      }
    } catch (e) {
      for (const s of made) k.release(s);
      throw e;
    }
  }

  /** 「刪除/保留本體」 (C7.3, ADR 0165): deletes or keeps specified bodies. */
  private deleteKeepBody(f: DeleteKeepBodyFeature, set: Bodies): BodyState[] {
    if (!f.targets || f.targets.length === 0) {
      throw new FeatureError(t('feature.deleteKeepNeedsTargets'));
    }

    const targetNames = new Set(f.targets.map((r) => r.name).filter(Boolean));
    if (targetNames.size === 0) {
      throw new FeatureError(t('feature.deleteKeepNeedsTargets'));
    }

    const mode = f.mode ?? 'delete';
    let remaining: BodyState[];

    if (mode === 'delete') {
      remaining = set.list.filter((b) => !targetNames.has(b.id));
      const deletedCount = set.list.length - remaining.length;
      this.info = t('feature.deleteBodyInfo', { count: deletedCount });
    } else {
      remaining = set.list.filter((b) => targetNames.has(b.id));
      this.info = t('feature.keepBodyInfo', { count: remaining.length });
    }

    return remaining;
  }

  // ------------------------------------------------------------------ imported bodies (F2.1)

  /**
   * The solids of an imported file, each a body (and merged with the bodies it touches unless `merge` says not to). Their
   * faces are named `<feature>:f<k>` by the order the file gives them, so the same file always names them the same.
   */
  private importedBody(f: ImportedBodyFeature, doc: PartDoc, set: Bodies): BodyState[] {
    const blob = doc.blobs.find((b) => b.id === f.blob);
    if (!blob) throw new FeatureError(t('regen.importMissing'));
    const key = importKey(blob.sha256, f.sewTolerance);
    let imported = this.imports.get(key);
    if (!imported) {
      const data = this.blobs.get(blob.sha256);
      if (!data) throw new FeatureError(t('regen.importNotInFile'));
      try {
        const options = f.sewTolerance === undefined ? {} : { sewTolerance: evalLength(f.sewTolerance) };
        const r = blob.kind === 'iges' ? this.kernel.importIges(data, options) : this.kernel.importStep(data, options);
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

  /**
   * A body of another part file (C7.5): the master is rebuilt, the body taken out by its id and cloned, and the clone keeps the names the master's
   * elements have. The body is the derived part's own, named by this feature, and it does not merge with the others.
   */
  private derivedBody(f: DerivedBodyFeature, set: Bodies): BodyState[] {
    if (!this.sources) throw new FeatureError(t('regen.derivedNoSources'));
    const src = this.sources.get(f.source);
    if (!src) throw new FeatureError(t('regen.derivedSourceMissing', { path: f.source }));
    if (this.trail.includes(src.key)) throw new FeatureError(t('regen.derivedCycle', { path: f.source }));
    this.mastersUsed.add(src.key);
    let master = this.masters.get(src.key);
    if (!master || master.doc !== src.doc) {
      master?.regen.dispose();
      const regen = new Regenerator(this.kernel, this.solver, src.blobs, src.sources, [...this.trail, src.key]);
      master = { doc: src.doc, regen, result: regen.rebuild(src.doc) };
      this.masters.set(src.key, master);
    }
    const { result } = master;
    const info = result.bodies.find((b) => b.id === f.body);
    if (!info || !result.body) {
      throw new FeatureError(t('regen.derivedBodyMissing', { body: f.body, bodies: result.bodies.map((b) => b.id).join(', ') || t('regen.derivedNoBodies') }));
    }
    const shape = this.kernel.clone(info.shape);
    const topology = this.kernel.topology(shape);
    if (topology.faces.length !== info.faces || topology.edges.length !== info.edges || topology.vertices.length !== info.vertices) {
      this.kernel.release(shape);
      throw new FeatureError(t('regen.internal', { why: `derived body ${f.body}: the copy has other elements than the master's body` }));
    }
    const view = result.body.names;
    const names: ElementNames = {
      faces: view.faces.slice(info.face0, info.face0 + info.faces),
      edges: view.edges.slice(info.edge0, info.edge0 + info.edges),
      vertices: view.vertices.slice(info.vertex0, info.vertex0 + info.vertices),
    };
    this.inherited.set(f.id, { name: info.name, reference: info.reference });
    return [...set.list, { id: f.id, shape, topology, names, by: f.id, ...(info.surface ? { surface: true } : {}) }];
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
        this.noteFingerprint(r.via, t('regen.edgeNoun'), body.names.edges[r.index]!);
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
  private perBody(set: Bodies, refs: Ref[], kind: 'face' | 'edge', none: string, lost: (n: number, unresolved: Unresolved[]) => string, edit: (body: BodyState, mine: Ref[]) => BodyState): BodyState[] {
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
      // a list may hold edges and faces (a fillet of the edges of a face): each is looked for as what it is
      const of: 'face' | 'edge' = ref.kind === 'face' ? 'face' : ref.kind === 'edge' ? 'edge' : kind;
      // Among all the bodies a name may be shared (the pieces of a split face); the body alone then finds it by name.
      this.noteFingerprint(r.via, of === 'edge' ? t('regen.edgeNoun') : t('edit.faceNoun'), view.names[of === 'edge' ? 'edges' : 'faces'][r.index]!);
      const { body } = set.locate(of, r.index);
      owners.set(body, [...(owners.get(body) ?? []), ref]);
    }
    if (unresolved.length > 0) throw new FeatureError(lost(unresolved.length, unresolved), unresolved);
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
    if (!validThreadTolerance(f.toleranceClass, f.kind === 'tapped' ? f.size : undefined, 'internal')) throw new FeatureError(t('cmd.badThreadTolerance'));
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
    } else if (f.kind === 'dowel') {
      // a dowel pin hole (4a-3): made at its nominal diameter, which has to be one the fit tables cover, with a 45° chamfer at the entrance if asked
      const nominal = R * 2;
      if (!(nominal >= DOWEL_RANGE.min - 1e-9 && nominal <= DOWEL_RANGE.max + 1e-9)) throw new FeatureError(t('feature.holeDowelRange', { min: DOWEL_RANGE.min, max: DOWEL_RANGE.max }));
      const c = f.chamfer === undefined ? 0 : evalLength(f.chamfer);
      if (c > 0) {
        if (c >= R || c >= depth) throw new FeatureError(t('feature.holeDowelChamfer'));
        step(R + c, -lead, 'top');
        step(R + c, 0, 'above');
        step(R, c, 'cone');
      } else {
        step(R, -lead, 'top');
      }
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
  /**
   * 「螺柱」 (C4.11, ADR 0080): at each free point of the sketch a column turned about its axis (as the hole wizard turns its tool): from a little below the sketch plane (so that
   * it runs into the body it stands on and joins), up the outside wall (leaning in by `draft`), across the top, down the pilot hole to its bottom, and back to the axis.
   * Round it, if asked, the gussets: a triangle in the plane through the axis, from the wall out along the floor, `thickness` thick about that plane, `count` of them evenly
   * from `angle`. Each is joined to the bodies like a boss; a column that joins nothing is an error. The faces are named by the point and the part of the profile:
   * `<feature>:side:<sketch>.<point>.wall` (`top`, `hole`, `bottom`), and `….rib<k>.<edge>` for a gusset.
   */
  private screwBoss(f: ScrewBossFeature, sketches: RebuildResult['sketches'], set: Bodies): BodyState[] {
    const s = sketches.get(f.sketch);
    if (!s) throw new FeatureError(t('feature.sketchGone'));
    if (!set.view) throw new FeatureError(t('feature.needsBody', { what: t('feature.screwBoss') }));
    const used = new Set(s.sketch.entities.flatMap((e) => (e.type === 'line' ? [e.p1, e.p2] : e.type === 'circle' ? [e.center] : e.type === 'arc' ? [e.center, e.start, e.end] : [])));
    const points = s.sketch.entities.flatMap((e) => (e.type === 'point' && !e.construction && !used.has(e.id) && s.solved.geometry.get(e.id)?.type === 'point' ? [{ id: e.id, at: (s.solved.geometry.get(e.id) as { p: [number, number] }).p }] : []));
    if (points.length === 0) throw new FeatureError(t('feature.holeNoPoints'));
    const n = s.frame.normal;
    const up: Vec3 = f.reverse ? [-n[0], -n[1], -n[2]] : n;
    const R = evalLength(f.diameter) / 2;
    const rh = evalLength(f.holeDiameter) / 2;
    const height = evalLength(f.height);
    const depth = f.holeDepth === undefined ? height : evalLength(f.holeDepth);
    const lean = f.draft === undefined ? 0 : Math.tan(evalAngle(f.draft));
    const top = R - height * lean;
    if (!(rh > 0) || !(R > rh)) throw new FeatureError(t('boss.holeTooWide'));
    if (depth > height + 1e-9) throw new FeatureError(t('boss.holeTooDeep'));
    if (!(top > rh + 1e-6)) throw new FeatureError(t('boss.draftTooMuch'));
    const sink = 0.5; // the column starts this far below the plane, inside the body it stands on
    const bottom = height - depth;
    // the pilot hole narrows toward its bottom by `holeDraft` (rh is its radius at the opening)
    const rhBottom = f.holeDraft === undefined ? rh : rh - depth * Math.tan(evalAngle(f.holeDraft));
    if (!(rhBottom > 1e-6)) throw new FeatureError(t('boss.holeDraftTooMuch'));
    const profile: [number, number][] = [[0, -sink], [R, -sink], [R, 0], [top, height], [rh, height], [rhBottom, bottom], [0, bottom]];
    const names = ['base', 'foot', 'wall', 'top', 'hole', 'bottom', 'axis'];
    const turn = (profile: [number, number][], edge: string[], id: string, origin: Vec3, x: Vec3) => {
      const plane: PlaneFrame = { origin, xDir: x, yDir: up, normal: cross(x, up) };
      const area = profile.reduce((a, p, i) => a + (p[0] * profile[(i + 1) % profile.length]![1] - profile[(i + 1) % profile.length]![0] * p[1]), 0);
      const loop = profile.map((a, i) => ({ kind: 'line' as const, a, b: profile[(i + 1) % profile.length]!, source: `${id}.${edge[i]!}` }));
      return { plane, outer: area >= 0 ? loop : loop.map((l) => ({ ...l, a: l.b, b: l.a })).reverse() };
    };
    const count = f.ribs ? Math.round(evalNumber(f.ribs.count)) : 0;
    if (f.ribs && (!Number.isInteger(count) || count < 1 || count > 8)) throw new FeatureError(t('boss.ribCount'));
    const ribHeight = f.ribs ? evalLength(f.ribs.height) : 0;
    if (f.ribs && ribHeight > height + 1e-9) throw new FeatureError(t('boss.ribTooHigh'));
    let list: readonly BodyState[] = set.list;
    const join = (tool: OpResult) => {
      const before = list.length;
      list = this.apply(f.id, 'boss', tool, { featureId: f.id, sketchId: f.sketch }, list, true);
      if (list.length > before) throw new FeatureError(t('boss.floating'));
    };
    for (const pt of points) {
      const origin = add(add(s.frame.origin, s.frame.xDir, pt.at[0]), s.frame.yDir, pt.at[1]);
      const column = turn(profile, names, pt.id, origin, s.frame.xDir);
      join(this.kernel.revolve(column.plane, [{ outer: column.outer, holes: [] }], { origin, dir: up }, 2 * Math.PI));
      if (!f.ribs) continue;
      const thickness = evalLength(f.ribs.thickness);
      const length = evalLength(f.ribs.length);
      const start = f.ribs.angle === undefined ? 0 : evalAngle(f.ribs.angle);
      // a gusset: from inside the wall (halfway between the pilot hole and the outside) out along the floor, up the wall to its height
      const e = (R - rh) / 2;
      const gusset: [number, number][] = [[R - e, 0], [R + length, 0], [R - e, ribHeight]];
      for (let k = 0; k < count; k++) {
        const a = start + (2 * Math.PI * k) / count;
        const radial = add(add([0, 0, 0], s.frame.xDir, Math.cos(a)), s.frame.yDir, Math.sin(a));
        const frame: PlaneFrame = { origin, xDir: radial, yDir: up, normal: cross(radial, up) };
        const loop = gusset.map((p, i) => ({ kind: 'line' as const, a: p, b: gusset[(i + 1) % 3]!, source: `${pt.id}.rib${k}.${['floor', 'slope', 'wall'][i]!}` }));
        // (the two sides of a gusset are named for the point and the gusset, not just `cap`: with four of them the same name would be given twice)
        join(this.capsNamed(this.kernel.extrude(frame, [{ outer: loop, holes: [] }], add([0, 0, 0], frame.normal, thickness), -thickness / 2), `${pt.id}.rib${k}`, 'side0', 'side1'));
      }
    }
    return [...list];
  }

  /** The free points of a sketch (single points, not end points or centers of lines), where a hole, a boss, a hook or a slot goes. */
  private freePoints(s: NonNullable<ReturnType<RebuildResult['sketches']['get']>>): { id: string; at: [number, number] }[] {
    const used = new Set(s.sketch.entities.flatMap((e) => (e.type === 'line' ? [e.p1, e.p2] : e.type === 'circle' ? [e.center] : e.type === 'arc' ? [e.center, e.start, e.end] : [])));
    return s.sketch.entities.flatMap((e) => (e.type === 'point' && !e.construction && !used.has(e.id) && s.solved.geometry.get(e.id)?.type === 'point' ? [{ id: e.id, at: (s.solved.geometry.get(e.id) as { p: [number, number] }).p }] : []));
  }

  /** The caps of an extruded tool have no profile edge to be named after: they are named for the point and the part (`<sketch>.<point>.<name>`), so each one is its own. */
  private capsNamed(tool: OpResult, id: string, start: string, end: string): OpResult {
    const origins = tool.faceOrigins.map((o) => o.map((x): FaceOrigin => (x.rel === 'cap' ? { rel: 'generated', kind: 'profileEdge', source: `${id}.${x.which === 'start' ? start : end}` } : x)));
    return { shape: tool.shape, faceOrigins: origins };
  }

  /**
   * 「卡榫」 (C4.11, ADR 0081): at each free point a cantilever beam standing on the sketch plane, grown along its normal: the profile in the plane of the direction `angle` and
   * the normal is the beam (from a little below the plane, so that it joins) with the wedge of the hook at its end, swept `width` across, centered. The faces are named
   * `<feature>:side:<sketch>.<point>.<part>`: `base`, `back`, `front`, `catch` (the flat under the hook), `ramp` (the lead-in), `tip`, and `left` and `right` for the sides of the beam.
   */
  private snapHook(f: SnapHookFeature, sketches: RebuildResult['sketches'], set: Bodies): BodyState[] {
    const s = sketches.get(f.sketch);
    if (!s) throw new FeatureError(t('feature.sketchGone'));
    if (!set.view) throw new FeatureError(t('feature.needsBody', { what: t('feature.snapHook') }));
    const points = this.freePoints(s);
    if (points.length === 0) throw new FeatureError(t('feature.holeNoPoints'));
    const n = s.frame.normal;
    const up: Vec3 = f.reverse ? [-n[0], -n[1], -n[2]] : n;
    const width = evalLength(f.width);
    const thickness = evalLength(f.thickness);
    const length = evalLength(f.length);
    const hh = evalLength(f.hookHeight);
    const depth = evalLength(f.hookDepth);
    if (!(hh < length - 1e-9)) throw new FeatureError(t('hook.tooShort'));
    const a = f.angle === undefined ? 0 : evalAngle(f.angle);
    const along = add(add([0, 0, 0], s.frame.xDir, Math.cos(a)), s.frame.yDir, Math.sin(a));
    const sink = 0.5; // the beam starts this far below the plane, inside the body it stands on
    const profile: [number, number][] = [[0, -sink], [thickness, -sink], [thickness, length - hh], [thickness + depth, length - hh], [thickness, length], [0, length]];
    const edges = ['base', 'front', 'catch', 'ramp', 'tip', 'back'];
    // the window under the hook (v44): a rectangle in the body from the front of the beam to the tip of the hook and a clearance beyond, a clearance beyond each side, cut from the plane
    const windowed = f.windowDepth !== undefined;
    const clearance = f.windowClearance === undefined ? 0 : evalLength(f.windowClearance);
    const windowDepth = windowed ? evalLength(f.windowDepth!) : 0;
    const lead = 1; // the cutting tool starts this far above the plane, as for every slot
    if (windowed) {
      if (!(clearance >= 0) || !Number.isFinite(clearance)) throw new FeatureError(t('hook.windowClearance'));
      if (!(windowDepth > 0)) throw new FeatureError(t('hook.windowDepth'));
      // the tool starts `lead` above the plane: the hook's wedge must be higher than that, or the tool would run into it
      if (!(length - hh > lead + 1e-9)) throw new FeatureError(t('hook.windowLow', { lead: String(lead) }));
    }
    // the wedge is turned the way the beam is drawn (counter-clockwise in (direction, up)); `cross(along, up)` is the way it is swept across
    let list: readonly BodyState[] = set.list;
    for (const pt of points) {
      const origin = add(add(s.frame.origin, s.frame.xDir, pt.at[0]), s.frame.yDir, pt.at[1]);
      const frame: PlaneFrame = { origin, xDir: along, yDir: up, normal: cross(along, up) };
      const loop = profile.map((q, i) => ({ kind: 'line' as const, a: q, b: profile[(i + 1) % profile.length]!, source: `${pt.id}.${edges[i]!}` }));
      const tool = this.capsNamed(this.kernel.extrude(frame, [{ outer: loop, holes: [] }], add([0, 0, 0], frame.normal, width), -width / 2), pt.id, 'left', 'right');
      const before = list.length;
      list = this.apply(f.id, 'boss', tool, { featureId: f.id, sketchId: f.sketch }, list, true);
      if (list.length > before) throw new FeatureError(t('hook.floating'));
      if (windowed) {
        // looking along the way of the cut (against the sketch normal, or with it when the hook is reversed), `across` is cross(down, along) as for the slots
        const down: Vec3 = f.reverse ? n : [-n[0], -n[1], -n[2]];
        const across = cross(down, along);
        const x0 = thickness;
        const x1 = thickness + depth + clearance;
        const y = width / 2 + clearance;
        const id = `${pt.id}.win`;
        const part = (what: string) => `${id}.${what}`;
        const win = [
          { kind: 'line' as const, a: [x0, -y] as [number, number], b: [x1, -y] as [number, number], source: part('ylo') },
          { kind: 'line' as const, a: [x1, -y] as [number, number], b: [x1, y] as [number, number], source: part('xhi') },
          { kind: 'line' as const, a: [x1, y] as [number, number], b: [x0, y] as [number, number], source: part('yhi') },
          { kind: 'line' as const, a: [x0, y] as [number, number], b: [x0, -y] as [number, number], source: part('xlo') },
        ];
        const wframe: PlaneFrame = { origin: add(origin, down, -lead), xDir: along, yDir: across, normal: down };
        const cutter = this.capsNamed(this.kernel.extrude(wframe, [{ outer: win, holes: [] }], add([0, 0, 0], down, windowDepth + lead), 0), id, 'lid', 'floor');
        try {
          list = this.apply(f.id, 'cut', cutter, { featureId: f.id, sketchId: f.sketch }, list, false);
        } catch (e) {
          if (e instanceof FeatureError) throw new FeatureError(t('hook.windowMissed', { id: pt.id }));
          throw e;
        }
      }
    }
    return [...list];
  }

  /**
   * 「卡榫的窗」 and 「排氣口」 (C4.11, ADR 0081): at each free point a row of `count` slots (one for the window), each a rectangle `length` long along the direction `angle` and
   * `width` across it, or with round ends, centered on the point and spaced `pitch` across, cut `depth` from the sketch plane against its normal. The tool starts a little
   * above the plane for a clean cut. Named `<feature>:side:<sketch>.<point>.s<k>.<part>`: `xlo`, `xhi` (the ends), `ylo`, `yhi` (the sides), and `floor` (the bottom of a blind slot).
   */
  private cutSlots(f: SnapCatchFeature | VentFeature, sketches: RebuildResult['sketches'], set: Bodies): BodyState[] {
    const what = t(f.type === 'vent' ? 'feature.vent' : 'feature.snapCatch');
    const s = sketches.get(f.sketch);
    if (!s) throw new FeatureError(t('feature.sketchGone'));
    if (!set.view) throw new FeatureError(t('feature.needsBody', { what }));
    const points = this.freePoints(s);
    if (points.length === 0) throw new FeatureError(t('feature.holeNoPoints'));
    const n = s.frame.normal;
    const down: Vec3 = f.reverse ? n : [-n[0], -n[1], -n[2]];
    const length = evalLength(f.length);
    const width = evalLength(f.width);
    const depth = evalLength(f.depth);
    const vent = f.type === 'vent';
    const count = vent ? Math.round(evalNumber(f.count)) : 1;
    const pitch = vent ? evalLength(f.pitch) : 0;
    const rounded = vent && !!f.rounded;
    if (vent && (!Number.isInteger(count) || count < 1 || count > 50)) throw new FeatureError(t('slots.count'));
    if (vent && count > 1 && !(pitch > width + 1e-9)) throw new FeatureError(t('slots.pitch'));
    if (rounded && !(length > width + 1e-9)) throw new FeatureError(t('slots.rounded'));
    const a = f.angle === undefined ? 0 : evalAngle(f.angle);
    const along = add(add([0, 0, 0], s.frame.xDir, Math.cos(a)), s.frame.yDir, Math.sin(a));
    const across = cross(down, along); // right-handed with the way of the cut: along × across = down
    const lead = 1;
    const hx = length / 2;
    const hy = width / 2;
    const r = hy;
    const x = hx - r;
    const outline = (src: (part: string) => string) =>
      rounded
        ? [
            { kind: 'line' as const, a: [-x, -hy] as [number, number], b: [x, -hy] as [number, number], source: src('ylo') },
            { kind: 'arc' as const, c: [x, 0] as [number, number], r, from: [x, -hy] as [number, number], to: [x, hy] as [number, number], ccw: true, source: src('xhi') },
            { kind: 'line' as const, a: [x, hy] as [number, number], b: [-x, hy] as [number, number], source: src('yhi') },
            { kind: 'arc' as const, c: [-x, 0] as [number, number], r, from: [-x, hy] as [number, number], to: [-x, -hy] as [number, number], ccw: true, source: src('xlo') },
          ]
        : [
            { kind: 'line' as const, a: [-hx, -hy] as [number, number], b: [hx, -hy] as [number, number], source: src('ylo') },
            { kind: 'line' as const, a: [hx, -hy] as [number, number], b: [hx, hy] as [number, number], source: src('xhi') },
            { kind: 'line' as const, a: [hx, hy] as [number, number], b: [-hx, hy] as [number, number], source: src('yhi') },
            { kind: 'line' as const, a: [-hx, hy] as [number, number], b: [-hx, -hy] as [number, number], source: src('xlo') },
          ];
    let list: readonly BodyState[] = set.list;
    for (const pt of points) {
      const center = add(add(s.frame.origin, s.frame.xDir, pt.at[0]), s.frame.yDir, pt.at[1]);
      for (let k = 0; k < count; k++) {
        const origin = add(add(center, across, (k - (count - 1) / 2) * pitch), down, -lead);
        const frame: PlaneFrame = { origin, xDir: along, yDir: across, normal: down };
        const id = `${pt.id}.s${k}`;
        const tool = this.capsNamed(this.kernel.extrude(frame, [{ outer: outline((part) => `${id}.${part}`), holes: [] }], add([0, 0, 0], down, depth + lead), 0), id, 'lid', 'floor');
        try {
          list = this.apply(f.id, 'cut', tool, { featureId: f.id, sketchId: f.sketch }, list, false);
        } catch (e) {
          if (e instanceof FeatureError) throw new FeatureError(t('slots.missed', { id: pt.id }));
          throw e;
        }
      }
    }
    return [...list];
  }

  /**
   * 「基材凸緣」 (C11.1, ADR 0084): the first feature of a sheet metal part, which also records its parameters. A closed profile is a plate grown `thickness` along the sketch
   * normal. An open profile (a polyline) is rounded at its corners (`bentPath`: the inside of every bend has the radius asked for), thickened to one side
   * (`ribbonOf`) and extruded `depth` wide; every bend is recorded (`SheetBend`) with its allowance, and the length of the flat pattern along the profile is the straight
   * pieces plus the allowances. The faces are named `<feature>:side:<sketch>.<line>` for a flat face of the path and `….<line>_l` (`_r`) for its other face,
   * `….bend<k>` and `….bend<k>_l` for the two faces of a bend, `….<line>_s` and `_e` for the ends of the sheet, `<feature>:cap:start` and `:end` for the two sides.
   */
  private baseFlange(f: BaseFlangeFeature, sketches: RebuildResult['sketches'], set: Bodies): BodyState[] {
    const s = sketches.get(f.sketch);
    if (!s) throw new FeatureError(t('feature.sketchGone'));
    if (this.sheet) throw new FeatureError(t('sheet.second'));
    const T = evalLength(f.thickness);
    const r = evalLength(f.radius);
    const k = evalNumber(f.kFactor);
    if (!(k >= 0 && k <= 1)) throw new FeatureError(t('sheet.kRange'));
    const n = s.frame.normal;
    const dir: Vec3 = f.reverse ? [-n[0], -n[1], -n[2]] : n;
    const found = findOutlines(s.sketch, s.solved);
    if (found.problems.length > 0) throw new FeatureError(found.problems.join(t('cmd.listSeparator')));
    const open = found.chains.length > 0;
    if (open && (found.chains.length !== 1 || found.loops.length > 0)) throw new FeatureError(t('flange.oneOutline'));
    const sheet: SheetInfo = { thickness: T, radius: r, kFactor: k, bends: [], flanges: [], midBends: [], cuts: [], base: null, flatLength: null };
    let tool: OpResult;
    if (!open) {
      if (s.profiles.problems.length > 0) throw new FeatureError(t('regen.sketchUnusable', { problems: s.profiles.problems.join('; ') }));
      if (s.profiles.regions.length === 0) throw new FeatureError(t('regen.noClosedProfile'));
      tool = this.kernel.extrude(s.frame, s.profiles.regions, add([0, 0, 0], dir, T), 0);
      sheet.base = { kind: 'plate', frame: s.frame, regions: s.profiles.regions as Region[], dir };
      this.info = t('flange.infoPlate', { t: String(T), r: String(r), k: String(k) });
    } else {
      if (f.depth === undefined) throw new FeatureError(t('flange.needsDepth'));
      const width = evalLength(f.depth);
      const side = f.flipSide ? 'right' : 'left';
      try {
        const bent = bentPath(found.chains[0]!, r, T, side);
        const region = ribbonOf(bent.path, side === 'left' ? { inward: T, outward: 0 } : { inward: 0, outward: T });
        tool = this.kernel.extrude(s.frame, [region], add([0, 0, 0], dir, width), 0);
        // a path that crosses itself makes a sheet that passes through itself: it is said, not made
        if (!this.kernel.isValid(tool.shape)) {
          this.kernel.release(tool.shape);
          throw new FeatureError(t('flange.selfCrossing'));
        }
        for (const b of bent.bends) sheet.bends.push({ feature: f.id, name: b.source, angle: b.angle, radius: r, thickness: T, width, kFactor: k, allowance: b.angle * (r + k * T) });
        const allowance = sheet.bends.reduce((a, b) => a + b.allowance, 0);
        sheet.flatLength = bent.straight + allowance;
        const pieces: Extract<SheetBase, { kind: 'bent' }>['pieces'] = [];
        let bendIndex = 0;
        for (const seg of bent.path) {
          if (seg.kind === 'line') pieces.push({ type: 'straight', length: Math.hypot(seg.b[0] - seg.a[0], seg.b[1] - seg.a[1]) });
          else pieces.push({ type: 'bend', bend: bendIndex, toward: bent.bends[bendIndex++]!.left === (side === 'left') });
        }
        const straights: Extract<SheetBase, { kind: 'bent' }>['straights'] = [];
        let flatAt = 0;
        let arcs = 0;
        for (const seg of bent.path) {
          if (seg.kind === 'line') {
            straights.push({ a: seg.a, b: seg.b, at: flatAt });
            flatAt += Math.hypot(seg.b[0] - seg.a[0], seg.b[1] - seg.a[1]);
          } else flatAt += sheet.bends[arcs++]!.allowance;
        }
        sheet.base = { kind: 'bent', frame: s.frame, width, flatLength: sheet.flatLength, pieces, side, dir, straights };
        this.info = t('flange.infoOpen', { flat: sheet.flatLength.toFixed(3), straight: bent.straight.toFixed(3), n: String(sheet.bends.length), allowance: allowance.toFixed(3), t: String(T), r: String(r), k: String(k) });
      } catch (e) {
        if (e instanceof BendProblem || e instanceof ThinProblem) throw new FeatureError(e.message);
        throw e;
      }
    }
    const out = this.apply(f.id, 'boss', tool, { featureId: f.id, sketchId: f.sketch }, set.list, true);
    if (sheet.base?.kind === 'plate' && out.length === 1) {
      const shape = this.kernel.copy(out[0]!.shape);
      this.owned.push(shape);
      sheet.mapping = { active: false, frame: sheet.base.frame, panels: [{ shape, toFlat: SHEET_IDENTITY, unfolds: {} }], zones: [], curves: [], order: [], bends: [], notIncluded: [] };
    }
    this.sheet = sheet;
    return out;
  }

  private moveSheetFlanges(sheet: SheetInfo, moving: ShapeId, motion: SheetRigid): void {
    for(const f of sheet.flanges){
      const g=f.fold;
      const point=add(add(add(g.origin2,g.e,(g.pa+g.pb)/2),g.d,f.straight/2),g.m2,(g.ylo+g.yhi)/2);
      if(this.kernel.classify(moving,[point],1e-6)[0]==='out')continue;
      for(const key of ['mid','origin','center','origin2'] as const)g[key]=sheetPoint(motion,g[key]);
      for(const key of ['axis','e','o','m','d','m2'] as const)g[key]=sheetVector(motion,g[key]);
    }
  }

  private sheetState(f: Extract<Feature, { type: 'sheetUnfold' | 'sheetRefold' }>, set: Bodies): BodyState[] {
    const sheet = this.sheet;
    if (!sheet?.mapping || set.list.length !== 1 || set.list[0]!.surface) throw new FeatureError(t('sheetState.needsMappedSheet'));
    const k = this.kernel;
    const current = set.list[0]!;
    const own = (shape: ShapeId) => { this.owned.push(shape); return shape; };
    if (f.type === 'sheetUnfold') {
      if (sheet.unfolding) throw new FeatureError(t('sheetState.alreadyFlat'));
      if (sheet.mapping.notIncluded.length) throw new FeatureError(t('sheetState.bendCut'));
      const selected=f.bends??sheet.mapping.order??[];
      if(selected.some(id=>!sheet.mapping!.order?.includes(id)))throw new FeatureError(t('sheetCurve.badSelection'));
      const unfolded=unfoldSheetPieces(k,sheet.mapping,selected,own);
      const blank=unfolded.shape;
      const shape = k.copy(blank);
      const topology = k.topology(shape);
      const names = nameElements(topology.faces.map((_, index) => [{ rel: 'imported' as const, index }]), topology, { featureId: f.id });
      sheet.unfolding = { feature: f.id, folded: own(k.copy(current.shape)), names: current.names, blank, current: blank, pieces:unfolded.pieces, partial:selected.length!==(sheet.mapping.order?.length??0) };
      sheet.mapping.active = true;
      return [{ ...current, shape, topology, names, by: f.id }];
    }
    const session = sheet.unfolding;
    if (!session || session.feature !== f.unfold) throw new FeatureError(t('sheetState.noUnfold'));
    const removed = own(k.boolean('cut', session.blank, current.shape).shape);
    const extra = own(k.boolean('cut', current.shape, session.blank).shape);
    if (k.massProps(extra).volume > 1e-7) throw new FeatureError(t('sheetState.cutOnly'));
    const volume = k.massProps(removed).volume;
    let mapped = 0;
    const tools: ShapeId[] = [];
    const flatCuts: {shape:ShapeId; zone?:number}[]=[];
    for (const piece of session.pieces) {
      const portion = own(k.boolean('common', removed, piece.shape).shape);
      const v = k.massProps(portion).volume;
      if (v <= 1e-8) continue;
      if(piece.foldedCurve)throw new FeatureError(t('sheetCurve.notUnfolded'));
      mapped += v;
      flatCuts.push({shape:own(k.transformed(portion,sheetRows(piece.toFlat))),zone:piece.zone});
      tools.push(piece.curve?own(k.bendSheetMaterial(portion,piece.curve).shape):own(k.transformed(portion,sheetRows(piece.toFolded))));
    }
    if (Math.abs(mapped - volume) > 1e-6 * Math.max(1, volume)) throw new FeatureError(t('sheetState.bendCut'));
    const shape = own(k.copy(session.folded));
    let list: BodyState[] = [{ ...current, shape, topology: k.topology(shape), names: session.names, by: f.id }];
    for (const tool of tools) {
      if (!this.owned.includes(list[0]!.shape)) this.owned.push(list[0]!.shape);
      const topology = k.topology(tool);
      list = this.apply(f.id, 'cut', { shape: k.copy(tool), faceOrigins: topology.faces.map((_,index) => [{ rel:'imported' as const,index }]) }, { featureId: f.id }, list, false);
    }
    for (const body of list) if (!this.owned.includes(body.shape)) this.owned.push(body.shape);
    if (list.length !== 1 || !k.isValid(list[0]!.shape) || k.solidCount(list[0]!.shape) !== 1) throw new FeatureError(t('sheetMapping.invalidFlat'));
    const expectedRemoval=tools.reduce((sum,tool)=>sum+k.massProps(tool).volume,0);
    const actualRemoval=k.massProps(session.folded).volume-k.massProps(list[0]!.shape).volume;
    if(Math.abs(expectedRemoval-actualRemoval)>1e-6*Math.max(1,expectedRemoval))throw new FeatureError(t('sheetCurve.buildFailed'));
    // Each planar patch keeps its manufacturing transform; only the cut-away material changes.
    sheet.mapping.panels = sheetClipPanels(k, sheet.mapping.panels, list[0]!.shape, own);
    for(const [index,curve] of (sheet.mapping.curves??[]).entries()){
      for(const cut of flatCuts.filter(c=>c.zone===index))curve.flat=own(k.boolean('cut',curve.flat,cut.shape).shape);
      curve.folded=own(k.boolean('common',curve.folded,list[0]!.shape).shape);
    }
    sheet.mapping.zones=(sheet.mapping.curves??[]).map(c=>c.flat);
    delete sheet.unfolding;
    const ownedResult = this.owned.indexOf(list[0]!.shape);
    if (ownedResult >= 0) this.owned.splice(ownedResult, 1);
    return list;
  }

  /**
   * 「中間折彎」 (S-3, ADR 0111): the plate bent along the line of a sketch. The plate is cut by two planes `BA` (the bend allowance) apart, the line between them: the side that stays,
   * the zone, and the side that turns. The zone must be a plain strip (its section a rectangle the thickness thick and as wide as the plate along the line: the volume says so), and
   * is made again as the section revolved about the axis of the bend, `radius` from the face the plate folds toward. The side that turns is slid up to the start of the zone and turned
   * about the same axis (a rigid motion: its faces keep their order, so they keep their names); the three are fused. The result is checked against the volumes of the three pieces.
   */
  private midBend(f: MidBendFeature, sketches: RebuildResult['sketches'], set: Bodies): BodyState[] {
    const sheet = this.sheet;
    if (!sheet) throw new FeatureError(t('flange.needsSheet'));
    if (sheet.base?.kind !== 'plate' || !sheet.mapping) throw new FeatureError(t('midBend.scope'));
    const solids = set.list.filter((b) => !b.surface);
    if (solids.length !== 1) throw new FeatureError(t('midBend.oneBody'));
    const plate = solids[0]!;
    const s = sketches.get(f.sketch);
    if (!s) throw new FeatureError(t('feature.sketchGone'));
    const found = findOutlines(s.sketch, s.solved);
    if (found.problems.length > 0) throw new FeatureError(found.problems.join(t('cmd.listSeparator')));
    const line = found.chains.length === 1 && found.loops.length === 0 && found.chains[0]!.length === 1 ? found.chains[0]![0]! : null;
    if (line?.kind !== 'line') throw new FeatureError(t('midBend.oneLine', { n: String(found.chains.length + found.loops.length) }));
    const T = sheet.thickness;
    const rb = f.radius === undefined ? sheet.radius : evalLength(f.radius);
    const theta = evalAngle(f.angle);
    if (!(rb > 0) || !(theta > 1e-6 && theta < Math.PI - 0.01)) throw new FeatureError(t('flange.angleRange'));
    const BA = theta * (rb + sheet.kFactor * T);
    const k = this.kernel;
    const neg = (v: Vec3): Vec3 => [-v[0], -v[1], -v[2]];
    const at = (q: [number, number]): Vec3 => add(add(s.frame.origin, s.frame.xDir, q[0]), s.frame.yDir, q[1]);
    const a = at(line.a);
    const l = unit(sub(at(line.b), a));
    const n = s.frame.normal;
    // the plate square to the sketch normal, and as thick as the sheet
    let q = a;
    const up: Vec3 = f.reverse ? neg(n) : n;
    const left = cross(n, l);
    const p: Vec3 = f.flipSide ? left : neg(left); // from the side that stays to the side that turns
    const reach = Math.max(...plate.topology.vertices.map((v) => Math.hypot(...sub(v.point, q)))) * 2 + BA + 10;
    const ctx = { featureId: f.id, sketchId: f.sketch };
    const owned: ShapeId[] = [];
    const keep = <X extends { shape: ShapeId }>(x: X): X => {
      owned.push(x.shape);
      return x;
    };
    try {
      const strip = (u0: number, u1: number, tag: string): OpResult => {
        const fr: PlaneFrame = { origin: add(q, n, -reach), xDir: l, yDir: p, normal: cross(l, p) };
        const pts: [number, number][] = [[-reach, u0], [reach, u0], [reach, u1], [-reach, u1]];
        const region: Region = { outer: pts.map((pt, i) => ({ kind: 'line' as const, a: pt, b: pts[(i + 1) % 4]!, source: `mid.${tag}.p${i}` })), holes: [] };
        return this.capsNamed(k.extrude(fr, [region], add([0, 0, 0], n, 2 * reach), 0), `mid.${tag}`, 'start', 'end');
      };
      const piece = (u0: number, u1: number, tag: string) => {
        const cutter = strip(u0, u1, tag);
        const cutNames = nameElements(cutter.faceOrigins, k.topology(cutter.shape), ctx);
        const r = k.boolean('common', plate.shape, cutter.shape);
        k.release(cutter.shape);
        const topology = k.topology(r.shape);
        return keep({ shape: r.shape, topology, names: nameElements(r.faceOrigins, topology, { ...ctx, input: concatNames(plate.names, cutNames) }), volume: k.massProps(r.shape).volume });
      };
      const A = piece(-reach, -BA / 2, 'a');
      const Z = piece(-BA / 2, BA / 2, 'z');
      const B = piece(BA / 2, reach, 'b');
      if (!(Z.volume > 1e-9)) throw new FeatureError(t('midBend.lineOutside'));
      if (!(A.volume > 1e-9) || !(B.volume > 1e-9)) throw new FeatureError(t('midBend.noSide'));
      const heights = Z.topology.vertices.map(v => dot(v.point, n));
      const bottom = Math.min(...heights);
      if (Math.abs(Math.max(...heights) - bottom - T) > 1e-6 * (1 + T)) throw new FeatureError(t('midBend.notFlat'));
      q = add(q, n, bottom - dot(q, n));
      const along = Z.topology.vertices.map((v) => dot(sub(v.point, q), l));
      const [lo, hi] = [Math.min(...along), Math.max(...along)];
      const w = hi - lo;
      if (Math.abs(Z.volume - w * BA * T) > 1e-3 * Z.volume + 1e-6) throw new FeatureError(t('midBend.zoneNotRect'));
      const host = sheetHost(k, sheet.mapping!, k.massProps(Z.shape).center);
      // the zone made again as the bend: the section revolved about the axis, which lies `radius` from the face the plate folds toward
      const frameS: PlaneFrame = { origin: add(q, p, -BA / 2), xDir: l, yDir: n, normal: cross(l, n) };
      const rect: [number, number][] = [[lo, 0], [hi, 0], [hi, T], [lo, T]];
      const section: Region = { outer: rect.map((pt, i) => ({ kind: 'line' as const, a: pt, b: rect[(i + 1) % 4]!, source: `mid.bend.${['bot', 'e1', 'top', 'e0'][i]}` })), holes: [] };
      const center = add(add(q, p, -BA / 2), n, f.reverse ? -rb : T + rb);
      const axis = unit(cross(p, up));
      const bendOp = this.capsNamed(k.revolve(frameS, [section], { origin: center, dir: axis }, theta), 'mid.bend', 'start', 'end');
      const bendTopology = k.topology(bendOp.shape);
      const bend = keep({ shape: bendOp.shape, topology: bendTopology, names: nameElements(bendOp.faceOrigins, bendTopology, ctx), volume: k.massProps(bendOp.shape).volume });
      // the side that turns: slid up to the start of the zone, then turned about the axis of the bend (its faces keep their order, so they keep their names)
      const slide = add([0, 0, 0], p, -BA);
      const R = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map((e) => rotate(e as Vec3, axis, theta));
      const shift = add(center, rotate(sub(slide, center), axis, theta));
      const moved = k.transformed(B.shape, [R[0]![0], R[1]![0], R[2]![0], shift[0], R[0]![1], R[1]![1], R[2]![1], shift[1], R[0]![2], R[1]![2], R[2]![2], shift[2]]);
      const B2 = keep({ shape: moved, topology: k.topology(moved), names: B.names, volume: B.volume });
      if (B2.topology.faces.length !== B.names.faces.length) throw new FeatureError(t('midBend.collides'));
      const join = (x: { shape: ShapeId; names: ElementNames }, y: { shape: ShapeId; names: ElementNames }) => {
        const r = k.boolean('fuse', x.shape, y.shape);
        const topology = k.topology(r.shape);
        return keep({ shape: r.shape, topology, names: nameElements(r.faceOrigins, topology, { ...ctx, input: concatNames(x.names, y.names) }) });
      };
      const ab = join(A, bend);
      const abb = join(ab, B2);
      const volume = k.massProps(abb.shape).volume;
      const expected = A.volume + B.volume + bend.volume;
      if (k.solidCount(abb.shape) !== 1 || !k.isValid(abb.shape) || Math.abs(volume - expected) > 1e-3 * expected + 1e-6) throw new FeatureError(t('midBend.collides'));
      const motion: SheetRigid = { R: [R[0]![0], R[1]![0], R[2]![0], R[0]![1], R[1]![1], R[2]![1], R[0]![2], R[1]![2], R[2]![2]], t: shift };
      const own = (shape: ShapeId) => { this.owned.push(shape); return shape; };
      const mapping = sheet.mapping!;
      const panels = sheetSplitPanels(k, mapping, A.shape, B.shape, motion, own, f.id);
      const flatZone = own(k.transformed(Z.shape, sheetRows(host.toFlat)));
      const atFlat = (point: Vec3) => sheetPlanar(mapping.frame, sheetPoint(host.toFlat, point));
      mapping.curves = sheetMoveCurves(k, mapping, B.shape, motion, f.id, own);
      const rawMap: import('@3db/kernel').SheetBendMap = { flatOrigin: add(q,p,-BA/2), flatAcross:p, flatAlong:axis, flatNormal:n, center, axis, radial:unit(sub(add(q,p,-BA/2),center)), radiusAtZero: f.reverse ? rb : rb+T, radialSlope:f.reverse ? 1 : -1, neutralRadius:rb+sheet.kFactor*T, angle:theta };
      mapping.curves.push({feature:f.id,name:'bend',flat:flatZone,folded:own(k.copy(bend.shape)),map:sheetMapFlat(rawMap,host.toFlat),placement:sheetInverse(host.toFlat),unfolds:{...host.unfolds}});
      (mapping.order??=[]).push(f.id);
      this.moveSheetFlanges(sheet, B.shape, motion);
      mapping.panels = panels;
      mapping.zones.push(flatZone);
      mapping.bends.push({ feature: f.id, name: 'bend', a: atFlat(add(q, l, lo)), b: atFlat(add(q, l, hi)), angle: theta, radius: rb, direction: dot(sheetVector(host.toFlat, up), mapping.frame.normal) > 0 ? 'up' : 'down', kFactor: sheet.kFactor, allowance: BA });
      mapping.active = true;
      owned.splice(owned.indexOf(abb.shape), 1);
      sheet.bends.push({ feature: f.id, name: 'bend', angle: theta, radius: rb, thickness: T, width: w, kFactor: sheet.kFactor, allowance: BA });
      sheet.midBends.push({ feature: f.id, a: add(q, l, lo), b: add(q, l, hi), up, angle: theta, radius: rb, allowance: BA, q, side: p, center, axis, slide });
      this.info = t('midBend.info', { angle: ((theta * 180) / Math.PI).toFixed(1), allowance: BA.toFixed(3), width: w.toFixed(3), radius: String(rb) });
      return set.list.map((x) => (x === plate ? { id: plate.id, shape: abb.shape, topology: abb.topology, names: abb.names, by: f.id } : x));
    } finally {
      for (const id of owned) k.release(id);
    }
  }

  private jog(f: JogFeature, sketches: RebuildResult['sketches'], set: Bodies): BodyState[] {
    const sheet = this.sheet;
    if (!sheet) throw new FeatureError(t('flange.needsSheet'));
    if (sheet.base?.kind !== 'plate' || !sheet.mapping) throw new FeatureError(t('jog.scope'));
    const solids = set.list.filter((b) => !b.surface);
    if (solids.length !== 1) throw new FeatureError(t('jog.oneBody'));
    const plate = solids[0]!;
    const s = sketches.get(f.sketch);
    if (!s) throw new FeatureError(t('feature.sketchGone'));
    const found = findOutlines(s.sketch, s.solved);
    if (found.problems.length > 0) throw new FeatureError(found.problems.join(t('cmd.listSeparator')));
    const line = found.chains.length === 1 && found.loops.length === 0 && found.chains[0]!.length === 1 ? found.chains[0]![0]! : null;
    if (line?.kind !== 'line') throw new FeatureError(t('jog.oneLine', { n: String(found.chains.length + found.loops.length) }));
    const T = sheet.thickness;
    const rb = f.radius === undefined ? sheet.radius : evalLength(f.radius);
    const theta = f.angle === undefined ? Math.PI / 2 : evalAngle(f.angle);
    const H = evalLength(f.offset);
    if (!(rb > 0) || !(theta > 1e-6 && theta < Math.PI - 0.01)) throw new FeatureError(t('flange.angleRange'));
    const Hmin = (2 * rb + T) * (1 - Math.cos(theta));
    if (H < Hmin - 1e-6) throw new FeatureError(t('jog.tooShallow', { min: Hmin.toFixed(2) }));
    const Lweb = (H - Hmin) / Math.sin(theta);
    const BA = theta * (rb + sheet.kFactor * T);
    const Lblank = 2 * BA + Lweb;
    const uEnd = (2 * rb + T) * Math.sin(theta) + Lweb * Math.cos(theta);

    const k = this.kernel;
    const neg = (v: Vec3): Vec3 => [-v[0], -v[1], -v[2]];
    const at = (q: [number, number]): Vec3 => add(add(s.frame.origin, s.frame.xDir, q[0]), s.frame.yDir, q[1]);
    const a = at(line.a);
    const l = unit(sub(at(line.b), a));
    const n = s.frame.normal;
    // the plate square to the sketch normal, and as thick as the sheet
    let q = a;
    const up: Vec3 = f.reverse ? neg(n) : n;
    const left = cross(n, l);
    const p: Vec3 = f.flipSide ? left : neg(left); // from the side that stays to the side that turns
    const reach = Math.max(...plate.topology.vertices.map((v) => Math.hypot(...sub(v.point, q)))) * 2 + Lblank + 10;
    const ctx = { featureId: f.id, sketchId: f.sketch };
    const owned: ShapeId[] = [];
    const keep = <X extends { shape: ShapeId }>(x: X): X => {
      owned.push(x.shape);
      return x;
    };
    try {
      const strip = (u0: number, u1: number, tag: string): OpResult => {
        const fr: PlaneFrame = { origin: add(q, n, -reach), xDir: l, yDir: p, normal: cross(l, p) };
        const pts: [number, number][] = [[-reach, u0], [reach, u0], [reach, u1], [-reach, u1]];
        const region: Region = { outer: pts.map((pt, i) => ({ kind: 'line' as const, a: pt, b: pts[(i + 1) % 4]!, source: `jog.${tag}.p${i}` })), holes: [] };
        return this.capsNamed(k.extrude(fr, [region], add([0, 0, 0], n, 2 * reach), 0), `jog.${tag}`, 'start', 'end');
      };
      const piece = (u0: number, u1: number, tag: string) => {
        const cutter = strip(u0, u1, tag);
        const cutNames = nameElements(cutter.faceOrigins, k.topology(cutter.shape), ctx);
        const r = k.boolean('common', plate.shape, cutter.shape);
        k.release(cutter.shape);
        const topology = k.topology(r.shape);
        return keep({ shape: r.shape, topology, names: nameElements(r.faceOrigins, topology, { ...ctx, input: concatNames(plate.names, cutNames) }), volume: k.massProps(r.shape).volume });
      };
      const A = piece(-reach, 0, 'a');
      const Z = piece(0, Lblank, 'z');
      const B = piece(Lblank, reach, 'b');
      if (!(Z.volume > 1e-9)) throw new FeatureError(t('jog.lineOutside'));
      if (!(A.volume > 1e-9) || !(B.volume > 1e-9)) throw new FeatureError(t('jog.noSide'));
      const heights = Z.topology.vertices.map(v => dot(v.point, n));
      const bottom = Math.min(...heights);
      if (Math.abs(Math.max(...heights) - bottom - T) > 1e-6 * (1 + T)) throw new FeatureError(t('jog.notFlat'));
      q = add(q, n, bottom - dot(q, n));
      const along = Z.topology.vertices.map((v) => dot(sub(v.point, q), l));
      const [lo, hi] = [Math.min(...along), Math.max(...along)];
      const w = hi - lo;
      if (Math.abs(Z.volume - w * Lblank * T) > 1e-3 * Z.volume + 1e-6) throw new FeatureError(t('jog.zoneNotRect'));
      const host = sheetHost(k, sheet.mapping!, k.massProps(Z.shape).center);

      // 2D Jog profile in (p, up) plane
      const R1 = rb + T;
      const C1: [number, number] = [0, R1];
      const Pb1: [number, number] = [R1 * Math.sin(theta), R1 * (1 - Math.cos(theta))];
      const Pw1: [number, number] = [Pb1[0] + Lweb * Math.cos(theta), Pb1[1] + Lweb * Math.sin(theta)];

      const C2: [number, number] = [uEnd, H - rb];
      const R2 = rb + T;
      const Pw2: [number, number] = [uEnd - R2 * Math.sin(theta), H - rb + R2 * Math.cos(theta)];
      const Pb2: [number, number] = [Pw2[0] - Lweb * Math.cos(theta), Pw2[1] - Lweb * Math.sin(theta)];

      const segments: Segment[] = [
        { kind: 'arc', c: C1, r: R1, from: [0, 0], to: Pb1, ccw: true, source: 'jog.b1.bot' },
      ];
      if (Lweb > 1e-6) {
        segments.push({ kind: 'line', a: Pb1, b: Pw1, source: 'jog.web.bot' });
      }
      segments.push({ kind: 'arc', c: C2, r: rb, from: Pw1, to: [uEnd, H], ccw: false, source: 'jog.b2.bot' });
      segments.push({ kind: 'line', a: [uEnd, H], b: [uEnd, H + T], source: 'jog.end' });
      segments.push({ kind: 'arc', c: C2, r: R2, from: [uEnd, H + T], to: Pw2, ccw: true, source: 'jog.b2.top' });
      if (Lweb > 1e-6) {
        segments.push({ kind: 'line', a: Pw2, b: Pb2, source: 'jog.web.top' });
      }
      segments.push({ kind: 'arc', c: C1, r: rb, from: Pb2, to: [0, T], ccw: false, source: 'jog.b1.top' });
      segments.push({ kind: 'line', a: [0, T], b: [0, 0], source: 'jog.start' });

      const jogRegion: Region = { outer: segments, holes: [] };
      const q0 = f.reverse ? add(q, n, T) : q;
      const axis = unit(cross(p, up));
      const dotL = dot(l, axis);
      const frameOrigin = dotL > 0 ? add(q0, l, lo) : add(q0, l, hi);
      const jogFrame: PlaneFrame = { origin: frameOrigin, xDir: p, yDir: up, normal: axis };
      const jogOp = this.capsNamed(k.extrude(jogFrame, [jogRegion], add([0, 0, 0], axis, w)), 'jog.mid', 'start', 'end');
      const jogTopology = k.topology(jogOp.shape);
      const jogBody = keep({ shape: jogOp.shape, topology: jogTopology, names: nameElements(jogOp.faceOrigins, jogTopology, ctx), volume: k.massProps(jogOp.shape).volume });

      // Move side B: translated by (uEnd - Lblank) along p, and H along up
      const delta = add(add([0, 0, 0], p, uEnd - Lblank), up, H);
      const moved = k.transformed(B.shape, [1, 0, 0, delta[0], 0, 1, 0, delta[1], 0, 0, 1, delta[2]]);
      const B2 = keep({ shape: moved, topology: k.topology(moved), names: B.names, volume: B.volume });
      if (B2.topology.faces.length !== B.names.faces.length) throw new FeatureError(t('jog.collides'));

      const join = (x: { shape: ShapeId; names: ElementNames }, y: { shape: ShapeId; names: ElementNames }) => {
        const r = k.boolean('fuse', x.shape, y.shape);
        const topology = k.topology(r.shape);
        return keep({ shape: r.shape, topology, names: nameElements(r.faceOrigins, topology, { ...ctx, input: concatNames(x.names, y.names) }) });
      };
      const ab = join(A, jogBody);
      const abb = join(ab, B2);
      const volume = k.massProps(abb.shape).volume;
      const expected = A.volume + B.volume + jogBody.volume;
      if (k.solidCount(abb.shape) !== 1 || !k.isValid(abb.shape) || Math.abs(volume - expected) > 1e-3 * expected + 1e-6) throw new FeatureError(t('jog.collides'));
      const own = (shape: ShapeId) => { this.owned.push(shape); return shape; };
      const mapping = sheet.mapping!;
      const motion: SheetRigid = { R: SHEET_IDENTITY.R, t: delta };
      const panels = sheetSplitPanels(k, mapping, A.shape, B.shape, motion, own, f.id);
      // The web is planar material; only the two allowance strips become curved.
      const c1 = add(q, n, f.reverse ? -rb : T + rb);
      const rotateWeb = (v: Vec3) => rotate(v, axis, theta);
      const cols = [[1,0,0],[0,1,0],[0,0,1]].map(v => rotateWeb(v as Vec3));
      const webMotion: SheetRigid = { R: [cols[0]![0],cols[1]![0],cols[2]![0],cols[0]![1],cols[1]![1],cols[2]![1],cols[0]![2],cols[1]![2],cols[2]![2]], t: add(c1, rotateWeb(sub(add([0,0,0],p,-BA),c1))) };
      if (Lweb > 1e-6) {
        const web = piece(BA, BA + Lweb, 'web');
        panels.push({ shape: own(k.transformed(web.shape, sheetRows(webMotion))), toFlat: sheetCompose(host.toFlat, sheetInverse(webMotion)), unfolds:{...sheetConjugate(webMotion,host.unfolds),[f.id]:sheetInverse(webMotion)} });
      }
      const atFlat = (point: Vec3) => sheetPlanar(mapping.frame, sheetPoint(host.toFlat, point));
      const zones = [piece(0, BA, 'z1'), piece(BA + Lweb, Lblank, 'z2')].map(z => own(k.transformed(z.shape, sheetRows(host.toFlat))));
      const forward = dot(sheetVector(host.toFlat, up), mapping.frame.normal) > 0;
      mapping.curves = sheetMoveCurves(k, mapping, B.shape, motion, f.id, own);
      for (let index=0;index<2;index++) {
        const start=index===0?q:add(q,p,BA+Lweb);
        const localMap: import('@3db/kernel').SheetBendMap={flatOrigin:start,flatAcross:p,flatAlong:index===0?axis:neg(axis),flatNormal:n,center:index===0?c1:add(add(q,p,uEnd),n,f.reverse?T-H+rb:H-rb),axis:index===0?axis:neg(axis),radial:index===0?neg(up):up,radiusAtZero:index===0?(f.reverse?rb:rb+T):(f.reverse?rb+T:rb),radialSlope:index===0?(f.reverse?1:-1):(f.reverse?-1:1),neutralRadius:rb+sheet.kFactor*T,angle:theta};
        if(index===1){
          // Second bend begins after the web, already rotated by the first bend.
          const startWorld=sheetPoint(webMotion,start);
          localMap.radial=unit(sub(startWorld,localMap.center));
        }
        const map=sheetMapFlat(localMap,host.toFlat);
        const folded=own(k.bendSheetMaterial(zones[index]!,map).shape);
        mapping.curves.push({feature:f.id,name:`bend${index+1}`,flat:zones[index]!,folded,map,placement:sheetInverse(host.toFlat),unfolds:{...host.unfolds}});
      }
      (mapping.order??=[]).push(f.id);
      this.moveSheetFlanges(sheet,B.shape,motion);
      mapping.panels = panels;
      mapping.zones.push(...zones);
      for (const [index, u] of [BA / 2, 1.5 * BA + Lweb].entries()) mapping.bends.push({ feature: f.id, name: `bend${index + 1}`, a: atFlat(add(add(q, p, u), l, lo)), b: atFlat(add(add(q, p, u), l, hi)), angle: theta, radius: rb, direction: (index === 0 ? forward : !forward) ? 'up' : 'down', kFactor: sheet.kFactor, allowance: BA });
      mapping.active = true;
      owned.splice(owned.indexOf(abb.shape), 1);

      // Register two bends to sheet: Bend 1 and Bend 2
      const q1 = add(q, p, BA / 2);
      const q2 = add(q, p, 1.5 * BA + Lweb);
      sheet.bends.push({ feature: f.id, name: 'bend1', angle: theta, radius: rb, thickness: T, width: w, kFactor: sheet.kFactor, allowance: BA });
      sheet.midBends.push({ feature: f.id, a: add(q1, l, lo), b: add(q1, l, hi), up, angle: theta, radius: rb, allowance: BA, q: q1, side: p, center: [0, 0, 0], axis, slide: delta });
      sheet.bends.push({ feature: f.id, name: 'bend2', angle: theta, radius: rb, thickness: T, width: w, kFactor: sheet.kFactor, allowance: BA });
      sheet.midBends.push({ feature: f.id, a: add(q2, l, lo), b: add(q2, l, hi), up: neg(up), angle: theta, radius: rb, allowance: BA, q: q2, side: p, center: [0, 0, 0], axis, slide: delta });

      this.info = t('jog.info', {
        offset: H.toFixed(2),
        angle: ((theta * 180) / Math.PI).toFixed(1),
        radius: String(rb),
        allowance: (2 * BA + Lweb).toFixed(3),
        width: w.toFixed(3),
      });
      return set.list.map((x) => (x === plate ? { id: plate.id, shape: abb.shape, topology: abb.topology, names: abb.names, by: f.id } : x));
    } finally {
      for (const id of owned) k.release(id);
    }
  }

  /**
   * 「邊線凸緣」 (C11.2, ADR 0085): a bend and a flange along a straight edge of the sheet. The edge is between a face of the sheet (`big`) and its end face, a strip `thickness` wide
   * (the one with the smaller area); the flange bends toward the side of the face the edge is on. The bend is the end section of the sheet revolved about the axis
   * through the centre of the bend, the flange that section moved on and extruded; with `materialInside` the sheet is first cut back by the setback of the outside virtual sharp so
   * that the outside of the flange is flush with the edge. The volumes are checked against what they should be (a strip cut from the sheet, the bend θ·T·w·(r + T/2), the
   * flange T·w·length): a flange that runs into the sheet or a sheet too short to be cut back is said, not made wrong.
   */
  private edgeFlange(f: EdgeFlangeFeature, set: Bodies): BodyState[] {
    return this.foldEdge(f, set, (sheet) => {
      const T = sheet.thickness;
      const rb = f.radius === undefined ? sheet.radius : evalLength(f.radius);
      const theta = f.angle === undefined ? Math.PI / 2 : evalAngle(f.angle);
      if (!(rb > 0) || !(theta > 1e-6 && theta < Math.PI - 0.01)) throw new FeatureError(t('flange.angleRange'));
      const L = evalLength(f.length);
      const half = Math.tan(theta / 2);
      const outerSetback = (rb + T) * half;
      const from = f.lengthFrom ?? 'outer';
      const setback = from === 'inner' ? rb * half : from === 'tangent' ? 0 : outerSetback;
      const straight = L - setback;
      if (straight < 1e-6) throw new FeatureError(t('flange.tooShort', { need: setback.toFixed(3) }));
      const trim = f.position === 'bendOutside' ? 0 : outerSetback;
      return {
        rb,
        theta,
        straight,
        trim,
        info: (allowance) => t('flange.info', { angle: ((theta * 180) / Math.PI).toFixed(1), allowance: allowance.toFixed(3), straight: straight.toFixed(3), length: String(L), from: t(from === 'inner' ? 'flange.fromInner' : from === 'tangent' ? 'flange.fromTangent' : 'flange.fromOuter'), trim: trim.toFixed(3) }),
      };
    });
  }

  /** A break corner (C11.4): trim one or more outside corners at the free end of a sheet-metal edge flange. */
  private breakCorner(f: BreakCornerFeature, set: Bodies): BodyState[] {
    const sheet = this.sheet;
    if (!sheet) throw new FeatureError(t('breakCorner.needsSheet'));
    const size = evalLength(f.size);
    if (!(size > 0) || !Number.isFinite(size)) {
      throw new FeatureError(t('breakCorner.sizeInvalid'));
    }
    return this.perBody(set, f.corners, 'edge', t('edit.noBodyForChamfer'), lostRefs, (body, mine) => {
      const { edges } = this.edgesOfRefs(mine, body);
      const topology = body.topology;
      for (const edgeIndex of edges) {
        const edge = topology.edges[edgeIndex]!;
        if (edge.curve !== 'line' || !edge.dir || Math.abs(edge.length - sheet.thickness) > 1e-4 * (1 + sheet.thickness)) {
          throw new FeatureError(t('breakCorner.unsupported'));
        }
        const faces = [...new Set(edge.faces)];
        if (faces.length !== 2) throw new FeatureError(t('breakCorner.unsupported'));
        const f0 = topology.faces[faces[0]!]!;
        const f1 = topology.faces[faces[1]!]!;
        if (f0.surface !== 'plane' || f1.surface !== 'plane' || !f0.normal || !f1.normal) {
          throw new FeatureError(t('breakCorner.unsupported'));
        }
        const eDir = unit(edge.dir);
        if (Math.abs(dot(f0.normal, eDir)) > 0.05 || Math.abs(dot(f1.normal, eDir)) > 0.05) {
          throw new FeatureError(t('breakCorner.unsupported'));
        }
        if (Math.abs(dot(f0.normal, f1.normal)) > 0.99) {
          throw new FeatureError(t('breakCorner.unsupported'));
        }
        for (const vIdx of edge.vertices) {
          for (let eIdx = 0; eIdx < topology.edges.length; eIdx++) {
            if (eIdx === edgeIndex) continue;
            const adj = topology.edges[eIdx]!;
            if (adj.vertices.includes(vIdx) && adj.curve === 'line') {
              if (adj.length <= size + 1e-6) {
                throw new FeatureError(t('breakCorner.sizeInvalid'));
              }
            }
          }
        }
        for (const flange of sheet.flanges) {
          const fold = flange.fold;
          if (Math.abs(dot(eDir, fold.m2)) > 1 - 1e-5) {
            const along = dot(sub(edge.mid, fold.origin2), fold.d);
            const across = dot(sub(edge.mid, fold.origin2), fold.e);
            if (Math.abs(along - flange.straight) <= 1e-4 * (1 + flange.straight)) {
              for (const end of [0, 1] as const) {
                const at = end === 0 ? fold.pa : fold.pb;
                if (Math.abs(across - at) <= 1e-4 * (1 + flange.width)) {
                  if (flange.miter[end] || flange.corner[end] > 1e-8) {
                    throw new FeatureError(t('breakCorner.unsupported'));
                  }
                }
              }
            }
          }
        }
      }
      let r: OpResult;
      if (f.kind === 'fillet') r = this.kernel.fillet(body.shape, edges, size);
      else {
        const specs = edges.map((edge) => {
          const faces = [...new Set(topology.edges[edge]!.faces)].sort((a, b) => (body.names.faces[a]! < body.names.faces[b]! ? -1 : 1));
          return { edge, face: faces[0]! };
        });
        r = this.kernel.chamfer(body.shape, specs, 'distanceDistance', size, size);
      }
      const result = this.edited(f, r, body);
      return result;
    });
  }

  /**
   * 「摺邊」 (C11.2, ADR 0086): a bend of 180° on an edge of the sheet and a flat piece folded back over it, `length` long after the bend, with `gap` between the two layers
   * (the inside diameter of the bend, so the inside radius is half of it). With `materialInside` the fold is flush with the edge: the sheet is cut back by the outside radius
   * of the bend. A closed hem is a small gap, not none: a bend with no inside has no shape to make.
   */
  private hem(f: HemFeature, set: Bodies): BodyState[] {
    return this.foldEdge(f, set, (sheet) => {
      const T = sheet.thickness;
      const rb = evalLength(f.gap) / 2;
      const length = evalLength(f.length);
      if (!(rb > 0) || !(length > 0)) throw new FeatureError(t('hem.sizes'));
      const trim = f.position === 'bendOutside' ? 0 : rb + T;
      return {
        rb,
        theta: Math.PI,
        straight: length,
        trim,
        info: (allowance) => t('hem.info', { allowance: allowance.toFixed(3), length: String(length), gap: String(rb * 2), trim: trim.toFixed(3) }),
      };
    });
  }

  /**
   * The bend and the flat piece on an edge of the sheet, for the edge flange and the hem: the feature says (`plan`) how far the sheet turns, the inside radius, how long the flat piece is
   * and how much of the sheet is cut back. The edge is between a face of the sheet and its end face; the piece bends toward the side of the face the edge is on (`flip`: the other).
   */
  private foldEdge(
    f: { id: Id; edge: Ref; flip?: boolean; inset?: { start: string; end: string }; relief?: { width: string; depth: string; shape?: ReliefShape }; corner?: { start?: string; end?: string }; miter?: { start?: string; end?: string } },
    set: Bodies,
    plan: (sheet: SheetInfo) => { rb: number; theta: number; straight: number; trim: number; info: (allowance: number) => string },
  ): BodyState[] {
    const sheet = this.sheet;
    if (!sheet) throw new FeatureError(t('flange.needsSheet'));
    const view = set.view;
    if (!view) throw new FeatureError(t('feature.needsBody', { what: t('feature.edgeFlange') }));
    if (!f.edge.name) throw new FeatureError(t('edit.noEdgePicked'));
    const [index] = this.edgeIndices([f.edge], view);
    const { body, local } = set.locate('edge', index!);
    const topo = body.topology;
    const edge = topo.edges[local]!;
    const sides = edge.faces.map((i) => topo.faces[i]!);
    if (edge.curve !== 'line' || !edge.dir || sides.length !== 2 || sides.some((s) => s.surface !== 'plane' || !s.normal)) throw new FeatureError(t('flange.notSheetEdge'));
    const T = sheet.thickness;
    const W = edge.length;
    // a face of the sheet has a face parallel to it, the thickness away, behind it; the end face does not (a strip that has been merged with the side of a flange is not either)
    const sheetFace = (g: (typeof sides)[number]) => topo.faces.some((h) => h !== g && h.surface === 'plane' && h.normal && dot(h.normal, g.normal!) < -1 + 1e-9 && Math.abs(dot(sub(h.center, g.center), g.normal!) + T) < 1e-6 * (1 + T));
    const [a, b] = [sheetFace(sides[0]!), sheetFace(sides[1]!)];
    if (a === b) throw new FeatureError(t('flange.notSheetEdge'));
    const [endFace, big] = a ? [sides[1]!, sides[0]!] : [sides[0]!, sides[1]!];
    const o = endFace.normal!;
    const nF = big.normal!;
    // walked with the face in front of you and the outside on your right: e = nF × o (so that the two ends of the edge have a name)
    const e = unit(cross(nF, o));
    if (Math.abs(dot(o, nF)) > 1e-6 || Math.abs(dot(e, unit(edge.dir))) < 1 - 1e-6) throw new FeatureError(t('flange.notSheetEdge'));
    const hostMapping = sheet.mapping ? sheetHost(this.kernel, sheet.mapping, edge.mid) : null;
    const { rb, theta, straight, trim, info } = plan(sheet);
    const insetA = f.inset ? evalLength(f.inset.start) : 0;
    const insetB = f.inset ? evalLength(f.inset.end) : 0;
    const Wf = W - insetA - insetB;
    if (insetA < 0 || insetB < 0 || !(Wf > 1e-6)) throw new FeatureError(t('flange.insets'));
    const xa = -W / 2 + insetA;
    const xb = W / 2 - insetB;
    const relief = f.relief ? { width: evalLength(f.relief.width), depth: evalLength(f.relief.depth), shape: f.relief.shape ?? ('rect' as ReliefShape) } : null;
    const neg = (v: Vec3): Vec3 => [-v[0], -v[1], -v[2]];
    const m: Vec3 = f.flip ? neg(nF) : nF;
    // along m the sheet is from y = -T to 0 when it bends toward the face the edge is on, from 0 to T when the other way; the inside of the bend is the face on the side of m
    const [ylo, yhi] = f.flip ? [0, T] : [-T, 0];
    const origin = add(edge.mid, o, -trim);
    const center = add(origin, m, yhi + rb);
    const spin = dot(cross(e, neg(m)), o) > 0 ? 1 : -1; // the turn that moves the inside of the sheet out along o first
    const axis: Vec3 = [e[0] * spin, e[1] * spin, e[2] * spin];
    const strip = (prefix: string, lo: number, hi: number, x0 = xa, x1 = xb): Region => {
      const line = (a: [number, number], b: [number, number], source: string) => ({ kind: 'line' as const, a, b, source: `${prefix}.${source}` });
      return { outer: [line([x0, lo], [x1, lo], 'out'), line([x1, lo], [x1, hi], 's1'), line([x1, hi], [x0, hi], 'in'), line([x0, hi], [x0, lo], 's0')], holes: [] };
    };
    const frame: PlaneFrame = { origin, xDir: e, yDir: m, normal: cross(e, m) };
    const origin2 = add(center, rotate(sub(origin, center), axis, theta), 1);
    const m2 = rotate(m, axis, theta);
    const d = rotate(o, axis, theta);
    const n2 = cross(e, m2);
    const s2 = dot(n2, d) > 0 ? 1 : -1;
    const frame2: PlaneFrame = { origin: origin2, xDir: e, yDir: m2, normal: n2 };
    // closed corners: the flat piece goes on past the end of the bend, up to the inside of the flange next to it (the nearest face of a flange earlier made that faces the end of this one,
    // square to the edge), less the gap asked for
    let extA = 0;
    let extB = 0;
    const closeAt = (x: number, outward: 1 | -1, gap: number): number => {
      const u = add([0, 0, 0], e, outward);
      const q = add(add(add(origin2, e, x), d, straight / 2), m2, (ylo + yhi) / 2);
      let best: number | null = null;
      let facing = false;
      for (const g of sheet.flanges) {
        const n = g.fold.m2;
        if (Math.abs(dot(u, n)) < 0.99) continue;
        facing = true;
        const [lo, hi] = [dot(sub(q, g.fold.origin2), g.fold.d), dot(sub(q, g.fold.origin2), g.fold.e)];
        if (lo < -1e-6 || lo > g.straight + 1e-6 || hi < g.fold.pa - 1e-6 || hi > g.fold.pb + 1e-6) continue;
        for (const y of [g.fold.ylo, g.fold.yhi]) {
          const t = dot(sub(add(g.fold.origin2, n, y), q), n) / dot(u, n);
          if (t > 1e-6 && (best === null || t < best)) best = t;
        }
      }
      if (best === null) throw new FeatureError(t(facing ? 'flange.cornerCover' : 'flange.cornerNone'));
      if (best - gap < -1e-9) throw new FeatureError(t('flange.cornerGap', { reach: best.toFixed(3), gap: gap.toFixed(3) }));
      return best - gap;
    };
    if (f.corner?.start !== undefined) extA = closeAt(xa, -1, evalLength(f.corner.start));
    if (f.corner?.end !== undefined) extB = closeAt(xb, 1, evalLength(f.corner.end));

    // mitres (斜接): this flange and the one made before it, next to the end, meet on the vertical plane that halves the angle between their outer faces. In the plan view (α along the
    // outward direction of the neighbour, β along the outward direction of this flange, both from the corner of the outer faces) that plane is α = β, moved `s` for the gap. The
    // neighbour is cut back to it (`neighbour`), and the tools of this flange run on to the outer face of the neighbour and are cut back to it (`this`).
    type Mitre = { g: SheetFlange; end: 0 | 1; s: number; R: number; pw: Vec3; o1: Vec3; zlo: number; zhi: number; xOuterG: number; removed: number };
    const miterAt = (outward: 1 | -1, gap: number): Mitre => {
      if (!(gap >= 0) || !Number.isFinite(gap)) throw new FeatureError(t('flange.miterGap'));
      if (Math.abs(theta - Math.PI / 2) > 1e-6) throw new FeatureError(t('flange.miterAngle'));
      const R = rb + T;
      if (Math.abs(trim - R) > 1e-6) throw new FeatureError(t('flange.miterPosition'));
      const corner = add(edge.mid, e, outward * (W / 2));
      for (let j = sheet.flanges.length - 1; j >= 0; j--) {
        const g = sheet.flanges[j]!;
        const gf = g.fold;
        // an edge at right angles, out at this end, and the plate ends where its bend starts
        if (Math.abs(dot(e, gf.e)) > 1e-6 || dot(gf.o, e) * outward < 0.99) continue;
        if (Math.abs(dot(sub(corner, gf.origin), gf.o)) > 1e-5) continue;
        const u = dot(sub(corner, gf.mid), gf.e);
        const end: 0 | 1 = u > 0 ? 1 : 0;
        if (Math.abs(u - (end === 1 ? gf.xb : gf.xa)) > 1e-5 || g.corner[end] !== 0 || g.miter[end]) continue;
        if (Math.abs(g.angle - Math.PI / 2) > 1e-6) throw new FeatureError(t('flange.miterAngle'));
        if (Math.abs(g.radius - rb) > 1e-6) throw new FeatureError(t('flange.miterRadius'));
        if (Math.abs(g.trim - (g.radius + T)) > 1e-6) throw new FeatureError(t('flange.miterPosition'));
        if (dot(m, gf.m) < 0.99) throw new FeatureError(t('flange.miterSide'));
        const s = gap / Math.SQRT2;
        const o1 = gf.o;
        // the corner of the two outer faces, at the height of the sheet (the vertical axis is `m`)
        const pw = add(add(add([0, 0, 0], o1, dot(gf.origin, o1) + R), o, dot(origin, o) + R), m, dot(origin, m));
        // what the cut takes from the neighbour, by hand: its bend (a quarter of an annulus R, rb, seen along the edge) and its flat piece, over the strip between the plane and the
        // outer face of this flange, c = s + R from the inside of the bend: ∫ A(u)(c − u) du with A(u) = √(R² − u²) − √(rb² − u²), and the flat piece T × H wide
        const c = s + R;
        const bendRem = (c * Math.PI * R * R) / 4 - R ** 3 / 3 - ((c * Math.PI * rb * rb) / 4 - rb ** 3 / 3);
        const removed = bendRem + g.straight * (c * T - (R * R - rb * rb) / 2);
        return { g, end, s, R, pw, o1, zlo: ylo - 1, zhi: yhi + rb + Math.max(straight, g.straight) + 1, xOuterG: end === 1 ? gf.xb : gf.xa, removed };
      }
      throw new FeatureError(t('flange.miterNone'));
    };
    /** The prism that takes away the side of the mitre plane that is not the flange's: of the neighbour (`neighbour`), or of the tools of this flange (`this`). */
    const miterCutter = (mt: Mitre, which: 'neighbour' | 'this'): OpResult => {
      const { R, s } = mt;
      const pts: [number, number][] = which === 'neighbour' ? [[-R, -R - s], [1, 1 - s], [1, 2], [-R, 2]] : [[-R - s - 3, -R - 10], [1, -R - 10], [1, 1 + s], [-R - s - 3, -R - 3]];
      const region: Region = { outer: pts.map((p, i) => ({ kind: 'line' as const, a: p, b: pts[(i + 1) % pts.length]!, source: `miter.${which}.p${i}` })), holes: [] };
      const fr: PlaneFrame = { origin: add(mt.pw, m, mt.zlo), xDir: mt.o1, yDir: o, normal: cross(mt.o1, o) };
      return this.capsNamed(this.kernel.extrude(fr, [region], add([0, 0, 0], m, mt.zhi - mt.zlo), 0), `miter.${which}`, 'start', 'end');
    };
    const mitres: (Mitre | null)[] = [null, null];
    if (f.miter?.start !== undefined) {
      if (f.corner?.start !== undefined) throw new FeatureError(t('flange.miterCorner'));
      mitres[0] = miterAt(-1, evalLength(f.miter.start));
    }
    if (f.miter?.end !== undefined) {
      if (f.corner?.end !== undefined) throw new FeatureError(t('flange.miterCorner'));
      mitres[1] = miterAt(1, evalLength(f.miter.end));
    }
    const toolA = xa - extA - (mitres[0] ? trim : 0);
    const toolB = xb + extB + (mitres[1] ? trim : 0);
    let bendTool = this.capsNamed(this.kernel.revolve(frame, [strip('bend', ylo, yhi, xa - (mitres[0] ? trim : 0), xb + (mitres[1] ? trim : 0))], { origin: center, dir: axis }, theta), 'bend', 'start', 'end');
    let flangeTool = this.capsNamed(this.kernel.extrude(frame2, [strip('flange', ylo, yhi, toolA, toolB)], add([0, 0, 0], n2, s2 * straight), 0), 'flange', 'start', 'end');
    let named: { bend: ElementNames; flange: ElementNames } | null = null;
    let toolVolume = 0;
    if (mitres[0] || mitres[1]) {
      // the tools of this flange cut back to the mitre planes (the names of what is left come from the tool and the cutter)
      const cutBack = (tool: OpResult): { tool: OpResult; names: ElementNames } => {
        let cur = { tool, names: nameElements(tool.faceOrigins, this.kernel.topology(tool.shape), { featureId: f.id, sketchId: 'flange' }) };
        for (const mt of mitres) {
          if (!mt) continue;
          const cutter = miterCutter(mt, 'this');
          const cutNames = nameElements(cutter.faceOrigins, this.kernel.topology(cutter.shape), { featureId: f.id, sketchId: 'flange' });
          const r = this.kernel.boolean('cut', cur.tool.shape, cutter.shape);
          this.kernel.release(cur.tool.shape);
          this.kernel.release(cutter.shape);
          if (this.kernel.solidCount(r.shape) !== 1) {
            this.kernel.release(r.shape);
            throw new FeatureError(t('flange.miterBad'));
          }
          cur = { tool: r, names: nameElements(r.faceOrigins, this.kernel.topology(r.shape), { featureId: f.id, sketchId: 'flange', input: concatNames(cur.names, cutNames) }) };
        }
        return cur;
      };
      const b = cutBack(bendTool);
      const g = cutBack(flangeTool);
      bendTool = b.tool;
      flangeTool = g.tool;
      named = { bend: b.names, flange: g.names };
      toolVolume = this.kernel.massProps(bendTool.shape).volume + this.kernel.massProps(flangeTool.shape).volume;
    }

    const volume = (list: readonly BodyState[]) => list.reduce((a, b) => a + (b.surface ? 0 : this.kernel.massProps(b.shape).volume), 0);
    const near = (a: number, b: number, scale: number) => Math.abs(a - b) <= 1e-3 * scale + 1e-6;
    let list: readonly BodyState[] = set.list;
    const before = volume(list);
    const n3 = cross(e, m);
    const s3 = dot(n3, o) > 0 ? 1 : -1;
    let expected = 0;
    const notches: FoldGeometry['notches'] = [];
    if (trim > 0) {
      const cutTool = this.capsNamed(this.kernel.extrude(frame, [strip('trim', ylo - 1, yhi + 1)], add([0, 0, 0], n3, s3 * (trim + 1)), 0), 'trim', 'start', 'end');
      list = this.apply(f.id, 'cut', cutTool, { featureId: f.id, sketchId: 'flange' }, list, false);
      expected += trim * Wf * T;
    }
    // a rectangular notch in the sheet beside each end where the flange stops short: `width` along the edge, from `depth` deeper than the bend starts out to past the edge
    if (relief) {
      const deep = trim + relief.depth;
      const frameN: PlaneFrame = { origin: add(edge.mid, o, -deep), xDir: e, yDir: m, normal: cross(e, m) };
      for (const [name, inset, atStart] of [['reliefA', insetA, true], ['reliefB', insetB, false]] as const) {
        if (!(inset > 1e-9)) continue;
        const shape = notchOf(relief.shape, relief.width, relief.depth, trim, inset, atStart ? xa : xb, atStart);
        const { x0, x1 } = shape;
        let tool: OpResult;
        if (shape.shape === 'obround') {
          if (!obroundFits(shape)) throw new FeatureError(t('flange.reliefObround'));
          // the profile lies in the plane of the sheet (along the edge, into the sheet) and is cut through the thickness
          const frameO: PlaneFrame = { origin: add(edge.mid, m, ylo - 1), xDir: e, yDir: neg(o), normal: cross(e, neg(o)) };
          tool = this.kernel.extrude(frameO, [obroundRegion(shape, name)], add([0, 0, 0], m, yhi - ylo + 2), 0);
          expected += ((x1 - x0) * (deep - (x1 - x0) / 2) + (Math.PI * ((x1 - x0) / 2) ** 2) / 2) * T;
        } else {
          tool = this.kernel.extrude(frameN, [strip(name, ylo - 1, yhi + 1, x0, x1)], add([0, 0, 0], n3, s3 * (deep + 1)), 0);
          expected += (x1 - x0) * deep * T;
        }
        list = this.apply(f.id, 'cut', this.capsNamed(tool, name, 'start', 'end'), { featureId: f.id, sketchId: 'flange' }, list, false);
        notches.push(shape);
      }
    }
    // (the volume of a body is integrated over all its faces, which costs most on a plate with many holes: it is taken as few times as the checks need)
    const cut = expected > 0 ? volume(list) : before;
    if (expected > 0 && !near(before - cut, expected, expected)) throw new FeatureError(t('flange.trimBad'));
    let afterMitre = cut;
    for (const mt of mitres) {
      if (!mt) continue;
      list = this.apply(f.id, 'cut', miterCutter(mt, 'neighbour'), { featureId: f.id, sketchId: 'flange' }, list, false);
      const now = volume(list);
      if (!near(afterMitre - now, mt.removed, mt.removed)) throw new FeatureError(t('flange.miterBad'));
      afterMitre = now;
    }
    // Keep the host's trimmed planar material before fusing the curved bend back into the body.
    const mappedPanels = sheet.mapping ? sheetClipPanels(this.kernel, sheet.mapping.panels, list.find(b => !b.surface)!.shape, shape => { this.owned.push(shape); return shape; }) : null;
    const mappedBend = sheet.mapping ? this.kernel.copy(bendTool.shape) : null;
    if(mappedBend!==null)this.owned.push(mappedBend);
    const mappedCurves=sheet.mapping?(sheet.mapping.curves??[]).map(c=>({...c,folded:(()=>{const shape=this.kernel.boolean('common',c.folded,list.find(b=>!b.surface)!.shape).shape;this.owned.push(shape);return shape;})()})):null;
    const mappedFlange = sheet.mapping ? this.kernel.copy(flangeTool.shape) : null;
    if (mappedFlange !== null) this.owned.push(mappedFlange);
    list = this.apply(f.id, 'boss', bendTool, { featureId: f.id, sketchId: 'flange' }, list, true, f.id, named?.bend);
    list = this.apply(f.id, 'boss', flangeTool, { featureId: f.id, sketchId: 'flange' }, list, true, f.id, named?.flange);
    const added = named ? toolVolume : theta * T * Wf * (rb + T / 2) + T * (Wf + extA + extB) * straight;
    if (!near(volume(list) - afterMitre, added, added)) throw new FeatureError(t('flange.collides'));
    const allowance = theta * (rb + sheet.kFactor * T);
    sheet.bends.push({ feature: f.id, name: 'bend', angle: theta, radius: rb, thickness: T, width: Wf, kFactor: sheet.kFactor, allowance });
    // the flange whose flat piece the edge picked is on (the base when none): by where the middle of the edge is in each piece
    const parent = (() => {
      for (let j = sheet.flanges.length - 1; j >= 0; j--) {
        const g = sheet.flanges[j]!;
        const rel = sub(edge.mid, g.fold.origin2);
        const [u, v, w] = [dot(rel, g.fold.e), dot(rel, g.fold.d), dot(rel, g.fold.m2)];
        const tol = 1e-6;
        if (u >= g.fold.pa - tol && u <= g.fold.pb + tol && v >= -tol && v <= g.straight + tol && w >= g.fold.ylo - tol && w <= g.fold.yhi + tol) return j;
      }
      return -1;
    })();
    // the straight piece of a bent base the edge is on (a flange on the base only)
    const host = (() => {
      const base = sheet.base;
      if (parent >= 0 || base?.kind !== 'bent') return -1;
      const tol = 1e-4;
      const at = (q: [number, number]): Vec3 => add(add(base.frame.origin, base.frame.xDir, q[0]), base.frame.yDir, q[1]);
      for (let i = 0; i < base.straights.length; i++) {
        const sg = base.straights[i]!;
        const A = at(sg.a);
        const d = unit(sub(at(sg.b), A));
        const left = cross(base.frame.normal, d);
        const ns: Vec3 = base.side === 'left' ? left : [-left[0], -left[1], -left[2]];
        const rel = sub(edge.mid, A);
        const [u, v, w] = [dot(rel, d), dot(rel, ns), dot(rel, base.dir)];
        if (u >= -tol && u <= Math.hypot(sg.b[0] - sg.a[0], sg.b[1] - sg.a[1]) + tol && v >= -tol && v <= T + tol && w >= -tol && w <= base.width + tol) return i;
      }
      return -1;
    })();
    const fold: FoldGeometry = { mid: edge.mid, origin, center, axis, e, o, m, xa, xb, pa: xa - extA, pb: xb + extB, ylo, yhi, trim, notches, origin2, d, m2 };
    const miter: SheetFlange['miter'] = [mitres[0] ? { s: mitres[0].s, xOuter: xa - trim } : null, mitres[1] ? { s: mitres[1].s, xOuter: xb + trim } : null];
    for (const mt of mitres) if (mt) mt.g.miter[mt.end] = { s: mt.s, xOuter: mt.xOuterG };
    sheet.flanges.push({ feature: f.id, edge: f.edge.name, width: Wf, angle: theta, radius: rb, trim, straight, allowance, inset: [insetA, insetB], relief, corner: [extA, extB], miter, parent, host, fold });
    if (sheet.mapping && hostMapping && mappedFlange !== null && mappedBend!==null) {
      const mapping = sheet.mapping;
      const own = (shape: ShapeId) => { this.owned.push(shape); return shape; };
      mapping.panels = mappedPanels!;
      mapping.curves=mappedCurves!;
      const backR = [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(v => rotate(v as Vec3, axis, -theta));
      const back: SheetRigid = { R: [backR[0]![0], backR[1]![0], backR[2]![0], backR[0]![1], backR[1]![1], backR[2]![1], backR[0]![2], backR[1]![2], backR[2]![2]], t: add(sub(center, rotate(center, axis, -theta)), o, allowance) };
      mapping.panels.push({ shape: mappedFlange, toFlat: sheetCompose(hostMapping.toFlat, back), feature:f.id, unfolds:{...sheetConjugate(sheetInverse(back),hostMapping.unfolds),[f.id]:back} });
      const current=sheet.flanges.at(-1)!;
      const flat=flatFlangeBend(this.kernel,current,hostMapping.toFlat,own);
      const rawMap:import('@3db/kernel').SheetBendMap={flatOrigin:add(origin,m,ylo),flatAcross:o,flatAlong:axis,flatNormal:m,center,axis,radial:neg(m),radiusAtZero:rb+T,radialSlope:-1,neutralRadius:rb+sheet.kFactor*T,angle:theta};
      mapping.curves.push({feature:f.id,name:'bend',flat,folded:mappedBend,map:sheetMapFlat(rawMap,hostMapping.toFlat),placement:sheetInverse(hostMapping.toFlat),unfolds:{...hostMapping.unfolds}});
      for(const mt of mitres){
        if(!mt)continue;
        const curve=mapping.curves.find(c=>c.feature===mt.g.feature&&c.name==='bend');
        if(curve){const boundary=flatFlangeBend(this.kernel,mt.g,sheetInverse(curve.placement),own);curve.flat=own(this.kernel.boolean('common',curve.flat,boundary).shape);}
      }
      mapping.zones=mapping.curves.map(c=>c.flat);
      (mapping.order??=[]).push(f.id);
      const atFlat = (point: Vec3) => sheetPlanar(mapping.frame, sheetPoint(hostMapping.toFlat, point));
      mapping.bends.push({ feature: f.id, name: 'bend', a: atFlat(add(add(origin, o, allowance / 2), e, xa)), b: atFlat(add(add(origin, o, allowance / 2), e, xb)), angle: theta, radius: rb, direction: dot(sheetVector(hostMapping.toFlat, m), mapping.frame.normal) > 0 ? 'up' : 'down', kFactor: sheet.kFactor, allowance });
    }
    this.info = info(allowance) + (insetA > 0 || insetB > 0 ? t('flange.info.inset', { start: String(insetA), end: String(insetB) }) : '') + (mitres[0] || mitres[1] ? t('flange.info.miter', { gap: String(((mitres[0]?.s ?? mitres[1]!.s) * Math.SQRT2).toFixed(3)) }) : '');
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

  /**
   * 「偏移曲面」 (C9.2): faces of one body offset into a surface body of its own (4b, ADR 0067). The body they are on is left as it is; the result is measured, and
   * refused with the gap that was found when it is not the distance asked for.
   */
  private offsetSurface(f: OffsetSurfaceFeature, set: Bodies): BodyState[] {
    const view = set.view;
    if (!view) throw new FeatureError(t('surface.noBodyForOffset'));
    if (f.faces.length === 0) throw new FeatureError(t('edit.noFacePicked'));
    const owners = new Map<BodyState, Ref[]>();
    const unresolved: Unresolved[] = [];
    for (const ref of f.faces) {
      const r = resolveRef(ref, view.names, view.topology);
      if (!r.ok) {
        unresolved.push({ ref, reason: r.reason, candidates: r.candidates });
        continue;
      }
      this.noteFingerprint(r.via, t('edit.faceNoun'), view.names.faces[r.index]!);
      const { body } = set.locate('face', r.index);
      owners.set(body, [...(owners.get(body) ?? []), ref]);
    }
    if (unresolved.length > 0) throw new FeatureError(t('surface.facesLost', { n: unresolved.length }), unresolved);
    if (owners.size !== 1) throw new FeatureError(t('surface.oneBody'));
    const [body, mine] = [...owners][0]!;
    const r = this.kernel.offsetFaces(body.shape, this.faceIndices(mine, body), evalLength(f.distance), f.join ? { join: f.join } : {});
    const g = r.gap;
    this.info = t('surface.gapInfo', { min: g.min.toFixed(3), max: g.max.toFixed(3), mean: g.mean.toFixed(3), deviation: g.deviation.toFixed(4), tolerance: String(SURFACE_TOLERANCE) });
    const topology = this.kernel.topology(r.shape);
    const names = nameElements(r.faceOrigins, topology, { featureId: f.id, role: 'offset', input: body.names });
    return [...set.list, { id: f.id, shape: r.shape, topology, names, by: f.id, surface: true }];
  }

  /**
   * The projection of a sketch onto a face of `body` and the cut along it (ADR 0069), named: a region is named like a face the sketch made,
   * `<feature>:side:<sketch>.<outline>`, the outline being the smallest id of the entities that bound it, so it follows the model and the sketch's edits; the rest
   * of the face keeps the face's name. `regions` are the faces inside the outlines, `pieces` all the faces the cut face became. The shape in `r` is the caller's to release.
   */
  private projectSplit(f: SplitLineFeature | TrimSurfaceFeature, sketches: RebuildResult['sketches'], body: BodyState) {
    const s = this.profileOf(sketches, f.sketch);
    const loops = s.profiles.regions.map((r) => r.outer);
    const key = (loop: (typeof loops)[number]) => loop.map((seg) => seg.source).sort()[0]!;
    const n = s.frame.normal;
    const sign = f.reverse ? -1 : 1;
    const [face] = this.faceIndices([f.face], body);
    const r = this.kernel.splitByProjection(body.shape, face!, s.frame, loops, [n[0] * sign, n[1] * sign, n[2] * sign], !!f.throughAll);
    if (r.regions.length === 0) {
      this.kernel.release(r.shape);
      throw new FeatureError(t('surface.noRegion'));
    }
    const pieces = r.faceOrigins.flatMap((o, j) => (o.some((x) => 'index' in x && x.index === face) ? [j] : []));
    const origins = r.faceOrigins.map((o) => o.slice());
    r.regions.forEach((j, k) => (origins[j] = [{ rel: 'generated', kind: 'profileEdge', source: key(loops[r.regionLoops[k]!]!) }]));
    const topology = this.kernel.topology(r.shape);
    const names = nameElements(origins, topology, { featureId: f.id, sketchId: f.sketch, input: body.names });
    return { r, topology, names, regions: r.regions, pieces };
  }

  /** 「分割線」 (C8.1): the closed outlines of a sketch projected onto a face (4b, ADR 0069), which is cut along them. */
  private splitLine(f: SplitLineFeature, sketches: RebuildResult['sketches'], set: Bodies): BodyState[] {
    return this.perBody(set, [f.face], 'face', t('surface.noBodyForSplit'), () => t('surface.splitFacesLost'), (body) => {
      const p = this.projectSplit(f, sketches, body);
      const state: BodyState = { id: body.id, shape: p.r.shape, topology: p.topology, names: p.names, by: f.id };
      return body.surface ? { ...state, surface: true } : state;
    });
  }

  /**
   * 「修剪曲面」 (C9.3): the face of a surface body is cut along the outlines of a sketch as for a split line, and what is inside them is kept (outside with
   * `keep: 'outside'`); the other pieces of that face go. The faces keep the names they had in the cut.
   */
  private trimSurface(f: TrimSurfaceFeature, sketches: RebuildResult['sketches'], set: Bodies): BodyState[] {
    return this.perBody(set, [f.face], 'face', t('surface.noBodyForSplit'), () => t('surface.splitFacesLost'), (body) => {
      if (!body.surface || body.curve) throw new FeatureError(t('surface.trimNeedsSurface'));
      const p = this.projectSplit(f, sketches, body);
      try {
        const gone = new Set(f.keep === 'outside' ? p.regions : p.pieces.filter((j) => !p.regions.includes(j)));
        if (gone.size === 0) throw new FeatureError(t('surface.trimNothing'));
        const keep = p.topology.faces.flatMap((_, j) => (gone.has(j) ? [] : [j]));
        if (keep.length === 0) throw new FeatureError(t('surface.trimNothing'));
        const k = this.kernel.keepFaces(p.r.shape, keep);
        const topology = this.kernel.topology(k.shape);
        const names = nameFromFaces(k.faceOrigins.map((o) => p.names.faces[(o[0] as { index: number }).index]!), topology);
        return { id: body.id, shape: k.shape, topology, names, by: f.id, surface: true };
      } finally {
        this.kernel.release(p.r.shape);
      }
    });
  }

  /**
   * 「縫織曲面」 (C9.3): surface bodies sewn into one. The first body is the result's (its place in the list and its id); the others are used up. The faces keep the
   * names they had. What is left open (free edges) and whether it closed into a solid is said in `info`.
   */
  private knit(f: KnitFeature, set: Bodies): BodyState[] {
    if (f.bodies.length === 0 || f.bodies.every((r) => !r.name)) throw new FeatureError(t('surface.knitNone'));
    const bodies: BodyState[] = [];
    for (const ref of f.bodies) {
      if (!ref.name) throw new FeatureError(t('body.pick', { what: t('surface.knitNone') }));
      const b = set.list.find((x) => x.id === ref.name);
      if (!b) throw new FeatureError(t('body.lost', { name: ref.name }), [{ ref, reason: 'missing', candidates: [] }]);
      if (!b.surface || b.curve) throw new FeatureError(t('surface.knitNeedsSurface', { name: b.id }));
      if (!bodies.includes(b)) bodies.push(b);
    }
    const r = this.kernel.knit(bodies.map((b) => b.shape), f.tolerance ? evalLength(f.tolerance) : 0.01, f.solid !== false);
    const topology = this.kernel.topology(r.shape);
    const input = bodies.reduce<ElementNames>((acc, b) => concatNames(acc, b.names), { faces: [], edges: [], vertices: [] });
    this.info = t('surface.knitInfo', { faces: String(topology.faces.length), free: String(r.freeEdges), multiple: String(r.multipleEdges), kind: t(r.solid ? 'surface.knitKindSolid' : 'surface.knitKindShell') });
    const first = bodies[0]!;
    const state: BodyState = { id: first.id, shape: r.shape, topology, names: nameElements(r.faceOrigins, topology, { featureId: f.id, input }), by: f.id, ...(r.solid ? {} : { surface: true }) };
    return set.list.flatMap((b) => (b === first ? [state] : bodies.includes(b) ? [] : [b]));
  }

  /**
   * 「互相修剪曲面」 (P-3, ADR 0109): two surface bodies cut where they cross, each into its pieces, in the place of the two (their ids). A piece has the name of the face it came
   * from, `#k` when a face fell into several (as for a split line). The pieces in `discard` are then taken away; one that is not found is reported with the others.
   */
  private mutualTrim(f: MutualTrimFeature, set: Bodies): BodyState[] {
    const a = this.bodyByRef(set, f.a, t('surface.trimBodyA'));
    const b = this.bodyByRef(set, f.b, t('surface.trimBodyB'));
    if (a === b) throw new FeatureError(t('surface.trimSameBody'));
    for (const x of [a, b]) if (!x.surface || x.curve) throw new FeatureError(t('surface.trimNeedsSurfaces', { name: x.id }));
    const k = this.kernel;
    const r = k.trimSurfaces(a.shape, b.shape);
    const state = (body: BodyState, res: { shape: ShapeId; faceOrigins: FaceOrigin[][] }): BodyState => {
      const topology = k.topology(res.shape);
      return { id: body.id, shape: res.shape, topology, names: nameElements(res.faceOrigins, topology, { featureId: f.id, input: body.names }), by: f.id, surface: true };
    };
    let pieces: BodyState[] = [state(a, r.a), state(b, r.b)];
    const drop = () => pieces.forEach((p) => k.release(p.shape));
    try {
      if (pieces[0]!.topology.faces.length === a.topology.faces.length && pieces[1]!.topology.faces.length === b.topology.faces.length) throw new FeatureError(t('surface.trimNoCurve'));
      const wanted = f.discard ?? [];
      let gone = 0;
      if (wanted.length > 0) {
        const view = new Bodies(pieces, k);
        const away = new Map<BodyState, Set<number>>();
        const unresolved: Unresolved[] = [];
        try {
          const v = view.view!;
          for (const ref of wanted) {
            const found = resolveRef(ref, v.names, v.topology);
            if (!found.ok) {
              unresolved.push({ ref, reason: found.reason, candidates: found.candidates });
              continue;
            }
            this.noteFingerprint(found.via, t('surface.trimPieceNoun'), v.names.faces[found.index]!);
            const { body, local } = view.locate('face', found.index);
            away.set(body, (away.get(body) ?? new Set<number>()).add(local));
          }
        } finally {
          view.release();
        }
        if (unresolved.length > 0) throw new FeatureError(t('surface.trimDiscardLost', { n: unresolved.length }), unresolved);
        const next: BodyState[] = [];
        for (const p of pieces) {
          const out = away.get(p);
          if (!out || out.size === 0) {
            next.push(p);
            continue;
          }
          const keep = p.topology.faces.flatMap((_, j) => (out.has(j) ? [] : [j]));
          if (keep.length === 0) throw new FeatureError(t('surface.trimAllDiscarded', { name: p.id }));
          const kept = k.keepFaces(p.shape, keep);
          const topology = k.topology(kept.shape);
          next.push({ ...p, shape: kept.shape, topology, names: nameFromFaces(kept.faceOrigins.map((o) => p.names.faces[(o[0] as { index: number }).index]!), topology) });
          k.release(p.shape);
          gone += out.size;
        }
        pieces = next;
      }
      this.info = t('surface.trimInfo', { a: String(pieces[0]!.topology.faces.length), b: String(pieces[1]!.topology.faces.length), gone: String(gone) });
    } catch (e) {
      drop();
      throw e;
    }
    return set.list.map((x) => (x === a ? pieces[0]! : x === b ? pieces[1]! : x));
  }

  /** The edges picked, which have to be on one body: that body and the edges' numbers in it. Lost ones are reported together. */
  private edgesOnOneBody(refs: Ref[], set: Bodies, none: string): { body: BodyState; indices: number[] } {
    const view = set.view;
    if (!view) throw new FeatureError(none);
    if (refs.length === 0) throw new FeatureError(t('edit.noEdgePicked'));
    const owners = new Map<BodyState, Ref[]>();
    const unresolved: Unresolved[] = [];
    for (const ref of refs) {
      const r = resolveRef(ref, view.names, view.topology);
      if (!r.ok) {
        unresolved.push({ ref, reason: r.reason, candidates: r.candidates });
        continue;
      }
      this.noteFingerprint(r.via, t('regen.edgeNoun'), view.names.edges[r.index]!);
      const { body } = set.locate('edge', r.index);
      owners.set(body, [...(owners.get(body) ?? []), ref]);
    }
    if (unresolved.length > 0) throw new FeatureError(t('edit.edgesLost', { n: unresolved.length }), unresolved);
    if (owners.size !== 1) throw new FeatureError(t('surface.edgesOneBody'));
    const [body, mine] = [...owners][0]!;
    return { body, indices: this.edgeIndices(mine, body) };
  }

  /**
   * 「填補曲面」 (C9.2): a patch over the boundary of the edges picked, meeting the face beside each edge tangent (when an edge has one face beside it, as the edge of a
   * hole in a surface does), as a surface body of its own. How far it is from the edges and from the tangent is said in `info`; a patch more than the tolerance from
   * the edges is refused.
   */
  private fillSurface(f: FillSurfaceFeature, set: Bodies): BodyState[] {
    const { body, indices } = this.edgesOnOneBody(f.edges, set, t('surface.noBodyForFill'));
    const contact = f.continuity === 'contact';
    const support = indices.map((e) => (!contact && body.topology.edges[e]!.faces.length === 1 ? body.topology.edges[e]!.faces[0]! : null));
    const r = this.kernel.fillSurface(body.shape, indices, support, contact ? 'contact' : 'tangent');
    if (r.g0 > SURFACE_TOLERANCE) {
      this.kernel.release(r.shape);
      throw new FeatureError(t('surface.fillGap', { g0: r.g0.toFixed(3), tolerance: String(SURFACE_TOLERANCE) }));
    }
    if (!contact && r.g1 > FILL_TANGENT_TOLERANCE) {
      this.kernel.release(r.shape);
      throw new FeatureError(t('surface.fillTangent', { g1: ((r.g1 * 180) / Math.PI).toFixed(1), tolerance: ((FILL_TANGENT_TOLERANCE * 180) / Math.PI).toFixed(1) }));
    }
    const followed = support.filter((s) => s !== null).length;
    this.info =
      followed === 0
        ? t(contact ? 'surface.fillInfoContact' : 'surface.fillNoSupport', { g0: r.g0.toFixed(4) })
        : t('surface.fillInfo', { g0: r.g0.toFixed(4), g1: ((r.g1 * 180) / Math.PI).toFixed(3) }) + (followed < indices.length ? t('surface.fillPartial', { n: String(indices.length - followed) }) : '');
    const topology = this.kernel.topology(r.shape);
    const names = nameElements([[{ rel: 'generated', kind: 'edge', index: indices[0]! }]], topology, { featureId: f.id, role: 'fill', input: body.names });
    return [...set.list, { id: f.id, shape: r.shape, topology, names, by: f.id, surface: true }];
  }

  /** 「平坦曲面」 (C9.2): a flat face over a closed loop of the edges picked that lie in one plane, as a surface body of its own. */
  private flatSurface(f: FlatSurfaceFeature, set: Bodies): BodyState[] {
    const { body, indices } = this.edgesOnOneBody(f.edges, set, t('surface.noBodyForFill'));
    const shape = this.kernel.flatSurface(body.shape, indices);
    const topology = this.kernel.topology(shape);
    const names = nameElements([[{ rel: 'generated', kind: 'edge', index: indices[0]! }]], topology, { featureId: f.id, role: 'flat', input: body.names });
    return [...set.list, { id: f.id, shape, topology, names, by: f.id, surface: true }];
  }

  /**
   * 「唇與溝槽」 (C4.11): a ring on a planar face that follows the outline of the face, grown out of it (a lip) or cut into the body (a groove) — the tool is made by
   * `Kernel.ringTool` and joined to the bodies or cut from them like the tool of any boss or cut. Its faces are named after the edge of the outline they came from:
   * `<feature>:side:ring.<edge name>` for the outside of the ring, the same with `~` for the inside, `<feature>:cap:end` for the far end; so the names follow the model.
   */
  private lipGroove(f: LipGrooveFeature, set: Bodies): BodyState[] {
    const view = set.view;
    if (!view) throw new FeatureError(t('lip.noBody'));
    const r = resolveRef(f.face, view.names, view.topology);
    if (!f.face.name) throw new FeatureError(t('edit.noFacePicked'));
    if (!r.ok) throw new FeatureError(t('edit.facesLost', { n: 1 }), [{ ref: f.face, reason: r.reason, candidates: r.candidates }]);
    this.noteFingerprint(r.via, t('edit.faceNoun'), view.names.faces[r.index]!);
    const { body, local } = set.locate('face', r.index);
    const lip = f.kind === 'lip';
    const tool = this.kernel.ringTool(body.shape, local, evalLength(f.offset), evalLength(f.width), evalLength(f.height), lip ? 'out' : 'in');
    const topology = this.kernel.topology(tool.shape);
    const origins: FaceOrigin[][] = tool.sides.map((s) => [s.kind === 'cap' ? { rel: 'cap', which: s.which } : { rel: 'generated', kind: 'profileEdge', source: `${body.names.edges[s.edge] ?? `?e${s.edge}`}${s.inner ? '~' : ''}` }]);
    const named = nameElements(origins, topology, { featureId: f.id, sketchId: 'ring' });
    this.info = t('lip.info', { kind: t(lip ? 'lip.kindLip' : 'lip.kindGroove'), area: tool.area.toFixed(2), volume: (tool.area * evalLength(f.height)).toFixed(2) });
    return this.apply(f.id, lip ? 'boss' : 'cut', { shape: tool.shape, faceOrigins: origins }, { featureId: f.id }, set.list, true, f.id, named);
  }

  /** A body of the set by the reference to it, said when it is not picked or not there. */
  private bodyByRef(set: Bodies, ref: Ref, what: string): BodyState {
    if (!ref.name) throw new FeatureError(t('body.pick', { what }));
    const b = set.list.find((x) => x.id === ref.name);
    if (!b) throw new FeatureError(t('body.lost', { name: ref.name }), [{ ref, reason: 'missing', candidates: [] }]);
    return b;
  }

  /**
   * 「厚面」 (C9.4): a surface body made a solid, in the place of the surface (its id): the faces keep the name of the surface's, the face made from each is
   * `<feature>:thicken:<face>`, the walls round its edges `<feature>:thicken:<edge>`. The thickness is measured (no point of the solid is farther from the surface),
   * and what it came to is in `info`.
   */
  private thicken(f: ThickenFeature, set: Bodies): BodyState[] {
    const b = this.bodyByRef(set, f.body, t('surface.thickenBody'));
    if (!b.surface || b.curve) throw new FeatureError(t('surface.thickenNeedsSurface', { name: b.id }));
    const thickness = evalLength(f.thickness);
    const k = this.kernel;
    // a copy of the surface for the solid when it is kept: its names are changed so that no name is in two bodies
    const copy = (a: string[]) => a.map((n) => `${f.id}:copy:${n}`);
    let names: ElementNames = f.keepSurface ? { faces: copy(b.names.faces), edges: copy(b.names.edges), vertices: copy(b.names.vertices) } : b.names;
    let from = b.shape;
    let half: ShapeId | undefined;
    try {
      if (f.both) {
        // both sides: the surface moved half the thickness against its normals, and thickened by the whole of it
        const o = k.offsetFaces(b.shape, b.topology.faces.map((_, i) => i), -Math.abs(thickness) / 2);
        half = o.shape;
        names = nameElements(o.faceOrigins, k.topology(o.shape), { featureId: f.id, role: 'half', input: names });
        from = o.shape;
      }
      const r = k.thicken(from, f.both ? Math.abs(thickness) : thickness);
      const topology = k.topology(r.shape);
      this.info = t('surface.thickenInfo', { max: r.gap.max.toFixed(3), thickness: String(Math.abs(thickness)), volume: k.massProps(r.shape).volume.toFixed(1) });
      const state: BodyState = { id: f.keepSurface ? f.id : b.id, shape: r.shape, topology, names: nameElements(r.faceOrigins, topology, { featureId: f.id, role: 'thicken', input: names }), by: f.id };
      if (f.keepSurface) return [...set.list, state];
      return set.list.map((x) => (x === b ? state : x));
    } finally {
      if (half !== undefined) k.release(half);
    }
  }

  /**
   * 「以曲面除料」 (C9.4): the surface body is swept along the normal of the direction plane (`reverse`: the other way) and what it goes through is taken from the solid.
   * The surface is left as it is. The new face is the surface as it was, named `<feature>:cut:<face of the surface>`; the pieces a cut leaves are as for any cut.
   */
  private cutWithSurface(f: CutWithSurfaceFeature, set: Bodies): BodyState[] {
    const target = this.bodyByRef(set, f.target, t('surface.cutTarget'));
    const surface = this.bodyByRef(set, f.surface, t('surface.cutSurface'));
    if (target.surface) throw new FeatureError(t('surface.cutNeedsSolid', { name: target.id }));
    if (!surface.surface || surface.curve) throw new FeatureError(t('surface.cutNeedsSurface', { name: surface.id }));
    const normal = f.direction.kind === 'vector'
      ? f.direction.value
      : this.planeOf(f.direction, set, { what: t('surface.cutDirection'), notPlanar: t('surface.cutDirectionNotPlanar') }).normal;
    const sign = f.reverse ? -1 : 1;
    const k = this.kernel;
    const tool = k.surfaceTool(target.shape, surface.shape, [normal[0] * sign, normal[1] * sign, normal[2] * sign]);
    const made: ShapeId[] = [];
    try {
      const toolNames = nameElements(tool.faceOrigins, k.topology(tool.shape), { featureId: f.id, role: 'cut', input: surface.names });
      const r = this.boolBodies(f.id, f.keep === 'ahead' ? 'common' : 'cut', [target], tool.shape, toolNames, made);
      k.release(tool.shape);
      if (!r.changed) throw new FeatureError(t('feature.cutRemovedNothing'));
      if (r.out.length === 0) throw new FeatureError(t('regen.cutRemovedAll'));
      return set.list.flatMap((b) => (b === target ? r.out : [b]));
    } catch (e) {
      for (const s of made) k.release(s);
      k.release(tool.shape);
      throw e;
    }
  }

  /** 「延伸曲面」 (C9.3): a surface body of one face made `distance` longer past the edges picked; the face keeps its name. */
  private extendSurface(f: ExtendSurfaceFeature, set: Bodies): BodyState[] {
    return this.perBody(set, f.edges, 'edge', t('surface.noBodyForExtend'), (n) => t('edit.edgesLost', { n }), (body, mine) => {
      if (!body.surface || body.curve) throw new FeatureError(t('surface.notSurface'));
      const r = this.kernel.extendFace(body.shape, this.edgeIndices(mine, body), evalLength(f.distance));
      const topology = this.kernel.topology(r.shape);
      return { id: body.id, shape: r.shape, topology, names: nameElements(r.faceOrigins, topology, { featureId: f.id, input: body.names }), by: f.id, surface: true };
    });
  }

  /**
   * 「薄殼」 (C5.4) with, when `faceThickness` has any, walls of another thickness (ADR 0078): the whole body is shelled with `thickness`, and then, for each face given
   * another, the inner face that was made against it is moved along its normal by the difference (`moveFace`; thicker is into the cavity). The inner face is found by its
   * name, which the moves keep, so moving one does not lose the next. Only a planar wall can be moved: say so, not guess. A move is checked: the inner face has to end up
   * where it was told to, and the outside of the body has to be as the shell left it (a wall too thick to fit makes the body bigger, not a wall).
   */
  private shell(f: ShellFeature, set: Bodies): BodyState[] {
    return this.perBody(set, f.faces, 'face', t('feature.noBodyForShell'), (n) => t('edit.facesLost', { n }), (body, mine) => {
      const opened = this.faceIndices(mine, body);
      const base = evalLength(f.thickness);
      const r = this.kernel.shell(body.shape, opened, base, !!f.outward);
      let shape = r.shape;
      let topology = this.kernel.topology(shape);
      let names = nameElements(r.faceOrigins, topology, { featureId: f.id, role: 'shell', input: body.names });
      const inner = names.faces.slice();
      const envelope = this.kernel.bounds(shape);
      try {
        for (const o of f.faceThickness ?? []) {
          const [picked] = this.faceIndices([o.face], body);
          const wanted = evalLength(o.thickness);
          if (Math.abs(wanted - base) < 1e-9) continue;
          if (opened.includes(picked!)) throw new FeatureError(t('feature.shellFaceOpened'));
          // the inner face generated from the one picked, and where it is now (a move keeps its name)
          const made = r.faceOrigins.findIndex((os) => os.some((x) => x.rel === 'generated' && x.kind === 'face' && x.index === picked));
          if (made < 0) throw new FeatureError(t('feature.shellNoInner'));
          const at = names.faces.indexOf(inner[made]!);
          if (at < 0) throw new FeatureError(t('feature.shellNoInner'));
          let moved: OpResult;
          try {
            moved = this.kernel.moveFace(shape, at, wanted - base);
          } catch (e) {
            if (e instanceof KernelError) throw new FeatureError(t('feature.shellFaceThickness', { why: e.message }));
            throw e;
          }
          const was = topology.faces[at]!;
          const after = this.kernel.topology(moved.shape);
          const afterNames = nameElements(moved.faceOrigins, after, { featureId: f.id, role: 'shell', input: names });
          const now = afterNames.faces.indexOf(inner[made]!);
          const shifted = now < 0 ? NaN : (after.faces[now]!.center[0] - was.center[0]) * was.normal![0] + (after.faces[now]!.center[1] - was.center[1]) * was.normal![1] + (after.faces[now]!.center[2] - was.center[2]) * was.normal![2];
          const reach = this.kernel.bounds(moved.shape);
          const grown = [0, 1, 2].some((k) => reach.min[k]! < envelope.min[k]! - 1e-6 || reach.max[k]! > envelope.max[k]! + 1e-6);
          if (grown || !(Math.abs(shifted - (wanted - base)) < 1e-6)) {
            this.kernel.release(moved.shape);
            throw new FeatureError(t('feature.shellFaceThickness', { why: t('feature.shellDoesNotFit') }));
          }
          this.kernel.release(shape);
          shape = moved.shape;
          topology = after;
          names = afterNames;
        }
      } catch (e) {
        this.kernel.release(shape);
        throw e;
      }
      return { id: body.id, shape, topology, names, by: f.id };
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

  /**
   * The edges of a fillet or a chamfer: the ones picked, and every edge of the faces picked (worked out here from the faces as they are now). Left out of a
   * face's: an edge with only one face of its own (a seam, the rim of an open shell) and an edge the faces on both sides continue smoothly across (the
   * seam of a round; it is rounded already). `via` says, for an edge that came from a face, which face (a chamfer measures its first distance on it).
   */
  private edgesOfRefs(refs: Ref[], body: BodyState): { edges: number[]; via: Map<number, number> } {
    const picked = refs.filter((r) => r.kind === 'edge');
    const faces = refs.filter((r) => r.kind === 'face');
    const own = picked.length > 0 ? this.edgeIndices(picked, body) : [];
    const via = new Map<number, number>();
    if (faces.length > 0) {
      const topo = body.topology;
      const candidates: number[] = [];
      for (const face of this.faceIndices(faces, body).sort((a, b) => (body.names.faces[a]! < body.names.faces[b]! ? -1 : 1))) {
        topo.edges.forEach((e, i) => {
          if (e.curve === 'degenerated' || !e.faces.includes(face) || new Set(e.faces).size !== 2 || via.has(i)) return;
          via.set(i, face);
          candidates.push(i);
        });
      }
      const smooth = this.kernel.smoothEdges(body.shape, candidates);
      candidates.forEach((i, k) => {
        if (smooth[k]) via.delete(i);
      });
      if (own.length === 0 && via.size === 0) throw new FeatureError(t('edit.faceNoEdges'));
    }
    return { edges: [...new Set([...own, ...via.keys()])], via };
  }

  /**
   * The edges a face fillet rounds: the ones where a face of the first group meets a face of the second (not the ones the two continue smoothly across). The
   * groups have to meet; groups that do not share an edge need a fillet that rolls a ball between faces apart, which OCCT cannot make (ADR 0097).
   */
  private edgesBetween(first: Ref[], second: Ref[], body: BodyState): number[] {
    const a = new Set(first.length > 0 ? this.faceIndices(first, body) : []);
    const b = new Set(second.length > 0 ? this.faceIndices(second, body) : []);
    if (a.size === 0 || b.size === 0) throw new FeatureError(t('edit.faceFilletTwoGroups'));
    const shared: number[] = [];
    body.topology.edges.forEach((e, i) => {
      const faces = [...new Set(e.faces)];
      if (e.curve === 'degenerated' || faces.length !== 2) return;
      if ((a.has(faces[0]!) && b.has(faces[1]!)) || (a.has(faces[1]!) && b.has(faces[0]!))) shared.push(i);
    });
    if (shared.length === 0) throw new FeatureError(t('edit.faceFilletApart'));
    const smooth = this.kernel.smoothEdges(body.shape, shared);
    const edges = shared.filter((_, k) => !smooth[k]);
    if (edges.length === 0) throw new FeatureError(t('edit.faceFilletSmooth'));
    return edges;
  }

  /**
   * `Kernel.fillet`, and when it cannot, the reason a person can act on: the largest radius that does work for the same edges (found by halving, so the answer is a few percent
   * short of the true limit, never over). Rounding is refused mostly because the rounds of neighbouring edges meet each other (a hole near an edge: the strip left between
   * them has to be wider than two radii), or one is wider than the face beside it.
   */
  private roundEdges(shape: ShapeId, edges: number[], radius: number): OpResult {
    try {
      return this.kernel.fillet(shape, edges, radius);
    } catch (e) {
      if (!(e instanceof KernelError)) throw e;
      const works = (r: number): boolean => {
        try {
          this.kernel.release(this.kernel.fillet(shape, edges, r).shape);
          return true;
        } catch {
          return false;
        }
      };
      if (!(radius > 0) || !works(radius / 64)) throw e;
      let [lo, hi] = [radius / 64, radius];
      for (let k = 0; k < 7; k++) {
        const mid = (lo + hi) / 2;
        if (works(mid)) lo = mid;
        else hi = mid;
      }
      const round2 = (v: number) => String(Math.floor(v * 100) / 100);
      throw new FeatureError(t('edit.filletTooBig', { radius: round2(radius), max: round2(lo) }));
    }
  }

  private fillet(f: FilletFeature, set: Bodies): BodyState[] {
    if (f.kind === 'face') return this.faceFillet(f, set);
    if (f.kind === 'full') return this.fullRound(f, set);
    if (f.edges.length === 0 && !f.faces?.length) throw new FeatureError(t('edit.noEdgeOrFacePicked'));
    return this.perBody(set, [...f.edges, ...(f.faces ?? [])], 'edge', t('edit.noBodyForFillet'), lostRefs, (body, mine) => {
      const { edges } = this.edgesOfRefs(mine, body);
      const laws = this.filletLaws(f, mine, body);
      // a variable radius has no "slightly smaller works" to fall back to: a law that fails fails, and says so (ADR 0167)
      const r = laws ? this.kernel.fillet(body.shape, edges, evalLength(f.radius), laws) : this.roundEdges(body.shape, edges, evalLength(f.radius));
      const topology = this.kernel.topology(r.shape);
      return { id: body.id, shape: r.shape, topology, names: nameElements(r.faceOrigins, topology, { featureId: f.id, role: 'fillet', input: body.names }), by: f.id };
    });
  }

  /**
   * The radius laws a variable-radius fillet (C5.2, ADR 0167) hands to `Kernel.fillet`: one per edge that has control points, the radii evaluated and
   * the points sorted along the edge. A control point may sit on an edge the fillet picked (the model keeps it that way); the edges that came from
   * picked faces have no points of their own and take the constant radius.
   */
  private filletLaws(f: FilletFeature, mine: Ref[], body: BodyState): Map<number, { t: number; r: number }[]> | undefined {
    const points = f.variable;
    if (!points || points.length === 0) return undefined;
    const edgeRefs = mine.filter((r) => r.kind === 'edge');
    const indices = this.edgeIndices(edgeRefs, body);
    const byName = new Map(edgeRefs.map((r, i) => [r.name, indices[i]!] as const));
    const laws = new Map<number, { t: number; r: number }[]>();
    for (const p of points) {
      const edge = byName.get(p.edge);
      if (edge === undefined) throw new FeatureError(t('edit.filletVariableEdge', { edge: p.edge }));
      const radius = evalLength(p.radius);
      if (!(radius > 0)) throw new FeatureError(t('edit.filletVariablePositive', { radius: String(radius) }));
      (laws.get(edge) ?? laws.set(edge, []).get(edge)!).push({ t: p.t, r: radius });
    }
    for (const law of laws.values()) {
      law.sort((a, b) => a.t - b.t);
      // the law is only defined between its first and last point, and the edge runs from end to end: both ends have to be there
      if (law[0]!.t !== 0 || law[law.length - 1]!.t !== 1) throw new FeatureError(t('edit.filletVariableEnds'));
    }
    return laws;
  }

  /** 「完整圓角」: the center face between two parallel sides becomes half a cylinder tangent to both (`Kernel.fullRound`); the radius is half the width, not typed. */
  private fullRound(f: FilletFeature, set: Bodies): BodyState[] {
    const group = (list: Ref[] | undefined) => new Set((list ?? []).map((r) => r.name));
    const [one, mid, two] = [group(f.faces), group(f.center), group(f.faces2)];
    return this.perBody(set, [...(f.faces ?? []), ...(f.center ?? []), ...(f.faces2 ?? [])], 'face', t('edit.noBodyForFillet'), lostRefs, (body, mine) => {
      const pick = (names: Set<string>, others: Set<string>[]) => mine.filter((r) => names.has(r.name) && !others.some((o) => o.has(r.name)));
      const centers = pick(mid, []);
      const side1 = pick(one, [mid]);
      const side2 = pick(two, [mid, one]);
      if (centers.length === 0 || side1.length === 0 || side2.length === 0) throw new FeatureError(t('edit.fullRoundGroups'));
      if (centers.length > 1) throw new FeatureError(t('edit.fullRoundOneCenter'));
      const [c] = this.faceIndices(centers, body);
      const r = this.kernel.fullRound(body.shape, c!, this.faceIndices(side1, body), this.faceIndices(side2, body));
      const topology = this.kernel.topology(r.shape);
      return { id: body.id, shape: r.shape, topology, names: nameElements(r.faceOrigins, topology, { featureId: f.id, role: 'fillet', input: body.names }), by: f.id };
    });
  }

  /** 「面圓角」: the edges where the two groups of faces meet, rounded by the radius. */
  private faceFillet(f: FilletFeature, set: Bodies): BodyState[] {
    const names = new Set((f.faces2 ?? []).map((r) => r.name));
    return this.perBody(set, [...(f.faces ?? []), ...(f.faces2 ?? [])], 'face', t('edit.noBodyForFillet'), lostRefs, (body, mine) => {
      // a name in both groups is in the second only: a face does not meet itself
      const second = mine.filter((r) => names.has(r.name));
      const first = mine.filter((r) => !names.has(r.name) && (f.faces ?? []).some((x) => x.name === r.name));
      const r = this.roundEdges(body.shape, this.edgesBetween(first, second, body), evalLength(f.radius));
      const topology = this.kernel.topology(r.shape);
      return { id: body.id, shape: r.shape, topology, names: nameElements(r.faceOrigins, topology, { featureId: f.id, role: 'fillet', input: body.names }), by: f.id };
    });
  }

  private chamfer(f: ChamferFeature, set: Bodies): BodyState[] {
    if (f.edges.length === 0 && !f.faces?.length) throw new FeatureError(t('edit.noEdgeOrFacePicked'));
    return this.perBody(set, [...f.edges, ...(f.faces ?? [])], 'edge', t('edit.noBodyForChamfer'), lostRefs, (body, mine) => {
      const { edges, via } = this.edgesOfRefs(mine, body);
      const specs = edges.map((edge) => {
        // The first distance is measured on the face the edge came from when a face was picked (「反轉方向」: the face on the other side of the edge);
        // for an edge picked by itself, on the adjacent face whose persistent name sorts first (the other one with 「反轉方向」): a choice that
        // survives rebuilds, unlike face order.
        const faces = [...new Set(body.topology.edges[edge]!.faces)].sort((a, b) => (body.names.faces[a]! < body.names.faces[b]! ? -1 : 1));
        const from = via.get(edge);
        const face = from !== undefined ? (f.flip ? faces.find((g) => g !== from) : from) : faces[f.flip ? faces.length - 1 : 0];
        if (face === undefined) throw new FeatureError(t('regen.edgeNoFace'));
        return { edge, face };
      });
      const second = f.mode === 'distanceDistance' ? evalLength(f.second) : evalAngle(f.second);
      let r: OpResult;
      try {
        r = this.kernel.chamfer(body.shape, specs, f.mode, evalLength(f.distance), second);
      } catch (e) {
        // An entry cone is a machining operation about the hole axis, not an offset of
        // each wavy edge of a real thread. Offer the existing countersink workflow;
        // never change the user's distances, selection or model on native failure.
        if (e instanceof KernelError && edges.some(i => ['bsplinecurve', 'beziercurve'].includes(body.topology.edges[i]!.curve))) {
          throw new FeatureError(t('feature.chamferFreeformFailed', { why: e.message }) + ' ' + t('entrance.order'));
        }
        throw e;
      }
      const topology = this.kernel.topology(r.shape);
      return { id: body.id, shape: r.shape, topology, names: nameElements(r.faceOrigins, topology, { featureId: f.id, role: 'chamfer', input: body.names }), by: f.id };
    });
  }
}
