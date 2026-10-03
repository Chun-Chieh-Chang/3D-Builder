/**
 * 4b-0 (docs/phase4b-plan.md): the technical validation of what 檢具 (the form block of a gauge) needs from OCCT, before any of it is built: the offset of a freeform
 * surface by the gap (the risk the blueprint names first), sewing the offset faces into a shell, filling a hole in a surface, thickening a surface into a solid, cutting
 * a solid with a surface, and splitting the faces of a solid along a curve projected onto it. The workpiece is made here: lofts through circles of different radii
 * (their sides are freeform B-spline surfaces, convex around and concave along the waist). The gap is measured the way the acceptance measures it: the distance from
 * points of the offset surface to the surface it was offset from, which must be the gap to 0.05 mm.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Feature, PartDoc } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type ShapeId } from '@3db/kernel';
import { Regenerator } from '@3db/regen';
import { build, circle, front, sketch } from '../phase1/builders';

type Raw = { put(shape: unknown): ShapeId; get(id: ShapeId): any };
let kernel: Kernel;
let raw: Raw;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
beforeAll(async () => {
  kernel = await Kernel.load();
  raw = kernel as unknown as Raw;
  solver = await PlaneGcsSolver.create();
});
afterAll(() => kept.forEach((r) => r.dispose()));

const plane = (id: string, z: number): Feature => ({ id, type: 'refPlane', name: id, suppressed: false, def: { mode: 'offset', plane: front, distance: String(z) } }) as Feature;
const on = (id: string) => ({ kind: 'datum', name: id }) as const;
const loft = (sections: string[]): Feature => ({ id: 'lf1', type: 'loft', name: 'lf1', suppressed: false, sections, op: 'boss' }) as Feature;

/** A loft through circles of radius `radii` at z = 0, 30, 60 …: a freeform side, with a waist when the middle one is smaller. */
function lofted(radii: number[]): { shape: ShapeId; doc: PartDoc } {
  const features: Feature[] = [];
  const ids: string[] = [];
  radii.forEach((r, i) => {
    const p = `pl${i}`;
    if (i > 0) features.push(plane(p, 30 * i));
    features.push(sketch(`s${i}`, i === 0 ? front : on(p), circle(`c${i}`, 0, 0, r)));
    ids.push(`s${i}`);
  });
  const doc = build(...features, loft(ids));
  const regen = new Regenerator(kernel, solver, new Map());
  kept.push(regen);
  const r = regen.rebuild(doc);
  expect(r.features.filter((f) => f.status !== 'ok').map((f) => f.message)).toEqual([]);
  return { shape: r.body!.shape, doc };
}

/** The faces of a shape that are not planar: the freeform sides. */
const sides = (shape: ShapeId) => kernel.topology(shape).faces.flatMap((f, i) => (f.surface !== 'plane' ? [i] : []));

/** Whether a gap of `d` mm separates the points of `offset` from `base`: the worst distance minus `d`, over the vertices of the offset's mesh. */
function worstGap(offset: ShapeId, base: ShapeId, d: number, samples = 150): { worst: number; points: number } {
  const oc = kernel.oc;
  const mesh = kernel.mesh(offset, { deflection: 0.2 } as never);
  const n = mesh.positions.length / 3;
  const step = Math.max(1, Math.floor(n / samples));
  let worst = 0;
  let count = 0;
  for (let i = 0; i < n; i += step) {
    const p = new oc.gp_Pnt(mesh.positions[3 * i]!, mesh.positions[3 * i + 1]!, mesh.positions[3 * i + 2]!);
    const vertex = new oc.BRepBuilderAPI_MakeVertex(p).Vertex();
    const id = raw.put(vertex);
    try {
      worst = Math.max(worst, Math.abs(kernel.distance(id, base).distance - d));
      count++;
    } finally {
      kernel.release(id);
    }
  }
  return { worst, points: count };
}

/** The offset of a shape by `d` (positive: along the outward normals) with OCCT's `MakeOffsetShape`; null with the reason when it does not give a valid shape. */
function offset(shape: ShapeId, d: number, join: 'arc' | 'intersection' = 'arc'): { id: ShapeId | null; why: string } {
  const oc = kernel.oc;
  const mk = new oc.BRepOffsetAPI_MakeOffsetShape();
  try {
    mk.PerformByJoin(raw.get(shape), d, 1e-4, oc.BRepOffset_Mode.BRepOffset_Skin, false, false, join === 'arc' ? oc.GeomAbs_JoinType.GeomAbs_Arc : oc.GeomAbs_JoinType.GeomAbs_Intersection, false, new oc.Message_ProgressRange());
    if (!mk.IsDone()) return { id: null, why: 'not done' };
    let out = mk.Shape();
    // OCCT gives the offset of a solid as a closed shell, which booleans refuse as a tool: it is made into the solid it bounds
    if (String(out.ShapeType()) === 'TopAbs_SHELL' && kernel.solidCount(shape) > 0) out = new oc.BRepBuilderAPI_MakeSolid(oc.TopoDS.Shell(out)).Solid();
    const id = raw.put(out);
    return { id, why: '' };
  } catch (e) {
    return { id: null, why: String(e) };
  }
}

describe('the workpiece: freeform sides', () => {
  it('a loft through three circles (Ø50, Ø30, Ø44) has a freeform side and two flat ends', () => {
    const { shape } = lofted([25, 15, 22]);
    const topo = kernel.topology(shape);
    expect(topo.faces.map((f) => f.surface).sort()).toEqual(['bsplinesurface', 'plane', 'plane']);
    expect(sides(shape)).toHaveLength(1);
    expect(kernel.isValid(shape)).toBe(true);
  });
});

describe('the offset of a freeform surface (the gap), measured', () => {
  const cases: [string, number[]][] = [
    ['a cone frustum (analytic)', [25, 15]],
    ['a waist (three circles Ø50, Ø30, Ø44)', [25, 15, 22]],
    ['a bulge (Ø30, Ø50, Ø30)', [15, 25, 15]],
    ['an S (Ø20, Ø40, Ø20, Ø40)', [10, 20, 10, 20]],
  ];
  for (const [name, radii] of cases) {
    it(`${name}: the side offset out by 3 is valid and 3 mm from the side everywhere (0.05 mm)`, () => {
      const { shape } = lofted(radii);
      const face = kernel.subShape(shape, 'face', sides(shape)[0]!);
      const out = offset(face, 3);
      expect(out.why).toBe('');
      const gap = worstGap(out.id!, face, 3);
      console.log(`[4b-0] ${name} +3: ${gap.points} points, worst |d − 3| = ${gap.worst.toExponential(2)} mm`);
      expect(gap.worst).toBeLessThan(0.05);
    });
  }

  it('the other way (in by 3) is as good where the surface allows it: the waist is convex around (R ≥ 15) and concave along it', () => {
    const { shape } = lofted([25, 15, 22]);
    const face = kernel.subShape(shape, 'face', sides(shape)[0]!);
    const out = offset(face, -3);
    expect(out.why).toBe('');
    const gap = worstGap(out.id!, face, 3);
    console.log(`[4b-0] waist −3: worst |d − 3| = ${gap.worst.toExponential(2)} mm`);
    expect(gap.worst).toBeLessThan(0.05);
  });
});

// ---------------------------------------------------------------- a region of several faces, and the ways it fails

/** A workpiece with its end edges rounded: the waist loft with R3 on the circles at both ends, so its form surface is the side, the two fillets and (for the top) a flat. */
function rounded(radii: number[], radius: number): { shape: ShapeId; regen: Regenerator } {
  const { shape: loftShape } = lofted(radii);
  const topo = kernel.topology(loftShape);
  // the edges where a flat end meets the side (the loft may give them as B-splines, not circles)
  const circles = topo.edges.flatMap((e, i) => (e.faces.some((f) => topo.faces[f]!.surface === 'plane') ? [i] : []));
  const r = kernel.fillet(loftShape, circles, radius);
  return { shape: r.shape, regen: kept[kept.length - 1]! };
}

/** The faces of `indices` of a shape, sewn into one shell. */
function shellOf(shape: ShapeId, indices: number[]): ShapeId {
  const oc = kernel.oc;
  const sew = new oc.BRepBuilderAPI_Sewing(1e-6, true, true, true, false);
  for (const i of indices) {
    const f = kernel.subShape(shape, 'face', i);
    sew.Add(raw.get(f));
  }
  sew.Perform(new oc.Message_ProgressRange());
  return raw.put(sew.SewedShape());
}

describe('a region of faces offset together: the form surface of a workpiece with rounded edges', () => {
  it('the side and its two R3 fillets (a connected region of three faces) offset out by 3: valid, one connected shell, 3 mm from the region', () => {
    const { shape } = rounded([25, 15, 22], 3);
    const topo = kernel.topology(shape);
    const form = topo.faces.flatMap((f, i) => (f.surface !== 'plane' ? [i] : []));
    expect(form.length).toBe(3);
    const region = shellOf(shape, form);
    const out = offset(region, 3);
    expect(out.why).toBe('');
    expect(kernel.isValid(out.id!)).toBe(true);
    const faces = kernel.topology(out.id!).faces.length;
    const gap = worstGap(out.id!, region, 3);
    console.log(`[4b-0] side + 2 fillets +3 (arc join): ${faces} faces, ${gap.points} points, worst |d − 3| = ${gap.worst.toExponential(2)} mm`);
    expect(gap.worst).toBeLessThan(0.05);
    const inter = offset(region, 3, 'intersection');
    if (inter.id) console.log(`[4b-0] same, intersection join: valid ${kernel.isValid(inter.id)}, ${kernel.topology(inter.id).faces.length} faces, worst ${worstGap(inter.id, region, 3).worst.toExponential(2)}`);
    else console.log(`[4b-0] same, intersection join: ${inter.why}`);
  });

  it('the whole solid offset out by 3 (the gap all round): a valid solid whose faces are all 3 mm from the workpiece', () => {
    const { shape } = rounded([25, 15, 22], 3);
    const out = offset(shape, 3);
    expect(out.why).toBe('');
    expect(kernel.isValid(out.id!)).toBe(true);
    const vol = kernel.massProps(out.id!).volume;
    const base = kernel.massProps(shape).volume;
    console.log(`[4b-0] solid +3: volume ${base.toFixed(1)} → ${vol.toFixed(1)}, ${kernel.topology(out.id!).faces.length} faces`);
    expect(vol).toBeGreaterThan(base);
    const gap = worstGap(out.id!, shape, 3);
    console.log(`[4b-0] solid +3: worst |d − 3| = ${gap.worst.toExponential(2)} mm over ${gap.points} points`);
    expect(gap.worst).toBeLessThan(0.05);
  });

  it('a block with a cavity the shape of the workpiece and 3 mm bigger (the form block): block − offset solid is valid and its cavity is 3 mm from the workpiece', () => {
    const { shape } = rounded([25, 15, 22], 3);
    const out = offset(shape, 3);
    expect(out.id).not.toBeNull();
    // stock: a box 80 × 80 × 80 about the axis, from z = −10
    const oc = kernel.oc;
    const box = new oc.BRepPrimAPI_MakeBox(new oc.gp_Pnt(-40, -40, -10), 80, 80, 80).Shape();
    const blockId = raw.put(box);
    const cut = kernel.boolean('cut', blockId, out.id!);
    expect(kernel.isValid(cut.shape)).toBe(true);
    const v = kernel.massProps(cut.shape).volume;
    const vOffset = kernel.massProps(out.id!).volume;
    // the offset solid is entirely inside the stock (r ≤ 28 < 40, z from −3 to 63 within −10…70): the block loses exactly its volume
    expect(v).toBeCloseTo(80 * 80 * 80 - vOffset, 3);
    // the faces that were cut into the block are 3 mm from the workpiece
    const topo = kernel.topology(cut.shape);
    const cavity = topo.faces.flatMap((f, i) => (Math.abs(Math.abs(f.center[0]) - 40) > 1e-6 && Math.abs(Math.abs(f.center[1]) - 40) > 1e-6 && Math.abs(f.center[2] + 10) > 1e-6 && Math.abs(f.center[2] - 70) > 1e-6 ? [i] : []));
    expect(cavity.length).toBeGreaterThan(0);
    const region = shellOf(cut.shape, cavity);
    const gap = worstGap(region, shape, 3);
    console.log(`[4b-0] block − offset solid: ${topo.faces.length} faces (${cavity.length} in the cavity), cavity worst |d − 3| = ${gap.worst.toExponential(2)} mm over ${gap.points} points`);
    expect(gap.worst).toBeLessThan(0.05);
  });
});

describe('where an offset fails, and how it is noticed', () => {
  it('inward by more than the smallest radius of curvature: a waist of Ø8 offset in by 5 either gives an invalid shape or a wrong gap — it must be noticed, not drawn', () => {
    const { shape } = lofted([25, 4, 22]);
    const face = kernel.subShape(shape, 'face', sides(shape)[0]!);
    const out = offset(face, -5);
    if (!out.id) {
      console.log(`[4b-0] waist Ø8 −5: refused (${out.why})`);
      return;
    }
    const valid = kernel.isValid(out.id);
    const gap = worstGap(out.id, face, 5);
    console.log(`[4b-0] waist Ø8 −5: valid ${valid}, worst |d − 5| = ${gap.worst.toExponential(2)} mm`);
    // the check that decides: the gap measured is the gap asked for, to 0.05 mm
    expect(valid && gap.worst < 0.05).toBe(false);
  });
});


describe('what the offset solid is made of, and getting it out of the program', () => {
  it('its faces are OCCT offset surfaces (exact, not approximated); converted to B-splines they keep the gap to 0.05 mm, and the STEP of it reads back with the same volume', () => {
    const { shape } = rounded([25, 15, 22], 3);
    const out = offset(shape, 3);
    const kinds = kernel.topology(out.id!).faces.map((f) => f.surface).sort();
    console.log(`[4b-0] the offset solid's faces: ${kinds.join(', ')}`);
    expect(kinds).toContain('offsetsurface');
    const oc = kernel.oc;
    const conv = new oc.BRepBuilderAPI_NurbsConvert(raw.get(out.id!), true);
    const nurbs = raw.put(conv.Shape());
    const nk = kernel.topology(nurbs).faces.map((f) => f.surface).sort();
    console.log(`[4b-0] converted: ${nk.join(', ')}; valid ${kernel.isValid(nurbs)}`);
    expect(nk.every((k) => k === 'bsplinesurface')).toBe(true);
    const gap = worstGap(nurbs, shape, 3);
    console.log(`[4b-0] NURBS conversion: worst |d − 3| = ${gap.worst.toExponential(2)} mm`);
    expect(gap.worst).toBeLessThan(0.05);
    // STEP out and in
    const step = kernel.exportStep(nurbs, 'form');
    const back = kernel.importStep(step);
    const v0 = kernel.massProps(nurbs).volume;
    const v1 = kernel.massProps(back.shape).volume;
    console.log(`[4b-0] STEP round trip: ${v0.toFixed(3)} → ${v1.toFixed(3)}`);
    expect(Math.abs(v1 - v0) / v0).toBeLessThan(1e-4);
    // and the offset surfaces as they are
    const step2 = kernel.exportStep(out.id!, 'form');
    const back2 = kernel.importStep(step2);
    console.log(`[4b-0] STEP of the offset surfaces themselves: volume ${kernel.massProps(back2.shape).volume.toFixed(3)}`);
  });
});

// ---------------------------------------------------------------- knit, fill, thicken, split line

describe('knit: the offset of each face of a region, sewn', () => {
  it('the three faces offset one by one and sewn make the same shell as the region offset in one go: the same area, two free edges (its two ends), no edge shared by more than two faces', () => {
    const { shape } = rounded([25, 15, 22], 3);
    const topo = kernel.topology(shape);
    const form = topo.faces.flatMap((f, i) => (f.surface !== 'plane' ? [i] : []));
    const oc = kernel.oc;
    const sew = new oc.BRepBuilderAPI_Sewing(1e-4, true, true, true, false);
    for (const i of form) {
      const one = offset(kernel.subShape(shape, 'face', i), 3);
      expect(one.why).toBe('');
      sew.Add(raw.get(one.id!));
    }
    sew.Perform(new oc.Message_ProgressRange());
    const knitted = raw.put(sew.SewedShape());
    console.log(`[4b-0] knit: free edges ${sew.NbFreeEdges()}, multiple ${sew.NbMultipleEdges()}, contiguous ${sew.NbContigousEdges()}`);
    expect(sew.NbMultipleEdges()).toBe(0);
    expect(sew.NbFreeEdges()).toBe(2);
    const whole = offset(shellOf(shape, form), 3);
    const a1 = kernel.topology(knitted).faces.reduce((s, f) => s + f.area, 0);
    const a2 = kernel.topology(whole.id!).faces.reduce((s, f) => s + f.area, 0);
    console.log(`[4b-0] knit area ${a1.toFixed(3)} vs region offset ${a2.toFixed(3)}`);
    expect(Math.abs(a1 - a2) / a2).toBeLessThan(1e-4);
  });
});

describe('fill: a patch over a hole in a surface', () => {
  it('a hole of Ø16 in a sphere of R30 filled with its edge and the tangents of the sphere as constraints: the patch is within 0.05 mm of the sphere; with the edge alone it is not', () => {
    const oc = kernel.oc;
    const sphere = raw.put(new oc.BRepPrimAPI_MakeSphere(30).Shape());
    const cyl = raw.put(new oc.BRepPrimAPI_MakeCylinder(new oc.gp_Ax2(new oc.gp_Pnt(0, 0, -50), new oc.gp_Dir(0, 0, 1)), 8, 100).Shape());
    const pierced = kernel.boolean('cut', sphere, cyl);
    const topo = kernel.topology(pierced.shape);
    const sphereFace = topo.faces.findIndex((f) => f.surface === 'sphere');
    expect(sphereFace).toBeGreaterThanOrEqual(0);
    const top = topo.edges.findIndex((e) => e.faces.includes(sphereFace) && e.mid[2] > 0 && e.curve === 'circle');
    expect(top).toBeGreaterThanOrEqual(0);
    const edge = raw.get(kernel.subShape(pierced.shape, 'edge', top));
    const support = raw.get(kernel.subShape(pierced.shape, 'face', sphereFace));
    const deviation = (patch: ShapeId): number => {
      const mesh = kernel.mesh(patch, { deflection: 0.1 } as never);
      let worst = 0;
      for (let i = 0; i < mesh.positions.length; i += 3) worst = Math.max(worst, Math.abs(Math.hypot(mesh.positions[i]!, mesh.positions[i + 1]!, mesh.positions[i + 2]!) - 30));
      return worst;
    };
    const fill = (order: unknown, supported: boolean): { id: ShapeId; g0: number; g1: number } => {
      const f = new oc.BRepFill_Filling(3, 15, 2, false, 1e-5, 1e-4, 0.01, 0.1, 8, 9);
      if (supported) f.Add(oc.TopoDS.Edge(edge), oc.TopoDS.Face(support), order as never, true);
      else f.Add(oc.TopoDS.Edge(edge), order as never, true);
      f.Build();
      expect(f.IsDone()).toBe(true);
      return { id: raw.put(f.Face()), g0: f.G0Error(), g1: supported ? f.G1Error() : 0 };
    };
    const g1 = fill(oc.GeomAbs_Shape.GeomAbs_G1, true);
    const g0 = fill(oc.GeomAbs_Shape.GeomAbs_C0, false);
    const dev1 = deviation(g1.id);
    const dev0 = deviation(g0.id);
    console.log(`[4b-0] fill G1 with support: deviation from the sphere ${dev1.toExponential(2)} mm (reported G0 ${g1.g0.toExponential(1)}, G1 ${g1.g1.toExponential(1)}); edge only: ${dev0.toExponential(2)} mm`);
    expect(dev1).toBeLessThan(0.05);
    expect(dev0).toBeGreaterThan(dev1);
  });
});

describe('thicken: the form block is the offset region thickened', () => {
  it('the side and fillets of the workpiece offset by the gap 3 and thickened by 20 outward: a valid solid whose inner surface is 3 and whose outer surface is 23 from the workpiece', () => {
    const { shape } = rounded([25, 15, 22], 3);
    const topo = kernel.topology(shape);
    const form = topo.faces.flatMap((f, i) => (f.surface !== 'plane' ? [i] : []));
    const gapShell = offset(shellOf(shape, form), 3);
    expect(gapShell.why).toBe('');
    const oc = kernel.oc;
    const mk = new oc.BRepOffsetAPI_MakeThickSolid();
    mk.MakeThickSolidBySimple(raw.get(gapShell.id!), 20);
    mk.Build(new oc.Message_ProgressRange());
    expect(mk.IsDone()).toBe(true);
    let block = raw.put(mk.Shape());
    // the thick solid comes out inside out (a negative volume) when it grows against the faces' normals: turned the right way
    if (kernel.massProps(block).volume < 0) block = raw.put(raw.get(block).Reversed());
    const check = kernel.check(block);
    console.log(`[4b-0] thickened: ${JSON.stringify(check)}`);
    expect(check.valid).toBe(true);
    expect(check.solids).toBe(1);
    const area = kernel.topology(gapShell.id!).faces.reduce((s, f) => s + f.area, 0);
    const volume = kernel.massProps(block).volume;
    console.log(`[4b-0] thickened: volume ${volume.toFixed(1)} for an area of ${area.toFixed(1)} x 20 = ${(area * 20).toFixed(1)}`);
    expect(volume).toBeGreaterThan(area * 20); // a surface that curves away from the side it is thickened toward has more volume than a flat one
    expect(volume).toBeLessThan(area * 20 * 3);
    const mesh = kernel.mesh(block, { deflection: 0.3 } as never);
    let lo = Infinity;
    let hi = 0;
    const n = mesh.positions.length / 3;
    for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 200))) {
      const vertex = raw.put(new oc.BRepBuilderAPI_MakeVertex(new oc.gp_Pnt(mesh.positions[3 * i]!, mesh.positions[3 * i + 1]!, mesh.positions[3 * i + 2]!)).Vertex());
      const d = kernel.distance(vertex, shape).distance;
      kernel.release(vertex);
      lo = Math.min(lo, d);
      hi = Math.max(hi, d);
    }
    console.log(`[4b-0] thickened: distance from the workpiece ${lo.toFixed(4)} to ${hi.toFixed(4)}`);
    expect(Math.abs(lo - 3)).toBeLessThan(0.05);
    expect(Math.abs(hi - 23)).toBeLessThan(0.1);
  });
});

describe('split line: a curve projected onto the freeform surface selects a region', () => {
  it('a rectangle 10 x 20 projected along -x onto a cone frustum splits its side in two: the region has the area worked out by integration', () => {
    const { shape } = lofted([25, 15]);
    const oc = kernel.oc;
    const pts: [number, number, number][] = [[40, -5, 5], [40, 5, 5], [40, 5, 25], [40, -5, 25]];
    const wireMk = new oc.BRepBuilderAPI_MakeWire();
    for (let i = 0; i < 4; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % 4]!;
      wireMk.Add(new oc.BRepBuilderAPI_MakeEdge(new oc.gp_Pnt(a[0], a[1], a[2]), new oc.gp_Pnt(b[0], b[1], b[2])).Edge());
    }
    const side = sides(shape)[0]!;
    const sideShape = raw.get(kernel.subShape(shape, 'face', side));
    const proj = new oc.BRepProj_Projection(wireMk.Wire(), sideShape, new oc.gp_Dir(-1, 0, 0));
    expect(proj.IsDone()).toBe(true);
    // the projection gives a wire on each side of the cone the line of sight crosses (the near and the far); the near one is the wire nearest the rectangle
    const found: { wire: any; distance: number }[] = [];
    for (proj.Init(); proj.More(); proj.Next()) {
      const w = proj.Current();
      const b = kernel.bounds(raw.put(w));
      found.push({ wire: w, distance: Math.abs(40 - (b.min[0] + b.max[0]) / 2) });
    }
    console.log(`[4b-0] split line: the projection has ${found.length} wires, at ${found.map((f) => f.distance.toFixed(1)).join(' and ')} from the rectangle`);
    expect(found.length).toBe(2);
    const near = found.sort((x, y) => x.distance - y.distance)[0]!.wire;
    const split = new oc.BRepFeat_SplitShape(raw.get(shape));
    split.Add(near, oc.TopoDS.Face(sideShape));
    split.Build(new oc.Message_ProgressRange());
    const cut = split.Shape();
    const rawFaces = kernel.topology(raw.put(cut)).faces.length;
    // the region crosses the seam of the cone (at +x), so the cut leaves it in two pieces: unified, it is one face
    // (the edges of the loop are kept, or the region and the rest, which lie on one surface, would be merged again)
    const u = new oc.ShapeUpgrade_UnifySameDomain(cut, true, true, false);
    const ex = new oc.TopExp_Explorer(near, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    for (; ex.More(); ex.Next()) {
      const e = ex.Current();
      const modified = (kernel as unknown as { list(l: unknown): any[] }).list(split.Modified(e));
      for (const m of modified.length > 0 ? modified : [e]) u.KeepShape(m);
    }
    u.Build();
    const out = raw.put(u.Shape());
    const faces = kernel.topology(out).faces;
    console.log(`[4b-0] split line: ${rawFaces} faces cut, ${faces.length} unified, valid ${kernel.isValid(out)}, areas ${faces.map((f) => f.area.toFixed(2)).join(', ')}`);
    expect(kernel.isValid(out)).toBe(true);
    expect(faces.length).toBe(4);
    // by hand: A = integral of sqrt(1 + r'^2) r 2 asin(5 / r) dz over z from 5 to 25, with r = 25 - z / 3
    const r = (z: number) => 25 - z / 3;
    const f = (z: number) => Math.sqrt(1 + 1 / 9) * r(z) * 2 * Math.asin(5 / r(z));
    const N = 2000;
    let sum = 0;
    for (let k = 0; k < N; k++) sum += f(5 + ((k + 0.5) * 20) / N) * (20 / N);
    const region = faces.map((x) => x.area).filter((a) => Math.abs(a - sum) / sum < 2e-3);
    console.log(`[4b-0] split line: the region by hand ${sum.toFixed(3)}`);
    expect(region).toHaveLength(1);
  });
});

describe('cut with a surface: one side of a solid removed along a freeform sheet', () => {
  it('a sheet filled over a square frame (z = 25 at the edges, pulled to 35 in the middle) swept up into a tool: the box minus the tool has the sheet for its top, and with the part that was cut away they make the box', () => {
    const oc = kernel.oc;
    const corners: [number, number, number][] = [[-60, -60, 25], [60, -60, 25], [60, 60, 25], [-60, 60, 25]];
    const filling = new oc.BRepFill_Filling(3, 15, 2, false, 1e-5, 1e-4, 0.01, 0.1, 8, 9);
    for (let i = 0; i < 4; i++) {
      const a = corners[i]!;
      const b = corners[(i + 1) % 4]!;
      filling.Add(new oc.BRepBuilderAPI_MakeEdge(new oc.gp_Pnt(a[0], a[1], a[2]), new oc.gp_Pnt(b[0], b[1], b[2])).Edge(), oc.GeomAbs_Shape.GeomAbs_C0, true);
    }
    filling.Add(new oc.gp_Pnt(0, 0, 35));
    filling.Build();
    expect(filling.IsDone()).toBe(true);
    const sheet = filling.Face();
    const tool = raw.put(new oc.BRepPrimAPI_MakePrism(sheet, new oc.gp_Vec(0, 0, 100), false, true).Shape());
    expect(kernel.solidCount(tool)).toBe(1);
    const box = () => raw.put(new oc.BRepPrimAPI_MakeBox(new oc.gp_Pnt(-50, -50, 0), 100, 100, 60).Shape());
    const lower = kernel.boolean('cut', box(), tool);
    const upper = kernel.boolean('common', box(), tool);
    const vl = kernel.massProps(lower.shape).volume;
    const vu = kernel.massProps(upper.shape).volume;
    console.log(`[4b-0] cut with a surface: lower ${vl.toFixed(1)} + upper ${vu.toFixed(1)} = ${(vl + vu).toFixed(1)} (box 600000)`);
    expect(kernel.isValid(lower.shape)).toBe(true);
    expect(vl + vu).toBeCloseTo(600000, 3);
    // between a flat cut at 25 and at 35
    expect(vl).toBeGreaterThan(100 * 100 * 25);
    expect(vl).toBeLessThan(100 * 100 * 35);
    // the faces of the lower part that are not the box's are the sheet: on the sheet to 1e-4
    const topo = kernel.topology(lower.shape);
    const top = topo.faces.findIndex((f) => f.surface !== 'plane');
    expect(top).toBeGreaterThanOrEqual(0);
    const gap = worstGap(kernel.subShape(lower.shape, 'face', top), raw.put(sheet), 0);
    console.log(`[4b-0] cut with a surface: the new top is within ${gap.worst.toExponential(2)} mm of the sheet`);
    expect(gap.worst).toBeLessThan(1e-3);
  });
});

describe('what it costs', () => {
  it('the offset of the workpiece (5 faces) and of its form region, the thickening and the gap check, in milliseconds', () => {
    const { shape } = rounded([25, 15, 22], 3);
    const topo = kernel.topology(shape);
    const form = topo.faces.flatMap((f, i) => (f.surface !== 'plane' ? [i] : []));
    const time = <T>(f: () => T): [T, number] => {
      const t0 = performance.now();
      const r = f();
      return [r, performance.now() - t0];
    };
    const [region, tSew] = time(() => shellOf(shape, form));
    const [off, tOff] = time(() => offset(region, 3));
    const [, tGap] = time(() => worstGap(off.id!, region, 3, 100));
    const [, tSolid] = time(() => offset(shape, 3));
    console.log(`[4b-0] time: sew ${tSew.toFixed(0)} ms, offset of the region ${tOff.toFixed(0)} ms, offset of the solid ${tSolid.toFixed(0)} ms, gap check (100 points) ${tGap.toFixed(0)} ms`);
    expect(tOff).toBeLessThan(5000);
  });
});
