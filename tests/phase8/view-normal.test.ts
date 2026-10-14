/**
 * 「正視於」 outside a sketch (C2): which frame a selection resolves to, and where the command is reachable.
 * The camera arithmetic fed by this frame is viewNav's own (checked in view-keys.test.ts); what is new
 * here is the selection → frame rule, so the assertions are on the frame itself — the normal, the screen's
 * up and, for a face, the origin it puts on the plane — not on whether a button happens to light up.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { UiState } from '../../apps/web/src/state/store';
import type { Ref } from '@3db/model';

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
  let normalFrame: typeof import('../../apps/web/src/actions').normalFrame;
  let store: typeof import('../../apps/web/src/state/store').store;

  beforeAll(async () => {
    ({ action, normalFrame } = await import('../../apps/web/src/actions'));
    ({ store } = await import('../../apps/web/src/state/store'));
  });

  const viewNormal = () => action('view-normal');
  /** The same face shape the picker builds from a fingerprint, with the fields planeFrame reads. */
  const planarFace = (dir: [number, number, number]): Ref =>
    ({ kind: 'face', name: 'f1', fingerprint: { type: 'plane', size: 100, center: [1, 2, 3], dir } }) as Ref;

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

  it('nothing selected means no frame — and no command to press', () => {
    store.select(null);
    store.selectFace(null);
    expect(normalFrame()).toBeNull();
    expect(viewNormal().enabled(store.getState())).toBe(false);
  });

  it('the command is reachable exactly where there is a plane to look at', () => {
    store.select('plane:front');
    expect(viewNormal().enabled(store.getState())).toBe(true);

    store.selectFace(planarFace([0, 1, 0]));
    expect(viewNormal().enabled(store.getState())).toBe(true);

    store.selectFace(null);
    store.select(null);

    // A curved face has no plane to look straight at, so the command stays off rather than doing nothing.
    store.selectFace(({ kind: 'face', name: 'f2', fingerprint: { type: 'cylinder', size: 1, center: [0, 0, 0], dir: [0, 0, 1] } }) as Ref);
    expect(normalFrame()).toBeNull();
    expect(viewNormal().enabled(store.getState())).toBe(false);
    store.selectFace(null);
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
});
