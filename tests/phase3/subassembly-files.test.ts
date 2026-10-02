/**
 * 3b-1a: sub-assemblies as files. An assembly refers to a `.3dba` the way it refers to a part (by a path relative to
 * its own folder), so the paths of every file in a project stay what they are when a whole tree moves, and only
 * the paths of the file that is saved elsewhere are rewritten (ADR 0011). Whether a file would contain itself
 * is found by reading the files, not from names.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAssemblyCommand, createEmptyAssembly, cycleMessage, dirName, findReferenceCycle, joinPath, relocateAssembly, usedFiles, type AssemblyDoc, type Component } from '@3db/model';
import { readDocumentFile, writeAssemblyFile } from '@3db/io';

let project: string;
const golden = (name: string) => readFileSync(new URL(`../golden/${name}`, import.meta.url));
const comp = (id: string, file: string, instance: number, fixed = false): Component => ({ id, file, instance, fixed, placement: { position: [0, 0, 0], rotation: [0, 0, 0, 1] } });

/** 定位板 fixed, 削邊銷 twice: what lives in 組件/定位組.3dba, next to the parts' folders. */
function pins(): AssemblyDoc {
  let doc = createEmptyAssembly();
  doc = applyAssemblyCommand(doc, { type: 'insertComponent', file: { id: 'file1', path: '../定位板.3dbx' }, component: comp('comp1', 'file1', 1, true) });
  doc = applyAssemblyCommand(doc, { type: 'insertComponent', file: { id: 'file2', path: '../零件/削邊銷.3dbx' }, component: comp('comp2', 'file2', 1) });
  return applyAssemblyCommand(doc, { type: 'insertComponent', component: comp('comp3', 'file2', 2) });
}

/** The fixture: the sub-assembly used twice. Saved in the project folder itself. */
function fixture(): AssemblyDoc {
  let doc = createEmptyAssembly();
  doc = applyAssemblyCommand(doc, { type: 'insertComponent', file: { id: 'file1', path: '組件/定位組.3dba' }, component: comp('comp1', 'file1', 1, true) });
  return applyAssemblyCommand(doc, { type: 'insertComponent', component: comp('comp2', 'file1', 2) });
}

const put = (root: string, path: string, bytes: Uint8Array) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), bytes);
};

/** What `refsOf` is in the app: the project-relative paths an assembly file uses; a part, or a file that is not there, uses none. */
async function refsOn(root: string, path: string): Promise<string[] | null> {
  if (!path.endsWith('.3dba') || !existsSync(join(root, path))) return null;
  const file = await readDocumentFile(new Uint8Array(readFileSync(join(root, path))));
  return file.kind === 'assembly' ? usedFiles(file.doc, dirName(path)) : null;
}

/** `findReferenceCycle` is synchronous; the files are read first, the way the store reads a file before it asks. */
async function closure(root: string, start: string): Promise<Map<string, string[] | null>> {
  const seen = new Map<string, string[] | null>();
  const queue = [start];
  while (queue.length > 0) {
    const path = queue.pop()!;
    if (seen.has(path)) continue;
    const refs = await refsOn(root, path);
    seen.set(path, refs);
    queue.push(...(refs ?? []));
  }
  return seen;
}

beforeAll(async () => {
  project = mkdtempSync(join(tmpdir(), '3db-subassembly-'));
  put(project, '定位板.3dbx', golden('locating-plate.3dbx'));
  put(project, '零件/削邊銷.3dbx', golden('diamond-pin.3dbx'));
  put(project, '組件/定位組.3dba', await writeAssemblyFile(pins()));
  put(project, '夾具.3dba', await writeAssemblyFile(fixture()));
});

afterAll(() => rmSync(project, { recursive: true, force: true }));

describe('sub-assemblies as files (3b-1a)', () => {
  it('reads the files below an assembly down to its parts', async () => {
    const seen = await closure(project, '夾具.3dba');
    expect([...seen.keys()].sort()).toEqual(['夾具.3dba', '定位板.3dbx', '組件/定位組.3dba', '零件/削邊銷.3dbx'].sort());
    expect(seen.get('夾具.3dba')).toEqual(['組件/定位組.3dba']);
    expect(seen.get('組件/定位組.3dba')).toEqual(['定位板.3dbx', '零件/削邊銷.3dbx']); // written relative to 組件/, read relative to the project
    expect(findReferenceCycle('夾具.3dba', (p) => seen.get(p) ?? null)).toBeNull();
  });

  it('refuses a sub-assembly that uses the assembly holding it, found by reading the files', async () => {
    const looped = mkdtempSync(join(tmpdir(), '3db-loop-'));
    try {
      cpSync(project, looped, { recursive: true });
      // 定位組 now uses 夾具, which uses 定位組
      let loop = pins();
      loop = applyAssemblyCommand(loop, { type: 'insertComponent', file: { id: 'file3', path: '../夾具.3dba' }, component: comp('comp4', 'file3', 1) });
      put(looped, '組件/定位組.3dba', await writeAssemblyFile(loop));
      const seen = await closure(looped, '夾具.3dba');
      const cycle = findReferenceCycle('夾具.3dba', (p) => seen.get(p) ?? null);
      expect(cycle).toEqual(['夾具.3dba', '組件/定位組.3dba', '夾具.3dba']);
      expect(cycleMessage(cycle!)).toBe('這樣組合件會包含它自己：夾具.3dba → 組件/定位組.3dba → 夾具.3dba');
    } finally {
      rmSync(looped, { recursive: true, force: true });
    }
  });

  it('saved into another folder, only the saved file changes: its paths are rewritten, the sub-assembly file is not touched', async () => {
    const before = readFileSync(join(project, '組件/定位組.3dba'));
    const saved = relocateAssembly(fixture(), '', '備份/舊版');
    expect(saved.files.map((f) => f.path)).toEqual(['../../組件/定位組.3dba']);
    expect(usedFiles(saved, '備份/舊版')).toEqual(['組件/定位組.3dba']); // the same file, seen from its new folder
    expect(joinPath('備份/舊版', saved.files[0]!.path)).toBe('組件/定位組.3dba');
    put(project, '備份/舊版/夾具.3dba', await writeAssemblyFile(saved));
    const seen = await closure(project, '備份/舊版/夾具.3dba');
    expect([...seen.keys()].sort()).toEqual(['備份/舊版/夾具.3dba', '定位板.3dbx', '組件/定位組.3dba', '零件/削邊銷.3dbx'].sort());
    expect(readFileSync(join(project, '組件/定位組.3dba')).equals(before)).toBe(true);
    // and the original in the project folder still reads the same
    expect((await closure(project, '夾具.3dba')).get('夾具.3dba')).toEqual(['組件/定位組.3dba']);
  });

  it('a whole project moved to another place opens as it did: every file is written relative to its own folder', async () => {
    const moved = mkdtempSync(join(tmpdir(), '3db-moved-'));
    try {
      // cpSync kills the Node process on Windows (v25.8) when the destination is a folder with non-ASCII names; the project's own files keep theirs
      const root = join(moved, 'deeper', 'project');
      mkdirSync(root, { recursive: true });
      cpSync(project, root, { recursive: true });
      const seen = await closure(root, '夾具.3dba');
      expect([...seen.keys()].sort()).toEqual(['夾具.3dba', '定位板.3dbx', '組件/定位組.3dba', '零件/削邊銷.3dbx'].sort());
      // identical bytes: nothing was rewritten by moving
      for (const path of ['夾具.3dba', '組件/定位組.3dba']) expect(readFileSync(join(root, path)).equals(readFileSync(join(project, path)))).toBe(true);
    } finally {
      rmSync(moved, { recursive: true, force: true });
    }
  });
});
