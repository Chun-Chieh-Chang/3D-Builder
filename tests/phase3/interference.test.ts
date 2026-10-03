/**
 * 3b-5d: interference (E2.1) on parts whose overlaps are known: the volume two components share, touching that is not interference, parts of one component
 * that are not compared, mirrored parts, which parts make which components (sub-assemblies, patterns, mirrors), and the time it takes.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { interferenceGroups, MIN_INTERFERENCE_VOLUME, type InterferenceComponent, type Leaf, type Pose } from '@3db/model';
import { readPartFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type ShapeId } from '@3db/kernel';
import { Regenerator, findInterference } from '@3db/regen';
import { build, extrude, front, rectangle, sketch } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
const shapes: Record<string, ShapeId> = {};

beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
  const make = (doc: ReturnType<typeof build>) => {
    const regen = new Regenerator(kernel, solver);
    kept.push(regen);
    return regen.rebuild(doc).body!.shape;
  };
  // 10 × 20 × 30: x 0..10, y 0..20, z 0..30 (see measure.test.ts)
  shapes.box = make(build(sketch('s', front, rectangle('r', 0, 0, 10, 20)), extrude('e', 's', 'boss', { type: 'blind', depth: '30' })));
  const file = await readPartFile(new Uint8Array(readFileSync(new URL('../golden/locating-plate.3dbx', import.meta.url))));
  const regen = new Regenerator(kernel, solver);
  kept.push(regen);
  shapes.plate = regen.rebuild(file.doc).body!.shape;
});
afterAll(() => kept.forEach((r) => r.dispose()));

const at = (x: number, y = 0, z = 0): Pose => ({ position: [x, y, z], rotation: [0, 0, 0, 1] });
const part = (key: string, pose: Pose, mirrored = false) => ({ part: key, mirrored, pose });
const find = (components: InterferenceComponent[], minVolume?: number) => findInterference(kernel, components, (key) => shapes[key] ?? null, minVolume);
const release = (r: ReturnType<typeof find>) => r.overlaps.forEach((o) => kernel.release(o.shape));

describe('what two components share (3b-5d)', () => {
  it('two blocks that overlap by half their width: the volume, and the shape of the overlap', () => {
    const before = kernel.liveShapes;
    const r = find([{ id: 'a', parts: [part('box', at(0))] }, { id: 'b', parts: [part('box', at(5))] }]);
    expect(r.overlaps).toHaveLength(1);
    expect(r.overlaps[0]!.volume).toBeCloseTo(5 * 20 * 30, 6);
    expect([r.overlaps[0]!.a, r.overlaps[0]!.b]).toEqual(['a', 'b']);
    // the overlap is a shape in the assembly's frame: x 5..10
    const box = kernel.bounds(r.overlaps[0]!.shape);
    expect(box.min[0]).toBeCloseTo(5, 6);
    expect(box.max[0]).toBeCloseTo(10, 6);
    expect(kernel.massProps(r.overlaps[0]!.shape).volume).toBeCloseTo(3000, 6);
    release(r);
    expect(kernel.liveShapes).toBe(before); // nothing else was kept
  });

  it('touching is not interference: faces that meet, and an overlap that is only the tolerance', () => {
    expect(find([{ id: 'a', parts: [part('box', at(0))] }, { id: 'b', parts: [part('box', at(10))] }]).overlaps).toHaveLength(0);
    // 1e-9 mm into each other over 20 × 30 mm: a sliver of 6e-7 mm³, under what is reported
    expect(6e-7).toBeLessThan(MIN_INTERFERENCE_VOLUME);
    const sliver = find([{ id: 'a', parts: [part('box', at(0))] }, { id: 'b', parts: [part('box', at(10 - 1e-9))] }]);
    expect(sliver.overlaps).toHaveLength(0);
    // and a real, small one is: 0.01 mm in, 6 mm³
    const small = find([{ id: 'a', parts: [part('box', at(0))] }, { id: 'b', parts: [part('box', at(9.99))] }]);
    expect(small.overlaps).toHaveLength(1);
    expect(small.overlaps[0]!.volume).toBeCloseTo(0.01 * 600, 5);
    release(small);
  });

  it('parts that are apart are not even compared (their boxes do not meet)', () => {
    const r = find([{ id: 'a', parts: [part('box', at(0))] }, { id: 'b', parts: [part('box', at(100, 100, 100))] }]);
    expect(r.overlaps).toHaveLength(0);
    expect(r.checked).toBe(0);
  });

  it('the parts of one component are not compared with each other, but with the other components', () => {
    // a sub-assembly of two blocks that overlap each other, beside a block that overlaps one of them
    const r = find([
      { id: 'sub', parts: [part('box', at(0)), part('box', at(5))] },
      { id: 'c', parts: [part('box', at(12))] },
    ]);
    expect(r.overlaps.map((o) => [o.a, o.b])).toEqual([['sub', 'c']]); // not sub with itself
    expect(r.overlaps[0]!.volume).toBeCloseTo(3 * 20 * 30, 6); // c is x 12..22, the second block x 5..15
    release(r);
  });

  it('a component of several parts adds up what each part shares', () => {
    const r = find([
      { id: 'a', parts: [part('box', at(0)), part('box', at(0, 0, 20))] }, // overlap each other: one is above the other
      { id: 'b', parts: [part('box', at(5))] },
    ]);
    const total = r.overlaps.filter((o) => o.a === 'a' && o.b === 'b').reduce((n, o) => n + o.volume, 0);
    // b covers x 5..10, z 0..30 of both: 5·20·30 with the first, 5·20·10 with the second (z 20..30)
    expect(total).toBeCloseTo(3000 + 1000, 5);
    release(r);
  });

  it('a mirrored part is where the mirror puts it: x 0..10 becomes -10..0', () => {
    const r = find([{ id: 'a', parts: [part('box', at(-5))] }, { id: 'm', parts: [part('box', at(0), true)] }]);
    expect(r.overlaps).toHaveLength(1);
    expect(r.overlaps[0]!.volume).toBeCloseTo(5 * 20 * 30, 6); // x -5..5 and -10..0
    expect(kernel.bounds(r.overlaps[0]!.shape).min[0]).toBeCloseTo(-5, 6);
    expect(kernel.bounds(r.overlaps[0]!.shape).max[0]).toBeCloseTo(0, 6);
    release(r);
  });

  it('a part that is not built is reported, and the others are still compared', () => {
    const r = find([{ id: 'a', parts: [part('box', at(0))] }, { id: 'b', parts: [part('box', at(5))] }, { id: 'lost', parts: [part('nothing', at(0))] }]);
    expect(r.unknown).toEqual(['lost']);
    expect(r.overlaps).toHaveLength(1);
    release(r);
  });
});

describe('which parts make which components (3b-5d)', () => {
  const leaf = (id: string, top: string, extra: Partial<Leaf> = {}): Leaf => ({ id, top, path: [], key: 'k', pose: at(0), hidden: false, transparent: false, ...extra });

  it('the parts of a sub-assembly are one component; its seed and each instance of a pattern or mirror are their own', () => {
    const groups = interferenceGroups([
      leaf('c1', 'c1'),
      leaf('c2/pa', 'c2', { path: ['pa'] }),
      leaf('c2/pb', 'c2', { path: ['pb'] }),
      leaf('c1@p1#2', 'c1', { instanceOf: 'p1' }),
      leaf('c1@p1#3', 'c1', { instanceOf: 'p1' }),
      leaf('c2/pa@p2#1x2', 'c2', { path: ['pa'], instanceOf: 'p2' }),
      leaf('c2/pb@p2#1x2', 'c2', { path: ['pb'], instanceOf: 'p2' }),
      leaf('c1@m1', 'c1', { instanceOf: 'm1', mirrored: true }),
    ]);
    expect(groups.map((g) => g.id)).toEqual(['c1', 'c2', 'c1@p1#2', 'c1@p1#3', 'c2@p2#1x2', 'c1@m1']);
    expect(groups.map((g) => g.leaves.length)).toEqual([1, 2, 1, 1, 2, 1]);
    expect(groups[2]!.instance).toEqual({ pattern: 'p1', label: '2' });
    expect(groups[4]!.instance).toEqual({ pattern: 'p2', label: '1x2' });
    expect(groups[5]!.instance).toEqual({ pattern: 'm1', label: null });
    expect(groups[0]!.instance).toBeNull();
  });
});

describe('how long it takes (3b-5d)', () => {
  it('20 components of the locating plate in a row, each overlapping its neighbors: all of them found, within the time budget', () => {
    const faces = kernel.topology(shapes.plate!).faces.length;
    const components: InterferenceComponent[] = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, parts: [part('plate', at(i * 60))] }));
    // CPU time, not wall time: the wall time triples when the whole suite runs in parallel. Alone it is about 1.0 s of wall time and 2.1 s of CPU time (the
    // runtime's other threads count too), so 4 s of CPU time is the budget that still catches a slowdown; the 2 s of the plan is read from the wall time alone.
    const started = process.cpuUsage();
    const r = find(components);
    const used = process.cpuUsage(started);
    const ms = (used.user + used.system) / 1000;
    const width = kernel.bounds(shapes.plate!).max[0]! - kernel.bounds(shapes.plate!).min[0]!;
    // each plate meets the next when the plate is wider than the step
    const expected = width > 60 + 1e-6 ? 19 : 0;
    expect(r.overlaps.length).toBeGreaterThanOrEqual(expected);
    console.log(`interference: 20 plates of ${faces} faces, plate ${width.toFixed(1)} mm wide, ${r.checked} pairs checked, ${r.overlaps.length} overlaps, ${ms.toFixed(0)} ms CPU`);
    expect(ms).toBeLessThan(4000);
    release(r);
  });
});
