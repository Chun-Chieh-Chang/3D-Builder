import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readZip, writeZip } from '@3db/io';
import {
  browserProject,
  browserProjectName,
  browserProjectOf,
  createBrowserProject,
  deleteBrowserProject,
  exportBrowserProject,
  exportDue,
  EXPORT_REMINDER_DAYS,
  filesOf,
  freeName,
  importBrowserProject,
  keepStorage,
  lastExport,
  listBrowserProjects,
  nameProblem,
  noteExport,
  pathProblem,
  projectFilesFromZip,
  writeBrowserFile,
} from '../src/browserProjects';

/**
 * ADR 0233. The browser's storage in memory, with the handle methods the module uses: the same shape as the origin private file system, where a
 * folder resolves the path of anything inside it and nothing outside. The browser itself is checked by tests/e2e/manual-browser-projects.js.
 */
class MemFile {
  readonly kind = 'file';
  data = new Uint8Array();
  writes = 0;
  constructor(readonly name: string) {}
  async getFile() {
    const data = this.data;
    return { name: this.name, arrayBuffer: async () => data.slice().buffer };
  }
  async createWritable() {
    let next = new Uint8Array();
    return {
      write: async (b: Uint8Array) => {
        next = b.slice();
      },
      close: async () => {
        this.data = next;
        this.writes++;
      },
    };
  }
}

class MemDir {
  readonly kind = 'directory';
  readonly children = new Map<string, MemDir | MemFile>();
  constructor(readonly name: string) {}
  async getDirectoryHandle(name: string, o?: { create?: boolean }): Promise<MemDir> {
    const c = this.children.get(name);
    if (c instanceof MemDir) return c;
    if (c || !o?.create) throw new DOMException(name, c ? 'TypeMismatchError' : 'NotFoundError');
    const d = new MemDir(name);
    this.children.set(name, d);
    return d;
  }
  async getFileHandle(name: string, o?: { create?: boolean }): Promise<MemFile> {
    const c = this.children.get(name);
    if (c instanceof MemFile) return c;
    if (c || !o?.create) throw new DOMException(name, c ? 'TypeMismatchError' : 'NotFoundError');
    const f = new MemFile(name);
    this.children.set(name, f);
    return f;
  }
  async removeEntry(name: string, o?: { recursive?: boolean }): Promise<void> {
    const c = this.children.get(name);
    if (!c) throw new DOMException(name, 'NotFoundError');
    if (c instanceof MemDir && c.children.size > 0 && !o?.recursive) throw new DOMException(name, 'InvalidModificationError');
    this.children.delete(name);
  }
  async *entries(): AsyncIterable<[string, MemDir | MemFile]> {
    for (const e of [...this.children]) yield e;
  }
  async resolve(h: unknown): Promise<string[] | null> {
    if (h === this) return [];
    for (const [name, c] of this.children) {
      if (c === h) return [name];
      if (c instanceof MemDir) {
        const below = await c.resolve(h);
        if (below) return [name, ...below];
      }
    }
    return null;
  }
}

const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);
const asDir = (d: MemDir) => d as unknown as FileSystemDirectoryHandle;

let root: MemDir;
let kept: Map<string, string>;
let persisted: boolean;
let persistAnswer: boolean;

beforeEach(() => {
  root = new MemDir('');
  kept = new Map();
  persisted = false;
  persistAnswer = true;
  vi.stubGlobal('navigator', {
    storage: {
      getDirectory: async () => root,
      persisted: async () => persisted,
      persist: async () => (persisted = persistAnswer),
      estimate: async () => ({ usage: 1, quota: 2 }),
    },
  });
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => void kept.set(k, v),
    removeItem: (k: string) => void kept.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('names a project or a file can have', () => {
  it('takes ordinary names, Chinese ones too', () => {
    for (const n of ['治具A', 'fixture 2', 'v1.2', '零件']) expect(nameProblem(n), n).toBeNull();
    expect(pathProblem('零件/削邊銷.3dbx')).toBeNull();
  });
  it('refuses what a folder on Windows cannot hold, and every way out of the project', () => {
    for (const n of ['', ' ', ' a', 'a ', '.', '..', 'a.', 'a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b', 'a\u0001b', 'x'.repeat(121)]) expect(nameProblem(n), JSON.stringify(n)).not.toBeNull();
    for (const p of ['../a.3dbx', 'a/../b.3dbx', './a.3dbx', 'a//b.3dbx', '/a.3dbx', 'a/', 'a\\b.3dbx']) expect(pathProblem(p), p).not.toBeNull();
  });
  it('numbers a taken name, keeping the extension at the end', () => {
    expect(freeName('銷.3dbx', new Set())).toBe('銷.3dbx');
    expect(freeName('銷.3dbx', new Set(['銷.3dbx']))).toBe('銷 (2).3dbx');
    expect(freeName('銷.3dbx', new Set(['銷.3dbx', '銷 (2).3dbx']))).toBe('銷 (3).3dbx');
    expect(freeName('治具', new Set(['治具']))).toBe('治具 (2)');
    expect(freeName('.hidden', new Set(['.hidden']))).toBe('.hidden (2)'); // a leading dot is not an extension
  });
});

describe('the projects in the storage', () => {
  it('are the folders of their own folder, and only those count as browser projects', async () => {
    expect(await listBrowserProjects()).toEqual([]);
    const a = await createBrowserProject('乙');
    await createBrowserProject('甲');
    expect(await listBrowserProjects()).toEqual(['乙', '甲'].sort((x, y) => x.localeCompare(y, 'zh-Hant')));
    expect(await browserProjectName(a)).toBe('乙');
    // the e2e tests keep their project folder at the root of the storage: that one is a picked folder, not a browser project
    const e2e = await root.getDirectoryHandle('3db-e2e', { create: true });
    expect(await browserProjectName(asDir(e2e))).toBeNull();
    expect(await browserProjectName(null)).toBeNull();
    // a folder inside a project is not a project, but what is inside one says which
    const sub = await a.getDirectoryHandle('零件', { create: true });
    expect(await browserProjectName(sub)).toBeNull();
    expect(await browserProjectOf(await sub.getFileHandle('銷.3dbx', { create: true }))).toBe('乙');
    expect(await browserProjectOf((await e2e.getFileHandle('x.3dbx', { create: true })) as unknown as FileSystemHandle)).toBeNull();
  });
  it('refuses a name that is taken or cannot be one, and makes nothing then', async () => {
    await createBrowserProject('治具');
    await expect(createBrowserProject('治具')).rejects.toThrow();
    await expect(createBrowserProject('a/b')).rejects.toThrow();
    await expect(createBrowserProject('')).rejects.toThrow();
    expect(await listBrowserProjects()).toEqual(['治具']);
  });
  it('deletes a project with everything in it, and forgets when it was exported', async () => {
    const p = await createBrowserProject('治具');
    await writeBrowserFile(await (await p.getDirectoryHandle('零件', { create: true })).getFileHandle('銷.3dbx', { create: true }), bytes('pin'));
    noteExport('治具');
    await deleteBrowserProject('治具');
    expect(await listBrowserProjects()).toEqual([]);
    expect(lastExport('治具')).toBeNull();
    await expect(browserProject('治具')).rejects.toThrow();
  });
});

describe('export and import', () => {
  it('a project goes out as a ZIP of its files at their paths and comes back the same', async () => {
    const p = await createBrowserProject('治具');
    const files: Record<string, string> = { '組合件.3dba': 'asm', '零件/削邊銷.3dbx': 'pin', '零件/深/定位板.3dbx': 'plate', '圖/組合件.3dbd': 'drawing' };
    for (const [path, body] of Object.entries(files)) {
      const parts = path.split('/');
      let dir = p;
      for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create: true });
      await writeBrowserFile(await dir.getFileHandle(parts.at(-1)!, { create: true }), bytes(body));
    }
    // a scratch file the worker writer left behind is not part of the project
    await p.getFileHandle('.組合件.3dba.writing', { create: true });
    const zip = await exportBrowserProject(p);
    const entries = await readZip(zip);
    expect(Object.fromEntries(entries.map((e) => [e.name, text(e.data)]))).toEqual(files);

    const name = await importBrowserProject('治具.zip', zip);
    expect(name).toBe('治具 (2)'); // the name was taken
    const back = await filesOf(await browserProject(name));
    expect(Object.fromEntries(back.map((e) => [e.name, text(e.data)]))).toEqual(files);
  });
  it('takes off the folder a ZIP made of a folder has at its top, and leaves out macOS\' extras', async () => {
    const entries = [
      { name: '治具/', data: new Uint8Array() },
      { name: '治具/組合件.3dba', data: bytes('asm') },
      { name: '治具/零件/銷.3dbx', data: bytes('pin') },
      { name: '__MACOSX/治具/._組合件.3dba', data: bytes('fork') },
      { name: '治具/.DS_Store', data: bytes('ds') },
    ];
    expect(projectFilesFromZip(entries).map((f) => f.path)).toEqual(['組合件.3dba', '零件/銷.3dbx']);
    // two folders at the top: kept as they are
    expect(projectFilesFromZip([{ name: 'a/x.3dbx', data: bytes('x') }, { name: 'b/y.3dbx', data: bytes('y') }]).map((f) => f.path)).toEqual(['a/x.3dbx', 'b/y.3dbx']);
  });
  it('refuses a ZIP whose paths leave the project, and an empty one, leaving no project behind', async () => {
    for (const bad of ['../evil.3dbx', 'a/../../evil.3dbx', '/etc/x.3dbx', 'a\\b.3dbx', 'con:x.3dbx']) {
      const zip = await writeZip([{ name: 'ok.3dbx', data: bytes('ok') }, { name: bad, data: bytes('evil') }]);
      await expect(importBrowserProject('壞.zip', zip), bad).rejects.toThrow();
    }
    await expect(importBrowserProject('空.zip', await writeZip([{ name: 'folder/', data: new Uint8Array() }]))).rejects.toThrow();
    await expect(importBrowserProject('壞.zip', bytes('not a zip'))).rejects.toThrow();
    expect(await listBrowserProjects()).toEqual([]);
    expect(root.children.has('..') || [...root.children.keys()].some((k) => k.includes('evil'))).toBe(false);
  });
  it('a ZIP named what cannot be a project name is imported under the default name', async () => {
    const name = await importBrowserProject('a:b.zip', await writeZip([{ name: 'x.3dbx', data: bytes('x') }]));
    expect(nameProblem(name)).toBeNull();
    expect(await listBrowserProjects()).toEqual([name]);
  });
});

describe('keeping the storage', () => {
  it('asks the browser to keep it, and says when it will not', async () => {
    expect(await keepStorage()).toBe(true);
    expect(persisted).toBe(true);
    persisted = false;
    persistAnswer = false;
    expect(await keepStorage()).toBe(false);
  });
  it('says nothing either way where the browser cannot keep it', async () => {
    vi.stubGlobal('navigator', { storage: { getDirectory: async () => root } });
    expect(await keepStorage()).toBeNull();
  });
  it('reminds to export a project never exported, and one exported longer ago than the reminder', () => {
    const now = Date.UTC(2026, 10, 3);
    expect(exportDue('治具', now)).toBe(true);
    noteExport('治具', now - (EXPORT_REMINDER_DAYS - 1) * 86400000);
    expect(exportDue('治具', now)).toBe(false);
    noteExport('治具', now - (EXPORT_REMINDER_DAYS + 1) * 86400000);
    expect(exportDue('治具', now)).toBe(true);
  });
  it('works without local storage (a private window): no date, always due', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    });
    noteExport('治具');
    expect(lastExport('治具')).toBeNull();
    expect(exportDue('治具')).toBe(true);
  });
});
