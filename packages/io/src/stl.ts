/**
 * Binary STL (F4.1): 80 bytes of header, the number of triangles, then for each its normal, three corners and two bytes of attributes (little-endian).
 * A mesh's triangles already run counter-clockwise seen from outside, so the facet normals come from the corners.
 */
export function binaryStl(meshes: readonly { positions: ArrayLike<number>; indices: ArrayLike<number> }[], name = '3D-Builder'): Uint8Array {
  const triangles = meshes.reduce((n, m) => n + m.indices.length / 3, 0);
  const out = new Uint8Array(84 + 50 * triangles);
  const view = new DataView(out.buffer);
  out.set(new TextEncoder().encode(`binary STL ${name}`.slice(0, 80)));
  view.setUint32(80, triangles, true);
  let at = 84;
  for (const m of meshes) {
    const p = m.positions;
    for (let t = 0; t < m.indices.length; t += 3) {
      const [a, b, c] = [m.indices[t]! * 3, m.indices[t + 1]! * 3, m.indices[t + 2]! * 3];
      const u = [p[b]! - p[a]!, p[b + 1]! - p[a + 1]!, p[b + 2]! - p[a + 2]!];
      const v = [p[c]! - p[a]!, p[c + 1]! - p[a + 1]!, p[c + 2]! - p[a + 2]!];
      const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
      const len = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
      for (const x of [n[0]! / len, n[1]! / len, n[2]! / len, p[a]!, p[a + 1]!, p[a + 2]!, p[b]!, p[b + 1]!, p[b + 2]!, p[c]!, p[c + 1]!, p[c + 2]!]) {
        view.setFloat32(at, x, true);
        at += 4;
      }
      at += 2;
    }
  }
  return out;
}

/** The triangles of a binary STL, for reading back: three corners each. */
export function readBinaryStl(bytes: Uint8Array): Float32Array[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(80, true);
  if (bytes.byteLength !== 84 + 50 * count) throw new Error('not a binary STL');
  const out: Float32Array[] = [];
  for (let i = 0; i < count; i++) {
    const at = 84 + 50 * i + 12;
    out.push(Float32Array.from({ length: 9 }, (_, k) => view.getFloat32(at + 4 * k, true)));
  }
  return out;
}

/** The volume a closed STL encloses (the signed volumes of the tetrahedra from the origin), and its surface area. */
export function stlMeasure(triangles: readonly Float32Array[]): { volume: number; area: number } {
  let volume = 0;
  let area = 0;
  for (const t of triangles) {
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = t as unknown as number[];
    volume += (ax! * (by! * cz! - bz! * cy!) - ay! * (bx! * cz! - bz! * cx!) + az! * (bx! * cy! - by! * cx!)) / 6;
    const u = [bx! - ax!, by! - ay!, bz! - az!];
    const v = [cx! - ax!, cy! - ay!, cz! - az!];
    area += Math.hypot(u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!) / 2;
  }
  return { volume, area };
}
