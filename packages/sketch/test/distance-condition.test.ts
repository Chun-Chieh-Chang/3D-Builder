/**
 * The nearest and the farthest distance of a circle or an arc (ADR 0183, Schema 75): circle to circle, point to circle, line to circle. Truth by hand: two
 * circles of radius 10 and 5 with a gap of 5 between them are 20 apart from center to center, 15 when the farthest points are 30 apart (30 = 15 + 10 + 5);
 * a point 5 from a circle of radius 10 is 15 from its center, 20 when the farthest point of the circle is 30 away. The nearest is the solver's own relation,
 * the farthest is made of a helper point; the random cases below hold both to the same formulas written out here, in the two directions the solver has to
 * go (a sketch already where its value says: nothing moves; a value changed: the measured distance is the new one).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { t } from '@3db/i18n';
import { applyCommand, createEmptyPart, resolveSketch, sketchError, SKETCH_ORIGIN, type Command, type DimensionConstraint, type PartDoc, type SketchConstraint, type SketchEntity, type SketchFeature } from '@3db/model';
import { PlaneGcsSolver, type SolvedSketch } from '../src/index';
import { conditionEnds, measure } from '../src/interact';

let solver: PlaneGcsSolver;
beforeAll(async () => {
  solver = await PlaneGcsSolver.create();
});

const EMPTY: Command = {
  type: 'insertFeature',
  index: 0,
  feature: { id: 's1', type: 'sketch', name: '草圖1', suppressed: false, plane: { kind: 'datum', name: 'plane:front' }, entities: [], constraints: [] },
};
const start = (entities: SketchEntity[], constraints: SketchConstraint[] = []): PartDoc =>
  applyCommand(applyCommand(createEmptyPart(), EMPTY), { type: 'addSketchItems', featureId: 's1', entities, constraints });
const sketchOf = (doc: PartDoc) => doc.features.find((f) => f.id === 's1') as SketchFeature;
const solve = (doc: PartDoc): SolvedSketch => solver.solve(resolveSketch(sketchOf(doc), doc), { analyze: true });
const at = (s: SolvedSketch, id: string) => {
  const g = s.geometry.get(id);
  if (g?.type !== 'point') throw new Error(`no point ${id}`);
  return g.p;
};

type Kind = 'cc' | 'ac' | 'ca' | 'pc' | 'lc';
type Cond = 'min' | 'max';
interface Case {
  kind: Kind;
  cond: Cond;
  /** The fixed circle (or arc) of radius R1 about the origin; for `lc` the fixed line is y = h. */
  R1: number;
  /** The circle (or arc) that moves, radius R2, its center on the x axis at `x` (for `lc`: at x with y = yc). */
  R2: number;
  x: number;
  yc: number;
  h: number;
}
const dimension = (c: Case, value: number): DimensionConstraint => {
  const [a, b] = c.kind === 'lc' ? ['L', 'K2'] : c.kind === 'pc' ? ['K1', 'p'] : ['K1', 'K2'];
  return { id: 'D', type: 'distance', a, b, value: String(value), condition: c.cond };
};
/** The sketch of a case: everything defined but the one thing the condition's dimension says. */
function docFor(c: Case, value: number): PartDoc {
  const fixedCircle: SketchEntity[] = [{ id: 'c1', type: 'point', x: 0, y: 0 }, { id: 'K1', type: 'circle', center: 'c1', radius: c.R1 }];
  const fixedCircleRel: SketchConstraint[] = [{ id: 'f1', type: 'fix', point: 'c1' }, { id: 'r1', type: 'radius', circle: 'K1', value: String(c.R1) }];
  const level: SketchConstraint = { id: 'lv', type: 'horizontal', a: 'c1', b: 'c2' };
  const D = dimension(c, value);
  switch (c.kind) {
    case 'cc':
      return start([...fixedCircle, { id: 'c2', type: 'point', x: c.x, y: 0 }, { id: 'K2', type: 'circle', center: 'c2', radius: c.R2 }], [...fixedCircleRel, level, { id: 'r2', type: 'radius', circle: 'K2', value: String(c.R2) }, D]);
    case 'ac':
      // the fixed one is an arc (a quarter turn, held whole by 「固定」: three fixed points would be one relation too many), the circle moves
      return start(
        [
          { id: 'c1', type: 'point', x: 0, y: 0 },
          { id: 'st1', type: 'point', x: c.R1, y: 0 },
          { id: 'en1', type: 'point', x: 0, y: c.R1 },
          { id: 'K1', type: 'arc', center: 'c1', start: 'st1', end: 'en1' },
          { id: 'c2', type: 'point', x: c.x, y: 0 },
          { id: 'K2', type: 'circle', center: 'c2', radius: c.R2 },
        ],
        [{ id: 'bk', type: 'block', entity: 'K1' }, level, { id: 'r2', type: 'radius', circle: 'K2', value: String(c.R2) }, D],
      );
    case 'ca':
      // the circle is fixed, the arc moves: its start level with its center, its end above it
      return start(
        [
          ...fixedCircle,
          { id: 'c2', type: 'point', x: c.x, y: 0 },
          { id: 'st2', type: 'point', x: c.x + c.R2, y: 0 },
          { id: 'en2', type: 'point', x: c.x, y: c.R2 },
          { id: 'K2', type: 'arc', center: 'c2', start: 'st2', end: 'en2' },
        ],
        [...fixedCircleRel, level, { id: 'r2', type: 'radius', circle: 'K2', value: String(c.R2) }, { id: 'hs', type: 'horizontal', a: 'c2', b: 'st2' }, { id: 've', type: 'vertical', a: 'c2', b: 'en2' }, D],
      );
    case 'pc':
      return start([...fixedCircle, { id: 'p', type: 'point', x: c.x, y: 0 }], [...fixedCircleRel, { id: 'lv', type: 'horizontal', a: 'c1', b: 'p' }, D]);
    case 'lc':
      return start(
        [
          { id: 'a', type: 'point', x: -30, y: c.h },
          { id: 'b', type: 'point', x: 30, y: c.h },
          { id: 'L', type: 'line', p1: 'a', p2: 'b' },
          { id: 'c2', type: 'point', x: c.x, y: c.yc },
          { id: 'K2', type: 'circle', center: 'c2', radius: c.R2 },
        ],
        [{ id: 'fa', type: 'fix', point: 'a' }, { id: 'fb', type: 'fix', point: 'b' }, { id: 'dx', type: 'distanceX', a: SKETCH_ORIGIN, b: 'c2', value: String(Math.abs(c.x)) }, { id: 'r2', type: 'radius', circle: 'K2', value: String(c.R2) }, D],
      );
  }
}
/** The distance the formulas give for a case as it is stored (written out by hand, not by the code under test). */
function truth(c: Case, cond: Cond): number {
  if (c.kind === 'lc') {
    const d = Math.abs(c.yc - c.h);
    return cond === 'max' ? d + c.R2 : d - c.R2;
  }
  const d = Math.abs(c.x);
  if (c.kind === 'pc') return cond === 'max' ? d + c.R1 : Math.abs(d - c.R1);
  if (cond === 'max') return d + c.R1 + c.R2;
  if (d >= c.R1 + c.R2) return d - c.R1 - c.R2;
  return d + c.R2 <= c.R1 ? c.R1 - c.R2 - d : c.R2 - c.R1 - d;
}
const moved = (s: SolvedSketch, c: Case): [number, number] => at(s, c.kind === 'pc' ? 'p' : 'c2');

describe('the nearest and the farthest of two circles (by hand)', () => {
  const base: Omit<Case, 'cond' | 'x'> = { kind: 'cc', R1: 10, R2: 5, yc: 0, h: 0 };
  it('radius 10 and 5, a gap of 5: 20 center to center; the farthest points 30 apart: 15', () => {
    const near = solve(docFor({ ...base, cond: 'min', x: 30 }, 5));
    expect(near.status).toBe('fully');
    expect(near.redundant).toEqual([]);
    expect(at(near, 'c2')[0]).toBeCloseTo(20, 8);
    const far = solve(docFor({ ...base, cond: 'max', x: 30 }, 30));
    expect(far.status).toBe('fully');
    expect(far.redundant).toEqual([]);
    expect(at(far, 'c2')[0]).toBeCloseTo(15, 8);
  });

  it('one circle inside the other (radius 20, and 5 inside it): the nearest is across the gap of the wall, 12 apart for 3', () => {
    const inside = solve(docFor({ ...base, R1: 20, cond: 'min', x: 8 }, 3));
    expect(inside.status).toBe('fully');
    expect(at(inside, 'c2')[0]).toBeCloseTo(12, 8); // 20 − 5 − 12 = 3
    const far = solve(docFor({ ...base, R1: 20, cond: 'max', x: 8 }, 30));
    expect(at(far, 'c2')[0]).toBeCloseTo(5, 8); // 5 + 20 + 5 = 30
  });

  it('a radius edited afterwards: the gap is still the gap (the radius is an unknown of the solver, not a number taken once)', () => {
    const doc = docFor({ ...base, cond: 'min', x: 20 }, 5);
    const bigger = applyCommand(doc, { type: 'setDimension', featureId: 's1', constraintId: 'r2', value: '7' });
    const s = solve(bigger);
    expect(at(s, 'c2')[0]).toBeCloseTo(10 + 7 + 5, 8);
  });

  it('a circle and an arc are the same: an arc is the whole circle it lies on', () => {
    const arc = solve(docFor({ ...base, kind: 'ac', cond: 'min', x: 30 }, 5));
    expect(arc.status).toBe('fully');
    expect(at(arc, 'c2')[0]).toBeCloseTo(20, 8);
    const arcMoves = solve(docFor({ ...base, kind: 'ca', cond: 'max', x: 30 }, 30));
    expect(arcMoves.status).toBe('fully');
    expect(at(arcMoves, 'c2')[0]).toBeCloseTo(15, 8);
  });
});

describe('a point and a circle, a line and a circle (by hand)', () => {
  it('a point 5 from a circle of radius 10: 15 from its center; 20 when the farthest point is 30 away; inside, 3 from the wall: 7 from the center', () => {
    const base = { kind: 'pc' as const, R1: 10, R2: 0, yc: 0, h: 0 };
    expect(at(solve(docFor({ ...base, cond: 'min', x: 25 }, 5)), 'p')[0]).toBeCloseTo(15, 8);
    expect(at(solve(docFor({ ...base, cond: 'max', x: 25 }, 30)), 'p')[0]).toBeCloseTo(20, 8);
    expect(at(solve(docFor({ ...base, cond: 'min', x: 4 }, 3)), 'p')[0]).toBeCloseTo(7, 8);
  });

  it('a circle of radius 5 over the line y = 0: 10 above it is its center at 15; the farthest point 30 above is its center at 25; and below the line the same, mirrored', () => {
    const base = { kind: 'lc' as const, R1: 0, R2: 5, x: 10, h: 0 };
    const near = solve(docFor({ ...base, cond: 'min', yc: 20 }, 10));
    expect(near.status).toBe('fully');
    expect(at(near, 'c2')[1]).toBeCloseTo(15, 8);
    expect(at(solve(docFor({ ...base, cond: 'max', yc: 20 }, 30)), 'c2')[1]).toBeCloseTo(25, 8);
    expect(at(solve(docFor({ ...base, cond: 'min', yc: -20 }, 10)), 'c2')[1]).toBeCloseTo(-15, 8);
    expect(at(solve(docFor({ ...base, cond: 'max', yc: -20 }, 30)), 'c2')[1]).toBeCloseTo(-25, 8);
  });
});

describe('what cannot be measured is said', () => {
  it('the farthest of two concentric circles, or from a point at the center, has no direction: the solve fails and says why', () => {
    const doc = start(
      [{ id: 'c1', type: 'point', x: 0, y: 0 }, { id: 'K1', type: 'circle', center: 'c1', radius: 10 }, { id: 'c2', type: 'point', x: 0, y: 0 }, { id: 'K2', type: 'circle', center: 'c2', radius: 4 }],
      [{ id: 'D', type: 'distance', a: 'K1', b: 'K2', value: '14', condition: 'max' }],
    );
    const s = solve(doc);
    expect(s.status).toBe('failed');
    expect(s.message).toBe(t('map.conditionNoDirection', { id: 'D' }));
  });

  it('the geometry side: the ends the distance is between, or the reason there are none', () => {
    const g = solve(docFor({ kind: 'cc', R1: 10, R2: 5, yc: 0, h: 0, cond: 'min', x: 20 }, 5)).geometry;
    const near = conditionEnds(g, 'K1', 'K2', 'min');
    expect(near && 'ends' in near && near.value).toBeCloseTo(5, 9);
    expect(near && 'ends' in near && near.ends[0][0]).toBeCloseTo(10, 9);
    expect(near && 'ends' in near && near.ends[1][0]).toBeCloseTo(15, 9);
    const far = conditionEnds(g, 'K1', 'K2', 'max');
    expect(far && 'ends' in far && far.value).toBeCloseTo(35, 9); // 20 + 10 + 5
    // two circles that cross have no nearest
    const crossing = solve(docFor({ kind: 'cc', R1: 10, R2: 5, yc: 0, h: 0, cond: 'max', x: 12 }, 27)).geometry;
    expect(conditionEnds(crossing, 'K1', 'K2', 'min')).toEqual({ error: 'crossing' });
    // a line through a circle
    const through = solve(docFor({ kind: 'lc', R1: 0, R2: 5, x: 10, yc: 2, h: 0, cond: 'max' }, 7)).geometry;
    expect(conditionEnds(through, 'L', 'K2', 'min')).toEqual({ error: 'crossing' });
    expect(conditionEnds(through, 'L', 'c2', 'min')).toBeNull(); // a point and a line: not for this
  });
});

describe('what the rules refuse', () => {
  const entities: SketchEntity[] = [
    { id: 'a', type: 'point', x: 0, y: 0 },
    { id: 'b', type: 'point', x: 10, y: 0 },
    { id: 'L', type: 'line', p1: 'a', p2: 'b' },
    { id: 'c', type: 'point', x: 5, y: 8 },
    { id: 'K', type: 'circle', center: 'c', radius: 2 },
    { id: 'p', type: 'point', x: 20, y: 20 },
    { id: 'M', type: 'line', p1: 'p', p2: 'c' },
  ];
  const err = (c: Partial<DimensionConstraint> & { a: string; b?: string }) => sketchError({ entities, constraints: [{ id: 'D', type: 'distance', value: '5', ...c } as SketchConstraint] });
  it('a condition belongs to a circle or an arc and a point, a line or another circle or arc', () => {
    expect(err({ a: 'K', b: 'p', condition: 'min' })).toBeNull();
    expect(err({ a: 'L', b: 'K', condition: 'max' })).toBeNull();
    expect(err({ a: 'p', b: 'b', condition: 'min' })).not.toBeNull(); // two points
    expect(err({ a: 'L', b: 'M', condition: 'min' })).not.toBeNull(); // two lines
    expect(err({ a: 'L', condition: 'min' })).not.toBeNull(); // the length of one line
    expect(err({ a: 'K', b: 'p', condition: 'nearest' as 'min' })).not.toBeNull();
    expect(err({ a: 'K', b: 'p' })).toBeNull(); // no condition: from the center, as before
  });
});

describe('the command', () => {
  const doc = () => docFor({ kind: 'cc', R1: 10, R2: 5, yc: 0, h: 0, cond: 'min', x: 20 }, 5);
  const find = (d: PartDoc) => sketchOf(d).constraints.find((c) => c.id === 'D') as Extract<SketchConstraint, { type: 'distance' }>;
  it('sets the condition and the value that goes with it, and takes it away again; refuses what does not fit', () => {
    const toMax = applyCommand(doc(), { type: 'setDistanceCondition', featureId: 's1', constraintId: 'D', condition: 'max', value: '30' });
    expect(find(toMax)).toMatchObject({ condition: 'max', value: '30' });
    const centre = applyCommand(toMax, { type: 'setDistanceCondition', featureId: 's1', constraintId: 'D', condition: null, value: '20' });
    expect(find(centre).condition).toBeUndefined();
    expect(find(centre).value).toBe('20');
    expect(() => applyCommand(doc(), { type: 'setDistanceCondition', featureId: 's1', constraintId: 'r2', condition: 'min' })).toThrow(); // not a distance
    expect(() => applyCommand(doc(), { type: 'setDistanceCondition', featureId: 's1', constraintId: 'nowhere', condition: 'min' })).toThrow();
    const lines = start([{ id: 'a', type: 'point', x: 0, y: 0 }, { id: 'b', type: 'point', x: 4, y: 0 }, { id: 'p', type: 'point', x: 0, y: 5 }], [{ id: 'D', type: 'distance', a: 'a', b: 'p', value: '5' }]);
    expect(() => applyCommand(lines, { type: 'setDistanceCondition', featureId: 's1', constraintId: 'D', condition: 'min' })).toThrow(t('rules.distanceCondition', { id: 'D' }));
  });
});

describe('random cases: five pairs, both conditions, 150 in all', () => {
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  it('a sketch already where its value says nothing moves; a value changed, the distance measured afterwards is the new one (the formulas, and `measure`)', () => {
    const next = rng(20261022);
    const between = (lo: number, hi: number) => lo + next() * (hi - lo);
    const kinds: Kind[] = ['cc', 'ac', 'ca', 'pc', 'lc'];
    let n = 0;
    for (const kind of kinds) {
      for (const cond of ['min', 'max'] as Cond[]) {
        for (let k = 0; k < 15; k++, n++) {
          const R1 = between(4, 20);
          const R2 = between(2, 15);
          const side = next() < 0.5 ? -1 : 1;
          /** The values that have a solution on the side the sketch is on: one curve inside the other has at most the gap of the concentric case, the farthest at least the concentric one. */
          let cap = Infinity;
          let c: Case;
          if (kind === 'lc') {
            // the circle clear of the line (for the nearest), on either side of it
            const gap = between(1, 25);
            const h = between(-5, 5);
            c = { kind, cond, R1: 0, R2, x: side * between(1, 20), yc: h + side * (R2 + gap + (cond === 'max' ? between(0, 10) : 0)), h };
          } else if (kind === 'pc') {
            const nested = cond === 'min' && next() < 0.3;
            if (nested) cap = 0.9 * R1;
            c = { kind, cond, R1, R2: 0, yc: 0, h: 0, x: side * (nested ? between(0.5, R1 - 1) : R1 + between(1, 25)) };
          } else {
            // separate, or one inside the other for the nearest (never crossing); for the farthest anything but concentric
            const inside = cond === 'min' && Math.abs(R1 - R2) > 3 && next() < 0.4;
            const d = inside ? between(0.5, Math.abs(R1 - R2) - 1.2) : R1 + R2 + between(1, 25);
            if (inside) cap = 0.9 * Math.abs(R1 - R2);
            c = { kind, cond, R1, R2, yc: 0, h: 0, x: side * d };
          }
          const v = truth(c, cond);
          const label = `n=${n} ${JSON.stringify(c)}`;
          // 1. as stored: nothing moves, the sketch is fully defined, nothing is redundant
          const s = solve(docFor(c, v));
          expect(s.status, label).toBe('fully');
          expect(s.redundant, label).toEqual([]);
          const [px, py] = moved(s, c);
          expect(Math.abs(px - (c.kind === 'lc' ? c.x : c.x)), label).toBeLessThan(1e-7);
          expect(Math.abs(py - (c.kind === 'lc' ? c.yc : 0)), label).toBeLessThan(1e-7);
          // 2. the value changed: the distance measured is the new one, on the side it was (new value kept clear of crossing)
          const floor = cond === 'min' ? 0.2 : kind === 'lc' ? 1.05 * R2 : kind === 'pc' ? 1.05 * R1 : 1.05 * (R1 + R2);
          const v2 = Math.min(Math.max(v * between(0.6, 1.8), floor), cap);
          const s2 = solve(docFor(c, v2));
          expect(s2.status, label).toBe('fully');
          const c2 = { ...c };
          if (c.kind === 'lc') c2.yc = c.yc + (side * 1) * 0; // read back below
          const got = moved(s2, c);
          let expected: number;
          if (c.kind === 'lc') {
            const d = Math.abs(got[1] - c.h);
            expected = cond === 'max' ? d + c.R2 : d - c.R2;
            expect(Math.sign(got[1] - c.h), label).toBe(side);
          } else {
            c2.x = got[0];
            expected = truth(c2, cond);
            expect(Math.sign(got[0]), label).toBe(side);
          }
          expect(Math.abs(expected - v2), label).toBeLessThan(1e-7);
          // 3. what the interface measures, from the solved geometry, is the same number
          expect(Math.abs((measure(dimension(c, v2), s2.geometry) ?? NaN) - v2), label).toBeLessThan(1e-7);
        }
      }
    }
    expect(n).toBe(150);
  });
});
