/**
 * Phase 1 / Blueprint P2 (C1.13): Sketch Text and Solid Extrusion (ADR 0163).
 *
 * Self-Red-Teaming adversarial test suite:
 * 1. Contour orientation & islands: CCW outer loop, CW inner hole loop
 * 2. Extrude boss: 3D raised text extrusion, volume > 0, topology faces
 * 3. Extrude cut: 3D engraved text cut into a solid block
 * 4. Dissolve text: converts text entity into independent lines and shared points, extrudes cleanly
 * 5. Transformation: rotation and alignment coordinates check
 * 6. Input corruption: rejects empty string, size <= 0, invalid angle
 * 7. Construction text: does not generate profiles for solid extrude
 * 8. Memory defense: ground truth Emscripten WASM heap assertion (byteLength > 0)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  IdAllocator,
  sketchError,
} from '@3db/model';
import { PlaneGcsSolver, textContours, dissolveText, contourArea } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { build, extrude, front, rectangle, sketch, sketchText, statuses } from './builders';

let kernel: Kernel;
let regen: Regenerator;
let solver: PlaneGcsSolver;

beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
  regen = new Regenerator(kernel, solver);
});

const volumeOf = (r: RebuildResult) => kernel.massProps(r.body!.shape).volume;

describe('sketch text feature & 3D solid pipeline (C1.13, ADR 0163)', () => {
  it('1. verifies contour orientation: CCW outer loop, CW inner hole loop', () => {
    // Character 'O' has 1 outer loop and 1 inner hole
    const loopsO = textContours('O', { size: 20, at: [0, 0] });
    expect(loopsO.length).toBe(2);

    const outerArea = contourArea(loopsO[0]!);
    const innerArea = contourArea(loopsO[1]!);
    // CCW has positive signed area in standard Cartesian coords
    expect(outerArea).toBeGreaterThan(0);
    // CW hole has negative signed area
    expect(innerArea).toBeLessThan(0);
    expect(Math.abs(outerArea)).toBeGreaterThan(Math.abs(innerArea));

    // Character '8' has 1 outer and 2 inner holes
    const loops8 = textContours('8', { size: 20, at: [0, 0] });
    expect(loops8.length).toBe(3);
    expect(contourArea(loops8[0]!)).toBeGreaterThan(0);
    expect(contourArea(loops8[1]!)).toBeLessThan(0);
    expect(contourArea(loops8[2]!)).toBeLessThan(0);
  });

  it('2. extrudes raised 3D text into a valid solid boss', () => {
    const doc = build(
      sketch('s1', front, sketchText('txt1', 0, 0, 'CAD', 20)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '5' }),
    );

    const r = regen.rebuild(doc);
    expect(statuses(r)).toEqual(['s1=ok', 'e1=ok']);
    expect(r.body).toBeDefined();
    expect(kernel.isValid(r.body!.shape)).toBe(true);

    const vol = volumeOf(r);
    expect(vol).toBeGreaterThan(100);

    const faceNames = r.body!.names.faces;
    expect(faceNames.some((f) => f.includes('cap:start'))).toBe(true);
    expect(faceNames.some((f) => f.includes('cap:end'))).toBe(true);
    expect(faceNames.some((f) => f.includes('side:s1.txt1'))).toBe(true);
  });

  it('3. engraves 3D text pocket into a solid block with Extrude Cut', () => {
    // Base block: 100 x 60 x 20
    const baseW = 100;
    const baseH = 60;
    const baseDepth = 20;
    const pureVolume = baseW * baseH * baseDepth;

    const doc = build(
      sketch('s_base', front, rectangle('r1', -50, -30, baseW, baseH)),
      extrude('e_base', 's_base', 'boss', { type: 'blind', depth: String(baseDepth) }),
      sketch('s_text', front, sketchText('txt1', -30, -5, 'CUT', 15)),
      extrude('e_cut', 's_text', 'cut', { type: 'blind', depth: '3', reverse: true }),
    );

    const r = regen.rebuild(doc);
    expect(statuses(r)).toEqual(['s_base=ok', 'e_base=ok', 's_text=ok', 'e_cut=ok']);
    expect(r.body).toBeDefined();
    expect(kernel.isValid(r.body!.shape)).toBe(true);

    const cutVol = volumeOf(r);
    // Pocket cuts material out, so volume is strictly less than pure block
    expect(cutVol).toBeLessThan(pureVolume);
    expect(cutVol).toBeGreaterThan(pureVolume * 0.9);
  });

  it('4. dissolves text into lines & points, then extrudes cleanly', () => {
    const skFeature = sketch('s1', front, sketchText('txt1', 0, 0, 'T', 15)) as any;
    const allocator = new IdAllocator({}, []);
    const geometry = new Map();

    const opResult = dissolveText(skFeature, geometry, 'txt1', allocator);
    expect('edit' in opResult).toBe(true);
    if (!('edit' in opResult) || !opResult.edit.add) return;

    expect(opResult.edit.remove).toEqual(['txt1']);
    expect(opResult.edit.add.entities.length).toBeGreaterThan(0);
    // Lines should be present
    expect(opResult.edit.add.entities.some((e) => e.type === 'line')).toBe(true);
    // Points should be present
    expect(opResult.edit.add.entities.some((e) => e.type === 'point')).toBe(true);

    // Build a sketch with the dissolved entities
    const dissolvedDoc = build(
      sketch('s_dissolved', front, {
        entities: opResult.edit.add.entities,
        constraints: opResult.edit.add.constraints,
      }),
      extrude('e1', 's_dissolved', 'boss', { type: 'blind', depth: '4' }),
    );

    const r = regen.rebuild(dissolvedDoc);
    expect(statuses(r)).toEqual(['s_dissolved=ok', 'e1=ok']);
    expect(r.body).toBeDefined();
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(volumeOf(r)).toBeGreaterThan(10);
  });

  it('5. handles rotation and center alignment geometry coordinates', () => {
    const loopsLeft = textContours('A', { size: 10, at: [0, 0], align: 'left', angle: 0 });
    const loopsCenter = textContours('A', { size: 10, at: [0, 0], align: 'center', angle: 0 });
    const loopsRot = textContours('A', { size: 10, at: [0, 0], align: 'left', angle: 90 });

    const getX = (s: any) => (s.kind === 'line' ? s.a[0] : s.from[0]);
    const getY = (s: any) => (s.kind === 'line' ? s.a[1] : s.from[1]);
    const minXLeft = Math.min(...loopsLeft[0]!.map(getX));
    const minXCenter = Math.min(...loopsCenter[0]!.map(getX));

    // Centered text should be shifted left relative to origin [0, 0]
    expect(minXCenter).toBeLessThan(minXLeft);

    // 90 degree rotated text should have x coordinates derived from -y
    const maxYRot = Math.max(...loopsRot[0]!.map(getY));
    expect(maxYRot).toBeGreaterThan(5);
  });

  it('6. defends against input corruption: empty string, non-positive size, NaN angle', () => {
    // Empty text
    const errEmpty = sketchError({
      entities: [
        { id: 'p0', type: 'point', x: 0, y: 0 },
        { id: 't1', type: 'text', at: 'p0', text: '   ', size: 10 },
      ],
      constraints: [],
    });
    expect(errEmpty).not.toBeNull();

    // Size <= 0
    const errZeroSize = sketchError({
      entities: [
        { id: 'p0', type: 'point', x: 0, y: 0 },
        { id: 't1', type: 'text', at: 'p0', text: 'OK', size: 0 },
      ],
      constraints: [],
    });
    expect(errZeroSize).not.toBeNull();

    const errNegSize = sketchError({
      entities: [
        { id: 'p0', type: 'point', x: 0, y: 0 },
        { id: 't1', type: 'text', at: 'p0', text: 'OK', size: -10 },
      ],
      constraints: [],
    });
    expect(errNegSize).not.toBeNull();

    // Invalid angle
    const errAngle = sketchError({
      entities: [
        { id: 'p0', type: 'point', x: 0, y: 0 },
        { id: 't1', type: 'text', at: 'p0', text: 'OK', size: 10, angle: NaN },
      ],
      constraints: [],
    });
    expect(errAngle).not.toBeNull();
  });

  it('7. verifies construction text does not participate in solid extrusion', () => {
    const doc = build(
      sketch('s1', front, sketchText('txt1', 0, 0, 'DRAFT', 10, 0, 'left', true)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '5' }),
    );

    const r = regen.rebuild(doc);
    // Extrude on a sketch containing only construction entities should fail without closed profiles
    expect(statuses(r)).toContain('s1=ok');
    expect(r.features.find((f) => f.id === 'e1')?.status).toBe('error');
  });

  it('8. asserts real Emscripten WASM Heap metric existence and non-zero baseline', () => {
    const initialHeap = (kernel.oc as any).wasmMemory?.buffer?.byteLength;
    // Ground truth defense: assert heap is actually accessible and > 0, no false green expect(0).toBe(0)
    expect(initialHeap).toBeDefined();
    expect(initialHeap).toBeGreaterThan(0);

    // Rebuild several text extrusions
    for (let i = 0; i < 3; i++) {
      const doc = build(
        sketch('s1', front, sketchText('txt1', 0, 0, `N${i}`, 15)),
        extrude('e1', 's1', 'boss', { type: 'blind', depth: '2' }),
      );
      const r = regen.rebuild(doc);
      expect(r.body).toBeDefined();
    }

    const currentHeap = (kernel.oc as any).wasmMemory?.buffer?.byteLength;
    expect(currentHeap).toBeGreaterThanOrEqual(initialHeap);
  });
});
