/**
 * The browser's own right-click menu (Back, Save as, Print, Inspect, and whatever the extensions add) has nothing to do in a CAD
 * window, and it appeared on top of the app's menus whenever a right-click landed where the app had no handler: on the open menu
 * itself, on the default planes, on the empty part of the tree. One rule for the whole page instead of one handler per place:
 * it stays only where text is typed, so that copy and paste work.
 */

/** The parts of an element the rule reads (a plain object in tests). */
export interface MenuTarget {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
}

/** Input types that take text; a checkbox, a button or a color has no use for Copy and Paste. */
const TEXT_TYPES = new Set(['', 'text', 'search', 'number', 'url', 'email', 'password', 'tel']);

/** Does a right-click on this element keep the browser's menu? */
export function keepsNativeMenu(target: MenuTarget | null): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName?.toUpperCase();
  if (tag === 'TEXTAREA') return true;
  return tag === 'INPUT' && TEXT_TYPES.has((target.type ?? '').toLowerCase());
}

/** Takes the browser's right-click menu away from the page, except where {@link keepsNativeMenu} says to keep it. Returns the undo. */
export function suppressNativeMenu(doc: Pick<Document, 'addEventListener' | 'removeEventListener'> = document): () => void {
  const onContextMenu = (e: Event) => {
    const target = e.target as MenuTarget | null;
    if (!keepsNativeMenu(target)) e.preventDefault();
  };
  doc.addEventListener('contextmenu', onContextMenu);
  return () => doc.removeEventListener('contextmenu', onContextMenu);
}
