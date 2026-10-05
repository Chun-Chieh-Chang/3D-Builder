/**
 * The browser's right-click menu is taken away from the page except where text is typed (found in the manual check B1: it came up on
 * top of the app's own menu when a right-click landed on that menu).
 */
import { describe, expect, it } from 'vitest';
import { keepsNativeMenu, suppressNativeMenu, type MenuTarget } from '../../apps/web/src/nativeMenu';

describe('keepsNativeMenu', () => {
  it('keeps it where text is typed', () => {
    for (const type of [undefined, '', 'text', 'search', 'number', 'url', 'email', 'password', 'tel', 'TEXT'])
      expect(keepsNativeMenu({ tagName: 'INPUT', type }), `input ${type}`).toBe(true);
    expect(keepsNativeMenu({ tagName: 'textarea' })).toBe(true);
    expect(keepsNativeMenu({ tagName: 'DIV', isContentEditable: true })).toBe(true);
  });

  it('takes it away everywhere else: the tree, the menus, the viewport, buttons, the inputs that hold no text', () => {
    for (const tagName of ['LI', 'UL', 'DIV', 'BUTTON', 'CANVAS', 'SVG', 'SPAN', 'OL']) expect(keepsNativeMenu({ tagName }), tagName).toBe(false);
    for (const type of ['checkbox', 'radio', 'button', 'color', 'range', 'file']) expect(keepsNativeMenu({ tagName: 'INPUT', type }), `input ${type}`).toBe(false);
    expect(keepsNativeMenu(null)).toBe(false);
  });
});

describe('suppressNativeMenu', () => {
  /** A document that only keeps its listeners, with a way to fire a right-click at a target. */
  const fakeDocument = () => {
    const listeners = new Set<(e: Event) => void>();
    return {
      addEventListener: (_: string, fn: (e: Event) => void) => void listeners.add(fn),
      removeEventListener: (_: string, fn: (e: Event) => void) => void listeners.delete(fn),
      count: () => listeners.size,
      rightClick: (target: MenuTarget | null) => {
        const e = { target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
        for (const fn of listeners) fn(e as unknown as Event);
        return e.defaultPrevented;
      },
    };
  };

  it('prevents the browser menu on the page and leaves a text field alone', () => {
    const doc = fakeDocument();
    suppressNativeMenu(doc as never);
    expect(doc.rightClick({ tagName: 'LI' })).toBe(true);
    expect(doc.rightClick({ tagName: 'UL' })).toBe(true);
    expect(doc.rightClick({ tagName: 'INPUT', type: 'text' })).toBe(false);
  });

  it('is undone by what it returns', () => {
    const doc = fakeDocument();
    const undo = suppressNativeMenu(doc as never);
    expect(doc.count()).toBe(1);
    undo();
    expect(doc.count()).toBe(0);
    expect(doc.rightClick({ tagName: 'LI' })).toBe(false);
  });
});
