import { useEffect } from 'react';
import { installShortcuts } from './actions';
import { useDocumentTitle, useStore } from './state/store';
import { AssemblyTree } from './components/AssemblyTree';
import { AssemblyViewport } from './components/AssemblyViewport';
import { CommandBar } from './components/CommandBar';
import { DeleteComponentsDialog, DeleteDialog, FolderDialog, UnsavedDialog, WhatsWrongDialog } from './components/Dialogs';
import { FeatureTree } from './components/FeatureTree';
import { InsertComponentPanel } from './components/InsertComponentPanel';
import { PropertyManager } from './components/PropertyManager';
import { StatusBar } from './components/StatusBar';
import { Viewport } from './components/Viewport';

export function App() {
  const assembly = useStore((s) => s.active === 'assembly');
  const inserting = useStore((s) => !!s.asm?.insert);
  const partEditing = useStore((s) => s.editing);
  const editing = assembly ? inserting : !!partEditing;
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
          {assembly ? (inserting ? <InsertComponentPanel /> : <AssemblyTree />) : editing ? <PropertyManager /> : <FeatureTree />}
        </aside>
        {assembly ? <AssemblyViewport /> : <Viewport />}
      </div>
      <StatusBar />
      <DeleteDialog />
      <DeleteComponentsDialog />
      <WhatsWrongDialog />
      <UnsavedDialog />
      <FolderDialog />
    </div>
  );
}
