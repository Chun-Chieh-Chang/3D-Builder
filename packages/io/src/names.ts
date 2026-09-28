import type { PartDoc } from '@3db/model';

/** Extensions of the files a part is saved to or made from; the part's name is the file name without them. */
const PART_FILE = /(\.3db)?\.json$|\.3dbx$|\.(step|stp)$/i;

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

/** A name made safe for file systems. */
export const safeFileName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '_');

export function stepFileName(name: string): string {
  return `${safeFileName(name)}.step`;
}
