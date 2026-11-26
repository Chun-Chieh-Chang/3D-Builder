/**
 * Window-rounds fuzz seeds 54 and 55 (ADR 0265 follow-up, 2026-11-26): recognition stopped by the 512 MiB job budget after the cut was added, where at
 * 464366fa both went through recognition (refused). Every fillet the job asks for is logged — how the cut went (`lastFilletCut`), time, heap before and
 * after — with the cut as built and with it off (`cutAtJoints` returning null, the path before ADR 0265). SEEDS, CUT=off|on.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { it } from 'vitest';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, KernelError } from '@3db/kernel';
import { BudgetError, RECOGNIZE_LIMITS, RecognizeError, Regenerator } from '@3db/regen';
import { recognizeStep } from '../../tests/phase8/recognize-rolling-ball.kit';
import { cupWithRoundedWindows, sample } from '../../tests/phase8/recognize-window-rounds.kit';

const SEEDS = (process.env.SEEDS ?? '54').split(',').map(Number);
const CUT = process.env.CUT ?? 'on';
const OUT = `spikes/0265-fillet-c1-joints/data/w54-${CUT}${process.env.NOLIMIT ? '-nolimit' : ''}-${SEEDS.join('_')}.log`;
mkdirSync('spikes/0265-fillet-c1-joints/data', { recursive: true });
const log = (s: string) => appendFileSync(OUT, s + '\n');

it('logs every fillet of the job', async () => {
  if (process.env.NOLIMIT) Object.assign(RECOGNIZE_LIMITS, { ms: 3_600_000, heapGrowth: 3500 * 2 ** 20 });
  const kernel = await Kernel.load();
  const solver = await PlaneGcsSolver.create();
  const k = kernel as any;
  const heap = () => (k.oc.wasmMemory.buffer.byteLength as number) / 2 ** 20;
  if (CUT === 'off') k.cutAtJoints = () => null;
  let phase = 'make';
  const rb = (Regenerator.prototype as any).rebuild;
  (Regenerator.prototype as any).rebuild = function (doc: any, o: any = {}) { const h0 = heap(), t0 = Date.now(); try { return rb.call(this, doc, o); } finally { log(`${phase} REBUILD until=${o.until ?? doc.features.length}/${doc.features.length} ${Date.now() - t0}ms heap ${h0.toFixed(1)}->${heap().toFixed(1)}`); } };
  const fillet = k.fillet.bind(kernel);
  let n = 0;
  k.fillet = (...a: any[]) => {
    const h0 = heap(), t0 = Date.now(), i = n++;
    try {
      const r = fillet(...a);
      log(`${phase} #${i} edges=${a[1].length} r=${a[2]} ok cut=${k.lastFilletCut} merge=${k.lastFilletMerge} ${Date.now() - t0}ms heap ${h0.toFixed(1)}->${heap().toFixed(1)}`);
      return r;
    } catch (e: any) {
      log(`${phase} #${i} edges=${a[1].length} r=${a[2]} FAIL cut=${k.lastFilletCut} ${Date.now() - t0}ms heap ${h0.toFixed(1)}->${heap().toFixed(1)} ${String(e?.message).slice(0, 60)}`);
      throw e;
    }
  };
  for (const seed of SEEDS) {
    phase = 'make';
    let shape = null;
    for (let attempt = 0; attempt < 5 && !shape; attempt++) {
      const { cup, R } = sample(seed, attempt);
      try { shape = cupWithRoundedWindows(kernel, cup, R); log(`seed ${seed}.${attempt} made, ${cup.windows.length} windows R ${R}`); }
      catch (e) { if (!(e instanceof KernelError)) throw e; log(`seed ${seed}.${attempt} not made`); }
    }
    if (!shape) continue;
    phase = `recog${seed}`;
    const h0 = heap(), t0 = Date.now();
    try { const res = await recognizeStep(kernel, solver, shape); log(`seed ${seed} rebuilt`); if (process.env.FRESH) { const k2 = await Kernel.load(); const h2 = () => ((k2.oc as any).wasmMemory.buffer.byteLength as number) / 2 ** 20; const g = new Regenerator(k2, solver, new Map()); const a = h2(), t2 = Date.now(); const rr = g.rebuild(res.doc, { largestFilletRadius: false }); log(`fresh rebuild of the result: ${rr.features.filter((f: any) => f.status !== 'ok').length} not ok, ${Date.now() - t2}ms heap ${a.toFixed(1)}->${h2().toFixed(1)}`); g.dispose(); } }
    catch (e: any) { log(`seed ${seed} ${e instanceof BudgetError ? 'BUDGET' : e instanceof RecognizeError ? 'refused' : 'ERROR'}: ${String(e?.message).slice(0, 100)}`); }
    log(`seed ${seed} recognition ${Date.now() - t0}ms heap ${h0.toFixed(1)}->${heap().toFixed(1)}`);
    kernel.release(shape);
  }
}, 1_800_000);
