import { store, type UiState } from './state/store';

/**
 * UI action registry (D3.1): the single definition of every command's label, shortcut and
 * enablement. Toolbars, menus and keyboard handling all read from here.
 */
export interface UiAction {
  id: string;
  label: string;
  shortcut?: string;
  group: 'file' | 'edit' | 'view';
  enabled(s: UiState): boolean;
  run(): void;
}

const idle = (s: UiState) => s.editing === null;

export const ACTIONS: UiAction[] = [
  { id: 'new-demo', label: '新示範件', group: 'file', enabled: idle, run: () => store.newDemo() },
  { id: 'open', label: '開啟舊檔', shortcut: 'Ctrl+O', group: 'file', enabled: idle, run: () => openFileDialog() },
  { id: 'save', label: '另存新檔', shortcut: 'Ctrl+S', group: 'file', enabled: idle, run: () => store.saveFile() },
  { id: 'export-step', label: '輸出 STEP', group: 'file', enabled: (s) => idle(s) && s.bootMs !== null, run: () => void store.exportStep() },
  { id: 'undo', label: '復原', shortcut: 'Ctrl+Z', group: 'edit', enabled: (s) => s.canUndo, run: () => store.undo() },
  { id: 'redo', label: '重做', shortcut: 'Ctrl+Y', group: 'edit', enabled: (s) => s.canRedo, run: () => store.redo() },
  { id: 'rebuild', label: '重新計算', shortcut: 'Ctrl+B', group: 'edit', enabled: () => true, run: () => store.rebuild() },
  { id: 'fit', label: '全部顯示', shortcut: 'F', group: 'view', enabled: () => true, run: () => store.viewer?.fitAll() },
  { id: 'view-front', label: '前視', shortcut: 'Ctrl+1', group: 'view', enabled: () => true, run: () => store.viewer?.setView('front') },
  { id: 'view-top', label: '上視', shortcut: 'Ctrl+5', group: 'view', enabled: () => true, run: () => store.viewer?.setView('top') },
  { id: 'view-right', label: '右視', shortcut: 'Ctrl+4', group: 'view', enabled: () => true, run: () => store.viewer?.setView('right') },
  { id: 'view-iso', label: '等角', shortcut: 'Ctrl+7', group: 'view', enabled: () => true, run: () => store.viewer?.setView('iso') },
];

export const action = (id: string): UiAction => {
  const a = ACTIONS.find((x) => x.id === id);
  if (!a) throw new Error(`unknown action ${id}`);
  return a;
};

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
    if (s.editing && e.key === 'Enter') return void store.commitEdit();
    if (s.editing && e.key === 'Escape') return void store.cancelEdit();
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
