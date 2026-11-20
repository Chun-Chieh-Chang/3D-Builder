import type { DrawingView, Id } from '@3db/model';
import { itemsBounds } from './fit';
import { STANDARD_SCALES, ratio, type PlacedView } from './layout';
import type { SceneItem } from './scene';
import type { Rect } from './sheet';

/**
 * How a page is laid out, measured on what is drawn (ADR 0261, drawing rules P1–P4, V1, V4–V6). Every number is taken from the scene's items and the placed views,
 * not from the layout's own arithmetic, so a layout that is wrong in a way its own code does not know is still seen.
 */

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface LayoutMetricsInput {
  /** What the views draw: the scene's items without the sheet's frame and title block. */
  items: readonly SceneItem[];
  views: readonly DrawingView[];
  placed: ReadonlyMap<Id, PlacedView>;
  /** The view each dimension (by id) is drawn on: the `group` of the items drawn for it. */
  dimensionView: ReadonlyMap<string, string>;
  /** Where the views go: the sheet's area (inside the frame, above the title block). */
  area: Rect;
}

export interface ViewMetrics {
  id: Id;
  kind: string;
  /** The view's own box on the sheet. */
  box: Box;
  /** The box round the view and what is drawn for it: its dimensions, its caption, its marks. */
  drawn: Box;
  /** How far the dimensions and the caption reach beyond the view's own box, on each side (mm). */
  reach: { left: number; right: number; below: number; above: number };
}

export interface Clearance {
  a: Id;
  b: Id;
  /** `x`: side by side; `y`: one above the other; `both`: their drawn boxes overlap. */
  axis: 'x' | 'y' | 'both';
  /** The distance between the two drawn boxes (mm); negative when they overlap. */
  gap: number;
  /** The signed gap along x and along y alone (mm): negative where the boxes share a stretch of that axis. A view is moved apart along the axis it can slide on. */
  gx: number;
  gy: number;
}

export interface DetailMetrics {
  id: Id;
  parent: Id;
  /** The distance between the drawn boxes of the detail and of its parent (mm); 0 when they touch or overlap. */
  distance: number;
  /** The diagonal of the parent's box (mm): how far away is still beside it. */
  parentDiagonal: number;
  /** Another view's box lies on the line between the two. */
  blocked: boolean;
  /** The length of what the detail draws (mm on the sheet) and the length of its circle: a detail with next to nothing in it has a small ratio. */
  ink: number;
  perimeter: number;
  inkRatio: number;
}

export interface LayoutMetrics {
  views: ViewMetrics[];
  /** Everything drawn on the page (views, dimensions, captions, tables). */
  used: Box | null;
  /** The share of the area's width and of its height that what is drawn takes. */
  fillW: number;
  fillH: number;
  /** The share of the area the views' own boxes take together. */
  viewAreaFill: number;
  /** The nearest two views come to each other, by their drawn boxes (mm); null when there are fewer than two. */
  minClearance: number | null;
  clearances: Clearance[];
  details: DetailMetrics[];
  /** Views drawn at a scale that is not a standard one (ISO 5455), by the ratio they are drawn at. */
  nonStandardScales: { id: Id; scale: number }[];
}

const union = (a: Box, b: Box): Box => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });

/** Whether the segment from p to q passes through the inside of the box (Liang–Barsky). */
function segmentCrossesBox(p: readonly [number, number], q: readonly [number, number], b: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  const d = [q[0] - p[0], q[1] - p[1]];
  const edges: [number, number][] = [
    [-d[0]!, p[0] - b.x0],
    [d[0]!, b.x1 - p[0]],
    [-d[1]!, p[1] - b.y0],
    [d[1]!, b.y1 - p[1]],
  ];
  for (const [pk, qk] of edges) {
    if (pk === 0) {
      if (qk <= 0) return false;
    } else {
      const r = qk / pk;
      if (pk < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      if (t0 >= t1) return false;
    }
  }
  return t1 - t0 > 1e-9;
}

/** The distance between two boxes along the axis they are separated on; negative when they overlap on both. */
function gapOf(a: Box, b: Box): { axis: Clearance['axis']; gap: number; gx: number; gy: number } {
  const gx = Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1);
  const gy = Math.max(a.y0, b.y0) - Math.min(a.y1, b.y1);
  if (gx < 0 && gy < 0) return { axis: 'both', gap: Math.max(gx, gy), gx, gy };
  // beside each other: they share a stretch of height (the y gap is negative), and the distance is the x one
  if (gy < 0) return { axis: 'x', gap: gx, gx, gy };
  if (gx < 0) return { axis: 'y', gap: gy, gx, gy };
  return { axis: gx >= gy ? 'x' : 'y', gap: Math.hypot(gx, gy), gx, gy };
}

const round = (v: number, n = 3) => Math.round(v * 10 ** n) / 10 ** n;

/**
 * What a detail view must show: the length of the lines drawn in it at least this share of the length of its circle (rule V6). A line straight across a circle is
 * 0.32 of it and a corner with a rounded edge about 0.4 (measured on a plate with four small radii); a detail with next to nothing in it is 0, and is not made.
 */
export const MIN_DETAIL_INK = 0.25;

/** The least clear space between two views, counting what is drawn for them (mm): twice the height of the dimension text, so a row of numbers fits between (drawing rule V1). */
export const minViewClearance = (dimTextHeight: number): number => 2 * dimTextHeight;

export function layoutMetrics(input: LayoutMetricsInput): LayoutMetrics {
  const { items, views, placed, dimensionView, area } = input;
  const dimsOf = new Map<string, Set<string>>();
  for (const [dim, view] of dimensionView) dimsOf.set(view, (dimsOf.get(view) ?? new Set()).add(dim));
  const out: ViewMetrics[] = [];
  for (const v of views) {
    const p = placed.get(v.id);
    if (!p) continue;
    const box: Box = { x0: p.at[0] - p.w / 2, y0: p.at[1] - p.h / 2, x1: p.at[0] + p.w / 2, y1: p.at[1] + p.h / 2 };
    const dims = dimsOf.get(v.id);
    const own = items.filter((i) => i.owner === `view:${v.id}` || i.owner === `caption:${v.id}` || (i.group !== undefined && dims?.has(i.group)));
    const bounds = itemsBounds(own);
    const drawn = bounds ? union(box, bounds) : box;
    out.push({ id: v.id, kind: v.kind ?? 'model', box, drawn, reach: { left: box.x0 - drawn.x0, right: drawn.x1 - box.x1, below: box.y0 - drawn.y0, above: drawn.y1 - box.y1 } });
  }
  const used = itemsBounds(items);
  const clearances: Clearance[] = [];
  for (let i = 0; i < out.length; i++)
    for (let j = i + 1; j < out.length; j++) {
      const g = gapOf(out[i]!.drawn, out[j]!.drawn);
      clearances.push({ a: out[i]!.id, b: out[j]!.id, axis: g.axis, gap: round(g.gap), gx: round(g.gx), gy: round(g.gy) });
    }
  clearances.sort((a, b) => a.gap - b.gap);

  const byId = new Map(out.map((m) => [m.id, m]));
  const details: DetailMetrics[] = [];
  for (const v of views) {
    if (v.kind !== 'detail') continue;
    const d = byId.get(v.id);
    const parent = byId.get(v.parent);
    if (!d || !parent) continue;
    const g = gapOf(d.drawn, parent.drawn);
    const centre = (b: Box): [number, number] => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
    const blocked = out.some((o) => o.id !== d.id && o.id !== parent.id && o.kind !== 'detail' && segmentCrossesBox(centre(d.box), centre(parent.box), o.box));
    let ink = 0;
    for (const i of items) {
      if (i.kind !== 'polyline' || i.owner !== `view:${v.id}`) continue;
      for (let k = 0; k + 3 < i.points.length; k += 2) ink += Math.hypot(i.points[k + 2]! - i.points[k]!, i.points[k + 3]! - i.points[k + 1]!);
    }
    const w = d.box.x1 - d.box.x0;
    const perimeter = Math.PI * w;
    details.push({
      id: v.id,
      parent: v.parent,
      distance: round(g.gap > 0 ? g.gap : 0),
      parentDiagonal: round(Math.hypot(parent.box.x1 - parent.box.x0, parent.box.y1 - parent.box.y0)),
      blocked,
      ink: round(ink),
      perimeter: round(perimeter),
      inkRatio: perimeter > 0 ? round(ink / perimeter) : 0,
    });
  }

  const standard = STANDARD_SCALES.map(ratio);
  const nonStandardScales = out.flatMap((m) => {
    const s = placed.get(m.id)!.scale;
    return standard.some((r) => Math.abs(r - s) <= 1e-9 * Math.max(1, r)) ? [] : [{ id: m.id, scale: round(s, 6) }];
  });

  return {
    views: out,
    used,
    fillW: used && area.w > 0 ? round((used.x1 - used.x0) / area.w) : 0,
    fillH: used && area.h > 0 ? round((used.y1 - used.y0) / area.h) : 0,
    viewAreaFill: area.w * area.h > 0 ? round(out.reduce((a, m) => a + (m.box.x1 - m.box.x0) * (m.box.y1 - m.box.y0), 0) / (area.w * area.h)) : 0,
    minClearance: clearances.length ? clearances[0]!.gap : null,
    clearances,
    details,
    nonStandardScales,
  };
}
