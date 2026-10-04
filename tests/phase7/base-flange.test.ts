/**
 * 7-1 (docs/phase7-plan.md): the base flange (C11.1) — a plate from a closed profile, a bent sheet from an open polyline — against volumes and flat lengths worked out by
 * hand (T = 1.5, inner radius r = 2): the section of a bent sheet is T × (the straight pieces + θ·(r + T/2)), and the flat length is the straight pieces plus the bend
 * allowances θ·(r + K·T). The U channel is the one of the spike (ADR 0083): outer 60 wide, 20 high, 40 long, so R = r + T = 3.5.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, SCHEMA_VERSION, type Feature, type PartDoc } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { build, circle, front, rectangle, sketch, statuses } from '../phase1/builders';

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
const T = 1.5;
const r0 = 2;
const flange = (extra: Record<string, unknown> = {}): Feature => ({ id: 'bf', type: 'baseFlange', name: 'bf', suppressed: false, sketch: 'sk', thickness: '1.5', radius: '2', kFactor: '0.5', depth: '40', ...extra }) as Feature;
/** A sketch of one polyline in the order given (the walk starts at the first point). */
const polyline = (...pts: [number, number][]): Feature =>
  ({
    ...sketch('sk', front),
    entities: [...pts.map(([x, y], i) => ({ id: `p${i}`, type: 'point', x, y })), ...pts.slice(1).map((_, i) => ({ id: String.fromCharCode(97 + i), type: 'line', p1: `p${i}`, p2: `p${i + 1}` }))],
  }) as Feature;
const U: [number, number][] = [[0, 20], [0, 0], [60, 0], [60, 20]];
const R = r0 + T;

describe('a plate from a closed profile', () => {
  it('60 × 40 × 1.5 = 3600 mm³, one solid, the sheet data a plate with no bends', () => {
    const r = rebuild(build({ ...sketch('sk', front, rectangle('r', 0, 0, 60, 40)) } as Feature, flange()));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(60 * 40 * T, 6);
    expect(kernel.solidCount(r.body!.shape)).toBe(1);
    expect(r.sheet).toEqual({ thickness: T, radius: r0, kFactor: 0.5, bends: [], flanges: [], flatLength: null });
    expect(r.body!.names.faces).toContain('bf:cap:end');
    expect(kernel.bounds(r.body!.shape).max[2]).toBeCloseTo(T, 6);
  });

  it('a hole in the profile is a hole in the plate; reversed, the plate grows the other way', () => {
    const doc = (extra: Record<string, unknown> = {}) => build(sketch('sk', front, rectangle('r', 0, 0, 60, 40), circle('c', 15, 20, 5)), flange(extra));
    const r = rebuild(doc());
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo((2400 - Math.PI * 25) * T, 5);
    const back = rebuild(doc({ reverse: true }));
    expect(kernel.bounds(back.body!.shape).min[2]).toBeCloseTo(-T, 6);
    expect(kernel.bounds(back.body!.shape).max[2]).toBeCloseTo(0, 6);
  });
});

describe('a bent sheet from an open polyline', () => {
  const doc = (extra: Record<string, unknown> = {}, pts = U) => build(polyline(...pts), flange(extra));

  it('the U channel (the path is its outer face): T × (2(20 − R) + (60 − 2R) + 2·(π/2)(r + T/2)) × 40 = 5678.3 mm³, four cylinders, one valid solid', () => {
    const r = rebuild(doc());
    expect(failures(r)).toEqual([]);
    const centerline = 2 * (20 - R) + (60 - 2 * R) + 2 * (Math.PI / 2) * (r0 + T / 2);
    expect(centerline).toBeCloseTo(94.639, 3);
    expect(volume(r)).toBeCloseTo(T * centerline * 40, 5);
    expect(kernel.solidCount(r.body!.shape)).toBe(1);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(r.body!.topology.faces.filter((f) => f.surface === 'cylinder')).toHaveLength(4);
    // the sheet is inside the path: x 0..60, y 0..20 (the path is the outside), z 0..40
    const b = kernel.bounds(r.body!.shape);
    expect([b.min[0], b.max[0], b.min[1], b.max[1]].map((x) => Math.round(x * 1e6) / 1e6 + 0)).toEqual([0, 60, 0, 20]);
    expect(b.max[2]).toBeCloseTo(40, 6);
  });

  it('the bends are recorded: two of 90°, inner radius 2, 40 wide, with the allowance (π/2)(2 + K·1.5); and the flat length is 86 + 2 allowances (K 0.5: 94.639)', () => {
    const r = rebuild(doc());
    const sheet = r.sheet!;
    expect(sheet.bends.map((b) => b.name)).toEqual(['bend1', 'bend2']);
    for (const b of sheet.bends) {
      expect(b.angle).toBeCloseTo(Math.PI / 2, 9);
      expect(b.radius).toBe(r0);
      expect(b.width).toBe(40);
      expect(b.allowance).toBeCloseTo((Math.PI / 2) * (r0 + 0.5 * T), 9);
    }
    expect(sheet.flatLength).toBeCloseTo(2 * (20 - R) + (60 - 2 * R) + 2 * (Math.PI / 2) * (r0 + 0.5 * T), 9);
    expect(r.features.find((f) => f.id === 'bf')!.info).toContain('94.639');
    // K 0.4: each allowance shorter by (π/2)·0.1·T
    const k4 = rebuild(doc({ kFactor: '0.4' }));
    expect(k4.sheet!.flatLength).toBeCloseTo(86 + 2 * (Math.PI / 2) * (r0 + 0.4 * T), 9);
    expect(k4.sheet!.flatLength).toBeCloseTo(94.639 - 2 * (Math.PI / 2) * 0.1 * T, 3);
    expect(volume(k4)).toBeCloseTo(volume(r), 8); // K does not change the folded sheet
  });

  it('the flat length is the volume over T and the width at K = 0.5, whatever the shape (the sheet\'s volume is conserved)', () => {
    for (const pts of [U, [[0, 0], [30, 0], [50, 20]] as [number, number][], [[0, 0], [40, 0], [40, 25], [70, 25]] as [number, number][]]) {
      const r = rebuild(doc({}, pts));
      expect(failures(r)).toEqual([]);
      expect(volume(r) / (T * 40)).toBeCloseTo(r.sheet!.flatLength!, 6);
    }
  });

  it('a bend of 45° (the path turns toward the thickness): the allowance is (π/4)(r + K·T), the tangent length (r + T)·tan 22.5°', () => {
    const r = rebuild(doc({}, [[0, 0], [30, 0], [50, 20]]));
    expect(failures(r)).toEqual([]);
    const [b] = r.sheet!.bends;
    expect(b!.angle).toBeCloseTo(Math.PI / 4, 9);
    const tangent = R * Math.tan(Math.PI / 8);
    const straight = 30 - tangent + (Math.hypot(20, 20) - tangent);
    expect(r.sheet!.flatLength).toBeCloseTo(straight + (Math.PI / 4) * (r0 + 0.5 * T), 9);
    expect(volume(r)).toBeCloseTo(T * 40 * (straight + (Math.PI / 4) * (r0 + T / 2)), 5);
  });

  it('with the thickness on the other side the path is the inner face: legs 20 − r, bottom 60 − 2r, and the sheet grows outside the path (x from −1.5 to 61.5)', () => {
    const r = rebuild(doc({ flipSide: true }));
    expect(failures(r)).toEqual([]);
    const straight = 2 * (20 - r0) + (60 - 2 * r0);
    expect(r.sheet!.flatLength).toBeCloseTo(straight + 2 * (Math.PI / 2) * (r0 + 0.5 * T), 9);
    expect(volume(r)).toBeCloseTo(T * 40 * (straight + 2 * (Math.PI / 2) * (r0 + T / 2)), 5);
    const b = kernel.bounds(r.body!.shape);
    expect(b.min[0]).toBeCloseTo(-T, 6);
    expect(b.max[0]).toBeCloseTo(60 + T, 6);
  });

  it('the faces are named after the sketch: the flat faces and their other faces (`_l`), the bends (`bend1`, `bend1_l`), the ends, the two sides; the names do not change with the radius, the thickness or the K-factor', () => {
    const r = rebuild(doc());
    const names = r.body!.names.faces;
    for (const n of ['a', 'a_l', 'b', 'b_l', 'c', 'c_l', 'bend1', 'bend1_l', 'bend2', 'bend2_l', 'a_s', 'c_e']) expect(names).toContain(`bf:side:sk.${n}`);
    expect(names).toContain('bf:cap:start');
    expect(names).toContain('bf:cap:end');
    expect(new Set(names).size).toBe(names.length);
    let d = doc();
    d = applyCommand(d, { type: 'setBaseFlange', featureId: 'bf', flange: { thickness: '2', radius: '3', kFactor: '0.35', depth: '40' } });
    const r2 = rebuild(d);
    expect(failures(r2)).toEqual([]);
    expect(r2.body!.names.faces.slice().sort()).toEqual(names.slice().sort());
    expect(r2.sheet).toMatchObject({ thickness: 2, radius: 3, kFactor: 0.35 });
    const R2 = 5;
    expect(volume(r2)).toBeCloseTo(2 * 40 * (2 * (20 - R2) + (60 - 2 * R2) + 2 * (Math.PI / 2) * (3 + 1)), 5);
  });
});

describe('what is refused', () => {
  const message = (...features: Feature[]) => rebuild(build(...features)).features.find((f) => f.id === 'bf')!;

  it('a profile with an arc, a leg too short for the bends, a path that doubles back, an open profile with no width, two outlines', () => {
    const arc = { ...sketch('sk', front), entities: [{ id: 'p0', type: 'point', x: 0, y: 0 }, { id: 'p1', type: 'point', x: 10, y: 0 }, { id: 'p2', type: 'point', x: 10, y: 10 }, { id: 'pc', type: 'point', x: 10, y: 0 }, { id: 'a', type: 'line', p1: 'p0', p2: 'p1' }, { id: 'b', type: 'arc', center: 'pc', start: 'p1', end: 'p2' }] } as Feature;
    expect(message(arc, flange())).toMatchObject({ status: 'error', message: expect.stringContaining('直線') });
    expect(message(polyline([0, 20], [0, 0], [60, 0], [60, 3]), flange())).toMatchObject({ status: 'error', message: expect.stringMatching(/太短.*要 3\.500/) });
    expect(message(polyline([0, 0], [10, 0], [0, 0.001]), flange())).toMatchObject({ status: 'error', message: expect.stringContaining('折回') });
    expect(message(polyline(...U), flange({ depth: undefined }))).toMatchObject({ status: 'error', message: expect.stringContaining('寬度') });
    const two = { ...sketch('sk', front, rectangle('r', 0, 0, 10, 10)), entities: [...((sketch('sk', front, rectangle('r', 0, 0, 10, 10)) as unknown as { entities: unknown[] }).entities), { id: 'q0', type: 'point', x: 20, y: 0 }, { id: 'q1', type: 'point', x: 30, y: 0 }, { id: 'ql', type: 'line', p1: 'q0', p2: 'q1' }] } as Feature;
    expect(message(two, flange())).toMatchObject({ status: 'error', message: expect.stringContaining('開放') });
  });

  it('a second base flange; a K-factor or a size outside its range is refused where it is given', () => {
    const second = { ...flange(), id: 'bf2', name: 'bf2' } as Feature;
    const r = rebuild(build(sketch('sk', front, rectangle('r', 0, 0, 60, 40)), flange(), second));
    expect(r.features.find((f) => f.id === 'bf2')).toMatchObject({ status: 'error', message: expect.stringContaining('已經有基材凸緣') });
    expect(() => build(sketch('sk', front, rectangle('r', 0, 0, 60, 40)), flange({ kFactor: '1.2' }))).toThrow();
    expect(() => build(sketch('sk', front, rectangle('r', 0, 0, 60, 40)), flange({ thickness: '0' }))).toThrow();
    expect(() => build(sketch('sk', front, rectangle('r', 0, 0, 60, 40)), flange({ radius: '-1' }))).toThrow();
  });
});

describe('the command and the file', () => {
  it('setBaseFlange is refused on another feature; the version is 36; variables drive the parameters', () => {
    let d = applyCommand(createEmptyPart(), { type: 'addVariable', variable: { id: 'v1', name: 'gauge', expr: '1.2' } });
    d = applyCommand(d, { type: 'insertFeature', feature: sketch('sk', front, rectangle('r', 0, 0, 60, 40)) as Feature, index: 0 });
    d = applyCommand(d, { type: 'insertFeature', feature: flange({ thickness: 'gauge', radius: 'gauge * 2' }), index: 1 });
    expect(volume(rebuild(d))).toBeCloseTo(2400 * 1.2, 6);
    d = applyCommand(d, { type: 'setVariable', id: 'v1', expr: '2' });
    const r = rebuild(d);
    expect(volume(r)).toBeCloseTo(2400 * 2, 6);
    expect(r.sheet).toMatchObject({ thickness: 2, radius: 4 });
    expect(() => applyCommand(d, { type: 'setBaseFlange', featureId: 'sk', flange: { thickness: '1', radius: '1', kFactor: '0.5' } })).toThrow();
    expect(d.schemaVersion).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(36);
  });
});
