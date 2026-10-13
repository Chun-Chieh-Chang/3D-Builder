/**
 * Moving the view from the keyboard (SolidWorks): the camera arithmetic of viewNav.ts, checked on a camera in front of the model (looking down −Z, up +Y).
 * Directions are the model's on the screen: right brings the side that faced you to the right, up brings it up, a roll to the right is clockwise.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { orbitView, panView, restoreView, rollView, viewState, ViewHistory, zoomView, ZOOM_RANGE } from '@3db/render';
import { PAN_STEP, viewKeyCommand, ZOOM_STEP } from '../../apps/web/src/viewKeys';

const front = () => {
  const camera = new THREE.OrthographicCamera(-100, 100, 60, -60, -1e5, 1e5);
  const target = new THREE.Vector3(10, 20, 30); // the model's middle, away from the origin
  camera.position.copy(target).add(new THREE.Vector3(0, 0, 1000));
  camera.up.set(0, 1, 0);
  camera.lookAt(target);
  camera.updateMatrixWorld();
  return { camera, target };
};
const toViewer = (c: THREE.Camera, t: THREE.Vector3) => c.position.clone().sub(t).normalize();
const screenRight = (c: THREE.Camera, t: THREE.Vector3) => c.up.clone().cross(toViewer(c, t)).normalize();
const deg = (a: THREE.Vector3, b: THREE.Vector3) => THREE.MathUtils.radToDeg(a.angleTo(b));

describe('turning the view with the arrow keys', () => {
  it('right: the side that faced you goes right, by exactly the step, about the model\'s middle', () => {
    const { camera, target } = front();
    const before = toViewer(camera, target);
    const dist = camera.position.distanceTo(target);
    orbitView(camera, target, 'horizontal', 15);
    expect(deg(before, toViewer(camera, target))).toBeCloseTo(15, 9);
    expect(screenRight(camera, target).dot(before)).toBeGreaterThan(0); // the old front is now on the right
    expect(camera.position.distanceTo(target)).toBeCloseTo(dist, 6);
    expect(camera.up.dot(new THREE.Vector3(0, 1, 0))).toBeCloseTo(1, 12); // turning about the screen's up keeps it
  });

  it('up: the side that faced you goes up; left and down undo right and up', () => {
    const { camera, target } = front();
    const before = toViewer(camera, target);
    orbitView(camera, target, 'vertical', 15);
    expect(deg(before, toViewer(camera, target))).toBeCloseTo(15, 9);
    expect(camera.up.dot(before)).toBeGreaterThan(0);
    orbitView(camera, target, 'vertical', -15);
    orbitView(camera, target, 'horizontal', 15);
    orbitView(camera, target, 'horizontal', -15);
    expect(toViewer(camera, target).distanceTo(before)).toBeLessThan(1e-12);
  });

  it('twenty-four steps of 15° come back to where they started; one of 90° turns the front to the right exactly', () => {
    const { camera, target } = front();
    const before = viewState(camera, target);
    for (let i = 0; i < 24; i++) orbitView(camera, target, 'horizontal', 15);
    expect(camera.position.distanceTo(before.position)).toBeLessThan(1e-9);
    expect(camera.up.distanceTo(before.up)).toBeLessThan(1e-12);
    orbitView(camera, target, 'horizontal', 90);
    expect(screenRight(camera, target).distanceTo(new THREE.Vector3(0, 0, 1))).toBeLessThan(1e-12);
  });

  it('a roll to the right is clockwise and keeps the direction the model is seen from', () => {
    const { camera, target } = front();
    const dir = toViewer(camera, target);
    const up = camera.up.clone();
    rollView(camera, target, 15);
    expect(toViewer(camera, target).distanceTo(dir)).toBeLessThan(1e-12);
    expect(deg(up, camera.up)).toBeCloseTo(15, 9);
    expect(screenRight(camera, target).dot(up)).toBeGreaterThan(0); // the old up leans to the right: turned clockwise
  });
});

describe('panning and zooming from the keyboard', () => {
  it('a pan to the right moves the model right by that part of the view\'s width, and up by that part of its height; the direction stays', () => {
    const { camera, target } = front();
    camera.zoom = 2;
    camera.updateProjectionMatrix();
    const middle = target.clone();
    const dir = toViewer(camera, target);
    panView(camera, target, 0.1, 0.25);
    const seen = middle.clone().sub(target); // where the old middle is, seen from the new one
    expect(seen.dot(screenRight(camera, target))).toBeCloseTo(0.1 * (200 / 2), 9); // the width is 200, zoomed 2×
    expect(seen.dot(camera.up)).toBeCloseTo(0.25 * (120 / 2), 9);
    expect(toViewer(camera, target).distanceTo(dir)).toBeLessThan(1e-12);
  });

  it('zooms by the factor, within the wheel\'s limits', () => {
    const { camera } = front();
    zoomView(camera, 1.25);
    expect(camera.zoom).toBeCloseTo(1.25, 12);
    zoomView(camera, 1 / 1.25);
    expect(camera.zoom).toBeCloseTo(1, 12);
    zoomView(camera, 1e9);
    expect(camera.zoom).toBe(ZOOM_RANGE.max);
  });

  it('refuses a move that is not a number, rather than leave the camera at NaN', () => {
    const { camera, target } = front();
    const before = viewState(camera, target);
    expect(() => orbitView(camera, target, 'horizontal', NaN)).toThrow(/finite/);
    expect(() => rollView(camera, target, Infinity)).toThrow(/finite/);
    expect(() => panView(camera, target, 0.1, NaN)).toThrow(/finite/);
    expect(() => zoomView(camera, 0)).toThrow(/positive/);
    expect(() => zoomView(camera, -2)).toThrow(/positive/);
    expect(camera.position.distanceTo(before.position)).toBe(0);
    expect(camera.zoom).toBe(before.zoom);
  });
});

describe('the previous view', () => {
  it('goes back through the views kept, the last first; the same view is not kept twice; at most ten', () => {
    const { camera, target } = front();
    const h = new ViewHistory();
    const first = viewState(camera, target);
    h.push(first);
    h.push(viewState(camera, target)); // the same: not kept again
    expect(h.size).toBe(1);
    orbitView(camera, target, 'horizontal', 15);
    h.push(viewState(camera, target));
    orbitView(camera, target, 'vertical', 30);
    restoreView(camera, target, h.pop()!);
    expect(toViewer(camera, target).angleTo(new THREE.Vector3(0, 0, 1))).toBeCloseTo(THREE.MathUtils.degToRad(15), 9);
    restoreView(camera, target, h.pop()!);
    expect(camera.position.distanceTo(first.position)).toBeLessThan(1e-12);
    expect(h.pop()).toBeNull();
    for (let i = 0; i < 15; i++) {
      orbitView(camera, target, 'horizontal', 5);
      h.push(viewState(camera, target));
    }
    expect(h.size).toBe(10);
  });

  it('a kept view does not change with the camera afterwards (it is a copy)', () => {
    const { camera, target } = front();
    const h = new ViewHistory();
    h.push(viewState(camera, target));
    orbitView(camera, target, 'horizontal', 45);
    panView(camera, target, 0.3, 0);
    const back = h.pop()!;
    expect(back.target.distanceTo(new THREE.Vector3(10, 20, 30))).toBe(0);
  });
});

describe('which key does what (viewKeyCommand)', () => {
  const key = (k: string, mods: Partial<Record<'ctrlKey' | 'shiftKey' | 'altKey' | 'metaKey', boolean>> = {}) => ({ key: k, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });
  it('arrows turn by the step, Shift+arrows by a quarter turn; Alt+Left/Right roll by the step; Ctrl+arrows pan', () => {
    expect(viewKeyCommand(key('ArrowRight'), 15)).toEqual({ kind: 'orbit', direction: 'horizontal', degrees: 15 });
    expect(viewKeyCommand(key('ArrowLeft'), 15)).toEqual({ kind: 'orbit', direction: 'horizontal', degrees: -15 });
    expect(viewKeyCommand(key('ArrowUp'), 7.5)).toEqual({ kind: 'orbit', direction: 'vertical', degrees: 7.5 });
    expect(viewKeyCommand(key('ArrowDown'), 15)).toEqual({ kind: 'orbit', direction: 'vertical', degrees: -15 });
    expect(viewKeyCommand(key('ArrowLeft', { shiftKey: true }), 15)).toEqual({ kind: 'orbit', direction: 'horizontal', degrees: -90 }); // once, not also 15
    expect(viewKeyCommand(key('ArrowUp', { shiftKey: true }), 15)).toEqual({ kind: 'orbit', direction: 'vertical', degrees: 90 });
    expect(viewKeyCommand(key('ArrowRight', { altKey: true }), 15)).toEqual({ kind: 'roll', degrees: 15 });
    expect(viewKeyCommand(key('ArrowLeft', { altKey: true }), 15)).toEqual({ kind: 'roll', degrees: -15 });
    expect(viewKeyCommand(key('ArrowUp', { altKey: true }), 15)).toBeNull(); // SolidWorks rolls with Left and Right only
    expect(viewKeyCommand(key('ArrowRight', { ctrlKey: true }), 15)).toEqual({ kind: 'pan', fx: PAN_STEP, fy: 0 });
    expect(viewKeyCommand(key('ArrowDown', { metaKey: true }), 15)).toEqual({ kind: 'pan', fx: 0, fy: -PAN_STEP }); // ⌘ as Ctrl, like the shortcuts
  });

  it('Shift+Z zooms in and Z out; Ctrl+Shift+Z is the previous view; Ctrl+Z is left to undo; the space bar asks for a view', () => {
    expect(viewKeyCommand(key('Z', { shiftKey: true }), 15)).toEqual({ kind: 'zoom', factor: ZOOM_STEP });
    expect(viewKeyCommand(key('z'), 15)).toEqual({ kind: 'zoom', factor: 1 / ZOOM_STEP });
    expect(viewKeyCommand(key('Z', { ctrlKey: true, shiftKey: true }), 15)).toEqual({ kind: 'previous' });
    expect(viewKeyCommand(key('z', { ctrlKey: true }), 15)).toBeNull();
    expect(viewKeyCommand(key(' '), 15)).toEqual({ kind: 'orientation' });
    expect(viewKeyCommand(key(' ', { shiftKey: true }), 15)).toBeNull();
  });

  it('every other key goes on to the shortcuts', () => {
    for (const k of ['f', 'F', 'Delete', 'Escape', 'Enter', '1', 'a', 'Tab']) expect(viewKeyCommand(key(k), 15), k).toBeNull();
    expect(viewKeyCommand(key('1', { ctrlKey: true }), 15)).toBeNull(); // Ctrl+1 is the front view's own shortcut
  });

  it('no shortcut of the actions is one of these keys (they are fixed, as in SolidWorks)', async () => {
    // the actions come with the store, which starts a worker and listens to the page: stand-ins, as thread-ui.test.ts has them
    const g = globalThis as unknown as Record<string, unknown>;
    const quiet = { addEventListener: () => {}, removeEventListener: () => {} };
    g.Worker ??= class {
      postMessage() {}
      addEventListener() {}
      removeEventListener() {}
      terminate() {}
    };
    g.document ??= { ...quiet, title: '', hidden: false };
    g.window ??= { ...quiet, location: { href: '' }, document: g.document };
    const { ACTIONS } = await import('../../apps/web/src/actions');
    const taken = ACTIONS.flatMap((a) => (a.shortcut ? [a.shortcut] : [])).filter((s) => /(^|\+)(ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Z|Space| )$/i.test(s) && !/^Ctrl\+Z$/i.test(s));
    expect(taken).toEqual([]);
  });
});