import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createEmptyAssembly, createEmptyDrawing, createEmptyPart, type AssemblyDoc, type DrawingDoc, type PartDoc } from '@3db/model';
import {
  collectPackage,
  compareWithFolder,
  isPackageData,
  MANIFEST,
  PackageError,
  readPackage,
  referencesOf,
  writeAssemblyFile,
  writeDrawingFile,
  writePackage,
  writePartFile,
  writeZip,
} from '../src';

/**
 * ADR 0234: the package (.3dbp) holds a document with every file it uses, found by following the references of each file read; reading one back
 * refuses anything that would land outside the folder it is unpacked into. The app's part of it (the command, the dialog) is checked by
 * tests/e2e/manual-pack-and-go.js.
 */
const golden = (name: string) => new Uint8Array(readFileSync(new URL(`../../../tests/golden/${name}`, import.meta.url)));
const PIN = golden('diamond-pin.3dbx');
const PLATE = golden('locating-plate.3dbx');

const assembly = (paths: string[]): Promise<Uint8Array> => {
  const doc: AssemblyDoc = { ...createEmptyAssembly(), files: paths.map((path, i) => ({ id: `f${i + 1}`, path })) };
  return writeAssemblyFile(doc);
};
const drawing = (sources: string[]): Promise<Uint8Array> => {
  const doc = createEmptyDrawing();
  const page = doc.pages[0]!;
  const withViews: DrawingDoc = { ...doc, pages: [{ ...page, views: sources.map((source, i) => ({ id: `v${i + 1}`, name: '', source, direction: 'front' as const })) }] };
  return writeDrawingFile(withViews);
};
const derived = (source: string): Promise<Uint8Array> => {
  const doc: PartDoc = createEmptyPart();
  doc.features.push({ id: 'derived1', type: 'derivedBody', name: '衍生', suppressed: false, source, body: 'extrude1' });
  return writePartFile(doc);
};
const folder = (files: Record<string, Uint8Array>) => async (path: string) => files[path] ?? null;
const STEP = new TextEncoder().encode('ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n');

describe('what a file uses', () => {
  it('an assembly its parts, a drawing the models of its views, a part the masters of its derived bodies; paths from the project folder', async () => {
    expect(await referencesOf('組件/治具.3dba', await assembly(['../定位板.3dbx', '零件/銷.3dbx', '次組件.3dba']))).toEqual(['定位板.3dbx', '組件/零件/銷.3dbx', '組件/次組件.3dba']);
    expect(await referencesOf('圖/治具.3dbd', await drawing(['../組件/治具.3dba', '../定位板.3dbx', '../定位板.3dbx']))).toEqual(['組件/治具.3dba', '定位板.3dbx']);
    expect(await referencesOf('零件/衍生.3dbx', await derived('../母模.3dbx'))).toEqual(['母模.3dbx']);
    expect(await referencesOf('定位板.3dbx', PLATE)).toEqual([]);
    expect(await referencesOf('外購.step', STEP)).toEqual([]);
  });
  it('a path leaving the project folder keeps its ".."', async () => {
    expect(await referencesOf('治具.3dba', await assembly(['../外面/銷.3dbx']))).toEqual(['../外面/銷.3dbx']);
  });
});

describe('making a package', () => {
  it('follows the references to the end, each file once, and leaves out files of the folder nothing uses', async () => {
    const files = {
      '治具.3dba': await assembly(['定位板.3dbx', '次/次組件.3dba', '外購.step']),
      '次/次組件.3dba': await assembly(['../零件/銷.3dbx', '../定位板.3dbx']),
      '定位板.3dbx': PLATE,
      '零件/銷.3dbx': await derived('母模.3dbx'),
      '零件/母模.3dbx': PIN,
      '外購.step': STEP,
      '不相干.3dbx': PIN,
    };
    const pkg = await collectPackage('治具.3dba', folder(files));
    expect(pkg.main).toBe('治具.3dba');
    expect(pkg.files.map((f) => f.path).sort()).toEqual(['外購.step', '定位板.3dbx', '次/次組件.3dba', '治具.3dba', '零件/母模.3dbx', '零件/銷.3dbx'].sort());
    for (const f of pkg.files) expect(f.bytes).toBe(files[f.path as keyof typeof files]);
  });
  it('a drawing takes its assembly and the assembly its parts', async () => {
    const files = { '治具.3dbd': await drawing(['治具.3dba']), '治具.3dba': await assembly(['定位板.3dbx']), '定位板.3dbx': PLATE };
    expect((await collectPackage('治具.3dbd', folder(files))).files.map((f) => f.path)).toEqual(['治具.3dbd', '治具.3dba', '定位板.3dbx']);
  });
  it('a cycle of derived parts ends', async () => {
    const files = { 'a.3dbx': await derived('b.3dbx'), 'b.3dbx': await derived('a.3dbx') };
    expect((await collectPackage('a.3dbx', folder(files))).files.map((f) => f.path)).toEqual(['a.3dbx', 'b.3dbx']);
  });
  it('is refused, naming them, when files it uses are missing or outside the project folder', async () => {
    const files = { '治具.3dba': await assembly(['定位板.3dbx', '不見了.3dbx', '../外面.3dbx']), '定位板.3dbx': PLATE };
    const err = await collectPackage('治具.3dba', folder(files)).catch((e) => e);
    expect(err).toBeInstanceOf(PackageError);
    expect(err.message).toContain('不見了.3dbx');
    expect(err.message).toContain('../外面.3dbx');
  });
  it('is refused when a file it uses cannot be read', async () => {
    const files = { '治具.3dba': await assembly(['壞.3dbx']), '壞.3dbx': await writeZip([{ name: 'other.txt', data: new Uint8Array([1]) }]) };
    await expect(collectPackage('治具.3dba', folder(files))).rejects.toThrow('壞.3dbx');
  });
});

describe('reading a package', () => {
  it('gives back the files and the main one', async () => {
    const pkg = await collectPackage('治具.3dba', folder({ '治具.3dba': await assembly(['零件/銷.3dbx']), '零件/銷.3dbx': PIN }));
    const bytes = await writePackage(pkg);
    expect(await isPackageData(bytes)).toBe(true);
    expect(await isPackageData(PIN)).toBe(false); // a part file is a ZIP too, without the manifest
    expect(await isPackageData(STEP)).toBe(false);
    const back = await readPackage(bytes);
    expect(back.main).toBe('治具.3dba');
    expect(back.files.map((f) => [f.path, f.bytes.length])).toEqual(pkg.files.map((f) => [f.path, f.bytes.length]));
    expect(back.files[1]!.bytes).toEqual(PIN);
  });
  const manifest = (m: unknown) => ({ name: MANIFEST, data: new TextEncoder().encode(JSON.stringify(m)) });
  const ok = { format: '3d-builder-package', version: 1, main: 'a.3dbx', files: ['a.3dbx'] };
  it('refuses a path that would leave the folder, whatever the rest is', async () => {
    for (const bad of ['../a.3dbx', 'x/../../a.3dbx', '/a.3dbx', 'C:/a.3dbx', 'a\\b.3dbx', 'x/./a.3dbx', MANIFEST]) {
      const zip = await writeZip([manifest({ ...ok, main: bad, files: [bad] }), { name: bad, data: PIN }]);
      await expect(readPackage(zip), bad).rejects.toThrow(PackageError);
    }
  });
  it('refuses files the manifest does not list, and listed files that are not there', async () => {
    await expect(readPackage(await writeZip([manifest(ok), { name: 'a.3dbx', data: PIN }, { name: 'extra.3dbx', data: PIN }]))).rejects.toThrow('extra.3dbx');
    await expect(readPackage(await writeZip([manifest({ ...ok, files: ['a.3dbx', 'b.3dbx'] }), { name: 'a.3dbx', data: PIN }]))).rejects.toThrow('b.3dbx');
  });
  it('refuses what is not a package of this version', async () => {
    const cases = [
      [{ name: 'a.3dbx', data: PIN }],
      [manifest({ ...ok, format: 'other' }), { name: 'a.3dbx', data: PIN }],
      [manifest({ ...ok, version: 2 }), { name: 'a.3dbx', data: PIN }],
      [manifest({ ...ok, main: 'b.3dbx' }), { name: 'a.3dbx', data: PIN }],
      [{ name: MANIFEST, data: new TextEncoder().encode('{not json') }],
    ];
    for (const entries of cases) await expect(readPackage(await writeZip(entries))).rejects.toThrow(PackageError);
    await expect(readPackage(new TextEncoder().encode('not a zip'))).rejects.toThrow(PackageError);
  });
});

describe('unpacking into a folder that has some of the files', () => {
  it('says which are new, which the same (skipped), which differ', async () => {
    const pkg = await collectPackage('治具.3dba', folder({ '治具.3dba': await assembly(['定位板.3dbx', '零件/銷.3dbx']), '定位板.3dbx': PLATE, '零件/銷.3dbx': PIN }));
    const there = { '定位板.3dbx': PLATE, '零件/銷.3dbx': PLATE.slice(0, PIN.length) };
    const changes = await compareWithFolder(pkg, folder(there));
    expect(changes).toEqual([
      { path: '治具.3dba', change: 'new' },
      { path: '定位板.3dbx', change: 'same' },
      { path: '零件/銷.3dbx', change: 'different' },
    ]);
  });
});
