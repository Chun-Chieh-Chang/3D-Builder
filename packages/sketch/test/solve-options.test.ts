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

describe('what still moves in an under-defined entity', () => {
  const corners: [string, number, number][] = [['a', 0, 0], ['b', 40, 0], ['c', 40, 30], ['d', 0, 30]];
  /** A rectangle with only its width and height: free to translate (2), nothing else. */
  const rectangle = () =>
    sketch(
      [
        ...corners.map(([id, x, y]) => ({ id, type: 'point', x, y }) as const),
        { id: 'l1', type: 'line', p1: 'a', p2: 'b' },
        { id: 'l2', type: 'line', p1: 'b', p2: 'c' },
        { id: 'l3', type: 'line', p1: 'c', p2: 'd' },
        { id: 'l4', type: 'line', p1: 'd', p2: 'a' },
      ],
      [
        { id: 'h1', type: 'horizontal', a: 'l1' },
        { id: 'v2', type: 'vertical', a: 'l2' },
        { id: 'h3', type: 'horizontal', a: 'l3' },
        { id: 'v4', type: 'vertical', a: 'l4' },
        { id: 'w', type: 'distance', a: 'l1', value: '40' },
        { id: 'ht', type: 'distance', a: 'l2', value: '30' },
      ],
    );

  it('lists every corner of a rectangle that only has its size, each free in both directions', () => {
    const r = solver.solve(rectangle(), { analyze: true });
    expect(r.status).toBe('under');
    expect(r.dof).toBe(2);
    expect(r.entityFreedom!.get('l1')).toEqual({ points: [{ id: 'a', dof: 2 }, { id: 'b', dof: 2 }], radius: false });
    expect(r.entityFreedom!.get('l3')).toEqual({ points: [{ id: 'c', dof: 2 }, { id: 'd', dof: 2 }], radius: false });
    expect(r.entityFreedom!.get('a')).toEqual({ points: [{ id: 'a', dof: 2 }], radius: false });
    // the per-entity counts share the same two freedoms: they do not add up to the sketch's total
    expect([...r.entityFreedom!.values()].reduce((n, f) => n + f.points.reduce((m, p) => m + p.dof!, 0), 0)).toBeGreaterThan(r.dof);
  });

  it('says a point slides along one direction when only one coordinate is held', () => {
    const s = rectangle();
    const r = solver.solve({ ...s, constraints: [...s.constraints, { id: 'onX', type: 'pointOnCurve', point: 'a', curve: '@axisH' } as SketchConstraint] }, { analyze: true });
    expect(r.dof).toBe(1);
    expect(r.entityFreedom!.get('l1')!.points).toEqual([{ id: 'a', dof: 1 }, { id: 'b', dof: 1 }]);
  });

  it('names only the radius of a circle whose centre is placed', () => {
    const r = solver.solve(
      sketch(
        [
          { id: 'c0', type: 'point', x: 0, y: 0 },
          { id: 'k1', type: 'circle', center: 'c0', radius: 3 },
        ],
        [{ id: 'o', type: 'coincident', a: 'c0', b: '@origin' }],
      ),
      { analyze: true },
    );
    expect(r.dof).toBe(1);
    expect(r.entityFreedom!.get('k1')).toEqual({ points: [], radius: true });
    expect(r.entityFreedom!.has('c0')).toBe(false);
  });

  it('lists nothing when fully defined or over-defined', () => {
    expect(solver.solve(demo(), { analyze: true }).entityFreedom!.size).toBe(0);
    const s = demo();
    const over = solver.solve({ ...s, constraints: [...s.constraints, { id: 'bad', type: 'distance', a: 'p1', b: 'p3', value: '5' }] }, { analyze: true });
    expect(over.status).toBe('over');
    expect(over.entityFreedom!.has('p3')).toBe(false);
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

  it('matches native pinned-point and pinned-radius DOF probes across 150 random configurations (including unconstrained fast-path)', () => {
    let seed = 20261029;
    const next = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };
    let fastPathCount = 0;
    let constrainedCount = 0;
    for (let i = 0; i < 150; i++) {
      const entities: SketchEntity[] = [];
      const constraints: SketchConstraint[] = [];
      const nPoints = 2 + (i % 5);
      for (let p = 0; p < nPoints; p++) {
        entities.push({
          id: `p${p}`,
          type: 'point',
          x: Math.round((next() * 80 - 40) * 100) / 100,
          y: Math.round((next() * 80 - 40) * 100) / 100,
        });
      }
      const nLines = i % 3;
      for (let l = 0; l < nLines && l + 1 < nPoints; l++) {
        const p1 = `p${l}`;
        const p2 = `p${l + 1}`;
        const a = entities[l] as Extract<SketchEntity, { type: 'point' }>;
        const b = entities[l + 1] as Extract<SketchEntity, { type: 'point' }>;
        if (Math.hypot(b.x - a.x, b.y - a.y) < 1) b.x += 5;
        entities.push({ id: `l${l}`, type: 'line', p1, p2 });
      }
      const nCircles = (i >> 1) % 3;
      for (let c = 0; c < nCircles; c++) {
        entities.push({
          id: `ci${c}`,
          type: 'circle',
          center: `p${c % nPoints}`,
          radius: Math.round((2 + next() * 15) * 100) / 100,
        });
      }
      const constrained = i % 2 === 1;
      if (constrained) {
        constrainedCount++;
        constraints.push({ id: 'fix0', type: 'fix', point: 'p0' });
        if (nLines > 0 && i % 4 === 1) {
          const a = entities[0] as Extract<SketchEntity, { type: 'point' }>;
          const b = entities[1] as Extract<SketchEntity, { type: 'point' }>;
          b.y = a.y;
          if (Math.abs(b.x - a.x) < 1) b.x = a.x + 10;
          constraints.push({ id: 'h0', type: 'horizontal', a: 'l0' });
        }
        if (nCircles > 0 && i % 3 === 0) {
          const ci = entities.find((e) => e.id === 'ci0') as Extract<SketchEntity, { type: 'circle' }>;
          constraints.push({ id: 'r0', type: 'radius', circle: 'ci0', value: String(ci.radius) });
        }
      } else {
        fastPathCount++;
      }
      const s = sketch(entities, constraints);
      const analyzed = solver.solve(s, { analyze: true });
      expect(analyzed.status).not.toBe('failed');
      expect(analyzed.conflicting).toEqual([]);
      expect(analyzed.redundant).toEqual([]);

      // Verify every point and circle against direct native solver probes with explicit fix/radius constraints
      const initial = {
        points: entities.filter((e): e is Extract<SketchEntity, { type: 'point' }> => e.type === 'point').map((p) => {
          const g = analyzed.geometry.get(p.id);
          return { id: p.id, x: g?.type === 'point' ? g.p[0] : p.x, y: g?.type === 'point' ? g.p[1] : p.y };
        }),
        radii: entities.filter((e): e is Extract<SketchEntity, { type: 'circle' }> => e.type === 'circle').map((c) => {
          const g = analyzed.geometry.get(c.id);
          return { id: c.id, radius: g?.type === 'circle' ? g.r : c.radius };
        }),
      };
      const pointDof = new Map<string, number>();
      for (const p of initial.points) {
        const pinned: SketchFeature = {
          ...s,
          entities: s.entities.map((e) => (e.type === 'point' && e.id === p.id ? { ...e, x: p.x, y: p.y } : e)),
          constraints: [
            ...s.constraints.filter((c) => !(c.type === 'fix' && c.point === p.id)),
            { id: `@pin_${p.id}`, type: 'fix', point: p.id },
          ],
        };
        const pr = solver.solve(pinned, { initial });
        pointDof.set(p.id, analyzed.dof - pr.dof);
      }
      for (const e of entities) {
        const pts = e.type === 'point' ? [e.id] : e.type === 'line' ? [e.p1, e.p2] : e.type === 'circle' ? [e.center] : [];
        const freePts = pts.map((id) => ({ id, dof: pointDof.get(id)! })).filter((x) => x.dof !== 0);
        let radiusFree = false;
        if (e.type === 'circle') {
          const hasRadius = s.constraints.some((c) => (c.type === 'radius' || c.type === 'diameter') && c.circle === e.id && c.driving !== false);
          if (!hasRadius) {
            const g = analyzed.geometry.get(e.id) as Extract<SolvedGeometry, { type: 'circle' }>;
            const pr = solver.solve(
              { ...s, constraints: [...s.constraints, { id: `@rad_${e.id}`, type: 'radius', circle: e.id, value: String(g.r) }] },
              { initial },
            );
            radiusFree = analyzed.dof - pr.dof > 0;
          }
        }
        const expectedStatus = freePts.length === 0 && !radiusFree ? 'fully' : 'under';
        expect(analyzed.entityStatus?.get(e.id)).toBe(expectedStatus);
        if (expectedStatus === 'under') {
          expect(analyzed.entityFreedom?.get(e.id)).toEqual({ points: freePts, radius: radiusFree });
        } else {
          expect(analyzed.entityFreedom?.has(e.id)).toBe(false);
        }
      }
    }
    expect(fastPathCount).toBe(75);
    expect(constrainedCount).toBe(75);
  });
});
