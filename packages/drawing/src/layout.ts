import type { DrawingDoc, DrawingSheet, DrawingView, Id, Scale, ViewName } from '@3db/model';
import { sheetMetrics, type Rect } from './sheet';

/** What a view needs to be laid out: the box of its lines at full size. */
export interface ViewLines {
  visible: number[][];
  hidden: number[][];
  box: { min: [number, number]; max: [number, number] } | null;
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

/**
 * Lays the views of a drawing out (C16.2): a view with a position of its own is where the user put it; the others go in the arrangement of the orthographic
 * projection around the front view (the first of them when there is none), `VIEW_GAP` apart, the whole arrangement centred in the area of the sheet. The
 * isometric view goes beside it, at the far side. Views are measured at their scale.
 */
export function layoutViews(doc: DrawingDoc, lines: ReadonlyMap<Id, ViewLines | null>): Map<Id, PlacedView> {
  const sheet = sheetMetrics(doc.sheet);
  const measured = doc.views.map((v) => {
    const s = ratio(v.scale ?? doc.sheet.scale);
    const m = sizeOf(lines.get(v.id));
    return { view: v, scale: s, w: m.w * s, h: m.h * s, centre: m.centre };
  });
  const auto = measured.filter((m) => !m.view.at);
  const base = auto.find((m) => m.view.direction === 'front') ?? auto[0];
  const centres = new Map<Id, [number, number]>();
  if (base) {
    const cells = new Map<Id, [number, number]>();
    for (const m of auto) cells.set(m.view.id, m === base ? [0, 0] : cell(m.view.direction, doc.sheet.projection));
    // the isometric view takes the column after the last of the others
    const last = Math.max(0, ...[...cells.values()].filter(([c]) => c !== 99).map(([c]) => c));
    for (const [id, [c, r]] of cells) if (c === 99) cells.set(id, [last + 1, r]);
    const colW = new Map<number, number>();
    const rowH = new Map<number, number>();
    for (const m of auto) {
      const [c, r] = cells.get(m.view.id)!;
      colW.set(c, Math.max(colW.get(c) ?? 0, m.w));
      rowH.set(r, Math.max(rowH.get(r) ?? 0, m.h));
    }
    const cx = offsets(colW);
    const ry = offsets(rowH);
    const pos = auto.map((m) => {
      const [c, r] = cells.get(m.view.id)!;
      return { m, x: cx.get(c)!, y: ry.get(r)! };
    });
    const x0 = Math.min(...pos.map((p) => p.x - p.m.w / 2));
    const x1 = Math.max(...pos.map((p) => p.x + p.m.w / 2));
    const y0 = Math.min(...pos.map((p) => p.y - p.m.h / 2));
    const y1 = Math.max(...pos.map((p) => p.y + p.m.h / 2));
    const dx = sheet.area.x + sheet.area.w / 2 - (x0 + x1) / 2;
    const dy = sheet.area.y + sheet.area.h / 2 - (y0 + y1) / 2;
    for (const p of pos) centres.set(p.m.view.id, [p.x + dx, p.y + dy]);
  }
  const out = new Map<Id, PlacedView>();
  for (const m of measured) {
    const at = m.view.at ?? centres.get(m.view.id) ?? ([sheet.area.x + sheet.area.w / 2, sheet.area.y + sheet.area.h / 2] as [number, number]);
    out.set(m.view.id, { id: m.view.id, at: [at[0], at[1]], scale: m.scale, w: m.w, h: m.h, centre: m.centre });
  }
  return out;
}

/** The largest standard scale at which the views laid out fit the area of the sheet (C16.1); 1:100 when none does. */
export function suggestScale(views: readonly Pick<DrawingView, 'id' | 'direction'>[], sizes: ReadonlyMap<Id, { w: number; h: number }>, sheet: Pick<DrawingSheet, 'size' | 'orientation' | 'projection'>): Scale {
  const area: Rect = sheetMetrics(sheet).area;
  for (const scale of STANDARD_SCALES) {
    const s = ratio(scale);
    const doc = { kind: 'drawing', schemaVersion: 1, sheet: { ...sheet, scale }, title: {}, views: views.map((v) => ({ ...v, name: v.id, source: 'x', hidden: true })), properties: {}, idCounters: {} } as DrawingDoc;
    const lines = new Map<Id, ViewLines>(views.map((v) => [v.id, { visible: [], hidden: [], box: { min: [0, 0], max: [sizes.get(v.id)?.w ?? 0, sizes.get(v.id)?.h ?? 0] } }]));
    const placed = [...layoutViews(doc, lines).values()];
    const x0 = Math.min(...placed.map((p) => p.at[0] - p.w / 2));
    const x1 = Math.max(...placed.map((p) => p.at[0] + p.w / 2));
    const y0 = Math.min(...placed.map((p) => p.at[1] - p.h / 2));
    const y1 = Math.max(...placed.map((p) => p.at[1] + p.h / 2));
    void s;
    if (x1 - x0 <= area.w + 1e-9 && y1 - y0 <= area.h + 1e-9) return scale;
  }
  return [1, 100];
}
