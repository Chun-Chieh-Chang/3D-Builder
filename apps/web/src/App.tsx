import { getLocale, subscribeLocale } from '@3db/i18n';
import { useEffect, useSyncExternalStore } from 'react';
import { installShortcuts } from './actions';
import { useDocumentTitle, useStore } from './state/store';
import { AssemblyTree } from './components/AssemblyTree';
import { AssemblyViewport } from './components/AssemblyViewport';
import { CommandBar } from './components/CommandBar';
import { EquationsDialog, PropertiesDialog } from './components/ParametersDialogs';
import { DeleteComponentsDialog, DeleteDialog, FolderDialog, MissingFilesDialog, UnsavedDialog, WhatsWrongDialog } from './components/Dialogs';
import { FeatureTree } from './components/FeatureTree';
import { InsertComponentPanel } from './components/InsertComponentPanel';
import { MatePanel } from './components/MatePanel';
import { MovePanel } from './components/MovePanel';
import { PropertyManager } from './components/PropertyManager';
import { StatusBar } from './components/StatusBar';
import { Viewport } from './components/Viewport';

export function App() {
  // The whole tree is drawn again when the language changes: texts are read when drawn (see strings.ts).
  const locale = useSyncExternalStore(subscribeLocale, getLocale);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const assembly = useStore((s) => s.active === 'assembly');
  const inserting = useStore((s) => !!s.asm?.insert);
  const mating = useStore((s) => !!s.asm?.mate);
  const moving = useStore((s) => !!s.asm?.move);
  const partEditing = useStore((s) => s.editing);
  const editing = assembly ? inserting || mating || moving : !!partEditing;
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
          {assembly ? mating ? <MatePanel /> : inserting ? <InsertComponentPanel /> : moving ? <MovePanel /> : <AssemblyTree /> : editing ? <PropertyManager /> : <FeatureTree />}
        </aside>
        {assembly ? <AssemblyViewport /> : <Viewport />}
      </div>
      <StatusBar />
      <DeleteDialog />
      <DeleteComponentsDialog />
      <WhatsWrongDialog />
      <EquationsDialog />
      <PropertiesDialog />
      <UnsavedDialog />
      <FolderDialog />
      <MissingFilesDialog />
    </div>
  );
}
