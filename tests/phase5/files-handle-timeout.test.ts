import { describe, expect, it, vi } from 'vitest';
import { folderAccess, pathIn, pickProjectFolder } from '../../apps/web/src/files';

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

describe('pickProjectFolder startIn', () => {
  async function withDirectoryPicker(
    impl: (options?: { id?: string; mode?: 'read' | 'readwrite'; startIn?: FileSystemHandle }) => Promise<FileSystemDirectoryHandle>,
    run: () => Promise<void>,
  ) {
    const hadWindow = 'window' in globalThis;
    const prevDesc = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const prevPicker = (globalThis as { window?: { showDirectoryPicker?: unknown } }).window?.showDirectoryPicker;
    if (hadWindow && (globalThis as { window?: object }).window) {
      ((globalThis as unknown) as { window: { showDirectoryPicker?: unknown } }).window.showDirectoryPicker = impl;
    } else {
      Object.defineProperty(globalThis, 'window', { value: { showDirectoryPicker: impl }, configurable: true, writable: true });
    }
    try {
      await run();
    } finally {
      if (hadWindow && (globalThis as { window?: object }).window) {
        if (prevPicker === undefined) delete ((globalThis as unknown) as { window: { showDirectoryPicker?: unknown } }).window.showDirectoryPicker;
        else ((globalThis as unknown) as { window: { showDirectoryPicker?: unknown } }).window.showDirectoryPicker = prevPicker;
      } else if (prevDesc) {
        Object.defineProperty(globalThis, 'window', prevDesc);
      } else {
        delete (globalThis as { window?: unknown }).window;
      }
    }
  }

  const fakeDir = { kind: 'directory', name: 'proj' } as unknown as FileSystemDirectoryHandle;
  const fakeFile = { kind: 'file', name: 'part.3dbd' } as unknown as FileSystemFileHandle;

  it('passes startIn when a handle is provided', async () => {
    const calls: Array<{ id?: string; mode?: 'read' | 'readwrite'; startIn?: FileSystemHandle }> = [];
    await withDirectoryPicker(async (options) => {
      calls.push(options ?? {});
      return fakeDir;
    }, async () => {
      const picked = await pickProjectFolder('read', fakeFile);
      expect(picked).toBe(fakeDir);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({ id: 'project-folder', mode: 'read', startIn: fakeFile });
    });
  });

  it('omits startIn when omitted or null', async () => {
    const calls: Array<Record<string, unknown>> = [];
    await withDirectoryPicker(async (options) => {
      calls.push((options ?? {}) as Record<string, unknown>);
      return fakeDir;
    }, async () => {
      await expect(pickProjectFolder('read')).resolves.toBe(fakeDir);
      await expect(pickProjectFolder('readwrite', null)).resolves.toBe(fakeDir);
      expect(calls).toHaveLength(2);
      expect('startIn' in calls[0]!).toBe(false);
      expect('startIn' in calls[1]!).toBe(false);
      expect(calls[1]).toEqual({ id: 'project-folder', mode: 'readwrite' });
    });
  });

  it('retries once without startIn when startIn is rejected with a non-AbortError', async () => {
    const calls: Array<Record<string, unknown>> = [];
    await withDirectoryPicker(async (options) => {
      calls.push((options ?? {}) as Record<string, unknown>);
      if (calls.length === 1) throw new TypeError('OPFS handle cannot seed native picker');
      return fakeDir;
    }, async () => {
      const picked = await pickProjectFolder('readwrite', fakeFile);
      expect(picked).toBe(fakeDir);
      expect(calls).toHaveLength(2);
      expect(calls[0]!.startIn).toBe(fakeFile);
      expect('startIn' in calls[1]!).toBe(false);
    });
  });

  it('returns null without retrying when user cancels on the first attempt with startIn', async () => {
    let callCount = 0;
    await withDirectoryPicker(async () => {
      callCount += 1;
      throw new DOMException('cancelled', 'AbortError');
    }, async () => {
      await expect(pickProjectFolder('read', fakeFile)).resolves.toBeNull();
      expect(callCount).toBe(1);
    });
  });

  it('returns null when the fallback retry without startIn is cancelled', async () => {
    let callCount = 0;
    await withDirectoryPicker(async () => {
      callCount += 1;
      if (callCount === 1) throw new DOMException('restricted', 'NotAllowedError');
      throw new DOMException('cancelled', 'AbortError');
    }, async () => {
      await expect(pickProjectFolder('read', fakeFile)).resolves.toBeNull();
      expect(callCount).toBe(2);
    });
  });

  it('rethrows non-AbortError without retrying when no startIn was given', async () => {
    let callCount = 0;
    await withDirectoryPicker(async () => {
      callCount += 1;
      throw new DOMException('blocked', 'SecurityError');
    }, async () => {
      await expect(pickProjectFolder('read')).rejects.toThrow('blocked');
      expect(callCount).toBe(1);
    });
  });
});
