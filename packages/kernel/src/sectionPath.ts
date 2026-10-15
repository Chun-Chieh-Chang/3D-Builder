import type { Vec3 } from './types';

/**
 * The geometry of a stepped or aligned section (D-I5, ADR 0143), worked out before anything is built: no OCCT here.
 *
 * A section's path is a polyline in a plane square to `depth`; the material on one side of it — the viewer's, the side `removal` points to from the first
 * segment — is taken away. `depth` is (removal × first segment's way), so that the side taken away from every segment is (its way × depth).
 */

type P2 = [number, number];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const unit = (a: Vec3): Vec3 => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));

/**
 * The region to the right of an open polyline (in x right, y up), as a closed polygon: the polyline, each end carried on `reach` along its own way, and closed
 * round the right-hand side by an arc (clockwise, in steps of 30° at most) about the middle of the points, at least `reach` out. The polyline must not cross
 * itself. Its last point is not its first: the polygon is closed by joining them.
 */
export function rightOfPolyline(points: readonly P2[], reach: number): P2[] {
  const n = points.length;
  const way = (a: P2, b: P2): P2 => {
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
  };
  const t0 = way(points[0]!, points[1]!);
  const tn = way(points[n - 2]!, points[n - 1]!);
  const start: P2 = [points[0]![0] - reach * t0[0], points[0]![1] - reach * t0[1]];
  const end: P2 = [points[n - 1]![0] + reach * tn[0], points[n - 1]![1] + reach * tn[1]];
  const cx = points.reduce((s, p) => s + p[0], 0) / n;
  const cy = points.reduce((s, p) => s + p[1], 0) / n;
  const r = Math.max(Math.hypot(start[0] - cx, start[1] - cy), Math.hypot(end[0] - cx, end[1] - cy)) + reach;
  const from = Math.atan2(end[1] - cy, end[0] - cx);
  const to = Math.atan2(start[1] - cy, start[0] - cx);
  // clockwise from the end's way round to the start's: the right-hand side of the way the polyline goes
  let span = from - to;
  while (span <= 0) span += 2 * Math.PI;
  while (span > 2 * Math.PI) span -= 2 * Math.PI;
  const steps = Math.max(1, Math.ceil(span / (Math.PI / 6)));
  const arc: P2[] = Array.from({ length: steps + 1 }, (_, i) => {
    const a = from - (span * i) / steps;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
  return [start, ...points.map((p) => [p[0], p[1]] as P2), end, ...arc];
}

/** A plane: a point on it and its normal (of length one). */
export interface PathPlane {
  origin: Vec3;
  normal: Vec3;
}

/** What the kernel builds a stepped or aligned section from. */
export interface SectionPathPlan {
  /** The polyline's plane frame: its first point, the first segment's way, and the way square to it in the plane. */
  origin: Vec3;
  x: Vec3;
  y: Vec3;
  /** Square to the plane of the path, the way the region is drawn out to take the material away. */
  depth: Vec3;
  /** The region to take away, in (x, y) about `origin`. */
  region: P2[];
  /** The planes whose cut faces are hatched: those of the cuts (after an aligned section's turn, the first segment's alone). */
  cuts: PathPlane[];
  /** The planes of the jogs (a stepped section) and of the bend (an aligned one): the change of way, whose lines are not drawn in the section. */
  bends: PathPlane[];
  /** An aligned section: the plane splitting what is behind the second segment (its normal pointing to it) from the rest, and the 3 × 4 rows of the turn. */
  turn?: { split: PathPlane; rows: number[] };
}

/**
 * Plans a stepped or aligned section. `removal` is the normal of the first segment's cutting plane pointing to the side taken away; `reach` is how far the
 * region must reach past the path to take away all of the shape.
 */
export function planSectionPath(path: readonly Vec3[], removal: Vec3, aligned: boolean, reach: number): SectionPathPlan {
  const origin = path[0]!;
  const x = unit(sub(path[1]!, origin));
  const depth = unit(cross(removal, x));
  // the side taken away from the first segment is x × depth = −y: the right of the way the path goes, in (x, y)
  const y = cross(depth, x);
  const flat = path.map((p): P2 => [dot(sub(p, origin), x), dot(sub(p, origin), y)]);
  const region = rightOfPolyline(flat, reach);
  const n = unit(removal);
  const ways = path.slice(1).map((p, i) => unit(sub(p, path[i]!)));
  if (!aligned) {
    // the cuts are segments 0, 2, 4 … (all square to `removal`); the jogs between them are square to the first segment's way
    const cuts = path.flatMap((p, i) => (i % 2 === 0 && i < path.length - 1 ? [{ origin: p, normal: n }] : []));
    const bends = path.flatMap((p, i) => (i % 2 === 1 && i < path.length - 1 ? [{ origin: p, normal: x }] : []));
    return { origin, x, y, depth, region, cuts, bends };
  }
  // aligned: what is behind the second segment is turned about the bend, round `depth`, so that the second segment's way becomes the first's
  const bend = path[1]!;
  const back = scale(ways[0]!, -1);
  const on = ways[1]!;
  const kept0 = scale(n, -1);
  let half = unit([back[0] + on[0], back[1] + on[1], back[2] + on[2]]);
  if (dot(half, kept0) < 0) half = scale(half, -1);
  let splitNormal = unit(cross(depth, half));
  if (dot(splitNormal, on) < 0) splitNormal = scale(splitNormal, -1);
  const angle = Math.atan2(dot(depth, cross(on, ways[0]!)), dot(on, ways[0]!));
  return {
    origin,
    x,
    y,
    depth,
    region,
    cuts: [{ origin, normal: n }],
    bends: [{ origin: bend, normal: x }],
    turn: { split: { origin: bend, normal: splitNormal }, rows: turnRows(bend, depth, angle) },
  };
}

/** The 3 × 4 rows of a turn by `angle` (right-handed) about the line through `at` along `axis` (of length one). */
export function turnRows(at: Vec3, axis: Vec3, angle: number): number[] {
  const [kx, ky, kz] = axis;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const v = 1 - c;
  const m = [
    [c + kx * kx * v, kx * ky * v - kz * s, kx * kz * v + ky * s],
    [ky * kx * v + kz * s, c + ky * ky * v, ky * kz * v - kx * s],
    [kz * kx * v - ky * s, kz * ky * v + kx * s, c + kz * kz * v],
  ];
  return m.flatMap((row, i) => [...row, at[i]! - (row[0]! * at[0] + row[1]! * at[1] + row[2]! * at[2])]);
}
