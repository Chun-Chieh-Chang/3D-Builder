import { t } from '@3db/i18n';

/**
 * Reading an STL file (F2.3, ADR 0221). It is plain arithmetic on the file's bytes, with nothing of the kernel, so the rebuild and the page read a file
 * the same way; writing one is `@3db/io`'s.
 */

/** The unit an STL's numbers are in. The file does not say: who writes it chooses, who reads it is told (ADR 0221). */
export type StlUnit = 'mm' | 'inch';
export const STL_UNITS: readonly StlUnit[] = ['mm', 'inch'];
/** Millimetres in one unit. */
export const STL_UNIT_MM: Record<StlUnit, number> = { mm: 1, inch: 25.4 };

/** The most triangles an STL may have to be read (ADR 0221): the mesh goes to the page on every rebuild, about 18 bytes a triangle. */
export const STL_MAX_TRIANGLES = 2_000_000;

/** An STL that cannot be read, and why, in the user's words. */
export class StlError extends Error {}

/** The mesh of an STL file, its vertices shared where the file repeats them exactly, in millimetres. */
export interface StlMesh {
  format: 'binary' | 'ascii';
  /** The name the file gives (the ASCII `solid` name, else the binary header), trimmed. */
  name: string;
  positions: Float32Array;
  indices: Uint32Array;
  /** Triangles the file holds, and those left out because two of their corners are the same point or all three lie on a line. */
  fileTriangles: number;
  degenerate: number;
  /** Edges with one triangle (holes in the surface), and with more than two (it is not a surface there). */
  openEdges: number;
  nonManifoldEdges: number;
  /** Edges two triangles run the same way along: their normals disagree. */
  flippedEdges: number;
  /** Closed, manifold, consistently wound: the volume means something. */
  closed: boolean;
  /** Signed: negative when a closed mesh's triangles face inwards. */
  volume: number;
  area: number;
  min: [number, number, number];
  max: [number, number, number];
}

const countOf = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true);

/** Is this a binary STL by its size: 84 bytes and 50 a triangle, as the count in the header says. */
function binaryBySize(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 84 && bytes.byteLength === 84 + 50 * countOf(bytes);
}

/** Does the file start with `solid` (after blanks): an ASCII STL, or a binary one whose header was written so. */
function startsSolid(bytes: Uint8Array): boolean {
  let i = 0;
  while (i < bytes.length && (bytes[i] === 0x20 || bytes[i] === 0x09 || bytes[i] === 0x0a || bytes[i] === 0x0d)) i++;
  return new TextDecoder('latin1').decode(bytes.subarray(i, i + 5)).toLowerCase() === 'solid';
}

/** Content says STL: a binary one by its size, an ASCII one by `solid` and a `facet`. */
export function isStlData(bytes: Uint8Array): boolean {
  if (binaryBySize(bytes)) return true;
  return startsSolid(bytes) && /\bfacet\b/i.test(new TextDecoder('latin1').decode(bytes.subarray(0, 4096)));
}

/** The corners of each triangle (nine numbers), as the file gives them, in the file's unit. */
function binaryCorners(bytes: Uint8Array, limit: number): { corners: Float32Array; name: string } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = countOf(bytes);
  if (count > limit) throw new StlError(t('stl.tooMany', { n: count, max: limit }));
  const corners = new Float32Array(count * 9);
  for (let i = 0; i < count; i++) for (let k = 0; k < 9; k++) corners[9 * i + k] = view.getFloat32(84 + 50 * i + 12 + 4 * k, true);
  const header = new TextDecoder('latin1').decode(bytes.subarray(0, 80));
  const end = header.indexOf('\0');
  return { corners, name: (end < 0 ? header : header.slice(0, end)).trim() };
}

/** The corners of an ASCII STL, read strictly: any word out of place stops it, with its line. Several `solid`s in one file are read as one mesh. */
function asciiCorners(text: string, limit: number): { corners: Float32Array; name: string } {
  const out: number[] = [];
  let name = '';
  let line = 1;
  let at = 0;
  const blank = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';
  const word = (): string | null => {
    while (at < text.length && blank(text[at]!)) if (text[at++] === '\n') line++;
    if (at >= text.length) return null;
    const start = at;
    while (at < text.length && !blank(text[at]!)) at++;
    return text.slice(start, at);
  };
  const restOfLine = (): string => {
    const end = text.indexOf('\n', at);
    const s = text.slice(at, end < 0 ? text.length : end);
    at = end < 0 ? text.length : end;
    return s.trim();
  };
  const fail = (what: string): never => {
    throw new StlError(t('stl.asciiBad', { line, what }));
  };
  const end = () => t('stl.asciiEnd');
  const expect = (w: string) => {
    const got = word();
    if (got?.toLowerCase() !== w) fail(t('stl.asciiExpected', { want: w, got: got ?? end() }));
  };
  const number = (): number => {
    const w = word();
    if (w === null || !/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(w)) return fail(t('stl.asciiNumber', { got: w ?? end() }));
    const x = Number(w);
    if (!Number.isFinite(Math.fround(x))) fail(t('stl.asciiNumber', { got: w }));
    return x;
  };
  let solids = 0;
  for (let w = word(); w !== null; w = word()) {
    if (w.toLowerCase() !== 'solid') fail(t('stl.asciiExpected', { want: 'solid', got: w }));
    const n = restOfLine();
    if (solids++ === 0) name = n;
    for (;;) {
      const v = word();
      if (v === null) return fail(t('stl.asciiExpected', { want: 'endsolid', got: end() }));
      if (v.toLowerCase() === 'endsolid') {
        restOfLine();
        break;
      }
      if (v.toLowerCase() !== 'facet') fail(t('stl.asciiExpected', { want: 'facet', got: v }));
      expect('normal');
      // the normal is not used (it comes from the corners), but it must be three words; some writers put nan there
      for (let i = 0; i < 3; i++) if (word() === null) fail(t('stl.asciiExpected', { want: 'normal', got: end() }));
      expect('outer');
      expect('loop');
      for (let i = 0; i < 3; i++) {
        expect('vertex');
        out.push(number(), number(), number());
      }
      expect('endloop');
      expect('endfacet');
      if (out.length / 9 > limit) throw new StlError(t('stl.tooMany', { n: `> ${limit}`, max: limit }));
    }
  }
  if (solids === 0) throw new StlError(t('stl.notStl'));
  return { corners: Float32Array.from(out), name };
}

/**
 * Reads an STL (F2.3, ADR 0221), binary or ASCII by its content: a binary file is one whose size is what its triangle count says, even when its header
 * starts with `solid`. The numbers are multiplied into millimetres by `unit`. Corners the file repeats exactly become one vertex, so which edges are
 * shared can be counted; triangles with no area are left out and counted. A file that is not an STL, is cut short, holds a number that is not finite, or
 * has no triangle with an area is refused with the reason: nothing is guessed or mended. `maxTriangles` is `STL_MAX_TRIANGLES` but for a test of the limit.
 */
export function parseStl(bytes: Uint8Array, unit: StlUnit = 'mm', maxTriangles = STL_MAX_TRIANGLES): StlMesh {
  if (!STL_UNITS.includes(unit)) throw new StlError(t('stl.badUnit', { unit: String(unit) }));
  const cut = () => new StlError(t('stl.binaryCut', { size: bytes.byteLength, n: countOf(bytes) }));
  let read: { corners: Float32Array; name: string };
  let format: StlMesh['format'];
  if (binaryBySize(bytes)) {
    read = binaryCorners(bytes, maxTriangles);
    format = 'binary';
  } else if (startsSolid(bytes)) {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      // not text: a binary file whose header starts with "solid", cut short
      throw bytes.byteLength >= 84 ? cut() : new StlError(t('stl.notStl'));
    }
    read = asciiCorners(text, maxTriangles);
    format = 'ascii';
  } else if (bytes.byteLength >= 84) {
    throw cut();
  } else {
    throw new StlError(t('stl.notStl'));
  }
  const { corners } = read;
  for (let i = 0; i < corners.length; i++) if (!Number.isFinite(corners[i]!)) throw new StlError(t('stl.notFinite', { n: Math.floor(i / 9) + 1 }));
  const scale = STL_UNIT_MM[unit];
  const fileTriangles = corners.length / 9;

  // one vertex for each point the file repeats exactly
  const ids = new Map<string, number>();
  const positions: number[] = [];
  const vertex = (i: number): number => {
    const key = `${corners[i]},${corners[i + 1]},${corners[i + 2]}`;
    let id = ids.get(key);
    if (id === undefined) {
      id = positions.length / 3;
      ids.set(key, id);
      positions.push(corners[i]! * scale, corners[i + 1]! * scale, corners[i + 2]! * scale);
    }
    return id;
  };
  const P = (v: number) => [positions[3 * v]!, positions[3 * v + 1]!, positions[3 * v + 2]!] as const;
  const indices: number[] = [];
  let degenerate = 0;
  let volume = 0;
  let area = 0;
  for (let k = 0; k < fileTriangles; k++) {
    const [a, b, c] = [vertex(9 * k), vertex(9 * k + 3), vertex(9 * k + 6)];
    const [pa, pb, pc] = [P(a), P(b), P(c)];
    const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]] as const;
    const v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]] as const;
    const twice = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
    if (a === b || b === c || a === c || twice === 0) {
      degenerate++;
      continue;
    }
    indices.push(a, b, c);
    area += twice / 2;
    volume += (pa[0] * (pb[1] * pc[2] - pb[2] * pc[1]) - pa[1] * (pb[0] * pc[2] - pb[2] * pc[0]) + pa[2] * (pb[0] * pc[1] - pb[1] * pc[0])) / 6;
  }
  if (indices.length === 0) throw new StlError(fileTriangles === 0 ? t('stl.empty') : t('stl.allDegenerate', { n: fileTriangles }));

  // how each edge is shared: by how many triangles, and which way they run along it
  const edges = new Map<string, { n: number; forward: number }>();
  for (let k = 0; k < indices.length; k += 3) {
    for (const [p, q] of [[indices[k]!, indices[k + 1]!], [indices[k + 1]!, indices[k + 2]!], [indices[k + 2]!, indices[k]!]] as const) {
      const key = p < q ? `${p},${q}` : `${q},${p}`;
      const e = edges.get(key) ?? { n: 0, forward: 0 };
      e.n++;
      if (p < q) e.forward++;
      edges.set(key, e);
    }
  }
  let openEdges = 0;
  let nonManifoldEdges = 0;
  let flippedEdges = 0;
  for (const e of edges.values()) {
    if (e.n === 1) openEdges++;
    else if (e.n > 2) nonManifoldEdges++;
    else if (e.forward !== 1) flippedEdges++;
  }
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const i of indices) {
    for (let d = 0; d < 3; d++) {
      min[d] = Math.min(min[d]!, positions[3 * i + d]!);
      max[d] = Math.max(max[d]!, positions[3 * i + d]!);
    }
  }
  return {
    format,
    name: read.name,
    positions: Float32Array.from(positions),
    indices: Uint32Array.from(indices),
    fileTriangles,
    degenerate,
    openEdges,
    nonManifoldEdges,
    flippedEdges,
    closed: openEdges === 0 && nonManifoldEdges === 0 && flippedEdges === 0,
    volume,
    area,
    min,
    max,
  };
}
