import { baseName, type PartDoc } from '@3db/model';

/** Extensions of the files a part is saved to or made from; the part's name is the file name without them. */
const PART_FILE = /(\.3db)?\.json$|\.3dbx$|\.(step|stp)$/i;
const ASSEMBLY_FILE = /\.3dba$/i;

/**
 * The part's name as SolidWorks shows it: the name of the file it was saved to or opened from. A
 * part never saved goes by its part-name property (the demo part), else by its untitled name
 * ("零件1"). The name heads the FeatureManager and names the STEP product and file.
 */
export function partName(doc: PartDoc, fileName: string | null, untitled = '零件1'): string {
  const fromFile = fileName?.replace(PART_FILE, '').trim();
  if (fromFile) return fromFile;
  return doc.properties['零件名稱']?.trim() || untitled;
}

/** An assembly is named after its file too; never saved, it is 「組合件1」, 「組合件2」 … */
export function assemblyName(fileName: string | null, untitled = '組合件1'): string {
  return fileName?.replace(ASSEMBLY_FILE, '').trim() || untitled;
}

/** The part in a file, by the file's name: 「零件/削邊銷.3dbx」 → 「削邊銷」. */
export function partNameOf(path: string): string {
  return baseName(path).replace(PART_FILE, '');
}

/** A component as the FeatureManager shows it: its part's name and instance number, 「削邊銷<2>」. */
export function componentName(path: string | undefined, instance: number): string {
  return `${(path && partNameOf(path)) || '?'}<${instance}>`;
}

/** A name made safe for file systems. */
export const safeFileName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '_');

export function stepFileName(name: string): string {
  return `${safeFileName(name)}.step`;
}

export function stlFileName(name: string): string {
  return `${safeFileName(name)}.stl`;
}

export function imageFileName(name: string): string {
  return `${safeFileName(name)}.png`;
}
