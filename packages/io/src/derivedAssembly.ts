import { t } from '@3db/i18n';
import { applyAssemblyCommand, applyCommand, assemblyIdsInUse, createEmptyAssembly, createEmptyPart, IdAllocator, relativePath, type AssemblyDoc, type Id } from '@3db/model';
import { writeAssemblyFile } from './assemblyFile';
import { safeFileName } from './names';
import { writePartFile } from './partFile';

/**
 * An assembly made from the bodies of a master model (C7.5, §2.9 step 4): one derived part file per body, each holding only where its body
 * comes from, and one assembly file with a component for each, in place (the bodies are already where the master has them) and fixed.
 */

export interface DerivedAssemblyInput {
  /** The file name of the master model, in the folder the files are written into ("夾具.3dbx"). */
  masterFile: string;
  /** What the assembly is called ("夾具"); the assembly file is 「<stem> 組合件」. */
  stem: string;
  /** The bodies of the master, in order, with the names they have there. */
  bodies: { id: Id; name: string }[];
  /** Paths already in the folder, which are not written over: a name that is taken gets a number. */
  taken?: Iterable<string>;
}

export interface DerivedAssemblyFiles {
  /** Paths relative to the folder of the master file. */
  files: { path: string; bytes: Uint8Array }[];
  /** The assembly file. */
  main: string;
  /** The derived part file of each body, by the body's id. */
  parts: Map<Id, string>;
}

export async function derivedAssemblyFiles(input: DerivedAssemblyInput): Promise<DerivedAssemblyFiles> {
  const files: DerivedAssemblyFiles['files'] = [];
  const used = new Set<string>([...(input.taken ?? [])].map((p) => p.toLowerCase()));
  const unique = (folder: string, name: string, ext: string): string => {
    const base = safeFileName(name).trim() || 'x';
    let path = folder ? `${folder}/${base}${ext}` : `${base}${ext}`;
    for (let n = 2; used.has(path.toLowerCase()); n++) path = folder ? `${folder}/${base} (${n})${ext}` : `${base} (${n})${ext}`;
    used.add(path.toLowerCase());
    return path;
  };
  const folder = t('stepasm.folderParts');
  const main = unique('', t('derived.assemblyName', { name: input.stem }), '.3dba');
  let doc: AssemblyDoc = createEmptyAssembly();
  const parts = new Map<Id, string>();
  for (const body of input.bodies) {
    const path = unique(folder, body.name || t('stepasm.unnamed', { n: parts.size + 1 }), '.3dbx');
    parts.set(body.id, path);
    const part = applyCommand(createEmptyPart(), {
      type: 'insertFeature',
      index: 0,
      feature: { id: 'derived1', type: 'derivedBody', name: body.name || t('feature.derivedBody'), suppressed: false, source: relativePath(folder, input.masterFile), body: body.id },
    });
    files.push({ path, bytes: await writePartFile(part) });
    const ids = new IdAllocator(doc.idCounters, assemblyIdsInUse(doc));
    const file = { id: ids.take('file'), path: relativePath('', path) };
    doc = applyAssemblyCommand(doc, {
      type: 'insertComponent',
      file,
      component: { id: ids.take('comp'), file: file.id, instance: 1, fixed: true, placement: { position: [0, 0, 0], rotation: [0, 0, 0, 1] } },
    });
  }
  files.push({ path: main, bytes: await writeAssemblyFile(doc) });
  return { files, main, parts };
}
