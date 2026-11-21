/**
 * Curved-rim & intersecting cylindrical holes (push_turn P03/P05/P07/P09):
 * cross-holes entering/exiting curved surfaces and blind holes breaking into an internal bore.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart } from '@3db/model';
import { sha256Hex } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type Frame, type Region, type ShapeId } from '@3db/kernel';
import { reconstructImported, Regenerator } from '@3db/regen';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const XY: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const YZ: Frame = { origin: [0, 0, 0], xDir: [0, 1, 0], yDir: [0, 0, 1], normal: [1, 0, 0] };
const XZ: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 0, 1], normal: [0, -1, 0] };
const disc = (cx: number, cy: number, r: number): Region => ({ outer: [{ kind: 'circle', c: [cx, cy], r, source: 'c' }], holes: [] });
const rect = (x: number, y: number, w: number, h: number): Region => ({
  outer: [
    { kind: 'line', a: [x, y], b: [x + w, y], source: 'e0' },
    { kind: 'line', a: [x + w, y], b: [x + w, y + h], source: 'e1' },
    { kind: 'line', a: [x + w, y + h], b: [x, y + h], source: 'e2' },
    { kind: 'line', a: [x, y + h], b: [x, y], source: 'e3' },
  ],
  holes: [],
});

const made: ShapeId[] = [];
const keep = (id: ShapeId) => (made.push(id), id);
afterAll(() => {
  for (const id of made) kernel.release(id);
});

async function roundTrip(shape: ShapeId) {
  const bytes = new TextEncoder().encode(kernel.exportStep(shape, 'cross-hole'));
  const sha = await sha256Hex(bytes);
  const doc = applyCommand(createEmptyPart(), {
    type: 'importBody',
    blob: { id: 'b', sha256: sha, kind: 'step', fileName: 'part.step' },
    feature: { id: 'imp1', type: 'importedBody', name: 'imp1', suppressed: false, blob: 'b' },
    index: 0,
  });
  const regen = new Regenerator(kernel, solver, new Map([[sha, bytes]]));
  try {
    const out = reconstructImported(kernel, regen, doc, 'imp1', solver);
    expect(out.report.volumeError).toBeLessThan(1e-6);
    expect(out.report.areaError).toBeLessThan(1e-6);
    expect(out.report.difference).toBeLessThan(1e-6);
    const fresh = new Regenerator(kernel, solver, new Map());
    try {
      const r = fresh.rebuild(out.doc);
      expect(r.features.filter((f) => f.status !== 'ok')).toEqual([]);
      expect(r.body).toBeTruthy();
    } finally {
      fresh.dispose();
    }
    return out.report;
  } finally {
    regen.dispose();
  }
}

describe('curved-rim and intersecting cross-holes', () => {
  it('reconstructs a radial through cross-hole in a solid shaft (P03-style)', async () => {
    const shaft = keep(kernel.extrude(XY, [disc(0, 0, 16)], [0, 0, 80]).shape);
    const cross = keep(kernel.extrude({ ...YZ, origin: [-20, 0, 0] }, [disc(0, 40, 3)], [40, 0, 0]).shape);
    const part = keep(kernel.boolean('cut', shaft, cross).shape);
    const report = await roundTrip(part);
    expect(report.features.hole).toBe(1);
  });

  it('reconstructs a one-sided radial hole into an inner bore (P09-style)', async () => {
    const outer = keep(kernel.extrude({ ...YZ, origin: [-10, 0, 0] }, [{ outer: disc(0, 0, 12.5).outer, holes: [disc(0, 0, 6).outer] }], [20, 0, 0]).shape);
    const radial = keep(kernel.extrude({ ...XY, origin: [0, 0, 4] }, [disc(0, 0, 1.65)], [0, 0, 12]).shape);
    const part = keep(kernel.boolean('cut', outer, radial).shape);
    const report = await roundTrip(part);
    expect(report.features.hole).toBe(2);
  });

  it('reconstructs a block with a horizontal bore intersected by two vertical holes (P05-style)', async () => {
    const block = keep(kernel.extrude({ ...XY, origin: [0, 0, -25] }, [rect(-30, -15, 60, 30)], [0, 0, 50]).shape);
    const hBore = keep(kernel.extrude({ ...YZ, origin: [-35, 0, 0] }, [disc(0, 0, 10.5)], [70, 0, 0]).shape);
    const v1 = keep(kernel.extrude({ ...XY, origin: [0, 0, -26] }, [disc(-15, 0, 2.75)], [0, 0, 26]).shape);
    const v2 = keep(kernel.extrude({ ...XY, origin: [0, 0, -26] }, [disc(15, 0, 2.75)], [0, 0, 26]).shape);
    let part = keep(kernel.boolean('cut', block, hBore).shape);
    part = keep(kernel.boolean('cut', part, v1).shape);
    part = keep(kernel.boolean('cut', part, v2).shape);
    const report = await roundTrip(part);
    expect(report.features.hole).toBeGreaterThanOrEqual(2);
  });

  it('fuzzes 30 random cross-hole and bore-intersecting geometries without failure or heap runaway', async () => {
    const initialHeap = (kernel.oc as any).wasmMemory?.buffer?.byteLength;
    expect(initialHeap).toBeGreaterThan(0);

    let seed = 0x51a7c0de;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };

    for (let k = 0; k < 30; k++) {
      const rOuter = 12 + rand() * 10;
      const rInner = 4 + rand() * 3;
      const rCross = 1 + rand() * (rInner * 0.45);
      const len = 24 + rand() * 20;
      const mode = k % 3;
      let part: ShapeId;
      if (mode === 0) {
        const shaft = kernel.extrude(XY, [disc(0, 0, rOuter)], [0, 0, len]).shape;
        const cross = kernel.extrude({ ...YZ, origin: [-rOuter - 2, 0, 0] }, [disc(0, len * 0.5, rCross)], [2 * (rOuter + 2), 0, 0]).shape;
        part = kernel.boolean('cut', shaft, cross).shape;
        kernel.release(shaft);
        kernel.release(cross);
      } else if (mode === 1) {
        const tube = kernel.extrude({ ...YZ, origin: [-len / 2, 0, 0] }, [{ outer: disc(0, 0, rOuter).outer, holes: [disc(0, 0, rInner).outer] }], [len, 0, 0]).shape;
        const radial = kernel.extrude({ ...XY, origin: [0, 0, rInner * 0.6] }, [disc(0, 0, rCross)], [0, 0, rOuter + 2]).shape;
        part = kernel.boolean('cut', tube, radial).shape;
        kernel.release(tube);
        kernel.release(radial);
      } else {
        const w = 40 + rand() * 20;
        const h = 30 + rand() * 15;
        const block = kernel.extrude({ ...XY, origin: [0, 0, -h / 2] }, [rect(-w / 2, -h / 2, w, h)], [0, 0, h]).shape;
        const bore = kernel.extrude({ ...YZ, origin: [-w / 2 - 2, 0, 0] }, [disc(0, 0, rInner + 2)], [w + 4, 0, 0]).shape;
        const vHole = kernel.extrude({ ...XZ, origin: [0, 0, 0] }, [disc(0, 0, rCross)], [0, -h / 2 - 2, 0]).shape;
        const b1 = kernel.boolean('cut', block, bore).shape;
        part = kernel.boolean('cut', b1, vHole).shape;
        kernel.release(block);
        kernel.release(bore);
        kernel.release(vHole);
        kernel.release(b1);
      }
      try {
        await roundTrip(part);
      } finally {
        kernel.release(part);
      }
    }
    const finalHeap = (kernel.oc as any).wasmMemory?.buffer?.byteLength;
    expect(finalHeap).toBeLessThan(initialHeap + 128 * 1024 * 1024);
  });
});
