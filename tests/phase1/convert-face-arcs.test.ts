/**
 * 「轉換實體引用」點一個含圓弧的面（整面一次轉入）：共用的角點不得讓草圖過多定義。
 *
 * 缺陷（2026-11-04，以 SolidWorks 轉出的 STEP 實測發現）：引用的圓弧固定圓心與起點，再以弦長決定終點。
 * 1. 整面轉入時相鄰圖元共用角點，終點若同時被相鄰圖元固定，弦長與圓弧規則就成了多餘的方程式（每段圓弧多 1 個）。
 * 2. 半圓的弦長等於直徑，弦長拘束在那裡是奇異的，單獨一段也被判為過多定義（STEP 常把整圓拆成兩個半圓）。
 * 修正：引用的圓弧三點全部固定，PlaneGCS 對這種圓弧以三點決定半徑與兩個角度，取代圓弧規則（planegcs.ts `heldArcs`）。
 * 這裡以真實 kernel 與 PlaneGCS 驗證：單獨一段半圓、圓角方塊的頂面（4 直線 + 4 圓弧）、兩段圓弧首尾相接的孔，以及兩者合併。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, IdAllocator, type Feature, type PartDoc, type Ref, type SketchEntity, type SketchFeature } from '@3db/model';
import { edgeFingerprint } from '@3db/naming';
import { PlaneGcsSolver, referenceEntities, type ModelItem } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { convertEdges, faceEdges, followReferences, Regenerator, type RebuildResult } from '@3db/regen';
import { build, extrude, fillet, front, rectangle, sketch, statuses } from './builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;

beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const W = 30, H = 20, D = 10, R = 3;
const rebuild = (doc: PartDoc) => new Regenerator(kernel, solver, new Map()).rebuild(doc);
const failures = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));
const insert = (doc: PartDoc, f: Feature) => applyCommand(doc, { type: 'insertFeature', feature: f, index: doc.features.length });
const empty = (id: string, plane: Ref): SketchFeature => ({ id, type: 'sketch', name: id, suppressed: false, plane, entities: [], constraints: [] });

/** A W × H × D block; `round` fillets its four vertical edges with radius R; `hole` cuts a hole of radius 4 drawn as two half arcs. */
function part(round: boolean, hole: boolean): PartDoc {
  let doc = build(sketch('s1', front, rectangle('r', 0, 0, W, H)), extrude('e1', 's1', 'boss', { type: 'blind', depth: String(D) }));
  if (round) {
    const r = rebuild(doc);
    const t = r.body!.topology;
    const vertical = t.edges.flatMap((e, i) => (e.dir && Math.abs(Math.abs(e.dir[2]) - 1) < 1e-9 ? [{ kind: 'edge', name: r.body!.names.edges[i]!, fingerprint: edgeFingerprint(t, i) } as Ref] : []));
    expect(vertical.length).toBe(4);
    doc = insert(doc, fillet('f1', vertical, String(R)));
  }
  if (hole) {
    // a lens: two arcs of radius 5 whose centers are 6 apart, meeting at (cx, cy ± 4); each arc's end is the other's start, as the two
    // halves of a circle in a STEP file are (OCCT would merge two halves of one circle drawn here into a single circular edge)
    const [cx, cy] = [W / 2, H / 2];
    const entities: SketchEntity[] = [
      { id: 'hr', type: 'point', x: cx + 3, y: cy },
      { id: 'hl', type: 'point', x: cx - 3, y: cy },
      { id: 'ht', type: 'point', x: cx, y: cy + 4 },
      { id: 'hb', type: 'point', x: cx, y: cy - 4 },
      { id: 'h1', type: 'arc', center: 'hr', start: 'ht', end: 'hb' },
      { id: 'h2', type: 'arc', center: 'hl', start: 'hb', end: 'ht' },
    ];
    doc = insert(doc, { ...sketch('s3', front), entities, constraints: [
      { id: 'k1', type: 'fix', point: 'hr' },
      { id: 'k2', type: 'fix', point: 'hl' },
      { id: 'k3', type: 'fix', point: 'ht' },
    ] } as Feature);
    // the front plane is the block's bottom: a cut from a datum plane goes along its normal only when reversed (AGENTS.md 2026-11-02)
    doc = insert(doc, extrude('e3', 's3', 'cut', { type: 'throughAll', reverse: true }));
  }
  return doc;
}

/** The top face's outline converted in one go, as a click on the face with 「轉換實體引用」 makes it. */
function convertTop(doc: PartDoc) {
  const r0 = rebuild(doc);
  expect(failures(r0)).toEqual([]);
  const body = r0.body!;
  const i = body.topology.faces.findIndex((f) => f.normal && Math.abs(f.normal[2] - 1) < 1e-9 && f.surface === 'plane');
  expect(i).toBeGreaterThanOrEqual(0);
  const top: Ref = { kind: 'face', name: body.names.faces[i]! };
  const withSketch = insert(doc, empty('s2', top));
  const r1 = rebuild(withSketch);
  const scope = { names: body.names, topology: body.topology, frame: r1.frames.get('s2')! };
  const converted = convertEdges(scope, faceEdges(scope, top, (e) => edgeFingerprint(body.topology, e)), 'convert');
  expect(converted.errors).toEqual([]);
  const res = referenceEntities(empty('s2', top), new IdAllocator({}, []), converted.items as ModelItem[]);
  if (!('edit' in res)) throw new Error('no edit');
  const s2: SketchFeature = { ...empty('s2', top), entities: res.edit.add!.entities };
  return { doc, s2, scope, kinds: converted.items.map((x) => ('projected' in x ? x.projected.kind : '?')) };
}

describe('轉換實體引用：單獨一段半圓', () => {
  // STEP 常把整圓拆成兩個半圓：舊的弦長拘束在弦長等於直徑時是奇異的（兩個圓只相切於一點），單獨一段就被判為過多定義
  it('引用的 180° 圓弧完全定義', () => {
    const topology: any = {
      faces: [], vertices: [{ point: [5, 0, 0] }, { point: [-5, 0, 0] }],
      edges: [{ curve: 'circle', length: 5 * Math.PI, mid: [0, 5, 0], dir: null, geometry: { type: 'circle', center: [0, 0, 0], normal: [0, 0, 1], radius: 5 }, vertices: [0, 1], faces: [] }],
    };
    const scope = { names: { faces: [], edges: ['e'], vertices: [] } as any, topology, frame: { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } as any };
    const s: SketchFeature = { ...empty('s', front), entities: [
      { id: 'c', type: 'point', x: 0, y: 0 }, { id: 'a', type: 'point', x: 5, y: 0 }, { id: 'b', type: 'point', x: -5, y: 0 },
      { id: 'arc', type: 'arc', center: 'c', start: 'a', end: 'b', ref: { kind: 'edge', name: 'e' } },
    ] };
    const r = solver.solve(followReferences(s, scope));
    expect(r.status).toBe('fully');
  });
});

describe('轉換實體引用：整面一次轉入含圓弧的輪廓', () => {
  for (const [label, round, hole, arcs, lines] of [
    ['圓角方塊頂面（4 直線 + 4 圓弧）', true, false, 4, 4],
    ['方塊頂面＋兩段圓弧首尾相接的孔', false, true, 2, 4],
    ['圓角方塊頂面＋兩段圓弧首尾相接的孔', true, true, 6, 4],
  ] as const) {
    it(`${label}：試算不過多定義、完全定義，伸長的體積吻合`, () => {
      const { doc, s2, scope, kinds } = convertTop(part(round, hole));
      expect(kinds.filter((k) => k === 'arc').length).toBe(arcs);
      expect(kinds.filter((k) => k === 'line').length).toBe(lines);
      // every converted edge is in the sketch, following its edge
      expect(s2.entities.filter((e) => e.type !== 'point' && 'ref' in e && e.ref).length).toBe(arcs + lines);

      const solved = solver.solve(followReferences(s2, scope));
      expect(solved.status).toBe('fully');

      // the converted outline extrudes: 5 mm up from the top face
      const full = insert(insert(doc, s2), extrude('e2', 's2', 'boss', { type: 'blind', depth: '5' }));
      const r = rebuild(full);
      expect(failures(r)).toEqual([]);
      const corner = round ? (4 - Math.PI) * R * R : 0;
      // the lens: two circular segments of radius 5 with half-chord 4 (half-angle acos(3/5))
      const holeArea = hole ? 2 * (25 * Math.acos(3 / 5) - 3 * 4) : 0;
      const area = W * H - corner - holeArea;
      expect(kernel.massProps(r.body!.shape).volume).toBeCloseTo(area * (D + 5), 1);
    });
  }
});
