import * as THREE from 'three';

/** A world-origin reference grid on the principal plane facing the camera most directly. */
export function referenceGrid(camera: THREE.OrthographicCamera, height: number, spacing: number): { minor: number[]; major: number[] } {
  const minor: number[] = [], major: number[] = [];
  if (!(height > 0) || !Number.isFinite(height) || !(spacing > 0) || !Number.isFinite(spacing)) return { minor, major };
  camera.updateMatrixWorld();
  const direction = camera.getWorldDirection(new THREE.Vector3());
  const abs = [Math.abs(direction.x), Math.abs(direction.y), Math.abs(direction.z)];
  // Prefer XY for the isometric tie. Other views use YZ / XZ so the grid never becomes edge-on.
  const normal = abs[2]! >= Math.max(abs[0]!, abs[1]!) - 1e-10 ? 2 : abs[1]! >= abs[0]! ? 1 : 0;
  const axes = [0, 1, 2].filter(i => i !== normal);
  const n = new THREE.Vector3().setComponent(normal, 1), plane = new THREE.Plane(n, 0);
  const points: THREE.Vector3[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) {
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(x, y), camera);
    // A reference plane can be behind the near plane after a pan; intersect the infinite line.
    const denominator = n.dot(ray.ray.direction);
    if (Math.abs(denominator) < 1e-8) return { minor, major };
    points.push(ray.ray.origin.clone().addScaledVector(ray.ray.direction, -n.dot(ray.ray.origin) / denominator));
  }
  if (points.some(p => !p.toArray().every(Number.isFinite))) return { minor, major };
  const lo = axes.map(a => Math.min(...points.map(p => p.getComponent(a))));
  const hi = axes.map(a => Math.max(...points.map(p => p.getComponent(a))));
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
      const start = new THREE.Vector3(), end = new THREE.Vector3();
      start.setComponent(axes[a]!, index * step); end.setComponent(axes[a]!, index * step);
      start.setComponent(axes[1 - a]!, lo[1 - a]!); end.setComponent(axes[1 - a]!, hi[1 - a]!);
      (index % 5 === 0 ? major : minor).push(...start.toArray(), ...end.toArray());
    }
  }
  return { minor, major };
}
