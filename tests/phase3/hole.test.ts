/**
 * Phase 3a-6a (C4.8): the hole wizard. A hole of one of four kinds at every free point of a sketch on a face, cut into the material. Volumes are
 * hand-calculated from the shape of each hole, every face of every hole has a name of its own, and what comes after finds its edges (ADR 0030).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, holeSize, ISO_HOLE_SIZES, type Feature, type HoleFeature, type PartDoc } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { build, edge, extrude, face, fillet, front, rectangle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const rebuild = (doc: PartDoc) => new Regenerator(kernel, solver, new Map()).rebuild(doc);
const failures = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));
const volume = (r: RebuildResult) => r.bodies.reduce((v, b) => v + kernel.massProps(b.shape).volume, 0);

/** A 40 × 30 plate centred on the origin, 10 thick; the sketch on its top face e1:cap:end has its origin at the middle of the plate. */
const plate = (): Feature[] => [sketch('s1', front, rectangle('a', -20, -15, 40, 30)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' })];
const at = (...pts: [number, number][]): Feature =>
  ({ ...sketch('s2', face('e1:cap:end')), entities: pts.map(([x, y], i) => ({ id: `p${i + 1}`, type: 'point', x, y })) }) as Feature;
const hole = (extra: Partial<HoleFeature>): Feature => ({ id: 'h1', type: 'hole', name: 'h1', suppressed: false, sketch: 's2', kind: 'straight', diameter: '6', end: { type: 'blind', depth: '5' }, ...extra }) as Feature;
const make = (extra: Partial<HoleFeature>, ...pts: [number, number][]) => build(...plate(), at(...(pts.length > 0 ? pts : [[0, 0] as [number, number]])), hole(extra));

describe('the hole wizard (C4.8)', () => {
  it('a straight blind hole: the plate loses a cylinder of Ø6 and 5 deep; through all, one 10 deep', () => {
    const blind = rebuild(make({}));
    expect(failures(blind)).toEqual([]);
    expect(volume(blind)).toBeCloseTo(12000 - Math.PI * 9 * 5, 6);
    expect(kernel.isValid(blind.body!.shape)).toBe(true);
    const through = rebuild(make({ end: { type: 'throughAll' } }));
    expect(failures(through)).toEqual([]);
    expect(volume(through)).toBeCloseTo(12000 - Math.PI * 9 * 10, 6);
  });

  it('a counterbore: Ø11 for 3, then Ø6 to a depth of 8', () => {
    const r = rebuild(make({ kind: 'counterbore', cbDiameter: '11', cbDepth: '3', end: { type: 'blind', depth: '8' } }));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(12000 - Math.PI * (5.5 * 5.5 * 3 + 9 * 5), 6);
    const names = r.body!.names.faces.filter((n) => n.startsWith('h1:'));
    expect(names).toEqual(expect.arrayContaining(['h1:side:s2.p1.cbwall', 'h1:side:s2.p1.cbfloor', 'h1:side:s2.p1.wall', 'h1:side:s2.p1.bottom']));
  });

  it('a countersink: Ø12 at the surface, 90°, narrowing to Ø6 over 3, then straight to 8: a cone frustum and a cylinder', () => {
    const r = rebuild(make({ kind: 'countersink', csDiameter: '12', csAngle: '90deg', end: { type: 'blind', depth: '8' } }));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(12000 - Math.PI * (3 * (36 + 18 + 9)) / 3 - Math.PI * 9 * 5, 6);
    expect(r.body!.names.faces).toContain('h1:side:s2.p1.cone');
  });

  it('a tapped hole is drilled to the tap size of its standard (M6: Ø5)', () => {
    const size = holeSize('M6')!;
    expect(size.tapDrill).toBe(5);
    expect(ISO_HOLE_SIZES.map((s) => s.name)).toEqual(['M3', 'M4', 'M5', 'M6', 'M8', 'M10', 'M12', 'M16', 'M20']);
    const r = rebuild(make({ kind: 'tapped', size: 'M6', diameter: String(size.tapDrill), end: { type: 'blind', depth: '8' } }));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(12000 - Math.PI * 6.25 * 8, 6);
  });

  it('a hole at every point: two Ø6 holes of 4, each face named for its own point', () => {
    const r = rebuild(make({ end: { type: 'blind', depth: '4' } }, [-10, 0], [10, 0]));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(12000 - 2 * Math.PI * 9 * 4, 6);
    const names = r.body!.names.faces;
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain('h1:side:s2.p1.wall');
    expect(names).toContain('h1:side:s2.p2.wall');
  });

  it('what follows finds its edges: a fillet of the plate before and a fillet of the plate bottom after, and a wider plate keeps the hole', () => {
    const doc = build(...plate(), fillet('f0', [edge('{e1:cap:start|e1:side:s1.al0}')], '1'), at([0, 0]), hole({ end: { type: 'throughAll' } }), fillet('f1', [edge('{e1:cap:start|e1:side:s1.al2}')], '1'));
    const r = rebuild(doc);
    expect(failures(r)).toEqual([]);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    const wider = rebuild(applyCommand(make({ end: { type: 'throughAll' } }), { type: 'setDimension', featureId: 's1', constraintId: 'aw', value: '50' }));
    expect(failures(wider)).toEqual([]);
    expect(volume(wider)).toBeCloseTo(50 * 30 * 10 - Math.PI * 90, 6);
  });

  it('says what is wrong: no point, a point off the plate, a counterbore that is not wider, a countersink too deep', () => {
    expect(failures(rebuild(build(...plate(), { ...sketch('s2', face('e1:cap:end')) } as Feature, hole({}))))[0]).toContain('沒有可以放孔的點');
    expect(failures(rebuild(make({}, [60, 0])))[0]).toContain('p1');
    expect(failures(rebuild(make({ kind: 'counterbore', cbDiameter: '5', cbDepth: '3' })))[0]).toContain('沉頭');
    expect(failures(rebuild(make({ kind: 'countersink', csDiameter: '30', csAngle: '60deg' })))[0]).toContain('錐');
    expect(() => make({ diameter: '0' })).toThrow('必須大於 0');
  });
});
