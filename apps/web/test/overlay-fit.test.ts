/**
 * 「全部顯示」 while a sketch is edited (found by tests/e2e/manual-c7.js after ADR 0170): the sketch's axes and the grid are drawn to the edges of what is
 * on screen, so counted in the fit they made it take in the whole view — and the next drawing, of the wider view, was larger again: every fit zoomed
 * further out (the block of c7 shrank until a hidden edge and a top edge were a few pixels apart, and the click took the wrong one). What is drawn to the
 * view's edges is left out of the fit; what the sketch is made of counts.
 */
import { describe, expect, it } from 'vitest';
import { createEmptyPart, type SketchFeature } from '@3db/model';
import { buildOverlayObjects, overlayFitBox, type PlaneFrame } from '@3db/render';
import { buildOverlay, gridCurves } from '../src/sketcher/overlay';
import type { ControllerView } from '../src/sketcher/controller';

const FRONT: PlaneFrame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const sketch = (): SketchFeature => ({ ...(createEmptyPart().features[0] as SketchFeature), entities: [], constraints: [] });
const view = (grid: number | null): ControllerView =>
  ({ tool: 'select', selection: [], hover: null, snap: null, inference: null, inferLine: null, quickSnap: null, grid, preview: [], picks: [], cursor: null, hint: '', message: null, options: {} }) as unknown as ControllerView;

describe('what 「全部顯示」 takes in while a sketch is edited', () => {
  it('the axes and the grid, as large as the view, are marked to be left out', () => {
    const visible = { min: [-500, -400] as [number, number], max: [500, 400] as [number, number] };
    const o = buildOverlay(FRONT, sketch(), null, view(10), 1, { showRelations: false, dimensionPreview: null, visible });
    const wide = o.curves.filter((c) => c.points.some((p) => Math.abs(p[0]) >= 500 || Math.abs(p[1]) >= 400));
    expect(wide.length).toBeGreaterThan(2); // both axes and grid lines
    expect(wide.every((c) => c.fit === false)).toBe(true);
    expect(gridCurves(visible, 10, 1).every((c) => c.fit === false)).toBe(true);
  });

  it('the fit box is what the sketch is made of: the origin mark, not the axes across a 1000-wide view', () => {
    const visible = { min: [-500, -400] as [number, number], max: [500, 400] as [number, number] };
    const o = buildOverlay(FRONT, sketch(), null, view(10), 0.1, { showRelations: false, dimensionPreview: null, visible });
    const group = buildOverlayObjects(o, 0.1);
    const box = overlayFitBox(group);
    // the origin's own short axes (14 px at 0.1 mm a pixel) and its point: within a couple of millimetres, not ±500
    expect(box.max.x - box.min.x).toBeLessThan(5);
    expect(box.max.y - box.min.y).toBeLessThan(5);
  });

  it('reverse check: counting every line (as before) the box is the whole view', () => {
    const visible = { min: [-500, -400] as [number, number], max: [500, 400] as [number, number] };
    const o = buildOverlay(FRONT, sketch(), null, view(10), 0.1, { showRelations: false, dimensionPreview: null, visible });
    const group = buildOverlayObjects({ ...o, curves: o.curves.map(({ fit: _fit, ...c }) => c) }, 0.1);
    const box = overlayFitBox(group);
    expect(box.max.x - box.min.x).toBeGreaterThanOrEqual(1000);
  });
});
