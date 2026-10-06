import { t } from '@3db/i18n';
import type { Leaf } from './assemblyTree';
import { transformPoint } from './pose';
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
 * suppressed moves nothing of it. A component no step names is not in the result. `paths` has, for each component that moves, how far it is moved after each step
 * that moves it (the sum so far): the way it goes, for the explode lines; the last is its offset.
 */
export function explosionOffsets(doc: AssemblyDoc, axisOf: (axis: PatternAxis) => PatternLine | null): { offsets: Map<Id, Vec3>; paths: Map<Id, Vec3[]>; problems: Map<Id, string> } {
  const offsets = new Map<Id, Vec3>();
  const paths = new Map<Id, Vec3[]>();
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
      const next: Vec3 = [o[0] + line.dir[0] * d, o[1] + line.dir[1] * d, o[2] + line.dir[2] * d];
      offsets.set(id, next);
      paths.set(id, [...(paths.get(id) ?? []), next]);
    }
  }
  return { offsets, paths, problems };
}

/**
 * The leaves with each moved by the offset of its component: a sub-assembly's parts and a pattern's instances go with their component, rigidly. `progress` (0 to 1,
 * 1 at first) is how far the way is gone, for the view while it opens or closes: the leaves are where the offsets scaled by it put them.
 */
export function explodeLeaves(leaves: readonly Leaf[], offsets: ReadonlyMap<Id, Vec3>, progress = 1): Leaf[] {
  return leaves.map((l) => {
    const o = offsets.get(l.top);
    return o ? { ...l, pose: { ...l.pose, position: [l.pose.position[0] + o[0] * progress, l.pose.position[1] + o[1] * progress, l.pose.position[2] + o[2] * progress] } } : l;
  });
}

/**
 * Where a component is, for the line it goes along when it is exploded: the middle of the box round all its leaves (the parts of a sub-assembly and the instances of a
 * pattern too) where they are assembled. `boundsOf` gives the box of a part in its own coordinates (null: nothing to draw of it); the box is turned and moved with the
 * leaf. Null when no leaf has a box.
 */
export function leavesCentre(leaves: readonly Leaf[], boundsOf: (key: string) => { min: Vec3; max: Vec3 } | null): Vec3 | null {
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const leaf of leaves) {
    const b = boundsOf(leaf.key);
    if (!b) continue;
    for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) {
      const p = transformPoint(leaf.pose, [x, y, z]);
      for (let i = 0; i < 3; i++) {
        lo[i] = Math.min(lo[i]!, p[i]!);
        hi[i] = Math.max(hi[i]!, p[i]!);
      }
    }
  }
  return lo[0]! <= hi[0]! ? [(lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2, (lo[2]! + hi[2]!) / 2] : null;
}
