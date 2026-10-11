/**
 * Pointing at a drawing (schema 8): which element of a view is under the pointer, which dimension, the dimension that is made from what was pointed at and put where the
 * pointer is, what the pointer does to a dimension that is dragged, and how a dimension is written (decimals, prefix, suffix, a text of its own) and where its text and leader
 * are. The numbers are worked out by hand; the view is 100 x 60 at the sheet point (200, 150), scale 1, its own origin (0, 0) at the lower left corner of its box.
 */
import { describe, expect, it } from 'vitest';
import { rightOf, viewVectors, type Dimension } from '@3db/model';
import { dimensionAt, dimensionText, dragDimension, evaluateDimension, factsOf, featureAt, planDimension, toSheet, toView, type Pickable, type PlacedView, type SceneItem, type ViewLines } from '@3db/drawing';

const placed: PlacedView = { id: 'v', at: [200, 150], scale: 1, w: 100, h: 60, centre: [50, 30] };
// the box of the view on the sheet: x 150 to 250, y 120 to 180
const axes = (() => {
  const v = viewVectors('front');
  return { dir: v.dir, up: v.up };
})();
const ref = (name: string) => ({ kind: 'face' as const, name });
const plane = (axis: 'x' | 'y', coord: number, area = 10): Pickable => ({ type: 'plane', ref: ref(`p-${axis}${coord}`), axis, coord, area });
const circle = (cx: number, cy: number, radius: number, full = true): Pickable => ({ type: 'circle', ref: ref(`c-${cx}-${cy}`), centre: [cx, cy], radius, convex: false, full, outward: 0 });
const ring = (cx: number, cy: number, r: number): number[] => Array.from({ length: 65 }, (_, i) => [cx + r * Math.cos((i * Math.PI) / 32), cy + r * Math.sin((i * Math.PI) / 32)]).flat();
const lines: ViewLines = { visible: [[0, 0, 100, 0, 100, 60, 0, 60, 0, 0], ring(50, 30, 10)], hidden: [], box: { min: [0, 0], max: [100, 60] } };
const features = [plane('x', 0), plane('x', 100), plane('y', 0), plane('y', 60), circle(50, 30, 10)];

describe('a point of the sheet in a view', () => {
  it('is the other way round from toSheet', () => {
    expect(toSheet(placed, 25, 12)).toEqual([175, 132]);
    expect(toView(placed, [175, 132])).toEqual([25, 12]);
    const scaled = { ...placed, scale: 2 };
    expect(toView(scaled, toSheet(scaled, 31.5, 7))).toEqual([expect.closeTo(31.5, 9), expect.closeTo(7, 9)]);
  });
});

describe('the element under the pointer', () => {
  it('a line of the view that is where a plane is: the left side, the right side, the bottom; a circle by its outline', () => {
    expect((featureAt(lines, features, [0.3, 30], 1) as { coord: number }).coord).toBe(0);
    expect((featureAt(lines, features, [99.6, 30], 1) as { axis: string; coord: number }).coord).toBe(100);
    const bottom = featureAt(lines, features, [40, 0.4], 1) as { axis: string; coord: number };
    expect([bottom.axis, bottom.coord]).toEqual(['y', 0]);
    expect(featureAt(lines, features, [60.2, 30], 1)?.type).toBe('circle');
  });

  it('nothing where nothing is drawn: the empty middle of the view, the middle of a circle, a circle that is not drawn, a plane whose line is not there', () => {
    expect(featureAt(lines, features, [30, 15], 1)).toBeNull();
    expect(featureAt(lines, features, [50, 30], 1)).toBeNull();
    expect(featureAt({ ...lines, visible: [lines.visible[0]!] }, features, [60, 30], 1)).toBeNull();
    expect(featureAt(lines, [plane('x', 40)], [40, 30], 1)).toBeNull();
    expect(featureAt(null, features, [0, 0], 1)).toBeNull();
  });

  it('where two planes are on the same line the larger one is the one picked', () => {
    const f = featureAt(lines, [plane('x', 0, 5), { ...plane('x', 0, 50), ref: ref('big') }], [0, 30], 1);
    expect(f?.type === 'plane' && f.ref.name).toBe('big');
  });

  it('a slanted face by its line', () => {
    const slanted: ViewLines = { visible: [[0, 0, 40, 30]], hidden: [], box: { min: [0, 0], max: [40, 30] } };
    const f: Pickable = { type: 'slant', ref: ref('s'), at: [20, 15], dir: [0.8, 0.6], area: 10 };
    expect(featureAt(slanted, [f], [20, 15.3], 1)?.type).toBe('slant');
    expect(featureAt(slanted, [f], [30, 5], 1)).toBeNull();
  });
});

describe('the dimension under the pointer', () => {
  const items: SceneItem[] = [
    { kind: 'polyline', group: 'dim1', points: [0, 0, 10, 0], style: 'dimension' },
    { kind: 'polyline', group: 'dim1', points: [0, 0, 2, 1, 2, -1], style: 'dimension', closed: true, filled: true },
    { kind: 'text', group: 'dim1', at: [5, 1], text: '100', height: 3.5, anchor: 'center' },
    { kind: 'polyline', points: [100, 100, 110, 100], style: 'visible' },
  ];
  it('a line of it, its text (which is told apart from its line), nothing else', () => {
    expect(dimensionAt(items, [8, 0.4], 1)).toEqual({ id: 'dim1', text: false });
    expect(dimensionAt(items, [5, 2.5], 1)).toEqual({ id: 'dim1', text: true });
    expect(dimensionAt(items, [100, 100], 1)).toBeNull(); // a line of the view is not a dimension
    expect(dimensionAt(items, [50, 50], 1)).toBeNull();
  });
});

describe('the dimension made from what is pointed at', () => {
  const pick = (...f: Pickable[]) => f as Parameters<typeof planDimension>[0];
  const draftOf = (r: ReturnType<typeof planDimension>) => ('draft' in r ? r.draft : r);

  it('two planes across x: a horizontal distance, its line where the pointer is: 15 above the view, 12 below it', () => {
    expect(draftOf(planDimension(pick(plane('x', 0), plane('x', 100)), [200, 195], placed, axes))).toMatchObject({ kind: 'linear', orientation: 'horizontal', offset: 15 });
    expect(draftOf(planDimension(pick(plane('x', 0), plane('x', 100)), [200, 108], placed, axes))).toMatchObject({ orientation: 'horizontal', offset: -12 });
  });

  it('two planes across y: a vertical one, to the right 20 or to the left', () => {
    expect(draftOf(planDimension(pick(plane('y', 0), plane('y', 60)), [270, 150], placed, axes))).toMatchObject({ orientation: 'vertical', offset: 20 });
    expect(draftOf(planDimension(pick(plane('y', 0), plane('y', 60)), [140, 150], placed, axes))).toMatchObject({ orientation: 'vertical', offset: -10 });
  });

  it('a plane and a circle: along the plane\'s axis; two circles: the way the pointer is out of the view', () => {
    expect(draftOf(planDimension(pick(plane('x', 0), circle(50, 30, 10)), [200, 190], placed, axes))).toMatchObject({ orientation: 'horizontal' });
    expect(draftOf(planDimension(pick(plane('y', 0), circle(50, 30, 10)), [260, 150], placed, axes))).toMatchObject({ orientation: 'vertical' });
    const two = pick(circle(20, 30, 5), circle(80, 30, 5));
    expect(draftOf(planDimension(two, [200, 195], placed, axes))).toMatchObject({ orientation: 'horizontal' });
    expect(draftOf(planDimension(pick(circle(50, 10, 5), circle(50, 50, 5)), [265, 150], placed, axes))).toMatchObject({ orientation: 'vertical' });
  });

  it('a circle alone: a diameter, the leader the way the pointer is, as long as it reaches past the circle; an arc: a radius', () => {
    const d = draftOf(planDimension(pick(circle(50, 30, 10)), [230, 150], placed, axes));
    expect(d).toMatchObject({ kind: 'diameter', angle: 0, leader: 20 });
    expect(draftOf(planDimension(pick(circle(50, 30, 10, false)), [200, 170], placed, axes))).toMatchObject({ kind: 'radius', angle: 90, leader: 10 });
  });

  it('a plane across x and a plane across y: the angle between them (90°), its arc through the pointer', () => {
    // they meet at the view point (0, 0), the sheet point (150, 120)
    const r = planDimension(pick(plane('x', 0), plane('y', 0)), [170, 140], placed, axes);
    expect(draftOf(r)).toMatchObject({ kind: 'angle', arc: expect.closeTo(Math.hypot(20, 20), 2) });
  });

  it('what cannot be: a plane alone (it asks for the second), the same place twice, a plane across x with one across... another axis as a distance is an angle, a slanted face and a circle, two parallel slanted faces', () => {
    expect(planDimension(pick(plane('x', 0)), [200, 195], placed, axes)).toEqual({ need: 'second' });
    expect('error' in planDimension(pick(plane('x', 10), plane('x', 10)), [200, 195], placed, axes)).toBe(true);
    const slant = (at: [number, number]): Pickable => ({ type: 'slant', ref: ref(`s${at}`), at, dir: [0.8, 0.6], area: 5 });
    expect('error' in planDimension(pick(slant([10, 10]), circle(50, 30, 10)), [200, 195], placed, axes)).toBe(true);
    expect('error' in planDimension(pick(slant([10, 10]), slant([30, 10])), [200, 195], placed, axes)).toBe(true);
  });

  it('the facts it gives are enough to draw it: the real dimension code says 100 for the two planes, Ø20 for the circle, 90° for the two planes across', () => {
    const lin = planDimension(pick(plane('x', 0), plane('x', 100)), [200, 195], placed, axes);
    if (!('draft' in lin)) throw new Error('no draft');
    const out = evaluateDimension({ id: 'p', view: 'v', ...lin.draft } as Dimension, { elements: lin.facts }, axes, placed);
    expect('error' in out ? out.error : out.text).toBe('100');
    const dia = planDimension(pick(circle(50, 30, 10)), [230, 150], placed, axes);
    if (!('draft' in dia)) throw new Error('no draft');
    expect((evaluateDimension({ id: 'p', view: 'v', ...dia.draft } as Dimension, { elements: dia.facts }, axes, placed) as { text: string }).text).toBe('Ø20');
    const ang = planDimension(pick(plane('x', 0), plane('y', 0)), [170, 140], placed, axes);
    if (!('draft' in ang)) throw new Error('no draft');
    expect((evaluateDimension({ id: 'p', view: 'v', ...ang.draft } as Dimension, { elements: ang.facts }, axes, placed) as { text: string }).text).toBe('90°');
  });

  it('factsOf: a plane across x is at x with its normal along x; a circle looks along the view', () => {
    const f = factsOf(plane('x', 12), axes);
    expect(f).toMatchObject({ type: 'plane' });
    expect(f.point[0] + f.point[1] + f.point[2]).toBeCloseTo(12, 9);
    expect(factsOf(circle(1, 2, 3), axes)).toMatchObject({ type: 'cylinder', radius: 3 });
  });
});

describe('how a dimension is written', () => {
  const lin = (extra: Partial<Dimension> = {}): Dimension => ({ id: 'd', view: 'v', kind: 'linear', a: ref('a'), b: ref('b'), orientation: 'horizontal', offset: 10, ...extra }) as Dimension;
  it('decimals: three by default, as many as asked (0 to 4), none that are zero', () => {
    expect(dimensionText(lin(), 100.456789)).toBe('100.457');
    expect(dimensionText(lin({ precision: 1 }), 100.456)).toBe('100.5');
    expect(dimensionText(lin({ precision: 0 }), 100.6)).toBe('101');
    expect(dimensionText(lin({ precision: 4 }), 12)).toBe('12');
  });
  it('a prefix and a suffix around it, outside the parentheses of a reference dimension; a text of its own, with <DIM> for what it would have said', () => {
    expect(dimensionText(lin({ prefix: '最大 ', suffix: ' 兩處' }), 100)).toBe('最大 100 兩處');
    expect(dimensionText(lin({ prefix: '約 ', reference: true }), 100)).toBe('約 (100)');
    expect(dimensionText(lin({ text: '約 <DIM> (實測)' }), 100)).toBe('約 100 (實測)');
    expect(dimensionText(lin({ text: '見備註' }), 100)).toBe('見備註');
    expect(dimensionText({ id: 'd', view: 'v', kind: 'diameter', ref: ref('c'), angle: 45, count: 4, suffix: ' 貫穿' } as Dimension, 9)).toBe('4×Ø9 貫穿');
    expect(dimensionText({ id: 'd', view: 'v', kind: 'angle', a: ref('a'), b: ref('b'), arc: 20, precision: 0 } as Dimension, 44.6)).toBe('45°');
  });
});

describe('where a dimension is drawn, and what the pointer does to it', () => {
  const planes = [plane('x', 0), plane('x', 100)];
  const facts = planes.map((f) => factsOf(f as never, axes));
  const base = { id: 'd', view: 'v', kind: 'linear', a: ref('a'), b: ref('b'), orientation: 'horizontal', offset: 10 } as Dimension;
  const run = (d: Dimension) => evaluateDimension(d, { elements: facts }, axes, placed);
  const text = (o: ReturnType<typeof run>) => (('items' in o ? o.items : []).find((i) => i.kind === 'text') as { at: [number, number] }).at;

  it('the text of a linear dimension slides along its line by the slide, and the line stays', () => {
    const a = run(base);
    const b = run({ ...base, slide: 12 } as Dimension);
    expect(text(b)[0] - text(a)[0]).toBeCloseTo(12, 9);
    expect(text(b)[1]).toBeCloseTo(text(a)[1], 9);
  });

  it('the leader of a diameter is as long as it is told; the text of an angle slides along its arc', () => {
    const circ = [factsOf(circle(50, 30, 10), axes)];
    const o = (extra: object) => evaluateDimension({ id: 'd', view: 'v', kind: 'diameter', ref: ref('c'), angle: 0, ...extra } as Dimension, { elements: circ }, axes, placed) as { items: SceneItem[] };
    const at = (x: { items: SceneItem[] }) => (x.items.find((i) => i.kind === 'text') as { at: [number, number] }).at[0];
    expect(at(o({ leader: 20 })) - at(o({}))).toBeCloseTo(12, 9); // 8 is the default
  });

  it('dragging the line of a linear dimension gives the offset, its text the slide; a diameter the direction and the leader; an angle the arc', () => {
    const o = run(base);
    if (!('handle' in o) || !o.handle) throw new Error('no handle');
    expect(dragDimension(o.handle, false, [200, 200])).toEqual({ offset: 20 });
    expect(dragDimension(o.handle, false, [200, 100])).toEqual({ offset: -20 });
    expect(dragDimension(o.handle, true, [215, 195])).toEqual({ slide: 15 });
    const c = evaluateDimension({ id: 'd', view: 'v', kind: 'radius', ref: ref('c'), angle: 0 } as Dimension, { elements: [factsOf(circle(50, 30, 10), axes)] }, axes, placed);
    if (!('handle' in c) || !c.handle) throw new Error('no handle');
    expect(dragDimension(c.handle, false, [200, 180])).toEqual({ angle: 90, leader: 20 });
  });
});

/**
 * A fillet or a round on the sheet (E1a). The view is the side of a turned part: the axis runs across the sheet at y = 30, so the fillet at the mouth of the bore has
 * its own axis lying in the sheet — which is the only way its tube is cut through and the arc seen. The two cuts, one either side of the axis, are what is drawn.
 */
describe('a fillet on the sheet', () => {
  const R = 0.5;
  const MAJOR = 4;
  const AXIS_Y = 30;
  const dot3 = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  /** A fillet seen true: the tube's radius is `radius`, and the arc drawn about `at`, which is `major` off the torus's own centre. */
  const fillet = (at: [number, number]): Pickable => ({
    type: 'torus',
    // one face of the part, however many cuts of its tube are drawn: the two features share the name, which is the whole point
    ref: ref('t-mouth'),
    centre: [50, AXIS_Y],
    at,
    radius: R,
    major: MAJOR,
    axis: [1, 0],
    convex: true,
    outward: (Math.atan2(at[1] - AXIS_Y, at[0] - 50) * 180) / Math.PI,
  });
  /** Half a circle, the way a cut through a tube is drawn. */
  const half = (cy: number, up: boolean): number[] =>
    Array.from({ length: 17 }, (_, i) => {
      const a = (i / 16) * Math.PI;
      return [50 + R * Math.cos(a), cy + (up ? 1 : -1) * R * Math.sin(a)];
    }).flat();
  const above = fillet([50, AXIS_Y + MAJOR]);
  const below = fillet([50, AXIS_Y - MAJOR]);
  // the axis itself is drawn too (it is where the A–A cut runs), and it is not a feature to pick
  const cut: ViewLines = { visible: [[0, AXIS_Y, 100, AXIS_Y], half(AXIS_Y + MAJOR, true), half(AXIS_Y - MAJOR, false)], hidden: [], box: { min: [0, 0], max: [100, 60] } };

  it('both cuts are drawn, and pointing at either picks the same face: one R, not two', () => {
    const up = featureAt(cut, [above, below], [50, AXIS_Y + MAJOR + R], 0.4);
    const down = featureAt(cut, [above, below], [50, AXIS_Y - MAJOR - R], 0.4);
    expect(up?.type).toBe('torus');
    expect(down?.type).toBe('torus');
    // the two arcs are told apart by where they are drawn, but they are one face of the part
    expect(up).not.toEqual(down);
    expect((up as { ref: { name: string } }).ref.name).toBe((down as { ref: { name: string } }).ref.name);
    // nothing is picked where no arc is drawn: on the axis line, and past the end of the tube
    expect(featureAt(cut, [above, below], [50, AXIS_Y], 0.4)).toBeNull();
    expect(featureAt(cut, [above, below], [50, AXIS_Y + MAJOR + 2 * R], 0.4)).toBeNull();
  });

  it('gives facts the dimension can be drawn from without asking the model', () => {
    const f = factsOf(above, axes);
    expect(f).toMatchObject({ kind: 'face', type: 'torus', radius: R, major: MAJOR });
    // the point is the torus's own centre, on the axis; the direction its axis, which lies across the sheet — that is the whole reason it is seen as an arc
    expect(dot3(f.point, rightOf(axes))).toBeCloseTo(50, 9);
    expect(dot3(f.point, axes.up)).toBeCloseTo(AXIS_Y, 9);
    expect(dot3(f.dir!, rightOf(axes))).toBeCloseTo(1, 9);
    expect(dot3(f.dir!, axes.up)).toBeCloseTo(0, 9);
  });

  it('pointed at alone it makes an R of the tube, and the real dimension code draws it on the arc', () => {
    const plan = planDimension([above], [230, 170], placed, axes);
    if (!('draft' in plan)) throw new Error(`no draft: ${JSON.stringify(plan)}`);
    expect(plan.draft).toMatchObject({ kind: 'radius', ref: above.ref });
    const out = evaluateDimension({ id: 'p', view: 'v', ...plan.draft } as Dimension, { elements: plan.facts }, axes, placed);
    expect('error' in out ? out.error : out.text).toBe('R0.5');
    // the arrow lands on the arc, not on the torus's centre: the arc's middle is `major` off the axis, and the arrow touches the arc itself
    const g = (out as { dxf: { geometry: { centre: number[]; near: number[] } } }).dxf.geometry;
    const axisSheetY = placed.at[1] + (AXIS_Y - placed.centre[1]) * placed.scale;
    expect(g.centre[1]! - axisSheetY).toBeCloseTo(MAJOR, 6);
    expect(Math.hypot(g.near[0]! - g.centre[0]!, g.near[1]! - g.centre[1]!)).toBeCloseTo(R, 6);
  });

  it('is refused with a second element, either way round: an arc has no place to measure a distance from', () => {
    expect('error' in planDimension([above, plane('x', 0)], [230, 170], placed, axes)).toBe(true);
    expect('error' in planDimension([plane('x', 0), above], [230, 170], placed, axes)).toBe(true);
  });
});
