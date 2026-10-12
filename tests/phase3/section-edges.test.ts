import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { sliceMeshByPlane } from '@3db/render';

describe('sliceMeshByPlane (ADR 0042 / Section Cut Edges)', () => {
  it('slices a box geometry at Z = 0 and returns closed outline segments', () => {
    // 20x20x20 box centered at origin: X in [-10, 10], Y in [-10, 10], Z in [-10, 10]
    const box = new THREE.BoxGeometry(20, 20, 20);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0); // Z = 0
    const segs = sliceMeshByPlane(box, plane);

    // Box has 12 triangles (2 per face). The 4 side faces cross Z = 0 -> 8 triangles cut -> 8 segments = 48 numbers
    expect(segs.length).toBe(48);

    // All points must lie on Z = 0
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < segs.length; i += 3) {
      const x = segs[i]!;
      const y = segs[i + 1]!;
      const z = segs[i + 2]!;
      expect(Math.abs(z)).toBeLessThan(1e-5);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }

    expect(minX).toBeCloseTo(-10, 4);
    expect(maxX).toBeCloseTo(10, 4);
    expect(minY).toBeCloseTo(-10, 4);
    expect(maxY).toBeCloseTo(10, 4);
  });

  it('returns empty array when plane does not intersect the geometry', () => {
    const box = new THREE.BoxGeometry(20, 20, 20);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -50); // Z = 50 (outside box [-10, 10])
    const segs = sliceMeshByPlane(box, plane);
    expect(segs).toEqual([]);
  });

  it('correctly applies matrixWorld transformation to resulting cut segments', () => {
    const box = new THREE.BoxGeometry(20, 20, 20);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const matrix = new THREE.Matrix4().makeTranslation(100, 50, 0);
    const segs = sliceMeshByPlane(box, plane, matrix);

    expect(segs.length).toBe(48);
    for (let i = 0; i < segs.length; i += 3) {
      const x = segs[i]!;
      const y = segs[i + 1]!;
      const z = segs[i + 2]!;
      expect(Math.abs(z)).toBeLessThan(1e-5);
      expect(x).toBeGreaterThanOrEqual(89.99);
      expect(x).toBeLessThanOrEqual(110.01);
      expect(y).toBeGreaterThanOrEqual(39.99);
      expect(y).toBeLessThanOrEqual(60.01);
    }
  });

  it('slices non-indexed geometry correctly', () => {
    const indexed = new THREE.BoxGeometry(20, 20, 20);
    const nonIndexed = indexed.toNonIndexed();
    const plane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0); // X = 0
    const segs = sliceMeshByPlane(nonIndexed, plane);

    expect(segs.length).toBe(48);
    for (let i = 0; i < segs.length; i += 3) {
      const x = segs[i]!;
      expect(Math.abs(x)).toBeLessThan(1e-5);
    }
  });

  it('performance: slices 10,000+ triangles in less than 15ms', () => {
    // Sphere with high segment count has thousands of triangles
    const sphere = new THREE.SphereGeometry(50, 64, 64);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const start = performance.now();
    const segs = sliceMeshByPlane(sphere, plane);
    const duration = performance.now() - start;

    expect(segs.length).toBeGreaterThan(0);
    expect(duration).toBeLessThan(15);
  });
});
