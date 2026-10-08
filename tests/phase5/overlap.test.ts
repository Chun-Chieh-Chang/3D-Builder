/**
 * The dimensions whose text lies over another's (the panel's 「建議改用孔表」): boxes from the text's anchor, height and the width of its characters (a Chinese character is
 * 1.4 times its height wide, any other 0.62).
 */
import { describe, expect, it } from 'vitest';
import { overlappingDimensions, type SceneItem } from '@3db/drawing';

const text = (group: string, at: [number, number], s: string, extra: Partial<Extract<SceneItem, { kind: 'text' }>> = {}): SceneItem => ({ kind: 'text', group, at, text: s, height: 3.5, ...extra });
const ids = (...g: string[]) => new Set(g);

describe('overlapping dimension texts', () => {
  it('two long hole notes 20 mm apart on one baseline lie over each other: both are counted, a third far away is not', () => {
    const items = [text('a', [0, 0], 'Ø6.6 貫穿 沉頭 Ø11 深 6.5'), text('b', [20, 0], 'M6 貫穿（底孔 Ø5）'), text('c', [200, 0], 'Ø9 深 8')];
    expect(overlappingDimensions(items, ids('a', 'b', 'c'))).toBe(2);
  });

  it('texts that only touch, or are above each other with room between, do not count', () => {
    const w = 'ABCD'.length * 0.62 * 3.5;
    expect(overlappingDimensions([text('a', [0, 0], 'ABCD'), text('b', [w, 0], 'ABCD')], ids('a', 'b'))).toBe(0);
    expect(overlappingDimensions([text('a', [0, 0], 'ABCD'), text('b', [0, 5], 'ABCD')], ids('a', 'b'))).toBe(0);
    expect(overlappingDimensions([text('a', [0, 0], 'ABCD'), text('b', [0, 2], 'ABCD')], ids('a', 'b'))).toBe(2);
  });

  it('the anchor and the angle are taken into account; texts of one dimension, and of dimensions not asked about, are left out', () => {
    // centred on x = 20 it reaches 20 − w/2: lies over the one at x = 10; right-anchored at 30 it ends at 30
    expect(overlappingDimensions([text('a', [10, 0], 'ABCDEFGH'), text('b', [20, 0], 'ABCDEFGH', { anchor: 'center' })], ids('a', 'b'))).toBe(2);
    expect(overlappingDimensions([text('a', [10, 0], 'ABCDEFGH'), text('b', [100, 0], 'ABCDEFGH', { anchor: 'right' })], ids('a', 'b'))).toBe(0);
    // turned a quarter turn, a text stands up from its baseline
    expect(overlappingDimensions([text('a', [0, 0], 'ABCDEFGH', { angle: 90 }), text('b', [-1, 5], 'AB')], ids('a', 'b'))).toBe(2);
    expect(overlappingDimensions([text('a', [0, 0], 'AB'), text('a', [1, 0], 'CD')], ids('a'))).toBe(0);
    expect(overlappingDimensions([text('a', [0, 0], 'AB'), text('b', [1, 0], 'CD')], ids('a'))).toBe(0);
  });
});
