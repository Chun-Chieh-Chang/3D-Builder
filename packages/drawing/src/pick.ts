import { rightOf, sheetUp, type ElementFacts, type ViewAxes, type ViewFeature } from '@3db/model';
import { t } from '@3db/i18n';
import type { DimensionDraft } from './autoDimension';
import { arcAt, leaderAt, offsetAt, type DimensionHandle } from './dimension';
import { itemsBounds } from './fit';
import { toSheet, type PlacedView, type ViewLines } from './layout';
import type { SceneItem } from './scene';
import type { EdgePick, VertexPick, VisibleElements } from './viewEdges';

/**
 * Pointing at a drawing (the mouse, in sheet mm): which element of a view is under the pointer, which dimension, and what a dimension that the user makes from elements
 * they pointed at, and puts where they pointed, is. All of it pure: the views and the dimensions are drawn by the other files, this reads what they drew.
 */

export type P2 = [number, number];

/**
 * What a dimension can be attached to: everything the worker found except the sides of cylinders, and (D-I2) the straight edges and the vertices of the model the
 * view shows, by name.
 */
export type Pickable = Exclude<ViewFeature, { type: 'axis' }> | EdgePick | VertexPick;

const hyp = Math.hypot;

/** A point of the sheet in a view's own coordinates (full size): the other way round from `toSheet`. */
export const toView = (placed: PlacedView, p: P2): P2 => [(p[0] - placed.at[0]) / placed.scale + placed.centre[0], (p[1] - placed.at[1]) / placed.scale + placed.centre[1]];

/** The distance from `p` to the segment from `a` to `b`. */
export function segmentDistance(p: P2, a: P2, b: P2): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const k = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return hyp(p[0] - (a[0] + k * dx), p[1] - (a[1] + k * dy));
}

/** How big what a feature is drawn as is, for telling two apart that are the same distance from the pointer: the area of the circle an arc or a fillet is part of. */
const areaOf = (f: Pickable) => (f.type === 'circle' || f.type === 'torus' ? Math.PI * f.radius * f.radius : f.type === 'edge' || f.type === 'vertex' ? 0 : f.area);

/**
 * The element of a view under the pointer, or null: a straight line of the view that is where a plane seen edge-on is (a vertical one for a plane across x, a horizontal one
 * for y, a slanted one for a slanted face) or a circle or an arc of the view that is where a cylinder seen along its axis is, or where a fillet's tube is cut through. Only
 * what is drawn counts: a plane at an x that has no line there is not picked by pointing at the empty place. `p` and `tol` are in the view's coordinates.
 */
export function featureAt(lines: ViewLines | null | undefined, features: readonly ViewFeature[], p: P2, tol: number, seen?: VisibleElements): Pickable | null {
  if (!lines) return null;
  // a vertex near the pointer is what is meant there, before the lines that meet at it (SolidWorks picks the end point)
  if (seen) {
    let v: { f: VertexPick; d: number } | null = null;
    for (const x of seen.vertices) {
      const d = hyp(p[0] - x.at[0], p[1] - x.at[1]);
      if (d <= tol && (!v || d < v.d - 1e-9 || (Math.abs(d - v.d) <= 1e-9 && x.depth > v.f.depth))) v = { f: x, d };
    }
    if (v) return v.f;
  }
  const pickable: Pickable[] = [...features.filter((f): f is Exclude<ViewFeature, { type: 'axis' }> => f.type !== 'axis'), ...(seen?.circles ?? [])];
  let best: { f: Pickable; d: number } | null = null;
  const offer = (f: Pickable, d: number) => {
    if (d > tol) return;
    if (!best || d < best.d - 1e-9 || (Math.abs(d - best.d) <= 1e-9 && areaOf(f) > areaOf(best.f))) best = { f, d };
  };
  let nearest = Infinity; // the nearest line of the view of any kind: a circle has to be drawn where it is pointed at
  for (const poly of lines.visible) {
    for (let i = 0; i + 3 < poly.length; i += 2) {
      const a: P2 = [poly[i]!, poly[i + 1]!];
      const b: P2 = [poly[i + 2]!, poly[i + 3]!];
      const d = segmentDistance(p, a, b);
      nearest = Math.min(nearest, d);
      if (d > tol) continue;
      const l = hyp(b[0] - a[0], b[1] - a[1]);
      if (l < 1e-9) continue;
      const u: P2 = [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
      for (const f of pickable) {
        if (f.type === 'plane') {
          if (f.axis === 'x' && Math.abs(u[0]) < 1e-6 && Math.abs(f.coord - a[0]) < 1e-3) offer(f, d);
          if (f.axis === 'y' && Math.abs(u[1]) < 1e-6 && Math.abs(f.coord - a[1]) < 1e-3) offer(f, d);
        } else if (f.type === 'slant') {
          const across = Math.abs(u[0] * f.dir[1] - u[1] * f.dir[0]);
          const off = Math.abs((f.at[0] - a[0]) * u[1] - (f.at[1] - a[1]) * u[0]);
          if (across < 1e-3 && off < 1e-2) offer(f, d);
        }
      }
    }
  }
  // a straight edge of the model: a plane seen edge-on along the same line is there too and wins (its area), so an edge is what is picked where no plane is
  for (const e of seen?.edges ?? []) offer(e, segmentDistance(p, e.a, e.b));
  if (nearest <= tol) {
    // a circle is drawn about its own middle; a fillet's arc about `at`, which is `major` off the torus's centre, and of the tube's radius and not the torus's
    for (const f of pickable) {
      if (f.type === 'circle') offer(f, Math.abs(hyp(p[0] - f.centre[0], p[1] - f.centre[1]) - f.radius));
      else if (f.type === 'torus') offer(f, Math.abs(hyp(p[0] - f.at[0], p[1] - f.at[1]) - f.radius));
    }
  }
  return (best as { f: Pickable } | null)?.f ?? null;
}

/** What the model would say of an element, made from what a view knows of it: enough for a dimension to be drawn before the worker has been asked (the part's frame is the view's: x right, y up, the rest along the view). */
export function factsOf(f: Pickable, axes: ViewAxes): ElementFacts {
  const r = rightOf(axes);
  const u = sheetUp(axes);
  const at = (x: number, y: number): [number, number, number] => [r[0] * x + u[0] * y, r[1] * x + u[1] * y, r[2] * x + u[2] * y];
  if (f.type === 'vertex') return { kind: 'vertex', type: 'point', point: at(f.at[0], f.at[1]) };
  if (f.type === 'edge') {
    const l = hyp(f.b[0] - f.a[0], f.b[1] - f.a[1]);
    return { kind: 'edge', type: 'line', point: at((f.a[0] + f.b[0]) / 2, (f.a[1] + f.b[1]) / 2), dir: at((f.b[0] - f.a[0]) / l, (f.b[1] - f.a[1]) / l) };
  }
  if (f.type === 'plane') return f.axis === 'x' ? { kind: 'face', type: 'plane', point: at(f.coord, 0), dir: at(1, 0) } : { kind: 'face', type: 'plane', point: at(0, f.coord), dir: at(0, 1) };
  if (f.type === 'slant') return { kind: 'face', type: 'plane', point: at(f.at[0], f.at[1]), dir: at(-f.dir[1], f.dir[0]) };
  // a fillet: the point is the torus's own centre and the direction its axis, both in the part's frame; `major` is what lets the dimension find the arc (its own axis
  // lies in the sheet, which is the case this is offered in)
  if (f.type === 'torus') return { kind: 'face', type: 'torus', point: at(f.centre[0], f.centre[1]), dir: at(f.axis[0], f.axis[1]), radius: f.radius, major: f.major };
  return { kind: 'face', type: 'cylinder', point: at(f.centre[0], f.centre[1]), dir: [axes.dir[0], axes.dir[1], axes.dir[2]], radius: f.radius };
}

// ---------------------------------------------------------------- dimensions

/** The distance from `p` to a dimension (the nearest of the lines and texts it is drawn with), and whether it is the text that is nearest. Null for none within `tol`. */
export function dimensionAt(items: readonly SceneItem[], p: P2, tol: number): { id: string; text: boolean } | null {
  let best: { id: string; text: boolean; d: number } | null = null;
  const offer = (id: string, text: boolean, d: number) => {
    if (d > tol) return;
    // a text under the pointer wins over a line of the same dimension (that is how it is told apart: the text slides, the line moves away)
    if (!best || d < best.d - 1e-9 || (text && best.id === id && !best.text && d <= tol)) best = { id, text, d };
  };
  for (const it of items) {
    if (!it.group) continue;
    if (it.kind === 'polyline') {
      for (let i = 0; i + 3 < it.points.length; i += 2) offer(it.group, false, segmentDistance(p, [it.points[i]!, it.points[i + 1]!], [it.points[i + 2]!, it.points[i + 3]!]));
      if (it.closed && it.points.length >= 4) offer(it.group, false, segmentDistance(p, [it.points[it.points.length - 2]!, it.points[it.points.length - 1]!], [it.points[0]!, it.points[1]!]));
    } else {
      const b = itemsBounds([it]);
      if (!b) continue;
      const inside = p[0] >= b.x0 - 0.5 && p[0] <= b.x1 + 0.5 && p[1] >= b.y0 - 0.5 && p[1] <= b.y1 + 0.5;
      if (inside) offer(it.group, true, 0);
    }
  }
  const found = best as { id: string; text: boolean } | null;
  return found && { id: found.id, text: found.text };
}

/** What the pointer does to a dimension that is dragged: the changes to make, from where the pointer is (sheet mm). */
export function dragDimension(handle: DimensionHandle, onText: boolean, p: P2): { offset?: number; slide?: number; angle?: number; leader?: number; arc?: number } {
  if (handle.kind === 'linear') {
    if (onText) return { slide: Math.round((handle.u[0] * (p[0] - handle.mid[0]) + handle.u[1] * (p[1] - handle.mid[1])) * 100) / 100 };
    return { offset: Math.round(offsetAt(handle, p) * 100) / 100 };
  }
  if (handle.kind === 'round') {
    const g = leaderAt(handle, p);
    return { angle: Math.round(g.angle * 10) / 10, leader: Math.round(g.leader * 100) / 100 };
  }
  if (onText) {
    let turn = Math.atan2(p[1] - handle.centre[1], p[0] - handle.centre[0]) - handle.mid;
    while (turn > Math.PI) turn -= 2 * Math.PI;
    while (turn <= -Math.PI) turn += 2 * Math.PI;
    return { slide: Math.round(turn * handle.radius * 100) / 100 };
  }
  return { arc: Math.round(arcAt(handle, p) * 100) / 100 };
}

/**
 * The dimension that is made from the elements the user pointed at (one or two, in the order they were pointed at) and the place they pointed at to put it (sheet mm): its
 * kind from the elements (a circle alone is a diameter, an arc a radius; two planes or a plane and a circle are a distance; two lines that are not parallel are an angle),
 * and where it goes from the pointer: which way a distance runs and how far its line is from the view, the direction of a leader, the radius of an arc. The elements are
 * given as facts as well, so that it can be drawn at once. `need` says what is missing; `error` why this cannot be.
 */
export type Plan = { draft: DimensionDraft; refs: Pickable[]; facts: ElementFacts[] } | { need: 'second' } | { error: string };

export function planDimension(picks: readonly Pickable[], p: P2, placed: PlacedView, axes: ViewAxes): Plan {
  const facts = picks.map((f) => factsOf(f, axes));
  const box = { left: placed.at[0] - placed.w / 2, right: placed.at[0] + placed.w / 2, bottom: placed.at[1] - placed.h / 2, top: placed.at[1] + placed.h / 2 };
  const sheetOf = (x: number, y: number): P2 => toSheet(placed, x, y);
  if (picks.length === 0) return { need: 'second' };
  if (picks.length === 1 && picks[0]!.type === 'edge') {
    // a straight edge alone: its length, between its two ends (SolidWorks): along x or y when it lies so on the sheet, else along itself
    const e = picks[0]!;
    if (!e.ends[0] || !e.ends[1]) return { need: 'second' };
    const ends: Pickable[] = [{ type: 'vertex', ref: e.ends[0], at: e.a, depth: e.depth }, { type: 'vertex', ref: e.ends[1], at: e.b, depth: e.depth }];
    const dx = Math.abs(e.b[0] - e.a[0]);
    const dy = Math.abs(e.b[1] - e.a[1]);
    const orientation = dy < 1e-6 ? 'horizontal' : dx < 1e-6 ? 'vertical' : 'aligned';
    const plan = linearDraft(ends[0]!, ends[1]!, orientation, p, placed, box, sheetOf);
    return 'error' in plan ? plan : { draft: plan.draft, refs: ends, facts: ends.map((f) => factsOf(f, axes)) };
  }
  if (picks.length === 1) {
    const f = picks[0]!;
    // a fillet is measured from its arc and always as a radius: the R of a torus is the tube's, and there is no diameter to write for it
    if (f.type === 'torus') {
      const c = sheetOf(f.at[0], f.at[1]);
      const g = leaderAt({ kind: 'round', centre: c, radius: f.radius * placed.scale }, p);
      return { draft: { kind: 'radius', ref: f.ref, angle: Math.round(g.angle * 10) / 10, leader: Math.round(g.leader * 100) / 100 }, refs: [f], facts };
    }
    if (f.type !== 'circle') return { need: 'second' };
    const c = sheetOf(f.centre[0], f.centre[1]);
    const g = leaderAt({ kind: 'round', centre: c, radius: f.radius * placed.scale }, p);
    const angle = Math.round(g.angle * 10) / 10;
    const leader = Math.round(g.leader * 100) / 100;
    return { draft: f.full ? { kind: 'diameter', ref: f.ref, angle, leader } : { kind: 'radius', ref: f.ref, angle, leader }, refs: [f], facts };
  }
  // a straight edge measured with something else is the line it lies on: square to x or y, it is as a plane seen edge-on there; otherwise a slanted line
  const asLine = (f: Pickable): Pickable => {
    if (f.type !== 'edge') return f;
    const dx = f.b[0] - f.a[0];
    const dy = f.b[1] - f.a[1];
    if (Math.abs(dx) < 1e-6) return { type: 'plane', ref: f.ref, axis: 'x', coord: f.a[0], area: 0 };
    if (Math.abs(dy) < 1e-6) return { type: 'plane', ref: f.ref, axis: 'y', coord: f.a[1], area: 0 };
    const l = hyp(dx, dy);
    return { type: 'slant', ref: f.ref, at: [(f.a[0] + f.b[0]) / 2, (f.a[1] + f.b[1]) / 2], dir: [dx / l, dy / l], area: 0 };
  };
  const original = picks as [Pickable, Pickable];
  // an angle is measured truly only between edges that lie in the sheet's plane; one that does not is seen foreshortened, and its angle would be a false number
  if (original.some((f) => f.type === 'edge' && !f.inPlane) && original.every((f) => f.type === 'edge' || f.type === 'plane' || f.type === 'slant')) {
    const la = asLine(original[0]);
    const lb = asLine(original[1]);
    if (!(la.type === 'plane' && lb.type === 'plane' && la.axis === lb.axis)) return { error: t('drawing.dimNotEdgeOn') };
  }
  const [a, b] = original.map(asLine) as [Pickable, Pickable];
  // a fillet is only ever measured on its own. An arc has no place to measure a distance from or an angle to — its own `at` is a drawing position, not a feature of
  // the model — and inventing one would put a number on the sheet that nothing in the part stands behind
  if (a.type === 'torus' || b.type === 'torus') return { error: t('drawing.dimTorusAlone') };
  const isLine = (f: Pickable) => f.type === 'plane' || f.type === 'slant';
  const planesOnly = a.type === 'plane' && b.type === 'plane';
  const sameAxis = planesOnly && a.axis === b.axis;
  // an angle: two lines that are not parallel (a slanted one, or a plane across x and one across y)
  if (isLine(a) && isLine(b) && !sameAxis) {
    const line = (f: Pickable): { at: P2; dir: P2 } => (f.type === 'plane' ? (f.axis === 'x' ? { at: [f.coord, 0], dir: [0, 1] } : { at: [0, f.coord], dir: [1, 0] }) : f.type === 'slant' ? { at: f.at, dir: f.dir } : { at: [0, 0], dir: [1, 0] });
    const la = line(a);
    const lb = line(b);
    const den = la.dir[0] * lb.dir[1] - la.dir[1] * lb.dir[0];
    if (Math.abs(den) < 1e-9) return { error: t('drawing.dimParallel') };
    const w: P2 = [lb.at[0] - la.at[0], lb.at[1] - la.at[1]];
    const s = (w[0] * lb.dir[1] - w[1] * lb.dir[0]) / den;
    const meet = sheetOf(la.at[0] + la.dir[0] * s, la.at[1] + la.dir[1] * s);
    return { draft: { kind: 'angle', a: a.ref, b: b.ref, arc: Math.round(Math.max(3, hyp(p[0] - meet[0], p[1] - meet[1])) * 100) / 100 }, refs: [a, b], facts };
  }
  if (isLine(a) && isLine(b) && sameAxis) {
    // two planes square to the same axis: the distance across
  } else if (a.type === 'slant' || b.type === 'slant') {
    return { error: t('drawing.dimSlantCircle') };
  }
  // two points (a vertex and a vertex, or a vertex and a circle's middle): along x, along y, or the true distance between them, by where the pointer is
  if (a.type === 'vertex' || b.type === 'vertex') {
    const planeA = a.type === 'plane' ? a.axis : null;
    const planeB = b.type === 'plane' ? b.axis : null;
    let orientation: 'horizontal' | 'vertical' | 'aligned';
    if (planeA ?? planeB) orientation = (planeA ?? planeB) === 'x' ? 'horizontal' : 'vertical';
    else {
      const above = p[1] > box.top || p[1] < box.bottom;
      const beside = p[0] > box.right || p[0] < box.left;
      orientation = above && !beside ? 'horizontal' : beside && !above ? 'vertical' : 'aligned';
    }
    const plan = linearDraft(a, b, orientation, p, placed, box, sheetOf);
    return 'error' in plan ? plan : { draft: plan.draft, refs: original, facts: original.map((f) => factsOf(f, axes)) };
  }
  // a distance: along x between things across x, along y between things across y; between two circles, the way the pointer is out of the view
  let orientation: 'horizontal' | 'vertical';
  const planeAxis = (f: Pickable) => (f.type === 'plane' ? f.axis : null);
  const axisA = planeAxis(a);
  const axisB = planeAxis(b);
  if (axisA && axisB && axisA !== axisB) return { error: t('drawing.dimNotAcross') };
  if (axisA ?? axisB) orientation = (axisA ?? axisB) === 'x' ? 'horizontal' : 'vertical';
  else {
    const above = p[1] > box.top || p[1] < box.bottom;
    const beside = p[0] > box.right || p[0] < box.left;
    orientation = above && !beside ? 'horizontal' : beside && !above ? 'vertical' : Math.abs(coordOf(a, 0) - coordOf(b, 0)) >= Math.abs(coordOf(a, 1) - coordOf(b, 1)) ? 'horizontal' : 'vertical';
  }
  const k = orientation === 'horizontal' ? 0 : 1;
  if (Math.abs(coordOf(a, k) - coordOf(b, k)) < 1e-6) return { error: t('drawing.dimZero') };
  const pa = orientation === 'horizontal' ? sheetOf(coordOf(a, 0), 0) : sheetOf(0, coordOf(a, 1));
  const pb = orientation === 'horizontal' ? sheetOf(coordOf(b, 0), 0) : sheetOf(0, coordOf(b, 1));
  const handle: Extract<DimensionHandle, { kind: 'linear' }> = { kind: 'linear', orientation, mid: [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2], u: orientation === 'horizontal' ? [1, 0] : [0, 1], box, a: pa, b: pb };
  const offset = Math.round(offsetAt(handle, p) * 100) / 100;
  return { draft: { kind: 'linear', a: a.ref, b: b.ref, orientation, offset }, refs: [a, b], facts };
}

/** The point an element stands for in a distance measured to it: a vertex itself, a circle's middle, a plane's coordinate on its axis (the other one 0). */
const pointOf = (f: Pickable): P2 => (f.type === 'vertex' ? f.at : f.type === 'circle' ? f.centre : f.type === 'plane' ? (f.axis === 'x' ? [f.coord, 0] : [0, f.coord]) : f.type === 'slant' ? f.at : f.type === 'torus' ? f.at : [(f.a[0] + f.b[0]) / 2, (f.a[1] + f.b[1]) / 2]);

/** A linear dimension between two elements along x, y or (two points) the line between them, its line where the pointer is. */
function linearDraft(a: Pickable, b: Pickable, orientation: 'horizontal' | 'vertical' | 'aligned', p: P2, placed: PlacedView, box: { left: number; right: number; bottom: number; top: number }, sheetOf: (x: number, y: number) => P2): { draft: DimensionDraft } | { error: string } {
  const A = pointOf(a);
  const B = pointOf(b);
  if (orientation === 'aligned' && (a.type === 'plane' || b.type === 'plane')) return { error: t('drawing.dimNotAcross') };
  const k = orientation === 'horizontal' ? 0 : 1;
  if (orientation === 'aligned' ? hyp(B[0] - A[0], B[1] - A[1]) < 1e-6 : Math.abs(A[k] - B[k]) < 1e-6) return { error: t('drawing.dimZero') };
  const pa = orientation === 'horizontal' ? sheetOf(A[0], a.type === 'plane' ? 0 : A[1]) : orientation === 'vertical' ? sheetOf(a.type === 'plane' ? 0 : A[0], A[1]) : sheetOf(A[0], A[1]);
  const pb = orientation === 'horizontal' ? sheetOf(B[0], b.type === 'plane' ? 0 : B[1]) : orientation === 'vertical' ? sheetOf(b.type === 'plane' ? 0 : B[0], B[1]) : sheetOf(B[0], B[1]);
  const d: P2 = [pb[0] - pa[0], pb[1] - pa[1]];
  const l = hyp(d[0], d[1]) || 1;
  const u: P2 = orientation === 'horizontal' ? [1, 0] : orientation === 'vertical' ? [0, 1] : [d[0] / l, d[1] / l];
  const handle: Extract<DimensionHandle, { kind: 'linear' }> = { kind: 'linear', orientation, mid: [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2], u, box, a: pa, b: pb };
  void placed;
  return { draft: { kind: 'linear', a: a.ref, b: b.ref, orientation, offset: Math.round(offsetAt(handle, p) * 100) / 100 } };
}

/** Where an element is along x (k = 0) or y (k = 1) of its view: a plane at its coordinate, a circle at its middle, a slanted face at its middle. */
const coordOf = (f: Pickable, k: 0 | 1): number => (f.type === 'plane' ? (f.axis === (k === 0 ? 'x' : 'y') ? f.coord : 0) : f.type === 'circle' ? f.centre[k] : f.type === 'edge' ? (f.a[k] + f.b[k]) / 2 : f.at[k]);

// ---------------------------------------------------------------- choosing several at once (D-I1a, ADR 0130)

/** A rectangle of the sheet (mm), its corners in any order. */
export interface SheetRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * The box dragged from `from` to `to` on the sheet, and how it chooses, as SolidWorks does: dragged to the right it is a window (what lies wholly inside is
 * chosen), dragged to the left a crossing (what it touches is chosen too). A point that is not a finite number is refused: a box made of it would choose
 * nothing or everything, and neither is what the pointer did.
 */
export function selectionBox(from: P2, to: P2): { rect: SheetRect; crossing: boolean } {
  if (![...from, ...to].every(Number.isFinite)) throw new Error(t('drawing.badPosition'));
  return { rect: { x0: Math.min(from[0], to[0]), y0: Math.min(from[1], to[1]), x1: Math.max(from[0], to[0]), y1: Math.max(from[1], to[1]) }, crossing: to[0] < from[0] };
}

const inside = (r: SheetRect, x: number, y: number) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;

/** Whether the segment from a to b has a point in the rectangle (Liang–Barsky clipping). */
export function segmentTouches(r: SheetRect, a: P2, b: P2): boolean {
  if (inside(r, a[0], a[1]) || inside(r, b[0], b[1])) return true;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [[-dx, a[0] - r.x0], [dx, r.x1 - a[0]], [-dy, a[1] - r.y0], [dy, r.y1 - a[1]]] as const) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const k = q / p;
    if (p < 0) t0 = Math.max(t0, k);
    else t1 = Math.min(t1, k);
    if (t0 > t1) return false;
  }
  return true;
}

/** Whether what a set of scene items draws lies wholly in the rectangle (`crossing` false) or touches it (`crossing` true). Texts count by their boxes. */
export function itemsInBox(items: readonly SceneItem[], r: SheetRect, crossing: boolean): boolean {
  if (items.length === 0) return false;
  for (const it of items) {
    if (it.kind === 'polyline') {
      const n = it.points.length / 2;
      const pt = (i: number): P2 => [it.points[2 * (i % n)]!, it.points[2 * (i % n) + 1]!];
      if (crossing) {
        if (n === 1 && inside(r, ...pt(0))) return true;
        for (let i = 0; i + 1 < n + (it.closed ? 1 : 0); i++) if (segmentTouches(r, pt(i), pt(i + 1))) return true;
      } else for (let i = 0; i < n; i++) if (!inside(r, ...pt(i))) return false;
    } else {
      const b = itemsBounds([it]);
      if (!b) continue;
      if (crossing) {
        if (b.x0 <= r.x1 && b.x1 >= r.x0 && b.y0 <= r.y1 && b.y1 >= r.y0) return true;
      } else if (!(inside(r, b.x0, b.y0) && inside(r, b.x1, b.y1))) return false;
    }
  }
  return !crossing;
}

/** The ids of the dimensions (scene items grouped by `group`) a box chooses, in the order they are first drawn. */
export function dimensionsInBox(items: readonly SceneItem[], r: SheetRect, crossing: boolean): string[] {
  const groups = new Map<string, SceneItem[]>();
  for (const it of items) if (it.group) groups.set(it.group, [...(groups.get(it.group) ?? []), it]);
  return [...groups].filter(([, g]) => itemsInBox(g, r, crossing)).map(([id]) => id);
}

/** Whether a box of the sheet (a table's, a symbol's) is chosen by the rectangle: wholly inside it, or (crossing) overlapping it. */
export function rectInBox(b: { x: number; y: number; w: number; h: number }, r: SheetRect, crossing: boolean): boolean {
  return crossing ? b.x <= r.x1 && b.x + b.w >= r.x0 && b.y <= r.y1 && b.y + b.h >= r.y0 : inside(r, b.x, b.y) && inside(r, b.x + b.w, b.y + b.h);
}

/**
 * Where a cutting line drawn at `coord` (along the view's x for a vertical line, its y for a horizontal one, in view coordinates at full size) snaps to (D-V), as
 * SolidWorks infers it: the middle of a circle, an edge-on plane, or the middle of the view's box, whichever is nearest within `tol`; else `coord` itself.
 */
export function snapCut(features: readonly ViewFeature[], box: { min: [number, number]; max: [number, number] } | null, coord: number, vertical: boolean, tol: number): { coord: number; snapped: boolean } {
  if (!Number.isFinite(coord)) throw new Error(t('drawing.badPosition'));
  const k = vertical ? 0 : 1;
  const candidates: number[] = [];
  for (const f of features) {
    if (f.type === 'circle') candidates.push(f.centre[k]);
    else if (f.type === 'plane' && f.axis === (vertical ? 'x' : 'y')) candidates.push(f.coord);
  }
  if (box) candidates.push((box.min[k] + box.max[k]) / 2);
  let best: number | null = null;
  for (const c of candidates) if (Math.abs(c - coord) <= tol && (best === null || Math.abs(c - coord) < Math.abs(best - coord))) best = c;
  return best === null ? { coord, snapped: false } : { coord: best, snapped: true };
}
