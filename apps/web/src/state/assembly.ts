import type * as Comlink from 'comlink';
import {
  AssemblyHistory,
  assemblyIdsInUse,
  CommandError,
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
  type AssemblyCommand,
  type AssemblyDoc,
  type Component,
  type FileRef,
  type Id,
  type Mate,
  type MateRef,
  type MateType,
  type Pose,
  type Vec3,
} from '@3db/model';
import { closerAlignment, currentValue, defaultType, hasAlignment, MATE_LABEL, placed, supportedTypes, type MateGeometry } from '@3db/assembly';
import { assemblyFileName, assemblyName, PART_FILE_EXTENSION, sha256Hex, writeAssemblyFile } from '@3db/io';
import type { AssemblyResult } from '@3db/regen';
import type { KernelApi, PartBuildPayload } from '../worker/protocol';
import { fileIn, listFiles, pathIn, pickAssemblySaveTarget, pickPartFile, readBytes, writeFile } from '../files';

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
    const generation = this.generation;
    void this.read(path).then((status) => {
      if (generation !== this.generation) return; // reloaded meanwhile
      this.setFile(path, status);
      if (![...this.state.files.values()].some((s) => s.status === 'loading')) this.settled();
      this.requestSolve();
    });
  }

  private async read(path: string): Promise<FileStatus> {
    const project = this.project;
    if (!project) return { status: 'missing', message: '尚未選擇專案資料夾' };
    if (path === '..' || path.startsWith('../')) return { status: 'missing', message: `零件檔在專案資料夾「${project.name}」之外：${path}` };
    try {
      const bytes = await readBytes(await fileIn(project, path));
      const key = await sha256Hex(bytes);
      if (!this.state.builds.has(key)) {
        const build = await this.host.api.buildPart(key, bytes);
        this.set({ builds: new Map(this.state.builds).set(key, build) });
      }
      return { status: 'ok', key };
    } catch (e) {
      if (e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError')) return { status: 'missing', message: `找不到零件檔「${path}」` };
      return { status: 'error', message: e instanceof Error ? e.message : String(e) };
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

  /** Where a component is now: as solved, or its placement until the first solve. */
  poseOf(componentId: Id): Pose | null {
    return this.state.solution?.poses.get(componentId) ?? this.history.doc.components.find((c) => c.id === componentId)?.placement ?? null;
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
