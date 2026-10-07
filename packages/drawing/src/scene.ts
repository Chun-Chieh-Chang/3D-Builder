import { t } from '@3db/i18n';
import { axesOf, sectionArrow, type DetailDrawingView, type DrawingDoc, type DrawingView, type Id, type Scale, type SectionDrawingView, type TitleField, type ViewFeature, type ViewSide } from '@3db/model';
import { centreItems, holeRows, holeTableItems, type HoleRow } from './annotation';
import { balloonItems, bomTableItems, type ViewBom } from './bomTable';
import { evaluateDimension, type DimensionOutcome, type ElementsResult } from './dimension';
import { circlePolyline, hatch } from './geometry';
import { layoutViews, resolveLines, scaleOf, toSheet, type PlacedView, type ViewLines } from './layout';
import { sheetMetrics, titleCells, type Rect } from './sheet';

/**
 * What a drawing is as lines and text on the sheet (C16, F3.1, F3.2): one list of polylines and texts in sheet millimetres (origin at the lower left corner,
 * y up), each line with the style it is drawn in. The SVG of the screen, the DXF and the PDF are all written from it, so they cannot disagree.
 */

export type LineStyle = 'visible' | 'hidden' | 'center' | 'thin' | 'frame' | 'dimension';

/** How each style is drawn (ISO 128): the width of the line in mm and its dashes (on, off, … in mm), and the layer of the DXF. */
export const LINE_STYLES: Record<LineStyle, { width: number; dash: number[] | null; layer: string; linetype: string }> = {
  visible: { width: 0.5, dash: null, layer: 'VISIBLE', linetype: 'CONTINUOUS' },
  hidden: { width: 0.25, dash: [3, 1], layer: 'HIDDEN', linetype: 'DASHED' },
  center: { width: 0.25, dash: [12, 2, 2, 2], layer: 'CENTER', linetype: 'CENTER' },
  thin: { width: 0.25, dash: null, layer: 'THIN', linetype: 'CONTINUOUS' },
  frame: { width: 0.7, dash: null, layer: 'FRAME', linetype: 'CONTINUOUS' },
  dimension: { width: 0.25, dash: null, layer: 'DIMENSION', linetype: 'CONTINUOUS' },
};

export interface ScenePolyline {
  kind: 'polyline';
  /** The dimension (by id) this line is drawn for: a DXF writes it into the dimension's block, the other outputs draw it as it is. */
  group?: string;
  /** x, y, x, y … */
  points: number[];
  style: LineStyle;
  closed?: boolean;
  /** A closed polyline filled in (an arrowhead). */
  filled?: boolean;
}

export interface SceneText {
  kind: 'text';
  /** The dimension (by id) this text is drawn for. */
  group?: string;
  /** The left end of the text's baseline (or its middle or right end, by `anchor`). */
  at: [number, number];
  text: string;
  /** Height of the capital letters, mm. */
  height: number;
  anchor?: 'left' | 'center' | 'right';
  /** Degrees counter-clockwise. */
  angle?: number;
}

export type SceneItem = ScenePolyline | SceneText;

type P2 = [number, number];

/**
 * What a CAD program needs to know of a dimension to keep it a dimension (D-2, ADR 0102): its kind and the definition points of a DXF DIMENSION, in sheet millimetres.
 * The lines and text it is drawn with are the scene's items of the same `group`; the text is the one the model's number made, written over what the CAD would measure.
 */
export type SceneDimensionGeometry =
  /** Linear: where the two extension lines start, a point on the dimension line, and for a horizontal or vertical one the angle of the dimension line (0 or 90). */
  | { kind: 'linear'; a: P2; b: P2; line: P2; rotation?: number }
  /** Diameter: the two ends of the dimension line on the circle, and the length of the leader. */
  | { kind: 'diameter'; far: P2; near: P2; leader: number }
  /** Radius: the centre, a point on the circle and the length of the leader. */
  | { kind: 'radius'; centre: P2; near: P2; leader: number }
  /** Angle between two lines: each as the two points it runs through (from the vertex out), and a point on the arc. */
  | { kind: 'angular'; first: [P2, P2]; second: [P2, P2]; arc: P2 };

export interface SceneDimension {
  id: string;
  text: string;
  /** Where the middle of the text is. */
  textAt: P2;
  geometry: SceneDimensionGeometry;
}

export interface Scene {
  width: number;
  height: number;
  items: SceneItem[];
  /** The dimensions of the drawing as dimensions, for a DXF (the items of each are marked with its id as `group`). */
  dimensions?: SceneDimension[];
}

const rect = (r: Rect, style: LineStyle): ScenePolyline => ({ kind: 'polyline', points: [r.x, r.y, r.x + r.w, r.y, r.x + r.w, r.y + r.h, r.x, r.y + r.h], style, closed: true });

/** The text of a scale: 「1:2」, 「5:1」. */
export const scaleText = (s: readonly [number, number]) => `${s[0]}:${s[1]}`;

/** The frame and the title block with what the document says in it. */
export function sheetItems(doc: DrawingDoc): SceneItem[] {
  const m = sheetMetrics(doc.sheet);
  const items: SceneItem[] = [rect(m.frame, 'frame'), rect(m.titleBlock, 'frame')];
  const values: Record<string, string> = {
    ...doc.title,
    scale: scaleText(doc.sheet.scale),
    sheet: doc.sheet.size,
    projection: t(`drawing.projection.${doc.sheet.projection}`),
  };
  for (const c of titleCells()) {
    const x = m.titleBlock.x + c.x;
    const y = m.titleBlock.y + c.y;
    // the lines between cells are the cells' own borders; the block's outer line is already there
    items.push(rect({ x, y, w: c.w, h: c.h }, 'thin'));
    items.push({ kind: 'text', at: [x + 1, y + c.h - 3], text: t(`drawing.title.${c.field}`), height: 2.2 });
    const text = values[c.field] ?? '';
    if (text) items.push({ kind: 'text', at: [x + 2, y + (c.large ? 3.5 : 2.2)], text, height: c.large ? 6 : 3.5 });
  }
  return items;
}


/** Whether a view draws its hidden lines: when it says so, and otherwise except in a section (where the cut shows what is inside). */
export const showsHidden = (v: DrawingView): boolean => v.hidden ?? v.kind !== 'section';

/** The spacing of hatch lines on the sheet (ISO 128-50: 1.5 to 3 mm for small areas, up to 10 for large). */
export const HATCH_SPACING = 3;

/** A view's lines moved and scaled to where the view is on the sheet; for a section, the hatching of the faces it cut. */
export function viewItems(view: DrawingView, lines: ViewLines | null | undefined, placed: PlacedView): ScenePolyline[] {
  if (!lines) return [];
  const move = (line: number[]): number[] => {
    const out: number[] = [];
    for (let i = 0; i < line.length; i += 2) out.push(...toSheet(placed, line[i]!, line[i + 1]!));
    return out;
  };
  const items: ScenePolyline[] = [];
  if (showsHidden(view)) for (const l of lines.hidden) items.push({ kind: 'polyline', points: move(l), style: 'hidden' });
  for (const l of lines.visible) items.push({ kind: 'polyline', points: move(l), style: 'visible' });
  for (const l of lines.center ?? []) items.push({ kind: 'polyline', points: move(l), style: 'center' });
  if (view.kind === 'section' && lines.cut) for (const l of hatch(lines.cut, HATCH_SPACING / placed.scale)) items.push({ kind: 'polyline', points: move(l), style: 'thin' });
  return items;
}

const ARROW: Record<ViewSide, [number, number]> = { right: [1, 0], left: [-1, 0], up: [0, 1], down: [0, -1] };

/** The cutting plane line of a section on its parent view, with the arrows at its ends and the letter beside each; and the section's own title. */
function sectionItems(v: SectionDrawingView, parent: PlacedView, own: PlacedView): SceneItem[] {
  const [[x0, y0], [x1, y1]] = v.line;
  const a = toSheet(parent, x0, y0);
  const b = toSheet(parent, x1, y1);
  const dir = ARROW[sectionArrow(v)];
  const shaft = 8;
  const head = 3;
  const items: SceneItem[] = [{ kind: 'polyline', points: [...a, ...b], style: 'center' }];
  for (const end of [a, b]) {
    const tip: [number, number] = [end[0] + dir[0] * shaft, end[1] + dir[1] * shaft];
    // the arrow: a shaft from the end of the line, and a V head turned 20 degrees either way
    const back = (turn: number): [number, number] => [tip[0] - head * (dir[0] * Math.cos(turn) - dir[1] * Math.sin(turn)), tip[1] - head * (dir[0] * Math.sin(turn) + dir[1] * Math.cos(turn))];
    items.push({ kind: 'polyline', points: [...end, ...tip], style: 'visible' });
    items.push({ kind: 'polyline', points: [...back(0.35), ...tip, ...back(-0.35)], style: 'visible' });
    items.push({ kind: 'text', at: [tip[0] + dir[0] * 2 - (dir[0] < 0 ? 3 : 0), tip[1] + dir[1] * 2 - (dir[1] < 0 ? 5 : 0)], text: v.label, height: 5 });
  }
  items.push({ kind: 'text', at: [own.at[0], own.at[1] - own.h / 2 - 8], text: `${v.label}-${v.label}`, height: 5, anchor: 'center' });
  return items;
}

/** The circle of a detail on its parent view with its letter, and the detail's own title (the letter and its scale). */
function detailItems(v: DetailDrawingView, parent: PlacedView, own: PlacedView, scale: Scale): SceneItem[] {
  const centre = toSheet(parent, v.centre[0], v.centre[1]);
  const r = v.radius * parent.scale;
  const ring = circlePolyline(centre, r);
  return [
    { kind: 'polyline', points: ring, style: 'thin', closed: true },
    { kind: 'text', at: [centre[0] + r * 0.72 + 1, centre[1] + r * 0.72 + 1], text: v.label, height: 5 },
    { kind: 'text', at: [own.at[0], own.at[1] - own.h / 2 - 8], text: `${v.label} (${scaleText(scale)})`, height: 5, anchor: 'center' },
  ];
}

/**
 * The whole drawing as a scene: the sheet, then each view's lines where the layout puts it, the cutting lines of the sections and the circles of the details on
 * their parents, and the titles of those views. `lines` is what the views look like from their directions at full size (a view not in it, or null, is not
 * drawn: its model could not be read); detail views are made from their parents' lines. The dimensions are drawn on their views from what `elements` says their
 * elements are (by the dimension's id); what each came to, its text or why it could not be drawn, is in `dimensions`. `features` is what each view can be dimensioned
 * from (by view id): the centre marks and lines are drawn from it, and the hole tables are made from it (their rows are in `tables`). `boms` is what the views of
 * assemblies say of what they show (by view id): the parts lists and their balloons are drawn from it.
 */
export function buildScene(
  doc: DrawingDoc,
  lines: ReadonlyMap<Id, ViewLines | null>,
  elements: ReadonlyMap<Id, ElementsResult> = new Map(),
  features: ReadonlyMap<Id, readonly ViewFeature[]> = new Map(),
  boms: ReadonlyMap<Id, ViewBom> = new Map(),
): { scene: Scene; placed: Map<Id, PlacedView>; dimensions: Map<Id, DimensionOutcome>; tables: Map<Id, HoleRow[]> } {
  const m = sheetMetrics(doc.sheet);
  const placed = layoutViews(doc, lines);
  const resolved = resolveLines(doc, lines);
  const items: SceneItem[] = [...sheetItems(doc)];
  for (const v of doc.views) {
    const own = placed.get(v.id)!;
    items.push(...viewItems(v, resolved.get(v.id), own));
    if (!resolved.get(v.id)) continue;
    items.push(...centreItems(v, features.get(v.id) ?? [], own));
    const parent = v.kind === 'section' || v.kind === 'detail' ? placed.get(v.parent) : undefined;
    if (v.kind === 'section' && parent) items.push(...sectionItems(v, parent, own));
    if (v.kind === 'detail' && parent) items.push(...detailItems(v, parent, own, scaleOf(doc, v)));
  }
  const dimensions = new Map<Id, DimensionOutcome>();
  const sceneDimensions: SceneDimension[] = [];
  for (const d of doc.dimensions ?? []) {
    const view = doc.views.find((v) => v.id === d.view);
    const own = view && resolved.get(view.id) ? placed.get(view.id) : undefined;
    const axes = view ? axesOf(doc.views, doc.sheet.projection, view) : null;
    if (!view || !own || !axes) continue; // nothing to draw it on yet
    const outcome = evaluateDimension(d, elements.get(d.id), axes, own);
    dimensions.set(d.id, outcome);
    if (!('error' in outcome)) {
      items.push(...outcome.items.map((i) => ({ ...i, group: d.id })));
      if (outcome.dxf) sceneDimensions.push({ id: d.id, text: outcome.text, textAt: outcome.dxf.textAt, geometry: outcome.dxf.geometry });
    }
  }
  const tables = new Map<Id, HoleRow[]>();
  for (const table of doc.tables ?? []) {
    const own = resolved.get(table.view) ? placed.get(table.view) : undefined;
    if (!own) continue;
    if (table.kind === 'bom') {
      const bom = boms.get(table.view);
      if (!bom) continue;
      items.push(...bomTableItems(table, bom.rows, doc.sheet));
      if (table.balloons) items.push(...balloonItems(bom, resolved.get(table.view)?.anchors, own));
      continue;
    }
    const rows = holeRows(features.get(table.view) ?? [], table.fits);
    tables.set(table.id, rows);
    items.push(...holeTableItems(table, rows, own, doc.sheet));
  }
  return { scene: { width: m.width, height: m.height, items, ...(sceneDimensions.length > 0 ? { dimensions: sceneDimensions } : {}) }, placed, dimensions, tables };
}

export type { TitleField };
