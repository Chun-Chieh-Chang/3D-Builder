import { assemble } from '@3db/drawing';

/** A font made for the tests (no node modules: the browser tests use it too). */

const be16 = (n: number) => [(n >> 8) & 0xff, n & 0xff];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];

export interface TestFontOptions {
  /** OS/2 fsType: 0 installable, 2 restricted. */
  fsType?: number;
  /** Short offsets in 'loca'. */
  shortLoca?: boolean;
  /** As a TrueType Collection. */
  collection?: boolean;
  /** A 'OTTO' header instead. */
  cff?: boolean;
}

/**
 * A small TrueType font with a glyph (a square) for each of `chars`, numbered from 1 (glyph 0 is .notdef); the last one is a composite glyph made of the first.
 * 1000 units to the em, capitals 700 high, every glyph 1000 wide except the first, which is 600. Returns the file and the glyph of each character.
 */
export function testFont(chars: string, options: TestFontOptions = {}): { bytes: Uint8Array; glyphOf: Map<string, number> } {
  const list = [...new Set([...chars])];
  const numGlyphs = list.length + 1;
  const square = (size: number): number[] => {
    // one contour of four on-curve points: flags, then x and y as 16-bit deltas
    const pts: [number, number][] = [[0, 0], [size, 0], [size, size], [0, size]];
    const out = [...be16(1), ...be16(0), ...be16(0), ...be16(size), ...be16(size), ...be16(3), ...be16(0), 1, 1, 1, 1];
    let px = 0;
    for (const [x] of pts) {
      out.push(...be16((x - px) & 0xffff));
      px = x;
    }
    let py = 0;
    for (const [, y] of pts) {
      out.push(...be16((y - py) & 0xffff));
      py = y;
    }
    return out;
  };
  // the glyphs: .notdef empty, the squares, and the last a composite of glyph 1 moved by (100, 0)
  const glyphs: number[][] = [[]];
  for (let g = 1; g < numGlyphs; g++) glyphs.push(g === numGlyphs - 1 && numGlyphs > 2 ? [...be16(0xffff), ...be16(0), ...be16(0), ...be16(0), ...be16(0), ...be16(0x0003), ...be16(1), ...be16(100), ...be16(0)] : square(300 + g));
  const glyf: number[] = [];
  const offsets: number[] = [];
  for (const g of glyphs) {
    offsets.push(glyf.length);
    glyf.push(...g);
    while (glyf.length % 4) glyf.push(0);
  }
  offsets.push(glyf.length);
  const loca = options.shortLoca ? offsets.flatMap((o) => be16(o / 2)) : offsets.flatMap(be32);
  const head = new Array<number>(54).fill(0);
  head.splice(0, 4, ...be32(0x00010000));
  head.splice(12, 4, ...be32(0x5f0f3cf5));
  head.splice(18, 2, ...be16(1000));
  head.splice(36, 8, ...be16(0), ...be16(0), ...be16(1000), ...be16(1000));
  head.splice(50, 2, ...be16(options.shortLoca ? 0 : 1));
  const hhea = new Array<number>(36).fill(0);
  hhea.splice(0, 4, ...be32(0x00010000));
  hhea.splice(4, 4, ...be16(800), ...be16(0xfe0c)); // ascent 800, descent −500
  hhea.splice(34, 2, ...be16(numGlyphs));
  const maxp = [...be32(0x00005000), ...be16(numGlyphs)];
  const hmtx = Array.from({ length: numGlyphs }, (_, g) => [...be16(g === 1 ? 600 : g === 0 ? 500 : 1000), ...be16(0)]).flat();
  // cmap: format 4, one segment for each character, then the last segment
  const codes = list.map((c, i) => ({ cp: c.codePointAt(0)!, gid: i + 1 })).sort((a, b) => a.cp - b.cp);
  const segs = codes.length + 1;
  const sub = [
    ...be16(4), ...be16(16 + 8 * segs), ...be16(0), ...be16(2 * segs), ...be16(0), ...be16(0), ...be16(0),
    ...codes.flatMap((c) => be16(c.cp)), ...be16(0xffff), ...be16(0),
    ...codes.flatMap((c) => be16(c.cp)), ...be16(0xffff),
    ...codes.flatMap((c) => be16((c.gid - c.cp) & 0xffff)), ...be16(1),
    ...codes.flatMap(() => be16(0)), ...be16(0),
  ];
  const cmap = [...be16(0), ...be16(1), ...be16(3), ...be16(1), ...be32(12), ...sub];
  const os2 = new Array<number>(96).fill(0);
  os2.splice(0, 2, ...be16(2));
  os2.splice(8, 2, ...be16(options.fsType ?? 0));
  os2.splice(88, 2, ...be16(700));
  const psName = 'TestFont';
  const nameBytes = [...psName].flatMap((c) => be16(c.charCodeAt(0)));
  const name = [...be16(0), ...be16(1), ...be16(18), ...be16(3), ...be16(1), ...be16(0x409), ...be16(6), ...be16(nameBytes.length), ...be16(0), ...nameBytes];
  const tables = new Map<string, Uint8Array>([
    ['head', Uint8Array.from(head)], ['hhea', Uint8Array.from(hhea)], ['maxp', Uint8Array.from(maxp)], ['hmtx', Uint8Array.from(hmtx)],
    ['cmap', Uint8Array.from(cmap)], ['loca', Uint8Array.from(loca)], ['glyf', Uint8Array.from(glyf)], ['OS/2', Uint8Array.from(os2)], ['name', Uint8Array.from(name)],
  ]);
  let bytes = assemble(tables);
  if (options.cff) bytes = Uint8Array.from([0x4f, 0x54, 0x54, 0x4f, ...bytes.slice(4)]);
  if (options.collection) {
    // a collection of this one font: the header, then the font with its table offsets moved on by the header
    const shifted = bytes.slice();
    const view = new DataView(shifted.buffer);
    const n = view.getUint16(4);
    for (let i = 0; i < n; i++) view.setUint32(12 + 16 * i + 8, view.getUint32(12 + 16 * i + 8) + 16);
    bytes = Uint8Array.from([0x74, 0x74, 0x63, 0x66, ...be32(0x00010000), ...be32(1), ...be32(16), ...shifted]);
  }
  return { bytes, glyphOf: new Map(list.map((c, i) => [c, i + 1])) };
}

/** The lines of a drawing in a fixed order that does not depend on how a file is made (where each starts, then how long it is), for the lines of two files to be set side by side. */
export const byPlace = <T extends { points: number[] }>(lines: T[]): T[] =>
  [...lines].sort((a, b) => a.points[0]! - b.points[0]! || a.points[1]! - b.points[1]! || a.points.length - b.points.length || a.points[2]! - b.points[2]! || a.points[3]! - b.points[3]!);
