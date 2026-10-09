/**
 * The angle dimension (C16.4, 2026-10-07): what it is in the document, what it comes to between two lines seen in a view (worked out by hand: 90°, 45°, 135°),
 * how it is drawn (the arc of the radius asked for about the corner, an arrow at each end, the value over the middle), what it refuses, and the slanted face of a
 * chamfered block, which the view now offers beside the planes square to its x and y.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { applyCommand, applyDrawingCommand, createEmptyDrawing, parseDrawing, rightOf, serializeDrawing, viewVectors, type Dimension, type DrawingDoc, type ElementFacts, type Feature, type Ref } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, elementFacts, viewFeatures } from '@3db/regen';
import { dimensionText, evaluateDimension, type ElementsResult, type PlacedView } from '@3db/drawing';
import { build, extrude, front, rectangle, sketch } from '../phase1/builders';

const ref = (name: string): Ref => ({ kind: 'face', name });
const base = (): DrawingDoc => applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views: [{ id: 'view1', name: 'f', source: 'a.3dbx', direction: 'right' }] });
const angle = (id: string, extra: Partial<Dimension> = {}): Dimension => ({ id, view: 'view1', kind: 'angle', a: ref('a'), b: ref('b'), arc: 20, ...extra }) as Dimension;

describe('the angle dimension in the document', () => {
  it('is inserted with its arc, and refused with a bad arc, a vertex, a fit, or fields that are not its kind\'s', () => {
    const d = applyDrawingCommand(base(), { type: 'insertDimensions', dimensions: [angle('dim1')] });
    expect(d.dimensions[0]).toMatchObject({ kind: 'angle', arc: 20 });
    const insert = (x: Dimension) => applyDrawingCommand(base(), { type: 'insertDimensions', dimensions: [x] });
    expect(() => insert(angle('dim1', { arc: 0 }))).toThrow(/弧半徑/);
    expect(() => insert(angle('dim1', { arc: NaN }))).toThrow(/弧半徑/);
    expect(() => insert(angle('dim1', { a: { kind: 'vertex', name: 'v' } }))).toThrow(/面、邊或頂點/);
    expect(() => insert(angle('dim1', { tolerance: { type: 'fit', fit: 'H7' } }))).toThrow(/上下限/);
    expect(insert(angle('dim1', { tolerance: { type: 'bilateral', upper: 0.5, lower: -0.5 } })).dimensions).toHaveLength(1);
    expect(() => applyDrawingCommand(d, { type: 'setDimension', dimensionId: 'dim1', patch: { count: 3 } })).toThrow(/不屬於/);
    expect(() => applyDrawingCommand(d, { type: 'setDimension', dimensionId: 'dim1', patch: { offset: 3 } })).toThrow(/不屬於/);
    expect(() => applyDrawingCommand(d, { type: 'setDimension', dimensionId: 'dim1', patch: { arc: -4 } })).toThrow(/弧半徑/);
  });

  it('changes the arc and takes the other angle, and puts it back', () => {
    let d = applyDrawingCommand(base(), { type: 'insertDimensions', dimensions: [angle('dim1')] });
    d = applyDrawingCommand(d, { type: 'setDimension', dimensionId: 'dim1', patch: { arc: 30, supplementary: true, reference: true } });
    expect(d.dimensions[0]).toMatchObject({ arc: 30, supplementary: true, reference: true });
    d = applyDrawingCommand(d, { type: 'setDimension', dimensionId: 'dim1', patch: { supplementary: null } });
    expect(d.dimensions[0]).not.toHaveProperty('supplementary');
  });

  it('only an angle takes the other angle', () => {
    const d = applyDrawingCommand(base(), { type: 'insertDimensions', dimensions: [{ id: 'dim1', view: 'view1', kind: 'radius', ref: ref('c'), angle: 45 }] });
    expect(() => applyDrawingCommand(d, { type: 'setDimension', dimensionId: 'dim1', patch: { supplementary: true } })).toThrow(/不屬於/);
  });

  it('is written and read back, and a version-4 drawing is read as version 7', () => {
    const d = applyDrawingCommand(base(), { type: 'insertDimensions', dimensions: [angle('dim1', { supplementary: true })] });
    const back = parseDrawing(serializeDrawing(d));
    expect(back.dimensions[0]).toMatchObject({ kind: 'angle', supplementary: true });
    expect(back.schemaVersion).toBe(8);
    const old = JSON.parse(serializeDrawing(base())) as { schemaVersion: number };
    old.schemaVersion = 4;
    expect(parseDrawing(JSON.stringify(old)).schemaVersion).toBe(8);
    const future = JSON.parse(serializeDrawing(base())) as { schemaVersion: number };
    future.schemaVersion = 9;
    expect(() => parseDrawing(JSON.stringify(future))).toThrow();
  });
});

/** The view looking from the right: its x and its up are the part's. The sheet position of the view's origin is (100, 100), 1:1. */
const axes = viewVectors('right');
const right = rightOf(axes);
const placed: PlacedView = { id: 'view1', at: [100, 100], scale: 1, w: 100, h: 100, centre: [0, 0] };
/** A point of the view as a point of the part (what a fact carries). */
const at3 = (x: number, y: number): [number, number, number] => [right[0] * x + axes.up[0] * y, right[1] * x + axes.up[1] * y, right[2] * x + axes.up[2] * y];
/** A plane seen edge-on: its line runs along (dx, dy) through (px, py); its normal is across the line, in the view; `middle` is where the face is. */
const plane = (p: [number, number], d: [number, number], middle: [number, number]): ElementFacts => ({ kind: 'face', type: 'plane', point: at3(...p), dir: at3(-d[1], d[0]), center: at3(...middle) });
/** A straight edge seen true along (dx, dy), its middle at (mx, my). */
const edge = (m: [number, number], d: [number, number]): ElementFacts => ({ kind: 'edge', type: 'line', point: at3(...m), dir: at3(...d) });
const resolved = (...elements: ElementFacts[]): ElementsResult => ({ elements });
const evaluate = (d: Dimension, ...elements: ElementFacts[]) => evaluateDimension(d, resolved(...elements), axes, placed);
type Done = Extract<ReturnType<typeof evaluate>, { value: number }>;
const done = (o: ReturnType<typeof evaluate>): Done => {
  if ('error' in o) throw new Error(o.error);
  return o;
};
const S = Math.SQRT1_2;

describe('what an angle between two lines of the view comes to', () => {
  const vertical = plane([0, 0], [0, 1], [0, 5]); // x = 0, the face above the corner
  const floor = plane([0, 0], [1, 0], [5, 0]); // y = 0, the face to the right of the corner
  const slope = plane([0, 0], [S, S], [3, 3]); // a 45° face rising to the right

  it('a wall and a floor: 90°', () => {
    const o = done(evaluate(angle('d'), vertical, floor));
    expect(o.value).toBeCloseTo(90, 9);
    expect(o.text).toBe('90°');
  });

  it('a wall and a slope of 45°: 45°, and 135° with the other angle', () => {
    expect(done(evaluate(angle('d'), vertical, slope)).value).toBeCloseTo(45, 9);
    const o = done(evaluate(angle('d', { supplementary: true }), vertical, slope));
    expect(o.value).toBeCloseTo(135, 9);
    expect(o.text).toBe('135°');
  });

  it('the angle is the one the faces enclose: a slope of 45° the other way is 135° from the wall', () => {
    const back = plane([0, 0], [-S, S], [-3, 3]); // rising to the left
    expect(done(evaluate(angle('d'), floor, back)).value).toBeCloseTo(135, 9); // from the floor to the right round to the left slope
  });

  it('two straight edges seen true: the angle between them, 30° between a horizontal one and one at 30°', () => {
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    const o = done(evaluate(angle('d'), edge([10, 0], [1, 0]), edge([10 * c, 10 * s], [c, s])));
    expect(o.value).toBeCloseTo(30, 9);
  });

  it('a face and an edge together', () => {
    expect(done(evaluate(angle('d'), vertical, edge([6, 0], [1, 0]))).value).toBeCloseTo(90, 9);
  });

  it('writes a tolerance in degrees and parentheses for a reference', () => {
    const d = angle('d', { tolerance: { type: 'bilateral', upper: 0.5, lower: -0.5 } });
    expect(dimensionText(d, 90)).toBe('90° ±0.5°');
    expect(dimensionText(angle('d', { reference: true }), 45.25)).toBe('(45.25°)');
    expect(dimensionText(angle('d', { tolerance: { type: 'bilateral', upper: 0.2, lower: -0.1 } }), 45)).toBe('45° +0.2/-0.1°');
  });

  it('says why when it cannot: parallel lines, a plane that is not edge-on, an edge not seen true, a circle', () => {
    expect(evaluate(angle('d'), floor, plane([0, 4], [1, 0], [5, 4]))).toEqual({ error: expect.stringContaining('互相平行') });
    const facing: ElementFacts = { kind: 'face', type: 'plane', point: [0, 0, 0], dir: [axes.dir[0], axes.dir[1], axes.dir[2]] };
    expect(evaluate(angle('d'), vertical, facing)).toEqual({ error: expect.stringContaining('不是一條線') });
    const slanted: ElementFacts = { kind: 'edge', type: 'line', point: at3(0, 0), dir: [axes.dir[0] * S + right[0] * S, axes.dir[1] * S + right[1] * S, axes.dir[2] * S + right[2] * S] };
    expect(evaluate(angle('d'), vertical, slanted)).toEqual({ error: expect.stringContaining('不是一條線') });
    const round: ElementFacts = { kind: 'face', type: 'cylinder', point: [0, 0, 0], dir: right, radius: 3 };
    expect(evaluate(angle('d'), vertical, round)).toEqual({ error: expect.stringContaining('只能量') });
    expect(evaluateDimension(angle('d'), undefined, axes, placed)).toEqual({ error: expect.any(String) });
  });
});

describe('how an angle is drawn', () => {
  const vertical = plane([0, 0], [0, 1], [0, 5]);
  const slope = plane([0, 0], [S, S], [3, 3]);

  it('an arc of the radius asked for about the corner, from one face to the other, an arrow at each end, the value over the middle', () => {
    const o = done(evaluate(angle('d', { arc: 20 }), vertical, slope));
    const items = o.items as { kind: string; points?: number[]; text?: string; at?: number[]; closed?: boolean; filled?: boolean; anchor?: string }[];
    const arc = items.find((i) => i.kind === 'polyline' && !i.closed && i.points!.length > 8)!;
    const pts = arc.points!;
    // the corner is at (100, 100) on the sheet: every point of the arc is 20 from it, the first on the wall (up), the last on the slope (45°)
    for (let k = 0; k < pts.length; k += 2) expect(Math.hypot(pts[k]! - 100, pts[k + 1]! - 100)).toBeCloseTo(20, 9);
    expect([pts[0], pts[1]]).toEqual([expect.closeTo(100, 9), expect.closeTo(120, 9)]);
    expect([pts.at(-2), pts.at(-1)]).toEqual([expect.closeTo(100 + 20 * S, 9), expect.closeTo(100 + 20 * S, 9)]);
    const arrows = items.filter((i) => i.kind === 'polyline' && i.closed && i.filled);
    expect(arrows).toHaveLength(2);
    expect(arrows.map((a) => [a.points![0], a.points![1]])).toEqual([[expect.closeTo(100, 9), expect.closeTo(120, 9)], [expect.closeTo(100 + 20 * S, 9), expect.closeTo(100 + 20 * S, 9)]]);
    const text = items.find((i) => i.kind === 'text')!;
    expect(text).toMatchObject({ text: '45°', anchor: 'center' });
    // over the middle of the arc: the bisector is at 67.5° from the x axis, a little outside the arc
    const [tx, ty] = [text.at![0]! - 100, text.at![1]! - 100 + 1.75];
    expect(Math.atan2(ty, tx)).toBeCloseTo((67.5 * Math.PI) / 180, 6);
    expect(Math.hypot(tx, ty)).toBeGreaterThan(20);
    // the rays carry extension lines past the arc
    const rays = items.filter((i) => i.kind === 'polyline' && !i.closed && i.points!.length === 4);
    expect(rays).toHaveLength(2);
    for (const r of rays) expect(Math.hypot(r.points![2]! - 100, r.points![3]! - 100)).toBeCloseTo(22, 9); // arc + 2
  });

  it('a short arc has its arrows outside, pointing in, on stubs of the arc', () => {
    const near = plane([0, 0], [Math.cos(0.1), Math.sin(0.1)], [3, 0.3]); // 5.7° from the floor
    const floor = plane([0, 0], [1, 0], [5, 0]);
    const o = done(evaluate(angle('d', { arc: 20 }), floor, near));
    expect(o.value).toBeCloseTo((0.1 * 180) / Math.PI, 6);
    const items = o.items as { kind: string; points?: number[]; closed?: boolean; filled?: boolean }[];
    const arc = items.find((i) => i.kind === 'polyline' && !i.closed && i.points!.length > 8)!;
    const first = Math.atan2(arc.points![1]! - 100, arc.points![0]! - 100);
    const last = Math.atan2(arc.points!.at(-1)! - 100, arc.points!.at(-2)! - 100);
    expect(Math.abs(last - first)).toBeGreaterThan(0.1 + 0.2); // longer than the angle: it runs on past both ends
  });

  it('its arc radius is the one in the dimension, and the sheet position follows the view', () => {
    const moved: PlacedView = { ...placed, at: [250, 80], scale: 2 };
    const o = done(evaluateDimension(angle('d', { arc: 12 }), resolved(vertical, slope), axes, moved));
    const arc = (o.items as { kind: string; points?: number[]; closed?: boolean }[]).find((i) => i.kind === 'polyline' && !i.closed && i.points!.length > 8)!;
    expect(Math.hypot(arc.points![0]! - 250, arc.points![1]! - 80)).toBeCloseTo(12, 9); // the corner is the view's origin at (250, 80)
  });
});

describe('a chamfered block seen from the right', () => {
  let kernel: Kernel;
  let solver: PlaneGcsSolver;
  let regen: Regenerator;
  beforeAll(async () => {
    kernel = await Kernel.load();
    solver = await PlaneGcsSolver.create();
    regen = new Regenerator(kernel, solver);
  });
  afterAll(() => regen.dispose());

  /** 40 × 30 × 12 with the edge along x at y = 0 of the top chamfered 4 × 4. */
  const block = (): Feature[] => [sketch('s1', front, rectangle('a', 0, 0, 40, 30)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '12' })];
  const make = () => {
    const plain = regen.rebuild(build(...block())).body!;
    const sign = plain.topology.vertices.some((v) => v.point[2] > 1e-6) ? 1 : -1;
    const i = plain.topology.edges.findIndex((e) => Math.abs(e.mid[0] - 20) < 1e-6 && Math.abs(e.mid[1]) < 1e-6 && Math.abs(e.mid[2] - 12 * sign) < 1e-6);
    expect(i).toBeGreaterThanOrEqual(0);
    const edge: Ref = { kind: 'edge', name: plain.names.edges[i]! };
    const chamfer: Feature = { id: 'c1', type: 'chamfer', name: 'c1', suppressed: false, edges: [edge], mode: 'distanceDistance', distance: '4', second: '4' };
    return regen.rebuild(applyCommand(build(...block()), { type: 'insertFeature', feature: chamfer, index: 2 })).body!;
  };

  it('the view offers the slanted face of the chamfer, with its line at 45°, besides the planes square to x and y', () => {
    const body = make();
    const features = viewFeatures(body.topology, body.names, axes);
    const slants = features.filter((f) => f.type === 'slant');
    expect(slants).toHaveLength(1);
    const s = slants[0]!;
    if (s.type !== 'slant') throw new Error('slant');
    expect(Math.abs(Math.abs(s.dir[0]) - S)).toBeLessThan(1e-9);
    expect(Math.abs(Math.abs(s.dir[1]) - S)).toBeLessThan(1e-9);
    expect(Math.hypot(...s.dir)).toBeCloseTo(1, 9);
    expect(s.area).toBeCloseTo(4 * Math.SQRT2 * 40, 6);
    expect(features.filter((f) => f.type === 'plane').length).toBeGreaterThanOrEqual(4);
  });

  it('the top face and the chamfer enclose 135° (the inside of the corner), and 45° with the other angle', () => {
    const body = make();
    const features = viewFeatures(body.topology, body.names, axes);
    const slant = features.find((f) => f.type === 'slant')!;
    const sign = body.topology.vertices.some((v) => v.point[2] > 1e-6) ? 1 : -1;
    const topIndex = body.topology.faces.findIndex((f) => f.surface === 'plane' && f.normal && Math.abs(f.normal[2] - sign) < 1e-9 && Math.abs(f.center[2] - 12 * sign) < 1e-6);
    expect(topIndex).toBeGreaterThanOrEqual(0);
    const top: Ref = { kind: 'face', name: body.names.faces[topIndex]! };
    const facts = [elementFacts(body.topology, body.names, top), elementFacts(body.topology, body.names, slant.ref)];
    expect(facts.every((f) => !('error' in f))).toBe(true);
    const els = facts as ElementFacts[];
    const view: PlacedView = { id: 'view1', at: [100, 100], scale: 1, w: 100, h: 100, centre: [0, 0] };
    const o = done(evaluateDimension(angle('d', { a: top, b: slant.ref }), resolved(...els), axes, view));
    expect(o.value).toBeCloseTo(135, 6);
    const other = done(evaluateDimension(angle('d', { a: top, b: slant.ref, supplementary: true }), resolved(...els), axes, view));
    expect(other.value).toBeCloseTo(45, 6);
  });

  it('a block without a chamfer has no slanted face', () => {
    const body = regen.rebuild(build(...block())).body!;
    expect(viewFeatures(body.topology, body.names, axes).filter((f) => f.type === 'slant')).toEqual([]);
  });
});
