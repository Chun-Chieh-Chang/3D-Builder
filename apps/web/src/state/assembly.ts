import type * as Comlink from 'comlink';
import {
  AssemblyHistory,
  assemblyIdsInUse,
  CommandError,
  dirName,
  IDENTITY_ROTATION,
  IdAllocator,
  joinPath,
  nextInstance,
  relativePath,
  relocateAssembly,
  serializeAssembly,
  type AssemblyCommand,
  type AssemblyDoc,
  type Component,
  type FileRef,
  type Id,
  type Vec3,
} from '@3db/model';
import { assemblyFileName, assemblyName, PART_FILE_EXTENSION, sha256Hex, writeAssemblyFile } from '@3db/io';
import type { KernelApi, PartBuildPayload } from '../worker/protocol';
import { fileIn, listFiles, pathIn, pickAssemblySaveTarget, pickPartFile, readBytes, writeFile } from '../files';

/** A part file of the assembly, by its path in the project folder: read and rebuilt, or why not. */
export type FileStatus = { status: 'loading' } | { status: 'ok'; key: string } | { status: 'missing' | 'error'; message: string };

/** 「插入零組件」 (C15.1). */
export interface InsertState {
  /** Part files in the project folder; null while the folder is being read. */
  files: string[] | null;
  /** The part to place, by its path in the project folder. */
  chosen: string | null;
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
  /** A component, or a default plane ("plane:front" …). */
  selected: Id | null;
  insert: InsertState | null;
  /** Components whose 「確認刪除」 dialog is open. */
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
      confirmDelete: null,
      fitRequest: 1,
    };
    this.history.subscribe(() => this.onDocChanged());
    this.loadFiles();
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
    this.set({
      doc,
      folder: this.folder,
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      dirty: serializeAssembly(doc) !== this.savedText,
      // A component that undo took away is no longer selected.
      selected: selected && !selected.startsWith('plane:') && !doc.components.some((c) => c.id === selected) ? null : selected,
    });
    this.loadFiles();
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

  // ------------------------------------------------------------ FeatureManager (C15.2, C15.12)

  select(id: Id | null): void {
    this.set({ selected: id });
  }

  /** 「固定」/「浮動」 (C15.2). */
  setFixed(componentIds: Id[], value: boolean): void {
    if (componentIds.length > 0) this.execute({ type: 'setFixed', componentIds, value });
  }

  requestDelete(componentIds: Id[] | null): void {
    if (componentIds && componentIds.length === 0) return;
    this.set({ confirmDelete: componentIds });
  }

  deleteComponents(componentIds: Id[]): void {
    if (this.execute({ type: 'deleteComponents', componentIds })) this.set({ confirmDelete: null });
  }

  // ------------------------------------------------------------ 插入零組件 (C15.1)

  /** Opens the PropertyManager with the part files of the project folder. */
  async startInsert(): Promise<void> {
    if (this.getState().insert) return; // not this.state.insert: TypeScript would keep that narrowing past the awaits below
    const project = (this.project ??= await this.host.projectFolder('插入零組件會從專案資料夾讀取零件檔，組合件也要存在這個資料夾之內，才能以相對路徑找到零件。'));
    if (!project) return;
    this.set({ insert: { files: null, chosen: null }, selected: null });
    let files: string[] = [];
    try {
      files = await listFiles(project, PART_FILE_EXTENSION);
    } catch (e) {
      this.host.notify(`無法讀取專案資料夾：${e instanceof Error ? e.message : String(e)}`, 'error');
    }
    if (this.state.insert) this.set({ insert: { ...this.state.insert, files } });
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
