/**
 * P-3 补測 (ADR 0109, the ones left open there): mutual trim of surfaces that are not planes and cylinders. The surfaces are made in the kernel — the sides of lofts (B-splines), the
 * patch of a fill surface, the offset of a cylinder — and what is measured does not need the cut itself worked out: the area of the pieces is the area that went in (a trim loses
 * nothing), every piece is a face of positive area, the pieces of one surface lie on the two sides of the other, and the pieces of the two meet in one curve: they sew into a surface
 * body whose free edges are the outer boundaries only (no edge in more than two faces).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type Frame, type Region, type Segment, type ShapeId } from '@3db/kernel';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await Kernel.load();
});
const made: ShapeId[] = [];
afterAll(() => made.forEach((s) => kernel.release(s)));
const keep = (s: ShapeId): ShapeId => {
  made.push(s);
  return s;
};

const line = (a: [number, number], b: [number, number], source: string): Segment => ({ kind: 'line', a, b, source });
const square = (h: number, id: string): Segment[] => [line([-h, -h], [h, -h], `${id}.a`), line([h, -h], [h, h], `${id}.b`), line([h, h], [-h, h], `${id}.c`), line([-h, h], [-h, -h], `${id}.d`)];
const ring = (r: number, id: string): Segment[] => [{ kind: 'circle', c: [0, 0], r, source: id }];
const frame = (origin: [number, number, number], xDir: [number, number, number], yDir: [number, number, number], normal: [number, number, number]): Frame => ({ origin, xDir, yDir, normal });
const rectRegion = (x0: number, y0: number, x1: number, y1: number): Region => ({ outer: [line([x0, y0], [x1, y0], 'r.a'), line([x1, y0], [x1, y1], 'r.b'), line([x1, y1], [x0, y1], 'r.c'), line([x0, y1], [x0, y0], 'r.d')], holes: [] });

/** The faces of a solid that are not planes it was cut by (its flat ends): the side of a loft, kept as one surface body. */
const sideOf = (solid: ShapeId, isEnd: (f: { normal: number[] | null; surface: string }) => boolean): ShapeId => {
  keep(solid);
  const faces = kernel.topology(solid).faces;
  const idx = faces.map((f, i) => i).filter((i) => !isEnd(faces[i] as never));
  return keep(kernel.keepFaces(solid, idx).shape);
};
const area = (id: ShapeId) => kernel.topology(id).faces.reduce((a, f) => a + f.area, 0);

/** A loft from a circle R10 at z = 0 to a square of half side 8 at z = 20 along z, as a surface body (five B-spline faces). */
const tower = (): ShapeId => sideOf(kernel.loft([{ frame: frame([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]), outer: ring(10, 'c') }, { frame: frame([0, 0, 20], [1, 0, 0], [0, 1, 0], [0, 0, 1]), outer: square(8, 'q') }]).shape, (f) => f.surface === 'plane');
/** A thinner loft along x, from a circle R5 at x = -20 to a square of half side 4 at x = 20, through the tower. */
const pipe = (): ShapeId => sideOf(kernel.loft([{ frame: frame([-20, 0, 10], [0, 1, 0], [0, 0, 1], [1, 0, 0]), outer: ring(5, 'c') }, { frame: frame([20, 0, 10], [0, 1, 0], [0, 0, 1], [1, 0, 0]), outer: square(4, 'q') }]).shape, (f) => f.surface === 'plane');

function checkTrim(a: ShapeId, b: ShapeId, cut: { a: boolean; b: boolean } = { a: true, b: true }) {
  const r = kernel.trimSurfaces(a, b);
  keep(r.a.shape);
  keep(r.b.shape);
  const ta = kernel.topology(r.a.shape);
  const tb = kernel.topology(r.b.shape);
  // nothing is lost, nothing is made twice: the area of the pieces is the area that went in
  expect(area(r.a.shape)).toBeCloseTo(area(a), 1);
  expect(area(r.b.shape)).toBeCloseTo(area(b), 1);
  expect(ta.faces.every((f) => f.area > 1e-6)).toBe(true);
  expect(tb.faces.every((f) => f.area > 1e-6)).toBe(true);
  // each surface was cut: it has more faces than it went in with
  if (cut.a) expect(ta.faces.length).toBeGreaterThan(kernel.topology(a).faces.length);
  if (cut.b) expect(tb.faces.length).toBeGreaterThan(kernel.topology(b).faces.length);
  expect(kernel.solidCount(r.a.shape)).toBe(0);
  return { r, ta, tb };
}

describe('mutual trim of free-form surfaces (P-3)', () => {
  it('two lofts (B-spline sides) through each other: the area is kept, every piece has area, and the pieces of the two sew along the curve they cross in: no edge is in more than two faces, and the free edges are the outer boundaries', () => {
    const a = tower();
    const b = pipe();
    const { r } = checkTrim(a, b);
    // the pieces of the tower inside the pipe and the pieces of the pipe inside the tower: those with their centre inside the other's reach
    const faces = kernel.topology(r.b.shape).faces;
    const inside = faces.filter((f) => Math.hypot(f.center[1], f.center[2] - 10) < 1e-3 || Math.abs(f.center[0]) < 8);
    expect(inside.length).toBeGreaterThan(0);
    // sew everything: no edge in three faces, and the free edges are those of the outer boundaries
    const k = kernel.knit([keep(kernel.keepFaces(r.a.shape, kernel.topology(r.a.shape).faces.map((_, i) => i)).shape), keep(kernel.keepFaces(r.b.shape, faces.map((_, i) => i)).shape)], 1e-4, false);
    keep(k.shape);
    expect(k.multipleEdges).toBe(0);
    expect(k.freeEdges).toBeGreaterThan(0);
  });

  it('a loft through a cylinder (the offset of a cylinder side is a cylinder of R13): the loft is cut where it enters and leaves, the cylinder is cut by the loft, and the area is kept', () => {
    const solid = keep(kernel.extrude(frame([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]), [{ outer: ring(13, 'c'), holes: [] }], [0, 0, 20]).shape);
    const faces = kernel.topology(solid).faces;
    const cyl = keep(kernel.subShape(solid, 'face', faces.findIndex((f) => Math.abs(f.area - 2 * Math.PI * 13 * 20) < 1e-3)));
    const { r } = checkTrim(cyl, pipe());
    // the cylinder keeps 2π·13·20 = 1634.07 whatever the pipe does to it
    expect(area(r.a.shape)).toBeCloseTo(2 * Math.PI * 13 * 20, 1);
  });

  it('a patch made by a fill surface (a B-spline over four edges) cut by a plane through it: two halves of 800, and the plane left whole (the cut line ends inside it)', () => {
    const box = keep(kernel.extrude(frame([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]), [rectRegion(-20, -20, 20, 20)], [0, 0, 10]).shape);
    const t = kernel.topology(box);
    const topFace = t.faces.findIndex((f) => f.normal && f.normal[2] > 0.99);
    const edges = t.edges.map((e, i) => ({ e, i })).filter(({ e }) => e.faces.includes(topFace)).map(({ i }) => i);
    const patch = keep(kernel.fillSurface(box, edges, [], 'contact').shape);
    // a plane through the middle (y = 0) that is bigger than the patch in x and reaches below and above it
    const slab = keep(kernel.extrude(frame([0, 0, -5], [1, 0, 0], [0, 0, 1], [0, -1, 0]), [rectRegion(-30, 0, 30, 30)], [0, -1, 0]).shape);
    const sf = kernel.topology(slab).faces;
    const upright = keep(kernel.subShape(slab, 'face', sf.findIndex((f) => f.normal && Math.abs(f.normal[1]) > 0.99 && Math.abs(f.center[1]) < 1e-6)));
    const planeArea = area(upright);
    // the patch is cut into two halves of 800; the cut line (z = 10, from x = -20 to 20) ends inside the plane, which is left as one face with the line on it
    const { r, ta, tb } = checkTrim(patch, upright, { a: true, b: false });
    expect(area(r.a.shape)).toBeCloseTo(40 * 40, 1);
    expect(area(r.b.shape)).toBeCloseTo(planeArea, 1);
    expect(ta.faces.map((f) => Math.round(f.area)).sort()).toEqual([800, 800]);
    expect(tb.faces).toHaveLength(1);
  });

  it('the trimmed pieces go on: a piece of each, kept with keepFaces and knitted, make one surface body that shares the curve (the free edges are the outer ones)', () => {
    const a = tower();
    const b = pipe();
    const { r, ta } = checkTrim(a, b);
    const big = ta.faces.map((f, i) => ({ f, i })).sort((x, y) => y.f.area - x.f.area)[0]!.i;
    const bigB = kernel.topology(r.b.shape).faces.map((f, i) => ({ f, i })).sort((x, y) => y.f.area - x.f.area)[0]!.i;
    const k = kernel.knit([keep(kernel.keepFaces(r.a.shape, [big]).shape), keep(kernel.keepFaces(r.b.shape, [bigB]).shape)], 1e-3, false);
    keep(k.shape);
    expect(k.multipleEdges).toBe(0);
    expect(kernel.topology(k.shape).faces).toHaveLength(2);
  });
});
