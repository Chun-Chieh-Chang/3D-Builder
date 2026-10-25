import * as THREE from 'three';
import type { PlaneFrame } from './overlay';

const DEFAULT_FRAME: PlaneFrame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };

/** A grid anchored to a real work plane. Orbiting never changes the plane or its origin. */
export function referenceGrid(camera: THREE.OrthographicCamera, height: number, spacing: number, frame: PlaneFrame = DEFAULT_FRAME): { minor: number[]; major: number[] } {
  const minor: number[] = [], major: number[] = [];
  if (!(height > 0) || !Number.isFinite(height) || !(spacing > 0) || !Number.isFinite(spacing)) return { minor, major };
  const tuples = [frame.origin, frame.xDir, frame.yDir, frame.normal];
  if (tuples.some(v => v.length !== 3 || !v.every(Number.isFinite))) return { minor, major };
  const [origin, xDir, yDir, normal] = tuples.map(v => new THREE.Vector3(...v)) as [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3];
  if ([xDir, yDir, normal].some(v => Math.abs(v.lengthSq() - 1) > 1e-6) || Math.abs(xDir.dot(yDir)) > 1e-6 || xDir.clone().cross(yDir).dot(normal) < 1 - 1e-6) return { minor, major };
  camera.updateMatrixWorld();
  const points: THREE.Vector2[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) {
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(x, y), camera);
    // A work plane can be behind the near plane after a pan; intersect the infinite line.
    const denominator = normal.dot(ray.ray.direction);
    // Edge-on has no visible plane area. Never substitute a different plane.
    if (Math.abs(denominator) < 1e-8) return { minor, major };
    const p = ray.ray.origin.clone().addScaledVector(ray.ray.direction, normal.dot(origin.clone().sub(ray.ray.origin)) / denominator).sub(origin);
    points.push(new THREE.Vector2(p.dot(xDir), p.dot(yDir)));
  }
  if (points.some(p => !p.toArray().every(Number.isFinite))) return { minor, major };
  const lo = [0, 1].map(a => Math.min(...points.map(p => p.getComponent(a))));
  const hi = [0, 1].map(a => Math.max(...points.map(p => p.getComponent(a))));
  const px = (camera.top - camera.bottom) / (camera.zoom * height);
  const wanted = Math.max(spacing, px * 16, (hi[0]! - lo[0]! + hi[1]! - lo[1]!) / 400);
  const decade = 10 ** Math.floor(Math.log10(wanted / spacing));
  const factor = [1, 2, 5, 10].find(k => spacing * decade * k >= wanted)!;
  const step = spacing * decade * factor;
  if (!(step > 0) || !Number.isFinite(step)) return { minor, major };
  for (let a = 0; a < 2; a++) {
    const first = Math.ceil(lo[a]! / step), last = Math.floor(hi[a]! / step);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || last - first > 600) return { minor: [], major: [] };
    for (let index = first; index <= last; index++) {
      const uv0 = [0, 0], uv1 = [0, 0];
      uv0[a] = uv1[a] = index * step;
      uv0[1 - a] = lo[1 - a]!; uv1[1 - a] = hi[1 - a]!;
      const world = (uv: number[]) => origin.clone().addScaledVector(xDir, uv[0]!).addScaledVector(yDir, uv[1]!);
      (index % 5 === 0 ? major : minor).push(...world(uv0).toArray(), ...world(uv1).toArray());
    }
  }
  return { minor, major };
}
