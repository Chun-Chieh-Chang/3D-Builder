import { describe, expect, it } from 'vitest';
import { applyDrawingCommand, checkCadDrawing, DRAWING_SCHEMA_VERSION, DrawingHistory, moveCadEntity, parseDrawing, serializeDrawing, type CadEntity } from '@3db/model';
import { buildScene, importCadDxf, readDxf, toDxf, toSvg, type Scene } from '@3db/drawing';
import { dxfToDwg, dwgToDxf, verifyDwgRoundtrip } from '../../apps/mcp/src/dwg';

const scene = (): Scene => ({ width: 120, height: 80, items: [
  { kind: 'polyline', style: 'visible', points: [5, 5, 105, 5, 105, 65], color: '#12AB34', width: 0.5 },
  { kind: 'text', at: [10, 45], text: '中文圖名 Ø12 ±0.01', height: 3.5, color: '#DC2626' },
  { kind: 'polyline', style: 'dimension', group: 'dim1', points: [5, 5, 5, 20, 105, 20, 105, 5], color: '#2563EB' },
  { kind: 'text', group: 'dim1', at: [55, 22], text: '100', height: 3.5, color: '#2563EB' },
], dimensions: [{ id: 'dim1', text: '100', textAt: [55, 22], geometry: { kind: 'linear', a: [5, 5], b: [105, 5], line: [5, 20], rotation: 0 } }] });

describe('editable imported CAD drawings', () => {
  it('keeps text, native dimensions, RGB, layers and coordinates through save, reopen and re-export', () => {
    const source = toDxf(scene());
    const { doc } = importCadDxf(source, '圖面.dwg');
    expect(doc.schemaVersion).toBe(DRAWING_SCHEMA_VERSION);
    const cad = doc.pages[0]!.cad!;
    expect(cad.entities).toHaveLength(3);
    expect(cad.entities.find((e) => e.kind === 'dimension')?.color).toBe('#2563EB');
    const saved = parseDrawing(serializeDrawing(doc));
    const output = toDxf(buildScene(saved, new Map(), new Map()).scene);
    verifyDwgRoundtrip(source, output);
    expect(output).toContain('中文圖名');
    expect(toSvg(buildScene(saved, new Map(), new Map()).scene)).toContain('#12AB34');
  });

  it('edits actual geometry, text, colors and layers with undo and redo', () => {
    const { doc } = importCadDxf(toDxf(scene()), 'edit.dwg');
    const history = new DrawingHistory(doc);
    const e = doc.pages[0]!.cad!.entities.find((e) => e.kind === 'text')!;
    if (e.kind !== 'text') throw new Error('Missing imported text');
    const entity: CadEntity = { ...moveCadEntity(e, 12, -3), kind: 'text', at: [50, 60], text: '已編輯', color: '#ABCDEF', height: 5, layer: 'VISIBLE' };
    history.execute({ type: 'setCadEntity', entity });
    expect(history.doc.pages[0]!.cad!.entities.find((i) => i.id === e.id)).toEqual(entity);
    history.undo(); expect(history.doc).toEqual(doc);
    history.redo(); expect(history.doc.pages[0]!.cad!.entities.find((i) => i.id === e.id)).toEqual(entity);
    history.execute({ type: 'deleteCadEntities', ids: [e.id] });
    expect(history.doc.pages[0]!.cad!.entities.some((i) => i.id === e.id)).toBe(false);
    history.undo(); expect(history.doc.pages[0]!.cad!.entities.some((i) => i.id === e.id)).toBe(true);
  });

  it('keeps ByLayer colors, hidden content and custom layer names editable on re-export', () => {
    const { doc } = importCadDxf(toDxf(scene()), 'layers.dwg');
    const cad = doc.pages[0]!.cad!;
    const e = cad.entities[0]!;
    delete e.color;
    e.layer = '加工紅線';
    cad.layers.push({ name: '加工紅線', color: '#13579B', width: 0.35, dash: [3, 1], hidden: true });
    const built = buildScene(doc, new Map(), new Map()).scene;
    expect(built.items.some((i) => i.owner === e.id)).toBe(false);
    const out = readDxf(toDxf(built));
    expect(out.entities.some((i) => i.layer === '加工紅線')).toBe(true);
    const layer = out.tables.get('LAYER')!.entries.find((l) => l.name === '加工紅線')!;
    expect(layer.pairs).toContainEqual([420, String(0x13579B)]);
    expect(Number(layer.pairs.find(([c]) => c === 62)![1])).toBeLessThan(0);
  });

  it('expands the display around negative and far-out edits without changing user coordinates or CAD placement', () => {
    const { doc } = importCadDxf(toDxf(scene()), 'bounds.dwg');
    const e = doc.pages[0]!.cad!.entities.find((e) => e.kind === 'polyline')!;
    if (e.kind !== 'polyline') throw new Error('Missing polyline');
    const edited = applyDrawingCommand(doc, { type: 'setCadEntity', entity: { ...e, points: [-200, -100, 900, 700] } });
    const built = buildScene(edited, new Map(), new Map()).scene;
    expect(built.width).toBeGreaterThan(1100);
    expect(built.height).toBeGreaterThan(800);
    expect(edited.pages[0]!.cad!.entities.find((x) => x.id === e.id)).toMatchObject({ points: [-200, -100, 900, 700] });
    const raw = readDxf(toDxf(built)).entities.find((i) => i.type === 'LWPOLYLINE')!;
    const origin = edited.pages[0]!.cad!.sourceOrigin!;
    expect(raw).toMatchObject({ points: [-200 + origin[0], -100 + origin[1], 900 + origin[0], 700 + origin[1]] });
  });

  it('converts supported drawing units to millimetres, refuses unknown units, and states what it did', () => {
    const dxf = (unit: number | null) => ['0', 'SECTION', '2', 'HEADER', ...(unit === null ? [] : ['9', '$INSUNITS', '70', String(unit)]), '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES',
      '0', 'LINE', '8', '0', '10', '0', '20', '0', '11', '2', '21', '0', '0', 'TEXT', '8', '0', '10', '1', '20', '1', '40', '0.5', '1', 'Hi', '0', 'ENDSEC', '0', 'EOF'].join('\n');
    const measure = (unit: number | null) => {
      const { doc, warnings } = importCadDxf(dxf(unit), 'u.dxf');
      const entities = doc.pages[0]!.cad!.entities;
      const line = entities.find((e) => e.kind === 'polyline')!, text = entities.find((e) => e.kind === 'text')!;
      return { length: line.kind === 'polyline' ? Math.hypot(line.points[2]! - line.points[0]!, line.points[3]! - line.points[1]!) : NaN, height: text.kind === 'text' ? text.height : NaN, warnings };
    };
    expect(measure(4)).toMatchObject({ length: 2, height: 0.5 });
    expect(measure(null).warnings.join()).toContain('interpreted as millimetres');
    for (const [unit, factor] of [[1, 25.4], [2, 304.8], [5, 10], [6, 1000]] as const) {
      const m = measure(unit);
      expect(m.length).toBeCloseTo(2 * factor, 9);
      expect(m.height).toBeCloseTo(0.5 * factor, 9);
      expect(m.warnings.join()).toContain('converted to millimetres');
    }
    expect(() => importCadDxf(dxf(99), 'u.dxf')).toThrow(/not supported/);
  });

  it('converts native dimensions in a non-millimetre drawing together with their graphics', () => {
    const source = toDxf(scene());
    const inch = source.replace(/(\$INSUNITS\r?\n\s*70\r?\n)\s*4/, '$11');
    expect(inch).not.toBe(source);
    const dim = (text: string) => importCadDxf(text, 'd.dxf');
    const mmDim = dim(source).doc.pages[0]!.cad!.entities.find((e) => e.kind === 'dimension')!;
    const inDim = dim(inch);
    const converted = inDim.doc.pages[0]!.cad!.entities.find((e) => e.kind === 'dimension')!;
    if (mmDim.kind !== 'dimension' || converted.kind !== 'dimension' || mmDim.geometry.kind !== 'linear' || converted.geometry.kind !== 'linear') throw new Error('expected linear dimensions');
    const span = (g: typeof mmDim.geometry) => g.kind === 'linear' ? Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1]) : NaN;
    expect(span(converted.geometry)).toBeCloseTo(span(mmDim.geometry) * 25.4, 6);
    expect(inDim.warnings.join()).toContain('converted to millimetres');
    expect(inDim.warnings.join()).toContain('Dimension geometry was converted');
  });

  it('redraws a dimension in the standard style when its graphics block is missing', () => {
    const source = toDxf(scene());
    const at = source.search(/\r?\n0\r?\nDIMENSION\r?\n/); // the entity, not the layer that is also called DIMENSION
    expect(at).toBeGreaterThan(0);
    const tail = source.slice(at).replace(/(\r?\n2\r?\n)\*D1/, '$1*Dgone');
    expect(tail).not.toBe(source.slice(at));
    const { doc, warnings } = importCadDxf(source.slice(0, at) + tail, 'nogfx.dxf');
    const dim = doc.pages[0]!.cad!.entities.find((e) => e.kind === 'dimension')!;
    if (dim.kind !== 'dimension') throw new Error('expected a dimension');
    expect(warnings.join()).toContain('redrawn in the standard style');
    expect(dim.items.some((i) => i.kind === 'text' && i.text === '100')).toBe(true);
    const lines = dim.items.filter((i) => i.kind === 'polyline');
    expect(lines.length).toBeGreaterThanOrEqual(5);
    expect(() => checkCadDrawing(doc.pages[0]!.cad!)).not.toThrow();
  });

  it('puts the text of a dimension whose text position was left at (0, 0) on its dimension line', () => {
    const source = scene(); source.dimensions![0]!.textAt = [0, 0];
    const { doc } = importCadDxf(toDxf(source), 'unset.dxf');
    const dim = doc.pages[0]!.cad!.entities.find((e) => e.kind === 'dimension')!;
    if (dim.kind !== 'dimension' || dim.geometry.kind !== 'linear') throw new Error('expected a linear dimension');
    const mid = (dim.geometry.a[0] + dim.geometry.b[0]) / 2;
    expect(Math.abs(dim.textAt[0] - mid)).toBeLessThan(1e-6);
    expect(dim.textAt[1]).toBeGreaterThan(dim.geometry.line[1]);
  });

  it('accepts CAD-internal layer names and leaves out paper-space viewport frames', () => {
    const dxf = ['0', 'SECTION', '2', 'ENTITIES', '0', 'LINE', '8', '*LayerNameForDynamicConstraint', '10', '0', '20', '0', '11', '5', '21', '0',
      '0', 'VIEWPORT', '8', 'View Port', '67', '1', '0', 'ENDSEC', '0', 'EOF'].join('\n');
    const { doc, warnings } = importCadDxf(dxf, 'v.dxf');
    expect(doc.pages.flatMap((p) => p.cad!.entities.map((e) => e.layer))).toContain('*LayerNameForDynamicConstraint');
    expect(warnings.join()).toContain('viewport frames were not imported');
  });

  it('refuses unsupported entities, cycles and invalid numerical data rather than dropping them', () => {
    const source = toDxf(scene());
    expect(() => importCadDxf(source.replace('LWPOLYLINE', 'SPLINE'), 'unsupported.dwg')).toThrow(/unsupported/i);
    const corrupt = source.replace(/\r?\n10\r?\n5\r?\n/, '\n10\nNaN\n');
    expect(corrupt).not.toBe(source);
    expect(() => importCadDxf(corrupt, 'bad.dwg')).toThrow();
    const { doc } = importCadDxf(source, 'valid.dwg');
    const e = doc.pages[0]!.cad!.entities[0]!;
    for (const color of ['red', '#fff', '#00000000', '#gggggg']) expect(() => applyDrawingCommand(doc, { type: 'setCadEntity', entity: { ...e, color } })).toThrow();
    for (const width of [0, -1, NaN, Infinity, 1e10]) expect(() => applyDrawingCommand(doc, { type: 'setCadEntity', entity: { ...e, width } })).toThrow();
    const raw = JSON.parse(serializeDrawing(doc)); raw.pages[0].cad.entities[0].points = [1];
    expect(() => parseDrawing(JSON.stringify(raw))).toThrow();
    const duplicate = structuredClone(doc.pages[0]!.cad!); duplicate.entities.push(duplicate.entities[0]!);
    expect(() => checkCadDrawing(duplicate)).toThrow();
  });

  it('rejects read-back data loss, dimension rotation changes and color changes', () => {
    const source = toDxf(scene());
    const changed = scene(); changed.items[0]!.color = '#000000';
    expect(() => verifyDwgRoundtrip(source, toDxf(changed))).toThrow();
    const rotated = scene(); const g = rotated.dimensions![0]!.geometry; if (g.kind === 'linear') g.rotation = 90;
    expect(() => verifyDwgRoundtrip(source, toDxf(rotated))).toThrow();
    expect(() => verifyDwgRoundtrip(source, toDxf({ width: 1, height: 1, items: [] }))).toThrow();
  });

  it('refuses corrupt conversion input before starting the external engine', async () => {
    await expect(dxfToDwg('')).rejects.toThrow();
    await expect(dxfToDwg(toDxf(scene(), { version: 'AC1015' }))).rejects.toThrow(/AC1021/);
    await expect(dwgToDxf(new Uint8Array(512))).rejects.toThrow(/DWG/);
  });

  it('fuzzes 150 dimensions, positions and colors through real DXF parsing and persisted editable drawings', () => {
    let seed = 53187;
    const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 0x100000000);
    for (let i = 0; i < 150; i++) {
      const x = random() * 10000 - 5000, y = random() * 10000 - 5000;
      const s = scene();
      s.items = s.items.map((item) => item.kind === 'text' ? { ...item, at: [x, y], color: `#${Math.floor(random() * 0xffffff).toString(16).padStart(6, '0')}` } : item);
      const text = toDxf(s);
      const imported = importCadDxf(text, `fuzz-${i}.dwg`);
      const back = parseDrawing(serializeDrawing(imported.doc));
      checkCadDrawing(back.pages[0]!.cad);
      verifyDwgRoundtrip(text, toDxf(buildScene(back, new Map(), new Map()).scene));
    }
  });
});
