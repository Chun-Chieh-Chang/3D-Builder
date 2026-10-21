import { useEffect, useRef, useState } from 'react';
import { t } from '@3db/i18n';
import { ACTIONS, type UiAction } from '../actions';
import { actionTooltip, currentTopicId } from '../help/context';
import { closeHelp, openHelp, setPicking, useHelp } from '../help/state';
import { useDocumentTitle, useSketcherView, useStore } from '../state/store';
import { ShutdownButton } from './ShutdownButton';

type Tab = { id: string; label: string; groups: UiAction['group'][] };

/** The CommandManager's tabs follow the open document, as in SolidWorks. */
const PART_TABS: Tab[] = [
  { id: 'features', get label() { return t('tab.features'); }, groups: ['feature', 'edit'] },
  { id: 'sheet', get label() { return t('tab.sheet'); }, groups: ['sheet'] },
  { id: 'sketch', get label() { return t('tab.sketch'); }, groups: ['sketch', 'sketch-tool'] },
  { id: 'tools', get label() { return t('tab.tools'); }, groups: ['tools'] },
  { id: 'file', get label() { return t('tab.file'); }, groups: ['file'] },
  { id: 'view', get label() { return t('tab.view'); }, groups: ['view'] },
];
/** A drawing's tabs (D-I1b), as SolidWorks's CommandManager has them for a drawing: the views, the annotations, the file. */
const DRAWING_TABS: Tab[] = [
  { id: 'layout', get label() { return t('tab.viewLayout'); }, groups: ['drawing'] },
  { id: 'annotation', get label() { return t('tab.annotation'); }, groups: ['annotation'] },
  { id: 'file', get label() { return t('tab.file'); }, groups: ['file'] },
];
const ASSEMBLY_TABS: Tab[] = [
  { id: 'assembly', get label() { return t('tab.assembly'); }, groups: ['assembly', 'edit'] },
  { id: 'file', get label() { return t('tab.file'); }, groups: ['file'] },
  { id: 'view', get label() { return t('tab.view'); }, groups: ['view'] },
];

/**
 * CommandManager-style menu bar (D3.2); the commands come from the action registry (D3.1). Each name is a menu: pressing it lets the commands of its group
 * drop down below it, in columns; one is chosen, or Esc, or a press anywhere else, and it folds up again. While one is open, moving over another name opens
 * that one instead, as menus do. The commands of the menu last opened stay in the page (folded up, out of sight) so that what they say of themselves is there to read.
 */
export function CommandBar() {
  const [tab, setTab] = useState('features');
  const [open, setOpen] = useState(false);
  /** The button whose drop-down of kinds is open, if any. */
  const [dropped, setDropped] = useState<string | null>(null);
  const bar = useRef<HTMLElement>(null);
  const state = useStore((s) => s);
  const title = useDocumentTitle();
  const help = useHelp();
  useSketcherView(); // re-render when the active sketch tool changes
  const sketching = state.editing?.kind === 'sketch';
  const assembly = state.active === 'assembly';
  const drawing = state.active === 'drawing';
  const tabs = drawing ? DRAWING_TABS : assembly ? ASSEMBLY_TABS : PART_TABS;
  useEffect(() => {
    if (sketching) setTab('sketch');
  }, [sketching]);
  // Every document opened or created shows its main tab (組合件 or 特徵), as in SolidWorks.
  useEffect(() => {
    setTab(drawing ? 'layout' : assembly ? 'assembly' : 'features');
    setOpen(false);
  }, [assembly, drawing, state.documentSerial]);
  useEffect(() => {
    if (!open) setDropped(null);
  }, [open]);
  // folds up on Esc, and on a press anywhere that is not the menu
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    const onPress = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !bar.current?.querySelector('.menu')?.parentElement?.contains(e.target)) setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onPress, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onPress, true);
    };
  }, [open]);
  const current = tabs.find((t) => t.id === tab) ?? tabs[0]!;
  // undo and redo are on every tab, outside the scrolling row of buttons: on the 特徵 tab they used to be at the far end of forty buttons, out of sight
  const quick = ACTIONS.filter((a) => a.id === 'undo' || a.id === 'redo');
  return (
    <header className="command-bar" ref={bar}>
      <div className="brand">3D-Builder</div>
      <nav className="tabs" role="menubar">
        {tabs.map((m) => {
          const here = m.id === current.id;
          return (
            <div key={m.id} className={here && open ? 'menu open' : 'menu'}>
              <button
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={here && open}
                className={here ? (open ? 'tab active open' : 'tab active') : 'tab'}
                onClick={() => {
                  if (here && open) setOpen(false);
                  else {
                    setTab(m.id);
                    setOpen(true);
                  }
                }}
                onPointerEnter={() => {
                  if (open && !here) setTab(m.id);
                }}
              >
                {m.label}
              </button>
              {here && (
                <div className={open ? 'tools menu-panel' : 'tools menu-panel folded'} role="menu">
                  {ACTIONS.filter((a) => m.groups.includes(a.group) && !quick.includes(a) && !a.parent && !a.menuOnly).map((a) => {
                    const button = (x: UiAction) => (
                      <button
                        key={x.id}
                        role="menuitem"
                        className={x.active?.() ? 'tool active' : 'tool'}
                        data-help={x.id}
                        disabled={!x.enabled(state)}
                        onClick={() => {
                          setOpen(false);
                          setDropped(null);
                          x.run();
                        }}
                        title={actionTooltip(x)}
                      >
                        {x.label}
                      </button>
                    );
                    const children = ACTIONS.filter((x) => x.parent === a.id);
                    if (children.length === 0) return button(a);
                    // a button with a drop-down of its kinds (ADR 0177), as SolidWorks's 智慧型尺寸 ▾: the kind on now is the one shown as on
                    const on = children.find((x) => x.active?.());
                    return (
                      <span key={a.id} className={`tool-split${dropped === a.id ? ' open' : ''}`} data-split={a.id}>
                        {button(a)}
                        <button
                          className={on ? 'tool split-arrow active' : 'tool split-arrow'}
                          aria-haspopup="menu"
                          aria-expanded={dropped === a.id}
                          aria-label={t('cmdbar.moreKinds', { name: a.label })}
                          title={t('cmdbar.moreKinds', { name: a.label })}
                          data-split-toggle={a.id}
                          disabled={!a.enabled(state)}
                          onClick={() => setDropped(dropped === a.id ? null : a.id)}
                        >
                          ▾
                        </button>
                        {dropped === a.id && (
                          <span className="split-menu" role="menu">
                            {children.map(button)}
                          </span>
                        )}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className="quick-actions">
        {quick.map((a) => (
          <button key={a.id} className="tool" data-help={a.id} disabled={!a.enabled(state)} onClick={a.run} title={actionTooltip(a)}>
            {a.label}
          </button>
        ))}
      </div>
      <div className="help-buttons">
        <button className={help.open ? 'tool active' : 'tool'} title={t('helpui.buttonTip')} onClick={() => (help.open ? closeHelp() : openHelp(currentTopicId()))}>
          {t('helpui.button')}
        </button>
        <button className={help.picking ? 'tool active' : 'tool'} title={t('helpui.whatIsThisTip')} onClick={() => setPicking(!help.picking)}>
          {t('helpui.whatIsThis')}
        </button>
        <ShutdownButton />
      </div>
      <div className="doc-title" title={state.dirty ? t('doc.unsaved') : undefined}>
        {title}
      </div>
    </header>
  );
}
