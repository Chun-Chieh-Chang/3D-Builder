import { t } from '@3db/i18n';
import { ASSEMBLY_FILE_EXTENSION, DRAWING_FILE_EXTENSION, isIgesData, isStepData, PACKAGE_FILE_EXTENSION, PART_FILE_EXTENSION } from '@3db/io';
import { isStlData } from '@3db/model';
import type { Recovery } from './autosave';
import { browserProject, browserProjectName, writeBrowserFile } from './browserProjects';
import { askProjectFile } from './projectFileDialog';

/**
 * Local files (F7.1). Chrome and Edge have the File System Access API: a part is opened and saved
 * in place, like a desktop program. Other browsers fall back to a file input and a download.
 *
 * An assembly refers to its parts by path (B9.4), and a web page may only read files the user has
 * granted. So assemblies work inside a project folder the user picks once: the assembly and the
 * parts it uses are in that folder or below it.
 *
 * The project folder can also be one kept in the browser (ADR 0233), which every browser has: the
 * dialogs then are the program's own (projectFileDialog), since the system's show only the computer.
 */

interface PickerType {
  description: string;
  accept: Record<string, string[]>;
}

interface PickerOptions {
  id?: string;
  types?: PickerType[];
  suggestedName?: string;
  /** A directory or a file whose parent is where the dialog opens. */
  startIn?: FileSystemHandle;
}

type PermissionState = 'granted' | 'denied' | 'prompt';

/** Chromium's permission methods on handles (not in the DOM typings yet). */
interface PermissionMethods {
  queryPermission?(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>;
}

declare global {
  interface Window {
    showOpenFilePicker?: (options?: PickerOptions) => Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?: (options?: PickerOptions) => Promise<FileSystemFileHandle>;
    showDirectoryPicker?: (options?: { id?: string; mode?: 'read' | 'readwrite'; startIn?: FileSystemHandle }) => Promise<FileSystemDirectoryHandle>;
  }
}

/** Save and import keep their shared browser history. Open has its own. */
const PICKER_ID = '3d-builder-parts';
const OPEN_PICKER_ID = '3d-builder-open';
const LAST_OPEN = 'last-open-file';
const PART_TYPE: PickerType = { get description() { return t('picker.part'); }, accept: { 'application/octet-stream': [PART_FILE_EXTENSION] } };
/** Parts saved before `.3dbx` were bare document text (`.3db.json`). */
const OLD_PART_TYPE: PickerType = { get description() { return t('picker.oldPart'); }, accept: { 'application/json': ['.json'] } };
const STEP_TYPE: PickerType = { get description() { return t('picker.step'); }, accept: { 'application/step': ['.step', '.stp'] } };
const IGES_TYPE: PickerType = { get description() { return t('picker.iges'); }, accept: { 'model/iges': ['.igs', '.iges'] } };
const STL_TYPE: PickerType = { get description() { return t('picker.stl'); }, accept: { 'model/stl': ['.stl'] } };
const ASSEMBLY_TYPE: PickerType = { get description() { return t('picker.assembly'); }, accept: { 'application/x-3db-assembly': [ASSEMBLY_FILE_EXTENSION] } };
const DRAWING_TYPE: PickerType = { get description() { return t('picker.drawing'); }, accept: { 'application/x-3db-drawing': [DRAWING_FILE_EXTENSION] } };
/** A document with every file it uses (ADR 0234). */
const PACKAGE_TYPE: PickerType = { get description() { return t('picker.package'); }, accept: { 'application/x-3db-package': [PACKAGE_FILE_EXTENSION] } };
/** The first type is the dialog's default filter: everything 「開啟舊檔」 can open. */
const ANY_TYPE: PickerType = {
  get description() {
    return t('picker.any');
  },
  accept: { 'application/octet-stream': [PART_FILE_EXTENSION, ASSEMBLY_FILE_EXTENSION, DRAWING_FILE_EXTENSION, PACKAGE_FILE_EXTENSION], ...STEP_TYPE.accept, ...IGES_TYPE.accept, ...STL_TYPE.accept, ...OLD_PART_TYPE.accept },
};

const acceptOf = (types: PickerType[]) => types.flatMap((t) => Object.values(t.accept).flat()).join(',');

/** A STEP file by name, or by its first bytes when the name says nothing. */
export function isStepFile(file: OpenedFile): boolean {
  return /\.(step|stp)$/i.test(file.name) || isStepData(file.bytes);
}

/** An STL file (F2.3) by name, or by its bytes when the name says nothing; a STEP or IGES file is never one. */
export function isStlFile(file: Pick<OpenedFile, 'name' | 'bytes'>): boolean {
  if (isStepData(file.bytes) || isIgesData(file.bytes)) return false;
  return /\.stl$/i.test(file.name) || isStlData(file.bytes);
}

/** An IGES file by name, or by its first bytes when the name says nothing. */
export function isIgesFile(file: Pick<OpenedFile, 'name' | 'bytes'>): boolean {
  return /\.(igs|iges)$/i.test(file.name) || isIgesData(file.bytes);
}

export interface OpenedFile {
  name: string;
  bytes: Uint8Array;
  /** Null where the browser cannot write files back, or for a file that must be saved under a new name. */
  handle: FileSystemFileHandle | null;
}

const cancelled = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

/** 「開啟舊檔」: a part, an assembly, or a STEP or IGES file to start a part from; null when the user cancels. */
export function pickFileToOpen(project: FileSystemDirectoryHandle | null = null): Promise<OpenedFile | null> {
  return pick([ANY_TYPE, PART_TYPE, ASSEMBLY_TYPE, DRAWING_TYPE, PACKAGE_TYPE, { description: 'DWG / DXF', accept: { 'image/vnd.dwg': ['.dwg'], 'image/vnd.dxf': ['.dxf'] } }, STEP_TYPE, IGES_TYPE, STL_TYPE, OLD_PART_TYPE], project, 'open', OPEN_PICKER_ID);
}

/** 「輸入 STEP 組合件」: a STEP file. */
export function pickStepFile(): Promise<OpenedFile | null> {
  return pick([STEP_TYPE]);
}

/** 「輸入 STEP／IGES／STL」: a STEP or an IGES file to import into the part as a body, or an STL file as a reference mesh (F2.3). */
export function pickImportFile(): Promise<OpenedFile | null> {
  const any: PickerType = { get description() { return t('picker.stepOrIges'); }, accept: { ...STEP_TYPE.accept, ...IGES_TYPE.accept, ...STL_TYPE.accept } };
  return pick([any, STEP_TYPE, IGES_TYPE, STL_TYPE]);
}

/** 「草圖圖片」: a PNG or a JPEG to lay in a sketch. */
export function pickImageFile(): Promise<OpenedFile | null> {
  const image: PickerType = { get description() { return t('picker.image'); }, accept: { 'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'] } };
  return pick([image]);
}

/** 「匯入 DXF」: a DXF drawing to bring into a sketch (F2.6). */
export function pickDxfFile(): Promise<OpenedFile | null> {
  const dxf: PickerType = { get description() { return t('picker.dxf'); }, accept: { 'image/vnd.dxf': ['.dxf'] } };
  return pick([dxf]);
}

export function pickCadDrawingFile(): Promise<OpenedFile | null> {
  return pick([{ description: 'DWG / DXF', accept: { 'image/vnd.dwg': ['.dwg'], 'image/vnd.dxf': ['.dxf'] } }]);
}

/** 「PDF 字型」: a TrueType font file (.ttf, or .ttc such as Microsoft JhengHei) to embed in the PDF for the characters the standard font does not have. */
export function pickFontFile(): Promise<OpenedFile | null> {
  const font: PickerType = { get description() { return t('picker.font'); }, accept: { 'font/ttf': ['.ttf', '.ttc'] } };
  return pick([font]);
}

/** 「插入零組件」→「瀏覽」: a part file or a STEP file, starting in the project folder; in one kept in the browser, a file of the computer is copied into it. */
export function pickPartFile(startIn: FileSystemDirectoryHandle): Promise<OpenedFile | null> {
  const either: PickerType = { get description() { return t('picker.partOrStep'); }, accept: { ...PART_TYPE.accept, ...STEP_TYPE.accept } };
  return pick([either, PART_TYPE, STEP_TYPE], startIn, 'copy');
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(fallback);
      }
    }, ms);
    promise.then(
      (v) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(v);
        }
      },
      () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(fallback);
        }
      },
    );
  });
}

async function pick(types: PickerType[], startIn: FileSystemDirectoryHandle | null = null, outside: 'open' | 'copy' = 'open', id = PICKER_ID): Promise<OpenedFile | null> {
  const recent = id === OPEN_PICKER_ID && window.showOpenFilePicker ? await withTimeout(lastOpenedFile(), 400, null) : null;
  if (startIn) {
    const projectName = await withTimeout(browserProjectName(startIn), 400, null);
    if (projectName !== null) {
      const extensions = [...new Set(types.flatMap((x) => Object.values(x.accept).flat()))].map((e) => e.toLowerCase());
      const answer = await askProjectFile({ mode: 'open', folder: startIn, projectName, extensions, accept: acceptOf(types), outside });
      if (!answer) return null;
      const file = 'handle' in answer ? await answer.handle.getFile() : answer.file;
      return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), handle: 'handle' in answer ? answer.handle : null };
    }
  }
  if (window.showOpenFilePicker) {
    const location = recent ?? startIn;
    const openPicker = async (withStartIn: boolean): Promise<FileSystemFileHandle | null> => {
      const [handle] = await window.showOpenFilePicker!({ id, types, ...(withStartIn && location ? { startIn: location } : {}) });
      return handle ?? null;
    };
    try {
      let handle: FileSystemFileHandle | null;
      try {
        handle = await openPicker(true);
      } catch (e) {
        if (cancelled(e)) return null;
        if (location) {
          // Stale/moved/restricted startIn handle: clear LAST_OPEN and retry without startIn.
          if (id === OPEN_PICKER_ID && recent) {
            void handles('readwrite', (s) => s.delete(LAST_OPEN)).catch(() => {});
          }
          handle = await openPicker(false);
        } else {
          throw e;
        }
      }
      if (!handle) return null;
      const file = await handle.getFile();
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (id === OPEN_PICKER_ID) {
        await withTimeout(handles('readwrite', (s) => s.put(handle, LAST_OPEN)).catch(() => {}), 400, undefined);
      }
      return { name: file.name, bytes, handle };
    } catch (e) {
      if (cancelled(e)) return null;
      // Fallback to standard <input type="file"> if showOpenFilePicker is blocked by transient activation/policy.
      if (e instanceof DOMException && (e.name === 'SecurityError' || e.name === 'NotAllowedError')) {
        const file = await chooseFile(acceptOf(types));
        return file && { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), handle: null };
      }
      throw e;
    }
  }
  const file = await chooseFile(acceptOf(types));
  return file && { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), handle: null };
}

export function chooseFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** Where to save in a project kept in the browser (ADR 0233), or undefined when `folder` is not one. */
async function saveInBrowserProject(folder: FileSystemDirectoryHandle | null, suggestedName: string, extension: string): Promise<FileSystemFileHandle | null | undefined> {
  const projectName = await browserProjectName(folder);
  if (!folder || projectName === null) return undefined;
  const answer = await askProjectFile({ mode: 'save', folder, projectName, suggestedName, extension });
  return answer && 'handle' in answer ? answer.handle : null;
}

/** Asks where to save: a handle, null when the user cancels, or 'download' where files cannot be written. In a project kept in the browser, into it. */
export async function pickSaveTarget(suggestedName: string, project: FileSystemDirectoryHandle | null = null): Promise<FileSystemFileHandle | 'download' | null> {
  const inProject = await saveInBrowserProject(project, suggestedName, PART_FILE_EXTENSION);
  if (inProject !== undefined) return inProject;
  if (!window.showSaveFilePicker) return 'download';
  try {
    return await window.showSaveFilePicker({ id: PICKER_ID, suggestedName, types: [PART_TYPE] });
  } catch (e) {
    if (cancelled(e)) return null;
    throw e;
  }
}

/** Where to save an assembly, starting in the project folder; null when the user cancels. */
export async function pickAssemblySaveTarget(folder: FileSystemDirectoryHandle, suggestedName: string): Promise<FileSystemFileHandle | null> {
  const inProject = await saveInBrowserProject(folder, suggestedName, ASSEMBLY_FILE_EXTENSION);
  if (inProject !== undefined) return inProject;
  if (!window.showSaveFilePicker) throw new Error(foldersUnsupported());
  try {
    return await window.showSaveFilePicker({ id: PICKER_ID, suggestedName, types: [ASSEMBLY_TYPE], startIn: folder });
  } catch (e) {
    if (cancelled(e)) return null;
    throw e;
  }
}

/** Where to save a drawing, starting in the project folder; null when the user cancels. */
export async function pickDrawingSaveTarget(folder: FileSystemDirectoryHandle, suggestedName: string): Promise<FileSystemFileHandle | null> {
  const inProject = await saveInBrowserProject(folder, suggestedName, DRAWING_FILE_EXTENSION);
  if (inProject !== undefined) return inProject;
  if (!window.showSaveFilePicker) throw new Error(foldersUnsupported());
  try {
    return await window.showSaveFilePicker({ id: PICKER_ID, suggestedName, types: [DRAWING_TYPE], startIn: folder });
  } catch (e) {
    if (cancelled(e)) return null;
    throw e;
  }
}

/** Where to put an exported DWG: the user chooses the folder and name; 'download' where the browser cannot write files; null when the user cancels. */
export async function pickDwgExportTarget(suggestedName: string): Promise<FileSystemFileHandle | 'download' | null> {
  if (!window.showSaveFilePicker) return 'download';
  try {
    return await window.showSaveFilePicker({ id: 'dwg-export', suggestedName, types: [{ description: 'DWG', accept: { 'image/vnd.dwg': ['.dwg'] } }] });
  } catch (e) {
    if (cancelled(e)) return null;
    throw e;
  }
}

export const foldersUnsupported = () => t('files.foldersUnsupported');

/** The project folder (B9.4): the folder picker; null when the user cancels. */
export async function pickProjectFolder(mode: 'read' | 'readwrite' = 'read', startIn: FileSystemHandle | null = null): Promise<FileSystemDirectoryHandle | null> {
  if (!window.showDirectoryPicker) throw new Error(foldersUnsupported());
  const open = (withStartIn: boolean) => window.showDirectoryPicker!({ id: 'project-folder', mode, ...(withStartIn && startIn ? { startIn } : {}) });
  try {
    try {
      return await open(true);
    } catch (e) {
      if (cancelled(e)) return null;
      if (startIn) return await open(false);
      throw e;
    }
  } catch (e) {
    if (cancelled(e)) return null;
    throw e;
  }
}

// ---------------------------------------------------------------- the project folder across sessions (B9.4)

/** Folder handles can be kept in IndexedDB; the browser asks for the permission again when one is used. */
const DB_NAME = '3d-builder';
const HANDLES = 'handles';

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(HANDLES);
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
    open.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

async function handles<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(HANDLES, mode).objectStore(HANDLES));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

/** The picker can use a file's parent even when the previous session's read permission has expired. */
async function lastOpenedFile(): Promise<FileSystemFileHandle | null> {
  const handle = await handles<FileSystemFileHandle | undefined>('readonly', (s) => s.get(LAST_OPEN)).catch(() => undefined);
  if (handle?.kind !== 'file') return null;
  try {
    await handle.getFile();
    return handle;
  } catch (e) {
    return e instanceof DOMException && e.name === 'NotAllowedError' ? handle : null;
  }
}

/** The copy autosave keeps of a part with changes (B9.3), in the same place as the folder handles. */
export async function keepRecovery(entry: Recovery): Promise<void> {
  await handles('readwrite', (s) => s.put(entry, 'recovery'));
}

export async function recoveryCopy(): Promise<Recovery | null> {
  try {
    const found: unknown = await handles('readonly', (s) => s.get('recovery'));
    const r = found as Partial<Recovery> | undefined;
    return r && r.bytes instanceof Uint8Array && typeof r.savedAt === 'number' && typeof r.untitled === 'string' ? (r as Recovery) : null;
  } catch {
    return null;
  }
}

export async function dropRecovery(): Promise<void> {
  await handles('readwrite', (s) => s.delete('recovery'));
}

/** Remembers the project folder for the next session; one kept in the browser by its name (not every browser can keep a handle in IndexedDB). */
export async function rememberFolder(folder: FileSystemDirectoryHandle): Promise<void> {
  try {
    const name = await browserProjectName(folder);
    await handles('readwrite', (s) => s.put(name !== null ? { browserProject: name } : folder, 'project'));
  } catch {
    // no IndexedDB (a private window): the folder is asked for again next time
  }
}

/** The project folder an earlier session used, if it was remembered. */
export async function rememberedFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const found: unknown = await handles('readonly', (s) => s.get('project'));
    const kept = (found as { browserProject?: unknown } | undefined)?.browserProject;
    if (typeof kept === 'string') return await browserProject(kept); // deleted since: NotFoundError, so none
    return found && typeof found === 'object' && (found as FileSystemHandle).kind === 'directory' ? (found as FileSystemDirectoryHandle) : null;
  } catch {
    return null;
  }
}

/**
 * Whether the page may read a folder. With `ask`, the browser asks the user (only from a click: a
 * dialog's button); when they chose to allow it on every visit, it is allowed without asking.
 */
export async function folderAccess(folder: FileSystemDirectoryHandle, ask: boolean): Promise<boolean> {
  const h = folder as FileSystemDirectoryHandle & PermissionMethods;
  if (!h.queryPermission) return true;
  const queried = ask ? await h.queryPermission({ mode: 'read' }) : await withTimeout(h.queryPermission({ mode: 'read' }), 1000, 'prompt');
  if (queried === 'granted') return true;
  return ask && !!h.requestPermission && (await h.requestPermission({ mode: 'read' })) === 'granted';
}

/** A file's path inside the folder ("零件/銷.3dbx"), or null when it lies elsewhere. */
export async function pathIn(folder: FileSystemDirectoryHandle, file: FileSystemFileHandle): Promise<string | null> {
  const parts = await withTimeout(folder.resolve(file), 1000, null);
  return parts ? parts.join('/') : null;
}

/** The file at `path` inside the folder. Throws NotFoundError (DOMException) when it is not there. */
export async function fileIn(folder: FileSystemDirectoryHandle, path: string): Promise<FileSystemFileHandle> {
  const parts = path.split('/');
  if (parts.some((p) => p === '..' || p === '.' || p === '')) throw new DOMException(t('files.outside', { path }), 'NotFoundError');
  let dir = folder;
  for (const name of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(name);
  return dir.getFileHandle(parts[parts.length - 1]!);
}

/** Folders never searched for parts: tool and program folders with thousands of files. */
const SKIPPED = new Set(['node_modules']);

/**
 * Files in the folder and below it whose names end with one of `extensions`, by path. Hidden folders
 * and SKIPPED are left out, and the search stops after `limit` entries (a whole Downloads folder can
 * hold far more): `truncated` then says the list is partial.
 */
export async function listFiles(folder: FileSystemDirectoryHandle, extensions: string[], limit = 20000): Promise<{ files: string[]; truncated: boolean }> {
  const found: string[] = [];
  let seen = 0;
  let truncated = false;
  const walk = async (dir: FileSystemDirectoryHandle, prefix: string, depth: number): Promise<void> => {
    for await (const [name, handle] of dir.entries()) {
      if (++seen > limit) {
        truncated = true;
        return;
      }
      if (handle.kind === 'directory') {
        if (!name.startsWith('.') && !SKIPPED.has(name) && depth < 8) await walk(handle as FileSystemDirectoryHandle, `${prefix}${name}/`, depth + 1);
      } else if (extensions.some((e) => name.toLowerCase().endsWith(e))) {
        found.push(`${prefix}${name}`);
      }
    }
  };
  await walk(folder, '', 0);
  return { files: found.sort((a, b) => a.localeCompare(b, 'zh-Hant')), truncated };
}

export async function readBytes(file: FileSystemFileHandle): Promise<Uint8Array> {
  return new Uint8Array(await (await file.getFile()).arrayBuffer());
}

/**
 * Writes the whole file. The browser writes a temporary copy and swaps it in when the stream closes,
 * so a failed save leaves the previous file intact.
 */
export async function writeFile(handle: FileSystemFileHandle, bytes: Uint8Array): Promise<void> {
  // a file of the browser's storage where handles cannot be written from the page (older Safari): through a worker
  if (typeof handle.createWritable !== 'function') return writeBrowserFile(handle, bytes, true);
  const h = handle as FileSystemFileHandle & PermissionMethods;
  if (h.queryPermission && h.requestPermission && (await h.queryPermission({ mode: 'readwrite' })) !== 'granted') {
    if ((await h.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error(t('files.noWrite'));
  }
  const stream = await handle.createWritable();
  await stream.write(bytes as Uint8Array<ArrayBuffer>);
  await stream.close();
}

/**
 * Writes new files into a folder, folders as needed (F2.8): paths relative to it, "/" separated. Nothing that was there is touched: the caller
 * has chosen names that are free. When one cannot be written, the ones this call made are taken away again, so no half of an import stays.
 */
export async function writeFilesInto(folder: FileSystemDirectoryHandle, files: readonly { path: string; bytes: Uint8Array }[]): Promise<void> {
  const made: { dir: FileSystemDirectoryHandle; name: string }[] = [];
  try {
    for (const f of files) {
      const parts = f.path.split('/');
      let dir = folder;
      for (const name of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(name, { create: true });
      const name = parts[parts.length - 1]!;
      const handle = await dir.getFileHandle(name, { create: true });
      made.push({ dir, name });
      await writeFile(handle, f.bytes);
    }
  } catch (e) {
    for (const m of made) {
      try {
        await m.dir.removeEntry(m.name);
      } catch {
        // could not be taken away either: the caller's message says what failed
      }
    }
    throw e;
  }
}

export function download(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
