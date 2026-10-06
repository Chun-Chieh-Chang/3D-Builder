/**
 * The sketch snaps beyond a point, a middle and a place on a curve (D5.3c, SolidWorks' 草圖抓取): the crossing of two curves, the quarter points of a circle or arc,
 * the places where a line from a point touches a circle (tangent) or meets a line at a right angle (perpendicular), and the grid, the angle and the length steps.
 * Pure geometry on solved sketch geometry, like `interact.ts`; the sketcher decides what each one adds to the sketch.
 */
import type { Id } from '@3db/model';
import { add, closestOn, dist, dot, len, onSweep, polar, scale, sub, unit, type Geometry } from './interact';
import { crossings, drawn, isCurve } from './ops';
import type { P2 } from './types';

// ---------------------------------------------------------------- the settings

/** Which snaps are on (「啟用抓取」 and the choices under it), and the steps of the grid and the angle. Kept in the browser, not in the part. */
export interface SnapSettings {
  /** The master switch: off, nothing snaps and no relation is added by itself (SolidWorks clears 自動給定限制條件 with 啟用抓取). */
  enabled: boolean;
  /** The ends and centers of the sketch (a point already there). */
  point: boolean;
  midpoint: boolean;
  /** Anywhere on a line, circle or arc (「最近點」). */
  curve: boolean;
  quadrant: boolean;
  intersection: boolean;
  /** The place where a line from its start touches a circle or arc. */
  tangent: boolean;
  /** The foot of the perpendicular from the start of a line onto another line. */
  perpendicular: boolean;
  /** 「水平點」「垂直點」: in line with another point. */
  alignment: boolean;
  /** A line within a few degrees of horizontal or vertical. */
  horizontalVertical: boolean;
  /** A line within a few degrees of the direction of another: collinear, parallel, perpendicular. */
  lineRelations: boolean;
  /** The edges and vertices of the model in the sketch plane. */
  model: boolean;
  /** 網格 (off unless asked for): free points go to the grid. */
  grid: boolean;
  gridSpacing: number;
  /** 角度: the direction of a line goes to a multiple of the step (degrees). */
  angle: boolean;
  angleStep: number;
}

/** One of the snaps a 快速抓取 can pick: the others are off while it is. */
export type SnapItem = 'point' | 'midpoint' | 'curve' | 'quadrant' | 'intersection' | 'tangent' | 'perpendicular' | 'alignment' | 'horizontalVertical' | 'lineRelations' | 'model';
export const SNAP_ITEMS: readonly SnapItem[] = ['point', 'midpoint', 'curve', 'quadrant', 'intersection', 'tangent', 'perpendicular', 'alignment', 'horizontalVertical', 'lineRelations', 'model'];

export const DEFAULT_SNAPS: SnapSettings = {
  enabled: true,
  point: true,
  midpoint: true,
  curve: true,
  quadrant: true,
  intersection: true,
  tangent: true,
  perpendicular: true,
  alignment: true,
  horizontalVertical: true,
  lineRelations: true,
  model: true,
  grid: false,
  gridSpacing: 5,
  angle: false,
  angleStep: 15,
};

export const GRID_SPACING = { min: 0.1, max: 1000 } as const;
export const ANGLE_STEP = { min: 1, max: 90 } as const;

/** What a quick snap leaves on: that one, and nothing else (not the grid or the angle either). */
export function quickSettings(item: SnapItem): SnapSettings {
  const off = Object.fromEntries(SNAP_ITEMS.map((k) => [k, false])) as Record<SnapItem, boolean>;
  return { ...DEFAULT_SNAPS, ...off, [item]: true, grid: false, angle: false };
}

/** What was stored, as far as it can be trusted: what is missing or not what it should be is the default. */
export function parseSnapSettings(raw: unknown): SnapSettings {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const flag = (k: keyof SnapSettings) => (typeof o[k] === 'boolean' ? (o[k] as boolean) : (DEFAULT_SNAPS[k] as boolean));
  const num = (k: 'gridSpacing' | 'angleStep', lo: number, hi: number) => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? Math.min(hi, Math.max(lo, o[k] as number)) : DEFAULT_SNAPS[k]);
  return {
    enabled: flag('enabled'),
    point: flag('point'),
    midpoint: flag('midpoint'),
    curve: flag('curve'),
    quadrant: flag('quadrant'),
    intersection: flag('intersection'),
    tangent: flag('tangent'),
    perpendicular: flag('perpendicular'),
    alignment: flag('alignment'),
    horizontalVertical: flag('horizontalVertical'),
    lineRelations: flag('lineRelations'),
    model: flag('model'),
    grid: flag('grid'),
    gridSpacing: num('gridSpacing', GRID_SPACING.min, GRID_SPACING.max),
    angle: flag('angle'),
    angleStep: num('angleStep', ANGLE_STEP.min, ANGLE_STEP.max),
  };
}

// ---------------------------------------------------------------- crossings and quarter points

/** Where two curves of the sketch cross, if the cursor is within `tol` of it: the nearest one, with the two curves. */
export function intersectionSnap(geometry: Geometry, p: P2, tol: number, exclude: ReadonlySet<Id> = new Set()): { p: P2; a: Id; b: Id } | null {
  const near = [...geometry].flatMap(([id, g]) => {
    if (exclude.has(id) || !isCurve(g)) return [];
    const q = closestOn(g, p);
    return q && dist(p, q) <= tol ? [{ id, g }] : [];
  });
  let best: { p: P2; a: Id; b: Id; d: number } | null = null;
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      const [x, y] = [near[i]!, near[j]!];
      for (const q of crossings(x.g, y.g)) {
        if (!drawn(x.g, q) || !drawn(y.g, q)) continue;
        const d = dist(p, q);
        if (d <= tol && (!best || d < best.d)) best = { p: q, a: x.id, b: y.id, d };
      }
    }
  }
  return best && { p: best.p, a: best.a, b: best.b };
}

/** The quarter points of a circle, and of an arc where it has them (the four points of the circle that lie on its sweep, not its ends): the one under the cursor. */
export function quadrantSnap(geometry: Geometry, p: P2, tol: number, exclude: ReadonlySet<Id> = new Set()): { p: P2; curve: Id; center: Id; axis: 'horizontal' | 'vertical' } | null {
  let best: { p: P2; curve: Id; center: Id; axis: 'horizontal' | 'vertical'; d: number } | null = null;
  for (const [id, g] of geometry) {
    if (exclude.has(id) || (g.type !== 'circle' && g.type !== 'arc')) continue;
    for (let k = 0; k < 4; k++) {
      const angle = (k * Math.PI) / 2;
      if (g.type === 'arc' && !(onSweep(g.a0, g.a1, angle) && Math.abs(angle - g.a0) > 1e-9 && Math.abs(angle - g.a1) > 1e-9)) continue;
      const q: P2 = [g.c[0] + [g.r, 0, -g.r, 0][k]!, g.c[1] + [0, g.r, 0, -g.r][k]!]; // exact, not cos and sin of a multiple of a right angle
      const d = dist(p, q);
      if (d <= tol && (!best || d < best.d)) best = { p: q, curve: id, center: g.center, axis: k % 2 === 0 ? 'horizontal' : 'vertical', d };
    }
  }
  return best && { p: best.p, curve: best.curve, center: best.center, axis: best.axis };
}

// ---------------------------------------------------------------- tangent and perpendicular

/** The places where a line from `from` touches a circle or arc, if the cursor is within `tol` of one: that place and the curve. Curves in `exclude` (the one `from` is on) are left out. */
export function tangentSnap(geometry: Geometry, from: P2, p: P2, tol: number, exclude: ReadonlySet<Id> = new Set()): { p: P2; curve: Id } | null {
  let best: { p: P2; curve: Id; d: number } | null = null;
  for (const [id, g] of geometry) {
    if (exclude.has(id) || (g.type !== 'circle' && g.type !== 'arc')) continue;
    const d0 = dist(from, g.c);
    if (d0 <= g.r * (1 + 1e-9)) continue; // from inside or on it: no line from there touches it
    const base = Math.atan2(from[1] - g.c[1], from[0] - g.c[0]);
    const phi = Math.acos(g.r / d0);
    for (const angle of [base + phi, base - phi]) {
      const q = polar(g.c, g.r, angle);
      if (g.type === 'arc' && !drawn(g, q)) continue;
      const d = dist(p, q);
      if (d <= tol && (!best || d < best.d)) best = { p: q, curve: id, d };
    }
  }
  return best && { p: best.p, curve: best.curve };
}

/** The foot of the perpendicular from `from` onto each line (the drawn part of it), if the cursor is within `tol` of one: that place and the line. */
export function perpendicularSnap(geometry: Geometry, from: P2, p: P2, tol: number, exclude: ReadonlySet<Id> = new Set()): { p: P2; line: Id } | null {
  let best: { p: P2; line: Id; d: number } | null = null;
  for (const [id, g] of geometry) {
    if (exclude.has(id) || g.type !== 'line' || len(sub(g.b, g.a)) === 0) continue;
    const u = unit(sub(g.b, g.a));
    const foot = add(g.a, scale(u, dot(sub(from, g.a), u)));
    if (!drawn(g, foot) || dist(foot, from) <= tol) continue; // the foot is off the drawn part, or the line passes through `from`
    const d = dist(p, foot);
    if (d <= tol && (!best || d < best.d)) best = { p: foot, line: id, d };
  }
  return best && { p: best.p, line: best.line };
}

// ---------------------------------------------------------------- grid, angle, length

/** The grid point nearest to `p`. */
export const gridPoint = (p: P2, spacing: number): P2 => [Math.round(p[0] / spacing) * spacing, Math.round(p[1] / spacing) * spacing];

/** `p` turned about `from` onto the nearest multiple of `stepDegrees`, when it is within `toleranceDegrees` of it; otherwise as it was. */
export function angleStep(from: P2, p: P2, stepDegrees: number, toleranceDegrees = 3): P2 {
  const d = sub(p, from);
  const length = len(d);
  if (length === 0) return p;
  const step = (stepDegrees * Math.PI) / 180;
  const angle = Math.atan2(d[1], d[0]);
  const nearest = Math.round(angle / step) * step;
  return Math.abs(angle - nearest) <= (toleranceDegrees * Math.PI) / 180 ? polar(from, length, nearest) : p;
}

/** `p` moved along the line from `from` so that its length is a multiple of `spacing` (the length snap of 「Shift」). */
export function lengthStep(from: P2, p: P2, spacing: number): P2 {
  const d = sub(p, from);
  const length = len(d);
  if (length === 0 || spacing <= 0) return p;
  const rounded = Math.max(spacing, Math.round(length / spacing) * spacing);
  return [from[0] + (d[0] / length) * rounded, from[1] + (d[1] / length) * rounded];
}
