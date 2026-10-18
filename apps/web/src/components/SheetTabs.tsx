import { useState, useRef, useEffect } from 'react';
import { t } from '@3db/i18n';
import { store, useStore } from '../state/store';
import { ContextMenu } from './ContextMenu';

interface SheetMenuState {
  x: number;
  y: number;
  pageIndex: number;
}

export function SheetTabs() {
  const drw = useStore((s) => s.drw);
  const d = store.drawingStore;
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [menu, setMenu] = useState<SheetMenuState | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingIndex !== null && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingIndex]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', key);
    };
  }, [menu]);

  if (!drw || !d) return null;

  const pages = drw.doc.pages;
  const activeIndex = drw.activePageIndex ?? 0;

  const startRename = (index: number) => {
    const currentName = pages[index]?.name || t('drawingUi.sheetTabs.sheetDefault', { n: index + 1 });
    setEditingName(currentName);
    setEditingIndex(index);
    setMenu(null);
  };

  const commitRename = (index: number) => {
    const trimmed = editingName.trim();
    if (trimmed && trimmed !== pages[index]?.name) {
      d.renamePage(index, trimmed);
    }
    setEditingIndex(null);
  };

  const cancelRename = () => {
    setEditingIndex(null);
  };

  return (
    <nav className="drawing-sheet-tabs" data-sheet-tabs aria-label={t('drawingUi.sheetTabs.sheet')}>
      {pages.map((p, i) => {
        const isActive = i === activeIndex;
        const displayName = p.name || t('drawingUi.sheetTabs.sheetDefault', { n: i + 1 });
        const isEditing = editingIndex === i;

        return (
          <div
            key={p.id || `page-${i}`}
            className={`drawing-sheet-tab${isActive ? ' active' : ''}${dragOverIndex === i ? ' drag-over' : ''}`}
            data-sheet-tab-index={i}
            data-active={isActive ? 'true' : undefined}
            onClick={() => !isEditing && d.setActivePage(i)}
            onDoubleClick={(e) => {
              e.stopPropagation();
              startRename(i);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setMenu({ x: e.clientX, y: e.clientY, pageIndex: i });
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOverIndex(i);
            }}
            onDragLeave={() => setDragOverIndex(null)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOverIndex(null);
              const viewId = e.dataTransfer.getData('application/3db-view-id');
              if (viewId) {
                d.moveViewToPage(viewId, i);
              }
            }}
          >
            {isEditing ? (
              <input
                ref={inputRef}
                type="text"
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onBlur={() => commitRename(i)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    commitRename(i);
                  } else if (e.key === 'Escape') {
                    cancelRename();
                  }
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="drawing-sheet-tab-title">{displayName}</span>
            )}
          </div>
        );
      })}

      <button
        type="button"
        className="drawing-sheet-tab-add"
        data-action="addSheet"
        title={t('drawingUi.sheetTabs.add')}
        aria-label={t('drawingUi.sheetTabs.add')}
        onClick={() => d.addPage()}
      >
        +
      </button>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} data-sheet-context-menu>
          <li
            data-action="renameSheet"
            onClick={() => {
              startRename(menu.pageIndex);
            }}
          >
            {t('drawingUi.sheetTabs.rename')}
          </li>
          <li
            data-action="deleteSheet"
            className={pages.length <= 1 ? 'disabled' : undefined}
            onClick={() => {
              if (pages.length > 1) {
                d.deletePage(menu.pageIndex);
                setMenu(null);
              }
            }}
          >
            {t('drawingUi.sheetTabs.delete')}
          </li>
          <li className="separator" />
          <li
            data-action="sheetProperties"
            onClick={() => {
              d.setActivePage(menu.pageIndex);
              d.select(null);
              setMenu(null);
            }}
          >
            {t('drawingUi.sheetTabs.properties')}
          </li>
        </ContextMenu>
      )}
    </nav>
  );
}
