import { isDatumPlaneName } from '@3db/model';
import { store, type UiState } from './state/store';
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
  group: 'file' | 'edit' | 'feature' | 'sketch' | 'sketch-tool' | 'view';
  enabled(s: UiState): boolean;
  run(): void;
  /** Toggle state for tool buttons (the active sketch tool). */
  active?(): boolean;
}

const idle = (s: UiState) => s.editing === null;
const sketching = (s: UiState) => s.editing?.kind === 'sketch';
const selectedFeature = (s: UiState) => s.doc.features.find((f) => f.id === s.selected);
const sketchSelected = (s: UiState) => idle(s) && selectedFeature(s)?.type === 'sketch';
const hasBody = (s: UiState) => idle(s) && !!s.result?.mesh;
/** A plane to sketch on: a datum plane in the tree, or a planar face in the graphics area. */
const sketchPlane = (s: UiState) => (s.selected !== null && isDatumPlaneName(s.selected) ? s.selected : s.selectedFace?.fingerprint?.type === 'plane' ? s.selectedFace : null);

const SKETCH_TOOLS: ToolId[] = ['dimension', 'line', 'centerline', 'rect', 'centerRect', 'circle', 'perimeterCircle', 'arc', 'tangentArc', 'threePointArc', 'point'];

export const ACTIONS: UiAction[] = [
  { id: 'new-part', label: '新零件', shortcut: 'Ctrl+N', group: 'file', enabled: idle, run: () => store.newPart() },
  { id: 'new-demo', label: '新示範件', group: 'file', enabled: idle, run: () => store.newDemo() },
  { id: 'open', label: '開啟舊檔', shortcut: 'Ctrl+O', group: 'file', enabled: idle, run: () => openFileDialog() },
  { id: 'save', label: '另存新檔', shortcut: 'Ctrl+S', group: 'file', enabled: idle, run: () => store.saveFile() },
  { id: 'export-step', label: '輸出 STEP', group: 'file', enabled: (s) => idle(s) && s.bootMs !== null, run: () => void store.exportStep() },

  { id: 'extrude', label: '伸長填料/基材', group: 'feature', enabled: sketchSelected, run: () => store.newExtrude('boss') },
  { id: 'revolve', label: '旋轉填料/基材', group: 'feature', enabled: sketchSelected, run: () => store.newRevolve('boss') },
  { id: 'extrude-cut', label: '伸長除料', group: 'feature', enabled: (s) => sketchSelected(s) && !!s.result?.mesh, run: () => store.newExtrude('cut') },
  { id: 'revolve-cut', label: '旋轉除料', group: 'feature', enabled: (s) => sketchSelected(s) && !!s.result?.mesh, run: () => store.newRevolve('cut') },
  { id: 'fillet', label: '圓角', group: 'feature', enabled: hasBody, run: () => store.newFillet() },
  { id: 'chamfer', label: '導角', group: 'feature', enabled: hasBody, run: () => store.newChamfer() },

  {
    id: 'sketch',
    label: '草圖',
    group: 'sketch',
    enabled: (s) => idle(s) && sketchPlane(s) !== null,
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

  { id: 'undo', label: '復原', shortcut: 'Ctrl+Z', group: 'edit', enabled: (s) => s.canUndo, run: () => store.undo() },
  { id: 'redo', label: '重做', shortcut: 'Ctrl+Y', group: 'edit', enabled: (s) => s.canRedo, run: () => store.redo() },
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

function openFileDialog(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) void store.openFile(file);
  };
  input.click();
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
    if (s.editing?.kind === 'sketch') {
      // Inside a sketch, Esc ends the current tool and Delete removes the selection (SolidWorks);
      // leaving the sketch is the confirmation corner or 「離開草圖」.
      if (e.key === 'Escape') return void store.sketcher?.escape();
      if (e.key === 'Delete') return void store.sketcher?.deleteSelection();
    } else if (s.editing) {
      if (e.key === 'Enter') return void store.commitEdit();
      if (e.key === 'Escape') return void store.cancelEdit();
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
