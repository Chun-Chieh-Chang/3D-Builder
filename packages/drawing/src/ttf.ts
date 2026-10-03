import { t } from '@3db/i18n';

/**
 * TrueType fonts for the PDF (F3.2): reading what the PDF needs from a font file (the characters it has, their widths and the metrics of the font) and cutting
 * the file down to the glyphs the drawing uses, so that a Chinese font of 15 MB costs a few hundred kilobytes in the PDF. A TrueType Collection (.ttc, such as
 * Microsoft JhengHei) is read at its first font. A font with PostScript outlines (OpenType 'OTTO') is not supported.
 */

export class FontError extends Error {}

export interface TrueTypeFont {
  /** The tables of the font, by tag: the bytes of each. */
  tables: Map<string, Uint8Array>;
  unitsPerEm: number;
  numGlyphs: number;
  /** The glyph of a character (a Unicode code point), 0 when the font has none. */
  glyphOf(codePoint: number): number;
  /** The advance of a glyph in font units. */
  advance(glyph: number): number;
  ascent: number;
  descent: number;
  /** The height of the capitals in font units (a guess of 0.7 em when the font does not say). */
  capHeight: number;
  /** [xMin, yMin, xMax, yMax] in font units. */
  bbox: [number, number, number, number];
  /** The PostScript name from the 'name' table (letters and digits only), or a made-up one. */
  name: string;
  /** Whether the font's license allows it to be embedded in a document (OS/2 fsType: not 'restricted'). */
  embeddable: boolean;
  /** The glyph numbers that make up a glyph: itself, and for a composite glyph the glyphs it is built from. */
  components(glyph: number): number[];
}

const u16 = (v: DataView, o: number) => v.getUint16(o);
const i16 = (v: DataView, o: number) => v.getInt16(o);
const u32 = (v: DataView, o: number) => v.getUint32(o);
const tag = (b: Uint8Array, o: number) => String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);

/** The tables of a TrueType font file (or of the first font of a collection), by tag. Throws a `FontError` that says why when it is not one this can use. */
export function readTables(bytes: Uint8Array): Map<string, Uint8Array> {
  if (bytes.length < 12) throw new FontError(t('font.notFont'));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let base = 0;
  if (tag(bytes, 0) === 'ttcf') base = u32(view, 12);
  const sfnt = tag(bytes, base);
  if (sfnt === 'OTTO') throw new FontError(t('font.cff'));
  if (!(u32(view, base) === 0x00010000 || sfnt === 'true')) throw new FontError(t('font.notFont'));
  const count = u16(view, base + 4);
  const tables = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    const rec = base + 12 + 16 * i;
    if (rec + 16 > bytes.length) throw new FontError(t('font.truncated'));
    const offset = u32(view, rec + 8);
    const length = u32(view, rec + 12);
    if (offset + length > bytes.length) throw new FontError(t('font.truncated'));
    tables.set(tag(bytes, rec), bytes.subarray(offset, offset + length));
  }
  return tables;
}

/** Reads a TrueType font (or the first of a collection). Throws a `FontError` that says why when it is not one this can use. */
export function readTrueType(bytes: Uint8Array): TrueTypeFont {
  const tables = readTables(bytes);
  for (const need of ['head', 'hhea', 'maxp', 'hmtx', 'cmap', 'loca', 'glyf']) if (!tables.has(need)) throw new FontError(t('font.missingTable', { table: need }));
  const dv = (name: string) => {
    const b = tables.get(name)!;
    return new DataView(b.buffer, b.byteOffset, b.byteLength);
  };
  const head = dv('head');
  const hhea = dv('hhea');
  const maxp = dv('maxp');
  const hmtx = dv('hmtx');
  const unitsPerEm = u16(head, 18);
  const longLoca = i16(head, 50) === 1;
  const numGlyphs = u16(maxp, 4);
  const hMetrics = u16(hhea, 34);
  const advance = (g: number): number => (g < hMetrics ? u16(hmtx, 4 * g) : u16(hmtx, 4 * (hMetrics - 1)));
  const glyphOf = cmapReader(tables.get('cmap')!);
  const loca = dv('loca');
  const glyf = tables.get('glyf')!;
  const range = (g: number): [number, number] => (longLoca ? [u32(loca, 4 * g), u32(loca, 4 * g + 4)] : [2 * u16(loca, 2 * g), 2 * u16(loca, 2 * g + 2)]);
  const components = (g: number): number[] => {
    const out = [g];
    const [from, to] = range(g);
    if (to <= from) return out;
    const gv = new DataView(glyf.buffer, glyf.byteOffset + from, to - from);
    if (i16(gv, 0) >= 0) return out;
    let o = 10;
    for (;;) {
      const flags = u16(gv, o);
      out.push(u16(gv, o + 2));
      o += 4 + (flags & 1 ? 4 : 2);
      if (flags & 8) o += 2;
      else if (flags & 0x40) o += 4;
      else if (flags & 0x80) o += 8;
      if (!(flags & 0x20)) break;
    }
    return out;
  };
  let capHeight = Math.round(0.7 * unitsPerEm);
  let embeddable = true;
  const os2 = tables.get('OS/2');
  if (os2 && os2.length >= 10) {
    const ov = dv('OS/2');
    embeddable = (u16(ov, 8) & 0x0002) === 0;
    if (u16(ov, 0) >= 2 && os2.length >= 90) capHeight = i16(ov, 88) || capHeight;
  }
  return {
    tables,
    unitsPerEm,
    numGlyphs,
    glyphOf,
    advance,
    ascent: i16(hhea, 4),
    descent: i16(hhea, 6),
    capHeight,
    bbox: [i16(head, 36), i16(head, 38), i16(head, 40), i16(head, 42)],
    name: postScriptName(tables.get('name')),
    embeddable,
    components,
  };
}

/** The character → glyph map of a 'cmap' table: Unicode, format 12 (all of Unicode) or format 4 (the Basic Multilingual Plane). */
function cmapReader(cmap: Uint8Array): (cp: number) => number {
  const v = new DataView(cmap.buffer, cmap.byteOffset, cmap.byteLength);
  const n = u16(v, 2);
  let best: { offset: number; format: number } | null = null;
  for (let i = 0; i < n; i++) {
    const platform = u16(v, 4 + 8 * i);
    const encoding = u16(v, 6 + 8 * i);
    const offset = u32(v, 8 + 8 * i);
    const format = u16(v, offset);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode || (format !== 4 && format !== 12)) continue;
    if (!best || format === 12) best = { offset, format };
  }
  if (!best) throw new FontError(t('font.noUnicode'));
  const o = best.offset;
  if (best.format === 12) {
    const groups = u32(v, o + 12);
    return (cp) => {
      let lo = 0;
      let hi = groups - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const g = o + 16 + 12 * mid;
        if (cp < u32(v, g)) hi = mid - 1;
        else if (cp > u32(v, g + 4)) lo = mid + 1;
        else return u32(v, g + 8) + (cp - u32(v, g));
      }
      return 0;
    };
  }
  const segs = u16(v, o + 6) / 2;
  const end = o + 14;
  const start = end + 2 * segs + 2;
  const delta = start + 2 * segs;
  const range = delta + 2 * segs;
  return (cp) => {
    if (cp > 0xffff) return 0;
    for (let s = 0; s < segs; s++) {
      if (cp > u16(v, end + 2 * s)) continue;
      const first = u16(v, start + 2 * s);
      if (cp < first) return 0;
      const ro = u16(v, range + 2 * s);
      if (ro === 0) return (cp + i16(v, delta + 2 * s)) & 0xffff;
      const g = u16(v, range + 2 * s + ro + 2 * (cp - first));
      return g === 0 ? 0 : (g + i16(v, delta + 2 * s)) & 0xffff;
    }
    return 0;
  };
}

/** The PostScript name (name ID 6) from a 'name' table, reduced to what a PDF font name may hold. */
function postScriptName(name: Uint8Array | undefined): string {
  if (name && name.length >= 6) {
    const v = new DataView(name.buffer, name.byteOffset, name.byteLength);
    const n = u16(v, 2);
    const strings = u16(v, 4);
    for (let i = 0; i < n; i++) {
      const rec = 6 + 12 * i;
      if (u16(v, rec + 6) !== 6) continue;
      const platform = u16(v, rec);
      const len = u16(v, rec + 8);
      const off = strings + u16(v, rec + 10);
      let s = '';
      if (platform === 3 || platform === 0) for (let k = 0; k + 1 < len; k += 2) s += String.fromCharCode(u16(v, off + k));
      else for (let k = 0; k < len; k++) s += String.fromCharCode(name[off + k]!);
      const clean = s.replace(/[^A-Za-z0-9-]/g, '');
      if (clean) return clean;
    }
  }
  return 'EmbeddedFont';
}

const align4 = (n: number) => (n + 3) & ~3;

function checksum(b: Uint8Array): number {
  let sum = 0;
  const padded = new Uint8Array(align4(b.length));
  padded.set(b);
  const v = new DataView(padded.buffer);
  for (let i = 0; i < padded.length; i += 4) sum = (sum + v.getUint32(i)) >>> 0;
  return sum;
}

/**
 * The font cut down to `glyphs` (and glyph 0, and the glyphs a composite glyph is built from): the same glyph numbers, so that text written as glyph numbers
 * still reads; the outlines of every other glyph are emptied. Only the tables a PDF reader needs are kept.
 */
export function subsetTrueType(font: TrueTypeFont, glyphs: Iterable<number>): Uint8Array {
  const keep = new Set<number>([0]);
  for (const g of glyphs) for (const c of font.components(g)) keep.add(c);
  const loca = font.tables.get('loca')!;
  const glyf = font.tables.get('glyf')!;
  const lv = new DataView(loca.buffer, loca.byteOffset, loca.byteLength);
  const longLoca = i16(new DataView(font.tables.get('head')!.buffer, font.tables.get('head')!.byteOffset), 50) === 1;
  const range = (g: number): [number, number] => (longLoca ? [u32(lv, 4 * g), u32(lv, 4 * g + 4)] : [2 * u16(lv, 2 * g), 2 * u16(lv, 2 * g + 2)]);
  const chunks: Uint8Array[] = [];
  const newLoca = new Uint8Array(4 * (font.numGlyphs + 1));
  const nl = new DataView(newLoca.buffer);
  let at = 0;
  for (let g = 0; g < font.numGlyphs; g++) {
    nl.setUint32(4 * g, at);
    if (!keep.has(g)) continue;
    const [from, to] = range(g);
    if (to > from) {
      const piece = glyf.subarray(from, to);
      chunks.push(piece);
      const pad = align4(piece.length) - piece.length;
      if (pad) chunks.push(new Uint8Array(pad));
      at += align4(piece.length);
    }
  }
  nl.setUint32(4 * font.numGlyphs, at);
  const newGlyf = new Uint8Array(at);
  let o = 0;
  for (const c of chunks) {
    newGlyf.set(c, o);
    o += c.length;
  }
  const head = font.tables.get('head')!.slice();
  const hv = new DataView(head.buffer);
  hv.setUint32(8, 0); // checkSumAdjustment, set below
  hv.setInt16(50, 1); // long loca
  const out = new Map<string, Uint8Array>([
    ['head', head],
    ['hhea', font.tables.get('hhea')!],
    ['maxp', font.tables.get('maxp')!],
    ['hmtx', font.tables.get('hmtx')!],
    ['loca', newLoca],
    ['glyf', newGlyf],
  ]);
  for (const optional of ['cvt ', 'fpgm', 'prep']) if (font.tables.has(optional)) out.set(optional, font.tables.get(optional)!);
  return assemble(out);
}

/** A font file from its tables (sorted by tag, each padded to four bytes) with the checksums right. */
export function assemble(tables: Map<string, Uint8Array>): Uint8Array {
  const tags = [...tables.keys()].sort();
  const n = tags.length;
  let offset = 12 + 16 * n;
  const placed = tags.map((tg) => {
    const data = tables.get(tg)!;
    const at = offset;
    offset += align4(data.length);
    return { tg, data, at };
  });
  const file = new Uint8Array(offset);
  const v = new DataView(file.buffer);
  v.setUint32(0, 0x00010000);
  v.setUint16(4, n);
  let pow = 1;
  let log = 0;
  while (pow * 2 <= n) {
    pow *= 2;
    log++;
  }
  v.setUint16(6, pow * 16);
  v.setUint16(8, log);
  v.setUint16(10, n * 16 - pow * 16);
  placed.forEach((p, i) => {
    const rec = 12 + 16 * i;
    for (let k = 0; k < 4; k++) file[rec + k] = p.tg.charCodeAt(k);
    v.setUint32(rec + 4, checksum(p.data));
    v.setUint32(rec + 8, p.at);
    v.setUint32(rec + 12, p.data.length);
    file.set(p.data, p.at);
  });
  const head = placed.find((p) => p.tg === 'head');
  if (head) v.setUint32(head.at + 8, (0xb1b0afba - checksum(file)) >>> 0);
  return file;
}
