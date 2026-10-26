import type { DrawingRef, Ref, ViewEdgeSet, ViewFeature } from '@3db/model';
import type { ViewLines } from './layout';

/**
 * Which edges and vertices of a part a view shows (D-I2, ADR 0138), decided against the view's own lines — hidden-line removal stays the only judge of what is
 * drawn. The worker gives every edge and vertex by name, projected (`viewEdges` in @3db/regen); one is seen where it lies on a visible line of the view.
 * Several that are one place on the sheet (the near and far edges of a box seen square) are one there, and the nearest the viewer is kept: it is the one drawn.
 */

type P2 = [number, number];

/** A straight edge of the model seen as a line: its ends in the view (full size), the names of the vertices there, and whether it lies in the sheet's plane. */
export type EdgePick = { type: 'edge'; ref: Ref; a: P2; b: P2; ends: [Ref | null, Ref | null]; inPlane: boolean; depth: number };
/** A vertex of the model the view shows. */
export type VertexPick = { type: 'vertex'; ref: DrawingRef; at: P2; depth: number };
/** A circular edge seen in its true shape, as a circle that can be measured (its reference is the edge's). */
export type CircleEdgePick = Extract<ViewFeature, { type: 'circle' }>;

export interface VisibleElements {
  edges: EdgePick[];
  circles: CircleEdgePick[];
  vertices: VertexPick[];
}

/** How far (mm, full size) a point of an edge may be from a visible line and still be on it: the mesh's and the hidden-line removal's chords together. */
export const EDGE_TOLERANCE = 0.08;
/** The share of an edge that has to be on visible lines for it to be seen. */
const SEEN_SHARE = 0.25;

/** A grid of the segments of the visible lines, for asking which are near a point without looking at every one. */
function segmentGrid(lines: readonly number[][], cell: number) {
  const cells = new Map<string, number[][]>();
  const key = (i: number, j: number) => `${i},${j}`;
  for (const l of lines)
    for (let k = 0; k + 3 < l.length; k += 2) {
      const seg = [l[k]!, l[k + 1]!, l[k + 2]!, l[k + 3]!];
      const [i0, i1] = [Math.floor(Math.min(seg[0]!, seg[2]!) / cell), Math.floor(Math.max(seg[0]!, seg[2]!) / cell)];
      const [j0, j1] = [Math.floor(Math.min(seg[1]!, seg[3]!) / cell), Math.floor(Math.max(seg[1]!, seg[3]!) / cell)];
      for (let i = i0; i <= i1; i++)
        for (let j = j0; j <= j1; j++) {
          const list = cells.get(key(i, j));
          if (list) list.push(seg);
          else cells.set(key(i, j), [seg]);
        }
    }
  /** The distance from (x, y) to the nearest segment within `tol`, or Infinity. */
  return (x: number, y: number, tol: number): number => {
    let best = Infinity;
    for (let i = Math.floor((x - tol) / cell); i <= Math.floor((x + tol) / cell); i++)
      for (let j = Math.floor((y - tol) / cell); j <= Math.floor((y + tol) / cell); j++)
        for (const s of cells.get(key(i, j)) ?? []) {
          const dx = s[2]! - s[0]!;
          const dy = s[3]! - s[1]!;
          const l2 = dx * dx + dy * dy;
          const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - s[0]!) * dx + (y - s[1]!) * dy) / l2));
          best = Math.min(best, Math.hypot(x - s[0]! - t * dx, y - s[1]! - t * dy));
        }
    return best;
  };
}

/**
 * The edges, circles and vertices of `set` a view with these lines shows. `faceCircles` are the circles the view's features already give (the cylinders seen
 * along their axes): a circular edge on one of them is that circle again and is left out, so that a hole is measured through its face, with its callout.
 */
export function visibleElements(lines: ViewLines | null | undefined, set: ViewEdgeSet | null | undefined, faceCircles: readonly ViewFeature[] = [], tol = EDGE_TOLERANCE): VisibleElements {
  const out: VisibleElements = { edges: [], circles: [], vertices: [] };
  if (!lines || !set || (lines.visible.length === 0 && (!lines.tangent || lines.tangent.length === 0))) return out;
  if (!(Number.isFinite(tol) && tol > 0)) throw new Error(`visibleElements: tolerance ${tol} is not a length`);
  const box = lines.box;
  const extent = box ? Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1], 1) : 100;
  const allVisible = lines.tangent && lines.tangent.length > 0 ? [...lines.visible, ...lines.tangent] : lines.visible;
  const near = segmentGrid(allVisible, Math.max(tol * 8, extent / 64));
  const on = (x: number, y: number) => near(x, y, tol) <= tol;
  /** The share of an edge's polyline (each segment sampled) on visible lines. */
  const seen = (pts: readonly number[]): number => {
    let hit = 0;
    let all = 0;
    for (let k = 0; k + 3 < pts.length; k += 2)
      for (let s = 0; s < 8; s++) {
        const t = s / 8;
        all++;
        if (on(pts[k]! + (pts[k + 2]! - pts[k]!) * t, pts[k + 1]! + (pts[k + 3]! - pts[k + 1]!) * t)) hit++;
      }
    if (pts.length >= 2) {
      all++;
      if (on(pts[pts.length - 2]!, pts[pts.length - 1]!)) hit++;
    }
    return all === 0 ? 0 : hit / all;
  };
  const meanDepth = (d: readonly number[]) => d.reduce((a, b) => a + b, 0) / Math.max(1, d.length);
  const cellOf = (p: P2) => `${Math.round(p[0] / tol)},${Math.round(p[1] / tol)}`;
  const lineKey = (a: P2, b: P2) => {
    const [p, q] = a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]) ? [a, b] : [b, a];
    return `${cellOf(p)}|${cellOf(q)}`;
  };
  const lineAt = new Map<string, EdgePick>();
  for (const e of set.edges) {
    if (e.points.length < 4 || seen(e.points) < SEEN_SHARE) continue;
    if (e.kind === 'line') {
      const a: P2 = [e.points[0]!, e.points[1]!];
      const b: P2 = [e.points[e.points.length - 2]!, e.points[e.points.length - 1]!];
      // an edge along the view's direction is a point: its vertex is what is picked there
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < tol) continue;
      const pick: EdgePick = { type: 'edge', ref: e.ref, a, b, ends: e.ends, inPlane: !!e.inPlane, depth: meanDepth(e.depth) };
      const k = lineKey(a, b);
      const was = lineAt.get(k);
      if (!was || pick.depth > was.depth) lineAt.set(k, pick);
    } else if (e.kind === 'circle' && e.circle) {
      const { centre, radius } = e.circle;
      const same = (c: { centre: P2; radius: number }) => Math.abs(c.radius - radius) < 1e-6 && Math.hypot(c.centre[0] - centre[0], c.centre[1] - centre[1]) < 1e-6;
      if (faceCircles.some((f) => f.type === 'circle' && same(f)) || out.circles.some(same)) continue;
      const n = e.points.length;
      const full = Math.hypot(e.points[0]! - e.points[n - 2]!, e.points[1]! - e.points[n - 1]!) < tol;
      out.circles.push({ type: 'circle', ref: e.ref, centre, radius, convex: true, full, outward: 45 });
    }
  }
  out.edges = [...lineAt.values()];
  const vertexAt = new Map<string, VertexPick>();
  for (const v of set.vertices) {
    if (!on(v.at[0], v.at[1])) continue;
    const k = cellOf(v.at);
    const was = vertexAt.get(k);
    if (!was || v.depth > was.depth) vertexAt.set(k, { type: 'vertex', ref: v.ref, at: v.at, depth: v.depth });
  }
  out.vertices = [...vertexAt.values()];
  // an edge kept is given the ends that are seen: where a near vertex hides a far one, the near one is what the end is on the sheet
  for (const e of out.edges) {
    const shown = (at: P2, r: Ref | null) => vertexAt.get(cellOf(at))?.ref ?? r;
    e.ends = [shown(e.a, e.ends[0]), shown(e.b, e.ends[1])];
  }
  return out;
}

/** Whether a polyline's first and last points are the same place: a whole circle (drawn closed). */
const closes = (pts: readonly number[], tol: number): boolean => pts.length >= 4 && Math.hypot(pts[0]! - pts[pts.length - 2]!, pts[1]! - pts[pts.length - 1]!) <= tol;

/** The distance from (x, y) to the nearest segment of the polyline `pts` (flat x, y pairs), along its closing segment too when it is closed. */
function distanceToPolyline(x: number, y: number, pts: readonly number[], tol: number): number {
  const n = pts.length / 2;
  const at = (i: number): P2 => [pts[2 * (i % n)]!, pts[2 * (i % n) + 1]!];
  const last = closes(pts, tol) ? n : n - 1;
  let best = Infinity;
  for (let i = 0; i < last; i++) {
    const a = at(i);
    const b = at(i + 1);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / l2));
    best = Math.min(best, Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy));
  }
  return best;
}

/**
 * The lines of a view without the lines of the edges it hides (B2.2): a polyline that lies on a hidden edge is that edge's line — what the viewer sees of
 * it — and hiding the edge means it is not drawn. `hidden` names the edges by their persistent name (in a view of an assembly, `in` says which part's).
 * The view's box is kept as it is: what the view spans does not change because a line of it is taken away.
 *
 * A polyline lies on an edge when every point sampled along it is on the edge's own polyline (within `EDGE_TOLERANCE`, as the mesh's and the hidden-line
 * removal's chords together allow). So the line of an edge split by the lines that cross it is taken away whole, while a neighbouring edge's line, which
 * runs on from where the hidden one ends, is not.
 */
export function withoutHiddenEdges(lines: ViewLines, set: ViewEdgeSet | null | undefined, hidden: readonly DrawingRef[], tol = EDGE_TOLERANCE): ViewLines {
  if (hidden.length === 0 || !set || set.edges.length === 0) return lines;
  const wanted = set.edges.filter((e) => hidden.some((h) => h.name === e.ref.name && (h.in ?? null) === (e.ref.in ?? null)));
  if (wanted.length === 0) return lines;
  const liesOn = (poly: readonly number[]): boolean =>
    wanted.some((e) => {
      const n = poly.length / 2;
      const at = (i: number): P2 => [poly[2 * (i % n)]!, poly[2 * (i % n) + 1]!];
      const last = closes(poly, tol) ? n : n - 1;
      for (let i = 0; i < last; i++) {
        const a = at(i);
        const b = at(i + 1);
        for (let s = 0; s <= 8; s++) {
          const t = s / 8;
          if (distanceToPolyline(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, e.points, tol) > tol) return false;
        }
      }
      return true;
    });
  const kept = (ls: readonly number[][]) => ls.filter((l) => !liesOn(l));
  const visible = kept(lines.visible);
  const hiddenLines = kept(lines.hidden);
  const tangent = lines.tangent ? kept(lines.tangent) : undefined;
  const tangentHidden = lines.tangentHidden ? kept(lines.tangentHidden) : undefined;
  if (
    visible.length === lines.visible.length &&
    hiddenLines.length === lines.hidden.length &&
    (lines.tangent === undefined || tangent?.length === lines.tangent.length) &&
    (lines.tangentHidden === undefined || tangentHidden?.length === lines.tangentHidden.length)
  ) return lines;
  return {
    ...lines,
    visible,
    hidden: hiddenLines,
    ...(lines.tangent !== undefined ? { tangent } : {}),
    ...(lines.tangentHidden !== undefined ? { tangentHidden } : {}),
  };
}
