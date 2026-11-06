/**
 * The boundary pieces of a planar cross-section (`Kernel.sectionEdges`) chained into closed loops, with the pieces that continue one another merged (two halves
 * of a circle become the circle, collinear lines one line), and the loops sorted into the regions they bound. Pure geometry in the plane: no kernel.
 */
import type { SectionEdge } from '@3db/kernel';

export type P2 = [number, number];
/** An arc runs from `a` to `b`, counter-clockwise when `ccw`. */
export type Seg = { kind: 'line'; a: P2; b: P2 } | { kind: 'arc'; c: P2; r: number; a: P2; b: P2; ccw: boolean } | { kind: 'circle'; c: P2; r: number };

export interface Loop {
  segs: Seg[];
  /** Signed area (counter-clockwise positive), arcs counted exactly. */
  area: number;
  /** How many other loops contain it: even is the outside of material, odd the inside of a hole. */
  depth: number;
}

/** A section had a curve that is not a line, arc or circle (a loop here holds nothing else), or its pieces do not close. */
export class LoopError extends Error {
  constructor(
    message: string,
    readonly curve?: string,
  ) {
    super(message);
  }
}

const near = (p: P2, q: P2, tol: number) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= tol;
const TAU = 2 * Math.PI;
const angleOf = (c: P2, p: P2) => Math.atan2(p[1] - c[1], p[0] - c[0]);

/** How far round an arc runs, from `a` to `b` the way it goes (0, 2π]. */
export function sweep(s: Extract<Seg, { kind: 'arc' }>): number {
  let d = s.ccw ? angleOf(s.c, s.b) - angleOf(s.c, s.a) : angleOf(s.c, s.a) - angleOf(s.c, s.b);
  while (d <= 1e-12) d += TAU;
  while (d > TAU) d -= TAU;
  return d;
}

const reversed = (s: Seg): Seg => (s.kind === 'line' ? { kind: 'line', a: s.b, b: s.a } : s.kind === 'arc' ? { ...s, a: s.b, b: s.a, ccw: !s.ccw } : s);
const start = (s: Exclude<Seg, { kind: 'circle' }>) => s.a;
const end = (s: Exclude<Seg, { kind: 'circle' }>) => s.b;

function segArea(s: Seg): number {
  if (s.kind === 'circle') return Math.PI * s.r * s.r;
  const chord = (s.a[0] * s.b[1] - s.b[0] * s.a[1]) / 2;
  if (s.kind === 'line') return chord;
  const phi = sweep(s);
  return chord + ((s.ccw ? 1 : -1) * s.r * s.r * (phi - Math.sin(phi))) / 2;
}

/** Points along a loop, for containment tests. */
function polygon(segs: Seg[]): P2[] {
  const out: P2[] = [];
  for (const s of segs) {
    if (s.kind === 'line') out.push(s.a);
    else if (s.kind === 'circle') for (let k = 0; k < 32; k++) out.push([s.c[0] + s.r * Math.cos((TAU * k) / 32), s.c[1] + s.r * Math.sin((TAU * k) / 32)]);
    else {
      const a0 = angleOf(s.c, s.a);
      const phi = sweep(s) * (s.ccw ? 1 : -1);
      for (let k = 0; k < 16; k++) out.push([s.c[0] + s.r * Math.cos(a0 + (phi * k) / 16), s.c[1] + s.r * Math.sin(a0 + (phi * k) / 16)]);
    }
  }
  return out;
}

function inside(p: P2, poly: P2[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** A point of the loop that is not a corner (the middle of its first piece). */
function probe(s: Seg): P2 {
  if (s.kind === 'circle') return [s.c[0] + s.r, s.c[1]];
  if (s.kind === 'line') return [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2];
  const m = angleOf(s.c, s.a) + (sweep(s) / 2) * (s.ccw ? 1 : -1);
  return [s.c[0] + s.r * Math.cos(m), s.c[1] + s.r * Math.sin(m)];
}

/** Merges each piece with the next where it simply continues it (collinear lines; arcs of one circle the same way), round the loop. */
function merge(segs: Seg[], tol: number): Seg[] {
  const out = [...segs];
  let changed = true;
  while (changed && out.length > 1) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 1; i++) {
      const s = out[i]!;
      const n = out[(i + 1) % out.length]!;
      let joined: Seg | null = null;
      if (s.kind === 'line' && n.kind === 'line') {
        const u: P2 = [s.b[0] - s.a[0], s.b[1] - s.a[1]];
        const v: P2 = [n.b[0] - n.a[0], n.b[1] - n.a[1]];
        const lu = Math.hypot(...u);
        const lv = Math.hypot(...v);
        if (Math.abs(u[0] * v[1] - u[1] * v[0]) <= tol * Math.max(lu, lv) && u[0] * v[0] + u[1] * v[1] > 0) joined = { kind: 'line', a: s.a, b: n.b };
      } else if (s.kind === 'arc' && n.kind === 'arc' && s.ccw === n.ccw && near(s.c, n.c, tol) && Math.abs(s.r - n.r) <= tol) {
        joined = near(s.a, n.b, tol) && out.length === 2 ? { kind: 'circle', c: s.c, r: s.r } : { ...s, b: n.b };
      }
      if (joined) {
        const j = (i + 1) % out.length;
        out[i] = joined;
        out.splice(j, 1);
        changed = true;
        break;
      }
    }
  }
  if (out.length === 1 && out[0]!.kind === 'arc' && near(out[0]!.a, out[0]!.b, tol)) return [{ kind: 'circle', c: out[0]!.c, r: out[0]!.r }];
  return out;
}

/** The loops of a section, merged, each with its area and how deep it is nested. Throws `LoopError` for a curve that is not a line or a circle, or pieces that do not close. */
export function chainLoops(edges: SectionEdge[], tol = 1e-6): Loop[] {
  const open: Exclude<Seg, { kind: 'circle' }>[] = [];
  const loops: Seg[][] = [];
  for (const e of edges) {
    if (e.kind === 'other' || e.kind === 'bezier') throw new LoopError(`curve ${e.curve}`, e.curve);
    if (e.kind === 'circle') loops.push([{ kind: 'circle', c: e.c, r: e.r }]);
    else if (e.kind === 'line') {
      if (!near(e.a, e.b, tol)) open.push({ kind: 'line', a: e.a, b: e.b });
    } else {
      const ccw = (e.mid[0] - e.a[0]) * (e.b[1] - e.mid[1]) - (e.mid[1] - e.a[1]) * (e.b[0] - e.mid[0]) > 0;
      open.push({ kind: 'arc', c: e.c, r: e.r, a: e.a, b: e.b, ccw });
    }
  }
  const used = new Array<boolean>(open.length).fill(false);
  for (let i = 0; i < open.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const chain: Seg[] = [open[i]!];
    const first = start(open[i]!);
    let at = end(open[i]!);
    while (!near(at, first, tol)) {
      let found = -1;
      let flip = false;
      for (let j = 0; j < open.length; j++) {
        if (used[j]) continue;
        if (near(start(open[j]!), at, tol)) {
          found = j;
          break;
        }
        if (near(end(open[j]!), at, tol)) {
          found = j;
          flip = true;
          break;
        }
      }
      if (found < 0) throw new LoopError('open');
      used[found] = true;
      const s = flip ? (reversed(open[found]!) as Exclude<Seg, { kind: 'circle' }>) : open[found]!;
      chain.push(s);
      at = end(s);
    }
    loops.push(chain);
  }
  const merged = loops.map((l) => merge(l, tol));
  const polys = merged.map(polygon);
  return merged.map((segs, i) => ({
    segs,
    area: segs.reduce((a, s) => a + segArea(s), 0),
    depth: polys.filter((poly, j) => j !== i && inside(probe(segs[0]!), poly)).length,
  }));
}
