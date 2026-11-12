// Why a blind hole with a drill point compares as different from its own STEP copy: per face of A, the deviation integral and max.
import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { surfaceDeviation } from '../../packages/kernel/src/surfaceDeviation';
const log = (m: string) => appendFileSync('scratch/ff/drill.log', m + String.fromCharCode(10));
it('drill', async () => {
  const kernel = await Kernel.load(); const k = kernel as any; const oc = k.oc;
  const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
  const XZ = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 0, 1], normal: [0, -1, 0] };
  const poly = (pts: number[][]) => ({ outer: pts.map((a, i) => ({ kind: 'line', a, b: pts[(i + 1) % pts.length], source: 'e' + i })), holes: [] });
  const plate = kernel.extrude(XY as any, [poly([[-30, -20], [30, -20], [30, 20], [-30, 20]])] as any, [0, 0, 10]).shape;
  const point = 3 / Math.tan((59 * Math.PI) / 180);
  const tool = kernel.revolve(XZ as any, [poly([[0, 11], [3, 11], [3, 6], [0, 6 - point]])] as any, { origin: [0, 0, 0], dir: [0, 0, 1] } as any, 2 * Math.PI).shape;
  const a = kernel.boolean('cut', plate, tool).shape;
  const b = kernel.importStep(new TextEncoder().encode(kernel.exportStep(a, 'p'))).shape;
  for (const [x, y, n] of [[a, b, 'a->b'], [b, a, 'b->a']] as const) {
    const whole = kernel.surfaceDeviation(x, y);
    log(`${n} whole integral ${whole.integral.toExponential(3)} max ${whole.max.toExponential(3)}`);
    const faces = (s: any) => { const out: any[] = []; for (const ex = new oc.TopExp_Explorer(k.get(s), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) out.push(oc.TopoDS.Face(ex.Current())); return out; };
    const fx = faces(x), fy = faces(y);
    const tol = 0.036;
    fx.forEach((f, i) => {
      const ad = new oc.BRepAdaptor_Surface(f, true);
      const d = surfaceDeviation(oc, [f], fy, tol);
      log(`  face ${i} type ${ad.GetType().value ?? ad.GetType()} integral ${d.integral.toExponential(3)} max ${d.max.toExponential(3)} area ${d.area.toFixed(3)}`);
      ad.delete();
    });
  }
}, 600_000);
