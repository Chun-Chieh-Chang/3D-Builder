import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type Frame, type Region, type ShapeId } from '../src/index';

let k: Kernel;
beforeAll(async () => {
  k = await Kernel.load();
});

const front: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const at = (z: number): Frame => ({ ...front, origin: [0, 0, z] });
const rect = (x0: number, y0: number, x1: number, y1: number): Region => ({
  outer: [
    { kind: 'line', a: [x0, y0], b: [x1, y0], source: 'a' },
    { kind: 'line', a: [x1, y0], b: [x1, y1], source: 'b' },
    { kind: 'line', a: [x1, y1], b: [x0, y1], source: 'c' },
    { kind: 'line', a: [x0, y1], b: [x0, y0], source: 'd' },
  ],
  holes: [],
});
const disk = (cx: number, cy: number, r: number): Region => ({ outer: [{ kind: 'circle', c: [cx, cy], r, source: 'c' }], holes: [] });

const live: ShapeId[] = [];
const keep = (id: ShapeId) => (live.push(id), id);
afterEach(() => {
  for (const id of live.splice(0)) k.release(id);
});
const volume = (id: ShapeId) => k.massProps(id).volume;

/** 40 × 30 × 20 block. */
const block = () => keep(k.extrude(front, [rect(0, 0, 40, 30)], [0, 0, 20]).shape);
const cut = (base: ShapeId, tool: ShapeId) => keep(k.boolean('cut', base, tool).shape);
const faceWhere = (id: ShapeId, pred: (f: ReturnType<Kernel['topology']>['faces'][number]) => boolean) => {
  const i = k.topology(id).faces.findIndex(pred);
  if (i < 0) throw new Error('face not found');
  return i;
};
const top = (id: ShapeId, z: number) => faceWhere(id, (f) => !!f.normal && f.normal[2] > 0.9 && Math.abs(f.center[2] - z) < 1e-6);

describe('delete face (C10.2)', () => {
  it('fills a through hole: the wall goes and the top and bottom close up', () => {
    const base = block();
    const holed = cut(base, keep(k.extrude(at(-1), [disk(20, 15, 4)], [0, 0, 22]).shape));
    expect(volume(holed)).toBeCloseTo(40 * 30 * 20 - Math.PI * 16 * 20, 6);
    const wall = faceWhere(holed, (f) => f.surface === 'cylinder');
    const r = k.deleteFaces(holed, [wall]);
    keep(r.shape);
    expect(volume(r.shape)).toBeCloseTo(40 * 30 * 20, 6);
    expect(k.isValid(r.shape)).toBe(true);
    expect(k.topology(r.shape).faces).toHaveLength(6);
    // every face of the result knows where it came from, and nothing is new
    expect(r.faceOrigins.every((o) => o.length > 0 && o.every((x) => x.rel === 'same' || x.rel === 'modified'))).toBe(true);
  });

  it('fills a blind hole: wall and bottom together', () => {
    const base = block();
    const holed = cut(base, keep(k.extrude(at(20), [disk(20, 15, 4)], [0, 0, -8]).shape));
    expect(volume(holed)).toBeCloseTo(40 * 30 * 20 - Math.PI * 16 * 8, 6);
    const topo = k.topology(holed);
    const wall = topo.faces.findIndex((f) => f.surface === 'cylinder');
    const bottom = topo.faces.findIndex((f) => f.normal && f.normal[2] > 0.9 && Math.abs(f.center[2] - 12) < 1e-6);
    const r = k.deleteFaces(holed, [wall, bottom]);
    keep(r.shape);
    expect(volume(r.shape)).toBeCloseTo(40 * 30 * 20, 6);
    expect(k.topology(r.shape).faces).toHaveLength(6);
  });

  it('deletes a fillet and the edge is square again', () => {
    const base = block();
    const topo = k.topology(base);
    const edge = topo.edges.findIndex((e) => Math.abs(e.mid[0] - 40) < 1e-9 && Math.abs(e.mid[2] - 20) < 1e-9);
    const rounded = keep(k.fillet(base, [edge], 3).shape);
    expect(volume(rounded)).toBeLessThan(volume(base));
    const r = k.deleteFaces(rounded, [faceWhere(rounded, (f) => f.surface === 'cylinder')]);
    keep(r.shape);
    expect(volume(r.shape)).toBeCloseTo(volume(base), 6);
    expect(k.isValid(r.shape)).toBe(true);
    expect(k.topology(r.shape).faces).toHaveLength(6);
  });

  it('refuses a face that cannot be removed instead of returning a half result', () => {
    const base = block();
    // The only face of a plain block: removing a side leaves the neighbours nothing to meet at.
    expect(() => k.deleteFaces(base, [top(base, 20)])).toThrow('刪除面失敗');
  });

  it('refuses an empty list and an index out of range', () => {
    const base = block();
    expect(() => k.deleteFaces(base, [])).toThrow('尚未選擇');
    expect(() => k.deleteFaces(base, [99])).toThrow('超出範圍');
  });

  it('does not leak shapes', () => {
    const before = k.liveShapes;
    const base = k.extrude(front, [rect(0, 0, 40, 30)], [0, 0, 20]).shape;
    const pin = k.extrude(at(-1), [disk(20, 15, 4)], [0, 0, 22]).shape;
    const holed = k.boolean('cut', base, pin).shape;
    const r = k.deleteFaces(holed, [k.topology(holed).faces.findIndex((f) => f.surface === 'cylinder')]);
    for (const id of [base, pin, holed, r.shape]) k.release(id);
    expect(k.liveShapes).toBe(before);
  });
});

describe('move face (C10.1)', () => {
  it.each([5, -5])('moves the top of a block by %d', (d) => {
    const base = block();
    const r = k.moveFace(base, top(base, 20), d);
    keep(r.shape);
    expect(volume(r.shape)).toBeCloseTo(40 * 30 * (20 + d), 6);
    expect(k.isValid(r.shape)).toBe(true);
    expect(k.topology(r.shape).faces).toHaveLength(6);
    // the moved face is still the same face, and the walls that stretched are the same walls
    const moved = k.topology(r.shape).faces.findIndex((f) => f.normal && f.normal[2] > 0.9);
    expect(r.faceOrigins[moved]).toEqual([{ rel: 'modified', kind: 'face', index: top(base, 20) }]);
    expect(r.faceOrigins.every((o) => o.length >= 1)).toBe(true);
  });

  it('moves the top of a plate with a through hole: the hole stays', () => {
    const base = block();
    const holed = cut(base, keep(k.extrude(at(-1), [disk(20, 15, 4)], [0, 0, 22]).shape));
    const r = k.moveFace(holed, top(holed, 20), 5);
    keep(r.shape);
    expect(volume(r.shape)).toBeCloseTo((40 * 30 - Math.PI * 16) * 25, 6);
    expect(k.isValid(r.shape)).toBe(true);
    expect(k.topology(r.shape).faces).toHaveLength(7);
  });

  it('moves the inner wall of an L-shaped block (a concave corner)', () => {
    const base = block();
    const notch = keep(k.extrude(at(-1), [rect(20, 15, 50, 40)], [0, 0, 22]).shape);
    const L = cut(base, notch);
    const wall = faceWhere(L, (f) => !!f.normal && f.normal[0] > 0.9 && Math.abs(f.center[0] - 20) < 1e-6);
    const r = k.moveFace(L, wall, 3);
    keep(r.shape);
    expect(volume(r.shape)).toBeCloseTo(40 * 30 * 20 - 20 * 15 * 20 + 3 * 15 * 20, 6);
    expect(k.isValid(r.shape)).toBe(true);
  });

  it.each([5, -5])('keeps slanted walls slanted when the top of a tapered block moves by %d', (d) => {
    // A trapezoid in the XZ plane (40 wide at the bottom, 20 at the top, 20 high) pushed 30 along −y.
    const xz: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 0, 1], normal: [0, -1, 0] };
    const trapezoid: Region = {
      outer: [
        { kind: 'line', a: [0, 0], b: [40, 0], source: 'a' },
        { kind: 'line', a: [40, 0], b: [30, 20], source: 'b' },
        { kind: 'line', a: [30, 20], b: [10, 20], source: 'c' },
        { kind: 'line', a: [10, 20], b: [0, 0], source: 'd' },
      ],
      holes: [],
    };
    const base = keep(k.extrude(xz, [trapezoid], [0, -30, 0]).shape);
    const r = k.moveFace(base, top(base, 20), d);
    keep(r.shape);
    // the width is 40 − z (each wall slopes 1 : 2), so the section stays a trapezoid whatever the height
    const h = 20 + d;
    expect(volume(r.shape)).toBeCloseTo(30 * (40 * h - (h * h) / 2), 6);
    expect(k.isValid(r.shape)).toBe(true);
    expect(k.topology(r.shape).faces).toHaveLength(6);
  });

  it.each([5, -5])('moves the top of an L-shaped block, a face that is not convex, by %d', (d) => {
    const base = block();
    const L = cut(base, keep(k.extrude(at(-1), [rect(20, 15, 50, 40)], [0, 0, 22]).shape));
    const r = k.moveFace(L, top(L, 20), d);
    keep(r.shape);
    expect(volume(r.shape)).toBeCloseTo((40 * 30 - 20 * 15) * (20 + d), 6);
    expect(k.isValid(r.shape)).toBe(true);
    expect(k.topology(r.shape).faces).toHaveLength(8);
    // the sides stretched or shrank and are still the sides they were: every face has an origin in the body
    expect(r.faceOrigins.every((o) => o.length > 0 && o.every((x) => 'index' in x && x.index < k.topology(L).faces.length))).toBe(true);
  });

  it('refuses to push a face further into the material than the body is thick behind it', () => {
    const base = block();
    expect(() => k.moveFace(base, top(base, 20), -25)).toThrow('超過了這個面後面的厚度');
    const r = k.moveFace(base, top(base, 20), -19.5); // still inside
    keep(r.shape);
    expect(volume(r.shape)).toBeCloseTo(40 * 30 * 0.5, 6);
  });

  it('refuses a face with a smooth (filleted) neighbour', () => {
    const base = block();
    const edge = k.topology(base).edges.findIndex((e) => Math.abs(e.mid[0] - 40) < 1e-9 && Math.abs(e.mid[2] - 20) < 1e-9);
    const rounded = keep(k.fillet(base, [edge], 3).shape);
    expect(() => k.moveFace(rounded, top(rounded, 20), 2)).toThrow('相切');
  });

  it('refuses a face that is not a plane, and a zero distance', () => {
    const base = block();
    const holed = cut(base, keep(k.extrude(at(-1), [disk(20, 15, 4)], [0, 0, 22]).shape));
    expect(() => k.moveFace(holed, faceWhere(holed, (f) => f.surface === 'cylinder'), 1)).toThrow('平面');
    expect(() => k.moveFace(base, top(base, 20), 0)).toThrow('不能是 0');
  });

  it('does not leak shapes', () => {
    const before = k.liveShapes;
    const base = k.extrude(front, [rect(0, 0, 40, 30)], [0, 0, 20]).shape;
    const r = k.moveFace(base, top(base, 20), 5);
    k.release(base);
    k.release(r.shape);
    expect(k.liveShapes).toBe(before);
  });
});
