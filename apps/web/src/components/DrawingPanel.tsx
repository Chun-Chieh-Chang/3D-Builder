import { t, type Locale } from '@3db/i18n';
import { SHEET_SIZES, TITLE_FIELDS, VIEW_NAMES, isDerived, type DrawingView, type Scale, type SheetSize, type TitleField, type ViewName, type ViewSide } from '@3db/model';
import { STANDARD_SCALES, arrangementBase, scaleText, showsHidden, type ViewLines } from '@3db/drawing';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { store, useStore } from '../state/store';
import { PALETTE_DIRECTIONS, type DrawingTool } from '../state/drawing';
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
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setClosed((c) => (c.has(id) ? new Set([...c].filter((x) => x !== id)) : new Set([...c, id])));
  const children = (id: string | null) => doc.views.filter((v) => (id === null ? !isDerived(v) || !doc.views.some((p) => p.id === v.parent) : isDerived(v) && v.parent === id));
  const chosen = (id: string) => drw.selection.some((x) => x.kind === 'view' && x.id === id) || (id === drw.selected && drw.selection.length === 0);
  const row = (v: DrawingView, depth: number): ReactNode => {
    const kids = children(v.id);
    const dims = doc.dimensions.filter((x) => x.view === v.id).length;
    const anns = (doc.annotations ?? []).filter((x) => x.view === v.id).length + doc.surfaceFinishes.filter((x) => x.view === v.id).length;
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
        >
          {kids.length > 0 ? (
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
        {kids.length > 0 && !closed.has(v.id) && <ul>{kids.map((k) => row(k, depth + 1))}</ul>}
      </li>
    );
  };
  return (
    <ul className="sw-tree" data-field="views">
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
          <span className="sw-tree-name">{t('drawingUi.tree.sheet', { size: doc.sheet.size, scale: scaleText(doc.sheet.scale) })}</span>
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
      {doc.views.length === 0 && <li className="muted sw-tree-empty">{t('drawingUi.noViews')}</li>}
    </ul>
  );
}

/** The commands of a drawing always at hand, as the CommandManager of SolidWorks has them: the tools that make views and annotations. */
function CommandStrip() {
  const drw = useStore((s) => s.drw)!;
  const d = store.drawingStore!;
  const tool = drw.tool;
  const view = drw.doc.views.find((v) => v.id === drw.selected);
  const commands: { id: string; icon: IconName; label: string; active: boolean; disabled?: boolean; run: () => void }[] = [
    { id: 'projected', icon: 'projectedView', label: t('drawingUi.toolProjected'), active: tool?.kind === 'project', disabled: !view && tool?.kind !== 'project', run: () => d.setTool(tool?.kind === 'project' ? null : view ? { kind: 'project', parent: view.id } : null) },
    { id: 'section', icon: 'sectionView', label: t('drawingUi.toolSection'), active: tool?.kind === 'section', run: () => d.setTool(tool?.kind === 'section' ? null : { kind: 'section', vertical: true }) },
    { id: 'detail', icon: 'detailView', label: t('drawingUi.toolDetail'), active: tool?.kind === 'detail', run: () => d.setTool(tool?.kind === 'detail' ? null : { kind: 'detail' }) },
    { id: 'dimension', icon: 'dimension', label: t('drawingUi.toolDimension'), active: tool?.kind === 'dimension', run: () => d.setTool(tool?.kind === 'dimension' ? null : { kind: 'dimension', picks: [] }) },
    ...(['note', 'datum', 'fcf', 'centreMark', 'centreLine'] as const).map((what) => ({
      id: what,
      icon: ({ note: 'note', datum: 'datum', fcf: 'gdt', centreMark: 'centreMark', centreLine: 'refAxis' } as const)[what],
      label: t(({ note: 'drawingUi.toolNote', datum: 'drawingUi.toolDatum', fcf: 'drawingUi.toolFcf', centreMark: 'drawingUi.toolCentreMark', centreLine: 'drawingUi.toolCentreLine' } as const)[what]),
      active: tool?.kind === 'annotate' && tool.what === what,
      run: () => d.setTool(tool?.kind === 'annotate' && tool.what === what ? null : ({ kind: 'annotate', what } as DrawingTool)),
    })),
    { id: 'surface', icon: 'surfaceFinish', label: t('drawingUi.addSurfaceFinish'), active: tool?.kind === 'surface', run: () => d.setTool(tool?.kind === 'surface' ? null : { kind: 'surface' }) },
  ];
  return (
    <div className="sw-commands" role="toolbar">
      {commands.map((c) => (
        <button key={c.id} type="button" className={`sw-command${c.active ? ' active' : ''}`} data-command={c.id} title={c.label} disabled={c.disabled} onClick={c.run}>
          <Icon name={c.icon} />
          <span>{t(`drawingUi.cmd.${c.id}` as 'drawingUi.cmd.note')}</span>
        </button>
      ))}
    </div>
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
  const [tab, setTab] = useState<'tree' | 'props'>('props');
  const [format, setFormat] = useState(false);
  const [direction, setDirection] = useState<ViewName>('isometric');
  const [side, setSide] = useState<ViewSide>('right');
  const [vertical, setVertical] = useState(true);
  const [at, setAt] = useState('');
  const [centre, setCentre] = useState<[string, string]>(['', '']);
  const [radius, setRadius] = useState('');
  const scale = scaleText(doc.sheet.scale);
  const standard = STANDARD_SCALES.some((s) => same(s, doc.sheet.scale));
  const view = doc.views.find((x) => x.id === drw.selected);
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
    sheet: ['sheet', 'export'],
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
                : { icon: 'sheet', title: t('drawingUi.pm.sheet'), sub: `${doc.sheet.size} · ${scale}` };
  const hint = drw.selection.length > 1 ? t('drawingUi.selHint') : null;
  const parent = view;
  const box: { min: [number, number]; max: [number, number] } | null | undefined = parent ? (parent.kind === 'detail' ? { min: [parent.centre[0] - parent.radius, parent.centre[1] - parent.radius], max: [parent.centre[0] + parent.radius, parent.centre[1] + parent.radius] } : drw.lines.get(parent.id)?.box) : null;
  const num = (s: string, fallback: number) => (s.trim() !== '' && Number.isFinite(Number(s)) ? Number(s) : fallback);
  const mid: [number, number] = box ? [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2] : [0, 0];
  const span = box ? Math.max(box.max[0] - box.min[0], box.max[1] - box.min[1]) : 20;
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
      </div>
      <CommandStrip />
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
        {doc.views.length === 0 && (
          <div className="sw-message" data-field="mainViewHint">
            {t('drawingUi.mainViewFirst')}
          </div>
        )}
        {drw.computing && <div className="sw-message busy">{t('drawingUi.computing')}</div>}

        <PMGroup title={t('drawingUi.sheet')} icon="sheet" open={isOpen('sheet')} onToggle={() => toggle('sheet')} hidden={!onSheetGroups}>
          <label className="pm-row">
            <span>{t('drawingUi.size')}</span>
            <select data-field="size" value={doc.sheet.size} onChange={(e) => d.setSheet({ size: e.target.value as SheetSize })}>
              {SHEET_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="pm-row">
            <span>{t('drawingUi.orientation')}</span>
            <select data-field="orientation" value={doc.sheet.orientation} onChange={(e) => d.setSheet({ orientation: e.target.value as 'landscape' | 'portrait' })}>
              <option value="landscape">{t('drawingUi.landscape')}</option>
              <option value="portrait">{t('drawingUi.portrait')}</option>
            </select>
          </label>
          <label className="pm-row">
            <span>{t('drawing.title.projection')}</span>
            <select data-field="projection" value={doc.sheet.projection} onChange={(e) => d.setSheet({ projection: e.target.value as 'first' | 'third' })}>
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
            <select data-field="unit" value={doc.sheet.unit ?? 'mm'} onChange={(e) => d.setSheet({ unit: e.target.value === 'in' ? 'in' : 'mm' })}>
              <option value="mm">{t('drawingUi.unit.mm')}</option>
              <option value="in">{t('drawingUi.unit.in')}</option>
            </select>
          </label>
          <label className="pm-row">
            <span>{t('drawingUi.language')}</span>
            <select data-field="language" value={doc.sheet.language ?? ''} onChange={(e) => d.setSheet({ language: e.target.value === '' ? null : (e.target.value as Locale) })}>
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

        <PMGroup title={t('drawingUi.tree.format')} icon="titleBlock" open={isOpen('format')} onToggle={() => toggle('format')} hidden={!onSheetGroups}>
          {TITLE_FIELDS.map((field: TitleField) => (
            <label key={field} className="pm-row">
              <span>{t(`drawing.title.${field}`)}</span>
              <TextBox value={doc.title[field] ?? ''} onCommit={(v) => d.setTitle(field, v)} />
            </label>
          ))}
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
                  <select data-field="viewSide" value={view.side} onChange={(e) => d.setView(view.id, { side: e.target.value as ViewSide })}>
                    {SIDES.map((s) => (
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
                <input type="checkbox" data-field="hidden" checked={showsHidden(view)} onChange={(e) => d.setView(view.id, { hidden: e.target.checked ? true : false })} />
                <span>{t('drawingUi.hiddenLines')}</span>
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
                  disabled={arrangementBase(doc)?.id === view.id ? d.arrangementCentred() : !(view.at || view.slide)}
                  title={t('drawingUi.autoLayoutTip')}
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
                  if (drw.tool?.kind === 'section') d.setTool({ ...drw.tool, vertical: next });
                }}
              >
                <option value="v">{t('drawingUi.sectionVertical')}</option>
                <option value="h">{t('drawingUi.sectionHorizontal')}</option>
              </select>
              <input data-field="sectionAt" inputMode="decimal" placeholder={String(+mid[vertical ? 0 : 1].toFixed(2))} value={at} onChange={(e) => setAt(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
              <button
                className="pm-button"
                data-action="addSection"
                disabled={!parent || !box}
                onClick={() => {
                  if (!box) return;
                  const p = num(at, mid[vertical ? 0 : 1]);
                  const pad = 5;
                  parent && d.addSection(parent.id, vertical ? [[p, box.min[1] - pad], [p, box.max[1] + pad]] : [[box.min[0] - pad, p], [box.max[0] + pad, p]]);
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
            <button className="pm-button" data-action="chooseFont" onClick={() => void d.chooseFont()}>
              {t('drawingUi.pdfFont')}
            </button>
            <span className="muted" data-field="pdfFont">
              {drw.pdfFont ?? t('drawingUi.pdfFontNone')}
            </span>
            {drw.pdfFont && (
              <button title={t('drawingUi.pdfFontClear')} data-action="clearFont" onClick={() => d.clearFont()}>
                ✕
              </button>
            )}
          </div>
        </PMGroup>
      </div>
    </div>
  );
}
