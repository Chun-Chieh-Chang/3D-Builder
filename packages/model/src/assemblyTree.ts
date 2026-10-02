import { t } from '@3db/i18n';
import { joinPath, normalizePath } from './paths';
import type { AssemblyDoc } from './schema';

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
