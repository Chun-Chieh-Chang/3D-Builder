/** Dense linear algebra for small systems (a few dozen to a few hundred unknowns), row-major. */

/** Solves (A + λI)·x = b for a symmetric positive semidefinite n×n A; null if the damped matrix is not positive definite. */
export function solveDamped(A: Float64Array, b: Float64Array, n: number, lambda: number): Float64Array | null {
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i * n + j]! + (i === j ? lambda : 0);
      for (let k = 0; k < j; k++) sum -= L[i * n + k]! * L[j * n + k]!;
      if (i === j) {
        if (!(sum > 0)) return null;
        L[i * n + i] = Math.sqrt(sum);
      } else {
        L[i * n + j] = sum / L[j * n + j]!;
      }
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = b[i]!;
    for (let k = 0; k < i; k++) sum -= L[i * n + k]! * y[k]!;
    y[i] = sum / L[i * n + i]!;
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i]!;
    for (let k = i + 1; k < n; k++) sum -= L[k * n + i]! * x[k]!;
    x[i] = sum / L[i * n + i]!;
  }
  return x;
}

/**
 * A basis of the null space of the symmetric positive semidefinite n×n matrix A = JᵀJ, by Cholesky
 * with symmetric pivoting: pivots that fall below `tol` × the largest diagonal end the factorization,
 * and the vectors the rest of the matrix leaves free are returned, orthonormal (n × count, row-major).
 * JᵀJ squares J's singular values, so `tol` is a squared ratio.
 */
export function nullSpace(A: Float64Array, n: number, tol = 1e-11): { basis: Float64Array; count: number } {
  const M = Float64Array.from(A);
  const perm = [...Array(n).keys()];
  const top = Math.max(0, ...Array.from({ length: n }, (_, i) => A[i * n + i]!));
  let rank = 0;
  for (; rank < n; rank++) {
    let best = rank;
    for (let i = rank + 1; i < n; i++) if (M[i * n + i]! > M[best * n + best]!) best = i;
    if (!(M[best * n + best]! > tol * top) || top === 0) break;
    swap(M, n, rank, best);
    [perm[rank], perm[best]] = [perm[best]!, perm[rank]!];
    const d = Math.sqrt(M[rank * n + rank]!);
    M[rank * n + rank] = d;
    for (let i = rank + 1; i < n; i++) M[i * n + rank] = M[i * n + rank]! / d;
    for (let i = rank + 1; i < n; i++) for (let j = rank + 1; j <= i; j++) M[i * n + j] = M[i * n + j]! - M[i * n + rank]! * M[j * n + rank]!;
    for (let i = rank + 1; i < n; i++) for (let j = i + 1; j < n; j++) M[i * n + j] = M[j * n + i]!; // keep it symmetric for the pivot search
  }
  const count = n - rank;
  // With A = [L11 0; L21 ·]·[L11 0; L21 ·]ᵀ, the null vectors are [−L11⁻ᵀ·L21ᵀ·y; y].
  const basis = new Float64Array(n * count);
  for (let c = 0; c < count; c++) {
    const v = new Float64Array(n);
    v[rank + c] = 1;
    for (let i = rank - 1; i >= 0; i--) {
      let s = M[(rank + c) * n + i]!;
      for (let k = i + 1; k < rank; k++) s += M[k * n + i]! * v[k]!;
      v[i] = -s / M[i * n + i]!;
    }
    for (let i = 0; i < n; i++) basis[perm[i]! * count + c] = v[i]!;
  }
  orthonormalize(basis, n, count);
  return { basis, count };
}

function swap(M: Float64Array, n: number, a: number, b: number): void {
  if (a === b) return;
  for (let k = 0; k < n; k++) [M[a * n + k], M[b * n + k]] = [M[b * n + k]!, M[a * n + k]!];
  for (let k = 0; k < n; k++) [M[k * n + a], M[k * n + b]] = [M[k * n + b]!, M[k * n + a]!];
}

/** Gram–Schmidt (twice, for accuracy) on the columns of the n × count matrix B. */
function orthonormalize(B: Float64Array, n: number, count: number): void {
  for (let c = 0; c < count; c++) {
    for (let pass = 0; pass < 2; pass++) {
      for (let p = 0; p < c; p++) {
        let d = 0;
        for (let i = 0; i < n; i++) d += B[i * count + c]! * B[i * count + p]!;
        for (let i = 0; i < n; i++) B[i * count + c] = B[i * count + c]! - d * B[i * count + p]!;
      }
    }
    let s = 0;
    for (let i = 0; i < n; i++) s += B[i * count + c]! ** 2;
    s = Math.sqrt(s) || 1;
    for (let i = 0; i < n; i++) B[i * count + c] = B[i * count + c]! / s;
  }
}

/** Rank of a small r×c matrix (row-major): the number of singular values above `tol`. */
export function rank(M: Float64Array, r: number, c: number, tol: number): number {
  // Eigenvalues of the r×r Gram matrix M·Mᵀ by cyclic Jacobi; r is at most 6 here.
  const G = new Float64Array(r * r);
  for (let i = 0; i < r; i++) for (let j = 0; j < r; j++) for (let k = 0; k < c; k++) G[i * r + j] = G[i * r + j]! + M[i * c + k]! * M[j * c + k]!;
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < r; p++) for (let q = p + 1; q < r; q++) off += G[p * r + q]! ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < r; p++) {
      for (let q = p + 1; q < r; q++) {
        const apq = G[p * r + q]!;
        if (Math.abs(apq) < 1e-300) continue;
        const theta = (G[q * r + q]! - G[p * r + p]!) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const cs = 1 / Math.sqrt(t * t + 1);
        const sn = t * cs;
        for (let k = 0; k < r; k++) {
          const gkp = G[k * r + p]!;
          const gkq = G[k * r + q]!;
          G[k * r + p] = cs * gkp - sn * gkq;
          G[k * r + q] = sn * gkp + cs * gkq;
        }
        for (let k = 0; k < r; k++) {
          const gpk = G[p * r + k]!;
          const gqk = G[q * r + k]!;
          G[p * r + k] = cs * gpk - sn * gqk;
          G[q * r + k] = sn * gpk + cs * gqk;
        }
      }
    }
  }
  let count = 0;
  for (let i = 0; i < r; i++) if (G[i * r + i]! > tol * tol) count++;
  return count;
}
