import { t } from '@3db/i18n';
import { joinPath, normalizePath } from './paths';
import type { Id } from './ids';
import { componentPatternInstances, componentPatternProblem, mirroredPose, type PatternLine } from './componentPatterns';
import { composePose } from './pose';
import type { AssemblyDoc, PatternAxis, Pose } from './schema';

/**
 * What a component is, as the worker is told: a rebuilt part by its content key, or a sub-assembly: its document and
 * what each of its components is in turn. A component whose file is not read yet (or not there) has no entry.
 */
export type SourceTree = { kind: 'part'; key: string } | { kind: 'assembly'; doc: AssemblyDoc; children: Record<Id, SourceTree> };

/** Where the components of a sub-assembly are inside it (its own coordinates), and the same for the sub-assemblies in it. */
export interface InnerPoses {
  poses: ReadonlyMap<Id, Pose>;
  inner: ReadonlyMap<Id, InnerPoses>;
}

/** One part to draw: where the parts of the components of an assembly end up, down through its sub-assemblies (C15.4). */
export interface Leaf {
  /** "comp2" for a part of the assembly itself, "comp2/pa" for a part inside the sub-assembly comp2 (ids are the files' own, so they are joined). */
  id: string;
  /** The component of the assembly this belongs to (it moves, hides, is selected as one). */
  top: Id;
  /** The components to go through inside it, outermost first: a mate element's `path`. Empty for a part of the assembly itself. */
  path: Id[];
  key: string;
  /** Where the part is in the assembly's coordinates. */
  pose: Pose;
  /** Hidden (C15.5): its component, or a sub-assembly it is in, is hidden. It is still solved; it is not drawn or picked. */
  hidden: boolean;
  /** See-through (C15.5): its component, or a sub-assembly it is in, is. */
  transparent: boolean;
  /** Made by a pattern or mirror (C15.13), by its id: derived from the seed's, never picked as an element or mated. */
  instanceOf?: Id;
  /** A mirrored copy: `key` is the mirror of the part (see `mirrorKey`). */
  mirrored?: boolean;
}

/**
 * Every part to draw. `topPose` is where a component of the assembly is now (dragged, solved, or its placement); parts inside
 * a sub-assembly are carried along by it, at the poses its own mates gave them (`inner`) or, before it is solved, its own placements.
 * Components that are suppressed are left out.
 */
export function leavesOf(doc: AssemblyDoc, trees: Readonly<Record<Id, SourceTree>>, topPose: (componentId: Id) => Pose | null, inner?: ReadonlyMap<Id, InnerPoses>): Leaf[] {
  const out: Leaf[] = [];
  const walk = (tree: SourceTree, top: Id, path: Id[], pose: Pose, solved: InnerPoses | undefined, hidden: boolean, transparent: boolean) => {
    if (tree.kind === 'part') {
      out.push({ id: [top, ...path].join('/'), top, path, key: tree.key, pose, hidden, transparent });
      return;
    }
    for (const c of tree.doc.components) {
      const child = tree.children[c.id];
      if (!child || c.suppressed) continue;
      const own = solved?.poses.get(c.id) ?? c.placement;
      walk(child, top, [...path, c.id], composePose(pose, own), solved?.inner.get(c.id), hidden || !!c.hidden, transparent || !!c.transparent);
    }
  };
  for (const c of doc.components) {
    const tree = trees[c.id];
    const pose = topPose(c.id);
    if (!tree || !pose || c.suppressed) continue;
    walk(tree, c.id, [], pose, inner?.get(c.id), !!c.hidden, !!c.transparent);
  }
  return out;
}

/** The key of a part's mirror (C15.13): the part mirrored in its own x = 0 plane, built once from the part's. */
export const mirrorKey = (key: string): string => `${key}:mx`;

/**
 * The parts the patterns and mirrors of an assembly add (C15.13), derived from the leaves of their seeds: a linear or circular
 * pattern puts a moved copy of each, a mirror a mirrored copy (the mirror part at the mirrored pose). `axisOf` finds a pattern's
 * axis in the assembly (null when it cannot: the pattern is then reported and has no instances). They belong to their seed's component
 * (`top`), so hovering, selecting and dragging the seed carry them; `instanceOf` says what makes them. A pattern whose seed is
 * suppressed or whose parts are not shown has none.
 */
export function patternLeavesOf(
  doc: AssemblyDoc,
  base: readonly Leaf[],
  axisOf: (axis: PatternAxis) => PatternLine | null,
): { leaves: Leaf[]; problems: Map<Id, string> } {
  const leaves: Leaf[] = [];
  const problems = new Map<Id, string>();
  for (const p of doc.patterns ?? []) {
    const seed = doc.components.find((c) => c.id === p.seed);
    if (!seed || seed.suppressed) continue;
    const mine = base.filter((l) => l.top === p.seed);
    if (p.kind === 'mirror') {
      const bad = componentPatternProblem(p);
      if (bad) {
        problems.set(p.id, bad);
        continue;
      }
      for (const l of mine) leaves.push({ ...l, id: `${l.id}@${p.id}`, key: mirrorKey(l.key), pose: mirroredPose(p.plane!, l.pose), instanceOf: p.id, mirrored: true });
      continue;
    }
    const axis1 = p.axis1 ? axisOf(p.axis1) : null;
    const axis2 = p.axis2 ? axisOf(p.axis2) : null;
    if (!axis1 || (p.axis2 && !axis2)) {
      problems.set(p.id, t('pattern.axisNotFound'));
      continue;
    }
    const made = componentPatternInstances(p, { axis1, ...(axis2 ? { axis2 } : {}) });
    if (typeof made === 'string') {
      problems.set(p.id, made);
      continue;
    }
    for (const inst of made) for (const l of mine) leaves.push({ ...l, id: `${l.id}@${p.id}#${inst.label}`, pose: composePose(inst.motion, l.pose), instanceOf: p.id });
  }
  return { leaves, problems };
}

/** The leaf a mate element's component and path lead to, among `leaves` (null: not shown, e.g. its file is missing). */
export function leafAt(leaves: readonly Leaf[], top: Id, path: readonly Id[] | undefined): Leaf | null {
  const id = [top, ...(path ?? [])].join('/');
  return leaves.find((l) => l.id === id) ?? null;
}

/**
 * The files an assembly uses, as paths relative to the project folder (`folder` is the one the assembly
 * file is in). Its file entries are relative to that folder; the same file reached from two assemblies in
 * different folders must come out as the same string, so that a cycle can be recognised.
 */
export function usedFiles(doc: AssemblyDoc, folder: string): string[] {
  return doc.files.map((f) => joinPath(folder, f.path));
}

/**
 * Finds an assembly that would contain itself (C15.4). `refsOf` gives the files the assembly at a path
 * uses (see `usedFiles`), or null for a file that is not an assembly or cannot be read (a part, a STEP
 * file, a missing file: nothing below it to follow). Returns the chain of paths from `root` back to the
 * repeated one, e.g. ["a.3dba", "b.3dba", "a.3dba"], or null when there is no cycle below `root`.
 */
export function findReferenceCycle(root: string, refsOf: (path: string) => readonly string[] | null): string[] | null {
  const start = normalizePath(root);
  const done = new Set<string>();
  const chain: string[] = [];
  const visit = (path: string): string[] | null => {
    const at = chain.indexOf(path);
    if (at >= 0) return [...chain.slice(at), path];
    if (done.has(path)) return null;
    chain.push(path);
    for (const next of refsOf(path) ?? []) {
      const found = visit(normalizePath(next));
      if (found) return found;
    }
    chain.pop();
    done.add(path);
    return null;
  };
  return visit(start);
}

/** The readable message for a cycle `findReferenceCycle` found. */
export function cycleMessage(cycle: readonly string[]): string {
  if (cycle.length === 2) return t('subassembly.selfReference', { file: cycle[0]! });
  return t('subassembly.cycle', { chain: cycle.join(' → ') });
}
