// Heap of surfaceDeviation, fresh heap per W: W=dev (both ways on an exact vs OCCT round pair, N times) | W=step (control: STEP round trip, which grows).
import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { __body, sample } from '../../packages/kernel/test/exact-round-fuzz.kit';
const log = (m: string) => appendFileSync('scratch/ff/sdevheap.log', m + String.fromCharCode(10));
it('heap', async () => {
  const kernel = await Kernel.load(); const k = kernel as any;
  const heap = () => +((k.oc.wasmMemory.buffer.byteLength) / 2 ** 20).toFixed(1);
  const input = sample(41); const { shape, edges } = __body(kernel, input);
  const exact = kernel.fillet(shape, edges, input.r, undefined, undefined, true).shape;
  const occt = kernel.fillet(shape, edges, input.r, undefined, undefined, false).shape;
  kernel.surfaceDeviation(exact, occt);
  const W = process.env.W ?? 'dev', N = Number(process.env.N ?? 200);
  const h0 = heap(); const t0 = performance.now(); const steps: number[] = [];
  for (let i = 0; i < N; i++) {
    if (W === 'dev') { kernel.surfaceDeviation(exact, occt); kernel.surfaceDeviation(occt, exact); }
    else if (W === 'mesh') { kernel.mesh(exact, { tolerance: 0.02 }); kernel.mesh(occt, { tolerance: 0.02 }); }
    else if (W === 'proj') { const oc = k.oc; const { ShapeIndex, Arena } = await import('../../packages/kernel/src/occt'); const ar = new Arena(); for (const e of ShapeIndex.of(oc, k.get(occt), oc.TopAbs_ShapeEnum.TopAbs_EDGE, ar).keys) { const ed = oc.TopoDS.Edge(e); if (oc.BRep_Tool.Degenerated(ed)) { ed.delete(); continue; } const ca = new oc.BRepAdaptor_Curve(ed); const got = oc.BRep_Tool.Curve(ed, 0, 0); const c = got?.returnValue ?? got; const pr = new oc.GeomAPI_ProjectPointOnCurve(); pr.Init(c, ca.FirstParameter(), ca.LastParameter()); pr.delete(); c.delete(); ca.delete(); ed.delete(); } ar.dispose(); }
    else kernel.release(kernel.importStep(new TextEncoder().encode(kernel.exportStep(exact, 'p'))).shape);
    if (i % 20 === 19) steps.push(heap());
  }
  log(`W=${W} N=${N} ${h0} -> ${heap()} MiB in ${((performance.now() - t0) / 1000).toFixed(1)} s | ${steps.join(' ')}`);
}, 1_800_000);
