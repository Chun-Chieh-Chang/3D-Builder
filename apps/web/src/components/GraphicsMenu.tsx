import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MenuEntry } from '../contextMenus';

/**
 * The right-click menu of the graphics area of the part, the sketch and the assembly (D5.5, D5.6, ADR 0176): its lines are `MenuEntry`s (contextMenus.ts),
 * a submenu opens its lines in the menu's place. Closes on any press elsewhere or Esc. `what` says what it was opened on (`data-graphics-menu`).
 */
export function GraphicsMenu({ x, y, items, what, onClose }: { x: number; y: number; items: MenuEntry[]; what: string; onClose: () => void }) {
  const [shown, setShown] = useState(items);
  const root = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = root.current, parent = el?.offsetParent;
    if (!el || !(parent instanceof HTMLElement)) return;
    const fit = () => {
      const left = Math.max(8, Math.min(x, parent.clientWidth - el.offsetWidth - 8));
      const top = Math.max(8, Math.min(y, parent.clientHeight - el.offsetHeight - 8));
      setPosition(previous => previous.left === left && previous.top === top ? previous : { left, top });
    };
    const observer = new ResizeObserver(fit);
    observer.observe(parent); observer.observe(el); fit();
    return () => observer.disconnect();
  }, [x, y, shown]);
  useEffect(() => setShown(items), [items]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', onClose);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', onClose);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);
  return (
    <div ref={root} className="ctx-menu" role="menu" data-graphics-menu={what} style={{ ...position, maxHeight: 'calc(100% - 16px)', overflowY: 'auto' }} onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      {shown.map((item, i) =>
        item.kind === 'separator' ? (
          <div key={i} className="ctx-sep" role="separator" />
        ) : (
          <button
            key={i}
            data-action={item.id}
            role={item.kind === 'command' && item.checked !== undefined ? 'menuitemcheckbox' : undefined}
            aria-checked={item.kind === 'command' ? item.checked : undefined}
            className={item.kind === 'submenu' ? 'has-submenu' : undefined}
            disabled={item.kind === 'command' && item.disabled}
            onClick={() => {
              if (item.kind === 'submenu') return setShown(item.items);
              onClose();
              item.run();
            }}
          >
            {item.kind === 'command' && item.checked ? '✔ ' : ''}{item.label}
          </button>
        ),
      )}
    </div>
  );
}

/** The same lines in a tree's menu (`ContextMenu`, a list): the tree and the graphics area run the same commands (ADR 0176). */
export function MenuEntries({ items, onClose }: { items: MenuEntry[]; onClose: () => void }) {
  return (
    <>
      {items.map((item, i) =>
        item.kind === 'separator' ? (
          <li key={i} className="separator" />
        ) : item.kind === 'command' ? (
          <li
            key={i}
            data-action={item.id}
            role={item.checked !== undefined ? 'menuitemcheckbox' : undefined}
            aria-checked={item.checked}
            className={item.disabled ? 'disabled' : undefined}
            onClick={
              item.disabled
                ? undefined
                : () => {
                    onClose();
                    item.run();
                  }
            }
          >
            {item.checked ? '✔ ' : ''}{item.label}
          </li>
        ) : null,
      )}
    </>
  );
}
