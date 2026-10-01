import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type Frame, type Region, type ShapeId } from '../src/index';

let k: Kernel;
beforeAll(async () => {
  k = await Kernel.load();
});

const front: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const rect = (x0: number, y0: number, x1: number, y1: number): Region => ({
  outer: [
    { kind: 'line', a: [x0, y0], b: [x1, y0], source: 'a' },
    { kind: 'line', a: [x1, y0], b: [x1, y1], source: 'b' },
    { kind: 'line', a: [x1, y1], b: [x0, y1], source: 'c' },
    { kind: 'line', a: [x0, y1], b: [x0, y0], source: 'd' },
  ],
  holes: [],
});
const live: ShapeId[] = [];
const keep = (id: ShapeId) => (live.push(id), id);
afterEach(() => {
  for (const id of live.splice(0)) k.release(id);
});
const volume = (id: ShapeId) => k.massProps(id).volume;
/** x0..x1 × 0..10 × 0..10 block. */
const block = (x0: number, x1: number) => keep(k.extrude(front, [rect(x0, 0, x1, 10)], [0, 0, 10]).shape);

describe('bodies (C7)', () => {
  it('counts the solids of a result: fused blocks that touch are one, blocks apart are two', () => {
    expect(k.solidCount(keep(k.boolean('fuse', block(0, 10), block(10, 20)).shape))).toBe(1);
    expect(k.solidCount(keep(k.boolean('fuse', block(0, 10), block(30, 40)).shape))).toBe(2);
  });

  it('splits a result that has come apart into its solids, largest first, each with its own origins', () => {
    const wall = block(0, 30);
    const slot = block(10, 14); // a through slot: leaves a piece 10 wide and a piece 16 wide
    const cutAll = k.boolean('cut', wall, slot);
    keep(cutAll.shape);
    expect(k.solidCount(cutAll.shape)).toBe(2);
    const pieces = k.splitSolids(cutAll);
    pieces.forEach((p) => keep(p.shape));
    expect(pieces).toHaveLength(2);
    expect(volume(pieces[0]!.shape)).toBeCloseTo(16 * 100, 6);
    expect(volume(pieces[1]!.shape)).toBeCloseTo(10 * 100, 6);
    for (const p of pieces) {
      expect(p.faceOrigins).toHaveLength(k.topology(p.shape).faces.length);
      expect(p.faceOrigins.every((o) => o.length > 0)).toBe(true);
      expect(k.isValid(p.shape)).toBe(true);
    }
    // together they have the faces of the whole result
    expect(pieces.reduce((n, p) => n + p.faceOrigins.length, 0)).toBe(k.topology(cutAll.shape).faces.length);
  });

  it('gives a single solid back as one piece, and lists the same order every time', () => {
    const one = k.boolean('cut', block(0, 30), block(40, 50));
    keep(one.shape);
    const a = k.splitSolids(one).map((p) => keep(p.shape));
    expect(a).toHaveLength(1);
    const two = k.boolean('cut', block(0, 30), block(10, 14));
    keep(two.shape);
    const volumes = () => k.splitSolids(two).map((p) => volume(keep(p.shape)));
    expect(volumes()).toEqual(volumes());
  });

  it('intersects two bodies (「共同」), the common part with the faces of both', () => {
    const r = k.boolean('common', block(0, 20), block(10, 30));
    keep(r.shape);
    expect(volume(r.shape)).toBeCloseTo(10 * 100, 6);
    expect(k.isValid(r.shape)).toBe(true);
    expect(r.faceOrigins.every((o) => o.length > 0)).toBe(true);
  });

  it('joins bodies into one shape for showing and measuring, and clones one so that nothing is shared', () => {
    const a = block(0, 10);
    const b = block(20, 30);
    const together = keep(k.join([a, b]));
    expect(volume(together)).toBeCloseTo(2000, 6);
    expect(k.topology(together).faces).toHaveLength(12);
    const copy = keep(k.clone(a));
    expect(volume(copy)).toBeCloseTo(1000, 6);
    // two bodies from one shape would count their faces once in a compound: the clone counts its own
    expect(k.topology(keep(k.join([a, copy]))).faces).toHaveLength(12);
  });

  it('does not leak shapes', () => {
    const before = k.liveShapes;
    const a = k.extrude(front, [rect(0, 0, 30, 10)], [0, 0, 10]).shape;
    const b = k.extrude(front, [rect(10, 0, 14, 10)], [0, 0, 10]).shape;
    const cut = k.boolean('cut', a, b);
    const ids = [a, b, cut.shape, ...k.splitSolids(cut).map((p) => p.shape)];
    ids.push(k.join(ids.slice(3)), k.clone(a));
    for (const id of ids) k.release(id);
    expect(k.liveShapes).toBe(before);
  });
});
