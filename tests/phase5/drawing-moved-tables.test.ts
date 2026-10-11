/**
 * Schema 9: the user can put the circles of the balloons and the tables where they want them. The place of a balloon is the centre of its circle on the sheet (mm); the
 * others keep clear of it; the scene says where every table and balloon is, so the sheet can be pointed at.
 */
import { describe, expect, it } from 'vitest';
import { applyDrawingCommand, createEmptyDrawing, parseDrawing, serializeDrawing, type BomRow, type DrawingDoc } from '@3db/model';
import { balloonSpots, buildScene, bomTableBox, type PlacedView, type ViewBom, type ViewLines } from '@3db/drawing';

const row = (item: string, name: string, path: string): BomRow => ({ item, name, path, mirrored: false, qty: 1, partNo: '', vendor: '' }) as BomRow;
const bom: ViewBom = { rows: [row('1', 'a', 'a.3dbx'), row('2', 'b', 'b.3dbx')], parts: [{ file: 'a.3dbx', mirrored: false }, { file: 'b.3dbx', mirrored: false }] };
const placed: PlacedView = { id: 'view1', at: [200, 150], scale: 1, w: 100, h: 60, centre: [0, 0] };
const base = (): DrawingDoc => applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views: [{ id: 'view1', name: 'f', source: 'a.3dba', direction: 'front' }] });
const lines: ViewLines = { visible: [[0, 0, 100, 0, 100, 60, 0, 60, 0, 0]], hidden: [], box: { min: [0, 0], max: [100, 60] }, anchors: [[10, 5], [10, 5]] };

describe('the balloons the user moved', () => {
  it('a moved balloon is where it was put, the leader still goes to the dot, and the others slide clear of it', () => {
    const auto = balloonSpots(bom, lines.anchors, placed);
    expect(auto).toHaveLength(2);
    // put item 1 where the program would put item 2
    const spots = balloonSpots(bom, lines.anchors, placed, { '1': auto[1]!.centre });
    expect(spots[0]!.centre).toEqual(auto[1]!.centre);
    expect(spots[0]!.anchor).toEqual(auto[0]!.anchor);
    expect(Math.hypot(spots[0]!.centre[0] - spots[1]!.centre[0], spots[0]!.centre[1] - spots[1]!.centre[1])).toBeGreaterThanOrEqual(9 - 1e-9);
  });

  it('the place is kept in the document (a balloon that is not there is placed by the program), cleared with null, and is for a parts list only', () => {
    let d = applyDrawingCommand(base(), { type: 'insertTables', tables: [{ id: 'tbl1', kind: 'bom', view: 'view1', balloons: true }] });
    d = applyDrawingCommand(d, { type: 'setTable', tableId: 'tbl1', patch: { balloonAt: { '1': [250, 120] } } });
    expect(d.tables[0]).toEqual({ id: 'tbl1', kind: 'bom', view: 'view1', balloons: true, balloonAt: { '1': [250, 120] } });
    expect(parseDrawing(serializeDrawing(d))).toEqual(d);
    expect(d.schemaVersion).toBe(10);
    d = applyDrawingCommand(d, { type: 'setTable', tableId: 'tbl1', patch: { balloonAt: null } });
    expect(d.tables[0]).toEqual({ id: 'tbl1', kind: 'bom', view: 'view1', balloons: true });
    expect(() => applyDrawingCommand(d, { type: 'setTable', tableId: 'tbl1', patch: { balloonAt: { '1': [Number.NaN, 1] } } })).toThrow();
    const h = applyDrawingCommand(base(), { type: 'insertTables', tables: [{ id: 'tbl1', kind: 'holes', view: 'view1' }] });
    expect(() => applyDrawingCommand(h, { type: 'setTable', tableId: 'tbl1', patch: { balloonAt: { '1': [1, 2] } } })).toThrow(/不屬於/);
  });

  it('an older drawing (schema 8) opens as it is', () => {
    const old = JSON.parse(serializeDrawing(base())) as Record<string, unknown>;
    old.schemaVersion = 8;
    expect(parseDrawing(JSON.stringify(old)).schemaVersion).toBe(10);
  });
});

describe('where the scene says the tables and balloons are', () => {
  it('a table is in its box (the upper left corner is `at`), a moved balloon is in the scene where it was put', () => {
    let d = applyDrawingCommand(base(), { type: 'insertTables', tables: [{ id: 'tbl1', kind: 'bom', view: 'view1', balloons: true, at: [30, 250] }] });
    const built = buildScene(d, new Map([['view1', lines]]), new Map(), new Map(), new Map([['view1', bom]]));
    const box = built.tableBoxes.get('tbl1')!;
    expect(box.x).toBe(30);
    expect(box.y + box.h).toBe(250);
    expect(box).toEqual(bomTableBox(d.tables[0] as never, bom.rows, d.sheet));
    expect(built.balloons.get('tbl1')).toHaveLength(2);
    d = applyDrawingCommand(d, { type: 'setTable', tableId: 'tbl1', patch: { balloonAt: { '2': [260, 90] } } });
    const moved = buildScene(d, new Map([['view1', lines]]), new Map(), new Map(), new Map([['view1', bom]]));
    expect(moved.balloons.get('tbl1')!.find((s) => s.item === '2')!.centre).toEqual([260, 90]);
    const circles = moved.scene.items.filter((i) => i.kind === 'polyline' && i.closed && !i.filled && i.points.length === 72);
    expect(circles.some((c) => c.kind === 'polyline' && Math.abs((Math.min(...c.points.filter((_, k) => k % 2 === 0)) + Math.max(...c.points.filter((_, k) => k % 2 === 0))) / 2 - 260) < 1e-6)).toBe(true);
  });
});
