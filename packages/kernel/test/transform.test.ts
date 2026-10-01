import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Kernel, KernelError, type ShapeId } from '../src';
import type { Frame, Region } from '../src/kernel';

let k: Kernel;
const live: ShapeId[] = [];
const keep = (id: ShapeId) => (live.push(id), id);
beforeAll(async () => {
  k = await Kernel.load();
});
afterAll(() => live.forEach((id) => k.release(id)));

const front: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const rect = (w: number, h: number): Region => ({
  outer: [
    { kind: 'line', a: [0, 0], b: [w, 0], source: 'l1' },
    { kind: 'line', a: [w, 0], b: [w, h], source: 'l2' },
    { kind: 'line', a: [w, h], b: [0, h], source: 'l3' },
    { kind: 'line', a: [0, h], b: [0, 0], source: 'l4' },
  ],
  holes: [],
});
/** A 20 × 10 × 5 block from the origin to (20, 10, 5), with an asymmetry (a second block on one corner) so that a turn or a mirror cannot hide. */
const lump = () => keep(k.boolean('fuse', k.extrude(front, [rect(20, 10)], [0, 0, 5]).shape, k.extrude({ ...front, origin: [0, 0, 5] }, [rect(6, 4)], [0, 0, 3]).shape).shape);
const volume = (id: ShapeId) => k.massProps(id).volume;
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];

describe('transformed shapes (C6.1–C6.3)', () => {
  it('a slide keeps volume and structure and moves the centre by the vector', () => {
    const a = lump();
    const b = keep(k.transformed(a, [1, 0, 0, 30, 0, 1, 0, -4, 0, 0, 1, 2]));
    expect(volume(b)).toBeCloseTo(volume(a), 9);
    const [ca, cb] = [k.massProps(a).center, k.massProps(b).center];
    expect([cb[0] - ca[0], cb[1] - ca[1], cb[2] - ca[2]]).toEqual([expect.closeTo(30, 9), expect.closeTo(-4, 9), expect.closeTo(2, 9)]);
    // same faces in the same order: the same kinds and areas
    const [ta, tb] = [k.topology(a), k.topology(b)];
    expect(tb.faces.map((f) => [f.surface, Math.round(f.area * 1e6)])).toEqual(ta.faces.map((f) => [f.surface, Math.round(f.area * 1e6)]));
    expect(k.isValid(b)).toBe(true);
  });

  it('a quarter turn about the z axis through (10, 0): the centre turns with it', () => {
    const a = lump();
    // x' = −y + 10, y' = x − 10 (a quarter turn about the point (10, 0)): rotation [0 −1; 1 0], translation (10, −10)
    const b = keep(k.transformed(a, [0, -1, 0, 10, 1, 0, 0, -10, 0, 0, 1, 0]));
    const ca = k.massProps(a).center;
    const cb = k.massProps(b).center;
    expect(cb[0]).toBeCloseTo(-ca[1] + 10, 9);
    expect(cb[1]).toBeCloseTo(ca[0] - 10, 9);
    expect(cb[2]).toBeCloseTo(ca[2], 9);
    expect(volume(b)).toBeCloseTo(volume(a), 9);
  });

  it('a mirror across the plane x = 25: the volume is the same (and positive), the centre is the reflection, the shape is valid', () => {
    const a = lump();
    // x' = −x + 50
    const b = keep(k.transformed(a, [-1, 0, 0, 50, 0, 1, 0, 0, 0, 0, 1, 0]));
    expect(volume(b)).toBeCloseTo(volume(a), 9);
    expect(k.massProps(b).area).toBeCloseTo(k.massProps(a).area, 9);
    const [ca, cb] = [k.massProps(a).center, k.massProps(b).center];
    expect(cb[0]).toBeCloseTo(50 - ca[0], 9);
    expect(cb[1]).toBeCloseTo(ca[1], 9);
    expect(k.isValid(b)).toBe(true);
    // it fuses with its source like any solid
    const both = keep(k.boolean('fuse', a, b).shape);
    expect(volume(both)).toBeCloseTo(2 * volume(a), 6);
  });

  it('refuses a matrix that is not of twelve numbers or is not a motion of space', () => {
    const a = lump();
    expect(() => k.transformed(a, identity.slice(0, 11))).toThrow(KernelError);
    expect(() => k.transformed(a, [...identity.slice(0, 11), NaN])).toThrow(KernelError);
    expect(() => k.transformed(a, [1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0])).toThrow(KernelError);
  });
});

describe('STEP export options (F1.3)', () => {
  it('a face colour is written, the schema is AP214 unless AP242 is asked for, and one export does not leak into the next', () => {
    const a = lump();
    const colors = k.topology(a).faces.map((_, i) => (i === 0 ? '#ff0000' : i === 1 ? '#00ff80' : null));
    const plain = k.exportStep(a, 'Lump');
    expect(plain).not.toContain('COLOUR_RGB');
    expect(plain).toContain('AUTOMOTIVE_DESIGN');
    const coloured = k.exportStep(a, 'Lump', 'MM', { faceColors: colors });
    const rgb = coloured.split('\n').filter((l) => l.includes('COLOUR_RGB')).map((l) => /COLOUR_RGB\('',([\d.e+-]+),([\d.e+-]+),([\d.e+-]+)\)/.exec(l)!.slice(1).map(Number));
    // a colour that has a name in STEP is written by that name (the first face is plain red); the other is written as it was given
    expect(coloured).toContain("DRAUGHTING_PRE_DEFINED_COLOUR('red')");
    expect(rgb).toHaveLength(1);
    expect(rgb[0]![0]).toBeCloseTo(0, 6);
    expect(rgb[0]![1]).toBeCloseTo(1, 6);
    expect(rgb[0]![2]).toBeCloseTo(0x80 / 255, 6);
    const ap242 = k.exportStep(a, 'Lump', 'MM', { schema: 'AP242' });
    expect(ap242).toContain('AP242');
    expect(k.exportStep(a, 'Lump')).not.toContain('AP242');
    // what is written reads back as the same solid
    const back = keep(k.importStep(coloured).shape);
    expect(volume(back)).toBeCloseTo(volume(a), 6);
  });

  it('a colour that is not #rrggbb is refused', () => {
    const a = lump();
    expect(() => k.exportStep(a, 'Lump', 'MM', { faceColors: ['red'] })).toThrow(KernelError);
  });
});

describe('the first STEP export of a kernel', () => {
  it('can already be AP242 (the library’s settings exist only once a writer has been made)', async () => {
    const fresh = await Kernel.load();
    const front: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
    const box = fresh.extrude(front, [rect(5, 5)], [0, 0, 5]).shape;
    expect(fresh.exportStep(box, 'First', 'MM', { schema: 'AP242' })).toContain('AP242');
  });
});
