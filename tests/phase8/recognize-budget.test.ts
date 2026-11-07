/**
 * The limits of a recognition (handoff §0b item 2): asked between OCCT's calls, on by default, in any host. The heap is the real one, on a growth actually measured
 * (AGENTS §3.1, §3.2): the check is exercised at a size a test can reach, not on an invented figure.
 */
import { beforeAll, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, type PartDoc } from '@3db/model';
import { sha256Hex } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type Frame, type Region, type Segment, type ShapeId } from '@3db/kernel';
import { BudgetError, frameFor, recognize, reconstructImported, RECOGNIZE_LIMITS, Regenerator, startBudget } from '@3db/regen';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const heap = () => (kernel.oc as unknown as { wasmMemory: WebAssembly.Memory }).wasmMemory.buffer.byteLength;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const XY: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const rect = (w: number, h: number): Region => {
  const pts: [number, number][] = [[0, 0], [w, 0], [w, h], [0, h]];
  return { outer: pts.map((a, i) => ({ kind: 'line', a, b: pts[(i + 1) % 4]!, source: `e${i}` }) as Segment), holes: [] };
};

/** A plate with a hole through it, as an imported body. */
async function imported(): Promise<{ doc: PartDoc; shape: ShapeId; regen: Regenerator }> {
  const plate = kernel.extrude(XY, [rect(40, 30)], [0, 0, 10]).shape;
  const pin = kernel.extrude(XY, [{ outer: [{ kind: 'circle', c: [20, 15], r: 4, source: 'c' }], holes: [] }], [0, 0, 10]).shape;
  const shape = kernel.boolean('cut', plate, pin).shape;
  kernel.release(plate);
  kernel.release(pin);
  const bytes = new TextEncoder().encode(kernel.exportStep(shape, 'part'));
  const sha = await sha256Hex(bytes);
  const doc = applyCommand(createEmptyPart(), {
    type: 'importBody',
    blob: { id: 'blob1', sha256: sha, kind: 'step', fileName: 'part.step' },
    feature: { id: 'imp1', type: 'importedBody', name: '輸入1', suppressed: false, blob: 'blob1' },
    index: 0,
  });
  return { doc, shape, regen: new Regenerator(kernel, solver, new Map([[sha, bytes]])) };
}

it('refuses limits that are not positive and finite, rather than correcting them', () => {
  for (const bad of [0, -1, NaN, Infinity]) {
    expect(() => startBudget(kernel, { ms: bad, heapGrowth: 1 })).toThrow('positive and finite');
    expect(() => startBudget(kernel, { ms: 1, heapGrowth: bad })).toThrow('positive and finite');
  }
});

it('runs within the default limits, and stops on the time limit with the shapes it held given back', async () => {
  const { doc, shape, regen } = await imported();
  try {
    expect(reconstructImported(kernel, regen, doc, 'imp1', solver).report.features.hole).toBe(1);
    expect(RECOGNIZE_LIMITS.ms).toBeGreaterThan(0);
    const live = kernel.liveShapes;
    let caught: unknown;
    try {
      reconstructImported(kernel, regen, doc, 'imp1', solver, { ms: 1e-3, heapGrowth: RECOGNIZE_LIMITS.heapGrowth });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(BudgetError);
    expect((caught as BudgetError).reason).toBe('time');
    expect((caught as BudgetError).message).toMatch(/秒|\bs\b/);
    // what the regenerator holds is the last rebuild's, as after any other refusal
    expect(kernel.liveShapes).toBeLessThanOrEqual(live + 8);
  } finally {
    regen.dispose();
    kernel.release(shape);
  }
});

it('asks at every section of the recognition, so a run of them stops between two', async () => {
  const { shape, regen } = await imported();
  regen.dispose();
  let asked = 0;
  const counted = { check: () => void asked++ };
  recognize(kernel, shape, frameFor, counted);
  expect(asked).toBeGreaterThan(0);
  const seen = asked;
  // stopped at the last section it asked about: nothing after it runs, and the error is the budget's, not a refusal of the part
  let n = 0;
  expect(() =>
    recognize(kernel, shape, frameFor, {
      check: () => {
        if (++n === seen) throw new BudgetError('time', 'stop');
      },
    }),
  ).toThrow(BudgetError);
  expect(n).toBe(seen);
  kernel.release(shape);
});

it('stops on the real heap once it has really grown', () => {
  const start = heap();
  expect(start).toBeGreaterThan(0);
  const budget = startBudget(kernel, { ms: 3_600_000, heapGrowth: 1 });
  budget.check();
  // a boolean on a B-spline takes about 1.1 MiB of a heap that never gives back (AGENTS §3.5); the first ones are absorbed by what is free, so as many as it takes
  const spline = kernel.extrude(XY, [{ outer: [{ kind: 'spline', points: [[10, 0], [5, 9], [-6, 8], [-10, 0], [-5, -8], [6, -9]], closed: true, source: 's' } as Segment], holes: [] }], [0, 0, 5]).shape;
  const middle: Frame = { ...XY, origin: [0, 0, 2.5] };
  let caught: unknown;
  let rounds = 0;
  try {
    while (heap() === start) {
      expect(++rounds).toBeLessThan(5000);
      kernel.sectionEdges(spline, middle, { u0: -30, u1: 30, v0: -30, v1: 30 });
    }
    expect(heap()).toBeGreaterThan(start);
    budget.check();
  } catch (e) {
    caught = e;
  } finally {
    kernel.release(spline);
  }
  expect(caught).toBeInstanceOf(BudgetError);
  expect((caught as BudgetError).reason).toBe('memory');
});
