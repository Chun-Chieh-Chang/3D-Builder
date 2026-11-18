/**
 * ADR 0259, decision 2: a window cut without part-3's r 0.127 edge chamfers is not the same solid, so it may come only from an opt-in mode that is off
 * by default. This locks the default: with no option, part-3 of the user's assembly is still refused, with the existing message (faces with no simple
 * surface), and nothing is applied. The file is a customer's and stays out of the repository: REAL_PART3_STEP names it
 * (D:\3DB實機確認\tmp\組合圖(R1-10226+R1-10134).STEP on the machine it was measured on). Without it the test is skipped, and the run says so.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, type PartDoc } from '@3db/model';
import { sha256Hex, stepAssemblyPlan } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { reconstructImported, RecognizeError, Regenerator } from '@3db/regen';

const file = process.env.REAL_PART3_STEP;

describe.skipIf(!file)('part-3 (R1-10226) with the default options (ADR 0259 decision 2)', () => {
  it('is refused: no option was chosen, so no partial result', async () => {
    const kernel = await Kernel.load();
    const solver = await PlaneGcsSolver.create();
    const whole = new Uint8Array(readFileSync(file!));
    const parts = stepAssemblyPlan(kernel, whole).prototypes.filter((p) => p.part);
    const part3 = parts.find((p) => /R1-10226/.test(p.name ?? ''));
    expect(part3, 'the assembly holds part-3 (R1-10226)').toBeDefined();
    const bytes = part3!.part!.step;
    const sha = await sha256Hex(bytes);
    const doc: PartDoc = applyCommand(createEmptyPart(), {
      type: 'importBody',
      blob: { id: 'blob1', sha256: sha, kind: 'step', fileName: 'part3.step' },
      feature: { id: 'imp1', type: 'importedBody', name: 'i', suppressed: false, blob: 'blob1' },
      index: 0,
    });
    const regen = new Regenerator(kernel, solver, new Map([[sha, bytes]]));
    try {
      expect(regen.rebuild(doc).body?.topology.faces.length).toBeGreaterThan(0);
      let refused: unknown = null;
      try {
        reconstructImported(kernel, regen, doc, 'imp1', solver);
      } catch (e) {
        refused = e;
      }
      expect(refused).toBeInstanceOf(RecognizeError);
      expect((refused as Error).message).toMatch(/自由曲面|free-form|no simple surface/);
    } finally {
      regen.dispose();
    }
  }, 900_000);
});
