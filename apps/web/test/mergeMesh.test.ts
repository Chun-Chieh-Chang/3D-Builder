import { describe, expect, it } from 'vitest';
import type { MeshData } from '@3db/kernel';
import { mergeMeshes } from '../src/worker/mergeMesh';

/** One triangle as face `face`, one edge as edge 0, at x = x. */
const tri = (x: number): MeshData => ({
  positions: Float32Array.from([x, 0, 0, x + 1, 0, 0, x, 1, 0]),
  normals: Float32Array.from([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  indices: Uint32Array.from([0, 1, 2]),
  faceRanges: Int32Array.from([0, 3, 0]),
  edgePoints: Float32Array.from([x, 0, 0, x + 1, 0, 0]),
  edgeRanges: Int32Array.from([0, 2, 0]),
});

describe('mergeMeshes (C7.1, D4.6)', () => {
  it('puts the meshes one after the other with their triangles, faces and edges numbered as the bodies are', () => {
    const m = mergeMeshes([
      { mesh: tri(0), face0: 0, edge0: 0 },
      { mesh: tri(10), face0: 6, edge0: 12 },
    ]);
    expect([...m.indices]).toEqual([0, 1, 2, 3, 4, 5]);
    expect([...m.faceRanges]).toEqual([0, 3, 0, 3, 3, 6]); // second body's face is number 6 and starts at its own triangle
    expect([...m.edgeRanges]).toEqual([0, 2, 0, 2, 2, 12]); // its edge is number 12 and starts at its own point
    expect(m.positions[9]).toBe(10);
    expect(m.edgePoints[6]).toBe(10);
  });

  it('is nothing when no body is shown, and one body unchanged when only one is', () => {
    expect(mergeMeshes([]).indices).toHaveLength(0);
    const one = mergeMeshes([{ mesh: tri(0), face0: 6, edge0: 12 }]);
    expect([...one.faceRanges]).toEqual([0, 3, 6]);
    expect([...one.edgeRanges]).toEqual([0, 2, 12]);
  });
});
