import type * as Comlink from 'comlink';
import {
  AssemblyHistory,
  assemblyIdsInUse,
  axisAngle,
  baseName,
  CommandError,
  composeRotations,
  DATUM_PLANES,
  dirName,
  evalAngle,
  evalLength,
  IDENTITY_ROTATION,
  IdAllocator,
  isDatumPlaneName,
  joinPath,
  nextInstance,
  relativePath,
  relativePose,
  relocateAssembly,
  serializeAssembly,
  toPartPoint,
  transformPoint,
  type AssemblyCommand,
  type AssemblyDoc,
  type Component,
  type FileRef,
  type Id,
  type Mate,
  type MateRef,
  type MateType,
  type Pose,
  type Quat,
  type Vec3,
} from '@3db/model';
import { closerAlignment, currentValue, defaultType, hasAlignment, MATE_LABEL, placed, supportedTypes, type GoalTerm, type MateGeometry } from '@3db/assembly';
import { assemblyFileName, assemblyName, componentName, PART_FILE_EXTENSION, partNameOf, sha256Hex, writeAssemblyFile } from '@3db/io';
import type { AssemblyResult } from '@3db/regen';
import type { AssemblyStepRequest, KernelApi, PartBuildPayload } from '../worker/protocol';
import { fileIn, listFiles, pathIn, pickAssemblySaveTarget, pickPartFile, writeFile } from '../files';

/** A part file of the assembly, by its path in the project folder: read and rebuilt, or why not. */
export type FileStatus = { status: 'loading' } | { status: 'ok'; key: string } | { status: 'missing' | 'error'; message: string };

/** 「插入零組件」 (C15.1). */
export interface InsertState {
  /** Part files and STEP files in the project folder; null while the folder is being read. */
  files: string[] | null;
  /** The folder held too much to read all of it: the list is partial. */
  truncated?: boolean;
  /** The part to place, by its path in the project folder. */
  chosen: string | null;
}

/** The mate being defined in its PropertyManager (C15.8): two elements, a type and its options. */
export interface MateDraft {
  /** The mate being edited; null for a new one. */
  editing: Id | null;
  a: MateRef | null;
  b: MateRef | null;
  type: MateType | null;
  align?: 'aligned' | 'antiAligned';
  /** Distance (mm) or angle (degrees), as typed. */
  value?: string;
  flip?: boolean;
}

/** The mate a draft shows before it is added: solved with the others, not yet in the document. */
export const PREVIEW_MATE = 'preview';

/** A component being dragged (C15.3, A3.5): moved with the left button, turned with the right. */
export interface DragState {
  component: Id;
  mode: 'move' | 'rotate';
  /** Every component where the latest pointer position puts it (derived; shown instead of the solution). */
  poses: ReadonlyMap<Id, Pose> | null;
}

/** 「移動零組件」/「旋轉零組件」 (C15.3): what a left-button drag does while the PropertyManager is open. */
export interface MoveState {
  tool: 'move' | 'rotate';
}

/** A numeric move of the selected component: by ΔX ΔY ΔZ (mm), its origin to X Y Z, or turned about X, Y, Z (radians). */
export type MoveOp = { kind: 'by'; delta: Vec3 } | { kind: 'to'; position: Vec3 } | { kind: 'turn'; angles: Vec3 };

/** 「找不到參考的檔案」 (B9.4). */
export interface RelinkState {
  /** For each missing file (by file id), files of the project folder with its name: moved elsewhere. Null while looking. */
  candidates: ReadonlyMap<Id, string[]> | null;
}

/**
 * The open assembly's UI state. Its document (in AssemblyHistory) is the only source of truth; the
 * rest is session state (selection, the insert session) or derived data (files read, parts rebuilt).
 */
export interface AssemblyState {
  doc: AssemblyDoc;
  canUndo: boolean;
  canRedo: boolean;
  /** The file it was opened from or last saved to; null for an assembly never saved. */
  fileName: string | null;
  /** Name while never saved: 「組合件1」 … */
  untitled: string;
  dirty: boolean;
  /** The folder of the assembly file inside the project folder ("" = the project folder); file paths start from here. */
  folder: string;
  /** Part files by path in the project folder. */
  files: ReadonlyMap<string, FileStatus>;
  /** Rebuilt parts by content key. */
  builds: ReadonlyMap<string, PartBuildPayload>;
  /** A component, a mate, or a default plane ("plane:front" …). */
  selected: Id | null;
  insert: InsertState | null;
  /** The mate PropertyManager (C15.8); null while it is closed. */
  mate: MateDraft | null;
  /** The mates solved (A3.2, A3.4): where the components are, how defined, which mates hold. Derived. */
  solution: AssemblyResult | null;
  /** Components or mates whose 「確認刪除」 dialog is open. */
  confirmDelete: Id[] | null;
  /** Bumped when the view should fit the assembly once its parts are shown. */
  fitRequest: number;
  drag: DragState | null;
  /** The move PropertyManager (C15.3); null while it is closed. */
  move: MoveState | null;
  /** The dialog for part files that cannot be found (B9.4); null while it is closed. */
  relink: RelinkState | null;
}

export interface AssemblyHost {
  api: Comlink.Remote<KernelApi>;
  changed(state: AssemblyState): void;
  notify(text: string, kind?: 'info' | 'error'): void;
  /** The project folder; when there is none yet the user is asked, with `reason`. Null if they cancel. */
  projectFolder(reason: string): Promise<FileSystemDirectoryHandle | null>;
}

export interface AssemblySource {
  doc: AssemblyDoc;
  handle: FileSystemFileHandle | null;
  fileName: string | null;
  folder: string;
  untitled: string;
  project: FileSystemDirectoryHandle | null;
}

const round = (v: number) => Math.round(v * 1000) / 1000 + 0; // µm; "+ 0" turns −0 into 0
/** Two poses alike to within `tol` (mm, and quaternion components; the solver keeps w ≥ 0). */
const samePose = (a: Pose, b: Pose, tol: number) => a.position.every((v, i) => Math.abs(v - b.position[i]!) <= tol) && a.rotation.every((v, i) => Math.abs(v - b.rotation[i]!) <= tol);
const sameRef = (x: MateRef | null, y: MateRef) => !!x && x.component === y.component && x.ref.kind === y.ref.kind && x.ref.name === y.ref.name;
/** A value as the PropertyManager shows it: mm, or degrees for angles, to a thousandth. */
const shown = (type: MateType, v: number) => String(Math.round((type === 'angle' ? (v * 180) / Math.PI : v) * 1000) / 1000 + 0);

/**
 * One open assembly (B1.1). Parts are read from the project folder by the paths the document holds
 * (B9.4) and rebuilt in the worker once per file content, so an unchanged part is never rebuilt twice
 * and a changed one shows as it is now.
 */
export class AssemblyStore {
  private history: AssemblyHistory;
  private handle: FileSystemFileHandle | null;
  private savedText: string;
  private project: FileSystemDirectoryHandle | null;
  /** Kept apart from the state while the document is rewritten for a new folder (see saveAs). */
  private folder: string;
  private state: AssemblyState;
  private closed = false;
  /** Bumped by reload: reads started before it are stale. */
  private generation = 0;
  /** Solves run one at a time; while one runs, only the newest request waits. */
  private solving = false;
  private solveAgain = false;
  /** Each part file as it was when read (modified time and size), to notice when it is saved again. */
  private stamps = new Map<string, string>();
  private refreshing = false;
  /** Missing files are pointed out once, when the assembly has been read. */
  private missingShown = false;
  /** The drag in progress: where it was grabbed, and the solves it asked for. */
  private dragging: {
    component: Id;
    mode: 'move' | 'rotate';
    /** The grabbed point and the part's middle, in the part's coordinates; the middle and the orientation as the drag began. */
    grab: Vec3;
    center: Vec3;
    centerAt: Vec3;
    rotation: Quat;
    /** Where the last solve put everything: the next one starts there. */
    latest: ReadonlyMap<Id, Pose>;
    result: AssemblyResult | null;
    goal: GoalTerm[] | null;
    running: boolean;
    ending: boolean;
  } | null = null;
  private centers = new Map<string, Vec3>();

  constructor(
    private readonly host: AssemblyHost,
    source: AssemblySource,
  ) {
    this.history = new AssemblyHistory(source.doc);
    this.handle = source.handle;
    this.project = source.project;
    this.folder = source.folder;
    this.savedText = serializeAssembly(source.doc);
    this.state = {
      doc: source.doc,
      canUndo: false,
      canRedo: false,
      fileName: source.fileName,
      untitled: source.untitled,
      dirty: false,
      folder: source.folder,
      files: new Map(),
      builds: new Map(),
      selected: null,
      insert: null,
      mate: null,
      solution: null,
      confirmDelete: null,
      fitRequest: 1,
      drag: null,
      move: null,
      relink: null,
    };
    this.history.subscribe(() => this.onDocChanged());
    this.loadFiles();
    this.requestSolve();
  }

  getState = (): AssemblyState => this.state;

  /** The assembly is replaced by another document: nothing it still has running may show up. */
  close(): void {
    this.closed = true;
  }

  name(): string {
    return assemblyName(this.state.fileName, this.state.untitled);
  }

  private set(patch: Partial<AssemblyState>): void {
    if (this.closed) return;
    this.state = { ...this.state, ...patch };
    this.host.changed(this.state);
  }

  private onDocChanged(): void {
    const doc = this.history.doc;
    const selected = this.state.selected;
    const exists = (id: Id) => id.startsWith('plane:') || doc.components.some((c) => c.id === id) || doc.mates.some((m) => m.id === id);
    this.set({
      doc,
      folder: this.folder,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      dirty: serializeAssembly(doc) !== this.savedText,
      // What undo took away is no longer selected.
      selected: selected && !exists(selected) ? null : selected,
    });
    this.loadFiles();
    this.requestSolve();
  }

  execute(cmd: AssemblyCommand): boolean {
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

  // ------------------------------------------------------------ part files (B9.4)

  /** Where a file of the document is in the project folder. */
  pathOf(file: FileRef): string {
    return joinPath(this.state.folder, file.path);
  }

  private loadFiles(): void {
    for (const f of this.history.doc.files) this.load(joinPath(this.folder, f.path));
  }

  /** Reads every part file again: parts changed since they were read show as they are now. */
  reload(): void {
    this.generation += 1;
    this.set({ files: new Map() });
    this.loadFiles();
    const chosen = this.state.insert?.chosen;
    if (chosen) this.load(chosen);
  }

  private setFile(path: string, status: FileStatus): void {
    this.set({ files: new Map(this.state.files).set(path, status) });
  }

  private load(path: string): void {
    if (this.state.files.has(path)) return;
    this.setFile(path, { status: 'loading' });
    this.readInto(path);
  }

  /** Reads a file and shows what it holds now; until then the file shows as it was. */
  private readInto(path: string): void {
    const generation = this.generation;
    void this.read(path).then((status) => {
      if (generation !== this.generation) return; // reloaded meanwhile
      this.setFile(path, status);
      if (![...this.state.files.values()].some((s) => s.status === 'loading')) {
        this.settled();
        this.pointOutMissing();
      }
      this.requestSolve();
    });
  }

  private async read(path: string): Promise<FileStatus> {
    const project = this.project;
    if (!project) return { status: 'missing', message: '尚未選擇專案資料夾' };
    if (path === '..' || path.startsWith('../')) return { status: 'missing', message: `零件檔在專案資料夾「${project.name}」之外：${path}` };
    try {
      const file = await (await fileIn(project, path)).getFile();
      this.stamps.set(path, `${file.lastModified}:${file.size}`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const key = await sha256Hex(bytes);
      if (!this.state.builds.has(key)) {
        const build = await this.host.api.buildPart(key, bytes);
        this.set({ builds: new Map(this.state.builds).set(key, build) });
      }
      return { status: 'ok', key };
    } catch (e) {
      if (e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError')) {
        this.stamps.delete(path);
        return { status: 'missing', message: `找不到零件檔「${path}」` };
      }
      return { status: 'error', message: e instanceof Error ? e.message : String(e) };
    }
  }

  /**
   * 「零件改過後自動更新」 (B9.4): part files saved again since they were read (from another window, or
   * another program) are read again, and missing ones looked for again. Runs when the window comes back.
   */
  async refresh(): Promise<void> {
    const project = this.project;
    if (!project || this.refreshing || this.closed) return;
    this.refreshing = true;
    try {
      for (const f of this.history.doc.files) {
        const path = joinPath(this.folder, f.path);
        const status = this.state.files.get(path);
        if (!status || status.status === 'loading') continue;
        let stamp: string | null = null;
        try {
          const file = await (await fileIn(project, path)).getFile();
          stamp = `${file.lastModified}:${file.size}`;
        } catch {
          stamp = null;
        }
        if (stamp === null ? status.status === 'missing' : stamp === this.stamps.get(path) && status.status === 'ok') continue;
        this.readInto(path);
      }
    } finally {
      this.refreshing = false;
    }
  }

  /** Every file has been read: the worker lets go of parts nothing here uses. */
  private settled(): void {
    const paths = [...this.history.doc.files.map((f) => joinPath(this.folder, f.path)), ...(this.state.insert?.chosen ? [this.state.insert.chosen] : [])];
    const keys = paths.flatMap((p) => {
      const s = this.state.files.get(p);
      return s?.status === 'ok' ? [s.key] : [];
    });
    void this.host.api.retainParts(keys);
  }

  // ------------------------------------------------------------ solving (A3.2, A3.4)

  /** Each component's rebuilt part, by component id (parts not read yet are left out). */
  private keys(): Record<Id, string> {
    const keys: Record<Id, string> = {};
    for (const c of this.history.doc.components) {
      const file = this.history.doc.files.find((f) => f.id === c.file);
      const status = file && this.state.files.get(joinPath(this.folder, file.path));
      if (status?.status === 'ok') keys[c.id] = status.key;
    }
    return keys;
  }

  /** Solves the mates, with the mate being defined; a newer request replaces one still waiting. */
  private requestSolve(): void {
    if (this.solving) {
      this.solveAgain = true;
      return;
    }
    void this.solve();
  }

  private async solve(): Promise<void> {
    this.solving = true;
    try {
      const solution = await this.host.api.solveAssembly(this.solveDoc(), this.keys());
      if (!this.solveAgain) this.set({ solution });
    } catch (e) {
      this.host.notify(`結合求解失敗：${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      this.solving = false;
      if (this.solveAgain) {
        this.solveAgain = false;
        void this.solve();
      }
    }
  }

  /** The document as solved: with the mate being defined in place of (or after) the others. */
  private solveDoc(): AssemblyDoc {
    const doc = this.history.doc;
    const d = this.state.mate;
    const m = d && this.draftMate(d, false);
    if (!d || !m) return doc;
    return { ...doc, mates: d.editing ? doc.mates.map((x) => (x.id === d.editing ? m : x)) : [...doc.mates, m] };
  }

  /** Where a component is now: as dragged, as solved, or its placement until the first solve. */
  poseOf(componentId: Id): Pose | null {
    return this.state.drag?.poses?.get(componentId) ?? this.state.solution?.poses.get(componentId) ?? this.history.doc.components.find((c) => c.id === componentId)?.placement ?? null;
  }

  /**
   * The assembly as STEP is written (F1.2): each part file used once, each component where it is shown
   * now. Throws, saying why, when a part cannot be read (nothing is left out silently) or the mates are
   * still being solved (the poses would be the old ones).
   */
  stepRequest(): AssemblyStepRequest {
    const doc = this.history.doc;
    if (doc.components.length === 0) throw new Error('組合件沒有零組件');
    if (this.solving || this.solveAgain) throw new Error('結合正在求解，請稍後再輸出');
    const parts: AssemblyStepRequest['parts'] = [];
    const partOf = new Map<Id, number>();
    const unreadable: string[] = [];
    const seen = new Set<Id>();
    for (const c of doc.components) {
      if (seen.has(c.file)) continue;
      seen.add(c.file);
      const file = doc.files.find((f) => f.id === c.file);
      const status = file && this.state.files.get(joinPath(this.folder, file.path));
      if (!file || status?.status !== 'ok') {
        const why = status?.status === 'missing' || status?.status === 'error' ? status.message : '尚未讀取';
        unreadable.push(`${file?.path ?? c.file}（${why}）`);
        continue;
      }
      partOf.set(c.file, parts.length);
      parts.push({ key: status.key, name: partNameOf(file.path) });
    }
    if (unreadable.length) throw new Error(`有 ${unreadable.length} 個零件檔無法讀取：${unreadable.join('、')}`);
    const instances = doc.components.map((c) => {
      const file = doc.files.find((f) => f.id === c.file);
      return { part: partOf.get(c.file)!, name: componentName(file?.path, c.instance), pose: this.poseOf(c.id)! };
    });
    return { name: this.name(), parts, instances };
  }

  /** The rebuilt part of a component. */
  buildOf(componentId: Id): PartBuildPayload | null {
    const doc = this.history.doc;
    const c = doc.components.find((x) => x.id === componentId);
    const file = c && doc.files.find((f) => f.id === c.file);
    const status = file && this.state.files.get(joinPath(this.folder, file.path));
    return status?.status === 'ok' ? (this.state.builds.get(status.key) ?? null) : null;
  }

  /** An element's geometry where it is now, in assembly coordinates (for what the PropertyManager offers). */
  elementGeometry(ref: MateRef): MateGeometry | null {
    const { name, kind } = ref.ref;
    const datum = (): MateGeometry | null => {
      if (name === 'origin') return { kind: 'point', point: [0, 0, 0] };
      const frame = isDatumPlaneName(name) ? DATUM_PLANES[name] : ref.component ? this.buildOf(ref.component)?.planes.find((p) => p.id === name)?.frame : undefined;
      return frame ? { kind: 'plane', origin: frame.origin, normal: frame.normal } : null;
    };
    if (ref.component === null) return kind === 'datum' ? datum() : null;
    const build = this.buildOf(ref.component);
    const pose = this.poseOf(ref.component);
    if (!build || !pose) return null;
    let local: MateGeometry | null = null;
    if (kind === 'datum') local = datum();
    else if (kind === 'face') local = build.faceGeometry[build.faceNames.indexOf(name)] ?? null;
    else if (kind === 'edge') local = build.edgeGeometry[build.edgeNames.indexOf(name)] ?? null;
    else if (kind === 'vertex') {
      const i = build.vertexNames.indexOf(name);
      if (i >= 0) local = { kind: 'point', point: [build.vertexPoints[3 * i]!, build.vertexPoints[3 * i + 1]!, build.vertexPoints[3 * i + 2]!] };
    }
    return local && placed(local, pose);
  }

  // ------------------------------------------------------------ mates (C15.8, C15.12)

  /** 「結合」: opens the PropertyManager; elements are then picked in the graphics area or the flyout tree. */
  startMate(): void {
    if (this.state.insert) this.cancelInsert();
    if (this.state.move) this.closeMove();
    this.set({ mate: { editing: null, a: null, b: null, type: null }, selected: null });
  }

  /** 「編輯結合」: the PropertyManager with the mate's definition; ✓ replaces it. */
  editMate(id: Id): void {
    const m = this.history.doc.mates.find((x) => x.id === id);
    if (!m) return;
    if (this.state.insert) this.cancelInsert();
    const value = m.value === undefined ? {} : { value: m.value };
    this.set({ mate: { editing: id, a: m.a, b: m.b, type: m.type, ...(m.align ? { align: m.align } : {}), ...value, ...(m.flip ? { flip: true } : {}) }, selected: id });
    this.requestSolve();
  }

  /**
   * A picked element fills the first empty selection box; picking a chosen one again removes it; a
   * third replaces the second. With both chosen, the mate SolidWorks would suggest is set up.
   */
  pickElement(ref: MateRef): void {
    const d = this.state.mate;
    if (!d) return;
    let { a, b } = d;
    if (sameRef(a, ref)) [a, b] = [b, null];
    else if (sameRef(b, ref)) b = null;
    else {
      const other = a && b ? a : (a ?? b);
      if (other && other.component === ref.component) return this.host.notify('兩個元素必須在不同的零組件上（或一個是組合件本身的基準面）', 'error');
      if (!a) a = ref;
      else b = ref;
    }
    this.setDraft(this.suggested({ ...d, a, b }));
  }

  /** Type, alignment and value for a pair: kept when they still fit, else what SolidWorks would take. */
  private suggested(d: MateDraft): MateDraft {
    const ga = d.a && this.elementGeometry(d.a);
    const gb = d.b && this.elementGeometry(d.b);
    if (!ga || !gb) return { editing: d.editing, a: d.a, b: d.b, type: d.b ? d.type : null };
    const both = d.a!.component !== null && d.b!.component !== null;
    const type = d.type && supportedTypes(ga, gb, both).includes(d.type) ? d.type : defaultType(ga, gb, both);
    return this.withOptions({ ...d, type }, ga, gb, d.type === type);
  }

  /** The options a type needs, from the elements as they are now (unless kept from before). */
  private withOptions(d: MateDraft, ga: MateGeometry, gb: MateGeometry, keep: boolean): MateDraft {
    const out: MateDraft = { editing: d.editing, a: d.a, b: d.b, type: d.type };
    if (!d.type) return out;
    if (hasAlignment(d.type, ga, gb)) out.align = keep && d.align ? d.align : closerAlignment(ga, gb);
    const now = currentValue(d.type, ga, gb);
    if (now) {
      out.value = keep && d.value !== undefined ? d.value : shown(d.type, now.value);
      out.flip = keep && d.value !== undefined ? !!d.flip : now.flip;
    }
    return out;
  }

  /** The types the PropertyManager can offer for the chosen elements. */
  mateTypes(): MateType[] {
    const d = this.state.mate;
    const ga = d?.a && this.elementGeometry(d.a);
    const gb = d?.b && this.elementGeometry(d.b);
    return ga && gb ? supportedTypes(ga, gb, d!.a!.component !== null && d!.b!.component !== null) : [];
  }

  setMateType(type: MateType): void {
    const d = this.state.mate;
    const ga = d?.a && this.elementGeometry(d.a);
    const gb = d?.b && this.elementGeometry(d.b);
    if (d && ga && gb) this.setDraft(this.withOptions({ ...d, type }, ga, gb, false));
  }

  setMateOptions(options: Pick<MateDraft, 'align' | 'value' | 'flip'>): void {
    const d = this.state.mate;
    if (d) this.setDraft({ ...d, ...options });
  }

  private setDraft(mate: MateDraft): void {
    this.set({ mate });
    this.requestSolve();
  }

  /**
   * The draft as a mate: null until it is complete and its value reads. `final` gives a new mate its
   * id and name (a preview has neither).
   */
  private draftMate(d: MateDraft, final: boolean): Mate | null {
    if (!d.a || !d.b || !d.type) return null;
    const doc = this.history.doc;
    const before = d.editing ? doc.mates.find((m) => m.id === d.editing) : undefined;
    let value: string | undefined;
    if (d.type === 'distance' || d.type === 'angle') {
      value = d.value?.trim();
      try {
        if (!value) return null;
        const v = d.type === 'distance' ? evalLength(value) : evalAngle(value);
        if (!Number.isFinite(v) || v < 0) return null;
      } catch {
        return null;
      }
    }
    let relative: Pose | undefined;
    if (d.type === 'lock') {
      const same = before?.type === 'lock' && before.relative && before.a.component === d.a.component && before.b.component === d.b.component;
      const pa = d.a.component ? this.poseOf(d.a.component) : null;
      const pb = d.b.component ? this.poseOf(d.b.component) : null;
      relative = same ? before.relative : pa && pb ? relativePose(pa, pb) : undefined;
      if (!relative) return null;
    }
    const label = MATE_LABEL[d.type];
    const autoName = before && /^(重合|平行|垂直|相切|同軸心|鎖住|距離|角度)\d+$/.test(before.name);
    const name = before && (before.type === d.type || !autoName) ? before.name : final ? nextMateName(doc, label) : label;
    const id = d.editing ?? (final ? new IdAllocator(doc.idCounters, assemblyIdsInUse(doc)).take('mate') : PREVIEW_MATE);
    return {
      id,
      name,
      type: d.type,
      a: d.a,
      b: d.b,
      ...(d.align ? { align: d.align } : {}),
      ...(value !== undefined ? { value } : {}),
      ...(d.flip ? { flip: true } : {}),
      ...(relative ? { relative } : {}),
      suppressed: before?.suppressed ?? false,
    };
  }

  /**
   * ✓: adds the mate and keeps the PropertyManager open for the next one, as SolidWorks does; with
   * nothing chosen it closes. An edited mate is replaced and the PropertyManager closes.
   */
  applyMate(): void {
    const d = this.state.mate;
    if (!d) return;
    if (!d.a && !d.b && !d.editing) return this.cancelMate();
    const m = this.draftMate(d, true);
    if (!m) return this.host.notify(!d.a || !d.b ? '請選擇兩個要結合的元素' : '請檢查結合類型與數值', 'error');
    if (!this.execute(d.editing ? { type: 'setMate', mate: m } : { type: 'insertMate', mate: m })) return;
    if (d.editing) this.set({ mate: null, selected: m.id });
    else this.set({ mate: { editing: null, a: null, b: null, type: null } });
    this.requestSolve();
  }

  cancelMate(): void {
    this.set({ mate: null });
    this.requestSolve();
  }

  setMatesSuppressed(mateIds: Id[], value: boolean): void {
    if (mateIds.length > 0) this.execute({ type: 'setMatesSuppressed', mateIds, value });
  }

  // ------------------------------------------------------------ FeatureManager (C15.2, C15.12)

  select(id: Id | null): void {
    this.set({ selected: id });
  }

  /** 「固定」/「浮動」 (C15.2). */
  setFixed(componentIds: Id[], value: boolean): void {
    if (componentIds.length > 0) this.execute({ type: 'setFixed', componentIds, value });
  }

  /** 「確認刪除」 for components or mates. */
  requestDelete(ids: Id[] | null): void {
    if (ids && ids.length === 0) return;
    this.set({ confirmDelete: ids });
  }

  /** Deletes components (with their mates) and mates. */
  deleteItems(ids: Id[]): void {
    const doc = this.history.doc;
    const componentIds = ids.filter((id) => doc.components.some((c) => c.id === id));
    const mateIds = ids.filter((id) => doc.mates.some((m) => m.id === id));
    const ok = componentIds.length > 0 ? this.execute({ type: 'deleteComponents', componentIds }) : true;
    // Mates of deleted components went with them.
    const left = mateIds.filter((id) => this.history.doc.mates.some((m) => m.id === id));
    if (ok && (left.length === 0 || this.execute({ type: 'deleteMates', mateIds: left }))) this.set({ confirmDelete: null });
  }

  // ------------------------------------------------------------ 插入零組件 (C15.1)

  /** Opens the PropertyManager with the part files of the project folder. */
  async startInsert(): Promise<void> {
    if (this.getState().insert) return; // not this.state.insert: TypeScript would keep that narrowing past the awaits below
    if (this.state.mate) this.cancelMate();
    if (this.state.move) this.closeMove();
    const project = (this.project ??= await this.host.projectFolder('插入零組件會從專案資料夾讀取零件檔（.3dbx）與 STEP 檔；組合件也要存在這個資料夾之內，才能以相對路徑找到零件。'));
    if (!project) return;
    this.set({ insert: { files: null, chosen: null }, selected: null });
    let listed = { files: [] as string[], truncated: false };
    try {
      // STEP files are taken as parts, as SolidWorks inserts them (F2.1).
      listed = await listFiles(project, [PART_FILE_EXTENSION, '.step', '.stp']);
    } catch (e) {
      this.host.notify(`無法讀取專案資料夾：${e instanceof Error ? e.message : String(e)}`, 'error');
    }
    if (this.state.insert) this.set({ insert: { ...this.state.insert, files: listed.files, ...(listed.truncated ? { truncated: true } : {}) } });
  }

  /** The part to place; it is read and rebuilt at once so it can follow the cursor. */
  choosePart(path: string): void {
    const insert = this.state.insert;
    if (!insert) return;
    this.set({ insert: { ...insert, chosen: path } });
    this.load(path);
  }

  /** 「瀏覽」: a part file chosen with the system dialog; it must be inside the project folder. */
  async browse(): Promise<void> {
    const project = this.project;
    if (!project || !this.state.insert) return;
    try {
      const picked = await pickPartFile(project);
      if (!picked?.handle) return;
      const path = await pathIn(project, picked.handle);
      if (path === null) return this.host.notify(`零件檔必須在專案資料夾「${project.name}」之內`, 'error');
      this.choosePart(path);
    } catch (e) {
      this.host.notify(`無法開啟：${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }

  /**
   * Places the chosen part: where the user clicked, or at the origin (✓). The first component of an
   * assembly is fixed, the others float, as in SolidWorks.
   */
  place(at: Vec3 | null): void {
    const insert = this.state.insert;
    if (!insert) return;
    const chosen = insert.chosen;
    if (!chosen) return this.host.notify('請先選擇要插入的零件');
    const status = this.state.files.get(chosen);
    if (status?.status !== 'ok') return this.host.notify(status?.status === 'loading' ? '零件還在載入，請稍候' : `無法使用這個零件檔：${status && 'message' in status ? status.message : ''}`, 'error');
    const doc = this.history.doc;
    const path = relativePath(this.folder, chosen);
    const existing = doc.files.find((f) => f.path === path);
    const ids = new IdAllocator(doc.idCounters, assemblyIdsInUse(doc));
    const file: FileRef | undefined = existing ? undefined : { id: ids.take('file'), path };
    const component: Component = {
      id: ids.take('comp'),
      file: existing?.id ?? file!.id,
      instance: existing ? nextInstance(doc, existing.id) : 1,
      fixed: doc.components.length === 0,
      placement: { position: at ? [round(at[0]), round(at[1]), round(at[2])] : [0, 0, 0], rotation: [...IDENTITY_ROTATION] },
    };
    if (this.execute({ type: 'insertComponent', component, ...(file ? { file } : {}) })) {
      this.set({ insert: null, selected: component.id, ...(doc.components.length === 0 ? { fitRequest: this.state.fitRequest + 1 } : {}) });
    }
  }

  cancelInsert(): void {
    this.set({ insert: null });
  }

  // ------------------------------------------------------------ moving components (C15.3, A3.5)

  /** A component's name as the FeatureManager shows it: 「削邊銷<2>」. */
  componentLabel(componentId: Id): string {
    const doc = this.history.doc;
    const c = doc.components.find((x) => x.id === componentId);
    return c ? componentName(doc.files.find((f) => f.id === c.file)?.path, c.instance) : componentId;
  }

  /** The middle of a component's part (its bounding box), in the part's coordinates: what it turns about. */
  private centerOf(componentId: Id): Vec3 {
    const build = this.buildOf(componentId);
    if (!build?.mesh) return [0, 0, 0];
    let c = this.centers.get(build.key);
    if (!c) {
      const p = build.mesh.positions;
      const lo = [Infinity, Infinity, Infinity];
      const hi = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < p.length; i += 3) {
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k]!, p[i + k]!);
          hi[k] = Math.max(hi[k]!, p[i + k]!);
        }
      }
      c = p.length ? [(lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2, (lo[2]! + hi[2]!) / 2] : [0, 0, 0];
      this.centers.set(build.key, c);
    }
    return c;
  }

  /** Why a component cannot be moved: fixed, or fully defined by its mates; null when it can. */
  private cannotMove(componentId: Id): string | null {
    const c = this.history.doc.components.find((x) => x.id === componentId);
    if (!c) return '找不到零組件';
    const name = this.componentLabel(componentId);
    if (c.fixed) return `「${name}」已固定，不能移動（在設計樹按右鍵→「浮動」）`;
    if (this.state.solution?.components.get(componentId)?.dof === 0) return `「${name}」已被結合完全定義，不能移動`;
    return null;
  }

  /**
   * A drag begins on a component (A3.5): the left button moves it (or turns it, when 「旋轉零組件」 is
   * open), the right button turns it. False when it cannot move: it is fixed or fully defined.
   */
  startDrag(componentId: Id, point: Vec3, button: 'left' | 'right'): boolean {
    const pose = this.poseOf(componentId);
    const solution = this.state.solution;
    if (!pose || !solution || this.state.mate || this.state.insert || this.dragging) return false;
    const why = this.cannotMove(componentId);
    if (why) {
      this.host.notify(why);
      return false;
    }
    const mode = button === 'right' || this.state.move?.tool === 'rotate' ? 'rotate' : 'move';
    const center = this.centerOf(componentId);
    this.dragging = {
      component: componentId,
      mode,
      grab: toPartPoint(pose, point),
      center,
      centerAt: transformPoint(pose, center),
      rotation: pose.rotation,
      latest: solution.poses,
      result: null,
      goal: null,
      running: false,
      ending: false,
    };
    this.set({ drag: { component: componentId, mode, poses: null }, selected: componentId });
    return true;
  }

  /**
   * The pointer moved: moving, the grabbed point follows the line under the cursor and the part keeps
   * its orientation if it can; turning, it turns about its middle like a trackball (a hundred pixels
   * about one radian). Either way only as far as its mates allow.
   */
  dragTo(e: { origin: Vec3; dir: Vec3; dx: number; dy: number; right: Vec3; up: Vec3 }): void {
    const d = this.dragging;
    if (!d || d.ending) return;
    if (d.mode === 'move') {
      d.goal = [
        { kind: 'pointOnLine', point: d.grab, origin: e.origin, dir: e.dir },
        { kind: 'rotation', rotation: d.rotation },
      ];
    } else {
      // Dragging right turns the near side to the right (about the screen's up), dragging down turns it down.
      const axis: Vec3 = [0, 1, 2].map((k) => e.up[k]! * e.dx + e.right[k]! * e.dy) as Vec3;
      const length = Math.hypot(...axis);
      const rotation = length > 0 ? composeRotations(axisAngle([axis[0] / length, axis[1] / length, axis[2] / length], Math.hypot(e.dx, e.dy) / 100), d.rotation) : d.rotation;
      d.goal = [
        { kind: 'rotation', rotation },
        { kind: 'pointAt', point: d.center, target: d.centerAt },
      ];
    }
    void this.pumpDrag();
  }

  /** Drag solves run one at a time, each from where the last one ended; only the newest waiting goal is kept. */
  private async pumpDrag(): Promise<void> {
    const d = this.dragging;
    if (!d || d.running) return;
    d.running = true;
    try {
      while (d.goal && this.dragging === d) {
        const terms = d.goal;
        d.goal = null;
        const r = await this.host.api.solveAssembly(this.history.doc, this.keys(), { start: d.latest, goal: { body: d.component, terms } });
        if (this.dragging !== d) return;
        d.latest = r.poses;
        d.result = r;
        this.set({ drag: { component: d.component, mode: d.mode, poses: r.poses } });
      }
    } catch (e) {
      this.host.notify(`移動失敗：${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      d.running = false;
      if (d.ending && this.dragging === d) this.finishDrag();
    }
  }

  /** The button is released: where the drag left things becomes their placement (one undo step). Cancelled (Esc): nothing changes. */
  endDrag(cancelled: boolean): void {
    const d = this.dragging;
    if (!d) return;
    if (cancelled) {
      this.dragging = null;
      this.set({ drag: null });
      return;
    }
    d.ending = true;
    if (!d.running) this.finishDrag();
  }

  private finishDrag(): void {
    const d = this.dragging!;
    this.dragging = null;
    if (d.result) this.commitMove(d.result);
    else this.set({ drag: null });
  }

  /**
   * Keeps what a move did: the components solved with the moved one get the poses they have now as
   * their placements, so solving the document again leaves them there. The result is shown at once (the
   * document's own solve comes to the same). False when nothing moved.
   */
  private commitMove(r: AssemblyResult): boolean {
    const doc = this.history.doc;
    const before = this.state.solution?.poses;
    const group = (r.group ?? []).flatMap((id) => {
      const c = doc.components.find((x) => x.id === id);
      const pose = r.poses.get(id);
      return c && pose && !c.fixed ? [{ c, pose }] : [];
    });
    const moved = group.some(({ c, pose }) => !samePose(before?.get(c.id) ?? c.placement, pose, 1e-7));
    this.set({ drag: null, ...(moved ? { solution: r } : {}) });
    if (!moved) return false;
    const placements = group.filter(({ c, pose }) => !samePose(c.placement, pose, 1e-12)).map(({ c, pose }) => ({ componentId: c.id, placement: pose }));
    return placements.length === 0 || this.execute({ type: 'setPlacements', placements });
  }

  /** 「移動零組件」 / 「旋轉零組件」: the PropertyManager for moving by numbers (dragging works with it open too). */
  startMove(tool: MoveState['tool']): void {
    if (this.state.insert) this.cancelInsert();
    if (this.state.mate) this.cancelMate();
    this.set({ move: { tool } });
  }

  setMoveTool(tool: MoveState['tool']): void {
    if (this.state.move) this.set({ move: { tool } });
  }

  closeMove(): void {
    this.set({ move: null });
  }

  /**
   * 「依據 Delta XYZ」, 「至 XYZ 位置」, and turning by degrees about the assembly's X, Y and Z (in that
   * order, about the part's middle), for the selected component: as far as its mates allow, as SolidWorks
   * does. One undo step each.
   */
  async moveSelected(op: MoveOp): Promise<void> {
    const id = this.state.selected;
    const c = id ? this.history.doc.components.find((x) => x.id === id) : undefined;
    if (!c) return this.host.notify('請先選擇要移動的零組件（在圖面或設計樹中點選）');
    const why = this.cannotMove(c.id);
    if (why) return this.host.notify(why, 'error');
    const pose = this.poseOf(c.id);
    const solution = this.state.solution;
    if (!pose || !solution) return;
    let terms: GoalTerm[];
    if (op.kind === 'turn') {
      const [ax, ay, az] = op.angles;
      const turn = composeRotations(axisAngle([0, 0, 1], az), composeRotations(axisAngle([0, 1, 0], ay), axisAngle([1, 0, 0], ax)));
      const center = this.centerOf(c.id);
      terms = [
        { kind: 'rotation', rotation: composeRotations(turn, pose.rotation) },
        { kind: 'pointAt', point: center, target: transformPoint(pose, center) },
      ];
    } else {
      const target: Vec3 = op.kind === 'to' ? op.position : [pose.position[0] + op.delta[0], pose.position[1] + op.delta[1], pose.position[2] + op.delta[2]];
      terms = [
        { kind: 'pointAt', point: [0, 0, 0], target },
        { kind: 'rotation', rotation: pose.rotation },
      ];
    }
    try {
      const r = await this.host.api.solveAssembly(this.history.doc, this.keys(), { start: solution.poses, goal: { body: c.id, terms } });
      if (!this.commitMove(r)) this.host.notify(`「${this.componentLabel(c.id)}」受結合限制，不能這樣移動`);
    } catch (e) {
      this.host.notify(`移動失敗：${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }

  // ------------------------------------------------------------ files that cannot be found (B9.4)

  /** The part files of the document that are not where their paths say. */
  missingFiles(): FileRef[] {
    return this.history.doc.files.filter((f) => this.state.files.get(joinPath(this.folder, f.path))?.status === 'missing');
  }

  /** Once the assembly has been read: missing files are pointed out once; when none is left, the dialog goes. */
  private pointOutMissing(): void {
    const missing = this.missingFiles().length > 0;
    if (!missing && this.state.relink) this.set({ relink: null });
    if (missing && !this.missingShown && this.project) {
      this.missingShown = true;
      void this.openRelink();
    }
  }

  /** 「找不到參考的檔案」: the missing files, and files of the project folder with their names (moved elsewhere). */
  async openRelink(): Promise<void> {
    const project = this.project;
    if (!project) return;
    this.set({ relink: { candidates: null } });
    let found: string[] = [];
    try {
      found = (await listFiles(project, [PART_FILE_EXTENSION, '.step', '.stp'])).files;
    } catch {
      // the folder cannot be read: no candidates, 「瀏覽」 still works
    }
    if (!this.state.relink) return;
    const candidates = new Map<Id, string[]>();
    for (const f of this.missingFiles()) {
      const name = baseName(f.path).toLowerCase();
      const where = joinPath(this.folder, f.path);
      candidates.set(f.id, found.filter((p) => baseName(p).toLowerCase() === name && p !== where));
    }
    this.set({ relink: { candidates } });
  }

  closeRelink(): void {
    this.set({ relink: null });
  }

  /** Points a file of the assembly at a file of the project folder (by its path there): every component of it follows. */
  relink(fileId: Id, projectPath: string): void {
    this.execute({ type: 'relinkFile', fileId, path: relativePath(this.folder, projectPath) });
  }

  /** 「瀏覽…」 / 「重新指定零件檔…」: a part or STEP file chosen with the system dialog, inside the project folder. */
  async browseRelink(fileId: Id): Promise<void> {
    const project = this.project ?? (await this.host.projectFolder('重新指定零件檔要從專案資料夾中選擇。'));
    if (!project) return;
    this.project = project;
    try {
      const picked = await pickPartFile(project);
      if (!picked?.handle) return;
      const path = await pathIn(project, picked.handle);
      if (path === null) return this.host.notify(`零件檔必須在專案資料夾「${project.name}」之內`, 'error');
      this.relink(fileId, path);
    } catch (e) {
      this.host.notify(`無法開啟：${e instanceof Error ? e.message : String(e)}`, 'error');
    }
  }

  /** The file a component uses, by its path in the project folder (for 「開啟零件」). */
  componentPath(componentId: Id): string | null {
    const doc = this.history.doc;
    const c = doc.components.find((x) => x.id === componentId);
    const f = c && doc.files.find((x) => x.id === c.file);
    return f ? joinPath(this.folder, f.path) : null;
  }

  // ------------------------------------------------------------ files (B9.1, B9.4)

  /** 「儲存檔案」: into the file the assembly came from; one never saved asks where. True when saved. */
  async save(): Promise<boolean> {
    return this.handle ? this.write(this.handle) : this.saveAs();
  }

  /**
   * 「另存新檔」: inside the project folder, so the parts can be found by relative path. Saved into
   * another folder, the paths are rewritten to reach the same files from there, in every state undo
   * can reach too.
   */
  async saveAs(): Promise<boolean> {
    try {
      const project = (this.project ??= await this.host.projectFolder('組合件要存在專案資料夾之內，零件才能以相對路徑找到。'));
      if (!project) return false;
      const handle = await pickAssemblySaveTarget(project, assemblyFileName(this.name()));
      if (!handle) return false;
      const path = await pathIn(project, handle);
      if (path === null) {
        this.host.notify(`組合件必須存在專案資料夾「${project.name}」之內，零件才能以相對路徑找到`, 'error');
        return false;
      }
      const from = this.folder;
      const to = dirName(path);
      this.moveTo(from, to);
      if (await this.write(handle)) return true;
      this.moveTo(to, from); // not saved: the paths go back to where the assembly still is
      return false;
    } catch (e) {
      this.host.notify(`存檔失敗：${e instanceof Error ? e.message : String(e)}`, 'error');
      return false;
    }
  }

  /** The assembly's own file, when it has one: where 「返回組合件」 comes back to. */
  file(): FileSystemFileHandle | null {
    return this.handle;
  }

  private moveTo(from: string, to: string): void {
    if (from === to) return;
    this.folder = to;
    this.history.rebase((doc) => relocateAssembly(doc, from, to));
  }

  private async write(handle: FileSystemFileHandle): Promise<boolean> {
    const doc = this.history.doc; // what is written, even if an edit lands while writing
    try {
      await writeFile(handle, await writeAssemblyFile(doc));
      this.handle = handle;
      this.savedText = serializeAssembly(doc);
      this.set({ fileName: handle.name, dirty: serializeAssembly(this.history.doc) !== this.savedText });
      this.host.notify(`已儲存 ${handle.name}`);
      return true;
    } catch (e) {
      this.host.notify(`存檔失敗：${e instanceof Error ? e.message : String(e)}`, 'error');
      return false;
    }
  }
}

/** The next free name for a mate of a type: 「重合3」 after 「重合2」, as SolidWorks names them. */
function nextMateName(doc: AssemblyDoc, label: string): string {
  const pattern = new RegExp(`^${label}(\\d+)$`);
  const used = doc.mates.map((m) => Number(pattern.exec(m.name)?.[1] ?? 0));
  return `${label}${Math.max(0, ...used) + 1}`;
}
