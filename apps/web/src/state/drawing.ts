import { t } from '@3db/i18n';
import {
  CommandError,
  DrawingHistory,
  IdAllocator,
  dirName,
  drawingIdsInUse,
  joinPath,
  relocateDrawing,
  ASSEMBLY_AXES,
  axesOf,
  buildBom,
  isDerived,
  leavesOf,
  mirrorKey,
  patternLeavesOf,
  sectionPlane,
  sourceOf,
  viewById,
  serializeDrawing,
  type DrawingCommand,
  type DrawingDoc,
  type DrawingSheet,
  type DrawingView,
  type Id,
  type Leaf,
  type Dimension,
  type DimensionOrientation,
  type DimensionPatch,
  type ElementFacts,
  type Ref,
  type SectionDrawingView,
  type SurfaceFinish,
  type SurfaceFinishPatch,
  type TitleField,
  type ViewAxes,
  type ViewFeature,
  type ViewEdgeSet,
  type DrawingRef,
  placementRows,
  placeElementFacts,
  type ViewName,
  type ViewSide,
  viewVectors,
  DATUM_LABEL,
  type Annotation,
  type AnnotationPatch, dimensionRefs } from '@3db/model';
import { drawingFileName, writeDrawingFile } from '@3db/io';
import { alignCollinear, arrangeDimensions, attachedAnnotations, FontError, readTrueType, resolveLines, toDxf, toPdf, turnLines, visibleElements, type TrueTypeFont, type VisibleElements } from '@3db/drawing';
import { autoDimensions, buildScene, type DimensionDraft, type Pickable, FIRST_OFFSET, OFFSET_STEP, ratio, scaleOf, STANDARD_SCALES, centreViews, fitViews, toSvg, type AutoDimensionOptions, type DimensionOutcome, type ElementsResult, type HoleRow, type PlacedView, type ViewBom, type Scene, type ViewLines } from '@3db/drawing';
import type { Remote } from 'comlink';
import { download, fileIn, pathIn, pickDrawingSaveTarget, pickFontFile, writeFile } from '../files';
import type { KernelApi } from '../worker/protocol';
import type { AssemblyData } from './assemblySource';
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
  /**
   * The part (or assembly) a new, empty drawing is of, relative to the drawing (D-V2): what the palette shows before any view is placed. Not kept in the file —
   * once a view is placed, its source is what the palette shows.
   */
  paletteSource?: string;
}

/**
 * What the pointer is being used for on the sheet, when it is not choosing and moving what is there. `dimension`: the elements pointed at so far (none, one or two), each with
 * the view it is of (the second is of the same view as the first); the next point on the sheet puts the dimension. `section`, `detail`: the pointer is pressed where the cut
 * is to be (and dragged along it) or where the middle of the circle is (and dragged out to its edge), on the view it is over. `surface`: the next point on the sheet puts a
 * surface finish symbol on the view under it (C16.5).
 */
/**
 * One thing chosen on the sheet (D-I1a, ADR 0130). Several can be chosen at once (Ctrl and a click, or a box dragged over the paper); what is done to the
 * choice — a tolerance, deleting it — is one step of the history.
 */
export type DrawingPick = { kind: 'view' | 'dimension' | 'finish' | 'table' | 'annotation'; id: Id };
export type PickMode = 'replace' | 'toggle' | 'add';

const samePick = (a: DrawingPick, b: DrawingPick) => a.kind === b.kind && a.id === b.id;

/** Whether what a pick names is in the document. */
const pickExists = (doc: DrawingDoc, p: DrawingPick): boolean =>
  p.kind === 'view'
    ? doc.views.some((v) => v.id === p.id)
    : p.kind === 'dimension'
      ? doc.dimensions.some((d) => d.id === p.id)
      : p.kind === 'finish'
        ? doc.surfaceFinishes.some((f) => f.id === p.id)
        : p.kind === 'annotation'
          ? (doc.annotations ?? []).some((a) => a.id === p.id)
          : doc.tables.some((x) => x.id === p.id);

/** What an annotation tool makes (D-I3). */
export type AnnotateWhat = Annotation['kind'];

/** Omit over each member of a union (the plain Omit merges them). */
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

export type DrawingTool =
  | { kind: 'dimension'; picks: { view: Id; feature: Pickable }[] }
  | { kind: 'section'; vertical?: boolean }
  | { kind: 'detail' }
  | { kind: 'surface' }
  /**
   * A view from the palette (D-V, ADR 0131) on its way to the sheet: it follows the pointer and the next click puts it there. `dragged`: it was pressed on in the
   * palette and is being dragged, so letting go over the sheet puts it there too.
   */
  | { kind: 'placeView'; direction: ViewName; source: string; dragged?: boolean }
  /**
   * Projected views of `parent`, as SolidWorks makes them: the view the pointer is beside is shown where it would go, in line with the parent, and a click puts it
   * there; the pointer off a corner shows the isometric view. The tool stays until Esc, for the next one.
   */
  | { kind: 'project'; parent: Id }
  /** An ordinate dimension (D-I4): the origin first, then the elements; a click on the paper puts the row there. */
  | { kind: 'ordinate'; picks: { view: Id; feature: Pickable }[] }
  /**
   * An annotation (D-I3): a note, a frame or a datum takes two clicks (the feature it is about, then where it goes; for a note or a frame the same place twice
   * means no leader); a centre line two points; a centre mark one circle. `first` is the first click, in the view it was made on.
   */
  | { kind: 'annotate'; what: AnnotateWhat; first?: { view: Id; at: [number, number] } };

/** The view directions the palette offers (the flat pattern is not one: only a sheet metal part has it, and it is added from the list). */
export const PALETTE_DIRECTIONS: readonly ViewName[] = ['front', 'top', 'right', 'back', 'bottom', 'left', 'isometric'];

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
  /** The edges and vertices of the part each view shows, by name (D-I2); absent while not known, and for a view of an assembly. */
  edges: Map<Id, ViewEdgeSet>;
  /** What the elements each dimension points at are, by dimension id; absent while not known. */
  elements: Map<Id, ElementsResult>;
  /** For each view of an assembly: its parts list and the parts it was made of (C16.6). */
  boms: Map<Id, ViewBom>;
  /** The name of the font file the PDF embeds for the characters the standard font does not have; null: none. */
  pdfFont: string | null;
  selected: Id | null;
  /** The dimension chosen on the sheet (or in the panel): it can be moved, edited and deleted. */
  dimension: Id | null;
  /** The surface finish chosen on the sheet (or in the panel), as a dimension is (C16.5). */
  finish: Id | null;
  /**
   * Everything chosen, in the order it was chosen. `selected`, `dimension` and `finish` are the last view, dimension and symbol chosen (or the view a dimension
   * is on): the one the panel shows and the one a drag moves, as SolidWorks's PropertyManager shows the last thing picked.
   */
  selection: DrawingPick[];
  /** The annotation chosen last (D-I3): the one the annotations panel edits. */
  annotation: Id | null;
  /** The lines of the palette's views (D-V): the part the drawing's first model view shows, from each direction; null while there is no part. */
  palette: { source: string; lines: Partial<Record<ViewName, ViewLines | null>> } | null;
  tool: DrawingTool | null;
  /** The lines are being worked out. */
  computing: boolean;
  fitRequest: number;
}

/** What a view of an assembly is made of: the parts and where they are. */
interface AssemblyView {
  leaves: Leaf[];
  problems: ReadonlyMap<Id, string>;
}

const IDENTITY = { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number] };

/** How far from the corner the first angle dimension's arc is drawn (mm on the sheet). */
const FIRST_ARC = 18;

export class DrawingStore {
  private history: DrawingHistory;
  private handle: FileSystemFileHandle | null;
  private savedText: string;
  private project: FileSystemDirectoryHandle | null;
  private folder: string;
  private state: DrawingState;
  private closed = false;
  private autoScalePending: boolean;
  /** The part a drawing was made of, before any view shows it (D-V2). */
  private initialSource: string | null;
  /** The worker could not say what the views are dimensioned from: a new drawing's 最適比例 does not wait for it. */
  private featuresFailed = false;
  /** The lines of a view of a part as built, by the part's key, where it looks from and the cutting plane: asked for once. */
  private cache = new Map<string, ViewLines | { error: string }>();
  private computing = false;
  private computeAgain = false;
  private sceneCache: { doc: DrawingDoc; lines: DrawingState['lines']; elements: DrawingState['elements']; features: DrawingState['features']; boms: DrawingState['boms']; edges: DrawingState['edges']; value: { scene: Scene; placed: Map<Id, PlacedView>; dimensions: Map<Id, DimensionOutcome>; tables: Map<Id, HoleRow[]> } } | null = null;
  /** What a view can be dimensioned from, by the part's key and where it looks from; and what an element is, by the part's key and the reference. */
  private featureCache = new Map<string, { features: ViewFeature[]; edges?: ViewEdgeSet } | { error: string }>();
  private elementCache = new Map<string, ElementFacts | { error: string }>();
  /** The font the PDF embeds (read from the file the user chose; not part of the drawing). */
  private font: TrueTypeFont | null = null;
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
    this.initialSource = source.paletteSource ?? null;
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
      edges: new Map(),
      elements: new Map(),
      boms: new Map(),
      pdfFont: null,
      selected: null,
      dimension: null,
      finish: null,
      selection: [],
      annotation: null,
      palette: null,
      tool: null,
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
    const dimension = this.state.dimension;
    const finish = this.state.finish;
    const annotation = this.state.annotation;
    const selection = this.state.selection.filter((p) => pickExists(doc, p));
    this.set({
      ...(selection.length !== this.state.selection.length ? { selection } : {}),
      doc,
      folder: this.folder,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      dirty: !this.handle || serializeDrawing(doc) !== this.savedText,
      selected: selected && doc.views.some((v) => v.id === selected) ? selected : null,
      dimension: dimension && doc.dimensions.some((d) => d.id === dimension) ? dimension : null,
      finish: finish && doc.surfaceFinishes.some((f) => f.id === finish) ? finish : null,
      annotation: annotation && (doc.annotations ?? []).some((a) => a.id === annotation) ? annotation : null,
    });
    this.loadSources();
    this.refreshBoms();
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

  /** Chooses a view (and only it); null lets go of every view chosen. The panel is about the view chosen. */
  select(id: Id | null): void {
    if (id === null) return this.set({ selected: null, selection: this.state.selection.filter((p) => p.kind !== 'view') });
    this.pick([{ kind: 'view', id }], 'replace');
  }

  /** Chooses a dimension (and the view it is on, which the dimensions panel is about); null lets go of every dimension chosen. */
  selectDimension(id: Id | null): void {
    if (id === null) return this.set({ dimension: null, selection: this.state.selection.filter((p) => p.kind !== 'dimension') });
    this.pick([{ kind: 'dimension', id }], 'replace');
  }

  /** Chooses a surface finish (and the view it is on, which the annotations panel is about); null lets go of every one chosen. */
  selectSurfaceFinish(id: Id | null): void {
    if (id === null) return this.set({ finish: null, selection: this.state.selection.filter((p) => p.kind !== 'finish') });
    this.pick([{ kind: 'finish', id }], 'replace');
  }

  /**
   * Chooses things (D-I1a): `replace` makes them the whole choice, `add` adds them, `toggle` adds each that was not chosen and takes away each that was (Ctrl and a
   * click). Ids that are not in the document are left out. The last one chosen that is still chosen becomes the one the panel shows.
   */
  pick(items: readonly DrawingPick[], mode: PickMode): void {
    const doc = this.history.doc;
    const real = items.filter((p) => pickExists(doc, p));
    let next: DrawingPick[];
    if (mode === 'replace') next = real.filter((p, i) => real.findIndex((q) => samePick(p, q)) === i);
    else {
      next = [...this.state.selection];
      for (const p of real) {
        const at = next.findIndex((q) => samePick(p, q));
        if (at < 0) next.push(p);
        else if (mode === 'toggle') next.splice(at, 1);
      }
    }
    this.set(this.primaryOf(next));
  }

  /** Lets go of everything chosen. */
  clearSelection(): void {
    this.set({ selection: [], selected: null, dimension: null, finish: null, annotation: null });
  }

  /** The choice and, from it, the last view, dimension and symbol chosen; a dimension, symbol or table makes the view it is on the panel's. */
  private primaryOf(selection: DrawingPick[]): Pick<DrawingState, 'selection' | 'selected' | 'dimension' | 'finish' | 'annotation'> {
    const doc = this.history.doc;
    const last = (kind: DrawingPick['kind']) => [...selection].reverse().find((p) => p.kind === kind)?.id ?? null;
    const tail = selection[selection.length - 1];
    const viewOfTail =
      tail?.kind === 'dimension' ? doc.dimensions.find((d) => d.id === tail.id)?.view : tail?.kind === 'finish' ? doc.surfaceFinishes.find((f) => f.id === tail.id)?.view : tail?.kind === 'table' ? doc.tables.find((x) => x.id === tail.id)?.view : tail?.kind === 'annotation' ? (doc.annotations ?? []).find((a) => a.id === tail.id)?.view : undefined;
    const selected = tail?.kind === 'view' ? tail.id : (viewOfTail ?? last('view') ?? (selection.length === 0 ? null : this.state.selected));
    return { selection, selected, dimension: last('dimension'), finish: last('finish'), annotation: last('annotation') };
  }

  /** The ids of what is chosen, of one kind. */
  chosen(kind: DrawingPick['kind']): Id[] {
    return this.state.selection.filter((p) => p.kind === kind).map((p) => p.id);
  }

  /**
   * Deletes everything chosen, as one step. The dimensions, symbols and tables go first and the views last: a view takes its derived views and what is drawn on
   * them with it, so what is chosen on a view that goes anyway is not asked for twice.
   */
  deleteSelection(): boolean {
    const doc = this.history.doc;
    const gone = new Set(this.chosen('view'));
    for (let grew = true; grew; ) {
      grew = false;
      for (const v of doc.views) if (isDerived(v) && gone.has(v.parent) && !gone.has(v.id)) grew = !!gone.add(v.id);
    }
    const onKept = <T extends { id: Id; view: Id }>(ids: Id[], all: readonly T[]) => ids.filter((id) => !gone.has(all.find((x) => x.id === id)?.view ?? ''));
    const dims = onKept(this.chosen('dimension'), doc.dimensions);
    const finishes = onKept(this.chosen('finish'), doc.surfaceFinishes);
    const tables = onKept(this.chosen('table'), doc.tables);
    const annotations = onKept(this.chosen('annotation'), doc.annotations ?? []);
    const views = this.chosen('view');
    const commands: DrawingCommand[] = [];
    // the annotations before the views: a datum deleted with the frames that refer to it goes, which deleting its view first would refuse
    if (annotations.length) commands.push({ type: 'deleteAnnotations', annotationIds: annotations });
    if (dims.length) commands.push({ type: 'deleteDimensions', dimensionIds: dims });
    if (finishes.length) commands.push({ type: 'deleteSurfaceFinishes', finishIds: finishes });
    if (tables.length) commands.push({ type: 'deleteTables', tableIds: tables });
    if (views.length) commands.push({ type: 'deleteViews', viewIds: views });
    if (commands.length === 0) return false;
    const ok = this.execute(commands.length === 1 ? commands[0]! : { type: 'batch', commands });
    if (ok) this.clearSelection();
    return ok;
  }

  /**
   * A change worked out for each dimension in `ids` from what it is (null: leave that one alone), as one step. For the limits: the upper limit typed for five
   * dimensions keeps each one's own lower limit.
   */
  setDimensionsEach(ids: readonly Id[], patchOf: (d: Dimension) => DimensionPatch | null): boolean {
    const doc = this.history.doc;
    const commands = ids.flatMap((id): DrawingCommand[] => {
      const dim = doc.dimensions.find((x) => x.id === id);
      const patch = dim ? patchOf(dim) : null;
      return patch ? [{ type: 'setDimension', dimensionId: id, patch }] : [];
    });
    if (commands.length === 0) return false;
    return this.execute(commands.length === 1 ? commands[0]! : { type: 'batch', commands });
  }

  /**
   * 「自動排列尺寸」 (D-I4): the linear dimensions in `ids` stacked outward from their views, the shortest nearest, as one step; no number changes. Returns how
   * many moved.
   */
  arrangeDimensions(ids: readonly Id[]): number {
    const changes = arrangeDimensions(this.history.doc.dimensions, this.scene().dimensions, new Set(ids));
    if (changes.length === 0) return 0;
    const commands: DrawingCommand[] = changes.map((c) => ({ type: 'setDimension', dimensionId: c.id, patch: c.patch }));
    return this.execute(commands.length === 1 ? commands[0]! : { type: 'batch', commands }) ? changes.length : 0;
  }

  /** 「共線對正」 (D-I4): the dimensions in `ids` on the first one's line, as one step; those that cannot be (another view, way or side) are said. */
  alignCollinear(ids: readonly Id[]): void {
    const { changes, skipped } = alignCollinear(this.history.doc.dimensions, ids);
    if (changes.length > 0) {
      const commands: DrawingCommand[] = changes.map((c) => ({ type: 'setDimension', dimensionId: c.id, patch: c.patch }));
      this.execute(commands.length === 1 ? commands[0]! : { type: 'batch', commands });
    }
    if (skipped.length > 0) this.host.notify(t('drawingUi.alignSkipped', { n: skipped.length }));
  }

  /** The same change to every dimension in `ids`, as one step: wholly or, if one of them refuses it, not at all. */
  setDimensions(ids: readonly Id[], patch: DimensionPatch): boolean {
    if (ids.length === 0) return false;
    if (ids.length === 1) return this.execute({ type: 'setDimension', dimensionId: ids[0]!, patch });
    return this.execute({ type: 'batch', commands: ids.map((id) => ({ type: 'setDimension', dimensionId: id, patch })) });
  }

  /** Starts or ends a tool of the pointer (Esc, or the tool done). */
  setTool(tool: DrawingTool | null): void {
    // a new kind of tool lets go of what was chosen; the same one asking again (the picks start over) keeps what it has just made
    const changed = tool && this.state.tool?.kind !== tool.kind;
    this.set({ tool, ...(changed ? { dimension: null, finish: null, annotation: null, selection: this.state.selection.filter((p) => p.kind === 'view') } : {}) });
  }

  /** A dimension made on the sheet from elements pointed at and a place pointed at (`planDimension`), as one step: it is chosen when it is there. */
  addDimension(viewId: Id, draft: DimensionDraft): Id | null {
    const doc = this.history.doc;
    const id = new IdAllocator(doc.idCounters, drawingIdsInUse(doc)).take('dim');
    if (!this.execute({ type: 'insertDimensions', dimensions: [{ id, view: viewId, ...draft } as Dimension] })) return null;
    this.set({ dimension: id, selected: viewId, selection: [{ kind: 'dimension', id }] });
    return id;
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
    // the part of an empty drawing, for its palette
    if (this.initialSource && this.history.doc.views.length === 0) wanted.add(joinPath(this.folder, this.initialSource));
    for (const path of wanted) {
      if (this.state.sources.has(path)) continue;
      this.set({ sources: new Map(this.state.sources).set(path, { status: 'loading' }) });
      void buildSource(this.host.api, project, path, { missing: (p) => t('drawing.sourceMissing', { path: p }), assembly: (p) => t('drawing.sourceAssembly', { path: p }), cycle: (p) => t('drawing.sourceCycle', { path: p }), notAssembly: (p) => t('drawing.sourceNotAssembly', { path: p }) }).then((status) => {
        if (this.closed) return;
        this.set({ sources: new Map(this.state.sources).set(path, status) });
        this.refreshBoms();
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
  private requestOf(view: DrawingView): { id: string; featureId?: string; key: string; parts: { part: string; mirrored: boolean; pose: typeof IDENTITY }[]; anchors: boolean; flat?: boolean; axes: ViewAxes; cut?: { origin: [number, number, number]; normal: [number, number, number] } } | null {
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
    const id = `${key}|${JSON.stringify(axes)}|${cut ? JSON.stringify(cut) : ''}`;
    const assembly = this.assemblyOf(view);
    if (assembly) {
      // the parts of the assembly where they are (a mirror is the file's part reflected); the balloons need to know where each is
      const unmirror = (k: string) => k.slice(0, -mirrorKey('').length);
      const parts = assembly.leaves.map((l) => ({ part: l.mirrored ? unmirror(l.key) : l.key, mirrored: !!l.mirrored, pose: l.pose }));
      return { id, key, parts, anchors: true, axes, ...(cut ? { cut } : {}) };
    }
    // the flat pattern of a sheet metal part: not a projection, so nothing of the folded part can be dimensioned in it
    if (view.kind === undefined || view.kind === 'model') if (view.direction === 'flat') return { id: `${key}|flat`, key, parts: [{ part: key, mirrored: false, pose: IDENTITY }], anchors: false, flat: true, axes };
    return { id, featureId: `${key}|${JSON.stringify(axes)}`, key, parts: [{ part: key, mirrored: false, pose: IDENTITY }], anchors: false, axes, ...(cut ? { cut } : {}) };
  }

  // ------------------------------------------------------------ the view palette (D-V, ADR 0131)

  /** The source the palette shows: that of the first model view (relative to the drawing). */
  private paletteSource(): string | null {
    const v = this.history.doc.views.find((x) => !isDerived(x));
    return v && !isDerived(v) ? v.source : this.initialSource;
  }

  /** The part the next view is of: the first model view's, else the one the drawing was made of. */
  sourceForViews(): string | null {
    return this.paletteSource() ?? this.state.palette?.source ?? null;
  }

  /**
   * 「標準三視圖」 (SolidWorks's Standard 3 View, C16.2): the front, top and right views at once, laid out in the projection of the sheet. On an empty sheet the
   * scale is then chosen to fit, as a new drawing's used to be.
   */
  addStandardViews(): void {
    const source = this.sourceForViews();
    if (!source) return this.host.notify(t('drawing.noSource'), 'error');
    if (this.history.doc.views.length === 0) this.autoScalePending = true;
    const doc = this.history.doc;
    const ids = new IdAllocator(doc.idCounters, drawingIdsInUse(doc));
    const views = (['front', 'top', 'right'] as const).map((direction): DrawingView => ({ id: ids.take('view'), name: t(`drawing.view.${direction}`), source, direction }));
    this.execute({ type: 'insertViews', views });
  }

  /** A model view of `source` from `direction` that is not in the document: what the worker is asked for the palette and the previews. */
  private probe(source: string, direction: ViewName): DrawingView {
    return { id: `palette:${direction}`, name: '', source, direction };
  }

  /**
   * The palette's lines (and so the previews of the views placed from it), worked out once per part: the same requests the views make, kept in the same cache, so a
   * view placed from the palette is drawn at once.
   */
  private async ensurePalette(): Promise<void> {
    // with every view deleted the palette keeps the part it showed: that is what the drawing is of, and what the next view is placed from
    const source = this.paletteSource() ?? this.state.palette?.source ?? null;
    if (!source) return;
    const wanted = PALETTE_DIRECTIONS.flatMap((direction) => {
      const r = this.requestOf(this.probe(source, direction));
      return r && !this.cache.has(r.id) ? [r] : [];
    });
    if (wanted.length > 0) {
      const results = await this.host.api.drawingViews(wanted.map((w) => ({ parts: w.parts, axes: w.axes, ...(w.anchors ? { anchors: true } : {}) })));
      if (this.closed) return;
      wanted.forEach((w, i) => {
        const r = results[i]!;
        this.cache.set(w.id, 'error' in r ? { error: r.error } : r.anchors ? { ...r.lines, anchors: r.anchors } : r.lines);
      });
    }
    const lines: Partial<Record<ViewName, ViewLines | null>> = {};
    for (const direction of PALETTE_DIRECTIONS) {
      const r = this.requestOf(this.probe(source, direction));
      const found = r ? this.cache.get(r.id) : undefined;
      lines[direction] = found && !('error' in found) ? found : null;
    }
    const was = this.state.palette;
    if (!was || was.source !== source || PALETTE_DIRECTIONS.some((k) => was.lines[k] !== lines[k])) this.set({ palette: { source, lines } });
  }

  /**
   * The lines of the part seen from these axes, for a preview: those of the palette's view that looks the same way, turned in the sheet to the axes' up (a view
   * projected or cut from the top view looks along a standard direction with the top view's up, which no palette view has). Null when no palette view looks
   * that way.
   */
  linesForAxes(axes: ViewAxes): ViewLines | null {
    const pal = this.state.palette;
    if (!pal) return null;
    for (const direction of PALETTE_DIRECTIONS) {
      const lines = pal.lines[direction];
      const turned = lines ? turnLines(lines, viewVectors(direction), axes) : null;
      if (turned) return turned;
    }
    return null;
  }

  /** A view from the palette put where the pointer let it go (sheet mm); then projected views of it are offered, as SolidWorks does. */
  placeModelView(source: string, direction: ViewName, at: [number, number]): Id | null {
    const doc = this.history.doc;
    const id = new IdAllocator(doc.idCounters, drawingIdsInUse(doc)).take('view');
    if (!this.execute({ type: 'insertViews', views: [{ id, name: t(`drawing.view.${direction}`), source, direction, at }] })) return null;
    this.select(id);
    this.setTool(direction === 'isometric' ? null : { kind: 'project', parent: id });
    return id;
  }

  /** A projected view of `parent` on `side`, slid `slide` mm along its line from where it would be laid out (C16.3). */
  placeProjected(parent: Id, side: ViewSide, slide: number, shift: [number, number] | null = null): Id | null {
    const doc = this.history.doc;
    if (this.isFlat(parent)) {
      this.host.notify(t('drawing.flatNoDerived'), 'error');
      return null;
    }
    const id = new IdAllocator(doc.idCounters, drawingIdsInUse(doc)).take('view');
    const view: DrawingView = { id, name: t('drawing.view.projected'), kind: 'projected', parent, side, ...(Math.abs(slide) > 0.005 ? { slide: Math.round(slide * 100) / 100 } : {}) };
    // with the shift that keeps the other views where they are (the arrangement is centred again when a view is added), as one step
    const insert: DrawingCommand = { type: 'insertViews', views: [view] };
    if (!this.execute(shift ? { type: 'batch', commands: [insert, { type: 'setSheet', sheet: { shift } }] } : insert)) return null;
    this.select(id);
    return id;
  }

  // ------------------------------------------------------------ assemblies as the source of a view (C16.6)

  private assemblyViews = new WeakMap<AssemblyData, AssemblyView>();

  /** The assembly a view shows, when its source is one that has been read. */
  private assemblyData(view: DrawingView): AssemblyData | null {
    const path = this.pathOf(view);
    const s = path === null ? undefined : this.state.sources.get(path);
    return s?.status === 'ok' && s.assembly ? s.assembly : null;
  }

  /** The parts an assembly view is made of: every part of the assembly (and of its patterns and mirrors) that is shown and that counts, where the mates put it. */
  private assemblyOf(view: DrawingView): AssemblyView | null {
    const data = this.assemblyData(view);
    if (!data) return null;
    const known = this.assemblyViews.get(data);
    if (known) return known;
    const base = leavesOf(data.doc, data.trees, (id) => data.solution.poses.get(id) ?? data.doc.components.find((c) => c.id === id)?.placement ?? null, data.solution.inner);
    // a pattern whose axis is an element of a component cannot be placed here: the parts list says it has no instances (it is the same rule for the count and the drawing)
    const made = patternLeavesOf(data.doc, base, (axis) => (axis.kind === 'axis' ? ASSEMBLY_AXES[axis.axis] : null));
    const unmirror = (k: string) => k.slice(0, -mirrorKey('').length);
    const counts = (l: Leaf) => {
      const info = data.parts.get(l.mirrored ? unmirror(l.key) : l.key);
      return !l.hidden && !info?.referenceOnly && !info?.empty;
    };
    const view2: AssemblyView = { leaves: [...base, ...made.leaves].filter(counts), problems: made.problems };
    this.assemblyViews.set(data, view2);
    return view2;
  }

  /** The parts lists and the parts of the views of assemblies (derived: kept in the state so that the scene is made from the state alone). */
  private refreshBoms(): void {
    const boms = new Map<Id, ViewBom>();
    for (const v of this.history.doc.views) {
      const data = this.assemblyData(v);
      const own = this.assemblyOf(v);
      if (!data || !own) continue;
      const rows = buildBom({
        doc: data.doc,
        trees: data.trees,
        propsOf: (key) => data.parts.get(key)?.properties,
        isReference: (key) => data.parts.get(key)?.referenceOnly === true,
        problems: own.problems,
      }).flat;
      boms.set(v.id, { rows, parts: own.leaves.map((l) => ({ ...(l.file ? { file: l.file } : {}), mirrored: !!l.mirrored })) });
    }
    const same = boms.size === this.state.boms.size && [...boms].every(([id, b]) => JSON.stringify(b) === JSON.stringify(this.state.boms.get(id)));
    if (!same) this.set({ boms });
  }

  /** Whether the view shows an assembly (its parts list and balloons can be had). */
  isAssemblyView(viewId: Id): boolean {
    return this.state.boms.has(viewId);
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
          const results = await this.host.api.drawingViews(unique.map((w) => ({ parts: w.parts, axes: w.axes, ...(w.anchors ? { anchors: true } : {}), ...(w.cut ? { cut: w.cut } : {}), ...(w.flat ? { flat: true } : {}) })));
          if (this.closed) return;
          unique.forEach((w, i) => {
            const r = results[i]!;
            this.cache.set(w.id, 'error' in r ? { error: r.error } : r.anchors ? { ...r.lines, anchors: r.anchors } : r.lines);
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
        await this.ensurePalette();
        this.autoScaleWhenReady();
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
          if (!r || !r.featureId || this.featureCache.has(r.featureId)) return [];
          return [{ id: r.featureId, part: r.key, axes: r.axes }];
        });
        const uniqueFeatures = [...new Map(wantedFeatures.map((w) => [w.id, w])).values()];
        if (uniqueFeatures.length > 0) {
          const results = await this.host.api.drawingFeatures(uniqueFeatures.map((w) => ({ part: w.part, axes: w.axes })));
          if (this.closed) return;
          uniqueFeatures.forEach((w, i) => {
            const r = results[i]!;
            this.featureCache.set(w.id, 'error' in r ? { error: r.error } : { features: r.features, ...(r.edges ? { edges: r.edges } : {}) });
          });
        }
        // what the elements are
        const need = new Map<string, Map<string, Ref>>();
        const refsOf = (d: Dimension): DrawingRef[] => dimensionRefs(d);
        const keyOfDim = (d: Dimension): string | null => {
          const view = doc.views.find((v) => v.id === d.view);
          return view && !this.assemblyData(view) ? this.keyOf(view) : null;
        };
        /** The part an element of a view of an assembly is in (D-I2): its leaf, by the reference's `in`, and the part's key as built. */
        const leafOf = (d: Dimension, ref: DrawingRef): { leaf: Leaf; key: string } | null => {
          const view = doc.views.find((v) => v.id === d.view);
          const asm = view ? this.assemblyOf(this.ancestor(doc.views, view) ?? view) : null;
          const leaf = asm?.leaves.find((l) => l.id === ref.in);
          if (!leaf) return null;
          return { leaf, key: leaf.mirrored ? leaf.key.slice(0, -mirrorKey('').length) : leaf.key };
        };
        for (const d of doc.dimensions) {
          const key = keyOfDim(d);
          for (const ref of refsOf(d)) {
            // in a view of an assembly the element is its part's, asked of that part
            const part = key ?? (ref.in ? leafOf(d, ref)?.key : null);
            if (!part) continue;
            const id = `${part}|${ref.kind}|${ref.name}`;
            if (!this.elementCache.has(id)) need.set(part, (need.get(part) ?? new Map()).set(id, { kind: ref.kind, name: ref.name, ...(ref.fingerprint ? { fingerprint: ref.fingerprint } : {}) }));
          }
        }
        // the edges and vertices of the parts of each view of an assembly (D-I2)
        const wantedAsm = doc.views.flatMap((v) => {
          const asm = this.assemblyOf(v);
          const r = asm && v.kind !== 'detail' ? this.requestOf(v) : null;
          if (!asm || !r || this.featureCache.has(`asm|${r.id}`)) return [];
          const unmirror = (k: string) => k.slice(0, -mirrorKey('').length);
          return [{ id: `asm|${r.id}`, axes: r.axes, parts: asm.leaves.map((l) => ({ part: l.mirrored ? unmirror(l.key) : l.key, mirrored: !!l.mirrored, pose: l.pose, leaf: l.id })) }];
        });
        if (wantedAsm.length > 0) {
          const results = await this.host.api.drawingAssemblyEdges(wantedAsm.map((w) => ({ parts: w.parts, axes: w.axes })));
          if (this.closed) return;
          wantedAsm.forEach((w, i) => {
            const r = results[i]!;
            this.featureCache.set(w.id, 'error' in r ? { error: r.error } : { features: [], edges: r.edges });
          });
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
        const edges = new Map<Id, ViewEdgeSet>();
        for (const v of doc.views) {
          const own = v.kind === 'detail' ? this.ancestor(doc.views, v) : v;
          const r = own ? this.requestOf(own) : null;
          const asmFound = own && this.assemblyOf(own) && r ? this.featureCache.get(`asm|${r.id}`) : undefined;
          const found = asmFound ?? (r?.featureId ? this.featureCache.get(r.featureId) : undefined);
          if (found && !('error' in found)) {
            features.set(v.id, found.features);
            if (found.edges) edges.set(v.id, found.edges);
          }
        }
        const elements = new Map<Id, ElementsResult>();
        for (const d of doc.dimensions) {
          const view = doc.views.find((v) => v.id === d.view);
          if (view && this.assemblyData(this.ancestor(doc.views, view) ?? view)) {
            // a view of an assembly (D-I2): each element is its part's, put where the assembly has the part
            const got = refsOf(d).map((ref): ElementFacts | { error: string } | undefined => {
              const at = ref.in ? leafOf(d, ref) : null;
              if (!at) return { error: t('drawing.dimNoPart', { name: ref.name }) };
              const facts = this.elementCache.get(`${at.key}|${ref.kind}|${ref.name}`);
              return facts && !('error' in facts) ? placeElementFacts(facts, placementRows(at.leaf.pose, !!at.leaf.mirrored)) : facts;
            });
            if (got.some((g) => !g)) continue;
            const bad = got.find((g) => g && 'error' in g) as { error: string } | undefined;
            elements.set(d.id, bad ? { error: bad.error } : { elements: got as ElementFacts[] });
            continue;
          }
          const key = keyOfDim(d);
          if (!key) continue;
          const got = refsOf(d).map((ref) => this.elementCache.get(`${key}|${ref.kind}|${ref.name}`));
          if (got.some((g) => !g)) continue;
          const bad = got.find((g) => g && 'error' in g) as { error: string } | undefined;
          elements.set(d.id, bad ? { error: bad.error } : { elements: got as ElementFacts[] });
        }
        this.set({ features, edges, elements });
        this.autoScaleWhenReady();
      } while (this.featureAgain && !this.closed);
    } catch (e) {
      this.featuresFailed = true; // a new drawing is still scaled and centred, on what is known
      this.host.notify(t('drawing.computeFailed', { why: e instanceof Error ? e.message : String(e) }), 'error');
      this.autoScaleWhenReady();
    } finally {
      this.featuring = false;
    }
  }

  /**
   * A new drawing's 最適比例, once what it measures is all there: the lines of every view, and what each view is dimensioned from (the centre marks of its holes are
   * drawn from that, and they take room). Waiting for the lines only centred it on views without their marks, a millimetre or so off once they came.
   */
  private autoScaleWhenReady(): void {
    if (!this.autoScalePending || this.closed) return;
    const { views } = this.history.doc;
    const { lines, problems } = this.state;
    if (views.length === 0) return;
    const drawn = views.every((v) => v.kind === 'detail' || lines.get(v.id) || problems.has(v.id));
    const known = this.featuresFailed || views.every((v) => {
      if (v.kind === 'detail' || problems.has(v.id)) return true;
      const id = this.requestOf(v)?.featureId;
      return !id || this.featureCache.has(id);
    });
    if (!drawn || !known) return;
    this.autoScalePending = false;
    this.autoScale();
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
    if (c && c.doc === this.state.doc && c.lines === this.state.lines && c.elements === this.state.elements && c.features === this.state.features && c.boms === this.state.boms && c.edges === this.state.edges) return c.value;
    // the annotations fastened to the model are drawn where the model has their elements now (D-I2)
    const { annotations, lost } = attachedAnnotations(this.state.doc.annotations ?? [], this.viewsSeen());
    const value = buildScene({ ...this.state.doc, annotations }, this.state.lines, this.state.elements, this.state.features, this.state.boms);
    this.lostCache = lost;
    this.sceneCache = { doc: this.state.doc, lines: this.state.lines, elements: this.state.elements, features: this.state.features, boms: this.state.boms, edges: this.state.edges, value };
    return value;
  }

  private lostCache = new Set<Id>();

  /** The annotations whose fastened element is not in the model any more (they are drawn where they were last). */
  attachmentsLost(): ReadonlySet<Id> {
    this.scene();
    return this.lostCache;
  }

  /** What each view shows of the model's edges and vertices, and its features (D-I2): what the attachments are worked out from. */
  viewsSeen(): Map<Id, { seen: VisibleElements; features: ViewFeature[] }> {
    const lines = resolveLines(this.state.doc, this.state.lines);
    return new Map(this.state.doc.views.map((v) => [v.id, { seen: visibleElements(lines.get(v.id), this.state.edges.get(v.id), this.state.features.get(v.id) ?? []), features: this.state.features.get(v.id) ?? [] }]));
  }

  // ------------------------------------------------------------ editing

  setSheet(sheet: Extract<DrawingCommand, { type: 'setSheet' }>['sheet']): void {
    this.execute({ type: 'setSheet', sheet });
  }

  setTitle(field: TitleField, value: string): void {
    if ((this.state.doc.title[field] ?? '') !== value.trim()) this.execute({ type: 'setTitle', field, value });
  }

  /** Views of the part the first view shows (or `source`, relative to the drawing), from these directions. */
  addViews(directions: readonly ViewName[], source?: string): void {
    const doc = this.history.doc;
    const from = source ?? doc.views.flatMap((v) => (isDerived(v) ? [] : [v.source]))[0] ?? this.initialSource ?? undefined;
    if (!from) return this.host.notify(t('drawing.noSource'), 'error');
    const ids = new IdAllocator(doc.idCounters, drawingIdsInUse(doc));
    const views = directions.map((direction): DrawingView => ({ id: ids.take('view'), name: t(`drawing.view.${direction}`), source: from, direction }));
    if (this.execute({ type: 'insertViews', views })) this.select(views[0]?.id ?? null);
  }

  /** Whether a view is the flat pattern of a part (S-1): the folded part is not seen in it, so views projected or cut from it would show nothing true. */
  private isFlat(id: Id): boolean {
    const v = viewById(this.history.doc.views, id);
    return !!v && (v.kind === undefined || v.kind === 'model') && v.direction === 'flat';
  }

  /** A view projected from `parent` onto one of its sides (C16.3). */
  addProjected(parent: Id, side: ViewSide): void {
    const doc = this.history.doc;
    if (this.isFlat(parent)) return this.host.notify(t('drawing.flatNoDerived'), 'error');
    const ids = new IdAllocator(doc.idCounters, drawingIdsInUse(doc));
    const id = ids.take('view');
    if (this.execute({ type: 'insertViews', views: [{ id, name: t('drawing.view.projected'), kind: 'projected', parent, side }] })) this.select(id);
  }

  /** A section of `parent` cut along a horizontal or vertical line in the parent's coordinates (C16.3); the letter is the next free one. */
  addSection(parent: Id, line: SectionDrawingView['line'], at?: [number, number], options: { flip?: boolean; slide?: number; shift?: [number, number] | null } = {}): void {
    const doc = this.history.doc;
    if (this.isFlat(parent)) return this.host.notify(t('drawing.flatNoDerived'), 'error');
    const ids = new IdAllocator(doc.idCounters, drawingIdsInUse(doc));
    const id = ids.take('view');
    const label = this.nextLabel();
    const slide = !at && options.slide !== undefined && Math.abs(options.slide) > 0.005 ? { slide: Math.round(options.slide * 100) / 100 } : {};
    const insert: DrawingCommand = { type: 'insertViews', views: [{ id, name: t('drawing.view.section', { label }), kind: 'section', parent, line, label, ...(options.flip ? { flip: true } : {}), ...slide, ...(at ? { at } : {}) }] };
    const shift = !at && options.shift ? options.shift : null;
    if (this.execute(shift ? { type: 'batch', commands: [insert, { type: 'setSheet', sheet: { shift } }] } : insert)) this.select(id);
  }

  /** The letter the next section or detail will have. */
  peekLabel(): string {
    return this.nextLabel();
  }

  /** A detail of `parent` in a circle (C16.3), at twice the scale the parent is drawn at, rounded up to a standard scale. */
  addDetail(parent: Id, centre: [number, number], radius: number, at?: [number, number]): void {
    const doc = this.history.doc;
    const ids = new IdAllocator(doc.idCounters, drawingIdsInUse(doc));
    const id = ids.take('view');
    const label = this.nextLabel();
    const p = viewById(doc.views, parent);
    const base = p ? scaleOf(doc, p) : doc.sheet.scale;
    const scale = STANDARD_SCALES.slice().reverse().find((s) => ratio(s) >= 2 * ratio(base)) ?? STANDARD_SCALES[0]!;
    if (this.execute({ type: 'insertViews', views: [{ id, name: t('drawing.view.detail', { label }), kind: 'detail', parent, centre, radius, label, scale, ...(at ? { at } : {}) }] })) this.select(id);
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
      !have.some(
        (h) =>
          h.kind === d.kind &&
          (h.kind === 'linear' && d.kind === 'linear'
            ? h.orientation === d.orientation && same(h.a, d.a) && same(h.b, d.b)
            : h.kind === 'ordinate' && d.kind === 'ordinate'
              ? h.axis === d.axis && same(h.origin, d.origin)
              : (h.kind === 'diameter' || h.kind === 'radius') && (d.kind === 'diameter' || d.kind === 'radius') && same(h.ref, d.ref)),
      );
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

  /** The angle between two elements seen as lines in the view (planes edge-on, slanted ones too). */
  addAngle(viewId: Id, a: Ref, b: Ref): void {
    const doc = this.history.doc;
    const ids = new IdAllocator(doc.idCounters, drawingIdsInUse(doc));
    const n = doc.dimensions.filter((d) => d.view === viewId && d.kind === 'angle').length;
    this.execute({ type: 'insertDimensions', dimensions: [{ id: ids.take('dim'), view: viewId, kind: 'angle', a, b, arc: FIRST_ARC + n * OFFSET_STEP }] });
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

  // ------------------------------------------------------------ surface finishes (C16.5)

  /** The surface finishes of the view, in the order they are in the document. */
  surfaceFinishesOf(viewId: Id): SurfaceFinish[] {
    return this.state.doc.surfaceFinishes.filter((f) => f.view === viewId);
  }

  /** A surface finish (C16.5, ISO 1302) whose symbol's point is at a point of the view's coordinates (full size); it is chosen when it is there. */
  addSurfaceFinish(viewId: Id, at: [number, number]): Id | null {
    const doc = this.history.doc;
    const id = new IdAllocator(doc.idCounters, drawingIdsInUse(doc)).take('fin');
    if (!this.execute({ type: 'insertSurfaceFinishes', finishes: [{ id, view: viewId, at }] })) return null;
    this.set({ finish: id, selected: viewId, selection: [{ kind: 'finish', id }] });
    return id;
  }

  setSurfaceFinish(id: Id, patch: SurfaceFinishPatch): void {
    this.execute({ type: 'setSurfaceFinish', finishId: id, patch });
  }

  deleteSurfaceFinishes(ids: Id[]): void {
    if (ids.length > 0) this.execute({ type: 'deleteSurfaceFinishes', finishIds: ids });
  }

  // ------------------------------------------------------------ annotations (D-I3, ADR 0132)

  /** The annotations of the view, in the order they are in the document. */
  annotationsOf(viewId: Id): Annotation[] {
    return (this.state.doc.annotations ?? []).filter((a) => a.view === viewId);
  }

  /** The first letter no datum of the drawing has (ISO 5459: not I, O or Q). */
  nextDatumLabel(): string {
    const used = new Set((this.history.doc.annotations ?? []).flatMap((a) => (a.kind === 'datum' ? [a.label] : [])));
    for (let i = 0; i < 26; i++) {
      const c = String.fromCharCode(65 + i);
      if (!'IOQ'.includes(c) && !used.has(c)) return c;
    }
    for (let i = 0; i < 26; i++) for (let j = 0; j < 26; j++) {
      const c = String.fromCharCode(65 + i) + String.fromCharCode(65 + j);
      if (DATUM_LABEL.test(c) && !used.has(c)) return c;
    }
    return 'A';
  }

  /** An annotation made with a tool (the id is the next free one); it is chosen when it is there. */
  addAnnotation(a: DistributiveOmit<Annotation, 'id'>): Id | null {
    const doc = this.history.doc;
    const id = new IdAllocator(doc.idCounters, drawingIdsInUse(doc)).take('ann');
    if (!this.execute({ type: 'insertAnnotations', annotations: [{ ...a, id } as Annotation] })) return null;
    this.pick([{ kind: 'annotation', id }], 'replace');
    return id;
  }

  setAnnotation(id: Id, patch: AnnotationPatch): boolean {
    return this.execute({ type: 'setAnnotation', annotationId: id, patch });
  }

  deleteAnnotations(ids: Id[]): void {
    if (ids.length > 0) this.execute({ type: 'deleteAnnotations', annotationIds: ids });
  }

  // ------------------------------------------------------------ tables (C16.6)

  /** A hole table for the view; the next free id. */
  addHoleTable(viewId: Id): void {
    const doc = this.history.doc;
    const ids = new IdAllocator(doc.idCounters, drawingIdsInUse(doc));
    this.execute({ type: 'insertTables', tables: [{ id: ids.take('tbl'), kind: 'holes', view: viewId }] });
  }

  /** A parts list for the view of an assembly, with the balloons by its parts. */
  addBomTable(viewId: Id): void {
    const doc = this.history.doc;
    const ids = new IdAllocator(doc.idCounters, drawingIdsInUse(doc));
    this.execute({ type: 'insertTables', tables: [{ id: ids.take('tbl'), kind: 'bom', view: viewId, balloons: true }] });
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

  /** 「最適比例」: the largest standard scale at which the views, with their dimensions and marks, fit the sheet, and the arrangement moved to the middle of the area with them. */
  autoScale(): void {
    const { doc, lines, elements, features, boms } = this.state;
    const fit = fitViews(doc, lines, elements, features, boms);
    if (!fit) return;
    const sheet: Extract<DrawingCommand, { type: 'setSheet' }>['sheet'] = {};
    if (fit.scale[0] !== doc.sheet.scale[0] || fit.scale[1] !== doc.sheet.scale[1]) sheet.scale = fit.scale;
    const was = doc.sheet.shift;
    if ((fit.shift?.[0] ?? 0) !== (was?.[0] ?? 0) || (fit.shift?.[1] ?? 0) !== (was?.[1] ?? 0)) sheet.shift = fit.shift;
    if (Object.keys(sheet).length > 0) this.execute({ type: 'setSheet', sheet });
  }

  /** The shift that puts the arrangement in the middle at the scale it has, the way a new drawing is put there (with the names under the views, the dimensions, the marks). */
  private centredShift(): [number, number] | null {
    const { doc, lines, elements, features, boms } = this.state;
    return centreViews(doc, lines, elements, features, boms);
  }

  /** Whether the arrangement is in the middle already: 「自動排版」 of the front view has nothing to do then. */
  arrangementCentred(): boolean {
    const want = this.centredShift();
    const was = this.state.doc.sheet.shift;
    return (want?.[0] ?? 0) === (was?.[0] ?? 0) && (want?.[1] ?? 0) === (was?.[1] ?? 0);
  }

  /** 「自動排版」 of the front view: the whole arrangement back in the middle — where a new drawing puts it, not only where the boxes of the views would be. */
  centreArrangement(): void {
    if (!this.arrangementCentred()) this.execute({ type: 'setSheet', sheet: { shift: this.centredShift() } });
  }

  // ------------------------------------------------------------ output and saving

  /** The drawing as SVG, handed to the browser as a download. */
  exportSvg(): void {
    const name = this.name();
    download(`${name}.svg`, toSvg(this.scene().scene), 'image/svg+xml');
    this.host.notify(t('drawing.exported', { name: `${name}.svg` }));
  }

  /** The drawing as DXF (AC1015), handed to the browser as a download. */
  exportDxf(): void {
    const name = this.name();
    download(`${name}.dxf`, toDxf(this.scene().scene), 'application/dxf');
    this.host.notify(t('drawing.exported', { name: `${name}.dxf` }));
  }

  /** The drawing as a PDF, with the font chosen for the characters Helvetica does not have; what could not be written is said. */
  exportPdf(): void {
    const name = this.name();
    try {
      const { bytes, warnings } = toPdf(this.scene().scene, { title: name, font: this.font });
      download(`${name}.pdf`, bytes as BlobPart, 'application/pdf');
      this.host.notify(t('drawing.exported', { name: `${name}.pdf` }));
      for (const w of warnings) this.host.notify(w, 'error');
    } catch (e) {
      this.host.notify(e instanceof FontError ? e.message : t('drawing.exportFailed', { why: e instanceof Error ? e.message : String(e) }), 'error');
    }
  }

  /** 「PDF 字型」: the user chooses a TrueType font file; it is read now so that a file that cannot be used is said at once. */
  async chooseFont(): Promise<void> {
    try {
      const file = await pickFontFile();
      if (!file) return;
      const font = readTrueType(file.bytes);
      if (!font.embeddable) throw new FontError(t('font.restricted'));
      this.font = font;
      this.set({ pdfFont: file.name });
      this.host.notify(t('drawing.fontChosen', { name: file.name }));
    } catch (e) {
      this.host.notify(e instanceof Error ? e.message : String(e), 'error');
    }
  }

  clearFont(): void {
    this.font = null;
    this.set({ pdfFont: null });
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
