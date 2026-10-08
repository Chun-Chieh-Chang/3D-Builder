/**
 * 5-4b (docs/phase5-plan.md): the drawing of an assembly (C16.6, C15.16) — the parts list as a table, the balloons that tie each item to its part in the view, where
 * the parts are in a view, and the document's tables for it. The rows are the parts list of 3b-4; the positions are worked out by hand.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyAssemblyCommand,
  applyDrawingCommand,
  buildBom,
  createEmptyAssembly,
  createEmptyDrawing,
  parseDrawing,
  serializeDrawing,
  viewVectors,
  type AssemblyDoc,
  type BomRow,
  type DrawingDoc,
  type Pose,
  type SourceTree,
} from '@3db/model';
import { readPartFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, drawingAnchors, projectDrawingView } from '@3db/regen';
import { balloonItems, bomColumns, bomTableItems, bomTableSize, buildScene, toSvg, type PlacedView, type ViewBom, type ViewLines } from '@3db/drawing';

const at: Pose = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
const comp = (id: string, file: string, instance: number) => ({ id, file, instance, fixed: false, placement: at });

/** 夾具: the locating plate and two pins. */
function jig(): AssemblyDoc {
  let d = createEmptyAssembly();
  d = applyAssemblyCommand(d, { type: 'insertComponent', file: { id: 'file1', path: '定位板.3dbx' }, component: comp('p1', 'file1', 1) });
  d = applyAssemblyCommand(d, { type: 'insertComponent', file: { id: 'file2', path: '零件/削邊銷.3dbx' }, component: comp('pa', 'file2', 1) });
  d = applyAssemblyCommand(d, { type: 'insertComponent', component: comp('pb', 'file2', 2) });
  return d;
}
const trees = (): Record<string, SourceTree> => ({
  p1: { kind: 'part', key: 'plate', path: '定位板.3dbx' },
  pa: { kind: 'part', key: 'pin', path: '零件/削邊銷.3dbx' },
  pb: { kind: 'part', key: 'pin', path: '零件/削邊銷.3dbx' },
});
const props: Record<string, Record<string, string>> = { pin: { 廠商: 'MISUMI', 料號: 'DP-8-31' }, plate: {} };
const rows = (): BomRow[] => buildBom({ doc: jig(), trees: trees(), propsOf: (k) => props[k] }).flat;

describe('the parts list as a table', () => {
  it('has the item, the name, the part number and the vendor (when a part has one), and the quantity: from the parts list of the assembly', () => {
    const r = rows();
    expect(r.map((x) => [x.item, x.name, x.qty])).toEqual([['1', '定位板', 1], ['2', '削邊銷', 2]]);
    expect(bomColumns(r).map((c) => c.header)).toEqual(['項次', '名稱', '料號', '廠商', '數量']);
    // with no part number or vendor anywhere those columns are left out
    expect(bomColumns(buildBom({ doc: jig(), trees: trees(), propsOf: () => ({}) }).flat).map((c) => c.header)).toEqual(['項次', '名稱', '數量']);
  });

  it('makes the name column wide enough for Chinese, which is drawn with a font 1.4 times the height of the text (it was not: the name ran over the line of the next column)', () => {
    const size = bomTableSize(rows());
    const name = bomColumns(rows()).findIndex((c) => c.header === '名稱');
    expect(size.widths[name]).toBeGreaterThanOrEqual(3 * 1.4 * 3.5 + 4 - 1e-9); // 削邊銷 / 定位板: three characters
  });

  it('is 7 high a row with a header, its upper left corner where the user put it or the lower right corner of the area (above the title block)', () => {
    const r = rows();
    const size = bomTableSize(r);
    expect(size.height).toBe(21); // header and two rows
    expect(size.widths).toHaveLength(5);
    const sheet = { size: 'A3', orientation: 'landscape', projection: 'first', scale: [1, 1] } as const;
    // the area of an A3 landscape sheet is {28, 66, 374, 213}: right 402, bottom 66
    const corner = bomTableItems({ id: 'tbl1', kind: 'bom', view: 'view1' }, r, sheet);
    const outer = corner.find((i) => i.kind === 'polyline' && i.style === 'visible' && i.closed)!;
    expect(outer.kind === 'polyline' && [outer.points[0], outer.points[1], outer.points[2], outer.points[5]]).toEqual([expect.closeTo(402 - size.width, 6), expect.closeTo(66, 6), 402, expect.closeTo(66 + 21, 6)]);
    const moved = bomTableItems({ id: 'tbl1', kind: 'bom', view: 'view1', at: [50, 200] }, r, sheet);
    const box = moved.find((i) => i.kind === 'polyline' && i.style === 'visible' && i.closed)!;
    expect(box.kind === 'polyline' && [box.points[0], box.points[5]]).toEqual([50, 200]);
    const texts = moved.flatMap((i) => (i.kind === 'text' ? [i.text] : []));
    expect(texts).toEqual(expect.arrayContaining(['項次', '名稱', '料號', '廠商', '數量', '1', '定位板', '2', '削邊銷', 'DP-8-31', 'MISUMI']));
    // a line under the header and one between the rows
    expect(moved.filter((i) => i.kind === 'polyline' && !i.closed && i.points.length === 4 && i.points[1] === i.points[3])).toHaveLength(2);
  });
});

describe('the balloons', () => {
  const placed: PlacedView = { id: 'view1', at: [200, 150], scale: 1, w: 100, h: 60, centre: [0, 0] };
  const bom: ViewBom = { rows: rows(), parts: [{ file: '定位板.3dbx', mirrored: false }, { file: '零件/削邊銷.3dbx', mirrored: false }, { file: '零件/削邊銷.3dbx', mirrored: false }] };
  const circles = (items: ReturnType<typeof balloonItems>) => items.filter((i) => i.kind === 'polyline' && i.closed && !i.filled && i.points.length === 72);

  it('each item has a circle with its number outside the view, a leader to a dot on its part (the first part of that file)', () => {
    const items = balloonItems(bom, [[0, 0], [30, 10], [-30, 10]], placed);
    expect(circles(items)).toHaveLength(2);
    expect(items.flatMap((i) => (i.kind === 'text' ? [i.text] : []))).toEqual(['1', '2']);
    expect(items.filter((i) => i.kind === 'polyline' && i.filled)).toHaveLength(2); // the dots
    // the dot of item 2 is on the first pin: (30, 10) in the view is (230, 160) on the sheet
    const dot = items.filter((i) => i.kind === 'polyline' && i.filled).map((i) => (i.kind === 'polyline' ? [i.points[0]! - 0.6, i.points[1]!] : []));
    expect(dot[1]![0]).toBeCloseTo(230, 6);
    expect(dot[1]![1]).toBeCloseTo(160, 6);
    // the circle is outside the box of the view (100 × 60 about (200, 150)) by the margin: its centre is at least 12 + 4 from … the box edge
    for (const c of circles(items)) {
      if (c.kind !== 'polyline') continue;
      const xs = c.points.filter((_, k) => k % 2 === 0);
      const ys = c.points.filter((_, k) => k % 2 === 1);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      expect(Math.abs(cx - 200) >= 50 + 12 - 1e-6 || Math.abs(cy - 150) >= 30 + 12 - 1e-6).toBe(true);
      expect((Math.max(...xs) - Math.min(...xs)) / 2).toBeCloseTo(4, 6);
    }
  });

  it('balloons that would overlap are slid apart along the edge: no two closer than 9 mm', () => {
    // three items whose parts are all at the middle: they all start on the same ray
    const many: ViewBom = { rows: [...rows(), { ...rows()[0]!, item: '3', name: 'x', path: 'x.3dbx' }], parts: [...bom.parts, { file: 'x.3dbx', mirrored: false }] };
    const items = balloonItems(many, [[10, 5], [10, 5], [10, 5], [10, 5]], placed);
    const centres = circles(items).map((c) => {
      if (c.kind !== 'polyline') return [0, 0];
      const xs = c.points.filter((_, k) => k % 2 === 0);
      const ys = c.points.filter((_, k) => k % 2 === 1);
      return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
    });
    expect(centres).toHaveLength(3);
    for (let i = 0; i < centres.length; i++) for (let j = i + 1; j < centres.length; j++) expect(Math.hypot(centres[i]![0]! - centres[j]![0]!, centres[i]![1]! - centres[j]![1]!)).toBeGreaterThanOrEqual(9 - 1e-9);
  });

  it('an item with no part in the view has no balloon, and a view with no anchors has none at all', () => {
    expect(circles(balloonItems({ rows: bom.rows, parts: [{ file: '定位板.3dbx', mirrored: false }] }, [[0, 0]], placed))).toHaveLength(1);
    expect(balloonItems(bom, undefined, placed)).toEqual([]);
    // a mirrored part is its own item
    expect(circles(balloonItems({ rows: [{ ...rows()[0]!, mirrored: true }], parts: [{ file: '定位板.3dbx', mirrored: false }] }, [[0, 0]], placed))).toHaveLength(0);
  });
});

describe('the scene of an assembly drawing', () => {
  it('draws the parts list and the balloons with the view; without balloons only the table', () => {
    const doc: DrawingDoc = applyDrawingCommand(applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views: [{ id: 'view1', name: '前視', source: 'a.3dba', direction: 'front' }] }), { type: 'insertTables', tables: [{ id: 'tbl1', kind: 'bom', view: 'view1', balloons: true }] });
    const lines: ViewLines = { visible: [[0, 0, 100, 0, 100, 60, 0, 60, 0, 0]], hidden: [], box: { min: [0, 0], max: [100, 60] }, anchors: [[50, 30], [20, 30], [80, 30]] };
    const bom: ViewBom = { rows: rows(), parts: [{ file: '定位板.3dbx', mirrored: false }, { file: '零件/削邊銷.3dbx', mirrored: false }, { file: '零件/削邊銷.3dbx', mirrored: false }] };
    const { scene } = buildScene(doc, new Map([['view1', lines]]), new Map(), new Map(), new Map([['view1', bom]]));
    const texts = scene.items.flatMap((i) => (i.kind === 'text' ? [i.text] : []));
    // the sheet has its own 1 (the scale 1:1 and the like): count what the table and the balloons add to it
    const bare = buildScene(applyDrawingCommand(doc, { type: 'deleteTables', tableIds: ['tbl1'] }), new Map([['view1', lines]])).scene.items.flatMap((i) => (i.kind === 'text' ? [i.text] : []));
    const count = (list: string[], s: string) => list.filter((t) => t === s).length;
    // the plate: item 1 and quantity 1 in the table and the 1 of its balloon; the pins: item 2 and quantity 2 in the table and the 2 of their balloon
    expect(count(texts, '1') - count(bare, '1')).toBe(3);
    expect(count(texts, '2') - count(bare, '2')).toBe(3);
    expect(texts).toContain('削邊銷');
    expect(toSvg(scene)).toContain('>定位板</text>');
    const plain = buildScene(applyDrawingCommand(doc, { type: 'setTable', tableId: 'tbl1', patch: { balloons: false } }), new Map([['view1', lines]]), new Map(), new Map(), new Map([['view1', bom]])).scene;
    expect(count(plain.items.flatMap((i) => (i.kind === 'text' ? [i.text] : [])), '1') - count(bare, '1')).toBe(2);
    // a view that is not an assembly has nothing to list
    const none = buildScene(doc, new Map([['view1', lines]])).scene;
    expect(none.items.flatMap((i) => (i.kind === 'text' ? [i.text] : [])).includes('定位板')).toBe(false);
  });
});

describe('the tables in the document', () => {
  const base = (): DrawingDoc => applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views: [{ id: 'view1', name: 'f', source: 'a.3dba', direction: 'front' }] });

  it('a parts list is inserted on a view, given balloons, moved, deleted; it takes no tolerance classes and a hole table takes no balloons', () => {
    let d = applyDrawingCommand(base(), { type: 'insertTables', tables: [{ id: 'tbl1', kind: 'bom', view: 'view1' }] });
    d = applyDrawingCommand(d, { type: 'setTable', tableId: 'tbl1', patch: { balloons: true, at: [30, 250] } });
    expect(d.tables[0]).toEqual({ id: 'tbl1', kind: 'bom', view: 'view1', balloons: true, at: [30, 250] });
    expect(parseDrawing(serializeDrawing(d))).toEqual(d);
    d = applyDrawingCommand(d, { type: 'setTable', tableId: 'tbl1', patch: { balloons: null, at: null } });
    expect(d.tables[0]).toEqual({ id: 'tbl1', kind: 'bom', view: 'view1' });
    expect(() => applyDrawingCommand(d, { type: 'setTable', tableId: 'tbl1', patch: { fits: { '6': 'H7' } } })).toThrow(/不屬於/);
    expect(() => applyDrawingCommand(d, { type: 'insertTables', tables: [{ id: 'tbl2', kind: 'bom', view: 'view1', fits: { '6': 'H7' } } as never] })).toThrow(/不屬於/);
    const h = applyDrawingCommand(base(), { type: 'insertTables', tables: [{ id: 'tbl1', kind: 'holes', view: 'view1' }] });
    expect(() => applyDrawingCommand(h, { type: 'setTable', tableId: 'tbl1', patch: { balloons: true } })).toThrow(/不屬於/);
    d = applyDrawingCommand(d, { type: 'deleteViews', viewIds: ['view1'] });
    expect(d.tables).toEqual([]);
  });
});

describe('where the parts of an assembly are in a view', () => {
  let kernel: Kernel;
  let regen: Regenerator;
  let plate: ReturnType<Kernel['copy']>;
  beforeAll(async () => {
    kernel = await Kernel.load();
    regen = new Regenerator(kernel, await PlaneGcsSolver.create());
    const doc = (await readPartFile(new Uint8Array(readFileSync(new URL('../golden/locating-plate.3dbx', import.meta.url))))).doc;
    plate = regen.rebuild(doc).body!.shape;
  });
  afterAll(() => regen.dispose());

  const pose = (x: number, y = 0, z = 0): Pose => ({ position: [x, y, z], rotation: [0, 0, 0, 1] });

  it('the middle of each part\'s mass, put where the part is and seen from the view: the plate moved 200 along x is 200 further right in the front view, level with the one at the origin', () => {
    const front = viewVectors('front');
    const [a, b] = drawingAnchors(kernel, [{ shape: plate, pose: pose(0), mirrored: false }, { shape: plate, pose: pose(200), mirrored: false }], front);
    expect(a![0]).toBeCloseTo(0, 6); // the plate is symmetric about x = 0
    expect(b![0]).toBeCloseTo(200, 6);
    expect(b![1]).toBeCloseTo(a![1], 6);
    expect(a![1]).toBeGreaterThan(5); // inside its 15 thickness
    expect(a![1]).toBeLessThan(10);
    // seen from the top the sheet's y is −z: a plate moved +30 along z is 30 lower
    const top = viewVectors('top');
    const [c, d] = drawingAnchors(kernel, [{ shape: plate, pose: pose(0), mirrored: false }, { shape: plate, pose: pose(0, 0, 30), mirrored: false }], top);
    expect(d![1]).toBeCloseTo(c![1]! - 30, 6);
    expect(d![0]).toBeCloseTo(c![0]!, 6);
  });

  it('is asked for as often as needed without leaking shapes, and the lines of the two plates are one view', () => {
    const live = kernel.liveShapes;
    const parts = [{ shape: plate, pose: pose(0), mirrored: false }, { shape: plate, pose: pose(200), mirrored: false }];
    drawingAnchors(kernel, parts, viewVectors('front'));
    const v = projectDrawingView(kernel, parts, viewVectors('front'));
    expect(v.box).toEqual({ min: [expect.closeTo(-60, 6), expect.closeTo(0, 6)], max: [expect.closeTo(260, 6), expect.closeTo(15, 6)] });
    expect(kernel.liveShapes).toBe(live);
  });
});
