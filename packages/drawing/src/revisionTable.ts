import { t } from '@3db/i18n';
import { DRAWING_REVISION_FIELDS, page, type DrawingDoc } from '@3db/model';
import type { SceneItem } from './scene';
import { sheetMetrics, textWidthMm, wrapPaperText, type Rect } from './sheet';

const WIDTHS = [21, 29, 68, 25, 28];
const WIDTH = WIDTHS.reduce((sum, width) => sum + width, 0);
const TEXT_HEIGHT = 2;
const LINE_HEIGHT = 3;
const INSET = 2;
const MAX_LINES = 4;
const VISIBLE_REVISIONS = 3;

function cellLines(text: string, width: number): string[] {
  const budget = width - 2 * INSET;
  const lines = wrapPaperText(text, budget, (line) => textWidthMm(line, TEXT_HEIGHT));
  if (lines.length <= MAX_LINES) return lines;
  const visible = lines.slice(0, MAX_LINES);
  const last = [...visible[MAX_LINES - 1]!];
  while (textWidthMm(last.join('') + '…', TEXT_HEIGHT) > budget) last.pop();
  visible[MAX_LINES - 1] = last.join('').trimEnd() + '…';
  return visible;
}

function tableLayout(doc: DrawingDoc, frame: Rect) {
  const entries = doc.revisionHistory ?? [];
  if (!entries.length) return undefined;
  const rows = entries.slice(-VISIBLE_REVISIONS).reverse().map((entry) => {
    const cells = DRAWING_REVISION_FIELDS.map((field, i) => cellLines(entry[field] ?? '', WIDTHS[i]!));
    return { cells, height: Math.max(...cells.map((lines) => lines.length)) * LINE_HEIGHT + 3 };
  });
  const more = entries.length - rows.length;
  const height = 12 + rows.reduce((sum, row) => sum + row.height, 0) + (more ? 6 : 0);
  const top = frame.y + frame.h - INSET;
  return { rows, more, box: { x: frame.x + frame.w - WIDTH - INSET, y: top - height, w: WIDTH, h: height } };
}

export function drawingSheetMetrics(doc: DrawingDoc) {
  const metrics = sheetMetrics(page(doc).sheet);
  const revisionTable = tableLayout(doc, metrics.frame);
  if (!revisionTable) return metrics;
  return { ...metrics, area: { ...metrics.area, h: revisionTable.box.y - INSET - metrics.area.y } };
}

export function revisionTableItems(doc: DrawingDoc, frame: Rect): { items: SceneItem[]; box: Rect } | undefined {
  const layout = tableLayout(doc, frame);
  if (!layout) return undefined;
  const { box, rows, more } = layout;
  const { x, y, w, h } = box;
  const right = x + w;
  const top = y + h;
  const items: SceneItem[] = [
    { kind: 'polyline', points: [x, y, right, y, right, top, x, top], style: 'thin', closed: true },
  ];
  const text = (left: number, bottom: number, value: string) => {
    if (value) items.push({ kind: 'text', at: [left + INSET, bottom], text: value, height: TEXT_HEIGHT });
  };
  const rule = (at: number) => items.push({ kind: 'polyline', points: [x, at, right, at], style: 'thin' });
  const headers = DRAWING_REVISION_FIELDS.map((field) => [t(`drawing.revisions.${field}`)]);
  text(x, top - 4.5, t('drawing.revisions.title'));
  let rowTop = top - 6;
  rule(rowTop);
  let columnLeft = x;
  for (const width of WIDTHS.slice(0, -1)) {
    columnLeft += width;
    items.push({ kind: 'polyline', points: [columnLeft, y + (more ? 6 : 0), columnLeft, rowTop], style: 'thin' });
  }
  for (const row of [{ cells: headers, height: 6 }, ...rows]) {
    let left = x;
    row.cells.forEach((lines, index) => {
      lines.forEach((line, i) => text(left, rowTop - 4.5 - i * LINE_HEIGHT, line));
      left += WIDTHS[index]!;
    });
    rowTop -= row.height;
    if (rowTop > y) rule(rowTop);
  }
  if (more) text(x, y + 1.5, t('drawing.revisions.more', { n: String(more) }));
  return { items, box };
}
