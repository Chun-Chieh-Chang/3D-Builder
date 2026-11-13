// Where the edge-by-edge draft's heap goes (AGENTS §3.5: isolate, each case its own fresh heap, N repeats). W =
//   sheet      the spline's wall alone: offset curve, approximation, ruled surface, face (all deleted each time)
//   mv-planes  BOPAlgo_MakerVolume of five planar quadrilaterals (a drafted box's walls and caps, no B-spline)
//   mv-spline  BOPAlgo_MakerVolume of the spline's ruled wall, three planar walls and the two caps (the kernel's case)
import { appendFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Kernel } from '@3db/kernel';

const log = (m: string) => appendFileSync('scratch/ff/c7.log', m + String.fromCharCode(10));

it('c7g', async () => {
  const kernel = await Kernel.load();
  const oc = (kernel as any).oc;
  const heap = () => oc.wasmMemory.buffer.byteLength / 2 ** 20;
  const h0 = heap();
  expect(h0).toBeGreaterThan(0);
  const W = process.env.W!;
  const N = Number(process.env.N ?? 40);
  const t = Math.tan(0.035), H = 10, top = 10.5;
  const pnt = (x: number, y: number, z: number) => new oc.gp_Pnt(x, y, z);
  const del = (...xs: any[]) => { for (const x of xs) try { x.delete(); } catch { /* */ } };
  const quad = (a: number[], b: number[], out: number[]) => {
    // a line from a to b (at z = 0), its wall rising along up − t·out to `top`
    const r = [-t * out[0]!, -t * out[1]!, 1];
    const ps = [pnt(a[0]!, a[1]!, 0), pnt(b[0]!, b[1]!, 0), pnt(b[0]! + r[0]! * top, b[1]! + r[1]! * top, top), pnt(a[0]! + r[0]! * top, a[1]! + r[1]! * top, top)];
    const poly = new oc.BRepBuilderAPI_MakePolygon(ps[0], ps[1], ps[2], ps[3], true);
    const mf = new oc.BRepBuilderAPI_MakeFace(poly.Wire(), true);
    const f = mf.Face();
    del(poly, mf, ...ps);
    return f;
  };
  const cap = (z: number) => {
    const pln = new oc.gp_Pln(pnt(14, 12, z), new oc.gp_Dir(0, 0, 1));
    const mf = new oc.BRepBuilderAPI_MakeFace(pln, -60, 60, -60, 60);
    const f = mf.Face();
    del(pln, mf);
    return f;
  };
  const splineWall = () => {
    const pts = new oc.NCollection_Array1_gp_Pnt(1, 3);
    pts.SetValue(1, pnt(30, 25, 0)); pts.SetValue(2, pnt(14, 32, 0)); pts.SetValue(3, pnt(-2, 25, 0));
    const ip = new oc.GeomAPI_PointsToBSpline(pts, 3, 3, oc.GeomAbs_Shape.GeomAbs_C2, 1e-9);
    const c = ip.Curve();
    const off = new oc.Geom_OffsetCurve(c, -t * top, new oc.gp_Dir(0, 0, 1), false);
    const v = new oc.gp_Vec(0, 0, top);
    off.Translate(v);
    const ap = new oc.GeomConvert_ApproxCurve(off, 1e-9, oc.GeomAbs_Shape.GeomAbs_C1, 200, 14);
    const far = ap.Curve();
    const surf = oc.GeomFill.Surface(c, far);
    const mf = new oc.BRepBuilderAPI_MakeFace(surf, 1e-7);
    const f = mf.Face();
    del(pts, ip, c, off, v, ap, far, surf, mf);
    return f;
  };
  const steps: string[] = [];
  for (let i = 1; i <= N; i++) {
    if (W === 'sheet') {
      del(splineWall());
    } else {
      const faces = W === 'mv-planes'
        ? [quad([0, 0], [28, 0], [0, -1]), quad([28, 0], [28, 25], [1, 0]), quad([28, 25], [0, 25], [0, 1]), quad([0, 25], [0, 0], [-1, 0]), cap(0), cap(H)]
        : [quad([-2, 0], [30, 0], [0, -1]), quad([28.72, -2], [28.72, 27], [1, 0]), splineWall(), quad([0, 27], [0, -2], [-1, 0]), cap(0), cap(H)];
      const mv = new oc.BOPAlgo_MakerVolume();
      for (const f of faces) mv.AddArgument(f);
      mv.SetIntersect(true);
      const pr = new oc.Message_ProgressRange();
      mv.Perform(pr);
      const sh = mv.Shape();
      del(sh, pr, mv, ...faces);
    }
    if (i % (N / 8) === 0) steps.push(heap().toFixed(1));
  }
  log(`isolate ${W} N=${N}: ${h0.toFixed(1)} -> ${steps.join(' ')} MiB`);
}, 900_000);
