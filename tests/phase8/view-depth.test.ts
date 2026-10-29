// The camera's depth follows the view's size: zoomed out to the wheel's limit, the floor grid seen aslant was cut by the fixed ±1e5 near and far
// planes into a band across the screen. The work plane is hit by the rays of the four corners of the screen; every hit must lie between the planes.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEPTH_RANGE, fitDepthRange, zoomView, ZOOM_RANGE } from '@3db/render';

/** A camera as 「全部顯示」 leaves it for a box of the given radius, looking from `dir` at the origin (viewer.fitView). */
function fitted(dir: THREE.Vector3, up: THREE.Vector3, radius: number, aspect: number): THREE.OrthographicCamera {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -DEPTH_RANGE.least, DEPTH_RANGE.least);
  camera.position.copy(dir).normalize().multiplyScalar(radius * 10);
  camera.up.copy(up);
  camera.lookAt(0, 0, 0);
  const half = radius * 1.15;
  camera.left = -half * Math.max(aspect, 1);
  camera.right = half * Math.max(aspect, 1);
  camera.top = half / Math.min(aspect, 1);
  camera.bottom = -half / Math.min(aspect, 1);
  camera.updateProjectionMatrix();
  return camera;
}

/** The depths (distance in front of the camera) at which the rays of the screen's corners meet the plane z = 0. */
function cornerDepths(camera: THREE.OrthographicCamera): number[] {
  camera.updateMatrixWorld();
  const out: number[] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) {
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(x, y), camera);
    const t = -ray.ray.origin.z / ray.ray.direction.z;
    const hit = ray.ray.origin.clone().addScaledVector(ray.ray.direction, t);
    out.push(-hit.applyMatrix4(camera.matrixWorldInverse).z);
  }
  return out;
}

const within = (camera: THREE.OrthographicCamera) => cornerDepths(camera).every(d => d > camera.near && d < camera.far);
const ISO = new THREE.Vector3(1, -1, 1), Z = new THREE.Vector3(0, 0, 1);
/** Every zoom the wheel reaches from the fitted view: 10 % a turn, as the wheel turns it (controls.ts), down to ZOOM_RANGE.min. */
function* wheelOut(camera: THREE.OrthographicCamera) {
  while (camera.zoom > ZOOM_RANGE.min) { zoomView(camera, 1 / 1.1); yield camera.zoom; }
}

describe('the camera depth follows the view (the grid band at the wheel limit)', () => {
  it('the fixed depth does cut the isometric grid at the wheel limit: the case is real', () => {
    const camera = fitted(ISO, Z, 50 * Math.sqrt(3), 16 / 9);
    zoomView(camera, ZOOM_RANGE.min);
    expect(camera.zoom).toBe(ZOOM_RANGE.min);
    expect(camera.far).toBe(1e5);
    const depths = cornerDepths(camera);
    // √2 × the half-height of 1e5 either side of the camera's 866 mm
    expect(Math.max(...depths)).toBeGreaterThan(1.4e5);
    expect(Math.min(...depths)).toBeLessThan(-1.3e5);
    expect(within(camera)).toBe(false);
  });

  it('keeps all four corners of the work plane between near and far at every zoom the wheel reaches, from every side', () => {
    const sides: [THREE.Vector3, THREE.Vector3][] = [
      [ISO, Z], [new THREE.Vector3(-1, 1, 1), Z], [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0)], [new THREE.Vector3(1, -1, -1), Z],
      // one degree above the plane, and a rolled view whose screen width runs into depth too
      [new THREE.Vector3(Math.cos(Math.PI / 180), 0, Math.sin(Math.PI / 180)), Z], [ISO, new THREE.Vector3(1, 1, 0)],
    ];
    for (const [dir, up] of sides) for (const radius of [1, 50 * Math.sqrt(3), 1e4]) for (const aspect of [16 / 9, 0.5]) {
      const camera = fitted(dir, up, radius, aspect);
      let turns = 0;
      fitDepthRange(camera);
      expect(within(camera), `fitted ${dir.toArray()} r=${radius}`).toBe(true);
      for (const zoom of wheelOut(camera)) {
        fitDepthRange(camera);
        turns++;
        if (!within(camera)) throw new Error(`cut at zoom ${zoom} from ${dir.toArray()} r=${radius} aspect ${aspect}: ${cornerDepths(camera)} outside ±${camera.far}`);
      }
      expect(camera.zoom).toBe(ZOOM_RANGE.min);
      expect(turns).toBeGreaterThan(70);
    }
  });

  it('leaves the depth steps at normal zoom as they were: ±1e5 for the default view and anything zoomed in', () => {
    const camera = fitted(ISO, Z, 50 * Math.sqrt(3), 16 / 9);
    fitDepthRange(camera);
    expect([camera.near, camera.far]).toEqual([-1e5, 1e5]);
    while (camera.zoom < ZOOM_RANGE.max) { zoomView(camera, 1.1); fitDepthRange(camera); expect(camera.far).toBe(1e5); }
  });

  it('keeps a depth step no larger a part of a pixel than in the fitted view, at every zoom it scales', () => {
    for (const aspect of [16 / 9, 0.5]) {
      const camera = fitted(ISO, Z, 50 * Math.sqrt(3), aspect);
      // a 24-bit depth step against the size of a pixel on a 1000-pixel-high view
      const step = () => { fitDepthRange(camera); return (camera.far - camera.near) / 2 ** 24 / ((camera.top - camera.bottom) / (camera.zoom * 1000)); };
      const atFit = step();
      expect(camera.far).toBe(DEPTH_RANGE.least);
      const steps = [...wheelOut(camera)].map(step);
      expect(Math.max(...steps)).toBeLessThanOrEqual(atFit);
      // scaled with the view, the step is a fixed part of a pixel
      const scaled = steps.slice(-20);
      expect(camera.far).toBeGreaterThan(DEPTH_RANGE.least);
      expect(Math.max(...scaled) - Math.min(...scaled)).toBeLessThan(1e-12);
    }
  });

  it('refuses a view with no size instead of setting a meaningless depth', () => {
    const camera = fitted(ISO, Z, 10, 1);
    for (const zoom of [0, Number.NaN, Infinity]) {
      camera.zoom = zoom;
      expect(() => fitDepthRange(camera)).toThrow(/positive number/);
    }
    camera.zoom = 1; camera.left = camera.right = 0; camera.top = camera.bottom = 0;
    expect(() => fitDepthRange(camera)).toThrow(/positive number/);
  });
});
