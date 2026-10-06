/**
 * Hardening H-5: drawings of parts made at random — a block with holes through it: the views (their sizes by hand), a section through the holes (its area by hand), the automatic
 * dimensions (the overall sizes and the holes in the text of them), the hole table, and the drawing written as SVG, DXF and PDF and read back with the checkers of the program; the drawing
 * file saved and read again is the same drawing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, applyDrawingCommand, axesOf, createEmptyDrawing, createEmptyPart, parseDrawing, sectionPlane, serializeDrawing, type Dimension, type DrawingView, type Feature, type PartDoc, type Pose, type Ref } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { elementFacts, projectDrawingView, Regenerator, viewFeatures } from '@3db/regen';
import { autoDimensions, buildScene, checkDxf, checkPdf, drawnEntities, readDxf, readPdf, readTrueType, toDxf, toPdf, toSvg, type DxfPolyline, type ElementsResult, type Scene, type ViewLines } from '@3db/drawing';
import { circle, extrude, fillet, front, rectangle, sketch } from '../phase1/builders';
import { areaOf } from '../support/sectionArea';
import { testFont } from '../support/testFont';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});
afterAll(() => kept.forEach((r) => r.dispose()));

const build = (features: Feature[]): PartDoc => features.reduce((d, feature, index) => applyCommand(d, { type: 'insertFeature', feature, index }), createEmptyPart());
const IDENTITY: Pose = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };

function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const between = (lo: number, hi: number) => lo + (hi - lo) * next();
  const round = (v: number, step = 0.5) => Math.round(v / step) * step;
  return { next, between, round, pick: <T,>(xs: T[]): T => xs[Math.floor(next() * xs.length)]! };
}

const sceneTexts = (s: Scene) => s.items.flatMap((i) => (i.kind === 'text' && i.text !== '' ? [i.text] : []));
const size = (box: { min: number[]; max: number[] }) => [box.max[0]! - box.min[0]!, box.max[1]! - box.min[1]!];

const SEEDS = Array.from({ length: 30 }, (_, i) => 8000 + i * 13);

describe('drawings of parts made at random', () => {
  it.each(SEEDS)('seed %i: the views, the section, the dimensions and the files are what they have to be', (seed) => {
    const r = rng(seed);
    const L = r.round(r.between(60, 160), 5);
    const W = r.round(r.between(40, 100), 5);
    const H = r.round(r.between(8, 30), 1);
    // holes in a row along y = 0, Ø3 to Ø10, kept apart and inside the block
    const holes: [number, number][] = [];
    for (let x = -L / 2 + 14; x < L / 2 - 14 && holes.length < 3; x += r.round(r.between(20, 40), 1)) {
      const d = r.pick([3, 4, 5, 6, 8, 10]);
      if (x + d / 2 > L / 2 - 6) break;
      if (holes.length > 0 && x - d / 2 < holes[holes.length - 1]![0] + holes[holes.length - 1]![1] / 2 + 4) continue;
      holes.push([r.round(x, 1), d]);
    }
    const features: Feature[] = [sketch('s1', front, rectangle('a', -L / 2, -W / 2, L, W)), extrude('e1', 's1', 'boss', { type: 'blind', depth: String(H) })];
    // the top edges rounded or chamfered, half the time: the section through the middle loses a corner at each end of the top
    const edgeKind = r.pick(['none', 'fillet', 'chamfer', 'none'] as const);
    const edgeSize = r.round(r.between(1, 4), 0.5);
    const topEdges: Ref[] = ['al0', 'al1', 'al2', 'al3'].map((n) => ({ kind: 'edge', name: `{${['e1:cap:end', `e1:side:s1.${n}`].sort().join('|')}}` }));
    if (edgeKind === 'fillet') features.push(fillet('f1', topEdges, String(edgeSize)));
    if (edgeKind === 'chamfer') features.push({ id: 'f1', type: 'chamfer', name: 'f1', suppressed: false, edges: topEdges, mode: 'angleDistance', distance: String(edgeSize), second: '45deg' } as Feature);
    // what that takes off one end of the section, and the most it can take off the volume (the four edges, counted whole)
    const cornerArea = edgeKind === 'fillet' ? (1 - Math.PI / 4) * edgeSize ** 2 : edgeKind === 'chamfer' ? edgeSize ** 2 / 2 : 0;
    if (holes.length > 0) features.push(sketch('s2', front, ...holes.map(([x, d], i) => circle(`k${i}`, x, 0, d / 2))), extrude('c1', 's2', 'cut', { type: 'throughAll', reverse: true }));
    const why = `drawing seed ${seed}: ${L} × ${W} × ${H}, holes ${holes.map(([x, d]) => `Ø${d} at ${x}`).join(', ') || 'none'}, ${edgeKind === 'none' ? 'sharp' : `${edgeKind} ${edgeSize}`}`;
    const regen = new Regenerator(kernel, solver, new Map());
    kept.push(regen);
    const res = regen.rebuild(build(features));
    expect(res.features.every((f) => f.status === 'ok'), why).toBe(true);
    const body = res.body!;
    const plain = L * W * H - holes.reduce((a, [, d]) => a + Math.PI * (d / 2) ** 2 * H, 0);
    const volume = kernel.massProps(body.shape).volume;
    if (edgeKind === 'none') expect(Math.abs(volume - plain) / (L * W * H), `${why}: volume`).toBeLessThan(1e-6);
    else {
      expect(volume, `${why}: volume less`).toBeLessThan(plain - 1e-6);
      expect(volume, `${why}: volume not less than the four edges whole`).toBeGreaterThanOrEqual(plain - 2 * (L + W) * cornerArea - 1e-6);
    }

    const PART = 'part.3dbx';
    const views: DrawingView[] = [
      { id: 'view1', name: '前視', source: PART, direction: 'front' },
      { id: 'view2', name: '上視', source: PART, direction: 'top' },
      { id: 'view3', name: '右視', source: PART, direction: 'right' },
      { id: 'view4', name: 'A-A', kind: 'section', parent: 'view1', line: [[-L / 2 - 2, 0], [L / 2 + 2, 0]], label: 'A' },
    ];
    let doc = applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views });
    doc = applyDrawingCommand(doc, { type: 'setTitle', field: 'drawingName', value: 'block' });
    doc = applyDrawingCommand(doc, { type: 'setSheet', sheet: { scale: r.pick([[1, 1], [1, 2], [1, 1]]) as [number, number] } });
    const lines = new Map<string, ViewLines>();
    const features2 = new Map<string, ReturnType<typeof viewFeatures>>();
    const parts = [{ shape: body.shape, pose: IDENTITY, mirrored: false }];
    for (const v of doc.views) {
      const axes = axesOf(doc.views, doc.sheet.projection, v)!;
      if (v.kind === 'section') {
        const parent = doc.views.find((x) => x.id === v.parent)!;
        lines.set(v.id, projectDrawingView(kernel, parts, axes, sectionPlane(axesOf(doc.views, doc.sheet.projection, parent)!, v)));
      } else {
        lines.set(v.id, projectDrawingView(kernel, parts, axes));
        features2.set(v.id, viewFeatures(body.topology, body.names, axes));
      }
    }
    // the views: the front shows the block's x and y, the top its x and z, the right its z and y
    const box = (id: string) => size(lines.get(id)!.box!);
    expect(box('view1'), `${why}: front`).toEqual([expect.closeTo(L, 5), expect.closeTo(W, 5)]);
    expect(box('view2'), `${why}: top`).toEqual([expect.closeTo(L, 5), expect.closeTo(H, 5)]);
    expect(box('view3'), `${why}: right`).toEqual([expect.closeTo(H, 5), expect.closeTo(W, 5)]);
    // the section through the holes (an arc is drawn in short chords, so a rounded edge is allowed a little more): the block's L × H less each hole's diameter across the thickness
    const cut = lines.get('view4')!.cut!;
    expect(Math.abs(areaOf(cut) - (L * H - holes.reduce((a, [, d]) => a + d * H, 0) - 2 * cornerArea)) / (L * H), `${why}: section`).toBeLessThan(edgeKind === 'fillet' ? 1e-4 : 1e-5);

    const drafts = autoDimensions(features2.get('view1')!, { overall: true, holes: true, positions: true, callouts: true });
    expect(drafts.length, `${why}: dimensions made`).toBeGreaterThanOrEqual(2 + holes.length);
    const dimensions = drafts.map((d, i) => ({ ...d, id: `dim${i + 1}`, view: 'view1' }) as Dimension);
    doc = applyDrawingCommand(doc, { type: 'insertDimensions', dimensions });
    doc = applyDrawingCommand(doc, { type: 'insertTables', tables: [{ id: 'tbl1', kind: 'holes', view: 'view1' }] });
    const elements = new Map<string, ElementsResult>(
      doc.dimensions.map((d) => {
        const refs: Ref[] = d.kind === 'linear' || d.kind === 'angle' ? [d.a, d.b] : [d.ref];
        return [d.id, { elements: refs.map((x) => elementFacts(body.topology, body.names, x)) as never }];
      }),
    );
    const built = buildScene(doc, lines, elements, features2);
    // every dimension is drawn, and the overall ones say the sizes of the block
    const outcomes = [...built.dimensions.values()];
    expect(outcomes.filter((o) => 'error' in o).map((o) => ('error' in o ? o.error : '')), `${why}: dimensions`).toEqual([]);
    const texts = outcomes.map((o) => ('text' in o ? o.text : ''));
    const numbers = texts.filter((t) => /^[0-9.]+$/.test(t)).map(Number);
    expect(numbers, `${why}: overall`).toEqual(expect.arrayContaining([L, W]));
    for (const [, d] of holes) expect(texts.some((t) => t.includes(`Ø${d}`)), `${why}: callout of Ø${d}`).toBe(true);
    expect(built.tables.get('tbl1')?.length ?? 0, `${why}: hole table`).toBe(holes.length);

    // the files: SVG, DXF and PDF, read back
    const svg = toSvg(built.scene);
    expect(svg.startsWith('<?xml') || svg.startsWith('<svg'), why).toBe(true);
    expect(svg.trimEnd().endsWith('</svg>'), why).toBe(true);
    const dxf = readDxf(toDxf(built.scene));
    expect(checkDxf(dxf), `${why}: DXF`).toEqual([]);
    const drawn = built.scene.items.filter((i) => i.kind === 'polyline' && !i.filled && i.points.length >= 4).length;
    expect(drawn, `${why}: lines drawn`).toBeGreaterThan(10);
    expect(drawnEntities(dxf).filter((e): e is DxfPolyline => e.type === 'LWPOLYLINE').length, `${why}: DXF lines`).toBe(drawn);
    const font = readTrueType(testFont([...new Set(sceneTexts(built.scene).join(''))].join('')).bytes);
    const pdf = readPdf(toPdf(built.scene, { font }).bytes);
    expect(checkPdf(pdf), `${why}: PDF`).toEqual([]);
    expect(pdf.pages).toHaveLength(1);

    // the drawing saved and read again
    // -0 is written as 0, so the two are compared as they are written
    const saved = serializeDrawing(doc);
    expect(serializeDrawing(parseDrawing(saved)), `${why}: saved`).toBe(saved);
    expect(parseDrawing(saved).dimensions.map((d) => d.id), why).toEqual(doc.dimensions.map((d) => d.id));
  }, 120000);
});
