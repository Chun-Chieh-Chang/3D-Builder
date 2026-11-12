import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
it('cost of the measures', async () => {
  const kernel = await Kernel.load();
  const A = kernel.importStep(new Uint8Array(readFileSync(process.env.A!))).shape;
  const B = kernel.importStep(new Uint8Array(readFileSync(process.env.B!))).shape;
  const out: any = {};
  const time = (n: string, f: () => any) => { const t = performance.now(); const v = f(); out[n] = { ms: Math.round(performance.now() - t), v }; };
  time('cells', () => kernel.differenceVolumes(A, B));
  time('massPropsA', () => kernel.massProps(A).volume);
  time('area1e-9', () => kernel.surfaceArea(A, 1e-9));
  time('area1e-8', () => kernel.surfaceArea(A, 1e-8));
  time('area1e-7', () => kernel.surfaceArea(A, 1e-7));
  /*time('cutAB', () => { const r = kernel.boolean('cut', A, B); const v = kernel.massProps(r.shape).volume; kernel.release(r.shape); return v; });
  time('cutBA', () => { const r = kernel.boolean('cut', B, A); const v = kernel.massProps(r.shape).volume; kernel.release(r.shape); return v; });
  time('common', () => kernel.common(A, B, 0).volume);
  */writeFileSync(process.env.OUT!, JSON.stringify(out));
}, 900000);
