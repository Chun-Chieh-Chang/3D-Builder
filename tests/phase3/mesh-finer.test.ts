/**
 * Asking a shape for a finer mesh than it has (ADR 0242). BRepMesh works from the coarse one, and on a wavy spline face that took 54 s and 3312 MiB against 2.3 s and 265 MiB from nothing: what
 * a drawing or an STL asks of a part already on the screen. In a file of its own for the heap (AGENTS §3.5); the heap is measured by the only true path.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Kernel, type Frame, type Region } from '@3db/kernel';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await Kernel.load();
});
afterEach(() => vi.restoreAllMocks());

const XY: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const WAVE: [number, number][] = [[28.72, 28.97], [23.93, 39.88], [19.14, 30.38], [14.36, 30.19], [9.57, 15.18], [4.79, 36.5], [0, 31.22]];
const wavy = {
  outer: [
    { kind: 'line', a: [0, 0], b: [28.72, 0], source: 'a' },
    { kind: 'line', a: [28.72, 0], b: WAVE[0]!, source: 'b' },
    { kind: 'spline', points: WAVE, source: 'c' },
    { kind: 'line', a: WAVE[WAVE.length - 1]!, b: [0, 0], source: 'd' },
  ],
  holes: [],
} as unknown as Region;
const COARSE = { tolerance: 0.1, angular: 0.5 };
const FINE = { tolerance: 0.01, angular: 0.1 };
const make = () => kernel.extrude(XY, [wavy], [0, 0, 20]).shape;
const heap = () => (kernel.oc as never as { wasmMemory: { buffer: { byteLength: number } } }).wasmMemory.buffer.byteLength;
const triangles = (m: { indices: { length: number } }) => m.indices.length / 3;
const spyClean = () => vi.spyOn((kernel.oc as never as { BRepTools: { Clean: (...x: unknown[]) => unknown } }).BRepTools, 'Clean');

describe('a finer mesh than the shape has', () => {
  it('is the same mesh as asking for it first, at the same cost', () => {
    const h0 = heap();
    expect(h0).toBeGreaterThan(0);
    const direct = make();
    const fromNothing = kernel.mesh(direct, FINE);
    const refined = make();
    const coarse = kernel.mesh(refined, COARSE);
    const t0 = performance.now();
    const fine = kernel.mesh(refined, FINE);
    const ms = performance.now() - t0;
    const h1 = heap();
    console.log(`mesh: coarse ${triangles(coarse)}, direct ${triangles(fromNothing)}, refined ${triangles(fine)} in ${ms.toFixed(0)} ms; heap ${(h0 / 2 ** 20).toFixed(0)} -> ${(h1 / 2 ** 20).toFixed(0)} MiB`);
    // the control: the first really was coarser, or nothing was refined
    expect(triangles(coarse)).toBeLessThan(triangles(fromNothing));
    expect(triangles(fine)).toBe(triangles(fromNothing));
    expect(Array.from(fine.positions)).toEqual(Array.from(fromNothing.positions));
    // 3312 MiB without this
    expect(h1).toBeLessThan(1024 * 2 ** 20);
    kernel.release(direct);
    kernel.release(refined);
  }, 120_000);

  it('faces a boolean left alone keep their coarse mesh: a first mesh of the result starts over too', () => {
    const a = make();
    kernel.mesh(a, COARSE);
    const tool = kernel.extrude(XY, [{ outer: [{ kind: 'circle', c: [14, 5], r: 2, source: 'c' }], holes: [] } as Region], [0, 0, 20]).shape;
    const cut = kernel.boolean('cut', a, tool).shape;
    const clean = spyClean();
    const before = heap();
    const fine = kernel.mesh(cut, FINE);
    // the case really happened: there was a mesh on it already
    expect(clean).toHaveBeenCalledTimes(1);
    expect(heap() - before).toBeLessThan(1024 * 2 ** 20);
    expect(triangles(fine)).toBeGreaterThan(triangles(kernel.mesh(a, COARSE)));
    // and the original, whose mesh that took away, is meshed again when it is asked for
    expect(triangles(kernel.mesh(a, COARSE))).toBeGreaterThan(0);
    kernel.release(cut);
    kernel.release(tool);
    kernel.release(a);
  }, 120_000);
});

describe('anything else leaves the mesh alone', () => {
  it('a copy has no mesh to start over from', () => {
    const a = make();
    kernel.mesh(a, COARSE);
    const copy = kernel.transformed(a, [1, 0, 0, 5, 0, 1, 0, 0, 0, 0, 1, 0]);
    const clean = spyClean();
    expect(triangles(kernel.mesh(copy, FINE))).toBeGreaterThan(0);
    expect(clean).not.toHaveBeenCalled();
    kernel.release(copy);
    kernel.release(a);
  }, 120_000);

  it('the same fineness again, and a coarser one, do not start over', () => {
    const a = make();
    const clean = spyClean();
    const first = kernel.mesh(a, FINE);
    expect(triangles(kernel.mesh(a, FINE))).toBe(triangles(first));
    // the shape keeps the finest it has had: that is unchanged
    expect(triangles(kernel.mesh(a, COARSE))).toBe(triangles(first));
    // and the finest is what is remembered: the fine one again is what it already has
    expect(triangles(kernel.mesh(a, FINE))).toBe(triangles(first));
    expect(clean).not.toHaveBeenCalled();
    kernel.release(a);
  }, 120_000);

  it('the fineness each setting asks for is what the faces then say they have: a part is not meshed afresh every time', () => {
    const clean = spyClean();
    for (const options of [COARSE, FINE, {}, { relative: 1e-3 }]) {
      const a = make();
      kernel.mesh(a, options);
      kernel.mesh(a, options);
      kernel.release(a);
    }
    expect(clean).not.toHaveBeenCalled();
  }, 120_000);
});
