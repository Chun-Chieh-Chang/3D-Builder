import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer';
import type { PartDoc } from './schema';
import { mutate, type Command } from './commands';

enablePatches();

interface Step {
  label: string;
  patches: Patch[];
  inverse: Patch[];
}

/** An open edit session: its own undo/redo stack, collapsed into one step on commit. */
interface Transaction {
  label: string;
  steps: Step[];
  redo: Step[];
  /** Steps that started the session (e.g. inserting a new sketch); undo inside the session stops above them. */
  base: number;
}

type Listener = (doc: PartDoc) => void;

function merge(label: string, steps: Step[]): Step {
  return {
    label,
    patches: steps.flatMap((s) => s.patches),
    inverse: steps
      .slice()
      .reverse()
      .flatMap((s) => s.inverse),
  };
}

/**
 * Undo/redo over the SSOT (B7.2) with edit sessions (B7.3). Inside a session (a PropertyManager
 * or a sketch), undo/redo step through the session's own commands, like SolidWorks inside a sketch;
 * OK commits the whole session as one undo step, Cancel restores the document as it was.
 */
export class DocHistory {
  private current: PartDoc;
  private undoStack: Step[] = [];
  private redoStack: Step[] = [];
  private tx: Transaction | null = null;
  private listeners = new Set<Listener>();

  constructor(doc: PartDoc) {
    this.current = doc;
  }

  get doc(): PartDoc {
    return this.current;
  }

  get canUndo(): boolean {
    return this.tx ? this.tx.steps.length > this.tx.base : this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.tx ? this.tx.redo.length > 0 : this.redoStack.length > 0;
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
    const step = { label, patches, inverse };
    if (this.tx) {
      this.tx.steps.push(step);
      this.tx.redo = [];
    } else {
      this.undoStack.push(step);
      this.redoStack = [];
    }
    this.emit();
  }

  begin(label: string): void {
    if (this.tx) throw new Error('已有進行中的編輯');
    this.tx = { label, steps: [], redo: [], base: 0 };
  }

  /** Makes the commands executed so far part of starting the session: Cancel still removes them, undo does not. */
  markSessionBase(): void {
    if (this.tx) this.tx.base = this.tx.steps.length;
  }

  commit(): void {
    const tx = this.tx;
    if (!tx) return;
    this.tx = null;
    if (tx.steps.length > 0) {
      this.undoStack.push(merge(tx.label, tx.steps));
      this.redoStack = [];
    }
    this.emit();
  }

  rollback(): void {
    const tx = this.tx;
    if (!tx) return;
    this.tx = null;
    this.current = applyPatches(this.current, merge(tx.label, tx.steps).inverse);
    this.emit();
  }

  undo(): void {
    if (!this.canUndo) return;
    const [from, to] = this.tx ? [this.tx.steps, this.tx.redo] : [this.undoStack, this.redoStack];
    const step = from.pop()!;
    this.current = applyPatches(this.current, step.inverse);
    to.push(step);
    this.emit();
  }

  redo(): void {
    if (!this.canRedo) return;
    const [from, to] = this.tx ? [this.tx.redo, this.tx.steps] : [this.redoStack, this.undoStack];
    const step = from.pop()!;
    this.current = applyPatches(this.current, step.patches);
    to.push(step);
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.current);
  }
}
