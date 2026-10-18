import { t } from '@3db/i18n';
import { HELVETICA_CAP_HEIGHT, helveticaCode, helveticaWidth } from './helvetica';
import { circlePolyline } from './geometry';
import { LINE_STYLES, type Scene, type SceneImage, type SceneText } from './scene';
import { FontError, subsetTrueType, type TrueTypeFont } from './ttf';

/**
 * The drawing as a PDF (F3.2): one page of the sheet's size, the lines as vector paths in their widths and dashes (ISO 128), the text in Helvetica (the standard
 * font, no embedding; ASCII and Ø × ± °) or, for text with characters it does not have (Chinese), in a TrueType font the user gives, cut down to the glyphs
 * used and embedded as a CID font with a ToUnicode map (so the text can be searched and copied). Characters that no font given can write are written as
 * ? and reported. Written from the same scene as the SVG and the DXF.
 */

export interface PdfOptions {
  /** The title of the document. */
  title?: string;
  /** A font for the characters Helvetica does not have. */
  font?: TrueTypeFont | null;
}

export interface PdfResult {
  bytes: Uint8Array;
  /** What could not be done as asked (characters no font could write). */
  warnings: string[];
}

/** Points per millimetre. */
export const PT = 72 / 25.4;

const num = (v: number) => String(Math.round(v * 1000) / 1000 + 0);
const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);
const hex4 = (n: number) => n.toString(16).padStart(4, '0').toUpperCase();

/** A PDF literal string of WinAnsi bytes. */
function literal(codes: readonly number[]): string {
  return `(${codes.map((c) => (c === 0x5c || c === 0x28 || c === 0x29 ? `\\${String.fromCharCode(c)}` : c < 0x20 || c > 0x7e ? `\\${c.toString(8).padStart(3, '0')}` : String.fromCharCode(c))).join('')})`;
}

/** A text string of the document information (UTF-16BE with a byte order mark, so any character is allowed). */
function textString(s: string): string {
  let out = 'FEFF';
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp > 0xffff) {
      const v = cp - 0x10000;
      out += hex4(0xd800 + (v >> 10)) + hex4(0xdc00 + (v & 0x3ff));
    } else out += hex4(cp);
  }
  return `<${out}>`;
}

/** How one text is written: which font, and the bytes (WinAnsi codes, or glyph numbers) of its characters; the characters that had to be replaced. */
interface Run {
  font: 'F1' | 'F2';
  codes: number[];
  /** Width in 1/1000 of the font size. */
  width: number;
  replaced: string[];
}

function plan(text: string, font: TrueTypeFont | null | undefined, used: Map<number, number>): Run {
  const chars = [...text].map((c) => c.codePointAt(0)!);
  // Helvetica when it has every character; the font given only for what Helvetica cannot write
  if (font && chars.some((c) => helveticaCode(c) === null)) {
    const glyphs = chars.map((c) => font.glyphOf(c));
    if (glyphs.every((g) => g > 0 || chars.length === 0)) {
      chars.forEach((c, i) => used.has(glyphs[i]!) || used.set(glyphs[i]!, c));
      return { font: 'F2', codes: glyphs, width: glyphs.reduce((w, g) => w + (font.advance(g) * 1000) / font.unitsPerEm, 0), replaced: [] };
    }
  }
  const replaced: string[] = [];
  const codes = chars.map((c) => {
    const code = helveticaCode(c);
    if (code !== null) return code;
    replaced.push(String.fromCodePoint(c));
    return 0x3f;
  });
  const width = codes.reduce((w, c, i) => w + helveticaWidth(helveticaCode(chars[i]!) === null ? 0x3f : chars[i]!), 0);
  return { font: 'F1', codes, width, replaced };
}

function textOps(item: SceneText, run: Run, font: TrueTypeFont | null | undefined): string {
  const cap = run.font === 'F2' && font ? font.capHeight / font.unitsPerEm : HELVETICA_CAP_HEIGHT / 1000;
  const size = item.height / cap; // mm
  const w = (run.width / 1000) * size; // mm
  const a = ((item.angle ?? 0) * Math.PI) / 180;
  const shift = item.anchor === 'center' ? -w / 2 : item.anchor === 'right' ? -w : 0;
  const x = item.at[0] + shift * Math.cos(a);
  const y = item.at[1] + shift * Math.sin(a);
  const shown = run.font === 'F2' ? `<${run.codes.map(hex4).join('')}>` : literal(run.codes);
  return `BT /${run.font} ${num(size * PT)} Tf ${num(Math.cos(a))} ${num(Math.sin(a))} ${num(-Math.sin(a))} ${num(Math.cos(a))} ${num(x * PT)} ${num(y * PT)} Tm ${shown} Tj ET`;
}

/** The ToUnicode map of the embedded font: for each glyph used, the character. */
function toUnicode(used: Map<number, number>): string {
  const entries = [...used].sort((a, b) => a[0] - b[0]);
  const lines = ['/CIDInit /ProcSet findresource begin', '12 dict begin', 'begincmap', '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def', '/CMapName /Adobe-Identity-UCS def', '/CMapType 2 def', '1 begincodespacerange', '<0000> <FFFF>', 'endcodespacerange'];
  for (let i = 0; i < entries.length; i += 100) {
    const block = entries.slice(i, i + 100);
    lines.push(`${block.length} beginbfchar`);
    for (const [g, cp] of block) {
      const utf16 = cp > 0xffff ? hex4(0xd800 + ((cp - 0x10000) >> 10)) + hex4(0xdc00 + ((cp - 0x10000) & 0x3ff)) : hex4(cp);
      lines.push(`<${hex4(g)}> <${utf16}>`);
    }
    lines.push('endbfchar');
  }
  lines.push('endcmap', 'CMapName currentdict /CMap defineresource pop', 'end', 'end');
  return lines.join('\n') + '\n';
}

/** The scene (or scenes, one per sheet) as a PDF (B2.8 shape 2, Q6 Option A). */
export function toPdf(sceneOrScenes: Scene | readonly Scene[], options: PdfOptions = {}): PdfResult {
  const scenes: readonly Scene[] = Array.isArray(sceneOrScenes) ? sceneOrScenes : [sceneOrScenes];
  if (scenes.length === 0) throw new Error('toPdf: at least one scene required');
  const font = options.font ?? null;
  if (font && !font.embeddable) throw new FontError(t('font.restricted'));
  const used = new Map<number, number>();
  const replacedChars = new Set<string>();

  // collect all images across all pages with global indexing
  const allImages: { img: SceneImage; pageIndex: number; localIndex: number; globalIndex: number }[] = [];
  scenes.forEach((sc, pageIndex) => {
    (sc.images ?? []).forEach((img, localIndex) => {
      allImages.push({ img, pageIndex, localIndex, globalIndex: allImages.length });
    });
  });

  const pageContents: string[] = [];
  scenes.forEach((sc, pageIndex) => {
    const ops: string[] = ['q', '1 J 1 j'];
    const pageImgs = allImages.filter((x) => x.pageIndex === pageIndex);
    pageImgs.forEach(({ img, localIndex }) => {
      const clip = img.clip ? `${circlePolyline(img.clip.centre, img.clip.radius, 64).reduce<string[]>((acc, v, k, all) => (k % 2 === 0 ? [...acc, `${num(v * PT)} ${num(all[k + 1]! * PT)} ${k === 0 ? 'm' : 'l'}`] : acc), []).join(' ')} h W n ` : '';
      ops.push(`q ${clip}${num(img.w * PT)} 0 0 ${num(img.h * PT)} ${num(img.at[0] * PT)} ${num(img.at[1] * PT)} cm /Im${localIndex + 1} Do Q`);
    });
    for (const item of sc.items) {
      if (item.kind === 'polyline') {
        const s = LINE_STYLES[item.style] ?? LINE_STYLES.visible;
        const pts: string[] = [];
        for (let i = 0; i + 1 < item.points.length; i += 2) pts.push(`${num(item.points[i]! * PT)} ${num(item.points[i + 1]! * PT)} ${i === 0 ? 'm' : 'l'}`);
        if (pts.length < 2) continue;
        if (item.filled) ops.push(`${pts.join(' ')} h f`);
        else ops.push(`${num((item.width ?? s.width) * PT)} w ${s.dash ? `[${s.dash.map((d) => num(d * PT)).join(' ')}] 0 d` : '[] 0 d'} ${pts.join(' ')}${item.closed ? ' h' : ''} S`);
      } else if (item.text !== '') {
        const run = plan(item.text, font, used);
        for (const c of run.replaced) replacedChars.add(c);
        ops.push(textOps(item, run, font));
      }
    }
    ops.push('Q');
    pageContents.push(ops.join('\n') + '\n');
  });

  const warnings: string[] = [];
  if (replacedChars.size > 0) {
    const list = [...replacedChars];
    warnings.push(t(font ? 'pdf.replacedWithFont' : 'pdf.replaced', { n: list.length, chars: list.slice(0, 12).join('') + (list.length > 12 ? '…' : '') }));
  }

  // the objects, in order; 1-based numbers
  const objects: (string | Uint8Array)[][] = [];
  const add = (...parts: (string | Uint8Array)[]) => objects.push(parts) && objects.length;
  const N = scenes.length;
  const embedded = font !== null && used.size > 0;
  const fontObjCount = embedded ? 6 : 1;
  const firstImage = 3 + 2 * N + fontObjCount;

  // 1: Catalog
  add('<< /Type /Catalog /Pages 2 0 R >>');
  // 2: Pages root
  const kidRefs = Array.from({ length: N }, (_, i) => `${3 + i} 0 R`).join(' ');
  add(`<< /Type /Pages /Kids [${kidRefs}] /Count ${N} >>`);

  // 3 .. 2 + N: Page objects
  scenes.forEach((sc, i) => {
    const pageW = (sc.width > 0 ? sc.width : 420) * PT;
    const pageH = (sc.height > 0 ? sc.height : 297) * PT;
    const pageImgs = allImages.filter((x) => x.pageIndex === i);
    const hasImgs = pageImgs.length > 0;
    const xobjects = hasImgs ? ` /XObject << ${pageImgs.map((x) => `/Im${x.localIndex + 1} ${firstImage + 2 * x.globalIndex} 0 R`).join(' ')} >>` : '';
    const f1Id = 3 + 2 * N;
    const f2Id = 4 + 2 * N;
    const contentId = 3 + N + i;
    add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(pageW)} ${num(pageH)}] /Resources << /ProcSet [/PDF /Text${hasImgs ? ' /ImageC' : ''}] /Font << /F1 ${f1Id} 0 R${embedded ? ` /F2 ${f2Id} 0 R` : ''} >>${xobjects} >> /Contents ${contentId} 0 R >>`);
  });

  // 3 + N .. 2 + 2*N: Content streams
  pageContents.forEach((c) => {
    const body = latin1(c);
    add(`<< /Length ${body.length} >>\nstream\n`, body, '\nendstream');
  });

  // Fonts
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  if (embedded && font) {
    const file = subsetTrueType(font, used.keys());
    const name = `ABCDEF+${font.name}`;
    const per = 1000 / font.unitsPerEm;
    const widths = [...used.keys()].sort((a, b) => a - b).map((g) => `${g} [${Math.round(font.advance(g) * per)}]`);
    const f2Id = 4 + 2 * N;
    const cidId = f2Id + 1;
    const descId = f2Id + 2;
    const fileId = f2Id + 3;
    const cmapId = f2Id + 4;
    add(`<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [${cidId} 0 R] /ToUnicode ${cmapId} 0 R >>`);
    add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descId} 0 R /DW 1000 /W [${widths.join(' ')}] /CIDToGIDMap /Identity >>`);
    add(`<< /Type /FontDescriptor /FontName /${name} /Flags 4 /FontBBox [${font.bbox.map((v) => Math.round(v * per)).join(' ')}] /ItalicAngle 0 /Ascent ${Math.round(font.ascent * per)} /Descent ${Math.round(font.descent * per)} /CapHeight ${Math.round(font.capHeight * per)} /StemV 80 /FontFile2 ${fileId} 0 R >>`);
    add(`<< /Length ${file.length} /Length1 ${file.length} >>\nstream\n`, file, '\nendstream');
    const cmap = latin1(toUnicode(used));
    add(`<< /Length ${cmap.length} >>\nstream\n`, cmap, '\nendstream');
  }

  // Images across all pages
  allImages.forEach(({ img, globalIndex }) => {
    const decode = (colors: number) => `/Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors ${colors} /BitsPerComponent 8 /Columns ${img.image.width} >>`;
    const at = add(`<< /Type /XObject /Subtype /Image /Width ${img.image.width} /Height ${img.image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 ${decode(3)} /SMask ${firstImage + 2 * globalIndex + 1} 0 R /Length ${img.image.rgb.length} >>\nstream\n`, img.image.rgb, '\nendstream');
    if (at !== firstImage + 2 * globalIndex) throw new Error('toPdf: the objects of the images are not where the page says');
    add(`<< /Type /XObject /Subtype /Image /Width ${img.image.width} /Height ${img.image.height} /ColorSpace /DeviceGray /BitsPerComponent 8 ${decode(1)} /Length ${img.image.alpha.length} >>\nstream\n`, img.image.alpha, '\nendstream');
  });

  const info = add(`<< /Title ${textString(options.title ?? '')} /Producer ${textString('3D-Builder')} >>`);

  const chunks: Uint8Array[] = [];
  let at = 0;
  const push = (s: string | Uint8Array) => {
    const b = typeof s === 'string' ? latin1(s) : s;
    chunks.push(b);
    at += b.length;
  };
  push('%PDF-1.4\n%âãÏÓ\n');
  const offsets: number[] = [];
  objects.forEach((parts, i) => {
    offsets.push(at);
    push(`${i + 1} 0 obj\n`);
    for (const p of parts) push(p);
    push('\nendobj\n');
  });
  const xref = at;
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (const o of offsets) push(`${String(o).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const bytes = new Uint8Array(at);
  let o = 0;
  for (const c of chunks) {
    bytes.set(c, o);
    o += c.length;
  }
  return { bytes, warnings };
}
