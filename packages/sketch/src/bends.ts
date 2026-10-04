import { t } from '@3db/i18n';
import type { P2, Segment2 } from './types';

/**
 * The profile of a bent sheet (C11.1, ADR 0084): a polyline of lines with the corners rounded where the sheet bends. The sheet is thickened to one side of the path
 * afterwards (`ribbonOf`, which moves every line and arc exactly), so the path has to be rounded with the radius of the side the path is on: at a corner turning toward
 * the side the thickness grows to, the path is the outside of the bend (radius `inner + thickness`); turning away, it is the inside (radius `inner`). Either way the
 * inside of the sheet has the radius asked for and the two faces of a bend are concentric.
 */

const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: P2, b: P2, k = 1): P2 => [a[0] + b[0] * k, a[1] + b[1] * k];
const len = (a: P2) => Math.hypot(a[0], a[1]);
const unit = (a: P2): P2 => [a[0] / len(a), a[1] / len(a)];
const perp = (a: P2): P2 => [-a[1], a[0]];
const cross = (a: P2, b: P2) => a[0] * b[1] - a[1] * b[0];
const dot = (a: P2, b: P2) => a[0] * b[0] + a[1] * b[1];

/** One bend of the path: where the corner was, how far the sheet turns, and the radius the path was rounded with (the inner radius of the sheet is `inner`). */
export interface Bend {
  /** The name the arc has in the path (`bend1`, `bend2`, …, in the order walked): the faces of the bend are named after it. */
  source: string;
  /** How far the sheet turns (radians, 0 to π). */
  angle: number;
  /** The radius the path itself was rounded with: `inner` or `inner + thickness`. */
  pathRadius: number;
  /** The sharp corner of the sketch. */
  corner: P2;
  /** The centre of the bend, the same for both faces. */
  center: P2;
  /** Whether the path turns to the left (counter-clockwise). */
  left: boolean;
  /** How far from the corner the bend starts along each of the two lines. */
  tangent: number;
}

export interface BentPath {
  path: Segment2[];
  bends: Bend[];
  /** The total length of the straight pieces of the path between the bends (what is flat on the sheet, measured along it). */
  straight: number;
}

export class BendProblem extends Error {}

/**
 * Rounds the corners of a polyline for a sheet `thickness` thick growing to the `side` of the way the path is walked. Throws `BendProblem` for a path that is not made
 * of lines, a corner that doubles back on itself, and a piece too short for the bends at its ends (said with how much it needs).
 */
export function bentPath(chain: Segment2[], inner: number, thickness: number, side: 'left' | 'right'): BentPath {
  const lines = chain.flatMap((s) => (s.kind === 'line' ? [s] : []));
  if (lines.length !== chain.length) throw new BendProblem(t('bend.onlyLines'));
  const dirs = lines.map((s) => unit(sub(s.b, s.a)));
  const n = lines.length;
  /** The bend at the corner after line i (0-based), or null where the path runs straight on. */
  const corners = Array.from({ length: n - 1 }, (_, i) => {
    const [d1, d2] = [dirs[i]!, dirs[i + 1]!];
    const c = cross(d1, d2);
    const angle = Math.atan2(Math.abs(c), dot(d1, d2));
    if (angle < 1e-6) return null;
    if (angle > Math.PI - 1e-3) throw new BendProblem(t('bend.doubles', { at: lines[i]!.source }));
    const left = c > 0;
    const pathRadius = left === (side === 'left') ? inner + thickness : inner;
    return { angle, left, pathRadius, tangent: pathRadius * Math.tan(angle / 2) };
  });
  const before = (i: number) => (i > 0 ? corners[i - 1]?.tangent ?? 0 : 0);
  const after = (i: number) => (i < n - 1 ? corners[i]?.tangent ?? 0 : 0);
  const path: Segment2[] = [];
  const bends: Bend[] = [];
  let straight = 0;
  for (let i = 0; i < n; i++) {
    const s = lines[i]!;
    const length = len(sub(s.b, s.a));
    const room = length - before(i) - after(i);
    if (room < -1e-9) throw new BendProblem(t('bend.short', { at: s.source, need: (before(i) + after(i)).toFixed(3), have: length.toFixed(3) }));
    const from = add(s.a, dirs[i]!, before(i));
    const to = add(s.b, dirs[i]!, -after(i));
    if (room > 1e-9) {
      path.push({ kind: 'line', a: from, b: to, source: s.source });
      straight += room;
    }
    const c = i < n - 1 ? corners[i] : null;
    if (c) {
      const next = add(s.b, dirs[i + 1]!, c.tangent);
      const normal = perp(dirs[i]!);
      const center = c.left ? add(to, normal, c.pathRadius) : add(to, normal, -c.pathRadius);
      const source = `bend${bends.length + 1}`;
      path.push({ kind: 'arc', c: center, r: c.pathRadius, from: to, to: next, ccw: c.left, source });
      bends.push({ source, angle: c.angle, pathRadius: c.pathRadius, corner: s.b, center, left: c.left, tangent: c.tangent });
    }
  }
  return { path, bends, straight };
}
