import { describe, expect, it } from 'vitest';
import type { Component } from '@3db/model';
import { dragHint, immovable } from '../src/state/movability';

const component = (fixed: boolean): Component => ({ id: 'c', file: 'f', instance: 1, fixed, placement: { position: [0, 0, 0], rotation: [0, 0, 0, 1] } });
const solved = (status: 'fixed' | 'full' | 'under' | 'over', dof: number) => ({ components: new Map([['c', { status, dof }]]) });

describe('what the mouse does on a component (C15.3)', () => {
  it('a free component: the left button moves it, the right button turns it', () => {
    expect(dragHint(component(false), solved('under', 3), null)).toBe('左鍵拖曳移動，右鍵拖曳旋轉');
    expect(dragHint(component(false), solved('under', 3), 'move')).toBe('左鍵拖曳移動，右鍵拖曳旋轉');
  });

  it('with 「旋轉零組件」 open, the left button turns it too', () => {
    expect(dragHint(component(false), solved('under', 1), 'rotate')).toBe('左鍵拖曳旋轉，右鍵拖曳旋轉');
  });

  it('says so when it cannot move, whichever tool is open', () => {
    expect(dragHint(component(true), solved('fixed', 0), 'rotate')).toBe('已固定，不能拖曳');
    expect(dragHint(component(false), solved('full', 0), null)).toBe('已被結合完全定義，不能拖曳');
  });

  it('a component that is not solved yet can be dragged (it is judged when the solution is there)', () => {
    expect(immovable(component(false), null)).toBeNull();
    expect(immovable(component(false), undefined)).toBeNull();
    expect(immovable(component(true), null)).toBe('fixed');
  });

  it('a component that still has freedoms is not held back by its mates', () => {
    expect(immovable(component(false), solved('under', 1))).toBeNull();
    expect(immovable(component(false), solved('over', 0))).toBe('defined');
  });
});
