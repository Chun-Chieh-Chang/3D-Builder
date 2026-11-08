/**
 * The pure geometry of a planar section's boundary: an explicit approximation of its rational Bézier spans by lines and circular arcs, each with a proven error
 * bound, and the checks on an offset of such a boundary (distance to its source, where it is too close, an upper bound on a region's inradius). No kernel: the
 * spans come from `Kernel.sectionEdges`. Never an implicit fallback: a caller asks for an approximation by name, and says so to the user.
 */
import type { HomogeneousPole } from './types';

type H = HomogeneousPole;
type P = [number, number, number];

export type EnvelopePiece = { kind: 'line' | 'arc'; from: P; to: P; mid: P; bound: number };
const xyz = (h: H): P => [h[0] / h[3], h[1] / h[3], h[2] / h[3]];
const distance = (a: P, b: P) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function chordDistance(p: P, a: P, b: P) {
  const v = b.map((x, i) => x - a[i]!),
    length = v.reduce((s, x) => s + x * x, 0);
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, v.reduce((s, x, i) => s + x * (p[i]! - a[i]!), 0) / length));
  return Math.hypot(...p.map((x, i) => x - a[i]! - t * v[i]!));
}
const choose = (n: number, k: number) => {
  let v = 1;
  for (let i = 1; i <= k; i++) v = (v * (n - i + 1)) / i;
  return v;
};
function split(p: H[]) {
  let row = p;
  const left: H[] = [row[0]!],
    right: H[] = [row.at(-1)!];
  while (row.length > 1) {
    row = row.slice(0, -1).map((h, i) => h.map((x, j) => (x + row[i + 1]![j]!) / 2) as H);
    left.push(row[0]!);
    right.push(row.at(-1)!);
  }
  return { left, right: right.reverse(), mid: xyz(row[0]!) };
}
/** A circle's implicit polynomial in Bernstein form encloses radial error over
 * the entire rational Bezier span. A convex angular cone supplies the converse
 * arc-to-curve bound; no equally spaced samples are used as a certificate.
 */
export function arcEnvelope(poles: H[], epsilon: number) {
  if (!Number.isFinite(epsilon) || epsilon <= 0) throw Error('positive finite envelope tolerance required');
  if (poles.length < 2 || poles.some((p) => !p.every(Number.isFinite) || p[3] <= 0)) throw Error('finite poles with positive weights required');
  if (poles.length > 27 || poles.some((h) => !xyz(h).every(Number.isFinite))) throw Error('unsupported envelope degree or scale');
  if (Math.max(...poles.map((h) => xyz(h)[2])) - Math.min(...poles.map((h) => xyz(h)[2])) > 1e-12) throw Error('XY planar envelope required');
  const pieces: EnvelopePiece[] = [];
  const visit = (p: H[], depth: number) => {
    if (pieces.length >= 100000) throw Error('envelope segment budget exceeded');
    const from = xyz(p[0]!),
      to = xyz(p.at(-1)!),
      parts = split(p),
      mid = parts.mid;
    const lineBound = Math.max(...p.map((h) => chordDistance(xyz(h), from, to)));
    if (lineBound <= epsilon) {
      pieces.push({ kind: 'line', from, to, mid, bound: lineBound });
      return;
    }
    const ux = mid[0] - from[0],
      uy = mid[1] - from[1],
      vx = to[0] - from[0],
      vy = to[1] - from[1],
      det = 2 * (ux * vy - uy * vx);
    if (det !== 0) {
      const uu = ux * ux + uy * uy,
        vv = vx * vx + vy * vy,
        cx = from[0] + (uu * vy - vv * uy) / det,
        cy = from[1] + (ux * vv - vx * uu) / det;
      const ax = from[0] - cx,
        ay = from[1] - cy,
        bx = to[0] - cx,
        by = to[1] - cy,
        r = Math.hypot(ax, ay),
        sweep = Math.atan2(ax * by - ay * bx, ax * bx + ay * by),
        sign = sweep < 0 ? -1 : 1;
      const angle = (q: P) => sign * Math.atan2(ax * (q[1] - cy) - ay * (q[0] - cx), ax * (q[0] - cx) + ay * (q[1] - cy));
      const cone =
        Number.isFinite(r) &&
        r > 0 &&
        Math.abs(sweep) < Math.PI / 2 &&
        angle(mid) > 0 &&
        angle(mid) < Math.abs(sweep) &&
        p.every((h) => {
          const t = angle(xyz(h));
          return t >= -1e-12 && t <= Math.abs(sweep) + 1e-12;
        });
      if (cone) {
        const n = p.length - 1,
          minW = Math.min(...p.map((h) => h[3])),
          maxW = Math.max(...p.map((h) => h[3]));
        let maxF = 0,
          maxTerm = 0;
        for (let k = 0; k <= 2 * n; k++) {
          let f = 0;
          for (let i = Math.max(0, k - n); i <= Math.min(n, k); i++) {
            const j = k - i,
              pi = p[i]!,
              pj = p[j]!,
              factor = (choose(n, i) * choose(n, j)) / choose(2 * n, k),
              x = (pi[0] - cx * pi[3]) * (pj[0] - cx * pj[3]),
              y = (pi[1] - cy * pi[3]) * (pj[1] - cy * pj[3]),
              z = r * r * pi[3] * pj[3];
            f += factor * (x + y - z);
            maxTerm = Math.max(maxTerm, Math.abs(x) + Math.abs(y) + Math.abs(z));
          }
          maxF = Math.max(maxF, Math.abs(f));
        }
        const roundoff = 128 * Number.EPSILON * (n + 1) * (maxTerm + r * r * maxW * maxW),
          bound = (maxF + roundoff) / (minW * minW * r);
        if (bound <= epsilon) {
          pieces.push({ kind: 'arc', from, to, mid, bound });
          return;
        }
      }
    }
    if (depth === 24 || pieces.length > 100000) throw Error('envelope subdivision budget exceeded');
    visit(parts.left, depth + 1);
    visit(parts.right, depth + 1);
  };
  visit(poles, 0);
  return { pieces, maxBound: Math.max(...pieces.map((p) => p.bound)) };
}
/** Positive rational weights put the entire Bezier arc in its control hull.
 * Distance to a convex segment is convex, so this bounds the whole arc.
 * Continuity and the two endpoints give the converse chord-to-arc bound.
 */
export function flatten(poles: H[], epsilon: number) {
  if (!Number.isFinite(epsilon) || epsilon <= 0) throw Error('positive finite envelope tolerance required');
  if (poles.length < 2 || poles.some((p) => !p.every(Number.isFinite) || p[3] <= 0)) throw Error('finite poles with positive weights required');
  const points: P[] = [xyz(poles[0]!)];
  let maxBound = 0,
    leaves = 0;
  const visit = (p: H[], depth: number) => {
    const first = xyz(p[0]!),
      last = xyz(p.at(-1)!),
      bound = Math.max(...p.map((h) => chordDistance(xyz(h), first, last)));
    if (bound <= epsilon) {
      maxBound = Math.max(maxBound, bound);
      points.push(last);
      if (++leaves > 100000) throw Error('envelope segment budget exceeded');
      return;
    }
    if (depth === 24) throw Error('envelope subdivision budget exceeded');
    let row = p;
    const left: H[] = [row[0]!],
      right: H[] = [row.at(-1)!];
    while (row.length > 1) {
      row = row.slice(0, -1).map((h, i) => h.map((x, j) => (x + row[i + 1]![j]!) / 2) as H);
      left.push(row[0]!);
      right.push(row.at(-1)!);
    }
    visit(left, depth + 1);
    visit(right.reverse(), depth + 1);
  };
  visit(poles, 0);
  return { points, maxBound, leaves };
}
/** Planar line or circular-arc edge read back from an OCCT wire. */
export type Seg2 =
  | { kind: 'line'; a: [number, number]; b: [number, number] }
  | { kind: 'arc'; c: [number, number]; r: number; a: [number, number]; m: [number, number]; b: [number, number] };
export type OffsetCertificate = {
  edges: number;
  maxUpper: number;
  generators: { line: number; arc: number; vertex: number; lipschitz: number };
  refined: { pieces: number; budget: number };
  sampledMax: number;
  failures: { index: number; best: number }[];
};
/** Largest angular overrun past a source arc end that still uses that arc as generator (rad). */
const OVERRUN = 0.2;
/** Total bisection steps allowed across one certificate before it refuses. */
const REFINE_BUDGET = 12_000_000;
/** Bisection steps allowed for any single edge. */
const EDGE_BUDGET = 400_000;
const d2 = (p: [number, number], q: [number, number]) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const turn = (x: number) => {
  const t = x % (2 * Math.PI);
  return t < 0 ? t + 2 * Math.PI : t;
};
/** Angle span of an arc measured from its own start, in its own direction. */
function span(c: [number, number], a: [number, number], m: [number, number], b: [number, number]) {
  const ang = (p: [number, number]) => Math.atan2(p[1] - c[1], p[0] - c[0]),
    a0 = ang(a);
  const ccw = turn(ang(m) - a0) < turn(ang(b) - a0),
    dir = ccw ? 1 : -1;
  const sweep = turn(dir * (ang(b) - a0)) || 2 * Math.PI;
  return { a0, dir, sweep, at: (p: [number, number]) => turn(dir * (ang(p) - a0)) };
}

/** Exact distance from a point to one line or arc element. */
function pointTo(p: [number, number], s: Seg2, sp?: ReturnType<typeof span>) {
  if (s.kind === 'line') {
    const vx = s.b[0] - s.a[0],
      vy = s.b[1] - s.a[1],
      l2 = vx * vx + vy * vy,
      t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - s.a[0]) * vx + (p[1] - s.a[1]) * vy) / l2));
    return Math.hypot(p[0] - s.a[0] - t * vx, p[1] - s.a[1] - t * vy);
  }
  const q = sp ?? span(s.c, s.a, s.m, s.b),
    t = q.at(p);
  return t <= q.sweep ? Math.abs(d2(p, s.c) - s.r) : Math.min(d2(p, s.a), d2(p, s.b));
}
/** Point on an edge at fraction u, and the edge length. */
function along(o: Seg2) {
  if (o.kind === 'line') return { len: d2(o.a, o.b), at: (u: number): [number, number] => [o.a[0] + u * (o.b[0] - o.a[0]), o.a[1] + u * (o.b[1] - o.a[1])] };
  const q = span(o.c, o.a, o.m, o.b);
  return {
    len: o.r * q.sweep,
    at: (u: number): [number, number] => {
      const t = q.a0 + q.dir * q.sweep * u;
      return [o.c[0] + o.r * Math.cos(t), o.c[1] + o.r * Math.sin(t)];
    },
  };
}
/** Exact distance from any point to a set of line/arc elements, through a uniform grid of their boxes. */
export function nearestField(source: Seg2[], minCell: number) {
  const allSpans = source.map((q) => (q.kind === 'arc' ? span(q.c, q.a, q.m, q.b) : undefined));
  // Uniform grid over element boxes so the exact point distance only visits nearby elements.
  const box = source.map((q) => {
    const pts = [q.a, q.b, ...(q.kind === 'arc' ? [q.m] : [])],
      pad = q.kind === 'arc' ? d2(q.a, q.b) / 2 + d2(q.a, q.m) : 0;
    return [
      Math.min(...pts.map((p) => p[0])) - pad,
      Math.min(...pts.map((p) => p[1])) - pad,
      Math.max(...pts.map((p) => p[0])) + pad,
      Math.max(...pts.map((p) => p[1])) + pad,
    ] as const;
  });
  const h = Math.max(
      minCell,
      ...[0.5].map(() => {
        const w = box.map((b) => Math.max(b[2] - b[0], b[3] - b[1])).sort((x, y) => x - y);
        return 2 * w[Math.floor(w.length / 2)]!;
      }),
    ),
    grid = new Map<string, number[]>();
  box.forEach((b, i) => {
    for (let x = Math.floor(b[0] / h); x <= Math.floor(b[2] / h); x++)
      for (let y = Math.floor(b[1] / h); y <= Math.floor(b[3] / h); y++) {
        const key = x + ',' + y;
        (grid.get(key) ?? grid.set(key, []).get(key)!).push(i);
      }
  });
  const nearest = (p: [number, number]) => {
    const cx = Math.floor(p[0] / h),
      cy = Math.floor(p[1] / h);
    let near = Infinity;
    const seen = new Set<number>();
    for (let ring = 0; ring < 1e4; ring++) {
      if (near <= (ring - 1) * h) break;
      for (let x = cx - ring; x <= cx + ring; x++)
        for (let y = cy - ring; y <= cy + ring; y++) {
          if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) !== ring) continue;
          for (const i of grid.get(x + ',' + y) ?? []) {
            if (seen.has(i)) continue;
            seen.add(i);
            near = Math.min(near, pointTo(p, source[i]!, allSpans[i]));
          }
        }
    }
    return near;
  };
  return nearest;
}
/** Edge-by-edge upper bound on the distance from every point of `output` to `source`.
 * Each output edge must be generated by one source element, with no sampling:
 * a line parallel to a source line whose endpoints project inside it (the distance is
 * linear along the edge, so the endpoints bound it); an arc concentric with a source arc
 * whose angular span lies inside the source span (radial distance is |R-r| plus the
 * centre mismatch); or a join arc around a source vertex (R plus the centre mismatch).
 * The lower bound is NOT certified here: it comes from a global minimum distance.
 */
export function certifyOffset(source: Seg2[], output: Seg2[], gap: number, slack: number): OffsetCertificate {
  if (!Number.isFinite(gap) || gap <= 0) throw Error('positive finite gap required');
  if (!Number.isFinite(slack) || slack <= 0 || slack >= gap) throw Error('positive finite slack below the gap required');
  if (!source.length || !output.length) throw Error('non-empty source and output required');
  const finite = (s: Seg2) => [s.a, s.b, ...(s.kind === 'arc' ? [s.c, s.m, [s.r, 0] as [number, number]] : [])].every((p) => p.every(Number.isFinite));
  if (!source.every(finite) || !output.every(finite)) throw Error('finite edge geometry required');
  const vertices = source.flatMap((s) => [s.a, s.b]),
    lines = source.filter((s): s is Extract<Seg2, { kind: 'line' }> => s.kind === 'line'),
    arcs = source.filter((s): s is Extract<Seg2, { kind: 'arc' }> => s.kind === 'arc');
  const sourceSpans = arcs.map((s) => span(s.c, s.a, s.m, s.b));
  const nearest = nearestField(source, gap);
  const limit = gap + slack,
    result: OffsetCertificate = {
      edges: output.length,
      maxUpper: 0,
      generators: { line: 0, arc: 0, vertex: 0, lipschitz: 0 },
      refined: { pieces: 0, budget: 0 },
      sampledMax: 0,
      failures: [],
    };
  output.forEach((o, index) => {
    let best = Infinity,
      kind: 'line' | 'arc' | 'vertex' | null = null;
    if (o.kind === 'line') {
      // Distance to a convex segment is convex along a line, so the larger endpoint distance bounds the edge.
      for (const s of lines) {
        const vx = s.b[0] - s.a[0],
          vy = s.b[1] - s.a[1],
          len2 = vx * vx + vy * vy;
        if (len2 === 0) continue;
        const dist = (p: [number, number]) => {
          const t = Math.max(0, Math.min(1, ((p[0] - s.a[0]) * vx + (p[1] - s.a[1]) * vy) / len2));
          return Math.hypot(p[0] - s.a[0] - t * vx, p[1] - s.a[1] - t * vy);
        };
        const bound = Math.max(dist(o.a), dist(o.b));
        if (bound < best) {
          best = bound;
          kind = 'line';
        }
      }
    } else {
      const R = o.r;
      for (const v of vertices) {
        const bound = R + d2(o.c, v);
        if (bound < best) {
          best = bound;
          kind = 'vertex';
        }
      }
      arcs.forEach((s, i) => {
        const e = d2(o.c, s.c);
        if (e >= R || e >= s.r) return;
        // Angles about the source centre, measured from its start; angles past the far side of the
        // gap in the circle count as "before the start" so a small overrun at either end is one interval.
        const sp = sourceSpans[i]!,
          eps = 1e-12,
          cut = sp.sweep + (2 * Math.PI - sp.sweep) / 2,
          g = (p: [number, number]) => {
            const t = sp.at(p);
            return t > cut ? t - 2 * Math.PI : t;
          };
        // A full source circle generates every concentric arc, wherever it crosses the circle's start.
        if (sp.sweep >= 2 * Math.PI - eps) {
          const bound = Math.abs(R - s.r) + e;
          if (bound < best) {
            best = bound;
            kind = 'arc';
          }
          return;
        }
        const ta = g(o.a),
          tm = g(o.m),
          tb = g(o.b),
          lo = Math.min(ta, tb),
          hi = Math.max(ta, tb);
        if (tm < lo - eps || tm > hi + eps || lo < -OVERRUN || hi > sp.sweep + OVERRUN) return;
        let bound = Math.abs(R - s.r) + e;
        // Beyond the span the nearest generator point is that end vertex; the distance to it grows
        // with the angle away from it, so the overrunning output endpoint bounds that portion.
        if (lo < -eps) bound = Math.max(bound, d2(ta < tb ? o.a : o.b, s.a) + 2 * e);
        if (hi > sp.sweep + eps) bound = Math.max(bound, d2(ta < tb ? o.b : o.a, s.b) + 2 * e);
        if (bound < best) {
          best = bound;
          kind = 'arc';
        }
      });
    }
    if (kind && best <= limit) {
      result.generators[kind]++;
      result.maxUpper = Math.max(result.maxUpper, best);
      return;
    }
    // Fallback: the distance to the source is 1-Lipschitz, so on a piece of arc length L its supremum is at
    // most the exact distance at the piece midpoint plus L/2. Bisect until each piece is below the limit.
    const path = along(o),
      stack: [number, number][] = [[0, 1]];
    let worst = 0,
      pieces = 0,
      ok = true,
      steps = 0;
    while (stack.length) {
      const [u0, u1] = stack.pop()!,
        mid = path.at((u0 + u1) / 2),
        half = (path.len * (u1 - u0)) / 2;
      const near = nearest(mid);
      const bound = near + half;
      if (bound <= limit) {
        worst = Math.max(worst, bound);
        pieces++;
        continue;
      }
      if (half < 1e-9 || near > limit || ++steps > EDGE_BUDGET || ++result.refined.budget > REFINE_BUDGET) {
        ok = false;
        break;
      }
      stack.push([u0, (u0 + u1) / 2], [(u0 + u1) / 2, u1]);
    }
    if (ok) {
      for (let j = 0; j <= 64; j++) result.sampledMax = Math.max(result.sampledMax, nearest(path.at(j / 64)));
      result.generators.lipschitz++;
      result.refined.pieces += pieces;
      result.maxUpper = Math.max(result.maxUpper, worst);
    } else result.failures.push({ index, best });
  });
  return result;
}
/** Where an offset comes closer to its source than the gap: the closest point of one place, its distance, how many samples. */
export type ClearanceViolation = { point: [number, number]; distance: number; samples: number };
/** Thrown instead of returning an offset that violates the gap, with every place where it does. */
export class OffsetClearanceError extends Error {
  constructor(
    readonly gap: number,
    readonly minDistance: number,
    readonly locations: ClearanceViolation[],
  ) {
    super(
      `offset violates the gap ${gap} mm at ${locations.length} place(s); closest ${minDistance.toFixed(6)} mm at (${locations[0]?.point.map((x) => x.toFixed(3)).join(', ')})`,
    );
    this.name = 'OffsetClearanceError';
  }
}
/** Dense samples of `output` closer than the gap to `source`, merged into places: samples closer than the gap are one place. */
export function violationPlaces(
  source: Seg2[],
  output: Seg2[],
  gap: number,
  tolerance: number,
  samplesPerEdge: number,
  closest: { p: [number, number]; d: number },
): ClearanceViolation[] {
  const near = nearestField(source, gap),
    bad: { p: [number, number]; d: number }[] = [];
  for (const o of output) {
    const path = along(o);
    for (let j = 0; j <= samplesPerEdge; j++) {
      const p = path.at(j / samplesPerEdge),
        d = near(p);
      if (d < gap - tolerance) bad.push({ p, d });
    }
  }
  bad.push(closest);
  // Union-find over a grid of cell `gap`: samples closer than `gap` belong to one place.
  const parent = bad.map((_, i) => i),
    find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!))),
    cell = new Map<string, number[]>();
  bad.forEach((b, i) => {
    const key = Math.floor(b.p[0] / gap) + ',' + Math.floor(b.p[1] / gap);
    (cell.get(key) ?? cell.set(key, []).get(key)!).push(i);
  });
  bad.forEach((b, i) => {
    const cx = Math.floor(b.p[0] / gap),
      cy = Math.floor(b.p[1] / gap);
    for (let x = cx - 1; x <= cx + 1; x++)
      for (let y = cy - 1; y <= cy + 1; y++) for (const j of cell.get(x + ',' + y) ?? []) if (j < i && d2(b.p, bad[j]!.p) < gap) parent[find(i)] = find(j);
  });
  const groups = new Map<number, ClearanceViolation>();
  bad.forEach((b, i) => {
    const r = find(i),
      g = groups.get(r);
    if (!g) groups.set(r, { point: b.p, distance: b.d, samples: 1 });
    else {
      g.samples++;
      if (b.d < g.distance) {
        g.distance = b.d;
        g.point = b.p;
      }
    }
  });
  return [...groups.values()].sort((x, y) => x.distance - y.distance);
}
/** Rational de Casteljau split of homogeneous poles at parameter t. */
function splitAt(p: H[], t: number) {
  let row = p;
  const left: H[] = [row[0]!],
    right: H[] = [row.at(-1)!];
  while (row.length > 1) {
    row = row.slice(0, -1).map((h, i) => h.map((x, j) => x * (1 - t) + row[i + 1]![j]! * t) as H);
    left.push(row[0]!);
    right.push(row.at(-1)!);
  }
  return { left, right: right.reverse(), point: xyz(row[0]!) };
}
/** Radial deviation bound of a positive-weight rational Bezier from the circle (cx, cy, r): the Bernstein form of
 * F = (X-cx W)^2 + (Y-cy W)^2 - r^2 W^2 bounds |F|, and |rho - r| = |F| / (W^2 (rho + r)) <= max|F| / (minW^2 r). */
function circleBound(p: H[], cx: number, cy: number, r: number) {
  const n = p.length - 1,
    minW = Math.min(...p.map((h) => h[3])),
    maxW = Math.max(...p.map((h) => h[3]));
  let maxF = 0,
    maxTerm = 0;
  for (let k = 0; k <= 2 * n; k++) {
    let f = 0;
    for (let i = Math.max(0, k - n); i <= Math.min(n, k); i++) {
      const j = k - i,
        pi = p[i]!,
        pj = p[j]!,
        factor = (choose(n, i) * choose(n, j)) / choose(2 * n, k),
        x = (pi[0] - cx * pi[3]) * (pj[0] - cx * pj[3]),
        y = (pi[1] - cy * pi[3]) * (pj[1] - cy * pj[3]),
        z = r * r * pi[3] * pj[3];
      f += factor * (x + y - z);
      maxTerm = Math.max(maxTerm, Math.abs(x) + Math.abs(y) + Math.abs(z));
    }
    maxF = Math.max(maxF, Math.abs(f));
  }
  return (maxF + 128 * Number.EPSILON * (n + 1) * (maxTerm + r * r * maxW * maxW)) / (minW * minW * r);
}
/** The arc leaving point s with unit tangent t that ends at e; null when s, t, e are collinear (a line). */
function arcLeaving(s: P, t: [number, number], e: P) {
  const n: [number, number] = [-t[1], t[0]],
    dx = e[0] - s[0],
    dy = e[1] - s[1],
    den = 2 * (dx * n[0] + dy * n[1]);
  if (Math.abs(den) <= 1e-14 * Math.hypot(dx, dy)) return null;
  const sN = (dx * dx + dy * dy) / den,
    cx = s[0] + sN * n[0],
    cy = s[1] + sN * n[1],
    r = Math.abs(sN),
    a0 = Math.atan2(s[1] - cy, s[0] - cx),
    a1 = Math.atan2(e[1] - cy, e[0] - cx),
    turn = sN > 0 ? 1 : -1;
  let sweep = turn * (a1 - a0);
  while (sweep < 0) sweep += 2 * Math.PI;
  while (sweep >= 2 * Math.PI) sweep -= 2 * Math.PI;
  const mid: P = [cx + r * Math.cos(a0 + (turn * sweep) / 2), cy + r * Math.sin(a0 + (turn * sweep) / 2), s[2]];
  return { cx, cy, r, a0, turn, sweep, mid, endTangent: [-turn * Math.sin(a0 + turn * sweep), turn * Math.cos(a0 + turn * sweep)] as [number, number] };
}
/**
 * G1 envelope of one rational Bezier: each leaf is a biarc whose two ends take the curve's own tangents there, so
 * consecutive leaves (and consecutive Bezier pieces of a C1 spline) meet without a kink. The bound of each arc is the
 * Bernstein radial bound against the matching half of the curve, split at the parameter nearest the biarc's junction,
 * plus the distance from that junction to the curve; each half must also stay inside its arc's angular cone.
 */
/** Unit tangents at both ends of a rational Bezier, skipping control points within 1e-3 of the chord scale of an end
 * (a vanishing end derivative, such as the tiny hook OCCT leaves where a section curve meets a line). */
export function endTangents(p: H[]) {
  const pts = p.map(xyz),
    tol = 1e-3 * Math.max(...pts.map((q) => distance(q, pts[0]!)));
  let i = 1;
  while (i < pts.length - 1 && distance(pts[i]!, pts[0]!) <= tol) i++;
  let j = pts.length - 2;
  while (j > 0 && distance(pts[j]!, pts.at(-1)!) <= tol) j--;
  const u = (v: [number, number]): [number, number] => {
    const l = Math.hypot(...v);
    return [v[0] / l, v[1] / l];
  };
  return { t0: u([pts[i]![0] - pts[0]![0], pts[i]![1] - pts[0]![1]]), t1: u([pts.at(-1)![0] - pts[j]![0], pts.at(-1)![1] - pts[j]![1]]) };
}
/** Leaves shorter than this (mm) become lines in biarc mode when their chord is within the tolerance. */
const BIARC_MIN_LEAF = 1e-4;
export function biarcEnvelope(poles: H[], epsilon: number, ends: { t0?: [number, number]; t1?: [number, number] } = {}) {
  if (!Number.isFinite(epsilon) || epsilon <= 0) throw Error('positive finite envelope tolerance required');
  if (poles.length < 2 || poles.some((p) => !p.every(Number.isFinite) || p[3] <= 0)) throw Error('finite poles with positive weights required');
  if (poles.length > 27 || poles.some((h) => !xyz(h).every(Number.isFinite))) throw Error('unsupported envelope degree or scale');
  if (Math.max(...poles.map((h) => xyz(h)[2])) - Math.min(...poles.map((h) => xyz(h)[2])) > 1e-12) throw Error('XY planar envelope required');
  const pieces: EnvelopePiece[] = [];
  const unit = (v: [number, number]): [number, number] => {
    const l = Math.hypot(...v);
    return [v[0] / l, v[1] / l];
  };
  const inCone = (p: H[], arc: NonNullable<ReturnType<typeof arcLeaving>>, slack: number) =>
    p.every((h) => {
      const q = xyz(h);
      let t = arc.turn * (Math.atan2(q[1] - arc.cy, q[0] - arc.cx) - arc.a0);
      while (t < -Math.PI) t += 2 * Math.PI;
      while (t > Math.PI) t -= 2 * Math.PI;
      return t >= -slack && t <= arc.sweep + slack;
    });
  const visit = (p: H[], depth: number, o0?: [number, number], o1?: [number, number]) => {
    if (pieces.length >= 100000) throw Error('envelope segment budget exceeded');
    const from = xyz(p[0]!),
      to = xyz(p.at(-1)!),
      own = endTangents(p),
      t0 = o0 ?? own.t0,
      t1 = o1 ?? own.t1;
    const lineBound = Math.max(...p.map((h) => chordDistance(xyz(h), from, to)));
    const chordDir = unit([to[0] - from[0], to[1] - from[1]]),
      straight = Math.abs(chordDir[0] * t0[1] - chordDir[1] * t0[0]) < 1e-12 && Math.abs(chordDir[0] * t1[1] - chordDir[1] * t1[0]) < 1e-12;
    if (straight && lineBound <= epsilon) {
      pieces.push({ kind: 'line', from, to, mid: splitAt(p, 0.5).point, bound: lineBound });
      return;
    }
    // A leaf shorter than BIARC_MIN_LEAF is taken as a line when its chord is within the tolerance, even though its end
    // tangents differ from the chord: such leaves only appear where the section curve has a tiny end hook, and a biarc there
    // would follow the hook with micro arcs.
    if (distance(from, to) < BIARC_MIN_LEAF && lineBound <= epsilon) {
      pieces.push({ kind: 'line', from, to, mid: splitAt(p, 0.5).point, bound: lineBound });
      return;
    }
    const vx = to[0] - from[0],
      vy = to[1] - from[1],
      dot = t0[0] * t1[0] + t0[1] * t1[1],
      den = 2 * (1 - dot),
      vt = vx * (t0[0] + t1[0]) + vy * (t0[1] + t1[1]),
      vv = vx * vx + vy * vy;
    const d = den < 1e-14 ? vv / (2 * (vx * t0[0] + vy * t0[1])) : (-vt + Math.sqrt(vt * vt + den * vv)) / den;
    if (Number.isFinite(d) && d > 0) {
      const q0: [number, number] = [from[0] + d * t0[0], from[1] + d * t0[1]],
        q1: [number, number] = [to[0] - d * t1[0], to[1] - d * t1[1]],
        J: P = [(q0[0] + q1[0]) / 2, (q0[1] + q1[1]) / 2, from[2]];
      const a1 = arcLeaving(from, t0, J),
        a2 = arcLeaving(J, unit([q1[0] - q0[0], q1[1] - q0[1]]), to);
      if (a1 && a2 && a1.sweep < Math.PI / 2 && a2.sweep < Math.PI / 2 && distance(from, J) >= 1e-6 && distance(J, to) >= 1e-6) {
        // the curve parameter nearest the junction: coarse samples, then golden-section refinement
        let tau = 0,
          best = Infinity;
        for (let i = 0; i <= 32; i++) {
          const q = splitAt(p, i / 32).point,
            dd = distance(q, J);
          if (dd < best) {
            best = dd;
            tau = i / 32;
          }
        }
        let lo = Math.max(0, tau - 1 / 32),
          hi = Math.min(1, tau + 1 / 32);
        for (let it = 0; it < 60; it++) {
          const m1 = lo + (hi - lo) * 0.382,
            m2 = lo + (hi - lo) * 0.618;
          if (distance(splitAt(p, m1).point, J) < distance(splitAt(p, m2).point, J)) hi = m2;
          else lo = m1;
        }
        tau = (lo + hi) / 2;
        const s = splitAt(p, tau),
          e = distance(s.point, J);
        if (tau > 0 && tau < 1) {
          const slack = (e + epsilon) / Math.min(a1.r, a2.r) + 1e-12;
          // Two bounds for each half, the smaller one kept. (a) Bernstein radial bound, valid when the half stays in the
          // arc's cone. (b) Chord route, free of the r^2 round-off that grows with the radius: the half is within its
          // control-hull distance of its own chord, that chord is within e of the arc's chord, and a minor arc is within its
          // sagitta of its chord, both ways.
          const sag = (arc: NonNullable<typeof a1>, c0: P, c1: P) => {
            const h = distance(c0, c1) / 2;
            return arc.r - Math.sqrt(Math.max(0, arc.r * arc.r - h * h));
          };
          const hull = (q: H[]) => {
            const f = xyz(q[0]!),
              l = xyz(q.at(-1)!);
            return Math.max(...q.map((h) => chordDistance(xyz(h), f, l)));
          };
          const alt1 = hull(s.left) + sag(a1, from, J) + e,
            alt2 = hull(s.right) + sag(a2, J, to) + e;
          const cone = inCone(s.left, a1, slack) && inCone(s.right, a2, slack);
          {
            const b1 = Math.min(cone ? circleBound(s.left, a1.cx, a1.cy, a1.r) + e : Infinity, alt1),
              b2 = Math.min(cone ? circleBound(s.right, a2.cx, a2.cy, a2.r) + e : Infinity, alt2);
            if (b1 <= epsilon && b2 <= epsilon) {
              pieces.push({ kind: 'arc', from, to: J, mid: a1.mid, bound: b1 }, { kind: 'arc', from: J, to, mid: a2.mid, bound: b2 });
              return;
            }
          }
        }
      }
    }
    if (depth === 24) throw Error('envelope subdivision budget exceeded');
    const half = splitAt(p, 0.5);
    visit(half.left, depth + 1, o0, undefined);
    visit(half.right, depth + 1, undefined, o1);
  };
  visit(poles, 0, ends.t0, ends.t1);
  return { pieces, maxBound: Math.max(...pieces.map((p) => p.bound)) };
}
/** Even-odd test against lines and arcs, arcs taken as chords within `sag` of the arc. */
function insideTest(segs: Seg2[], sag: number) {
  const edges: [number, number, number, number][] = [];
  for (const s of segs) {
    if (s.kind === 'line') {
      edges.push([s.a[0], s.a[1], s.b[0], s.b[1]]);
      continue;
    }
    const ang = (p: [number, number]) => Math.atan2(p[1] - s.c[1], p[0] - s.c[0]),
      a0 = ang(s.a);
    let am = ang(s.m) - a0,
      ab = ang(s.b) - a0;
    const norm = (x: number) => {
      while (x < 0) x += 2 * Math.PI;
      while (x >= 2 * Math.PI) x -= 2 * Math.PI;
      return x;
    };
    am = norm(am);
    ab = norm(ab);
    if (ab === 0) ab = 2 * Math.PI;
    const sweep = am < ab ? ab : ab - 2 * Math.PI,
      n = Math.max(2, Math.ceil(Math.abs(sweep) / (2 * Math.acos(Math.max(-1, 1 - sag / s.r)))));
    let px = s.a[0],
      py = s.a[1];
    for (let i = 1; i <= n; i++) {
      const t = a0 + (sweep * i) / n,
        qx = i === n ? s.b[0] : s.c[0] + s.r * Math.cos(t),
        qy = i === n ? s.b[1] : s.c[1] + s.r * Math.sin(t);
      edges.push([px, py, qx, qy]);
      px = qx;
      py = qy;
    }
  }
  return (p: [number, number]) => {
    let c = false;
    for (const [x1, y1, x2, y2] of edges) if (y1 > p[1] !== y2 > p[1] && p[0] < x1 + ((p[1] - y1) * (x2 - x1)) / (y2 - y1)) c = !c;
    return c;
  };
}
/** Grid over the bounding box of lines and arcs (arcs padded to their full circle). */
function gridOf(segs: Seg2[], h: number) {
  const xs = segs.flatMap((s) => (s.kind === 'arc' ? [s.c[0] - s.r, s.c[0] + s.r] : [s.a[0], s.b[0]])),
    ys = segs.flatMap((s) => (s.kind === 'arc' ? [s.c[1] - s.r, s.c[1] + s.r] : [s.a[1], s.b[1]]));
  const x0 = Math.min(...xs),
    y0 = Math.min(...ys);
  return { x0, y0, nx: Math.ceil((Math.max(...xs) - x0) / h) + 1, ny: Math.ceil((Math.max(...ys) - y0) / h) + 1 };
}
/** Grid points the inradius bound may visit; a finer grid is not tried past this. */
const INRADIUS_POINTS = 400_000;
/** Certified upper bound on a region's inradius: grid spacing h gives max over inside grid points + h/sqrt(2).
 * Null when the grid would exceed INRADIUS_POINTS: a thin region with a large box is not worth proving. */
export function inradiusBound(segs: Seg2[], h: number) {
  const { x0, y0, nx, ny } = gridOf(segs, h);
  if (nx * ny > INRADIUS_POINTS) return null;
  const sag = h / 100,
    inside = insideTest(segs, sag),
    near = nearestField(segs, h);
  let best = 0;
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < ny; j++) {
      const p: [number, number] = [x0 + i * h, y0 + j * h];
      if (inside(p)) best = Math.max(best, near(p));
    }
  return { sampled: best, bound: Math.max(best, sag) + h * Math.SQRT1_2, points: nx * ny };
}
