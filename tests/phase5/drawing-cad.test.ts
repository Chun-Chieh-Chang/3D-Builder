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
