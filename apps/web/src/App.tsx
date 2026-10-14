import { getLocale, subscribeLocale } from '@3db/i18n';
import { useEffect, useSyncExternalStore } from 'react';
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
import { StatusBar } from './components/StatusBar';
import { Viewport } from './components/Viewport';

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
            <div className="panel-tabs">
              <span className={editing ? '' : 'active'}>FeatureManager</span>
              <span className={editing ? 'active' : ''}>PropertyManager</span>
            </div>
          )}
          {drawing ? <DrawingPanel /> : assembly ? mating ? <MatePanel /> : inserting ? <InsertComponentPanel /> : moving ? <MovePanel /> : patterning ? <PatternPanel /> : exploding ? <ExplodePanel /> : forming ? <FormSubPanel /> : <AssemblyTree /> : editing ? <PropertyManager /> : <FeatureTree />}
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
      <UnsavedDialog />
      <RecoveryDialog />
      <FolderDialog />
      <MissingFilesDialog />
    </div>
  );
}
