/// <reference lib="webworker" />
/**
 * Writes a file of a project kept in the browser (ADR 0233) where the page cannot: a browser whose handles have no `createWritable` (older Safari)
 * still has `createSyncAccessHandle`, which exists only in a worker. The bytes go to a scratch file next to the target first, so a write the
 * storage has no room for fails there and the file being saved over stays as it was; then they are copied into the target and the scratch file goes.
 */
export interface OpfsWrite {
  id: number;
  /** The file's path from the storage's root, as `resolve` gives it. */
  path: string[];
  bytes: Uint8Array;
}
export type OpfsWritten = { id: number; ok: true } | { id: number; ok: false; why: string };

async function writeAll(file: FileSystemFileHandle, bytes: Uint8Array): Promise<void> {
  const access = await file.createSyncAccessHandle();
  try {
    access.truncate(0);
    let at = 0;
    while (at < bytes.length) {
      const n = access.write(bytes.subarray(at), { at });
      if (n <= 0) throw new Error('no room left in the browser storage');
      at += n;
    }
    access.flush();
  } finally {
    access.close();
  }
}

self.onmessage = async (e: MessageEvent<OpfsWrite>) => {
  const { id, path, bytes } = e.data;
  try {
    let dir = await navigator.storage.getDirectory();
    for (const name of path.slice(0, -1)) dir = await dir.getDirectoryHandle(name);
    const name = path[path.length - 1]!;
    const scratch = `.${name}.writing`;
    await writeAll(await dir.getFileHandle(scratch, { create: true }), bytes);
    await writeAll(await dir.getFileHandle(name, { create: true }), bytes);
    await dir.removeEntry(scratch);
    (self as DedicatedWorkerGlobalScope).postMessage({ id, ok: true } satisfies OpfsWritten);
  } catch (err) {
    (self as DedicatedWorkerGlobalScope).postMessage({ id, ok: false, why: err instanceof Error ? err.message : String(err) } satisfies OpfsWritten);
  }
};
