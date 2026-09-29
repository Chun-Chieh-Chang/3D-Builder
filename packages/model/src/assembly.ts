import { produce, type Draft } from 'immer';
import { countersFor, type Id } from './ids';
import { CommandError } from './commands';
import { isFilePath, joinPath, relativePath } from './paths';
import { isValidPose } from './pose';
import { ASSEMBLY_SCHEMA_VERSION, type AssemblyDoc, type Component, type FileRef, type Pose } from './schema';

/**
 * Assembly commands (B7.1): the only way to change an assembly document. As with parts, new objects
 * carry their ids, so applying a command is a pure function.
 */
export type AssemblyCommand =
  /** Inserts a component (C15.1), together with its file when the assembly does not use that file yet. */
  | { type: 'insertComponent'; component: Component; file?: FileRef }
  | { type: 'setFixed'; componentIds: Id[]; value: boolean }
  | { type: 'setPlacement'; componentId: Id; placement: Pose }
  /** Deletes components. Files no component uses any more go too; all their ids stay issued. */
  | { type: 'deleteComponents'; componentIds: Id[] };

export function createEmptyAssembly(): AssemblyDoc {
  return { kind: 'assembly', schemaVersion: ASSEMBLY_SCHEMA_VERSION, files: [], components: [], properties: {}, idCounters: {} };
}

export function assemblyIdsInUse(doc: AssemblyDoc): Id[] {
  return [...doc.files.map((f) => f.id), ...doc.components.map((c) => c.id)];
}

/** The instance number for another component of a file: one above the highest in use. */
export function nextInstance(doc: AssemblyDoc, fileId: Id): number {
  return Math.max(0, ...doc.components.filter((c) => c.file === fileId).map((c) => c.instance)) + 1;
}

/**
 * The same files seen from another folder: the assembly was saved into `to` after its paths were
 * written relative to `from` (both relative to the project folder).
 */
export function relocateAssembly(doc: AssemblyDoc, from: string, to: string): AssemblyDoc {
  if (from === to) return doc;
  return produce(doc, (d) => {
    for (const f of d.files) f.path = relativePath(to, joinPath(from, f.path));
  });
}

function componentOf(draft: Draft<AssemblyDoc>, id: Id): Draft<Component> {
  const c = draft.components.find((x) => x.id === id);
  if (!c) throw new CommandError(`找不到零組件：${id}`);
  return c;
}

function placement(pose: Pose): void {
  if (!isValidPose(pose)) throw new CommandError('零組件的位置或方向無效');
}

/** Immer recipe: mutates the draft or throws CommandError, leaving the document untouched. */
export function mutateAssembly(draft: Draft<AssemblyDoc>, cmd: AssemblyCommand): void {
  switch (cmd.type) {
    case 'insertComponent': {
      const { component: c, file } = cmd;
      const fresh = file ? [c.id, file.id] : [c.id];
      const inUse = new Set(assemblyIdsInUse(draft as AssemblyDoc));
      for (const id of fresh) if (!id || inUse.has(id)) throw new CommandError(`ID 已被使用：${id}`);
      if (file) {
        if (file.id === c.id) throw new CommandError(`ID 已被使用：${file.id}`);
        if (!isFilePath(file.path)) throw new CommandError(`檔案路徑無效：「${file.path}」`);
        if (draft.files.some((f) => f.path === file.path)) throw new CommandError(`組合件已經使用這個檔案：${file.path}`);
        if (c.file !== file.id) throw new CommandError('零組件必須使用一起加入的檔案');
      } else if (!draft.files.some((f) => f.id === c.file)) {
        throw new CommandError(`找不到零組件的檔案：${c.file}`);
      }
      if (!Number.isInteger(c.instance) || c.instance < 1) throw new CommandError(`實例編號無效：${c.instance}`);
      if (draft.components.some((x) => x.file === c.file && x.instance === c.instance)) throw new CommandError(`實例編號 <${c.instance}> 已被使用`);
      placement(c.placement);
      if (file) draft.files.push(file);
      draft.components.push(c as Draft<Component>);
      countersFor(fresh, draft.idCounters);
      return;
    }
    case 'setFixed': {
      const targets = cmd.componentIds.map((id) => componentOf(draft, id)); // all exist, or nothing changes
      for (const c of targets) c.fixed = cmd.value;
      return;
    }
    case 'setPlacement': {
      const c = componentOf(draft, cmd.componentId);
      placement(cmd.placement);
      c.placement = cmd.placement as Draft<Pose>;
      return;
    }
    case 'deleteComponents': {
      const ids = new Set(cmd.componentIds);
      for (const id of ids) componentOf(draft, id);
      if (ids.size === 0) return;
      countersFor([...ids, ...draft.files.map((f) => f.id)], draft.idCounters); // deleted ids are never handed out again
      draft.components = draft.components.filter((c) => !ids.has(c.id));
      const used = new Set(draft.components.map((c) => c.file));
      draft.files = draft.files.filter((f) => used.has(f.id));
      return;
    }
  }
}

/** Pure command application: returns a new document, the input is never modified. */
export function applyAssemblyCommand(doc: AssemblyDoc, cmd: AssemblyCommand): AssemblyDoc {
  return produce(doc, (d) => mutateAssembly(d, cmd));
}
