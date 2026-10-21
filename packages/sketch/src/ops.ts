import { t, type PlainKey } from '@3db/i18n';
import {
  constraintRefs,
  isDimension,
  isSketchAxis,
  SKETCH_ORIGIN,
  type CircleRadius,
  type EntityRefs,
  type Id,
  type IdAllocator,
  type PointPosition,
  type Ref,
  type SketchConstraint,
  type SketchEdit,
  type SketchEntity,
  type SketchFeature,
  type SketchPlacement,
} from '@3db/model';
import { closestOn, geometryOf, pointOf } from './interact';
import { textContours } from './font';
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
  // a line of the sketch, or one of its axes (ADR 0170)
  const axis = geometryOf(geometry, axisId);
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

/**
 * What a model edge looks like on the sketch plane, or where it pierces it: the shape `@3db/regen` hands over (sketch coordinates). `off` is there when
 * the edge was projected onto the plane from outside (C1 2026-10-14): how near it comes to the plane, 0 when it passes through it; absent: it lies in it.
 */
export type ModelItem =
  | {
      ref: Ref;
      projected:
        | { kind: 'line'; a: P2; b: P2 }
        | { kind: 'circle'; c: P2; r: number }
        | { kind: 'arc'; c: P2; r: number; start: P2; end: P2 }
        | { kind: 'spline'; points: P2[] };
      off?: number;
    }
  | { ref: Ref; pierce: P2 }
  /** A model vertex projected onto the plane (ADR 0171); `off` is how far it is from it. */
  | { ref: Ref; vertex: P2; off?: number };

/** A model edge as it lies in the sketch plane (or projected onto it). */
export type ModelEdge = Extract<ModelItem, { projected: unknown }>;

/** The sketch point that follows where `item` pierces the plane: the one the sketch or this action already has, else a new one. */
function piercePoint(sketch: Pick<SketchFeature, 'entities'>, made: Maker, item: Extract<ModelItem, { pierce: P2 }>): Id {
  const have = [...sketch.entities, ...made.entities].find((e) => e.type === 'point' && e.pierce?.name === item.ref.name);
  if (have) return have.id;
  const id = made.ids.take('p');
  made.entities.push({ id, type: 'point', x: item.pierce[0], y: item.pierce[1], pierce: item.ref });
  return id;
}

/** The sketch point that follows model vertex `item` (ADR 0171): the one the sketch or this action already has, else a new one. */
function vertexPoint(sketch: Pick<SketchFeature, 'entities'>, made: Maker, item: Extract<ModelItem, { vertex: P2 }>): Id {
  const have = [...sketch.entities, ...made.entities].find((e) => e.type === 'point' && e.ref?.name === item.ref.name);
  if (have) return have.id;
  const id = made.ids.take('p');
  made.entities.push({ id, type: 'point', x: item.vertex[0], y: item.vertex[1], ref: item.ref });
  return id;
}

/** What `anchorModel` works on: the entities and relations an action has made so far, and where it takes new ids from. */
export interface Maker {
  readonly ids: IdAllocator;
  readonly entities: SketchEntity[];
  readonly constraints: SketchConstraint[];
}

/**
 * The point of a model edge a click stands for (D5.3b): the edge becomes an entity that follows it (unless the sketch, or this action,
 * already has one) and the point is one of its ends or its center; the middle or any other place along it is a new point with a
 * midpoint / on-curve relation to the entity. Ends that lie where an earlier entity of that kind already has a point are shared
 * with it, so two edges meeting at a corner meet at one point. A pierce point is a sketch point that follows the edge (as 「貫穿」 makes).
 */
export function anchorModel(sketch: Pick<SketchFeature, 'entities'>, geometry: Geometry, made: Maker, item: ModelItem, part: 'start' | 'end' | 'center' | 'mid' | 'curve' | 'pierce' | 'vertex', at: P2): Id {
  if ('pierce' in item) return piercePoint(sketch, made, item);
  if ('vertex' in item) return vertexPoint(sketch, made, item);
  const all = [...sketch.entities, ...made.entities];
  let entity = all.find((e): e is Exclude<SketchEntity, { type: 'point' | 'text' }> => 'ref' in e && e.ref?.name === item.ref.name);
  if (!entity) {
    // corners already there: the ends and centers of the entities that follow the model
    const known: { id: Id; at: P2 }[] = [];
    for (const e of all) {
      if (e.type === 'point' || !('ref' in e) || !e.ref) continue;
      for (const id of refsOf(e)) {
        const g = geometry.get(id);
        const made_ = all.find((x) => x.id === id && x.type === 'point') as Extract<SketchEntity, { type: 'point' }> | undefined;
        const p = g?.type === 'point' ? g.p : made_ ? ([made_.x, made_.y] as P2) : null;
        if (p) known.push({ id, at: p });
      }
    }
    const corner = (p: P2): Id => {
      const found = known.find((k) => dist(k.at, p) < 1e-6);
      if (found) return found.id;
      const id = made.ids.take('p');
      made.entities.push({ id, type: 'point', x: p[0], y: p[1] });
      known.push({ id, at: p });
      return id;
    };
    const q = item.projected;
    // every edge a click takes is only something to hold the point to: construction, so it never joins a profile (C3 2026-10-15: an in-plane
    // edge taken as a profile line overlapped the rectangle drawn on it and made the extrude fail)
    const held = { construction: true };
    if (q.kind === 'line') entity = { id: made.ids.take('l'), type: 'line', p1: corner(q.a), p2: corner(q.b), ref: item.ref, ...held };
    else if (q.kind === 'circle') entity = { id: made.ids.take('ci'), type: 'circle', center: corner(q.c), radius: q.r, ref: item.ref, ...held };
    else if (q.kind === 'arc') entity = { id: made.ids.take('a'), type: 'arc', center: corner(q.c), start: corner(q.start), end: corner(q.end), ref: item.ref, ...held };
    else entity = { id: made.ids.take('sp'), type: 'spline', points: q.points.map(corner), ref: item.ref, ...held };
    made.entities.push(entity);
  }
  if (part === 'center' && 'center' in entity) return entity.center;
  if (part === 'start') return entity.type === 'line' ? entity.p1 : entity.type === 'arc' ? entity.start : entity.type === 'spline' ? entity.points[0]! : entity.center;
  if (part === 'end') return entity.type === 'line' ? entity.p2 : entity.type === 'arc' ? entity.end : entity.type === 'spline' ? entity.points[entity.points.length - 1]! : entity.center;
  const id = made.ids.take('p');
  made.entities.push({ id, type: 'point', x: at[0], y: at[1] });
  made.constraints.push(
    part === 'mid' && entity.type === 'line'
      ? { id: made.ids.take('c'), type: 'midpoint', point: id, line: entity.id }
      : { id: made.ids.take('c'), type: 'pointOnCurve', point: id, curve: entity.id },
  );
  return id;
}

/**
 * Anchors a model edge (or vertex/center) for direct selection or constraining (Plan B).
 * Makes the entity as construction geometry so it does not interfere with extrusion profiles.
 * Returns the id of the curve (when part === 'curve') or the point (when part === 'start' | 'end' | 'center' | 'mid').
 */
export function anchorModelForSelection(
  sketch: Pick<SketchFeature, 'entities'>,
  geometry: Geometry,
  made: Maker,
  item: ModelItem,
  part: 'start' | 'end' | 'center' | 'mid' | 'curve' | 'pierce' | 'vertex',
  at: P2,
): Id {
  if ('pierce' in item) return piercePoint(sketch, made, item);
  if ('vertex' in item) return vertexPoint(sketch, made, item);
  const all = [...sketch.entities, ...made.entities];
  let entity = all.find((e): e is Exclude<SketchEntity, { type: 'point' | 'text' }> => 'ref' in e && e.ref?.name === item.ref.name);
  if (!entity) {
    const known: { id: Id; at: P2 }[] = [];
    for (const e of all) {
      if (e.type === 'point' || !('ref' in e) || !e.ref) continue;
      for (const id of refsOf(e)) {
        const g = geometry.get(id);
        const made_ = all.find((x) => x.id === id && x.type === 'point') as Extract<SketchEntity, { type: 'point' }> | undefined;
        const p = g?.type === 'point' ? g.p : made_ ? ([made_.x, made_.y] as P2) : null;
        if (p) known.push({ id, at: p });
      }
    }
    const corner = (p: P2): Id => {
      const found = known.find((k) => dist(k.at, p) < 1e-6);
      if (found) return found.id;
      const id = made.ids.take('p');
      made.entities.push({ id, type: 'point', x: p[0], y: p[1] });
      known.push({ id, at: p });
      return id;
    };
    const q = item.projected;
    if (q.kind === 'line') entity = { id: made.ids.take('l'), type: 'line', p1: corner(q.a), p2: corner(q.b), ref: item.ref, construction: true };
    else if (q.kind === 'circle') entity = { id: made.ids.take('ci'), type: 'circle', center: corner(q.c), radius: q.r, ref: item.ref, construction: true };
    else if (q.kind === 'arc') entity = { id: made.ids.take('a'), type: 'arc', center: corner(q.c), start: corner(q.start), end: corner(q.end), ref: item.ref, construction: true };
    else entity = { id: made.ids.take('sp'), type: 'spline', points: q.points.map(corner), ref: item.ref, construction: true };
    made.entities.push(entity);
  }
  if (part === 'curve') return entity.id;
  if (part === 'center' && 'center' in entity) return entity.center;
  if (part === 'start') return entity.type === 'line' ? entity.p1 : entity.type === 'arc' ? entity.start : entity.type === 'spline' ? entity.points[0]! : entity.center;
  if (part === 'end') return entity.type === 'line' ? entity.p2 : entity.type === 'arc' ? entity.end : entity.type === 'spline' ? entity.points[entity.points.length - 1]! : entity.center;
  if (part === 'mid' && entity.type === 'line') {
    const midPoint = all.find((e): e is Extract<SketchEntity, { type: 'point' }> => e.type === 'point' && dist([e.x, e.y], at) < 1e-6);
    if (midPoint) return midPoint.id;
    const id = made.ids.take('p');
    made.entities.push({ id, type: 'point', x: at[0], y: at[1] });
    made.constraints.push({ id: made.ids.take('c'), type: 'midpoint', point: id, line: entity.id });
    return id;
  }
  return entity.id;
}

/**
 * Adds the model edges as entities that follow them (`ref`), or as pierce points. Corners shared by the new entities are one point; an edge
 * the sketch already follows is left out, and when there is nothing new that is the message.
 */
export function referenceEntities(sketch: Pick<SketchFeature, 'entities'>, ids: IdAllocator, items: ModelItem[]): OpResult {
  const key = (kind: 'pierce' | 'vertex' | 'ref', name: string) => `${kind}:${name}`;
  const have = new Set(
    sketch.entities.flatMap((e) => (e.type === 'point' ? (e.pierce ? [key('pierce', e.pierce.name)] : e.ref ? [key('vertex', e.ref.name)] : []) : 'ref' in e && e.ref ? [key('ref', e.ref.name)] : [])),
  );
  const fresh = items.filter((i) => !have.has(key('pierce' in i ? 'pierce' : 'vertex' in i ? 'vertex' : 'ref', i.ref.name)));
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
    if ('vertex' in item) {
      b.point(item.vertex);
      (b.entities.at(-1) as Extract<SketchEntity, { type: 'point' }>).ref = item.ref;
      continue;
    }
    const p = item.projected;
    const lineId = b.ids.take(p.kind === 'line' ? 'l' : p.kind === 'circle' ? 'ci' : p.kind === 'arc' ? 'a' : 'sp');
    // a line from reference geometry (ADR 0172) is an infinite reference, never part of a profile
    if (p.kind === 'line') b.entities.push({ id: lineId, type: 'line', p1: corner(p.a), p2: corner(p.b), ref: item.ref, ...(item.ref.kind === 'datum' ? { construction: true } : {}) });
    else if (p.kind === 'circle') b.entities.push({ id: lineId, type: 'circle', center: corner(p.c), radius: p.r, ref: item.ref });
    else if (p.kind === 'arc') b.entities.push({ id: lineId, type: 'arc', center: corner(p.c), start: corner(p.start), end: corner(p.end), ref: item.ref });
    else b.entities.push({ id: lineId, type: 'spline', points: p.points.map(corner), ref: item.ref });
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
  // A line's own horizontal or vertical and one between its two ends say the same once the gap between them is closed, and the
  // solver would call the sketch over-defined: the later of the two goes.
  const touched = new Set([...into.keys(), ...into.values()]);
  const ends = new Map(sketch.entities.flatMap((e) => (e.type === 'line' && !removing.has(e.id) ? [[e.id, [e.p1, e.p2] as const] as const] : [])));
  const gone = new Set(remove);
  const seen = new Set<string>();
  const duplicates = new Set<Id>();
  for (const k of sketch.constraints) {
    if ((k.type !== 'horizontal' && k.type !== 'vertical') || gone.has(k.id)) continue;
    const pair = k.b === undefined ? ends.get(k.a) : ([k.a, k.b] as const);
    if (!pair || !pair.some((p) => touched.has(p))) continue;
    const key = `${k.type}|${pair.map((p) => into.get(p) ?? p).sort().join('|')}`;
    if (seen.has(key)) duplicates.add(k.id);
    else seen.add(key);
  }
  // A point on a line or arc that is now one of its own ends says nothing more (a lug line ending on an arc, the arc starting on the line: made
  // one point, each "on" the other is the corner itself), and the solver would call the sketch over-defined: it goes.
  const endsOf = (id: Id): Id[] => {
    const e = sketch.entities.find((x) => x.id === id);
    return e?.type === 'line' ? [e.p1, e.p2] : e?.type === 'arc' ? [e.start, e.end] : [];
  };
  for (const k of sketch.constraints) {
    if (k.type !== 'pointOnCurve' || gone.has(k.id)) continue;
    const ends = endsOf(k.curve);
    if (!touched.has(k.point) && !ends.some((x) => touched.has(x))) continue;
    if (ends.map((x) => into.get(x) ?? x).includes(into.get(k.point) ?? k.point)) duplicates.add(k.id);
  }
  if (duplicates.size > 0) {
    remove.push(...duplicates);
    return { edit: { entities, constraints: constraints.filter((c) => !duplicates.has(c.id)), remove }, merged, skipped };
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
export function crossings(g: Curve, h: Curve): P2[] {
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
export function drawn(g: Curve, p: P2): boolean {
  if (g.type === 'line') {
    const u = dot(sub(p, g.a), unit(sub(g.b, g.a)));
    return u >= -SAME && u <= dist(g.a, g.b) + SAME;
  }
  if (g.type === 'arc') return norm(angleAt(g.c, p) - g.a0) <= sweepOf(g) + SAME / g.r || norm(angleAt(g.c, p) - g.a0) >= TAU - SAME / g.r;
  return true;
}

/**
 * Where two curves meet for the 「交錯」 relation: a line and a circle count whole, as the solver takes them, and an
 * arc only where it is drawn. Empty for two parallel lines and for circles that are apart, where the relation cannot hold.
 */
export function relationCrossings(a: Curve, b: Curve): P2[] {
  return crossings(a, b).filter((p) => (a.type === 'arc' ? drawn(a, p) : true) && (b.type === 'arc' ? drawn(b, p) : true));
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

export const refsOf = (e: SketchEntity): Id[] =>
  e.type === 'point'
    ? []
    : e.type === 'line'
      ? [e.p1, e.p2]
      : e.type === 'circle'
        ? [e.center]
        : e.type === 'ellipse'
          ? [e.center, e.major]
          : e.type === 'spline'
            ? e.points
            : e.type === 'text'
              ? [e.at]
              : [e.center, e.start, e.end];
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
  if (!e || e.type === 'point' || e.type === 'spline' || !isCurve(g)) return error('sketch.trimNotCurve');
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
    } else if (e.type === 'arc') {
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

/**
 * Dissolves a sketch text entity into standard sketch lines and points (比照 SolidWorks 「解散草圖文字」).
 */
export function dissolveText(
  sketch: SketchFeature,
  geometry: Geometry,
  textId: Id,
  ids: IdAllocator,
): OpResult {
  const entity = sketch.entities.find((e) => e.id === textId);
  if (!entity || entity.type !== 'text') {
    return { error: t('sketch.textNotFound') };
  }
  const atPos = pointOf(geometry, entity.at) ?? [0, 0];
  const loops = textContours(entity.text, {
    size: entity.size,
    at: atPos,
    angle: entity.angle,
    align: entity.align,
    bold: entity.bold,
    italic: entity.italic,
  });
  const parts = new Parts(ids);
  for (const loop of loops) {
    if (loop.length < 2) continue;
    let prevPtId: Id | null = null;
    let firstPtId: Id | null = null;
    for (let i = 0; i < loop.length; i++) {
      const seg = loop[i]!;
      if (seg.kind === 'line') {
        const ptId: Id = i === 0 ? parts.point(seg.a) : prevPtId!;
        if (i === 0) firstPtId = ptId;
        const nextPtId: Id = i === loop.length - 1 ? firstPtId! : parts.point(seg.b);
        parts.line(ptId, nextPtId, entity.construction);
        prevPtId = nextPtId;
      }
    }
  }
  return {
    edit: {
      remove: [textId],
      add: parts.added,
    },
  };
}

// ---------------------------------------------------------------- move, copy, rotate, scale and sketch patterns (ADR 0177)

/** A map of the sketch plane: a move by `d`; a turn of `angle` degrees counter-clockwise about `c`; a scale by `k` about `c`. */
export type Transform2 = { kind: 'translate'; d: P2 } | { kind: 'rotate'; c: P2; angle: number } | { kind: 'scale'; c: P2; k: number };

/** A sketch pattern: `count` copies (the original is not counted), each `step` on from the last; or turned about `c`, the last one `angle` degrees round (360: spaced evenly all the way round). */
export type PatternSpec = { kind: 'linear'; step: P2; count: number } | { kind: 'circular'; c: P2; angle: number; count: number };

export interface TransformOptions {
  /** 「保持關係」: the relations and dimensions between the selection and the rest of the sketch stay (moving), the ones within the selection are copied (copying). */
  keepRelations: boolean;
  /** 「複製」: copies of the selection are made where the transform takes it, the selection stays. */
  copy: boolean;
}

/** What the operation asks of the sketch: the edit, and where the points and circles it moved or made should end up (the targets the solver is dragged to). */
export type TransformResult = { edit: SketchEdit; targets: PointPosition[]; radii: CircleRadius[]; removed: number } | { error: string };

/** The most copies one sketch pattern makes. */
export const PATTERN_MAX = 200;

export function applyTransform(m: Transform2, p: P2): P2 {
  switch (m.kind) {
    case 'translate':
      return [p[0] + m.d[0], p[1] + m.d[1]];
    case 'rotate': {
      const a = (m.angle * Math.PI) / 180;
      const [c, s] = [Math.cos(a), Math.sin(a)];
      const [x, y] = [p[0] - m.c[0], p[1] - m.c[1]];
      return [m.c[0] + c * x - s * y, m.c[1] + s * x + c * y];
    }
    case 'scale':
      return [m.c[0] + m.k * (p[0] - m.c[0]), m.c[1] + m.k * (p[1] - m.c[1])];
  }
}

const finiteP = (p: P2) => Number.isFinite(p[0]) && Number.isFinite(p[1]);

/** Why a transform cannot be applied (it is never quietly changed into one that can, AGENTS.md §2.1), or null. */
export function transformProblem(m: Transform2): string | null {
  switch (m.kind) {
    case 'translate':
      if (!finiteP(m.d)) return t('sketch.xformDistanceInvalid');
      return Math.hypot(m.d[0], m.d[1]) < TINY ? t('sketch.xformNoMove') : null;
    case 'rotate': {
      if (!finiteP(m.c)) return t('sketch.xformPointInvalid');
      if (!Number.isFinite(m.angle)) return t('sketch.xformAngleInvalid');
      const turns = m.angle / 360;
      return Math.abs(turns - Math.round(turns)) < 1e-12 ? t('sketch.xformNoTurn') : null;
    }
    case 'scale':
      if (!finiteP(m.c)) return t('sketch.xformPointInvalid');
      if (!Number.isFinite(m.k) || m.k <= 0) return t('sketch.xformScaleInvalid');
      return Math.abs(m.k - 1) < 1e-12 ? t('sketch.xformScaleOne') : null;
  }
}

/** Quarter turns of a transform (0–3), or null when it turns by something else: what a horizontal or vertical relation becomes. */
function quarterTurns(m: Transform2): number | null {
  if (m.kind !== 'rotate') return 0;
  const q = m.angle / 90;
  const r = Math.round(q);
  return Math.abs(q - r) < 1e-9 ? ((r % 4) + 4) % 4 : null;
}

const LENGTH_DIMENSIONS: ReadonlySet<SketchConstraint['type']> = new Set(['distance', 'distanceX', 'distanceY', 'radius', 'diameter', 'arcLength']);
const SWAPPED: Partial<Record<SketchConstraint['type'], SketchConstraint['type']>> = { horizontal: 'vertical', vertical: 'horizontal', distanceX: 'distanceY', distanceY: 'distanceX' };
const PLAIN_NUMBER = /^\s*[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?\s*$/i;

/**
 * What a relation or dimension among the transformed entities becomes: the same; another (a turn of a quarter swaps horizontal and vertical, X and Y
 * distances); nothing (a turn by anything else than quarters: horizontal, vertical and X/Y distances no longer hold); a scaled length (a scale multiplies the
 * driving length dimensions; one given as an expression cannot be, and the scale is refused). A dimension's label goes with the entities.
 */
function carried(c: SketchConstraint, m: Transform2): { body: SketchConstraint } | 'drop' | { error: string } {
  let body = { ...c } as SketchConstraint & { value?: string; label?: string; labelPosition?: [number, number]; driving?: boolean };
  const swap = SWAPPED[c.type];
  if (swap) {
    const q = quarterTurns(m);
    if (q === null) return 'drop';
    if (q % 2 === 1) body = { ...body, type: swap } as typeof body;
  }
  if (m.kind === 'scale' && LENGTH_DIMENSIONS.has(c.type) && body.driving !== false) {
    const v = body.value;
    if (typeof v !== 'string' || !PLAIN_NUMBER.test(v)) return { error: t('sketch.xformScaleExpression', { name: body.label ?? c.id }) };
    // the full number, not rounded for display: the solver is to put the scaled entities exactly where the scale takes them
    body = { ...body, value: String(Number(v) * m.k) };
  }
  if (body.labelPosition) body = { ...body, labelPosition: applyTransform(m, body.labelPosition) };
  return { body };
}

/** The entities picked to be transformed, the points they move (their own and the selected points), and the stored entities by id. */
function transformSelection(sketch: Pick<SketchFeature, 'entities'>, entityIds: Id[]): { chosen: SketchEntity[]; points: Id[]; byId: Map<Id, SketchEntity> } | { error: string } {
  if (entityIds.some((id) => id === SKETCH_ORIGIN || isSketchAxis(id))) return error('sketch.xformOrigin');
  const wanted = new Set(entityIds);
  const chosen = sketch.entities.filter((e) => wanted.has(e.id));
  if (chosen.length === 0) return error('sketch.xformNothing');
  const points = [...new Set(chosen.flatMap((e) => (e.type === 'point' ? [e.id] : refsOf(e))))];
  return { chosen, points, byId: new Map(sketch.entities.map((e) => [e.id, e])) };
}

const followsModel = (e: SketchEntity | undefined): boolean => !!e && (('ref' in e && !!e.ref) || (e.type === 'point' && !!e.pierce));

/** Relations or dimensions get fresh ids of their own series, like the tools that make them. */
const freshConstraintId = (ids: IdAllocator, c: SketchConstraint): Id => ids.take(isDimension(c) ? 'd' : 'c');

function remapConstraint(c: SketchConstraint, map: ReadonlyMap<Id, Id>): SketchConstraint {
  const out = { ...c } as Record<string, unknown>;
  for (const f of REF_FIELDS) {
    const v = out[f];
    if (typeof v === 'string' && map.has(v)) out[f] = map.get(v);
  }
  return out as SketchConstraint;
}

/**
 * 移動／旋轉／縮放圖元 (ADR 0177), in place (`copy` false). The points of the selection go where the transform takes them (the targets);
 * circles, ellipses and texts scale, texts turn. Relations and dimensions:
 * - among the selection: kept, as `carried` says (rotate: horizontal and vertical; scale: lengths);
 * - between the selection and the rest, `keepRelations` on: kept (the solver then moves the rest with it as far as they say, or holds the selection back);
 *   off: deleted, and a point the selection shares with an entity that is not selected is split: the selection takes a new point, the rest keeps the old one,
 *   and so do the relations that only touch the old one.
 * A selected point is the selection's own: what uses it goes with it. Refused: a point with a fix relation, geometry that follows the model.
 */
function transformInPlace(
  sketch: Pick<SketchFeature, 'entities' | 'constraints'>,
  geometry: Geometry,
  ids: IdAllocator,
  entityIds: Id[],
  m: Transform2,
  keepRelations: boolean,
): TransformResult {
  const sel = transformSelection(sketch, entityIds);
  if ('error' in sel) return sel;
  const { chosen, points, byId } = sel;
  if (chosen.some(followsModel) || points.some((p) => followsModel(byId.get(p)))) return error('sketch.xformFollowsModel');
  const chosenIds = new Set(chosen.map((e) => e.id));
  const moved = new Set<Id>([...chosenIds, ...points]);
  const shared = new Set<Id>(
    keepRelations ? [] : points.filter((p) => !chosenIds.has(p) && sketch.entities.some((e) => !chosenIds.has(e.id) && refsOf(e).includes(p))),
  );
  const own = (r: Id) => moved.has(r) && !shared.has(r);
  if (sketch.constraints.some((c) => c.type === 'fix' && own(c.point))) return error('sketch.xformFixed');

  const posOf = (id: Id): P2 => {
    const g = geometry.get(id);
    const e = byId.get(id);
    return g?.type === 'point' ? g.p : e?.type === 'point' ? [e.x, e.y] : [0, 0];
  };
  const b = new Parts(ids);
  const split = new Map<Id, Id>();
  for (const p of shared) split.set(p, b.point(applyTransform(m, posOf(p))));
  const targets: PointPosition[] = [];
  const radii: CircleRadius[] = [];
  const place: SketchPlacement[] = [];
  const entities: NonNullable<SketchEdit['entities']> = [];
  for (const p of points) {
    if (shared.has(p)) continue;
    const [x, y] = applyTransform(m, posOf(p));
    place.push({ id: p, x, y });
    targets.push({ id: p, x, y });
  }
  for (const p of shared) {
    const e = b.entities.find((x) => x.id === split.get(p)) as Extract<SketchEntity, { type: 'point' }>;
    targets.push({ id: e.id, x: e.x, y: e.y });
  }
  const k = m.kind === 'scale' ? m.k : 1;
  const turn = m.kind === 'rotate' ? m.angle : 0;
  for (const e of chosen) {
    const g = geometry.get(e.id);
    if (e.type === 'circle') {
      const radius = (g?.type === 'circle' ? g.r : e.radius) * k;
      if (k !== 1) place.push({ id: e.id, radius });
      radii.push({ id: e.id, radius });
    } else if (e.type === 'ellipse' && k !== 1) place.push({ id: e.id, minorRadius: (g?.type === 'ellipse' ? g.minorRadius : e.minorRadius) * k });
    else if (e.type === 'text') place.push({ id: e.id, ...(k !== 1 ? { size: e.size * k } : {}), ...(turn !== 0 ? { angle: (e.angle ?? 0) + turn } : {}) });
    if (split.size === 0 || e.type === 'point') continue;
    const set: EntityRefs = {};
    if (e.type === 'spline') {
      if (e.points.some((p) => split.has(p))) set.points = e.points.map((p) => split.get(p) ?? p);
    } else {
      for (const field of ['p1', 'p2', 'start', 'end', 'center', 'at', 'major'] as const) {
        const v = (e as Partial<Record<typeof field, Id>>)[field];
        if (v !== undefined && split.has(v)) set[field] = split.get(v)!;
      }
    }
    if (Object.keys(set).length > 0) entities.push({ id: e.id, set });
  }

  const constraints: NonNullable<SketchEdit['constraints']> = [];
  const remove: Id[] = [];
  let removed = 0;
  for (const c of sketch.constraints) {
    const refs = constraintRefs(c);
    const mine = refs.some(own);
    if (!mine) continue; // the rest's (or only touches a point the rest keeps)
    const outside = refs.some((r) => !moved.has(r));
    if (outside) {
      if (!keepRelations) {
        remove.push(c.id);
        removed++;
      }
      continue;
    }
    const r = carried(remapConstraint(c, split), m);
    if (r === 'drop') {
      remove.push(c.id);
      removed++;
    } else if ('error' in r) return r;
    else if (r.body.type !== c.type) {
      // another kind of relation: the old one goes, a new one (with an id of its own) takes its place
      remove.push(c.id);
      b.constraints.push({ ...r.body, id: freshConstraintId(ids, r.body) });
    } else {
      const set: Record<string, unknown> = {};
      const before = c as unknown as Record<string, unknown>;
      const after = r.body as unknown as Record<string, unknown>;
      for (const f of [...REF_FIELDS, 'value', 'labelPosition']) if (after[f] !== before[f]) set[f] = after[f];
      if (Object.keys(set).length > 0) constraints.push({ id: c.id, set: set as NonNullable<SketchEdit['constraints']>[number]['set'] });
    }
  }
  return { edit: { entities, constraints, place, remove, add: b.added }, targets, radii, removed };
}

/**
 * Copies of the selection, one for each transform (複製圖元, 旋轉／縮放並複製, sketch patterns; ADR 0177). Each copy has points and curves of its own, free
 * geometry even where the original follows the model. With `keepRelations` the relations and dimensions among the selection are copied onto each copy (as
 * `carried` says); a fix relation and anything between the selection and the rest never are. Without it, the copies are bare geometry.
 */
function copies(sketch: Pick<SketchFeature, 'entities' | 'constraints'>, geometry: Geometry, ids: IdAllocator, entityIds: Id[], transforms: Transform2[], keepRelations: boolean): TransformResult {
  const sel = transformSelection(sketch, entityIds);
  if ('error' in sel) return sel;
  const { chosen, points, byId } = sel;
  const inside = new Set<Id>([...chosen.map((e) => e.id), ...points]);
  const internal = keepRelations ? sketch.constraints.filter((c) => c.type !== 'fix' && constraintRefs(c).length > 0 && constraintRefs(c).every((r) => inside.has(r))) : [];
  const posOf = (id: Id): P2 => {
    const g = geometry.get(id);
    const e = byId.get(id);
    return g?.type === 'point' ? g.p : e?.type === 'point' ? [e.x, e.y] : [0, 0];
  };
  const b = new Parts(ids);
  const targets: PointPosition[] = [];
  const radii: CircleRadius[] = [];
  for (const m of transforms) {
    const k = m.kind === 'scale' ? m.k : 1;
    const turn = m.kind === 'rotate' ? m.angle : 0;
    const twin = new Map<Id, Id>();
    for (const p of points) {
      const [x, y] = applyTransform(m, posOf(p));
      const id = ids.take('p');
      const construction = byId.get(p)?.construction;
      b.entities.push({ id, type: 'point', x, y, ...(construction ? { construction: true } : {}) });
      twin.set(p, id);
      targets.push({ id, x, y });
    }
    const pt = (p: Id) => twin.get(p)!;
    for (const e of chosen) {
      if (e.type === 'point') continue;
      const g = geometry.get(e.id);
      const construction = e.construction ? { construction: true } : {};
      let copy: SketchEntity;
      switch (e.type) {
        case 'line':
          copy = { id: ids.take('l'), type: 'line', p1: pt(e.p1), p2: pt(e.p2), ...construction };
          break;
        case 'arc':
          copy = { id: ids.take('a'), type: 'arc', center: pt(e.center), start: pt(e.start), end: pt(e.end), ...construction };
          break;
        case 'circle': {
          const radius = (g?.type === 'circle' ? g.r : e.radius) * k;
          copy = { id: ids.take('ci'), type: 'circle', center: pt(e.center), radius, ...construction };
          radii.push({ id: copy.id, radius });
          break;
        }
        case 'ellipse':
          copy = { id: ids.take('el'), type: 'ellipse', center: pt(e.center), major: pt(e.major), minorRadius: (g?.type === 'ellipse' ? g.minorRadius : e.minorRadius) * k, ...construction };
          break;
        case 'spline':
          copy = { id: ids.take('sp'), type: 'spline', points: e.points.map(pt), ...(e.closed ? { closed: true } : {}), ...construction };
          break;
        case 'text': {
          const { id: _old, at, size, angle, ...rest } = e;
          copy = { ...rest, id: ids.take('txt'), at: pt(at), size: size * k, ...(angle !== undefined || turn !== 0 ? { angle: (angle ?? 0) + turn } : {}) };
          break;
        }
      }
      b.entities.push(copy);
      twin.set(e.id, copy.id);
    }
    for (const c of internal) {
      const r = carried(remapConstraint(c, twin), m);
      if (r === 'drop') continue;
      if ('error' in r) return r;
      b.constraints.push({ ...r.body, id: freshConstraintId(ids, r.body) });
    }
  }
  return { edit: { add: b.added }, targets, radii, removed: 0 };
}

/** 移動／複製／旋轉／縮放圖元 (ADR 0177): see `transformInPlace` and `copies` for what happens to the relations. */
export function transformEntities(
  sketch: Pick<SketchFeature, 'entities' | 'constraints'>,
  geometry: Geometry,
  ids: IdAllocator,
  entityIds: Id[],
  m: Transform2,
  options: TransformOptions,
): TransformResult {
  const problem = transformProblem(m);
  if (problem) return { error: problem };
  return options.copy ? copies(sketch, geometry, ids, entityIds, [m], options.keepRelations) : transformInPlace(sketch, geometry, ids, entityIds, m, options.keepRelations);
}

/** Why a pattern cannot be made, or null; nothing is rounded or turned round to make it possible (AGENTS.md §2.1). */
export function patternProblem(spec: PatternSpec): string | null {
  if (!Number.isInteger(spec.count) || spec.count < 1 || spec.count > PATTERN_MAX) return t('sketch.patternCount', { max: PATTERN_MAX });
  if (spec.kind === 'linear') {
    if (!finiteP(spec.step)) return t('sketch.xformDistanceInvalid');
    return Math.hypot(spec.step[0], spec.step[1]) < TINY ? t('sketch.patternNoStep') : null;
  }
  if (!finiteP(spec.c)) return t('sketch.xformPointInvalid');
  if (!Number.isFinite(spec.angle) || spec.angle === 0 || Math.abs(spec.angle) > 360) return t('sketch.patternAngle');
  return null;
}

/** The transform of each copy of a pattern, the first copy first. */
export function patternTransforms(spec: PatternSpec): Transform2[] {
  return Array.from({ length: spec.count }, (_, j): Transform2 => {
    const i = j + 1;
    if (spec.kind === 'linear') return { kind: 'translate', d: [spec.step[0] * i, spec.step[1] * i] };
    const each = Math.abs(spec.angle) === 360 ? spec.angle / (spec.count + 1) : spec.angle / spec.count;
    return { kind: 'rotate', c: spec.c, angle: each * i };
  });
}

/** 線性／環狀草圖陣列 (ADR 0177): copies of the selection, as `copies` makes them. */
export function patternEntities(
  sketch: Pick<SketchFeature, 'entities' | 'constraints'>,
  geometry: Geometry,
  ids: IdAllocator,
  entityIds: Id[],
  spec: PatternSpec,
  keepRelations: boolean,
): TransformResult {
  const problem = patternProblem(spec);
  if (problem) return { error: problem };
  return copies(sketch, geometry, ids, entityIds, patternTransforms(spec), keepRelations);
}
