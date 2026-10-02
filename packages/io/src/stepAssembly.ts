import type { Kernel } from '@3db/kernel';
import { t } from '@3db/i18n';
import {
  applyAssemblyCommand,
  applyCommand,
  assemblyIdsInUse,
  createEmptyAssembly,
  IdAllocator,
  quatFromRows,
  relativePath,
  type AssemblyDoc,
  type Id,
  type Pose,
} from '@3db/model';
import { writeAssemblyFile } from './assemblyFile';
import { safeFileName } from './names';
import { stepAsPart } from './stepPart';
import { writePartFile } from './partFile';

/**
 * An assembly STEP as files (F2.8): what has to be written for a STEP file's structure to be a project. Each part product becomes a part
 * file (the product's shape as a STEP file taken as a part, with the colors of its faces as appearances), each assembly product that is
 * not the top a sub-assembly file (C15.4), the top the assembly file. A product is one file however many components use it.
 */

/** A product of the file, ready to be written: what the kernel read of it, with each part's shape already written out as STEP. */
export interface StepAssemblyPlan {
  prototypes: {
    name: string | null;
    /** Assemblies: the components. */
    children?: { name: string | null; prototype: number; rotation: number[]; translation: [number, number, number] }[];
    /** Parts: the shape as a STEP file, and its colors (see `StepAssemblyPrototype`). */
    part?: { step: Uint8Array; faceCount: number; faceColors?: (string | null)[]; color?: string | null };
  }[];
  root: number;
}

/**
 * Reads an assembly STEP and writes each part's shape out as a STEP file of its own, ready for `stepAssemblyFiles`. The part shapes are released.
 * Throws what the kernel says when the file cannot be used.
 */
export function stepAssemblyPlan(kernel: Kernel, data: Uint8Array | string): StepAssemblyPlan {
  const contents = kernel.readAssemblyStep(data);
  const encoder = new TextEncoder();
  try {
    return {
      root: contents.root,
      prototypes: contents.prototypes.map((p, i) => ({
        name: p.name,
        ...(p.children ? { children: p.children.map((c) => ({ name: c.name, prototype: c.prototype, rotation: c.rotation, translation: c.translation })) } : {}),
        ...(p.shape
          ? {
              part: {
                step: encoder.encode(kernel.exportStep(p.shape, p.name ?? t('stepasm.unnamed', { n: i + 1 }))),
                faceCount: kernel.topology(p.shape).faces.length,
                ...(p.faceColors ? { faceColors: p.faceColors } : {}),
                ...(p.color ? { color: p.color } : {}),
              },
            }
          : {}),
      })),
    };
  } finally {
    for (const p of contents.prototypes) if (p.shape) kernel.release(p.shape);
  }
}

export interface StepAssemblyFiles {
  /** Paths relative to the folder they are written into ("" is that folder). */
  files: { path: string; bytes: Uint8Array }[];
  /** The file to open: the assembly (or, for a STEP file that is one part, the part). */
  main: string;
  parts: number;
  subAssemblies: number;
  /** Things worth saying: a product without a shape, colors that could not be kept. */
  warnings: string[];
}

/** The folders an import writes into, next to the main file (named in the user's language). */
export const stepAssemblyFolders = () => ({ parts: t('stepasm.folderParts'), subs: t('stepasm.folderSubs') });

/**
 * The files of an assembly STEP's structure (F2.8). `stem` names the main file. File names come from the products' names, made safe and
 * kept apart where they repeat; the components' names are the files' names with their instance numbers, as everywhere (C15.1), so a
 * product used three times is `名稱<1>`, `名稱<2>`, `名稱<3>`. The first component of each assembly is fixed (C15.2); there are no mates, the
 * components are where the file puts them.
 */
export async function stepAssemblyFiles(plan: StepAssemblyPlan, stem: string, taken: Iterable<string> = []): Promise<StepAssemblyFiles> {
  const folders = stepAssemblyFolders();
  const files: StepAssemblyFiles['files'] = [];
  const warnings: string[] = [];
  // paths already in the folder are not written over: a name that is taken gets a number
  const used = new Set<string>([...taken].map((p) => p.toLowerCase()));
  const unique = (folder: string, name: string, ext: string): string => {
    const base = safeFileName(name).trim() || 'x';
    let path = folder ? `${folder}/${base}${ext}` : `${base}${ext}`;
    for (let n = 2; used.has(path.toLowerCase()); n++) path = folder ? `${folder}/${base} (${n})${ext}` : `${base} (${n})${ext}`;
    used.add(path.toLowerCase());
    return path;
  };
  const reached = new Map<number, string>();
  const reachedSub = { count: 0 };
  let parts = 0;
  const top = plan.prototypes[plan.root]!;

  const make = async (index: number, path: string): Promise<void> => {
    const proto = plan.prototypes[index]!;
    if (proto.part) {
      const file = await stepAsPart(proto.part.step, `${proto.name ?? stem}.step`);
      let doc = file.doc;
      if (proto.part.color) doc = applyCommand(doc, { type: 'setAppearance', target: { kind: 'part' }, color: proto.part.color });
      proto.part.faceColors?.forEach((color, i) => {
        if (color) doc = applyCommand(doc, { type: 'setAppearance', target: { kind: 'face', ref: { kind: 'face', name: `import1:f${i + 1}` } }, color });
      });
      files.push({ path, bytes: await writePartFile(doc, file.blobs) });
      parts += 1;
      return;
    }
    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    let doc: AssemblyDoc = createEmptyAssembly();
    const fileOf = new Map<string, Id>();
    const instances = new Map<string, number>();
    for (const child of proto.children ?? []) {
      const target = plan.prototypes[child.prototype];
      if (!target) continue;
      let at = reached.get(child.prototype);
      if (at === undefined) {
        const isPart = !!target.part;
        at = isPart ? unique(folders.parts, target.name ?? t('stepasm.unnamed', { n: child.prototype + 1 }), '.3dbx') : unique(folders.subs, target.name ?? t('stepasm.unnamed', { n: child.prototype + 1 }), '.3dba');
        reached.set(child.prototype, at);
        if (!isPart) reachedSub.count += 1;
        await make(child.prototype, at);
      }
      const ids = new IdAllocator(doc.idCounters, assemblyIdsInUse(doc));
      const rel = relativePath(folder, at);
      const known = fileOf.get(at);
      const file = known ? undefined : { id: ids.take('file'), path: rel };
      const fileId = known ?? file!.id;
      fileOf.set(at, fileId);
      const instance = (instances.get(at) ?? 0) + 1;
      instances.set(at, instance);
      const r = child.rotation;
      const placement: Pose = { position: child.translation, rotation: quatFromRows(r) };
      doc = applyAssemblyCommand(doc, {
        type: 'insertComponent',
        ...(file ? { file } : {}),
        component: { id: ids.take('comp'), file: fileId, instance, fixed: doc.components.length === 0, placement },
      });
    }
    if (doc.components.length === 0) warnings.push(t('stepasm.emptyAssembly', { name: proto.name ?? stem }));
    files.push({ path, bytes: await writeAssemblyFile(doc) });
  };

  if (top.part) {
    // the file is one part: it is opened as the part it is
    const path = unique('', stem, '.3dbx');
    await make(plan.root, path);
    return { files, main: path, parts, subAssemblies: 0, warnings };
  }
  const main = unique('', stem, '.3dba');
  reached.set(plan.root, main);
  await make(plan.root, main);
  return { files, main, parts, subAssemblies: reachedSub.count, warnings };
}
