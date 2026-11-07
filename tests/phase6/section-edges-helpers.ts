/**
 * Reads `Kernel.sectionEdges` output without using the product's own curve code: a Bézier by the Bernstein sum (the product splits by de Casteljau), pieces chained
 * by their ends, and the area by the shoelace formula. Those answers are compared with a truth that does not pass through any of this.
 */
import type { HomogeneousPole, Kernel, SectionEdge } from '@3db/kernel';

export type Pt = [number, number];

const choose = (n: number, k: number) => {
  let v = 1;
  for (let i = 1; i <= k; i++) v = (v * (n - i + 1)) / i;
  return v;
};

/** The point of a rational Bézier at parameter t. */
export function bezierAt(poles: HomogeneousPole[], t: number): Pt {
  const n = poles.length - 1;
  let x = 0;
  let y = 0;
  let w = 0;
  poles.forEach((p, i) => {
    const b = choose(n, i) * (1 - t) ** (n - i) * t ** i;
    x += b * p[0];
    y += b * p[1];
    w += b * p[3];
  });
  return [x / w, y / w];
}

/** The Cartesian control points of a span. */
export const cartesian = (poles: HomogeneousPole[]): Pt[] => poles.map((p) => [p[0] / p[3], p[1] / p[3]]);

const dist = (p: Pt, q: Pt) => Math.hypot(p[0] - q[0], p[1] - q[1]);

/**
 * The points along one piece, from one end to the other; a circle's first and last points coincide. `samples` is per span, and a closed spline can be a single span
 * of high degree: at 512 its polygon came out 2.4e-5 short of the true area (a measured error of this helper, not of the poles), at 2048 about 1.5e-6.
 */
export function polyline(e: SectionEdge, samples = 2048): Pt[] {
  if (e.kind === 'other') throw Error(`curve ${e.curve}`);
  if (e.kind === 'line') return [e.a, e.b];
  if (e.kind === 'bezier') {
    const out: Pt[] = [bezierAt(e.spans[0]!, 0)];
    for (const span of e.spans) for (let i = 1; i <= samples; i++) out.push(bezierAt(span, i / samples));
    return out;
  }
  if (e.kind === 'circle') {
    const out: Pt[] = [];
    for (let i = 0; i <= samples; i++) out.push([e.c[0] + e.r * Math.cos((2 * Math.PI * i) / samples), e.c[1] + e.r * Math.sin((2 * Math.PI * i) / samples)]);
    return out;
  }
  const angle = (p: Pt) => Math.atan2(p[1] - e.c[1], p[0] - e.c[0]);
  const a0 = angle(e.a);
  const turn = (p: Pt) => ((angle(p) - a0) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  const sweep = turn(e.mid) < turn(e.b) ? turn(e.b) : turn(e.b) - 2 * Math.PI;
  const out: Pt[] = [];
  for (let i = 0; i <= samples; i++) out.push([e.c[0] + e.r * Math.cos(a0 + (sweep * i) / samples), e.c[1] + e.r * Math.sin(a0 + (sweep * i) / samples)]);
  return out;
}

/** Chains polylines into closed loops by their ends. Throws when the ends do not meet: a trim gone wrong shows up here. */
export function closedLoops(lines: Pt[][], tol = 1e-5): Pt[][] {
  const left = [...lines];
  const loops: Pt[][] = [];
  while (left.length) {
    const loop = [...left.shift()!];
    while (dist(loop[0]!, loop.at(-1)!) > tol) {
      const at = loop.at(-1)!;
      const i = left.findIndex((l) => dist(l[0]!, at) <= tol || dist(l.at(-1)!, at) <= tol);
      if (i < 0) throw Error(`open chain at (${at[0]}, ${at[1]})`);
      const [next] = left.splice(i, 1);
      loop.push(...(dist(next![0]!, at) <= tol ? next! : [...next!].reverse()).slice(1));
    }
    loops.push(loop);
  }
  return loops;
}

/** Sum of the areas the loops enclose: for sections whose loops do not nest. */
export function enclosedArea(edges: SectionEdge[]): number {
  let total = 0;
  for (const loop of closedLoops(edges.map((e) => polyline(e)))) total += Math.abs(polygonArea(loop));
  return total;
}

/** Whether a closed polygon crosses itself, ignoring neighbouring segments. */
export function selfCrossing(loop: Pt[]): boolean {
  const n = loop.length;
  const side = (a: Pt, b: Pt, c: Pt) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < n; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % n]!;
    const loX = Math.min(a[0], b[0]);
    const hiX = Math.max(a[0], b[0]);
    const loY = Math.min(a[1], b[1]);
    const hiY = Math.max(a[1], b[1]);
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = loop[j]!;
      const d = loop[(j + 1) % n]!;
      if (Math.max(c[0], d[0]) < loX || Math.min(c[0], d[0]) > hiX || Math.max(c[1], d[1]) < loY || Math.min(c[1], d[1]) > hiY) continue;
      if (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) return true;
    }
  }
  return false;
}

/** The area a closed polygon encloses, signed by its direction. */
export function polygonArea(loop: Pt[]): number {
  let twice = 0;
  for (let i = 0; i < loop.length; i++) {
    const q = loop[(i + 1) % loop.length]!;
    twice += loop[i]![0] * q[1] - q[0] * loop[i]![1];
  }
  return twice / 2;
}

/**
 * The curve a closed spline's points make (ADR 0244: Catmull-Rom, wrapping, what the sketch draws), from its formula: the input itself, with no OCCT in it, before any solid, boolean or
 * section. Its area is the truth for a section.
 */
export function fitted(_k: Kernel, points: Pt[], samples: number): Pt[] {
  const n = points.length;
  const at = (i: number) => points[((i % n) + n) % n]!;
  const out: Pt[] = [];
  const steps = Math.ceil(samples / n);
  for (let s = 0; s < n; s++) {
    const [a, b, c, d] = [at(s - 1), at(s), at(s + 1), at(s + 2)];
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      out.push([0, 1].map((x) => 0.5 * (2 * b[x]! + (c[x]! - a[x]!) * t + (2 * a[x]! - 5 * b[x]! + 4 * c[x]! - d[x]!) * t * t + (3 * b[x]! - a[x]! - 3 * c[x]! + d[x]!) * t * t * t)) as Pt);
    }
  }
  return out;
}
