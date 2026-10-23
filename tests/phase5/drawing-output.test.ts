/**
 * 5-5 (docs/phase5-plan.md): DXF (F3.1) and PDF (F3.2) written from the scene of a drawing — the golden locating plate in two views, dimensioned, with centre marks,
 * a hole table and a title block with Chinese in it. Each file is read back with a reader written here and compared with the scene: the entities, the layers,
 * the coordinates; the structure of the PDF (the cross-reference table, the page, the content, the fonts) one by one; the characters of an embedded font; and the
 * geometry of the two outputs against each other.
 */
import { existsSync, readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  LINE_STYLES,
  checkDxf,
  checkPdf,
  drawnEntities,
  dxfEscape,
  dxfOrder,
  dxfUnescape,
  FontError,
  helveticaWidth,
  PT,
  pathsInMm,
  readDxf,
  readPdf,
  readTables,
  readTrueType,
  subsetTrueType,
  toDxf,
  toPdf,
  DxfError,
  PdfError,
  type DxfPolyline,
  type DxfSolid,
  type DxfText,
  type Scene,
  type SceneText,
} from '@3db/drawing';
import { plateScene, testFont } from '../support/outputScene';
import { byPlace } from '../support/testFont';

let scene: Scene;
beforeAll(async () => {
  scene = (await plateScene()).scene;
});

const texts = (s: Scene) => s.items.filter((i): i is SceneText => i.kind === 'text' && i.text !== '');
/** The same, in the order a DXF draws them (the block of each dimension after the rest). */
const dxfTexts = (s: Scene) => dxfOrder(s).filter((i): i is SceneText => i.kind === 'text' && i.text !== '');

const lines = (s: Scene) => s.items.filter((i) => i.kind === 'polyline' && i.points.length >= 4);
const allChars = (s: Scene) => [...new Set(texts(s).flatMap((t) => [...t.text]))].join('');
const nonAscii = (s: string) => [...s].filter((c) => c.codePointAt(0)! > 0x7e);

describe('the scene the outputs are made from', () => {
  it('has lines, filled arrowheads and text with Chinese, Ø, × and ± in it (so that there is something to get wrong)', () => {
    expect(lines(scene).length).toBeGreaterThan(100);
    expect(scene.items.some((i) => i.kind === 'polyline' && i.filled)).toBe(true);
    const chars = allChars(scene);
    for (const c of ['定', '位', '板', 'Ø', '×', '孔', '貫']) expect(chars, c).toContain(c);
  });
});

describe('DXF (AC1015)', () => {
  let text: string;
  beforeAll(() => {
    text = toDxf(scene);
  });

  it('escapes what is not ASCII as \\U+XXXX and reads it back: Ø9 is \\U+00D89, Chinese, a character beyond the Basic Multilingual Plane, a backslash', () => {
    expect(dxfEscape('Ø9')).toBe('\\U+00D89');
    expect(dxfEscape('孔')).toBe('\\U+5B54');
    expect(dxfEscape('a\\b')).toBe('a\\\\b');
    expect(dxfEscape('😀')).toBe('\\U+D83D\\U+DE00');
    for (const s of ['Ø9', '定位板 H7 (+0.012/0)', '4×R10 ±0.05', 'a\\b', '😀', '貫穿 沉頭 Ø12 深 4']) expect(dxfUnescape(dxfEscape(s)), s).toBe(s);
    expect(/^[\x20-\x7e\r\n]*$/.test(text)).toBe(true); // the whole file is ASCII
  });

  it('is a version 2000 file with its sections in order, and a check of it finds nothing wrong', () => {
    const doc = readDxf(text);
    expect(doc.version).toBe('AC1015');
    expect(doc.sections).toEqual(['HEADER', 'CLASSES', 'TABLES', 'BLOCKS', 'ENTITIES', 'OBJECTS']);
    expect(checkDxf(doc)).toEqual([]);
    expect(doc.header.get('$INSUNITS')![0]![1]).toBe('4'); // millimetres
    // the extent is the sheet's (nothing is drawn outside it) and the next handle is past every handle
    const num = (key: string, code: number) => Number(doc.header.get(key)!.find((p) => p[0] === code)![1]);
    expect([num('$EXTMIN', 10), num('$EXTMIN', 20), num('$EXTMAX', 10), num('$EXTMAX', 20)]).toEqual([0, 0, scene.width, scene.height]);
    const seed = parseInt(doc.header.get('$HANDSEED')![0]![1], 16);
    for (const e of doc.entities) expect(parseInt(e.handle, 16)).toBeLessThan(seed);
  });

  it('has a layer for each line style with its linetype and lineweight, and one for the text; DASHED and CENTER have the ISO 128 patterns', () => {
    const doc = readDxf(text);
    const layers = doc.tables.get('LAYER')!.entries;
    for (const s of Object.values(LINE_STYLES)) {
      const l = layers.find((e) => e.name === s.layer);
      expect(l, s.layer).toBeDefined();
      expect(l!.pairs.find((p) => p[0] === 6)![1]).toBe(s.linetype);
      expect(Number(l!.pairs.find((p) => p[0] === 370)![1])).toBe(Math.round(s.width * 100));
    }
    expect(layers.some((e) => e.name === 'TEXT')).toBe(true);
    const pattern = (name: string) => doc.tables.get('LTYPE')!.entries.find((e) => e.name === name)!.pairs.filter((p) => p[0] === 49).map((p) => Number(p[1]));
    expect(pattern('DASHED')).toEqual([3, -1]);
    expect(pattern('CENTER')).toEqual([12, -2, 2, -2]);
    expect(pattern('CONTINUOUS')).toEqual([]);
  });

  it('every polyline of the scene is an LWPOLYLINE on the layer of its style, with the same points and the same closing; filled polygons are fans of SOLIDs', () => {
    const doc = readDxf(text);
    const drawn = drawnEntities(doc); // the dimensions' lines are in their blocks
    const polylines = drawn.filter((e): e is DxfPolyline => e.type === 'LWPOLYLINE');
    const solids = drawn.filter((e): e is DxfSolid => e.type === 'SOLID');
    const open = dxfOrder(scene).filter((i) => i.kind === 'polyline' && !i.filled && i.points.length >= 4);
    const filled = dxfOrder(scene).filter((i) => i.kind === 'polyline' && i.filled && i.points.length >= 4);
    expect(polylines).toHaveLength(open.length);
    open.forEach((item, k) => {
      if (item.kind !== 'polyline') return;
      const e = polylines[k]!;
      expect(e.layer).toBe(LINE_STYLES[item.style].layer);
      expect(e.closed).toBe(!!item.closed);
      expect(e.points).toHaveLength(item.points.length);
      item.points.forEach((v, i) => expect(Math.abs(e.points[i]! - v)).toBeLessThan(1e-6));
    });
    expect(solids).toHaveLength(filled.reduce((n, i) => n + (i.kind === 'polyline' ? i.points.length / 2 - 2 : 0), 0));
    // a triangle arrowhead: the SOLID has its three corners, the fourth repeating the third
    const first = filled.find((i) => i.kind === 'polyline' && i.points.length === 6);
    expect(first).toBeDefined();
    const s = solids.find((e) => e.points.slice(0, 6).every((v, i) => first!.kind === 'polyline' && Math.abs(v - first!.points[i]!) < 1e-6))!;
    expect(s.points.slice(4, 6)).toEqual(s.points.slice(6, 8));
  });

  it('every text of the scene is a TEXT on layer TEXT with its place, height, angle and alignment, and its string reads back the same (Chinese, Ø, ×, ±)', () => {
    const doc = readDxf(text);
    const found = drawnEntities(doc).filter((e): e is DxfText => e.type === 'TEXT');
    const want = dxfTexts(scene);
    expect(found).toHaveLength(want.length);
    want.forEach((item, k) => {
      const e = found[k]!;
      expect(e.layer).toBe('TEXT');
      expect(e.text).toBe(item.text);
      expect(e.height).toBeCloseTo(item.height, 6);
      expect(e.angle).toBeCloseTo(item.angle ?? 0, 6);
      expect(e.align).toBe(item.anchor === 'center' ? 1 : item.anchor === 'right' ? 2 : 0);
      expect(e.at[0]).toBeCloseTo(item.at[0], 6);
      expect(e.at[1]).toBeCloseTo(item.at[1], 6);
    });
    expect(found.some((e) => e.text === '定位板') && found.some((e) => /^4×Ø9/.test(e.text))).toBe(true);
  });

  it('is found wrong when it is: no end of file, an odd number of lines, a handle twice, a layer that is not there, a polyline with other than its vertices, another version, a missing owner', () => {
    expect(() => readDxf(text.replace(/0\r\nEOF\r\n$/, ''))).toThrow(DxfError);
    expect(() => readDxf(text + 'x\r\n')).toThrow(/偶數/);
    const dup = text.replace(/\r\n5\r\n3F\r\n/, '\r\n5\r\n3E\r\n');
    expect(checkDxf(readDxf(dup)).some((p) => p.includes('控制碼重複'))).toBe(true);
    expect(checkDxf(readDxf(text.replace('\r\n8\r\nVISIBLE\r\n', '\r\n8\r\nNOPE\r\n'))).some((p) => p.includes('圖層不存在'))).toBe(true);
    expect(checkDxf(readDxf(text.replace('AC1015', 'AC1018'))).some((p) => p.includes('AC1015'))).toBe(true);
    expect(checkDxf(readDxf(text.replace(/\r\n90\r\n(\d+)\r\n/, (_, n) => `\r\n90\r\n${Number(n) + 1}\r\n`))).some((p) => p.includes('頂點數'))).toBe(true);
    expect(checkDxf(readDxf(text.replace('\r\n330\r\nB\r\n', '\r\n330\r\nFFFF\r\n'))).some((p) => p.includes('擁有者'))).toBe(true);
  });
});

describe('the TrueType font of the PDF', () => {
  const chars = '定位板孔尺寸貫穿';
  it('reads what the PDF needs: the glyph of each character, widths, metrics, the name, the license', () => {
    const { bytes, glyphOf } = testFont(chars);
    const font = readTrueType(bytes);
    expect(font.unitsPerEm).toBe(1000);
    expect(font.numGlyphs).toBe([...chars].length + 1);
    for (const [c, g] of glyphOf) expect(font.glyphOf(c.codePointAt(0)!)).toBe(g);
    expect(font.glyphOf('X'.codePointAt(0)!)).toBe(0);
    expect(font.advance(glyphOf.get('定')!)).toBe(600);
    expect(font.advance(glyphOf.get('位')!)).toBe(1000);
    expect([font.ascent, font.descent, font.capHeight, font.name, font.embeddable]).toEqual([800, -500, 700, 'TestFont', true]);
    expect(font.bbox).toEqual([0, 0, 1000, 1000]);
  });

  it('reads a font with short offsets in loca and a TrueType Collection at its first font', () => {
    for (const options of [{ shortLoca: true }, { collection: true }]) {
      const { bytes, glyphOf } = testFont(chars, options);
      const font = readTrueType(bytes);
      expect(font.glyphOf('板'.codePointAt(0)!)).toBe(glyphOf.get('板'));
      expect(font.components(glyphOf.get('穿')!)).toEqual([glyphOf.get('穿'), 1]); // the last glyph is a composite of the first
    }
  });

  it('says why it cannot use a file: not a font, PostScript outlines, cut short, a table missing; and that a restricted license is not to be embedded', () => {
    expect(() => readTrueType(new Uint8Array(40))).toThrow(FontError);
    expect(() => readTrueType(testFont(chars, { cff: true }).bytes)).toThrow(/PostScript/);
    expect(() => readTrueType(testFont(chars).bytes.slice(0, 100))).toThrow(/不完整/);
    expect(readTrueType(testFont(chars, { fsType: 2 }).bytes).embeddable).toBe(false);
    const tables = readTables(testFont(chars).bytes);
    expect([...tables.keys()].sort()).toEqual(['OS/2', 'cmap', 'glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp', 'name']);
  });

  it('is cut to the glyphs used: the same glyph numbers, the others emptied, a composite keeps the glyph it is made of, the checksum of a font file', () => {
    const { bytes, glyphOf } = testFont(chars);
    const font = readTrueType(bytes);
    const sub = readTables(subsetTrueType(font, [glyphOf.get('孔')!, glyphOf.get('穿')!]));
    expect([...sub.keys()].sort()).toEqual(['glyf', 'head', 'hhea', 'hmtx', 'loca', 'maxp']);
    const loca = new DataView(sub.get('loca')!.buffer, sub.get('loca')!.byteOffset);
    const size = (g: number) => loca.getUint32(4 * (g + 1)) - loca.getUint32(4 * g);
    const kept = new Set([0, glyphOf.get('孔')!, glyphOf.get('穿')!, 1]); // glyph 1 is in the composite
    for (let g = 0; g < font.numGlyphs; g++) expect(size(g) > 0, `glyph ${g}`).toBe(kept.has(g) && g !== 0);
    expect(sub.get('hmtx')!.length).toBe(font.numGlyphs * 4); // the widths of every glyph stay
    const file = subsetTrueType(font, [glyphOf.get('孔')!]);
    let sum = 0;
    const padded = new Uint8Array((file.length + 3) & ~3);
    padded.set(file);
    const v = new DataView(padded.buffer);
    for (let i = 0; i < padded.length; i += 4) sum = (sum + v.getUint32(i)) >>> 0;
    expect(sum).toBe(0xb1b0afba);
  });
});

describe('PDF', () => {
  it('without a font: a PDF 1.4 file that reads back, a page of the sheet\'s size, every line a path in its width and dash, nothing wrong with its structure', () => {
    const { bytes, warnings } = toPdf(scene, { title: '定位板' });
    const doc = readPdf(bytes);
    expect(doc.version).toBe('1.4');
    expect(doc.problems).toEqual([]);
    expect(checkPdf(doc)).toEqual([]);
    expect(doc.pages).toHaveLength(1);
    const page = doc.pages[0]!;
    expect(page.mediaBox[2]! / PT).toBeCloseTo(scene.width, 2);
    expect(page.mediaBox[3]! / PT).toBeCloseTo(scene.height, 2);
    const polylines = scene.items.filter((i) => i.kind === 'polyline' && i.points.length >= 4);
    expect(page.paths).toHaveLength(polylines.length);
    polylines.forEach((item, k) => {
      if (item.kind !== 'polyline') return;
      const p = pathsInMm(page.paths)[k]!;
      expect(p.filled).toBe(!!item.filled);
      expect(p.closed).toBe(!!item.closed || !!item.filled);
      expect(p.points).toHaveLength(item.points.length);
      item.points.forEach((v, i) => expect(Math.abs(p.points[i]! - v)).toBeLessThan(0.001));
      if (!item.filled) {
        const s = LINE_STYLES[item.style];
        expect(page.paths[k]!.width).toBeCloseTo(s.width * PT, 3);
        expect(page.paths[k]!.dash.map((d) => Math.round((d / PT) * 1000) / 1000)).toEqual(s.dash ?? []);
      }
    });
    // Chinese cannot be written in Helvetica: every such character is a ? and the warning says how many
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('字型檔');
  });

  it('the text of a standard font: ASCII, Ø, × and ± are written as they are, at the place and size of the scene, centred and right-aligned by Helvetica\'s widths', () => {
    const { bytes } = toPdf(scene);
    const page = readPdf(bytes).pages[0]!;
    const want = texts(scene);
    expect(page.texts).toHaveLength(want.length);
    let checked = 0;
    want.forEach((item, k) => {
      const t = page.texts[k]!;
      const ok = [...item.text].every((c) => helveticaWidth(c.codePointAt(0)!) > 0);
      if (!ok) {
        expect(t.text.length).toBe([...item.text].length);
        return;
      }
      expect(t.text).toBe(item.text);
      expect(t.font).toBe('F1');
      // the size is chosen so that the capitals are the height the scene says: Helvetica's are 0.718 em
      expect(t.size / PT).toBeCloseTo(item.height / 0.718, 2);
      const w = ([...item.text].reduce((a, c) => a + helveticaWidth(c.codePointAt(0)!), 0) / 1000) * (item.height / 0.718);
      const a = ((item.angle ?? 0) * Math.PI) / 180;
      const shift = item.anchor === 'center' ? -w / 2 : item.anchor === 'right' ? -w : 0;
      expect(t.matrix[4]! / PT).toBeCloseTo(item.at[0] + shift * Math.cos(a), 2);
      expect(t.matrix[5]! / PT).toBeCloseTo(item.at[1] + shift * Math.sin(a), 2);
      expect(t.matrix[0]).toBeCloseTo(Math.cos(a), 3);
      expect(t.matrix[1]).toBeCloseTo(Math.sin(a), 3);
      checked++;
    });
    expect(checked).toBeGreaterThan(30);
    expect(page.texts.some((x) => /^4×R10$/.test(x.text))).toBe(true);
  });

  it('with a font: the Chinese is written in it as glyph numbers, found again through the ToUnicode map; Helvetica keeps the rest; the font file is cut and its checksum is right', () => {
    const chars = allChars(scene);
    // a font has every character of what it is used for (a real one has the ASCII too); one with only the Chinese would leave the numbers in a mixed text to Helvetica's ?
    const { bytes: fontBytes, glyphOf } = testFont(chars);
    const font = readTrueType(fontBytes);
    const { bytes, warnings } = toPdf(scene, { font, title: '定位板' });
    expect(warnings).toEqual([]);
    const doc = readPdf(bytes);
    expect(checkPdf(doc)).toEqual([]);
    const page = doc.pages[0]!;
    const want = texts(scene);
    want.forEach((item, k) => {
      const t = page.texts[k]!;
      expect(t.text, item.text).toBe(item.text);
      // Helvetica for what it can write, the font for the rest (a text with Chinese in it is written whole in the font)
      expect(t.font).toBe([...item.text].some((c) => helveticaWidth(c.codePointAt(0)!) === 0) ? 'F2' : 'F1');
    });
    const embedded = page.texts.filter((t) => t.font === 'F2');
    expect(embedded.length).toBeGreaterThan(10);
    // the glyph numbers written are the font's
    const first = embedded.find((t) => t.text === '定位板')!;
    expect(first.codes).toEqual([...'定位板'].map((c) => glyphOf.get(c)));
    // a text of Chinese and numbers is written whole in the font
    expect(embedded.some((t) => /^4×Ø9 H11 \(\+0\.09\/0\) 貫穿$/.test(t.text))).toBe(true);
    // the font file in the PDF has the glyphs of the characters used and not those of the others
    const file = [...doc.objects.values()].find((o) => o.stream && o.stream.length > 12 && (o.value as { Length1?: number }).Length1 !== undefined)!;
    const tables = readTables(file.stream!);
    const loca = new DataView(tables.get('loca')!.buffer, tables.get('loca')!.byteOffset);
    const usedChars = new Set(embedded.flatMap((t) => [...t.text]));
    for (const [c, g] of glyphOf) {
      const size = loca.getUint32(4 * (g + 1)) - loca.getUint32(4 * g);
      expect(size > 0, c).toBe(usedChars.has(c) || g === glyphOf.size); // the last glyph is a composite of the first: kept with the first
    }
    // its widths are in the descriptor's /W: 600 for the first glyph and 1000 for the others
    const cid = [...doc.objects.values()].find((o) => (o.value as { Subtype?: { name: string } }).Subtype?.name === 'CIDFontType2')!.value as { W: unknown[] };
    expect(JSON.stringify(cid.W)).toContain('[600]');
  });

  it('a character the font does not have is written as ? and said so; a font that may not be embedded is refused', () => {
    const { bytes: fontBytes } = testFont('定位板');
    const { warnings } = toPdf(scene, { font: readTrueType(fontBytes) });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('指定的字型沒有');
    expect(() => toPdf(scene, { font: readTrueType(testFont('定', { fsType: 2 }).bytes) })).toThrow(/授權/);
  });

  it('when some character is missing in the font, valid Chinese characters are preserved in F2 and not turned into ?', () => {
    const font = readTrueType(testFont('底板?').bytes);
    const testScene: Scene = {
      width: 420,
      height: 297,
      items: [{ kind: 'text', text: '底板☃', at: [100, 100], height: 3.5 }],
    };
    const { bytes, warnings } = toPdf(testScene, { font });
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('指定的字型沒有這 1 個字元');
    const doc = readPdf(bytes);
    const pageText = doc.pages[0]!.texts[0]!;
    expect(pageText.font).toBe('F2');
    expect(pageText.text).toBe('底板?');
  });

  it('a PDF that is damaged is found out: not a PDF, no startxref, an object where the table does not say, a stream of the wrong length', () => {
    const { bytes } = toPdf(scene);
    expect(() => readPdf(new Uint8Array([1, 2, 3]))).toThrow(PdfError);
    expect(() => readPdf(bytes.slice(0, bytes.length - 20))).toThrow(/startxref/);
    const text = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
    expect(() => readPdf(Uint8Array.from('#' + text.slice(1), (c) => c.charCodeAt(0)))).toThrow(/標頭/);
    const renumbered = Uint8Array.from(text.replace('\n3 0 obj', '\n9 0 obj').split('').map((c) => c.charCodeAt(0)));
    expect(readPdf(renumbered).problems.some((p) => p.includes('物件 3'))).toBe(true);
    const badLength = Uint8Array.from(text.replace(/<< \/Length (\d+) >>\nstream/, (_, n) => `<< /Length ${Number(n) + 3} >>\nstream`).split('').map((c) => c.charCodeAt(0)));
    expect(readPdf(badLength).problems.some((p) => p.includes('串流長度'))).toBe(true);
  });
});

describe('DXF and PDF from the same scene', () => {
  it('draw the same lines: the polylines of the two files are the same points to 0.01 mm', () => {
    const dxf = byPlace(drawnEntities(readDxf(toDxf(scene))).filter((e): e is DxfPolyline => e.type === 'LWPOLYLINE'));
    const pdf = byPlace(pathsInMm(readPdf(toPdf(scene).bytes).pages[0]!.paths).filter((p) => !p.filled));
    expect(pdf).toHaveLength(dxf.length);
    let worst = 0;
    dxf.forEach((e, k) => {
      const p = pdf[k]!;
      expect(p.points).toHaveLength(e.points.length);
      e.points.forEach((v, i) => (worst = Math.max(worst, Math.abs(v - p.points[i]!))));
    });
    expect(worst).toBeLessThan(0.01);
  });

  it('write the same text: the same strings (a DXF draws the dimensions last, a PDF in the order of the scene)', () => {
    const dxf = drawnEntities(readDxf(toDxf(scene))).filter((e): e is DxfText => e.type === 'TEXT').map((e) => e.text);
    const font = readTrueType(testFont(allChars(scene)).bytes);
    const pdf = readPdf(toPdf(scene, { font }).bytes).pages[0]!.texts.map((t) => t.text);
    expect([...pdf].sort()).toEqual([...dxf].sort());
  });
});

describe('a real Chinese font (when this machine has one)', () => {
  const files = ['C:/Windows/Fonts/kaiu.ttf', 'C:/Windows/Fonts/msjh.ttc'].filter((f) => existsSync(f));
  for (const file of files) {
    it(`${file}: embeds the characters of the drawing, a few hundred kilobytes at most; the PDF reads back with the same text`, () => {
      const bytes = new Uint8Array(readFileSync(file));
      const font = readTrueType(bytes);
      expect(font.glyphOf('中'.codePointAt(0)!)).toBeGreaterThan(0);
      expect(font.embeddable).toBe(true);
      const missing = nonAscii(allChars(scene)).filter((c) => font.glyphOf(c.codePointAt(0)!) === 0);
      const { bytes: pdf, warnings } = toPdf(scene, { font });
      // a font that lacks a character of the drawing (Ø or × in some fonts) has it written as ? and says so
      expect(warnings.length).toBe(missing.length > 0 ? 1 : 0);
      const doc = readPdf(pdf);
      expect(checkPdf(doc)).toEqual([]);
      expect(doc.pages[0]!.texts.some((t) => t.text === '定位板')).toBe(true);
      expect(pdf.length).toBeLessThan(font.numGlyphs * 8 + 100_000);
      expect(pdf.length).toBeLessThan(bytes.length / 4);
    });
  }
  it.skipIf(files.length > 0)('(no Chinese font found on this machine: the synthetic font above stands in)', () => undefined);
});
