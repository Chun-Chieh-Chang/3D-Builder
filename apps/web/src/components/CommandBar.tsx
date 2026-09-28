import { useEffect, useState } from 'react';
import { ACTIONS, type UiAction } from '../actions';
import { useDocumentTitle, useSketcherView, useStore } from '../state/store';

const TABS: { id: string; label: string; groups: UiAction['group'][] }[] = [
  { id: 'features', label: '特徵', groups: ['feature', 'edit'] },
  { id: 'sketch', label: '草圖', groups: ['sketch', 'sketch-tool'] },
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
  useEffect(() => {
    if (sketching) setTab('sketch');
  }, [sketching]);
  const current = TABS.find((t) => t.id === tab)!;
  return (
    <header className="command-bar">
      <div className="brand">3D-Builder</div>
      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={t.id === tab} className={t.id === tab ? 'tab active' : 'tab'} onClick={() => setTab(t.id)}>
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
