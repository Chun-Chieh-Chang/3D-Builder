import type { AssemblyDoc, Pose } from './schema';
import type { Id } from './ids';
import { IDENTITY_ROTATION, composePoses } from './pose';
import { dirName, joinPath } from './paths';

/**
 * Rigid sub-assemblies (C15.4, C15.5). An assembly may use another assembly file (`.3dba`) as a component: it moves as one rigid body and the mates
 * inside it stay inside it (each assembly is solved on its own, the parent sees only the placement of the whole). Nothing is stored for it beyond the
 * file reference; what is below is derived: the tree is walked from the files, every part ends up with its pose in the top assembly.
 */
export const SUBASSEMBLY_EXTENSION = '.3dba';

export const isSubAssemblyPath = (path: string): boolean => path.toLowerCase().endsWith(SUBASSEMBLY_EXTENSION);

/** Reads the assembly at `path` (relative to the project folder, as the top assembly's own path is); null when the file is not there. */
export type LoadAssembly = (path: string) => AssemblyDoc | null;

/** One part somewhere in the tree. */
export interface TreePart {
  /** The component ids from the top assembly down to the part, e.g. ['c2', 'c1']. */
  chain: Id[];
  /** The part file, relative to the project folder. */
  path: string;
  /** Where the part is in the top assembly's coordinates. */
  pose: Pose;
  /** Fixed in its own assembly: fixed means fixed there, a sub-assembly as a whole is fixed or floating in the one above. */
  fixed: boolean;
}

export type TreeProblem =
  | { kind: 'cycle'; /** The files from the top, ending with the one met twice. */ chain: string[] }
  | { kind: 'missing'; path: string; chain: Id[] };

export interface Tree {
  parts: TreePart[];
  problems: TreeProblem[];
}

const IDENTITY: Pose = { position: [0, 0, 0], rotation: IDENTITY_ROTATION };

/**
 * Every part of the assembly at `topPath` with its pose in the top assembly, sub-assemblies opened recursively. A file that contains itself, directly or
 * through others, is reported as a cycle and not opened; a file that is not there as missing. Everything else is still returned.
 */
export function resolveTree(topPath: string, load: LoadAssembly): Tree {
  const tree: Tree = { parts: [], problems: [] };
  const visit = (path: string, doc: AssemblyDoc, outer: Pose, chain: Id[], stack: string[]): void => {
    for (const c of doc.components) {
      const file = doc.files.find((f) => f.id === c.file);
      if (!file) continue;
      const child = joinPath(dirName(path), file.path);
      const pose = composePoses(outer, c.placement);
      const at = [...chain, c.id];
      if (!isSubAssemblyPath(child)) {
        tree.parts.push({ chain: at, path: child, pose, fixed: c.fixed });
        continue;
      }
      if (child === path || stack.includes(child)) {
        tree.problems.push({ kind: 'cycle', chain: [...stack, child] });
        continue;
      }
      const sub = load(child);
      if (!sub) tree.problems.push({ kind: 'missing', path: child, chain: at });
      else visit(child, sub, pose, at, [...stack, child]);
    }
  };
  const top = load(topPath);
  if (!top) tree.problems.push({ kind: 'missing', path: topPath, chain: [] });
  else visit(topPath, top, IDENTITY, [], [topPath]);
  return tree;
}

/**
 * Whether inserting the assembly at `candidate` into the one at `topPath` would make a cycle, i.e. whether `candidate` is, or contains, `topPath`. Asked
 * before an insert, so that the command never has to accept a document that cannot be opened.
 */
export function wouldCycle(topPath: string, candidate: string, load: LoadAssembly): boolean {
  if (!isSubAssemblyPath(candidate)) return false;
  const seen = new Set<string>();
  const walk = (path: string): boolean => {
    if (path === topPath) return true;
    if (seen.has(path)) return false;
    seen.add(path);
    const doc = load(path);
    if (!doc) return false;
    return doc.components.some((c) => {
      const f = doc.files.find((x) => x.id === c.file);
      const child = f ? joinPath(dirName(path), f.path) : '';
      return isSubAssemblyPath(child) && walk(child);
    });
  };
  return walk(candidate);
}
