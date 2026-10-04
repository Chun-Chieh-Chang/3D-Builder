import { t } from '@3db/i18n';
import type { Frame, Kernel, Region, ShapeId } from '@3db/kernel';
import type { Id } from '@3db/model';
import type { SheetInfo } from './engine';

/**
 * The flat pattern of a sheet metal part (C11.3, ADR 0088): worked out from the data the features recorded when they were made (`SheetInfo`), not from the folded solid. The base is
 * laid flat (a plate is where it is; a bent base flange is unrolled into a strip), and every edge flange or hem after it is put back where the sheet was before it was bent: the
 * sheet cut back by the trim and the notches as it was, a strip of bend allowance + flat piece grown from the cut. Each flange's place comes from the one before it that it grew
 * from, through a rigid motion (`Rigid`): the bend undone (a turn by −θ about the axis of the bend) and moved on by the bend allowance. The pattern is made as a thin solid in the
 * kernel (so the booleans are the kernel's, and the area and the outline are the kernel's), and its outline, bend lines and sizes are read from it.
 */

type Vec3 = [number, number, number];
type P2 = [number, number];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addv = (a: Vec3, b: Vec3, k = 1): Vec3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** A rotation (rows) and a translation: p ↦ R·p + t. */
interface Rigid {
  R: [number, number, number, number, number, number, number, number, number];
  t: Vec3;
}
const IDENTITY: Rigid = { R: [1, 0, 0, 0, 1, 0, 0, 0, 1], t: [0, 0, 0] };
const turn = (m: Rigid, v: Vec3): Vec3 => [m.R[0] * v[0] + m.R[1] * v[1] + m.R[2] * v[2], m.R[3] * v[0] + m.R[4] * v[1] + m.R[5] * v[2], m.R[6] * v[0] + m.R[7] * v[1] + m.R[8] * v[2]];
const move = (m: Rigid, p: Vec3): Vec3 => addv(turn(m, p), m.t);
/** `a` after `b`. */
function compose(a: Rigid, b: Rigid): Rigid {
  const R = [0, 0, 0, 0, 0, 0, 0, 0, 0] as Rigid['R'];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) R[3 * i + j] = a.R[3 * i]! * b.R[j]! + a.R[3 * i + 1]! * b.R[3 + j]! + a.R[3 * i + 2]! * b.R[6 + j]!;
  return { R, t: move(a, b.t) };
}
/** The turn by `angle` about the unit vector `k` (Rodrigues). */
function rotation(k: Vec3, angle: number): Rigid['R'] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const v = 1 - c;
  return [c + k[0] * k[0] * v, k[0] * k[1] * v - k[2] * s, k[0] * k[2] * v + k[1] * s, k[1] * k[0] * v + k[2] * s, c + k[1] * k[1] * v, k[1] * k[2] * v - k[0] * s, k[2] * k[0] * v - k[1] * s, k[2] * k[1] * v + k[0] * s, c + k[2] * k[2] * v];
}

/** A line, an arc or a whole circle of the outline, in the coordinates of the pattern's frame. An arc goes from `from` to `to` through `mid`. */
export type FlatSegment = { kind: 'line'; a: P2; b: P2 } | { kind: 'arc'; c: P2; r: number; from: P2; to: P2; mid: P2 } | { kind: 'circle'; c: P2; r: number };

export interface FlatBend {
  feature: Id;
  name: string;
  /** The bend line: the middle of the bend in the pattern. */
  a: P2;
  b: P2;
  angle: number;
  radius: number;
  /** Whether the sheet bends toward the side the pattern is seen from (`up`) or away from it (`down`). */
  direction: 'up' | 'down';
  kFactor: number;
  allowance: number;
}

export interface FlatPattern {
  /** The pattern as a thin solid in the kernel (the caller releases it). */
  shape: ShapeId;
  /** The plane the pattern is in: its outline and bend lines are in the coordinates of this frame. */
  frame: Frame;
  thickness: number;
  outline: FlatSegment[];
  bends: FlatBend[];
  min: P2;
  max: P2;
  width: number;
  height: number;
  /** The area of the pattern (one face), and the volume of the solid. */
  area: number;
  volume: number;
}

/** What the interface gets of a pattern: all of it but the solid. */
export type FlatReport = Omit<FlatPattern, 'shape'>;

export class FlatError extends Error {}

const line = (a: P2, b: P2, source: string) => ({ kind: 'line' as const, a, b, source });
const rect = (x0: number, y0: number, x1: number, y1: number, id: string): Region => ({ outer: [line([x0, y0], [x1, y0], `${id}.a`), line([x1, y0], [x1, y1], `${id}.b`), line([x1, y1], [x0, y1], `${id}.c`), line([x0, y1], [x0, y0], `${id}.d`)], holes: [] });

/** The flat pattern of the sheet metal data `sheet`; throws `FlatError` (in words) for what it cannot do. */
export function flatPattern(kernel: Kernel, sheet: SheetInfo): FlatPattern {
  const base = sheet.base;
  if (!base) throw new FlatError(t('flat.noBase'));
  const T = sheet.thickness;
  const owned: ShapeId[] = [];
  const keep = (id: ShapeId): ShapeId => {
    owned.push(id);
    return id;
  };
  try {
    let frame: Frame;
    let body: ShapeId;
    const bends: FlatBend[] = [];
    if (base.kind === 'bent') {
      if (sheet.flanges.length > 0) throw new FlatError(t('flat.bentBaseFlanges'));
      frame = base.frame;
      body = keep(kernel.extrude(frame, [rect(0, 0, base.flatLength, base.width, 'flat')], addv([0, 0, 0], frame.normal, T)).shape);
      let at = 0;
      for (const piece of base.pieces) {
        if (piece.type === 'straight') {
          at += piece.length;
          continue;
        }
        const b = sheet.bends[piece.bend]!;
        bends.push({ feature: b.feature, name: b.name, a: [at + b.allowance / 2, 0], b: [at + b.allowance / 2, base.width], angle: b.angle, radius: b.radius, direction: piece.toward ? 'down' : 'up', kFactor: b.kFactor, allowance: b.allowance });
        at += b.allowance;
      }
    } else {
      frame = base.frame;
      body = keep(kernel.extrude(frame, base.regions, addv([0, 0, 0], base.dir, T)).shape);
      const maps: Rigid[] = [];
      sheet.flanges.forEach((fl, k) => {
        const F = fl.parent < 0 ? IDENTITY : maps[fl.parent]!;
        if (fl.parent >= 0 && !maps[fl.parent]) throw new FlatError(t('flat.noParent'));
        const g = fl.fold;
        const e = turn(F, g.e);
        const m = turn(F, g.m);
        const o = turn(F, g.o);
        const n = cross(e, m);
        const s = dot(n, o) > 0 ? 1 : -1;
        const strip = (lo: number, hi: number, x0 = g.xa, x1 = g.xb) => rect(x0, lo, x1, hi, 'flat');
        const place = (origin: Vec3): Frame => ({ origin: move(F, origin), xDir: e, yDir: m, normal: n });
        const cut = (tool: ShapeId) => {
          body = keep(kernel.boolean('cut', body, keep(tool)).shape);
        };
        if (g.trim > 0) cut(kernel.extrude(place(g.origin), [strip(g.ylo - 1, g.yhi + 1)], addv([0, 0, 0], n, s * (g.trim + 1)), 0).shape);
        for (const notch of g.notches) cut(kernel.extrude(place(addv(g.mid, g.o, -notch.deep)), [strip(g.ylo - 1, g.yhi + 1, notch.x0, notch.x1)], addv([0, 0, 0], n, s * (notch.deep + 1)), 0).shape);
        const tool = keep(kernel.extrude(place(g.origin), [strip(g.ylo, g.yhi)], addv([0, 0, 0], n, s * (fl.allowance + fl.straight)), 0).shape);
        body = keep(kernel.boolean('fuse', body, tool).shape);
        // the bend line is the middle of the strip of allowance: half of it from the cut, along the inside face
        const c = addv(move(F, g.origin), o, fl.allowance / 2);
        const inner = addv(c, m, g.yhi);
        const at = (p: Vec3): P2 => [dot(sub(p, frame.origin), frame.xDir), dot(sub(p, frame.origin), frame.yDir)];
        const bend = sheet.bends.find((b) => b.feature === fl.feature)!;
        bends.push({ feature: fl.feature, name: bend.name, a: at(addv(inner, e, g.xa)), b: at(addv(inner, e, g.xb)), angle: fl.angle, radius: fl.radius, direction: dot(m, frame.normal) > 0 ? 'up' : 'down', kFactor: sheet.kFactor, allowance: fl.allowance });
        // where this flange's own flat piece is, for the ones that grow from it: the bend undone and moved on by the allowance
        const undo: Rigid = { R: rotation(g.axis, -fl.angle), t: [0, 0, 0] };
        undo.t = addv(sub(g.center, turn(undo, g.center)), g.o, fl.allowance);
        maps[k] = compose(F, undo);
      });
    }
    const topology = kernel.topology(body);
    const mass = kernel.massProps(body);
    // the face the pattern is seen from, and the edges round it
    const top = topology.faces.map((f, i) => ({ f, i })).filter(({ f }) => f.surface === 'plane' && f.normal && dot(f.normal, frame.normal) > 0.999).sort((x, y) => y.f.area - x.f.area)[0];
    if (!top) throw new FlatError(t('flat.noFace'));
    const at = (p: Vec3): P2 => [dot(sub(p, frame.origin), frame.xDir), dot(sub(p, frame.origin), frame.yDir)];
    const outline: FlatSegment[] = [];
    topology.edges.forEach((e) => {
      if (!e.faces.includes(top.i)) return;
      const [v0, v1] = e.vertices.map((i) => topology.vertices[i]!.point);
      if (e.curve === 'line' && v0 && v1) outline.push({ kind: 'line', a: at(v0), b: at(v1) });
      else if (e.curve === 'circle' && e.geometry?.type === 'circle') {
        const c = at(e.geometry.center);
        if (!v0 || !v1 || e.vertices[0] === e.vertices[1]) outline.push({ kind: 'circle', c, r: e.geometry.radius });
        else outline.push({ kind: 'arc', c, r: e.geometry.radius, from: at(v0), to: at(v1), mid: at(e.mid) });
      }
    });
    // the sizes: the corners of the lines, and the arcs sampled round their middle
    const pts: P2[] = [];
    for (const s of outline) {
      if (s.kind === 'line') pts.push(s.a, s.b);
      else if (s.kind === 'arc') {
        const ang = (p: P2) => Math.atan2(p[1] - s.c[1], p[0] - s.c[0]);
        const [a0, am, a1] = [ang(s.from), ang(s.mid), ang(s.to)];
        const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const ccw = norm(am - a0) < norm(a1 - a0);
        const sweep = ccw ? norm(a1 - a0) : -norm(a0 - a1);
        for (let i = 0; i <= 32; i++) pts.push([s.c[0] + s.r * Math.cos(a0 + (sweep * i) / 32), s.c[1] + s.r * Math.sin(a0 + (sweep * i) / 32)]);
      }
    }
    const min: P2 = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))];
    const max: P2 = [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
    owned.splice(owned.indexOf(body), 1);
    return { shape: body, frame, thickness: T, outline, bends, min, max, width: max[0] - min[0], height: max[1] - min[1], area: top.f.area, volume: mass.volume };
  } finally {
    for (const id of owned) kernel.release(id);
  }
}
