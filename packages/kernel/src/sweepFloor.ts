import type { Frame, Region, Segment } from './kernel';

/**
 * How little a sweep may hold before it is said to have folded over itself. OCCT calls a profile swept round a very sharp turn "valid" although the solid overlaps
 * itself (6 × 4 along 20 and then back 158°: 240 mm³ where the length of the path says about 738), so the kernel measures the result as it does for an offset surface.
 *
 * Pappus: a profile swept without overlap holds its area times the length its centroid travels. The centroid is `d` from where the path starts, so on a path that turns
 * through `turn` radians in all it travels at least `length − d · turn`; below `FLOOR` of that the solid has been folded over.
 */
const FLOOR = 0.7;
type P2 = [number, number];

const angleOf = (c: P2, p: P2) => Math.atan2(p[1] - c[1], p[0] - c[0]);
const TAU = 2 * Math.PI;
/** The way round an arc, in radians (0, 2π]. */
function sweepAngle(g: Extract<Segment, { kind: 'arc' }>): number {
  const a = angleOf(g.c, g.from);
  const b = angleOf(g.c, g.to);
  const d = g.ccw ? b - a : a - b;
  return ((d % TAU) + TAU) % TAU || TAU;
}

/** The points of a loop of segments, in order round it (a segment stored the other way round is turned). */
export function loopPoints(loop: readonly Segment[]): P2[] {
  const pts: P2[] = [];
  for (const g of loop) {
    let run: P2[];
    if (g.kind === 'line') run = [g.a, g.b];
    else if (g.kind === 'circle') run = Array.from({ length: 64 }, (_, i) => [g.c[0] + g.r * Math.cos((i * TAU) / 64), g.c[1] + g.r * Math.sin((i * TAU) / 64)] as P2);
    else if (g.kind === 'ellipse') {
      const cosA = Math.cos(g.angle);
      const sinA = Math.sin(g.angle);
      run = Array.from({ length: 64 }, (_, i) => {
        const u = (i * TAU) / 64;
        const x = g.rx * Math.cos(u);
        const y = g.ry * Math.sin(u);
        return [g.c[0] + x * cosA - y * sinA, g.c[1] + x * sinA + y * cosA] as P2;
      });
    } else if (g.kind === 'spline') {
      run = g.points;
    } else {
      const a0 = angleOf(g.c, g.from);
      const sweep = sweepAngle(g) * (g.ccw ? 1 : -1);
      run = Array.from({ length: 33 }, (_, i) => [g.c[0] + g.r * Math.cos(a0 + (sweep * i) / 32), g.c[1] + g.r * Math.sin(a0 + (sweep * i) / 32)] as P2);
    }
    const end = pts[pts.length - 1];
    if (end && Math.hypot(run[0]![0] - end[0], run[0]![1] - end[1]) > Math.hypot(run[run.length - 1]![0] - end[0], run[run.length - 1]![1] - end[1])) run.reverse();
    pts.push(...(end ? run.slice(1) : run));
  }
  return pts;
}

/** Signed area and centroid (times the area) of a polygon. */
function polygon(pts: readonly P2[]): { area: number; cx: number; cy: number } {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    const cross = p[0] * q[1] - q[0] * p[1];
    area += cross / 2;
    cx += ((p[0] + q[0]) * cross) / 6;
    cy += ((p[1] + q[1]) * cross) / 6;
  }
  return { area, cx, cy };
}

const lengthOf = (g: Segment): number =>
  g.kind === 'line'
    ? Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1])
    : g.kind === 'arc'
      ? g.r * sweepAngle(g)
      : g.kind === 'circle'
        ? TAU * g.r
        : g.kind === 'ellipse'
          ? Math.PI * (3 * (g.rx + g.ry) - Math.sqrt((3 * g.rx + g.ry) * (g.rx + 3 * g.ry)))
          : g.points.reduce((acc, p, i, arr) => (i === 0 ? 0 : acc + Math.hypot(p[0] - arr[i - 1]![0], p[1] - arr[i - 1]![1])), 0);

/** The direction the path leaves a segment (end = true) or enters it (end = false). */
function tangent(g: Segment, end: boolean): P2 {
  if (g.kind === 'line') return [g.b[0] - g.a[0], g.b[1] - g.a[1]];
  if (g.kind === 'circle' || g.kind === 'ellipse') return [1, 0];
  if (g.kind === 'spline') {
    if (g.points.length < 2) return [1, 0];
    const pA = end ? g.points[g.points.length - 2]! : g.points[0]!;
    const pB = end ? g.points[g.points.length - 1]! : g.points[1]!;
    return [pB[0] - pA[0], pB[1] - pA[1]];
  }
  const p = end ? g.to : g.from;
  const r: P2 = [p[0] - g.c[0], p[1] - g.c[1]];
  return g.ccw ? [-r[1], r[0]] : [r[1], -r[0]];
}

const start3 = (f: Frame, p: P2): [number, number, number] => [f.origin[0] + f.xDir[0] * p[0] + f.yDir[0] * p[1], f.origin[1] + f.xDir[1] * p[0] + f.yDir[1] * p[1], f.origin[2] + f.xDir[2] * p[0] + f.yDir[2] * p[1]];

/** The least volume (mm³) the sweep of these regions along this path (first segment first) may hold, and the profile area it comes from. */
export function sweepVolumeFloor(profile: Frame, regions: readonly Region[], pathFrame: Frame, path: readonly Segment[]): { floor: number; area: number } {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (const r of regions) {
    const outer = polygon(loopPoints(r.outer));
    const sign = Math.sign(outer.area) || 1;
    area += Math.abs(outer.area);
    cx += outer.cx * sign;
    cy += outer.cy * sign;
    for (const h of r.holes) {
      const hole = polygon(loopPoints(h));
      const hs = Math.sign(hole.area) || 1;
      area -= Math.abs(hole.area);
      cx -= hole.cx * hs;
      cy -= hole.cy * hs;
    }
  }
  if (!(area > 1e-12)) return { floor: 0, area: 0 };
  const centroid = start3(profile, [cx / area, cy / area]);
  const first = path[0]!;
  const from = start3(pathFrame, first.kind === 'line' ? first.a : first.kind === 'arc' ? first.from : first.kind === 'spline' ? first.points[0]! : first.c);
  const d = Math.hypot(centroid[0] - from[0], centroid[1] - from[1], centroid[2] - from[2]);
  let length = 0;
  let turn = 0;
  path.forEach((g, i) => {
    length += lengthOf(g);
    if (g.kind === 'arc') turn += sweepAngle(g);
    const next = path[i + 1];
    if (next) {
      const a = tangent(g, true);
      const b = tangent(next, false);
      turn += Math.abs(Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]));
    }
  });
  return { floor: FLOOR * area * Math.max(0, length - d * turn), area };
}
