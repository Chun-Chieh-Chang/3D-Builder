/**
 * 5-3 (docs/phase5-plan.md): dimensions (C16.4). The limits and fits of ISO 286, the text a dimension is written as, what the commands refuse, and the golden
 * locating plate dimensioned in its top view: every number worked out by hand, and the dimensions following the model when its sizes change.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyCommand,
  applyDrawingCommand,
  createEmptyDrawing,
  DRAWING_SCHEMA_VERSION,
  fitDeviations,
  parseDrawing,
  parseFit,
  serializeDrawing,
  standardTolerance,
  viewVectors,
  rightOf, sheetUp, DIM_STYLE_DEFAULT,
  type Dimension,
  type DrawingDoc,
  type ElementFacts,
  type PartDoc,
  type Ref,
  type ViewAxes,
  type ViewFeature,
  dimensionRefs, page } from '@3db/model';
import { olderDrawingFile } from '../support/drawingVersion';
import { readPartFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, elementFacts, viewFeatures } from '@3db/regen';
import { autoDimensions, buildScene, dimensionText, evaluateDimension, formatNumber, toleranceText, toSvg, type DimensionDraft, type ElementsResult, type PlacedView, type ViewLines } from '@3db/drawing';

const dev = (nominal: number, fit: string) => {
  const d = fitDeviations(nominal, fit);
  return d && [Math.round(d.upper * 1e4) / 1e4, Math.round(d.lower * 1e4) / 1e4];
};

describe('limits and fits (ISO 286-1)', () => {
  it('the fundamental tolerances: IT7 of Ø6 is 12 µm, of Ø10 15 µm, of Ø20 21 µm; IT11 of Ø9 is 90 µm', () => {
    expect(standardTolerance(6, 7)).toBeCloseTo(0.012, 9);
    expect(standardTolerance(10, 7)).toBeCloseTo(0.015, 9);
    expect(standardTolerance(20, 7)).toBeCloseTo(0.021, 9);
    expect(standardTolerance(9, 11)).toBeCloseTo(0.09, 9);
    expect(standardTolerance(500, 6)).toBeCloseTo(0.04, 9);
  });

  it('holes: H7 starts at 0 (Ø6 H7 is +0.012/0), H11, G, F, JS', () => {
    expect(dev(6, 'H7')).toEqual([0.012, 0]);
    expect(dev(10, 'H7')).toEqual([0.015, 0]);
    expect(dev(9, 'H11')).toEqual([0.09, 0]);
    expect(dev(35, 'G6')).toEqual([0.025, 0.009]);
    expect(dev(30, 'G6')).toEqual([0.02, 0.007]); // 30 is the top of the 18–30 range
    expect(dev(20, 'F8')).toEqual([0.053, 0.020]);
    expect(dev(50, 'JS7')).toEqual([0.0125, -0.0125]);
  });

  it('shafts: h ends at 0, m6 (the dowel pin) of Ø6 is +0.012/+0.004, g6, f7, k6, p6', () => {
    expect(dev(8, 'h6')).toEqual([0, -0.009]);
    expect(dev(6, 'm6')).toEqual([0.012, 0.004]);
    expect(dev(6, 'g6')).toEqual([-0.004, -0.012]);
    expect(dev(20, 'f7')).toEqual([-0.02, -0.041]);
    expect(dev(20, 'k6')).toEqual([0.015, 0.002]);
    expect(dev(20, 'p6')).toEqual([0.035, 0.022]);
  });

  it('K, M, N and P of a hole take the mirrored shaft deviation and the step from the grade below (Δ): K7 of Ø6 is +0.003/−0.009, P7 −0.008/−0.020, N7 of Ø20 −0.007/−0.028', () => {
    expect(dev(6, 'K7')).toEqual([0.003, -0.009]);
    expect(dev(6, 'P7')).toEqual([-0.008, -0.02]);
    expect(dev(20, 'N7')).toEqual([-0.007, -0.028]);
    expect(dev(8, 'K8')).toEqual([0.006, -0.016]);
    expect(dev(8, 'M9')).toEqual([-0.006, -0.042]);
  });

  it('a size is in the range it is up to and including: 3 is in 1–3, 3.5 in 3–6, 6 in 3–6, 6.01 in 6–10', () => {
    expect(dev(3, 'H7')).toEqual([0.01, 0]);
    expect(dev(3.5, 'H7')).toEqual([0.012, 0]);
    expect(dev(6, 'H7')).toEqual([0.012, 0]);
    expect(dev(6.01, 'H7')).toEqual([0.015, 0]);
  });

  it('what is not covered is said so: other letters and grades, sizes over 500 or not over 0', () => {
    expect(parseFit('H7')).toEqual({ letter: 'H', grade: 7, hole: true });
    expect(parseFit('m6')).toEqual({ letter: 'm', grade: 6, hole: false });
    for (const bad of ['J7', 'H13', 'H4', 'x', 'h', '7', 'H 7 ', 'zc6']) expect(parseFit(bad), bad).toBeNull();
    expect(dev(600, 'H7')).toBeNull();
    expect(dev(0, 'H7')).toBeNull();
    expect(dev(10, 'J7')).toBeNull();
  });
});

describe('what a dimension is written as (ISO 129-1)', () => {
  it('numbers: no zeros that are not needed, up to three decimals', () => {
    expect([120, 7.5, 9.0000001, 45.25, 0, -0.0001, 0.1 + 0.2].map((v) => formatNumber(v))).toEqual(['120', '7.5', '9', '45.25', '0', '0', '0.3']);
  });

  it('the tolerances: ±0.05, +0.10/-0.05 (both deviations of the same decimals), +0.1/-0 (a zero signed by its place), and a class with its limits', () => {
    expect(toleranceText({ type: 'bilateral', upper: 0.05, lower: -0.05 }, 20)).toBe('±0.05');
    expect(toleranceText({ type: 'bilateral', upper: 0.1, lower: -0.05 }, 20)).toBe('+0.10/-0.05');
    expect(toleranceText({ type: 'bilateral', upper: 0.1, lower: 0 }, 20)).toBe('+0.1/-0');
    expect(toleranceText({ type: 'fit', fit: 'H7' }, 6)).toBe('H7 (+0.012/0)');
    expect(toleranceText({ type: 'fit', fit: 'm6' }, 6)).toBe('m6 (+0.012/+0.004)');
    expect(toleranceText({ type: 'fit', fit: 'JS7' }, 50)).toBe('JS7 (+0.0125/-0.0125)');
    expect(toleranceText({ type: 'fit', fit: 'H7' }, 900)).toBe('H7'); // not in the table: the class alone
  });

  it('a one-sided limit is a word, not a deviation: 「10 最大」 bounds the part above only', () => {
    expect(toleranceText({ type: 'max' }, 10)).toBe('最大');
    expect(toleranceText({ type: 'min' }, 10)).toBe('最小');
    // it is a word, so the unit of the sheet does not change it
    expect(toleranceText({ type: 'max' }, 10, 'in')).toBe('最大');
    const dia: Dimension = { id: 'd', view: 'v', kind: 'diameter', ref: { kind: 'face', name: 'x' }, angle: 45, tolerance: { type: 'max' } };
    expect(dimensionText(dia, 10)).toBe('Ø10 最大');
    expect(dimensionText({ ...dia, reference: true, tolerance: { type: 'min' } }, 10)).toBe('(Ø10 最小)');
  });

  const ref: Ref = { kind: 'face', name: 'x' };
  it('Ø and R, the count, the tolerance, parentheses for a reference dimension', () => {
    const dia: Dimension = { id: 'd', view: 'v', kind: 'diameter', ref, angle: 45 };
    expect(dimensionText(dia, 9)).toBe('Ø9');
    expect(dimensionText({ ...dia, count: 4, tolerance: { type: 'fit', fit: 'H11' } }, 9)).toBe('4×Ø9 H11 (+0.09/0)');
    expect(dimensionText({ ...dia, kind: 'radius', count: 4 }, 10)).toBe('4×R10');
    expect(dimensionText({ ...dia, tolerance: { type: 'fit', fit: 'H7' } }, 6)).toBe('Ø6 H7 (+0.012/0)');
    const lin: Dimension = { id: 'd', view: 'v', kind: 'linear', a: ref, b: ref, orientation: 'horizontal', offset: 10, reference: true };
    expect(dimensionText(lin, 120)).toBe('(120)');
  });
});

describe('the dimensions in the document', () => {
  const ref = (name: string): Ref => ({ kind: 'face', name });
  const base = (): DrawingDoc => applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views: [{ id: 'view1', name: 'f', source: 'a.3dbx', direction: 'top' }, { id: 'view2', name: 'g', source: 'a.3dbx', direction: 'front' }] });
  const lin = (id: string, view = 'view1', extra: Partial<Dimension> = {}): Dimension => ({ id, view, kind: 'linear', a: ref('a'), b: ref('b'), orientation: 'horizontal', offset: -10, ...extra }) as Dimension;
  const round = (id: string, kind: 'diameter' | 'radius' = 'diameter', extra: Partial<Dimension> = {}): Dimension => ({ id, view: 'view1', kind, ref: ref('c'), angle: 45, ...extra }) as Dimension;

  it('inserts them with ids that are kept apart from the views\'', () => {
    const d = applyDrawingCommand(base(), { type: 'insertDimensions', dimensions: [lin('dim1'), round('dim2')] });
    expect(page(d).dimensions.map((x) => x.id)).toEqual(['dim1', 'dim2']);
    expect(d.idCounters).toMatchObject({ dim: 2, view: 2 });
    expect(() => applyDrawingCommand(d, { type: 'insertDimensions', dimensions: [lin('dim1')] })).toThrow(/已被使用/);
    expect(() => applyDrawingCommand(d, { type: 'insertDimensions', dimensions: [lin('view1')] })).toThrow(/已被使用/);
  });

  it('refuses what cannot be a dimension: a view that is not there, a vertex for a circle, no offset, a bad angle or count, limits the wrong way round, a class not known', () => {
    const d = base();
    const insert = (x: Dimension) => applyDrawingCommand(d, { type: 'insertDimensions', dimensions: [x] });
    expect(() => insert(lin('dim1', 'zzz'))).toThrow(/找不到尺寸所在的視圖/);
    expect(() => insert(round('dim1', 'diameter', { ref: { kind: 'vertex', name: 'v' } }))).toThrow(/面、邊或頂點/);
    expect(() => insert(lin('dim1', 'view1', { offset: 0 }))).toThrow(/不能是 0/);
    expect(() => insert(lin('dim1', 'view1', { orientation: 'diagonal' as never }))).toThrow(/尺寸方向/);
    expect(() => insert(round('dim1', 'diameter', { angle: NaN }))).toThrow(/角度/);
    expect(() => insert(round('dim1', 'diameter', { count: 1 }))).toThrow(/個數/);
    expect(() => insert(lin('dim1', 'view1', { tolerance: { type: 'bilateral', upper: -0.1, lower: 0.1 } }))).toThrow(/上下限/);
    expect(() => insert(lin('dim1', 'view1', { tolerance: { type: 'fit', fit: 'X9' } }))).toThrow(/不支援的配合等級/);
    expect(page(insert(lin('dim1', 'view1', { tolerance: { type: 'fit', fit: 'H7' } }))).dimensions).toHaveLength(1);
    expect(page(insert(lin('dim1', 'view1', { tolerance: { type: 'max' } }))).dimensions).toHaveLength(1);
    expect(page(insert(lin('dim1', 'view1', { tolerance: { type: 'min' } }))).dimensions).toHaveLength(1);
  });

  it('changes a dimension: the tolerance in and out, a reference dimension, the count, the offset; what is not its kind\'s is refused', () => {
    let d = applyDrawingCommand(base(), { type: 'insertDimensions', dimensions: [lin('dim1'), round('dim2')] });
    d = applyDrawingCommand(d, { type: 'setDimension', dimensionId: 'dim1', patch: { reference: true, offset: -17, tolerance: { type: 'bilateral', upper: 0.1, lower: -0.1 } } });
    expect(page(d).dimensions[0]).toMatchObject({ reference: true, offset: -17, tolerance: { type: 'bilateral', upper: 0.1, lower: -0.1 } });
    d = applyDrawingCommand(d, { type: 'setDimension', dimensionId: 'dim1', patch: { reference: false, tolerance: null } });
    expect(page(d).dimensions[0]).not.toHaveProperty('reference');
    expect(page(d).dimensions[0]).not.toHaveProperty('tolerance');
    d = applyDrawingCommand(d, { type: 'setDimension', dimensionId: 'dim2', patch: { count: 4, angle: 120 } });
    expect(page(d).dimensions[1]).toMatchObject({ count: 4, angle: 120 });
    d = applyDrawingCommand(d, { type: 'setDimension', dimensionId: 'dim2', patch: { count: null } });
    expect(page(d).dimensions[1]).not.toHaveProperty('count');
    d = applyDrawingCommand(d, { type: 'setDimension', dimensionId: 'dim2', patch: { tolerance: { type: 'max' } } });
    expect(page(d).dimensions[1]).toMatchObject({ tolerance: { type: 'max' } });
    d = applyDrawingCommand(d, { type: 'setDimension', dimensionId: 'dim2', patch: { tolerance: null } });
    expect(page(d).dimensions[1]).not.toHaveProperty('tolerance');
    expect(() => applyDrawingCommand(d, { type: 'setDimension', dimensionId: 'dim1', patch: { angle: 10 } })).toThrow(/不屬於/);
    expect(() => applyDrawingCommand(d, { type: 'setDimension', dimensionId: 'dim1', patch: { count: 4 } })).toThrow(/不屬於/);
    expect(() => applyDrawingCommand(d, { type: 'setDimension', dimensionId: 'dim2', patch: { offset: 4 } })).toThrow(/不屬於/);
    expect(() => applyDrawingCommand(d, { type: 'setDimension', dimensionId: 'zzz', patch: { offset: 4 } })).toThrow(/找不到尺寸/);
  });

  it('deleting a view deletes its dimensions, and the ids are not given out again', () => {
    let d = applyDrawingCommand(base(), { type: 'insertDimensions', dimensions: [lin('dim1'), lin('dim2', 'view2'), round('dim3')] });
    d = applyDrawingCommand(d, { type: 'deleteViews', viewIds: ['view1'] });
    expect(page(d).dimensions.map((x) => x.id)).toEqual(['dim2']);
    expect(d.idCounters.dim).toBe(3);
    d = applyDrawingCommand(d, { type: 'deleteDimensions', dimensionIds: ['dim2'] });
    expect(page(d).dimensions).toEqual([]);
    expect(() => applyDrawingCommand(d, { type: 'deleteDimensions', dimensionIds: ['dim2'] })).toThrow(/找不到尺寸/);
  });

  it('is saved and read back the same, and a version-2 drawing (no dimensions) is read as version 3 with none', () => {
    const d = applyDrawingCommand(base(), { type: 'insertDimensions', dimensions: [lin('dim1', 'view1', { tolerance: { type: 'fit', fit: 'H7' } }), round('dim2', 'radius', { count: 4 })] });
    expect(parseDrawing(serializeDrawing(d))).toEqual(d);
    const back = parseDrawing(JSON.stringify(olderDrawingFile(base(), 2)));
    expect(back.schemaVersion).toBe(DRAWING_SCHEMA_VERSION);
    expect(page(back).dimensions).toEqual([]);
  });
});

describe('the locating plate dimensioned in its top view', () => {
  let kernel: Kernel;
  let solver: PlaneGcsSolver;
  let regen: Regenerator;
  let doc: PartDoc;
  beforeAll(async () => {
    kernel = await Kernel.load();
    solver = await PlaneGcsSolver.create();
    regen = new Regenerator(kernel, solver);
    doc = (await readPartFile(new Uint8Array(readFileSync(new URL('../golden/locating-plate.3dbx', import.meta.url))))).doc;
  });
  afterAll(() => regen.dispose());

  const top = viewVectors('top');
  const built = (d: PartDoc) => regen.rebuild(d).body!;
  /** Where the top view is placed in the tests: 120 × 80 at (200, 150) on the sheet, 1:1, its middle at the plate's. */
  const placed: PlacedView = { id: 'view1', at: [200, 150], scale: 1, w: 120, h: 80, centre: [0, 0] };
  const all = { overall: true, holes: true, positions: true };

  /** What every draft comes to in the model `body`, in order: the value and text, or the error. */
  function evaluate(body: ReturnType<typeof built>, drafts: DimensionDraft[]) {
    return drafts.map((draft, i) => {
      const d = { ...draft, id: `dim${i + 1}`, view: 'view1' } as Dimension;
      const refs = dimensionRefs(d);
      const facts = refs.map((r) => elementFacts(body.topology, body.names, r));
      const bad = facts.find((f) => 'error' in f) as { error: string } | undefined;
      const resolved: ElementsResult = bad ? { error: bad.error } : { elements: facts as never };
      return { dimension: d, outcome: evaluateDimension(d, resolved, top, placed, 'mm', DIM_STYLE_DEFAULT, kernel.projectView(body.shape, top) as ViewLines) };
    });
  }

  it('the top view sees the planes at the ends of x and y edge-on and the cylinders along its direction as circles', () => {
    const body = built(doc);
    const f = viewFeatures(body.topology, body.names, top);
    const planes = f.filter((x) => x.type === 'plane');
    const circles = f.filter((x) => x.type === 'circle');
    // the flat sides: x = ±60; and y = ∓40 in the sheet's y (up is the model's −z)
    expect(planes.filter((p) => p.type === 'plane' && p.axis === 'x').map((p) => p.type === 'plane' && p.coord).sort((a, b) => Number(a) - Number(b))).toEqual([expect.closeTo(-60, 6), expect.closeTo(60, 6)]);
    expect(planes.filter((p) => p.type === 'plane' && p.axis === 'y').map((p) => p.type === 'plane' && p.coord).sort((a, b) => Number(a) - Number(b))).toEqual([expect.closeTo(-40, 6), expect.closeTo(40, 6)]);
    // six whole holes (concave) and four arcs (the R10 corners, convex)
    const whole = circles.filter((c) => c.type === 'circle' && c.full);
    const arcs = circles.filter((c) => c.type === 'circle' && !c.full);
    expect(whole.map((c) => c.type === 'circle' && [c.radius, c.convex]).sort()).toEqual([[4, false], [4, false], [4.5, false], [4.5, false], [4.5, false], [4.5, false]]);
    expect(arcs).toHaveLength(4);
    expect(arcs.every((c) => c.type === 'circle' && Math.abs(c.radius - 10) < 1e-9 && c.convex)).toBe(true);
    // the centres of the Ø9 holes
    const centres = whole.flatMap((c) => (c.type === 'circle' && Math.abs(c.radius - 4.5) < 1e-9 ? [c.centre.map((v) => Math.round(v * 1e6) / 1e6).join(',')] : [])).sort();
    expect(centres).toEqual(['-50,-30', '-50,30', '50,-30', '50,30']);
  });

  it('the front view sees the planes square to x and y and no circles (the holes run along y): nothing to dimension a hole by', () => {
    const body = built(doc);
    const f = viewFeatures(body.topology, body.names, viewVectors('front'));
    expect(f.filter((x) => x.type === 'circle')).toEqual([]);
    expect(f.some((x) => x.type === 'plane' && x.axis === 'y' && Math.abs(x.coord - 15) < 1e-6)).toBe(true);
  });

  it('all the dimensions of the view: the overall size, each size of hole and arc (equal ones with their count), where each hole is from the left and the bottom', () => {
    const body = built(doc);
    const drafts = autoDimensions(viewFeatures(body.topology, body.names, top), all);
    const done = evaluate(body, drafts);
    const texts = (kind: string, pick?: (d: Dimension) => boolean) => done.filter((x) => x.dimension.kind === kind && (!pick || pick(x.dimension))).map((x) => ('error' in x.outcome ? x.outcome.error : x.outcome.text));
    expect(done.every((x) => !('error' in x.outcome))).toBe(true);
    expect(texts('diameter').sort()).toEqual(['2×Ø8', '4×Ø9']);
    expect(texts('radius')).toEqual(['4×R10']);
    const linear = (o: string) => done.filter((x) => x.dimension.kind === 'linear' && x.dimension.orientation === o);
    // from the left side (x = −60): holes at x = −50, −40, 40, 50 are 10, 20, 100, 110 away, then 120 overall
    expect(linear('horizontal').map((x) => ('error' in x.outcome ? NaN : x.outcome.value))).toEqual([expect.closeTo(10, 6), expect.closeTo(20, 6), expect.closeTo(100, 6), expect.closeTo(110, 6), expect.closeTo(120, 6)]);
    // from the bottom (the sheet's y = −40): holes at y = −30, 0, 30 are 10, 40, 70 away, then 80 overall
    expect(linear('vertical').map((x) => ('error' in x.outcome ? NaN : x.outcome.value))).toEqual([expect.closeTo(10, 6), expect.closeTo(40, 6), expect.closeTo(70, 6), expect.closeTo(80, 6)]);
    // stacked outward: horizontal below (negative), the overall one outermost; vertical to the right
    expect(linear('horizontal').map((x) => (x.dimension.kind === 'linear' ? x.dimension.offset : 0))).toEqual([-10, -17, -24, -31, -38]);
    expect(linear('vertical').map((x) => (x.dimension.kind === 'linear' ? x.dimension.offset : 0))).toEqual([10, 17, 24, 31]);
  });

  it('asked for separately: only the overall size, or only the holes', () => {
    const body = built(doc);
    const f = viewFeatures(body.topology, body.names, top);
    expect(autoDimensions(f, { overall: true, holes: false, positions: false })).toHaveLength(2);
    expect(autoDimensions(f, { overall: false, holes: true, positions: false })).toHaveLength(3);
    expect(autoDimensions(f, { overall: false, holes: false, positions: true })).toHaveLength(7);
    expect(autoDimensions([], all)).toEqual([]);
  });

  it('where it is drawn: the dimension line of the overall width is 38 below the view, the arrows at the ends, the text 120 over the middle', () => {
    const body = built(doc);
    const drafts = autoDimensions(viewFeatures(body.topology, body.names, top), all);
    const done = evaluate(body, drafts);
    const overall = done.find((x) => x.dimension.kind === 'linear' && x.dimension.orientation === 'horizontal' && 'text' in x.outcome && x.outcome.text === '120')!;
    const items = (overall.outcome as { items: ReturnType<typeof Array.prototype.concat> }).items as { kind: string; points?: number[]; style?: string; closed?: boolean; filled?: boolean; at?: number[]; text?: string; anchor?: string; height?: number }[];
    const yLine = 150 - 40 - 38; // the bottom of the view is at 110
    const dimLine = items.find((i) => i.kind === 'polyline' && !i.closed && i.points!.length === 4 && i.points![1] === yLine && i.points![3] === yLine)!;
    expect(dimLine.points).toEqual([expect.closeTo(140, 6), yLine, expect.closeTo(260, 6), yLine]);
    expect(dimLine.style).toBe('dimension');
    const arrows = items.filter((i) => i.kind === 'polyline' && i.closed && i.filled);
    expect(arrows).toHaveLength(2);
    // the tips are at the ends of the dimension line
    expect(arrows.map((a) => [a.points![0], a.points![1]])).toEqual([[expect.closeTo(140, 6), yLine], [expect.closeTo(260, 6), yLine]]);
    // The R10 corners end each straight side above the overall view bottom.
    // Use actual native vertices for the witness origin; the paper gap stays 1 mm.
    const dot = (p: readonly number[], v: readonly number[]) => p.reduce((n, x, i) => n + x * v[i]!, 0);
    const lowerEnd = (x: number) => Math.min(...body.topology.vertices.filter(v => Math.abs(dot(v.point, rightOf(top)) - x) < 1e-6).map(v => dot(v.point, sheetUp(top))));
    const ext = items.filter((i) => i.kind === 'polyline' && !i.closed && i.points!.length === 4 && i.points![0] === i.points![2]);
    expect(ext.map((e) => e.points)).toEqual([[expect.closeTo(140, 6), expect.closeTo(150 + lowerEnd(-60) - 1, 6), expect.closeTo(140, 6), yLine - 2], [expect.closeTo(260, 6), expect.closeTo(150 + lowerEnd(60) - 1, 6), expect.closeTo(260, 6), yLine - 2]]);
    const text = items.find((i) => i.kind === 'text')!;
    expect(text).toMatchObject({ text: '120', height: 3.5, anchor: 'center' });
    expect(text.at).toEqual([expect.closeTo(200, 6), yLine + 1]);
  });

  it('a vertical one is to the right, its text turned to read from the right', () => {
    const body = built(doc);
    const done = evaluate(body, autoDimensions(viewFeatures(body.topology, body.names, top), all));
    const overall = done.find((x) => x.dimension.kind === 'linear' && x.dimension.orientation === 'vertical' && 'text' in x.outcome && x.outcome.text === '80')!;
    const items = (overall.outcome as { items: { kind: string; points?: number[]; angle?: number; at?: number[]; closed?: boolean }[] }).items;
    const xLine = 200 + 60 + 31;
    expect(items.some((i) => i.kind === 'polyline' && !i.closed && i.points![0] === xLine && i.points![2] === xLine)).toBe(true);
    const text = items.find((i) => i.kind === 'text')!;
    expect(text.angle).toBe(90);
    expect(text.at![0]).toBeCloseTo(xLine - 1, 6);
  });

  it('a diameter: the leader from the hole outward at its angle, the arrow touching the circle, the text on a shelf', () => {
    const body = built(doc);
    const done = evaluate(body, autoDimensions(viewFeatures(body.topology, body.names, top), { overall: false, holes: true, positions: false }));
    const nine = done.find((x) => 'text' in x.outcome && x.outcome.text === '4×Ø9')!;
    const items = (nine.outcome as { items: { kind: string; points?: number[]; closed?: boolean; at?: number[]; text?: string; anchor?: string }[] }).items;
    // the hole drawn is the first Ø9 found; its centre on the sheet is (200 + x, 150 + y); the angle is 45°: the leader goes up and right
    const arrow = items.filter((i) => i.kind === 'polyline' && i.closed);
    expect(arrow).toHaveLength(2); // Ø9 has room for an arrow at each side
    const tips = arrow.map((a) => [a.points![0]!, a.points![1]!]);
    const centre = [(tips[0]![0]! + tips[1]![0]!) / 2, (tips[0]![1]! + tips[1]![1]!) / 2];
    expect(Math.hypot(tips[0]![0]! - tips[1]![0]!, tips[0]![1]! - tips[1]![1]!)).toBeCloseTo(9, 6); // the two tips are on the circle, across it
    expect([Math.abs(centre[0]! - 200) % 1 < 1e-6 || true, Math.abs(Math.abs(centre[0]! - 200) - 50) < 1e-6, Math.abs(Math.abs(centre[1]! - 150) - 30) < 1e-6]).toEqual([true, true, true]);
    const text = items.find((i) => i.kind === 'text')!;
    expect(text).toMatchObject({ text: '4×Ø9', anchor: 'left' });
    // the shelf starts 8 mm outside the circle at 45°: (r + 8) · cos 45° from the centre
    expect(text.at![0]).toBeCloseTo(centre[0]! + (4.5 + 8) * Math.SQRT1_2 + 1, 6);
    expect(text.at![1]).toBeCloseTo(centre[1]! + (4.5 + 8) * Math.SQRT1_2 + 1, 6);
  });

  it('a tolerance on the dimension is part of its text', () => {
    const body = built(doc);
    const drafts = autoDimensions(viewFeatures(body.topology, body.names, top), { overall: false, holes: true, positions: false });
    const eight = drafts.find((d) => d.kind === 'diameter' && d.count === 2)!;
    const withFit = { ...eight, tolerance: { type: 'fit' as const, fit: 'H7' } };
    expect(evaluate(body, [withFit]).map((x) => ('text' in x.outcome ? x.outcome.text : x.outcome.error))).toEqual(['2×Ø8 H7 (+0.015/0)']);
    expect(evaluate(body, [{ ...eight, reference: true }]).map((x) => ('text' in x.outcome ? x.outcome.text : x.outcome.error))).toEqual(['(2×Ø8)']);
  });

  it('a dimension that cannot be made says why: an element that is gone, a plane square to the wrong direction, a circle not seen as one', () => {
    const body = built(doc);
    const f = viewFeatures(body.topology, body.names, top);
    const planeX = f.find((x) => x.type === 'plane' && x.axis === 'x')!;
    const planeY = f.find((x) => x.type === 'plane' && x.axis === 'y')!;
    const circle = f.find((x) => x.type === 'circle' && x.full)!;
    const gone: Ref = { kind: 'face', name: 'does-not-exist:face' };
    const lin = (a: Ref, b: Ref, orientation: 'horizontal' | 'vertical'): DimensionDraft => ({ kind: 'linear', a, b, orientation, offset: -10 });
    const [missing, across, fine] = evaluate(body, [lin(gone, planeX.ref, 'horizontal'), lin(planeX.ref, planeY.ref, 'horizontal'), lin(planeX.ref, circle.ref, 'horizontal')]);
    expect(missing!.outcome).toMatchObject({ error: expect.stringContaining('找不到尺寸指的元素') });
    expect(across!.outcome).toMatchObject({ error: expect.stringContaining('不與量測的方向垂直') });
    expect(fine!.outcome).toHaveProperty('value');
    // seen from the front, the holes are not circles: a diameter there cannot be drawn
    const front = viewVectors('front');
    const hole = { kind: 'diameter' as const, ref: (circle as { ref: Ref }).ref, angle: 45 };
    const facts = elementFacts(body.topology, body.names, hole.ref);
    expect(evaluateDimension({ ...hole, id: 'd', view: 'view1' }, { elements: [facts as never] }, front, placed)).toMatchObject({ error: expect.stringContaining('看不到圓的真形') });
    // a dimension that has not been resolved yet waits
    expect(evaluateDimension({ ...hole, id: 'd', view: 'view1' }, undefined, top, placed)).toMatchObject({ error: expect.stringContaining('正在讀取') });
  });

  it('the dimensions follow the model: the plate made 150 × 100 with its holes 60 out has the same dimensions at 150, 100 and the new distances', () => {
    const drafts = autoDimensions(viewFeatures(built(doc).topology, built(doc).names, top), all);
    const edit = (d: PartDoc, sketch: string, value: string, to: string, type: 'distance' | 'distanceX') => {
      const s = d.features.find((f) => f.name === sketch);
      if (s?.type !== 'sketch') throw new Error('no sketch');
      return s.constraints.filter((c) => c.type === type && 'value' in c && c.value === value).reduce((acc, c) => applyCommand(acc, { type: 'setDimension', featureId: s.id, constraintId: c.id, value: to }), d);
    };
    let bigger = edit(doc, '草圖1', '120', '150', 'distance');
    bigger = edit(bigger, '草圖1', '80', '100', 'distance');
    bigger = edit(bigger, '草圖2', '50', '60', 'distanceX');
    const done = evaluate(built(bigger), drafts);
    expect(done.every((x) => !('error' in x.outcome))).toBe(true);
    const values = (o: string) => done.filter((x) => x.dimension.kind === 'linear' && x.dimension.orientation === o).map((x) => ('value' in x.outcome ? x.outcome.value : NaN));
    // from x = −75: the Ø9 holes at ±60 are 15 and 135 away, the Ø8 at ±40 are 35 and 115 away, 150 overall — the order the drafts had, by the old distances (10, 20, 100, 110)
    expect(values('horizontal')).toEqual([expect.closeTo(15, 6), expect.closeTo(35, 6), expect.closeTo(115, 6), expect.closeTo(135, 6), expect.closeTo(150, 6)]);
    // from y = −50: the holes at ±30 are 20 and 80 away, the middle one 50, 100 overall (the order of the old distances: 10, 40, 70)
    expect(values('vertical')).toEqual([expect.closeTo(20, 6), expect.closeTo(50, 6), expect.closeTo(80, 6), expect.closeTo(100, 6)]);
    expect(done.filter((x) => x.dimension.kind !== 'linear').map((x) => ('text' in x.outcome ? x.outcome.text : '')).sort()).toEqual(['2×Ø8', '4×R10', '4×Ø9']);
  });

  it('is drawn on the sheet with the view: dimension lines in the scene and the SVG, and the answer of each dimension', () => {
    const body = built(doc);
    const drafts = autoDimensions(viewFeatures(body.topology, body.names, top), all);
    let d: DrawingDoc = applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views: [{ id: 'view1', name: '上視', source: 'a.3dbx', direction: 'top' }] });
    d = applyDrawingCommand(d, { type: 'insertDimensions', dimensions: drafts.map((x, i) => ({ ...x, id: `dim${i + 1}`, view: 'view1' }) as Dimension) });
    const lines: ViewLines = { visible: [[-60, -40, 60, -40, 60, 40, -60, 40, -60, -40]], hidden: [], box: { min: [-60, -40], max: [60, 40] } };
    const elements = new Map<string, ElementsResult>(
      page(d).dimensions.map((x) => {
        const refs = dimensionRefs(x);
        return [x.id, { elements: refs.map((r) => elementFacts(body.topology, body.names, r)) as never }];
      }),
    );
    const { scene, dimensions } = buildScene(d, new Map([['view1', lines]]), elements);
    expect(dimensions.size).toBe(12);
    expect([...dimensions.values()].every((o) => !('error' in o))).toBe(true);
    expect(scene.items.filter((i) => i.kind === 'polyline' && i.style === 'dimension').length).toBeGreaterThan(30);
    const svg = toSvg(scene);
    for (const text of ['120', '80', '4×Ø9', '2×Ø8', '4×R10']) expect(svg).toContain(`>${text}</text>`);
    expect(svg).toContain('fill="#000000" stroke="#000000"'); // the arrowheads are filled
    // without what the worker found, nothing is drawn and each dimension says it is waiting
    const waiting = buildScene(d, new Map([['view1', lines]]));
    expect([...waiting.dimensions.values()].every((o) => 'error' in o)).toBe(true);
    expect(waiting.scene.items.filter((i) => i.kind === 'polyline' && i.style === 'dimension')).toHaveLength(0);
  });
});

/**
 * A fillet is a torus, and its radius is not read the way a cylinder's is: down the axis it is only a ring (no arc to measure), and across the axis its tube is cut
 * through, the cut being the arc that R names. The arc's middle is a quarter turn off the axis, on the side the leader leans — measured on the mouth of a Ø3.97
 * bore, whose tube's middle runs at Ø4.37 about the part's axis and whose tube is Ø0.4.
 */
describe('a fillet (a torus face) is dimensioned where its tube is cut through', () => {
  const placed: PlacedView = { id: 'view1', at: [0, 0], scale: 1, w: 100, h: 100, centre: [0, 0] };
  const fillet: ElementFacts = { kind: 'face', type: 'torus', point: [0, 0, 10], dir: [0, 0, 1], radius: 0.2, major: 2.185 };
  const dim = (extra: Partial<Dimension> = {}): Dimension => ({ id: 'd1', view: 'view1', kind: 'radius', ref: { kind: 'face', name: 'rv1:f1:fillet' }, angle: 90, ...extra }) as Dimension;
  const at = (axes: ViewAxes, d: Dimension) => evaluateDimension(d, { elements: [fillet] }, axes, placed);
  /** The two points a radius dimension is drawn between, in sheet mm: the middle of the arc and where its arrow touches. */
  const round = (o: unknown) => (o as { dxf: { geometry: { centre: number[]; near: number[] } } }).dxf.geometry;

  it('is seen true in a view that looks across its axis, and its middle is a quarter turn off the axis the way the leader leans', () => {
    // the right view looks along −x, so the part's axis (z) lies across the sheet: its x is the model's −z and its y the model's +y
    const side = viewVectors('right');
    const up = at(side, dim({ tolerance: { type: 'max' } }));
    expect(up).toMatchObject({ value: 0.2, text: 'R0.2 最大' });
    // the axis is the sheet's y = 0; the tube's middle is 2.185 above it, and the arrow touches where the tube is farthest from the axis: 2.185 + 0.2
    expect(round(up).centre).toEqual([expect.closeTo(-10, 9), expect.closeTo(2.185, 9)]);
    expect(round(up).near).toEqual([expect.closeTo(-10, 9), expect.closeTo(2.385, 9)]);
    // leaning the other way takes the arc below the axis
    const down = round(at(side, dim({ angle: 270 })));
    expect(down.centre).toEqual([expect.closeTo(-10, 9), expect.closeTo(-2.185, 9)]);
    expect(down.near).toEqual([expect.closeTo(-10, 9), expect.closeTo(-2.385, 9)]);
  });

  it('is refused down its own axis, where it is only a ring and no arc can be measured', () => {
    expect(at(viewVectors('front'), dim())).toMatchObject({ error: expect.stringContaining('看不到圓的真形') });
    expect(at(viewVectors('back'), dim())).toMatchObject({ error: expect.stringContaining('看不到圓的真形') });
    // and a leader that runs along the axis leans toward neither of the two arcs, so it names none
    expect(at(viewVectors('right'), dim({ angle: 0 }))).toMatchObject({ error: expect.stringContaining('看不到圓的真形') });
  });

  it('the same fillet in another view that looks across the axis: the top view puts the arc to the side of the axis, not above it', () => {
    // the top view looks along −y, so its x is the model's +x and its y the model's −z: the axis is the sheet's x = 0
    const across = round(at(viewVectors('top'), dim({ angle: 0 })));
    expect(across.centre).toEqual([expect.closeTo(2.185, 9), expect.closeTo(-10, 9)]);
    expect(across.near).toEqual([expect.closeTo(2.385, 9), expect.closeTo(-10, 9)]);
  });
});

/**
 * E1a step 2: a fillet reaches the automatic dimensions. The thing that can go wrong is counting the features instead of the faces — the view cuts a fillet's
 * tube twice, so one fillet is two features, and counting them would write 「2×R0.2」 for a single fillet. A fillet is also not lumped in with a cylinder's arc:
 * the same number written on a different kind of edge is a different callout.
 */
describe('a fillet in the automatic dimensions (E1a)', () => {
  const all = { overall: false, holes: true, positions: false };
  const torus = (name: string, radius: number, convex: boolean, at: [number, number]): ViewFeature => ({
    type: 'torus',
    ref: { kind: 'face', name },
    centre: [50, 30],
    at,
    radius,
    major: 4,
    axis: [1, 0],
    convex,
    outward: at[1] > 30 ? 90 : -90,
  });
  /** One fillet face, cut twice: two features of the one face. */
  const fillet = (name: string, radius: number, convex = true): ViewFeature[] => [torus(name, radius, convex, [50, 34]), torus(name, radius, convex, [50, 26])];
  /** A cylinder seen as an arc: one feature is one arc. */
  const arc = (name: string, cx: number, cy: number, radius: number): ViewFeature => ({ type: 'circle', ref: { kind: 'face', name }, centre: [cx, cy], radius, convex: true, full: false, outward: 45 });
  const radii = (d: DimensionDraft[]) => d.flatMap((x) => (x.kind === 'radius' ? [{ name: x.ref.name, count: x.count ?? 1 }] : []));

  it('gives one fillet one R, not one per cut of its tube', () => {
    const d = autoDimensions(fillet('f1', 0.2), all);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ kind: 'radius', ref: { name: 'f1' } });
    expect(d[0]).not.toHaveProperty('count');
  });

  it('counts two fillets of the same R as two, and keeps a concave fillet apart from a convex round of the same R', () => {
    expect(radii(autoDimensions([...fillet('f1', 0.2), ...fillet('f2', 0.2)], all))).toEqual([{ name: 'f1', count: 2 }]);
    expect(radii(autoDimensions([...fillet('f1', 0.2), ...fillet('f2', 0.2, false)], all))).toEqual([
      { name: 'f1', count: 1 },
      { name: 'f2', count: 1 },
    ]);
  });

  it("is not counted with a cylinder's arc of the same R: the same number on a different kind of edge is a different callout", () => {
    expect(radii(autoDimensions([...fillet('f1', 10), arc('a1', 10, 10, 10)], all))).toEqual([
      { name: 'a1', count: 1 },
      { name: 'f1', count: 1 },
    ]);
  });

  it('is left out when the holes are not asked for, while the overall size is still made', () => {
    const planes: ViewFeature[] = [
      { type: 'plane', ref: { kind: 'face', name: 'px0' }, axis: 'x', coord: 0, area: 10 },
      { type: 'plane', ref: { kind: 'face', name: 'px100' }, axis: 'x', coord: 100, area: 10 },
    ];
    const d = autoDimensions([...planes, ...fillet('f1', 0.2)], { overall: true, holes: false, positions: false });
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ kind: 'linear', a: { name: 'px0' }, b: { name: 'px100' } });
  });
});
