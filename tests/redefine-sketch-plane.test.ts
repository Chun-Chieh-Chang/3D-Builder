import { beforeAll, describe, expect, it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { Regenerator } from '@3db/regen';
import { applyCommand, type PartDoc, type SketchFeature } from '@3db/model';
import { parentsOf } from '@3db/regen';

describe('redefineSketchPlane (編輯草圖基準面)', () => {
  let kernel: Kernel;
  let solver: PlaneGcsSolver;

  beforeAll(async () => {
    kernel = await Kernel.load();
    solver = await PlaneGcsSolver.create();
  });

  const rebuild = (doc: PartDoc) => new Regenerator(kernel, solver, new Map()).rebuild(doc);

  it('updates sketch plane and updates DAG dependencies', () => {
    const doc: PartDoc = {
      schemaVersion: 54,
      kind: 'part',
      features: [
        {
          id: 'sk1',
          name: '草圖1',
          type: 'sketch',
          suppressed: false,
          plane: { kind: 'datum', name: 'plane:front' },
          entities: [
            { id: 'p1', type: 'point', x: 0, y: 0 },
            { id: 'p2', type: 'point', x: 10, y: 0 },
            { id: 'p3', type: 'point', x: 10, y: 10 },
            { id: 'p4', type: 'point', x: 0, y: 10 },
            { id: 'l1', type: 'line', p1: 'p1', p2: 'p2' },
            { id: 'l2', type: 'line', p2: 'p3', p1: 'p2' },
            { id: 'l3', type: 'line', p1: 'p3', p2: 'p4' },
            { id: 'l4', type: 'line', p1: 'p4', p2: 'p1' },
          ],
          constraints: [
            { id: 'c1', type: 'coincident', a: 'p1', b: '@origin' },
            { id: 'c2', type: 'horizontal', a: 'l1' },
            { id: 'c3', type: 'vertical', a: 'l2' },
            { id: 'c4', type: 'horizontal', a: 'l3' },
            { id: 'c5', type: 'vertical', a: 'l4' },
            { id: 'd1', type: 'distance', a: 'p1', b: 'p2', value: '10' },
            { id: 'd2', type: 'distance', a: 'p2', b: 'p3', value: '10' },
          ],
        },
        {
          id: 'ext1',
          name: '伸長1',
          type: 'extrude',
          op: 'boss',
          sketch: 'sk1',
          dir1: { type: 'blind', depth: '20' },
          suppressed: false,
        },
      ],
      bodies: {},
      variables: [],
      properties: {},
      visibility: {},
      appearances: [],
      idCounters: { point: 10, line: 10, constraint: 10, dimension: 10 },
      displayUnits: { length: 'mm', angle: 'deg' },
      rollbackIndex: null,
      blobs: [],
    };

    // 1. 默認基準面沒有父特徵（parents 為 []）
    const sk1 = doc.features[0] as SketchFeature;
    expect(sk1.plane.name).toBe('plane:front');
    expect(parentsOf(sk1, doc)).toEqual([]);

    // 2. 初始重建成功
    const r1 = rebuild(doc);
    expect(r1.features.find((f) => f.id === 'ext1')?.status).toBe('ok');
    expect(r1.body).toBeDefined();

    // 3. 執行指令：切換至 plane:right
    const doc2 = applyCommand(doc, {
      type: 'redefineSketchPlane',
      featureId: 'sk1',
      plane: { kind: 'datum', name: 'plane:right' },
    });

    // 4. 驗證 plane 已變更，重建正常
    const sk1_v2 = doc2.features[0] as SketchFeature;
    expect(sk1_v2.plane.name).toBe('plane:right');
    expect(parentsOf(sk1_v2, doc2)).toEqual([]);

    const r2 = rebuild(doc2);
    expect(r2.features.find((f) => f.id === 'ext1')?.status).toBe('ok');
    expect(r2.body).toBeDefined();
    expect(kernel.massProps(r2.body!.shape).volume).toBeCloseTo(2000, 1);

    // 5. 測試切換到自訂基準面特徵時，DAG 正確記錄父依賴
    const docWithDatum = applyCommand(doc2, {
      type: 'insertFeature',
      index: 0,
      feature: {
        id: 'datum1',
        name: '基準面1',
        type: 'refPlane',
        suppressed: false,
        def: { mode: 'offset', plane: { kind: 'datum', name: 'plane:top' }, distance: '15' },
      },
    });
    const doc3 = applyCommand(docWithDatum, {
      type: 'redefineSketchPlane',
      featureId: 'sk1',
      plane: { kind: 'datum', name: 'datum1' },
    });
    const sk1_v3 = doc3.features.find((f) => f.id === 'sk1') as SketchFeature;
    expect(sk1_v3.plane.name).toBe('datum1');
    expect(parentsOf(sk1_v3, doc3)).toEqual(['datum1']);
  });

  it('refuses a plane that was never made', () => {
    // Before, the reference was stored as given, so the DAG grew a parent that resolves to nothing: every
    // rebuild that touched the sketch failed later, far from the command that caused it.
    const doc: PartDoc = {
      schemaVersion: 54,
      kind: 'part',
      features: [
        { id: 'sk1', name: '草圖1', type: 'sketch', suppressed: false, plane: { kind: 'datum', name: 'plane:front' }, entities: [], constraints: [] },
        { id: 'ext1', name: '伸長1', type: 'extrude', op: 'boss', sketch: 'sk1', dir1: { type: 'blind', depth: '5' }, suppressed: false },
      ],
      bodies: {},
      variables: [],
      properties: {},
      visibility: {},
      appearances: [],
      idCounters: { point: 10, line: 10, constraint: 10, dimension: 10 },
      displayUnits: { length: 'mm', angle: 'deg' },
      rollbackIndex: null,
      blobs: [],
    };

    expect(() => applyCommand(doc, { type: 'redefineSketchPlane', featureId: 'sk1', plane: { kind: 'datum', name: 'ghost' } })).toThrow();

    // The original document is untouched: the command layer rejects before anything is written.
    expect((doc.features[0] as SketchFeature).plane.name).toBe('plane:front');
  });

  it('refuses a datum plane later in the history than the sketch', () => {
    // A sketch may only sit on geometry that already exists. insertFeature enforces this when the sketch is
    // first placed; redefining the plane must not be the way around it.
    const doc: PartDoc = {
      schemaVersion: 54,
      kind: 'part',
      features: [
        { id: 'sk1', name: '草圖1', type: 'sketch', suppressed: false, plane: { kind: 'datum', name: 'plane:front' }, entities: [], constraints: [] },
        { id: 'later1', name: '較晚基準面', type: 'refPlane', suppressed: false, def: { mode: 'offset', plane: { kind: 'datum', name: 'plane:top' }, distance: '5' } },
      ],
      bodies: {},
      variables: [],
      properties: {},
      visibility: {},
      appearances: [],
      idCounters: { point: 10, line: 10, constraint: 10, dimension: 10 },
      displayUnits: { length: 'mm', angle: 'deg' },
      rollbackIndex: null,
      blobs: [],
    };

    expect(() => applyCommand(doc, { type: 'redefineSketchPlane', featureId: 'sk1', plane: { kind: 'datum', name: 'later1' } })).toThrow();
    expect((doc.features[0] as SketchFeature).plane.name).toBe('plane:front');

    // Moved earlier, the same plane is fine — the rule is about position in the history, not about the plane.
    const moved = applyCommand(doc, { type: 'arrange', order: ['later1', 'sk1'] });
    const ok = applyCommand(moved, { type: 'redefineSketchPlane', featureId: 'sk1', plane: { kind: 'datum', name: 'later1' } });
    expect((ok.features.find((f) => f.id === 'sk1') as SketchFeature).plane.name).toBe('later1');
  });
});
