import * as Comlink from 'comlink';
import { useSyncExternalStore } from 'react';
import {
  CommandError,
  createDemoPart,
  createEmptyAssembly,
  createEmptyPart,
  DATUM_PLANES,
  dirName,
  DocHistory,
  findFeature,
  IdAllocator,
  idsInUse,
  isDatumPlaneName,
  planeFrame,
  serializePart,
  type AssemblyDoc,
  type Command,
  type DatumPlaneName,
  type BlobRef,
  type Feature,
  type Id,
  type ImportedBodyFeature,
  type PartDoc,
  type PlaneDefinition,
  type PlaneFrame,
  type Ref,
  type SketchFeature,
} from '@3db/model';
import { assemblyName, partFileName, partName, readDocumentFile, sha256Hex, stepFileName, writePartFile } from '@3db/io';
import { suppressionTargets, type SuppressAction } from '@3db/regen/dag';
import type { Viewer } from '@3db/render';
import type { KernelApi, RebuildPayload, SketchSolvePayload, SketchSolveRequest } from '../worker/protocol';
import { SketchController, type ControllerView, type SketchHost } from '../sketcher/controller';
import { download, FOLDERS_UNSUPPORTED, isStepFile, pathIn, pickFileToOpen, pickProjectFolder, pickSaveTarget, pickStepFile, writeFile, type OpenedFile } from '../files';
import { AssemblyStore, type AssemblySource, type AssemblyState } from './assembly';

export interface EditSession {
  featureId: Id;
  /** A sketch session edits geometry in the graphics area; a feature session edits PropertyManager values. */
  kind: 'feature' | 'sketch';
}

export interface Notice {
  kind: 'error' | 'info';
  text: string;
}

/** File actions that replace the open document, and so first ask about unsaved changes. */
export type PendingFileAction = 'new-part' | 'new-demo' | 'new-assembly' | 'open';

/** One document is open at a time (2026-09-28 decision): a part or an assembly. */
export type DocumentKind = 'part' | 'assembly';

/**
 * UI state. The document inside DocHistory is the only source of truth for the design;
 * everything else here is session state (selection, edit session) or derived data (results).
 */
export interface UiState {
  doc: PartDoc;
  canUndo: boolean;
  canRedo: boolean;
  /** Selected feature, or datum plane ("plane:front" …) in the FeatureManager. */
  selected: Id | null;
  /** Face selected in the graphics area (by persistent name, resolved against the displayed model). */
  selectedFace: Ref | null;
  editing: EditSession | null;
  result: RebuildPayload | null;
  /** Solve of the sketch being edited (or of the current drag frame). */
  sketchSolve: SketchSolvePayload | null;
  /** Dimension whose Modify box is open (D6.1). */
  dimensionEdit: Id | null;
  /** Feature whose 「確認刪除」 dialog is open (B2.8). */
  confirmDelete: Id | null;
  /** 「錯誤為何？」 dialog (D7.1). */
  whatsWrong: boolean;
  /** The file the part was opened from or last saved to (F7.1); null for a part never saved. */
  fileName: string | null;
  /** The document differs from what was last opened or saved (the title shows 「*」). */
  dirty: boolean;
  /** A file action waiting for the answer to 「要儲存變更嗎？」. */
  unsaved: PendingFileAction | null;
  /** Bumped when a part replaces the current one: the viewport fits the next model it shows. */
  fitRequest: number;
  /** Name of a part never saved (「零件1」, 「零件2」 …, or the STEP file it was made from). */
  untitled: string;
  rebuilding: boolean;
  bootMs: { occtMs: number; gcsMs: number } | null;
  bootError: string | null;
  notice: Notice | null;
  /** The open document: the part above, or the assembly in `asm`. */
  active: DocumentKind;
  /** The open assembly (null while a part is open). */
  asm: AssemblyState | null;
  /** The project folder assemblies read their parts from (B9.4); null until one is chosen. */
  projectName: string | null;
  /** Why the project folder is asked for: the dialog is open. */
  folderRequest: string | null;
}

/** Next free display name like SolidWorks does: 草圖3 after 草圖2 (names are labels, ids stay permanent). */
function nextName(doc: PartDoc, base: string): string {
  const pattern = new RegExp(`^${base}(\\d+)$`);
  const used = doc.features.map((f) => Number(pattern.exec(f.name)?.[1] ?? 0));
  return `${base}${Math.max(0, ...used) + 1}`;
}

/** A planar face's sketch frame, from its fingerprint (same rule the rebuild uses, see planeFrame). */
function faceFrame(face: Ref): PlaneFrame | null {
  const fp = face.fingerprint;
  return fp?.type === 'plane' && fp.dir ? planeFrame(fp.center, fp.dir) : null;
}

/** Runs one request at a time; while one is running only the newest waiting request is kept. */
class LatestRunner<Req, Res> {
  private busy = false;
  private waiting: Req | null = null;

  constructor(
    private readonly run: (req: Req) => Promise<Res>,
    private readonly done: (res: Res) => void,
    private readonly fail: (e: unknown) => void,
  ) {}

  request(req: Req): void {
    if (this.busy) {
      this.waiting = req;
      return;
    }
    void this.go(req);
  }

  private async go(req: Req): Promise<void> {
    this.busy = true;
    try {
      this.done(await this.run(req));
    } catch (e) {
      this.fail(e);
    } finally {
      this.busy = false;
      const next = this.waiting;
      this.waiting = null;
      if (next) void this.go(next);
    }
  }
}

class AppStore {
  private history = new DocHistory(createDemoPart());
  private api: Comlink.Remote<KernelApi>;
  private listeners = new Set<() => void>();
  private seq = 0;
  private inFlight = false;
  private pending = false;
  private sketchSeq = 0;
  private sketchRunner: LatestRunner<SketchSolveRequest, SketchSolvePayload>;
  private state: UiState;
  /** Where 「儲存檔案」 writes (F7.1); null until the part is saved or opened from a writable file. */
  private fileHandle: FileSystemFileHandle | null = null;
  /** The document text as last opened or saved: the document is 「dirty」 when it serializes differently. */
  private savedText: string;
  /** Imported data by SHA-256, saved with the document (1F). */
  private blobs = new Map<string, Uint8Array>();
  /** New parts of this session are numbered like SolidWorks: 零件1, 零件2 … */
  private untitledCount = 0;
  private untitledAssemblies = 0;
  /** The open assembly; null while a part is open. */
  assembly: AssemblyStore | null = null;
  /** The project folder of this session (B9.4): assemblies and the parts they use are inside it. */
  private project: FileSystemDirectoryHandle | null = null;
  /** Answers the open project-folder dialog. */
  private folderAnswer: ((folder: FileSystemDirectoryHandle | null) => void) | null = null;
  /** The viewport registers itself so view actions (fit, standard views) can reach it. */
  viewer: Viewer | null = null;
  /** Tools of the sketch being edited (null outside sketch sessions). */
  sketcher: SketchController | null = null;

  constructor() {
    const worker = new Worker(new URL('../worker/kernel.worker.ts', import.meta.url), { type: 'module' });
    this.api = Comlink.wrap<KernelApi>(worker);
    this.savedText = serializePart(this.history.doc);
    this.state = {
      doc: this.history.doc,
      canUndo: false,
      canRedo: false,
      selected: null,
      selectedFace: null,
      editing: null,
      result: null,
      sketchSolve: null,
      dimensionEdit: null,
      confirmDelete: null,
      whatsWrong: false,
      fileName: null,
      dirty: false,
      unsaved: null,
      fitRequest: 0,
      untitled: '零件1',
      rebuilding: false,
      bootMs: null,
      bootError: null,
      notice: null,
      active: 'part',
      asm: null,
      projectName: null,
      folderRequest: null,
    };
    this.sketchRunner = new LatestRunner(
      (req) => this.api.solveSketch(req),
      (res) => {
        if (this.state.editing?.kind !== 'sketch') return;
        // Drag frames are not analyzed: keep the last per-entity colours until the next analysis.
        const prev = this.state.sketchSolve;
        this.set({ sketchSolve: res.entityStatus || !prev?.entityStatus ? res : { ...res, entityStatus: prev.entityStatus } });
      },
      (e) => this.set({ notice: { kind: 'error', text: `草圖求解失敗：${e instanceof Error ? e.message : String(e)}` } }),
    );
    this.history.subscribe(() => this.onDocChanged());
    this.api.init().then(
      (bootMs) => this.set({ bootMs }),
      (e: unknown) => this.set({ bootError: e instanceof Error ? e.message : String(e) }),
    );
    this.requestRebuild();
    // Closing the tab with unsaved changes asks first, like closing a modified document (risk 11: lost work).
    window.addEventListener('beforeunload', (e) => {
      if (this.activeDirty()) e.preventDefault();
    });
  }

  getState = (): UiState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<UiState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  private onDocChanged(): void {
    const doc = this.history.doc;
    this.set({ doc, canUndo: this.history.canUndo, canRedo: this.history.canRedo, dirty: serializePart(doc) !== this.savedText });
    // Inside a sketch only the sketch changes: solve it, and leave the model before it as it is.
    if (this.state.editing?.kind === 'sketch') this.requestSketchSolve();
    else this.requestRebuild();
  }

  notify(text: string, kind: Notice['kind'] = 'info'): void {
    this.set({ notice: { kind, text } });
  }

  // ------------------------------------------------------------ document commands (B7.1)

  execute(cmd: Command): boolean {
    try {
      this.history.execute(cmd);
      if (this.state.notice?.kind === 'error') this.set({ notice: null });
      return true;
    } catch (e) {
      this.notify(e instanceof CommandError ? e.message : String(e), 'error');
      return false;
    }
  }

  undo(): void {
    if (this.assembly) return this.assembly.undo();
    this.history.undo();
  }

  redo(): void {
    if (this.assembly) return this.assembly.redo();
    this.history.redo();
  }

  /** One selection at a time: a tree item or a face (a face selection clears the tree item and vice versa). */
  select(id: Id | null): void {
    this.set({ selected: id, selectedFace: null });
  }

  selectFace(face: Ref | null): void {
    this.set({ selectedFace: face, selected: null });
  }

  // ------------------------------------------------------------ FeatureManager operations (B2.4, B2.6, B2.8, D7.1)

  /** 「抑制」「恢復抑制」「恢復抑制（含相依特徵）」: the dependency graph decides which features change, in one step. */
  suppress(featureId: Id, action: SuppressAction): void {
    const featureIds = suppressionTargets(this.history.doc, featureId, action);
    if (featureIds.length > 0) this.execute({ type: 'setSuppressed', featureIds, value: action === 'suppress' });
  }

  /** Opens 「確認刪除」 for a feature (Delete key or context menu). */
  requestDelete(featureId: Id | null): void {
    if (featureId && this.state.editing) return;
    this.set({ confirmDelete: featureId });
  }

  deleteFeatures(featureIds: Id[]): void {
    if (this.execute({ type: 'deleteFeatures', featureIds })) {
      const selected = this.state.selected;
      this.set({ confirmDelete: null, ...(selected && featureIds.includes(selected) ? { selected: null } : {}) });
    }
  }

  /** 「回溯」 puts the bar right above the feature; 「推進至最後」 (null) evaluates everything again. */
  rollTo(featureId: Id | null): void {
    const index = featureId === null ? null : this.history.doc.features.findIndex((f) => f.id === featureId);
    if (index !== -1) this.execute({ type: 'setRollback', index });
  }

  showWhatsWrong(open: boolean): void {
    this.set({ whatsWrong: open });
  }

  /**
   * The plane a sketch lies on: a default plane, or the plane the last rebuild found for it. A new
   * sketch has not been rebuilt yet: it takes its reference plane's frame, or its face's fingerprint.
   */
  frameOf(sketch: SketchFeature): PlaneFrame | null {
    const plane = sketch.plane;
    if (plane.kind === 'datum' && isDatumPlaneName(plane.name)) return DATUM_PLANES[plane.name];
    const frames = this.state.result?.frames;
    return frames?.get(sketch.id) ?? (plane.kind === 'datum' ? (frames?.get(plane.name) ?? null) : faceFrame(plane));
  }

  /** A default plane or a reference plane feature, by the id the FeatureManager uses. */
  isPlane(id: Id): boolean {
    return isDatumPlaneName(id) || findFeature(this.history.doc, id)?.type === 'refPlane';
  }

  private allocator(): IdAllocator {
    const doc = this.history.doc;
    return new IdAllocator(doc.idCounters, idsInUse(doc));
  }

  // ------------------------------------------------------------ edit sessions (B7.3, D2.3)

  beginEdit(featureId: Id): void {
    if (this.state.editing) this.commitEdit();
    const f = findFeature(this.history.doc, featureId);
    if (!f) return;
    this.history.begin(`編輯 ${f.name}`);
    if (f.type === 'sketch') return this.enterSketch(f, false);
    this.set({ editing: { featureId, kind: 'feature' }, selected: featureId });
    this.requestRebuild();
  }

  /**
   * Starts a session that creates a feature (SolidWorks: the PropertyManager of a new feature).
   * Cancel removes the feature again; undo inside the session never does.
   */
  private startNew(feature: Feature, label: string): boolean {
    if (this.state.editing) this.commitEdit();
    const doc = this.history.doc;
    this.history.begin(label);
    try {
      this.history.execute({ type: 'insertFeature', feature, index: doc.rollbackIndex ?? doc.features.length });
    } catch (e) {
      this.history.rollback();
      this.notify(e instanceof CommandError ? e.message : String(e), 'error');
      return false;
    }
    this.history.markSessionBase();
    this.set({ canUndo: this.history.canUndo, canRedo: this.history.canRedo });
    return true;
  }

  /** 「草圖」 on a selected default plane, reference plane or planar face (C1.1): a new sketch, viewed normal to its plane. */
  newSketch(plane: DatumPlaneName | Ref): void {
    const ref: Ref = typeof plane === 'string' ? { kind: 'datum', name: plane } : plane;
    if (ref.kind === 'face' && !faceFrame(ref)) return this.notify('草圖只能放在平面上', 'error');
    const doc = this.history.doc;
    const feature: SketchFeature = {
      id: this.allocator().take('sketch'),
      type: 'sketch',
      name: nextName(doc, '草圖'),
      suppressed: false,
      plane: ref,
      entities: [],
      constraints: [],
    };
    if (this.startNew(feature, '新草圖')) this.enterSketch(feature, true);
  }

  /** The sketch selected in the FeatureManager, for the features built from one. */
  private selectedSketch(): SketchFeature | null {
    const sketch = findFeature(this.history.doc, this.state.selected ?? '');
    if (sketch?.type === 'sketch') return sketch;
    this.notify('請先在設計樹中選擇一個草圖');
    return null;
  }

  private openNew(feature: Feature, label: string): void {
    if (!this.startNew(feature, label)) return;
    this.set({ editing: { featureId: feature.id, kind: 'feature' }, selected: feature.id, selectedFace: null });
    this.requestRebuild();
  }

  /** 「伸長填料/基材」 or 「伸長除料」 from the selected sketch (C4.1, C4.2). */
  newExtrude(op: 'boss' | 'cut'): void {
    const sketch = this.selectedSketch();
    if (!sketch) return;
    const base = op === 'boss' ? '伸長' : '除料-伸長';
    const id = this.allocator().take(op === 'boss' ? 'extrude' : 'cut');
    this.openNew({ id, type: 'extrude', name: nextName(this.history.doc, base), suppressed: false, sketch: sketch.id, op, dir1: { type: 'blind', depth: '10' } }, base);
  }

  /** 「旋轉填料/基材」 or 「旋轉除料」 (C4.3) about the sketch's centerline (or its only line). */
  newRevolve(op: 'boss' | 'cut'): void {
    const sketch = this.selectedSketch();
    if (!sketch) return;
    const lines = sketch.entities.filter((e) => e.type === 'line');
    const axis = lines.find((e) => e.construction) ?? (lines.length === 1 ? lines[0] : undefined);
    if (!axis) return this.notify('旋轉需要草圖中的一條中心線作為旋轉軸', 'error');
    const base = op === 'boss' ? '旋轉' : '除料-旋轉';
    const id = this.allocator().take('revolve');
    this.openNew({ id, type: 'revolve', name: nextName(this.history.doc, base), suppressed: false, sketch: sketch.id, axis: axis.id, op, dir1: { type: 'blind', angle: '360' } }, base);
  }

  /** 「圓角」 (C5.1): picks edges on the model in the PropertyManager session. */
  newFillet(): void {
    const id = this.allocator().take('fillet');
    this.openNew({ id, type: 'fillet', name: nextName(this.history.doc, '圓角'), suppressed: false, edges: [], radius: '2' }, '圓角');
  }

  /**
   * 「基準面」 (C3.2): 10 mm off the plane or planar face that is selected (the front plane when
   * nothing is); the PropertyManager changes the type and the references.
   */
  newRefPlane(): void {
    const s = this.state;
    const plane: Ref =
      s.selected !== null && this.isPlane(s.selected)
        ? { kind: 'datum', name: s.selected }
        : s.selectedFace?.fingerprint?.type === 'plane'
          ? s.selectedFace
          : { kind: 'datum', name: 'plane:front' };
    const id = this.allocator().take('plane');
    this.openNew({ id, type: 'refPlane', name: nextName(this.history.doc, '基準面'), suppressed: false, def: { mode: 'offset', plane, distance: '10' } }, '基準面');
  }

  /** 「導角」 (C5.3), angle–distance by default like SolidWorks. */
  newChamfer(): void {
    const id = this.allocator().take('chamfer');
    this.openNew({ id, type: 'chamfer', name: nextName(this.history.doc, '導角'), suppressed: false, edges: [], mode: 'angleDistance', distance: '1', second: '45' }, '導角');
  }

  private enterSketch(sketch: SketchFeature, fresh: boolean): void {
    const frame = this.frameOf(sketch);
    if (!frame) {
      this.history.rollback();
      return this.notify('找不到草圖所在的平面（先修正草圖前面的特徵）', 'error');
    }
    this.sketcher = new SketchController(this.sketchHost(sketch.id));
    this.set({ editing: { featureId: sketch.id, kind: 'sketch' }, selected: sketch.id, selectedFace: null, sketchSolve: null, dimensionEdit: null });
    this.requestRebuild(); // the model up to the sketch
    this.requestSketchSolve();
    if (fresh) this.viewer?.lookAt(frame);
  }

  commitEdit(): void {
    if (!this.state.editing) return;
    this.history.commit();
    this.leaveSession();
  }

  cancelEdit(): void {
    if (!this.state.editing) return;
    this.history.rollback();
    this.leaveSession();
  }

  private leaveSession(): void {
    this.sketcher = null;
    this.set({ editing: null, sketchSolve: null, dimensionEdit: null, canUndo: this.history.canUndo, canRedo: this.history.canRedo });
    this.requestRebuild();
  }

  /**
   * Edge list of a fillet or chamfer (D2.1): clicking an edge toggles it, like the SolidWorks
   * selection box. Takes the persistent reference resolved by the viewport from the mesh it is
   * displaying, never an index into some other result (H3, SSOT).
   */
  toggleEdge(ref: Ref): void {
    const e = this.state.editing;
    if (!e || ref.kind !== 'edge') return;
    const f = this.history.doc.features.find((x) => x.id === e.featureId);
    if (f?.type !== 'fillet' && f?.type !== 'chamfer') return;
    const exists = f.edges.some((x) => x.name === ref.name);
    const edges = exists ? f.edges.filter((x) => x.name !== ref.name) : [...f.edges, ref];
    this.execute({ type: 'setEdges', featureId: f.id, edges });
  }

  /** The feature of the PropertyManager session, as it is in the document now. */
  private editedFeature(): Feature | undefined {
    const e = this.state.editing;
    return e?.kind === 'feature' ? findFeature(this.history.doc, e.featureId) : undefined;
  }

  /** An element picked in the graphics area goes to the selection box of the feature being edited that takes its kind. */
  pick(ref: Ref): void {
    const f = this.editedFeature();
    if (f?.type === 'fillet' || f?.type === 'chamfer') this.toggleEdge(ref);
    else if (f?.type === 'extrude') this.setUpToFace(ref);
    else if (f?.type === 'refPlane') this.setPlaneRef(ref);
  }

  /** A click in the FeatureManager selects; while a plane is being defined it picks a plane like SolidWorks' flyout tree. */
  treeClick(id: Id): void {
    const f = this.editedFeature();
    if (f?.type === 'refPlane' && f.def.mode !== 'threePoint' && id !== f.id && this.isPlane(id)) return this.setPlaneRef({ kind: 'datum', name: id });
    this.select(id);
  }

  /**
   * References of the plane being defined (C3.2): a plane (datum or planar face) for offset and angle
   * planes, a straight edge as the axis of an angle plane, and up to three vertices, toggled by clicking.
   */
  setPlaneRef(ref: Ref): void {
    const f = this.editedFeature();
    if (f?.type !== 'refPlane') return;
    const d = f.def;
    const set = (def: PlaneDefinition) => this.execute({ type: 'setRefPlane', featureId: f.id, def });
    if (d.mode === 'threePoint') {
      if (ref.kind !== 'vertex') return;
      if (d.points.some((p) => p.name === ref.name)) return void set({ ...d, points: d.points.filter((p) => p.name !== ref.name) });
      if (d.points.length >= 3) return this.notify('已選三個點；點選已選的點可移除它');
      return void set({ ...d, points: [...d.points, ref] });
    }
    if (ref.kind === 'edge' && d.mode === 'angle') {
      if (ref.fingerprint?.type !== 'line') return this.notify('旋轉軸必須是直線邊線', 'error');
      return void set({ ...d, axis: ref });
    }
    if (ref.kind === 'face' && ref.fingerprint?.type !== 'plane') return this.notify('參考面必須是平面', 'error');
    if (ref.kind === 'face' || ref.kind === 'datum') set({ ...d, plane: ref });
  }

  /** 「成形至某一面」: the face picked in the graphics area ends the extrusion being edited. */
  setUpToFace(face: Ref): void {
    const e = this.state.editing;
    const f = e ? findFeature(this.history.doc, e.featureId) : undefined;
    if (f?.type !== 'extrude' || f.dir1.type !== 'upToFace') return;
    this.execute({ type: 'setEndCondition', featureId: f.id, dir: 'dir1', value: { ...f.dir1, face } });
  }

  /**
   * While editing a fillet, chamfer or sketch, show the model before it (edges are picked on that
   * model); a reference plane is evaluated too, on the model before it, so that it can be previewed.
   */
  private until(): number | undefined {
    const e = this.state.editing;
    if (!e) return undefined;
    const i = this.history.doc.features.findIndex((f) => f.id === e.featureId);
    const type = this.history.doc.features[i]?.type;
    if (type === 'refPlane') return i + 1;
    return type === 'fillet' || type === 'chamfer' || type === 'sketch' ? i : undefined;
  }

  // ------------------------------------------------------------ sketch sessions (C1)

  /** The sketch being edited, as it is in the document now. */
  editedSketch(): SketchFeature | null {
    const e = this.state.editing;
    const f = e?.kind === 'sketch' ? findFeature(this.history.doc, e.featureId) : undefined;
    return f?.type === 'sketch' ? f : null;
  }

  private requestSketchSolve(options: Omit<SketchSolveRequest, 'seq' | 'sketch'> = { analyze: true }): void {
    const sketch = this.editedSketch();
    if (sketch) this.sketchRunner.request({ seq: ++this.sketchSeq, sketch, ...options });
  }

  private sketchHost(featureId: Id): SketchHost {
    return {
      featureId,
      doc: () => this.history.doc,
      solved: () => this.state.sketchSolve,
      execute: (cmd) => this.execute(cmd),
      dragPreview: (o) => {
        if (o) this.requestSketchSolve({ drag: o.drag, initial: o.initial, analyze: false });
      },
      trial: (sketch) => this.api.solveSketch({ seq: -1, sketch }),
      notify: (text, kind) => this.notify(text, kind),
      editDimension: (id) => this.set({ dimensionEdit: id }),
    };
  }

  editDimension(id: Id | null): void {
    this.set({ dimensionEdit: id });
  }

  /** Modify box (D6.1): Enter sets the value; an invalid value keeps the box open. */
  setDimensionValue(constraintId: Id, value: string): boolean {
    const sketch = this.editedSketch();
    if (!sketch) return false;
    const ok = this.execute({ type: 'setDimension', featureId: sketch.id, constraintId, value });
    if (ok) this.set({ dimensionEdit: null });
    return ok;
  }

  // ------------------------------------------------------------ rebuild (B3.5: off the UI thread)

  /** 「重新計算」; in an assembly it reads the part files again, so changed parts show as they are now. */
  rebuild(): void {
    if (this.assembly) return this.assembly.reload();
    this.requestRebuild();
  }

  private requestRebuild(): void {
    if (this.inFlight) {
      this.pending = true;
      return;
    }
    void this.run();
  }

  private async run(): Promise<void> {
    this.inFlight = true;
    const seq = ++this.seq;
    this.set({ rebuilding: true });
    try {
      const until = this.until();
      const result = await this.api.rebuild({ seq, doc: this.history.doc, ...(until === undefined ? {} : { until }) });
      // A queued request supersedes this result: showing it would briefly contradict the current document.
      if (result.seq === this.seq && !this.pending) this.set({ result });
    } catch (e) {
      this.notify(`重新計算失敗：${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      this.inFlight = false;
      if (this.pending) {
        this.pending = false;
        void this.run();
      } else {
        this.set({ rebuilding: false });
      }
    }
  }

  // ------------------------------------------------------------ files (F1.1, F7.1, B9.1)

  /** The open document's name: its file's name once saved or opened, as SolidWorks shows it (see partName). */
  documentName(): string {
    if (this.assembly) return this.assembly.name();
    return partName(this.history.doc, this.state.fileName, this.state.untitled);
  }

  async exportStep(): Promise<void> {
    try {
      const name = this.documentName();
      const text = await this.api.exportStep(this.history.doc, name);
      download(stepFileName(name), text, 'application/step');
      this.notify(`已輸出 ${stepFileName(name)}`);
    } catch (e) {
      this.notify(`STEP 輸出失敗：${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }

  /** 「新零件」: an empty part with the default planes (B1.4). */
  newPart(): void {
    this.guard('new-part');
  }

  newDemo(): void {
    this.guard('new-demo');
  }

  /** 「新組合件」 (B1.1): an empty assembly; the first 「插入零組件」 asks for the project folder if there is none yet. */
  newAssembly(): void {
    this.guard('new-assembly');
  }

  /**
   * 「開啟舊檔」: a `.3dbx` part, a `.3db.json` saved by an older version (B9.2), a `.3dba` assembly,
   * or a STEP file to start a part from.
   */
  open(): void {
    this.guard('open');
  }

  private activeDirty(): boolean {
    return this.assembly ? this.assembly.getState().dirty : this.state.dirty;
  }

  /** Replacing a modified document asks 「要儲存變更嗎？」 first, as SolidWorks does. */
  private guard(action: PendingFileAction): void {
    if (this.activeDirty()) this.set({ unsaved: action });
    else void this.perform(action);
  }

  /** The answer to 「要儲存變更嗎？」: save first (and go on only if that worked), go on without saving, or stay. */
  async answerUnsaved(answer: 'save' | 'discard' | 'cancel'): Promise<void> {
    const action = this.state.unsaved;
    this.set({ unsaved: null });
    if (!action || answer === 'cancel') return;
    if (answer === 'save' && !(await this.save())) return;
    await this.perform(action);
  }

  private async perform(action: PendingFileAction): Promise<void> {
    if (action === 'open') return this.openFile();
    if (action === 'new-assembly') {
      return this.showAssembly({ doc: createEmptyAssembly(), handle: null, fileName: null, folder: '', untitled: `組合件${++this.untitledAssemblies}`, project: this.project });
    }
    if (action === 'new-demo') return this.load(createDemoPart(), null, null);
    this.load(createEmptyPart(), null, null, new Map(), `零件${++this.untitledCount}`);
  }

  private async openFile(): Promise<void> {
    try {
      const picked = await pickFileToOpen(this.project);
      if (!picked) return;
      if (isStepFile(picked)) {
        // Like SolidWorks: a new, unsaved part named after the file, holding the imported body.
        this.load(createEmptyPart(), null, null, new Map(), picked.name.replace(/\.(step|stp)$/i, ''));
        return await this.importData(picked.name, picked.bytes);
      }
      const file = await readDocumentFile(picked.bytes);
      if (file.kind === 'assembly') return await this.openAssembly(picked, file.doc);
      // A file in the old format is never overwritten with the new one: its first save asks for a name.
      this.load(file.doc, file.format === '3dbx' ? picked.handle : null, picked.name, file.blobs);
      const notes = [...(file.format === 'json' ? ['舊版格式，儲存時會另存為 .3dbx'] : []), ...file.warnings];
      this.notify(`已開啟 ${picked.name}${notes.length ? `（${notes.join('；')}）` : ''}`, file.warnings.length ? 'error' : 'info');
    } catch (e) {
      // After 「儲存」 in the unsaved-changes prompt the browser may refuse a second file dialog.
      if (e instanceof DOMException && (e.name === 'SecurityError' || e.name === 'NotAllowedError')) return this.notify('請再按一次「開啟舊檔」');
      this.notify(`無法開啟：${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }

  /** 「輸入 STEP」 (F2.1): the file's solids become an imported body at the rollback bar, in one undoable step. */
  async importStep(): Promise<void> {
    try {
      const picked = await pickStepFile();
      if (picked) await this.importData(picked.name, picked.bytes);
    } catch (e) {
      this.notify(`無法輸入：${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }

  /**
   * The data goes to the worker before the command that uses it, so the first rebuild finds it. It is
   * kept in the session even if the feature is deleted later: undo can bring the feature back.
   */
  private async importData(fileName: string, data: Uint8Array): Promise<void> {
    const sha256 = await sha256Hex(data);
    await this.api.addBlob(sha256, data);
    this.blobs.set(sha256, data);
    const doc = this.history.doc;
    const ids = this.allocator();
    const blob: BlobRef = { id: ids.take('blob'), sha256, kind: 'step', fileName };
    const feature: ImportedBodyFeature = { id: ids.take('import'), type: 'importedBody', name: nextName(doc, '輸入'), suppressed: false, blob: blob.id };
    if (this.execute({ type: 'importBody', blob, feature, index: doc.rollbackIndex ?? doc.features.length })) {
      this.set({ selected: feature.id, selectedFace: null, fitRequest: this.state.fitRequest + 1 });
      this.notify(`已輸入 ${fileName}`);
    }
  }

  /** 「儲存檔案」: into the file the document came from; one never saved asks for a name. True when saved. */
  async save(): Promise<boolean> {
    if (this.assembly) return this.assembly.save();
    return this.fileHandle ? this.write(this.fileHandle) : this.saveAs();
  }

  /** 「另存新檔」. True when saved. */
  async saveAs(): Promise<boolean> {
    if (this.assembly) return this.assembly.saveAs();
    const name = partFileName(this.documentName());
    try {
      const target = await pickSaveTarget(name);
      if (target === null) return false;
      if (target !== 'download') return await this.write(target);
      // Without file access the part is downloaded; the next save downloads again.
      const doc = this.history.doc;
      download(name, (await writePartFile(doc, this.blobs)) as Uint8Array<ArrayBuffer>, 'application/octet-stream');
      this.saved(doc, null, name);
      this.notify(`已下載 ${name}（這個瀏覽器不能直接寫入檔案）`);
      return true;
    } catch (e) {
      this.notify(`存檔失敗：${e instanceof Error ? e.message : String(e)}`, 'error');
      return false;
    }
  }

  private async write(handle: FileSystemFileHandle): Promise<boolean> {
    const doc = this.history.doc; // what is written, even if an edit lands while writing
    try {
      await writeFile(handle, await writePartFile(doc, this.blobs));
      this.saved(doc, handle, handle.name);
      this.notify(`已儲存 ${handle.name}`);
      return true;
    } catch (e) {
      this.notify(`存檔失敗：${e instanceof Error ? e.message : String(e)}`, 'error');
      return false;
    }
  }

  private saved(doc: PartDoc, handle: FileSystemFileHandle | null, fileName: string): void {
    this.fileHandle = handle;
    this.savedText = serializePart(doc);
    this.set({ fileName, dirty: serializePart(this.history.doc) !== this.savedText });
  }

  private load(doc: PartDoc, handle: FileSystemFileHandle | null, fileName: string | null, blobs = new Map<string, Uint8Array>(), untitled = this.state.untitled): void {
    this.closeAssembly();
    if (this.state.editing) this.cancelEdit();
    this.history = new DocHistory(doc);
    this.history.subscribe(() => this.onDocChanged());
    this.fileHandle = handle;
    this.blobs = blobs;
    void this.api.setBlobs(blobs); // posted before the rebuild request, so the worker has them first
    this.savedText = serializePart(doc);
    this.set({ active: 'part', selected: null, selectedFace: null, result: null, fileName, untitled, fitRequest: this.state.fitRequest + 1 });
    this.onDocChanged();
  }

  // ------------------------------------------------------------ assemblies (B1.1, B9.4)

  /** The assembly becomes the open document; the part is put away (one document at a time). */
  private showAssembly(source: AssemblySource): void {
    this.load(createEmptyPart(), null, null);
    this.assembly = new AssemblyStore(
      {
        api: this.api,
        changed: (asm) => this.set({ asm }),
        notify: (text, kind) => this.notify(text, kind),
        projectFolder: (reason) => this.projectFolder(reason),
      },
      source,
    );
    this.set({ active: 'assembly', asm: this.assembly.getState() });
  }

  private closeAssembly(): void {
    if (!this.assembly) return;
    this.assembly.close();
    this.assembly = null;
    this.set({ asm: null });
  }

  /**
   * An assembly is opened inside a project folder that contains it: its parts are found from there.
   * Without one, or when the file is elsewhere, the user is asked for the folder.
   */
  private async openAssembly(picked: OpenedFile, doc: AssemblyDoc): Promise<void> {
    if (!picked.handle) return this.notify(FOLDERS_UNSUPPORTED, 'error');
    let folder = this.project;
    let path = folder ? await pathIn(folder, picked.handle) : null;
    let reason = `「${picked.name}」引用其他檔案。請選擇包含它和它的零件的專案資料夾。`;
    while (path === null) {
      folder = await this.askForFolder(reason);
      if (!folder) return; // nothing is opened; the current document stays
      path = await pathIn(folder, picked.handle);
      reason = `資料夾「${folder.name}」不包含「${picked.name}」。請選擇包含它的資料夾（可以是更上層的資料夾）。`;
    }
    this.useProject(folder!);
    this.showAssembly({ doc, handle: picked.handle, fileName: picked.name, folder: dirName(path), untitled: '組合件1', project: folder });
    this.notify(`已開啟 ${picked.name}`);
  }

  private async projectFolder(reason: string): Promise<FileSystemDirectoryHandle | null> {
    if (this.project) return this.project;
    const folder = await this.askForFolder(reason);
    if (folder) this.useProject(folder);
    return folder;
  }

  private useProject(folder: FileSystemDirectoryHandle): void {
    this.project = folder;
    this.set({ projectName: folder.name });
  }

  /** Opens the project-folder dialog: the folder picker needs a click of its own, on the dialog's button. */
  private askForFolder(reason: string): Promise<FileSystemDirectoryHandle | null> {
    this.folderAnswer?.(null);
    return new Promise((resolve) => {
      this.folderAnswer = resolve;
      this.set({ folderRequest: reason });
    });
  }

  /** 「選擇資料夾…」 in the project-folder dialog. */
  async chooseFolder(): Promise<void> {
    try {
      const folder = await pickProjectFolder();
      if (folder) this.answerFolder(folder);
    } catch (e) {
      this.notify(`無法選擇資料夾：${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }

  cancelFolder(): void {
    this.answerFolder(null);
  }

  private answerFolder(folder: FileSystemDirectoryHandle | null): void {
    const answer = this.folderAnswer;
    this.folderAnswer = null;
    this.set({ folderRequest: null });
    answer?.(folder);
  }

  dismissNotice(): void {
    this.set({ notice: null });
  }
}

export const store = new AppStore();

export function useStore<T>(selector: (s: UiState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}

/** The open document's name (FeatureManager, dialogs): its file's name once saved or opened. */
export function useDocumentName(): string {
  const doc = useStore((s) => s.doc);
  const fileName = useStore((s) => s.fileName);
  const untitled = useStore((s) => s.untitled);
  const asm = useStore((s) => s.asm);
  return asm ? assemblyName(asm.fileName, asm.untitled) : partName(doc, fileName, untitled);
}

/** The document as a title bar shows it: file name (or its name if never saved), 「*」 when modified. */
export function useDocumentTitle(): string {
  const partFile = useStore((s) => s.fileName);
  const partDirty = useStore((s) => s.dirty);
  const asm = useStore((s) => s.asm);
  const name = useDocumentName();
  const [fileName, dirty] = asm ? [asm.fileName, asm.dirty] : [partFile, partDirty];
  return `${fileName ?? name}${dirty ? ' *' : ''}`;
}

const noSubscription = () => () => {};

/** Tool/selection state of the sketch being edited; null outside sketch sessions. */
export function useSketcherView(): ControllerView | null {
  useStore((s) => s.editing); // a new session brings a new controller
  const sketcher = store.sketcher;
  return useSyncExternalStore(sketcher ? sketcher.subscribe : noSubscription, () => sketcher?.getView() ?? null);
}
