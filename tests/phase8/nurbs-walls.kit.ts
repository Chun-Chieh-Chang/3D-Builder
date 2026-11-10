/**
 * Parts with walls that are B-spline curves carried straight (C1): a plate with a closed outline of clamped cubic B-splines (some rational, some pieces
 * straight lines, maybe a hole) cut into its top or raised on it. Made here from the curves' definitions, independent of the code under test.
 */
import { nurbsAt, nurbsReversed, type Frame, type Kernel, type Region, type ShapeId } from '@3db/kernel';

export type P = [number, number];
export interface Piece { kind: 'nurbs'; poles: P[]; degree: number; knots: number[]; mults: number[]; weights?: number[] }
export type Outline = (Piece | { kind: 'line'; a: P; b: P })[];

export const XY: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
export const at = (z: number): Frame => ({ ...XY, origin: [0, 0, z] });

/** A deterministic generator (mulberry32), so a failure can be run again by its seed. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A clamped cubic through `poles` with evenly spaced inner knots. */
export function cubic(poles: P[], weights?: number[]): Piece {
  const spans = poles.length - 3;
  const knots = Array.from({ length: spans + 1 }, (_, i) => i);
  const mults = knots.map((_, i) => (i === 0 || i === spans ? 4 : 1));
  return { kind: 'nurbs', poles, degree: 3, knots, mults, ...(weights ? { weights } : {}) };
}

/**
 * A closed outline counter-clockwise about `c`: `n` poles round a wavy circle of radius `R`, cut into `k` cubics (each at least 4 poles, ends shared);
 * with `rational`, inner weights from 0.7 to 1.5; with `straight`, one piece a line between its ends.
 */
export function outline(r: () => number, c: P, R: number, n: number, k: number, rational: boolean, straight: boolean): Outline {
  const m = 2 + Math.floor(r() * 4);
  const phase = r() * Math.PI * 2;
  const amp = 0.08 + r() * 0.14;
  const poles: P[] = Array.from({ length: n }, (_, j) => {
    const th = (2 * Math.PI * j) / n;
    const rho = R * (1 + amp * Math.sin(m * th + phase)) * (0.97 + 0.06 * r());
    return [c[0] + rho * Math.cos(th), c[1] + rho * Math.sin(th)];
  });
  const cuts = Array.from({ length: k }, (_, i) => Math.round((i * n) / k));
  const out: Outline = [];
  for (let i = 0; i < k; i++) {
    const from = cuts[i]!;
    const to = i === k - 1 ? n : cuts[i + 1]!;
    const ps = Array.from({ length: to - from + 1 }, (_, j) => poles[(from + j) % n]!);
    if (straight && i === 0) out.push({ kind: 'line', a: ps[0]!, b: ps[ps.length - 1]! });
    else out.push(cubic(ps, rational ? ps.map((_, j) => (j === 0 || j === ps.length - 1 ? 1 : 0.7 + 0.8 * r())) : undefined));
  }
  return out;
}

/** Points along the outline (for checks of its own: simple, inside another). */
export function polygonOf(o: Outline): P[] {
  return o.flatMap((s) => (s.kind === 'line' ? [s.a] : Array.from({ length: 24 * (s.knots.length - 1) }, (_, i) => nurbsAt(s, i / (24 * (s.knots.length - 1))))));
}

/** Whether a closed polygon crosses itself (segments that do not share an end). */
export function crossesItself(p: P[]): boolean {
  const n = p.length;
  const cr = (a: P, b: P, c: P) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const [a, b, c, d] = [p[i]!, p[(i + 1) % n]!, p[j]!, p[(j + 1) % n]!];
      if (cr(a, b, c) * cr(a, b, d) < 0 && cr(c, d, a) * cr(c, d, b) < 0) return true;
    }
  }
  return false;
}

const segsOf = (o: Outline, tag: string) =>
  o.map((s, i) =>
    s.kind === 'line'
      ? { kind: 'line' as const, a: s.a, b: s.b, source: `${tag}${i}` }
      : { kind: 'spline' as const, points: Array.from({ length: 33 }, (_, j) => nurbsAt(s, j / 32)), closed: false, source: `${tag}${i}`, nurbs: { poles: s.poles, degree: s.degree, knots: s.knots, mults: s.mults, ...(s.weights ? { weights: s.weights } : {}) } },
  );

/** The region of `outer` (counter-clockwise) with `hole` (counter-clockwise, run the other way here as a hole). */
export function region(outer: Outline, hole?: Outline): Region {
  const back: Outline | undefined = hole ? [...hole].reverse().map((s) => (s.kind === 'line' ? { kind: 'line', a: s.b, b: s.a } : { ...nurbsReversed(s), kind: 'nurbs' })) : undefined;
  return { outer: segsOf(outer, 'o'), holes: back ? [segsOf(back, 'h')] : [] };
}

/** A w × d × t plate with `reg` cut `depth` into its top (or raised `depth` on it); with `bspline`, the curved walls made B-spline surfaces. */
export function plate(kernel: Kernel, w: number, d: number, t: number, reg: Region, depth: number, raised: boolean, bspline: boolean, own: (id: ShapeId) => ShapeId): ShapeId {
  const p: P[] = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]];
  const box = own(kernel.extrude(XY, [{ outer: p.map((a, i) => ({ kind: 'line', a, b: p[(i + 1) % 4]!, source: `b${i}` })), holes: [] }], [0, 0, t]).shape);
  let tool = own(kernel.extrude(at(raised ? t : t - depth), [reg], [0, 0, raised ? depth : depth + 1]).shape);
  if (bspline) {
    // the walls of the tool as B-spline surfaces, planes left planes (the faces a CAD exporter writes for an extruded spline outline)
    const k = kernel as unknown as { oc: { ShapeCustom: { ConvertToBSpline: (...a: unknown[]) => unknown } }; get: (id: ShapeId) => unknown; put: (s: unknown) => ShapeId };
    tool = own(k.put(k.oc.ShapeCustom.ConvertToBSpline(k.get(tool), true, false, false, false)));
  }
  return own(kernel.boolean(raised ? 'fuse' : 'cut', box, tool).shape);
}
