import { t } from '@3db/i18n';
import { cadDrawingBounds, DRAWING_REVISION_FIELDS, page, sheetTemplateOf, type DrawingDoc, type DrawingRevision } from '@3db/model';
import type { SceneItem } from './scene';
import { fittedTitleHeight, INDUSTRIAL_TITLE_BLOCK, sheetMetrics, textWidthMm, TITLE_FIT_MIN, wrapPaperText, type Rect } from './sheet';

const WIDTHS = [21, 29, 68, 25, 28];
const WIDTH = WIDTHS.reduce((sum, width) => sum + width, 0);
const TEXT_HEIGHT = 2;
const LINE_HEIGHT = 3;
const INSET = 2;
const MAX_LINES = 4;
const VISIBLE_REVISIONS = 3;

export const INDUSTRIAL_REV_TABLE = {
  width: 76,
  headerHeight: 7,
  rowHeight: 6,
  rows: 4,
  colWidths: [8, 36, 17, 15] as const,
} as const;

function industrialTableBox(frame: Rect): Rect {
  const height = INDUSTRIAL_REV_TABLE.headerHeight + INDUSTRIAL_REV_TABLE.rows * INDUSTRIAL_REV_TABLE.rowHeight;
  if (frame.w >= INDUSTRIAL_TITLE_BLOCK.width + INDUSTRIAL_REV_TABLE.width + 4) {
    return { x: frame.x, y: frame.y, w: INDUSTRIAL_REV_TABLE.width, h: height };
  }
  return { x: frame.x, y: frame.y + frame.h - height, w: Math.min(INDUSTRIAL_REV_TABLE.width, frame.w), h: height };
}

function fitSingleLine(text: string, baseHeight: number, cellWidth: number): { text: string; height: number } {
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return { text: '', height: baseHeight };
  const height = fittedTitleHeight(trimmed, baseHeight, cellWidth, true);
  const avail = Math.max(1, cellWidth - 3);
  if (textWidthMm(trimmed, height) <= avail) return { text: trimmed, height };
  const chars = [...trimmed];
  while (chars.length > 0 && textWidthMm(chars.join('') + '…', TITLE_FIT_MIN) > avail) chars.pop();
  return { text: chars.length > 0 ? chars.join('').trimEnd() + '…' : '…', height: TITLE_FIT_MIN };
}

function industrialRevisionTableItems(doc: DrawingDoc, frame: Rect): { items: SceneItem[]; box: Rect } {
  const box = industrialTableBox(frame);
  const { x, y, w, h } = box;
  const sx = w / INDUSTRIAL_REV_TABLE.width;
  const cols = INDUSTRIAL_REV_TABLE.colWidths.map((cw) => cw * sx);
  const c0 = x + cols[0]!;
  const c1 = c0 + cols[1]!;
  const c2 = c1 + cols[2]!;
  const right = x + w;
  const top = y + h;
  const hh = INDUSTRIAL_REV_TABLE.headerHeight;
  const rh = INDUSTRIAL_REV_TABLE.rowHeight;
  const items: SceneItem[] = [
    { kind: 'polyline', points: [x, y, right, y, right, top, x, top], style: 'frame', closed: true },
  ];
  for (let i = 0; i < INDUSTRIAL_REV_TABLE.rows; i++) {
    const ry = y + hh + i * rh;
    items.push({ kind: 'polyline', points: [x, ry, right, ry], style: 'thin' });
  }
  for (const cx of [c0, c1, c2]) {
    items.push({ kind: 'polyline', points: [cx, y, cx, top], style: 'thin' });
  }
  // Bottom header row (y .. y + hh)
  const colMid = (start: number, width: number) => start + width / 2;
  items.push({ kind: 'text', at: [colMid(x, cols[0]!), y + 2.3], text: t('drawing.industrial.revItem'), height: 2.3, anchor: 'center' });
  const headerCell = (start: number, width: number, raw: string) => {
    const mx = colMid(start, width);
    const lines = raw.split('\n');
    if (lines.length >= 2) {
      items.push({ kind: 'text', at: [mx, y + 4.1], text: lines[0]!, height: 2.0, anchor: 'center' });
      items.push({ kind: 'text', at: [mx, y + 1.3], text: lines[1]!, height: 1.9, anchor: 'center' });
    } else {
      items.push({ kind: 'text', at: [mx, y + 2.3], text: lines[0]!, height: 2.1, anchor: 'center' });
    }
  };
  headerCell(c0, cols[1]!, t('drawing.industrial.revHeader'));
  headerCell(c1, cols[2]!, t('drawing.industrial.revDate'));
  headerCell(c2, cols[3]!, t('drawing.industrial.revCkd'));

  const entries = doc.revisionHistory ?? [];
  const slots: { entry?: DrawingRevision; step: number }[] =
    entries.length <= 4
      ? [0, 1, 2, 3].map((i) => ({ entry: entries[i], step: i }))
      : [
          { entry: entries[0], step: 0 },
          { entry: entries[entries.length - 3], step: entries.length - 3 },
          { entry: entries[entries.length - 2], step: entries.length - 2 },
          { entry: entries[entries.length - 1], step: entries.length - 1 },
        ];

  slots.forEach(({ entry, step }, i) => {
    const ry = y + hh + i * rh;
    const midX = colMid(x, cols[0]!);
    if (i === 0) {
      items.push({ kind: 'text', at: [midX, ry + 1.8], text: t('drawing.industrial.revOrig'), height: 2.2, anchor: 'center' });
    } else {
      const halfBase = 2.3 * sx;
      items.push({
        kind: 'polyline',
        points: [midX - halfBase, ry + 1.1, midX + halfBase, ry + 1.1, midX, ry + 5.1],
        style: 'thin',
        closed: true,
      });
      items.push({ kind: 'text', at: [midX, ry + 1.65], text: String(step), height: 1.7, anchor: 'center' });
    }
    if (!entry) return;
    const desc = fitSingleLine(entry.description || entry.revision, 2.1, cols[1]!);
    if (desc.text) {
      items.push({ kind: 'text', at: [c0 + 1.5, ry + (rh - desc.height) / 2], text: desc.text, height: desc.height });
    }
    const date = fitSingleLine(entry.date, 2.0, cols[2]!);
    if (date.text) {
      items.push({ kind: 'text', at: [colMid(c1, cols[2]!), ry + (rh - date.height) / 2], text: date.text, height: date.height, anchor: 'center' });
    }
    const author = fitSingleLine(entry.author, 2.0, cols[3]!);
    if (author.text) {
      items.push({ kind: 'text', at: [colMid(c2, cols[3]!), ry + (rh - author.height) / 2], text: author.text, height: author.height, anchor: 'center' });
    }
  });

  return { items, box };
}

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
  const cad = page(doc).cad;
  if (cad) { const bounds = cadDrawingBounds(cad); return { ...metrics, width: bounds.width, height: bounds.height, area: { x: 0, y: 0, w: bounds.width, h: bounds.height } }; }
  if (sheetTemplateOf(page(doc).sheet) === 'industrial') {
    const box = industrialTableBox(metrics.frame);
    if (box.y > metrics.area.y) return { ...metrics, area: { ...metrics.area, h: box.y - INSET - metrics.area.y } };
    return metrics;
  }
  const revisionTable = tableLayout(doc, metrics.frame);
  if (!revisionTable) return metrics;
  return { ...metrics, area: { ...metrics.area, h: revisionTable.box.y - INSET - metrics.area.y } };
}

export function revisionTableItems(doc: DrawingDoc, frame: Rect): { items: SceneItem[]; box: Rect } | undefined {
  if (sheetTemplateOf(page(doc).sheet) === 'industrial') return industrialRevisionTableItems(doc, frame);
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
