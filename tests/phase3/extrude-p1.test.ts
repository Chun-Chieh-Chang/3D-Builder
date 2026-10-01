/**
 * Phase 3a-5a (C4.1, C4.2): more end conditions (up to the next face, a vertex, a body, an offset from a face), a second direction, and a
 * draft of the walls. Every volume is worked out by hand, and the names stay the ones a plain extrusion would have (ADR 0027).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, type Feature, type PartDoc, type PlaneDefinition, type Ref } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type Frame, type Region } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { build, extrude, face, front, rectangle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const rebuild = (doc: PartDoc) => new Regenerator(kernel, solver, new Map()).rebuild(doc);
const failures = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));
const volume = (r: RebuildResult) => r.bodies.reduce((v, b) => v + kernel.massProps(b.shape).volume, 0);
const rad = (deg: number) => (deg * Math.PI) / 180;

// ---------------------------------------------------------------- at the kernel

const frameAt = (z: number): Frame => ({ origin: [0, 0, z], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] });
const rect = (x: number, y: number, w: number, h: number, id = 'r'): Region => {
  const c: [number, number][] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  return { outer: c.map((a, i) => ({ kind: 'line' as const, a, b: c[(i + 1) % 4]!, source: `${id}${i}` })), holes: [] };
};
const vol = (id: number) => kernel.massProps(id as never).volume;

describe('a sweep in the kernel (C4.1)', () => {
  it('leans its walls: outward grows as the cross-section (W + 2zt)(D + 2zt) integrated, inward shrinks, and both are valid', () => {
    const t = Math.tan(rad(3));
    const [W, D, H] = [20, 10, 10];
    const out = kernel.extrude(frameAt(0), [rect(0, 0, W, D)], [0, 0, H], 0, undefined, -rad(3));
    const inn = kernel.extrude(frameAt(0), [rect(0, 0, W, D)], [0, 0, H], 0, undefined, rad(3));
    expect(vol(out.shape)).toBeCloseTo(W * D * H + (W + D) * t * H * H + (4 / 3) * t * t * H ** 3, 6);
    expect(vol(inn.shape)).toBeCloseTo(W * D * H - (W + D) * t * H * H + (4 / 3) * t * t * H ** 3, 6);
    expect(kernel.isValid(out.shape)).toBe(true);
    expect(out.faceOrigins).toHaveLength(6);
    expect(out.faceOrigins.filter((o) => o.some((x) => x.rel === 'generated' && x.kind === 'profileEdge'))).toHaveLength(4);
  });

  it('finds the first face in the way, in either direction, and none when nothing is there', () => {
    const plate = (z0: number, z1: number) => kernel.extrude(frameAt(z0), [rect(0, 0, 40, 30)], [0, 0, z1 - z0]).shape;
    const body = kernel.join([plate(10, 15), plate(20, 25)]);
    const small = [rect(5, 5, 10, 10)];
    const at = (index: number | null) => (index === null ? null : kernel.topology(body).faces[index]!.center[2]);
    expect(at(kernel.nextFace(body, frameAt(0), small, [0, 0, 30]))).toBeCloseTo(10, 6); // the near plate's underside, not the far one's
    expect(at(kernel.nextFace(body, frameAt(30), small, [0, 0, -30]))).toBeCloseTo(25, 6);
    expect(kernel.nextFace(body, frameAt(30), small, [0, 0, 30])).toBeNull();
    expect(kernel.nextFace(body, frameAt(17), small, [0, 0, 30])).not.toBeNull(); // from between the plates: the far one
    expect(at(kernel.nextFace(body, frameAt(17), small, [0, 0, 30]))).toBeCloseTo(20, 6);
  });

  it('ends on the surface of a body: only the piece between the sketch and the body is kept', () => {
    const farPlate = kernel.extrude(frameAt(20), [rect(0, 0, 40, 30)], [0, 0, 5]).shape;
    const r = kernel.extrude(frameAt(0), [rect(5, 5, 10, 10)], [0, 0, 40], 0, { body: farPlate });
    expect(vol(r.shape)).toBeCloseTo(10 * 10 * 20, 6);
    expect(r.faceOrigins.filter((o) => o.some((x) => x.rel === 'cap' && x.which === 'end'))).toHaveLength(1);
    expect(() => kernel.extrude(frameAt(30), [rect(5, 5, 10, 10)], [0, 0, 40], 0, { body: farPlate })).toThrow('沒有碰到');
  });

  it('two directions fuse into one body with the shared plane gone, 6 faces, the far caps named for their own ends', () => {
    const r = kernel.extrudeBoth(frameAt(0), [rect(0, 0, 20, 10)], { vector: [0, 0, 10] }, { vector: [0, 0, -4] });
    expect(vol(r.shape)).toBeCloseTo(20 * 10 * 14, 6);
    expect(kernel.topology(r.shape).faces).toHaveLength(6);
    const caps = r.faceOrigins.flatMap((o) => o.filter((x) => x.rel === 'cap').map((x) => (x as { which: string }).which));
    expect(caps.sort()).toEqual(['end', 'start']);
    expect(kernel.isValid(r.shape)).toBe(true);
  });
});

// ---------------------------------------------------------------- through the features

const offsetPlane = (id: string, distance: string): Feature => ({ id, type: 'refPlane', name: id, suppressed: false, def: { mode: 'offset', plane: front, distance } satisfies PlaneDefinition });
const on = (id: string): Ref => ({ kind: 'datum', name: id });
/** Two blocks apart along z: A 20 × 10 from z = 0 to 10, B 20 × 10 from 20 to 25. */
const twoBlocks = (): Feature[] => [
  sketch('sa', front, rectangle('a', 0, 0, 20, 10)),
  extrude('ea', 'sa', 'boss', { type: 'blind', depth: '10' }),
  offsetPlane('pb', '20'),
  sketch('sb', on('pb'), rectangle('b', 0, 0, 20, 10)),
  extrude('eb', 'sb', 'boss', { type: 'blind', depth: '5' }),
  offsetPlane('pc', '12'),
  sketch('sc', on('pc'), rectangle('c', 5, 2, 4, 4)),
];
const withEnd = (dir1: Extract<Feature, { type: 'extrude' }>['dir1'], extra: Partial<Feature> = {}): PartDoc => build(...twoBlocks(), { ...extrude('ec', 'sc', 'boss', dir1), ...extra } as Feature);

describe('more end conditions (C4.1)', () => {
  it('up to the next face: from z = 12 to the underside of B at 20, joining B: 2000 + 1000 + 4 × 4 × 8', () => {
    const r = rebuild(withEnd({ type: 'upToNext' }));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(3000 + 128, 6);
    expect(r.bodies).toHaveLength(2);
  });

  it('up to a body gives the same, and says so when the body is behind', () => {
    const r = rebuild(withEnd({ type: 'upToBody', body: { kind: 'body', name: 'eb' } }));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(3128, 6);
    const behind = rebuild(withEnd({ type: 'upToBody', body: { kind: 'body', name: 'ea' } }));
    expect(failures(behind)[0]).toContain('沒有本體'); // A lies wholly behind the sketch
    const none = rebuild(withEnd({ type: 'upToBody', body: { kind: 'body', name: 'nowhere' } }));
    expect(failures(none)[0]).toContain('遺失參考');
  });

  it('up to a vertex: the depth is how far the vertex is from the sketch plane (8 to the corner of B at z = 20)', () => {
    const r0 = rebuild(build(...twoBlocks()));
    const i = r0.body!.topology.vertices.findIndex((v) => Math.abs(v.point[2] - 20) < 1e-9);
    const vertex: Ref = { kind: 'vertex', name: r0.body!.names.vertices[i]! };
    const r = rebuild(withEnd({ type: 'upToVertex', vertex }));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(3128, 6);
    const behind = rebuild(withEnd({ type: 'upToVertex', vertex, reverse: true }));
    expect(failures(behind)[0]).toContain('另一側');
  });

  it('offset from a face: short of B\'s underside by 3 it hangs in the air (a body of its own), beyond it by 3 it joins B', () => {
    const short = rebuild(withEnd({ type: 'offsetFromFace', face: face('eb:cap:start'), offset: '3' }));
    expect(failures(short)).toEqual([]);
    expect(volume(short)).toBeCloseTo(3000 + 16 * 5, 6);
    expect(short.bodies).toHaveLength(3);
    const beyond = rebuild(withEnd({ type: 'offsetFromFace', face: face('eb:cap:start'), offset: '3', beyond: true }));
    expect(volume(beyond)).toBeCloseTo(3000 + 16 * 8, 6); // 11 deep, of which 3 are inside B
    expect(failures(rebuild(withEnd({ type: 'offsetFromFace', face: face('eb:cap:start'), offset: '9' })))[0]).toContain('另一側');
    expect(failures(rebuild(withEnd({ type: 'offsetFromFace', face: face('ea:side:sa.al0'), offset: '1' })))[0]).toContain('平行');
  });

  it('through all, up to a face and up to the next face end on the same face of a block in the way', () => {
    const base = [...twoBlocks()];
    const wall = (end: Extract<Feature, { type: 'extrude' }>['dir1']) => rebuild(build(...base, extrude('ec', 'sc', 'boss', end)));
    expect(volume(wall({ type: 'upToFace', face: face('eb:cap:start') }))).toBeCloseTo(3128, 6);
    expect(volume(wall({ type: 'upToNext' }))).toBeCloseTo(3128, 6);
  });
});

describe('a second direction (C4.1)', () => {
  const block = (extra: Partial<Extract<Feature, { type: 'extrude' }>>): PartDoc => build(sketch('s1', front, rectangle('r', 0, 0, 20, 10)), { ...extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }), ...extra } as Feature);

  it('goes the other way from the same sketch: 10 up and 4 down is one block of 20 × 10 × 14 with six faces and its own cap names', () => {
    const r = rebuild(block({ dir2: { type: 'blind', depth: '4' } }));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(2800, 6);
    expect(r.bodies).toHaveLength(1);
    expect(r.body!.topology.faces).toHaveLength(6);
    expect(r.body!.names.faces).toContain('e1:cap:end');
    expect(r.body!.names.faces).toContain('e1:cap:start');
    expect(new Set(r.body!.names.faces).size).toBe(6);
    expect(r.body!.names.faces.filter((n) => n.includes('side:s1.rl0'))).toHaveLength(1); // the two halves of a wall are one face and one name
  });

  it('reverses each direction on its own, and a cut with two directions cuts both ways', () => {
    const r = rebuild(block({ dir1: { type: 'blind', depth: '10', reverse: true }, dir2: { type: 'blind', depth: '4', reverse: true } }));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(2800, 6); // swapped: 10 down, 4 up
    const slab = build(sketch('s0', front, rectangle('q', -10, -10, 60, 40)), extrude('e0', 's0', 'boss', { type: 'blind', depth: '10' }), sketch('s1', front, rectangle('r', 5, 5, 10, 10)), extrude('c1', 's1', 'cut', { type: 'blind', depth: '3', reverse: true }) as Feature);
    const cut = applyCommand(slab, { type: 'setEndCondition', featureId: 'c1', dir: 'dir2', value: { type: 'blind', depth: '2', reverse: true } });
    expect(volume(rebuild(cut))).toBeCloseTo(60 * 40 * 10 - 100 * 3, 6); // only the way into the slab cuts anything; the other way is air
  });

  it('refuses two directions with 兩側對稱', () => {
    const r = rebuild(block({ dir1: { type: 'midPlane', depth: '10' }, dir2: { type: 'blind', depth: '4' } }));
    expect(failures(r)[0]).toContain('兩側對稱');
  });
});

describe('draft of an extrusion (C5.5 in C4.1)', () => {
  const t = Math.tan(rad(3));
  const [W, D, H] = [20, 10, 10];
  const block = (extra: Partial<Extract<Feature, { type: 'extrude' }>>): PartDoc => build(sketch('s1', front, rectangle('r', 0, 0, W, D)), { ...extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }), ...extra } as Feature);

  it('outward widens and inward narrows, by the integral of the cross-section, and keeps the names of a plain block', () => {
    const plain = rebuild(block({}));
    const out = rebuild(block({ draft1: { angle: '3deg' } }));
    const inn = rebuild(block({ draft1: { angle: '3deg', inward: true } }));
    expect(failures(out)).toEqual([]);
    expect(volume(out)).toBeCloseTo(W * D * H + (W + D) * t * H * H + (4 / 3) * t * t * H ** 3, 6);
    expect(volume(inn)).toBeCloseTo(W * D * H - (W + D) * t * H * H + (4 / 3) * t * t * H ** 3, 6);
    expect(out.body!.names.faces).toEqual(plain.body!.names.faces);
    expect(kernel.isValid(out.body!.shape)).toBe(true);
  });

  it('works in the second direction, with a variable for the angle, and is refused with 兩側對稱 and past 90°', () => {
    const both = rebuild(block({ dir2: { type: 'blind', depth: '5' }, draft2: { angle: '3deg' } }));
    expect(failures(both)).toEqual([]);
    // the second half leans outward as it goes down: ∫ over 5 of (W + 2zt)(D + 2zt)
    expect(volume(both)).toBeCloseTo(W * D * 10 + W * D * 5 + (W + D) * t * 25 + (4 / 3) * t * t * 125, 6);
    expect(failures(rebuild(block({ dir1: { type: 'midPlane', depth: '10' }, draft1: { angle: '3deg' } })))[0]).toContain('兩側對稱');
    expect(() => block({ draft1: { angle: '95deg' } })).toThrow('90°');
  });

  it('with an end condition the walls lean and then are trimmed: up to a face', () => {
    const d = build(...twoBlocks(), { ...extrude('ec', 'sc', 'boss', { type: 'upToNext' }), draft1: { angle: '2deg', inward: true } } as Feature);
    const r = rebuild(d);
    expect(failures(r)).toEqual([]);
    const s = Math.tan(rad(2));
    // 4 × 4 cross-section narrowing by z s on each side over 8: ∫ (4 − 2zs)² dz = 128 − 512 s + (4/3) 512 s²
    expect(volume(r)).toBeCloseTo(3000 + 128 - 512 * s + (4 / 3) * 512 * s * s, 5);
  });
});
