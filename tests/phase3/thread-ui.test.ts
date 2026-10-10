import { beforeAll, describe, expect, it } from 'vitest';
import type { SketchFeature, ThreadFeature } from '@3db/model';
import type { UiState } from '../../apps/web/src/state/store';

// Mock Worker and browser APIs in Node environment before importing web modules
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
    document: { title: '', addEventListener: () => {}, removeEventListener: () => {}, hidden: false },
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

describe('thread UI and actions integration (T-3)', () => {
  let ACTIONS: typeof import('../../apps/web/src/actions').ACTIONS;
  let FEATURE_LABEL: typeof import('../../apps/web/src/strings').FEATURE_LABEL;
  let helpTopic: typeof import('../../apps/web/src/help/topics').helpTopic;
  let contextTopic: typeof import('../../apps/web/src/help/topics').contextTopic;
  let store: typeof import('../../apps/web/src/state/store').store;

  beforeAll(async () => {
    const actMod = await import('../../apps/web/src/actions');
    ACTIONS = actMod.ACTIONS;
    const strMod = await import('../../apps/web/src/strings');
    FEATURE_LABEL = strMod.FEATURE_LABEL;
    const topMod = await import('../../apps/web/src/help/topics');
    helpTopic = topMod.helpTopic;
    contextTopic = topMod.contextTopic;
    const storeMod = await import('../../apps/web/src/state/store');
    store = storeMod.store;
  });

  it('registers thread action in the feature group', () => {
    const threadAction = ACTIONS.find((a) => a.id === 'thread')!;
    expect(threadAction).toBeDefined();
    expect(threadAction.group).toBe('feature');
    expect(threadAction.label).toMatch(/螺牙|Thread/i);
    expect(FEATURE_LABEL.thread).toMatch(/螺牙|Thread/i);
  });

  it('determines action enablement based on sketch and idle state', () => {
    const threadAction = ACTIONS.find((a) => a.id === 'thread')!;
    const idleNoSketch: UiState = {
      active: 'part',
      editing: null,
      measure: null,
      selected: null,
      selectedFace: null,
      doc: { schemaVersion: 53, units: 'mm', features: [], variables: [], blobs: [], visibility: {}, bodies: {}, idCounters: {} },
    } as unknown as UiState;
    expect(threadAction.enabled(idleNoSketch)).toBe(false);

    const idleWithSketch: UiState = {
      ...idleNoSketch,
      selected: 'sketch1',
      doc: {
        ...idleNoSketch.doc,
        features: [{ id: 'sketch1', type: 'sketch', name: '草圖1', suppressed: false, plane: { kind: 'datum', name: 'plane:front' }, entities: [], constraints: [] } as SketchFeature],
      },
    } as unknown as UiState;
    expect(threadAction.enabled(idleWithSketch)).toBe(true);
  });

  it('has comprehensive help documentation wired to the action', () => {
    const topic = helpTopic('thread', ACTIONS);
    expect(topic).not.toBeNull();
    expect(topic!.summary).toBeTruthy();
    expect(topic!.body.length).toBeGreaterThan(1);
    expect(topic!.keywords).toContain('螺距');
    expect(topic!.see).toContain('revolve');
    expect(contextTopic({ feature: { type: 'thread' } })).toBe('thread');
  });

  it('creates and modifies a thread feature via store', () => {
    store.newPart();
    store.newSketch('plane:front');
    store.commitEdit();

    const sketch = store.getState().doc.features[0] as SketchFeature;
    expect(sketch).toBeDefined();

    // Select the sketch and invoke newThread
    store.select(sketch.id);
    store.newThread('cut');

    const state = store.getState();
    const editing = state.editing;
    expect(editing).not.toBeNull();
    const feature = state.doc.features.find((x) => x.id === editing?.featureId) as ThreadFeature;
    expect(feature).toBeDefined();
    expect(feature.type).toBe('thread');
    expect(feature.sketch).toBe(sketch.id);
    expect(feature.op).toBe('cut');
    expect(feature.pitch).toBe('2');
    expect(feature.starts).toBe('1');
    expect(feature.hand).toBe('right');

    // Update via setThread
    store.execute({
      type: 'setThread',
      featureId: feature.id,
      params: {
        pitch: '2.5',
        starts: '2',
        hand: 'left',
        length: '15',
        taper: '1.718',
        phase: '60',
        reverse: true,
      },
    });

    const updated = store.getState().doc.features.find((x) => x.id === editing?.featureId) as ThreadFeature;
    expect(updated.pitch).toBe('2.5');
    expect(updated.starts).toBe('2');
    expect(updated.hand).toBe('left');
    expect(updated.length).toBe('15');
    expect(updated.taper).toBe('1.718');
    expect(updated.phase).toBe('60');
    expect(updated.reverse).toBe(true);

    // Cancel edit to leave state clean
    store.cancelEdit();
    expect(store.getState().editing).toBeNull();
  });
});
