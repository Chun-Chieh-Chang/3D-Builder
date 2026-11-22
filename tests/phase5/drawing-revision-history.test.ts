import { describe, expect, it } from 'vitest';
import { withLocale } from '@3db/i18n';
import { applyDrawingCommand, createEmptyDrawing, currentDrawingRevision, DrawingHistory, drawingPageForOutput, page, parseDrawing, serializeDrawing, withPage } from '@3db/model';
import { buildScene, drawingSheetMetrics, readDxf, readPdf, revisionTableItems, toDxf, toPdf, toSvg } from '@3db/drawing';
import { readAnyDocumentFile, writeDrawingFile } from '@3db/io';

const date = '2026-11-22';
const legacy = () => {
  const doc = createEmptyDrawing('CNS');
  return withPage(doc, { ...page(doc), title: { revision: '00', drafter: 'Chen' }, sheet: { ...page(doc).sheet, size: 'A4', orientation: 'portrait' } });
};

describe('drawing revision history', () => {
  it('migrates the old title and records changes once, across pages, with undo and redo', async () => {
    const oldDoc = parseDrawing(serializeDrawing({ ...legacy(), schemaVersion: 39 }));
    expect(oldDoc.revisionHistory).toBeUndefined();
    expect(page(oldDoc).title.revision).toBe('00');
    const history = new DrawingHistory(applyDrawingCommand(oldDoc, { type: 'insertPage', page: { title: { revision: 'legacy', drafter: 'Lin' } } }));
    history.execute({ type: 'setTitle', field: 'revision', value: ' 01 ', revisionDate: date });
    history.execute({ type: 'setTitle', field: 'revision', value: '01', pageIndex: 1, revisionDate: date });
    history.execute({ type: 'setTitle', field: 'revision', value: '02', pageIndex: 1, revisionDate: date });
    expect(history.doc.revisionHistory).toEqual([
      { revision: '01', date, description: '', author: 'Chen' },
      { revision: '02', date, description: '', author: 'Lin' },
    ]);
    const edited = { revision: '02', date, author: 'Lin', description: '安裝孔改為 Ø8\n加註公差', changeOrder: 'ECN-02' };
    history.execute({ type: 'saveRevision', previousRevision: '02', entry: edited });
    expect(() => history.execute({ type: 'setTitle', field: 'revision', value: '01', revisionDate: date })).toThrow();
    expect(() => history.execute({ type: 'setTitle', field: 'revision', value: '03', revisionDate: '2026-02-30' })).toThrow();
    history.undo();
    expect(history.doc.revisionHistory?.at(-1)?.description).toBe('');
    history.undo();
    expect(currentDrawingRevision(history.doc)).toBe('01');
    history.redo();
    history.redo();
    const reopened = await readAnyDocumentFile(await writeDrawingFile(history.doc));
    expect(reopened).toEqual({ kind: 'drawing', doc: history.doc });
    history.execute({ type: 'deleteRevision', revision: '02' });
    expect(currentDrawingRevision(history.doc)).toBe('01');
    history.execute({ type: 'deleteRevision', revision: '01' });
    expect(history.doc.revisionHistory).toBeUndefined();
    expect(page(drawingPageForOutput(history.doc, 1)).title.revision).toBe('legacy');
  });

  it('prints only the latest three rows on the first page and the current revision on both pages', () => withLocale('en', () => {
    let doc = applyDrawingCommand(legacy(), { type: 'insertPage' });
    for (const revision of ['A01', 'A02', 'A03', 'A04']) {
      doc = applyDrawingCommand(doc, { type: 'saveRevision', entry: { revision, date, description: `Change record ${revision}`, author: 'Chen' } });
    }
    const first = drawingPageForOutput(doc, 0);
    const second = drawingPageForOutput(doc, 1);
    const { frame, area } = drawingSheetMetrics(first);
    const table = revisionTableItems(first, frame)!;
    expect(table.box.x).toBeGreaterThan(frame.x);
    expect(table.box.x + table.box.w).toBeLessThan(frame.x + frame.w);
    expect(area.y + area.h).toBeLessThan(table.box.y);
    const front = buildScene(first, new Map()).scene;
    const back = buildScene(second, new Map()).scene;
    for (const value of ['Change record A04', 'Change record A03', 'Change record A02', '1 more in the drawing file']) expect(toSvg(front)).toContain(value);
    expect(toSvg(front)).not.toContain('Change record A01');
    expect(toSvg(back)).toContain('A04');
    expect(toSvg(back)).not.toContain('Revision history');
    expect(readDxf(toDxf(front)).entities).toContainEqual(expect.objectContaining({ type: 'TEXT', text: 'Change record A04' }));
    const exported = readPdf(toPdf([front, back]).bytes);
    expect(exported.pages[0]?.texts.map((item) => item.text)).toContain('Change record A04');
    expect(exported.pages[1]?.texts.map((item) => item.text)).toContain('A04');
    expect(exported.pages[1]?.texts.map((item) => item.text)).not.toContain('Revision history');
  }));
});
