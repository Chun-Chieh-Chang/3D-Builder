import { t } from '@3db/i18n';
import { DIM_STYLE_DEFAULT, dimensionRefs, fitDeviations, inUnit, rightOf, sheetUp, type CalloutStyle, type ThreadCallout, type DimStyle, type LengthUnit, type Dimension, type DimensionTolerance, type ElementFacts, type HoleInfo, type ViewAxes } from '@3db/model';
import { circlePolyline } from './geometry';
import { toSheet, type PlacedView } from './layout';
import type { SceneDimensionGeometry, SceneItem } from './scene';

/**
 * A dimension as text and lines on the sheet (C16.4, ISO 129-1): the number the model gives (measured in the view, at full size whatever the scale), the
 * tolerance written after it, the dimension line with its arrows between extension lines, or the leader of a circle with the text on a shelf.
 */

/** The elements a dimension points at, as the worker found them (in the order of the dimension's references), or why not. */
export type ElementsResult = { elements: ElementFacts[] } | { error: string };

/**
 * What the pointer needs to move a dimension (sheet mm): for a linear one where its line is and which way (so the offset and the slide of the text follow from where the
 * pointer is), for a diameter or a radius where the circle is, for an angle where the arc is. Not drawn, not written.
 */
export type DimensionHandle =
  | { kind: 'linear'; orientation: 'horizontal' | 'vertical' | 'aligned'; /** the middle of the dimension line before the text was slid */ mid: [number, number]; /** along the line, from the first element toward the second */ u: [number, number]; /** the view's box, and the two points for an aligned one */ box: { left: number; right: number; bottom: number; top: number }; a: [number, number]; b: [number, number] }
  | { kind: 'round'; centre: [number, number]; radius: number }
  | { kind: 'angle'; centre: [number, number]; radius: number; /** where the middle of the arc is, in radians */ mid: number };

export type DimensionOutcome = { value: number; text: string; items: SceneItem[]; handle?: DimensionHandle; dxf?: { textAt: [number, number]; geometry: SceneDimensionGeometry } } | { error: string };

/**
 * Height of the text of a dimension (mm) and the length of an arrowhead, as ISO's style has them (a drawing's own are in `sheet.dimStyle`, ADR 0146), the gap between a
 * feature and its extension line, and how far an extension line passes the dimension line.
 */
export const DIM_TEXT = DIM_STYLE_DEFAULT.text;
export const ARROW = DIM_STYLE_DEFAULT.arrow;
/** A filled or open arrowhead is a sixth as wide each side as it is long (3 mm long, 0.5 mm each side). */
const ARROW_SPREAD = 1 / 6;
/** A dot's radius, and an oblique stroke's half-length, as parts of the arrow's length. */
const DOT_RADIUS = 1 / 5;
export const GAP = 1;
export const OVERSHOOT = 2;
const LEADER = 8;

const dot = (a: readonly number[], b: readonly number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
const PARALLEL = 1 - 1e-6;
/** How square two directions have to be to count as across one another. */
const PERPENDICULAR = 1e-6;

/** A number as written on a drawing: up to `places` decimals (three for a size, four for a deviation), none that are zero. */
export function formatNumber(v: number, places = 3): string {
  const k = 10 ** places;
  const s = (Math.round(v * k) / k + 0).toFixed(places).replace(/\.?0+$/, '');
  return s === '-0' || s === '' ? '0' : s;
}

/**
 * A length (mm) as it is written in the unit: the decimals as they are in millimetres, except that inches take one more for a note (a depth, a counterbore: 12.5 mm is 0.492 in
 * where 0.49 would be 0.25 mm too coarse). A size takes as many as it is told (three).
 */
export function lengthNumber(mm: number, places: number, unit: LengthUnit = 'mm'): string {
  return formatNumber(inUnit(mm, unit), unit === 'in' && places === 2 ? 3 : places);
}

const signed = (v: number, unit: LengthUnit = 'mm') => (v === 0 ? '0' : `${v > 0 ? '+' : '-'}${lengthNumber(Math.abs(v), 4, unit)}`);

/**
 * The tolerance as written after a number: 「±0.05」, 「+0.1/-0.05」, the class and its limits 「H7 (+0.012/0)」 (the class alone when the table does not reach this
 * size), or the word of a one-sided limit 「MAX」/「MIN」 (「10 MAX」: 10 is the largest the part may be).
 */
export function toleranceText(tol: DimensionTolerance, nominal: number, unit: LengthUnit = 'mm'): string {
  if (tol.type === 'bilateral') return tol.upper === -tol.lower && tol.upper > 0 ? `±${lengthNumber(tol.upper, 4, unit)}` : `${signed(tol.upper, unit)}/${signed(tol.lower, unit)}`;
  if (tol.type === 'max') return t('drawing.tolMax');
  if (tol.type === 'min') return t('drawing.tolMin');
  const d = fitDeviations(nominal, tol.fit);
  return d ? `${tol.fit} (${signed(d.upper, unit)}/${signed(d.lower, unit)})` : tol.fit;
}

/** What is written of a hole after its diameter: 「貫穿」, 「深 12」, and 「沉頭 Ø15 深 8」 for a counterbore, 「錐孔 Ø12 90°」 for a countersink. */
export function holeNote(h: HoleInfo, unit: LengthUnit = 'mm', style: CalloutStyle = 'text'): string {
  if (style === 'symbols') {
    const parts = [h.through ? 'THRU' : `↧ ${lengthNumber(h.depth, 2, unit)}`];
    if (h.counterbore) parts.push(`⌴ Ø${lengthNumber(h.counterbore.diameter, 2, unit)} ↧ ${lengthNumber(h.counterbore.depth, 2, unit)}`);
    if (h.countersink) parts.push(`⌵ Ø${lengthNumber(h.countersink.diameter, 2, unit)} × ${formatNumber(h.countersink.angle, 2)}°`);
    return parts.join(' ');
  }
  const parts = [h.through ? t('drawing.holeThrough') : t('drawing.holeDeep', { depth: lengthNumber(h.depth, 2, unit) })];
  if (h.counterbore) parts.push(t('drawing.holeCbore', { diameter: lengthNumber(h.counterbore.diameter, 2, unit), depth: lengthNumber(h.counterbore.depth, 2, unit) }));
  if (h.countersink) parts.push(t('drawing.holeCsink', { diameter: lengthNumber(h.countersink.diameter, 2, unit), angle: formatNumber(h.countersink.angle, 2) }));
  return parts.join(' ');
}

/** What makes two holes of one diameter the same hole on a drawing: the same callout (through or how deep, counterbore, countersink, thread). */
export function holeSignature(h: HoleInfo | undefined): string {
  if (!h) return '';
  const cb = h.counterbore ? `${Math.round(h.counterbore.diameter * 1e3)}/${Math.round(h.counterbore.depth * 1e3)}` : '';
  const cs = h.countersink ? `${Math.round(h.countersink.diameter * 1e3)}/${Math.round(h.countersink.angle * 100)}` : '';
  return `${h.through ? 'through' : Math.round(h.depth * 1e3)}|${cb}|${cs}|${h.thread ? `${h.thread.size ?? 'tap'}:${h.thread.toleranceClass ?? ''}` : ''}`;
}

/** Manufacturing identity excludes placement used to locate a side-view leader. */
export const threadSignature = (thread: ThreadCallout | undefined): string => JSON.stringify(thread ? { ...thread, origin: undefined, axis: undefined } : null);

/**
 * What a tapped hole is called on a drawing, in place of its diameter: 「M6 貫穿（底孔 Ø5）」, the thread first and the drilled circle the model really has after it
 * (`diameter`); a hole whose size was typed has no name to give: 「螺紋底孔 Ø5 貫穿」. Null for a hole that is not tapped. The depth is the depth the hole is drilled to
 * (the model has no thread, so the thread is as deep as the hole).
 */
export function threadedHoleText(h: HoleInfo, diameter: number, unit: LengthUnit = 'mm', style: CalloutStyle = 'text'): string | null {
  if (!h.thread) return null;
  const d = lengthNumber(diameter, 3, unit);
  const size = style === 'symbols' && h.thread.pitch && h.thread.size && /^M[0-9]+$/.test(h.thread.size) ? `${h.thread.size}×${formatNumber(h.thread.pitch, 4)}` : h.thread.size;
  return size ? `${size}${h.thread.toleranceClass ? ` - ${h.thread.toleranceClass}` : ''} ${holeNote(h, unit, style)}${t('drawing.holeTapDrill', { diameter: d })}` : `${t('drawing.holeTapPlain')} Ø${d} ${holeNote(h, unit, style)}`;
}

/** The designation and pitch use the thread standard's mm units even on an inch drawing. Never invent a tolerance class. */
export function cosmeticThreadText(ct: ThreadCallout, unit: LengthUnit = 'mm', style: CalloutStyle = 'text', hole?: HoleInfo): string {
  const designation = ct.designation
    ? (!/^M[0-9]/.test(ct.designation) || /[×xX]/.test(ct.designation) ? ct.designation : `${ct.designation}×${formatNumber(ct.pitch, 4)}`)
    : t('drawing.threadCustom', { major: lengthNumber(ct.majorDiameter, 4, unit), pitch: lengthNumber(ct.pitch, 4, unit) });
  // External threads cover a length, not a through hole; always give the evaluated length.
  const through = ct.threadType === 'internal' && ct.endCondition === 'through' && hole?.through === true;
  return `${designation}${ct.toleranceClass ? ` - ${ct.toleranceClass}` : ''} ${holeNote({ through, depth: ct.depth }, unit, style)}`;
}

/**
 * What is written on the dimension: the count and the Ø or R, the number, the tolerance, and for a hole callout what the model says of the hole (`facts` is the
 * element it points at); in parentheses for a reference dimension.
 */
export function dimensionText(d: Dimension, value: number, facts?: ElementFacts, unit: LengthUnit = 'mm'): string {
  return finish(d, base(d, value, facts, unit));
}

/** What the user wrote around it or in its place (v8): a prefix and a suffix outside any parentheses, or a text of their own in which `<DIM>` stands for what it would have said. */
function finish(d: Dimension, said: string): string {
  if (d.text) return d.text.split('<DIM>').join(said);
  return `${d.prefix ?? ''}${said}${d.suffix ?? ''}`;
}

function base(d: Dimension, value: number, facts: ElementFacts | undefined, unit: LengthUnit): string {
  if (d.kind === 'angle') {
    // a one-sided limit is a word, so no degree sign follows it (「45° MAX」, not 「45° MAX°」)
    const oneSided = d.tolerance?.type === 'max' || d.tolerance?.type === 'min';
    const tolerance = d.tolerance ? ` ${toleranceText(d.tolerance, value)}${oneSided ? '' : '°'}` : '';
    const angle = `${formatNumber(value, d.precision ?? 2)}°${tolerance}`;
    return d.reference ? `(${angle})` : angle;
  }
  if (d.kind === 'chamfer') {
    const count = d.count ? `${d.count}×` : '';
    const tol = d.tolerance ? ` ${toleranceText(d.tolerance, d.size, unit)}` : '';
    const places = d.precision !== undefined ? d.precision : (unit === 'in' ? 3 : 2);
    const sizeStr = d.precision !== undefined ? formatNumber(inUnit(d.size, unit), places) : lengthNumber(d.size, places, unit);
    const angle = d.chamferAngle ?? 45;
    const body = d.chamferFormat === 'distanceAngle' ? `${sizeStr} × ${angle}°` : `C${sizeStr}`;
    const text = `${count}${body}${tol}`;
    return d.reference ? `(${text})` : text;
  }
  const count = (d.kind === 'diameter' || d.kind === 'radius') && d.count ? `${d.count}×` : '';
  // a tapped hole's callout names the thread in place of the diameter
  const style = d.kind === 'diameter' ? d.calloutStyle ?? 'text' : 'text';
  const threaded = d.kind === 'diameter' && d.callout
    ? facts?.thread ? `${cosmeticThreadText(facts.thread, unit, style, facts.hole)}${facts.hole ? t('drawing.threadDrill', { diameter: lengthNumber(value, 3, unit), note: holeNote(facts.hole, unit, style) }) : ''}` : facts?.hole ? threadedHoleText(facts.hole, value, unit, style) : null
    : null;
  if (threaded) return d.reference ? `(${count}${threaded})` : `${count}${threaded}`;
  const prefix = d.kind === 'diameter' ? 'Ø' : d.kind === 'radius' ? 'R' : '';
  const tol = d.tolerance ? ` ${toleranceText(d.tolerance, value, unit)}` : '';
  const note = d.kind === 'diameter' && d.callout && facts?.hole ? ` ${holeNote(facts.hole, unit, style)}` : '';
  // the decimals the user asked for are the decimals written, in either unit
  const number = d.precision !== undefined ? formatNumber(inUnit(value, unit), d.precision) : lengthNumber(value, 3, unit);
  const text = `${count}${prefix}${number}${tol}${note}`;
  return d.reference ? `(${text})` : text;
}

/** How wide a text is (mm), estimated from its height: the dimensions' text is set in a plain sans-serif. */
const textWidth = (text: string, height: number) => text.length * height * 0.62;

type P = [number, number];
const add = (a: P, b: P, k = 1): P => [a[0] + b[0] * k, a[1] + b[1] * k];
const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]];
const len = (a: P) => Math.hypot(a[0], a[1]);

/** The style a dimension is drawn in, every size known (`resolveDimStyle`). */
type Style = Required<DimStyle>;

/**
 * What a dimension is drawn with in a style (ADR 0146): its lines in the style's width (written on a line only when it is not the dimension style's own width,
 * so a drawing in ISO's style is drawn as it always was), its arrowheads of the style's kind and length, its text of the style's height.
 */
function pen(st: Style) {
  const width = st.line !== DIM_STYLE_DEFAULT.line ? { width: st.line } : {};
  const line = (...pts: P[]): SceneItem => ({ kind: 'polyline', points: pts.flat(), style: 'dimension', ...width });
  /** An arrowhead with its tip at `tip`, pointing along `toward` (a unit vector): filled, open (two strokes), an oblique stroke, a dot, or nothing. */
  const arrowhead = (tip: P, toward: P): SceneItem[] => {
    const back: P = [tip[0] - toward[0] * st.arrow, tip[1] - toward[1] * st.arrow];
    const side: P = [-toward[1] * st.arrow * ARROW_SPREAD, toward[0] * st.arrow * ARROW_SPREAD];
    switch (st.arrowStyle) {
      case 'filled':
        return [{ kind: 'polyline', points: [...tip, ...add(back, side), ...add(back, side, -1)], style: 'dimension', closed: true, filled: true, ...width }];
      case 'open':
        return [line(add(back, side), tip, add(back, side, -1))];
      case 'tick': {
        // the stroke leans 45° across the line, its middle on the tip, as long as an arrow
        const v: P = [(toward[0] - toward[1]) / Math.SQRT2, (toward[1] + toward[0]) / Math.SQRT2];
        return [line(add(tip, v, -st.arrow / 2), add(tip, v, st.arrow / 2))];
      }
      case 'dot':
        return [{ kind: 'polyline', points: circlePolyline(tip, st.arrow * DOT_RADIUS, 16), style: 'dimension', closed: true, filled: true, ...width }];
      case 'none':
        return [];
    }
  };
  /** A dimension line between `a` and `b` (on the line itself) with an arrow at each end, outside when they are too close for the arrows and the text between them. */
  const dimensionLine = (a: P, b: P): SceneItem[] => {
    const d = sub(b, a);
    const l = len(d);
    const u: P = l > 0 ? [d[0] / l, d[1] / l] : [1, 0];
    if (l >= 2 * st.arrow + 1) return [line(a, b), ...arrowhead(a, [-u[0], -u[1]]), ...arrowhead(b, u)];
    // too close: the arrows are outside, pointing in, on stubs of the line
    const stub = st.arrow + 2;
    return [line(add(a, u, -stub), add(b, u, stub)), ...arrowhead(a, u), ...arrowhead(b, [-u[0], -u[1]])];
  };
  /** Text of a dimension on a line with direction angle `a` (degrees), kept readable (never upside down), above the line at `mid`. */
  const textOn = (mid: P, angle: number, text: string): SceneItem => {
    let a = angle;
    while (a > 90 + 1e-9) a -= 180;
    while (a <= -90 + 1e-9) a += 180;
    const r = (a * Math.PI) / 180;
    return { kind: 'text', at: add(mid, [-Math.sin(r), Math.cos(r)], 1), text, height: st.text, anchor: 'center', ...(a !== 0 ? { angle: a } : {}) };
  };
  return { line, arrowhead, dimensionLine, textOn };
}

/** Where an element is in the view (x to the right, y up). */
const inView = (e: ElementFacts, axes: ViewAxes): P => {
  const r = rightOf(axes);
  return [dot(e.point, r), dot(e.point, sheetUp(axes))];
};

/** Whether an element (a plane or a line) is square to the direction measured in the view: `dir` is its normal or direction in the part. */
const squareTo = (e: ElementFacts, axes: ViewAxes, along: 'x' | 'y'): boolean => {
  if (!e.dir) return true;
  const along3 = along === 'x' ? rightOf(axes) : sheetUp(axes);
  // a plane's normal and a line's direction: a plane counts when its normal is along the measure; a line when it is across it (it is seen as a line square to the measure)
  return e.type === 'line' ? Math.abs(dot(e.dir, along3)) <= 1e-6 : Math.abs(dot(e.dir, along3)) >= PARALLEL;
};

const isBound = (e: ElementFacts) => e.type === 'plane' || e.type === 'line';

/**
 * Evaluates a dimension of a view placed at `placed`: its value and text and the lines it is drawn with. `resolved` says what its elements are; without it (or with
 * an error) there is nothing to draw and the answer says why.
 */
export function evaluateDimension(d: Dimension, resolved: ElementsResult | undefined, axes: ViewAxes, placed: PlacedView, unit: LengthUnit = 'mm', style: Style = DIM_STYLE_DEFAULT): DimensionOutcome {
  if (!resolved) return { error: t('drawing.dimPending') };
  if ('error' in resolved) return resolved;
  const refs = dimensionRefs(d);
  const els: ElementFacts[] = [];
  for (let i = 0; i < resolved.elements.length; i++) {
    const e = resolved.elements[i]!;
    const point = refs[i]?.point;
    if (!point || (e.kind === 'vertex' && e.type === 'point')) { els.push(e); continue; }
    let at: [number, number, number] | undefined;
    if (point === 'midpoint' && e.kind === 'edge' && e.type === 'line') at = e.point;
    if (point.startsWith('quadrant') && (e.type === 'circle' || e.type === 'cylinder') && e.dir && e.radius !== undefined && Math.abs(dot(e.dir, axes.dir)) >= PARALLEL) {
      const q = Number(point.slice(-1));
      const direction = q % 2 === 0 ? rightOf(axes) : sheetUp(axes);
      const sign = q < 2 ? 1 : -1;
      at = e.point.map((v, j) => v + sign * e.radius! * direction[j]!) as [number, number, number];
    }
    if (point.startsWith('outline') && e.type === 'cylinder' && e.dir && e.radius !== undefined && e.ends && Math.abs(dot(e.dir, axes.dir)) <= PERPENDICULAR) {
      const right = rightOf(axes), up = sheetUp(axes);
      const x = dot(e.dir, right), y = dot(e.dir, up), len = Math.hypot(x, y);
      if (len > 1e-9) {
        const base = point.includes('Start') ? e.ends[0] : point.includes('End') ? e.ends[1] : e.ends[0].map((v, j) => (v + e.ends![1][j]!) / 2);
        const side = point.endsWith('Positive') ? 1 : -1;
        at = base.map((v, j) => v + side * e.radius! * (-y * right[j]! + x * up[j]!) / len) as [number, number, number];
      }
    }
    if (!at || !at.every(Number.isFinite)) return { error: t('drawing.dimPointLost') };
    els.push({ kind: 'vertex', type: 'point', point: at });
  }
  if (d.kind === 'linear') return linear(d, els[0]!, els[1]!, axes, placed, unit, style);
  if (d.kind === 'angle') return angle(d, els[0]!, els[1]!, axes, placed, style);
  if (d.kind === 'ordinate') return ordinate(d, els, axes, placed, unit, style);
  if (d.kind === 'chamfer') return chamfer(d, els[0]!, axes, placed, unit, style);
  return circle(d, els[0]!, axes, placed, unit, style);
}

/**
 * An ordinate dimension (D-I4): each element's distance from the origin along the view's x (or y), written on its own extension line beyond a row outside the
 * view, the origin's 0 among them. Where the values come closer than a text's height, the extension lines jog sideways so that the texts stand apart (ISO 129-1),
 * keeping their order. The first value is the dimension's `value`; `text` lists them all.
 */
function ordinate(d: Extract<Dimension, { kind: 'ordinate' }>, els: readonly ElementFacts[], axes: ViewAxes, placed: PlacedView, unit: LengthUnit, st: Style): DimensionOutcome {
  const { line } = pen(st);
  const DIM_TEXT = st.text;
  const k = d.axis === 'x' ? 0 : 1;
  const along = d.axis === 'x' ? 'x' : 'y';
  for (const e of els) if (isBound(e) && !squareTo(e, axes, along)) return { error: t('drawing.ordinateNotAcross') };
  const at = els.map((e) => inView(e, axes));
  const origin = at[0]![k];
  const box = { left: placed.at[0] - placed.w / 2, right: placed.at[0] + placed.w / 2, bottom: placed.at[1] - placed.h / 2, top: placed.at[1] + placed.h / 2 };
  const outward = d.offset > 0 ? 1 : -1;
  // where the row is: beyond the box on its side, `offset` from it
  const edge = d.axis === 'x' ? (outward > 0 ? box.top : box.bottom) : outward > 0 ? box.right : box.left;
  const row = edge + d.offset;
  const entries = at.map((p, i) => {
    const s = toSheet(placed, p[0], p[1]);
    const value = Math.abs(p[k] - origin);
    return { s, value, text: i === 0 ? '0' : dimensionText(d, value, undefined, unit), bound: isBound(els[i]!) };
  });
  // the texts along the row, in the order of their elements, at least a text's height and a gap apart
  const gap = DIM_TEXT * 1.5;
  const order = entries.map((_, i) => i).sort((a, b) => entries[a]!.s[k] - entries[b]!.s[k]);
  const place = new Map<number, number>();
  let last = -Infinity;
  for (const i of order) {
    const want = Math.max(entries[i]!.s[k], last + gap);
    place.set(i, want);
    last = want;
  }
  // centred again on where the elements are, so that a crowd spreads both ways
  const shift = (order.reduce((sum, i) => sum + place.get(i)! - entries[i]!.s[k], 0) / Math.max(1, order.length)) * 0.5;
  for (const i of order) place.set(i, place.get(i)! - shift);
  const items: SceneItem[] = [];
  const jog = 3;
  for (const [i, e] of entries.entries()) {
    const across = place.get(i)!;
    // from the element (a plane: from the box's edge, a gap off it) to the row, jogging to where its text is
    const from = e.bound ? edge + outward * GAP : (d.axis === 'x' ? e.s[1] : e.s[0]) + outward * GAP;
    const knee = row - outward * jog;
    const pts: P[] =
      d.axis === 'x'
        ? [[e.s[0], from], [e.s[0], knee], [across, row], [across, row + outward * 1]]
        : [[from, e.s[1]], [knee, e.s[1]], [row, across], [row + outward * 1, across]];
    items.push(line(...pts));
    // the text along the extension line beyond the row, read from the bottom or the right of the sheet
    if (d.axis === 'x') items.push({ kind: 'text', at: [across + DIM_TEXT / 2, row + outward * 1.5], text: e.text, height: DIM_TEXT, angle: 90, anchor: outward > 0 ? 'left' : 'right' });
    else items.push({ kind: 'text', at: [row + outward * 1.5, across - DIM_TEXT / 2], text: e.text, height: DIM_TEXT, anchor: outward > 0 ? 'left' : 'right' });
  }
  const values = entries.slice(1).map((e) => e.value);
  const handle: DimensionHandle = {
    kind: 'linear',
    orientation: d.axis === 'x' ? 'horizontal' : 'vertical',
    mid: d.axis === 'x' ? [(box.left + box.right) / 2, row] : [row, (box.bottom + box.top) / 2],
    u: d.axis === 'x' ? [1, 0] : [0, 1],
    box,
    a: entries[0]!.s,
    b: entries[entries.length - 1]!.s,
  };
  return { value: values[0] ?? 0, text: entries.map((e) => e.text).join(' / '), items, handle };
}

/** What an element is seen as in a view when it is a line: a point on it, its direction (unit), and the point of the element the angle is measured toward. */
function seenAsLine(e: ElementFacts, axes: ViewAxes): { p: P; d: P; c: P } | { error: string } {
  const right = rightOf(axes);
  const up = sheetUp(axes);
  const to = (v: readonly number[]): P => [dot(v, right), dot(v, up)];
  if (!e.dir || (e.type !== 'plane' && e.type !== 'line')) return { error: t('drawing.dimNotAngle') };
  // a plane has to be edge-on (its normal across the view's direction), a line true (its direction across it too)
  if (Math.abs(dot(e.dir, axes.dir)) > 1e-6 && e.type === 'plane') return { error: t('drawing.dimNotEdgeOn') };
  if (Math.abs(dot(e.dir, axes.dir)) > 1e-6 && e.type === 'line') return { error: t('drawing.dimNotEdgeOn') };
  const v = to(e.dir);
  const l = len(v);
  if (l < 1e-9) return { error: t('drawing.dimNotEdgeOn') };
  const d: P = e.type === 'plane' ? [-v[1] / l, v[0] / l] : [v[0] / l, v[1] / l];
  const p = to(e.point);
  return { p, d, c: e.center ? to(e.center) : p };
}

/**
 * An angle between two lines of the view: the arc of radius `arc` (on the sheet) about where the lines meet, from the ray toward the first element to the ray toward
 * the second, with an arrow at each end, extension lines along the rays and the value over the middle of the arc. The angle is the one the two rays enclose
 * (0 to 180°); `supplementary` turns the second ray round.
 */
function angle(d: Extract<Dimension, { kind: 'angle' }>, ea: ElementFacts, eb: ElementFacts, axes: ViewAxes, placed: PlacedView, st: Style): DimensionOutcome {
  const { line, arrowhead } = pen(st);
  const DIM_TEXT = st.text;
  const ARROW = st.arrow;
  const la = seenAsLine(ea, axes);
  if ('error' in la) return la;
  const lb = seenAsLine(eb, axes);
  if ('error' in lb) return lb;
  const den = la.d[0] * lb.d[1] - la.d[1] * lb.d[0];
  if (Math.abs(den) < 1e-9) return { error: t('drawing.dimParallel') };
  // where the two lines meet
  const w: P = sub(lb.p, la.p);
  const s = (w[0] * lb.d[1] - w[1] * lb.d[0]) / den;
  const meet: P = add(la.p, la.d, s);
  const ray = (l: { d: P; c: P }): P => {
    const along = (l.c[0] - meet[0]) * l.d[0] + (l.c[1] - meet[1]) * l.d[1];
    return along < 0 ? [-l.d[0], -l.d[1]] : l.d;
  };
  const r1 = ray(la);
  let r2 = ray(lb);
  if (d.supplementary) r2 = [-r2[0], -r2[1]];
  const sweep = Math.atan2(r1[0] * r2[1] - r1[1] * r2[0], r1[0] * r2[0] + r1[1] * r2[1]); // signed, -π..π
  const value = (Math.abs(sweep) * 180) / Math.PI;
  const text = dimensionText(d, value);
  const centre = toSheet(placed, meet[0], meet[1]);
  const R = d.arc;
  const a1 = Math.atan2(r1[1], r1[0]);
  const sign = sweep >= 0 ? 1 : -1;
  const at = (ang: number): P => [centre[0] + R * Math.cos(ang), centre[1] + R * Math.sin(ang)];
  const tangent = (ang: number): P => [-Math.sin(ang) * sign, Math.cos(ang) * sign]; // along the sweep
  const items: SceneItem[] = [];
  // the rays carry extension lines from just off the corner to a little past the arc
  for (const r of [r1, r2]) items.push(line(add(centre, r, GAP), add(centre, r, R + OVERSHOOT)));
  const arcLength = R * Math.abs(sweep);
  const inside = arcLength >= 2 * ARROW + 1;
  const stub = inside ? 0 : (ARROW + 2) / R;
  const steps = Math.max(8, Math.ceil((Math.abs(sweep) + 2 * stub) / (Math.PI / 36)));
  const from = a1 - sign * stub;
  const total = sweep + sign * 2 * stub;
  items.push(line(...Array.from({ length: steps + 1 }, (_, k) => at(from + (total * k) / steps))));
  const end = a1 + sweep;
  const forward = (ang: number): P => tangent(ang);
  const backward = (ang: number): P => [-tangent(ang)[0], -tangent(ang)[1]];
  items.push(...arrowhead(at(a1), inside ? backward(a1) : forward(a1)), ...arrowhead(at(end), inside ? forward(end) : backward(end)));
  const mid = a1 + sweep / 2;
  const slid = mid + (d.slide ?? 0) / R; // the text goes along the arc, by what was slid (mm)
  const textAt: P = [centre[0] + (R + DIM_TEXT) * Math.cos(slid), centre[1] + (R + DIM_TEXT) * Math.sin(slid) - DIM_TEXT / 2];
  items.push({ kind: 'text', at: textAt, text, height: DIM_TEXT, anchor: 'center' });
  const far = (r: P): P => add(centre, r, R + OVERSHOOT);
  return { value, text, items, handle: { kind: 'angle', centre, radius: R, mid }, dxf: { textAt: [textAt[0], textAt[1] + DIM_TEXT / 2], geometry: { kind: 'angular', first: [centre, far(r1)], second: [centre, far(r2)], arc: at(mid) } } };
}

/** The foot of the perpendicular from `q` to the line through `p` along the unit `d`. */
const footOn = (q: P, p: P, d: P): P => {
  const t = (q[0] - p[0]) * d[0] + (q[1] - p[1]) * d[1];
  return [p[0] + d[0] * t, p[1] + d[1] * t];
};

/**
 * The two points an aligned dimension runs between (D-I2): two points as they are; a point and a line (a straight edge, a plane seen edge-on), the point and the
 * foot of the perpendicular from it to the line — the distance from a point to a line is the shortest one; two lines, which have to be parallel, a point of the
 * first and the foot of the perpendicular from it to the second.
 */
function alignedEnds(ea: ElementFacts, eb: ElementFacts, axes: ViewAxes): [P, P] | { error: string } {
  const lineA = isBound(ea) ? seenAsLine(ea, axes) : null;
  const lineB = isBound(eb) ? seenAsLine(eb, axes) : null;
  if (lineA && 'error' in lineA) return lineA;
  if (lineB && 'error' in lineB) return lineB;
  const A = lineA ? lineA.p : inView(ea, axes);
  if (lineA && lineB) {
    if (Math.abs(lineA.d[0] * lineB.d[1] - lineA.d[1] * lineB.d[0]) > 1e-6) return { error: t('drawing.dimNotParallel') };
    return [A, footOn(A, lineB.p, lineB.d)];
  }
  if (lineB) return [A, footOn(A, lineB.p, lineB.d)];
  const B = inView(eb, axes);
  if (lineA) return [footOn(B, lineA.p, lineA.d), B];
  return [A, B];
}

/**
 * Where a cylinder's outline is, seen from the side (D-I2): its axis's point moved `radius` square to the axis as the view sees it, to the left (side 1) or the
 * right (-1). Null when the cylinder is not seen from the side (its axis along the view): it has no outline then, only a circle.
 */
function outlinePoint(e: ElementFacts, side: 1 | -1, axes: ViewAxes): P | null {
  if (e.type !== 'cylinder' || !e.dir || e.radius === undefined) return null;
  const a: P = [dot(e.dir, rightOf(axes)), dot(e.dir, sheetUp(axes))];
  const l = len(a);
  if (l < 1e-6) return null;
  const n: P = [-a[1] / l, a[0] / l];
  const p = inView(e, axes);
  return [p[0] + side * e.radius * n[0], p[1] + side * e.radius * n[1]];
}

function linear(d: Extract<Dimension, { kind: 'linear' }>, ea: ElementFacts, eb: ElementFacts, axes: ViewAxes, placed: PlacedView, unit: LengthUnit, st: Style): DimensionOutcome {
  const { line, dimensionLine, textOn } = pen(st);
  const DIM_TEXT = st.text;
  let A = inView(ea, axes);
  let B = inView(eb, axes);
  for (const [which, side, e] of [[0, d.aSide, ea], [1, d.bSide, eb]] as const) {
    if (side === undefined) continue;
    const at = outlinePoint(e, side, axes);
    if (!at) return { error: t('drawing.dimNoOutline') };
    if (which === 0) A = at;
    else B = at;
  }
  if (d.orientation === 'aligned' && d.aSide === undefined && d.bSide === undefined) {
    const ends = alignedEnds(ea, eb, axes);
    if ('error' in ends) return ends;
    [A, B] = ends;
  }
  if (d.orientation !== 'aligned') {
    const along = d.orientation === 'horizontal' ? 'x' : 'y';
    for (const e of [ea, eb]) if (isBound(e) && !squareTo(e, axes, along)) return { error: t('drawing.dimNotAcross') };
  }
  const value = d.orientation === 'horizontal' ? Math.abs(B[0] - A[0]) : d.orientation === 'vertical' ? Math.abs(B[1] - A[1]) : Math.hypot(B[0] - A[0], B[1] - A[1]);
  const text = dimensionText(d, value, undefined, unit);
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
  const mid: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const label = textOn(add(mid, u, d.slide ?? 0), (Math.atan2(u[1], u[0]) * 180) / Math.PI, text);
  items.push(label);
  const textAt: P = label.kind === 'text' ? add(label.at, n, DIM_TEXT / 2) : a;
  const handle: DimensionHandle = { kind: 'linear', orientation: d.orientation, mid, u, box, a: sA, b: sB };
  return { value, text, items, handle, dxf: { textAt, geometry: { kind: 'linear', a: sA, b: sB, line: a, ...(d.orientation === 'horizontal' ? { rotation: 0 } : d.orientation === 'vertical' ? { rotation: 90 } : {}) } } };
}

/**
 * Where the middle of the circle a round dimension measures is in the view (x to the right, y up): the element's own point for a cylinder, a sphere or an edge, but the
 * middle of the arc a fillet is seen as — `major` from the part's axis, on the side the leader leans. Null when the element is not seen as a circle at all: a cylinder
 * shows a circle when its axis runs along the view, but a fillet's axis must lie across it instead (its tube is then cut through, and the cut is the arc).
 */
function circleCentre(e: ElementFacts, axes: ViewAxes, u: P): P | null {
  const at = inView(e, axes);
  if (e.type !== 'torus') {
    if (e.type !== 'sphere' && !(e.dir && Math.abs(dot(e.dir, axes.dir)) >= PARALLEL)) return null;
    return at;
  }
  if (!e.dir || e.major === undefined || Math.abs(dot(e.dir, axes.dir)) > PERPENDICULAR) return null;
  // the axis as the view sees it; across it lies the arc, and a quarter turn off it is where the arc's middle is
  const ax: P = [dot(e.dir, rightOf(axes)), dot(e.dir, sheetUp(axes))];
  const l = Math.hypot(ax[0], ax[1]);
  if (l < 1e-9) return null;
  const across: P = [ax[1] / l, -ax[0] / l];
  // which of the two arcs the leader names: a leader that runs along the axis leans toward neither, and there is no arc that way to point at
  const lean = u[0] * across[0] + u[1] * across[1];
  if (Math.abs(lean) < 1e-9) return null;
  const side = lean > 0 ? 1 : -1;
  return [at[0] + side * across[0] * e.major, at[1] + side * across[1] * e.major];
}

function circle(d: Extract<Dimension, { kind: 'diameter' | 'radius' }>, e: ElementFacts, axes: ViewAxes, placed: PlacedView, unit: LengthUnit, st: Style): DimensionOutcome {
  const { line, arrowhead } = pen(st);
  const DIM_TEXT = st.text;
  const ARROW = st.arrow;
  if (e.radius === undefined) return { error: t('drawing.dimNotRound') };
  const th = (d.angle * Math.PI) / 180;
  const u: P = [Math.cos(th), Math.sin(th)];
  if (d.kind === 'diameter' && d.threadLeader) {
    if (!d.callout || e.type !== 'cylinder' || !e.dir || Math.abs(dot(e.dir, axes.dir)) > PERPENDICULAR || (!e.thread && !e.hole?.thread)) return { error: t('drawing.threadLeaderNeedsThread') };
    const ax: P = [dot(e.dir, rightOf(axes)), dot(e.dir, sheetUp(axes))];
    const n: P = [-ax[1], ax[0]];
    const side = n[0] * u[0] + n[1] * u[1] >= 0 ? 1 : -1;
    const ct = e.thread;
    const point = ct?.origin && ct.axis ? ct.origin.map((v, i) => v + ct.axis![i]! * ct.depth / 2) as [number, number, number] : e.center ?? e.point;
    const at = inView({ ...e, point }, axes);
    const centre = toSheet(placed, at[0], at[1]);
    const near = add(centre, n, side * e.radius * placed.scale);
    const outer = add(near, u, d.leader ?? LEADER);
    const text = dimensionText(d, 2 * e.radius, e, unit);
    const dir = u[0] >= 0 ? 1 : -1;
    const shelf: P = [outer[0] + dir * (textWidth(text, DIM_TEXT) + 2), outer[1]];
    return { value: 2 * e.radius, text, items: [line(near, outer, shelf), ...arrowhead(near, [-u[0], -u[1]]),
      { kind: 'text', at: [outer[0] + dir, outer[1] + 1], text, height: DIM_TEXT, anchor: dir > 0 ? 'left' : 'right' }],
      handle: { kind: 'round', centre: near, radius: 0 } };
  }
  // the circle has to be seen as a circle
  const at = circleCentre(e, axes, u);
  if (!at) return { error: t('drawing.dimNotTrueShape') };
  const value = d.kind === 'diameter' ? 2 * e.radius : e.radius;
  const text = dimensionText(d, value, e, unit);
  const centre = toSheet(placed, at[0], at[1]);
  const r = e.radius * placed.scale;
  const near = add(centre, u, r);
  const leader = d.leader ?? LEADER;
  const outer = add(centre, u, r + leader);
  const dir = u[0] >= 0 ? 1 : -1;
  const shelfEnd: P = [outer[0] + dir * (textWidth(text, DIM_TEXT) + 2), outer[1]];
  const items: SceneItem[] = [];
  if (d.kind === 'diameter' && 2 * r >= 2 * ARROW + 2) {
    // room inside: the line crosses the circle through its middle, an arrow at each end touching the circle from inside
    const far = add(centre, u, -r);
    items.push(line(far, outer, shelfEnd), ...arrowhead(far, [-u[0], -u[1]]), ...arrowhead(near, u));
  } else {
    // a small circle, or a radius: the leader comes from outside and its arrow touches the circle pointing in
    items.push(line(shelfEnd, outer, near), ...arrowhead(near, [-u[0], -u[1]]));
  }
  const textAt: P = [outer[0] + dir * 1, outer[1] + 1];
  items.push({ kind: 'text', at: textAt, text, height: DIM_TEXT, anchor: dir > 0 ? 'left' : 'right' });
  const middle: P = [textAt[0] + (dir * textWidth(text, DIM_TEXT)) / 2, textAt[1] + DIM_TEXT / 2];
  return {
    value,
    text,
    items,
    handle: { kind: 'round', centre, radius: r },
    dxf: { textAt: middle, geometry: d.kind === 'diameter' ? { kind: 'diameter', far: add(centre, u, -r), near, leader } : { kind: 'radius', centre, near, leader } },
  };
}

function chamfer(d: Extract<Dimension, { kind: 'chamfer' }>, e: ElementFacts, axes: ViewAxes, placed: PlacedView, unit: LengthUnit, st: Style): DimensionOutcome {
  const { line, arrowhead } = pen(st);
  const DIM_TEXT = st.text;
  const right = rightOf(axes);
  const up = sheetUp(axes);
  const to = (v: readonly number[]): P => [dot(v, right), dot(v, up)];
  const ptModel = e.center ?? e.point;
  const ptView = to(ptModel);
  const centre = toSheet(placed, ptView[0], ptView[1]);
  const th = (d.angle * Math.PI) / 180;
  const u: P = [Math.cos(th), Math.sin(th)];
  const leader = d.leader ?? LEADER;
  const outer = add(centre, u, leader);
  const value = d.size;
  const text = dimensionText(d, value, e, unit);
  const dir = u[0] >= 0 ? 1 : -1;
  const shelfEnd: P = [outer[0] + dir * (textWidth(text, DIM_TEXT) + 2), outer[1]];
  const items: SceneItem[] = [];
  items.push(line(shelfEnd, outer, centre), ...arrowhead(centre, [-u[0], -u[1]]));
  const textAt: P = [outer[0] + dir * 1, outer[1] + 1];
  items.push({ kind: 'text', at: textAt, text, height: DIM_TEXT, anchor: dir > 0 ? 'left' : 'right' });
  const middle: P = [textAt[0] + (dir * textWidth(text, DIM_TEXT)) / 2, textAt[1] + DIM_TEXT / 2];
  return {
    value,
    text,
    items,
    handle: { kind: 'round', centre, radius: 0 },
    dxf: { textAt: middle, geometry: { kind: 'radius', centre, near: centre, leader } },
  };
}

// ---------------------------------------------------------------- moving a dimension with the pointer (sheet mm)

/**
 * The `offset` a linear dimension takes when its line is put through the point `p`: for a horizontal or vertical one the signed distance from the edge of the view's box
 * on the side `p` is on (at least 1 mm, so that it stays off the view); for an aligned one from the farther of its two points, on the side of the line between them that
 * `p` is on.
 */
export function offsetAt(h: Extract<DimensionHandle, { kind: 'linear' }>, p: P): number {
  const least = 1;
  if (h.orientation === 'horizontal' || h.orientation === 'vertical') {
    const w = h.orientation === 'horizontal' ? p[1] : p[0];
    const [lo, hi] = h.orientation === 'horizontal' ? [h.box.bottom, h.box.top] : [h.box.left, h.box.right];
    // the middle of the box is where the sides change over
    return w >= (lo + hi) / 2 ? Math.max(least, w - hi) : -Math.max(least, lo - w);
  }
  const npos: P = [-h.u[1], h.u[0]];
  const side = npos[0] * (p[0] - h.mid[0]) + npos[1] * (p[1] - h.mid[1]) >= 0 ? 1 : -1;
  const n: P = [npos[0] * side, npos[1] * side];
  const c0 = Math.max(n[0] * h.a[0] + n[1] * h.a[1], n[0] * h.b[0] + n[1] * h.b[1]);
  return side * Math.max(least, n[0] * p[0] + n[1] * p[1] - c0);
}

/** The direction (degrees counter-clockwise from the x axis) and the leader a diameter or a radius takes when its text is put at the point `p`. */
export function leaderAt(h: Extract<DimensionHandle, { kind: 'round' }>, p: P): { angle: number; leader: number } {
  const dx = p[0] - h.centre[0];
  const dy = p[1] - h.centre[1];
  return { angle: (Math.atan2(dy, dx) * 180) / Math.PI, leader: Math.max(2, Math.hypot(dx, dy) - h.radius) };
}

/** The radius of the arc of an angle dimension when it is put through the point `p` (at least 3 mm). */
export function arcAt(h: Extract<DimensionHandle, { kind: 'angle' }>, p: P): number {
  return Math.max(3, Math.hypot(p[0] - h.centre[0], p[1] - h.centre[1]));
}

/**
 * The tolerance the drawing's right-click menu puts on a dimension (B2.4): the same choices the properties panel offers — taking it away, the two limits
 * (±0.05), MAX, MIN, or a fit. Nothing of the file format is new here: it is the `DimensionTolerance` the panel already writes (ADR 0125), so the menu is a
 * shortcut to it and no schema changes.
 */
export type ToleranceChoice = 'none' | 'bilateral' | 'max' | 'min' | 'fit';

/**
 * The tolerance a choice puts on a dimension (B2.4), as the properties panel does: a fit is `h7` on the size a linear dimension gives (a shaft's) and `H7`
 * elsewhere (a hole's), the same letters the panel's own menu picks.
 */
export function toleranceForChoice(choice: ToleranceChoice, kind: Dimension['kind']): DimensionTolerance | null {
  if (choice === 'none') return null;
  if (choice === 'bilateral') return { type: 'bilateral', upper: 0.05, lower: -0.05 };
  if (choice === 'max') return { type: 'max' };
  if (choice === 'min') return { type: 'min' };
  return { type: 'fit', fit: kind === 'linear' ? 'h7' : 'H7' };
}

/**
 * Whether a fit can be put on all of these dimensions (B2.4). A fit is a size's (ISO 286): an angle dimension has no size, and an ordinate's is taken from
 * the origin, so the model refuses a fit on either (`drawing.dimAngleFit`, `drawing.ordinateFit`) — the menu leaves that choice out rather than let a command
 * fail, exactly as the properties panel hides it for an angle.
 */
export function fitAllowed(kinds: readonly Dimension['kind'][]): boolean {
  return !kinds.some((k) => k === 'angle' || k === 'ordinate');
}
