import { CALLOUT_SYMBOL_FALLBACKS } from './calloutSymbols';
import { moveCadEntity } from '@3db/model';
import { cadScene } from './cadScene';
import { ARROW, DIM_TEXT, GAP, OVERSHOOT, STACK_SCALE } from './dimension';
import { sceneLines, type LineStyle, type Scene, type SceneDimension, type SceneItem } from './scene';
import { textWidthMm } from './sheet';

/**
 * The drawing as a DXF (F3.1): ASCII, release 2000 (AC1015), in millimetres, model space, written from the same scene as the SVG and the PDF. Each line style is
 * a layer (VISIBLE, HIDDEN, CENTER, THIN, FRAME, DIMENSION, with the linetype and lineweight of ISO 128), the text is on TEXT; a polyline is an LWPOLYLINE, a
 * filled polygon (an arrowhead) SOLIDs (a triangle fan), text is TEXT with every character outside ASCII written as `\U+XXXX` (any reader knows it). The
 * file has the handles, owners and tables a 2000 file has, and `readDxf` checks all of it.
 *
 * A dimension of the scene (`scene.dimensions`) is written as a DIMENSION entity (D-2, ADR 0102): the definition points a CAD program measures from, the text of the
 * model's number written over what it would measure, and the anonymous block `*D<n>` with the lines and text the drawing draws it with (the items of the same `group`),
 * which is what a viewer shows. The style it names, STANDARD, carries the sizes of the arrows, gaps and text (the drawing's dimension style, ADR 0146).
 *
 * A shaded view's image (`scene.images`) is not written: a DXF of a drawing is its lines, as SolidWorks's is.
 */

export type DxfVersion = 'AC1015' | 'AC1021';
export type DxfMode = 'standard' | 'compat';
export const DXF_VERSION: DxfVersion = 'AC1021';
export const DXF_VERSIONS: readonly DxfVersion[] = ['AC1015', 'AC1021'];
/** The lineweights a DXF may give an entity (group 370), in 1/100 mm. */
const LINEWEIGHTS = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];
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

/**
 * Text for a DXF string: in AC1015 (R2000 ASCII), characters outside ASCII (and the backslash) are written as `\U+XXXX`;
 * in AC1021 (R2007 UTF-8), printable Unicode characters are written directly in UTF-8 so readers such as FreeCAD display Chinese natively.
 */
export function dxfEscape(text: string, version: DxfVersion = DXF_VERSION): string {
  let out = '';
  // ASCII equivalents also cover old SHX fonts; both DIMENSION overrides and block TEXT use this path.
  for (const ch of text.replace(/[↧⌴⌵]/g, (ch) => CALLOUT_SYMBOL_FALLBACKS[ch]!)) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0x5c) out += '\\\\';
    else if (cp >= 0x20 && (version === 'AC1021' || cp < 0x7f)) out += ch;
    else if (cp > 0xffff) {
      const v = cp - 0x10000;
      out += `\\U+${(0xd800 + (v >> 10)).toString(16).toUpperCase().padStart(4, '0')}\\U+${(0xdc00 + (v & 0x3ff)).toString(16).toUpperCase().padStart(4, '0')}`;
    } else out += `\\U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
  }
  return out;
}

/**
 * The text a DIMENSION is written with over what it would measure: stacked deviations in MTEXT's tolerance stack 「\S+0^-0.01;」 (upper over lower, no bar between),
 * so a CAD program that draws the dimension again draws them stacked too.
 */
export function dimensionOverride(d: Pick<SceneDimension, 'text' | 'parts'>, version: DxfVersion = DXF_VERSION): string {
  const lines = (text: string) => text.split(/\r\n?|\n/).map((line) => dxfEscape(line, version)).join('\\P');
  if (!d.parts) return lines(d.text);
  // `^` and `;` end the halves of a stack; a deviation is a signed number with a degree sign, which has neither
  return d.parts.map((p) => (typeof p === 'string' ? lines(p) : `\\S${dxfEscape(p.upper, version)}^${dxfEscape(p.lower, version)};`)).join('');
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
  /** DXF format version: AC1021 (R2007 UTF-8, default) or AC1015 (R2000 ASCII). */
  version?: DxfVersion;
  /**
   * Output mode:
   * - `standard` (default): native DIMENSION entities with `*D<n>` anonymous blocks and SOLID arrowheads (for AutoCAD / SolidWorks).
   * - `compat`: explodes dimensions into Model Space polylines/texts and writes filled arrowheads as closed LWPOLYLINEs (for FreeCAD and lightweight viewers).
   */
  mode?: DxfMode;
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

/**
 * The items of a scene in the order a DXF draws them: those of no dimension first, then the items of each dimension (in the block of its DIMENSION), a dimension after
 * the other. Without dimensions in the scene it is the scene's own order.
 */
export function dxfOrder(scene: Scene): SceneItem[] {
  const { loose, blocks } = splitByDimension(scene);
  return [...loose, ...blocks.flat()];
}

/** The items that belong to no dimension, and for each dimension of the scene (in order) the items drawn for it. */
function splitByDimension(scene: Scene): { loose: SceneItem[]; blocks: SceneItem[][] } {
  const index = new Map((scene.dimensions ?? []).map((d, i) => [d.id, i] as const));
  const blocks: SceneItem[][] = (scene.dimensions ?? []).map(() => []);
  const loose: SceneItem[] = [];
  for (const item of scene.items) {
    const at = item.group === undefined ? undefined : index.get(item.group);
    if (at === undefined) loose.push(item);
    else blocks[at]!.push(item);
  }
  return { loose, blocks };
}

/** The scene as a DXF (AC1021 UTF-8 by default; optional AC1015 ASCII and FreeCAD-compatible exploded mode). */
export function toDxf(scene: Scene, extras?: DxfExtras): string {
  if (scene.cadSource) {
    const imported = cadScene(scene.cadSource, true);
    scene = { ...imported, items: [...imported.items, ...scene.items.filter((i) => i.owner === undefined)] };
  }
  if (scene.cadOrigin) {
    const [dx, dy] = scene.cadOrigin;
    scene = { ...scene, cadOrigin: undefined,
      items: scene.items.map((i) => i.kind === 'text' ? { ...i, at: [i.at[0] + dx, i.at[1] + dy] } : { ...i, points: i.points.map((v, k) => v + (k % 2 ? dy : dx)) }),
      dimensions: scene.dimensions?.map((d) => {
        const moved = moveCadEntity({ ...d, kind: 'dimension', layer: d.layer ?? 'DIMENSION', items: [] }, dx, dy);
        return moved.kind === 'dimension' ? { ...d, geometry: moved.geometry, textAt: moved.textAt } : d;
      }),
    };
  }
  const version: DxfVersion = extras?.version ?? DXF_VERSION;
  const compat = extras?.mode === 'compat';
  let next = 0x30;
  const handle = () => (next++).toString(16).toUpperCase();
  const o = new Out();

  // the fixed objects: their handles are chosen first so that tables can point at each other
  const H = {
    vportTable: '8', ltypeTable: '5', layerTable: '2', styleTable: '3', viewTable: '6', ucsTable: '7', appidTable: '9', dimstyleTable: 'A', blockRecordTable: '1',
    modelRecord: 'B', paperRecord: 'C', rootDict: 'D', groupDict: 'E', byBlock: '10', byLayer: '11', standardStyle: '12',
  };

  // standard mode: each dimension gets an anonymous block; compat mode: explode all dimension items directly into model space
  const dims = compat ? [] : (scene.dimensions ?? []);
  const dimensionInk = new Map<string, string>();
  for (const item of scene.items) if (item.group && item.color && !dimensionInk.has(item.group)) dimensionInk.set(item.group, item.color);
  const { loose, blocks: blockItems } = compat ? { loose: scene.items, blocks: [] as SceneItem[][] } : splitByDimension(scene);
  const blockRecords = dims.map(() => handle());

  // the sheet's own line styles (ADR 0260); a linetype of theirs that the standard list does not have (CNS 3's centre line) is written after it, from its dashes
  const styles = sceneLines(scene);
  const linetypes = [...DXF_LINETYPES];
  for (const [i, layer] of (scene.cadLayers ?? []).entries()) {
    if (layer.dash?.length) linetypes.push({ name: `CAD_${i}`, description: layer.name, pattern: layer.dash.map((v, n) => n % 2 ? -v : v) });
  }
  for (const st of Object.values(styles))
    if (st.dash && !linetypes.some((lt) => lt.name === st.linetype)) linetypes.push({ name: st.linetype, description: st.linetype, pattern: st.dash.map((d, i) => (i % 2 === 0 ? d : -d)) });
  const layers: { name: string; linetype: string; weight: number; color?: string; hidden?: boolean }[] = [
    { name: '0', linetype: 'CONTINUOUS', weight: 25 },
    ...(extras?.layers ?? (Object.keys(styles) as LineStyle[]).map((k) => ({ name: styles[k].layer, linetype: styles[k].linetype, weight: Math.round(styles[k].width * 100) }))),
    { name: TEXT_LAYER, linetype: 'CONTINUOUS', weight: 25 },
  ];
  for (const [i, l] of (scene.cadLayers ?? []).entries()) {
    const at = layers.findIndex((existing) => existing.name === l.name);
    const layer = { name: l.name, linetype: l.dash?.length ? `CAD_${i}` : 'CONTINUOUS', weight: Math.round(l.width * 100), color: l.color, hidden: l.hidden };
    if (at >= 0) layers[at] = layer; else layers.push(layer);
  }

  // the extent of what is drawn
  let minX = 0;
  let minY = 0;
  let maxX = scene.width;
  let maxY = scene.height;

  // ---- header
  o.g(0, 'SECTION').g(2, 'HEADER');
  o.g(9, '$ACADVER').g(1, version);
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
  o.g(9, '$DIMSTYLE').g(2, 'STANDARD');
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
  table('LTYPE', H.ltypeTable, 2 + linetypes.length, () => {
    const record = (h: string, name: string, description: string, pattern: number[]) => {
      o.g(0, 'LTYPE').g(5, h).g(330, H.ltypeTable).g(100, 'AcDbSymbolTableRecord').g(100, 'AcDbLinetypeTableRecord').g(2, name).int(70, 0).g(3, description).int(72, 65).int(73, pattern.length);
      o.g(40, pattern.reduce((a, b) => a + Math.abs(b), 0));
      for (const p of pattern) o.g(49, p).int(74, 0);
    };
    record(H.byBlock, 'ByBlock', '', []);
    record(H.byLayer, 'ByLayer', '', []);
    for (const lt of linetypes) record(handle(), lt.name, lt.description, lt.pattern);
  });
  table('LAYER', H.layerTable, layers.length, () => {
    for (const l of layers) {
      o.g(0, 'LAYER').g(5, handle()).g(330, H.layerTable).g(100, 'AcDbSymbolTableRecord').g(100, 'AcDbLayerTableRecord').g(2, l.name).int(70, 0).int(62, l.hidden ? -7 : 7).g(6, l.linetype).int(370, l.weight);
      // Black stays color 7 (black on paper, white on a dark CAD screen) rather than a fixed RGB black that disappears on dark backgrounds.
      if (l.color && l.color.toUpperCase() !== '#000000' && version !== 'AC1015') o.int(420, parseInt(l.color.slice(1), 16));
    }
  });
  table('STYLE', H.styleTable, 1, () => {
    o.g(0, 'STYLE').g(5, H.standardStyle).g(330, H.styleTable).g(100, 'AcDbSymbolTableRecord').g(100, 'AcDbTextStyleTableRecord').g(2, 'STANDARD').int(70, 0).g(40, 0).g(41, 1).g(50, 0).int(71, 0).g(42, 2.5).g(3, 'arial.ttf').g(4, '');
  });
  table('VIEW', H.viewTable, 0, () => undefined);
  table('UCS', H.ucsTable, 0, () => undefined);
  table('APPID', H.appidTable, 1, () => {
    o.g(0, 'APPID').g(5, handle()).g(330, H.appidTable).g(100, 'AcDbSymbolTableRecord').g(100, 'AcDbRegAppTableRecord').g(2, 'ACAD').int(70, 0);
  });
  // the style the dimensions name: the sizes the drawing draws them with (arrows, extension lines, text above the line, read horizontally or along the line);
  // DIMTFAC (146) the stacked deviations' part of the text height, so a CAD program that draws a dimension again draws them as the drawing does (default 1)
  o.g(0, 'TABLE').g(2, 'DIMSTYLE').g(5, H.dimstyleTable).g(330, '0').g(100, 'AcDbSymbolTable').int(70, 1).g(100, 'AcDbDimStyleTable').int(71, 1);
  o.g(0, 'DIMSTYLE').g(105, handle()).g(330, H.dimstyleTable).g(100, 'AcDbSymbolTableRecord').g(100, 'AcDbDimStyleTableRecord').g(2, 'STANDARD').int(70, 0);
  o.g(40, 1).g(41, scene.dimStyle?.arrow ?? ARROW).g(42, GAP).g(43, 3.75).g(44, OVERSHOOT).g(140, scene.dimStyle?.text ?? DIM_TEXT).g(141, 2.5).g(146, STACK_SCALE).g(147, 1).int(73, 0).int(74, 0).int(77, 1).int(78, 8).int(171, 3).int(172, 1).int(271, 2).int(272, 2).int(275, 0).g(340, H.standardStyle);
  o.g(0, 'ENDTAB');
  table('BLOCK_RECORD', H.blockRecordTable, 2 + dims.length, () => {
    o.g(0, 'BLOCK_RECORD').g(5, H.modelRecord).g(330, H.blockRecordTable).g(100, 'AcDbSymbolTableRecord').g(100, 'AcDbBlockTableRecord').g(2, '*Model_Space');
    o.g(0, 'BLOCK_RECORD').g(5, H.paperRecord).g(330, H.blockRecordTable).g(100, 'AcDbSymbolTableRecord').g(100, 'AcDbBlockTableRecord').g(2, '*Paper_Space');
    dims.forEach((_, i) => o.g(0, 'BLOCK_RECORD').g(5, blockRecords[i]!).g(330, H.blockRecordTable).g(100, 'AcDbSymbolTableRecord').g(100, 'AcDbBlockTableRecord').g(2, `*D${i + 1}`));
  });
  o.g(0, 'ENDSEC');

  // ---- what is drawn: an entity of an owner (model space, or the block of a dimension), written from the scene's items
  let owner = H.modelRecord;
  const entity = (type: string, layer: string, sub: string, width?: number, color?: string) => {
    o.g(0, type).g(5, handle()).g(330, owner).g(100, 'AcDbEntity').g(8, layer);
    if (color && /^#[0-9a-f]{6}$/i.test(color)) {
      // R2007+ stores the exact RGB; the indexed color remains a usable fallback for older readers.
      const rgb = parseInt(color.slice(1), 16);
      const r = (rgb >> 16) & 255, g = (rgb >> 8) & 255, b = rgb & 255;
      const aci = r === g && g === b ? (r < 128 ? 7 : 8) : r >= g && r >= b ? (g > r / 2 ? 2 : b > r / 2 ? 6 : 1) : g >= b ? (b > g / 2 ? 4 : 3) : 5;
      o.int(62, aci);
      if (version !== 'AC1015' && rgb !== 0) o.int(420, rgb); // black is written as color 7 alone: it follows the CAD background
    }
    // a line of its own width (a dimension's style, ADR 0146): DXF knows only its standard lineweights (1/100 mm), so the nearest of them
    if (width !== undefined) o.int(370, LINEWEIGHTS.reduce((best, w) => (Math.abs(w - width * 100) < Math.abs(best - width * 100) ? w : best)));
    return o.g(100, sub);
  };
  const writeItem = (item: SceneItem): void => {
    if (item.kind === 'polyline') {
      const n = item.points.length / 2;
      if (n < 2) return;
      for (let i = 0; i < item.points.length; i += 2) {
        minX = Math.min(minX, item.points[i]!);
        maxX = Math.max(maxX, item.points[i]!);
        minY = Math.min(minY, item.points[i + 1]!);
        maxY = Math.max(maxY, item.points[i + 1]!);
      }
      if (item.filled && !compat) {
        // a filled polygon: a fan of triangles from its first corner (a SOLID of three corners repeats the third)
        for (let k = 1; k + 1 < n; k++) {
          entity('SOLID', item.layer ?? styles[item.style].layer, 'AcDbTrace', item.width, item.byLayer ? undefined : item.color);
          const p = [0, k, k + 1].map((j) => [item.points[2 * j]!, item.points[2 * j + 1]!] as const);
          o.g(10, p[0]![0]).g(20, p[0]![1]).g(30, 0).g(11, p[1]![0]).g(21, p[1]![1]).g(31, 0).g(12, p[2]![0]).g(22, p[2]![1]).g(32, 0).g(13, p[2]![0]).g(23, p[2]![1]).g(33, 0);
        }
        return;
      }
      entity('LWPOLYLINE', item.layer ?? styles[item.style].layer, 'AcDbPolyline', item.width, item.byLayer ? undefined : item.color);
      o.int(90, n).int(70, item.closed || item.filled ? 1 : 0);
      for (let i = 0; i < item.points.length; i += 2) o.g(10, item.points[i]!).g(20, item.points[i + 1]!);
    } else if (item.text !== '') {
      entity('TEXT', item.layer ?? TEXT_LAYER, 'AcDbText', undefined, item.byLayer ? undefined : item.color);
      const anchor = item.anchor === 'center' ? 1 : item.anchor === 'right' ? 2 : 0;
      // 10 is where the text starts, 11 the point it is aligned at: a reader that only takes 10 (eDrawings) writes it from there, so a centred or right-aligned
      // text starts its own width (Helvetica's, as laid out; the style's font is Arial, of the same widths) before the point, along its angle
      const back = anchor === 0 ? 0 : textWidthMm(item.text, item.height) * (anchor === 1 ? 0.5 : 1);
      const turn = ((item.angle ?? 0) * Math.PI) / 180;
      o.g(10, item.at[0] - back * Math.cos(turn)).g(20, item.at[1] - back * Math.sin(turn)).g(30, 0).g(40, item.height).g(1, dxfEscape(item.text, version));
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
  };

  /** A DIMENSION entity for a dimension of the scene: the definition points to measure from, the model's text over what would be measured, and the block it is drawn with. */
  const writeDimension = (d: SceneDimension, block: string): void => {
    const gm = d.geometry;
    // 0 rotated (horizontal or vertical), 1 aligned, 2 angular between two lines, 3 diameter, 4 radius; 32 says the block is this dimension's own, 128 that the text is where it is given
    const kind = gm.kind === 'linear' ? (gm.rotation === undefined ? 1 : 0) : gm.kind === 'diameter' ? 3 : gm.kind === 'radius' ? 4 : 2;
    const def = gm.kind === 'linear' ? gm.line : gm.kind === 'diameter' ? gm.far : gm.kind === 'radius' ? gm.centre : gm.second[1];
    const ink = d.byLayer ? undefined : d.color ?? dimensionInk.get(d.id);
    entity('DIMENSION', d.layer ?? styles.dimension.layer, 'AcDbDimension', undefined, ink);
    o.g(2, block).g(10, def[0]).g(20, def[1]).g(30, 0).g(11, d.textAt[0]).g(21, d.textAt[1]).g(31, 0).int(70, kind + 32 + 128).int(71, 5).g(3, 'STANDARD').g(1, dimensionOverride(d, version));
    const point = (code: number, p: readonly [number, number]) => o.g(code, p[0]).g(code + 10, p[1]).g(code + 20, 0);
    if (gm.kind === 'linear') {
      o.g(100, 'AcDbAlignedDimension');
      point(13, gm.a);
      point(14, gm.b);
      if (gm.rotation !== undefined) {
        o.g(100, 'AcDbRotatedDimension');
        o.g(50, gm.rotation);
      }
    } else if (gm.kind === 'diameter') {
      o.g(100, 'AcDbDiametricDimension');
      point(15, gm.near);
      o.g(40, gm.leader);
    } else if (gm.kind === 'radius') {
      o.g(100, 'AcDbRadialDimension');
      point(15, gm.near);
      o.g(40, gm.leader);
    } else {
      o.g(100, 'AcDb2LineAngularDimension');
      point(13, gm.first[0]);
      point(14, gm.first[1]);
      point(15, gm.second[0]);
      point(16, gm.arc);
    }
    minX = Math.min(minX, d.textAt[0]);
    maxX = Math.max(maxX, d.textAt[0]);
    minY = Math.min(minY, d.textAt[1]);
    maxY = Math.max(maxY, d.textAt[1]);
  };

  // ---- blocks
  o.g(0, 'SECTION').g(2, 'BLOCKS');
  for (const [name, own] of [['*Model_Space', H.modelRecord], ['*Paper_Space', H.paperRecord]] as const) {
    o.g(0, 'BLOCK').g(5, handle()).g(330, own).g(100, 'AcDbEntity').g(8, '0').g(100, 'AcDbBlockBegin').g(2, name).int(70, 0).g(10, 0).g(20, 0).g(30, 0).g(3, name).g(1, '');
    o.g(0, 'ENDBLK').g(5, handle()).g(330, own).g(100, 'AcDbEntity').g(8, '0').g(100, 'AcDbBlockEnd');
  }
  // the block of each dimension (anonymous: flag 1): what it is drawn with
  dims.forEach((_, i) => {
    const name = `*D${i + 1}`;
    o.g(0, 'BLOCK').g(5, handle()).g(330, blockRecords[i]!).g(100, 'AcDbEntity').g(8, '0').g(100, 'AcDbBlockBegin').g(2, name).int(70, 1).g(10, 0).g(20, 0).g(30, 0).g(3, name).g(1, '');
    owner = blockRecords[i]!;
    for (const item of blockItems[i]!) writeItem(item);
    owner = H.modelRecord;
    o.g(0, 'ENDBLK').g(5, handle()).g(330, blockRecords[i]!).g(100, 'AcDbEntity').g(8, '0').g(100, 'AcDbBlockEnd');
  });
  o.g(0, 'ENDSEC');

  // ---- entities
  o.g(0, 'SECTION').g(2, 'ENTITIES');
  for (const item of loose) writeItem(item);
  dims.forEach((d, i) => writeDimension(d, `*D${i + 1}`));
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
