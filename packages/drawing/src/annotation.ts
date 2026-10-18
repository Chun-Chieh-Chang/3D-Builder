import { t } from '@3db/i18n';
import type { DrawingView, HoleInfo, HoleTable, ViewFeature } from '@3db/model';
import { datumPlanes } from './autoDimension';
import type { LengthUnit } from '@3db/model';
import { DIM_TEXT, formatNumber, holeNote, holeSignature, lengthNumber, threadedHoleText, toleranceText } from './dimension';
import { clipToCircle } from './geometry';
import { toSheet, type PlacedView } from './layout';
import type { SceneItem } from './scene';
import { sheetMetrics, type Rect } from './sheet';

/**
 * Annotations (C16.5) and tables (C16.6) of the views of a part: the centre marks of its circles and the centre lines of its cylinders, what is written of a hole
 * (through, how deep, its counterbore), and the hole table with the tags beside the holes. All of it is worked out from what the worker found of the part (the
 * features of a view), so it follows the model.
 */

/** How far a centre line passes the edge of what it marks (mm on the sheet). */
export const CENTRE_OVERSHOOT = 2;

/** Whether a view draws its centre marks and lines: when it says so, and otherwise except in a section. */
export const showsCentre = (v: DrawingView): boolean => v.centreMarks ?? v.kind !== 'section';

/**
 * The centre marks and centre lines of a view: for each whole circle a cross reaching `CENTRE_OVERSHOOT` past it, for each whole cylinder seen from the side its
 * axis from end to end and as far past. Each line is drawn in two halves from the middle outward, so that the long dash of the chain line is across the centre.
 * In a detail view only what is inside its circle.
 */
export function centreItems(view: DrawingView, features: readonly ViewFeature[], placed: PlacedView): SceneItem[] {
  if (!showsCentre(view)) return [];
  const ext = CENTRE_OVERSHOOT / placed.scale;
  const halves: [number, number, number, number][] = [];
  const seen: string[] = [];
  for (const f of features) {
    if (f.type === 'circle' && f.full) {
      const [cx, cy] = f.centre;
      const r = f.radius + ext;
      halves.push([cx, cy, cx + r, cy], [cx, cy, cx - r, cy], [cx, cy, cx, cy + r], [cx, cy, cx, cy - r]);
    } else if (f.type === 'axis') {
      const key = [f.from, f.to].map((p) => p.map((v) => Math.round(v * 1e5)).join(',')).sort().join('|');
      if (seen.includes(key)) continue;
      seen.push(key);
      const [fx, fy] = f.from;
      const [tx, ty] = f.to;
      const l = Math.hypot(tx - fx, ty - fy);
      if (l < 1e-9) continue;
      const u = [(tx - fx) / l, (ty - fy) / l];
      const mx = (fx + tx) / 2;
      const my = (fy + ty) / 2;
      halves.push([mx, my, tx + u[0]! * ext, ty + u[1]! * ext], [mx, my, fx - u[0]! * ext, fy - u[1]! * ext]);
    }
  }
  const out: SceneItem[] = [];
  for (const h of halves) {
    const pieces = view.kind === 'detail' ? clipToCircle(h, view.centre, view.radius) : [h];
    for (const piece of pieces) {
      const pts: number[] = [];
      for (let i = 0; i < piece.length; i += 2) pts.push(...toSheet(placed, piece[i]!, piece[i + 1]!));
      out.push({ kind: 'polyline', points: pts, style: 'center' });
    }
  }
  return out;
}

/** The major diameter of a metric thread from its label (「M6」 → 6, 「M10x1.25」 → 10); null for a label that does not say it. */
export function threadMajor(size: string | undefined): number | null {
  const m = size ? /^M\s*(\d+(?:\.\d+)?)/i.exec(size.trim()) : null;
  return m ? Number(m[1]) : null;
}

/**
 * The thread of a tapped hole seen end on (ISO 6410-1, D-I3): a thin arc of about three quarters of a circle at the major diameter, outside the tap drill the
 * model has, open at the upper right. Only where the thread's label says its major diameter: a thread of a typed size has none to draw, and none is made up.
 */
export function threadItems(view: DrawingView, features: readonly ViewFeature[], placed: PlacedView): SceneItem[] {
  const out: SceneItem[] = [];
  for (const f of features) {
    if (f.type !== 'circle' || !f.full) continue;
    let r = 0;
    if (f.thread) {
      r = f.thread.threadType === 'external' ? f.thread.minorDiameter / 2 : f.thread.majorDiameter / 2;
    } else if (f.hole?.thread) {
      const major = threadMajor(f.hole.thread.size);
      if (major !== null && major / 2 > f.radius) r = major / 2;
    }
    if (r <= 0) continue;
    const arc: number[] = [];
    for (let i = 0; i <= 54; i++) {
      const a = Math.PI / 2 + ((3 * Math.PI) / 2) * (i / 54);
      arc.push(f.centre[0] + r * Math.cos(a), f.centre[1] + r * Math.sin(a));
    }
    const pieces = view.kind === 'detail' ? clipToCircle(arc, view.centre, view.radius) : [arc];
    for (const piece of pieces) {
      const pts: number[] = [];
      for (let i = 0; i < piece.length; i += 2) pts.push(...toSheet(placed, piece[i]!, piece[i + 1]!));
      out.push({ kind: 'polyline', points: pts, style: 'thin' });
    }
  }
  return out;
}

// ---------------------------------------------------------------- the hole table

export interface HoleRow {
  /** 「A1」: the letter of the size (the biggest is A) and the number of the hole among those of that size. */
  tag: string;
  /** mm, from the left and bottom planes of the view (the model's origin when the view has none). */
  x: number;
  y: number;
  /** 「Ø9 貫穿」, 「Ø6 H7 (+0.012/0) 深 12」. */
  size: string;
  /** Where the hole is and how big it is in the view's coordinates (to write its tag by). */
  centre: [number, number];
  radius: number;
}

const letters = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : `G${i + 1}`);

/**
 * The holes of a view as the rows of its table: every whole concave circle that the model says is a hole, in groups of one size (diameter, through or
 * how deep, counterbore) from the biggest, each group a letter; the holes of a group numbered from the top left. Where each is is measured from the left and
 * bottom planes of the view, the way the automatic dimensions do.
 */
export function holeRows(features: readonly ViewFeature[], fits: Record<string, string> = {}, unit: LengthUnit = 'mm'): HoleRow[] {
  const holes = features.flatMap((f) => (f.type === 'circle' && f.full && !f.convex && f.hole ? [{ f, hole: f.hole }] : []));
  const datum = datumPlanes(features);
  const ox = datum.minX?.coord ?? 0;
  const oy = datum.minY?.coord ?? 0;
  const key = (r: number, h: HoleInfo) => `${Math.round(2 * r * 1e4)}|${holeSignature(h)}`;
  const groups = new Map<string, typeof holes>();
  for (const h of holes) groups.set(key(h.f.type === 'circle' ? h.f.radius : 0, h.hole), [...(groups.get(key(h.f.type === 'circle' ? h.f.radius : 0, h.hole)) ?? []), h]);
  const ordered = [...groups.values()].sort((a, b) => {
    const ra = a[0]!.f.type === 'circle' ? a[0]!.f.radius : 0;
    const rb = b[0]!.f.type === 'circle' ? b[0]!.f.radius : 0;
    return rb - ra || Number(b[0]!.hole.through) - Number(a[0]!.hole.through) || a[0]!.hole.depth - b[0]!.hole.depth;
  });
  const rows: HoleRow[] = [];
  ordered.forEach((g, gi) => {
    const first = g[0]!;
    const radius = first.f.type === 'circle' ? first.f.radius : 0;
    const d = 2 * radius;
    const fit = fits[formatNumber(d)]; // the fits are told by the diameter in millimetres, whatever the unit written
    const size = threadedHoleText(first.hole, d, unit) ?? [`Ø${lengthNumber(d, 3, unit)}`, ...(fit ? [toleranceText({ type: 'fit', fit }, d, unit)] : []), holeNote(first.hole, unit)].join(' ');
    const sorted = [...g].sort((a, b) => {
      const ca = a.f.type === 'circle' ? a.f.centre : [0, 0];
      const cb = b.f.type === 'circle' ? b.f.centre : [0, 0];
      return Math.abs(ca[1]! - cb[1]!) > 1e-6 ? cb[1]! - ca[1]! : ca[0]! - cb[0]!;
    });
    sorted.forEach((h, i) => {
      if (h.f.type !== 'circle') return;
      rows.push({ tag: `${letters(gi)}${i + 1}`, x: h.f.centre[0] - ox, y: h.f.centre[1] - oy, size, centre: h.f.centre, radius: h.f.radius });
    });
  });
  return rows;
}

const ROW = 6;
const TEXT = DIM_TEXT;
/** A text is drawn with a font 1.4 times its height (svg.ts): a Chinese character is as wide as that font is tall, any other about 0.62 of the height. */
const charWidth = (text: string) => [...text].reduce((w, c) => w + (c.charCodeAt(0) > 0x2e80 ? 1.4 : 0.62) * TEXT, 0);

/** Where a table's upper left corner goes when it has no place of its own: the upper right corner of the drawing area. */
export function defaultTableAt(area: Rect, width: number): [number, number] {
  return [area.x + area.w - width, area.y + area.h];
}

/** The hole table as lines and text, and the tags written beside the holes in the view. */
function holeTableLayout(rows: readonly HoleRow[], unit: LengthUnit) {
  const headers = [t('drawing.table.tag'), 'X', 'Y', t('drawing.table.size')];
  const body = rows.map((r) => [r.tag, lengthNumber(r.x, 2, unit), lengthNumber(r.y, 2, unit), r.size]);
  const widths = headers.map((h, c) => Math.max(c === 0 ? 12 : 18, ...[h, ...body.map((row) => row[c]!)].map((s) => charWidth(s) + 4)));
  return { headers, body, widths, width: widths.reduce((a, b) => a + b, 0), height: ROW * (body.length + 1) };
}

/** Where the hole table is on the sheet: its lower left corner and its size (mm). */
export function holeTableBox(table: HoleTable, rows: readonly HoleRow[], sheet: Parameters<typeof sheetMetrics>[0], unit: LengthUnit = 'mm'): Rect {
  const { width, height } = holeTableLayout(rows, unit);
  const [x0, top] = table.at ?? defaultTableAt(sheetMetrics(sheet).area, width);
  return { x: x0, y: top - height, w: width, h: height };
}

export function holeTableItems(table: HoleTable, rows: readonly HoleRow[], placed: PlacedView, sheet: Parameters<typeof sheetMetrics>[0], unit: LengthUnit = 'mm'): SceneItem[] {
  const items: SceneItem[] = [];
  // the tags beside the holes: up and to the right of the circle
  for (const r of rows) {
    const [sx, sy] = toSheet(placed, r.centre[0], r.centre[1]);
    const d = r.radius * placed.scale * Math.SQRT1_2 + 1;
    items.push({ kind: 'text', at: [sx + d, sy + d], text: r.tag, height: TEXT });
  }
  const { headers, body, widths, width, height } = holeTableLayout(rows, unit);
  const [x0, top] = table.at ?? defaultTableAt(sheetMetrics(sheet).area, width);
  const y0 = top - height;
  const poly = (pts: number[], style: 'visible' | 'thin', closed = false): SceneItem => ({ kind: 'polyline', points: pts, style, ...(closed ? { closed: true } : {}) });
  items.push(poly([x0, y0, x0 + width, y0, x0 + width, top, x0, top], 'visible', true));
  for (let i = 1; i <= body.length; i++) items.push(poly([x0, top - i * ROW, x0 + width, top - i * ROW], i === 1 ? 'visible' : 'thin'));
  let x = x0;
  widths.forEach((w, c) => {
    if (c > 0) items.push(poly([x, y0, x, top], 'thin'));
    [headers, ...body].forEach((row, i) => items.push({ kind: 'text', at: [x + 2, top - (i + 1) * ROW + 1.8], text: row[c]!, height: TEXT }));
    x += w;
  });
  return items;
}
