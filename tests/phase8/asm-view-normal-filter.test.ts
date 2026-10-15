/**
 * 「正視於」 and the selection filter in an assembly (ADR 0148). Both were held back to a part: `view-normal` was enabled only for a sketch or an idle part, the filter
 * keys and the bar only for a part, and the assembly's viewer was never given the filter. Here (1) what 「正視於」 looks straight at in an assembly — the plane picked
 * last, from the mate's elements or the FeatureManager — is read off the real AssemblyStore from the assembly's own planes; (2) the actions are on in an assembly.
 * A planar face of a component (placed by its pose) and the viewer's use of the filter need a built part and a canvas: manual-asm-view-normal.js.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createEmptyAssembly, type MateRef } from '@3db/model';
import type { UiState } from '../../apps/web/src/state/store';
import type { AssemblyHost } from '../../apps/web/src/state/assembly';

// Browser APIs the store and its imports expect in Node (same shims as view-normal.test.ts).
class MockWorker {
  postMessage() {}
  addEventListener() {}
  removeEventListener() {}
  terminate() {}
}
if (typeof (globalThis as unknown as { Worker?: unknown }).Worker === 'undefined') (globalThis as unknown as { Worker: typeof MockWorker }).Worker = MockWorker;
if (typeof (globalThis as unknown as { window?: unknown }).window === 'undefined') {
  (globalThis as unknown as { window: unknown }).window = { addEventListener: () => {}, removeEventListener: () => {}, location: { href: '' }, document: { title: '', addEventListener: () => {}, hidden: false } };
}
if (typeof (globalThis as unknown as { document?: unknown }).document === 'undefined') {
  (globalThis as unknown as { document: unknown }).document = { addEventListener: () => {}, removeEventListener: () => {}, title: '', hidden: false };
}

const datum = (name: string): MateRef => ({ component: null, ref: { kind: 'datum', name } });

describe('「正視於」 and the selection filter in an assembly (ADR 0148)', () => {
  let AssemblyStore: typeof import('../../apps/web/src/state/assembly').AssemblyStore;
  let action: typeof import('../../apps/web/src/actions').action;
  let store: typeof import('../../apps/web/src/state/store').store;

  beforeAll(async () => {
    ({ AssemblyStore } = await import('../../apps/web/src/state/assembly'));
    ({ action } = await import('../../apps/web/src/actions'));
    ({ store } = await import('../../apps/web/src/state/store'));
  });

  const open = () => {
    const host = { api: {}, changed: () => {}, notify: () => {}, projectFolder: async () => null } as unknown as AssemblyHost;
    return new AssemblyStore(host, { doc: createEmptyAssembly(), handle: null, fileName: null, folder: '', untitled: '組合件', project: null });
  };

  it('nothing picked: no plane — the press answers with the isometric view', () => {
    expect(open().normalFrame()).toBeNull();
  });

  it('a plane of the assembly picked in the FeatureManager gives that plane’s own frame, the last one when several', () => {
    const a = open();
    a.pickDatum(datum('plane:front'), false);
    expect(a.normalFrame()).toMatchObject({ normal: [0, 0, 1], yDir: [0, 1, 0] });
    a.pickDatum(datum('plane:right'), true);
    expect(a.normalFrame()).toMatchObject({ normal: [1, 0, 0] });
    a.pickDatum(datum('plane:top'), true);
    expect(a.normalFrame()).toMatchObject({ normal: [0, 1, 0] });
    // taking the last one off falls back to the one before it
    a.pickDatum(datum('plane:top'), true);
    expect(a.normalFrame()).toMatchObject({ normal: [1, 0, 0] });
  });

  it('the origin is a point, not a plane: nothing to look straight at', () => {
    const a = open();
    a.pickDatum(datum('origin'), false);
    expect(a.normalFrame()).toBeNull();
  });

  it('while a mate is defined, its elements are looked at, not what was in the FeatureManager pick list; a refused second element changes nothing', () => {
    const a = open();
    a.pickDatum(datum('plane:top'), false);
    a.pickDatum(datum('plane:right'), true);
    a.startMate(); // the tree picks become the mate's elements; two planes of the assembly itself cannot be mated, the second is refused
    expect(a.getState().mate?.a).toMatchObject({ ref: { name: 'plane:top' } });
    expect(a.getState().mate?.b).toBeNull();
    expect(a.getState().picks).toEqual([]);
    expect(a.normalFrame()).toMatchObject({ normal: [0, 1, 0] });
  });

  it('the frame is a unit one: perpendicular axes, normal unit length', () => {
    const a = open();
    for (const name of ['plane:front', 'plane:top', 'plane:right']) {
      a.pickDatum(datum(name), false);
      const f = a.normalFrame()!;
      const dot = (p: number[], q: number[]) => p[0]! * q[0]! + p[1]! * q[1]! + p[2]! * q[2]!;
      expect(dot(f.normal, f.normal)).toBeCloseTo(1, 12);
      expect(dot(f.xDir, f.normal)).toBeCloseTo(0, 12);
      expect(dot(f.yDir, f.normal)).toBeCloseTo(0, 12);
      expect(dot(f.xDir, f.yDir)).toBeCloseTo(0, 12);
    }
  });

  it('the actions are on in an assembly — and still off in a drawing, and for 正視於 only in a part or an assembly', () => {
    const base = store.getState();
    const asm = { ...base, active: 'assembly', measure: null } as unknown as UiState;
    for (const id of ['view-normal', 'filter-bar', 'clear-filters']) expect(action(id).enabled(asm), id).toBe(true);
    const drawing = { ...base, active: 'drawing', measure: null } as unknown as UiState;
    for (const id of ['view-normal', 'filter-bar', 'clear-filters']) expect(action(id).enabled(drawing), id).toBe(false);
    // measuring in an assembly is a moment where the view is turned to look at the face being measured
    const measuring = { ...asm, measure: { picks: [] } } as unknown as UiState;
    expect(action('view-normal').enabled(measuring)).toBe(true);
  });
});
