/**
 * Spike for 曲面互相修剪 (mutual surface trim; docs/surface-trim-plan.md): can the kernel's OCCT build cut two surface bodies at their intersection and tell which piece came
 * from which surface? It is tried with the general fuse (`BRepAlgoAPI_BuilderAlgo`) on two surfaces, called through the kernel's handles. Numbers are worked out by hand:
 *   - two planes crossing: 40 × 40 at z = 0 and 40 × 40 at y = 0 → four pieces of 40 × 20 = 800, along a seam of 40;
 *   - a cylinder side (R10, z 0..20, area 2π·10·20 = 1256.6) crossed by the plane z = 10 (a 40 × 40 square, 1600) → two sides of 628.3, a disk π·10² = 314.2 inside the circle and the
 *     square with the hole 1600 − 314.2 = 1285.8 outside it;
 *   - a plane that cuts the other only part of the way (a seam that ends inside the face): the face stays one, with the seam on it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type Frame, type Region, type ShapeId } from '@3db/kernel';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await Kernel.load();
});
const made: ShapeId[] = [];
afterAll(() => made.forEach((s) => kernel.release(s)));

const line = (a: [number, number], b: [number, number], source: string) => ({ kind: 'line' as const, a, b, source });
const rect = (x0: number, y0: number, x1: number, y1: number, id: string): Region => ({
  outer: [line([x0, y0], [x1, y0], `${id}.a`), line([x1, y0], [x1, y1], `${id}.b`), line([x1, y1], [x0, y1], `${id}.c`), line([x0, y1], [x0, y0], `${id}.d`)],
  holes: [],
});
const keep = (s: ShapeId): ShapeId => {
  made.push(s);
  return s;
};
/** The face of a thin slab or a block that faces `dir` (the one whose centre is furthest that way), as a shape of its own: a surface body. */
const faceTo = (solid: ShapeId, dir: [number, number, number]): ShapeId => {
  const faces = kernel.topology(solid).faces;
  const score = (c: number[]) => c[0]! * dir[0] + c[1]! * dir[1] + c[2]! * dir[2];
  let best = 0;
  faces.forEach((f, i) => {
    if (score(f.center) > score(faces[best]!.center)) best = i;
  });
  return keep(kernel.subShape(solid, 'face', best));
};
const floor: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
/** A plane of 40 × 40 at z = 0 centred on the axis. */
const horizontal = (): ShapeId => faceTo(keep(kernel.extrude(floor, [rect(-20, -20, 20, 20, 'h')], [0, 0, 1]).shape), [0, 0, -1]);
/** A plane of w × h standing at y = 0 (x from -w/2 to w/2, z from -h/2 to h/2). */
const upright = (w: number, h: number): ShapeId => {
  const frame: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 0, 1], normal: [0, -1, 0] };
  return faceTo(keep(kernel.extrude(frame, [rect(-w / 2, -h / 2, w / 2, h / 2, 'u')], [0, -1, 0]).shape), [0, 1, 0]);
};

// the general fuse of the surfaces, through the kernel's handles: the pieces, and the pieces each input became
function trim(inputs: ShapeId[], simplify = false) {
  const k = kernel as unknown as { oc: any; get(id: ShapeId): any; put(s: any): ShapeId };
  const oc = k.oc;
  const args = new oc.NCollection_List_TopoDS_Shape();
  for (const i of inputs) args.Append(k.get(i));
  const mk = new oc.BRepAlgoAPI_BuilderAlgo();
  mk.SetArguments(args);
  mk.SetToFillHistory(true);
  mk.Build(new oc.Message_ProgressRange());
  expect(mk.IsDone()).toBe(true);
  if (simplify) mk.SimplifyResult(true, true, 1e-9);
  const shape = keep(k.put(mk.Shape()));
  const topology = kernel.topology(shape);
  const piecesOf = inputs.map((i) => {
    const out: { area: number; center: number[] }[] = [];
    const explore = (s: any) => {
      const id = k.put(s);
      for (const f of kernel.topology(id).faces) out.push({ area: f.area, center: [...f.center] });
      kernel.release(id);
    };
    const faces = new oc.TopExp_Explorer(k.get(i), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    for (; faces.More(); faces.Next()) {
      const f = faces.Current();
      const list = mk.Modified(f);
      const copy = new oc.NCollection_List_TopoDS_Shape(list);
      let n = 0;
      while (!copy.IsEmpty()) {
        explore(copy.First());
        copy.RemoveFirst();
        n++;
      }
      if (n === 0 && !mk.IsDeleted(f)) explore(f);
    }
    return out;
  });
  return { shape, topology, piecesOf };
}
const areas = (xs: { area: number }[]) => xs.map((x) => x.area).sort((a, b) => a - b);

describe('surface trim spike', () => {
  it('two planes crossing: four pieces of 800, two from each, and a seam of 40 shared (the seam is an edge of all four)', () => {
    const r = trim([horizontal(), upright(40, 40)]);
    expect(areas(r.topology.faces)).toEqual([expect.closeTo(800, 6), expect.closeTo(800, 6), expect.closeTo(800, 6), expect.closeTo(800, 6)]);
    expect(areas(r.piecesOf[0]!)).toEqual([expect.closeTo(800, 6), expect.closeTo(800, 6)]);
    expect(areas(r.piecesOf[1]!)).toEqual([expect.closeTo(800, 6), expect.closeTo(800, 6)]);
    // the pieces of the horizontal plane lie on the two sides of y = 0, the pieces of the upright one above and below z = 0
    expect(r.piecesOf[0]!.map((p) => Math.sign(p.center[1]!)).sort()).toEqual([-1, 1]);
    expect(r.piecesOf[1]!.map((p) => Math.sign(p.center[2]!)).sort()).toEqual([-1, 1]);
    // the seam (length 40, through the origin) is one edge, and all four pieces are on it
    const seam = r.topology.edges.filter((e) => Math.abs(e.length - 40) < 1e-6 && e.mid.every((c) => Math.abs(c) < 1e-6));
    expect(seam).toHaveLength(1);
    expect([...seam[0]!.faces].sort()).toEqual([0, 1, 2, 3]);
  });

  it('a cylinder side crossed by the plane z = 10: the side is two halves of 628.3, the plane is the disk 314.2 and the square with a hole 1285.8', () => {
    // the side is the face of the extrusion with the area 2π·10·20; find it by area
    const solid = keep(kernel.extrude(floor, [{ outer: [{ kind: 'circle' as const, c: [0, 0] as [number, number], r: 10, source: 'c' }], holes: [] }], [0, 0, 20]).shape);
    const faces = kernel.topology(solid).faces;
    const side = keep(kernel.subShape(solid, 'face', faces.findIndex((f) => Math.abs(f.area - 2 * Math.PI * 10 * 20) < 1e-3)));
    const frame: Frame = { origin: [0, 0, 10], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
    const slab = keep(kernel.extrude(frame, [rect(-20, -20, 20, 20, 'p')], [0, 0, 1]).shape);
    const plane = faceTo(slab, [0, 0, -1]);
    const r = trim([side, plane]);
    expect(areas(r.piecesOf[0]!)).toEqual([expect.closeTo(628.318, 2), expect.closeTo(628.318, 2)]);
    expect(areas(r.piecesOf[1]!)).toEqual([expect.closeTo(314.159, 2), expect.closeTo(1600 - 314.159, 2)]);
    expect(r.topology.faces).toHaveLength(4);
  });

  it('a seam that ends inside the face: the plane that is cut through stays two pieces, the face it only reaches into stays one', () => {
    const r = trim([horizontal(), upright(20, 20)]);
    expect(areas(r.piecesOf[0]!)).toEqual([expect.closeTo(1600, 6)]);
    expect(areas(r.piecesOf[1]!)).toEqual([expect.closeTo(200, 6), expect.closeTo(200, 6)]);
  });

  it('surfaces that do not meet are left as they are', () => {
    const r = trim([horizontal(), upright(10, 10)].slice(0, 1).concat(faceTo(keep(kernel.extrude({ origin: [0, 0, 50], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] }, [rect(-5, -5, 5, 5, 'f')], [0, 0, 1]).shape), [0, 0, -1])));
    expect(areas(r.piecesOf[0]!)).toEqual([expect.closeTo(1600, 6)]);
    expect(areas(r.piecesOf[1]!)).toEqual([expect.closeTo(100, 6)]);
  });
  it('two cylinders, a thin one through a thick one (R6 along x through R10 along z): the thick side is a patch for each hole and the rest (3), the thin one is three (outside, inside, outside); no area is lost', () => {
    const circle = (r: number): Region => ({ outer: [{ kind: 'circle' as const, c: [0, 0] as [number, number], r, source: 'c' }], holes: [] });
    const sideOf = (solid: ShapeId, area: number) => keep(kernel.subShape(solid, 'face', kernel.topology(solid).faces.findIndex((f) => Math.abs(f.area - area) < 1e-3)));
    const thick = sideOf(keep(kernel.extrude({ origin: [0, 0, -20], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] }, [circle(10)], [0, 0, 40]).shape), 2 * Math.PI * 10 * 40);
    const thin = sideOf(keep(kernel.extrude({ origin: [-20, 0, 0], xDir: [0, 1, 0], yDir: [0, 0, 1], normal: [1, 0, 0] }, [circle(6)], [40, 0, 0]).shape), 2 * Math.PI * 6 * 40);
    const r = trim([thick, thin], true);
    expect(r.piecesOf[0]!).toHaveLength(3);
    expect(r.piecesOf[1]!).toHaveLength(3);
    expect(r.piecesOf[0]!.reduce((a, p) => a + p.area, 0)).toBeCloseTo(2 * Math.PI * 10 * 40, 1);
    expect(r.piecesOf[1]!.reduce((a, p) => a + p.area, 0)).toBeCloseTo(2 * Math.PI * 6 * 40, 1);
    // the middle of the thin one is inside the thick one: its centre is at the origin
    const inside = r.piecesOf[1]!.filter((p) => Math.abs(p.center[0]!) < 1e-3);
    expect(inside).toHaveLength(1);
  });

  it('what it does when it does not know: a plane on a plane (the same one twice) and a plane that touches a cylinder along a line', () => {
    const same = trim([horizontal(), horizontal()]);
    console.log('same plane twice:', same.topology.faces.length, 'faces', areas(same.topology.faces), 'from the first', areas(same.piecesOf[0]!), 'from the second', areas(same.piecesOf[1]!));
    const solid = keep(kernel.extrude(floor, [{ outer: [{ kind: 'circle' as const, c: [0, 0] as [number, number], r: 10, source: 'c' }], holes: [] }], [0, 0, 20]).shape);
    const side = keep(kernel.subShape(solid, 'face', kernel.topology(solid).faces.findIndex((f) => Math.abs(f.area - 2 * Math.PI * 10 * 20) < 1e-3)));
    const touch = keep(kernel.extrude({ origin: [10, -20, 0], xDir: [0, 1, 0], yDir: [0, 0, 1], normal: [1, 0, 0] }, [rect(0, -5, 40, 25, 't')], [1, 0, 0]).shape);
    const tangent = trim([side, faceTo(touch, [-1, 0, 0])]);
    console.log('tangent plane:', tangent.topology.faces.length, 'faces', areas(tangent.topology.faces));
    expect(same.topology.faces.length).toBeGreaterThan(0);
    expect(tangent.topology.faces.length).toBeGreaterThan(0);
  });
  it('then the existing 修剪 (keepFaces) keeps the pieces wanted: of the four, the one half of each plane (y > 0 of the horizontal, z > 0 of the upright) is 2 faces of 800 sharing the seam', () => {
    const r = trim([horizontal(), upright(40, 40)]);
    const wanted = r.topology.faces.map((f, i) => ({ f, i })).filter(({ f }) => (Math.abs(f.center[2]!) < 1e-6 && f.center[1]! > 0) || (Math.abs(f.center[1]!) < 1e-6 && f.center[2]! > 0));
    expect(wanted).toHaveLength(2);
    const kept = keep(kernel.keepFaces(r.shape, wanted.map((w) => w.i)).shape);
    const t = kernel.topology(kept);
    expect(areas(t.faces)).toEqual([expect.closeTo(800, 6), expect.closeTo(800, 6)]);
    expect(kernel.solidCount(kept)).toBe(0);
    expect(t.edges.filter((e) => e.faces.length === 2)).toHaveLength(1); // the seam, shared by the two
  });
  it('a free-form side (a loft from a circle R10 to a square of 16, B-splines) cut by the plane z = 10: two bands, the disk-like patch inside the curve and the rest of the plane; no area is lost', () => {
    const at = (z: number): Frame => ({ origin: [0, 0, z], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] });
    const square = rect(-8, -8, 8, 8, 'q').outer;
    const solid = keep(kernel.loft([{ frame: at(0), outer: [{ kind: 'circle' as const, c: [0, 0] as [number, number], r: 10, source: 'c' }] }, { frame: at(20), outer: square }]).shape);
    // the loft has five B-spline faces for its side (the corners of the square divide it) and two planes for its ends: the side is the five, kept as one surface body
    const faces = kernel.topology(solid).faces;
    const sideFaces = faces.map((f, i) => i).filter((i) => Math.abs(faces[i]!.center[2]!) > 1e-6 && Math.abs(faces[i]!.center[2]! - 20) > 1e-6 && faces[i]!.area !== 314.1592653589793);
    expect(sideFaces).toHaveLength(5);
    const side = keep(kernel.keepFaces(solid, sideFaces).shape);
    const plane = faceTo(keep(kernel.extrude({ origin: [0, 0, 10], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] }, [rect(-30, -30, 30, 30, 'p')], [0, 0, 1]).shape), [0, 0, -1]);
    const r = trim([side, plane], true);
    const total = sideFaces.reduce((acc, i) => acc + faces[i]!.area, 0);
    expect(r.piecesOf[0]!.reduce((a, p) => a + p.area, 0)).toBeCloseTo(total, 1);
    expect(r.piecesOf[0]!.filter((p) => p.center[2]! < 10)).toHaveLength(5);
    expect(r.piecesOf[0]!.filter((p) => p.center[2]! > 10)).toHaveLength(5);
    expect(r.piecesOf[1]!).toHaveLength(2);
    expect(r.piecesOf[1]!.reduce((a, p) => a + p.area, 0)).toBeCloseTo(3600, 3);
    // the inside patch is between the circle R10 (area 314) and the square 16 × 16 (256) at the height 10: about the mean, and the rest is 3600 minus it
    const inner = Math.min(...r.piecesOf[1]!.map((p) => p.area));
    expect(inner).toBeGreaterThan(256);
    expect(inner).toBeLessThan(314.2);
  });
});
