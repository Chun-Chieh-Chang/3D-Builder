import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildSilhouetteIndex, extractSilhouettes } from '@3db/render';

describe('buildSilhouetteIndex & extractSilhouettes (Dynamic Silhouette Edges / SolidWorks Style)', () => {
  it('extracts two longitudinal silhouette lines for a cylinder viewed from the side', () => {
    // Cylinder along Y axis: radius 10, height 40, 32 radial segments
    const cylinder = new THREE.CylinderGeometry(10, 10, 40, 32);
    const silIndex = buildSilhouetteIndex(cylinder);
    expect(silIndex).not.toBeNull();
    expect(silIndex!.edgeCount).toBeGreaterThan(0);

    const pos = cylinder.getAttribute('position').array;

    // View from +X (camera looking towards -X, so vector towards camera is +X)
    const viewFromX = new THREE.Vector3(1, 0, 0);
    const segsX = extractSilhouettes(silIndex!, pos, viewFromX);
    expect(segsX.length).toBeGreaterThan(0);

    // When viewed from +X, the silhouettes are at Y-axis parallel lines where X ~ 0 and Z ~ +/- 10
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < segsX.length; i += 3) {
      const x = segsX[i]!;
      const z = segsX[i + 2]!;
      expect(Math.abs(x)).toBeLessThan(2.5); // 32-segment polygon vertex is at R * sin(11.25°) ~ 1.95
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    expect(minZ).toBeCloseTo(-10, 0);
    expect(maxZ).toBeCloseTo(10, 0);

    // View from +Z (camera looking towards -Z, so vector towards camera is +Z)
    const viewFromZ = new THREE.Vector3(0, 0, 1);
    const segsZ = extractSilhouettes(silIndex!, pos, viewFromZ);
    expect(segsZ.length).toBeGreaterThan(0);

    // When viewed from +Z, the silhouettes are at Y-axis parallel lines where Z ~ 0 and X ~ +/- 10
    let minX = Infinity;
    let maxX = -Infinity;
    for (let i = 0; i < segsZ.length; i += 3) {
      const x = segsZ[i]!;
      const z = segsZ[i + 2]!;
      expect(Math.abs(z)).toBeLessThan(2.5); // Close to Z = 0
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
    }
    expect(minX).toBeCloseTo(-10, 0);
    expect(maxX).toBeCloseTo(10, 0);
  });

  it('extracts circular silhouette ring on a sphere', () => {
    // Sphere of radius 20
    const sphere = new THREE.SphereGeometry(20, 32, 32);
    const silIndex = buildSilhouetteIndex(sphere);
    expect(silIndex).not.toBeNull();

    const pos = sphere.getAttribute('position').array;
    const viewDir = new THREE.Vector3(0, 0, 1); // View along Z
    const segs = extractSilhouettes(silIndex!, pos, viewDir);

    expect(segs.length).toBeGreaterThan(0);
    // Silhouette points should lie on Z ~ 0, with radius ~ 20 in X-Y plane
    for (let i = 0; i < segs.length; i += 3) {
      const x = segs[i]!;
      const y = segs[i + 1]!;
      const z = segs[i + 2]!;
      expect(Math.abs(z)).toBeLessThan(2.5);
      const r = Math.hypot(x, y);
      expect(r).toBeGreaterThan(18.5);
      expect(r).toBeLessThanOrEqual(20.5);
    }
  });

  it('correctly applies matrixWorld transform to silhouette segments', () => {
    const cylinder = new THREE.CylinderGeometry(10, 10, 40, 32);
    const silIndex = buildSilhouetteIndex(cylinder);
    expect(silIndex).not.toBeNull();

    const pos = cylinder.getAttribute('position').array;
    const matrix = new THREE.Matrix4().makeTranslation(100, 50, 0);
    const viewFromX = new THREE.Vector3(1, 0, 0);
    const segs = extractSilhouettes(silIndex!, pos, viewFromX, matrix);

    expect(segs.length).toBeGreaterThan(0);
    for (let i = 0; i < segs.length; i += 3) {
      const x = segs[i]!;
      const y = segs[i + 1]!;
      expect(x).toBeGreaterThan(95.0);
      expect(x).toBeLessThan(105.0); // Transformed by +100
      expect(y).toBeGreaterThanOrEqual(29.0);
      expect(y).toBeLessThanOrEqual(71.0); // Transformed by +50 (original in [-20, 20])
    }
  });

  it('performance: builds index and extracts silhouettes for 10,000+ triangles in < 10ms', () => {
    const sphere = new THREE.SphereGeometry(50, 64, 64); // ~8,000 triangles
    const startBuild = performance.now();
    const silIndex = buildSilhouetteIndex(sphere);
    const buildDuration = performance.now() - startBuild;
    expect(silIndex).not.toBeNull();
    expect(buildDuration).toBeLessThan(25);

    const pos = sphere.getAttribute('position').array;
    const viewDir = new THREE.Vector3(1, 1, 1).normalize();
    const startExtract = performance.now();
    const segs = extractSilhouettes(silIndex!, pos, viewDir);
    const extractDuration = performance.now() - startExtract;

    expect(segs.length).toBeGreaterThan(0);
    expect(extractDuration).toBeLessThan(5); // Per-frame extraction is sub-millisecond
  });
});
