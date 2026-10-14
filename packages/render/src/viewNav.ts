import * as THREE from 'three';

/**
 * Moving the view from the keyboard, as SolidWorks does (arrow keys turn it about the screen's axes through the model's middle, Shift+arrows by a quarter
 * turn, Alt+Left/Right roll it, Ctrl+arrows pan it, Z and Shift+Z zoom), and the views it went through (Ctrl+Shift+Z: the previous view). Pure camera
 * arithmetic on an orthographic camera and the point it turns about, so it can be checked without a screen.
 *
 * Directions are those of the model on the screen: turning it right brings the side that faced you to the right, up brings it up; a roll to the right
 * turns it clockwise; a pan to the right moves it right.
 */

/** The screen's axes in the world: right, up, and toward the viewer. */
function screenAxes(camera: THREE.OrthographicCamera, target: THREE.Vector3): { right: THREE.Vector3; up: THREE.Vector3; toViewer: THREE.Vector3 } {
  const toViewer = camera.position.clone().sub(target).normalize();
  const right = camera.up.clone().cross(toViewer).normalize();
  const up = toViewer.clone().cross(right).normalize();
  return { right, up, toViewer };
}

/** A view move given a number that is not one would turn the camera into NaN for good: refused instead. */
function finite(name: string, ...xs: number[]): void {
  if (!xs.every(Number.isFinite)) throw new Error(`a view move needs a finite ${name}, not ${xs.join(', ')}`);
}

function turnAbout(camera: THREE.OrthographicCamera, target: THREE.Vector3, axis: THREE.Vector3, radians: number): void {
  const q = new THREE.Quaternion().setFromAxisAngle(axis, radians);
  camera.position.sub(target).applyQuaternion(q).add(target);
  camera.up.applyQuaternion(q).normalize();
  camera.lookAt(target);
  camera.updateMatrixWorld();
}

/** Turns the model `degrees` about the screen's vertical axis (`'horizontal'`: positive is to the right) or its horizontal axis (`'vertical'`: positive is up). */
export function orbitView(camera: THREE.OrthographicCamera, target: THREE.Vector3, direction: 'horizontal' | 'vertical', degrees: number): void {
  finite('angle', degrees);
  const { right, up } = screenAxes(camera, target);
  const a = THREE.MathUtils.degToRad(degrees);
  // the camera goes the other way round: the model turning right is the camera going left about the screen's up
  if (direction === 'horizontal') turnAbout(camera, target, up, -a);
  else turnAbout(camera, target, right, a);
}

/** Turns the model `degrees` in the plane of the screen: positive is clockwise. The direction it is seen from stays. */
export function rollView(camera: THREE.OrthographicCamera, target: THREE.Vector3, degrees: number): void {
  finite('angle', degrees);
  const { toViewer } = screenAxes(camera, target);
  camera.up.applyQuaternion(new THREE.Quaternion().setFromAxisAngle(toViewer, THREE.MathUtils.degToRad(degrees))).normalize();
  camera.lookAt(target);
  camera.updateMatrixWorld();
}

/** Moves the model on the screen by fractions of the view's width (`fx`, positive to the right) and height (`fy`, positive up). */
export function panView(camera: THREE.OrthographicCamera, target: THREE.Vector3, fx: number, fy: number): void {
  finite('distance', fx, fy);
  const { right, up } = screenAxes(camera, target);
  const width = (camera.right - camera.left) / camera.zoom;
  const height = (camera.top - camera.bottom) / camera.zoom;
  const shift = right.multiplyScalar(-fx * width).add(up.multiplyScalar(-fy * height));
  camera.position.add(shift);
  target.add(shift);
  camera.updateMatrixWorld();
}

/** Zoom limits, as the mouse wheel has them. */
export const ZOOM_RANGE = { min: 1e-3, max: 1e5 } as const;

/** Makes the model `factor` times bigger on the screen (below 1: smaller), within ZOOM_RANGE. */
export function zoomView(camera: THREE.OrthographicCamera, factor: number): void {
  if (!(factor > 0) || !Number.isFinite(factor)) throw new Error(`a zoom factor must be a positive number, not ${factor}`);
  camera.zoom = THREE.MathUtils.clamp(camera.zoom * factor, ZOOM_RANGE.min, ZOOM_RANGE.max);
  camera.updateProjectionMatrix();
}

/**
 * The 26 directions of the view cube (FreeCAD's NaviCube): a face (one of x, y, z is ±1), an edge (two are) or a corner (all three), as the direction from
 * the model toward the viewer, and the screen's up for it: the world's +Y, except straight down or up the Y axis (the top view has −Z up, the bottom +Z, as
 * the standard views have them). Each of x, y, z is −1, 0 or 1, not all 0.
 */
export function cubeDirection(x: number, y: number, z: number): { dir: THREE.Vector3; up: THREE.Vector3 } {
  const ok = (v: number) => v === -1 || v === 0 || v === 1;
  if (!ok(x) || !ok(y) || !ok(z) || (x === 0 && y === 0 && z === 0)) throw new Error(`a view cube direction is three of -1, 0 and 1, not all 0: not ${x}, ${y}, ${z}`);
  const dir = new THREE.Vector3(x, y, z).normalize();
  const up = x === 0 && z === 0 ? new THREE.Vector3(0, 0, -y) : new THREE.Vector3(0, 1, 0);
  return { dir, up };
}

/** How deep the view cube's edges are cut, as a part of half its side: FreeCAD's NaviCube (its chamfer 0.12 on a side of 1). */
export const CUBE_CHAMFER = 0.24;

/** A face of the view cube: the direction it looks from (as cubeDirection takes it), what it is, and its corners counterclockwise seen from outside. */
export interface CubeFacet {
  dir: [number, number, number];
  kind: 'face' | 'edge' | 'corner';
  points: THREE.Vector3[];
}

/**
 * The view cube as FreeCAD's NaviCube is: a cube of side 2 about the origin with its 12 edges cut at 45° and its 8 corners cut square to the diagonal,
 * which leaves 26 faces, one for each direction of cubeDirection: 6 octagons (the sides), 12 rectangles (the edges, `chamfer`·√2 wide) and 8 regular
 * hexagons (the corners). Each is where the plane square to its direction, `d·p = h` (h: 1 for a side, 2 − chamfer for an edge, 3 − 3·chamfer for a
 * corner, d not made of length 1), meets all the others' sides.
 */
export function cubeFacets(chamfer: number = CUBE_CHAMFER): CubeFacet[] {
  if (!(chamfer > 0 && chamfer < 0.5)) throw new Error(`the view cube's chamfer is between 0 and 0.5 of half its side, not ${chamfer}`);
  const dirs: [number, number, number][] = [];
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) if (x || y || z) dirs.push([x, y, z]);
  const count = (d: [number, number, number]) => Math.abs(d[0]) + Math.abs(d[1]) + Math.abs(d[2]);
  const height = (d: [number, number, number]) => [0, 1, 2 - chamfer, 3 - 3 * chamfer][count(d)]!;
  const planes = dirs.map((d) => ({ n: new THREE.Vector3(...d), h: height(d) }));
  return dirs.map((d, i) => {
    const { n, h } = planes[i]!;
    const unit = n.clone().normalize();
    const a = new THREE.Vector3().crossVectors(Math.abs(unit.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0), unit).normalize();
    const b = new THREE.Vector3().crossVectors(unit, a); // a × b is the direction: corners go round counterclockwise seen from outside
    const middle = unit.clone().multiplyScalar(h / n.length());
    let poly = [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([s, t]) => middle.clone().addScaledVector(a, 4 * s!).addScaledVector(b, 4 * t!));
    // cut by every other face's plane (Sutherland–Hodgman): what is outside of it goes
    for (const [j, other] of planes.entries()) {
      if (j === i) continue;
      const out = (p: THREE.Vector3) => other.n.dot(p) - other.h;
      const kept: THREE.Vector3[] = [];
      for (const [k, p] of poly.entries()) {
        const q = poly[(k + 1) % poly.length]!;
        const [fp, fq] = [out(p), out(q)];
        if (fp <= 1e-12) kept.push(p);
        if ((fp < -1e-12 && fq > 1e-12) || (fp > 1e-12 && fq < -1e-12)) kept.push(p.clone().lerp(q, fp / (fp - fq)));
      }
      poly = kept;
    }
    // where three planes meet, a corner comes out twice
    const points = poly.filter((p, k) => p.distanceTo(poly[(k + 1) % poly.length]!) > 1e-9);
    return { dir: d, kind: (['face', 'edge', 'corner'] as const)[count(d) - 1]!, points };
  });
}

/** Where the camera is: enough to come back to it. */
export interface ViewState {
  position: THREE.Vector3;
  up: THREE.Vector3;
  target: THREE.Vector3;
  zoom: number;
  /** The camera's box (「全部顯示」 sets it to the model), so coming back shows the same size. */
  frustum: [left: number, right: number, top: number, bottom: number];
}

export function viewState(camera: THREE.OrthographicCamera, target: THREE.Vector3): ViewState {
  return { position: camera.position.clone(), up: camera.up.clone(), target: target.clone(), zoom: camera.zoom, frustum: [camera.left, camera.right, camera.top, camera.bottom] };
}

export function restoreView(camera: THREE.OrthographicCamera, target: THREE.Vector3, s: ViewState): void {
  target.copy(s.target);
  camera.position.copy(s.position);
  camera.up.copy(s.up);
  camera.zoom = s.zoom;
  [camera.left, camera.right, camera.top, camera.bottom] = s.frustum;
  camera.lookAt(target);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
}

const same = (a: ViewState, b: ViewState) => a.position.distanceTo(b.position) < 1e-9 && a.up.distanceTo(b.up) < 1e-9 && a.target.distanceTo(b.target) < 1e-9 && Math.abs(a.zoom - b.zoom) < 1e-12 && a.frustum.every((v, i) => v === b.frustum[i]);

/** The views gone through, the last at the end (SolidWorks keeps ten). A view the same as the last one kept is not kept twice. */
export class ViewHistory {
  private readonly views: ViewState[] = [];
  constructor(readonly limit = 10) {}

  push(s: ViewState): void {
    const last = this.views.at(-1);
    if (last && same(last, s)) return;
    this.views.push(s);
    if (this.views.length > this.limit) this.views.shift();
  }

  /** The view before this one, taken off the list; null when there is none. */
  pop(): ViewState | null {
    return this.views.pop() ?? null;
  }

  get size(): number {
    return this.views.length;
  }
}
