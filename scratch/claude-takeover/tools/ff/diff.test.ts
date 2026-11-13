import { readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
it('diff', async () => {
  const kernel = await Kernel.load();
  const a = kernel.importStep(new Uint8Array(readFileSync(process.env.A!))).shape;
  const b = kernel.importStep(new Uint8Array(readFileSync(process.env.B!))).shape;
  const out: any = { va: kernel.massProps(a).volume, vb: kernel.massProps(b).volume, aa: kernel.massProps(a).area, ab: kernel.massProps(b).area, fa: kernel.topology(a).faces.length, fb: kernel.topology(b).faces.length };
  for (const [name, x, y] of [['a-b', a, b], ['b-a', b, a]] as const) {
    const r = kernel.boolean('cut', x, y);
    const sh = r.shape;
    const t = kernel.topology(sh);
    const pieces = kernel.splitSolids(r).sort((p, q) => kernel.massProps(q.shape).volume - kernel.massProps(p.shape).volume);
    out[name] = { n: pieces.length, volume: kernel.massProps(sh).volume, solids: kernel.solidCount(sh), pieces: pieces.slice(0, 25).map((p: any) => { const id = p.shape; const bb = kernel.bounds(id); return { v: +kernel.massProps(id).volume.toExponential(3), min: bb.min.map((v: number) => +v.toFixed(3)), max: bb.max.map((v: number) => +v.toFixed(3)) }; }) };
  }
  writeFileSync(process.env.OUT!, JSON.stringify(out, null, 1));
}, 600000);
