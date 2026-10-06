import { t } from '@3db/i18n';

/**
 * A reader for the DXF (ASCII) that `toDxf` writes, and a check of what it reads (F3.1): the structure of the file (sections in order, group code and value pairs,
 * the end of file), the handles (each once, each owner there), and what the entities refer to (layers, linetypes, the text style). It reads the entities a drawing
 * has: LWPOLYLINE, SOLID, TEXT and DIMENSION (with the entities of the block it names, `blockEntities`), with `\U+XXXX` turned back into the character. It is the proof that the file says what the scene says, until it is opened in a CAD program.
 */

export class DxfError extends Error {}

export type Pair = [code: number, value: string];

export interface DxfEntity {
  type: string;
  handle: string;
  owner: string;
  layer: string;
  pairs: Pair[];
}

export interface DxfPolyline extends DxfEntity {
  type: 'LWPOLYLINE';
  closed: boolean;
  /** x, y, x, y … */
  points: number[];
}
export interface DxfSolid extends DxfEntity {
  type: 'SOLID';
  /** The four corners, x, y each (the fourth repeats the third for a triangle). */
  points: number[];
}
export interface DxfText extends DxfEntity {
  type: 'TEXT';
  at: [number, number];
  height: number;
  text: string;
  angle: number;
  /** 0 left, 1 center, 2 right. */
  align: number;
}

/** A DIMENSION: its kind, the point of the dimension line (or the circle, or the second line of an angle) it is defined by, where its text is, the text, and the points of its kind. */
export interface DxfDimension extends DxfEntity {
  type: 'DIMENSION';
  /** The name of the block it is drawn with. */
  block: string;
  style: string;
  /** 0 rotated, 1 aligned, 2 angular, 3 diameter, 4 radius (the flag bits taken off). */
  kind: number;
  /** Group 10. */
  def: [number, number];
  /** Group 11: the middle of the text. */
  textAt: [number, number];
  text: string;
  /** Groups 13, 14, 15 and 16, those there are. */
  points: Map<number, [number, number]>;
  /** Group 50 (a horizontal or vertical linear dimension), group 40 (the leader of a circle's). */
  rotation?: number;
  leader?: number;
}

export interface DxfLine extends DxfEntity {
  type: 'LINE';
  a: [number, number];
  b: [number, number];
}
export interface DxfArc extends DxfEntity {
  type: 'ARC';
  c: [number, number];
  r: number;
  /** Degrees, counter-clockwise from the start to the end. */
  start: number;
  end: number;
}
export interface DxfCircle extends DxfEntity {
  type: 'CIRCLE';
  c: [number, number];
  r: number;
}

export interface DxfTableEntry {
  name: string;
  handle: string;
  owner: string;
  pairs: Pair[];
}

export interface DxfDocument {
  version: string;
  header: Map<string, Pair[]>;
  tables: Map<string, { handle: string; count: number; entries: DxfTableEntry[] }>;
  blocks: string[];
  /** The handles of the BLOCK and ENDBLK records, with the owner each says. */
  blockHandles: { handle: string; owner: string }[];
  /** What each block holds (the anonymous blocks of the dimensions, `*D1` …). */
  blockEntities: Map<string, (DxfPolyline | DxfSolid | DxfText | DxfLine | DxfArc | DxfCircle | DxfDimension | DxfEntity)[]>;
  entities: (DxfPolyline | DxfSolid | DxfText | DxfLine | DxfArc | DxfCircle | DxfDimension | DxfEntity)[];
  objects: DxfEntity[];
  /** The sections in the order they come. */
  sections: string[];
}

/** `\U+XXXX` turned back into characters (a surrogate pair is two of them), `\\` into a backslash. */
export function dxfUnescape(s: string): string {
  return s.replace(/\\U\+([0-9A-Fa-f]{4})|\\\\/g, (m, hex?: string) => (hex ? String.fromCharCode(parseInt(hex, 16)) : '\\'));
}

function pairsOf(text: string): Pair[] {
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  if (lines.length % 2 !== 0) throw new DxfError(t('dxf.oddLines'));
  const out: Pair[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const code = Number(lines[i]!.trim());
    if (!Number.isInteger(code)) throw new DxfError(t('dxf.badCode', { line: i + 1, text: lines[i]! }));
    out.push([code, lines[i + 1]!]);
  }
  return out;
}

const first = (pairs: Pair[], code: number): string | undefined => pairs.find((p) => p[0] === code)?.[1];
const numberOf = (pairs: Pair[], code: number, fallback = 0): number => {
  const v = first(pairs, code);
  return v === undefined ? fallback : Number(v);
};

/** Reads a DXF. Throws a `DxfError` for a file that is not made of group code and value pairs, or has no end of file. */
export function readDxf(text: string): DxfDocument {
  const pairs = pairsOf(text);
  if (pairs.length === 0 || pairs[pairs.length - 1]![0] !== 0 || pairs[pairs.length - 1]![1] !== 'EOF') throw new DxfError(t('dxf.noEof'));
  const doc: DxfDocument = { version: '', header: new Map(), tables: new Map(), blocks: [], blockHandles: [], blockEntities: new Map(), entities: [], objects: [], sections: [] };
  let i = 0;
  /** The records of a section: each starts at a group 0 and runs to the next. */
  const records = (): Pair[][] => {
    const out: Pair[][] = [];
    while (i < pairs.length && !(pairs[i]![0] === 0 && pairs[i]![1] === 'ENDSEC')) {
      if (pairs[i]![0] !== 0) throw new DxfError(t('dxf.stray', { code: pairs[i]![0] }));
      const rec: Pair[] = [pairs[i++]!];
      while (i < pairs.length && pairs[i]![0] !== 0) rec.push(pairs[i++]!);
      out.push(rec);
    }
    if (i >= pairs.length) throw new DxfError(t('dxf.noEndsec'));
    i++; // ENDSEC
    return out;
  };
  while (i < pairs.length) {
    const [code, value] = pairs[i]!;
    if (code === 0 && value === 'EOF') break;
    if (!(code === 0 && value === 'SECTION') || pairs[i + 1]?.[0] !== 2) throw new DxfError(t('dxf.expectSection', { at: i }));
    const name = pairs[i + 1]![1];
    i += 2;
    doc.sections.push(name);
    if (name === 'HEADER') {
      // 9 variable, followed by its groups
      let key = '';
      while (i < pairs.length && !(pairs[i]![0] === 0 && pairs[i]![1] === 'ENDSEC')) {
        const p = pairs[i++]!;
        if (p[0] === 9) {
          key = p[1];
          doc.header.set(key, []);
        } else if (key) doc.header.get(key)!.push(p);
      }
      if (i >= pairs.length) throw new DxfError(t('dxf.noEndsec'));
      i++;
      doc.version = doc.header.get('$ACADVER')?.[0]?.[1] ?? '';
    } else if (name === 'TABLES') {
      let current: { handle: string; count: number; entries: DxfTableEntry[] } | null = null;
      for (const rec of records()) {
        const kind = rec[0]![1];
        if (kind === 'TABLE') {
          const tname = first(rec, 2) ?? '';
          current = { handle: first(rec, 5) ?? '', count: numberOf(rec, 70), entries: [] };
          doc.tables.set(tname, current);
        } else if (kind === 'ENDTAB') current = null;
        else if (current) current.entries.push({ name: first(rec, 2) ?? '', handle: first(rec, 5) ?? first(rec, 105) ?? '', owner: first(rec, 330) ?? '', pairs: rec });
        else throw new DxfError(t('dxf.outsideTable', { kind }));
      }
    } else if (name === 'BLOCKS') {
      let block: string | null = null;
      for (const rec of records()) {
        const kind = rec[0]![1];
        if (kind === 'BLOCK') {
          block = first(rec, 2) ?? '';
          doc.blocks.push(block);
          doc.blockEntities.set(block, []);
        }
        doc.blockHandles.push({ handle: first(rec, 5) ?? '', owner: first(rec, 330) ?? '' });
        if (kind === 'ENDBLK') block = null;
        else if (kind !== 'BLOCK' && block !== null) doc.blockEntities.get(block)!.push(entityOf(rec));
      }
    } else if (name === 'ENTITIES') {
      for (const rec of records()) doc.entities.push(entityOf(rec));
    } else if (name === 'OBJECTS') {
      for (const rec of records()) doc.objects.push({ type: rec[0]![1], handle: first(rec, 5) ?? '', owner: first(rec, 330) ?? '', layer: '', pairs: rec });
    } else records();
  }
  return doc;
}

function entityOf(rec: Pair[]): DxfPolyline | DxfSolid | DxfText | DxfLine | DxfArc | DxfCircle | DxfDimension | DxfEntity {
  const base = { type: rec[0]![1], handle: first(rec, 5) ?? '', owner: first(rec, 330) ?? '', layer: first(rec, 8) ?? '', pairs: rec };
  if (base.type === 'LWPOLYLINE') {
    const points: number[] = [];
    for (let k = 0; k < rec.length; k++) if (rec[k]![0] === 10) points.push(Number(rec[k]![1]), Number(rec[k + 1]![1]));
    return { ...base, type: 'LWPOLYLINE', closed: (numberOf(rec, 70) & 1) === 1, points };
  }
  if (base.type === 'SOLID') {
    const points: number[] = [];
    for (const c of [10, 11, 12, 13]) points.push(numberOf(rec, c), numberOf(rec, c + 10));
    return { ...base, type: 'SOLID', points };
  }
  if (base.type === 'TEXT') {
    const align = numberOf(rec, 72);
    const at: [number, number] = align === 0 ? [numberOf(rec, 10), numberOf(rec, 20)] : [numberOf(rec, 11), numberOf(rec, 21)];
    return { ...base, type: 'TEXT', at, height: numberOf(rec, 40), text: dxfUnescape(first(rec, 1) ?? ''), angle: numberOf(rec, 50), align };
  }
  if (base.type === 'LINE') return { ...base, type: 'LINE', a: [numberOf(rec, 10), numberOf(rec, 20)], b: [numberOf(rec, 11), numberOf(rec, 21)] };
  if (base.type === 'ARC') return { ...base, type: 'ARC', c: [numberOf(rec, 10), numberOf(rec, 20)], r: numberOf(rec, 40), start: numberOf(rec, 50), end: numberOf(rec, 51) };
  if (base.type === 'CIRCLE') return { ...base, type: 'CIRCLE', c: [numberOf(rec, 10), numberOf(rec, 20)], r: numberOf(rec, 40) };
  if (base.type === 'DIMENSION') {
    const points = new Map<number, [number, number]>();
    for (const c of [13, 14, 15, 16]) if (first(rec, c) !== undefined) points.set(c, [numberOf(rec, c), numberOf(rec, c + 10)]);
    return {
      ...base,
      type: 'DIMENSION',
      block: first(rec, 2) ?? '',
      style: first(rec, 3) ?? '',
      kind: numberOf(rec, 70) & 7,
      def: [numberOf(rec, 10), numberOf(rec, 20)],
      textAt: [numberOf(rec, 11), numberOf(rec, 21)],
      text: dxfUnescape(first(rec, 1) ?? ''),
      points,
      ...(first(rec, 50) !== undefined ? { rotation: numberOf(rec, 50) } : {}),
      ...(first(rec, 40) !== undefined ? { leader: numberOf(rec, 40) } : {}),
    };
  }
  return base;
}

/**
 * What is wrong with a DXF that was read, in words (empty: nothing). Release 2000, the sections in their order, every handle once and every owner there, the tables
 * as many entries as they say, the layers, linetypes and text style the entities use, and entities with the data they need.
 */
export function checkDxf(doc: DxfDocument): string[] {
  const problems: string[] = [];
  if (doc.version !== 'AC1015') problems.push(t('dxf.version', { version: doc.version }));
  const order = ['HEADER', 'CLASSES', 'TABLES', 'BLOCKS', 'ENTITIES', 'OBJECTS'];
  if (doc.sections.join() !== order.join()) problems.push(t('dxf.sectionOrder', { sections: doc.sections.join(' ') }));
  const handles = new Map<string, number>();
  const note = (h: string) => handles.set(h, (handles.get(h) ?? 0) + 1);
  const owners: string[] = [];
  for (const table of doc.tables.values()) {
    note(table.handle);
    if (table.count !== table.entries.length) problems.push(t('dxf.tableCount', { handle: table.handle }));
    for (const e of table.entries) {
      note(e.handle);
      owners.push(e.owner);
    }
  }
  for (const b of doc.blockHandles) {
    note(b.handle);
    owners.push(b.owner);
  }
  for (const e of [...doc.entities, ...doc.objects]) {
    note(e.handle);
    if (e.owner) owners.push(e.owner);
  }
  for (const [h, n] of handles) if (!h) problems.push(t('dxf.noHandle'));
  for (const [h, n] of handles) if (n > 1) problems.push(t('dxf.dupHandle', { handle: h }));
  for (const o of owners) if (o !== '0' && !handles.has(o)) problems.push(t('dxf.noOwner', { owner: o }));
  const layers = new Set(doc.tables.get('LAYER')?.entries.map((e) => e.name));
  const linetypes = new Set(doc.tables.get('LTYPE')?.entries.map((e) => e.name.toUpperCase()));
  for (const e of doc.tables.get('LAYER')?.entries ?? []) {
    const lt = first(e.pairs, 6) ?? '';
    if (!linetypes.has(lt.toUpperCase())) problems.push(t('dxf.noLinetype', { name: lt }));
  }
  // what is in model space, and what the blocks of the dimensions hold
  for (const e of [...doc.entities, ...[...doc.blockEntities.values()].flat()]) {
    if (!layers.has(e.layer)) problems.push(t('dxf.noLayer', { layer: e.layer, handle: e.handle }));
    if (e.type === 'LWPOLYLINE') {
      const n = numberOf(e.pairs, 90);
      if ((e as DxfPolyline).points.length !== 2 * n) problems.push(t('dxf.vertexCount', { handle: e.handle }));
    }
    if (!['LWPOLYLINE', 'SOLID', 'TEXT', 'LINE', 'ARC', 'CIRCLE', 'DIMENSION'].includes(e.type)) problems.push(t('dxf.unknownEntity', { type: e.type }));
    if (e.type === 'DIMENSION') problems.push(...checkDimension(doc, e as DxfDimension));
    if (e.type === 'TEXT' && !doc.tables.get('STYLE')?.entries.some((s) => s.name === (first(e.pairs, 7) ?? 'STANDARD'))) problems.push(t('dxf.noStyle', { handle: e.handle }));
  }
  if (!doc.tables.get('BLOCK_RECORD')?.entries.some((e) => e.name === '*Model_Space')) problems.push(t('dxf.noModelSpace'));
  for (const b of ['*Model_Space', '*Paper_Space']) if (!doc.blocks.includes(b)) problems.push(t('dxf.noBlock', { name: b }));
  return problems;
}

/** The points each kind of dimension is defined by (groups 13 to 16). */
const DIMENSION_POINTS: Record<number, number[]> = { 0: [13, 14], 1: [13, 14], 2: [13, 14, 15, 16], 3: [15], 4: [15] };

/** What is wrong with a DIMENSION: its block is not there, its style is not, it lacks the points of its kind or says nothing. */
function checkDimension(doc: DxfDocument, e: DxfDimension): string[] {
  const problems: string[] = [];
  if (!doc.blocks.includes(e.block) || !doc.tables.get('BLOCK_RECORD')?.entries.some((r) => r.name === e.block)) problems.push(t('dxf.dimNoBlock', { handle: e.handle, block: e.block }));
  if (!doc.tables.get('DIMSTYLE')?.entries.some((s) => s.name === e.style)) problems.push(t('dxf.dimNoStyle', { handle: e.handle, style: e.style }));
  const need = DIMENSION_POINTS[e.kind];
  if (!need) problems.push(t('dxf.dimKind', { handle: e.handle, kind: e.kind }));
  else if (need.some((c) => !e.points.has(c))) problems.push(t('dxf.dimPoints', { handle: e.handle }));
  if (e.text === '') problems.push(t('dxf.dimText', { handle: e.handle }));
  return problems;
}

/**
 * What a CAD program would measure from the definition points of a DIMENSION, in the units of the sheet: the distance along the dimension line for a linear one, the
 * distance between the two points on the circle for a diameter, from the centre for a radius, and the angle in degrees between the two lines for an angular one.
 * Null for a dimension that lacks its points.
 */
export function dimensionMeasure(e: DxfDimension): number | null {
  const p = e.points;
  if (e.kind === 0 || e.kind === 1) {
    const a = p.get(13);
    const b = p.get(14);
    if (!a || !b) return null;
    // the dimension line runs along `rotation` (rotated), or along the line through the two points (aligned)
    if (e.kind === 0) {
      const r = ((e.rotation ?? 0) * Math.PI) / 180;
      return Math.abs((b[0] - a[0]) * Math.cos(r) + (b[1] - a[1]) * Math.sin(r));
    }
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  if (e.kind === 3 || e.kind === 4) {
    const near = p.get(15);
    return near ? Math.hypot(near[0] - e.def[0], near[1] - e.def[1]) : null;
  }
  if (e.kind === 2) {
    const a1 = p.get(13);
    const a2 = p.get(14);
    const b1 = p.get(15);
    if (!a1 || !a2 || !b1) return null;
    const b2 = e.def;
    const u = Math.atan2(a2[1] - a1[1], a2[0] - a1[0]);
    const v = Math.atan2(b2[1] - b1[1], b2[0] - b1[0]);
    const turn = Math.abs(((v - u) * 180) / Math.PI) % 360;
    return turn > 180 ? 360 - turn : turn;
  }
  return null;
}

/** Everything a viewer shows of the drawing: the entities of the model space with each DIMENSION replaced by what its block holds. */
export function drawnEntities(doc: DxfDocument): DxfDocument['entities'] {
  return doc.entities.flatMap((e) => (e.type === 'DIMENSION' ? (doc.blockEntities.get((e as DxfDimension).block) ?? []) : [e]));
}
