import { t } from '@3db/i18n';
import { fitDeviations, rightOf, type Dimension, type DimensionTolerance, type ElementFacts, type HoleInfo, type ViewAxes } from '@3db/model';
import { toSheet, type PlacedView } from './layout';
import type { SceneItem } from './scene';

/**
 * A dimension as text and lines on the sheet (C16.4, ISO 129-1): the number the model gives (measured in the view, at full size whatever the scale), the
 * tolerance written after it, the dimension line with its arrows between extension lines, or the leader of a circle with the text on a shelf.
 */

/** The elements a dimension points at, as the worker found them (in the order of the dimension's references), or why not. */
export type ElementsResult = { elements: ElementFacts[] } | { error: string };

export type DimensionOutcome = { value: number; text: string; items: SceneItem[] } | { error: string };

/** Height of the text of a dimension (mm), the length and half-width of an arrowhead, the gap between a feature and its extension line, and how far an extension line passes the dimension line. */
export const DIM_TEXT = 3.5;
const ARROW = 3;
const ARROW_HALF = 0.5;
const GAP = 1;
const OVERSHOOT = 2;
const LEADER = 8;

const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const PARALLEL = 1 - 1e-6;

/** A number as written on a drawing: up to `places` decimals (three for a size, four for a deviation), none that are zero. */
export function formatNumber(v: number, places = 3): string {
  const k = 10 ** places;
  const s = (Math.round(v * k) / k + 0).toFixed(places).replace(/\.?0+$/, '');
  return s === '-0' || s === '' ? '0' : s;
}

const signed = (v: number) => (v === 0 ? '0' : `${v > 0 ? '+' : '-'}${formatNumber(Math.abs(v), 4)}`);

/** The tolerance as written after a number: 「±0.05」, 「+0.1/-0.05」, or the class and its limits 「H7 (+0.012/0)」 (the class alone when the table does not reach this size). */
export function toleranceText(tol: DimensionTolerance, nominal: number): string {
  if (tol.type === 'bilateral') return tol.upper === -tol.lower && tol.upper > 0 ? `±${formatNumber(tol.upper, 4)}` : `${signed(tol.upper)}/${signed(tol.lower)}`;
  const d = fitDeviations(nominal, tol.fit);
  return d ? `${tol.fit} (${signed(d.upper)}/${signed(d.lower)})` : tol.fit;
}

/** What is written of a hole after its diameter: 「貫穿」, 「深 12」, and 「沉頭 Ø15 深 8」 for a counterbore. */
export function holeNote(h: HoleInfo): string {
  const parts = [h.through ? t('drawing.holeThrough') : t('drawing.holeDeep', { depth: formatNumber(h.depth, 2) })];
  if (h.counterbore) parts.push(t('drawing.holeCbore', { diameter: formatNumber(h.counterbore.diameter, 2), depth: formatNumber(h.counterbore.depth, 2) }));
  return parts.join(' ');
}

/**
 * What is written on the dimension: the count and the Ø or R, the number, the tolerance, and for a hole callout what the model says of the hole (`facts` is the
 * element it points at); in parentheses for a reference dimension.
 */
export function dimensionText(d: Dimension, value: number, facts?: ElementFacts): string {
  const count = d.kind !== 'linear' && d.count ? `${d.count}×` : '';
  const prefix = d.kind === 'diameter' ? 'Ø' : d.kind === 'radius' ? 'R' : '';
  const tol = d.tolerance ? ` ${toleranceText(d.tolerance, value)}` : '';
  const note = d.kind === 'diameter' && d.callout && facts?.hole ? ` ${holeNote(facts.hole)}` : '';
  const text = `${count}${prefix}${formatNumber(value)}${tol}${note}`;
  return d.reference ? `(${text})` : text;
}

/** How wide a text is (mm), estimated from its height: the dimensions' text is set in a plain sans-serif. */
const textWidth = (text: string, height: number) => text.length * height * 0.62;

type P = [number, number];
const add = (a: P, b: P, k = 1): P => [a[0] + b[0] * k, a[1] + b[1] * k];
const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
const len = (a: P) => Math.hypot(a[0], a[1]);

const line = (...pts: P[]): SceneItem => ({ kind: 'polyline', points: pts.flat(), style: 'dimension' });

/** An arrowhead (closed, filled) with its tip at `tip`, pointing along `toward` (a unit vector). */
function arrowhead(tip: P, toward: P): SceneItem {
  const back: P = [tip[0] - toward[0] * ARROW, tip[1] - toward[1] * ARROW];
  const side: P = [-toward[1] * ARROW_HALF, toward[0] * ARROW_HALF];
  return { kind: 'polyline', points: [...tip, ...add(back, side), ...add(back, side, -1)], style: 'dimension', closed: true, filled: true };
}

/** A dimension line between `a` and `b` (on the line itself) with an arrow at each end, outside when they are too close for the arrows and the text between them. */
function dimensionLine(a: P, b: P): SceneItem[] {
  const d = sub(b, a);
  const l = len(d);
  const u: P = l > 0 ? [d[0] / l, d[1] / l] : [1, 0];
  if (l >= 2 * ARROW + 1) return [line(a, b), arrowhead(a, [-u[0], -u[1]]), arrowhead(b, u)];
  // too close: the arrows are outside, pointing in, on stubs of the line
  const stub = ARROW + 2;
  return [line(add(a, u, -stub), add(b, u, stub)), arrowhead(a, u), arrowhead(b, [-u[0], -u[1]])];
}

/** Text of a dimension on a line with direction angle `a` (degrees), kept readable (never upside down), above the line at `mid`. */
function textOn(mid: P, angle: number, text: string): SceneItem {
  let a = angle;
  while (a > 90 + 1e-9) a -= 180;
  while (a <= -90 + 1e-9) a += 180;
  const r = (a * Math.PI) / 180;
  return { kind: 'text', at: add(mid, [-Math.sin(r), Math.cos(r)], 1), text, height: DIM_TEXT, anchor: 'center', ...(a !== 0 ? { angle: a } : {}) };
}

/** Where an element is in the view (x to the right, y up). */
const inView = (e: ElementFacts, axes: ViewAxes): P => {
  const r = rightOf(axes);
  return [dot(e.point, r), dot(e.point, axes.up)];
};

/** Whether an element (a plane or a line) is square to the direction measured in the view: `dir` is its normal or direction in the part. */
const squareTo = (e: ElementFacts, axes: ViewAxes, along: 'x' | 'y'): boolean => {
  if (!e.dir) return true;
  const along3 = along === 'x' ? rightOf(axes) : axes.up;
  // a plane's normal and a line's direction: a plane counts when its normal is along the measure; a line when it is across it (it is seen as a line square to the measure)
  return e.type === 'line' ? Math.abs(dot(e.dir, along3)) <= 1e-6 : Math.abs(dot(e.dir, along3)) >= PARALLEL;
};

const isBound = (e: ElementFacts) => e.type === 'plane' || e.type === 'line';

/**
 * Evaluates a dimension of a view placed at `placed`: its value and text and the lines it is drawn with. `resolved` says what its elements are; without it (or with
 * an error) there is nothing to draw and the answer says why.
 */
export function evaluateDimension(d: Dimension, resolved: ElementsResult | undefined, axes: ViewAxes, placed: PlacedView): DimensionOutcome {
  if (!resolved) return { error: t('drawing.dimPending') };
  if ('error' in resolved) return resolved;
  const els = resolved.elements;
  if (d.kind === 'linear') return linear(d, els[0]!, els[1]!, axes, placed);
  return circle(d, els[0]!, axes, placed);
}

function linear(d: Extract<Dimension, { kind: 'linear' }>, ea: ElementFacts, eb: ElementFacts, axes: ViewAxes, placed: PlacedView): DimensionOutcome {
  const A = inView(ea, axes);
  const B = inView(eb, axes);
  if (d.orientation !== 'aligned') {
    const along = d.orientation === 'horizontal' ? 'x' : 'y';
    for (const e of [ea, eb]) if (isBound(e) && !squareTo(e, axes, along)) return { error: t('drawing.dimNotAcross') };
  }
  const value = d.orientation === 'horizontal' ? Math.abs(B[0] - A[0]) : d.orientation === 'vertical' ? Math.abs(B[1] - A[1]) : Math.hypot(B[0] - A[0], B[1] - A[1]);
  const text = dimensionText(d, value);
  const sA = toSheet(placed, A[0], A[1]);
  const sB = toSheet(placed, B[0], B[1]);
  const box = { left: placed.at[0] - placed.w / 2, right: placed.at[0] + placed.w / 2, bottom: placed.at[1] - placed.h / 2, top: placed.at[1] + placed.h / 2 };
  const above = d.offset > 0;
  const off = Math.abs(d.offset);
  let n: P; // from the features toward the dimension line
  let u: P; // along the dimension line, from A toward B
  let c: number; // n · (a point of the dimension line)
  let edge: number | null = null; // n · (the view's box edge on that side), where the extension lines of planes start
  if (d.orientation === 'horizontal') {
    n = above ? [0, 1] : [0, -1];
    u = [sB[0] >= sA[0] ? 1 : -1, 0];
    edge = above ? box.top : -box.bottom;
    c = edge + off;
  } else if (d.orientation === 'vertical') {
    n = above ? [1, 0] : [-1, 0];
    u = [0, sB[1] >= sA[1] ? 1 : -1];
    edge = above ? box.right : -box.left;
    c = edge + off;
  } else {
    const dd = sub(sB, sA);
    const l = len(dd);
    u = l > 0 ? [dd[0] / l, dd[1] / l] : [1, 0];
    n = above ? [-u[1], u[0]] : [u[1], -u[0]];
    c = Math.max(n[0] * sA[0] + n[1] * sA[1], n[0] * sB[0] + n[1] * sB[1]) + off;
  }
  const nd = (p: P) => n[0] * p[0] + n[1] * p[1];
  const onLine = (p: P): P => add(p, n, c - nd(p));
  const items: SceneItem[] = [];
  for (const [s, e] of [[sA, ea], [sB, eb]] as const) {
    // an extension line starts at the feature (a plane: at the edge of the view), a gap away, and passes the dimension line a little
    const from: P = isBound(e) && edge !== null ? add(s, n, edge - nd(s) + GAP) : add(s, n, GAP);
    const to = add(onLine(s), n, OVERSHOOT);
    if (nd(to) > nd(from)) items.push(line(from, to));
  }
  const a = onLine(sA);
  const b = onLine(sB);
  items.push(...dimensionLine(a, b));
  items.push(textOn([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], (Math.atan2(u[1], u[0]) * 180) / Math.PI, text));
  return { value, text, items };
}

function circle(d: Extract<Dimension, { kind: 'diameter' | 'radius' }>, e: ElementFacts, axes: ViewAxes, placed: PlacedView): DimensionOutcome {
  if (e.radius === undefined) return { error: t('drawing.dimNotRound') };
  // the circle has to be seen as a circle: its axis along the direction the view looks
  if (e.type !== 'sphere' && !(e.dir && Math.abs(dot(e.dir, axes.dir)) >= PARALLEL)) return { error: t('drawing.dimNotTrueShape') };
  const value = d.kind === 'diameter' ? 2 * e.radius : e.radius;
  const text = dimensionText(d, value, e);
  const [cx, cy] = inView(e, axes);
  const centre = toSheet(placed, cx, cy);
  const r = e.radius * placed.scale;
  const th = (d.angle * Math.PI) / 180;
  const u: P = [Math.cos(th), Math.sin(th)];
  const near = add(centre, u, r);
  const outer = add(centre, u, r + LEADER);
  const dir = u[0] >= 0 ? 1 : -1;
  const shelfEnd: P = [outer[0] + dir * (textWidth(text, DIM_TEXT) + 2), outer[1]];
  const items: SceneItem[] = [];
  if (d.kind === 'diameter' && 2 * r >= 2 * ARROW + 2) {
    // room inside: the line crosses the circle through its middle, an arrow at each end touching the circle from inside
    const far = add(centre, u, -r);
    items.push(line(far, outer, shelfEnd), arrowhead(far, [-u[0], -u[1]]), arrowhead(near, u));
  } else {
    // a small circle, or a radius: the leader comes from outside and its arrow touches the circle pointing in
    items.push(line(shelfEnd, outer, near), arrowhead(near, [-u[0], -u[1]]));
  }
  items.push({ kind: 'text', at: [outer[0] + dir * 1, outer[1] + 1], text, height: DIM_TEXT, anchor: dir > 0 ? 'left' : 'right' });
  return { value, text, items };
}
