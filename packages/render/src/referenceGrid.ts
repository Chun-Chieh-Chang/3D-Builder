import * as THREE from 'three';
import type { PlaneFrame } from './overlay';

const DEFAULT_FRAME: PlaneFrame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };

/** The finest level's cells are never drawn closer together than this many pixels; it fades in from here. */
export const GRID_MIN_PIXELS = 10;
/** Opacity of the middle level at the moment the finest level has faded out: the old minor-line weight. */
export const GRID_MID_OPACITY = 0.42;

/** Lines sharing one opacity. Positions are world-space segment pairs (x0 y0 z0 x1 y1 z1 …). */
export interface GridLevel { step: number; opacity: number; positions: number[] }

/**
 * A grid anchored to a real work plane. Orbiting never changes the plane or its origin.
 *
 * Levels are `spacing × 10^k` and nest, so a line keeps its world position at every zoom. Each line is drawn once, in the coarsest of
 * three levels it lies on: the finest fades from 0 to GRID_MID_OPACITY as its cells grow from GRID_MIN_PIXELS to ten times that, the middle
 * from GRID_MID_OPACITY to 1, and all coarser lines are opaque. When the finest level has faded to 0 the next one takes its place at the
 * same opacity, so zooming out only ever fades lines away and the cells on screen never jump coarser (the old 1-2-5 ladder replaced the
 * whole lattice at each threshold, growing the cells 2–2.5× on screen as the camera moved away).
 */
export function referenceGrid(camera: THREE.OrthographicCamera, height: number, spacing: number, frame: PlaneFrame = DEFAULT_FRAME): GridLevel[] {
  if (!(height > 0) || !Number.isFinite(height) || !(spacing > 0) || !Number.isFinite(spacing)) return [];
  const tuples = [frame.origin, frame.xDir, frame.yDir, frame.normal];
  if (tuples.some(v => v.length !== 3 || !v.every(Number.isFinite))) return [];
  const [origin, xDir, yDir, normal] = tuples.map(v => new THREE.Vector3(...v)) as [THREE.Vector3, THREE.Vector3, THREE.Vector3, THREE.Vector3];
  if ([xDir, yDir, normal].some(v => Math.abs(v.lengthSq() - 1) > 1e-6) || Math.abs(xDir.dot(yDir)) > 1e-6 || xDir.clone().cross(yDir).dot(normal) < 1 - 1e-6) return [];
  camera.updateMatrixWorld();
  const points: THREE.Vector2[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) {
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(x, y), camera);
    // A work plane can be behind the near plane after a pan; intersect the infinite line.
    const denominator = normal.dot(ray.ray.direction);
    // Edge-on has no visible plane area. Never substitute a different plane.
    if (Math.abs(denominator) < 1e-8) return [];
    const p = ray.ray.origin.clone().addScaledVector(ray.ray.direction, normal.dot(origin.clone().sub(ray.ray.origin)) / denominator).sub(origin);
    points.push(new THREE.Vector2(p.dot(xDir), p.dot(yDir)));
  }
  if (points.some(p => !p.toArray().every(Number.isFinite))) return [];
  const lo = [0, 1].map(a => Math.min(...points.map(p => p.getComponent(a))));
  const hi = [0, 1].map(a => Math.max(...points.map(p => p.getComponent(a))));
  const px = (camera.top - camera.bottom) / (camera.zoom * height);
  // Both terms scale with the view, so the fade below is continuous in zoom; the second keeps a grazing view to 400 lines an axis.
  const least = Math.max(px * GRID_MIN_PIXELS, (hi[0]! - lo[0]! + hi[1]! - lo[1]!) / 400);
  if (!(least > 0) || !Number.isFinite(least)) return [];
  const k = Math.max(0, Math.ceil(Math.log10(least / spacing) - 1e-12));
  const step = spacing * 10 ** k;
  // How far the finest level is past its fade-in: 0 when its cells are GRID_MIN_PIXELS, 1 at ten times that (or the user's own spacing).
  const t = Math.min(1, Math.max(0, Math.log10(step / least)));
  const levels: GridLevel[] = [
    { step, opacity: GRID_MID_OPACITY * t, positions: [] },
    { step: step * 10, opacity: GRID_MID_OPACITY + (1 - GRID_MID_OPACITY) * t, positions: [] },
    { step: step * 100, opacity: 1, positions: [] },
  ];
  if (!Number.isFinite(levels[2]!.step)) return [];
  for (let a = 0; a < 2; a++) {
    const first = Math.ceil(lo[a]! / step), last = Math.floor(hi[a]! / step);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || last - first > 600) return [];
    for (let index = first; index <= last; index++) {
      const uv0 = [0, 0], uv1 = [0, 0];
      uv0[a] = uv1[a] = index * step;
      uv0[1 - a] = lo[1 - a]!; uv1[1 - a] = hi[1 - a]!;
      const world = (uv: number[]) => origin.clone().addScaledVector(xDir, uv[0]!).addScaledVector(yDir, uv[1]!);
      levels[index % 100 === 0 ? 2 : index % 10 === 0 ? 1 : 0]!.positions.push(...world(uv0).toArray(), ...world(uv1).toArray());
    }
  }
  return levels;
}
