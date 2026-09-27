import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type Frame, type Region, type ShapeId } from '../src/index';

let k: Kernel;
beforeAll(async () => {
  k = await Kernel.load();
});

const front: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const at = (z: number): Frame => ({ ...front, origin: [0, 0, z] });
const rect = (x0: number, y0: number, x1: number, y1: number, tag = 'r'): Region => ({
  outer: [
    { kind: 'line', a: [x0, y0], b: [x1, y0], source: `${tag}1` },
    { kind: 'line', a: [x1, y0], b: [x1, y1], source: `${tag}2` },
    { kind: 'line', a: [x1, y1], b: [x0, y1], source: `${tag}3` },
    { kind: 'line', a: [x0, y1], b: [x0, y0], source: `${tag}4` },
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
const box = () => keep(k.extrude(front, [rect(0, 0, 20, 10)], [0, 0, 5]).shape); // 20 × 10 × 5

describe('booleans (A1.5)', () => {
  it('fuses a boss onto a block and reports where every face came from', () => {
    const base = box();
    const nBase = k.topology(base).faces.length;
    const boss = keep(k.extrude(at(5), [rect(5, 2, 15, 8)], [0, 0, 4]).shape);
    const r = k.boolean('fuse', base, boss);
    keep(r.shape);
    expect(volume(r.shape)).toBeCloseTo(1000 + 10 * 6 * 4, 6);
    expect(k.isValid(r.shape)).toBe(true);
    expect(r.faceOrigins.every((o) => o.length > 0)).toBe(true);
    const fromBoss = r.faceOrigins.filter((o) => o.some((x) => x.rel !== 'cap' && x.kind === 'face' && x.index >= nBase));
    expect(fromBoss).toHaveLength(5); // four boss sides and its top; its bottom merged away
  });

  it('merges faces that end up on the same plane (UnifySameDomain) and keeps both origins', () => {
    const a = box();
    const b = keep(k.extrude(front, [rect(20, 0, 30, 10)], [0, 0, 5]).shape); // flush against a
    const r = k.boolean('fuse', a, b);
    keep(r.shape);
    expect(k.topology(r.shape).faces).toHaveLength(6); // one 30 × 10 × 5 block
    const merged = r.faceOrigins.filter((o) => o.length > 1);
    expect(merged).toHaveLength(4); // top, bottom, front and back each came from both blocks
  });

  it('cuts a through hole', () => {
    const base = box();
    const pin = keep(k.extrude(at(-1), [disk(10, 5, 2)], [0, 0, 7]).shape);
    const r = k.boolean('cut', base, pin);
    keep(r.shape);
    expect(volume(r.shape)).toBeCloseTo(1000 - Math.PI * 4 * 5, 6);
    const n = k.topology(base).faces.length;
    const wall = r.faceOrigins.findIndex((o) => o.some((x) => x.rel !== 'cap' && x.kind === 'face' && x.index >= n));
    expect(k.topology(r.shape).faces[wall]!.surface).toBe('cylinder');
  });
});

describe('up to face, revolve, chamfer', () => {
  it('extrudes up to a face of another body and makes that face the end cap', () => {
    const base = box();
    const bottom = k.topology(base).faces.findIndex((f) => f.normal && f.normal[2] < -0.9);
    const r = k.extrude(at(-10), [rect(2, 2, 6, 6)], [0, 0, 100], 0, { target: base, face: bottom });
    keep(r.shape);
    expect(volume(r.shape)).toBeCloseTo(16 * 10, 6); // from z = −10 up to z = 0
    expect(r.faceOrigins.flat().filter((o) => o.rel === 'cap').map((o) => (o.rel === 'cap' ? o.which : '')).sort()).toEqual(['end', 'start']);
  });

  it('ends on the plane of the face even where the profile is not under the face', () => {
    const base = box(); // top face spans x 0..20
    const topFace = k.topology(base).faces.findIndex((f) => f.normal && f.normal[2] > 0.9);
    const r = k.extrude(at(-10), [rect(30, 2, 34, 6)], [0, 0, 100], 0, { target: base, face: topFace });
    keep(r.shape);
    expect(volume(r.shape)).toBeCloseTo(16 * 15, 6); // z from −10 up to the top plane z = 5
  });

  it('refuses to extrude up to a face behind the sketch', () => {
    const base = box();
    const top = k.topology(base).faces.findIndex((f) => f.normal && f.normal[2] > 0.9);
    expect(() => k.extrude(at(10), [rect(2, 2, 6, 6)], [0, 0, 50], 0, { target: base, face: top })).toThrow('沒有到達');
  });

  it('revolves a profile all the way round (no caps) or part of the way (caps)', () => {
    const tube = k.revolve(front, [rect(5, 0, 10, 10)], { origin: [0, 0, 0], dir: [0, 1, 0] }, 2 * Math.PI);
    keep(tube.shape);
    expect(volume(tube.shape)).toBeCloseTo(Math.PI * (100 - 25) * 10, 6);
    expect(tube.faceOrigins.flat().some((o) => o.rel === 'cap')).toBe(false);
    const quarter = k.revolve(front, [rect(5, 0, 10, 10)], { origin: [0, 0, 0], dir: [0, 1, 0] }, Math.PI / 2);
    keep(quarter.shape);
    expect(volume(quarter.shape)).toBeCloseTo((Math.PI * (100 - 25) * 10) / 4, 6);
    expect(quarter.faceOrigins.flat().filter((o) => o.rel === 'cap')).toHaveLength(2);
    expect(k.isValid(quarter.shape)).toBe(true);
  });

  it('chamfers an edge with two distances or a distance and an angle', () => {
    const base = box();
    const topo = k.topology(base);
    const edge = topo.edges.findIndex((e) => Math.abs(e.mid[0] - 20) < 1e-9 && Math.abs(e.mid[2] - 5) < 1e-9); // x = 20, z = 5, along y
    const top = topo.faces.findIndex((f) => f.normal && f.normal[2] > 0.9);
    const dd = k.chamfer(base, [{ edge, face: top }], 'distanceDistance', 2, 3);
    keep(dd.shape);
    expect(volume(dd.shape)).toBeCloseTo(1000 - 0.5 * 2 * 3 * 10, 6);
    const da = k.chamfer(base, [{ edge, face: top }], 'angleDistance', 2, Math.PI / 4);
    keep(da.shape);
    expect(volume(da.shape)).toBeCloseTo(1000 - 0.5 * 2 * 2 * 10, 6);
    expect(dd.faceOrigins.flat().some((o) => o.rel === 'generated' && o.kind === 'edge' && o.index === edge)).toBe(true);
  });

  it('reports the bounding box', () => {
    const b = k.bounds(box()); // enlarged by the shape tolerance, hence closeTo
    expect(b.min).toEqual([expect.closeTo(0, 4), expect.closeTo(0, 4), expect.closeTo(0, 4)]);
    expect(b.max).toEqual([expect.closeTo(20, 4), expect.closeTo(10, 4), expect.closeTo(5, 4)]);
  });

  it('does not leak shapes', () => {
    const before = k.liveShapes;
    const base = k.extrude(front, [rect(0, 0, 20, 10)], [0, 0, 5]).shape;
    const pin = k.extrude(at(-1), [disk(10, 5, 2)], [0, 0, 7]).shape;
    const r = k.boolean('cut', base, pin);
    for (const id of [base, pin, r.shape]) k.release(id);
    expect(k.liveShapes).toBe(before);
  });
});
