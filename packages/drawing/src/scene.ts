import { t } from '@3db/i18n';
import type { DrawingDoc, Id, TitleField } from '@3db/model';
import { layoutViews, ratio, type PlacedView, type ViewLines } from './layout';
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
  /** x, y, x, y … */
  points: number[];
  style: LineStyle;
  closed?: boolean;
}

export interface SceneText {
  kind: 'text';
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

export interface Scene {
  width: number;
  height: number;
  items: SceneItem[];
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

/** A view's lines moved and scaled to where the view is on the sheet. */
export function viewItems(view: { hidden?: boolean }, lines: ViewLines | null | undefined, placed: PlacedView): ScenePolyline[] {
  if (!lines) return [];
  const move = (line: number[]): number[] => {
    const out: number[] = [];
    for (let i = 0; i < line.length; i += 2) out.push(placed.at[0] + (line[i]! - placed.centre[0]) * placed.scale, placed.at[1] + (line[i + 1]! - placed.centre[1]) * placed.scale);
    return out;
  };
  return [
    ...(view.hidden === false ? [] : lines.hidden.map((l): ScenePolyline => ({ kind: 'polyline', points: move(l), style: 'hidden' }))),
    ...lines.visible.map((l): ScenePolyline => ({ kind: 'polyline', points: move(l), style: 'visible' })),
  ];
}

/**
 * The whole drawing as a scene: the sheet, then each view's lines where the layout puts it. `lines` is what the views look like from their directions at full
 * size (a view not in it, or null, is not drawn: its model could not be read).
 */
export function buildScene(doc: DrawingDoc, lines: ReadonlyMap<Id, ViewLines | null>): { scene: Scene; placed: Map<Id, PlacedView> } {
  const m = sheetMetrics(doc.sheet);
  const placed = layoutViews(doc, lines);
  const items: SceneItem[] = [...sheetItems(doc)];
  for (const v of doc.views) items.push(...viewItems(v, lines.get(v.id), placed.get(v.id)!));
  return { scene: { width: m.width, height: m.height, items }, placed };
}

export { ratio };
export type { TitleField };
