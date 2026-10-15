/**
 * ADR 0147: a new drawing's 最適比例 and its save. The fit waits for what the views can be dimensioned from (the worker's features), which a slow kernel brings long
 * after the lines; a save in between used to write the drawing unfitted and then see the fit come, leaving the drawing changed (*) and 「開啟零件」 held up by
 * 「要儲存變更嗎？」. Now (1) the fit is part of the step that made the views — `History.amend` — and (2) a save writes only once the fit has come, or once nothing
 * that could bring it is on its way. The worker is a stand-in whose answers are held back and let go by the test, so the order is the one a slow kernel makes —
 * certain, not waited out; the part is read by a stand-in too (`buildSource`), the rest of the drawing store is the program's own.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandError, createEmptyDrawing, DrawingHistory, type DrawingDoc, type DrawingView } from '@3db/model';
import { readAnyDocumentFile } from '@3db/io';
import type { ViewLines } from '@3db/drawing';
import type { DrawingHost, DrawingState } from '../../apps/web/src/state/drawing';

vi.mock('../../apps/web/src/state/partSource', () => ({
  buildSource: vi.fn(async () => ({ status: 'ok', key: 'plate#1', stamps: new Map() })),
}));

const { DrawingStore } = await import('../../apps/web/src/state/drawing');

const view = (id: string, direction: 'front' | 'top' | 'right'): DrawingView => ({ id, name: id, source: '板.3dbx', direction });
const threeViews = (): DrawingView[] => [view('view1', 'front'), view('view2', 'top'), view('view3', 'right')];

/** A plate 1000 × 600 × 400: at 1:1 its three views are far larger than A3, so the fit has a scale to choose (and a shift). */
const LINES: ViewLines = { visible: [[0, 0, 1000, 0, 1000, 600, 0, 600, 0, 0]], hidden: [], box: { min: [0, 0], max: [1000, 600] } };

/** A promise and the hand that lets it go. */
function gate(): { wait: Promise<void>; open: () => void } {
  let open = () => {};
  const wait = new Promise<void>((r) => (open = r));
  return { wait, open };
}

interface Kernel {
  api: DrawingHost['api'];
  lines: ReturnType<typeof gate>;
  features: ReturnType<typeof gate>;
  calls: { views: number; features: number };
}

/** The worker: the lines and the features of a view, each held back until the test lets it go; `failLines` makes the lines request fail as a crashed kernel's does. */
function kernel(options: { failLines?: boolean } = {}): Kernel {
  const lines = gate();
  const features = gate();
  const calls = { views: 0, features: 0 };
  const api = {
    drawingViews: async (reqs: unknown[]) => {
      calls.views++;
      await lines.wait;
      if (options.failLines) throw new Error('the kernel stopped');
      return reqs.map(() => ({ lines: LINES }));
    },
    drawingFeatures: async (reqs: unknown[]) => {
      calls.features++;
      await features.wait;
      return reqs.map(() => ({ features: [] }));
    },
    drawingElements: async (reqs: unknown[]) => reqs.map(() => ({ elements: [] })),
    drawingAssemblyEdges: async (reqs: unknown[]) => reqs.map(() => ({ error: 'none' })),
  };
  return { api: api as unknown as DrawingHost['api'], lines, features, calls };
}

/** The file the save dialog answers with: what is written into it is kept, and when. */
function target() {
  const writes: Uint8Array[] = [];
  const handle = {
    kind: 'file',
    name: '板.3dbd',
    createWritable: async () => ({ write: async (b: Uint8Array) => void writes.push(b), close: async () => {} }),
  } as unknown as FileSystemFileHandle;
  const project = { kind: 'directory', name: 'proj', resolve: async () => ['板.3dbd'] } as unknown as FileSystemDirectoryHandle;
  return { handle, project, writes };
}

const notices: string[] = [];
function open(k: Kernel, doc: DrawingDoc, project: FileSystemDirectoryHandle) {
  let state: DrawingState | null = null;
  const host: DrawingHost = {
    api: k.api,
    changed: (s) => (state = s),
    notify: (text) => void notices.push(text),
    projectFolder: async () => project,
  };
  const store = new DrawingStore(host, { doc, handle: null, fileName: null, folder: '', untitled: '圖', project, autoScale: true, paletteSource: '板.3dbx' });
  return { store, state: () => state ?? store.getState() };
}

/** Lets every promise already settled run on (the stand-ins answer at once once let go). */
const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

const sheetOf = (doc: DrawingDoc) => ({ scale: doc.sheet.scale, shift: doc.sheet.shift ?? null });

let dialogs = 0;
beforeEach(() => {
  notices.length = 0;
  dialogs = 0;
});
afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});
/** The system's save dialog, answering with `handle`; it is counted, to show it opens at once (it needs the click that asked for it). */
const dialogAnswers = (handle: FileSystemFileHandle) => {
  (globalThis as { window?: unknown }).window = {
    showSaveFilePicker: async () => {
      dialogs++;
      return handle;
    },
  };
};

describe('History.amend: a change that finishes the last step instead of being one of its own', () => {
  const doc = () => createEmptyDrawing();

  it('is undone and redone with the step before it', () => {
    const h = new DrawingHistory(doc());
    h.execute({ type: 'insertViews', views: threeViews() });
    h.amend({ type: 'setSheet', sheet: { scale: [1, 10], shift: [3, -4] } });
    expect(h.doc.sheet).toMatchObject({ scale: [1, 10], shift: [3, -4] });
    h.undo();
    expect(h.doc.views).toEqual([]);
    expect(h.doc.sheet.scale).toEqual([1, 1]);
    expect(h.doc.sheet.shift).toBeUndefined();
    expect(h.canUndo).toBe(false);
    h.redo();
    expect(h.doc.views).toHaveLength(3);
    expect(h.doc.sheet).toMatchObject({ scale: [1, 10], shift: [3, -4] });
    expect(h.canRedo).toBe(false);
  });

  it('with no step to undo, becomes part of the document as it started: nothing to undo', () => {
    const h = new DrawingHistory({ ...doc(), views: threeViews() });
    h.amend({ type: 'setSheet', sheet: { scale: [1, 5] } });
    expect(h.doc.sheet.scale).toEqual([1, 5]);
    expect(h.canUndo).toBe(false);
  });

  it('refuses what the command refuses, changing nothing', () => {
    const h = new DrawingHistory(doc());
    h.execute({ type: 'insertViews', views: threeViews() });
    const before = h.doc;
    expect(() => h.amend({ type: 'setSheet', sheet: { scale: [1.5, 1] } })).toThrow(CommandError);
    expect(() => h.amend({ type: 'setSheet', sheet: { shift: [Number.NaN, 0] } })).toThrow(CommandError);
    expect(() => h.amend({ type: 'setSheet', sheet: { scale: [0, 1] } })).toThrow(CommandError);
    expect(h.doc).toBe(before);
    h.undo();
    expect(h.doc.views).toEqual([]);
  });

  it('drops what redo would bring back: that was recorded on the document without the change', () => {
    const h = new DrawingHistory(doc());
    h.execute({ type: 'insertViews', views: threeViews() });
    h.execute({ type: 'setTitle', field: 'drawingNo', value: 'D-1' });
    h.undo();
    expect(h.canRedo).toBe(true);
    h.amend({ type: 'setSheet', sheet: { scale: [1, 2] } });
    expect(h.canRedo).toBe(false);
    h.undo();
    expect(h.doc.views).toEqual([]);
    expect(h.doc.sheet.scale).toEqual([1, 1]);
  });

  it('in an edit session, finishes the session\'s last step: rolled back with it, and one step once committed', () => {
    const h = new DrawingHistory(doc());
    h.begin('s');
    h.execute({ type: 'insertViews', views: threeViews() });
    h.amend({ type: 'setSheet', sheet: { scale: [1, 2] } });
    h.rollback();
    expect(h.doc.views).toEqual([]);
    expect(h.doc.sheet.scale).toEqual([1, 1]);
    h.begin('s');
    h.execute({ type: 'insertViews', views: threeViews() });
    h.amend({ type: 'setSheet', sheet: { scale: [1, 2] } });
    h.commit();
    h.undo();
    expect(h.doc.views).toEqual([]);
    expect(h.doc.sheet.scale).toEqual([1, 1]);
  });
});

describe('a new drawing saved before its 最適比例 has come (ADR 0147)', () => {
  it('opens the dialog at once and writes the drawing fitted, once the features come; nothing is left unsaved and the fit is no step of its own', async () => {
    const k = kernel();
    const { handle, project, writes } = target();
    dialogAnswers(handle);
    const { store, state } = open(k, { ...createEmptyDrawing(), views: threeViews() }, project);
    k.lines.open();
    await flush();
    expect(state().lines.size).toBe(3);
    expect(k.calls.features).toBeGreaterThan(0);
    const unfitted = sheetOf(state().doc);
    expect(unfitted).toEqual({ scale: [1, 1], shift: null });

    let saved: boolean | null = null;
    void store.save().then((ok) => (saved = ok));
    await flush();
    // the dialog has been answered, but nothing is written while the fit is still to come
    expect(dialogs).toBe(1);
    expect(writes).toHaveLength(0);
    expect(saved).toBeNull();

    k.features.open();
    await flush();
    expect(saved).toBe(true);
    const fitted = sheetOf(state().doc);
    expect(fitted).not.toEqual(unfitted);
    expect(fitted.scale[0] / fitted.scale[1]).toBeLessThan(1);
    expect(writes).toHaveLength(1);
    const file = await readAnyDocumentFile(writes[0]!);
    expect(file.kind).toBe('drawing');
    if (file.kind === 'drawing') expect(sheetOf(file.doc)).toEqual(fitted);
    expect(state().dirty).toBe(false);
    expect(state().fileName).toBe('板.3dbd');
    // the views came with the new drawing; the fit is part of how it starts
    expect(state().canUndo).toBe(false);
    expect(notices.filter((n) => /失敗|failed/i.test(n))).toEqual([]);
  });

  it('「標準三視圖」 on the empty sheet: the fit is part of placing the views, one 「復原」 takes both', async () => {
    const k = kernel();
    const { project } = target();
    const { store, state } = open(k, createEmptyDrawing(), project);
    k.lines.open();
    k.features.open();
    await flush();
    store.addStandardViews();
    await flush();
    expect(state().doc.views).toHaveLength(3);
    const fitted = sheetOf(state().doc);
    expect(fitted.scale).not.toEqual([1, 1]);
    expect(state().canUndo).toBe(true);
    store.undo();
    expect(state().doc.views).toEqual([]);
    expect(sheetOf(state().doc)).toEqual({ scale: [1, 1], shift: null });
    expect(state().canUndo).toBe(false);
    store.redo();
    expect(sheetOf(state().doc)).toEqual(fitted);
  });

  it('「最適比例」 pressed by the user is still a step of its own', async () => {
    const k = kernel();
    const { project } = target();
    const { store, state } = open(k, createEmptyDrawing(), project);
    k.lines.open();
    k.features.open();
    await flush();
    store.addStandardViews();
    await flush();
    store.setSheet({ scale: [1, 1], shift: null });
    store.autoScale();
    store.undo();
    expect(sheetOf(state().doc)).toEqual({ scale: [1, 1], shift: null });
    expect(state().doc.views).toHaveLength(3);
  });

  it('does not wait for a fit that cannot come: the kernel failed', async () => {
    const k = kernel({ failLines: true });
    const { handle, project, writes } = target();
    dialogAnswers(handle);
    const { store, state } = open(k, { ...createEmptyDrawing(), views: threeViews() }, project);
    k.lines.open();
    await flush();
    expect(notices.length).toBeGreaterThan(0);
    expect(state().lines.size).toBe(0);
    let saved: boolean | null = null;
    void store.save().then((ok) => (saved = ok));
    await flush();
    // the features are still on their way: they are waited for, as they may yet be all the fit lacks
    expect(saved).toBeNull();
    k.features.open();
    await flush();
    // they came, the lines will not: the drawing is written as it is, and nothing comes after
    expect(saved).toBe(true);
    expect(writes).toHaveLength(1);
    expect(state().dirty).toBe(false);
    expect(sheetOf(state().doc)).toEqual({ scale: [1, 1], shift: null });
  });

  it('does not wait on an empty sheet: there is nothing to fit', async () => {
    const k = kernel();
    const { handle, project, writes } = target();
    dialogAnswers(handle);
    const { store, state } = open(k, createEmptyDrawing(), project);
    // the palette's lines are still being asked for
    const ok = await store.save();
    expect(ok).toBe(true);
    expect(writes).toHaveLength(1);
    const file = await readAnyDocumentFile(writes[0]!);
    expect(file.kind === 'drawing' && file.doc.views).toEqual([]);
    expect(state().dirty).toBe(false);
  });

  it('a drawing closed while a save waits lets the save go on', async () => {
    const k = kernel();
    const { handle, project, writes } = target();
    dialogAnswers(handle);
    const { store } = open(k, { ...createEmptyDrawing(), views: threeViews() }, project);
    k.lines.open();
    await flush();
    let saved: boolean | null = null;
    void store.save().then((ok) => (saved = ok));
    await flush();
    expect(saved).toBeNull();
    store.close();
    await flush();
    expect(saved).toBe(true);
    expect(writes).toHaveLength(1);
  });
});
