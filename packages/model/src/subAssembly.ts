import { t } from '@3db/i18n';
import { assemblyIdsInUse, createEmptyAssembly } from './assembly';
import { CommandError } from './commands';
import { countersFor, type Id } from './ids';
import { IDENTITY_ROTATION } from './pose';
import type { AssemblyDoc, Component, ExplodeStep, FileRef, Mate, MateRef, PatternAxis, Pose } from './schema';

/**
 * Forming a sub-assembly from some components of an assembly (C15.4, E-3): the components, and the mates among them, go into a new assembly file; the assembly keeps one
 * component for that file, at the origin (the sub-assembly's coordinates are the assembly's, so no part moves). What is pure is here: the two documents that come of it.
 * Writing the file and putting it in the history is the store's.
 */

export interface FormSubAssemblyOptions {
  /** The entry of the new file in the assembly (its id is new; its path is relative to the assembly, where the file is written). */
  file: FileRef;
  /** The id of the component that stands for the sub-assembly in the assembly (new). */
  componentId: Id;
  /** Where each of the components is now, as the mates put it: the sub-assembly starts from these, so that its mates hold at once and nothing moves. */
  placements?: ReadonlyMap<Id, Pose>;
}

const refsOf = (m: Mate): MateRef[] => [m.a, m.b, ...(m.more ?? [])];
const axisRefs = (a: PatternAxis | undefined): MateRef[] => (a?.kind === 'ref' ? [a.ref] : []);

/**
 * Why these components cannot be formed into a sub-assembly (null when they can): fewer than two, one that is not there, or one that a pattern or mirror is made of
 * (its instances are derived from it in the assembly, and are not worked out inside a sub-assembly).
 */
export function formSubAssemblyProblem(doc: AssemblyDoc, ids: readonly Id[]): string | null {
  const set = new Set(ids);
  if (set.size < 2) return t('subassembly.form.tooFew');
  for (const id of set) if (!doc.components.some((c) => c.id === id)) return t('subassembly.form.noComponent', { id });
  for (const p of doc.patterns ?? []) {
    if (set.has(p.seed) || [p.axis1, p.axis2].some((a) => axisRefs(a).some((r) => r.component !== null && set.has(r.component)))) return t('subassembly.form.pattern', { name: p.name });
  }
  return null;
}

/** The reference as the assembly now makes it: an element of a component that went into the sub-assembly is reached through it. */
function through(ref: MateRef, inside: ReadonlySet<Id>, sub: Id): MateRef {
  if (ref.component === null || !inside.has(ref.component)) return ref;
  return { ...ref, component: sub, path: [ref.component, ...(ref.path ?? [])] };
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/**
 * The assembly and the new sub-assembly that forming `ids` makes. In the sub-assembly: those components (the poses `placements` give, the first one fixed when none was, so that
 * it has something to stay by), the files they use, and the mates that have both ends on them. In the assembly: one component for the sub-assembly in place of the first of them,
 * fixed when any of them was; the mates that had an end elsewhere, each end that was on one of them now reached through the sub-assembly (`path`); the steps of every exploded view
 * naming them name the sub-assembly instead (once). Throws a `CommandError` for what `formSubAssemblyProblem` says, and for ids that are in use already.
 */
export function formSubAssembly(doc: AssemblyDoc, ids: readonly Id[], options: FormSubAssemblyOptions): { parent: AssemblyDoc; sub: AssemblyDoc } {
  const problem = formSubAssemblyProblem(doc, ids);
  if (problem) throw new CommandError(problem);
  const used = assemblyIdsInUse(doc);
  for (const id of [options.file.id, options.componentId]) if (used.includes(id)) throw new CommandError(t('pattern.idInUse', { id }));
  const inside = new Set(ids);
  const members = doc.components.filter((c) => inside.has(c.id));
  const sub = options.componentId;

  // the sub-assembly
  const base = members.find((c) => !c.suppressed) ?? members[0]!;
  const anchored = members.some((c) => c.fixed);
  const childDoc = createEmptyAssembly();
  const usedFiles = new Set(members.map((c) => c.file));
  childDoc.files = doc.files.filter((f) => usedFiles.has(f.id)).map((f) => ({ ...f }));
  childDoc.components = members.map((c) => ({ ...clone(c), placement: clone(options.placements?.get(c.id) ?? c.placement), fixed: c.fixed || (!anchored && c === base) }));
  const lies = (m: Mate) => refsOf(m).every((r) => r.component !== null && inside.has(r.component));
  childDoc.mates = doc.mates.filter(lies).map((m) => clone(m));
  countersFor([...childDoc.files.map((f) => f.id), ...childDoc.components.map((c) => c.id), ...childDoc.mates.map((m) => m.id)], childDoc.idCounters);

  // the assembly
  const parent = clone(doc);
  const first = parent.components.findIndex((c) => inside.has(c.id));
  const stand: Component = { id: sub, file: options.file.id, instance: 1, fixed: anchored, placement: { position: [0, 0, 0], rotation: [...IDENTITY_ROTATION] as Pose['rotation'] } };
  parent.components = parent.components.filter((c) => !inside.has(c.id));
  parent.components.splice(first, 0, stand);
  const stillUsed = new Set(parent.components.map((c) => c.file));
  parent.files = [...parent.files.filter((f) => stillUsed.has(f.id) && f.id !== options.file.id), { ...options.file }];
  parent.mates = parent.mates.filter((m) => !lies(m)).map((m) => ({
    ...m,
    a: through(m.a, inside, sub),
    b: through(m.b, inside, sub),
    ...(m.more ? { more: m.more.map((r) => through(r, inside, sub)) } : {}),
  }));
  for (const view of parent.explosions ?? []) {
    view.steps = view.steps.map((s): ExplodeStep => {
      const moved = [...new Set(s.components.map((id) => (inside.has(id) ? sub : id)))];
      return { ...s, components: moved, axis: s.axis.kind === 'ref' ? { kind: 'ref', ref: through(s.axis.ref, inside, sub) } : s.axis };
    });
  }
  countersFor([options.file.id, sub], parent.idCounters);
  return { parent, sub: childDoc };
}
