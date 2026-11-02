import { describe, expect, it } from 'vitest';
import { applyDrawingCommand, createEmptyDrawing, parseDrawing, serializeDrawing, page, DRAWING_SCHEMA_VERSION, type NoteAnnotation } from '@3db/model';
import { annotationItems, textWidthMm, toSvg, toDxf, readDxf, toPdf, readPdf, type PlacedView } from '@3db/drawing';

const placed: PlacedView = { id: 'v', at: [80, 80], centre: [0, 0], w: 30, h: 30, scale: 1 };
const note: NoteAnnotation = { id: 'n', kind: 'note', view: 'v', at: [0, 0], text: 'A\n較長文字', height: 3.5, leader: [30, 10] };

describe('fitted note outlines', () => {
 it('validates, serializes, edits and removes the selected outline', () => {
  let doc = applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views: [{ id: 'v', name: 'front', source: 'p.3dbx', direction: 'front' }] });
  doc = applyDrawingCommand(doc, { type: 'insertAnnotations', annotations: [{ ...note, enclosure: 'circle' }] });
  expect(page(parseDrawing(serializeDrawing(doc))).annotations[0]).toMatchObject({ enclosure: 'circle' });
  expect(parseDrawing(serializeDrawing(doc)).schemaVersion).toBe(DRAWING_SCHEMA_VERSION);
  doc = applyDrawingCommand(doc, { type: 'setAnnotation', annotationId: 'n', patch: { enclosure: 'rounded' } });
  expect(page(doc).annotations[0]).toMatchObject({ enclosure: 'rounded' });
  expect(() => applyDrawingCommand(doc, { type: 'setAnnotation', annotationId: 'n', patch: { enclosure: 'square' } })).toThrow();
  doc = applyDrawingCommand(doc, { type: 'setAnnotation', annotationId: 'n', patch: { enclosure: null } });
  expect(page(doc).annotations[0]).not.toHaveProperty('enclosure');
  const legacy = JSON.parse(serializeDrawing(doc));
  legacy.schemaVersion = 34;
  expect(page(parseDrawing(JSON.stringify(legacy))).annotations[0]).not.toHaveProperty('enclosure');
  const oldEllipse = JSON.parse(serializeDrawing(doc));
  oldEllipse.schemaVersion = 35;
  oldEllipse.pages[0].annotations[0].enclosure = 'ellipse';
  expect(page(parseDrawing(JSON.stringify(oldEllipse))).annotations[0]).toMatchObject({ enclosure: 'rounded' });
 });

 it.each(['circle', 'rounded'] as const)('encloses all text corners and attaches the leader to a %s', enclosure => {
  const items = annotationItems([{ ...note, enclosure }], placed, () => undefined);
  const outline = items.find(i => i.kind === 'polyline' && i.closed && i.points.length >= 100);
  expect(outline?.kind).toBe('polyline');
  if (!outline || outline.kind !== 'polyline') throw new Error('outline missing');
  const xs = outline.points.filter((_, i) => i % 2 === 0), ys = outline.points.filter((_, i) => i % 2 === 1);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const rx = (Math.max(...xs) - Math.min(...xs)) / 2, ry = (Math.max(...ys) - Math.min(...ys)) / 2;
  if (enclosure === 'circle') expect(rx).toBeCloseTo(ry, 10); else expect(rx).not.toBeCloseTo(ry, 3);
  for (const text of items.filter(i => i.kind === 'text')) {
   const w = textWidthMm(text.text, text.height);
   expect(text.anchor).toBe('center');
   expect(text.at[0]).toBeCloseTo(cx, 10);
   for (const x of [text.at[0] - w / 2, text.at[0] + w / 2]) for (const y of [text.at[1], text.at[1] + text.height]) {
    if (enclosure === 'circle') expect(((x-cx)/rx)**2 + ((y-cy)/ry)**2).toBeLessThan(1);
    else { expect(Math.abs(x-cx)).toBeLessThan(rx - text.height * 0.6); expect(Math.abs(y-cy)).toBeLessThan(ry - text.height * 0.6); }
   }
  }
  const line = items.find(i => i.kind === 'polyline' && !i.closed && i.points.length === 4);
  expect(line?.kind).toBe('polyline');
  if (!line || line.kind !== 'polyline') throw new Error('leader missing');
  if (enclosure === 'circle') expect(((line.points[0]! - cx) / rx) ** 2 + ((line.points[1]! - cy) / ry) ** 2).toBeCloseTo(1, 8);
  else {
   const x = Math.abs(line.points[0]! - cx), y = Math.abs(line.points[1]! - cy), corner = note.height! * 0.6;
   const a = Math.max(0, x - (rx - corner)), b = Math.max(0, y - (ry - corner));
   expect(Math.max(x / rx, y / ry, Math.hypot(a, b) / corner)).toBeCloseTo(1, 8);
  }
  expect(toSvg({ width: 210, height: 297, items })).toContain('<polygon');
  const scene = { width: 210, height: 297, items };
  const dxf = readDxf(toDxf(scene));
  expect(dxf.entities.some(e => e.type === 'LWPOLYLINE')).toBe(true);
  const pdf = readPdf(toPdf(scene).bytes);
  expect(pdf.problems).toEqual([]);
  expect(pdf.pages[0]!.paths.length).toBeGreaterThan(0);
 });

 it('adapts to 100 text sizes and resolves properties before fitting', () => {
  for (let i = 0; i < 100; i++) {
   const text = `${'A'.repeat(1 + i % 24)}\n$PRP:material`;
   const items = annotationItems([{ ...note, text, enclosure: i % 2 ? 'circle' : 'rounded', height: 1 + i % 8 }], placed, () => '不鏽鋼');
   expect(items.some(x => x.kind === 'text' && x.text === '不鏽鋼')).toBe(true);
   expect(items.some(x => x.kind === 'polyline' && x.closed && x.points.every(Number.isFinite))).toBe(true);
  }
  const width = (text: string) => {
   const outline = annotationItems([{ ...note, text, enclosure: 'rounded' }], placed, () => undefined).find(x => x.kind === 'polyline' && x.closed);
   if (!outline || outline.kind !== 'polyline') throw new Error('outline missing');
   const xs = outline.points.filter((_, i) => i % 2 === 0);
   return Math.max(...xs) - Math.min(...xs);
  };
  expect(width('A longer note')).toBeGreaterThan(width('A'));
 });
});
