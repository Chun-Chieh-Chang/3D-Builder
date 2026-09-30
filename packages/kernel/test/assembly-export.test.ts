import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Kernel, KernelError, type ShapeId } from '../src';
import type { Frame, Region } from '../src/kernel';
import { readAssemblyStep, rotationMatrix } from '../../../tests/support/readAssemblyStep';

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
const block = (w: number, h: number, d: number) => keep(k.extrude(front, [rect(w, h)], [0, 0, d]).shape);
const readBack = (text: string) => readAssemblyStep(k.oc, text);

type Rotation = [number, number, number, number];
const pose = (position: [number, number, number], rotation: Rotation = [0, 0, 0, 1]) => ({ position, rotation });

describe('STEP assembly export (F1.2)', () => {
  const plate = () => block(100, 60, 10);
  const pin = () => block(6, 6, 20);
  const poses = {
    origin: pose([0, 0, 0]),
    moved: pose([20, 30, 10]),
    // a unit quaternion (0.01 + 0.49 + 0.09 + 0.41 = 1) that is not an axis-aligned turn
    turned: pose([-7.5, 44.25, 3.125], [0.1, 0.7, -0.3, Math.sqrt(0.41)]),
  };

  it('writes one product per part and one placed component per instance, named after the files', () => {
    const p = plate();
    const q = pin();
    const back = readBack(
      k.exportAssemblyStep(
        '夾具',
        [
          { shape: p, name: '定位板' },
          { shape: q, name: '削邊銷' },
        ],
        [
          { part: 0, name: '定位板<1>', ...poses.origin },
          { part: 1, name: '削邊銷<1>', ...poses.moved },
          { part: 1, name: '削邊銷<2>', ...poses.turned },
        ],
      ),
    );
    expect(back.root).toBe('夾具');
    expect(back.isAssembly).toBe(true);
    expect(back.volumes.size).toBe(2);
    expect(back.items.map((i) => i.product)).toEqual(['定位板', '削邊銷', '削邊銷']);
    expect(back.items.map((i) => i.name)).toEqual(['定位板<1>', '削邊銷<1>', '削邊銷<2>']);
    expect(back.volumes.get('定位板')).toBeCloseTo(60000, 6);
    expect(back.volumes.get('削邊銷')).toBeCloseTo(720, 6);
  });

  it('gives every instance the pose it was given, to within 1e-6', () => {
    const q = pin();
    const inst = [
      { part: 0, name: 'a', ...poses.origin },
      { part: 0, name: 'b', ...poses.moved },
      { part: 0, name: 'c', ...poses.turned },
    ];
    const back = readBack(k.exportAssemblyStep('A', [{ shape: q, name: 'P' }], inst));
    expect(back.items).toHaveLength(3);
    inst.forEach((want, i) => {
      const got = back.items[i]!;
      want.position.forEach((v, j) => expect(got.origin[j]).toBeCloseTo(v, 6));
      rotationMatrix(want.rotation).forEach((v, j) => expect(got.matrix[j]).toBeCloseTo(v, 6));
    });
  });

  it('writes a part used twice once (each instance is a placed reference to it)', () => {
    const q = pin();
    const text = k.exportAssemblyStep('A', [{ shape: q, name: 'P' }], [{ part: 0, name: 'a', ...poses.turned }, { part: 0, name: 'b', ...poses.moved }]);
    expect(text.match(/MANIFOLD_SOLID_BREP/g)?.length).toBe(1);
  });

  it('is millimetres by default and inches when asked', () => {
    const q = pin();
    const one = [{ part: 0, name: 'a', ...poses.moved }];
    expect(k.exportAssemblyStep('A', [{ shape: q, name: 'P' }], one)).toMatch(/SI_UNIT\(\.MILLI\.,\.METRE\.\)/);
    expect(k.exportAssemblyStep('A', [{ shape: q, name: 'P' }], one, 'INCH')).toMatch(/INCH/i);
  });

  it('refuses an assembly without components, a missing part, and a pose that is not one', () => {
    const q = pin();
    const parts = [{ shape: q, name: 'P' }];
    expect(() => k.exportAssemblyStep('A', parts, [])).toThrow(KernelError);
    expect(() => k.exportAssemblyStep('A', parts, [{ part: 3, name: 'x', ...poses.origin }])).toThrow('零件不存在');
    expect(() => k.exportAssemblyStep('A', parts, [{ part: 0, name: 'x', ...poses.origin, rotation: [0, 0, 0, 2] }])).toThrow('位姿無效');
    expect(() => k.exportAssemblyStep('A', parts, [{ part: 0, name: 'x', ...poses.origin, position: [NaN, 0, 0] }])).toThrow('位姿無效');
  });

  it('does not leak shape handles', () => {
    const before = k.liveShapes;
    const q = pin();
    k.exportAssemblyStep('A', [{ shape: q, name: 'P' }], [{ part: 0, name: 'a', ...poses.moved }]);
    expect(k.liveShapes).toBe(before + 1);
  });
});
