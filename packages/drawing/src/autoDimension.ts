import type { Dimension, ViewFeature } from '@3db/model';
import { holeSignature } from './dimension';

/** A dimension before it has an id and a view. */
export type DimensionDraft = Dimension extends infer D ? (D extends Dimension ? Omit<D, 'id' | 'view'> : never) : never;

export interface AutoDimensionOptions {
  /** Hole callouts: what the model says of each hole (through, how deep, counterbore) is written after its diameter. */
  callouts?: boolean;
  /** The overall width and height of the view. */
  overall: boolean;
  /** The diameter of every hole and the radius of every arc — a fillet's included, and one dimension per fillet however many times the view cuts its tube. */
  holes: boolean;
  /** Where each hole is, from the left side and from the bottom of the view. */
  positions: boolean;
  /**
   * The places of the holes as ordinate dimensions (D-I4): one along x and one along y from the left and the bottom planes, the far planes with them (so they
   * give the overall size too) — in place of a linear dimension for each.
   */
  ordinate?: boolean;
}

/** The distance from the view to the first dimension line, and between dimension lines (mm on the sheet). */
export const FIRST_OFFSET = 10;
export const OFFSET_STEP = 7;

const TOL = 1e-6;
type Plane = Extract<ViewFeature, { type: 'plane' }>;
type Circle = Extract<ViewFeature, { type: 'circle' }>;
type Torus = Extract<ViewFeature, { type: 'torus' }>;

/** The planes that bound a view: the lowest and highest square to its x and to its y (null where there is none). */
export function datumPlanes(features: readonly ViewFeature[]): { minX: Plane | null; maxX: Plane | null; minY: Plane | null; maxY: Plane | null } {
  const planes = features.filter((f): f is Plane => f.type === 'plane');
  return { minX: extreme(planes, 'x', false), maxX: extreme(planes, 'x', true), minY: extreme(planes, 'y', false), maxY: extreme(planes, 'y', true) };
}

/** The plane at the end of the view along an axis: the lowest or the highest, and of those at the same place the biggest. */
function extreme(planes: Plane[], axis: 'x' | 'y', high: boolean): Plane | null {
  const on = planes.filter((p) => p.axis === axis);
  if (on.length === 0) return null;
  const best = Math.max(...on.map((p) => (high ? p.coord : -p.coord)));
  const there = on.filter((p) => Math.abs((high ? p.coord : -p.coord) - best) < TOL);
  return there.reduce((a, b) => (b.area > a.area ? b : a));
}

/**
 * The dimensions a view is given when asked for them all (C16.4): its overall width and height between the planes that bound it, the diameter of each
 * hole and the radius of each arc — a fillet's too, one per fillet — and where each hole is from the left and the bottom planes. Horizontal dimensions go
 * below the view and vertical ones to its right, the ones that stand for a hole nearest it and the overall ones outermost. A dimension that cannot be made
 * (no plane bounds the view that way) is left out.
 */
export function autoDimensions(features: readonly ViewFeature[], options: AutoDimensionOptions): DimensionDraft[] {
  const circles = features.filter((f): f is Circle => f.type === 'circle');
  const { minX, maxX, minY, maxY } = datumPlanes(features);
  const out: DimensionDraft[] = [];

  if (options.holes) {
    // equal circles are one dimension with their count (with callouts, only those the callout says the same of: a countersunk Ø6 is not a dowel Ø6)
    const groups = new Map<string, Circle[]>();
    for (const c of circles) {
      const key = `${c.full}|${c.convex}|${Math.round(c.radius * 1e4)}|${options.callouts && c.full ? holeSignature(c.hole) : ''}`;
      groups.set(key, [...(groups.get(key) ?? []), c]);
    }
    for (const g of groups.values()) {
      const first = g[0]!;
      const count = g.length > 1 ? { count: g.length } : {};
      const callout = options.callouts && first.hole ? { callout: true } : {};
      out.push(first.full ? { kind: 'diameter', ref: first.ref, angle: first.outward, ...count, ...callout } : { kind: 'radius', ref: first.ref, angle: first.outward, ...count });
    }
    // A fillet is one radius per *face*, and a face gives the view two features — the tube is cut once either side of its axis — so the faces are collected first
    // and counted, not the features. Counting features would write 「2×R0.2」 for a single fillet, which is the opposite of what is true.
    const faces = new Map<string, Torus>();
    for (const f of features) if (f.type === 'torus') faces.set(f.ref.name, faces.get(f.ref.name) ?? f);
    // a concave fillet and a convex round of the same R are different callouts, and neither is grouped with a cylinder's arc: the same number written for a
    // different kind of edge is not the same dimension
    const filletGroups = new Map<string, Torus[]>();
    for (const f of faces.values()) {
      const key = `${f.convex}|${Math.round(f.radius * 1e4)}`;
      filletGroups.set(key, [...(filletGroups.get(key) ?? []), f]);
    }
    for (const g of filletGroups.values()) {
      const first = g[0]!;
      out.push({ kind: 'radius', ref: first.ref, angle: first.outward, ...(g.length > 1 ? { count: g.length } : {}) });
    }
  }

  const horizontal: DimensionDraft[] = [];
  const vertical: DimensionDraft[] = [];
  if (options.positions) {
    const whole = circles.filter((c) => c.full);
    // a hole on the datum plane is at 0 from it and needs no dimension; holes at the same distance share one
    const distinct = (axis: 0 | 1, datum: Plane | null) => {
      const seen: { at: number; c: Circle }[] = [];
      if (datum) for (const c of whole) if (Math.abs(c.centre[axis] - datum.coord) > TOL && !seen.some((s) => Math.abs(s.at - c.centre[axis]) < TOL)) seen.push({ at: c.centre[axis], c });
      return seen.sort((a, b) => a.at - b.at);
    };
    if (options.ordinate) {
      // one ordinate dimension each way: the holes in order, the far plane last
      const xs = minX ? distinct(0, minX).filter((s) => !maxX || Math.abs(s.at - maxX.coord) > TOL) : [];
      const ys = minY ? distinct(1, minY).filter((s) => !maxY || Math.abs(s.at - maxY.coord) > TOL) : [];
      if (minX && (xs.length > 0 || maxX)) out.push({ kind: 'ordinate', axis: 'x', origin: minX.ref, refs: [...xs.map((s) => s.c.ref), ...(maxX && Math.abs(maxX.coord - minX.coord) > TOL ? [maxX.ref] : [])], offset: -FIRST_OFFSET });
      if (minY && (ys.length > 0 || maxY)) out.push({ kind: 'ordinate', axis: 'y', origin: minY.ref, refs: [...ys.map((s) => s.c.ref), ...(maxY && Math.abs(maxY.coord - minY.coord) > TOL ? [maxY.ref] : [])], offset: FIRST_OFFSET });
    } else {
      if (minX) for (const s of distinct(0, minX)) horizontal.push({ kind: 'linear', a: minX.ref, b: s.c.ref, orientation: 'horizontal', offset: 0 });
      if (minY) for (const s of distinct(1, minY)) vertical.push({ kind: 'linear', a: minY.ref, b: s.c.ref, orientation: 'vertical', offset: 0 });
    }
  }
  // with the ordinates the overall size is written already (their far planes), and an overall dimension would only repeat it
  if (options.overall && !(options.positions && options.ordinate)) {
    if (minX && maxX && Math.abs(maxX.coord - minX.coord) > TOL) horizontal.push({ kind: 'linear', a: minX.ref, b: maxX.ref, orientation: 'horizontal', offset: 0 });
    if (minY && maxY && Math.abs(maxY.coord - minY.coord) > TOL) vertical.push({ kind: 'linear', a: minY.ref, b: maxY.ref, orientation: 'vertical', offset: 0 });
  }
  // stacked outward in the order made: the holes' first, the overall one last
  horizontal.forEach((d, i) => out.push({ ...d, offset: -(FIRST_OFFSET + i * OFFSET_STEP) } as DimensionDraft));
  vertical.forEach((d, i) => out.push({ ...d, offset: FIRST_OFFSET + i * OFFSET_STEP } as DimensionDraft));
  return out;
}
