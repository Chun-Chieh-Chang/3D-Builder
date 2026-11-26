/**
 * Window-rounds fuzz seed 54 (2026-11-26): which Kernel methods grow the heap during recognition. Every Kernel method is wrapped; a top-level call's
 * heap growth (wasmMemory, AGENTS §3.1) and time are summed by method. SEEDS, CUT=off|on.
 */
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, KernelError } from '@3db/kernel';
import { recognizeStep } from '../../tests/phase8/recognize-rolling-ball.kit';
import { cupWithRoundedWindows, sample } from '../../tests/phase8/recognize-window-rounds.kit';

const SEED = Number(process.env.SEEDS ?? '54');
const CUT = process.env.CUT ?? 'on';
mkdirSync('spikes/0265-fillet-c1-joints/data', { recursive: true });
const OUT = `spikes/0265-fillet-c1-joints/data/w54heap-${CUT}-${SEED}.log`;

it('heap by kernel method', async () => {
  const kernel = await Kernel.load();
  const solver = await PlaneGcsSolver.create();
  const k = kernel as any;
  const heap = () => (k.oc.wasmMemory.buffer.byteLength as number) / 2 ** 20;
  if (CUT === 'off') k.cutAtJoints = () => null;
  let shape = null;
  for (let attempt = 0; attempt < 5 && !shape; attempt++) {
    const { cup, R } = sample(SEED, attempt);
    try { shape = cupWithRoundedWindows(kernel, cup, R); } catch (e) { if (!(e instanceof KernelError)) throw e; }
  }
  if (!shape) return;
  const sum = new Map<string, { calls: number; mib: number; ms: number }>();
  const seq: string[] = [];
  let depth = 0;
  const proto = Kernel.prototype as any;
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === 'constructor') continue;
    const d = Object.getOwnPropertyDescriptor(proto, name);
    if (!d || typeof d.value !== 'function') continue;
    const f = d.value;
    k[name] = function (...a: any[]) {
      if (depth > 0) return f.apply(this, a);
      depth++;
      const h0 = heap(), t0 = Date.now();
      try { return f.apply(this, a); } finally {
        depth--;
        const dh = heap() - h0, s = sum.get(name) ?? { calls: 0, mib: 0, ms: 0 };
        s.calls++; s.mib += dh; s.ms += Date.now() - t0; sum.set(name, s);
        if (dh > 0) { seq.push(`${name} +${dh.toFixed(1)} -> ${heap().toFixed(1)}`); appendFileSync(OUT, `${name} +${dh.toFixed(1)} -> ${heap().toFixed(1)}\n`); }
      }
    };
  }
  const h0 = heap();
  let outcome = '';
  try { await recognizeStep(kernel, solver, shape); outcome = 'rebuilt'; } catch (e: any) { outcome = `${e?.name}: ${String(e?.message).slice(0, 80)}`; }
  const rows = [...sum].sort((a, b) => b[1].mib - a[1].mib || b[1].ms - a[1].ms).map(([n, s]) => `${n}\t${s.calls}\t+${s.mib.toFixed(1)} MiB\t${s.ms} ms`);
  appendFileSync(OUT, `\n${outcome}\nheap ${h0.toFixed(1)} -> ${heap().toFixed(1)}\n${rows.join('\n')}\n`);
}, 1_800_000);
