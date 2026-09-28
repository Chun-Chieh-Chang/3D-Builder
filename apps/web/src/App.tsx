import { useEffect } from 'react';
import { installShortcuts } from './actions';
import { useDocumentTitle, useStore } from './state/store';
import { CommandBar } from './components/CommandBar';
import { DeleteDialog, UnsavedDialog, WhatsWrongDialog } from './components/Dialogs';
import { FeatureTree } from './components/FeatureTree';
import { PropertyManager } from './components/PropertyManager';
import { StatusBar } from './components/StatusBar';
import { Viewport } from './components/Viewport';

export function App() {
  const editing = useStore((s) => s.editing);
  const title = useDocumentTitle();
  useEffect(() => installShortcuts(), []);
  useEffect(() => {
    document.title = `${title} - 3D-Builder`;
  }, [title]);
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
      <DeleteDialog />
      <WhatsWrongDialog />
      <UnsavedDialog />
    </div>
  );
}
