import { beforeAll, expect, it } from 'vitest';
import { setLocale } from '@3db/i18n';
import { sha256Hex } from '@3db/io';
import { Kernel, type Frame, type Region, type ShapeId } from '@3db/kernel';
import { applyCommand, createEmptyPart } from '@3db/model';
import { reconstructImported, RecognizeError, Regenerator } from '@3db/regen';
import { PlaneGcsSolver } from '@3db/sketch';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  setLocale('en');
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const XY: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const radians = (degrees: number) => degrees * Math.PI / 180;

function block(x: number, y: number, z: number, w: number, d: number, h: number, angle = 0): ShapeId {
  const points: [number, number][] = [[0, 0], [w, 0], [w, d], [0, d]];
  const region: Region = { outer: points.map((a, i) => ({ kind: 'line', a, b: points[(i + 1) % 4]!, source: `e${i}` })), holes: [] };
  return kernel.extrude({ ...XY, origin: [x, y, z] }, [region], [0, 0, h], 0, undefined, radians(angle)).shape;
}

async function withImported<T>(shape: ShapeId, run: (regen: Regenerator, doc: ReturnType<typeof createEmptyPart>) => T): Promise<T> {
  const bytes = new TextEncoder().encode(kernel.exportStep(shape, 'mixed-draft'));
  const sha = await sha256Hex(bytes);
  const doc = applyCommand(createEmptyPart(), {
    type: 'importBody', index: 0, blob: { id: 'blob1', sha256: sha, kind: 'step', fileName: 'mixed-draft.step' },
    feature: { id: 'imp1', type: 'importedBody', name: 'Mixed draft', suppressed: false, blob: 'blob1' },
  });
  const regen = new Regenerator(kernel, solver, new Map([[sha, bytes]]));
  try {
    return run(regen, doc);
  } finally {
    regen.dispose();
  }
}

function withBosses<T>(sourceArgs: [number, number, number, number, number], run: (source: ShapeId) => Promise<T>): Promise<T> {
  return withShapes(async (keep) => {
    const [angleA, angleB, height, width, depth] = sourceArgs;
    const base = keep(block(0, 0, 0, 60, 30, 4));
    const a = keep(block(5, 5, 4, width, depth, height, angleA));
    const b = keep(block(35, 6, 4, width + 2, depth - 1, height, angleB));
    const partial = keep(kernel.boolean('fuse', base, a).shape);
    const source = keep(kernel.boolean('fuse', partial, b).shape);
    expect(kernel.check(source).valid).toBe(true);
    expect(kernel.solidCount(source)).toBe(1);
    return run(source);
  });
}

async function withShapes<T>(run: (keep: (shape: ShapeId) => ShapeId) => Promise<T>): Promise<T> {
  const initial = kernel.liveShapes;
  const made: ShapeId[] = [];
  try {
    return await run((shape) => {
      made.push(shape);
      return shape;
    });
  } finally {
    for (const shape of made.reverse()) kernel.release(shape);
    expect(kernel.liveShapes).toBe(initial);
  }
}

it.each([[4, -9], [4, -4], [0, 9]])('reconstructs same-layer bosses drafted at %s and %s degrees', async (a, b) => {
  await withBosses([a, b, 8, 14, 16], (source) => withImported(source, (regen, doc) => {
    const sourceVolume = kernel.massProps(source).volume;
    const out = reconstructImported(kernel, regen, doc, 'imp1', solver);
    expect(out.report.volume).toBeCloseTo(sourceVolume, 6);
    const extrusions = out.doc.features.filter((f) => f.type === 'extrude');
    expect(extrusions).toHaveLength(3);
    const bosses = extrusions.filter((f) => f.dir1.type === 'blind' && f.dir1.depth === '8');
    expect(bosses.map((f) => f.draft1 ? (f.draft1.inward ? 1 : -1) * parseFloat(f.draft1.angle) : 0).sort()).toEqual([a, b].sort());
    const rebuilt = regen.rebuild(out.doc);
    expect(rebuilt.features.every((f) => f.status === 'ok')).toBe(true);
    expect(kernel.check(rebuilt.body!.shape).valid).toBe(true);
    expect(kernel.solidCount(rebuilt.body!.shape)).toBe(1);
    const shared = kernel.common(source, rebuilt.body!.shape, 0);
    if (shared.shape !== null) kernel.release(shared.shape);
    const actualVolume = kernel.massProps(rebuilt.body!.shape).volume;
    expect(Math.abs(sourceVolume + actualVolume - 2 * shared.volume) / sourceVolume).toBeLessThanOrEqual(1e-6);
  }));
});

it('refuses a connected mixed-wall layer and leaves the imported document intact', async () => {
  await withShapes(async (keep) => {
    const a = keep(block(0, 0, 0, 15, 16, 8, 4));
    const b = keep(block(10, 5, 0, 14, 6, 8));
    const source = keep(kernel.boolean('fuse', a, b).shape);
    expect(kernel.check(source).valid).toBe(true);
    expect(kernel.solidCount(source)).toBe(1);
    await withImported(source, (regen, doc) => {
      expect(() => reconstructImported(kernel, regen, doc, 'imp1', solver)).toThrow(
        new RecognizeError('The walls of one layer lean by different angles (4.00°, 0.00°); one extrusion has one draft'),
      );
      expect(doc.features.map((f) => f.type)).toEqual(['importedBody']);
      expect(regen.rebuild(doc).features[0]?.status).toBe('ok');
    });
  });
});

it('recovers arcs and an inner loop when splitting a mixed-draft layer', async () => {
  await withShapes(async (keep) => {
    const base = keep(block(0, 0, 0, 65, 40, 4));
    const region: Region = {
      outer: [
        { kind: 'line', a: [0, 0], b: [20, 0], source: 'a' },
        { kind: 'line', a: [20, 0], b: [20, 10], source: 'b' },
        { kind: 'arc', c: [10, 10], r: 10, from: [20, 10], to: [0, 10], ccw: true, source: 'c' },
        { kind: 'line', a: [0, 10], b: [0, 0], source: 'd' },
      ],
      holes: [[{ kind: 'circle', c: [10, 7], r: 3, source: 'h' }]],
    };
    const curved = keep(kernel.extrude({ ...XY, origin: [5, 5, 4] }, [region], [0, 0, 8], 0, undefined, radians(5)).shape);
    const square = keep(block(35, 5, 4, 15, 15, 8, -8));
    const partial = keep(kernel.boolean('fuse', base, curved).shape);
    const source = keep(kernel.boolean('fuse', partial, square).shape);
    expect(kernel.check(source).valid).toBe(true);
    await withImported(source, (regen, doc) => {
      const out = reconstructImported(kernel, regen, doc, 'imp1', solver);
      const boss = out.doc.features.find((f) => f.type === 'extrude' && f.draft1?.angle === '5deg');
      if (boss?.type !== 'extrude') throw new Error('Missing curved drafted boss');
      const sketch = out.doc.features.find((f) => f.id === boss.sketch);
      if (sketch?.type !== 'sketch') throw new Error('Missing curved boss sketch');
      expect(sketch.entities.filter((e) => e.type === 'arc' || e.type === 'circle').map((e) => e.type).sort()).toEqual(['arc', 'circle']);
      expect(out.report.difference).toBeLessThanOrEqual(1e-6);
      expect(out.report.features.hole).toBe(0);
    });
  });
});

it('rebuilds 100 seeded same-layer pairs and measures real WASM heap growth', async () => {
  const heap = () => (kernel.oc as unknown as { wasmMemory: { buffer: { byteLength: number } } }).wasmMemory.buffer.byteLength;
  const initial = heap();
  expect(initial).toBeGreaterThan(0);
  let seed = 20261108;
  const range = (min: number, max: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return min + (max - min) * (seed / 2 ** 32);
  };
  for (let i = 0; i < 100; i++) {
    const a = range(0.05, 15);
    const b = i % 2 === 0 ? range(-19, -0.05) : range(16, 29.95);
    const args = [a, b, range(2, 9), range(12, 16), range(13, 17)] as const;
    await withBosses([...args], (source) => withImported(source, (regen, doc) => {
      const out = reconstructImported(kernel, regen, doc, 'imp1');
      expect(out.report.features.extrude, `case ${i}`).toBe(3);
      expect(out.report.volumeError, `case ${i}`).toBeLessThanOrEqual(1e-6);
      expect(out.report.areaError, `case ${i}`).toBeLessThanOrEqual(1e-6);
      expect(out.report.difference, `case ${i}`).toBeLessThanOrEqual(1e-6);
    })).catch((cause: unknown) => { throw new Error(`Case ${i}: ${args.join(', ')}`, { cause }); });
  }
  const growth = heap() - initial;
  console.log(`Mixed draft fuzz: 100 successful STEP rebuilds, WASM heap grew ${(growth / 2 ** 20).toFixed(1)} MiB`);
  expect(growth).toBeLessThan(512 * 2 ** 20);
});
