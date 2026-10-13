import { noteText, type Annotation, type DatumAnnotation, type GeometricCharacteristic, type LengthUnit, type NoteAnnotation, type ToleranceFrameAnnotation } from '@3db/model';
import { CENTRE_OVERSHOOT } from './annotation';
import { ARROW, DIM_TEXT, lengthNumber } from './dimension';
import { circlePolyline } from './geometry';
import { toSheet, type PlacedView } from './layout';
import type { SceneItem } from './scene';

/**
 * How the annotations of D-I3 are drawn (ADR 0132): notes and their leaders, datum feature symbols (ISO 5459), feature control frames (ISO 1101) and the centre
 * lines and marks put by hand. The symbols of the characteristics are drawn as lines, not as characters of a font: the standard fonts of a PDF and of a DXF
 * reader do not have them, and a drawing must read the same wherever it is opened. Sizes are on the sheet and do not follow the view's scale; only where an
 * annotation stands follows the view.
 */

type P = [number, number];

/** The height of a frame's row and the side of a datum's square (mm on the sheet): twice the text height (ISO 1101). */
export const FRAME_HEIGHT = 2 * DIM_TEXT;
/** The datum's triangle: half its base and its height (mm on the sheet). */
const TRIANGLE_HALF = 1.6;
export const DATUM_TRIANGLE = 2.8;
const TRIANGLE_HEIGHT = DATUM_TRIANGLE;
/** The arrowhead of a leader is a dimension's (mm on the sheet). */
const ARROW_HALF = ARROW / 6;

const thin = (...pts: P[]): SceneItem => ({ kind: 'polyline', points: pts.flat(), style: 'thin' });
const charWidth = (text: string, height: number) => [...text].reduce((w, c) => w + (c.charCodeAt(0) > 0x2e80 ? 1.4 : 0.62) * height, 0);

/** A filled arrowhead with its tip at `tip`, pointing along the unit vector `u`. */
function arrowhead(tip: P, u: P): SceneItem {
  const back: P = [tip[0] - u[0] * ARROW, tip[1] - u[1] * ARROW];
  return { kind: 'polyline', points: [...tip, back[0] - u[1] * ARROW_HALF, back[1] + u[0] * ARROW_HALF, back[0] + u[1] * ARROW_HALF, back[1] - u[0] * ARROW_HALF], style: 'thin', closed: true, filled: true };
}

/** A leader from `from` to `to` with its arrow at `to` (nothing when the two are the same point). */
function leader(from: P, to: P): SceneItem[] {
  const l = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (l < 1e-6) return [];
  const u: P = [(to[0] - from[0]) / l, (to[1] - from[1]) / l];
  return [thin(from, to), arrowhead(to, u)];
}

/**
 * The symbol of a characteristic as lines in a square cell of side `s` about `c` (ISO 1101, Table 2). Coordinates are in units of the cell, from its middle,
 * y up.
 */
export function characteristicSymbol(ch: GeometricCharacteristic, c: P, s: number): SceneItem[] {
  const k = 0.62 * s;
  const at = (x: number, y: number): P => [c[0] + x * k, c[1] + y * k];
  const line = (...pts: [number, number][]) => thin(...pts.map(([x, y]) => at(x, y)));
  const circle = (r: number, x = 0, y = 0): SceneItem => ({ kind: 'polyline', points: circlePolyline(at(x, y), r * k, 48), style: 'thin', closed: true });
  const arc = (r: number, from: number, to: number): SceneItem => {
    const pts: number[] = [];
    for (let i = 0; i <= 24; i++) {
      const a = from + ((to - from) * i) / 24;
      pts.push(...at(r * Math.cos(a), r * Math.sin(a) - 0.2));
    }
    return { kind: 'polyline', points: pts, style: 'thin' };
  };
  const arrowAt = (x0: number, y0: number, x1: number, y1: number): SceneItem[] => {
    const a = at(x0, y0);
    const b = at(x1, y1);
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const u: P = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
    return [thin(a, b), { kind: 'polyline', points: scaleArrow(b, u, 0.3 * k), style: 'thin', closed: true, filled: true }];
  };
  const d60: [number, number] = [Math.cos(Math.PI / 3), Math.sin(Math.PI / 3)];
  switch (ch) {
    case 'straightness':
      return [line([-0.45, 0], [0.45, 0])];
    case 'flatness':
      return [{ ...line([-0.5, -0.22], [0.25, -0.22], [0.5, 0.22], [-0.25, 0.22]), closed: true } as SceneItem];
    case 'circularity':
      return [circle(0.38)];
    case 'cylindricity': {
      // a circle and two lines at 60° touching it
      const n: [number, number] = [-d60[1], d60[0]];
      const r = 0.28;
      return [circle(r), line([n[0] * r - d60[0] * 0.5, n[1] * r - d60[1] * 0.5], [n[0] * r + d60[0] * 0.5, n[1] * r + d60[1] * 0.5]), line([-n[0] * r - d60[0] * 0.5, -n[1] * r - d60[1] * 0.5], [-n[0] * r + d60[0] * 0.5, -n[1] * r + d60[1] * 0.5])];
    }
    case 'lineProfile':
      return [arc(0.45, 0, Math.PI)];
    case 'surfaceProfile':
      return [arc(0.45, 0, Math.PI), line([-0.45, -0.2], [0.45, -0.2])];
    case 'parallelism':
      // two lines at 60°, side by side
      return [line([-0.42, -0.4], [-0.42 + 0.9 * d60[0], -0.4 + 0.9 * d60[1]]), line([-0.1, -0.4], [-0.1 + 0.9 * d60[0], -0.4 + 0.9 * d60[1]])];
    case 'perpendicularity':
      return [line([0, -0.4], [0, 0.42]), line([-0.45, -0.4], [0.45, -0.4])];
    case 'angularity':
      // a line at 30° from the base, both from the left corner
      return [line([-0.45, -0.38], [0.45, -0.38]), line([-0.45, -0.38], [-0.45 + 0.95 * Math.cos(Math.PI / 6), -0.38 + 0.95 * Math.sin(Math.PI / 6)])];
    case 'position':
      return [circle(0.27), line([-0.48, 0], [0.48, 0]), line([0, -0.48], [0, 0.48])];
    case 'concentricity':
      return [circle(0.42), circle(0.2)];
    case 'symmetry':
      return [line([-0.48, 0], [0.48, 0]), line([-0.3, 0.26], [0.3, 0.26]), line([-0.3, -0.26], [0.3, -0.26])];
    case 'circularRunout':
      return arrowAt(-0.3, -0.45, 0.3, 0.45);
    case 'totalRunout':
      return [...arrowAt(-0.45, -0.45, 0.05, 0.45), ...arrowAt(-0.1, -0.45, 0.4, 0.45), line([-0.45, -0.45], [-0.1, -0.45])];
  }
}

/** The points of a filled arrowhead of length `l` with its tip at `tip`, pointing along `u`: a symbol's own, smaller than a leader's. */
function scaleArrow(tip: P, u: P, l: number): number[] {
  const back: P = [tip[0] - u[0] * l, tip[1] - u[1] * l];
  const half = l / 3;
  return [...tip, back[0] - u[1] * half, back[1] + u[0] * half, back[0] + u[1] * half, back[1] - u[0] * half];
}

/** Ⓜ or Ⓛ: the letter in a circle, about `c` (mm on the sheet). */
function materialMark(m: 'M' | 'L', c: P): SceneItem[] {
  const r = 0.62 * DIM_TEXT;
  return [{ kind: 'polyline', points: circlePolyline(c, r, 32), style: 'thin', closed: true }, { kind: 'text', at: [c[0], c[1] - 0.36 * DIM_TEXT], text: m, height: 0.72 * DIM_TEXT, anchor: 'center' }];
}

/** The width (mm on the sheet) Ⓜ takes after a text. */
const MARK = 1.5 * DIM_TEXT;
/** The room either side of what is written in a cell (mm on the sheet). */
const PAD = 0.45 * DIM_TEXT;

/** The cells of a frame, from the left: their widths and what each writes. */
function frameCells(f: ToleranceFrameAnnotation, unit: LengthUnit): { w: number; text: string; material?: 'M' | 'L'; symbol?: true }[] {
  const tol = `${f.diameter ? 'Ø' : ''}${lengthNumber(f.tolerance, 4, unit)}`;
  return [
    { w: FRAME_HEIGHT, text: '', symbol: true },
    { w: 2 * PAD + charWidth(tol, DIM_TEXT) + (f.material ? MARK : 0), text: tol, ...(f.material ? { material: f.material } : {}) },
    ...f.datums.map((d) => ({ w: Math.max(FRAME_HEIGHT, 2 * PAD + charWidth(d.label, DIM_TEXT) + (d.material ? MARK : 0)), text: d.label, ...(d.material ? { material: d.material } : {}) })),
  ];
}

/** A feature control frame: its cells left to right from the middle of its left side, and the leader to the feature. */
function frameItems(f: ToleranceFrameAnnotation, placed: PlacedView, unit: LengthUnit): SceneItem[] {
  const [x0, y] = toSheet(placed, f.at[0], f.at[1]);
  const items: SceneItem[] = [];
  const cells = frameCells(f, unit);
  const total = cells.reduce((w, c) => w + c.w, 0);
  const top = y + FRAME_HEIGHT / 2;
  const bottom = y - FRAME_HEIGHT / 2;
  items.push({ kind: 'polyline', points: [x0, bottom, x0 + total, bottom, x0 + total, top, x0, top], style: 'thin', closed: true });
  let x = x0;
  for (const [i, c] of cells.entries()) {
    if (i > 0) items.push(thin([x, bottom], [x, top]));
    if (c.symbol) items.push(...characteristicSymbol(f.characteristic, [x + c.w / 2, y], FRAME_HEIGHT));
    else {
      const textW = charWidth(c.text, DIM_TEXT);
      const inner = textW + (c.material ? MARK : 0);
      const start = x + (c.w - inner) / 2;
      items.push({ kind: 'text', at: [start + textW / 2, y - DIM_TEXT / 2], text: c.text, height: DIM_TEXT, anchor: 'center' });
      if (c.material) items.push(...materialMark(c.material, [start + textW + MARK / 2, y]));
    }
    x += c.w;
  }
  if (f.leader) items.push(...leader([x0, y], toSheet(placed, f.leader[0], f.leader[1])));
  return items;
}

/** A datum feature symbol: the filled triangle on the feature, the line to the square and the letter in it. */
function datumItems(a: DatumAnnotation, placed: PlacedView): SceneItem[] {
  const s = toSheet(placed, a.at[0], a.at[1]);
  const angle = ((a.angle ?? 90) * Math.PI) / 180;
  const u: P = [Math.cos(angle), Math.sin(angle)];
  const n: P = [-u[1], u[0]];
  const apex: P = [s[0] + u[0] * TRIANGLE_HEIGHT, s[1] + u[1] * TRIANGLE_HEIGHT];
  const items: SceneItem[] = [{ kind: 'polyline', points: [s[0] + n[0] * TRIANGLE_HALF, s[1] + n[1] * TRIANGLE_HALF, s[0] - n[0] * TRIANGLE_HALF, s[1] - n[1] * TRIANGLE_HALF, ...apex], style: 'thin', closed: true, filled: true }];
  const length = a.length ?? 6;
  const foot: P = [apex[0] + u[0] * length, apex[1] + u[1] * length];
  items.push(thin(apex, foot));
  // the square, square to the sheet, touching the end of the line with the middle of the side the line comes in by
  const half = FRAME_HEIGHT / 2;
  const reach = half / Math.max(Math.abs(u[0]), Math.abs(u[1]));
  const c: P = [foot[0] + u[0] * reach, foot[1] + u[1] * reach];
  items.push({ kind: 'polyline', points: [c[0] - half, c[1] - half, c[0] + half, c[1] - half, c[0] + half, c[1] + half, c[0] - half, c[1] + half], style: 'thin', closed: true });
  items.push({ kind: 'text', at: [c[0], c[1] - DIM_TEXT / 2], text: a.label, height: DIM_TEXT, anchor: 'center' });
  return items;
}

/** A note: its lines down from the first's baseline, and a leader from the side of the text nearer the feature. */
function noteItems(a: NoteAnnotation, placed: PlacedView, lookup: (key: string) => string | undefined): SceneItem[] {
  const [x, y] = toSheet(placed, a.at[0], a.at[1]);
  const h = a.height ?? DIM_TEXT;
  const lines = noteText(a.text, lookup).split('\n');
  const items: SceneItem[] = lines.map((text, i) => ({ kind: 'text', at: [x, y - i * 1.6 * h], text, height: h }));
  if (a.leader) {
    const w = Math.max(...lines.map((l) => charWidth(l, h)));
    const target = toSheet(placed, a.leader[0], a.leader[1]);
    // from the middle of the first line, on the side the feature is
    const from: P = target[0] > x + w ? [x + w + 1, y + h / 2] : [x - 1, y + h / 2];
    items.push(...leader(from, target));
  }
  return items;
}

/**
 * What the annotations of a view draw on the sheet, where the view is placed: all of them, in the order they are in the document. `lookup` answers a note's
 * `$PRP:key`.
 */
export function annotationItems(annotations: readonly Annotation[], placed: PlacedView, lookup: (key: string) => string | undefined, unit: LengthUnit = 'mm'): SceneItem[] {
  return annotations.flatMap((a): SceneItem[] => {
    switch (a.kind) {
      case 'note':
        return noteItems(a, placed, lookup);
      case 'datum':
        return datumItems(a, placed);
      case 'fcf':
        return frameItems(a, placed, unit);
      case 'centreLine': {
        const p = toSheet(placed, a.from[0], a.from[1]);
        const q = toSheet(placed, a.to[0], a.to[1]);
        const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
        const u: P = l > 0 ? [(q[0] - p[0]) / l, (q[1] - p[1]) / l] : [1, 0];
        return [{ kind: 'polyline', points: [p[0] - u[0] * CENTRE_OVERSHOOT, p[1] - u[1] * CENTRE_OVERSHOOT, q[0] + u[0] * CENTRE_OVERSHOOT, q[1] + u[1] * CENTRE_OVERSHOOT], style: 'center' }];
      }
      case 'centreMark': {
        const c = toSheet(placed, a.at[0], a.at[1]);
        const r = a.radius * placed.scale + CENTRE_OVERSHOOT;
        // in two halves from the middle each way, so that the long dash is across the centre, as the automatic marks are drawn
        return [
          [c[0] + r, c[1]],
          [c[0] - r, c[1]],
          [c[0], c[1] + r],
          [c[0], c[1] - r],
        ].map((e): SceneItem => ({ kind: 'polyline', points: [...c, ...(e as P)], style: 'center' }));
      }
    }
  });
}
