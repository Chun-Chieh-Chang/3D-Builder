import { isDerived, sectionArrow, sectionSide, type DrawingDoc, type DrawingSheet, type DrawingView, type Id, type Scale, type ViewName, type ViewSide } from '@3db/model';
import { clipToCircle } from './geometry';
import { sheetMetrics, type Rect } from './sheet';

/** What a view needs to be laid out and drawn: its lines at full size, and for a section the outlines of the faces the cut made (to be hatched). */
export interface ViewLines {
  visible: number[][];
  hidden: number[][];
  /** Chain lines (the bend lines of a flat pattern). */
  center?: number[][];
  box: { min: [number, number]; max: [number, number] } | null;
  cut?: number[][];
  /** A view of an assembly: where each part of it is (the middle of its mass), in the view's coordinates, in the order the parts were asked for (C16.6: the balloons point there). */
  anchors?: [number, number][];
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

/** A point of a view's coordinates (full size) on the sheet, where the view is placed. */
export const toSheet = (placed: PlacedView, x: number, y: number): [number, number] => [placed.at[0] + (x - placed.centre[0]) * placed.scale, placed.at[1] + (y - placed.centre[1]) * placed.scale];

/** The scales a drawing is made at (ISO 5455), from the largest. */
export const STANDARD_SCALES: readonly Scale[] = [[50, 1], [20, 1], [10, 1], [5, 1], [2, 1], [1, 1], [1, 2], [1, 5], [1, 10], [1, 20], [1, 50], [1, 100]];

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * The scale for a size the user dragged a view to, as a ratio: a standard scale when it is within 3% of one (the pointer snaps to them), else the plain fraction with one
 * decimal in it (a ratio of 0.7 is 5:7, of 1.5 is 3:2), kept to what a scale may be (1 to 1000 each side).
 */
export function scaleFromRatio(r: number): Scale {
  const ratio01 = Math.min(50, Math.max(1 / 100, Number.isFinite(r) ? r : 1));
  const near = STANDARD_SCALES.find((s) => Math.abs(s[0] / s[1] / ratio01 - 1) < 0.03);
  if (near) return near;
  const [n, d] = ratio01 >= 1 ? [Math.round(ratio01 * 10), 10] : [10, Math.round(10 / ratio01)];
  const g = gcd(n, d);
  return [n / g, d / g];
}

/** What a view's scale is made of: its own, else (a projected or section view) its parent's, else the sheet's. Changing the scale of a view changes the scale of what it names, and so of every view that takes it. */
export function scaleTarget(doc: Pick<DrawingDoc, 'views'>, view: DrawingView, depth = 0): { view: Id } | { sheet: true } {
  if (view.scale) return { view: view.id };
  if (view.kind === 'projected' || view.kind === 'section') {
    const parent = doc.views.find((v) => v.id === view.parent);
    if (parent && depth < 64) return scaleTarget(doc, parent, depth + 1);
  }
  return { sheet: true };
}

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
    case 'flat':
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

/** The view the others of the orthographic arrangement are laid out round: the front view, else the first of the model views that have no position of their own. */
export function arrangementBase(doc: Pick<DrawingDoc, 'views'>): DrawingView | undefined {
  const models = doc.views.filter((v) => !isDerived(v) && !v.at);
  return models.find((v) => !isDerived(v) && v.direction === 'front') ?? models[0];
}

/**
 * The line a view is in line with the rest on, as the axis it can be slid along: 0 sideways (the left, right and back views, and what is projected or cut to the left or
 * right), 1 up and down (the top and bottom views, and what is projected or cut up or down). Null when it has none: the view the others are arranged round (it moves
 * all of them), the isometric and flat views, a detail, a view with a position of its own.
 */
export function slideAxis(doc: Pick<DrawingDoc, 'views' | 'sheet'>, v: DrawingView): 0 | 1 | null {
  if (v.at) return null;
  if (isDerived(v)) {
    if (v.kind === 'detail') return null;
    const side = sideOf(doc, v);
    return side === 'left' || side === 'right' ? 0 : 1;
  }
  if (v === arrangementBase(doc) || v.id === arrangementBase(doc)?.id) return null;
  switch (v.direction) {
    case 'top':
    case 'bottom':
      return 1;
    case 'left':
    case 'right':
    case 'back':
      return 0;
    default:
      return null;
  }
}

/**
 * Lays the views of a drawing out (C16.2, C16.3). A view with a position of its own is where the user put it. The model views without one go in the arrangement
 * of the orthographic projection around the front view (the first of them when there is none), `VIEW_GAP` apart. A projected or section view goes on its side
 * of its parent, `VIEW_GAP` from it (and from what is already on that side), in line with it: what the two have in common — the origin of the model —
 * is where it is in the parent. A detail view goes beside its parent. The arrangement is centred in the area of the sheet, with what hangs on it; what hangs on
 * a view the user put somewhere keeps to it. Views are measured at their scale. Then what the user moved is added: the shift of the sheet moves the whole arrangement, the
 * slide of a view moves it along its line (and what hangs on it); a view with a position of its own is where it was put.
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
  const base = arrangementBase(doc);
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
      /** Where the view goes on a side of its parent, and how much of that side is taken already. */
      const spot = (side: ViewSide) => {
        const used = stacked.get(`${v.parent}|${side}`) ?? 0;
        if (side === 'left' || side === 'right') {
          // in line: the origin of the model is at the same height in both (a detail is simply level with its parent)
          const y = v.kind === 'detail' ? py : py - p.centre[1] * p.scale + c.centre[1] * c.scale;
          return { side, used, x: px + (side === 'right' ? 1 : -1) * (p.w / 2 + VIEW_GAP + used + c.w / 2), y };
        }
        const x = v.kind === 'detail' ? px : px - p.centre[0] * p.scale + c.centre[0] * c.scale;
        return { side, used, x, y: py + (side === 'up' ? 1 : -1) * (p.h / 2 + VIEW_GAP + used + c.h / 2) };
      };
      let chosen = spot(sideOf(doc, v));
      if (v.kind === 'section') {
        // A section goes on the side its arrow looks to, but where that side is taken by another view (the top view of the first angle sits just where the section of
        // a front view looking down would) it goes beside its parent instead: its label says which cut it is.
        const clear = (s: ReturnType<typeof spot>) =>
          ![...frame].some(([id, [ox, oy]]) => {
            const o = measured.get(id);
            return id !== v.id && o !== undefined && Math.abs(s.x - ox) < (c.w + o.w) / 2 - 1e-9 && Math.abs(s.y - oy) < (c.h + o.h) / 2 - 1e-9;
          });
        if (!clear(chosen)) {
          const free = (['right', 'left', 'up', 'down'] as const).filter((s) => s !== chosen.side).map(spot).find(clear);
          if (free) chosen = free;
        }
      }
      const { side, used, x, y } = chosen;
      stacked.set(`${v.parent}|${side}`, used + (side === 'left' || side === 'right' ? c.w : c.h) + VIEW_GAP);
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
  // what the user moved: the arrangement as a whole, and the views along their lines, each with what hangs on it
  const shift = doc.sheet.shift ?? [0, 0];
  const moved = new Map<Id, [number, number]>();
  const movedBy = (v: DrawingView, depth = 0): [number, number] => {
    const known = moved.get(v.id);
    if (known) return known;
    let by: [number, number] = [0, 0];
    if (!v.at) {
      const axis = slideAxis(doc, v);
      const own: [number, number] = axis === null || !v.slide ? [0, 0] : axis === 0 ? [v.slide, 0] : [0, v.slide];
      const parent = isDerived(v) && depth < 64 ? doc.views.find((x) => x.id === v.parent) : undefined;
      // the top of a tree of views carries the shift of the arrangement, unless it was put somewhere (then nothing of it moves with the arrangement)
      const up = parent ? movedBy(parent, depth + 1) : shift;
      by = [up[0] + own[0], up[1] + own[1]];
    }
    moved.set(v.id, by);
    return by;
  };
  const out = new Map<Id, PlacedView>();
  for (const v of doc.views) {
    const m = measured.get(v.id)!;
    const at = abs.get(v.id) ?? ([sheet.area.x + sheet.area.w / 2, sheet.area.y + sheet.area.h / 2] as [number, number]);
    const by = movedBy(v);
    out.set(v.id, { id: v.id, at: [at[0] + by[0], at[1] + by[1]], scale: m.scale, w: m.w, h: m.h, centre: m.centre });
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
