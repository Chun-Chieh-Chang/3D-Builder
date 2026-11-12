import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
// C2.14d: do the adaptors bind D1/D2 with output arguments, and do they agree with EvalD1/EvalD2?
it('dprobe', async () => {
  const k: any = await Kernel.load(); const oc = k.oc;
  const S = new oc.Geom_ConicalSurface(new oc.gp_Ax3(), 0.1, 5);
  const C = new oc.Geom_Circle(new oc.gp_Ax2(), 3);
  const P = new oc.gp_Pnt(), A = new oc.gp_Vec(), B = new oc.gp_Vec(), Cc = new oc.gp_Vec(), D = new oc.gp_Vec(), E = new oc.gp_Vec();
  const x = (p: any) => [p.X(), p.Y(), p.Z()];
  const out: any = {};
  for (const [name, ad] of [['GAS', new oc.GeomAdaptor_Surface(S)]] as const) {
    ad.D1(0.3, 0.2, P, A, B); const e = ad.EvalD1(0.3, 0.2); out[name + 'D1'] = [x(P), x(A), x(B), x(e.Point), x(e.D1U), x(e.D1V)];
    ad.D2(0.3, 0.2, P, A, B, Cc, D, E); const f = ad.EvalD2(0.3, 0.2); out[name + 'D2'] = [x(Cc), x(D), x(E), x(f.D2U), x(f.D2V), x(f.D2UV)];
  }
  const ga = new oc.GeomAdaptor_Curve(C);
  ga.D1(0.4, P, A); const g = ga.EvalD1(0.4); out.GACD1 = [x(P), x(A), x(g.Point), x(g.D1)];
  ga.D2(0.4, P, A, B); const h = ga.EvalD2(0.4); out.GACD2 = [x(B), x(h.D2)];
  const box = new oc.BRepPrimAPI_MakeBox(1, 2, 3).Shape();
  const ex = new oc.TopExp_Explorer(box, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  const bc = new oc.BRepAdaptor_Curve(oc.TopoDS.Edge(ex.Current())); bc.D1(0.5, P, A); out.BRCD1 = [x(P), x(A)]; bc.D2(0.5, P, A, B); out.BRCD2 = x(B);
  const fx = new oc.TopExp_Explorer(box, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  const bs = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(fx.Current()), true); bs.D2(0.5, 0.5, P, A, B, Cc, D, E); out.BRSD2 = [x(P), x(A), x(B)];
  console.log('DPROBE', JSON.stringify(out));
}, 170_000);
