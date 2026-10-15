import { t } from '@3db/i18n';
import { applyPatches, enablePatches, produceWithPatches, type Draft, type Patch } from 'immer';
import type { AssemblyDoc, PartDoc } from './schema';
import { mutate, type Command } from './commands';
import { mutateAssembly, type AssemblyCommand } from './assembly';
import { mutateDrawing, type DrawingCommand, type DrawingDoc } from './drawing';

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

/** A step that replaces the whole document, forward and back. */
function snapshot<D>(label: string, from: D, to: D): Step {
  return { label, patches: [{ op: 'replace', path: [], value: to }], inverse: [{ op: 'replace', path: [], value: from }] };
}

/**
 * Undo/redo over the SSOT (B7.2) with edit sessions (B7.3), for any document and its commands. Inside
 * a session (a PropertyManager or a sketch), undo/redo step through the session's own commands, like
 * SolidWorks inside a sketch; OK commits the whole session as one undo step, Cancel restores the
 * document as it was.
 */
export class History<D, C extends { type: string }> {
  private current: D;
  private undoStack: Step[] = [];
  private redoStack: Step[] = [];
  private tx: Transaction | null = null;
  private listeners = new Set<(doc: D) => void>();

  constructor(
    doc: D,
    private readonly recipe: (draft: Draft<D>, cmd: C) => void,
  ) {
    this.current = doc;
  }

  get doc(): D {
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

  subscribe(fn: (doc: D) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Applies a command; throws CommandError without changing anything if it is invalid. */
  execute(cmd: C, label: string = cmd.type): void {
    const [next, patches, inverse] = produceWithPatches(this.current, (d: Draft<D>) => this.recipe(d, cmd));
    if (patches.length === 0) return;
    this.current = next as D;
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

  /**
   * Applies a command as part of the last step rather than as a step of its own: undoing that step undoes both. With no step to undo, it becomes part of the
   * document as it started. For what the program does by itself to finish a step the user took — a new drawing's 最適比例 once its views are drawn (ADR 0147).
   * Throws CommandError without changing anything if the command is invalid.
   */
  amend(cmd: C): void {
    const [next, patches, inverse] = produceWithPatches(this.current, (d: Draft<D>) => this.recipe(d, cmd));
    if (patches.length === 0) return;
    this.current = next as D;
    const steps = this.tx ? this.tx.steps : this.undoStack;
    const last = steps.at(-1);
    if (last) steps[steps.length - 1] = merge(last.label, [last, { label: last.label, patches, inverse }]);
    // what redo would bring back was recorded on the document without this change
    if (this.tx) this.tx.redo = [];
    else this.redoStack = [];
    this.emit();
  }

  begin(label: string): void {
    if (this.tx) throw new Error(t('history.busy'));
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
    this.current = applyPatches(this.current as object, merge(tx.label, tx.steps).inverse) as D;
    this.emit();
  }

  undo(): void {
    if (!this.canUndo) return;
    const [from, to] = this.tx ? [this.tx.steps, this.tx.redo] : [this.undoStack, this.redoStack];
    const step = from.pop()!;
    this.current = applyPatches(this.current as object, step.inverse) as D;
    to.push(step);
    this.emit();
  }

  redo(): void {
    if (!this.canRedo) return;
    const [from, to] = this.tx ? [this.tx.redo, this.tx.steps] : [this.redoStack, this.undoStack];
    const step = from.pop()!;
    this.current = applyPatches(this.current as object, step.patches) as D;
    to.push(step);
    this.emit();
  }

  /**
   * Rewrites the document and every state undo or redo can reach with `fn`, keeping the steps and
   * their labels: e.g. file paths after an assembly was saved into another folder (B9.4). Each step
   * then replaces the whole document. Not while an edit session is open.
   */
  rebase(fn: (doc: D) => D): void {
    if (this.tx) throw new Error(t('history.noRewrite'));
    const apply = (doc: D, patches: Patch[]) => applyPatches(doc as object, patches) as D;
    // past[i] is the state before undoStack[i]; the last one is the current document.
    const past: D[] = [this.current];
    for (let i = this.undoStack.length - 1; i >= 0; i--) past.unshift(apply(past[0]!, this.undoStack[i]!.inverse));
    // future[k] is the state after the k-th next redo (the top of the redo stack comes first).
    const future: D[] = [];
    for (let i = this.redoStack.length - 1; i >= 0; i--) future.push(apply(future.at(-1) ?? this.current, this.redoStack[i]!.patches));
    const p = past.map(fn);
    const f = future.map(fn);
    this.undoStack = this.undoStack.map((s, i) => snapshot(s.label, p[i]!, p[i + 1]!));
    const n = this.redoStack.length;
    this.redoStack = this.redoStack.map((s, i) => {
      const k = n - 1 - i;
      return snapshot(s.label, k === 0 ? p.at(-1)! : f[k - 1]!, f[k]!);
    });
    this.current = p.at(-1)!;
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.current);
  }
}

/** Undo/redo of a part. */
export class DocHistory extends History<PartDoc, Command> {
  constructor(doc: PartDoc) {
    super(doc, mutate);
  }
}

/** Undo/redo of an assembly. */
export class AssemblyHistory extends History<AssemblyDoc, AssemblyCommand> {
  constructor(doc: AssemblyDoc) {
    super(doc, mutateAssembly);
  }
}

/** Undo/redo of a drawing. */
export class DrawingHistory extends History<DrawingDoc, DrawingCommand> {
  constructor(doc: DrawingDoc) {
    super(doc, mutateDrawing);
  }
}

