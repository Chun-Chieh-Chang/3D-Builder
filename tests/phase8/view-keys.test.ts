/**
 * Moving the view from the keyboard (SolidWorks): the camera arithmetic of viewNav.ts, checked on a camera in front of the model (looking down −Z, up +Y).
 * Directions are the model's on the screen: right brings the side that faced you to the right, up brings it up, a roll to the right is clockwise.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CUBE_CHAMFER, cubeDirection, cubeFacets, orbitView, panView, restoreView, rollView, viewState, ViewHistory, zoomView, ZOOM_RANGE } from '@3db/render';
import { PAN_STEP, takesSpace, viewKeyCommand, ZOOM_STEP } from '../../apps/web/src/viewKeys';

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

describe('the 26 directions of the view cube (FreeCAD NaviCube)', () => {
  const all: [number, number, number][] = [];
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) if (x || y || z) all.push([x, y, z]);

  it('are 26, each a different direction of length 1, with an up square to it', () => {
    expect(all).toHaveLength(26);
    const dirs = all.map((d) => cubeDirection(...d));
    for (const [i, { dir, up }] of dirs.entries()) {
      expect(dir.length()).toBeCloseTo(1, 12);
      expect(up.length()).toBeCloseTo(1, 12);
      expect(Math.abs(dir.dot(up)), all[i]!.join()).toBeLessThan(0.8); // never along the view; square to it for the faces
      for (const [j, other] of dirs.entries()) if (j !== i) expect(dir.distanceTo(other.dir)).toBeGreaterThan(0.3);
    }
  });

  it('the six faces and the corner (1, 1, 1) are the standard views, up and all', () => {
    // the standard views of the viewer (VIEW_DIRS): front +Z, back −Z, right +X, left −X with +Y up; top +Y with −Z up, bottom −Y with +Z up; iso (1,1,1)
    const want: [[number, number, number], [number, number, number], [number, number, number]][] = [
      [[0, 0, 1], [0, 0, 1], [0, 1, 0]],
      [[0, 0, -1], [0, 0, -1], [0, 1, 0]],
      [[1, 0, 0], [1, 0, 0], [0, 1, 0]],
      [[-1, 0, 0], [-1, 0, 0], [0, 1, 0]],
      [[0, 1, 0], [0, 1, 0], [0, 0, -1]],
      [[0, -1, 0], [0, -1, 0], [0, 0, 1]],
    ];
    for (const [d, dir, up] of want) {
      const c = cubeDirection(...d);
      expect(c.dir.toArray()).toEqual(dir);
      expect(c.up.toArray()).toEqual(up);
    }
    const iso = cubeDirection(1, 1, 1);
    expect(iso.dir.distanceTo(new THREE.Vector3(1, 1, 1).normalize())).toBeLessThan(1e-15);
    expect(iso.up.toArray()).toEqual([0, 1, 0]);
  });

  it('an edge is halfway between its two faces: the front-top edge is 45° from the front and from the top', () => {
    const e = cubeDirection(0, 1, 1).dir;
    expect(THREE.MathUtils.radToDeg(e.angleTo(new THREE.Vector3(0, 0, 1)))).toBeCloseTo(45, 12);
    expect(THREE.MathUtils.radToDeg(e.angleTo(new THREE.Vector3(0, 1, 0)))).toBeCloseTo(45, 12);
  });

  it('refuses what is not a direction of the cube', () => {
    for (const bad of [[0, 0, 0], [2, 0, 0], [0.5, 1, 0], [NaN, 0, 1], [1, -2, 0]] as [number, number, number][]) expect(() => cubeDirection(...bad), bad.join()).toThrow(/view cube/);
  });
});

describe('the faces of the view cube: a cube with its edges and corners cut off, as FreeCAD NaviCube', () => {
  const c = CUBE_CHAMFER;
  const facets = cubeFacets();
  const deg = (a: THREE.Vector3, b: THREE.Vector3) => THREE.MathUtils.radToDeg(a.angleTo(b));
  const normal = (pts: THREE.Vector3[]) => {
    // Newell: the polygon's normal, its length twice the area, pointing the way the corners go round counterclockwise
    const n = new THREE.Vector3();
    for (const [i, p] of pts.entries()) {
      const q = pts[(i + 1) % pts.length]!;
      n.x += (p.y - q.y) * (p.z + q.z);
      n.y += (p.z - q.z) * (p.x + q.x);
      n.z += (p.x - q.x) * (p.y + q.y);
    }
    return n;
  };
  const sides = (pts: THREE.Vector3[]) => pts.map((p, i) => p.distanceTo(pts[(i + 1) % pts.length]!));

  it('is FreeCAD\'s: chamfer 0.12 of a side of 1', () => expect(c).toBe(0.24));

  it('26 faces, one for each direction: 6 octagons, 12 rectangles at 45° on the edges, 8 hexagons on the corners', () => {
    expect(facets).toHaveLength(26);
    expect(new Set(facets.map((f) => f.dir.join())).size).toBe(26);
    const shape = (kind: string) => facets.filter((f) => f.kind === kind).map((f) => f.points.length);
    expect(shape('face')).toEqual(Array(6).fill(8));
    expect(shape('edge')).toEqual(Array(12).fill(4));
    expect(shape('corner')).toEqual(Array(8).fill(6));
  });

  it('each face is flat, square to its direction, and goes round counterclockwise seen from outside', () => {
    for (const f of facets) {
      const d = new THREE.Vector3(...f.dir).normalize();
      // parallel and the same way (the sine from the cross product: acos near 0 loses half the digits)
      const n = normal(f.points).normalize();
      expect(n.clone().cross(d).length(), f.dir.join()).toBeLessThan(1e-12);
      expect(n.dot(d), f.dir.join()).toBeGreaterThan(0);
      const h = d.dot(f.points[0]!);
      for (const p of f.points) expect(Math.abs(d.dot(p) - h), f.dir.join()).toBeLessThan(1e-12);
    }
  });

  it('an edge face is 45° from its two sides, a corner face 54.74° (the diagonal) from its three', () => {
    for (const f of facets) {
      const d = new THREE.Vector3(...f.dir);
      const next = facets.filter((g) => g.kind === 'face' && d.dot(new THREE.Vector3(...g.dir)) > 0);
      expect(next).toHaveLength(f.kind === 'face' ? 1 : f.kind === 'edge' ? 2 : 3);
      const want = f.kind === 'face' ? 0 : f.kind === 'edge' ? 45 : THREE.MathUtils.radToDeg(Math.acos(1 / Math.sqrt(3)));
      for (const g of next) expect(deg(d, new THREE.Vector3(...g.dir))).toBeCloseTo(want, 10);
    }
  });

  it('measured: an edge face is chamfer·√2 by 2(1 − 2·chamfer), a corner a regular hexagon of side chamfer·√2, a side an octagon 2(1 − chamfer) across', () => {
    for (const f of facets.filter((g) => g.kind === 'edge')) {
      const s = sides(f.points).sort((a, b) => a - b);
      for (const [x, want] of s.map((x, i) => [x, i < 2 ? c * Math.SQRT2 : 2 * (1 - 2 * c)])) expect(x).toBeCloseTo(want!, 12);
      const [p0, p1, p2] = f.points as [THREE.Vector3, THREE.Vector3, THREE.Vector3];
      expect(p1.clone().sub(p0).dot(p2.clone().sub(p1))).toBeCloseTo(0, 12); // square corners
    }
    for (const f of facets.filter((g) => g.kind === 'corner')) for (const x of sides(f.points)) expect(x).toBeCloseTo(c * Math.SQRT2, 12);
    const front = facets.find((f) => f.dir.join() === '0,0,1')!;
    const xs = front.points.map((p) => p.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2 * (1 - c), 12);
    expect(sides(front.points).sort((a, b) => a - b).map((x) => +x.toFixed(12))).toEqual([...Array(4).fill(+(c * Math.SQRT2).toFixed(12)), ...Array(4).fill(+(2 - 4 * c).toFixed(12))]);
  });

  it('they close the solid without a gap or an overlap: 48 corners each on three faces, and none outside any face (V − E + F = 2)', () => {
    const key = (p: THREE.Vector3) => p.toArray().map((x) => x.toFixed(9)).join();
    const on = new Map<string, number>();
    for (const f of facets) for (const p of f.points) on.set(key(p), (on.get(key(p)) ?? 0) + 1);
    expect(on.size).toBe(48);
    expect([...on.values()].every((n) => n === 3)).toBe(true);
    const edges = facets.reduce((s, f) => s + f.points.length, 0) / 2;
    expect(on.size - edges + facets.length).toBe(2);
    for (const f of facets)
      for (const p of f.points)
        for (const g of facets) {
          const n = new THREE.Vector3(...g.dir).normalize();
          expect(n.dot(p) - n.dot(g.points[0]!)).toBeLessThan(1e-12);
        }
  });

  it('refuses a chamfer that is not a cut of a cube: 0 or less, half the side or more, not a number', () => {
    for (const bad of [0, -0.1, 0.5, 0.7, NaN, Infinity]) expect(() => cubeFacets(bad), String(bad)).toThrow(/chamfer/);
    expect(cubeFacets(0.1).map((f) => f.points.length)).toEqual(facets.map((f) => f.points.length));
  });
});

describe('the space bar on something that takes it (a button, a face of the view cube)', () => {
  const el = (tagName: string, role: string | null = null) => ({ tagName, getAttribute: (k: string) => (k === 'role' ? role : null) });
  it('a button, a role="button" (the cube\'s faces), a link and a summary press themselves with the space bar: it is not 視角方位 there', () => {
    expect(takesSpace(el('BUTTON'))).toBe(true);
    expect(takesSpace(el('polygon', 'button'))).toBe(true); // an SVG face of the cube
    expect(takesSpace(el('DIV', 'button'))).toBe(true);
    expect(takesSpace(el('A'))).toBe(true);
    expect(takesSpace(el('SUMMARY'))).toBe(true);
  });
  it('the page, the canvas and plain elements leave it to the view', () => {
    expect(takesSpace(null)).toBe(false);
    expect(takesSpace(el('BODY'))).toBe(false);
    expect(takesSpace(el('CANVAS'))).toBe(false);
    expect(takesSpace(el('DIV'))).toBe(false);
    expect(takesSpace({})).toBe(false); // the window: no tag at all
  });
});