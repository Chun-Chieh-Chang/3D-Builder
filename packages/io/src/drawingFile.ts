import { t } from '@3db/i18n';
import { documentKind, parseAssembly, parseDrawing, serializeDrawing, type AssemblyDoc, type DrawingDoc } from '@3db/model';
import { DOCUMENT_ENTRY, documentEntry, isZip, zipEntries } from './container';
import { safeFileName } from './names';
import { partFromEntries, readOldPartFile, type PartFile } from './partFile';
import { writeZip } from './zip';

/**
 * The drawing file `.3dbd` (B1.1, B9.1): the same container as a part and an assembly, holding only `document.json`. The part or assembly a view shows stays in
 * its own file and is read again at every open, so a drawing always shows its model as it is now.
 */
export const DRAWING_FILE_EXTENSION = '.3dbd';

export function writeDrawingFile(doc: DrawingDoc): Promise<Uint8Array> {
  return writeZip([{ name: DOCUMENT_ENTRY, data: new TextEncoder().encode(serializeDrawing(doc)) }]);
}

export type AnyDocumentFile = ({ kind: 'part' } & PartFile) | { kind: 'assembly'; doc: AssemblyDoc } | { kind: 'drawing'; doc: DrawingDoc };

/** Opens a part, an assembly or a drawing, told apart by content rather than by the file's name. */
export async function readAnyDocumentFile(bytes: Uint8Array): Promise<AnyDocumentFile> {
  if (!isZip(bytes)) return { kind: 'part', ...readOldPartFile(bytes) };
  const files = await zipEntries(bytes);
  const text = documentEntry(files, t('file.kindFile'));
  const kind = documentKind(text);
  if (kind === 'assembly') return { kind, doc: parseAssembly(text) };
  if (kind === 'drawing') return { kind, doc: parseDrawing(text) };
  return { kind: 'part', ...(await partFromEntries(files)) };
}

/** The file name a drawing is offered to be saved under. */
export function drawingFileName(name: string): string {
  return `${safeFileName(name)}${DRAWING_FILE_EXTENSION}`;
}
