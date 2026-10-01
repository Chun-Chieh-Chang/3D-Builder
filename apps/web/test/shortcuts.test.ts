import { describe, expect, it } from 'vitest';
import { conflictWith, effective, formatEvent, loadOverrides, matchesShortcut, saveOverrides } from '../src/shortcuts';

const key = (k: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>> = {}) => ({ key: k, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

describe('shortcuts (D3.3)', () => {
  it('a key press is written the way the registry writes it; a modifier alone is not a shortcut', () => {
    expect(formatEvent(key('z', { ctrlKey: true }))).toBe('Ctrl+Z');
    expect(formatEvent(key('e', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+E');
    expect(formatEvent(key('F'))).toBe('F');
    expect(formatEvent(key('F5'))).toBe('F5');
    expect(formatEvent(key('1', { metaKey: true, altKey: true }))).toBe('Ctrl+Alt+1');
    expect(formatEvent(key('Shift', { shiftKey: true }))).toBeNull();
    expect(formatEvent(key('Control', { ctrlKey: true }))).toBeNull();
  });

  it('Ctrl and Alt must be as written, Shift only when written', () => {
    expect(matchesShortcut(key('z', { ctrlKey: true }), 'Ctrl+Z')).toBe(true);
    expect(matchesShortcut(key('Z', { ctrlKey: true, shiftKey: true }), 'Ctrl+Z')).toBe(true); // written before Shift was a choice
    expect(matchesShortcut(key('z'), 'Ctrl+Z')).toBe(false);
    expect(matchesShortcut(key('z', { ctrlKey: true, altKey: true }), 'Ctrl+Z')).toBe(false);
    expect(matchesShortcut(key('e', { ctrlKey: true }), 'Ctrl+Shift+E')).toBe(false);
    expect(matchesShortcut(key('E', { ctrlKey: true, shiftKey: true }), 'Ctrl+Shift+E')).toBe(true);
    expect(matchesShortcut(key('f'), 'F')).toBe(true);
    expect(matchesShortcut(key('f', { ctrlKey: true }), 'F')).toBe(false);
  });

  it('the user’s choice wins; the empty text takes the shortcut away; nothing chosen is the default', () => {
    expect(effective('undo', 'Ctrl+Z', {})).toBe('Ctrl+Z');
    expect(effective('undo', 'Ctrl+Z', { undo: 'Ctrl+Q' })).toBe('Ctrl+Q');
    expect(effective('undo', 'Ctrl+Z', { undo: '' })).toBeUndefined();
    expect(effective('extrude', undefined, { extrude: 'E' })).toBe('E');
  });

  it('a combination another action has is found, whatever the case; the action itself is not its own conflict', () => {
    const actions = [{ id: 'undo', shortcut: 'Ctrl+Z' }, { id: 'redo', shortcut: 'Ctrl+Y' }, { id: 'fit' }];
    expect(conflictWith('ctrl+z', 'redo', actions, {})).toBe('undo');
    expect(conflictWith('Ctrl+Z', 'undo', actions, {})).toBeNull();
    expect(conflictWith('Ctrl+Y', 'fit', actions, { redo: 'Ctrl+R' })).toBeNull(); // redo no longer has it
    expect(conflictWith('Ctrl+R', 'fit', actions, { redo: 'Ctrl+R' })).toBe('redo');
  });

  it('the choices are kept as text and read back; what is not readable is no choices', () => {
    const box = new Map<string, string>();
    const storage = { getItem: (k: string) => box.get(k) ?? null, setItem: (k: string, v: string) => void box.set(k, v), removeItem: (k: string) => void box.delete(k) };
    expect(loadOverrides(storage)).toEqual({});
    saveOverrides({ extrude: 'E', undo: '' }, storage);
    expect(loadOverrides(storage)).toEqual({ extrude: 'E', undo: '' });
    saveOverrides({}, storage);
    expect(box.size).toBe(0);
    box.set('3db.shortcuts', '{not json');
    expect(loadOverrides(storage)).toEqual({});
    box.set('3db.shortcuts', '[1]');
    expect(loadOverrides(storage)).toEqual({});
    box.set('3db.shortcuts', JSON.stringify({ a: 'X', b: 5 }));
    expect(loadOverrides(storage)).toEqual({ a: 'X' });
    expect(loadOverrides(undefined)).toEqual({});
  });
});
