import { isDerived, sectionArrow, sectionSide, type DrawingDoc, type DrawingSheet, type DrawingView, type Id, type Scale, type ViewName, type ViewSide } from '@3db/model';
import { clipToCircle } from './geometry';
import { sheetMetrics, type Rect } from './sheet';

/** What a view needs to be laid out and drawn: its lines at full size, and for a section the outlines of the faces the cut made (to be hatched). */
export interface ViewLines {
  visible: number[][];
  hidden: number[][];
  box: { min: [number, number]; max: [number, number] } | null;
  cut?: number[][];
}

/** A view placed on the sheet: the middle of its box (mm), the scale as a number, and the size it takes (mm). */
export interface PlacedView {
  id: Id;
  at: [number, number];
  scale: number;
  w: number;
  h: number;
  /** The middle of the view's box in view coordinates (full size): what `at` is the sheet position of. */
  centre: [number, number];
}

export const ratio = (s: Scale): number => s[0] / s[1];

/** The scales a drawing is made at (ISO 5455), from the largest. */
export const STANDARD_SCALES: readonly Scale[] = [[50, 1], [20, 1], [10, 1], [5, 1], [2, 1], [1, 1], [1, 2], [1, 5], [1, 10], [1, 20], [1, 50], [1, 100]];

/** The gap between views laid out together (mm), room for the dimensions between them. */
export const VIEW_GAP = 25;

const sizeOf = (g: ViewLines | null | undefined) => (g?.box ? { w: g.box.max[0] - g.box.min[0], h: g.box.max[1] - g.box.min[1], centre: [(g.box.min[0] + g.box.max[0]) / 2, (g.box.min[1] + g.box.max[1]) / 2] as [number, number] } : { w: 0, h: 0, centre: [0, 0] as [number, number] });

/** The scale a view is drawn at: its own, else (a projected or section view) its parent's, else the sheet's. */
export function scaleOf(doc: Pick<DrawingDoc, 'views' | 'sheet'>, view: DrawingView, depth = 0): Scale {
  if (view.scale) return view.scale;
  if (view.kind === 'projected' || view.kind === 'section') {
    const parent = doc.views.find((v) => v.id === view.parent);
    if (parent && depth < 64) return scaleOf(doc, parent, depth + 1);
  }
  return doc.sheet.scale;
}

/**
 * The lines of every view, with the detail views made from their parents': what is inside the circle, the box of the circle (a detail view is as big as its
 * circle, so that its size does not depend on what happens to be in it). A detail of a view with no lines has none.
 */
export function resolveLines(doc: Pick<DrawingDoc, 'views'>, lines: ReadonlyMap<Id, ViewLines | null>): Map<Id, ViewLines | null> {
  const out = new Map<Id, ViewLines | null>();
  for (const v of doc.views) {
    if (v.kind !== 'detail') {
      out.set(v.id, lines.get(v.id) ?? null);
      continue;
    }
    const parent = lines.get(v.parent);
    if (!parent) {
      out.set(v.id, null);
      continue;
    }
    const clip = (ls: number[][]) => ls.flatMap((l) => clipToCircle(l, v.centre, v.radius));
    out.set(v.id, {
      visible: clip(parent.visible),
      hidden: clip(parent.hidden),
      box: { min: [v.centre[0] - v.radius, v.centre[1] - v.radius], max: [v.centre[0] + v.radius, v.centre[1] + v.radius] },
    });
  }
  return out;
}

/** The cell of the grid each view of the orthographic arrangement takes, as columns and rows (y up) from the base view: first angle puts the top view below the front, the right view to its left. */
function cell(view: ViewName, projection: DrawingSheet['projection']): [number, number] {
  const first = projection === 'first';
  switch (view) {
    case 'front':
      return [0, 0];
    case 'top':
      return [0, first ? -1 : 1];
    case 'bottom':
      return [0, first ? 1 : -1];
    case 'right':
      return [first ? -1 : 1, 0];
    case 'left':
      return [first ? 1 : -1, 0];
    case 'back':
      return [first ? 2 : -2, 0];
    case 'isometric':
      return [99, 0]; // beside everything: its column is the one after the last (see below)
  }
}

/**
 * Where the middle of each column (or row) of a grid is, given the size of each: those that are occupied follow one another outward from the base
 * cell (index 0), `VIEW_GAP` apart. The base index is centred on 0.
 */
function offsets(sizes: Map<number, number>): Map<number, number> {
  const out = new Map<number, number>();
  const at = (i: number) => sizes.get(i) ?? 0;
  out.set(0, 0);
  for (const sign of [1, -1]) {
    let edge = at(0) / 2;
    for (const i of [...sizes.keys()].filter((k) => k !== 0 && Math.sign(k) === sign).sort((a, b) => Math.abs(a) - Math.abs(b))) {
      out.set(i, sign * (edge + VIEW_GAP + at(i) / 2));
      edge += VIEW_GAP + at(i);
    }
  }
  return out;
}

interface Measured {
  view: DrawingView;
  scale: number;
  w: number;
  h: number;
  centre: [number, number];
}

/** The side of its parent a derived view goes on. */
function sideOf(doc: Pick<DrawingDoc, 'sheet'>, v: Exclude<DrawingView, { kind?: 'model' }>): ViewSide {
  if (v.kind === 'projected') return v.side;
  if (v.kind === 'section') return sectionSide(sectionArrow(v), doc.sheet.projection);
  return 'right'; // a detail: beside its parent
}

/**
 * Lays the views of a drawing out (C16.2, C16.3). A view with a position of its own is where the user put it. The model views without one go in the arrangement
 * of the orthographic projection around the front view (the first of them when there is none), `VIEW_GAP` apart. A projected or section view goes on its side
 * of its parent, `VIEW_GAP` from it (and from what is already on that side), in line with it: what the two have in common — the origin of the model —
 * is where it is in the parent. A detail view goes beside its parent. The arrangement is centred in the area of the sheet, with what hangs on it; what hangs on
 * a view the user put somewhere keeps to it. Views are measured at their scale.
 */
export function layoutViews(doc: DrawingDoc, rawLines: ReadonlyMap<Id, ViewLines | null>): Map<Id, PlacedView> {
  const sheet = sheetMetrics(doc.sheet);
  const lines = resolveLines(doc, rawLines);
  const measured = new Map<Id, Measured>();
  for (const v of doc.views) {
    const s = ratio(scaleOf(doc, v));
    const m = sizeOf(lines.get(v.id));
    measured.set(v.id, { view: v, scale: s, w: m.w * s, h: m.h * s, centre: m.centre });
  }
  const models = doc.views.filter((v) => !isDerived(v) && !v.at);
  const base = models.find((v) => !isDerived(v) && v.direction === 'front') ?? models[0];
  /** Positions in the arrangement (relative to its base view) and positions that are fixed (on the sheet). */
  const rel = new Map<Id, [number, number]>();
  const abs = new Map<Id, [number, number]>();
  for (const v of doc.views) if (v.at) abs.set(v.id, [v.at[0], v.at[1]]);
  if (base) {
    const cells = new Map<Id, [number, number]>();
    for (const v of models) cells.set(v.id, v === base || isDerived(v) ? [0, 0] : cell(v.direction, doc.sheet.projection));
    const last = Math.max(0, ...[...cells.values()].filter(([c]) => c !== 99).map(([c]) => c));
    for (const [id, [c, r]] of cells) if (c === 99) cells.set(id, [last + 1, r]);
    const colW = new Map<number, number>();
    const rowH = new Map<number, number>();
    for (const v of models) {
      const [c, r] = cells.get(v.id)!;
      const m = measured.get(v.id)!;
      colW.set(c, Math.max(colW.get(c) ?? 0, m.w));
      rowH.set(r, Math.max(rowH.get(r) ?? 0, m.h));
    }
    const cx = offsets(colW);
    const ry = offsets(rowH);
    for (const v of models) {
      const [c, r] = cells.get(v.id)!;
      rel.set(v.id, [cx.get(c)!, ry.get(r)!]);
    }
  }
  // the derived views, each once its parent is placed; what is on a side of a parent is stacked outward
  const stacked = new Map<string, number>();
  const pending = doc.views.filter((v) => isDerived(v) && !v.at);
  for (let pass = 0; pass < doc.views.length + 1 && pending.length > 0; pass++) {
    for (const v of [...pending]) {
      if (!isDerived(v)) continue;
      const frame = rel.has(v.parent) ? rel : abs.has(v.parent) ? abs : null;
      if (!frame) continue;
      const p = measured.get(v.parent)!;
      const c = measured.get(v.id)!;
      const [px, py] = frame.get(v.parent)!;
      const side = sideOf(doc, v);
      const key = `${v.parent}|${side}`;
      const used = stacked.get(key) ?? 0;
      stacked.set(key, used + (side === 'left' || side === 'right' ? c.w : c.h) + VIEW_GAP);
      let x: number;
      let y: number;
      if (side === 'left' || side === 'right') {
        x = px + (side === 'right' ? 1 : -1) * (p.w / 2 + VIEW_GAP + used + c.w / 2);
        // in line: the origin of the model is at the same height in both (a detail is simply level with its parent)
        y = v.kind === 'detail' ? py : py - p.centre[1] * p.scale + c.centre[1] * c.scale;
      } else {
        y = py + (side === 'up' ? 1 : -1) * (p.h / 2 + VIEW_GAP + used + c.h / 2);
        x = v.kind === 'detail' ? px : px - p.centre[0] * p.scale + c.centre[0] * c.scale;
      }
      frame.set(v.id, [x, y]);
      pending.splice(pending.indexOf(v), 1);
    }
  }
  // centre what is in the arrangement
  if (rel.size > 0) {
    const boxes = [...rel].map(([id, [x, y]]) => {
      const m = measured.get(id)!;
      return { x0: x - m.w / 2, x1: x + m.w / 2, y0: y - m.h / 2, y1: y + m.h / 2 };
    });
    const dx = sheet.area.x + sheet.area.w / 2 - (Math.min(...boxes.map((b) => b.x0)) + Math.max(...boxes.map((b) => b.x1))) / 2;
    const dy = sheet.area.y + sheet.area.h / 2 - (Math.min(...boxes.map((b) => b.y0)) + Math.max(...boxes.map((b) => b.y1))) / 2;
    for (const [id, [x, y]] of rel) abs.set(id, [x + dx, y + dy]);
  }
  const out = new Map<Id, PlacedView>();
  for (const v of doc.views) {
    const m = measured.get(v.id)!;
    const at = abs.get(v.id) ?? ([sheet.area.x + sheet.area.w / 2, sheet.area.y + sheet.area.h / 2] as [number, number]);
    out.set(v.id, { id: v.id, at: [at[0], at[1]], scale: m.scale, w: m.w, h: m.h, centre: m.centre });
  }
  return out;
}

/** The largest standard scale at which the views laid out fit the area of the sheet (C16.1); 1:100 when none does. */
export function suggestScale(views: readonly DrawingView[], sizes: ReadonlyMap<Id, { w: number; h: number }>, sheet: Pick<DrawingSheet, 'size' | 'orientation' | 'projection'>): Scale {
  const area: Rect = sheetMetrics(sheet).area;
  for (const scale of STANDARD_SCALES) {
    const doc = { kind: 'drawing', schemaVersion: 2, sheet: { ...sheet, scale }, title: {}, views: views.map((v) => ({ ...v, name: v.id, at: undefined, scale: undefined, hidden: true })), properties: {}, idCounters: {} } as unknown as DrawingDoc;
    const lines = new Map<Id, ViewLines>(views.map((v) => [v.id, { visible: [], hidden: [], box: { min: [0, 0], max: [sizes.get(v.id)?.w ?? 0, sizes.get(v.id)?.h ?? 0] } }]));
    const placed = [...layoutViews(doc, lines).values()];
    const x0 = Math.min(...placed.map((p) => p.at[0] - p.w / 2));
    const x1 = Math.max(...placed.map((p) => p.at[0] + p.w / 2));
    const y0 = Math.min(...placed.map((p) => p.at[1] - p.h / 2));
    const y1 = Math.max(...placed.map((p) => p.at[1] + p.h / 2));
    if (x1 - x0 <= area.w + 1e-9 && y1 - y0 <= area.h + 1e-9) return scale;
  }
  return [1, 100];
}
