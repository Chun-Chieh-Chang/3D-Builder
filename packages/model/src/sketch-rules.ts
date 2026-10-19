import { t } from '@3db/i18n';
import type { Id } from './ids';
import { isSketchAxis, SKETCH_ORIGIN, type PartDoc, type Ref, type SketchConstraint, type SketchEntity, type SketchFeature } from './schema';

/**
 * Structural rules of a sketch (B1.2): which entities a relation or dimension may reference, and
 * what disappears together when something is deleted. Commands use these rules so an invalid
 * sketch can never enter the document; the solver only has to map a valid one.
 */

export type EntityKind = SketchEntity['type'];
/** `axis`: one of the sketch's two axes (ADR 0170), an infinite line through the origin that never moves. */
type RefKind = EntityKind | 'origin' | 'axis';

const POINT: RefKind[] = ['point', 'origin'];
const LINE: RefKind[] = ['line'];
/** A line, or a sketch axis where a fixed infinite line means something. */
const LINE_OR_AXIS: RefKind[] = ['line', 'axis'];
const RADIAL: RefKind[] = ['circle', 'arc'];
const CURVE: RefKind[] = ['line', 'circle', 'arc'];
const CURVE_OR_AXIS: RefKind[] = ['line', 'circle', 'arc', 'axis'];
/** Points, or circles/arcs measured from their centers (as SolidWorks does). */
const ANCHOR: RefKind[] = ['point', 'origin', 'circle', 'arc'];
const ANY: RefKind[] = ['point', 'origin', 'line', 'circle', 'arc', 'axis'];

const REF_FIELDS = ['a', 'b', 'point', 'line', 'curve', 'axis', 'circle'] as const;
type RefField = (typeof REF_FIELDS)[number];

/** Constraint types whose second reference is optional (one entity, or a pair). */
const OPTIONAL_B = new Set<SketchConstraint['type']>(['distance', 'horizontal', 'vertical']);

const RULES: { [T in SketchConstraint['type']]: Partial<Record<RefField, RefKind[]>> } = {
  coincident: { a: POINT, b: POINT },
  horizontal: { a: ['line', 'point', 'origin'], b: POINT },
  vertical: { a: ['line', 'point', 'origin'], b: POINT },
  collinear: { a: LINE_OR_AXIS, b: LINE_OR_AXIS },
  parallel: { a: LINE_OR_AXIS, b: LINE_OR_AXIS },
  perpendicular: { a: LINE_OR_AXIS, b: LINE_OR_AXIS },
  tangent: { a: CURVE_OR_AXIS, b: CURVE_OR_AXIS },
  concentric: { a: RADIAL, b: RADIAL },
  coradial: { a: RADIAL, b: RADIAL },
  intersection: { point: POINT, a: CURVE_OR_AXIS, b: CURVE_OR_AXIS },
  equal: { a: CURVE, b: CURVE },
  midpoint: { point: POINT, line: ['line', 'arc'] },
  pointOnCurve: { point: POINT, curve: CURVE_OR_AXIS },
  symmetric: { a: POINT, b: POINT, axis: LINE_OR_AXIS },
  fix: { point: ['point'] },
  distance: { a: ANY, b: ANY },
  distanceX: { a: ANCHOR, b: ANCHOR },
  distanceY: { a: ANCHOR, b: ANCHOR },
  radius: { circle: RADIAL },
  diameter: { circle: RADIAL },
  arcLength: { circle: ['arc'] },
  angle: { a: LINE_OR_AXIS, b: LINE_OR_AXIS },
};

/** Ids a relation or dimension refers to. */
export function constraintRefs(c: SketchConstraint): Id[] {
  const out: Id[] = [];
  for (const f of REF_FIELDS) {
    const v = (c as Partial<Record<RefField, Id>>)[f];
    if (v !== undefined) out.push(v);
  }
  return out;
}

/** The model element an entity follows (C1.18, ADR 0171): a point's pierce edge or vertex, a curve's edge; undefined for one of the sketch's own. */
export function modelRefOf(e: SketchEntity): Ref | undefined {
  if (e.type === 'point') return e.pierce ?? e.ref;
  return 'ref' in e ? e.ref : undefined;
}

/** Point ids an entity is built on. */
export function entityPoints(e: SketchEntity): Id[] {
  switch (e.type) {
    case 'point':
      return [];
    case 'line':
      return [e.p1, e.p2];
    case 'circle':
      return [e.center];
    case 'arc':
      return [e.center, e.start, e.end];
    case 'ellipse':
      return [e.center, e.major];
    case 'spline':
      return e.points;
    case 'text':
      return [e.at];
  }
}

/** Every id in use in the document: features, and the entities and constraints inside sketches. */
export function idsInUse(doc: PartDoc): Id[] {
  const out: Id[] = [];
  for (const f of doc.features) {
    out.push(f.id);
    if (f.type === 'sketch') {
      for (const e of f.entities) out.push(e.id);
      for (const c of f.constraints) out.push(c.id);
      for (const p of f.pictures ?? []) out.push(p.id);
    }
  }
  for (const b of doc.blobs) out.push(b.id);
  for (const v of doc.variables) out.push(v.id);
  return out;
}

const finite = (...xs: number[]) => xs.every(Number.isFinite);

/**
 * Checks a whole sketch: unique ids, entities built on existing points, every relation and
 * dimension referencing entities of an allowed kind. Returns the first problem, or null.
 */
export function sketchError(sketch: Pick<SketchFeature, 'entities' | 'constraints'>): string | null {
  const kinds = new Map<Id, EntityKind>();
  for (const e of sketch.entities) {
    if (e.id === SKETCH_ORIGIN || isSketchAxis(e.id) || kinds.has(e.id)) return t('rules.dupEntity', { id: e.id });
    kinds.set(e.id, e.type);
  }
  const kindOf = (id: Id): RefKind | undefined => (id === SKETCH_ORIGIN ? 'origin' : isSketchAxis(id) ? 'axis' : kinds.get(id));
  const byId = new Map(sketch.entities.map((e) => [e.id, e]));

  for (const e of sketch.entities) {
    const pts = entityPoints(e);
    if (pts.some((p) => kinds.get(p) !== 'point')) return t('rules.missingPoint', { id: e.id });
    if (new Set(pts).size !== pts.length) return t('rules.dupEnd', { id: e.id });
    if (e.type === 'point' && !finite(e.x, e.y)) return t('cmd.pointCoordinateInvalid', { id: e.id });
    if (e.type === 'circle' && !(finite(e.radius) && e.radius > 0)) return t('cmd.radiusMustBePositive', { id: e.id });
    if (e.type === 'ellipse' && !(finite(e.minorRadius) && e.minorRadius > 0)) return t('cmd.radiusMustBePositive', { id: e.id });
    if (e.type === 'spline') {
      if (e.points.length < 2) return t('rules.splinePointsMin', { id: e.id });
      if (e.closed && e.points.length < 3) return t('rules.splineClosedMin', { id: e.id });
    }
    if (e.type === 'text') {
      if (!e.text || typeof e.text !== 'string' || e.text.trim().length === 0) return t('rules.textEmpty', { id: e.id });
      if (!(finite(e.size) && e.size > 0)) return t('rules.textSizeInvalid', { id: e.id });
      if (e.angle !== undefined && !Number.isFinite(e.angle)) return t('rules.textAngleInvalid', { id: e.id });
    }
    // what an entity follows on the model (C1.18, ADR 0171): a point pierces an edge or is a vertex, never both; a curve follows an edge
    if (e.type === 'point') {
      if (e.pierce && e.ref) return t('rules.pointFollowsTwo', { id: e.id });
      if (e.pierce && e.pierce.kind !== 'edge') return t('cmd.sketchRefMustBeEdge', { id: e.id });
      if (e.ref && e.ref.kind !== 'vertex' && e.ref.kind !== 'datum') return t('cmd.sketchPointRefMustBeVertex', { id: e.id });
    } else if ('ref' in e && e.ref && e.ref.kind !== 'edge' && !(e.type === 'line' && e.ref.kind === 'datum')) return t('cmd.sketchRefMustBeEdge', { id: e.id });
  }

  const seen = new Set<Id>(kinds.keys());
  for (const c of sketch.constraints) {
    if (c.id === SKETCH_ORIGIN || isSketchAxis(c.id) || seen.has(c.id)) return t('rules.dupId', { id: c.id });
    seen.add(c.id);
    const rule = RULES[c.type];
    if (!rule) return t('rules.unsupported', { type: (c as { type: string }).type });
    for (const field of REF_FIELDS) {
      const ref = (c as Partial<Record<RefField, Id>>)[field];
      const allowed = rule[field];
      if (ref === undefined) {
        if (allowed && !(field === 'b' && OPTIONAL_B.has(c.type))) return t('rules.missingRef', { id: c.id });
        continue;
      }
      if (!allowed) return t('rules.extraRef', { id: c.id });
      const k = kindOf(ref);
      if (!k || !allowed.includes(k)) return t('rules.badRef', { id: c.id, ref });
    }
    const refs = constraintRefs(c);
    if (new Set(refs).size !== refs.length) return t('rules.sameTwice', { id: c.id });
    const ks = refs.map(kindOf);
    // the two axes are always square to each other through the origin: any relation between them is redundant or conflicting
    if (ks.filter((k) => k === 'axis').length > 1) return t('rules.axisPair', { id: c.id });
    const straight = (k: RefKind | undefined) => k === 'line' || k === 'axis';
    if (c.type === 'tangent' && straight(ks[0]) && straight(ks[1])) return t('rules.tangentNeedsCurve');
    if (c.type === 'equal' && (ks[0] === 'line') !== (ks[1] === 'line')) return t('rules.equalKinds');
    if (c.type === 'distance' && c.b === undefined && ks[0] !== 'line') return t('rules.distanceLine');
    // the middle of an arc cannot be one of its own points (an end, or its center): no arc would satisfy it. Only arcs (schema 56): a line's own end was
    // never refused, and every edit checks the whole sketch, so refusing it now could leave an old sketch that cannot be changed
    if (c.type === 'midpoint') {
      const host = byId.get(c.line);
      if (host?.type === 'arc' && entityPoints(host).includes(c.point)) return t('rules.midpointOwnPoint', { id: c.id });
    }
    if ((c.type === 'horizontal' || c.type === 'vertical') && (c.b === undefined) !== (ks[0] === 'line')) {
      return t('rules.horizontalVertical');
    }
  }
  return null;
}

/**
 * Everything deleted together with `ids`: curves built on a deleted point, the endpoints only a
 * deleted curve used, and every relation or dimension referring to something deleted.
 */
export function removalSet(sketch: SketchFeature, ids: Iterable<Id>): Set<Id> {
  const removed = new Set(ids);
  for (let changed = true; changed; ) {
    changed = false;
    const add = (id: Id) => {
      if (!removed.has(id)) {
        removed.add(id);
        changed = true;
      }
    };
    for (const e of sketch.entities) {
      if (!removed.has(e.id) && entityPoints(e).some((p) => removed.has(p))) add(e.id);
    }
    const usedByKept = new Set(sketch.entities.filter((e) => !removed.has(e.id)).flatMap(entityPoints));
    for (const e of sketch.entities) {
      if (!removed.has(e.id)) continue;
      for (const p of entityPoints(e)) if (!usedByKept.has(p)) add(p);
    }
    for (const c of sketch.constraints) {
      if (!removed.has(c.id) && constraintRefs(c).some((r) => removed.has(r))) add(c.id);
    }
  }
  return removed;
}
