import { useEffect } from 'react';
import { t } from '@3db/i18n';
import { baseName, type Id } from '@3db/model';
import { store } from '../state/store';
import { ContextMenu } from './ContextMenu';

/** Where a view's right-click menu is, and what it is about: the view, and the part of an assembly under the pointer when there is one. */
export interface ViewMenuAt {
  x: number;
  y: number;
  view: Id;
  /** The leaf id of the part of an assembly under the pointer (a picked element's `in`). */
  leaf: string | null;
}

/**
 * The right-click menu of a view (D-I7(a), ADR 0140), as SolidWorks's: 「開啟零件」 opens the part (or assembly) the view shows; on a view of an assembly, over
 * one of its parts, that part too. The menu closes on any press elsewhere or Esc.
 */
export function DrawingViewMenu({ at, onClose }: { at: ViewMenuAt; onClose: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', onClose);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', onClose);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);
  const d = store.drawingStore;
  if (!d) return null;
  const source = d.viewSourcePath(at.view);
  const leaf = at.leaf ? d.leafPath(at.view, at.leaf) : null;
  const act = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const assembly = !!source && /\.3dba$/i.test(source);
  return (
    <ContextMenu x={at.x} y={at.y} data-view-menu={at.view} onContextMenu={(e: React.MouseEvent) => e.preventDefault()}>
      {leaf && (
        <li data-action="openLeafPart" onClick={act(() => store.openPartOfDrawing(leaf))}>
          {t('drawingUi.menu.openLeaf', { name: baseName(leaf) })}
        </li>
      )}
      {source && (
        <li data-action="openViewPart" onClick={act(() => store.openPartOfDrawing(source))}>
          {t(assembly ? 'drawingUi.menu.openAssembly' : 'drawingUi.menu.openPart', { name: baseName(source) })}
        </li>
      )}
      {!source && <li className="disabled">{t('drawingUi.menu.noSource')}</li>}
    </ContextMenu>
  );
}
