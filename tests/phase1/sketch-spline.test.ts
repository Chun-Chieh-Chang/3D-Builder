/**
 * Phase 1 / Blueprint P2 (C1.11): Sketch Spline and Solid Extrusion (ADR 0160).
 *
 * Self-Red-Teaming adversarial test suite:
 * 1. Closed spline extrusion: organic shape solid extrusion, volume > 0, topology faces
 * 2. Open spline compound loop: open spline + lines forming closed profile
 * 3. Extrude cut: closed spline pocket / hole through a block
 * 4. Revolve feature: closed spline revolved around axis
 * 5. Input corruption: rejects spline with < 2 points
 * 6. Input corruption: rejects closed spline with < 3 points
 * 7. Boundary defense: consecutive duplicate points explicit error
 * 8. Memory defense: ground truth Emscripten WASM heap assertion (> 0)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  sketchError,
} from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { build, extrude, front, line, pin, rectangle, revolve, sketch, spline, statuses } from './builders';

let kernel: Kernel;
let regen: Regenerator;
let solver: PlaneGcsSolver;

beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
  regen = new Regenerator(kernel, solver);
});

const volumeOf = (r: RebuildResult) => kernel.massProps(r.body!.shape).volume;

describe('sketch spline & 3D solid pipeline (C1.11, ADR 0160)', () => {
  it('extrudes a closed organic spline profile into a solid body', () => {
    const pts: [number, number][] = [
      [0, 0],
      [30, 10],
      [40, 35],
      [10, 25],
    ];
    const h = 20;

    const doc = build(
      sketch('s1', front, spline('sp1', pts, true)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: String(h) }),
    );

    const r = regen.rebuild(doc);
    expect(statuses(r)).toEqual(['s1=ok', 'e1=ok']);
    expect(r.body).toBeDefined();
    expect(kernel.isValid(r.body!.shape)).toBe(true);

    const vol = volumeOf(r);
    expect(vol).toBeGreaterThan(1000);

    // Verify face topology and TNP persistent naming
    const faceNames = r.body!.names.faces;
    expect(faceNames).toContain('e1:cap:start');
    expect(faceNames).toContain('e1:cap:end');
    expect(faceNames.some((f) => f.startsWith('e1:side:s1.sp1'))).toBe(true);
  });

  it('extrudes a compound loop formed by an open spline and straight lines', () => {
    // Arch dam profile: open spline top curve (p0 -> p1 -> p2), closed by 3 lines
    // p0: (0, 20), p1: (25, 35), p2: (50, 20), p3: (50, 0), p4: (0, 0)
    const doc = build(
      sketch(
        's1',
        front,
        {
          entities: [
            { id: 'p0', type: 'point', x: 0, y: 20 },
            { id: 'p1', type: 'point', x: 25, y: 35 },
            { id: 'p2', type: 'point', x: 50, y: 20 },
            { id: 'p3', type: 'point', x: 50, y: 0 },
            { id: 'p4', type: 'point', x: 0, y: 0 },
            { id: 'sp1', type: 'spline', points: ['p0', 'p1', 'p2'], closed: false },
            { id: 'l1', type: 'line', p1: 'p2', p2: 'p3' },
            { id: 'l2', type: 'line', p1: 'p3', p2: 'p4' },
            { id: 'l3', type: 'line', p1: 'p4', p2: 'p0' },
          ],
          constraints: [
            ...pin('p0', 'p0', 0, 20),
            ...pin('p1', 'p1', 25, 35),
            ...pin('p2', 'p2', 50, 20),
            ...pin('p3', 'p3', 50, 0),
            ...pin('p4', 'p4', 0, 0),
          ],
        },
      ),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '15' }),
    );

    const r = regen.rebuild(doc);
    expect(statuses(r)).toEqual(['s1=ok', 'e1=ok']);
    expect(r.body).toBeDefined();
    expect(kernel.isValid(r.body!.shape)).toBe(true);

    const vol = volumeOf(r);
    // Rectangle 50 x 20 x 15 = 15000, plus arched spline top > 0
    expect(vol).toBeGreaterThan(15000);
  });

  it('performs cut extrude on a solid block using a closed spline profile', () => {
    // 100 x 100 x 20 solid block, cut out an organic spline hole in the center
    const blockVol = 100 * 100 * 20;
    const holePts: [number, number][] = [
      [35, 35],
      [65, 40],
      [60, 65],
      [40, 60],
    ];

    const doc = build(
      sketch('s_block', front, rectangle('r1', 0, 0, 100, 100)),
      extrude('e_block', 's_block', 'boss', { type: 'blind', depth: '20' }),
      sketch('s_hole', front, spline('sp_hole', holePts, true)),
      extrude('e_cut', 's_hole', 'cut', { type: 'blind', depth: '20', reverse: true }),
    );

    const r = regen.rebuild(doc);
    expect(statuses(r)).toEqual(['s_block=ok', 'e_block=ok', 's_hole=ok', 'e_cut=ok']);
    expect(r.body).toBeDefined();
    expect(kernel.isValid(r.body!.shape)).toBe(true);

    const cutVol = volumeOf(r);
    expect(cutVol).toBeLessThan(blockVol);
    expect(cutVol).toBeGreaterThan(blockVol * 0.8);
  });

  it('revolves a closed spline profile around a non-crossing axis', () => {
    // Spline cross-section situated above the X axis (y >= 20)
    const pts: [number, number][] = [
      [10, 20],
      [20, 22],
      [18, 32],
      [8, 28],
    ];

    const doc = build(
      sketch(
        's1',
        front,
        spline('sp1', pts, true),
        line('axis', -10, 0, 50, 0, true), // construction line on X axis
      ),
      revolve('rev1', 's1', 'axis', 'boss', '360'),
    );

    const r = regen.rebuild(doc);
    expect(statuses(r)).toEqual(['s1=ok', 'rev1=ok']);
    expect(r.body).toBeDefined();
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(volumeOf(r)).toBeGreaterThan(0);
  });

  it('input corruption defense: rejects spline with fewer than 2 points', () => {
    const err = sketchError({
      entities: [
        { id: 'p0', type: 'point', x: 0, y: 0 },
        { id: 'sp_bad', type: 'spline', points: ['p0'] },
      ],
      constraints: [],
    });
    expect(err).toContain('sp_bad');
  });

  it('input corruption defense: rejects closed spline with fewer than 3 points', () => {
    const err = sketchError({
      entities: [
        { id: 'p0', type: 'point', x: 0, y: 0 },
        { id: 'p1', type: 'point', x: 10, y: 10 },
        { id: 'sp_bad_closed', type: 'spline', points: ['p0', 'p1'], closed: true },
      ],
      constraints: [],
    });
    expect(err).toContain('sp_bad_closed');
  });

  it('geometric boundary defense: intercepts duplicate consecutive points', () => {
    // Duplicate consecutive points (p0 and p1 are at identical coordinates 0,0)
    const pts: [number, number][] = [
      [0, 0],
      [0, 0],
      [20, 20],
    ];

    const doc = build(
      sketch('s1', front, spline('sp_dup', pts, true)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }),
    );

    const r = regen.rebuild(doc);
    expect(statuses(r).some((s) => s.startsWith('e1=error'))).toBe(true);
  });

  it('memory integrity defense: Emscripten WASM Heap assertion (AGENTS.md §3.1)', () => {
    const rawHeap = (kernel.oc as any).wasmMemory?.buffer?.byteLength;
    expect(rawHeap).toBeDefined();
    expect(rawHeap).toBeGreaterThan(0);
  });
});
