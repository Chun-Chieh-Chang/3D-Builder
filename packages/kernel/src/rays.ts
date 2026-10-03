/**
 * Rays against a triangle mesh (Phase 6-2, E3.3): a bounding-volume tree over the triangles and an "is anything in the way" test. The brute-force test of the 6-0 validation is
 * O(N²) over a mesh and does for a few hundred triangles; a real part has 10⁴ to 10⁵, so the triangles are put in a tree (split at the median of their centres along the
 * longest side, four to a leaf) and a ray visits only the boxes it crosses.
 */

export interface Bvh {
  /** xyz of the three corners of triangle i at 9 i. */
  readonly corners: Float64Array;
  /** The triangles in the order the leaves hold them (their numbers in the mesh). */
  readonly order: Int32Array;
  /** Per node: min xyz then max xyz. */
  readonly bounds: Float64Array;
  /** Per node: the left and the right child of an inner node, −1 for a leaf. */
  readonly left: Int32Array;
  readonly right: Int32Array;
  /** Per node: for a leaf the first position in `order` and how many triangles. */
  readonly start: Int32Array;
  readonly count: Int32Array;
  readonly nodes: number;
}

const LEAF = 4;

/** The tree of the triangles `indices` (three vertex numbers each) of `positions` (xyz per vertex). */
export function buildBvh(positions: ArrayLike<number>, indices: ArrayLike<number>): Bvh {
  const n = Math.floor(indices.length / 3);
  const corners = new Float64Array(9 * n);
  const centre = new Float64Array(3 * n);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const v = indices[3 * i + k]!;
      for (let a = 0; a < 3; a++) {
        const x = positions[3 * v + a]!;
        corners[9 * i + 3 * k + a] = x;
        centre[3 * i + a] = centre[3 * i + a]! + x / 3;
      }
    }
  }
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  // a leaf holds at least one triangle and an inner node splits at the middle, so there are fewer than 2 n nodes
  const cap = Math.max(1, 2 * n);
  const bounds = new Float64Array(6 * cap);
  const left = new Int32Array(cap).fill(-1);
  const right = new Int32Array(cap).fill(-1);
  const start = new Int32Array(cap);
  const count = new Int32Array(cap);
  let nodes = 0;

  const build = (from: number, to: number): number => {
    const node = nodes++;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    const clo = [Infinity, Infinity, Infinity];
    const chi = [-Infinity, -Infinity, -Infinity];
    for (let p = from; p < to; p++) {
      const t = order[p]!;
      for (let a = 0; a < 3; a++) {
        for (let k = 0; k < 3; k++) {
          const x = corners[9 * t + 3 * k + a]!;
          if (x < lo[a]!) lo[a] = x;
          if (x > hi[a]!) hi[a] = x;
        }
        const c = centre[3 * t + a]!;
        if (c < clo[a]!) clo[a] = c;
        if (c > chi[a]!) chi[a] = c;
      }
    }
    bounds.set([...lo, ...hi], 6 * node);
    if (to - from <= LEAF) {
      start[node] = from;
      count[node] = to - from;
      return node;
    }
    const sides = [chi[0]! - clo[0]!, chi[1]! - clo[1]!, chi[2]! - clo[2]!];
    const axis = sides[0]! >= sides[1]! && sides[0]! >= sides[2]! ? 0 : sides[1]! >= sides[2]! ? 1 : 2;
    const sorted = Array.from(order.subarray(from, to)).sort((a, b) => centre[3 * a + axis]! - centre[3 * b + axis]!);
    order.set(sorted, from);
    const mid = (from + to) >> 1;
    left[node] = build(from, mid);
    right[node] = build(mid, to);
    return node;
  };
  if (n > 0) build(0, n);
  return { corners, order, bounds, left, right, start, count, nodes };
}

/**
 * Whether the ray from `o` along the unit vector `d` meets a triangle other than `skip` (a triangle's number in the mesh, or −1): the first hit is enough.
 * The boxes the ray crosses are visited (a stack, the nearer child last so it comes first); in a leaf, Möller–Trumbore against each triangle. A hit has to be
 * farther than `tmin` along the ray.
 */
export function anyHit(bvh: Bvh, o: readonly [number, number, number], d: readonly [number, number, number], skip = -1, tmin = 1e-9): boolean {
  if (bvh.nodes === 0) return false;
  const inv = [d[0] === 0 ? Infinity : 1 / d[0], d[1] === 0 ? Infinity : 1 / d[1], d[2] === 0 ? Infinity : 1 / d[2]];
  const c = bvh.corners;
  const stack = [0];
  while (stack.length > 0) {
    const node = stack.pop()!;
    // the slab test: the ray's parameter range inside the box
    let t0 = tmin;
    let t1 = Infinity;
    let miss = false;
    for (let a = 0; a < 3; a++) {
      const lo = bvh.bounds[6 * node + a]!;
      const hi = bvh.bounds[6 * node + 3 + a]!;
      const da = d[a]!;
      const oa = o[a]!;
      if (da === 0) {
        if (oa < lo - 1e-9 || oa > hi + 1e-9) {
          miss = true;
          break;
        }
        continue;
      }
      let ta = (lo - oa) * inv[a]!;
      let tb = (hi - oa) * inv[a]!;
      if (ta > tb) [ta, tb] = [tb, ta];
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1 + 1e-9) {
        miss = true;
        break;
      }
    }
    if (miss) continue;
    if (bvh.left[node]! >= 0) {
      stack.push(bvh.right[node]!, bvh.left[node]!);
      continue;
    }
    for (let p = bvh.start[node]!; p < bvh.start[node]! + bvh.count[node]!; p++) {
      const t = bvh.order[p]!;
      if (t === skip) continue;
      const b = 9 * t;
      const e1x = c[b + 3]! - c[b]!, e1y = c[b + 4]! - c[b + 1]!, e1z = c[b + 5]! - c[b + 2]!;
      const e2x = c[b + 6]! - c[b]!, e2y = c[b + 7]! - c[b + 1]!, e2z = c[b + 8]! - c[b + 2]!;
      const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-14) continue;
      const idet = 1 / det;
      const sx = o[0] - c[b]!, sy = o[1] - c[b + 1]!, sz = o[2] - c[b + 2]!;
      const u = (sx * px + sy * py + sz * pz) * idet;
      if (u < -1e-9 || u > 1 + 1e-9) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const v = (d[0] * qx + d[1] * qy + d[2] * qz) * idet;
      if (v < -1e-9 || u + v > 1 + 1e-9) continue;
      if ((e2x * qx + e2y * qy + e2z * qz) * idet > tmin) return true;
    }
  }
  return false;
}

/** Where the ray enters the box of `node` (its parameter, at least `tmin`), or Infinity when it misses the box or leaves it before `tmax`. */
function entry(bvh: Bvh, node: number, o: readonly number[], d: readonly number[], inv: readonly number[], tmin: number, tmax: number): number {
  let t0 = tmin;
  let t1 = tmax;
  for (let a = 0; a < 3; a++) {
    const lo = bvh.bounds[6 * node + a]!;
    const hi = bvh.bounds[6 * node + 3 + a]!;
    const da = d[a]!;
    const oa = o[a]!;
    if (da === 0) {
      if (oa < lo - 1e-9 || oa > hi + 1e-9) return Infinity;
      continue;
    }
    let ta = (lo - oa) * inv[a]!;
    let tb = (hi - oa) * inv[a]!;
    if (ta > tb) [ta, tb] = [tb, ta];
    if (ta > t0) t0 = ta;
    if (tb < t1) t1 = tb;
    if (t0 > t1 + 1e-9) return Infinity;
  }
  return t0;
}

/**
 * The nearest triangle other than `skip` that the ray from `o` along the unit vector `d` meets (thickness analysis, E3.5: the surface on the other side of the wall): how
 * far along the ray it is, and its number in the mesh; Infinity and −1 when it meets none. A box is visited only if the ray enters it before the nearest hit found so far,
 * the nearer child first.
 */
export function nearestHitAt(bvh: Bvh, o: readonly [number, number, number], d: readonly [number, number, number], skip = -1, tmin = 1e-9): { distance: number; triangle: number } {
  if (bvh.nodes === 0) return { distance: Infinity, triangle: -1 };
  const inv = [d[0] === 0 ? Infinity : 1 / d[0], d[1] === 0 ? Infinity : 1 / d[1], d[2] === 0 ? Infinity : 1 / d[2]];
  const c = bvh.corners;
  let best = Infinity;
  let at = -1;
  const stack = [0];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (entry(bvh, node, o, d, inv, tmin, best) === Infinity) continue;
    if (bvh.left[node]! >= 0) {
      const l = bvh.left[node]!;
      const r = bvh.right[node]!;
      // the farther child goes in first, so the nearer one comes out first
      if (entry(bvh, l, o, d, inv, tmin, best) <= entry(bvh, r, o, d, inv, tmin, best)) stack.push(r, l);
      else stack.push(l, r);
      continue;
    }
    for (let p = bvh.start[node]!; p < bvh.start[node]! + bvh.count[node]!; p++) {
      const t = bvh.order[p]!;
      if (t === skip) continue;
      const b = 9 * t;
      const e1x = c[b + 3]! - c[b]!, e1y = c[b + 4]! - c[b + 1]!, e1z = c[b + 5]! - c[b + 2]!;
      const e2x = c[b + 6]! - c[b]!, e2y = c[b + 7]! - c[b + 1]!, e2z = c[b + 8]! - c[b + 2]!;
      const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-14) continue;
      const idet = 1 / det;
      const sx = o[0] - c[b]!, sy = o[1] - c[b + 1]!, sz = o[2] - c[b + 2]!;
      const u = (sx * px + sy * py + sz * pz) * idet;
      if (u < -1e-9 || u > 1 + 1e-9) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const v = (d[0] * qx + d[1] * qy + d[2] * qz) * idet;
      if (v < -1e-9 || u + v > 1 + 1e-9) continue;
      const dist = (e2x * qx + e2y * qy + e2z * qz) * idet;
      if (dist > tmin && dist < best) {
        best = dist;
        at = t;
      }
    }
  }
  return { distance: best, triangle: at };
}

/** How far along the ray the nearest triangle other than `skip` is, or Infinity when it meets none (see `nearestHitAt`). */
export function nearestHit(bvh: Bvh, o: readonly [number, number, number], d: readonly [number, number, number], skip = -1, tmin = 1e-9): number {
  return nearestHitAt(bvh, o, d, skip, tmin).distance;
}

/** The outward unit normal of triangle `t` of the mesh (the winding of the mesh is outward). */
export function triangleNormal(bvh: Bvh, t: number): [number, number, number] {
  const c = bvh.corners;
  const b = 9 * t;
  const e1 = [c[b + 3]! - c[b]!, c[b + 4]! - c[b + 1]!, c[b + 5]! - c[b + 2]!];
  const e2 = [c[b + 6]! - c[b]!, c[b + 7]! - c[b + 1]!, c[b + 8]! - c[b + 2]!];
  const n = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
  const len = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
  return [n[0]! / len, n[1]! / len, n[2]! / len];
}
