/**
 * Interaction geometry for sketching (C1.25, C1.26, C1.28, A5.1 in 2D): hit testing, snapping,
 * inference, smart dimensions, applicable relations and dimension layout. Pure TypeScript with no
 * solver, so the UI thread can use it; everything works on solved (derived) geometry.
 */
import { SKETCH_AXIS_H, SKETCH_AXIS_V, SKETCH_ORIGIN, constraintRefs, entityPoints, isSketchAxis, sketchAxisDir, type DimensionConstraint, type Id, type SketchConstraint, type SketchFeature } from '@3db/model';
import { textContours } from './font';
import type { ModelItem } from './ops';
import type { P2, SolvedGeometry } from './types';

export type Geometry = ReadonlyMap<Id, SolvedGeometry>;

/** Exact polynomial Bezier evaluation, shared by display, profile area and tests. */
export function bezierPoint(points:readonly P2[],t:number):P2 {
  const work=points.map(p=>[...p] as P2);for(let n=work.length-1;n>0;n--)for(let i=0;i<n;i++)work[i]=[work[i]![0]*(1-t)+work[i+1]![0]*t,work[i]![1]*(1-t)+work[i+1]![1]*t];return work[0]??[0,0];
}

// ---------------------------------------------------------------- 2D math

export const add = (a: P2, b: P2): P2 => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
export const scale = (a: P2, s: number): P2 => [a[0] * s, a[1] * s];
export const dot = (a: P2, b: P2) => a[0] * b[0] + a[1] * b[1];
export const cross = (a: P2, b: P2) => a[0] * b[1] - a[1] * b[0];
export const len = (a: P2) => Math.hypot(a[0], a[1]);
export const dist = (a: P2, b: P2) => len(sub(a, b));
export const mid = (a: P2, b: P2): P2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
export const unit = (a: P2): P2 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};
/** Rotates 90° counter-clockwise. */
export const perp = (a: P2): P2 => [-a[1], a[0]];
export const polar = (c: P2, r: number, angle: number): P2 => [c[0] + r * Math.cos(angle), c[1] + r * Math.sin(angle)];

const TAU = Math.PI * 2;
const norm = (a: number) => ((a % TAU) + TAU) % TAU;

/** Whether `angle` lies on the counter-clockwise sweep from a0 to a1. */
export function onSweep(a0: number, a1: number, angle: number): boolean {
  return norm(angle - a0) <= norm(a1 - a0) + 1e-12;
}

export function closestOnSegment(p: P2, a: P2, b: P2): P2 {
  const d = sub(b, a);
  const l2 = dot(d, d);
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), d) / l2));
  return add(a, scale(d, t));
}

/**
 * One of the sketch's two axes (ADR 0170) as a solved line: from the origin one unit along it. It is not in the solved geometry (nothing iterating that
 * should draw it, box-select it or make a profile of it); what looks an id up asks `geometryOf` instead.
 */
export function axisGeometry(id: Id): Extract<SolvedGeometry, { type: 'line' }> | undefined {
  const d = sketchAxisDir(id);
  return d && { type: 'line', a: [0, 0], b: d, p1: SKETCH_ORIGIN, p2: `${id}.end`, construction: true };
}

/** The solved geometry of `id`, or of a sketch axis. */
export function geometryOf(geometry: Geometry, id: Id): SolvedGeometry | undefined {
  return geometry.get(id) ?? axisGeometry(id);
}

export function pointOf(geometry: Geometry, id: Id): P2 | undefined {
  if (id === SKETCH_ORIGIN) return [0, 0];
  const g = geometry.get(id);
  return g?.type === 'point' ? g.p : undefined;
}

/** Closest point on a curve (null for points). */
export function closestOn(g: SolvedGeometry, p: P2): P2 | null {
  switch (g.type) {
    case 'point':
      return null;
    case 'line':
      return closestOnSegment(p, g.a, g.b);
    case 'circle':
      return polar(g.c, g.r, Math.atan2(p[1] - g.c[1], p[0] - g.c[0]));
    case 'arc': {
      const angle = Math.atan2(p[1] - g.c[1], p[0] - g.c[0]);
      if (onSweep(g.a0, g.a1, angle)) return polar(g.c, g.r, angle);
      const s = polar(g.c, g.r, g.a0);
      const e = polar(g.c, g.r, g.a1);
      return dist(p, s) < dist(p, e) ? s : e;
    }
    case 'ellipse': {
      const cosA = Math.cos(g.angle);
      const sinA = Math.sin(g.angle);
      const dx = p[0] - g.c[0];
      const dy = p[1] - g.c[1];
      const lx = dx * cosA + dy * sinA;
      const ly = -dx * sinA + dy * cosA;
      const t = Math.atan2(ly * g.majorRadius, lx * g.minorRadius);
      const ex = g.majorRadius * Math.cos(t);
      const ey = g.minorRadius * Math.sin(t);
      return [g.c[0] + ex * cosA - ey * sinA, g.c[1] + ex * sinA + ey * cosA];
    }
    case 'spline':
    case 'text': {
      const pts = sample(g, 1);
      let best: P2 | null = null;
      let bestDist = Infinity;
      for (let i = 0; i < pts.length - 1; i++) {
        const q = closestOnSegment(p, pts[i]!, pts[i + 1]!);
        const d = dist(p, q);
        if (d < bestDist) {
          bestDist = d;
          best = q;
        }
      }
      return best ?? pts[0] ?? null;
    }
  }
}

/** Polyline for drawing a curve; `px` is the size of one screen pixel in sketch units. */
export function sample(g: SolvedGeometry, px: number): P2[] {
  switch (g.type) {
    case 'point':
      return [g.p];
    case 'line':
      return [g.a, g.b];
    case 'circle':
    case 'arc': {
      const sweep = g.type === 'circle' ? TAU : norm(g.a1 - g.a0) || TAU;
      const a0 = g.type === 'circle' ? 0 : g.a0;
      // chord error ≈ r(1 − cos(θ/2)) kept below ~0.3 px
      const step = Math.max(0.02, Math.min(0.5, 2 * Math.acos(Math.max(-1, 1 - (0.3 * px) / Math.max(g.r, 1e-9)))));
      const n = Math.max(8, Math.ceil(sweep / step));
      return Array.from({ length: n + 1 }, (_, i) => polar(g.c, g.r, a0 + (sweep * i) / n));
    }
    case 'ellipse': {
      const n = 64;
      const cosA = Math.cos(g.angle);
      const sinA = Math.sin(g.angle);
      return Array.from({ length: n + 1 }, (_, i) => {
        const theta = (TAU * (i % n)) / n;
        const u = g.majorRadius * Math.cos(theta);
        const v = g.minorRadius * Math.sin(theta);
        return [g.c[0] + u * cosA - v * sinA, g.c[1] + u * sinA + v * cosA];
      });
    }
    case 'spline': {
      if(g.bezier)return Array.from({length:65},(_,i)=>bezierPoint(g.points,i/64));
      const n = g.points.length;
      if (n < 2) return g.points;
      const getP = (idx: number): P2 => {
        if (g.closed) return g.points[((idx % n) + n) % n]!;
        if (idx < 0) {
          const p0 = g.points[0]!;
          const p1 = g.points[1]!;
          return [2 * p0[0] - p1[0], 2 * p0[1] - p1[1]];
        }
        if (idx >= n) {
          const pn1 = g.points[n - 1]!;
          const pn2 = g.points[n - 2]!;
          return [2 * pn1[0] - pn2[0], 2 * pn1[1] - pn2[1]];
        }
        return g.points[idx]!;
      };
      const out: P2[] = [];
      const segments = g.closed ? n : n - 1;
      const steps = 16;
      for (let s = 0; s < segments; s++) {
        const p0 = getP(s - 1);
        const p1 = getP(s);
        const p2 = getP(s + 1);
        const p3 = getP(s + 2);
        for (let i = 0; i < steps; i++) {
          const t = i / steps;
          const t2 = t * t;
          const t3 = t2 * t;
          const x = 0.5 * (
            2 * p1[0] +
            (-p0[0] + p2[0]) * t +
            (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
            (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3
          );
          const y = 0.5 * (
            2 * p1[1] +
            (-p0[1] + p2[1]) * t +
            (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
            (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3
          );
          out.push([x, y]);
        }
      }
      if (g.closed) out.push(out[0]!);
      else out.push(g.points[n - 1]!);
      return out;
    }
    case 'text': {
      const loops = textContours(g.text, {
        size: g.size,
        at: g.at,
        angle: g.angle,
        align: g.align,
        bold: g.bold,
        italic: g.italic,
        source: '',
      });
      const out: P2[] = [];
      for (const loop of loops) {
        for (const s of loop) {
          if (s.kind === 'line') out.push(s.a);
        }
      }
      return out;
    }
  }
}

// ---------------------------------------------------------------- hit testing (A5.1)

export type HitKind = 'origin' | SolvedGeometry['type'];

export interface Hit {
  id: Id;
  kind: HitKind;
  /** The closest point on the hit element. */
  q: P2;
  d: number;
}

/**
 * What is under the cursor within `tol`: points (and the origin) win over curves, like SolidWorks. The sketch's axes (ADR 0170) only with `axes`: where
 * the user picks a reference (select, smart dimension, a mirror line), never in the snaps of drawing, where an infinite line along x = 0 or y = 0 would
 * take the place of the model's edges there and of horizontal and vertical.
 */
export function hitCandidates(geometry: Geometry, p: P2, tol: number, exclude: ReadonlySet<Id> = new Set(), axes = false): Hit[] {
  const hits: Hit[] = [];
  let hasCurve = false;
  const consider = (h: Hit) => {
    if (h.d > tol) return;
    hits.push(h);
    if (h.kind !== 'point' && h.kind !== 'origin') hasCurve = true;
  };
  for (const [id, g] of geometry) {
    if (exclude.has(id)) continue;
    if (g.type === 'point') consider({ id, kind: 'point', q: g.p, d: dist(p, g.p) });
    else {
      const q = closestOn(g, p)!;
      consider({ id, kind: g.type, q, d: dist(p, q) });
    }
  }
  // Last, so a sketch point lying on the origin wins the tie: merging with it beats a new relation.
  if (!exclude.has(SKETCH_ORIGIN)) consider({ id: SKETCH_ORIGIN, kind: 'origin', q: [0, 0], d: len(p) });
  // the axes (ADR 0170), infinite, only where no curve of the sketch is: what the user drew comes first
  if (axes && !hasCurve) {
    for (const id of [SKETCH_AXIS_H, SKETCH_AXIS_V]) {
      if (exclude.has(id)) continue;
      const d = sketchAxisDir(id)!;
      const q = scale(d, dot(p, d));
      consider({ id, kind: 'line', q, d: dist(p, q) });
    }
  }
  const rank = (h: Hit) => h.kind === 'point' || h.kind === 'origin' ? 0 : 1;
  return hits.sort((a, b) => rank(a) - rank(b) || a.d - b.d);
}

/** Default selection keeps the established point-first order; callers may expose all candidates. */
export function hitTest(geometry: Geometry, p: P2, tol: number, exclude: ReadonlySet<Id> = new Set(), axes = false): Hit | null {
  return hitCandidates(geometry, p, tol, exclude, axes)[0] ?? null;
}

/** Entities whose drawing lies completely inside a box (window selection, D5.1). */
export function inBox(geometry: Geometry, lo: P2, hi: P2): Id[] {
  const inside = (p: P2) => p[0] >= lo[0] && p[0] <= hi[0] && p[1] >= lo[1] && p[1] <= hi[1];
  const out: Id[] = [];
  for (const [id, g] of geometry) {
    const pts = g.type === 'point' ? [g.p] : g.type === 'line' ? [g.a, g.b] : sample(g, (hi[0] - lo[0]) / 200);
    if (pts.every(inside)) out.push(id);
  }
  return out;
}

// ---------------------------------------------------------------- snapping and inference (C1.25, D5.3)

/** A sketch point (or the origin) the cursor lines up with: `p` is where it is. */
export interface AlignTarget {
  id: Id;
  p: P2;
}

/** The points a free point was pulled into line with: `h` has the same y (horizontal), `v` the same x (vertical). */
export interface Alignment {
  h?: AlignTarget;
  v?: AlignTarget;
}

export type Snap =
  /** An existing sketch point or the origin: the new point merges with it. */
  | { kind: 'point'; id: Id; p: P2 }
  | { kind: 'midpoint'; line: Id; p: P2 }
  /** On a line, circle or arc: the new point gets a coincident (point-on-curve) relation. */
  | { kind: 'curve'; id: Id; p: P2 }
  /** Where two curves cross (交點): the new point gets an intersection relation with both. */
  | { kind: 'intersection'; p: P2; a: Id; b: Id }
  /** A quarter point of a circle or arc (四分之一點): on the curve, and level or plumb with its center. */
  | { kind: 'quadrant'; p: P2; curve: Id; center: Id; axis: 'horizontal' | 'vertical' }
  /** On the extension of a line past `from`, one of its ends (延長線): the new point is on the line (a line is infinite to the solver). */
  | { kind: 'extension'; p: P2; line: Id; from: P2 }
  /** A place on the model (D5.3b): the sketch gets the edge as a reference entity that follows it (or, `part` 'pierce', a point where it passes through the plane), and the new point goes with it. */
  | { kind: 'model'; p: P2; item: ModelItem; part: ModelPart }
  /** Nowhere in particular, or (`align`) in line with other points: the new point gets a horizontal / vertical relation to each. */
  | { kind: 'free'; p: P2; align?: Alignment };

/** Which place of a model edge: an end, the center of a circle or arc, the middle of a line, anywhere along it, or where it passes through the plane. */
export type ModelPart = 'start' | 'end' | 'center' | 'mid' | 'curve' | 'pierce' | 'vertex';

/**
 * The place on the model the cursor is near, the nearest within each step, in this order: the ends, centers and middles of the edges in the sketch plane;
 * those of the edges projected onto it from outside, and where edges pass through it (C1 2026-10-14); anywhere along an edge in the plane; anywhere along
 * a projected one. What is in the plane comes first because it is what the sketch is drawn on.
 */
export function snapModel(items: readonly ModelItem[], p: P2, tol: number, pointsOnly = false): Extract<Snap, { kind: 'model' }> | null {
  const inPlane = (item: ModelItem) => 'projected' in item && item.off === undefined;
  const points = (pick: (item: ModelItem) => boolean) => {
    let best: { s: Extract<Snap, { kind: 'model' }>; d: number } | null = null;
    const consider = (item: ModelItem, part: ModelPart, at: P2) => {
      const d = dist(p, at);
      if (d <= tol && (!best || d < best.d)) best = { s: { kind: 'model', p: at, item, part }, d };
    };
    for (const item of items) {
      if (!pick(item)) continue;
      if ('pierce' in item) {
        consider(item, 'pierce', item.pierce);
        continue;
      }
      if ('vertex' in item) {
        consider(item, 'vertex', item.vertex);
        continue;
      }
      const q = item.projected;
      if (q.kind === 'line') {
        consider(item, 'start', q.a);
        consider(item, 'end', q.b);
        consider(item, 'mid', mid(q.a, q.b));
      } else if (q.kind === 'circle') {
        consider(item, 'center', q.c);
      } else if (q.kind === 'arc') {
        consider(item, 'center', q.c);
        consider(item, 'start', q.start);
        consider(item, 'end', q.end);
      } else if (q.kind === 'spline') {
        q.points.forEach((pt, idx) => {
          if (idx === 0) consider(item, 'start', pt);
          else if (idx === q.points.length - 1) consider(item, 'end', pt);
          else consider(item, 'curve', pt);
        });
      }
    }
    return best && (best as { s: Extract<Snap, { kind: 'model' }> }).s;
  };
  const along = (pick: (item: ModelItem) => boolean) => {
    let best: { s: Extract<Snap, { kind: 'model' }>; d: number } | null = null;
    for (const item of items) {
      if (!pick(item) || !('projected' in item)) continue;
      const q = item.projected;
      const at =
        q.kind === 'line'
          ? closestOnSegment(p, q.a, q.b)
          : q.kind === 'circle'
            ? closestOn({ type: 'circle', c: q.c, r: q.r, center: '', construction: false }, p)
            : q.kind === 'arc'
              ? closestOn({ type: 'arc', c: q.c, r: q.r, a0: Math.atan2(q.start[1] - q.c[1], q.start[0] - q.c[0]), a1: Math.atan2(q.end[1] - q.c[1], q.end[0] - q.c[0]), center: '', start: '', end: '', construction: false }, p)
              : q.points[0];
      const d = at ? dist(p, at) : Infinity;
      if (at && d <= tol && (!best || d < best.d)) best = { s: { kind: 'model', p: at, item, part: 'curve' }, d };
    }
    return best && (best as { s: Extract<Snap, { kind: 'model' }> }).s;
  };
  const outside = (item: ModelItem) => !inPlane(item);
  return points(inPlane) ?? points(outside) ?? (pointsOnly ? null : (along(inPlane) ?? along(outside)));
}

/** Which of the three plain snaps `snap` may make (all, unless the settings leave some out). */
export interface SnapAllow {
  point?: boolean;
  midpoint?: boolean;
  curve?: boolean;
}

/** The middle of an arc's sweep (it runs counterclockwise from a0 to a1). */
export function arcMidpoint(g: Extract<SolvedGeometry, { type: 'arc' }>): P2 {
  const tau = 2 * Math.PI;
  const sweep = (((g.a1 - g.a0) % tau) + tau) % tau;
  return polar(g.c, g.r, g.a0 + sweep / 2);
}

/** SolidWorks snap priority: end/center points, then midpoints, then anywhere on a curve. */
export function snap(geometry: Geometry, p: P2, tol: number, exclude: ReadonlySet<Id> = new Set(), allow: SnapAllow = {}): Snap {
  const [byPoint, byMidpoint, byCurve] = [allow.point !== false, allow.midpoint !== false, allow.curve !== false];
  // without the points, what is under the cursor is a curve (a point on it is not a place to snap to then)
  const hit = hitTest(byPoint ? geometry : new Map([...geometry].filter(([, g]) => g.type !== 'point')), p, tol, exclude);
  if (byPoint && hit && (hit.kind === 'point' || hit.kind === 'origin')) return { kind: 'point', id: hit.id, p: hit.q };
  let best: { line: Id; p: P2; d: number } | null = null;
  for (const [id, g] of byMidpoint ? geometry : []) {
    if ((g.type !== 'line' && g.type !== 'arc') || exclude.has(id)) continue;
    const m = g.type === 'line' ? mid(g.a, g.b) : arcMidpoint(g); // SolidWorks and FreeCAD snap to the middle of an arc too
    const d = dist(p, m);
    if (d <= tol && (!best || d < best.d)) best = { line: id, p: m, d };
  }
  if (best) return { kind: 'midpoint', line: best.line, p: best.p };
  if (byCurve && hit && hit.kind !== 'point' && hit.kind !== 'origin') return { kind: 'curve', id: hit.id, p: hit.q };
  return { kind: 'free', p };
}

/**
 * Horizontal / vertical points (D5.3a, SolidWorks 「水平點」「垂直點」): the sketch points (and the origin) the cursor is
 * within `tol` of in x or in y. Each axis takes the nearest one; `axes` limits which are looked for (a line already
 * inferred horizontal keeps its y). The returned point has the matching coordinates put on the targets', so lined up
 * with both it lands exactly on the crossing.
 */
export function alignments(geometry: Geometry, p: P2, tol: number, exclude: ReadonlySet<Id> = new Set(), axes: { h: boolean; v: boolean } = { h: true, v: true }): { p: P2; align: Alignment } | null {
  let h: AlignTarget | undefined;
  let v: AlignTarget | undefined;
  const consider = (id: Id, q: P2) => {
    if (axes.h && Math.abs(q[1] - p[1]) <= tol && (!h || Math.abs(q[1] - p[1]) < Math.abs(h.p[1] - p[1]))) h = { id, p: q };
    if (axes.v && Math.abs(q[0] - p[0]) <= tol && (!v || Math.abs(q[0] - p[0]) < Math.abs(v.p[0] - p[0]))) v = { id, p: q };
  };
  for (const [id, g] of geometry) if (g.type === 'point' && !exclude.has(id)) consider(id, g.p);
  if (!exclude.has(SKETCH_ORIGIN)) consider(SKETCH_ORIGIN, [0, 0]);
  if (!h && !v) return null;
  return { p: [v ? v.p[0] : p[0], h ? h.p[1] : p[1]], align: { ...(h ? { h } : {}), ...(v ? { v } : {}) } };
}

export type LineInferenceKind = 'collinear' | 'parallel' | 'perpendicular';

export interface LineInference {
  kind: LineInferenceKind;
  /** The existing line the new one is made collinear / parallel / perpendicular to. */
  line: Id;
  /** The end of the new line moved onto the inferred direction. */
  b: P2;
}

/**
 * Collinear, parallel and perpendicular inference for a line from `a` toward `b` (D5.3a, SolidWorks 「推斷」): within
 * `angleTol` of an existing line's direction (or of the direction turned a quarter) the end is moved onto it; when the
 * start also lies on that line (within `distTol`) it is collinear, not just parallel. The smallest angle wins and
 * collinear beats parallel at equal angles. A line too short to have a direction (< `minLength`) infers nothing.
 */
export function inferLine(
  geometry: Geometry,
  a: P2,
  b: P2,
  exclude: ReadonlySet<Id> = new Set(),
  angleTol = (3 * Math.PI) / 180,
  distTol = 0,
  minLength = 0,
): LineInference | null {
  const ab = sub(b, a);
  const length = len(ab);
  if (length === 0 || length < minLength) return null;
  const v = scale(ab, 1 / length);
  const sinTol = Math.sin(angleTol);
  let best: (LineInference & { err: number; rank: number }) | null = null;
  for (const [id, g] of geometry) {
    if (g.type !== 'line' || exclude.has(id) || dist(g.a, g.b) === 0) continue;
    const u = unit(sub(g.b, g.a));
    const along = dot(v, u);
    const across = cross(v, u);
    const onLine = Math.abs(cross(u, sub(a, g.a))) <= distTol;
    let candidate: (LineInference & { err: number; rank: number }) | null = null;
    if (Math.abs(across) <= sinTol && Math.abs(along) > 0.5) {
      candidate = { kind: onLine ? 'collinear' : 'parallel', line: id, b: add(a, scale(u, dot(ab, u))), err: Math.abs(across), rank: onLine ? 0 : 1 };
    } else if (Math.abs(along) <= sinTol && Math.abs(across) > 0.5) {
      const n = perp(u);
      candidate = { kind: 'perpendicular', line: id, b: add(a, scale(n, dot(ab, n))), err: Math.abs(along), rank: 1 };
    }
    if (candidate && (!best || candidate.err < best.err - 1e-12 || (Math.abs(candidate.err - best.err) <= 1e-12 && candidate.rank < best.rank))) best = candidate;
  }
  return best && { kind: best.kind, line: best.line, b: best.b };
}

export type Direction = 'horizontal' | 'vertical';

/**
 * Horizontal/vertical inference for a line from `a` toward `b` (C1.25): within `angleTol` the end
 * snaps onto the exact direction and the relation is suggested.
 */
export function inferDirection(a: P2, b: P2, angleTol = (3 * Math.PI) / 180): { b: P2; direction: Direction | null } {
  const d = sub(b, a);
  if (len(d) === 0) return { b, direction: null };
  const t = Math.tan(angleTol);
  if (Math.abs(d[1]) <= t * Math.abs(d[0])) return { b: [b[0], a[1]], direction: 'horizontal' };
  if (Math.abs(d[0]) <= t * Math.abs(d[1])) return { b: [a[0], b[1]], direction: 'vertical' };
  return { b, direction: null };
}

// ---------------------------------------------------------------- arcs from picks

/** Circle through three points, or null when they are (nearly) collinear. */
export function circleThrough(p1: P2, p2: P2, p3: P2): { c: P2; r: number } | null {
  const d = 2 * (p1[0] * (p2[1] - p3[1]) + p2[0] * (p3[1] - p1[1]) + p3[0] * (p1[1] - p2[1]));
  const scaleRef = Math.max(dist(p1, p2), dist(p2, p3), dist(p1, p3)) ** 2;
  if (Math.abs(d) < 1e-9 * Math.max(scaleRef, 1e-12)) return null;
  const s1 = dot(p1, p1);
  const s2 = dot(p2, p2);
  const s3 = dot(p3, p3);
  const c: P2 = [(s1 * (p2[1] - p3[1]) + s2 * (p3[1] - p1[1]) + s3 * (p1[1] - p2[1])) / d, (s1 * (p3[0] - p2[0]) + s2 * (p1[0] - p3[0]) + s3 * (p2[0] - p1[0])) / d];
  return { c, r: dist(c, p1) };
}

/** Center of the arc that leaves `start` along `tangent` and ends at `end` (tangent arc). */
export function tangentArcCenter(start: P2, tangent: P2, end: P2): P2 | null {
  const n = perp(unit(tangent));
  const chord = sub(end, start);
  const denom = 2 * dot(n, chord);
  if (Math.abs(denom) < 1e-12) return null; // end lies on the tangent line
  return add(start, scale(n, dot(chord, chord) / denom));
}

// ---------------------------------------------------------------- measuring and smart dimensions (C1.28)

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A dimension without id and value: what to measure. */
export type DimensionBody = DistributiveOmit<DimensionConstraint, 'id' | 'value' | 'label' | 'driving'>;

/** A relation without id. */
export type RelationBody = DistributiveOmit<Exclude<SketchConstraint, DimensionConstraint>, 'id'>;

export interface DimensionProposal {
  body: DimensionBody;
  /** Current value in millimetres or degrees; becomes the initial dimension value. */
  value: number;
  unit: 'mm' | 'deg';
}

const kindOf = (geometry: Geometry, id: Id, sketch?: Pick<SketchFeature, 'entities'>): HitKind | undefined => {
  if (id === SKETCH_ORIGIN) return 'origin';
  const t = geometryOf(geometry, id)?.type;
  if (t) return t;
  const ent = sketch?.entities.find((e) => e.id === id);
  return ent?.type;
};

/** Point used to measure an entity: the point itself, or the center of a circle/arc. */
function anchorOf(geometry: Geometry, id: Id): P2 | undefined {
  const g = geometryOf(geometry, id);
  if (g?.type === 'circle' || g?.type === 'arc') return g.c;
  return pointOf(geometry, id);
}

/** Signed angle from line a to line b (directions p1→p2), as the solver measures it. */
type SolvedLine = Extract<SolvedGeometry, { type: 'line' }>;
type AngleFlip = 'a' | 'b' | 'both' | undefined;

/** Where two (non-parallel) lines meet, extended as needed. */
function intersection(ga: SolvedLine, gb: SolvedLine): P2 {
  const da = sub(ga.b, ga.a);
  const db = sub(gb.b, gb.a);
  const denom = cross(da, db);
  return Math.abs(denom) < 1e-12 ? ga.a : add(ga.a, scale(da, cross(sub(gb.a, ga.a), db) / denom));
}

/** The rays an angle dimension measures between: along the lines as drawn, reversed where `flip` says. */
export function angleRays(ga: SolvedLine, gb: SolvedLine, flip: AngleFlip): { vertex: P2; ra: P2; rb: P2 } {
  const da = sub(ga.b, ga.a);
  const db = sub(gb.b, gb.a);
  return {
    vertex: intersection(ga, gb),
    ra: flip === 'a' || flip === 'both' ? scale(da, -1) : da,
    rb: flip === 'b' || flip === 'both' ? scale(db, -1) : db,
  };
}

/** Counter-clockwise angle from ray a to ray b, in (-π, π]. */
const rayAngle = (ra: P2, rb: P2) => Math.atan2(cross(ra, rb), dot(ra, rb));

/** Horizontal, vertical or aligned, from where the dimension is placed relative to two points (SW behaviour). */
function placementKind(a: P2, b: P2, place: P2): 'x' | 'y' | 'aligned' {
  const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
  const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  const inX = place[0] >= x0 && place[0] <= x1;
  const inY = place[1] >= y0 && place[1] <= y1;
  if (inX && !inY) return 'x';
  if (inY && !inX) return 'y';
  return 'aligned';
}

/**
 * Smart dimension (C1.28): what to dimension from the picked entities and the placement point.
 * Returns null for combinations SolidWorks would not dimension either.
 */
export function smartDimension(geometry: Geometry, picks: Id[], place: P2): DimensionProposal | null {
  const [a, b] = picks;
  if (a === undefined || picks.length > 2) return null;
  const ka = kindOf(geometry, a);
  // an axis has no length, and the angle between the two axes is always a right one
  if (isSketchAxis(a) && (b === undefined || isSketchAxis(b))) return null;
  if (b === undefined) {
    const g = geometryOf(geometry, a);
    if (g?.type === 'circle') return { body: { type: 'diameter', circle: a }, value: 2 * g.r, unit: 'mm' };
    if (g?.type === 'arc') return { body: { type: 'radius', circle: a }, value: g.r, unit: 'mm' };
    if (g?.type === 'line') {
      const k = placementKind(g.a, g.b, place);
      const dx = Math.abs(g.b[0] - g.a[0]);
      const dy = Math.abs(g.b[1] - g.a[1]);
      const slanted = dx > 1e-9 && dy > 1e-9;
      if (slanted && k === 'x') return { body: { type: 'distanceX', a: g.p1, b: g.p2 }, value: dx, unit: 'mm' };
      if (slanted && k === 'y') return { body: { type: 'distanceY', a: g.p1, b: g.p2 }, value: dy, unit: 'mm' };
      return { body: { type: 'distance', a }, value: dist(g.a, g.b), unit: 'mm' };
    }
    return null;
  }
  if (a === b) return null;
  const kb = kindOf(geometry, b);
  const ga = geometryOf(geometry, a);
  const gb = geometryOf(geometry, b);
  if (ga?.type === 'line' && gb?.type === 'line') {
    const da = unit(sub(ga.b, ga.a));
    const db = unit(sub(gb.b, gb.a));
    if (Math.abs(cross(da, db)) < 1e-6) {
      // parallel lines: their distance, measured like the solver does (from a's first point to b)
      return { body: { type: 'distance', a, b }, value: Math.abs(cross(db, sub(ga.a, gb.a))), unit: 'mm' };
    }
    // Like SolidWorks, the angle of the sector the dimension is placed in: the placement, seen from the
    // intersection, is α·da + β·db; the signs of α and β pick the rays that bound that sector.
    const q = sub(place, intersection(ga, gb));
    const den = cross(da, db);
    const sa = cross(q, db) / den < 0 ? -1 : 1;
    const sb = cross(da, q) / den < 0 ? -1 : 1;
    const angle = rayAngle(scale(da, sa), scale(db, sb));
    // Stored so that b's ray is counter-clockwise from a's, the value then being positive.
    const [first, second, s1, s2] = angle >= 0 ? [a, b, sa, sb] : [b, a, sb, sa];
    const flip: AngleFlip = s1 < 0 && s2 < 0 ? 'both' : s1 < 0 ? 'a' : s2 < 0 ? 'b' : undefined;
    return { body: { type: 'angle', a: first, b: second, ...(flip ? { flip } : {}) }, value: (Math.abs(angle) * 180) / Math.PI, unit: 'deg' };
  }
  if (ga?.type === 'line' || gb?.type === 'line') {
    const [lineId, otherId] = ga?.type === 'line' ? [a, b] : [b, a];
    const l = geometryOf(geometry, lineId) as Extract<SolvedGeometry, { type: 'line' }>;
    const p = anchorOf(geometry, otherId);
    if (!p) return null;
    const d = Math.abs(cross(unit(sub(l.b, l.a)), sub(p, l.a)));
    return { body: { type: 'distance', a: otherId, b: lineId }, value: d, unit: 'mm' };
  }
  const pa = anchorOf(geometry, a);
  const pb = anchorOf(geometry, b);
  if (!pa || !pb || !ka || !kb) return null;
  const k = placementKind(pa, pb, place);
  if (k === 'x') return { body: { type: 'distanceX', a, b }, value: Math.abs(pb[0] - pa[0]), unit: 'mm' };
  if (k === 'y') return { body: { type: 'distanceY', a, b }, value: Math.abs(pb[1] - pa[1]), unit: 'mm' };
  return { body: { type: 'distance', a, b }, value: dist(pa, pb), unit: 'mm' };
}

// ---------------------------------------------------------------- relations (C1.26, C1.27)

/** What a sketch axis (ADR 0170) may be part of: a fixed infinite line has no length, no middle, and is already horizontal or vertical. */
const AXIS_RELATIONS = new Set<RelationBody['type']>(['collinear', 'parallel', 'perpendicular', 'tangent', 'pointOnCurve', 'symmetric', 'symmetricEntity', 'intersection']);

/** Relations SolidWorks offers in 「加入限制條件」 for the current selection. */
export function applicableRelations(geometry: Geometry, selection: Id[], sketch?: Pick<SketchFeature, 'entities'> & Partial<Pick<SketchFeature, 'constraints'>>): RelationBody[] {
  const axes = selection.filter(isSketchAxis).length;
  if (axes > 1) return [];
  const end=selection.length===2?endpointTangentOffer(geometry,selection[0]!,selection[1]!):null;
  const all = [...candidateRelations(geometry, selection, sketch), ...blockOffer(geometry, selection, sketch),...(end?[end]:[])];
  return axes === 0 ? all : all.filter((r) => AXIS_RELATIONS.has(r.type));
}

/**
 * 「固定」 of whole curves (ADR 0182): offered when what is selected is lines, circles and arcs and nothing else, for as long as one of them is not held yet.
 * The body names the first one that is not; the controller adds one for each of the selected that is not (`blockTargets`), in one step.
 */
function blockOffer(geometry: Geometry, selection: Id[], sketch?: Pick<SketchFeature, 'entities'> & Partial<Pick<SketchFeature, 'constraints'>>): RelationBody[] {
  const next = blockTargets(geometry, selection, sketch)[0];
  return next === undefined ? [] : [{ type: 'block', entity: next }];
}

/** The selected lines, circles and arcs that no `block` holds yet; none when the selection holds anything else (a point, an axis). */
export function blockTargets(geometry: Geometry, selection: readonly Id[], sketch?: Pick<SketchFeature, 'entities'> & Partial<Pick<SketchFeature, 'constraints'>>): Id[] {
  if (selection.length === 0) return [];
  if (!selection.every((id) => ['line', 'circle', 'arc'].includes(kindOf(geometry, id, sketch) ?? ''))) return [];
  const held = new Set((sketch?.constraints ?? []).flatMap((c) => (c.type === 'block' ? [c.entity] : [])));
  return selection.filter((id) => !held.has(id));
}

/**
 * Expand a multi-selection into a minimal forest of ordinary model constraints. Two circles or arcs are the one case of two that is also looked at
 * (`concentric` and `coradial`, ADR 0213): what already holds is left out, since a relation that only repeats it is redundant and the solver would refuse it.
 */
export function expandRelation(body:RelationBody,geometry:Geometry,selection:readonly Id[],sketch:Pick<SketchFeature,'entities'|'constraints'>,pair=false):RelationBody[] {
  const ids=[...new Set(selection)];
  const kinds=ids.map(id=>kindOf(geometry,id,sketch));
  const lines=kinds.every(kind=>kind==='line'),points=kinds.every(kind=>kind==='point'||kind==='origin'),radials=kinds.every(kind=>kind==='circle'||kind==='arc');
  const twoRadials=ids.length===2&&radials&&(body.type==='concentric'||body.type==='coradial'||(pair&&body.type==='equal'));
  if(ids.length<3&&!twoRadials)return [body];
  if(body.type==='coradial'&&radials) {
    const parts=[...expandRelation({type:'concentric',a:ids[0]!,b:ids[1]!},geometry,ids,sketch,true),...expandRelation({type:'equal',a:ids[0]!,b:ids[1]!},geometry,ids,sketch,true)];
    return ids.length===2&&parts.length===2?[body]:parts; // both halves missing: the one relation, as before
  }
  if((body.type==='horizontal'||body.type==='vertical')&&lines) {
    return ids.filter(id=>!sketch.constraints.some(c=>(c.type===body.type&&c.a===id&&c.b===undefined)||(c.type==='block'&&c.entity===id))).map(a=>({type:body.type,a}));
  }
  const type=body.type;
  if(!((lines&&(type==='parallel'||type==='equal'))||(radials&&(type==='concentric'||type==='equal'||type==='equalCurvature'))||(points&&(type==='coincident'||type==='horizontal'||type==='vertical'))))return [body];
  const parents=new Map<Id,Id>();
  const root=(id:Id):Id=>{const p=parents.get(id);if(!p){parents.set(id,id);return id;}if(p===id)return id;const result=root(p);parents.set(id,result);return result;};
  const join=(a:Id,b:Id)=>{const x=root(a),y=root(b);if(x!==y)parents.set(y,x);};
  const key=(id:Id):Id=>{const g=geometryOf(geometry,id);return type==='concentric'&&(g?.type==='circle'||g?.type==='arc')?g.center:id;};
  for(const c of sketch.constraints) {
    if(type==='concentric') {
      if(c.type==='coincident')join(c.a,c.b);
      if(c.type==='concentric'||c.type==='coradial')join(key(c.a),key(c.b));
    } else if(type==='parallel'&&(c.type==='parallel'||c.type==='collinear'))join(c.a,c.b);
    else if((type==='equal'||type==='equalCurvature')&&(c.type==='equal'||c.type==='equalCurvature'||(radials&&c.type==='coradial')))join(c.a,c.b);
    else if(points&&((c.type===type&&'b'in c&&c.b!==undefined)||c.type==='coincident'))join(c.a,c.b!);
  }
  if(lines&&type==='parallel')for(const orientation of ['horizontal','vertical'] as const){const held=sketch.constraints.filter(c=>c.type===orientation&&c.b===undefined);for(let i=1;i<held.length;i++)join((held[0] as {a:Id}).a,(held[i] as {a:Id}).a);}
  const result:RelationBody[]=[];
  for(let i=1;i<ids.length;i++){const a=ids[0]!,b=ids[i]!;if(root(key(a))===root(key(b)))continue;result.push({type,a,b} as RelationBody);join(key(a),key(b));}
  return result;
}

function candidateRelations(geometry: Geometry, selection: Id[], sketch?: Pick<SketchFeature, 'entities'> & Partial<Pick<SketchFeature,'constraints'>>): RelationBody[] {
  const items = selection.map((id) => ({ id, kind: kindOf(geometry, id, sketch) }));
  if (items.some((i) => !i.kind)) return [];
  const isPoint = (k: HitKind | undefined) => k === 'point' || k === 'origin';
  const isRadial = (k: HitKind | undefined) => k === 'circle' || k === 'arc';
  const byKind = (pred: (k: HitKind | undefined) => boolean) => items.filter((i) => pred(i.kind)).map((i) => i.id);
  const lines = byKind((k) => k === 'line');
  const points = byKind(isPoint);
  const radials = byKind(isRadial);
  const n = items.length;
  const whole:RelationBody[]=[];
  if(n===3&&sketch){
    const a=sketch.entities.find(e=>e.id===selection[0]),b=sketch.entities.find(e=>e.id===selection[1]),reference=items[2]!;
    if(a&&b&&a.type===b.type&&['line','circle','arc'].includes(a.type)&&!entityPoints(a).some(p=>entityPoints(b).includes(p))){
      let reverse=false;
      if(a.type==='line'&&b.type==='line'){
        const ga=geometryOf(geometry,a.id),gb=geometryOf(geometry,b.id),axis=geometryOf(geometry,reference.id),center=pointOf(geometry,reference.id);
        if(ga?.type==='line'&&gb?.type==='line'){const reflected=(p:P2):P2=>{if(axis?.type==='line'){const d=unit(sub(axis.b,axis.a)),v=sub(p,axis.a);return sub(add(axis.a,scale(d,2*dot(v,d))),v);}return center?sub(scale(center,2),p):p;};reverse=dist(reflected(ga.a),gb.b)+dist(reflected(ga.b),gb.a)<dist(reflected(ga.a),gb.a)+dist(reflected(ga.b),gb.b);}
      }
      if(reference.kind==='line')whole.push({type:'symmetricEntity',a:a.id,b:b.id,axis:reference.id,...(reverse?{reverse}: {})});
      if(isPoint(reference.kind))whole.push({type:'symmetricEntityPoint',a:a.id,b:b.id,point:reference.id,...(reverse?{reverse}: {})});
    }
  }

  if(n===1&&items[0]?.kind==='ellipse'){const g=geometryOf(geometry,selection[0]!);if(g?.type==='ellipse'&&g.majorRadius>g.minorRadius+1e-6)return [{type:'ellipseAxes',entity:selection[0]!,majorRadius:String(g.majorRadius),minorRadius:String(g.minorRadius)}];}
  if(n===2){const ellipse=items.find(i=>i.kind==='ellipse'),other=items.find(i=>i!==ellipse);if(ellipse&&other){if(isPoint(other.kind))return [{type:'pointOnCurve',point:other.id,curve:ellipse.id}];if(other.kind==='line')return [{type:'tangent',a:other.id,b:ellipse.id}];}}
  if (n === 1 && lines.length === 1) return [{ type: 'horizontal', a: lines[0]! }, { type: 'vertical', a: lines[0]! }];
  if (n === 1 && points.length === 1 && points[0] !== SKETCH_ORIGIN) return [{ type: 'fix', point: points[0]! }];
  if(n>=3) {
    const allLines=lines.length===n,allRadials=radials.length===n,allPoints=points.length===n;
    const types:RelationBody['type'][]=allLines?['horizontal','vertical','parallel','equal']:allRadials?['concentric','coradial','equal','equalCurvature']:allPoints?['coincident','horizontal','vertical']:[];
    const batch=types.flatMap(type=>{
      const body={type,a:selection[0]!,b:selection[1]!} as RelationBody;
      const missing=expandRelation(body,geometry,selection,{entities:sketch?.entities??[],constraints:sketch?.constraints??[]});
      if(!missing.length)return [];
      return [{...missing[0]!,type} as RelationBody];
    });
    if(n<=32&&(allPoints||allRadials))batch.push({type:'equalSpacing',points:[...selection]});
    if(types.length)return [...batch,...whole,...(n===3&&allPoints?[{type:'symmetricPoint' as const,a:points[0]!,b:points[1]!,point:points[2]!}]:[])];
  }
  if (n !== 2 && n !== 3) return [];
  if (n === 3) {
    if (points.length === 3) return [{type:'symmetricPoint',a:points[0]!,b:points[1]!,point:points[2]!}];
    if (points.length === 2 && lines.length === 1) return [{ type: 'symmetric', a: points[0]!, b: points[1]!, axis: lines[0]! }];
    // a point and two curves: the point where they cross
    const curves = [...lines, ...radials];
    if (points.length === 1 && curves.length === 2) return [...whole,{ type: 'intersection', point: points[0]!, a: curves[0]!, b: curves[1]! }];
    return whole;
  }
  const [a, b] = selection as [Id, Id];
  if (lines.length === 2) {
    return [
      { type: 'collinear', a, b },
      { type: 'parallel', a, b },
      { type: 'perpendicular', a, b },
      { type: 'equal', a, b },
      { type:'lengthRatio',a,b,ratio:'2' },
    ];
  }
  if (points.length === 2) {
    return [
      { type: 'coincident', a, b },
      { type: 'horizontal', a, b },
      { type: 'vertical', a, b },
    ];
  }
  if (points.length === 1 && lines.length === 1) {
    return [
      { type: 'pointOnCurve', point: points[0]!, curve: lines[0]! },
      { type: 'midpoint', point: points[0]!, line: lines[0]! },
    ];
  }
  if (points.length === 1 && radials.length === 1) {
    const arc = geometryOf(geometry, radials[0]!);
    // the middle of an arc as well, unless the point is one of the arc's own (no arc could have it in the middle)
    const middle = arc?.type === 'arc' && ![arc.center, arc.start, arc.end].includes(points[0]!);
    return [{ type: 'pointOnCurve', point: points[0]!, curve: radials[0]! }, ...(middle ? [{ type: 'midpoint' as const, point: points[0]!, line: radials[0]! }] : [])];
  }
  if (lines.length === 1 && radials.length === 1) return [{ type: 'tangent', a: lines[0]!, b: radials[0]! }];
  if (radials.length === 2) {
    const rest = { entities: sketch?.entities ?? [], constraints: sketch?.constraints ?? [] };
    return [
      { type: 'concentric', a, b },
      { type: 'coradial', a, b },
      { type: 'equalCurvature', a, b },
      { type: 'equal', a, b },
      { type: 'tangent', a, b },
      { type:'tangentExternal',a,b },
      { type:'tangentInternal',a,b },
    ].filter((r) => (r.type !== 'concentric' && r.type !== 'coradial') || expandRelation(r as RelationBody, geometry, selection, rest).length > 0) as RelationBody[]; // not what already holds (ADR 0213)
  }
  return [];
}

/** Relations and dimensions that refer to any of the given ids (the 「現有限制條件」 list). */
export function constraintsOf<C extends SketchConstraint>(constraints: readonly C[], ids: Iterable<Id>): C[] {
  const set = new Set(ids);
  return constraints.filter((c) => constraintRefs(c).some((r) => set.has(r)));
}

/** Endpoint pair closest in solved geometry; normal orientation is stored so later edits do not choose another branch. */
export function endpointTangentOffer(geometry:Geometry,a:Id,b:Id):Extract<RelationBody,{type:'endpointTangent'}>|null {
  const ga=geometryOf(geometry,a),gb=geometryOf(geometry,b);
  if(!ga||!gb||!['line','arc','spline'].includes(ga.type)||!['line','arc','spline'].includes(gb.type)||(ga.type==='spline'&&!ga.bezier)||(gb.type==='spline'&&!gb.bezier))return null;
  const ends=(g:SolvedGeometry):P2[]=>g.type==='line'?[g.a,g.b]:g.type==='arc'?[polar(g.c,g.r,g.a0),polar(g.c,g.r,g.a1)]:g.type==='spline'?[g.points[0]!,g.points[g.points.length-1]!]:[];
  const ea=ends(ga),eb=ends(gb);let ai=0,bi=0,best=Infinity;for(let i=0;i<2;i++)for(let j=0;j<2;j++){const d=dist(ea[i]!,eb[j]!);if(d<best){best=d;ai=i;bi=j;}}
  const normal=(g:SolvedGeometry,p:P2):P2=>g.type==='line'?perp(sub(g.b,g.a)):g.type==='arc'?sub(g.c,p):g.type==='spline'?perp(dist(p,g.points[0]!)<1e-9?sub(g.points[1]!,g.points[0]!):sub(g.points[g.points.length-1]!,g.points[g.points.length-2]!)):[0,0];
  return {type:'endpointTangent',a,b,aEnd:ai===0?'start':'end',bEnd:bi===0?'start':'end',opposed:dot(normal(ga,ea[ai]!),normal(gb,eb[bi]!))<0};
}

/** Same relation type between the same entities (so the UI does not offer a duplicate). */
export function sameRelation(a: RelationBody | SketchConstraint, b: RelationBody | SketchConstraint): boolean {
  if (a.type !== b.type) return false;
  if(a.type==='endpointTangent'&&b.type==='endpointTangent')return a.a===b.a&&a.b===b.b&&a.aEnd===b.aEnd&&a.bEnd===b.bEnd;
  if(a.type==='symmetricEntity'&&b.type==='symmetricEntity')return a.a===b.a&&a.b===b.b&&a.axis===b.axis;
  if(a.type==='symmetricEntityPoint'&&b.type==='symmetricEntityPoint')return a.a===b.a&&a.b===b.b&&a.point===b.point;
  if(a.type==='lengthRatio'&&b.type==='lengthRatio')return a.a===b.a&&a.b===b.b;
  if(a.type==='equalSpacing'&&b.type==='equalSpacing')return a.points.length===b.points.length&&a.points.every((p,i)=>p===b.points[i]);
  if(a.type==='symmetricPoint' && b.type==='symmetricPoint' && a.point!==b.point)return false;
  const ra = constraintRefs(a as SketchConstraint).slice().sort();
  const rb = constraintRefs(b as SketchConstraint).slice().sort();
  return ra.length === rb.length && ra.every((r, i) => r === rb[i]);
}

// ---------------------------------------------------------------- dimension layout (for display)

export interface DimensionLayout {
  /** Dimension line, extension lines and arrowheads as segments. */
  segments: [P2, P2][];
  text: P2;
}

/**
 * Automatic placement of a dimension's graphics, offset away from the sketch's center so it sits
 * outside the geometry like a SolidWorks dimension. `px` = one screen pixel in sketch units.
 */
export function layoutDimension(c: SketchConstraint, geometry: Geometry, px: number, center: P2): DimensionLayout | null {
  const position = 'labelPosition' in c ? c.labelPosition : undefined;
  const off = 28 * px;
  const arrow = 7 * px;
  const arrowhead = (tip: P2, toward: P2): [P2, P2][] => {
    const d = unit(sub(toward, tip));
    const n = perp(d);
    const back = add(tip, scale(d, arrow));
    return [
      [tip, add(back, scale(n, arrow * 0.35))],
      [tip, add(back, scale(n, -arrow * 0.35))],
    ];
  };
  /** Dimension line parallel to a→b, pushed out along `n`, with extension lines and arrows. */
  const linear = (a: P2, b: P2, n: P2): DimensionLayout => {
    const offset = position ? dot(sub(position, a), n) - 10 * px : off;
    const s = add(a, scale(n, offset));
    const e = add(b, scale(n, offset));
    return {
      segments: [[a, add(s, scale(n, arrow * 0.6))], [b, add(e, scale(n, arrow * 0.6))], [s, e], ...arrowhead(s, e), ...arrowhead(e, s)],
      text: position ?? add(mid(s, e), scale(n, 10 * px)),
    };
  };
  const outward = (a: P2, b: P2): P2 => {
    let n = perp(unit(sub(b, a)));
    if (dot(n, sub(center, mid(a, b))) > 0) n = scale(n, -1);
    return n;
  };

  switch (c.type) {
    case 'distance': {
      if (c.b === undefined) {
        const l = geometryOf(geometry, c.a);
        return l?.type === 'line' ? linear(l.a, l.b, outward(l.a, l.b)) : null;
      }
      if (c.condition !== undefined) {
        // the nearest or the farthest points (ADR 0183): a dimension line between them, which is what the value is the length of
        const m = conditionEnds(geometry, c.a, c.b, c.condition);
        if (!m || !('ends' in m)) return null;
        const [from, to] = m.ends;
        return dist(from, to) < 1e-9 ? null : linear(from, to, outward(from, to));
      }
      const ga = geometryOf(geometry, c.a);
      const gb = geometryOf(geometry, c.b);
      if (ga?.type === 'line' || gb?.type === 'line') {
        const [lineId, otherId] = ga?.type === 'line' ? [c.a, c.b] : [c.b, c.a];
        const l = geometryOf(geometry, lineId) as Extract<SolvedGeometry, { type: 'line' }>;
        const other = geometryOf(geometry, otherId);
        const p = other?.type === 'line' ? other.a : anchorOf(geometry, otherId);
        if (!p) return null;
        const foot = add(l.a, scale(unit(sub(l.b, l.a)), dot(sub(p, l.a), unit(sub(l.b, l.a)))));
        return linear(p, foot, perp(unit(sub(foot, p))));
      }
      const pa = anchorOf(geometry, c.a);
      const pb = anchorOf(geometry, c.b);
      return pa && pb ? linear(pa, pb, outward(pa, pb)) : null;
    }
    case 'distanceX':
    case 'distanceY': {
      const pa = anchorOf(geometry, c.a);
      const pb = anchorOf(geometry, c.b);
      if (!pa || !pb) return null;
      const ax = c.type === 'distanceX' ? 1 : 0; // coordinate that is shared by the dimension line
      const autoLevel = ax === 1 ? (center[1] > Math.min(pa[1], pb[1]) ? Math.min(pa[1], pb[1]) - off : Math.max(pa[1], pb[1]) + off) : center[0] > Math.min(pa[0], pb[0]) ? Math.min(pa[0], pb[0]) - off : Math.max(pa[0], pb[0]) + off;
      const sign = Math.sign(autoLevel - (ax === 1 ? pa[1] : pa[0])) || 1;
      const level = position ? position[ax]! - sign * 10 * px : autoLevel;
      const onLevel = (p: P2): P2 => (ax === 1 ? [p[0], level] : [level, p[1]]);
      const s = onLevel(pa);
      const e = onLevel(pb);
      const n: P2 = ax === 1 ? [0, Math.sign(level - pa[1]) || 1] : [Math.sign(level - pa[0]) || 1, 0];
      return {
        segments: [[pa, add(s, scale(n, arrow * 0.6))], [pb, add(e, scale(n, arrow * 0.6))], [s, e], ...arrowhead(s, e), ...arrowhead(e, s)],
        text: position ?? add(mid(s, e), scale(n, 10 * px)),
      };
    }
    case 'radius':
    case 'diameter': {
      const g = geometryOf(geometry, c.circle);
      if (g?.type !== 'circle' && g?.type !== 'arc') return null;
      const angle = position ? Math.atan2(position[1] - g.c[1], position[0] - g.c[0]) : g.type === 'arc' ? g.a0 + norm(g.a1 - g.a0) / 2 : Math.PI / 4;
      const rim = polar(g.c, g.r, angle);
      const tail = position ? add(position, scale(unit(sub(g.c, position)), 10 * px)) : polar(g.c, g.r + off, angle);
      const from = c.type === 'diameter' ? polar(g.c, g.r, angle + Math.PI) : g.c;
      return { segments: [[from, tail], ...arrowhead(rim, from)], text: position ?? polar(g.c, g.r + off + 10 * px, angle) };
    }
    case 'arcLength': {
      const g = geometryOf(geometry, c.circle);
      if (g?.type !== 'arc') return null;
      const sweep = norm(g.a1 - g.a0) || 2 * Math.PI;
      const r = position ? dist(g.c, position) : g.r + off;
      const pts = Array.from({ length: 17 }, (_, i) => polar(g.c, r, g.a0 + (sweep * i) / 16));
      const segments: [P2, P2][] = pts.slice(1).map((p, i) => [pts[i]!, p]);
      segments.push([polar(g.c, g.r, g.a0), pts[0]!], [polar(g.c, g.r, g.a1), pts[16]!]);
      return { segments, text: position ?? polar(g.c, r + 12 * px, g.a0 + sweep / 2) };
    }
    case 'angle': {
      const ga = geometryOf(geometry, c.a);
      const gb = geometryOf(geometry, c.b);
      if (ga?.type !== 'line' || gb?.type !== 'line') return null;
      const { vertex, ra, rb } = angleRays(ga, gb, c.flip);
      const r = position ? dist(vertex, position) : off * 1.6;
      const a0 = Math.atan2(ra[1], ra[0]);
      const sweep = rayAngle(ra, rb);
      const pts = Array.from({ length: 17 }, (_, i) => polar(vertex, r, a0 + (sweep * i) / 16));
      const segments: [P2, P2][] = pts.slice(1).map((p, i) => [pts[i]!, p]);
      return { segments, text: position ?? polar(vertex, r + 12 * px, a0 + sweep / 2) };
    }
    default:
      return null;
  }
}

/**
 * Display text of a dimension: the value as entered, with SolidWorks prefixes and suffixes. A driven (reference) dimension
 * shows what is measured now, in parentheses (`measured`, the number from `measure`).
 */
export function dimensionText(c: DimensionConstraint, measured?: string): string {
  const value = c.driving === false && measured !== undefined ? measured : c.value;
  const text =
    c.type === 'diameter' ? `Ø${value}` : c.type === 'radius' ? `R${value}` : c.type === 'arcLength' ? `⌒${value}` : c.type === 'angle' ? (/[a-z°]/i.test(value) ? value : `${value}°`) : value;
  return c.driving === false ? `(${text})` : text;
}

/** Where a distance with a condition (ADR 0183) is measured between, and how long it is; or why it cannot be (no direction, the curves cross). */
export type ConditionEnds = { ends: [P2, P2]; value: number } | { error: 'noDirection' | 'crossing' };

/**
 * The two points the nearest (`min`) or the farthest (`max`) distance is measured between, for a circle or an arc and a point, a line, or another circle or
 * arc (an arc is taken as the whole circle it lies on). Null when the pair is not one of those. A circle that crosses the line, two circles that cross, and
 * a point at the center (or concentric circles for the farthest) have no nearest or no farthest to speak of: `error` says which.
 */
export function conditionEnds(geometry: Geometry, aId: Id, bId: Id, condition: 'min' | 'max'): ConditionEnds | null {
  const radial = (id: Id) => {
    const g = geometryOf(geometry, id);
    return g?.type === 'circle' || g?.type === 'arc' ? g : null;
  };
  const [ra, rb] = [radial(aId), radial(bId)];
  const r = ra ?? rb;
  if (!r) return null;
  const otherId = ra ? bId : aId;
  const ro = ra ? rb : null;
  const done = (e: [P2, P2]): ConditionEnds => ({ ends: e, value: dist(e[0], e[1]) });
  if (ro) {
    const d = dist(r.c, ro.c);
    if (condition === 'max') {
      if (d < 1e-9) return { error: 'noDirection' };
      const u = unit(sub(ro.c, r.c));
      return done([sub(r.c, scale(u, r.r)), add(ro.c, scale(u, ro.r))]);
    }
    if (d < 1e-9) return done([add(r.c, [r.r, 0]), add(ro.c, [ro.r, 0])]); // concentric: the same on every ray
    const u = unit(sub(ro.c, r.c));
    if (d >= r.r + ro.r) return done([add(r.c, scale(u, r.r)), sub(ro.c, scale(u, ro.r))]);
    if (d + ro.r <= r.r) return done([add(r.c, scale(u, r.r)), add(ro.c, scale(u, ro.r))]); // the other inside this one
    if (d + r.r <= ro.r) return done([sub(r.c, scale(u, r.r)), sub(ro.c, scale(u, ro.r))]); // this one inside the other
    return { error: 'crossing' };
  }
  const o = geometryOf(geometry, otherId);
  if (o?.type === 'line') {
    const dir = unit(sub(o.b, o.a));
    const n = perp(dir);
    const signed = dot(sub(r.c, o.a), n);
    const side = signed >= 0 ? 1 : -1;
    if (condition === 'min' && Math.abs(signed) < r.r - 1e-9) return { error: 'crossing' };
    const q = add(r.c, scale(n, (condition === 'max' ? side : -side) * r.r));
    const foot = sub(q, scale(n, dot(sub(q, o.a), n)));
    return done([q, foot]);
  }
  const p = anchorOf(geometry, otherId);
  if (!p) return null;
  const d = dist(p, r.c);
  if (d < 1e-9) return { error: 'noDirection' };
  const u = unit(sub(p, r.c));
  return done([p, condition === 'min' ? add(r.c, scale(u, r.r)) : sub(r.c, scale(u, r.r))]);
}

/** What a dimension measures in the solved sketch: millimetres, or degrees for an angle; null when its entities are not there. */
export function measure(c: DimensionConstraint, geometry: Geometry): number | null {
  switch (c.type) {
    case 'distance': {
      if (c.b === undefined) {
        const l = geometryOf(geometry, c.a);
        return l?.type === 'line' ? dist(l.a, l.b) : null;
      }
      if (c.condition !== undefined) {
        const m = conditionEnds(geometry, c.a, c.b, c.condition);
        return m && 'value' in m ? m.value : null;
      }
      const [ga, gb] = [geometryOf(geometry, c.a), geometryOf(geometry, c.b)];
      // like the solver: from the first point of a line (or the anchor) to the other line
      const [lineId, other] = gb?.type === 'line' ? [c.b, c.a] : ga?.type === 'line' ? [c.a, c.b] : [null, null];
      if (lineId !== null) {
        const l = geometryOf(geometry, lineId) as SolvedLine;
        const o = geometryOf(geometry, other!);
        const p = o?.type === 'line' ? o.a : anchorOf(geometry, other!);
        return p ? Math.abs(cross(unit(sub(l.b, l.a)), sub(p, l.a))) : null;
      }
      const [pa, pb] = [anchorOf(geometry, c.a), anchorOf(geometry, c.b)];
      return pa && pb ? dist(pa, pb) : null;
    }
    case 'distanceX':
    case 'distanceY': {
      const [pa, pb] = [anchorOf(geometry, c.a), anchorOf(geometry, c.b)];
      const axis = c.type === 'distanceX' ? 0 : 1;
      return pa && pb ? Math.abs(pb[axis]! - pa[axis]!) : null;
    }
    case 'radius':
    case 'diameter': {
      const g = geometryOf(geometry, c.circle);
      return g?.type === 'circle' || g?.type === 'arc' ? (c.type === 'radius' ? g.r : 2 * g.r) : null;
    }
    case 'arcLength': {
      const g = geometryOf(geometry, c.circle);
      return g?.type === 'arc' ? g.r * (norm(g.a1 - g.a0) || 2 * Math.PI) : null;
    }
    case 'angle': {
      const [ga, gb] = [geometryOf(geometry, c.a), geometryOf(geometry, c.b)];
      if (ga?.type !== 'line' || gb?.type !== 'line') return null;
      const { ra, rb } = angleRays(ga, gb, c.flip);
      return (norm(rayAngle(ra, rb)) * 180) / Math.PI;
    }
  }
}

/** `measure`, as the text a driven dimension shows. */
export function measuredText(c: DimensionConstraint, geometry: Geometry): string | undefined {
  const v = measure(c, geometry);
  return v === null ? undefined : String(Math.round(v * 1e4) / 1e4);
}
