/**
 * 5-4a (docs/phase5-plan.md): annotations and tables of a part's views (C16.5, C16.6) — the centre marks and centre lines, what the model says of a hole (through,
 * how deep, counterbore), the hole callout, and the hole table with its tags. A plate with three kinds of hole and the golden locating plate; every number by hand.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyCommand,
  applyDrawingCommand,
  createEmptyDrawing,
  DRAWING_SCHEMA_VERSION,
  parseDrawing,
  serializeDrawing,
  viewVectors,
  type Dimension,
  type DrawingDoc,
  type Feature,
  type PartDoc,
  type ViewFeature,
  dimensionRefs, page } from '@3db/model';
import { olderDrawingFile } from '../support/drawingVersion';
import { readPartFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, elementFacts, holeInfo, viewFeatures } from '@3db/regen';
import { autoDimensions, buildScene, centreItems, evaluateDimension, holeNote, holeRows, toSvg, type ElementsResult, type PlacedView, type ViewLines } from '@3db/drawing';
import { build, extrude, face, front, rectangle, sketch } from '../phase1/builders';

const point = (id: string, x: number, y: number) => ({ id, type: 'point', x, y }) as const;
const holeSketch = (id: string, x: number, y: number): Feature => ({ ...sketch(id, face('e1:cap:end')), entities: [point(`${id}p`, x, y)] }) as Feature;
const hole = (id: string, s: string, extra: Record<string, unknown>): Feature =>
  ({ id, type: 'hole', name: id, suppressed: false, sketch: s, kind: 'straight', diameter: '8', end: { type: 'blind', depth: '10' }, ...extra }) as Feature;

/** 40 × 30 × 20 with a blind Ø8 × 10 at (10, 5), a through Ø6 at (30, 5) and a through Ø6 with a counterbore Ø12 × 4 at (20, 22). */
const holesDoc = (): PartDoc =>
  build(
    sketch('s1', front, rectangle('a', 0, 0, 40, 30)),
    extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }),
    holeSketch('s2', 10, 5),
    hole('h1', 's2', {}),
    holeSketch('s3', 30, 5),
    hole('h2', 's3', { diameter: '6', end: { type: 'throughAll' } }),
    holeSketch('s4', 20, 22),
    hole('h3', 's4', { kind: 'counterbore', diameter: '6', cbDiameter: '12', cbDepth: '4', end: { type: 'throughAll' } }),
  );

let kernel: Kernel;
let solver: PlaneGcsSolver;
let regen: Regenerator;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
  regen = new Regenerator(kernel, solver);
});
afterAll(() => regen.dispose());

describe('what the model says of a hole', () => {
  it('a blind hole is as deep as its cylinder, a through hole goes through the thickness, a counterbore is the wider hole at the mouth', () => {
    const r = regen.rebuild(holesDoc());
    expect(r.features.filter((f) => f.status !== 'ok').map((f) => `${f.id}: ${f.message}`)).toEqual([]);
    const body = r.body!;
    const infos = body.topology.faces.flatMap((f, i) => (f.geometry?.type === 'cylinder' && !f.geometry.convex ? [{ radius: f.geometry.radius, info: holeInfo(body.topology, i) }] : []));
    // four concave cylinders: Ø8 blind, Ø6 through, Ø6 through under the counterbore, and the wall of the counterbore (not a hole of its own)
    expect(infos).toHaveLength(4);
    const holes = infos.filter((x) => x.info).map((x) => ({ radius: x.radius, ...x.info! }));
    expect(holes).toHaveLength(3);
    expect(holes).toContainEqual({ radius: 4, through: false, depth: expect.closeTo(10, 6) });
    expect(holes).toContainEqual({ radius: 3, through: true, depth: expect.closeTo(20, 6) });
    // under the counterbore: 16 of straight wall + the 4 of the counterbore = the 20 of the plate (the depth is measured from the mouth, 7805a57)
    expect(holes).toContainEqual({ radius: 3, through: true, depth: expect.closeTo(20, 6), counterbore:{ diameter: expect.closeTo(12, 6), depth: expect.closeTo(4, 6) } });
    expect(infos.filter((x) => !x.info).map((x) => x.radius)).toEqual([6]);
  });

  it('is written as 貫穿, 深 10, and 沉頭 Ø12 深 4 after it', () => {
    expect(holeNote({ through: true, depth: 20 })).toBe('貫穿');
    expect(holeNote({ through: false, depth: 10 })).toBe('深 10');
    expect(holeNote({ through: true, depth: 16, counterbore: { diameter: 12, depth: 4 } })).toBe('貫穿 沉頭 Ø12 深 4');
    expect(holeNote({ through: false, depth: 7.25 })).toBe('深 7.25');
  });

  it('the diameter of each, as a callout: Ø8 深 10, Ø6 貫穿, Ø6 貫穿 沉頭 Ø12 深 4', () => {
    const body = regen.rebuild(holesDoc()).body!;
    const top = viewVectors('front'); // the holes are cut into the face the front view looks at
    const view = viewFeatures(body.topology, body.names, top);
    const circles = view.flatMap((f) => (f.type === 'circle' && f.full && !f.convex && f.hole ? [f] : []));
    expect(circles).toHaveLength(3); // the wall of the counterbore is a circle too (Ø12), but the model does not call it a hole
    const placed: PlacedView = { id: 'view1', at: [200, 150], scale: 1, w: 40, h: 30, centre: [20, 15] };
    const texts = circles
      .map((c) => {
        const facts = elementFacts(body.topology, body.names, c.ref);
        const d: Dimension = { id: 'd', view: 'view1', kind: 'diameter', ref: c.ref, angle: 45, callout: true };
        const o = evaluateDimension(d, { elements: [facts as never] }, top, placed);
        return 'text' in o ? o.text : o.error;
      })
      .sort();
    expect(texts).toEqual(['Ø6 貫穿', 'Ø6 貫穿 沉頭 Ø12 深 4', 'Ø8 深 10']);
  });
});

describe('the annotations in the document', () => {
  const base = (): DrawingDoc => applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views: [{ id: 'view1', name: 'f', source: 'a.3dbx', direction: 'top' }, { id: 'view2', name: 'g', source: 'a.3dbx', direction: 'front' }] });
  const dia = (extra: Record<string, unknown> = {}): Dimension => ({ id: 'dim1', view: 'view1', kind: 'diameter', ref: { kind: 'face', name: 'x' }, angle: 45, ...extra }) as Dimension;

  it('a view can turn its centre marks on or off; a callout belongs to a diameter', () => {
    let d = applyDrawingCommand(base(), { type: 'setView', viewId: 'view1', patch: { centreMarks: false } });
    expect(page(d).views[0]).toMatchObject({ centreMarks: false });
    d = applyDrawingCommand(d, { type: 'setView', viewId: 'view1', patch: { centreMarks: null } });
    expect(page(d).views[0]).not.toHaveProperty('centreMarks');
    d = applyDrawingCommand(d, { type: 'insertDimensions', dimensions: [dia({ callout: true }), { ...dia(), id: 'dim2', kind: 'radius' } as Dimension, { id: 'dim3', view: 'view1', kind: 'linear', a: { kind: 'face', name: 'a' }, b: { kind: 'face', name: 'b' }, orientation: 'horizontal', offset: -10 }] });
    expect(page(d).dimensions[0]).toMatchObject({ callout: true });
    d = applyDrawingCommand(d, { type: 'setDimension', dimensionId: 'dim1', patch: { callout: false } });
    expect(page(d).dimensions[0]).not.toHaveProperty('callout');
    expect(() => applyDrawingCommand(d, { type: 'setDimension', dimensionId: 'dim2', patch: { callout: true } })).toThrow(/不屬於/);
    expect(() => applyDrawingCommand(d, { type: 'setDimension', dimensionId: 'dim3', patch: { callout: true } })).toThrow(/不屬於/);
    expect(() => applyDrawingCommand(base(), { type: 'insertDimensions', dimensions: [{ ...dia(), kind: 'radius', callout: true } as unknown as Dimension] })).toThrow(/不屬於/);
  });

  it('hole tables: inserted on a view that is there, moved, given classes, deleted; refused with a bad class, position or view', () => {
    let d = applyDrawingCommand(base(), { type: 'insertTables', tables: [{ id: 'tbl1', kind: 'holes', view: 'view1' }] });
    expect(d.idCounters).toMatchObject({ tbl: 1 });
    expect(() => applyDrawingCommand(d, { type: 'insertTables', tables: [{ id: 'tbl1', kind: 'holes', view: 'view1' }] })).toThrow(/已被使用/);
    expect(() => applyDrawingCommand(d, { type: 'insertTables', tables: [{ id: 'tbl2', kind: 'holes', view: 'zzz' }] })).toThrow(/找不到尺寸所在的視圖/);
    expect(() => applyDrawingCommand(d, { type: 'insertTables', tables: [{ id: 'tbl2', kind: 'chart' as never, view: 'view1' }] })).toThrow(/不明的表格種類/);
    expect(() => applyDrawingCommand(d, { type: 'insertTables', tables: [{ id: 'tbl2', kind: 'holes', view: 'view1', fits: { '9': 'X9' } }] })).toThrow(/不支援的配合等級/);
    d = applyDrawingCommand(d, { type: 'setTable', tableId: 'tbl1', patch: { at: [300, 250], fits: { '6': 'H7' } } });
    expect(page(d).tables[0]).toMatchObject({ at: [300, 250], fits: { '6': 'H7' } });
    expect(() => applyDrawingCommand(d, { type: 'setTable', tableId: 'tbl1', patch: { at: [NaN, 1] } })).toThrow(/位置/);
    d = applyDrawingCommand(d, { type: 'setTable', tableId: 'tbl1', patch: { at: null, fits: {} } });
    expect(page(d).tables[0]).toEqual({ id: 'tbl1', kind: 'holes', view: 'view1' });
    expect(() => applyDrawingCommand(d, { type: 'setTable', tableId: 'zzz', patch: {} })).toThrow(/找不到表格/);
    d = applyDrawingCommand(d, { type: 'deleteTables', tableIds: ['tbl1'] });
    expect(page(d).tables).toEqual([]);
    expect(() => applyDrawingCommand(d, { type: 'deleteTables', tableIds: ['tbl1'] })).toThrow(/找不到表格/);
  });

  it('deleting a view deletes its tables; ids are not given out again; saved and read back the same; a version-3 file reads with no tables', () => {
    let d = applyDrawingCommand(base(), { type: 'insertTables', tables: [{ id: 'tbl1', kind: 'holes', view: 'view1', fits: { '6': 'H7' } }, { id: 'tbl2', kind: 'holes', view: 'view2', at: [10, 20] }] });
    expect(parseDrawing(serializeDrawing(d))).toEqual(d);
    d = applyDrawingCommand(d, { type: 'deleteViews', viewIds: ['view1'] });
    expect(page(d).tables.map((x) => x.id)).toEqual(['tbl2']);
    expect(d.idCounters.tbl).toBe(2);
    const back = parseDrawing(JSON.stringify(olderDrawingFile(base(), 3)));
    expect(back.schemaVersion).toBe(DRAWING_SCHEMA_VERSION);
    expect(page(back).tables).toEqual([]);
  });
});

describe('the locating plate: centre marks, callouts and the hole table', () => {
  let doc: PartDoc;
  let body: NonNullable<ReturnType<Regenerator['rebuild']>['body']>;
  const placed: PlacedView = { id: 'view1', at: [200, 150], scale: 1, w: 120, h: 80, centre: [0, 0] };
  const top = viewVectors('top');
  const rebuilt = (d: PartDoc) => regen.rebuild(d).body!;
  beforeAll(async () => {
    doc = (await readPartFile(new Uint8Array(readFileSync(new URL('../golden/locating-plate.3dbx', import.meta.url))))).doc;
    body = rebuilt(doc);
  });
  const features = (view = top, b = body) => viewFeatures(b.topology, b.names, view);
  const topView = { id: 'view1', name: '上視', source: 'a.3dbx', direction: 'top' as const };

  it('every hole of the plate is through its 15: the six whole circles of the top view say so', () => {
    const holes = features().flatMap((f) => (f.type === 'circle' && f.full ? [f] : []));
    expect(holes).toHaveLength(6);
    expect(holes.every((h) => h.hole?.through && Math.abs(h.hole.depth - 15) < 1e-6 && !h.hole.counterbore)).toBe(true);
    // the corners are arcs, not holes
    expect(features().filter((f) => f.type === 'circle' && !f.full).every((f) => f.type === 'circle' && !f.hole)).toBe(true);
  });

  it('the automatic dimensions with callouts: 4×Ø9 貫穿, 2×Ø8 貫穿, 4×R10 (an arc has no callout)', () => {
    const drafts = autoDimensions(features(), { overall: false, holes: true, positions: false, callouts: true });
    const texts = drafts.map((draft) => {
      const d = { ...draft, id: 'd', view: 'view1' } as Dimension;
      const refs = dimensionRefs(d);
      const resolved: ElementsResult = { elements: refs.map((r) => elementFacts(body.topology, body.names, r)) as never };
      const o = evaluateDimension(d, resolved, top, placed);
      return 'text' in o ? o.text : o.error;
    });
    expect(texts.sort()).toEqual(['2×Ø8 貫穿', '4×R10', '4×Ø9 貫穿']);
    // without callouts they are as in 5-3
    expect(autoDimensions(features(), { overall: false, holes: true, positions: false }).some((d) => d.kind === 'diameter' && d.callout)).toBe(false);
  });

  it('centre marks: a cross on each of the six holes, a half from the middle outward each way, 2 mm past the circle', () => {
    const items = centreItems(topView, features(), placed);
    expect(items).toHaveLength(24);
    expect(items.every((i) => i.kind === 'polyline' && i.style === 'center')).toBe(true);
    // the Ø9 hole at (−50, 30) is at (150, 180) on the sheet; r + 2 = 6.5
    const at = (x0: number, y0: number, x1: number, y1: number) => items.some((i) => i.kind === 'polyline' && i.points.length === 4 && [x0, y0, x1, y1].every((v, k) => Math.abs(i.points[k]! - v) < 1e-6));
    expect(at(150, 180, 156.5, 180)).toBe(true);
    expect(at(150, 180, 143.5, 180)).toBe(true);
    expect(at(150, 180, 150, 186.5)).toBe(true);
    expect(at(150, 180, 150, 173.5)).toBe(true);
    // the Ø8 hole at (40, 0): r + 2 = 6
    expect(at(240, 150, 246, 150)).toBe(true);
  });

  it('centre lines: seen from the front the holes are cylinders from the side: four axes (the two Ø9 holes at the same x are one line), from end to end and 2 mm past', () => {
    const f = features(viewVectors('front'));
    expect(f.filter((x) => x.type === 'axis')).toHaveLength(6);
    const items = centreItems({ id: 'view1', name: '前視', source: 'a.3dbx', direction: 'front' }, f, { ...placed, w: 120, h: 15, centre: [0, 7.5] });
    expect(items).toHaveLength(8);
    // the hole at x = −50: the sheet's x is 150, the axis from y = 0 to 15 (sheet 150 − 7.5 … 157.5 + …): from the middle (7.5) to 17 and to −2
    const mid = 150;
    const ys = items.flatMap((i) => (i.kind === 'polyline' && Math.abs(i.points[0]! - 150) < 1e-6 && Math.abs(i.points[2]! - 150) < 1e-6 ? [[i.points[1]!, i.points[3]!]] : []));
    expect(ys).toHaveLength(2);
    expect(ys.map((y) => Math.round(Math.abs(y[1]! - y[0]!) * 1e6) / 1e6).sort()).toEqual([9.5, 9.5]); // half the thickness (7.5) and 2 more
    expect(mid).toBe(150);
  });

  it('a section view has no centre marks unless it asks; a view can turn them off; a detail has only those inside its circle', () => {
    const f = features();
    expect(centreItems({ id: 's', name: 'A', kind: 'section', parent: 'p', line: [[0, 0], [0, 1]], label: 'A' }, f, placed)).toEqual([]);
    expect(centreItems({ id: 's', name: 'A', kind: 'section', parent: 'p', line: [[0, 0], [0, 1]], label: 'A', centreMarks: true }, f, placed)).toHaveLength(24);
    expect(centreItems({ ...topView, centreMarks: false }, f, placed)).toEqual([]);
    // a detail about the hole at (−50, 30), radius 8: only its cross, and the arms cut at the circle (radius 8 from the centre)
    const items = centreItems({ id: 'd', name: 'B', kind: 'detail', parent: 'view1', centre: [-50, 30], radius: 8, label: 'B' }, f, { ...placed, w: 16, h: 16, scale: 2, centre: [-50, 30] });
    expect(items).toHaveLength(4);
    for (const i of items) if (i.kind === 'polyline') expect(Math.hypot(i.points[2]! - i.points[0]!, i.points[3]! - i.points[1]!)).toBeCloseTo(2 * (4.5 + 1), 6); // r + 2 mm of sheet (1 mm of the part at 2:1)
  });

  it('the hole table: tags A1–A4 for the Ø9 holes and B1–B2 for the Ø8, from the top left, positions from the left and bottom of the view', () => {
    const rows = holeRows(features());
    const r = (tag: string) => rows.find((x) => x.tag === tag)!;
    expect(rows.map((x) => x.tag)).toEqual(['A1', 'A2', 'A3', 'A4', 'B1', 'B2']);
    // from x = −60 and y = −40 (the sheet's y is the model's −z): the Ø9 holes at (±50, ±30)
    expect([r('A1'), r('A2'), r('A3'), r('A4')].map((x) => [x.x, x.y].map((v) => Math.round(v * 1e6) / 1e6))).toEqual([[10, 70], [110, 70], [10, 10], [110, 10]]);
    expect([r('B1'), r('B2')].map((x) => [x.x, x.y].map((v) => Math.round(v * 1e6) / 1e6))).toEqual([[20, 40], [100, 40]]);
    expect(rows.filter((x) => x.tag.startsWith('A')).every((x) => x.size === 'Ø9 貫穿')).toBe(true);
    expect(rows.filter((x) => x.tag.startsWith('B')).every((x) => x.size === 'Ø8 貫穿')).toBe(true);
    // with a class for the Ø9
    expect(holeRows(features(), { '9': 'H11' }).find((x) => x.tag === 'A1')!.size).toBe('Ø9 H11 (+0.09/0) 貫穿');
    expect(holeRows([])).toEqual([]);
  });

  it('the table is drawn in the upper right corner of the area, 7 rows of 6; the tags are beside the holes', () => {
    const doc3: DrawingDoc = applyDrawingCommand(applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views: [topView] }), { type: 'insertTables', tables: [{ id: 'tbl1', kind: 'holes', view: 'view1' }] });
    const lines: ViewLines = { visible: [[-60, -40, 60, -40, 60, 40, -60, 40, -60, -40]], hidden: [], box: { min: [-60, -40], max: [60, 40] } };
    const { scene, tables } = buildScene(doc3, new Map([['view1', lines]]), new Map(), new Map([['view1', features()]]));
    expect(tables.get('tbl1')).toHaveLength(6);
    const outer = scene.items.find((i) => i.kind === 'polyline' && i.style === 'visible' && i.closed && i.points.length === 8 && i.points[2]! === 402)!;
    // the area of an A3 landscape sheet is {28, 66, 374, 213}: the right edge 402, the top 279; 7 rows of 6 is 42 high
    expect(outer.kind === 'polyline' && [outer.points[3], outer.points[5], outer.points[2]]).toEqual([expect.closeTo(237, 6), expect.closeTo(279, 6), 402]);
    const texts = scene.items.flatMap((i) => (i.kind === 'text' ? [i.text] : []));
    for (const t of ['孔', 'X', 'Y', '尺寸', 'A1', 'A4', 'B2', 'Ø9 貫穿', 'Ø8 貫穿', '10', '70']) expect(texts, t).toContain(t);
    expect(texts.filter((t) => t === 'A1')).toHaveLength(2); // in the table and by the hole
    // the tag of A1 beside its hole: the view is centred in the area (middle (215, 172.5)), so the hole at (−50, 30) is at (165, 202.5); the tag is up and to the right of the circle (r = 4.5)
    const tag = scene.items.find((i) => i.kind === 'text' && i.text === 'A1' && i.at[0] < 200)!;
    expect(tag.kind === 'text' && [tag.at[0], tag.at[1]]).toEqual([expect.closeTo(165 + 4.5 * Math.SQRT1_2 + 1, 6), expect.closeTo(202.5 + 4.5 * Math.SQRT1_2 + 1, 6)]);
    expect(toSvg(scene)).toContain('>Ø9 貫穿</text>');
    // put where the user says: its upper left corner is there
    const moved = applyDrawingCommand(doc3, { type: 'setTable', tableId: 'tbl1', patch: { at: [50, 250] } });
    const m = buildScene(moved, new Map([['view1', lines]]), new Map(), new Map([['view1', features()]])).scene;
    const box = m.items.find((i) => i.kind === 'polyline' && i.style === 'visible' && i.closed && i.points.length === 8 && i.points[0] === 50)!;
    expect(box.kind === 'polyline' && [box.points[0], box.points[7]]).toEqual([50, 250]);
    // a table of a view with no holes is empty and draws only its header
    const none = buildScene(doc3, new Map([['view1', lines]]), new Map(), new Map([['view1', [] as ViewFeature[]]]));
    expect(none.tables.get('tbl1')).toEqual([]);
  });

  it('the table follows the model: the plate made 150 × 100 with its holes 60 out has the holes 15 and 135 from the left', () => {
    const edit = (d: PartDoc, sketchName: string, value: string, to: string, type: 'distance' | 'distanceX') => {
      const s = d.features.find((f) => f.name === sketchName);
      if (s?.type !== 'sketch') throw new Error('no sketch');
      return s.constraints.filter((c) => c.type === type && 'value' in c && c.value === value).reduce((acc, c) => applyCommand(acc, { type: 'setDimension', featureId: s.id, constraintId: c.id, value: to }), d);
    };
    let bigger = edit(doc, '草圖1', '120', '150', 'distance');
    bigger = edit(bigger, '草圖1', '80', '100', 'distance');
    bigger = edit(bigger, '草圖2', '50', '60', 'distanceX');
    const rows = holeRows(features(top, rebuilt(bigger)));
    expect(rows).toHaveLength(6);
    const nine = rows.filter((x) => x.tag.startsWith('A'));
    expect(nine.map((x) => Math.round(x.x * 1e6) / 1e6).sort((a, b) => a - b)).toEqual([15, 15, 135, 135]);
    expect(nine.map((x) => Math.round(x.y * 1e6) / 1e6).sort((a, b) => a - b)).toEqual([20, 20, 80, 80]);
  });
});
