import { getLocale, subscribeLocale } from '@3db/i18n';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { installShortcuts } from './actions';
import { useDocumentTitle, useStore } from './state/store';
import { AssemblyTree } from './components/AssemblyTree';
import { AssemblyViewport } from './components/AssemblyViewport';
import { CommandBar } from './components/CommandBar';
import { AppearanceDialog, EquationsDialog, OptionsDialog, PropertiesDialog, ShortcutsDialog, StepOptionsDialog, TemplateDialog } from './components/ParametersDialogs';
import { DeleteComponentsDialog, DeleteDialog, FolderDialog, MissingFilesDialog, RecoveryDialog, UnsavedDialog, WhatsWrongDialog } from './components/Dialogs';
import { FeatureTree } from './components/FeatureTree';
import { HelpPanel } from './components/HelpPanel';
import { currentTopicId, topicOf } from './help/context';
import { installHelp } from './help/install';
import { InsertComponentPanel } from './components/InsertComponentPanel';
import { MatePanel } from './components/MatePanel';
import { MovePanel } from './components/MovePanel';
import { PatternPanel } from './components/PatternPanel';
import { BomDialog } from './components/BomDialog';
import { PhysicalDialog } from './components/PhysicalDialog';
import { CheckDialog } from './components/CheckDialog';
import { DrawingPanel, DrawingTaskPane } from './components/DrawingPanel';
import { DrawingViewport } from './components/DrawingViewport';
import { ExplodePanel } from './components/ExplodePanel';
import { FormSubPanel } from './components/FormSubPanel';
import { PropertyManager } from './components/PropertyManager';
import { ShutdownOverlay } from './components/ShutdownOverlay';
import { StatusBar } from './components/StatusBar';
import { Viewport } from './components/Viewport';
import { ViewOrientationDialog } from './components/ViewOrientationDialog';

export function App() {
  // The whole tree is drawn again when the language changes: texts are read when drawn (see strings.ts).
  const locale = useSyncExternalStore(subscribeLocale, getLocale);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const assembly = useStore((s) => s.active === 'assembly');
  const drawing = useStore((s) => s.active === 'drawing');
  const inserting = useStore((s) => !!s.asm?.insert);
  const mating = useStore((s) => !!s.asm?.mate);
  const moving = useStore((s) => !!s.asm?.move);
  const patterning = useStore((s) => !!s.asm?.pattern);
  const exploding = useStore((s) => !!s.asm?.explode);
  const forming = useStore((s) => !!s.asm?.formSub);
  const partEditing = useStore((s) => s.editing);
  const editing = assembly ? inserting || mating || moving || patterning || exploding || forming : !!partEditing;
  const title = useDocumentTitle();
  // The part and assembly panels get the same two tabs as a drawing (ADR 0133). A session opens the PropertyManager tab by itself; the FeatureManager tab
  // stays available, so the tree can be looked at without leaving the session (this relaxes ADR 0034 決定 9, which hid the tree for the whole session).
  const [panel, setPanel] = useState<'tree' | 'properties'>('tree');
  useEffect(() => {
    setPanel(editing ? 'properties' : 'tree');
  }, [editing]);
  useEffect(() => installShortcuts(), []);
  useEffect(() => installHelp({ currentTopic: currentTopicId, hasTopic: (id) => topicOf(id) !== null }), []);
  useEffect(() => {
    document.title = `${title} - 3D-Builder`;
  }, [title]);
  return (
    <div className="app">
      <CommandBar />
      <div className={`workspace${drawing ? ' with-task-pane' : ''}`}>
        <aside className="left-panel" data-help={editing ? 'concept.property-manager' : 'concept.feature-tree'}>
          {/* a drawing has tabs of its own, which work (D-I1b, ADR 0133) */}
          {!drawing && (
            <div className="sw-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={panel === 'tree'} className={panel === 'tree' ? 'active' : ''} onClick={() => setPanel('tree')}>
                FeatureManager
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={panel === 'properties'}
                className={panel === 'properties' ? 'active' : ''}
                disabled={!editing}
                onClick={() => setPanel('properties')}
              >
                PropertyManager
              </button>
            </div>
          )}
          {drawing ? (
            <DrawingPanel />
          ) : (
            <div className="sw-panel">
              {/* Both panes stay in the page and the tab only hides one (the plan's §2.4): the fields of a session, which a script or a test reaches for, are never
                  taken away by looking at the tree. Each pane is the one a drawing lays out (ADR 0133), so the two sidebars look the same. */}
              <div className="sw-pane" hidden={panel !== 'tree'}>
                {assembly ? <AssemblyTree /> : <FeatureTree />}
              </div>
              <div className="sw-pane" hidden={panel !== 'properties'}>
                {assembly ? (
                  mating ? (
                    <MatePanel />
                  ) : inserting ? (
                    <InsertComponentPanel />
                  ) : moving ? (
                    <MovePanel />
                  ) : patterning ? (
                    <PatternPanel />
                  ) : exploding ? (
                    <ExplodePanel />
                  ) : forming ? (
                    <FormSubPanel />
                  ) : null
                ) : partEditing ? (
                  <PropertyManager />
                ) : null}
              </div>
            </div>
          )}
        </aside>
        {drawing ? <DrawingViewport /> : assembly ? <AssemblyViewport /> : <Viewport />}
        {drawing && <DrawingTaskPane />}
      </div>
      <StatusBar />
      <HelpPanel />
      <DeleteDialog />
      <DeleteComponentsDialog />
      <WhatsWrongDialog />
      <EquationsDialog />
      <PropertiesDialog />
      <BomDialog />
      <PhysicalDialog />
      <CheckDialog />
      <AppearanceDialog />
      <StepOptionsDialog />
      <TemplateDialog />
      <ShortcutsDialog />
      <OptionsDialog />
      <ViewOrientationDialog />
      <UnsavedDialog />
      <RecoveryDialog />
      <FolderDialog />
      <MissingFilesDialog />
      <ShutdownOverlay />
    </div>
  );
}
