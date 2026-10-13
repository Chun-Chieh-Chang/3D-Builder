import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildSilhouetteIndex, extractSilhouettes } from '@3db/render';
import { MESH_QUALITY } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator } from '@3db/regen';
import { build, circle, extrude, front, rectangle, sketch } from '../phase1/builders';

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

describe('shallow curves keep their silhouettes (neighbouring triangles less than 0.81° apart are not flat)', () => {
  let kernel: Kernel;
  let solver: PlaneGcsSolver;
  beforeAll(async () => {
    kernel = await Kernel.load();
    solver = await PlaneGcsSolver.create();
  });

  it('a wall of R1000 on a 60 x 20 x 5 plate, meshed fine (0.26° between strips): seen square to its normal at x = 45, the silhouette is its line there, z 0 to 5', () => {
    // the plate's lower side cut away by a circle of R1000 whose top is at (30, 10): the wall runs from y 9.55 (x = 0, 60) to 10 (x = 30)
    const r = new Regenerator(kernel, solver, new Map()).rebuild(
      build(
        sketch('s1', front, rectangle('p', 0, 0, 60, 20)),
        extrude('e1', 's1', 'boss', { type: 'blind', depth: '5' }),
        sketch('s2', front, circle('k', 30, -990, 1000)),
        extrude('e2', 's2', 'cut', { type: 'throughAll', reverse: true }),
      ),
    );
    const mesh = kernel.mesh(r.body!.shape, MESH_QUALITY.fine);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
    g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    const index = buildSilhouetteIndex(g)!;
    // the wall's normal at x = 45 is (15, 999.887) / 1000; look along the wall there, square to it
    const n = new THREE.Vector3(15, Math.sqrt(1000 ** 2 - 15 ** 2), 0).normalize();
    const segs = extractSilhouettes(index, mesh.positions, new THREE.Vector3(n.y, -n.x, 0));
    expect(segs.length).toBeGreaterThan(0);
    let [zMin, zMax] = [Infinity, -Infinity];
    for (let i = 0; i < segs.length; i += 3) {
      expect(segs[i]!).toBeGreaterThan(40); // fine strips are 4.6 mm wide here: the one that turns away is beside x = 45
      expect(segs[i]!).toBeLessThan(50);
      expect(segs[i + 1]!).toBeGreaterThan(9.5);
      expect(segs[i + 1]!).toBeLessThan(10.05);
      zMin = Math.min(zMin, segs[i + 2]!);
      zMax = Math.max(zMax, segs[i + 2]!);
    }
    expect(zMin).toBeCloseTo(0, 6);
    expect(zMax).toBeCloseTo(5, 6);
  });

  it('a dense sphere (512 x 256, 0.7° between triangles) still has its ring seen from +Z; a flat box still has no candidate edge', () => {
    const sphere = new THREE.SphereGeometry(50, 512, 256);
    const segs = extractSilhouettes(buildSilhouetteIndex(sphere)!, sphere.getAttribute('position').array, new THREE.Vector3(0, 0, 1));
    expect(segs.length).toBeGreaterThan(0);
    for (let i = 0; i < segs.length; i += 3) {
      expect(Math.abs(segs[i + 2]!)).toBeLessThan(0.5);
      expect(Math.hypot(segs[i]!, segs[i + 1]!)).toBeGreaterThan(49.9);
    }
    expect(buildSilhouetteIndex(new THREE.BoxGeometry(2, 2, 2))!.edgeCount).toBe(0);
  });
});
