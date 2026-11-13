// Real-part recognition audit on Windows (the VM's run-audit.py runner was not kept): one STEP file per process (FILE = its path relative to STEP_DIR),
// each part of an assembly as its own target, exact recognition (no approximation); one JSON line per target appended to OUT.
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import { applyCommand, createEmptyPart, type PartDoc } from '@3db/model';
import { sha256Hex } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { reconstructImported, RecognizeError, Regenerator } from '@3db/regen';
import { stepAssemblyPlan } from '../../packages/io/src/stepAssembly';

it('audit one file', async () => {
  const dir = process.env.STEP_DIR!, rel = process.env.FILE!, out = process.env.OUT!;
  const kernel = await Kernel.load();
  // control: no face read as a rolling ball (the path before C2.8), the rest the same
  if (process.env.NOBALL) (kernel as any).rollingBall = () => null;
  // control: every round OCCT's own (as before C2.7f made recognition ask for exact ones)
  if (process.env.NOEXACT) { const f = kernel.fillet.bind(kernel); (kernel as any).fillet = (s: any, e: any, r: any, l: any, a: any) => f(s, e, r, l, a, false); }
  // count what the classifier is asked
  const calls = { ball: 0 }; const orig = kernel.rollingBall.bind(kernel); if (!process.env.NOBALL) (kernel as any).rollingBall = (...a: any[]) => { calls.ball++; return (orig as any)(...a); };
  const solver = await PlaneGcsSolver.create();
  const whole = new Uint8Array(readFileSync(join(dir, rel)));
  let targets: { label: string; bytes: Uint8Array }[];
  try {
    const parts = stepAssemblyPlan(kernel, whole).prototypes.filter((p: any) => p.part);
    targets = parts.length > 1 ? parts.map((p: any, k: number) => ({ label: `part-${k + 1}(${p.name ?? ''})`, bytes: p.part.step })) : [{ label: 'whole', bytes: whole }];
  } catch { targets = [{ label: 'whole', bytes: whole }]; }
  for (const { label, bytes } of targets) {
    const t0 = performance.now();
    const sha = await sha256Hex(bytes);
    const doc: PartDoc = applyCommand(createEmptyPart(), { type: 'importBody', blob: { id: 'blob1', sha256: sha, kind: 'step', fileName: 'f.step' }, feature: { id: 'imp1', type: 'importedBody', name: 'i', suppressed: false, blob: 'blob1' }, index: 0 });
    const regen = new Regenerator(kernel, solver, new Map([[sha, bytes]]));
    const row: any = { rel, label };
    try {
      const faces = regen.rebuild(doc).body?.topology.faces.length;
      row.faces = faces;
      const r = reconstructImported(kernel, regen, doc, 'imp1', solver);
      Object.assign(row, { status: 'rebuilt', features: r.report.features, volumeError: r.report.volumeError, difference: (r.report as any).difference });
    } catch (e) {
      if (e instanceof RecognizeError) Object.assign(row, { status: 'refused', reason: e.message.slice(0, 300) });
      else Object.assign(row, { status: 'error', reason: String(e).slice(0, 300) });
    } finally { regen.dispose(); }
    row.ms = Math.round(performance.now() - t0);
    row.ballCalls = calls.ball; calls.ball = 0;
    row.heapMiB = +((kernel.oc as any).wasmMemory.buffer.byteLength / 2 ** 20).toFixed(1);
    appendFileSync(out, JSON.stringify(row) + '\n');
    console.log('AUDIT', JSON.stringify(row));
  }
}, 900_000);
