import type { MeshData } from '@3db/kernel';

/**
 * One mesh of several bodies' meshes (C7.1, D4.6): what is drawn when some body is hidden. Each body was meshed on its own, so
 * its faces and edges are numbered from 0; `face0` and `edge0` are where its elements start in the numbering of all the
 * bodies, which is the numbering of the names and fingerprints. Nothing is drawn of a body that is not given.
 */
export function mergeMeshes(parts: { mesh: MeshData; face0: number; edge0: number }[]): MeshData {
  const count = (pick: (m: MeshData) => number) => parts.reduce((n, p) => n + pick(p.mesh), 0);
  const positions = new Float32Array(count((m) => m.positions.length));
  const normals = new Float32Array(count((m) => m.normals.length));
  const indices = new Uint32Array(count((m) => m.indices.length));
  const faceRanges = new Int32Array(count((m) => m.faceRanges.length));
  const edgePoints = new Float32Array(count((m) => m.edgePoints.length));
  const edgeRanges = new Int32Array(count((m) => m.edgeRanges.length));
  let vertex = 0; // in floats
  let index = 0;
  let face = 0;
  let point = 0; // in floats
  let edge = 0;
  for (const { mesh, face0, edge0 } of parts) {
    positions.set(mesh.positions, vertex);
    normals.set(mesh.normals, vertex);
    const base = vertex / 3;
    for (let i = 0; i < mesh.indices.length; i++) indices[index + i] = mesh.indices[i]! + base;
    for (let r = 0; r < mesh.faceRanges.length; r += 3) {
      faceRanges[face + r] = mesh.faceRanges[r]! + index;
      faceRanges[face + r + 1] = mesh.faceRanges[r + 1]!;
      faceRanges[face + r + 2] = mesh.faceRanges[r + 2]! + face0;
    }
    edgePoints.set(mesh.edgePoints, point);
    for (let r = 0; r < mesh.edgeRanges.length; r += 3) {
      edgeRanges[edge + r] = mesh.edgeRanges[r]! + point / 3;
      edgeRanges[edge + r + 1] = mesh.edgeRanges[r + 1]!;
      edgeRanges[edge + r + 2] = mesh.edgeRanges[r + 2]! + edge0;
    }
    vertex += mesh.positions.length;
    index += mesh.indices.length;
    face += mesh.faceRanges.length;
    point += mesh.edgePoints.length;
    edge += mesh.edgeRanges.length;
  }
  return { positions, normals, indices, faceRanges, edgePoints, edgeRanges };
}
