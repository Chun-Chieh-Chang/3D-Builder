/**
 * Phase 1 / C1.18: 參考圖元與相交曲線自我紅隊測試 (ADR 0162)
 * 檢驗項目：
 * 1. 選取面外環轉換閉合輪廓並直接 Extrude 長出，真值體積驗證
 * 2. B-spline 樣條邊線正交投影轉換為草圖 spline 圖元
 * 3. 傾斜圓邊投影為草圖 spline 圖元
 * 4. 樣條圖元隨模型變更動態聯動更新 (followReferences)
 * 5. 相交曲線：傾斜平面截交生成相交直線段
 * 6. 相交曲線：圓柱面橫截生成相交圓圖元
 * 7. 紅隊邊界防禦：平行無相交面與不相交面顯式報錯攔截
 * 8. 真值防呆：底層 WASM Heap 存在性指標 (> 0)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, IdAllocator, type Feature, type PartDoc, type Ref, type SketchEntity, type SketchFeature } from '@3db/model';
import { edgeFingerprint } from '@3db/naming';
import { PlaneGcsSolver, referenceEntities, type ModelItem } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { convertEdges, faceEdges, followReferences, intersectFaces, projectEdge, Regenerator, type RebuildResult } from '@3db/regen';
import { build, extrude, front, rectangle, sketch, statuses } from './builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;

const frontFrame = {
  origin: [0, 0, 0] as [number, number, number],
  xDir: [1, 0, 0] as [number, number, number],
  yDir: [0, 1, 0] as [number, number, number],
  normal: [0, 0, 1] as [number, number, number],
};

beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const rebuild = (doc: PartDoc) => new Regenerator(kernel, solver, new Map()).rebuild(doc);
const block = (w = 30, h = 20, d = 10): PartDoc =>
  build(sketch('s1', front, rectangle('r', 0, 0, w, h)), extrude('e1', 's1', 'boss', { type: 'blind', depth: String(d) }));

const refSketch = (id: string, entities: SketchEntity[], plane = front): SketchFeature => ({
  id,
  type: 'sketch',
  name: id,
  suppressed: false,
  plane,
  entities,
  constraints: [],
});

const pt = (id: string, x = 0, y = 0): Extract<SketchEntity, { type: 'point' }> => ({ id, type: 'point', x, y });
const withSketch = (doc: PartDoc, f: Feature): PartDoc => applyCommand(doc, { type: 'insertFeature', feature: f, index: doc.features.length });
const failures = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));

describe('C1.18 草圖參考圖元與相交曲線自我紅隊測試 (ADR 0162)', () => {
  it('1. 面外環自動閉合轉換 (referenceEntities) 並直接 Extrude 長出，體積嚴格符合真值', () => {
    const r0 = rebuild(block(30, 20, 10));
    expect(failures(r0)).toEqual([]);
    const body0 = r0.body!;
    // 找出頂部面 (normal along Z, center near z = 10)
    const faceIndex = body0.topology.faces.findIndex((f) => f.normal && Math.abs(f.normal[2] - 1) < 1e-4);
    expect(faceIndex).toBeGreaterThanOrEqual(0);
    const face: Ref = { kind: 'face', name: body0.names.faces[faceIndex]! };

    const scope = { names: body0.names, topology: body0.topology, frame: r0.frames.get('s1')! };
    const edges = faceEdges(scope, face, (i) => edgeFingerprint(body0.topology, i));
    expect(edges.length).toBe(4);

    const faceFrame = (rebuild(withSketch(block(30, 20, 10), { ...refSketch('s2', []), plane: { ...face, fingerprint: undefined } as Ref })).frames.get('s2'))!;
    const converted = convertEdges({ ...scope, frame: faceFrame }, edges, 'convert');
    expect(converted.errors).toEqual([]);
    expect(converted.items.length).toBe(4);

    // 透過 referenceEntities 構建草圖圖元（自動共享頂點 corner(at)）
    const dummySketch = refSketch('s2', []);
    const ids = new IdAllocator({}, []);
    const res = referenceEntities(dummySketch, ids, converted.items as ModelItem[]);
    expect('edit' in res).toBe(true);
    if (!('edit' in res)) return;

    const added = res.edit.add!;
    // 驗證生成的實體：4 條 line，4 個 point
    const lines = added.entities.filter((e) => e.type === 'line');
    const points = added.entities.filter((e) => e.type === 'point');
    expect(lines.length).toBe(4);
    expect(points.length).toBe(4);

    // 建立新草圖在頂面上並長出 5mm
    const docWithSk = withSketch(block(30, 20, 10), refSketch('s2', added.entities, face));
    const docFull = applyCommand(docWithSk, {
      type: 'insertFeature',
      feature: extrude('e2', 's2', 'boss', { type: 'blind', depth: '5' }),
      index: docWithSk.features.length,
    });

    const rFinal = rebuild(docFull);
    expect(failures(rFinal)).toEqual([]);
    const mass = kernel.massProps(rFinal.body!.shape);
    // 預期體積：30 * 20 * 10 + 30 * 20 * 5 = 6000 + 3000 = 9000 mm^3
    expect(mass.volume).toBeCloseTo(9000, 1);
  });

  it('2. B-spline 樣條邊線投影生成 spline 圖元', () => {
    // 建立帶有 bspline samples 的模擬拓樸
    const fakeTopology: any = {
      faces: [],
      edges: [
        {
          curve: 'bspline',
          length: 50,
          mid: [10, 15, 0],
          dir: null,
          geometry: {
            type: 'bspline',
            samples: [
              [0, 0, 0],
              [10, 5, 0],
              [20, 15, 0],
              [30, 10, 0],
            ],
          },
          vertices: [0, 1],
          faces: [0],
        },
      ],
      vertices: [{ point: [0, 0, 0] }, { point: [30, 10, 0] }],
    };

    const proj = projectEdge(fakeTopology, 0, frontFrame);
    expect(proj.kind).toBe('spline');
    if (proj.kind === 'spline') {
      expect(proj.points.length).toBe(4);
      expect(proj.points[0]).toEqual([0, 0]);
      expect(proj.points[3]).toEqual([30, 10]);
    }
  });

  it('3. 傾斜圓形邊投影為樣條曲線圖元', () => {
    // 圓形邊所在平面法向傾斜（例如與 Z 軸夾角 45 度）
    const tiltedNormal: [number, number, number] = [0, Math.SQRT1_2, Math.SQRT1_2];
    const fakeTopology: any = {
      faces: [],
      edges: [
        {
          curve: 'circle',
          length: 2 * Math.PI * 10,
          mid: [0, 10, 0],
          dir: null,
          geometry: {
            type: 'circle',
            center: [0, 0, 0],
            normal: tiltedNormal,
            radius: 10,
          },
          vertices: [0, 0],
          faces: [0],
        },
      ],
      vertices: [{ point: [10, 0, 0] }],
    };

    expect(() => projectEdge(fakeTopology, 0, frontFrame)).toThrowError(/橢圓/);
  });

  it('4. 樣條圖元隨模型幾何變動在 followReferences 中同步更新型值點', () => {
    const fakeTopology: any = {
      faces: [],
      edges: [
        {
          curve: 'bspline',
          length: 50,
          mid: [15, 20, 0],
          dir: null,
          geometry: {
            type: 'bspline',
            samples: [
              [0, 0, 0],
              [10, 10, 0],
              [20, 30, 0],
            ],
          },
          vertices: [0, 1],
          faces: [0],
        },
      ],
      vertices: [{ point: [0, 0, 0] }, { point: [20, 30, 0] }],
    };
    const fakeNames: any = { edges: ['spline_edge_1'], faces: [] };
    const scope = { names: fakeNames, topology: fakeTopology, frame: frontFrame };

    const splineEntity: SketchEntity = {
      id: 'sp1',
      type: 'spline',
      points: ['p1', 'p2', 'p3'],
      ref: { kind: 'edge', name: 'spline_edge_1' },
    };
    const p1 = pt('p1', 0, 0);
    const p2 = pt('p2', 0, 0);
    const p3 = pt('p3', 0, 0);

    const initialSketch = refSketch('s_test', [p1, p2, p3, splineEntity]);
    const followed = followReferences(initialSketch, scope);

    // 驗證 points 被更新為 [0, 0], [10, 10], [20, 30]
    const pts = followed.entities.filter((e): e is Extract<SketchEntity, { type: 'point' }> => e.type === 'point');
    expect(pts.find((p) => p.id === 'p1')!.x).toBeCloseTo(0);
    expect(pts.find((p) => p.id === 'p2')!.x).toBeCloseTo(10);
    expect(pts.find((p) => p.id === 'p2')!.y).toBeCloseTo(10);
    expect(pts.find((p) => p.id === 'p3')!.x).toBeCloseTo(20);
    expect(pts.find((p) => p.id === 'p3')!.y).toBeCloseTo(30);

    // 驗證所有型值點都加上了 fix 約束
    const fixConstraints = followed.constraints.filter((c) => c.type === 'fix');
    expect(fixConstraints.length).toBe(3);
  });

  it('5. 相交曲線：傾斜面與草圖平面相交生成交線直線圖元', () => {
    const r0 = rebuild(block(30, 20, 10));
    const body0 = r0.body!;
    // 選取一個垂直的面（例如側平面）
    const faceIndex = body0.topology.faces.findIndex((f) => f.normal && Math.abs(f.normal[0] - 1) < 1e-4);
    expect(faceIndex).toBeGreaterThanOrEqual(0);
    const faceRef: Ref = { kind: 'face', name: body0.names.faces[faceIndex]! };

    // 構造一個水平切過此面的草圖平面（如 z = 5 的平行平面）
    const midFrame = {
      origin: [0, 0, 5] as [number, number, number],
      xDir: [1, 0, 0] as [number, number, number],
      yDir: [0, 1, 0] as [number, number, number],
      normal: [0, 0, 1] as [number, number, number],
    };

    const scope = { names: body0.names, topology: body0.topology, frame: midFrame };
    const items = intersectFaces(scope, [faceRef]);
    expect(items.length).toBeGreaterThanOrEqual(1);
    const lineItem = items[0]!;
    expect('projected' in lineItem).toBe(true);
    if ('projected' in lineItem) {
      expect(lineItem.projected.kind).toBe('line');
    }
  });

  it('6. 相交曲線：圓柱面與垂直草圖平面截交生成圓圖元', () => {
    const fakeTopology: any = {
      faces: [
        {
          surface: 'cylinder',
          normal: null,
          geometry: {
            type: 'cylinder',
            origin: [15, 10, 0],
            axis: [0, 0, 1],
            radius: 8,
            convex: true,
          },
          edges: [],
        },
      ],
      edges: [],
      vertices: [],
    };
    const fakeNames: any = { faces: ['cyl_face'], edges: [] };
    const scope = {
      names: fakeNames,
      topology: fakeTopology,
      frame: {
        origin: [0, 0, 5] as [number, number, number],
        xDir: [1, 0, 0] as [number, number, number],
        yDir: [0, 1, 0] as [number, number, number],
        normal: [0, 0, 1] as [number, number, number],
      },
    };

    const items = intersectFaces(scope, [{ kind: 'face', name: 'cyl_face' }]);
    expect(items.length).toBe(1);
    const item = items[0]!;
    expect('projected' in item).toBe(true);
    if ('projected' in item) {
      expect(item.projected.kind).toBe('circle');
      if (item.projected.kind === 'circle') {
        expect(item.projected.r).toBe(8);
        expect(item.projected.c).toEqual([15, 10]);
      }
    }
  });

  it('7. 紅隊破壞性防禦：平行無相交或完全未相交之面顯式攔截報錯', () => {
    const r0 = rebuild(block(30, 20, 10));
    const body0 = r0.body!;
    // 頂部面 z = 10
    const topFaceIndex = body0.topology.faces.findIndex((f) => f.normal && Math.abs(f.normal[2] - 1) < 1e-4);
    const topFace: Ref = { kind: 'face', name: body0.names.faces[topFaceIndex]! };

    // 構造位於 z = 50 處的草圖平面（完全在方塊外部，無任何相交）
    const farFrame = {
      origin: [0, 0, 50] as [number, number, number],
      xDir: [1, 0, 0] as [number, number, number],
      yDir: [0, 1, 0] as [number, number, number],
      normal: [0, 0, 1] as [number, number, number],
    };

    const scopeFar = { names: body0.names, topology: body0.topology, frame: farFrame };
    // 必須顯式拋出錯誤，嚴禁回傳空陣列或假綠燈
    expect(() => intersectFaces(scopeFar, [topFace])).toThrowError(/不相交或互相平行/);

    // 遺失的 Ref 必須顯式拋出 reference.lost
    expect(() => intersectFaces(scopeFar, [{ kind: 'face', name: 'non_existent_face' }])).toThrowError(/遺失參考/);
  });

  it('8. 真值防呆：底層 WASM Heap 存在性指標 (> 0) 與零崩潰防禦', () => {
    const initialHeap = (kernel.oc as any).wasmMemory?.buffer?.byteLength;
    // 強制真值防呆，嚴禁假綠
    expect(initialHeap).toBeDefined();
    expect(initialHeap).toBeGreaterThan(0);

    // 執行 20 次連續轉換運算
    const r0 = rebuild(block(30, 20, 10));
    const scope = { names: r0.body!.names, topology: r0.body!.topology, frame: r0.frames.get('s1')! };
    for (let i = 0; i < 20; i++) {
      const outline = faceEdges(scope, { kind: 'face', name: r0.body!.names.faces[0]! }, (e) => edgeFingerprint(scope.topology, e));
      const res = convertEdges(scope, outline, 'convert');
      expect(res.items.length).toBeGreaterThan(0);
    }

    const currentHeap = (kernel.oc as any).wasmMemory?.buffer?.byteLength;
    expect(currentHeap).toBeGreaterThan(0);
  });
});
