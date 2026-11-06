/**
 * Feature recognition (F2.4), random parts (AGENTS §3.4): 120 plates of random size, each with a random hole (through, blind, counterbore), a random
 * round on a vertical edge and a random chamfer on a top edge, made with the kernel, sent through STEP and recognized. Every part must either be refused
 * with a RecognizeError or come back the same solid, checked here against the solid made here: no crash, no wrong acceptance. In a file of its own so
 * that it gets a fresh Emscripten heap (AGENTS §3.5); the heap is read only through `wasmMemory.buffer.byteLength`, and its growth is printed, not
 * claimed to be zero.
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { applyCommand, createEmptyPart } from '@3db/model';
import { sha256Hex } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type Frame, type Region, type ShapeId } from '@3db/kernel';
import { reconstructImported, RecognizeError, Regenerator } from '@3db/regen';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});
afterAll(() => undefined);

const heap = () => (kernel.oc as unknown as { wasmMemory?: { buffer?: { byteLength?: number } } }).wasmMemory?.buffer?.byteLength;
const XY: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const at = (z: number): Frame => ({ ...XY, origin: [0, 0, z] });
const rect = (x: number, y: number, w: number, h: number): Region => {
  const p: [number, number][] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  return { outer: p.map((a, i) => ({ kind: 'line', a, b: p[(i + 1) % 4]!, source: `e${i}` })), holes: [] };
};
const disc = (r: number): Region => ({ outer: [{ kind: 'circle', c: [0, 0], r, source: 'c' }], holes: [] });

/** A small deterministic generator (mulberry32), so that a failure can be run again by its seed. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

it('120 random plates: each refused or rebuilt the same, nothing crashes', async () => {
  const h0 = heap();
  expect(h0).toBeGreaterThan(0);
  let rebuilt = 0;
  let refused = 0;
  const refusals: string[] = [];
  for (let seed = 1; seed <= 120; seed++) {
    const r = rng(seed);
    const round = (v: number) => Math.round(v * 100) / 100;
    const w = round(30 + r() * 50);
    const d = round(20 + r() * 40);
    const t = round(6 + r() * 14);
    const hr = round(1.5 + r() * Math.min(w, d) * 0.12);
    const kind = Math.floor(r() * 3);
    const fr = round(0.5 + r() * Math.min(w, d) * 0.15);
    const cr = round(0.3 + r() * Math.min(t, d) * 0.2);
    const made: ShapeId[] = [];
    const own = (id: ShapeId) => (made.push(id), id);
    try {
      let s = own(kernel.extrude(XY, [rect(-w / 2, -d / 2, w, d)], [0, 0, t]).shape);
      // the hole, square to the top, at the middle
      if (kind === 0) s = own(kernel.boolean('cut', s, own(kernel.extrude(at(-1), [disc(hr)], [0, 0, t + 2]).shape)).shape);
      else if (kind === 1) s = own(kernel.boolean('cut', s, own(kernel.extrude(at(t * 0.4), [disc(hr)], [0, 0, t]).shape)).shape);
      else {
        s = own(kernel.boolean('cut', s, own(kernel.extrude(at(t * 0.6), [disc(hr * 1.8)], [0, 0, t]).shape)).shape);
        s = own(kernel.boolean('cut', s, own(kernel.extrude(at(-1), [disc(hr)], [0, 0, t + 2]).shape)).shape);
      }
      const topo = kernel.topology(s);
      const vertical = topo.edges.findIndex((e) => e.dir && Math.abs(e.dir[2]) > 0.99 && Math.abs(e.mid[0] - w / 2) < 1e-6 && Math.abs(e.mid[1] - d / 2) < 1e-6);
      s = own(kernel.fillet(s, [vertical], fr).shape);
      const t2 = kernel.topology(s);
      const top = t2.edges.findIndex((e) => e.dir && Math.abs(e.dir[0]) > 0.99 && Math.abs(e.mid[1] + d / 2) < 1e-6 && Math.abs(e.mid[2] - t) < 1e-6);
      const frontFace = t2.faces.findIndex((f) => f.normal && f.normal[1] < -0.99);
      s = own(kernel.chamfer(s, [{ edge: top, face: frontFace }], 'distanceDistance', cr, round(cr * (0.5 + r())) ).shape);
      const bytes = new TextEncoder().encode(kernel.exportStep(s, `fuzz-${seed}`));
      const sha = await sha256Hex(bytes);
      const doc = applyCommand(createEmptyPart(), { type: 'importBody', blob: { id: 'blob1', sha256: sha, kind: 'step', fileName: 'f.step' }, feature: { id: 'imp1', type: 'importedBody', name: 'i', suppressed: false, blob: 'blob1' }, index: 0 });
      const regen = new Regenerator(kernel, solver, new Map([[sha, bytes]]));
      try {
        let out;
        try {
          out = reconstructImported(kernel, regen, doc, 'imp1', solver);
        } catch (e) {
          if (!(e instanceof RecognizeError)) throw new Error(`seed ${seed}: ${(e as Error).message}`);
          refused++;
          refusals.push(`${seed}: ${e.message}`);
          continue;
        }
        const res = regen.rebuild(out.doc);
        expect(res.features.every((f) => f.status === 'ok'), `seed ${seed}`).toBe(true);
        expect(res.features.filter((f) => f.sketch && f.sketch.dof !== 0).map((f) => f.id), `seed ${seed}`).toEqual([]);
        const v0 = kernel.massProps(s).volume;
        const v1 = kernel.massProps(res.body!.shape).volume;
        const shared = kernel.common(s, res.body!.shape, 0);
        if (shared.shape !== null) kernel.release(shared.shape);
        expect((v0 + v1 - 2 * shared.volume) / v0, `seed ${seed}`).toBeLessThan(1e-6);
        expect(out.doc.features.filter((f) => f.type === 'hole'), `seed ${seed}`).toHaveLength(1);
        expect(out.doc.features.filter((f) => f.type === 'fillet'), `seed ${seed}`).toHaveLength(1);
        rebuilt++;
      } finally {
        regen.dispose();
      }
    } finally {
      for (const id of made) kernel.release(id);
    }
  }
  const h1 = heap()!;
  console.log(`feature recognition fuzz: ${rebuilt} rebuilt, ${refused} refused; heap ${(h0! / 2 ** 20).toFixed(1)} → ${(h1 / 2 ** 20).toFixed(1)} MiB`);
  if (refusals.length) console.log(refusals.join('\n'));
  expect(rebuilt + refused).toBe(120);
  // every one of these parts is made of the features recognized, so refusing one is a defect, not a safe answer
  expect(refused).toBe(0);
}, 600_000);
