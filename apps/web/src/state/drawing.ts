import { t } from '@3db/i18n';
import {
  CommandError,
  DrawingHistory,
  IdAllocator,
  dirName,
  drawingIdsInUse,
  joinPath,
  relocateDrawing,
  serializeDrawing,
  type DrawingCommand,
  type DrawingDoc,
  type DrawingSheet,
  type DrawingView,
  type Id,
  type TitleField,
  type ViewName,
} from '@3db/model';
import { drawingFileName, writeDrawingFile } from '@3db/io';
import { buildScene, suggestScale, toSvg, type PlacedView, type Scene, type ViewLines } from '@3db/drawing';
import type { Remote } from 'comlink';
import { download, fileIn, pathIn, pickDrawingSaveTarget, writeFile } from '../files';
import type { KernelApi } from '../worker/protocol';
import { buildSource, type SourceStatus } from './partSource';

/**
 * One open drawing (B1.1, C16): the document, the parts its views show (read from the project folder and built in the worker, once per content), and the
 * lines of every view (exact hidden-line removal in the worker). Nothing derived is stored: the lines are asked for again whenever a part or a view changes.
 */

export interface DrawingHost {
  api: Remote<KernelApi>;
  changed(state: DrawingState): void;
  notify(text: string, kind?: 'info' | 'error'): void;
  /** The project folder; when there is none yet the user is asked, with `reason`. Null if they cancel. */
  projectFolder(reason: string): Promise<FileSystemDirectoryHandle | null>;
}

export interface DrawingSource {
  doc: DrawingDoc;
  handle: FileSystemFileHandle | null;
  fileName: string | null;
  /** Where the drawing's file is, in the project folder ("" is the folder itself); the sources of its views are relative to it. */
  folder: string;
  untitled: string;
  project: FileSystemDirectoryHandle | null;
  /** The scale is chosen from the views once their lines are known (a new drawing). */
  autoScale?: boolean;
}

export interface DrawingState {
  doc: DrawingDoc;
  canUndo: boolean;
  canRedo: boolean;
  fileName: string | null;
  untitled: string;
  dirty: boolean;
  folder: string;
  /** The parts the views show, by project path. */
  sources: Map<string, SourceStatus>;
  /** The lines of each view at full size, by view id; null while they are not known. */
  lines: Map<Id, ViewLines | null>;
  /** Why a view has no lines. */
  problems: Map<Id, string>;
  selected: Id | null;
  /** The lines are being worked out. */
  computing: boolean;
  fitRequest: number;
}

const IDENTITY = { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number] };

export class DrawingStore {
  private history: DrawingHistory;
  private handle: FileSystemFileHandle | null;
  private savedText: string;
  private project: FileSystemDirectoryHandle | null;
  private folder: string;
  private state: DrawingState;
  private closed = false;
  private autoScalePending: boolean;
  /** The lines of a view of a part as built, by the part's key and the direction: asked for once. */
  private cache = new Map<string, ViewLines | { error: string }>();
  private computing = false;
  private computeAgain = false;
  private sceneCache: { doc: DrawingDoc; lines: DrawingState['lines']; value: { scene: Scene; placed: Map<Id, PlacedView> } } | null = null;

  constructor(
    private readonly host: DrawingHost,
    source: DrawingSource,
  ) {
    this.history = new DrawingHistory(source.doc);
    this.handle = source.handle;
    this.project = source.project;
    this.folder = source.folder;
    this.savedText = source.handle ? serializeDrawing(source.doc) : '';
    this.autoScalePending = !!source.autoScale;
    this.state = {
      doc: source.doc,
      canUndo: false,
      canRedo: false,
      fileName: source.fileName,
      untitled: source.untitled,
      dirty: !source.handle,
      folder: source.folder,
      sources: new Map(),
      lines: new Map(),
      problems: new Map(),
      selected: null,
      computing: false,
      fitRequest: 1,
    };
    this.history.subscribe(() => this.onDocChanged());
    this.loadSources();
  }

  getState = (): DrawingState => this.state;

  close(): void {
    this.closed = true;
  }

  name(): string {
    return this.state.doc.title.drawingName ?? this.state.fileName?.replace(/\.3dbd$/i, '') ?? this.state.untitled;
  }

  private set(patch: Partial<DrawingState>): void {
    if (this.closed) return;
    this.state = { ...this.state, ...patch };
    this.host.changed(this.state);
  }

  private onDocChanged(): void {
    const doc = this.history.doc;
    const selected = this.state.selected;
    this.set({
      doc,
      folder: this.folder,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      dirty: !this.handle || serializeDrawing(doc) !== this.savedText,
      selected: selected && doc.views.some((v) => v.id === selected) ? selected : null,
    });
    this.loadSources();
    void this.computeLines();
  }

  execute(cmd: DrawingCommand): boolean {
    try {
      this.history.execute(cmd);
      return true;
    } catch (e) {
      this.host.notify(e instanceof CommandError ? e.message : String(e), 'error');
      return false;
    }
  }

  undo(): void {
    this.history.undo();
  }

  redo(): void {
    this.history.redo();
  }

  select(id: Id | null): void {
    this.set({ selected: id });
  }

  // ------------------------------------------------------------ the parts the views show

  /** The project path of a view's source. */
  private pathOf(view: DrawingView): string {
    return joinPath(this.folder, view.source);
  }

  private loadSources(): void {
    const project = this.project;
    if (!project) {
      void this.askProject();
      return;
    }
    const wanted = new Set(this.history.doc.views.map((v) => this.pathOf(v)));
    for (const path of wanted) {
      if (this.state.sources.has(path)) continue;
      this.set({ sources: new Map(this.state.sources).set(path, { status: 'loading' }) });
      void buildSource(this.host.api, project, path, { missing: (p) => t('drawing.sourceMissing', { path: p }), assembly: (p) => t('drawing.sourceAssembly', { path: p }) }).then((status) => {
        if (this.closed) return;
        this.set({ sources: new Map(this.state.sources).set(path, status) });
        void this.computeLines();
      });
    }
  }

  private async askProject(): Promise<void> {
    const project = await this.host.projectFolder(t('drawing.askProject'));
    if (!project || this.closed) return;
    this.project = project;
    this.loadSources();
  }

  /** The parts are read again (the window came back): one saved since is built again, and its views redrawn. */
  async refresh(): Promise<void> {
    const project = this.project;
    if (!project || this.closed) return;
    const changed: string[] = [];
    for (const [path, status] of this.state.sources) {
      if (status.status !== 'ok') continue;
      for (const [file, stamp] of status.stamps) {
        try {
          const f = await (await fileIn(project, file)).getFile();
          if (`${f.lastModified}:${f.size}` !== stamp) changed.push(path);
        } catch {
          changed.push(path);
        }
        if (changed.includes(path)) break;
      }
    }
    if (changed.length === 0) return;
    const next = new Map(this.state.sources);
    for (const path of changed) next.delete(path);
    this.set({ sources: next });
    this.loadSources();
  }

  // ------------------------------------------------------------ the lines of the views

  private keyOf(view: DrawingView): string | null {
    const s = this.state.sources.get(this.pathOf(view));
    return s?.status === 'ok' ? s.key : null;
  }

  /** Asks the worker for the lines of every view whose part is built and whose lines are not known; one request at a time, the newest wanted last. */
  private async computeLines(): Promise<void> {
    if (this.computing) {
      this.computeAgain = true;
      return;
    }
    this.computing = true;
    try {
      do {
        this.computeAgain = false;
        const views = this.history.doc.views;
        const wanted = views.flatMap((v) => {
          const key = this.keyOf(v);
          const id = key ? `${key}|${v.direction}` : null;
          return key && id && !this.cache.has(id) ? [{ id, key, direction: v.direction }] : [];
        });
        const unique = [...new Map(wanted.map((w) => [w.id, w])).values()];
        if (unique.length > 0) {
          this.set({ computing: true });
          const results = await this.host.api.drawingViews(unique.map((w) => ({ parts: [{ part: w.key, mirrored: false, pose: IDENTITY }], direction: w.direction })));
          if (this.closed) return;
          unique.forEach((w, i) => {
            const r = results[i]!;
            this.cache.set(w.id, 'error' in r ? { error: r.error } : r.lines);
          });
        }
        const lines = new Map<Id, ViewLines | null>();
        const problems = new Map<Id, string>();
        for (const v of this.history.doc.views) {
          const key = this.keyOf(v);
          const found = key ? this.cache.get(`${key}|${v.direction}`) : undefined;
          const source = this.state.sources.get(this.pathOf(v));
          if (found && 'error' in found) problems.set(v.id, found.error);
          else if (source && (source.status === 'missing' || source.status === 'error')) problems.set(v.id, source.message);
          lines.set(v.id, found && !('error' in found) ? found : null);
        }
        this.set({ lines, problems, computing: false });
        if (this.autoScalePending && this.history.doc.views.length > 0 && this.history.doc.views.every((v) => lines.get(v.id) || problems.has(v.id))) {
          this.autoScalePending = false;
          this.autoScale();
        }
      } while (this.computeAgain && !this.closed);
    } catch (e) {
      this.set({ computing: false });
      this.host.notify(t('drawing.computeFailed', { why: e instanceof Error ? e.message : String(e) }), 'error');
    } finally {
      this.computing = false;
    }
  }

  /** The drawing as a scene (the sheet and every view's lines where they are), kept while the document and the lines are the same. */
  scene(): { scene: Scene; placed: Map<Id, PlacedView> } {
    const c = this.sceneCache;
    if (c && c.doc === this.state.doc && c.lines === this.state.lines) return c.value;
    const value = buildScene(this.state.doc, this.state.lines);
    this.sceneCache = { doc: this.state.doc, lines: this.state.lines, value };
    return value;
  }

  // ------------------------------------------------------------ editing

  setSheet(sheet: Partial<DrawingSheet>): void {
    this.execute({ type: 'setSheet', sheet });
  }

  setTitle(field: TitleField, value: string): void {
    if ((this.state.doc.title[field] ?? '') !== value.trim()) this.execute({ type: 'setTitle', field, value });
  }

  /** Views of the part the first view shows (or `source`, relative to the drawing), from these directions. */
  addViews(directions: readonly ViewName[], source?: string): void {
    const doc = this.history.doc;
    const from = source ?? doc.views[0]?.source;
    if (!from) return this.host.notify(t('drawing.noSource'), 'error');
    const ids = new IdAllocator(doc.idCounters, drawingIdsInUse(doc));
    const views = directions.map((direction): DrawingView => ({ id: ids.take('view'), name: t(`drawing.view.${direction}`), source: from, direction }));
    if (this.execute({ type: 'insertViews', views })) this.set({ selected: views[0]?.id ?? null });
  }

  deleteViews(ids: Id[]): void {
    if (ids.length > 0) this.execute({ type: 'deleteViews', viewIds: ids });
  }

  setView(id: Id, patch: Extract<DrawingCommand, { type: 'setView' }>['patch']): void {
    this.execute({ type: 'setView', viewId: id, patch });
  }

  /** The largest standard scale at which the views fit the sheet. */
  autoScale(): void {
    const doc = this.history.doc;
    const sizes = new Map<Id, { w: number; h: number }>();
    for (const v of doc.views) {
      const box = this.state.lines.get(v.id)?.box;
      sizes.set(v.id, box ? { w: box.max[0] - box.min[0], h: box.max[1] - box.min[1] } : { w: 0, h: 0 });
    }
    const scale = suggestScale(doc.views.filter((v) => !v.at && !v.scale), sizes, doc.sheet);
    if (scale[0] !== doc.sheet.scale[0] || scale[1] !== doc.sheet.scale[1]) this.execute({ type: 'setSheet', sheet: { scale } });
  }

  // ------------------------------------------------------------ output and saving

  /** The drawing as SVG, handed to the browser as a download. */
  exportSvg(): void {
    const name = this.name();
    download(`${name}.svg`, toSvg(this.scene().scene), 'image/svg+xml');
    this.host.notify(t('drawing.exported', { name: `${name}.svg` }));
  }

  async save(): Promise<boolean> {
    return this.handle ? this.write(this.handle) : this.saveAs();
  }

  /** 「另存新檔」: inside the project folder, so the parts can be found by relative path; saved into another folder the paths are rewritten to reach the same files. */
  async saveAs(): Promise<boolean> {
    try {
      const project = (this.project ??= await this.host.projectFolder(t('drawing.askProject')));
      if (!project) return false;
      const handle = await pickDrawingSaveTarget(project, drawingFileName(this.name()));
      if (!handle) return false;
      const path = await pathIn(project, handle);
      if (path === null) {
        this.host.notify(t('drawing.notInProject', { folder: project.name }), 'error');
        return false;
      }
      const from = this.folder;
      const to = dirName(path);
      this.moveTo(from, to);
      if (await this.write(handle)) return true;
      this.moveTo(to, from);
      return false;
    } catch (e) {
      this.host.notify(t('drawing.saveFailed', { why: e instanceof Error ? e.message : String(e) }), 'error');
      return false;
    }
  }

  private moveTo(from: string, to: string): void {
    if (from === to) return;
    this.folder = to;
    this.history.rebase((doc) => relocateDrawing(doc, from, to));
    this.set({ sources: new Map(), folder: to }); // the paths are other paths now: the parts are looked for again (what is built stays, by its key)
  }

  private async write(handle: FileSystemFileHandle): Promise<boolean> {
    const doc = this.history.doc;
    try {
      await writeFile(handle, await writeDrawingFile(doc));
      this.handle = handle;
      this.savedText = serializeDrawing(doc);
      this.set({ fileName: handle.name, dirty: serializeDrawing(this.history.doc) !== this.savedText });
      this.host.notify(t('drawing.saved', { name: handle.name }));
      return true;
    } catch (e) {
      this.host.notify(t('drawing.saveFailed', { why: e instanceof Error ? e.message : String(e) }), 'error');
      return false;
    }
  }
}
