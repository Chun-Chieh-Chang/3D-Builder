import { BREAK_GAP, isCorner, isDerived, page, rightOf, sectionArrow, sectionSide, withPage, type ClosedOutline, type ViewAxes, type DrawingDoc, type DrawingSheet, type DrawingView, type Id, type Scale, type ViewCorner, type ViewName, type ViewSide } from '@3db/model';
import { clipToCircle, clipToOutline, outlineBox } from './geometry';
import type { ShadeImage } from './shade';
import { sheetMetrics} from './sheet';

/** What a view needs to be laid out and drawn: its lines at full size, and for a section the outlines of the faces the cut made (to be hatched). */
export interface ViewLines {
  /** Native flat-pattern bends, in this view's normalized coordinates. */
  bends?: { id: string; a: [number, number]; b: [number, number]; angle: number; radius: number; direction: 'up' | 'down'; allowance: number }[];
  visible: number[][];
  hidden: number[][];
  /** Chain lines (the bend lines of a flat pattern). */
  center?: number[][];
  box: { min: [number, number]; max: [number, number] } | null;
  cut?: number[][];
  /** Clip generated hatch segments, retaining the original closed cut boundaries. */
  hatchClip?: ClosedOutline[];
  /** A view of an assembly: where each part of it is (the middle of its mass), in the view's coordinates, in the order the parts were asked for (C16.6: the balloons point there). */
  anchors?: [number, number][];
  /** Asked for when the view is shaded (ADR 0146): the image of its faces, which lies under its lines. */
  shade?: ShadeImage;
  /** A detail's: the circle of its parent's image it shows (view coordinates, full size). */
  shadeClip?: { centre: [number, number]; radius: number };
  /** Tangent edges (B2.3): the smooth edges where two faces meet tangentially, drawn only when the view's showTangentEdges is true. The seen ones only. */
  tangent?: number[][];
  /** The tangent edges behind the material (ADR 0146 §7): drawn with the hidden lines, where a view draws them, and nowhere else. */
  tangentHidden?: number[][];
}

/**
 * Whether the lines of a section cut nothing (D-I5): its plane misses the part, so there is no face to hatch. A slanted line is easily put
 * off the part; that is an error to show, not a section to draw. Lines that are not a section's (no `cut` at all) are not this.
 */
export const sectionMissed = (lines: Pick<ViewLines, 'cut'>): boolean => Array.isArray(lines.cut) && lines.cut.length === 0;

/**
 * A slanted cutting line (D-I5): the line through `at` along `toward − at`, run across the view's box grown by `pad` on every side, so that it
 * crosses the whole view as a horizontal or vertical one does. Null when the two points are the same, or the line passes outside the grown box.
 */
export function lineAcrossBox(at: readonly [number, number], toward: readonly [number, number], box: { min: readonly [number, number]; max: readonly [number, number] }, pad: number): [[number, number], [number, number]] | null {
  const dx = toward[0] - at[0];
  const dy = toward[1] - at[1];
  const len = Math.hypot(dx, dy);
  if (!(len > 1e-9) || ![...at, ...toward, pad].every(Number.isFinite)) return null;
  const d = [dx / len, dy / len] as const;
  let lo = -Infinity;
  let hi = Infinity;
  for (const k of [0, 1] as const) {
    const min = box.min[k] - pad;
    const max = box.max[k] + pad;
    if (Math.abs(d[k]) < 1e-12) {
      if (at[k] < min || at[k] > max) return null;
      continue;
    }
    const a = (min - at[k]) / d[k];
    const b = (max - at[k]) / d[k];
    lo = Math.max(lo, Math.min(a, b));
    hi = Math.min(hi, Math.max(a, b));
  }
  if (!(hi - lo > 1e-9)) return null;
  return [
    [at[0] + lo * d[0], at[1] + lo * d[1]],
    [at[0] + hi * d[0], at[1] + hi * d[1]],
  ];
}

/**
 * A break (B2.7) as the layout and the scene use it: the model's `break` with the axis as 0 (x) or 1 (y) and the gap it defaults to. Absent when the view is not broken.
 */
export interface PlacedBreak {
  axis: 0 | 1;
  from: number;
  to: number;
  gap: number;
}

/** A view's break as it is drawn, from what the model says. */
export const breakOf = (v: Pick<DrawingView, 'break'>): PlacedBreak | undefined => (v.break ? { axis: v.break.axis === 'y' ? 1 : 0, from: v.break.from, to: v.break.to, gap: v.break.gap ?? BREAK_GAP } : undefined);

/**
 * A view's own coordinate along the axis it is broken on, as it is drawn: the band between `from` and `to` is left out and the two halves are held `gap` apart, so what lies
 * beyond the band is drawn `(to - from) - gap` nearer and the view is that much shorter. A coordinate inside the band has nothing drawn at it and comes to its near end (the
 * far half starts at `from + gap` in drawn coordinates, which is where the scene draws its far break line).
 */
export const brokenAt = (b: PlacedBreak, v: number): number => (v <= b.from ? v : v >= b.to ? v - (b.to - b.from) + b.gap : b.from);

/** The other way round (for a pointer that places something on the view): a drawn coordinate back to the view's own. */
export const unbrokenAt = (b: PlacedBreak, v: number): number => (v <= b.from ? v : v + (b.to - b.from) - b.gap);

/** A view placed on the sheet: the middle of its box (mm), the scale as a number, and the size it takes (mm). */
export interface PlacedView {
  id: Id;
  at: [number, number];
  scale: number;
  w: number;
  h: number;
  /** The middle of the view's box in view coordinates (full size): what `at` is the sheet position of. */
  centre: [number, number];
  /** The band left out of the view (B2.7), when it is broken: every item of the view is placed through `toSheet`, so they all follow it. */
  break?: PlacedBreak;
}

export const ratio = (s: Scale): number => s[0] / s[1];

/** A point of a view's coordinates (full size) on the sheet, where the view is placed. A broken view's band is left out, so what lies beyond it comes nearer by it (B2.7). */
export const toSheet = (placed: PlacedView, x: number, y: number): [number, number] => {
  const b = placed.break;
  const vx = b && b.axis === 0 ? brokenAt(b, x) : x;
  const vy = b && b.axis === 1 ? brokenAt(b, y) : y;
  return [placed.at[0] + (vx - placed.centre[0]) * placed.scale, placed.at[1] + (vy - placed.centre[1]) * placed.scale];
};

/** A point of the sheet in the coordinates of the view placed there (full size): the other way round from `toSheet`, for a pointer that places something. */
export const fromSheet = (placed: PlacedView, sx: number, sy: number): [number, number] => {
  const x = placed.centre[0] + (sx - placed.at[0]) / placed.scale;
  const y = placed.centre[1] + (sy - placed.at[1]) / placed.scale;
  const b = placed.break;
  return [b && b.axis === 0 ? unbrokenAt(b, x) : x, b && b.axis === 1 ? unbrokenAt(b, y) : y];
};

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

/** What a view's scale is made of: its own, else (a projected, section, cropped or auxiliary view) its parent's, else the sheet's. Changing the scale of a view changes the scale of what it names, and so of every view that takes it. */
export function scaleTarget(doc: Pick<DrawingDoc, 'pages'>, view: DrawingView, depth = 0): { view: Id } | { sheet: true } {
  const pg = page(doc);
  if (view.scale) return { view: view.id };
  if (view.kind === 'projected' || view.kind === 'section' || view.kind === 'crop' || view.kind === 'auxiliary') {
    const parent = pg.views.find((v) => v.id === view.parent);
    if (parent && depth < 64) return scaleTarget(doc, parent, depth + 1);
  }
  return { sheet: true };
}

/** The gap between views laid out together (mm), room for the dimensions between them. */
export const VIEW_GAP = 25;

/** The size and middle of what a view draws, with a break's band left out of the axis it is broken on (B2.7): the view is measured as it is drawn, which is what places it. */
const sizeOf = (g: ViewLines | null | undefined, brk?: PlacedBreak) => {
  if (!g?.box) return { w: 0, h: 0, centre: [0, 0] as [number, number] };
  const min: [number, number] = [g.box.min[0], g.box.min[1]];
  const max: [number, number] = [g.box.max[0], g.box.max[1]];
  if (brk) {
    min[brk.axis] = brokenAt(brk, min[brk.axis]!);
    max[brk.axis] = brokenAt(brk, max[brk.axis]!);
  }
  return { w: max[0] - min[0], h: max[1] - min[1], centre: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2] as [number, number] };
};

/** The scale a view is drawn at: its own, else (a projected, section, cropped or auxiliary view) its parent's, else the sheet's. */
export function scaleOf(doc: Pick<DrawingDoc, 'pages'>, view: DrawingView, depth = 0): Scale {
  const pg = page(doc);
  if (view.scale) return view.scale;
  if (view.kind === 'projected' || view.kind === 'section' || view.kind === 'crop' || view.kind === 'auxiliary') {
    const parent = pg.views.find((v) => v.id === view.parent);
    if (parent && depth < 64) return scaleOf(doc, parent, depth + 1);
  }
  return pg.sheet.scale;
}

/**
 * The lines of every view, with the detail views made from their parents': what is inside the circle, the box of the circle (a detail view is as big as its
 * circle, so that its size does not depend on what happens to be in it). A detail of a view with no lines has none. A cropped view (B2.7) is made the same
 * way: what its parent shows inside its outline, and the box of the outline.
 */
export function resolveLines(doc: Pick<DrawingDoc, 'pages'>, lines: ReadonlyMap<Id, ViewLines | null>): Map<Id, ViewLines | null> {
  const pg = page(doc);
  const out = new Map<Id, ViewLines | null>();
  for (const v of pg.views) {
    if (v.kind === 'crop') {
      const parent = out.get(v.parent) ?? lines.get(v.parent);
      if (!parent) {
        out.set(v.id, null);
        continue;
      }
      // nothing is cut here: the crop shows what the parent shows inside the outline, at the outline's own size
      const clip = (ls: number[][] | undefined) => (ls ?? []).flatMap((l) => clipToOutline(l, v.outline));
      out.set(v.id, {
        visible: clip(parent.visible),
        hidden: clip(parent.hidden),
        box: outlineBox(v.outline),
        ...(parent.cut ? { cut: parent.cut, hatchClip: [...(parent.hatchClip ?? []), v.outline] } : {}),
        ...(parent.center ? { center: clip(parent.center) } : {}),
        ...(parent.tangent ? { tangent: clip(parent.tangent) } : {}),
        ...(parent.tangentHidden ? { tangentHidden: clip(parent.tangentHidden) } : {}),
      });
      continue;
    }
    if (v.kind !== 'detail') {
      out.set(v.id, lines.get(v.id) ?? null);
      continue;
    }
    const parent = out.get(v.parent) ?? lines.get(v.parent);
    if (!parent) {
      out.set(v.id, null);
      continue;
    }
    const clip = (ls: number[][]) => ls.flatMap((l) => clipToCircle(l, v.centre, v.radius));
    out.set(v.id, {
      visible: clip(parent.visible),
      hidden: clip(parent.hidden),
      ...(parent.cut ? { cut: parent.cut, hatchClip: [...(parent.hatchClip ?? []), { kind: 'circle' as const, centre: v.centre, radius: v.radius }] } : {}),
      box: { min: [v.centre[0] - v.radius, v.centre[1] - v.radius], max: [v.centre[0] + v.radius, v.centre[1] + v.radius] },
      ...(parent.shade ? { shade: parent.shade, shadeClip: { centre: [v.centre[0], v.centre[1]], radius: v.radius } } : {}),
      ...(parent.tangent ? { tangent: clip(parent.tangent) } : {}),
      ...(parent.tangentHidden ? { tangentHidden: clip(parent.tangentHidden) } : {}),
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
  /** The band left out of the view (B2.7), when it is broken. */
  break?: PlacedBreak;
}

/** The side of its parent a derived view goes on. */
function sideOf(doc: Pick<DrawingDoc, 'pages'>, v: Exclude<DrawingView, { kind?: 'model' }>): ViewSide {
  const pg = page(doc);
  // a view off a corner has a place of its own and is never laid out by its side; asked anyway (a probe without its place), it is beside the parent
  if (v.kind === 'projected') return isCorner(v.side) ? (v.side === 'upRight' || v.side === 'downRight' ? 'right' : 'left') : v.side;
  if (v.kind === 'section') return sectionSide(sectionArrow(v), pg.sheet.projection);
  // an auxiliary view (B2.7) is turned about its fold line, which is drawn on the parent as a section's line is: it goes on that line's side, as the section does
  if (v.kind === 'auxiliary') return sectionSide(sectionArrow(v), pg.sheet.projection);
  return 'right'; // a detail: beside its parent
}

/** The view the others of the orthographic arrangement are laid out round: the front view, else the first of the model views that have no position of their own. */
export function arrangementBase(doc: Pick<DrawingDoc, 'pages'>): DrawingView | undefined {
  const pg = page(doc);
  const models = pg.views.filter((v) => !isDerived(v) && !v.at);
  return models.find((v) => !isDerived(v) && v.direction === 'front') ?? models[0];
}

/**
 * The line a view is in line with the rest on, as the axis it can be slid along: 0 sideways (the left, right and back views, and what is projected or cut to the left or
 * right), 1 up and down (the top and bottom views, and what is projected or cut up or down). Null when it has none: the view the others are arranged round (it moves
 * all of them), the isometric and flat views, a detail, a view with a position of its own.
 */
export function slideAxis(doc: Pick<DrawingDoc, 'pages'>, v: DrawingView): 0 | 1 | null {
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
  const pg = page(doc);
  const sheet = sheetMetrics(pg.sheet);
  const lines = resolveLines(doc, rawLines);
  const measured = new Map<Id, Measured>();
  for (const v of pg.views) {
    const s = ratio(scaleOf(doc, v));
    const brk = breakOf(v);
    const m = sizeOf(lines.get(v.id), brk);
    measured.set(v.id, { view: v, scale: s, w: m.w * s, h: m.h * s, centre: m.centre, break: brk });
  }
  const models = pg.views.filter((v) => !isDerived(v) && !v.at);
  const base = arrangementBase(doc);
  /** Positions in the arrangement (relative to its base view) and positions that are fixed (on the sheet). */
  const rel = new Map<Id, [number, number]>();
  const abs = new Map<Id, [number, number]>();
  for (const v of pg.views) if (v.at) abs.set(v.id, [v.at[0], v.at[1]]);
  if (base) {
    const cells = new Map<Id, [number, number]>();
    for (const v of models) cells.set(v.id, v === base || isDerived(v) ? [0, 0] : cell(v.direction, pg.sheet.projection));
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
  const pending = pg.views.filter((v) => isDerived(v) && !v.at);
  for (let pass = 0; pass < pg.views.length + 1 && pending.length > 0; pass++) {
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
  const shift = pg.sheet.shift ?? [0, 0];
  const moved = new Map<Id, [number, number]>();
  const movedBy = (v: DrawingView, depth = 0): [number, number] => {
    const known = moved.get(v.id);
    if (known) return known;
    let by: [number, number] = [0, 0];
    if (!v.at) {
      const axis = slideAxis(doc, v);
      const own: [number, number] = axis === null || !v.slide ? [0, 0] : axis === 0 ? [v.slide, 0] : [0, v.slide];
      const parent = isDerived(v) && depth < 64 ? pg.views.find((x) => x.id === v.parent) : undefined;
      // the top of a tree of views carries the shift of the arrangement, unless it was put somewhere (then nothing of it moves with the arrangement)
      const up = parent ? movedBy(parent, depth + 1) : shift;
      by = [up[0] + own[0], up[1] + own[1]];
    }
    moved.set(v.id, by);
    return by;
  };
  const out = new Map<Id, PlacedView>();
  for (const v of pg.views) {
    const m = measured.get(v.id)!;
    const at = abs.get(v.id) ?? ([sheet.area.x + sheet.area.w / 2, sheet.area.y + sheet.area.h / 2] as [number, number]);
    const by = movedBy(v);
    out.set(v.id, { id: v.id, at: [at[0] + by[0], at[1] + by[1]], scale: m.scale, w: m.w, h: m.h, centre: m.centre, ...(m.break ? { break: m.break } : {}) });
  }
  return out;
}

// ---------------------------------------------------------------- placing views with the pointer (D-V, ADR 0131)

/**
 * Where the pointer is about a placed view, for the projected view it asks for (as SolidWorks reads it): beside the box (left or right of it, within its height
 * band or nearer that way) a view to that side, above or below it one up or down, off a corner (outside both bands) the isometric view. Null inside the box: no
 * view is asked for there.
 */
export function sideAt(parent: Pick<PlacedView, 'at' | 'w' | 'h'>, p: readonly [number, number]): ViewSide | 'corner' | null {
  const dx = p[0] - parent.at[0];
  const dy = p[1] - parent.at[1];
  const outX = Math.abs(dx) > parent.w / 2;
  const outY = Math.abs(dy) > parent.h / 2;
  if (!outX && !outY) return null;
  if (outX && outY) {
    // off a corner, but only clearly so: within a quarter of the gap of a band it is still the side it is nearer
    const byX = Math.abs(dx) - parent.w / 2;
    const byY = Math.abs(dy) - parent.h / 2;
    if (byY < VIEW_GAP / 4 && byX > byY) return dx > 0 ? 'right' : 'left';
    if (byX < VIEW_GAP / 4 && byY > byX) return dy > 0 ? 'up' : 'down';
    return 'corner';
  }
  return outX ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'up' : 'down';
}

/** Which corner of a placed view the pointer is off (ADR 0146): the quadrant it is in about the view's middle — what `sideAt` calls a corner. */
export function cornerAt(parent: Pick<PlacedView, 'at'>, p: readonly [number, number]): ViewCorner {
  const right = p[0] >= parent.at[0];
  return p[1] >= parent.at[1] ? (right ? 'upRight' : 'upLeft') : right ? 'downRight' : 'downLeft';
}

/** The least gap (mm) a view placed with the pointer keeps from its parent: it may come closer than the layout's, but not onto the parent. */
export const MIN_PLACE_GAP = 5;

/**
 * Where a derived view would go if it were added now and slid along its line to the pointer (D-V): it is laid out with the rest (in line with its parent, on its
 * side), then moved along that line so its middle is level with the pointer, but never nearer its parent than `MIN_PLACE_GAP`. `view` is the view as it would be
 * added (with no slide and no position), `lines` its lines at full size.
 *
 * Adding a view to the views laid out together centres them again on the sheet, which would move every one of them — and the new view off the point clicked.
 * So `shift` is the sheet's shift that keeps them where they are now (null when nothing would move), and the slide is worked out with it. Returns where the view
 * is drawn, its slide and that shift; null when it cannot be laid out (its parent has no place yet).
 */
export function previewDerived(
  doc: DrawingDoc,
  rawLines: ReadonlyMap<Id, ViewLines | null>,
  view: Exclude<DrawingView, { kind?: 'model' }>,
  lines: ViewLines | null,
  pointer: readonly [number, number],
): { placed: PlacedView; slide: number; shift: [number, number] | null } | null {
  if (![pointer[0], pointer[1]].every(Number.isFinite)) return null;
  const pg = page(doc);
  const probe = { ...view, slide: undefined, at: undefined } as DrawingView;
  const all = new Map(rawLines).set(probe.id, lines);
  const now = layoutViews(doc, rawLines).get(view.parent);
  const first = layoutViews(withPage(doc, { ...pg, views: [...pg.views, probe] }), all).get(view.parent);
  if (!now || !first) return null;
  // the shift that puts the parent (and so everything laid out with it) back where it is now
  const by: [number, number] = [now.at[0] - first.at[0], now.at[1] - first.at[1]];
  const moves = Math.hypot(by[0], by[1]) > 1e-6;
  const was = pg.sheet.shift ?? [0, 0];
  const shift: [number, number] | null = moves ? [Math.round((was[0] + by[0]) * 100) / 100, Math.round((was[1] + by[1]) * 100) / 100] : null;
  const withIt = withPage(doc, { ...pg, sheet: { ...pg.sheet, ...(shift ? { shift } : {}) }, views: [...pg.views, probe] });
  const layout = layoutViews(withIt, all);
  const placed = layout.get(probe.id);
  const parent = layout.get(view.parent);
  const axis = slideAxis(withIt, probe);
  if (!placed || !parent) return null;
  if (axis === null || placed.w <= 0) return { placed, slide: 0, shift };
  const half = (axis === 0 ? placed.w : placed.h) / 2;
  const parentHalf = (axis === 0 ? parent.w : parent.h) / 2;
  const sign = Math.sign(placed.at[axis] - parent.at[axis]) || 1;
  // the nearest the middle may be to the parent's middle, on its side
  const nearest = parent.at[axis] + sign * (parentHalf + MIN_PLACE_GAP + half);
  const want = sign > 0 ? Math.max(pointer[axis], nearest) : Math.min(pointer[axis], nearest);
  const slide = Math.round((want - placed.at[axis]) * 100) / 100;
  const at: [number, number] = axis === 0 ? [placed.at[0] + slide, placed.at[1]] : [placed.at[0], placed.at[1] + slide];
  return { placed: { ...placed, at }, slide, shift };
}

/**
 * The lines of a view seen from `from`, as they are seen from `to` when both look the same way (D-V): only which way is up on the sheet differs, so each point is
 * turned in the plane of the sheet. Null when the two do not look the same way (then the lines are not the same lines). Exact: no new projection is made.
 */
export function turnLines(lines: ViewLines, from: ViewAxes, to: ViewAxes): ViewLines | null {
  const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  if (dot(from.dir, to.dir) / Math.hypot(...from.dir) / Math.hypot(...to.dir) < 1 - 1e-9) return null;
  const r1 = rightOf(from);
  const r2 = rightOf(to);
  const u1 = from.up;
  const u2 = to.up;
  // the new coordinates of a point from the old ones: both pairs of axes lie in the same plane, square to the direction looked along
  const [a, b, c, e] = [dot(r2, r1), dot(r2, u1), dot(u2, r1), dot(u2, u1)];
  if (Math.abs(a - 1) < 1e-9 && Math.abs(e - 1) < 1e-9) return lines;
  const turn = (l: readonly number[]) => l.map((_, i) => (i % 2 === 0 ? a * l[i]! + b * l[i + 1]! : c * l[i - 1]! + e * l[i]!));
  const visible = lines.visible.map(turn);
  const hidden = lines.hidden.map(turn);
  const xs = visible.flatMap((l) => l.filter((_, i) => i % 2 === 0));
  const ys = visible.flatMap((l) => l.filter((_, i) => i % 2 === 1));
  return { visible, hidden, box: xs.length ? { min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)] } : null };
}
