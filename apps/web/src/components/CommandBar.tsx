import { useEffect, useState } from 'react';
import { ACTIONS, type UiAction } from '../actions';
import { useDocumentTitle, useSketcherView, useStore } from '../state/store';

type Tab = { id: string; label: string; groups: UiAction['group'][] };

/** The CommandManager's tabs follow the open document, as in SolidWorks. */
const PART_TABS: Tab[] = [
  { id: 'features', label: '特徵', groups: ['feature', 'edit'] },
  { id: 'sketch', label: '草圖', groups: ['sketch', 'sketch-tool'] },
  { id: 'file', label: '檔案', groups: ['file'] },
  { id: 'view', label: '檢視', groups: ['view'] },
];
const ASSEMBLY_TABS: Tab[] = [
  { id: 'assembly', label: '組合件', groups: ['assembly', 'edit'] },
  { id: 'file', label: '檔案', groups: ['file'] },
  { id: 'view', label: '檢視', groups: ['view'] },
];

/** CommandManager-style tabbed toolbar (D3.2); buttons come from the action registry (D3.1). */
export function CommandBar() {
  const [tab, setTab] = useState('features');
  const state = useStore((s) => s);
  const title = useDocumentTitle();
  useSketcherView(); // re-render when the active sketch tool changes
  const sketching = state.editing?.kind === 'sketch';
  const assembly = state.active === 'assembly';
  const tabs = assembly ? ASSEMBLY_TABS : PART_TABS;
  useEffect(() => {
    if (sketching) setTab('sketch');
  }, [sketching]);
  // A new document opens on its main tab; the file and view tabs stay where they are.
  useEffect(() => {
    setTab((t) => (t === 'file' || t === 'view' ? t : assembly ? 'assembly' : 'features'));
  }, [assembly]);
  const current = tabs.find((t) => t.id === tab) ?? tabs[0]!;
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
      <div className="tools">
        {ACTIONS.filter((a) => current.groups.includes(a.group)).map((a) => (
          <button
            key={a.id}
            className={a.active?.() ? 'tool active' : 'tool'}
            disabled={!a.enabled(state)}
            onClick={a.run}
            title={a.shortcut ? `${a.label}（${a.shortcut}）` : a.label}
          >
            {a.label}
          </button>
        ))}
      </div>
      <div className="doc-title" title={state.dirty ? '有尚未儲存的變更' : undefined}>
        {title}
      </div>
    </header>
  );
}
