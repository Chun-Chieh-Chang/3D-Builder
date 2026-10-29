/**
 * 「正視於」 outside a sketch (C2): which frame a selection resolves to, and where the command is reachable.
 * The camera arithmetic fed by this frame is viewNav's own (checked in view-keys.test.ts); what is new
 * here is the selection → frame rule, so the assertions are on the frame itself — the normal, the screen's
 * up and, for a face, the origin it puts on the plane — not on whether a button happens to light up.
 * Since the 2026-10-14 decision (B2, the full SolidWorks set) the action also flips to the far side when
 * pressed again while already looking straight at the plane, and answers a press with no plane to look at
 * by going to the nearest standard view (and, pressed there, to the other side: the 2026-10-15 decision, which replaced the isometric view); both go through a stub viewer here, the real camera being replayed
 * in manual-c20.js.
 */
import { beforeAll, afterEach, describe, expect, it } from 'vitest';
import type { UiState } from '../../apps/web/src/state/store';
import type { PlaneFrame, Ref } from '@3db/model';

// Browser APIs the store and its imports expect in Node (same shims as thread-ui.test.ts).
class MockWorker {
  postMessage() {}
  addEventListener() {}
  removeEventListener() {}
  terminate() {}
}
if (typeof (globalThis as unknown as { Worker?: unknown }).Worker === 'undefined') {
  (globalThis as unknown as { Worker: typeof MockWorker }).Worker = MockWorker;
}
if (typeof (globalThis as unknown as { window?: unknown }).window === 'undefined') {
  (globalThis as unknown as { window: unknown }).window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    location: { href: '' },
    document: { title: '', addEventListener: () => {}, hidden: false },
  };
}
if (typeof (globalThis as unknown as { document?: unknown }).document === 'undefined') {
  (globalThis as unknown as { document: unknown }).document = {
    addEventListener: () => {},
    removeEventListener: () => {},
    title: '',
    hidden: false,
  };
}

describe('正視於 outside a sketch (C2)', () => {
  let action: typeof import('../../apps/web/src/actions').action;
  let installShortcuts: typeof import('../../apps/web/src/actions').installShortcuts;
  let normalFrame: typeof import('../../apps/web/src/actions').normalFrame;
  let store: typeof import('../../apps/web/src/state/store').store;

  beforeAll(async () => {
    ({ action, installShortcuts, normalFrame } = await import('../../apps/web/src/actions'));
    ({ store } = await import('../../apps/web/src/state/store'));
  });

  const viewNormal = () => action('view-normal');
  /** The same face shape the picker builds from a fingerprint, with the fields planeFrame reads. */
  const planarFace = (dir: [number, number, number]): Ref =>
    ({ kind: 'face', name: 'f1', fingerprint: { type: 'plane', size: 100, center: [1, 2, 3], dir } }) as Ref;

  // A stand-in camera: lookAtNormal only needs to read the view direction and to be told where to go.
  let lookAts: PlaneFrame[] = [];
  let views: string[] = [];
  let viewDir: [number, number, number] = [0.577, 0.577, 0.577];
  // what the real viewer answers is checked on the pure arithmetic (view-keys.test.ts) and on the real camera (manual-c20.js); here only what the command does with it
  let nearest: { view: string; straight: boolean } = { view: 'front', straight: false };
  const stubViewer = (): void => {
    lookAts = [];
    views = [];
    viewDir = [0.577, 0.577, 0.577];
    nearest = { view: 'front', straight: false };
    (store as unknown as { viewer: unknown }).viewer = {
      lookAt: (f: PlaneFrame) => lookAts.push(f),
      viewDirection: () => viewDir,
      setView: (v: string) => views.push(v),
      nearestPrincipalView: () => nearest,
    };
  };
  afterEach(() => {
    (store as unknown as { viewer: unknown }).viewer = null;
  });

  it('a default plane gives that plane’s own frame, not the front one by default', () => {
    store.select('plane:front');
    expect(normalFrame()).toMatchObject({ normal: [0, 0, 1], yDir: [0, 1, 0] });

    store.select('plane:right');
    expect(normalFrame()).toMatchObject({ normal: [1, 0, 0] });

    store.select('plane:top');
    expect(normalFrame()).toMatchObject({ normal: [0, 1, 0] });

    store.select(null);
  });

  it('a planar face gives the frame of its own plane, with its origin on that plane', () => {
    store.select(null);
    store.selectFace(planarFace([0, 0, -1]));
    // planeFrame projects the centre onto the normal: [1,2,3] · [0,0,-1] lands on z = 3, and with the
    // world's Y not along the normal the screen's up is still +Y. The projection carries a negative
    // zero (0 · −3), so the components are checked by magnitude rather than by Object.is.
    const face = normalFrame();
    expect(face).toMatchObject({ normal: [0, 0, -1], yDir: [0, 1, 0] });
    expect(face!.origin[0]).toBeCloseTo(0, 12);
    expect(face!.origin[1]).toBeCloseTo(0, 12);
    expect(face!.origin[2]).toBeCloseTo(3, 12);
    store.selectFace(null);
  });

  it('nothing selected means no frame — the press goes to the standard view nearest to the camera, and pressed there, to the one from the other side', () => {
    store.select(null);
    store.selectFace(null);
    expect(normalFrame()).toBeNull();
    stubViewer();
    nearest = { view: 'right', straight: false };
    viewNormal().run();
    expect(views).toEqual(['right']);
    expect(lookAts).toHaveLength(0);
    // already looking straight along it: the other side, for each of the three axes
    for (const [view, other] of [['right', 'left'], ['top', 'bottom'], ['front', 'back'], ['back', 'front']] as const) {
      stubViewer();
      nearest = { view, straight: true };
      viewNormal().run();
      expect(views, view).toEqual([other]);
    }
  });

  it('pressed while already looking straight at the plane it flips to the far side, and back', () => {
    stubViewer();
    store.select('plane:front');
    // Looking at the front plane: the camera sits on +Z and looks along −normal → this press flips.
    viewDir = [0, 0, -1];
    viewNormal().run();
    expect(lookAts[0]).toMatchObject({ normal: [0, 0, -1], yDir: [0, 1, 0] });
    // Now on the far side the camera looks along +normal → the next press flips back. The screen's
    // up is kept, so the model does not roll — it only turns about the plane's own axis.
    viewDir = [0, 0, 1];
    viewNormal().run();
    expect(lookAts[1]).toMatchObject({ normal: [0, 0, 1], yDir: [0, 1, 0] });
    store.select(null);

    // An oblique view is not a normal one: the press looks straight at the plane instead of flipping.
    stubViewer();
    store.select('plane:front');
    viewDir = [0.577, 0.577, 0.577];
    viewNormal().run();
    expect(lookAts[0]).toMatchObject({ normal: [0, 0, 1], yDir: [0, 1, 0] });
    store.select(null);
  });

  it('a plane or a planar face keeps the command on; a curved face falls back to the nearest standard view', () => {
    store.select('plane:front');
    expect(viewNormal().enabled(store.getState())).toBe(true);

    store.selectFace(planarFace([0, 1, 0]));
    expect(viewNormal().enabled(store.getState())).toBe(true);

    // A curved face has no plane to look straight at: the command stays on and answers with the nearest standard view.
    store.selectFace(({ kind: 'face', name: 'f2', fingerprint: { type: 'cylinder', size: 1, center: [0, 0, 0], dir: [0, 0, 1] } }) as Ref);
    expect(normalFrame()).toBeNull();
    stubViewer();
    viewNormal().run();
    expect(views).toEqual(['front']);
    store.selectFace(null);
    store.select(null);
  });

  it('still reachable while drawing a sketch, and held back while another session is on', () => {
    store.select('plane:front');
    // Read the state after the selection: set() replaces the object, so a snapshot taken earlier
    // still holds selected: null.
    const idle = store.getState();
    expect(viewNormal().enabled(idle)).toBe(true);

    const sketchingState = { ...idle, editing: { kind: 'sketch', featureId: 's1' } } as unknown as UiState;
    expect(viewNormal().enabled(sketchingState)).toBe(true);

    // partIdle guards this action like its neighbours (offset-sketch, angle-sketch): measuring or
    // editing a feature is not a moment to spin the view.
    const measuring = { ...idle, measure: { start: 0 } } as unknown as UiState;
    expect(viewNormal().enabled(measuring)).toBe(false);

    store.select(null);
  });

  it('ignores IME composition Escape/Enter events in global shortcuts (A02, B04)', () => {
    let keyHandler: ((e: KeyboardEvent) => void) | null = null;
    const win = (globalThis as unknown as { window: { addEventListener: (type: string, fn: (e: KeyboardEvent) => void) => void; removeEventListener: () => void } }).window;
    const prevAdd = win.addEventListener;
    win.addEventListener = (type, fn) => {
      if (type === 'keydown') keyHandler = fn;
    };
    const dispose = installShortcuts();
    win.addEventListener = prevAdd;
    expect(keyHandler).toBeTypeOf('function');

    let cancelled = 0;
    store.cancelFeatureGesture = () => {
      cancelled++;
    };
    keyHandler!({ key: 'Escape', isComposing: true, keyCode: 27, defaultPrevented: false, preventDefault: () => {}, stopImmediatePropagation: () => {} } as unknown as KeyboardEvent);
    keyHandler!({ key: 'Escape', isComposing: false, keyCode: 229, defaultPrevented: false, preventDefault: () => {}, stopImmediatePropagation: () => {} } as unknown as KeyboardEvent);
    expect(cancelled).toBe(0);
    keyHandler!({ key: 'Escape', isComposing: false, keyCode: 27, defaultPrevented: false, preventDefault: () => {}, stopImmediatePropagation: () => {} } as unknown as KeyboardEvent);
    expect(cancelled).toBe(1);

    store.cancelFeatureGesture = null;
    dispose();
  });
});
