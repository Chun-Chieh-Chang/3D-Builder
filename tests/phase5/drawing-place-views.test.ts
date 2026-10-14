/**
 * D-V (ADR 0131): placing views on the sheet with the pointer, as SolidWorks does. The preview of a view projected or cut from another is the palette's lines
 * turned in the sheet — checked here against the kernel's own projection from those axes. A view placed with the pointer goes where the pointer is (along its
 * line, in line with its parent on the other axis), never onto its parent, and leaves every other view where it was: checked on the drawing as the commands
 * leave it, laid out again, for random pointers on every side, in both projections.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyDrawingCommand, createEmptyDrawing, type DrawingCommand, type DrawingDoc, type Feature, type Id, type ViewAxes, type ViewSide } from '@3db/model';
import { layoutViews, MIN_PLACE_GAP, previewDerived, sideAt, snapCut, turnLines, type ViewLines } from '@3db/drawing';
import { Kernel } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { Regenerator } from '@3db/regen';
import { build, extrude, face, front, rectangle, sketch } from '../phase1/builders';

describe('the preview of a view turned in the sheet, against the kernel', () => {
  let kernel: Kernel;
  let plate: ReturnType<Kernel['copy']>;
  beforeAll(async () => {
    kernel = await Kernel.load();
    const regen = new Regenerator(kernel, await PlaneGcsSolver.create());
    plate = regen.rebuild(
      build(
        sketch('s1', front, rectangle('a', 0, 0, 40, 30)),
        extrude('e1', 's1', 'boss', { type: 'blind', depth: '20' }),
        { ...sketch('s2', face('e1:cap:end')), entities: [{ id: 'p1', type: 'point', x: 10, y: 5 }] } as Feature,
        { id: 'h1', type: 'hole', name: 'h1', suppressed: false, sketch: 's2', kind: 'straight', diameter: '8', end: { type: 'blind', depth: '10' } } as Feature,
      ),
    ).body!.shape;
  });

  const right: ViewAxes = { dir: [-1, 0, 0], up: [0, 1, 0] };
  // looking the same way as the right view, with the top view's up (a section cut on the top view, seen to the left of it)
  const turnedUp: ViewAxes = { dir: [-1, 0, 0], up: [0, 0, -1] };

  it('turned lines are the lines the kernel draws from the turned axes: the same box, and every point on one of its lines', () => {
    const seen = kernel.projectView(plate, right);
    const truth = kernel.projectView(plate, turnedUp);
    const turned = turnLines(seen as ViewLines, right, turnedUp)!;
    expect(truth.box).not.toBeNull();
    for (const k of [0, 1] as const) {
      expect(turned.box!.min[k]).toBeCloseTo(truth.box!.min[k], 6);
      expect(turned.box!.max[k]).toBeCloseTo(truth.box!.max[k], 6);
    }
    const onTruth = (x: number, y: number, of: number[][]) =>
      of.some((l) => {
        for (let i = 0; i + 3 < l.length; i += 2) {
          const [ax, ay, bx, by] = [l[i]!, l[i + 1]!, l[i + 2]!, l[i + 3]!];
          const dx = bx - ax;
          const dy = by - ay;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
          if (Math.hypot(x - ax - t * dx, y - ay - t * dy) < 1e-3) return true;
        }
        return false;
      });
    // visible points on the kernel's visible lines, hidden ones (the hole behind the face) on its hidden lines
    let points = 0;
    for (const [mine, theirs] of [[turned.visible, truth.visible], [turned.hidden, truth.hidden]] as const)
      for (const l of mine)
        for (let i = 0; i < l.length; i += 2) {
          expect(onTruth(l[i]!, l[i + 1]!, theirs), `(${l[i]}, ${l[i + 1]})`).toBe(true);
          points++;
        }
    expect(turned.hidden.length).toBeGreaterThan(0);
    expect(points).toBeGreaterThan(8);
  });

  it('does not turn lines into another direction: a view looking another way is not the same lines', () => {
    const seen = kernel.projectView(plate, right) as ViewLines;
    expect(turnLines(seen, right, { dir: [0, -1, 0], up: [0, 0, -1] })).toBeNull();
    expect(turnLines(seen, right, right)).toBe(seen);
  });
});

describe('the side the pointer asks for', () => {
  const parent = { at: [100, 100] as [number, number], w: 40, h: 20 };
  it('inside the view nothing; beside it that side; off a corner the isometric; not a number nothing', () => {
    expect(sideAt(parent, [105, 103])).toBeNull();
    expect(sideAt(parent, [160, 104])).toBe('right');
    expect(sideAt(parent, [40, 96])).toBe('left');
    expect(sideAt(parent, [98, 150])).toBe('up');
    expect(sideAt(parent, [102, 40])).toBe('down');
    expect(sideAt(parent, [170, 160])).toBe('corner');
    // just past the band of the side it is nearer: still that side, not the corner
    expect(sideAt(parent, [170, 112])).toBe('right');
    expect(sideAt(parent, [Number.NaN, 100])).toBeNull();
  });
});

/** A drawing of three model views laid out together, with lines that are only boxes (the layout reads nothing else). */
function drawing(projection: 'first' | 'third'): { doc: DrawingDoc; lines: Map<Id, ViewLines | null> } {
  let doc = createEmptyDrawing();
  doc = applyDrawingCommand(doc, { type: 'setSheet', sheet: { projection } });
  doc = applyDrawingCommand(doc, {
    type: 'insertViews',
    views: (['front', 'top', 'right'] as const).map((direction, i) => ({ id: `view${i + 1}`, name: direction, source: 'plate.3dbx', direction })),
  });
  const box = (w: number, h: number): ViewLines => ({ visible: [], hidden: [], box: { min: [-w / 2, -h / 2], max: [w / 2, h / 2] } });
  return { doc, lines: new Map<Id, ViewLines | null>([['view1', box(120, 15)], ['view2', box(120, 80)], ['view3', box(80, 15)]]) };
}

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('a projected view placed with the pointer', () => {
  it('goes where the pointer is along its line, in line with its parent, never onto it, and moves nothing else (200 random pointers, both projections)', () => {
    const r = rng(7);
    const sides: ViewSide[] = ['right', 'left', 'up', 'down'];
    let clamped = 0;
    let free = 0;
    for (let k = 0; k < 200; k++) {
      const projection = k % 2 ? 'first' : 'third';
      const { doc, lines } = drawing(projection);
      const parentId = (['view1', 'view2', 'view3'] as const)[Math.floor(r() * 3)]!;
      const side = sides[Math.floor(r() * 4)]!;
      const before = layoutViews(doc, lines);
      const parent = before.get(parentId)!;
      const ghostLines: ViewLines = { visible: [], hidden: [], box: { min: [-10 - r() * 40, -5 - r() * 20], max: [10 + r() * 40, 5 + r() * 20] } };
      // a pointer anywhere on that side of the parent, sometimes right against it (then the view is kept off the parent)
      const reach = (side === 'left' || side === 'right' ? parent.w : parent.h) / 2 + r() * 150;
      const across = (r() - 0.5) * 60;
      const pointer: [number, number] =
        side === 'right' ? [parent.at[0] + reach, parent.at[1] + across] : side === 'left' ? [parent.at[0] - reach, parent.at[1] + across] : side === 'up' ? [parent.at[0] + across, parent.at[1] + reach] : [parent.at[0] + across, parent.at[1] - reach];
      const g = previewDerived(doc, lines, { id: 'ghost', name: '', kind: 'projected', parent: parentId, side }, ghostLines, pointer)!;
      expect(g, `k=${k}`).not.toBeNull();
      // the drawing as the commands leave it, laid out again: that is what the user sees after the click
      const commands: DrawingCommand[] = [{ type: 'insertViews', views: [{ id: 'view9', name: 'p', kind: 'projected', parent: parentId, side, ...(g.slide ? { slide: g.slide } : {}) }] }];
      if (g.shift) commands.push({ type: 'setSheet', sheet: { shift: g.shift } });
      const after = applyDrawingCommand(doc, { type: 'batch', commands });
      const laid = layoutViews(after, new Map(lines).set('view9', ghostLines));
      for (const [id, p] of before) {
        expect(laid.get(id)!.at[0], `k=${k} ${id} x`).toBeCloseTo(p.at[0], 1);
        expect(laid.get(id)!.at[1], `k=${k} ${id} y`).toBeCloseTo(p.at[1], 1);
      }
      const placed = laid.get('view9')!;
      // the preview is where it ends up
      expect(placed.at[0]).toBeCloseTo(g.placed.at[0], 1);
      expect(placed.at[1]).toBeCloseTo(g.placed.at[1], 1);
      const axis = side === 'left' || side === 'right' ? 0 : 1;
      const gap = Math.abs(placed.at[axis] - parent.at[axis]) - (axis === 0 ? parent.w + placed.w : parent.h + placed.h) / 2;
      expect(gap, `k=${k} gap`).toBeGreaterThanOrEqual(MIN_PLACE_GAP - 0.02);
      if (Math.abs(placed.at[axis] - pointer[axis]) < 0.02) free++;
      else {
        // kept off the parent: then exactly at the least gap
        expect(gap).toBeCloseTo(MIN_PLACE_GAP, 1);
        clamped++;
      }
    }
    // both cases were reached
    expect(free).toBeGreaterThan(20);
    expect(clamped).toBeGreaterThan(5);
  });

  it('a pointer that is not a number places nothing', () => {
    const { doc, lines } = drawing('first');
    expect(previewDerived(doc, lines, { id: 'g', name: '', kind: 'projected', parent: 'view1', side: 'right' }, lines.get('view1')!, [Number.NaN, 3])).toBeNull();
  });
});

describe('the cutting line snaps', () => {
  const features = [
    { type: 'circle' as const, ref: { kind: 'face' as const, name: 'h' }, centre: [-50, 30] as [number, number], radius: 4, convex: false, full: true, outward: 0 },
    { type: 'plane' as const, ref: { kind: 'face' as const, name: 'p' }, axis: 'x' as const, coord: 20, area: 100 },
  ];
  const box = { min: [-60, -40] as [number, number], max: [60, 40] as [number, number] };
  it('to the middle of a hole, an edge-on plane or the middle of the view, the nearest within reach; else where it is', () => {
    expect(snapCut(features, box, -49.2, true, 1)).toEqual({ coord: -50, snapped: true });
    expect(snapCut(features, box, 20.5, true, 1)).toEqual({ coord: 20, snapped: true });
    expect(snapCut(features, box, 0.6, true, 1)).toEqual({ coord: 0, snapped: true });
    expect(snapCut(features, box, 10, true, 1)).toEqual({ coord: 10, snapped: false });
    // a horizontal cut reads the y of the hole, and planes across y only
    expect(snapCut(features, box, 29.5, false, 1)).toEqual({ coord: 30, snapped: true });
    expect(snapCut(features, box, 20.5, false, 1)).toEqual({ coord: 20.5, snapped: false });
  });
  it('refuses a place that is not a number', () => {
    expect(() => snapCut(features, box, Number.NaN, true, 1)).toThrow();
  });
});
