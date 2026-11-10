/**
 * A clamped (rational) B-spline in the plane: its point and first derivative, by de Boor's algorithm on the homogeneous poles, and the exact share
 * of a loop's area it sweeps. Pure geometry: no kernel. Used for the exact outlines of recognized B-spline walls (C1).
 */
export type P2 = [number, number];

export interface Nurbs2 {
  degree: number;
  poles: P2[];
  knots: number[];
  mults: number[];
  weights?: number[];
}

const flatKnots = (n: Nurbs2) => n.knots.flatMap((k, i) => Array<number>(n.mults[i]!).fill(k));

/** de Boor on homogeneous points `h` (x·w, y·w, w) of degree `p` with flat knots `U`, at `u` in span `k`. */
function deBoor(h: number[][], p: number, U: number[], k: number, u: number): number[] {
  const d = Array.from({ length: p + 1 }, (_, j) => [...h[k - p + j]!]);
  for (let r = 1; r <= p; r++) {
    for (let j = p; j >= r; j--) {
      const i = k - p + j;
      const den = U[i + p - r + 1]! - U[i]!;
      const a = den > 0 ? (u - U[i]!) / den : 0;
      d[j] = d[j]!.map((x, c) => d[j - 1]![c]! * (1 - a) + x * a);
    }
  }
  return d[p]!;
}

function span(U: number[], p: number, nPoles: number, u: number): number {
  let k = p;
  while (k < nPoles - 1 && U[k + 1]! <= u) k++;
  return k;
}

/** The point and derivative (by the curve's own parameter) at parameter `u` in [first knot, last knot]. */
export function nurbsEval(n: Nurbs2, u: number): { p: P2; d: P2 } {
  const p = n.degree;
  const U = flatKnots(n);
  const h = n.poles.map((q, i) => {
    const w = n.weights?.[i] ?? 1;
    return [q[0] * w, q[1] * w, w];
  });
  const A = deBoor(h, p, U, span(U, p, h.length, u), u);
  // the derivative's poles: p (h[i+1] − h[i]) / (U[i+p+1] − U[i+1]), degree p − 1 on U without its ends
  let dA = [0, 0, 0];
  if (p >= 1) {
    const q = h.slice(0, -1).map((hi, i) => {
      const den = U[i + p + 1]! - U[i + 1]!;
      return den > 0 ? hi.map((x, c) => (p * (h[i + 1]![c]! - x)) / den) : [0, 0, 0];
    });
    const V = U.slice(1, -1);
    dA = p === 1 ? q[span(V, 0, q.length, u)]! : deBoor(q, p - 1, V, span(V, p - 1, q.length, u), u);
  }
  const w = A[2]!;
  const pt: P2 = [A[0]! / w, A[1]! / w];
  return { p: pt, d: [(dA[0]! - dA[2]! * pt[0]) / w, (dA[1]! - dA[2]! * pt[1]) / w] };
}

/** The point at `t` from 0 (first pole) to 1 (last pole). */
export function nurbsAt(n: Nurbs2, t: number): P2 {
  const k0 = n.knots[0]!;
  const k1 = n.knots[n.knots.length - 1]!;
  return nurbsEval(n, k0 + (k1 - k0) * Math.min(1, Math.max(0, t))).p;
}

// 20-point Gauss–Legendre on [-1, 1]: exact for polynomials to degree 39 (a non-rational span's x·y' to degree 2p − 1), and far below 1e-12 for rational ones.
const GL = (() => {
  const n = 20;
  const xs: number[] = [];
  const ws: number[] = [];
  for (let i = 1; i <= n; i++) {
    let x = Math.cos((Math.PI * (i - 0.25)) / (n + 0.5));
    let dp = 0;
    for (let it = 0; it < 100; it++) {
      let p0 = 1;
      let p1 = x;
      for (let k = 2; k <= n; k++) [p0, p1] = [p1, ((2 * k - 1) * x * p1 - (k - 1) * p0) / k];
      dp = (n * (x * p1 - p0)) / (x * x - 1);
      const dx = p1 / dp;
      x -= dx;
      if (Math.abs(dx) < 1e-16) break;
    }
    xs.push(x);
    ws.push(2 / ((1 - x * x) * dp * dp));
  }
  return { xs, ws };
})();

/** The curve's share of a loop's signed area, ½∫(x dy − y dx), span by span. */
export function nurbsArea(n: Nurbs2): number {
  let area = 0;
  for (let s = 0; s < n.knots.length - 1; s++) {
    const [a, b] = [n.knots[s]!, n.knots[s + 1]!];
    const half = (b - a) / 2;
    for (let i = 0; i < GL.xs.length; i++) {
      const { p, d } = nurbsEval(n, a + half * (GL.xs[i]! + 1));
      area += GL.ws[i]! * half * (p[0] * d[1] - p[1] * d[0]) * 0.5;
    }
  }
  return area;
}

/** The same curve run the other way. */
export function nurbsReversed<N extends Nurbs2>(n: N): N {
  const [k0, k1] = [n.knots[0]!, n.knots[n.knots.length - 1]!];
  return { ...n, poles: [...n.poles].reverse(), knots: n.knots.map((k) => k0 + k1 - k).reverse(), mults: [...n.mults].reverse(), ...(n.weights ? { weights: [...n.weights].reverse() } : {}) };
}
