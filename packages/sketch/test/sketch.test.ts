import { beforeAll, describe, expect, it } from 'vitest';
import { createDemoPart, type SketchConstraint, type SketchEntity, type SketchFeature } from '@3db/model';
import { findProfiles, PlaneGcsSolver, type SolvedGeometry } from '../src/index';

let solver: PlaneGcsSolver;
beforeAll(async () => {
  solver = await PlaneGcsSolver.create();
});

const demoSketch = () => createDemoPart().features[0] as SketchFeature;
const withConstraints = (s: SketchFeature, constraints: SketchConstraint[]): SketchFeature => ({ ...s, constraints });

function sketch(entities: SketchEntity[], constraints: SketchConstraint[] = []): SketchFeature {
  return { id: 's', type: 'sketch', name: 's', suppressed: false, plane: { kind: 'datum', name: 'plane:front' }, entities, constraints };
}

describe('PlaneGCS solver', () => {
  it('solves the fully defined rectangle (black)', () => {
    const r = solver.solve(demoSketch());
    expect(r.status).toBe('fully');
    expect(r.dof).toBe(0);
    const p3 = r.geometry.get('p3') as Extract<SolvedGeometry, { type: 'point' }>;
    expect(p3.p[0]).toBeCloseTo(20, 9);
    expect(p3.p[1]).toBeCloseTo(10, 9);
  });

  it('reports under-defined (blue) when a dimension is missing', () => {
    const s = demoSketch();
    const r = solver.solve(withConstraints(s, s.constraints.filter((c) => c.id !== 'd2')));
    expect(r.status).toBe('under');
    expect(r.dof).toBe(1);
  });

  it('reports over-defined (red) with the conflicting dimension', () => {
    const s = demoSketch();
    const r = solver.solve(withConstraints(s, [...s.constraints, { id: 'bad', type: 'distance', a: 'p1', b: 'p3', value: '5' }]));
    expect(r.status).toBe('over');
    expect(r.conflicting).toContain('bad');
  });

  it('follows a changed dimension', () => {
    const s = demoSketch();
    const r = solver.solve(
      withConstraints(
        s,
        s.constraints.map((c) => (c.id === 'd1' ? { ...c, value: '33.5' } : c)),
      ),
    );
    const p2 = r.geometry.get('p2') as Extract<SolvedGeometry, { type: 'point' }>;
    expect(p2.p[0]).toBeCloseTo(33.5, 9);
  });

  it('turns an angle dimension to the side it was placed on (and keeps the old meaning without it)', () => {
    // A V drawn head to tail: D → E → F, with E fixed at the origin, D fixed, and EF 20 long.
    const v = (angle: SketchConstraint) =>
      sketch(
        [
          { id: 'D', type: 'point', x: 10, y: 10 },
          { id: 'E', type: 'point', x: 0, y: 0 },
          { id: 'F', type: 'point', x: -10, y: 10 },
          { id: 'DE', type: 'line', p1: 'D', p2: 'E' },
          { id: 'EF', type: 'line', p1: 'E', p2: 'F' },
        ],
        [
          { id: 'e', type: 'coincident', a: 'E', b: '@origin' },
          { id: 'dx', type: 'distanceX', a: 'E', b: 'D', value: '10' },
          { id: 'dy', type: 'distanceY', a: 'E', b: 'D', value: '10' },
          { id: 'len', type: 'distance', a: 'EF', value: String(Math.hypot(10, 10)) },
          angle,
        ],
      );
    const opening = (angle: SketchConstraint) => {
      const r = solver.solve(v(angle));
      expect(r.status).toBe('fully');
      const p = (id: string) => (r.geometry.get(id) as Extract<SolvedGeometry, { type: 'point' }>).p;
      const [e, d, f] = [p('E'), p('D'), p('F')];
      const u = [d[0] - e[0], d[1] - e[1]];
      const w = [f[0] - e[0], f[1] - e[1]];
      return (Math.acos((u[0]! * w[0]! + u[1]! * w[1]!) / (Math.hypot(u[0]!, u[1]!) * Math.hypot(w[0]!, w[1]!))) * 180) / Math.PI;
    };
    // Placed inside the V (flip 'a'), 100 opens the V to 100°, as in SolidWorks …
    expect(opening({ id: 'ang', type: 'angle', a: 'DE', b: 'EF', flip: 'a', value: '100' })).toBeCloseTo(100, 6);
    // … while a dimension without `flip` (documents before v6) still turns the lines as drawn: 80°.
    expect(opening({ id: 'ang', type: 'angle', a: 'DE', b: 'EF', value: '100' })).toBeCloseTo(80, 6);
  });

  it('handles circles with radius and concentric relations', () => {
    const s = sketch(
      [
        { id: 'c0', type: 'point', x: 1, y: 1 },
        { id: 'c1', type: 'point', x: 2, y: 2 },
        { id: 'k1', type: 'circle', center: 'c0', radius: 3 },
        { id: 'k2', type: 'circle', center: 'c1', radius: 1 },
      ],
      [
        { id: 'o', type: 'coincident', a: 'c0', b: '@origin' },
        { id: 'cc', type: 'concentric', a: 'k1', b: 'k2' },
        { id: 'r1', type: 'diameter', circle: 'k1', value: '20' },
        { id: 'r2', type: 'radius', circle: 'k2', value: '4' },
      ],
    );
    const r = solver.solve(s);
    expect(r.status).toBe('fully');
    const k1 = r.geometry.get('k1') as Extract<SolvedGeometry, { type: 'circle' }>;
    expect(k1.r).toBeCloseTo(10, 9);
  });
});

describe('profile detection', () => {
  it('finds one counter-clockwise loop for the rectangle', () => {
    const s = demoSketch();
    const { regions, problems } = findProfiles(s, solver.solve(s));
    expect(problems).toEqual([]);
    expect(regions).toHaveLength(1);
    expect(regions[0]!.outer.map((seg) => seg.source)).toEqual(['l1', 'l2', 'l3', 'l4']);
  });

  it('nests a circle inside the rectangle as a hole', () => {
    const base = demoSketch();
    const s = {
      ...base,
      entities: [...base.entities, { id: 'hc', type: 'point', x: 10, y: 5 } as const, { id: 'hole', type: 'circle', center: 'hc', radius: 2 } as const],
    };
    const { regions } = findProfiles(s, solver.solve(s));
    expect(regions).toHaveLength(1);
    expect(regions[0]!.holes).toHaveLength(1);
    expect(regions[0]!.holes[0]![0]!.source).toBe('hole');
  });

  it('reports open ends instead of guessing', () => {
    const base = demoSketch();
    const s = { ...base, entities: base.entities.filter((e) => e.id !== 'l4') };
    const { regions, problems } = findProfiles(s, solver.solve({ ...s, constraints: s.constraints.filter((c) => c.id !== 'c5') }));
    expect(regions).toEqual([]);
    expect(problems.join()).toContain('開放端點');
  });
});
