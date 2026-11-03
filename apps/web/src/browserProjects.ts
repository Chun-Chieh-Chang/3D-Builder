import { t } from '@3db/i18n';
import { readZip, writeZip, type ZipEntry } from '@3db/io';
import type { OpfsWrite, OpfsWritten } from './worker/opfsWrite.worker';

/**
 * Projects kept in the browser (ADR 0233). Firefox and Safari give a page no folder of the computer, so an assembly there has nowhere to find its
 * parts. Every current browser has a storage of its own for the page (the origin private file system), with the same folder and file handles as a
 * folder the user picks: so a project kept there is an ordinary project folder to the rest of the program. All of them are in one folder of that
 * storage, CONTAINER, one folder each; a folder elsewhere in it (the e2e tests keep theirs at the root) is not one of these and is used as a picked
 * folder would be.
 *
 * The storage belongs to the browser: clearing the site's data deletes it. So a project is exported as a ZIP to keep a copy on the computer and
 * imported again from one, the page asks the browser to keep its storage (`navigator.storage.persist`), and the date of the last export is kept so
 * the user is reminded.
 */
const CONTAINER = '3d-builder-projects';

export function browserProjectsAvailable(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function';
}

async function container(): Promise<FileSystemDirectoryHandle> {
  return (await navigator.storage.getDirectory()).getDirectoryHandle(CONTAINER, { create: true });
}

/** Characters a file name on Windows cannot hold: a project exported and unzipped there keeps its names. */
const FORBIDDEN = /[\\/:*?"<>|\u0000-\u001f]/;

/** Why a name cannot be a project's or a file's (one part of a path), or null when it can. */
export function nameProblem(name: string): string | null {
  if (name.trim() === '') return t('bproj.nameEmpty');
  if (name !== name.trim()) return t('bproj.nameSpaces');
  if (name === '.' || name === '..' || name.endsWith('.')) return t('bproj.nameDot');
  if (FORBIDDEN.test(name)) return t('bproj.nameChars');
  if (name.length > 120) return t('bproj.nameLong');
  return null;
}

/** Why a path ("零件/銷.3dbx") cannot be a file's in a project, or null when it can. */
export function pathProblem(path: string): string | null {
  for (const part of path.split('/')) {
    const why = nameProblem(part);
    if (why) return why;
  }
  return null;
}

/** `name`, or 「name (2)」, 「name (3)」… so that it is not one of `taken`; an extension stays at the end. */
export function freeName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
  for (let n = 2; ; n++) {
    const next = `${stem} (${n})${ext}`;
    if (!taken.has(next)) return next;
  }
}

export async function listBrowserProjects(): Promise<string[]> {
  const names: string[] = [];
  for await (const [name, handle] of (await container()).entries()) if (handle.kind === 'directory') names.push(name);
  return names.sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}

/** The project's folder; throws NotFoundError when there is none of that name. */
export async function browserProject(name: string): Promise<FileSystemDirectoryHandle> {
  return (await container()).getDirectoryHandle(name);
}

/** A new, empty project. Throws when the name cannot be one or is taken. */
export async function createBrowserProject(name: string): Promise<FileSystemDirectoryHandle> {
  const why = nameProblem(name);
  if (why) throw new Error(why);
  if ((await listBrowserProjects()).includes(name)) throw new Error(t('bproj.taken', { name }));
  return (await container()).getDirectoryHandle(name, { create: true });
}

/** Deletes the project and everything in it (the user confirmed it). */
export async function deleteBrowserProject(name: string): Promise<void> {
  await (await container()).removeEntry(name, { recursive: true });
  forgetExport(name);
}

/** The name of the project when `folder` is one kept in the browser, else null (a folder of the computer, or one elsewhere in the storage). */
export async function browserProjectName(folder: FileSystemDirectoryHandle | null): Promise<string | null> {
  if (!folder || !browserProjectsAvailable()) return null;
  try {
    const path = await (await container()).resolve(folder);
    return path?.length === 1 ? path[0]! : null;
  } catch {
    return null; // a folder of the computer: the storage cannot resolve it
  }
}

/** The browser project a file or folder is in (its name), or null. */
export async function browserProjectOf(handle: FileSystemHandle): Promise<string | null> {
  if (!browserProjectsAvailable()) return null;
  try {
    return (await (await container()).resolve(handle))?.[0] ?? null;
  } catch {
    return null;
  }
}

/** Scratch files the worker writer leaves when the page closes in the middle of a write. */
const isScratch = (name: string) => name.startsWith('.') && name.endsWith('.writing');

/** Every file of the folder and below it, with its path. */
export async function filesOf(folder: FileSystemDirectoryHandle): Promise<ZipEntry[]> {
  const out: ZipEntry[] = [];
  const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind === 'directory') await walk(handle as FileSystemDirectoryHandle, `${prefix}${name}/`);
      else if (!isScratch(name)) out.push({ name: `${prefix}${name}`, data: new Uint8Array(await (await (handle as FileSystemFileHandle).getFile()).arrayBuffer()) });
    }
  };
  await walk(folder, '');
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** The project as a ZIP: its files at their paths in it, so unzipping gives the same folder on the computer. */
export async function exportBrowserProject(folder: FileSystemDirectoryHandle): Promise<Uint8Array> {
  return writeZip(await filesOf(folder));
}

/**
 * The files a ZIP gives a project. A folder zipped by Windows or macOS has the folder itself at the top; it is taken off when everything is in it.
 * Folders as entries and macOS' resource forks are left out. A path that leaves the project or that a file name cannot hold refuses the whole ZIP.
 */
export function projectFilesFromZip(entries: readonly ZipEntry[]): { path: string; bytes: Uint8Array }[] {
  const files = entries.filter((e) => !e.name.endsWith('/') && !e.name.startsWith('__MACOSX/') && !e.name.split('/').some((p) => p === '.DS_Store'));
  if (files.length === 0) throw new Error(t('bproj.zipEmpty'));
  for (const f of files) {
    const why = f.name.startsWith('/') ? t('bproj.nameChars') : pathProblem(f.name);
    if (why) throw new Error(t('bproj.zipBadPath', { path: f.name, why }));
  }
  const top = files[0]!.name.split('/')[0]!;
  const wrapped = files.every((f) => f.name.startsWith(`${top}/`));
  return files.map((f) => ({ path: wrapped ? f.name.slice(top.length + 1) : f.name, bytes: f.data }));
}

/** A ZIP made into a new project named after it (「name (2)」 when that is taken). The new project's name; nothing stays when it fails. */
export async function importBrowserProject(zipName: string, bytes: Uint8Array): Promise<string> {
  const files = projectFilesFromZip(await readZip(bytes));
  const base = zipName.replace(/\.zip$/i, '').trim() || t('bproj.imported');
  const name = freeName(nameProblem(base) ? t('bproj.imported') : base, new Set(await listBrowserProjects()));
  const folder = await createBrowserProject(name);
  try {
    for (const f of files) {
      const parts = f.path.split('/');
      let dir = folder;
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
      await writeBrowserFile(await dir.getFileHandle(parts[parts.length - 1]!, { create: true }), f.bytes);
    }
  } catch (e) {
    await deleteBrowserProject(name).catch(() => {});
    throw e;
  }
  return name;
}

// ---------------------------------------------------------------- writing where the page cannot

let writer: Worker | null = null;
let nextId = 0;
const waiting = new Map<number, (r: OpfsWritten) => void>();

/**
 * Writes a file of the browser's storage through a worker (`createSyncAccessHandle`): for a browser whose handles have no `createWritable`.
 * `force` is for the tests, which run in browsers that have both.
 */
export async function writeBrowserFile(handle: FileSystemFileHandle, bytes: Uint8Array, force = false): Promise<void> {
  if (!force && typeof handle.createWritable === 'function') {
    const stream = await handle.createWritable();
    await stream.write(bytes as Uint8Array<ArrayBuffer>);
    await stream.close();
    return;
  }
  const path = await (await navigator.storage.getDirectory()).resolve(handle);
  if (!path) throw new Error(t('files.noWrite'));
  writer ??= Object.assign(new Worker(new URL('./worker/opfsWrite.worker.ts', import.meta.url), { type: 'module' }), {
    onmessage: (e: MessageEvent<OpfsWritten>) => {
      waiting.get(e.data.id)?.(e.data);
      waiting.delete(e.data.id);
    },
  });
  const id = ++nextId;
  const done = await new Promise<OpfsWritten>((resolve) => {
    waiting.set(id, resolve);
    writer!.postMessage({ id, path, bytes } satisfies OpfsWrite);
  });
  if (!done.ok) throw new Error(done.why);
}

// ---------------------------------------------------------------- keeping the storage

export interface StorageState {
  /** Whether the browser keeps the storage when it runs short of room (null where it cannot say). */
  persisted: boolean | null;
  usage: number | null;
  quota: number | null;
}

/** Asks the browser to keep the storage. Firefox asks the user; Chrome decides by itself. */
export async function keepStorage(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return null;
  }
}

export async function storageState(): Promise<StorageState> {
  try {
    const persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
    const estimate = navigator.storage?.estimate ? await navigator.storage.estimate() : {};
    return { persisted, usage: estimate.usage ?? null, quota: estimate.quota ?? null };
  } catch {
    return { persisted: null, usage: null, quota: null };
  }
}

const EXPORTED = '3db-exported:';

/** When the project was last exported (ms), or null: kept in the page's local storage, which goes with the projects when the site's data is cleared. */
export function lastExport(name: string): number | null {
  try {
    const v = Number(localStorage.getItem(EXPORTED + name));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function noteExport(name: string, at = Date.now()): void {
  try {
    localStorage.setItem(EXPORTED + name, String(at));
  } catch {
    // no local storage (a private window): the reminder comes again
  }
}

function forgetExport(name: string): void {
  try {
    localStorage.removeItem(EXPORTED + name);
  } catch {
    // nothing kept
  }
}

/** Days after the last export (or since never) before saving into the project reminds the user to export it again. */
export const EXPORT_REMINDER_DAYS = 7;

export function exportDue(name: string, now = Date.now()): boolean {
  const at = lastExport(name);
  return at === null || now - at > EXPORT_REMINDER_DAYS * 86400000;
}
