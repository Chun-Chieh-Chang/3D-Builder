import { useEffect } from 'react';
import { t } from '@3db/i18n';
import { baseName, type Id } from '@3db/model';
import { arrangementBase, showsHidden } from '@3db/drawing';
import { store } from '../state/store';
import { ContextMenu } from './ContextMenu';

/**
 * What a right-click menu of the drawing is about (D-I1b): a view (and the part of an assembly under the pointer, when there is one), a dimension, an annotation,
 * a surface finish, or the empty sheet.
 */
export type DrawingMenuAt = { x: number; y: number } & (
  | { kind: 'view'; view: Id; leaf: string | null }
  | { kind: 'dimension'; id: Id }
  | { kind: 'annotation'; id: Id }
  | { kind: 'finish'; id: Id }
  | { kind: 'sheet' }
);
/** A view's menu, as the tree opens it (the kind given). */
export type ViewMenuAt = { x: number; y: number; view: Id; leaf: string | null };

/**
 * The right-click menu of the drawing (D-I7(a), D-I1b; ADR 0140, 0141), as SolidWorks's: what it offers is what can be done to the thing under the pointer. The
 * thing is chosen first (or, when it is already among those chosen, the choice is kept, and the menu's commands work on all of them). Closes on any press
 * elsewhere or Esc.
 */
export function DrawingMenu({ at, onClose }: { at: DrawingMenuAt; onClose: () => void }) {
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
  const doc = d.getState().doc;
  const act = (fn: () => void) => () => {
    onClose();
    fn();
  };
  const item = (action: string, label: string, run: () => void, disabled = false) => (
    <li key={action} data-action={action} className={disabled ? 'disabled' : undefined} onClick={disabled ? undefined : act(run)}>
      {label}
    </li>
  );
  const sep = (k: string) => <li key={k} className="separator" />;
  let items: React.ReactNode[] = [];
  if (at.kind === 'view') {
    const view = doc.views.find((v) => v.id === at.view);
    if (!view) return null;
    const source = d.viewSourcePath(at.view);
    const leaf = at.leaf ? d.leafPath(at.view, at.leaf) : null;
    const assembly = !!source && /\.3dba$/i.test(source);
    const base = arrangementBase(doc)?.id === view.id;
    items = [
      ...(leaf ? [item('openLeafPart', t('drawingUi.menu.openLeaf', { name: baseName(leaf) }), () => store.openPartOfDrawing(leaf))] : []),
      source ? item('openViewPart', t(assembly ? 'drawingUi.menu.openAssembly' : 'drawingUi.menu.openPart', { name: baseName(source) }), () => store.openPartOfDrawing(source)) : item('noSource', t('drawingUi.menu.noSource'), () => {}, true),
      sep('s1'),
      item('menuProjected', t('drawingUi.toolProjected'), () => d.setTool({ kind: 'project', parent: view.id }), 'direction' in view && view.direction === 'flat'),
      item('menuHidden', `${showsHidden(view) ? '✓ ' : ''}${t('drawingUi.hiddenLines')}`, () => d.setView(view.id, { hidden: !showsHidden(view) })),
      item('menuAutoLayout', t('drawingUi.autoLayout'), () => (base ? d.centreArrangement() : d.setView(view.id, { at: null, slide: null })), base ? d.arrangementCentred() : !(view.at || view.slide)),
      item('menuArrange', t('drawingUi.arrange'), () => arrange(doc.dimensions.filter((x) => x.view === view.id).map((x) => x.id)), !doc.dimensions.some((x) => x.view === view.id)),
      sep('s2'),
      item('menuDelete', t('drawingUi.menu.delete'), () => d.deleteSelection()),
    ];
  } else if (at.kind === 'dimension') {
    const ids = d.chosen('dimension');
    const dims = doc.dimensions.filter((x) => ids.includes(x.id));
    const allReference = dims.length > 0 && dims.every((x) => !!x.reference);
    const slid = dims.some((x) => 'slide' in x && !!x.slide);
    items = [
      item('menuReference', `${allReference ? '✓ ' : ''}${t('drawingUi.dimReference')}`, () => d.setDimensions(ids, { reference: !allReference })),
      item('menuCentreText', t('drawingUi.menu.centreText'), () => d.setDimensions(ids, { slide: null }), !slid),
      item('menuArrange', t('drawingUi.arrange'), () => arrange(ids)),
      item('menuAlignCollinear', t('drawingUi.alignCollinear'), () => d.alignCollinear(ids), ids.length < 2),
      sep('s1'),
      item('menuDelete', t('drawingUi.menu.delete'), () => d.deleteSelection()),
    ];
  } else if (at.kind === 'annotation') {
    const a = (doc.annotations ?? []).find((x) => x.id === at.id);
    if (!a) return null;
    items = [
      ...('attach' in a && a.attach ? [item('menuDetach', t('drawingUi.detach'), () => d.setAnnotation(a.id, { attach: null }))] : []),
      item('menuDelete', t('drawingUi.menu.delete'), () => d.deleteSelection()),
    ];
  } else if (at.kind === 'finish') {
    items = [item('menuDelete', t('drawingUi.menu.delete'), () => d.deleteSelection())];
  } else {
    const views = doc.views.length > 0;
    items = [
      item('menuStandard', t('drawingUi.standardViews'), () => d.addStandardViews(), !d.sourceForViews()),
      item('menuAutoScale', t('drawingUi.autoScale'), () => d.autoScale(), !views),
      item('menuArrange', t('drawingUi.arrange'), () => arrange(doc.dimensions.map((x) => x.id)), doc.dimensions.length === 0),
      sep('s1'),
      item('menuPdf', t('drawingUi.exportPdf'), () => d.exportPdf(), !views),
    ];
  }
  function arrange(ids: Id[]) {
    const n = d!.arrangeDimensions(ids);
    d!.notifyInfo(n > 0 ? t('drawingUi.arranged', { n }) : t('drawingUi.arrangedNothing'));
  }
  return (
    <ContextMenu x={at.x} y={at.y} data-drawing-menu={at.kind} {...(at.kind === 'view' ? { 'data-view-menu': at.view } : {})} onContextMenu={(e: React.MouseEvent) => e.preventDefault()}>
      {items}
    </ContextMenu>
  );
}

/** A view's menu (the tree's): the drawing's menu about that view. */
export function DrawingViewMenu({ at, onClose }: { at: ViewMenuAt; onClose: () => void }) {
  return <DrawingMenu at={{ ...at, kind: 'view' }} onClose={onClose} />;
}
