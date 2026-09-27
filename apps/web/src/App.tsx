import { useEffect } from 'react';
import { installShortcuts } from './actions';
import { useStore } from './state/store';
import { CommandBar } from './components/CommandBar';
import { FeatureTree } from './components/FeatureTree';
import { PropertyManager } from './components/PropertyManager';
import { StatusBar } from './components/StatusBar';
import { Viewport } from './components/Viewport';

export function App() {
  const editing = useStore((s) => s.editing);
  useEffect(() => installShortcuts(), []);
  return (
    <div className="app">
      <CommandBar />
      <div className="workspace">
        <aside className="left-panel">
          <div className="panel-tabs">
            <span className={editing ? '' : 'active'}>FeatureManager</span>
            <span className={editing ? 'active' : ''}>PropertyManager</span>
          </div>
          {editing ? <PropertyManager /> : <FeatureTree />}
        </aside>
        <Viewport />
      </div>
      <StatusBar />
    </div>
  );
}
