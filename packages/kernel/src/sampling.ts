/**
 * Points to measure at on a mesh (Phase 6-2, 6-3): the analyses that shoot rays (undercut, thickness) used the centre of every triangle, but a flat face is two triangles, so
 * a wall that thickens along a big flat face, or a face half in the shadow of an overhang, was judged by two points. Here the triangles of a face are divided (each into k²
 * smaller ones, the point at the middle of each) until the face has at least `minPerFace` points, k at most 40; with more than `maxSamples` points in all, k is
 * brought down, and if every triangle at one point is still too many, every few triangles are used.
 */

export interface SampleMesh {
  positions: ArrayLike<number>;
  indices: ArrayLike<number>;
  /** Triplets (start index, index count, face number) into `indices`. */
  faceRanges: ArrayLike<number>;
}

/** Calls `visit(face, triangle, point, normal, weight)` for every point: the triangle's number in the mesh, the point on it, the triangle's outward unit normal (the mesh's winding is outward) and the area the point stands for. */
export function forEachSample(
  mesh: SampleMesh,
  options: { minPerFace?: number; maxSamples: number },
  visit: (face: number, triangle: number, point: [number, number, number], normal: [number, number, number], weight: number) => void,
): number {
  const minPerFace = options.minPerFace ?? 400;
  const corner = (v: number): [number, number, number] => [mesh.positions[3 * v]!, mesh.positions[3 * v + 1]!, mesh.positions[3 * v + 2]!];
  const ks: number[] = [];
  let total = 0;
  let triangles = 0;
  for (let r = 0; r < mesh.faceRanges.length; r += 3) {
    const n = mesh.faceRanges[r + 1]! / 3;
    const k = Math.max(1, Math.min(40, Math.ceil(Math.sqrt(minPerFace / Math.max(1, n)))));
    ks.push(k);
    total += n * k * k;
    triangles += n;
  }
  if (total > options.maxSamples) {
    const scale = Math.sqrt(options.maxSamples / total);
    for (let i = 0; i < ks.length; i++) ks[i] = Math.max(1, Math.floor(ks[i]! * scale));
  }
  const stride = Math.max(1, Math.ceil(triangles / options.maxSamples));
  let count = 0;
  for (let r = 0, f = 0; r < mesh.faceRanges.length; r += 3, f++) {
    const [from, n, face] = [mesh.faceRanges[r]!, mesh.faceRanges[r + 1]!, mesh.faceRanges[r + 2]!];
    const k = ks[f]!;
    for (let i = from, tri = 0; i < from + n; i += 3, tri++) {
      if (tri % stride !== 0) continue;
      const [a, b, c] = [corner(mesh.indices[i]!), corner(mesh.indices[i + 1]!), corner(mesh.indices[i + 2]!)];
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const cr = [e1[1]! * e2[2]! - e1[2]! * e2[1]!, e1[2]! * e2[0]! - e1[0]! * e2[2]!, e1[0]! * e2[1]! - e1[1]! * e2[0]!];
      const twice = Math.hypot(cr[0]!, cr[1]!, cr[2]!);
      if (twice < 1e-12) continue;
      const normal: [number, number, number] = [cr[0]! / twice, cr[1]! / twice, cr[2]! / twice];
      const weight = twice / 2 / (k * k);
      const at = (u: number, v: number): [number, number, number] => [a[0] + (e1[0]! * u + e2[0]! * v) / k, a[1] + (e1[1]! * u + e2[1]! * v) / k, a[2] + (e1[2]! * u + e2[2]! * v) / k];
      const triangle = i / 3;
      for (let u = 0; u < k; u++) {
        for (let v = 0; v < k - u; v++) {
          visit(face, triangle, at(u + 1 / 3, v + 1 / 3), normal, weight); // the sub-triangle that points the way the triangle does
          count++;
          if (v < k - u - 1) {
            visit(face, triangle, at(u + 2 / 3, v + 2 / 3), normal, weight); // and the one between two of those
            count++;
          }
        }
      }
    }
  }
  return count;
}
