/**
 * Phase 5-6 (docs/phase5-plan.md §驗收), the part of the acceptance that needs no sample or viewer of the user's: the fixture of 4a (the base plate with two Ø6 H7 dowel
 * holes, the clamp, two dowel pins and a screw, a workpiece that is only a reference body) drawn twice — the base plate's drawing (three views, a section through the
 * two dowel holes, the hole table, the dimensions and their tolerances) and the assembly drawing (the parts list and the balloons) — with every number worked out by
 * hand; both written as DXF and PDF and read back; and the plate made thicker in the master, the drawing following it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyDrawingCommand,
  axesOf,
  buildBom,
  createEmptyDrawing,
  leavesOf,
  parseDrawing,
  sectionPlane,
  serializeDrawing,
  type Dimension,
  type DrawingDoc,
  type DrawingView,
  type Pose,
  type Ref,
  type SourceTree,
  type ViewFeature,
} from '@3db/model';
import { readAnyDocumentFile, readDocumentFile, writeDrawingFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { drawingAnchors, elementFacts, projectDrawingView, Regenerator, viewFeatures } from '@3db/regen';
import {
  autoDimensions,
  buildScene,
  checkDxf,
  checkPdf,
  pathsInMm,
  readDxf,
  readPdf,
  readTrueType,
  toDxf,
  toPdf,
  type DxfPolyline,
  type DxfText,
  type ElementsResult,
  type Scene,
  type ViewBom,
  type ViewLines,
} from '@3db/drawing';
import { assemble, workpieceStep, type Opened, type Project } from '../support/jigFixture';
import { testFont } from '../support/testFont';
import type { OpenedPart } from '../support/derivedProject';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
let stepBytes: Uint8Array;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
  stepBytes = workpieceStep(kernel, solver, kept);
});
afterAll(() => kept.forEach((r) => r.dispose()));

const PLATE = '零件/基板.3dbx';
const IDENTITY: Pose = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
const round = (v: number, digits = 6) => Math.round(v * 10 ** digits) / 10 ** digits;
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;

/** The area of the regions bounded by the outlines of a cut: the outlines come edge by edge, so they are joined end to end into loops and measured (shoelace). */
function areaOf(outlines: number[][]): number {
  const pieces = outlines.map((o) => [...o]);
  let area = 0;
  while (pieces.length > 0) {
    const loop = pieces.shift()!;
    for (let grew = true; grew; ) {
      grew = false;
      for (let i = 0; i < pieces.length; i++) {
        const p = pieces[i]!;
        const end = [loop[loop.length - 2]!, loop[loop.length - 1]!];
        const joinsAtStart = near(p[0]!, end[0]!, 1e-6) && near(p[1]!, end[1]!, 1e-6);
        const joinsAtEnd = near(p[p.length - 2]!, end[0]!, 1e-6) && near(p[p.length - 1]!, end[1]!, 1e-6);
        if (!joinsAtStart && !joinsAtEnd) continue;
        const q = joinsAtStart ? p : p.slice().reverse().flatMap((_, k, a) => (k % 2 === 0 ? [a[k + 1]!, a[k]!] : []));
        loop.push(...q.slice(2));
        pieces.splice(i, 1);
        grew = true;
        break;
      }
    }
    let s = 0;
    for (let i = 0; i + 3 < loop.length; i += 2) s += loop[i]! * loop[i + 3]! - loop[i + 2]! * loop[i + 1]!;
    area += Math.abs(s) / 2;
  }
  return area;
}

/** A vertical line at x from y0 to y1 among the lines. */
const vertical = (lines: number[][], x: number, y0: number, y1: number) =>
  lines.some((l) => {
    const xs = l.filter((_, i) => i % 2 === 0);
    const ys = l.filter((_, i) => i % 2 === 1);
    return xs.every((v) => near(v, x, 1e-5)) && near(Math.min(...ys), y0, 1e-5) && near(Math.max(...ys), y1, 1e-5);
  });

interface PlateDrawing {
  doc: DrawingDoc;
  scene: Scene;
  lines: Map<string, ViewLines>;
  features: Map<string, ViewFeature[]>;
  dimensions: ReturnType<typeof buildScene>['dimensions'];
  tables: ReturnType<typeof buildScene>['tables'];
}

/**
 * The base plate's drawing, made as the app makes it: the front view (the plate lies in the front plane, so the holes are circles there), the top and right views,
 * a section along y = 0 through the two holes; the automatic dimensions with callouts and positions, the dowel holes given H7; a hole table with H7 for the Ø6.
 */
function plateDrawing(part: OpenedPart): PlateDrawing {
  const views: DrawingView[] = [
    { id: 'view1', name: '前視', source: PLATE, direction: 'front' },
    { id: 'view2', name: '上視', source: PLATE, direction: 'top' },
    { id: 'view3', name: '右視', source: PLATE, direction: 'right' },
    { id: 'view4', name: 'A-A', kind: 'section', parent: 'view1', line: [[-60, 0], [60, 0]], label: 'A' },
  ];
  let doc = applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views });
  doc = applyDrawingCommand(doc, { type: 'setTitle', field: 'drawingName', value: '基板' });
  doc = applyDrawingCommand(doc, { type: 'setSheet', sheet: { scale: [1, 1] } });
  const lines = new Map<string, ViewLines>();
  const features = new Map<string, ViewFeature[]>();
  const parts = [{ shape: part.shape, pose: IDENTITY, mirrored: false }];
  for (const v of doc.views) {
    const axes = axesOf(doc.views, doc.sheet.projection, v)!;
    if (v.kind === 'section') {
      const parent = doc.views.find((x) => x.id === v.parent)!;
      lines.set(v.id, projectDrawingView(kernel, parts, axes, sectionPlane(axesOf(doc.views, doc.sheet.projection, parent)!, v)));
    } else {
      lines.set(v.id, projectDrawingView(kernel, parts, axes));
      features.set(v.id, viewFeatures(part.mate.topology, part.mate.names, axes));
    }
  }
  const drafts = autoDimensions(features.get('view1')!, { overall: true, holes: true, positions: true, callouts: true });
  const dimensions = drafts.map((d, i) => ({ ...d, id: `dim${i + 1}`, view: 'view1', ...(d.kind === 'diameter' && d.count === 2 ? { tolerance: { type: 'fit', fit: 'H7' } } : {}) }) as Dimension);
  doc = applyDrawingCommand(doc, { type: 'insertDimensions', dimensions });
  doc = applyDrawingCommand(doc, { type: 'insertTables', tables: [{ id: 'tbl1', kind: 'holes', view: 'view1', fits: { '6': 'H7' } }] });
  const elements = new Map<string, ElementsResult>(
    doc.dimensions.map((d) => {
      const refs: Ref[] = d.kind === 'linear' ? [d.a, d.b] : [d.ref];
      return [d.id, { elements: refs.map((r) => elementFacts(part.mate.topology, part.mate.names, r)) as never }];
    }),
  );
  const built = buildScene(doc, lines, elements, features);
  return { doc, scene: built.scene, lines, features, dimensions: built.dimensions, tables: built.tables };
}

const sceneTexts = (s: Scene) => s.items.flatMap((i) => (i.kind === 'text' && i.text !== '' ? [i.text] : []));

describe('① the base plate\'s drawing (5-6)', () => {
  let p: Project;
  let o: Opened;
  let d: PlateDrawing;
  beforeAll(async () => {
    ({ p, o } = await assemble({ kernel, solver, kept, stepBytes }));
    d = plateDrawing(o.parts.get(PLATE)!);
  });

  it('the three views: front 100 × 80 (the holes seen as circles), top 100 × 15, right 15 × 80; the dowel holes hidden in the top view as lines through the whole thickness', () => {
    const box = (id: string) => d.lines.get(id)!.box!;
    expect(box('view1')).toEqual({ min: [expect.closeTo(-50, 6), expect.closeTo(-40, 6)], max: [expect.closeTo(50, 6), expect.closeTo(40, 6)] });
    // the top view looks along −y with −z up: the plate's 15 is the sheet's y from −15 to 0
    expect(box('view2')).toEqual({ min: [expect.closeTo(-50, 6), expect.closeTo(-15, 6)], max: [expect.closeTo(50, 6), expect.closeTo(0, 6)] });
    // the right view: the sheet's x is the model's −z
    expect(box('view3')).toEqual({ min: [expect.closeTo(-15, 6), expect.closeTo(-40, 6)], max: [expect.closeTo(0, 6), expect.closeTo(40, 6)] });
    // the holes are Ø6 at x = ±40: their walls at x = ±37 and ±43, from the top face to the chamfer (14.5 of straight wall: the C0.5 is at the top, the sheet's y = 0 is z = 0)
    const hidden = d.lines.get('view2')!.hidden;
    for (const x of [-43, -37, 37, 43]) expect(vertical(hidden, x, -14.5, 0), `hidden wall at x = ${x}`).toBe(true);
  });

  it('the section through the two holes (A–A along y = 0): the cut is 100 × 15 less two Ø6 holes and their 0.5 chamfers, 1319.5 mm², the holes 6 wide at x = ±40', () => {
    const cut = d.lines.get('view4')!.cut!;
    // 100 × 15 − 2 × (6 × 15 + 2 × ½ × 0.5 × 0.5) = 1500 − 180.5
    expect(areaOf(cut)).toBeCloseTo(1319.5, 4);
    const xs = cut.flatMap((l) => l.filter((_, i) => i % 2 === 0));
    for (const x of [-43, -37, 37, 43]) expect(xs.some((v) => near(v, x, 1e-6)), `a cut edge at x = ${x}`).toBe(true);
    // the cut is three pieces: the two ends and the part between the holes
    expect(Math.min(...xs)).toBeCloseTo(-50, 6);
    expect(Math.max(...xs)).toBeCloseTo(50, 6);
    expect(d.scene.items.filter((i) => i.kind === 'polyline' && i.style === 'thin').length).toBeGreaterThan(30); // the hatching
    expect(sceneTexts(d.scene)).toContain('A-A');
  });

  it('the dowel holes are through holes with a chamfer: a cone with two circular edges does not close a hole (found by drawing the jig: it said 深 14.5)', () => {
    const circles = d.features.get('view1')!.flatMap((f) => (f.type === 'circle' && f.full && !f.convex ? [f] : []));
    expect(circles).toHaveLength(2);
    for (const c of circles) expect(c.hole).toMatchObject({ through: true, depth: expect.closeTo(14.5, 6) });
  });

  it('the dimensions: 100 and 80 overall, the dowel holes 2×Ø6 H7 (+0.012/0) 貫穿, the holes 10 and 90 from the left and 40 from the bottom', () => {
    const texts = [...d.dimensions.values()].map((x) => ('text' in x ? x.text : `ERROR ${x.error}`)).sort();
    expect(texts.filter((t) => t.startsWith('ERROR'))).toEqual([]);
    expect(texts).toEqual(['10', '100', '2×Ø6 H7 (+0.012/0) 貫穿', '40', '80', '90'].sort());
    // and every one is drawn
    expect(d.scene.items.filter((i) => i.kind === 'polyline' && i.style === 'dimension').length).toBeGreaterThan(20);
  });

  it('the hole table: A1 and A2, the holes at (10, 40) and (90, 40) from the left and bottom edges, Ø6 H7 (+0.012/0) 貫穿', () => {
    const rows = d.tables.get('tbl1')!;
    expect(rows.map((r) => [r.tag, round(r.x, 4), round(r.y, 4), r.size])).toEqual([
      ['A1', 10, 40, 'Ø6 H7 (+0.012/0) 貫穿'],
      ['A2', 90, 40, 'Ø6 H7 (+0.012/0) 貫穿'],
    ]);
    expect(sceneTexts(d.scene).filter((t) => t === 'A1')).toHaveLength(2); // in the table and by the hole
    // the centre marks: a cross on each hole in the front view (4 halves each), the axes of the holes in the top and right views (2 halves each; the two holes of the
    // right view coincide), and the cutting line of the section on the front view (the same line style)
    const centre = d.scene.items.filter((i) => i.kind === 'polyline' && i.style === 'center').length;
    expect(centre).toBe(2 * 4 + 2 * 2 + 1 * 2 + 1);
  });

  it('is saved and read back the same, as a .3dbd file too', async () => {
    // (compared as the text of the file: a -0 in a fingerprint is written as 0)
    const text = serializeDrawing(d.doc);
    expect(serializeDrawing(parseDrawing(text))).toBe(text);
    const back = await readAnyDocumentFile(await writeDrawingFile(d.doc));
    expect(back.kind).toBe('drawing');
    expect(back.kind === 'drawing' && serializeDrawing(back.doc)).toBe(text);
  });

  it('is written as DXF and PDF and both read back: the same lines to 0.01 mm, the same text, nothing wrong with either', () => {
    const dxf = readDxf(toDxf(d.scene));
    expect(checkDxf(dxf)).toEqual([]);
    const dxfTexts = dxf.entities.filter((e): e is DxfText => e.type === 'TEXT').map((e) => e.text);
    expect(dxfTexts).toEqual(sceneTexts(d.scene));
    expect(dxfTexts).toContain('2×Ø6 H7 (+0.012/0) 貫穿');
    const chars = [...new Set(dxfTexts.join(''))].join('');
    const font = readTrueType(testFont(chars).bytes);
    const { bytes, warnings } = toPdf(d.scene, { font, title: '基板' });
    expect(warnings).toEqual([]);
    const pdf = readPdf(bytes);
    expect(checkPdf(pdf)).toEqual([]);
    expect(pdf.pages[0]!.texts.map((t) => t.text)).toEqual(dxfTexts);
    const a = dxf.entities.filter((e): e is DxfPolyline => e.type === 'LWPOLYLINE');
    const b = pathsInMm(pdf.pages[0]!.paths).filter((x) => !x.filled);
    expect(b).toHaveLength(a.length);
    let worst = 0;
    a.forEach((e, k) => e.points.forEach((v, i) => (worst = Math.max(worst, Math.abs(v - b[k]!.points[i]!)))));
    expect(worst).toBeLessThan(0.01);
    // without a font the Chinese is ? and it says so, but the numbers and the tolerance are still right
    const plain = toPdf(d.scene);
    expect(plain.warnings).toHaveLength(1);
    expect(readPdf(plain.bytes).pages[0]!.texts.some((t) => t.text === '2×Ø6 H7 (+0.012/0) ??')).toBe(true);
  });
});

describe('② the assembly drawing (5-6)', () => {
  let p: Project;
  let o: Opened;
  let scene: Scene;
  let lines: Map<string, ViewLines>;
  let bom: ViewBom;
  let doc: DrawingDoc;
  beforeAll(async () => {
    ({ p, o } = await assemble({ kernel, solver, kept, stepBytes }));
    // what the app draws of an assembly: its parts where the mates put them, without a reference body (the workpiece)
    const trees: Record<string, SourceTree> = {};
    for (const c of p.doc.components) trees[c.id] = { kind: 'part', key: o.pathOf(c.id), path: o.pathOf(c.id) };
    const isRef = (key: string) => o.parts.get(key)!.reference.every(Boolean);
    const leaves = leavesOf(p.doc, trees, (id) => o.solved.poses.get(id) ?? null).filter((l) => !isRef(l.key));
    const parts = leaves.map((l) => ({ shape: o.parts.get(l.key)!.shape, pose: l.pose, mirrored: false }));
    doc = applyDrawingCommand(createEmptyDrawing(), {
      type: 'insertViews',
      views: [
        { id: 'view1', name: '前視', source: '夾具.3dba', direction: 'front' },
        { id: 'view2', name: '右視', source: '夾具.3dba', direction: 'right' },
      ],
    });
    doc = applyDrawingCommand(doc, { type: 'insertTables', tables: [{ id: 'tbl1', kind: 'bom', view: 'view1', balloons: true }] });
    lines = new Map();
    for (const v of doc.views) {
      const axes = axesOf(doc.views, doc.sheet.projection, v)!;
      lines.set(v.id, { ...projectDrawingView(kernel, parts, axes), ...(v.id === 'view1' ? { anchors: drawingAnchors(kernel, parts, axes) } : {}) });
    }
    const rows = buildBom({ doc: p.doc, trees, propsOf: (key) => o.parts.get(key) && undefined, isReference: isRef }).flat;
    bom = { rows, parts: leaves.map((l) => ({ file: l.file, mirrored: false })) as ViewBom['parts'] };
    scene = buildScene(doc, lines, new Map(), new Map(), new Map([['view1', bom]])).scene;
  });

  it('the views: the front is the plate, 100 × 80; the right is 36 wide (the pins 5 below the plate, the screw head 31 above it: 25 + 6) and 80 high, the workpiece (35) left out', () => {
    expect(lines.get('view1')!.box).toEqual({ min: [expect.closeTo(-50, 6), expect.closeTo(-40, 6)], max: [expect.closeTo(50, 6), expect.closeTo(40, 6)] });
    // the sheet's x of the right view is −z: from −31 to 5
    expect(lines.get('view2')!.box).toEqual({ min: [expect.closeTo(-31, 5), expect.closeTo(-40, 5)], max: [expect.closeTo(5, 5), expect.closeTo(40, 5)] });
  });

  it('the parts list: 1 基板 ×1, 2 壓板 ×1, 3 ISO 8734 6m6x20 ×2, 4 ISO 4762 M6x10 ×1; the workpiece is a reference body and is not in it', () => {
    expect(bom.rows.map((r) => [r.item, r.name, r.qty])).toEqual([['1', '基板', 1], ['2', '壓板', 1], ['3', 'ISO 8734 6m6x20', 2], ['4', 'ISO 4762 M6x10', 1]]);
    // five parts are drawn: the plate, the clamp, the two pins and the screw
    expect(bom.parts).toHaveLength(5);
    const texts = sceneTexts(scene);
    for (const t of ['項次', '名稱', '數量', '基板', '壓板', 'ISO 8734 6m6x20', 'ISO 4762 M6x10']) expect(texts, t).toContain(t);
  });

  it('where the parts are in the front view, by hand: the plate (0, 0), the clamp (0, 25), the pins (−40, 0) and (40, 0), the screw (0, 25)', () => {
    const a = lines.get('view1')!.anchors!.map((v) => v.map((x) => round(x, 4) + 0)); // (+ 0: not −0)
    expect(a).toEqual([[0, 0], [0, 25], [-40, 0], [40, 0], [0, 25]]);
  });

  it('a balloon for each of the four items, each with a dot on its part: the dots at the plate (0, 0), the clamp and the screw (0, 25) and the first pin (−40, 0)', () => {
    const { placed } = buildScene(doc, lines, new Map(), new Map(), new Map([['view1', bom]]));
    const own = placed.get('view1')!;
    const dots = scene.items
      .filter((i) => i.kind === 'polyline' && i.filled && i.points.length === 24)
      .map((i) => (i.kind === 'polyline' ? [0, 1].map((k) => round(i.points.filter((_, j) => j % 2 === k).reduce((s, v) => s + v, 0) / 12, 4)) : []));
    const at = (x: number, y: number) => [round(own.at[0] + (x - own.centre[0]) * own.scale, 4), round(own.at[1] + (y - own.centre[1]) * own.scale, 4)];
    expect(dots).toEqual([at(0, 0), at(0, 25), at(-40, 0), at(0, 25)]);
    const circles = scene.items.filter((i) => i.kind === 'polyline' && i.closed && !i.filled && i.points.length === 72);
    expect(circles).toHaveLength(4);
    // the numbers in the balloons are the items of the list: 1 2 3 4 (the table has them too)
    const nums = sceneTexts(scene).filter((t) => /^[1-4]$/.test(t));
    for (const n of ['1', '2', '3', '4']) expect(nums.filter((t) => t === n).length).toBeGreaterThanOrEqual(2);
  });

  it('is written as DXF and PDF, both read back with nothing wrong, the same lines to 0.01 mm', () => {
    const dxf = readDxf(toDxf(scene));
    expect(checkDxf(dxf)).toEqual([]);
    const font = readTrueType(testFont([...new Set(sceneTexts(scene).join(''))].join('')).bytes);
    const { bytes, warnings } = toPdf(scene, { font });
    expect(warnings).toEqual([]);
    const pdf = readPdf(bytes);
    expect(checkPdf(pdf)).toEqual([]);
    const a = dxf.entities.filter((e): e is DxfPolyline => e.type === 'LWPOLYLINE');
    const b = pathsInMm(pdf.pages[0]!.paths).filter((x) => !x.filled);
    expect(b).toHaveLength(a.length);
    let worst = 0;
    a.forEach((e, k) => e.points.forEach((v, i) => (worst = Math.max(worst, Math.abs(v - b[k]!.points[i]!)))));
    expect(worst).toBeLessThan(0.01);
    expect(pdf.pages[0]!.texts.map((t) => t.text)).toEqual(dxf.entities.filter((e): e is DxfText => e.type === 'TEXT').map((e) => e.text));
  });
});

describe('③ the base plate made 20 thick in the master: the drawing follows (5-6)', () => {
  it('the same drawing worked out again: the section 100 × 20 less the holes (1759.5 mm²), the thickness 20 in the top view, and the hole of the clamp, which now reaches 5 mm into the plate, is a new hole with its own dimensions and its place in the hole table', async () => {
    const { o } = await assemble({ kernel, solver, kept, stepBytes }, '20');
    const d = plateDrawing(o.parts.get(PLATE)!);
    expect(areaOf(d.lines.get('view4')!.cut!)).toBeCloseTo(100 * 20 - 2 * (6 * 20 + 0.25), 4);
    expect(d.lines.get('view2')!.box).toEqual({ min: [expect.closeTo(-50, 6), expect.closeTo(-20, 6)], max: [expect.closeTo(50, 6), expect.closeTo(0, 6)] });
    const texts = [...d.dimensions.values()].map((x) => ('text' in x ? x.text : `ERROR ${x.error}`)).sort();
    // as before, and the Ø6.6 × 5 blind hole at (0, 25): Ø6.6 深 5, 50 from the left edge (−50 → 0) and 65 from the bottom (−40 → 25)
    expect(texts).toEqual(['10', '100', '2×Ø6 H7 (+0.012/0) 貫穿', '40', '50', '65', '80', '90', 'Ø6.6 深 5'].sort());
    // the hole table: the biggest hole first, so the new one is A1; the dowel holes B1 and B2
    expect(d.tables.get('tbl1')!.map((r) => [r.tag, round(r.x, 4), round(r.y, 4), r.size])).toEqual([
      ['A1', 50, 65, 'Ø6.6 深 5'],
      ['B1', 10, 40, 'Ø6 H7 (+0.012/0) 貫穿'],
      ['B2', 90, 40, 'Ø6 H7 (+0.012/0) 貫穿'],
    ]);
    // the dowel holes are still through, now 19.5 of straight wall
    const holes = d.features.get('view1')!.flatMap((f) => (f.type === 'circle' && f.full && !f.convex ? [f.hole!] : []));
    expect(holes.filter((h) => h.through).map((h) => round(h.depth, 6))).toEqual([19.5, 19.5]);
    expect(holes.filter((h) => !h.through).map((h) => round(h.depth, 6))).toEqual([5]);
  });
});
