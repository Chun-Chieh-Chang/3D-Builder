import { useEffect, useState } from 'react';
import type { MenuEntry } from '../contextMenus';

/**
 * The right-click menu of the graphics area of the part, the sketch and the assembly (D5.5, D5.6, ADR 0176): its lines are `MenuEntry`s (contextMenus.ts),
 * a submenu opens its lines in the menu's place. Closes on any press elsewhere or Esc. `what` says what it was opened on (`data-graphics-menu`).
 */
export function GraphicsMenu({ x, y, items, what, onClose }: { x: number; y: number; items: MenuEntry[]; what: string; onClose: () => void }) {
  const [shown, setShown] = useState(items);
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
    <div className="ctx-menu" data-graphics-menu={what} style={{ left: x, top: y }} onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      {shown.map((item, i) =>
        item.kind === 'separator' ? (
          <div key={i} className="ctx-sep" role="separator" />
        ) : (
          <button
            key={i}
            data-action={item.id}
            className={item.kind === 'submenu' ? 'has-submenu' : undefined}
            disabled={item.kind === 'command' && item.disabled}
            onClick={() => {
              if (item.kind === 'submenu') return setShown(item.items);
              onClose();
              item.run();
            }}
          >
            {item.label}
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
            {item.label}
          </li>
        ) : null,
      )}
    </>
  );
}
