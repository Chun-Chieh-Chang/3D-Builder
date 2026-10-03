import { produce, type Draft } from 'immer';
import { t } from '@3db/i18n';
import { countersFor, type Id } from './ids';
import { CommandError } from './commands';
import { evalAngle, evalLength, ExprError } from './expr';
import { isFilePath, joinPath, relativePath } from './paths';
import { isValidPose } from './pose';
import { componentPatternProblem } from './componentPatterns';
import { explodeStepProblem } from './explosion';
import { ASSEMBLY_SCHEMA_VERSION, type AssemblyDoc, type Component, type ComponentPattern, type ExplodeStep, type FileRef, type Mate, type MateRef, type MateType, type Pose } from './schema';

/**
 * Assembly commands (B7.1): the only way to change an assembly document. As with parts, new objects
 * carry their ids, so applying a command is a pure function.
 */
export type AssemblyCommand =
  /** Inserts a component (C15.1), together with its file when the assembly does not use that file yet. */
  | { type: 'insertComponent'; component: Component; file?: FileRef }
  | { type: 'setFixed'; componentIds: Id[]; value: boolean }
  /**
   * Hides, suppresses or makes see-through some components (C15.5). Hidden: not shown, still solved. Suppressed: left out of
   * the assembly (not solved, not exported, their mates suppressed). Transparent: display only. `false` clears the flag,
   * so a component with none writes none.
   */
  | { type: 'setComponentState'; componentIds: Id[]; state: ComponentState; value: boolean }
  /** Where components are placed (C15.3): one step for all of them, e.g. every part a drag moved. */
  | { type: 'setPlacements'; placements: { componentId: Id; placement: Pose }[] }
  /**
   * Points a file entry at another file (B9.4): a part file renamed, moved, or saved in another form.
   * Every component of the file follows. When the assembly already uses that file, its components
   * join that entry, renumbered where their instance numbers are taken.
   */
  | { type: 'relinkFile'; fileId: Id; path: string }
  /** Deletes components and the mates on them (as SolidWorks does). Files no component uses any more go too; all their ids stay issued. */
  | { type: 'deleteComponents'; componentIds: Id[] }
  /** Adds a mate at the end of the mates folder (C15.8). */
  | { type: 'insertMate'; mate: Mate }
  /** Replaces a mate's definition, e.g. from its PropertyManager (C15.12). */
  | { type: 'setMate'; mate: Mate }
  | { type: 'deleteMates'; mateIds: Id[] }
  | { type: 'setMatesSuppressed'; mateIds: Id[]; value: boolean }
  /** Adds a pattern or mirror of a component (C15.13): the definition only, the instances are derived. */
  | { type: 'insertPattern'; pattern: ComponentPattern }
  | { type: 'setPattern'; pattern: ComponentPattern }
  | { type: 'deletePatterns'; patternIds: Id[] }
  /** The steps of the exploded view (C15.14): the definition only; no pose changes. */
  | { type: 'insertExplodeStep'; step: ExplodeStep }
  | { type: 'setExplodeStep'; step: ExplodeStep }
  | { type: 'deleteExplodeSteps'; stepIds: Id[] }
  /** Puts a step at another place in the list (they add up, so the order only matters for how they are read). */
  | { type: 'moveExplodeStep'; stepId: Id; to: number };

/** The flags of a component (C15.5). */
export type ComponentState = 'hidden' | 'suppressed' | 'transparent';

export function createEmptyAssembly(): AssemblyDoc {
  return { kind: 'assembly', schemaVersion: ASSEMBLY_SCHEMA_VERSION, files: [], components: [], mates: [], properties: {}, idCounters: {} };
}

export function assemblyIdsInUse(doc: AssemblyDoc): Id[] {
  return [...doc.files.map((f) => f.id), ...doc.components.map((c) => c.id), ...doc.mates.map((m) => m.id), ...(doc.patterns ?? []).map((p) => p.id), ...(doc.explosion ?? []).map((s) => s.id)];
}

const MATE_TYPES: MateType[] = ['coincident', 'parallel', 'perpendicular', 'tangent', 'concentric', 'lock', 'distance', 'angle', 'width', 'symmetric'];

/** Every element a mate joins: the two, and the further ones of a width or symmetric mate (C15.9). */
export const mateEnds = (m: Mate): MateRef[] => [m.a, m.b, ...(m.more ?? [])];

/** What a mate needs to be well formed; whether it can hold is for the solver. */
function checkMate(doc: AssemblyDoc, m: Mate): void {
  if (!m.name.trim()) throw new CommandError('名稱不可空白');
  if (!MATE_TYPES.includes(m.type)) throw new CommandError(`不明的結合類型：${m.type}`);
  for (const end of mateEnds(m)) {
    if (end.component !== null && !doc.components.some((c) => c.id === end.component)) throw new CommandError(`找不到零組件：${end.component}`);
    if (end.component === null && (end.ref.kind !== 'datum' || !/^(plane:(front|top|right)|origin)$/.test(end.ref.name))) {
      throw new CommandError('組合件本身只能選基準面或原點');
    }
    if (!end.ref.name) throw new CommandError('請選擇兩個要結合的元素');
    // Whether the component is a sub-assembly, and the path leads to a part in it, is for the solver: the file is not read here.
    if (end.path !== undefined) {
      if (end.component === null) throw new CommandError(t('subassembly.pathNeedsComponent'));
      if (end.path.length === 0 || end.path.some((id) => typeof id !== 'string' || id === '')) throw new CommandError(t('subassembly.badPath'));
    }
  }
  if (m.a.component === m.b.component) throw new CommandError('結合的兩個元素必須在不同的零組件上');
  if (m.align !== undefined && m.align !== 'aligned' && m.align !== 'antiAligned') throw new CommandError('對齊方式無效');
  // width and symmetric mates have more elements, the others have none (C15.9)
  const more = m.more?.length ?? 0;
  if (m.type === 'width') {
    if (more !== 2) throw new CommandError(t('mate.widthNeedsFour'));
    if (m.more![0]!.component !== m.a.component || m.more![1]!.component !== m.b.component) throw new CommandError(t('mate.widthSameComponent'));
  } else if (m.type === 'symmetric') {
    if (more !== 1) throw new CommandError(t('mate.symmetricNeedsPlane'));
  } else if (m.more !== undefined) throw new CommandError(t('mate.noMore'));
  if ((m.min !== undefined || m.max !== undefined) && m.type !== 'distance' && m.type !== 'angle') throw new CommandError(t('mate.limitOnlyDistanceAngle'));
  if (m.type === 'distance' || m.type === 'angle') {
    if (m.value === undefined) throw new CommandError(`${m.type === 'distance' ? '距離' : '角度'}結合需要數值`);
    let v: number;
    try {
      v = m.type === 'distance' ? evalLength(m.value) : evalAngle(m.value);
    } catch (e) {
      throw new CommandError(e instanceof ExprError ? e.message : String(e));
    }
    if (m.type === 'distance' && !(v >= 0)) throw new CommandError(`距離不可為負：「${m.value}」`);
    if (m.type === 'angle' && !(v >= 0 && v <= Math.PI + 1e-12)) throw new CommandError(`角度必須在 0° 到 180° 之間：「${m.value}」`);
    // the limits (C15.9): numbers of the same kind, the least not above the greatest, and the value between them
    const limit = (e: string | undefined): number | undefined => {
      if (e === undefined) return undefined;
      try {
        return m.type === 'distance' ? evalLength(e) : evalAngle(e);
      } catch (err) {
        throw new CommandError(err instanceof ExprError ? err.message : String(err));
      }
    };
    const lo = limit(m.min);
    const hi = limit(m.max);
    if (lo !== undefined && !(lo >= 0)) throw new CommandError(t('mate.limitNegative', { value: String(m.min) }));
    if (m.type === 'angle' && hi !== undefined && !(hi <= Math.PI + 1e-12)) throw new CommandError(t('mate.limitAngleRange', { value: String(m.max) }));
    if (lo !== undefined && hi !== undefined && lo > hi + 1e-12) throw new CommandError(t('mate.limitOrder', { min: String(m.min), max: String(m.max) }));
    if ((lo !== undefined && v < lo - 1e-9) || (hi !== undefined && v > hi + 1e-9)) throw new CommandError(t('mate.valueOutsideLimits', { value: String(m.value) }));
  } else if (m.value !== undefined) {
    throw new CommandError('只有距離與角度結合有數值');
  }
  if (m.type === 'lock' ? !m.relative || !isValidPose(m.relative) : m.relative !== undefined) throw new CommandError('鎖住結合需要有效的相對位置');
}

/** What a pattern needs to be well formed: a name, a seed that is there, axes that are elements of components that are there, numbers that read. Whether its axes can be found is for whoever sees the geometry. */
function checkPattern(doc: AssemblyDoc, p: ComponentPattern): void {
  if (!p.name.trim()) throw new CommandError(t('pattern.nameEmpty'));
  if (!doc.components.some((c) => c.id === p.seed)) throw new CommandError(t('pattern.noSeed', { id: p.seed }));
  for (const a of [p.axis1, p.axis2]) {
    if (a?.kind === 'ref' && (a.ref.component === null || !doc.components.some((c) => c.id === a.ref.component))) throw new CommandError(t('pattern.noSeed', { id: String(a.ref.component) }));
  }
  const problem = componentPatternProblem(p);
  if (problem) throw new CommandError(problem);
}
function mateOf(draft: Draft<AssemblyDoc>, id: Id): Draft<Mate> {
  const m = draft.mates.find((x) => x.id === id);
  if (!m) throw new CommandError(`找不到結合：${id}`);
  return m;
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
    case 'setComponentState': {
      if (cmd.state !== 'hidden' && cmd.state !== 'suppressed' && cmd.state !== 'transparent') throw new CommandError(t('subassembly.badState', { state: String(cmd.state) }));
      const targets = cmd.componentIds.map((id) => componentOf(draft, id)); // all exist, or nothing changes
      for (const c of targets) {
        if (cmd.value) c[cmd.state] = true;
        else delete c[cmd.state];
      }
      return;
    }
    case 'setPlacements': {
      const targets = cmd.placements.map((p) => {
        placement(p.placement);
        return [componentOf(draft, p.componentId), p.placement] as const;
      }); // all valid, or nothing changes
      for (const [c, pose] of targets) c.placement = pose as Draft<Pose>;
      return;
    }
    case 'relinkFile': {
      const file = draft.files.find((f) => f.id === cmd.fileId);
      if (!file) throw new CommandError(`找不到檔案：${cmd.fileId}`);
      if (!isFilePath(cmd.path)) throw new CommandError(`檔案路徑無效：「${cmd.path}」`);
      if (file.path === cmd.path) return;
      const other = draft.files.find((f) => f.path === cmd.path);
      if (!other) {
        file.path = cmd.path;
        return;
      }
      // Instance numbers already taken there go to numbers above all of them; the others are kept.
      const taken = new Set(draft.components.filter((c) => c.file === other.id).map((c) => c.instance));
      const moving = draft.components.filter((c) => c.file === file.id);
      for (const c of moving) c.file = other.id;
      let next = Math.max(...draft.components.filter((c) => c.file === other.id).map((c) => c.instance)) + 1;
      for (const c of moving) if (taken.has(c.instance)) c.instance = next++;
      countersFor([file.id], draft.idCounters); // its id is never handed out again
      draft.files = draft.files.filter((f) => f.id !== file.id);
      return;
    }
    case 'deleteComponents': {
      const ids = new Set(cmd.componentIds);
      for (const id of ids) componentOf(draft, id);
      if (ids.size === 0) return;
      countersFor([...ids, ...draft.files.map((f) => f.id), ...draft.mates.map((m) => m.id)], draft.idCounters); // deleted ids are never handed out again
      draft.components = draft.components.filter((c) => !ids.has(c.id));
      draft.mates = draft.mates.filter((m) => !mateEnds(m as Mate).some((e) => ids.has(e.component ?? '')));
      if (draft.patterns) {
        // a pattern of a deleted component goes with it, and so does one whose axis is an element of it (its instances would have no axis)
        const gone = draft.patterns.filter((p) => ids.has(p.seed) || [p.axis1, p.axis2].some((a) => a?.kind === 'ref' && ids.has(a.ref.component ?? '')));
        countersFor(gone.map((p) => p.id), draft.idCounters);
        draft.patterns = draft.patterns.filter((p) => !gone.includes(p));
        if (draft.patterns.length === 0) delete draft.patterns;
      }
      if (draft.explosion) {
        // a deleted component leaves the steps that moved it; a step left with none, or whose axis is an element of it, goes
        for (const s of draft.explosion) s.components = s.components.filter((id) => !ids.has(id));
        const gone = draft.explosion.filter((s) => s.components.length === 0 || (s.axis.kind === 'ref' && ids.has(s.axis.ref.component ?? '')));
        countersFor(gone.map((s) => s.id), draft.idCounters);
        draft.explosion = draft.explosion.filter((s) => !gone.includes(s));
        if (draft.explosion.length === 0) delete draft.explosion;
      }
      const used = new Set(draft.components.map((c) => c.file));
      draft.files = draft.files.filter((f) => used.has(f.id));
      return;
    }
    case 'insertMate': {
      if (!cmd.mate.id || assemblyIdsInUse(draft as AssemblyDoc).includes(cmd.mate.id)) throw new CommandError(`ID 已被使用：${cmd.mate.id}`);
      checkMate(draft as AssemblyDoc, cmd.mate);
      draft.mates.push(cmd.mate as Draft<Mate>);
      countersFor([cmd.mate.id], draft.idCounters);
      return;
    }
    case 'setMate': {
      const at = draft.mates.findIndex((m) => m.id === cmd.mate.id);
      if (at < 0) throw new CommandError(`找不到結合：${cmd.mate.id}`);
      checkMate(draft as AssemblyDoc, cmd.mate);
      draft.mates[at] = cmd.mate as Draft<Mate>;
      return;
    }
    case 'deleteMates': {
      const ids = new Set(cmd.mateIds);
      for (const id of ids) mateOf(draft, id);
      countersFor(ids, draft.idCounters);
      draft.mates = draft.mates.filter((m) => !ids.has(m.id));
      return;
    }
    case 'insertPattern': {
      const p = cmd.pattern;
      if (!p.id || assemblyIdsInUse(draft as AssemblyDoc).includes(p.id)) throw new CommandError(t('pattern.idInUse', { id: p.id }));
      checkPattern(draft as AssemblyDoc, p);
      (draft.patterns ??= []).push(p as Draft<ComponentPattern>);
      countersFor([p.id], draft.idCounters);
      return;
    }
    case 'setPattern': {
      const at = draft.patterns?.findIndex((x) => x.id === cmd.pattern.id) ?? -1;
      if (at < 0) throw new CommandError(t('pattern.notFound', { id: cmd.pattern.id }));
      checkPattern(draft as AssemblyDoc, cmd.pattern);
      draft.patterns![at] = cmd.pattern as Draft<ComponentPattern>;
      return;
    }
    case 'insertExplodeStep': {
      const s = cmd.step;
      if (!s.id || assemblyIdsInUse(draft as AssemblyDoc).includes(s.id)) throw new CommandError(t('pattern.idInUse', { id: s.id }));
      const problem = explodeStepProblem(s, draft as AssemblyDoc);
      if (problem) throw new CommandError(problem);
      (draft.explosion ??= []).push(s as Draft<ExplodeStep>);
      countersFor([s.id], draft.idCounters);
      return;
    }
    case 'setExplodeStep': {
      const at = draft.explosion?.findIndex((x) => x.id === cmd.step.id) ?? -1;
      if (at < 0) throw new CommandError(t('explode.notFound', { id: cmd.step.id }));
      const problem = explodeStepProblem(cmd.step, draft as AssemblyDoc);
      if (problem) throw new CommandError(problem);
      draft.explosion![at] = cmd.step as Draft<ExplodeStep>;
      return;
    }
    case 'deleteExplodeSteps': {
      const ids = new Set(cmd.stepIds);
      for (const id of ids) if (!draft.explosion?.some((s) => s.id === id)) throw new CommandError(t('explode.notFound', { id }));
      countersFor(ids, draft.idCounters);
      draft.explosion = draft.explosion!.filter((s) => !ids.has(s.id));
      if (draft.explosion.length === 0) delete draft.explosion;
      return;
    }
    case 'moveExplodeStep': {
      const list = draft.explosion;
      const from = list?.findIndex((x) => x.id === cmd.stepId) ?? -1;
      if (!list || from < 0) throw new CommandError(t('explode.notFound', { id: cmd.stepId }));
      if (!Number.isInteger(cmd.to) || cmd.to < 0 || cmd.to >= list.length) throw new CommandError(t('explode.badPlace'));
      const [moved] = list.splice(from, 1);
      list.splice(cmd.to, 0, moved!);
      return;
    }
    case 'deletePatterns': {
      const ids = new Set(cmd.patternIds);
      for (const id of ids) if (!draft.patterns?.some((p) => p.id === id)) throw new CommandError(t('pattern.notFound', { id }));
      countersFor(ids, draft.idCounters);
      draft.patterns = draft.patterns!.filter((p) => !ids.has(p.id));
      if (draft.patterns.length === 0) delete draft.patterns;
      return;
    }    case 'setMatesSuppressed': {
      const targets = cmd.mateIds.map((id) => mateOf(draft, id));
      for (const m of targets) m.suppressed = cmd.value;
      return;
    }
  }
}

/** Pure command application: returns a new document, the input is never modified. */
export function applyAssemblyCommand(doc: AssemblyDoc, cmd: AssemblyCommand): AssemblyDoc {
  return produce(doc, (d) => mutateAssembly(d, cmd));
}
