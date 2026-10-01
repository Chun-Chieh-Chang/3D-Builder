import { t, type PlainKey } from '@3db/i18n';
import { constraintRefs, isDimension, SKETCH_ORIGIN, type Id, type IdAllocator, type Ref, type SketchConstraint, type SketchEdit, type SketchEntity, type SketchFeature } from '@3db/model';
import { closestOn, onSweep } from './interact';
import type { P2, SolvedGeometry } from './types';

/**
 * Sketch operations that build or change several entities at once (C1.8, C1.9, C1.15, C1.16, C1.17, C1.19): slot, polygon,
 * fillet, chamfer, trim, extend, offset, mirror. Each takes the solved geometry (what the user sees) and the stored sketch,
 * and gives back one `SketchEdit`: the entities and relations to add, the references to change, what to delete. They never
 * touch the document themselves; the controller sends the edit as one command, so every operation is one undo step.
 */

export type Geometry = ReadonlyMap<Id, SolvedGeometry>;
export type OpResult = { edit: SketchEdit } | { error: string };

const add = (a: P2, b: P2): P2 => [a[0] + b[0], a[1] + b[1]];
const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const scale = (a: P2, s: number): P2 => [a[0] * s, a[1] * s];
const dot = (a: P2, b: P2) => a[0] * b[0] + a[1] * b[1];
const cross = (a: P2, b: P2) => a[0] * b[1] - a[1] * b[0];
const len = (a: P2) => Math.hypot(a[0], a[1]);
const dist = (a: P2, b: P2) => len(sub(a, b));
const unit = (a: P2): P2 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};
const perp = (a: P2): P2 => [-a[1], a[0]];

/** A length as the value of a dimension: what a user would type. */
export const fmt = (v: number): string => String(Number(v.toFixed(4)));

const TINY = 1e-9;

/** Accumulates the new entities and relations of one operation. */
class Parts {
  readonly entities: SketchEntity[] = [];
  readonly constraints: SketchConstraint[] = [];

  constructor(readonly ids: IdAllocator) {}

  point(p: P2): Id {
    const id = this.ids.take('p');
    this.entities.push({ id, type: 'point', x: p[0], y: p[1] });
    return id;
  }

  line(p1: Id, p2: Id, construction = false): Id {
    const id = this.ids.take('l');
    this.entities.push({ id, type: 'line', p1, p2, ...(construction ? { construction: true } : {}) });
    return id;
  }

  circle(center: Id, radius: number, construction = false): Id {
    const id = this.ids.take('ci');
    this.entities.push({ id, type: 'circle', center, radius, ...(construction ? { construction: true } : {}) });
    return id;
  }

  arc(center: Id, start: Id, end: Id, construction = false): Id {
    const id = this.ids.take('a');
    this.entities.push({ id, type: 'arc', center, start, end, ...(construction ? { construction: true } : {}) });
    return id;
  }

  relation(body: Record<string, unknown> & { type: SketchConstraint['type'] }): Id {
    const id = this.ids.take('c');
    this.constraints.push({ id, ...body } as SketchConstraint);
    return id;
  }

  /** A driving dimension (its own id series, like the ones the dimension tool makes); the value is a number or an expression. */
  dimension(body: Record<string, unknown> & { type: SketchConstraint['type'] }, value: number | string): Id {
    const id = this.ids.take('d');
    this.constraints.push({ id, ...body, value: typeof value === 'string' ? value : fmt(value) } as SketchConstraint);
    return id;
  }

  get added(): NonNullable<SketchEdit['add']> {
    return { entities: this.entities, constraints: this.constraints };
  }
}

const error = (key: PlainKey): { error: string } => ({ error: t(key) });

// ---------------------------------------------------------------- slot (C1.8)

/**
 * A straight slot: two arcs of radius `r` about the centers `c1` and `c2`, joined by two lines that touch them. The
 * sides are tangent to both arcs, and the arcs have equal radii, which leaves the five freedoms a slot has (both
 * centers and the width). Counter-clockwise: bottom line, arc about `c2`, top line, arc about `c1`.
 */
export function slot(ids: IdAllocator, a1: P2 | { id?: Id; p: P2 }, a2: P2 | { id?: Id; p: P2 }, r: number): OpResult {
  const [m1, m2] = [Array.isArray(a1) ? { p: a1 } : a1, Array.isArray(a2) ? { p: a2 } : a2];
  const [c1, c2] = [m1.p, m2.p];
  if (dist(c1, c2) < TINY) return error('sketch.slotCentersApart');
  if (!(r > TINY)) return error('sketch.slotWidth');
  const n = perp(unit(sub(c2, c1)));
  const b = new Parts(ids);
  // a center that was clicked on an existing point is that point
  const [C1, C2] = [('id' in m1 && m1.id) || b.point(c1), ('id' in m2 && m2.id) || b.point(c2)];
  const S1 = b.point(add(c1, scale(n, r)));
  const E1 = b.point(add(c2, scale(n, r)));
  const E2 = b.point(sub(c2, scale(n, r)));
  const S2 = b.point(sub(c1, scale(n, r)));
  const bottom = b.line(S2, E2);
  const top = b.line(S1, E1);
  const arc2 = b.arc(C2, E2, E1);
  const arc1 = b.arc(C1, S1, S2);
  for (const [line, arc] of [[bottom, arc2], [top, arc2], [top, arc1], [bottom, arc1]] as const) b.relation({ type: 'tangent', a: line, b: arc });
  b.relation({ type: 'equal', a: arc1, b: arc2 });
  return { edit: { add: b.added } };
}

// ---------------------------------------------------------------- polygon (C1.9)

/**
 * A regular polygon of `sides` sides about a center: a construction circle through the corners, the corners on it, and
 * equal sides, which leaves four freedoms (center, size, turn). `q` fixes the size and the turn: a corner when `circumscribed`
 * is false, the middle of a side when true (the construction circle is then still the one through the corners).
 */
export function polygon(ids: IdAllocator, center: { id?: Id; p: P2 }, q: P2, sides: number, circumscribed = false): OpResult {
  if (!Number.isInteger(sides) || sides < 3 || sides > 100) return error('sketch.polygonSides');
  const pick = dist(center.p, q);
  if (pick < TINY) return error('sketch.polygonSize');
  const radius = circumscribed ? pick / Math.cos(Math.PI / sides) : pick;
  const turn = Math.atan2(q[1] - center.p[1], q[0] - center.p[0]) - (circumscribed ? Math.PI / sides : 0);
  const b = new Parts(ids);
  const c = center.id ?? b.point(center.p);
  const ring = b.circle(c, radius, true);
  const corners = Array.from({ length: sides }, (_, i) => {
    const a = turn + (2 * Math.PI * i) / sides;
    return b.point([center.p[0] + radius * Math.cos(a), center.p[1] + radius * Math.sin(a)]);
  });
  const lines = corners.map((p, i) => b.line(p, corners[(i + 1) % sides]!));
  for (const p of corners) b.relation({ type: 'pointOnCurve', point: p, curve: ring });
  for (let i = 1; i < sides; i++) b.relation({ type: 'equal', a: lines[0]!, b: lines[i]! });
  return { edit: { add: b.added } };
}

// ---------------------------------------------------------------- mirror (C1.19)

/**
 * Mirrors entities about a line: each point gets a mirrored twin held by a symmetric relation (so the mirror follows the
 * originals), curves are rebuilt on the twins (an arc runs the other way round), a circle's radius is kept equal. A
 * point on the axis is its own twin. The relations among the originals are not copied: the symmetry carries them over.
 */
export function mirror(sketch: Pick<SketchFeature, 'entities'>, geometry: Geometry, ids: IdAllocator, entityIds: Id[], axisId: Id): OpResult {
  const axis = geometry.get(axisId);
  if (axis?.type !== 'line') return error('sketch.mirrorAxis');
  const chosen = sketch.entities.filter((e) => entityIds.includes(e.id) && e.id !== axisId);
  if (chosen.length === 0) return error('sketch.mirrorNothing');
  const along = unit(sub(axis.b, axis.a));
  const normal = perp(along);
  const side = (p: P2) => dot(sub(p, axis.a), normal);
  const mirrored = (p: P2): P2 => sub(p, scale(normal, 2 * side(p)));
  const posOf = (id: Id): P2 => {
    const g = geometry.get(id);
    return g?.type === 'point' ? g.p : [0, 0];
  };
  const b = new Parts(ids);
  const twin = new Map<Id, Id>();
  const twinOf = (p: Id): Id => {
    let m = twin.get(p);
    if (m) return m;
    // within a hair of the axis a point is its own twin; the origin cannot be moved, so it is never copied
    const on = p === SKETCH_ORIGIN || Math.abs(side(posOf(p))) < 1e-7;
    m = on ? p : b.point(mirrored(posOf(p)));
    if (!on) b.relation({ type: 'symmetric', a: p, b: m, axis: axisId });
    twin.set(p, m);
    return m;
  };
  for (const e of chosen) {
    switch (e.type) {
      case 'point':
        twinOf(e.id);
        break;
      case 'line': {
        const [p1, p2] = [twinOf(e.p1), twinOf(e.p2)];
        if (p1 !== e.p1 || p2 !== e.p2) b.line(p1, p2, e.construction);
        break;
      }
      case 'circle': {
        const copy = b.circle(twinOf(e.center), geometry.get(e.id)?.type === 'circle' ? (geometry.get(e.id) as { r: number }).r : e.radius, e.construction);
        b.relation({ type: 'equal', a: e.id, b: copy });
        break;
      }
      case 'arc':
        b.arc(twinOf(e.center), twinOf(e.end), twinOf(e.start), e.construction);
        break;
    }
  }
  if (b.entities.length === 0) return error('sketch.mirrorOnAxis');
  return { edit: { add: b.added } };
}

// ---------------------------------------------------------------- fillet and chamfer (C1.15)

interface Corner {
  /** The point the two lines share: it stays, as a "virtual sharp", the corner as it was before the round or chamfer. */
  p: Id;
  at: P2;
  /** For each line: the far end (id and place), the direction away from the corner, and which field of the line holds the corner. */
  a: { line: Id; far: Id; farAt: P2; dir: P2; length: number; field: 'p1' | 'p2' };
  b: { line: Id; far: Id; farAt: P2; dir: P2; length: number; field: 'p1' | 'p2' };
  /** The angle between the lines at the corner. */
  angle: number;
}

function cornerOf(geometry: Geometry, lineA: Id, lineB: Id): Corner | { error: string } {
  const [ga, gb] = [geometry.get(lineA), geometry.get(lineB)];
  if (ga?.type !== 'line' || gb?.type !== 'line' || lineA === lineB) return error('sketch.cornerTwoLines');
  const shared = [ga.p1, ga.p2].find((p) => p === gb.p1 || p === gb.p2);
  if (!shared) return error('sketch.cornerShared');
  const part = (line: Id, g: Extract<SolvedGeometry, { type: 'line' }>): Corner['a'] => {
    const field = g.p1 === shared ? 'p1' : 'p2';
    const [at, farAt] = field === 'p1' ? [g.a, g.b] : [g.b, g.a];
    return { line, far: field === 'p1' ? g.p2 : g.p1, farAt, dir: unit(sub(farAt, at)), length: dist(at, farAt), field };
  };
  const a = part(lineA, ga);
  const b = part(lineB, gb);
  const at = ga.p1 === shared ? ga.a : ga.b;
  const angle = Math.acos(Math.max(-1, Math.min(1, dot(a.dir, b.dir))));
  if (angle < 1e-6 || Math.PI - angle < 1e-6) return error('sketch.cornerCollinear');
  return { p: shared, at, a, b, angle };
}

/** The relations that keep the corner point where the two lines cross, and the edit that moves each line's end off it. */
function openCorner(c: Corner, b: Parts, ta: Id, tb: Id, sketch: Pick<SketchFeature, 'constraints'>): SketchEdit {
  b.relation({ type: 'pointOnCurve', point: c.p, curve: c.a.line });
  b.relation({ type: 'pointOnCurve', point: c.p, curve: c.b.line });
  // A length dimension of one of the lines measured corner to far end; it now goes on measuring that, from the virtual sharp.
  const lengths = sketch.constraints.flatMap((k) => {
    if (k.type !== 'distance' || k.b !== undefined) return [];
    const side = k.a === c.a.line ? c.a : k.a === c.b.line ? c.b : null;
    return side ? [{ id: k.id, set: { a: side.far, b: c.p } }] : [];
  });
  return {
    entities: [
      { id: c.a.line, set: { [c.a.field]: ta } },
      { id: c.b.line, set: { [c.b.field]: tb } },
    ],
    constraints: lengths,
  };
}

/**
 * A round (「草圖圓角」) between two lines that share a corner: the lines are shortened to the points where an arc of radius
 * `r` touches them, the arc is tangent to both, and the corner stays as a point on both lines (a virtual sharp), so that
 * what was dimensioned to it still is. The radius is a dimension.
 */
export function fillet(sketch: Pick<SketchFeature, 'constraints'>, geometry: Geometry, ids: IdAllocator, lineA: Id, lineB: Id, r: number): OpResult {
  if (!(r > TINY)) return error('sketch.filletRadius');
  const c = cornerOf(geometry, lineA, lineB);
  if ('error' in c) return c;
  const setback = r / Math.tan(c.angle / 2);
  if (setback >= c.a.length - 1e-9 || setback >= c.b.length - 1e-9) return error('sketch.filletTooBig');
  const t1 = add(c.at, scale(c.a.dir, setback));
  const t2 = add(c.at, scale(c.b.dir, setback));
  const center = add(c.at, scale(unit(add(c.a.dir, c.b.dir)), r / Math.sin(c.angle / 2)));
  const b = new Parts(ids);
  const [T1, T2, C] = [b.point(t1), b.point(t2), b.point(center)];
  // counter-clockwise from the first end to the second when the sweep from T1 to T2 turns left about the center
  const arc = cross(sub(t1, center), sub(t2, center)) > 0 ? b.arc(C, T1, T2) : b.arc(C, T2, T1);
  b.relation({ type: 'tangent', a: c.a.line, b: arc });
  b.relation({ type: 'tangent', a: c.b.line, b: arc });
  b.dimension({ type: 'radius', circle: arc }, r);
  return { edit: { ...openCorner(c, b, T1, T2, sketch), add: b.added } };
}

/**
 * A chamfer (「草圖導角」): the lines are cut back `d1` and `d2` from the corner and joined by a new line; the corner stays as
 * a virtual sharp, and the two distances are dimensions from it.
 */
export function chamfer(sketch: Pick<SketchFeature, 'constraints'>, geometry: Geometry, ids: IdAllocator, lineA: Id, lineB: Id, d1: number, d2: number): OpResult {
  if (!(d1 > TINY) || !(d2 > TINY)) return error('sketch.chamferDistance');
  const c = cornerOf(geometry, lineA, lineB);
  if ('error' in c) return c;
  if (d1 >= c.a.length - 1e-9 || d2 >= c.b.length - 1e-9) return error('sketch.chamferTooBig');
  const b = new Parts(ids);
  const [T1, T2] = [b.point(add(c.at, scale(c.a.dir, d1))), b.point(add(c.at, scale(c.b.dir, d2)))];
  b.line(T1, T2);
  b.dimension({ type: 'distance', a: c.p, b: T1 }, d1);
  b.dimension({ type: 'distance', a: c.p, b: T2 }, d2);
  return { edit: { ...openCorner(c, b, T1, T2, sketch), add: b.added } };
}

// ---------------------------------------------------------------- entities that follow the model (C1.18, C1.26)

/** What a model edge looks like on the sketch plane, or where it pierces it: the shape `@3db/regen` hands over (sketch coordinates). */
export type ModelItem =
  | { ref: Ref; projected: { kind: 'line'; a: P2; b: P2 } | { kind: 'circle'; c: P2; r: number } | { kind: 'arc'; c: P2; r: number; start: P2; end: P2 } }
  | { ref: Ref; pierce: P2 };

/**
 * Adds the model edges as entities that follow them (`ref`), or as pierce points. Corners shared by the new entities are one point; an edge
 * the sketch already follows is left out, and when there is nothing new that is the message.
 */
export function referenceEntities(sketch: Pick<SketchFeature, 'entities'>, ids: IdAllocator, items: ModelItem[]): OpResult {
  const have = new Set(sketch.entities.flatMap((e) => (e.type === 'point' ? (e.pierce ? [`pierce:${e.pierce.name}`] : []) : e.ref ? [`ref:${e.ref.name}`] : [])));
  const fresh = items.filter((i) => !have.has(('pierce' in i ? 'pierce:' : 'ref:') + i.ref.name));
  if (fresh.length === 0) return error('reference.already');
  const b = new Parts(ids);
  const points: { id: Id; at: P2 }[] = [];
  const corner = (at: P2): Id => {
    const found = points.find((p) => dist(p.at, at) < 1e-6);
    if (found) return found.id;
    const id = b.point(at);
    points.push({ id, at });
    return id;
  };
  for (const item of fresh) {
    if ('pierce' in item) {
      b.point(item.pierce);
      (b.entities.at(-1) as Extract<SketchEntity, { type: 'point' }>).pierce = item.ref;
      continue;
    }
    const p = item.projected;
    const lineId = b.ids.take(p.kind === 'line' ? 'l' : p.kind === 'circle' ? 'ci' : 'a');
    if (p.kind === 'line') b.entities.push({ id: lineId, type: 'line', p1: corner(p.a), p2: corner(p.b), ref: item.ref });
    else if (p.kind === 'circle') b.entities.push({ id: lineId, type: 'circle', center: corner(p.c), radius: p.r, ref: item.ref });
    else b.entities.push({ id: lineId, type: 'arc', center: corner(p.c), start: corner(p.start), end: corner(p.end), ref: item.ref });
  }
  return { edit: { add: b.added } };
}

// ---------------------------------------------------------------- merge (C1.26)

const REF_FIELDS = ['a', 'b', 'point', 'line', 'curve', 'axis', 'circle'] as const;

interface Merged {
  edit: SketchEdit;
  /** Groups of points that became one point, and groups left as they were: why each was left. */
  merged: number;
  skipped: ('degenerate' | 'dimension')[];
}

/**
 * Merges groups of points, each into its first point: everything that used another point of the group uses the first, a
 * coincidence between points of the group goes, other relations between them go too (they would say something about one
 * point). A group is left alone when it would collapse an entity that stays (`removing` says which entities go anyway) or
 * when a dimension is between two of its points, since removing the dimension would change the design.
 */
export function mergeGroups(sketch: Pick<SketchFeature, 'entities' | 'constraints'>, groups: Id[][], removing: ReadonlySet<Id> = new Set()): Merged {
  const into = new Map<Id, Id>();
  const skipped: Merged['skipped'] = [];
  let merged = 0;
  for (const group of groups) {
    const inGroup = new Set(group);
    const count = (refs: Id[]) => refs.filter((r) => inGroup.has(r)).length;
    if (sketch.entities.some((e) => !removing.has(e.id) && count(refsOf(e)) > 1)) skipped.push('degenerate');
    else if (sketch.constraints.some((k) => isDimension(k) && count(constraintRefs(k)) > 1)) skipped.push('dimension');
    else {
      for (const gone of group.slice(1)) into.set(gone, group[0]!);
      merged++;
    }
  }
  const entities = sketch.entities.flatMap((e) => {
    const fields = Object.entries(e).filter(([k, v]) => k !== 'id' && typeof v === 'string' && into.has(v));
    return fields.length > 0 ? [{ id: e.id, set: Object.fromEntries(fields.map(([k, v]) => [k, into.get(v as Id)!])) }] : [];
  });
  const remove: Id[] = [...into.keys()];
  const constraints: NonNullable<SketchEdit['constraints']> = [];
  for (const k of sketch.constraints) {
    const fields = REF_FIELDS.filter((f) => into.has((k as Record<string, Id>)[f] as Id));
    if (fields.length === 0) continue;
    const refs = constraintRefs(k).map((r) => into.get(r) ?? r);
    if (new Set(refs).size < refs.length) remove.push(k.id); // it says something about one point now
    else constraints.push({ id: k.id, set: Object.fromEntries(fields.map((f) => [f, into.get((k as Record<string, Id>)[f]!)!])) });
  }
  return { edit: { entities, constraints, remove }, merged, skipped };
}

/**
 * 「合併」: two points become one (the second into the first). The origin cannot be merged (use a coincidence); a dimension
 * between the two, or an entity that has both as its ends, refuses the merge.
 */
export function mergePoints(sketch: Pick<SketchFeature, 'entities' | 'constraints'>, a: Id, b: Id): OpResult {
  const isPoint = (id: Id) => sketch.entities.some((e) => e.id === id && e.type === 'point');
  if (a === SKETCH_ORIGIN || b === SKETCH_ORIGIN) return error('sketch.mergeOrigin');
  if (a === b || !isPoint(a) || !isPoint(b)) return error('sketch.mergeTwoPoints');
  const r = mergeGroups(sketch, [[a, b]]);
  return r.skipped[0] === 'degenerate' ? error('sketch.mergeDegenerate') : r.skipped[0] === 'dimension' ? error('sketch.mergeDimension') : { edit: r.edit };
}


// ---------------------------------------------------------------- where curves meet (trim, extend)

type Curve = Extract<SolvedGeometry, { type: 'line' | 'circle' | 'arc' }>;
export const isCurve = (g: SolvedGeometry | undefined): g is Curve => g?.type === 'line' || g?.type === 'circle' || g?.type === 'arc';

const TAU = Math.PI * 2;
const norm = (a: number) => ((a % TAU) + TAU) % TAU;
const angleAt = (c: P2, p: P2) => Math.atan2(p[1] - c[1], p[0] - c[0]);
/** How far round an arc runs, counter-clockwise from its first end to its second. */
const sweepOf = (g: { a0: number; a1: number }) => norm(g.a1 - g.a0) || TAU;
/** Distance below which two places on a curve are the same place. */
export const SAME = 1e-7;

/** Where two whole curves meet (a line taken as infinite). A tangent touch is not a crossing. */
function crossings(g: Curve, h: Curve): P2[] {
  if (g.type === 'line' && h.type === 'line') {
    const [d1, d2] = [sub(g.b, g.a), sub(h.b, h.a)];
    const den = cross(d1, d2);
    if (Math.abs(den) < 1e-12 * len(d1) * len(d2)) return [];
    return [add(g.a, scale(d1, cross(sub(h.a, g.a), d2) / den))];
  }
  if (g.type === 'line') return lineCircle(g, h as Extract<Curve, { r: number }>);
  if (h.type === 'line') return lineCircle(h, g);
  const d = dist(g.c, h.c);
  if (d < SAME || d > g.r + h.r - SAME || d < Math.abs(g.r - h.r) + SAME) return [];
  const a = (g.r * g.r - h.r * h.r + d * d) / (2 * d);
  const half = Math.sqrt(Math.max(0, g.r * g.r - a * a));
  const u = unit(sub(h.c, g.c));
  const m = add(g.c, scale(u, a));
  return [add(m, scale(perp(u), half)), sub(m, scale(perp(u), half))];
}

function lineCircle(l: Extract<Curve, { type: 'line' }>, c: { c: P2; r: number }): P2[] {
  const d = unit(sub(l.b, l.a));
  const f = sub(l.a, c.c);
  const b = dot(f, d);
  const disc = b * b - (dot(f, f) - c.r * c.r);
  if (disc <= 1e-12 * c.r * c.r) return [];
  const s = Math.sqrt(disc);
  return [add(l.a, scale(d, -b - s)), add(l.a, scale(d, -b + s))];
}

/** Whether a place that is on the whole curve is also on the curve as drawn. */
function drawn(g: Curve, p: P2): boolean {
  if (g.type === 'line') {
    const u = dot(sub(p, g.a), unit(sub(g.b, g.a)));
    return u >= -SAME && u <= dist(g.a, g.b) + SAME;
  }
  if (g.type === 'arc') return norm(angleAt(g.c, p) - g.a0) <= sweepOf(g) + SAME / g.r || norm(angleAt(g.c, p) - g.a0) >= TAU - SAME / g.r;
  return true;
}

/** How far along the curve a place is: a line's length from its first end, an arc's angle from its first end, a circle's angle from the x axis. */
function along(g: Curve, p: P2): number {
  if (g.type === 'line') return dot(sub(p, g.a), unit(sub(g.b, g.a)));
  if (g.type === 'arc') return norm(angleAt(g.c, p) - g.a0);
  return norm(angleAt(g.c, p));
}

export const spanOf = (g: Curve): number => (g.type === 'line' ? dist(g.a, g.b) : g.type === 'arc' ? sweepOf(g) : TAU);

export interface Hit {
  u: number;
  at: P2;
  other: Id;
}

/** Where `id` meets the other curves of the sketch; `beyond` also counts the stretch past its ends (a line's extension, the rest of an arc's circle). */
export function hitsOf(geometry: Geometry, id: Id, g: Curve, beyond: boolean): Hit[] {
  const hits: Hit[] = [];
  for (const [other, h] of geometry) {
    if (other === id || !isCurve(h)) continue;
    for (const at of crossings(g, h)) {
      if (!drawn(h, at) || (!beyond && !drawn(g, at))) continue;
      hits.push({ u: along(g, at), at, other });
    }
  }
  return hits.sort((x, y) => x.u - y.u).filter((h, i, all) => i === 0 || h.u - all[i - 1]!.u > SAME);
}

export const refsOf = (e: SketchEntity): Id[] => (e.type === 'point' ? [] : e.type === 'line' ? [e.p1, e.p2] : e.type === 'circle' ? [e.center] : [e.center, e.start, e.end]);
const usedElsewhere = (sketch: Pick<SketchFeature, 'entities'>, point: Id, except: Id): boolean =>
  sketch.entities.some((e) => e.id !== except && refsOf(e).includes(point));

/** Dimensions and relations that said something about the whole of a curve, which is not whole any more. */
const stale = (sketch: Pick<SketchFeature, 'constraints'>, id: Id): Id[] =>
  sketch.constraints
    .filter((k) => (k.type === 'distance' && k.b === undefined && k.a === id) || (k.type === 'equal' && (k.a === id || k.b === id)) || (k.type === 'midpoint' && k.line === id))
    .map((k) => k.id);

// ---------------------------------------------------------------- trim (C1.16)

/**
 * Trims the stretch of a line, arc or circle under `click` that lies between the nearest crossings with other curves (or
 * its ends). A curve with nothing to cross is deleted. A stretch in the middle splits the curve in two: the second piece
 * takes over the horizontal, vertical, parallel, perpendicular and collinear relations of the first, an arc piece is equal
 * in radius to the first. The new ends lie on the curves that cut them off. Lengths and equalities of the whole curve go.
 */
export function trim(sketch: Pick<SketchFeature, 'entities' | 'constraints'>, geometry: Geometry, ids: IdAllocator, entityId: Id, click: P2): OpResult {
  const e = sketch.entities.find((x) => x.id === entityId);
  const g = geometry.get(entityId);
  if (!e || e.type === 'point' || !isCurve(g)) return error('sketch.trimNotCurve');
  const [lo0, hi0] = [SAME, spanOf(g) - SAME];
  const hits = hitsOf(geometry, entityId, g, false).filter((h) => g.type === 'circle' || (h.u > lo0 && h.u < hi0));
  const here = along(g, closestOn(g, click) ?? click);
  let before = hits.filter((h) => h.u < here).at(-1);
  let after = hits.find((h) => h.u > here);
  if (g.type === 'circle') {
    if (hits.length < 2) return { edit: { remove: [entityId] } };
    before ??= hits.at(-1);
    after ??= hits[0];
  } else if (!before && !after) {
    return { edit: { remove: [entityId] } };
  }
  const b = new Parts(ids);
  const pin = (hit: Hit): Id => {
    const p = b.point(hit.at);
    b.relation({ type: 'pointOnCurve', point: p, curve: hit.other });
    return p;
  };
  const gone = stale(sketch, entityId);

  if (e.type === 'circle') {
    // what is left of a circle is an arc, from where the cut ends round to where it begins
    const keep = b.arc(e.center, pin(after!), pin(before!), e.construction);
    const retarget = sketch.constraints.flatMap((k) => {
      const set: Record<string, Id> = {};
      for (const field of ['a', 'b', 'circle', 'curve'] as const) if ((k as Record<string, unknown>)[field] === entityId) set[field] = keep;
      return Object.keys(set).length > 0 ? [{ id: k.id, set }] : [];
    });
    return { edit: { constraints: retarget, add: b.added, remove: [entityId] } };
  }

  const [first, second] = e.type === 'line' ? (['p1', 'p2'] as const) : (['start', 'end'] as const);
  const entities: NonNullable<SketchEdit['entities']> = [];
  const remove = [...gone];
  const dropEnd = (field: typeof first | typeof second) => {
    const p = (e as unknown as Record<string, Id>)[field]!;
    if (!usedElsewhere(sketch, p, entityId)) remove.push(p);
  };
  if (before && after) {
    const x1 = pin(before);
    const x2 = pin(after);
    const end = (e as unknown as Record<string, Id>)[second]!;
    entities.push({ id: entityId, set: { [second]: x1 } });
    if (e.type === 'line') {
      const copy = b.line(x2, end, e.construction);
      for (const k of sketch.constraints) {
        if ((k.type === 'horizontal' || k.type === 'vertical') && k.a === entityId && k.b === undefined) b.relation({ type: k.type, a: copy });
        else if ((k.type === 'parallel' || k.type === 'perpendicular' || k.type === 'collinear') && (k.a === entityId || k.b === entityId)) {
          b.relation({ type: k.type, a: k.a === entityId ? copy : k.a, b: k.b === entityId ? copy : k.b });
        }
      }
    } else {
      const copy = b.arc(e.center, x2, end, e.construction);
      b.relation({ type: 'equal', a: entityId, b: copy });
    }
  } else if (before) {
    entities.push({ id: entityId, set: { [second]: pin(before) } });
    dropEnd(second);
  } else {
    entities.push({ id: entityId, set: { [first]: pin(after!) } });
    dropEnd(first);
  }
  return { edit: { entities, add: b.added, remove } };
}

// ---------------------------------------------------------------- extend (C1.16)

/**
 * Lengthens the end of a line or arc nearest `click` until it meets the first curve in its way. The new end lies on that
 * curve; the old end goes (with what was attached to it), and so do the length and equalities of the whole curve. An end
 * that other curves also use is not extended: that would drag them along.
 */
export function extend(sketch: Pick<SketchFeature, 'entities' | 'constraints'>, geometry: Geometry, ids: IdAllocator, entityId: Id, click: P2): OpResult {
  const e = sketch.entities.find((x) => x.id === entityId);
  const g = geometry.get(entityId);
  if (!e || (e.type !== 'line' && e.type !== 'arc') || (g?.type !== 'line' && g?.type !== 'arc')) return error('sketch.extendNotCurve');
  const [at0, at1]: [P2, P2] = g.type === 'line' ? [g.a, g.b] : [add(g.c, scale([Math.cos(g.a0), Math.sin(g.a0)], g.r)), add(g.c, scale([Math.cos(g.a1), Math.sin(g.a1)], g.r))];
  const atEnd = dist(click, at1) < dist(click, at0);
  const span = spanOf(g);
  const reach = (h: Hit): number => (g.type === 'line' ? (atEnd ? h.u - span : -h.u) : atEnd ? h.u - span : TAU - h.u);
  const next = hitsOf(geometry, entityId, g, true)
    .filter((h) => reach(h) > SAME && (g.type === 'line' || h.u > span))
    .sort((x, y) => reach(x) - reach(y))[0];
  if (!next) return error('sketch.extendNothing');
  const field = e.type === 'line' ? (atEnd ? 'p2' : 'p1') : atEnd ? 'end' : 'start';
  const old = (e as unknown as Record<string, Id>)[field]!;
  if (usedElsewhere(sketch, old, entityId)) return error('sketch.extendShared');
  const b = new Parts(ids);
  const x = b.point(next.at);
  b.relation({ type: 'pointOnCurve', point: x, curve: next.other });
  return { edit: { entities: [{ id: entityId, set: { [field]: x } }], add: b.added, remove: [old, ...stale(sketch, entityId)] } };
}

// ---------------------------------------------------------------- offset (C1.17)

interface Leg {
  id: Id;
  entity: Extract<SketchEntity, { type: 'line' | 'arc' }>;
  g: Extract<Curve, { type: 'line' | 'arc' }>;
  /** Travel direction: the point it starts from and the one it runs to, as stored fields' ids and places. */
  from: Id;
  to: Id;
  fromAt: P2;
  toAt: P2;
  /** Travelled from its second end to its first. */
  flip: boolean;
}

/** The direction a leg runs in at a place, along the way of travel. */
function heading(l: Leg, p: P2): P2 {
  if (l.g.type === 'line') return l.flip ? unit(sub(l.g.a, l.g.b)) : unit(sub(l.g.b, l.g.a));
  const radial = unit(sub(p, l.g.c));
  return l.flip ? [radial[1], -radial[0]] : perp(radial);
}

/**
 * Offsets lines, arcs and circles by `d` towards `toward`. Selected curves that join end to end are offset as one chain,
 * all to the same side, corners meeting where the offset curves cross. Each offset line is parallel to its original, the
 * first at a driving distance `d` and the others at "the same" (an expression naming the first), so changing one changes
 * all; an arc or circle is about the same center with its new radius as a dimension. The ends of an open chain are not
 * pinned along their curve.
 */
export function offset(sketch: Pick<SketchFeature, 'entities' | 'name'>, geometry: Geometry, ids: IdAllocator, entityIds: Id[], d: number, toward: P2): OpResult {
  const chosen = sketch.entities.filter((e): e is Leg['entity'] | Extract<SketchEntity, { type: 'circle' }> => entityIds.includes(e.id) && (e.type === 'line' || e.type === 'arc' || e.type === 'circle'));
  if (chosen.length === 0) return error('sketch.offsetNothing');
  if (!(d > TINY)) return error('sketch.offsetDistance');
  const b = new Parts(ids);
  let first: string | null = null;
  const lineDistance = (original: Id, copy: Id) => {
    if (first === null) first = `D${b.dimension({ type: 'distance', a: original, b: copy }, d).slice(1)}@${sketch.name}`;
    else b.dimension({ type: 'distance', a: original, b: copy }, first);
  };

  const circles = chosen.filter((e) => e.type === 'circle');
  for (const e of circles) {
    const g = geometry.get(e.id);
    if (g?.type !== 'circle') continue;
    const r = dist(toward, g.c) < g.r ? g.r - d : g.r + d;
    if (!(r > TINY)) return error('sketch.offsetTooSmall');
    const copy = b.circle(e.center, r, e.construction);
    b.dimension({ type: 'radius', circle: copy }, r);
  }

  // chains of curves that share end points
  const open = chosen.filter((e): e is Leg['entity'] => e.type !== 'circle');
  const users = new Map<Id, Leg['entity'][]>();
  for (const e of open) for (const p of e.type === 'line' ? [e.p1, e.p2] : [e.start, e.end]) users.set(p, [...(users.get(p) ?? []), e]);
  if ([...users.values()].some((u) => u.length > 2)) return error('sketch.offsetBranch');
  const seen = new Set<Id>();
  const ends = (e: Leg['entity']): [Id, Id] => (e.type === 'line' ? [e.p1, e.p2] : [e.start, e.end]);
  const place = (id: Id): P2 => {
    const g = geometry.get(id);
    return g?.type === 'point' ? g.p : [0, 0];
  };
  const order = [...open.filter((e) => ends(e).some((p) => users.get(p)!.length === 1)), ...open]; // open chains start at an end
  for (const startEntity of order) {
    if (seen.has(startEntity.id)) continue;
    const legs: Leg[] = [];
    let cur: Leg['entity'] | undefined = startEntity;
    let from = ends(startEntity).find((p) => users.get(p)!.length === 1) ?? ends(startEntity)[0];
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      const [e0, e1] = ends(cur);
      const flip = from !== e0;
      const to = flip ? e0 : e1;
      const g = geometry.get(cur.id);
      if (g?.type !== 'line' && g?.type !== 'arc') return error('sketch.offsetNothing');
      legs.push({ id: cur.id, entity: cur, g, from, to, fromAt: place(from), toAt: place(to), flip });
      from = to;
      cur = users.get(to)!.find((x) => x.id !== cur!.id);
    }
    const loop = legs.length > 1 && legs[0]!.from === legs.at(-1)!.to;
    if (legs.length === 1 && legs[0]!.from === legs[0]!.to) return error('sketch.offsetBranch');

    // the side: left or right of the way of travel, as the click lies from the curve nearest it
    let best = { dist: Infinity, side: 1 };
    for (const l of legs) {
      const near = closestOn(l.g, toward);
      if (!near) continue;
      const dd = dist(near, toward);
      if (dd < best.dist) best = { dist: dd, side: cross(heading(l, near), sub(toward, near)) >= 0 ? 1 : -1 };
    }
    const shift = (l: Leg, p: P2): P2 => add(p, scale(perp(heading(l, p)), best.side * d));
    const bent = legs.map((l): Curve | string => {
      if (l.g.type === 'line') {
        const [da, db] = [shift(l, l.g.a), shift(l, l.g.b)];
        return { type: 'line', a: da, b: db, p1: l.g.p1, p2: l.g.p2, construction: l.g.construction };
      }
      const p = l.fromAt;
      const outward = dot(perp(heading(l, p)), unit(sub(p, l.g.c))) * best.side; // +1: the offset runs away from the center
      const r = l.g.r + outward * d;
      return r > TINY ? { type: 'circle', c: l.g.c, r, center: l.g.center, construction: l.g.construction } : 'small';
    });
    if (bent.includes('small')) return error('sketch.offsetTooSmall');
    const curves = bent as Curve[];

    // where consecutive offset curves meet: the corner of the offset chain. Curves that run on into each other (tangent)
    // meet where the old corner slid sideways; a line and an arc keep a tangent relation there, since the two equations
    // "on the line" and "on the circle" would otherwise lean the same way and fix nothing.
    const joint = (i: number): { at: P2; tangent: boolean } | null => {
      const [l, m] = [legs[i]!, legs[(i + 1) % legs.length]!];
      const next = curves[(i + 1) % legs.length]!;
      const slid = shift(l, l.toAt);
      const tangent = Math.abs(cross(heading(l, l.toAt), heading(m, l.toAt))) < 1e-6 && dot(heading(l, l.toAt), heading(m, l.toAt)) > 0;
      if (tangent) return l.g.type === m.g.type ? null : { at: slid, tangent };
      const meets = crossings(curves[i]!, next).sort((x, y) => dist(x, slid) - dist(y, slid));
      return meets[0] ? { at: meets[0], tangent } : null;
    };
    const count = loop ? legs.length : legs.length - 1;
    const joints = Array.from({ length: count }, (_, i) => joint(i));
    if (joints.some((j) => j === null)) return error('sketch.offsetNoJoin');
    const corners: P2[] = [
      loop ? joints.at(-1)!.at : shift(legs[0]!, legs[0]!.fromAt),
      ...joints.map((j) => j!.at),
      ...(loop ? [] : [shift(legs.at(-1)!, legs.at(-1)!.toAt)]),
    ];
    // corners[i] is where leg i starts, corners[i + 1] where it ends (a loop's last corner is its first)
    const pts = (loop ? corners.slice(0, legs.length) : corners).map((p) => b.point(p));
    const at = (i: number): Id => pts[i % pts.length]!;
    const made = legs.map((l, i): Id => {
      const [p, q] = [at(i), at(i + 1)];
      if (l.entity.type === 'line') return b.line(p, q, l.entity.construction);
      const copy = l.flip ? b.arc(l.entity.center, q, p, l.entity.construction) : b.arc(l.entity.center, p, q, l.entity.construction);
      b.dimension({ type: 'radius', circle: copy }, (curves[i] as Extract<Curve, { type: 'circle' }>).r);
      return copy;
    });
    legs.forEach((l, i) => {
      if (l.entity.type !== 'line') return;
      const n = legs.length;
      // an arc this line runs tangent into at either end; each tangent relation takes the place of one of "parallel" and "distance"
      const arcs = [loop || i > 0 ? (joints[(i - 1 + n) % n]!.tangent ? made[(i - 1 + n) % n]! : null) : null, joints[i]?.tangent ? made[(i + 1) % n]! : null].filter((x): x is Id => x !== null);
      for (const arc of arcs) b.relation({ type: 'tangent', a: made[i]!, b: arc });
      if (arcs.length === 0) b.relation({ type: 'parallel', a: l.id, b: made[i]! });
      if (arcs.length < 2) lineDistance(l.id, made[i]!);
    });
  }
  return { edit: { add: b.added } };
}
