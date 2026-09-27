import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer';
import type { PartDoc } from './schema';
import { mutate, type Command } from './commands';

enablePatches();

interface Step {
  label: string;
  patches: Patch[];
  inverse: Patch[];
}

type Listener = (doc: PartDoc) => void;

/**
 * Undo/redo over the SSOT (B7.2) with edit sessions (B7.3):
 * a PropertyManager session is one transaction — OK commits one undo step, Cancel restores.
 */
export class DocHistory {
  private current: PartDoc;
  private undoStack: Step[] = [];
  private redoStack: Step[] = [];
  private tx: Step | null = null;
  private listeners = new Set<Listener>();

  constructor(doc: PartDoc) {
    this.current = doc;
  }

  get doc(): PartDoc {
    return this.current;
  }

  get canUndo(): boolean {
    return this.tx === null && this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.tx === null && this.redoStack.length > 0;
  }

  get inTransaction(): boolean {
    return this.tx !== null;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Applies a command; throws CommandError without changing anything if it is invalid. */
  execute(cmd: Command, label: string = cmd.type): void {
    const [next, patches, inverse] = produceWithPatches(this.current, (d) => mutate(d, cmd));
    if (patches.length === 0) return;
    this.current = next;
    if (this.tx) {
      this.tx.patches.push(...patches);
      this.tx.inverse.unshift(...inverse);
    } else {
      this.undoStack.push({ label, patches, inverse });
      this.redoStack = [];
    }
    this.emit();
  }

  begin(label: string): void {
    if (this.tx) throw new Error('已有進行中的編輯');
    this.tx = { label, patches: [], inverse: [] };
  }

  commit(): void {
    const tx = this.tx;
    if (!tx) return;
    this.tx = null;
    if (tx.patches.length > 0) {
      this.undoStack.push(tx);
      this.redoStack = [];
    }
    this.emit();
  }

  rollback(): void {
    const tx = this.tx;
    if (!tx) return;
    this.tx = null;
    this.current = applyPatches(this.current, tx.inverse);
    this.emit();
  }

  undo(): void {
    if (!this.canUndo) return;
    const step = this.undoStack.pop()!;
    this.current = applyPatches(this.current, step.inverse);
    this.redoStack.push(step);
    this.emit();
  }

  redo(): void {
    if (!this.canRedo) return;
    const step = this.redoStack.pop()!;
    this.current = applyPatches(this.current, step.patches);
    this.undoStack.push(step);
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.current);
  }
}
