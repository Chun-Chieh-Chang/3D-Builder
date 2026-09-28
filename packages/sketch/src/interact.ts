/**
 * Interaction geometry for sketching (C1.25, C1.26, C1.28, A5.1 in 2D): hit testing, snapping,
 * inference, smart dimensions, applicable relations and dimension layout. Pure TypeScript with no
 * solver, so the UI thread can use it; everything works on solved (derived) geometry.
 */
import { SKETCH_ORIGIN, constraintRefs, type DimensionConstraint, type Id, type SketchConstraint } from '@3db/model';
import type { P2, SolvedGeometry } from './types';

export type Geometry = ReadonlyMap<Id, SolvedGeometry>;

// ---------------------------------------------------------------- 2D math

export const add = (a: P2, b: P2): P2 => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
export const scale = (a: P2, s: number): P2 => [a[0] * s, a[1] * s];
export const dot = (a: P2, b: P2) => a[0] * b[0] + a[1] * b[1];
export const cross = (a: P2, b: P2) => a[0] * b[1] - a[1] * b[0];
export const len = (a: P2) => Math.hypot(a[0], a[1]);
export const dist = (a: P2, b: P2) => len(sub(a, b));
export const mid = (a: P2, b: P2): P2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
export const unit = (a: P2): P2 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};
/** Rotates 90° counter-clockwise. */
export const perp = (a: P2): P2 => [-a[1], a[0]];
export const polar = (c: P2, r: number, angle: number): P2 => [c[0] + r * Math.cos(angle), c[1] + r * Math.sin(angle)];

const TAU = Math.PI * 2;
const norm = (a: number) => ((a % TAU) + TAU) % TAU;

/** Whether `angle` lies on the counter-clockwise sweep from a0 to a1. */
export function onSweep(a0: number, a1: number, angle: number): boolean {
  return norm(angle - a0) <= norm(a1 - a0) + 1e-12;
}

export function closestOnSegment(p: P2, a: P2, b: P2): P2 {
  const d = sub(b, a);
  const l2 = dot(d, d);
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), d) / l2));
  return add(a, scale(d, t));
}

export function pointOf(geometry: Geometry, id: Id): P2 | undefined {
  if (id === SKETCH_ORIGIN) return [0, 0];
  const g = geometry.get(id);
  return g?.type === 'point' ? g.p : undefined;
}

/** Closest point on a curve (null for points). */
export function closestOn(g: SolvedGeometry, p: P2): P2 | null {
  switch (g.type) {
    case 'point':
      return null;
    case 'line':
      return closestOnSegment(p, g.a, g.b);
    case 'circle':
      return polar(g.c, g.r, Math.atan2(p[1] - g.c[1], p[0] - g.c[0]));
    case 'arc': {
      const angle = Math.atan2(p[1] - g.c[1], p[0] - g.c[0]);
      if (onSweep(g.a0, g.a1, angle)) return polar(g.c, g.r, angle);
      const s = polar(g.c, g.r, g.a0);
      const e = polar(g.c, g.r, g.a1);
      return dist(p, s) < dist(p, e) ? s : e;
    }
  }
}

/** Polyline for drawing a curve; `px` is the size of one screen pixel in sketch units. */
export function sample(g: SolvedGeometry, px: number): P2[] {
  switch (g.type) {
    case 'point':
      return [g.p];
    case 'line':
      return [g.a, g.b];
    case 'circle':
    case 'arc': {
      const sweep = g.type === 'circle' ? TAU : norm(g.a1 - g.a0) || TAU;
      const a0 = g.type === 'circle' ? 0 : g.a0;
      // chord error ≈ r(1 − cos(θ/2)) kept below ~0.3 px
      const step = Math.max(0.02, Math.min(0.5, 2 * Math.acos(Math.max(-1, 1 - (0.3 * px) / Math.max(g.r, 1e-9)))));
      const n = Math.max(8, Math.ceil(sweep / step));
      return Array.from({ length: n + 1 }, (_, i) => polar(g.c, g.r, a0 + (sweep * i) / n));
    }
  }
}

// ---------------------------------------------------------------- hit testing (A5.1)

export type HitKind = 'origin' | SolvedGeometry['type'];

export interface Hit {
  id: Id;
  kind: HitKind;
  /** The closest point on the hit element. */
  q: P2;
  d: number;
}

/** What is under the cursor within `tol`: points (and the origin) win over curves, like SolidWorks. */
export function hitTest(geometry: Geometry, p: P2, tol: number, exclude: ReadonlySet<Id> = new Set()): Hit | null {
  let point: Hit | null = null;
  let curve: Hit | null = null;
  const consider = (h: Hit) => {
    if (h.d > tol) return;
    if (h.kind === 'point' || h.kind === 'origin') {
      if (!point || h.d < point.d) point = h;
    } else if (!curve || h.d < curve.d) curve = h;
  };
  for (const [id, g] of geometry) {
    if (exclude.has(id)) continue;
    if (g.type === 'point') consider({ id, kind: 'point', q: g.p, d: dist(p, g.p) });
    else {
      const q = closestOn(g, p)!;
      consider({ id, kind: g.type, q, d: dist(p, q) });
    }
  }
  // Last, so a sketch point lying on the origin wins the tie: merging with it beats a new relation.
  if (!exclude.has(SKETCH_ORIGIN)) consider({ id: SKETCH_ORIGIN, kind: 'origin', q: [0, 0], d: len(p) });
  return point ?? curve;
}

/** Entities whose drawing lies completely inside a box (window selection, D5.1). */
export function inBox(geometry: Geometry, lo: P2, hi: P2): Id[] {
  const inside = (p: P2) => p[0] >= lo[0] && p[0] <= hi[0] && p[1] >= lo[1] && p[1] <= hi[1];
  const out: Id[] = [];
  for (const [id, g] of geometry) {
    const pts = g.type === 'point' ? [g.p] : g.type === 'line' ? [g.a, g.b] : sample(g, (hi[0] - lo[0]) / 200);
    if (pts.every(inside)) out.push(id);
  }
  return out;
}

// ---------------------------------------------------------------- snapping and inference (C1.25, D5.3)

export type Snap =
  /** An existing sketch point or the origin: the new point merges with it. */
  | { kind: 'point'; id: Id; p: P2 }
  | { kind: 'midpoint'; line: Id; p: P2 }
  /** On a line, circle or arc: the new point gets a coincident (point-on-curve) relation. */
  | { kind: 'curve'; id: Id; p: P2 }
  | { kind: 'free'; p: P2 };

/** SolidWorks snap priority: end/center points, then midpoints, then anywhere on a curve. */
export function snap(geometry: Geometry, p: P2, tol: number, exclude: ReadonlySet<Id> = new Set()): Snap {
  const hit = hitTest(geometry, p, tol, exclude);
  if (hit && (hit.kind === 'point' || hit.kind === 'origin')) return { kind: 'point', id: hit.id, p: hit.q };
  let best: { line: Id; p: P2; d: number } | null = null;
  for (const [id, g] of geometry) {
    if (g.type !== 'line' || exclude.has(id)) continue;
    const m = mid(g.a, g.b);
    const d = dist(p, m);
    if (d <= tol && (!best || d < best.d)) best = { line: id, p: m, d };
  }
  if (best) return { kind: 'midpoint', line: best.line, p: best.p };
  if (hit) return { kind: 'curve', id: hit.id, p: hit.q };
  return { kind: 'free', p };
}

export type Direction = 'horizontal' | 'vertical';

/**
 * Horizontal/vertical inference for a line from `a` toward `b` (C1.25): within `angleTol` the end
 * snaps onto the exact direction and the relation is suggested.
 */
export function inferDirection(a: P2, b: P2, angleTol = (3 * Math.PI) / 180): { b: P2; direction: Direction | null } {
  const d = sub(b, a);
  if (len(d) === 0) return { b, direction: null };
  const t = Math.tan(angleTol);
  if (Math.abs(d[1]) <= t * Math.abs(d[0])) return { b: [b[0], a[1]], direction: 'horizontal' };
  if (Math.abs(d[0]) <= t * Math.abs(d[1])) return { b: [a[0], b[1]], direction: 'vertical' };
  return { b, direction: null };
}

// ---------------------------------------------------------------- arcs from picks

/** Circle through three points, or null when they are (nearly) collinear. */
export function circleThrough(p1: P2, p2: P2, p3: P2): { c: P2; r: number } | null {
  const d = 2 * (p1[0] * (p2[1] - p3[1]) + p2[0] * (p3[1] - p1[1]) + p3[0] * (p1[1] - p2[1]));
  const scaleRef = Math.max(dist(p1, p2), dist(p2, p3), dist(p1, p3)) ** 2;
  if (Math.abs(d) < 1e-9 * Math.max(scaleRef, 1e-12)) return null;
  const s1 = dot(p1, p1);
  const s2 = dot(p2, p2);
  const s3 = dot(p3, p3);
  const c: P2 = [(s1 * (p2[1] - p3[1]) + s2 * (p3[1] - p1[1]) + s3 * (p1[1] - p2[1])) / d, (s1 * (p3[0] - p2[0]) + s2 * (p1[0] - p3[0]) + s3 * (p2[0] - p1[0])) / d];
  return { c, r: dist(c, p1) };
}

/** Center of the arc that leaves `start` along `tangent` and ends at `end` (tangent arc). */
export function tangentArcCenter(start: P2, tangent: P2, end: P2): P2 | null {
  const n = perp(unit(tangent));
  const chord = sub(end, start);
  const denom = 2 * dot(n, chord);
  if (Math.abs(denom) < 1e-12) return null; // end lies on the tangent line
  return add(start, scale(n, dot(chord, chord) / denom));
}

// ---------------------------------------------------------------- measuring and smart dimensions (C1.28)

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A dimension without id and value: what to measure. */
export type DimensionBody = DistributiveOmit<DimensionConstraint, 'id' | 'value' | 'label' | 'driving'>;

/** A relation without id. */
export type RelationBody = DistributiveOmit<Exclude<SketchConstraint, DimensionConstraint>, 'id'>;

export interface DimensionProposal {
  body: DimensionBody;
  /** Current value in millimetres or degrees; becomes the initial dimension value. */
  value: number;
  unit: 'mm' | 'deg';
}

const kindOf = (geometry: Geometry, id: Id): HitKind | undefined => (id === SKETCH_ORIGIN ? 'origin' : geometry.get(id)?.type);

/** Point used to measure an entity: the point itself, or the center of a circle/arc. */
function anchorOf(geometry: Geometry, id: Id): P2 | undefined {
  const g = geometry.get(id);
  if (g?.type === 'circle' || g?.type === 'arc') return g.c;
  return pointOf(geometry, id);
}

/** Signed angle from line a to line b (directions p1→p2), as the solver measures it. */
type SolvedLine = Extract<SolvedGeometry, { type: 'line' }>;
type AngleFlip = 'a' | 'b' | 'both' | undefined;

/** Where two (non-parallel) lines meet, extended as needed. */
function intersection(ga: SolvedLine, gb: SolvedLine): P2 {
  const da = sub(ga.b, ga.a);
  const db = sub(gb.b, gb.a);
  const denom = cross(da, db);
  return Math.abs(denom) < 1e-12 ? ga.a : add(ga.a, scale(da, cross(sub(gb.a, ga.a), db) / denom));
}

/** The rays an angle dimension measures between: along the lines as drawn, reversed where `flip` says. */
export function angleRays(ga: SolvedLine, gb: SolvedLine, flip: AngleFlip): { vertex: P2; ra: P2; rb: P2 } {
  const da = sub(ga.b, ga.a);
  const db = sub(gb.b, gb.a);
  return {
    vertex: intersection(ga, gb),
    ra: flip === 'a' || flip === 'both' ? scale(da, -1) : da,
    rb: flip === 'b' || flip === 'both' ? scale(db, -1) : db,
  };
}

/** Counter-clockwise angle from ray a to ray b, in (-π, π]. */
const rayAngle = (ra: P2, rb: P2) => Math.atan2(cross(ra, rb), dot(ra, rb));

/** Horizontal, vertical or aligned, from where the dimension is placed relative to two points (SW behaviour). */
function placementKind(a: P2, b: P2, place: P2): 'x' | 'y' | 'aligned' {
  const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
  const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  const inX = place[0] >= x0 && place[0] <= x1;
  const inY = place[1] >= y0 && place[1] <= y1;
  if (inX && !inY) return 'x';
  if (inY && !inX) return 'y';
  return 'aligned';
}

/**
 * Smart dimension (C1.28): what to dimension from the picked entities and the placement point.
 * Returns null for combinations SolidWorks would not dimension either.
 */
export function smartDimension(geometry: Geometry, picks: Id[], place: P2): DimensionProposal | null {
  const [a, b] = picks;
  if (a === undefined || picks.length > 2) return null;
  const ka = kindOf(geometry, a);
  if (b === undefined) {
    const g = geometry.get(a);
    if (g?.type === 'circle') return { body: { type: 'diameter', circle: a }, value: 2 * g.r, unit: 'mm' };
    if (g?.type === 'arc') return { body: { type: 'radius', circle: a }, value: g.r, unit: 'mm' };
    if (g?.type === 'line') {
      const k = placementKind(g.a, g.b, place);
      const dx = Math.abs(g.b[0] - g.a[0]);
      const dy = Math.abs(g.b[1] - g.a[1]);
      const slanted = dx > 1e-9 && dy > 1e-9;
      if (slanted && k === 'x') return { body: { type: 'distanceX', a: g.p1, b: g.p2 }, value: dx, unit: 'mm' };
      if (slanted && k === 'y') return { body: { type: 'distanceY', a: g.p1, b: g.p2 }, value: dy, unit: 'mm' };
      return { body: { type: 'distance', a }, value: dist(g.a, g.b), unit: 'mm' };
    }
    return null;
  }
  if (a === b) return null;
  const kb = kindOf(geometry, b);
  const ga = geometry.get(a);
  const gb = geometry.get(b);
  if (ga?.type === 'line' && gb?.type === 'line') {
    const da = unit(sub(ga.b, ga.a));
    const db = unit(sub(gb.b, gb.a));
    if (Math.abs(cross(da, db)) < 1e-6) {
      // parallel lines: their distance, measured like the solver does (from a's first point to b)
      return { body: { type: 'distance', a, b }, value: Math.abs(cross(db, sub(ga.a, gb.a))), unit: 'mm' };
    }
    // Like SolidWorks, the angle of the sector the dimension is placed in: the placement, seen from the
    // intersection, is α·da + β·db; the signs of α and β pick the rays that bound that sector.
    const q = sub(place, intersection(ga, gb));
    const den = cross(da, db);
    const sa = cross(q, db) / den < 0 ? -1 : 1;
    const sb = cross(da, q) / den < 0 ? -1 : 1;
    const angle = rayAngle(scale(da, sa), scale(db, sb));
    // Stored so that b's ray is counter-clockwise from a's, the value then being positive.
    const [first, second, s1, s2] = angle >= 0 ? [a, b, sa, sb] : [b, a, sb, sa];
    const flip: AngleFlip = s1 < 0 && s2 < 0 ? 'both' : s1 < 0 ? 'a' : s2 < 0 ? 'b' : undefined;
    return { body: { type: 'angle', a: first, b: second, ...(flip ? { flip } : {}) }, value: (Math.abs(angle) * 180) / Math.PI, unit: 'deg' };
  }
  if (ga?.type === 'line' || gb?.type === 'line') {
    const [lineId, otherId] = ga?.type === 'line' ? [a, b] : [b, a];
    const l = geometry.get(lineId) as Extract<SolvedGeometry, { type: 'line' }>;
    const p = anchorOf(geometry, otherId);
    if (!p) return null;
    const d = Math.abs(cross(unit(sub(l.b, l.a)), sub(p, l.a)));
    return { body: { type: 'distance', a: otherId, b: lineId }, value: d, unit: 'mm' };
  }
  const pa = anchorOf(geometry, a);
  const pb = anchorOf(geometry, b);
  if (!pa || !pb || !ka || !kb) return null;
  const k = placementKind(pa, pb, place);
  if (k === 'x') return { body: { type: 'distanceX', a, b }, value: Math.abs(pb[0] - pa[0]), unit: 'mm' };
  if (k === 'y') return { body: { type: 'distanceY', a, b }, value: Math.abs(pb[1] - pa[1]), unit: 'mm' };
  return { body: { type: 'distance', a, b }, value: dist(pa, pb), unit: 'mm' };
}

// ---------------------------------------------------------------- relations (C1.26, C1.27)

/** Relations SolidWorks offers in 「加入限制條件」 for the current selection. */
export function applicableRelations(geometry: Geometry, selection: Id[]): RelationBody[] {
  const items = selection.map((id) => ({ id, kind: kindOf(geometry, id) }));
  if (items.some((i) => !i.kind)) return [];
  const isPoint = (k: HitKind | undefined) => k === 'point' || k === 'origin';
  const isRadial = (k: HitKind | undefined) => k === 'circle' || k === 'arc';
  const byKind = (pred: (k: HitKind | undefined) => boolean) => items.filter((i) => pred(i.kind)).map((i) => i.id);
  const lines = byKind((k) => k === 'line');
  const points = byKind(isPoint);
  const radials = byKind(isRadial);
  const n = items.length;

  if (n === 1 && lines.length === 1) return [{ type: 'horizontal', a: lines[0]! }, { type: 'vertical', a: lines[0]! }];
  if (n === 1 && points.length === 1 && points[0] !== SKETCH_ORIGIN) return [{ type: 'fix', point: points[0]! }];
  if (n !== 2 && n !== 3) return [];
  if (n === 3) {
    return points.length === 2 && lines.length === 1 ? [{ type: 'symmetric', a: points[0]!, b: points[1]!, axis: lines[0]! }] : [];
  }
  const [a, b] = selection as [Id, Id];
  if (lines.length === 2) {
    return [
      { type: 'collinear', a, b },
      { type: 'parallel', a, b },
      { type: 'perpendicular', a, b },
      { type: 'equal', a, b },
    ];
  }
  if (points.length === 2) {
    return [
      { type: 'coincident', a, b },
      { type: 'horizontal', a, b },
      { type: 'vertical', a, b },
    ];
  }
  if (points.length === 1 && lines.length === 1) {
    return [
      { type: 'pointOnCurve', point: points[0]!, curve: lines[0]! },
      { type: 'midpoint', point: points[0]!, line: lines[0]! },
    ];
  }
  if (points.length === 1 && radials.length === 1) return [{ type: 'pointOnCurve', point: points[0]!, curve: radials[0]! }];
  if (lines.length === 1 && radials.length === 1) return [{ type: 'tangent', a: lines[0]!, b: radials[0]! }];
  if (radials.length === 2) {
    return [
      { type: 'concentric', a, b },
      { type: 'equal', a, b },
      { type: 'tangent', a, b },
    ];
  }
  return [];
}

/** Relations and dimensions that refer to any of the given ids (the 「現有限制條件」 list). */
export function constraintsOf<C extends SketchConstraint>(constraints: readonly C[], ids: Iterable<Id>): C[] {
  const set = new Set(ids);
  return constraints.filter((c) => constraintRefs(c).some((r) => set.has(r)));
}

/** Same relation type between the same entities (so the UI does not offer a duplicate). */
export function sameRelation(a: RelationBody | SketchConstraint, b: RelationBody | SketchConstraint): boolean {
  if (a.type !== b.type) return false;
  const ra = constraintRefs(a as SketchConstraint).slice().sort();
  const rb = constraintRefs(b as SketchConstraint).slice().sort();
  return ra.length === rb.length && ra.every((r, i) => r === rb[i]);
}

// ---------------------------------------------------------------- dimension layout (for display)

export interface DimensionLayout {
  /** Dimension line, extension lines and arrowheads as segments. */
  segments: [P2, P2][];
  text: P2;
}

/**
 * Automatic placement of a dimension's graphics, offset away from the sketch's center so it sits
 * outside the geometry like a SolidWorks dimension. `px` = one screen pixel in sketch units.
 */
export function layoutDimension(c: SketchConstraint, geometry: Geometry, px: number, center: P2): DimensionLayout | null {
  const off = 28 * px;
  const arrow = 7 * px;
  const arrowhead = (tip: P2, toward: P2): [P2, P2][] => {
    const d = unit(sub(toward, tip));
    const n = perp(d);
    const back = add(tip, scale(d, arrow));
    return [
      [tip, add(back, scale(n, arrow * 0.35))],
      [tip, add(back, scale(n, -arrow * 0.35))],
    ];
  };
  /** Dimension line parallel to a→b, pushed out along `n`, with extension lines and arrows. */
  const linear = (a: P2, b: P2, n: P2): DimensionLayout => {
    const s = add(a, scale(n, off));
    const e = add(b, scale(n, off));
    return {
      segments: [[a, add(s, scale(n, arrow * 0.6))], [b, add(e, scale(n, arrow * 0.6))], [s, e], ...arrowhead(s, e), ...arrowhead(e, s)],
      text: add(mid(s, e), scale(n, 10 * px)),
    };
  };
  const outward = (a: P2, b: P2): P2 => {
    let n = perp(unit(sub(b, a)));
    if (dot(n, sub(center, mid(a, b))) > 0) n = scale(n, -1);
    return n;
  };

  switch (c.type) {
    case 'distance': {
      if (c.b === undefined) {
        const l = geometry.get(c.a);
        return l?.type === 'line' ? linear(l.a, l.b, outward(l.a, l.b)) : null;
      }
      const ga = geometry.get(c.a);
      const gb = geometry.get(c.b);
      if (ga?.type === 'line' || gb?.type === 'line') {
        const [lineId, otherId] = ga?.type === 'line' ? [c.a, c.b] : [c.b, c.a];
        const l = geometry.get(lineId) as Extract<SolvedGeometry, { type: 'line' }>;
        const other = geometry.get(otherId);
        const p = other?.type === 'line' ? other.a : anchorOf(geometry, otherId);
        if (!p) return null;
        const foot = add(l.a, scale(unit(sub(l.b, l.a)), dot(sub(p, l.a), unit(sub(l.b, l.a)))));
        return { segments: [[p, foot], ...arrowhead(p, foot), ...arrowhead(foot, p)], text: add(mid(p, foot), scale(perp(unit(sub(foot, p))), 10 * px)) };
      }
      const pa = anchorOf(geometry, c.a);
      const pb = anchorOf(geometry, c.b);
      return pa && pb ? linear(pa, pb, outward(pa, pb)) : null;
    }
    case 'distanceX':
    case 'distanceY': {
      const pa = anchorOf(geometry, c.a);
      const pb = anchorOf(geometry, c.b);
      if (!pa || !pb) return null;
      const ax = c.type === 'distanceX' ? 1 : 0; // coordinate that is shared by the dimension line
      const level = ax === 1 ? (center[1] > Math.min(pa[1], pb[1]) ? Math.min(pa[1], pb[1]) - off : Math.max(pa[1], pb[1]) + off) : center[0] > Math.min(pa[0], pb[0]) ? Math.min(pa[0], pb[0]) - off : Math.max(pa[0], pb[0]) + off;
      const onLevel = (p: P2): P2 => (ax === 1 ? [p[0], level] : [level, p[1]]);
      const s = onLevel(pa);
      const e = onLevel(pb);
      const n: P2 = ax === 1 ? [0, Math.sign(level - pa[1]) || 1] : [Math.sign(level - pa[0]) || 1, 0];
      return {
        segments: [[pa, add(s, scale(n, arrow * 0.6))], [pb, add(e, scale(n, arrow * 0.6))], [s, e], ...arrowhead(s, e), ...arrowhead(e, s)],
        text: add(mid(s, e), scale(n, 10 * px)),
      };
    }
    case 'radius':
    case 'diameter': {
      const g = geometry.get(c.circle);
      if (g?.type !== 'circle' && g?.type !== 'arc') return null;
      const angle = g.type === 'arc' ? g.a0 + norm(g.a1 - g.a0) / 2 : Math.PI / 4;
      const rim = polar(g.c, g.r, angle);
      const tail = polar(g.c, g.r + off, angle);
      const from = c.type === 'diameter' ? polar(g.c, g.r, angle + Math.PI) : g.c;
      return { segments: [[from, tail], ...arrowhead(rim, from)], text: polar(g.c, g.r + off + 10 * px, angle) };
    }
    case 'angle': {
      const ga = geometry.get(c.a);
      const gb = geometry.get(c.b);
      if (ga?.type !== 'line' || gb?.type !== 'line') return null;
      const { vertex, ra, rb } = angleRays(ga, gb, c.flip);
      const r = off * 1.6;
      const a0 = Math.atan2(ra[1], ra[0]);
      const sweep = rayAngle(ra, rb);
      const pts = Array.from({ length: 17 }, (_, i) => polar(vertex, r, a0 + (sweep * i) / 16));
      const segments: [P2, P2][] = pts.slice(1).map((p, i) => [pts[i]!, p]);
      return { segments, text: polar(vertex, r + 12 * px, a0 + sweep / 2) };
    }
    default:
      return null;
  }
}

/** Display text of a dimension: the value as entered, with SolidWorks prefixes and suffixes. */
export function dimensionText(c: DimensionConstraint): string {
  if (c.type === 'diameter') return `Ø${c.value}`;
  if (c.type === 'radius') return `R${c.value}`;
  if (c.type === 'angle') return /[a-z°]/i.test(c.value) ? c.value : `${c.value}°`;
  return c.value;
}
