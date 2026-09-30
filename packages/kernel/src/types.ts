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
  | { rel: 'generated'; kind: 'edge' | 'vertex'; index: number }
  | { rel: 'generated'; kind: 'profileEdge'; source: string }
  | { rel: 'cap'; which: 'start' | 'end' }
  /** Face `index` of an imported shape, in the order the file defines them. */
  | { rel: 'imported'; index: number };

export interface OpResult {
  shape: ShapeId;
  /** faceOrigins[i] lists the origins of output face i. */
  faceOrigins: FaceOrigin[][];
}

export interface ImportResult extends OpResult {
  /** What was repaired or left out on the way in (F2.2). */
  warnings: string[];
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
}

export class KernelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KernelError';
  }
}
