import { describe, expect, it } from 'vitest';
import { treeFilterMatches, treeNeedle } from '../../apps/web/src/components/treeFilter';

// The rule behind both FeatureManagers' search box (E1-P2). It lives in a plain module, not in the
// component, so it can be exercised here: this project's vitest runs in `node` and mounts no DOM.
describe('the trees\u2019 search box (E1-P2)', () => {
  it('reads the text the way FeatureTree always has: trimmed and case-insensitive', () => {
    expect(treeNeedle('  Bolt ')).toBe('bolt');
    expect(treeNeedle('BOLT')).toBe('bolt');
    expect(treeNeedle('')).toBe('');
    expect(treeNeedle('   ')).toBe('');
  });

  it('keeps every row when nothing is typed — the tree reads exactly as it did before', () => {
    // The e2e scripts reach for rows by their data-* attributes; an empty box must not take one away.
    const rows = ['Base', 'Bolt A', 'Washer', '(f) Plate'];
    expect(rows.filter((label) => treeFilterMatches(treeNeedle(''), [label]))).toEqual(rows);
  });

  it('keeps a row when any one of its labels holds the needle, ignoring case', () => {
    expect(treeFilterMatches('bolt', ['Bolt A'])).toBe(true);
    expect(treeFilterMatches('BOLT', ['bolt a'])).toBe(true);
    expect(treeFilterMatches('a', ['Bolt A'])).toBe(true);
    expect(treeFilterMatches('zz', ['Bolt A'])).toBe(false);
  });

  it('keeps a row whose file matches even when its name does not (a component is asked for name, file and prefix)', () => {
    const bolt = ['Bolt A', 'C:/parts/bracket.3dbx', '(-) '];
    expect(treeFilterMatches('bolt', bolt)).toBe(true);
    expect(treeFilterMatches('bracket', bolt)).toBe(true);
    expect(treeFilterMatches('nowhere', bolt)).toBe(false);
  });

  it('treats a missing label as empty rather than throwing', () => {
    expect(treeFilterMatches('x', [undefined, null])).toBe(false);
    expect(treeFilterMatches('', [undefined, null])).toBe(true);
  });

  it('treats a box holding only spaces as empty, so no row is taken away', () => {
    expect(treeFilterMatches('   ', ['Bolt A'])).toBe(true);
  });

  it('drops only whole rows and keeps the rest in order', () => {
    const rows = [{ name: 'Bolt A' }, { name: 'Base' }, { name: 'Bolt B' }];
    const kept = rows.filter((r) => treeFilterMatches('bolt', [r.name]));
    expect(kept.map((r) => r.name)).toEqual(['Bolt A', 'Bolt B']);
  });
});
