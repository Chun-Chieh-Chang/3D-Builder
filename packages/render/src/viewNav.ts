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
