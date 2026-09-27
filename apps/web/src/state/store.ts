import * as Comlink from 'comlink';
import { useSyncExternalStore } from 'react';
import {
  CommandError,
  createDemoPart,
  DocHistory,
  FormatError,
  parsePart,
  serializePart,
  type Command,
  type Id,
  type PartDoc,
} from '@3db/model';
import { stepFileName } from '@3db/io';
import type { Viewer } from '@3db/render';
import type { KernelApi, RebuildPayload } from '../worker/protocol';

export interface EditSession {
  featureId: Id;
}

export interface Notice {
  kind: 'error' | 'info';
  text: string;
}

/**
 * UI state. The document inside DocHistory is the only source of truth for the design;
 * everything else here is session state (selection, edit session) or derived data (result).
 */
export interface UiState {
  doc: PartDoc;
  canUndo: boolean;
  canRedo: boolean;
  selected: Id | null;
  editing: EditSession | null;
  result: RebuildPayload | null;
  rebuilding: boolean;
  bootMs: { occtMs: number; gcsMs: number } | null;
  bootError: string | null;
  notice: Notice | null;
}

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

class AppStore {
  private history = new DocHistory(createDemoPart());
  private api: Comlink.Remote<KernelApi>;
  private listeners = new Set<() => void>();
  private seq = 0;
  private inFlight = false;
  private pending = false;
  private state: UiState;
  /** The viewport registers itself so view actions (fit, standard views) can reach it. */
  viewer: Viewer | null = null;

  constructor() {
    const worker = new Worker(new URL('../worker/kernel.worker.ts', import.meta.url), { type: 'module' });
    this.api = Comlink.wrap<KernelApi>(worker);
    this.state = {
      doc: this.history.doc,
      canUndo: false,
      canRedo: false,
      selected: null,
      editing: null,
      result: null,
      rebuilding: false,
      bootMs: null,
      bootError: null,
      notice: null,
    };
    this.history.subscribe(() => this.onDocChanged());
    this.api.init().then(
      (bootMs) => this.set({ bootMs }),
      (e: unknown) => this.set({ bootError: e instanceof Error ? e.message : String(e) }),
    );
    this.requestRebuild();
  }

  getState = (): UiState => this.state;

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private set(patch: Partial<UiState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  private onDocChanged(): void {
    this.set({ doc: this.history.doc, canUndo: this.history.canUndo, canRedo: this.history.canRedo });
    this.requestRebuild();
  }

  // ------------------------------------------------------------ document commands (B7.1)

  execute(cmd: Command): boolean {
    try {
      this.history.execute(cmd);
      if (this.state.notice?.kind === 'error') this.set({ notice: null });
      return true;
    } catch (e) {
      this.set({ notice: { kind: 'error', text: e instanceof CommandError ? e.message : String(e) } });
      return false;
    }
  }

  undo(): void {
    this.history.undo();
  }

  redo(): void {
    this.history.redo();
  }

  select(id: Id | null): void {
    this.set({ selected: id });
  }

  // ------------------------------------------------------------ edit sessions (B7.3, D2.3)

  beginEdit(featureId: Id): void {
    if (this.state.editing) this.commitEdit();
    this.history.begin(`編輯 ${featureId}`);
    this.set({ editing: { featureId }, selected: featureId });
    this.requestRebuild();
  }

  commitEdit(): void {
    if (!this.state.editing) return;
    this.history.commit();
    this.set({ editing: null, canUndo: this.history.canUndo, canRedo: this.history.canRedo });
    this.requestRebuild();
  }

  cancelEdit(): void {
    if (!this.state.editing) return;
    this.history.rollback();
    this.set({ editing: null, canUndo: this.history.canUndo, canRedo: this.history.canRedo });
    this.requestRebuild();
  }

  /**
   * Fillet edge list (D2.1): clicking an edge toggles it, like the SolidWorks selection box.
   * The picked edge is stored as persistent name + fingerprint, never as an index (H3).
   */
  toggleFilletEdge(edgeIndex: number): void {
    const e = this.state.editing;
    const r = this.state.result;
    if (!e || !r || edgeIndex < 0) return;
    const f = this.history.doc.features.find((x) => x.id === e.featureId);
    if (f?.type !== 'fillet') return;
    const name = r.edgeNames[edgeIndex];
    const fingerprint = r.edgeFingerprints[edgeIndex];
    if (!name || !fingerprint) return;
    const exists = f.edges.some((x) => x.name === name);
    const edges = exists ? f.edges.filter((x) => x.name !== name) : [...f.edges, { kind: 'edge' as const, name, fingerprint }];
    this.execute({ type: 'setFilletEdges', featureId: f.id, edges });
  }

  /** While editing a fillet, show the model before it so its input edges can be picked. */
  private until(): number | undefined {
    const e = this.state.editing;
    if (!e) return undefined;
    const i = this.history.doc.features.findIndex((f) => f.id === e.featureId);
    return this.history.doc.features[i]?.type === 'fillet' ? i : undefined;
  }

  // ------------------------------------------------------------ rebuild (B3.5: off the UI thread)

  rebuild(): void {
    this.requestRebuild();
  }

  private requestRebuild(): void {
    if (this.inFlight) {
      this.pending = true;
      return;
    }
    void this.run();
  }

  private async run(): Promise<void> {
    this.inFlight = true;
    const seq = ++this.seq;
    this.set({ rebuilding: true });
    try {
      const until = this.until();
      const result = await this.api.rebuild({ seq, doc: this.history.doc, ...(until === undefined ? {} : { until }) });
      if (result.seq === this.seq) this.set({ result });
    } catch (e) {
      this.set({ notice: { kind: 'error', text: `重新計算失敗：${e instanceof Error ? e.message : String(e)}` } });
    } finally {
      this.inFlight = false;
      if (this.pending) {
        this.pending = false;
        void this.run();
      } else {
        this.set({ rebuilding: false });
      }
    }
  }

  // ------------------------------------------------------------ files (F1.1, F7.1)

  async exportStep(): Promise<void> {
    try {
      const text = await this.api.exportStep(this.history.doc);
      download(stepFileName(this.history.doc), text, 'application/step');
      this.set({ notice: { kind: 'info', text: `已輸出 ${stepFileName(this.history.doc)}` } });
    } catch (e) {
      this.set({ notice: { kind: 'error', text: `STEP 輸出失敗：${e instanceof Error ? e.message : String(e)}` } });
    }
  }

  saveFile(): void {
    const name = (this.history.doc.properties['零件名稱'] || 'part').replace(/[\\/:*?"<>|]+/g, '_');
    download(`${name}.3db.json`, serializePart(this.history.doc), 'application/json');
  }

  async openFile(file: File): Promise<void> {
    try {
      this.load(parsePart(await file.text()));
      this.set({ notice: { kind: 'info', text: `已開啟 ${file.name}` } });
    } catch (e) {
      this.set({ notice: { kind: 'error', text: e instanceof FormatError ? e.message : `無法開啟：${String(e)}` } });
    }
  }

  newDemo(): void {
    this.load(createDemoPart());
  }

  private load(doc: PartDoc): void {
    if (this.state.editing) this.cancelEdit();
    this.history = new DocHistory(doc);
    this.history.subscribe(() => this.onDocChanged());
    this.set({ selected: null, result: null });
    this.onDocChanged();
    this.viewer?.fitAll();
  }

  dismissNotice(): void {
    this.set({ notice: null });
  }
}

export const store = new AppStore();

export function useStore<T>(selector: (s: UiState) => T): T {
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}
