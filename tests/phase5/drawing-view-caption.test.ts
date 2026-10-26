import { expect, it } from 'vitest';
import { applyDrawingCommand, createEmptyDrawing, DrawingHistory, DRAWING_SCHEMA_VERSION, page, parseDrawing, serializeDrawing, type DrawingView, type ViewCaption } from '@3db/model';
import { buildScene, viewCaptionItem, type PlacedView, type SceneText, type ViewLines } from '@3db/drawing';
const views: DrawingView[] = [
  { id: 'f', name: 'front', source: 'part.3dbx', direction: 'front' },
  { id: 'p', name: 'projection', kind: 'projected', parent: 'f', side: 'right' },
  { id: 's', name: 'section', kind: 'section', parent: 'f', line: [[-10, 0], [10, 0]], label: 'A' },
  { id: 'd', name: 'detail', kind: 'detail', parent: 's', centre: [0, 0], radius: 5, scale: [5, 1], label: 'B' },
];
const doc = () => applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views });
const placed: PlacedView = { id: 'f', at: [100, 100], centre: [0, 0], w: 40, h: 30, scale: 1 };
it('100 paper-space offsets move all view captions independently of view placement and scale', () => {
  for (let i = 0; i < 100; i++) for (const v of views) {
    const offset: [number, number] = [i * 1.37 - 60, i * -0.79 + 40];
    const plain = viewCaptionItem(v, placed, [5, 1]);
    for (const scale of [0.5, 3]) {
      const item = viewCaptionItem({ ...v, caption: { offset } }, { ...placed, scale }, [5, 1]);
      expect(item.at[0] - plain.at[0]).toBeCloseTo(offset[0], 10);
      expect(item.at[1] - plain.at[1]).toBeCloseTo(offset[1], 10);
      expect(item.viewCaption).toBe(v.id);
      expect(item.text).toBe(plain.text);
    }
  }
});
it('names, section letters and detail scale remain associative inside custom caption templates', () => {
  expect(viewCaptionItem(views[0]!, placed, [1, 1]).text).toBe('front');
  expect(viewCaptionItem(views[2]!, placed, [1, 1]).text).toBe('A-A');
  expect(viewCaptionItem(views[3]!, placed, [5, 1]).text).toBe('B (5:1)');
  const h = new DrawingHistory(doc());
  h.execute({ type: 'setView', viewId: 'd', patch: { caption: { text: 'Detail <LABEL> / <SCALE>', offset: [12, -8] } } });
  h.execute({ type: 'setView', viewId: 'd', patch: { label: 'C', scale: [4, 1] } });
  expect(viewCaptionItem(page(h.doc).views[3]!, placed, [4, 1]).text).toBe('Detail C / 4:1');
  h.undo(); expect(page(h.doc).views[3]!).toMatchObject({ label: 'B', caption: { offset: [12, -8] } });
  h.undo(); expect(page(h.doc).views[3]!.caption).toBeUndefined();
  h.redo(); expect(page(h.doc).views[3]!.caption?.text).toContain('<SCALE>');
  h.execute({ type: 'setView', viewId: 'd', patch: { locked: true } });
  h.execute({ type: 'setView', viewId: 'd', patch: { caption: { offset: [-7, 9] } } });
  expect(page(h.doc).views[3]!.caption?.offset).toEqual([-7, 9]);
  h.execute({ type: 'setView', viewId: 'd', patch: { caption: null } });
  expect(page(h.doc).views[3]!.caption).toBeUndefined();
});
it('rejects malformed caption text/offsets atomically and during file reading', () => {
  const before = serializeDrawing(doc());
  const invalid = [null, [], { text: '' }, { text: 3 }, { offset: [NaN, 0] }, { offset: [0, Infinity] }, { offset: [0] }, { offset: 'bad' }];
  for (const caption of invalid) {
    if (caption !== null) expect(() => applyDrawingCommand(doc(), { type: 'setView', viewId: 'f', patch: { caption: caption as ViewCaption } })).toThrow();
    const raw = JSON.parse(before); raw.pages[0].views[0].caption = caption;
    expect(() => parseDrawing(JSON.stringify(raw))).toThrow();
  }
  expect(serializeDrawing(doc())).toBe(before);
});
it('persists captions in v31 and migrates v30 without changing projection or label placement', () => {
  const changed = applyDrawingCommand(doc(), { type: 'setView', viewId: 'f', patch: { caption: { text: 'My <NAME>', offset: [-8, 9] } } });
  expect(DRAWING_SCHEMA_VERSION).toBeGreaterThanOrEqual(31);
  expect(parseDrawing(serializeDrawing(changed))).toEqual(changed);
  const old = JSON.parse(serializeDrawing(doc())); old.schemaVersion = 30; old.pages[0].sheet.projection = 'first';
  const read = parseDrawing(JSON.stringify(old));
  expect(read.schemaVersion).toBe(DRAWING_SCHEMA_VERSION);
  expect(page(read).sheet.projection).toBe('first');
  expect(page(read).views.every(v => !v.caption)).toBe(true);
});
it('scene emits exactly one independently identified caption per view', () => {
  const geometry: ViewLines = { visible: [[-10, -10, 10, -10, 10, 10, -10, 10, -10, -10]], hidden: [], cut: [], box: { min: [-10, -10], max: [10, 10] } };
  const result = buildScene(doc(), new Map(views.map(v => [v.id, geometry])), new Map(), new Map(), new Map());
  const items = result.scene.items.filter((i): i is SceneText => i.kind === 'text' && !!i.viewCaption);
  expect(items.map(i => i.viewCaption)).toEqual(views.map(v => v.id));
  expect(items.map(i => i.text)).toEqual(['front', 'projection', 'A-A', 'B (5:1)']);
});
