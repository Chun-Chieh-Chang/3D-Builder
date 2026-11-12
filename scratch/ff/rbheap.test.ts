// Heap per stage of rolling-ball recognition, each W on a fresh heap, N times on one sample (SEED): which part grows it.
// W = fillet (exact round of the boss) | ball (rollingBall on a made round) | sharp (sharpEdge) | dist (distancesToEdge of the sharp points)
//   | classify (BRepClass_FaceClassifier Perform alone) | recognize (whole recognition through STEP) | step (export+import only)
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { sample, splineBoss, recognizeStep } from '../../tests/phase8/recognize-rolling-ball.kit';
it('heap', async () => {
  const kernel = await Kernel.load(); const solver = await PlaneGcsSolver.create();
  const heap = () => +((kernel.oc as any).wasmMemory.buffer.byteLength / 2 ** 20).toFixed(1);
  const W = process.env.W ?? 'ball', N = Number(process.env.N ?? 40);
  let seed = Number(process.env.SEED ?? 1), s: ReturnType<typeof sample>, m: ReturnType<typeof splineBoss>, made: any;
  // the first seed from SEED whose round came out exact
  for (;; seed++) {
    s = sample(seed); m = splineBoss(kernel, s.top, s.h);
    try { made = kernel.fillet(m.shape, m.edges, s.radius, undefined, undefined, true); } catch { continue; }
    if (((kernel as any).exactRoundLog as any[]).every((x) => x.outcome === 'exact')) break;
  }
  process.env.SEED = String(seed);
  const t = kernel.topology(made.shape); const sm = kernel.smoothEdges(made.shape, t.edges.map((_, i) => i));
  const round = t.faces.findIndex((f) => f.surface === 'bsplinesurface');
  const sup = [...new Set(t.edges.flatMap((e, k) => (sm[k] && e.faces.includes(round) ? e.faces.filter((q) => q !== round) : [])))] as [number, number];
  const pts = kernel.sharpEdge(made.shape, round, sup)!.points;
  const h0 = heap(); const steps: number[] = [];
  for (let i = 0; i < N; i++) {
    if (W === 'fillet') kernel.release(kernel.fillet(m.shape, m.edges, s.radius, undefined, undefined, true).shape);
    else if (W === 'ball') kernel.rollingBall(made.shape, round, sup, 1e-5);
    else if (W === 'sharp') kernel.sharpEdge(made.shape, round, sup);
    else if (W === 'dist') m.edges.forEach((e) => kernel.distancesToEdge(m.shape, e, pts));
    else if (W === 'support') { const k = kernel as any; const oc = k.oc; const { supportOf } = await import('../../packages/kernel/src/exactRound'); const faces: any[] = []; for (const ex = new oc.TopExp_Explorer(k.get(made.shape), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) faces.push(oc.TopoDS.Face(ex.Current())); for (const q of sup) { const S = supportOf(oc, faces[q]); for (let z = 0; z < 175; z++) S.dist([z / 10, 25, 0.3]); S.release(); } }
    else if (W === 'classify2') { const k = kernel as any; const oc = k.oc; const faces: any[] = []; for (const ex = new oc.TopExp_Explorer(k.get(made.shape), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) faces.push(oc.TopoDS.Face(ex.Current())); const cl = new oc.BRepClass_FaceClassifier(); const p = new oc.gp_Pnt2d(0, 0); const ad = new oc.BRepAdaptor_Surface(faces[round], true); if (i === 0) console.log('box', ad.FirstUParameter(), ad.LastUParameter(), ad.FirstVParameter(), ad.LastVParameter()); for (let q = 0; q < 175; q++) { p.SetCoord(5 + q / 10, 0.5); try { cl.Perform(faces[round], p, 1e-9); } catch (e) { if (i === 0) console.log('THROW at', 5 + q / 10, (kernel as any).oc.getExceptionMessage ? (kernel as any).oc.getExceptionMessage(e) : String(e)); } } cl.delete(); p.delete(); ad.delete(); }
    else if (W === 'classify') { const k = kernel as any; const oc = k.oc; const f = oc.TopoDS.Face(k.subShapeOf ? null : null); void f; const cl = new oc.BRepClass_FaceClassifier(); const p = new oc.gp_Pnt2d(0, 0); const faces: any[] = []; for (const ex = new oc.TopExp_Explorer(k.get(made.shape), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) faces.push(oc.TopoDS.Face(ex.Current())); for (let q = 0; q < 600; q++) { p.SetCoord(5 + q / 30, 0.5); cl.Perform(faces[round], p, 1e-9); } cl.delete(); p.delete(); }
    else if (W === 'recognize') await recognizeStep(kernel, solver, made.shape);
    else if (W === 'plain') await recognizeStep(kernel, solver, m.shape);
    else if (W === 'section') kernel.sectionCurves(made.shape, { ...(await import('../../tests/phase8/recognize-rolling-ball.kit')).XY, origin: [0, 0, 3] } as any, { u0: -60, u1: 60, v0: -60, v1: 60 });
    else if (W === 'diff') { (globalThis as any).__other ??= kernel.importStep(new TextEncoder().encode(kernel.exportStep(kernel.fillet(m.shape, m.edges, s.radius, undefined, undefined, true).shape, 'p'))).shape; kernel.differenceVolumes((globalThis as any).__other, made.shape); }
    else if (W === 'area') kernel.surfaceArea(made.shape);
    else if (W === 'mass') kernel.massProps(made.shape);
    else if (W === 'step') kernel.release(kernel.importStep(new TextEncoder().encode(kernel.exportStep(made.shape, 'p'))).shape);
    steps.push(heap());
  }
  console.log(`RBHEAP W=${W} N=${N} seed=${process.env.SEED ?? 1} ${h0} -> ${heap()} | ${steps.join(' ')}`);
}, 1_200_000);
