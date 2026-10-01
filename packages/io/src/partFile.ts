import { t } from '@3db/i18n';
import { parsePart, serializePart, type BlobRef, type PartDoc } from '@3db/model';
import { DOCUMENT_ENTRY, documentEntry, documentText, isZip, zipEntries } from './container';
import { safeFileName } from './names';
import { writeZip, type ZipEntry } from './zip';

/**
 * The part file `.3dbx` (B9.1, F7.1): a ZIP archive holding
 *
 *     document.json          the document exactly as serializePart writes it (canonical, diffable: B9.6)
 *     blobs/<sha256>.step    data the document imports (F2.1), named by content
 *
 * Nothing derived is stored (B-Rep, meshes, names, results): opening a file rebuilds them, so a
 * file can never disagree with its own design intent.
 */
export const PART_FILE_EXTENSION = '.3dbx';

const BLOB_EXTENSION: Record<BlobRef['kind'], string> = { step: 'step' };
const blobPath = (b: BlobRef) => `blobs/${b.sha256}.${BLOB_EXTENSION[b.kind]}`;

export interface PartFile {
  doc: PartDoc;
  /** Imported data by SHA-256 (hex). Data that is missing or does not match its hash is left out and reported in `warnings`. */
  blobs: Map<string, Uint8Array>;
  /** `json` for the bare document text saved before `.3dbx` existed: saving it again needs a new file name. */
  format: '3dbx' | 'json';
  warnings: string[];
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The document first, then each blob it references once; blobs it no longer references are dropped. */
export async function writePartFile(doc: PartDoc, blobs: ReadonlyMap<string, Uint8Array> = new Map()): Promise<Uint8Array> {
  const entries: ZipEntry[] = [{ name: DOCUMENT_ENTRY, data: new TextEncoder().encode(serializePart(doc)) }];
  const paths = new Map(doc.blobs.map((b) => [blobPath(b), b.sha256]));
  for (const [path, sha256] of [...paths].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const data = blobs.get(sha256);
    if (data) entries.push({ name: path, data });
  }
  return writeZip(entries);
}

/** The bare document text older versions saved (B9.2: old files keep opening). */
export function readOldPartFile(bytes: Uint8Array): PartFile {
  return { doc: parsePart(documentText(bytes, t('file.kindPart'), t('file.notDocText'))), blobs: new Map(), format: 'json', warnings: [] };
}

/** Opens a `.3dbx` file, or the bare document text older versions saved. */
export async function readPartFile(bytes: Uint8Array): Promise<PartFile> {
  return isZip(bytes) ? partFromEntries(await zipEntries(bytes)) : readOldPartFile(bytes);
}

/** The part in an opened `.3dbx` archive, with the data it imports. */
export async function partFromEntries(files: ReadonlyMap<string, Uint8Array>): Promise<PartFile> {
  const doc = parsePart(documentEntry(files, t('file.kindPart')));
  const blobs = new Map<string, Uint8Array>();
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const b of doc.blobs) {
    if (seen.has(b.sha256)) continue; // equal imports share one entry
    seen.add(b.sha256);
    const data = files.get(blobPath(b));
    if (!data) warnings.push(t('part.blobMissing', { id: b.id, path: blobPath(b) }));
    else if ((await sha256Hex(data)) !== b.sha256) warnings.push(t('part.blobHash', { id: b.id }));
    else blobs.set(b.sha256, data);
  }
  return { doc, blobs, format: '3dbx', warnings };
}

/** The file name a part is offered to be saved under: its name, made safe for file systems. */
export function partFileName(name: string): string {
  return `${safeFileName(name)}${PART_FILE_EXTENSION}`;
}
