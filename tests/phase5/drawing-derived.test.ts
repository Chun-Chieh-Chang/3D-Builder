/**
 * 5-2 (docs/phase5-plan.md): projected, section and detail views (C16.3). Where each looks from; the plate cut through a hole, its cut faces hatched; the lines of a
 * detail cut to its circle; where each is put on the sheet and what is drawn on the view it comes from. Worked out by hand.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  applyDrawingCommand,
  axesOf,
  createEmptyDrawing,
  DRAWING_SCHEMA_VERSION,
  projectedAxes,
  sectionArrow,
  sectionAxes,
  sectionLookAxes,
  sectionPlane,
  sectionSide,
  sourceOf,
  viewVectors,
  type DrawingDoc,
  type DrawingView,
  type SectionDrawingView,
} from '@3db/model';
import { readPartFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type ShapeId } from '@3db/kernel';
import { Regenerator } from '@3db/regen';
import { buildScene, circlePolyline, clipToCircle, hatch, layoutViews, resolveLines, toSvg, type ViewLines } from '@3db/drawing';

const close = (a: readonly number[], b: readonly number[], digits = 9) => a.forEach((v, i) => expect(v, `${a} vs ${b}`).toBeCloseTo(b[i]!, digits));

describe('where a derived view looks from', () => {
  const front = viewVectors('front');

  it('a view projected to the side: third angle, the viewer is on the side the view is on; first angle, the other way round', () => {
    // the front view's right is +x: a view to its right in third angle is the right view, in first angle the left view
    close(projectedAxes(front, 'right', 'third').dir, viewVectors('right').dir);
    close(projectedAxes(front, 'right', 'first').dir, viewVectors('left').dir);
    // the view above the front: third angle the top view, first angle the bottom view
    expect(projectedAxes(front, 'up', 'third')).toEqual({ dir: viewVectors('top').dir, up: viewVectors('top').up });
    expect(projectedAxes(front, 'down', 'first')).toEqual({ dir: viewVectors('top').dir, up: viewVectors('top').up });
    expect(projectedAxes(front, 'down', 'third')).toEqual({ dir: viewVectors('bottom').dir, up: viewVectors('bottom').up });
    // and from a view that is itself projected: the right view's right is -z, so a view to the right of it (third angle) looks along +z, the back view
    const right = viewVectors('right');
    close(projectedAxes(right, 'right', 'third').dir, viewVectors('back').dir);
  });

  it('a section line: the arrows are to the right of the line from its first point to its second, the left with flip', () => {
    const arrow = (line: SectionDrawingView['line'], flip = false) => sectionArrow({ line, ...(flip ? { flip } : {}) });
    expect(arrow([[0, 0], [0, 10]])).toBe('right'); // up the page: right of it is →
    expect(arrow([[0, 10], [0, 0]])).toBe('left');
    expect(arrow([[0, 0], [10, 0]])).toBe('down'); // along the page: right of it is ↓
    expect(arrow([[10, 0], [0, 0]])).toBe('up');
    expect(arrow([[0, 0], [0, 10]], true)).toBe('left');
  });

  it('a section looks along its arrows, and is placed where the viewer is (third angle) or where the arrows point (first angle)', () => {
    // arrows to the right: the section looks along +x, which is how the left view looks; it goes on the left of the parent in third angle and on the right in first
    expect(sectionAxes(front, 'right').dir).toEqual(viewVectors('left').dir);
    expect(sectionSide('right', 'third')).toBe('left');
    expect(sectionSide('right', 'first')).toBe('right');
    // arrows up: it looks along +y, as the bottom view does; its up on the sheet is toward the viewer of the parent
    expect(sectionAxes(front, 'up')).toEqual({ dir: viewVectors('bottom').dir, up: viewVectors('bottom').up });
  });

  it('the cutting plane: through the line, square to the parent, its normal toward the viewer', () => {
    const v: SectionDrawingView = { id: 's', kind: 'section', name: 'A', parent: 'p', line: [[40, -5], [40, 20]], label: 'A' };
    const plane = sectionPlane(front, v);
    close(plane.origin, [40, -5, 0]);
    close(plane.normal, [-1, 0, 0]); // the viewer looks along +x, so the side to take away is toward -x
  });

  it('a slanted section (C-D-I5): looks along its arrows in the parent\'s plane, square to the parent\'s direction, and the plane holds the line', () => {
    const v = (line: SectionDrawingView['line']): SectionDrawingView => ({ id: 's', kind: 'section', name: 'A', parent: 'p', line, label: 'A' });
    const s = Math.SQRT1_2;
    // 45° up to the right: the arrows point to the right and down, so it looks along (1, -1, 0)/√2 in front's frame
    const diag = v([[0, 0], [10, 10]]);
    const look = sectionLookAxes(front, diag);
    close(look.dir, [s, -s, 0]);
    close(look.up, [s, s, 0]);
    const plane = sectionPlane(front, diag);
    close(plane.normal, [-s, s, 0]);
    close(plane.origin, [0, 0, 0]);
    // the plane holds the line: its normal is square to (1, 1, 0)
    expect(plane.normal[0] * 1 + plane.normal[1] * 1).toBeCloseTo(0, 9);
    // nearer up or down: the depth is the up, and the look stays in the plane
    const steep = sectionLookAxes(front, v([[0, 0], [40, 10]]));
    close(steep.up, viewVectors('front').dir);
    expect(steep.dir[2]).toBeCloseTo(0, 9);
    // every slanted line gives an orthonormal frame, the direction square to the parent's, for any angle 1°..179°
    for (let deg = 1; deg < 180; deg += 7) {
      const t = (deg * Math.PI) / 180;
      const a = sectionLookAxes(front, v([[0, 0], [Math.cos(t), Math.sin(t)]]));
      const len = (x: readonly number[]) => Math.hypot(...x);
      expect(len(a.dir)).toBeCloseTo(1, 9);
      expect(len(a.up)).toBeCloseTo(1, 9);
      expect(a.dir[0] * a.up[0] + a.dir[1] * a.up[1] + a.dir[2] * a.up[2]).toBeCloseTo(0, 9);
      expect(a.dir[2] * viewVectors('front').dir[2]).toBeCloseTo(0, 9);
    }
  });

  it('is found through the parents, and the source of a derived view is its root\'s', () => {
    const doc: DrawingDoc = applyDrawingCommand(createEmptyDrawing(), {
      type: 'insertViews',
      views: [
        { id: 'view1', name: 'front', source: 'a.3dbx', direction: 'front' },
        { id: 'view2', name: 'right', kind: 'projected', parent: 'view1', side: 'right' },
        { id: 'view3', name: 'A', kind: 'section', parent: 'view2', line: [[0, 0], [0, 5]], label: 'A' },
        { id: 'view4', name: 'B', kind: 'detail', parent: 'view1', centre: [0, 0], radius: 5, label: 'B' },
      ],
    });
    expect(doc.views.map((v) => sourceOf(doc.views, v))).toEqual(['a.3dbx', 'a.3dbx', 'a.3dbx', 'a.3dbx']);
    expect(axesOf(doc.views, 'third', doc.views[3]!)).toEqual(viewVectors('front')); // a detail looks as its parent does
    expect(axesOf(doc.views, 'third', doc.views[1]!)!.dir).toEqual(viewVectors('right').dir);
  });
});

describe('the derived views in the document', () => {
  const base = (): DrawingDoc => applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views: [{ id: 'view1', name: '前視', source: 'a.3dbx', direction: 'front' }] });

  it('checks each kind: a parent that is there, a section line that is not a point, a letter, a radius', () => {
    const d = base();
    const insert = (v: DrawingView) => applyDrawingCommand(d, { type: 'insertViews', views: [v] });
    expect(() => insert({ id: 'view2', name: 'x', kind: 'projected', parent: 'zzz', side: 'right' })).toThrow(/母視圖/);
    expect(() => insert({ id: 'view2', name: 'x', kind: 'projected', parent: 'view1', side: 'sideways' as never })).toThrow(/側邊/);
    // a slanted section line is allowed (C-D-I5): it is placed by its nearer axis
    expect(insert({ id: 'view2', name: 'A', kind: 'section', parent: 'view1', line: [[0, 0], [5, 5]], label: 'A' }).views).toHaveLength(2);
    expect(() => insert({ id: 'view2', name: 'A', kind: 'section', parent: 'view1', line: [[0, 0], [0, 0]], label: 'A' })).toThrow(/重合/);
    expect(() => insert({ id: 'view2', name: 'A', kind: 'section', parent: 'view1', line: [[0, 0], [0, 5]], label: ' ' })).toThrow(/字母/);
    expect(() => insert({ id: 'view2', name: 'B', kind: 'detail', parent: 'view1', centre: [0, 0], radius: 0, label: 'B' })).toThrow(/半徑/);
    expect(insert({ id: 'view2', name: 'B', kind: 'detail', parent: 'view1', centre: [0, 0], radius: 5, label: 'B' }).views).toHaveLength(2);
  });

  it('deleting a view deletes what comes from it, down the line, and their ids are not given out again', () => {
    let d = applyDrawingCommand(base(), {
      type: 'insertViews',
      views: [
        { id: 'view2', name: 'right', kind: 'projected', parent: 'view1', side: 'right' },
        { id: 'view3', name: 'A', kind: 'section', parent: 'view2', line: [[0, 0], [0, 5]], label: 'A' },
      ],
    });
    d = applyDrawingCommand(d, { type: 'deleteViews', viewIds: ['view2'] });
    expect(d.views.map((v) => v.id)).toEqual(['view1']);
    expect(d.idCounters.view).toBe(3);
  });

  it('changes what belongs to a view\'s kind and refuses what does not', () => {
    let d = applyDrawingCommand(base(), { type: 'insertViews', views: [{ id: 'view2', name: 'A', kind: 'section', parent: 'view1', line: [[0, 0], [0, 5]], label: 'A' }] });
    d = applyDrawingCommand(d, { type: 'setView', viewId: 'view2', patch: { flip: true, label: 'B' } });
    expect(d.views[1]).toMatchObject({ flip: true, label: 'B' });
    d = applyDrawingCommand(d, { type: 'setView', viewId: 'view2', patch: { flip: false } });
    expect(d.views[1]).not.toHaveProperty('flip');
    expect(() => applyDrawingCommand(d, { type: 'setView', viewId: 'view2', patch: { direction: 'top' } })).toThrow(/不屬於/);
    expect(() => applyDrawingCommand(d, { type: 'setView', viewId: 'view1', patch: { flip: true } })).toThrow(/不屬於/);
    // a slanted line is allowed (C-D-I5); one that is a point is not
    expect(applyDrawingCommand(d, { type: 'setView', viewId: 'view2', patch: { line: [[0, 0], [3, 3]] } }).views[1]).toMatchObject({ line: [[0, 0], [3, 3]] });
    expect(() => applyDrawingCommand(d, { type: 'setView', viewId: 'view2', patch: { line: [[3, 3], [3, 3]] } })).toThrow(/重合/);
  });

  it('is a version-1 drawing read as the current version: nothing to convert but the empty list of dimensions', async () => {
    const { parseDrawing, serializeDrawing } = await import('@3db/model');
    const v1 = JSON.stringify({ ...JSON.parse(serializeDrawing(base())), schemaVersion: 1 });
    expect(parseDrawing(v1).schemaVersion).toBe(DRAWING_SCHEMA_VERSION);
    expect(parseDrawing(v1).views).toEqual(base().views);
  });
});

describe('the 2D geometry of the derived views', () => {
  it('cuts a polyline to a circle: the pieces inside, exact at the circle', () => {
    // a line along y = 0 through a circle of radius 5 about the origin: from -5 to 5
    const [piece] = clipToCircle([-20, 0, 20, 0], [0, 0], 5);
    expect(piece).toHaveLength(4);
    close(piece!, [-5, 0, 5, 0]);
    // a line that misses it, and a line wholly inside
    expect(clipToCircle([-20, 9, 20, 9], [0, 0], 5)).toEqual([]);
    expect(clipToCircle([-1, 0, 1, 1], [0, 0], 5)).toEqual([[-1, 0, 1, 1]]);
    // a polyline that goes in, out and in again is two pieces
    expect(clipToCircle([-3, 0, 3, 0, 3, 20, -3, 20, -3, 0.001], [0, 0], 5)).toHaveLength(2);
  });

  it('a polyline that goes through the circle and on is cut at both ends of the chord', () => {
    const pieces = clipToCircle([-10, 3, 0, 3, 10, 3], [0, 0], 5);
    expect(pieces).toHaveLength(1);
    close(pieces[0]!, [-4, 3, 0, 3, 4, 3]);
  });

  it('hatches a square: the lines at 45°, one spacing apart, each from side to side', () => {
    const square = [[0, 0, 10, 0, 10, 10, 0, 10, 0, 0]];
    const lines = hatch(square, 1);
    // the rows of the rotated square run 10·√2 across, one spacing apart: 14 of them
    expect(lines.length).toBeGreaterThanOrEqual(13);
    expect(lines.length).toBeLessThanOrEqual(15);
    const total = lines.reduce((a, l) => a + Math.hypot(l[2]! - l[0]!, l[3]! - l[1]!), 0);
    expect(total).toBeCloseTo(100, 0); // area / spacing
    for (const l of lines) {
      expect(l[0]!).toBeGreaterThanOrEqual(-1e-9);
      expect(l[2]!).toBeLessThanOrEqual(10 + 1e-9);
      expect(Math.abs((l[3]! - l[1]!) / (l[2]! - l[0]!))).toBeCloseTo(1, 9); // 45°
    }
  });

  it('a hole in the region is not hatched (even-odd): a 10 square with a 4 square hole', () => {
    const outline = [0, 0, 10, 0, 10, 10, 0, 10, 0, 0];
    const hole = [3, 3, 7, 3, 7, 7, 3, 7, 3, 3];
    const total = hatch([outline, hole], 0.5).reduce((a, l) => a + Math.hypot(l[2]! - l[0]!, l[3]! - l[1]!), 0);
    expect(total * 0.5).toBeCloseTo(100 - 16, 0);
  });

  it('a circle is a closed polyline all at the radius', () => {
    const c = circlePolyline([5, 5], 3, 36);
    expect(c).toHaveLength(72);
    for (let i = 0; i < c.length; i += 2) expect(Math.hypot(c[i]! - 5, c[i + 1]! - 5)).toBeCloseTo(3, 9);
  });
});

describe('the plate cut through a hole (C16.3)', () => {
  let kernel: Kernel;
  let solver: PlaneGcsSolver;
  let plate: ShapeId;
  const kept: Regenerator[] = [];
  beforeAll(async () => {
    kernel = await Kernel.load();
    solver = await PlaneGcsSolver.create();
    const doc = (await readPartFile(new Uint8Array(readFileSync(new URL('../golden/locating-plate.3dbx', import.meta.url))))).doc;
    const regen = new Regenerator(kernel, solver);
    kept.push(regen);
    plate = regen.rebuild(doc).body!.shape;
  });
  afterAll(() => kept.forEach((r) => r.dispose()));

  it('along x = 40 through the Ø8 hole, seen from the left: the cut is two strips of 36 × 15 (less the chamfers) either side of the hole, 8 apart', () => {
    const v = kernel.sectionView(plate, { origin: [40, 0, 0], normal: [-1, 0, 0] }, [0, 1, 0]);
    // looking along +x with y up, the sheet's x is the model's z
    expect(v.box).toEqual({ min: [expect.closeTo(-40, 6), expect.closeTo(0, 6)], max: [expect.closeTo(40, 6), expect.closeTo(15, 6)] });
    expect(v.cut!.length).toBeGreaterThan(4);
    const points = v.cut!.flatMap((l) => Array.from({ length: l.length / 2 }, (_, i) => [l[2 * i]!, l[2 * i + 1]!] as const));
    // the hole's walls: x' = ±4 from the floor to the top
    expect(points.some(([x, y]) => Math.abs(x - 4) < 1e-6 && Math.abs(y) < 1e-6)).toBe(true);
    expect(points.some(([x, y]) => Math.abs(x + 4) < 1e-6 && Math.abs(y - 15) < 1e-6)).toBe(true);
    // none of the cut is inside the hole
    expect(points.every(([x]) => Math.abs(x) >= 4 - 1e-6)).toBe(true);
    // the hatching covers the area: 2 × 36 × 15 less the two chamfers at the outer top corners (1 × 1 each, half of it cut away) = 1079
    const spacing = 0.5;
    const area = hatch(v.cut!, spacing).reduce((a, l) => a + Math.hypot(l[2]! - l[0]!, l[3]! - l[1]!), 0) * spacing;
    expect(area).toBeGreaterThan(1079 * 0.99);
    expect(area).toBeLessThan(1079 * 1.01);
  });

  it('a section keeps only what is on the far side: nothing of the plate is seen on the near side of the plane (x < 40)', () => {
    const v = kernel.sectionView(plate, { origin: [40, 0, 0], normal: [-1, 0, 0] }, [0, 1, 0]);
    // the remaining half is x from 40 to 60, 20 deep along the view: hidden lines would show the Ø9 holes at x = 50 (45.5 to 54.5): at 5.5 to 14.5 in front of the plane — not hidden, cut-away
    expect(v.visible.length).toBeGreaterThan(5);
    const live = kernel.liveShapes;
    kernel.sectionView(plate, { origin: [40, 0, 0], normal: [-1, 0, 0] }, [0, 1, 0]);
    expect(kernel.liveShapes).toBe(live);
  });

  it('a plane that misses the part says so instead of drawing nothing', () => {
    expect(() => kernel.sectionView(plate, { origin: [500, 0, 0], normal: [-1, 0, 0] }, [0, 1, 0])).not.toThrow(); // nothing of the plate is on the viewer's side: the whole plate is seen, uncut
    const v = kernel.sectionView(plate, { origin: [500, 0, 0], normal: [-1, 0, 0] }, [0, 1, 0]);
    expect(v.cut).toEqual([]);
  });
});

describe('where the derived views go and what is drawn on the parent', () => {
  const lines = (w: number, h: number, x = 0, y = 0): ViewLines => ({ visible: [[x, y, x + w, y + h]], hidden: [], box: { min: [x, y], max: [x + w, y + h] } });
  const doc = (views: DrawingView[], sheet: Partial<DrawingDoc['sheet']> = {}): DrawingDoc => applyDrawingCommand(applyDrawingCommand(createEmptyDrawing(), { type: 'setSheet', sheet }), { type: 'insertViews', views });
  const front: DrawingView = { id: 'f', name: 'f', source: 'a.3dbx', direction: 'front' };

  it('a projected view goes on its side, a gap from the parent, in line with it: the origin of the model at the same height', () => {
    // the front view is 100 × 60 with the origin of the model at (10, 5) in it (box from (-10, -5)); the projected view to its right is 40 × 60 with its box from (-20, -5)
    const d = doc([front, { id: 'p', name: 'p', kind: 'projected', parent: 'f', side: 'right' }]);
    const placed = layoutViews(d, new Map([['f', lines(100, 60, -10, -5)], ['p', lines(40, 60, -20, -5)]]));
    const f = placed.get('f')!;
    const p = placed.get('p')!;
    expect(p.at[0] - f.at[0]).toBeCloseTo(50 + 25 + 20, 9);
    // the model's origin (0, 0) of each is at the sheet height at + (0 - centre.y)
    expect(f.at[1] - f.centre[1]).toBeCloseTo(p.at[1] - p.centre[1], 9);
  });

  it('views on one side of a parent are stacked outward', () => {
    const d = doc([front, { id: 'a', name: 'a', kind: 'projected', parent: 'f', side: 'down' }, { id: 'b', name: 'b', kind: 'projected', parent: 'f', side: 'down' }]);
    const placed = layoutViews(d, new Map([['f', lines(100, 60)], ['a', lines(100, 40)], ['b', lines(100, 30)]]));
    expect(placed.get('f')!.at[1] - placed.get('a')!.at[1]).toBeCloseTo(30 + 25 + 20, 9);
    expect(placed.get('a')!.at[1] - placed.get('b')!.at[1]).toBeCloseTo(20 + 25 + 15, 9);
  });

  it('a section goes where the viewer is in third angle and where the arrows point in first angle; the arrangement is centred with it', () => {
    const section: DrawingView = { id: 's', name: 'A', kind: 'section', parent: 'f', line: [[0, 0], [0, 10]], label: 'A' };
    const third = layoutViews(doc([front, section], { projection: 'third' }), new Map([['f', lines(100, 60)], ['s', lines(40, 60)]]));
    expect(third.get('s')!.at[0]).toBeLessThan(third.get('f')!.at[0]); // arrows to the right: on the left
    const first = layoutViews(doc([front, section], { projection: 'first' }), new Map([['f', lines(100, 60)], ['s', lines(40, 60)]]));
    expect(first.get('s')!.at[0]).toBeGreaterThan(first.get('f')!.at[0]);
    // the two are centred in the area of the sheet as one
    const x0 = Math.min(first.get('f')!.at[0] - 50, first.get('s')!.at[0] - 20);
    const x1 = Math.max(first.get('f')!.at[0] + 50, first.get('s')!.at[0] + 20);
    expect((x0 + x1) / 2).toBeCloseTo(215, 6);
  });

  it('a section whose side is taken by another view goes beside its parent instead, in line with it: the section of a front view looking down, with the top view where it would be (first angle)', () => {
    const top: DrawingView = { id: 't', name: 't', source: 'a.3dbx', direction: 'top' };
    const right: DrawingView = { id: 'r', name: 'r', source: 'a.3dbx', direction: 'right' };
    const section: DrawingView = { id: 's', name: 'A-A', kind: 'section', parent: 'f', line: [[0, 5], [100, 5]], label: 'A' };
    const raw = new Map([['f', lines(100, 60)], ['t', lines(100, 15)], ['r', lines(15, 60)], ['s', lines(100, 15)]]);
    // alone, the section is below the front view (the arrows look down)
    const alone = layoutViews(doc([front, section]), new Map([['f', raw.get('f')!], ['s', raw.get('s')!]]));
    expect(alone.get('s')!.at[1]).toBeLessThan(alone.get('f')!.at[1]);
    expect(alone.get('s')!.at[0]).toBeCloseTo(alone.get('f')!.at[0], 9);
    // with the top view there, it is to the right, a gap from the front view, at the same height (the origins of the model level)
    const placed = layoutViews(doc([front, top, right, section]), raw);
    const f = placed.get('f')!;
    const s = placed.get('s')!;
    expect(s.at[0] - f.at[0]).toBeCloseTo(50 + 25 + 50, 9);
    expect(f.at[1] - f.centre[1]).toBeCloseTo(s.at[1] - s.centre[1], 9);
    // and no two views overlap
    const all = [...placed.values()];
    for (const a of all) for (const b of all) if (a.id < b.id) expect(Math.abs(a.at[0] - b.at[0]) >= (a.w + b.w) / 2 - 1e-9 || Math.abs(a.at[1] - b.at[1]) >= (a.h + b.h) / 2 - 1e-9, `${a.id} and ${b.id}`).toBe(true);
  });

  it('a detail has the box of its circle whatever is in it, its own scale, and goes beside its parent', () => {
    const detail: DrawingView = { id: 'd', name: 'B', kind: 'detail', parent: 'f', centre: [50, 30], radius: 10, label: 'B', scale: [5, 1] };
    const raw = new Map([['f', { visible: [[0, 0, 100, 0, 100, 60, 0, 60, 0, 0]], hidden: [], box: { min: [0, 0], max: [100, 60] } } as ViewLines]]);
    const resolved = resolveLines(doc([front, detail]), new Map([...raw, ['d', null]]));
    expect(resolved.get('d')!.box).toEqual({ min: [40, 20], max: [60, 40] });
    expect(resolved.get('d')!.visible).toEqual([]); // the part of the parent's outline that is in the circle: none of it
    const placed = layoutViews(doc([front, detail]), raw);
    expect(placed.get('d')).toMatchObject({ scale: 5, w: 100, h: 100 });
    expect(placed.get('d')!.at[0]).toBeGreaterThan(placed.get('f')!.at[0]);
    // a line through the circle is cut to it
    const withLine = resolveLines(doc([front, detail]), new Map([['f', { visible: [[0, 30, 100, 30]], hidden: [], box: { min: [0, 0], max: [100, 60] } } as ViewLines]]));
    close(withLine.get('d')!.visible[0]!, [40, 30, 60, 30]);
  });

  it('draws the cutting line with arrows and the letter on the parent, and the title under the section; the hatching in thin lines', () => {
    const section: DrawingView = { id: 's', name: 'A', kind: 'section', parent: 'f', line: [[50, 0], [50, 60]], label: 'A' };
    const cut = [[0, 0, 40, 0, 40, 60, 0, 60, 0, 0]];
    const d = doc([front, section]);
    const { scene, placed } = buildScene(d, new Map([['f', lines(100, 60)], ['s', { visible: [[0, 0, 40, 0, 40, 60]], hidden: [[5, 5, 20, 5]], box: { min: [0, 0], max: [40, 60] }, cut }]]));
    const styles = scene.items.flatMap((i) => (i.kind === 'polyline' ? [i.style] : []));
    expect(styles.filter((s) => s === 'center')).toHaveLength(1); // the cutting line
    expect(styles.filter((s) => s === 'thin').length).toBeGreaterThan(20 + 10); // the hatching, and the title block's cells
    const texts = scene.items.flatMap((i) => (i.kind === 'text' ? [i.text] : []));
    expect(texts.filter((x) => x === 'A')).toHaveLength(2); // one at each end of the line
    expect(texts).toContain('A-A');
    // a section does not draw its hidden lines unless asked
    expect(scene.items.filter((i) => i.kind === 'polyline' && i.style === 'hidden')).toHaveLength(0);
    const asked = buildScene(applyDrawingCommand(d, { type: 'setView', viewId: 's', patch: { display: 'hiddenVisible' } }), new Map([['f', lines(100, 60)], ['s', { visible: [], hidden: [[5, 5, 20, 5]], box: { min: [0, 0], max: [40, 60] }, cut }]])).scene;
    expect(asked.items.filter((i) => i.kind === 'polyline' && i.style === 'hidden')).toHaveLength(1);
    // the cutting line is where the line is on the parent: x = 50 in the parent's view, at the parent's place on the sheet
    const f = placed.get('f')!;
    const chain = scene.items.find((i) => i.kind === 'polyline' && i.style === 'center')!;
    if (chain.kind === 'polyline') expect(chain.points[0]).toBeCloseTo(f.at[0] + (50 - f.centre[0]), 9);
    expect(toSvg(scene)).toContain('A-A');
  });

  it('draws the circle of a detail on its parent with its letter, and the title with its scale', () => {
    const detail: DrawingView = { id: 'd', name: 'B', kind: 'detail', parent: 'f', centre: [50, 30], radius: 10, label: 'B', scale: [5, 1] };
    const { scene } = buildScene(doc([front, detail]), new Map([['f', lines(100, 60)]]));
    expect(scene.items.some((i) => i.kind === 'polyline' && i.style === 'thin' && i.closed && i.points.length === 144)).toBe(true);
    const texts = scene.items.flatMap((i) => (i.kind === 'text' ? [i.text] : []));
    expect(texts).toContain('B');
    expect(texts).toContain('B (5:1)');
  });
});
