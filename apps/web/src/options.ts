import { PART_TEMPLATES, type PartTemplateId } from '@3db/model';

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
  /** Which kinds of element the graphics area starts out letting be picked (D5.4). */
  pickFilter: { faces: boolean; edges: boolean; vertices: boolean };
}

export const AUTOSAVE_SECONDS = { min: 2, max: 600 } as const;

export const DEFAULT_OPTIONS: SystemOptions = {
  autosave: true,
  autosaveSeconds: 5,
  defaultTemplate: 'blank',
  pickFilter: { faces: true, edges: true, vertices: true },
};

const KEY = '3db.options';

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
    pickFilter: { faces: on(filter.faces), edges: on(filter.edges), vertices: on(filter.vertices) },
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
