import { useState } from 'react';
import { ACTIONS, type UiAction } from '../actions';
import { useStore } from '../state/store';

const TABS = [
  { id: 'features', label: '特徵', groups: ['edit'] as UiAction['group'][] },
  { id: 'file', label: '檔案', groups: ['file'] as UiAction['group'][] },
  { id: 'view', label: '檢視', groups: ['view'] as UiAction['group'][] },
];

/** CommandManager-style tabbed toolbar (D3.2); buttons come from the action registry (D3.1). */
export function CommandBar() {
  const [tab, setTab] = useState('features');
  const state = useStore((s) => s);
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
          <button key={a.id} className="tool" disabled={!a.enabled(state)} onClick={a.run} title={a.shortcut ? `${a.label}（${a.shortcut}）` : a.label}>
            {a.label}
          </button>
        ))}
      </div>
    </header>
  );
}
