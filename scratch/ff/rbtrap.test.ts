// Seed SEED: where recognition spends its time or throws. The STEP is written before any method is wrapped (wrapping every method made the export's
// face colouring hang: an artefact of the probe). ENTRY=1 logs every call as it starts (a call blocked in WASM gives no other sign).
import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { applyCommand, createEmptyPart, type PartDoc } from '@3db/model';
import { sha256Hex } from '@3db/io';
import { Kernel } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { reconstructImported, Regenerator } from '@3db/regen';
import { sample, splineBoss } from '../../tests/phase8/recognize-rolling-ball.kit';
it('trap', async () => {
  const kernel = await Kernel.load(); const solver = await PlaneGcsSolver.create(); const k = kernel as any;
  const s = sample(Number(process.env.SEED ?? 26)); const m = splineBoss(kernel, s.top, s.h);
  const made = kernel.fillet(m.shape, m.edges, s.radius, undefined, undefined, true).shape;
  console.log('TR made', JSON.stringify(k.exactRoundLog), JSON.stringify(s));
  const bytes = new TextEncoder().encode(kernel.exportStep(made, 'p'));
  const sha = await sha256Hex(bytes);
  const doc: PartDoc = applyCommand(createEmptyPart(), { type: 'importBody', blob: { id: 'blob1', sha256: sha, kind: 'step', fileName: 'f.step' }, feature: { id: 'imp1', type: 'importedBody', name: 'i', suppressed: false, blob: 'blob1' }, index: 0 });
  const depth: string[] = [];
  const only = new Set(process.env.WRAP ? process.env.WRAP.split(',') : Object.getOwnPropertyNames(Kernel.prototype).filter((n) => n !== 'constructor' && n !== 'get'));
  for (const name of only) {
    const f = k[name]; if (typeof f !== 'function') continue;
    k[name] = (...a: any[]) => {
      const tag = `${name}(${a.map((x) => (typeof x === 'object' ? (Array.isArray(x) ? `[${x.length}]` : '{}') : String(x).slice(0, 12))).join(',')})`;
      depth.push(tag); const t0 = performance.now(); if (process.env.ENTRY) appendFileSync(process.env.ENTRY, (performance.now() / 1000).toFixed(1) + ' enter ' + depth.join(' > ') + String.fromCharCode(10));
      try { return f.apply(kernel, a); }
      catch (e: any) { console.log('TR THREW in', depth.join(' > '), e?.constructor?.name, String(e?.message ?? e).slice(0, 120)); throw e; }
      finally { const dt = performance.now() - t0; if (dt > 3000) console.log('TR slow', (dt / 1000).toFixed(1), 's', depth.join(' > '), name === 'fillet' ? JSON.stringify(k.exactRoundLog) : ''); depth.pop(); }
    };
  }
  const regen = new Regenerator(kernel, solver, new Map([[sha, bytes]]));
  const t0 = performance.now();
  try { const r = reconstructImported(kernel, regen, doc, 'imp1', solver); console.log('TR rebuilt', r.report.volumeError, JSON.stringify(r.report.features)); }
  catch (e: any) { console.log('TR final', e?.constructor?.name, String(e?.message ?? e).slice(0, 150)); }
  finally { regen.dispose(); console.log('TR total', ((performance.now() - t0) / 1000).toFixed(1), 's'); }
}, 1_200_000);
