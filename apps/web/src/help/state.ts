import { useSyncExternalStore } from 'react';

/**
 * What the help window and 「這是什麼？」 are doing. Only that: the texts come from the catalog (`topics.ts`), what is going on in the program
 * comes from `context.ts`, so nothing is kept here that could drift from either.
 */
export interface HelpState {
  open: boolean;
  /** The topic shown; null shows the contents (or the results of the query). */
  topic: string | null;
  query: string;
  /** 「這是什麼？」 is on: the next click on something asks for its topic. */
  picking: boolean;
  /** Topics left behind by following a link, the last one first. */
  back: string[];
}

let current: HelpState = { open: false, topic: null, query: '', picking: false, back: [] };
const listeners = new Set<() => void>();

const set = (next: Partial<HelpState>) => {
  current = { ...current, ...next };
  for (const fn of listeners) fn();
};

export const helpState = (): HelpState => current;
export const subscribeHelp = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export const useHelp = (): HelpState => useSyncExternalStore(subscribeHelp, helpState);

/** Opens the window on a topic (or on the contents when none is given). */
export function openHelp(topic: string | null = null): void {
  set({ open: true, topic, query: '', picking: false, back: [] });
}

export function closeHelp(): void {
  set({ open: false, picking: false });
}

/** Follows a link: shows the topic and remembers the one it left. */
export function showTopic(topic: string): void {
  set({ open: true, topic, query: '', back: current.topic ? [current.topic, ...current.back] : current.back });
}

export function goBack(): void {
  const [previous, ...rest] = current.back;
  set({ topic: previous ?? null, back: rest });
}

export function setQuery(query: string): void {
  set({ query, topic: query === '' ? current.topic : null });
}

export function showContents(): void {
  set({ topic: null, query: '', back: [] });
}

export function setPicking(picking: boolean): void {
  set({ picking });
}

/** Test seam: back to the start. */
export function resetHelp(): void {
  current = { open: false, topic: null, query: '', picking: false, back: [] };
  for (const fn of listeners) fn();
}
