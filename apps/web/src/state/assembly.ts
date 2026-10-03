import { proxy, type Remote } from 'comlink';
import {
  AssemblyHistory,
  assemblyIdsInUse,
  axisAngle,
  baseName,
  CommandError,
  composePose,
  composeRotations,
  cycleMessage,
  DATUM_PLANES,
  dirName,
  evalAngle,
  evalLength,
  findReferenceCycle,
  IDENTITY_ROTATION,
  IdAllocator,
  isDatumPlaneName,
  joinPath,
  ASSEMBLY_AXES,
  assemblyPhysical,
  interferenceGroups,
  interferencePart,
  type InterferenceComponent,
  bomName,
  buildBom,
  explodeLeaves,
  explosionOffsets,
  leafAt,
  leavesOf,
  mirrorKey,
  patternLeavesOf,
  nextInstance,
  relativePath,
  relativePose,
  relocateAssembly,
  serializeAssembly,
  toPartPoint,
  transformPoint,
  usedFiles,
  type AssemblyCommand,
  type AssemblyDoc,
  type BomRow,
  type Component,
  type ComponentPattern,
  type ComponentState,
  type ExplodeStep,
  type FileRef,
  type Id,
  type Leaf,
  type Mate,
  type MateRef,
  type MateType,
  type PatternAxis,
  type PatternLine,
  type Physical,
  type Pose,
  type Quat,
  type SourceTree,
  type Vec3,
} from '@3db/model';
import { axisOf, closerAlignment, currentValue, defaultType, hasAlignment, MATE_LABEL, placed, supportedTypes, type GoalTerm, type MateGeometry } from '@3db/assembly';
import { ASSEMBLY_FILE_EXTENSION, assemblyFileName, assemblyName, componentName, PART_FILE_EXTENSION, readDocumentFile, sha256Hex, stepStructure, writeAssemblyFile } from '@3db/io';
import { t } from '@3db/i18n';
import type { AssemblyResult } from '@3db/regen';
import type { AssemblyStepRequest, KernelApi, PartBuildPayload, PartStage } from '../worker/protocol';
import { fileIn, listFiles, pathIn, pickAssemblySaveTarget, pickPartFile, writeFile } from '../files';
import { immovable } from './movability';

/** A part file of the assembly, by its path in the project folder: read and rebuilt, or why not. */
export type FileStatus =
  /** `since`: when it began (ms since the epoch), for how long it has been going on. */
  | { status: 'loading'; stage: PartStage; since: number }
  /** `assembly`: the file is a sub-assembly (C15.4), and this is its document; its own files are read too, each under its own path. */
  | { status: 'ok'; key: string; assembly?: AssemblyDoc }
  | { status: 'missing' | 'error'; message: string };

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

/** A pattern or mirror being defined in its PropertyManager (C15.13): the definition so far, and which axis is being picked in the graphics area. */
export interface PatternDraft {
  /** The pattern being edited; null for a new one. */
  editing: Id | null;
  pattern: ComponentPattern;
  picking: 'axis1' | 'axis2' | null;
}

/** The exploded view's PropertyManager (C15.14): the step being made or edited, and whether its axis is being picked in the graphics area. */
export interface ExplodeDraft {
  /** The step being edited; null for a new one. */
  editing: Id | null;
  step: ExplodeStep;
  picking: boolean;
}

/** The id a pattern being defined has while it is only previewed. */
export const PREVIEW_PATTERN = 'pattern-preview';

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
  /** The pattern PropertyManager (C15.13); null while it is closed. */
  pattern: PatternDraft | null;
  /** The exploded view's PropertyManager (C15.14); null while it is closed. */
  explode: ExplodeDraft | null;
  /** The view shows the assembly exploded (a display only: no pose is changed, and nothing can be moved or mated while it is). */
  exploded: boolean;
}

export interface AssemblyHost {
  api: Remote<KernelApi>;
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
const sameRef = (x: MateRef | null, y: MateRef) => !!x && x.component === y.component && (x.path ?? []).join('/') === (y.path ?? []).join('/') && x.ref.kind === y.ref.kind && x.ref.name === y.ref.name;
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
      pattern: null,
      explode: null,
      exploded: false,
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
    this.setFile(path, { status: 'loading', stage: 'reading', since: Date.now() });
    this.readInto(path);
  }

  /** The worker has got as far as `stage` with a part file that is still loading (one already shown is read again without a word). */
  private stageReached(path: string, stage: PartStage, generation: number): void {
    const now = this.state.files.get(path);
    if (generation !== this.generation || now?.status !== 'loading' || now.stage === stage) return;
    this.setFile(path, { ...now, stage });
  }

  /** Reads a file and shows what it holds now; until then the file shows as it was. */
  private readInto(path: string): void {
    const generation = this.generation;
    void this.read(path).then((read) => {
      if (generation !== this.generation) return; // reloaded meanwhile
      const status = this.checked(path, read);
      this.setFile(path, status);
      if (status.status === 'ok' && status.assembly) for (const f of status.assembly.files) this.load(joinPath(dirName(path), f.path));
      if (![...this.state.files.values()].some((s) => s.status === 'loading')) {
        this.settled();
        this.pointOutMissing();
      }
      this.requestSolve();
    });
  }

  /** Where this assembly's own file is in the project folder; null while it has not been saved. */
  private ownPath(): string | null {
    return this.state.fileName ? joinPath(this.folder, this.state.fileName) : null;
  }

  /** The project paths of the files the assembly file at `path` uses; null for anything that is not an assembly read so far. `known` is a file just read, not in the state yet. */
  private refsOf(path: string, known?: { path: string; doc: AssemblyDoc }, extra?: string): string[] | null {
    if (path === this.ownPath()) return [...usedFiles(this.history.doc, this.folder), ...(extra ? [extra] : [])];
    const doc = known && known.path === path ? known.doc : (this.state.files.get(path) as { assembly?: AssemblyDoc } | undefined)?.assembly;
    return doc ? usedFiles(doc, dirName(path)) : null;
  }

  /** A sub-assembly that would contain itself is an error, not a file to read further. */
  private checked(path: string, status: FileStatus): FileStatus {
    if (status.status !== 'ok' || !status.assembly) return status;
    const known = { path, doc: status.assembly };
    const cycle = findReferenceCycle(path, (p) => this.refsOf(p, known));
    return cycle ? { status: 'error', message: cycleMessage(cycle) } : status;
  }

  private async read(path: string): Promise<FileStatus> {
    const generation = this.generation;
    const project = this.project;
    if (!project) return { status: 'missing', message: '尚未選擇專案資料夾' };
    if (path === '..' || path.startsWith('../')) return { status: 'missing', message: `零件檔在專案資料夾「${project.name}」之外：${path}` };
    try {
      const file = await (await fileIn(project, path)).getFile();
      this.stamps.set(path, `${file.lastModified}:${file.size}`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const key = await sha256Hex(bytes);
      if (path.toLowerCase().endsWith(ASSEMBLY_FILE_EXTENSION)) {
        const opened = await readDocumentFile(bytes);
        if (opened.kind !== 'assembly') return { status: 'error', message: t('subassembly.notAssembly', { path }) };
        return { status: 'ok', key, assembly: opened.doc }; // its own files are read when this is known (readInto)
      }
      if (!this.state.builds.has(key)) {
        const build = await this.host.api.buildPart(key, bytes, proxy((stage: PartStage) => this.stageReached(path, stage, generation)));
        // A file that gave no body and said why (a STEP file that is none, a part whose features all failed) is an error, not a part to place. An empty part has nothing to say and stays.
        if (!build.mesh && build.problems.length > 0) return { status: 'error', message: `無法使用「${path}」：${build.problems.join('；')}` };
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
      for (const path of [...this.state.files.keys()]) {
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
    const seen = new Set<string>();
    const keys: string[] = [];
    const visit = (path: string) => {
      if (seen.has(path)) return;
      seen.add(path);
      const s = this.state.files.get(path);
      if (s?.status !== 'ok') return;
      if (s.assembly) for (const f of s.assembly.files) visit(joinPath(dirName(path), f.path));
      else keys.push(s.key);
    };
    for (const f of this.history.doc.files) visit(joinPath(this.folder, f.path));
    if (this.state.insert?.chosen) visit(this.state.insert.chosen);
    void this.host.api.retainParts(keys);
  }

  // ------------------------------------------------------------ solving (A3.2, A3.4)

  /** What the file at `path` is, down through sub-assemblies: a part by its key, or a sub-assembly and what is in it. Null: not read (yet), or not usable. */
  private treeOf(path: string, above: readonly string[] = []): SourceTree | null {
    const status = this.state.files.get(path);
    if (status?.status !== 'ok' || above.includes(path)) return null;
    if (!status.assembly) return { kind: 'part', key: status.key, path };
    const children: Record<Id, SourceTree> = {};
    for (const c of status.assembly.components) {
      const file = status.assembly.files.find((f) => f.id === c.file);
      const child = file && this.treeOf(joinPath(dirName(path), file.path), [...above, path]);
      if (child) children[c.id] = child;
    }
    return { kind: 'assembly', doc: status.assembly, children, path };
  }

  /** What each component of the assembly is (components whose file is not read yet are left out). */
  private trees(): Record<Id, SourceTree> {
    const trees: Record<Id, SourceTree> = {};
    for (const c of this.history.doc.components) {
      const file = this.history.doc.files.find((f) => f.id === c.file);
      const tree = file && this.treeOf(joinPath(this.folder, file.path));
      if (tree) trees[c.id] = tree;
    }
    return trees;
  }

  private leafCache: { doc: AssemblyDoc; files: AssemblyState['files']; solution: AssemblyResult | null; drag: AssemblyState['drag']; pattern: PatternDraft | null; exploded: boolean; leaves: Leaf[]; problems: Map<Id, string>; explodeProblems: Map<Id, string> } | null = null;

  /** The document with the pattern being defined in it (as a preview), for what is drawn. */
  private shownDoc(): AssemblyDoc {
    const doc = this.history.doc;
    const d = this.state.pattern;
    if (!d) return doc;
    const p = d.editing ? d.pattern : { ...d.pattern, id: PREVIEW_PATTERN };
    const list = doc.patterns ?? [];
    return { ...doc, patterns: d.editing ? list.map((x) => (x.id === d.editing ? p : x)) : [...list, p] };
  }

  /** Every part to draw, where it is now (see `leavesOf`). Derived; kept while nothing it depends on changes. */
  leaves(): Leaf[] {
    const { files, solution, drag, pattern, exploded } = this.state;
    const doc = this.history.doc;
    const c = this.leafCache;
    if (c && c.doc === doc && c.files === files && c.solution === solution && c.drag === drag && c.pattern === pattern && c.exploded === exploded) return c.leaves;
    const base = leavesOf(doc, this.trees(), (id) => this.poseOf(id), solution?.inner);
    // the parts patterns and mirrors add (C15.13); their axes are found among the parts of the components themselves
    const made = patternLeavesOf(this.shownDoc(), base, (axis) => this.lineOf(axis, base));
    let leaves = [...base, ...made.leaves];
    // the exploded view (C15.14): each component's leaves, its sub-assembly's parts and its pattern's instances moved by its offset; no pose is changed
    const exploding = explosionOffsets(doc, (axis) => this.lineOf(axis, base));
    if (exploded) leaves = explodeLeaves(leaves, exploding.offsets);
    this.leafCache = { doc, files, solution, drag, pattern, exploded, leaves, problems: made.problems, explodeProblems: exploding.problems };
    this.ensureMirrors(leaves);
    return leaves;
  }

  /** Every part where it is assembled (the exploded view does not move it): what mass properties and interference are worked out on. */
  assembledLeaves(): Leaf[] {
    if (!this.state.exploded) return this.leaves();
    const doc = this.history.doc;
    const base = leavesOf(doc, this.trees(), (id) => this.poseOf(id), this.state.solution?.inner);
    return [...base, ...patternLeavesOf(this.shownDoc(), base, (axis) => this.lineOf(axis, base)).leaves];
  }

  /**
   * What interference (E2.1) is asked of: the components as the user sees them (a sub-assembly one, each copy of a pattern or mirror its own), each as its
   * parts and where they are assembled, and what each is called in the list.
   */
  interferenceInput(): { components: InterferenceComponent[]; names: Map<string, string>; tops: Map<string, string> } {
    const unmirror = (key: string) => key.slice(0, -mirrorKey('').length);
    const names = new Map<string, string>();
    const tops = new Map<string, string>();
    const groups = interferenceGroups(this.assembledLeaves());
    for (const g of groups) {
      const base = this.ownerLabel(g.top);
      const pattern = g.instance ? (this.history.doc.patterns?.find((p) => p.id === g.instance!.pattern)?.name ?? g.instance.pattern) : '';
      names.set(g.id, g.instance ? (g.instance.label === null ? t('interference.mirror', { name: base, pattern }) : t('interference.instance', { name: base, pattern, label: g.instance.label })) : base);
      tops.set(g.id, g.top);
    }
    return { components: groups.map((g) => ({ id: g.id, parts: g.leaves.map((l) => interferencePart(l, unmirror)) })), names, tops };
  }

  /** The mass properties of the assembly (E1.2): its parts put together at their positions. Derived. */
  physical(): Physical {
    const suffix = t('pattern.mirrorSuffix');
    return assemblyPhysical(
      this.assembledLeaves().map((l) => {
        const base = bomName(l.file ?? l.key);
        return { name: l.mirrored ? `${base}${suffix}` : base, pose: l.pose, mirrored: !!l.mirrored, mass: this.state.builds.get(l.mirrored ? l.key.slice(0, -mirrorKey('').length) : l.key)?.mass ?? undefined };
      }),
    );
  }

  /** The parts list (C15.16) of the assembly as it is now: flat and indented. Derived from the document and the parts read, never stored. */
  bom(): { flat: BomRow[]; indented: BomRow[] } {
    return buildBom({ doc: this.history.doc, trees: this.trees(), propsOf: (key) => this.state.builds.get(key)?.properties, problems: this.patternProblems() });
  }

  /** Why a pattern has no instances (its axis is gone, its definition does not read); empty when all is well. Derived. */
  patternProblems(): ReadonlyMap<Id, string> {
    this.leaves();
    return this.leafCache?.problems ?? new Map();
  }

  /** A pattern's direction or axis found in the assembly: one of its axes, or the line an element of a component stands for. */
  private lineOf(axis: PatternAxis, base: readonly Leaf[]): PatternLine | null {
    if (axis.kind === 'axis') return ASSEMBLY_AXES[axis.axis];
    const g = this.elementGeometry(axis.ref, base);
    if (!g) return null;
    if (g.kind === 'plane') return { origin: g.origin, dir: g.normal };
    const line = axisOf(g);
    return line ? { origin: line.p, dir: line.d } : null;
  }

  /** Mirrored parts asked for and not built yet (or being built). */
  private mirrorsAsked = new Set<string>();

  /** Builds the mirror of every part a mirror shows (C15.13), once, when the part itself is built. */
  private ensureMirrors(leaves: readonly Leaf[]): void {
    for (const l of leaves) {
      if (!l.mirrored || this.state.builds.has(l.key) || this.mirrorsAsked.has(l.key) || this.closed) continue;
      const partKey = l.key.slice(0, -mirrorKey('').length);
      if (!this.state.builds.has(partKey)) continue; // when the part comes, leaves() runs again
      this.mirrorsAsked.add(l.key);
      void this.host.api.buildMirrorPart(partKey).then((build) => {
        if (build && !this.closed) this.set({ builds: new Map(this.state.builds).set(build.key, build) });
      }, () => this.mirrorsAsked.delete(l.key));
    }
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
      const solution = await this.host.api.solveAssembly(this.solveDoc(), this.trees());
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
    if (doc.components.every((c) => c.suppressed)) throw new Error('組合件沒有零組件');
    if (this.solving || this.solveAgain) throw new Error('結合正在求解，請稍後再輸出');
    const structure = stepStructure(doc, this.folder, this.trees(), (id) => this.poseOf(id), this.state.solution?.inner, (path) => {
      const status = this.state.files.get(path);
      return status?.status === 'missing' || status?.status === 'error' ? status.message : '尚未讀取';
    }, { axisOf: (axis) => this.lineOf(axis, this.leaves().filter((l) => !l.instanceOf)) });
    if (structure.unreadable.length) throw new Error(`有 ${structure.unreadable.length} 個零件檔無法讀取：${structure.unreadable.map((u) => `${u.path}（${u.why}）`).join('、')}`);
    return { name: this.name(), parts: structure.parts, subs: structure.subs, instances: structure.instances };
  }

  /** Whether a component is a sub-assembly (its file is an assembly that was read). */
  isSubAssembly(componentId: Id): boolean {
    const doc = this.history.doc;
    const c = doc.components.find((x) => x.id === componentId);
    const file = c && doc.files.find((f) => f.id === c.file);
    const status = file && this.state.files.get(joinPath(this.folder, file.path));
    return status?.status === 'ok' && !!status.assembly;
  }

  /** The rebuilt part of a component. */
  buildOf(componentId: Id): PartBuildPayload | null {
    const doc = this.history.doc;
    const c = doc.components.find((x) => x.id === componentId);
    const file = c && doc.files.find((f) => f.id === c.file);
    const status = file && this.state.files.get(joinPath(this.folder, file.path));
    return status?.status === 'ok' ? (this.state.builds.get(status.key) ?? null) : null;
  }

  /** The rebuilt part of a leaf (a part inside a sub-assembly, or a component that is a part). */
  buildOfLeaf(leaf: Leaf): PartBuildPayload | null {
    return this.state.builds.get(leaf.key) ?? null;
  }

  /** The part and the pose a mate's element is on: the component's own, or the leaf its path leads to inside a sub-assembly. */
  elementPart(ref: MateRef, leaves: readonly Leaf[] = this.leaves()): { build: PartBuildPayload; pose: Pose } | null {
    if (ref.component === null) return null;
    const leaf = ref.path?.length ? leafAt(leaves, ref.component, ref.path) : null;
    const build = leaf ? this.buildOfLeaf(leaf) : ref.path?.length ? null : this.buildOf(ref.component);
    const pose = leaf ? leaf.pose : ref.path?.length ? null : this.poseOf(ref.component);
    return build && pose ? { build, pose } : null;
  }

  /** An element's geometry where it is now, in assembly coordinates (for what the PropertyManager offers). */
  elementGeometry(ref: MateRef, leaves: readonly Leaf[] = this.leaves()): MateGeometry | null {
    const { name, kind } = ref.ref;
    const datum = (planes: PartBuildPayload['planes'] | undefined): MateGeometry | null => {
      if (name === 'origin') return { kind: 'point', point: [0, 0, 0] };
      const frame = isDatumPlaneName(name) ? DATUM_PLANES[name] : planes?.find((p) => p.id === name)?.frame;
      return frame ? { kind: 'plane', origin: frame.origin, normal: frame.normal } : null;
    };
    if (ref.component === null) return kind === 'datum' ? datum(undefined) : null;
    // the planes and the origin of a sub-assembly itself (no path) are where the sub-assembly is, in its own coordinates
    const own = !ref.path?.length && !this.buildOf(ref.component) && this.isSubAssembly(ref.component);
    if (own) {
      const pose = this.poseOf(ref.component);
      const local = kind === 'datum' ? datum(undefined) : null;
      return local && pose ? placed(local, pose) : null;
    }
    const part = this.elementPart(ref, leaves);
    if (!part) return null;
    const { build, pose } = part;
    let local: MateGeometry | null = null;
    if (kind === 'datum') local = datum(build.planes);
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
    if (this.state.pattern) this.cancelPattern();
    this.leaveExplode();
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
    const ed = this.state.explode;
    if (ed?.picking) {
      // the direction of an explode step: an element of any component
      this.set({ explode: { ...ed, step: { ...ed.step, axis: { kind: 'ref', ref } }, picking: false } });
      return;
    }
    const pd = this.state.pattern;
    if (pd?.picking) {
      // a direction or axis for the pattern, an element of any component (C15.13)
      this.set({ pattern: { ...pd, pattern: { ...pd.pattern, [pd.picking]: { kind: 'ref', ref } }, picking: null } });
      return;
    }
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

  /** 「隱藏」, 「抑制」, 「透明」 and their opposites (C15.5): one undo step. */
  setComponentState(componentIds: Id[], state: ComponentState, value: boolean): void {
    if (componentIds.length === 0) return;
    if (this.state.mate) this.cancelMate(); // a mate being defined would keep pointing at what is gone
    if (this.state.pattern) this.cancelPattern();
    this.execute({ type: 'setComponentState', componentIds, state, value });
  }

  // ------------------------------------------------------------ patterns and mirrors (C15.13)

  /** 「線性複製排列」, 「環狀複製排列」, 「鏡射零組件」: opens the PropertyManager with the selected component (or the first) as the seed. */
  startPattern(kind: ComponentPattern['kind']): void {
    const doc = this.history.doc;
    const seed = doc.components.find((c) => c.id === this.state.selected && !c.suppressed) ?? doc.components.find((c) => !c.suppressed);
    if (!seed) return this.host.notify(t('pattern.noComponent'), 'error');
    if (this.state.insert) this.cancelInsert();
    if (this.state.mate) this.cancelMate();
    if (this.state.move) this.closeMove();
    this.leaveExplode();
    const n = (doc.patterns ?? []).filter((p) => p.kind === kind).length + 1;
    const id = new IdAllocator(doc.idCounters, assemblyIdsInUse(doc)).take('pattern');
    const name = t(kind === 'linear' ? 'pattern.linearName' : kind === 'circular' ? 'pattern.circularName' : 'pattern.mirrorName', { n });
    const pattern: ComponentPattern =
      kind === 'linear'
        ? { id, name, kind, seed: seed.id, axis1: { kind: 'axis', axis: 'x' }, count1: 3, spacing1: '50' }
        : kind === 'circular'
          ? { id, name, kind, seed: seed.id, axis1: { kind: 'axis', axis: 'z' }, count1: 4, spacing1: '90' }
          : { id, name, kind, seed: seed.id, plane: 'plane:right' };
    this.set({ pattern: { editing: null, pattern, picking: null }, selected: seed.id });
  }

  /** 「編輯」: the PropertyManager with the pattern's definition; ✓ replaces it. */
  editPattern(id: Id): void {
    const p = this.history.doc.patterns?.find((x) => x.id === id);
    if (!p) return;
    if (this.state.insert) this.cancelInsert();
    if (this.state.mate) this.cancelMate();
    if (this.state.move) this.closeMove();
    this.set({ pattern: { editing: id, pattern: p, picking: null }, selected: id });
  }

  /** Changes the definition being made; the preview follows. */
  setPatternDraft(patch: Partial<ComponentPattern>): void {
    const d = this.state.pattern;
    if (d) this.set({ pattern: { ...d, pattern: { ...d.pattern, ...patch } } });
  }

  /** Whether the next element picked in the graphics area is a pattern's direction or axis (and which); null stops picking. */
  pickPatternAxis(slot: 'axis1' | 'axis2' | null): void {
    const d = this.state.pattern;
    if (d) this.set({ pattern: { ...d, picking: slot } });
  }

  /** ✓: the pattern is added (or replaced) and the PropertyManager closes. */
  applyPattern(): void {
    const d = this.state.pattern;
    if (!d) return;
    if (!this.execute({ type: d.editing ? 'setPattern' : 'insertPattern', pattern: d.pattern })) return;
    this.set({ pattern: null, selected: d.pattern.id });
  }

  cancelPattern(): void {
    if (this.state.pattern) this.set({ pattern: null });
  }

  /** Deletes patterns (their instances go with them; the seeds stay). */
  deletePatterns(patternIds: Id[]): void {
    if (patternIds.length > 0) this.execute({ type: 'deletePatterns', patternIds });
  }

  // ------------------------------------------------------------ the exploded view (C15.14)

  /** Why an explode step moves nothing (its axis is gone, its distance does not read); empty when all is well. Derived. */
  explodeProblems(): ReadonlyMap<Id, string> {
    this.leaves();
    return this.leafCache?.explodeProblems ?? new Map();
  }

  /** 「爆炸視圖」: opens the PropertyManager with a new step, the selected component first. Opening it shows the view exploded. */
  startExplode(): void {
    if (this.state.insert) this.cancelInsert();
    if (this.state.mate) this.cancelMate();
    if (this.state.move) this.closeMove();
    if (this.state.pattern) this.cancelPattern();
    this.set({ explode: { editing: null, step: this.newExplodeStep(), picking: false }, exploded: true });
  }

  private newExplodeStep(): ExplodeStep {
    const doc = this.history.doc;
    const id = new IdAllocator(doc.idCounters, assemblyIdsInUse(doc)).take('explode');
    const seed = doc.components.find((c) => c.id === this.state.selected && !c.suppressed);
    return { id, name: t('explode.stepName', { n: (doc.explosion?.length ?? 0) + 1 }), components: seed ? [seed.id] : [], axis: { kind: 'axis', axis: 'z' }, distance: '50' };
  }

  /** What needs the assembled positions (mating, moving, inserting, patterns) closes the exploded view first. */
  private leaveExplode(): void {
    if (this.state.explode || this.state.exploded) this.set({ explode: null, exploded: false });
  }

  closeExplode(): void {
    if (this.state.explode) this.set({ explode: null });
  }

  /** Shows the assembly exploded, or as it is assembled (a display: no pose changes). */
  setExploded(value: boolean): void {
    if (this.state.exploded !== value) this.set({ exploded: value });
  }

  /** Changes the step being made. */
  setExplodeDraft(patch: Partial<ExplodeStep>): void {
    const d = this.state.explode;
    if (d) this.set({ explode: { ...d, step: { ...d.step, ...patch } } });
  }

  /** Whether the next element picked in the graphics area is the step's direction. */
  pickExplodeAxis(on: boolean): void {
    const d = this.state.explode;
    if (d) this.set({ explode: { ...d, picking: on } });
  }

  /** 「編輯」 on a step of the list. */
  editExplodeStep(id: Id): void {
    const s = this.history.doc.explosion?.find((x) => x.id === id);
    if (!s) return;
    if (!this.state.explode) this.startExplode();
    this.set({ explode: { editing: id, step: s, picking: false }, exploded: true, selected: id });
  }

  /** 「加入步驟」 / 「更新步驟」: the step goes into the document (one undo step) and the PropertyManager stays for the next. */
  applyExplodeStep(): void {
    const d = this.state.explode;
    if (!d) return;
    if (!this.execute({ type: d.editing ? 'setExplodeStep' : 'insertExplodeStep', step: d.step })) return;
    this.set({ explode: { editing: null, step: this.newExplodeStep(), picking: false }, exploded: true });
  }

  deleteExplodeSteps(stepIds: Id[]): void {
    if (stepIds.length === 0) return;
    if (this.execute({ type: 'deleteExplodeSteps', stepIds }) && this.state.explode) this.set({ explode: { editing: null, step: this.newExplodeStep(), picking: false } });
  }

  moveExplodeStep(stepId: Id, to: number): void {
    this.execute({ type: 'moveExplodeStep', stepId, to });
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
    if (this.state.pattern) this.cancelPattern();
    this.leaveExplode();
    const project = (this.project ??= await this.host.projectFolder('插入零組件會從專案資料夾讀取零件檔（.3dbx）與 STEP 檔；組合件也要存在這個資料夾之內，才能以相對路徑找到零件。'));
    if (!project) return;
    this.set({ insert: { files: null, chosen: null }, selected: null });
    let listed = { files: [] as string[], truncated: false };
    try {
      // STEP files are taken as parts, as SolidWorks inserts them (F2.1); assembly files are sub-assemblies (C15.4), but not this one.
      listed = await listFiles(project, [PART_FILE_EXTENSION, ASSEMBLY_FILE_EXTENSION, '.step', '.stp']);
      const own = this.ownPath();
      if (own) listed.files = listed.files.filter((p) => p !== own);
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
    if (status.assembly) {
      // everything below it must be read before it can be judged; then it must not reach this assembly again (C15.4)
      if ([...this.state.files.values()].some((s) => s.status === 'loading')) return this.host.notify(t('subassembly.stillLoading'), 'info');
      const own = this.ownPath();
      const cycle = own ? findReferenceCycle(own, (p) => this.refsOf(p, undefined, chosen)) : null;
      if (cycle) return this.host.notify(cycleMessage(cycle), 'error');
    }
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

  /** What is inside a sub-assembly, in order, for the FeatureManager to list: each component's name and how deep it is (nested ones follow their sub-assembly). */
  subComponents(componentId: Id): { path: Id[]; depth: number; name: string; assembly: boolean; missing: boolean }[] {
    const doc = this.history.doc;
    const c0 = doc.components.find((x) => x.id === componentId);
    const f0 = c0 && doc.files.find((f) => f.id === c0.file);
    const out: { path: Id[]; depth: number; name: string; assembly: boolean; missing: boolean }[] = [];
    const walk = (path: string, above: readonly string[], ids: Id[]) => {
      const status = this.state.files.get(path);
      if (status?.status !== 'ok' || !status.assembly || above.includes(path)) return;
      for (const c of status.assembly.components) {
        const file = status.assembly.files.find((f) => f.id === c.file);
        const childPath = file ? joinPath(dirName(path), file.path) : null;
        const child = childPath ? this.state.files.get(childPath) : undefined;
        const here = [...ids, c.id];
        out.push({ path: here, depth: here.length, name: componentName(file?.path, c.instance), assembly: child?.status === 'ok' && !!child.assembly, missing: child?.status === 'missing' || child?.status === 'error' || !child });
        if (childPath) walk(childPath, [...above, path], here);
      }
    };
    if (f0) walk(joinPath(this.folder, f0.path), [], []);
    return out;
  }

  /** 「定位組<1>／削邊銷<2>」: the component of a mate element, and the components inside it on the way to the part (C15.4). */
  ownerLabel(top: Id, path: readonly Id[] = [], from = 0): string {
    const doc = this.history.doc;
    const labels = [this.componentLabel(top)];
    const c0 = doc.components.find((x) => x.id === top);
    const f0 = c0 && doc.files.find((f) => f.id === c0.file);
    let tree = f0 ? this.treeOf(joinPath(this.folder, f0.path)) : null;
    for (const id of path) {
      if (tree?.kind !== 'assembly') {
        labels.push(id);
        break;
      }
      const c = tree.doc.components.find((x) => x.id === id);
      const file = c && tree.doc.files.find((f) => f.id === c.file);
      labels.push(c ? componentName(file?.path, c.instance) : id);
      tree = tree.children[id] ?? null;
    }
    return labels.slice(from).join(t('subassembly.pathSeparator'));
  }

  /** The middle of a component's part (its bounding box), in the part's coordinates: what it turns about. */
  private centerOf(componentId: Id): Vec3 {
    if (this.isSubAssembly(componentId)) return this.subCenter(componentId);
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

  /** The middle of the bounding box of everything in a sub-assembly, in the sub-assembly's own coordinates. */
  private subCenter(componentId: Id): Vec3 {
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    const to = this.poseOf(componentId);
    for (const leaf of this.leaves()) {
      const build = leaf.top === componentId && !leaf.instanceOf ? this.buildOfLeaf(leaf) : null;
      if (!build?.mesh || !to) continue;
      const inside = relativePose(to, leaf.pose); // the leaf in the sub-assembly's coordinates
      const p = build.mesh.positions;
      for (let i = 0; i < p.length; i += 3) {
        const q = transformPoint(inside, [p[i]!, p[i + 1]!, p[i + 2]!]);
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k]!, q[k]!);
          hi[k] = Math.max(hi[k]!, q[k]!);
        }
      }
    }
    return lo[0]! <= hi[0]! ? [(lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2, (lo[2]! + hi[2]!) / 2] : [0, 0, 0];
  }

  /** Why a component cannot be moved: fixed, or fully defined by its mates; null when it can. */
  private cannotMove(componentId: Id): string | null {
    const c = this.history.doc.components.find((x) => x.id === componentId);
    if (!c) return '找不到零組件';
    const name = this.componentLabel(componentId);
    if (c.suppressed) return t('subassembly.suppressedCannotMove', { name });
    const why = immovable(c, this.state.solution);
    if (why === 'fixed') return `「${name}」已固定，不能移動（在設計樹按右鍵→「浮動」）`;
    if (why === 'defined') return `「${name}」已被結合完全定義，不能移動`;
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
    if (this.state.exploded) {
      this.host.notify(t('explode.cannotWhileExploded'));
      return false;
    }
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
        const r = await this.host.api.solveAssembly(this.history.doc, this.trees(), { start: d.latest, goal: { body: d.component, terms } });
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
    if (this.state.pattern) this.cancelPattern();
    this.leaveExplode();
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
      const r = await this.host.api.solveAssembly(this.history.doc, this.trees(), { start: solution.poses, goal: { body: c.id, terms } });
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
    this.pointOutNestedProblems();
    const missing = this.missingFiles().length > 0;
    if (!missing && this.state.relink) this.set({ relink: null });
    if (missing && !this.missingShown && this.project) {
      this.missingShown = true;
      void this.openRelink();
    }
  }

  /** Files a sub-assembly uses that cannot be used (missing, unreadable): said once each; fixing them means opening the sub-assembly (its own 「找不到參考的檔案」). */
  private nestedPointedOut = new Set<string>();
  private pointOutNestedProblems(): void {
    const direct = new Set(this.history.doc.files.map((f) => joinPath(this.folder, f.path)));
    for (const [path, status] of this.state.files) {
      if (direct.has(path) || (status.status !== 'missing' && status.status !== 'error') || this.nestedPointedOut.has(path)) continue;
      this.nestedPointedOut.add(path);
      this.host.notify(t('subassembly.nestedProblem', { path, why: status.message }), 'error');
    }
  }

  /** 「找不到參考的檔案」: the missing files, and files of the project folder with their names (moved elsewhere). */
  async openRelink(): Promise<void> {
    const project = this.project;
    if (!project) return;
    this.set({ relink: { candidates: null } });
    let found: string[] = [];
    try {
      found = (await listFiles(project, [PART_FILE_EXTENSION, ASSEMBLY_FILE_EXTENSION, '.step', '.stp'])).files;
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
