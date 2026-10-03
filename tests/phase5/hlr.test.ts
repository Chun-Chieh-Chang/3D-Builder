/**
 * 5-0 (docs/phase5-plan.md): the shape as lines seen from a direction (A4.4), exact hidden-line removal through OCCT. A plate of 40 × 30 × 20 with a blind hole
 * of Ø8 and 10 deep from its top at (10, 5): what a viewer sees from the top, the front and the bottom is known by hand.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, type Feature, type PartDoc } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type ProjectedView } from '@3db/kernel';
import { Regenerator } from '@3db/regen';
import { build, extrude, face, front, rectangle, sketch } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
let plate: ReturnType<Kernel['copy']>;
const kept: Regenerator[] = [];

const plateDoc = (): PartDoc =>
  build(
    sketch('s1', front, rectangle('a', 0, 0, 40, 30)),
    extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }),
    { ...sketch('s2', face('e1:cap:end')), entities: [{ id: 'p1', type: 'point', x: 10, y: 5 }] } as Feature,
    { id: 'h1', type: 'hole', name: 'h1', suppressed: false, sketch: 's2', kind: 'straight', diameter: '8', end: { type: 'blind', depth: '10' } } as Feature,
  );

beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
  const regen = new Regenerator(kernel, solver);
  kept.push(regen);
  plate = regen.rebuild(plateDoc()).body!.shape;
});

const points = (lines: number[][]) => lines.flatMap((l) => Array.from({ length: l.length / 2 }, (_, i) => [l[2 * i]!, l[2 * i + 1]!] as const));
const box = (lines: number[][]) => {
  const p = points(lines);
  return { min: [Math.min(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1]))], max: [Math.max(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1]))] };
};
/** A polyline all of whose points are on the circle of radius r about (cx, cy). */
const onCircle = (l: number[], cx: number, cy: number, r: number) => Array.from({ length: l.length / 2 }, (_, i) => Math.hypot(l[2 * i]! - cx, l[2 * i + 1]! - cy)).every((d) => Math.abs(d - r) < 2e-3);
const straight = (l: number[], x0: number, y0: number, x1: number, y1: number) => {
  const a = [l[0]!, l[1]!];
  const b = [l[l.length - 2]!, l[l.length - 1]!];
  const near = (p: number[], x: number, y: number) => Math.hypot(p[0]! - x, p[1]! - y) < 1e-6;
  return l.length === 4 && ((near(a, x0, y0) && near(b, x1, y1)) || (near(a, x1, y1) && near(b, x0, y0)));
};

describe('the plate seen from a direction (A4.4)', () => {
  it('from the top: the outline of 40 × 30 and the circle of the hole, nothing hidden', () => {
    const v: ProjectedView = kernel.projectView(plate, { dir: [0, 0, -1], up: [0, 1, 0] });
    expect(v.box).toEqual({ min: [expect.closeTo(0, 6), expect.closeTo(0, 6)], max: [expect.closeTo(40, 6), expect.closeTo(30, 6)] });
    expect(v.visible.filter((l) => straight(l, 0, 0, 40, 0) || straight(l, 40, 0, 40, 30) || straight(l, 40, 30, 0, 30) || straight(l, 0, 30, 0, 0))).toHaveLength(4);
    expect(v.visible.some((l) => l.length > 20 && onCircle(l, 10, 5, 4))).toBe(true);
    expect(v.hidden).toEqual([]);
  });

  it('from the front (looking along +y, z up): the outline of 40 × 20, and the hole hidden: its two sides at x = 6 and 14 from z = 10 to 20, and its bottom at z = 10', () => {
    const v = kernel.projectView(plate, { dir: [0, 1, 0], up: [0, 0, 1] });
    expect(v.box).toEqual({ min: [expect.closeTo(0, 6), expect.closeTo(0, 6)], max: [expect.closeTo(40, 6), expect.closeTo(20, 6)] });
    expect(v.visible.filter((l) => straight(l, 0, 0, 40, 0) || straight(l, 40, 0, 40, 20) || straight(l, 40, 20, 0, 20) || straight(l, 0, 20, 0, 0))).toHaveLength(4);
    expect(v.hidden.some((l) => straight(l, 6, 10, 6, 20))).toBe(true);
    expect(v.hidden.some((l) => straight(l, 14, 10, 14, 20))).toBe(true);
    expect(v.hidden.some((l) => straight(l, 6, 10, 14, 10))).toBe(true);
    // and none of it is also seen
    expect(v.visible.some((l) => straight(l, 6, 10, 6, 20))).toBe(false);
  });

  it('from the bottom (looking along +z, y up): the sheet\'s x is the world\'s −x, and the hole is a hidden circle at (−10, 5)', () => {
    const v = kernel.projectView(plate, { dir: [0, 0, 1], up: [0, 1, 0] });
    expect(v.box).toEqual({ min: [expect.closeTo(-40, 6), expect.closeTo(0, 6)], max: [expect.closeTo(0, 6), expect.closeTo(30, 6)] });
    expect(v.hidden.some((l) => l.length > 20 && onCircle(l, -10, 5, 4))).toBe(true);
    expect(v.visible.some((l) => l.length > 20 && onCircle(l, -10, 5, 4))).toBe(false);
  });

  it('from an oblique direction: the box of what is seen is the plate\'s projected corners', () => {
    const dir: [number, number, number] = [-1, 1, -1];
    const v = kernel.projectView(plate, { dir, up: [0, 0, 1] });
    // the sheet's x = dir × up / |…|, y = up less its part along dir
    const n = Math.hypot(...dir);
    const d = dir.map((c) => c / n);
    const rx = [d[1]! * 1 - 0, 0 - d[0]! * 1, 0];
    const rn = Math.hypot(...rx);
    const x = rx.map((c) => c / rn);
    const y = [0 - d[2]! * d[0]!, 0 - d[2]! * d[1]!, 1 - d[2]! * d[2]!];
    const yn = Math.hypot(...y);
    const yy = y.map((c) => c / yn);
    const corners = [0, 40].flatMap((cx) => [0, 30].flatMap((cy) => [0, 20].map((cz) => [cx, cy, cz])));
    const px = corners.map((c) => c[0]! * x[0]! + c[1]! * x[1]! + c[2]! * x[2]!);
    const py = corners.map((c) => c[0]! * yy[0]! + c[1]! * yy[1]! + c[2]! * yy[2]!);
    expect(v.box!.min[0]).toBeCloseTo(Math.min(...px), 5);
    expect(v.box!.max[0]).toBeCloseTo(Math.max(...px), 5);
    expect(v.box!.min[1]).toBeCloseTo(Math.min(...py), 5);
    expect(v.box!.max[1]).toBeCloseTo(Math.max(...py), 5);
    expect(v.hidden.length).toBeGreaterThan(0); // the three faces away from the viewer show as hidden lines
  });

  it('refuses a direction of nothing, and leaks no shapes however often it is asked', () => {
    expect(() => kernel.projectView(plate, { dir: [0, 0, 0], up: [0, 1, 0] })).toThrow();
    const live = kernel.liveShapes;
    for (let i = 0; i < 3; i++) kernel.projectView(plate, { dir: [0, 0, -1], up: [0, 1, 0] });
    expect(kernel.liveShapes).toBe(live);
    void box;
    void applyCommand;
  });
});
