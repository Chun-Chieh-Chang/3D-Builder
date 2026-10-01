import { t } from '@3db/i18n';
/**
 * Minimal ZIP writer and reader (PKWARE APPNOTE) for the part file: stored and DEFLATE entries,
 * UTF-8 names; no ZIP64, no encryption, no multi-disk archives. DEFLATE comes from the platform's
 * CompressionStream('deflate-raw'), which browsers and Node both provide, so nothing is added to
 * the dependencies.
 */

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipError';
  }
}

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const UTF8_NAMES = 0x0800;
const ENCRYPTED = 0x0001;
const STORED = 0;
const DEFLATED = 8;
const VERSION = 20; // 2.0: DEFLATE
// 1980-01-01 00:00, the first DOS date: the same entries always give the same bytes.
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;
const MAX32 = 0xffffffff;

let crcTable: Uint32Array | null = null;

/** CRC-32 (ISO 3309, polynomial 0xEDB88320), as ZIP stores it. */
export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = MAX32;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ MAX32) >>> 0;
}

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function record(size: number, fill: (v: DataView) => void): Uint8Array {
  const bytes = new Uint8Array(size);
  fill(new DataView(bytes.buffer));
  return bytes;
}

/** Entries are written in the given order; each is deflated unless that would not make it smaller. */
export async function writeZip(entries: ZipEntry[]): Promise<Uint8Array> {
  if (entries.length > 0xffff) throw new ZipError(t('zip.tooMany'));
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const deflated = await pipe(entry.data, new CompressionStream('deflate-raw'));
    const [method, body]: [number, Uint8Array] = deflated.length < entry.data.length ? [DEFLATED, deflated] : [STORED, entry.data];
    const crc = crc32(entry.data);
    if (entry.data.length >= MAX32 || offset >= MAX32) throw new ZipError(t('zip.tooBig'));
    const local = record(30, (v) => {
      v.setUint32(0, LOCAL, true);
      v.setUint16(4, VERSION, true);
      v.setUint16(6, UTF8_NAMES, true);
      v.setUint16(8, method, true);
      v.setUint16(10, DOS_TIME, true);
      v.setUint16(12, DOS_DATE, true);
      v.setUint32(14, crc, true);
      v.setUint32(18, body.length, true);
      v.setUint32(22, entry.data.length, true);
      v.setUint16(26, name.length, true);
      v.setUint16(28, 0, true);
    });
    const at = offset;
    central.push(
      record(46, (v) => {
        v.setUint32(0, CENTRAL, true);
        v.setUint16(4, VERSION, true);
        v.setUint16(6, VERSION, true);
        v.setUint16(8, UTF8_NAMES, true);
        v.setUint16(10, method, true);
        v.setUint16(12, DOS_TIME, true);
        v.setUint16(14, DOS_DATE, true);
        v.setUint32(16, crc, true);
        v.setUint32(20, body.length, true);
        v.setUint32(24, entry.data.length, true);
        v.setUint16(28, name.length, true);
        v.setUint32(42, at, true); // extra, comment, disk, attributes stay 0
      }),
      name,
    );
    parts.push(local, name, body);
    offset += local.length + name.length + body.length;
  }
  const size = central.reduce((n, c) => n + c.length, 0);
  if (offset + size >= MAX32) throw new ZipError(t('zip.tooBig'));
  const end = record(22, (v) => {
    v.setUint32(0, END, true);
    v.setUint16(8, entries.length, true);
    v.setUint16(10, entries.length, true);
    v.setUint32(12, size, true);
    v.setUint32(16, offset, true);
  });
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0));
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

/**
 * Reads every file entry (directories are skipped) through the central directory, which is
 * authoritative for sizes even when an entry was streamed with a data descriptor. Each entry's
 * CRC-32 is checked, so a damaged file is reported instead of being half read.
 */
export async function readZip(bytes: Uint8Array): Promise<ZipEntry[]> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end record is the last 22 bytes, unless an archive comment (at most 64 KB) follows it.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === END) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new ZipError(t('zip.notZip'));
  const count = view.getUint16(end + 10, true);
  const size = view.getUint32(end + 12, true);
  const start = view.getUint32(end + 16, true);
  if (count === 0xffff || size === MAX32 || start === MAX32) throw new ZipError(t('zip.zip64'));
  if (start + size > end) throw new ZipError(t('zip.dirBroken'));

  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  let p = start;
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || view.getUint32(p, true) !== CENTRAL) throw new ZipError(t('zip.dirBroken'));
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const packed = view.getUint32(p + 20, true);
    const length = view.getUint32(p + 24, true);
    const nameLength = view.getUint16(p + 28, true);
    const skip = view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    // Names without the UTF-8 flag are CP437; the names this format uses are ASCII, the same in both.
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLength));
    p += 46 + nameLength + skip;
    if (name.endsWith('/')) continue;
    if (flags & ENCRYPTED) throw new ZipError(t('zip.encrypted', { name }));
    if (packed === MAX32 || length === MAX32 || local === MAX32) throw new ZipError(t('zip.zip64'));
    if (local + 30 > bytes.length || view.getUint32(local, true) !== LOCAL) throw new ZipError(t('zip.entryBroken', { name }));
    const from = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    if (from + packed > bytes.length) throw new ZipError(t('zip.entryBroken', { name }));
    const raw = bytes.subarray(from, from + packed);
    let data: Uint8Array;
    if (method === STORED) data = raw.slice();
    else if (method === DEFLATED) {
      try {
        data = await pipe(raw, new DecompressionStream('deflate-raw'));
      } catch {
        throw new ZipError(t('zip.inflateFailed', { name }));
      }
    } else throw new ZipError(t('zip.method', { method, name }));
    if (data.length !== length || crc32(data) !== crc) throw new ZipError(t('zip.crc', { name }));
    entries.push({ name, data });
  }
  return entries;
}
