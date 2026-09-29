import { documentKind, parseAssembly, serializeAssembly, type AssemblyDoc } from '@3db/model';
import { DOCUMENT_ENTRY, documentEntry, isZip, zipEntries } from './container';
import { safeFileName } from './names';
import { partFromEntries, readOldPartFile, type PartFile } from './partFile';
import { writeZip } from './zip';

/**
 * The assembly file `.3dba` (B1.1, B9.1): the same container as a part, holding only `document.json`.
 * The parts stay in their own files; the document refers to them by relative path (B9.4) and every
 * open reads them again, so an assembly always shows its parts as they are now.
 */
export const ASSEMBLY_FILE_EXTENSION = '.3dba';

export function writeAssemblyFile(doc: AssemblyDoc): Promise<Uint8Array> {
  return writeZip([{ name: DOCUMENT_ENTRY, data: new TextEncoder().encode(serializeAssembly(doc)) }]);
}

export type DocumentFile = ({ kind: 'part' } & PartFile) | { kind: 'assembly'; doc: AssemblyDoc };

/** Opens a part or an assembly, told apart by content rather than by the file's name. */
export async function readDocumentFile(bytes: Uint8Array): Promise<DocumentFile> {
  if (!isZip(bytes)) return { kind: 'part', ...readOldPartFile(bytes) }; // only parts were ever bare text
  const files = await zipEntries(bytes);
  const text = documentEntry(files, '檔案');
  if (documentKind(text) === 'assembly') return { kind: 'assembly', doc: parseAssembly(text) };
  return { kind: 'part', ...(await partFromEntries(files)) };
}

/** The file name an assembly is offered to be saved under. */
export function assemblyFileName(name: string): string {
  return `${safeFileName(name)}${ASSEMBLY_FILE_EXTENSION}`;
}
