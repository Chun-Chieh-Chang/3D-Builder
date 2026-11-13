// rollingBall's loop on face 2 of the OCCT round after STEP, each call labelled: which one throws.
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { splineBoss } from '../../tests/phase8/recognize-rolling-ball.kit';
import { sD1, supportOf } from '../../packages/kernel/src/exactRound';
it('trap3', async () => {
  const kernel = await Kernel.load(); const k = kernel as any; const oc = k.oc;
  const p = splineBoss(kernel);
  const occt = kernel.fillet(p.shape, p.edges, 0.8, undefined, undefined, false);
  const back = kernel.importStep(new TextEncoder().encode(kernel.exportStep(occt.shape, 'p'))).shape;
  const faces: any[] = [];
  for (const ex = new oc.TopExp_Explorer(k.get(back), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) faces.push(oc.TopoDS.Face(ex.Current()));
  const t = kernel.topology(back); const sm = kernel.smoothEdges(back, t.edges.map((_, i) => i));
  const supIdx = [...new Set(t.edges.flatMap((e, x) => (sm[x] && e.faces.includes(2) ? e.faces.filter((f) => f !== 2) : [])))];
  console.log('P3 supports', supIdx);
  const face = faces[2], sup = supIdx.map((i) => supportOf(oc, faces[i]));
  const ad = new oc.BRepAdaptor_Surface(face, true);
  const cl = new oc.BRepClass_FaceClassifier(); const q = new oc.gp_Pnt2d(0, 0);
  const u0 = ad.FirstUParameter(), u1 = ad.LastUParameter(), v0 = ad.FirstVParameter(), v1 = ad.LastVParameter();
  const msg = (e: any) => { try { return String(oc.getExceptionMessage(e)); } catch { return String(e); } };
  let n = 0;
  for (let i = 0; i <= 24; i++) for (let j = 1; j < 8; j++) {
    const [u, v] = [u0 + ((u1 - u0) * i) / 24, v0 + ((v1 - v0) * j) / 8];
    let stage = 'classify';
    try {
      q.SetCoord(u, v); cl.Perform(face, q, 1e-9); stage = 'state'; const st = String(cl.State()?.value ?? cl.State());
      if (!/IN/.test(st)) continue;
      stage = 'D1'; const d = sD1(oc, ad, u, v);
      stage = 'dist'; for (const S of sup) S.dist(d.p as any);
      const nn = [d.du[1] * d.dv[2] - d.du[2] * d.dv[1], d.du[2] * d.dv[0] - d.du[0] * d.dv[2], d.du[0] * d.dv[1] - d.du[1] * d.dv[0]]; const l = Math.hypot(...nn);
      for (const sg of [-0.8, 0.8]) { stage = `centre ${sg}`; const c = d.p.map((x: number, m: number) => x + (sg * nn[m]!) / l); sup.forEach((S, si) => { stage = `centre ${sg} sup ${si}`; S.dist(c as any); }); }
    } catch (e) { if (n++ < 10) console.log('P3 THROW', stage, i, j, u.toFixed(3), v.toFixed(3), msg(e)); }
  }
  console.log('P3 done throws', n);
  const { rollingBall, arcSections } = await import('../../packages/kernel/src/roundRecognition');
  const gl = globalThis as any; const stg = (s: string, f: () => any) => { try { return f(); } catch (e) { console.log('P3 STAGE THROW', s, msg(e)); throw e; } };
  try {
    stg('arc', () => arcSections(oc, face));
    const S2 = [stg('supA', () => supportOf(oc, faces[0])), stg('supB', () => supportOf(oc, faces[9]))];
    const ad2 = stg('ad', () => new oc.BRepAdaptor_Surface(face, true));
    stg('orient', () => face.Orientation());
    void gl; void S2; void ad2;
  } catch { /* logged */ }
  for (const [a, b] of [[0, 9], [9, 0]]) {
    try { console.log('P3 RB', a, b, JSON.stringify(rollingBall(oc, face, faces[a], faces[b], 1e-5))); } catch (e) { console.log('P3 RB THROW', a, b, msg(e), String((e as any)?.stack).split('\n').slice(0, 6).join(' | ')); }
  }
  try { console.log('P3 K', JSON.stringify(kernel.rollingBall(back, 2, [0, 9], 1e-5))); } catch (e) { console.log('P3 K THROW', msg(e)); }
}, 600_000);
