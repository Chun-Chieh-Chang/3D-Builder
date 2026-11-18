/**
 * ADR 0258: the Emscripten heap over many calls of `Kernel.analyticFace` on the strip path, in a file of its own for a fresh heap (AGENTS.md §3.5).
 * Two faces: a fanned cone strip OCCT does not read (the rails read it; OCCT's converter is not called), and a twisted strip (a hyperboloid's) that
 * the rails refuse, so that OCCT's converter runs after them. 20 000 calls each, not a few hundred: a leak's first steps land in the heap's spare room
 * and read +0.0. The control is the same number of surface evaluations made the way that is known to keep heap (`EvalD1`, whose returned value stays:
 * AGENTS.md §3.5, 2026-11-10), so a measurement that could not see growth would fail it.
 */
import { expect, it } from 'vitest';
import { Kernel } from '../src';
import { stripFace, type StripSpec } from './analytic-face-strip.kit';

const CALLS = 20_000;
const D = Math.PI / 180;
const FANNED: StripSpec = { r0: 4.25, half: -Math.atan(0.575 / 37.75), height: 37.75, span: 4.946 * D, degree: 3, widen: 2.975 / 2.473 };
const TWISTED: StripSpec = { r0: 10, half: 20 * D, height: 5, span: 6 * D, degree: 3, twist: 2 * D };

async function grown(run: (kernel: Kernel) => void): Promise<{ grown: number; live: [number, number] }> {
  const kernel = await Kernel.load();
  const heap = () => (kernel.oc as unknown as { wasmMemory?: WebAssembly.Memory }).wasmMemory?.buffer?.byteLength ?? NaN;
  const initial = heap();
  expect(initial).toBeGreaterThan(0);
  const before = kernel.liveShapes;
  run(kernel);
  return { grown: (heap() - initial) / 2 ** 20, live: [before, kernel.liveShapes] };
}

it('does not grow the heap over 20 000 calls on each strip path; the control with the same evaluations does', async () => {
  const own = await grown((kernel) => {
    const fanned = stripFace(kernel, FANNED);
    const twisted = stripFace(kernel, TWISTED);
    // the premises: the first is read by the rails only, the second refused by them and by OCCT
    expect(fanned.occt(1e-4)).toBeNull();
    expect(kernel.analyticFace(fanned.shape, 0, 1e-4)?.geometry.type).toBe('cone');
    expect(kernel.analyticFace(twisted.shape, 0, 1e-6)).toBeNull();
    const live = kernel.liveShapes;
    for (let i = 0; i < CALLS; i++) {
      expect(kernel.analyticFace(fanned.shape, 0, 1e-4)?.geometry.type).toBe('cone');
      expect(kernel.analyticFace(twisted.shape, 0, 1e-6)).toBeNull();
    }
    expect(kernel.liveShapes).toBe(live);
    fanned.release();
    twisted.release();
  });
  const control = await grown((kernel) => {
    const made = stripFace(kernel, FANNED);
    const k = kernel as any;
    const oc = k.oc;
    const ex = new oc.TopExp_Explorer(k.get(made.shape), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    const ad = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(ex.Current()), true);
    // 13 × 13 (face) + 2 × 25 (rails) + 2 × 13 × 13 (two surfaces measured) evaluations a call, two calls a round, as above
    for (let i = 0; i < CALLS * 2 * 557; i++) ad.EvalD1(0.1, 0.1);
    made.release();
  });
  console.log(`analyticFace strip heap over ${CALLS} × 2 calls: +${own.grown.toFixed(1)} MiB; control (EvalD1): +${control.grown.toFixed(1)} MiB`);
  expect(own.live[1]).toBe(own.live[0]);
  // The heap grows in steps of 25.6 MiB and more, so "under one step" is none.
  expect(control.grown).toBeGreaterThan(64);
  expect(own.grown).toBeLessThan(25);
}, 600_000);
