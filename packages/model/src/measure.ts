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
  /**
   * A place instead of an element (a point on a face or an edge, a middle, a centre; kind `vertex`, `index` is not used): where it is in the part's own frame, so that it goes with
   * the part when the part is moved in an assembly. It is measured like a vertex.
   */
  point?: Vec3;
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
  /** A circle, an arc, a cylinder or a sphere: where its middle is, the way its axis runs and how big it is (what measuring from centre to centre and the farthest distance need). */
  round: MeasureRound | null;
}

/** The middle of a round element: for a circle or an arc its centre, for a sphere its centre, for a cylinder a point of its axis (and `axis` is the direction of the line). */
export interface MeasureRound {
  type: 'circle' | 'cylinder' | 'sphere';
  centre: Vec3;
  axis: Vec3 | null;
  radius: number;
}

/** The shortest way from one element to the other: the length, and the two points that make it. */
export interface MeasureDistance {
  value: number;
  a: Vec3;
  b: Vec3;
  /** b − a: how far apart the points are along each axis. */
  delta: Vec3;
}

/** What two round elements are from centre to centre, and the farthest two points of them are (null where it is not defined: the axes of a farthest distance have to run alike). */
export interface RoundReport {
  centre: MeasureDistance;
  max: MeasureDistance | null;
}

/** How two elements that point somewhere lie to each other: alike, square, or at an angle. */
export type Relation = 'parallel' | 'perpendicular' | 'angle';

export interface MeasureReport {
  elements: MeasureElement[];
  /** Only for two elements: the shortest distance. */
  distance: MeasureDistance | null;
  /** Only for two elements that point somewhere. */
  relation: Relation | null;
  /** The distance along the axes one after the other: |dx| + |dy| + |dz| (what eDrawings calls the total length); only for two elements. */
  total: number | null;
  /** Only for two round elements. */
  round: RoundReport | null;
  /** Degrees between the two elements' directions, the acute one (0 to 90): null when one of them has no direction or there are not two. */
  angle: number | null;
}

/** The parts of the kernel's face, edge and vertex information that are used: the kernel's own types are assignable to these. */
export interface FaceFacts {
  surface: string;
  area: number;
  center: Vec3;
  normal: Vec3 | null;
  geometry?: { type: string; axis?: Vec3; normal?: Vec3; radius?: number; origin?: Vec3; center?: Vec3 };
}
export interface EdgeFacts {
  curve: string;
  length: number;
  mid: Vec3;
  dir: Vec3 | null;
  geometry?: { type: string; normal?: Vec3; radius?: number; center?: Vec3 };
}
export interface VertexFacts {
  point: Vec3;
}

export function faceElement(f: FaceFacts): MeasureElement {
  const g = f.geometry;
  const direction = f.normal ?? (g && (g.axis ?? g.normal)) ?? null;
  const radius = g && (g.type === 'cylinder' || g.type === 'sphere') ? (g.radius ?? null) : null;
  const round: MeasureRound | null =
    g?.type === 'cylinder' && g.origin && g.axis && radius !== null ? { type: 'cylinder', centre: g.origin, axis: g.axis, radius } : g?.type === 'sphere' && g.center && radius !== null ? { type: 'sphere', centre: g.center, axis: null, radius } : null;
  return { kind: 'face', type: f.surface, point: f.center, area: f.area, length: null, radius, direction, round };
}

export function edgeElement(e: EdgeFacts): MeasureElement {
  const g = e.geometry;
  const direction = e.dir ?? (g?.type === 'circle' ? (g.normal ?? null) : null);
  const radius = g?.type === 'circle' ? (g.radius ?? null) : null;
  const round: MeasureRound | null = g?.type === 'circle' && g.center && radius !== null ? { type: 'circle', centre: g.center, axis: g.normal ?? null, radius } : null;
  return { kind: 'edge', type: e.curve, point: e.mid, area: null, length: e.length, radius, direction, round };
}

export function vertexElement(v: VertexFacts): MeasureElement {
  return { kind: 'vertex', type: 'point', point: v.point, area: null, length: null, radius: null, direction: null, round: null };
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
  const known = angle !== null && Number.isFinite(angle) ? angle : null;
  // the length is the kernel's own, not worked out again from the two points
  const found = distance ? { ...between(distance.pointA, distance.pointB), value: distance.distance } : null;
  return {
    elements,
    distance: found,
    angle: known,
    relation: known === null ? null : known < PARALLEL_DEGREES ? 'parallel' : Math.abs(known - 90) < PARALLEL_DEGREES ? 'perpendicular' : 'angle',
    total: found ? Math.abs(found.delta[0]) + Math.abs(found.delta[1]) + Math.abs(found.delta[2]) : null,
    round: a?.round && b?.round ? roundReport(a.round, b.round) : null,
  };
}

/** How near to 0 or to 90° two directions are for the two elements to be called parallel or square (degrees). */
export const PARALLEL_DEGREES = 1e-4;

type V = Vec3;
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V, b: V, k = 1): V => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: V): V => {
  const l = norm(a);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};

/** The distance between two points, with the points and the differences along the axes. */
export function between(a: Vec3, b: Vec3): MeasureDistance {
  const delta = sub(b, a);
  return { value: norm(delta), a, b, delta };
}

/**
 * The closest points of two lines (each a point and a direction): where they cross or pass nearest; for parallel lines the first line's point and where the second line is
 * nearest to it.
 */
function nearestOnLines(p1: V, d1: V, p2: V, d2: V): { a: V; b: V } {
  const u = unit(d1);
  const v = unit(d2);
  const w = sub(p1, p2);
  const b = dot(u, v);
  const d = dot(u, w);
  const e = dot(v, w);
  const den = 1 - b * b;
  if (den < 1e-12) return { a: p1, b: add(p2, v, dot(sub(p1, p2), v)) };
  const s = (b * e - d) / den;
  const t = (e - b * d) / den;
  return { a: add(p1, u, s), b: add(p2, v, t) };
}

/** The point of a line (a point and a direction) nearest to a point. */
const onLine = (p: V, point: V, dir: V): V => add(point, unit(dir), dot(sub(p, point), unit(dir)));

/**
 * What two round elements are from centre to centre (a circle, an arc or a sphere by its centre, a cylinder by its axis) and, where the axes run alike (or neither has
 * one), the farthest two points of them. For two circles the points are on the circles (the lateral distance of the centres, plus both radii, with the distance along the axis
 * as it is); for cylinders and a cylinder with a circle, across the axes only (their length is not known here); for two spheres along the line of their centres.
 */
export function roundReport(a: MeasureRound, b: MeasureRound): RoundReport {
  const lineA = a.type === 'cylinder';
  const lineB = b.type === 'cylinder';
  let pa = a.centre;
  let pb = b.centre;
  if (lineA && lineB) ({ a: pa, b: pb } = nearestOnLines(a.centre, a.axis!, b.centre, b.axis!));
  else if (lineA) pa = onLine(b.centre, a.centre, a.axis!);
  else if (lineB) pb = onLine(a.centre, b.centre, b.axis!);
  const centre = between(pa, pb);
  // the farthest: the two centres' lateral offset pushed apart by both radii
  const axisA = a.axis ? unit(a.axis) : null;
  const axisB = b.axis ? unit(b.axis) : null;
  const alike = axisA && axisB ? norm(cross(axisA, axisB)) < 1e-9 : !axisA && !axisB;
  if (!alike) return { centre, max: null };
  if (!axisA) {
    // two spheres
    const w = unit(sub(b.centre, a.centre));
    return { centre, max: between(add(a.centre, w, -a.radius), add(b.centre, w, b.radius)) };
  }
  // along the line across the axes from the one middle to the other: out by one radius at each end (circles keep the distance along the axis as it is)
  const v = sub(pb, pa);
  const lateral = sub(v, [axisA[0] * dot(v, axisA), axisA[1] * dot(v, axisA), axisA[2] * dot(v, axisA)]);
  let w = unit(lateral);
  if (norm(w) === 0) w = unit(cross(axisA, Math.abs(axisA[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]));
  return { centre, max: between(add(pa, w, -a.radius), add(pb, w, b.radius)) };
}

/** A point of a part's own frame, put where the assembly has the part (the same motion as `placementRows`). */
export function placePoint(pose: Pose | null, mirrored: boolean, p: Vec3): Vec3 {
  if (!pose && !mirrored) return p;
  const m = placementRows(pose ?? { position: [0, 0, 0], rotation: [0, 0, 0, 1] }, mirrored);
  return [m[0]! * p[0] + m[1]! * p[1] + m[2]! * p[2] + m[3]!, m[4]! * p[0] + m[5]! * p[1] + m[6]! * p[2] + m[7]!, m[8]! * p[0] + m[9]! * p[1] + m[10]! * p[2] + m[11]!];
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
