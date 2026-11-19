/**
 * ADR 0259 slice 4b: the cups of slice 4a (`recognize-multi-window.kit.ts`) with the rims of their windows rounded by an OCCT fillet: every edge where a
 * window's wall (a B-spline face that is not flat) meets the outer cylinder, at radius `R`. Part-3's rounds sit so (r 19.05 between a B wall and the
 * cone, r 3.048 between the lid and an A wall); they cannot be deleted from the body first (c18d), so recognition must read the windows with them left in.
 * The truth is the body made here. `fuzzFile` runs random cases (AGENTS §3.4), each its own `it`.
 */
import { expect, it } from 'vitest';
import { PlaneGcsSolver } from '@3db/sketch';
import { isTrap, Kernel, KernelError, type ShapeId } from '@3db/kernel';
import { BudgetError, RECOGNIZE_TOLERANCE, RecognizeError } from '@3db/regen';
import { recognizeStep } from './recognize-rolling-ball.kit';
import { cupWithWindows, sample as sampleCup, type MultiCup, type Window } from './recognize-multi-window.kit';

/** The part: the cup with its window rims rounded. Throws `KernelError` when the kernel refuses it. */
export function cupWithRoundedWindows(kernel: Kernel, p: MultiCup, R: number): ShapeId {
  const body = cupWithWindows(kernel, p);
  try {
    const topo = kernel.topology(body);
    const outer = new Set(topo.faces.flatMap((f, i) => (f.geometry?.type === 'cylinder' && Math.abs((f.geometry as { radius: number }).radius - p.r) < 1e-9 ? [i] : [])));
    const wall = (f: number) => topo.faces[f]!.surface === 'bsplinesurface' && !kernel.flatFace(body, f, 1e-7);
    const rim = topo.edges.flatMap((e, i) => (e.faces.some((f) => outer.has(f)) && e.faces.some(wall) ? [i] : []));
    if (rim.length === 0) throw new KernelError('no rim');
    return kernel.fillet(body, rim, R).shape;
  } finally {
    kernel.release(body);
  }
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A random case: a cup of slice 4a with its windows all drafted (a loft window's of slice 4a is drafted instead, on the same chord and spline), drafts of
 * 0.3° to 1°, and a radius from 0.2 to 0.5. Drafted only: on random loft walls OCCT's own fillet failed in 42 of 100 cases, ran 5 to 9 minutes in 3,
 * and where it was made it was up to 9.9e-4 off a rolling ball, past what is nominated as a round (c19a–c19d); a rounded loft window is the fixed
 * test's. The draft and radius are the variant OCCT makes most often (c19f, 40 seeds: 16 made; drafts to 2.7° and radii to 0.8: 3 made); the rest are
 * fillets OCCT fails or makes invalid: `fuzzFile` then takes the seed's next attempt (at most five), so that each seed is a part (the user's choice,
 * 2026-11-19, with the bar "at least one rebuilt in each file" kept).
 */
export function sample(seed: number, attempt = 0): { cup: MultiCup; R: number } {
  const r = rng(seed * 15485863 + attempt);
  const cup = sampleCup(seed + 1000 + 997 * attempt);
  const windows = cup.windows.map((w): Window => (w.kind === 'drafted' ? { ...w } : { kind: 'drafted', at: w.at, top: w.first, draft: 0 }));
  for (const w of windows) if (w.kind === 'drafted') w.draft = Math.round((r() < 0.5 ? -1 : 1) * (0.3 + 0.7 * r()) * 1000) / 1000;
  return { cup: { ...cup, windows }, R: Math.round((0.2 + 0.3 * r()) * 1000) / 1000 };
}

/**
 * Seeds `from`–`to`, each its own case: rebuilt as the same solid (to the recognition tolerance) with at least one fillet, or refused for a reason
 * recognition gives, or stopped by the job's memory budget (a refusal the product gives, counted on its own: the rounds left in the body cost about four
 * times the heap, seed 85 of the first run 562 MiB against 138 without them); a trap or any other error fails it. A part the kernel will not make (its draft closes the outline, or the fillet fails) is skipped
 * and counted. At the end at least one case was made and went through recognition (rebuilt or refused). The bar was "at least one rebuilt"; with
 * the retries every file made two parts or more, but the product rebuilt 31 of the 83 made (37%) and 6 files of 25 rebuilt none, so the bar measured
 * the product's rate, not whether the fuzz ran. The user chose this bar on 2026-11-19 (ADR 0259, slice 4b as built); the rate is printed and recorded.
 */
export function fuzzFile(from: number, to: number) {
  let kernel: Kernel;
  let solver: PlaneGcsSolver;
  let rebuilt = 0;
  let notMade = 0;
  let budget = 0;
  let refused = 0;
  it('loads', async () => {
    kernel = await Kernel.load();
    solver = await PlaneGcsSolver.create();
  }, 60_000);
  for (let seed = from; seed <= to; seed++) {
    it(`seed ${seed}`, async () => {
      let made: { shape: ShapeId; cup: MultiCup; attempt: number } | null = null;
      for (let attempt = 0; attempt < 5 && !made; attempt++) {
        const { cup, R } = sample(seed, attempt);
        try {
          made = { shape: cupWithRoundedWindows(kernel, cup, R), cup, attempt };
        } catch (e) {
          if (!(e instanceof KernelError) || isTrap(e)) throw e;
          console.log(`#${seed}.${attempt} not made: ${e.message.slice(0, 60)}`);
        }
      }
      if (!made) {
        notMade++;
        return;
      }
      const { shape, cup } = made;
      try {
        const r = await recognizeStep(kernel, solver, shape);
        expect(r.report.volumeError).toBeLessThan(RECOGNIZE_TOLERANCE);
        expect(r.report.difference).toBeLessThan(RECOGNIZE_TOLERANCE);
        expect(r.doc.features.some((f) => f.type === 'fillet')).toBe(true);
        rebuilt++;
        console.log(`#${seed} rebuilt (${cup.windows.length} windows)`);
      } catch (e) {
        if (e instanceof BudgetError) {
          budget++;
          console.log(`#${seed} budget (${cup.windows.length} windows): ${e.message.slice(0, 60)}`);
          return;
        }
        if (!(e instanceof RecognizeError)) throw e;
        refused++;
        console.log(`#${seed} refused (${cup.windows.length} windows): ${e.message.slice(0, 120)}`);
      } finally {
        kernel.release(shape);
      }
    }, 300_000);
  }
  it('at least one case went through recognition; the counts and the heap are printed', () => {
    const heap = (kernel.oc as unknown as { wasmMemory?: WebAssembly.Memory }).wasmMemory?.buffer?.byteLength ?? NaN;
    expect(heap).toBeGreaterThan(0);
    console.log(`seeds ${from}-${to}: rebuilt ${rebuilt}, refused ${refused}, not made ${notMade}, stopped by the budget ${budget}, heap ${(heap / 2 ** 20).toFixed(0)} MiB`);
    expect(rebuilt + refused).toBeGreaterThan(0);
  });
}
