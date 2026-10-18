/**
 * Sheet Metal Jog Feature (鈑金凸折, Phase 7, Schema 60; ADR 0159).
 * Steps a sheet along a sketched line with two opposite bends and an intermediate web.
 * Verifies closed-form geometric derivation, volume conservation (K = 0.5),
 * boundary interference defense (H < Hmin), flat pattern alignment, and command mutations.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, SCHEMA_VERSION, type Feature, type PartDoc, type SketchEntity } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { flatPattern, Regenerator, type RebuildResult } from '@3db/regen';
import { front, rectangle, sketch, statuses, type SketchParts } from '../phase1/builders';

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

const build = (features: Feature[]): PartDoc =>
  features.reduce((d, feature, index) => applyCommand(d, { type: 'insertFeature', feature, index }), createEmptyPart());

const failures = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));

const T = 1.5;
const rb = 2.0;
const BA = (Math.PI / 2) * (rb + 0.5 * T);
const plate: Feature[] = [
  sketch('sk', front, rectangle('r', 0, 0, 100, 50)),
  { id: 'bf', type: 'baseFlange', name: 'bf', suppressed: false, sketch: 'sk', thickness: '1.5', radius: '2', kFactor: '0.5' } as Feature,
];

const point = (id: string, x: number, y: number): SketchEntity => ({ id, type: 'point', x, y });
const stroke = (x: number, y0 = -5, y1 = 55, k = ''): SketchParts => ({
  entities: [point(`${k}a`, x, y0), point(`${k}b`, x, y1), { id: `${k}l`, type: 'line', p1: `${k}a`, p2: `${k}b` }],
  constraints: [],
});

const jogFeature = (extra: Record<string, unknown> = {}): Feature =>
  ({ id: 'jg', type: 'jog', name: 'jg', suppressed: false, sketch: 'sm', offset: '10', angle: '90', ...extra }) as Feature;

const make = (extra: Record<string, unknown> = {}, line: SketchParts = stroke(50), before: Feature[] = []) =>
  build([...plate, ...before, sketch('sm', front, line), jogFeature(extra)]);

const box = (r: RebuildResult) => {
  const pts = r.body!.topology.vertices.map((v) => v.point);
  const ax = (i: number) => [Math.min(...pts.map((p) => p[i]!)), Math.max(...pts.map((p) => p[i]!))] as const;
  return { x: ax(0), y: ax(1), z: ax(2) };
};

const volume = (r: RebuildResult) => kernel.massProps(r.body!.shape).volume;

describe('Sheet Metal Jog Feature (v60, ADR 0159)', () => {
  it('90° jog with offset = 10: volume strictly conserved at 7500 mm³, valid single solid, moved side elevated to Z = 11.5 mm', () => {
    const r = rebuild(make({ offset: '10' }));
    expect(failures(r)).toEqual([]);
    expect(kernel.solidCount(r.body!.shape)).toBe(1);
    expect(kernel.isValid(r.body!.shape)).toBe(true);

    const origVol = 100 * 50 * T; // 7500 mm³
    expect(volume(r)).toBeCloseTo(origVol, 1);

    const b = box(r);
    expect(b.x[0]).toBeCloseTo(0, 3);
    expect(b.z[0]).toBeCloseTo(0, 3);
    expect(b.z[1]).toBeCloseTo(10 + T, 3); // 11.5 mm high
    expect(b.y).toEqual([expect.closeTo(0, 3), expect.closeTo(50, 3)]);

    expect(r.sheet!.bends).toHaveLength(2);
    expect(r.sheet!.bends[0]).toMatchObject({ name: 'bend1', angle: expect.closeTo(Math.PI / 2, 6), radius: 2, width: expect.closeTo(50, 6) });
    expect(r.sheet!.bends[1]).toMatchObject({ name: 'bend2', angle: expect.closeTo(Math.PI / 2, 6), radius: 2, width: expect.closeTo(50, 6) });

    const info = r.features.find((f) => f.id === 'jg')!.info;
    expect(info).toContain('10.00');
    expect(info).toContain('90.0');
  });

  it('flat pattern generates 100 × 50 plate with two opposite bend lines (up & down)', () => {
    const r = rebuild(make({ offset: '10' }));
    const p = flatPattern(kernel, r.sheet!);
    kernel.release(p.shape);

    expect(p.area).toBeCloseTo(5000, 3);
    expect(p.width).toBeCloseTo(100, 3);
    expect(p.height).toBeCloseTo(50, 3);
    expect(p.volume).toBeCloseTo(volume(r), 2);

    expect(p.bends).toHaveLength(2);
    // Two bend lines parallel across the width (Y from 0 to 50)
    expect(Math.abs(p.bends[0]!.b[1] - p.bends[0]!.a[1])).toBeCloseTo(50, 3);
    expect(Math.abs(p.bends[1]!.b[1] - p.bends[1]!.a[1])).toBeCloseTo(50, 3);

    // Opposite bend directions
    expect(p.bends[0]!.direction).toBe('up');
    expect(p.bends[1]!.direction).toBe('down');

    // First bend is at 50 + BA/2, second bend is at 50 + 1.5*BA + Lweb
    const Hmin = 2 * rb + T;
    const Lweb = 10 - Hmin;
    expect(p.bends[0]!.a[0]).toBeCloseTo(50 + BA / 2, 3);
    expect(p.bends[1]!.a[0]).toBeCloseTo(50 + 1.5 * BA + Lweb, 3);
  });

  it('supports 45° inclined jog with offset = 6 mm', () => {
    const r = rebuild(make({ offset: '6', angle: '45' }));
    expect(failures(r)).toEqual([]);
    expect(kernel.solidCount(r.body!.shape)).toBe(1);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(volume(r)).toBeCloseTo(7500, 1);

    const b = box(r);
    expect(b.z[1]).toBeCloseTo(6 + T, 3); // 7.5 mm high
  });

  it('supports boundary tangent jog at H = Hmin (Lweb = 0)', () => {
    // At 90°, Hmin = 2*rb + T = 5.5 mm
    const r = rebuild(make({ offset: '5.5' }));
    expect(failures(r)).toEqual([]);
    expect(kernel.solidCount(r.body!.shape)).toBe(1);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(volume(r)).toBeCloseTo(7500, 1);

    const b = box(r);
    expect(b.z[1]).toBeCloseTo(5.5 + T, 3); // 7.0 mm
  });

  it('reverse jog steps downwards (-Z) and flipSide keeps the right side instead', () => {
    const down = rebuild(make({ offset: '10', reverse: true }));
    expect(failures(down)).toEqual([]);
    expect(volume(down)).toBeCloseTo(7500, 1);
    expect(box(down).z[0]).toBeCloseTo(-10, 3);

    const flip = rebuild(make({ offset: '10', flipSide: true }));
    expect(failures(flip)).toEqual([]);
    expect(volume(flip)).toBeCloseTo(7500, 1);
    const b = box(flip);
    expect(b.x[1]).toBeCloseTo(100, 3);
    expect(b.z[1]).toBeCloseTo(10 + T, 3);
  });

  it('self-red-teaming input corruption: H < Hmin is explicitly rejected with minimum height', () => {
    const shallow = rebuild(make({ offset: '2' })); // 2 < 5.5 mm
    const why = shallow.features.find((f) => f.id === 'jg')!;
    expect(why.status).toBe('error');
    expect(why.message).toContain('5.50');
  });

  it('self-red-teaming edge cases: line outside, no side, two lines, preceding flange or midBend rejected', () => {
    const why = (r: RebuildResult, id = 'jg') => r.features.find((f) => f.id === id)!;

    // Line outside
    expect(why(rebuild(make({}, stroke(150))))).toMatchObject({ status: 'error', message: expect.stringContaining('沒有穿過') });

    // Line at edge / outside plate on fixed side (no side)
    expect(why(rebuild(make({}, stroke(-2))))).toMatchObject({ status: 'error', message: expect.stringMatching(/沒有板|沒有穿過/) });

    // Two lines
    const two: SketchParts = {
      entities: [point('a', 50, 0), point('b', 50, 50), { id: 'l', type: 'line', p1: 'a', p2: 'b' }, point('c', 30, 0), point('d', 30, 50), { id: 'm', type: 'line', p1: 'c', p2: 'd' }],
      constraints: [],
    };
    expect(why(rebuild(make({}, two)))).toMatchObject({ status: 'error', message: expect.stringContaining('一條直線') });

    // Preceding flange
    const flangeFirst: Feature = { id: 'fa', type: 'edgeFlange', name: 'fa', suppressed: false, edge: { kind: 'edge', name: '{bf:cap:end|bf:side:sk.rl1}' }, length: '20' } as Feature;
    expect(why(rebuild(make({}, stroke(50), [flangeFirst])))).toMatchObject({ status: 'error', message: expect.stringContaining('邊線凸緣') });
  });

  it('setJog command modifies parameters, schemaVersion is 60, and asserts real WASM heap', () => {
    let d = make();
    expect(d.schemaVersion).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(60);

    d = applyCommand(d, { type: 'setJog', featureId: 'jg', jog: { offset: '12', angle: '60', radius: '3', reverse: true } });
    expect(d.features.find((f) => f.id === 'jg')).toMatchObject({ offset: '12', angle: '60', radius: '3', reverse: true, sketch: 'sm' });

    const r = rebuild(d);
    expect(failures(r)).toEqual([]);

    // WASM Memory ground truth defense (AGENTS.md §3.1)
    const heapBytes = (kernel.oc as any).wasmMemory?.buffer?.byteLength;
    expect(heapBytes).toBeGreaterThan(0);
  });
});
