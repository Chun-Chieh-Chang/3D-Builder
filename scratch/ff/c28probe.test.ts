// C2.8 feasibility: on exact-round fuzz samples, (a) is the body without rounds recognized, (b) why is the rounded one refused,
// (c) can deleteFaces take the round faces off, and is the result recognized. SEEDS=1-20
import { beforeAll, it } from 'vitest';
import { applyCommand, createEmptyPart, type PartDoc } from '@3db/model';
import { sha256Hex } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, KernelError, isTrap, type ShapeId } from '@3db/kernel';
import { reconstructImported, RecognizeError, Regenerator } from '@3db/regen';
import { sample, __body } from '../../packages/kernel/test/exact-round-fuzz.kit';

let kernel: Kernel; let solver: PlaneGcsSolver;
beforeAll(async () => { kernel = await Kernel.load(); solver = await PlaneGcsSolver.create(); });

async function rec(s: ShapeId): Promise<string> {
  const bytes = new TextEncoder().encode(kernel.exportStep(s, 'p'));
  const sha = await sha256Hex(bytes);
  const doc: PartDoc = applyCommand(createEmptyPart(), { type: 'importBody', blob: { id: 'blob1', sha256: sha, kind: 'step', fileName: 'f.step' }, feature: { id: 'imp1', type: 'importedBody', name: 'i', suppressed: false, blob: 'blob1' }, index: 0 });
  const regen = new Regenerator(kernel, solver, new Map([[sha, bytes]]));
  try {
    const out = reconstructImported(kernel, regen, doc, 'imp1', solver);
    return 'OK ' + JSON.stringify(out.report.features) + ' dV=' + out.report.volumeError?.toExponential(2);
  } catch (e) { if (e instanceof RecognizeError) return 'REFUSED ' + e.message.slice(0, 160); throw e; } finally { regen.dispose(); }
}

it('probe', async () => {
  const [a, b] = (process.env.SEEDS ?? '1-12').split('-').map(Number);
  for (let seed = a!; seed <= b!; seed++) {
    const s = sample(seed); const line: string[] = [`seed ${seed} ${s.kind} tilt=${s.tilt} draft=${s.draft} r=${s.r}`];
    try {
      const m = __body(kernel, s);
      line.push('plain: ' + (await rec(m.shape)));
      const f = kernel.fillet(m.shape, m.edges, s.r, undefined, undefined, true);
      const t = kernel.topology(f.shape);
      const rounds = t.faces.flatMap((x, i) => ((f.faceOrigins[i] ?? []).some((o: any) => o.rel === 'generated' && o.kind === 'edge') ? [i] : []));
      line.push(`rounds ${rounds.length} [${rounds.map((i) => t.faces[i]!.surface).join(',')}] exact=${JSON.stringify(((kernel as any).exactRoundLog ?? []).map((x: any) => x.outcome))}`);
      line.push('rounded: ' + (await rec(f.shape)));
      try {
        const d = kernel.deleteFaces(f.shape, rounds);
        const v0 = kernel.massProps(m.shape).volume, v1 = kernel.massProps(d.shape).volume;
        line.push(`deleteFaces ok, vol vs plain ${((v1 - v0) / v0).toExponential(2)}; recognized: ${await rec(d.shape)}`);
      } catch (e) { if (e instanceof KernelError) line.push('deleteFaces FAILED ' + e.message.slice(0, 80)); else throw e; }
    } catch (e) { if (isTrap(e)) { line.push('TRAP'); kernel = await Kernel.load(); } else if (e instanceof KernelError) line.push('kernel ' + e.message.slice(0, 80)); else throw e; }
    console.log(line.join('\n   '));
  }
}, 1_200_000);
