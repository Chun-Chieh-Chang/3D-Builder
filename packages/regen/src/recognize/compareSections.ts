/**
 * Two planar sections compared where the solids they are cut from cannot be (ADR 0243): a spline approximated by biarcs lies within a hundredth of a millimetre of the original, crossing it
 * again and again, and a boolean of two such solids has every reason to fail. In the plane, the area each encloses, the area they do not share and how far the one's boundary comes from the
 * other's need nothing but their boundary pieces, in any order. Pure geometry: no kernel.
 */
import type { SectionEdge } from '@3db/kernel';

type P2 = [number, number];
type Line = [P2, P2];

/** A flattened boundary keeps this close to the curve, well under any tolerance this is asked to check. */
const FLATNESS = 1e-5;
/** Rows of the sweep that measures areas. */
const ROWS = 4000;

function arcLines(a: P2, mid: P2, b: P2, c: P2, r: number): Line[] {
  const angle = (p: P2) => Math.atan2(p[1] - c[1], p[0] - c[0]);
  const a0 = angle(a);
  const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const ccw = norm(angle(mid) - a0) < norm(angle(b) - a0);
  const sweep = ccw ? norm(angle(b) - a0) : -norm(a0 - angle(b));
  const step = 2 * Math.acos(Math.max(0, 1 - FLATNESS / Math.max(r, FLATNESS * 2)));
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / step));
  const at = (k: number): P2 => (k === n ? b : k === 0 ? a : [c[0] + r * Math.cos(a0 + (sweep * k) / n), c[1] + r * Math.sin(a0 + (sweep * k) / n)]);
  return Array.from({ length: n }, (_, k): Line => [at(k), at(k + 1)]);
}

function circleLines(c: P2, r: number): Line[] {
  const n = Math.max(8, Math.ceil(Math.PI / Math.acos(Math.max(0, 1 - FLATNESS / Math.max(r, FLATNESS * 2)))));
  const at = (k: number): P2 => [c[0] + r * Math.cos((2 * Math.PI * k) / n), c[1] + r * Math.sin((2 * Math.PI * k) / n)];
  return Array.from({ length: n }, (_, k): Line => [at(k), at((k + 1) % n)]);
}

/** A point of a rational Bézier span, its poles homogeneous. */
function bezierAt(poles: readonly (readonly number[])[], t: number): P2 {
  const q = poles.map((p) => [p[0]!, p[1]!, p[3]!]);
  for (let n = q.length - 1; n > 0; n--) for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) q[i]![k] = q[i]![k]! * (1 - t) + q[i + 1]![k]! * t;
  return [q[0]![0]! / q[0]![2]!, q[0]![1]! / q[0]![2]!];
}

function bezierLines(poles: readonly (readonly number[])[]): Line[] {
  const out: Line[] = [];
  const go = (t0: number, a: P2, t1: number, b: P2, depth: number) => {
    const tm = (t0 + t1) / 2;
    const m = bezierAt(poles, tm);
    const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
    const off = Math.abs(dx * (m[1] - a[1]) - dy * (m[0] - a[0])) / (Math.hypot(dx, dy) || 1);
    // at least a few levels whatever the middle says: a curve can cross its chord at its middle
    if (depth < 12 && (depth < 4 || off > FLATNESS)) {
      go(t0, a, tm, m, depth + 1);
      go(tm, m, t1, b, depth + 1);
    } else out.push([a, b]);
  };
  go(0, bezierAt(poles, 0), 1, bezierAt(poles, 1), 0);
  return out;
}

/** The boundary as straight pieces; null when a piece of it is a curve this cannot read. */
export function boundaryLines(edges: readonly SectionEdge[]): Line[] | null {
  const out: Line[] = [];
  for (const e of edges) {
    if (e.kind === 'line') out.push([e.a, e.b]);
    else if (e.kind === 'arc') out.push(...arcLines(e.a, e.mid, e.b, e.c, e.r));
    else if (e.kind === 'circle') out.push(...circleLines(e.c, e.r));
    else if (e.kind === 'bezier') for (const span of e.spans) out.push(...bezierLines(span));
    else return null;
  }
  return out;
}

/** Where a row crosses the boundary, left to right: even-odd, so that a hole is outside. */
function crossings(lines: readonly Line[], y: number): number[] {
  const xs: number[] = [];
  for (const [a, b] of lines) if (a[1] <= y !== b[1] <= y) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
  return xs.sort((p, q) => p - q);
}

/** The length of a row inside A, inside B, and inside just one of them. */
function rowLengths(xa: number[], xb: number[]): [number, number, number] {
  const events = [...xa.map((x) => [x, 0] as const), ...xb.map((x) => [x, 1] as const)].sort((p, q) => p[0] - q[0]);
  const inside = [false, false];
  let [la, lb, lx] = [0, 0, 0];
  let last = 0;
  for (const [x, which] of events) {
    const w = x - last;
    if (inside[0]) la += w;
    if (inside[1]) lb += w;
    if (inside[0] !== inside[1]) lx += w;
    inside[which] = !inside[which];
    last = x;
  }
  return [la, lb, lx];
}

function toSegment(p: P2, [a, b]: Line): number {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

/** The farthest any point of one boundary is from the other. Cells keep this from being every point against every piece. */
function farthest(from: readonly Line[], to: readonly Line[], cell: number): number {
  const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  const grid = new Map<string, Line[]>();
  for (const line of to) {
    const n = Math.ceil(Math.hypot(line[1][0] - line[0][0], line[1][1] - line[0][1]) / cell) + 1;
    const seen = new Set<string>();
    for (let i = 0; i <= n; i++) {
      const k = key(line[0][0] + ((line[1][0] - line[0][0]) * i) / n, line[0][1] + ((line[1][1] - line[0][1]) * i) / n);
      if (seen.has(k)) continue;
      seen.add(k);
      const list = grid.get(k);
      if (list) list.push(line);
      else grid.set(k, [line]);
    }
  }
  let worst = 0;
  for (const [a, b] of from) {
    for (const p of [a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as P2]) {
      let best = Infinity;
      const [cx, cy] = [Math.floor(p[0] / cell), Math.floor(p[1] / cell)];
      for (let ring = 1; ring <= 3 && best === Infinity; ring++) {
        for (let i = -ring; i <= ring; i++) for (let j = -ring; j <= ring; j++) for (const line of grid.get(`${cx + i},${cy + j}`) ?? []) best = Math.min(best, toSegment(p, line));
      }
      // nothing near: as far as it really is
      if (best === Infinity) for (const line of to) best = Math.min(best, toSegment(p, line));
      worst = Math.max(worst, best);
    }
  }
  return worst;
}

export interface SectionComparison {
  /** The areas enclosed, even-odd. */
  areaA: number;
  areaB: number;
  /** The area in just one of them. */
  notShared: number;
  /** The length of A's boundary, which is what a distance between the boundaries turns into an area by. */
  perimeter: number;
  /** How far apart the two boundaries get. */
  distance: number;
}

/**
 * Whether two sections are as close as a distance promises. Both conditions are needed: a shell as thin as the distance, hugging the other's boundary, is near it everywhere and shares none
 * of its area. The difference of the areas needs no condition of its own: it is never more than the area not shared.
 */
export function sectionsClose(c: SectionComparison, distance: number): boolean {
  return c.distance <= distance && c.notShared <= distance * c.perimeter;
}

/** The two sections compared; null when a boundary holds a curve this cannot read. */
export function compareSections(a: readonly SectionEdge[], b: readonly SectionEdge[]): SectionComparison | null {
  const [la, lb] = [boundaryLines(a), boundaryLines(b)];
  if (!la || !lb) return null;
  const ys = [...la, ...lb].flatMap((l) => [l[0][1], l[1][1]]);
  const xs = [...la, ...lb].flatMap((l) => [l[0][0], l[1][0]]);
  if (ys.length === 0) return { areaA: 0, areaB: 0, notShared: 0, perimeter: 0, distance: 0 };
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const dy = (y1 - y0) / ROWS;
  let [areaA, areaB, notShared] = [0, 0, 0];
  for (let i = 0; i < ROWS; i++) {
    const y = y0 + (i + 0.5) * dy;
    const [p, q, r] = rowLengths(crossings(la, y), crossings(lb, y));
    areaA += p * dy;
    areaB += q * dy;
    notShared += r * dy;
  }
  const size = Math.max(Math.max(...xs) - Math.min(...xs), y1 - y0);
  const cell = Math.max(size / 200, 1e-6);
  return {
    areaA,
    areaB,
    notShared,
    perimeter: la.reduce((s, l) => s + Math.hypot(l[1][0] - l[0][0], l[1][1] - l[0][1]), 0),
    distance: Math.max(farthest(la, lb, cell), farthest(lb, la, cell)),
  };
}
