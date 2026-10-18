import * as Comlink from 'comlink';
import { DEFAULT_LOCALE, getLocale, LOCALES, setLocale, t, type Locale } from '@3db/i18n';
import { useSyncExternalStore } from 'react';
import {
  DEFAULT_MEASURE_OPTIONS,
  type MeasureOptions,
  canBeSeed,
  CommandError,
  createDemoPart,
  createEmptyAssembly,
  createEmptyPart,
  createPartFromTemplate,
  type PartTemplateId,
  DATUM_PLANES,
  dirName,
  DocHistory,
  findFeature,
  type EndCondition,
  IdAllocator,
  idsInUse,
  isBodyKey,
  isDatumPlaneName,
  planeFrame,
  resolveSketch,
  serializePart,
  type AssemblyDoc,
  type Command,
  type DatumPlaneName,
  type BlobRef,
  type SketchPicture,
  calibratePicture,
  imageSize,
  newPicture,
  type Feature,
  type FilletKind,
  type EdgeFlangeFeature,
  type HemFeature,
  type ThreadFeature,
  type BreakCornerFeature,
  type Fingerprint,
  type Id,
  type ImportedBodyFeature,
  type PartDoc,
  type PatternDefinition,
  type PlaneDefinition,
  type PlaneFrame,
  type MeasureKind,
  type MeasureReport,
  type MeasureTarget,
  bomName,
  page,
  type Ref,
  type SketchFeature,
  type Vec3,
  type DrawingDoc,
  applyDrawingCommand,
  baseName,
  createEmptyDrawing,
  mirrorKey,
} from '@3db/model';
import { readAnyDocumentFile, ASSEMBLY_FILE_EXTENSION, assemblyName, derivedAssemblyFiles, PART_FILE_EXTENSION, partFileName, partName, readDocumentFile, sha256Hex, imageFileName, stepAssemblyFiles, stepFileName, stlFileName, writePartFile } from '@3db/io';
import { gatherSources } from './sources';
import { DrawingStore, type DrawingSource, type DrawingState } from './drawing';
import { flatPatternDxf } from '@3db/drawing';
import type { FlatReport, SheetCheck } from '@3db/regen';
import { orderProblem, suppressionTargets, type SuppressAction } from '@3db/regen/dag';
import { contourChoices, findProfiles, type ContourChoice } from '@3db/sketch/profiles';
import type { ModelItem } from '@3db/sketch/ops';
import type { PickFilter, Snap, Viewer } from '@3db/render';
import { captureVertexAnchor, resolveVertexAnchor } from './measureAnchors';
import type { KernelApi, PartExportOptions, RebuildPayload, SketchSolvePayload, SketchSolveRequest, SourceFileData } from '../worker/protocol';
import { shouldRestartHeap } from '../worker/heap';
import { SketchController, type ControllerView, type SketchHost } from '../sketcher/controller';
import { axisDefinitionFor, emptyRef, put, treeRef } from './datumSlots';
import { measureTargetsOf, pickKey, type SelectionFacts } from './selectionFacts';
import { Autosaver, type Recovery } from '../autosave';
import { loadOptions, parseOptions, saveOptions, type SystemOptions } from '../options';
import {
  download,
  fileIn,
  folderAccess,
  foldersUnsupported,
  isStepFile,
  listFiles,
  pathIn,
  pickFileToOpen,
  pickProjectFolder,
  pickSaveTarget,
  pickStepFile,
  readBytes,
  writeFilesInto,
  rememberedFolder,
  rememberFolder,
  writeFile,
  pickImageFile,
  type OpenedFile,
  dropRecovery,
  keepRecovery,
  recoveryCopy,
} from '../files';
import type { DraftReport, GeometryReport, MeshData, ThicknessReport, UndercutReport } from '@3db/kernel';
import { AssemblyStore, type AssemblySource, type AssemblyState } from './assembly';

export interface EditSession {
  featureId: Id;
  /** A sketch session edits geometry in the graphics area; a feature session edits PropertyManager values; sketchPlane edits the plane of a sketch. */
  kind: 'feature' | 'sketch' | 'sketchPlane';
  /** 「偏移草圖」 (ADR 0127): when the session is confirmed, a sketch starts on the plane it made. */
  thenSketch?: boolean;
}

/** An element picked to measure: in the open part (leaf null), or in the part of a component of the assembly (leaf: the id of its instance in the view, see `leavesOf`). */
export interface MeasurePick {
  leaf: string | null;
  kind: MeasureKind;
  index: number;
  label: string;
  /** A place instead of an element (kind `vertex`, `index` not used): where, in the part's own frame. */
  point?: Vec3;
  /** A picked mesh vertex, followed by persistent name through rebuilds. */
  anchor?: { kind: 'vertex'; name: string };
}
/** A measurement that was kept, to be seen with the others: what was picked, what it came to, and how far its labels were moved (pixels, by key). */
export interface SavedMeasure {
  id: string;
  picks: MeasurePick[];
  report: MeasureReport | null;
  offsets: Record<string, [number, number]>;
  anchorLost?: boolean;
}

/** The 「拔模分析」 window (E3.2): its settings, and what the worker last said for them. None of it is saved with the part. */
export interface DraftState {
  /** The direction the mold opens along. */
  pull: Vec3;
  /** What it is called in the window when it is not one of the axes. */
  label: string;
  /** The draft angle required, as typed (degrees). */
  required: string;
  status: 'running' | 'done' | 'error';
  report: DraftReport | null;
  error: string | null;
}

/** The 「底切分析」 window (E3.3): the direction, and what the worker last said for it. Not saved with the part. */
export interface UndercutState {
  pull: Vec3;
  label: string;
  status: 'running' | 'done' | 'error';
  report: UndercutReport | null;
  error: string | null;
}

/** The 「厚度分析」 window (E3.5): the limits as typed (mm, empty for none), and what the worker last said for them. Not saved with the part. */
/** The flat pattern window (C11.3) while it is open: the pattern of the sheet metal part as it is shown, worked out again when the model changes. */
export interface FlatState {
  status: 'running' | 'done' | 'error';
  report: FlatReport | null;
  error: string | null;
  /** The limits of the manufacturability checks (in thicknesses), as typed, and what the checks found with them. */
  limits: { radius: string; flange: string; hole: string };
  checks: SheetCheck[];
  /** The pattern as a solid, and whether the 3D view shows it instead of the folded part (ADR 0115). */
  mesh: MeshData | null;
  show3d: boolean;
}

export interface ThicknessState {
  least: string;
  greatest: string;
  status: 'running' | 'done' | 'error';
  report: ThicknessReport | null;
  error: string | null;
}

/** The limits of a thickness analysis from what was typed: undefined for an empty one, null when what is typed is not a number above 0 or the least is above the greatest. */
export function thicknessLimits(least: string, greatest: string): { min?: number; max?: number } | null {
  const one = (s: string): number | undefined | null => (s.trim() === '' ? undefined : Number.isFinite(Number(s)) && Number(s) > 0 ? Number(s) : null);
  const [min, max] = [one(least), one(greatest)];
  if (min === null || max === null || (min !== undefined && max !== undefined && min > max)) return null;
  return { ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) };
}

export interface MeasureState {
  picks: MeasurePick[];
  report: MeasureReport | null;
  error: string | null;
  /** What a click takes: an element (a face, an edge, a vertex) or a place (an end, a middle, a centre, a place of an edge or a face). */
  mode: 'element' | 'point';
  saved: SavedMeasure[];
  /** How far the labels of the measurement in hand were moved (pixels, by key). */
  offsets: Record<string, [number, number]>;
}

/** A measurement with nothing picked: the way of picking and what was kept stay. */
const emptyMeasure = (from?: MeasureState | null): MeasureState => ({ picks: [], report: null, error: null, mode: from?.mode ?? 'element', saved: from?.saved ?? [], offsets: {} });

/** Two components that share volume, and what they share (one overlap for each pair of their parts that meet). */
export interface InterferencePair {
  a: string;
  b: string;
  aName: string;
  bName: string;
  /** The components of the assembly they are (what is shown as selected). */
  aTop: string;
  bTop: string;
  /** mm³, the overlaps together. */
  volume: number;
  overlaps: MeshData[];
}

/** One pair of components that are closer than the least clearance asked for (E2.2). */
export interface ClearancePair {
  a: string;
  b: string;
  aName: string;
  bName: string;
  aTop: string;
  bTop: string;
  distance: number;
  interferes: boolean;
  /** The closest point on the first, in the assembly's frame. */
  at: Vec3;
}

export const SWEEP_DIRECTIONS = ['+x', '-x', '+y', '-y', '+z', '-z'] as const;
export type SweepDirection = (typeof SWEEP_DIRECTIONS)[number];

/** The clearance verification (E2.2) while its window is open. */
export interface ClearanceState {
  status: 'idle' | 'running' | 'done' | 'error';
  /** The least clearance, as typed (mm). */
  least: string;
  pairs: ClearancePair[];
  selected: number | null;
  unknown: string[];
  failed: string[];
  checked: number;
  ms: number;
  tooFew: boolean;
  error: string | null;
  /** The document and solution it was worked out on: when the assembly shows others, the result is out of date. */
  doc: unknown;
  solution: unknown;
  /** Room to take a component out: the direction and length as typed, and the answer in words. */
  sweep: { dir: SweepDirection; length: string; status: 'idle' | 'running' | 'done' | 'error'; text: string | null; blocked: boolean };
}

export interface InterferenceState {
  status: 'running' | 'done' | 'error';
  pairs: InterferencePair[];
  /** The pair shown alone in the view; null shows them all. */
  selected: number | null;
  /** Components with a part not built (not compared), and the pairs the kernel could not work out. */
  unknown: string[];
  failed: string[];
  checked: number;
  ms: number;
  /** There were fewer than two components: nothing to compare. */
  tooFew: boolean;
  error: string | null;
  /** The parts inside sub-assemblies were compared with each other too (every part a component of its own). */
  within: boolean;
  /** The document and solution it was worked out on: when the assembly shows others, the result is out of date. */
  doc: unknown;
  solution: unknown;
}

export interface Notice {
  kind: 'error' | 'info';
  text: string;
}

/**
 * File actions that replace the open document, and so first ask about unsaved changes. 「開啟零件」
 * switches from an assembly to one of its parts, 「返回組合件」 back (one document at a time).
 */
export type PendingFileAction = 'new-part' | 'new-demo' | 'new-assembly' | 'open' | 'open-part' | 'return-assembly' | 'import-step-assembly';

/** One document is open at a time (2026-09-28 decision): a part or an assembly. */
export type DocumentKind = 'part' | 'assembly' | 'drawing';

/** A group of faces of a face fillet (`faces`, `faces2`) or a full round fillet (the two sides and the `center`). */
export type FilletGroup = 'faces' | 'faces2' | 'center';

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
  /** The edges and vertices picked while nothing is being edited (ADR 0117): ticked in or out with Ctrl or Shift. A command that starts takes them as what it was waiting for. */
  selectedElements: Ref[];
  /** What the picked elements are, measured by the kernel (E1 §2.2): the numbers the selection panel shows, asked again when the pick or the model changes. Null when nothing is picked. */
  selectionFacts: SelectionFacts | null;
  /** The bodies there were when a knit, thicken or cut with surface was started: what it can pick from (a body it uses up, or turns into a solid, is not what the model it shows has). */
  bodyPool: { id: Id; name: string; surface: boolean }[];
  /** Which kinds of element the graphics area lets be picked (D5.4): a command asks for kinds, this narrows them. Radio in the UI, as the SW filter toolbar (ADR 0145): at most one kind off the full set, or all of them. */
  pickFilter: PickFilter;
  /** Whether the graphics area shows the selection filter bar (ADR 0145); F5 toggles, the choice is kept in the options. */
  pickFilterBarVisible: boolean;
  /** What belongs to this browser and its user (D8.1). */
  options: SystemOptions;
  editing: EditSession | null;
  /** A sketch asked for on a plane the last rebuild has no frame for yet (a plane that was just made or moved): it starts when the frame comes (ADR 0127). */
  pendingSketch: Ref | null;
  result: RebuildPayload | null;
  /** Solve of the sketch being edited (or of the current drag frame). */
  sketchSolve: SketchSolvePayload | null;
  /** Dimension whose Modify box is open (D6.1). */
  dimensionEdit: Id | null;
  /** The picture of the sketch being edited whose scale is being set from two points of it (ADR 0116), and the points clicked so far (in the plane of the sketch). */
  pictureScale: { pictureId: Id; points: [number, number][] } | null;
  /** Feature whose 「確認刪除」 dialog is open (B2.8). */
  confirmDelete: Id | null;
  /** 「錯誤為何？」 dialog (D7.1). */
  whatsWrong: boolean;
  /** The equations or file-properties dialog (B5.2, B8.3), when open. */
  dialog: 'equations' | 'properties' | 'appearance' | 'stepOptions' | 'template' | 'shortcuts' | 'options' | 'bom' | 'physical' | 'viewOrientation' | null;
  /** The file the part was opened from or last saved to (F7.1); null for a part never saved. */
  fileName: string | null;
  /** The document differs from what was last opened or saved (the title shows 「*」). */
  dirty: boolean;
  /** A file action waiting for the answer to 「要儲存變更嗎？」. */
  unsaved: PendingFileAction | null;
  /** A copy of a part with unsaved changes, left by an earlier session (B9.3), waiting for 「復原」 or 「捨棄」. */
  recovery: { name: string; savedAt: number } | null;
  /** Bumped when a part replaces the current one: the viewport fits the next model it shows. */
  fitRequest: number;
  /** Name of a part never saved (「零件1」, 「零件2」 …, or the STEP file it was made from). */
  untitled: string;
  rebuilding: boolean;
  bootMs: { occtMs: number; gcsMs: number } | null;
  bootError: string | null;
  notice: Notice | null;
  /** 「關閉伺服器」 pressed (dev only, ADR 0135): the dev server, its process and the kernel worker are being ended; the page shows the shutdown screen and does nothing else. */
  shuttingDown: boolean;
  /** The open document: the part above, or the assembly in `asm`. */
  active: DocumentKind;
  /** The open assembly (null while a part is open). */
  asm: AssemblyState | null;
  /** The project folder assemblies read their parts from (B9.4); null until one is chosen. */
  projectName: string | null;
  /** Why the project folder is asked for: the dialog is open. */
  folderRequest: string | null;
  /** The folder asked for will be written into (F2.8): it is picked with write access, and the remembered one is not offered. */
  folderWrite: boolean;
  /** The project folder of an earlier session, offered in that dialog (B9.4). */
  rememberedProject: string | null;
  /** The assembly (or drawing, D-I7) a part was opened from with 「開啟零件」: 「返回組合件」／「返回工程圖」 reopens it, with the parts as they are then. */
  returnTo: { name: string; kind: 'assembly' | 'drawing' } | null;
  /** Bumped whenever another document is opened or created (the CommandManager then shows its main tab). */
  documentSerial: number;
  /** The measure tool (E1.1) while it is on: the elements picked and what is known of them. Null when it is off. */
  measure: MeasureState | null;
  /** How measuring is written (units, fractions, how round elements are measured); kept in this browser. */
  measureOptions: MeasureOptions;
  draft: DraftState | null;
  undercut: UndercutState | null;
  thickness: ThicknessState | null;
  /** The flat pattern of a sheet metal part (C11.3) while its window is open. Null when closed. */
  flat: FlatState | null;
  /** What a face picked in the view is while a shell is edited: one to take away (open), or one with a wall of its own (C5.4). */
  shellPick: 'open' | 'thickness';
  /** The group of faces a face picked in the view goes to while a face fillet or a full round fillet is edited. */
  filletPick: FilletGroup;
  /** The interference detection (E2.1) while its window is open. Null when closed. */
  interference: InterferenceState | null;
  /** The open drawing (Phase 5); null unless the open document is a drawing. */
  drw: DrawingState | null;
  /** The clearance verification (E2.2) while its window is open. Null when closed. */
  clearance: ClearanceState | null;
  /** The geometry check (E3.1) while its dialog is open. Null when closed. */
  check: CheckState | null;
}

/** One part checked: what it is called, and what the kernel found (null: it has no body, or is not built yet). */
export interface CheckRow {
  name: string;
  report: GeometryReport | null;
}

export interface CheckState {
  status: 'running' | 'done' | 'error';
  rows: CheckRow[];
  error: string | null;
}

/** Next free display name like SolidWorks does: 草圖3 after 草圖2 (names are labels, ids stay permanent). */
const LOCALE_KEY = 'locale';

/** The language chosen last time, else the default: the browser's language is not used until a translation exists. */
function storedLocale(): Locale {
  try {
    const saved = localStorage.getItem(LOCALE_KEY);
    return LOCALES.find((l) => l === saved) ?? DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

/** Immer only replaces what a command touched, so anything else being the same object means it did not change. */
function onlyVisibilityChanged(a: PartDoc, b: PartDoc): boolean {
  if (!(Object.keys(b) as (keyof PartDoc)[]).every((k) => k === 'visibility' || a[k] === b[k])) return false;
  // sketches and planes are drawn from what the rebuild gave; a body's visibility decides what the worker meshes
  return ![...new Set([...Object.keys(a.visibility), ...Object.keys(b.visibility)])].some((k) => isBodyKey(k) && a.visibility[k] !== b.visibility[k]);
}

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
  /** Bumped by `abandon`: an answer from an earlier generation (the worker that was replaced) is never used. */
  private generation = 0;

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

  /** Forgets the request in flight and the one waiting: the worker that was to answer is gone. */
  abandon(): void {
    this.generation += 1;
    this.busy = false;
    this.waiting = null;
  }

  private async go(req: Req): Promise<void> {
    const generation = this.generation;
    this.busy = true;
    try {
      const res = await this.run(req);
      if (generation === this.generation) this.done(res);
    } catch (e) {
      if (generation === this.generation) this.fail(e);
    }
    if (generation !== this.generation) return;
    this.busy = false;
    const next = this.waiting;
    this.waiting = null;
    if (next) void this.go(next);
  }
}

/** How long a rebuild may take before the worker is given up on (see `AppStore.run`). */
const REBUILD_LIMIT_MS = 60_000;
/** A rebuild that has run this long, with the document changed since, is given up on at once. */
const REBUILD_SUSPECT_MS = 15_000;

class StalledError extends Error {}

const MEASURE_OPTIONS_KEY = '3db-measure-options';

/** The way of writing measurements the user chose before, or the plain millimetres. */
function readMeasureOptions(): MeasureOptions {
  try {
    const raw = JSON.parse(localStorage.getItem(MEASURE_OPTIONS_KEY) ?? 'null') as Partial<MeasureOptions> | null;
    if (!raw) return DEFAULT_MEASURE_OPTIONS;
    const o = { ...DEFAULT_MEASURE_OPTIONS, ...raw };
    return {
      unit: o.unit === 'in' ? 'in' : 'mm',
      fraction: !!o.fraction,
      denominator: [2, 4, 8, 16, 32, 64, 128].includes(o.denominator) ? o.denominator : 16,
      nearest: !!o.nearest,
      angle: o.angle === 'rad' ? 'rad' : 'deg',
      round: o.round === 'min' || o.round === 'max' ? o.round : 'centre',
      frame: typeof o.frame === 'string' && o.frame !== '' ? o.frame : 'world',
    };
  } catch {
    return DEFAULT_MEASURE_OPTIONS;
  }
}

class AppStore {
  // Like SolidWorks the program starts on an empty part; the demo part is 「新示範件」 in the file menu.
  private history = new DocHistory(createEmptyPart());
  /** What the rest of the program calls: always the current worker, which is replaced when a rebuild stalls (`restartWorker`). */
  private api: Comlink.Remote<KernelApi>;
  private worker!: Worker;
  private remote!: Comlink.Remote<KernelApi>;
  /** Counts the workers started: an answer or a failure from an earlier one is ignored. */
  private workerGeneration = 0;
  /** When the rebuild in flight began. */
  private startedAt = 0;
  /** How long a rebuild may take before its worker is replaced (kept here so a test can shorten it). */
  rebuildLimitMs = REBUILD_LIMIT_MS;
  private listeners = new Set<() => void>();
  private seq = 0;
  private inFlight = false;
  private pending = false;
  private sketchSeq = 0;
  /** What the cursor can snap to on the model while a sketch is edited (D5.3b, C1 2026-10-14): edges in its plane, the others projected onto it, pierce points; empty outside a sketch. */
  private modelSnap: ModelItem[] = [];
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
  /** The project folder of an earlier session: used once the browser allows it again. */
  private remembered: FileSystemDirectoryHandle | null = null;
  /** 「開啟零件」: the part file to open (path in the project folder). */
  private partToOpen: string | null = null;
  /** The assembly file 「返回組合件」 reopens. */
  private returnFile: FileSystemFileHandle | null = null;
  /** The viewport registers itself so view actions (fit, standard views) can reach it. */
  viewer: Viewer | null = null;
  /** Tools of the sketch being edited (null outside sketch sessions). */
  sketcher: SketchController | null = null;

  constructor() {
    this.startWorker();
    void this.checkRecovery();
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && void this.autosave.flush());
    this.api = new Proxy({} as Comlink.Remote<KernelApi>, {
      // never `then` (the proxy is not a promise) and no symbols: only the methods of the worker's API
      get: (_target, name) => (typeof name === 'symbol' || name === 'then' ? undefined : (...args: unknown[]) => (this.remote as unknown as Record<string, (...a: unknown[]) => unknown>)[name]!(...args)),
    });
    this.savedText = serializePart(this.history.doc);
    this.state = {
      doc: this.history.doc,
      canUndo: false,
      canRedo: false,
      selected: null,
      selectedFace: null,
      selectedElements: [],
      selectionFacts: null,
      bodyPool: [],
      pickFilter: { ...loadOptions().pickFilter },
      pickFilterBarVisible: loadOptions().pickFilterBar,
      options: loadOptions(),
      editing: null,
      pendingSketch: null,
      result: null,
      sketchSolve: null,
      dimensionEdit: null,
      pictureScale: null,
      confirmDelete: null,
      whatsWrong: false,
      dialog: null,
      fileName: null,
      dirty: false,
      unsaved: null,
      recovery: null,
      fitRequest: 0,
      untitled: t('doc.untitledPart', { n: 1 }),
      rebuilding: false,
      bootMs: null,
      bootError: null,
      notice: null,
      shuttingDown: false,
      active: 'part',
      asm: null,
      drw: null,
      projectName: null,
      folderRequest: null,
      folderWrite: false,
      rememberedProject: null,
      returnTo: null,
      documentSerial: 0,
      measure: null,
      measureOptions: readMeasureOptions(),
      interference: null,
      clearance: null,
      shellPick: 'open',
      filletPick: 'faces',
      thickness: null,
      flat: null,
      undercut: null,
      draft: null,
      check: null,
    };
    this.sketchRunner = new LatestRunner(
      (req) => this.api.solveSketch(req),
      (res) => {
        if (this.state.editing?.kind !== 'sketch') return;
        // Drag frames are not analyzed: keep the last per-entity colours until the next analysis.
        const prev = this.state.sketchSolve;
        this.set({ sketchSolve: res.entityStatus || !prev?.entityStatus ? res : { ...res, entityStatus: prev.entityStatus } });
      },
      (e) => this.set({ notice: { kind: 'error', text: t('sketch.solveFailed', { why: e instanceof Error ? e.message : String(e) }) } }),
    );
    this.history.subscribe(() => this.onDocChanged());
    this.lastDoc = this.history.doc;
    this.applyOptions(this.state.options);
    const locale = storedLocale();
    setLocale(locale);
    this.boot(locale);
    this.requestRebuild();
    // Closing the tab with unsaved changes asks first, like closing a modified document (risk 11: lost work).
    window.addEventListener('beforeunload', (e) => {
      if (this.activeDirty()) e.preventDefault();
    });
    // Back in this window: part files saved meanwhile (in another window) show as they are now (B9.4).
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        void this.assembly?.refresh();
        void this.drawing?.refresh();
      }
    });
    window.addEventListener('focus', () => {
      void this.assembly?.refresh();
      void this.drawing?.refresh();
    });
    void rememberedFolder().then((folder) => {
      if (!folder || this.project) return;
      this.remembered = folder;
      this.set({ rememberedProject: folder.name });
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
    // what is measured follows the model: a part rebuilt, or components placed anew, are measured again
    if ((this.state.measure?.picks.length || this.state.measure?.saved.length) && ('result' in patch || 'asm' in patch)) void this.runMeasure();
    // what the picked elements are (E1 §2.2): the selection, or a rebuild of the model, is asked about again
    if ('selectedFace' in patch || 'selectedElements' in patch || 'result' in patch) void this.runSelectionFacts();
    // the draft analysis follows the model too
    if (this.state.draft && 'result' in patch) void this.runDraft();
    if (this.state.undercut && 'result' in patch) void this.runUndercut();
    if (this.state.thickness && 'result' in patch) void this.runThickness();
    if (this.state.flat && 'result' in patch) void this.runFlat();
  }

  private draftSeq = 0;

  /** 「拔模分析」 (E3.2) on: along +z to start with (the way a part grows from the front plane), 1° required; it is worked out for the part as shown. */
  startDraft(): void {
    this.undercutSeq++;
    this.thicknessSeq++;
    this.set({ undercut: null, thickness: null, draft: { pull: [0, 0, 1], label: '+z', required: '1', status: 'running', report: null, error: null } });
    void this.runDraft();
  }

  stopDraft(): void {
    this.draftSeq++;
    if (this.state.draft) this.set({ draft: null });
  }

  setDraftPull(pull: Vec3, label: string): void {
    if (!this.state.draft) return;
    this.set({ draft: { ...this.state.draft, pull, label, report: null } });
    void this.runDraft();
  }

  setDraftRequired(required: string): void {
    if (!this.state.draft) return;
    this.set({ draft: { ...this.state.draft, required } });
    void this.runDraft();
  }

  private async runDraft(): Promise<void> {
    const d = this.state.draft;
    if (!d) return;
    const required = Number(d.required);
    if (d.required.trim() === '' || !Number.isFinite(required) || required < 0) return;
    const seq = ++this.draftSeq;
    try {
      const report = await this.api.analyzeDraft(d.pull, (required * Math.PI) / 180);
      if (seq === this.draftSeq && this.state.draft) this.set({ draft: { ...this.state.draft, status: 'done', report, error: null } });
    } catch (e) {
      if (seq === this.draftSeq && this.state.draft) this.set({ draft: { ...this.state.draft, status: 'error', report: null, error: t('draftAnalysis.failed', { why: e instanceof Error ? e.message : String(e) }) } });
    }
  }

  private undercutSeq = 0;

  /** 「底切分析」 (E3.3) on: along the pull of the draft analysis if that was open (else +z); it closes the draft analysis, which colors the same faces. */
  startUndercut(): void {
    const from = this.state.draft;
    this.draftSeq++;
    this.thicknessSeq++;
    this.set({ draft: null, thickness: null, undercut: { pull: from?.pull ?? [0, 0, 1], label: from?.label ?? '+z', status: 'running', report: null, error: null } });
    void this.runUndercut();
  }

  stopUndercut(): void {
    this.undercutSeq++;
    if (this.state.undercut) this.set({ undercut: null });
  }

  setUndercutPull(pull: Vec3, label: string): void {
    if (!this.state.undercut) return;
    this.set({ undercut: { ...this.state.undercut, pull, label, report: null } });
    void this.runUndercut();
  }

  private async runUndercut(): Promise<void> {
    const u = this.state.undercut;
    if (!u) return;
    const seq = ++this.undercutSeq;
    try {
      const report = await this.api.analyzeUndercut(u.pull);
      if (seq === this.undercutSeq && this.state.undercut) this.set({ undercut: { ...this.state.undercut, status: 'done', report, error: null } });
    } catch (e) {
      if (seq === this.undercutSeq && this.state.undercut) this.set({ undercut: { ...this.state.undercut, status: 'error', report: null, error: t('undercutAnalysis.failed', { why: e instanceof Error ? e.message : String(e) }) } });
    }
  }

  private thicknessSeq = 0;

  /** 「厚度分析」 (E3.5) on: at least 1 and at most 4 mm to start with (a wall of a plastic part); it closes the draft and undercut analyses, which color the same faces. */
  startThickness(): void {
    this.draftSeq++;
    this.undercutSeq++;
    this.set({ draft: null, undercut: null, thickness: { least: '1', greatest: '4', status: 'running', report: null, error: null } });
    void this.runThickness();
  }

  stopThickness(): void {
    this.thicknessSeq++;
    if (this.state.thickness) this.set({ thickness: null });
  }

  setThicknessLimits(least: string, greatest: string): void {
    if (!this.state.thickness) return;
    this.set({ thickness: { ...this.state.thickness, least, greatest } });
    void this.runThickness();
  }

  private async runThickness(): Promise<void> {
    const th = this.state.thickness;
    if (!th) return;
    const limits = thicknessLimits(th.least, th.greatest);
    if (!limits) return;
    const seq = ++this.thicknessSeq;
    try {
      const report = await this.api.analyzeThickness(limits);
      if (seq === this.thicknessSeq && this.state.thickness) this.set({ thickness: { ...this.state.thickness, status: 'done', report, error: null } });
    } catch (e) {
      if (seq === this.thicknessSeq && this.state.thickness) this.set({ thickness: { ...this.state.thickness, status: 'error', report: null, error: t('thicknessAnalysis.failed', { why: e instanceof Error ? e.message : String(e) }) } });
    }
  }

  /** 「輸出 DXF」 of the flat pattern window (C11.3): the pattern as a DXF (the outline, the bend lines on their own layer, notes), handed to the browser as a download. */
  exportFlatDxf(): void {
    const report = this.state.flat?.report;
    if (!report) return;
    try {
      const file = `${this.documentName()}-flat.dxf`;
      download(file, flatPatternDxf(report), 'application/dxf');
      this.notify(t('export.done', { file }));
    } catch (e) {
      this.notify(t('export.failed', { what: 'DXF', why: e instanceof Error ? e.message : String(e) }), 'error');
    }
  }

  private flatSeq = 0;

  /** 「平板型式」 (C11.3) on: the pattern of the sheet metal part as it is shown, in a window; it is worked out again when the model changes. Nothing of it is saved. */
  startFlat(): void {
    this.set({ flat: { status: 'running', report: null, error: null, limits: { radius: '1', flange: '4', hole: '2' }, checks: [], mesh: null, show3d: false } });
    void this.runFlat();
  }

  stopFlat(): void {
    this.flatSeq++;
    if (this.state.flat) this.set({ flat: null });
  }

  /** Shows the flat pattern in the 3D view in the place of the folded part (nothing can be picked while it is shown), or the part again. */
  setFlat3d(on: boolean): void {
    if (this.state.flat) this.set({ flat: { ...this.state.flat, show3d: on && !!this.state.flat.mesh } });
  }

  /** The limits of the manufacturability checks typed in the flat pattern window. */
  setFlatLimits(limits: { radius: string; flange: string; hole: string }): void {
    if (!this.state.flat) return;
    this.set({ flat: { ...this.state.flat, limits } });
    void this.runFlat();
  }

  private async runFlat(): Promise<void> {
    const flat = this.state.flat;
    if (!flat) return;
    const seq = ++this.flatSeq;
    const ratio = (v: string) => (Number.isFinite(Number(v)) && v.trim() !== '' && Number(v) >= 0 ? Number(v) : null);
    const limits = { radius: ratio(flat.limits.radius), flange: ratio(flat.limits.flange), hole: ratio(flat.limits.hole) };
    const done = (patch: Partial<FlatState>) => {
      if (seq === this.flatSeq && this.state.flat) this.set({ flat: { ...this.state.flat, ...patch } });
    };
    // limits that are not numbers keep the checks of the last ones
    const asked = limits.radius === null || limits.flange === null || limits.hole === null ? { radius: 1, flange: 4, hole: 2 } : { radius: limits.radius, flange: limits.flange, hole: limits.hole };
    try {
      const { report, mesh, error, checks } = await this.api.flatPattern(asked);
      const keep = asked.radius === limits.radius && asked.flange === limits.flange && asked.hole === limits.hole;
      done(report ? { status: 'done', report, mesh, error: null, checks: keep ? checks : (this.state.flat?.checks ?? checks) } : { status: 'error', report: null, mesh: null, show3d: false, error: t('flat.failed', { why: error ?? '' }), checks: keep ? checks : (this.state.flat?.checks ?? checks) });
    } catch (e) {
      done({ status: 'error', report: null, mesh: null, show3d: false, error: t('flat.failed', { why: e instanceof Error ? e.message : String(e) }), checks: [] });
    }
  }

  private measureSeq = 0;

  /** Changes how measuring is written (units, fractions, the way round elements are measured); the choice is kept in this browser. */
  setMeasureOptions(patch: Partial<MeasureOptions>): void {
    const measureOptions = { ...this.state.measureOptions, ...patch };
    try {
      localStorage.setItem(MEASURE_OPTIONS_KEY, JSON.stringify(measureOptions));
    } catch {
      // storage is not there (a private window): the choice holds until the page is closed
    }
    this.set({ measureOptions });
  }

  /** 「測量」 on: the elements of the part or assembly are picked in the view (E1.1). */
  startMeasure(): void {
    this.set({ measure: { ...emptyMeasure(), saved: this.retainedMeasures } });
  }

  stopMeasure(): void {
    this.measureSeq++;
    if (this.state.measure) {
      this.retainedMeasures = this.state.measure.saved;
      this.set({ measure: null });
    }
  }

  clearMeasure(): void {
    this.measureSeq++;
    if (this.state.measure) this.set({ measure: emptyMeasure(this.state.measure) });
  }

  /** Takes away what was kept as well. */
  clearAllMeasures(): void {
    this.measureSeq++;
    this.retainedMeasures = [];
    if (this.state.measure) this.set({ measure: { ...emptyMeasure(this.state.measure), saved: [] } });
  }

  /** What a click takes: an element, or a place. */
  setMeasureMode(mode: MeasureState['mode']): void {
    if (this.state.measure) this.set({ measure: { ...this.state.measure, mode } });
  }

  private savedSeq = 0;
  /** Kept while the measurement tool is closed, for this open document only. */
  private retainedMeasures: SavedMeasure[] = [];

  /** Keeps the measurement in hand with the others (and starts a new one). */
  saveMeasure(): void {
    const m = this.state.measure;
    if (!m?.report?.distance) return;
    this.measureSeq++;
    const kept: SavedMeasure = { id: `m${++this.savedSeq}`, picks: m.picks, report: m.report, offsets: m.offsets };
    this.retainedMeasures = [...m.saved, kept];
    this.set({ measure: { ...emptyMeasure(m), saved: this.retainedMeasures } });
  }

  removeSavedMeasure(id: string): void {
    const m = this.state.measure;
    if (m) {
      this.retainedMeasures = m.saved.filter((x) => x.id !== id);
      this.set({ measure: { ...m, saved: this.retainedMeasures } });
    }
  }

  /** A label of a measurement was moved by the pointer, by `by` pixels more: the measurement it belongs to (a kept one by the id before the colon of its key) remembers. */
  moveMeasureLabel(key: string, by: [number, number]): void {
    const m = this.state.measure;
    if (!m) return;
    const add = (o: Record<string, [number, number]>) => ({ ...o, [key]: [(o[key]?.[0] ?? 0) + by[0], (o[key]?.[1] ?? 0) + by[1]] as [number, number] });
    const owner = m.saved.find((x) => key.startsWith(`${x.id}:`));
    if (owner) {
      this.retainedMeasures = m.saved.map((x) => (x === owner ? { ...x, offsets: add(x.offsets) } : x));
      this.set({ measure: { ...m, saved: this.retainedMeasures } });
    } else this.set({ measure: { ...m, offsets: add(m.offsets) } });
  }

  /** An element was clicked while measuring: a second one is measured to the first, a third starts again, the same one again takes it off. */
  measurePick(kind: MeasureKind, index: number, leaf: string | null): void {
    const m = this.state.measure;
    if (!m) return;
    const word = `${t(`measure.kind.${kind}`)} ${index + 1}`;
    const found = leaf === null ? undefined : this.assembly?.leaves().find((l) => l.id === leaf);
    if (leaf !== null && !found) return;
    const pick: MeasurePick = { leaf, kind, index, label: found ? `${this.assembly!.ownerLabel(found.top, found.path)}: ${word}` : word };
    const same = (p: MeasurePick) => p.leaf === leaf && p.kind === kind && p.index === index;
    const picks = m.picks.some(same) ? m.picks.filter((p) => !same(p)) : m.picks.length >= 2 ? [pick] : [...m.picks, pick];
    this.measureSeq++;
    this.set({ measure: { ...m, picks, report: null, error: null, offsets: {} } });
    void this.runMeasure();
  }

  /** A place was clicked while measuring in the way of places (an end, a middle, a centre, a place of an edge or a face): measured like an element. */
  measurePickPlace(snap: Snap): void {
    const m = this.state.measure;
    if (!m) return;
    const found = snap.instance === null ? undefined : this.assembly?.leaves().find((l) => l.id === snap.instance);
    if (snap.instance !== null && !found) return;
    const word = t(`measure.snap.${snap.kind}`);
    const geometry = snap.instance === null ? this.state.result : found && !found.mirrored ? this.assembly?.buildOfLeaf(found) : null;
    const anchor = snap.kind === 'vertex' && geometry ? captureVertexAnchor(geometry.vertexNames, geometry.vertexPoints, snap.local) : null;
    const pick: MeasurePick = { leaf: snap.instance, kind: 'vertex', index: -1, point: snap.local, ...(anchor ? { anchor: { kind: 'vertex' as const, name: anchor.name } } : {}), label: found ? `${this.assembly!.ownerLabel(found.top, found.path)}: ${word}` : word };
    const picks = m.picks.length >= 2 ? [pick] : [...m.picks, pick];
    this.measureSeq++;
    this.set({ measure: { ...m, picks, report: null, error: null, offsets: {} } });
    void this.runMeasure();
  }

  private checkSeq = 0;

  stopCheck(): void {
    this.checkSeq++;
    if (this.state.check) this.set({ check: null });
  }

  /** 「檢查幾何」 (E3.1): checks the open part, or every part file of the open assembly (each once), and shows what the kernel found. */
  async startCheck(): Promise<void> {
    const seq = ++this.checkSeq;
    const a = this.state.active === 'assembly' ? this.assembly : null;
    // an assembly: each part file once (a copy made by a pattern or mirror is the same shape as its seed's)
    const entries = a
      ? [...new Map(a.leaves().filter((l) => !l.instanceOf).map((l) => [l.key, bomName(l.file ?? l.key)] as const)).entries()]
      : [[null, this.state.fileName ?? this.state.untitled] as const];
    this.set({ check: { status: 'running', rows: entries.map(([, name]) => ({ name, report: null })), error: null } });
    try {
      const reports = await this.api.checkGeometry(entries.map(([key]) => key));
      if (seq === this.checkSeq) this.set({ check: { status: 'done', rows: entries.map(([, name], i) => ({ name, report: reports[i] ?? null })), error: null } });
    } catch (e) {
      if (seq === this.checkSeq) this.set({ check: { status: 'error', rows: [], error: t('check.failed', { why: e instanceof Error ? e.message : String(e) }) } });
    }
  }

  private clearanceSeq = 0;

  /** 「餘隙確認」 (E2.2): opens its window with the least clearance of 1 mm, and checks the assembly as it is now. */
  startClearance(): void {
    const idle: ClearanceState = { status: 'idle', least: '1', pairs: [], selected: null, unknown: [], failed: [], checked: 0, ms: 0, tooFew: false, error: null, doc: undefined, solution: undefined, sweep: { dir: '+z', length: '100', status: 'idle', text: null, blocked: false } };
    this.set({ clearance: this.state.clearance ?? idle });
    void this.runClearance();
  }

  stopClearance(): void {
    this.clearanceSeq++;
    if (this.state.clearance) this.set({ clearance: null });
  }

  selectClearance(index: number | null): void {
    if (this.state.clearance) this.set({ clearance: { ...this.state.clearance, selected: index } });
  }

  setClearanceLeast(least: string): void {
    if (this.state.clearance) this.set({ clearance: { ...this.state.clearance, least } });
  }

  setSweep(patch: Partial<Pick<ClearanceState['sweep'], 'dir' | 'length'>>): void {
    const c = this.state.clearance;
    if (c) this.set({ clearance: { ...c, sweep: { ...c.sweep, ...patch, status: 'idle', text: null, blocked: false } } });
  }

  async runClearance(): Promise<void> {
    const a = this.assembly;
    const open = this.state.clearance;
    if (!a || !open) return;
    const least = Number(open.least);
    const input = a.interferenceInput();
    const seq = ++this.clearanceSeq;
    const base: ClearanceState = { ...open, status: 'running', pairs: [], selected: null, unknown: [], failed: [], checked: 0, ms: 0, tooFew: input.components.length < 2, error: null, doc: this.state.asm?.doc, solution: this.state.asm?.solution };
    if (!(least > 0) || !Number.isFinite(least)) return void this.set({ clearance: { ...base, status: 'error', error: t('clearance.error', { why: t('clearance.sweepBadLength') }) } });
    if (base.tooFew) return void this.set({ clearance: { ...base, status: 'done' } });
    this.set({ clearance: base });
    try {
      const r = await this.api.clearance(input.components, least);
      if (seq !== this.clearanceSeq || !this.state.clearance) return;
      const nameOf = (id: string) => input.names.get(id) ?? id;
      this.set({
        clearance: {
          ...this.state.clearance,
          ...base,
          sweep: this.state.clearance.sweep,
          status: 'done',
          pairs: r.rows.map((row) => ({ a: row.a, b: row.b, aName: nameOf(row.a), bName: nameOf(row.b), aTop: input.tops.get(row.a) ?? row.a, bTop: input.tops.get(row.b) ?? row.b, distance: row.distance, interferes: row.interferes, at: row.pointA })),
          unknown: r.unknown.map(nameOf),
          failed: r.failed.map((f) => `${nameOf(f.a)} × ${nameOf(f.b)}`),
          checked: r.checked,
          ms: Math.round(r.ms),
        },
      });
    } catch (e) {
      if (seq === this.clearanceSeq && this.state.clearance) this.set({ clearance: { ...base, sweep: this.state.clearance.sweep, status: 'error', error: t('clearance.error', { why: e instanceof Error ? e.message : String(e) }) } });
    }
  }

  /** Room to take the selected component out (E2.2): how far it moves along the direction before it meets another component. */
  async runSweep(): Promise<void> {
    const a = this.assembly;
    const c = this.state.clearance;
    if (!a || !c) return;
    const asm = this.state.asm;
    const mover = asm?.selected && asm.doc.components.some((x) => x.id === asm.selected) ? asm.selected : null;
    const say = (patch: Partial<ClearanceState['sweep']>): void => {
      if (this.state.clearance) this.set({ clearance: { ...this.state.clearance, sweep: { ...this.state.clearance.sweep, ...patch } } });
    };
    if (!mover) return say({ status: 'error', text: t('clearance.sweepNone'), blocked: false });
    const length = Number(c.sweep.length);
    if (!(length > 0) || !Number.isFinite(length)) return say({ status: 'error', text: t('clearance.sweepBadLength'), blocked: false });
    const dir: Vec3 = [c.sweep.dir.endsWith('x') ? 1 : 0, c.sweep.dir.endsWith('y') ? 1 : 0, c.sweep.dir.endsWith('z') ? 1 : 0].map((v) => (c.sweep.dir.startsWith('-') ? -v : v)) as Vec3;
    const input = a.interferenceInput();
    const name = input.names.get(mover) ?? mover;
    say({ status: 'running', text: t('clearance.sweepRunning'), blocked: false });
    try {
      const r = await this.api.sweep(input.components, mover, dir, length);
      const shown = String(Math.round(r.travel * 1000) / 1000 + 0);
      const blocker = r.blocker ? (input.names.get(r.blocker) ?? r.blocker) : '';
      const text = r.startsInside ? t('clearance.sweepInside', { name, blocker }) : r.blocker ? t('clearance.sweepBlocked', { name, dir: c.sweep.dir.toUpperCase(), travel: shown, blocker }) : t('clearance.sweepFree', { name, dir: c.sweep.dir.toUpperCase(), length: shown });
      say({ status: 'done', text: r.approximate ? `${text} ${t('clearance.sweepApprox', { travel: shown })}` : text, blocked: !!r.blocker });
    } catch (e) {
      say({ status: 'error', text: t('clearance.sweepError', { why: e instanceof Error ? e.message : String(e) }), blocked: false });
    }
  }

  private interferenceSeq = 0;

  /** 「干涉檢查」 (E2.1): opens its window and checks the assembly as it is now. */
  startInterference(): void {
    void this.runInterference(false);
  }

  /** Whether the next check also compares the parts inside sub-assemblies with each other; checks again at once. */
  setInterferenceWithin(within: boolean): void {
    void this.runInterference(within);
  }

  stopInterference(): void {
    this.interferenceSeq++;
    if (this.state.interference) this.set({ interference: null });
  }

  /** One pair alone in the view, or (null) all of them. */
  selectInterference(index: number | null): void {
    if (this.state.interference) this.set({ interference: { ...this.state.interference, selected: index } });
  }

  async runInterference(within: boolean = this.state.interference?.within ?? false): Promise<void> {
    const a = this.assembly;
    if (!a) return;
    const input = a.interferenceInput(undefined, within);
    const seq = ++this.interferenceSeq;
    const base = { status: 'running' as const, pairs: [], selected: null, unknown: [], failed: [], checked: 0, ms: 0, tooFew: input.components.length < 2, error: null, within, doc: this.state.asm?.doc, solution: this.state.asm?.solution };
    if (base.tooFew) return void this.set({ interference: { ...base, status: 'done' } });
    this.set({ interference: base });
    try {
      const r = await this.api.interference(input.components);
      if (seq !== this.interferenceSeq) return;
      const pairs = new Map<string, InterferencePair>();
      for (const o of r.overlaps) {
        const key = `${o.a}|${o.b}`;
        const pair = pairs.get(key) ?? { a: o.a, b: o.b, aName: input.names.get(o.a) ?? o.a, bName: input.names.get(o.b) ?? o.b, aTop: input.tops.get(o.a) ?? o.a, bTop: input.tops.get(o.b) ?? o.b, volume: 0, overlaps: [] };
        pair.volume += o.volume;
        pair.overlaps.push(o.mesh);
        pairs.set(key, pair);
      }
      const nameOf = (id: string) => input.names.get(id) ?? id;
      this.set({
        interference: {
          ...base,
          status: 'done',
          pairs: [...pairs.values()].sort((x, y) => y.volume - x.volume),
          unknown: r.unknown.map(nameOf),
          failed: r.failed.map((f) => `${nameOf(f.a)} × ${nameOf(f.b)}`),
          checked: r.checked,
          ms: Math.round(r.ms),
        },
      });
    } catch (e) {
      if (seq === this.interferenceSeq) this.set({ interference: { ...base, status: 'error', error: t('interference.error', { why: e instanceof Error ? e.message : String(e) }) } });
    }
  }

  /** The picks as the kernel is asked about them: a part by its file and the pose it is at now. Null when the component is gone. */
  private measureTarget(p: MeasurePick): MeasureTarget | null {
    if (p.anchor) {
      const leaf = p.leaf === null ? null : this.assembly?.leaves().find((l) => l.id === p.leaf);
      if (p.leaf !== null && !leaf) return null;
      if (leaf?.mirrored) return null;
      const geometry = leaf ? this.assembly?.buildOfLeaf(leaf) : this.state.result;
      const point = geometry && resolveVertexAnchor(geometry.vertexNames, geometry.vertexPoints, p.anchor.name);
      if (!geometry || !point) return null;
      const index = geometry.vertexNames.indexOf(p.anchor.name);
      return { part: leaf ? leaf.key : null, mirrored: false, pose: leaf?.pose ?? null, kind: 'vertex', index };
    }
    const place = p.point ? { point: p.point } : {};
    if (p.leaf === null) return { part: null, mirrored: false, pose: null, kind: p.kind, index: p.index, ...place };
    const leaf = this.assembly?.leaves().find((l) => l.id === p.leaf);
    if (!leaf) return null;
    return { part: leaf.mirrored ? leaf.key.slice(0, -mirrorKey('').length) : leaf.key, mirrored: !!leaf.mirrored, pose: leaf.pose, kind: p.kind, index: p.index, ...place };
  }

  private async runMeasure(): Promise<void> {
    const m = this.state.measure;
    if (!m) return;
    const seq = ++this.measureSeq;
    // the ones that were kept follow the model too: measured again where the parts are now (one that cannot be, its part gone, keeps what it said)
    if (m.saved.length > 0) {
      const again = await Promise.all(
        m.saved.map(async (x) => {
          const targets = x.picks.map((p) => this.measureTarget(p));
          if (targets.some((y) => y === null)) return { ...x, report: x.picks.some((p) => p.anchor) ? null : x.report, anchorLost: x.picks.some((p) => p.anchor) };
          try {
            return { ...x, report: await this.api.measure(targets as MeasureTarget[]), anchorLost: false };
          } catch {
            return x;
          }
        }),
      );
      if (seq === this.measureSeq && this.state.measure) {
        this.retainedMeasures = this.state.measure.saved.map((x) => again.find((y) => y.id === x.id) ?? x);
        this.set({ measure: { ...this.state.measure, saved: this.retainedMeasures } });
      }
    }
    if (m.picks.length === 0) return;
    const targets = m.picks.map((p) => this.measureTarget(p));
    if (targets.some((x) => x === null)) {
      if (m.picks.some((p) => p.anchor)) {
        if (seq === this.measureSeq && this.state.measure) this.set({ measure: { ...this.state.measure, report: null, error: t('measure.anchorMissing') } });
        return;
      }
      return void this.set({ measure: emptyMeasure(this.state.measure) });
    }
    try {
      const report = await this.api.measure(targets as MeasureTarget[]);
      if (seq === this.measureSeq && this.state.measure) this.set({ measure: { ...this.state.measure, report, error: null } });
    } catch (e) {
      if (seq === this.measureSeq && this.state.measure) this.set({ measure: { ...this.state.measure, report: null, error: t('measure.failed', { why: e instanceof Error ? e.message : String(e) }) } });
    }
  }

  /** The template the next 「新零件」 is made from (B1.4). */
  private template: PartTemplateId = 'blank';

  /**
   * What the picked elements are (E1 §2.2): the face, or the edges and vertices, asked of the kernel the way the 「測量」 tool asks it — the open part,
   * measured as it is. The answer is kept against the pick it belongs to (`pickKey`), so a late one for an older pick is dropped, and the whole thing
   * follows the model: a rebuild re-asks, and an element the new model no longer has is named back instead of being answered for by another element.
   * A tree item is not measured (its properties are its own parameters), and nothing is asked while an assembly is open.
   */
  private async runSelectionFacts(): Promise<void> {
    const { selectedFace, selectedElements, result } = this.state;
    const refs = selectedFace ? [selectedFace] : selectedElements;
    const key = pickKey(selectedFace, selectedElements);
    if (this.assembly || !result || refs.length === 0) return void this.set({ selectionFacts: null });
    const seq = ++this.selectionFactsSeq;
    const { targets, unresolved, keys } = measureTargetsOf(refs, result);
    if (targets.length === 0) {
      this.set({ selectionFacts: { key, keys, elements: [], unresolved, error: null } });
      return;
    }
    try {
      const report = await this.api.measure(targets);
      if (seq === this.selectionFactsSeq) this.set({ selectionFacts: { key, keys, elements: report.elements, unresolved, error: null } });
    } catch (e) {
      if (seq === this.selectionFactsSeq) this.set({ selectionFacts: { key, keys, elements: [], unresolved, error: e instanceof Error ? e.message : String(e) } });
    }
  }

  private selectionFactsSeq = 0;

  /** 「系統選項」 (D8.1): changes some of the options, keeps them in the browser and puts them to work. */
  setOptions(patch: Partial<SystemOptions>): void {
    const options = parseOptions({ ...this.state.options, ...patch });
    saveOptions(options);
    // 「選項」的「開始時可以點選的元素」是下一份零件的起手，不是這一頁的開關：改它不動 live 的 `pickFilter`（眼下的開關是 `setPickFilter`，
    // 圖形區那個「選擇濾器」）。把這裡接到 live 會讓「按「新零件」不該改已開頁面的濾器」失真 —— 驗它的是 manual-c22。
    this.set({ options });
    this.applyOptions(options);
  }

  private applyOptions(options: SystemOptions): void {
    this.autosave.enabled = options.autosave;
    this.autosave.delayMs = options.autosaveSeconds * 1000;
    if (!options.autosave) this.autosave.cancel();
  }

  /** 「新零件（範本）」: the part is made from the template, after 「要儲存變更嗎？」 if the open one has changes. */
  newPartFromTemplate(id: PartTemplateId): void {
    this.set({ dialog: null });
    this.template = id;
    this.guard('new-part');
  }

  /** The part the last rebuild was requested for: a change that only touches what is shown needs no new rebuild. */
  private lastDoc: PartDoc | null = null;

  // ------------------------------------------------------------ autosave and recovery (B9.3)

  /** The copy of a part with unsaved changes, kept in the browser. */
  private autosave = new Autosaver(
    { put: keepRecovery, get: recoveryCopy, clear: dropRecovery },
    async () => (this.assembly ? null : { bytes: await writePartFile(this.history.doc, this.blobs), fileName: this.state.fileName, untitled: this.state.untitled }),
  );
  /** What an earlier session left, until the user answers. */
  private recoveryCopy: Recovery | null = null;

  private async checkRecovery(): Promise<void> {
    const copy = await recoveryCopy();
    if (!copy) return;
    this.recoveryCopy = copy;
    this.set({ recovery: { name: copy.fileName ?? copy.untitled, savedAt: copy.savedAt } });
  }

  /** 「復原」: the part of the copy opens as an unsaved part (its first save asks for a name), with its changes. */
  async restoreRecovery(): Promise<void> {
    const copy = this.recoveryCopy;
    if (!copy) return;
    this.recoveryCopy = null;
    try {
      const file = await readDocumentFile(copy.bytes);
      if (file.kind !== 'part') throw new Error('not a part');
      this.load(file.doc, null, copy.fileName, file.blobs, copy.untitled); // (the copy in the browser stays until a newer one replaces it)
      this.set({ recovery: null });
      this.savedText = ''; // it differs from every file: the title shows 「*」 and the next change keeps a copy again
      this.set({ dirty: true });
      this.autosave.changed(true);
      this.notify(t('recovery.restored', { name: copy.fileName ?? copy.untitled }));
    } catch (e) {
      this.set({ recovery: null });
      this.notify(t('recovery.failed', { why: e instanceof Error ? e.message : String(e) }), 'error');
      void this.autosave.clear();
    }
  }

  /** 「捨棄」: the copy is thrown away. */
  discardRecovery(): void {
    this.recoveryCopy = null;
    this.set({ recovery: null });
    void this.autosave.clear();
  }

  private onDocChanged(): void {
    const doc = this.history.doc;
    const prev = this.lastDoc;
    this.lastDoc = doc;
    const dirty = serializePart(doc) !== this.savedText;
    this.set({ doc, canUndo: this.history.canUndo, canRedo: this.history.canRedo, dirty });
    // a copy is kept only while the answer to the recovery dialog is not still being waited for
    if (!this.state.recovery) this.autosave.changed(dirty);
    // Inside a sketch only the sketch changes: solve it, and leave the model before it as it is.
    if (this.state.editing?.kind === 'sketch') this.requestSketchSolve();
    else if (!(prev && onlyVisibilityChanged(prev, doc))) this.requestRebuild();
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
    if (this.drawing) return this.drawing.undo();
    if (this.assembly) return this.assembly.undo();
    this.history.undo();
  }

  redo(): void {
    if (this.drawing) return this.drawing.redo();
    if (this.assembly) return this.assembly.redo();
    this.history.redo();
  }

  /** One selection at a time: a tree item or a face (a face selection clears the tree item and vice versa). */
  select(id: Id | null): void {
    this.set({ selected: id, selectedFace: null, selectedElements: [] });
  }

  selectFace(face: Ref | null): void {
    const e = this.state.editing;
    if (e && e.kind === 'sketchPlane' && face) {
      this.execute({ type: 'redefineSketchPlane', featureId: e.featureId, plane: face });
      this.set({ selectedFace: face, selected: null, selectedElements: [] });
      return;
    }
    this.set({ selectedFace: face, selected: null, selectedElements: [] });
  }

  /**
   * An edge or a vertex clicked while nothing is edited (ADR 0117): it is the selection (and the face and the tree item are not); with Ctrl or Shift it is ticked in or out of what is
   * selected. A click on nothing (`null`) lets go of them. They are what the next fillet, chamfer, surface or flange command starts with.
   */
  selectElement(ref: Ref | null, additive: boolean): void {
    if (!ref) return void this.set({ selectedElements: [] });
    const same = (a: Ref, b: Ref) => a.kind === b.kind && a.name === b.name;
    const cur = this.state.selectedElements;
    const next = additive ? (cur.some((x) => same(x, ref)) ? cur.filter((x) => !same(x, ref)) : [...cur, ref]) : [ref];
    this.set({ selectedElements: next, selectedFace: null, selected: null });
  }

  /** The edges selected before a command was started, for it to begin with. */
  private preselectedEdges(): Ref[] {
    return this.state.selectedElements.filter((r) => r.kind === 'edge');
  }

  /**
   * A kind chosen on the selection filter bar (ADR 0145): radio, as the SW toolbar — it becomes the only kind on. Choosing the kind that is already the only
   * one on is a no-op (the SW button stays pressed). 「全部」/F6 goes through clearPickFilter.
   */
  setPickFilterKind(kind: keyof PickFilter): void {
    const cur = this.state.pickFilter;
    const alone = Object.entries(cur).every(([k, v]) => (k === kind ? v : !v));
    if (alone) return;
    this.set({ pickFilter: { faces: false, edges: false, vertices: false, planes: false, [kind]: true } });
  }

  /** F6, as the SW「清除所有濾器」(ADR 0145): every kind is pickable again. */
  clearPickFilter(): void {
    this.set({ pickFilter: { faces: true, edges: true, vertices: true, planes: true } });
  }

  /** F5, as the SW toggle of the Selection Filter toolbar (ADR 0145): shows or hides the bar; kept in the options like a toolbar state. */
  togglePickFilterBar(): void {
    const next = !this.state.pickFilterBarVisible;
    this.set({ pickFilterBarVisible: next });
    this.setOptions({ pickFilterBar: next });
  }

  // ------------------------------------------------------------ FeatureManager operations (B2.4, B2.6, B2.8, D7.1)

  // ------------------------------------------------------------ order, folders and notes (B2.5, D1.5, D1.7)

  /**
   * Moves a feature to just before `beforeId` (the end when null): one undo step. A feature cannot come before what it is built on, nor go past the rollback
   * bar. It joins the folder that has features on both sides of where it lands, and leaves its own if it lands outside it; `folderChoice` says it otherwise.
   */
  moveFeature(id: Id, beforeId: Id | null, folderChoice?: string | null): void {
    const doc = this.history.doc;
    const ids = doc.features.map((f) => f.id);
    const rest = ids.filter((x) => x !== id);
    const at = beforeId === null ? rest.length : rest.indexOf(beforeId);
    if (at < 0 || !ids.includes(id)) return;
    const order = [...rest.slice(0, at), id, ...rest.slice(at)];
    const unmoved = order.every((x, i) => x === ids[i]);
    if (unmoved && folderChoice === undefined) return;
    const name = (x: Id) => doc.features.find((f) => f.id === x)?.name ?? x;
    const bar = doc.rollbackIndex ?? ids.length;
    if (order.slice(0, bar).some((x) => !ids.slice(0, bar).includes(x))) return void this.notify(t('tree.moveAcrossBar'), 'error');
    const problem = orderProblem(doc, order);
    if (problem) return void this.notify(t('tree.moveBlocked', { feature: name(problem.feature), parent: name(problem.parent) }), 'error');
    const folderOf = (x: Id | undefined) => (x === undefined ? undefined : doc.features.find((f) => f.id === x)?.folder);
    const before = folderOf(order[at - 1]);
    const after = folderOf(order[at + 1]);
    // between two features of one folder it joins; where the user dropped it on a folder row or beside one it is the user who says
    const folder = folderChoice !== undefined ? folderChoice : before !== undefined && before === after ? before : null;
    if (unmoved && (folder ?? undefined) === folderOf(id)) return; // dropped where it is, into the folder it is in
    this.execute({ type: 'arrange', order, folders: { [id]: folder } });
  }

  /** 「放進新資料夾」: the feature gets a folder of its own to begin with (drag others in, rename it). */
  newFolder(id: Id): void {
    const used = new Set(this.history.doc.features.flatMap((f) => (f.folder ? [f.folder] : [])));
    let n = 1;
    while (used.has(t('tree.folderName', { n }))) n++;
    this.execute({ type: 'arrange', order: this.history.doc.features.map((f) => f.id), folders: { [id]: t('tree.folderName', { n }) } });
  }

  /** The name of a folder changed, or the folder dissolved (null): all its features at once. */
  renameFolder(folder: string, to: string | null): void {
    const members = this.history.doc.features.filter((f) => f.folder === folder).map((f) => f.id);
    this.execute({ type: 'arrange', order: this.history.doc.features.map((f) => f.id), folders: Object.fromEntries(members.map((m) => [m, to])) });
  }

  /** Takes the feature out of its folder. */
  leaveFolder(id: Id): void {
    this.execute({ type: 'arrange', order: this.history.doc.features.map((f) => f.id), folders: { [id]: null } });
  }

  /** 「抑制」「恢復抑制」「恢復抑制（含相依特徵）」: the dependency graph decides which features change, in one step. */
  suppress(featureId: Id, action: SuppressAction): void {
    const featureIds = suppressionTargets(this.history.doc, featureId, action);
    if (featureIds.length > 0) this.execute({ type: 'setSuppressed', featureIds, value: action === 'suppress' });
  }

  /**
   * Changes the interface language (D9.1) and remembers it. Messages the worker made are in the old
   * language until it rebuilds, so it does, and the sketch being edited is solved again.
   */
  async setLanguage(locale: Locale): Promise<void> {
    try {
      localStorage.setItem(LOCALE_KEY, locale);
    } catch {
      // storage is blocked: the choice lasts for this visit only
    }
    setLocale(locale);
    await this.api.setLocale(locale);
    this.lastDoc = null;
    if (this.state.editing?.kind === 'sketch') this.requestSketchSolve();
    else this.requestRebuild();
  }

  /** Shows or hides sketches, reference planes, default planes or the origin (D4.6). */
  setVisibility(keys: string[], value: boolean): void {
    this.execute({ type: 'setVisibility', keys, value });
  }

  /** 「改用這個」 (B4.3): a feature's reference that no longer resolves now points at the candidate. */
  replaceRef(featureId: Id, from: Ref, candidate: { name: string; fingerprint: Fingerprint }): void {
    if (this.execute({ type: 'replaceRef', featureId, from, to: { kind: from.kind, name: candidate.name, fingerprint: candidate.fingerprint } })) {
      this.notify(t('ref.replaced', { name: candidate.name }));
    }
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

  openDialog(dialog: UiState['dialog']): void {
    this.set({ dialog });
  }

  /** Adds a global variable with a fresh id; the reason it was refused, or null. */
  addVariable(name: string, expr: string): string | null {
    const doc = this.history.doc;
    const id = new IdAllocator(doc.idCounters, idsInUse(doc)).take('var');
    return this.execute({ type: 'addVariable', variable: { id, name, expr } }) ? null : (this.state.notice?.text ?? '?');
  }

  showWhatsWrong(open: boolean): void {
    this.set({ whatsWrong: open });
  }

  /**
   * Where a plane is: a default plane, the plane the last rebuild found for a reference plane or a
   * coordinate system, or the planar face a sketch was put on. Null when no rebuild has found it yet:
   * a plane that was just made or moved, or one that could not be built.
   */
  planeFrameOf(plane: Ref): PlaneFrame | null {
    if (plane.kind === 'datum' && isDatumPlaneName(plane.name)) return DATUM_PLANES[plane.name];
    const frames = this.state.result?.frames;
    if (plane.kind === 'datum') return frames?.get(plane.name) ?? null;
    return faceFrame(plane);
  }

  /** The plane a sketch lies on: the frame the last rebuild found for the sketch, or else for its plane. */
  frameOf(sketch: SketchFeature): PlaneFrame | null {
    return this.state.result?.frames.get(sketch.id) ?? this.planeFrameOf(sketch.plane);
  }

  /** A default plane, a reference plane feature or a coordinate system, by the id the FeatureManager uses. */
  isPlane(id: Id): boolean {
    return isDatumPlaneName(id) || ['refPlane', 'coordSys'].includes(findFeature(this.history.doc, id)?.type ?? '');
  }

  /** The bytes of an image of a picture, by their hash (what was opened with the document or put into it). */
  imageBytes(sha256: string): Uint8Array | undefined {
    return this.blobs.get(sha256);
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
    this.history.begin(t('history.edit', { name: f.name }));
    if (f.type === 'sketch') return this.enterSketch(f, false);
    this.set({ editing: { featureId, kind: 'feature' }, selected: featureId });
    this.requestRebuild();
  }

  /** Starts a PropertyManager session to change the plane of a sketch (SolidWorks 「編輯草圖基準面」). */
  beginEditSketchPlane(featureId: Id): void {
    if (this.state.editing) this.commitEdit();
    const f = findFeature(this.history.doc, featureId);
    if (!f || f.type !== 'sketch') return;
    this.history.begin(t('history.redefineSketchPlane', { name: f.name }));
    this.set({ editing: { featureId, kind: 'sketchPlane' }, selected: featureId, selectedFace: null, selectedElements: [] });
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

  /**
   * 「草圖」 on a selected default plane, reference plane, coordinate system or planar face (C1.1): a new sketch, viewed normal to its
   * plane. A plane that was just made or moved gets its frame only with the next rebuild: the sketch then waits for it instead of
   * failing (ADR 0127). `spent` says this request already waited for one rebuild.
   */
  newSketch(plane: DatumPlaneName | Ref, spent = false): void {
    const ref: Ref = typeof plane === 'string' ? { kind: 'datum', name: plane } : plane;
    if (ref.kind === 'face' && !faceFrame(ref)) return this.notify(t('sketch.planeOnly'), 'error');
    if (!this.planeFrameOf(ref)) {
      if (spent) return this.notify(t('sketch.planeNotFound'), 'error');
      this.set({ pendingSketch: ref });
      if (!this.inFlight) this.requestRebuild();
      return;
    }
    const doc = this.history.doc;
    const feature: SketchFeature = {
      id: this.allocator().take('sketch'),
      type: 'sketch',
      name: nextName(doc, t('feature.sketch')),
      suppressed: false,
      plane: ref,
      entities: [],
      constraints: [],
    };
    if (this.startNew(feature, t('sketch.newSketch'))) this.enterSketch(feature, true);
  }

  /** The sketch that waited for a plane the rebuild has now found (ADR 0127): asked again, and this time it does not wait again. */
  private takePendingSketch(): void {
    const plane = this.state.pendingSketch;
    if (!plane) return;
    this.set({ pendingSketch: null });
    if (this.state.editing || this.assembly) return; // something else took the graphics area meanwhile
    this.newSketch(plane, true);
  }

  /** The sketch selected in the FeatureManager, for the features built from one. */
  private selectedSketch(): SketchFeature | null {
    const sketch = findFeature(this.history.doc, this.state.selected ?? '');
    if (sketch?.type === 'sketch') return sketch;
    this.notify(t('sketch.pickInTree'));
    return null;
  }

  private openNew(feature: Feature, label: string): void {
    if (!this.startNew(feature, label)) return;
    this.set({ editing: { featureId: feature.id, kind: 'feature' }, selected: feature.id, selectedFace: null, selectedElements: [] });
    this.requestRebuild();
  }

  /** 「伸長填料/基材」 or 「伸長除料」 from the selected sketch (C4.1, C4.2). */
  newExtrude(op: 'boss' | 'cut'): void {
    const sketch = this.selectedSketch();
    if (!sketch) return;
    const base = op === 'boss' ? t('feature.extrude') : t('feature.cut', { name: t('feature.extrude') });
    const id = this.allocator().take(op === 'boss' ? 'extrude' : 'cut');
    this.openNew({ id, type: 'extrude', name: nextName(this.history.doc, base), suppressed: false, sketch: sketch.id, op, dir1: { type: 'blind', depth: '10' } }, base);
  }

  /** 「異型孔」 (C4.8): a straight hole of Ø6 and 10 deep at the free points of the selected sketch, to be set in the PropertyManager. */
  newHole(): void {
    const sketch = this.selectedSketch();
    if (!sketch) return;
    const name = t('feature.hole');
    this.openNew({ id: this.allocator().take('hole'), type: 'hole', name: nextName(this.history.doc, name), suppressed: false, sketch: sketch.id, kind: 'straight', diameter: '6', end: { type: 'blind', depth: '10' } }, name);
  }

  /** 「螺柱」 (C4.11): a column Ø6 with a Ø2.5 pilot hole and 10 high at the free points of the selected sketch, to be set in the PropertyManager. */
  newScrewBoss(): void {
    const sketch = this.selectedSketch();
    if (!sketch) return;
    const name = t('feature.screwBoss');
    this.openNew({ id: this.allocator().take('boss'), type: 'screwBoss', name: nextName(this.history.doc, name), suppressed: false, sketch: sketch.id, diameter: '6', holeDiameter: '2.5', height: '10' }, name);
  }

  /** 「邊線凸緣」 (C11.2): a flange 20 long (from the outside virtual sharp), 90°, along the edge of the sheet to be picked in the graphics area. */
  newEdgeFlange(): void {
    const name = t('feature.edgeFlange');
    const edge = this.preselectedEdges()[0] ?? { kind: 'edge' as const, name: '' };
    this.openNew({ id: this.allocator().take('eflange'), type: 'edgeFlange', name: nextName(this.history.doc, name), suppressed: false, edge, length: '20' }, name);
  }

  /** 「摺邊」 (C11.2): a hem with a gap of 0.5 and 10 folded back, on the edge of the sheet to be picked in the graphics area. */
  newHem(): void {
    const name = t('feature.hem');
    const edge = this.preselectedEdges()[0] ?? { kind: 'edge' as const, name: '' };
    this.openNew({ id: this.allocator().take('hem'), type: 'hem', name: nextName(this.history.doc, name), suppressed: false, edge, length: '10', gap: '0.5' }, name);
  }

  /** 「斷開角落」 (C11.4): chamfer or fillet selected flange free-end corners. */
  newBreakCorner(): void {
    const name = t('feature.breakCorner');
    this.openNew({ id: this.allocator().take('breakcorner'), type: 'breakCorner', name: nextName(this.history.doc, name), suppressed: false, corners: this.preselectedEdges(), kind: 'chamfer', size: '2' }, name);
  }

  /** The edge an edge flange or a hem is on: the edge clicked in the graphics area. */
  setFlangeEdge(ref: Ref): void {
    const f = this.editedFeature();
    if ((f?.type !== 'edgeFlange' && f?.type !== 'hem') || ref.kind !== 'edge') return;
    const { id, type, name, suppressed, ...rest } = f;
    void [id, type, name, suppressed];
    if (f.type === 'hem') this.execute({ type: 'setHem', featureId: f.id, hem: { ...(rest as Omit<HemFeature, 'id' | 'type' | 'name' | 'suppressed'>), edge: ref } });
    else this.execute({ type: 'setEdgeFlange', featureId: f.id, flange: { ...(rest as Omit<EdgeFlangeFeature, 'id' | 'type' | 'name' | 'suppressed'>), edge: ref } });
  }

  /** 「基材凸緣」 (C11.1): a sheet 1.5 thick with an inside bend radius of 1.5 and K 0.5 from the selected sketch (closed: a plate; open: a bent sheet 50 wide). */
  newBaseFlange(): void {
    const sketch = this.selectedSketch();
    if (!sketch) return;
    const name = t('feature.baseFlange');
    this.openNew({ id: this.allocator().take('flange'), type: 'baseFlange', name: nextName(this.history.doc, name), suppressed: false, sketch: sketch.id, thickness: '1.5', radius: '1.5', kFactor: '0.5', depth: '50' }, name);
  }

  /** 「中間折彎」 (S-3): the selected sketch (one straight line), 90° to start with. */
  newMidBend(): void {
    const sketch = this.selectedSketch();
    if (!sketch) return;
    const name = t('feature.midBend');
    this.openNew({ id: this.allocator().take('midbend'), type: 'midBend', name: nextName(this.history.doc, name), suppressed: false, sketch: sketch.id, angle: '90' }, name);
  }

  /** 「卡榫」 (C4.11): a beam 15 long, 2 thick and 6 wide with a hook 3 high standing out 1.2, at the free points of the selected sketch, to be set in the PropertyManager. */
  newSnapHook(): void {
    const sketch = this.selectedSketch();
    if (!sketch) return;
    const name = t('feature.snapHook');
    this.openNew({ id: this.allocator().take('hook'), type: 'snapHook', name: nextName(this.history.doc, name), suppressed: false, sketch: sketch.id, width: '6', thickness: '2', length: '15', hookHeight: '3', hookDepth: '1.2' }, name);
  }

  /** 「卡榫的窗」 (C4.11): a window 8 × 4 cut 3 deep at the free points of the selected sketch. */
  newSnapCatch(): void {
    const sketch = this.selectedSketch();
    if (!sketch) return;
    const name = t('feature.snapCatch');
    this.openNew({ id: this.allocator().take('catch'), type: 'snapCatch', name: nextName(this.history.doc, name), suppressed: false, sketch: sketch.id, length: '8', width: '4', depth: '3' }, name);
  }

  /** 「排氣口」 (C4.11): a row of five slots 10 × 2, 4 apart, cut 3 deep at the free points of the selected sketch. */
  newVent(): void {
    const sketch = this.selectedSketch();
    if (!sketch) return;
    const name = t('feature.vent');
    this.openNew({ id: this.allocator().take('vent'), type: 'vent', name: nextName(this.history.doc, name), suppressed: false, sketch: sketch.id, count: '5', pitch: '4', length: '10', width: '2', depth: '3' }, name);
  }

  /** 「肋材」 (C4.7): the one line of the selected sketch as a wall of 4 mm about the sketch plane, grown to the body in the PropertyManager's session. */
  newRib(): void {
    const sketch = this.selectedSketch();
    if (!sketch) return;
    const name = t('feature.rib');
    this.openNew({ id: this.allocator().take('rib'), type: 'rib', name: nextName(this.history.doc, name), suppressed: false, sketch: sketch.id, thickness: '4', side: 'mid' }, name);
  }

  /**
   * 「疊層拉伸」 or 「除料-疊層拉伸」 (C4.5): the selected sketch is the last section, the latest other sketch with a circle, a line or an arc the first; the
   * PropertyManager adds, removes and orders the sections.
   */
  newLoft(op: 'boss' | 'cut'): void {
    const last = this.selectedSketch();
    if (!last) return;
    const first = [...this.history.doc.features].reverse().find((f): f is SketchFeature => f.type === 'sketch' && f.id !== last.id && f.entities.some((e) => (e.type === 'line' || e.type === 'arc' || e.type === 'circle') && !e.construction));
    const base = op === 'boss' ? t('feature.loft') : t('feature.cut', { name: t('feature.loft') });
    const id = this.allocator().take('loft');
    this.openNew({ id, type: 'loft', name: nextName(this.history.doc, base), suppressed: false, sections: first ? [first.id, last.id] : [last.id], op }, base);
  }

  /**
   * 「掃出」 or 「除料-掃出」 (C4.4): the selected sketch is the profile; its path is the latest other sketch that has a line or an arc, to be changed in the PropertyManager.
   */
  newSweep(op: 'boss' | 'cut'): void {
    const profile = this.selectedSketch();
    if (!profile) return;
    const path = [...this.history.doc.features].reverse().find((f): f is SketchFeature => f.type === 'sketch' && f.id !== profile.id && f.entities.some((e) => (e.type === 'line' || e.type === 'arc') && !e.construction));
    if (!path) return this.notify(t('feature.sweepNeedsPathSketch'), 'error');
    const base = op === 'boss' ? t('feature.sweep') : t('feature.cut', { name: t('feature.sweep') });
    const id = this.allocator().take('sweep');
    this.openNew({ id, type: 'sweep', name: nextName(this.history.doc, base), suppressed: false, sketch: profile.id, path: path.id, op }, base);
  }

  /** 「螺牙」 (ADR 0123): sweeps a tooth profile sketch along a helix around an axis. */
  newThread(op: 'cut' | 'boss' = 'cut'): void {
    const s = this.state;
    const sketch = this.selectedSketch() ?? [...this.history.doc.features].reverse().find((f): f is SketchFeature => f.type === 'sketch');
    if (!sketch) return this.notify(t('feature.threadNeedsSketch'), 'error');
    const planeName = sketch.plane.kind === 'datum' ? sketch.plane.name : '';
    let axis: ThreadFeature['axis'] = planeName === 'plane:front' ? { kind: 'datum', name: 'axis:y' } : { kind: 'datum', name: 'axis:z' };
    if (s.selectedFace) {
      axis = s.selectedFace;
    } else if (s.selected && (s.selected.startsWith('axis:') || this.history.doc.features.some((f) => f.id === s.selected && f.type === 'refAxis'))) {
      axis = { kind: 'datum', name: s.selected };
    } else {
      const lines = sketch.entities.filter((e) => e.type === 'line');
      const center = lines.find((e) => e.construction);
      if (center) axis = center.id; // a line of the sketch, by its id, as a revolve's axis
    }
    const base = t('feature.thread');
    const id = this.allocator().take('thread');
    this.openNew(
      {
        id,
        type: 'thread',
        name: nextName(this.history.doc, base),
        suppressed: false,
        sketch: sketch.id,
        axis,
        op,
        operation: op,
        pitch: '2',
        starts: '1',
        hand: 'right',
        length: '10',
        taper: '0',
        phase: '0',
        reverse: false,
      },
      base,
    );
  }

  /**
   * 「壓花」 (ADR 0124): the grooves of a straight, helical or diamond pattern cut into a cylinder about an axis. The axis is whatever is picked (a
   * cylindrical face, a straight edge or a reference axis), else the z axis; the blank diameter, the groove count and the rest are for the
   * PropertyManager to set.
   */
  newKnurl(): void {
    const s = this.state;
    if (!s.result?.mesh) return this.notify(t('feature.knurlNeedsBody'), 'error');
    let axis: Ref = { kind: 'datum', name: 'axis:z' };
    if (s.selectedFace) axis = s.selectedFace;
    else if (s.selected && (s.selected.startsWith('axis:') || this.history.doc.features.some((f) => f.id === s.selected && f.type === 'refAxis'))) axis = { kind: 'datum', name: s.selected };
    const base = t('feature.knurl');
    const id = this.allocator().take('knurl');
    this.openNew(
      {
        id,
        type: 'knurl',
        name: nextName(this.history.doc, base),
        suppressed: false,
        axis,
        diameter: '20',
        length: '10',
        count: '20',
        depth: '0.5',
        pattern: 'diamond',
        angle: '30',
        included: '90',
        hand: 'right',
        phase: '0',
        reverse: false,
      },
      base,
    );
  }

  /**
   * Cosmetic Thread (裝飾螺紋線, C4.9, ADR 0156):
   * Opens a new cosmetic thread in PropertyManager.
   */
  newCosmeticThread(): void {
    const s = this.state;
    if (!s.result?.mesh) return this.notify(t('feature.cosmeticThreadNeedsBody'), 'error');
    let targetFace: Ref = { kind: 'face', name: '' };
    if (s.selectedFace) targetFace = s.selectedFace;
    const base = t('feature.cosmeticThread');
    const id = this.allocator().take('cosmeticThread');
    this.openNew(
      {
        id,
        type: 'cosmeticThread',
        name: nextName(this.history.doc, base),
        suppressed: false,
        targetFace,
        threadType: 'external',
        standardMode: 'standard',
        standardDesignation: 'M8',
        majorDiameter: '8',
        minorDiameter: '6.466',
        pitch: '1.25',
        endCondition: 'through',
        depth: '10',
      },
      base,
    );
  }

  /** 「旋轉填料/基材」 or 「旋轉除料」 (C4.3) about the sketch's centerline (or its only line). */
  newRevolve(op: 'boss' | 'cut'): void {
    const sketch = this.selectedSketch();
    if (!sketch) return;
    const lines = sketch.entities.filter((e) => e.type === 'line');
    const axis = lines.find((e) => e.construction) ?? (lines.length === 1 ? lines[0] : undefined);
    if (!axis) return this.notify(t('feature.axisNeeded'), 'error');
    const base = op === 'boss' ? t('feature.revolve') : t('feature.cut', { name: t('feature.revolve') });
    const id = this.allocator().take('revolve');
    this.openNew({ id, type: 'revolve', name: nextName(this.history.doc, base), suppressed: false, sketch: sketch.id, axis: axis.id, op, dir1: { type: 'blind', angle: '360' } }, base);
  }

  /** 「圓角」 (C5.1): picks edges on the model in the PropertyManager session. */
  newFillet(): void {
    this.set({ filletPick: 'faces' });
    const id = this.allocator().take('fillet');
    this.openNew({ id, type: 'fillet', name: nextName(this.history.doc, t('feature.fillet')), suppressed: false, edges: this.preselectedEdges(), radius: '2' }, t('feature.fillet'));
  }

  /**
   * 「基準面」 (C3.2): as far off the plane or planar face that is selected as the last distance that was
   * confirmed (10 mm the first time); the PropertyManager changes the type and the references.
   */
  newRefPlane(): void {
    this.openDatumPlane({ mode: 'offset', plane: this.basePlane(), distance: this.state.options.datumOffset });
  }

  /** The plane new reference geometry starts from: the one picked in the tree, the planar face picked in the graphics area, else the front plane. */
  private basePlane(): Ref {
    const s = this.state;
    if (s.selected !== null && this.isPlane(s.selected)) return { kind: 'datum', name: s.selected };
    return s.selectedFace?.fingerprint?.type === 'plane' ? s.selectedFace : { kind: 'datum', name: 'plane:front' };
  }

  /** A 「基準面」 session; `thenSketch` starts a sketch on the plane it made as soon as it is confirmed (ADR 0127). */
  private openDatumPlane(def: PlaneDefinition, thenSketch = false): void {
    const id = this.allocator().take('plane');
    this.openNew({ id, type: 'refPlane', name: nextName(this.history.doc, t('feature.refPlane')), suppressed: false, def }, t(thenSketch ? (def.mode === 'angle' ? 'act.angleSketch' : 'act.offsetSketch') : 'feature.refPlane'));
    const e = this.state.editing;
    if (thenSketch && e?.featureId === id && e.kind === 'feature') this.set({ editing: { ...e, thenSketch: true } });
  }

  /** 「偏移草圖」 (C1.1, ADR 0127): the plane of 「基準面」 and a sketch on it in one command. Cancelling the plane starts nothing. */
  newOffsetSketch(): void {
    this.openDatumPlane({ mode: 'offset', plane: this.basePlane(), distance: this.state.options.datumOffset }, true);
  }

  /**
   * 「角度草圖」 (C1.1, C3.2, ADR 0127): a plane turned 45° from the selected one about an axis, and a sketch on it. The axis is still
   * to be picked — in the graphics area (ADR 0127) or with the PropertyManager's buttons — and the angle changed.
   */
  newAngleSketch(): void {
    this.openDatumPlane({ mode: 'angle', plane: this.basePlane(), axis: emptyRef('axis'), angle: '45' }, true);
  }

  /**
   * 「線性複製排列」 or 「環狀複製排列」 (C6.1, C6.2): repeats the feature that is selected (else the latest one that can be repeated); the
   * PropertyManager changes the seeds, the direction or axis, the count and the spacing, and the instances to skip.
   */
  newPattern(mode: 'linear' | 'circular'): void {
    const doc = this.history.doc;
    const selected = findFeature(doc, this.state.selected ?? '');
    const seed = selected && canBeSeed(selected) ? selected : [...doc.features].reverse().find(canBeSeed);
    if (!seed) return this.notify(t('pattern.nothingToRepeat'), 'error');
    const name = t(mode === 'linear' ? 'feature.linearPattern' : 'feature.circularPattern');
    const def: PatternDefinition = mode === 'linear' ? { mode, dir1: { ref: { kind: 'datum', name: 'plane:right' }, spacing: '10', count: '3' } } : { mode, axis: emptyRef('rotationAxis'), count: '6', angle: '360', equal: true };
    this.openNew({ id: this.allocator().take('pattern'), type: 'pattern', name: nextName(doc, name), suppressed: false, seeds: [seed.id], def }, name);
  }

  /**
   * 「鏡射」 (C6.3): across the right plane to begin with; mirrors the feature that is selected (else the latest one that can be repeated), or, when
   * the model has nothing to repeat, a body. The PropertyManager changes what is mirrored and across which plane.
   */
  newMirror(): void {
    const doc = this.history.doc;
    const selected = findFeature(doc, this.state.selected ?? '');
    const seed = selected && canBeSeed(selected) ? selected : [...doc.features].reverse().find(canBeSeed);
    const body = this.state.result?.bodies[0];
    if (!seed && !body) return this.notify(t('mirror.nothingToMirror'), 'error');
    const name = t('feature.mirror');
    const plane: Ref = { kind: 'datum', name: 'plane:right' };
    const mirror: Feature = seed
      ? { id: this.allocator().take('mirror'), type: 'mirror', name: nextName(doc, name), suppressed: false, target: 'features', plane, seeds: [seed.id], bodies: [] }
      : { id: this.allocator().take('mirror'), type: 'mirror', name: nextName(doc, name), suppressed: false, target: 'bodies', plane, seeds: [], bodies: [{ kind: 'body', name: body!.id }] };
    this.openNew(mirror, name);
  }

  /** 「基準軸」 (C3.3): along a straight edge, or the axis of the cylinder that is selected; the PropertyManager changes the type and the references. */
  newRefAxis(): void {
    const face = this.state.selectedFace;
    const def = face?.kind === 'face' && (face.fingerprint?.type === 'cylinder' || face.fingerprint?.type === 'cone') ? ({ mode: 'cylinder', face } as const) : axisDefinitionFor('edge');
    const name = t('feature.refAxis');
    this.openNew({ id: this.allocator().take('axis'), type: 'refAxis', name: nextName(this.history.doc, name), suppressed: false, def }, name);
  }

  /** 「參考點」 (C3.5): at the part origin by coordinates, to be moved or changed to another kind in the PropertyManager. */
  newRefPoint(): void {
    const name = t('feature.refPoint');
    this.openNew({ id: this.allocator().take('point'), type: 'refPoint', name: nextName(this.history.doc, name), suppressed: false, def: { mode: 'coords', x: '0', y: '0', z: '0' } }, name);
  }

  /** 「座標系統」 (C3.4): at the part origin with its axes along the default ones, to be changed in the PropertyManager. */
  newCoordSys(): void {
    const name = t('feature.coordSys');
    this.openNew({ id: this.allocator().take('csys'), type: 'coordSys', name: nextName(this.history.doc, name), suppressed: false, x: { kind: 'datum', name: 'plane:right' }, y: { kind: 'datum', name: 'plane:top' } }, name);
  }

  /** 「導角」 (C5.3), angle–distance by default like SolidWorks. */
  newChamfer(): void {
    const id = this.allocator().take('chamfer');
    this.openNew({ id, type: 'chamfer', name: nextName(this.history.doc, t('feature.chamfer')), suppressed: false, edges: this.preselectedEdges(), mode: 'angleDistance', distance: '1', second: '45' }, t('feature.chamfer'));
  }

  /** 「刪除面」 (C10.2): starts with the face selected in the graphics area, if there is one. */
  newDeleteFace(): void {
    const face = this.state.selectedFace;
    const name = t('feature.deleteFace');
    this.openNew({ id: this.allocator().take('delface'), type: 'deleteFace', name: nextName(this.history.doc, name), suppressed: false, faces: face?.kind === 'face' ? [face] : [] }, name);
  }

  /** 「拔模」 (C5.5): starts with the face selected in the graphics area, if there is one, as the neutral face. */
  newDraft(): void {
    const face = this.state.selectedFace;
    const name = t('feature.draftFeature');
    this.openNew({ id: this.allocator().take('draft'), type: 'draft', name: nextName(this.history.doc, name), suppressed: false, neutral: face?.kind === 'face' ? face : { kind: 'face', name: '' }, faces: [], angle: '3deg' }, name);
  }

  /** A click while a draft is edited: the first face is the neutral face, the others are toggled in or out of the faces to lean. */
  pickDraftFace(ref: Ref): void {
    const f = this.editedFeature();
    if (f?.type !== 'draft' || ref.kind !== 'face') return;
    const set = (neutral: Ref, faces: Ref[]) => this.execute({ type: 'setDraftFeature', featureId: f.id, neutral, faces, angle: f.angle, ...(f.reverse ? { reverse: true } : {}) });
    if (!f.neutral.name) return void set(ref, f.faces.filter((x) => x.name !== ref.name));
    if (ref.name === f.neutral.name) return;
    set(f.neutral, f.faces.some((x) => x.name === ref.name) ? f.faces.filter((x) => x.name !== ref.name) : [...f.faces, ref]);
  }

  /** 「薄殼」 (C5.4): starts with the face selected in the graphics area, if there is one, as the face to take away. */
  newShell(): void {
    const face = this.state.selectedFace;
    const name = t('feature.shell');
    this.set({ shellPick: 'open' });
    this.openNew({ id: this.allocator().take('shell'), type: 'shell', name: nextName(this.history.doc, name), suppressed: false, faces: face?.kind === 'face' ? [face] : [], thickness: '2' }, name);
  }

  setShellPick(mode: 'open' | 'thickness'): void {
    this.set({ shellPick: mode });
  }

  /** A face picked while the walls of another thickness of a shell are edited: put on the list with the thickness of the rest, or taken off it when it is on. */
  toggleShellWallFace(ref: Ref): void {
    const f = this.editedFeature();
    if (f?.type !== 'shell' || ref.kind !== 'face') return;
    if (f.faces.some((x) => x.name === ref.name)) return void this.notify(t('feature.shellFaceOpened'), 'error');
    const list = f.faceThickness ?? [];
    this.setShellWalls(list.some((x) => x.face.name === ref.name) ? list.filter((x) => x.face.name !== ref.name) : [...list, { face: ref, thickness: f.thickness }]);
  }

  /** The walls of another thickness of the shell being edited, the rest as it was. */
  setShellWalls(faceThickness: { face: Ref; thickness: string }[]): void {
    const f = this.editedFeature();
    if (f?.type !== 'shell') return;
    this.execute({ type: 'setShell', featureId: f.id, faces: f.faces, thickness: f.thickness, ...(f.outward ? { outward: true } : {}), faceThickness });
  }

  /** Face list of a shell: clicking a face toggles it, like the faces of a Delete Face. */
  toggleShellFace(ref: Ref): void {
    const f = this.editedFeature();
    if (f?.type !== 'shell' || ref.kind !== 'face') return;
    const faces = f.faces.some((x) => x.name === ref.name) ? f.faces.filter((x) => x.name !== ref.name) : [...f.faces, ref];
    this.execute({ type: 'setShell', featureId: f.id, faces, thickness: f.thickness, ...(f.outward ? { outward: true } : {}) });
  }

  /** 「移動面」 (C10.1): starts with the planar face selected in the graphics area, if there is one. */
  newMoveFace(): void {
    const face = this.state.selectedFace;
    const name = t('feature.moveFace');
    const picked: Ref = face?.kind === 'face' && face.fingerprint?.type === 'plane' ? face : { kind: 'face', name: '' };
    this.openNew({ id: this.allocator().take('moveface'), type: 'moveFace', name: nextName(this.history.doc, name), suppressed: false, face: picked, distance: '5' }, name);
  }

  /** 「偏移曲面」 (C9.2): starts with the face selected in the graphics area, if there is one; 3 mm is the gap of a gauge. */
  newOffsetSurface(): void {
    const face = this.state.selectedFace;
    const name = t('feature.offsetSurface');
    this.openNew({ id: this.allocator().take('offset'), type: 'offsetSurface', name: nextName(this.history.doc, name), suppressed: false, faces: face?.kind === 'face' ? [face] : [], distance: '3' }, name);
  }

  /** Face list of an offset surface: clicking a face toggles it; the faces the feature itself made are not for it to take. */
  toggleOffsetFace(ref: Ref): void {
    const f = this.editedFeature();
    if (f?.type !== 'offsetSurface' || ref.kind !== 'face') return;
    if (ref.name.startsWith(`${f.id}:`)) return void this.notify(t('surface.ownFace'), 'error');
    const faces = f.faces.some((x) => x.name === ref.name) ? f.faces.filter((x) => x.name !== ref.name) : [...f.faces, ref];
    this.execute({ type: 'setOffsetSurface', featureId: f.id, faces, distance: f.distance, ...(f.join ? { join: f.join } : {}) });
  }

  /**
   * 「分割線」 (C8.1): the selected sketch (else the latest one) is projected onto the face selected in the graphics area, if there is one; the PropertyManager
   * changes either.
   */
  newSplitLine(): void {
    const selected = findFeature(this.history.doc, this.state.selected ?? '');
    const sketch = selected?.type === 'sketch' ? selected : [...this.history.doc.features].reverse().find((f): f is SketchFeature => f.type === 'sketch');
    if (!sketch) return void this.notify(t('sketch.pickInTree'));
    const face = this.state.selectedFace;
    const name = t('feature.splitLine');
    this.openNew({ id: this.allocator().take('split'), type: 'splitLine', name: nextName(this.history.doc, name), suppressed: false, sketch: sketch.id, face: face?.kind === 'face' ? face : { kind: 'face', name: '' } }, name);
  }

  /** 「唇與溝槽」 (C4.11): on the planar face selected in the graphics area, if there is one (the rim of a shell); a lip 1 high, 1 wide, 0.5 in from the edge to begin with. */
  newLipGroove(): void {
    const face = this.state.selectedFace;
    const name = t('feature.lipGroove');
    this.openNew({ id: this.allocator().take('lip'), type: 'lipGroove', name: nextName(this.history.doc, name), suppressed: false, face: face?.kind === 'face' ? face : { kind: 'face', name: '' }, kind: 'lip', offset: '0.5', width: '1', height: '1' }, name);
  }

  /** The face a lip or groove is on: the planar face clicked in the graphics area (not one the feature made itself). */
  setLipFace(ref: Ref): void {
    const f = this.editedFeature();
    if (f?.type !== 'lipGroove' || ref.kind !== 'face') return;
    if (ref.name.startsWith(`${f.id}:`)) return void this.notify(t('surface.ownFace'), 'error');
    if (ref.fingerprint?.type !== 'plane') return void this.notify(t('lip.planeOnly'), 'error');
    this.execute({ type: 'setLipGroove', featureId: f.id, face: ref, kind: f.kind, offset: f.offset, width: f.width, height: f.height });
  }

  /** The face a split line cuts: the face clicked in the graphics area (not one the feature made itself). */
  setSplitFace(ref: Ref): void {
    const f = this.editedFeature();
    if (f?.type !== 'splitLine' || ref.kind !== 'face') return;
    if (ref.name.startsWith(`${f.id}:`)) return void this.notify(t('surface.ownFace'), 'error');
    this.execute({ type: 'setSplitLine', featureId: f.id, sketch: f.sketch, face: ref, ...(f.reverse ? { reverse: true } : {}), ...(f.throughAll ? { throughAll: true } : {}) });
  }

  /** 「縫織曲面」 (C9.3): starts with the surface body of the selected face, if there is one, and remembers which surface bodies there are to choose from. */
  newKnit(): void {
    const result = this.state.result;
    const pool = this.snapshotBodies(result);
    const face = this.state.selectedFace;
    const first = face?.kind === 'face' ? this.bodyOfFace(face.name) : undefined;
    const name = t('feature.knit');
    this.openNew({ id: this.allocator().take('knit'), type: 'knit', name: nextName(this.history.doc, name), suppressed: false, bodies: first && pool.some((b) => b.id === first && b.surface) ? [{ kind: 'body', name: first }] : [] }, name);
  }

  /** 「互相修剪曲面」 (P-3): the surface body of the selected face and the next surface body, both from the ones on screen. */
  newMutualTrim(): void {
    const pool = this.snapshotBodies(this.state.result);
    const surfaces = pool.filter((b) => b.surface);
    const face = this.state.selectedFace;
    const picked = face?.kind === 'face' ? this.bodyOfFace(face.name) : undefined;
    const a = surfaces.find((b) => b.id === picked) ?? surfaces[0];
    const b = surfaces.find((x) => x !== a);
    const name = t('feature.mutualTrim');
    this.openNew({ id: this.allocator().take('mutualtrim'), type: 'mutualTrim', name: nextName(this.history.doc, name), suppressed: false, a: { kind: 'body', name: a?.id ?? '' }, b: { kind: 'body', name: b?.id ?? '' } }, name);
  }

  /** Changes the bodies or the pieces taken away of the mutual trim being edited. */
  setMutualTrim(patch: { a?: Ref; b?: Ref; discard?: Ref[] }): void {
    const f = this.editedFeature();
    if (f?.type !== 'mutualTrim') return;
    const next = { a: f.a, b: f.b, discard: f.discard, ...patch };
    this.execute({ type: 'setMutualTrim', featureId: f.id, a: next.a, b: next.b, ...(next.discard && next.discard.length > 0 ? { discard: next.discard } : {}) });
  }

  /** A face picked while a mutual trim is edited: that piece is taken away, or taken back when it was. It has to be a piece of one of the two bodies. */
  toggleTrimPiece(faceName: string): void {
    const f = this.editedFeature();
    if (f?.type !== 'mutualTrim') return;
    const id = this.bodyOfFace(faceName);
    if (!id || (id !== f.a.name && id !== f.b.name)) return void this.notify(t('surface.trimNotPiece'), 'error');
    const discard = f.discard ?? [];
    this.setMutualTrim({ discard: discard.some((r) => r.name === faceName) ? discard.filter((r) => r.name !== faceName) : [...discard, { kind: 'face', name: faceName }] });
  }

  /** The bodies of the model on screen, kept for the session that is about to start (`bodyPool`). */
  private snapshotBodies(result: UiState['result']): UiState['bodyPool'] {
    const pool = (result?.bodies ?? []).map((b) => ({ id: b.id, name: b.name, surface: b.surface }));
    this.set({ bodyPool: pool });
    return pool;
  }

  /** 「厚面」 (C9.4): the surface body of the selected face (else the first surface body), 2 mm to start with; the PropertyManager changes either. */
  newThicken(): void {
    const pool = this.snapshotBodies(this.state.result);
    const face = this.state.selectedFace;
    const picked = face?.kind === 'face' ? this.bodyOfFace(face.name) : undefined;
    const body = pool.find((b) => b.surface && b.id === picked) ?? pool.find((b) => b.surface);
    const name = t('feature.thicken');
    this.openNew({ id: this.allocator().take('thicken'), type: 'thicken', name: nextName(this.history.doc, name), suppressed: false, body: { kind: 'body', name: body?.id ?? '' }, thickness: '2' }, name);
  }

  /** 「以曲面除料」 (C9.4): the solid of the selected face (else the first solid) cut with the first surface body, along the normal of the front plane to start with. */
  newCutWithSurface(): void {
    const pool = this.snapshotBodies(this.state.result);
    const face = this.state.selectedFace;
    const picked = face?.kind === 'face' ? this.bodyOfFace(face.name) : undefined;
    const target = pool.find((b) => !b.surface && b.id === picked) ?? pool.find((b) => !b.surface);
    const surface = pool.find((b) => b.surface && b.id === picked) ?? pool.find((b) => b.surface);
    const name = t('feature.cutWithSurface');
    this.openNew({ id: this.allocator().take('surfacecut'), type: 'cutWithSurface', name: nextName(this.history.doc, name), suppressed: false, target: { kind: 'body', name: target?.id ?? '' }, surface: { kind: 'body', name: surface?.id ?? '' }, direction: { kind: 'datum', name: 'plane:front' } }, name);
  }

  /** A face picked while a thicken or a cut with surface is edited: its body is the one to thicken, or (by whether it is a surface) the one to cut or to cut with. */
  pickSurfaceBody(faceName: string): void {
    const f = this.editedFeature();
    const id = this.bodyOfFace(faceName);
    if (!id) return;
    const surface = !!this.state.bodyPool.find((b) => b.id === id)?.surface;
    if (f?.type === 'thicken') {
      if (!surface) return void this.notify(t('surface.thickenNeedsSurface', { name: id }), 'error');
      this.execute({ type: 'setThicken', featureId: f.id, body: { kind: 'body', name: id }, thickness: f.thickness, both: f.both, keepSurface: f.keepSurface });
    } else if (f?.type === 'cutWithSurface') {
      this.setCut({ ...(surface ? { surface: { kind: 'body', name: id } as Ref } : { target: { kind: 'body', name: id } as Ref }) });
    }
  }

  /** Changes what a cut with surface is made of, the rest as it was. */
  setCut(patch: Partial<{ target: Ref; surface: Ref; direction: NonNullable<Extract<Feature, { type: 'cutWithSurface' }>['direction']>; reverse: boolean; keep: 'behind' | 'ahead' }>): void {
    const f = this.editedFeature();
    if (f?.type !== 'cutWithSurface') return;
    const next = { target: f.target, surface: f.surface, direction: f.direction, reverse: f.reverse, keep: f.keep, ...patch };
    this.execute({ type: 'setCutWithSurface', featureId: f.id, target: next.target, surface: next.surface, direction: next.direction, ...(next.reverse ? { reverse: true } : {}), ...(next.keep === 'ahead' ? { keep: 'ahead' } : {}) });
  }

  /** A face picked while a knit is edited: its body is added to the bodies, or taken out of them. */
  pickKnitBody(faceName: string): void {
    const f = this.editedFeature();
    const id = this.bodyOfFace(faceName);
    if (f?.type !== 'knit' || !id) return;
    if (!this.state.result?.bodies.find((b) => b.id === id)?.surface) return void this.notify(t('surface.knitNeedsSurface', { name: id }), 'error');
    this.setKnitBodies(f.bodies.some((x) => x.name === id) ? f.bodies.filter((x) => x.name !== id) : [...f.bodies, { kind: 'body', name: id }]);
  }

  setKnitBodies(bodies: Ref[]): void {
    const f = this.editedFeature();
    if (f?.type !== 'knit') return;
    this.execute({ type: 'setKnit', featureId: f.id, bodies, ...(f.tolerance === undefined ? {} : { tolerance: f.tolerance }), ...(f.solid === false ? { solid: false } : {}) });
  }

  /** 「填補曲面」, 「平坦曲面」 and 「延伸曲面」 (C9.2, C9.3): all take the edges picked in the graphics area, none to begin with. */
  newSurfaceEdges(type: 'fillSurface' | 'flatSurface' | 'extendSurface'): void {
    const name = t(`feature.${type}`);
    const base = { id: this.allocator().take(type === 'fillSurface' ? 'fill' : type === 'flatSurface' ? 'flat' : 'extend'), name: nextName(this.history.doc, name), suppressed: false, edges: this.preselectedEdges() };
    this.openNew(type === 'extendSurface' ? { ...base, type, distance: '5' } : { ...base, type }, name);
  }

  /** A click while the edges of a fill, flat or extend surface are edited: toggled in or out; the edges the feature itself made are not for it to take. */
  toggleSurfaceEdge(ref: Ref): void {
    const f = this.editedFeature();
    if (f?.type !== 'fillSurface' && f?.type !== 'flatSurface' && f?.type !== 'extendSurface') return;
    if (ref.kind !== 'edge') return;
    if (ref.name.includes(`${f.id}:`)) return void this.notify(t('surface.ownFace'), 'error');
    this.setSurfaceEdges(f.edges.some((x) => x.name === ref.name) ? f.edges.filter((x) => x.name !== ref.name) : [...f.edges, ref]);
  }

  setSurfaceEdges(edges: Ref[]): void {
    const f = this.editedFeature();
    if (f?.type === 'fillSurface') this.execute({ type: 'setFillSurface', featureId: f.id, edges, ...(f.continuity ? { continuity: f.continuity } : {}) });
    else if (f?.type === 'flatSurface') this.execute({ type: 'setFlatSurface', featureId: f.id, edges });
    else if (f?.type === 'extendSurface') this.execute({ type: 'setExtendSurface', featureId: f.id, edges, distance: f.distance });
  }

  /** 「修剪曲面」 (C9.3): the selected sketch (else the latest one) and the face selected in the graphics area, if there is one, as for a split line. */
  newTrimSurface(): void {
    const selected = findFeature(this.history.doc, this.state.selected ?? '');
    const sketch = selected?.type === 'sketch' ? selected : [...this.history.doc.features].reverse().find((f): f is SketchFeature => f.type === 'sketch');
    if (!sketch) return void this.notify(t('sketch.pickInTree'));
    const face = this.state.selectedFace;
    const name = t('feature.trimSurface');
    this.openNew({ id: this.allocator().take('trim'), type: 'trimSurface', name: nextName(this.history.doc, name), suppressed: false, sketch: sketch.id, face: face?.kind === 'face' ? face : { kind: 'face', name: '' } }, name);
  }

  /** The face a trim cuts: the face clicked in the graphics area (not one the feature made itself). */
  setTrimFace(ref: Ref): void {
    const f = this.editedFeature();
    if (f?.type !== 'trimSurface' || ref.kind !== 'face') return;
    if (ref.name.startsWith(`${f.id}:`)) return void this.notify(t('surface.ownFace'), 'error');
    this.execute({ type: 'setTrimSurface', featureId: f.id, sketch: f.sketch, face: ref, ...(f.keep ? { keep: f.keep } : {}), ...(f.reverse ? { reverse: true } : {}), ...(f.throughAll ? { throughAll: true } : {}) });
  }

  /** 「組合」 (C7.2): the body of the selected face is the main body to start with; the PropertyManager picks the rest. */
  newCombine(): void {
    const face = this.state.selectedFace;
    const main = face?.kind === 'face' ? this.bodyOfFace(face.name) : undefined;
    const name = t('feature.combine');
    this.openNew({ id: this.allocator().take('combine'), type: 'combine', name: nextName(this.history.doc, name), suppressed: false, op: 'add', main: { kind: 'body', name: main ?? '' }, tools: [] }, name);
  }

  /** 「分割實體」 (C7.4): the selected planar face or top plane is the tool; the PropertyManager picks the rest. */
  newSplit(): void {
    const face = this.state.selectedFace;
    const tool: Ref = face?.kind === 'face' ? face : { kind: 'datum', name: 'plane:top' };
    const name = t('feature.split');
    this.openNew({ id: this.allocator().take('split'), type: 'split', name: nextName(this.history.doc, name), suppressed: false, tool, targets: [] }, name);
  }

  /** The id of the body a face of the model on screen belongs to. */
  bodyOfFace(faceName: string): Id | undefined {
    const r = this.state.result;
    const i = r?.faceNames.indexOf(faceName) ?? -1;
    return i < 0 ? undefined : r!.bodies.find((b) => i >= b.face0 && i < b.face0 + b.faces)?.id;
  }

  /** A face picked while a Combine is edited: the first body picked is the main one, the others are toggled as tools. */
  pickBody(faceName: string): void {
    const f = this.editedFeature();
    const id = this.bodyOfFace(faceName);
    if (f?.type !== 'combine' || !id) return;
    const body = (name: string): Ref => ({ kind: 'body', name });
    if (!f.main.name) return void this.execute({ type: 'setCombine', featureId: f.id, op: f.op, main: body(id), tools: f.tools.filter((x) => x.name !== id) });
    if (id === f.main.name) return;
    const tools = f.tools.some((x) => x.name === id) ? f.tools.filter((x) => x.name !== id) : [...f.tools, body(id)];
    this.execute({ type: 'setCombine', featureId: f.id, op: f.op, main: f.main, tools });
  }

  /** What the user says of a body (C7.1): its name, whether it is a reference body. */
  setBody(bodyId: Id, patch: { name?: string; reference?: boolean }): void {
    this.execute({ type: 'setBody', bodyId, ...patch });
  }

  /** Face list of a Delete Face (D2.1): clicking a face toggles it, as with the edges of a fillet. */
  toggleFace(ref: Ref): void {
    const f = this.editedFeature();
    if (f?.type !== 'deleteFace' || ref.kind !== 'face') return;
    const faces = f.faces.some((x) => x.name === ref.name) ? f.faces.filter((x) => x.name !== ref.name) : [...f.faces, ref];
    this.execute({ type: 'setFaces', featureId: f.id, faces, ...(f.hole ? { hole: true } : {}) });
  }

  /** The face a Move Face pushes: the planar face clicked in the graphics area. */
  setMoveFace(ref: Ref): void {
    const f = this.editedFeature();
    if (f?.type !== 'moveFace' || ref.kind !== 'face') return;
    if (ref.fingerprint?.type !== 'plane') return this.notify(t('edit.planeOnly'), 'error');
    this.execute({ type: 'setMoveFace', featureId: f.id, face: ref, distance: f.distance });
  }

  private enterSketch(sketch: SketchFeature, fresh: boolean): void {
    const frame = this.frameOf(sketch);
    if (!frame) {
      this.history.rollback();
      return this.notify(t('sketch.planeNotFound'), 'error');
    }
    this.sketcher = new SketchController(this.sketchHost(sketch.id));
    this.set({ editing: { featureId: sketch.id, kind: 'sketch' }, selected: sketch.id, selectedFace: null, selectedElements: [], sketchSolve: null, dimensionEdit: null });
    this.requestRebuild(); // the model up to the sketch
    this.requestSketchSolve();
    if (fresh) this.viewer?.lookAt(frame);
  }

  commitEdit(): void {
    const e = this.state.editing;
    if (!e) return;
    this.history.commit();
    this.leaveSession();
    // the last plain distance a person confirmed is what the next 「基準面」 and 「偏移草圖」 start from (ADR 0127)
    const f = findFeature(this.history.doc, e.featureId);
    if (f?.type === 'refPlane' && f.def.mode === 'offset' && f.def.distance.trim() !== '' && Number.isFinite(Number(f.def.distance))) this.setOptions({ datumOffset: f.def.distance.trim() });
    // 「偏移草圖」: the plane the session made is in the document now, so the sketch it promised follows it
    if (e.thenSketch) this.newSketch({ kind: 'datum', name: e.featureId });
  }

  cancelEdit(): void {
    if (!this.state.editing) return;
    this.history.rollback();
    this.leaveSession();
  }

  private leaveSession(): void {
    this.sketcher = null;
    this.modelSnap = [];
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
    if (f?.type === 'breakCorner') {
      const corners = f.corners.some((x) => x.name === ref.name) ? f.corners.filter((x) => x.name !== ref.name) : [...f.corners, ref];
      this.execute({ type: 'setBreakCorner', featureId: f.id, corners, kind: f.kind, size: f.size });
      return;
    }
    if (f?.type !== 'fillet' && f?.type !== 'chamfer') return;
    const exists = f.edges.some((x) => x.name === ref.name);
    const edges = exists ? f.edges.filter((x) => x.name !== ref.name) : [...f.edges, ref];
    this.execute({ type: 'setEdges', featureId: f.id, edges });
  }

  /** The kind of the fillet being edited: the groups of faces start empty (what they mean changes with the kind). */
  setFilletKind(kind: FilletKind): void {
    const f = this.editedFeature();
    if (f?.type !== 'fillet') return;
    this.set({ filletPick: 'faces' });
    this.execute({ type: 'setFilletSets', featureId: f.id, kind });
  }

  setFilletPick(group: FilletGroup): void {
    this.set({ filletPick: group });
  }

  /** A face picked for a face fillet or a full round fillet: put in the group that waits for it, or taken out when it is there. */
  toggleFilletGroupFace(ref: Ref): void {
    const f = this.editedFeature();
    if (f?.type !== 'fillet' || ref.kind !== 'face') return;
    const group = this.state.filletPick;
    const now = f[group] ?? [];
    const next = now.some((x) => x.name === ref.name) ? now.filter((x) => x.name !== ref.name) : [...now, ref];
    this.execute({ type: 'setFilletSets', featureId: f.id, kind: f.kind ?? 'constant', faces: f.faces, faces2: f.faces2, center: f.center, ...{ [group]: next } });
  }

  /** A face picked for a fillet or a chamfer (fillet and chamfer by face): toggled in its list, like an edge. */
  toggleEdgeFeatureFace(ref: Ref): void {
    const e = this.state.editing;
    if (!e || ref.kind !== 'face') return;
    const f = this.history.doc.features.find((x) => x.id === e.featureId);
    if (f?.type !== 'fillet' && f?.type !== 'chamfer') return;
    const faces = f.faces ?? [];
    const next = faces.some((x) => x.name === ref.name) ? faces.filter((x) => x.name !== ref.name) : [...faces, ref];
    this.execute({ type: 'setEdges', featureId: f.id, edges: f.edges, faces: next });
  }

  /** The feature of the PropertyManager session, as it is in the document now. */
  private editedFeature(): Feature | undefined {
    const e = this.state.editing;
    return e?.kind === 'feature' ? findFeature(this.history.doc, e.featureId) : undefined;
  }

  /** An element picked in the graphics area goes to the selection box of the feature being edited that takes its kind. */
  pick(ref: Ref): void {
    if (this.state.editing?.kind === 'sketch') return void this.convertPicked(ref);
    const f = this.editedFeature();
    if (f?.type === 'fillet' && f.kind && f.kind !== 'constant') this.toggleFilletGroupFace(ref);
    else if (f?.type === 'fillet' || f?.type === 'chamfer') (ref.kind === 'face' ? this.toggleEdgeFeatureFace(ref) : this.toggleEdge(ref));
    else if (f?.type === 'breakCorner' && ref.kind === 'edge') this.toggleEdge(ref);
    else if (f?.type === 'extrude') this.setUpToFace(ref);
    else if (f?.type === 'refPlane' || f?.type === 'refAxis' || f?.type === 'refPoint' || f?.type === 'coordSys' || f?.type === 'pattern' || f?.type === 'mirror') this.putDatumRef(ref);
    else if (f?.type === 'deleteFace') this.toggleFace(ref);
    else if (f?.type === 'shell') (this.state.shellPick === 'thickness' ? this.toggleShellWallFace(ref) : this.toggleShellFace(ref));
    else if (f?.type === 'draft') this.pickDraftFace(ref);
    else if (f?.type === 'moveFace') this.setMoveFace(ref);
    else if (f?.type === 'offsetSurface') this.toggleOffsetFace(ref);
    else if (f?.type === 'splitLine') this.setSplitFace(ref);
    else if (f?.type === 'trimSurface') this.setTrimFace(ref);
    else if (f?.type === 'mutualTrim' && ref.kind === 'face') this.toggleTrimPiece(ref.name);
    else if (f?.type === 'lipGroove') this.setLipFace(ref);
    else if (f?.type === 'edgeFlange' || f?.type === 'hem') this.setFlangeEdge(ref);
    else if (f?.type === 'fillSurface' || f?.type === 'flatSurface' || f?.type === 'extendSurface') this.toggleSurfaceEdge(ref);
    else if (f?.type === 'knit' && ref.kind === 'face') this.pickKnitBody(ref.name);
    else if ((f?.type === 'thicken' || f?.type === 'cutWithSurface') && ref.kind === 'face') this.pickSurfaceBody(ref.name);
    else if (f?.type === 'combine' && ref.kind === 'face') this.pickBody(ref.name);
  }

  /** The kind of element the feature being edited takes in a list, if it takes several at a time (a fillet's edges, the faces of a shell). */
  multiPickKind(): 'edge' | 'face' | null {
    const f = this.editedFeature();
    if (f?.type === 'fillet' && f.kind && f.kind !== 'constant') return 'face';
    if (f?.type === 'fillet' || f?.type === 'chamfer' || f?.type === 'breakCorner' || f?.type === 'fillSurface' || f?.type === 'flatSurface' || f?.type === 'extendSurface') return 'edge';
    if (f?.type === 'deleteFace' || f?.type === 'shell' || f?.type === 'draft' || f?.type === 'offsetSurface') return 'face';
    return null;
  }

  /**
   * Adds elements picked all at once — a loop, a chain of edges that continue one another, the faces that meet smoothly (D5.6) — to the list of the feature
   * being edited. Unlike a click nothing is toggled off: those already in the list stay.
   */
  pickMany(refs: Ref[]): void {
    const f = this.editedFeature();
    const more = (list: Ref[], kind: Ref['kind'], skip?: string) => [...list, ...refs.filter((r, i) => r.kind === kind && r.name !== skip && !list.some((x) => x.name === r.name) && refs.findIndex((q) => q.name === r.name) === i)];
    if (f?.type === 'fillet' && f.kind && f.kind !== 'constant') {
      const group = this.state.filletPick;
      this.execute({ type: 'setFilletSets', featureId: f.id, kind: f.kind, faces: f.faces, faces2: f.faces2, center: f.center, ...{ [group]: more(f[group] ?? [], 'face') } });
    } else if (f?.type === 'fillet' || f?.type === 'chamfer') this.execute({ type: 'setEdges', featureId: f.id, edges: more(f.edges, 'edge') });
    else if (f?.type === 'breakCorner') this.execute({ type: 'setBreakCorner', featureId: f.id, corners: more(f.corners, 'edge'), kind: f.kind, size: f.size });
    else if (f?.type === 'deleteFace') this.execute({ type: 'setFaces', featureId: f.id, faces: more(f.faces, 'face'), ...(f.hole ? { hole: true } : {}) });
    else if (f?.type === 'shell') this.execute({ type: 'setShell', featureId: f.id, faces: more(f.faces, 'face'), thickness: f.thickness, ...(f.outward ? { outward: true } : {}) });
    else if (f?.type === 'fillSurface' || f?.type === 'flatSurface' || f?.type === 'extendSurface') this.setSurfaceEdges(more(f.edges, 'edge').filter((r) => !r.name.includes(`${f.id}:`)));
    else if (f?.type === 'offsetSurface') this.execute({ type: 'setOffsetSurface', featureId: f.id, faces: more(f.faces, 'face', undefined).filter((r) => !r.name.startsWith(`${f.id}:`)), distance: f.distance, ...(f.join ? { join: f.join } : {}) });
    else if (f?.type === 'draft' && f.neutral.name) this.execute({ type: 'setDraftFeature', featureId: f.id, neutral: f.neutral, faces: more(f.faces, 'face', f.neutral.name), angle: f.angle, ...(f.reverse ? { reverse: true } : {}) });
  }

  /** A click in the FeatureManager selects; while a plane is being defined it picks a plane like SolidWorks' flyout tree. */
  treeClick(id: Id): void {
    const e = this.state.editing;
    if (e && e.kind === 'sketchPlane') {
      const ref = treeRef(this.history.doc, id);
      if (ref && (ref.kind === 'datum' || ref.kind === 'face')) {
        this.execute({ type: 'redefineSketchPlane', featureId: e.featureId, plane: ref });
        return;
      }
    }
    const f = this.editedFeature();
    const datum = f && id !== f.id && (f.type === 'refPlane' || f.type === 'refAxis' || f.type === 'refPoint' || f.type === 'coordSys' || f.type === 'pattern' || f.type === 'mirror') ? treeRef(this.history.doc, id) : null;
    if (datum && this.putDatumRef(datum)) return;
    this.select(id);
  }

  /**
   * What is clicked while reference geometry is being defined (C3.2–C3.5) goes to the first selection box that takes it (`datumSlots`).
   * Returns whether anything took it; an element nothing takes is left to the caller (a click in the tree selects).
   */
  putDatumRef(ref: Ref): boolean {
    const f = this.editedFeature();
    if (!f) return false;
    const result = put(f, this.history.doc, ref);
    if (!result) {
      this.notify(t('slot.notNeeded'), 'error');
      return false;
    }
    if ('message' in result) this.notify(result.message);
    else this.execute(result.command);
    return true;
  }

  /** 「成形至某一面」: the face picked in the graphics area ends the extrusion being edited. */
  setUpToFace(ref: Ref): void {
    const e = this.state.editing;
    const f = e ? findFeature(this.history.doc, e.featureId) : undefined;
    if (f?.type !== 'extrude') return;
    /** What a click puts into an end condition, or null when this one is not waiting for that kind of element. */
    const into = (d: EndCondition): EndCondition | null => {
      if ((d.type === 'upToFace' || d.type === 'offsetFromFace') && ref.kind === 'face') return { ...d, face: ref };
      if (d.type === 'upToVertex' && ref.kind === 'vertex') return { ...d, vertex: ref };
      const body = ref.kind === 'face' ? this.bodyOfFace(ref.name) : null;
      if (d.type === 'upToBody' && body) return { ...d, body: { kind: 'body', name: body } };
      return null;
    };
    const empty = (d: EndCondition) => (d.type === 'upToFace' || d.type === 'offsetFromFace' ? !d.face.name : d.type === 'upToVertex' ? !d.vertex.name : d.type === 'upToBody' ? !d.body.name : false);
    const dirs = (['dir1', 'dir2'] as const).flatMap((dir) => (f[dir] ? [{ dir, d: f[dir]! }] : [])).sort((a, b) => Number(empty(b.d)) - Number(empty(a.d)));
    for (const { dir, d } of dirs) {
      const value = into(d);
      if (value) return void this.execute({ type: 'setEndCondition', featureId: f.id, dir, value });
    }
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
    if (type === 'refPlane' || type === 'refAxis' || type === 'refPoint' || type === 'coordSys' || type === 'pattern' || type === 'mirror' || type === 'offsetSurface' || type === 'splitLine' || type === 'trimSurface' || type === 'mutualTrim' || type === 'knit' || type === 'fillSurface' || type === 'flatSurface' || type === 'extendSurface' || type === 'thicken' || type === 'cutWithSurface' || type === 'lipGroove') return i + 1;
    return type === 'fillet' || type === 'chamfer' || type === 'edgeFlange' || type === 'hem' || type === 'deleteFace' || type === 'moveFace' || type === 'shell' || type === 'draft' || type === 'combine' || type === 'sketch' ? i : undefined;
  }

  // ------------------------------------------------------------ sketch sessions (C1)

  /** 「草圖圖片」 (ADR 0116): a PNG or JPEG laid in the sketch being edited, 100 mm wide, its data kept in the document. */
  async addSketchPicture(): Promise<void> {
    const sketch = this.editedSketch();
    if (!sketch) return;
    try {
      const picked = await pickImageFile();
      if (!picked) return;
      await this.addPictureData(picked.name, picked.bytes);
    } catch (e) {
      this.notify(t('sketch.pictureFailed', { why: e instanceof Error ? e.message : String(e) }), 'error');
    }
  }

  /** The image data of a picture put into the sketch being edited; refused in words when the bytes are not a PNG or a JPEG. */
  async addPictureData(fileName: string, bytes: Uint8Array): Promise<boolean> {
    const sketch = this.editedSketch();
    if (!sketch) return false;
    const size = imageSize(bytes);
    if (!size) {
      this.notify(t('sketch.pictureNotImage', { name: fileName }), 'error');
      return false;
    }
    const sha256 = await sha256Hex(bytes);
    this.blobs.set(sha256, bytes);
    const ids = this.allocator();
    const doc = this.history.doc;
    const known = doc.blobs.find((b) => b.sha256 === sha256 && b.kind === size.type);
    const blob: BlobRef = known ?? { id: ids.take('blob'), sha256, kind: size.type, fileName };
    const picture = newPicture(ids.take('picture'), blob.id, size, 100);
    return this.execute({ type: 'addSketchPicture', featureId: sketch.id, blob, picture });
  }

  /** Moves, scales, turns or fades a picture of the sketch being edited. */
  setSketchPicture(pictureId: Id, patch: Partial<Omit<SketchPicture, 'id' | 'blob'>>): void {
    const sketch = this.editedSketch();
    if (sketch) this.execute({ type: 'setSketchPicture', featureId: sketch.id, pictureId, picture: patch });
  }

  removeSketchPicture(pictureId: Id): void {
    const sketch = this.editedSketch();
    if (!sketch) return;
    if (this.state.pictureScale?.pictureId === pictureId) this.set({ pictureScale: null });
    this.execute({ type: 'removeSketchPicture', featureId: sketch.id, pictureId });
  }

  /** Starts setting the scale of a picture from two points of it: the next two clicks in the sketch's plane are the points. */
  startPictureScale(pictureId: Id): void {
    this.set({ pictureScale: { pictureId, points: [] } });
  }

  cancelPictureScale(): void {
    if (this.state.pictureScale) this.set({ pictureScale: null });
  }

  /** A click in the plane while a picture's scale is being set: the first or the second point. */
  pictureScaleClick(p: [number, number]): void {
    const s = this.state.pictureScale;
    if (s && s.points.length < 2) this.set({ pictureScale: { ...s, points: [...s.points, p] } });
  }

  /** The two points are `distance` mm apart: the picture grows about the first point to make them so. */
  finishPictureScale(distance: number): void {
    const s = this.state.pictureScale;
    const picture = this.editedSketch()?.pictures?.find((p) => p.id === s?.pictureId);
    if (!s || !picture || s.points.length < 2) return;
    const next = calibratePicture(picture, s.points[0]!, s.points[1]!, distance);
    if (!next) return void this.notify(t('sketch.pictureScaleBad'), 'error');
    this.set({ pictureScale: null });
    this.setSketchPicture(picture.id, { x: next.x, y: next.y, width: next.width, height: next.height });
  }

  /** The sketch being edited, as it is in the document now. */
  editedSketch(): SketchFeature | null {
    const e = this.state.editing;
    const f = e?.kind === 'sketch' ? findFeature(this.history.doc, e.featureId) : undefined;
    return f?.type === 'sketch' ? f : null;
  }

  private requestSketchSolve(options: Omit<SketchSolveRequest, 'seq' | 'sketch'> = { analyze: true }): void {
    const sketch = this.editedSketch();
    // the solver only ever sees numbers: expressions are worked out here, with the whole document at hand
    if (sketch) this.sketchRunner.request({ seq: ++this.sketchSeq, sketch: resolveSketch(sketch, this.history.doc), ...options });
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
      trial: (sketch, doc) => this.api.solveSketch({ seq: -1, sketch: resolveSketch(sketch, doc ?? this.history.doc) }),
      notify: (text, kind) => this.notify(text, kind),
      editDimension: (id) => this.set({ dimensionEdit: id }),
      modelItems: () => this.modelSnap,
      snapSettings: () => this.state.options.snap,
    };
  }

  /**
   * A click on the model while a sketch is edited with 「轉換實體引用」 or 「貫穿」 (C1.18, C1.26): the edge (or the outline of the face) is
   * projected onto the sketch's plane by the worker, which has the model before the sketch, and added as entities that follow it.
   */
  private async convertPicked(ref: Ref): Promise<void> {
    const sketcher = this.sketcher;
    const sketch = this.editedSketch();
    const tool = sketcher?.getView().tool;
    if (!sketcher || !sketch || (tool !== 'convert' && tool !== 'pierce')) return;
    const mode = tool === 'pierce' ? 'pierce' : 'convert';
    if (ref.kind !== 'edge' && !(ref.kind === 'face' && mode === 'convert')) return;
    const r = await this.api.convertReferences({ sketchId: sketch.id, edges: ref.kind === 'edge' ? [ref] : [], faces: ref.kind === 'face' ? [ref] : [], mode });
    if (r.items.length > 0) sketcher.addReferences(r.items);
    if (r.errors.length > 0) this.notify(r.errors[0]!, r.items.length > 0 ? 'info' : 'error');
  }

  /** While a sketch is edited: asks the worker (which has the model before the sketch) for what the sketch can snap to on it. */
  private async refreshModelSnap(): Promise<void> {
    const e = this.state.editing;
    if (e?.kind !== 'sketch') {
      this.modelSnap = [];
      return;
    }
    try {
      const items = await this.api.sketchSnapItems(e.featureId);
      if (this.state.editing?.featureId === e.featureId) this.modelSnap = items;
    } catch {
      this.modelSnap = []; // snapping to the model is a convenience: a failure only takes it away
    }
  }

  /** The contours (closed regions) of a sketch as they are now, for 「所選輪廓」 (C1.34); none when the sketch cannot make a profile. */
  async sketchContours(sketchId: Id): Promise<ContourChoice[]> {
    const doc = this.history.doc;
    const sketch = findFeature(doc, sketchId);
    if (sketch?.type !== 'sketch') return [];
    const solved = await this.api.solveSketch({ seq: -1, sketch: resolveSketch(sketch, doc) });
    return solved.status === 'failed' ? [] : contourChoices(findProfiles(sketch, solved).regions);
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

  // ------------------------------------------------------------ the worker

  private startWorker(): void {
    this.worker = new Worker(new URL('../worker/kernel.worker.ts', import.meta.url), { type: 'module' });
    this.remote = Comlink.wrap<KernelApi>(this.worker);
  }

  /** Loads the geometry kernel in the worker, then gives it the language and the imported data (posted before any rebuild request). */
  private boot(locale: Locale): void {
    this.api.init().then(
      (bootMs) => this.set({ bootMs }),
      (e: unknown) => this.set({ bootError: e instanceof Error ? e.message : String(e) }),
    );
    void this.api.setLocale(locale);
    if (this.blobs.size > 0) void this.api.setBlobs(this.blobs);
  }

  /**
   * OCCT cannot be interrupted, and a few operations on some geometry run for minutes (a defeaturing of a small face
   * among B-spline neighbours did, on a real part). The worker is then replaced: the document is here, so nothing is
   * lost but the time. What the document asked for is left as it is for the user to undo.
   */
  private restartWorker(): void {
    this.worker.terminate();
    this.workerGeneration += 1;
    this.inFlight = false;
    this.pending = false;
    this.startWorker();
    this.sketchRunner.abandon();
    this.set({ bootMs: null, rebuilding: false });
    this.boot(getLocale());
  }

  /**
   * Hands the work to a fresh worker once this one's heap has grown past `HEAP_GROWTH_LIMIT` (A1b). The Emscripten heap never gives a byte back, and a
   * boolean on a B-spline operand leaks 2.5–8.3 MiB of it per call (AGENTS.md §3.5), so a threaded or knurled part edited a few dozen times would run the
   * kernel out of room mid-rebuild. The document is here, so replacing the worker costs only the time: the part is rebuilt in the new one, which is why
   * this is called after a result is shown rather than instead of one.
   */
  private recycleIfHeapHigh(result: RebuildPayload): void {
    if (!shouldRestartHeap(result.heapBytes, result.heapBase)) return;
    const mb = Math.round(((result.heapBytes ?? 0) - (result.heapBase ?? 0)) / 1048576);
    this.restartWorker();
    this.notify(t('worker.heapRecycled', { mb: String(mb) }), 'info');
    void this.run();
  }

  /**
   * 「關閉伺服器」 (dev only, ADR 0135): end the whole running system. The geometry kernel worker is terminated here (its
   * connection to this page is dropped), then the page asks the dev server to stop by POSTing to the shutdown path — a
   * request only `dev/shutdown.ts` answers, which closes the server and ends its process. Once that runs there is nothing
   * left to answer with, so the shutdown screen is shown here first; a fetch that fails is fine, it means the server is
   * already gone. In a production build the button is not rendered, so this is never called there.
   */
  async shutdown(): Promise<void> {
    if (this.state.shuttingDown) return;
    this.set({ shuttingDown: true });
    this.worker?.terminate();
    try {
      await fetch('/__3db/shutdown', { method: 'POST' });
    } catch {
      // The server closes the connection as it goes; a rejected fetch is the expected end of it, not a failure.
    }
  }

  // ------------------------------------------------------------ rebuild (B3.5: off the UI thread)

  /** 「重新計算」; in an assembly it reads the part files again, so changed parts show as they are now. */
  rebuild(): void {
    if (this.assembly) return this.assembly.reload();
    this.requestRebuild();
  }

  private requestRebuild(): void {
    if (this.inFlight) {
      // A rebuild that has run this long is probably stuck, and the document has changed since: do not wait for it.
      if (this.state.bootMs !== null && performance.now() - this.startedAt > REBUILD_SUSPECT_MS) {
        this.restartWorker();
        this.notify(t('worker.abandoned'), 'info');
      } else {
        this.pending = true;
        return;
      }
    }
    void this.run();
  }

  /**
   * The master files of the open part's derived bodies (C7.5), read from the project folder; none when it has no derived body or is not a file in the
   * project (the rebuild then says it cannot read the master).
   */
  private async masterFiles(doc: PartDoc): Promise<SourceFileData[] | undefined> {
    const project = this.project;
    const handle = this.fileHandle;
    if (!project || !handle || !doc.features.some((f) => f.type === 'derivedBody')) return undefined;
    try {
      const path = await pathIn(project, handle);
      if (path === null) return undefined;
      const { sources } = await gatherSources(project, path, doc);
      return sources;
    } catch {
      return undefined;
    }
  }

  /** The answer, or `StalledError` when the worker has taken longer than `rebuildLimitMs` once its kernel is loaded. */
  private withinLimit<T>(answer: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let waited = performance.now();
      let timer: ReturnType<typeof setTimeout>;
      const watch = () => {
        // loading the kernel (43 MB) is not the rebuild's time
        if (this.state.bootMs === null) waited = performance.now();
        if (performance.now() - waited >= this.rebuildLimitMs) reject(new StalledError());
        else timer = setTimeout(watch, Math.min(1000, this.rebuildLimitMs));
      };
      timer = setTimeout(watch, Math.min(1000, this.rebuildLimitMs));
      answer.then(
        (v) => (clearTimeout(timer), resolve(v)),
        (e) => (clearTimeout(timer), reject(e)),
      );
    });
  }

  private async run(): Promise<void> {
    const worker = this.workerGeneration;
    this.inFlight = true;
    this.startedAt = performance.now();
    const seq = ++this.seq;
    this.set({ rebuilding: true });
    try {
      const until = this.until();
      const doc = this.history.doc;
      const sources = await this.masterFiles(doc);
      const result = await this.withinLimit(this.api.rebuild({ seq, doc, ...(sources ? { sources } : {}), ...(until === undefined ? {} : { until }) }));
      if (worker !== this.workerGeneration) return; // the worker was replaced meanwhile: this is not an answer to use
      // A queued request supersedes this result: showing it would briefly contradict the current document.
      if (result.seq === this.seq && !this.pending) {
        this.set({ result });
        this.takePendingSketch();
        void this.refreshModelSnap();
        this.recycleIfHeapHigh(result);
      }
    } catch (e) {
      if (worker !== this.workerGeneration) return;
      if (e instanceof StalledError) {
        this.restartWorker();
        this.notify(t('worker.stalled', { seconds: Math.round(this.rebuildLimitMs / 1000) }), 'error');
      } else this.notify(t('rebuild.failed', { why: e instanceof Error ? e.message : String(e) }), 'error');
    } finally {
      if (worker === this.workerGeneration) {
        this.inFlight = false;
        if (this.pending) {
          this.pending = false;
          void this.run();
        } else {
          this.set({ rebuilding: false });
        }
      }
    }
  }

  // ------------------------------------------------------------ files (F1.1, F7.1, B9.1)

  /** The open document's name: its file's name once saved or opened, as SolidWorks shows it (see partName). */
  documentName(): string {
    if (this.assembly) return this.assembly.name();
    return partName(this.history.doc, this.state.fileName, this.state.untitled);
  }

  /** 「輸出 STEP」: an assembly is written as it is; a part first asks how (the schema, colors, a coordinate system). */
  exportStep(): void {
    if (this.assembly) void this.writeStep();
    else this.openDialog('stepOptions');
  }

  async writeStep(options: PartExportOptions = {}): Promise<void> {
    try {
      const name = this.documentName();
      const { text, warnings } = this.assembly ? await this.api.exportAssemblyStep(this.assembly.stepRequest()) : await this.api.exportStep(this.history.doc, name, options);
      download(stepFileName(name), text, 'application/step');
      this.notify(warnings.length > 0 ? `${t('export.done', { file: stepFileName(name) })} ${warnings.join('; ')}` : t('export.done', { file: stepFileName(name) }), warnings.length > 0 ? 'error' : 'info');
    } catch (e) {
      this.notify(t('export.failed', { what: 'STEP', why: e instanceof Error ? e.message : String(e) }), 'error');
    }
  }

  /** 「輸出 STL」 (F4.1): the bodies that count, as fine as the document's quality says. */
  async exportStl(): Promise<void> {
    try {
      const name = this.documentName();
      const bytes = await this.api.exportStl(this.history.doc, name);
      download(stlFileName(name), bytes as Uint8Array<ArrayBuffer>, 'model/stl');
      this.notify(t('export.done', { file: stlFileName(name) }));
    } catch (e) {
      this.notify(t('export.failed', { what: t('export.stlWhat'), why: e instanceof Error ? e.message : String(e) }), 'error');
    }
  }

  /** 「輸出影像」 (F3.3): what the graphics area shows, as a PNG. */
  async exportImage(): Promise<void> {
    try {
      const blob = await this.viewer?.snapshot();
      if (!blob) throw new Error(t('export.imageEmpty'));
      const name = this.documentName();
      download(imageFileName(name), blob, 'image/png');
      this.notify(t('export.done', { file: imageFileName(name) }));
    } catch (e) {
      this.notify(t('export.failed', { what: t('export.imageWhat'), why: e instanceof Error ? e.message : String(e) }), 'error');
    }
  }

  /** 「新零件」: an empty part with the default planes (B1.4). */
  newPart(): void {
    this.template = this.state.options.defaultTemplate;
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
    return this.drawing ? this.drawing.getState().dirty : this.assembly ? this.assembly.getState().dirty : this.state.dirty;
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
    if (action === 'open-part') return this.openPartFile();
    if (action === 'return-assembly') return this.reopenAssembly();
    if (action === 'import-step-assembly') return this.importStepAssemblyNow();
    if (action === 'new-assembly') {
      this.showAssembly({ doc: createEmptyAssembly(), handle: null, fileName: null, folder: '', untitled: t('doc.untitledAssembly', { n: ++this.untitledAssemblies }), project: this.project });
      // SolidWorks starts a new assembly in 「開始組合件」: the first thing to do is to insert a part.
      return void this.assembly!.startInsert();
    }
    if (action === 'new-demo') return this.load(createDemoPart(), null, null);
    const template = this.template;
    this.template = 'blank';
    this.load(createPartFromTemplate(template), null, null, new Map(), t('doc.untitledPart', { n: ++this.untitledCount }));
  }

  private async openFile(): Promise<void> {
    try {
      const picked = await pickFileToOpen(this.project ?? this.remembered);
      if (!picked) return;
      if (isStepFile(picked)) {
        // Like SolidWorks: a new, unsaved part named after the file, holding the imported body.
        this.load(createEmptyPart(), null, null, new Map(), picked.name.replace(/\.(step|stp)$/i, ''));
        return await this.importData(picked.name, picked.bytes);
      }
      const file = await readAnyDocumentFile(picked.bytes);
      if (file.kind === 'assembly') return await this.openAssembly(picked, file.doc);
      if (file.kind === 'drawing') return await this.openDrawing(picked, file.doc);
      // A file in the old format is never overwritten with the new one: its first save asks for a name.
      this.load(file.doc, file.format === '3dbx' ? picked.handle : null, picked.name, file.blobs);
      const notes = [...(file.format === 'json' ? [t('file.oldFormat')] : []), ...file.warnings];
      this.notify(notes.length ? t('file.openedNotes', { name: picked.name, notes: notes.join('; ') }) : t('file.opened', { name: picked.name }), file.warnings.length ? 'error' : 'info');
    } catch (e) {
      // After 「儲存」 in the unsaved-changes prompt the browser may refuse a second file dialog.
      if (e instanceof DOMException && (e.name === 'SecurityError' || e.name === 'NotAllowedError')) return this.notify(t('file.again'));
      this.notify(t('file.openFailed', { why: e instanceof Error ? e.message : String(e) }), 'error');
    }
  }

  /** 「輸入 STEP」 (F2.1): the file's solids become an imported body at the rollback bar, in one undoable step. */
  async importStep(): Promise<void> {
    try {
      const picked = await pickStepFile();
      if (picked) await this.importData(picked.name, picked.bytes);
    } catch (e) {
      this.notify(t('file.importFailed', { why: e instanceof Error ? e.message : String(e) }), 'error');
    }
  }

  /** 「輸入 STEP 組合件」 (F2.8): replaces the open document, so a modified one is asked about first. */
  importStepAssembly(): void {
    this.guard('import-step-assembly');
  }

  /**
   * 「從本體產生組合件」 (C7.5): each body of the open part, saved, becomes a derived part file next to it, and an assembly with a component for
   * each, in place and fixed, is written and opened. The derived parts read the saved file, so a part with changes is saved first. The user picks the
   * part's own folder (with write access; it is a click of its own), and nothing that is in it is touched.
   */
  async generateAssembly(): Promise<void> {
    try {
      const handle = this.fileHandle;
      const bodies = this.state.result?.bodies ?? [];
      if (this.assembly || !handle || this.state.dirty) return this.notify(t('derived.saveFirst'), 'error');
      if (bodies.length === 0) return this.notify(t('derived.noBodies'), 'error');
      const folder = await this.askForFolder(t('derived.askFolder', { name: handle.name, n: bodies.length }), true);
      if (!folder) return;
      const here = await folder.resolve(handle);
      if (!here || here.length !== 1) return this.notify(t('derived.notThatFolder', { name: handle.name }), 'error');
      const taken = (await listFiles(folder, [PART_FILE_EXTENSION, ASSEMBLY_FILE_EXTENSION])).files;
      const out = await derivedAssemblyFiles({ masterFile: handle.name, stem: partName(this.history.doc, this.state.fileName, this.state.untitled), bodies: bodies.map((b) => ({ id: b.id, name: b.name })), taken });
      await writeFilesInto(folder, out.files);
      this.useProject(folder);
      const main = await fileIn(folder, out.main);
      const bytes = await readBytes(main);
      const file = await readDocumentFile(bytes);
      if (file.kind === 'assembly') await this.openAssembly({ name: main.name, bytes, handle: main }, file.doc);
      this.notify(t('derived.done', { parts: bodies.length, folder: folder.name }));
    } catch (e) {
      if (e instanceof DOMException && (e.name === 'SecurityError' || e.name === 'NotAllowedError')) return this.notify(t('file.again'));
      this.notify(t('derived.failed', { why: e instanceof Error ? e.message : String(e) }), 'error');
    }
  }

  /**
   * A STEP file's structure becomes a project (F2.8): the file is read in the worker, the user picks a folder to write into (with write access; it
   * is a click of its own), the assembly, its sub-assemblies and one part file per part are written there without touching what is in it, and the
   * assembly is opened. A file that is one part opens as that part. Nothing is written when the file cannot be used.
   */
  private async importStepAssemblyNow(): Promise<void> {
    try {
      const picked = await pickStepFile();
      if (!picked) return;
      this.notify(t('stepasm.reading', { name: picked.name }));
      const plan = await this.api.readStepAssembly(picked.bytes);
      const parts = plan.prototypes.filter((p) => p.part).length;
      const folder = await this.askForFolder(t('stepasm.askFolder', { name: picked.name, parts, subs: plan.prototypes.filter((p) => p.children).length - 1 }), true);
      if (!folder) return;
      const taken = (await listFiles(folder, [PART_FILE_EXTENSION, ASSEMBLY_FILE_EXTENSION])).files;
      const out = await stepAssemblyFiles(plan, picked.name.replace(/\.(step|stp)$/i, ''), taken);
      await writeFilesInto(folder, out.files);
      this.useProject(folder);
      const handle = await fileIn(folder, out.main);
      const bytes = await readBytes(handle);
      const file = await readDocumentFile(bytes);
      if (file.kind === 'assembly') await this.openAssembly({ name: handle.name, bytes, handle }, file.doc);
      else this.load(file.doc, file.format === '3dbx' ? handle : null, handle.name, file.blobs);
      this.notify(t('stepasm.done', { name: picked.name, parts: out.parts, subs: out.subAssemblies, folder: folder.name }), out.warnings.length ? 'error' : 'info');
    } catch (e) {
      if (e instanceof DOMException && (e.name === 'SecurityError' || e.name === 'NotAllowedError')) return this.notify(t('file.again'));
      this.notify(t('stepasm.failed', { why: e instanceof Error ? e.message : String(e) }), 'error');
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
    const feature: ImportedBodyFeature = { id: ids.take('import'), type: 'importedBody', name: nextName(doc, t('feature.importName')), suppressed: false, blob: blob.id };
    if (this.execute({ type: 'importBody', blob, feature, index: doc.rollbackIndex ?? doc.features.length })) {
      this.set({ selected: feature.id, selectedFace: null, selectedElements: [], fitRequest: this.state.fitRequest + 1 });
      this.notify(t('file.imported', { name: fileName }));
    }
  }

  /** 「儲存檔案」: into the file the document came from; one never saved asks for a name. True when saved. */
  async save(): Promise<boolean> {
    if (this.drawing) return this.drawing.save();
    if (this.assembly) return this.assembly.save();
    return this.fileHandle ? this.write(this.fileHandle) : this.saveAs();
  }

  /** 「另存新檔」. True when saved. */
  async saveAs(): Promise<boolean> {
    if (this.drawing) return this.drawing.saveAs();
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
      this.notify(t('file.downloaded', { name }));
      return true;
    } catch (e) {
      this.notify(t('file.saveFailed', { why: e instanceof Error ? e.message : String(e) }), 'error');
      return false;
    }
  }

  private async write(handle: FileSystemFileHandle): Promise<boolean> {
    const doc = this.history.doc; // what is written, even if an edit lands while writing
    try {
      await writeFile(handle, await writePartFile(doc, this.blobs));
      this.saved(doc, handle, handle.name);
      this.notify(t('file.saved', { name: handle.name }));
      return true;
    } catch (e) {
      this.notify(t('file.saveFailed', { why: e instanceof Error ? e.message : String(e) }), 'error');
      return false;
    }
  }

  private saved(doc: PartDoc, handle: FileSystemFileHandle | null, fileName: string): void {
    this.fileHandle = handle;
    this.savedText = serializePart(doc);
    this.set({ fileName, dirty: serializePart(this.history.doc) !== this.savedText });
    void this.autosave.clear();
  }

  private load(doc: PartDoc, handle: FileSystemFileHandle | null, fileName: string | null, blobs = new Map<string, Uint8Array>(), untitled = this.state.untitled): void {
    this.closeAssembly();
    this.closeDrawing();
    if (this.state.editing) this.cancelEdit();
    this.history = new DocHistory(doc);
    this.history.subscribe(() => this.onDocChanged());
    this.lastDoc = null; // a new document is always rebuilt
    this.fileHandle = handle;
    this.blobs = blobs;
    void this.api.setBlobs(blobs); // posted before the rebuild request, so the worker has them first
    this.savedText = serializePart(doc);
    this.retainedMeasures = [];
    if (!this.state.recovery) void this.autosave.clear();
    this.set({ active: 'part', selected: null, selectedFace: null, selectedElements: [], result: null, pendingSketch: null, fileName, untitled, fitRequest: this.state.fitRequest + 1, documentSerial: this.state.documentSerial + 1, measure: null, draft: null, undercut: null, thickness: null, flat: null, interference: null, clearance: null, check: null });
    this.onDocChanged();
  }

  // ------------------------------------------------------------ drawings (B1.1, C16)

  private drawing: DrawingStore | null = null;

  /** The open drawing's store, for the components that show it. */
  get drawingStore(): DrawingStore | null {
    return this.drawing;
  }

  /** The drawing becomes the open document; the part (or assembly) is put away (one document at a time). */
  private showDrawing(source: DrawingSource): void {
    this.load(createEmptyPart(), null, null);
    this.returnFile = null;
    this.drawing = new DrawingStore(
      {
        api: this.api,
        changed: (drw) => this.set({ drw }),
        notify: (text, kind) => this.notify(text, kind),
        projectFolder: (reason) => this.projectFolder(reason),
      },
      source,
    );
    this.set({ active: 'drawing', drw: this.drawing.getState(), returnTo: null, documentSerial: this.state.documentSerial + 1, measure: null, draft: null, undercut: null, thickness: null, flat: null, interference: null, clearance: null, check: null });
  }

  private closeDrawing(): void {
    if (!this.drawing) return;
    this.drawing.close();
    this.drawing = null;
    this.set({ drw: null });
  }

  /**
   * 「新工程圖」 (C16.2): a drawing of the open part, with its front, top and right views, in the folder the part is in. The drawing reads the saved file, so a
   * part with changes is saved first. The scale is chosen once the lines of the views are known.
   */
  async newDrawing(): Promise<void> {
    try {
      const asm = this.state.active === 'assembly' ? this.assembly : null;
      const handle = asm ? asm.fileHandle() : this.fileHandle;
      const dirty = asm ? asm.getState().dirty : this.state.dirty;
      if (this.drawing || !handle || dirty) return this.notify(t('drawing.saveFirst'), 'error');
      const project = await this.projectFolder(t('drawing.askProject'));
      if (!project) return;
      const path = await pathIn(project, handle);
      if (path === null) return this.notify(t('drawing.notInProject', { folder: project.name }), 'error');
      if (asm) {
        // an assembly: its front and isometric views, with its parts list and balloons (C16.6)
        const title = asm.name();
        let drawing = createEmptyDrawing();
        // an empty sheet, as SolidWorks starts one (D-V2, ADR 0134): the views are placed by the user from the palette, the parts list added when wanted
        const source = baseName(path);
        drawing = applyDrawingCommand(drawing, { type: 'setTitle', field: 'drawingName', value: title });
        this.showDrawing({ doc: drawing, handle: null, fileName: null, folder: dirName(path), untitled: t('drawing.untitled', { name: title }), project, autoScale: true, paletteSource: source });
        return;
      }
      const part = this.history.doc;
      let doc = createEmptyDrawing();
      const name = partName(part, this.state.fileName, this.state.untitled);
      const source = baseName(path);
      // no views yet: the user chooses the main view and draws the others out of it (D-V2, ADR 0134); 「標準三視圖」 makes the three at once
      doc = applyDrawingCommand(doc, { type: 'setTitle', field: 'drawingName', value: name });
      if (part.material) doc = applyDrawingCommand(doc, { type: 'setTitle', field: 'material', value: part.material.name });
      this.showDrawing({ doc, handle: null, fileName: null, folder: dirName(path), untitled: t('drawing.untitled', { name }), project, autoScale: true, paletteSource: source });
    } catch (e) {
      this.notify(t('drawing.newFailed', { why: e instanceof Error ? e.message : String(e) }), 'error');
    }
  }

  /** A drawing file is opened inside a project folder that contains it: the parts its views show are found from there. */
  private async openDrawing(picked: OpenedFile, doc: DrawingDoc): Promise<void> {
    if (!picked.handle) return this.notify(foldersUnsupported(), 'error');
    let folder = this.project ?? (await this.rememberedWithAccess());
    let path = folder ? await pathIn(folder, picked.handle) : null;
    let reason = t('folder.askRefs', { name: picked.name });
    while (path === null) {
      folder = await this.askForFolder(reason);
      if (!folder) return;
      path = await pathIn(folder, picked.handle);
      reason = t('folder.askNotIn', { folder: folder.name, name: picked.name });
    }
    this.useProject(folder!);
    this.showDrawing({ doc, handle: picked.handle, fileName: picked.name, folder: dirName(path), untitled: t('drawing.untitled', { name: picked.name }), project: folder });
    this.notify(t('file.opened', { name: picked.name }));
  }

  // ------------------------------------------------------------ assemblies (B1.1, B9.4)

  /**
   * 「開啟零件」 (from the assembly's FeatureManager): the component's part file becomes the open
   * document, saved back into that file. The assembly is put away (one document at a time, 2026-09-28
   * decision), after 「要儲存變更嗎？」; 「返回組合件」 reopens it, with the parts as they are then.
   */
  openComponentPart(componentId: Id): void {
    const a = this.assembly;
    const path = a?.componentPath(componentId);
    if (!a || !path) return;
    if (a.getState().files.get(path)?.status === 'missing') return this.notify(t('file.partMissing'), 'error');
    this.partToOpen = path;
    this.guard('open-part');
  }

  /**
   * 「開啟零件」 on a view of the drawing (D-I7(a), ADR 0140), as SolidWorks's right-click 「開啟零件」: the part (or assembly) at the project path becomes the
   * open document; 「返回工程圖」 reopens the drawing, whose views then show the part as it was saved. A drawing with changes is asked about first; one never
   * saved has no file to come back to, which is said.
   */
  openPartOfDrawing(path: string): void {
    const drw = this.drawing;
    if (!drw) return;
    if (drw.getState().sources.get(path)?.status === 'missing') return this.notify(t('file.partMissing'), 'error');
    this.partToOpen = path;
    this.guard('open-part');
  }

  private async openPartFile(): Promise<void> {
    const path = this.partToOpen;
    this.partToOpen = null;
    const project = this.project;
    const from = this.assembly ?? this.drawing;
    if (!path || !project || !from) return;
    const kind = this.assembly ? ('assembly' as const) : ('drawing' as const);
    const back = from.file();
    const backTo = back ? { name: from.name(), kind } : null;
    try {
      const handle = await fileIn(project, path);
      const bytes = await readBytes(handle);
      const fileName = handle.name;
      const step = isStepFile({ name: fileName, bytes, handle });
      if (step) {
        // A STEP component opens as 「開啟舊檔」 opens STEP: a new part holding it, saved as a part file.
        this.load(createEmptyPart(), null, null, new Map(), fileName.replace(/\.(step|stp)$/i, ''));
        await this.importData(fileName, bytes);
      } else {
        const file = await readDocumentFile(bytes);
        if (file.kind === 'assembly') {
          // a sub-assembly (C15.4) opens as an assembly; 「返回組合件」 comes back to the one it was opened from
          await this.openAssembly({ name: fileName, bytes, handle }, file.doc);
          if (this.assembly?.file() === handle) {
            this.returnFile = back;
            this.set({ returnTo: backTo });
          }
          return;
        }
        if (file.kind !== 'part') throw new Error(t('file.notPart', { name: fileName }));
        this.load(file.doc, file.format === '3dbx' ? handle : null, fileName, file.blobs);
      }
      this.returnFile = back;
      this.set({ returnTo: backTo });
      const opened = step ? t('file.openedStep', { name: fileName }) : !back ? t('file.opened', { name: fileName }) : kind === 'drawing' ? t('file.openedBackDrawing', { name: fileName }) : t('file.openedBack', { name: fileName });
      // a drawing never saved has no file to come back to
      this.notify(kind === 'drawing' && !back ? `${opened}${t('file.noDrawingToReturn')}` : opened);
    } catch (e) {
      this.notify(t('file.openFailed', { why: e instanceof Error ? e.message : String(e) }), 'error');
    }
  }

  /** 「返回組合件」 (or 「返回工程圖」, D-I7): the assembly or drawing a part was opened from, read again with its parts as they are now. */
  returnToAssembly(): void {
    if (this.returnFile) this.guard('return-assembly');
  }

  private async reopenAssembly(): Promise<void> {
    const handle = this.returnFile;
    if (!handle) return;
    try {
      const file = await handle.getFile();
      const bytes = new Uint8Array(await file.arrayBuffer());
      const doc = await readAnyDocumentFile(bytes);
      if (doc.kind === 'drawing' && this.state.returnTo?.kind === 'drawing') return await this.openDrawing({ name: handle.name, bytes, handle }, doc.doc);
      if (doc.kind !== 'assembly') throw new Error(t('file.notAssembly', { name: handle.name }));
      await this.openAssembly({ name: handle.name, bytes, handle }, doc.doc);
    } catch (e) {
      this.notify(t('file.openFailed', { why: e instanceof Error ? e.message : String(e) }), 'error');
    }
  }

  /** The assembly becomes the open document; the part is put away (one document at a time). */
  private showAssembly(source: AssemblySource): void {
    this.load(createEmptyPart(), null, null);
    this.returnFile = null;
    this.assembly = new AssemblyStore(
      {
        api: this.api,
        changed: (asm) => this.set({ asm }),
        notify: (text, kind) => this.notify(text, kind),
        projectFolder: (reason) => this.projectFolder(reason),
      },
      source,
    );
    this.set({ active: 'assembly', asm: this.assembly.getState(), returnTo: null, documentSerial: this.state.documentSerial + 1, measure: null, draft: null, undercut: null, thickness: null, flat: null, interference: null, clearance: null, check: null });
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
    if (!picked.handle) return this.notify(foldersUnsupported(), 'error');
    let folder = this.project ?? (await this.rememberedWithAccess());
    let path = folder ? await pathIn(folder, picked.handle) : null;
    let reason = t('folder.askRefs', { name: picked.name });
    while (path === null) {
      folder = await this.askForFolder(reason);
      if (!folder) return; // nothing is opened; the current document stays
      path = await pathIn(folder, picked.handle);
      reason = t('folder.askNotIn', { folder: folder.name, name: picked.name });
    }
    this.useProject(folder!);
    this.showAssembly({ doc, handle: picked.handle, fileName: picked.name, folder: dirName(path), untitled: t('doc.untitledAssembly', { n: 1 }), project: folder });
    this.notify(t('file.opened', { name: picked.name }));
  }

  private async projectFolder(reason: string): Promise<FileSystemDirectoryHandle | null> {
    if (this.project) return this.project;
    const folder = (await this.rememberedWithAccess()) ?? (await this.askForFolder(reason));
    if (folder) this.useProject(folder);
    return folder;
  }

  /** 「更換資料夾…」 in the insert panel: the project folder stays until the user picks another one, so a new assembly can leave the one remembered. */
  async changeProjectFolder(): Promise<void> {
    const a = this.assembly;
    if (!a?.canChangeProject()) return;
    const folder = await this.askForFolder(t('folder.askChange'));
    if (!folder) return;
    this.useProject(folder);
    await a.setProject(folder);
  }

  /** The remembered folder, when the browser allows it without asking (the user chose 「每次造訪都允許」). */
  private async rememberedWithAccess(): Promise<FileSystemDirectoryHandle | null> {
    const folder = this.remembered;
    try {
      return folder && (await folderAccess(folder, false)) ? folder : null;
    } catch {
      return null;
    }
  }

  private useProject(folder: FileSystemDirectoryHandle): void {
    this.project = folder;
    this.remembered = null;
    this.set({ projectName: folder.name, rememberedProject: null });
    void rememberFolder(folder);
  }

  /** 「使用上次的資料夾」 in the project-folder dialog: the browser asks to allow reading it again. */
  async useRememberedFolder(): Promise<void> {
    const folder = this.remembered;
    if (!folder) return;
    try {
      if (await folderAccess(folder, true)) this.answerFolder(folder);
      else this.notify(t('folder.notAllowed', { name: folder.name }), 'error');
    } catch (e) {
      this.notify(t('folder.useFailed', { why: e instanceof Error ? e.message : String(e) }), 'error');
    }
  }

  /** Opens the project-folder dialog: the folder picker needs a click of its own, on the dialog's button. */
  private askForFolder(reason: string, write = false): Promise<FileSystemDirectoryHandle | null> {
    this.folderAnswer?.(null);
    return new Promise((resolve) => {
      this.folderAnswer = resolve;
      this.set({ folderRequest: reason, folderWrite: write });
    });
  }

  /** 「選擇資料夾…」 in the project-folder dialog. */
  async chooseFolder(): Promise<void> {
    try {
      const folder = await pickProjectFolder(this.state.folderWrite ? 'readwrite' : 'read');
      if (folder) this.answerFolder(folder);
    } catch (e) {
      this.notify(t('folder.chooseFailed', { why: e instanceof Error ? e.message : String(e) }), 'error');
    }
  }

  cancelFolder(): void {
    this.answerFolder(null);
  }

  private answerFolder(folder: FileSystemDirectoryHandle | null): void {
    const answer = this.folderAnswer;
    this.folderAnswer = null;
    this.set({ folderRequest: null, folderWrite: false });
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
  const drw = useStore((s) => s.drw);
  if (drw) return page(drw.doc).title.drawingName ?? drw.fileName?.replace(/\.3dbd$/i, '') ?? drw.untitled;
  return asm ? assemblyName(asm.fileName, asm.untitled) : partName(doc, fileName, untitled);
}

/** The document as a title bar shows it: file name (or its name if never saved), 「*」 when modified. */
export function useDocumentTitle(): string {
  const partFile = useStore((s) => s.fileName);
  const partDirty = useStore((s) => s.dirty);
  const asm = useStore((s) => s.asm);
  const drw = useStore((s) => s.drw);
  const name = useDocumentName();
  const [fileName, dirty] = drw ? [drw.fileName, drw.dirty] : asm ? [asm.fileName, asm.dirty] : [partFile, partDirty];
  return `${fileName ?? name}${dirty ? ' *' : ''}`;
}

const noSubscription = () => () => {};

/** Tool/selection state of the sketch being edited; null outside sketch sessions. */
export function useSketcherView(): ControllerView | null {
  useStore((s) => s.editing); // a new session brings a new controller
  const sketcher = store.sketcher;
  return useSyncExternalStore(sketcher ? sketcher.subscribe : noSubscription, () => sketcher?.getView() ?? null);
}
