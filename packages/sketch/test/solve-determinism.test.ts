/**
 * B3.1: a rebuild is a pure function of the document, so a sketch must solve to the same numbers, bit for bit, every time. planegcs (FreeCAD's GCS)
 * orders its parameters by where they are in memory, so the same sketch came out differing in the last digits from one solve to the next — enough to
 * flip whether OCCT took two faces as one, and so the names of the faces (零件1 of the C3C6 檢具, B1 of 2026-10-14). The solver's answer is put on a
 * fine grid (planegcs.ts, `canon`), so what is equal comes out equal.
 */
import { describe, expect, it } from 'vitest';
import type { SketchFeature } from '@3db/model';
import { PlaneGcsSolver } from '../src/planegcs';

/** A revolve profile like the one that showed it (made up, not the customer's): up the axis, out, angled steps out and in, back; the axis a construction line. */
const profile = (): SketchFeature => {
  // drawn roughly, as a hand draws it: the solver has a way to go, which is where the last digits come apart
  const P: [number, number][] = [[0.2, -0.1], [3.4, 0.3], [2.8, 1.5], [3.6, 0.6], [4.1, 0.1], [4.3, 2.9], [4.9, 4.6], [0.3, 5.4], [-0.2, 6.6]];
  const entities: SketchFeature['entities'] = P.map(([x, y], i) => ({ id: `p${i}`, type: 'point', x, y }));
  ([[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7]] as const).forEach(([a, b], i) => entities.push({ id: `l${i}`, type: 'line', p1: `p${a}`, p2: `p${b}` }));
  entities.push({ id: 'ax', type: 'line', p1: 'p0', p2: 'p8', construction: true });
  return {
    id: 's',
    type: 'sketch',
    name: 's',
    suppressed: false,
    plane: { kind: 'datum', name: 'plane:front' },
    entities,
    constraints: [
      { id: 'o', type: 'coincident', a: 'p0', b: '@origin' },
      { id: 'h0', type: 'horizontal', a: 'l0' },
      { id: 'v1', type: 'vertical', a: 'l1' },
      { id: 'v3', type: 'vertical', a: 'l3' },
      { id: 'v5', type: 'vertical', a: 'l5' },
      { id: 'h6', type: 'horizontal', a: 'l6' },
      { id: 'vax', type: 'vertical', a: 'ax' },
      { id: 'v7', type: 'vertical', a: 'p7', b: 'p0' },
      { id: 'an2', type: 'angle', a: 'l1', b: 'l2', value: '118' },
      { id: 'an4', type: 'angle', a: 'l3', b: 'l4', value: '161' },
      { id: 'd0', type: 'distance', a: 'l0', value: '3.1' },
      { id: 'd1', type: 'distance', a: 'l1', value: '1.2' },
      { id: 'd3', type: 'distance', a: 'l3', value: '0.45' },
      { id: 'dy', type: 'distanceY', a: '@origin', b: 'p7', value: '5' },
      { id: 'd2', type: 'distance', a: 'l2', value: '0.9' },
      { id: 'd4', type: 'distance', a: 'l4', value: '2.2' },
      { id: 'dax', type: 'distanceY', a: '@origin', b: 'p8', value: '7' },
    ],
  } as SketchFeature;
};
const bits = (g: Map<string, unknown>) => JSON.stringify([...g].sort(), (_k, v) => (typeof v === 'number' ? (Object.is(v, -0) ? '-0' : v.toPrecision(17)) : v));

describe('a sketch solves to the same numbers every time (B3.1)', () => {
  it('eight solves in a row, and on a solver of its own, give one answer bit for bit', async () => {
    const solver = await PlaneGcsSolver.create();
    expect(solver.solve(profile())).toMatchObject({ status: 'fully', dof: 0 }); // what a part is made of; an under-defined one may come out anywhere its freedom allows
    const answers = new Set<string>();
    for (let i = 0; i < 8; i++) answers.add(bits(solver.solve(profile()).geometry));
    answers.add(bits((await PlaneGcsSolver.create()).solve(profile()).geometry));
    expect(answers.size).toBe(1);
  });

  it('the same with other sketches solved in between', async () => {
    const solver = await PlaneGcsSolver.create();
    const first = bits(solver.solve(profile()).geometry);
    const other = profile();
    for (const c of other.constraints) if (c.type === 'distance' && c.id === 'd0') c.value = '2.7';
    for (let i = 0; i < 4; i++) {
      solver.solve(other);
      expect(bits(solver.solve(profile()).geometry)).toBe(first);
    }
  });

  it('the grid is far below the kernel\'s tolerance and keeps exact values exact: no point moves more than 1e-10, a whole number stays whole, no −0', async () => {
    const solver = await PlaneGcsSolver.create();
    const g = solver.solve(profile()).geometry;
    const p = (id: string) => (g.get(id) as { p: [number, number] }).p;
    expect(p('p1')).toEqual([3.1, 0]); // exactly: the grid is decimal, so what was typed comes back as typed
    expect(p('p7')).toEqual([0, 5]); // exactly
    for (const [, x] of g) {
      if (x.type !== 'point') continue;
      for (const v of x.p) expect(Object.is(v, -0)).toBe(false);
    }
  });
});
