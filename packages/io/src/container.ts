import { FormatError } from '@3db/model';
import { readZip, ZipError } from './zip';

/**
 * The container shared by every document file (`.3dbx` parts, `.3dba` assemblies): a ZIP archive whose
 * `document.json` is the document exactly as it serializes (canonical, diffable: B9.6). Other entries
 * hold data the document refers to. Nothing derived is stored.
 */
export const DOCUMENT_ENTRY = 'document.json';

export const isZip = (b: Uint8Array): boolean => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/** Document text; `what` names the file in the error ("零件檔"). */
export function documentText(bytes: Uint8Array, what: string, hint = ''): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes); // a leading BOM is dropped
  } catch {
    throw new FormatError(`不是 3D-Builder ${what}${hint}`);
  }
}

/** The archive's entries by name. */
export async function zipEntries(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  try {
    return new Map((await readZip(bytes)).map((e) => [e.name, e.data]));
  } catch (e) {
    throw e instanceof ZipError ? new FormatError(e.message) : e;
  }
}

export function documentEntry(files: ReadonlyMap<string, Uint8Array>, what: string): string {
  const document = files.get(DOCUMENT_ENTRY);
  if (!document) throw new FormatError(`不是 3D-Builder ${what}（缺少 ${DOCUMENT_ENTRY}）`);
  return documentText(document, what);
}
