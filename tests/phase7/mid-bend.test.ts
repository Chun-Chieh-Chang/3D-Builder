/**
 * The mid bend (中間折彎, S-3, v48; ADR 0111): a plate 100 × 50 × 1.5 (inside radius 2, K 0.5) bent along the line x = 50 of a sketch. The zone of the bend is centred on the line and
 * as wide as the bend allowance BA = θ(r + K·T) (90°: 4.3197), so the part before it stays (x up to 50 − BA/2 = 47.84), the part after it is slid up to the start of the zone and turned
 * about the axis of the bend (the axis is r = 2 from the face the plate folds toward: at z = T + r = 3.5). By hand: at K 0.5 the volume of the bent plate is that of the flat one,
 * 7500 mm³; the outside of the bend reaches x = 47.84 + r + T = 51.34; the end of the part that turned is 3.5 + (50 − BA/2) = 51.34 high; the flat pattern is the plate, 100 × 50, with
 * one bend line along x = 50.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, SCHEMA_VERSION, type Feature, type PartDoc, type SketchEntity } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { flatPattern, Regenerator, type RebuildResult } from '@3db/regen';
import { circle, extrude, front, rectangle, sketch, statuses, type SketchParts } from '../phase1/builders';

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
const build = (features: Feature[]): PartDoc => features.reduce((d, feature, index) => applyCommand(d, { type: 'insertFeature', feature, index }), createEmptyPart());
const failures = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));
const T = 1.5;
const rb = 2;
const BA = (Math.PI / 2) * (rb + 0.5 * T);
const plate: Feature[] = [sketch('sk', front, rectangle('r', 0, 0, 100, 50)), { id: 'bf', type: 'baseFlange', name: 'bf', suppressed: false, sketch: 'sk', thickness: '1.5', radius: '2', kFactor: '0.5' } as Feature];
const point = (id: string, x: number, y: number): SketchEntity => ({ id, type: 'point', x, y });
const stroke = (x: number, y0 = -5, y1 = 55, k = ''): SketchParts => ({ entities: [point(`${k}a`, x, y0), point(`${k}b`, x, y1), { id: `${k}l`, type: 'line', p1: `${k}a`, p2: `${k}b` }], constraints: [] });
const bendFeature = (extra: Record<string, unknown> = {}): Feature => ({ id: 'mb', type: 'midBend', name: 'mb', suppressed: false, sketch: 'sm', angle: '90', ...extra }) as Feature;
const make = (extra: Record<string, unknown> = {}, line: SketchParts = stroke(50), before: Feature[] = []) => build([...plate, ...before, sketch('sm', front, line), bendFeature(extra)]);
const box = (r: RebuildResult) => {
  const pts = r.body!.topology.vertices.map((v) => v.point);
  const ax = (i: number) => [Math.min(...pts.map((p) => p[i]!)), Math.max(...pts.map((p) => p[i]!))] as const;
  return { x: ax(0), y: ax(1), z: ax(2) };
};
const volume = (r: RebuildResult) => kernel.massProps(r.body!.shape).volume;

describe('the mid bend (v48)', () => {
  it('90° up at x = 50: the volume of the flat plate (K 0.5), one valid solid, the outside of the bend at x = 47.84 + 3.5 and the end of the part that turned 3.5 + 47.84 high', () => {
    const r = rebuild(make());
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(100 * 50 * T, 4);
    expect(kernel.solidCount(r.body!.shape)).toBe(1);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    const b = box(r);
    expect(b.x[0]).toBeCloseTo(0, 6);
    expect(b.x[1]).toBeCloseTo(50 - BA / 2 + rb + T, 6);
    expect(b.z[0]).toBeCloseTo(0, 6);
    expect(b.z[1]).toBeCloseTo(T + rb + 50 - BA / 2, 6);
    expect(b.y).toEqual([expect.closeTo(0, 6), expect.closeTo(50, 6)]);
    const names = r.body!.names.faces;
    expect(new Set(names).size).toBe(names.length);
    expect(r.sheet!.bends).toHaveLength(1);
    expect(r.sheet!.bends[0]).toMatchObject({ angle: expect.closeTo(Math.PI / 2, 9), radius: 2, width: expect.closeTo(50, 6), allowance: expect.closeTo(BA, 9) });
    expect(r.features.find((f) => f.id === 'mb')!.info).toContain('90.0');
  });

  it('the flat pattern is the plate as drawn: 100 × 50, 5000 mm², one bend line along x = 50 from y = 0 to y = 50, and the volume of the folded plate', () => {
    const r = rebuild(make());
    const p = flatPattern(kernel, r.sheet!);
    kernel.release(p.shape);
    expect(p.area).toBeCloseTo(5000, 4);
    expect(p.width).toBeCloseTo(100, 6);
    expect(p.height).toBeCloseTo(50, 6);
    expect(p.volume).toBeCloseTo(volume(r), 3);
    expect(p.bends).toHaveLength(1);
    expect(p.bends[0]!.a[0]).toBeCloseTo(50, 6);
    expect(p.bends[0]!.b[0]).toBeCloseTo(50, 6);
    expect(Math.abs(p.bends[0]!.b[1] - p.bends[0]!.a[1])).toBeCloseTo(50, 6);
    expect(p.bends[0]!.allowance).toBeCloseTo(BA, 9);
    expect(p.bends[0]!.direction).toBe('up');
  });

  it('other angles and radii: 60° at K 0.5 is 7500 again; K 0.4 and 120° is the plate less the zone plus the bend, θ·T·w·(r + T/2) − BA·w·T, by hand', () => {
    const sixty = rebuild(make({ angle: '60' }));
    expect(failures(sixty)).toEqual([]);
    expect(volume(sixty)).toBeCloseTo(7500, 4);
    const wide = rebuild(make({ angle: '120', radius: '4' }));
    expect(failures(wide)).toEqual([]);
    expect(volume(wide)).toBeCloseTo(7500, 4);
    const doc = build([plate[0]!, { ...plate[1]!, kFactor: '0.4' } as Feature, sketch('sm', front, stroke(50)), bendFeature({ angle: '120' })]);
    const k4 = rebuild(doc);
    expect(failures(k4)).toEqual([]);
    const theta = (2 * Math.PI) / 3;
    const zone = theta * (rb + 0.4 * T) * 50 * T;
    expect(volume(k4)).toBeCloseTo(7500 - zone + theta * T * 50 * (rb + T / 2), 3);
    expect(kernel.isValid(k4.body!.shape)).toBe(true);
  });

  it('the other way: folded against the sketch normal the end of the turned part is 2 + 47.84 below the plate; with the right side kept the left turns instead', () => {
    const down = rebuild(make({ reverse: true }));
    expect(failures(down)).toEqual([]);
    expect(volume(down)).toBeCloseTo(7500, 4);
    expect(box(down).z[0]).toBeCloseTo(-rb - (50 - BA / 2), 6);
    const flip = rebuild(make({ flipSide: true }));
    expect(failures(flip)).toEqual([]);
    expect(volume(flip)).toBeCloseTo(7500, 4);
    const b = box(flip);
    // the part that stays is x from 52.16 to 100, the part that turned (x < 50) rises on the far side of the bend
    expect(b.x[1]).toBeCloseTo(100, 6);
    expect(b.z[1]).toBeCloseTo(T + rb + 50 - BA / 2, 6);
    expect(b.x[0]).toBeCloseTo(50 + BA / 2 - rb - T, 6);
  });

  it('holes outside the zone come along: a hole of R3 in the part that stays takes π·9·1.5 and is a face of the result; a hole in the zone is refused, with the reason', () => {
    const hole = (x: number): Feature[] => [sketch('sh', front, circle('c', x, 25, 3)), extrude('ch', 'sh', 'cut', { type: 'blind', depth: '5', reverse: true })];
    const away = rebuild(build([...plate, ...hole(20), sketch('sm', front, stroke(50)), bendFeature()]));
    expect(failures(away)).toEqual([]);
    expect(volume(away)).toBeCloseTo(7500 - Math.PI * 9 * T, 4);
    expect(away.body!.topology.faces.some((f) => Math.abs(f.area - 2 * Math.PI * 3 * T) < 1e-3)).toBe(true);
    const turned = rebuild(build([...plate, ...hole(80), sketch('sm', front, stroke(50)), bendFeature()]));
    expect(failures(turned)).toEqual([]);
    expect(volume(turned)).toBeCloseTo(7500 - Math.PI * 9 * T, 4);
    const inZone = rebuild(build([...plate, ...hole(50), sketch('sm', front, stroke(50)), bendFeature()]));
    expect(inZone.features.find((f) => f.id === 'mb')).toMatchObject({ status: 'error', message: expect.stringContaining('折彎區') });
  });

  it('says why when it cannot: a line outside the plate, no plate on one side, two lines, not a plate, a flange before it, a flange after it, a second bend', () => {
    const why = (r: RebuildResult, id = 'mb') => r.features.find((f) => f.id === id)!;
    expect(why(rebuild(make({}, stroke(150))))).toMatchObject({ status: 'error', message: expect.stringContaining('沒有穿過') });
    expect(why(rebuild(make({}, stroke(2))))).toMatchObject({ status: 'error', message: expect.stringMatching(/沒有板|折彎區/) });
    const two: SketchParts = { entities: [point('a', 50, 0), point('b', 50, 50), { id: 'l', type: 'line', p1: 'a', p2: 'b' }, point('c', 30, 0), point('d', 30, 50), { id: 'm', type: 'line', p1: 'c', p2: 'd' }], constraints: [] };
    expect(why(rebuild(make({}, two)))).toMatchObject({ status: 'error', message: expect.stringContaining('一條直線') });
    const flangeFirst: Feature = { id: 'fa', type: 'edgeFlange', name: 'fa', suppressed: false, edge: { kind: 'edge', name: '{bf:cap:end|bf:side:sk.rl1}' }, length: '20' } as Feature;
    expect(why(rebuild(make({}, stroke(50), [flangeFirst])))).toMatchObject({ status: 'error', message: expect.stringContaining('邊線凸緣') });
    const flangeAfter = rebuild(build([...plate, sketch('sm', front, stroke(50)), bendFeature(), flangeFirst]));
    expect(why(flangeAfter, 'fa')).toMatchObject({ status: 'error', message: expect.stringContaining('中間折彎') });
    const second = rebuild(build([...plate, sketch('sm', front, stroke(50)), bendFeature(), sketch('sm2', front, stroke(20, -5, 55, 'q')), { ...bendFeature(), id: 'mb2', name: 'mb2', sketch: 'sm2' } as Feature]));
    expect(why(second, 'mb2')).toMatchObject({ status: 'error', message: expect.stringContaining('一個零件只能做一個') });
    const notSheet = rebuild(build([sketch('sk', front, rectangle('r', 0, 0, 100, 50)), extrude('e1', 'sk', 'boss', { type: 'blind', depth: '10' }), sketch('sm', front, stroke(50)), bendFeature()]));
    expect(why(notSheet)).toMatchObject({ status: 'error' });
    expect(() => make({ angle: '0' })).toThrow(); // the angle is refused where it is given, as for the edge flange
  });

  it('follows the model: the line moved to x = 60 and the plate 140 long; the same volume, the zone moves with the line', () => {
    const moved = rebuild(make({}, stroke(60)));
    expect(failures(moved)).toEqual([]);
    expect(volume(moved)).toBeCloseTo(7500, 4);
    expect(box(moved).x[1]).toBeCloseTo(60 - BA / 2 + rb + T, 6);
    const long = rebuild(build([sketch('sk', front, rectangle('r', 0, 0, 140, 50)), plate[1]!, sketch('sm', front, stroke(50)), bendFeature()]));
    expect(failures(long)).toEqual([]);
    expect(volume(long)).toBeCloseTo(140 * 50 * T, 4);
  });

  it('setMidBend carries the settings; the version is 48; the radius and the sides can be taken away again', () => {
    let d = make();
    expect(d.schemaVersion).toBe(SCHEMA_VERSION);
    d = applyCommand(d, { type: 'setMidBend', featureId: 'mb', midBend: { angle: '45', radius: '3', reverse: true } });
    expect(d.features.find((f) => f.id === 'mb')).toMatchObject({ angle: '45', radius: '3', reverse: true, sketch: 'sm' });
    expect(failures(rebuild(d))).toEqual([]);
    d = applyCommand(d, { type: 'setMidBend', featureId: 'mb', midBend: { angle: '90' } });
    expect(d.features.find((f) => f.id === 'mb')).not.toHaveProperty('radius');
    expect(() => applyCommand(d, { type: 'setMidBend', featureId: 'sk', midBend: { angle: '90' } })).toThrow();
  });
});
