import { t } from '@3db/i18n';
import type { Frame, Kernel, Region, ShapeId } from '@3db/kernel';
import type { Id } from '@3db/model';
import type { SheetInfo } from './engine';
import { obroundRegion } from './relief';

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

/** What a feature after the sheet's own took away that the flat pattern could not put back, and why: `bend` (it is in a bend), `straddles` (across more than one part of the sheet), `bentBase` (the base is a bent sheet), `unplaced` (put back, it took nothing from the pattern). */
export interface FlatNotIncluded {
  feature: Id;
  why: 'bend' | 'straddles' | 'bentBase' | 'unplaced';
}

export interface FlatPattern {
  /** The cuts of the features after the sheet's own that are not in the pattern. */
  notIncluded: FlatNotIncluded[];
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

/**
 * Where the mitre plane ends the unrolled flange (斜接) at the distance `v` from the cut, along the edge: the plane is the vertical one between the outer faces of the two flanges (moved
 * `s` for the gap), and where it crosses the bend, which has turned `v` / (radius + K·T) of the way, is `(radius + K·T)·sin` of that from the start of the bend, then constant (the flat
 * piece is the straight wall). At the start the same mirrored.
 */
function mitreX(fl: SheetInfo['flanges'][number], mt: NonNullable<SheetInfo['flanges'][number]['miter'][0]>, end: 0 | 1, v: number): number {
  const Rn = fl.allowance / fl.angle; // radius + K·T
  const wave = v <= fl.allowance ? Rn * Math.sin(v / Rn) : Rn * Math.sin(fl.angle);
  return end === 1 ? mt.xOuter - fl.trim + wave - mt.s : mt.xOuter + fl.trim - wave + mt.s;
}

/** The region of the unrolled flange beyond the curve of a mitre (the part to cut away), in the coordinates along the edge (x) and away from the cut (v). */
function mitreCutter(fl: SheetInfo['flanges'][number], mt: NonNullable<SheetInfo['flanges'][number]['miter'][0]>, end: 0 | 1, vmax: number): Region {
  const N = 24;
  const curve: P2[] = [];
  for (let i = 0; i <= N; i++) {
    const v = (fl.allowance * i) / N;
    curve.push([mitreX(fl, mt, end, v), v]);
  }
  const wall: P2 = [mitreX(fl, mt, end, fl.allowance + 1), vmax];
  const far = end === 1 ? Math.max(...curve.map((p) => p[0]), wall[0]) + 10 : Math.min(...curve.map((p) => p[0]), wall[0]) - 10;
  // counter-clockwise: up the side that is away from the flange, along the top, down the curve, back along the cut (not below it: that is the sheet the flange grows from)
  const pts: P2[] = end === 1 ? [[far, 0], [far, vmax], wall, ...curve.slice().reverse()] : [[far, 0], ...curve, wall, [far, vmax]];
  return { outer: pts.map((p, i) => line(p, pts[(i + 1) % pts.length]!, `mitre${end}.p${i}`)), holes: [] };
}

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
    const notIncluded: FlatNotIncluded[] = [];
    /** The flanges, in the order they were made, grown on the flat base: `hostMap` is the motion of the piece of the base a flange of the base is on. */
    const maps: Rigid[] = [];
    const grow = (hostMap: (host: number) => Rigid): void => {
      sheet.flanges.forEach((fl, k) => {
        const F = fl.parent < 0 ? hostMap(fl.host) : maps[fl.parent]!;
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
        for (const notch of g.notches) {
          if (notch.shape === 'obround') {
            // its profile lies in the plane of the sheet (along the edge, into the sheet) and is cut through the thickness
            const into: Vec3 = [-o[0], -o[1], -o[2]];
            const frameO: Frame = { origin: move(F, addv(g.mid, m, g.ylo - 1)), xDir: e, yDir: into, normal: cross(e, into) };
            cut(kernel.extrude(frameO, [obroundRegion(notch, 'flat')], addv([0, 0, 0], m, g.yhi - g.ylo + 2), 0).shape);
          } else cut(kernel.extrude(place(addv(g.mid, g.o, -notch.deep)), [strip(g.ylo - 1, g.yhi + 1, notch.x0, notch.x1)], addv([0, 0, 0], n, s * (notch.deep + 1)), 0).shape);
        }
        // the bend (as wide as the flange), then the flat piece (wider at an end where the corner is closed); at a mitred end both run on to the outer face of the neighbour and are cut
        // back to the curve the mitre plane makes on the unrolled sheet
        const [mA, mB] = fl.miter;
        const lo = mA ? Math.min(g.xa, mA.xOuter) : g.xa;
        const hi = mB ? Math.max(g.xb, mB.xOuter) : g.xb;
        // (each tool is cut on its own, before it is joined: what is beyond the curve is cut away from this flange only, never from the one next to it, which is cut to its own curve)
        const cutTool = (tool: ShapeId): ShapeId => {
          let cur = tool;
          for (const [end, mt] of [[0, mA], [1, mB]] as const) {
            if (!mt) continue;
            const frameC: Frame = { origin: addv(move(F, g.origin), m, g.ylo - 1), xDir: e, yDir: o, normal: cross(e, o) };
            const cutter = keep(kernel.extrude(frameC, [mitreCutter(fl, mt, end, fl.allowance + fl.straight + 1)], addv([0, 0, 0], m, g.yhi - g.ylo + 2), 0).shape);
            cur = keep(kernel.boolean('cut', cur, cutter).shape);
          }
          return cur;
        };
        const bendTool = cutTool(keep(kernel.extrude(place(g.origin), [strip(g.ylo, g.yhi, lo, hi)], addv([0, 0, 0], n, s * fl.allowance), 0).shape));
        body = keep(kernel.boolean('fuse', body, bendTool).shape);
        const flatFrame = place(addv(g.origin, g.o, fl.allowance));
        const pieceTool = cutTool(keep(kernel.extrude(flatFrame, [strip(g.ylo, g.yhi, mA ? lo : g.pa, mB ? hi : g.pb)], addv([0, 0, 0], n, s * fl.straight), 0).shape));
        body = keep(kernel.boolean('fuse', body, pieceTool).shape);
        // the bend line is the middle of the strip of allowance: half of it from the cut, along the inside face (it ends on the curve at a mitred end)
        const c = addv(move(F, g.origin), o, fl.allowance / 2);
        const inner = addv(c, m, g.yhi);
        const at = (p: Vec3): P2 => [dot(sub(p, frame.origin), frame.xDir), dot(sub(p, frame.origin), frame.yDir)];
        const bend = sheet.bends.find((b) => b.feature === fl.feature)!;
        const xs = mA ? mitreX(fl, mA, 0, fl.allowance / 2) : g.xa;
        const xe = mB ? mitreX(fl, mB, 1, fl.allowance / 2) : g.xb;
        bends.push({ feature: fl.feature, name: bend.name, a: at(addv(inner, e, xs)), b: at(addv(inner, e, xe)), angle: fl.angle, radius: fl.radius, direction: dot(m, frame.normal) > 0 ? 'up' : 'down', kFactor: sheet.kFactor, allowance: fl.allowance });
        // where this flange's own flat piece is, for the ones that grow from it: the bend undone and moved on by the allowance
        const undo: Rigid = { R: rotation(g.axis, -fl.angle), t: [0, 0, 0] };
        undo.t = addv(sub(g.center, turn(undo, g.center)), g.o, fl.allowance);
        maps[k] = compose(F, undo);
      });
    };
    if (base.kind === 'bent') {
      for (const c of sheet.cuts) notIncluded.push({ feature: c.feature, why: 'bentBase' });
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
      // the flanges grown on the sheet: each straight piece of the path has its own motion into the flat strip (the path along the strip, the width across it, the thickness up from it)
      const at3 = (q: P2): Vec3 => addv(addv(frame.origin, frame.xDir, q[0]), frame.yDir, q[1]);
      const hostMaps: Rigid[] = base.straights.map((sg) => {
        const A = at3(sg.a);
        const D = sub(at3(sg.b), A);
        const len = Math.hypot(...D);
        const d: Vec3 = [D[0] / len, D[1] / len, D[2] / len];
        const left = cross(frame.normal, d);
        const ns: Vec3 = base.side === 'left' ? left : [-left[0], -left[1], -left[2]];
        const w = base.dir;
        // the thickness goes up from the flat strip when the three directions are right-handed; when they are not, the sheet is turned over (the path face is the upper one)
        const sg3 = dot(cross(d, w), ns) > 0 ? 1 : -1;
        const R = [0, 0, 0, 0, 0, 0, 0, 0, 0] as Rigid['R'];
        for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) R[3 * i + j] = frame.xDir[i]! * d[j]! + frame.yDir[i]! * w[j]! + sg3 * frame.normal[i]! * ns[j]!;
        const probe: Rigid = { R, t: [0, 0, 0] };
        const start = addv(addv(frame.origin, frame.xDir, sg.at), frame.normal, sg3 > 0 ? 0 : T);
        return { R, t: sub(start, turn(probe, A)) };
      });
      grow((h) => {
        const m = hostMaps[h];
        if (!m) throw new FlatError(t('flat.noParent'));
        return m;
      });
    } else {
      frame = base.frame;
      body = keep(kernel.extrude(frame, base.regions, addv([0, 0, 0], base.dir, T)).shape);
      grow(() => IDENTITY);
      // the mid bend of a plate: the plate is as it was drawn (the zone of the bend is as wide as the allowance), the bend line is the line of the zone
      const planar = (p: Vec3): P2 => [dot(sub(p, frame.origin), frame.xDir), dot(sub(p, frame.origin), frame.yDir)];
      for (const mb of sheet.midBends) {
        const b = sheet.bends.find((x) => x.feature === mb.feature)!;
        bends.push({ feature: mb.feature, name: b.name, a: planar(mb.a), b: planar(mb.b), angle: mb.angle, radius: mb.radius, direction: dot(mb.up, frame.normal) > 0 ? 'up' : 'down', kFactor: sheet.kFactor, allowance: mb.allowance });
      }
      // what the features after the sheet's own took away (holes, notches), put back where the sheet was before it was bent: each piece goes through the motion of the part of the sheet it is in
      const tol = 1e-4;
      const mid = sheet.midBends[0];
      const back: Rigid | null = mid ? (() => {
        const R = rotation(mid.axis, -mid.angle);
        const probe: Rigid = { R, t: [0, 0, 0] };
        return { R, t: sub(sub(mid.center, mid.slide), turn(probe, mid.center)) };
      })() : null;
      const placeOf = (p: Vec3): Rigid | 'bend' => {
        for (let k = sheet.flanges.length - 1; k >= 0; k--) {
          const fl = sheet.flanges[k]!;
          const g = fl.fold;
          const rel = sub(p, g.origin2);
          const [u, v, w] = [dot(rel, g.e), dot(rel, g.d), dot(rel, g.m2)];
          const lo = fl.miter[0] ? Math.min(g.xa, fl.miter[0].xOuter) : g.pa;
          const hi = fl.miter[1] ? Math.max(g.xb, fl.miter[1].xOuter) : g.pb;
          if (u >= lo - tol && u <= hi + tol && v >= -tol && v <= fl.straight + tol && w >= g.ylo - tol && w <= g.yhi + tol) return maps[k]!;
          // the bend of this flange: between the inside and the outside radius, within the angle it turns, along the strip
          const c = sub(p, g.center);
          const along = dot(c, g.axis);
          const radial = sub(c, [g.axis[0] * along, g.axis[1] * along, g.axis[2] * along]);
          const r = Math.hypot(...radial);
          const s0 = sub(g.origin, g.center);
          const s0n = Math.hypot(...s0);
          const phi = r > 0 && s0n > 0 ? Math.atan2(dot(cross(s0, radial), g.axis) / (s0n * r), dot(s0, radial) / (s0n * r)) : 0;
          const ub = dot(sub(p, g.origin), g.e);
          if (r >= fl.radius - tol && r <= fl.radius + T + tol && phi >= -1e-3 && phi <= fl.angle + 1e-3 && ub >= lo - tol && ub <= hi + tol) return 'bend';
        }
        if (mid) {
          if (dot(sub(p, mid.q), mid.side) < -mid.allowance / 2 + tol) return IDENTITY;
          if (dot(sub(move(back!, p), mid.q), mid.side) > mid.allowance / 2 - tol) return back!;
          return 'bend';
        }
        return IDENTITY;
      };
      for (const cut of sheet.cuts) {
        const whole = kernel.topology(cut.shape);
        const pieces = kernel.splitSolids({ shape: cut.shape, faceOrigins: whole.faces.map(() => []) });
        try {
          for (const piece of pieces) {
            const points = [...kernel.topology(piece.shape).vertices.map((v) => v.point), kernel.massProps(piece.shape).center];
            const places = points.map(placeOf);
            if (places.includes('bend')) {
              notIncluded.push({ feature: cut.feature, why: 'bend' });
              continue;
            }
            const rigid = places[0] as Rigid;
            if (places.some((x) => x !== rigid)) {
              notIncluded.push({ feature: cut.feature, why: 'straddles' });
              continue;
            }
            const moved = keep(kernel.transformed(piece.shape, [rigid.R[0], rigid.R[1], rigid.R[2], rigid.t[0], rigid.R[3], rigid.R[4], rigid.R[5], rigid.t[1], rigid.R[6], rigid.R[7], rigid.R[8], rigid.t[2]]));
            const before = kernel.massProps(body).volume;
            const next = keep(kernel.boolean('cut', body, moved).shape);
            if (Math.abs(before - kernel.massProps(next).volume - kernel.massProps(moved).volume) > 1e-3 * kernel.massProps(moved).volume + 1e-6) {
              notIncluded.push({ feature: cut.feature, why: 'unplaced' });
              continue;
            }
            body = next;
          }
        } finally {
          for (const piece of pieces) kernel.release(piece.shape);
        }
      }
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
    return { shape: body, frame, thickness: T, outline, bends, notIncluded, min, max, width: max[0] - min[0], height: max[1] - min[1], area: top.f.area, volume: mass.volume };
  } finally {
    for (const id of owned) kernel.release(id);
  }
}
