import { beforeAll, describe, expect, it } from 'vitest';
import { createDemoPart, type SketchConstraint, type SketchEntity, type SketchFeature } from '@3db/model';
import { PlaneGcsSolver, type SolvedGeometry } from '../src/index';

let solver: PlaneGcsSolver;
beforeAll(async () => {
  solver = await PlaneGcsSolver.create();
});

const demo = () => createDemoPart().features[0] as SketchFeature;
const without = (s: SketchFeature, ...ids: string[]): SketchFeature => ({ ...s, constraints: s.constraints.filter((c) => !ids.includes(c.id)) });
const point = (g: SolvedGeometry | undefined) => (g as Extract<SolvedGeometry, { type: 'point' }>).p;

function sketch(entities: SketchEntity[], constraints: SketchConstraint[] = []): SketchFeature {
  return { id: 's', type: 'sketch', name: 's', suppressed: false, plane: { kind: 'datum', name: 'plane:front' }, entities, constraints };
}

describe('drag solving (A2.6)', () => {
  it('moves a free corner with the cursor while keeping the relations', () => {
    const s = without(demo(), 'd1'); // width is free
    const r = solver.solve(s, { drag: { points: [{ id: 'p3', x: 26, y: 10 }] } });
    expect(point(r.geometry.get('p3'))[0]).toBeCloseTo(26, 6);
    expect(point(r.geometry.get('p2'))[0]).toBeCloseTo(26, 6); // l2 stays vertical
    expect(point(r.geometry.get('p2'))[1]).toBeCloseTo(0, 6); // l1 stays horizontal through the origin
    expect(point(r.geometry.get('p3'))[1]).toBeCloseTo(10, 6); // height is dimensioned
  });

  it('cannot move fully defined geometry', () => {
    const r = solver.solve(demo(), { drag: { points: [{ id: 'p3', x: 26, y: 14 }] } });
    expect(point(r.geometry.get('p3'))).toEqual([expect.closeTo(20, 6), expect.closeTo(10, 6)]);
  });

  it('starts from overriding initial values', () => {
    const s = without(demo(), 'd1');
    const r = solver.solve(s, { initial: { points: [{ id: 'p2', x: 31, y: 0 }, { id: 'p3', x: 31, y: 10 }] } });
    expect(point(r.geometry.get('p3'))[0]).toBeCloseTo(31, 6);
  });
});

describe('per-entity definition (C1.31)', () => {
  it('marks everything fully defined in the demo sketch', () => {
    const r = solver.solve(demo(), { analyze: true });
    expect([...r.entityStatus!.values()].every((s) => s === 'fully')).toBe(true);
  });

  it('marks only the geometry the missing height leaves free', () => {
    const r = solver.solve(without(demo(), 'd2'), { analyze: true });
    const st = Object.fromEntries(r.entityStatus!);
    expect(st).toMatchObject({ p1: 'fully', p2: 'fully', l1: 'fully', p3: 'under', p4: 'under', l2: 'under', l3: 'under', l4: 'under' });
  });

  it('marks entities of conflicting relations as over-defined', () => {
    const s = demo();
    const r = solver.solve({ ...s, constraints: [...s.constraints, { id: 'bad', type: 'distance', a: 'p1', b: 'p3', value: '5' }] }, { analyze: true });
    expect(r.entityStatus!.get('p3')).toBe('over');
  });

  it('treats a circle as defined only when its radius is', () => {
    const base = sketch(
      [
        { id: 'c0', type: 'point', x: 0, y: 0 },
        { id: 'k1', type: 'circle', center: 'c0', radius: 3 },
      ],
      [{ id: 'o', type: 'coincident', a: 'c0', b: '@origin' }],
    );
    expect(solver.solve(base, { analyze: true }).entityStatus!.get('k1')).toBe('under');
    const sized = { ...base, constraints: [...base.constraints, { id: 'd', type: 'diameter', circle: 'k1', value: '8' } as const] };
    expect(solver.solve(sized, { analyze: true }).entityStatus!.get('k1')).toBe('fully');
  });
});

describe('relations added in Phase 1', () => {
  it('puts a point on a circle and aligns two points horizontally', () => {
    const r = solver.solve(
      sketch(
        [
          { id: 'c0', type: 'point', x: 0, y: 0 },
          { id: 'k1', type: 'circle', center: 'c0', radius: 5 },
          { id: 'q', type: 'point', x: 3, y: 3 },
          { id: 'u', type: 'point', x: 9, y: 1 },
        ],
        [
          { id: 'o', type: 'coincident', a: 'c0', b: '@origin' },
          { id: 'on', type: 'pointOnCurve', point: 'q', curve: 'k1' },
          { id: 'h', type: 'horizontal', a: 'q', b: 'u' },
        ],
      ),
    );
    const q = point(r.geometry.get('q'));
    const k1 = r.geometry.get('k1') as Extract<SolvedGeometry, { type: 'circle' }>; // radius is free, so compare with the solved one
    expect(Math.hypot(q[0], q[1])).toBeCloseTo(k1.r, 6);
    expect(point(r.geometry.get('u'))[1]).toBeCloseTo(q[1], 6);
  });

  it('solves a slot (lines joined by tangent arcs) without over-defining it', () => {
    const pts: [string, number, number][] = [
      ['a', -10, 0], ['b', 10, 0], ['c', 10, 10], ['d', -10, 10], ['r', 10, 5], ['l', -10, 5],
    ];
    const s = sketch(
      [
        ...pts.map(([id, x, y]) => ({ id, type: 'point', x, y }) as const),
        { id: 'bottom', type: 'line', p1: 'a', p2: 'b' },
        { id: 'right', type: 'arc', center: 'r', start: 'b', end: 'c' },
        { id: 'top', type: 'line', p1: 'c', p2: 'd' },
        { id: 'left', type: 'arc', center: 'l', start: 'd', end: 'a' },
      ],
      [
        { id: 'h1', type: 'horizontal', a: 'bottom' },
        { id: 'h2', type: 'horizontal', a: 'top' },
        { id: 't1', type: 'tangent', a: 'bottom', b: 'right' },
        { id: 't2', type: 'tangent', a: 'top', b: 'right' },
        { id: 't3', type: 'tangent', a: 'top', b: 'left' },
        { id: 't4', type: 'tangent', a: 'bottom', b: 'left' },
        { id: 'len', type: 'distance', a: 'bottom', value: '30' },
        { id: 'rad', type: 'radius', circle: 'right', value: '6' },
      ],
    );
    const r = solver.solve(s, { analyze: true });
    expect(r.status).toBe('under'); // only the position is free; nothing conflicts
    expect(r.dof).toBe(2);
    expect(r.conflicting).toEqual([]);
    expect(r.redundant).toEqual([]);
    const right = r.geometry.get('right') as Extract<SolvedGeometry, { type: 'arc' }>;
    const c = point(r.geometry.get('c'));
    const b = point(r.geometry.get('b'));
    expect(right.r).toBeCloseTo(6, 6);
    expect(c[1] - b[1]).toBeCloseTo(12, 6); // tangent at both ends: the arc is a half circle
  });

  it('keeps an arc tangent to the line it continues', () => {
    const r = solver.solve(
      sketch(
        [
          { id: 'a1', type: 'point', x: 0, y: 0 },
          { id: 'a2', type: 'point', x: 10, y: 0 },
          { id: 'l', type: 'line', p1: 'a1', p2: 'a2' },
          { id: 'ac', type: 'point', x: 10, y: 4 },
          { id: 'ae', type: 'point', x: 14, y: 4.5 },
          { id: 'arc', type: 'arc', center: 'ac', start: 'a2', end: 'ae' },
        ],
        [{ id: 't', type: 'tangent', a: 'l', b: 'arc' }],
      ),
    );
    expect(r.status).not.toBe('failed');
    const c = r.geometry.get('arc') as Extract<SolvedGeometry, { type: 'arc' }>;
    const a2 = point(r.geometry.get('a2'));
    const a1 = point(r.geometry.get('a1'));
    // tangent at the shared end: the radius there is perpendicular to the line
    const radius = [a2[0] - c.c[0], a2[1] - c.c[1]];
    const dir = [a2[0] - a1[0], a2[1] - a1[1]];
    expect(Math.abs(radius[0]! * dir[0]! + radius[1]! * dir[1]!)).toBeLessThan(1e-6);
  });
});
