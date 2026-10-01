import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Autosaver, type Recovery, type RecoveryBox } from '../src/autosave';

/** A box in memory, with every call written down. */
function memoryBox() {
  const log: string[] = [];
  let kept: Recovery | null = null;
  const box: RecoveryBox = {
    async put(e) {
      log.push(`put ${e.untitled}@${e.savedAt}`);
      kept = e;
    },
    async get() {
      return kept;
    },
    async clear() {
      log.push('clear');
      kept = null;
    },
  };
  return { box, log, kept: () => kept };
}

const snap = (untitled = '零件1') => async () => ({ bytes: new Uint8Array([1, 2, 3]), fileName: null, untitled });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('autosave (B9.3)', () => {
  it('keeps a copy a few seconds after the last change, not after each one', async () => {
    const m = memoryBox();
    const a = new Autosaver(m.box, snap(), 5000, () => 42);
    a.changed(true);
    await vi.advanceTimersByTimeAsync(3000);
    a.changed(true);
    await vi.advanceTimersByTimeAsync(3000);
    expect(m.log).toEqual([]); // the second change moved the wait
    await vi.advanceTimersByTimeAsync(2500);
    expect(m.log).toEqual(['put 零件1@42']);
    expect(m.kept()?.bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('a part brought back to what its file holds has no copy any more', async () => {
    const m = memoryBox();
    const a = new Autosaver(m.box, snap(), 1000);
    a.changed(true);
    await vi.advanceTimersByTimeAsync(1500);
    a.changed(false);
    await vi.advanceTimersByTimeAsync(10);
    expect(m.log).toEqual([expect.stringMatching(/^put /), 'clear']);
    expect(m.kept()).toBeNull();
  });

  it('a change waiting when the page goes away is kept at once', async () => {
    const m = memoryBox();
    const a = new Autosaver(m.box, snap('零件2'), 60000, () => 7);
    a.changed(true);
    await a.flush();
    expect(m.log).toEqual(['put 零件2@7']);
    await a.flush(); // nothing new: nothing written
    expect(m.log).toHaveLength(1);
  });

  it('a clear after a change that was waiting means nothing is written', async () => {
    const m = memoryBox();
    const a = new Autosaver(m.box, snap(), 1000);
    a.changed(true);
    await a.clear();
    await vi.advanceTimersByTimeAsync(5000);
    expect(m.log).toEqual(['clear']);
  });

  it('a clear that comes while a copy is being made wins: the copy does not outlive it', async () => {
    const m = memoryBox();
    let release: (v: Awaited<ReturnType<ReturnType<typeof snap>>>) => void = () => {};
    const slow = () => new Promise<Awaited<ReturnType<ReturnType<typeof snap>>>>((r) => (release = r));
    const a = new Autosaver(m.box, slow, 10);
    a.changed(true);
    await vi.advanceTimersByTimeAsync(20); // the copy is being made
    const cleared = a.clear();
    release({ bytes: new Uint8Array([9]), fileName: null, untitled: 'x' });
    await cleared;
    expect(m.log).toEqual([expect.stringMatching(/^put /), 'clear']);
    expect(m.kept()).toBeNull();
  });

  it('a copy that cannot be made does not stop the next one', async () => {
    const m = memoryBox();
    let n = 0;
    const flaky = async () => {
      if (n++ === 0) throw new Error('no memory');
      return { bytes: new Uint8Array([1]), fileName: null, untitled: 'ok' };
    };
    const a = new Autosaver(m.box, flaky, 1000, () => 1);
    a.changed(true);
    await vi.advanceTimersByTimeAsync(1500);
    expect(m.log).toEqual([]);
    a.changed(true);
    await vi.advanceTimersByTimeAsync(1500);
    expect(m.log).toEqual(['put ok@1']);
  });
});
