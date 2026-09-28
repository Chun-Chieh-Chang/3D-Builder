import * as Comlink from 'comlink';
import { useSyncExternalStore } from 'react';
import {
  CommandError,
  createDemoPart,
  createEmptyPart,
  DATUM_PLANES,
  DocHistory,
  findFeature,
  FormatError,
  IdAllocator,
  idsInUse,
  isDatumPlaneName,
  parsePart,
  planeFrame,
  serializePart,
  type Command,
  type DatumPlaneName,
  type Feature,
  type Id,
  type PartDoc,
  type PlaneDefinition,
  type PlaneFrame,
  type Ref,
  type SketchFeature,
} from '@3db/model';
import { stepFileName } from '@3db/io';
import { suppressionTargets, type SuppressAction } from '@3db/regen/dag';
import type { Viewer } from '@3db/render';
import type { KernelApi, RebuildPayload, SketchSolvePayload, SketchSolveRequest } from '../worker/protocol';
import { SketchController, type ControllerView, type SketchHost } from '../sketcher/controller';

export interface EditSession {
  featureId: Id;
  /** A sketch session edits geometry in the graphics area; a feature session edits PropertyManager values. */
  kind: 'feature' | 'sketch';
}

export interface Notice {
  kind: 'error' | 'info';
  text: string;
}

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
  rebuilding: boolean;
  bootMs: { occtMs: number; gcsMs: number } | null;
  bootError: string | null;
  notice: Notice | null;
}

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  /** The viewport registers itself so view actions (fit, standard views) can reach it. */
  viewer: Viewer | null = null;
  /** Tools of the sketch being edited (null outside sketch sessions). */
  sketcher: SketchController | null = null;

  constructor() {
    const worker = new Worker(new URL('../worker/kernel.worker.ts', import.meta.url), { type: 'module' });
    this.api = Comlink.wrap<KernelApi>(worker);
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
      rebuilding: false,
      bootMs: null,
      bootError: null,
      notice: null,
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
    this.set({ doc: this.history.doc, canUndo: this.history.canUndo, canRedo: this.history.canRedo });
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
    this.history.undo();
  }

  redo(): void {
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

  rebuild(): void {
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

  // ------------------------------------------------------------ files (F1.1, F7.1)

  async exportStep(): Promise<void> {
    try {
      const text = await this.api.exportStep(this.history.doc);
      download(stepFileName(this.history.doc), text, 'application/step');
      this.notify(`已輸出 ${stepFileName(this.history.doc)}`);
    } catch (e) {
      this.notify(`STEP 輸出失敗：${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }

  saveFile(): void {
    const name = (this.history.doc.properties['零件名稱'] || 'part').replace(/[\\/:*?"<>|]+/g, '_');
    download(`${name}.3db.json`, serializePart(this.history.doc), 'application/json');
  }

  async openFile(file: File): Promise<void> {
    try {
      this.load(parsePart(await file.text()));
      this.notify(`已開啟 ${file.name}`);
    } catch (e) {
      this.notify(e instanceof FormatError ? e.message : `無法開啟：${String(e)}`, 'error');
    }
  }

  newDemo(): void {
    this.load(createDemoPart());
  }

  /** 「新零件」: an empty part with the default planes (B1.4). */
  newPart(): void {
    const doc = createEmptyPart();
    doc.properties = { 零件名稱: '零件1' };
    this.load(doc);
  }

  private load(doc: PartDoc): void {
    if (this.state.editing) this.cancelEdit();
    this.history = new DocHistory(doc);
    this.history.subscribe(() => this.onDocChanged());
    this.set({ selected: null, selectedFace: null, result: null });
    this.onDocChanged();
    this.viewer?.fitAll();
  }

  dismissNotice(): void {
    this.set({ notice: null });
  }
}

export const store = new AppStore();

export function useStore<T>(selector: (s: UiState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}

const noSubscription = () => () => {};

/** Tool/selection state of the sketch being edited; null outside sketch sessions. */
export function useSketcherView(): ControllerView | null {
  useStore((s) => s.editing); // a new session brings a new controller
  const sketcher = store.sketcher;
  return useSyncExternalStore(sketcher ? sketcher.subscribe : noSubscription, () => sketcher?.getView() ?? null);
}
