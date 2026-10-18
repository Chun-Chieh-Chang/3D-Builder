import * as THREE from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from 'three-mesh-bvh';
import { ViewControls } from './controls';
import { cubeDirection, nearestView, orbitView, panView, restoreView, rollView, viewState, ViewHistory, zoomView } from './viewNav';
import { circleCentre, middleOf, polylinesOf, type V3 } from './snap';
import { buildOverlayObjects, disposeGroup, toWorld, type P2, type PlaneFrame, type SketchOverlay } from './overlay';

/** A picture of a sketch to be drawn (ADR 0116): its place in the plane (the centre, the size in mm, the turn in degrees), how see-through it is, and the decoded image. */
export interface ViewPicture {
  frame: PlaneFrame;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  opacity: number;
  image: TexImageSource;
}

/** Mesh payload produced by the kernel worker (same layout as @3db/kernel MeshData). */
export interface ViewMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  faceRanges: Int32Array;
  edgePoints: Float32Array;
  edgeRanges: Int32Array;
}

/** How the model is drawn (A4.3): shaded with edges, shaded, hidden lines removed (white fill), hidden lines dashed, or wireframe. */
export type DisplayMode = 'shadedEdges' | 'shaded' | 'hiddenRemoved' | 'hiddenVisible' | 'wireframe';

/** A cut through the model (D4.4): what is on the side of `normal` beyond `offset` (the points with normal · p > offset) is left out. */
export interface SectionPlane {
  normal: [number, number, number];
  offset: number;
}

/** What the user lets be picked (D5.4). */
export interface PickFilter {
  faces: boolean;
  edges: boolean;
  vertices: boolean;
  /** The reference planes that are shown (ADR 0127). */
  planes: boolean;
}

export type StandardView = 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right' | 'iso';
/** The six views straight along an axis (all the standard views but the isometric one). */
export type PrincipalView = Exclude<StandardView, 'iso'>;
/** The view from the other side. */
export const OPPOSITE_VIEW: Readonly<Record<PrincipalView, PrincipalView>> = { front: 'back', back: 'front', top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
/** The order a tie between principal views is settled in: a camera on a diagonal (the isometric view) goes to the front. */
const PRINCIPAL_ORDER: readonly PrincipalView[] = ['front', 'right', 'top', 'back', 'left', 'bottom'];

const VIEW_DIRS: Record<StandardView, [THREE.Vector3, THREE.Vector3]> = {
  front: [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)],
  back: [new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)],
  top: [new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1)],
  bottom: [new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1)],
  left: [new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)],
  right: [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)],
  iso: [new THREE.Vector3(1, 1, 1).normalize(), new THREE.Vector3(0, 1, 0)],
};

/** The directions the camera sits on for the principal views, for `nearestView`. */
const VIEW_DIRS_OF: Readonly<Record<PrincipalView, readonly number[]>> = Object.fromEntries((Object.keys(OPPOSITE_VIEW) as PrincipalView[]).map((v) => [v, VIEW_DIRS[v][0].toArray()])) as unknown as Record<PrincipalView, number[]>;

/**
 * What the graphics area is drawn with. These are the renderer's own copy of colours the
 * application declares in its stylesheet: WebGL takes numbers, not `var(...)`, so
 * `apps/web/src/theme.ts` resolves the stylesheet and calls `setPalette` before a viewer is built.
 * The values here are the fallback for a renderer used outside the application (a test, a spike).
 */
export const COLORS = {
  /** the shaded body */
  body: 0xb8c4d0,
  /** a visible edge, and what a part is drawn with in wireframe */
  edge: 0x1d232b,
  /** an edge behind the material, where hidden lines are shown */
  ghost: 0x8b98a8,
  edgeHover: 0xf08c00,
  edgeSelected: 0x1864ab,
  /** what the area behind the model is cleared to */
  background: 0xf3f5f8,
  /** what fills the cut of a section */
  cap: 0xd9a45b,
  /** the line along that cut */
  section: 0x1c4e9a,
  /** the mark left where the pointer found something to snap to */
  snap: 0xf08c00,
  componentHover: 0xf2c48d,
  componentSelected: 0x8fb8e8,
  componentCollided: 0xe5484d,
};

export type Palette = typeof COLORS;

/** Hand the renderer the colours the application's stylesheet resolved to. */
export const setPalette = (next: Partial<Palette>): void => {
  Object.assign(COLORS, next);
};

/**
 * What measuring draws in the graphics area (as eDrawings does): the lines (the shortest way, and the distances along the axes, each in a colour), a dot at the ends, and
 * a label on each (a name in the colour, the number beside it). Points in the scene's own coordinates.
 */
export interface MeasureGraphics {
  lines: { a: [number, number, number]; b: [number, number, number]; color: number }[];
  points: [number, number, number][];
  /** `offset`: pixels on the screen from the point, so that labels on the same spot (a leg that is the whole distance) do not lie on each other. */
  labels: { key: string; at: [number, number, number]; name: string; value: string; color: string; offset?: [number, number] }[];
}

/**
 * A place that can be pointed at while measuring (a point anywhere): its kind, where it is in the scene (`world`) and in the part's own frame (`local`: the same for the open part),
 * and the instance of the assembly it is on (null for the open part).
 */
export interface Snap {
  kind: 'vertex' | 'midpoint' | 'centre' | 'edge' | 'face';
  world: [number, number, number];
  local: [number, number, number];
  instance: string | null;
}

/**
 * A placed copy of a part mesh (an assembly component): `part` names a mesh given to setParts, and
 * `matrix` (4×4, column-major) maps the part's coordinates into the scene.
 */
export interface ViewInstance {
  key: string;
  part: string;
  matrix: ArrayLike<number>;
  /**
   * The component this instance belongs to, when one component shows as several instances (a sub-assembly's parts, C15.4):
   * hovering, selecting and dragging act on the owner, and the events say its key. Default: the instance's own key.
   */
  owner?: string;
  /** Drawn see-through (C15.5). */
  transparent?: boolean;
}

/** A part mesh instances can show, and its vertices (xyz each, in the order of its vertex names). */
export interface ViewPart {
  mesh: ViewMesh;
  vertices?: Float32Array;
}

/** An element of a placed part: a face, edge or vertex, by its index in the part's mesh. */
export interface InstanceElement {
  key: string;
  kind: 'face' | 'edge' | 'vertex';
  index: number;
}

interface PartGeometry {
  mesh: ViewMesh;
  body: THREE.BufferGeometry;
  edges: THREE.BufferGeometry;
  /** triangleFace[t] = face owning triangle t; segmentEdge[s] = edge owning line segment s. */
  triangleFace: Int32Array;
  segmentEdge: Int32Array;
  vertices: Float32Array;
  silIndex: SilhouetteIndex | null;
}

interface Instance {
  part: string;
  /** The component it belongs to (see `ViewInstance.owner`). */
  owner: string;
  group: THREE.Group;
  body: THREE.Mesh;
  edges: THREE.LineSegments | null;
  /** Hovered and selected elements, drawn in the part's coordinates so they follow the component. */
  marks: THREE.Group;
}

// Rays against the body go through a bounding-volume hierarchy (A5.3): a few hundred thousand triangles take ~10 ms to test one by one, ~0.1 ms this way.
THREE.Mesh.prototype.raycast = acceleratedRaycast;
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

function bodyGeometry(mesh: ViewMesh): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  // `indirect`: the tree keeps its own order, so the triangle numbers (and the index buffer shared with the rebuild result) stay as the faces' ranges say
  g.computeBoundsTree({ indirect: true });
  return g;
}

/** The edges as line segments, and the edge each segment belongs to. */
function edgeSegments(mesh: ViewMesh): { segs: number[]; owner: number[] } {
  const segs: number[] = [];
  const owner: number[] = [];
  for (let g = 0; g < mesh.edgeRanges.length; g += 3) {
    const start = mesh.edgeRanges[g]!;
    const count = mesh.edgeRanges[g + 1]!;
    const edge = mesh.edgeRanges[g + 2]!;
    for (let p = start; p < start + count - 1; p++) {
      segs.push(...mesh.edgePoints.subarray(p * 3, p * 3 + 6));
      owner.push(edge);
    }
  }
  return { segs, owner };
}

const IDENTITY_M4 = new THREE.Matrix4();

/**
 * The segments of several solids end to end, as one array for a line geometry. Not `push(...s)`: a spread passes every number as an argument,
 * and V8 throws a RangeError between 120 000 and 150 000 of them (about 20 000 segments of one solid).
 */
export function joinSegments(parts: readonly ArrayLike<number>[]): Float32Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Float32Array(n);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * Slices a triangle mesh by a plane, returning line segments in world coordinates (two points per segment: x0, y0, z0, x1, y1, z1, ...).
 * Robustly classifies vertices so that every intersecting triangle produces exactly one segment on the cut plane.
 */
export function sliceMeshByPlane(geometry: THREE.BufferGeometry, plane: THREE.Plane, matrixWorld?: THREE.Matrix4): number[] {
  const pos = geometry.getAttribute('position');
  if (!pos || pos.count < 3) return [];

  const localPlane = plane.clone();
  const hasMatrix = !!matrixWorld && !matrixWorld.equals(IDENTITY_M4);
  if (hasMatrix) {
    const inv = new THREE.Matrix4().copy(matrixWorld).invert();
    localPlane.applyMatrix4(inv);
  }

  const nx = localPlane.normal.x;
  const ny = localPlane.normal.y;
  const nz = localPlane.normal.z;
  const c = localPlane.constant;

  const index = geometry.getIndex();
  const triCount = index ? Math.floor(index.count / 3) : Math.floor(pos.count / 3);
  const idxArr = index ? (index.array as ArrayLike<number>) : null;
  const posArr = pos.array as ArrayLike<number>;
  const segs: number[] = [];

  const pA = new THREE.Vector3();
  const pB = new THREE.Vector3();

  for (let i = 0; i < triCount; i++) {
    const i0 = idxArr ? idxArr[i * 3]! : i * 3;
    const i1 = idxArr ? idxArr[i * 3 + 1]! : i * 3 + 1;
    const i2 = idxArr ? idxArr[i * 3 + 2]! : i * 3 + 2;

    const x0 = posArr[i0 * 3]!, y0 = posArr[i0 * 3 + 1]!, z0 = posArr[i0 * 3 + 2]!;
    const x1 = posArr[i1 * 3]!, y1 = posArr[i1 * 3 + 1]!, z1 = posArr[i1 * 3 + 2]!;
    const x2 = posArr[i2 * 3]!, y2 = posArr[i2 * 3 + 1]!, z2 = posArr[i2 * 3 + 2]!;

    let d0 = nx * x0 + ny * y0 + nz * z0 + c;
    let d1 = nx * x1 + ny * y1 + nz * z1 + c;
    let d2 = nx * x2 + ny * y2 + nz * z2 + c;

    if (Math.abs(d0) < 1e-7) d0 = d0 >= 0 ? 1e-7 : -1e-7;
    if (Math.abs(d1) < 1e-7) d1 = d1 >= 0 ? 1e-7 : -1e-7;
    if (Math.abs(d2) < 1e-7) d2 = d2 >= 0 ? 1e-7 : -1e-7;

    const s0 = d0 > 0;
    const s1 = d1 > 0;
    const s2 = d2 > 0;

    if (s0 === s1 && s1 === s2) continue;

    let ax: number, ay: number, az: number;
    let bx: number, by: number, bz: number;

    if (s0 !== s1 && s0 !== s2) {
      const t1 = d0 / (d0 - d1);
      const t2 = d0 / (d0 - d2);
      ax = x0 + t1 * (x1 - x0);
      ay = y0 + t1 * (y1 - y0);
      az = z0 + t1 * (z1 - z0);
      bx = x0 + t2 * (x2 - x0);
      by = y0 + t2 * (y2 - y0);
      bz = z0 + t2 * (z2 - z0);
    } else if (s1 !== s0 && s1 !== s2) {
      const t0 = d1 / (d1 - d0);
      const t2 = d1 / (d1 - d2);
      ax = x1 + t0 * (x0 - x1);
      ay = y1 + t0 * (y0 - y1);
      az = z1 + t0 * (z0 - z1);
      bx = x1 + t2 * (x2 - x1);
      by = y1 + t2 * (y2 - y1);
      bz = z1 + t2 * (z2 - z1);
    } else {
      const t0 = d2 / (d2 - d0);
      const t1 = d2 / (d2 - d1);
      ax = x2 + t0 * (x0 - x2);
      ay = y2 + t0 * (y0 - y2);
      az = z2 + t0 * (z0 - z2);
      bx = x2 + t1 * (x1 - x2);
      by = y2 + t1 * (y1 - y2);
      bz = z2 + t1 * (z1 - z2);
    }
    // a triangle with a vertex that is not a number (NaN, ±Infinity, or an index past the vertices) has no place on the cut: leave it out rather than
    // hand the line geometry a NaN (three.js then cannot bound it, and says so on the console); the other triangles still give the outline
    if (!(Number.isFinite(ax) && Number.isFinite(ay) && Number.isFinite(az) && Number.isFinite(bx) && Number.isFinite(by) && Number.isFinite(bz))) continue;

    if (hasMatrix) {
      pA.set(ax, ay, az).applyMatrix4(matrixWorld);
      pB.set(bx, by, bz).applyMatrix4(matrixWorld);
      segs.push(pA.x, pA.y, pA.z, pB.x, pB.y, pB.z);
    } else {
      segs.push(ax, ay, az, bx, by, bz);
    }
  }

  return segs;
}

/**
 * Two triangles whose normals are closer than this lie in one plane, give or take float noise (under 1e-7 in 1 - dot on OCCT meshes): the edge between
 * them is no silhouette. About 0.026 degrees. Taking a noisy flat pair for curved is harmless: it can only be a silhouette with the plane edge-on, where
 * it is drawn over the plane's own outline.
 */
const COPLANAR_DOT = 1 - 1e-7;

/** Precomputed adjacency and normal data for real-time dynamic silhouette extraction (SW style). */
export interface SilhouetteIndex {
  normals: Float32Array;
  edgesV0: Int32Array;
  edgesV1: Int32Array;
  edgesT0: Int32Array;
  edgesT1: Int32Array;
  edgeCount: number;
  faceCount: number;
  faceDots: Float32Array;
}

/**
 * Builds edge adjacency and face normals for a triangle mesh.
 * Flat face internal edges (coplanar) are excluded to maximize extraction performance.
 */
export function buildSilhouetteIndex(geometry: THREE.BufferGeometry): SilhouetteIndex | null {
  const pos = geometry.getAttribute('position');
  if (!pos || pos.count < 3) return null;

  const index = geometry.getIndex();
  const triCount = index ? Math.floor(index.count / 3) : Math.floor(pos.count / 3);
  if (triCount === 0) return null;

  const posArr = pos.array as ArrayLike<number>;
  const idxArr = index ? (index.array as ArrayLike<number>) : null;

  const normals = new Float32Array(triCount * 3);
  const faceDots = new Float32Array(triCount);

  // 1. Calculate face normals
  for (let t = 0; t < triCount; t++) {
    const i0 = idxArr ? idxArr[t * 3]! : t * 3;
    const i1 = idxArr ? idxArr[t * 3 + 1]! : t * 3 + 1;
    const i2 = idxArr ? idxArr[t * 3 + 2]! : t * 3 + 2;

    const ax = posArr[i0 * 3]!, ay = posArr[i0 * 3 + 1]!, az = posArr[i0 * 3 + 2]!;
    const bx = posArr[i1 * 3]!, by = posArr[i1 * 3 + 1]!, bz = posArr[i1 * 3 + 2]!;
    const cx = posArr[i2 * 3]!, cy = posArr[i2 * 3 + 1]!, cz = posArr[i2 * 3 + 2]!;

    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const acx = cx - ax, acy = cy - ay, acz = cz - az;

    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;

    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-12) {
      nx /= len;
      ny /= len;
      nz /= len;
    } else {
      nx = 0;
      ny = 0;
      nz = 0;
    }
    normals[t * 3] = nx;
    normals[t * 3 + 1] = ny;
    normals[t * 3 + 2] = nz;
  }

  // 2. Identify shared interior edges between triangles (unifying duplicate seam vertices)
  const vertexMap = new Map<string, number>();
  const canonical = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const kx = Math.round(posArr[i * 3]! * 1000);
    const ky = Math.round(posArr[i * 3 + 1]! * 1000);
    const kz = Math.round(posArr[i * 3 + 2]! * 1000);
    const key = `${kx}_${ky}_${kz}`;
    let id = vertexMap.get(key);
    if (id === undefined) {
      id = i;
      vertexMap.set(key, id);
    }
    canonical[i] = id;
  }

  const edgeMap = new Map<string, { v0: number; v1: number; t0: number; t1: number }>();

  const addEdge = (va: number, vb: number, t: number) => {
    const ca = canonical[va]!;
    const cb = canonical[vb]!;
    if (ca === cb) return;
    const u = Math.min(ca, cb);
    const v = Math.max(ca, cb);
    const key = `${u}_${v}`;
    const existing = edgeMap.get(key);
    if (!existing) {
      edgeMap.set(key, { v0: ca, v1: cb, t0: t, t1: -1 });
    } else if (existing.t1 === -1 && existing.t0 !== t) {
      existing.t1 = t;
    }
  };

  for (let t = 0; t < triCount; t++) {
    const i0 = idxArr ? idxArr[t * 3]! : t * 3;
    const i1 = idxArr ? idxArr[t * 3 + 1]! : t * 3 + 1;
    const i2 = idxArr ? idxArr[t * 3 + 2]! : t * 3 + 2;
    addEdge(i0, i1, t);
    addEdge(i1, i2, t);
    addEdge(i2, i0, t);
  }

  // 3. Filter candidate edges: skip boundary edges and virtually coplanar triangles (flat faces)
  const v0List: number[] = [];
  const v1List: number[] = [];
  const t0List: number[] = [];
  const t1List: number[] = [];

  for (const edge of edgeMap.values()) {
    if (edge.t1 === -1) continue;

    const t0 = edge.t0;
    const t1 = edge.t1;
    const nx0 = normals[t0 * 3]!, ny0 = normals[t0 * 3 + 1]!, nz0 = normals[t0 * 3 + 2]!;
    const nx1 = normals[t1 * 3]!, ny1 = normals[t1 * 3 + 1]!, nz1 = normals[t1 * 3 + 2]!;

    const dot = nx0 * nx1 + ny0 * ny1 + nz0 * nz1;
    // Keep only smooth curved surface interior edges (angle between ~0.026 deg and ~75 deg)
    // Sharp crease edges (angle >= 75 deg, dot < 0.25) are already B-Rep topological edges in this.edges.
    // Coplanar triangles (a flat face, or the two halves of one strip of a curved face) differ only by float noise, measured on OCCT meshes at
    // under 1e-7 in 1 - dot. Neighbouring strips of a shallow curve are further apart than that: R1000 on a 63 mm part meshed fine is 0.26 deg
    // (1e-5), R10000 0.087 deg (1.2e-6). The old cut (dot > 0.9999, 0.81 deg) took those for flat, and they had no silhouette.
    if (dot < 0.25 || dot > COPLANAR_DOT) continue;

    v0List.push(edge.v0);
    v1List.push(edge.v1);
    t0List.push(t0);
    t1List.push(t1);
  }

  return {
    normals,
    faceDots,
    faceCount: triCount,
    edgesV0: Int32Array.from(v0List),
    edgesV1: Int32Array.from(v1List),
    edgesT0: Int32Array.from(t0List),
    edgesT1: Int32Array.from(t1List),
    edgeCount: v0List.length,
  };
}

/**
 * Extracts view-dependent dynamic silhouette line segments from SilhouetteIndex.
 * An edge is a silhouette edge when one adjacent triangle faces the camera (n · v > 0)
 * and the other faces away (n · v <= 0).
 */
export function extractSilhouettes(
  index: SilhouetteIndex,
  pos: ArrayLike<number>,
  viewDir: THREE.Vector3,
  matrixWorld?: THREE.Matrix4,
): number[] {
  if (index.edgeCount === 0) return [];

  const localV = viewDir.clone();
  const hasMatrix = !!matrixWorld && !matrixWorld.equals(IDENTITY_M4);
  if (hasMatrix) {
    const inv = new THREE.Matrix4().copy(matrixWorld).invert();
    localV.transformDirection(inv);
  }
  localV.normalize();

  const vx = localV.x;
  const vy = localV.y;
  const vz = localV.z;

  const normals = index.normals;
  const faceDots = index.faceDots;
  const faceCount = index.faceCount;

  for (let t = 0; t < faceCount; t++) {
    faceDots[t] = normals[t * 3]! * vx + normals[t * 3 + 1]! * vy + normals[t * 3 + 2]! * vz;
  }

  const v0 = index.edgesV0;
  const v1 = index.edgesV1;
  const t0 = index.edgesT0;
  const t1 = index.edgesT1;
  const edgeCount = index.edgeCount;
  const segs: number[] = [];

  const pA = new THREE.Vector3();
  const pB = new THREE.Vector3();

  for (let e = 0; e < edgeCount; e++) {
    const d0 = faceDots[t0[e]!]!;
    const d1 = faceDots[t1[e]!]!;
    if ((d0 > 0 && d1 <= 0) || (d0 <= 0 && d1 > 0)) {
      const i0 = v0[e]!;
      const i1 = v1[e]!;
      const x0 = pos[i0 * 3]!, y0 = pos[i0 * 3 + 1]!, z0 = pos[i0 * 3 + 2]!;
      const x1 = pos[i1 * 3]!, y1 = pos[i1 * 3 + 1]!, z1 = pos[i1 * 3 + 2]!;

      if (hasMatrix) {
        pA.set(x0, y0, z0).applyMatrix4(matrixWorld);
        pB.set(x1, y1, z1).applyMatrix4(matrixWorld);
        segs.push(pA.x, pA.y, pA.z, pB.x, pB.y, pB.z);
      } else {
        segs.push(x0, y0, z0, x1, y1, z1);
      }
    }
  }

  return segs;
}

const bodyMaterial = (options: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color: COLORS.body, metalness: 0.15, roughness: 0.55, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, ...options });

function setMatrix(group: THREE.Object3D, matrix: ArrayLike<number>): void {
  group.matrix.fromArray(Array.from(matrix));
  group.updateMatrixWorld(true);
}

/** A reference plane to show (D4.6): drawn as a translucent square around the model. */
export interface PlaneDisplay {
  key: string;
  frame: PlaneFrame;
  highlighted?: boolean;
}

/**
 * Reference axes, points and coordinate systems to show (D4.6, C3.3–C3.5). An axis is a line through the model's extent, a point a dot, a coordinate
 * system three arrows: the last two a constant length on screen.
 */
export interface DatumDisplay {
  axes: { key: string; origin: [number, number, number]; dir: [number, number, number]; highlighted?: boolean }[];
  points: { key: string; p: [number, number, number]; highlighted?: boolean }[];
  systems: { key: string; origin: [number, number, number]; x: [number, number, number]; y: [number, number, number]; z: [number, number, number]; highlighted?: boolean }[];
}

/** Pointer input on the graphics area while a tool (e.g. a sketch tool) owns the left button. */
export interface ToolPointerEvent {
  type: 'down' | 'move' | 'up' | 'dblclick' | 'leave';
  clientX: number;
  clientY: number;
  ctrl: boolean;
  shift: boolean;
  /** Left button held (for moves). */
  pressed: boolean;
}

/** The pointer during a component drag (C15.3). */
export interface ComponentDragEvent {
  /** The line under the cursor, in scene coordinates. */
  origin: [number, number, number];
  dir: [number, number, number];
  /** How far the pointer is from where the drag began, in CSS pixels (x to the right, y down). */
  dx: number;
  dy: number;
  /** The screen's right and up directions in the scene (for turning). */
  right: [number, number, number];
  up: [number, number, number];
}

export interface ViewerEvents {
  /** The right button was pressed and released on the graphics area (not while a tool owns it). */
  onContextMenu?: (clientX: number, clientY: number) => void;
  /** The right button was pressed and released while a tool owns the left one (a sketch is being edited): the sketch's own menu (快速抓取), not the picking menu. */
  onToolContextMenu?: (clientX: number, clientY: number) => void;
  /** A right click (not a right drag, which turns a component) on the graphics area of an assembly: the component under the cursor, or null. */
  onComponentContextMenu?: (key: string | null, clientX: number, clientY: number) => void;
  /** Edge under the cursor changed (index into the mesh's edges, or -1). */
  onEdgeHover?: (edge: number) => void;
  /** Left click on an edge (or -1 on empty space / faces). */
  onEdgeClick?: (edge: number, additive: boolean) => void;
  /** Face under the cursor changed (index into the mesh's faces, or -1). */
  onFaceHover?: (face: number) => void;
  /** Left click on a face (or -1 on empty space). */
  onFaceClick?: (face: number, additive: boolean) => void;
  /**
   * Left click on a reference plane that is shown (D4.6): its key, which is a default plane name
   * ("plane:front") or the id of the reference plane feature (ADR 0127).
   */
  onPlaneClick?: (key: string, additive: boolean) => void;
  /**
   * Left click on a shown reference axis, reference point or coordinate system (its key: the id of the
   * feature, which is what a datum reference names). Only where the model is not in the way (ADR 0127).
   */
  onDatumClick?: (key: string, additive: boolean) => void;
  /** Vertex under the cursor changed (index into the vertices given to setVertices, or -1). */
  onVertexHover?: (vertex: number) => void;
  onVertexClick?: (vertex: number, additive: boolean) => void;
  /** The camera moved, zoomed or the viewport was resized (screen-sized overlays need a new layout). */
  onViewChange?: () => void;
  onLabelClick?: (key: string, additive: boolean) => void;
  onLabelDoubleClick?: (key: string) => void;
  /** A label was dragged with the left button and let go at (clientX, clientY): once, on release, so one drag is one step to undo. */
  onLabelDrag?: (key: string, clientX: number, clientY: number) => void;
  /** Component under the cursor changed (an instance key, or null). */
  onComponentHover?: (key: string | null) => void;
  /** Left click on a component (null on empty space). */
  onComponentClick?: (key: string | null, additive: boolean) => void;
  /** Element of a component under the cursor changed (while elements are picked). */
  onElementHover?: (element: InstanceElement | null) => void;
  onElementClick?: (element: InstanceElement | null, additive: boolean) => void;
  /**
   * A drag began on a component (left button: move it, right button: turn it); `point` is where it was
   * grabbed, in scene coordinates. Returning false refuses the drag (e.g. the component is fixed).
   */
  onComponentDragStart?: (key: string, point: [number, number, number], button: 'left' | 'right') => boolean;
  onComponentDrag?: (e: ComponentDragEvent) => void;
  /** The drag is over: the button was released, or it was cancelled (Esc). */
  onComponentDragEnd?: (cancelled: boolean) => void;
}

export interface CosmeticThreadDisplay {
  threadType: 'external' | 'internal';
  majorDiameter: number;
  minorDiameter: number;
  depth: number;
  endCondition: 'blind' | 'through';
  origin: [number, number, number];
  axis: [number, number, number];
}

/**
 * Framework-agnostic viewport (A4.2, A5.1, D4): shaded body with black edges, orthographic
 * camera like SolidWorks, a headlight, edge picking and highlighting, a reference triad, and an
 * on-top 2D overlay for the sketch being edited.
 */
export class Viewer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly overlayScene = new THREE.Scene();
  private readonly camera: THREE.OrthographicCamera;
  private readonly controls: ViewControls;
  private readonly triadScene = new THREE.Scene();
  private readonly triadCamera = new THREE.OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 10);
  private readonly labelLayer: HTMLDivElement;
  private body: THREE.Mesh | null = null;
  private edges: THREE.LineSegments | null = null;
  /** segmentEdge[s] = edge index owning line segment s. */
  private segmentEdge = new Int32Array(0);
  private hovered = -1;
  private selected = new Set<number>();
  private pickEdges = false;
  private filter: PickFilter = { faces: true, edges: true, vertices: true, planes: true };
  private pickFaces = false;
  private mesh: ViewMesh | null = null;
  /** triangleFace[t] = face index owning triangle t. */
  private triangleFace = new Int32Array(0);
  private hoveredFace = -1;
  private selectedFaces = new Set<number>();
  private faceHighlight: THREE.Mesh | null = null;
  private pickVertices = false;
  /** Model vertices, xyz per vertex (for picking and highlighting). */
  private vertices: Float32Array = new Float32Array(0);
  private hoveredVertex = -1;
  private selectedVertices = new Set<number>();
  private vertexHighlight: THREE.Points | null = null;
  /** The color of each face (C14.2): "#rrggbb" or null for the body's own. */
  private faceColors: readonly (string | null)[] = [];
  private displayMode: DisplayMode = 'shadedEdges';
  private clip: THREE.Plane[] = [];
  /** The section as it was asked for (setSection), and who is told when the user drags it with the left button (setSectionDrag). */
  private section: SectionPlane | null = null;
  private sectionDragHandler: ((at: number) => void) | null = null;
  private sectionDrag: { move: (e: PointerEvent) => void; up: () => void } | null = null;
  private sectionCursor = false;
  /** What fills the cut of a section so that the solid does not look hollow (see updateCap), and what it was made for. */
  private cap: { key: string; objects: THREE.Object3D[]; planes: THREE.Mesh[]; materials: THREE.Material[] } | null = null;
  /** Outline edges produced at the section plane intersection. */
  private sectionEdges: THREE.LineSegments | null = null;
  /** Dynamic view-dependent silhouette edges for curved surfaces (SW style). */
  private bodySilIndex: SilhouetteIndex | null = null;
  private silhouetteEdges: THREE.LineSegments | null = null;
  private lastSilViewDir: THREE.Vector3 | null = null;
  /** The edges that lie behind the body, drawn dashed in 'hiddenVisible'. */
  private hiddenEdges: THREE.LineSegments | null = null;
  private readonly viewListeners = new Set<() => void>();
  private planes: PlaneDisplay[] = [];
  private planeGroup: THREE.Group | null = null;
  private cosmeticThreadGroup: THREE.Group | null = null;
  /** Whether the shown planes take clicks (a plane to sketch on, or to put in a reference geometry box). */
  private pickPlanes = false;
  private hoveredPlane: string | null = null;
  private pickDatums = false;
  private hoveredDatum: string | null = null;
  private sketchGroup: THREE.Group | null = null;
  private originShown = false;
  private originGroup: THREE.Group | null = null;
  private guidesGroup: THREE.Group | null = null;
  private datums: DatumDisplay = { axes: [], points: [], systems: [] };
  private datumGroup: THREE.Group | null = null;
  private overlayGroup: THREE.Group | null = null;
  private picturesGroup: THREE.Group | null = null;
  /** `held`: being dragged, so the overlay redrawn meanwhile leaves its screen offset where the pointer put it. */
  private labels = new Map<string, { el: HTMLElement; world: THREE.Vector3; offset?: [number, number]; held?: boolean }>();
  /** What measuring has drawn (see setMeasureGraphics): its own, so that the sketch overlay does not clear it. */
  private measureGroup: THREE.Group | null = null;
  private measureMaterials: LineMaterial[] = [];
  /** While on, a click is a place on the model (setSnapPicking) and the pointer shows the one it would take. */
  /** Told how far a measurement's label was moved by the pointer (pixels since the last move), by its key; null: the labels stay where they are put. */
  private measureLabelDrag: ((key: string, by: [number, number]) => void) | null = null;
  private snapPicking = false;
  private snapEvents: { hover?: (s: Snap | null) => void; pick?: (s: Snap) => void } = {};
  /** The mark of the place the pointer would take (setSnapMarker). */
  private snapMarker: THREE.Points | null = null;
  /** The ends, middles and centres of the edges of a geometry, by the array of its positions (they only change when the geometry does). */
  private snapCache = new WeakMap<object, { lines: Map<number, V3[]>; ends: V3[]; middles: V3[]; centres: V3[] }>();
  private measureLabels = new Map<string, { el: HTMLElement; world: THREE.Vector3; offset: [number, number] }>();
  private toolHandler: ((e: ToolPointerEvent) => void) | null = null;
  /** Part meshes that instances show, by key: built once, shared by every instance of the part. */
  private partGeometry = new Map<string, PartGeometry>();
  private pickElements = false;
  private hoveredElement: InstanceElement | null = null;
  private selectedElements: InstanceElement[] = [];
  private instances = new Map<string, Instance>();
  private readonly instanceEdges = new THREE.LineBasicMaterial({ color: COLORS.edge });
  private pickInstances = false;
  private hoveredInstance: string | null = null;
  private selectedInstances = new Set<string>();
  private collidedInstances = new Set<string>();
  /** A see-through instance following the cursor while a component is being placed. */
  private ghost: Instance | null = null;
  private dragInstances = false;
  /** A button pressed on a component: a drag once the pointer moves a few pixels, else a click. */
  private press: { key: string; point: THREE.Vector3; button: 'left' | 'right'; x: number; y: number; pointerId: number; dragging: boolean } | null = null;
  /** The click the browser sends after a left-button drag is not a click. */
  private swallowClick = false;
  /** A right drag that turned a component ends with a contextmenu event too: it is not a request for the menu. */
  private swallowContext = false;
  private pendingFit = false;
  /** The views gone through, for 「上一個視角」. */
  private readonly viewHistory = new ViewHistory();
  private frame = 0;
  private readonly resizeObserver: ResizeObserver;

  constructor(
    private readonly container: HTMLElement,
    private readonly events: ViewerEvents = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true }); // the stencil buffer fills the cut of a section (updateCap)
    this.renderer.localClippingEnabled = true;
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(COLORS.background);
    this.renderer.autoClear = false;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'overlay-labels';
    container.appendChild(this.labelLayer);

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -1e5, 1e5);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const headlight = new THREE.DirectionalLight(0xffffff, 1.8);
    headlight.position.set(0.3, 0.4, 1);
    this.camera.add(headlight);
    this.scene.add(this.camera);
    this.buildTriad();

    this.controls = new ViewControls(this.camera, this.renderer.domElement, () => this.viewChanged(), () => this.rememberView());
    const dom = this.renderer.domElement;
    dom.addEventListener('pointerdown', this.onSectionDown, true); // before the controls and the component drags: a press on the cut is the cut's
    dom.addEventListener('pointerdown', this.onPointerDown);
    dom.addEventListener('pointermove', this.onPointerMove);
    dom.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('pointerleave', this.onPointerLeave);
    dom.addEventListener('pointercancel', () => this.cancelComponentDrag()); // the system took the pointer
    dom.addEventListener('click', this.onClick);
    dom.addEventListener('contextmenu', (e) => {
      if (this.swallowContext) {
        this.swallowContext = false;
        return;
      }
      if (this.toolHandler) return void this.events.onToolContextMenu?.(e.clientX, e.clientY);
      // components, not the faces of one, while no mate is being defined
      if (this.pickInstances && !this.pickElements && this.events.onComponentContextMenu) return void this.events.onComponentContextMenu(this.pickInstance(e.clientX, e.clientY), e.clientX, e.clientY);
      this.events.onContextMenu?.(e.clientX, e.clientY);
    });
    dom.addEventListener('dblclick', this.onDoubleClick);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.setView('iso');
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.clear();
    this.setOverlay(null);
    this.setSketches([]);
    this.setOrigin(false);
    this.setGuides([]);
    this.setPlanes([]);
    this.setCosmeticThreads([]);
    this.setVertices(new Float32Array(0));
    this.setGhost(null);
    this.setHighlights([]);
    this.setParts(new Map());
    this.setSection(null);
    this.setMeasureGraphics(null);
    this.setMeasureLabelDrag(null);
    this.setSnapMarker(null);
    this.endSectionDrag();
    this.instanceEdges.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.labelLayer.remove();
  }

  // ---------------------------------------------------------------- content

  setMesh(mesh: ViewMesh | null, fit = false): void {
    this.clear();
    if (mesh) {
      this.body = new THREE.Mesh(bodyGeometry(mesh), bodyMaterial());
      this.scene.add(this.body);
      this.buildEdges(mesh);
      this.bodySilIndex = buildSilhouetteIndex(this.body.geometry);
      const owner = new Int32Array(mesh.indices.length / 3);
      for (let r = 0; r < mesh.faceRanges.length; r += 3) owner.fill(mesh.faceRanges[r + 2]!, mesh.faceRanges[r]! / 3, (mesh.faceRanges[r]! + mesh.faceRanges[r + 1]!) / 3);
      this.triangleFace = owner;
    }
    this.mesh = mesh;
    this.hovered = -1;
    this.hoveredFace = -1;
    this.selected.clear();
    this.selectedFaces.clear();
    this.paintFaces();
    this.applyDisplay();
    this.paintFilterLook();
    if (this.planes.length > 0) this.paintPlanes(); // sized to the body
    if (this.datums.axes.length > 0) this.paintDatums();
    if (fit) this.fitView();
    this.requestRender();
  }

  private buildEdges(mesh: ViewMesh): void {
    const { segs, owner } = edgeSegments(mesh);
    this.segmentEdge = Int32Array.from(owner);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
    const colors = new Float32Array((segs.length / 3) * 3);
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.edges = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true }));
    this.scene.add(this.edges);
    this.paintEdges();
  }

  private clear(): void {
    for (const obj of [this.body, this.edges]) {
      if (!obj) continue;
      this.scene.remove(obj);
      obj.geometry.dispose();
      (obj.material as THREE.Material).dispose();
    }
    this.body = null;
    this.edges = null;
    if (this.hiddenEdges) {
      this.scene.remove(this.hiddenEdges);
      this.hiddenEdges.geometry.dispose();
      (this.hiddenEdges.material as THREE.Material).dispose();
      this.hiddenEdges = null;
    }
    if (this.sectionEdges) {
      this.scene.remove(this.sectionEdges);
      this.sectionEdges.geometry.dispose();
      (this.sectionEdges.material as THREE.Material).dispose();
      this.sectionEdges = null;
    }
    this.bodySilIndex = null;
    this.lastSilViewDir = null;
    if (this.silhouetteEdges) {
      this.scene.remove(this.silhouetteEdges);
      this.silhouetteEdges.geometry.dispose();
      (this.silhouetteEdges.material as THREE.Material).dispose();
      this.silhouetteEdges = null;
    }
  }

  // ---------------------------------------------------------------- assembly components (C15.1, A3.1)

  /** The part meshes instances can show, by key. Instances of a part no longer given are removed. */
  setParts(parts: ReadonlyMap<string, ViewPart>): void {
    for (const [key, geo] of this.partGeometry) {
      if (parts.has(key)) continue;
      for (const [k, inst] of this.instances) if (inst.part === key) this.removeInstance(k);
      if (this.ghost?.part === key) this.setGhost(null);
      geo.body.dispose();
      geo.edges.dispose();
      this.partGeometry.delete(key);
    }
    for (const [key, { mesh, vertices }] of parts) {
      if (this.partGeometry.has(key)) continue;
      const { segs, owner } = edgeSegments(mesh);
      const edges = new THREE.BufferGeometry();
      edges.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
      const triangleFace = new Int32Array(mesh.indices.length / 3);
      for (let r = 0; r < mesh.faceRanges.length; r += 3) triangleFace.fill(mesh.faceRanges[r + 2]!, mesh.faceRanges[r]! / 3, (mesh.faceRanges[r]! + mesh.faceRanges[r + 1]!) / 3);
      const bodyGeo = bodyGeometry(mesh);
      this.partGeometry.set(key, { mesh, body: bodyGeo, edges, triangleFace, segmentEdge: Int32Array.from(owner), vertices: vertices ?? new Float32Array(0), silIndex: buildSilhouetteIndex(bodyGeo) });
    }
    this.requestRender();
  }

  /** The components to show; an instance whose part mesh has not been given yet is left out. */
  setInstances(list: ViewInstance[]): void {
    const keep = new Set(list.map((i) => i.key));
    for (const key of [...this.instances.keys()]) if (!keep.has(key)) this.removeInstance(key);
    for (const i of list) {
      let inst = this.instances.get(i.key);
      if (inst && inst.part !== i.part) {
        this.removeInstance(i.key);
        inst = undefined;
      }
      if (!inst) {
        inst = this.makeInstance(i.part, false) ?? undefined;
        if (!inst) continue;
        this.instances.set(i.key, inst);
        this.scene.add(inst.group);
      }
      inst.owner = i.owner ?? i.key;
      const material = inst.body.material as THREE.MeshStandardMaterial;
      if (material.transparent !== !!i.transparent) {
        material.transparent = !!i.transparent;
        material.opacity = i.transparent ? 0.4 : 1;
        material.depthWrite = !i.transparent;
        material.needsUpdate = true;
      }
      this.styleInstance(inst);
      setMatrix(inst.group, i.matrix);
    }
    if (this.hoveredInstance !== null && ![...this.instances.values()].some((i) => i.owner === this.hoveredInstance)) this.setHoveredInstance(null);
    this.updateCap();
    this.updateSectionEdges();
    this.lastSilViewDir = null; // the silhouettes are kept while the camera stays; a component that moved, came, went or turned transparent changes them too
    this.paintInstances();
    if (this.planes.length > 0) this.paintPlanes(); // sized to the content
  }

  /** An instance as the display mode and the section say (A4.3, D4.4), the way applyDisplay does for a part's body. */
  private styleInstance(inst: Instance): void {
    const mode = this.displayMode;
    const m = inst.body.material as THREE.MeshStandardMaterial;
    const cutBefore = m.clippingPlanes?.length ?? 0;
    m.colorWrite = !(mode === 'wireframe' || mode === 'hiddenVisible');
    m.depthWrite = !m.transparent && mode !== 'wireframe';
    m.emissive.set(mode === 'hiddenRemoved' ? 0xffffff : 0x000000);
    m.emissiveIntensity = mode === 'hiddenRemoved' ? 0.85 : 1;
    m.clippingPlanes = this.clip;
    // both sides: looking into the cut shows the walls from within
    if (m.side !== THREE.DoubleSide || cutBefore !== this.clip.length) {
      m.side = THREE.DoubleSide;
      m.needsUpdate = true;
    }
  }

  private makeInstance(part: string, ghost: boolean): Instance | null {
    const geo = this.partGeometry.get(part);
    if (!geo) return null;
    const body = new THREE.Mesh(geo.body, bodyMaterial(ghost ? { transparent: true, opacity: 0.45, depthWrite: false } : {}));
    const group = new THREE.Group();
    group.matrixAutoUpdate = false;
    group.add(body);
    const edges = ghost ? null : new THREE.LineSegments(geo.edges, this.instanceEdges);
    if (edges) group.add(edges);
    const marks = new THREE.Group();
    group.add(marks);
    return { part, owner: '', group, body, edges, marks };
  }

  private removeInstance(key: string): void {
    const inst = this.instances.get(key);
    if (!inst) return;
    this.scene.remove(inst.group);
    (inst.body.material as THREE.Material).dispose();
    clearMarks(inst.marks);
    this.instances.delete(key);
    this.selectedInstances.delete(key);
  }

  // ---------------------------------------------------------------- elements of components (mates, 2C)

  /** Enables picking faces, edges and vertices of the components instead of whole components. */
  setElementPicking(enabled: boolean): void {
    this.pickElements = enabled;
    if (!enabled) this.setHoveredElement(null);
  }

  /** Elements shown as chosen (the mate being defined, or the selected mate's elements). */
  setSelectedElements(elements: InstanceElement[]): void {
    this.selectedElements = elements;
    this.paintElements();
  }

  private setHoveredElement(el: InstanceElement | null): void {
    const same = el === this.hoveredElement || (el && this.hoveredElement && el.key === this.hoveredElement.key && el.kind === this.hoveredElement.kind && el.index === this.hoveredElement.index);
    if (same) return;
    this.hoveredElement = el;
    this.paintElements();
    this.events.onElementHover?.(el);
  }

  /** Marks on each instance, in its part's coordinates: the element's triangles, segments or point. */
  private paintElements(): void {
    for (const inst of this.instances.values()) clearMarks(inst.marks);
    const draw = (el: InstanceElement, color: number) => {
      const inst = this.instances.get(el.key);
      const geo = inst && this.partGeometry.get(inst.part);
      if (!inst || !geo) return;
      const g = new THREE.BufferGeometry();
      if (el.kind === 'face') {
        const positions: number[] = [];
        const { mesh } = geo;
        for (let r = 0; r < mesh.faceRanges.length; r += 3) {
          if (mesh.faceRanges[r + 2] !== el.index) continue;
          for (let i = mesh.faceRanges[r]!; i < mesh.faceRanges[r]! + mesh.faceRanges[r + 1]!; i++) {
            const v = mesh.indices[i]! * 3;
            positions.push(mesh.positions[v]!, mesh.positions[v + 1]!, mesh.positions[v + 2]!);
          }
        }
        g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
        inst.marks.add(new THREE.Mesh(g, m));
      } else if (el.kind === 'edge') {
        const all = geo.edges.getAttribute('position') as THREE.BufferAttribute;
        const positions: number[] = [];
        geo.segmentEdge.forEach((edge, seg) => {
          if (edge !== el.index) return;
          for (const v of [2 * seg, 2 * seg + 1]) positions.push(all.getX(v), all.getY(v), all.getZ(v));
        });
        g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        const line = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color, depthTest: false }));
        line.renderOrder = 2;
        inst.marks.add(line);
      } else {
        const v = geo.vertices;
        g.setAttribute('position', new THREE.Float32BufferAttribute([v[3 * el.index]!, v[3 * el.index + 1]!, v[3 * el.index + 2]!], 3));
        const pts = new THREE.Points(g, new THREE.PointsMaterial({ color, size: 10, sizeAttenuation: false, depthTest: false }));
        pts.renderOrder = 3;
        inst.marks.add(pts);
      }
    };
    for (const el of this.selectedElements) draw(el, COLORS.edgeSelected);
    if (this.hoveredElement) draw(this.hoveredElement, COLORS.edgeHover);
    this.requestRender();
  }

  /**
   * The element under the cursor, in SolidWorks priority: vertex, then edge, then face; hidden ones excluded. The selection filter (D5.4, ADR 0148) takes kinds out of
   * what can be found: what it leaves out is not hovered, picked, or found *instead of* what is wanted (an edge-only filter never answers with the face behind it).
   * Bodies still hide what is behind them, whatever the filter.
   */
  private pickElement(clientX: number, clientY: number): InstanceElement | null {
    if (this.instances.size === 0) return null;
    const ray = this.rayAt(clientX, clientY);
    const caster = new THREE.Raycaster(ray.origin, ray.direction);
    const bodies = [...this.instances.values()].map((i) => i.body);
    const bodyHit = caster.intersectObjects(bodies).find((h) => this.kept(h.point));
    const depth = bodyHit?.distance ?? Infinity;
    const scale = (this.camera.right - this.camera.left) / this.camera.zoom;
    const slack = 1e-3 * scale;
    const owner = (obj: THREE.Object3D) => [...this.instances].find(([, i]) => i.body === obj || i.edges === obj);

    // Vertices within 10 px, nearest first, that no body hides.
    const rect = this.renderer.domElement.getBoundingClientRect();
    const { w, h } = this.canvasSize();
    this.syncCamera();
    let best: { d: number; el: InstanceElement; p: THREE.Vector3 } | null = null;
    const p = new THREE.Vector3();
    for (const [key, inst] of this.instances) {
      const v = this.filter.vertices ? this.partGeometry.get(inst.part)?.vertices : undefined;
      if (!v) continue;
      for (let i = 0; i < v.length / 3; i++) {
        p.set(v[3 * i]!, v[3 * i + 1]!, v[3 * i + 2]!).applyMatrix4(inst.group.matrixWorld);
        const s = p.clone().project(this.camera);
        const d = Math.hypot(rect.left + ((s.x + 1) / 2) * w - clientX, rect.top + ((1 - s.y) / 2) * h - clientY);
        if (d <= 10 && (!best || d < best.d)) best = { d, el: { key, kind: 'vertex', index: i }, p: p.clone() };
      }
    }
    if (best) {
      const toVertex = best.p.clone().sub(ray.origin);
      const along = toVertex.dot(ray.direction);
      const r = new THREE.Raycaster(best.p.clone().addScaledVector(ray.direction, -along), ray.direction);
      const hit = r.intersectObjects(bodies).find((h) => this.kept(h.point))?.distance ?? Infinity;
      if (hit >= along - slack && this.kept(best.p)) return best.el;
    }

    // Edges within 6 px, in front of the bodies.
    caster.params.Line = { threshold: (6 * scale) / rect.width };
    const edges = this.filter.edges ? [...this.instances.values()].flatMap((i) => (i.edges ? [i.edges] : [])) : [];
    const edgeHit = caster.intersectObjects(edges).find((x) => x.distance <= depth + slack && this.kept(x.point));
    if (edgeHit && edgeHit.index !== undefined) {
      const found = owner(edgeHit.object);
      const geo = found && this.partGeometry.get(found[1].part);
      const edge = geo?.segmentEdge[Math.floor(edgeHit.index / 2)];
      if (found && edge !== undefined) return { key: found[0], kind: 'edge', index: edge };
    }

    if (this.filter.faces && bodyHit && bodyHit.faceIndex !== undefined && bodyHit.faceIndex !== null) {
      const found = owner(bodyHit.object);
      const face = found && this.partGeometry.get(found[1].part)?.triangleFace[bodyHit.faceIndex];
      if (found && face !== undefined) return { key: found[0], kind: 'face', index: face };
    }
    return null;
  }

  /** Enables picking whole components (hover highlight, click). */
  setComponentPicking(enabled: boolean): void {
    this.pickInstances = enabled;
    if (!enabled) this.setHoveredInstance(null);
  }

  /** Lets components be dragged: the left button moves one, the right button turns it (C15.3). */
  setComponentDragging(enabled: boolean): void {
    this.dragInstances = enabled;
    if (!enabled) this.cancelComponentDrag();
  }

  /** Ends a drag in progress as cancelled (Esc). */
  cancelComponentDrag(): void {
    const p = this.press;
    this.press = null;
    if (p?.dragging) {
      this.swallowClick = p.button === 'left';
      this.swallowContext = p.button === 'right';
      this.events.onComponentDragEnd?.(true);
    }
  }

  /** The component under a screen position and the point of it there (scene coordinates). */
  private hitInstance(clientX: number, clientY: number): { key: string; point: THREE.Vector3 } | null {
    if (this.instances.size === 0) return null;
    const r = this.rayAt(clientX, clientY);
    const hit = new THREE.Raycaster(r.origin, r.direction).intersectObjects([...this.instances.values()].map((i) => i.body)).find((h) => this.kept(h.point));
    if (!hit) return null;
    for (const inst of this.instances.values()) if (inst.body === hit.object) return { key: inst.owner, point: hit.point.clone() };
    return null;
  }

  private dragMove(e: PointerEvent): void {
    const p = this.press!;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    if (!p.dragging) {
      if (Math.hypot(dx, dy) < 4) return;
      if (!(this.events.onComponentDragStart?.(p.key, [p.point.x, p.point.y, p.point.z], p.button) ?? false)) {
        this.press = null;
        return;
      }
      p.dragging = true;
      try {
        this.renderer.domElement.setPointerCapture(p.pointerId);
      } catch {
        // the pointer is already gone (or the event is synthetic): nothing to capture
      }
    }
    const ray = this.rayAt(e.clientX, e.clientY);
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    this.events.onComponentDrag?.({
      origin: [ray.origin.x, ray.origin.y, ray.origin.z],
      dir: [ray.direction.x, ray.direction.y, ray.direction.z],
      dx,
      dy,
      right: [right.x, right.y, right.z],
      up: [up.x, up.y, up.z],
    });
  }

  setSelectedComponents(keys: Iterable<string>): void {
    this.selectedInstances = new Set(keys);
    this.paintInstances();
  }

  /** Components shown red: what a dragged component has run into (A3.6). */
  setCollidedComponents(keys: Iterable<string>): void {
    this.collidedInstances = new Set(keys);
    this.paintInstances();
  }

  private setHoveredInstance(key: string | null): void {
    if (key === this.hoveredInstance) return;
    this.hoveredInstance = key;
    this.paintInstances();
    this.events.onComponentHover?.(key);
  }

  private paintInstances(): void {
    for (const inst of this.instances.values()) {
      const color = this.collidedInstances.has(inst.owner) ? COLORS.componentCollided : inst.owner === this.hoveredInstance ? COLORS.componentHover : this.selectedInstances.has(inst.owner) ? COLORS.componentSelected : COLORS.body;
      (inst.body.material as THREE.MeshStandardMaterial).color.setHex(color);
    }
    this.requestRender();
  }

  private pickInstance(clientX: number, clientY: number): string | null {
    if (this.instances.size === 0) return null;
    const r = this.rayAt(clientX, clientY);
    const hit = new THREE.Raycaster(r.origin, r.direction).intersectObjects([...this.instances.values()].map((i) => i.body)).find((h) => this.kept(h.point));
    if (!hit) return null;
    for (const inst of this.instances.values()) if (inst.body === hit.object) return inst.owner;
    return null;
  }

  private highlights: THREE.Mesh[] = [];

  /**
   * Volumes pointed out in the scene, in its coordinates (the overlap of two components, E2.1): red, drawn over what is in front of them, never hovered or picked.
   * The list replaces the one before; an empty list takes them away.
   */
  setHighlights(list: readonly { mesh: ViewMesh }[]): void {
    for (const m of this.highlights) {
      this.scene.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.highlights = list.map(({ mesh }) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
      g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xe53935, transparent: true, opacity: 0.8, depthTest: false, side: THREE.DoubleSide }));
      m.renderOrder = 10;
      this.scene.add(m);
      return m;
    });
    this.requestRender();
  }

  /** Shows a see-through copy of a part (null removes it); moveGhost places it. */
  setGhost(part: string | null): void {
    if (this.ghost && this.ghost.part === part) return;
    if (this.ghost) {
      this.scene.remove(this.ghost.group);
      (this.ghost.body.material as THREE.Material).dispose();
      this.ghost = null;
    }
    if (part) {
      this.ghost = this.makeInstance(part, true);
      if (this.ghost) {
        this.ghost.group.visible = false;
        this.scene.add(this.ghost.group);
      }
    }
    this.requestRender();
  }

  /** Moves the see-through copy (null hides it, e.g. while the cursor is outside the view). */
  moveGhost(matrix: ArrayLike<number> | null): void {
    if (!this.ghost) return;
    this.ghost.group.visible = matrix !== null;
    if (matrix) setMatrix(this.ghost.group, matrix);
    this.requestRender();
  }

  /** Where a screen position meets the plane through `through` that faces the viewer. */
  pointOnViewPlane(clientX: number, clientY: number, through: [number, number, number] = [0, 0, 0]): [number, number, number] {
    const ray = this.rayAt(clientX, clientY);
    const n = this.camera.getWorldDirection(new THREE.Vector3());
    const t = new THREE.Vector3(...through).sub(ray.origin).dot(n) / ray.direction.dot(n);
    const p = ray.origin.clone().addScaledVector(ray.direction, t);
    return [p.x, p.y, p.z];
  }

  /** Everything the model shows: the part's body or the assembly's components. */
  private contentBox(): THREE.Box3 {
    const box = new THREE.Box3();
    if (this.body) box.expandByObject(this.body);
    for (const inst of this.instances.values()) box.expandByObject(inst.group);
    return box;
  }

  // ---------------------------------------------------------------- 2D overlay (sketch editing)

  /** Replaces the overlay; labels keep their DOM nodes by key so edits in progress are not disturbed. */
  /**
   * The pictures of the sketch being edited (ADR 0116), drawn under its curves, in the plane of the sketch, whatever is in front of them: an image is something to trace, so the model
   * does not hide it. Each is a plane of the picture's size turned by its angle about its centre; its top is `yDir`.
   */
  setPictures(pictures: ViewPicture[]): void {
    if (this.picturesGroup) {
      this.overlayScene.remove(this.picturesGroup);
      this.picturesGroup.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.MeshBasicMaterial).map?.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      this.picturesGroup = null;
    }
    if (pictures.length > 0) {
      const group = new THREE.Group();
      for (const p of pictures) {
        const texture = new THREE.Texture(p.image);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.needsUpdate = true;
        const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: p.opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
        const a = (p.angle * Math.PI) / 180;
        const [c, s] = [Math.cos(a), Math.sin(a)];
        const [fx, fy] = [p.frame.xDir, p.frame.yDir];
        const ex = new THREE.Vector3(fx[0] * c + fy[0] * s, fx[1] * c + fy[1] * s, fx[2] * c + fy[2] * s);
        const ey = new THREE.Vector3(-fx[0] * s + fy[0] * c, -fx[1] * s + fy[1] * c, -fx[2] * s + fy[2] * c);
        const ez = new THREE.Vector3().crossVectors(ex, ey);
        mesh.matrixAutoUpdate = false;
        mesh.matrix.makeBasis(ex.multiplyScalar(p.width), ey.multiplyScalar(p.height), ez).setPosition(toWorld(p.frame, [p.x, p.y]));
        mesh.renderOrder = -10;
        group.add(mesh);
      }
      this.picturesGroup = group;
      this.overlayScene.add(group);
    }
    this.requestRender();
  }

  setOverlay(overlay: SketchOverlay | null): void {
    if (this.overlayGroup) {
      this.overlayScene.remove(this.overlayGroup);
      disposeGroup(this.overlayGroup);
      this.overlayGroup = null;
    }
    if (overlay) {
      this.overlayGroup = buildOverlayObjects(overlay, this.pixelSize());
      this.overlayScene.add(this.overlayGroup);
    }
    const keep = new Set<string>();
    for (const l of overlay?.labels ?? []) {
      keep.add(l.key);
      let entry = this.labels.get(l.key);
      if (!entry) {
        const el = document.createElement('div');
        const key = l.key;
        let dragged = false; // a drag ends in a click on the label, which must not also select it
        el.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          if (e.button !== 0 || !this.events.onLabelDrag) return;
          const [x0, y0] = [e.clientX, e.clientY];
          let moving = false;
          // while dragging the label follows the pointer on screen only; the document changes once, on release (one drag, one step to undo)
          const move = (m: PointerEvent) => {
            if (!moving && Math.hypot(m.clientX - x0, m.clientY - y0) < 3) return; // a click is not a drag
            moving = true;
            const entry = this.labels.get(key);
            if (!entry) return;
            entry.held = true;
            entry.offset = [m.clientX - x0, m.clientY - y0];
            this.requestRender();
          };
          const up = (u: PointerEvent) => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            if (!moving) return;
            dragged = true;
            const entry = this.labels.get(key);
            if (entry) entry.held = false;
            this.events.onLabelDrag?.(key, u.clientX, u.clientY);
            // the overlay redrawn with the stored place drops the offset; should nothing be stored (refused), the label goes back
            setTimeout(() => {
              const left = this.labels.get(key);
              if (left && !left.held && left.offset) {
                left.offset = undefined;
                this.requestRender();
              }
            }, 400);
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        });
        el.addEventListener('click', (e) => {
          if (dragged) {
            dragged = false;
            return;
          }
          this.events.onLabelClick?.(key, e.ctrlKey || e.shiftKey);
        });
        el.addEventListener('dblclick', () => this.events.onLabelDoubleClick?.(l.key));
        this.labelLayer.appendChild(el);
        entry = { el, world: new THREE.Vector3() };
        this.labels.set(l.key, entry);
      }
      entry.world.copy(toWorld(overlay!.frame, l.p));
      if (!entry.held) entry.offset = undefined; // the place is now the one stored
      entry.el.className = `overlay-label ${l.className ?? ''} ${l.interactive ? 'interactive' : ''}`;
      if (entry.el.textContent !== l.text) entry.el.textContent = l.text;
      entry.el.title = l.title ?? '';
    }
    for (const [key, entry] of this.labels) {
      if (keep.has(key)) continue;
      entry.el.remove();
      this.labels.delete(key);
    }
    this.requestRender();
  }

  /** Lets the labels of a measurement be taken with the pointer and moved: `moved` says which one and by how much (since its last report). */
  setMeasureLabelDrag(moved: ((key: string, by: [number, number]) => void) | null): void {
    this.measureLabelDrag = moved;
  }

  /** Turns on picking of places (the ends, middles and centres of edges, the nearest place of an edge, a point of a face): `hover` is told what the pointer is at, `pick` what is clicked. */
  setSnapPicking(on: boolean, events: { hover?: (s: Snap | null) => void; pick?: (s: Snap) => void } = {}): void {
    this.snapPicking = on;
    this.snapEvents = on ? events : {};
    if (!on) this.setSnapMarker(null);
  }

  /** The solids that places are taken from: the open part, or every component of an assembly, with where each is. */
  private snapSolids(): { positions: ArrayLike<number>; owner: ArrayLike<number>; vertices: ArrayLike<number>; matrix: THREE.Matrix4; body: THREE.Mesh; edges: THREE.LineSegments | null; instance: string | null; key: object }[] {
    const out = [];
    if (this.body && this.edges) {
      const position = this.edges.geometry.getAttribute('position') as THREE.BufferAttribute;
      out.push({ positions: position.array, owner: this.segmentEdge, vertices: this.vertices, matrix: new THREE.Matrix4(), body: this.body, edges: this.edges, instance: null, key: position.array });
    }
    for (const [key, inst] of this.instances) {
      const geo = this.partGeometry.get(inst.part);
      if (!geo) continue;
      inst.group.updateMatrixWorld(true);
      const position = geo.edges.getAttribute('position') as THREE.BufferAttribute;
      out.push({ positions: position.array, owner: geo.segmentEdge, vertices: geo.vertices, matrix: inst.group.matrixWorld.clone(), body: inst.body, edges: inst.edges, instance: key, key: position.array });
    }
    return out;
  }

  private snapData(solid: { positions: ArrayLike<number>; owner: ArrayLike<number>; vertices: ArrayLike<number>; key: object }) {
    let d = this.snapCache.get(solid.key);
    if (!d) {
      const lines = polylinesOf(solid.positions, solid.owner);
      const ends: V3[] = [];
      const middles: V3[] = [];
      const centres: V3[] = [];
      for (const pts of lines.values()) {
        if (pts.length < 2) continue;
        // A derived mirror mesh may intentionally have no topology names/vertices; keep its previous edge-end snapping.
        if (solid.vertices.length === 0) ends.push(pts[0]!, pts[pts.length - 1]!);
        middles.push(middleOf(pts));
        const c = circleCentre(pts);
        if (c) centres.push(c.centre);
      }
      for (let i = 0; i + 2 < solid.vertices.length; i += 3) ends.push([solid.vertices[i]!, solid.vertices[i + 1]!, solid.vertices[i + 2]!]);
      d = { lines, ends, middles, centres };
      this.snapCache.set(solid.key, d);
    }
    return d;
  }

  /**
   * The place under the pointer, nearest first by what it is worth: an end of an edge, the centre of a circle or an arc, the middle of an edge (each within ten pixels), the
   * place of an edge nearest the pointer (six pixels), a point of a face. Ends and middles hidden by the model are not taken; a section's cut-away part is not there.
   */
  snapAt(clientX: number, clientY: number): Snap | null {
    const solids = this.snapSolids();
    if (solids.length === 0) return null;
    this.syncCamera();
    const rect = this.renderer.domElement.getBoundingClientRect();
    const { w, h } = this.canvasSize();
    const px = (p: THREE.Vector3): [number, number] => {
      const q = p.clone().project(this.camera);
      return [rect.left + ((q.x + 1) / 2) * w, rect.top + ((1 - q.y) / 2) * h];
    };
    const ray = this.rayAt(clientX, clientY);
    const caster = new THREE.Raycaster(ray.origin, ray.direction);
    const bodies = solids.map((x) => x.body);
    const scale = (this.camera.right - this.camera.left) / this.camera.zoom;
    const first = caster.intersectObjects(bodies, false).find((hit) => this.kept(hit.point));
    const visible = (p: THREE.Vector3) => !first || p.clone().sub(ray.origin).dot(ray.direction) <= first.distance + 1e-3 * scale;
    const make = (kind: Snap['kind'], world: THREE.Vector3, solid: (typeof solids)[number]): Snap => {
      const local = world.clone().applyMatrix4(solid.matrix.clone().invert());
      return { kind, world: [world.x, world.y, world.z], local: [local.x, local.y, local.z], instance: solid.instance };
    };
    // the places of the edges, by worth
    const near = (list: V3[], solid: (typeof solids)[number], kind: Snap['kind'], hiddenOk: boolean): Snap | null => {
      let best: { d: number; p: THREE.Vector3 } | null = null;
      for (const q of list) {
        const p = new THREE.Vector3(...q).applyMatrix4(solid.matrix);
        if (!this.kept(p)) continue;
        const [sx, sy] = px(p);
        const d = Math.hypot(sx - clientX, sy - clientY);
        if (d <= 10 && (!best || d < best.d) && (hiddenOk || visible(p))) best = { d, p };
      }
      return best && make(kind, best.p, solid);
    };
    const pick = (kind: Snap['kind']): Snap | null => {
      let best: { s: Snap; d: number } | null = null;
      for (const solid of solids) {
        const data = this.snapData(solid);
        const found = kind === 'vertex' ? near(data.ends, solid, 'vertex', false) : kind === 'centre' ? near(data.centres, solid, 'centre', true) : near(data.middles, solid, 'midpoint', false);
        if (!found) continue;
        const [sx, sy] = px(new THREE.Vector3(...found.world));
        const d = Math.hypot(sx - clientX, sy - clientY);
        if (!best || d < best.d) best = { s: found, d };
      }
      return best?.s ?? null;
    };
    const special = pick('vertex') ?? pick('centre') ?? pick('midpoint');
    if (special) return special;
    // the place of an edge nearest the pointer
    const tolerance = (6 * scale) / rect.width;
    let edgeBest: { d: number; world: THREE.Vector3; solid: (typeof solids)[number] } | null = null;
    for (const solid of solids) {
      if (!solid.edges) continue;
      caster.params.Line = { threshold: tolerance };
      for (const hit of caster.intersectObject(solid.edges, false)) {
        if (!visible(hit.point) || !this.kept(hit.point)) continue;
        const d = (hit as unknown as { distanceToRay?: number }).distanceToRay ?? 0;
        if (!edgeBest || d < edgeBest.d) edgeBest = { d, world: hit.point.clone(), solid };
      }
    }
    if (edgeBest) return make('edge', edgeBest.world, edgeBest.solid);
    if (first) {
      const solid = solids.find((x) => x.body === first.object);
      if (solid) return make('face', first.point.clone(), solid);
    }
    return null;
  }

  /** Marks the place the pointer would take (null: none): a dot and the word for what it is. */
  setSnapMarker(marker: { at: [number, number, number]; text: string } | null): void {
    if (this.snapMarker) {
      this.overlayScene.remove(this.snapMarker);
      this.snapMarker.geometry.dispose();
      (this.snapMarker.material as THREE.Material).dispose();
      this.snapMarker = null;
    }
    if (marker) {
      this.snapMarker = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(marker.at, 3)), new THREE.PointsMaterial({ color: COLORS.snap, size: 11, sizeAttenuation: false, depthTest: false }));
      this.snapMarker.renderOrder = 7;
      this.overlayScene.add(this.snapMarker);
      let entry = this.measureLabels.get('__snap');
      if (!entry) {
        const el = document.createElement('div');
        this.labelLayer.appendChild(el);
        entry = { el, world: new THREE.Vector3(), offset: [0, 0] };
        this.measureLabels.set('__snap', entry);
      }
      entry.world.set(...marker.at);
      entry.offset = [14, -14];
      entry.el.className = 'overlay-label snap-label';
      entry.el.textContent = marker.text;
    } else {
      const entry = this.measureLabels.get('__snap');
      if (entry) {
        entry.el.remove();
        this.measureLabels.delete('__snap');
      }
    }
    this.requestRender();
  }

  /** Draws the result of a measurement over the model (null takes it away). The lines are two and a half pixels wide whatever the zoom, and are drawn over what hides them. */
  setMeasureGraphics(g: MeasureGraphics | null): void {
    if (this.measureGroup) {
      this.overlayScene.remove(this.measureGroup);
      disposeGroup(this.measureGroup);
      for (const m of this.measureMaterials) m.dispose();
      this.measureGroup = null;
      this.measureMaterials = [];
    }
    const keep = new Set<string>();
    if (g) {
      const group = new THREE.Group();
      const byColour = new Map<number, number[]>();
      for (const l of g.lines) byColour.set(l.color, [...(byColour.get(l.color) ?? []), ...l.a, ...l.b]);
      const { w, h } = this.canvasSize();
      for (const [color, positions] of byColour) {
        const geometry = new LineSegmentsGeometry().setPositions(positions);
        const material = new LineMaterial({ color, linewidth: 2.5, depthTest: false, transparent: true });
        material.resolution.set(w, h);
        const lines = new LineSegments2(geometry, material);
        lines.renderOrder = 5;
        group.add(lines);
        this.measureMaterials.push(material);
      }
      if (g.points.length > 0) {
        const dots = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(g.points.flat(), 3)), new THREE.PointsMaterial({ color: 0x111111, size: 7, sizeAttenuation: false, depthTest: false }));
        dots.renderOrder = 6;
        group.add(dots);
      }
      this.measureGroup = group;
      this.overlayScene.add(group);
      for (const l of g.labels) {
        keep.add(l.key);
        let entry = this.measureLabels.get(l.key);
        if (!entry) {
          const el = document.createElement('div');
          const key = l.key;
          el.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            if (e.button !== 0 || !this.measureLabelDrag) return;
            e.preventDefault();
            let last: [number, number] = [e.clientX, e.clientY];
            const move = (m: PointerEvent) => {
              this.measureLabelDrag?.(key, [m.clientX - last[0], m.clientY - last[1]]);
              last = [m.clientX, m.clientY];
            };
            const up = () => {
              window.removeEventListener('pointermove', move);
              window.removeEventListener('pointerup', up);
            };
            window.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
          });
          this.labelLayer.appendChild(el);
          entry = { el, world: new THREE.Vector3(), offset: [0, 0] };
          this.measureLabels.set(l.key, entry);
        }
        entry.world.set(...l.at);
        entry.offset = l.offset ?? [0, 0];
        entry.el.className = 'overlay-label measure-label';
        entry.el.replaceChildren();
        const tag = document.createElement('span');
        tag.className = 'name';
        tag.style.background = l.color;
        tag.textContent = l.name;
        const value = document.createElement('span');
        value.className = 'value';
        value.textContent = l.value;
        entry.el.append(tag, value);
      }
    }
    for (const [key, entry] of this.measureLabels) {
      if (keep.has(key) || key === '__snap') continue;
      entry.el.remove();
      this.measureLabels.delete(key);
    }
    this.requestRender();
  }

  /** Routes left-button input to a tool instead of edge picking (null restores normal selection). */
  setToolHandler(handler: ((e: ToolPointerEvent) => void) | null): void {
    this.toolHandler = handler;
    if (handler) this.setHovered(-1);
  }

  /** Size of one screen pixel in world units (orthographic camera). */
  pixelSize(): number {
    return (this.camera.right - this.camera.left) / this.camera.zoom / this.canvasSize().w;
  }

  /** The drawing surface in CSS pixels: every screen↔world conversion uses this one size. */
  private canvasSize(): { w: number; h: number } {
    const el = this.renderer.domElement;
    return { w: el.clientWidth || 1, h: el.clientHeight || 1 };
  }

  /** Where a screen position hits a plane, in the plane's 2D coordinates; null if the view is edge-on. */
  planePoint(clientX: number, clientY: number, frame: PlaneFrame): P2 | null {
    const ray = this.rayAt(clientX, clientY);
    const n = new THREE.Vector3(...frame.normal);
    const o = new THREE.Vector3(...frame.origin);
    const denom = ray.direction.dot(n);
    if (Math.abs(denom) < 1e-9) return null;
    const t = o.clone().sub(ray.origin).dot(n) / denom;
    const w = ray.origin.clone().addScaledVector(ray.direction, t).sub(o);
    return [w.dot(new THREE.Vector3(...frame.xDir)), w.dot(new THREE.Vector3(...frame.yDir))];
  }

  /** Screen position (relative to the viewport) of a point on a plane. */
  screenOf(frame: PlaneFrame, p: P2): { x: number; y: number } {
    this.syncCamera();
    const v = toWorld(frame, p).project(this.camera);
    const { w, h } = this.canvasSize();
    return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
  }

  /**
   * three.js refreshes camera matrices only when it renders. Screen↔world conversions can run
   * between a view change and the next frame (a click right after zooming or 「正視於」), so
   * they bring the matrices up to date themselves.
   */
  private syncCamera(): void {
    this.camera.updateMatrixWorld();
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
  }

  private rayAt(clientX: number, clientY: number): THREE.Ray {
    this.syncCamera();
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const caster = new THREE.Raycaster();
    caster.setFromCamera(ndc, this.camera);
    return caster.ray;
  }

  // ---------------------------------------------------------------- selection

  /** What the selection filter takes out of what can be picked is drawn so: the faces see-through, the edges faint (ADR 0117). Vertices are not drawn, so there is nothing to show for them. */
  private paintFilterLook(): void {
    const dimFaces = this.pickFaces && !this.filter.faces;
    if (this.body) {
      const m = this.body.material as THREE.Material;
      m.transparent = dimFaces;
      m.opacity = dimFaces ? 0.45 : 1;
      m.depthWrite = !dimFaces;
      m.needsUpdate = true;
    }
    this.paintEdges();
  }

  /**
   * Which kinds of element the user lets be picked (D5.4). It narrows what the command in progress asks for, it never adds to it: a kind both asks for
   * and allows is what is hovered and clicked.
   */
  setPickFilter(filter: PickFilter): void {
    this.filter = { ...filter };
    this.paintFilterLook();
    if (!this.edgesOn) this.setHovered(-1);
    if (!this.facesOn) this.setHoveredFace(-1);
    if (!this.verticesOn) this.setHoveredVertex(-1);
    if (!this.planesOn) this.setHoveredPlane(null);
    if (!this.pickDatums) this.setHoveredDatum(null);
    // an assembly's element under the cursor may be of a kind now left out; the next move finds the one that is allowed
    if (this.pickElements) this.setHoveredElement(null);
  }

  /** The shown planes the user lets be picked. */
  private get planesOn(): boolean {
    return this.pickPlanes && this.filter.planes;
  }

  private get edgesOn(): boolean {
    return this.pickEdges && this.filter.edges;
  }
  private get facesOn(): boolean {
    return this.pickFaces && this.filter.faces;
  }
  private get verticesOn(): boolean {
    return this.pickVertices && this.filter.vertices;
  }

  /** Every face under the cursor, nearest first, hidden ones too (D5.5 「選擇其他」). Faces the section cut away are not in the list. */
  facesAt(clientX: number, clientY: number): number[] {
    if (!this.body) return [];
    const r = this.rayAt(clientX, clientY);
    const ray = new THREE.Raycaster(r.origin, r.direction);
    const faces: number[] = [];
    // the faces behind are seen from inside: back faces count here
    const material = this.body.material as THREE.Material;
    const side = material.side;
    material.side = THREE.DoubleSide;
    const hits = ray.intersectObject(this.body);
    material.side = side;
    for (const hit of hits) {
      if (!this.kept(hit.point) || hit.faceIndex === undefined || hit.faceIndex === null) continue;
      const face = this.triangleFace[hit.faceIndex] ?? -1;
      if (face >= 0 && !faces.includes(face)) faces.push(face);
    }
    return faces;
  }

  /** The edge, vertex and face the cursor is on, as picking would take them (-1 for none) — what a right click acts on. */
  elementsAt(clientX: number, clientY: number): { edge: number; vertex: number; face: number } {
    const vertex = this.verticesOn ? this.pickVertex(clientX, clientY) : -1;
    const edge = vertex < 0 && this.edgesOn ? this.pick(clientX, clientY) : -1;
    const face = this.facesOn ? this.pickFace(clientX, clientY) : -1;
    return { vertex, edge, face };
  }

  /**
   * What the cursor is on, in the order a click takes it (ADR 0127): a model vertex, then a model edge, then a reference axis, point or
   * coordinate system — those are drawn over everything, so they are what the person sees — and then whichever of the model face and a
   * shown plane is nearer, the plane square obeying depth exactly as it is drawn.
   */
  private pickOrder(clientX: number, clientY: number): { vertex: number; edge: number; face: number; datum: string | null; plane: string | null } {
    const vertex = this.verticesOn ? this.pickVertex(clientX, clientY) : -1;
    const edge = vertex < 0 && this.edgesOn ? this.pick(clientX, clientY) : -1;
    const datum = vertex < 0 && edge < 0 && this.pickDatums ? this.pickDatum(clientX, clientY) : null;
    if (vertex >= 0 || edge >= 0 || datum) return { vertex, edge, face: -1, datum, plane: null };
    const model = this.facesOn ? this.pickFaceHit(clientX, clientY) : { face: -1, distance: Infinity };
    const sheet = this.planesOn ? this.pickPlaneHit(clientX, clientY) : null;
    const planeInFront = sheet !== null && (model.face < 0 || sheet.distance < model.distance);
    return { vertex, edge, face: planeInFront ? -1 : model.face, datum, plane: planeInFront ? sheet.key : null };
  }

  /** Enables edge hover/click picking (e.g. while a fillet's edge list is active). */
  setEdgePicking(enabled: boolean): void {
    this.pickEdges = enabled;
    this.paintFilterLook();
    if (!enabled) this.setHovered(-1);
  }

  /** Enables face hover/click picking (selecting a face to sketch on, an end face …). */
  setFacePicking(enabled: boolean): void {
    this.pickFaces = enabled;
    this.paintFilterLook();
    if (!enabled) this.setHoveredFace(-1);
  }

  setSelectedFaces(faces: Iterable<number>): void {
    this.selectedFaces = new Set(faces);
    this.paintFaces();
  }

  private setHoveredFace(face: number): void {
    if (face === this.hoveredFace) return;
    this.hoveredFace = face;
    this.paintFaces();
    this.events.onFaceHover?.(face);
  }

  /** Translucent copies of the hovered and selected faces' triangles, drawn over the body. */
  /** The colors of the faces of the body on show (C14.2), in the order of its faces; faces without one keep the body's. */
  setFaceColors(colors: readonly (string | null)[]): void {
    this.faceColors = colors;
    this.paintBodyColors();
  }

  private paintBodyColors(): void {
    const mesh = this.mesh;
    if (!this.body || !mesh) return;
    const geometry = this.body.geometry;
    const material = this.body.material as THREE.MeshStandardMaterial;
    if (!this.faceColors.some(Boolean) || this.displayMode === 'hiddenRemoved') {
      if (geometry.getAttribute('color')) geometry.deleteAttribute('color');
      material.vertexColors = false;
      material.color.set(COLORS.body);
      material.needsUpdate = true;
      return this.requestRender();
    }
    const base = new THREE.Color(COLORS.body);
    const colors = new Float32Array(geometry.getAttribute('position').count * 3);
    for (let i = 0; i < colors.length; i += 3) colors.set([base.r, base.g, base.b], i);
    const own = new THREE.Color();
    for (let r = 0; r < mesh.faceRanges.length; r += 3) {
      const hex = this.faceColors[mesh.faceRanges[r + 2]!];
      if (!hex) continue;
      own.set(hex);
      for (let i = mesh.faceRanges[r]!; i < mesh.faceRanges[r]! + mesh.faceRanges[r + 1]!; i++) colors.set([own.r, own.g, own.b], mesh.indices[i]! * 3);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    material.vertexColors = true;
    material.color.set(0xffffff);
    material.needsUpdate = true;
    this.requestRender();
  }

  private paintFaces(): void {
    if (this.faceHighlight) {
      this.scene.remove(this.faceHighlight);
      this.faceHighlight.geometry.dispose();
      (this.faceHighlight.material as THREE.Material).dispose();
      this.faceHighlight = null;
    }
    const mesh = this.mesh;
    const faces = new Map<number, THREE.Color>();
    for (const f of this.selectedFaces) faces.set(f, new THREE.Color(COLORS.edgeSelected));
    if (this.hoveredFace >= 0) faces.set(this.hoveredFace, new THREE.Color(COLORS.edgeHover));
    if (mesh && faces.size > 0) {
      const positions: number[] = [];
      const colors: number[] = [];
      for (let r = 0; r < mesh.faceRanges.length; r += 3) {
        const color = faces.get(mesh.faceRanges[r + 2]!);
        if (!color) continue;
        for (let i = mesh.faceRanges[r]!; i < mesh.faceRanges[r]! + mesh.faceRanges[r + 1]!; i++) {
          const v = mesh.indices[i]! * 3;
          positions.push(mesh.positions[v]!, mesh.positions[v + 1]!, mesh.positions[v + 2]!);
          colors.push(color.r, color.g, color.b);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      const material = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      this.faceHighlight = new THREE.Mesh(g, material);
      this.scene.add(this.faceHighlight);
    }
    this.requestRender();
  }

  // ---------------------------------------------------------------- vertices (three-point planes, …)

  /** The model's vertices, xyz per vertex, in the order the element names use. */
  setVertices(points: Float32Array): void {
    this.vertices = points;
    this.hoveredVertex = -1;
    this.selectedVertices.clear();
    this.paintVertices();
  }

  setVertexPicking(enabled: boolean): void {
    this.pickVertices = enabled;
    if (!enabled) this.setHoveredVertex(-1);
  }

  setSelectedVertices(vertices: Iterable<number>): void {
    this.selectedVertices = new Set(vertices);
    this.paintVertices();
  }

  private setHoveredVertex(vertex: number): void {
    if (vertex === this.hoveredVertex) return;
    this.hoveredVertex = vertex;
    this.paintVertices();
    this.events.onVertexHover?.(vertex);
  }

  private paintVertices(): void {
    if (this.vertexHighlight) {
      this.overlayScene.remove(this.vertexHighlight);
      this.vertexHighlight.geometry.dispose();
      (this.vertexHighlight.material as THREE.Material).dispose();
      this.vertexHighlight = null;
    }
    const shown = new Map<number, THREE.Color>();
    for (const v of this.selectedVertices) shown.set(v, new THREE.Color(COLORS.edgeSelected));
    if (this.hoveredVertex >= 0) shown.set(this.hoveredVertex, new THREE.Color(COLORS.edgeHover));
    if (shown.size > 0) {
      const positions: number[] = [];
      const colors: number[] = [];
      for (const [v, c] of shown) {
        positions.push(this.vertices[v * 3]!, this.vertices[v * 3 + 1]!, this.vertices[v * 3 + 2]!);
        colors.push(c.r, c.g, c.b);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      this.vertexHighlight = new THREE.Points(g, new THREE.PointsMaterial({ size: 10, sizeAttenuation: false, vertexColors: true, depthTest: false }));
      this.overlayScene.add(this.vertexHighlight);
    }
    this.requestRender();
  }

  /** The nearest visible vertex within 10 pixels of the cursor, or -1. */
  private pickVertex(clientX: number, clientY: number): number {
    if (this.vertices.length === 0) return -1;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const { w, h } = this.canvasSize();
    this.syncCamera();
    const candidates: [number, number][] = [];
    const v = new THREE.Vector3();
    for (let i = 0; i < this.vertices.length / 3; i++) {
      v.set(this.vertices[i * 3]!, this.vertices[i * 3 + 1]!, this.vertices[i * 3 + 2]!).project(this.camera);
      const d = Math.hypot(rect.left + ((v.x + 1) / 2) * w - clientX, rect.top + ((1 - v.y) / 2) * h - clientY);
      if (d <= 10) candidates.push([d, i]);
    }
    candidates.sort((a, b) => a[0] - b[0]);
    const scale = (this.camera.right - this.camera.left) / this.camera.zoom;
    for (const [, i] of candidates) {
      // Hidden behind the body? Compare the body hit along the ray with the vertex's own depth.
      const p = new THREE.Vector3(this.vertices[i * 3]!, this.vertices[i * 3 + 1]!, this.vertices[i * 3 + 2]!);
      const s = p.clone().project(this.camera);
      const ray = this.rayAt(rect.left + ((s.x + 1) / 2) * w, rect.top + ((1 - s.y) / 2) * h);
      const depth = p.clone().sub(ray.origin).dot(ray.direction);
      const caster = new THREE.Raycaster(ray.origin, ray.direction);
      const hit = this.body ? caster.intersectObject(this.body)[0]?.distance ?? Infinity : Infinity;
      if (hit >= depth - 1e-3 * scale) return i;
    }
    return -1;
  }

  // ---------------------------------------------------------------- shown sketches and the origin (D4.6)

  /** Sketches to show in the graphics area, on top of the model. Only their lines and points are drawn. */
  setSketches(sketches: SketchOverlay[]): void {
    if (this.sketchGroup) {
      this.overlayScene.remove(this.sketchGroup);
      disposeGroup(this.sketchGroup);
      this.sketchGroup = null;
    }
    if (sketches.length > 0) {
      const group = new THREE.Group();
      const px = this.pixelSize();
      for (const s of sketches) group.add(buildOverlayObjects({ ...s, labels: [] }, px));
      this.sketchGroup = group;
      this.overlayScene.add(group);
    }
    this.requestRender();
  }

  /** The part's origin: three short axes, a constant length on screen. */
  /**
   * Guide lines drawn over the model, each a polyline (x, y, z, x, y, z …) in the coordinates of the view: the explode lines of an assembly. Dashed, in a dark blue, never
   * hidden by the parts. An empty list takes them away.
   */
  setGuides(lines: readonly (readonly number[])[]): void {
    if (this.guidesGroup) {
      this.overlayScene.remove(this.guidesGroup);
      disposeGroup(this.guidesGroup);
      this.guidesGroup = null;
    }
    const drawn = lines.filter((l) => l.length >= 6);
    if (drawn.length > 0) {
      const group = new THREE.Group();
      const size = 4 * this.pixelSize();
      for (const l of drawn) {
        const line = new THREE.Line(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(l, 3)), new THREE.LineDashedMaterial({ color: COLORS.section, dashSize: size, gapSize: size * 0.6, depthTest: false }));
        line.computeLineDistances();
        line.renderOrder = 2;
        group.add(line);
      }
      this.guidesGroup = group;
      this.overlayScene.add(group);
    }
    this.requestRender();
  }

  setOrigin(show: boolean): void {
    this.originShown = show;
    this.paintOrigin();
  }

  private paintOrigin(): void {
    if (this.originGroup) {
      this.overlayScene.remove(this.originGroup);
      disposeGroup(this.originGroup);
      this.originGroup = null;
    }
    if (this.originShown) {
      const len = 28 * this.pixelSize();
      const group = new THREE.Group();
      const axes: [number[], number][] = [
        [[len, 0, 0], 0xe03131],
        [[0, len, 0], 0x2f9e44],
        [[0, 0, len], 0x1c7ed6],
      ];
      for (const [end, color] of axes) {
        group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(...end)]), new THREE.LineBasicMaterial({ color, depthTest: false })));
      }
      group.add(new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3()]), new THREE.PointsMaterial({ color: 0xe03131, size: 6, sizeAttenuation: false, depthTest: false })));
      this.originGroup = group;
      this.overlayScene.add(group);
    }
    this.requestRender();
  }

  // ---------------------------------------------------------------- reference axes, points and coordinate systems (D4.6)

  /** Reference axes, points and coordinate systems to show. */
  setDatums(datums: DatumDisplay): void {
    this.datums = datums;
    this.paintDatums();
  }

  private paintDatums(): void {
    if (this.datumGroup) {
      this.overlayScene.remove(this.datumGroup);
      disposeGroup(this.datumGroup);
      this.datumGroup = null;
    }
    const { axes, points, systems } = this.datums;
    if (axes.length + points.length + systems.length > 0) {
      const group = new THREE.Group();
      const px = this.pixelSize();
      const box = this.contentBox();
      const reach = box.isEmpty() ? 50 : box.getSize(new THREE.Vector3()).length();
      /** Lit: what the PropertyManager says is used, or what the cursor is on (its own click would take it). */
      const lit = (key: string, highlighted?: boolean) => highlighted === true || this.hoveredDatum === key;
      const line = (a: THREE.Vector3, b: THREE.Vector3, color: number, key: string) => {
        const seg = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color, depthTest: false }));
        seg.userData.datumKey = key; // what a click on this line stands for
        group.add(seg);
      };
      const dot = (p: THREE.Vector3, key: string, isLit: boolean) => {
        const made = new THREE.Points(new THREE.BufferGeometry().setFromPoints([p]), new THREE.PointsMaterial({ color: isLit ? COLORS.edgeHover : 0x7048a8, size: isLit ? 11 : 8, sizeAttenuation: false, depthTest: false }));
        made.userData.datumKey = key;
        group.add(made);
      };
      for (const axis of axes) {
        // through the extent of the model, and a little beyond it, whatever the axis starts at
        const o = new THREE.Vector3(...axis.origin);
        const d = new THREE.Vector3(...axis.dir).normalize();
        let [t0, t1] = [-reach / 2, reach / 2];
        if (!box.isEmpty()) {
          const along = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).sub(o).dot(d));
          const margin = 0.1 * (Math.max(...along) - Math.min(...along)) + 5;
          [t0, t1] = [Math.min(...along) - margin, Math.max(...along) + margin];
        }
        line(o.clone().addScaledVector(d, t0), o.clone().addScaledVector(d, t1), lit(axis.key, axis.highlighted) ? COLORS.edgeHover : 0x7048a8, axis.key);
      }
      for (const p of points) dot(new THREE.Vector3(...p.p), p.key, lit(p.key, p.highlighted));
      const len = 40 * px;
      for (const c of systems) {
        const o = new THREE.Vector3(...c.origin);
        const arm = (v: [number, number, number], color: number) => line(o, o.clone().addScaledVector(new THREE.Vector3(...v), len), lit(c.key, c.highlighted) ? COLORS.edgeHover : color, c.key);
        arm(c.x, 0xe03131);
        arm(c.y, 0x2f9e44);
        arm(c.z, 0x1c7ed6);
        dot(o, c.key, lit(c.key, c.highlighted));
      }
      this.datumGroup = group;
      this.overlayScene.add(group);
    }
    this.requestRender();
  }

  /** Whether the shown axes, points and coordinate systems take the cursor and clicks (ADR 0127). */
  setDatumPicking(enabled: boolean): void {
    this.pickDatums = enabled;
    if (!enabled) this.setHoveredDatum(null);
  }

  /** The axis, point or coordinate system the cursor is on: a line within a few pixels, or a dot within ten. */
  private pickDatum(clientX: number, clientY: number): string | null {
    if (!this.datumGroup) return null;
    const r = this.rayAt(clientX, clientY);
    const ray = new THREE.Raycaster(r.origin, r.direction);
    ray.params.Line = { threshold: (6 * (this.camera.right - this.camera.left)) / this.camera.zoom / this.canvasSize().w };
    // Only the lines are raycast: THREE leaves Points' threshold at one *world* unit, which at a typical zoom is 40 px and would let a
    // dot take clicks the model needs. A dot is instead hit by the screen-sized reach below, the same one a model vertex gets.
    const lines = this.datumGroup.children.filter((o) => o instanceof THREE.Line);
    for (const hit of ray.intersectObjects(lines, false)) {
      const key = hit.object.userData.datumKey;
      if (typeof key === 'string') return key;
    }
    this.syncCamera();
    const rect = this.renderer.domElement.getBoundingClientRect();
    const { w, h } = this.canvasSize();
    const v = new THREE.Vector3();
    let bestKey: string | null = null;
    let best = 11; // px, the same reach a model vertex gets
    const near = (key: string, p: [number, number, number]) => {
      v.set(p[0], p[1], p[2]).project(this.camera);
      const d = Math.hypot(rect.left + ((v.x + 1) / 2) * w - clientX, rect.top + ((1 - v.y) / 2) * h - clientY);
      if (d < best) {
        best = d;
        bestKey = key;
      }
    };
    for (const p of this.datums.points) near(p.key, p.p);
    for (const c of this.datums.systems) near(c.key, c.origin);
    return bestKey;
  }

  private setHoveredDatum(key: string | null): void {
    if (this.hoveredDatum === key) return;
    this.hoveredDatum = key;
    this.paintDatums();
  }

  // ---------------------------------------------------------------- reference planes (D4.6)

  /** Reference planes to show; each is a translucent square centered on the model's projection. */
  setPlanes(planes: PlaneDisplay[]): void {
    this.planes = planes;
    this.paintPlanes();
  }

  /** Whether the shown planes take the cursor and clicks (a plane to sketch on, or one to put in a reference geometry box). */
  setPlanePicking(enabled: boolean): void {
    this.pickPlanes = enabled;
    if (!enabled) this.setHoveredPlane(null);
  }

  /** The shown plane the cursor is on, nearest first, by its key; null when it is on none. */
  private pickPlane(clientX: number, clientY: number): string | null {
    return this.pickPlaneHit(clientX, clientY)?.key ?? null;
  }

  /** ... and how far that plane is, so a plane the body hides does not take the click meant for the body. */
  private pickPlaneHit(clientX: number, clientY: number): { key: string; distance: number } | null {
    if (!this.planeGroup) return null;
    const r = this.rayAt(clientX, clientY);
    for (const hit of new THREE.Raycaster(r.origin, r.direction).intersectObjects(this.planeGroup.children, false)) {
      const key = hit.object.userData.planeKey;
      if (typeof key === 'string') return { key, distance: hit.distance };
    }
    return null;
  }

  private setHoveredPlane(key: string | null): void {
    if (this.hoveredPlane === key) return;
    this.hoveredPlane = key;
    this.paintPlanes();
  }

  private paintPlanes(): void {
    if (this.planeGroup) {
      this.scene.remove(this.planeGroup);
      disposeGroup(this.planeGroup);
      this.planeGroup = null;
    }
    if (this.planes.length === 0) return this.requestRender();
    const box = this.contentBox();
    const boxCorners = box.isEmpty()
      ? []
      : [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
    const group = new THREE.Group();
    for (const plane of this.planes) {
      const o = new THREE.Vector3(...plane.frame.origin);
      const x = new THREE.Vector3(...plane.frame.xDir);
      const y = new THREE.Vector3(...plane.frame.yDir);
      // Like SolidWorks, a plane is drawn as large as the model seen along its normal, plus a margin.
      let [u0, u1, v0, v1] = [-50, 50, -50, 50];
      if (boxCorners.length > 0) {
        const us = boxCorners.map((c) => c.clone().sub(o).dot(x));
        const vs = boxCorners.map((c) => c.clone().sub(o).dot(y));
        const margin = Math.max(0.1 * Math.max(Math.max(...us) - Math.min(...us), Math.max(...vs) - Math.min(...vs)), 5);
        [u0, u1, v0, v1] = [Math.min(...us) - margin, Math.max(...us) + margin, Math.min(...vs) - margin, Math.max(...vs) + margin];
      }
      const at = (u: number, v: number) => o.clone().addScaledVector(x, u).addScaledVector(y, v);
      const corners = [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
      const fill = new THREE.BufferGeometry().setFromPoints([corners[0]!, corners[1]!, corners[2]!, corners[0]!, corners[2]!, corners[3]!]);
      const lit = plane.highlighted || this.hoveredPlane === plane.key;
      const color = lit ? COLORS.edgeHover : 0x6f9fd6;
      const sheet = new THREE.Mesh(fill, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: lit ? 0.22 : 0.12, side: THREE.DoubleSide, depthWrite: false }));
      sheet.userData.planeKey = plane.key; // what a click on this square stands for
      group.add(sheet);
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([...corners, corners[0]!]), new THREE.LineBasicMaterial({ color })));
    }
    this.planeGroup = group;
    this.scene.add(group);
    this.requestRender();
  }

  private pickFace(clientX: number, clientY: number): number {
    return this.pickFaceHit(clientX, clientY).face;
  }

  /**
   * Cosmetic Threads (C4.9, ADR 0156):
   * Renders lightweight 3/4-circle arcs (ISO 6410-1) and blind-hole boundary rings in 3D.
   */
  setCosmeticThreads(threads: readonly CosmeticThreadDisplay[]): void {
    if (this.cosmeticThreadGroup) {
      this.scene.remove(this.cosmeticThreadGroup);
      disposeGroup(this.cosmeticThreadGroup);
      this.cosmeticThreadGroup = null;
    }
    if (threads.length === 0) return this.requestRender();

    const group = new THREE.Group();
    const positions: number[] = [];

    for (const t of threads) {
      const dir = new THREE.Vector3(...t.axis).normalize();
      const origin = new THREE.Vector3(...t.origin);
      const dia = t.threadType === 'external' ? t.minorDiameter : t.majorDiameter;
      const r = dia / 2;

      // Find two orthogonal vectors u, v
      const arbitrary = Math.abs(dir.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const u = new THREE.Vector3().crossVectors(dir, arbitrary).normalize();
      const v = new THREE.Vector3().crossVectors(dir, u).normalize();

      // 3/4 circle arc (ISO 6410-1: 270 deg, gap in 1st quadrant from 0 to 90 deg)
      const SEGMENTS = 36;
      const startAngle = Math.PI / 2;
      const sweepAngle = (3 * Math.PI) / 2;
      for (let i = 0; i < SEGMENTS; i++) {
        const theta1 = startAngle + (i / SEGMENTS) * sweepAngle;
        const theta2 = startAngle + ((i + 1) / SEGMENTS) * sweepAngle;
        const p1 = origin.clone().addScaledVector(u, r * Math.cos(theta1)).addScaledVector(v, r * Math.sin(theta1));
        const p2 = origin.clone().addScaledVector(u, r * Math.cos(theta2)).addScaledVector(v, r * Math.sin(theta2));
        positions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
      }

      // If blind, draw full end ring at origin + depth * dir
      if (t.endCondition === 'blind' && t.depth > 0) {
        const endOrigin = origin.clone().addScaledVector(dir, t.depth);
        const FULL_SEGS = 32;
        for (let i = 0; i < FULL_SEGS; i++) {
          const theta1 = (i / FULL_SEGS) * 2 * Math.PI;
          const theta2 = ((i + 1) / FULL_SEGS) * 2 * Math.PI;
          const p1 = endOrigin.clone().addScaledVector(u, r * Math.cos(theta1)).addScaledVector(v, r * Math.sin(theta1));
          const p2 = endOrigin.clone().addScaledVector(u, r * Math.cos(theta2)).addScaledVector(v, r * Math.sin(theta2));
          positions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
        }
      }
    }

    if (positions.length > 0) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({ color: 0x3b82f6, depthTest: true });
      group.add(new THREE.LineSegments(geom, mat));
      this.cosmeticThreadGroup = group;
      this.scene.add(group);
    }
    this.requestRender();
  }

  /** The face the cursor is on and how far the body is there: -1 and Infinity when the ray misses it. */
  private pickFaceHit(clientX: number, clientY: number): { face: number; distance: number } {
    if (!this.body) return { face: -1, distance: Infinity };
    const ray = new THREE.Raycaster();
    const r = this.rayAt(clientX, clientY);
    ray.set(r.origin, r.direction);
    const hit = ray.intersectObject(this.body).find((h) => this.kept(h.point));
    return { face: hit?.faceIndex !== undefined && hit.faceIndex !== null ? (this.triangleFace[hit.faceIndex] ?? -1) : -1, distance: hit?.distance ?? Infinity };
  }

  setSelectedEdges(edges: Iterable<number>): void {
    this.selected = new Set(edges);
    this.paintEdges();
  }

  private paintEdges(): void {
    if (this.sectionEdges) {
      (this.sectionEdges.material as THREE.LineBasicMaterial).color.setHex(COLORS.edge);
    }
    if (this.silhouetteEdges) {
      (this.silhouetteEdges.material as THREE.LineBasicMaterial).color.setHex(COLORS.edge);
    }
    if (!this.edges) return;
    const attr = this.edges.geometry.getAttribute('color') as THREE.BufferAttribute;
    // with no edges drawn ('shaded') the edges are the colour of the body: they are still there to hover and to pick
    const base = new THREE.Color(this.displayMode === 'shaded' ? COLORS.body : COLORS.edge);
    // edges that the selection filter does not let be picked are drawn faint: what cannot be picked looks like it
    if (this.pickEdges && !this.filter.edges) base.lerp(new THREE.Color(COLORS.background), 0.7);
    const hover = new THREE.Color(COLORS.edgeHover);
    const sel = new THREE.Color(COLORS.edgeSelected);
    for (let s = 0; s < this.segmentEdge.length; s++) {
      const e = this.segmentEdge[s]!;
      const c = e === this.hovered ? hover : this.selected.has(e) ? sel : base;
      for (const v of [2 * s, 2 * s + 1]) attr.setXYZ(v, c.r, c.g, c.b);
    }
    attr.needsUpdate = true;
    this.requestRender();
  }

  private setHovered(edge: number): void {
    if (edge === this.hovered) return;
    this.hovered = edge;
    this.paintEdges();
    this.events.onEdgeHover?.(edge);
  }

  private pick(clientX: number, clientY: number): number {
    if (!this.edges) return -1;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.params.Line = { threshold: (6 * (this.camera.right - this.camera.left)) / this.camera.zoom / rect.width };
    ray.set(this.rayAt(clientX, clientY).origin, this.rayAt(clientX, clientY).direction);
    const hits = ray.intersectObject(this.edges);
    // Prefer edges not hidden behind the body.
    const seeThrough = this.displayMode === 'wireframe' || this.displayMode === 'hiddenVisible';
    const bodyHit = this.body && !seeThrough ? this.firstBodyHit(ray) : Infinity;
    const visible = hits.filter((h) => this.kept(h.point) && h.distance <= bodyHit + (1e-3 * (this.camera.right - this.camera.left)) / this.camera.zoom);
    const hit = visible[0] ?? null;
    return hit && hit.index !== undefined ? (this.segmentEdge[Math.floor(hit.index / 2)] ?? -1) : -1;
  }

  private tool(type: ToolPointerEvent['type'], e: MouseEvent, pressed: boolean): void {
    this.toolHandler?.({ type, clientX: e.clientX, clientY: e.clientY, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, pressed });
  }

  private onPointerDown = (e: PointerEvent) => {
    this.swallowClick = false; // a new press: whatever the last drag left no longer applies
    this.swallowContext = false;
    if (this.dragInstances && !this.toolHandler && (e.button === 0 || e.button === 2) && !e.altKey && !e.ctrlKey && !e.shiftKey) {
      const hit = this.hitInstance(e.clientX, e.clientY);
      this.press = hit && { ...hit, button: e.button === 0 ? 'left' : 'right', x: e.clientX, y: e.clientY, pointerId: e.pointerId, dragging: false };
    }
    if (!this.toolHandler || e.button !== 0 || e.altKey) return;
    try {
      this.renderer.domElement.setPointerCapture(e.pointerId); // keep receiving moves while dragging outside
    } catch {
      // the pointer is already gone (or the event is synthetic): nothing to capture
    }
    this.tool('down', e, true);
  };

  private onPointerMove = (e: PointerEvent) => {
    if (this.snapPicking && e.buttons === 0) {
      this.snapEvents.hover?.(this.snapAt(e.clientX, e.clientY));
      return;
    }
    if (this.clip.length > 0 && !this.sectionDrag && e.buttons === 0) this.setSectionCursor(!!this.sectionHit(e.clientX, e.clientY));
    else if (this.clip.length === 0 && this.sectionCursor) this.setSectionCursor(false);
    if (this.press) {
      if (e.buttons & (this.press.button === 'left' ? 1 : 2)) return this.dragMove(e);
      // Released where the canvas could not see it: a drag ends there, as if released.
      const p = this.press;
      this.press = null;
      if (p.dragging) this.events.onComponentDragEnd?.(false);
    }
    if (this.toolHandler) {
      if (e.buttons === 0 || e.buttons === 1) this.tool('move', e, e.buttons === 1);
      return;
    }
    if (e.buttons !== 0) return;
    if (this.pickInstances) this.setHoveredInstance(this.pickInstance(e.clientX, e.clientY));
    if (this.pickElements) this.setHoveredElement(this.pickElement(e.clientX, e.clientY));
    // One element at a time, in the order a click takes it (pickOrder).
    const p = this.pickOrder(e.clientX, e.clientY);
    this.setHoveredVertex(p.vertex);
    this.setHovered(p.edge);
    this.setHoveredFace(p.face);
    this.setHoveredDatum(p.datum);
    this.setHoveredPlane(p.plane);
  };

  private onPointerUp = (e: PointerEvent) => {
    const p = this.press;
    if (p && e.button === (p.button === 'left' ? 0 : 2)) {
      this.press = null;
      if (p.dragging) {
        this.swallowClick = p.button === 'left';
        this.swallowContext = p.button === 'right';
        this.events.onComponentDragEnd?.(false);
        return;
      }
    }
    if (!this.toolHandler || e.button !== 0 || e.altKey) return;
    this.tool('up', e, false);
  };

  private onPointerLeave = (e: PointerEvent) => {
    if (!this.sectionDrag) this.setSectionCursor(false);
    if (this.toolHandler) this.tool('leave', e, false);
    this.setHoveredVertex(-1);
    this.setHovered(-1);
    this.setHoveredFace(-1);
    this.setHoveredInstance(null);
    this.setHoveredElement(null);
  };

  private onClick = (e: MouseEvent) => {
    if (this.swallowClick) {
      this.swallowClick = false;
      return;
    }
    if (this.toolHandler || e.altKey) return;
    if (this.snapPicking) {
      const snap = this.snapAt(e.clientX, e.clientY);
      if (snap) this.snapEvents.pick?.(snap);
      return;
    }
    const additive = e.ctrlKey || e.shiftKey;
    if (this.pickElements) return void this.events.onElementClick?.(this.pickElement(e.clientX, e.clientY), additive);
    if (this.pickInstances) return void this.events.onComponentClick?.(this.pickInstance(e.clientX, e.clientY), additive);
    const p = this.pickOrder(e.clientX, e.clientY);
    if (p.vertex >= 0) return void this.events.onVertexClick?.(p.vertex, additive);
    if (p.edge >= 0 || (this.edgesOn && !this.facesOn)) return void this.events.onEdgeClick?.(p.edge, additive);
    if (p.datum) return void this.events.onDatumClick?.(p.datum, additive);
    if (p.face >= 0) return void this.events.onFaceClick?.(p.face, additive);
    if (p.plane) return void this.events.onPlaneClick?.(p.plane, additive);
    if (this.facesOn) this.events.onFaceClick?.(-1, additive);
  };

  private onDoubleClick = (e: MouseEvent) => {
    if (this.toolHandler && !e.altKey) this.tool('dblclick', e, false);
  };

  // ---------------------------------------------------------------- display modes (A4.3) and section (D4.4)

  setDisplayMode(mode: DisplayMode): void {
    this.displayMode = mode;
    this.paintEdges();
    this.applyDisplay();
  }

  /** Cuts the model open at a plane, or (null) puts it back. */
  setSection(section: SectionPlane | null): void {
    this.section = section;
    this.clip = section ? [new THREE.Plane(new THREE.Vector3(...section.normal).normalize().negate(), section.offset)] : [];
    this.applyDisplay();
  }

  /** The corners of the box round everything on show, or null when nothing is. */
  contentBounds(): { min: [number, number, number]; max: [number, number, number] } | null {
    const box = this.contentBox();
    return box.isEmpty() ? null : { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] };
  }

  /** Who is told the new position (along the axis of the cut, as `at` in the SectionPlane's own terms) while the cut is dragged with the left button; null: it cannot be dragged. */
  setSectionDrag(handler: ((at: number) => void) | null): void {
    this.sectionDragHandler = handler;
    if (!handler) this.endSectionDrag();
  }

  /**
   * Where the cut is under the cursor, or null: the point of the cut plane the cursor is on when that is inside a solid (an odd number of its surfaces ahead along a direction
   * that is no axis) and no kept surface is in front of it. That is where the orange fill is, the part of the cut that can be taken hold of.
   */
  private sectionHit(clientX: number, clientY: number): THREE.Vector3 | null {
    const plane = this.clip[0];
    if (!plane || !this.sectionDragHandler || this.toolHandler || this.pickElements) return null;
    const solids = [...(this.body ? [this.body] : []), ...[...this.instances.values()].map((i) => i.body)];
    if (solids.length === 0) return null;
    const ray = this.rayAt(clientX, clientY);
    const at = ray.intersectPlane(plane, new THREE.Vector3());
    if (!at) return null;
    const along = at.clone().sub(ray.origin).dot(ray.direction);
    const first = new THREE.Raycaster(ray.origin, ray.direction).intersectObjects(solids, false).find((h) => this.kept(h.point));
    const size = this.contentBox().getSize(new THREE.Vector3()).length() || 1;
    if (first && first.distance < along - 1e-6 * size) return null; // something kept hides the cut here
    const probe = new THREE.Raycaster(at, new THREE.Vector3(0.267, 0.534, 0.802).normalize());
    return solids.some((m) => probe.intersectObject(m, false).length % 2 === 1) ? at : null;
  }

  private setSectionCursor(on: boolean): void {
    if (on === this.sectionCursor) return;
    this.sectionCursor = on;
    this.renderer.domElement.style.cursor = on ? 'grab' : '';
  }

  /** A left press on the cut: it follows the pointer along its axis until the button is let go. The mapping is the screen's: how far the axis moves a point on the screen. */
  private onSectionDown = (e: PointerEvent) => {
    const section = this.section;
    const handler = this.sectionDragHandler;
    if (e.button !== 0 || e.altKey || e.ctrlKey || e.shiftKey || !section || !handler || this.sectionDrag) return;
    const grab = this.sectionHit(e.clientX, e.clientY);
    if (!grab) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    // the axis the cut is across, as a positive unit vector, and where the cut is on it
    const n = new THREE.Vector3(...section.normal);
    const sign = Math.sign(n.x + n.y + n.z) || 1;
    const axis = n.clone().multiplyScalar(sign);
    const index = Math.abs(axis.x) > 0.5 ? 0 : Math.abs(axis.y) > 0.5 ? 1 : 2;
    const startAt = sign * section.offset;
    const bounds = this.contentBounds();
    const [lo, hi] = bounds ? [bounds.min[index], bounds.max[index]] : [-Infinity, Infinity];
    // screen pixels for one unit along the axis at the grab (the camera looks straight, so it is the same everywhere); where the axis points at the viewer that is nothing, and then up and down is what moves it
    this.syncCamera();
    const rect = this.renderer.domElement.getBoundingClientRect();
    const toPx = (p: THREE.Vector3): [number, number] => {
      const q = p.clone().project(this.camera);
      return [((q.x + 1) / 2) * rect.width, ((1 - q.y) / 2) * rect.height];
    };
    const a = toPx(grab);
    const b = toPx(grab.clone().add(axis));
    const s: [number, number] = [b[0] - a[0], b[1] - a[1]];
    const perUnit = rect.height / ((this.camera.top - this.camera.bottom) / this.camera.zoom);
    const straightOn = Math.hypot(s[0], s[1]) < 0.3 * perUnit;
    const from: [number, number] = [e.clientX, e.clientY];
    const dom = this.renderer.domElement;
    dom.style.cursor = 'grabbing';
    const move = (m: PointerEvent) => {
      const dx = m.clientX - from[0];
      const dy = m.clientY - from[1];
      const delta = straightOn ? -dy / perUnit : (dx * s[0] + dy * s[1]) / (s[0] * s[0] + s[1] * s[1]);
      handler(Math.min(hi, Math.max(lo, startAt + delta)));
    };
    const up = () => {
      this.endSectionDrag();
      this.swallowClick = true; // the click that ends the press is not a pick
      setTimeout(() => (this.swallowClick = false), 0);
    };
    this.sectionDrag = { move, up };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  private endSectionDrag(): void {
    const d = this.sectionDrag;
    if (!d) return;
    window.removeEventListener('pointermove', d.move);
    window.removeEventListener('pointerup', d.up);
    window.removeEventListener('pointercancel', d.up);
    this.sectionDrag = null;
    this.renderer.domElement.style.cursor = this.sectionCursor ? 'grab' : '';
  }

  /** Is the point on the side of the section that is kept? */
  private kept(p: THREE.Vector3): boolean {
    return this.clip.every((c) => c.distanceToPoint(p) >= -1e-9);
  }

  private firstBodyHit(ray: THREE.Raycaster): number {
    return this.body ? (ray.intersectObject(this.body).find((h) => this.kept(h.point))?.distance ?? Infinity) : Infinity;
  }

  /** Puts the body and its edges as the display mode and the section say. */
  private applyDisplay(): void {
    const mode = this.displayMode;
    const body = this.body;
    if (body) {
      const m = body.material as THREE.MeshStandardMaterial;
      const seeThrough = mode === 'wireframe' || mode === 'hiddenVisible';
      m.colorWrite = !seeThrough;
      m.depthWrite = mode !== 'wireframe';
      m.emissive.set(mode === 'hiddenRemoved' ? 0xffffff : 0x000000);
      m.emissiveIntensity = mode === 'hiddenRemoved' ? 0.85 : 1;
      m.clippingPlanes = this.clip;
      // both sides always: a surface body has no inside, and looking into its open end shows the wall from within (not only while a section is cut)
      m.side = THREE.DoubleSide;
      m.needsUpdate = true;
      this.paintBodyColors();
    }
    if (this.edges) {
      const m = this.edges.material as THREE.LineBasicMaterial;
      m.clippingPlanes = this.clip;
      m.needsUpdate = true;
    }
    for (const inst of this.instances.values()) this.styleInstance(inst);
    // with no edges drawn ('shaded') the components' edges are the colour of the body
    this.instanceEdges.color.setHex(mode === 'shaded' ? COLORS.body : COLORS.edge);
    if ((this.instanceEdges.clippingPlanes?.length ?? 0) !== this.clip.length) this.instanceEdges.needsUpdate = true;
    this.instanceEdges.clippingPlanes = this.clip;
    if (mode === 'hiddenVisible' && this.edges && !this.hiddenEdges) {
      const g = this.edges.geometry.clone();
      const line = new THREE.LineSegments(g, new THREE.LineDashedMaterial({ color: COLORS.ghost, dashSize: 1, gapSize: 1, depthFunc: THREE.GreaterDepth, depthWrite: false }));
      line.computeLineDistances();
      this.hiddenEdges = line;
      this.scene.add(line);
    }
    if (this.hiddenEdges) {
      this.hiddenEdges.visible = mode === 'hiddenVisible';
      const m = this.hiddenEdges.material as THREE.LineDashedMaterial;
      const box = this.contentBox();
      const size = box.isEmpty() ? 100 : box.getSize(new THREE.Vector3()).length();
      m.dashSize = size / 150;
      m.gapSize = size / 300;
      m.clippingPlanes = this.clip;
      m.needsUpdate = true;
    }
    this.updateCap();
    this.updateSectionEdges();
    this.lastSilViewDir = null;
    this.updateSilhouettes();
    this.requestRender();
  }

  /**
   * The cut of a section is filled (D4.4): without it a solid cut open looks like an empty shell, its inside walls showing. By the stencil method: for each solid the
   * clipped back faces count up and the clipped front faces count down, so the stencil is non-zero exactly where the cut plane is inside the solid; a plane there, drawn
   * after those two, is the cap. One group per solid (a body, or a component), cleared in between, so solids that overlap do not cancel each other out.
   */
  private updateCap(): void {
    const plane = this.clip[0];
    const mode = this.displayMode;
    const solids: { mesh: THREE.Mesh; parent: THREE.Object3D; id: string }[] = [];
    if (plane && mode !== 'wireframe' && mode !== 'hiddenVisible') {
      if (this.body) solids.push({ mesh: this.body, parent: this.scene, id: this.body.uuid });
      for (const inst of this.instances.values()) if (!(inst.body.material as THREE.Material).transparent) solids.push({ mesh: inst.body, parent: inst.group, id: inst.body.uuid });
    }
    const key = solids.map((x) => x.id).join(',');
    if (this.cap && (!plane || this.cap.key !== key)) {
      for (const o of this.cap.objects) o.removeFromParent();
      for (const m of this.cap.materials) m.dispose();
      for (const o of this.cap.planes) o.geometry.dispose();
      this.cap = null;
    }
    if (!plane || solids.length === 0) return;
    if (!this.cap) {
      const wrap = (op: THREE.StencilOp) => ({ stencilFail: op, stencilZFail: op, stencilZPass: op });
      const through = { depthWrite: false, depthTest: false, colorWrite: false, stencilWrite: true, stencilFunc: THREE.AlwaysStencilFunc, clippingPlanes: this.clip };
      const back = new THREE.MeshBasicMaterial({ ...through, side: THREE.BackSide, ...wrap(THREE.IncrementWrapStencilOp) });
      const front = new THREE.MeshBasicMaterial({ ...through, side: THREE.FrontSide, ...wrap(THREE.DecrementWrapStencilOp) });
      const fill = new THREE.MeshStandardMaterial({ color: COLORS.cap, metalness: 0.05, roughness: 0.85, side: THREE.DoubleSide, stencilWrite: true, stencilRef: 0, stencilFunc: THREE.NotEqualStencilFunc, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, ...wrap(THREE.ReplaceStencilOp) });
      const objects: THREE.Object3D[] = [];
      const planes: THREE.Mesh[] = [];
      solids.forEach(({ mesh, parent }, i) => {
        for (const [material, order] of [[back, 2 * i + 1], [front, 2 * i + 1]] as const) {
          const m = new THREE.Mesh(mesh.geometry, material);
          m.renderOrder = order;
          m.raycast = () => {}; // never picked
          parent.add(m);
          objects.push(m);
        }
        const cap = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), fill);
        cap.renderOrder = 2 * i + 2;
        cap.raycast = () => {};
        cap.onAfterRender = (r) => r.clearStencil(); // the next solid starts from zero
        this.scene.add(cap);
        objects.push(cap);
        planes.push(cap);
      });
      this.cap = { key, objects, planes, materials: [back, front, fill] };
    }
    // where the cut is now: the cap follows the slider without being made again. setSection makes a new plane each time, so the stencil passes
    // have to be given it too (they would count for the place the cut was made at)
    for (const m of this.cap.materials) if (m instanceof THREE.MeshBasicMaterial) m.clippingPlanes = this.clip;
    const box = this.contentBox();
    const size = box.isEmpty() ? 1000 : box.getSize(new THREE.Vector3()).length() * 2;
    const at = plane.coplanarPoint(new THREE.Vector3());
    const turn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), plane.normal);
    for (const c of this.cap.planes) {
      c.position.copy(at);
      c.quaternion.copy(turn);
      c.scale.set(size, size, 1);
    }
  }

  /**
   * Generates and updates section cut boundary lines at the intersection of the model and the active section plane.
   * Visible in all edge-drawing display modes (wireframe, shadedEdges, hiddenRemoved, hiddenVisible).
   */
  private updateSectionEdges(): void {
    const plane = this.clip[0];
    const mode = this.displayMode;
    const showEdges = !!plane && mode !== 'shaded';
    if (!showEdges) {
      if (this.sectionEdges) this.sectionEdges.visible = false;
      return;
    }

    const solids: { mesh: THREE.Mesh; matrixWorld: THREE.Matrix4 }[] = [];
    if (this.body) {
      solids.push({ mesh: this.body, matrixWorld: this.body.matrixWorld });
    }
    for (const inst of this.instances.values()) {
      if (!(inst.body.material as THREE.Material).transparent) {
        inst.body.updateMatrixWorld(true);
        solids.push({ mesh: inst.body, matrixWorld: inst.body.matrixWorld });
      }
    }

    const segs = joinSegments(solids.map(({ mesh, matrixWorld }) => sliceMeshByPlane(mesh.geometry, plane, matrixWorld)));

    if (segs.length === 0) {
      if (this.sectionEdges) this.sectionEdges.visible = false;
      return;
    }

    if (!this.sectionEdges) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
      const m = new THREE.LineBasicMaterial({
        color: COLORS.edge,
        depthTest: true,
        depthWrite: false,
      });
      this.sectionEdges = new THREE.LineSegments(g, m);
      this.sectionEdges.renderOrder = 999;
      this.sectionEdges.raycast = () => {};
      this.scene.add(this.sectionEdges);
    } else {
      const g = this.sectionEdges.geometry;
      g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
      (this.sectionEdges.material as THREE.LineBasicMaterial).color.setHex(COLORS.edge);
      this.sectionEdges.visible = true;
    }
  }

  /**
   * Generates and updates view-dependent dynamic silhouette edges of curved surfaces (SolidWorks style).
   * Active in wireframe, hiddenVisible, and hiddenRemoved modes.
   */
  private updateSilhouettes(): void {
    const mode = this.displayMode;
    const needSilhouettes = mode === 'wireframe' || mode === 'hiddenVisible' || mode === 'hiddenRemoved';
    if (!needSilhouettes) {
      if (this.silhouetteEdges) this.silhouetteEdges.visible = false;
      return;
    }

    const viewDir = new THREE.Vector3();
    this.camera.getWorldDirection(viewDir).negate();

    if (this.lastSilViewDir && this.lastSilViewDir.angleTo(viewDir) < 1e-4 && this.silhouetteEdges?.visible) {
      return;
    }
    this.lastSilViewDir = viewDir.clone();

    const solids: { silIndex: SilhouetteIndex; pos: ArrayLike<number>; matrixWorld?: THREE.Matrix4 }[] = [];
    if (this.body && this.bodySilIndex) {
      const pos = this.body.geometry.getAttribute('position');
      if (pos) solids.push({ silIndex: this.bodySilIndex, pos: pos.array as ArrayLike<number> });
    }
    for (const inst of this.instances.values()) {
      const geo = this.partGeometry.get(inst.part);
      if (geo && geo.silIndex && !(inst.body.material as THREE.Material).transparent) {
        const pos = geo.body.getAttribute('position');
        if (pos) {
          inst.body.updateMatrixWorld(true);
          solids.push({ silIndex: geo.silIndex, pos: pos.array as ArrayLike<number>, matrixWorld: inst.body.matrixWorld });
        }
      }
    }

    const segs = joinSegments(solids.map(({ silIndex, pos, matrixWorld }) => extractSilhouettes(silIndex, pos, viewDir, matrixWorld)));

    if (segs.length === 0) {
      if (this.silhouetteEdges) this.silhouetteEdges.visible = false;
      return;
    }

    if (!this.silhouetteEdges) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
      const m = new THREE.LineBasicMaterial({
        color: COLORS.edge,
        clippingPlanes: this.clip,
        depthTest: true,
        depthWrite: false,
      });
      this.silhouetteEdges = new THREE.LineSegments(g, m);
      this.silhouetteEdges.renderOrder = 998;
      this.silhouetteEdges.raycast = () => {};
      this.scene.add(this.silhouetteEdges);
    } else {
      const g = this.silhouetteEdges.geometry;
      g.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
      const m = this.silhouetteEdges.material as THREE.LineBasicMaterial;
      m.color.setHex(COLORS.edge);
      m.clippingPlanes = this.clip;
      m.needsUpdate = (m.clippingPlanes?.length ?? 0) !== this.clip.length;
      this.silhouetteEdges.visible = true;
    }
  }

  /**
   * The rotation of the view as a CSS `matrix3d` (D4.3): what turns a cube drawn with x to the right, y down and z toward the viewer so that it shows
   * the model's axes as the camera sees them.
   */
  cubeMatrix(): number[] {
    this.camera.updateMatrixWorld();
    const e = this.camera.matrixWorldInverse.clone().copy(this.camera.matrixWorld).invert().elements;
    // column-major, rotation only. The cube is drawn in CSS's frame (y down) and the camera's is y up: M = S · R · S, S turning y over
    const r = (row: number, col: number) => e[col * 4 + row]!;
    const m = (row: number, col: number) => (row === 1 ? -1 : 1) * (col === 1 ? -1 : 1) * r(row, col);
    return [m(0, 0), m(1, 0), m(2, 0), 0, m(0, 1), m(1, 1), m(2, 1), 0, m(0, 2), m(1, 2), m(2, 2), 0, 0, 0, 0, 1];
  }

  /** Called whenever the camera moves, zooms or the viewport is resized. Returns the way to stop. */
  subscribeView(fn: () => void): () => void {
    this.viewListeners.add(fn);
    return () => this.viewListeners.delete(fn);
  }

  // ---------------------------------------------------------------- views

  setView(view: StandardView): void {
    this.rememberView();
    const [dir, up] = VIEW_DIRS[view];
    this.orient(dir, up);
    this.fitView();
  }

  // ---------------------------------------------------------------- the view from the keyboard (SolidWorks), and 「上一個視角」

  /** Looks at the model from one of the view cube's 26 directions (a face, an edge or a corner: see cubeDirection), all of it in view. */
  lookFrom(x: number, y: number, z: number): void {
    const { dir, up } = cubeDirection(x, y, z);
    this.rememberView();
    this.orient(dir, up);
    this.fitView();
  }

  /** Turns the model about the screen's vertical (`'horizontal'`, positive right) or horizontal axis (`'vertical'`, positive up) through its middle. */
  orbit(direction: 'horizontal' | 'vertical', degrees: number): void {
    this.rememberView();
    orbitView(this.camera, this.controls.target, direction, degrees);
    this.viewChanged();
  }

  /** Turns the model in the plane of the screen: positive is clockwise. */
  roll(degrees: number): void {
    this.rememberView();
    rollView(this.camera, this.controls.target, degrees);
    this.viewChanged();
  }

  /** Moves the model on the screen by fractions of the view (positive right and up). */
  pan(fx: number, fy: number): void {
    this.rememberView();
    panView(this.camera, this.controls.target, fx, fy);
    this.viewChanged();
  }

  /** Makes the model `factor` times bigger on the screen. */
  zoom(factor: number): void {
    this.rememberView();
    zoomView(this.camera, factor);
    this.viewChanged();
  }

  /** 「上一個視角」 (Ctrl+Shift+Z): the view before the last change of it, at the window's present shape. False when there is none. */
  previousView(): boolean {
    const s = this.viewHistory.pop();
    if (!s) return false;
    restoreView(this.camera, this.controls.target, s);
    // the window may have changed shape since: keep the height of the view and fit its width to the window, as a resize does
    const { w, h } = this.canvasSize();
    const halfH = (this.camera.top - this.camera.bottom) / 2 || 1;
    this.camera.left = -halfH * (w / h);
    this.camera.right = halfH * (w / h);
    this.camera.updateProjectionMatrix();
    this.viewChanged();
    return true;
  }

  /** Keeps the view as it is now, to come back to with previousView. */
  private rememberView(): void {
    this.viewHistory.push(viewState(this.camera, this.controls.target));
  }

  /** Looks straight at a plane (「正視於」, C1.2): view direction −normal, screen up = the plane's y. */
  lookAt(frame: PlaneFrame): void {
    this.rememberView();
    this.orient(new THREE.Vector3(...frame.normal), new THREE.Vector3(...frame.yDir));
    this.viewChanged();
  }

  /**
   * The principal view (front, back, top, bottom, left, right) the camera sits nearest to, and whether it is already looking straight along it (「正視於」 with nothing
   * to look at: a first press goes to the nearest, one made there goes to the other side).
   */
  nearestPrincipalView(): { view: PrincipalView; straight: boolean } {
    const { key, dot } = nearestView(this.viewDirection(), VIEW_DIRS_OF, PRINCIPAL_ORDER);
    return { view: key, straight: dot > 0.999 };
  }

  /** The direction the camera looks along, normalized (from the camera toward its target). */
  viewDirection(): [number, number, number] {
    const d = new THREE.Vector3();
    this.camera.getWorldDirection(d);
    return [d.x, d.y, d.z];
  }

  private orient(dir: THREE.Vector3, up: THREE.Vector3): void {
    const dist = 1000;
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
    this.camera.up.copy(up);
    this.camera.lookAt(this.controls.target);
  }

  /** Zoom to fit (「全部顯示」), kept for 「上一個視角」. Deferred while the viewport has no size (hidden tab, minimized window). */
  fitAll(): void {
    this.rememberView();
    this.fitView();
  }

  /** Zoom to fit, as the view's own step (a new part, a standard view): not a view of its own to come back to. */
  private fitView(): void {
    if (this.container.clientWidth === 0 || this.container.clientHeight === 0) {
      this.pendingFit = true;
      return;
    }
    this.pendingFit = false;
    const box = this.contentBox();
    if (this.overlayGroup) box.union(new THREE.Box3().setFromObject(this.overlayGroup));
    if (this.picturesGroup) box.union(new THREE.Box3().setFromObject(this.picturesGroup));
    if (box.isEmpty()) box.set(new THREE.Vector3(-50, -50, -50), new THREE.Vector3(50, 50, 50));
    const center = box.getCenter(new THREE.Vector3());
    const radius = box.getBoundingSphere(new THREE.Sphere()).radius || 50;
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(dir, radius * 10);
    this.camera.lookAt(center);
    const aspect = this.container.clientWidth / this.container.clientHeight;
    const half = radius * 1.15;
    this.camera.left = -half * Math.max(aspect, 1);
    this.camera.right = half * Math.max(aspect, 1);
    this.camera.top = half / Math.min(aspect, 1);
    this.camera.bottom = -half / Math.min(aspect, 1);
    this.camera.zoom = 1;
    this.camera.updateProjectionMatrix();
    this.viewChanged();
  }

  private resize(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w === 0 || h === 0) return; // keep the last good frustum; a zero size would distort the aspect ratio
    this.renderer.setSize(w, h);
    for (const m of this.measureMaterials) m.resolution.set(w, h);
    if (this.pendingFit) {
      this.fitView();
      return;
    }
    const halfH = (this.camera.top - this.camera.bottom) / 2 || 1;
    this.camera.left = -halfH * (w / h);
    this.camera.right = halfH * (w / h);
    this.camera.updateProjectionMatrix();
    this.viewChanged();
  }

  private viewChanged(): void {
    if (this.originShown) this.paintOrigin(); // a constant size on screen
    if (this.datums.points.length + this.datums.systems.length > 0) this.paintDatums();
    this.events.onViewChange?.();
    for (const fn of this.viewListeners) fn();
    this.requestRender();
  }

  // ---------------------------------------------------------------- triad (D4.2)

  private buildTriad(): void {
    const axes: [THREE.Vector3, number][] = [
      [new THREE.Vector3(1, 0, 0), 0xe03131],
      [new THREE.Vector3(0, 1, 0), 0x2f9e44],
      [new THREE.Vector3(0, 0, 1), 0x1c7ed6],
    ];
    for (const [dir, color] of axes) {
      this.triadScene.add(new THREE.ArrowHelper(dir, new THREE.Vector3(), 1, color, 0.3, 0.16));
    }
  }

  // ---------------------------------------------------------------- render loop

  requestRender(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.render();
    });
  }

  /**
   * The picture on the screen as a PNG (F3.3), the size of the canvas: drawn again and taken in the same step, since the canvas does not keep what it
   * showed. Null when the browser cannot make one.
   */
  snapshot(): Promise<Blob | null> {
    this.render();
    return new Promise((resolve) => this.renderer.domElement.toBlob(resolve, 'image/png'));
  }

  private render(): void {
    this.updateSilhouettes();
    const r = this.renderer;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    r.setViewport(0, 0, w, h);
    r.clear();
    r.render(this.scene, this.camera);
    if (this.overlayScene.children.length > 0) {
      r.clearDepth();
      r.render(this.overlayScene, this.camera);
    }
    const canvas = this.canvasSize();
    for (const { el, world, offset } of [...this.labels.values(), ...[...this.measureLabels.values()]]) {
      const v = world.clone().project(this.camera);
      const [ox, oy] = offset ?? [0, 0];
      el.style.transform = `translate(${((v.x + 1) / 2) * canvas.w + ox}px, ${((1 - v.y) / 2) * canvas.h + oy}px) translate(-50%, -50%)`;
    }
    const size = 90;
    const offset = this.camera.position.clone().sub(this.controls.target).normalize().multiplyScalar(5);
    this.triadCamera.position.copy(offset);
    this.triadCamera.up.copy(this.camera.up);
    this.triadCamera.lookAt(0, 0, 0);
    r.clearDepth();
    r.setViewport(8, 8, size, size);
    r.render(this.triadScene, this.triadCamera);
  }
}

function clearMarks(marks: THREE.Group): void {
  for (const m of [...marks.children]) {
    marks.remove(m);
    const o = m as THREE.Mesh;
    o.geometry.dispose();
    (o.material as THREE.Material).dispose();
  }
}
