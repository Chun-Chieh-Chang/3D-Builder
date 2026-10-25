import { PART_TEMPLATES, type PartTemplateId } from '@3db/model';
import { DEFAULT_SNAPS, parseSnapSettings, type SnapSettings } from '@3db/sketch/snaps';

/**
 * System options (D8.1): what belongs to this browser and the person using it, not to the part — kept in the browser like the shortcuts. The language
 * is one of them but has its own place (`LOCALE_KEY`), since the worker needs it before anything else.
 */
export interface SystemOptions {
  /** Keep a copy of a part with unsaved changes (B9.3). */
  autosave: boolean;
  /** How long after the last change the copy is made. */
  autosaveSeconds: number;
  /** What 「新零件」 makes (B1.4). */
  defaultTemplate: PartTemplateId;
  /** Which kinds of element the graphics area lets be picked (D5.4): model faces, edges and vertices, and the reference planes (ADR 0127). What 「選項」 sets takes effect at once and is kept for the next page. */
  pickFilter: { faces: boolean; edges: boolean; vertices: boolean; planes: boolean };
  /** Whether the graphics area shows the selection filter bar (ADR 0145; SolidWorks hides its Selection Filter toolbar until asked). */
  pickFilterBar: boolean;
  /** What 「基準面」 and 「偏移草圖」 put in 偏移距離 next time: the last plain number that was confirmed (ADR 0127). */
  datumOffset: string;
  /** The sketch snaps (D5.3c): 「啟用抓取」 and the choices under it. */
  snap: SnapSettings;
  automaticRelations: boolean;
  /** Reference grid in model and sketch viewports; independent of grid snapping. */
  showGrid: boolean;
  /** How far an arrow key (and Alt+Left/Right) turns the view, in degrees (SolidWorks: System Options > View > Arrow keys, 15 at first). */
  viewArrowStep: number;
  /** How far an arrow of the view cube turns or rolls the view, in degrees (FreeCAD's NaviCube: 8 steps a turn, 45 at first). */
  viewCubeStep: number;
}

export const AUTOSAVE_SECONDS = { min: 2, max: 600 } as const;
export const VIEW_ARROW_STEP = { min: 1, max: 90 } as const;

export const DEFAULT_OPTIONS: SystemOptions = {
  autosave: true,
  autosaveSeconds: 5,
  defaultTemplate: 'blank',
  pickFilter: { faces: true, edges: true, vertices: true, planes: true },
  pickFilterBar: false,
  datumOffset: '10',
  snap: DEFAULT_SNAPS,
  automaticRelations: true,
  showGrid: true,
  viewArrowStep: 15,
  viewCubeStep: 45,
};

const KEY = '3db.options';

/** A step of the view in degrees, within VIEW_ARROW_STEP; one that is not a number is the default. */
const angle = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(VIEW_ARROW_STEP.max, Math.max(VIEW_ARROW_STEP.min, v)) : fallback);

/** What was stored, taken as far as it can be trusted: a value that is missing or not what it should be is the default. */
export function parseOptions(raw: unknown): SystemOptions {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const seconds = typeof o.autosaveSeconds === 'number' && Number.isFinite(o.autosaveSeconds) ? o.autosaveSeconds : DEFAULT_OPTIONS.autosaveSeconds;
  const filter = o.pickFilter && typeof o.pickFilter === 'object' ? (o.pickFilter as Record<string, unknown>) : {};
  const on = (v: unknown) => (typeof v === 'boolean' ? v : true);
  return {
    autosave: typeof o.autosave === 'boolean' ? o.autosave : DEFAULT_OPTIONS.autosave,
    autosaveSeconds: Math.min(AUTOSAVE_SECONDS.max, Math.max(AUTOSAVE_SECONDS.min, Math.round(seconds))),
    defaultTemplate: PART_TEMPLATES.some((x) => x.id === o.defaultTemplate) ? (o.defaultTemplate as PartTemplateId) : DEFAULT_OPTIONS.defaultTemplate,
    pickFilter: { faces: on(filter.faces), edges: on(filter.edges), vertices: on(filter.vertices), planes: on(filter.planes) },
    pickFilterBar: typeof o.pickFilterBar === 'boolean' ? o.pickFilterBar : DEFAULT_OPTIONS.pickFilterBar,
    datumOffset: typeof o.datumOffset === 'string' && Number.isFinite(Number(o.datumOffset)) && o.datumOffset.trim() !== '' ? o.datumOffset.trim() : DEFAULT_OPTIONS.datumOffset,
    snap: parseSnapSettings(o.snap),
    showGrid: typeof o.showGrid === 'boolean' ? o.showGrid : DEFAULT_OPTIONS.showGrid,
    automaticRelations: typeof o.automaticRelations === 'boolean' ? o.automaticRelations : true,
    viewArrowStep: angle(o.viewArrowStep, DEFAULT_OPTIONS.viewArrowStep),
    viewCubeStep: angle(o.viewCubeStep, DEFAULT_OPTIONS.viewCubeStep),
  };
}

export function loadOptions(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): SystemOptions {
  try {
    const raw = storage?.getItem(KEY);
    return parseOptions(raw ? JSON.parse(raw) : {});
  } catch {
    return parseOptions({});
  }
}

export function saveOptions(options: SystemOptions, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(options));
  } catch {
    // no storage (a private window): the choice lasts until the page is closed
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
