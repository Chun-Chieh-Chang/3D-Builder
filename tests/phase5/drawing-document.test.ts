/**
 * 5-1 (docs/phase5-plan.md): the drawing document (B1.1, C16.1, C16.2). What it stores, what its commands refuse, and that it is saved and read back as the same
 * document in the same container as parts and assemblies.
 */
import { describe, expect, it } from 'vitest';
import { applyDrawingCommand, createEmptyAssembly, createEmptyDrawing, DrawingHistory, parseDrawing, serializeDrawing, type DrawingDoc, type DrawingView, type ModelDrawingView } from '@3db/model';
import { drawingFileName, readAnyDocumentFile, writeAssemblyFile, writeDrawingFile } from '@3db/io';

const view = (id: string, direction: ModelDrawingView['direction'] = 'front', extra: Partial<ModelDrawingView> = {}): DrawingView => ({ id, name: id, source: '零件/基板.3dbx', direction, ...extra });
const withViews = (): DrawingDoc => applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views: [view('view1'), view('view2', 'top'), view('view3', 'right')] });

describe('the drawing document', () => {
  it('starts as an A3 landscape sheet at 1:1 in first angle, with no views and an empty title block', () => {
    const d = createEmptyDrawing();
    expect(d).toMatchObject({ kind: 'drawing', schemaVersion: 8, sheet: { size: 'A3', orientation: 'landscape', projection: 'first', scale: [1, 1] }, views: [], title: {} });
  });

  it('inserts views with their ids kept apart, and refuses what is not a view', () => {
    const d = withViews();
    expect(d.views.map((v) => v.id)).toEqual(['view1', 'view2', 'view3']);
    expect(d.idCounters).toEqual({ view: 3 });
    expect(() => applyDrawingCommand(d, { type: 'insertViews', views: [view('view2')] })).toThrow(/已被使用/);
    expect(() => applyDrawingCommand(d, { type: 'insertViews', views: [view('view9', 'front', { source: '/abs/路徑.3dbx' })] })).toThrow(/相對路徑/);
    expect(() => applyDrawingCommand(d, { type: 'insertViews', views: [view('view9', 'sideways' as never)] })).toThrow(/視角/);
    expect(() => applyDrawingCommand(d, { type: 'insertViews', views: [view('view9', 'front', { scale: [0, 1] })] })).toThrow(/比例/);
    expect(() => applyDrawingCommand(d, { type: 'insertViews', views: [view('view9', 'front', { name: ' ' })] })).toThrow(/名稱/);
  });

  it('changes a view: a position of its own and back to the layout, a scale of its own and back to the sheet scale, hidden lines off', () => {
    let d = withViews();
    d = applyDrawingCommand(d, { type: 'setView', viewId: 'view2', patch: { at: [100, 120], scale: [2, 1], hidden: false } });
    expect(d.views[1]).toMatchObject({ at: [100, 120], scale: [2, 1], hidden: false });
    d = applyDrawingCommand(d, { type: 'setView', viewId: 'view2', patch: { at: null, scale: null } });
    expect(d.views[1]).not.toHaveProperty('at');
    expect(d.views[1]).not.toHaveProperty('scale');
    expect(() => applyDrawingCommand(d, { type: 'setView', viewId: 'nope', patch: {} })).toThrow(/找不到視圖/);
    expect(() => applyDrawingCommand(d, { type: 'setView', viewId: 'view1', patch: { scale: [1, 1001] } })).toThrow(/比例/);
  });

  it('deletes views and never hands their ids out again', () => {
    let d = applyDrawingCommand(withViews(), { type: 'deleteViews', viewIds: ['view3'] });
    expect(d.views.map((v) => v.id)).toEqual(['view1', 'view2']);
    d = applyDrawingCommand(d, { type: 'insertViews', views: [view('view4')] });
    expect(d.views.map((v) => v.id)).toEqual(['view1', 'view2', 'view4']);
    expect(() => applyDrawingCommand(d, { type: 'deleteViews', viewIds: ['view1', 'zzz'] })).toThrow();
    expect(d.views).toHaveLength(3); // nothing changed when one of them was not there
  });

  it('writes the sheet and the title block: a field written, a field taken away by an empty text', () => {
    let d = applyDrawingCommand(createEmptyDrawing(), { type: 'setSheet', sheet: { size: 'A4', orientation: 'portrait', projection: 'third', scale: [1, 2] } });
    expect(d.sheet).toEqual({ size: 'A4', orientation: 'portrait', projection: 'third', scale: [1, 2] });
    d = applyDrawingCommand(d, { type: 'setTitle', field: 'drawingName', value: ' 基板加工圖 ' });
    d = applyDrawingCommand(d, { type: 'setTitle', field: 'material', value: 'S45C' });
    expect(d.title).toEqual({ drawingName: '基板加工圖', material: 'S45C' });
    d = applyDrawingCommand(d, { type: 'setTitle', field: 'material', value: '  ' });
    expect(d.title).toEqual({ drawingName: '基板加工圖' });
    expect(() => applyDrawingCommand(d, { type: 'setSheet', sheet: { size: 'A5' as never } })).toThrow(/圖頁/);
    expect(() => applyDrawingCommand(d, { type: 'setSheet', sheet: { scale: [1.5, 1] } })).toThrow(/比例/);
  });

  it('undoes and redoes, one step for each command', () => {
    const h = new DrawingHistory(createEmptyDrawing());
    h.execute({ type: 'insertViews', views: [view('view1')] }, 'add');
    h.execute({ type: 'setTitle', field: 'drawingNo', value: 'D-001' }, 'title');
    expect(h.doc.title).toEqual({ drawingNo: 'D-001' });
    h.undo();
    expect(h.doc.title).toEqual({});
    h.undo();
    expect(h.doc.views).toEqual([]);
    h.redo();
    expect(h.doc.views).toHaveLength(1);
  });
});

describe('the drawing file (.3dbd)', () => {
  it('is saved as canonical text and read back as the same document', () => {
    const d = applyDrawingCommand(withViews(), { type: 'setTitle', field: 'drawingName', value: '基板' });
    const text = serializeDrawing(d);
    expect(text.indexOf('"kind"')).toBeLessThan(text.indexOf('"views"')); // sorted keys: a stable text
    expect(parseDrawing(text)).toEqual(d);
    expect(serializeDrawing(parseDrawing(text))).toBe(text);
  });

  it('is told from parts and assemblies by what is in it, and carries nothing but the document', async () => {
    const d = withViews();
    const read = await readAnyDocumentFile(await writeDrawingFile(d));
    expect(read.kind).toBe('drawing');
    if (read.kind === 'drawing') expect(read.doc).toEqual(d);
    expect((await readAnyDocumentFile(await writeAssemblyFile(createEmptyAssembly()))).kind).toBe('assembly');
    expect(drawingFileName('基板:加工圖')).toBe('基板_加工圖.3dbd');
  });

  it('refuses text that is not a drawing, and a drawing from a newer version', () => {
    expect(() => parseDrawing('{"kind":"part"}')).toThrow(/工程圖/);
    expect(() => parseDrawing(JSON.stringify({ ...createEmptyDrawing(), schemaVersion: 99 }))).toThrow(/99/);
    expect(() => parseDrawing(JSON.stringify({ kind: 'drawing', schemaVersion: 1 }))).toThrow();
  });
});
