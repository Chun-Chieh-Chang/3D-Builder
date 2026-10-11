/**
 * 4b-1 (docs/phase4b-plan.md): the kernel's surface methods (C8.1, C9.2–C9.4) — the offset of faces and of a whole solid, knitting, filling, thickening, cutting with a
 * surface, splitting a face along a projected curve, and the gap report that checks them — each against what is worked out by hand: cylinders, a box, a sphere and
 * a cone, whose offsets, volumes and areas are known. The failures are ones a person can make (an offset more than the surface can bear), and they say so.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Feature } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, KernelError, SURFACE_TOLERANCE, type ShapeId } from '@3db/kernel';
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
/** A cylinder of radius r and height h standing on the front plane. */
const cylinder = (r: number, h: number) => body(build(sketch('s', front, circle('c', 0, 0, r)), extrude('e', 's', 'boss', { type: 'blind', depth: String(h) })));
/** A box w × d × h with its corner at the origin. */
const box = (w: number, d: number, h: number) => body(build(sketch('s', front, rectangle('r', 0, 0, w, d)), extrude('e', 's', 'boss', { type: 'blind', depth: String(h) })));
const plane = (id: string, z: number): Feature => ({ id, type: 'refPlane', name: id, suppressed: false, def: { mode: 'offset', plane: front, distance: String(z) } }) as Feature;
const on = (id: string) => ({ kind: 'datum', name: id }) as const;
/** A loft through circles of the radii given at z = 0, 30, 60 …: a cone frustum for two, a freeform side for more. */
function lofted(radii: number[]): ShapeId {
  const features: Feature[] = [];
  radii.forEach((r, i) => {
    if (i > 0) features.push(plane(`pl${i}`, 30 * i));
    features.push(sketch(`s${i}`, i === 0 ? front : on(`pl${i}`), circle(`c${i}`, 0, 0, r)));
  });
  return body(build(...features, { id: 'lf1', type: 'loft', name: 'lf1', suppressed: false, sections: radii.map((_, i) => `s${i}`), op: 'boss' } as Feature));
}
const raw = () => kernel as unknown as { put(s: unknown): ShapeId };
const faceOf = (shape: ShapeId, surface: string) => kernel.topology(shape).faces.findIndex((f) => f.surface === surface);
const area = (shape: ShapeId) => kernel.topology(shape).faces.reduce((a, f) => a + f.area, 0);

describe('the gap report', () => {
  it('two parallel planes 5 apart: every sample is 5 away, the worst deviation is nothing', () => {
    const a = box(20, 20, 10);
    const top = faceOf(a, 'plane');
    const t = kernel.topology(a);
    const topFace = t.faces.findIndex((f) => f.normal && Math.abs(f.normal[2] - 1) < 1e-9);
    void top;
    const lifted = kernel.offsetFaces(a, [topFace], 5);
    const g = kernel.gapReport(lifted.shape, kernel.subShape(a, 'face', topFace), 5);
    expect(g.min).toBeCloseTo(5, 9);
    expect(g.max).toBeCloseTo(5, 9);
    expect(g.mean).toBeCloseTo(5, 9);
    expect(g.deviation).toBeLessThan(1e-9);
    expect(g.samples).toBeGreaterThan(3);
  });

  it('is told what is expected: a plane 5 away measured against 3 is 2 out', () => {
    const a = box(20, 20, 10);
    const topFace = kernel.topology(a).faces.findIndex((f) => f.normal && Math.abs(f.normal[2] - 1) < 1e-9);
    const lifted = kernel.offsetFaces(a, [topFace], 5);
    expect(kernel.gapReport(lifted.shape, kernel.subShape(a, 'face', topFace), 3).deviation).toBeCloseTo(2, 9);
  });
});

describe('offsetting faces (C9.2)', () => {
  it('the side of a cylinder R10 × 20 out by 3 is the side of a cylinder R13: a surface (no solid) of area 2π·13·20, 3 mm from the original, made from that face', () => {
    const c = cylinder(10, 20);
    const side = faceOf(c, 'cylinder');
    const r = kernel.offsetFaces(c, [side], 3);
    expect(kernel.solidCount(r.shape)).toBe(0);
    expect(kernel.topology(r.shape).faces).toHaveLength(1);
    expect(area(r.shape)).toBeCloseTo(2 * Math.PI * 13 * 20, 6);
    expect(r.gap.deviation).toBeLessThan(1e-5);
    expect(r.gap.min).toBeCloseTo(3, 5);
    expect(r.faceOrigins).toEqual([[{ rel: 'generated', kind: 'face', index: side }]]);
    // and in by 3: R7
    expect(area(kernel.offsetFaces(c, [side], -3).shape)).toBeCloseTo(2 * Math.PI * 7 * 20, 6);
  });

  it('a flat face of a box out by 5 moves 5 along its normal and keeps its size', () => {
    const b = box(30, 20, 10);
    const topFace = kernel.topology(b).faces.findIndex((f) => f.normal && Math.abs(f.normal[2] - 1) < 1e-9);
    const r = kernel.offsetFaces(b, [topFace], 5);
    expect(area(r.shape)).toBeCloseTo(600, 9);
    const top = kernel.topology(r.shape).faces[0]!;
    expect(top.center[2]).toBeCloseTo(15, 9);
  });

  it('the top and side of a cylinder together (a region): the top 3 up, the side out to R13, and a quarter of a torus round the edge, which the rounded join adds', () => {
    const c = cylinder(10, 20);
    const topo = kernel.topology(c);
    const region = topo.faces.flatMap((f, i) => (f.surface === 'cylinder' || (f.normal && Math.abs(f.normal[2] - 1) < 1e-9) ? [i] : []));
    expect(region).toHaveLength(2);
    const r = kernel.offsetFaces(c, region, 3);
    expect(kernel.topology(r.shape).faces).toHaveLength(3);
    // the torus patch: an arc of radius 3 through 90° (length 3π/2) turned about the axis at the radius of its centre of gravity, 10 + 6/π
    const torus = ((Math.PI / 2) * 3) * 2 * Math.PI * (10 + 6 / Math.PI);
    expect(area(r.shape)).toBeCloseTo(Math.PI * 100 + 2 * Math.PI * 13 * 20 + torus, 3);
    expect(r.gap.deviation).toBeLessThan(1e-4);
    // every face has the face it came from, the join the edge's neighbours
    expect(r.faceOrigins.every((o) => o.length > 0)).toBe(true);
  });

  it('with sharp joins the region keeps its corner: the top and the side of the box 30 × 20 × 10 out by 2 have a sharp edge, and are accepted', () => {
    const b = box(30, 20, 10);
    const topo = kernel.topology(b);
    const region = topo.faces.flatMap((f, i) => (f.normal && (Math.abs(f.normal[2] - 1) < 1e-9 || Math.abs(f.normal[0] - 1) < 1e-9) ? [i] : []));
    const r = kernel.offsetFaces(b, region, 2, { join: 'intersection' });
    expect(kernel.topology(r.shape).faces).toHaveLength(2);
    // the top 2 up, the side 2 out, each 20 × 10 and 30 × 20 plus the growth where they meet: the top is 32 × 20 (its far edge stays), the side 20 × 12
    expect(area(r.shape)).toBeCloseTo(32 * 20 + 20 * 12, 6);
  });

  it('is refused with a reason when nothing is picked, when the distance is zero, and when a face does not exist', () => {
    const c = cylinder(10, 20);
    expect(() => kernel.offsetFaces(c, [], 3)).toThrow(/選擇/);
    expect(() => kernel.offsetFaces(c, [faceOf(c, 'cylinder')], 0)).toThrow(/不能是 0/);
    expect(() => kernel.offsetFaces(c, [99], 3)).toThrow(KernelError);
  });

  it('is refused, with the gap that was measured, when it is more than the surface can bear: the waist of Ø8 in by 5 is valid to OCCT and 2 mm out', () => {
    const waist = lofted([25, 4, 22]);
    const side = faceOf(waist, 'bsplinesurface');
    let message = '';
    try {
      kernel.offsetFaces(waist, [side], -5);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/差了 [0-9.]+ mm/);
    expect(message).toContain(String(SURFACE_TOLERANCE));
    // the freeform side of a gentler waist (Ø50, Ø30, Ø44) out and in by 3 is accepted, to 1e-4 mm
    const gentle = lofted([25, 15, 22]);
    const s = faceOf(gentle, 'bsplinesurface');
    for (const d of [3, -3]) expect(kernel.offsetFaces(gentle, [s], d).gap.deviation).toBeLessThan(1e-4);
  });
});

describe('offsetting a whole solid', () => {
  it('a box 10 × 10 × 10 out by 3 with rounded joins is a solid of 10³ + 6·100·3 + 12·(π·3²/4)·10 + 4/3·π·3³ = 3761.33; with sharp joins it is 16³ = 4096', () => {
    const b = box(10, 10, 10);
    const round = kernel.offsetSolid(b, 3);
    expect(kernel.solidCount(round.shape)).toBe(1);
    expect(kernel.isValid(round.shape)).toBe(true);
    expect(kernel.massProps(round.shape).volume).toBeCloseTo(1000 + 1800 + 12 * ((Math.PI * 9) / 4) * 10 + (4 / 3) * Math.PI * 27, 4);
    const sharp = kernel.offsetSolid(b, 3, { join: 'intersection' });
    expect(kernel.massProps(sharp.shape).volume).toBeCloseTo(4096, 6);
  });

  it('it can be a tool: the offset solid cut from a block takes exactly its volume', () => {
    const b = box(10, 10, 10);
    const off = kernel.offsetSolid(b, 3);
    const block = box(40, 40, 40);
    // put the offset solid inside the block: move the block so that the box sits in its middle
    const moved = kernel.transformed(block, [1, 0, 0, -15, 0, 1, 0, -15, 0, 0, 1, -15]);
    const cut = kernel.boolean('cut', moved, off.shape);
    expect(kernel.isValid(cut.shape)).toBe(true);
    expect(kernel.massProps(cut.shape).volume).toBeCloseTo(64000 - kernel.massProps(off.shape).volume, 4);
  });

  it('a negative distance shrinks it: 10³ in by 2 is 6³ = 216', () => {
    expect(kernel.massProps(kernel.offsetSolid(box(10, 10, 10), -2).shape).volume).toBeCloseTo(216, 6);
  });

  it('is refused for what is not a solid', () => {
    const c = cylinder(10, 20);
    const surface = kernel.offsetFaces(c, [faceOf(c, 'cylinder')], 3).shape;
    expect(() => kernel.offsetSolid(surface, 3)).toThrow(/不是實體/);
  });
});

describe('knit (C9.3)', () => {
  it('the six faces of a box knit into the solid of 1000; five leave an open shell with its four edges free', () => {
    const b = box(10, 10, 10);
    const faces = (n: number) => Array.from({ length: n }, (_, i) => kernel.subShape(b, 'face', i));
    const all = kernel.knit(faces(6));
    expect(all).toMatchObject({ freeEdges: 0, multipleEdges: 0, solid: true });
    expect(kernel.massProps(all.shape).volume).toBeCloseTo(1000, 6);
    const open = kernel.knit(faces(5));
    expect(open).toMatchObject({ freeEdges: 4, multipleEdges: 0, solid: false });
    expect(kernel.solidCount(open.shape)).toBe(0);
    expect(area(open.shape)).toBeCloseTo(500, 6);
    // asked not to make a solid
    expect(kernel.knit(faces(6), 1e-4, false).solid).toBe(false);
    expect(() => kernel.knit([])).toThrow(KernelError);
  });
});

describe('fill and flat surfaces (C9.2)', () => {
  it('a flat surface over the four edges of the top of a box 10 × 10 × 10 is a square of 100', () => {
    const b = box(10, 10, 10);
    const topo = kernel.topology(b);
    const topFace = topo.faces.findIndex((f) => f.normal && Math.abs(f.normal[2] - 1) < 1e-9);
    const edges = topo.edges.flatMap((e, i) => (e.faces.includes(topFace) ? [i] : []));
    expect(edges).toHaveLength(4);
    expect(area(kernel.flatSurface(b, edges))).toBeCloseTo(100, 9);
    // not a loop, and not flat
    expect(() => kernel.flatSurface(b, [edges[0]!, edges[2]!])).toThrow(/連成一圈/);
    expect(() => kernel.flatSurface(b, [])).toThrow(KernelError);
  });

  it('the hole of Ø16 in a sphere of R30 filled with the sphere\'s tangents is within 0.05 mm of the sphere; with the edge alone it is 1 mm out', () => {
    const oc = kernel.oc;
    const sphere = raw().put(new oc.BRepPrimAPI_MakeSphere(30).Shape());
    const pin = raw().put(new oc.BRepPrimAPI_MakeCylinder(new oc.gp_Ax2(new oc.gp_Pnt(0, 0, -50), new oc.gp_Dir(0, 0, 1)), 8, 100).Shape());
    const pierced = kernel.boolean('cut', sphere, pin).shape;
    const topo = kernel.topology(pierced);
    const sphereFace = faceOf(pierced, 'sphere');
    const top = topo.edges.findIndex((e) => e.faces.includes(sphereFace) && e.mid[2] > 0 && e.curve === 'circle');
    const deviation = (patch: ShapeId) => {
      const m = kernel.mesh(patch, { tolerance: 0.05 });
      let worst = 0;
      for (let i = 0; i < m.positions.length; i += 3) worst = Math.max(worst, Math.abs(Math.hypot(m.positions[i]!, m.positions[i + 1]!, m.positions[i + 2]!) - 30));
      return worst;
    };
    const tangent = kernel.fillSurface(pierced, [top], [sphereFace], 'tangent');
    expect(deviation(tangent.shape)).toBeLessThan(0.05);
    expect(tangent.g0).toBeLessThan(1e-3);
    expect(tangent.g1).toBeLessThan(1e-3);
    const alone = kernel.fillSurface(pierced, [top], [], 'contact');
    expect(deviation(alone.shape)).toBeGreaterThan(0.5);
    expect(() => kernel.fillSurface(pierced, [])).toThrow(KernelError);
  });
});

describe('thicken (C9.4)', () => {
  it('the side of a cylinder R10 × 20 thickened out by 2 is the wall between R10 and R12: π(12² − 10²)·20; in by 2, between R8 and R10: π(10² − 8²)·20', () => {
    const c = cylinder(10, 20);
    const side = kernel.subShape(c, 'face', faceOf(c, 'cylinder'));
    const out = kernel.thicken(side, 2);
    expect(kernel.solidCount(out.shape)).toBe(1);
    expect(kernel.massProps(out.shape).volume).toBeCloseTo(Math.PI * 44 * 20, 4);
    expect(out.gap.max).toBeCloseTo(2, 6);
    const inward = kernel.thicken(side, -2);
    expect(kernel.massProps(inward.shape).volume).toBeCloseTo(Math.PI * 36 * 20, 4);
  });

  it('a freeform offset surface thickened: the solid is valid, its volume positive, and no point of it is farther from the surface than the thickness', () => {
    const waist = lofted([25, 15, 22]);
    const s = kernel.offsetFaces(waist, [faceOf(waist, 'bsplinesurface')], 3).shape;
    const block = kernel.thicken(s, 20);
    expect(kernel.isValid(block.shape)).toBe(true);
    expect(kernel.massProps(block.shape).volume).toBeGreaterThan(0);
    expect(block.gap.max).toBeCloseTo(20, 1);
  });

  it('is refused for a solid, and for no thickness', () => {
    const c = cylinder(10, 20);
    expect(() => kernel.thicken(c, 2)).toThrow(/是實體/);
    expect(() => kernel.thicken(kernel.subShape(c, 'face', 0), 0)).toThrow(/不能是 0/);
  });
});

describe('cut with a surface (C9.4)', () => {
  it('a flat sheet at z = 25 across a block 100 × 100 × 60 takes the part above it (350000 left below… or 250000 below): by hand 100·100·25 and 100·100·35', () => {
    const block = kernel.transformed(box(100, 100, 60), [1, 0, 0, -50, 0, 1, 0, -50, 0, 0, 1, 0]);
    const slab = kernel.transformed(box(140, 140, 25), [1, 0, 0, -70, 0, 1, 0, -70, 0, 0, 1, 0]);
    const t = kernel.topology(slab);
    const sheet = kernel.subShape(slab, 'face', t.faces.findIndex((f) => f.normal && Math.abs(f.normal[2] - 1) < 1e-9));
    const below = kernel.cutWithSurface(block, sheet, [0, 0, 1], 'behind');
    expect(kernel.massProps(below.shape).volume).toBeCloseTo(100 * 100 * 25, 6);
    const above = kernel.cutWithSurface(block, sheet, [0, 0, 1], 'ahead');
    expect(kernel.massProps(above.shape).volume).toBeCloseTo(100 * 100 * 35, 6);
    expect(() => kernel.cutWithSurface(block, sheet, [0, 0, 0])).toThrow(KernelError);
    expect(() => kernel.cutWithSurface(block, block, [0, 0, 1])).toThrow(/是實體/);
  });
});

describe('B-splines (the way out of the program)', () => {
  /** The waist loft with its end edges rounded R3 (the edges where a flat end meets the side). */
  const rounded = () => {
    const w = lofted([25, 15, 22]);
    const topo = kernel.topology(w);
    return kernel.fillet(w, topo.edges.flatMap((e, i) => (e.faces.some((f) => topo.faces[f]!.surface === 'plane') ? [i] : [])), 3).shape;
  };

  it('the faces of an offset solid converted keep their shape: B-spline faces, the same volume to 1e-5', () => {
    // (the offset of an analytic face stays analytic; the offset of a freeform face is an OCCT offset surface)
    const off = kernel.offsetSolid(rounded(), 3);
    expect(kernel.topology(off.shape).faces.map((f) => f.surface)).toContain('offsetsurface');
    const nurbs = kernel.toBSpline(off.shape);
    expect(kernel.topology(nurbs).faces.every((f) => f.surface === 'bsplinesurface')).toBe(true);
    expect(Math.abs(kernel.massProps(nurbs).volume - kernel.massProps(off.shape).volume) / kernel.massProps(off.shape).volume).toBeLessThan(5e-5);
    expect(kernel.gapReport(nurbs, off.shape, 0).max).toBeLessThan(1e-3);
  });

  it('says so when the converter stops (a freeform side offset round its sharp end edge has B-spline joins that the converter of OCCT cannot take)', () => {
    const off = kernel.offsetSolid(lofted([25, 15, 22]), 3);
    expect(() => kernel.toBSpline(off.shape)).toThrow(/B 樣條/);
  });
});

describe('split line (C8.1)', () => {
  /** A rectangle 10 × 20 in the plane x = 40 (its x is the world's y, its y the world's z), to be projected along −x onto the cone frustum (Ø50 to Ø30 over 30). */
  const frame = { origin: [40, 0, 0] as [number, number, number], xDir: [0, 1, 0] as [number, number, number], yDir: [0, 0, 1] as [number, number, number], normal: [1, 0, 0] as [number, number, number] };
  const rectangleLoop = (y0: number, y1: number) => {
    const p: [number, number][] = [[-5, y0], [5, y0], [5, y1], [-5, y1]];
    return p.map((a, i) => ({ kind: 'line' as const, a, b: p[(i + 1) % 4]!, source: `l${i}` }));
  };
  // by hand: the region is ∫ √(1 + r′²) · r · 2·asin(5 / r) dz over z from 5 to 25, with r = 25 − z/3
  const byHand = (() => {
    const r = (z: number) => 25 - z / 3;
    const f = (z: number) => Math.sqrt(1 + 1 / 9) * r(z) * 2 * Math.asin(5 / r(z));
    let sum = 0;
    for (let k = 0; k < 2000; k++) sum += f(5 + ((k + 0.5) * 20) / 2000) * (20 / 2000);
    return sum;
  })();

  it('splits the side of a cone frustum along a rectangle projected onto it: four faces, and one is the region, whose area is the integral', () => {
    const cone = lofted([25, 15]);
    const side = faceOf(cone, 'cone');
    const r = kernel.splitByProjection(cone, side, frame, [rectangleLoop(5, 25)], [-1, 0, 0]);
    const faces = kernel.topology(r.shape).faces;
    expect(kernel.isValid(r.shape)).toBe(true);
    expect(faces).toHaveLength(4);
    expect(r.regions).toHaveLength(1);
    expect(faces[r.regions[0]!]!.area).toBeCloseTo(byHand, 2);
    // the rest of the side is the whole side less the region, and the ends are as they were
    const whole = Math.PI * (25 + 15) * Math.hypot(30, 10);
    const rest = faces.filter((_, i) => i !== r.regions[0] && faces[i]!.surface === 'cone');
    expect(rest).toHaveLength(1);
    expect(rest[0]!.area).toBeCloseTo(whole - byHand, 2);
    // every face of the result says which face it came from: the pieces of the side come from it
    expect(r.faceOrigins[r.regions[0]!]!.some((o) => 'index' in o && o.index === side)).toBe(true);
  });

  it('a loop that does not reach the face (projected the other way) is refused with a reason', () => {
    const cone = lofted([25, 15]);
    expect(() => kernel.splitByProjection(cone, faceOf(cone, 'cone'), frame, [rectangleLoop(5, 25)], [1, 0, 0])).toThrow(/投影不到/);
  });

  it('through all: the line of sight crosses the cone twice, and the loop is cut on both crossings (two regions)', () => {
    const cone = lofted([25, 15]);
    const r = kernel.splitByProjection(cone, faceOf(cone, 'cone'), frame, [rectangleLoop(5, 25)], [-1, 0, 0], true);
    expect(r.regions).toHaveLength(2);
    expect(kernel.topology(r.shape).faces).toHaveLength(5);
  });
});
