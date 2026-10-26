import { t } from '@3db/i18n';
import { validProjectionRef, rightOf, sheetUp, type ElementFacts, type ProjectionRef, type ViewAxes } from '@3db/model';
import type { PlacedView, ViewLines } from './layout';
import { clipToBand } from './geometry';
import type { EdgePick, VertexPick } from './viewEdges';

type P = [number, number];
export type ProjectionEntity = { ref: ProjectionRef; points: number[]; straight: boolean };
const cache = new WeakMap<ViewLines, ProjectionEntity[]>();
const length = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Canonical full-size geometry is an identity signature, never the source of evaluated values. */
function canonical(poly: readonly number[]): { points: number[]; straight: boolean; name: string } | null {
  const pts: P[] = [];
  for (let i = 0; i + 1 < poly.length; i += 2) {
    const p: P = [poly[i]!, poly[i + 1]!];
    if (!p.every(Number.isFinite)) return null;
    if (!pts.length || length(pts.at(-1)!, p) > 1e-9) pts.push(p);
  }
  if (pts.length < 2) return null;
  const a = pts[0]!, b = pts.at(-1)!, len = length(a, b);
  const straight = len > 1e-9 && pts.every(p => Math.abs((p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])) / len < 1e-7);
  let path = straight ? [a, b] : pts;
  const closed = length(path[0]!, path.at(-1)!) < 1e-7;
  if (closed) path = path.slice(0, -1);
  const key = (p: P) => p.map(v => Math.round(v * 1e7));
  if (closed) {
    let first = 0;
    for (let i = 1; i < path.length; i++) {
      const p = key(path[i]!), q = key(path[first]!);
      if (p[0]! < q[0]! || (p[0] === q[0] && p[1]! < q[1]!)) first = i;
    }
    path = [...path.slice(first), ...path.slice(0, first)];
  }
  const backward = closed ? [path[0]!, ...path.slice(1).reverse()] : [...path].reverse();
  if (JSON.stringify(backward.map(key)) < JSON.stringify(path.map(key))) path = backward;
  if (closed) path = [...path, path[0]!];
  return { points: path.flat(), straight, name: 'projection:' + JSON.stringify(path.map(key)) };
}

export function projectionEntities(lines: ViewLines | null | undefined): ProjectionEntity[] {
  if (!lines) return [];
  const known = cache.get(lines);
  if (known) return known;
  const all = new Map<string, ProjectionEntity>();
  for (const poly of [...lines.visible, ...lines.hidden, ...(lines.tangent ?? []), ...(lines.tangentHidden ?? [])]) {
    const c = canonical(poly);
    if (c) all.set(c.name, { ref: { kind: 'projection', name: c.name }, points: c.points, straight: c.straight });
  }
  const out = [...all.values()];
  cache.set(lines, out);
  return out;
}

export function projectionPoint(e: ProjectionEntity, at: number): P {
  if (!Number.isFinite(at) || at < 0 || at > 1) throw new Error(t('drawing.dimBadRef'));
  const p = e.points, lengths: number[] = [];
  let total = 0;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const l = Math.hypot(p[i + 2]! - p[i]!, p[i + 3]! - p[i + 1]!);
    lengths.push(l);
    total += l;
  }
  let distance = at * total;
  for (let i = 0; i < lengths.length; i++) {
    const l = lengths[i]!;
    if (distance <= l || i === lengths.length - 1) {
      const t = l ? distance / l : 0;
      return [p[2 * i]! + t * (p[2 * i + 2]! - p[2 * i]!), p[2 * i + 1]! + t * (p[2 * i + 3]! - p[2 * i + 1]!)];
    }
    distance -= l;
  }
  return [p[0]!, p[1]!];
}

export function projectionFacts(ref: ProjectionRef, lines: ViewLines | null | undefined, axes: ViewAxes): ElementFacts | null {
  if (!validProjectionRef(ref)) return null;
  const e = projectionEntities(lines).find(e => e.ref.name === ref.name);
  if (!e) return null;
  const r = rightOf(axes), u = sheetUp(axes);
  const to = (p: P): [number, number, number] => r.map((v, i) => v * p[0] + u[i]! * p[1]) as [number, number, number];
  if (ref.at !== undefined) return { kind: 'vertex', type: 'point', point: to(projectionPoint(e, ref.at)) };
  if (!e.straight) return null;
  const a = projectionPoint(e, 0), b = projectionPoint(e, 1), l = length(a, b);
  return { kind: 'edge', type: 'line', point: to(projectionPoint(e, 0.5)), dir: to([(b[0] - a[0]) / l, (b[1] - a[1]) / l]) };
}

/** A fallback for actual projected contours, including generated section edges and freeform curves. */
export function projectedAt(lines: ViewLines | null | undefined, p: P, tol: number, snaps = true): EdgePick | VertexPick | null {
  if (!lines) return null;
  let best: { entity: ProjectionEntity; at: number; distance: number; point: P } | undefined;
  for (const entity of projectionEntities(lines)) {
    const poly = entity.points, lengths: number[] = [];
    let total = 0;
    for (let i = 0; i + 3 < poly.length; i += 2) {
      const l = Math.hypot(poly[i + 2]! - poly[i]!, poly[i + 3]! - poly[i + 1]!);
      lengths.push(l);
      total += l;
    }
    let before = 0;
    for (let i = 0; i < lengths.length; i++) {
      const a: P = [poly[2 * i]!, poly[2 * i + 1]!], b: P = [poly[2 * i + 2]!, poly[2 * i + 3]!], l = lengths[i]!;
      const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * (b[0] - a[0]) + (p[1] - a[1]) * (b[1] - a[1])) / (l * l))) : 0;
      const q: P = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], distance = length(p, q);
      if (distance <= tol && (!best || distance < best.distance)) best = { entity, at: total ? (before + t * l) / total : 0, distance, point: q };
      before += l;
    }
  }
  if (!best) return null;
  const { entity } = best;
  if (snaps) {
    let snap: { at: number; point: P; d: number } | undefined;
    for (const at of [0, 1, 0.5]) {
      const point = projectionPoint(entity, at), d = length(point, p);
      if (d <= tol && (!snap || d < snap.d)) snap = { at, point, d };
    }
    if (snap) return { type: 'vertex', ref: { ...entity.ref, at: snap.at }, at: snap.point, depth: 0, curve: entity.straight ? undefined : entity.points };
  }
  if (entity.straight) return { type: 'edge', ref: entity.ref, a: projectionPoint(entity, 0), b: projectionPoint(entity, 1), ends: [{ ...entity.ref, at: 0 }, { ...entity.ref, at: 1 }], inPlane: true, depth: 0 };
  return { type: 'vertex', ref: { ...entity.ref, at: best.at }, at: best.point, depth: 0, curve: entity.points };
}

/** Selection and evaluation share the same physical pieces of a broken view. */
export function projectionReferenceLines(lines: ViewLines | null | undefined, placed: PlacedView): ViewLines | null | undefined {
  const b = placed.break;
  if (!lines || !b) return lines;
  const clip = (polys: number[][] | undefined) => (polys ?? []).flatMap(p => clipToBand(p, b.axis, b.from, b.to));
  return { ...lines, visible: clip(lines.visible), hidden: clip(lines.hidden), tangent: clip(lines.tangent), tangentHidden: clip(lines.tangentHidden) };
}
