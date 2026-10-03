import type { Remote } from 'comlink';
import { fileIn } from '../files';
import type { KernelApi } from '../worker/protocol';
import { contentKey, gatherSources } from './sources';

/** A part (or STEP file) read from the project folder and built in the worker, ready for the drawing to ask for its views (C16.2). */
export type SourceStatus = { status: 'loading' } | { status: 'ok'; key: string; stamps: Map<string, string> } | { status: 'missing' | 'error'; message: string };

/**
 * Builds the part file at `path` of the project for the worker, once per content (so an unchanged part is not built again), with the master files of
 * its derived bodies (C7.5). Returns what was read: its key, and the stamps of the files it came from, to notice when one is saved again.
 */
export async function buildSource(api: Remote<KernelApi>, project: FileSystemDirectoryHandle, path: string, messages: { missing: (path: string) => string; assembly: (path: string) => string }): Promise<SourceStatus> {
  if (path === '..' || path.startsWith('../')) return { status: 'missing', message: messages.missing(path) };
  if (/\.3dba$/i.test(path)) return { status: 'error', message: messages.assembly(path) };
  try {
    const file = await (await fileIn(project, path)).getFile();
    const stamps = new Map<string, string>([[path, `${file.lastModified}:${file.size}`]]);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const masters = await gatherSources(project, path, bytes);
    for (const [p, s] of masters.stamps) stamps.set(p, s);
    const key = await contentKey(bytes, masters.sources);
    const build = await api.buildPart(key, bytes, undefined, masters.sources.length > 0 ? masters.sources : undefined);
    if (!build.mesh && build.problems.length > 0) return { status: 'error', message: build.problems.join('; ') };
    return { status: 'ok', key, stamps };
  } catch (e) {
    if (e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError')) return { status: 'missing', message: messages.missing(path) };
    return { status: 'error', message: e instanceof Error ? e.message : String(e) };
  }
}
