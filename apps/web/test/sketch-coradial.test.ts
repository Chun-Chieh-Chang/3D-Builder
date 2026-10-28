/**
 * 「同心」 and 「同心同徑」 on two circles whose centers are already one point (ADR 0213), through the real SketchController and solver. The sketch of the
 * report: a circle drawn from the center of another shares that point, and the solver called the relation over-defined, since it asked the point to meet
 * itself. Truth by hand: what already holds is not asked again; what does not is.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { t } from '@3db/i18n';
import { applyCommand, createEmptyPart, DocHistory, resolveSketch, type SketchConstraint, type SketchEntity, type SketchFeature } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { SketchController, type SketchHost } from '../src/sketcher/controller';
import { relationsOffered } from '../src/sketcher/relationsOffered';

let solver: PlaneGcsSolver;
beforeAll(async () => {
  solver = await PlaneGcsSolver.create();
});

function session() {
  const feature: SketchFeature = { id: 's', type: 'sketch', name: 's', suppressed: false, plane: { kind: 'datum', name: 'plane:front' }, entities: [], constraints: [] };
  const history = new DocHistory(applyCommand(createEmptyPart(), { type: 'insertFeature', index: 0, feature }));
  const sketch = () => history.doc.features[0] as SketchFeature;
  const solve = (s: SketchFeature = sketch(), options?: unknown) => ({ ...solver.solve(resolveSketch(s, history.doc), { analyze: true, ...(options as object) }), seq: 0, ms: 0, problems: [] });
  const notices: string[] = [];
  const host: SketchHost = {
    featureId: 's',
    doc: () => history.doc,
    solved: () => solve(),
    execute: (c) => {
      try {
        history.execute(c);
        return true;
      } catch (e) {
        notices.push(`REFUSED ${(e as Error).message}`);
        return false;
      }
    },
    trial: async (s, _d, options) => solve(s, options),
    dragPreview: () => {},
    notify: (m) => void notices.push(m),
    editDimension: () => {},
  };
  const controller = new SketchController(host);
  const add = (entities: SketchEntity[], constraints: SketchConstraint[] = []) => history.execute({ type: 'addSketchItems', featureId: 's', entities, constraints });
  return { history, sketch, solve, notices, controller, add };
}
type S = ReturnType<typeof session>;
const point = (id: string, x: number, y: number): SketchEntity => ({ id, type: 'point', x, y });
const circle = (id: string, center: string, radius: number): SketchEntity => ({ id, type: 'circle', center, radius });
const offered = (S: S, ids: string[]) => relationsOffered(S.sketch(), S.solve(), ids).offered.map((r) => r.type);
const press = async (S: S, ids: string[], type: string) => {
  S.controller.select(ids, false);
  const body = relationsOffered(S.sketch(), S.solve(), ids).offered.find((r) => r.type === type);
  if (!body) throw new Error(`${type} not offered for ${ids}: ${offered(S, ids)}`);
  const before = S.sketch().constraints.length;
  const ok = await S.controller.addRelation(body);
  return { ok, added: S.sketch().constraints.slice(before) };
};
const circleOf = (S: S, id: string) => {
  const g = S.solve().geometry.get(id);
  if (g?.type !== 'circle') throw new Error(`no circle ${id}`);
  return g;
};
const apart = (S: S, a: string, b: string) => Math.hypot(circleOf(S, a).c[0] - circleOf(S, b).c[0], circleOf(S, a).c[1] - circleOf(S, b).c[1]);

describe('同心 and 同心同徑 on two circles', () => {
  it('two circles on one center point: 同心 is not offered (it already holds); 同心同徑 adds the equal radius only, and the circles then have one radius', async () => {
    const S = session();
    S.add([point('p1', 0, 0), circle('c1', 'p1', 30), circle('c2', 'p1', 25)], [{ id: 'k0', type: 'coincident', a: 'p1', b: '@origin' }]);
    expect(offered(S, ['c1', 'c2'])).not.toContain('concentric');
    expect(offered(S, ['c1', 'c2'])).toContain('coradial');
    const r = await press(S, ['c1', 'c2'], 'coradial');
    expect(r.ok).toBe(true);
    expect(r.added.map((c) => c.type)).toEqual(['equal']);
    expect(circleOf(S, 'c1').r).toBeCloseTo(circleOf(S, 'c2').r, 9);
    expect(apart(S, 'c1', 'c2')).toBeCloseTo(0, 9);
    expect(S.solve().status).not.toBe('over');
  });

  it('two circles on two center points, apart and of different size: 同心同徑 is the one relation, and the circles then share center and radius', async () => {
    const S = session();
    S.add([point('p1', 0, 0), point('p2', 7, 3), circle('c1', 'p1', 30), circle('c2', 'p2', 12)]);
    expect(offered(S, ['c1', 'c2'])).toContain('concentric');
    const r = await press(S, ['c1', 'c2'], 'coradial');
    expect(r.ok).toBe(true);
    expect(r.added.map((c) => c.type)).toEqual(['coradial']);
    expect(circleOf(S, 'c1').r).toBeCloseTo(circleOf(S, 'c2').r, 9);
    expect(apart(S, 'c1', 'c2')).toBeCloseTo(0, 9);
  });

  it('centers tied by a coincident relation (two points, not one): 同心 is not offered, 同心同徑 adds the equal radius only', async () => {
    const S = session();
    S.add([point('p1', 0, 0), point('p2', 0, 0), circle('c1', 'p1', 30), circle('c2', 'p2', 25)], [{ id: 'k1', type: 'coincident', a: 'p1', b: 'p2' }]);
    expect(offered(S, ['c1', 'c2'])).not.toContain('concentric');
    const r = await press(S, ['c1', 'c2'], 'coradial');
    expect(r.ok).toBe(true);
    expect(r.added.map((c) => c.type)).toEqual(['equal']);
  });

  it('radii already equal by a relation, centers apart: 同心同徑 adds the concentric part only', async () => {
    const S = session();
    S.add([point('p1', 0, 0), point('p2', 7, 3), circle('c1', 'p1', 20), circle('c2', 'p2', 20)], [{ id: 'k1', type: 'equal', a: 'c1', b: 'c2' }]);
    const r = await press(S, ['c1', 'c2'], 'coradial');
    expect(r.ok).toBe(true);
    expect(r.added.map((c) => c.type)).toEqual(['concentric']);
    expect(apart(S, 'c1', 'c2')).toBeCloseTo(0, 9);
  });

  it('both already hold: neither 同心 nor 同心同徑 is offered', async () => {
    const S = session();
    S.add([point('p1', 0, 0), circle('c1', 'p1', 20), circle('c2', 'p1', 20)], [{ id: 'k1', type: 'equal', a: 'c1', b: 'c2' }]);
    const o = offered(S, ['c1', 'c2']);
    expect(o).not.toContain('concentric');
    expect(o).not.toContain('coradial');
  });

  it('an arc and a circle on one center point: 同心同徑 adds the equal radius only', async () => {
    const S = session();
    S.add([point('p1', 0, 0), point('a1', 10, 0), point('a2', 0, 10), circle('c1', 'p1', 14), { id: 'r1', type: 'arc', center: 'p1', start: 'a1', end: 'a2' } as SketchEntity]);
    expect(offered(S, ['c1', 'r1'])).not.toContain('concentric');
    const r = await press(S, ['c1', 'r1'], 'coradial');
    expect(r.ok).toBe(true);
    expect(r.added.map((c) => c.type)).toEqual(['equal']);
  });

  it('three circles on one center: 同心同徑 still works (it did before)', async () => {
    const S = session();
    S.add([point('p1', 0, 0), circle('c1', 'p1', 30), circle('c2', 'p1', 25), circle('c3', 'p1', 20)]);
    const r = await press(S, ['c1', 'c2', 'c3'], 'coradial');
    expect(r.ok).toBe(true);
    expect(circleOf(S, 'c1').r).toBeCloseTo(circleOf(S, 'c3').r, 9);
  });

  it('150 random pairs: whatever holds already is never asked again, what is asked is accepted, and afterwards the circles share center and radius', async () => {
    let seed = 20261028;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    let both = 0;
    let centerOnly = 0;
    let radiusOnly = 0;
    let none = 0;
    for (let i = 0; i < 150; i++) {
      const S = session();
      const sharedCenter = rnd() < 0.4;
      const tiedCenters = !sharedCenter && rnd() < 0.3;
      const equalRadii = rnd() < 0.4;
      const [r1, r2] = [5 + rnd() * 40, 5 + rnd() * 40];
      const entities: SketchEntity[] = [point('p1', rnd() * 20, rnd() * 20)];
      const constraints: SketchConstraint[] = [];
      if (!sharedCenter) entities.push(point('p2', tiedCenters ? (entities[0] as { x: number }).x : rnd() * 20, tiedCenters ? (entities[0] as { y: number }).y : rnd() * 20));
      entities.push(circle('c1', 'p1', r1), circle('c2', sharedCenter ? 'p1' : 'p2', equalRadii ? r1 : r2));
      if (tiedCenters) constraints.push({ id: 'k1', type: 'coincident', a: 'p1', b: 'p2' });
      if (equalRadii) constraints.push({ id: 'k2', type: 'equal', a: 'c1', b: 'c2' });
      S.add(entities, constraints);
      const o = offered(S, ['c1', 'c2']);
      const centerHolds = sharedCenter || tiedCenters;
      expect(o.includes('concentric'), `case ${i}: concentric offered only when the centers are not one`).toBe(!centerHolds);
      expect(o.includes('coradial'), `case ${i}: coradial offered unless both hold`).toBe(!(centerHolds && equalRadii));
      if (centerHolds && equalRadii) {
        both++;
        continue;
      }
      if (centerHolds) centerOnly++;
      else if (equalRadii) radiusOnly++;
      else none++;
      const r = await press(S, ['c1', 'c2'], 'coradial');
      expect(r.ok, `case ${i}: ${S.notices.join('; ')}`).toBe(true);
      expect(S.solve().status, `case ${i}`).not.toBe('over');
      expect(circleOf(S, 'c1').r, `case ${i}`).toBeCloseTo(circleOf(S, 'c2').r, 8);
      expect(apart(S, 'c1', 'c2'), `case ${i}`).toBeLessThan(1e-8);
    }
    // not a run in which a branch never happened
    for (const n of [both, centerOnly, radiusOnly, none]) expect(n).toBeGreaterThan(10);
  });
});

describe('a relation that is refused says why', () => {
  it('one that already follows from the others says so, and is not called over-defined', async () => {
    const S = session();
    S.add(
      [point('p1', 0, 0), point('p2', 10, 0), point('p3', 20, 0), point('p4', 30, 5)],
      [
        { id: 'k1', type: 'horizontal', a: 'p1', b: 'p2' },
        { id: 'k2', type: 'horizontal', a: 'p2', b: 'p3' },
      ],
    );
    const r = await press(S, ['p1', 'p3'], 'horizontal');
    expect(r.ok).toBe(false);
    expect(r.added).toHaveLength(0);
    expect(S.notices).toContain(t('sketch.relationImplied'));
    expect(S.notices).not.toContain(t('sketch.overDefinedRelation'));
  });

  it('one that contradicts the others is still called over-defined: two circles of 20 and 30 cannot be equal', async () => {
    const S = session();
    S.add(
      [point('p1', 0, 0), point('p2', 50, 0), circle('c1', 'p1', 10), circle('c2', 'p2', 15)],
      [
        { id: 'k1', type: 'diameter', circle: 'c1', value: '20' },
        { id: 'k2', type: 'diameter', circle: 'c2', value: '30' },
      ],
    );
    const r = await press(S, ['c1', 'c2'], 'equal');
    expect(r.ok).toBe(false);
    expect(S.notices).toContain(t('sketch.overDefinedRelation'));
    expect(S.notices).not.toContain(t('sketch.relationImplied'));
  });
});
