/**
 * Places on an edge that can be pointed at (measuring: a point anywhere), found from the line segments the viewer draws the edge with: its two ends, its middle along its
 * length, and for a circle or an arc the centre. All of it from the polyline: no question for the kernel.
 */
export type V3 = [number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);

/** The points of each edge in order, from the segments: `positions` has two points (6 numbers) per segment, `owner[s]` the edge of segment s. A break in the line starts the next piece. */
export function polylinesOf(positions: ArrayLike<number>, owner: ArrayLike<number>): Map<number, V3[]> {
  const out = new Map<number, V3[]>();
  const at = (i: number): V3 => [positions[i]!, positions[i + 1]!, positions[i + 2]!];
  for (let s = 0; s < owner.length; s++) {
    const edge = owner[s]!;
    const a = at(6 * s);
    const b = at(6 * s + 3);
    const list = out.get(edge);
    if (!list) out.set(edge, [a, b]);
    else if (len(sub(list[list.length - 1]!, a)) < 1e-9) list.push(b);
    else list.push(a, b);
  }
  return out;
}

/** The place half way along a polyline. */
export function middleOf(points: readonly V3[]): V3 {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += len(sub(points[i]!, points[i - 1]!));
  let want = total / 2;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const l = len(sub(b, a));
    if (want <= l || i === points.length - 1) return add(a, mul(sub(b, a), l > 0 ? Math.min(1, want / l) : 0));
    want -= l;
  }
  return points[0]!;
}

/**
 * The centre of the circle or arc a polyline lies on, or null when it is not one (a straight line, a curve of another kind): the circle through three of its points, which every
 * point of it must be on (to a ten-thousandth of the radius). The line of an arc is drawn with its points on the curve, so the centre is the true one.
 */
export function circleCentre(points: readonly V3[]): { centre: V3; radius: number } | null {
  if (points.length < 4) return null;
  const p0 = points[0]!;
  const p1 = points[Math.floor(points.length / 2)]!;
  const p2 = points[points.length - 1]!;
  // a closed circle ends where it starts: take a point a third round instead
  const third = len(sub(p2, p0)) < 1e-9 ? points[Math.floor(points.length / 3)]! : p2;
  const a = sub(p1, p0);
  const b = sub(third, p0);
  const n = cross(a, b);
  const nn = dot(n, n);
  if (nn < 1e-12) return null;
  const centre = add(p0, mul(cross(sub(mul(b, dot(a, a)), mul(a, dot(b, b))), n), 1 / (2 * nn)));
  const radius = len(sub(p0, centre));
  if (!(radius > 1e-9)) return null;
  for (const p of points) if (Math.abs(len(sub(p, centre)) - radius) > 1e-4 * radius) return null;
  return { centre, radius };
}
