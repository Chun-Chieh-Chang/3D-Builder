/**
 * 6-6 (docs/phase6-plan.md): the screw boss (C4.11) — a column with a pilot hole standing on the inside of the floor of a shell, with a draft on its wall and gussets round its
 * foot if asked — against volumes worked out by hand: the column π(R²h − r²d), the frustum of a drafted one, and the gussets by integrating their triangle outside the wall.
 * The box is 60 × 40 × 30 shelled 2 open at the top (15552 mm³), the inside of the floor at z = 2.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, SCHEMA_VERSION, type Feature, type PartDoc, type Ref } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { build, extrude, front, rectangle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});
afterAll(() => kept.forEach((r) => r.dispose()));

const rebuild = (doc: PartDoc): RebuildResult => {
  const regen = new Regenerator(kernel, solver, new Map());
  kept.push(regen);
  return regen.rebuild(doc);
};
const failures = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));
const volume = (r: RebuildResult) => kernel.massProps(r.body!.shape).volume;
const face = (name: string): Ref => ({ kind: 'face', name });
const SHELLED = 15552;

const shell = (thickness = '2'): Feature[] => [
  sketch('s', front, rectangle('r', -30, -20, 60, 40)),
  extrude('e', 's', 'boss', { type: 'blind', depth: '30' }),
  { id: 'sh1', type: 'shell', name: 'sh1', suppressed: false, faces: [face('e:cap:end')], thickness } as Feature,
];
/** The name of the inside of the floor of the shell. */
function floorOf(thickness = '2'): string {
  const r = rebuild(build(...shell(thickness)));
  const i = r.body!.topology.faces.findIndex((f) => f.normal && f.normal[2] > 0.99 && Math.abs(f.center[2] - Number(thickness)) < 1e-6);
  expect(i).toBeGreaterThanOrEqual(0);
  return r.body!.names.faces[i]!;
}
/** A sketch of free points on the face `plane` (positions on the face, from where the origin of the part is on it). */
const points = (id: string, plane: Ref, ...pts: [string, number, number][]): Feature => ({ ...sketch(id, plane), entities: pts.map(([p, x, y]) => ({ id: p, type: 'point', x, y })) }) as Feature;
const boss = (extra: Record<string, unknown> = {}): Feature => ({ id: 'sb1', type: 'screwBoss', name: 'sb1', suppressed: false, sketch: 'sk', diameter: '6', holeDiameter: '2.5', height: '10', ...extra }) as Feature;
const R = 3;
const rh = 1.25;
const column = (height: number, depth: number, top = R) => (Math.PI * height * (R * R + R * top + top * top)) / 3 - Math.PI * rh * rh * depth;

describe('a boss on the inside of the floor of a shell', () => {
  let floor: string;
  const doc = (...more: Feature[]) => build(...shell(), points('sk', face(floor), ['p1', 15, 10]), ...more);
  beforeAll(() => {
    floor = floorOf();
  });

  it('a column Ø6 and 10 high with a Ø2.5 pilot hole all the way down: π(3²·10 − 1.25²·10) = 233.656 mm³ on the body, one solid, valid; its wall is named after the point', () => {
    const r = rebuild(doc(boss()));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(SHELLED + column(10, 10), 5);
    expect(column(10, 10)).toBeCloseTo(233.656, 3);
    expect(kernel.solidCount(r.body!.shape)).toBe(1);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    const names = r.body!.names.faces;
    const wall = r.body!.topology.faces[names.indexOf('sb1:side:sk.p1.wall')]!;
    expect(wall.area).toBeCloseTo(2 * Math.PI * 3 * 10, 5);
    expect(wall.center[2]).toBeCloseTo(7, 6); // the middle of the column, 2 (the floor) + 5
    // the point is where it was drawn: 15 and 10 from the middle of the floor, whichever way the sketch's axes run
    expect(Math.hypot(wall.center[0], wall.center[1])).toBeLessThanOrEqual(Math.hypot(15, 10) + 1e-6);
    const top = r.body!.topology.faces[names.indexOf('sb1:side:sk.p1.top')]!;
    expect(top.area).toBeCloseTo(Math.PI * (9 - 1.5625), 5);
    expect(top.center[2]).toBeCloseTo(12, 6);
    expect(new Set(names).size).toBe(names.length);
  });

  it('with the hole 8 deep (its bottom 2 up from the floor): π(3²·10 − 1.25²·8) = 243.47 mm³', () => {
    const r = rebuild(doc(boss({ holeDepth: '8' })));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(SHELLED + column(10, 8), 5);
    const bottom = r.body!.topology.faces[r.body!.names.faces.indexOf('sb1:side:sk.p1.bottom')]!;
    expect(bottom.center[2]).toBeCloseTo(4, 6);
    expect(bottom.area).toBeCloseTo(Math.PI * 1.25 * 1.25, 5);
  });

  it('with 2° of draft on the wall (3 at the foot, 3 − 10·tan 2° at the top): the frustum, π·10/3·(R² + R·Rt + Rt²) − π·1.25²·10', () => {
    const top = R - 10 * Math.tan((2 * Math.PI) / 180);
    const r = rebuild(doc(boss({ draft: '2deg' })));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(SHELLED + column(10, 10, top), 5);
    expect(r.body!.topology.faces[r.body!.names.faces.indexOf('sb1:side:sk.p1.wall')]!.surface).toBe('cone');
  });

  it('with three gussets (1 thick, reaching 3 out, 6 up the wall): each is the triangle outside the wall, integrated here, and there are three of them, named by number', () => {
    const e = (R - rh) / 2;
    // the gusset's triangle: from (R − e, 6) down to (R + 3, 0) along the floor, 1 thick; what is outside the column is the part past x = √(R² − y²) at each y across the thickness
    let rib = 0;
    const N = 4000;
    for (let k = 0; k < N; k++) {
      const y = -0.5 + ((k + 0.5) * 1) / N;
      const x0 = Math.sqrt(R * R - y * y);
      const slope = 6 / (R + 3 - (R - e));
      rib += ((slope * (R + 3 - x0) ** 2) / 2) * (1 / N);
    }
    const r = rebuild(doc(boss({ ribs: { count: '3', thickness: '1', length: '3', height: '6' } })));
    expect(failures(r)).toEqual([]);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(volume(r)).toBeCloseTo(SHELLED + column(10, 10) + 3 * rib, 3);
    const names = r.body!.names.faces;
    for (const k of [0, 1, 2]) expect(names.some((n) => n.startsWith('sb1:side:sk.p1.rib' + k))).toBe(true);
    expect(names.some((n) => n.startsWith('sb1:side:sk.p1.rib3'))).toBe(false);
    expect(new Set(names).size).toBe(names.length);
  });

  it('two points make two columns', () => {
    const r = rebuild(build(...shell(), points('sk', face(floor), ['p1', 15, 10], ['p2', -15, -10]), boss()));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(SHELLED + 2 * column(10, 10), 5);
    expect(r.body!.names.faces).toContain('sb1:side:sk.p2.wall');
  });

  it('follows the model: the floor 3 thick instead of 2, the column stands 1 higher (its top at z = 13), with the same volume on the body and the same names', () => {
    const base = rebuild(build(...shell(), points('sk', face(floor), ['p1', 15, 10]), boss()));
    let d = doc(boss());
    d = applyCommand(d, { type: 'setShell', featureId: 'sh1', faces: [face('e:cap:end')], thickness: '3' });
    const r = rebuild(d);
    expect(failures(r)).toEqual([]);
    const without = rebuild(build(...shell('3')));
    expect(volume(r) - volume(without)).toBeCloseTo(column(10, 10), 5);
    expect(r.body!.topology.faces[r.body!.names.faces.indexOf('sb1:side:sk.p1.top')]!.center[2]).toBeCloseTo(13, 6);
    expect(r.body!.names.faces.filter((n) => n.startsWith('sb1:')).sort()).toEqual(base.body!.names.faces.filter((n) => n.startsWith('sb1:')).sort());
  });
});

describe('what is refused', () => {
  let floor: string;
  beforeAll(() => {
    floor = floorOf();
  });
  const message = (extra: Record<string, unknown>) => {
    const r = rebuild(build(...shell(), points('sk', face(floor), ['p1', 15, 10]), boss(extra)));
    return r.features.find((f) => f.id === 'sb1')!;
  };

  it('a hole as wide as the column or wider, a hole deeper than the column is high, so much draft that the top is narrower than the hole, a number of ribs that is not 1 to 8, a rib higher than the column', () => {
    expect(message({ holeDiameter: '6' })).toMatchObject({ status: 'error', message: expect.stringContaining('孔徑') });
    expect(message({ holeDepth: '12' })).toMatchObject({ status: 'error', message: expect.stringContaining('孔深') });
    expect(message({ draft: '20deg' })).toMatchObject({ status: 'error', message: expect.stringContaining('拔模') });
    expect(message({ ribs: { count: '9', thickness: '1', length: '3', height: '6' } })).toMatchObject({ status: 'error', message: expect.stringContaining('肋') });
    expect(message({ ribs: { count: '3', thickness: '1', length: '3', height: '12' } })).toMatchObject({ status: 'error', message: expect.stringContaining('肋') });
  });

  it('a column that stands on nothing (a sketch on a plane 100 above the box) is said not to join the body', () => {
    const plane = { id: 'pl', type: 'refPlane', name: 'pl', suppressed: false, def: { mode: 'offset', plane: front, distance: '100' } } as Feature;
    const r = rebuild(build(...shell(), plane, points('sk', { kind: 'datum', name: 'pl' }, ['p1', 0, 0]), boss()));
    expect(r.features.find((f) => f.id === 'sb1')).toMatchObject({ status: 'error', message: expect.stringContaining('沒有接到') });
  });

  it('a size that is not above 0 is refused where it is given', () => {
    expect(() => build(...shell(), points('sk', face(floor), ['p1', 0, 0]), boss({ height: '0' }))).toThrow();
    expect(() => build(...shell(), points('sk', face(floor), ['p1', 0, 0]), boss({ diameter: '-6' }))).toThrow();
  });
});

describe('the command and the file', () => {
  it('setScrewBoss changes the sizes and takes the gussets away; the version is 34', () => {
    const floor = floorOf();
    let doc = build(...shell(), points('sk', face(floor), ['p1', 15, 10]), boss({ ribs: { count: '3', thickness: '1', length: '3', height: '6' } }));
    const get = () => doc.features.find((f) => f.id === 'sb1') as unknown as { ribs?: unknown; height: string };
    expect(get().ribs).toBeDefined();
    doc = applyCommand(doc, { type: 'setScrewBoss', featureId: 'sb1', boss: { diameter: '6', holeDiameter: '2.5', height: '8' } });
    expect(get().ribs).toBeUndefined();
    expect(get().height).toBe('8');
    expect(volume(rebuild(doc))).toBeCloseTo(SHELLED + column(8, 8), 5);
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
  });
});
