import { afterEach, describe, expect, it, vi } from 'vitest';
import { en, getLocale, labelsOf, placeholdersOf, registerTranslation, setLocale, subscribeLocale, t, zhTW, type MessageKey } from '../src/index';

afterEach(() => {
  setLocale('zh-TW');
  registerTranslation('en', en); // the real English back, whatever a test put in its place
});

/** A language that lacks these texts, as one being translated would. */
const without = (...keys: MessageKey[]) => registerTranslation('en', Object.fromEntries(keys.map((k) => [k, undefined])));

describe('messages', () => {
  it('fills the placeholders of a template', () => {
    expect(t('cmd.featureNotFound', { id: 'e7' })).toBe('找不到特徵：e7');
    expect(t('cmd.angleOutOfRange', { label: 'A', value: 400 })).toBe('A：「400」');
    expect(t('datum.top')).toBe('上基準面');
  });

  it('checks the placeholders when the code is compiled', () => {
    // @ts-expect-error a message with a placeholder needs its parameters
    expect(() => t('cmd.featureNotFound')).not.toThrow();
    // @ts-expect-error a parameter the message does not have (and one it misses)
    expect(() => t('cmd.featureNotFound', { name: 'x' })).not.toThrow();
    // @ts-expect-error a message without placeholders takes no parameters
    expect(() => t('datum.top', { id: 'x' })).not.toThrow();
  });

  it('shows the source text for what a language has not translated, and the translation for what it has', () => {
    without('datum.front');
    registerTranslation('en', { 'datum.top': 'Top Plane (test)' });
    setLocale('en');
    expect(t('datum.top')).toBe('Top Plane (test)');
    expect(t('datum.front')).toBe('前基準面');
    expect(getLocale()).toBe('en');
  });

  it('keeps the placeholders when a translation moves them', () => {
    registerTranslation('en', { 'cmd.idInUse': 'The ID {id} is already used' });
    setLocale('en');
    expect(t('cmd.idInUse', { id: 'l3' })).toBe('The ID l3 is already used');
  });

  it('leaves a placeholder that was not given as it is, rather than printing "undefined"', () => {
    // the type refuses this call; the runtime still must not print nonsense
    expect((t as (key: string, params: object) => string)('cmd.idInUse', {})).toBe('ID 已被使用：{id}');
  });

  it('tells listeners when the language changes, and only then', () => {
    const seen = vi.fn();
    const off = subscribeLocale(seen);
    setLocale('zh-TW'); // already so
    expect(seen).not.toHaveBeenCalled();
    setLocale('en');
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    setLocale('zh-TW');
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('reads label tables when they are used, so they follow the language', () => {
    const labels = labelsOf({ top: 'datum.top', front: 'datum.front' });
    without('datum.front');
    expect(labels.top).toBe('上基準面');
    setLocale('en');
    expect(labels.top).toBe('Top Plane');
    expect(Object.entries(labels)).toEqual([
      ['top', 'Top Plane'],
      ['front', '前基準面'],
    ]);
  });
});

describe('the source catalog', () => {
  const entries = Object.entries(zhTW) as [MessageKey, string][];

  it('has no text without content, and only well-formed placeholders', () => {
    for (const [key, text] of entries) {
      expect(text.length, key).toBeGreaterThan(0);
      // every brace belongs to a {name}
      expect(text.replace(/\{\w+\}/g, ''), key).not.toMatch(/[{}]/);
    }
  });

  it('names its keys <area>.<name>', () => {
    for (const [key] of entries) expect(key, key).toMatch(/^[a-z][A-Za-z]*(\.[A-Za-z][A-Za-z0-9]*)+$/);
  });

  it('lists the placeholders of a template', () => {
    expect(placeholdersOf('{b} und {a} und {b}')).toEqual(['a', 'b']);
    expect(placeholdersOf('none')).toEqual([]);
  });
});

describe('the English catalog (D9.1)', () => {
  const english = Object.entries(en) as [MessageKey, string][];

  it('translates only texts that exist in the source catalog', () => {
    for (const [key] of english) expect(key in zhTW, key).toBe(true);
  });

  it('translates every text of the source catalog', () => {
    const missing = (Object.keys(zhTW) as MessageKey[]).filter((k) => !en[k]);
    expect(missing).toEqual([]);
  });

  it('keeps the placeholders of each text, and the English has no Chinese in it (except the name of the language)', () => {
    for (const [key, text] of english) {
      expect(placeholdersOf(text), key).toEqual(placeholdersOf(zhTW[key]));
      if (key !== 'options.languageZh') expect(text, key).not.toMatch(/[\u3000-\u9fff]/);
    }
  });
});
