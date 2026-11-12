/**
 * C4, random parts (AGENTS §3.4): 120 plates of random size with none to two round holes and sometimes a round boss, every face stored as a B-spline
 * (`recognize-analytic-faces.kit.ts`). Three kinds, by seed: as converted (must be rebuilt, its volume the closed-form one); a sloppy file, its round
 * surfaces moved off their own edges by a random 1e-6 to 1e-4 mm (must be rebuilt within the file's gaps, the report saying so); and a consistent
 * body whose round faces are no cylinders by that much (must never be taken for the plate: refused, or the same solid to the tolerance). A trap, a
 * timeout or any other refusal fails the case. A file of its own for a fresh Emscripten heap (AGENTS §3.5); the heap is read only through
 * `wasmMemory.buffer.byteLength` and printed, not claimed flat.
 */
import { afterAll, expect, it } from 'vitest';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { RECOGNIZE_TOLERANCE, RecognizeError } from '@3db/regen';
import { moved, plate, recognizeText, rng, sample, splineStep } from './recognize-analytic-faces.kit';

let kernel: Kernel;
let solver: PlaneGcsSolver;
let h0 = 0;
const heap = () => (kernel.oc as unknown as { wasmMemory?: { buffer?: { byteLength?: number } } }).wasmMemory?.buffer?.byteLength ?? NaN;
const stats = { exact: { cases: 0, rebuilt: 0 }, sloppy: { cases: 0, rebuilt: 0, noRound: 0 }, off: { cases: 0, refused: 0, same: 0, noRound: 0 }, worst: 0 };

it('loads with a heap to measure', async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
  h0 = heap();
  expect(h0).toBeGreaterThan(0);
});

for (let seed = 1; seed <= 120; seed++) {
  const kind = seed % 4 === 1 ? 'sloppy' : seed % 4 === 2 ? 'off' : 'exact';
  it(`seed ${seed} (${kind})`, async () => {
    const p = sample(seed);
    const what = `${kind} ${JSON.stringify(p)}`;
    const made = plate(kernel, p);
    const plain = splineStep(kernel, made.shape);
    kernel.release(made.shape);
    const round = p.holes.length > 0 || !!p.boss;
    // 1e-7 to 1e-5 on the weights: 2/3 of that times the radius on the surface
    const delta = 10 ** (-7 + 2 * rng(seed * 7919)());
    const text = kind === 'exact' ? plain : moved(plain, delta, kind === 'sloppy' ? 'surfaces' : 'both');
    stats[kind].cases++;
    if (kind !== 'exact' && !round) {
      // nothing round to move: the file is the exact one
      expect(text).toBe(plain);
      (stats[kind] as { noRound: number }).noRound++;
    }
    const live = kernel.liveShapes;
    let out: Awaited<ReturnType<typeof recognizeText>> | RecognizeError;
    try {
      out = await recognizeText(kernel, solver, text);
    } catch (e) {
      if (!(e instanceof RecognizeError)) throw e;
      out = e;
    }
    expect(kernel.liveShapes, what).toBe(live);
    if (out instanceof RecognizeError) {
      // only a body that is no plate with round holes may be refused, and only for what it is
      expect(kind, `${what}: refused: ${out.message}`).toBe('off');
      expect(round, what).toBe(true);
      expect(out.message, what).toMatch(/自由曲面|不支援的曲線|重建結果與原件不同/);
      stats.off.refused++;
      return;
    }
    expect(out.report.difference, what).toBeLessThan(RECOGNIZE_TOLERANCE);
    expect(out.doc.features.some((f) => f.type === 'importedBody'), what).toBe(false);
    stats.worst = Math.max(stats.worst, out.report.difference);
    if (kind === 'exact' || !round) {
      expect(out.report.volumeError, what).toBeLessThan(RECOGNIZE_TOLERANCE);
      expect(Math.abs(out.report.volume - made.volume) / made.volume, what).toBeLessThan(1e-7);
      expect(out.report.fileTolerance, what).toBeUndefined();
      expect(out.report.features.extrude, what).toBe(p.boss ? 2 : 1);
      if (kind === 'exact') stats.exact.rebuilt++;
      else if (kind === 'sloppy') stats.sloppy.rebuilt++;
      else stats.off.same++;
      return;
    }
    if (kind === 'sloppy') {
      expect(out.report.fileTolerance, what).toBeDefined();
      // the rebuilt plate is the true one to within what the file's own gaps move
      expect(Math.abs(out.report.volume - made.volume) / made.volume, what).toBeLessThan(RECOGNIZE_TOLERANCE + out.report.fileTolerance!.volume);
      expect(out.report.volumeError, what).toBeLessThan(RECOGNIZE_TOLERANCE + out.report.fileTolerance!.volume);
      stats.sloppy.rebuilt++;
      return;
    }
    // off, and rebuilt: then it is the same solid to the tolerance with no allowance (a move too small to matter)
    expect(out.report.fileTolerance, what).toBeUndefined();
    expect(out.report.volumeError, what).toBeLessThan(RECOGNIZE_TOLERANCE);
    stats.off.same++;
  }, 120_000);
}

afterAll(() => {
  console.log(`analytic-faces fuzz: ${JSON.stringify(stats)}; heap ${(h0 / 2 ** 20).toFixed(1)} -> ${(heap() / 2 ** 20).toFixed(1)} MiB`);
});

it('every kind did what it is for at least once', () => {
  expect(stats.exact.cases).toBe(60);
  // every exact one is rebuilt
  expect(stats.exact.rebuilt).toBe(stats.exact.cases);
  // every sloppy one is rebuilt, and most have something round that was moved
  expect(stats.sloppy.rebuilt).toBe(stats.sloppy.cases);
  expect(stats.sloppy.cases - stats.sloppy.noRound).toBeGreaterThanOrEqual(15);
  // of the bodies that are no plates, some are refused: the check has teeth
  expect(stats.off.refused).toBeGreaterThanOrEqual(5);
  expect(stats.off.refused + stats.off.same).toBe(stats.off.cases);
});
