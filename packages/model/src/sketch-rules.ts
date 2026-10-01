import { t } from '@3db/i18n';
import type { Id } from './ids';
import { isDimension, SKETCH_ORIGIN, type PartDoc, type SketchConstraint, type SketchEntity, type SketchFeature } from './schema';

/**
 * Structural rules of a sketch (B1.2): which entities a relation or dimension may reference, and
 * what disappears together when something is deleted. Commands use these rules so an invalid
 * sketch can never enter the document; the solver only has to map a valid one.
 */

export type EntityKind = SketchEntity['type'];
type RefKind = EntityKind | 'origin';

const POINT: RefKind[] = ['point', 'origin'];
const LINE: RefKind[] = ['line'];
const RADIAL: RefKind[] = ['circle', 'arc'];
const CURVE: RefKind[] = ['line', 'circle', 'arc'];
/** Points, or circles/arcs measured from their centers (as SolidWorks does). */
const ANCHOR: RefKind[] = ['point', 'origin', 'circle', 'arc'];
const ANY: RefKind[] = ['point', 'origin', 'line', 'circle', 'arc'];

const REF_FIELDS = ['a', 'b', 'point', 'line', 'curve', 'axis', 'circle'] as const;
type RefField = (typeof REF_FIELDS)[number];

/** Constraint types whose second reference is optional (one entity, or a pair). */
const OPTIONAL_B = new Set<SketchConstraint['type']>(['distance', 'horizontal', 'vertical']);

const RULES: { [T in SketchConstraint['type']]: Partial<Record<RefField, RefKind[]>> } = {
  coincident: { a: POINT, b: POINT },
  horizontal: { a: ['line', 'point', 'origin'], b: POINT },
  vertical: { a: ['line', 'point', 'origin'], b: POINT },
  collinear: { a: LINE, b: LINE },
  parallel: { a: LINE, b: LINE },
  perpendicular: { a: LINE, b: LINE },
  tangent: { a: CURVE, b: CURVE },
  concentric: { a: RADIAL, b: RADIAL },
  coradial: { a: RADIAL, b: RADIAL },
  intersection: { point: POINT, a: CURVE, b: CURVE },
  equal: { a: CURVE, b: CURVE },
  midpoint: { point: POINT, line: LINE },
  pointOnCurve: { point: POINT, curve: CURVE },
  symmetric: { a: POINT, b: POINT, axis: LINE },
  fix: { point: ['point'] },
  distance: { a: ANY, b: ANY },
  distanceX: { a: ANCHOR, b: ANCHOR },
  distanceY: { a: ANCHOR, b: ANCHOR },
  radius: { circle: RADIAL },
  diameter: { circle: RADIAL },
  arcLength: { circle: ['arc'] },
  angle: { a: LINE, b: LINE },
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
    if (e.id === SKETCH_ORIGIN || kinds.has(e.id)) return t('rules.dupEntity', { id: e.id });
    kinds.set(e.id, e.type);
  }
  const kindOf = (id: Id): RefKind | undefined => (id === SKETCH_ORIGIN ? 'origin' : kinds.get(id));

  for (const e of sketch.entities) {
    const pts = entityPoints(e);
    if (pts.some((p) => kinds.get(p) !== 'point')) return t('rules.missingPoint', { id: e.id });
    if (new Set(pts).size !== pts.length) return t('rules.dupEnd', { id: e.id });
    if (e.type === 'point' && !finite(e.x, e.y)) return t('cmd.pointCoordinateInvalid', { id: e.id });
    if (e.type === 'circle' && !(finite(e.radius) && e.radius > 0)) return t('cmd.radiusMustBePositive', { id: e.id });
    const model = e.type === 'point' ? e.pierce : e.ref;
    if (model && model.kind !== 'edge') return t('cmd.sketchRefMustBeEdge', { id: e.id });
  }

  const seen = new Set<Id>(kinds.keys());
  for (const c of sketch.constraints) {
    if (c.id === SKETCH_ORIGIN || seen.has(c.id)) return t('rules.dupId', { id: c.id });
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
    if (c.type === 'tangent' && ks[0] === 'line' && ks[1] === 'line') return t('rules.tangentNeedsCurve');
    if (c.type === 'equal' && (ks[0] === 'line') !== (ks[1] === 'line')) return t('rules.equalKinds');
    if (c.type === 'distance' && c.b === undefined && ks[0] !== 'line') return t('rules.distanceLine');
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
