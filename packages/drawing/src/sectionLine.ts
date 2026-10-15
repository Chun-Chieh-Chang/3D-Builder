import { lineAcrossBox } from './layout';

/**
 * Building the line of a stepped or aligned section with the pointer (D-I5, ADR 0143), in the parent's view coordinates (full size): click by click, then
 * finished across the view. Nothing here knows of the page.
 */

type P = [number, number];
type Box = { min: readonly [number, number]; max: readonly [number, number] };

/** A way within 3° of the sheet's x or y is taken as on it: most stepped sections are drawn square to the part. */
const SNAP = Math.sin((3 * Math.PI) / 180);

/** The end of the first cut, clicked at `q` from `p0`: on the sheet's x or y when within 3° of it. Null at the same point. */
export function firstCutTo(p0: P, q: P): P | null {
  const dx = q[0] - p0[0];
  const dy = q[1] - p0[1];
  const len = Math.hypot(dx, dy);
  if (!(len > 1e-6)) return null;
  if (Math.abs(dy) / len < SNAP) return [q[0], p0[1]];
  if (Math.abs(dx) / len < SNAP) return [p0[0], q[1]];
  return [q[0], q[1]];
}

/**
 * A stepped line clicked on to `q`: a jog square to the first cut, as far across as `q` is, then a cut along it as far on as `q` is — the two points they end
 * at. Null when `q` is not on past the end along the cut, or not off it across (a step needs both).
 */
export function stepTo(points: readonly P[], q: P): P[] | null {
  if (points.length < 2) return null;
  const [p0, p1] = points as [P, P];
  const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  const t: P = [(p1[0] - p0[0]) / len, (p1[1] - p0[1]) / len];
  const n: P = [-t[1], t[0]];
  const e = points[points.length - 1]!;
  const along = (q[0] - e[0]) * t[0] + (q[1] - e[1]) * t[1];
  const across = (q[0] - e[0]) * n[0] + (q[1] - e[1]) * n[1];
  if (!(along > 1e-6) || !(Math.abs(across) > 1e-6)) return null;
  const j: P = [e[0] + across * n[0], e[1] + across * n[1]];
  return [...points, j, [j[0] + along * t[0], j[1] + along * t[1]]];
}

/** The third point of an aligned line: null at the bend, or in line with the first segment within 1° (either way). */
export function alignedTo(points: readonly P[], q: P): P[] | null {
  if (points.length !== 2) return null;
  const [p0, p1] = points as [P, P];
  const a: P = [p1[0] - p0[0], p1[1] - p0[1]];
  const b: P = [q[0] - p1[0], q[1] - p1[1]];
  const la = Math.hypot(...a);
  const lb = Math.hypot(...b);
  if (!(lb > 1e-6)) return null;
  if (Math.abs(a[0] * b[1] - a[1] * b[0]) / (la * lb) < Math.sin(Math.PI / 180)) return null;
  return [p0, p1, q];
}

/**
 * The line finished across the view: its first point carried back along the first segment, and its last on along the last, to the view's box grown by `pad`
 * (when they are inside it), so that it crosses the view as a straight one does. A line along the sheet's axes is put on the 0.01 mm grid (its jogs stay
 * square: points that share an x or a y round alike); a slanted one is left as it is, so that its jogs stay square to its cuts.
 */
export function finishSectionLine(points: readonly P[], box: Box, pad: number): P[] {
  const out = points.map((p) => [p[0], p[1]] as P);
  const n = out.length;
  const extend = (from: P, to: P, which: 0 | 1): P | null => {
    const across = lineAcrossBox(from, to, box, pad);
    if (!across) return null;
    const end = across[which];
    const way: P = [to[0] - from[0], to[1] - from[1]];
    const past = (end[0] - (which === 0 ? from : to)[0]) * way[0] + (end[1] - (which === 0 ? from : to)[1]) * way[1];
    return (which === 0 ? past < 0 : past > 0) ? end : null;
  };
  const start = extend(out[0]!, out[1]!, 0);
  const end = extend(out[n - 2]!, out[n - 1]!, 1);
  if (start) out[0] = start;
  if (end) out[n - 1] = end;
  const square = out.every((p, i) => i === 0 || p[0] === out[i - 1]![0] || p[1] === out[i - 1]![1]);
  return square ? out.map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100] as P) : out;
}
