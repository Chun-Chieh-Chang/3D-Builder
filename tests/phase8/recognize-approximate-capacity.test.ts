/**
 * Spline outlines approximated by many arcs and the sketch solver's capacity (nightly #189/#194/#198, 2026-11-13). C1 made the dimensioning of a
 * recognized sketch try all its candidates at once and halve: every smaller try aborted the solver again, and two aborts in one recognition left no
 * module, so even the extrusion could not be solved. Now the solver's heap is 32 MiB, the dimensioning never sends more than `SOLVER_SAFE_SIZE`, and
 * a sketch above it is refused before it is tried. What is checked here is that no try aborts the solver at all (its overflow mark stays unset and no
 * batch throws), not only that the recognition ends well. Each case on a solver of its own.
 */
import { describe, expect, it } from 'vitest';
import { t } from '@3db/i18n';
import { applyCommand, createEmptyPart, type PartDoc, type SketchFeature } from '@3db/model';
import { sha256Hex } from '@3db/io';
import { PlaneGcsSolver, sketchSystemSize, SOLVER_SAFE_SIZE } from '@3db/sketch';
import { Kernel, type Frame, type Region, type ShapeId } from '@3db/kernel';
import { reconstructImported, RecognizeError, Regenerator } from '@3db/regen';

const XY: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
type P = [number, number];
const ring = (k: number, A: number): Region =>
  ({ outer: [{ kind: 'spline', closed: true, points: Array.from({ length: 3 * k }, (_, i) => { const a = (2 * Math.PI * i) / (3 * k); const r = 25 + A * Math.cos(k * a); return [r * Math.cos(a), r * Math.sin(a)]; }), source: 'c' }], holes: [] }) as Region;

/** As in recognize-approximate: the top outline has one spline point moved 1e-8 mm, so the wall is no exact extrusion and the approximation is what rebuilds it. */
function near(kernel: Kernel, region: Region, h = 20): ShapeId {
  const nudged = region.outer.map((s) => (s.kind === 'spline' ? { ...s, points: s.points.map((p, i) => (i === 1 ? ([p[0], p[1] + 1e-8] as P) : p)) } : s));
  return kernel.loft([{ frame: XY, outer: region.outer }, { frame: { ...XY, origin: [0, 0, h] }, outer: nudged }]).shape;
}

/** A solver whose aborts are counted: every batch that throws for memory, and the overflow mark it keeps. */
async function watched() {
  const solver = await PlaneGcsSolver.create();
  const inner = solver as unknown as { runBatch: (b: unknown, into: unknown) => void; overflow: number };
  const run = inner.runBatch.bind(solver);
  const seen = { aborts: 0 };
  inner.runBatch = (b, into) => {
    try {
      run(b, into);
    } catch (e) {
      seen.aborts++;
      throw e;
    }
  };
  return { solver, seen, overflow: () => inner.overflow };
}

async function recognizeIt(kernel: Kernel, solver: PlaneGcsSolver, s: ShapeId) {
  const bytes = new TextEncoder().encode(kernel.exportStep(s, 'p'));
  const sha = await sha256Hex(bytes);
  const doc: PartDoc = applyCommand(createEmptyPart(), { type: 'importBody', blob: { id: 'blob1', sha256: sha, kind: 'step', fileName: 'f.step' }, feature: { id: 'imp1', type: 'importedBody', name: 'i', suppressed: false, blob: 'blob1' }, index: 0 });
  const regen = new Regenerator(kernel, solver, new Map([[sha, bytes]]));
  try {
    return { ...reconstructImported(kernel, regen, doc, 'imp1', solver, undefined, { approximateSplines: true }), regen };
  } catch (e) {
    regen.dispose();
    throw e;
  }
}

const S: P[] = [[28.72, 25], [21, 34], [14, 26], [7, 19], [0, 25]];
const open = (top: P[]): Region =>
  ({ outer: [{ kind: 'line', a: [0, 0], b: [28.72, 0], source: 'a' }, { kind: 'line', a: [28.72, 0], b: top[0]!, source: 'b' }, { kind: 'spline', points: top, source: 'c' }, { kind: 'line', a: top[top.length - 1]!, b: [0, 0], source: 'd' }], holes: [] }) as Region;

/** A solver whose `solve` is watched: the size of every sketch it is asked, and, past `limit`, the answer of a solver that cannot hold it. */
async function sized(limit = Infinity) {
  const solver = await PlaneGcsSolver.create();
  const sizes: number[] = [];
  let refused = 0;
  const solve = solver.solve.bind(solver);
  solver.solve = (sketch, options) => {
    const size = sketchSystemSize(sketch);
    sizes.push(size);
    if (size > limit) {
      refused++;
      return { geometry: new Map(), status: 'failed', dof: 0, conflicting: [], redundant: [], message: 'too large', tooLarge: true };
    }
    return solve(sketch, options);
  };
  return { solver, sizes, refused: () => refused };
}

describe('the dimensioning of a recognized sketch', () => {
  it('never asks the solver with more candidates than freedoms left: no system larger than the fully defined sketch (an S curve of 68 arcs)', async () => {
    const kernel = await Kernel.load();
    const { solver, sizes } = await sized();
    const { doc, regen } = await recognizeIt(kernel, solver, near(kernel, open(S)));
    try {
      const sketch = doc.features.find((f): f is SketchFeature => f.type === 'sketch')!;
      expect(sketch.entities.filter((e) => e.type === 'arc')).toHaveLength(68);
      const solved = solver.solve(sketch);
      expect(solved.status).toBe('fully');
      // C1's halving began with all 280 candidates at once (903 in this measure, the defined sketch being 762)
      expect(Math.max(...sizes)).toBe(sketchSystemSize(sketch));
    } finally {
      regen.dispose();
    }
  }, 300_000);

  it('a closed spline of 82 tangent arcs is fully defined in a handful of solves: the centres, which the ends and tangency already fix, come last', async () => {
    // Sharded CI #43549138821 (2026-11-14) timed out on recognize-approximate's "a closed spline" (> 60 s; 2.3 s before C1, 28.7 s in #202). The
    // candidates went point by point, each arc's centre between ends; the centres are redundant once the ends are dimensioned (tangent arcs), so
    // the halving fell to single candidates: 631 solves, 467 of them redundant. With the centres after the other points: 4 solves, measured.
    const kernel = await Kernel.load();
    const { solver, sizes } = await sized();
    const outline = ({ outer: [{ kind: 'spline', closed: true, points: Array.from({ length: 6 }, (_, i) => { const a = (2 * Math.PI * i) / 6; const r = 25 + 2 * Math.cos(2 * a); return [r * Math.cos(a), r * Math.sin(a)]; }), source: 'c' }], holes: [] }) as Region;
    const { doc, regen } = await recognizeIt(kernel, solver, near(kernel, outline));
    try {
      const sketch = doc.features.find((f): f is SketchFeature => f.type === 'sketch')!;
      expect(sketch.entities.filter((e) => e.type === 'arc')).toHaveLength(82);
      expect(solver.solve(sketch).status).toBe('fully');
      expect(sizes.length).toBeGreaterThan(0);
      expect(sizes.length).toBeLessThanOrEqual(10);
    } finally {
      regen.dispose();
    }
  }, 300_000);

  it('stops at the first system the solver cannot hold, and asks no smaller one after it (each would be an abort)', async () => {
    const kernel = await Kernel.load();
    // a solver that holds less than measured: any system past 700 comes back too large, as from an abort
    const { solver, sizes, refused } = await sized(700);
    const { doc, regen } = await recognizeIt(kernel, solver, near(kernel, open(S)));
    try {
      const sketch = doc.features.find((f): f is SketchFeature => f.type === 'sketch')!;
      expect(refused()).toBe(1);
      expect(sizes.filter((s) => s > 700)).toHaveLength(1);
      // what it kept before the stop moves nothing
      expect(sketchSystemSize(sketch)).toBeLessThanOrEqual(700);
      expect(solver.solve(sketch).status).toBe('under');
    } finally {
      regen.dispose();
    }
  }, 300_000);
});

describe('an outline of many arcs and the solver', () => {
  it('150 arcs: refused before the solver is tried, saying how large, and the solver never aborts', async () => {
    const kernel = await Kernel.load();
    const { solver, seen, overflow } = await watched();
    let error: unknown;
    try {
      await recognizeIt(kernel, solver, near(kernel, ring(5, 3)));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(RecognizeError);
    // the message gives the size, the arcs and the limit, in that order (both languages); the whole of it is then checked against the template
    const [size, arcs] = ((error as Error).message.match(/\d+/g) ?? []).map(Number);
    expect((error as Error).message).toBe(t('recognize.sketchTooLarge', { size: size!, arcs: arcs!, limit: SOLVER_SAFE_SIZE }));
    expect(arcs).toBe(150);
    expect(size).toBeGreaterThan(SOLVER_SAFE_SIZE);
    expect(seen.aborts).toBe(0);
    expect(overflow()).toBe(Infinity);
    expect(solver.available).toBe(true);
  }, 300_000);

  it('112 arcs: rebuilt with no abort; its sketch as defined as the solver allows, and every dimension the size the sketch has', async () => {
    const kernel = await Kernel.load();
    const { solver, seen, overflow } = await watched();
    const { doc, report, regen } = await recognizeIt(kernel, solver, near(kernel, ring(4, 2)));
    try {
      expect(report.approximation!.distance).toBeLessThanOrEqual(report.approximation!.bound);
      const sketch = doc.features.find((f): f is SketchFeature => f.type === 'sketch')!;
      expect(sketch.entities.filter((e) => e.type === 'arc')).toHaveLength(112);
      // within what the solver is sent, and nothing aborted on the way
      expect(sketchSystemSize(sketch)).toBeLessThanOrEqual(SOLVER_SAFE_SIZE);
      expect(seen.aborts).toBe(0);
      expect(overflow()).toBe(Infinity);
      // the dimensions it was given move nothing: solved, every point stays where it was drawn
      const solved = solver.solve(sketch);
      expect(solved.status).not.toBe('failed');
      expect(solved.status).not.toBe('over');
      for (const e of sketch.entities) {
        if (e.type !== 'point') continue;
        const g = solved.geometry.get(e.id);
        if (g?.type !== 'point') throw new Error(`${e.id} not solved`);
        expect(Math.hypot(g.p[0] - e.x, g.p[1] - e.y), e.id).toBeLessThan(1e-6);
      }
    } finally {
      regen.dispose();
    }
  }, 300_000);
});
