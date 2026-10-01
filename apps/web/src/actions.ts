import { isDatumPlaneName, type DatumPlaneName, type Ref } from '@3db/model';
import { store, type UiState } from './state/store';
import { t } from '@3db/i18n';
import { TOOL_LABEL } from './strings';
import type { ToolId } from './sketcher/controller';

/**
 * UI action registry (D3.1): the single definition of every command's label, shortcut and
 * enablement. Toolbars, menus and keyboard handling all read from here.
 */
export interface UiAction {
  id: string;
  label: string;
  shortcut?: string;
  group: 'file' | 'edit' | 'feature' | 'sketch' | 'sketch-tool' | 'assembly' | 'view' | 'tools';
  enabled(s: UiState): boolean;
  run(): void;
  /** Toggle state for tool buttons (the active sketch tool). */
  active?(): boolean;
}

/** Nothing going on in the open assembly: no PropertyManager, no drag. */
const assemblyFree = (s: UiState) => !s.asm?.insert && !s.asm?.mate && !s.asm?.move && !s.asm?.drag;
/** No PropertyManager session in the open document: file commands may replace or save it. */
const idle = (s: UiState) => (s.active === 'assembly' ? assemblyFree(s) : s.editing === null);
/** A part is open and nothing is being edited in it. */
const partIdle = (s: UiState) => s.active === 'part' && s.editing === null;
const assemblyIdle = (s: UiState) => s.active === 'assembly' && assemblyFree(s);
const hasComponents = (s: UiState) => (s.asm?.doc.components.length ?? 0) > 0;
const sketching = (s: UiState) => s.editing?.kind === 'sketch';
const selectedFeature = (s: UiState) => s.doc.features.find((f) => f.id === s.selected);
const sketchSelected = (s: UiState) => partIdle(s) && selectedFeature(s)?.type === 'sketch';
/** A sweep takes a profile (the selected sketch) and a path (another sketch). */
const canSweep = (s: UiState) => sketchSelected(s) && s.doc.features.filter((f) => f.type === 'sketch').length >= 2;
const hasBody = (s: UiState) => partIdle(s) && !!s.result?.mesh;
/** A plane to sketch on: a default or reference plane in the tree, or a planar face in the graphics area. */
const sketchPlane = (s: UiState): DatumPlaneName | Ref | null => {
  if (s.selected !== null && isDatumPlaneName(s.selected)) return s.selected;
  if (selectedFeature(s)?.type === 'refPlane') return { kind: 'datum', name: s.selected! };
  return s.selectedFace?.fingerprint?.type === 'plane' ? s.selectedFace : null;
};

const SKETCH_TOOLS: ToolId[] = ['dimension', 'line', 'centerline', 'rect', 'centerRect', 'circle', 'perimeterCircle', 'arc', 'tangentArc', 'threePointArc', 'slot', 'polygon', 'point', 'sketchFillet', 'sketchChamfer', 'trim', 'extend', 'offset', 'mirror', 'convert', 'pierce'];

export const ACTIONS: UiAction[] = [
  { id: 'new-part', label: '新零件', shortcut: 'Ctrl+N', group: 'file', enabled: idle, run: () => store.newPart() },
  { id: 'new-assembly', label: '新組合件', group: 'file', enabled: idle, run: () => store.newAssembly() },
  { id: 'new-demo', label: '新示範件', group: 'file', enabled: idle, run: () => store.newDemo() },
  { id: 'open', label: '開啟舊檔', shortcut: 'Ctrl+O', group: 'file', enabled: idle, run: () => store.open() },
  { id: 'save', label: '儲存檔案', shortcut: 'Ctrl+S', group: 'file', enabled: idle, run: () => void store.save() },
  { id: 'save-as', label: '另存新檔', group: 'file', enabled: idle, run: () => void store.saveAs() },
  { id: 'export-step', label: '輸出 STEP', group: 'file', enabled: (s) => (partIdle(s) || (assemblyIdle(s) && hasComponents(s))) && s.bootMs !== null, run: () => void store.exportStep() },
  { id: 'return-assembly', label: '返回組合件', group: 'file', enabled: (s) => partIdle(s) && s.returnTo !== null, run: () => store.returnToAssembly() },

  { id: 'equations', get label() { return t('action.equations'); }, group: 'tools', enabled: partIdle, run: () => store.openDialog('equations') },
  { id: 'properties', get label() { return t('action.properties'); }, group: 'tools', enabled: partIdle, run: () => store.openDialog('properties') },

  { id: 'extrude', label: '伸長填料/基材', group: 'feature', enabled: sketchSelected, run: () => store.newExtrude('boss') },
  { id: 'revolve', label: '旋轉填料/基材', group: 'feature', enabled: sketchSelected, run: () => store.newRevolve('boss') },
  { id: 'sweep', get label() { return t('action.sweep'); }, group: 'feature', enabled: canSweep, run: () => store.newSweep('boss') },
  { id: 'loft', get label() { return t('action.loft'); }, group: 'feature', enabled: sketchSelected, run: () => store.newLoft('boss') },
  { id: 'rib', get label() { return t('action.rib'); }, group: 'feature', enabled: (s) => sketchSelected(s) && !!s.result?.mesh, run: () => store.newRib() },
  { id: 'extrude-cut', label: '伸長除料', group: 'feature', enabled: (s) => sketchSelected(s) && !!s.result?.mesh, run: () => store.newExtrude('cut') },
  { id: 'revolve-cut', label: '旋轉除料', group: 'feature', enabled: (s) => sketchSelected(s) && !!s.result?.mesh, run: () => store.newRevolve('cut') },
  { id: 'sweep-cut', get label() { return t('action.sweepCut'); }, group: 'feature', enabled: (s) => canSweep(s) && !!s.result?.mesh, run: () => store.newSweep('cut') },
  { id: 'loft-cut', get label() { return t('action.loftCut'); }, group: 'feature', enabled: (s) => sketchSelected(s) && !!s.result?.mesh, run: () => store.newLoft('cut') },
  { id: 'fillet', label: '圓角', group: 'feature', enabled: hasBody, run: () => store.newFillet() },
  { id: 'chamfer', label: '導角', group: 'feature', enabled: hasBody, run: () => store.newChamfer() },
  { id: 'delete-face', get label() { return t('feature.deleteFace'); }, group: 'feature', enabled: hasBody, run: () => store.newDeleteFace() },
  { id: 'hole', get label() { return t('feature.hole'); }, group: 'feature', enabled: (s) => sketchSelected(s) && !!s.result?.mesh, run: () => store.newHole() },
  { id: 'draft', get label() { return t('feature.draftFeature'); }, group: 'feature', enabled: hasBody, run: () => store.newDraft() },
  { id: 'shell', get label() { return t('feature.shell'); }, group: 'feature', enabled: hasBody, run: () => store.newShell() },
  { id: 'move-face', get label() { return t('feature.moveFace'); }, group: 'feature', enabled: hasBody, run: () => store.newMoveFace() },
  { id: 'combine', get label() { return t('feature.combine'); }, group: 'feature', enabled: (s) => hasBody(s) && (s.result?.bodies.length ?? 0) > 1, run: () => store.newCombine() },
  { id: 'ref-plane', label: '基準面', group: 'feature', enabled: partIdle, run: () => store.newRefPlane() },
  { id: 'import-step', label: '輸入 STEP', group: 'feature', enabled: (s) => partIdle(s) && s.bootMs !== null, run: () => void store.importStep() },

  { id: 'insert-component', label: '插入零組件', group: 'assembly', enabled: assemblyIdle, run: () => void store.assembly?.startInsert() },
  { id: 'mate', label: '結合', group: 'assembly', enabled: (s) => assemblyIdle(s) && hasComponents(s), run: () => store.assembly?.startMate() },
  { id: 'move-component', label: '移動零組件', group: 'assembly', enabled: (s) => assemblyIdle(s) && hasComponents(s), run: () => store.assembly?.startMove('move') },
  { id: 'rotate-component', label: '旋轉零組件', group: 'assembly', enabled: (s) => assemblyIdle(s) && hasComponents(s), run: () => store.assembly?.startMove('rotate') },
  { id: 'fix-component', label: '固定', group: 'assembly', enabled: (s) => assemblyIdle(s) && selectedComponent(s)?.fixed === false, run: () => setFixed(true) },
  { id: 'float-component', label: '浮動', group: 'assembly', enabled: (s) => assemblyIdle(s) && selectedComponent(s)?.fixed === true, run: () => setFixed(false) },

  {
    id: 'sketch',
    label: '草圖',
    group: 'sketch',
    enabled: (s) => partIdle(s) && sketchPlane(s) !== null,
    run: () => {
      const plane = sketchPlane(store.getState());
      if (plane) store.newSketch(plane);
    },
  },
  ...SKETCH_TOOLS.map(
    (tool): UiAction => ({
      id: `tool-${tool}`,
      label: TOOL_LABEL[tool],
      group: 'sketch-tool',
      enabled: sketching,
      run: () => store.sketcher?.setTool(store.sketcher.getView().tool === tool ? 'select' : tool),
      active: () => store.sketcher?.getView().tool === tool,
    }),
  ),
  { id: 'construction', label: '幾何建構線', group: 'sketch-tool', enabled: sketching, run: () => toggleConstruction() },
  { id: 'exit-sketch', label: '離開草圖', group: 'sketch-tool', enabled: sketching, run: () => store.commitEdit() },

  { id: 'undo', label: '復原', shortcut: 'Ctrl+Z', group: 'edit', enabled: (s) => (s.asm ? s.asm.canUndo && idle(s) : s.canUndo), run: () => store.undo() },
  { id: 'redo', label: '重做', shortcut: 'Ctrl+Y', group: 'edit', enabled: (s) => (s.asm ? s.asm.canRedo && idle(s) : s.canRedo), run: () => store.redo() },
  { id: 'rebuild', label: '重新計算', shortcut: 'Ctrl+B', group: 'edit', enabled: () => true, run: () => store.rebuild() },

  { id: 'fit', label: '全部顯示', shortcut: 'F', group: 'view', enabled: () => true, run: () => store.viewer?.fitAll() },
  { id: 'view-front', label: '前視', shortcut: 'Ctrl+1', group: 'view', enabled: () => true, run: () => store.viewer?.setView('front') },
  { id: 'view-top', label: '上視', shortcut: 'Ctrl+5', group: 'view', enabled: () => true, run: () => store.viewer?.setView('top') },
  { id: 'view-right', label: '右視', shortcut: 'Ctrl+4', group: 'view', enabled: () => true, run: () => store.viewer?.setView('right') },
  { id: 'view-iso', label: '等角', shortcut: 'Ctrl+7', group: 'view', enabled: () => true, run: () => store.viewer?.setView('iso') },
  { id: 'view-normal', label: '正視於', shortcut: 'Ctrl+8', group: 'view', enabled: sketching, run: () => lookAtSketch() },
];

export const action = (id: string): UiAction => {
  const a = ACTIONS.find((x) => x.id === id);
  if (!a) throw new Error(`unknown action ${id}`);
  return a;
};

function selectedComponent(s: UiState) {
  const id = s.asm?.selected;
  return id ? s.asm!.doc.components.find((c) => c.id === id) : undefined;
}

function setFixed(value: boolean): void {
  const c = selectedComponent(store.getState());
  if (c) store.assembly?.setFixed([c.id], value);
}

function lookAtSketch(): void {
  const sketch = store.editedSketch();
  const frame = sketch && store.frameOf(sketch);
  if (frame) store.viewer?.lookAt(frame);
}

/** Construction geometry (C1.14): toggles the selected curves; all become construction unless all already are. */
function toggleConstruction(): void {
  const sketcher = store.sketcher;
  const sketch = store.editedSketch();
  if (!sketcher || !sketch) return;
  const curves = sketch.entities.filter((e) => e.type !== 'point' && sketcher.getView().selection.includes(e.id));
  if (curves.length === 0) return store.notify('請先選擇直線、圓或圓弧');
  sketcher.setConstruction(!curves.every((e) => 'construction' in e && e.construction));
}

function matches(e: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split('+');
  const key = parts.pop()!.toLowerCase();
  const ctrl = parts.includes('Ctrl');
  return e.key.toLowerCase() === key && ctrl === (e.ctrlKey || e.metaKey) && !e.altKey;
}

/** Global shortcuts; ignored while typing into inputs. */
export function installShortcuts(): () => void {
  const onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
    const s = store.getState();
    // An open dialog owns the keyboard (Esc closes it; its focused button takes Enter).
    if (s.confirmDelete || s.whatsWrong || s.unsaved || s.folderRequest || s.asm?.confirmDelete || s.asm?.relink) {
      if (e.key === 'Escape') {
        store.requestDelete(null);
        store.showWhatsWrong(false);
        void store.answerUnsaved('cancel');
        store.cancelFolder();
        store.assembly?.requestDelete(null);
        store.assembly?.closeRelink();
      }
      return;
    }
    if (s.asm) {
      const a = store.assembly;
      const selected = s.asm.selected;
      if (s.asm.drag) {
        // A drag owns the keyboard: Esc puts everything back where it was.
        if (e.key === 'Escape') store.viewer?.cancelComponentDrag();
        return;
      }
      if (s.asm.move) {
        if (e.key === 'Escape' || e.key === 'Enter') return void a?.closeMove();
      } else if (s.asm.mate) {
        if (e.key === 'Escape') return void a?.cancelMate();
        if (e.key === 'Enter') return void a?.applyMate();
      } else if (s.asm.insert) {
        if (e.key === 'Escape') return void a?.cancelInsert();
        if (e.key === 'Enter') return void a?.place(null);
      } else if (e.key === 'Delete' && selected && (selectedComponent(s) || s.asm.doc.mates.some((m) => m.id === selected))) {
        return void a?.requestDelete([selected]);
      }
    } else if (s.editing?.kind === 'sketch') {
      // Inside a sketch, Esc ends the current tool and Delete removes the selection (SolidWorks);
      // leaving the sketch is the confirmation corner or 「離開草圖」.
      if (e.key === 'Escape') return void store.sketcher?.escape();
      if (e.key === 'Delete') return void store.sketcher?.deleteSelection();
    } else if (s.editing) {
      if (e.key === 'Enter') return void store.commitEdit();
      if (e.key === 'Escape') return void store.cancelEdit();
    } else if (e.key === 'Delete' && s.doc.features.some((f) => f.id === s.selected)) {
      return void store.requestDelete(s.selected); // 「確認刪除」 for the feature selected in the tree
    }
    for (const a of ACTIONS) {
      if (a.shortcut && matches(e, a.shortcut) && a.enabled(s)) {
        e.preventDefault();
        a.run();
        return;
      }
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
