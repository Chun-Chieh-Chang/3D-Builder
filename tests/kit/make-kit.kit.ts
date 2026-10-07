/**
 * The verification kit (docs/manual-verification.html): the golden parts, assemblies, drawings, STEP files and sheet-metal and plastic parts the manual checks open,
 * written to a folder outside the checkout (`KIT_OUT`, default `D:\3DB實機確認`) by `npm run make:kit`. It builds them from the same definitions the acceptance tests use
 * (copied from tests/phase3/acceptance-3b, phase4b/acceptance-4b, phase5/acceptance-5, phase6/acceptance-6 and phase7/acceptance-7, which do not export them) and checks every
 * file it writes: read back, rebuilt with every feature ok, and the numbers the acceptance tests work out by hand.
 *
 * These are stand-ins made in the program, not real SolidWorks files: they show that the flows work, not that another CAD system's files come in the same way (checklist J).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { applyCommand, applyDrawingCommand, axesOf, buildBom, createEmptyDrawing, createEmptyPart, leavesOf, sectionPlane, type Dimension, type DrawingDoc, type DrawingView, type Feature, type PartDoc, type Pose, type Ref, type SourceTree } from '@3db/model';
import { componentName, exportAssemblyStep, partNameOf, readAnyDocumentFile, sha256Hex, writeAssemblyFile, writeDrawingFile, writePartFile } from '@3db/io';
import { autoDimensions, buildScene, checkDxf, flatPatternDxf, readDxf, readTrueType, toDxf, toPdf, type DxfLine, type ElementsResult, type Scene, type ViewLines } from '@3db/drawing';
import { edgeFingerprint } from '@3db/naming';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type ShapeId } from '@3db/kernel';
import { elementFacts, flatPattern, projectDrawingView, Regenerator, sheetChecks, viewFeatures, type RebuildResult } from '@3db/regen';
import { build, circle, edge, extrude, face as faceRef, fillet, front, rectangle, sketch, statuses } from '../phase1/builders';
import { FILES, jig, jigNames, loadGoldenParts, rebuildPart, solveJig, type Kind } from '../support/goldenJig';
import { assemble, workpieceStep } from '../support/jigFixture';

const OUT = process.env.KIT_OUT ?? 'D:\\3DB實機確認';
const root = process.cwd();
const manifest: { path: string; what: string; bytes: number }[] = [];

function put(rel: string, data: Uint8Array | string, what: string): void {
  const file = join(OUT, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, data);
  manifest.push({ path: rel, what, bytes: typeof data === 'string' ? Buffer.byteLength(data) : data.length });
}
const copy = (from: string, rel: string, what: string) => put(rel, new Uint8Array(readFileSync(resolve(root, from))), what);

/** What is to be looked at in a viewer (eDrawings, a CAD, Chrome) for each file of `輸出/`: the numbers are the program's own, worked out by the kernel (see 看圖清單.md). */
interface Review {
  file: string;
  title: string;
  numbers: string;
  look: string;
}
const review: Review[] = [];
const fixed = (v: number, d = 2) => v.toFixed(d);

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});
afterAll(() => {
  kept.forEach((r) => r.dispose());
  const lines = manifest.map((m) => `${m.path}\t${m.bytes}\t${m.what}`);
  console.log(`\nkit written to ${OUT}: ${manifest.length} files\n${lines.join('\n')}`);
});

const regen = (blobs = new Map<string, Uint8Array>()) => {
  const r = new Regenerator(kernel, solver, blobs);
  kept.push(r);
  return r;
};
const rebuild = (doc: PartDoc): RebuildResult => regen().rebuild(doc);
const failures = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));
const face = (name: string): Ref => ({ kind: 'face', name });
const datum = (name: string): Ref => ({ kind: 'datum', name });
const rad = (deg: number) => (deg * Math.PI) / 180;
const volumeOf = (r: RebuildResult) => kernel.massProps(r.body!.shape).volume;
const sceneTexts = (s: Scene) => s.items.flatMap((i) => (i.kind === 'text' && i.text !== '' ? [i.text] : []));
const countOf = (text: string, what: string) => text.split(what).length - 1;

/** A part written as STEP into `輸出/`, read back (the volume must agree), with its numbers kept for the list of what to look at. */
function stepOut(shape: ShapeId, name: string, title: string, look: string, handVolume?: number): void {
  const text = kernel.exportStep(shape, name);
  const volume = kernel.massProps(shape);
  const back = kernel.massProps(kernel.importStep(text).shape);
  expect(back.volume, name).toBeCloseTo(volume.volume, 2);
  if (handVolume !== undefined) expect(volume.volume, `${name} against the hand value`).toBeCloseTo(handVolume, 2);
  const b = kernel.bounds(shape);
  const size = [0, 1, 2].map((i) => fixed(b.max[i]! - b.min[i]!)).join(' × ');
  put(join('輸出', `${name}.step`), text, `STEP：${title}`);
  review.push({ file: `輸出/${name}.step`, title, numbers: `外框約 ${size} mm（x × y × z）；體積 ${fixed(volume.volume)} mm³；表面積 ${fixed(volume.area)} mm²`, look });
}

/** A part file written, read back as a part, and rebuilt: every feature ok, one valid solid. Returns the rebuilt result. */
async function putPart(rel: string, doc: PartDoc, what: string, blobs = new Map<string, Uint8Array>()): Promise<RebuildResult> {
  const bytes = await writePartFile(doc, blobs);
  put(rel, bytes, what);
  const back = await readAnyDocumentFile(bytes);
  expect(back.kind, rel).toBe('part');
  const r = regen(blobs).rebuild(doc);
  expect(failures(r), rel).toEqual([]);
  return r;
}

describe('A. the basic files of the checklist (P2)', () => {
  it('copies the three golden parts and the STEP plate with a hole', () => {
    copy('tests/golden/locating-plate.3dbx', 'locating-plate.3dbx', '定位板 120×80×15（金樣，體積 137197.0207 mm³）');
    copy('tests/golden/v-block.3dbx', 'v-block.3dbx', 'V 型塊 60×40×50（金樣，體積 108114.3364 mm³）');
    copy('tests/golden/diamond-pin.3dbx', 'diamond-pin.3dbx', '削邊銷（金樣，體積 2487.0292 mm³）');
    copy('tests/fixtures/step/plate-with-hole.step', 'plate-with-hole.step', 'STEP：40×30×10 的板、中間一個半徑 4 的孔');
  });

  it('writes a plate with every kind of hole a drawing writes a callout for (F4 of the manual: tapped, countersunk, counterbored, dowel)', async () => {
    const hole = (n: number, x: number, y: number, extra: Record<string, unknown>): Feature[] => [
      { ...sketch(`s${n}`, faceRef('e1:cap:end')), entities: [{ id: `p${n}`, type: 'point', x, y }] } as Feature,
      { id: `h${n}`, type: 'hole', name: `h${n}`, suppressed: false, sketch: `s${n}`, kind: 'straight', diameter: '6', end: { type: 'throughAll' }, ...extra } as Feature,
    ];
    const doc = build(
      sketch('s1', front, rectangle('a', 0, 0, 120, 80)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '15' }),
      ...hole(2, 20, 20, { kind: 'tapped', size: 'M6', diameter: '5' }),
      ...hole(3, 50, 20, { kind: 'tapped', size: 'M8', diameter: '6.8', end: { type: 'blind', depth: '12' } }),
      ...hole(4, 80, 20, { kind: 'countersink', diameter: '6', csDiameter: '12', csAngle: '90deg' }),
      ...hole(5, 20, 55, { kind: 'counterbore', diameter: '6.6', cbDiameter: '11', cbDepth: '6.5' }),
      ...hole(6, 50, 55, { kind: 'dowel', diameter: '6', fit: 'H7', chamfer: '0.5' }),
      ...hole(7, 80, 55, { diameter: '9', end: { type: 'blind', depth: '8' } }),
    );
    const r = await putPart('孔標註.3dbx', doc, '孔標註用的板 120×80×15：M6 貫穿、M8 深 12、錐孔 Ø6→Ø12 90°、柱孔、定位銷孔（入口導角 0.5）、盲孔 Ø9 深 8（手冊 F4）');
    expect(kernel.isValid(r.body!.shape)).toBe(true);
  });
});

describe('B. a jig made from a master model (checklist D, E, F)', () => {
  it('writes the master, the derived parts, the library parts and the assembly with its mates, and two drawings', async () => {
    const stepBytes = workpieceStep(kernel, solver, kept);
    put('夾具組/工件.step', stepBytes, 'STEP：工件 40×30×20 的方塊（夾具主模型用的參考本體）');
    const { p, o } = await assemble({ kernel, solver, kept, stepBytes });
    const main = [...p.files.keys()].find((k) => k.endsWith('.3dba'))!;
    for (const [path, bytes] of p.files) if (path !== main) put(join('夾具組', path), bytes, path === '夾具.3dbx' ? '夾具主模型：工件（參考本體）、基板（2 個 Ø6 H7 定位銷孔）、壓板（螺絲孔）' : `零件檔 ${path}`);
    // the assembly as `assemble` left it, with the pins, the screw and the mates (the file made from the master has none of them)
    put(join('夾具組', main), await writeAssemblyFile(p.doc), '夾具組合件：基板、壓板、2 支定位銷、1 支螺絲，結合已建立');
    expect(p.doc.components.map((c) => c.id)).toHaveLength(6);
    expect(o.solved.poses.size).toBe(6);

    // the base plate's drawing and the assembly drawing, as the acceptance of Phase 5 makes them
    const PLATE = '零件/基板.3dbx';
    const part = o.parts.get(PLATE)!;
    const views: DrawingView[] = [
      { id: 'view1', name: '前視', source: PLATE, direction: 'front' },
      { id: 'view2', name: '上視', source: PLATE, direction: 'top' },
      { id: 'view3', name: '右視', source: PLATE, direction: 'right' },
      { id: 'view4', name: 'A-A', kind: 'section', parent: 'view1', line: [[-60, 0], [60, 0]], label: 'A' },
    ];
    let drawing: DrawingDoc = applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views });
    drawing = applyDrawingCommand(drawing, { type: 'setTitle', field: 'drawingName', value: '基板' });
    drawing = applyDrawingCommand(drawing, { type: 'setSheet', sheet: { scale: [1, 1] } });
    const lines = new Map<string, ViewLines>();
    const features = new Map<string, ReturnType<typeof viewFeatures>>();
    const IDENTITY: Pose = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
    const shapes = [{ shape: part.shape, pose: IDENTITY, mirrored: false }];
    for (const v of drawing.views) {
      const axes = axesOf(drawing.views, drawing.sheet.projection, v)!;
      if (v.kind === 'section') {
        const parent = drawing.views.find((x) => x.id === v.parent)!;
        lines.set(v.id, projectDrawingView(kernel, shapes, axes, sectionPlane(axesOf(drawing.views, drawing.sheet.projection, parent)!, v)));
      } else {
        lines.set(v.id, projectDrawingView(kernel, shapes, axes));
        features.set(v.id, viewFeatures(part.mate.topology, part.mate.names, axes, undefined, part.holes));
      }
    }
    const drafts = autoDimensions(features.get('view1')!, { overall: true, holes: true, positions: true, callouts: true });
    const dimensions = drafts.map((d, i) => ({ ...d, id: `dim${i + 1}`, view: 'view1', ...(d.kind === 'diameter' && d.count === 2 ? { tolerance: { type: 'fit', fit: 'H7' } } : {}) }) as Dimension);
    drawing = applyDrawingCommand(drawing, { type: 'insertDimensions', dimensions });
    drawing = applyDrawingCommand(drawing, { type: 'insertTables', tables: [{ id: 'tbl1', kind: 'holes', view: 'view1', fits: { '6': 'H7' } }] });
    const elements = new Map<string, ElementsResult>(
      drawing.dimensions.map((d) => {
        const refs: Ref[] = d.kind === 'linear' || d.kind === 'angle' ? [d.a, d.b] : [d.ref];
        return [d.id, { elements: refs.map((r) => elementFacts(part.mate.topology, part.mate.names, r, part.holes)) as never }];
      }),
    );
    const built = buildScene(drawing, lines, elements, features);
    const texts = [...built.dimensions.values()].map((x) => ('text' in x ? x.text : `ERROR ${x.error}`)).sort();
    expect(texts).toEqual(['10', '100', '2×Ø6 H7 (+0.012/0) 貫穿', '40', '80', '90'].sort());
    expect(built.tables.get('tbl1')!.map((r) => r.tag)).toEqual(['A1', 'A2']);
    expect(sceneTexts(built.scene)).toContain('A-A');
    const plateBytes = await writeDrawingFile(drawing);
    expect((await readAnyDocumentFile(plateBytes)).kind).toBe('drawing');
    put(join('夾具組', '基板加工圖.3dbd'), plateBytes, '基板加工圖：前、上、右視圖與 A-A 剖面、自動尺寸（含 2×Ø6 H7）、孔表');

    // the same things written for a viewer
    stepOut(part.shape, '基板', '夾具的基板 100×80×15，2 個 Ø6 定位銷孔（入口 C0.5 導角）', '兩個貫穿的 Ø6 孔在 x = ±40、y = 0（孔位置左右對稱）；孔口有一圈小導角；沒有多餘的面或破洞');
    const dxfText = toDxf(built.scene);
    expect(checkDxf(readDxf(dxfText))).toEqual([]);
    put(join('輸出', '基板加工圖.dxf'), dxfText, 'DXF：基板加工圖（圖頁 A3，視圖與 A-A 剖面、尺寸、孔表）');
    review.push({
      file: '輸出/基板加工圖.dxf',
      title: '基板加工圖的 DXF',
      numbers: `圖上文字：${[...new Set(sceneTexts(built.scene))].filter((t) => /[0-9]/.test(t)).join('、')}；尺寸 100、80 是總長寬，孔位置 10 與 90 從左邊量、40 從下邊量`,
      look: '4 個視圖（前、上、右與 A-A 剖面）的位置與比例 1:1；剖面線是 45° 細線；尺寸線有箭頭、延伸線與孔的中心記號；右上角的孔表有 A1、A2。尺寸是線與文字，不是 DXF 的 DIMENSION 圖元，所以在 CAD 裡不能用「編輯尺寸」改數值（已知限制）。中文在 CAD 裡需把文字樣式換成有中文的字型',
    });
    const fontFile = 'C:\\Windows\\Fonts\\msjh.ttc';
    const font = existsSync(fontFile) ? readTrueType(new Uint8Array(readFileSync(fontFile))) : undefined;
    const pdf = toPdf(built.scene, { ...(font ? { font } : {}), title: '基板' });
    put(join('輸出', '基板加工圖.pdf'), pdf.bytes, `PDF：基板加工圖${font ? '（內嵌微軟正黑體）' : '（沒有字型：中文以 ? 代替）'}`);
    review.push({
      file: '輸出/基板加工圖.pdf',
      title: '基板加工圖的 PDF',
      numbers: font ? '警告：' + (pdf.warnings.length ? pdf.warnings.join('；') : '無') : '這台電腦找不到微軟正黑體，中文以 ? 代替',
      look: '用 Chrome 開（eDrawings 不開 PDF）：線寬、虛線、箭頭、中文是否正常，文字能不能搜尋與複製',
    });

    // the assembly as STEP, as the app writes it: one product for each file, a component for each place
    const stepParts = p.doc.files.map((f) => ({ shape: o.parts.get(f.path)!.shape, name: partNameOf(f.path) }));
    const stepInstances = p.doc.components.map((c) => ({ part: p.doc.files.findIndex((f) => f.id === c.file), name: componentName(p.doc.files.find((f) => f.id === c.file)?.path, c.instance), pose: o.solved.poses.get(c.id)! }));
    const jigStep = exportAssemblyStep(kernel, '夾具', stepParts, stepInstances);
    put(join('輸出', '夾具組合件.step'), jigStep, 'STEP 組合件：基板、壓板、2 支定位銷、1 支螺絲，加工件（參考本體）');
    review.push({
      file: '輸出/夾具組合件.step',
      title: '夾具組合件',
      numbers: `${stepInstances.length} 個零組件、${stepParts.length} 個產品（NEXT_ASSEMBLY_USAGE_OCCURRENCE ${countOf(jigStep, 'NEXT_ASSEMBLY_USAGE_OCCURRENCE')} 筆）；零組件：${stepInstances.map((i) => i.name).join('、')}`,
      look: '零件樹的階層與名稱；工件<1> 是 40×30×20 的方塊，站在基板中央上方（z 15 到 35）；2 支銷插在基板的 2 個孔裡（銷頂與基板頂面齊平），螺絲插在壓板的孔裡，壓板站在基板上、貼著工件的 +y 側；沒有零件飄在別處或穿透別的零件',
    });

    const trees: Record<string, SourceTree> = {};
    for (const c of p.doc.components) trees[c.id] = { kind: 'part', key: o.pathOf(c.id), path: o.pathOf(c.id) };
    const isRef = (key: string) => o.parts.get(key)!.reference.every(Boolean);
    const leaves = leavesOf(p.doc, trees, (id) => o.solved.poses.get(id) ?? null).filter((l) => !isRef(l.key));
    const rows = buildBom({ doc: p.doc, trees, propsOf: (key) => o.parts.get(key) && undefined, isReference: isRef }).flat;
    expect(rows.map((r) => [r.item, r.name, r.qty])).toEqual([['1', '基板', 1], ['2', '壓板', 1], ['3', 'ISO 8734 6m6x20', 2], ['4', 'ISO 4762 M6x10', 1]]);
    let assembly: DrawingDoc = applyDrawingCommand(createEmptyDrawing(), {
      type: 'insertViews',
      views: [
        { id: 'view1', name: '前視', source: main, direction: 'front' },
        { id: 'view2', name: '右視', source: main, direction: 'right' },
      ],
    });
    assembly = applyDrawingCommand(assembly, { type: 'insertTables', tables: [{ id: 'tbl1', kind: 'bom', view: 'view1', balloons: true }] });
    const assemblyBytes = await writeDrawingFile(assembly);
    expect((await readAnyDocumentFile(assemblyBytes)).kind).toBe('drawing');
    put(join('夾具組', '組合圖.3dbd'), assemblyBytes, '組合圖：前視與右視、零件表（4 項）與零件號球');
  });
});

describe('C. the golden assembly of fifteen components and its STEP files (checklist D, J2 stand-in)', () => {
  it('writes the three golden parts, the assembly with 39 mates, the flat and the nested STEP assembly', async () => {
    const docs = await loadGoldenParts();
    const rebuilt = { plate: rebuildPart(kernel, solver, kept, docs.plate), pin: rebuildPart(kernel, solver, kept, docs.pin), vblock: rebuildPart(kernel, solver, kept, docs.vblock) };
    for (const k of Object.keys(FILES) as Kind[]) put(join('組合件金樣', FILES[k]), await writePartFile(docs[k]), `零件 ${FILES[k]}（與 tests/golden 相同）`);
    stepOut(rebuilt.plate.shape, '定位板', '定位板 120×80×15（金樣）', '4 個 Ø9 與 2 個 Ø8 貫穿孔；4 個外角 R10；頂面一圈 C1 導角', 137197.0207);
    stepOut(rebuilt.vblock.shape, 'V型塊', 'V 型塊 60×40×50（金樣）', '90° V 槽、槽底圓角 R2；右側面 2 個 Ø6 盲孔深 12', 108114.3364);
    stepOut(rebuilt.pin.shape, '削邊銷', '削邊銷（金樣）', '壓入段 Ø10×15、凸緣 Ø16×4、定位段 Ø8×12；環溝；定位段兩側削邊（平面）', 2487.0292);
    const built = jig(jigNames(rebuilt));
    const solved = solveJig(built.doc, rebuilt);
    expect(built.doc.components).toHaveLength(15);
    expect(built.doc.mates).toHaveLength(39);
    expect(solved.poses.size).toBe(15);
    put(join('組合件金樣', '金樣夾具.3dba'), await writeAssemblyFile(built.doc), '金樣夾具：3 塊定位板各配 2 支銷與 2 塊 V 型塊，15 個零組件、39 個結合');

    const kindOfFile = (id: string): Kind => (Object.keys(FILES) as Kind[]).find((k) => FILES[k] === built.doc.files.find((f) => f.id === id)!.path)!;
    const flat = exportAssemblyStep(
      kernel,
      '夾具',
      built.doc.files.map((f) => ({ shape: rebuilt[kindOfFile(f.id)].shape, name: partNameOf(f.path) })),
      built.doc.components.map((c) => ({ part: built.doc.files.findIndex((f) => f.id === c.file), name: componentName(built.doc.files.find((f) => f.id === c.file)?.path, c.instance), pose: solved.poses.get(c.id)! })),
    );
    expect(countOf(flat, 'NEXT_ASSEMBLY_USAGE_OCCURRENCE')).toBeGreaterThanOrEqual(15);
    put(join('STEP替身', '金樣夾具_平.step'), flat, 'STEP 組合件（平的）：3 個產品、15 個零組件，可用「輸入 STEP 組合件」讀入');

    const station = built.ids[0]!;
    const members = [station.plate, station.pinA, station.pinB, station.v1, station.v2].map((id) => built.doc.components.find((c) => c.id === id)!);
    const used = [...new Set(members.map((c) => c.file))];
    const PITCH = 120;
    const axisY = (angle: number): [number, number, number, number] => [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
    const placements: Pose[] = [
      { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
      { position: [PITCH, 0, 0], rotation: [0, 0, 0, 1] },
      { position: [2 * PITCH + 20, 0, 35], rotation: axisY(0.5) },
    ];
    const nested = exportAssemblyStep(
      kernel,
      '夾具',
      used.map((id) => ({ shape: rebuilt[kindOfFile(id)].shape, name: partNameOf(built.doc.files.find((f) => f.id === id)!.path) })),
      placements.map((pose, i) => ({ sub: 0, name: `工位<${i + 1}>`, pose })),
      [{ name: '工位', instances: members.map((c) => ({ part: used.indexOf(c.file), name: componentName(built.doc.files.find((f) => f.id === c.file)?.path, c.instance), pose: solved.poses.get(c.id)! })) }],
    );
    expect(countOf(nested, 'NEXT_ASSEMBLY_USAGE_OCCURRENCE')).toBeGreaterThanOrEqual(8);
    put(join('STEP替身', '金樣夾具_巢狀.step'), nested, 'STEP 組合件（巢狀）：次組合件「工位」用 3 次（第 3 次轉了角度），共 15 個零件');
  });
});

describe('D. workpieces for the gauge block (checklist G, J4 stand-in)', () => {
  const plane = (id: string, z: number): Feature => ({ id, type: 'refPlane', name: id, suppressed: false, def: { mode: 'offset', plane: front, distance: String(z), reverse: true } }) as Feature;
  const on = (name: string) => ({ kind: 'datum', name }) as const;
  const freeform = () =>
    build(
      sketch('a0', front, circle('k0', 0, 0, 25)),
      plane('pa', 30),
      sketch('a1', on('pa'), circle('k1', 0, 0, 15)),
      plane('pb', 60),
      sketch('a2', on('pb'), circle('k2', 0, 0, 22)),
      { id: 'lf', type: 'loft', name: 'lf', suppressed: false, sections: ['a0', 'a1', 'a2'], op: 'boss' } as Feature,
    );
  const rounded = () => build(sketch('s', front, rectangle('w', -30, -20, 60, 40)), extrude('e', 's', 'boss', { type: 'blind', depth: '30' }), fillet('f1', [edge('{e:cap:end|e:side:s.wl1}')], '5'));
  const stepOf = (doc: PartDoc, rel: string, what: string): ShapeId => {
    const shape = regen().rebuild(doc).body!.shape;
    const text = kernel.exportStep(shape, 'workpiece');
    put(rel, text, what);
    const back = kernel.importStep(text);
    expect(kernel.massProps(back.shape).volume).toBeCloseTo(kernel.massProps(shape).volume, 2);
    return shape;
  };

  it('writes a freeform workpiece (a loft Ø50, Ø30, Ø44 over 60) and a block with a rounded edge as STEP', () => {
    const f = stepOf(freeform(), join('STEP替身', '自由曲面工件.step'), 'STEP：放樣成的自由曲面工件（Ø50→Ø30→Ø44，高 60），側面是 B 樣條');
    expect(kernel.massProps(f).volume).toBeGreaterThan(0);
    // 60 × 40 × 30 less the fillet R5 on a 40 long edge: 72000 − (1 − π/4) × 25 × 40
    const r = stepOf(rounded(), join('STEP替身', '圓角方塊.step'), 'STEP：60×40×30 的方塊，頂面一側邊圓角 R5');
    expect(kernel.massProps(r).volume).toBeCloseTo(72000 - (1 - Math.PI / 4) * 25 * 40, 2);
  });
});

describe('E. a plastic housing and its cover (checklist H, J5 stand-in)', () => {
  const T = Math.tan(rad(1));
  const points = (id: string, plane: Ref, ...pts: [string, number, number][]): Feature => ({ ...sketch(id, plane), entities: pts.map(([p, x, y]) => ({ id: p, type: 'point', x, y })) }) as Feature;
  const plane = (id: string, z: string): Feature => ({ id, type: 'refPlane', name: id, suppressed: false, def: { mode: 'offset', plane: front, distance: z } }) as Feature;
  function make(...features: Feature[]): PartDoc {
    let doc = applyCommand(createEmptyPart(), { type: 'addVariable', variable: { id: 'var1', name: 'floorT', expr: '3' } });
    features.forEach((feature, index) => (doc = applyCommand(doc, { type: 'insertFeature', feature, index })));
    return doc;
  }
  const SIDES = ['rl0', 'rl1', 'rl2', 'rl3'].map((e) => face(`e:side:s.${e}`));
  const body = (): Feature[] => [
    sketch('s', front, rectangle('r', -30, -20, 60, 40)),
    extrude('e', 's', 'boss', { type: 'blind', depth: '30' }),
    { id: 'd1', type: 'draft', name: 'd1', suppressed: false, neutral: face('e:cap:end'), faces: SIDES, angle: '1deg' } as Feature,
    { id: 'sh1', type: 'shell', name: 'sh1', suppressed: false, faces: [face('e:cap:end')], thickness: '2', faceThickness: [{ face: face('e:cap:start'), thickness: 'floorT' }] } as Feature,
  ];
  function rimName(): string {
    const r = rebuild(make(...body()));
    const i = r.body!.topology.faces.findIndex((f) => f.normal && f.normal[2] > 0.99 && Math.abs(f.center[2] - 30) < 1e-6);
    expect(i).toBeGreaterThanOrEqual(0);
    return r.body!.names.faces[i]!;
  }
  const housing = (rim: string): Feature[] => [
    ...body(),
    { id: 'lp', type: 'lipGroove', name: 'lp', suppressed: false, face: face(rim), kind: 'lip', offset: '0.5', width: '1', height: '1' } as Feature,
    plane('pf', 'floorT'),
    points('skb', datum('pf'), ['b1', 20, 10], ['b2', -20, -10]),
    { id: 'sb', type: 'screwBoss', name: 'sb', suppressed: false, sketch: 'skb', diameter: '6', holeDiameter: '2.5', height: '10', draft: '1deg' } as Feature,
    points('skh', datum('pf'), ['h1', -15, 10]),
    { id: 'hk', type: 'snapHook', name: 'hk', suppressed: false, sketch: 'skh', width: '6', thickness: '2', length: '33', hookHeight: '3', hookDepth: '1.2' } as Feature,
    points('skf', datum('pf'), ['f1', -12.35, 10]),
    { id: 'fw', type: 'snapCatch', name: 'fw', suppressed: false, sketch: 'skf', length: '1.3', width: '6.4', depth: 'floorT + 1' } as Feature,
  ];
  const cover = (): Feature[] => [
    sketch('cs', front, rectangle('cr', -30, -20, 60, 40)),
    extrude('c', 'cs', 'boss', { type: 'blind', depth: '3' }),
    { id: 'gv', type: 'lipGroove', name: 'gv', suppressed: false, face: face('c:cap:start'), kind: 'groove', offset: '0.4', width: '1.2', height: '1.2' } as Feature,
    plane('pc', '3'),
    points('skw', datum('pc'), ['w1', -13.4, 10]),
    { id: 'wn', type: 'snapCatch', name: 'wn', suppressed: false, sketch: 'skw', length: '3.4', width: '6.4', depth: '4' } as Feature,
  ];
  /** The housing's own volume by hand (the same working as tests/phase6/acceptance-6.test.ts). */
  function byHand() {
    const h = 2 / Math.cos(rad(1));
    const outer = 72000 - 90000 * T + 36000 * T * T;
    const a = 60 - 2 * h;
    const b = 40 - 2 * h;
    const cavity = 27 * a * b - (2 * T * (a + b) * 27 ** 2) / 2 + (4 * T * T * 27 ** 3) / 3;
    const R = 3;
    const rh = 1.25;
    const top = R - 10 * T;
    const boss = (Math.PI * 10 * (R * R + R * top + top * top)) / 3 - Math.PI * rh * rh * 10;
    return { shell: outer - cavity, lip: 192, boss, hook: 2 * 6 * 33 + 0.5 * 1.2 * 3 * 6, window: 1.3 * 6.4 * 3 };
  }

  it('writes the housing (walls 2, floor 3 as the variable floorT, 1° draft, lip, two screw bosses, a snap hook and its window) and the cover (groove and window)', async () => {
    const hand = byHand();
    const h = await putPart('塑膠件/外殼.3dbx', make(...housing(rimName())), '塑膠外殼 60×40×30：壁 2、底 3（變數 floorT）、拔模 1°、唇、2 個螺柱、卡榫與底窗');
    expect(kernel.solidCount(h.body!.shape)).toBe(1);
    expect(kernel.isValid(h.body!.shape)).toBe(true);
    expect(volumeOf(h)).toBeCloseTo(hand.shell + hand.lip + 2 * hand.boss + hand.hook - hand.window, 2);
    stepOut(h.body!.shape, '塑膠外殼', '塑膠外殼 60×40×30', '開口朝 +z；壁與底厚（2 與 3）、壁有拔模（開口處較寬）；開口邊緣一圈唇；底上 2 個螺柱（孔 Ø2.5）、1 個懸臂卡榫；卡榫下方的底有一個矩形窗。外框高 36 而不是 30：卡榫從底（z = 3）長 33，比開口邊緣（z = 30）高出 6，是設計如此（鉤要穿過蓋的窗）', hand.shell + hand.lip + 2 * hand.boss + hand.hook - hand.window);
    const c = await putPart('塑膠件/蓋.3dbx', make(...cover()), '外殼的蓋 60×40×3：溝槽配外殼的唇、窗讓卡榫的鉤穿過');
    expect(kernel.solidCount(c.body!.shape)).toBe(1);
    expect(kernel.isValid(c.body!.shape)).toBe(true);
    stepOut(c.body!.shape, '塑膠蓋', '外殼的蓋 60×40×3', '一面有環形溝槽（對外殼的唇），並有一個矩形窗穿過整個厚度（卡榫的鉤穿過）');
  });
});

describe('F. a sheet-metal bracket (checklist I, J6 stand-in)', () => {
  const plateSketch = (length = 120, holeX = 40): Feature => sketch('sk', front, rectangle('r', 0, 0, length, 60), circle('h1', holeX, 20, 2.5), circle('h2', 40, 40, 2.5)) as Feature;
  const baseFlange = (): Feature => ({ id: 'bf', type: 'baseFlange', name: 'bf', suppressed: false, sketch: 'sk', thickness: '1.5', radius: '2', kFactor: '0.5' }) as Feature;
  const doc = (features: Feature[]): PartDoc => features.reduce((d, feature, index) => applyCommand(d, { type: 'insertFeature', feature, index }), createEmptyPart());
  function edges(length = 120): { a: Ref; b: Ref; hem: Ref } {
    const r = rebuild(doc([plateSketch(length), baseFlange()]));
    const at = (mid: [number, number, number]): Ref => {
      const i = r.body!.topology.edges.findIndex((e) => e.curve === 'line' && Math.hypot(e.mid[0] - mid[0], e.mid[1] - mid[1], e.mid[2] - mid[2]) < 1e-6);
      expect(i, `an edge at ${mid}`).toBeGreaterThanOrEqual(0);
      return { kind: 'edge', name: r.body!.names.edges[i]!, fingerprint: edgeFingerprint(r.body!.topology, i) };
    };
    return { a: at([length, 30, 1.5]), b: at([length / 2, 60, 1.5]), hem: at([length / 2, 0, 1.5]) };
  }

  it('writes the flat plate and the bracket (90° flange with reliefs, 135° flange, hem), its flat pattern as DXF, and the checks pass', async () => {
    const plate = await putPart('鈑金/平板.3dbx', doc([plateSketch(), baseFlange()]), '鈑金平板 120×60×1.5：內側半徑 2、K 因子 0.5、2 個 Ø5 孔（只有基材凸緣）');
    expect(plate.sheet).toBeDefined();
    stepOut(plate.body!.shape, '鈑金平板', '鈑金平板 120×60×1.5', '一塊平板、板厚 1.5、2 個 Ø5 孔在 (40, 20) 與 (40, 40)；沒有折彎');
    const e = edges();
    const bracket = doc([
      plateSketch(),
      baseFlange(),
      { id: 'fa', type: 'edgeFlange', name: '90° 凸緣', suppressed: false, edge: e.a, length: '40', inset: { start: '10', end: '10' }, relief: { width: '1.5', depth: '1.5' } } as Feature,
      { id: 'fb', type: 'edgeFlange', name: '135° 凸緣', suppressed: false, edge: e.b, length: '25', angle: '135deg', inset: { start: '8', end: '0' }, relief: { width: '1.5', depth: '1.5' } } as Feature,
      { id: 'hm', type: 'hem', name: '摺邊', suppressed: false, edge: e.hem, length: '7', gap: '1' } as Feature,
    ]);
    const r = await putPart('鈑金/支架.3dbx', bracket, '鈑金支架：平板 120×60×1.5 加 90° 凸緣（高 40，兩端縮短 10 並有離隙）、135° 凸緣（長 25）、摺邊（間隙 1，回折 7）');
    expect(kernel.solidCount(r.body!.shape)).toBe(1);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    const checks = sheetChecks(kernel, r.sheet!);
    expect(checks).toHaveLength(9);
    expect(checks.every((c) => c.ok)).toBe(true);
    const pattern = flatPattern(kernel, r.sheet!);
    kernel.release(pattern.shape);
    const dxf = flatPatternDxf(pattern);
    expect(dxf).toContain('OUTLINE');
    expect(dxf).toContain('BEND');
    put('鈑金/支架_平板型式.dxf', dxf, '支架的平板型式 DXF（OUTLINE 層與 BEND 層）：可用你的 CAD 開啟對照');
    put(join('輸出', '支架_平板型式.dxf'), dxf, 'DXF：支架的平板型式');
    const dxfDoc = readDxf(dxf);
    expect(checkDxf(dxfDoc)).toEqual([]);
    const outline = dxfDoc.entities.filter((e): e is DxfLine => e.type === 'LINE' && e.layer === 'OUTLINE');
    const xs = outline.flatMap((l) => [l.a[0], l.b[0]]);
    const ys = outline.flatMap((l) => [l.a[1], l.b[1]]);
    review.push({
      file: '輸出/支架_平板型式.dxf',
      title: '支架的平板型式 DXF',
      numbers: `輪廓（OUTLINE 層）外框 ${fixed(Math.max(...xs) - Math.min(...xs))} × ${fixed(Math.max(...ys) - Math.min(...ys))} mm；2 個 Ø5 圓；BEND 層有折彎線（虛線）與 UP 90° R2 之類的註記`,
      look: '外框是否與數字相符；2 個孔圓；折彎線在凸緣與板相接處；輪廓移到原點（左下角在 0, 0）。用你的 CAD 開，看圖層、線型',
    });
    stepOut(r.body!.shape, '鈑金支架', '鈑金支架（折好的）', '平板加 90° 凸緣（x = 120 邊，兩端各縮短 10 並有矩形離隙）、135° 凸緣（y = 60 邊，一端縮短 8）、摺邊（y = 0 邊，180° 回折、間隙 1）；折彎處是圓弧面');
  });
});

describe('H. the files of the features made after the first round of checks (curved surfaces, sheet metal)', () => {
  const feat = (f: Record<string, unknown>) => f as unknown as Feature;
  const offset = (id: string, face: string, distance: string): Feature => feat({ id, type: 'offsetSurface', name: id, suppressed: false, faces: [{ kind: 'face', name: face }], distance });
  const edgeAtMid = (r: RebuildResult, mid: [number, number, number]): Ref => {
    const i = r.body!.topology.edges.findIndex((e) => e.curve === 'line' && Math.hypot(e.mid[0] - mid[0], e.mid[1] - mid[1], e.mid[2] - mid[2]) < 1e-6);
    expect(i, `an edge at ${mid}`).toBeGreaterThanOrEqual(0);
    return { kind: 'edge', name: r.body!.names.edges[i]!, fingerprint: edgeFingerprint(r.body!.topology, i) };
  };
  const plate = (w: number, h: number): Feature[] => [sketch('sk', front, rectangle('r', 0, 0, w, h)) as Feature, feat({ id: 'bf', type: 'baseFlange', name: 'bf', suppressed: false, sketch: 'sk', thickness: '1.5', radius: '2', kFactor: '0.5' })];
  const doc = (features: Feature[]): PartDoc => features.reduce((d, feature, index) => applyCommand(d, { type: 'insertFeature', feature, index }), createEmptyPart());

  it('writes the mutual trim (two surfaces crossing: 750 + 450 and 360 + 240) and the thicken on both sides with the surface kept', async () => {
    const block = [sketch('s1', front, rectangle('r', 0, 0, 40, 30)) as Feature, extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }) as Feature, offset('os1', 'e1:cap:end', '-8'), offset('os2', 'e1:side:s1.rl1', '-15')];
    const trim = feat({ id: 'mt1', type: 'mutualTrim', name: 'mt1', suppressed: false, a: { kind: 'body', name: 'os1' }, b: { kind: 'body', name: 'os2' } });
    const r = await putPart('曲面/互相修剪.3dbx', doc([...block, trim]), '互相修剪：方塊 40×30×20，頂面偏移 8 的平面與側面偏移 15 的平面互相切開：第一個 750 + 450、第二個 360 + 240（手冊 G3）；點一片去掉');
    expect(r.bodies.map((b) => [b.id, b.surface])).toEqual([['e1', false], ['os1', true], ['os2', true]]);
    const cyl = [sketch('s1', front, circle('c', 0, 0, 10)) as Feature, extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }) as Feature, offset('os1', 'e1:side:s1.c', '3')];
    const thick = feat({ id: 'th1', type: 'thicken', name: 'th1', suppressed: false, body: { kind: 'body', name: 'os1' }, thickness: '4', both: true, keepSurface: true });
    const t = await putPart('曲面/厚面兩側.3dbx', doc([...cyl, thick]), '厚面兩側並保留曲面：圓柱 R10×20 的側面偏移 3（R13 的曲面），總厚 4 兩側各 2：實體 π(15²−11²)·20 = 6534.512 mm³，曲面本體還在（手冊 G4）');
    expect(t.bodies.map((b) => [b.id, b.surface])).toEqual([['e1', false], ['os1', true], ['th1', false]]);
    expect(kernel.massProps(t.bodies.find((b) => b.id === 'th1')!.shape).volume).toBeCloseTo(Math.PI * (225 - 121) * 20, 3);
    stepOut(t.bodies.find((b) => b.id === 'th1')!.shape, '厚面兩側', '厚面兩側：圓柱偏移 3 的曲面（R13）厚 4、兩側各 2', '一個圓筒壁：外半徑 15、內半徑 11、高 20，沒有蓋；內外都是光滑的圓柱面，兩端是環形的平面', Math.PI * (225 - 121) * 20);
  });

  it('writes the mitred corner, the mid bend, the flange on a bent base, and the hole made after the bend', async () => {
    const flangeA = feat({ id: 'fa', type: 'edgeFlange', name: 'fa', suppressed: false, edge: { kind: 'edge', name: '{bf:cap:end|bf:side:sk.rl1}' }, length: '40' });
    const withA = rebuild(doc([...plate(100, 60), flangeA]));
    const flangeB = feat({ id: 'fb', type: 'edgeFlange', name: 'fb', suppressed: false, edge: edgeAtMid(withA, [48.25, 60, 1.5]), length: '30', miter: { start: '0' } });
    const m = await putPart('鈑金/斜接.3dbx', doc([...plate(100, 60), flangeA, flangeB]), '斜接：板 100×60×1.5，x = 100 邊的凸緣（長 40）與 y = 60 邊的凸緣（長 30）在角落以 45° 接合，間隙 0；體積約 16382 mm³（手冊 I2）');
    expect(kernel.massProps(m.body!.shape).volume).toBeCloseTo(16382.12, 0);
    stepOut(m.body!.shape, '斜接', '鈑金斜接：板 100×60×1.5，兩個凸緣（高 40 與 30）在角落以 45° 接合', '角落沒有縫也沒有重疊：兩個凸緣的牆在角落貼在一起，高的那一片（40）比低的那一片（30）多出來的 10 mm 留下一個斜的端面；折彎處是圓弧面、兩片的折彎在角落銜接', 16382.1188);

    const line = { ...sketch('sm', front), entities: [{ id: 'a', type: 'point', x: 50, y: -5 }, { id: 'b', type: 'point', x: 50, y: 55 }, { id: 'l', type: 'line', p1: 'a', p2: 'b' }] } as unknown as Feature;
    const bend = await putPart('鈑金/中間折彎.3dbx', doc([...plate(100, 50), line, feat({ id: 'mb', type: 'midBend', name: 'mb', suppressed: false, sketch: 'sm', angle: '90' })]), '中間折彎：板 100×50×1.5 在 x = 50 折 90°（左邊不動）；體積 7500 mm³，展平圖還是 100×50 加一條折彎線（手冊 I1）');
    expect(kernel.massProps(bend.body!.shape).volume).toBeCloseTo(7500, 3);
    stepOut(bend.body!.shape, '中間折彎', '鈑金中間折彎：板 100×50×1.5 在 x = 50 折 90°', '左半（x 到 47.84）平放不動，中間是圓弧的折彎，右半（47.84 長）垂直向上；外框約 51.340 × 50 × 51.340（折彎外側最大 x 與右半頂端高度都是 51.340）；板厚處處 1.5', 7500);

    const pts: [number, number][] = [[0, 0], [60, 0], [60, 40]];
    const path = { ...sketch('sk', front), entities: [...pts.map(([x, y], i) => ({ id: `p${i}`, type: 'point', x, y })), ...pts.slice(1).map((_, i) => ({ id: `l${i}`, type: 'line', p1: `p${i}`, p2: `p${i + 1}` }))] } as unknown as Feature;
    const bentBase = feat({ id: 'bf', type: 'baseFlange', name: 'bf', suppressed: false, sketch: 'sk', thickness: '1.5', radius: '2', kFactor: '0.5', depth: '40' });
    const bare = rebuild(doc([path, bentBase]));
    const endEdge = bare.body!.topology.edges.findIndex((e) => e.curve === 'line' && e.dir && Math.abs(Math.abs(e.dir[2]) - 1) < 1e-9 && Math.abs(e.mid[1] - 40) < 1e-6);
    expect(endEdge).toBeGreaterThanOrEqual(0);
    const flange = feat({ id: 'fa', type: 'edgeFlange', name: 'fa', suppressed: false, edge: { kind: 'edge', name: bare.body!.names.edges[endEdge]!, fingerprint: edgeFingerprint(bare.body!.topology, endEdge) }, length: '20' });
    const b = await putPart('鈑金/折過基材加凸緣.3dbx', doc([path, bentBase, flange]), '折過的基材（L 形路徑 (0,0)(60,0)(60,40)，板寬 40）加第二段末端的 90° 凸緣（長 20）；平板型式是 40 寬的長條、兩條折彎線（手冊 I6）');
    expect(b.sheet!.flanges[0]!.host).toBeGreaterThanOrEqual(0);
    stepOut(b.body!.shape, '折過基材加凸緣', '折過的基材（L 形，板寬 40）加第二段末端的 90° 凸緣', '一條 L 形的板（兩段，中間一個圓弧的折彎），第二段的末端又折出一片 90° 的凸緣；整條板寬都是 40，沒有破洞或多餘的面');

    const wall = [
      feat({ id: 'pw', type: 'refPlane', name: 'pw', suppressed: false, def: { mode: 'offset', plane: { kind: 'datum', name: 'plane:right' }, distance: '98' } }),
      sketch('sw', { kind: 'datum', name: 'pw' } as Ref, circle('cw', -20, 30, 3)) as Feature,
      extrude('xw', 'sw', 'cut', { type: 'blind', depth: '5', reverse: true }) as Feature,
    ];
    const hole = await putPart('鈑金/折彎後的孔.3dbx', doc([...plate(100, 60), flangeA, ...wall]), '折彎之後才切的孔：板 100×60 加 x = 100 邊的凸緣，再在凸緣的牆上（高度 20、y = 30）切一個 Ø6 的孔；平板型式上孔在 x = 117.320、y = 30（手冊 I6）');
    expect(hole.sheet!.cuts).toHaveLength(1);
    stepOut(hole.body!.shape, '折彎後的孔', '鈑金：凸緣的牆上折彎之後切的 Ø6 孔', '板 100×60 加一片 90° 凸緣（高 40），凸緣的牆上有一個 Ø6 的貫穿孔，圓心離牆的底部（折彎結束處）16.5 mm、y = 30');
  });
});

describe('G. the manifest', () => {
  it('writes the list of what to look at in a viewer, and a README listing every file', () => {
    review.push(
      { file: 'STEP替身/金樣夾具_平.step', title: '金樣夾具（平的組合件）', numbers: '3 個產品、15 個零組件（NEXT_ASSEMBLY_USAGE_OCCURRENCE 15 筆以上）', look: '零件樹 15 個零組件，名稱像「削邊銷<2>」；3 塊定位板排成一列，每塊上有 2 支銷與 2 塊疊起來的 V 型塊' },
      { file: 'STEP替身/金樣夾具_巢狀.step', title: '金樣夾具（巢狀組合件）', numbers: '次組合件「工位」用 3 次，每個 5 個零件，共 15 個零件', look: '零件樹有 3 個「工位<n>」，各展開 5 個零件；第 3 個工位轉了一個角度（約 28.6°）並墊高 35' },
      { file: 'STEP替身/自由曲面工件.step', title: '自由曲面工件（放樣）', numbers: '放樣三個圓 Ø50、Ø30、Ø44，高 60；側面是 B 樣條曲面', look: '外形是上下大、中間細的光滑曲面（不是圓柱或圓錐）；沒有縫或破面' },
      { file: 'STEP替身/圓角方塊.step', title: '圓角方塊', numbers: `60 × 40 × 30；體積 ${fixed(72000 - (1 - Math.PI / 4) * 25 * 40)} mm³`, look: '頂面 +x 側的一條邊有 R5 圓角，其餘邊是直角' },
    );
    const sections = review.map((r) => `### ${r.title}\n\n- 檔案：\`${r.file}\`\n- 數字：${r.numbers}\n- 要看：${r.look}\n`);
    put(
      join('輸出', '看圖清單.md'),
      [
        '# 在 eDrawings（或別的檢視器）要看什麼',
        '',
        'STEP 與 DXF 用 eDrawings 開（DXF 我沒確認這個版本能不能開，不行就用你的 CAD）；PDF 用 Chrome。`.3dbx`、`.3dba`、`.3dbd` 是 3D-Builder 自己的格式，eDrawings 讀不了。',
        '下面的數字是程式的核心算的，不是 SolidWorks 算的：eDrawings 的「測量」量到的尺寸應該與「外框約」相符（曲面件的外框是估計值，可能多 0.01 到 0.1 mm）。',
        '體積與表面積只在 eDrawings 有提供時才能對照；沒有就略過。',
        '請回報：每個檔案「看起來對／不對」，不對的話截圖並說明哪裡不對。',
        '',
        ...sections,
      ].join('\n'),
      '在檢視器要看什麼：每個檔案的數字與觀察重點',
    );
    const rows = manifest.map((m) => `| ${m.path.replaceAll('\\', '/')} | ${m.what} |`);
    put(
      'README.md',
      [
        '# 3D-Builder 實機驗證用的檔案',
        '',
        '由 `npm run make:kit` 產生（`tests/kit/make-kit.kit.ts`），內容與驗收測試用的金樣相同；**這些是程式自己做的替身，不是真實的 SolidWorks 檔案**，',
        '用來走流程，不能代替清單 J 章與 SolidWorks 的對照。可以隨便弄髒；弄壞了再執行一次 `npm run make:kit` 就會覆蓋回來。',
        '',
        '| 檔案 | 內容 |',
        '|---|---|',
        ...rows,
        '',
      ].join('\n'),
      '這份說明',
    );
    expect(manifest.length).toBe(rows.length + 1);
  });
});
