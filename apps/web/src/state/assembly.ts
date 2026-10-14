import { proxy, type Remote } from 'comlink';
import {
  AssemblyHistory,
  assemblyIdsInUse,
  axisAngle,
  baseName,
  CommandError,
  composeRotations,
  lerpPose,
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
  activeExplosion,
  explodeLeaves,
  explosionOffsets,
  explosionSteps,
  formSubAssembly,
  formSubAssemblyProblem,
  leavesCentre,
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
import { contentKey, gatherSources } from './sources';
import { ASSEMBLY_FILE_EXTENSION, assemblyFileName, assemblyName, componentName, PART_FILE_EXTENSION, readDocumentFile, sha256Hex, stepStructure, writeAssemblyFile, writePartFile } from '@3db/io';
import { t } from '@3db/i18n';
import type { AssemblyResult } from '@3db/regen';
import type { AssemblyStepRequest, KernelApi, PartBuildPayload, PartStage } from '../worker/protocol';
import { fileIn, listFiles, pathIn, pickAssemblySaveTarget, pickPartFile, writeFile, writeFilesInto } from '../files';
import { standardName, standardPartDoc, standardProblem, type StandardSpec } from '@3db/library';
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
  /** Width: [the other width face, the other tab face]; symmetric: [the plane] (C15.9). Empty places are not picked yet. */
  more?: (MateRef | null)[];
  /** Limits of a distance or an angle, as typed; empty is none (C15.9). */
  min?: string;
  max?: string;
}

/** The mates that take more than two elements (C15.9). */
export const ADVANCED_MATES: readonly MateType[] = ['width', 'symmetric'];
export const isAdvancedMate = (type: MateType | null): type is 'width' | 'symmetric' => type !== null && ADVANCED_MATES.includes(type);

/** The elements of an advanced mate in the order they are picked: width — width face, its partner, tab face, its partner; symmetric — the two, then the plane. */
export function mateSlots(d: MateDraft): (MateRef | null)[] {
  const more = d.more ?? [];
  return d.type === 'width' ? [d.a, more[0] ?? null, d.b, more[1] ?? null] : [d.a, d.b, more[0] ?? null];
}

/** The draft with its elements put into the places `mateSlots` lists. */
function withMateSlots(d: MateDraft, slots: (MateRef | null)[]): MateDraft {
  return d.type === 'width' ? { ...d, a: slots[0]!, b: slots[2]!, more: [slots[1]!, slots[3]!] } : { ...d, a: slots[0]!, b: slots[1]!, more: [slots[2]!] };
}

/** The mate a draft shows before it is added: solved with the others, not yet in the document. */
export const PREVIEW_MATE = 'preview';

/** A component being dragged (C15.3, A3.5): moved with the left button, turned with the right. */
export interface DragState {
  component: Id;
  mode: 'move' | 'rotate';
  /** Every component where the latest pointer position puts it (derived; shown instead of the solution). */
  poses: ReadonlyMap<Id, Pose> | null;
  /** The component stopped at what it ran into (A3.6): what they are called, and the components of the assembly they are (drawn red). */
  blocked?: { names: string[]; tops: Id[] };
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
  /** A drag stops where the component would run into another (A3.6); off until the move PropertyManager asks for it. */
  collisionStop: boolean;
  /** The move PropertyManager (C15.3); null while it is closed. */
  move: MoveState | null;
  /** The dialog for part files that cannot be found (B9.4); null while it is closed. */
  relink: RelinkState | null;
  /** The pattern PropertyManager (C15.13); null while it is closed. */
  pattern: PatternDraft | null;
  /** The exploded view's PropertyManager (C15.14); null while it is closed. */
  explode: ExplodeDraft | null;
  /** The view shows the assembly exploded (a display only: no pose is changed, and nothing can be moved or mated while it is). The state it is going to: see `explodeT`. */
  exploded: boolean;
  /** How far the view is along the way from assembled (0) to exploded (1): it runs there over half a second when `exploded` changes. Only for what is drawn. */
  explodeT: number;
  /** The explode lines (the way each component goes) are drawn while the view is exploded. A display choice, not kept in the file. */
  explodeLines: boolean;
  /** The PropertyManager that forms a sub-assembly (E-3): the components picked and the file name; null while it is closed. */
  formSub: FormSubDraft | null;
}

export interface FormSubDraft {
  ids: Id[];
  name: string;
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
/** How long the exploded view takes to open or close (ms). */
export const EXPLODE_MS = 500;

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
  /** The master files a derived part was built from (C7.5), by the part's path, with the stamp each had: a part is read again when one of them changes. */
  private masterStamps = new Map<string, Map<string, string>>();
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
    /** The pairs that shared volume when the drag began (A3.6): not held against it. */
    baseline?: Set<string>;
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
      collisionStop: false,
      move: null,
      relink: null,
      pattern: null,
      explode: null,
      exploded: false,
      explodeT: 0,
      explodeLines: true,
      formSub: null,
    };
    this.history.subscribe(() => this.onDocChanged());
    this.loadFiles();
    this.requestSolve();
  }

  getState = (): AssemblyState => this.state;

  /** The file the assembly is saved in; null while it has not been saved. */
  fileHandle(): FileSystemFileHandle | null {
    return this.handle;
  }

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
      let key = await sha256Hex(bytes);
      if (path.toLowerCase().endsWith(ASSEMBLY_FILE_EXTENSION)) {
        const opened = await readDocumentFile(bytes);
        if (opened.kind !== 'assembly') return { status: 'error', message: t('subassembly.notAssembly', { path }) };
        return { status: 'ok', key, assembly: opened.doc }; // its own files are read when this is known (readInto)
      }
      // a part derived from another file (C7.5) is built from that file's content too
      const masters = await gatherSources(project, path, bytes);
      this.masterStamps.set(path, masters.stamps);
      key = await contentKey(bytes, masters.sources);
      if (!this.state.builds.has(key)) {
        const build = await this.host.api.buildPart(key, bytes, proxy((stage: PartStage) => this.stageReached(path, stage, generation)), masters.sources.length > 0 ? masters.sources : undefined);
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
        if (stamp === null ? status.status === 'missing' : stamp === this.stamps.get(path) && status.status === 'ok' && !(await this.mastersChanged(project, path))) continue;
        this.readInto(path);
      }
    } finally {
      this.refreshing = false;
    }
  }

  /** Whether a master file that the derived part at `path` was built from has changed, or gone, since (C7.5). */
  private async mastersChanged(project: FileSystemDirectoryHandle, path: string): Promise<boolean> {
    for (const [master, stamp] of this.masterStamps.get(path) ?? []) {
      try {
        const file = await (await fileIn(project, master)).getFile();
        if (`${file.lastModified}:${file.size}` !== stamp) return true;
      } catch {
        return true;
      }
    }
    return false;
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

  private leafCache: { doc: AssemblyDoc; files: AssemblyState['files']; solution: AssemblyResult | null; drag: AssemblyState['drag']; pattern: PatternDraft | null; explodeT: number; leaves: Leaf[]; problems: Map<Id, string>; explodeProblems: Map<Id, string> } | null = null;

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
    const { files, solution, drag, pattern, explodeT } = this.state;
    const doc = this.history.doc;
    const c = this.leafCache;
    if (c && c.doc === doc && c.files === files && c.solution === solution && c.drag === drag && c.pattern === pattern && c.explodeT === explodeT) return c.leaves;
    const base = leavesOf(doc, this.trees(), (id) => this.poseOf(id), solution?.inner);
    // the parts patterns and mirrors add (C15.13); their axes are found among the parts of the components themselves
    const made = patternLeavesOf(this.shownDoc(), base, (axis) => this.lineOf(axis, base));
    let leaves = [...base, ...made.leaves];
    // the exploded view (C15.14): each component's leaves, its sub-assembly's parts and its pattern's instances moved by its offset; no pose is changed
    const exploding = explosionOffsets(doc, (axis) => this.lineOf(axis, base));
    if (explodeT > 0) leaves = explodeLeaves(leaves, exploding.offsets, explodeT);
    this.leafCache = { doc, files, solution, drag, pattern, explodeT, leaves, problems: made.problems, explodeProblems: exploding.problems };
    this.ensureMirrors(leaves);
    return leaves;
  }

  /** Every part with the components at the poses given (and the parts inside sub-assemblies where `inner` has them): what a drag asks about before it shows a pose (A3.6). */
  private leavesAt(poses: ReadonlyMap<Id, Pose>, inner: AssemblyResult['inner']): Leaf[] {
    const base = leavesOf(this.history.doc, this.trees(), (id) => poses.get(id) ?? null, inner);
    return [...base, ...patternLeavesOf(this.shownDoc(), base, (axis) => this.lineOf(axis, base)).leaves];
  }

  /** Every part where it is assembled (the exploded view does not move it): what mass properties and interference are worked out on. */
  assembledLeaves(): Leaf[] {
    if (this.state.explodeT === 0) return this.leaves();
    const doc = this.history.doc;
    const base = leavesOf(doc, this.trees(), (id) => this.poseOf(id), this.state.solution?.inner);
    return [...base, ...patternLeavesOf(this.shownDoc(), base, (axis) => this.lineOf(axis, base)).leaves];
  }

  /**
   * What interference (E2.1) is asked of: the components as the user sees them (a sub-assembly one, each copy of a pattern or mirror its own), each as its
   * parts and where they are assembled, and what each is called in the list.
   */
  interferenceInput(at?: { poses: ReadonlyMap<Id, Pose>; inner?: AssemblyResult['inner'] }, within = false): { components: InterferenceComponent[]; names: Map<string, string>; tops: Map<string, string> } {
    const unmirror = (key: string) => key.slice(0, -mirrorKey('').length);
    const names = new Map<string, string>();
    const tops = new Map<string, string>();
    const leaves = at ? this.leavesAt(at.poses, at.inner) : this.assembledLeaves();
    // with `within` every part is a component (the ones inside a sub-assembly are compared with each other): a part in a sub-assembly is named after it
    const groups = interferenceGroups(leaves, { parts: within });
    const perTop = new Map<string, number>();
    for (const l of leaves) perTop.set(l.top, (perTop.get(l.top) ?? 0) + 1);
    const seen = new Map<string, number>();
    for (const g of groups) {
      const owner = this.ownerLabel(g.top);
      const inside = within && g.instance === null && (perTop.get(g.top) ?? 0) > 1;
      let partName = inside ? bomName(g.leaves[0]!.file ?? g.leaves[0]!.key) : '';
      if (inside) {
        // two parts of one name in a sub-assembly (a pair of pins): the second is <2>, as the components of an assembly are
        const n = (seen.get(`${g.top}|${partName}`) ?? 0) + 1;
        seen.set(`${g.top}|${partName}`, n);
        if (n > 1) partName = `${partName}<${n}>`;
      }
      const base = inside ? t('interference.inside', { owner, part: partName }) : owner;
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
    return buildBom({ doc: this.history.doc, trees: this.trees(), propsOf: (key) => this.state.builds.get(key)?.properties, isReference: (key) => this.state.builds.get(key)?.referenceOnly === true, problems: this.patternProblems() });
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
    this.set({
      mate: {
        editing: id,
        a: m.a,
        b: m.b,
        type: m.type,
        ...(m.align ? { align: m.align } : {}),
        ...value,
        ...(m.flip ? { flip: true } : {}),
        ...(m.more ? { more: m.more } : {}),
        ...(m.min !== undefined ? { min: m.min } : {}),
        ...(m.max !== undefined ? { max: m.max } : {}),
      },
      selected: id,
    });
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
    if (isAdvancedMate(d.type)) return this.pickAdvanced(d, ref);
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

  /**
   * A width or symmetric mate (C15.9) takes its elements in order: a picked one fills the first empty place, a chosen one picked again leaves it. For a
   * width mate the second width face is on the first one's component and the second tab face on the first tab face's, and the two pairs are on different ones.
   */
  private pickAdvanced(d: MateDraft, ref: MateRef): void {
    const slots = mateSlots(d);
    const at = slots.findIndex((s) => sameRef(s, ref));
    if (at >= 0) slots[at] = null;
    else {
      const free = slots.findIndex((s) => s === null);
      if (free < 0) return;
      if (d.type === 'width') {
        const need: (number | null)[] = [null, 0, null, 2];
        const partner = need[free] === null ? null : slots[need[free]!];
        const other = free === 2 ? slots[0] : free === 0 ? slots[2] : null;
        if (partner && partner.component !== ref.component) return this.host.notify(t('mate.widthPickSame'), 'error');
        if (other && other.component === ref.component) return this.host.notify(t('mate.widthPickOther'), 'error');
      }
      slots[free] = ref;
    }
    this.setDraft(withMateSlots(d, slots));
  }

  /** Type, alignment and value for a pair: kept when they still fit, else what SolidWorks would take. */
  private suggested(d: MateDraft): MateDraft {
    const ga = d.a && this.elementGeometry(d.a);
    const gb = d.b && this.elementGeometry(d.b);
    if (!ga || !gb) return { editing: d.editing, a: d.a, b: d.b, type: d.b ? d.type : null, ...limitsOf(d) };
    const both = d.a!.component !== null && d.b!.component !== null;
    const type = d.type && supportedTypes(ga, gb, both).includes(d.type) ? d.type : defaultType(ga, gb, both);
    return this.withOptions({ ...d, type }, ga, gb, d.type === type);
  }

  /** The options a type needs, from the elements as they are now (unless kept from before). */
  private withOptions(d: MateDraft, ga: MateGeometry, gb: MateGeometry, keep: boolean): MateDraft {
    const out: MateDraft = { editing: d.editing, a: d.a, b: d.b, type: d.type, ...limitsOf(d) };
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
    if (!d) return;
    if (isAdvancedMate(type)) {
      // width and symmetric keep what is picked and wait for the rest (C15.9)
      const { more: _more, align: _align, value: _value, flip: _flip, min: _min, max: _max, ...rest } = d;
      return this.setDraft({ ...rest, type, more: type === 'width' ? [null, null] : [null] });
    }
    const ga = d.a && this.elementGeometry(d.a);
    const gb = d.b && this.elementGeometry(d.b);
    const { more: _more, ...plain } = d;
    if (ga && gb) this.setDraft(this.withOptions({ ...plain, type }, ga, gb, false));
  }

  setMateOptions(options: Pick<MateDraft, 'align' | 'value' | 'flip' | 'min' | 'max'>): void {
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
    if (isAdvancedMate(d.type) && mateSlots(d).some((s) => s === null)) return null;
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
    // limits (C15.9): empty is none; what is typed has to read
    let min: string | undefined;
    let max: string | undefined;
    if (d.type === 'distance' || d.type === 'angle') {
      for (const [key, typed] of [['min', d.min], ['max', d.max]] as const) {
        const text = typed?.trim();
        if (!text) continue;
        try {
          const v = d.type === 'distance' ? evalLength(text) : evalAngle(text);
          if (!Number.isFinite(v) || v < 0) return null;
        } catch {
          return null;
        }
        if (key === 'min') min = text;
        else max = text;
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
    const autoName = before && new RegExp(`^(${Object.values(MATE_LABEL).join('|')})\\d+$`).test(before.name);
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
      ...(isAdvancedMate(d.type) ? { more: d.more!.map((r) => r!) } : {}),
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
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
    if (!m) return this.host.notify(isAdvancedMate(d.type) ? t('mate.incomplete') : !d.a || !d.b ? '請選擇兩個要結合的元素' : '請檢查結合類型與數值', 'error');
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
    this.set({ explode: { editing: null, step: this.newExplodeStep(), picking: false } });
    this.setExploded(true);
  }

  private newExplodeStep(): ExplodeStep {
    const doc = this.history.doc;
    const id = new IdAllocator(doc.idCounters, assemblyIdsInUse(doc)).take('explode');
    const seed = doc.components.find((c) => c.id === this.state.selected && !c.suppressed);
    return { id, name: t('explode.stepName', { n: explosionSteps(doc).length + 1 }), components: seed ? [seed.id] : [], axis: { kind: 'axis', axis: 'z' }, distance: '50' };
  }

  /** What needs the assembled positions (mating, moving, inserting, patterns) closes the exploded view first. */
  private leaveExplode(): void {
    if (this.state.explode || this.state.exploded || this.state.explodeT !== 0) {
      this.stopExplodeAnimation();
      this.set({ explode: null, exploded: false, explodeT: 0 });
    }
  }

  closeExplode(): void {
    if (this.state.explode) this.set({ explode: null });
  }

  /** Shows the assembly exploded, or as it is assembled (a display: no pose changes). The view goes there over half a second. */
  setExploded(value: boolean): void {
    if (this.state.exploded !== value) this.set({ exploded: value });
    this.animateExplode(value ? 1 : 0);
  }

  /** What asks for the next frame of the animation; null where there are no frames (a test, a worker): the view then jumps to where it goes. Replaceable. */
  frameRequest: ((callback: (now: number) => void) => number) | null = typeof requestAnimationFrame === 'function' ? (cb) => requestAnimationFrame(cb) : null;
  frameCancel: (id: number) => void = (id) => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(id) : undefined);
  private explodeFrame: number | null = null;

  private stopExplodeAnimation(): void {
    if (this.explodeFrame !== null) this.frameCancel(this.explodeFrame);
    this.explodeFrame = null;
  }

  /** Runs `explodeT` to `to` (0 or 1) at the pace of half a second for the whole way, slow at both ends. */
  private animateExplode(to: 0 | 1): void {
    this.stopExplodeAnimation();
    const from = this.state.explodeT;
    if (from === to) return;
    const request = this.frameRequest;
    if (!request) {
      // No frames (a test, a worker): the view jumps straight there — and the fit comes after the move.
      this.set({ explodeT: to, fitRequest: this.state.fitRequest + 1 });
      return;
    }
    const duration = EXPLODE_MS * Math.abs(to - from);
    let start: number | null = null;
    const tick = (now: number) => {
      start ??= now;
      const k = Math.min(1, (now - start) / duration);
      const eased = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      // When the move is done the parts stand at their other extent: 「全部顯示」 again so the assembly fills the view (2026-10-14 decision C2).
      this.set({ explodeT: k >= 1 ? to : from + (to - from) * eased, ...(k >= 1 ? { fitRequest: this.state.fitRequest + 1 } : {}) });
      this.explodeFrame = k >= 1 ? null : request(tick);
    };
    this.explodeFrame = request(tick);
  }

  /** Shows or hides the explode lines. */
  setExplodeLines(value: boolean): void {
    if (this.state.explodeLines !== value) this.set({ explodeLines: value });
  }

  /**
   * The explode lines: for each component that is moved, the way it goes as one polyline (x, y, z …) from the middle of its parts where they are assembled through where each
   * step puts it, as far as the view has gone (`explodeT`). None while the view is assembled or when the lines are off. Derived.
   */
  explodeGuides(): number[][] {
    const { explodeT, explodeLines, builds } = this.state;
    if (!explodeLines || explodeT <= 0) return [];
    const doc = this.history.doc;
    const base = leavesOf(doc, this.trees(), (id) => this.poseOf(id), this.state.solution?.inner);
    const all = [...base, ...patternLeavesOf(this.shownDoc(), base, (axis) => this.lineOf(axis, base)).leaves];
    const { paths } = explosionOffsets(doc, (axis) => this.lineOf(axis, base));
    const box = new Map<string, { min: Vec3; max: Vec3 } | null>();
    const boundsOf = (key: string) => {
      if (!box.has(key)) {
        const p = builds.get(key)?.mesh?.positions;
        if (!p || p.length < 3) box.set(key, null);
        else {
          const min: Vec3 = [Infinity, Infinity, Infinity];
          const max: Vec3 = [-Infinity, -Infinity, -Infinity];
          for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) {
            min[k] = Math.min(min[k]!, p[i + k]!);
            max[k] = Math.max(max[k]!, p[i + k]!);
          }
          box.set(key, { min, max });
        }
      }
      return box.get(key)!;
    };
    const lines: number[][] = [];
    for (const [id, way] of paths) {
      const centre = leavesCentre(all.filter((l) => l.top === id && !l.hidden), boundsOf);
      if (!centre) continue;
      lines.push([...centre, ...way.flatMap((o) => [centre[0] + o[0] * explodeT, centre[1] + o[1] * explodeT, centre[2] + o[2] * explodeT])]);
    }
    return lines;
  }

  // ------------------------------------------------------------ forming a sub-assembly (E-3)

  /** 「形成次組合件…」: opens the PropertyManager, the selected component picked. */
  startFormSub(): void {
    const doc = this.history.doc;
    if (doc.components.length < 2) return this.host.notify(t('subassembly.form.tooFew'), 'error');
    if (this.state.insert) this.cancelInsert();
    if (this.state.mate) this.cancelMate();
    if (this.state.move) this.closeMove();
    if (this.state.pattern) this.cancelPattern();
    this.leaveExplode();
    const picked = doc.components.find((c) => c.id === this.state.selected);
    this.set({ formSub: { ids: picked ? [picked.id] : [], name: t('subassembly.form.defaultName', { n: this.freeSubName() }) } });
  }

  /** The number that makes 「次組合件N」 a name no file of the assembly has. */
  private freeSubName(): number {
    const used = new Set(this.history.doc.files.map((f) => f.path));
    let n = 1;
    while (used.has(assemblyFileName(t('subassembly.form.defaultName', { n })))) n++;
    return n;
  }

  setFormSub(patch: Partial<FormSubDraft>): void {
    const d = this.state.formSub;
    if (d) this.set({ formSub: { ...d, ...patch } });
  }

  cancelFormSub(): void {
    if (this.state.formSub) this.set({ formSub: null });
  }

  /** Why the sub-assembly cannot be formed from what is picked and named (empty: it can). */
  formSubProblem(): string {
    const d = this.state.formSub;
    if (!d) return '';
    const name = d.name.trim();
    if (name === '') return t('subassembly.form.nameEmpty');
    if (/[\\/:*?"<>|]/.test(name) || name.startsWith('.')) return t('subassembly.form.nameBad');
    if (this.history.doc.files.some((f) => f.path === assemblyFileName(name))) return t('subassembly.form.exists', { name: assemblyFileName(name) });
    return formSubAssemblyProblem(this.history.doc, d.ids) ?? '';
  }

  /**
   * 「形成」: the new assembly file is written next to this one, then the assembly changes in one undo step (the components go, one stands for the file at the origin). The
   * sub-assembly starts at the poses the mates have put the components at, so nothing moves. A name a file in the folder has already is refused; nothing is changed when the file cannot be written.
   */
  async applyFormSub(): Promise<void> {
    const d = this.state.formSub;
    if (!d) return;
    const problem = this.formSubProblem();
    if (problem) return this.host.notify(problem, 'error');
    const doc = this.history.doc;
    const fileName = assemblyFileName(d.name.trim());
    try {
      const project = (this.project ??= await this.host.projectFolder(t('subassembly.form.needProject')));
      if (!project) return;
      const path = joinPath(this.folder, fileName);
      const taken = await fileIn(project, path).then(() => true, () => false);
      if (taken) return this.host.notify(t('subassembly.form.exists', { name: fileName }), 'error');
      const allocator = new IdAllocator(doc.idCounters, assemblyIdsInUse(doc));
      const file = { id: allocator.take('file'), path: fileName };
      const componentId = allocator.take('comp');
      const placements = d.ids.flatMap((id) => {
        const pose = this.poseOf(id);
        return pose ? [{ componentId: id, placement: pose }] : [];
      });
      const { sub } = formSubAssembly(doc, d.ids, { file, componentId, placements: new Map(placements.map((p) => [p.componentId, p.placement])) });
      await writeFilesInto(project, [{ path, bytes: await writeAssemblyFile(sub) }]);
      if (!this.execute({ type: 'formSubAssembly', componentIds: d.ids, file, componentId, placements })) return;
      this.set({ formSub: null, selected: componentId });
      this.host.notify(t('subassembly.form.made', { name: fileName, n: sub.components.length, mates: sub.mates.length }));
    } catch (e) {
      this.host.notify(t('subassembly.form.failed', { why: e instanceof Error ? e.message : String(e) }), 'error');
    }
  }

  /** 「新增一組」: another exploded view, empty, which becomes the one that is shown and made (one undo step). */
  addExplosion(): void {
    const doc = this.history.doc;
    const id = new IdAllocator(doc.idCounters, assemblyIdsInUse(doc)).take('explosion');
    if (this.execute({ type: 'insertExplosion', explosion: { id, name: t('explode.viewName', { n: (doc.explosions?.length ?? 0) + 1 }), steps: [] } })) this.restartExplodeDraft();
  }

  /** Shows and makes the steps of another exploded view. */
  selectExplosion(id: Id): void {
    if (activeExplosion(this.history.doc)?.id === id) return;
    if (this.execute({ type: 'setActiveExplosion', explosionId: id })) this.restartExplodeDraft();
  }

  /** Another name for the exploded view that is shown. */
  renameExplosion(name: string): void {
    const v = activeExplosion(this.history.doc);
    if (v) this.execute({ type: 'renameExplosion', explosionId: v.id, name });
  }

  /** Deletes the exploded view that is shown, with its steps; the next one is shown. */
  deleteExplosion(): void {
    const v = activeExplosion(this.history.doc);
    if (v && this.execute({ type: 'deleteExplosion', explosionId: v.id })) this.restartExplodeDraft();
  }

  /** What was being made in the PropertyManager belongs to the exploded view that was shown: a new step in the one that is now. */
  private restartExplodeDraft(): void {
    if (this.state.explode) this.set({ explode: { editing: null, step: this.newExplodeStep(), picking: false }, selected: null });
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
    const s = explosionSteps(this.history.doc).find((x) => x.id === id);
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

  /** A new assembly with nothing in it yet can still move to another project folder: no component path depends on the old one. */
  canChangeProject(): boolean {
    return this.handle === null && this.history.doc.components.length === 0;
  }

  /** Reads the part list again from `folder`, the new project folder of an empty, unsaved assembly. */
  async setProject(folder: FileSystemDirectoryHandle): Promise<void> {
    if (!this.canChangeProject()) return;
    this.project = folder;
    this.generation += 1;
    this.stamps.clear();
    this.set({ files: new Map(), insert: null });
    await this.startInsert();
  }

  /** The part to place; it is read and rebuilt at once so it can follow the cursor. */
  choosePart(path: string): void {
    const insert = this.state.insert;
    if (!insert) return;
    this.set({ insert: { ...insert, chosen: path } });
    this.load(path);
  }

  /**
   * The standard part library (F6.1): a part of the size asked for is made as a file in the project folder's 「標準件」 folder (unless it is there already)
   * and chosen for placing, like any part of the list. The click that asks is the click that lets the browser write.
   */
  async addStandardPart(spec: StandardSpec): Promise<void> {
    const insert = this.getState().insert;
    const project = this.project;
    if (!insert || !project) return;
    const problem = standardProblem(spec);
    if (problem) return this.host.notify(problem, 'error');
    const path = `${t('library.folder')}/${standardName(spec)}${PART_FILE_EXTENSION}`;
    try {
      if (!insert.files?.includes(path)) {
        await writeFilesInto(project, [{ path, bytes: await writePartFile(standardPartDoc(spec)) }]);
        const now = this.getState().insert;
        if (now) this.set({ insert: { ...now, files: [...(now.files ?? []), path].sort((a, b) => a.localeCompare(b, 'zh-Hant')) } });
        this.host.notify(t('library.made', { name: standardName(spec) }));
      }
      this.choosePart(path);
    } catch (e) {
      this.host.notify(t('library.failed', { why: e instanceof Error ? e.message : String(e) }), 'error');
    }
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
        const solved = await this.host.api.solveAssembly(this.history.doc, this.trees(), { start: d.latest, goal: { body: d.component, terms } });
        if (this.dragging !== d) return;
        const guarded = this.state.collisionStop ? await this.stopBeforeContact(d, solved) : { result: solved, hit: null };
        if (this.dragging !== d) return;
        const r = guarded.result;
        d.latest = r.poses;
        d.result = r;
        this.set({ drag: { component: d.component, mode: d.mode, poses: r.poses, ...(guarded.hit ? { blocked: guarded.hit } : {}) } });
      }
    } catch (e) {
      this.host.notify(`移動失敗：${e instanceof Error ? e.message : String(e)}`, 'error');
    } finally {
      d.running = false;
      if (d.ending && this.dragging === d) this.finishDrag();
    }
  }

  /** 「碰撞偵測」 of the move PropertyManager (A3.6): a drag stops where the component would run into another, and the others it touches show red. */
  setCollisionStop(on: boolean): void {
    this.set({ collisionStop: on });
  }

  /**
   * A drag asked the solver for `candidate`; where it puts the moving components may be inside another component (A3.6). Then the poses are found a fraction of
   * the way from where the drag was to where the solver put them, the largest one that is free (found by halving, ten times), the mates are settled there, and
   * that is what is shown, with what it ran into. Collisions that were there when the drag began are not held against it.
   */
  private async stopBeforeContact(d: NonNullable<AssemblyStore['dragging']>, candidate: AssemblyResult): Promise<{ result: AssemblyResult; hit: { names: string[]; tops: Id[] } | null }> {
    const api = this.host.api;
    const movers = new Set(candidate.group && candidate.group.length > 0 ? candidate.group : [d.component]);
    /** The pairs with a moving component that share volume at these poses, apart from the ones the drag began with. */
    const hits = async (poses: ReadonlyMap<Id, Pose>, inner: AssemblyResult['inner']) => {
      const input = this.interferenceInput({ poses, inner });
      const moving = [...input.tops].filter(([, top]) => movers.has(top)).map(([id]) => id);
      if (moving.length === 0 || input.components.length < 2) return { pairs: [] as { a: string; b: string }[], input };
      const r = await api.collisions(input.components, moving);
      return { pairs: r.pairs.filter((p) => !d.baseline?.has(`${p.a}|${p.b}`)), input };
    };
    if (!d.baseline) {
      // what already shares volume where the drag began: nothing is filtered yet
      d.baseline = new Set((await hits(d.latest, this.state.solution?.inner)).pairs.map((p) => `${p.a}|${p.b}`));
    }
    const at1 = await hits(candidate.poses, candidate.inner);
    if (at1.pairs.length === 0) return { result: candidate, hit: null };
    const blend = (t: number): Map<Id, Pose> => {
      const out = new Map(candidate.poses);
      for (const id of movers) {
        const from = d.latest.get(id);
        const to = candidate.poses.get(id);
        if (from && to) out.set(id, lerpPose(from, to, t));
      }
      return out;
    };
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 10; i++) {
      const mid = (lo + hi) / 2;
      if ((await hits(blend(mid), candidate.inner)).pairs.length === 0) lo = mid;
      else hi = mid;
    }
    let poses: Map<Id, Pose> = new Map(lo === 0 ? d.latest : blend(lo));
    let inner = candidate.inner;
    if (lo > 0) {
      // the blend is a step along a straight path: let the mates settle it, and keep that if it is still free
      const settled = await api.solveAssembly(this.history.doc, this.trees(), { start: poses });
      if ((await hits(settled.poses, settled.inner)).pairs.length === 0) {
        poses = new Map(settled.poses);
        inner = settled.inner;
      }
    }
    const names = new Set<string>();
    const tops = new Set<Id>();
    for (const p of at1.pairs) {
      for (const id of [p.a, p.b]) {
        const top = at1.input.tops.get(id) ?? id;
        if (movers.has(top)) continue;
        names.add(at1.input.names.get(id) ?? id);
        tops.add(top);
      }
    }
    return { result: { ...candidate, poses, ...(inner ? { inner } : {}) }, hit: { names: [...names], tops: [...tops] } };
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

/** The limits of a draft, to carry along when its other options are rebuilt (C15.9). */
const limitsOf = (d: MateDraft): Pick<MateDraft, 'min' | 'max'> => ({ ...(d.min !== undefined ? { min: d.min } : {}), ...(d.max !== undefined ? { max: d.max } : {}) });

/** The next free name for a mate of a type: 「重合3」 after 「重合2」, as SolidWorks names them. */
function nextMateName(doc: AssemblyDoc, label: string): string {
  const pattern = new RegExp(`^${label}(\\d+)$`);
  const used = doc.mates.map((m) => Number(pattern.exec(m.name)?.[1] ?? 0));
  return `${label}${Math.max(0, ...used) + 1}`;
}
