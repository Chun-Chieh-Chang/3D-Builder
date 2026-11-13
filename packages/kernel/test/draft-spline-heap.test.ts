/**
 * The Emscripten heap over drafted extrusions of a spline outline (ADR 0251), in a file of its own for a fresh heap (AGENTS §3.5). This program's own
 * duty is that every shape it makes is released: `liveShapes` is back where it was after 40 drafts. The heap is not claimed flat, and is printed:
 * measured (2026-11-14), the Boolean that splits the walls into cells (`BOPAlgo_MakerVolume`) holds heap per call whenever a wall is a B-spline —
 * 400 calls in isolation, 128 → 458.9 MiB, against 128 → 153.6 MiB for the same cells of planes — the OCCT-internal kind §3.5 records, which the
 * worker's high-water restart (ADR 0126) bounds. The control is the same outline extruded straight, which must not grow.
 */
import { expect, it } from 'vitest';
import { Kernel } from '../src';
import { OUTLINE } from './draft-spline.kit';

const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const DRAFTS = 40;

it('releases every shape it makes over 40 drafted extrusions; the heap is printed, with a straight control', async () => {
  const run = async (draft: number | undefined) => {
    const kernel = await Kernel.load();
    const heap = () => (kernel.oc as unknown as { wasmMemory?: WebAssembly.Memory }).wasmMemory?.buffer?.byteLength ?? NaN;
    const initial = heap();
    expect(initial).toBeGreaterThan(0);
    const live = kernel.liveShapes;
    for (let i = 0; i < DRAFTS; i++) kernel.release(kernel.extrude(XY as never, [{ outer: OUTLINE, holes: [] }] as never, [0, 0, 10], 0, undefined, draft).shape);
    expect(kernel.liveShapes).toBe(live);
    return (heap() - initial) / 2 ** 20;
  };
  const drafted = await run(-0.035);
  const straight = await run(undefined);
  console.log(`drafted spline extrusion heap over ${DRAFTS}: +${drafted.toFixed(1)} MiB; straight control: +${straight.toFixed(1)} MiB`);
  // the control does not grow: a growth of the drafted runs is the draft's, not the test's
  expect(straight).toBe(0);
}, 600_000);
