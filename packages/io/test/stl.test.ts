import { describe, expect, it } from 'vitest';
import { isStlData, parseStl, STL_MAX_TRIANGLES, StlError } from '@3db/model';
import { asciiStl, binaryStl, readBinaryStl, stlAsciiName } from '../src/stl';

/** A box from the origin to (x, y, z), its twelve triangles counter-clockwise seen from outside. */
function box(x = 20, y = 10, z = 5) {
  const positions = [0, 0, 0, x, 0, 0, x, y, 0, 0, y, 0, 0, 0, z, x, 0, z, x, y, z, 0, y, z];
  // prettier-ignore
  const indices = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  return { positions, indices };
}
const ascii = (text: string) => new TextEncoder().encode(text);
const facet = (corners: number[][]) => `facet normal 0 0 0\nouter loop\n${corners.map((c) => `vertex ${c.join(' ')}`).join('\n')}\nendloop\nendfacet\n`;
/** The reason an STL is refused; fails when it is read or refused with something else than an StlError. */
function refusal(bytes: Uint8Array): string {
  try {
    parseStl(bytes);
  } catch (e) {
    expect(e).toBeInstanceOf(StlError);
    return (e as Error).message;
  }
  throw new Error('read');
}

describe('STL reading (F2.3, ADR 0221)', () => {
  it('a binary box: 12 triangles on 8 shared corners, closed, its volume, area and box', () => {
    const m = parseStl(binaryStl([box()], 'box'));
    expect(m.format).toBe('binary');
    expect(m.name).toBe('binary STL box');
    expect([m.fileTriangles, m.indices.length / 3, m.positions.length / 3, m.degenerate]).toEqual([12, 12, 8, 0]);
    expect([m.openEdges, m.nonManifoldEdges, m.flippedEdges, m.closed]).toEqual([0, 0, 0, true]);
    expect(m.volume).toBeCloseTo(1000, 9);
    expect(m.area).toBeCloseTo(2 * (200 + 100 + 50), 9);
    expect([m.min, m.max]).toEqual([[0, 0, 0], [20, 10, 5]]);
  });

  it('ASCII written and read gives the same mesh as binary, to the float32 a binary file holds', () => {
    const odd = { positions: box(1 / 3, Math.PI, 1e-3 * 7).positions.map((x) => x + 123.456789), indices: box().indices };
    const a = parseStl(ascii(asciiStl([odd], 'odd')));
    const b = parseStl(binaryStl([odd], 'odd'));
    expect(a.format).toBe('ascii');
    expect(a.name).toBe('odd');
    expect(Array.from(a.positions)).toEqual(Array.from(b.positions));
    expect(Array.from(a.indices)).toEqual(Array.from(b.indices));
    expect(a.closed).toBe(true);
  });

  it('inches: written divided by 25.4, read multiplied back', () => {
    const bin = binaryStl([box()], 'box', 'inch');
    expect(readBinaryStl(bin)[0]![3]).toBeCloseTo(20 / 25.4, 6); // first triangle 0,2,1: its second corner is (20, 10, 0)
    const m = parseStl(bin, 'inch');
    expect(m.volume).toBeCloseTo(1000, 3);
    expect(m.max[0]).toBeCloseTo(20, 5);
    expect(parseStl(ascii(asciiStl([box()], 'box', 'inch')), 'inch').volume).toBeCloseTo(1000, 3);
    // the same file read as millimetres is 25.4 times smaller
    expect(parseStl(bin, 'mm').max[0]).toBeCloseTo(20 / 25.4, 5);
  });

  it('an unknown unit is refused, not taken as millimetres', () => {
    expect(() => parseStl(binaryStl([box()]), 'cm' as never)).toThrow(StlError);
  });

  it('a binary file whose header starts with "solid" is read as binary, by its size', () => {
    const bytes = binaryStl([box()]);
    bytes.set(new TextEncoder().encode('solid made by some program'.padEnd(80, ' ')));
    const m = parseStl(bytes);
    expect(m.format).toBe('binary');
    expect(m.closed).toBe(true);
    expect(isStlData(bytes)).toBe(true);
  });

  it('a binary file cut short says how many bytes it should have', () => {
    const bytes = binaryStl([box()]).subarray(0, 84 + 50 * 7);
    expect(refusal(bytes)).toContain('84 + 50 × 12');
    // the same with a "solid" header: not text, so not an ASCII file either
    const solid = binaryStl([box()]);
    solid.set(new TextEncoder().encode('solid x'));
    solid[90] = 0xff;
    expect(refusal(solid.subarray(0, 300))).toContain('84 + 50 × 12');
  });

  it('ASCII mistakes stop the reading with their line', () => {
    expect(refusal(ascii(`solid a\n${facet([[0, 0, 0], [1, 0, 0], [0, 1, 0]])}`))).toMatch(/第 9 行|line 9/);
    expect(refusal(ascii(`solid a\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid a\n`))).toMatch(/第 6 行|line 6/);
    expect(refusal(ascii(`solid a\n${facet([[0, 0, 0], [1, 'abc' as never, 0], [0, 1, 0]])}endsolid a\n`))).toContain('abc');
    expect(refusal(ascii(`solid a\n${facet([[0, 0, 0], [1, 1e39, 0], [0, 1, 0]])}endsolid a\n`))).toContain('1e+39');
    expect(refusal(ascii(`solid a\n${facet([[0, 0, 0], [1, 'nan' as never, 0], [0, 1, 0]])}endsolid a\n`))).toContain('nan');
  });

  it('ASCII: the normal is not read (some programs write nan there), several solids are one mesh, CRLF and case do not matter', () => {
    const text = `SOLID one\r\n${facet([[0, 0, 0], [1, 0, 0], [0, 1, 0]]).replace('normal 0 0 0', 'normal nan nan nan')}ENDSOLID one\r\nsolid two\r\n${facet([[0, 0, 1], [1, 0, 1], [0, 1, 1]])}endsolid two\r\n`.replace(/\n(?!\r)/g, '\r\n');
    const m = parseStl(ascii(text));
    expect(m.name).toBe('one');
    expect(m.indices.length / 3).toBe(2);
    expect(m.openEdges).toBe(6);
    expect(m.closed).toBe(false);
  });

  it('a binary corner that is NaN or infinite is refused with its triangle', () => {
    const bytes = binaryStl([box()]);
    new DataView(bytes.buffer).setFloat32(84 + 50 * 4 + 12 + 4, NaN, true);
    expect(refusal(bytes)).toMatch(/第 5 個|Triangle 5/);
    new DataView(bytes.buffer).setFloat32(84 + 50 * 4 + 12 + 4, Infinity, true);
    expect(refusal(bytes)).toMatch(/第 5 個|Triangle 5/);
  });

  it('no triangles, or none with an area, is refused; triangles with no area among others are counted and left out', () => {
    expect(refusal(binaryStl([]))).toBeTruthy();
    expect(refusal(ascii('solid a\nendsolid a\n'))).toBeTruthy();
    expect(refusal(ascii(`solid a\n${facet([[0, 0, 0], [1, 1, 1], [2, 2, 2]])}${facet([[0, 0, 0], [0, 0, 0], [0, 1, 0]])}endsolid a\n`))).toMatch(/2/);
    const b = box();
    const m = parseStl(binaryStl([{ positions: [...b.positions, 5, 5, 5], indices: [...b.indices, 0, 0, 8, 1, 1, 1] }]));
    expect(m.degenerate).toBe(2);
    expect(m.indices.length / 3).toBe(12);
    expect(m.closed).toBe(true);
  });

  it('holes, more than two triangles on an edge, and a triangle turned the wrong way are each found', () => {
    const b = box();
    const open = parseStl(binaryStl([{ positions: b.positions, indices: b.indices.slice(3) }]));
    expect([open.openEdges, open.closed]).toEqual([3, false]);
    const extra = parseStl(binaryStl([{ positions: [...b.positions, 10, 5, 20], indices: [...b.indices, 4, 5, 8] }]));
    expect(extra.nonManifoldEdges).toBe(1);
    expect(extra.closed).toBe(false);
    const turned = b.indices.slice();
    [turned[1], turned[2]] = [turned[2]!, turned[1]!];
    const flipped = parseStl(binaryStl([{ positions: b.positions, indices: turned }]));
    expect([flipped.openEdges, flipped.flippedEdges, flipped.closed]).toEqual([0, 3, false]);
    // all turned: closed, but the volume says it is inside out
    const inside = parseStl(binaryStl([{ positions: b.positions, indices: b.indices.map((_, i, a) => a[i - (i % 3) + [0, 2, 1][i % 3]!]!) }]));
    expect(inside.closed).toBe(true);
    expect(inside.volume).toBeCloseTo(-1000, 9);
  });

  it('a binary file claiming more triangles than the limit is refused before reading them', () => {
    expect(() => parseStl(binaryStl([box()]), 'mm', 11)).toThrow(/12.*11/);
    expect(() => parseStl(ascii(asciiStl([box()])), 'mm', 11)).toThrow(/11/);
    expect(parseStl(binaryStl([box()]), 'mm', 12).indices.length).toBe(36);
    expect(STL_MAX_TRIANGLES).toBe(2_000_000);
  });

  it('what is not an STL is refused and not taken for one', () => {
    expect(refusal(new Uint8Array(10))).toBeTruthy();
    expect(refusal(ascii('ISO-10303-21;\nHEADER;\n'.repeat(10)))).toBeTruthy();
    expect(isStlData(ascii('ISO-10303-21;\n'))).toBe(false);
    expect(isStlData(ascii(asciiStl([box()])))).toBe(true);
    expect(isStlData(binaryStl([box()]))).toBe(true);
  });
});

describe('STL writing (F4.1, ADR 0221)', () => {
  it('a long name with characters of more than one byte is cut to the 80 bytes of the header on a character, and never starts with "solid"', () => {
    const bytes = binaryStl([], '定位板'.repeat(40));
    expect(bytes.byteLength).toBe(84);
    const header = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, 80).filter((x) => x !== 0));
    expect(header.startsWith('binary STL 定位板')).toBe(true);
    expect(new DataView(bytes.buffer).getUint32(80, true)).toBe(0);
    expect(binaryStl([box()], 'solid').subarray(0, 5)).not.toEqual(new TextEncoder().encode('solid'));
  });

  it('an ASCII name is printable ASCII, every other character an underscore', () => {
    expect(stlAsciiName('定位板 A-1')).toBe('____A-1');
    expect(asciiStl([box()], '定位板').split('\n')[0]).toBe('solid ___');
    expect(asciiStl([box()], '').split('\n')[0]).toBe('solid 3D-Builder');
  });
});

describe('STL reading under random damage (AGENTS.md §3.4)', () => {
  it('200 damaged files: each read or refused with an StlError, never anything else; what is read has finite corners', () => {
    let seed = 20261101;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const sources = [binaryStl([box()], 'box'), ascii(asciiStl([box(7, 3, 2)], 'box'))];
    let read = 0;
    let refused = 0;
    for (let i = 0; i < 200; i++) {
      const src = sources[i % 2]!;
      let bytes: Uint8Array = src.slice();
      const kind = Math.floor(random() * 4);
      if (kind === 0) bytes = bytes.subarray(0, Math.floor(random() * bytes.length));
      else if (kind === 1) for (let n = 0; n < 1 + random() * 8; n++) bytes[Math.floor(random() * bytes.length)] = Math.floor(random() * 256);
      else if (kind === 2) {
        const at = Math.floor(random() * bytes.length);
        bytes = Uint8Array.from([...bytes.subarray(0, at), ...bytes.subarray(at + 1 + Math.floor(random() * 40))]);
      } else {
        const at = Math.floor(random() * bytes.length);
        bytes = Uint8Array.from([...bytes.subarray(0, at), ...bytes.subarray(at - Math.min(at, 30), at), ...bytes.subarray(at)]);
      }
      try {
        const m = parseStl(bytes);
        expect(m.positions.every(Number.isFinite)).toBe(true);
        expect(m.indices.every((x) => x < m.positions.length / 3)).toBe(true);
        read++;
      } catch (e) {
        expect(e).toBeInstanceOf(StlError);
        refused++;
      }
    }
    console.log(`STL fuzz: ${read} read, ${refused} refused`);
    expect(read).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);
  });
});
