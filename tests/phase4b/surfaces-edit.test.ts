/**
 * 4b-4 (docs/phase4b-plan.md): the kernel's methods that edit a surface — knitting with the faces it keeps, keeping some faces of a shape (what is left of a trim), and
 * extending a one-face surface past an edge (tried in ADR 0071 on a plane, a cylinder, a cone and a freeform side) — each against what is worked out by hand.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Feature } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, KernelError, type ShapeId } from '@3db/kernel';
import { Regenerator } from '@3db/regen';
import { build, circle, extrude, front, rectangle, sketch } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});
afterAll(() => kept.forEach((r) => r.dispose()));

const body = (doc: ReturnType<typeof build>): ShapeId => {
  const regen = new Regenerator(kernel, solver, new Map());
  kept.push(regen);
  const r = regen.rebuild(doc);
  expect(r.features.filter((f) => f.status !== 'ok').map((f) => f.message)).toEqual([]);
  return r.body!.shape;
};
const box = (w: number, d: number, h: number) => body(build(sketch('s', front, rectangle('r', 0, 0, w, d)), extrude('e', 's', 'boss', { type: 'blind', depth: String(h) })));
const cylinder = (r: number, h: number) => body(build(sketch('s', front, circle('c', 0, 0, r)), extrude('e', 's', 'boss', { type: 'blind', depth: String(h) })));
const plane = (id: string, z: number): Feature => ({ id, type: 'refPlane', name: id, suppressed: false, def: { mode: 'offset', plane: front, distance: String(z) } }) as Feature;
const on = (id: string) => ({ kind: 'datum', name: id }) as const;
function lofted(radii: number[]): ShapeId {
  const features: Feature[] = [];
  radii.forEach((r, i) => {
    if (i > 0) features.push(plane(`pl${i}`, 30 * i));
    features.push(sketch(`s${i}`, i === 0 ? front : on(`pl${i}`), circle(`c${i}`, 0, 0, r)));
  });
  return body(build(...features, { id: 'lf1', type: 'loft', name: 'lf1', suppressed: false, sections: radii.map((_, i) => `s${i}`), op: 'boss' } as Feature));
}
const faceOf = (shape: ShapeId, surface: string) => kernel.topology(shape).faces.findIndex((f) => f.surface === surface);
const area = (shape: ShapeId) => kernel.topology(shape).faces.reduce((a, f) => a + f.area, 0);
const oneFace = (shape: ShapeId, surface: string) => kernel.subShape(shape, 'face', faceOf(shape, surface));
const sources = (origins: { index?: number }[][]) => origins.map((o) => o[0]!.index ?? -1).sort((x, y) => x - y);

describe('knit keeps the faces it was given (C9.3)', () => {
  it('the six faces of a box, knit, are the six faces each from one of those put in, in both the solid and the open shell', () => {
    const b = box(10, 10, 10);
    const faces = (n: number) => Array.from({ length: n }, (_, i) => kernel.subShape(b, 'face', i));
    for (const [n, solid] of [[6, true], [5, false]] as const) {
      const r = kernel.knit(faces(n));
      expect(r.solid).toBe(solid);
      expect(r.faceOrigins).toHaveLength(n);
      expect(r.faceOrigins.every((o) => o.length === 1)).toBe(true);
      expect(sources(r.faceOrigins as never)).toEqual(Array.from({ length: n }, (_, i) => i));
    }
  });

  it('counts the faces of the shapes in the order they were given: two shells of three faces', () => {
    const b = box(10, 10, 10);
    const part = (ids: number[]) => kernel.join(ids.map((i) => kernel.subShape(b, 'face', i)));
    const r = kernel.knit([part([0, 1, 2]), part([3, 4, 5])]);
    expect(r.solid).toBe(true);
    expect(sources(r.faceOrigins as never)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('keep faces (C9.3)', () => {
  it('two faces of a box kept: two faces of 100 each, no solid, each the face it was', () => {
    const b = box(10, 10, 10);
    const r = kernel.keepFaces(b, [4, 1]);
    expect(kernel.topology(r.shape).faces).toHaveLength(2);
    expect(area(r.shape)).toBeCloseTo(200, 9);
    expect(kernel.solidCount(r.shape)).toBe(0);
    expect(sources(r.faceOrigins as never)).toEqual([1, 4]);
    expect(() => kernel.keepFaces(b, [])).toThrow(KernelError);
    expect(() => kernel.keepFaces(b, [99])).toThrow(KernelError);
  });
});

describe('extend a surface (C9.3)', () => {
  const edgeWhere = (shape: ShapeId, pick: (e: ReturnType<Kernel['topology']>['edges'][number]) => boolean) => {
    const i = kernel.topology(shape).edges.findIndex(pick);
    expect(i).toBeGreaterThanOrEqual(0);
    return i;
  };

  it('a plane 40 × 30 extended past its edge at x = 40 by 5 is 45 × 30: 1350; past both ends, 50 × 30', () => {
    const b = box(40, 30, 20);
    const top = kernel.subShape(b, 'face', kernel.topology(b).faces.findIndex((f) => f.normal && Math.abs(f.normal[2] - 1) < 1e-9));
    const e = edgeWhere(top, (x) => Math.abs(x.mid[0] - 40) < 1e-9);
    const r = kernel.extendFace(top, [e], 5);
    expect(area(r.shape)).toBeCloseTo(1350, 6);
    expect(kernel.isValid(r.shape)).toBe(true);
    const both = kernel.extendFace(top, [e, edgeWhere(top, (x) => Math.abs(x.mid[0]) < 1e-9)], 5);
    expect(area(both.shape)).toBeCloseTo(50 * 30, 6);
  });

  it('the side of a cylinder R10 × 20 extended past its top circle by 5 is 2π·10·25; the seam is not an edge it can be extended past', () => {
    const side = oneFace(cylinder(10, 20), 'cylinder');
    const top = edgeWhere(side, (x) => x.curve === 'circle' && Math.abs(x.mid[2] - 20) < 1e-9);
    const r = kernel.extendFace(side, [top], 5);
    expect(area(r.shape)).toBeCloseTo(2 * Math.PI * 10 * 25, 6);
    const seam = edgeWhere(side, (x) => x.curve === 'line');
    expect(() => kernel.extendFace(side, [seam], 5)).toThrow(/可以延伸/);
  });

  it('the side of a cone frustum (R25 at z = 0, R15 at z = 30) extended 5 along its slope: at the narrow end 2π(75 − 25/(2√10)), at the wide end 2π(125 + 25/(2√10))', () => {
    const side = oneFace(lofted([25, 15]), 'cone');
    const whole = area(side);
    const narrow = edgeWhere(side, (x) => x.curve === 'circle' && Math.abs(x.mid[2] - 30) < 1e-6);
    const wide = edgeWhere(side, (x) => x.curve === 'circle' && Math.abs(x.mid[2]) < 1e-6);
    expect(area(kernel.extendFace(side, [narrow], 5).shape) - whole).toBeCloseTo(2 * Math.PI * (75 - 25 / (2 * Math.sqrt(10))), 4);
    expect(area(kernel.extendFace(side, [wide], 5).shape) - whole).toBeCloseTo(2 * Math.PI * (125 + 25 / (2 * Math.sqrt(10))), 4);
  });

  it('a freeform side extended: valid, larger, and the surface it was lies within the result', () => {
    const side = oneFace(lofted([25, 15, 22]), 'bsplinesurface');
    const top = edgeWhere(side, (x) => x.mid[2] > 59);
    const r = kernel.extendFace(side, [top], 5);
    expect(kernel.isValid(r.shape)).toBe(true);
    expect(area(r.shape)).toBeGreaterThan(area(side) + 100);
    expect(kernel.gapReport(side, r.shape).max).toBeLessThan(0.05);
  });

  it('refuses what it cannot: nothing picked, a length that is not positive, a solid, a body of several faces', () => {
    const side = oneFace(cylinder(10, 20), 'cylinder');
    expect(() => kernel.extendFace(side, [], 5)).toThrow(KernelError);
    expect(() => kernel.extendFace(side, [0], 0)).toThrow(KernelError);
    expect(() => kernel.extendFace(cylinder(10, 20), [0], 5)).toThrow(/曲面/);
    const b = box(10, 10, 10);
    const two = kernel.join([kernel.subShape(b, 'face', 0), kernel.subShape(b, 'face', 1)]);
    expect(() => kernel.extendFace(two, [0], 5)).toThrow(/一個面/);
  });
});
