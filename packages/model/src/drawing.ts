import { produce, type Draft } from 'immer';
import { t } from '@3db/i18n';
import { countersFor, type Id } from './ids';
import { CommandError } from './commands';
import { isFilePath, joinPath, relativePath } from './paths';

/**
 * The drawing document (B1.1, C16, Phase 5): the sheet, the title block, and the views of a part or an assembly. Only the design intent is stored — which file a
 * view shows, from which direction, at what scale, where it is on the sheet when the user put it there. The lines come from the model each time the drawing is
 * opened (exact hidden-line removal), so a drawing can never disagree with the model it shows.
 */

export const DRAWING_SCHEMA_VERSION = 1;

export type SheetSize = 'A4' | 'A3' | 'A2' | 'A1' | 'A0';
export const SHEET_SIZES: readonly SheetSize[] = ['A4', 'A3', 'A2', 'A1', 'A0'];

/** The views a drawing takes of a model: the six of the orthographic projection and the isometric. */
export type ViewName = 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right' | 'isometric';
export const VIEW_NAMES: readonly ViewName[] = ['front', 'back', 'top', 'bottom', 'left', 'right', 'isometric'];

/** A scale as `[n, d]`: n : d on the sheet, so [1, 2] is 1:2 (half size) and [2, 1] is 2:1. */
export type Scale = [number, number];

export interface DrawingSheet {
  size: SheetSize;
  orientation: 'landscape' | 'portrait';
  /** First angle (ISO, CNS): the top view below the front view. Third angle (ANSI): above. */
  projection: 'first' | 'third';
  scale: Scale;
}

export interface DrawingView {
  id: Id;
  name: string;
  /** The part (.3dbx), the assembly (.3dba) or the STEP file the view shows, relative to the drawing file. */
  source: string;
  direction: ViewName;
  /** Where the middle of the view's box is on the sheet (mm, from the lower left corner). Absent: the view is laid out with the others. */
  at?: [number, number];
  /** Its own scale. Absent: the sheet's. */
  scale?: Scale;
  /** Hidden lines are drawn (dashed). Absent: they are. */
  hidden?: boolean;
}

/** The fields of the title block (C16.1), by key; the names of them are the language's. */
export const TITLE_FIELDS = ['company', 'drawingName', 'drawingNo', 'material', 'drafter', 'date', 'revision', 'generalTolerance'] as const;
export type TitleField = (typeof TITLE_FIELDS)[number];

export interface DrawingDoc {
  kind: 'drawing';
  schemaVersion: number;
  sheet: DrawingSheet;
  title: Partial<Record<TitleField, string>>;
  views: DrawingView[];
  properties: Record<string, string>;
  idCounters: Record<string, number>;
}

export function createEmptyDrawing(): DrawingDoc {
  return {
    kind: 'drawing',
    schemaVersion: DRAWING_SCHEMA_VERSION,
    sheet: { size: 'A3', orientation: 'landscape', projection: 'first', scale: [1, 1] },
    title: {},
    views: [],
    properties: {},
    idCounters: {},
  };
}

export const drawingIdsInUse = (doc: DrawingDoc): Id[] => doc.views.map((v) => v.id);

export type DrawingCommand =
  /** Changes the sheet: its size, orientation, projection or scale (C16.1). */
  | { type: 'setSheet'; sheet: Partial<DrawingSheet> }
  /** Writes a field of the title block; an empty text takes it away (C16.1). */
  | { type: 'setTitle'; field: TitleField; value: string }
  /** Adds views at the end of the list (C16.2), each with its own new id. */
  | { type: 'insertViews'; views: DrawingView[] }
  /** Changes a view: what is given replaces what is there; `at: null` and `scale: null` take the choice back (the view is laid out again / uses the sheet's scale). */
  | { type: 'setView'; viewId: Id; patch: Partial<Omit<DrawingView, 'id' | 'at' | 'scale'>> & { at?: [number, number] | null; scale?: Scale | null } }
  | { type: 'deleteViews'; viewIds: Id[] };

/** Whether a scale is two whole numbers of 1 to 1000. */
export const scaleOk = (s: readonly number[]): boolean => s.length === 2 && s.every((n) => Number.isInteger(n) && n >= 1 && n <= 1000);

function viewOf(draft: Draft<DrawingDoc>, id: Id): Draft<DrawingView> {
  const v = draft.views.find((x) => x.id === id);
  if (!v) throw new CommandError(t('drawing.noView', { id }));
  return v;
}

function checkView(v: DrawingView): void {
  if (!v.id) throw new CommandError(t('drawing.idMissing'));
  if (!v.name.trim()) throw new CommandError(t('drawing.nameEmpty'));
  if (!isFilePath(v.source)) throw new CommandError(t('drawing.badSource', { path: v.source }));
  if (!VIEW_NAMES.includes(v.direction)) throw new CommandError(t('drawing.badDirection', { direction: String(v.direction) }));
  if (v.scale && !scaleOk(v.scale)) throw new CommandError(t('drawing.badScale', { scale: v.scale.join(':') }));
  if (v.at && !(v.at.length === 2 && v.at.every(Number.isFinite))) throw new CommandError(t('drawing.badPosition'));
}

/** Immer recipe: mutates the draft or throws CommandError, leaving the document untouched. */
export function mutateDrawing(draft: Draft<DrawingDoc>, cmd: DrawingCommand): void {
  switch (cmd.type) {
    case 'setSheet': {
      const s = cmd.sheet;
      if (s.size !== undefined && !SHEET_SIZES.includes(s.size)) throw new CommandError(t('drawing.badSheet', { size: String(s.size) }));
      if (s.orientation !== undefined && s.orientation !== 'landscape' && s.orientation !== 'portrait') throw new CommandError(t('drawing.badOrientation'));
      if (s.projection !== undefined && s.projection !== 'first' && s.projection !== 'third') throw new CommandError(t('drawing.badProjection'));
      if (s.scale !== undefined && !scaleOk(s.scale)) throw new CommandError(t('drawing.badScale', { scale: s.scale.join(':') }));
      Object.assign(draft.sheet, s);
      return;
    }
    case 'setTitle': {
      const value = cmd.value.trim();
      if (value === '') delete draft.title[cmd.field];
      else draft.title[cmd.field] = value;
      return;
    }
    case 'insertViews': {
      const inUse = new Set(drawingIdsInUse(draft as DrawingDoc));
      for (const v of cmd.views) {
        checkView(v);
        if (inUse.has(v.id)) throw new CommandError(t('drawing.idInUse', { id: v.id }));
        inUse.add(v.id);
      }
      for (const v of cmd.views) draft.views.push(v as Draft<DrawingView>);
      countersFor(cmd.views.map((v) => v.id), draft.idCounters);
      return;
    }
    case 'setView': {
      const v = viewOf(draft, cmd.viewId);
      const { at, scale, ...rest } = cmd.patch;
      const next = { ...(JSON.parse(JSON.stringify(v)) as DrawingView), ...rest };
      if (at === null) delete next.at;
      else if (at !== undefined) next.at = at;
      if (scale === null) delete next.scale;
      else if (scale !== undefined) next.scale = scale;
      checkView(next);
      for (const k of Object.keys(v)) delete (v as unknown as Record<string, unknown>)[k];
      Object.assign(v, next);
      return;
    }
    case 'deleteViews': {
      const ids = new Set(cmd.viewIds);
      for (const id of ids) viewOf(draft, id);
      countersFor(ids, draft.idCounters); // deleted ids are never handed out again
      draft.views = draft.views.filter((v) => !ids.has(v.id));
      return;
    }
  }
}

/** Applies a command to a drawing: a pure function, as for parts and assemblies. */
export function applyDrawingCommand(doc: DrawingDoc, cmd: DrawingCommand): DrawingDoc {
  return produce(doc, (draft) => mutateDrawing(draft, cmd));
}

/**
 * The direction each view looks along and which way is up on the sheet, in the model's axes (y up, the front plane's normal +z, as SolidWorks has them): the
 * front view looks from +z, the top from +y (the back of the part is at the top of the sheet), the right from +x (the front of the part is on its left).
 */
export function viewVectors(name: ViewName): { dir: [number, number, number]; up: [number, number, number] } {
  switch (name) {
    case 'front':
      return { dir: [0, 0, -1], up: [0, 1, 0] };
    case 'back':
      return { dir: [0, 0, 1], up: [0, 1, 0] };
    case 'top':
      return { dir: [0, -1, 0], up: [0, 0, -1] };
    case 'bottom':
      return { dir: [0, 1, 0], up: [0, 0, 1] };
    case 'right':
      return { dir: [-1, 0, 0], up: [0, 1, 0] };
    case 'left':
      return { dir: [1, 0, 0], up: [0, 1, 0] };
    case 'isometric':
      return { dir: [-1, -1, -1], up: [0, 1, 0] };
  }
}

/**
 * The same drawing seen from another folder: it was saved into `to` after its sources were written relative to `from` (both relative to the project folder),
 * so each source is rewritten to reach the same file from there.
 */
export function relocateDrawing(doc: DrawingDoc, from: string, to: string): DrawingDoc {
  if (from === to) return doc;
  return { ...doc, views: doc.views.map((v) => ({ ...v, source: relativePath(to, joinPath(from, v.source)) })) };
}

