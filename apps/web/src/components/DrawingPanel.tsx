import { t, type Locale } from '@3db/i18n';
import { BREAK_GAP, DIM_STYLE_DEFAULT, SHEET_SIZES, TITLE_FIELDS, TITLE_STYLE_DEFAULT, VIEW_CORNERS, VIEW_DISPLAYS, VIEW_NAMES, baseName, displayOf, isCorner, isDerived, isShaded, page, type DrawingView, type Scale, type SheetSize, type TitleField, type ViewCorner, type ViewDisplay, type ViewName, type ViewSide } from '@3db/model';
import { STANDARD_SCALES, arrangementBase, lineAcrossBox, scaleText, type ViewLines } from '@3db/drawing';
import { ACTIONS, openDrawingPart, shortcutOf } from '../actions';
import { DimStyleFields } from './DimStyleFields';
import { TitleStyleFields } from './TitleStyleFields';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { store, useStore } from '../state/store';
import { DrawingMenu, type DrawingMenuAt } from './DrawingViewMenu';
import { annotationLabel } from './AnnotationPanel';
import { PALETTE_DIRECTIONS, type DrawingPick, type DrawingTool } from '../state/drawing';
import { AnnotationPanel } from './AnnotationPanel';
import { DimensionPanel } from './DimensionPanel';
import { Icon, type IconName } from './Icon';

const SIDES: readonly ViewSide[] = ['right', 'left', 'up', 'down'];
const same = (a: Scale, b: Scale) => a[0] === b[0] && a[1] === b[1];
const parseScale = (s: string): Scale => {
  const [n, d] = s.split(':').map(Number);
  return [n!, d!];
};

/** A text box that commits on Enter or when it loses focus. */
function TextBox({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setText(value);
  }
  const commit = () => text !== value && onCommit(text);
  return (
    <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        }
        e.stopPropagation();
      }}
    />
  );
}

/** A view's lines drawn small, for a tile of the palette: the visible lines in a box that keeps their proportions. */
function Thumbnail({ lines }: { lines: ViewLines | null | undefined }) {
  if (!lines?.box) return <svg className="palette-thumb" viewBox="0 0 10 10" />;
  const { min, max } = lines.box;
  const w = Math.max(1e-6, max[0] - min[0]);
  const h = Math.max(1e-6, max[1] - min[1]);
  const pad = 0.08 * Math.max(w, h);
  return (
    <svg className="palette-thumb" viewBox={`${min[0] - pad} ${-max[1] - pad} ${w + 2 * pad} ${h + 2 * pad}`} preserveAspectRatio="xMidYMid meet">
      {lines.visible.map((l, k) => (
        <polyline key={k} points={Array.from({ length: l.length / 2 }, (_, j) => `${l[2 * j]},${-l[2 * j + 1]!}`).join(' ')} fill="none" stroke="currentColor" strokeWidth={Math.max(w, h) / 90} />
      ))}
    </svg>
  );
}

/**
 * The view palette (D-V, ADR 0131), as SolidWorks has it: the part the drawing shows, from each direction, drawn from its own lines. A view is pressed on and
 * dragged onto the sheet (or clicked, then the sheet clicked); once there, the projection tool offers the views projected from it.
 */
export function ViewPalette() {
  const drw = useStore((s) => s.drw)!;
  const d = store.drawingStore!;
  const pal = drw.palette;
  if (!pal) return <p className="muted">{t('drawingUi.paletteEmpty')}</p>;
  const armed = drw.tool?.kind === 'placeView' ? drw.tool.direction : null;
  return (
    <>
      <div className="view-palette" data-field="palette">
        {PALETTE_DIRECTIONS.map((direction) => (
          <button
            key={direction}
            type="button"
            className={`palette-tile${armed === direction ? ' active' : ''}`}
            data-palette={direction}
            title={t('drawingUi.paletteHint')}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.preventDefault();
              d.setTool({ kind: 'placeView', direction, source: pal.source, dragged: true });
              // let go anywhere but over the sheet (a click on the tile, or a drag given up): the view stays in hand, for a click on the sheet
              const release = () => {
                window.removeEventListener('pointerup', release);
                setTimeout(() => {
                  const tool = store.drawingStore?.getState().tool;
                  if (tool?.kind === 'placeView' && tool.dragged) d.setTool({ ...tool, dragged: false });
                }, 0);
              };
              window.addEventListener('pointerup', release);
            }}
          >
            <Thumbnail lines={pal.lines[direction]} />
            <span>{t(`drawing.view.${direction}`)}</span>
          </button>
        ))}
      </div>
      <p className="muted">{t('drawingUi.paletteHint')}</p>
    </>
  );
}

/** Whether the task pane was left closed (a convenience of this browser only). */
const PANE_KEY = '3db.drawing.taskPane';
const paneClosed = (): boolean => {
  try {
    return localStorage.getItem(PANE_KEY) === 'closed';
  } catch {
    return false;
  }
};

/**
 * The task pane on the right of a drawing, where SolidWorks keeps its view palette: open, it shows the palette; closed, a narrow strip with its tab, so the
 * sheet gets the room.
 */
export function DrawingTaskPane() {
  const [closed, setClosed] = useState(paneClosed);
  const set = (c: boolean) => {
    setClosed(c);
    try {
      localStorage.setItem(PANE_KEY, c ? 'closed' : 'open');
    } catch {
      // nothing kept: it opens again next time
    }
  };
  if (closed)
    return (
      <aside className="task-pane closed">
        <button type="button" className="task-pane-tab" title={t('drawingUi.taskPaneExpand')} data-action="openTaskPane" onClick={() => set(false)}>
          <Icon name="palette" />
          <span>{t('drawingUi.palette')}</span>
        </button>
      </aside>
    );
  return (
    <aside className="task-pane" data-group="palette">
      <div className="task-pane-head">
        <Icon name="palette" />
        <strong>{t('drawingUi.palette')}</strong>
        <button type="button" className="task-pane-close" title={t('drawingUi.taskPaneCollapse')} data-action="closeTaskPane" onClick={() => set(true)}>
          <Icon name="chevron" />
        </button>
      </div>
      <div className="task-pane-body">
        <ViewPalette />
        <StandardViews />
      </div>
    </aside>
  );
}

/** 「標準三視圖」 (SolidWorks's Standard 3 View): the front, top and right views at once, for who wants them all; the palette is for choosing them one by one. */
function StandardViews() {
  const drw = useStore((s) => s.drw)!;
  const d = store.drawingStore!;
  return (
    <div className="pm-row standard-views">
      <button type="button" className="pm-button" data-action="standardViews" disabled={!drw.palette} title={t('drawingUi.standardViewsTip')} onClick={() => d.addStandardViews()}>
        {t('drawingUi.standardViews')}
      </button>
    </div>
  );
}

/**
 * A group box of the PropertyManager, as SolidWorks draws them: a header with a chevron that opens and closes it, and its rows. A closed group keeps its rows
 * (only hidden), so that what they hold — the fields a script or a test reaches for — is always there.
 */
function PMGroup({ title, icon, open, onToggle, group, hidden, children }: { title: string; icon: IconName; open: boolean; onToggle: () => void; group?: string; hidden?: boolean; children: ReactNode }) {
  return (
    <section className={`sw-group${open ? ' open' : ''}`} data-group={group} hidden={hidden}>
      <button type="button" className="sw-group-head" onClick={onToggle} aria-expanded={open}>
        <Icon name="chevron" className="sw-chevron" />
        <Icon name={icon} className="sw-group-icon" />
        <span>{title}</span>
      </button>
      <div className="sw-group-body" hidden={!open}>
        {children}
      </div>
    </section>
  );
}

/** What the PropertyManager is about: what was chosen last, else the view chosen, else the sheet; `format` when the sheet format was chosen in the tree. */
type Context = 'sheet' | 'format' | 'view' | 'dimension' | 'annotation' | 'finish' | 'table';

const VIEW_ICON = (v: DrawingView): IconName => (v.kind === 'section' ? 'sectionView' : v.kind === 'detail' ? 'detailView' : v.kind === 'projected' ? 'projectedView' : 'view');

/**
 * The FeatureManager of a drawing (the 工程圖樹): the drawing, its sheet and the sheet format, and the views with the views derived from each under it, as
 * SolidWorks lists them. A row is chosen with a click (Ctrl adds to the choice); what is on a view is counted beside it.
 */
function DrawingTree({ onFormat, onPick }: { onFormat: () => void; onPick: () => void }) {
  const drw = useStore((s) => s.drw)!;
  const d = store.drawingStore!;
  const doc = drw.doc;
  const curPage = page(doc, drw.activePageIndex ?? 0);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<DrawingMenuAt | null>(null);
  /** The folders of dimensions and annotations under a view that are open (D-I1b): closed at first, as SolidWorks keeps its Annotations folder. */
  const [folders, setFolders] = useState<Set<string>>(new Set());
  const flip = (key: string) => setFolders((c) => (c.has(key) ? new Set([...c].filter((x) => x !== key)) : new Set([...c, key])));
  const picked = (kind: DrawingPick['kind'], id: string) => drw.selection.some((x) => x.kind === kind && x.id === id);
  /** A row of a dimension or an annotation: chosen by a click (Ctrl adds it), its menu by the right button. */
  const leafRow = (kind: 'dimension' | 'annotation', id: string, label: string, depth: number) => (
    <li key={`${kind}:${id}`}>
      <div
        className={`sw-tree-row${picked(kind, id) ? ' selected' : ''}`}
        style={{ paddingLeft: 8 + depth * 16 }}
        {...(kind === 'dimension' ? { 'data-tree-dim': id } : { 'data-tree-annotation': id })}
        onClick={(e) => {
          onPick();
          d.pick([{ kind, id }], e.ctrlKey || e.metaKey ? 'toggle' : 'replace');
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!picked(kind, id)) d.pick([{ kind, id }], 'replace');
          setMenu({ x: e.clientX, y: e.clientY, kind, id });
        }}
      >
        <span className="sw-twisty" />
        <Icon name={kind === 'dimension' ? 'dimension' : 'note'} />
        <span className="sw-tree-name">{label}</span>
      </div>
    </li>
  );
  /** A folder under a view: its dimensions, or its annotations. */
  const folder = (viewId: string, kind: 'dimension' | 'annotation', rows: { id: string; label: string }[], depth: number) => {
    if (rows.length === 0) return null;
    const key = `${viewId}:${kind}`;
    const open = folders.has(key);
    return (
      <li key={key}>
        <div className="sw-tree-row" style={{ paddingLeft: 8 + depth * 16 }} data-tree-folder={key} onClick={() => flip(key)}>
          <button type="button" className={`sw-twisty${open ? ' open' : ''}`} onClick={(e) => (e.stopPropagation(), flip(key))}>
            <Icon name="chevron" />
          </button>
          <Icon name={kind === 'dimension' ? 'dimension' : 'note'} />
          <span className="sw-tree-name">{t(kind === 'dimension' ? 'drawingUi.tree.dims' : 'drawingUi.tree.anns', { n: rows.length })}</span>
        </div>
        {open && <ul>{rows.map((r) => leafRow(kind, r.id, r.label, depth + 1))}</ul>}
      </li>
    );
  };
  const outcomes = d.scene().dimensions;
  const dimLabel = (id: string) => {
    const o = outcomes.get(id);
    const dim = curPage.dimensions.find((x) => x.id === id)!;
    const kind = t(`drawingUi.tree.dimKind.${dim.kind}` as 'drawingUi.tree.dimKind.linear');
    return o && !('error' in o) ? `${kind} ${o.text}` : kind;
  };
  const toggle = (id: string) => setClosed((c) => (c.has(id) ? new Set([...c].filter((x) => x !== id)) : new Set([...c, id])));
  const children = (id: string | null) => curPage.views.filter((v) => (id === null ? !isDerived(v) || !curPage.views.some((p) => p.id === v.parent) : isDerived(v) && v.parent === id));
  const chosen = (id: string) => drw.selection.some((x) => x.kind === 'view' && x.id === id) || (id === drw.selected && drw.selection.length === 0);
  const row = (v: DrawingView, depth: number): ReactNode => {
    const kids = children(v.id);
    const dims = curPage.dimensions.filter((x) => x.view === v.id).length;
    const anns = (curPage.annotations ?? []).filter((x) => x.view === v.id).length + curPage.surfaceFinishes.filter((x) => x.view === v.id).length;
    const annList = (curPage.annotations ?? []).filter((x) => x.view === v.id);
    return (
      <li key={v.id}>
        <div
          className={`sw-tree-row${chosen(v.id) ? ' selected' : ''}`}
          style={{ paddingLeft: 8 + depth * 16 }}
          data-view={v.id}
          onClick={(e) => {
            onPick();
            if (e.ctrlKey || e.metaKey) d.pick([{ kind: 'view', id: v.id }], 'toggle');
            else d.select(v.id);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            if (!chosen(v.id)) d.select(v.id);
            setMenu({ x: e.clientX, y: e.clientY, kind: 'view', view: v.id, leaf: null });
          }}
        >
          {kids.length > 0 || dims > 0 || annList.length > 0 ? (
            <button type="button" className={`sw-twisty${closed.has(v.id) ? '' : ' open'}`} onClick={(e) => (e.stopPropagation(), toggle(v.id))}>
              <Icon name="chevron" />
            </button>
          ) : (
            <span className="sw-twisty" />
          )}
          <Icon name={VIEW_ICON(v)} />
          <span className="sw-tree-name">{v.name}</span>
          {dims > 0 && <span className="sw-badge" title={t('drawingUi.tree.dimCount', { n: dims })}>{dims}</span>}
          {anns > 0 && <span className="sw-badge alt" title={t('drawingUi.tree.annCount', { n: anns })}>{anns}</span>}
          {drw.problems.get(v.id) && (
            <span className="sw-warn" title={drw.problems.get(v.id)}>
              <Icon name="warning" />
            </span>
          )}
          <button type="button" className="sw-row-action" title={t('drawingUi.delete')} onClick={(e) => (e.stopPropagation(), d.deleteViews([v.id]))}>
            <Icon name="cancel" />
          </button>
        </div>
        {!closed.has(v.id) && (kids.length > 0 || dims > 0 || annList.length > 0) && (
          <ul>
            {folder(v.id, 'dimension', curPage.dimensions.filter((x) => x.view === v.id).map((x) => ({ id: x.id, label: dimLabel(x.id) })), depth + 1)}
            {folder(v.id, 'annotation', annList.map((a) => ({ id: a.id, label: annotationLabel(a) })), depth + 1)}
            {kids.map((k) => row(k, depth + 1))}
          </ul>
        )}
      </li>
    );
  };
  const toOpen = d.partToOpen();
  return (
    <ul className="sw-tree" data-field="views">
      {/* the way to the part the drawing shows, always in sight (ADR 0146); Return to Drawing in the part comes back */}
      {toOpen && (
        <li>
          <button type="button" className="return-bar" data-action="openDrawingPart" title={t('drawingUi.openPartButtonTip', { name: baseName(toOpen) })} onClick={() => openDrawingPart()}>
            <Icon name="part" />
            <span>{t('drawingUi.openPartBar', { name: baseName(toOpen) })}</span>
          </button>
        </li>
      )}
      <li>
        <div className="sw-tree-row root">
          <span className="sw-twisty" />
          <Icon name="drawingDoc" />
          <span className="sw-tree-name">{d.name()}</span>
        </div>
      </li>
      <li>
        <div className={`sw-tree-row${!drw.selected && drw.selection.length === 0 ? ' selected' : ''}`} style={{ paddingLeft: 8 }} data-tree="sheet" onClick={() => (onPick(), d.clearSelection())}>
          <span className="sw-twisty" />
          <Icon name="sheet" />
          <span className="sw-tree-name">{curPage.name || t('drawingUi.tree.sheet', { size: curPage.sheet.size, scale: scaleText(curPage.sheet.scale) })}</span>
        </div>
        <ul>
          <li>
            <div className="sw-tree-row" style={{ paddingLeft: 24 }} data-tree="format" onClick={() => (d.clearSelection(), onFormat())}>
              <span className="sw-twisty" />
              <Icon name="titleBlock" />
              <span className="sw-tree-name">{t('drawingUi.tree.format')}</span>
            </div>
          </li>
          {children(null).map((v) => row(v, 1))}
        </ul>
      </li>
      {curPage.views.length === 0 && <li className="muted sw-tree-empty">{t('drawingUi.noViews')}</li>}
      {menu && <DrawingMenu at={menu} onClose={() => setMenu(null)} />}
    </ul>
  );
}


/**
 * The left panel of a drawing (B1.1, C16), laid out as SolidWorks lays it out: a tab for the drawing's tree (FeatureManager) and one for the properties of what
 * is chosen (PropertyManager), whose header says what it is and whose group boxes open for it; the commands at hand above them. Everything is a command on the
 * document, so each change is one undo step.
 */
export function DrawingPanel() {
  const drw = useStore((s) => s.drw)!;
  const d = store.drawingStore!;
  const doc = drw.doc;
  const [tab, setTab] = useState<'tree' | 'props' | 'tools'>('props');
  const [format, setFormat] = useState(false);
  const [direction, setDirection] = useState<ViewName>('isometric');
  const [side, setSide] = useState<ViewSide>('right');
  const [vertical, setVertical] = useState(true);
  const [at, setAt] = useState('');
  /** The angle of a cut made by numbers (B2.6): 0 is the vertical or horizontal line the select asks for, anything else turns it about the same point. */
  const [sectionAngle, setSectionAngle] = useState('');
  const [centre, setCentre] = useState<[string, string]>(['', '']);
  const [radius, setRadius] = useState('');
  const [localDepth, setLocalDepth] = useState('5');
  /** The band left out of the selected view (B2.7): the fields, which start empty so that the view's own break (if any) shows as the placeholders, the way the cut above does. */
  const [breakAxis, setBreakAxis] = useState<'x' | 'y'>('x');
  const [breakFrom, setBreakFrom] = useState('');
  const [breakTo, setBreakTo] = useState('');
  const [breakGap, setBreakGap] = useState('');
  const curPage = page(doc, drw.activePageIndex ?? 0);
  const scale = scaleText(curPage.sheet.scale);
  const standard = STANDARD_SCALES.some((s) => same(s, curPage.sheet.scale));
  const view = curPage.views.find((x) => x.id === drw.selected);
  const tail = drw.selection[drw.selection.length - 1];
  const context: Context = tail ? (tail.kind === 'view' ? 'view' : tail.kind) : view ? 'view' : format ? 'format' : 'sheet';
  // what is chosen on the sheet brings the properties forward, as clicking something in the graphics area of SolidWorks does; a click in the tree stays in the tree
  const fromTree = useRef(false);
  const selectionKey = drw.selection.map((x) => `${x.kind}:${x.id}`).join(',');
  useEffect(() => {
    if (fromTree.current) fromTree.current = false;
    else if (drw.selection.length > 0) setTab('props');
    if (drw.selection.length > 0) setFormat(false);
  }, [selectionKey]);
  // the groups open for what the panel is about; one opened or closed by hand stays so until the panel is about something else
  const [manual, setManual] = useState<Record<string, boolean>>({});
  useEffect(() => setManual({}), [context]);
  const opens: Record<Context, string[]> = {
    sheet: ['sheet', 'dimStyle', 'export'],
    format: ['format'],
    view: ['view', 'derived'],
    dimension: ['dimensions'],
    annotation: ['annotations'],
    finish: ['annotations'],
    table: ['annotations'],
  };
  const isOpen = (g: string) => manual[g] ?? opens[context].includes(g);
  const toggle = (g: string) => setManual((m) => ({ ...m, [g]: !isOpen(g) }));
  const onSheetGroups = context === 'sheet' || context === 'format';
  const header: { icon: IconName; title: string; sub: string } =
    context === 'view' && view
      ? { icon: VIEW_ICON(view), title: t('drawingUi.pm.view'), sub: view.name }
      : context === 'dimension'
        ? { icon: 'dimension', title: t('drawingUi.pm.dimension'), sub: drw.selection.filter((x) => x.kind === 'dimension').length > 1 ? t('drawingUi.selCount', { n: drw.selection.filter((x) => x.kind === 'dimension').length }) : (view?.name ?? '') }
        : context === 'annotation'
          ? { icon: 'note', title: t('drawingUi.pm.annotation'), sub: view?.name ?? '' }
          : context === 'finish'
            ? { icon: 'surfaceFinish', title: t('drawingUi.pm.finish'), sub: view?.name ?? '' }
            : context === 'table'
              ? { icon: 'table', title: t('drawingUi.pm.table'), sub: view?.name ?? '' }
              : context === 'format'
                ? { icon: 'titleBlock', title: t('drawingUi.tree.format'), sub: d.name() }
                : { icon: 'sheet', title: t('drawingUi.pm.sheet'), sub: `${curPage.sheet.size} · ${scale}` };
  const hint = drw.selection.length > 1 ? t('drawingUi.selHint') : null;
  const parent = view;
  const box: { min: [number, number]; max: [number, number] } | null | undefined = parent ? (parent.kind === 'detail' ? { min: [parent.centre[0] - parent.radius, parent.centre[1] - parent.radius], max: [parent.centre[0] + parent.radius, parent.centre[1] + parent.radius] } : drw.lines.get(parent.id)?.box) : null;
  const num = (s: string, fallback: number) => (s.trim() !== '' && Number.isFinite(Number(s)) ? Number(s) : fallback);
  const mid: [number, number] = box ? [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2] : [0, 0];
  const span = box ? Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1]) : 20;
  /** The break's fields (B2.7): the axis it is set on, and — when the view has none yet — the band's ends a third and two thirds across it. */
  const breakK = (view?.break?.axis ?? breakAxis) === 'y' ? 1 : 0;
  const breakDefault: [number, number] = box ? [box.min[breakK] + (box.max[breakK] - box.min[breakK]) / 3, box.min[breakK] + ((box.max[breakK] - box.min[breakK]) * 2) / 3] : [0, 0];
  return (
    <div className="drawing-panel sw-panel" data-drawing-panel>
      <div className="sw-tabs" role="tablist">
        <button type="button" role="tab" className={tab === 'tree' ? 'active' : ''} aria-selected={tab === 'tree'} data-tab="tree" title={t('drawingUi.tabTree')} onClick={() => setTab('tree')}>
          <Icon name="tree" />
          <span>{t('drawingUi.tabTree')}</span>
        </button>
        <button type="button" role="tab" className={tab === 'props' ? 'active' : ''} aria-selected={tab === 'props'} data-tab="props" title={t('drawingUi.tabProps')} onClick={() => setTab('props')}>
          <Icon name="properties" />
          <span>{t('drawingUi.tabProps')}</span>
        </button>
        <button type="button" role="tab" className={tab === 'tools' ? 'active' : ''} aria-selected={tab === 'tools'} data-tab="tools" title={t('drawingUi.tabTools')} onClick={() => setTab('tools')}>
          <Icon name="palette" />
          <span>{t('drawingUi.tabTools')}</span>
        </button>
      </div>
      {/* Tools (B2.6): the options and the shortcuts of a drawing, and the keys the drawing's own commands answer to — the same registry the shortcuts dialog edits, so what is listed is what is in force */}
      <div className="sw-pane" hidden={tab !== 'tools'}>
        <div className="pm-row wrap">
          <button className="pm-button" data-action="openOptions" onClick={() => store.openDialog('options')}>
            {t('action.options')}
          </button>
          <button className="pm-button" data-action="openShortcuts" onClick={() => store.openDialog('shortcuts')}>
            {t('action.shortcuts')}
          </button>
        </div>
        <ul className="sw-keys" data-group="drawing-shortcuts">
          {ACTIONS.filter((a) => a.group === 'drawing').map((a) => (
            <li key={a.id} data-shortcut={a.id}>
              <span className="sw-keys-name">{a.label}</span>
              <span className="sw-keys-key">{shortcutOf(a) ?? ''}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="sw-pane" hidden={tab !== 'tree'}>
        <DrawingTree
          onPick={() => {
            fromTree.current = true;
          }}
          onFormat={() => {
            setFormat(true);
            setTab('props');
          }}
        />
        {[...drw.problems.values()].map((p, i) => (
          <p key={i} className="error-text sw-problem" data-field="problem">
            {p}
          </p>
        ))}
      </div>
      <div className="sw-pane" hidden={tab !== 'props'}>
        <div className="sw-pm-header">
          <Icon name={header.icon} className="sw-pm-icon" />
          <div className="sw-pm-title">
            <strong>{header.title}</strong>
            <span>{header.sub}</span>
          </div>
          <button type="button" className="sw-ok" title={t('drawingUi.pm.close')} disabled={drw.selection.length === 0 && !format} onClick={() => (d.clearSelection(), setFormat(false))}>
            <Icon name="ok" />
          </button>
        </div>
        <div className="sw-selbar" data-group="selection" hidden={drw.selection.length < 2}>
          <span data-field="selCount">{t('drawingUi.selCount', { n: drw.selection.length })}</span>
          <button className="pm-button" data-action="deleteSelection" disabled={drw.selection.length === 0} onClick={() => d.deleteSelection()}>
            {t('drawingUi.selDelete')}
          </button>
          <button className="pm-button" data-action="clearSelection" disabled={drw.selection.length === 0} onClick={() => d.clearSelection()}>
            {t('drawingUi.selClear')}
          </button>
        </div>
        {hint && <div className="sw-message">{hint}</div>}
        {curPage.views.length === 0 && (
          <div className="sw-message" data-field="mainViewHint">
            {t('drawingUi.mainViewFirst')}
          </div>
        )}
        {drw.computing && <div className="sw-message busy">{t('drawingUi.computing')}</div>}

        <PMGroup title={t('drawingUi.sheet')} icon="sheet" open={isOpen('sheet')} onToggle={() => toggle('sheet')} hidden={!onSheetGroups}>
          <label className="pm-row">
            <span>{t('drawingUi.size')}</span>
            <select data-field="size" value={curPage.sheet.size} onChange={(e) => d.setSheet({ size: e.target.value as SheetSize })}>
              {SHEET_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="pm-row">
            <span>{t('drawingUi.orientation')}</span>
            <select data-field="orientation" value={curPage.sheet.orientation} onChange={(e) => d.setSheet({ orientation: e.target.value as 'landscape' | 'portrait' })}>
              <option value="landscape">{t('drawingUi.landscape')}</option>
              <option value="portrait">{t('drawingUi.portrait')}</option>
            </select>
          </label>
          <label className="pm-row">
            <span>{t('drawing.title.projection')}</span>
            <select data-field="projection" value={curPage.sheet.projection} onChange={(e) => d.setSheet({ projection: e.target.value as 'first' | 'third' })}>
              <option value="first">{t('drawing.projection.first')}</option>
              <option value="third">{t('drawing.projection.third')}</option>
            </select>
          </label>
          <label className="pm-row">
            <span>{t('drawing.title.scale')}</span>
            <select data-field="scale" value={scale} onChange={(e) => d.setSheet({ scale: parseScale(e.target.value) })}>
              {!standard && <option value={scale}>{scale}</option>}
              {STANDARD_SCALES.map((s) => (
                <option key={scaleText(s)} value={scaleText(s)}>
                  {scaleText(s)}
                </option>
              ))}
            </select>
          </label>
          <label className="pm-row">
            <span>{t('drawingUi.unit')}</span>
            <select data-field="unit" value={curPage.sheet.unit ?? 'mm'} onChange={(e) => d.setSheet({ unit: e.target.value === 'in' ? 'in' : 'mm' })}>
              <option value="mm">{t('drawingUi.unit.mm')}</option>
              <option value="in">{t('drawingUi.unit.in')}</option>
            </select>
          </label>
          <label className="pm-row">
            <span>{t('drawingUi.language')}</span>
            <select data-field="language" value={curPage.sheet.language ?? ''} onChange={(e) => d.setSheet({ language: e.target.value === '' ? null : (e.target.value as Locale) })}>
              <option value="">{t('drawingUi.language.auto')}</option>
              <option value="zh-TW">{t('options.languageZh')}</option>
              <option value="en">{t('options.languageEn')}</option>
            </select>
          </label>
          <div className="pm-row end">
            <button className="pm-button" data-action="autoScale" onClick={() => d.autoScale()}>
              {t('drawingUi.autoScale')}
            </button>
          </div>
        </PMGroup>

        <PMGroup title={t('drawingUi.dimStyle')} icon="dimension" group="dimStyle" open={isOpen('dimStyle')} onToggle={() => toggle('dimStyle')} hidden={!onSheetGroups}>
          <div className="sw-message">{t('drawingUi.dimStyleSheetTip')}</div>
          <DimStyleFields scope="sheet" value={curPage.sheet.dimStyle ?? {}} base={DIM_STYLE_DEFAULT} onChange={(s) => d.setSheet({ dimStyle: s })} />
        </PMGroup>

        <PMGroup title={t('drawingUi.tree.format')} icon="titleBlock" open={isOpen('format')} onToggle={() => toggle('format')} hidden={!onSheetGroups}>
          {TITLE_FIELDS.map((field: TitleField) => (
            <label key={field} className="pm-row">
              <span>{t(`drawing.title.${field}`)}</span>
              <TextBox value={curPage.title[field] ?? ''} onCommit={(v) => d.setTitle(field, v)} />
            </label>
          ))}
          <TitleStyleFields value={curPage.sheet.titleStyle ?? {}} base={TITLE_STYLE_DEFAULT} onChange={(s) => d.setSheet({ titleStyle: s })} />
        </PMGroup>

        <PMGroup title={t('drawingUi.group.viewProps')} icon={view ? VIEW_ICON(view) : 'view'} open={isOpen('view')} onToggle={() => toggle('view')} hidden={!view}>
          {view && (
            <>
              {!isDerived(view) && (
                <label className="pm-row">
                  <span>{t('drawingUi.direction')}</span>
                  <select data-field="viewDirection" value={view.direction} onChange={(e) => d.setView(view.id, { direction: e.target.value as ViewName, name: t(`drawing.view.${e.target.value as ViewName}`) })}>
                    {VIEW_NAMES.map((n) => (
                      <option key={n} value={n}>
                        {t(`drawing.view.${n}`)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {view.kind === 'projected' && (
                <label className="pm-row">
                  <span>{t('drawingUi.side')}</span>
                  <select data-field="viewSide" value={view.side} onChange={(e) => d.setView(view.id, { side: e.target.value as ViewSide | ViewCorner })}>
                    {/* a view off a corner turns to another corner; one on a side, to another side */}
                    {(isCorner(view.side) ? VIEW_CORNERS : SIDES).map((s) => (
                      <option key={s} value={s}>
                        {t(`drawing.side.${s}`)}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="pm-row">
                <span>{t('drawingUi.viewScale')}</span>
                <select data-field="viewScale" value={view.scale ? scaleText(view.scale) : ''} onChange={(e) => d.setView(view.id, { scale: e.target.value ? parseScale(e.target.value) : null })}>
                  <option value="">{t('drawingUi.inheritScale')}</option>
                  {view.scale && !STANDARD_SCALES.some((s) => same(s, view.scale!)) && <option value={scaleText(view.scale)}>{scaleText(view.scale)}</option>}
                  {STANDARD_SCALES.map((s) => (
                    <option key={scaleText(s)} value={scaleText(s)}>
                      {scaleText(s)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="pm-row checkbox">
                <input type="checkbox" data-field="viewLock" checked={!!view.locked} title={t('drawingUi.viewLockTip')} onChange={(e) => (e.target.checked ? d.lockView(view.id) : d.unlockView(view.id))} />
                <span>{t('drawingUi.viewLock')}</span>
              </label>
              <label className="pm-row checkbox">
                <input type="checkbox" data-field="viewShowTangentEdges" checked={view.showTangentEdges !== false} title={t('drawingUi.showTangentEdgesTip')} onChange={(e) => d.setView(view.id, { showTangentEdges: e.target.checked ? null : false })} />
                <span>{t('drawingUi.showTangentEdges')}</span>
              </label>
              <div className="pm-row">
                <button
                  type="button"
                  className={`pm-button${drw.tool?.kind === 'hideEdge' ? ' active' : ''}`}
                  data-action="toolHideEdge"
                  title={t('drawingUi.hint.hideEdge')}
                  onClick={() => d.setTool(drw.tool?.kind === 'hideEdge' ? null : { kind: 'hideEdge' })}
                >
                  {t('drawingUi.toolHideEdge')}
                </button>
              </div>
              {view.hiddenEdges && view.hiddenEdges.length > 0 && (
                <div data-group="hiddenEdges">
                  <div className="pm-row">
                    <span style={{ fontWeight: 600 }}>{t('drawingUi.hiddenEdges')} ({view.hiddenEdges.length})</span>
                  </div>
                  {view.hiddenEdges.map((e, idx) => (
                    <div key={`${e.name}_${e.in ?? ''}_${idx}`} className="pm-row between">
                      <span className="truncate" title={e.name + (e.in ? ` (${e.in})` : '')}>
                        {e.name}{e.in ? ` (${e.in})` : ''}
                      </span>
                      <button
                        type="button"
                        className="pm-button"
                        data-action="unhideEdge"
                        title={t('drawingUi.unhideEdge')}
                        onClick={() => d.unhideEdge(view.id, e.name, e.in)}
                      >
                        {t('drawingUi.unhideEdge')}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {/* A break (B2.7): the band left out of the view, so that a long part is drawn shorter; what lies beyond it comes nearer by the band less the gap. */}
              <div className="pm-row">
                <span>{t('drawingUi.breakAxis')}</span>
                <select data-field="breakAxis" value={view.break?.axis ?? breakAxis} onChange={(e) => { const ax = e.target.value as 'x' | 'y'; setBreakAxis(ax); if (view.break) d.setView(view.id, { break: { ...view.break, axis: ax } }); }}>
                  <option value="x">{t('drawingUi.breakAxisX')}</option>
                  <option value="y">{t('drawingUi.breakAxisY')}</option>
                </select>
                <input data-field="breakFrom" inputMode="decimal" placeholder={String(+(view.break?.from ?? breakDefault[0]).toFixed(2))} value={breakFrom} onChange={(e) => setBreakFrom(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
                <input data-field="breakTo" inputMode="decimal" placeholder={String(+(view.break?.to ?? breakDefault[1]).toFixed(2))} value={breakTo} onChange={(e) => setBreakTo(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
                <input data-field="breakGap" inputMode="decimal" title={t('drawingUi.breakGap')} placeholder={String(view.break?.gap ?? BREAK_GAP)} value={breakGap} onChange={(e) => setBreakGap(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
              </div>
              <div className="pm-row end">
                <button
                  className="pm-button"
                  data-action="setBreak"
                  disabled={!box}
                  onClick={() => {
                    if (!box) return;
                    d.setView(view.id, { break: { axis: view.break?.axis ?? breakAxis, from: num(breakFrom, view.break?.from ?? breakDefault[0]), to: num(breakTo, view.break?.to ?? breakDefault[1]), gap: num(breakGap, view.break?.gap ?? BREAK_GAP) } });
                  }}
                >
                  {t('drawingUi.breakView')}
                </button>
                <button className="pm-button danger" data-action="clearBreak" disabled={!view.break} onClick={() => d.setView(view.id, { break: null })}>
                  {t('drawingUi.breakClear')}
                </button>
              </div>
              <label className="pm-row">
                <span>{t('drawingUi.display')}</span>
                <select data-field="display" value={displayOf(view)} onChange={(e) => d.setView(view.id, { display: e.target.value as ViewDisplay })}>
                  {VIEW_DISPLAYS.map((s) => (
                    // a flat pattern has no faces to shade
                    <option key={s} value={s} disabled={isShaded(s) && 'direction' in view && view.direction === 'flat'}>
                      {t(`drawingUi.display.${s}`)}
                    </option>
                  ))}
                </select>
              </label>
              {(view.kind === 'section' || view.kind === 'detail') && (
                <label className="pm-row">
                  <span>{t('drawingUi.label')}</span>
                  <TextBox value={view.label} onCommit={(x) => x.trim() && d.setView(view.id, { label: x.trim() })} />
                </label>
              )}
              {view.kind === 'section' && (
                <label className="pm-row checkbox">
                  <input type="checkbox" data-field="flip" checked={!!view.flip} onChange={(e) => d.setView(view.id, { flip: e.target.checked })} />
                  <span>{t('drawingUi.sectionFlip')}</span>
                </label>
              )}
              <div className="pm-row end">
                <button
                  className="pm-button"
                  data-action="resetPosition"
                  disabled={view.locked || (arrangementBase(doc)?.id === view.id ? d.arrangementCentred() : !(view.at || view.slide))}
                  title={view.locked ? t('drawingUi.viewLockTip') : t('drawingUi.autoLayoutTip')}
                  onClick={() => (arrangementBase(doc)?.id === view.id ? d.centreArrangement() : d.setView(view.id, { at: null, slide: null }))}
                >
                  {t('drawingUi.autoLayout')}
                </button>
                <button className="pm-button danger" data-action="deleteView" onClick={() => d.deleteViews([view.id])}>
                  {t('drawingUi.delete')}
                </button>
              </div>
            </>
          )}
        </PMGroup>

        <PMGroup title={t('drawingUi.dimensions')} icon="dimension" group="dimensions" open={isOpen('dimensions')} onToggle={() => toggle('dimensions')} hidden={onSheetGroups && !view}>
          <DimensionPanel />
        </PMGroup>

        <PMGroup title={t('drawingUi.annotations')} icon="note" group="annotations" open={isOpen('annotations')} onToggle={() => toggle('annotations')} hidden={!view}>
          <AnnotationPanel />
        </PMGroup>

        <PMGroup title={t('drawingUi.group.derived')} icon="projectedView" group="derived" open={isOpen('derived')} onToggle={() => toggle('derived')} hidden={!view}>
          <div className="pm-row wrap">
            <button className={`pm-button${drw.tool?.kind === 'project' ? ' active' : ''}`} data-action="toolProjected" title={t('drawingUi.hint.project')} disabled={!parent && drw.tool?.kind !== 'project'} onClick={() => d.setTool(drw.tool?.kind === 'project' ? null : parent ? { kind: 'project', parent: parent.id } : null)}>
              {t('drawingUi.toolProjected')}
            </button>
            <button className={`pm-button${drw.tool?.kind === 'section' ? ' active' : ''}`} data-action="toolSection" title={t('drawingUi.hint.section')} onClick={() => d.setTool(drw.tool?.kind === 'section' ? null : { kind: 'section', vertical })}>
              {t('drawingUi.toolSection')}
            </button>
            <button className={`pm-button${drw.tool?.kind === 'detail' ? ' active' : ''}`} data-action="toolDetail" title={t('drawingUi.hint.detail')} onClick={() => d.setTool(drw.tool?.kind === 'detail' ? null : { kind: 'detail' })}>
              {t('drawingUi.toolDetail')}
            </button>
            <button className={`pm-button${drw.tool?.kind === 'sectionLocal' ? ' active' : ''}`} data-action="toolLocalSection" title={t('drawingUi.hint.localSection')} onClick={() => d.setTool(drw.tool?.kind === 'sectionLocal' ? null : { kind: 'sectionLocal', outlineKind: 'rectangle', depth: Number(localDepth) || 5 })}>{t('drawingUi.toolLocalSection')}</button>
            <button className={`pm-button${drw.tool?.kind === 'crop' ? ' active' : ''}`} data-action="toolCrop" title={t('drawingUi.hint.crop')} onClick={() => d.setTool(drw.tool?.kind === 'crop' ? null : { kind: 'crop', outlineKind: 'rectangle' })}>{t('drawingUi.toolCrop')}</button>
            <button className={`pm-button${drw.tool?.kind === 'auxiliary' ? ' active' : ''}`} data-action="toolAuxiliary" title={t('drawingUi.hint.auxiliary')} onClick={() => d.setTool(drw.tool?.kind === 'auxiliary' ? null : { kind: 'auxiliary' })}>{t('drawingUi.toolAuxiliary')}</button>
            <input data-field="localSectionDepth" inputMode="decimal" placeholder={t('drawingUi.localSectionDepth')} value={localDepth} onChange={(e) => { setLocalDepth(e.target.value); if (drw.tool?.kind === 'sectionLocal') d.setTool({ ...drw.tool, depth: Number(e.target.value) || 5 }); }} onKeyDown={(e) => e.stopPropagation()} />
          </div>
          <details className="pm-details" data-group="derivedNumbers">
            <summary>{t('drawingUi.byNumbers')}</summary>
            <div className="pm-row">
              <select data-field="newDirection" value={direction} onChange={(e) => setDirection(e.target.value as ViewName)}>
                {VIEW_NAMES.map((n) => (
                  <option key={n} value={n}>
                    {t(`drawing.view.${n}`)}
                  </option>
                ))}
              </select>
              <button className="pm-button" data-action="addView" onClick={() => d.addViews([direction])}>
                {t('drawingUi.addView')}
              </button>
            </div>
            <div className="pm-row">
              <select data-field="newSide" value={side} onChange={(e) => setSide(e.target.value as ViewSide)}>
                {SIDES.map((s) => (
                  <option key={s} value={s}>
                    {t(`drawing.side.${s}`)}
                  </option>
                ))}
              </select>
              <button className="pm-button" data-action="addProjected" disabled={!parent} onClick={() => parent && d.addProjected(parent.id, side)}>
                {t('drawingUi.projected')}
              </button>
            </div>
            <div className="pm-row">
              <select
                data-field="sectionAxis"
                value={vertical ? 'v' : 'h'}
                onChange={(e) => {
                  const next = e.target.value === 'v';
                  setVertical(next);
                  // choosing vertical or horizontal here leaves the slanted line of the viewport's choices (D-I5)
                  if (drw.tool?.kind === 'section') d.setTool({ kind: 'section', vertical: next });
                }}
              >
                <option value="v">{t('drawingUi.sectionVertical')}</option>
                <option value="h">{t('drawingUi.sectionHorizontal')}</option>
              </select>
              <input data-field="sectionAt" inputMode="decimal" placeholder={String(+mid[vertical ? 0 : 1].toFixed(2))} value={at} onChange={(e) => setAt(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
              <input data-field="sectionAngle" inputMode="decimal" title={t('drawingUi.sectionAngle')} value={sectionAngle} onChange={(e) => setSectionAngle(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
              <span className="suffix">°</span>
              <button
                className="pm-button"
                data-action="addSection"
                disabled={!parent || !box}
                onClick={() => {
                  if (!box) return;
                  const p = num(at, mid[vertical ? 0 : 1]);
                  const deg = num(sectionAngle, 0);
                  if (deg === 0) {
                    const pad = 5;
                    parent && d.addSection(parent.id, vertical ? [[p, box.min[1] - pad], [p, box.max[1] + pad]] : [[box.min[0] - pad, p], [box.max[0] + pad, p]]);
                    return;
                  }
                  // a cut by numbers at an angle (B2.6): through the same point, turned from the vertical or the horizontal the select asks for, across the whole view — the line the slanted tool draws (D-I5)
                  const pt: [number, number] = vertical ? [p, mid[1]] : [mid[0], p];
                  const rad = ((vertical ? 90 : 0) + deg) * (Math.PI / 180);
                  const across = lineAcrossBox(pt, [pt[0] + Math.cos(rad), pt[1] + Math.sin(rad)], box, 5);
                  if (!across) return d.notifyInfo(t('drawingUi.hint.sectionSlant'));
                  parent && d.addSection(parent.id, across);
                }}
              >
                {t('drawingUi.section')}
              </button>
            </div>
            <div className="pm-row">
              <span>{t('drawingUi.detailCentre')}</span>
              <input data-field="detailX" inputMode="decimal" placeholder={String(+mid[0].toFixed(2))} value={centre[0]} onChange={(e) => setCentre([e.target.value, centre[1]])} onKeyDown={(e) => e.stopPropagation()} />
              <input data-field="detailY" inputMode="decimal" placeholder={String(+mid[1].toFixed(2))} value={centre[1]} onChange={(e) => setCentre([centre[0], e.target.value])} onKeyDown={(e) => e.stopPropagation()} />
            </div>
            <div className="pm-row">
              <span>{t('drawingUi.detailRadius')}</span>
              <input data-field="detailRadius" inputMode="decimal" placeholder={String(+(span / 5).toFixed(2))} value={radius} onChange={(e) => setRadius(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
              <button className="pm-button" data-action="addDetail" disabled={!parent || !box} onClick={() => parent && d.addDetail(parent.id, [num(centre[0], mid[0]), num(centre[1], mid[1])], num(radius, span / 5))}>
                {t('drawingUi.detail')}
              </button>
            </div>
          </details>
        </PMGroup>

        <PMGroup title={t('drawingUi.group.export')} icon="exportFile" open={isOpen('export')} onToggle={() => toggle('export')} hidden={!onSheetGroups}>
          <div className="pm-row wrap">
            <button className="pm-button" data-action="exportSvg" onClick={() => d.exportSvg()}>
              {t('drawingUi.exportSvg')}
            </button>
            <button className="pm-button" data-action="exportDxf" onClick={() => d.exportDxf()}>
              {t('drawingUi.exportDxf')}
            </button>
            <button className="pm-button" data-action="exportPdf" onClick={() => d.exportPdf()}>
              {t('drawingUi.exportPdf')}
            </button>
          </div>
          <div className="pm-row">
            <select
              className="pm-select"
              data-field="pdfFontSelect"
              value={drw.pdfFont && ['sans', 'kai', 'serif', 'fangsong'].includes(drw.pdfFont) ? drw.pdfFont : (drw.pdfFont ? 'custom' : 'sans')}
              onChange={(e) => {
                const val = e.target.value;
                if (val === 'custom') void d.chooseFont();
                else void d.selectPdfFont(val);
              }}
              style={{ flex: 1, minWidth: 0 }}
            >
              <option value="sans">{t('drawingUi.fontPreset.sans')}</option>
              <option value="kai">{t('drawingUi.fontPreset.kai')}</option>
              <option value="serif">{t('drawingUi.fontPreset.serif')}</option>
              <option value="fangsong">{t('drawingUi.fontPreset.fangsong')}</option>
              <option value="custom">{t('drawingUi.fontPreset.custom')}</option>
            </select>
            <button className="pm-button" data-action="chooseFont" title={t('drawingUi.chooseCustomFont')} onClick={() => void d.chooseFont()}>
              {t('drawingUi.pdfFont')}
            </button>
            {drw.pdfFont && (
              <button title={t('drawingUi.pdfFontClear')} data-action="clearFont" onClick={() => d.clearFont()}>
                ✕
              </button>
            )}
          </div>
          <div className="pm-row">
            <span className="muted" data-field="pdfFont" style={{ fontSize: '0.85em', wordBreak: 'break-all' }}>
              {drw.pdfFont
                ? drw.pdfFont === 'sans'
                  ? t('drawingUi.fontPreset.sans')
                  : drw.pdfFont === 'kai'
                    ? t('drawingUi.fontPreset.kai')
                    : drw.pdfFont === 'serif'
                      ? t('drawingUi.fontPreset.serif')
                      : drw.pdfFont === 'fangsong'
                        ? t('drawingUi.fontPreset.fangsong')
                        : drw.pdfFont
                : t('drawingUi.pdfFontNone')}
            </span>
          </div>
        </PMGroup>
      </div>
    </div>
  );
}
