import { describe, expect, it } from 'vitest';
import { DEFAULT_GRACE_SECONDS, graceFromEnv, idleWatcher } from '../../apps/web/dev/autoClose.ts';

// `npm run dev:auto` (apps/web/dev/autoClose.ts): the dev server stops when the last page is gone. The decision is a function of the clock and the number of connected pages.
describe('the dev server stops when no page is connected', () => {
  const watcher = () => idleWatcher({ graceSeconds: 30, firstConnectSeconds: 120 });

  it('waits 30 seconds after the last page is gone, not before', () => {
    const w = watcher();
    expect(w.tick(0, 1)).toBe(false);
    expect(w.tick(10_000, 0)).toBe(false); // gone at 10 s
    expect(w.tick(39_999, 0)).toBe(false); // 29.999 s later
    expect(w.tick(40_000, 0)).toBe(true); // 30 s later
  });

  it('a page that comes back within the grace (a reload) keeps it running, and the grace starts again afterwards', () => {
    const w = watcher();
    w.tick(0, 1);
    expect(w.tick(5_000, 0)).toBe(false);
    expect(w.tick(20_000, 1)).toBe(false); // back
    expect(w.tick(21_000, 0)).toBe(false); // gone again at 21 s
    expect(w.tick(50_999, 0)).toBe(false);
    expect(w.tick(51_000, 0)).toBe(true);
  });

  it('before any page has ever connected it waits 120 seconds (a browser takes time to start)', () => {
    const w = watcher();
    expect(w.tick(0, 0)).toBe(false);
    expect(w.tick(119_999, 0)).toBe(false);
    expect(w.tick(120_000, 0)).toBe(true);
  });

  it('never stops while a page is connected, however long', () => {
    const w = watcher();
    for (let t = 0; t <= 86_400_000; t += 60_000) expect(w.tick(t, 2)).toBe(false);
  });

  it('the seconds come from DEV_AUTO_CLOSE_SECONDS, and anything that is not a positive number is 30', () => {
    expect(graceFromEnv('45')).toBe(45);
    expect(graceFromEnv('0.5')).toBe(0.5);
    for (const bad of [undefined, '', 'abc', '0', '-3', 'NaN', 'Infinity']) expect(graceFromEnv(bad)).toBe(DEFAULT_GRACE_SECONDS);
  });
});
