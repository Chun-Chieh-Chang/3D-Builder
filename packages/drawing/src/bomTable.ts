import { t } from '@3db/i18n';
import type { BomRow, BomTable } from '@3db/model';
import { DIM_TEXT } from './dimension';
import { toSheet, type PlacedView } from './layout';
import { circlePolyline } from './geometry';
import type { SceneItem } from './scene';
import { sheetMetrics, type Rect } from './sheet';

/**
 * The parts list of an assembly drawing as a table, and the balloons that tie each item to its part in the view (C16.6, C15.16). The rows are the flat parts list
 * of the assembly (`buildBom`); where a part is in the view comes from the worker (`anchors`: the middle of each part's mass, in the view's coordinates).
 */

/** What a view of an assembly says of what it shows: the rows of the parts list, and the parts the view was made of (in the order its anchors are). */
export interface ViewBom {
  rows: readonly BomRow[];
  parts: readonly { file?: string; mirrored: boolean }[];
}

const ROW = 7;
const TEXT = DIM_TEXT;
/** A text is drawn with a font 1.4 times its height (svg.ts): a Chinese character is as wide as that font is tall, any other about 0.62 of the height. */
const charWidth = (text: string) => [...text].reduce((w, c) => w + (c.charCodeAt(0) > 0x2e80 ? 1.4 : 0.62) * TEXT, 0);

/** The columns of the table: the item and the quantity always, the part number and the vendor when any part has one. */
export function bomColumns(rows: readonly BomRow[]): { header: string; cell: (r: BomRow) => string }[] {
  const columns = [
    { header: t('bom.item'), cell: (r: BomRow) => r.item },
    { header: t('bom.name'), cell: (r: BomRow) => r.name },
  ];
  if (rows.some((r) => r.partNo)) columns.push({ header: t('bom.partNo'), cell: (r) => r.partNo });
  if (rows.some((r) => r.vendor)) columns.push({ header: t('bom.vendor'), cell: (r) => r.vendor });
  columns.push({ header: t('bom.qty'), cell: (r) => String(r.qty) });
  return columns;
}

/** The size the table takes (mm), from what is written in it. */
export function bomTableSize(rows: readonly BomRow[]): { widths: number[]; width: number; height: number } {
  const columns = bomColumns(rows);
  const widths = columns.map((c, i) => Math.max(i === 0 ? 12 : 14, ...[c.header, ...rows.map(c.cell)].map((s) => charWidth(s) + 4)));
  return { widths, width: widths.reduce((a, b) => a + b, 0), height: ROW * (rows.length + 1) };
}

/** Where a parts list goes when it has no place of its own: the lower right corner of the drawing area, above the title block. */
export function defaultBomAt(area: Rect, size: { width: number; height: number }): [number, number] {
  return [area.x + area.w - size.width, area.y + size.height];
}

/** The table of the parts list: the header over the rows, the outer line and the line under the header heavier. */
export function bomTableItems(table: BomTable, rows: readonly BomRow[], sheet: Parameters<typeof sheetMetrics>[0]): SceneItem[] {
  const columns = bomColumns(rows);
  const size = bomTableSize(rows);
  const [x0, top] = table.at ?? defaultBomAt(sheetMetrics(sheet).area, size);
  const y0 = top - size.height;
  const items: SceneItem[] = [{ kind: 'polyline', points: [x0, y0, x0 + size.width, y0, x0 + size.width, top, x0, top], style: 'visible', closed: true }];
  for (let i = 1; i <= rows.length; i++) items.push({ kind: 'polyline', points: [x0, top - i * ROW, x0 + size.width, top - i * ROW], style: i === 1 ? 'visible' : 'thin' });
  let x = x0;
  columns.forEach((c, ci) => {
    if (ci > 0) items.push({ kind: 'polyline', points: [x, y0, x, top], style: 'thin' });
    [c.header, ...rows.map(c.cell)].forEach((text, i) => items.push({ kind: 'text', at: [x + 2, top - (i + 1) * ROW + 2.2], text, height: TEXT }));
    x += size.widths[ci]!;
  });
  return items;
}

/** The radius of a balloon and the distance of its circle from the view (mm on the sheet), and how far apart two balloons are kept. */
export const BALLOON_RADIUS = 4;
const BALLOON_MARGIN = 12;
const BALLOON_APART = 2 * BALLOON_RADIUS + 1;

/** Where the table is on the sheet: its lower left corner and its size (mm). */
export function bomTableBox(table: BomTable, rows: readonly BomRow[], sheet: Parameters<typeof sheetMetrics>[0]): Rect {
  const size = bomTableSize(rows);
  const [x0, top] = table.at ?? defaultBomAt(sheetMetrics(sheet).area, size);
  return { x: x0, y: top - size.height, w: size.width, h: size.height };
}

/** A balloon: its item, the dot on the part, and the centre of its circle (all on the sheet, mm). */
export interface BalloonSpot {
  item: string;
  anchor: [number, number];
  centre: [number, number];
}

/**
 * Where the balloons of a view of an assembly are: for each item of the parts list that has a part in the view, a circle with the item number outside the view box,
 * on the line from the middle of the view through the dot (where the mass of the part is), slid along the box when another is in the way. A balloon the user moved
 * (`moved`, by item) is where they put it, and the others keep clear of it.
 */
export function balloonSpots(bom: ViewBom, anchors: readonly [number, number][] | undefined, placed: PlacedView, moved: Readonly<Record<string, [number, number]>> = {}): BalloonSpot[] {
  if (!anchors) return [];
  const halfW = placed.w / 2 + BALLOON_MARGIN;
  const halfH = placed.h / 2 + BALLOON_MARGIN;
  const rows: { item: string; anchor: [number, number] }[] = [];
  for (const row of bom.rows) {
    const index = bom.parts.findIndex((p) => p.file === row.path && p.mirrored === row.mirrored);
    const anchor = index < 0 ? undefined : anchors[index];
    if (anchor) rows.push({ item: row.item, anchor: toSheet(placed, anchor[0], anchor[1]) });
  }
  const taken: [number, number][] = rows.flatMap((r) => (moved[r.item] ? [moved[r.item]!] : []));
  return rows.map(({ item, anchor: a }) => {
    if (moved[item]) return { item, anchor: a, centre: moved[item]! };
    let dx = a[0] - placed.at[0];
    let dy = a[1] - placed.at[1];
    if (Math.hypot(dx, dy) < 1e-9) dy = 1;
    const l = Math.hypot(dx, dy);
    dx /= l;
    dy /= l;
    const tx = Math.abs(dx) > 1e-9 ? halfW / Math.abs(dx) : Infinity;
    const ty = Math.abs(dy) > 1e-9 ? halfH / Math.abs(dy) : Infinity;
    const horizontalEdge = ty <= tx; // the ray leaves through the top or bottom
    const reach = Math.min(tx, ty);
    const base: [number, number] = [placed.at[0] + dx * reach, placed.at[1] + dy * reach];
    // slide along the edge (alternating sides) until clear of the balloons already placed
    let centre = base;
    for (let k = 0; k < 64; k++) {
      const shift = Math.ceil(k / 2) * BALLOON_APART * (k % 2 === 1 ? 1 : -1);
      centre = horizontalEdge ? [base[0] + shift, base[1]] : [base[0], base[1] + shift];
      if (taken.every((c) => Math.hypot(c[0] - centre[0], c[1] - centre[1]) >= BALLOON_APART)) break;
    }
    taken.push(centre);
    return { item, anchor: a, centre };
  });
}

/** The balloons as drawn: the circle with the item number, the leader and the dot on the part. */
export function spotItems(spots: readonly BalloonSpot[]): SceneItem[] {
  const items: SceneItem[] = [];
  for (const { item, anchor: a, centre } of spots) {
    const ex = centre[0] - a[0];
    const ey = centre[1] - a[1];
    const el = Math.hypot(ex, ey) || 1;
    const edge: [number, number] = [centre[0] - (ex / el) * BALLOON_RADIUS, centre[1] - (ey / el) * BALLOON_RADIUS];
    items.push({ kind: 'polyline', points: [...a, ...edge], style: 'thin' });
    items.push({ kind: 'polyline', points: circlePolyline(a, 0.6, 12), style: 'thin', closed: true, filled: true });
    items.push({ kind: 'polyline', points: circlePolyline(centre, BALLOON_RADIUS, 36), style: 'thin', closed: true });
    items.push({ kind: 'text', at: [centre[0], centre[1] - TEXT * 0.35], text: item, height: TEXT, anchor: 'center' });
  }
  return items;
}

