import { t } from '@3db/i18n';
import { biarcEnvelope, endTangents } from './section-envelope';
import { KernelError, type HomogeneousPole, type SectionEdge } from './types';

type Point = [number, number];
type NativeEdge = Extract<SectionEdge, { kind: 'line' | 'arc' }>;
type AnalyticEdge = NativeEdge | Extract<SectionEdge, { kind: 'circle' }>;
const SOURCE_LIMIT = 1000;
const EDGE_LIMIT = 10000;
const FIT_TOLERANCE = 2e-6;

/** OCCT can give the analytic and spline trims of a shared vertex slightly different coordinates. */
function joinPole(pole: HomogeneousPole, native: NativeEdge[]): { pole: HomogeneousPole; shift: number } {
  const [x, y, , w] = pole;
  let nearest: Point | undefined;
  let shift = 2e-7;
  for (const { a, b } of native) {
    for (const point of [a, b]) {
      const distance = Math.hypot(point[0] - x / w, point[1] - y / w);
      if (distance <= shift) {
        nearest = point;
        shift = distance;
      }
    }
  }
  return nearest ? { pole: [nearest[0] * w, nearest[1] * w, 0, w], shift } : { pole, shift: 0 };
}

function tangent(edge: NativeEdge, point: Point): Point {
  if (edge.kind === 'line') return [edge.b[0] - edge.a[0], edge.b[1] - edge.a[1]];
  return [edge.c[1] - point[1], point[0] - edge.c[0]];
}

/** Match the neighbouring native edge tangent where a spline meets it almost tangentially. */
function snapped(point: Point, direction: Point, native: NativeEdge[]): Point | undefined {
  for (const edge of native) {
    if (![edge.a, edge.b].some((end) => Math.hypot(point[0] - end[0], point[1] - end[1]) <= 1e-7)) continue;
    const [x, y] = tangent(edge, point);
    const dot = direction[0] * x + direction[1] * y;
    const cross = direction[0] * y - direction[1] * x;
    if (Math.abs(Math.atan2(Math.abs(cross), Math.abs(dot))) >= 1e-2) continue;
    const length = Math.hypot(x, y);
    if (length > 0) {
      const sign = Math.sign(dot);
      return [sign * x / length, sign * y / length];
    }
  }
}

export function approximateSection(source: SectionEdge[]): { edges: AnalyticEdge[]; approximationBound: number } {
  const count = source.reduce((sum, edge) => sum + (edge.kind === 'bezier' ? edge.spans.length : 1), 0);
  if (count > SOURCE_LIMIT) throw new KernelError(t('sectionClearance.sourceLimit', { limit: SOURCE_LIMIT }));
  const native = source.filter((edge): edge is NativeEdge => edge.kind === 'line' || edge.kind === 'arc');
  const edges: AnalyticEdge[] = [];
  let approximationBound = 0;
  for (const edge of source) {
    if (edge.kind === 'other') throw new KernelError(t('sectionClearance.curve', { curve: edge.curve }));
    if (edge.kind !== 'bezier') {
      edges.push(edge);
      continue;
    }
    edge.spans.forEach((poles, i) => {
      const fitted = [...poles];
      const first = i === 0;
      const last = i === edge.spans.length - 1;
      const start = first ? joinPole(poles[0]!, native) : { pole: poles[0]!, shift: 0 };
      const end = last ? joinPole(poles.at(-1)!, native) : { pole: poles.at(-1)!, shift: 0 };
      fitted[0] = start.pole;
      fitted[fitted.length - 1] = end.pole;
      // Positive rational basis weights sum to one, so the largest pole displacement bounds the whole trim adjustment.
      const shift = Math.max(start.shift, end.shift);
      const ends = endTangents(poles);
      const fit = biarcEnvelope(fitted, FIT_TOLERANCE - shift, {
        t0: first ? snapped([start.pole[0] / start.pole[3], start.pole[1] / start.pole[3]], ends.t0, native) : undefined,
        t1: last ? snapped([end.pole[0] / end.pole[3], end.pole[1] / end.pole[3]], ends.t1, native) : undefined,
      });
      approximationBound = Math.max(approximationBound, fit.maxBound + shift);
      if (edges.length + fit.pieces.length > EDGE_LIMIT) throw new KernelError(t('sectionClearance.edgeLimit', { limit: EDGE_LIMIT }));
      for (const piece of fit.pieces) {
        const { from: [ax, ay], mid: [mx, my], to: [bx, by] } = piece;
        const a: Point = [ax, ay];
        const b: Point = [bx, by];
        if (Math.hypot(bx - ax, by - ay) < 1e-7) throw new KernelError(t('sectionClearance.resolution'));
        if (piece.kind === 'line') {
          edges.push({ kind: 'line', a, b });
          continue;
        }
        const ux = mx - ax;
        const uy = my - ay;
        const vx = bx - ax;
        const vy = by - ay;
        const det = 2 * (ux * vy - uy * vx);
        if (det === 0) throw new KernelError(t('sectionClearance.degenerate'));
        const u2 = ux * ux + uy * uy;
        const v2 = vx * vx + vy * vy;
        const x = (u2 * vy - v2 * uy) / det;
        const y = (ux * v2 - vx * u2) / det;
        edges.push({ kind: 'arc', a, b, mid: [mx, my], c: [ax + x, ay + y], r: Math.hypot(x, y) });
      }
    });
  }
  if (edges.length > EDGE_LIMIT) throw new KernelError(t('sectionClearance.edgeLimit', { limit: EDGE_LIMIT }));
  return { edges, approximationBound };
}
