export type Vec3 = [number, number, number];

/** Opaque handle to a shape held by the kernel. Released explicitly (WASM memory is not garbage collected). */
export type ShapeId = number & { readonly __brand: 'ShapeId' };

export interface FaceInfo {
  /** "plane", "cylinder", "cone", "sphere", "torus", "bspline", … */
  surface: string;
  area: number;
  center: Vec3;
  /** Outward normal for planar faces, null otherwise. */
  normal: Vec3 | null;
}

export interface EdgeInfo {
  /** "line", "circle", "ellipse", "bspline", … */
  curve: string;
  length: number;
  mid: Vec3;
  /** Direction for straight edges, null otherwise. */
  dir: Vec3 | null;
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
