/**
 * Large sketches and the solver's memory (2026-10-30). planegcs has a fixed heap of 16 MiB that cannot grow and solves with dense matrices: 150 dimensioned
 * rectangles in one sketch aborted the module with `Aborted(OOM)`. Independent parts are now solved in batches; one connected part too large is refused
 * with a message, and the module that aborted is replaced by a spare.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { t } from '@3db/i18n';
import { SKETCH_ORIGIN } from '@3db/model';
import type { SolvedGeometry } from '../src/types';
import { PlaneGcsSolver } from '../src/index';
import { chain, heapBytes, rectangles, sketchOf, type Built } from './large-sketch';

const TOL = 1e-6;

let solver: PlaneGcsSolver;
beforeEach(async () => {
  solver = await PlaneGcsSolver.create();
});

const point = (g: Map<string, SolvedGeometry>, id: string): [number, number] => {
  const p = g.get(id);
  if (p?.type !== 'point') throw new Error(`${id} is not a solved point`);
  return p.p;
};

/** Every point where the truth puts it, to 1e-6 mm; every rectangle 20 × 10 with horizontal and vertical sides. */
function expectTrue(built: Built, g: Map<string, SolvedGeometry>, n: number): void {
  for (const [id, [x, y]] of built.truth) {
    const [px, py] = point(g, id);
    expect(Math.abs(px - x), id).toBeLessThan(TOL);
    expect(Math.abs(py - y), id).toBeLessThan(TOL);
  }
  for (let i = 0; i < n; i++) {
    const [a, b, c, d] = [0, 1, 2, 3].map((k) => point(g, `p${i}_${k}`));
    expect(Math.abs(b![0] - a![0] - 20)).toBeLessThan(TOL);
    expect(Math.abs(c![1] - b![1] - 10)).toBeLessThan(TOL);
    expect(Math.abs(b![1] - a![1])).toBeLessThan(TOL);
    expect(Math.abs(c![1] - d![1])).toBeLessThan(TOL);
    expect(Math.abs(b![0] - c![0])).toBeLessThan(TOL);
    expect(Math.abs(a![0] - d![0])).toBeLessThan(TOL);
  }
}

describe('a sketch larger than the solver solved whole could hold', () => {
  it.each([150, 250])('%i dimensioned rectangles, free to move: solved, two freedoms each, every size exact', (n) => {
    const built = rectangles(n, 'none');
    const r = solver.solve(built.sketch);
    expect(r.message).toBeUndefined();
    expect(r.status).toBe('under');
    expect(r.dof).toBe(2 * n);
    expectTrue(built, r.geometry, n);
  });

  it.each([150, 250])('%i rectangles placed from the origin (fixed, shared by all, joins none): fully defined, every corner where it is to be', (n) => {
    const built = rectangles(n, 'origin');
    const r = solver.solve(built.sketch);
    expect(r.status).toBe('fully');
    expect(r.dof).toBe(0);
    expect(built.truth.size).toBe(4 * n);
    expectTrue(built, r.geometry, n);
  });

  it('the same answer as each rectangle solved alone, and the definition analysis of the batched sketch', () => {
    const built = rectangles(150, 'origin');
    const all = solver.solve(built.sketch, { analyze: true });
    expect(all.status).toBe('fully');
    expect([...all.entityStatus!.values()].every((s) => s === 'fully')).toBe(true);
    const free = solver.solve(rectangles(150, 'none').sketch, { analyze: true });
    expect([...free.entityStatus!.values()].every((s) => s === 'under')).toBe(true);
    for (const i of [0, 77, 149]) {
      const one = rectangles(150, 'origin');
      one.sketch.entities = one.sketch.entities.filter((e) => e.id.startsWith(`p${i}_`) || e.id.startsWith(`l${i}_`));
      one.sketch.constraints = one.sketch.constraints.filter((c) => c.id.slice(1).replace(/[ab]$/, '') === String(i));
      expect(one.sketch.constraints).toHaveLength(8);
      const alone = solver.solve(one.sketch);
      for (let k = 0; k < 4; k++) {
        const [x, y] = point(alone.geometry, `p${i}_${k}`);
        const [u, v] = point(all.geometry, `p${i}_${k}`);
        expect(Math.abs(x - u)).toBeLessThan(TOL);
        expect(Math.abs(y - v)).toBeLessThan(TOL);
      }
    }
  });

  it('the definition of each entity in 150 rectangles, free, placed across only or placed: each probe solves the part of its point alone', () => {
    // in the app the 150 took 31 s, every one of 600 probes solving the whole sketch again (2026-10-30)
    const built = rectangles(150, 'none');
    for (let i = 0; i < 150; i++) {
      const [x, y] = [(i % 20) * 30, Math.floor(i / 20) * 30];
      if (i % 3 >= 1) built.sketch.constraints.push({ id: `x${i}`, type: 'distanceX', a: SKETCH_ORIGIN, b: `p${i}_0`, value: String(x) });
      if (i % 3 === 2) built.sketch.constraints.push({ id: `y${i}`, type: 'distanceY', a: SKETCH_ORIGIN, b: `p${i}_0`, value: String(y) });
    }
    const sizes: number[] = [];
    const run = (solver as unknown as { run: (prims: unknown[]) => unknown }).run.bind(solver);
    vi.spyOn(solver as unknown as { run: (prims: unknown[]) => unknown }, 'run').mockImplementation((prims) => {
      sizes.push(prims.length);
      return run(prims);
    });
    const r = solver.solve(built.sketch, { analyze: true });
    expect(r.status).toBe('under');
    expect(r.dof).toBe(50 * 2 + 50 * 1);
    for (let i = 0; i < 150; i++) {
      // free: every corner moves both ways; placed across: up and down only; placed: none
      const dof = [2, 1, 0][i % 3]!;
      for (let k = 0; k < 4; k++) {
        expect(r.entityStatus!.get(`p${i}_${k}`), `p${i}_${k}`).toBe(dof === 0 ? 'fully' : 'under');
        expect(r.entityFreedom!.get(`p${i}_${k}`)?.points ?? [], `p${i}_${k}`).toEqual(dof === 0 ? [] : [{ id: `p${i}_${k}`, dof }]);
        expect(r.entityStatus!.get(`l${i}_${k}`), `l${i}_${k}`).toBe(dof === 0 ? 'fully' : 'under');
      }
    }
    // the sketch solved once whole; then 600 probes and 150 parts, none larger than one rectangle with its relations and the origin
    expect(sizes[0]).toBe(sizes.reduce((a, b) => Math.max(a, b)));
    expect(sizes.length).toBe(1 + 600 + 150);
    expect(Math.max(...sizes.slice(1))).toBeLessThanOrEqual(4 + 4 + 6 + 2 + 1);
  });

  it('the analysis leaves the next answer as it was: the same solves, with and without it, give the same numbers to the last digit', async () => {
    // planegcs's answer to an under-defined sketch depends on what its module solved before: the probes of the analysis, run on that module, moved two
    // lines made one by a parallel 0.55 away from where they came out before (apps/web/test/sketch-collapse.test.ts)
    const lines = (parallel: boolean) =>
      sketchOf(
        [
          { id: 'a', type: 'point', x: -20, y: 5 },
          { id: 'b', type: 'point', x: -20, y: -20 },
          { id: 'c', type: 'point', x: 10, y: 5 },
          { id: 'l1', type: 'line', p1: 'a', p2: 'b' },
          { id: 'l2', type: 'line', p1: 'b', p2: 'c' },
        ],
        [{ id: 'v', type: 'vertical', a: 'l1' }, ...(parallel ? [{ id: 'par', type: 'parallel' as const, a: 'l1', b: 'l2' }] : [])],
      );
    const steps = [lines(false), rectangles(150, 'none').sketch, lines(false), lines(true)];
    const answers = async (analyze: boolean) => {
      const s = await PlaneGcsSolver.create();
      return steps.map((sketch) => s.solve(sketch, { analyze }).geometry);
    };
    const [plain, analyzed] = [await answers(false), await answers(true)];
    for (let i = 0; i < steps.length; i++) expect(analyzed[i], `step ${i}`).toEqual(plain[i]);
  });

  it('a conflict in one rectangle of 150 is named, and only that one', () => {
    const built = rectangles(150, 'none');
    built.sketch.constraints.push({ id: 'bad', type: 'distance', a: 'l100_0', value: '30' });
    const r = solver.solve(built.sketch);
    expect(r.status).toBe('over');
    expect(new Set([...r.conflicting, ...r.redundant])).toEqual(new Set(['w100', 'bad']));
  });
});

describe('one connected part too large for the solver', () => {
  it('is refused with a message, the module is replaced, and the solver goes on solving', async () => {
    // the abort is handled, and not printed as an error of the page as well (verify:ui fails a page that logs one); a module takes its `console.error` when
    // it is made, so the solver is made after the spy
    const printed = vi.spyOn(console, 'error');
    solver = await PlaneGcsSolver.create();
    const before = heapBytes(solver);
    expect(before).toBeGreaterThan(0);
    // measured: a chain of 301 points solves (2026-10-30), one of 600 does not fit in the 16 MiB
    const fits = solver.solve(chain(250)); // 998 unknowns and equations, one part: solved whole
    expect(fits.status).toBe('under');
    expect(fits.dof).toBe(2);
    const big = chain(600);
    const r = solver.solve(big);
    expect(printed).not.toHaveBeenCalled();
    printed.mockRestore();
    expect(r.status).toBe('failed');
    expect(r.message).toBe(t('regen.sketchTooLarge', { size: 1200 + 2 * 599 }));
    // shown where it was stored, not as nothing
    expect(r.geometry.size).toBe(600);
    expect(point(r.geometry, 'q599')).toEqual([599 * 3, 0.01]);
    // the spare is in place at once: a solve in the same turn (a rebuild solves its sketches one after another) still solves
    expect(solver.available).toBe(true);
    const next = rectangles(150, 'origin');
    const after = solver.solve(next.sketch);
    expect(after.status).toBe('fully');
    expectTrue(next, after.geometry, 150);
    // a second one as large is refused before it is tried: the module in use is not given up as well
    expect(solver.solve(chain(700)).message).toBe(t('regen.sketchTooLarge', { size: 1400 + 2 * 699 }));
    expect(solver.solve(rectangles(10, 'origin').sketch).status).toBe('fully');
    await solver.ready();
    expect(heapBytes(solver)).toBeGreaterThan(0);
    expect(solver.solve(chain(250)).message).toBeUndefined();
  });
});
