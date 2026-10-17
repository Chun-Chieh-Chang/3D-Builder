/**
 * ADR 0146 (3, 6): a view projected off a corner of its parent is the isometric from that corner, as SolidWorks makes it; and a projected or section view let go
 * of its parent's line (「解除對齊」) is where it was put. Directions are worked out from the parent's axes; places from the layout.
 */
import { describe, expect, it } from 'vitest';
import { applyDrawingCommand, axesOf, cornerAxes, createEmptyDrawing, projectedAxes, rightOf, sheetUp, viewVectors, VIEW_CORNERS, type DrawingDoc, type ViewAxes, type ViewCorner, page } from '@3db/model';
import { cornerAt, layoutViews, sideAt, slideAxis, type ViewLines } from '@3db/drawing';

const unit = (v: readonly number[]) => v.map((x) => x / Math.hypot(...v));
const close = (a: readonly number[], b: readonly number[]) => a.forEach((v, i) => expect(v, `${a} vs ${b}`).toBeCloseTo(b[i]!, 9));
const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;

/** Where the viewer of a view is, as signs along the parent's right, up and toward-the-viewer: what a corner asks for. */
const signs = (parent: ViewAxes, v: ViewAxes) => {
  const back = v.dir.map((x) => -x);
  return [Math.sign(dot(back, rightOf(parent))), Math.sign(dot(back, sheetUp(parent))), Math.sign(dot(back, parent.dir.map((x) => -x)))];
};

describe('the isometric off a corner (ADR 0146, 6)', () => {
  it('off the upper right of the front view in third angle it is the model\'s own isometric', () => {
    const iso = cornerAxes(viewVectors('front'), 'upRight', 'third');
    close(iso.dir, unit(viewVectors('isometric').dir));
    close(iso.up, viewVectors('isometric').up);
  });

  it('each corner is seen from its own corner, in front of the parent; first angle from the opposite one; a true isometric (1/√3 along each)', () => {
    const want: Record<ViewCorner, [number, number]> = { upRight: [1, 1], upLeft: [-1, 1], downRight: [1, -1], downLeft: [-1, -1] };
    for (const parentName of ['front', 'top', 'right', 'back', 'bottom', 'left'] as const) {
      const parent = viewVectors(parentName);
      const seen = new Set<string>();
      for (const c of VIEW_CORNERS) {
        const third = projectedAxes(parent, c, 'third');
        expect(signs(parent, third), `${parentName} ${c}`).toEqual([...want[c], 1]);
        expect(signs(parent, projectedAxes(parent, c, 'first')), `${parentName} ${c} first`).toEqual([-want[c][0], -want[c][1], 1]);
        expect(Math.hypot(...third.dir)).toBeCloseTo(1, 12);
        for (const axis of [rightOf(parent), sheetUp(parent), parent.dir]) expect(Math.abs(dot(third.dir, axis))).toBeCloseTo(1 / Math.sqrt(3), 12);
        seen.add(third.dir.map((x) => x.toFixed(9)).join());
      }
      // four corners, four directions: not one isometric whatever the corner
      expect(seen.size).toBe(4);
    }
  });

  it('the corner of the pointer is the quadrant it is in about the view\'s middle; sideAt calls it a corner only clearly off both bands', () => {
    const parent = { at: [100, 100] as [number, number], w: 40, h: 20 };
    expect(cornerAt(parent, [150, 140])).toBe('upRight');
    expect(cornerAt(parent, [50, 140])).toBe('upLeft');
    expect(cornerAt(parent, [150, 60])).toBe('downRight');
    expect(cornerAt(parent, [50, 60])).toBe('downLeft');
    expect(sideAt(parent, [150, 140])).toBe('corner');
  });

  it('is the parent\'s: placed where it was put, turned with the parent; it must have a place, and a side or a corner it knows', () => {
    let doc = applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views: [{ id: 'f', name: 'F', source: 'p.3dbx', direction: 'front' }] });
    expect(() => applyDrawingCommand(doc, { type: 'insertViews', views: [{ id: 'i', name: 'I', kind: 'projected', parent: 'f', side: 'upRight' }] })).toThrow();
    expect(() => applyDrawingCommand(doc, { type: 'insertViews', views: [{ id: 'i', name: 'I', kind: 'projected', parent: 'f', side: 'upward' as never, at: [1, 2] }] })).toThrow();
    doc = applyDrawingCommand(doc, { type: 'insertViews', views: [{ id: 'i', name: 'I', kind: 'projected', parent: 'f', side: 'downLeft', at: [300, 60] }] });
    const lines = new Map<string, ViewLines>([['f', { visible: [], hidden: [], box: { min: [0, 0], max: [40, 20] } }], ['i', { visible: [], hidden: [], box: { min: [-10, -10], max: [30, 25] } }]]);
    expect(layoutViews(doc, lines).get('i')!.at).toEqual([300, 60]);
    expect(slideAxis(doc, page(doc).views[1]!)).toBeNull();
    close(axesOf(page(doc).views, 'third', page(doc).views[1]!)!.dir, projectedAxes(viewVectors('front'), 'downLeft', 'third').dir);
    // the parent turned to the top view: the corner view turns with it
    const turned = applyDrawingCommand(doc, { type: 'setView', viewId: 'f', patch: { direction: 'top' } });
    close(axesOf(page(turned).views, 'third', page(turned).views[1]!)!.dir, projectedAxes(viewVectors('top'), 'downLeft', 'third').dir);
    // taking its place away is refused: it is in line with nothing
    expect(() => applyDrawingCommand(doc, { type: 'setView', viewId: 'i', patch: { at: null } })).toThrow();
  });
});

describe('「解除對齊」 of a section or a projected view (ADR 0146, 3)', () => {
  const base = (): DrawingDoc =>
    applyDrawingCommand(createEmptyDrawing(), {
      type: 'insertViews',
      views: [
        { id: 'f', name: 'F', source: 'p.3dbx', direction: 'front' },
        { id: 'r', name: 'R', kind: 'projected', parent: 'f', side: 'right' },
        { id: 's', name: 'S', kind: 'section', parent: 'f', line: [[20, -5], [20, 25]], label: 'A' },
      ],
    });
  const lines = new Map<string, ViewLines>([
    ['f', { visible: [], hidden: [], box: { min: [0, 0], max: [40, 20] } }],
    ['r', { visible: [], hidden: [], box: { min: [0, 0], max: [30, 20] } }],
    ['s', { visible: [], hidden: [], box: { min: [0, 0], max: [30, 20] }, cut: [[0, 0, 1, 0, 1, 1]] }],
  ]);

  it('in line, a view slides only along its line; let go, it is wherever it is put, off that line too, and 「預設對齊」 puts it back', () => {
    for (const id of ['r', 's']) {
      const doc = base();
      const aligned = layoutViews(doc, lines).get(id)!.at;
      expect(slideAxis(doc, page(doc).views.find((v) => v.id === id)!)).not.toBeNull();
      // let go where it is, then moved off the line both ways
      const free = applyDrawingCommand(applyDrawingCommand(doc, { type: 'setView', viewId: id, patch: { at: [aligned[0], aligned[1]], slide: null } }), { type: 'setView', viewId: id, patch: { at: [aligned[0] + 37.25, aligned[1] - 81.5] } });
      const at = layoutViews(free, lines).get(id)!.at;
      expect(Math.abs(at[0] - (aligned[0] + 37.25))).toBeLessThanOrEqual(0.01);
      expect(Math.abs(at[1] - (aligned[1] - 81.5))).toBeLessThanOrEqual(0.01);
      expect(slideAxis(free, page(free).views.find((v) => v.id === id)!)).toBeNull();
      const back = applyDrawingCommand(free, { type: 'setView', viewId: id, patch: { at: null, slide: null } });
      expect(layoutViews(back, lines).get(id)!.at).toEqual(aligned);
    }
  });
});
