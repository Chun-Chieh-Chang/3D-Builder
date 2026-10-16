import { HELVETICA_CAP_HEIGHT, helveticaCode, helveticaWidth } from './helvetica';
import type { DrawingSheet, SheetSize, TitleField } from '@3db/model';

/**
 * The sheet (C16.1, ISO 5457 and ISO 7200): its size, the frame, and the title block at the lower right, all in mm from the lower left corner of the sheet.
 */

/** Landscape width and height, mm. */
const SIZES: Record<SheetSize, [number, number]> = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841] };

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SheetMetrics {
  width: number;
  height: number;
  /** The frame of the drawing: 20 mm from the left edge (for filing), 10 mm from the others on A4 and A3, 20 mm on the larger sheets. */
  frame: Rect;
  titleBlock: Rect;
  /** Where the views go: the frame above the title block, kept clear of the frame's own line. */
  area: Rect;
}

export const TITLE_BLOCK = { width: 180, height: 48 } as const;

export function sheetMetrics(sheet: Pick<DrawingSheet, 'size' | 'orientation'>): SheetMetrics {
  const [lw, lh] = SIZES[sheet.size];
  const [width, height] = sheet.orientation === 'landscape' ? [lw, lh] : [lh, lw];
  const margin = sheet.size === 'A4' || sheet.size === 'A3' ? 10 : 20;
  const frame: Rect = { x: 20, y: margin, w: width - 20 - margin, h: height - 2 * margin };
  const titleBlock: Rect = { x: frame.x + frame.w - TITLE_BLOCK.width, y: frame.y, w: TITLE_BLOCK.width, h: TITLE_BLOCK.height };
  const pad = 8;
  const area: Rect = { x: frame.x + pad, y: frame.y + TITLE_BLOCK.height + pad, w: frame.w - 2 * pad, h: frame.h - TITLE_BLOCK.height - 2 * pad };
  return { width, height, frame, titleBlock, area };
}

/** One cell of the title block: where it is (from the block's lower left corner), what it is called, and what it holds. */
export interface TitleCell extends Rect {
  /** A field of the document, or something worked out: the scale, the sheet, the projection. */
  field: TitleField | 'scale' | 'sheet' | 'projection';
  /** The text is bigger (the title of the drawing). */
  large?: boolean;
}

/** The cells of the title block, in four rows from the top: company; title, number, revision; material, general tolerance, drafter, date; scale, sheet, projection. */
export function titleCells(): TitleCell[] {
  const W = TITLE_BLOCK.width;
  const rows = [10, 16, 11, 11];
  const top = TITLE_BLOCK.height;
  const at = (row: number) => top - rows.slice(0, row + 1).reduce((a, b) => a + b, 0);
  const row = (i: number, parts: [TitleCell['field'], number, boolean?][]): TitleCell[] => {
    let x = 0;
    return parts.map(([field, w, large]) => {
      const cell: TitleCell = { field, x, y: at(i), w, h: rows[i]!, ...(large ? { large } : {}) };
      x += w;
      return cell;
    });
  };
  return [
    ...row(0, [['company', W]]),
    ...row(1, [['drawingName', 100, true], ['drawingNo', 50], ['revision', 30]]),
    ...row(2, [['material', 50], ['generalTolerance', 60], ['drafter', 40], ['date', 30]]),
    ...row(3, [['scale', 45], ['sheet', 45], ['projection', 90]]),
  ];
}

/** Below what a shrunk title block text is not taken (mm): smaller than ISO 3098's smallest series step is not worth reading. */
export const TITLE_FIT_MIN = 1.8;

/**
 * The width a text takes when written at a cap height (mm): Helvetica's own advances for what the standard PDF font has, one full em for what it has not
 * (CJK and the rest, which the sheet's fonts draw as a full-width box). The same measure the PDF writer lays out with, so what fits on the sheet fits in the PDF.
 */
export function textWidthMm(text: string, height: number): number {
  const em = height / (HELVETICA_CAP_HEIGHT / 1000);
  let thousandths = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    thousandths += helveticaCode(c) === null ? 1000 : helveticaWidth(c);
  }
  return (thousandths / 1000) * em;
}

/** The height a title block text is written at (ADR 0150): the style's, shrunk to the cell when it is wider than the cell and the style fits — never grown, never below `TITLE_FIT_MIN`. */
export function fittedTitleHeight(text: string, height: number, cellWidth: number, fit: boolean): number {
  if (!fit) return height;
  const avail = cellWidth - 3; // the text starts 2 mm inside the cell and leaves 1 mm at its far edge
  const w = textWidthMm(text, height);
  if (w <= avail) return height;
  return Math.max(TITLE_FIT_MIN, (height * avail) / w);
}
