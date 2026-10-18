import { t } from '@3db/i18n';
import type { Id, SketchFeature } from '@3db/model';
import { Nodes, signedAreaOf, TOL } from './profiles';
import type { Loop2, P2, Region2, Segment2, SolvedSketch } from './types';

/**
 * Thin features (C4.1, C4.3): the outline of a profile thickened instead of its inside filled. A closed outline gives a ring (the
 * outline and its offset), an open one a ribbon (the path, its offset, and a straight end at each end). Offsets are exact, line and arc by
 * line and arc, corners where the offset curves cross (so a sharp corner stays sharp). Each new wall is named for the segment it came from,
 * with a suffix for the side, so the faces a thin feature makes have names of their own.
 */

const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: P2, b: P2): P2 => [a[0] + b[0], a[1] + b[1]];
const scale = (a: P2, s: number): P2 => [a[0] * s, a[1] * s];
const dot = (a: P2, b: P2) => a[0] * b[0] + a[1] * b[1];
const cross = (a: P2, b: P2) => a[0] * b[1] - a[1] * b[0];
const len = (a: P2) => Math.hypot(a[0], a[1]);
const unit = (a: P2): P2 => scale(a, 1 / (len(a) || 1));
const perp = (a: P2): P2 => [-a[1], a[0]];
const TAU = 2 * Math.PI;
const norm = (a: number) => ((a % TAU) + TAU) % TAU;
const angleAt = (c: P2, p: P2) => Math.atan2(p[1] - c[1], p[0] - c[0]);

/** A curve as the offset sees it: a whole line or a whole circle. */
type Whole = { kind: 'line'; a: P2; b: P2 } | { kind: 'circle'; c: P2; r: number };

const startOf = (s: Segment2): P2 =>
  s.kind === 'line'
    ? s.a
    : s.kind === 'arc'
      ? s.from
      : s.kind === 'circle'
        ? [s.c[0] + s.r, s.c[1]]
        : s.kind === 'ellipse'
          ? [s.c[0] + s.rx * Math.cos(s.angle), s.c[1] + s.rx * Math.sin(s.angle)]
          : s.points[0]!;
const endOf = (s: Segment2): P2 =>
  s.kind === 'line'
    ? s.b
    : s.kind === 'arc'
      ? s.to
      : s.kind === 'circle'
        ? [s.c[0] + s.r, s.c[1]]
        : s.kind === 'ellipse'
          ? [s.c[0] + s.rx * Math.cos(s.angle), s.c[1] + s.rx * Math.sin(s.angle)]
          : s.points[s.points.length - 1]!;

/** The direction of travel along a segment at one of its points. */
function heading(s: Segment2, p: P2): P2 {
  if (s.kind === 'line') return unit(sub(s.b, s.a));
  if (s.kind === 'spline') {
    if (s.points.length < 2) return [1, 0];
    const p1 = s.points[0]!;
    const p2 = s.points[s.points.length - 1]!;
    return unit(sub(p2, p1));
  }
  const radial = unit(sub(p, s.c));
  const ccw = s.kind === 'arc' ? s.ccw : true;
  return ccw ? perp(radial) : scale(perp(radial), -1);
}

function crossings(g: Whole, h: Whole): P2[] {
  if (g.kind === 'line' && h.kind === 'line') {
    const [d1, d2] = [sub(g.b, g.a), sub(h.b, h.a)];
    const den = cross(d1, d2);
    if (Math.abs(den) < 1e-12 * len(d1) * len(d2)) return [];
    return [add(g.a, scale(d1, cross(sub(h.a, g.a), d2) / den))];
  }
  if (g.kind === 'line' || h.kind === 'line') {
    const [l, c] = g.kind === 'line' ? [g, h as Extract<Whole, { kind: 'circle' }>] : [h as Extract<Whole, { kind: 'line' }>, g as Extract<Whole, { kind: 'circle' }>];
    const d = unit(sub(l.b, l.a));
    const f = sub(l.a, c.c);
    const b = dot(f, d);
    const disc = b * b - (dot(f, f) - c.r * c.r);
    if (disc <= 1e-12 * c.r * c.r) return [];
    const s = Math.sqrt(disc);
    return [add(l.a, scale(d, -b - s)), add(l.a, scale(d, -b + s))];
  }
  const [a, b] = [g as Extract<Whole, { kind: 'circle' }>, h as Extract<Whole, { kind: 'circle' }>];
  const d = len(sub(a.c, b.c));
  if (d < 1e-9 || d > a.r + b.r - 1e-9 || d < Math.abs(a.r - b.r) + 1e-9) return [];
  const x = (a.r * a.r - b.r * b.r + d * d) / (2 * d);
  const half = Math.sqrt(Math.max(0, a.r * a.r - x * x));
  const u = unit(sub(b.c, a.c));
  const m = add(a.c, scale(u, x));
  return [add(m, scale(perp(u), half)), sub(m, scale(perp(u), half))];
}

/** The curve `s` becomes when moved `d` to its left (negative: to its right), or null when it vanishes. */
function movedWhole(s: Segment2, d: number): Whole | null {
  if (s.kind === 'line') {
    const n = scale(perp(unit(sub(s.b, s.a))), d);
    return { kind: 'line', a: add(s.a, n), b: add(s.b, n) };
  }
  if (s.kind === 'ellipse') {
    const r = (s.rx + s.ry) / 2 - d;
    return r > 1e-9 ? { kind: 'circle', c: s.c, r } : null;
  }
  if (s.kind === 'spline') {
    return null;
  }
  const ccw = s.kind === 'arc' ? s.ccw : true;
  const r = ccw ? s.r - d : s.r + d; // the left of a counter-clockwise curve is towards its center
  return r > 1e-9 ? { kind: 'circle', c: s.c, r } : null;
}

export type OffsetError = 'collapse' | 'noJoin';
export class ThinProblem extends Error {
  constructor(readonly reason: OffsetError) {
    super(t(reason === 'collapse' ? 'thin.collapse' : 'thin.noJoin'));
  }
}

/** Reverses the way a path is walked. */
export function reversePath(path: Segment2[]): Segment2[] {
  return path
    .slice()
    .reverse()
    .map((s): Segment2 => (s.kind === 'line' ? { ...s, a: s.b, b: s.a } : s.kind === 'arc' ? { ...s, from: s.to, to: s.from, ccw: !s.ccw } : s));
}

/**
 * Moves a connected path (or a closed loop) `d` to the left of its direction of travel, every segment keeping its kind and its source, with
 * the corners where the moved curves meet. Throws `ThinProblem` when a segment vanishes or reverses, or two cannot be joined.
 */
export function offsetPath(path: Segment2[], d: number, closed: boolean, tag: string): Segment2[] {
  const n = path.length;
  const whole = path.map((s) => {
    const w = movedWhole(s, d);
    if (!w) throw new ThinProblem('collapse');
    return w;
  });
  /** Where segment i meets the next one (or ends, for an open path). */
  const corner = (i: number): P2 => {
    const s = path[i]!;
    const p = endOf(s);
    const slid = add(p, scale(perp(heading(s, p)), d));
    if (!closed && i === n - 1) return slid;
    const next = path[(i + 1) % n]!;
    const [h1, h2] = [heading(s, p), heading(next, p)];
    if (Math.abs(cross(h1, h2)) < 1e-6 && dot(h1, h2) > 0) return slid; // running on into each other
    const meets = crossings(whole[i]!, whole[(i + 1) % n]!).sort((x, y) => len(sub(x, slid)) - len(sub(y, slid)));
    if (!meets[0]) throw new ThinProblem('noJoin');
    return meets[0];
  };
  const corners = path.map((_, i) => corner(i));
  const starts = path.map((s, i) => (i === 0 && !closed ? add(startOf(s), scale(perp(heading(s, startOf(s))), d)) : corners[(i - 1 + n) % n]!));
  return path.map((s, i): Segment2 => {
    const [a, b] = [starts[i]!, corners[i]!];
    const source = `${s.source}${tag}`;
    if (s.kind === 'line') {
      const was = sub(s.b, s.a);
      const now = sub(b, a);
      if (len(now) < TOL || dot(was, now) <= 0) throw new ThinProblem('collapse');
      return { kind: 'line', a, b, source };
    }
    const w = whole[i] as Extract<Whole, { kind: 'circle' }>;
    const ccw = s.kind === 'arc' ? s.ccw : true;
    const sweep = ccw ? norm(angleAt(w.c, b) - angleAt(w.c, a)) : norm(angleAt(w.c, a) - angleAt(w.c, b));
    if (s.kind === 'arc' && (sweep < 1e-9 || len(sub(a, b)) < TOL)) throw new ThinProblem('collapse');
    return s.kind === 'arc' ? { kind: 'arc', c: w.c, r: w.r, from: a, to: b, ccw, source } : { kind: 'circle', c: w.c, r: w.r, source };
  });
}

/** The loop walked the way round that `ccw` says (circles have no way round). */
function oriented(loop: Loop2, ccw: boolean): Loop2 {
  if (loop.length === 1 && loop[0]!.kind === 'circle') return loop;
  return signedAreaOf(loop) > 0 === ccw ? loop : reversePath(loop);
}

const isCircle = (loop: Loop2): loop is [Extract<Segment2, { kind: 'circle' }>] => loop.length === 1 && loop[0]!.kind === 'circle';

/** A loop moved `t` towards the area it encloses (`inward`) or away from it. */
function shifted(loop: Loop2, ccw: boolean, t: number, inward: boolean, tag: string): Loop2 {
  if (isCircle(loop)) {
    const c = loop[0];
    const r = inward ? c.r - t : c.r + t;
    if (r <= 1e-9) throw new ThinProblem('collapse');
    return [{ kind: 'circle', c: c.c, r, source: `${c.source}${tag}` }];
  }
  const was = Math.abs(signedAreaOf(loop));
  const moved = offsetPath(loop, inward === ccw ? t : -t, true, tag); // inward is to the left of a counter-clockwise loop
  const now = Math.abs(signedAreaOf(moved));
  if (inward ? now >= was : now <= was) throw new ThinProblem('collapse');
  return moved;
}

/** How thick a thin feature is on each side of the outline: `inward` towards what a closed loop encloses (the left of an open path), `outward` the other way. */
export interface Thickness {
  inward: number;
  outward: number;
}

/** A closed loop thickened: the loop moved outward and the loop moved inward, as the outside and the hole of one region. */
export function ringOf(loop: Loop2, ccw: boolean, th: Thickness): Region2 {
  const outer = th.outward > 0 ? shifted(loop, ccw, th.outward, false, '_o') : loop;
  const inner = th.inward > 0 ? shifted(loop, ccw, th.inward, true, '_i') : loop;
  return { outer: oriented(outer, true), holes: [oriented(inner, false)] };
}

/** An open path thickened into a region: its two sides and a straight end at each end. */
export function ribbonOf(path: Segment2[], th: Thickness): Region2 {
  const left = th.inward > 0 ? offsetPath(path, th.inward, false, '_l') : path;
  const right = th.outward > 0 ? offsetPath(path, -th.outward, false, '_r') : path;
  const first = path[0]!;
  const last = path.at(-1)!;
  const [leftEnd, rightEnd] = [endOf(left.at(-1)!), endOf(right.at(-1)!)];
  const [rightStart, leftStart] = [startOf(right[0]!), startOf(left[0]!)];
  const caps = (a: P2, b: P2, source: Id): Segment2[] => (len(sub(a, b)) < TOL ? [] : [{ kind: 'line', a, b, source }]);
  const loop: Loop2 = [...left, ...caps(leftEnd, rightEnd, `${last.source}_e`), ...reversePath(right), ...caps(rightStart, leftStart, `${first.source}_s`)];
  return { outer: oriented(loop, true), holes: [] };
}

/** Closed outlines and open paths of a sketch, each walked in one direction (C4.1: a thin feature takes both). */
export interface Outlines {
  loops: { loop: Loop2; ccw: boolean }[];
  chains: Segment2[][];
  /** What keeps the outlines from being walked (a point where three curves meet). */
  problems: string[];
}

export function findOutlines(sketch: SketchFeature, solved: SolvedSketch): Outlines {
  const nodes = new Nodes();
  const pos = new Map<Id, P2>();
  for (const [id, g] of solved.geometry) if (g.type === 'point') pos.set(id, g.p);
  for (const c of sketch.constraints) if (c.type === 'coincident') nodes.union(c.a, c.b);
  const ids = [...pos.keys()];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (len(sub(pos.get(ids[i]!)!, pos.get(ids[j]!)!)) < TOL) nodes.union(ids[i]!, ids[j]!);

  interface Edge {
    from: Id;
    to: Id;
    make(forward: boolean): Segment2;
  }
  const loops: Outlines['loops'] = [];
  const edges: Edge[] = [];
  for (const e of sketch.entities) {
    const g = solved.geometry.get(e.id);
    if (!g || g.type === 'point' || g.construction) continue;
    if (g.type === 'circle') {
      loops.push({ loop: [{ kind: 'circle', c: g.c, r: g.r, source: e.id }], ccw: true });
    } else if (g.type === 'ellipse') {
      loops.push({ loop: [{ kind: 'ellipse', c: g.c, rx: g.majorRadius, ry: g.minorRadius, angle: g.angle, source: e.id }], ccw: true });
    } else if (g.type === 'spline') {
      if (g.closed) {
        loops.push({ loop: [{ kind: 'spline', points: g.points, closed: true, source: e.id }], ccw: true });
      } else if (g.points.length >= 2 && g.pointIds.length >= 2) {
        edges.push({
          from: nodes.find(g.pointIds[0]!),
          to: nodes.find(g.pointIds[g.pointIds.length - 1]!),
          make: (fwd) => ({
            kind: 'spline',
            points: fwd ? g.points : [...g.points].reverse(),
            closed: false,
            source: e.id,
          }),
        });
      }
    } else if (g.type === 'line') {
      if (len(sub(g.b, g.a)) < TOL) continue;
      edges.push({ from: nodes.find(g.p1), to: nodes.find(g.p2), make: (fwd) => ({ kind: 'line', a: fwd ? g.a : g.b, b: fwd ? g.b : g.a, source: e.id }) });
    } else {
      const s: P2 = [g.c[0] + g.r * Math.cos(g.a0), g.c[1] + g.r * Math.sin(g.a0)];
      const f: P2 = [g.c[0] + g.r * Math.cos(g.a1), g.c[1] + g.r * Math.sin(g.a1)];
      edges.push({ from: nodes.find(g.start), to: nodes.find(g.end), make: (fwd) => ({ kind: 'arc', c: g.c, r: g.r, from: fwd ? s : f, to: fwd ? f : s, ccw: fwd, source: e.id }) });
    }
  }
  const incident = new Map<Id, Edge[]>();
  for (const e of edges) for (const n of [e.from, e.to]) incident.set(n, [...(incident.get(n) ?? []), e]);
  const problems = [...incident].filter(([, l]) => l.length > 2).map(([n, l]) => t('thin.branch', { n: String(l.length), at: n }));
  if (problems.length > 0) return { loops: [], chains: [], problems };

  const used = new Set<Edge>();
  const walk = (first: Edge, from: Id): Segment2[] => {
    const path: Segment2[] = [];
    let edge: Edge | undefined = first;
    let node = from;
    while (edge && !used.has(edge)) {
      used.add(edge);
      const fwd = edge.from === node;
      path.push(edge.make(fwd));
      node = fwd ? edge.to : edge.from;
      edge = incident.get(node)!.find((x) => !used.has(x));
    }
    return path;
  };
  const chains: Segment2[][] = [];
  for (const [node, list] of incident) if (list.length === 1 && !used.has(list[0]!)) chains.push(walk(list[0]!, node));
  for (const e of edges) {
    if (used.has(e)) continue;
    const loop = walk(e, e.from);
    loops.push({ loop, ccw: signedAreaOf(loop) > 0 });
  }
  return { loops, chains, problems: [] };
}

/**
 * The regions a thin feature makes of a sketch: every closed outline a ring, every open path a ribbon. `th` is how thick each is; for a path
 * `inward` is the left of the way it is walked, which for a path in a sketch has no better meaning than "the side the first segment points to the left".
 */
export function thinRegions(sketch: SketchFeature, solved: SolvedSketch, th: Thickness): Region2[] {
  const found = findOutlines(sketch, solved);
  if (found.problems.length > 0) throw new Error(found.problems.join('; '));
  return [...found.loops.map((l) => ringOf(l.loop, l.ccw, th)), ...found.chains.map((c) => ribbonOf(c, th))];
}
