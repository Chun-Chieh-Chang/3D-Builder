export type Vec3 = [number, number, number];

/** Opaque handle to a shape held by the kernel. Released explicitly (WASM memory is not garbage collected). */
export type ShapeId = number & { readonly __brand: 'ShapeId' };

/**
 * The analytic surface under a face (A5.2), what mates use. `convex`: the face's outward normal points
 * away from the axis or center, i.e. the material is inside (a shaft, a ball) rather than around (a hole).
 */
export type SurfaceGeometry =
  | { type: 'plane'; origin: Vec3; normal: Vec3 }
  | { type: 'cylinder'; origin: Vec3; axis: Vec3; radius: number; convex: boolean }
  | { type: 'cone'; apex: Vec3; axis: Vec3; halfAngle: number; convex: boolean }
  | { type: 'sphere'; center: Vec3; radius: number; convex: boolean }
  | { type: 'torus'; center: Vec3; axis: Vec3; major: number; minor: number; convex: boolean };

/** The analytic curve under an edge (A5.2). */
export type CurveGeometry = { type: 'line'; origin: Vec3; dir: Vec3 } | { type: 'circle'; center: Vec3; normal: Vec3; radius: number };

/** What a face is to a mold that opens along a direction (draft analysis, E3.2): the four classes of SolidWorks's analysis, and `unknown` for a face the analysis could not sample. */
export type DraftClass = 'positive' | 'negative' | 'required' | 'straddle' | 'unknown';

/** One face's draft: the least and the greatest angle (radians) of its surface to the direction, over the points sampled, and what that makes it. */
export interface DraftFace {
  /** The face's number in the shape (the order of `Kernel.topology`). */
  face: number;
  kind: DraftClass;
  /** asin(normal · pull): positive when the face leans so that the part leaves along the pull; ±90° for a face square to it. */
  min: number;
  max: number;
  samples: number;
  area: number;
}

export interface DraftReport {
  /** The angle (radians) a wall has to have to count as drafted. */
  required: number;
  faces: DraftFace[];
  /** Per class: the number of faces and their area (mm²). */
  totals: Record<DraftClass, { faces: number; area: number }>;
}

/**
 * What a face is to a mold that opens along a direction, by what can be seen of it (undercut analysis, E3.3): `up` only from the `+pull` side, `down` only from the
 * `-pull` side, `both` from either (a wall along the pull: it needs draft), `split` seen from each side in different parts (the mold parts across it), `partial` with
 * some of it seen from neither side, `undercut` all of it seen from neither (it cannot be formed without a slide), `unknown` for a face that could not be sampled.
 */
export type UndercutClass = 'up' | 'down' | 'both' | 'split' | 'partial' | 'undercut' | 'unknown';

export interface UndercutFace {
  face: number;
  kind: UndercutClass;
  /** The share (0 to 1, by area) of the face that nothing is in the way of along `+pull`, along `-pull`, and that is seen from neither. */
  up: number;
  down: number;
  blocked: number;
  samples: number;
  area: number;
}

export interface UndercutReport {
  faces: UndercutFace[];
  totals: Record<UndercutClass, { faces: number; area: number }>;
  /** The area (mm2) seen from neither side, over all the faces: the part of the surface a slide has to form. */
  undercutArea: number;
  /** The triangles of the mesh the rays were shot at, the points they were shot from, and how long it took (ms). */
  triangles: number;
  samples: number;
  ms: number;
}

/**
 * What a face is to the wall thickness asked for (thickness analysis, E3.5): `thin` where more than a twentieth of it is thinner than the least thickness, `thick` where more
 * than half of it is thicker than the greatest (a corner can be thick in a wall that is not), `ok` otherwise, `open` where there is no surface on the other side to measure to (a sheet), `unknown` for a face that could
 * not be sampled.
 */
export type ThicknessClass = 'thin' | 'ok' | 'thick' | 'open' | 'unknown';

export interface ThicknessFace {
  face: number;
  kind: ThicknessClass;
  /** The least, the median (by area) and the greatest thickness (mm) over the points of the face that have a surface on the other side; NaN when none has. The median, because
   * near the edges and corners of a face the ray can run down the whole length of the wall next to it, which makes the greatest and the mean mean little (ADR 0077). */
  min: number;
  median: number;
  max: number;
  /** The share (0 to 1, by area) of the face thinner than the least thickness asked, thicker than the greatest, and with no surface on the other side to measure to. */
  thinShare: number;
  thickShare: number;
  openShare: number;
  samples: number;
  area: number;
}

/** Where a thickness was found: the thickness (mm), the point on the surface, and the face. */
export interface ThicknessSpot {
  thickness: number;
  point: Vec3;
  face: number;
}

export interface ThicknessReport {
  /** The limits asked for (mm); null for none. */
  least: number | null;
  greatest: number | null;
  faces: ThicknessFace[];
  totals: Record<ThicknessClass, { faces: number; area: number }>;
  /** The thinnest and the thickest place found (null when no point had a surface to measure to). */
  thinnest: ThicknessSpot | null;
  thickest: ThicknessSpot | null;
  triangles: number;
  samples: number;
  ms: number;
}

/** What a face of the tool of a lip or groove is (`Kernel.ringTool`): its end (`start` on the face it stands on, `end` the far one), or a side made from an edge of that face, on the outside of the ring or the inside. */
export type RingSide = { kind: 'cap'; which: 'start' | 'end' } | { kind: 'side'; edge: number; inner: boolean };

/** How far a shape is from another, by points sampled on it (`Kernel.gapReport`): the nearest distances from those points to the other shape. */
export interface GapReport {
  samples: number;
  min: number;
  max: number;
  mean: number;
  /** The largest |distance − the distance expected|. */
  deviation: number;
  /** The sampled point where that is. */
  worst: Vec3;
}

export interface FaceInfo {
  /** "plane", "cylinder", "cone", "sphere", "torus", "bspline", … */
  surface: string;
  area: number;
  center: Vec3;
  /** Outward normal for planar faces, null otherwise. */
  normal: Vec3 | null;
  /** Analytic surfaces only; freeform faces have none. */
  geometry?: SurfaceGeometry;
}

export interface EdgeInfo {
  /** "line", "circle", "ellipse", "bspline", … */
  curve: string;
  length: number;
  mid: Vec3;
  /** Direction for straight edges, null otherwise. */
  dir: Vec3 | null;
  /** Lines and circles only. */
  geometry?: CurveGeometry;
  /** Adjacent face indices (0-based, explorer order). */
  faces: number[];
  vertices: number[];
}

export interface VertexInfo {
  point: Vec3;
  faces: number[];
}

/** Topology of a shape. Indices are positions in OCCT explorer order and are NOT persistent. */
export interface Topology {
  faces: FaceInfo[];
  edges: EdgeInfo[];
  vertices: VertexInfo[];
}

/** Where an output face came from — the raw material for persistent naming (A1.8). */
export type FaceOrigin =
  | { rel: 'same' | 'modified'; kind: 'face'; index: number }
  | { rel: 'generated'; kind: 'edge' | 'vertex' | 'face'; index: number }
  | { rel: 'generated'; kind: 'profileEdge'; source: string }
  | { rel: 'cap'; which: 'start' | 'end' }
  /** Face `index` of an imported shape, in the order the file defines them. */
  | { rel: 'imported'; index: number };

export interface OpResult {
  shape: ShapeId;
  /** faceOrigins[i] lists the origins of output face i. */
  faceOrigins: FaceOrigin[][];
}

/** What the kernel found in a file and what it did about it (F2.2, A1.7): numbers, so the interface can say it in words. */
export interface ImportDiagnostics {
  /** Solids the file holds; 0 when it only has surfaces. */
  solids: number;
  faces: number;
  /** Faces that belong to no solid and were left out (0 when they were sewn into one). */
  looseFaces: number;
  /** Whether the file's shape passed the validity check as it was read. */
  validBefore: boolean;
  /** The shape failed the check and was healed. */
  healed: boolean;
  /** Surfaces were sewn into solids, within `sewTolerance` mm. */
  sewn: boolean;
  sewTolerance: number | null;
  /** Edges that still belonged to one face after sewing: 0 means the surfaces closed up. */
  freeEdges: number | null;
  /** Whether what is used now passes the check. */
  validAfter: boolean;
}

export interface ImportOptions {
  /** How far apart two faces' edges may be and still be one edge when surfaces are sewn into a solid, in mm. */
  sewTolerance?: number;
}

export interface ImportResult extends OpResult {
  /** What was repaired or left out on the way in (F2.2), in words. */
  warnings: string[];
  diagnostics: ImportDiagnostics;
}

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** Triplets (startIndex, indexCount, faceIndex) into `indices`. */
  faceRanges: Int32Array;
  /** Edge polylines, xyz per point. */
  edgePoints: Float32Array;
  /** Triplets (startPoint, pointCount, edgeIndex) into `edgePoints`. */
  edgeRanges: Int32Array;
}

/**
 * How finely a shape is meshed. `tolerance` is the largest chord error in mm; `relative` sets it as a
 * fraction of the shape's bounding-box diagonal instead (never below 0.002 mm nor above 1 mm);
 * `angular` is the largest turn in radians between neighbouring mesh normals. Without any: 5e-4, 0.25.
 */
export interface MeshOptions {
  tolerance?: number;
  relative?: number;
  angular?: number;
}

/** Where the viewer is and how the drawing is laid out (C16.2): the direction the viewer looks along, and which way is up on the sheet. Not parallel. */
export interface ViewDirection {
  dir: Vec3;
  up: Vec3;
}

/**
 * A shape seen from a direction as lines (A4.4): the edges that can be seen and the ones hidden behind the material, each a polyline of x, y, x, y … in view
 * coordinates (x to the right, y up on the sheet, the origin the projection of the world's origin), in mm and at full size.
 */
export interface ProjectedView {
  visible: number[][];
  hidden: number[][];
  /** The box of what can be seen (hidden lines are inside it or on it) in view coordinates; null when nothing is seen. */
  box: { min: [number, number]; max: [number, number] } | null;
  /** A section (C16.3): the outlines of the faces the cut made, as closed polylines in the same coordinates, for hatching. Absent for a view of the whole. */
  cut?: number[][];
  /** Chain lines: the bend lines of a flat pattern (S-1). */
  center?: number[][];
  /** Asked for (`mesh: true`, ADR 0146): the faces of what is seen, as triangles in the same coordinates, for shading. */
  mesh?: ViewMesh;
}

/**
 * The faces of a shape seen from a view (ADR 0146): its mesh turned into the view's coordinates — x to the right and y up on the sheet as the lines are, z toward
 * the viewer (larger is nearer) — with the normals turned the same way. Shared vertices per face, as `MeshData` has them.
 */
export interface ViewMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

/**
 * The mesh of a component in an assembly (2F): seen small and among others, so about half as many
 * triangles as a part being edited (the angle limit is what sets their number, more than the tolerance).
 * 1e-3 of the diagonal is under a pixel when the whole component fills the view.
 */
export const COMPONENT_MESH: MeshOptions = { relative: 1e-3, angular: 0.5 };

export interface MassProps {
  volume: number;
  area: number;
  center: Vec3;
  /** The matrix of inertia about the center of mass, in the global axes, for a density of one (so its entries are in mm⁵ and scale with the density): row-major 3 × 3 (E1.2). */
  inertia: number[];
}

/** The shortest distance between two shapes, and the points that make it (E1.1). */
export interface Distance {
  distance: number;
  pointA: Vec3;
  pointB: Vec3;
}

/** What the check of a shape found (E3.1). */
export interface GeometryReport {
  /** The whole shape passes BRepCheck. */
  valid: boolean;
  solids: number;
  faces: number;
  /** Numbers (in the order of Kernel.topology) of the faces that fail the check. */
  badFaces: number[];
  /** Edges that belong to only one face (an open shell, a hole in the skin): 0 for a closed solid. */
  freeEdges: number;
  /** Volume of the solids together; zero or negative is wrong. */
  volume: number;
}

export class KernelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KernelError';
  }
}

/** A component of an assembly read from STEP (F2.8): which product it is, and where it is in the product it belongs to (a rigid motion: row-major 3 × 3 and a translation, millimetres). */
export interface StepAssemblyNode {
  name: string | null;
  /** Index of `StepAssemblyContents.prototypes`. */
  prototype: number;
  rotation: number[];
  translation: Vec3;
}

/** A product of a STEP file: a part (a shape) or an assembly (components). Each is one entry however many components use it. */
export interface StepAssemblyPrototype {
  name: string | null;
  /** Parts: the shape, which the caller releases (`Kernel.release`). Absent for an assembly. */
  shape?: ShapeId;
  /** Parts: "#rrggbb" or null for each face of `shape`, in the order of `Kernel.topology`. */
  faceColors?: (string | null)[];
  /** Parts: the color of the whole product, when it has one and not every face does. */
  color?: string | null;
  /** Assemblies: the components. */
  children?: StepAssemblyNode[];
}

/** What an assembly STEP holds (F2.8): the products, and which one is the top. */
export interface StepAssemblyContents {
  prototypes: StepAssemblyPrototype[];
  root: number;
}

/**
 * A component of an assembly STEP (F1.2): which part it places (`part`, an index of the parts given) or which sub-assembly
 * (`sub`, an index of the sub-assemblies given), its name in the tree, and where it is: a position and a unit quaternion x y z w.
 */
export interface StepComponent {
  part?: number;
  sub?: number;
  name: string;
  position: Vec3;
  rotation: [number, number, number, number];
}

/** What a STEP file of a part carries beyond its shape (F1.3): the schema, and a color for faces. */
export interface StepExportOptions {
  /** AP214 (the default) or AP242. */
  schema?: 'AP214' | 'AP242';
  /** "#rrggbb" or null for each face, in the order of `Kernel.topology`. */
  faceColors?: readonly (string | null)[];
}
