import { useEffect, useState } from 'react';
import { t } from '@3db/i18n';
import { ACTIONS, type UiAction } from '../actions';
import { actionTooltip, currentTopicId } from '../help/context';
import { closeHelp, openHelp, setPicking, useHelp } from '../help/state';
import { useDocumentTitle, useSketcherView, useStore } from '../state/store';

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
const ASSEMBLY_TABS: Tab[] = [
  { id: 'assembly', get label() { return t('tab.assembly'); }, groups: ['assembly', 'edit'] },
  { id: 'file', get label() { return t('tab.file'); }, groups: ['file'] },
  { id: 'view', get label() { return t('tab.view'); }, groups: ['view'] },
];

/** CommandManager-style tabbed toolbar (D3.2); buttons come from the action registry (D3.1). */
export function CommandBar() {
  const [tab, setTab] = useState('features');
  const state = useStore((s) => s);
  const title = useDocumentTitle();
  const help = useHelp();
  useSketcherView(); // re-render when the active sketch tool changes
  const sketching = state.editing?.kind === 'sketch';
  const assembly = state.active === 'assembly';
  const tabs = assembly ? ASSEMBLY_TABS : PART_TABS;
  useEffect(() => {
    if (sketching) setTab('sketch');
  }, [sketching]);
  // Every document opened or created shows its main tab (組合件 or 特徵), as in SolidWorks.
  useEffect(() => {
    setTab(assembly ? 'assembly' : 'features');
  }, [assembly, state.documentSerial]);
  const current = tabs.find((t) => t.id === tab) ?? tabs[0]!;
  // undo and redo are on every tab, outside the scrolling row of buttons: on the 特徵 tab they used to be at the far end of forty buttons, out of sight
  const quick = ACTIONS.filter((a) => a.id === 'undo' || a.id === 'redo');
  return (
    <header className="command-bar">
      <div className="brand">3D-Builder</div>
      <nav className="tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={t.id === current.id} className={t.id === current.id ? 'tab active' : 'tab'} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <div className="quick-actions">
        {quick.map((a) => (
          <button key={a.id} className="tool" data-help={a.id} disabled={!a.enabled(state)} onClick={a.run} title={actionTooltip(a)}>
            {a.label}
          </button>
        ))}
      </div>
      <div className="tools">
        {ACTIONS.filter((a) => current.groups.includes(a.group) && !quick.includes(a)).map((a) => (
          <button
            key={a.id}
            className={a.active?.() ? 'tool active' : 'tool'}
            data-help={a.id}
            disabled={!a.enabled(state)}
            onClick={a.run}
            title={actionTooltip(a)}
          >
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
      </div>
      <div className="doc-title" title={state.dirty ? t('doc.unsaved') : undefined}>
        {title}
      </div>
    </header>
  );
}
