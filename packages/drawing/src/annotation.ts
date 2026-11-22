import { t } from '@3db/i18n';
import { displayOf, isShaded, normalizedViewAxes, rightOf, sheetUp, type DrawingView, type HoleTable, type ViewAxes, type ViewFeature } from '@3db/model';
import { datumPlanes } from './autoDimension';
import type { LengthUnit, CalloutStyle } from '@3db/model';
import { DIM_TEXT, cosmeticThreadText, formatNumber, holeNote, holeSignature, lengthNumber, threadedHoleText, threadSignature, toleranceText } from './dimension';
import { clipToBand, clipToCircle, clipToOutline } from './geometry';
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

/** Whether a view draws its centre marks and lines: by default on every view (including sections), unless turned off on the view. */
export const showsCentre = (v: DrawingView): boolean => v.centreMarks ?? true;

/**
 * The centre marks and centre lines of a view: for each whole circle a cross reaching `CENTRE_OVERSHOOT` past it, for each whole cylinder seen from the side its
 * axis from end to end and as far past. Each line is drawn in two halves from the middle outward, so that the long dash of the chain line is across the centre.
 * In a detail view only what is inside its circle.
 */
export function centreItems(view: DrawingView, features: readonly ViewFeature[], placed: PlacedView): SceneItem[] {
  if (!showsCentre(view)) return [];
  const ext = CENTRE_OVERSHOOT / placed.scale;
  const halves: [number, number, number, number][] = [];
  // Concentric whole circles, end-on cones and spheres share one centre cross sized to the largest radius at that centre (ISO 128-24, ADR 0262 rule L2).
  const circlesByCentre: { cx: number; cy: number; radius: number }[] = [];
  for (const f of features) {
    if (!((f.type === 'circle' && f.full) || f.type === 'centre')) continue;
    const prev = circlesByCentre.find((c) => Math.hypot(c.cx - f.centre[0], c.cy - f.centre[1]) <= 1e-2);
    if (!prev) {
      circlesByCentre.push({ cx: f.centre[0], cy: f.centre[1], radius: f.radius });
    } else if (f.radius > prev.radius) {
      prev.cx = f.centre[0];
      prev.cy = f.centre[1];
      prev.radius = f.radius;
    }
  }
  for (const { cx, cy, radius } of circlesByCentre) {
    const r = radius + ext;
    halves.push([cx, cy, cx + r, cy], [cx, cy, cx - r, cy], [cx, cy, cx, cy + r], [cx, cy, cx, cy - r]);
  }
  // Coaxial cylinders and cones along the same line merge into one axis line spanning their combined extent (ISO 128-24, ADR 0262 rule L1).
  const axes: { u: [number, number]; p0: [number, number]; tMin: number; tMax: number }[] = [];
  for (const f of features) {
    if (f.type !== 'axis') continue;
    const [fx, fy] = f.from;
    const [tx, ty] = f.to;
    const l = Math.hypot(tx - fx, ty - fy);
    if (l < 1e-9) continue;
    let ux = (tx - fx) / l;
    let uy = (ty - fy) / l;
    if (Math.abs(ux) > 1e-4 ? ux < 0 : uy < 0) {
      ux = -ux;
      uy = -uy;
    }
    const t0 = fx * ux + fy * uy;
    const t1 = tx * ux + ty * uy;
    const lo = Math.min(t0, t1);
    const hi = Math.max(t0, t1);
    const hit = axes.find((a) => {
      const dotU = Math.abs(a.u[0] * ux + a.u[1] * uy);
      if (dotU < 1 - 1e-4) return false;
      const dx = fx - a.p0[0];
      const dy = fy - a.p0[1];
      return Math.abs(dx * a.u[1] - dy * a.u[0]) <= 1e-3;
    });
    if (hit) {
      hit.tMin = Math.min(hit.tMin, lo);
      hit.tMax = Math.max(hit.tMax, hi);
    } else {
      axes.push({ u: [ux, uy], p0: [fx - t0 * ux, fy - t0 * uy], tMin: lo, tMax: hi });
    }
  }
  for (const a of axes) {
    const fx = a.p0[0] + a.tMin * a.u[0];
    const fy = a.p0[1] + a.tMin * a.u[1];
    const tx = a.p0[0] + a.tMax * a.u[0];
    const ty = a.p0[1] + a.tMax * a.u[1];
    const mx = (fx + tx) / 2;
    const my = (fy + ty) / 2;
    halves.push([mx, my, tx + a.u[0] * ext, ty + a.u[1] * ext], [mx, my, fx - a.u[0] * ext, fy - a.u[1] * ext]);
  }
  const brk = placed.break;
  const clipPiece = (line: readonly number[]): readonly (readonly number[])[] => {
    const first = view.kind === 'detail' ? clipToCircle(line, view.centre, view.radius) : view.kind === 'crop' ? clipToOutline(line, view.outline) : [line];
    return brk ? first.flatMap((p) => clipToBand(p, brk.axis, brk.from, brk.to)) : first;
  };
  const out: SceneItem[] = [];
  for (const h of halves) {
    for (const piece of clipPiece(h)) {
      const pts: number[] = [];
      for (let i = 0; i < piece.length; i += 2) pts.push(...toSheet(placed, piece[i]!, piece[i + 1]!));
      out.push({ kind: 'polyline', points: pts, style: 'center' });
    }
  }
  // Bolt circle (PCD) centreline: >= 3 equal-radius full holes equally spaced on a common circle (for N=4, also require a concentric circular feature to avoid plain square plates)
  const holesByR = new Map<number, { cx: number; cy: number; radius: number }[]>();
  for (const f of features) {
    if (f.type !== 'circle' || !f.full || f.convex) continue;
    const rk = Math.round(f.radius * 1e3);
    const list = holesByR.get(rk) ?? [];
    if (!list.some((h) => Math.hypot(h.cx - f.centre[0], h.cy - f.centre[1]) <= 1e-2)) {
      list.push({ cx: f.centre[0], cy: f.centre[1], radius: f.radius });
      holesByR.set(rk, list);
    }
  }
  const drawnPcd = new Set<string>();
  for (const group of holesByR.values()) {
    const n = group.length;
    if (n < 3) continue;
    const cx = group.reduce((s, h) => s + h.cx, 0) / n;
    const cy = group.reduce((s, h) => s + h.cy, 0) / n;
    const dists = group.map((h) => Math.hypot(h.cx - cx, h.cy - cy));
    const R = dists.reduce((s, d) => s + d, 0) / n;
    if (R < 2 || dists.some((d) => Math.abs(d - R) > 1e-2 * Math.max(1, R))) continue;
    const angles = group.map((h) => {
      const a = Math.atan2(h.cy - cy, h.cx - cx);
      return a < 0 ? a + 2 * Math.PI : a;
    }).sort((a, b) => a - b);
    const step = (2 * Math.PI) / n;
    const equalGaps = angles.every((a, i) => {
      const next = i + 1 < n ? angles[i + 1]! : angles[0]! + 2 * Math.PI;
      return Math.abs(next - a - step) <= 0.01;
    });
    if (!equalGaps) continue;
    if (n === 4 && !circlesByCentre.some((c) => Math.hypot(c.cx - cx, c.cy - cy) <= 1e-2)) continue;
    const key = `${Math.round(cx * 100)},${Math.round(cy * 100)},${Math.round(R * 100)}`;
    if (drawnPcd.has(key)) continue;
    drawnPcd.add(key);
    const ring: number[] = [];
    for (let i = 0; i <= 72; i++) {
      const a = (2 * Math.PI * i) / 72;
      ring.push(cx + R * Math.cos(a), cy + R * Math.sin(a));
    }
    for (const piece of clipPiece(ring)) {
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
 * The thread of a tapped hole or cosmetic thread (ISO 6410-1, D-I3):
 * - Seen end on (`circle`): a thin arc of three quarters of a circle at the minor (external) or major (internal) diameter, open at the upper right.
 * - Seen from the side / in section (`axis`): two parallel thin lines at ±thread radius along the threaded span, plus a thick thread-limit line across the
 *   major diameter when the thread is blind and ends before the cylinder's end.
 */
export function threadItems(view: DrawingView, features: readonly ViewFeature[], placed: PlacedView, axes?: ViewAxes): SceneItem[] {
  const out: SceneItem[] = [];
  const brk = placed.break;
  const emit = (line: readonly number[], style: 'thin' | 'visible') => {
    const first = view.kind === 'detail' ? clipToCircle(line, view.centre, view.radius) : view.kind === 'crop' ? clipToOutline(line, view.outline) : [line];
    const pieces = brk ? first.flatMap((p) => clipToBand(p, brk.axis, brk.from, brk.to)) : first;
    for (const piece of pieces) {
      const pts: number[] = [];
      for (let i = 0; i < piece.length; i += 2) pts.push(...toSheet(placed, piece[i]!, piece[i + 1]!));
      out.push({ kind: 'polyline', points: pts, style });
    }
  };
  const showSideThreads = !isShaded(displayOf(view));
  const normAxes = axes ? normalizedViewAxes(axes) : null;
  const right = normAxes ? rightOf(normAxes) : null;
  const up = normAxes ? sheetUp(normAxes) : null;
  for (const f of features) {
    if (f.type === 'circle' && f.full) {
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
      emit(arc, 'thin');
    } else if (showSideThreads && f.type === 'axis' && (f.thread || f.hole?.thread)) {
      let r = 0;
      if (f.thread) {
        r = f.thread.threadType === 'external' ? f.thread.minorDiameter / 2 : f.thread.majorDiameter / 2;
      } else if (f.hole?.thread) {
        const major = threadMajor(f.hole.thread.size);
        if (major !== null && major / 2 > f.radius) r = major / 2;
      }
      if (r <= 0) continue;
      const [fx, fy] = f.from;
      const [tx, ty] = f.to;
      const len = Math.hypot(tx - fx, ty - fy);
      if (len < 1e-6) continue;
      let start: [number, number] = [fx, fy];
      let end: [number, number] = [tx, ty];
      let isBlindLimit = false;
      if (f.thread?.endCondition === 'blind' && f.thread.depth > 1e-6 && f.thread.depth < len - 1e-3) {
        if (right && up && f.thread.origin && f.thread.axis) {
          const o = f.thread.origin;
          const a = f.thread.axis;
          const d = f.thread.depth;
          start = [o[0] * right[0] + o[1] * right[1] + o[2] * right[2], o[0] * up[0] + o[1] * up[1] + o[2] * up[2]];
          end = [
            (o[0] + a[0] * d) * right[0] + (o[1] + a[1] * d) * right[1] + (o[2] + a[2] * d) * right[2],
            (o[0] + a[0] * d) * up[0] + (o[1] + a[1] * d) * up[1] + (o[2] + a[2] * d) * up[2],
          ];
        } else {
          const ux = (tx - fx) / len;
          const uy = (ty - fy) / len;
          end = [fx + ux * f.thread.depth, fy + uy * f.thread.depth];
        }
        isBlindLimit = true;
      }
      const segLen = Math.hypot(end[0] - start[0], end[1] - start[1]);
      if (segLen < 1e-6) continue;
      const nx = -(end[1] - start[1]) / segLen;
      const ny = (end[0] - start[0]) / segLen;
      emit([start[0] + nx * r, start[1] + ny * r, end[0] + nx * r, end[1] + ny * r], 'thin');
      emit([start[0] - nx * r, start[1] - ny * r, end[0] - nx * r, end[1] - ny * r], 'thin');
      if (isBlindLimit) {
        const limitR = Math.max(f.radius, r);
        emit([end[0] - nx * limitR, end[1] - ny * limitR, end[0] + nx * limitR, end[1] + ny * limitR], 'visible');
      }
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
export function holeRows(features: readonly ViewFeature[], fits: Record<string, string> = {}, unit: LengthUnit = 'mm', style: CalloutStyle = 'text'): HoleRow[] {
  const holes = features.flatMap((f) => (f.type === 'circle' && f.full && !f.convex && f.hole ? [{ f, hole: f.hole }] : []));
  const datum = datumPlanes(features);
  const ox = datum.minX?.coord ?? 0;
  const oy = datum.minY?.coord ?? 0;
  const key = (h: (typeof holes)[number]) => `${Math.round(2 * (h.f.type === 'circle' ? h.f.radius : 0) * 1e4)}|${holeSignature(h.hole)}|${threadSignature(h.f.type === 'circle' ? h.f.thread : undefined)}`;
  const groups = new Map<string, typeof holes>();
  for (const h of holes) groups.set(key(h), [...(groups.get(key(h)) ?? []), h]);
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
    const thread = first.f.type === 'circle' ? first.f.thread : undefined;
    const size = thread ? `${cosmeticThreadText(thread, unit, style, first.hole)}${t('drawing.threadDrill', { diameter: lengthNumber(d, 3, unit), note: holeNote(first.hole, unit, style) })}`
      : threadedHoleText(first.hole, d, unit, style) ?? [`Ø${lengthNumber(d, 3, unit)}`, ...(fit ? [toleranceText({ type: 'fit', fit }, d, unit)] : []), holeNote(first.hole, unit, style)].join(' ');
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
export function holeTableBox(table: HoleTable, rows: readonly HoleRow[], sheet: Parameters<typeof sheetMetrics>[0], unit: LengthUnit = 'mm', area = sheetMetrics(sheet).area): Rect {
  const { width, height } = holeTableLayout(rows, unit);
  const [x0, top] = table.at ?? defaultTableAt(area, width);
  return { x: x0, y: top - height, w: width, h: height };
}

export function holeTableItems(table: HoleTable, rows: readonly HoleRow[], placed: PlacedView, sheet: Parameters<typeof sheetMetrics>[0], unit: LengthUnit = 'mm', area = sheetMetrics(sheet).area): SceneItem[] {
  const items: SceneItem[] = [];
  // the tags beside the holes: up and to the right of the circle
  for (const r of rows) {
    const [sx, sy] = toSheet(placed, r.centre[0], r.centre[1]);
    const d = r.radius * placed.scale * Math.SQRT1_2 + 1;
    items.push({ kind: 'text', at: [sx + d, sy + d], text: r.tag, height: TEXT });
  }
  const { headers, body, widths, width, height } = holeTableLayout(rows, unit);
  const [x0, top] = table.at ?? defaultTableAt(area, width);
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
