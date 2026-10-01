import { describe, expect, it } from 'vitest';
import { AUTOSAVE_SECONDS, DEFAULT_OPTIONS, loadOptions, parseOptions, saveOptions } from '../src/options';

describe('system options (D8.1)', () => {
  it('nothing stored, or something that is not an object, gives the defaults', () => {
    expect(parseOptions(undefined)).toEqual(DEFAULT_OPTIONS);
    expect(parseOptions('x')).toEqual(DEFAULT_OPTIONS);
    expect(parseOptions([1, 2])).toEqual(DEFAULT_OPTIONS);
    expect(loadOptions({ getItem: () => 'not json' })).toEqual(DEFAULT_OPTIONS);
    expect(loadOptions({ getItem: () => null })).toEqual(DEFAULT_OPTIONS);
  });

  it('each value that is not what it should be is the default, the others are kept', () => {
    const o = parseOptions({ autosave: 'yes', autosaveSeconds: 30, defaultTemplate: 'no-such-template', pickFilter: { faces: false, edges: 'x' } });
    expect(o.autosave).toBe(true);
    expect(o.autosaveSeconds).toBe(30);
    expect(o.defaultTemplate).toBe('blank');
    expect(o.pickFilter).toEqual({ faces: false, edges: true, vertices: true });
  });

  it('the autosave wait is a whole number of seconds within the limits', () => {
    expect(parseOptions({ autosaveSeconds: 0 }).autosaveSeconds).toBe(AUTOSAVE_SECONDS.min);
    expect(parseOptions({ autosaveSeconds: 99999 }).autosaveSeconds).toBe(AUTOSAVE_SECONDS.max);
    expect(parseOptions({ autosaveSeconds: 7.6 }).autosaveSeconds).toBe(8);
    expect(parseOptions({ autosaveSeconds: NaN }).autosaveSeconds).toBe(DEFAULT_OPTIONS.autosaveSeconds);
  });

  it('what is saved is what is loaded', () => {
    let kept = '';
    const options = { autosave: false, autosaveSeconds: 60, defaultTemplate: 'aluminium' as const, pickFilter: { faces: true, edges: false, vertices: false } };
    saveOptions(options, { setItem: (_k, v) => void (kept = v) });
    expect(loadOptions({ getItem: () => kept })).toEqual(options);
  });

  it('a browser that refuses to store does not stop the program', () => {
    expect(() =>
      saveOptions(DEFAULT_OPTIONS, {
        setItem: () => {
          throw new Error('blocked');
        },
      }),
    ).not.toThrow();
    expect(
      loadOptions({
        getItem: () => {
          throw new Error('blocked');
        },
      }),
    ).toEqual(DEFAULT_OPTIONS);
  });
});
