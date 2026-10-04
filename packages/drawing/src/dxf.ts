import { LINE_STYLES, type LineStyle, type Scene } from './scene';

/**
 * The drawing as a DXF (F3.1): ASCII, release 2000 (AC1015), in millimetres, model space, written from the same scene as the SVG and the PDF. Each line style is
 * a layer (VISIBLE, HIDDEN, CENTER, THIN, FRAME, DIMENSION, with the linetype and lineweight of ISO 128), the text is on TEXT; a polyline is an LWPOLYLINE, a
 * filled polygon (an arrowhead) SOLIDs (a triangle fan), text is TEXT with every character outside ASCII written as `\U+XXXX` (any reader knows it). The
 * file has the handles, owners and tables a 2000 file has, and `readDxf` checks all of it.
 */

export const DXF_VERSION = 'AC1015';
export const TEXT_LAYER = 'TEXT';

/** The linetypes the layers use: name, description and the pattern (mm, positive on, negative off). */
export const DXF_LINETYPES: { name: string; description: string; pattern: number[] }[] = [
  { name: 'CONTINUOUS', description: 'Solid line', pattern: [] },
  { name: 'DASHED', description: 'Dashed __ __ __ __', pattern: [3, -1] },
  { name: 'CENTER', description: 'Center ____ _ ____ _', pattern: [12, -2, 2, -2] },
];

const num = (v: number) => {
  const s = (Math.round(v * 1e6) / 1e6 + 0).toFixed(6).replace(/\.?0+$/, '');
  return s === '-0' || s === '' ? '0' : s;
};

/** Text for a DXF string: characters outside ASCII (and the backslash) written as \U+XXXX; a surrogate pair is two of them. */
export function dxfEscape(text: string): string {
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x5c) out += '\\\\';
    else if (cp >= 0x20 && cp < 0x7f) out += ch;
    else if (cp > 0xffff) {
      const v = cp - 0x10000;
      out += `\\U+${(0xd800 + (v >> 10)).toString(16).toUpperCase().padStart(4, '0')}\\U+${(0xdc00 + (v & 0x3ff)).toString(16).toUpperCase().padStart(4, '0')}`;
    } else out += `\\U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
  }
  return out;
}

class Out {
  readonly lines: string[] = [];
  g(code: number, value: string | number): this {
    this.lines.push(String(code), typeof value === 'number' ? num(value) : value);
    return this;
  }
  int(code: number, value: number): this {
    this.lines.push(String(code), String(Math.trunc(value)));
    return this;
  }
}

/** What more than the scene a DXF can be given (the flat pattern of a sheet metal part, C11.3): its own layers in place of the line styles', and entities written after the scene's. */
/** Group codes written one after the other. */
export interface DxfWrite {
  g: (code: number, value: string | number) => DxfWrite;
  int: (code: number, value: number) => DxfWrite;
}

export interface DxfExtras {
  layers?: { name: string; linetype: string; weight: number }[];
  entities?: (out: {
    /** Starts an entity on a layer; the group codes of the entity follow through `g` and `int`. */
    entity: (type: string, layer: string, subclass: string) => void;
    g: (code: number, value: string | number) => DxfWrite;
    int: (code: number, value: number) => DxfWrite;
    /** Tells the header the extent of what was written. */
    extent: (x: number, y: number) => void;
  }) => void;
}

/** The scene as a DXF (AC1015). */
export function toDxf(scene: Scene, extras?: DxfExtras): string {
  let next = 0x30;
  const handle = () => (next++).toString(16).toUpperCase();
  const o = new Out();

  // the fixed objects: their handles are chosen first so that tables can point at each other
  const H = {
    vportTable: '8', ltypeTable: '5', layerTable: '2', styleTable: '3', viewTable: '6', ucsTable: '7', appidTable: '9', dimstyleTable: 'A', blockRecordTable: '1',
    modelRecord: 'B', paperRecord: 'C', rootDict: 'D', groupDict: 'E', byBlock: '10', byLayer: '11',
  };

  const layers: { name: string; linetype: string; weight: number }[] = [
    { name: '0', linetype: 'CONTINUOUS', weight: 25 },
    ...(extras?.layers ?? (Object.keys(LINE_STYLES) as LineStyle[]).map((k) => ({ name: LINE_STYLES[k].layer, linetype: LINE_STYLES[k].linetype, weight: Math.round(LINE_STYLES[k].width * 100) }))),
    { name: TEXT_LAYER, linetype: 'CONTINUOUS', weight: 25 },
  ];

  // the extent of what is drawn
  let minX = 0;
  let minY = 0;
  let maxX = scene.width;
  let maxY = scene.height;

  // ---- header
  o.g(0, 'SECTION').g(2, 'HEADER');
  o.g(9, '$ACADVER').g(1, DXF_VERSION);
  o.g(9, '$HANDSEED').g(5, 'FFFFFF');
  o.g(9, '$INSBASE').g(10, 0).g(20, 0).g(30, 0);
  o.g(9, '$EXTMIN').g(10, minX).g(20, minY).g(30, 0);
  o.g(9, '$EXTMAX').g(10, maxX).g(20, maxY).g(30, 0);
  o.g(9, '$LIMMIN').g(10, 0).g(20, 0);
  o.g(9, '$LIMMAX').g(10, scene.width).g(20, scene.height);
  o.g(9, '$LTSCALE').g(40, 1);
  o.g(9, '$MEASUREMENT').int(70, 1);
  o.g(9, '$INSUNITS').int(70, 4);
  o.g(9, '$LUNITS').int(70, 2);
  o.g(9, '$LUPREC').int(70, 4);
  o.g(9, '$TEXTSTYLE').g(7, 'STANDARD');
  o.g(9, '$CLAYER').g(8, '0');
  o.g(9, '$CELTYPE').g(6, 'BYLAYER');
  o.g(9, '$LWDISPLAY').int(290, 1);
  o.g(0, 'ENDSEC');
  o.g(0, 'SECTION').g(2, 'CLASSES').g(0, 'ENDSEC');

  // ---- tables
  o.g(0, 'SECTION').g(2, 'TABLES');
  const table = (name: string, h: string, count: number, body: () => void) => {
    o.g(0, 'TABLE').g(2, name).g(5, h).g(330, '0').g(100, 'AcDbSymbolTable').int(70, count);
    body();
    o.g(0, 'ENDTAB');
  };
  table('VPORT', H.vportTable, 1, () => {
    o.g(0, 'VPORT').g(5, handle()).g(330, H.vportTable).g(100, 'AcDbSymbolTableRecord').g(100, 'AcDbViewportTableRecord').g(2, '*Active').int(70, 0);
    o.g(10, 0).g(20, 0).g(11, 1).g(21, 1).g(12, scene.width / 2).g(22, scene.height / 2).g(13, 0).g(23, 0).g(14, 10).g(24, 10).g(15, 10).g(25, 10);
    o.g(16, 0).g(26, 0).g(36, 1).g(17, 0).g(27, 0).g(37, 0).g(40, scene.height).g(41, scene.width / scene.height).g(42, 50).g(43, 0).g(44, 0).g(50, 0).g(51, 0);
    o.int(71, 0).int(72, 100).int(73, 1).int(74, 3).int(75, 0).int(76, 0).int(77, 0).int(78, 0);
  });
  table('LTYPE', H.ltypeTable, 2 + DXF_LINETYPES.length, () => {
    const record = (h: string, name: string, description: string, pattern: number[]) => {
      o.g(0, 'LTYPE').g(5, h).g(330, H.ltypeTable).g(100, 'AcDbSymbolTableRecord').g(100, 'AcDbLinetypeTableRecord').g(2, name).int(70, 0).g(3, description).int(72, 65).int(73, pattern.length);
      o.g(40, pattern.reduce((a, b) => a + Math.abs(b), 0));
      for (const p of pattern) o.g(49, p).int(74, 0);
    };
    record(H.byBlock, 'ByBlock', '', []);
    record(H.byLayer, 'ByLayer', '', []);
    for (const lt of DXF_LINETYPES) record(handle(), lt.name, lt.description, lt.pattern);
  });
  table('LAYER', H.layerTable, layers.length, () => {
    for (const l of layers) o.g(0, 'LAYER').g(5, handle()).g(330, H.layerTable).g(100, 'AcDbSymbolTableRecord').g(100, 'AcDbLayerTableRecord').g(2, l.name).int(70, 0).int(62, 7).g(6, l.linetype).int(370, l.weight);
  });
  table('STYLE', H.styleTable, 1, () => {
    o.g(0, 'STYLE').g(5, handle()).g(330, H.styleTable).g(100, 'AcDbSymbolTableRecord').g(100, 'AcDbTextStyleTableRecord').g(2, 'STANDARD').int(70, 0).g(40, 0).g(41, 1).g(50, 0).int(71, 0).g(42, 2.5).g(3, 'txt').g(4, '');
  });
  table('VIEW', H.viewTable, 0, () => undefined);
  table('UCS', H.ucsTable, 0, () => undefined);
  table('APPID', H.appidTable, 1, () => {
    o.g(0, 'APPID').g(5, handle()).g(330, H.appidTable).g(100, 'AcDbSymbolTableRecord').g(100, 'AcDbRegAppTableRecord').g(2, 'ACAD').int(70, 0);
  });
  table('DIMSTYLE', H.dimstyleTable, 0, () => undefined);
  table('BLOCK_RECORD', H.blockRecordTable, 2, () => {
    o.g(0, 'BLOCK_RECORD').g(5, H.modelRecord).g(330, H.blockRecordTable).g(100, 'AcDbSymbolTableRecord').g(100, 'AcDbBlockTableRecord').g(2, '*Model_Space');
    o.g(0, 'BLOCK_RECORD').g(5, H.paperRecord).g(330, H.blockRecordTable).g(100, 'AcDbSymbolTableRecord').g(100, 'AcDbBlockTableRecord').g(2, '*Paper_Space');
  });
  o.g(0, 'ENDSEC');

  // ---- blocks
  o.g(0, 'SECTION').g(2, 'BLOCKS');
  for (const [name, owner] of [['*Model_Space', H.modelRecord], ['*Paper_Space', H.paperRecord]] as const) {
    o.g(0, 'BLOCK').g(5, handle()).g(330, owner).g(100, 'AcDbEntity').g(8, '0').g(100, 'AcDbBlockBegin').g(2, name).int(70, 0).g(10, 0).g(20, 0).g(30, 0).g(3, name).g(1, '');
    o.g(0, 'ENDBLK').g(5, handle()).g(330, owner).g(100, 'AcDbEntity').g(8, '0').g(100, 'AcDbBlockEnd');
  }
  o.g(0, 'ENDSEC');

  // ---- entities
  o.g(0, 'SECTION').g(2, 'ENTITIES');
  const entity = (type: string, layer: string, sub: string) => o.g(0, type).g(5, handle()).g(330, H.modelRecord).g(100, 'AcDbEntity').g(8, layer).g(100, sub);
  for (const item of scene.items) {
    if (item.kind === 'polyline') {
      const n = item.points.length / 2;
      if (n < 2) continue;
      for (let i = 0; i < item.points.length; i += 2) {
        minX = Math.min(minX, item.points[i]!);
        maxX = Math.max(maxX, item.points[i]!);
        minY = Math.min(minY, item.points[i + 1]!);
        maxY = Math.max(maxY, item.points[i + 1]!);
      }
      if (item.filled) {
        // a filled polygon: a fan of triangles from its first corner (a SOLID of three corners repeats the third)
        for (let k = 1; k + 1 < n; k++) {
          entity('SOLID', LINE_STYLES[item.style].layer, 'AcDbTrace');
          const p = [0, k, k + 1].map((j) => [item.points[2 * j]!, item.points[2 * j + 1]!] as const);
          o.g(10, p[0]![0]).g(20, p[0]![1]).g(30, 0).g(11, p[1]![0]).g(21, p[1]![1]).g(31, 0).g(12, p[2]![0]).g(22, p[2]![1]).g(32, 0).g(13, p[2]![0]).g(23, p[2]![1]).g(33, 0);
        }
        continue;
      }
      entity('LWPOLYLINE', LINE_STYLES[item.style].layer, 'AcDbPolyline');
      o.int(90, n).int(70, item.closed ? 1 : 0);
      for (let i = 0; i < item.points.length; i += 2) o.g(10, item.points[i]!).g(20, item.points[i + 1]!);
    } else if (item.text !== '') {
      entity('TEXT', TEXT_LAYER, 'AcDbText');
      const anchor = item.anchor === 'center' ? 1 : item.anchor === 'right' ? 2 : 0;
      o.g(10, item.at[0]).g(20, item.at[1]).g(30, 0).g(40, item.height).g(1, dxfEscape(item.text));
      if (item.angle) o.g(50, item.angle);
      o.g(7, 'STANDARD');
      if (anchor !== 0) o.int(72, anchor).g(11, item.at[0]).g(21, item.at[1]).g(31, 0);
      o.g(100, 'AcDbText');
      if (anchor !== 0) o.int(73, 0);
      minX = Math.min(minX, item.at[0]);
      maxX = Math.max(maxX, item.at[0]);
      minY = Math.min(minY, item.at[1]);
      maxY = Math.max(maxY, item.at[1] + item.height);
    }
  }
  const write: DxfWrite = {
    g: (code, value) => {
      o.g(code, value);
      return write;
    },
    int: (code, value) => {
      o.int(code, value);
      return write;
    },
  };
  extras?.entities?.({
    entity,
    ...write,
    extent: (x, y) => {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    },
  });
  o.g(0, 'ENDSEC');

  // ---- objects
  o.g(0, 'SECTION').g(2, 'OBJECTS');
  o.g(0, 'DICTIONARY').g(5, H.rootDict).g(330, '0').g(100, 'AcDbDictionary').int(281, 1).g(3, 'ACAD_GROUP').g(350, H.groupDict);
  o.g(0, 'DICTIONARY').g(5, H.groupDict).g(330, H.rootDict).g(100, 'AcDbDictionary').int(281, 1);
  o.g(0, 'ENDSEC');
  o.g(0, 'EOF');

  // the header knows the extent and the next free handle, which are only known now
  const text = o.lines;
  const set = (key: string, edit: (at: number) => void) => {
    const at = text.indexOf(key);
    if (at >= 0) edit(at);
  };
  set('$HANDSEED', (at) => (text[at + 2] = next.toString(16).toUpperCase()));
  set('$EXTMIN', (at) => {
    text[at + 2] = num(minX);
    text[at + 4] = num(minY);
  });
  set('$EXTMAX', (at) => {
    text[at + 2] = num(maxX);
    text[at + 4] = num(maxY);
  });
  return text.join('\r\n') + '\r\n';
}
