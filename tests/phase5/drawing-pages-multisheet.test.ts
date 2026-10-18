/**
 * B2.8 (docs/decisions-e1p2-b28-shape2.html): Multi-sheet drawing validation test suite.
 * Validates Q3-Q7 Option A:
 * - Q3 & Q7: Multi-sheet tabs, per-page sheet settings (size, orientation, scale, projection, title block)
 * - Q4: Protection against deleting the last page (CommandError)
 * - Q5: Cross-page view migration without orphan dimensions, annotations, tables, or surface finishes
 * - Q6: Multi-page unified PDF generation sharing resources
 */
import { describe, expect, it } from 'vitest';
import {
  allViews,
  applyDrawingCommand,
  CommandError,
  createEmptyDrawing,
  drawingFromPage,
  page,
  withPage,
  type Annotation,
  type Dimension,
  type DrawingDoc,
  type DrawingTable,
  type DrawingView,
  type ModelDrawingView,
  type SurfaceFinish,
} from '@3db/model';
import { checkPdf, readPdf, toPdf, type Scene } from '@3db/drawing';

const view = (id: string, direction: ModelDrawingView['direction'] = 'front', extra: Partial<ModelDrawingView> = {}): DrawingView => ({
  id,
  name: id,
  source: '零件/基板.3dbx',
  direction,
  ...extra,
});

describe('Multi-sheet Drawing (B2.8 Shape 2)', () => {
  it('Q3 & Q7: supports multiple sheets with independent settings and titles', () => {
    let doc = createEmptyDrawing();
    expect(doc.pages).toHaveLength(1);
    expect(page(doc, 0).sheet.size).toBe('A3');

    // Add a second page (A4 portrait, third angle)
    doc = applyDrawingCommand(doc, {
      type: 'insertPage',
      page: {
        id: 'page2',
        name: '零件清單',
        sheet: { size: 'A4', orientation: 'portrait', projection: 'third', scale: [1, 2] },
        title: { drawingName: '零件清單' },
        views: [],
        dimensions: [],
        tables: [],
        surfaceFinishes: [],
        annotations: [],
      },
    });

    expect(doc.pages).toHaveLength(2);
    expect(page(doc, 0).sheet.size).toBe('A3');
    expect(page(doc, 0).sheet.orientation).toBe('landscape');
    expect(page(doc, 1).sheet.size).toBe('A4');
    expect(page(doc, 1).sheet.orientation).toBe('portrait');
    expect(page(doc, 1).name).toBe('零件清單');
    expect(page(doc, 1).title.drawingName).toBe('零件清單');

    // Rename page 1
    doc = applyDrawingCommand(doc, {
      type: 'setPage',
      pageIndex: 0,
      patch: { name: '主視圖' },
    });
    expect(page(doc, 0).name).toBe('主視圖');

    // Update sheet settings on page 1 only
    doc = applyDrawingCommand(doc, {
      type: 'setSheet',
      pageIndex: 0,
      sheet: { scale: [2, 1] },
    });
    expect(page(doc, 0).sheet.scale).toEqual([2, 1]);
    expect(page(doc, 1).sheet.scale).toEqual([1, 2]);

    // withPage helper replaces page at index
    const modifiedPg2 = { ...page(doc, 1), name: 'BOM' };
    const docWithUpdated = withPage(doc, modifiedPg2, 1);
    expect(page(docWithUpdated, 1).name).toBe('BOM');
  });

  it('Q4: forbids deleting the last remaining sheet (explicit CommandError)', () => {
    let doc = createEmptyDrawing();
    expect(doc.pages).toHaveLength(1);

    // Trying to delete the only page must throw CommandError
    expect(() => applyDrawingCommand(doc, { type: 'deletePage', pageIndex: 0 })).toThrowError(CommandError);

    // Add a page so we have 2 pages
    doc = applyDrawingCommand(doc, {
      type: 'insertPage',
      page: {
        id: 'page2',
        name: '圖紙 2',
        sheet: { size: 'A4', orientation: 'landscape', projection: 'first', scale: [1, 1] },
        title: {},
        views: [],
        dimensions: [],
        tables: [],
        surfaceFinishes: [],
        annotations: [],
      },
    });
    expect(doc.pages).toHaveLength(2);

    // Deleting page 0 succeeds now
    doc = applyDrawingCommand(doc, { type: 'deletePage', pageIndex: 0 });
    expect(doc.pages).toHaveLength(1);
    expect(page(doc, 0).id).toBe('page2');

    // Now deleting the remaining page must fail again
    expect(() => applyDrawingCommand(doc, { type: 'deletePage', pageIndex: 0 })).toThrowError(CommandError);
  });

  it('Q5: moves view to another sheet along with attached dimensions, annotations, tables, and finishes (no orphans)', () => {
    let doc = createEmptyDrawing();
    // Insert view1 into page 0
    doc = applyDrawingCommand(doc, { type: 'insertViews', views: [view('view1'), view('view2')] });

    // Attach dimension, annotation, table, and surface finish to view1
    const testDim: Dimension = { id: 'dim1', kind: 'linear', view: 'view1', a: { kind: 'edge', name: 'e1' }, b: { kind: 'edge', name: 'e2' }, orientation: 'horizontal', offset: 20 };
    const testNote: Annotation = { id: 'note1', kind: 'note', view: 'view1', text: '倒角 C1', at: [10, 10] };
    const testTable: DrawingTable = { id: 'table1', kind: 'holes', view: 'view1', at: [150, 150] };
    const testFinish: SurfaceFinish = { id: 'finish1', view: 'view1', at: [20, 20], kind: 'machined', ra: 1.6 };

    // Insert attachments into page 0
    const p0 = page(doc, 0);
    doc = withPage(doc, {
      ...p0,
      dimensions: [testDim],
      annotations: [testNote],
      tables: [testTable],
      surfaceFinishes: [testFinish],
    }, 0);

    // Insert page 2
    doc = applyDrawingCommand(doc, {
      type: 'insertPage',
      page: {
        id: 'page2',
        name: '圖紙 2',
        sheet: { size: 'A3', orientation: 'landscape', projection: 'first', scale: [1, 1] },
        title: {},
        views: [],
        dimensions: [],
        tables: [],
        surfaceFinishes: [],
        annotations: [],
      },
    });

    expect(page(doc, 0).views).toHaveLength(2);
    expect(page(doc, 1).views).toHaveLength(0);
    expect(allViews(doc)).toHaveLength(2);

    // Move view1 from page 0 to page 1
    doc = applyDrawingCommand(doc, {
      type: 'moveViewToPage',
      viewId: 'view1',
      targetPageIndex: 1,
    });

    // Check Page 0: view1 is gone, view2 remains; no attached elements remain on page 0
    expect(page(doc, 0).views.map((v) => v.id)).toEqual(['view2']);
    expect(page(doc, 0).dimensions).toHaveLength(0);
    expect(page(doc, 0).annotations).toHaveLength(0);
    expect(page(doc, 0).tables).toHaveLength(0);
    expect(page(doc, 0).surfaceFinishes).toHaveLength(0);

    // Check Page 1: view1 is present with all attached elements transferred
    expect(page(doc, 1).views.map((v) => v.id)).toEqual(['view1']);
    expect(page(doc, 1).dimensions.map((d) => d.id)).toEqual(['dim1']);
    expect(page(doc, 1).annotations.map((a) => a.id)).toEqual(['note1']);
    expect(page(doc, 1).tables.map((t) => t.id)).toEqual(['table1']);
    expect(page(doc, 1).surfaceFinishes.map((f) => f.id)).toEqual(['finish1']);

    // allViews still finds both views across pages
    expect(allViews(doc).map((v) => v.id)).toEqual(['view2', 'view1']);

    // Edge cases: moving non-existent view or to invalid page index throws
    expect(() => applyDrawingCommand(doc, { type: 'moveViewToPage', viewId: 'nonexistent', targetPageIndex: 0 })).toThrowError(CommandError);
    expect(() => applyDrawingCommand(doc, { type: 'moveViewToPage', viewId: 'view1', targetPageIndex: 99 })).toThrowError(CommandError);
  });

  it('Q6: generates a multi-page PDF with correct MediaBoxes and structure', () => {
    // Page 1: A4 landscape (297 x 210 mm)
    const scene1: Scene = {
      width: 297,
      height: 210,
      items: [
        { kind: 'text', text: 'Sheet 1', at: [50, 50], height: 5, group: 'title' },
        { kind: 'polyline', points: [10, 10, 100, 10], style: 'visible' },
      ],
    };

    // Page 2: A3 landscape (420 x 297 mm)
    const scene2: Scene = {
      width: 420,
      height: 297,
      items: [
        { kind: 'text', text: 'Sheet 2', at: [100, 100], height: 5, group: 'title' },
        { kind: 'polyline', points: [20, 20, 200, 20], style: 'visible' },
      ],
    };

    const { bytes, warnings } = toPdf([scene1, scene2], { title: '多頁工程圖' });
    expect(warnings).toEqual([]);
    expect(bytes.byteLength).toBeGreaterThan(0);

    // Verify PDF structure with readPdf
    const pdf = readPdf(bytes);
    expect(checkPdf(pdf)).toEqual([]);
    expect(pdf.pages).toHaveLength(2);

    // Assert individual MediaBoxes (converted to points: mm * 72 / 25.4)
    const ptW1 = (297 * 72) / 25.4;
    const ptH1 = (210 * 72) / 25.4;
    const ptW2 = (420 * 72) / 25.4;
    const ptH2 = (297 * 72) / 25.4;

    expect(pdf.pages[0]!.mediaBox[2]).toBeCloseTo(ptW1, 1);
    expect(pdf.pages[0]!.mediaBox[3]).toBeCloseTo(ptH1, 1);

    expect(pdf.pages[1]!.mediaBox[2]).toBeCloseTo(ptW2, 1);
    expect(pdf.pages[1]!.mediaBox[3]).toBeCloseTo(ptH2, 1);
  });
});
