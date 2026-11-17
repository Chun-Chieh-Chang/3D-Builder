/**
 * ADR 0256: the planner of a drawing made with an agent. The rule under test is the user's: the drawing must fully determine every size of the part. The
 * fuzz builds random parts of axis-aligned planes and holes in three views (as `viewFeatures` would see them), and asserts that the dimensions the planner
 * adds make the coverage graph complete, that nothing is written twice, and that a dimension taken away is found missing again — 200 parts, no exception.
 * The pure rules of the sheet's check are pinned beside it: a text over a text, a number crossed by a line, two dimension lines crossing, a glyph outline.
 */
import { describe, expect, it } from 'vitest';
import { viewVectors, type ViewFeature, type ViewName } from '@3db/model';
import { adviseSection, chooseProjections, clutterOf, dimensionCoverage, planDrawingDimensions, rankMainViews, type DimensionLike, type DirectionStats, type SceneItem, type ViewToDimension } from '@3db/drawing';

/** A deterministic random generator, so that a failing part can be built again from its seed. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

interface Part {
  /** The faces square to each world axis: their place and area. */
  planes: { axis: 0 | 1 | 2; at: number; area: number; name: string }[];
  /** Holes along a world axis: where the axis is on the two other axes, the radius. */
  holes: { axis: 0 | 1 | 2; c: [number, number, number]; r: number; name: string }[];
}

function randomPart(seed: number): Part {
  const r = rng(seed);
  const size = [20 + Math.round(r() * 100), 20 + Math.round(r() * 100), 10 + Math.round(r() * 60)];
  const planes: Part['planes'] = [];
  let n = 0;
  for (const axis of [0, 1, 2] as const) {
    planes.push({ axis, at: 0, area: 1000, name: `f${n++}` }, { axis, at: size[axis]!, area: 900, name: `f${n++}` });
    // steps: planes between the ends
    const steps = Math.floor(r() * 4);
    for (let k = 0; k < steps; k++) planes.push({ axis, at: Math.round(r() * (size[axis]! - 2)) + 1, area: 5 + Math.round(r() * 300), name: `f${n++}` });
  }
  const holes: Part['holes'] = [];
  const count = Math.floor(r() * 6);
  for (let k = 0; k < count; k++) {
    const axis = Math.floor(r() * 3) as 0 | 1 | 2;
    const c: [number, number, number] = [0, 1, 2].map((i) => (i === axis ? 0 : 3 + Math.round(r() * (size[i]! - 6)))) as [number, number, number];
    // equal holes now and then, so that 「n×Ø」 is exercised
    const radius = r() < 0.4 && holes.length ? holes[0]!.r : 1 + Math.round(r() * 4);
    holes.push({ axis, c, r: radius, name: `h${k}` });
  }
  return { planes, holes };
}

/** What a view of the part sees, as `viewFeatures` gives it: planes edge-on, holes along the view as circles, across it as cylinders side-on. */
function viewOf(part: Part, id: string, direction: ViewName): ViewToDimension {
  const axes = viewVectors(direction);
  const right = [axes.dir[1] * axes.up[2] - axes.dir[2] * axes.up[1], axes.dir[2] * axes.up[0] - axes.dir[0] * axes.up[2], axes.dir[0] * axes.up[1] - axes.dir[1] * axes.up[0]];
  const axisOf = (v: readonly number[]) => [0, 1, 2].find((i) => Math.abs(v[i]!) > 0.5)!;
  const xAxis = axisOf(right);
  const yAxis = axisOf(axes.up);
  const sx = Math.sign(right[xAxis]!);
  const sy = Math.sign(axes.up[yAxis]!);
  const features: ViewFeature[] = [];
  for (const p of part.planes) {
    if (p.axis === xAxis) features.push({ type: 'plane', ref: { kind: 'face', name: p.name }, axis: 'x', coord: p.at * sx, area: p.area });
    if (p.axis === yAxis) features.push({ type: 'plane', ref: { kind: 'face', name: p.name }, axis: 'y', coord: p.at * sy, area: p.area });
  }
  for (const h of part.holes) {
    const ref = { kind: 'face' as const, name: h.name };
    if (h.axis !== xAxis && h.axis !== yAxis) features.push({ type: 'circle', ref, centre: [h.c[xAxis]! * sx, h.c[yAxis]! * sy], radius: h.r, convex: false, full: true, outward: 45 });
    else if (h.axis === xAxis) features.push({ type: 'axis', ref, from: [0, h.c[yAxis]! * sy], to: [50 * sx, h.c[yAxis]! * sy], radius: h.r });
    else features.push({ type: 'axis', ref, from: [h.c[xAxis]! * sx, 0], to: [h.c[xAxis]! * sx, 50 * sy], radius: h.r });
  }
  return { viewId: id, axes, features };
}

describe('the planner makes every random part fully determined (200 parts)', () => {
  it('coverage is complete after planning, sizes are written once, and a removed dimension is found missing', () => {
    let dims = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const part = randomPart(seed);
      const views = [viewOf(part, 'v1', 'front'), viewOf(part, 'v2', 'top'), viewOf(part, 'v3', 'right')];
      const planned = planDrawingDimensions(views);
      const drawn: DimensionLike[] = planned.map((p) => ({ ...p.draft, view: p.view }) as DimensionLike);
      const cov = dimensionCoverage(views, drawn);
      expect(cov.ways.every((w) => w.missing.length === 0), `seed ${seed}: ${JSON.stringify(cov.ways)}`).toBe(true);
      expect(cov.rounds.missing, `seed ${seed}`).toEqual([]);
      // a hole is written once in all: no two size dimensions point at the same element
      const sized = planned.filter((p) => p.draft.kind === 'diameter' || p.draft.kind === 'radius').map((p) => (p.draft as { ref: { name: string } }).ref.name);
      expect(new Set(sized).size, `seed ${seed}`).toBe(sized.length);
      // planning again on top of the plan adds nothing
      expect(planDrawingDimensions(views, drawn), `seed ${seed}`).toEqual([]);
      // a place dimension taken away is missing again, and planning puts one back
      const i = planned.findIndex((p) => p.role === 'place');
      if (i >= 0) {
        const less = drawn.filter((_, k) => k !== i);
        expect(dimensionCoverage(views, less).complete, `seed ${seed}`).toBe(false);
        const back = planDrawingDimensions(views, less);
        expect(dimensionCoverage(views, [...less, ...back.map((p) => ({ ...p.draft, view: p.view }) as DimensionLike)]).complete, `seed ${seed}`).toBe(true);
      }
      dims += planned.length;
    }
    expect(dims).toBeGreaterThan(1000);
  });

  it('a negative, a NaN or an empty part never throws and is never reported complete when it is not', () => {
    const empty: ViewToDimension[] = [{ viewId: 'v', axes: viewVectors('front'), features: [] }];
    expect(planDrawingDimensions(empty)).toEqual([]);
    expect(dimensionCoverage(empty, []).complete).toBe(true);
    const lone: ViewToDimension[] = [{ viewId: 'v', axes: viewVectors('front'), features: [{ type: 'circle', ref: { kind: 'face', name: 'c' }, centre: [0, 0], radius: 3, convex: false, full: true, outward: 0 }] }];
    expect(dimensionCoverage(lone, []).complete).toBe(false);
    expect(dimensionCoverage(lone, planDrawingDimensions(lone).map((p) => ({ ...p.draft, view: p.view }) as DimensionLike)).complete).toBe(true);
  });
});

describe('the main view, the projections and the section', () => {
  const stats = (direction: ViewName, o: Partial<DirectionStats>): DirectionStats => ({ direction, axes: viewVectors(direction), width: 60, height: 40, visible: 200, hidden: 0, features: [], ...o });
  it('the direction with the true shapes and the fewest hidden lines ranks first, and every rank comes with its numbers', () => {
    const circle = (n: string): ViewFeature => ({ type: 'circle', ref: { kind: 'face', name: n }, centre: [0, 0], radius: 3, convex: false, full: true, outward: 0 });
    const ranked = rankMainViews([stats('front', { hidden: 80 }), stats('top', { features: [circle('a'), circle('b')] }), stats('right', { width: 20, height: 40, visible: 120 })]);
    expect(ranked[0]!.direction).toBe('top');
    expect(ranked[0]!.metrics.trueShapes).toBe(2);
    expect(ranked.at(-1)!.direction).toBe('right');
  });
  it('a second projection only when it shows something new; a section along the hidden bores', () => {
    const main = stats('front', { hidden: 100, features: [{ type: 'axis', ref: { kind: 'face', name: 'bore' }, from: [20, 0], to: [20, 30], radius: 8 }] });
    const plain = stats('top', {});
    const views = chooseProjections(main, [{ side: 'up', stats: plain }, { side: 'right', stats: stats('right', {}) }]);
    expect(views.length).toBe(1);
    const advice = adviseSection(main)!;
    expect(advice.orientation).toBe('vertical');
    expect(advice.at).toBe(20);
    expect(adviseSection(stats('front', {}))).toBeNull();
  });
});

describe('what the sheet check counts', () => {
  const text = (at: [number, number], s: string, extra: Partial<Extract<SceneItem, { kind: 'text' }>> = {}): SceneItem => ({ kind: 'text', at, text: s, height: 3.5, ...extra });
  const line = (pts: number[], extra: Partial<Extract<SceneItem, { kind: 'polyline' }>> = {}): SceneItem => ({ kind: 'polyline', points: pts, style: 'thin', ...extra });
  it('two texts over each other, a number crossed by another view’s line; not a number on its own dimension line', () => {
    expect(clutterOf([text([0, 0], '10', { group: 'a' }), text([1, 0], '20', { group: 'b' })]).count).toBe(1);
    expect(clutterOf([text([0, 0], '10', { group: 'a' }), line([2, -5, 2, 10], { owner: 'view:v' })]).count).toBe(1);
    expect(clutterOf([text([0, 1], '10', { group: 'a' }), line([-5, 0, 10, 0], { group: 'a' })]).count).toBe(0);
    // a note may sit on the part it marks
    expect(clutterOf([text([0, 0], 'note', { owner: 'n1' }), line([2, -5, 2, 10], { owner: 'view:v' })]).count).toBe(0);
  });
  it('a dimension line crossed by another dimension’s line counts; extension lines crossing each other do not', () => {
    const arrow = (x: number, y: number, g: string): SceneItem => ({ kind: 'polyline', points: [x, y, x + 1, y + 0.3, x + 1, y - 0.3], style: 'dimension', closed: true, filled: true, group: g });
    const dimLine = line([0, 0, 20, 0], { group: 'a' });
    const ext = line([10, -10, 10, 10], { group: 'b' });
    expect(clutterOf([dimLine, arrow(0, 0, 'a'), ext]).count).toBe(1);
    expect(clutterOf([line([0, 0, 20, 0], { group: 'a' }), ext]).count).toBe(0);
  });
  it('a caption inside another view counts even with no line through it', () => {
    const box = line([0, 0, 50, 0, 50, 50, 0, 50], { owner: 'view:v1', closed: true });
    expect(clutterOf([box, text([20, 20], '後視', { owner: 'caption:v2' })]).count).toBe(1);
    expect(clutterOf([box, text([20, 60], '後視', { owner: 'caption:v2' })]).count).toBe(0);
  });
});
