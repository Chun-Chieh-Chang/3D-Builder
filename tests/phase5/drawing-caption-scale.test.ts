/**
 * ADR 0261, drawing rule V5 (ISO 5455): a view drawn at a scale other than the sheet's says its scale in its caption. A detail view already did; a section, an
 * isometric or any other view did not, so a reader took it for the sheet's scale. A caption written by the user is left as written.
 */
import { describe, expect, it } from 'vitest';
import type { DrawingView, Scale } from '@3db/model';
import { viewCaptionItem, type PlacedView } from '@3db/drawing';

const own: PlacedView = { id: 'v', at: [100, 100], scale: 1, w: 40, h: 20, centre: [0, 0] };
const model = (extra: Record<string, unknown> = {}): DrawingView => ({ id: 'v', name: 'Front', source: 'x.3dbx', direction: 'front', ...extra }) as DrawingView;
const caption = (v: DrawingView, scale: Scale, sheet: Scale) => viewCaptionItem(v, own, scale, sheet).text;

describe('the scale in a view caption', () => {
  it('a view at the sheet\'s scale says nothing of it', () => {
    expect(caption(model(), [1, 1], [1, 1])).toBe('Front');
    expect(caption(model(), [5, 1], [5, 1])).toBe('Front');
  });

  it('a view at another scale says it, whichever way it differs', () => {
    expect(caption(model(), [2, 1], [1, 1])).toBe('Front (2:1)');
    expect(caption(model(), [1, 2], [1, 1])).toBe('Front (1:2)');
  });

  it('omits the automatic scale for model and corner-projected isometric views', () => {
    const iso = model({ direction: 'isometric', name: 'Isometric' });
    const projected: DrawingView = { id: 'p', kind: 'projected', parent: 'f', side: 'upRight', name: 'Corner', at: [100, 100] };
    expect(caption(iso, [29, 10], [1, 1])).toBe('Isometric');
    expect(caption(projected, [29, 10], [1, 1])).toBe('Corner');
    expect(caption({ ...projected, side: 'right' as const }, [29, 10], [1, 1])).toBe('Corner (29:10)');
    expect(caption({ ...iso, caption: { text: '<NAME> (<SCALE>)' } }, [29, 10], [1, 1])).toBe('Isometric (29:10)');
  });

  it('a section at another scale: A-A (5:1)', () => {
    const section = model({ kind: 'section', parent: 'p', line: [[0, 0], [1, 0]], label: 'A' });
    expect(caption(section, [5, 1], [1, 1])).toBe('A-A (5:1)');
    expect(caption(section, [1, 1], [1, 1])).toBe('A-A');
  });

  it('a detail says its scale once (its caption always did)', () => {
    const detail = model({ kind: 'detail', parent: 'p', centre: [0, 0], radius: 2, label: 'C' });
    expect(caption(detail, [10, 1], [2, 1])).toBe('C (10:1)');
    expect(caption(detail, [2, 1], [2, 1])).toBe('C (2:1)');
  });

  it('a caption the user wrote is left as written', () => {
    expect(caption(model({ caption: { text: 'Top, enlarged' } }), [5, 1], [1, 1])).toBe('Top, enlarged');
    expect(caption(model({ caption: { text: '<NAME> <SCALE>' } }), [5, 1], [1, 1])).toBe('Front 5:1');
  });

  it('without the sheet\'s scale given, the caption is as it was', () => {
    expect(viewCaptionItem(model(), own, [5, 1]).text).toBe('Front');
  });
});
