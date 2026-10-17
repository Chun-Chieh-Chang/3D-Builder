/**
 * The 2D geometry of the derived views (C16.3): the lines of a view cut to a circle for a detail, cut to an outline for a cropped view, and the hatching of the
 * faces a section cuts. All in the coordinates of the view (mm at full size); polylines are x, y, x, y ….
 */

import type { ClosedOutline } from '@3db/model';

export type Polyline = number[];

/** The pieces of a polyline inside the circle (centre, radius); a piece that leaves and comes back is two. Points where it crosses the circle are exact. */
export function clipToCircle(line: readonly number[], centre: readonly [number, number], radius: number): Polyline[] {
  const out: Polyline[] = [];
  let current: number[] = [];
  const flush = () => {
    if (current.length >= 4) out.push(current);
    current = [];
  };
  const inside = (x: number, y: number) => Math.hypot(x - centre[0], y - centre[1]) <= radius + 1e-9;
  for (let i = 0; i + 3 < line.length; i += 2) {
    const [x0, y0, x1, y1] = [line[i]!, line[i + 1]!, line[i + 2]!, line[i + 3]!];
    // the parameters t in [0, 1] where the segment is inside: |p0 + t d - c|² ≤ r² is a quadratic in t
    const dx = x1 - x0;
    const dy = y1 - y0;
    const fx = x0 - centre[0];
    const fy = y0 - centre[1];
    const a = dx * dx + dy * dy;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - radius * radius;
    let t0 = 0;
    let t1 = 1;
    let any = true;
    if (a < 1e-18) any = inside(x0, y0);
    else {
      const disc = b * b - 4 * a * c;
      if (disc < 0) any = false;
      else {
        const s = Math.sqrt(disc);
        t0 = Math.max(0, (-b - s) / (2 * a));
        t1 = Math.min(1, (-b + s) / (2 * a));
        any = t0 <= t1;
      }
    }
    if (!any) {
      flush();
      continue;
    }
    const p0: [number, number] = [x0 + t0 * dx, y0 + t0 * dy];
    const p1: [number, number] = [x0 + t1 * dx, y0 + t1 * dy];
    // the piece joins the one before when it starts where the last ended (the segment began inside)
    if (current.length === 0 || t0 > 0) {
      flush();
      current = [p0[0], p0[1]];
    }
    current.push(p1[0], p1[1]);
    if (t1 < 1) flush(); // it leaves the circle here
  }
  flush();
  return out;
}

/**
 * The pieces of a polyline outside a break's band (B2.7): the band between `from` and `to` along `axis` (0 for x, 1 for y) is left out of a broken view, so a segment that
 * crosses the band is cut at its two ends rather than drawn straight across the gap. A polyline wholly inside the band gives none. Points where it crosses are exact.
 */
export function clipToBand(line: readonly number[], axis: 0 | 1, from: number, to: number): Polyline[] {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  if (!(hi > lo)) return line.length >= 4 ? [line.slice()] : [];
  const out: Polyline[] = [];
  let current: number[] = [];
  const flush = () => {
    if (current.length >= 4) out.push(current);
    current = [];
  };
  const at = (p: readonly number[], q: readonly number[], t: number): [number, number] => [p[0]! + (q[0]! - p[0]!) * t, p[1]! + (q[1]! - p[1]!) * t];
  for (let i = 0; i + 3 < line.length; i += 2) {
    const p: [number, number] = [line[i]!, line[i + 1]!];
    const q: [number, number] = [line[i + 2]!, line[i + 3]!];
    const span = q[axis] - p[axis];
    // the segment cut where it crosses each end of the band: at most three pieces, the middle one inside the band and so not drawn
    const ts = [0, 1];
    if (Math.abs(span) > 1e-12) {
      for (const edge of [lo, hi]) {
        const t = (edge - p[axis]) / span;
        if (t > 0 && t < 1) ts.push(t);
      }
    }
    ts.sort((a, b) => a - b);
    for (let k = 0; k + 1 < ts.length; k++) {
      const t0 = ts[k]!;
      const t1 = ts[k + 1]!;
      const mid = p[axis] + span * ((t0 + t1) / 2);
      if (mid > lo && mid < hi) {
        flush();
        continue;
      }
      const a = at(p, q, t0);
      const b = at(p, q, t1);
      if (current.length === 0) current.push(a[0], a[1]);
      current.push(b[0], b[1]);
    }
  }
  flush();
  return out;
}

/**
 * The outline of a cropped view or a local section as a closed polyline of points (B1, B2.7): a rectangle's four corners, a circle's `steps`, a polygon's own
 * points. The polygon's last point repeating the first is left out, so that the polyline is closed without a segment of no length.
 */
export function outlinePoints(outline: ClosedOutline, steps = 32): [number, number][] {
  if (outline.kind === 'rectangle') {
    const [x0, y0] = outline.p0;
    const [x1, y1] = outline.p1;
    return [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
  }
  if (outline.kind === 'circle') {
    const { centre, radius } = outline;
    const pts: [number, number][] = [];
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * 2 * Math.PI;
      pts.push([centre[0] + radius * Math.cos(a), centre[1] + radius * Math.sin(a)]);
    }
    return pts;
  }
  const pts = outline.points.slice();
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (first && last && Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9) pts.pop();
  return pts;
}

/** The box an outline holds (full size); null when it has no area. */
export function outlineBox(outline: ClosedOutline): { min: [number, number]; max: [number, number] } | null {
  const pts = outlinePoints(outline);
  if (pts.length === 0) return null;
  const xs = pts.map(([x]) => x);
  const ys = pts.map(([, y]) => y);
  return { min: [Math.min(...xs), Math.min(...ys)], max: [Math.max(...xs), Math.max(...ys)] };
}

/** Whether a point is inside a closed polygon (even-odd rule); the polygon's first point is not repeated at its end. */
function insidePolygon(poly: readonly (readonly [number, number])[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

/**
 * Where the segment p–q crosses the segment a–b, as the parameter along p–q, or null when they do not cross (parallel counts as not, and a crossing beyond
 * the outline's own segment does not count either). Used to cut a line at the outline of a cropped view.
 */
function crossAt(p: readonly [number, number], q: readonly [number, number], a: readonly [number, number], b: readonly [number, number]): number | null {
  const rx = q[0] - p[0];
  const ry = q[1] - p[1];
  const sx = b[0] - a[0];
  const sy = b[1] - a[1];
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const dx = a[0] - p[0];
  const dy = a[1] - p[1];
  const t = (dx * sy - dy * sx) / den;
  const u = (dx * ry - dy * rx) / den;
  return u >= 0 && u <= 1 ? t : null;
}

/**
 * The pieces of a polyline inside a closed outline (B2.7): a cropped view shows only what its outline holds, so a line that crosses the outline is cut where
 * it does rather than drawn beyond it. A circle is cut as `clipToCircle`; a rectangle or a polygon by cutting the segment at every edge it crosses and keeping
 * the pieces whose middle is inside, so a concave polygon is right too. Points where it crosses are exact.
 */
export function clipToOutline(line: readonly number[], outline: ClosedOutline): Polyline[] {
  if (outline.kind === 'circle') return clipToCircle(line, outline.centre, outline.radius);
  const poly = outlinePoints(outline);
  if (poly.length < 3) return [];
  const box = outline.kind === 'rectangle' ? { min: [Math.min(outline.p0[0], outline.p1[0]), Math.min(outline.p0[1], outline.p1[1])], max: [Math.max(outline.p0[0], outline.p1[0]), Math.max(outline.p0[1], outline.p1[1])] } : null;
  const inside = (x: number, y: number): boolean =>
    box ? x >= box.min[0]! - 1e-9 && x <= box.max[0]! + 1e-9 && y >= box.min[1]! - 1e-9 && y <= box.max[1]! + 1e-9 : insidePolygon(poly, x, y);
  const at = (p: readonly number[], q: readonly number[], t: number): [number, number] => [p[0]! + (q[0]! - p[0]!) * t, p[1]! + (q[1]! - p[1]!) * t];
  const out: Polyline[] = [];
  let current: number[] = [];
  const flush = () => {
    if (current.length >= 4) out.push(current);
    current = [];
  };
  for (let i = 0; i + 3 < line.length; i += 2) {
    const p: [number, number] = [line[i]!, line[i + 1]!];
    const q: [number, number] = [line[i + 2]!, line[i + 3]!];
    // cut the segment wherever it crosses the outline, then keep the pieces whose middle is inside
    const ts = [0, 1];
    for (let k = 0; k < poly.length; k++) {
      const t = crossAt(p, q, poly[k]!, poly[(k + 1) % poly.length]!);
      if (t !== null && t > 0 && t < 1) ts.push(t);
    }
    ts.sort((a, b) => a - b);
    for (let k = 0; k + 1 < ts.length; k++) {
      const t0 = ts[k]!;
      const t1 = ts[k + 1]!;
      const mid = at(p, q, (t0 + t1) / 2);
      if (!inside(mid[0], mid[1])) {
        flush();
        continue;
      }
      const a = at(p, q, t0);
      const b = at(p, q, t1);
      if (current.length === 0) current.push(a[0], a[1]);
      current.push(b[0], b[1]);
    }
  }
  flush();
  return out;
}

/**
 * Hatch lines (ISO 128-50) over the region the boundary polylines bound, by the even-odd rule: lines at `angle` (radians from the x axis), `spacing` apart,
 * each cut into the pieces inside the region. The boundary is every closed outline of the cut faces, holes included. Lines through a corner count it once
 * (a half-open rule), so a corner never leaves a line unpaired.
 */
export function hatch(boundary: readonly (readonly number[])[], spacing: number, angle = Math.PI / 4): Polyline[] {
  if (!(spacing > 0)) return [];
  // rotate so the hatch lines are horizontal: rows y' = k * spacing, and the segments are cut at each crossing
  const c = Math.cos(-angle);
  const s = Math.sin(-angle);
  const turn = (x: number, y: number): [number, number] => [x * c - y * s, x * s + y * c];
  const segments: [number, number, number, number][] = [];
  let lo = Infinity;
  let hi = -Infinity;
  for (const line of boundary) {
    for (let i = 0; i + 3 < line.length; i += 2) {
      const [ax, ay] = turn(line[i]!, line[i + 1]!);
      const [bx, by] = turn(line[i + 2]!, line[i + 3]!);
      segments.push([ax, ay, bx, by]);
      lo = Math.min(lo, ay, by);
      hi = Math.max(hi, ay, by);
    }
  }
  const out: Polyline[] = [];
  const back = (x: number, y: number): [number, number] => [x * Math.cos(angle) - y * Math.sin(angle), x * Math.sin(angle) + y * Math.cos(angle)];
  // the rows sit half a spacing in from a multiple, so that none is likely to pass exactly through a corner
  for (let y = Math.ceil(lo / spacing) * spacing + spacing / 2; y < hi; y += spacing) {
    const xs: number[] = [];
    for (const [ax, ay, bx, by] of segments) {
      if (ay === by) continue;
      // half-open: a segment counts for the rows from its lower end up to, not including, its upper end
      const [y0, y1, x0, x1] = ay < by ? [ay, by, ax, bx] : [by, ay, bx, ax];
      if (y >= y0 && y < y1) xs.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const a = back(xs[i]!, y);
      const b = back(xs[i + 1]!, y);
      out.push([a[0], a[1], b[0], b[1]]);
    }
  }
  return out;
}

/** A circle as a closed polyline of `n` points. */
export function circlePolyline(centre: readonly [number, number], radius: number, n = 72): Polyline {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(centre[0] + radius * Math.cos((2 * Math.PI * i) / n), centre[1] + radius * Math.sin((2 * Math.PI * i) / n));
  return out;
}
