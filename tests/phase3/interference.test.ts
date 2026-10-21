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
import { build, circle, extrude, front, rectangle, sketch } from '../phase1/builders';

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
  // ADR 0180: a 40 × 40 × 10 plate with a hole of radius 4 at the origin, a rod of radius 5 standing in it (their overlap a ring round the axis), and a bar
  // 1 mm wide across the hole (its overlap two pieces, one each side of the hole): both centres of mass are on the axis, in the hole
  shapes.holed = make(build(sketch('s', front, rectangle('r', -20, -20, 40, 40), circle('c', 0, 0, 4)), extrude('e', 's', 'boss', { type: 'blind', depth: '10' })));
  shapes.rod = make(build(sketch('s', front, circle('c', 0, 0, 5)), extrude('e', 's', 'boss', { type: 'blind', depth: '10' })));
  shapes.bar = make(build(sketch('s', front, rectangle('r', -0.5, -6, 1, 12)), extrude('e', 's', 'boss', { type: 'blind', depth: '10' })));
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

  it('where the overlap is (ADR 0180): its centre of mass and its box, against the block x 5..10, y 0..20, z 0..30 they share', () => {
    const before = kernel.liveShapes;
    const r = find([{ id: 'a', parts: [part('box', at(0))] }, { id: 'b', parts: [part('box', at(5))] }]);
    const o = r.overlaps[0]!;
    [7.5, 10, 15].forEach((v, k) => expect(Math.abs(o.center[k]! - v)).toBeLessThanOrEqual(1e-6));
    [5, 0, 0].forEach((v, k) => expect(Math.abs(o.min[k]! - v)).toBeLessThanOrEqual(1e-6));
    [10, 20, 30].forEach((v, k) => expect(Math.abs(o.max[k]! - v)).toBeLessThanOrEqual(1e-6));
    expect(Math.abs(o.volume - 3000) / 3000).toBeLessThanOrEqual(1e-9);
    // the centre is the one massProps gives the shape itself: one integration, not a second guess
    const m = kernel.massProps(o.shape);
    m.center.forEach((v, k) => expect(o.center[k]).toBeCloseTo(v, 9));
    release(r);
    expect(kernel.liveShapes).toBe(before);
  });

  it('a small overlap far from the origin, as the user reported (about 0.08 mm³): its centre and box all the same', () => {
    // 0.01 mm into each other over 20 × 30 is 6 mm³; up the z axis too, the overlap is x 9.99..10, z 29.6..30, all of y: 0.01 · 20 · 0.4 = 0.08 mm³
    const r = find([{ id: 'a', parts: [part('box', at(0, 0, 0))] }, { id: 'b', parts: [part('box', at(9.99, 0, 29.6))] }]);
    expect(r.overlaps).toHaveLength(1);
    const o = r.overlaps[0]!;
    expect(o.volume).toBeCloseTo(0.08, 9);
    [9.995, 10, 29.8].forEach((v, k) => expect(Math.abs(o.center[k]! - v)).toBeLessThanOrEqual(1e-6));
    [9.99, 0, 29.6].forEach((v, k) => expect(Math.abs(o.min[k]! - v)).toBeLessThanOrEqual(1e-6));
    [10, 20, 30].forEach((v, k) => expect(Math.abs(o.max[k]! - v)).toBeLessThanOrEqual(1e-6));
    release(r);
  });

  it('a ring round an axis (a rod of r 5 in a hole of r 4): its centre of mass is in the hole, so the ring\'s point is on the ring itself', () => {
    const before = kernel.liveShapes;
    const r = find([{ id: 'plate', parts: [part('holed', at(0))] }, { id: 'rod', parts: [part('rod', at(0))] }]);
    expect(r.overlaps).toHaveLength(1);
    const o = r.overlaps[0]!;
    expect(o.volume).toBeCloseTo(Math.PI * (25 - 16) * 10, 6);
    expect(o.regions).toHaveLength(1);
    const g = o.regions[0]!;
    // the branch is really taken: the centre of mass (on the axis) is not in the ring
    expect(Math.hypot(g.center[0], g.center[1])).toBeLessThan(1e-6);
    expect(kernel.classify(o.shape, [g.center])[0]).toBe('out');
    // the anchor is on the ring: in it or on its boundary, between r 4 and 5
    expect(kernel.classify(o.shape, [g.anchor], 1e-6)[0]).not.toBe('out');
    const radius = Math.hypot(g.anchor[0], g.anchor[1]);
    expect(radius).toBeGreaterThanOrEqual(4 - 1e-6);
    expect(radius).toBeLessThanOrEqual(5 + 1e-6);
    expect(Math.abs(g.volume - o.volume) / o.volume).toBeLessThanOrEqual(1e-9);
    release(r);
    expect(kernel.liveShapes).toBe(before);
  });

  it('a bar across the hole: two pieces apart, each with its own volume, box and a point on itself', () => {
    const before = kernel.liveShapes;
    const r = find([{ id: 'plate', parts: [part('holed', at(0))] }, { id: 'bar', parts: [part('bar', at(0))] }]);
    expect(r.overlaps).toHaveLength(1);
    const o = r.overlaps[0]!;
    expect(o.regions).toHaveLength(2);
    expect(Math.abs(o.regions.reduce((n, g) => n + g.volume, 0) - o.volume) / o.volume).toBeLessThanOrEqual(1e-9);
    // the whole overlap's centre of mass is on the axis, in the hole
    expect(kernel.classify(o.shape, [o.center])[0]).toBe('out');
    const sides = o.regions.map((g) => Math.sign(g.anchor[1])).sort();
    expect(sides).toEqual([-1, 1]); // one each side of the hole
    for (const g of o.regions) {
      expect(kernel.classify(o.shape, [g.anchor], 1e-6)[0]).not.toBe('out');
      // the anchor is in its own piece's box
      for (let k = 0; k < 3; k++) {
        expect(g.anchor[k]).toBeGreaterThanOrEqual(g.min[k]! - 1e-6);
        expect(g.anchor[k]).toBeLessThanOrEqual(g.max[k]! + 1e-6);
      }
      // a piece that holds its own centre has it as its anchor
      expect(Math.hypot(...g.anchor.map((v, k) => v - g.center[k]!))).toBeLessThan(1e-9);
    }
    release(r);
    expect(kernel.liveShapes).toBe(before);
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

describe('the parts inside a sub-assembly (compared with each other when asked)', () => {
  const leaf = (id: string, top: string, extra: Partial<Leaf> = {}): Leaf => ({ id, top, path: [], key: 'k', pose: at(0), hidden: false, transparent: false, ...extra });

  it('with parts, every leaf is a component of its own and still says which component of the assembly it is in', () => {
    const groups = interferenceGroups(
      [leaf('c1', 'c1'), leaf('c2/pa', 'c2', { path: ['pa'] }), leaf('c2/pb', 'c2', { path: ['pb'] }), leaf('c1@p1#2', 'c1', { instanceOf: 'p1' }), leaf('c2/pa@p2#1x2', 'c2', { path: ['pa'], instanceOf: 'p2' }), leaf('c1@m1', 'c1', { instanceOf: 'm1', mirrored: true })],
      { parts: true },
    );
    expect(groups.map((g) => g.id)).toEqual(['c1', 'c2/pa', 'c2/pb', 'c1@p1#2', 'c2/pa@p2#1x2', 'c1@m1']);
    expect(groups.map((g) => g.top)).toEqual(['c1', 'c2', 'c2', 'c1', 'c2', 'c1']);
    expect(groups.every((g) => g.leaves.length === 1)).toBe(true);
    expect(groups[3]!.instance).toEqual({ pattern: 'p1', label: '2' });
    expect(groups[5]!.instance).toEqual({ pattern: 'm1', label: null });
  });

  it('without parts nothing changed: a sub-assembly is one component', () => {
    const groups = interferenceGroups([leaf('c2/pa', 'c2', { path: ['pa'] }), leaf('c2/pb', 'c2', { path: ['pb'] })]);
    expect(groups.map((g) => g.id)).toEqual(['c2']);
  });

  it('two blocks of one sub-assembly that overlap by 5: not found as one component, found as two (5 × 20 × 30 = 3000), and the rest as before', () => {
    const sub = [part('box', at(0)), part('box', at(5))];
    expect(find([{ id: 'sub', parts: sub }, { id: 'far', parts: [part('box', at(100))] }]).overlaps).toHaveLength(0);
    const r = find([
      { id: 'sub/pa', parts: [sub[0]!] },
      { id: 'sub/pb', parts: [sub[1]!] },
      { id: 'far', parts: [part('box', at(100))] },
    ]);
    expect(r.overlaps.map((o) => [o.a, o.b])).toEqual([['sub/pa', 'sub/pb']]);
    expect(r.overlaps[0]!.volume).toBeCloseTo(3000, 6);
    release(r);
  });
});

describe('how long it takes (3b-5d)', () => {
  it('20 components of the locating plate in a row, each overlapping its neighbors: all of them found, within the time budget', () => {
    const faces = kernel.topology(shapes.plate!).faces.length;
    const components: InterferenceComponent[] = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, parts: [part('plate', at(i * 60))] }));
    // Alone it takes about 1.0 s of wall time (2.1 s of CPU time, the runtime's other threads count too); both triple when the whole suite runs in parallel.
    const started = process.cpuUsage();
    const r = find(components);
    const used = process.cpuUsage(started);
    const ms = (used.user + used.system) / 1000;
    const width = kernel.bounds(shapes.plate!).max[0]! - kernel.bounds(shapes.plate!).min[0]!;
    // each plate meets the next when the plate is wider than the step
    const expected = width > 60 + 1e-6 ? 19 : 0;
    expect(r.overlaps.length).toBeGreaterThanOrEqual(expected);
    console.log(`interference: 20 plates of ${faces} faces, plate ${width.toFixed(1)} mm wide, ${r.checked} pairs checked, ${r.overlaps.length} overlaps, ${ms.toFixed(0)} ms CPU`);
    // what keeps it fast is not asking the kernel about 190 pairs: only the neighbors' boxes meet (37 pairs), whatever the machine is doing
    expect(r.checked).toBeLessThanOrEqual(40);
    expect(ms).toBeLessThan(15000); // a sanity limit only; the time itself is read from a quiet run (about 1.0 s of wall time)
    release(r);
  });
});
