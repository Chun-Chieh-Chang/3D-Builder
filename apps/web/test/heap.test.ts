/**
 * A1b: the heap high-water policy that replaces the geometry worker.
 *
 * The gate must not be a dormant one (AGENTS.md §3.2): it is checked against the heap a *real* threaded part really grows, measured through the one true
 * path (AGENTS.md §3.1 — `wasmMemory.buffer.byteLength`, never a handle count), with the existence of the metric itself asserted first.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type Frame, type Region, type Segment, type ThreadSpec, type Vec3 } from '@3db/kernel';
import { HEAP_GROWTH_LIMIT, heapOf, shouldRestartHeap } from '../src/worker/heap';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await Kernel.load();
});

const M = 1048576;

const XZ: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 0, 1], normal: [0, -1, 0] };
const Z_AXIS = { origin: [0, 0, 0] as Vec3, dir: [0, 0, 1] as Vec3 };

type P = [number, number];
const area2 = (pts: P[]) => pts.reduce((s, [x0, y0], i) => { const [x1, y1] = pts[(i + 1) % pts.length]!; return s + x0 * y1 - x1 * y0; }, 0);
const region = (pts: P[], name = 'p'): Region => {
  const loop = area2(pts) > 0 ? pts : [...pts].reverse();
  return { outer: loop.map((a, i): Segment => ({ kind: 'line', a, b: loop[(i + 1) % loop.length]!, source: `${name}${i + 1}` })), holes: [] };
};

describe('the heap high-water policy (A1b)', () => {
  it('reads the Emscripten heap through its one true path, and never guesses a figure', () => {
    // ground-truth existence defence: the metric must exist and be a real size (AGENTS.md §3.1)
    expect(heapOf(kernel.oc)).toBeGreaterThan(0);
    // and it must not be fooled by anything that merely looks like a heap
    expect(heapOf(null)).toBeNull();
    expect(heapOf(undefined)).toBeNull();
    expect(heapOf({})).toBeNull();
    expect(heapOf({ wasmMemory: {} })).toBeNull();
    expect(heapOf({ wasmMemory: { buffer: {} } })).toBeNull();
    expect(heapOf({ wasmMemory: { buffer: { byteLength: 0 } } })).toBeNull();
    expect(heapOf({ wasmMemory: { buffer: { byteLength: Number.NaN } } })).toBeNull();
    expect(heapOf({ wasmMemory: { buffer: { byteLength: '134217728' } } })).toBeNull();
  });

  it('replaces a worker only past the limit, and never on a figure it cannot trust', () => {
    expect(shouldRestartHeap(100 * M, 50 * M, 40 * M)).toBe(true); // 50 MiB over a 40 MiB limit
    expect(shouldRestartHeap(90 * M, 50 * M, 40 * M)).toBe(false); // exactly at the limit is not past it
    expect(shouldRestartHeap(89 * M, 50 * M, 40 * M)).toBe(false); // under it
    // a worker that has not booted yet, or a baseline that is not a size: leave a healthy worker alone
    expect(shouldRestartHeap(null, 50 * M, 40 * M)).toBe(false);
    expect(shouldRestartHeap(100 * M, null, 40 * M)).toBe(false);
    expect(shouldRestartHeap(100 * M, 0, 40 * M)).toBe(false);
    expect(shouldRestartHeap(Number.NaN, 50 * M, 40 * M)).toBe(false);
    expect(shouldRestartHeap(100 * M, Number.NaN, 40 * M)).toBe(false);
    expect(shouldRestartHeap(100 * M, 50 * M, 0)).toBe(false);
    // the limit the app ships with is a real one, and far above one rebuild's leak
    expect(HEAP_GROWTH_LIMIT).toBeGreaterThan(64 * M);
  });

  it('fires on the heap a threaded part really grows, and not before it', () => {
    // A thread of four starts over six turns: what leaks is the sweep and the boolean that trims it to length, and one this size grows the heap past the
    // slack it starts with within five builds (measured: +283 MiB). A small single-start thread hides its first ten builds in that slack — measured at
    // +0.0 MiB after ten and +137.5 after twenty — which is why the figure the policy is decided on is taken from a thread big enough to show it.
    const spec: ThreadSpec = { axis: Z_AXIS, pitch: 2, starts: 4, hand: 'right', from: 0, to: 40 };
    const profile = region([[3, 4.5], [4, 4.75], [4, 5.25], [3, 5.5]]);

    const base = heapOf(kernel.oc);
    expect(base).toBeGreaterThan(0); // the figure the policy is measured from is real, not a stand-in for zero

    for (let i = 0; i < 5; i++) {
      const r = kernel.thread(XZ, [profile], spec);
      kernel.release(r.shape);
    }

    const grown = heapOf(kernel.oc);
    expect(grown).toBeGreaterThan(base!); // the leak is real, and this metric is the thing that sees it
    const delta = grown! - base!;
    expect(delta).toBeGreaterThan(64 * M); // five of them grew the heap by 283 MiB when measured: nowhere near a rounding error

    // the decision, on the figures actually measured: at the baseline the worker is kept, once the leak has grown it is replaced
    expect(shouldRestartHeap(grown, base, Math.floor(delta / 2))).toBe(true);
    expect(shouldRestartHeap(base, base, Math.floor(delta / 2))).toBe(false);
  });
});
