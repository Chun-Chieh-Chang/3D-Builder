/**
 * Phase 3a-8c (F4.1, F1.3, C3.4): STL, STEP with a schema and a coordinate system (ADR 0039).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { Feature } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type ShapeId } from '@3db/kernel';
import { exportFaces, intoFrame, Regenerator } from '@3db/regen';
import { binaryStl, exportPartStep, readBinaryStl, stlMeasure } from '@3db/io';
import { MESH_QUALITY } from '@3db/model';
import { build, circle, extrude, face, front, rectangle, sketch } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const plate = (): Feature[] => [sketch('s1', front, rectangle('p', 0, 0, 60, 20)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '5' })];
const withPost = (): Feature[] => [...plate(), sketch('s2', face('e1:cap:end'), circle('k', 5, 10, 2)), extrude('e2', 's2', 'boss', { type: 'blind', depth: '5' })];
const shapeOf = (features: Feature[]): ShapeId => new Regenerator(kernel, solver, new Map()).rebuild(build(...features)).body!.shape;

describe('STL (F4.1)', () => {
  it('a plate: 12 triangles, the volume and the area of the plate to the precision of the numbers an STL holds', () => {
    const bytes = binaryStl([kernel.mesh(shapeOf(plate()))], 'plate');
    expect(bytes.byteLength).toBe(84 + 50 * 12);
    const { volume, area } = stlMeasure(readBinaryStl(bytes));
    expect(volume).toBeCloseTo(6000, 3);
    expect(area).toBeCloseTo(2 * (1200 + 300 + 100), 3);
  });

  it('a plate with a post: the mesh is closed (every edge has a neighbour on the other side) and encloses the volume the kernel measures, to the chord error', () => {
    const shape = shapeOf(withPost());
    const mesh = kernel.mesh(shape, MESH_QUALITY.fine);
    const triangles = readBinaryStl(binaryStl([mesh]));
    const exact = kernel.massProps(shape);
    const { volume, area } = stlMeasure(triangles);
    expect(Math.abs(volume - exact.volume) / exact.volume).toBeLessThan(1e-4);
    expect(Math.abs(area - exact.area) / exact.area).toBeLessThan(1e-4);
    // closed: each undirected edge is used by exactly two triangles, one in each direction
    const key = (a: number, b: number, t: Float32Array) => `${t[a]!.toFixed(3)},${t[a + 1]!.toFixed(3)},${t[a + 2]!.toFixed(3)}>${t[b]!.toFixed(3)},${t[b + 1]!.toFixed(3)},${t[b + 2]!.toFixed(3)}`;
    const directed = new Map<string, number>();
    for (const t of triangles) for (const [a, b] of [[0, 3], [3, 6], [6, 0]] as const) directed.set(key(a, b, t), (directed.get(key(a, b, t)) ?? 0) + 1);
    let open = 0;
    for (const [edge, n] of directed) {
      const [from, to] = edge.split('>');
      if (n !== 1 || directed.get(`${to}>${from}`) !== 1) open++;
    }
    expect(open).toBe(0);
  });

  it('the finer the quality, the more triangles', () => {
    const count = (q: keyof typeof MESH_QUALITY) => readBinaryStl(binaryStl([kernel.mesh(shapeOf(withPost()), MESH_QUALITY[q])])).length;
    expect(count('fine')).toBeGreaterThan(count('normal'));
    expect(count('normal')).toBeGreaterThan(count('coarse'));
  });

  it('two meshes in one file, and the bodies a reference body leaves out', () => {
    const two = binaryStl([kernel.mesh(shapeOf(plate())), kernel.mesh(shapeOf(plate()))]);
    expect(readBinaryStl(two)).toHaveLength(24);
    const r = new Regenerator(kernel, solver, new Map()).rebuild(build(...plate(), sketch('s3', front, rectangle('q', 100, 0, 10, 10)), { ...extrude('e3', 's3', 'boss', { type: 'blind', depth: '5' }), merge: false } as Feature));
    expect(r.bodies).toHaveLength(2);
    expect(exportFaces({ appearances: [] }, r).shapes).toHaveLength(2);
  });

  it('a file that is not a binary STL is not read', () => {
    expect(() => readBinaryStl(new Uint8Array(100))).toThrow('binary STL');
  });
});

describe('STEP in a coordinate system (C3.4) and in AP242 (F1.3)', () => {
  const bounds = (id: ShapeId) => kernel.bounds(id);

  it('the part is written with the system at the origin: a system at (10, 0, 0) with X along y and Y along −x, Z along z', () => {
    // axes x = (0,1,0), y = (−1,0,0), z = (0,0,1): right-handed (x × y = z)
    const system = { origin: [10, 0, 0] as [number, number, number], x: [0, 1, 0] as [number, number, number], y: [-1, 0, 0] as [number, number, number], z: [0, 0, 1] as [number, number, number] };
    const shape = shapeOf(plate()); // x from 0 to 60, y from 0 to 20, z from 0 to 5
    const step = exportPartStep(kernel, shape, 'plate', { place: intoFrame(system) });
    const back = kernel.importStep(step).shape;
    const b = bounds(back);
    // a point (px, py, pz) lands at (y, 10 − x, z)... : x' = y, y' = −(x − 10) = 10 − x, z' = z
    expect(b.min[0]).toBeCloseTo(0, 6);
    expect(b.max[0]).toBeCloseTo(20, 6);
    expect(b.min[1]).toBeCloseTo(10 - 60, 6);
    expect(b.max[1]).toBeCloseTo(10, 6);
    expect(b.min[2]).toBeCloseTo(0, 6);
    expect(b.max[2]).toBeCloseTo(5, 6);
    expect(kernel.massProps(back).volume).toBeCloseTo(6000, 6);
    // the part itself is where it was
    expect(bounds(shape).max[0]).toBeCloseTo(60, 6);
  });

  it('a system that is the part’s own changes nothing', () => {
    const own = { origin: [0, 0, 0] as [number, number, number], x: [1, 0, 0] as [number, number, number], y: [0, 1, 0] as [number, number, number], z: [0, 0, 1] as [number, number, number] };
    const shape = shapeOf(plate());
    const back = kernel.importStep(exportPartStep(kernel, shape, 'plate', { place: intoFrame(own) })).shape;
    expect(bounds(back)).toEqual(expect.objectContaining({ max: [expect.closeTo(60, 6), expect.closeTo(20, 6), expect.closeTo(5, 6)] }));
  });

  it('AP242 is a different schema in the header and reads back to the same solid; the next AP214 file is not AP242', () => {
    const shape = shapeOf(withPost());
    const ap242 = exportPartStep(kernel, shape, 'p', { schema: 'AP242' });
    expect(ap242).toContain('AP242');
    expect(ap242).not.toContain('AUTOMOTIVE_DESIGN {');
    expect(kernel.massProps(kernel.importStep(ap242).shape).volume).toBeCloseTo(kernel.massProps(shape).volume, 6);
    expect(exportPartStep(kernel, shape, 'p', { schema: 'AP214' })).toContain('AUTOMOTIVE_DESIGN');
  });

  it('several bodies are put together into one file and a coordinate system moves them all', () => {
    const r = new Regenerator(kernel, solver, new Map()).rebuild(build(...plate(), sketch('s3', front, rectangle('q', 100, 0, 10, 10)), { ...extrude('e3', 's3', 'boss', { type: 'blind', depth: '5' }), merge: false } as Feature));
    const own = exportFaces({ appearances: [] }, r);
    const moved = kernel.importStep(exportPartStep(kernel, own.shapes, 'two', { place: [1, 0, 0, -100, 0, 1, 0, 0, 0, 0, 1, 0] })).shape;
    expect(bounds(moved).min[0]).toBeCloseTo(-100, 6);
    expect(bounds(moved).max[0]).toBeCloseTo(10, 6);
  });
});
