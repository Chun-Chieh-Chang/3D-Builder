import { describe, expect, it, vi } from 'vitest';
import { folderAccess, pathIn } from '../../apps/web/src/files';

describe('files.ts FileSystemHandle timeout guards (2026-11-20 RSI)', () => {
  it('folderAccess(folder, false) resolves false instead of hanging when queryPermission never settles', async () => {
    vi.useFakeTimers();
    try {
      const stalled = {
        kind: 'directory',
        name: 'stalled',
        queryPermission: () => new Promise<PermissionState>(() => {}),
      } as unknown as FileSystemDirectoryHandle;

      const p = folderAccess(stalled, false);
      await vi.advanceTimersByTimeAsync(1100);
      await expect(p).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('folderAccess(folder, false) returns true immediately when queryPermission grants read', async () => {
    const ok = {
      kind: 'directory',
      name: 'ok',
      queryPermission: async () => 'granted' as PermissionState,
    } as unknown as FileSystemDirectoryHandle;

    await expect(folderAccess(ok, false)).resolves.toBe(true);
  });

  it('pathIn(folder, file) resolves null instead of hanging when folder.resolve never settles', async () => {
    vi.useFakeTimers();
    try {
      const stalled = {
        kind: 'directory',
        name: 'stalled',
        resolve: () => new Promise<string[] | null>(() => {}),
      } as unknown as FileSystemDirectoryHandle;
      const file = { kind: 'file', name: 'a.3dbd' } as unknown as FileSystemFileHandle;

      const p = pathIn(stalled, file);
      await vi.advanceTimersByTimeAsync(1100);
      await expect(p).resolves.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('pathIn(folder, file) returns null on rejection and joins relative path when resolved', async () => {
    const file = { kind: 'file', name: 'a.3dbd' } as unknown as FileSystemFileHandle;
    const rejecting = {
      kind: 'directory',
      name: 'bad',
      resolve: async () => {
        throw new Error('stale handle');
      },
    } as unknown as FileSystemDirectoryHandle;
    const valid = {
      kind: 'directory',
      name: 'proj',
      resolve: async () => ['sub', 'a.3dbd'],
    } as unknown as FileSystemDirectoryHandle;

    await expect(pathIn(rejecting, file)).resolves.toBeNull();
    await expect(pathIn(valid, file)).resolves.toBe('sub/a.3dbd');
  });
});
