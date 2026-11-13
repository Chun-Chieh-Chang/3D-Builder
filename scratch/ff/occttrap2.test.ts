// Which step of rollingBall throws Standard_OutOfRange on OCCT's round of the spline boss after a STEP round trip.
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { splineBoss } from '../../tests/phase8/recognize-rolling-ball.kit';
import { arcSections } from '../../packages/kernel/src/roundRecognition';
import { sD1, supportOf } from '../../packages/kernel/src/exactRound';
it('trap2', async () => {
  const kernel = await Kernel.load(); const k = kernel as any; const oc = k.oc;
  const p = splineBoss(kernel);
  const occt = kernel.fillet(p.shape, p.edges, Number(process.env.R ?? 0.8), undefined, undefined, false);
  const back = kernel.importStep(new TextEncoder().encode(kernel.exportStep(occt.shape, 'p'))).shape;
  const t = kernel.topology(back);
  console.log('P2 faces', t.faces.map((f, i) => `${i}:${f.surface}`).join(' '));
  const faces: any[] = [];
  for (const ex = new oc.TopExp_Explorer(k.get(back), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) faces.push(oc.TopoDS.Face(ex.Current()));
  const msg = (e: any) => { try { return String(oc.getExceptionMessage(e)); } catch { return String(e); } };
  const step = (name: string, f: () => any) => { try { const r = f(); console.log('P2 ok', name, JSON.stringify(r)?.slice(0, 200)); return r; } catch (e) { console.log('P2 THROW', name, msg(e)); return undefined; } };
  for (const fi of [2, 9]) {
    const face = faces[fi];
    step(`arc ${fi}`, () => arcSections(oc, face));
    const ad = new oc.BRepAdaptor_Surface(face, true);
    console.log('P2 range', fi, ad.FirstUParameter(), ad.LastUParameter(), ad.FirstVParameter(), ad.LastVParameter());
    step(`D1 ${fi}`, () => sD1(oc, ad, (ad.FirstUParameter() + ad.LastUParameter()) / 2, (ad.FirstVParameter() + ad.LastVParameter()) / 2).p);
    step(`support ${fi}`, () => { const S = supportOf(oc, face); const d = S.dist([10, 25, 0.3]); S.release(); return d; });
    const cl = new oc.BRepClass_FaceClassifier(); const q = new oc.gp_Pnt2d(0, 0);
    for (const [u, v] of [[0.5, 0.5], [0, 0], [1, 1]]) step(`classify ${fi} ${u},${v}`, () => { q.SetCoord(ad.FirstUParameter() + (ad.LastUParameter() - ad.FirstUParameter()) * u, ad.FirstVParameter() + (ad.LastVParameter() - ad.FirstVParameter()) * v); cl.Perform(face, q, 1e-9); return String(cl.State()?.value ?? cl.State()); });
    cl.delete(); q.delete(); ad.delete();
  }
}, 600_000);
