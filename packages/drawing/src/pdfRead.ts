import { t } from '@3db/i18n';
import { PT } from './pdf';
import { readTables } from './ttf';

/**
 * A reader for the PDF that `toPdf` writes, and a check of what it reads (F3.2): the header, the cross-reference table (every offset on the object it names),
 * the trailer, the page tree, the content stream (the paths and the text, with the font each text is in), the fonts (the standard font; the embedded one with its
 * descriptor, widths, ToUnicode map and the font file, whose checksum is checked). It reads no more of PDF than the writer uses (no compressed streams, no object
 * streams). Until the PDF is opened in a viewer, it is the proof that the file says what the scene says.
 */

export class PdfError extends Error {}

export type PdfValue = number | string | boolean | null | PdfName | PdfRef | PdfString | PdfValue[] | PdfDict;
export class PdfName {
  constructor(readonly name: string) {}
}
export class PdfRef {
  constructor(
    readonly num: number,
    readonly gen: number,
  ) {}
}
export class PdfString {
  constructor(readonly bytes: number[]) {}
}
export interface PdfDict {
  [key: string]: PdfValue;
}

export interface PdfObject {
  value: PdfValue;
  stream?: Uint8Array;
}

export interface PdfPath {
  /** In points: x, y, x, y … */
  points: number[];
  closed: boolean;
  filled: boolean;
  /** Points. */
  width: number;
  dash: number[];
}

export interface PdfText {
  font: string;
  size: number;
  /** The text matrix: a b c d e f. */
  matrix: number[];
  /** The characters, as the document's font says them. */
  text: string;
  /** Glyph numbers (embedded font) or character codes (standard font). */
  codes: number[];
}

export interface PdfDocument {
  version: string;
  objects: Map<number, PdfObject>;
  trailer: PdfDict;
  /** The pages: the size in points, the paths and the text of each. */
  pages: { mediaBox: number[]; fonts: Map<string, PdfValue>; paths: PdfPath[]; texts: PdfText[] }[];
  /** What is wrong with the file (the cross-reference table, the streams): empty when nothing is. */
  problems: string[];
}

const latin1 = (b: Uint8Array, from = 0, to = b.length) => {
  let s = '';
  for (let i = from; i < to; i++) s += String.fromCharCode(b[i]!);
  return s;
};

const WHITE = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]);

/** A parser of PDF syntax over bytes. */
class Parser {
  constructor(
    readonly b: Uint8Array,
    public i = 0,
  ) {}

  skip(): void {
    for (;;) {
      while (this.i < this.b.length && WHITE.has(this.b[this.i]!)) this.i++;
      if (this.b[this.i] === 0x25) while (this.i < this.b.length && this.b[this.i] !== 10 && this.b[this.i] !== 13) this.i++;
      else return;
    }
  }

  /** The next value; `operator` is returned as a string for a bare keyword (content streams). */
  value(): PdfValue | { op: string } {
    this.skip();
    const c = this.b[this.i];
    if (c === undefined) throw new PdfError(t('pdf.eof'));
    if (c === 0x2f) {
      this.i++;
      let s = '';
      while (this.i < this.b.length && !WHITE.has(this.b[this.i]!) && !DELIM.has(this.b[this.i]!)) s += String.fromCharCode(this.b[this.i++]!);
      return new PdfName(s);
    }
    if (c === 0x28) return this.literal();
    if (c === 0x3c && this.b[this.i + 1] === 0x3c) return this.dict();
    if (c === 0x3c) return this.hex();
    if (c === 0x5b) {
      this.i++;
      const out: PdfValue[] = [];
      for (;;) {
        this.skip();
        if (this.b[this.i] === 0x5d) {
          this.i++;
          return out;
        }
        out.push(this.value() as PdfValue);
      }
    }
    let word = '';
    while (this.i < this.b.length && !WHITE.has(this.b[this.i]!) && !DELIM.has(this.b[this.i]!)) word += String.fromCharCode(this.b[this.i++]!);
    if (word === '') throw new PdfError(t('pdf.syntax', { at: this.i }));
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(word)) {
      const n = Number(word);
      // an indirect reference: two integers and R
      if (Number.isInteger(n) && n >= 0 && /^\d+$/.test(word)) {
        const save = this.i;
        this.skip();
        const g = this.word();
        if (/^\d+$/.test(g)) {
          this.skip();
          if (this.word() === 'R') return new PdfRef(n, Number(g));
        }
        this.i = save;
      }
      return n;
    }
    if (word === 'true') return true;
    if (word === 'false') return false;
    if (word === 'null') return null;
    return { op: word };
  }

  word(): string {
    let w = '';
    while (this.i < this.b.length && !WHITE.has(this.b[this.i]!) && !DELIM.has(this.b[this.i]!)) w += String.fromCharCode(this.b[this.i++]!);
    return w;
  }

  literal(): PdfString {
    this.i++;
    const out: number[] = [];
    let depth = 1;
    while (this.i < this.b.length) {
      const c = this.b[this.i++]!;
      if (c === 0x5c) {
        const d = this.b[this.i++]!;
        if (d >= 0x30 && d <= 0x37) {
          let v = d - 0x30;
          for (let k = 0; k < 2 && this.b[this.i]! >= 0x30 && this.b[this.i]! <= 0x37; k++) v = v * 8 + (this.b[this.i++]! - 0x30);
          out.push(v & 0xff);
        } else out.push(d === 0x6e ? 10 : d === 0x72 ? 13 : d === 0x74 ? 9 : d);
      } else if (c === 0x28) {
        depth++;
        out.push(c);
      } else if (c === 0x29) {
        if (--depth === 0) return new PdfString(out);
        out.push(c);
      } else out.push(c);
    }
    throw new PdfError(t('pdf.eof'));
  }

  hex(): PdfString {
    this.i++;
    let h = '';
    while (this.i < this.b.length && this.b[this.i] !== 0x3e) {
      const c = String.fromCharCode(this.b[this.i++]!);
      if (!/\s/.test(c)) h += c;
    }
    this.i++;
    if (h.length % 2) h += '0';
    const out: number[] = [];
    for (let k = 0; k < h.length; k += 2) out.push(parseInt(h.slice(k, k + 2), 16));
    return new PdfString(out);
  }

  dict(): PdfDict {
    this.i += 2;
    const out: PdfDict = {};
    for (;;) {
      this.skip();
      if (this.b[this.i] === 0x3e && this.b[this.i + 1] === 0x3e) {
        this.i += 2;
        return out;
      }
      const key = this.value();
      if (!(key instanceof PdfName)) throw new PdfError(t('pdf.syntax', { at: this.i }));
      out[key.name] = this.value() as PdfValue;
    }
  }
}

const isName = (v: PdfValue | undefined, name?: string): v is PdfName => v instanceof PdfName && (name === undefined || v.name === name);

/** Reads a PDF. Throws a `PdfError` for a file that is not one; problems with the cross-reference table and the streams are in `problems`. */
export function readPdf(bytes: Uint8Array): PdfDocument {
  const problems: string[] = [];
  const header = latin1(bytes, 0, 8);
  const version = /^%PDF-(\d\.\d)/.exec(header)?.[1];
  if (!version) throw new PdfError(t('pdf.noHeader'));
  const tail = latin1(bytes, Math.max(0, bytes.length - 64));
  const sx = /startxref\s+(\d+)\s+%%EOF\s*$/.exec(tail);
  if (!sx) throw new PdfError(t('pdf.noStartxref'));
  const xrefAt = Number(sx[1]);
  const p = new Parser(bytes, xrefAt);
  p.skip();
  if (p.word() !== 'xref') throw new PdfError(t('pdf.noXref'));
  // the table: subsections of "first count" and 20-byte entries
  const offsets = new Map<number, number>();
  for (;;) {
    p.skip();
    const save = p.i;
    const first = p.word();
    if (first === 'trailer') break;
    if (!/^\d+$/.test(first)) {
      p.i = save;
      throw new PdfError(t('pdf.badXref'));
    }
    p.skip();
    const count = Number(p.word());
    p.skip();
    for (let k = 0; k < count; k++) {
      const off = p.word();
      p.skip();
      const gen = p.word();
      p.skip();
      const kind = p.word();
      p.skip();
      if (!/^\d{10}$/.test(off) || !/^\d{5}$/.test(gen) || (kind !== 'n' && kind !== 'f')) throw new PdfError(t('pdf.badXref'));
      if (kind === 'n') offsets.set(Number(first) + k, Number(off));
    }
  }
  const trailerValue = p.value();
  if (typeof trailerValue !== 'object' || trailerValue === null || trailerValue instanceof PdfName || Array.isArray(trailerValue) || trailerValue instanceof PdfRef || trailerValue instanceof PdfString) throw new PdfError(t('pdf.badTrailer'));
  const trailer = trailerValue as PdfDict;

  const objects = new Map<number, PdfObject>();
  for (const [num, off] of offsets) {
    const q = new Parser(bytes, off);
    q.skip();
    const a = q.word();
    q.skip();
    const g = q.word();
    q.skip();
    const o = q.word();
    if (Number(a) !== num || g !== '0' || o !== 'obj') {
      problems.push(t('pdf.xrefOffset', { num }));
      continue;
    }
    const value = q.value() as PdfValue;
    const obj: PdfObject = { value };
    q.skip();
    const after = q.i;
    if (latin1(bytes, after, after + 6) === 'stream') {
      let start = after + 6;
      if (bytes[start] === 13) start++;
      if (bytes[start] === 10) start++;
      const dict = value as PdfDict;
      const length = dict.Length;
      if (typeof length !== 'number') {
        problems.push(t('pdf.streamLength', { num }));
        continue;
      }
      if (dict.Filter !== undefined) problems.push(t('pdf.filter', { num }));
      obj.stream = bytes.subarray(start, start + length);
      const end = new Parser(bytes, start + length);
      end.skip();
      if (end.word() !== 'endstream') problems.push(t('pdf.streamLength', { num }));
    }
    objects.set(num, obj);
  }
  const size = trailer.Size;
  if (typeof size !== 'number' || size !== Math.max(...offsets.keys()) + 1) problems.push(t('pdf.size'));

  const doc: PdfDocument = { version, objects, trailer, pages: [], problems };
  const resolve = (v: PdfValue | undefined): PdfValue | undefined => (v instanceof PdfRef ? objects.get(v.num)?.value : v);
  const dictOf = (v: PdfValue | undefined): PdfDict | undefined => {
    const r = resolve(v);
    return r !== null && typeof r === 'object' && !(r instanceof PdfName) && !(r instanceof PdfRef) && !(r instanceof PdfString) && !Array.isArray(r) ? (r as PdfDict) : undefined;
  };

  const root = dictOf(trailer.Root);
  if (!root || !isName(root.Type, 'Catalog')) {
    problems.push(t('pdf.noCatalog'));
    return doc;
  }
  const pagesNode = dictOf(root.Pages);
  const kids = pagesNode && Array.isArray(pagesNode.Kids) ? pagesNode.Kids : [];
  if (!pagesNode || pagesNode.Count !== kids.length) problems.push(t('pdf.pageCount'));
  for (const kid of kids) {
    const page = dictOf(kid);
    if (!page || !isName(page.Type, 'Page')) {
      problems.push(t('pdf.noPage'));
      continue;
    }
    const mediaBox = (resolve(page.MediaBox) as number[] | undefined) ?? [];
    if (mediaBox.length !== 4 || !(mediaBox[2]! > mediaBox[0]! && mediaBox[3]! > mediaBox[1]!)) problems.push(t('pdf.mediaBox'));
    const fonts = new Map<string, PdfValue>();
    const fontDict = dictOf(dictOf(page.Resources)?.Font);
    for (const [name, ref] of Object.entries(fontDict ?? {})) fonts.set(name, ref);
    const content = page.Contents instanceof PdfRef ? objects.get(page.Contents.num)?.stream : undefined;
    if (!content) {
      problems.push(t('pdf.noContents'));
      continue;
    }
    doc.pages.push({ mediaBox, fonts, ...contentOf(content, (name) => dictOf(fonts.get(name)), dictOf, objects, problems) });
  }
  return doc;
}

/** A ToUnicode map: glyph → string, from its bfchar blocks. */
export function readToUnicode(stream: Uint8Array): Map<number, string> {
  const text = latin1(stream);
  const out = new Map<number, string>();
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1]!.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      let s = '';
      for (let k = 0; k < m[2]!.length; k += 4) s += String.fromCharCode(parseInt(m[2]!.slice(k, k + 4), 16));
      out.set(parseInt(m[1]!, 16), s);
    }
  }
  return out;
}

function contentOf(
  content: Uint8Array,
  fontOf: (name: string) => PdfDict | undefined,
  dictOf: (v: PdfValue | undefined) => PdfDict | undefined,
  objects: Map<number, PdfObject>,
  problems: string[],
): { paths: PdfPath[]; texts: PdfText[] } {
  const p = new Parser(content);
  const paths: PdfPath[] = [];
  const texts: PdfText[] = [];
  let width = 1;
  let dash: number[] = [];
  let current: number[] = [];
  let closedPath = false;
  let size = 0;
  let fontName = '';
  let matrix = [1, 0, 0, 1, 0, 0];
  const stack: PdfValue[] = [];
  const toUnicode = new Map<string, Map<number, string>>();
  const decode = (font: string, codes: number[]): string => {
    const f = fontOf(font);
    if (!f) {
      problems.push(t('pdf.noFont', { font }));
      return '';
    }
    if (isName(f.Subtype, 'Type0')) {
      let map = toUnicode.get(font);
      if (!map) {
        const ref = f.ToUnicode;
        const stream = ref instanceof PdfRef ? objects.get(ref.num)?.stream : undefined;
        map = stream ? readToUnicode(stream) : new Map();
        toUnicode.set(font, map);
      }
      return codes.map((c) => map!.get(c) ?? '�').join('');
    }
    return String.fromCharCode(...codes); // WinAnsi: the codes of Latin-1 are Latin-1
  };
  for (;;) {
    p.skip();
    if (p.i >= content.length) break;
    const v = p.value();
    if (typeof v === 'object' && v !== null && 'op' in v && !(v instanceof PdfName) && !(v instanceof PdfRef) && !(v instanceof PdfString) && !Array.isArray(v)) {
      const op = (v as { op: string }).op;
      const n = (k: number) => stack[stack.length - k] as number;
      switch (op) {
        case 'w':
          width = n(1);
          break;
        case 'd':
          dash = ((stack[stack.length - 2] as number[]) ?? []).slice();
          break;
        case 'm':
          current = [n(2), n(1)];
          closedPath = false;
          break;
        case 'l':
          current.push(n(2), n(1));
          break;
        case 'h':
          closedPath = true;
          break;
        case 'S':
        case 'f': {
          paths.push({ points: [...current], closed: closedPath, filled: op === 'f', width, dash });
          current = [];
          break;
        }
        case 'Tf':
          fontName = (stack[stack.length - 2] as PdfName).name;
          size = n(1);
          break;
        case 'Tm':
          matrix = [n(6), n(5), n(4), n(3), n(2), n(1)];
          break;
        case 'Tj': {
          const s = stack[stack.length - 1] as PdfString;
          const codes = isName(fontOf(fontName)?.Subtype, 'Type0') ? pairs16(s.bytes) : s.bytes;
          texts.push({ font: fontName, size, matrix, codes, text: decode(fontName, codes) });
          break;
        }
        default:
          break;
      }
      stack.length = 0;
    } else stack.push(v as PdfValue);
  }
  void dictOf;
  return { paths, texts };
}

/** Bytes as 16-bit codes (the glyph numbers of an Identity-H font). */
const pairs16 = (b: number[]): number[] => {
  const out: number[] = [];
  for (let i = 0; i + 1 < b.length; i += 2) out.push(b[i]! * 256 + b[i + 1]!);
  return out;
};

/** The paths of a page in millimetres (what the scene's polylines were), for comparing with the scene. */
export const pathsInMm = (paths: readonly PdfPath[]): PdfPath[] => paths.map((p) => ({ ...p, points: p.points.map((v) => v / PT) }));

/**
 * What is wrong with a PDF that was read (empty: nothing): the problems the reader found, and the fonts: a font a text uses has to be in the page's resources, an
 * embedded font has its descriptor, widths, map to Unicode and a font file with the tables of a TrueType font and the checksum a font file has.
 */
export function checkPdf(doc: PdfDocument): string[] {
  const problems = [...doc.problems];
  if (doc.pages.length === 0) problems.push(t('pdf.noPages'));
  const ref = (v: PdfValue | undefined) => (v instanceof PdfRef ? doc.objects.get(v.num) : undefined);
  for (const [num, obj] of doc.objects) {
    const dict = obj.value as PdfDict;
    if (dict && typeof dict === 'object' && !Array.isArray(dict) && !(dict instanceof PdfName) && isName(dict.Subtype, 'Type0')) {
      const descendants = dict.DescendantFonts;
      const cid = Array.isArray(descendants) ? (ref(descendants[0]!)?.value as PdfDict | undefined) : undefined;
      if (!cid || !isName(cid.Subtype, 'CIDFontType2') || !Array.isArray(cid.W)) problems.push(t('pdf.cidFont', { num }));
      if (!ref(dict.ToUnicode)?.stream) problems.push(t('pdf.toUnicode', { num }));
      const descriptor = cid && (ref(cid.FontDescriptor)?.value as PdfDict | undefined);
      const file = descriptor && ref(descriptor.FontFile2)?.stream;
      if (!descriptor || !file) problems.push(t('pdf.fontFile', { num }));
      else {
        try {
          const tables = readTables(file);
          for (const need of ['head', 'hhea', 'maxp', 'hmtx', 'loca', 'glyf']) if (!tables.has(need)) problems.push(t('font.missingTable', { table: need }));
          const v = new DataView(file.buffer, file.byteOffset, file.byteLength);
          let sum = 0;
          const padded = new Uint8Array((file.length + 3) & ~3);
          padded.set(file);
          const pv = new DataView(padded.buffer);
          for (let i = 0; i < padded.length; i += 4) sum = (sum + pv.getUint32(i)) >>> 0;
          if (sum !== 0xb1b0afba) problems.push(t('pdf.fontChecksum', { num }));
          void v;
        } catch (e) {
          problems.push(e instanceof Error ? e.message : String(e));
        }
      }
    }
  }
  for (const page of doc.pages) for (const text of page.texts) if (!page.fonts.has(text.font)) problems.push(t('pdf.noFont', { font: text.font }));
  return problems;
}
