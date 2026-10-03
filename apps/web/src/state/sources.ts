import { dirName, joinPath, type PartDoc } from '@3db/model';
import { isStepData, readPartFile, sha256Hex } from '@3db/io';
import { fileIn } from '../files';
import type { SourceFileData } from '../worker/protocol';

/**
 * The master files of a part's derived bodies (C7.5), read from the project folder for the worker: for each derived body, the file it names (relative to
 * the part), and in turn the files that one is derived from. A file that is not there is left out (the rebuild says which); a file that comes round
 * again is left without its own sources, so a cycle ends and the rebuild reports it.
 */
export interface GatheredSources {
  sources: SourceFileData[];
  /** Every file read, by project path, with the stamp it had (size and modification time): what tells that a master changed after the part was built. */
  stamps: Map<string, string>;
}

const MAX_DEPTH = 8;

/** The master files a document's derived bodies name, once each. */
const refsOf = (doc: PartDoc): string[] => [...new Set(doc.features.flatMap((f) => (f.type === 'derivedBody' ? [f.source] : [])))];

/** `source` is the part file's bytes, or the document as it is now (an open part, which may differ from its file). */
export async function gatherSources(project: FileSystemDirectoryHandle, path: string, source: Uint8Array | PartDoc): Promise<GatheredSources> {
  const stamps = new Map<string, string>();
  const walk = async (from: string, data: Uint8Array | PartDoc, trail: string[]): Promise<SourceFileData[]> => {
    let refs: string[];
    try {
      if (data instanceof Uint8Array) {
        if (isStepData(data)) return [];
        refs = refsOf((await readPartFile(data)).doc);
      } else refs = refsOf(data);
    } catch {
      return [];
    }
    const out: SourceFileData[] = [];
    for (const ref of refs) {
      const at = joinPath(dirName(from), ref);
      try {
        const file = await (await fileIn(project, at)).getFile();
        stamps.set(at, `${file.lastModified}:${file.size}`);
        const bytes = new Uint8Array(await file.arrayBuffer());
        const sources = trail.includes(at) || trail.length >= MAX_DEPTH ? [] : await walk(at, bytes, [...trail, at]);
        out.push({ ref, path: at, bytes, ...(sources.length > 0 ? { sources } : {}) });
      } catch {
        // not there: the rebuild of the derived body says so
      }
    }
    return out;
  };
  return { sources: await walk(path, source, [path]), stamps };
}

/**
 * What a part file is as built: its own bytes and those of every master it is derived from, so that a part is built again when a master changes
 * and not otherwise (the worker keeps a built part by this key). Without masters it is the hash of the file.
 */
export async function contentKey(bytes: Uint8Array, sources: readonly SourceFileData[]): Promise<string> {
  const own = await sha256Hex(bytes);
  if (sources.length === 0) return own;
  const parts = await Promise.all(sources.map(async (s) => `${s.ref}=${await contentKey(s.bytes, s.sources ?? [])}`));
  return sha256Hex(new TextEncoder().encode([own, ...parts].join('|')));
}
