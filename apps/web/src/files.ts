import { PART_FILE_EXTENSION } from '@3db/io';

/**
 * Local files (F7.1). Chrome and Edge have the File System Access API: a part is opened and saved
 * in place, like a desktop program. Other browsers fall back to a file input and a download.
 */

interface PickerType {
  description: string;
  accept: Record<string, string[]>;
}

interface PickerOptions {
  id?: string;
  types?: PickerType[];
  suggestedName?: string;
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
  }
}

/** One id: the pickers reopen in the folder last used for parts. */
const PICKER_ID = '3d-builder-parts';
const PART_TYPE: PickerType = { description: '3D-Builder 零件', accept: { 'application/octet-stream': [PART_FILE_EXTENSION] } };
/** Parts saved before `.3dbx` were bare document text (`.3db.json`). */
const OLD_PART_TYPE: PickerType = { description: '3D-Builder 零件（舊版 .3db.json）', accept: { 'application/json': ['.json'] } };
const STEP_TYPE: PickerType = { description: 'STEP 檔', accept: { 'application/step': ['.step', '.stp'] } };
/** The first type is the dialog's default filter: everything 「開啟舊檔」 can open. */
const ANY_TYPE: PickerType = { description: '所有支援的檔案', accept: { ...PART_TYPE.accept, ...STEP_TYPE.accept, ...OLD_PART_TYPE.accept } };

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

/** 「開啟舊檔」: a part, or a STEP file to start a part from; null when the user cancels. */
export function pickFileToOpen(): Promise<OpenedFile | null> {
  return pick([ANY_TYPE, PART_TYPE, STEP_TYPE, OLD_PART_TYPE]);
}

/** 「輸入 STEP」: a STEP file to import into the part. */
export function pickStepFile(): Promise<OpenedFile | null> {
  return pick([STEP_TYPE]);
}

async function pick(types: PickerType[]): Promise<OpenedFile | null> {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({ id: PICKER_ID, types });
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
