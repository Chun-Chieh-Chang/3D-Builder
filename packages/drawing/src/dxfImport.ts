import { t } from '@3db/i18n';
import type { Id, IdAllocator, SketchEntity } from '@3db/model';
import { dxfUnescape, readDxf, type DxfDocument, type DxfEntity, type Pair } from './dxfRead';

/**
 * 「匯入 DXF」 (F2.6): the geometry of a DXF made into the entities of a sketch. What is read: LINE, CIRCLE, ARC, ELLIPSE, LWPOLYLINE and POLYLINE (bulges as
 * arcs), SPLINE, POINT, TEXT and MTEXT, and INSERT (blocks expanded, nested, scaled, turned, mirrored and in arrays) of the model space, in millimetres by
 * `$INSUNITS`. A DIMENSION, a HATCH and the rest are counted and left out; what is wrong with an entity is said, entity by entity, and it is left out — never
 * changed into something else.
 *
 * Exact where a sketch can hold the curve: lines, circles, arcs, whole ellipses, and a spline that is not rational as the Bézier pieces it is made of (knots
 * inserted). Approximated, within the tolerance said, where it cannot: a part of an ellipse (a sketch has no elliptical arc), a rational spline, a circle or an
 * arc scaled unevenly by its block. The ends of curves that meet (within `mergeTolerance`) become one point: no relation is added.
 */

type P = [number, number];

/** How far an approximated curve may stray from the curve of the file (mm). */
export const DXF_APPROXIMATION = 0.001;
/** Entities and array cells visited while blocks are expanded: past it, the file is refused (a block can place another a million times). */
export const DXF_MAX_WORK = 200_000;
/** Curves a sketch may get from one file: past it, the file is refused rather than a sketch made that no one can work with. */
export const DXF_MAX_CURVES = 5000;
/** Deepest nesting of blocks followed. */
export const DXF_MAX_DEPTH = 16;

/** What a unit of `$INSUNITS` is in millimetres. */
const UNITS: Record<number, number> = { 1: 25.4, 2: 304.8, 3: 1_609_344, 4: 1, 5: 10, 6: 1000, 7: 1_000_000, 8: 0.0000254, 9: 0.0254, 10: 914.4, 11: 1e-7, 12: 1e-6, 13: 0.001, 14: 100, 15: 10_000, 16: 100_000 };

/** The curves of a file, in millimetres, before they are sketch entities. A conic is c + u·cos t + v·sin t for t from t0 to t1 (t1 > t0). */
type Shape =
  | { kind: 'line'; a: P; b: P }
  | { kind: 'conic'; c: P; u: P; v: P; t0: number; t1: number; full: boolean }
  | { kind: 'nurbs'; degree: number; poles: P[]; weights: number[] | null; knots: number[] }
  | { kind: 'point'; p: P }
  | { kind: 'text'; at: P; height: number; angle: number; align: 'left' | 'center' | 'right'; text: string };

interface Placed {
  shape: Shape;
  layer: string;
  /** 「LINE 2F」: the entity's type and handle, for what is said about it. */
  what: string;
}

export interface DxfProblem {
  what: string;
  layer: string;
  why: string;
}

export interface DxfSurvey {
  /** The unit of the file, as `$INSUNITS` says (null: it says none, read as millimetres). */
  unit: number | null;
  /** Millimetres per unit of the file. */
  scale: number;
  /** Each layer with geometry, with how many curves, points and texts it gives (a polyline gives one a segment, a block one for each of its own). */
  layers: { name: string; count: number }[];
  /** The extent of what can be imported (mm), null when there is nothing. */
  bounds: { min: P; max: P } | null;
  /** Entities of kinds a sketch does not take (DIMENSION, HATCH …), by kind. */
  skipped: Record<string, number>;
  problems: DxfProblem[];
}

export interface DxfImportOptions {
  /** The layers to import (all when left out). */
  layers?: ReadonlySet<string>;
  /** The layers whose curves come in as construction geometry. */
  construction?: ReadonlySet<string>;
  /** Ends nearer than this (mm) become one point. Default: a millionth of the drawing's extent. */
  mergeTolerance?: number;
}

export interface DxfImport {
  entities: SketchEntity[];
  /** Entities of the sketch made, by kind (lines, arcs …). */
  made: Record<string, number>;
  /** Curves of the file approximated (a part of an ellipse, a rational spline), and the most any strays (mm). */
  approximated: { count: number; deviation: number };
  skipped: Record<string, number>;
  problems: DxfProblem[];
  /** The tolerance the ends were merged with (mm). */
  mergeTolerance: number;
}

export class DxfImportError extends Error {}

/** The text of a DXF file: UTF-8 (2007 and later), or the code page `$DWGCODEPAGE` names (older files: ANSI_1252, ANSI_950 …). A binary DXF is refused. */
export function dxfText(bytes: Uint8Array): string {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 22));
  if (head.startsWith('AutoCAD Binary DXF')) throw new DxfImportError(t('dxfImport.binary'));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    const latin = new TextDecoder('latin1').decode(bytes);
    const page = /\$DWGCODEPAGE\s*\r?\n\s*3\s*\r?\n\s*ANSI_(\d+)/i.exec(latin)?.[1];
    const encoding = page === '950' ? 'big5' : page === '936' ? 'gbk' : page === '932' ? 'shift_jis' : page === '949' ? 'euc-kr' : page ? `windows-${page}` : 'windows-1252';
    try {
      return new TextDecoder(encoding).decode(bytes);
    } catch {
      return latin;
    }
  }
}

/** What a DXF holds that a sketch can take: layers, unit, extent, and what will be left out and why. */
export function surveyDxf(text: string): DxfSurvey {
  const { placed, skipped, problems, unit, scale } = flatten(text);
  const counts = new Map<string, number>();
  for (const p of placed) counts.set(p.layer, (counts.get(p.layer) ?? 0) + 1);
  const layers = [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
  return { unit, scale, layers, bounds: boundsOf(placed), skipped, problems };
}

/** The sketch entities for a DXF, with fresh ids from `ids`. Throws a `DxfImportError` for a file that cannot be read, or that holds too much. */
export function importDxf(text: string, ids: IdAllocator, options: DxfImportOptions = {}): DxfImport {
  const flat = flatten(text);
  const placed = flat.placed.filter((p) => !options.layers || options.layers.has(p.layer));
  const problems = [...flat.problems];
  const curves = placed.filter((p) => p.shape.kind !== 'point' && p.shape.kind !== 'text').length;
  if (curves > DXF_MAX_CURVES) throw new DxfImportError(t('dxfImport.tooManyCurves', { n: curves, max: DXF_MAX_CURVES }));
  const b = boundsOf(placed);
  const extent = b ? Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1]) : 0;
  const mergeTolerance = options.mergeTolerance ?? Math.max(extent * 1e-6, 1e-9);
  if (!(mergeTolerance > 0) || !Number.isFinite(mergeTolerance)) throw new DxfImportError(t('dxfImport.badTolerance', { value: String(mergeTolerance) }));
  const out = new SketchOut(ids, mergeTolerance);
  for (const p of placed) {
    const construction = options.construction?.has(p.layer) ?? false;
    const why = out.add(p.shape, construction);
    if (why) problems.push({ what: p.what, layer: p.layer, why });
  }
  return { entities: out.entities, made: out.made, approximated: { count: out.approximatedCount, deviation: out.deviation }, skipped: flat.skipped, problems, mergeTolerance };
}

// ---------------------------------------------------------------- reading: entities to shapes, blocks expanded

/** x' = m[0]·x + m[1]·y + m[4], y' = m[2]·x + m[3]·y + m[5]. */
type Affine = [number, number, number, number, number, number];
const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];
const apply = (m: Affine, p: P): P => [m[0] * p[0] + m[1] * p[1] + m[4], m[2] * p[0] + m[3] * p[1] + m[5]];
const applyVector = (m: Affine, v: P): P => [m[0] * v[0] + m[1] * v[1], m[2] * v[0] + m[3] * v[1]];
const compose = (outer: Affine, inner: Affine): Affine => [
  outer[0] * inner[0] + outer[1] * inner[2],
  outer[0] * inner[1] + outer[1] * inner[3],
  outer[2] * inner[0] + outer[3] * inner[2],
  outer[2] * inner[1] + outer[3] * inner[3],
  outer[0] * inner[4] + outer[1] * inner[5] + outer[4],
  outer[2] * inner[4] + outer[3] * inner[5] + outer[5],
];

const firstOf = (pairs: Pair[], code: number): string | undefined => pairs.find((p) => p[0] === code)?.[1];
/** A group's number; NaN when it is there but not a number, `fallback` when it is not there. */
const num = (pairs: Pair[], code: number, fallback = 0): number => {
  const v = firstOf(pairs, code);
  return v === undefined ? fallback : Number(v.trim());
};

/** Kinds read; anything else is counted as left out. */
const READ = new Set(['LINE', 'CIRCLE', 'ARC', 'ELLIPSE', 'LWPOLYLINE', 'POLYLINE', 'SPLINE', 'POINT', 'TEXT', 'MTEXT', 'INSERT']);
/** Records that belong to the entity before them. */
const TRAILING = new Set(['VERTEX', 'SEQEND', 'ATTRIB']);

function flatten(text: string): { placed: Placed[]; skipped: Record<string, number>; problems: DxfProblem[]; unit: number | null; scale: number } {
  let doc: DxfDocument;
  try {
    doc = readDxf(text);
  } catch (e) {
    throw new DxfImportError(t('dxfImport.unreadable', { why: e instanceof Error ? e.message : String(e) }));
  }
  const unitPair = doc.header.get('$INSUNITS')?.find((p) => p[0] === 70);
  const unitCode = unitPair ? Number(unitPair[1].trim()) : null;
  const unit = unitCode !== null && UNITS[unitCode] !== undefined ? unitCode : null;
  const scale = unit === null ? 1 : UNITS[unit]!;
  const placed: Placed[] = [];
  const skipped: Record<string, number> = {};
  const problems: DxfProblem[] = [];
  let work = 0;

  const walk = (list: readonly DxfEntity[], m: Affine, inherited: string | null, depth: number, chain: readonly string[]): void => {
    for (let i = 0; i < list.length; i++) {
      if (++work > DXF_MAX_WORK) throw new DxfImportError(t('dxfImport.tooMuch', { max: DXF_MAX_WORK }));
      const e = list[i]!;
      if (TRAILING.has(e.type)) continue;
      if (num(e.pairs, 67) === 1) continue; // paper space
      const layer = e.layer === '0' && inherited !== null ? inherited : e.layer;
      const what = `${e.type}${e.handle ? ` ${e.handle}` : ''}`;
      if (!READ.has(e.type)) {
        skipped[e.type] = (skipped[e.type] ?? 0) + 1;
        continue;
      }
      const say = (why: string) => problems.push({ what, layer, why });
      // OCS entities: an extrusion of (0, 0, -1) mirrors x; any other that is not +Z is not in the plane of a sketch
      const ez = [num(e.pairs, 210, 0), num(e.pairs, 220, 0), num(e.pairs, 230, 1)];
      const ocs = ['CIRCLE', 'ARC', 'LWPOLYLINE', 'POLYLINE', 'TEXT', 'INSERT'].includes(e.type);
      if (ocs && (Math.abs(ez[0]!) > 1e-9 || Math.abs(ez[1]!) > 1e-9 || !(Math.abs(Math.abs(ez[2]!) - 1) < 1e-9))) {
        say(t('dxfImport.notFlat', { x: ez[0]!, y: ez[1]!, z: ez[2]! }));
        continue;
      }
      const local: Affine = ocs && ez[2]! < 0 ? compose(m, [-1, 0, 0, 1, 0, 0]) : m;
      if (e.type === 'INSERT') {
        const name = firstOf(e.pairs, 2) ?? '';
        const content = doc.blockEntities.get(name);
        if (!content) {
          say(t('dxfImport.noBlock', { name }));
          continue;
        }
        if (chain.includes(name) || depth >= DXF_MAX_DEPTH) {
          say(t('dxfImport.blockDepth', { name, max: DXF_MAX_DEPTH }));
          continue;
        }
        const base = doc.blockBases.get(name) ?? [0, 0];
        const at: P = [num(e.pairs, 10), num(e.pairs, 20)];
        const sx = num(e.pairs, 41, 1), sy = num(e.pairs, 42, 1), turn = (num(e.pairs, 50) * Math.PI) / 180;
        const cols = num(e.pairs, 70, 1), rows = num(e.pairs, 71, 1), dx = num(e.pairs, 44), dy = num(e.pairs, 45);
        if (![...at, ...base, sx, sy, turn, cols, rows, dx, dy].every(Number.isFinite) || sx === 0 || sy === 0) {
          say(t('dxfImport.badNumber'));
          continue;
        }
        if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) {
          say(t('dxfImport.badArray', { cols, rows }));
          continue;
        }
        const c = Math.cos(turn), s = Math.sin(turn);
        for (let r = 0; r < rows; r++) {
          for (let k = 0; k < cols; k++) {
            if (++work > DXF_MAX_WORK) throw new DxfImportError(t('dxfImport.tooMuch', { max: DXF_MAX_WORK }));
            // the block's base to the origin, scaled, turned, then to the insertion point plus the cell's offset along the turned axes
            const ox = k * dx, oy = r * dy;
            const place: Affine = [c * sx, -s * sy, s * sx, c * sy, at[0] + c * ox - s * oy - (c * sx * base[0] - s * sy * base[1]), at[1] + s * ox + c * oy - (s * sx * base[0] + c * sy * base[1])];
            walk(content, compose(local, place), layer, depth + 1, [...chain, name]);
          }
        }
        continue;
      }
      // a POLYLINE's vertices are the VERTEX records after it, up to its SEQEND
      const vertices: Pair[][] = [];
      if (e.type === 'POLYLINE') for (let j = i + 1; j < list.length && list[j]!.type === 'VERTEX'; j++) vertices.push(list[j]!.pairs);
      const shapes = shapesOf(e, vertices, say);
      for (const shape of shapes) {
        const moved = transformed(shape, local, scale);
        if (moved) placed.push({ shape: moved, layer, what });
        else say(t('dxfImport.badNumber'));
      }
    }
  };
  walk(doc.entities, IDENTITY, null, 0, []);
  return { placed, skipped, problems, unit, scale };
}

/** A bulge from a to b: the arc whose included angle is 4·atan(bulge), counter-clockwise when it is positive. */
function bulgeArc(a: P, b: P, bulge: number): Shape {
  const theta = 4 * Math.atan(bulge);
  const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const r = chord / (2 * Math.abs(Math.sin(theta / 2)));
  const mid: P = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  // the centre is off the chord's middle, to the left of a→b for a counter-clockwise arc of less than half a turn
  const h = r * Math.cos(theta / 2) * Math.sign(bulge);
  const n: P = [-(b[1] - a[1]) / chord, (b[0] - a[0]) / chord];
  const c: P = [mid[0] + n[0] * h, mid[1] + n[1] * h];
  const ta = Math.atan2(a[1] - c[1], a[0] - c[0]);
  if (theta > 0) return { kind: 'conic', c, u: [r, 0], v: [0, r], t0: ta, t1: ta + theta, full: false };
  // clockwise: the same circle run the other way, so t still grows (v = -y)
  return { kind: 'conic', c, u: [r, 0], v: [0, -r], t0: -ta, t1: -ta - theta, full: false };
}

/** The vertices of a polyline as lines and arcs; the last back to the first when it is closed. */
function polylineShapes(points: { p: P; bulge: number }[], closed: boolean, say: (why: string) => void): Shape[] {
  const out: Shape[] = [];
  const n = points.length;
  for (let k = 0; k < (closed ? n : n - 1); k++) {
    const a = points[k]!, b = points[(k + 1) % n]!;
    if (![...a.p, ...b.p, a.bulge].every(Number.isFinite)) {
      say(t('dxfImport.badNumber'));
      continue;
    }
    if (a.p[0] === b.p[0] && a.p[1] === b.p[1]) continue; // a repeated vertex: no segment, nothing lost
    out.push(Math.abs(a.bulge) < 1e-12 ? { kind: 'line', a: a.p, b: b.p } : bulgeArc(a.p, b.p, a.bulge));
  }
  return out;
}

/** The shapes of one entity in its own coordinates (the file's units); what is wrong with it is said and it gives none. */
function shapesOf(e: DxfEntity, vertices: Pair[][], say: (why: string) => void): Shape[] {
  const p = e.pairs;
  const finite = (...v: number[]) => {
    const ok = v.every(Number.isFinite);
    if (!ok) say(t('dxfImport.badNumber'));
    return ok;
  };
  switch (e.type) {
    case 'LINE': {
      const a: P = [num(p, 10), num(p, 20)], b: P = [num(p, 11), num(p, 21)];
      return finite(...a, ...b) ? [{ kind: 'line', a, b }] : [];
    }
    case 'POINT': {
      const at: P = [num(p, 10), num(p, 20)];
      return finite(...at) ? [{ kind: 'point', p: at }] : [];
    }
    case 'CIRCLE':
    case 'ARC': {
      const c: P = [num(p, 10), num(p, 20)], r = num(p, 40);
      if (!finite(...c, r)) return [];
      if (!(r > 0)) {
        say(t('dxfImport.badRadius', { r }));
        return [];
      }
      if (e.type === 'CIRCLE') return [{ kind: 'conic', c, u: [r, 0], v: [0, r], t0: 0, t1: 2 * Math.PI, full: true }];
      const a0 = (num(p, 50) * Math.PI) / 180, a1raw = (num(p, 51) * Math.PI) / 180;
      if (!finite(a0, a1raw)) return [];
      let a1 = a1raw;
      while (a1 <= a0) a1 += 2 * Math.PI;
      while (a1 - a0 > 2 * Math.PI) a1 -= 2 * Math.PI;
      // an arc of a whole turn is a circle
      const whole = a1 - a0 > 2 * Math.PI - 1e-12;
      return [{ kind: 'conic', c, u: [r, 0], v: [0, r], t0: a0, t1: whole ? a0 + 2 * Math.PI : a1, full: whole }];
    }
    case 'ELLIPSE': {
      const c: P = [num(p, 10), num(p, 20)], major: P = [num(p, 11), num(p, 21)], ratio = num(p, 40), s0 = num(p, 41, 0), s1raw = num(p, 42, 2 * Math.PI);
      const ez = num(p, 230, 1);
      if (!finite(...c, ...major, ratio, s0, s1raw, ez)) return [];
      if (!(Math.hypot(...major) > 0) || !(ratio > 0 && ratio <= 1 + 1e-9)) {
        say(t('dxfImport.badEllipse', { ratio }));
        return [];
      }
      // the minor axis is the major turned a quarter about the extrusion: counter-clockwise for +Z, clockwise for -Z
      const sign = ez < 0 ? -1 : 1;
      const v: P = [-major[1] * ratio * sign, major[0] * ratio * sign];
      let s1 = s1raw;
      while (s1 <= s0) s1 += 2 * Math.PI;
      const full = Math.abs(s1 - s0 - 2 * Math.PI) < 1e-9;
      return [{ kind: 'conic', c, u: major, v, t0: s0, t1: full ? s0 + 2 * Math.PI : s1, full }];
    }
    case 'LWPOLYLINE': {
      const points: { p: P; bulge: number }[] = [];
      for (const [code, value] of p) {
        if (code === 10) points.push({ p: [Number(value.trim()), NaN], bulge: 0 });
        else if (code === 20 && points.length) points[points.length - 1]!.p[1] = Number(value.trim());
        else if (code === 42 && points.length) points[points.length - 1]!.bulge = Number(value.trim());
      }
      return polylineShapes(points, (num(p, 70) & 1) === 1, say);
    }
    case 'POLYLINE': {
      const flags = num(p, 70);
      if (flags & (16 | 64)) {
        say(t('dxfImport.mesh'));
        return [];
      }
      // spline-frame control points (16) are not on the curve; the fitted vertices (8) are
      const points = vertices.filter((v) => !(num(v, 70) & 16)).map((v) => ({ p: [num(v, 10), num(v, 20)] as P, bulge: num(v, 42) }));
      return polylineShapes(points, (flags & 1) === 1, say);
    }
    case 'SPLINE': {
      const degree = num(p, 71);
      const knots = p.filter((x) => x[0] === 40).map((x) => Number(x[1].trim()));
      const weights = p.filter((x) => x[0] === 41).map((x) => Number(x[1].trim()));
      const poles: P[] = [];
      for (const [code, value] of p) {
        if (code === 10) poles.push([Number(value.trim()), NaN]);
        else if (code === 20 && poles.length) poles[poles.length - 1]![1] = Number(value.trim());
      }
      if (!finite(degree, ...knots, ...weights, ...poles.flat())) return [];
      if (!Number.isInteger(degree) || degree < 1 || poles.length < degree + 1 || knots.length !== poles.length + degree + 1 || knots.some((k, j) => j > 0 && k < knots[j - 1]!)
        || (weights.length > 0 && (weights.length !== poles.length || weights.some((w) => !(w > 0))))) {
        // a spline given by fit points only (no control points) is not read: its curve is the program's own fit
        say(t(poles.length === 0 ? 'dxfImport.splineFitOnly' : 'dxfImport.badSpline'));
        return [];
      }
      const rational = weights.length > 0 && weights.some((w) => Math.abs(w - weights[0]!) > 1e-12);
      return [{ kind: 'nurbs', degree, poles, weights: rational ? weights : null, knots }];
    }
    case 'TEXT': {
      const h = num(p, 40), angle = num(p, 50), h72 = num(p, 72), v73 = num(p, 74, num(p, 73));
      const aligned = h72 !== 0 || v73 !== 0;
      let at: P = aligned && firstOf(p, 11) !== undefined ? [num(p, 11), num(p, 21)] : [num(p, 10), num(p, 20)];
      if (!finite(...at, h, angle)) return [];
      if (!(h > 0)) {
        say(t('dxfImport.badHeight', { h }));
        return [];
      }
      // 3 aligned and 5 fit run from 10 to 11: written from 10; 4 middle is centred both ways
      if (h72 === 3 || h72 === 5) at = [num(p, 10), num(p, 20)];
      const align = h72 === 1 || h72 === 4 ? 'center' : h72 === 2 ? 'right' : 'left';
      const down = h72 === 4 || v73 === 2 ? h / 2 : v73 === 3 ? h : 0;
      const r = (angle * Math.PI) / 180;
      const text = textCodes(dxfUnescape(firstOf(p, 1) ?? ''));
      return text.trim() ? [{ kind: 'text', at: [at[0] + Math.sin(r) * down, at[1] - Math.cos(r) * down], height: h, angle, align, text }] : [];
    }
    case 'MTEXT': {
      const h = num(p, 40), attach = num(p, 71, 1);
      const at: P = [num(p, 10), num(p, 20)];
      const angle = firstOf(p, 11) !== undefined ? (Math.atan2(num(p, 21), num(p, 11)) * 180) / Math.PI : num(p, 50);
      if (!finite(...at, h, angle, attach)) return [];
      if (!(h > 0)) {
        say(t('dxfImport.badHeight', { h }));
        return [];
      }
      const raw = p.filter((x) => x[0] === 3).map((x) => x[1]).join('') + (firstOf(p, 1) ?? '');
      const lines = mtextLines(dxfUnescape(raw));
      const col = (attach - 1) % 3, row = Math.floor((attach - 1) / 3);
      const align = col === 1 ? 'center' : col === 2 ? 'right' : 'left';
      const pitch = h * 5 / 3;
      // the first baseline: a cap height under the top, the block centred on the middle, the last baseline on the bottom
      const first = row === 0 ? -h : row === 1 ? ((lines.length - 1) * pitch - h) / 2 : (lines.length - 1) * pitch;
      const r = (angle * Math.PI) / 180;
      return lines.flatMap((text, k) => {
        if (!text.trim()) return [];
        const d = first - k * pitch;
        return [{ kind: 'text' as const, at: [at[0] - Math.sin(r) * d, at[1] + Math.cos(r) * d] as P, height: h, angle, align, text }];
      });
    }
  }
  return [];
}

/** The %% codes of TEXT: %%c Ø, %%d °, %%p ±, %%% a percent sign; the underline and overline switches dropped. */
function textCodes(s: string): string {
  return s.replace(/%%([cCdDpPuUoO%])/g, (_, c: string) => ({ c: 'Ø', d: '°', p: '±', '%': '%' })[c.toLowerCase()] ?? '');
}

/** MTEXT's words without its formatting: \P a new line, a stack \S a^b; as a/b, fonts, heights, colours and braces dropped. */
function mtextLines(s: string): string[] {
  const plain = s
    .replace(/\\[Pp]/g, '\n')
    .replace(/\\S([^;]*?)[\^#/]([^;]*?);/g, '$1/$2')
    .replace(/\\[fFcCHhTtQqWwAa][^;]*;/g, '')
    .replace(/\\[LlOoKk]/g, '')
    .replace(/\\~/g, ' ')
    .replace(/\\([\\{}])/g, '\u0000$1')
    .replace(/[{}]/g, '')
    .replace(/\u0000(.)/g, '$1');
  return textCodes(plain).split('\n');
}

/** A shape moved by `m` and scaled to millimetres; null when a number is not finite. */
function transformed(s: Shape, m0: Affine, scale: number): Shape | null {
  const m: Affine = [m0[0] * scale, m0[1] * scale, m0[2] * scale, m0[3] * scale, m0[4] * scale, m0[5] * scale];
  let out: Shape;
  if (s.kind === 'line') out = { kind: 'line', a: apply(m, s.a), b: apply(m, s.b) };
  else if (s.kind === 'point') out = { kind: 'point', p: apply(m, s.p) };
  else if (s.kind === 'conic') out = { ...s, c: apply(m, s.c), u: applyVector(m, s.u), v: applyVector(m, s.v) };
  else if (s.kind === 'nurbs') out = { ...s, poles: s.poles.map((q) => apply(m, q)) };
  else {
    // a text keeps its shape: its place and direction follow, its height by how much the transform stretches along it
    const r = (s.angle * Math.PI) / 180;
    const along = applyVector(m, [Math.cos(r), Math.sin(r)]);
    const up = applyVector(m, [-Math.sin(r), Math.cos(r)]);
    const mirrored = along[0] * up[1] - along[1] * up[0] < 0;
    out = { ...s, at: apply(m, s.at), height: s.height * Math.hypot(...up), angle: (Math.atan2(along[1], along[0]) * 180) / Math.PI, ...(mirrored ? { align: s.align === 'left' ? 'right' : s.align === 'right' ? 'left' : 'center' } : {}) };
  }
  return numbersOf(out).every(Number.isFinite) ? out : null;
}

/** Every number a shape is made of. */
function numbersOf(s: Shape): number[] {
  if (s.kind === 'line') return [...s.a, ...s.b];
  if (s.kind === 'point') return [...s.p];
  if (s.kind === 'conic') return [...s.c, ...s.u, ...s.v, s.t0, s.t1];
  if (s.kind === 'nurbs') return [...s.poles.flat(), ...s.knots, ...(s.weights ?? [])];
  return [...s.at, s.height, s.angle];
}

function boundsOf(placed: readonly Placed[]): { min: P; max: P } | null {
  let min: P = [Infinity, Infinity], max: P = [-Infinity, -Infinity];
  const see = (q: P) => {
    min = [Math.min(min[0], q[0]), Math.min(min[1], q[1])];
    max = [Math.max(max[0], q[0]), Math.max(max[1], q[1])];
  };
  for (const { shape: s } of placed) {
    if (s.kind === 'line') (see(s.a), see(s.b));
    else if (s.kind === 'point') see(s.p);
    else if (s.kind === 'text') see(s.at);
    else if (s.kind === 'nurbs') s.poles.forEach(see);
    else for (let k = 0; k <= 32; k++) see(conicAt(s, s.t0 + ((s.t1 - s.t0) * k) / 32));
  }
  return Number.isFinite(min[0]) ? { min, max } : null;
}

// ---------------------------------------------------------------- shapes to sketch entities

const conicAt = (s: Extract<Shape, { kind: 'conic' }>, tt: number): P => [s.c[0] + s.u[0] * Math.cos(tt) + s.v[0] * Math.sin(tt), s.c[1] + s.u[1] * Math.cos(tt) + s.v[1] * Math.sin(tt)];
const conicTangent = (s: Extract<Shape, { kind: 'conic' }>, tt: number): P => [-s.u[0] * Math.sin(tt) + s.v[0] * Math.cos(tt), -s.u[1] * Math.sin(tt) + s.v[1] * Math.cos(tt)];
const dist = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const cubicAt = (q: readonly P[], tt: number): P => {
  const s = 1 - tt;
  const w = [s * s * s, 3 * s * s * tt, 3 * s * tt * tt, tt * tt * tt];
  return [w.reduce((acc, wi, k) => acc + wi * q[k]![0], 0), w.reduce((acc, wi, k) => acc + wi * q[k]![1], 0)];
};

class SketchOut {
  readonly entities: SketchEntity[] = [];
  readonly made: Record<string, number> = {};
  approximatedCount = 0;
  deviation = 0;
  /** The points that can be shared (ends), by grid cell of the tolerance. */
  private readonly grid = new Map<string, { id: Id; p: P }[]>();

  constructor(
    private readonly ids: IdAllocator,
    private readonly tol: number,
  ) {}

  private count(kind: string): void {
    this.made[kind] = (this.made[kind] ?? 0) + 1;
  }

  private newPoint(p: P): Id {
    const id = this.ids.take('p');
    this.entities.push({ id, type: 'point', x: p[0], y: p[1] });
    return id;
  }

  /** An end: the point already there within the tolerance, or a new one. */
  private end(p: P): Id {
    const cx = Math.floor(p[0] / this.tol), cy = Math.floor(p[1] / this.tol);
    let best: { id: Id; p: P } | null = null;
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (const q of this.grid.get(`${cx + i},${cy + j}`) ?? []) if (dist(q.p, p) <= this.tol && (!best || dist(q.p, p) < dist(best.p, p))) best = q;
    if (best) return best.id;
    const id = this.newPoint(p);
    const key = `${cx},${cy}`;
    this.grid.set(key, [...(this.grid.get(key) ?? []), { id, p }]);
    return id;
  }

  /** Adds a shape; what is wrong with it in words (nothing added), or null. */
  add(s: Shape, construction: boolean): string | null {
    const c: { construction?: true } = construction ? { construction: true } : {};
    if (s.kind === 'point') {
      this.end(s.p);
      this.count('point');
      return null;
    }
    if (s.kind === 'text') {
      this.entities.push({ id: this.ids.take('txt'), type: 'text', text: s.text, at: this.newPoint(s.at), size: s.height, angle: s.angle, align: s.align, ...c });
      this.count('text');
      return null;
    }
    if (s.kind === 'line') {
      if (dist(s.a, s.b) <= this.tol) return t('dxfImport.zeroLength');
      const p1 = this.end(s.a), p2 = this.end(s.b);
      if (p1 === p2) return t('dxfImport.zeroLength');
      this.entities.push({ id: this.ids.take('l'), type: 'line', p1, p2, ...c });
      this.count('line');
      return null;
    }
    if (s.kind === 'conic') return this.conic(s, c);
    return this.nurbs(s, c);
  }

  private conic(s: Extract<Shape, { kind: 'conic' }>, c: { construction?: true }): string | null {
    const ru = Math.hypot(...s.u), rv = Math.hypot(...s.v);
    if (!(ru > this.tol) || !(rv > this.tol)) return t('dxfImport.badRadius', { r: Math.min(ru, rv) });
    const cross = s.u[0] * s.v[1] - s.u[1] * s.v[0];
    const round = Math.abs(ru - rv) <= 1e-9 * ru && Math.abs(s.u[0] * s.v[0] + s.u[1] * s.v[1]) <= 1e-9 * ru * rv;
    if (round) {
      if (s.full) {
        this.entities.push({ id: this.ids.take('ci'), type: 'circle', center: this.newPoint(s.c), radius: ru, ...c });
        this.count('circle');
        return null;
      }
      // counter-clockwise from start to end; a mirrored arc (u × v < 0) runs the other way
      const [a, b] = cross > 0 ? [conicAt(s, s.t0), conicAt(s, s.t1)] : [conicAt(s, s.t1), conicAt(s, s.t0)];
      const start = this.end(a), end = this.end(b);
      if (start === end) return t('dxfImport.zeroLength');
      this.entities.push({ id: this.ids.take('a'), type: 'arc', center: this.newPoint(s.c), start, end, ...c });
      this.count('arc');
      return null;
    }
    if (s.full) {
      // the axes of c + u·cos t + v·sin t: where |p - c| is largest, t = ½·atan2(2 u·v, u·u − v·v)
      const tm = 0.5 * Math.atan2(2 * (s.u[0] * s.v[0] + s.u[1] * s.v[1]), ru * ru - rv * rv);
      const major = conicAt(s, tm), minor = conicAt(s, tm + Math.PI / 2);
      const a = dist(major, s.c), b = dist(minor, s.c);
      const [far, near] = a >= b ? [major, b] : [minor, a];
      this.entities.push({ id: this.ids.take('el'), type: 'ellipse', center: this.newPoint(s.c), major: this.newPoint(far), minorRadius: near, ...c });
      this.count('ellipse');
      return null;
    }
    // a part of an ellipse: cubic pieces, each the exact image of a circle's arc approximation, fewer than a quarter turn, until within the tolerance
    return this.approximate((tt) => conicAt(s, s.t0 + (s.t1 - s.t0) * tt), (tt) => {
      const d = conicTangent(s, s.t0 + (s.t1 - s.t0) * tt);
      return [d[0] * (s.t1 - s.t0), d[1] * (s.t1 - s.t0)];
    }, Math.max(1, Math.ceil((s.t1 - s.t0) / (Math.PI / 2))), c);
  }

  /** Cubic Bézier pieces of a curve on [0, 1] given with its derivative, `n` to start with, each split until it is within the approximation tolerance. */
  private approximate(f: (tt: number) => P, df: (tt: number) => P, n: number, c: { construction?: true }): string | null {
    const pieces: P[][] = [];
    let worst = 0;
    const fit = (a: number, b: number, depth: number): boolean => {
      const h = b - a;
      const fa = f(a), fb = f(b), da = df(a), db = df(b);
      const q: P[] = [fa, [fa[0] + (da[0] * h) / 3, fa[1] + (da[1] * h) / 3], [fb[0] - (db[0] * h) / 3, fb[1] - (db[1] * h) / 3], fb];
      let err = 0;
      for (let k = 1; k < 32; k++) err = Math.max(err, dist(cubicAt(q, k / 32), f(a + (h * k) / 32)));
      const degenerate = dist(q[0]!, q[1]!) <= 1e-8 || dist(q[2]!, q[3]!) <= 1e-8;
      if ((err > DXF_APPROXIMATION || degenerate) && depth < 14) return fit(a, (a + b) / 2, depth + 1) && fit((a + b) / 2, b, depth + 1);
      if (err > DXF_APPROXIMATION || degenerate) return false;
      worst = Math.max(worst, err);
      pieces.push(q);
      return true;
    };
    for (let k = 0; k < n; k++) if (!fit(k / n, (k + 1) / n, 0)) return t('dxfImport.approximation', { tol: DXF_APPROXIMATION });
    for (const q of pieces) this.bezier(q, c);
    this.approximatedCount++;
    this.deviation = Math.max(this.deviation, worst);
    return null;
  }

  private bezier(q: readonly P[], c: { construction?: true }, depth = 0): void {
    const first = this.end(q[0]!), last = this.end(q[q.length - 1]!);
    // a piece that comes back to where it starts (a loop): two halves (de Casteljau), since a sketch's Bézier has two different ends
    if (first === last && depth < 4) {
      const left: P[] = [], right: P[] = [];
      let row = q.map((x) => [...x] as P);
      while (row.length) {
        left.push(row[0]!);
        right.unshift(row[row.length - 1]!);
        row = row.slice(1).map((x, k) => [(x[0] + row[k]![0]) / 2, (x[1] + row[k]![1]) / 2] as P);
      }
      this.bezier(left, c, depth + 1);
      this.bezier(right, c, depth + 1);
      return;
    }
    if (first === last) return;
    const inner = q.slice(1, -1).map((x) => this.newPoint(x));
    this.entities.push({ id: this.ids.take('sp'), type: 'spline', points: [first, ...inner, last], bezier: true, ...c });
    this.count('spline');
  }

  private nurbs(s: Extract<Shape, { kind: 'nurbs' }>, c: { construction?: true }): string | null {
    const pieces = bezierPieces(s);
    if (!pieces) return t('dxfImport.badSpline');
    const span = Math.max(...s.poles.map((q) => dist(q, s.poles[0]!)));
    if (!(span > this.tol)) return t('dxfImport.zeroLength');
    let added = 0;
    for (const piece of pieces) {
      const poles = piece.poles;
      if (Math.max(...poles.map((q) => dist(q, poles[0]!))) <= this.tol) continue; // a knot span of no length
      if (s.degree === 1) {
        const p1 = this.end(poles[0]!), p2 = this.end(poles[1]!);
        if (p1 !== p2) (this.entities.push({ id: this.ids.take('l'), type: 'line', p1, p2, ...c }), this.count('line'), added++);
        continue;
      }
      // exact where a sketch's Bézier can be: not rational, and the ends' tangents defined (the solver refuses a pole on the end beside it)
      const ends = dist(poles[0]!, poles[1]!) > 1e-8 && dist(poles[poles.length - 2]!, poles[poles.length - 1]!) > 1e-8;
      if (!piece.weights && ends) {
        this.bezier(poles, c);
        added++;
        continue;
      }
      const why = this.approximate((tt) => bezierAt(poles, piece.weights, tt), (tt) => bezierDerivative(poles, piece.weights, tt), 1, c);
      if (why) return why;
      added++;
    }
    return added ? null : t('dxfImport.zeroLength');
  }
}

/** The Bézier pieces of a B-spline: each inner knot inserted until it is there `degree` times (Boehm), in homogeneous coordinates when it is rational. */
function bezierPieces(s: Extract<Shape, { kind: 'nurbs' }>): { poles: P[]; weights: number[] | null }[] | null {
  const p = s.degree;
  const w = s.weights ?? s.poles.map(() => 1);
  let ctrl = s.poles.map((q, k) => [q[0] * w[k]!, q[1] * w[k]!, w[k]!]);
  let knots = [...s.knots];
  // only the part between knots[p] and knots[n] is the curve
  const lo = knots[p]!, hi = knots[knots.length - p - 1]!;
  if (!(hi > lo)) return null;
  const inner = [...new Set(knots.filter((k) => k > lo && k < hi))];
  for (const u of [...inner, lo, hi]) {
    const have = knots.filter((k) => k === u).length;
    for (let r = have; r < p; r++) {
      // the span u is inserted in: the last knot at or before it, or, for the curve's end, the last before it
      const k = u === hi ? knots.findLastIndex((x) => x < u) : knots.findLastIndex((x) => x <= u);
      if (k < p || k >= ctrl.length) break;
      const next: number[][] = [];
      for (let i = 0; i < ctrl.length + 1; i++) {
        if (i <= k - p) next.push(ctrl[i]!);
        else if (i > k) next.push(ctrl[i - 1]!);
        else {
          const den = knots[i + p]! - knots[i]!;
          const a = den === 0 ? 0 : (u - knots[i]!) / den;
          next.push(ctrl[i]!.map((v, j) => (1 - a) * ctrl[i - 1]![j]! + a * v));
        }
      }
      ctrl = next;
      knots = [...knots.slice(0, k + 1), u, ...knots.slice(k + 1)];
    }
  }
  // each span from a knot u (now there p times) to the next is a Bézier piece: the p + 1 poles that end at u's last index (local support)
  const pieces: { poles: P[]; weights: number[] | null }[] = [];
  for (const u of [...new Set(knots.filter((k) => k >= lo && k < hi))]) {
    const last = knots.lastIndexOf(u);
    const part = ctrl.slice(last - p, last + 1);
    if (last - p < 0 || part.length !== p + 1) return null;
    pieces.push({ poles: part.map((h) => [h[0]! / h[2]!, h[1]! / h[2]!] as P), weights: s.weights ? part.map((h) => h[2]!) : null });
  }
  return pieces.every((x) => x.poles.every((q) => Number.isFinite(q[0]) && Number.isFinite(q[1]))) ? pieces : null;
}

/** A (rational) Bézier at t, by de Casteljau in homogeneous coordinates. */
function bezierAt(poles: readonly P[], weights: readonly number[] | null, tt: number): P {
  let h = poles.map((q, k) => {
    const w = weights?.[k] ?? 1;
    return [q[0] * w, q[1] * w, w];
  });
  while (h.length > 1) h = h.slice(1).map((b, k) => b.map((v, j) => (1 - tt) * h[k]![j]! + tt * v));
  return [h[0]![0]! / h[0]![2]!, h[0]![1]! / h[0]![2]!];
}

/** Its derivative at t, by a central difference of the exact curve (the tangent the cubic pieces are fitted to). */
function bezierDerivative(poles: readonly P[], weights: readonly number[] | null, tt: number): P {
  const e = 1e-6;
  const a = bezierAt(poles, weights, Math.max(0, tt - e)), b = bezierAt(poles, weights, Math.min(1, tt + e));
  const h = Math.min(1, tt + e) - Math.max(0, tt - e);
  return [(b[0] - a[0]) / h, (b[1] - a[1]) / h];
}
