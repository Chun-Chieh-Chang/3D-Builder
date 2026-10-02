import { t } from '@3db/i18n';
import type { Leaf } from './assemblyTree';
import type { PatternLine } from './componentPatterns';
import { evalLength, ExprError } from './expr';
import type { Id } from './ids';
import type { AssemblyDoc, ExplodeStep, PatternAxis, Vec3 } from './schema';

/**
 * The exploded view (C15.14). Only arithmetic lives here: where each component is moved to, given the steps and what their axes are in the assembly.
 * Nothing is stored of it and no pose is changed: the view draws each component at its own pose plus its offset, and the collapsed view has none.
 */

/** Why a step cannot be used (its distance, what it moves); null when it can. */
export function explodeStepProblem(step: ExplodeStep, doc: Pick<AssemblyDoc, 'components'>): string | null {
  if (!step.name.trim()) return t('explode.nameEmpty');
  if (step.components.length === 0) return t('explode.noComponents');
  for (const id of step.components) if (!doc.components.some((c) => c.id === id)) return t('explode.noComponent', { id });
  if (step.axis.kind === 'axis' ? !['x', 'y', 'z'].includes(step.axis.axis) : !step.axis.ref.component || !doc.components.some((c) => c.id === (step.axis as { ref: { component: Id | null } }).ref.component)) return t('explode.noAxis');
  try {
    if (!(evalLength(step.distance) > 0)) return t('explode.badDistance');
  } catch (e) {
    return e instanceof ExprError ? e.message : String(e);
  }
  return null;
}

/**
 * How far each component of the assembly is moved by the steps, in the assembly's coordinates: the sum of the steps that name it, each along its
 * direction (`axisOf` finds a step's axis in the assembly; null when it is gone: that step is reported and moves nothing). A step that names a component that is
 * suppressed moves nothing of it. A component no step names is not in the result.
 */
export function explosionOffsets(doc: AssemblyDoc, axisOf: (axis: PatternAxis) => PatternLine | null): { offsets: Map<Id, Vec3>; problems: Map<Id, string> } {
  const offsets = new Map<Id, Vec3>();
  const problems = new Map<Id, string>();
  for (const step of doc.explosion ?? []) {
    const bad = explodeStepProblem(step, doc);
    if (bad) {
      problems.set(step.id, bad);
      continue;
    }
    const line = axisOf(step.axis);
    if (!line) {
      problems.set(step.id, t('explode.axisNotFound'));
      continue;
    }
    const n = Math.hypot(...line.dir);
    if (!(n > 1e-12)) {
      problems.set(step.id, t('explode.axisNotFound'));
      continue;
    }
    const d = (evalLength(step.distance) * (step.flip ? -1 : 1)) / n;
    for (const id of step.components) {
      if (doc.components.find((c) => c.id === id)?.suppressed) continue;
      const o = offsets.get(id) ?? [0, 0, 0];
      offsets.set(id, [o[0] + line.dir[0] * d, o[1] + line.dir[1] * d, o[2] + line.dir[2] * d]);
    }
  }
  return { offsets, problems };
}

/** The leaves with each moved by the offset of its component: a sub-assembly's parts and a pattern's instances go with their component, rigidly. */
export function explodeLeaves(leaves: readonly Leaf[], offsets: ReadonlyMap<Id, Vec3>): Leaf[] {
  return leaves.map((l) => {
    const o = offsets.get(l.top);
    return o ? { ...l, pose: { ...l.pose, position: [l.pose.position[0] + o[0], l.pose.position[1] + o[1], l.pose.position[2] + o[2]] } } : l;
  });
}
