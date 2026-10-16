/**
 * B2.1 (2026-10-18): locking a view — model-layer validation and layout semantics. A locked view keeps the place and the scale it had
 * when it was locked: moving or rescaling it (its `at`, `scale` or `slide`) is refused, however it is asked for; what is drawn on it
 * (its name, display, label — and the dimensions and annotations) stays editable. Locking gives the view the place it is drawn at
 * now, so it no longer follows the arrangement's centring, the sheet's shift or the sheet's (or its parent's) scale.
 */
import { describe, expect, it } from 'vitest';
import {
  applyDrawingCommand,
  createEmptyDrawing,
  parseDrawing,
  serializeDrawing,
  type DrawingDoc,
  type ModelDrawingView,
  type ViewPatch,
} from '@3db/model';
import { layoutViews, scaleOf } from '@3db/drawing';

/** A drawing with the front, top and right views, as a new drawing's 標準三視圖 makes them. */
const threeViews = (): DrawingDoc =>
  applyDrawingCommand(createEmptyDrawing(), {
    type: 'insertViews',
    views: [
      { id: 'front', kind: 'model', name: 'Front', source: 'part.3dbx', direction: 'front' },
      { id: 'top', kind: 'model', name: 'Top', source: 'part.3dbx', direction: 'top' },
      { id: 'right', kind: 'model', name: 'Right', source: 'part.3dbx', direction: 'right' },
    ],
  });

const viewOf = (doc: DrawingDoc, id: string) => doc.views.find((v) => v.id === id) as ModelDrawingView;

describe('locking a view (B2.1)', () => {
  it('setView locks a view and unlockView takes it back', () => {
    const doc = threeViews();
    const locked = applyDrawingCommand(doc, { type: 'setView', viewId: 'top', patch: { locked: true } });
    expect(viewOf(locked, 'top').locked).toBe(true);
    const off = applyDrawingCommand(locked, { type: 'setView', viewId: 'top', patch: { locked: null } });
    expect(viewOf(off, 'top').locked).toBeUndefined();
    const off2 = applyDrawingCommand(locked, { type: 'setView', viewId: 'top', patch: { locked: false } });
    expect(viewOf(off2, 'top').locked).toBeUndefined();
  });

  it('a locked view refuses its place, its scale and its slide — with the lock message', () => {
    const doc = applyDrawingCommand(threeViews(), { type: 'setView', viewId: 'top', patch: { locked: true } });
    const refused: ViewPatch[] = [{ at: [10, 20] }, { scale: [2, 1] }, { slide: 5 }, { slide: null }, { at: null }, { scale: null }];
    for (const patch of refused) expect(() => applyDrawingCommand(doc, { type: 'setView', viewId: 'top', patch }), JSON.stringify(patch)).toThrow(/鎖定|locked/);
  });

  it('a locked view still takes its name, its display and its label: what is drawn on it stays editable', () => {
    const doc = applyDrawingCommand(threeViews(), { type: 'setView', viewId: 'top', patch: { locked: true } });
    const renamed = applyDrawingCommand(doc, { type: 'setView', viewId: 'top', patch: { name: 'Top (locked)', display: 'wireframe' } });
    expect(renamed.views.find((v) => v.id === 'top')).toMatchObject({ name: 'Top (locked)', display: 'wireframe', locked: true });
  });

  it('a view can be born locked, and an unlocked one can be locked by a patch that also pins it', () => {
    const born = applyDrawingCommand(threeViews(), {
      type: 'insertViews',
      views: [{ id: 'iso', kind: 'model', name: 'Iso', source: 'part.3dbx', direction: 'front', locked: true }],
    });
    expect(viewOf(born, 'iso').locked).toBe(true);
    // what the lock button does: one patch gives the view the place it is drawn at now, and locks it
    const pinned = applyDrawingCommand(threeViews(), { type: 'setView', viewId: 'right', patch: { at: [40, 50], scale: [1, 1], locked: true } });
    expect(viewOf(pinned, 'right')).toMatchObject({ at: [40, 50], scale: [1, 1], locked: true });
  });

  it('a locked view keeps its place and its scale when the sheet is shifted or rescaled', () => {
    const doc = applyDrawingCommand(threeViews(), { type: 'setView', viewId: 'right', patch: { at: [40, 50], scale: [1, 1], locked: true } });
    const moved = applyDrawingCommand(doc, { type: 'setSheet', sheet: { shift: [30, 40], scale: [2, 1] } });
    const placed = layoutViews(moved, new Map());
    // the locked view: exactly where it was pinned, at the scale it had
    expect(placed.get('right')!.at).toEqual([40, 50]);
    expect(placed.get('right')!.scale).toBe(1);
    // the arrangement's views follow the shift and the sheet's scale
    expect(scaleOf(moved, viewOf(moved, 'front'))).toEqual([2, 1]);
    const front = placed.get('front')!;
    const was = layoutViews(doc, new Map()).get('front')!;
    expect(front.at[0] - was.at[0]).toBeCloseTo(30, 6);
    expect(front.at[1] - was.at[1]).toBeCloseTo(40, 6);
    expect(front.scale).toBe(2);
  });

  it('a file written before the field, and one written with it, read the same way', () => {
    const doc = applyDrawingCommand(threeViews(), { type: 'setView', viewId: 'top', patch: { locked: true } });
    const back = parseDrawing(serializeDrawing(doc));
    expect(viewOf(back, 'top').locked).toBe(true);
    // an old file (v21, before locking): the field is absent, and that means unlocked — no migration, no schema change
    const old = JSON.parse(serializeDrawing(doc)) as Record<string, unknown>;
    delete (old.views as { locked?: boolean }[])[1]!.locked;
    expect(parseDrawing(JSON.stringify(old)).views.find((v) => v.id === 'top')!.locked).toBeUndefined();
  });
});
