import { t } from '@3db/i18n';
import { dirName, isDerived, isFilePath, isStlData, joinPath } from '@3db/model';
import { readAnyDocumentFile } from './drawingFile';
import { isIgesData, isStepData } from './stepPart';
import { isZip, zipEntries } from './container';
import { writeZip } from './zip';

/**
 * The package file `.3dbp` (ADR 0234), SolidWorks' Pack and Go: an assembly, a drawing or a part with every file it uses, in one file. An assembly
 * holds no shape of its own, only the paths of its parts (B9.4), so the assembly file alone is of no use on another computer; the package is.
 *
 * It is a ZIP: the files at their paths in the project folder, and MANIFEST, which says it is a package and which file is the one to open. Renamed
 * to .zip it unzips with any tool into the same folders.
 */
export const PACKAGE_FILE_EXTENSION = '.3dbp';
export const MANIFEST = '3dbp.json';
const FORMAT = '3d-builder-package';
const VERSION = 1;

export interface PackageFile {
  /** Path in the project folder ("/" separated). */
  path: string;
  bytes: Uint8Array;
}

export interface Package {
  /** The file to open: the assembly, drawing or part the package was made of. */
  main: string;
  files: PackageFile[];
}

export class PackageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackageError';
  }
}

/** A path a package may hold: inside the project (no ".." anywhere), relative, "/" separated, in its shortest form. */
const safe = (path: string) => isFilePath(path) && !path.split('/').includes('..') && path !== MANIFEST;

/**
 * The files a file uses, by their paths in the project folder: the parts and sub-assemblies of an assembly, the models of a drawing's views, the
 * masters of a part's derived bodies. A STEP, IGES or STL file uses none. A path that leaves the project folder is given as it is (with its "..").
 */
export async function referencesOf(path: string, bytes: Uint8Array): Promise<string[]> {
  if (isStepData(bytes) || isIgesData(bytes) || (!isZip(bytes) && isStlData(bytes))) return [];
  const file = await readAnyDocumentFile(bytes);
  const refs =
    file.kind === 'assembly'
      ? file.doc.files.map((f) => f.path)
      : file.kind === 'drawing'
        ? file.doc.pages.flatMap((p) => p.views.flatMap((v) => (isDerived(v) ? [] : [v.source])))
        : file.doc.features.flatMap((f) => (f.type === 'derivedBody' ? [f.source] : []));
  return [...new Set(refs.map((r) => joinPath(dirName(path), r)))];
}

/**
 * Everything `main` uses, followed to the end (a sub-assembly's parts, a derived part's master…), each file once; `read` gives a file of the project
 * folder, or null when it is not there. Refused, with the list, when any file used is missing or outside the project folder: a package without them
 * would not open on the other computer, which is what it is for.
 */
export async function collectPackage(main: string, read: (path: string) => Promise<Uint8Array | null>): Promise<Package> {
  const files = new Map<string, Uint8Array>();
  const missing: string[] = [];
  const queue = [main];
  while (queue.length > 0) {
    const path = queue.shift()!;
    if (files.has(path) || missing.includes(path)) continue;
    const bytes = safe(path) ? await read(path) : null;
    if (!bytes) {
      missing.push(path);
      continue;
    }
    files.set(path, bytes);
    let refs: string[];
    try {
      refs = await referencesOf(path, bytes);
    } catch (e) {
      throw new PackageError(t('pack.unreadable', { path, why: e instanceof Error ? e.message : String(e) }));
    }
    queue.push(...refs);
  }
  if (missing.length > 0) throw new PackageError(t('pack.missing', { files: missing.join(', ') }));
  return { main, files: [...files].map(([path, bytes]) => ({ path, bytes })) };
}

export function writePackage(pkg: Package): Promise<Uint8Array> {
  const manifest = { format: FORMAT, version: VERSION, main: pkg.main, files: pkg.files.map((f) => f.path) };
  return writeZip([{ name: MANIFEST, data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) }, ...pkg.files.map((f) => ({ name: f.path, data: f.bytes }))]);
}

/** Whether the bytes are a package: a ZIP with the manifest in it. */
export async function isPackageData(bytes: Uint8Array): Promise<boolean> {
  if (!isZip(bytes)) return false;
  try {
    return (await zipEntries(bytes)).has(MANIFEST);
  } catch {
    return false;
  }
}

/**
 * A package as it was written. Refused whole when the manifest is not one of a package of this version, when a path would leave the folder it is
 * unpacked into, or when the files are not those the manifest lists (a file left out, or one added beside it).
 */
export async function readPackage(bytes: Uint8Array): Promise<Package> {
  let entries: Map<string, Uint8Array>;
  try {
    entries = await zipEntries(bytes);
  } catch (e) {
    throw new PackageError(t('pack.notPackage', { why: e instanceof Error ? e.message : String(e) }));
  }
  const text = entries.get(MANIFEST);
  if (!text) throw new PackageError(t('pack.notPackage', { why: MANIFEST }));
  let m: { format?: unknown; version?: unknown; main?: unknown; files?: unknown };
  try {
    m = JSON.parse(new TextDecoder().decode(text));
  } catch (e) {
    throw new PackageError(t('pack.notPackage', { why: e instanceof Error ? e.message : String(e) }));
  }
  if (m.format !== FORMAT) throw new PackageError(t('pack.notPackage', { why: String(m.format) }));
  if (typeof m.version !== 'number' || m.version > VERSION) throw new PackageError(t('pack.newer', { version: String(m.version) }));
  const listed = Array.isArray(m.files) && m.files.every((f) => typeof f === 'string') ? (m.files as string[]) : null;
  if (!listed || typeof m.main !== 'string' || !listed.includes(m.main)) throw new PackageError(t('pack.badManifest'));
  for (const p of listed) if (!safe(p)) throw new PackageError(t('pack.badPath', { path: p }));
  const inZip = [...entries.keys()].filter((n) => n !== MANIFEST && !n.endsWith('/'));
  const extra = inZip.filter((n) => !listed.includes(n));
  const absent = listed.filter((p) => !entries.has(p));
  if (extra.length > 0 || absent.length > 0) throw new PackageError(t('pack.mismatch', { files: [...absent, ...extra].join(', ') }));
  return { main: m.main, files: listed.map((path) => ({ path, bytes: entries.get(path)! })) };
}

/** What unpacking does to a file: added (not in the folder), skipped (the same bytes are there already), or replacing one that differs. */
export type UnpackChange = 'new' | 'same' | 'different';

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Each file of the package with what unpacking it into the folder `read` reads from does. */
export async function compareWithFolder(pkg: Package, read: (path: string) => Promise<Uint8Array | null>): Promise<{ path: string; change: UnpackChange }[]> {
  const out: { path: string; change: UnpackChange }[] = [];
  for (const f of pkg.files) {
    const there = await read(f.path);
    out.push({ path: f.path, change: there === null ? 'new' : sameBytes(there, f.bytes) ? 'same' : 'different' });
  }
  return out;
}
