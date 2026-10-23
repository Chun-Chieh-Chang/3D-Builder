import { produce, type Draft } from 'immer';
import { LOCALES, t, type Locale } from '@3db/i18n';
import { countersFor, type Id } from './ids';
import { CommandError } from './commands';
import { isFilePath, joinPath, relativePath } from './paths';
import { parseFit } from './tolerance';
import type { Ref } from './schema';
import { ANNOTATION_FIELDS, checkAnnotation, framesUsing, type Annotation, type AnnotationPatch } from './drawingAnnotations';

/**
 * The drawing document (B1.1, C16, Phase 5): the sheet, the title block, and the views of a part or an assembly. Only the design intent is stored — which file a
 * view shows, from which direction, at what scale, where it is on the sheet when the user put it there. The lines come from the model each time the drawing is
 * opened (exact hidden-line removal), so a drawing can never disagree with the model it shows.
 */

export const DRAWING_SCHEMA_VERSION = 27;

export type SheetSize = 'A4' | 'A3' | 'A2' | 'A1' | 'A0';
export const SHEET_SIZES: readonly SheetSize[] = ['A4', 'A3', 'A2', 'A1', 'A0'];

/** The views a drawing takes of a model: the six of the orthographic projection, the isometric, and (v6) the flat pattern of a sheet metal part (not a direction: the unfolded part, in the plane of the sheet). */
export type ViewName = 'front' | 'back' | 'top' | 'bottom' | 'left' | 'right' | 'isometric' | 'flat';
export const VIEW_NAMES: readonly ViewName[] = ['front', 'back', 'top', 'bottom', 'left', 'right', 'isometric', 'flat'];

/** A scale as `[n, d]`: n : d on the sheet, so [1, 2] is 1:2 (half size) and [2, 1] is 2:1. */
export type Scale = [number, number];

export interface DrawingSheet {
  size: SheetSize;
  orientation: 'landscape' | 'portrait';
  /** First angle (ISO, CNS): the top view below the front view. Third angle (ANSI): above. */
  projection: 'first' | 'third';
  scale: Scale;
  /**
   * Where the user moved the views that are laid out together (v7): the whole arrangement is this far (mm) from where it would be centred in the area of the sheet. The
   * views that are in line with each other move as one; a view with a position of its own (`at`) does not.
   */
  shift?: [number, number];
  /** The unit the lengths of the dimensions are written in (v8): absent is millimetres; `in` is inches. The model and the sheet stay in millimetres; only the numbers written change. */
  unit?: 'mm' | 'in';
  /**
   * The language the texts on the sheet are written in (v11): absent is the interface's, which is what every drawing did before this. A sheet is not read
   * the way the program is: it leaves the program and goes to whoever machines the part, so 「最大」 or 「MAX」 has to be the drawing's choice and not the
   * reader's — the same drawing opened by two people must not come out with two different texts.
   */
  language?: Locale;
  /** How the dimensions are drawn (v19, ADR 0146): the drawing's own style, as SolidWorks's document properties have it. Absent: ISO's sizes (`DIM_STYLE_DEFAULT`). */
  dimStyle?: DimStyle;
  /** How the title block writes its texts (v20, ADR 0150): the three heights and whether a text too wide for its cell is drawn shrunk. Absent: ISO 7200's (`TITLE_STYLE_DEFAULT`). */
  titleStyle?: TitleStyle;
  /** The font chosen for PDF export (e.g. 'sans', 'kai', 'serif', 'fangsong', a system font name, or custom font file name). */
  pdfFont?: string;
}

/**
 * The end of a dimension line (v19, ADR 0146): a filled arrowhead (ISO 129-1's usual), an open one (two strokes), an oblique stroke (architectural), a dot, or
 * nothing.
 */
export type ArrowStyle = 'filled' | 'open' | 'tick' | 'dot' | 'none';
export const ARROW_STYLES: readonly ArrowStyle[] = ['filled', 'open', 'tick', 'dot', 'none'];

/**
 * How a dimension is drawn (v19, ADR 0146), in sheet millimetres: the height of its text, the length of its arrowheads, their kind, and the width of its lines.
 * The drawing has one (`sheet.dimStyle`); a dimension may have its own for any of them (`style`), the rest are the drawing's.
 */
export interface DimStyle {
  text?: number;
  arrow?: number;
  arrowStyle?: ArrowStyle;
  line?: number;
}

/** ISO 129-1 and 128-20 as this program has always drawn them: 3.5 mm text, 3 mm filled arrows, 0.25 mm thin lines. */
export const DIM_STYLE_DEFAULT: Required<DimStyle> = { text: 3.5, arrow: 3, arrowStyle: 'filled', line: 0.25 };

/** What each size of a dimension style may be (mm): ISO 3098's text heights run 1.8 to 20, ISO 128-20's line widths 0.13 to 2. */
export const DIM_STYLE_LIMITS = { text: [1, 20], arrow: [0.5, 20], line: [0.13, 2] } as const;

/** The style a dimension is drawn in: its own sizes over the drawing's, over ISO's. */
export const resolveDimStyle = (sheet: DimStyle | undefined, own?: DimStyle): Required<DimStyle> => ({ ...DIM_STYLE_DEFAULT, ...sheet, ...own });

/** Checks a dimension style: each size a finite number within its limits, the arrow one of the styles. Nothing is rounded or put in range: what is wrong is refused. */
function checkDimStyle(s: unknown): void {
  if (typeof s !== 'object' || s === null || Array.isArray(s)) throw new CommandError(t('drawing.badDimStyle'));
  for (const k of Object.keys(s)) if (!['text', 'arrow', 'arrowStyle', 'line'].includes(k)) throw new CommandError(t('drawing.badDimStyle'));
  const st = s as DimStyle;
  for (const k of ['text', 'arrow', 'line'] as const) {
    const v = st[k];
    if (v === undefined) continue;
    const [lo, hi] = DIM_STYLE_LIMITS[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new CommandError(t('drawing.dimStyleRange', { field: t(`drawing.dimStyleField.${k}`), min: String(lo), max: String(hi) }));
  }
  if (st.arrowStyle !== undefined && !ARROW_STYLES.includes(st.arrowStyle)) throw new CommandError(t('drawing.badArrowStyle', { style: String(st.arrowStyle) }));
}

/**
 * How the title block is written (v20, ADR 0150), in sheet millimetres: the height of a cell's field name, of the text it holds, of the drawing's own title
 * (the big cell), and whether a text wider than its cell is drawn shrunk to fit (`fit`, shrink-only). The drawing has one style (`sheet.titleStyle`).
 */
export interface TitleStyle {
  label?: number;
  value?: number;
  title?: number;
  fit?: boolean;
}

/** ISO 7200 as the title block has always been drawn here: 2.2 mm names, 3.5 mm values, a 6 mm title; a too-wide text is shrunk (ADR 0150). */
export const TITLE_STYLE_DEFAULT: Required<TitleStyle> = { label: 2.2, value: 3.5, title: 6, fit: true };

/** The outer box of each height (mm): what is still readable, and what the sums below leave room for. */
export const TITLE_STYLE_LIMITS = { label: [2, 5], value: [2, 5], title: [3, 9.5] } as const;

/**
 * The tallest the name and the text under it can sum to without touching (mm): the name hangs 0.8 mm below the cell's top and the value's baseline is 2.2 mm
 * (the title's 3.5 mm) above its bottom, so in ISO 7200's narrowest row — the 10 mm company cell — the name's baseline must stay at or above the value's cap.
 */
export const TITLE_STYLE_SUM_LIMITS = { labelPlusValue: 7, labelPlusTitle: 11.7 } as const;

/** The height each text of the title block is written at: the drawing's style over ISO 7200's. */
export const resolveTitleStyle = (sheet: TitleStyle | undefined): Required<TitleStyle> => ({ ...TITLE_STYLE_DEFAULT, ...sheet });

/**
 * Why a title style would be refused, in the user's language, or null when it is good: each height a finite number within its limits, `fit` a boolean, nothing
 * known outside them — and the name and the text under it summed small enough not to touch. Nothing is rounded or put in range. The panel asks this before sending
 * (ADR 0150) so a number that cannot be drawn never sits in the box looking as if it were.
 */
export function titleStyleProblem(s: unknown): string | null {
  if (typeof s !== 'object' || s === null || Array.isArray(s)) return t('drawing.badTitleStyle');
  for (const k of Object.keys(s)) if (!['label', 'value', 'title', 'fit'].includes(k)) return t('drawing.badTitleStyle');
  const st = s as TitleStyle;
  for (const k of ['label', 'value', 'title'] as const) {
    const v = st[k];
    if (v === undefined) continue;
    const [lo, hi] = TITLE_STYLE_LIMITS[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) return t('drawing.titleStyleRange', { field: t(`drawing.titleStyleField.${k}`), min: String(lo), max: String(hi) });
  }
  if (st.fit !== undefined && typeof st.fit !== 'boolean') return t('drawing.badTitleFit');
  const eff = resolveTitleStyle(st);
  const sum = eff.label + eff.value;
  if (sum > TITLE_STYLE_SUM_LIMITS.labelPlusValue) return t('drawing.titleStyleOverlap', { first: t('drawing.titleStyleField.label'), fh: String(eff.label), second: t('drawing.titleStyleField.value'), sh: String(eff.value), sum: String(sum), max: String(TITLE_STYLE_SUM_LIMITS.labelPlusValue) });
  const tsum = eff.label + eff.title;
  if (tsum > TITLE_STYLE_SUM_LIMITS.labelPlusTitle) return t('drawing.titleStyleOverlap', { first: t('drawing.titleStyleField.label'), fh: String(eff.label), second: t('drawing.titleStyleField.title'), sh: String(eff.title), sum: String(tsum), max: String(TITLE_STYLE_SUM_LIMITS.labelPlusTitle) });
  return null;
}

/** Checks a title style the way a command must: what is wrong is refused, with the reason the panel would have shown. */
function checkTitleStyle(s: unknown): void {
  const problem = titleStyleProblem(s);
  if (problem) throw new CommandError(problem);
}

/** The side of a view another view is placed on, in the sheet. */
export type ViewSide = 'left' | 'right' | 'up' | 'down';

/**
 * A corner of a view (v19, ADR 0146): a view projected off it at 45° is the isometric seen from that corner of the parent, as SolidWorks makes it when the
 * pointer is moved off a view on a slant. It is in line with nothing, so it has a place of its own (`at`).
 */
export type ViewCorner = 'upLeft' | 'upRight' | 'downLeft' | 'downRight';
export const VIEW_CORNERS: readonly ViewCorner[] = ['upLeft', 'upRight', 'downLeft', 'downRight'];
export const isCorner = (s: string): s is ViewCorner => (VIEW_CORNERS as readonly string[]).includes(s);

/**
 * How a view is drawn (v19, ADR 0146), SolidWorks's display styles: every edge as a visible line (`wireframe`), the hidden ones dashed (`hiddenVisible`), the
 * hidden ones left out (`hiddenRemoved`), the faces shaded under the visible lines (`shadedEdges`), the faces shaded alone (`shaded`).
 */
export type ViewDisplay = 'wireframe' | 'hiddenVisible' | 'hiddenRemoved' | 'shadedEdges' | 'shaded';
export const VIEW_DISPLAYS: readonly ViewDisplay[] = ['wireframe', 'hiddenVisible', 'hiddenRemoved', 'shadedEdges', 'shaded'];

/** How a view is drawn: as it says, else with its hidden lines dashed, except a section (where the cut shows what is inside). */
export const displayOf = (v: Pick<DrawingView, 'display' | 'kind'>): ViewDisplay => v.display ?? (v.kind === 'section' ? 'hiddenRemoved' : 'hiddenVisible');
export const isShaded = (d: ViewDisplay): boolean => d === 'shadedEdges' || d === 'shaded';

/**
 * A break view's band (B2.7): the strip of the view along `axis` between `from` and `to` is left out, and what lies beyond `to` is drawn `gap` nearer, so that a long
 * part is shown shorter — SolidWorks's break view. The two numbers are in the view's own coordinates at full size, the space a local section's cutting outline is
 * drawn in. What is shortened is the drawing, not the part: the dimensions on the view keep the model's numbers.
 */
export interface ViewBreak {
  axis: 'x' | 'y';
  from: number;
  to: number;
  /** The gap left between the two halves (mm, full size), where the break lines are drawn. Absent: `BREAK_GAP`. */
  gap?: number;
}

/** The gap a break leaves between the two halves when it asks for none (mm, full size): room for the break lines to be drawn in. */
export const BREAK_GAP = 2;

interface ViewCommon {
  id: Id;
  name: string;
  /** Where the middle of the view's box is on the sheet (mm, from the lower left corner). Absent: the view is laid out with the others. */
  at?: [number, number];
  /** Its own scale. Absent: the sheet's (a projected or section view: its parent's). */
  scale?: Scale;
  /**
   * How far (mm) the user slid the view along the line it is in line with the rest on (v7): the top and bottom views up and down, the left, right and back views sideways,
   * a projected or section view along its side. What is projected or cut from it goes with it. Not for the view that the others are arranged round, nor with `at`.
   */
  slide?: number;
  /** How it is drawn (v19, ADR 0146; before, `hidden: boolean`). Absent: `displayOf`'s default — hidden lines dashed, except in a section view. */
  display?: ViewDisplay;
  /** The centre marks of the circles and the centre lines of the cylinders are drawn (C16.5). Absent: they are, except in a section view. */
  centreMarks?: boolean;
  /**
   * The view is locked (B2.1): it keeps the place and the scale it had when it was locked, and moving or rescaling it is refused (the dimensions and
   * annotations on it stay editable). Absent: not locked. Locking gives the view the place it is drawn at now (its `at`), so it no longer follows the
   * arrangement's centring, the sheet's shift or the sheet's (or its parent's) scale.
   */
  locked?: boolean;
  /**
   * The edges of the view the user has hidden (B2.2): a straight edge or a circle of the part, by its persistent name (in a view of an assembly, with `in`
   * naming the part it is in), is not drawn in this view. The part may change: an edge the change keeps keeps its name and stays hidden. Absent: nothing
   * hidden. What a hidden edge's line is is what the view's own lines say: where several edges are one place on the sheet, it is the nearest of them,
   * as pointing at it is.
   */
  hiddenEdges?: DrawingRef[];
  /**
   * Whether the view draws its tangent edges (B2.3): the smooth edges where two faces meet tangentially (a fillet meeting a face, the seam of a cylinder).
   * Absent: they are drawn, as they were before the field — a drawing made earlier looks the same. `false` leaves them out.
   */
  showTangentEdges?: boolean;
  /**
   * A break (B2.7): the band of the view left out, so that a long part is shown shorter. Absent: the view is drawn whole. See `ViewBreak` — the dimensions on the
   * view keep the model's numbers, and the view takes the place and size of what is drawn (the band and the gap come off its box).
   */
  break?: ViewBreak;
}

/** A view of a model from one of the named directions (C16.2). */
export interface ModelDrawingView extends ViewCommon {
  kind?: 'model';
  /** The part (.3dbx) or the STEP file the view shows, relative to the drawing file. */
  source: string;
  direction: ViewName;
}

/**
 * A view projected from another (C16.3): looking at the same model from the direction the side asks for, placed on that side and in line with the parent; or,
 * off a corner (v19), the isometric from that corner, placed where it was put.
 */
export interface ProjectedDrawingView extends ViewCommon {
  kind: 'projected';
  parent: Id;
  side: ViewSide | ViewCorner;
}

/**
 * A section (C16.3): the parent's model cut along a line drawn on the parent (a horizontal or vertical line, in the parent's view coordinates at full size), seen
 * from the side the arrows point to, which is the right of the line from its first point to its second, or the left with `flip`. The material on the
 * viewer's side of the cut is taken away and the cut faces are hatched.
 */
export interface SectionDrawingView extends ViewCommon {
  kind: 'section';
  parent: Id;
  /**
   * The cutting line: two points for a straight section (any angle, D-I5). More points make a stepped section: its segments are in turn cuts along the first
   * segment's way and jogs square to it, the first and the last a cut. With `aligned`, three points: an aligned section (D-I5, ADR 0143).
   */
  line: [[number, number], [number, number], ...[number, number][]];
  flip?: boolean;
  /**
   * An aligned section (D-I5, ADR 0143): the first segment is cut where it is; what is behind the second is turned about the bend, square to the parent, into
   * the first segment's plane, so that the section shows both cuts in one plane (as through two holes of a flange).
   */
  aligned?: boolean;
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

/**
 * A closed outline drawn on a view (B1, B2.7): a rectangle, a circle, or a closed polygon, in the view's own coordinates at full size. A local
 * section cuts along one; a cropped view shows what is inside one. It must be closed and must not cross itself.
 */
export type ClosedOutline =
  | { kind: 'rectangle'; p0: [number, number]; p1: [number, number] }
  | { kind: 'circle'; centre: [number, number]; radius: number }
  | { kind: 'polygon'; points: [number, number][] };

/**
 * A local (partial) section (B1, D-I): only what lies inside a closed outline (rectangle, circle, polygon) drawn on the parent
 * view is cut; everything outside the outline is shown as an ordinary view. `depth` is how far the cut goes (mm); zero, negative,
 * or beyond the part is refused. The outline must be closed and non-self-intersecting. A local section may not serve as the parent
 * of any other view.
 */
export interface LocalSectionDrawingView extends ViewCommon {
  kind: 'sectionLocal';
  parent: Id;
  /** The closed cutting outline in the parent's view coordinates at full size. */
  outline: ClosedOutline;
  /** How deep the cut goes, mm. Must be positive and must actually reach the part. */
  depth: number;
  /** The letter on the outline and over the view: 「A」 for A–A. */
  label: string;
}

/**
 * A cropped view (B2.7): the part of its parent's view inside a closed outline, drawn as a view of its own so that a small region of a crowded
 * drawing can be set out on its own (SolidWorks's cropped view). Nothing is cut here — what the parent shows inside the outline is what this
 * shows, at the parent's scale. Its parent must be a local (partial) section: the region a partial section cuts out is what is usually wanted
 * apart. A cropped view is not shaded (its image is one picture of the whole view and cannot be cut at the outline).
 */
export interface CropDrawingView extends ViewCommon {
  kind: 'crop';
  parent: Id;
  /** The closed outline in the parent's view coordinates at full size; only what lies inside it is shown. */
  outline: ClosedOutline;
}

/**
 * An auxiliary view (B2.7): the model seen square to a fold line drawn on the parent (the arrows point to the right of the line from its first point to its
 * second, the left with `flip`), so that a slanted face of the part is shown true size. Nothing is cut — the material is all there; the fold line is drawn across
 * the parent with a letter at each end and the view carries the same letter (ISO 128-30). The view is placed on the side the arrows look away from (third
 * angle), as a section is, and looks along them.
 */
export interface AuxiliaryDrawingView extends ViewCommon {
  kind: 'auxiliary';
  parent: Id;
  /** The fold line on the parent, in the parent's view coordinates at full size: two points. The view looks square to it. */
  line: [[number, number], [number, number]];
  /** The arrows point to the right of the line from its first point to its second (the left with `flip`), as a section's. */
  flip?: boolean;
  /** The letter on the fold line and over the view: 「A」 for A–A. */
  label: string;
}

export type DrawingView = ModelDrawingView | ProjectedDrawingView | SectionDrawingView | DetailDrawingView | LocalSectionDrawingView | CropDrawingView | AuxiliaryDrawingView;
export type DerivedDrawingView = Exclude<DrawingView, ModelDrawingView>;

export const isDerived = (v: DrawingView): v is DerivedDrawingView => v.kind !== undefined && v.kind !== 'model';

/** The fields of the title block (C16.1), by key; the names of them are the language's. */
export const TITLE_FIELDS = ['company', 'drawingName', 'drawingNo', 'material', 'drafter', 'date', 'revision', 'generalTolerance'] as const;
export type TitleField = (typeof TITLE_FIELDS)[number];

// ---------------------------------------------------------------- dimensions (C16.4)

/**
 * An element a dimension points at. In a view of a part it is the part's (`Ref`); in a view of an assembly (v14, D-I2, ADR 0138) `in` says which part of it,
 * by the leaf's id ("comp2", "comp2/pa": the components gone through from the assembly down), and the element is that part's, put where the assembly has it.
 */
export type DrawingRef = Ref & { in?: string };

/**
 * The tolerance of a dimension: limits in mm (`upper` and `lower`, signed: 「+0.1/-0.05」, or 「±0.05」 when they are opposite), a class of ISO 286 (「H7」,
 * 「m6」) whose limits come from the table for the size the dimension has, or a one-sided limit written as a word: `max` (the number is the largest the
 * part may be, 「10 MAX」) or `min` (the smallest, 「10 MIN」). A one-sided limit bounds only one way and says nothing of the other — which is not the same
 * as limits with a zero deviation (「+0.1/0」 bounds both).
 */
export type DimensionTolerance = { type: 'bilateral'; upper: number; lower: number } | { type: 'fit'; fit: string } | { type: 'max' } | { type: 'min' };

interface DimensionCommon {
  id: Id;
  /** The view it is drawn on; the numbers are the model's, seen in that view. */
  view: Id;
  /** A reference dimension, written in parentheses: it is for information and is not what the part is made to. */
  reference?: boolean;
  tolerance?: DimensionTolerance;
  /** How the text is written (v8). Decimals of the number (0 to 4; absent: three for a size, two for an angle). */
  precision?: number;
  /** Written before and after what the dimension says (「最大」, 「2×」, 「(兩處)」), outside the parentheses of a reference dimension. */
  prefix?: string;
  suffix?: string;
  /** Written instead of all of it; `<DIM>` in it stands for what the dimension would have said (「約 <DIM>」). */
  text?: string;
  /** A linear or an angle dimension: how far (mm) its text was slid along the dimension line (along the arc, for an angle) from the middle (v8). */
  slide?: number;
  /** Its own text height, arrows or line width (v19, ADR 0146), over the drawing's `sheet.dimStyle`. */
  style?: DimStyle;
}

export type DimensionOrientation = 'horizontal' | 'vertical' | 'aligned';

/**
 * The distance between two elements of the model, measured in the view along its x axis (horizontal), its y axis (vertical) or between the two (aligned). An
 * element is a face, an edge or a vertex of the part the view shows, by persistent name: a plane stands for its place along the direction measured, a circular
 * edge or a cylinder for its axis, a vertex for itself. `offset` is how far the dimension line is from the view's box on the sheet (mm): above (horizontal) or
 * to the right (vertical) when positive, below or to the left when negative; for an aligned dimension, from the farther of the two points.
 */
export interface LinearDimension extends DimensionCommon {
  kind: 'linear';
  a: DrawingRef;
  b: DrawingRef;
  orientation: DimensionOrientation;
  offset: number;
  /**
   * Where `a` (or `b`) is a cylinder seen from the side (v13, D-I2, ADR 0138): the outline it is measured from, on the left (1) or the right (-1) of its axis as
   * the view sees it (left: the axis's direction turned a quarter counter-clockwise). Absent: the axis. A pin's diameter seen from the side is the distance
   * between its two outlines — one face, both sides.
   */
  aSide?: 1 | -1;
  bSide?: 1 | -1;
}

/** The diameter (Ø) of a cylinder or a circle seen as a circle in the view; `angle` is the direction of its leader on the sheet (degrees counter-clockwise from the x axis) and `count` how many equal ones it stands for (「4×Ø9」). */
export interface DiameterDimension extends DimensionCommon {
  kind: 'diameter';
  ref: DrawingRef;
  angle: number;
  /** How long the leader is outside the circle (mm, v8). Absent: 8. */
  leader?: number;
  count?: number;
  /** A hole callout (C16.5): what the model says of the hole is written after the diameter — through, or how deep, and its counterbore. */
  callout?: boolean;
  /** Absent keeps the legacy localized text. Formatting only; values come from the model. */
  calloutStyle?: CalloutStyle;
}

/** The radius (R) of a cylinder or circle seen as an arc or a circle in the view. */
export interface RadiusDimension extends DimensionCommon {
  kind: 'radius';
  ref: DrawingRef;
  angle: number;
  /** How long the leader is outside the circle (mm, v8). Absent: 8. */
  leader?: number;
  count?: number;
}

/**
 * The angle between two elements seen as lines in the view (an edge-on plane or a straight edge seen in its true direction): the angle the rays from where the two
 * lines meet to the middles of the elements enclose, drawn as an arc of radius `arc` (mm on the sheet) with arrows at its ends. `supplementary` takes the other
 * angle of the two lines (180° minus it), the one on the far side of the second element.
 */
export interface AngleDimension extends DimensionCommon {
  kind: 'angle';
  a: DrawingRef;
  b: DrawingRef;
  arc: number;
  supplementary?: boolean;
}

/**
 * Ordinate dimensions (v16, D-I4, ADR 0139): the distances of several elements from one origin along the view's x (`axis: 'x'`, their values written in a row
 * above or below the view) or its y (a column beside it), each on its own extension line, the origin written 0 — as SolidWorks and ISO 129-1 write the places of
 * holes. `offset` is how far the row is from the view's box, as a linear dimension's line is.
 */
export interface OrdinateDimension extends DimensionCommon {
  kind: 'ordinate';
  axis: 'x' | 'y';
  origin: DrawingRef;
  refs: DrawingRef[];
  offset: number;
}

/** The most elements one ordinate dimension measures. */
export const ORDINATE_MAX = 64;
/**
 * A chamfer dimension (v26, E5): notes a chamfer on an edge or slanted face.
 * `size` is the chamfer width/distance (mm).
 * `chamferAngle` is the chamfer angle (degrees, default 45).
 * `chamferFormat` is whether it is written as `C{size}` or `{size} × {chamferAngle}°` (default 'c').
 * `angle` is the leader angle (degrees counter-clockwise from x axis).
 * `leader` is the length of the leader (mm, default 8).
 * `count` is how many instances (e.g. 「2×C2」).
 */
export interface ChamferDimension extends DimensionCommon {
  kind: 'chamfer';
  ref: DrawingRef;
  angle: number;
  size: number;
  chamferAngle?: number;
  chamferFormat?: 'c' | 'distanceAngle';
  leader?: number;
  count?: number;
}

export type Dimension = LinearDimension | DiameterDimension | RadiusDimension | AngleDimension | OrdinateDimension | ChamferDimension;

/** The elements a dimension points at, in the order its facts are asked for (an ordinate's origin first). */
export const dimensionRefs = (d: Dimension): DrawingRef[] => (d.kind === 'linear' || d.kind === 'angle' ? [d.a, d.b] : d.kind === 'ordinate' ? [d.origin, ...d.refs] : [d.ref]);

/** What the model says an element is, worked out in the worker from the part as built: the point and direction a dimension measures from, in the part's frame. */
export interface ElementFacts {
  kind: 'face' | 'edge' | 'vertex';
  /** "plane", "cylinder", "sphere", "torus", "line", "circle", "point". */
  type: string;
  /** A vertex's place, a plane's origin, a cylinder's or circle's axis point (its middle), a line's middle, a torus's centre. */
  point: [number, number, number];
  /** A plane's normal, an axis, a line's direction. */
  dir?: [number, number, number];
  radius?: number;
  /**
   * A torus (a fillet or a round): the radius of the circle its tube's middle runs on, about `dir` through `point`. The `radius` of a torus is the tube's own, so a
   * fillet is dimensioned R<radius> — where it is seen in true shape (the axis across the view, not along it) the leader points at the arc whose middle is `major`
   * from `point` on the side it leans.
   */
  major?: number;
  /** A cylinder that is a hole: how deep it is. */
  hole?: HoleInfo;
  thread?: ThreadCallout;
  /** A face's middle (the centroid of its area): where on the plane the face is, which a plane's own `point` does not say. */
  center?: [number, number, number];
}

export type CalloutStyle = 'text' | 'symbols';

/** Evaluated cosmetic thread metadata, never inferred from helical topology. Lengths in mm. */
export interface ThreadCallout {
  majorDiameter: number;
  minorDiameter: number;
  pitch: number;
  depth: number;
  threadType: 'external' | 'internal';
  endCondition: 'blind' | 'through';
  /** Only standard-mode features carry a designation. Custom threads stay explicitly custom. */
  designation?: string;
}

/**
 * What the model says of a hole (a whole cylinder cut into the part): through or blind, its depth, the counterbore or the countersink at its mouth if it has one,
 * and, when the hole is a tapped one, the thread. The countersink is read from the shape (the cone at the mouth: its diameter and included angle in degrees); the
 * thread is not in the shape (the model drills to the tap size and has no thread), it comes from the feature that made the hole: `size` is its label (「M6」), absent
 * for one whose diameter was typed.
 */
export interface HoleInfo {
  through: boolean;
  /** mm: the length of the cylinder (the thickness a through hole goes through). */
  depth: number;
  counterbore?: { diameter: number; depth: number };
  countersink?: { diameter: number; angle: number };
  thread?: { size?: string; pitch?: number };
}

/**
 * What the model says of an element of a part, put where an assembly has the part (D-I2): `rows` is the placement, row-major 3 × 4 (`placementRows`, a mirror
 * included). Its points are moved and its directions turned; its sizes (radius, major, the hole) stay as they are.
 */
export function placeElementFacts(f: ElementFacts, rows: readonly number[]): ElementFacts {
  if (rows.length !== 12 || !rows.every(Number.isFinite)) throw new Error('placeElementFacts: a placement is 12 finite numbers');
  const R = rows;
  const put = (p: readonly number[]): [number, number, number] => [R[0]! * p[0]! + R[1]! * p[1]! + R[2]! * p[2]! + R[3]!, R[4]! * p[0]! + R[5]! * p[1]! + R[6]! * p[2]! + R[7]!, R[8]! * p[0]! + R[9]! * p[1]! + R[10]! * p[2]! + R[11]!];
  const turn = (v: readonly number[]): [number, number, number] => [R[0]! * v[0]! + R[1]! * v[1]! + R[2]! * v[2]!, R[4]! * v[0]! + R[5]! * v[1]! + R[6]! * v[2]!, R[8]! * v[0]! + R[9]! * v[1]! + R[10]! * v[2]!];
  return { ...f, point: put(f.point), ...(f.dir ? { dir: turn(f.dir) } : {}), ...(f.center ? { center: put(f.center) } : {}) };
}

/** What a dimension can be attached to in a view (the elements the view sees edge-on or as circles), found in the worker; the material of the automatic dimensions and of the choice in the panel. */
export type ViewFeature =
  /** A plane seen edge-on: a line across the view's x (`axis: 'x'`, at x = `coord`) or its y. */
  | { type: 'plane'; ref: Ref; axis: 'x' | 'y'; coord: number; area: number }
  /** A cylinder seen along its axis: a circle (a whole one, `full`, or an arc) with its middle in the view's coordinates and the direction (degrees) from there to the middle of the arc. */
  | { type: 'circle'; ref: Ref; centre: [number, number]; radius: number; convex: boolean; full: boolean; outward: number; hole?: HoleInfo; thread?: ThreadCallout }
  /** A whole cylinder seen from the side: its axis from one end to the other, in the view's coordinates. */
  | { type: 'axis'; ref: Ref; from: [number, number]; to: [number, number]; radius: number }
  /**
   * A fillet or a round — a torus — seen in its true shape: its axis lies *in* the sheet, so the view cuts its tube and what is drawn is the arc of the cut. This is
   * the other way round from a cylinder, which shows a circle only when its axis runs *along* the view.
   *
   * `centre` is the torus's own centre (a point on its axis) and `at` the middle of the arc drawn, which is `major` from `centre` on the side `outward` points to;
   * `radius` is the tube's, which is the R the drawing writes. `axis` is the torus's axis as the view sees it, so the facts can be built without asking the model.
   *
   * A fillet at a hole mouth is a whole ring, and the view cuts it **twice** — once either side of the axis — so one face gives two of these, both naming the same
   * face and the same R. They are their own kind and not a `circle` so that the automatic dimensions leave them alone (E1a): drafting a fillet's radius changes
   * what that button does, and that is a decision of its own.
   */
  | { type: 'torus'; ref: Ref; centre: [number, number]; at: [number, number]; radius: number; major: number; axis: [number, number]; convex: boolean; outward: number }
  /** A plane seen edge-on that is neither square to the view's x nor to its y (a slanted face): the middle of the face and the direction of the line it is seen as (a unit vector), in the view's coordinates. */
  | { type: 'slant'; ref: Ref; at: [number, number]; dir: [number, number]; area: number };

// ---------------------------------------------------------------- the edges and vertices of a view, by name (D-I2, ADR 0138)

/**
 * An edge of the model as a view sees it: its persistent name, its polyline in the view's coordinates (x to the right, y up, full size) with how near the viewer
 * each point is (`depth`, larger is nearer), and the names of its end vertices. A straight edge (`line`) or a circle seen in its true shape (`circle`, with its
 * middle and radius in the view) can be dimensioned; any other is there for its vertices. Whether it is seen at all is worked out against the view's lines.
 */
export interface ViewEdge {
  ref: DrawingRef;
  kind: 'line' | 'circle' | 'curve';
  points: number[];
  depth: number[];
  ends: [Ref | null, Ref | null];
  /** A circle seen as a circle: its middle and radius in the view's coordinates. */
  circle?: { centre: [number, number]; radius: number };
  /** A straight edge that lies in the plane of the sheet (seen in its true length and direction): only such an edge has an angle the view shows truly. */
  inPlane?: boolean;
}

/** A vertex of the model as a view sees it. */
export interface ViewVertex {
  ref: DrawingRef;
  at: [number, number];
  depth: number;
}

/** The edges and vertices of a part seen from a view, by name: what a dimension can be put on besides the planes and cylinders of `ViewFeature`. */
export interface ViewEdgeSet {
  edges: ViewEdge[];
  vertices: ViewVertex[];
}

// ---------------------------------------------------------------- tables (C16.6)

/**
 * A hole table (C16.6): every hole the view sees as a whole circle, with a tag (A1, A2, B1 … by size), where it is from the left and bottom planes of the
 * view, and its size (diameter, tolerance, through or deep). The tags are written beside the holes. `at` is the table's upper left corner on the sheet (absent:
 * the upper right corner of the drawing area); `fits` gives a class of tolerance (「H7」) to the holes of a diameter, by the diameter as written (「6」).
 */
export interface HoleTable {
  id: Id;
  kind: 'holes';
  view: Id;
  at?: [number, number];
  fits?: Record<string, string>;
}

/**
 * The parts list of the assembly a view shows (C16.6, C15.16), flat, as a table; with `balloons` each item also has its number in a circle by the part in the view
 * (C16.6), joined to the part by a leader. `at` is its upper left corner on the sheet (absent: the lower right corner of the drawing area, above the title block).
 */
export interface BomTable {
  id: Id;
  kind: 'bom';
  view: Id;
  at?: [number, number];
  balloons?: boolean;
  /** Where the user put the circle of a balloon, by item number: its centre on the sheet (mm). A balloon that is not here is placed by the program. */
  balloonAt?: Record<string, [number, number]>;
}

export type DrawingTable = HoleTable | BomTable;

// ---------------------------------------------------------------- surface finishes (C16.5)

/**
 * How a surface is to be made (ISO 1302): `basic` any method (the symbol alone), `machined` material is removed (a bar across the top of the V), `unmachined`
 * material is not removed (a circle in the V).
 */
export type SurfaceFinishKind = 'basic' | 'machined' | 'unmachined';
export const SURFACE_FINISH_KINDS: readonly SurfaceFinishKind[] = ['basic', 'machined', 'unmachined'];

/** The Ra values of ISO 1302 (µm) from 0.008 to 400; a drawing normally writes one of these. */
export const RA_MIN = 0.008;
export const RA_MAX = 400;

/**
 * A surface texture requirement (C16.5, ISO 1302): the symbol of a surface, with the mean roughness Ra (µm) and the method the surface is to be made by. The
 * point of the symbol is at `at` in the view's coordinates at full size and it leans away from the surface along `angle`. Unlike a dimension, which measures
 * an element of the model and so is tied to it by name, this is a note of how the part is made: it is placed on the sheet and stays where it was put.
 */
export interface SurfaceFinish {
  id: Id;
  /** The view it is drawn on; the numbers are that view's, as a dimension's are. */
  view: Id;
  /** The point of the symbol (the bottom of the V), in the view's coordinates at full size (mm). */
  at: [number, number];
  /** The direction the symbol leans away from the surface, degrees counter-clockwise from the view's x axis. Absent: 90 (up the sheet). */
  angle?: number;
  /** How the surface is made (ISO 1302). Absent: `machined` (the material is removed). */
  kind?: SurfaceFinishKind;
  /** The mean roughness Ra in micrometres (0.008 to 400); absent: the symbol alone, saying only how the surface is made. */
  ra?: number;
  /** The method the surface is made by, written over the bar after the Ra (「銑削」, 「磨削」). */
  method?: string;
  /** Written under the bar: a range of Ra, a treatment. */
  note?: string;
  /** How long the leader is from the point of the symbol to the surface it marks (mm on the sheet). Absent: 0 (the point is on the surface). */
  leader?: number;
}

/**
 * One sheet of a drawing (B2.8, ADR 0154): the sheet set-up and title block, and the views, dimensions, tables, surface finishes and notes drawn on it. A drawing
 * holds one or more pages; while there is only one, the rest of the program reads it through `page(doc)`.
 */
export interface DrawingPage {
  id: Id;
  /** The tab's name; empty is the default for its place (「圖頁 1」). */
  name: string;
  sheet: DrawingSheet;
  title: Partial<Record<TitleField, string>>;
  views: DrawingView[];
  dimensions: Dimension[];
  tables: DrawingTable[];
  surfaceFinishes: SurfaceFinish[];
  /** Notes, datum symbols, feature control frames and the centre lines put by hand (v12, D-I3, ADR 0132). */
  annotations: Annotation[];
}

export interface DrawingDoc {
  kind: 'drawing';
  schemaVersion: number;
  /** The sheets, first first. Exactly one until the page tabs arrive (B2.8, ADR 0154). */
  pages: DrawingPage[];
  properties: Record<string, string>;
  idCounters: Record<string, number>;
}

/** The page the program reads while a drawing holds one sheet (B2.8, ADR 0154). */
export const page = (doc: Pick<DrawingDoc, 'pages'>, index = 0): DrawingPage => doc.pages[index]!;

/** A drawing of one page: what the layout builds when it tries a scale or a place (B2.8, ADR 0154). */
export const drawingFromPage = (p: DrawingPage, properties: Record<string, string> = {}): DrawingDoc => ({ kind: 'drawing', schemaVersion: DRAWING_SCHEMA_VERSION, pages: [p], properties, idCounters: {} });

/** The same drawing with a page replaced (B2.8, ADR 0154). */
export const withPage = (doc: DrawingDoc, p: DrawingPage, index = 0): DrawingDoc => ({
  ...doc,
  pages: doc.pages.map((existing, i) => (i === index ? p : existing)),
});

/** All views across all pages in the drawing (B2.8 shape 2). */
export const allViews = (doc: Pick<DrawingDoc, 'pages'>): DrawingView[] => doc.pages.flatMap((p) => p.views);

export function createEmptyDrawing(): DrawingDoc {
  return {
    kind: 'drawing',
    schemaVersion: DRAWING_SCHEMA_VERSION,
    pages: [{ id: 'page1', name: '', sheet: { size: 'A3', orientation: 'landscape', projection: 'first', scale: [1, 1] }, title: {}, views: [], dimensions: [], tables: [], surfaceFinishes: [], annotations: [] }],
    properties: {},
    idCounters: {},
  };
}

export const drawingIdsInUse = (doc: DrawingDoc): Id[] =>
  doc.pages.flatMap((p) => [...p.views.map((v) => v.id), ...p.dimensions.map((d) => d.id), ...p.tables.map((x) => x.id), ...p.surfaceFinishes.map((f) => f.id), ...(p.annotations ?? []).map((a) => a.id)]);

export type DrawingCommand =
  /** Changes the sheet: its size, orientation, projection, scale or (`shift: null`: take it back) the shift of the arrangement (C16.1). */
  | { type: 'setSheet'; pageIndex?: number; pageId?: Id; sheet: Partial<Omit<DrawingSheet, 'shift' | 'language' | 'dimStyle' | 'titleStyle' | 'pdfFont'>> & { shift?: [number, number] | null; language?: Locale | null; dimStyle?: DimStyle | null; titleStyle?: TitleStyle | null; pdfFont?: string | null } }
  /** Writes a field of the title block; an empty text takes it away (C16.1). */
  | { type: 'setTitle'; pageIndex?: number; pageId?: Id; field: TitleField; value: string }
  /** Adds views at the end of the list (C16.2), each with its own new id. */
  | { type: 'insertViews'; pageIndex?: number; pageId?: Id; views: DrawingView[] }
  /** Changes a view: what is given replaces what is there; `at: null` and `scale: null` take the choice back (the view is laid out again / uses the sheet's scale). */
  | { type: 'setView'; viewId: Id; patch: ViewPatch }
  /** Deletes views, and the views projected or cut from them, which have nothing to show without them, and the dimensions drawn on them. */
  | { type: 'deleteViews'; viewIds: Id[] }
  /** Adds dimensions (C16.4), each with its own new id, on views that are there. */
  | { type: 'insertDimensions'; pageIndex?: number; pageId?: Id; dimensions: Dimension[] }
  /** Changes a dimension: what is given replaces what is there; `null` takes `reference`, `count` or `tolerance` away. A field that does not belong to its kind is refused. */
  | { type: 'setDimension'; dimensionId: Id; patch: DimensionPatch }
  | { type: 'deleteDimensions'; dimensionIds: Id[] }
  /** Adds tables (C16.6), each with its own new id, on views that are there. */
  | { type: 'insertTables'; pageIndex?: number; pageId?: Id; tables: DrawingTable[] }
  /** Changes a table: `at: null` puts it back in the corner; `fits` replaces the classes (an empty one takes them all away). */
  | { type: 'setTable'; tableId: Id; patch: { at?: [number, number] | null; fits?: Record<string, string>; balloons?: boolean | null; balloonAt?: Record<string, [number, number]> | null } }
  | { type: 'deleteTables'; tableIds: Id[] }
  /** Adds surface finishes (C16.5), each with its own new id, on views that are there. */
  | { type: 'insertSurfaceFinishes'; pageIndex?: number; pageId?: Id; finishes: SurfaceFinish[] }
  /** Changes a surface finish: what is given replaces what is there; `null` takes a field away. */
  | { type: 'setSurfaceFinish'; finishId: Id; patch: SurfaceFinishPatch }
  | { type: 'deleteSurfaceFinishes'; finishIds: Id[] }
  /** Adds annotations (D-I3): notes, datum symbols, feature control frames, centre lines and marks, each with its own new id, on views that are there. */
  | { type: 'insertAnnotations'; pageIndex?: number; pageId?: Id; annotations: Annotation[] }
  /**
   * Changes an annotation: what is given replaces what is there; `null` takes an optional field away. A datum's new letter goes into every frame that refers
   * to it, so that renaming a datum never leaves a frame pointing at nothing.
   */
  | { type: 'setAnnotation'; annotationId: Id; patch: AnnotationPatch }
  /** Deletes annotations; a datum that a frame which stays refers to is not deleted (the frame would point at nothing), and that is said. */
  | { type: 'deleteAnnotations'; annotationIds: Id[] }
  /** Inserts a new sheet/page (B2.8 shape 2). */
  | { type: 'insertPage'; page?: Partial<DrawingPage>; afterIndex?: number }
  /** Deletes a sheet/page (B2.8 shape 2). Refuses to delete the last page (Q4 Option A). */
  | { type: 'deletePage'; pageIndex?: number; pageId?: Id }
  /** Updates a page's properties (name, sheet, title) (B2.8 shape 2). */
  | { type: 'setPage'; pageIndex?: number; pageId?: Id; patch: { name?: string; sheet?: Partial<DrawingSheet>; title?: Partial<Record<TitleField, string>> } }
  /** Moves a view to another page, carrying all its dimensions and annotations along (B2.8 shape 2, Q5 Option A). */
  | { type: 'moveViewToPage'; viewId: Id; targetPageIndex: number; at?: [number, number] | null }
  /**
   * Several commands as one step (D-I1a, ADR 0130): what is done to everything chosen at once — the same tolerance on five dimensions, deleting what is chosen —
   * is undone at once, and is done wholly or not at all (the first that is refused refuses them all and leaves the document as it was). Not nested.
   */
  | { type: 'batch'; commands: DrawingCommand[] };

/** What `setSurfaceFinish` may change; `null` takes the field away (the symbol back to its default). */
export type SurfaceFinishPatch = {
  at?: [number, number];
  angle?: number | null;
  kind?: SurfaceFinishKind | null;
  ra?: number | null;
  method?: string | null;
  note?: string | null;
  leader?: number | null;
};

export type DimensionPatch = {
  reference?: boolean | null;
  tolerance?: DimensionTolerance | null;
  offset?: number;
  orientation?: DimensionOrientation;
  angle?: number;
  count?: number | null;
  callout?: boolean | null;
  calloutStyle?: CalloutStyle | null;
  /** An angle dimension: the radius of its arc (mm), and the other angle of the two lines. */
  arc?: number;
  precision?: number | null;
  prefix?: string | null;
  suffix?: string | null;
  text?: string | null;
  /** `null` (or 0) puts the text back in the middle. */
  slide?: number | null;
  /** A diameter or a radius: the length of the leader; `null` puts it back to 8. */
  leader?: number | null;
  supplementary?: boolean | null;
  a?: Ref;
  b?: Ref;
  ref?: Ref;
  /** An ordinate dimension (v16): the way it measures, its origin and what it measures. */
  axis?: 'x' | 'y';
  origin?: DrawingRef;
  refs?: DrawingRef[];
  /** Its own style (v19), replacing the one it had; `null` (or an empty one) and it is drawn in the drawing's. */
  style?: DimStyle | null;
  /** Toggles circular dimension between diameter and radius display format. */
  kind?: 'diameter' | 'radius';
  /** Chamfer dimension fields (v26, E5). */
  size?: number;
  chamferAngle?: number | null;
  chamferFormat?: 'c' | 'distanceAngle' | null;
};

/** What `setView` may change: the fields every view has, and those of its kind; a field that does not belong to the view's kind is refused. */
export type ViewPatch = {
  name?: string;
  /** `null` puts the view back to its kind's default. */
  display?: ViewDisplay | null;
  centreMarks?: boolean | null;
  at?: [number, number] | null;
  scale?: Scale | null;
  /** `null` (or 0) takes the slide back. */
  slide?: number | null;
  source?: string;
  direction?: ViewName;
  side?: ViewSide | ViewCorner;
  flip?: boolean | null;
  aligned?: boolean | null;
  label?: string;
  line?: SectionDrawingView['line'];
  centre?: [number, number];
  radius?: number;
  /** A local section's closed cutting outline. */
  outline?: LocalSectionDrawingView['outline'];
  /** A local section's cut depth (mm). */
  depth?: number;
  /** `true` locks the view (giving it the place and scale it is drawn at now), `null` unlocks it. */
  locked?: boolean | null;
  /** The edges the view hides (B2.2), replacing what is there; `null` shows them all again. */
  hiddenEdges?: DrawingRef[] | null;
  /** `false` leaves the view's tangent edges out (B2.3); `true` or `null` draws them (the default), so `null` takes the setting back. */
  showTangentEdges?: boolean | null;
  /** A break (B2.7): the band left out of the view; `null` takes it back (the view is drawn whole again). */
  break?: ViewBreak | null;
};

/** Whether a scale is two whole numbers of 1 to 1000. */
export const scaleOk = (s: readonly number[]): boolean => s.length === 2 && s.every((n) => Number.isInteger(n) && n >= 1 && n <= 1000);

function viewOf(draft: Draft<DrawingDoc>, id: Id): Draft<DrawingView> {
  for (const p of draft.pages) {
    const v = p.views.find((x) => x.id === id);
    if (v) return v;
  }
  throw new CommandError(t('drawing.noView', { id }));
}

function pageOfView(draft: Draft<DrawingDoc>, id: Id): { page: Draft<DrawingPage>; pageIndex: number; view: Draft<DrawingView> } {
  for (let i = 0; i < draft.pages.length; i++) {
    const p = draft.pages[i]!;
    const v = p.views.find((x) => x.id === id);
    if (v) return { page: p, pageIndex: i, view: v };
  }
  throw new CommandError(t('drawing.noView', { id }));
}

const SIDES: readonly ViewSide[] = ['left', 'right', 'up', 'down'];

/** The view with this id among `views`. */
export const viewById = (views: readonly DrawingView[], id: Id): DrawingView | undefined => views.find((v) => v.id === id);

/** Checks a break (B2.7): the band has to be one — an axis, two finite numbers with room between them, and a gap that is not negative. */
function checkBreak(b: ViewBreak): void {
  if (b.axis !== 'x' && b.axis !== 'y') throw new CommandError(t('drawing.badBreakAxis'));
  if (![b.from, b.to].every(Number.isFinite)) throw new CommandError(t('drawing.badBreak'));
  if (!(b.to - b.from > 0)) throw new CommandError(t('drawing.badBreak'));
  if (b.gap !== undefined && (!Number.isFinite(b.gap) || b.gap < 0)) throw new CommandError(t('drawing.badBreakGap'));
}

/** Checks a view against the views it may refer to (its parent has to be one of them, and not the view itself). */
function checkView(v: DrawingView, views: readonly DrawingView[]): void {
  if (!v.id) throw new CommandError(t('drawing.idMissing'));
  if (!v.name.trim()) throw new CommandError(t('drawing.nameEmpty'));
  if (v.break) checkBreak(v.break);
  if (v.scale && !scaleOk(v.scale)) throw new CommandError(t('drawing.badScale', { scale: v.scale.join(':') }));
  if (v.at && !(v.at.length === 2 && v.at.every(Number.isFinite))) throw new CommandError(t('drawing.badPosition'));
  if (v.slide !== undefined && !Number.isFinite(v.slide)) throw new CommandError(t('drawing.badPosition'));
  if (v.display !== undefined && !VIEW_DISPLAYS.includes(v.display)) throw new CommandError(t('drawing.badDisplay', { display: String(v.display) }));
  // the hidden edges (B2.2) are edges of the part, each by name, and (in a view of an assembly) the part it is in
  if (v.hiddenEdges !== undefined && (!Array.isArray(v.hiddenEdges) || v.hiddenEdges.some((e) => !e || e.kind !== 'edge' || typeof e.name !== 'string' || !e.name.trim() || (e.in !== undefined && (typeof e.in !== 'string' || !e.in.trim()))))) throw new CommandError(t('drawing.badHiddenEdge'));
  if ('hidden' in v) throw new CommandError(t('drawing.notForKind', { field: 'hidden', kind: v.kind ?? 'model' }));
  if (!isDerived(v)) {
    if (!isFilePath(v.source)) throw new CommandError(t('drawing.badSource', { path: v.source }));
    if (!VIEW_NAMES.includes(v.direction)) throw new CommandError(t('drawing.badDirection', { direction: String(v.direction) }));
    return;
  }
  if (!viewById(views, v.parent) || v.parent === v.id) throw new CommandError(t('drawing.noParent', { id: v.parent }));
  if (v.kind === 'projected') {
    if (!SIDES.includes(v.side as ViewSide) && !isCorner(v.side)) throw new CommandError(t('drawing.badSide', { side: String(v.side) }));
    // in line with nothing, a view off a corner is where it was put
    if (isCorner(v.side) && !v.at) throw new CommandError(t('drawing.cornerNeedsPlace'));
  }
  if (v.kind === 'section') {
    checkSectionLine(v);
    if (!v.label.trim()) throw new CommandError(t('drawing.labelEmpty'));
  }
  if (v.kind === 'detail') {
    if (!v.centre.every(Number.isFinite) || !(v.radius > 0) || !Number.isFinite(v.radius)) throw new CommandError(t('drawing.badDetail'));
    if (!v.label.trim()) throw new CommandError(t('drawing.labelEmpty'));
  }
  if (v.kind === 'sectionLocal') {
    if (!v.label.trim()) throw new CommandError(t('drawing.labelEmpty'));
    if (!(v.depth > 0) || !Number.isFinite(v.depth)) throw new CommandError(t('drawing.badLocalSectionDepth'));
    const p = views.find((x) => x.id === v.parent);
    if (!p) throw new CommandError(t('drawing.noParent', { id: v.parent }));
    if (p.kind === 'sectionLocal') throw new CommandError(t('drawing.localSectionNotFromLocal'));
    checkOutline(v.outline, 'drawing.badLocalSectionOutline');
  }
  if (v.kind === 'crop') {
    // a cropped view sets a cut region of a view apart, so what it crops must be the local section that cut it (B2.7)
    if (views.find((x) => x.id === v.parent)?.kind !== 'sectionLocal') throw new CommandError(t('drawing.cropNeedsLocalSection'));
    checkOutline(v.outline, 'drawing.badOutline');
  }
  if (v.kind === 'auxiliary') {
    // an auxiliary view is turned about one straight fold line (B2.7): two points, and the letter it is named by
    checkAuxiliaryFold(v.line);
    if (!v.label.trim()) throw new CommandError(t('drawing.labelEmpty'));
  }
}

/**
 * Checks a fold line: one straight line of two points that are numbers and are not the same point (a bend, or a line of no length, is no line to fold about).
 * It is checked here rather than by `checkSectionLine`, whose stepped-section wording would name the wrong feature to a user who drew a crooked fold line.
 */
function checkAuxiliaryFold(line: readonly (readonly number[])[] | undefined): void {
  const bad = (): never => {
    throw new CommandError(t('drawing.badAuxiliaryLine'));
  };
  if (!Array.isArray(line) || line.length !== 2) bad();
  const pts = line as readonly (readonly number[])[];
  for (const r of pts) if (!r || r.length !== 2 || !r.every((x) => typeof x === 'number' && Number.isFinite(x))) bad();
  const p = pts[0]!;
  const q = pts[1]!;
  if (Math.hypot(q[0]! - p[0]!, q[1]! - p[1]!) < 1e-9) bad();
}

/** Checks a closed outline (a local section's cutting outline, a cropped view's region): the shape it is and its numbers; it must be closed and not cross itself. */
function checkOutline(outline: ClosedOutline | undefined, bad: 'drawing.badLocalSectionOutline' | 'drawing.badOutline'): void {
  const ok = (): never => {
    throw new CommandError(t(bad));
  };
  if (!outline) ok();
  if (!outline) return;
  if (outline.kind === 'polygon') {
    const pts = outline.points;
    if (!pts || pts.length < 3) ok();
    for (const q of pts) if (!q || q.length !== 2 || !q.every((x) => typeof x === 'number' && Number.isFinite(x))) ok();
    // closed: first and last must coincide
    const first = pts[0]!; const last = pts[pts.length - 1]!;
    if (Math.abs(first[0] - last[0]) > 1e-9 || Math.abs(first[1] - last[1]) > 1e-9) ok();
    // no segment of zero length
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!; const b = pts[i + 1]!;
      if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) ok();
    }
  }
  if (outline.kind === 'circle') {
    if (!(outline.radius > 0) || !Number.isFinite(outline.radius)) ok();
  }
  if (outline.kind === 'rectangle') {
    const [p0, p1] = [outline.p0, outline.p1];
    if (!p0 || !p1 || p0.length !== 2 || p1.length !== 2 || !p0.every((x) => typeof x === 'number' && Number.isFinite(x)) || !p1.every((x) => typeof x === 'number' && Number.isFinite(x))) ok();
  }
}

/** How far from square or from parallel the segments of a stepped line may be (unit vectors' dot products): the cuts must be parallel to the view to be hatched. */
const SQUARE = 1e-9;

/**
 * Checks a section's line (D-I5): points that are numbers, no segment of no length; a stepped line's segments in turn along the first and square to it, its
 * first and last a cut; an aligned line three points whose two segments are not in line.
 */
function checkSectionLine(v: Pick<SectionDrawingView, 'line' | 'aligned'>): void {
  const pts = v.line as unknown;
  if (!Array.isArray(pts) || pts.length < 2 || !pts.every((p) => Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === 'number' && Number.isFinite(x)))) {
    throw new CommandError(t('drawing.badSectionLine'));
  }
  const line = pts as [number, number][];
  const dirs = line.slice(1).map((q, i) => {
    const p = line[i]!;
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len < 1e-9) throw new CommandError(t('drawing.badSectionLine'));
    return [(q[0] - p[0]) / len, (q[1] - p[1]) / len] as const;
  });
  const t0 = dirs[0]!;
  if (v.aligned) {
    if (line.length !== 3) throw new CommandError(t('drawing.sectionAlignedThree'));
    const t1 = dirs[1]!;
    // in line (either way) is no bend to turn about: one degree at least
    if (Math.abs(t0[0] * t1[1] - t0[1] * t1[0]) < Math.sin(Math.PI / 180)) throw new CommandError(t('drawing.sectionAlignedStraight'));
    return;
  }
  if (line.length === 2) return;
  if (dirs.length % 2 === 0) throw new CommandError(t('drawing.sectionStepEnds'));
  dirs.forEach((d, i) => {
    const dot = d[0] * t0[0] + d[1] * t0[1];
    const ok = i % 2 === 0 ? dot > 1 - SQUARE : Math.abs(dot) < SQUARE;
    if (!ok) throw new CommandError(t('drawing.sectionStepSquare', { n: i + 1 }));
  });
}

const ORIENTATIONS: readonly DimensionOrientation[] = ['horizontal', 'vertical', 'aligned'];
const isRefValue = (r: unknown): r is DrawingRef =>
  typeof r === 'object' &&
  r !== null &&
  typeof (r as Ref).name === 'string' &&
  (r as Ref).name !== '' &&
  ['face', 'edge', 'vertex'].includes((r as Ref).kind) &&
  // the part of an assembly it is in: a leaf's id, never empty
  ((r as DrawingRef).in === undefined || (typeof (r as DrawingRef).in === 'string' && (r as DrawingRef).in !== ''));

/** Checks a dimension against the views it may be drawn on and what its kind needs. */
function checkDimension(d: Dimension, views: readonly DrawingView[]): void {
  if (!d.id) throw new CommandError(t('drawing.idMissing'));
  if (!viewById(views, d.view)) throw new CommandError(t('drawing.dimNoView', { id: String(d.view) }));
  if (d.kind === 'linear') {
    if (!isRefValue(d.a) || !isRefValue(d.b)) throw new CommandError(t('drawing.dimBadRef'));
    if (!ORIENTATIONS.includes(d.orientation)) throw new CommandError(t('drawing.dimBadOrientation', { orientation: String(d.orientation) }));
    if (!Number.isFinite(d.offset) || d.offset === 0) throw new CommandError(t('drawing.dimBadOffset'));
    for (const [side, r] of [[d.aSide, d.a], [d.bSide, d.b]] as const) {
      if (side === undefined) continue;
      if (side !== 1 && side !== -1) throw new CommandError(t('drawing.dimBadSide'));
      // an outline is a cylinder's, which is a face
      if (r.kind !== 'face') throw new CommandError(t('drawing.dimBadSide'));
    }
    // one face measured to itself is a distance only between its two outlines
    if (d.a.kind === d.b.kind && d.a.name === d.b.name && !(d.aSide !== undefined && d.bSide !== undefined && d.aSide !== d.bSide)) throw new CommandError(t('drawing.dimSameElement'));
  } else if (d.kind === 'angle') {
    if (!isRefValue(d.a) || !isRefValue(d.b) || d.a.kind === 'vertex' || d.b.kind === 'vertex') throw new CommandError(t('drawing.dimBadRef'));
    if (!Number.isFinite(d.arc) || !(d.arc > 0)) throw new CommandError(t('drawing.dimBadArc'));
    // an angle has no size for an ISO 286 fit to come from, so it takes limits or a one-sided limit, never a fit
    if (d.tolerance && d.tolerance.type === 'fit') throw new CommandError(t('drawing.dimAngleFit'));
  } else if (d.kind === 'diameter' || d.kind === 'radius') {
    if (!isRefValue(d.ref) || d.ref.kind === 'vertex') throw new CommandError(t('drawing.dimBadRef'));
    if (!Number.isFinite(d.angle)) throw new CommandError(t('drawing.dimBadAngle'));
    if (d.count !== undefined && !(Number.isInteger(d.count) && d.count >= 2)) throw new CommandError(t('drawing.dimBadCount'));
    if (d.kind === 'radius' && (d as { callout?: boolean }).callout) throw new CommandError(t('drawing.notForKind', { field: 'callout', kind: d.kind }));
  } else if (d.kind === 'ordinate') {
    if (d.axis !== 'x' && d.axis !== 'y') throw new CommandError(t('drawing.dimBadOrientation', { orientation: String(d.axis) }));
    if (!isRefValue(d.origin) || !Array.isArray(d.refs) || d.refs.length === 0 || !d.refs.every(isRefValue)) throw new CommandError(t('drawing.dimBadRef'));
    if (d.refs.length > ORDINATE_MAX) throw new CommandError(t('drawing.ordinateTooMany', { max: String(ORDINATE_MAX) }));
    if (!Number.isFinite(d.offset) || d.offset === 0) throw new CommandError(t('drawing.dimBadOffset'));
    // the same element twice, or the origin measured from itself, says nothing
    const key = (r: DrawingRef) => `${r.kind}|${r.name}|${r.in ?? ''}`;
    const all = [d.origin, ...d.refs].map(key);
    if (new Set(all).size !== all.length) throw new CommandError(t('drawing.ordinateTwice'));
    if (d.tolerance?.type === 'fit') throw new CommandError(t('drawing.ordinateFit'));
  } else if (d.kind === 'chamfer') {
    if (!isRefValue(d.ref) || d.ref.kind === 'vertex') throw new CommandError(t('drawing.dimBadRef'));
    if (!Number.isFinite(d.angle)) throw new CommandError(t('drawing.dimBadAngle'));
    if (!Number.isFinite(d.size) || d.size <= 0) throw new CommandError(t('drawing.dimBadOffset'));
    if (d.chamferAngle !== undefined && (!Number.isFinite(d.chamferAngle) || d.chamferAngle <= 0 || d.chamferAngle >= 90)) throw new CommandError(t('drawing.dimBadAngle'));
    if (d.chamferFormat !== undefined && d.chamferFormat !== 'c' && d.chamferFormat !== 'distanceAngle') throw new CommandError(t('drawing.dimBadKind', { kind: String(d.chamferFormat) }));
    if (d.count !== undefined && !(Number.isInteger(d.count) && d.count >= 2)) throw new CommandError(t('drawing.dimBadCount'));
  } else throw new CommandError(t('drawing.dimBadKind', { kind: String((d as { kind?: unknown }).kind) }));
  const calloutStyle = (d as DiameterDimension).calloutStyle;
  if (calloutStyle !== undefined && (d.kind !== 'diameter' || !['text', 'symbols'].includes(calloutStyle))) throw new CommandError(t('drawing.dimBadCalloutStyle'));
  if (d.precision !== undefined && !(Number.isInteger(d.precision) && d.precision >= 0 && d.precision <= 4)) throw new CommandError(t('drawing.dimBadPrecision'));
  for (const k of ['prefix', 'suffix', 'text'] as const) if (d[k] !== undefined && (typeof d[k] !== 'string' || d[k]!.length > 80)) throw new CommandError(t('drawing.dimBadText'));
  if (d.slide !== undefined && (!Number.isFinite(d.slide) || (d.kind !== 'linear' && d.kind !== 'angle'))) throw new CommandError(t('drawing.dimBadSlide'));
  if ((d.kind === 'diameter' || d.kind === 'radius' || d.kind === 'chamfer') && d.leader !== undefined && !(Number.isFinite(d.leader) && d.leader > 0)) throw new CommandError(t('drawing.dimBadLeader'));
  if (d.style !== undefined) checkDimStyle(d.style);
  const tol = d.tolerance;
  if (tol) {
    if (tol.type === 'bilateral') {
      if (!Number.isFinite(tol.upper) || !Number.isFinite(tol.lower) || tol.upper < tol.lower) throw new CommandError(t('drawing.dimBadLimits'));
    } else if (tol.type === 'fit') {
      if (!parseFit(tol.fit)) throw new CommandError(t('drawing.dimBadFit', { fit: String(tol.fit) }));
    } else if (tol.type !== 'max' && tol.type !== 'min') throw new CommandError(t('drawing.dimBadLimits'));
  }
}

/** Checks a table against the views it may be on. */
function checkTable(x: DrawingTable, views: readonly DrawingView[]): void {
  if (!x.id) throw new CommandError(t('drawing.idMissing'));
  if (x.kind !== 'holes' && x.kind !== 'bom') throw new CommandError(t('drawing.tableBadKind', { kind: String((x as { kind?: unknown }).kind) }));
  if (!viewById(views, x.view)) throw new CommandError(t('drawing.dimNoView', { id: String(x.view) }));
  if (x.at && !(x.at.length === 2 && x.at.every(Number.isFinite))) throw new CommandError(t('drawing.badPosition'));
  if (x.kind === 'bom' && (x as { fits?: unknown }).fits) throw new CommandError(t('drawing.notForKind', { field: 'fits', kind: x.kind }));
  if (x.kind === 'holes' && (x as { balloons?: unknown }).balloons !== undefined) throw new CommandError(t('drawing.notForKind', { field: 'balloons', kind: x.kind }));
  if (x.kind === 'holes' && (x as { balloonAt?: unknown }).balloonAt !== undefined) throw new CommandError(t('drawing.notForKind', { field: 'balloonAt', kind: x.kind }));
  if (x.kind === 'bom') for (const c of Object.values(x.balloonAt ?? {})) if (!(Array.isArray(c) && c.length === 2 && c.every(Number.isFinite))) throw new CommandError(t('drawing.badPosition'));
  if (x.kind === 'holes') for (const [diameter, fit] of Object.entries(x.fits ?? {})) if (diameter.trim() === '' || !parseFit(fit)) throw new CommandError(t('drawing.dimBadFit', { fit: String(fit) }));
}

/** Checks a surface finish against the views it may be drawn on and what ISO 1302 allows. */
function checkSurfaceFinish(f: SurfaceFinish, views: readonly DrawingView[]): void {
  if (!f.id) throw new CommandError(t('drawing.idMissing'));
  if (!viewById(views, f.view)) throw new CommandError(t('drawing.dimNoView', { id: String(f.view) }));
  if (!(Array.isArray(f.at) && f.at.length === 2 && f.at.every(Number.isFinite))) throw new CommandError(t('drawing.badPosition'));
  if (f.angle !== undefined && !Number.isFinite(f.angle)) throw new CommandError(t('drawing.badFinishAngle'));
  if (f.kind !== undefined && !SURFACE_FINISH_KINDS.includes(f.kind)) throw new CommandError(t('drawing.badFinishKind', { kind: String(f.kind) }));
  if (f.ra !== undefined && !(Number.isFinite(f.ra) && f.ra >= RA_MIN && f.ra <= RA_MAX)) throw new CommandError(t('drawing.badRa', { min: String(RA_MIN), max: String(RA_MAX) }));
  if (f.method !== undefined && (typeof f.method !== 'string' || f.method.length > 40)) throw new CommandError(t('drawing.badFinishText'));
  if (f.note !== undefined && (typeof f.note !== 'string' || f.note.length > 40)) throw new CommandError(t('drawing.badFinishText'));
  if (f.leader !== undefined && !(Number.isFinite(f.leader) && f.leader >= 0)) throw new CommandError(t('drawing.badFinishLeader'));
}

/** Immer recipe: mutates the draft or throws CommandError, leaving the document untouched. */
export function mutateDrawing(draft: Draft<DrawingDoc>, cmd: DrawingCommand): void {
  // Resolve target page (B2.8 shape 2): defaults to cmd.pageIndex / cmd.pageId, or page 0
  const pageIdx = 'pageIndex' in cmd && typeof cmd.pageIndex === 'number'
    ? Math.max(0, Math.min(draft.pages.length - 1, cmd.pageIndex))
    : 'pageId' in cmd && typeof cmd.pageId === 'string'
      ? Math.max(0, draft.pages.findIndex((p) => p.id === cmd.pageId))
      : 0;
  const pg = draft.pages[pageIdx] ?? draft.pages[0]!;
  switch (cmd.type) {
    case 'setSheet': {
      const s = cmd.sheet;
      if (s.size !== undefined && !SHEET_SIZES.includes(s.size)) throw new CommandError(t('drawing.badSheet', { size: String(s.size) }));
      if (s.orientation !== undefined && s.orientation !== 'landscape' && s.orientation !== 'portrait') throw new CommandError(t('drawing.badOrientation'));
      if (s.projection !== undefined && s.projection !== 'first' && s.projection !== 'third') throw new CommandError(t('drawing.badProjection'));
      if (s.scale !== undefined && !scaleOk(s.scale)) throw new CommandError(t('drawing.badScale', { scale: s.scale.join(':') }));
      if (s.shift && !(s.shift.length === 2 && s.shift.every(Number.isFinite))) throw new CommandError(t('drawing.badPosition'));
      if (s.unit !== undefined && s.unit !== 'mm' && s.unit !== 'in') throw new CommandError(t('drawing.badUnit'));
      if (s.language !== undefined && s.language !== null && !LOCALES.includes(s.language)) throw new CommandError(t('drawing.badLanguage'));
      if (s.dimStyle !== undefined && s.dimStyle !== null) checkDimStyle(s.dimStyle);
      if (s.titleStyle !== undefined && s.titleStyle !== null) checkTitleStyle(s.titleStyle);
      const { shift, language, dimStyle, titleStyle, pdfFont, ...rest } = s;
      // an empty style is the default's, written as none
      if (dimStyle === null || (dimStyle && Object.keys(dimStyle).length === 0)) delete pg.sheet.dimStyle;
      else if (dimStyle) pg.sheet.dimStyle = { ...dimStyle };
      if (titleStyle === null || (titleStyle && Object.keys(titleStyle).length === 0)) delete pg.sheet.titleStyle;
      else if (titleStyle) pg.sheet.titleStyle = { ...titleStyle };
      if (pdfFont === null || pdfFont === '') delete pg.sheet.pdfFont;
      else if (pdfFont !== undefined) pg.sheet.pdfFont = pdfFont;
      Object.assign(pg.sheet, rest);
      if (s.unit === 'mm') delete pg.sheet.unit;
      // `null` puts the sheet back to writing in whatever language the interface is in
      if (language === null) delete pg.sheet.language;
      else if (language !== undefined) pg.sheet.language = language;
      if (shift === null || (shift && shift[0] === 0 && shift[1] === 0)) delete pg.sheet.shift;
      else if (shift) pg.sheet.shift = [shift[0], shift[1]];
      return;
    }
    case 'setTitle': {
      const value = cmd.value.trim();
      if (value === '') delete pg.title[cmd.field];
      else pg.title[cmd.field] = value;
      return;
    }
    case 'insertViews': {
      const inUse = new Set(drawingIdsInUse(draft as DrawingDoc));
      const seen: DrawingView[] = [...(pg.views as DrawingView[])];
      for (const v of cmd.views) {
        checkView(v, seen);
        if (inUse.has(v.id)) throw new CommandError(t('drawing.idInUse', { id: v.id }));
        inUse.add(v.id);
        seen.push(v);
      }
      for (const v of cmd.views) pg.views.push(v as Draft<DrawingView>);
      countersFor(cmd.views.map((v) => v.id), draft.idCounters);
      return;
    }
    case 'setView': {
      const { page: vPage, view: v } = pageOfView(draft, cmd.viewId);
      // a locked view (B2.1) keeps its place and its scale: moving or rescaling it is refused, however it is asked for
      if (v.locked && (cmd.patch.at !== undefined || cmd.patch.scale !== undefined || cmd.patch.slide !== undefined)) throw new CommandError(t('drawing.viewLocked'));
      const { at, scale, slide, flip, aligned, centreMarks, display, locked, hiddenEdges, showTangentEdges, break: brk, ...rest } = cmd.patch;
      const kind = v.kind ?? 'model';
      const belongs: Record<string, string[]> = { model: ['source', 'direction'], projected: ['side'], section: ['line', 'label'], detail: ['centre', 'radius', 'label'], sectionLocal: ['outline', 'depth', 'label'], crop: ['outline'], auxiliary: ['line', 'label'] };
      for (const k of Object.keys(rest)) if (k !== 'name' && !belongs[kind]!.includes(k)) throw new CommandError(t('drawing.notForKind', { field: k, kind }));
      if (flip !== undefined && kind !== 'section' && kind !== 'auxiliary') throw new CommandError(t('drawing.notForKind', { field: 'flip', kind }));
      if (aligned !== undefined && kind !== 'section') throw new CommandError(t('drawing.notForKind', { field: 'aligned', kind }));
      const next = { ...(JSON.parse(JSON.stringify(v)) as DrawingView), ...rest } as DrawingView & { flip?: boolean; aligned?: boolean; at?: [number, number]; scale?: Scale; slide?: number };
      if (aligned === null || aligned === false) delete next.aligned;
      else if (aligned === true) next.aligned = true;
      if (at === null) delete next.at;
      else if (at !== undefined) next.at = at;
      if (scale === null) delete next.scale;
      else if (scale !== undefined) next.scale = scale;
      if (slide === null || slide === 0) delete next.slide;
      else if (slide !== undefined) next.slide = slide;
      if (centreMarks === null) delete next.centreMarks;
      else if (centreMarks !== undefined) next.centreMarks = centreMarks;
      if (display === null) delete next.display;
      else if (display !== undefined) next.display = display;
      if (locked === null || locked === false) delete next.locked;
      else if (locked !== undefined) next.locked = true;
      // the hidden edges (B2.2): `null` (or an empty list) shows them all again; the rest is written as it is
      if (hiddenEdges === null || (hiddenEdges !== undefined && hiddenEdges.length === 0)) delete next.hiddenEdges;
      else if (hiddenEdges !== undefined) next.hiddenEdges = hiddenEdges;
      if (showTangentEdges === null || showTangentEdges === true) delete next.showTangentEdges;
      else if (showTangentEdges === false) next.showTangentEdges = false;
      if (brk === null) delete next.break;
      else if (brk !== undefined) next.break = brk;
      if (flip === null || flip === false) delete next.flip;
      else if (flip === true) next.flip = true;
      checkView(next, vPage.views.filter((x) => x.id !== v.id) as DrawingView[]);
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
        for (const p of draft.pages) {
          for (const v of p.views as DrawingView[]) if (isDerived(v) && ids.has(v.parent) && !ids.has(v.id)) grew = ids.add(v.id) && true;
        }
      }
      countersFor(ids, draft.idCounters); // deleted ids are never handed out again
      for (const p of draft.pages) {
        p.views = p.views.filter((v) => !ids.has(v.id));
        // the dimensions drawn on them go too
        countersFor(p.dimensions.filter((d) => ids.has(d.view)).map((d) => d.id), draft.idCounters);
        p.dimensions = p.dimensions.filter((d) => !ids.has(d.view));
        countersFor(p.tables.filter((x) => ids.has(x.view)).map((x) => x.id), draft.idCounters);
        p.tables = p.tables.filter((x) => !ids.has(x.view));
        // and the surface finishes drawn on them
        countersFor(p.surfaceFinishes.filter((f) => ids.has(f.view)).map((f) => f.id), draft.idCounters);
        p.surfaceFinishes = p.surfaceFinishes.filter((f) => !ids.has(f.view));
        // and the annotations, unless a datum among them is what a frame on a view that stays refers to
        const annotations = (p.annotations ?? []) as Annotation[];
        const going = annotations.filter((a) => ids.has(a.view));
        refuseOrphanedFrames(annotations, new Set(going.map((a) => a.id)));
        countersFor(going.map((a) => a.id), draft.idCounters);
        p.annotations = annotations.filter((a) => !ids.has(a.view)) as Draft<Annotation>[];
      }
      return;
    }
    case 'insertDimensions': {
      const inUse = new Set(drawingIdsInUse(draft as DrawingDoc));
      for (const d of cmd.dimensions) {
        checkDimension(d, pg.views as DrawingView[]);
        if (inUse.has(d.id)) throw new CommandError(t('drawing.idInUse', { id: d.id }));
        inUse.add(d.id);
      }
      for (const d of cmd.dimensions) pg.dimensions.push(d as Draft<Dimension>);
      countersFor(cmd.dimensions.map((d) => d.id), draft.idCounters);
      return;
    }
    case 'setDimension': {
      const d = pg.dimensions.find((x) => x.id === cmd.dimensionId);
      if (!d) throw new CommandError(t('drawing.noDimension', { id: cmd.dimensionId }));
      const { reference, tolerance, count, callout, calloutStyle, supplementary, precision, prefix, suffix, text, slide, leader, style, kind, size, chamferAngle, chamferFormat, ...rest } = cmd.patch;
      if (kind !== undefined) {
        if (d.kind !== 'diameter' && d.kind !== 'radius') throw new CommandError(t('drawing.notForKind', { field: 'kind', kind: d.kind }));
        if (kind !== 'diameter' && kind !== 'radius') throw new CommandError(t('drawing.notForKind', { field: 'kind', kind }));
      }
      const targetKind = kind ?? d.kind;
      const belongs: Record<Dimension['kind'], string[]> = {
        linear: ['offset', 'orientation', 'a', 'b'],
        diameter: ['angle', 'ref'],
        radius: ['angle', 'ref'],
        angle: ['arc', 'a', 'b'],
        ordinate: ['offset', 'axis', 'origin', 'refs'],
        chamfer: ['angle', 'ref', 'size', 'chamferAngle', 'chamferFormat'],
      };
      if (slide !== undefined && targetKind !== 'linear' && targetKind !== 'angle') throw new CommandError(t('drawing.notForKind', { field: 'slide', kind: targetKind }));
      if (leader !== undefined && targetKind !== 'diameter' && targetKind !== 'radius' && targetKind !== 'chamfer') throw new CommandError(t('drawing.notForKind', { field: 'leader', kind: targetKind }));
      if (calloutStyle !== undefined && targetKind !== 'diameter') throw new CommandError(t('drawing.notForKind', { field: 'calloutStyle', kind: targetKind }));
      if (callout !== undefined && targetKind !== 'diameter') throw new CommandError(t('drawing.notForKind', { field: 'callout', kind: targetKind }));
      if (supplementary !== undefined && targetKind !== 'angle') throw new CommandError(t('drawing.notForKind', { field: 'supplementary', kind: targetKind }));
      if (size !== undefined && targetKind !== 'chamfer') throw new CommandError(t('drawing.notForKind', { field: 'size', kind: targetKind }));
      if (chamferAngle !== undefined && targetKind !== 'chamfer') throw new CommandError(t('drawing.notForKind', { field: 'chamferAngle', kind: targetKind }));
      if (chamferFormat !== undefined && targetKind !== 'chamfer') throw new CommandError(t('drawing.notForKind', { field: 'chamferFormat', kind: targetKind }));
      for (const k of Object.keys(rest)) if (!belongs[targetKind].includes(k)) throw new CommandError(t('drawing.notForKind', { field: k, kind: targetKind }));
      if (count !== undefined && (targetKind === 'linear' || targetKind === 'angle')) throw new CommandError(t('drawing.notForKind', { field: 'count', kind: targetKind }));
      const next = { ...(JSON.parse(JSON.stringify(d)) as Dimension), ...rest } as Dimension & { reference?: boolean; count?: number; tolerance?: DimensionTolerance; callout?: boolean; supplementary?: boolean; size?: number; chamferAngle?: number; chamferFormat?: 'c' | 'distanceAngle' };
      if (kind !== undefined) {
        next.kind = kind;
        if (kind === 'radius') {
          delete next.callout;
          delete (next as unknown as { calloutStyle?: CalloutStyle }).calloutStyle;
        }
      }
      if (supplementary === null || supplementary === false) delete next.supplementary;
      else if (supplementary === true) next.supplementary = true;
      if (callout === null || callout === false) delete next.callout;
      else if (callout === true) next.callout = true;
      if (reference === null || reference === false) delete next.reference;
      else if (reference === true) next.reference = true;
      if (size !== undefined) next.size = size;
      if (chamferAngle === null) delete next.chamferAngle;
      else if (chamferAngle !== undefined) next.chamferAngle = chamferAngle;
      if (chamferFormat === null) delete next.chamferFormat;
      else if (chamferFormat !== undefined) next.chamferFormat = chamferFormat;
      if (next.kind === 'diameter' && calloutStyle !== undefined) {
        if (calloutStyle === null) delete next.calloutStyle;
        else next.calloutStyle = calloutStyle;
      }
      const loose = next as unknown as Record<string, unknown>;
      for (const [k, v] of [['precision', precision], ['prefix', prefix], ['suffix', suffix], ['text', text], ['leader', leader]] as const) {
        if (v === null || v === '') delete loose[k];
        else if (v !== undefined) loose[k] = v;
      }
      if (slide === null || slide === 0) delete loose.slide;
      else if (slide !== undefined) loose.slide = slide;
      if (count === null) delete next.count;
      else if (count !== undefined) next.count = count;
      if (tolerance === null) delete next.tolerance;
      else if (tolerance !== undefined) next.tolerance = tolerance;
      // a style with nothing in it is the drawing's, written as none
      if (style === null || (style && typeof style === 'object' && Object.keys(style).length === 0)) delete next.style;
      else if (style !== undefined) next.style = { ...style };
      checkDimension(next, pg.views as DrawingView[]);
      for (const k of Object.keys(d)) delete (d as unknown as Record<string, unknown>)[k];
      Object.assign(d, next);
      return;
    }
    case 'insertTables': {
      const inUse = new Set(drawingIdsInUse(draft as DrawingDoc));
      for (const x of cmd.tables) {
        checkTable(x, pg.views as DrawingView[]);
        if (inUse.has(x.id)) throw new CommandError(t('drawing.idInUse', { id: x.id }));
        inUse.add(x.id);
      }
      for (const x of cmd.tables) pg.tables.push(x as Draft<DrawingTable>);
      countersFor(cmd.tables.map((x) => x.id), draft.idCounters);
      return;
    }
    case 'setTable': {
      const x = pg.tables.find((y) => y.id === cmd.tableId);
      if (!x) throw new CommandError(t('drawing.noTable', { id: cmd.tableId }));
      const next = JSON.parse(JSON.stringify(x)) as DrawingTable;
      const { at, fits, balloons, balloonAt } = cmd.patch;
      if (at === null) delete next.at;
      else if (at !== undefined) next.at = at;
      if (fits !== undefined) {
        if (next.kind !== 'holes') throw new CommandError(t('drawing.notForKind', { field: 'fits', kind: next.kind }));
        if (Object.keys(fits).length === 0) delete next.fits;
        else next.fits = fits;
      }
      if (balloons !== undefined) {
        if (next.kind !== 'bom') throw new CommandError(t('drawing.notForKind', { field: 'balloons', kind: next.kind }));
        if (balloons === null || balloons === false) delete next.balloons;
        else next.balloons = true;
      }
      if (balloonAt !== undefined) {
        if (next.kind !== 'bom') throw new CommandError(t('drawing.notForKind', { field: 'balloonAt', kind: next.kind }));
        if (balloonAt === null || Object.keys(balloonAt).length === 0) delete next.balloonAt;
        else next.balloonAt = balloonAt;
      }
      checkTable(next, pg.views as DrawingView[]);
      for (const k of Object.keys(x)) delete (x as unknown as Record<string, unknown>)[k];
      Object.assign(x, next);
      return;
    }
    case 'deleteTables': {
      const ids = new Set(cmd.tableIds);
      for (const id of ids) if (!pg.tables.some((x) => x.id === id)) throw new CommandError(t('drawing.noTable', { id }));
      countersFor(ids, draft.idCounters);
      pg.tables = pg.tables.filter((x) => !ids.has(x.id));
      return;
    }
    case 'deleteDimensions': {
      const ids = new Set(cmd.dimensionIds);
      for (const id of ids) if (!pg.dimensions.some((d) => d.id === id)) throw new CommandError(t('drawing.noDimension', { id }));
      countersFor(ids, draft.idCounters);
      pg.dimensions = pg.dimensions.filter((d) => !ids.has(d.id));
      return;
    }
    case 'insertSurfaceFinishes': {
      const inUse = new Set(drawingIdsInUse(draft as DrawingDoc));
      for (const f of cmd.finishes) {
        checkSurfaceFinish(f, pg.views as DrawingView[]);
        if (inUse.has(f.id)) throw new CommandError(t('drawing.idInUse', { id: f.id }));
        inUse.add(f.id);
      }
      for (const f of cmd.finishes) pg.surfaceFinishes.push(f as Draft<SurfaceFinish>);
      countersFor(cmd.finishes.map((f) => f.id), draft.idCounters);
      return;
    }
    case 'setSurfaceFinish': {
      const f = pg.surfaceFinishes.find((x) => x.id === cmd.finishId);
      if (!f) throw new CommandError(t('drawing.noSurfaceFinish', { id: cmd.finishId }));
      const { at, angle, kind, ra, method, note, leader } = cmd.patch;
      const next = { ...(JSON.parse(JSON.stringify(f)) as SurfaceFinish), ...(at !== undefined ? { at } : {}) } as SurfaceFinish;
      const loose = next as unknown as Record<string, unknown>;
      for (const [k, v] of [['angle', angle], ['kind', kind], ['ra', ra], ['method', method], ['note', note], ['leader', leader]] as const) {
        if (v === null) delete loose[k];
        else if (v !== undefined) loose[k] = v;
      }
      checkSurfaceFinish(next, pg.views as DrawingView[]);
      for (const k of Object.keys(f)) delete (f as unknown as Record<string, unknown>)[k];
      Object.assign(f, next);
      return;
    }
    case 'insertAnnotations': {
      const inUse = new Set(drawingIdsInUse(draft as DrawingDoc));
      const all = [...((pg.annotations ?? []) as Annotation[])];
      // in the order given, so that a frame may refer to a datum added with it
      for (const a of cmd.annotations) {
        checkAnnotation(a, (id) => pg.views.some((v) => v.id === id), all);
        if (inUse.has(a.id)) throw new CommandError(t('drawing.idInUse', { id: a.id }));
        inUse.add(a.id);
        all.push(a);
      }
      pg.annotations ??= [];
      for (const a of cmd.annotations) pg.annotations.push(JSON.parse(JSON.stringify(a)) as Draft<Annotation>);
      countersFor(cmd.annotations.map((a) => a.id), draft.idCounters);
      return;
    }
    case 'setAnnotation': {
      const list = (pg.annotations ?? []) as Annotation[];
      const a = list.find((x) => x.id === cmd.annotationId);
      if (!a) throw new CommandError(t('drawing.noAnnotation', { id: cmd.annotationId }));
      const fields = ANNOTATION_FIELDS[a.kind];
      const next = JSON.parse(JSON.stringify(a)) as Record<string, unknown>;
      for (const [k, v] of Object.entries(cmd.patch)) {
        if (!fields.set.includes(k)) throw new CommandError(t('drawing.notForKind', { field: k, kind: a.kind }));
        if (v === null || v === undefined) {
          if (!fields.optional.includes(k)) throw new CommandError(t('drawing.annRequired', { field: k }));
          delete next[k];
        } else next[k] = JSON.parse(JSON.stringify(v));
      }
      // a frame without Ø or without Ⓜ simply has no such field
      if (next.diameter === false) delete next.diameter;
      const others = list.filter((x) => x.id !== a.id);
      // a datum renamed: the frames that refer to it are renamed with it (checked as they will be)
      const renamed = a.kind === 'datum' && typeof next.label === 'string' && next.label !== a.label ? { from: a.label, to: next.label as string } : null;
      const after = renamed ? others.map((o) => (o.kind === 'fcf' ? { ...o, datums: o.datums.map((d) => (d.label === renamed.from ? { ...d, label: renamed.to } : d)) } : o)) : others;
      checkAnnotation(next as unknown as Annotation, (id) => pg.views.some((v) => v.id === id), after);
      for (const k of Object.keys(a)) delete (a as unknown as Record<string, unknown>)[k];
      Object.assign(a, next);
      if (renamed) for (const o of list) if (o.kind === 'fcf') for (const d of o.datums) if (d.label === renamed.from) d.label = renamed.to;
      return;
    }
    case 'deleteAnnotations': {
      const ids = new Set(cmd.annotationIds);
      const list = (pg.annotations ?? []) as Annotation[];
      for (const id of ids) if (!list.some((a) => a.id === id)) throw new CommandError(t('drawing.noAnnotation', { id }));
      refuseOrphanedFrames(list, ids);
      countersFor(ids, draft.idCounters);
      pg.annotations = list.filter((a) => !ids.has(a.id)) as Draft<Annotation>[];
      return;
    }
    case 'batch': {
      if (!Array.isArray(cmd.commands) || cmd.commands.length === 0) throw new CommandError(t('drawing.batchEmpty'));
      // every command sees what the ones before it did; a refusal throws out of the recipe, so immer keeps the document as it was
      for (const c of cmd.commands) {
        if (c.type === 'batch') throw new CommandError(t('drawing.batchNested'));
        mutateDrawing(draft, c);
      }
      return;
    }
    case 'deleteSurfaceFinishes': {
      const ids = new Set(cmd.finishIds);
      for (const id of ids) if (!pg.surfaceFinishes.some((f) => f.id === id)) throw new CommandError(t('drawing.noSurfaceFinish', { id }));
      countersFor(ids, draft.idCounters);
      pg.surfaceFinishes = pg.surfaceFinishes.filter((f) => !ids.has(f.id));
      return;
    }
    case 'insertPage': {
      const inUse = new Set(draft.pages.map((p) => p.id));
      let pageNum = draft.pages.length + 1;
      let nextId = `page${pageNum}`;
      while (inUse.has(nextId)) {
        pageNum++;
        nextId = `page${pageNum}`;
      }
      const inheritedSheet = JSON.parse(JSON.stringify(pg.sheet)) as DrawingSheet;
      delete inheritedSheet.shift;
      const newPage: DrawingPage = {
        id: cmd.page?.id ?? nextId,
        name: cmd.page?.name ?? t('drawingUi.sheetTabs.sheetDefault', { n: String(draft.pages.length + 1) }),
        sheet: cmd.page?.sheet ? { ...inheritedSheet, ...cmd.page.sheet } : inheritedSheet,
        title: cmd.page?.title ? { ...cmd.page.title } : {},
        views: [],
        dimensions: [],
        tables: [],
        surfaceFinishes: [],
        annotations: [],
      };
      const insertIdx = cmd.afterIndex !== undefined && Number.isInteger(cmd.afterIndex) && cmd.afterIndex >= 0 && cmd.afterIndex < draft.pages.length
        ? cmd.afterIndex + 1
        : draft.pages.length;
      draft.pages.splice(insertIdx, 0, newPage as Draft<DrawingPage>);
      countersFor([newPage.id], draft.idCounters);
      return;
    }
    case 'deletePage': {
      if (draft.pages.length <= 1) throw new CommandError(t('drawing.cannotDeleteLastPage'));
      const idx = cmd.pageIndex !== undefined && Number.isInteger(cmd.pageIndex) && cmd.pageIndex >= 0 && cmd.pageIndex < draft.pages.length
        ? cmd.pageIndex
        : cmd.pageId
          ? draft.pages.findIndex((p) => p.id === cmd.pageId)
          : -1;
      if (idx < 0 || idx >= draft.pages.length) throw new CommandError(t('drawing.badPage'));
      const goingPage = draft.pages[idx]!;
      const ids = [
        goingPage.id,
        ...goingPage.views.map((v) => v.id),
        ...goingPage.dimensions.map((d) => d.id),
        ...goingPage.tables.map((x) => x.id),
        ...goingPage.surfaceFinishes.map((f) => f.id),
        ...(goingPage.annotations ?? []).map((a) => a.id),
      ];
      countersFor(ids, draft.idCounters);
      draft.pages.splice(idx, 1);
      return;
    }
    case 'setPage': {
      const idx = cmd.pageIndex !== undefined && Number.isInteger(cmd.pageIndex) && cmd.pageIndex >= 0 && cmd.pageIndex < draft.pages.length
        ? cmd.pageIndex
        : cmd.pageId
          ? draft.pages.findIndex((p) => p.id === cmd.pageId)
          : pageIdx;
      const target = draft.pages[idx];
      if (!target) throw new CommandError(t('drawing.badPage'));
      if (cmd.patch.name !== undefined) {
        const trimmed = cmd.patch.name.trim();
        if (!trimmed) throw new CommandError(t('drawing.nameEmpty'));
        target.name = trimmed;
      }
      if (cmd.patch.sheet) {
        const s = cmd.patch.sheet;
        if (s.size !== undefined && !SHEET_SIZES.includes(s.size)) throw new CommandError(t('drawing.badSheet', { size: String(s.size) }));
        if (s.orientation !== undefined && s.orientation !== 'landscape' && s.orientation !== 'portrait') throw new CommandError(t('drawing.badOrientation'));
        if (s.projection !== undefined && s.projection !== 'first' && s.projection !== 'third') throw new CommandError(t('drawing.badProjection'));
        if (s.scale !== undefined && !scaleOk(s.scale)) throw new CommandError(t('drawing.badScale', { scale: s.scale.join(':') }));
        if (s.shift && !(s.shift.length === 2 && s.shift.every(Number.isFinite))) throw new CommandError(t('drawing.badPosition'));
        if (s.unit !== undefined && s.unit !== 'mm' && s.unit !== 'in') throw new CommandError(t('drawing.badUnit'));
        Object.assign(target.sheet, s);
      }
      if (cmd.patch.title) {
        Object.assign(target.title, cmd.patch.title);
      }
      return;
    }
    case 'moveViewToPage': {
      const { page: srcPage, pageIndex: srcIdx, view: targetView } = pageOfView(draft, cmd.viewId);
      const dstIdx = cmd.targetPageIndex;
      if (dstIdx < 0 || dstIdx >= draft.pages.length) throw new CommandError(t('drawing.badPage'));
      const dstPage = draft.pages[dstIdx]!;
      if (srcIdx === dstIdx) {
        if (cmd.at) {
          targetView.at = [cmd.at[0], cmd.at[1]];
          delete targetView.slide;
        }
        return;
      }
      srcPage.views = srcPage.views.filter((v) => v.id !== cmd.viewId);
      const clonedView = JSON.parse(JSON.stringify(targetView)) as DrawingView;
      if (cmd.at) {
        clonedView.at = [cmd.at[0], cmd.at[1]];
        delete clonedView.slide;
      }
      dstPage.views.push(clonedView as Draft<DrawingView>);

      const dimsToMove = srcPage.dimensions.filter((d) => d.view === cmd.viewId);
      srcPage.dimensions = srcPage.dimensions.filter((d) => d.view !== cmd.viewId);
      for (const d of dimsToMove) dstPage.dimensions.push(d);

      const tablesToMove = srcPage.tables.filter((x) => x.view === cmd.viewId);
      srcPage.tables = srcPage.tables.filter((x) => x.view !== cmd.viewId);
      for (const x of tablesToMove) dstPage.tables.push(x);

      const sfToMove = srcPage.surfaceFinishes.filter((f) => f.view === cmd.viewId);
      srcPage.surfaceFinishes = srcPage.surfaceFinishes.filter((f) => f.view !== cmd.viewId);
      for (const f of sfToMove) dstPage.surfaceFinishes.push(f);

      const annToMove = (srcPage.annotations ?? []).filter((a) => a.view === cmd.viewId);
      srcPage.annotations = (srcPage.annotations ?? []).filter((a) => a.view !== cmd.viewId);
      dstPage.annotations ??= [];
      for (const a of annToMove) dstPage.annotations.push(a);

      return;
    }
  }
}

/** Throws when deleting `going` would take a datum away that a frame which stays refers to. */
function refuseOrphanedFrames(annotations: readonly Annotation[], going: ReadonlySet<Id>): void {
  for (const a of annotations) {
    if (a.kind !== 'datum' || !going.has(a.id)) continue;
    const staying = framesUsing(annotations, a.label).filter((f) => !going.has(f.id));
    if (staying.length > 0) throw new CommandError(t('drawing.datumInUse', { label: a.label, n: String(staying.length) }));
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
    case 'flat':
      return { dir: [0, 0, -1], up: [0, 1, 0] }; // what the pattern's own coordinates are drawn as; nothing is projected
  }
}

/**
 * The same drawing seen from another folder: it was saved into `to` after its sources were written relative to `from` (both relative to the project folder),
 * so each source is rewritten to reach the same file from there.
 */
export function relocateDrawing(doc: DrawingDoc, from: string, to: string): DrawingDoc {
  if (from === to) return doc;
  return { ...doc, pages: doc.pages.map((p) => ({ ...p, views: p.views.map((v) => (isDerived(v) ? v : { ...v, source: relativePath(to, joinPath(from, v.source)) })) })) };
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

/**
 * The sheet's y of a view: up the sheet, square to both the direction looked along and the sheet's x — what the hidden-line removal draws as y (the projector's
 * (−dir) × x). It is `up` itself whenever `up` is square to `dir` (the six orthographic views); in the isometric, whose `up` is the model's y and not square to
 * the direction, it is `up` tilted into the sheet (D-I2, ADR 0138). Every point put into a view's coordinates goes through this, so that it lands on the lines.
 */
export const sheetUp = (a: ViewAxes): V3 => unit(cross(neg(unit(a.dir)), rightOf(a)));

const OPPOSITE: Record<ViewSide, ViewSide> = { left: 'right', right: 'left', up: 'down', down: 'up' };
export const oppositeSide = (s: ViewSide): ViewSide => OPPOSITE[s];

/**
 * The direction of a view projected from `parent` and placed on `side` of it (C16.3). Third angle: the viewer is on the side the view is placed on, so a view on the
 * right is the parent seen from its right; first angle: it is the other way round (the view on the right is the left view).
 */
export function projectedAxes(parent: ViewAxes, side: ViewSide | ViewCorner, projection: DrawingSheet['projection']): ViewAxes {
  if (isCorner(side)) return cornerAxes(parent, side, projection);
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

/**
 * The isometric off a corner of the parent (v19, ADR 0146): the viewer is in front of the parent, and to the side and above or below as the corner says — third
 * angle, the corner the view is placed at; first angle, the opposite one (as for the sides). Each of the three ways counts the same, so it is a true isometric:
 * off the upper right of a front view in third angle it is the part seen from front, right and top, which is the model's own isometric. Up stays the parent's,
 * tilted into the sheet by `sheetUp` as the isometric's is.
 */
export function cornerAxes(parent: ViewAxes, corner: ViewCorner, projection: DrawingSheet['projection']): ViewAxes {
  const r = rightOf(parent);
  const u = unit(parent.up);
  const d = unit(parent.dir);
  // where the viewer is: +1 to the right (up), -1 to the left (down) of the parent; the opposite in first angle
  const flip = projection === 'first' ? -1 : 1;
  const sx = (corner === 'upRight' || corner === 'downRight' ? 1 : -1) * flip;
  const sy = (corner === 'upLeft' || corner === 'upRight' ? 1 : -1) * flip;
  // the viewer at r·sx + u·sy − d (in front of the parent) looks back toward the model
  const dir = unit([d[0] - sx * r[0] - sy * u[0], d[1] - sx * r[1] - sy * u[1], d[2] - sx * r[2] - sy * u[2]]);
  return { dir, up: u };
}

/** The way the arrows of a section line point in the parent's sheet: to the right of the line from its first point to its second (the left with `flip`), by the nearer axis. */
export function sectionArrow(v: Pick<SectionDrawingView, 'line' | 'flip'>): ViewSide {
  const [ax, ay] = sectionDirection(v);
  const side: ViewSide = Math.abs(ax) >= Math.abs(ay) ? (ax >= 0 ? 'right' : 'left') : ay >= 0 ? 'up' : 'down';
  return side;
}

/**
 * The direction the arrows of a section line point in, on the parent's sheet (unit): to the right of the line from its first point to its
 * second, the left with `flip`. Any angle (C-D-I5): a vertical line has them horizontal, a horizontal one vertical, a slanted one between.
 */
export function sectionDirection(v: Pick<SectionDrawingView, 'line' | 'flip'>): [number, number] {
  const [[x0, y0], [x1, y1]] = v.line;
  const len = Math.hypot(x1 - x0, y1 - y0);
  // the right of (dx, dy) is (dy, -dx)
  const s = v.flip ? -1 : 1;
  return [(s * (y1 - y0)) / len, (-s * (x1 - x0)) / len];
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

/**
 * The way the arrows at the two ends of a section line point (unit, on the parent's sheet): each square to its own end segment, to its right (the left with
 * `flip`). The same for a straight or stepped line; at the ends of an aligned one (D-I5), each says which way its own cut is seen.
 */
export function sectionEndDirections(v: Pick<SectionDrawingView, 'line' | 'flip'>): [[number, number], [number, number]] {
  const n = v.line.length;
  const last = sectionDirection({ line: [v.line[n - 2]!, v.line[n - 1]!], ...(v.flip ? { flip: true } : {}) });
  return [sectionDirection(v), last];
}

/**
 * The direction of a section view on any section line (C-D-I5). A line along an axis of the sheet looks as `sectionAxes` does. A slanted
 * line looks along its arrows' direction on the sheet, in the parent's plane; its up is the parent's direction (the depth) when the
 * arrows are nearer up or down, and the sheet's up turned to stay square to it when they are nearer right or left (the same frames as
 * the four axis cases, so it changes continuously with the angle at the cases' sides).
 */
export function sectionLookAxes(parent: ViewAxes, v: Pick<SectionDrawingView, 'line' | 'flip'>): ViewAxes {
  const [ax, ay] = sectionDirection(v);
  if (ax === 0 || ay === 0) return sectionAxes(parent, sectionArrow(v));
  const r = rightOf(parent);
  const u = unit(parent.up);
  const d = unit(parent.dir);
  const along: V3 = [ax * r[0] + ay * u[0], ax * r[1] + ay * u[1], ax * r[2] + ay * u[2]];
  if (Math.abs(ay) > Math.abs(ax)) return { dir: along, up: ay > 0 ? neg(d) : d };
  // the sheet's up, turned by the same angle as the arrows: square to them, on the side the arrows' x points
  const turned: V3 = [-ay * r[0] + ax * u[0], -ay * r[1] + ax * u[1], -ay * r[2] + ax * u[2]];
  return { dir: along, up: ax > 0 ? turned : neg(turned) };
}

/** The side of the parent a section view is placed on: third angle, the side the viewer is on (opposite the arrows); first angle, the arrows' side. */
export const sectionSide = (arrow: ViewSide, projection: DrawingSheet['projection']): ViewSide => (projection === 'first' ? arrow : oppositeSide(arrow));

/** The cutting plane of a section view: a point on it and its normal pointing toward the viewer (the side that is taken away). In the model's axes. */
export function sectionPlane(parent: ViewAxes, v: SectionDrawingView): { origin: V3; normal: V3 } {
  const r = rightOf(parent);
  const u = unit(parent.up);
  const [[x0, y0]] = v.line;
  const a = sectionLookAxes(parent, v);
  return { origin: [x0 * r[0] + y0 * u[0], x0 * r[1] + y0 * u[1], x0 * r[2] + y0 * u[2]], normal: neg(a.dir) };
}

/**
 * What a section cuts the model with (D-I5): the plane of its first segment (`sectionPlane`), and for a stepped or aligned line the whole line in the model's axes
 * (`path`) with `aligned` for an aligned one. The kernel takes away what is on the viewer's side of the path; the plane's normal says which side that is.
 * For a local (partial) section, `local` gives the closed cutting outline in the parent's view plane and how deep the cut goes.
 */
export interface SectionCut {
  origin: V3;
  normal: V3;
  path?: V3[];
  aligned?: true;
  /** A local (partial) section: the closed cutting outline in model axes, and how deep the cut goes (mm, positive). */
  local?: { outline: V3[]; depth: number };
}

export function sectionCut(parent: ViewAxes, v: DrawingView): SectionCut {
  switch (v.kind) {
    case 'sectionLocal': {
      const r = rightOf(parent);
      const u = unit(parent.up);
      const outline = v.outline;
      let pts: [number, number][];
      if (outline.kind === 'rectangle') {
        const [x0, y0] = outline.p0; const [x1, y1] = outline.p1;
        pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
      } else if (outline.kind === 'circle') {
        // approximate the circle by a 32-gon
        const { centre, radius } = outline;
        const n = 32;
        pts = [];
        for (let i = 0; i <= n; i++) {
          const a = (i / n) * 2 * Math.PI;
          pts.push([centre[0] + radius * Math.cos(a), centre[1] + radius * Math.sin(a)]);
        }
      } else {
        pts = outline.points;
      }
      const path = pts.map(([x, y]): V3 => [x * r[0] + y * u[0], x * r[1] + y * u[1], x * r[2] + y * u[2]]);
      return { origin: path[0]!, normal: neg(parent.dir), local: { outline: path, depth: v.depth } };
    }
    case 'section': {
      const plane = sectionPlane(parent, v);
      if (v.line.length === 2) return plane;
      const r = rightOf(parent);
      const u = unit(parent.up);
      const path = v.line.map(([x, y]): V3 => [x * r[0] + y * u[0], x * r[1] + y * u[1], x * r[2] + y * u[2]]);
      return { ...plane, path, ...(v.aligned ? { aligned: true as const } : {}) };
    }
    default:
      throw new CommandError(t('drawing.notForKind', { field: 'section', kind: v.kind ?? 'model' }));
  }
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
      return sectionLookAxes(base, view);
    case 'detail':
      return base;
    case 'sectionLocal':
      return base;
    case 'crop':
      return base;
    case 'auxiliary':
      // the view is turned about the fold line and looks square to it: the frame a section looks along, without the cut (B2.7)
      return sectionLookAxes(base, view);
  }
}

