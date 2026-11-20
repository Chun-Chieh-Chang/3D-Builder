import { describe, expect, it } from 'vitest';
import { applyDrawingCommand, createEmptyDrawing, parseDrawing, serializeDrawing, type DrawingDoc } from '@3db/model';
import { buildScene, type ViewLines } from '@3db/drawing';

function makeDrawingWithDetail(): { doc: DrawingDoc; lines: Map<string, ViewLines> } {
  let doc = createEmptyDrawing('ISO');
  doc = applyDrawingCommand(doc, {
    type: 'insertViews',
    views: [
      { id: 'v1', name: '前視', source: 'part.3dbx', direction: 'front' },
      { id: 'v2', kind: 'detail', name: '局部放大 B', parent: 'v1', centre: [0, 2], radius: 6, label: 'B', scale: [6, 1], at: [90, 180] },
    ],
  });
  const lines = new Map<string, ViewLines>([
    [
      'v1',
      {
        visible: [[-5, 0, 5, 0, 5, 25, -5, 25, -5, 0]],
        hidden: [],
        box: { min: [-5, 0], max: [5, 25] },
      },
    ],
  ]);
  return { doc, lines };
}

describe('detail circle labelOffset (draggable B marker)', () => {
  it('moves the detail label in scene coordinates by labelOffset and resets with null', () => {
    const { doc: base, lines } = makeDrawingWithDetail();
    const s0 = buildScene(base, lines).scene;
    const t0 = s0.items.find((i) => i.kind === 'text' && i.detailLabel === 'v2');
    expect(t0 && t0.kind === 'text').toBe(true);
    if (!t0 || t0.kind !== 'text') return;

    const moved = applyDrawingCommand(base, { type: 'setView', viewId: 'v2', patch: { labelOffset: [-14.5, 6.25] } });
    const s1 = buildScene(moved, lines).scene;
    const t1 = s1.items.find((i) => i.kind === 'text' && i.detailLabel === 'v2');
    expect(t1 && t1.kind === 'text').toBe(true);
    if (!t1 || t1.kind !== 'text') return;
    expect(t1.at[0] - t0.at[0]).toBeCloseTo(-14.5, 6);
    expect(t1.at[1] - t0.at[1]).toBeCloseTo(6.25, 6);

    // Round-trip through serialize / parse
    const parsed = parseDrawing(serializeDrawing(moved));
    const v2 = parsed.pages[0]!.views.find((v) => v.id === 'v2');
    expect(v2 && v2.kind === 'detail' ? v2.labelOffset : null).toEqual([-14.5, 6.25]);

    // Reset with null
    const reset = applyDrawingCommand(moved, { type: 'setView', viewId: 'v2', patch: { labelOffset: null } });
    const s2 = buildScene(reset, lines).scene;
    const t2 = s2.items.find((i) => i.kind === 'text' && i.detailLabel === 'v2');
    expect(t2 && t2.kind === 'text' ? t2.at : null).toEqual(t0.at);
  });

  it('rejects non-finite labelOffset and rejects labelOffset on non-detail views', () => {
    const { doc } = makeDrawingWithDetail();
    expect(() => applyDrawingCommand(doc, { type: 'setView', viewId: 'v2', patch: { labelOffset: [Number.NaN, 0] } })).toThrow();
    expect(() => applyDrawingCommand(doc, { type: 'setView', viewId: 'v2', patch: { labelOffset: [0, Number.POSITIVE_INFINITY] } })).toThrow();
    expect(() => applyDrawingCommand(doc, { type: 'setView', viewId: 'v1', patch: { labelOffset: [1, 2] } })).toThrow();
  });
});
