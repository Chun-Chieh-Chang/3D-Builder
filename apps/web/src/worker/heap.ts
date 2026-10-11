/**
 * How much the geometry kernel's heap has grown, and when to hand the work to a fresh worker (A1b).
 *
 * The Emscripten heap only ever grows: nothing gives a byte of it back to the system. Most of the kernel leaves it alone — a part of planes and cylinders
 * is built and rebuilt for hours without the figure moving at all — but a boolean whose operand carries B-spline faces (a swept thread or knurl, and the
 * cut that trims it to length) takes 2.5–8.3 MiB per call and never returns it (measured; AGENTS.md §3.5). `Kernel.thread` costs about 10.0 MiB a rebuild
 * and a helical `Kernel.knurl` about 11.6, so a threaded part edited a few dozen times runs the kernel out of room and the worker dies mid-rebuild.
 *
 * The leak is inside OCCT and cannot be closed from here. What can be done from here is to stop using a heap that has grown: the document lives on the
 * page, so the worker is replaceable, and `restartWorker` already exists for a rebuild that has run too long. This decides when.
 */

/** The only true measure of the Emscripten heap (AGENTS.md §3.1): `wasmMemory.buffer.byteLength`, not a handle count. `null` when it cannot be read. */
export function heapOf(oc: unknown): number | null {
  const bytes = (oc as { wasmMemory?: { buffer?: { byteLength?: number } } } | null | undefined)?.wasmMemory?.buffer?.byteLength;
  return typeof bytes === 'number' && Number.isFinite(bytes) && bytes > 0 ? bytes : null;
}

/**
 * How much the heap may grow past its size at boot before the worker is replaced. At the measured 10–12 MiB a rebuild of a threaded or knurled part that is
 * about forty rebuilds, and 128 MiB (the heap at boot) plus this is well inside what the module is built to grow to, so the kernel is never the thing that
 * runs out. Replacing the worker is not free — it reloads 43 MB of WASM and rebuilds the part — so it is deliberately not per-rebuild.
 */
export const HEAP_GROWTH_LIMIT = 512 * 1024 * 1024;

/**
 * Whether the heap has grown past `limit` since the worker booted. A figure that cannot be read, or a baseline that is not a real size, is never acted on:
 * the heap of a worker that has not booted yet is unknown, and guessing it would replace a healthy worker.
 *
 * `limit` is a parameter so that the decision can be exercised with the real measured heap at a size a test can reach (see `apps/web/test/heap.test.ts`).
 */
export function shouldRestartHeap(current: number | null, base: number | null, limit: number = HEAP_GROWTH_LIMIT): boolean {
  if (current === null || base === null) return false;
  if (!(Number.isFinite(current) && Number.isFinite(base) && base > 0 && limit > 0)) return false;
  return current - base > limit;
}
