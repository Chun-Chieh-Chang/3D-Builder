import { t } from '@3db/i18n';
import {
  CommandError,
  DrawingHistory,
  IdAllocator,
  dirName,
  drawingIdsInUse,
  joinPath,
  relocateDrawing,
  axesOf,
  isDerived,
  sectionPlane,
  sourceOf,
  viewById,
  serializeDrawing,
  type DrawingCommand,
  type DrawingDoc,
  type DrawingSheet,
  type DrawingView,
  type Id,
  type Dimension,
  type DimensionOrientation,
  type DimensionPatch,
  type DrawingTable,
  type ElementFacts,
  type Ref,
  type SectionDrawingView,
  type TitleField,
  type ViewAxes,
  type ViewFeature,
  type ViewName,
  type ViewSide,
} from '@3db/model';
import { drawingFileName, writeDrawingFile } from '@3db/io';
import { autoDimensions, buildScene, FIRST_OFFSET, OFFSET_STEP, ratio, scaleOf, STANDARD_SCALES, suggestScale, toSvg, type AutoDimensionOptions, type DimensionOutcome, type ElementsResult, type HoleRow, type PlacedView, type Scene, type ViewLines } from '@3db/drawing';
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
  /** What each view can be dimensioned from (C16.4), by view id; a detail has its parent's. Absent while not known. */
  features: Map<Id, ViewFeature[]>;
  /** What the elements each dimension points at are, by dimension id; absent while not known. */
  elements: Map<Id, ElementsResult>;
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
  /** The lines of a view of a part as built, by the part's key, where it looks from and the cutting plane: asked for once. */
  private cache = new Map<string, ViewLines | { error: string }>();
  private computing = false;
  private computeAgain = false;
  private sceneCache: { doc: DrawingDoc; lines: DrawingState['lines']; elements: DrawingState['elements']; features: DrawingState['features']; value: { scene: Scene; placed: Map<Id, PlacedView>; dimensions: Map<Id, DimensionOutcome>; tables: Map<Id, HoleRow[]> } } | null = null;
  /** What a view can be dimensioned from, by the part's key and where it looks from; and what an element is, by the part's key and the reference. */
  private featureCache = new Map<string, ViewFeature[] | { error: string }>();
  private elementCache = new Map<string, ElementFacts | { error: string }>();
  private featuring = false;
  private featureAgain = false;

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
      features: new Map(),
      elements: new Map(),
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
    void this.computeDimensionData();
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
  private pathOf(view: DrawingView): string | null {
    const source = sourceOf(this.history.doc.views, view);
    return source === null ? null : joinPath(this.folder, source);
  }

  private loadSources(): void {
    const project = this.project;
    if (!project) {
      void this.askProject();
      return;
    }
    const wanted = new Set(this.history.doc.views.flatMap((v) => this.pathOf(v) ?? []));
    for (const path of wanted) {
      if (this.state.sources.has(path)) continue;
      this.set({ sources: new Map(this.state.sources).set(path, { status: 'loading' }) });
      void buildSource(this.host.api, project, path, { missing: (p) => t('drawing.sourceMissing', { path: p }), assembly: (p) => t('drawing.sourceAssembly', { path: p }) }).then((status) => {
        if (this.closed) return;
        this.set({ sources: new Map(this.state.sources).set(path, status) });
        void this.computeLines();
        void this.computeDimensionData();
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
    const path = this.pathOf(view);
    const s = path === null ? undefined : this.state.sources.get(path);
    return s?.status === 'ok' ? s.key : null;
  }

  /**
   * What the worker is asked for a view: the part, where it looks from and for a section the plane that cuts it. A detail is asked for nothing (it is cut from its
   * parent's lines in the layout); a view whose part is not built or whose chain of parents is broken, nothing yet.
   */
  private requestOf(view: DrawingView): { id: string; featureId: string; key: string; axes: ViewAxes; cut?: { origin: [number, number, number]; normal: [number, number, number] } } | null {
    if (view.kind === 'detail') return null;
    const doc = this.history.doc;
    const key = this.keyOf(view);
    const axes = axesOf(doc.views, doc.sheet.projection, view);
    if (!key || !axes) return null;
    let cut: { origin: [number, number, number]; normal: [number, number, number] } | undefined;
    if (view.kind === 'section') {
      const parent = viewById(doc.views, view.parent);
      const parentAxes = parent ? axesOf(doc.views, doc.sheet.projection, parent) : null;
      if (!parentAxes) return null;
      cut = sectionPlane(parentAxes, view);
    }
    return { id: `${key}|${JSON.stringify(axes)}|${cut ? JSON.stringify(cut) : ''}`, featureId: `${key}|${JSON.stringify(axes)}`, key, axes, ...(cut ? { cut } : {}) };
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
          const r = this.requestOf(v);
          return r && !this.cache.has(r.id) ? [r] : [];
        });
        const unique = [...new Map(wanted.map((w) => [w.id, w])).values()];
        if (unique.length > 0) {
          this.set({ computing: true });
          const results = await this.host.api.drawingViews(unique.map((w) => ({ parts: [{ part: w.key, mirrored: false, pose: IDENTITY }], axes: w.axes, ...(w.cut ? { cut: w.cut } : {}) })));
          if (this.closed) return;
          unique.forEach((w, i) => {
            const r = results[i]!;
            this.cache.set(w.id, 'error' in r ? { error: r.error } : r.lines);
          });
        }
        const lines = new Map<Id, ViewLines | null>();
        const problems = new Map<Id, string>();
        for (const v of this.history.doc.views) {
          const r = this.requestOf(v);
          const found = r ? this.cache.get(r.id) : undefined;
          const path = this.pathOf(v);
          const source = path === null ? undefined : this.state.sources.get(path);
          if (found && 'error' in found) problems.set(v.id, found.error);
          else if (source && (source.status === 'missing' || source.status === 'error')) problems.set(v.id, source.message);
          lines.set(v.id, found && !('error' in found) ? found : null);
        }
        this.set({ lines, problems, computing: false });
        if (this.autoScalePending && this.history.doc.views.length > 0 && this.history.doc.views.every((v) => v.kind === 'detail' || lines.get(v.id) || problems.has(v.id))) {
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

  /**
   * What the dimensions need from the worker (C16.4): what each view can be dimensioned from, and what the elements the dimensions point at are. One request at a
   * time, the newest wanted last; each is asked for once per part content.
   */
  private async computeDimensionData(): Promise<void> {
    if (this.featuring) {
      this.featureAgain = true;
      return;
    }
    this.featuring = true;
    try {
      do {
        this.featureAgain = false;
        const doc = this.history.doc;
        // what the views can be dimensioned from
        const wantedFeatures = doc.views.flatMap((v) => {
          const r = this.requestOf(v);
          if (!r || this.featureCache.has(r.featureId)) return [];
          return [{ id: r.featureId, part: r.key, axes: r.axes }];
        });
        const uniqueFeatures = [...new Map(wantedFeatures.map((w) => [w.id, w])).values()];
        if (uniqueFeatures.length > 0) {
          const results = await this.host.api.drawingFeatures(uniqueFeatures.map((w) => ({ part: w.part, axes: w.axes })));
          if (this.closed) return;
          uniqueFeatures.forEach((w, i) => this.featureCache.set(w.id, 'error' in results[i]! ? { error: (results[i] as { error: string }).error } : (results[i] as { features: ViewFeature[] }).features));
        }
        // what the elements are
        const need = new Map<string, Map<string, Ref>>();
        const refsOf = (d: Dimension): Ref[] => (d.kind === 'linear' ? [d.a, d.b] : [d.ref]);
        const keyOfDim = (d: Dimension): string | null => {
          const view = doc.views.find((v) => v.id === d.view);
          return view ? this.keyOf(view) : null;
        };
        for (const d of doc.dimensions) {
          const key = keyOfDim(d);
          if (!key) continue;
          for (const ref of refsOf(d)) {
            const id = `${key}|${ref.kind}|${ref.name}`;
            if (!this.elementCache.has(id)) need.set(key, (need.get(key) ?? new Map()).set(id, ref));
          }
        }
        if (need.size > 0) {
          const parts = [...need];
          const results = await this.host.api.drawingElements(parts.map(([part, refs]) => ({ part, refs: [...refs.values()] })));
          if (this.closed) return;
          parts.forEach(([, refs], i) => {
            const r = results[i]!;
            [...refs.keys()].forEach((id, j) => this.elementCache.set(id, 'error' in r ? { error: r.error } : r.elements[j]!));
          });
        }
        // the answers, by view and by dimension
        const features = new Map<Id, ViewFeature[]>();
        for (const v of doc.views) {
          const own = v.kind === 'detail' ? this.ancestor(doc.views, v) : v;
          const r = own ? this.requestOf(own) : null;
          const found = r ? this.featureCache.get(r.featureId) : undefined;
          if (found && !('error' in found)) features.set(v.id, found);
        }
        const elements = new Map<Id, ElementsResult>();
        for (const d of doc.dimensions) {
          const key = keyOfDim(d);
          if (!key) continue;
          const got = refsOf(d).map((ref) => this.elementCache.get(`${key}|${ref.kind}|${ref.name}`));
          if (got.some((g) => !g)) continue;
          const bad = got.find((g) => g && 'error' in g) as { error: string } | undefined;
          elements.set(d.id, bad ? { error: bad.error } : { elements: got as ElementFacts[] });
        }
        this.set({ features, elements });
      } while (this.featureAgain && !this.closed);
    } catch (e) {
      this.host.notify(t('drawing.computeFailed', { why: e instanceof Error ? e.message : String(e) }), 'error');
    } finally {
      this.featuring = false;
    }
  }

  /** The nearest view up the parents that is not a detail (a detail is measured in its parent's coordinates). */
  private ancestor(views: readonly DrawingView[], view: DrawingView): DrawingView | null {
    let v: DrawingView | undefined = view;
    for (let i = 0; i < 64 && v && v.kind === 'detail'; i++) v = viewById(views, v.parent);
    return v ?? null;
  }

  /** The drawing as a scene (the sheet and every view's lines where they are), kept while the document and what it is drawn from are the same. */
  scene(): { scene: Scene; placed: Map<Id, PlacedView>; dimensions: Map<Id, DimensionOutcome>; tables: Map<Id, HoleRow[]> } {
    const c = this.sceneCache;
    if (c && c.doc === this.state.doc && c.lines === this.state.lines && c.elements === this.state.elements && c.features === this.state.features) return c.value;
    const value = buildScene(this.state.doc, this.state.lines, this.state.elements, this.state.features);
    this.sceneCache = { doc: this.state.doc, lines: this.state.lines, elements: this.state.elements, features: this.state.features, value };
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
    const from = source ?? doc.views.flatMap((v) => (isDerived(v) ? [] : [v.source]))[0];
    if (!from) return this.host.notify(t('drawing.noSource'), 'error');
    const ids = new IdAllocator(doc.idCounters, drawingIdsInUse(doc));
    const views = directions.map((direction): DrawingView => ({ id: ids.take('view'), name: t(`drawing.view.${direction}`), source: from, direction }));
    if (this.execute({ type: 'insertViews', views })) this.set({ selected: views[0]?.id ?? null });
  }

  /** A view projected from `parent` onto one of its sides (C16.3). */
  addProjected(parent: Id, side: ViewSide): void {
    const doc = this.history.doc;
    const ids = new IdAllocator(doc.idCounters, drawingIdsInUse(doc));
    const id = ids.take('view');
    if (this.execute({ type: 'insertViews', views: [{ id, name: t('drawing.view.projected'), kind: 'projected', parent, side }] })) this.set({ selected: id });
  }

  /** A section of `parent` cut along a horizontal or vertical line in the parent's coordinates (C16.3); the letter is the next free one. */
  addSection(parent: Id, line: SectionDrawingView['line']): void {
    const doc = this.history.doc;
    const ids = new IdAllocator(doc.idCounters, drawingIdsInUse(doc));
    const id = ids.take('view');
    const label = this.nextLabel();
    if (this.execute({ type: 'insertViews', views: [{ id, name: t('drawing.view.section', { label }), kind: 'section', parent, line, label }] })) this.set({ selected: id });
  }

  /** A detail of `parent` in a circle (C16.3), at twice the scale the parent is drawn at, rounded up to a standard scale. */
  addDetail(parent: Id, centre: [number, number], radius: number): void {
    const doc = this.history.doc;
    const ids = new IdAllocator(doc.idCounters, drawingIdsInUse(doc));
    const id = ids.take('view');
    const label = this.nextLabel();
    const p = viewById(doc.views, parent);
    const base = p ? scaleOf(doc, p) : doc.sheet.scale;
    const scale = STANDARD_SCALES.slice().reverse().find((s) => ratio(s) >= 2 * ratio(base)) ?? STANDARD_SCALES[0]!;
    if (this.execute({ type: 'insertViews', views: [{ id, name: t('drawing.view.detail', { label }), kind: 'detail', parent, centre, radius, label, scale }] })) this.set({ selected: id });
  }

  /** The first capital letter no section or detail has yet. */
  private nextLabel(): string {
    const used = new Set(this.history.doc.views.flatMap((v) => (v.kind === 'section' || v.kind === 'detail' ? [v.label] : [])));
    for (let i = 0; i < 26; i++) {
      const c = String.fromCharCode(65 + i);
      if (!used.has(c)) return c;
    }
    return 'A';
  }

  // ------------------------------------------------------------ dimensions (C16.4)

  /** What a view can be dimensioned from (a detail: what its parent can), or null while it is not known. */
  featuresOf(viewId: Id): ViewFeature[] | null {
    return this.state.features.get(viewId) ?? null;
  }

  /** Every dimension of the view that asks for (overall size, holes, where the holes are), added in one step; the ones it already has are not made again. Returns how many were added. */
  autoDimension(viewId: Id, options: AutoDimensionOptions): number {
    const features = this.featuresOf(viewId);
    if (!features) {
      this.host.notify(t('drawing.featuresPending'), 'error');
      return 0;
    }
    const doc = this.history.doc;
    const same = (a: Ref, b: Ref) => a.kind === b.kind && a.name === b.name;
    const have = doc.dimensions.filter((d) => d.view === viewId);
    const isNew = (d: ReturnType<typeof autoDimensions>[number]) =>
      !have.some((h) => h.kind === d.kind && (h.kind === 'linear' && d.kind === 'linear' ? h.orientation === d.orientation && same(h.a, d.a) && same(h.b, d.b) : h.kind !== 'linear' && d.kind !== 'linear' && same(h.ref, d.ref)));
    const drafts = autoDimensions(features, options).filter(isNew);
    if (drafts.length === 0) return 0;
    // the offsets continue outside the dimension lines the view has already
    const taken = (o: DimensionOrientation, sign: number) => have.filter((h) => h.kind === 'linear' && h.orientation === o && Math.sign(h.offset) === sign).length;
    const stacked = { horizontal: taken('horizontal', -1), vertical: taken('vertical', 1) };
    const ids = new IdAllocator(doc.idCounters, drawingIdsInUse(doc));
    const dimensions = drafts.map((d): Dimension => {
      const shifted = d.kind === 'linear' && d.orientation !== 'aligned' ? { ...d, offset: d.offset + Math.sign(d.offset) * stacked[d.orientation] * OFFSET_STEP } : d;
      return { ...shifted, id: ids.take('dim'), view: viewId } as Dimension;
    });
    return this.execute({ type: 'insertDimensions', dimensions }) ? dimensions.length : 0;
  }

  /** A dimension between two elements of the view (planes, circles, …), the next line out on its side. */
  addLinear(viewId: Id, a: Ref, b: Ref, orientation: DimensionOrientation): void {
    const doc = this.history.doc;
    const ids = new IdAllocator(doc.idCounters, drawingIdsInUse(doc));
    const sign = orientation === 'horizontal' ? -1 : 1;
    const n = doc.dimensions.filter((d) => d.view === viewId && d.kind === 'linear' && d.orientation === orientation && Math.sign(d.offset) === sign).length;
    const id = ids.take('dim');
    this.execute({ type: 'insertDimensions', dimensions: [{ id, view: viewId, kind: 'linear', a, b, orientation, offset: sign * (FIRST_OFFSET + n * OFFSET_STEP) }] });
  }

  /** The diameter or radius of a circle of the view. */
  addRound(viewId: Id, kind: 'diameter' | 'radius', ref: Ref, angle = 45): void {
    const doc = this.history.doc;
    const ids = new IdAllocator(doc.idCounters, drawingIdsInUse(doc));
    this.execute({ type: 'insertDimensions', dimensions: [{ id: ids.take('dim'), view: viewId, kind, ref, angle }] });
  }

  setDimension(id: Id, patch: DimensionPatch): void {
    this.execute({ type: 'setDimension', dimensionId: id, patch });
  }

  deleteDimensions(ids: Id[]): void {
    if (ids.length > 0) this.execute({ type: 'deleteDimensions', dimensionIds: ids });
  }

  // ------------------------------------------------------------ tables (C16.6)

  /** A hole table for the view; the next free id. */
  addHoleTable(viewId: Id): void {
    const doc = this.history.doc;
    const ids = new IdAllocator(doc.idCounters, drawingIdsInUse(doc));
    this.execute({ type: 'insertTables', tables: [{ id: ids.take('tbl'), kind: 'holes', view: viewId }] });
  }

  setTable(id: Id, patch: Extract<DrawingCommand, { type: 'setTable' }>['patch']): void {
    this.execute({ type: 'setTable', tableId: id, patch });
  }

  deleteTables(ids: Id[]): void {
    if (ids.length > 0) this.execute({ type: 'deleteTables', tableIds: ids });
  }

  /** A message for the user (the panel's own: nothing went wrong). */
  notifyInfo(text: string): void {
    this.host.notify(text);
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
