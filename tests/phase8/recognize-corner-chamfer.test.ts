/**
 * Feature recognition of a corner where three chamfers meet (a triangle that is no chamfer of its own), and of chamfers or rounds that come off alone but not together: those must stay in
 * the body, not leak a KernelError. From the assembly drawing sample, whose blocks have such corners. Against the solid made here, sent through STEP (AGENTS §2.1-4). In a file of its own
 * for the random boxes' heap (AGENTS §3.5).
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { applyCommand, createEmptyPart } from '@3db/model';
import { sha256Hex } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, KernelError, type Frame, type Region, type ShapeId } from '@3db/kernel';
import { reconstructImported, RecognizeError, Regenerator } from '@3db/regen';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});
afterEach(() => vi.restoreAllMocks());

const XY: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const rect = (w: number, d: number): Region => {
  const p: [number, number][] = [[0, 0], [w, 0], [w, d], [0, d]];
  return { outer: p.map((a, i) => ({ kind: 'line', a, b: p[(i + 1) % 4]!, source: `e${i}` })), holes: [] };
};
const box = (w: number, d: number, h: number) => kernel.extrude(XY, [rect(w, d)], [0, 0, h]).shape;

/** A chamfer of `size` on the edges of `shape` that `pick` takes. */
function chamfered(shape: ShapeId, size: number, pick: (mid: readonly number[]) => boolean): ShapeId {
  const edges = kernel.topology(shape).edges.flatMap((e, i) => (pick(e.mid) ? [{ edge: i, face: e.faces[0]! }] : []));
  expect(edges.length).toBeGreaterThan(0);
  return kernel.chamfer(shape, edges, 'distanceDistance', size, size).shape;
}

/** The triangles of a shape that are square to no axis: the corner pieces. */
const corners = (shape: ShapeId) => {
  const topo = kernel.topology(shape);
  return topo.faces.filter((f, i) => f.geometry?.type === 'plane' && topo.edges.filter((e) => e.faces.includes(i)).length === 3 && f.geometry.normal.every((v) => Math.abs(v) > 0.1)).length;
};

/** Through STEP and recognition: the symmetric difference of the rebuilt solid and this one, and the features it became. */
async function roundTrip(shape: ShapeId) {
  const bytes = new TextEncoder().encode(kernel.exportStep(shape, 'part'));
  const sha = await sha256Hex(bytes);
  const doc = applyCommand(createEmptyPart(), { type: 'importBody', blob: { id: 'blob1', sha256: sha, kind: 'step', fileName: 'f.step' }, index: 0, feature: { id: 'imp1', type: 'importedBody', name: 'i', suppressed: false, blob: 'blob1' } } as never);
  const regen = new Regenerator(kernel, solver, new Map([[sha, bytes]]));
  try {
    const out = reconstructImported(kernel, regen, doc, 'imp1', solver);
    const res = regen.rebuild(out.doc);
    expect(res.features.every((f) => f.status === 'ok')).toBe(true);
    const v0 = kernel.massProps(shape).volume;
    const v1 = kernel.massProps(res.body!.shape).volume;
    const shared = kernel.common(shape, res.body!.shape, 0);
    if (shared.shape !== null) kernel.release(shared.shape);
    return { difference: (v0 + v1 - 2 * shared.volume) / v0, types: out.doc.features.map((f) => f.type) };
  } finally {
    regen.dispose();
  }
}

describe('a corner where three chamfers meet', () => {
  it('comes off with them and is made again by them', async () => {
    const b = box(40, 30, 20);
    const s = chamfered(b, 2, (m) => (m[0] === 40 && m[1] === 30) || (m[1] === 30 && m[2] === 20) || (m[0] === 40 && m[2] === 20));
    // the control: this part really has the corner, or the rest proves nothing
    expect(corners(s)).toBe(1);
    const r = await roundTrip(s);
    expect(r.difference).toBeLessThan(1e-6);
    expect(r.types).toContain('chamfer');
    kernel.release(s);
    kernel.release(b);
  });

  it('eight corners: every edge of a box chamfered', async () => {
    const b = box(40, 30, 20);
    const s = chamfered(b, 1.5, () => true);
    expect(corners(s)).toBe(8);
    const r = await roundTrip(s);
    expect(r.difference).toBeLessThan(1e-6);
    expect(r.types).toContain('chamfer');
    kernel.release(s);
    kernel.release(b);
  });

  it('a triangle with something else beside it is no corner: a small flat cut across a corner stays in the outline or is refused, never lost', async () => {
    const b = box(40, 30, 20);
    const tool = kernel.extrude({ ...XY, origin: [36, 26, 0] }, [{ outer: [{ kind: 'line', a: [4, 0], b: [4, 4], source: 'a' }, { kind: 'line', a: [4, 4], b: [0, 4], source: 'b' }, { kind: 'line', a: [0, 4], b: [4, 0], source: 'c' }], holes: [] }], [0, 0, 20]).shape;
    const s = kernel.boolean('cut', b, tool).shape;
    try {
      const r = await roundTrip(s);
      expect(r.difference).toBeLessThan(1e-6);
    } catch (e) {
      expect(e).toBeInstanceOf(RecognizeError);
    }
    kernel.release(s);
    kernel.release(tool);
    kernel.release(b);
  });

  it('100 random boxes with a chamfered corner: every one rebuilt the same, nothing crashes, the heap measured', async () => {
    const heap = () => (kernel.oc as never as { wasmMemory: { buffer: { byteLength: number } } }).wasmMemory.buffer.byteLength;
    const h0 = heap();
    expect(h0).toBeGreaterThan(0);
    let seed = 20261107;
    const rnd = (a: number, b: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return Math.round((a + (seed / 0x7fffffff) * (b - a)) * 100) / 100;
    };
    const refused: string[] = [];
    for (let i = 0; i < 100; i++) {
      const [w, d, h] = [rnd(20, 80), rnd(20, 80), rnd(10, 40)];
      const size = rnd(0.5, Math.min(w, d, h) / 4);
      const b = box(w, d, h);
      const s = chamfered(b, size, (m) => (m[0] === w && m[1] === d) || (m[1] === d && m[2] === h) || (m[0] === w && m[2] === h));
      try {
        expect(corners(s), `case ${i}`).toBe(1);
        const r = await roundTrip(s);
        expect(r.difference, `case ${i}`).toBeLessThan(1e-6);
      } catch (e) {
        if (!(e instanceof RecognizeError)) throw e;
        refused.push(`${i}: ${e.message}`);
      } finally {
        kernel.release(s);
        kernel.release(b);
      }
    }
    console.log(`corner chamfers: heap ${(h0 / 2 ** 20).toFixed(1)} -> ${(heap() / 2 ** 20).toFixed(1)} MiB; refused ${refused.length}`);
    // every one of these parts is made of a feature recognized, so refusing one is a defect, not a safe answer
    expect(refused).toEqual([]);
  }, 300_000);
});

describe('blends that come off alone but not together', () => {
  it('stay in the body instead of leaking the kernel error, and leave no shape behind', async () => {
    const b = box(40, 30, 20);
    const edge = (x: number, y: number) => kernel.topology(b).edges.findIndex((e) => e.mid[0] === x && e.mid[1] === y);
    const s = kernel.fillet(b, [edge(40, 30), edge(0, 0)], 3).shape;
    const real = kernel.deleteFaces.bind(kernel);
    const sets: number[] = [];
    vi.spyOn(kernel, 'deleteFaces').mockImplementation((target, faces) => {
      sets.push(faces.length);
      if (faces.length > 1) throw new KernelError('not together');
      return real(target, faces);
    });
    const live = kernel.liveShapes;
    let answered = false;
    try {
      const r = await roundTrip(s);
      expect(r.difference).toBeLessThan(1e-6);
      answered = true;
    } catch (e) {
      expect(e).toBeInstanceOf(RecognizeError);
      answered = true;
    }
    expect(answered).toBe(true);
    // the case really happened: both together was tried, and refused
    expect(sets.some((n) => n > 1)).toBe(true);
    expect(sets.some((n) => n === 1)).toBe(true);
    expect(kernel.liveShapes).toBe(live);
    kernel.release(s);
    kernel.release(b);
  }, 60_000);

  it('as many as still come off together do, each step letting go of the one before', async () => {
    const b = box(40, 30, 20);
    const edge = (x: number, y: number) => kernel.topology(b).edges.findIndex((e) => e.mid[0] === x && e.mid[1] === y);
    const s = kernel.fillet(b, [edge(40, 30), edge(0, 0), edge(40, 0)], 3).shape;
    const real = kernel.deleteFaces.bind(kernel);
    const tried: number[] = [];
    vi.spyOn(kernel, 'deleteFaces').mockImplementation((target, faces) => {
      tried.push(faces.length);
      if (faces.length > 2) throw new KernelError('not all three');
      return real(target, faces);
    });
    const live = kernel.liveShapes;
    try {
      const r = await roundTrip(s);
      expect(r.difference).toBeLessThan(1e-6);
    } catch (e) {
      expect(e).toBeInstanceOf(RecognizeError);
    }
    // all three, refused; then one, then two, then all three again
    expect(tried.slice(0, 4)).toEqual([3, 1, 2, 3]);
    expect(kernel.liveShapes).toBe(live);
    kernel.release(s);
    kernel.release(b);
  }, 60_000);
});
