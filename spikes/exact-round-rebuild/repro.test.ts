/**
 * To-do #3 (2026-11-27): rolling-ball fuzz seeds 73 and 52, where the rebuild's exact round is refused. Builds each as the fuzz does, recognizes it
 * through STEP, and writes the exact-round log of the original and of the rebuild (with each refusal's detail) to data/repro.json.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { RecognizeError } from '@3db/regen';
import { recognizeStep, sample, splineBoss } from '../../tests/phase8/recognize-rolling-ball.kit';

it('reproduces seeds 73 and 52', async () => {
  const seeds = (process.env.SEEDS ?? '73,52').split(',').map(Number);
  const out: unknown[] = [];
  for (const seed of seeds) {
    const kernel = await Kernel.load(); const solver = await PlaneGcsSolver.create();
    const k = kernel as unknown as { exactRoundLog: unknown[]; lastFilletCut?: string };
    const s = sample(seed);
    const m = splineBoss(kernel, s.top, s.h);
    const shape = kernel.fillet(m.shape, m.edges, s.radius, undefined, undefined, true).shape;
    const original = { log: k.exactRoundLog, cut: k.lastFilletCut, volume: kernel.massProps(shape).volume };
    let rec: unknown;
    try {
      const r = await recognizeStep(kernel, solver, shape);
      rec = { ok: true, report: r.report, fillet: r.doc.features.find((f) => f.type === 'fillet'), rebuildLog: k.exactRoundLog, cut: k.lastFilletCut };
    } catch (e) {
      rec = { ok: false, message: e instanceof RecognizeError ? e.message : String(e), rebuildLog: k.exactRoundLog, cut: k.lastFilletCut };
    }
    out.push({ seed, sample: s, original, rec });
  }
  mkdirSync('spikes/exact-round-rebuild/data', { recursive: true });
  writeFileSync('spikes/exact-round-rebuild/data/repro.json', JSON.stringify(out, null, 1));
}, 900_000);
