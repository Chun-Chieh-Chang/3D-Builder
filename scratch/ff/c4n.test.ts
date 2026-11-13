// C4-1: run with kernel.ts's `deviation <= tol` gate removed (scratch/ff/c4n-run.mjs): every surface OCCT's GeomConvert_SurfToAnaSurf proposes at
// tol comes back, with our 13x13 measured deviation. Counts how often OCCT proposes one farther than tol from the face.
import { appendFileSync, readFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { stepAssemblyPlan } from '../../packages/io/src/stepAssembly';
import { moved, splineStep } from '../../tests/phase8/recognize-analytic-faces.kit';
const log = (m: string) => appendFileSync('scratch/ff/c4n.log', m + String.fromCharCode(10));
it('c4n', async () => {
  const kernel = await Kernel.load();
  const shapes: { name: string; id: any }[] = [];
  const whole = new Uint8Array(readFileSync('D:/3DB實機確認/組合圖(R1-10226+R1-10134).STEP'));
  const parts = stepAssemblyPlan(kernel, whole).prototypes.filter((p: any) => p.part);
  for (const i of [2, 3]) shapes.push({ name: `part-${i + 1}`, id: kernel.importStep(parts[i]!.part!.step).shape });
  const e13 = new Uint8Array(readFileSync('D:/3DB實機確認/E13-999-421.STEP'));
  shapes.push({ name: 'E13', id: kernel.importStep(e13).shape });
  const d = kernel.extrude({ origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } as never, [{ outer: [{ kind: 'circle', c: [0, 0], r: 15, source: 'c' }], holes: [] }] as never, [0, 0, 8]).shape;
  const text = splineStep(kernel, d);
  for (const delta of [1e-7, 1e-6, 1e-5, 1e-4]) shapes.push({ name: `disc both ${delta}`, id: kernel.importStep(new TextEncoder().encode(moved(text, delta, 'both'))).shape });
  let asked = 0, proposed = 0, over = 0, worst = 0;
  const rows: string[] = [];
  for (const { name, id } of shapes) {
    kernel.topology(id).faces.forEach((f, i) => {
      if (f.geometry) return;
      for (const tol of [1e-7, 1e-6, 1e-5, 1e-4, 1e-3, 1e-2]) {
        asked++;
        const at = kernel.analyticFace(id, i, tol);
        if (!at) continue;
        proposed++;
        if (at.deviation > tol) {
          over++;
          worst = Math.max(worst, at.deviation / tol);
          rows.push(`${name} f${i} ${at.geometry.type} tol ${tol} measured ${at.deviation.toExponential(2)}`);
        }
      }
    });
  }
  log(`asked ${asked}; OCCT proposed ${proposed}; of those, measured farther than tol: ${over} (worst ${worst.toFixed(2)}x tol)`);
  for (const r of rows.slice(0, 25)) log('  ' + r);
}, 900_000);
