/**
 * D-I1a (docs/drawing-interaction-gap-plan.md §9, ADR 0130): choosing several things on the sheet at once. A change to all of them is one command (`batch`):
 * one undo step, and wholly or not at all. A box dragged over the paper chooses, as SolidWorks does, what lies wholly inside it (dragged to the right) or what
 * it touches (dragged to the left); the geometry is checked against an oracle that knows nothing of how it is worked out (dense sampling), on random boxes.
 */
import { describe, expect, it } from 'vitest';
import { applyDrawingCommand, CommandError, createEmptyDrawing, DrawingHistory, type Dimension, type DrawingDoc, page } from '@3db/model';
import { dimensionsInBox, itemsInBox, rectInBox, segmentTouches, selectionBox, type SceneItem, type SheetRect } from '@3db/drawing';

const ref = (name: string) => ({ kind: 'face' as const, name });

/** A drawing with one view and three dimensions: two linear ones and an angle. */
function drawing(): DrawingDoc {
  let doc = createEmptyDrawing();
  doc = applyDrawingCommand(doc, { type: 'insertViews', views: [{ id: 'view1', name: 'Front', source: 'plate.3dbx', direction: 'front' }] });
  const dims: Dimension[] = [
    { id: 'dim1', view: 'view1', kind: 'linear', a: ref('a'), b: ref('b'), orientation: 'horizontal', offset: -10 },
    { id: 'dim2', view: 'view1', kind: 'linear', a: ref('c'), b: ref('d'), orientation: 'vertical', offset: 10 },
    { id: 'dim3', view: 'view1', kind: 'angle', a: ref('e'), b: ref('f'), arc: 18 },
  ];
  return applyDrawingCommand(doc, { type: 'insertDimensions', dimensions: dims });
}

describe('several changes as one step (batch)', () => {
  it('the same tolerance on two dimensions is one undo step', () => {
    const h = new DrawingHistory(drawing());
    h.execute({ type: 'batch', commands: ['dim1', 'dim2'].map((id) => ({ type: 'setDimension', dimensionId: id, patch: { tolerance: { type: 'bilateral', upper: 0.05, lower: -0.05 } } })) });
    expect(page(h.doc).dimensions.filter((d) => d.tolerance?.type === 'bilateral').map((d) => d.id)).toEqual(['dim1', 'dim2']);
    h.undo();
    expect(page(h.doc).dimensions.every((d) => d.tolerance === undefined)).toBe(true);
    expect(h.canUndo).toBe(false);
    h.redo();
    expect(page(h.doc).dimensions.filter((d) => d.tolerance).length).toBe(2);
  });

  it('is done wholly or not at all: a fit class on the angle refuses the whole batch and the document is as it was', () => {
    const doc = drawing();
    const fit = (id: string) => ({ type: 'setDimension' as const, dimensionId: id, patch: { tolerance: { type: 'fit' as const, fit: 'H7' } } });
    expect(() => applyDrawingCommand(doc, { type: 'batch', commands: [fit('dim1'), fit('dim2'), fit('dim3')] })).toThrow(CommandError);
    const h = new DrawingHistory(doc);
    expect(() => h.execute({ type: 'batch', commands: [fit('dim1'), fit('dim3')] })).toThrow(CommandError);
    expect(h.doc).toBe(doc);
    expect(h.canUndo).toBe(false);
  });

  it('each command sees what the ones before it did; deleting a view after its dimensions are deleted is fine, the other way round is refused', () => {
    const doc = drawing();
    const ok = applyDrawingCommand(doc, { type: 'batch', commands: [{ type: 'deleteDimensions', dimensionIds: ['dim1'] }, { type: 'deleteViews', viewIds: ['view1'] }] });
    expect(page(ok).views).toEqual([]);
    expect(page(ok).dimensions).toEqual([]);
    // the view takes its dimensions with it, so asking for one of them afterwards names a dimension that is not there
    expect(() => applyDrawingCommand(doc, { type: 'batch', commands: [{ type: 'deleteViews', viewIds: ['view1'] }, { type: 'deleteDimensions', dimensionIds: ['dim1'] }] })).toThrow(CommandError);
  });

  it('refuses an empty batch and a batch inside a batch, explicitly', () => {
    const doc = drawing();
    expect(() => applyDrawingCommand(doc, { type: 'batch', commands: [] })).toThrow(CommandError);
    expect(() => applyDrawingCommand(doc, { type: 'batch', commands: [{ type: 'batch', commands: [{ type: 'deleteDimensions', dimensionIds: ['dim1'] }] }] })).toThrow(CommandError);
  });
});

// ---------------------------------------------------------------- the box

/** A deterministic random number generator (mulberry32), so that a failure can be run again. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const inRect = (r: SheetRect, x: number, y: number) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
/** The oracle for a segment: does any of a thousand points along it fall in the rectangle (and is the segment clear of its edges by more than the step, when not)? */
function sampledTouches(r: SheetRect, a: [number, number], b: [number, number]): boolean | 'edge' {
  const n = 1000;
  let hit = false;
  let close = false;
  const step = Math.hypot(b[0] - a[0], b[1] - a[1]) / n;
  for (let i = 0; i <= n; i++) {
    const x = a[0] + ((b[0] - a[0]) * i) / n;
    const y = a[1] + ((b[1] - a[1]) * i) / n;
    if (inRect(r, x, y)) hit = true;
    else if (x >= r.x0 - step && x <= r.x1 + step && y >= r.y0 - step && y <= r.y1 + step) close = true;
  }
  return hit ? true : close ? 'edge' : false;
}

describe('the selection box', () => {
  it('dragged to the right is a window, to the left a crossing; a point that is not a number is refused', () => {
    expect(selectionBox([10, 10], [50, 40])).toEqual({ rect: { x0: 10, y0: 10, x1: 50, y1: 40 }, crossing: false });
    expect(selectionBox([50, 40], [10, 10])).toEqual({ rect: { x0: 10, y0: 10, x1: 50, y1: 40 }, crossing: true });
    expect(() => selectionBox([Number.NaN, 0], [10, 10])).toThrow();
    expect(() => selectionBox([0, 0], [Infinity, 10])).toThrow();
  });

  it('a segment touches a box exactly when the dense sampling says so (200 random segments and boxes, 0 differences)', () => {
    const r = rng(1);
    let checked = 0;
    for (let k = 0; k < 200; k++) {
      const box = selectionBox([r() * 100, r() * 100], [r() * 100, r() * 100]).rect;
      const a: [number, number] = [r() * 120 - 10, r() * 120 - 10];
      const b: [number, number] = [r() * 120 - 10, r() * 120 - 10];
      const oracle = sampledTouches(box, a, b);
      if (oracle === 'edge') continue; // grazing a corner closer than the sampling step: the oracle cannot tell
      expect(segmentTouches(box, a, b), `segment ${a} → ${b}, box ${JSON.stringify(box)}`).toBe(oracle);
      checked++;
    }
    expect(checked).toBeGreaterThan(150);
  });

  it('a window chooses a dimension only when every point of it is inside; a crossing when any segment or text touches (200 random boxes, 0 differences)', () => {
    const r = rng(2);
    // six dimensions, each a cluster of random polylines and a text within 20 mm of its own middle, as a dimension is drawn round what it measures
    const groups = ['dim1', 'dim2', 'dim3', 'dim4', 'dim5', 'dim6'];
    const items: SceneItem[] = [];
    for (const group of groups) {
      const [cx, cy] = [10 + r() * 80, 10 + r() * 80];
      const near = () => [cx + (r() - 0.5) * 20, cy + (r() - 0.5) * 20];
      for (let j = 0; j < 3; j++) items.push({ kind: 'polyline', points: [...near(), ...near(), ...near()], style: 'dimension', group } as SceneItem);
      items.push({ kind: 'text', at: near() as [number, number], text: '12.5', height: 3.5, anchor: 'center', group } as SceneItem);
    }
    const seen = { window: [0, 0], crossing: [0, 0] }; // [chosen, not chosen]: the random boxes have to reach both outcomes of both kinds
    for (let k = 0; k < 200; k++) {
      // a lower-left corner and an upper-right one; dragged from the first to the second (to the right) on even k, the other way round on odd k
      const lo: [number, number] = [r() * 60 - 5, r() * 60 - 5];
      const hi: [number, number] = [lo[0] + 5 + r() * 60, lo[1] + 5 + r() * 60];
      const { rect, crossing } = k % 2 === 0 ? selectionBox(lo, hi) : selectionBox(hi, lo);
      const got = dimensionsInBox(items, rect, crossing);
      for (const group of groups) {
        const mine = items.filter((i) => i.group === group);
        const polys = mine.filter((i): i is Extract<SceneItem, { kind: 'polyline' }> => i.kind === 'polyline');
        let expected: boolean;
        if (!crossing) {
          expected = polys.every((p) => Array.from({ length: p.points.length / 2 }, (_, i) => inRect(rect, p.points[2 * i]!, p.points[2 * i + 1]!)).every(Boolean)) && itemsInBox(mine.filter((i) => i.kind === 'text'), rect, false);
        } else {
          const segs = polys.flatMap((p) => Array.from({ length: p.points.length / 2 - 1 }, (_, i) => sampledTouches(rect, [p.points[2 * i]!, p.points[2 * i + 1]!], [p.points[2 * i + 2]!, p.points[2 * i + 3]!])));
          if (segs.includes('edge') && !segs.includes(true)) continue; // undecidable by sampling
          expected = segs.includes(true) || itemsInBox(mine.filter((i) => i.kind === 'text'), rect, true);
        }
        expect(got.includes(group), `${group} in ${JSON.stringify(rect)} (${crossing ? 'crossing' : 'window'})`).toBe(expected);
        seen[crossing ? 'crossing' : 'window'][expected ? 0 : 1]!++;
      }
    }
    expect(Math.min(...seen.window, ...seen.crossing), JSON.stringify(seen)).toBeGreaterThan(0);
  });

  it('a table or a symbol box: wholly inside for a window, overlapping for a crossing', () => {
    const rect = { x0: 0, y0: 0, x1: 50, y1: 50 };
    expect(rectInBox({ x: 10, y: 10, w: 20, h: 20 }, rect, false)).toBe(true);
    expect(rectInBox({ x: 40, y: 10, w: 20, h: 20 }, rect, false)).toBe(false);
    expect(rectInBox({ x: 40, y: 10, w: 20, h: 20 }, rect, true)).toBe(true);
    expect(rectInBox({ x: 60, y: 10, w: 20, h: 20 }, rect, true)).toBe(false);
  });

  it('an empty set of items is never chosen', () => {
    expect(itemsInBox([], { x0: -1e9, y0: -1e9, x1: 1e9, y1: 1e9 }, false)).toBe(false);
    expect(itemsInBox([], { x0: -1e9, y0: -1e9, x1: 1e9, y1: 1e9 }, true)).toBe(false);
  });
});
