import { ASSEMBLY_FILE_EXTENSION, PART_FILE_EXTENSION } from '@3db/io';

/**
 * Local files (F7.1). Chrome and Edge have the File System Access API: a part is opened and saved
 * in place, like a desktop program. Other browsers fall back to a file input and a download.
 *
 * An assembly refers to its parts by path (B9.4), and a web page may only read files the user has
 * granted. So assemblies work inside a project folder the user picks once: the assembly and the
 * parts it uses are in that folder or below it.
 */

interface PickerType {
  description: string;
  accept: Record<string, string[]>;
}

interface PickerOptions {
  id?: string;
  types?: PickerType[];
  suggestedName?: string;
  /** The folder the dialog opens in. */
  startIn?: FileSystemHandle;
}

type PermissionState = 'granted' | 'denied' | 'prompt';

/** Chromium's permission methods on handles (not in the DOM typings yet). */
interface PermissionMethods {
  queryPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(options: { mode: 'readwrite' }): Promise<PermissionState>;
}

declare global {
  interface Window {
    showOpenFilePicker?: (options?: PickerOptions) => Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?: (options?: PickerOptions) => Promise<FileSystemFileHandle>;
    showDirectoryPicker?: (options?: { id?: string; mode?: 'read' | 'readwrite'; startIn?: FileSystemHandle }) => Promise<FileSystemDirectoryHandle>;
  }
}

/** One id: the pickers reopen in the folder last used for parts. */
const PICKER_ID = '3d-builder-parts';
const PART_TYPE: PickerType = { description: '3D-Builder 零件', accept: { 'application/octet-stream': [PART_FILE_EXTENSION] } };
/** Parts saved before `.3dbx` were bare document text (`.3db.json`). */
const OLD_PART_TYPE: PickerType = { description: '3D-Builder 零件（舊版 .3db.json）', accept: { 'application/json': ['.json'] } };
const STEP_TYPE: PickerType = { description: 'STEP 檔', accept: { 'application/step': ['.step', '.stp'] } };
const ASSEMBLY_TYPE: PickerType = { description: '3D-Builder 組合件', accept: { 'application/x-3db-assembly': [ASSEMBLY_FILE_EXTENSION] } };
/** The first type is the dialog's default filter: everything 「開啟舊檔」 can open. */
const ANY_TYPE: PickerType = {
  description: '所有支援的檔案',
  accept: { 'application/octet-stream': [PART_FILE_EXTENSION, ASSEMBLY_FILE_EXTENSION], ...STEP_TYPE.accept, ...OLD_PART_TYPE.accept },
};

const acceptOf = (types: PickerType[]) => types.flatMap((t) => Object.values(t.accept).flat()).join(',');

/** A STEP file by name, or by its first bytes when the name says nothing. */
export function isStepFile(file: OpenedFile): boolean {
  if (/\.(step|stp)$/i.test(file.name)) return true;
  return new TextDecoder().decode(file.bytes.subarray(0, 64)).trimStart().startsWith('ISO-10303-21');
}

export interface OpenedFile {
  name: string;
  bytes: Uint8Array;
  /** Null where the browser cannot write files back, or for a file that must be saved under a new name. */
  handle: FileSystemFileHandle | null;
}

const cancelled = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

/** 「開啟舊檔」: a part, an assembly, or a STEP file to start a part from; null when the user cancels. */
export function pickFileToOpen(startIn: FileSystemDirectoryHandle | null = null): Promise<OpenedFile | null> {
  return pick([ANY_TYPE, PART_TYPE, ASSEMBLY_TYPE, STEP_TYPE, OLD_PART_TYPE], startIn);
}

/** 「輸入 STEP」: a STEP file to import into the part. */
export function pickStepFile(): Promise<OpenedFile | null> {
  return pick([STEP_TYPE]);
}

/** 「插入零組件」→「瀏覽」: a part file, starting in the project folder. */
export function pickPartFile(startIn: FileSystemDirectoryHandle): Promise<OpenedFile | null> {
  return pick([PART_TYPE], startIn);
}

async function pick(types: PickerType[], startIn: FileSystemDirectoryHandle | null = null): Promise<OpenedFile | null> {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({ id: PICKER_ID, types, ...(startIn ? { startIn } : {}) });
      if (!handle) return null;
      const file = await handle.getFile();
      return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), handle };
    } catch (e) {
      if (cancelled(e)) return null;
      throw e;
    }
  }
  const file = await chooseFile(acceptOf(types));
  return file && { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), handle: null };
}

function chooseFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** Asks where to save: a handle, null when the user cancels, or 'download' where files cannot be written. */
export async function pickSaveTarget(suggestedName: string): Promise<FileSystemFileHandle | 'download' | null> {
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
  if (!window.showSaveFilePicker) throw new Error(FOLDERS_UNSUPPORTED);
  try {
    return await window.showSaveFilePicker({ id: PICKER_ID, suggestedName, types: [ASSEMBLY_TYPE], startIn: folder });
  } catch (e) {
    if (cancelled(e)) return null;
    throw e;
  }
}

export const FOLDERS_UNSUPPORTED = '組合件需要能存取資料夾的瀏覽器（Chrome 或 Edge）';

/** The project folder (B9.4): the folder picker; null when the user cancels. */
export async function pickProjectFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (!window.showDirectoryPicker) throw new Error(FOLDERS_UNSUPPORTED);
  try {
    return await window.showDirectoryPicker({ id: 'project-folder', mode: 'read' });
  } catch (e) {
    if (cancelled(e)) return null;
    throw e;
  }
}

/** A file's path inside the folder ("零件/銷.3dbx"), or null when it lies elsewhere. */
export async function pathIn(folder: FileSystemDirectoryHandle, file: FileSystemFileHandle): Promise<string | null> {
  const parts = await folder.resolve(file);
  return parts ? parts.join('/') : null;
}

/** The file at `path` inside the folder. Throws NotFoundError (DOMException) when it is not there. */
export async function fileIn(folder: FileSystemDirectoryHandle, path: string): Promise<FileSystemFileHandle> {
  const parts = path.split('/');
  if (parts.some((p) => p === '..' || p === '.' || p === '')) throw new DOMException(`不在專案資料夾內：${path}`, 'NotFoundError');
  let dir = folder;
  for (const name of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(name);
  return dir.getFileHandle(parts[parts.length - 1]!);
}

/** Files in the folder and below it whose names end with `extension`, by path; hidden folders are skipped. */
export async function listFiles(folder: FileSystemDirectoryHandle, extension: string, limit = 2000): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: FileSystemDirectoryHandle, prefix: string, depth: number): Promise<void> => {
    for await (const [name, handle] of dir.entries()) {
      if (found.length >= limit) return;
      if (handle.kind === 'directory') {
        if (!name.startsWith('.') && depth < 8) await walk(handle as FileSystemDirectoryHandle, `${prefix}${name}/`, depth + 1);
      } else if (name.toLowerCase().endsWith(extension)) {
        found.push(`${prefix}${name}`);
      }
    }
  };
  await walk(folder, '', 0);
  return found.sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}

export async function readBytes(file: FileSystemFileHandle): Promise<Uint8Array> {
  return new Uint8Array(await (await file.getFile()).arrayBuffer());
}

/**
 * Writes the whole file. The browser writes a temporary copy and swaps it in when the stream closes,
 * so a failed save leaves the previous file intact.
 */
export async function writeFile(handle: FileSystemFileHandle, bytes: Uint8Array): Promise<void> {
  const h = handle as FileSystemFileHandle & PermissionMethods;
  if (h.queryPermission && h.requestPermission && (await h.queryPermission({ mode: 'readwrite' })) !== 'granted') {
    if ((await h.requestPermission({ mode: 'readwrite' })) !== 'granted') throw new Error('沒有寫入這個檔案的權限');
  }
  const stream = await handle.createWritable();
  await stream.write(bytes as Uint8Array<ArrayBuffer>);
  await stream.close();
}

export function download(name: string, data: BlobPart, type: string): void {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
