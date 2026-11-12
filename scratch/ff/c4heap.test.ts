// C4-1 heap: Kernel.analyticFace called N times in a fresh heap (W = hit: a B-spline cylinder; miss: a spline wall; control: the same adaptor work with EvalD1, known to keep heap).
import { appendFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { XY } from '../../tests/phase8/recognize-rolling-ball.kit';
const log = (m: string) => { appendFileSync('scratch/ff/c4heap.log', m + String.fromCharCode(10)); };
it('c4heap', async () => {
  const kernel = await Kernel.load(); const oc: any = kernel.oc;
  const heap = () => oc.wasmMemory.buffer.byteLength / 2 ** 20; const h0 = heap(); expect(h0).toBeGreaterThan(0);
  const W = process.env.W ?? 'hit'; const N = +(process.env.N ?? 20000);
  const disc = kernel.toBSpline(kernel.extrude(XY as never, [{ outer: [{ kind: 'circle', c: [0, 0], r: 15, source: 'c' }], holes: [] }] as never, [0, 0, 8]).shape);
  const L = (a: number[], b: number[], s: string) => ({ kind: 'line', a, b, source: s });
  const wall = kernel.extrude(XY as never, [{ outer: [L([0, 0], [30, 0], 'a'), L([30, 0], [30, 20], 'b'), { kind: 'spline', points: [[30, 20], [14, 28], [0, 20]], source: 'c' }, L([0, 20], [0, 0], 'd')], holes: [] }] as never, [0, 0, 8]).shape;
  const [shape, face] = W === 'miss' ? [wall, kernel.topology(wall).faces.findIndex((f) => !f.geometry)] : [disc, kernel.topology(disc).faces.findIndex((f) => Math.abs(f.center[2] - 4) < 1e-3)];
  const ex = new oc.TopExp_Explorer((kernel as any).get(shape), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  const ctl = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(ex.Current()), true);
  const steps: string[] = []; let hits = 0;
  for (let i = 1; i <= N; i++) {
    if (W === 'control') { for (let k = 0; k < 169; k++) ctl.EvalD1(0.1, 0.1); }
    else if (kernel.analyticFace(shape, face, 1e-6)) hits++;
    if (i % (N / 10) === 0) steps.push(heap().toFixed(1));
  }
  log(`${W} N=${N} hits ${hits}: ${h0.toFixed(1)} -> ${steps.join(' ')} MiB`);
}, 900_000);
