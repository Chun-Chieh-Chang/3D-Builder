import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
// does GeomAPI_ProjectPointOnSurf keep heap on a B-spline of many poles? (each call constructed and deleted)
it('proj', async () => {
  const kernel = await Kernel.load(); const oc: any = (kernel as any).oc; const H = () => +(oc.wasmMemory.buffer.byteLength / 2 ** 20).toFixed(1);
  const nu = Number(process.env.NU ?? 180);
  const arr = new oc.NCollection_Array2_gp_Pnt(1, nu, 1, 3); const w = new oc.NCollection_Array2_double(1, nu, 1, 3);
  for (let i = 1; i <= nu; i++) for (let j = 1; j <= 3; j++) { arr.SetValue(i, j, new oc.gp_Pnt(i * 0.1, Math.sin(i * 0.1) + j, j * j * 0.1)); w.SetValue(i, j, j === 2 ? 0.8 : 1); }
  const ku = nu - 5 + 1; const UK = new oc.NCollection_Array1_double(1, ku), UM = new oc.NCollection_Array1_int(1, ku); for (let i = 1; i <= ku; i++) { UK.SetValue(i, i); UM.SetValue(i, i === 1 || i === ku ? 6 : 1); }
  const VK = new oc.NCollection_Array1_double(1, 2), VM = new oc.NCollection_Array1_int(1, 2); VK.SetValue(1, 0); VK.SetValue(2, 1); VM.SetValue(1, 3); VM.SetValue(2, 3);
  const S = new oc.Geom_BSplineSurface(arr, w, UK, VK, UM, VM, 5, 2, false, false);
  const FF = new oc.BRepBuilderAPI_MakeFace(S, 1e-7).Face(); const FA = new oc.BRepAdaptor_Surface(FF, false);
  const out: any[] = [H()];
  for (const mode of (process.env.ORDER ?? 'ctor-delete,reuse-Init').split(',')) {
    const pr0 = mode === 'reuse-Init' ? new oc.GeomAPI_ProjectPointOnSurf() : null;
    if (pr0) pr0.Init(S, 1, ku, 0, 1);
    for (let k = 0; k < 100; k++) {
      const g = new oc.gp_Pnt(1 + (k % 50) * 0.2, 1.5, 0.3);
      if (mode === 'adaptor-grid') { const fb = new oc.BRepAdaptor_Surface(FF, true); for (let q = 0; q < 2401; q++) { const P = fb.Value(1 + (q % 49) * 0.1, (q / 49 | 0) / 49); P.delete(); } fb.delete(); } else if (mode === 'adaptor-only') { const fb = new oc.BRepAdaptor_Surface(FF, true); fb.delete(); } else if (mode === 'value-only') { for (let q = 0; q < 2401; q++) { const P = FA.Value(1 + (q % 49) * 0.1, (q / 49 | 0) / 49); P.delete(); } } else if (mode === 'init-delete') { const p2 = new oc.GeomAPI_ProjectPointOnSurf(); p2.Init(S, 1, ku, 0, 1, oc.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad); p2.Perform(g); p2.LowerDistance(); p2.delete(); } else if (mode === 'adaptor') { const ad = new oc.GeomAdaptor_Surface(S); const e = new oc.Extrema_ExtPS(g, ad, 1e-9, 1e-9, oc.Extrema_ExtFlag.Extrema_ExtFlag_MIN, oc.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad); e.delete(); ad.delete(); } else if (pr0) { pr0.Perform(g); pr0.LowerDistance(); } else { const pr = new oc.GeomAPI_ProjectPointOnSurf(g, S); pr.LowerDistance(); pr.delete(); }
      g.delete();
    }
    out.push(mode, H());
  }
  console.log('PROJ', nu, JSON.stringify(out));
}, 170_000);
