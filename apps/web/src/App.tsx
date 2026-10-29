import { getLocale, subscribeLocale } from '@3db/i18n';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { installShortcuts } from './actions';
import { useDocumentTitle, useStore } from './state/store';
import { AssemblyTree } from './components/AssemblyTree';
import { AssemblyViewport } from './components/AssemblyViewport';
import { CommandBar } from './components/CommandBar';
import { AppearanceDialog, EquationsDialog, OptionsDialog, PropertiesDialog, ShortcutsDialog, StepOptionsDialog, TemplateDialog } from './components/ParametersDialogs';
import { DeleteComponentsDialog, DeleteDialog, DxfImportDialog, FolderDialog, MissingFilesDialog, RecoveryDialog, UnsavedDialog, WhatsWrongDialog } from './components/Dialogs';
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
import { SelectionPanel } from './components/SelectionPanel';
import { assemblySelection, pickKey } from './state/selectionFacts';
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
  const floatingParameters = useStore(s => s.options.floatingParameters);
  const floating = !assembly && partEditing?.kind === 'feature' && floatingParameters;
  useEffect(() => {
    setPanel(editing && !floating ? 'properties' : 'tree');
  }, [editing, floating]);
  // What is picked in a part with no session open (plan §2.2): the PropertyManager tab comes alive for it, a pick in the graphics area brings it
  // forward the way a drawing's panel does (a pick in the tree stays in the tree), and letting go of everything goes back to the tree. An assembly
  // is the same story: the component clicked in the view brings it forward, a component or a mate picked in the tree only makes the tab reachable.
  const selectedFace = useStore((s) => s.selectedFace);
  const selectedElements = useStore((s) => s.selectedElements);
  const selected = useStore((s) => s.selected);
  const asm = useStore((s) => s.asm);
  const asmViewPick = useStore((s) => s.asm?.viewPick ?? null);
  const asmSelected = useStore((s) => s.asm?.selected ?? null);
  const asmPick = assembly ? assemblySelection(asmViewPick, asmSelected, asm!.doc) : { kind: 'none' as const };
  const pick = pickKey(selectedFace, selectedElements);
  const picked = !!pick;
  const partSelection = picked || (!assembly && !!selected);
  const asmPicked = assembly && asmPick.kind !== 'none' && asmPick.fromView; // from the graphics area: brings the properties forward
  const asmReachable = assembly && asmPick.kind !== 'none'; // from the tree: the tab comes alive, the page stays
  useEffect(() => {
    if (editing) return;
    if (picked || asmPicked) setPanel('properties');
    else if (!selected && !asmReachable) setPanel('tree');
  }, [picked, selected, editing, asmPicked, asmReachable]);
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
                disabled={!editing && !partSelection && !asmReachable}
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
                  ) : (
                    /* no session: what is picked in the view or the tree, as in a part (plan §2.2) */
                    <SelectionPanel />
                  )
                ) : partEditing ? (
                  <PropertyManager />
                ) : (
                  <SelectionPanel />
                )}
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
      <DxfImportDialog />
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
