import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
// C2.14d: GeomAPI_ProjectPointOnCurve onto a B-spline curve of NP poles, N times, fresh heap. W=del|nodel|adaptor|value
it('projcurve', async () => {
  const k: any = await Kernel.load(); const oc = k.oc; const H = () => oc.wasmMemory.buffer.byteLength / 2 ** 20;
  const h0 = H(); if (!(h0 > 0)) throw new Error('no heap');
  const NP = Number(process.env.NP ?? 200), N = Number(process.env.N ?? 2000);
  const a = new oc.NCollection_Array1_gp_Pnt(1, NP);
  for (let i = 0; i < NP; i++) a.SetValue(i + 1, new oc.gp_Pnt(i, Math.sin(i / 7) * 5, Math.cos(i / 11) * 3));
  const K = new oc.NCollection_Array1_double(1, NP - 4), M = new oc.NCollection_Array1_int(1, NP - 4);
  for (let i = 0; i < NP - 4; i++) { K.SetValue(i + 1, i); M.SetValue(i + 1, i === 0 || i === NP - 5 ? 6 : 1); }
  const C = new oc.Geom_BSplineCurve(a, K, M, 5, false);
  const W = process.env.W; const out: any[] = [W, NP, N, h0];
  for (let i = 0; i < N; i++) {
    const P = new oc.gp_Pnt(i % NP, 1, 0.5);
    if (W === 'del') { const pr = new oc.GeomAPI_ProjectPointOnCurve(P, C); pr.LowerDistance(); pr.delete(); }
    if (W === 'nodel') { const pr = new oc.GeomAPI_ProjectPointOnCurve(P, C); pr.LowerDistance(); }
    if (W === 'adaptor') { const g = new oc.GeomAdaptor_Curve(C); g.FirstParameter(); }
    if (W === 'value') { const g = C.Value(i % (NP - 5)); g.delete(); }
    P.delete();
  }
  out.push(H()); console.log('PROJC', JSON.stringify(out));
}, 600_000);
