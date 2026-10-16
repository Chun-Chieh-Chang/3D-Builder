/**
 * Parity 執行器：每支 YouTube 影片的規格檔（cases/）在此重建並比對期望不變量。
 * 比對前所有特徵必須重建成功；比對容差依信賴等級 A/B/C 分級（見 types.ts）。
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Kernel, type FaceInfo, type ShapeId } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { Regenerator } from '@3db/regen';
import { parityCases } from './cases';
import type { FaceCountExpect, ParityCase } from './types';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const shapes: ShapeId[] = [];

beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});
afterAll(() => shapes.forEach((s) => kernel.release(s)));

const VOLUME_REL = { A: 0.005, B: 0.02, C: 0.05 } as const;
const BBOX_ABS = { A: 0.05, B: 0.05, C: 0.5 } as const;

const sortedDims = (t: { vertices: { point: [number, number, number] }[] }): [number, number, number] => {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const v of t.vertices) {
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, v.point[i]!);
      max[i] = Math.max(max[i]!, v.point[i]!);
    }
  }
  return [max[0]! - min[0]!, max[1]! - min[1]!, max[2]! - min[2]!] as [number, number, number];
};

const faceCounts = (faces: FaceInfo[]) => {
  const c = { planes: 0, cylinders: 0, cones: 0, spheres: 0, toruses: 0, bsplines: 0, other: 0 };
  for (const f of faces) {
    const s = f.surface.toLowerCase();
    if (s === 'plane') c.planes++;
    else if (s === 'cylinder') c.cylinders++;
    else if (s === 'cone') c.cones++;
    else if (s === 'sphere') c.spheres++;
    else if (s === 'torus') c.toruses++;
    else if (s.includes('bspline')) c.bsplines++;
    else c.other++;
  }
  return c;
};

const checkCase = (c: ParityCase) => {
  const r = new Regenerator(kernel, solver, new Map()).rebuild(c.doc());
  const failed = r.features.filter((f) => f.status !== 'ok');
  expect(failed.map((f) => `${f.id}=${f.status}(${f.message ?? ''})`), `特徵重建失敗: ${c.id}`).toEqual([]);
  expect(r.bodies, `${c.id} 應為單一本體（影片零件）`).toHaveLength(1);
  const body = r.bodies[0]!.shape;
  shapes.push(body);
  const label = `${c.id} [trust ${c.trust}] ${c.source.label}`;

  if (c.expected.volume !== undefined) {
    const rel = c.tolerance?.volumeRel ?? VOLUME_REL[c.trust];
    const actual = kernel.massProps(body).volume;
    expect(Math.abs(actual - c.expected.volume) / c.expected.volume, `${label} 體積 ${actual} vs 期望 ${c.expected.volume}`).toBeLessThanOrEqual(rel);
  }
  if (c.expected.bbox) {
    const abs = c.tolerance?.bboxAbs ?? BBOX_ABS[c.trust];
    const actual = [...sortedDims(kernel.topology(body))].sort((a, b) => a - b);
    const want = [...c.expected.bbox].sort((a, b) => a - b);
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(actual[i]! - want[i]!), `${label} 外形尺寸第 ${i} 軸 ${actual[i]} vs ${want[i]}`).toBeLessThanOrEqual(abs);
    }
  }
  if (c.expected.faces) {
    const exp: FaceCountExpect = c.expected.faces;
    const faces = kernel.topology(body).faces;
    const counts = faceCounts(faces);
    const tol = exp.approx ? 1 : 0;
    const near = (a: number, e: number, what: string) => expect(Math.abs(a - e), `${label} ${what} ${a} vs ${e}`).toBeLessThanOrEqual(tol);
    near(faces.length, exp.total, '面總數');
    if (exp.planes !== undefined) near(counts.planes, exp.planes, '平面數');
    if (exp.cylinders !== undefined) near(counts.cylinders, exp.cylinders, '圓柱面數');
    if (exp.cones !== undefined) near(counts.cones, exp.cones, '圓錐面數');
    if (exp.spheres !== undefined) near(counts.spheres, exp.spheres, '球面數');
    if (exp.toruses !== undefined) near(counts.toruses, exp.toruses, '圓環面數');
    if (exp.bsplines !== undefined) near(counts.bsplines, exp.bsplines, 'B-spline 面數');
  }
};

it.each(parityCases)('$id', checkCase);
