import * as THREE from 'three';

/** Turns of the wheel closer together than this are one zoom. */
const WHEEL_PAUSE_MS = 500;

/**
 * SolidWorks-style view manipulation (D4.1): middle-drag rotates (trackball, free),
 * Ctrl+middle-drag pans, Shift+middle-drag zooms, wheel zooms toward the cursor.
 * Alt+left-drag rotates as a fallback for touchpads. Left click stays free for selection.
 */
export class ViewControls {
  readonly target = new THREE.Vector3();
  private mode: 'rotate' | 'pan' | 'zoom' | null = null;
  private last = new THREE.Vector2();
  private readonly onChange: () => void;
  /** Told before the view starts to move (a drag, or a turn of the wheel after a pause), so the view it leaves can be kept (「上一個視角」). */
  private readonly onStart: () => void;
  /** When the wheel last turned: the turns of one movement of the hand are one change of the view. */
  private lastWheel = -Infinity;

  constructor(
    private readonly camera: THREE.OrthographicCamera,
    private readonly dom: HTMLElement,
    onChange: () => void,
    onStart: () => void = () => {},
  ) {
    this.onChange = onChange;
    this.onStart = onStart;
    dom.addEventListener('pointerdown', this.down);
    dom.addEventListener('wheel', this.wheel, { passive: false });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  dispose(): void {
    this.dom.removeEventListener('pointerdown', this.down);
    this.dom.removeEventListener('wheel', this.wheel);
    window.removeEventListener('pointermove', this.move);
    window.removeEventListener('pointerup', this.up);
  }

  private down = (e: PointerEvent) => {
    const middle = e.button === 1;
    const altLeft = e.button === 0 && e.altKey;
    if (!middle && !altLeft) return;
    e.preventDefault();
    this.onStart();
    this.mode = e.ctrlKey ? 'pan' : e.shiftKey ? 'zoom' : 'rotate';
    this.last.set(e.clientX, e.clientY);
    window.addEventListener('pointermove', this.move);
    window.addEventListener('pointerup', this.up);
  };

  private up = () => {
    this.mode = null;
    window.removeEventListener('pointermove', this.move);
    window.removeEventListener('pointerup', this.up);
  };

  private move = (e: PointerEvent) => {
    const dx = e.clientX - this.last.x;
    const dy = e.clientY - this.last.y;
    this.last.set(e.clientX, e.clientY);
    if (this.mode === 'rotate') this.rotate(dx, dy);
    else if (this.mode === 'pan') this.pan(dx, dy);
    else if (this.mode === 'zoom') this.zoomBy(Math.exp(-dy * 0.005));
    this.onChange();
  };

  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    if (e.timeStamp - this.lastWheel > WHEEL_PAUSE_MS) this.onStart();
    this.lastWheel = e.timeStamp;
    const rect = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const before = new THREE.Vector3(ndc.x, ndc.y, 0).unproject(this.camera);
    this.zoomBy(Math.exp(-e.deltaY * 0.0015));
    const after = new THREE.Vector3(ndc.x, ndc.y, 0).unproject(this.camera);
    const shift = before.sub(after);
    this.camera.position.add(shift);
    this.target.add(shift);
    this.onChange();
  };

  private rotate(dx: number, dy: number): void {
    const cam = this.camera;
    const offset = cam.position.clone().sub(this.target);
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 1);
    const angle = Math.hypot(dx, dy) * 0.008;
    if (angle === 0) return;
    const axis = up.multiplyScalar(-dx).add(right.multiplyScalar(-dy)).normalize();
    const q = new THREE.Quaternion().setFromAxisAngle(axis, angle);
    offset.applyQuaternion(q);
    cam.up.applyQuaternion(q);
    cam.position.copy(this.target).add(offset);
    cam.lookAt(this.target);
  }

  private pan(dx: number, dy: number): void {
    const cam = this.camera;
    const scale = (cam.right - cam.left) / cam.zoom / this.dom.clientWidth;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 0).multiplyScalar(-dx * scale);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrix, 1).multiplyScalar(dy * scale);
    cam.position.add(right).add(up);
    this.target.add(right).add(up);
  }

  private zoomBy(factor: number): void {
    this.camera.zoom = THREE.MathUtils.clamp(this.camera.zoom * factor, 1e-3, 1e5);
    this.camera.updateProjectionMatrix();
  }
}
