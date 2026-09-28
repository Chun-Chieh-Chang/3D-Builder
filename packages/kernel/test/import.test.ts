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
const rect = (x: number, y: number, w: number, h: number): Region => ({
  outer: [
    { kind: 'line', a: [x, y], b: [x + w, y], source: 'l1' },
    { kind: 'line', a: [x + w, y], b: [x + w, y + h], source: 'l2' },
    { kind: 'line', a: [x + w, y + h], b: [x, y + h], source: 'l3' },
    { kind: 'line', a: [x, y + h], b: [x, y], source: 'l4' },
  ],
  holes: [],
});
const box = () => keep(k.extrude(front, [rect(0, 0, 20, 10)], [0, 0, 5]).shape);
const volume = (id: ShapeId) => k.massProps(id).volume;

describe('STEP import (F2.1)', () => {
  it('reads back an exported part: one solid, same volume, every face tagged with its order', () => {
    const r = k.importStep(k.exportStep(box(), 'P'));
    keep(r.shape);
    expect(volume(r.shape)).toBeCloseTo(1000, 6);
    const faces = k.topology(r.shape).faces.length;
    expect(faces).toBe(6);
    expect(r.faceOrigins).toEqual(Array.from({ length: faces }, (_, index) => [{ rel: 'imported', index }]));
    expect(k.isValid(r.shape)).toBe(true);
    expect(r.warnings).toEqual([]); // a valid file is taken as it is
  });

  it('gives the faces the same order every time the same file is read', () => {
    const text = k.exportStep(box(), 'P');
    const centers = () => {
      const r = k.importStep(text);
      keep(r.shape);
      return k.topology(r.shape).faces.map((f) => f.center.map((c) => c.toFixed(6)).join());
    };
    expect(centers()).toEqual(centers());
  });

  it('converts files in inches to millimetres', () => {
    const text = k.exportStep(box(), 'P', 'INCH');
    expect(text).toMatch(/INCH/i);
    const r = k.importStep(new TextEncoder().encode(text));
    keep(r.shape);
    expect(volume(r.shape)).toBeCloseTo(1000, 3);
    expect(k.bounds(r.shape).max[0]).toBeCloseTo(20, 4);
  });

  it('keeps several solids together', () => {
    const two = keep(k.boolean('fuse', box(), keep(k.extrude(front, [rect(40, 0, 10, 10)], [0, 0, 5]).shape)).shape);
    const r = k.importStep(k.exportStep(two, 'P'));
    keep(r.shape);
    expect(volume(r.shape)).toBeCloseTo(1500, 6);
    expect(k.topology(r.shape).faces).toHaveLength(12);
  });

  it('refuses what is not a STEP file, or has no solid', () => {
    expect(() => k.importStep('hello')).toThrow(KernelError);
    const oc = k.oc;
    const plane = new oc.gp_Pln();
    const face = new oc.BRepBuilderAPI_MakeFace(plane, 0, 10, 0, 10);
    const put = (k as unknown as { put(s: unknown): ShapeId }).put.bind(k);
    const id = keep(put(face.Face()));
    face.delete();
    plane.delete();
    expect(() => k.importStep(k.exportStep(id, 'Sheet'))).toThrow('沒有實體');
  });

  it('copies a handle that outlives the original', () => {
    const a = k.extrude(front, [rect(0, 0, 20, 10)], [0, 0, 5]).shape;
    const b = keep(k.copy(a));
    k.release(a);
    expect(volume(b)).toBeCloseTo(1000, 6);
  });
});
