import { useEffect, useState } from 'react';
import { t } from '@3db/i18n';
import { VIEW_DISPLAYS, baseName, displayOf, isCorner, isShaded, page, type Id } from '@3db/model';
import { arrangementBase, fitAllowed, toleranceForChoice, type ToleranceChoice } from '@3db/drawing';
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
  | { kind: 'table'; id: Id }
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
  /** which of the menu's submenus is open, if any (B2.4) */
  const [openSub, setOpenSub] = useState<string | null>(null);
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
  /**
   * A submenu (B2.4): its items are opened inside the menu itself rather than hung off its side, because the menu scrolls (`overflow-y: auto`), so a fly-out
   * would be clipped at the edge of the sheet.
   */
  const sub = (action: string, label: string, children: React.ReactNode) => (
    <li
      key={action}
      data-action={action}
      className={`has-submenu${openSub === action ? ' open' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        setOpenSub(openSub === action ? null : action);
      }}
    >
      <span>{label}</span>
      <span className="submenu-arrow">▸</span>
      {openSub === action && <ul className="submenu">{children}</ul>}
    </li>
  );
  let items: React.ReactNode[] = [];
  if (at.kind === 'view') {
    const view = page(doc).views.find((v) => v.id === at.view);
    if (!view) return null;
    const source = d.viewSourcePath(at.view);
    const leaf = at.leaf ? d.leafPath(at.view, at.leaf) : null;
    const assembly = !!source && /\.3dba$/i.test(source);
    const base = arrangementBase(doc)?.id === view.id;
    const corner = view.kind === 'projected' && isCorner(view.side);
    const aligns = (view.kind === 'projected' || view.kind === 'section') && !corner;
    items = [
      ...(leaf ? [item('openLeafPart', t('drawingUi.menu.openLeaf', { name: baseName(leaf) }), () => store.openPartOfDrawing(leaf))] : []),
      source ? item('openViewPart', t(assembly ? 'drawingUi.menu.openAssembly' : 'drawingUi.menu.openPart', { name: baseName(source) }), () => store.openPartOfDrawing(source)) : item('noSource', t('drawingUi.menu.noSource'), () => {}, true),
      sep('s1'),
      item('menuProjected', t('drawingUi.toolProjected'), () => d.setTool({ kind: 'project', parent: view.id }), 'direction' in view && view.direction === 'flat'),
      // in line with its parent, a projected or section view can be let go of it and put back (SolidWorks's 「解除對齊」 / 「預設對齊」, ADR 0146); one off a corner is in line with nothing
      ...(aligns
        ? [view.at ? item('menuDefaultAlignment', t('drawingUi.menu.defaultAlignment'), () => d.setView(view.id, { at: null, slide: null })) : item('menuBreakAlignment', t('drawingUi.menu.breakAlignment'), () => d.breakAlignment(view.id))]
        : []),
      item('menuAutoLayout', t('drawingUi.autoLayout'), () => (base ? d.centreArrangement() : d.setView(view.id, { at: null, slide: null })), corner || (base ? d.arrangementCentred() : !(view.at || view.slide))),
      sep('sDisplay'),
      // the display style (ADR 0146), as SolidWorks's 顯示樣式; a flat pattern has no faces to shade
      ...VIEW_DISPLAYS.map((s) => item(`menuDisplay-${s}`, `${displayOf(view) === s ? '✓ ' : ''}${t(`drawingUi.display.${s}`)}`, () => d.setView(view.id, { display: s }), isShaded(s) && 'direction' in view && view.direction === 'flat')),
      item('menuArrange', t('drawingUi.arrange'), () => arrange(page(doc).dimensions.filter((x) => x.view === view.id).map((x) => x.id)), !page(doc).dimensions.some((x) => x.view === view.id)),
      sep('s2'),
      item('menuDelete', t('drawingUi.menu.delete'), () => d.deleteSelection()),
    ];
  } else if (at.kind === 'dimension') {
    const ids = d.chosen('dimension');
    const dims = page(doc).dimensions.filter((x) => ids.includes(x.id));
    const allReference = dims.length > 0 && dims.every((x) => !!x.reference);
    const slid = dims.some((x) => 'slide' in x && !!x.slide);
    // the tolerance of the chosen dimensions (B2.4): what the menu puts on all of them at once, as the panel does
    const withTol = (choice: ToleranceChoice) => dims.length > 0 && dims.every((x) => (x.tolerance?.type ?? 'none') === choice);
    const setTol = (choice: ToleranceChoice) => () => d.setDimensionsEach(ids, (x) => ({ tolerance: toleranceForChoice(choice, x.kind) }));
    items = [
      item('menuReference', `${allReference ? '✓ ' : ''}${t('drawingUi.dimReference')}`, () => d.setDimensions(ids, { reference: !allReference })),
      item('menuCentreText', t('drawingUi.menu.centreText'), () => d.setDimensions(ids, { slide: null }), !slid),
      item('menuArrange', t('drawingUi.arrange'), () => arrange(ids)),
      item('menuAlignCollinear', t('drawingUi.alignCollinear'), () => d.alignCollinear(ids), ids.length < 2),
      sep('s1'),
      // the tolerance, as a submenu (B2.4): the same five the properties panel offers, and no new file format — a shortcut for what is already written there
      sub('menuTolerance', `${t('drawingUi.dimTolerance')}${dims.some((x) => x.tolerance) ? ' ✓' : ''}`, [
        item('menuTolNone', `${withTol('none') ? '✓ ' : ''}${t('drawingUi.dimTolNone')}`, setTol('none')),
        item('menuTolBilateral', `${withTol('bilateral') ? '✓ ' : ''}${t('drawingUi.dimTolBilateral')}`, setTol('bilateral')),
        item('menuTolMax', `${withTol('max') ? '✓ ' : ''}${t('drawingUi.dimTolMax')}`, setTol('max')),
        item('menuTolMin', `${withTol('min') ? '✓ ' : ''}${t('drawingUi.dimTolMin')}`, setTol('min')),
        // a fit is a size's: the model refuses it on an angle and on an ordinate, so the choice is left out for them
        item('menuTolFit', `${withTol('fit') ? '✓ ' : ''}${t('drawingUi.dimTolFit')}`, setTol('fit'), !fitAllowed(dims.map((x) => x.kind))),
      ]),
      sep('s2'),
      item('menuDelete', t('drawingUi.menu.delete'), () => d.deleteSelection()),
    ];
  } else if (at.kind === 'annotation') {
    const a = (page(doc).annotations ?? []).find((x) => x.id === at.id);
    if (!a) return null;
    items = [
      ...('attach' in a && a.attach ? [item('menuDetach', t('drawingUi.detach'), () => d.setAnnotation(a.id, { attach: null }))] : []),
      item('menuDelete', t('drawingUi.menu.delete'), () => d.deleteSelection()),
    ];
  } else if (at.kind === 'finish') {
    items = [item('menuDelete', t('drawingUi.menu.delete'), () => d.deleteSelection())];
  } else if (at.kind === 'table') {
    // a table's own menu (B2.6): the parts list asks for its balloons too, the hole table only for where it sits — the same commands the panel offers
    const table = page(doc).tables.find((x) => x.id === at.id);
    if (!table) return null;
    const bom = table.kind === 'bom';
    items = [
      item('menuTableHome', t(bom ? 'drawingUi.bomAutoPosition' : 'drawingUi.tableAutoPosition'), () => d.setTable(table.id, { at: null }), !table.at),
      ...(bom
        ? [
            item('menuBalloons', `${table.balloons ? '✓ ' : ''}${t('drawingUi.balloons')}`, () => d.setTable(table.id, { balloons: !table.balloons })),
            item('menuBalloonsAuto', t('drawingUi.balloonsAuto'), () => d.setTable(table.id, { balloonAt: null }), !table.balloonAt),
          ]
        : []),
      sep('s1'),
      item('menuDelete', t('drawingUi.menu.delete'), () => d.deleteSelection()),
    ];
  } else {
    const views = page(doc).views.length > 0;
    items = [
      item('menuStandard', t('drawingUi.standardViews'), () => d.addStandardViews(), !d.sourceForViews()),
      item('menuAutoScale', t('drawingUi.autoScale'), () => d.autoScale(), !views),
      item('menuArrange', t('drawingUi.arrange'), () => arrange(page(doc).dimensions.map((x) => x.id)), page(doc).dimensions.length === 0),
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
