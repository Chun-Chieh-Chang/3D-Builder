import { useEffect, useState } from 'react';
import { t } from '@3db/i18n';
import { VIEW_DISPLAYS, baseName, displayOf, isCorner, isShaded, page, type Id } from '@3db/model';
import { DIMENSION_MODES, arrangementBase, dimensionModesFor, fitAllowed, pickKind, toleranceForChoice, type DimensionMode, type Pickable, type ToleranceChoice } from '@3db/drawing';
import { ACTIONS, DIMENSION_ACTION, startDimension } from '../actions';
import { store } from '../state/store';
import { ContextMenu } from './ContextMenu';

/**
 * What a right-click menu of the drawing is about (D-I1b): a view (and the part of an assembly under the pointer, when there is one), a dimension, an annotation,
 * a surface finish, or the empty sheet.
 */
export type DrawingMenuAt = { x: number; y: number } & (
  /** `element`: the edge, vertex, circle or arc of the view under the pointer, when there is one (ADR 0177): the dimensions that start from it are offered first */
  | { kind: 'view'; view: Id; leaf: string | null; element?: Pickable | null }
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
  const curPage = page(doc, d.getState().activePageIndex ?? 0);
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
  /**
   * A command of the CommandManager (ADR 0177): its name and whether it can be done now are the registry's, and so is what it does unless `run` says otherwise —
   * the menu and the 註記 tab are one set of commands, not two.
   */
  const command = (id: string, run?: () => void) => {
    const a = ACTIONS.find((x) => x.id === id);
    if (!a) return null;
    return item(`cmd-${id}`, a.label, run ?? (() => a.run()), !a.enabled(store.getState()));
  };
  /** A dimension of this kind, its tool started (from `element` when one is given: the next click places it, or picks the second element). */
  const dimension = (mode: DimensionMode, element?: { view: Id; feature: Pickable }) => command(DIMENSION_ACTION[mode], () => startDimension(mode, element ? [element] : []));
  /** The kinds of dimension and the annotation tools, as submenus: what the 註記 tab has. */
  const annotating = () => [
    sub('menuDimensions', t('drawingUi.menu.dimensions'), [...DIMENSION_MODES.map((m) => dimension(m)), command('drw-ordinate'), command('drw-arrange')]),
    sub('menuAnnotations', t('drawingUi.menu.annotations'), ['drw-note', 'drw-datum', 'drw-fcf', 'drw-centre-mark', 'drw-centre-line', 'drw-surface', 'drw-hole-table', 'drw-bom'].map((id) => command(id))),
  ];
  // a tool that is on: the first thing the menu offers is to end it, as SolidWorks's 「選擇」
  const tool = d.getState().tool;
  const ending = tool ? [item('menuEndTool', t('drawingUi.menu.endTool'), () => d.setTool(null)), sep('sTool')] : [];
  let items: React.ReactNode[] = [];
  if (at.kind === 'view') {
    const view = curPage.views.find((v) => v.id === at.view);
    if (!view) return null;
    const source = d.viewSourcePath(at.view);
    const leaf = at.leaf ? d.leafPath(at.view, at.leaf) : null;
    const assembly = !!source && /\.3dba$/i.test(source);
    const base = arrangementBase(doc)?.id === view.id;
    const corner = view.kind === 'projected' && isCorner(view.side);
    const aligns = (view.kind === 'projected' || view.kind === 'section') && !corner;
    // the element under the pointer (ADR 0177): the dimensions that start from it, the one it makes alone first; a circle's centre mark too
    const element = at.element ? { view: view.id, feature: at.element } : null;
    const kind = element ? pickKind(element.feature) : null;
    const onElement = element
      ? [
          ...dimensionModesFor(element.feature).map((m) => dimension(m, element)),
          ...(kind === 'circle' || kind === 'arc' ? [command('drw-centre-mark')] : []),
          sep('sElement'),
        ]
      : [];
    items = [
      ...ending,
      ...onElement,
      ...(leaf ? [item('openLeafPart', t('drawingUi.menu.openLeaf', { name: baseName(leaf) }), () => store.openPartOfDrawing(leaf))] : []),
      source ? item('openViewPart', t(assembly ? 'drawingUi.menu.openAssembly' : 'drawingUi.menu.openPart', { name: baseName(source) }), () => store.openPartOfDrawing(source)) : item('noSource', t('drawingUi.menu.noSource'), () => {}, true),
      sep('s1'),
      item('menuProjected', t('drawingUi.toolProjected'), () => d.setTool({ kind: 'project', parent: view.id }), 'direction' in view && view.direction === 'flat'),
      // a section and a detail of this view: the 視圖配置 tab's tools, with the view chosen as their parent
      command('drw-section', () => d.setTool({ kind: 'section', vertical: true })),
      command('drw-detail', () => d.setTool({ kind: 'detail' })),
      item('menuHideEdge', t('drawingUi.toolHideEdge'), () => d.setTool({ kind: 'hideEdge' })),
      sep('sAnnotate'),
      ...annotating(),
      // in line with its parent, a projected or section view can be let go of it and put back (SolidWorks's 「解除對齊」 / 「預設對齊」, ADR 0146); one off a corner is in line with nothing
      ...(aligns
        ? [view.at ? item('menuDefaultAlignment', t('drawingUi.menu.defaultAlignment'), () => d.setView(view.id, { at: null, slide: null })) : item('menuBreakAlignment', t('drawingUi.menu.breakAlignment'), () => d.breakAlignment(view.id))]
        : []),
      item('menuAutoLayout', t('drawingUi.autoLayout'), () => (base ? d.centreArrangement() : d.setView(view.id, { at: null, slide: null })), corner || (base ? d.arrangementCentred() : !(view.at || view.slide))),
      ...(doc.pages.length > 1
        ? [
            sub(
              'menuMoveToSheet',
              t('drawingUi.moveToSheet'),
              doc.pages.map((p, idx) =>
                item(
                  `menuMoveToSheet-${idx}`,
                  p.name || t('drawingUi.sheetTabs.sheetDefault', { n: idx + 1 }),
                  () => d.moveViewToPage(at.view, idx),
                  idx === (d.getState().activePageIndex ?? 0),
                ),
              ),
            ),
          ]
        : []),
      sep('sDisplay'),
      // the display style (ADR 0146), as SolidWorks's 顯示樣式; a flat pattern has no faces to shade
      ...VIEW_DISPLAYS.map((s) => item(`menuDisplay-${s}`, `${displayOf(view) === s ? '✓ ' : ''}${t(`drawingUi.display.${s}`)}`, () => d.setView(view.id, { display: s }), isShaded(s) && 'direction' in view && view.direction === 'flat')),
      item('menuArrange', t('drawingUi.arrange'), () => arrange(curPage.dimensions.filter((x) => x.view === view.id).map((x) => x.id)), !curPage.dimensions.some((x) => x.view === view.id)),
      sep('s2'),
      item('menuProperties', t('drawingUi.menu.properties'), () => showProperties(view.id)),
      item('menuDelete', t('drawingUi.menu.delete'), () => d.deleteSelection()),
    ];
  } else if (at.kind === 'dimension') {
    const ids = d.chosen('dimension');
    const dims = curPage.dimensions.filter((x) => ids.includes(x.id));
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
    const a = (curPage.annotations ?? []).find((x) => x.id === at.id);
    if (!a) return null;
    items = [
      ...('attach' in a && a.attach ? [item('menuDetach', t('drawingUi.detach'), () => d.setAnnotation(a.id, { attach: null }))] : []),
      item('menuDelete', t('drawingUi.menu.delete'), () => d.deleteSelection()),
    ];
  } else if (at.kind === 'finish') {
    items = [item('menuDelete', t('drawingUi.menu.delete'), () => d.deleteSelection())];
  } else if (at.kind === 'table') {
    // a table's own menu (B2.6): the parts list asks for its balloons too, the hole table only for where it sits — the same commands the panel offers
    const table = curPage.tables.find((x) => x.id === at.id);
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
    const views = curPage.views.length > 0;
    items = [
      ...ending,
      item('menuStandard', t('drawingUi.standardViews'), () => d.addStandardViews(), !d.sourceForViews()),
      item('menuAutoScale', t('drawingUi.autoScale'), () => d.autoScale(), !views),
      item('menuArrange', t('drawingUi.arrange'), () => arrange(curPage.dimensions.map((x) => x.id)), curPage.dimensions.length === 0),
      sep('sAnnotate'),
      ...annotating(),
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

/** 「屬性」 of a view (ADR 0177): the view alone chosen, which is what the panel shows the properties of, and the panel brought to where they are. */
function showProperties(view: Id): void {
  store.drawingStore?.select(view);
  requestAnimationFrame(() => document.querySelector('[data-drawing-panel] .sw-pm-header')?.scrollIntoView({ block: 'start' }));
}

/** A view's menu (the tree's): the drawing's menu about that view. */
export function DrawingViewMenu({ at, onClose }: { at: ViewMenuAt; onClose: () => void }) {
  return <DrawingMenu at={{ ...at, kind: 'view' }} onClose={onClose} />;
}
