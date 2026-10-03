/**
 * 5-1 (docs/phase5-plan.md): the views of a drawing from a real part (C16.2). The golden locating plate — 120 × 80 × 15, four Ø9 holes at (±50, ±30) and two
 * Ø8 holes at (±40, 0) through it, R10 corners, C1 on the top edge — seen from the front, top and right, its lines worked out by hand.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { viewVectors, type Pose, type ViewName } from '@3db/model';
import { readPartFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type ProjectedView, type ShapeId } from '@3db/kernel';
import { projectDrawingView, Regenerator } from '@3db/regen';

let kernel: Kernel;
let solver: PlaneGcsSolver;
let plate: ShapeId;
const kept: Regenerator[] = [];

beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
  const doc = (await readPartFile(new Uint8Array(readFileSync(new URL('../golden/locating-plate.3dbx', import.meta.url))))).doc;
  const regen = new Regenerator(kernel, solver);
  kept.push(regen);
  plate = regen.rebuild(doc).body!.shape;
});
afterAll(() => kept.forEach((r) => r.dispose()));

const at = (position: [number, number, number]): Pose => ({ position, rotation: [0, 0, 0, 1] });
const view = (name: ViewName, parts = [{ shape: plate, pose: at([0, 0, 0]), mirrored: false }]): ProjectedView => projectDrawingView(kernel, parts, viewVectors(name));

/** How much of the circle of radius r about (cx, cy) the lines cover, as a fraction of its length. */
function covered(lines: number[][], cx: number, cy: number, r: number): number {
  let length = 0;
  for (const l of lines) {
    for (let i = 0; i + 3 < l.length; i += 2) {
      const d = [Math.hypot(l[i]! - cx, l[i + 1]! - cy), Math.hypot(l[i + 2]! - cx, l[i + 3]! - cy)];
      if (d.every((v) => Math.abs(v - r) < 5e-3)) length += Math.hypot(l[i + 2]! - l[i]!, l[i + 3]! - l[i + 1]!);
    }
  }
  return length / (2 * Math.PI * r);
}
/** A vertical line at x from y0 to y1 among the lines (a polyline of two points, or a longer one all at that x). */
const vertical = (lines: number[][], x: number, y0: number, y1: number) =>
  lines.some((l) => {
    const xs = l.filter((_, i) => i % 2 === 0);
    const ys = l.filter((_, i) => i % 2 === 1);
    return xs.every((v) => Math.abs(v - x) < 1e-6) && Math.abs(Math.min(...ys) - y0) < 1e-6 && Math.abs(Math.max(...ys) - y1) < 1e-6;
  });

describe('the locating plate as the views of a drawing', () => {
  it('the views look along the model\'s axes: the front from +z, the top from +y with the back of the part up, the right from +x', () => {
    expect(viewVectors('front')).toEqual({ dir: [0, 0, -1], up: [0, 1, 0] });
    expect(viewVectors('top')).toEqual({ dir: [0, -1, 0], up: [0, 0, -1] });
    expect(viewVectors('right')).toEqual({ dir: [-1, 0, 0], up: [0, 1, 0] });
  });

  it('front: 120 wide and 15 high, the holes hidden as dashed lines through the full thickness', () => {
    const v = view('front');
    expect(v.box).toEqual({ min: [expect.closeTo(-60, 6), expect.closeTo(0, 6)], max: [expect.closeTo(60, 6), expect.closeTo(15, 6)] });
    // the Ø9 holes at x = ±50 (the two at z = ±30 coincide in this view) and the Ø8 holes at x = ±40
    for (const x of [-54.5, -45.5, 45.5, 54.5, -44, -36, 36, 44]) expect(vertical(v.hidden, x, 0, 15), `hidden line at x = ${x}`).toBe(true);
    expect(v.hidden.some((l) => vertical([l], 0, 0, 15))).toBe(false);
  });

  it('top: 120 by 80, the six circles of the holes seen whole, nothing hidden', () => {
    const v = view('top');
    expect(v.box).toEqual({ min: [expect.closeTo(-60, 6), expect.closeTo(-40, 6)], max: [expect.closeTo(60, 6), expect.closeTo(40, 6)] });
    for (const [x, y, r] of [[-50, -30, 4.5], [50, -30, 4.5], [-50, 30, 4.5], [50, 30, 4.5], [-40, 0, 4], [40, 0, 4]] as const) {
      expect(covered(v.visible, x, y, r), `circle at (${x}, ${y})`).toBeGreaterThan(0.99);
    }
    expect(v.hidden).toEqual([]);
  });

  it('right: 80 wide (the sheet x is the model\'s −z) and 15 high, the two Ø8 holes hidden at z = 0 and the Ø9 at z = ±30', () => {
    const v = view('right');
    expect(v.box).toEqual({ min: [expect.closeTo(-40, 6), expect.closeTo(0, 6)], max: [expect.closeTo(40, 6), expect.closeTo(15, 6)] });
    for (const x of [-34.5, -25.5, 25.5, 34.5, -4, 4]) expect(vertical(v.hidden, x, 0, 15), `hidden line at x = ${x}`).toBe(true);
  });

  it('parts put where they are: the plate again 200 along x makes the front view twice as wide, and a mirrored copy is the same plate', () => {
    const two = view('front', [{ shape: plate, pose: at([0, 0, 0]), mirrored: false }, { shape: plate, pose: at([200, 0, 0]), mirrored: false }]);
    expect(two.box).toEqual({ min: [expect.closeTo(-60, 6), expect.closeTo(0, 6)], max: [expect.closeTo(260, 6), expect.closeTo(15, 6)] });
    const mirrored = view('front', [{ shape: plate, pose: at([0, 0, 0]), mirrored: true }]);
    expect(mirrored.box).toEqual({ min: [expect.closeTo(-60, 6), expect.closeTo(0, 6)], max: [expect.closeTo(60, 6), expect.closeTo(15, 6)] }); // the plate is symmetric
  });

  it('is asked for as often as needed without leaking shapes', () => {
    view('front');
    const live = kernel.liveShapes;
    for (const n of ['front', 'top', 'right', 'isometric'] as const) view(n);
    expect(kernel.liveShapes).toBe(live);
  });

  it('the isometric view is the plate seen from a corner: wider than the plate is deep and no hidden lines under the visible ones', () => {
    const v = view('isometric');
    const w = v.box!.max[0] - v.box!.min[0];
    expect(w).toBeGreaterThan(120);
    expect(v.visible.length).toBeGreaterThan(10);
  });
});
