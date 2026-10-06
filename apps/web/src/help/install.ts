import { helpState, openHelp, setPicking, showTopic, subscribeHelp } from './state';

/** The events 「這是什麼？」 takes for itself, so the thing clicked is asked about instead of used. */
const PICK_EVENTS = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu'] as const;

/** The part of an element the help looks at (so it can be tried without a page). */
export interface Pickable {
  closest(selector: string): { getAttribute(name: string): string | null } | null;
}

/** What the help needs to know about the program. */
export interface HelpDeps {
  /** The topic for what is going on now (F1). */
  currentTopic(): string;
  /** Whether there is a topic with this id. */
  hasTopic(id: string): boolean;
}

/** Where a click is the help's own (its window and its buttons): it works as usual while 「這是什麼？」 is on. */
const isHelpUi = (el: Pickable | null) => !!el?.closest('.help-panel, .help-buttons');

/** The topic id of the nearest element at or above `el` that says what it is, if the help has a topic for it. */
export function topicAt(el: Pickable | null, hasTopic: (id: string) => boolean): string | null {
  const id = el?.closest('[data-help]')?.getAttribute('data-help') ?? null;
  return id && hasTopic(id) ? id : null;
}

/**
 * F1 opens the help on what is going on; 「這是什麼？」 turns the next click into a question about what was clicked; Esc ends it. Returns what
 * takes the listeners off.
 */
export function installHelp(deps: HelpDeps, root: Document = document): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'F1') {
      e.preventDefault();
      openHelp(deps.currentTopic());
    } else if (e.key === 'Escape' && helpState().picking) {
      e.preventDefault();
      e.stopPropagation();
      setPicking(false);
    }
  };
  const onPick = (e: Event) => {
    if (!helpState().picking) return;
    const raw = e.target as unknown as Partial<Pickable> | null;
    const target = typeof raw?.closest === 'function' ? (raw as Pickable) : null;
    if (isHelpUi(target)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.type !== 'click') return;
    const id = topicAt(target, deps.hasTopic);
    if (id) {
      showTopic(id);
      setPicking(false);
    }
  };
  const onState = () => root.body.classList.toggle('help-picking', helpState().picking);
  root.addEventListener('keydown', onKey, true);
  for (const type of PICK_EVENTS) root.addEventListener(type, onPick, true);
  const stop = subscribeHelp(onState);
  return () => {
    root.removeEventListener('keydown', onKey, true);
    for (const type of PICK_EVENTS) root.removeEventListener(type, onPick, true);
    stop();
    root.body.classList.remove('help-picking');
  };
}
