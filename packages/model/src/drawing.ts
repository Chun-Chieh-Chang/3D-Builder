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

export const DRAWING_SCHEMA_VERSION = 2;

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

/** The side of a view another view is placed on, in the sheet. */
export type ViewSide = 'left' | 'right' | 'up' | 'down';

interface ViewCommon {
  id: Id;
  name: string;
  /** Where the middle of the view's box is on the sheet (mm, from the lower left corner). Absent: the view is laid out with the others. */
  at?: [number, number];
  /** Its own scale. Absent: the sheet's (a projected or section view: its parent's). */
  scale?: Scale;
  /** Hidden lines are drawn (dashed). Absent: they are, except in a section view. */
  hidden?: boolean;
}

/** A view of a model from one of the named directions (C16.2). */
export interface ModelDrawingView extends ViewCommon {
  kind?: 'model';
  /** The part (.3dbx) or the STEP file the view shows, relative to the drawing file. */
  source: string;
  direction: ViewName;
}

/** A view projected from another (C16.3): looking at the same model from the direction the side asks for, placed on that side and in line with the parent. */
export interface ProjectedDrawingView extends ViewCommon {
  kind: 'projected';
  parent: Id;
  side: ViewSide;
}

/**
 * A section (C16.3): the parent's model cut along a line drawn on the parent (a horizontal or vertical line, in the parent's view coordinates at full size), seen
 * from the side the arrows point to, which is the right of the line from its first point to its second, or the left with `flip`. The material on the
 * viewer's side of the cut is taken away and the cut faces are hatched.
 */
export interface SectionDrawingView extends ViewCommon {
  kind: 'section';
  parent: Id;
  line: [[number, number], [number, number]];
  flip?: boolean;
  /** The letter on the line and over the view: 「A」 for A–A. */
  label: string;
}

/** A detail (C16.3): the part of the parent's lines inside a circle (centre and radius in the parent's view coordinates at full size), enlarged. */
export interface DetailDrawingView extends ViewCommon {
  kind: 'detail';
  parent: Id;
  centre: [number, number];
  radius: number;
  label: string;
}

export type DrawingView = ModelDrawingView | ProjectedDrawingView | SectionDrawingView | DetailDrawingView;
export type DerivedDrawingView = Exclude<DrawingView, ModelDrawingView>;

export const isDerived = (v: DrawingView): v is DerivedDrawingView => v.kind !== undefined && v.kind !== 'model';

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
  | { type: 'setView'; viewId: Id; patch: ViewPatch }
  /** Deletes views, and the views projected or cut from them, which have nothing to show without them. */
  | { type: 'deleteViews'; viewIds: Id[] };

/** What `setView` may change: the fields every view has, and those of its kind; a field that does not belong to the view's kind is refused. */
export type ViewPatch = {
  name?: string;
  hidden?: boolean;
  at?: [number, number] | null;
  scale?: Scale | null;
  source?: string;
  direction?: ViewName;
  side?: ViewSide;
  flip?: boolean | null;
  label?: string;
  line?: SectionDrawingView['line'];
  centre?: [number, number];
  radius?: number;
};

/** Whether a scale is two whole numbers of 1 to 1000. */
export const scaleOk = (s: readonly number[]): boolean => s.length === 2 && s.every((n) => Number.isInteger(n) && n >= 1 && n <= 1000);

function viewOf(draft: Draft<DrawingDoc>, id: Id): Draft<DrawingView> {
  const v = draft.views.find((x) => x.id === id);
  if (!v) throw new CommandError(t('drawing.noView', { id }));
  return v;
}

const SIDES: readonly ViewSide[] = ['left', 'right', 'up', 'down'];

/** The view with this id among `views`. */
export const viewById = (views: readonly DrawingView[], id: Id): DrawingView | undefined => views.find((v) => v.id === id);

/** Checks a view against the views it may refer to (its parent has to be one of them, and not the view itself). */
function checkView(v: DrawingView, views: readonly DrawingView[]): void {
  if (!v.id) throw new CommandError(t('drawing.idMissing'));
  if (!v.name.trim()) throw new CommandError(t('drawing.nameEmpty'));
  if (v.scale && !scaleOk(v.scale)) throw new CommandError(t('drawing.badScale', { scale: v.scale.join(':') }));
  if (v.at && !(v.at.length === 2 && v.at.every(Number.isFinite))) throw new CommandError(t('drawing.badPosition'));
  if (!isDerived(v)) {
    if (!isFilePath(v.source)) throw new CommandError(t('drawing.badSource', { path: v.source }));
    if (!VIEW_NAMES.includes(v.direction)) throw new CommandError(t('drawing.badDirection', { direction: String(v.direction) }));
    return;
  }
  if (!viewById(views, v.parent) || v.parent === v.id) throw new CommandError(t('drawing.noParent', { id: v.parent }));
  if (v.kind === 'projected' && !SIDES.includes(v.side)) throw new CommandError(t('drawing.badSide', { side: String(v.side) }));
  if (v.kind === 'section') {
    const [[x0, y0], [x1, y1]] = v.line;
    if (![x0, y0, x1, y1].every(Number.isFinite) || Math.hypot(x1 - x0, y1 - y0) < 1e-9) throw new CommandError(t('drawing.badSectionLine'));
    if (Math.abs(x1 - x0) > 1e-9 && Math.abs(y1 - y0) > 1e-9) throw new CommandError(t('drawing.sectionAxisOnly'));
    if (!v.label.trim()) throw new CommandError(t('drawing.labelEmpty'));
  }
  if (v.kind === 'detail') {
    if (!v.centre.every(Number.isFinite) || !(v.radius > 0) || !Number.isFinite(v.radius)) throw new CommandError(t('drawing.badDetail'));
    if (!v.label.trim()) throw new CommandError(t('drawing.labelEmpty'));
  }
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
      const seen: DrawingView[] = [...(draft.views as DrawingView[])];
      for (const v of cmd.views) {
        checkView(v, seen);
        if (inUse.has(v.id)) throw new CommandError(t('drawing.idInUse', { id: v.id }));
        inUse.add(v.id);
        seen.push(v);
      }
      for (const v of cmd.views) draft.views.push(v as Draft<DrawingView>);
      countersFor(cmd.views.map((v) => v.id), draft.idCounters);
      return;
    }
    case 'setView': {
      const v = viewOf(draft, cmd.viewId);
      const { at, scale, flip, ...rest } = cmd.patch;
      const kind = v.kind ?? 'model';
      const belongs: Record<string, string[]> = { model: ['source', 'direction'], projected: ['side'], section: ['line', 'label'], detail: ['centre', 'radius', 'label'] };
      for (const k of Object.keys(rest)) if (!['name', 'hidden'].includes(k) && !belongs[kind]!.includes(k)) throw new CommandError(t('drawing.notForKind', { field: k, kind }));
      if (flip !== undefined && kind !== 'section') throw new CommandError(t('drawing.notForKind', { field: 'flip', kind }));
      const next = { ...(JSON.parse(JSON.stringify(v)) as DrawingView), ...rest } as DrawingView & { flip?: boolean; at?: [number, number]; scale?: Scale };
      if (at === null) delete next.at;
      else if (at !== undefined) next.at = at;
      if (scale === null) delete next.scale;
      else if (scale !== undefined) next.scale = scale;
      if (flip === null || flip === false) delete next.flip;
      else if (flip === true) next.flip = true;
      checkView(next, draft.views.filter((x) => x.id !== v.id) as DrawingView[]);
      for (const k of Object.keys(v)) delete (v as unknown as Record<string, unknown>)[k];
      Object.assign(v, next);
      return;
    }
    case 'deleteViews': {
      const ids = new Set(cmd.viewIds);
      for (const id of ids) viewOf(draft, id);
      // what is projected or cut from a deleted view goes with it, and so on down
      for (let grew = true; grew; ) {
        grew = false;
        for (const v of draft.views as DrawingView[]) if (isDerived(v) && ids.has(v.parent) && !ids.has(v.id)) grew = ids.add(v.id) && true;
      }
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
  return { ...doc, views: doc.views.map((v) => (isDerived(v) ? v : { ...v, source: relativePath(to, joinPath(from, v.source)) })) };
}

// ---------------------------------------------------------------- where a view looks from, and what a derived view shows

type V3 = [number, number, number];
// `+ 0` turns a negative zero into zero, so that the axes of a view compare and print as the plain numbers they are
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1] + 0, a[2] * b[0] - a[0] * b[2] + 0, a[0] * b[1] - a[1] * b[0] + 0];
const neg = (a: V3): V3 => [0 - a[0], 0 - a[1], 0 - a[2]];
const unit = (a: V3): V3 => {
  const n = Math.hypot(...a);
  return [a[0] / n + 0, a[1] / n + 0, a[2] / n + 0];
};

/** Where a view looks from: the direction it looks along and which way is up on the sheet. */
export interface ViewAxes {
  dir: V3;
  up: V3;
}

/** The sheet's x of a view: to the right of a viewer who looks along `dir` with `up` above. */
export const rightOf = (a: ViewAxes): V3 => unit(cross(a.dir, a.up));

const OPPOSITE: Record<ViewSide, ViewSide> = { left: 'right', right: 'left', up: 'down', down: 'up' };
export const oppositeSide = (s: ViewSide): ViewSide => OPPOSITE[s];

/**
 * The direction of a view projected from `parent` and placed on `side` of it (C16.3). Third angle: the viewer is on the side the view is placed on, so a view on the
 * right is the parent seen from its right; first angle: it is the other way round (the view on the right is the left view).
 */
export function projectedAxes(parent: ViewAxes, side: ViewSide, projection: DrawingSheet['projection']): ViewAxes {
  const s = projection === 'first' ? oppositeSide(side) : side;
  const r = rightOf(parent);
  switch (s) {
    case 'right':
      return { dir: neg(r), up: parent.up };
    case 'left':
      return { dir: r, up: parent.up };
    case 'up':
      return { dir: neg(parent.up), up: parent.dir };
    case 'down':
      return { dir: parent.up, up: neg(parent.dir) };
  }
}

/** The way the arrows of a section line point in the parent's sheet: to the right of the line from its first point to its second (the left with `flip`), by the nearer axis. */
export function sectionArrow(v: Pick<SectionDrawingView, 'line' | 'flip'>): ViewSide {
  const [[x0, y0], [x1, y1]] = v.line;
  const dx = x1 - x0;
  const dy = y1 - y0;
  // a vertical line (dx = 0) has the arrows horizontal; a horizontal line has them vertical; the right of (dx, dy) is (dy, -dx)
  const [ax, ay] = [dy, -dx];
  const side: ViewSide = Math.abs(ax) >= Math.abs(ay) ? (ax >= 0 ? 'right' : 'left') : ay >= 0 ? 'up' : 'down';
  return v.flip ? oppositeSide(side) : side;
}

/** The direction of a section view: it looks along the arrows. */
export function sectionAxes(parent: ViewAxes, arrow: ViewSide): ViewAxes {
  const r = rightOf(parent);
  switch (arrow) {
    case 'right':
      return { dir: r, up: parent.up };
    case 'left':
      return { dir: neg(r), up: parent.up };
    case 'up':
      return { dir: parent.up, up: neg(parent.dir) };
    case 'down':
      return { dir: neg(parent.up), up: parent.dir };
  }
}

/** The side of the parent a section view is placed on: third angle, the side the viewer is on (opposite the arrows); first angle, the arrows' side. */
export const sectionSide = (arrow: ViewSide, projection: DrawingSheet['projection']): ViewSide => (projection === 'first' ? arrow : oppositeSide(arrow));

/** The cutting plane of a section view: a point on it and its normal pointing toward the viewer (the side that is taken away). In the model's axes. */
export function sectionPlane(parent: ViewAxes, v: SectionDrawingView): { origin: V3; normal: V3 } {
  const r = rightOf(parent);
  const u = unit(parent.up);
  const [[x0, y0]] = v.line;
  const a = sectionAxes(parent, sectionArrow(v));
  return { origin: [x0 * r[0] + y0 * u[0], x0 * r[1] + y0 * u[1], x0 * r[2] + y0 * u[2]], normal: neg(a.dir) };
}

/** The file a view shows: that of the model view at the root of the views it is derived from; null when the chain is broken. */
export function sourceOf(views: readonly DrawingView[], view: DrawingView, depth = 0): string | null {
  if (!isDerived(view)) return view.source;
  const parent = viewById(views, view.parent);
  return parent && depth < 64 ? sourceOf(views, parent, depth + 1) : null;
}

/** Where a view looks from (resolved through its parents); null when its chain is broken. Detail views look as their parent does. */
export function axesOf(views: readonly DrawingView[], projection: DrawingSheet['projection'], view: DrawingView, depth = 0): ViewAxes | null {
  if (!isDerived(view)) return viewVectors(view.direction);
  const parent = viewById(views, view.parent);
  const base = parent && depth < 64 ? axesOf(views, projection, parent, depth + 1) : null;
  if (!base) return null;
  switch (view.kind) {
    case 'projected':
      return projectedAxes(base, view.side, projection);
    case 'section':
      return sectionAxes(base, sectionArrow(view));
    case 'detail':
      return base;
  }
}

