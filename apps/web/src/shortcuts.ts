/**
 * Shortcuts (D3.3): the keys of the actions, as the registry names them (`Ctrl+Z`, `F`, `Ctrl+Shift+E`), and the ones the user chose instead, kept in the browser.
 * An action's choice is a key combination, or the empty text for "no shortcut". Nothing here knows the actions: `effective` is given the default.
 */

const KEY = '3db.shortcuts';
export type Overrides = Record<string, string>;

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock']);

/** The combination a key press makes, as the registry writes it; null for a press of a modifier alone. */
export function formatEvent(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return [...(e.ctrlKey || e.metaKey ? ['Ctrl'] : []), ...(e.altKey ? ['Alt'] : []), ...(e.shiftKey ? ['Shift'] : []), key].join('+');
}

/**
 * Does this key press make this shortcut? Ctrl and Alt must be as written; Shift only when the shortcut asks for it (the shortcuts written before it was a
 * choice, `F`, `Ctrl+Z`, do not mind it).
 */
export function matchesShortcut(e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>, shortcut: string): boolean {
  const parts = shortcut.split('+');
  const key = parts.pop()!.toLowerCase();
  if (e.key.toLowerCase() !== key) return false;
  if (parts.includes('Ctrl') !== (e.ctrlKey || e.metaKey)) return false;
  if (parts.includes('Alt') !== e.altKey) return false;
  return !parts.includes('Shift') || e.shiftKey;
}

/** What the user chose, or nothing when it is not there or not readable. */
export function loadOverrides(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): Overrides {
  try {
    const raw = storage?.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === 'string')) as Overrides;
  } catch {
    return {};
  }
}

export function saveOverrides(overrides: Overrides, storage: Pick<Storage, 'setItem' | 'removeItem'> | undefined = safeStorage()): void {
  try {
    if (Object.keys(overrides).length === 0) storage?.removeItem(KEY);
    else storage?.setItem(KEY, JSON.stringify(overrides));
  } catch {
    // no storage (a private window): the choice lasts until the page is closed
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** The shortcut an action has: the user's choice (the empty text: none), else the default. */
export const effective = (id: string, byDefault: string | undefined, overrides: Overrides): string | undefined => {
  const chosen = overrides[id];
  return chosen === undefined ? byDefault : chosen === '' ? undefined : chosen;
};

/** The id of another action that already has this shortcut, if any. */
export function conflictWith(shortcut: string, id: string, actions: readonly { id: string; shortcut?: string }[], overrides: Overrides): string | null {
  const wanted = shortcut.toLowerCase();
  return actions.find((a) => a.id !== id && effective(a.id, a.shortcut, overrides)?.toLowerCase() === wanted)?.id ?? null;
}

let current: Overrides | null = null;
const listeners = new Set<() => void>();

/** The choices in force (read once, then kept). */
export function overrides(): Overrides {
  return (current ??= loadOverrides());
}

/** Sets or takes back (undefined) the choice for an action. */
export function setOverride(id: string, value: string | undefined): void {
  const next = { ...overrides() };
  if (value === undefined) delete next[id];
  else next[id] = value;
  current = next;
  saveOverrides(next);
  for (const fn of listeners) fn();
}

export function resetOverrides(): void {
  current = {};
  saveOverrides({});
  for (const fn of listeners) fn();
}

export function subscribeShortcuts(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
