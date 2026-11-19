/**
 * Names in an assembly STEP written as raw bytes of a code page (against ISO 10303-21, which allows only ASCII and `\X2\` escapes). SolidWorks 2020 wrote
 * part-3's assembly so: its 夾具A and 夾具B as Big5 bytes, which came back as the same three wrong characters, so the two parts got the files
 * `§¨¨.3dbx` and `§¨¨ (2).3dbx`. Raw bytes are read as UTF-8 when they are valid UTF-8, else in the code page of the user's language, which is
 * reported. The truth is the file made here: written by the library with escapes, the escapes then put back as raw bytes as such a writer does.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { withLocale } from '@3db/i18n';
import { stepAssemblyFiles, stepAssemblyPlan } from '@3db/io';
import { Kernel, stepBytesAsAscii, type ShapeId } from '@3db/kernel';

let kernel: Kernel;
/** Three parts of their own (one shape used for two names is one product of the file): cylinders of radius 3, 4 and 5. */
const parts: ShapeId[] = [];
beforeAll(async () => {
  kernel = await Kernel.load();
  const L = (a: number[], b: number[], s: string) => ({ kind: 'line', a, b, source: s });
  for (const r of [3, 4, 5]) {
    const prof = [[0, 0], [r, 0], [r, 5], [0, 5]];
    parts.push(kernel.revolve({ origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } as never, [{ outer: prof.map((a, i) => L(a, prof[(i + 1) % 4]!, 'p' + i)), holes: [] }] as never, { origin: [0, 0, 0], dir: [0, 1, 0] }, 2 * Math.PI).shape);
  }
});

/** Big5 bytes of the characters used here (許's second byte is a backslash, 0x5C); checked against the platform's own Big5 decoder below. */
const BIG5: Record<string, number[]> = { 夾: [0xa7, 0xa8], 具: [0xa8, 0xe3], 許: [0xb3, 0x5c] };

/** The library's file with each `\X2\…\X0\` escape put back as the raw bytes `encode` gives. */
function raw(text: string, encode: (s: string) => number[]): Uint8Array {
  const out: number[] = [];
  let at = 0;
  for (const m of text.matchAll(/\\X2\\((?:[0-9A-F]{4})+)\\X0\\/g)) {
    for (const c of text.slice(at, m.index)) out.push(c.charCodeAt(0));
    const chars = m[1]!.match(/.{4}/g)!.map((h) => String.fromCharCode(parseInt(h, 16))).join('');
    out.push(...encode(chars));
    at = m.index! + m[0].length;
  }
  for (const c of text.slice(at)) out.push(c.charCodeAt(0));
  return Uint8Array.from(out);
}
const big5 = (s: string) => [...s].flatMap((c) => BIG5[c] ?? (() => { throw new Error(`no Big5 bytes for ${c} in this test`); })());
const utf8 = (s: string) => [...new TextEncoder().encode(s)];

function assembly(): string {
  return kernel.exportAssemblyStep(
    '夾具',
    [{ shape: parts[0]!, name: '夾具A' }, { shape: parts[1]!, name: '夾具B' }, { shape: parts[2]!, name: '許A' }],
    [
      { part: 0, name: '夾具A<1>', position: [0, 0, 0], rotation: [0, 0, 0, 1] },
      { part: 1, name: '夾具B<1>', position: [10, 0, 0], rotation: [0, 0, 0, 1] },
      { part: 2, name: '許A<1>', position: [20, 0, 0], rotation: [0, 0, 0, 1] },
    ],
    'MM',
  );
}

const names = (c: { prototypes: { name: string | null; shape?: ShapeId }[] }) => {
  for (const p of c.prototypes) if (p.shape) kernel.release(p.shape);
  return c.prototypes.map((p) => p.name).sort();
};
const WANT = ['夾具', '夾具A', '夾具B', '許A'].sort();

describe('names written as raw code-page bytes', () => {
  it('the test bytes are Big5 (the platform decoder agrees), and the library writes escapes, no raw bytes', () => {
    for (const [c, b] of Object.entries(BIG5)) expect(new TextDecoder('big5').decode(Uint8Array.from(b))).toBe(c);
    const text = assembly();
    expect(/[^\x00-\x7f]/.test(text)).toBe(false);
    expect(text).toContain('\\X2\\');
  });

  it('Big5 bytes: read in the code page of the user language (zh-TW: Big5), each name as written, and the code page reported', () => {
    const file = raw(assembly(), big5);
    expect(file.some((b) => b >= 0x80)).toBe(true);
    const c = kernel.readAssemblyStep(file);
    expect(c.nameEncoding).toBe('big5');
    expect(names(c)).toEqual(WANT);
  });

  it('the same bytes in English: read as Windows-1252, as stated, and reported (the file does not say its code page)', () => {
    const file = raw(assembly(), big5);
    const c = withLocale('en', () => kernel.readAssemblyStep(file));
    expect(c.nameEncoding).toBe('windows-1252');
    const as1252 = (s: string) => new TextDecoder('windows-1252').decode(Uint8Array.from(big5(s)));
    expect(names(c)).toEqual(['夾具', '夾具A', '夾具B', '許A'].map((n) => n.replace(/[^\x00-\x7f]+/g, as1252)).sort());
  });

  it('raw UTF-8 bytes: read as UTF-8 in any language, nothing reported', () => {
    for (const locale of ['zh-TW', 'en'] as const) {
      const c = withLocale(locale, () => kernel.readAssemblyStep(raw(assembly(), utf8)));
      expect(c.nameEncoding).toBeUndefined();
      expect(names(c)).toEqual(WANT);
    }
  });

  it('a file as the standard says (escapes only): as before, nothing reported', () => {
    const c = kernel.readAssemblyStep(assembly());
    expect(c.nameEncoding).toBeUndefined();
    expect(names(c)).toEqual(WANT);
  });

  it('the files of the import are named after the parts, and the import says how the names were read', async () => {
    const plan = stepAssemblyPlan(kernel, raw(assembly(), big5));
    const out = await stepAssemblyFiles(plan, '夾具');
    expect(out.files.map((f) => f.path).sort()).toEqual(['夾具.3dba', '零件/夾具A.3dbx', '零件/夾具B.3dbx', '零件/許A.3dbx'].sort());
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toContain('Big5');
  });
});

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The escapes of a STEP text read back (ISO 10303-21 §7.3.3: `\X2\` four hex digits each, `\X4\` eight). */
function unescape(text: string): string {
  return text
    .replace(/\\X2\\((?:[0-9A-F]{4})+)\\X0\\/g, (_, h: string) => h.match(/.{4}/g)!.map((x) => String.fromCharCode(parseInt(x, 16))).join(''))
    .replace(/\\X4\\((?:[0-9A-F]{8})+)\\X0\\/g, (_, h: string) => h.match(/.{8}/g)!.map((x) => String.fromCodePoint(parseInt(x, 16))).join(''));
}

it('200 random texts of raw UTF-8 (any plane, quotes and backslashes among them): ASCII out, the same text when read back (AGENTS §3.4)', () => {
  const pick = (r: () => number) => {
    const k = r();
    if (k < 0.3) return String.fromCharCode(0x20 + Math.floor(r() * 0x5f)); // ASCII, ' and \ among it
    if (k < 0.6) return String.fromCharCode(0x4e00 + Math.floor(r() * 0x5000)); // CJK
    if (k < 0.8) return String.fromCharCode(0xa0 + Math.floor(r() * 0x2000)); // Latin to general punctuation
    return String.fromCodePoint(0x1f300 + Math.floor(r() * 0x300)); // beyond the BMP
  };
  for (let seed = 1; seed <= 200; seed++) {
    const r = rng(seed * 104729);
    const text = `#1 = PRODUCT ( '${Array.from({ length: 1 + Math.floor(r() * 30) }, () => pick(r)).join('')}' ) ;\n`;
    const out = stepBytesAsAscii(new TextEncoder().encode(text), 'big5');
    expect(out.bytes.every((b) => b < 0x80)).toBe(true);
    expect(out.encoding).toBe(/[^\x00-\x7f]/.test(text) ? 'utf-8' : null);
    expect(unescape(new TextDecoder().decode(out.bytes))).toBe(text);
  }
});
