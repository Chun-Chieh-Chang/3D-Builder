import type { Pose, Vec3 } from './schema';

/**
 * Measuring (E1.1): what is picked, what is found out about each element, and what two elements are to each other. The numbers come from the kernel in the
 * frame of the part, or of the assembly when the part is a component; what they say is worked out here.
 */
export type MeasureKind = 'face' | 'edge' | 'vertex';

/** An element to measure: where it is in the model (a part by its key, or the open part when null), the number it has in that part's topology, and how the part is placed. */
export interface MeasureTarget {
  /** The key of the part file as built for an assembly; null for the part that is open. */
  part: string | null;
  /** The part is the mirror of the file's (C15.13): its x → −x, before the pose. */
  mirrored: boolean;
  /** Where the part is in the assembly; null for the open part, which is measured as it is. */
  pose: Pose | null;
  kind: MeasureKind;
  /** The element's number in the order of the kernel's topology (what the mesh's face, edge and vertex numbers are). */
  index: number;
}

/** What one element is, in the frame it was measured in. A number that does not apply is null. */
export interface MeasureElement {
  kind: MeasureKind;
  /** "plane", "cylinder", "line", "circle", … ("point" for a vertex). */
  type: string;
  /** A vertex's place; for a face the center of its area, for an edge its middle. */
  point: Vec3;
  /** mm². */
  area: number | null;
  /** mm: the length of an edge. */
  length: number | null;
  /** mm: of a cylinder, sphere, circle or arc. */
  radius: number | null;
  /** The way the element points: a plane's normal, an axis, a line's direction (what an angle is measured between). */
  direction: Vec3 | null;
}

/** The shortest way from one element to the other: the length, and the two points that make it. */
export interface MeasureDistance {
  value: number;
  a: Vec3;
  b: Vec3;
  /** b − a: how far apart the points are along each axis. */
  delta: Vec3;
}

export interface MeasureReport {
  elements: MeasureElement[];
  /** Only for two elements. */
  distance: MeasureDistance | null;
  /** Degrees between the two elements' directions, the acute one (0 to 90): null when one of them has no direction or there are not two. */
  angle: number | null;
}

/** The parts of the kernel's face, edge and vertex information that are used: the kernel's own types are assignable to these. */
export interface FaceFacts {
  surface: string;
  area: number;
  center: Vec3;
  normal: Vec3 | null;
  geometry?: { type: string; axis?: Vec3; normal?: Vec3; radius?: number };
}
export interface EdgeFacts {
  curve: string;
  length: number;
  mid: Vec3;
  dir: Vec3 | null;
  geometry?: { type: string; normal?: Vec3; radius?: number };
}
export interface VertexFacts {
  point: Vec3;
}

export function faceElement(f: FaceFacts): MeasureElement {
  const g = f.geometry;
  const direction = f.normal ?? (g && (g.axis ?? g.normal)) ?? null;
  const radius = g && (g.type === 'cylinder' || g.type === 'sphere') ? (g.radius ?? null) : null;
  return { kind: 'face', type: f.surface, point: f.center, area: f.area, length: null, radius, direction };
}

export function edgeElement(e: EdgeFacts): MeasureElement {
  const g = e.geometry;
  const direction = e.dir ?? (g?.type === 'circle' ? (g.normal ?? null) : null);
  return { kind: 'edge', type: e.curve, point: e.mid, area: null, length: e.length, radius: g?.type === 'circle' ? (g.radius ?? null) : null, direction };
}

export function vertexElement(v: VertexFacts): MeasureElement {
  return { kind: 'vertex', type: 'point', point: v.point, area: null, length: null, radius: null, direction: null };
}

/** Degrees between two directions, whichever way each of them points (so 0 to 90). */
export function angleBetween(a: Vec3, b: Vec3): number {
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = Math.hypot(...a) * Math.hypot(...b);
  if (!(norm > 0)) return NaN;
  return (Math.acos(Math.min(1, Math.abs(dot) / norm)) * 180) / Math.PI;
}

/** What the picked elements are to each other, from what is known of each and the shortest distance the kernel found between them (two elements only). */
export function measureReport(elements: MeasureElement[], distance: { distance: number; pointA: Vec3; pointB: Vec3 } | null): MeasureReport {
  const [a, b] = elements;
  const angle = a?.direction && b?.direction ? angleBetween(a.direction, b.direction) : null;
  return {
    elements,
    distance: distance ? { value: distance.distance, a: distance.pointA, b: distance.pointB, delta: [distance.pointB[0] - distance.pointA[0], distance.pointB[1] - distance.pointA[1], distance.pointB[2] - distance.pointA[2]] } : null,
    angle: angle !== null && Number.isFinite(angle) ? angle : null,
  };
}

/**
 * The motion that puts a part where the assembly has it, as the kernel wants it (row-major 3 × 4: the rotation, then the translation as the last column).
 * A mirrored part is the part's own x → −x first, which flips the first column.
 */
export function placementRows(pose: Pose, mirrored: boolean): number[] {
  const [x, y, z, w] = pose.rotation;
  const r = [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
  const s = mirrored ? -1 : 1;
  return [s * r[0]!, r[1]!, r[2]!, pose.position[0], s * r[3]!, r[4]!, r[5]!, pose.position[1], s * r[6]!, r[7]!, r[8]!, pose.position[2]];
}
