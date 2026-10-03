import { t } from '@3db/i18n';
import { dirName, joinPath, type AssemblyDoc, type Id, type SourceTree } from '@3db/model';
import { readDocumentFile, sha256Hex } from '@3db/io';
import type { AssemblyResult } from '@3db/regen';
import type { Remote } from 'comlink';
import { fileIn } from '../files';
import type { KernelApi } from '../worker/protocol';
import { buildSource, type PartInfo, type SourceMessages, type SourceStatus } from './partSource';

/**
 * An assembly read from the project folder for a drawing (C16.6): its document, every part it uses built in the worker, what each component is down through the
 * sub-assemblies, and where the mates put them. What a drawing's views of an assembly are drawn from; nothing here is kept in the drawing.
 */
export interface AssemblyData {
  doc: AssemblyDoc;
  /** What each component of the assembly is (as the worker is told). */
  trees: Record<Id, SourceTree>;
  /** Where the components are once the mates are solved. */
  solution: AssemblyResult;
  /** What each part is, by its content key: its properties (the parts list reads the vendor and the part number), and whether it counts. */
  parts: Map<string, PartInfo>;
}

type Node = { kind: 'part'; key: string; path: string; info: PartInfo | undefined } | { kind: 'assembly'; doc: AssemblyDoc; children: Record<Id, Node>; path: string };

const MAX_DEPTH = 8;

/**
 * Reads the assembly at `path` of the project: its sub-assemblies and parts, once each; the parts are built (as for a part drawn alone). A file that is missing
 * or cannot be read is an error that names it: a drawing never leaves a part out without saying so. Returns what was read and a key made of the content of every
 * file that went into it, so that the lines of its views are made again when any part or assembly changes and not otherwise.
 */
export async function buildAssemblySource(api: Remote<KernelApi>, project: FileSystemDirectoryHandle, path: string, messages: SourceMessages): Promise<SourceStatus> {
  const stamps = new Map<string, string>();
  const hashes: string[] = [];
  const problems: string[] = [];
  const parts = new Map<string, PartInfo>();
  const cache = new Map<string, Promise<Node | null>>();

  const load = (at: string, trail: readonly string[]): Promise<Node | null> => {
    const known = cache.get(at);
    if (known && !trail.includes(at)) return known;
    const made = (async (): Promise<Node | null> => {
      if (/\.3dba$/i.test(at)) {
        if (trail.includes(at) || trail.length >= MAX_DEPTH) {
          problems.push(messages.cycle(at));
          return null;
        }
        let bytes: Uint8Array;
        try {
          const file = await (await fileIn(project, at)).getFile();
          stamps.set(at, `${file.lastModified}:${file.size}`);
          bytes = new Uint8Array(await file.arrayBuffer());
        } catch {
          problems.push(messages.missing(at));
          return null;
        }
        const opened = await readDocumentFile(bytes);
        if (opened.kind !== 'assembly') {
          problems.push(messages.notAssembly(at));
          return null;
        }
        hashes.push(`${at}=${await sha256Hex(bytes)}`);
        const children: Record<Id, Node> = {};
        for (const c of opened.doc.components) {
          const file = opened.doc.files.find((f) => f.id === c.file);
          if (!file || c.suppressed) continue;
          const child = await load(joinPath(dirName(at), file.path), [...trail, at]);
          if (child) children[c.id] = child;
        }
        return { kind: 'assembly', doc: opened.doc, children, path: at };
      }
      const status = await buildSource(api, project, at, messages);
      if (status.status !== 'ok') {
        problems.push(status.status === 'loading' ? messages.missing(at) : status.message);
        return null;
      }
      for (const [p, s] of status.stamps) stamps.set(p, s);
      hashes.push(`${at}=${status.key}`);
      if (status.info) parts.set(status.key, status.info);
      return { kind: 'part', key: status.key, path: at, info: status.info };
    })();
    cache.set(at, made);
    return made;
  };

  try {
    const top = await load(path, []);
    if (!top || top.kind !== 'assembly') return { status: 'error', message: problems.length > 0 ? problems.slice(0, 5).join(t('cmd.listSeparator')) : messages.notAssembly(path) };
    if (problems.length > 0) return { status: 'error', message: problems.slice(0, 5).join(t('cmd.listSeparator')) };
    const treeOf = (n: Node): SourceTree => (n.kind === 'part' ? { kind: 'part', key: n.key, path: n.path } : { kind: 'assembly', doc: n.doc, path: n.path, children: Object.fromEntries(Object.entries(n.children).map(([id, c]) => [id, treeOf(c)])) });
    const trees: Record<Id, SourceTree> = {};
    for (const [id, c] of Object.entries(top.children)) trees[id] = treeOf(c);
    const solution = await api.solveAssembly(top.doc, trees);
    const key = await sha256Hex(new TextEncoder().encode([...new Set(hashes)].sort().join('\n')));
    return { status: 'ok', key, stamps, assembly: { doc: top.doc, trees, solution, parts } };
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}
