import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { sample, __body } from '../../packages/kernel/test/exact-round-fuzz.kit';
// C2.14d: heap over seeds A..B, MODE occt (body + OCCT round) or exact (body + OCCT round + exact round), fresh heap per run
it('heap2', async () => {
  (globalThis as any).__C214_STOP = process.env.STOP; const kernel = await Kernel.load(); const H = () => (kernel.oc as any).wasmMemory.buffer.byteLength / 2 ** 20;
  const h0 = H(); let n = 0; const per: number[] = [];
  for (let seed = Number(process.env.A); seed <= Number(process.env.B); seed++) {
    const s = sample(seed); let made: any; try { made = __body(kernel, s); } catch { continue; }
    if (!made.edges.length) continue;
    const a = H();
    let o: any; try { o = kernel.fillet(made.shape, made.edges, s.r, undefined, undefined, false); } catch { continue; }
    let e: any; if (process.env.XMODE === 'exact') e = kernel.fillet(made.shape, made.edges, s.r, undefined, undefined, true);
    if (process.env.REL) { kernel.release(o.shape); if (e) kernel.release(e.shape); kernel.release(made.shape); }
    if (e) { const lg = (kernel as any).exactRoundLog.filter((x: any) => ['heap', 'pre', 'checked'].includes(x.outcome)).map((x: any) => x.detail).join(' ; '); const nums = [...lg.matchAll(/([A-Za-z<>|+\-]+[0-9]*)[:<>|]?(\d+)/g)]; let prevH = -1, prevL = ''; const jumps: string[] = []; for (const m of lg.matchAll(/([^\s;]+?)[:<>|](\d+)(?=\s|$)/g)) { const h = +m[2]!; if (prevH >= 0 && h > prevH) jumps.push(prevL + '->' + m[1] + ' +' + (h - prevH)); prevH = h; prevL = m[1]!; } void nums; if (jumps.length) console.log('JUMP', seed, jumps.join(', ')); }
    n++; per.push(seed + ":" + (H() - a).toFixed(1) as any);
  }
  console.log('HEAP2', process.env.XMODE, JSON.stringify({ n, from: h0, to: H(), per }));
}, 170_000);
