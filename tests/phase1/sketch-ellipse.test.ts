/**
 * Phase 1 / Blueprint P2 (C1.5 Phase A): Sketch Ellipse and Solid Extrusion.
 *
 * Self-Red-Teaming adversarial test suite:
 * 1. Closed-form volume ground truth (Zero-Mock): V = π * a * b * h
 * 2. Adaptive radius normalization: rx < ry auto-swapped and rotated +90deg
 * 3. Rotated ellipse extrusion (any angle θ)
 * 4. Extrude cut (pocket / through-all hole)
 * 5. Input corruption defense: negative/zero minor radius, coincident points
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  sketchError,
  type Feature,
} from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { build, ellipse, extrude, front, rectangle, sketch, statuses } from './builders';

let kernel: Kernel;
let regen: Regenerator;
let solver: PlaneGcsSolver;

beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
  regen = new Regenerator(kernel, solver);
});

const volumeOf = (r: RebuildResult) => kernel.massProps(r.body!.shape).volume;

describe('sketch ellipse & 3D solid pipeline (C1.5, ADR 0157)', () => {
  it('extrudes a standard horizontal ellipse with exact closed-form volume', () => {
    // a = 30, b = 15, h = 20 -> V = π * 30 * 15 * 20 = 9000π ≈ 28274.333882
    const a = 30;
    const b = 15;
    const h = 20;
    const expectedVolume = Math.PI * a * b * h;

    const doc = build(
      sketch('s1', front, ellipse('el1', 0, 0, a, 0, b)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: String(h) }),
    );

    const r = regen.rebuild(doc);
    expect(statuses(r)).toEqual(['s1=ok', 'e1=ok']);
    expect(r.body).toBeDefined();
    expect(kernel.isValid(r.body!.shape)).toBe(true);

    // Exact closed-form volume verification
    expect(volumeOf(r)).toBeCloseTo(expectedVolume, 3);

    // Verify face topology and TNP naming
    const faceNames = r.body!.names.faces;
    expect(faceNames).toContain('e1:cap:start');
    expect(faceNames).toContain('e1:cap:end');
    expect(faceNames.some((f) => f.startsWith('e1:side:s1.el1'))).toBe(true);
  });

  it('correctly handles adaptive radius normalization when minor > major', () => {
    // User specified major point along X with dist = 10, but minorRadius = 25
    // In OCCT, major must be >= minor. The engine must auto-swap to a=25, b=10, rotated 90deg.
    // V = π * 25 * 10 * 12 = 3000π ≈ 9424.77796
    const h = 12;
    const expectedVolume = Math.PI * 25 * 10 * h;

    const doc = build(
      sketch('s1', front, ellipse('el_swapped', 0, 0, 10, 0, 25)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: String(h) }),
    );

    const r = regen.rebuild(doc);
    expect(statuses(r)).toEqual(['s1=ok', 'e1=ok']);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(volumeOf(r)).toBeCloseTo(expectedVolume, 3);
  });

  it('extrudes an inclined ellipse rotated by 45 degrees', () => {
    // Center at (10, 20), major point at (10 + 20*cos(45°), 20 + 20*sin(45°)) -> a = 20, b = 8
    // Volume should be exactly π * 20 * 8 * 15 = 2400π ≈ 7539.822368
    const a = 20;
    const b = 8;
    const h = 15;
    const angle = Math.PI / 4;
    const cx = 10;
    const cy = 20;
    const majorX = cx + a * Math.cos(angle);
    const majorY = cy + a * Math.sin(angle);

    const doc = build(
      sketch('s1', front, ellipse('el_rotated', cx, cy, majorX, majorY, b)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: String(h) }),
    );

    const r = regen.rebuild(doc);
    expect(statuses(r)).toEqual(['s1=ok', 'e1=ok']);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(volumeOf(r)).toBeCloseTo(Math.PI * a * b * h, 3);
  });

  it('cuts an elliptical through-hole in a rectangular plate', () => {
    // Plate: 80 x 60 x 10, Volume = 48000
    // Ellipse Hole: a = 20, b = 10, through all (depth = 10)
    // Cut volume = π * 20 * 10 * 10 = 2000π ≈ 6283.1853
    // Final Volume = 48000 - 2000π ≈ 41716.81469
    const plateVol = 80 * 60 * 10;
    const holeVol = Math.PI * 20 * 10 * 10;
    const expectedVol = plateVol - holeVol;

    const doc = build(
      sketch('s1', front, rectangle('plate', 0, 0, 80, 60)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }),
      sketch('s2', front, ellipse('hole', 40, 30, 60, 30, 10)),
      extrude('c1', 's2', 'cut', { type: 'throughAll', reverse: true }),
    );

    const r = regen.rebuild(doc);
    expect(statuses(r)).toEqual(['s1=ok', 'e1=ok', 's2=ok', 'c1=ok']);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(volumeOf(r)).toBeCloseTo(expectedVol, 1);
    expect(Math.abs(volumeOf(r) - expectedVol) / expectedVol).toBeLessThan(1e-5);
    expect(r.body!.names.faces.some((f) => f.startsWith('c1:side:s2.hole'))).toBe(true);
  });

  it('revolves an ellipse about an external axis to form a torus-like solid', () => {
    // Axis along Y (x = 0). Center at (30, 0), major = 10 along X, minor = 5 along Y.
    // Pappus's Centroid Theorem: V = 2π * R * Area = 2π * 30 * (π * 10 * 5) = 3000 * π^2 ≈ 29608.8132
    const R = 30;
    const a = 10;
    const b = 5;
    const expectedVol = 2 * Math.PI * R * (Math.PI * a * b);

    const el = ellipse('el_rev', R, 0, R + a, 0, b);
    const revSketch: Feature = sketch('s1', front, {
      entities: [
        ...el.entities,
        { id: 'ax0', type: 'point', x: 0, y: -20 },
        { id: 'ax1', type: 'point', x: 0, y: 20 },
        { id: 'axis', type: 'line', p1: 'ax0', p2: 'ax1', construction: true },
      ],
      constraints: [
        ...el.constraints,
        { id: 'c_ax0', type: 'coincident', a: 'ax0', b: '@origin' },
        { id: 'c_ax_v', type: 'vertical', a: 'axis' },
      ],
    });

    const doc = build(
      revSketch,
      { id: 'r1', type: 'revolve', name: 'r1', suppressed: false, sketch: 's1', axis: 'axis', op: 'boss', dir1: { type: 'blind', angle: '360' } },
    );

    const r = regen.rebuild(doc);
    expect(statuses(r)).toEqual(['s1=ok', 'r1=ok']);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(volumeOf(r)).toBeCloseTo(expectedVol, 0);
  });

  it('rejects revolve when ellipse intersects or crosses the axis', () => {
    // Center at (5, 0), major = 10 along X (crosses x = 0 axis!)
    const el = ellipse('el_cross', 5, 0, 15, 0, 4);
    const revSketch: Feature = sketch('s1', front, {
      entities: [
        ...el.entities,
        { id: 'ax0', type: 'point', x: 0, y: -20 },
        { id: 'ax1', type: 'point', x: 0, y: 20 },
        { id: 'axis', type: 'line', p1: 'ax0', p2: 'ax1', construction: true },
      ],
      constraints: [
        ...el.constraints,
        { id: 'c_ax0', type: 'coincident', a: 'ax0', b: '@origin' },
        { id: 'c_ax_v', type: 'vertical', a: 'axis' },
      ],
    });

    const doc = build(
      revSketch,
      { id: 'r1', type: 'revolve', name: 'r1', suppressed: false, sketch: 's1', axis: 'axis', op: 'boss', dir1: { type: 'blind', angle: '360' } },
    );

    const r = regen.rebuild(doc);
    expect(r.features.at(-1)?.status).toBe('error');
    expect(r.features.at(-1)?.message).toContain('軸');
  });

  it('verifies Emscripten heap ground truth (No surrogate metrics)', () => {
    const wasmMem = (kernel.oc as any).wasmMemory?.buffer?.byteLength;
    expect(wasmMem).toBeDefined();
    expect(wasmMem).toBeGreaterThan(0);
  });

  describe('adversarial boundary & input corruption defense (Red-Teaming)', () => {
    it('rejects ellipse with negative or zero minor radius at validation stage', () => {
      const negativeResult = sketchError({
        entities: [
          { id: 'p0', type: 'point', x: 0, y: 0 },
          { id: 'p1', type: 'point', x: 10, y: 0 },
          { id: 'el_bad', type: 'ellipse', center: 'p0', major: 'p1', minorRadius: -2 },
        ],
        constraints: [],
      });
      expect(negativeResult).not.toBeNull();
      expect(negativeResult).toContain('半徑必須大於 0');

      const zeroResult = sketchError({
        entities: [
          { id: 'p0', type: 'point', x: 0, y: 0 },
          { id: 'p1', type: 'point', x: 10, y: 0 },
          { id: 'el_zero', type: 'ellipse', center: 'p0', major: 'p1', minorRadius: 0 },
        ],
        constraints: [],
      });
      expect(zeroResult).not.toBeNull();
      expect(zeroResult).toContain('半徑必須大於 0');
    });

    it('rejects ellipse when center and major points are coincident', () => {
      const coincidentResult = sketchError({
        entities: [
          { id: 'p0', type: 'point', x: 5, y: 5 },
          { id: 'el_coin', type: 'ellipse', center: 'p0', major: 'p0', minorRadius: 5 },
        ],
        constraints: [],
      });
      expect(coincidentResult).not.toBeNull();
      expect(coincidentResult).toContain('重複');
    });
  });
});
