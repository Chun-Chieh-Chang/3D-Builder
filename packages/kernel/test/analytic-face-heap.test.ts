/**
 * The Emscripten heap over many calls of `Kernel.analyticFace` (C4), in a file of its own for a fresh heap (AGENTS.md §3.5). 20 000 calls, not a few
 * hundred: a leak's first steps land in the heap's spare room and read +0.0. The control is the same number of surface evaluations made the way that
 * is known to keep heap (`EvalD1`, whose returned value stays: AGENTS.md §3.5, 2026-11-10), so a measurement that could not see growth would fail it.
 */
import { expect, it } from 'vitest';
import { Kernel } from '../src';

const CALLS = 20_000;
const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };

async function grown(run: (kernel: Kernel, shape: number, face: number) => void): Promise<number> {
  const kernel = await Kernel.load();
  const heap = () => (kernel.oc as unknown as { wasmMemory?: WebAssembly.Memory }).wasmMemory?.buffer?.byteLength ?? NaN;
  const initial = heap();
  expect(initial).toBeGreaterThan(0);
  const disc = kernel.extrude(XY as never, [{ outer: [{ kind: 'circle', c: [0, 0], r: 15, source: 'c' }], holes: [] }] as never, [0, 0, 8]).shape;
  const spline = kernel.toBSpline(disc);
  const face = kernel.topology(spline).faces.findIndex((f) => Math.abs(f.center[2] - 4) < 1e-3);
  expect(face).toBeGreaterThanOrEqual(0);
  run(kernel, spline as unknown as number, face);
  return (heap() - initial) / 2 ** 20;
}

it('does not grow the heap over 20 000 calls; the control with the same evaluations does', async () => {
  const own = await grown((kernel, shape, face) => {
    for (let i = 0; i < CALLS; i++) expect(kernel.analyticFace(shape as never, face, 1e-6)?.geometry.type).toBe('cylinder');
  });
  const control = await grown((kernel, shape) => {
    const oc = kernel.oc as any;
    const ex = new oc.TopExp_Explorer((kernel as unknown as { get(id: number): unknown }).get(shape), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    const ad = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(ex.Current()), true);
    // 13 × 13 evaluations a call, as analyticFace makes
    for (let i = 0; i < CALLS * 169; i++) ad.EvalD1(0.1, 0.1);
  });
  console.log(`analyticFace heap over ${CALLS} calls: +${own.toFixed(1)} MiB; control (EvalD1): +${control.toFixed(1)} MiB`);
  // Measured (2026-11-12): +0.0 MiB against +190.6 MiB for the control. The heap grows in steps of 25.6 MiB and more, so "under one step" is none.
  expect(control).toBeGreaterThan(64);
  expect(own).toBeLessThan(25);
}, 600_000);
