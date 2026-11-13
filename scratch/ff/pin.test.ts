import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { sample, __body } from '../../packages/kernel/test/exact-round-fuzz.kit';
// C2.14d: does an undeleted TopoDS_Shape wrapper keep its TShape (and its geometry) alive? N deep copies of an OCCT-rounded body (B-spline rounds);
// W=all: copy, explorer and every face wrapper deleted; W=faces: face wrappers left undeleted; W=one: a single face wrapper left; W=explorer: the explorer left.
it('pin', async () => {
  const kernel: any = await Kernel.load(); const oc = kernel.oc; const H = () => oc.wasmMemory.buffer.byteLength / 2 ** 20;
  const h0 = H(); if (!(h0 > 0)) throw new Error('no heap');
  const s = sample(Number(process.env.SEED ?? 41)); const made = __body(kernel, s);
  const r = kernel.fillet(made.shape, made.edges, s.r); const body = kernel.get(r.shape);
  const W = process.env.W; const N = Number(process.env.N ?? 200); const steps: string[] = [];
  for (let i = 0; i < N; i++) {
    if (W === 'box') { const mb = new oc.BRepPrimAPI_MakeBox(1 + (i % 7), 2, 3); const sh = mb.Shape(); sh.delete(); mb.delete(); if ((i + 1) % 20 === 0) steps.push(H().toFixed(1)); continue; }
    if (W === 'bspl') { const a = new oc.NCollection_Array2_gp_Pnt(1, 40, 1, 3); for (let u = 1; u <= 40; u++) for (let v = 1; v <= 3; v++) { const p = new oc.gp_Pnt(u, v, (u * v) % 5); a.SetValue(u, v, p); p.delete(); } const bs = new oc.GeomAPI_PointsToBSplineSurface(a, 3, 8, oc.GeomAbs_Shape.GeomAbs_C2, 1e-3); const S = bs.Surface(); const mf = new oc.BRepBuilderAPI_MakeFace(S, 1e-7); const sh = mf.Shape(); sh.delete(); mf.delete(); S.delete(); bs.delete(); a.delete(); if ((i + 1) % 20 === 0) steps.push(H().toFixed(1)); continue; }
    if (W === 'copyonly') { const cp = new oc.BRepBuilderAPI_Copy(body, true, false); const sh = cp.Shape(); sh.delete(); cp.delete(); if ((i + 1) % 20 === 0) steps.push(H().toFixed(1)); continue; }
    if (W === 'copynogeom') { const cp = new oc.BRepBuilderAPI_Copy(body, false, false); const sh = cp.Shape(); sh.delete(); cp.delete(); if ((i + 1) % 20 === 0) steps.push(H().toFixed(1)); continue; }
    if (W === 'exploreonly') { const ex = new oc.TopExp_Explorer(body, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); for (; ex.More(); ex.Next()) oc.TopoDS.Face(ex.Current()).delete(); ex.delete(); if ((i + 1) % 20 === 0) steps.push(H().toFixed(1)); continue; }
    const cp = new oc.BRepBuilderAPI_Copy(body, true, false); const sh = cp.Shape();
    const ex = new oc.TopExp_Explorer(sh, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); const fs: any[] = [];
    for (; ex.More(); ex.Next()) fs.push(oc.TopoDS.Face(ex.Current()));
    if (W !== 'faces') fs.forEach((f, k) => { if (!(W === 'one' && k === 0)) f.delete(); });
    if (W !== 'explorer') ex.delete();
    sh.delete(); cp.delete();
    if ((i + 1) % 20 === 0) steps.push(H().toFixed(1));
  }
  const types: string[] = []; const ex2 = new oc.TopExp_Explorer(body, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  for (; ex2.More(); ex2.Next()) { const ad = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(ex2.Current()), false); types.push(String(ad.GetType().value)); ad.delete(); }
  let poles = 0; ex2.Init(body, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  for (; ex2.More(); ex2.Next()) { const ad = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(ex2.Current()), false); if (ad.GetType() === oc.GeomAbs_SurfaceType.GeomAbs_BSplineSurface) poles += ad.NbUPoles() * ad.NbVPoles(); ad.delete(); }
  console.log('PIN', W, JSON.stringify({ h0, steps, faces: types.length, types: types.join(''), bsplinePoles: poles }));
}, 600_000);
