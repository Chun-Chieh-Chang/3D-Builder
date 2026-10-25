import { beforeAll, expect, it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { applyDrawingCommand, canHatch, createEmptyDrawing, DrawingHistory, DRAWING_SCHEMA_VERSION, hatchStyleOf, page, parseDrawing, serializeDrawing, type DrawingDoc, type DrawingView } from '@3db/model';
import { hatch, readDxf, resolveLines, toDxf, toPdf, toSvg, viewItems, type PlacedView, type DxfPolyline, type Scene, type ViewLines } from '@3db/drawing';

let native: ViewLines;
let localNative: ViewLines;
beforeAll(async () => {
  const k = await Kernel.load();
  const ring = (points: [number, number][]) => points.map((a, i) => ({ kind: 'line' as const, a, b: points[(i + 1) % points.length]!, source: `e${i}` }));
  const s = k.extrude({ origin: [0, 0, 0], normal: [0, 0, 1], xDir: [1, 0, 0], yDir: [0, 1, 0] }, [{ outer: ring([[0, 0], [40, 0], [40, 30], [0, 30]]), holes: [ring([[12, 8], [12, 22], [28, 22], [28, 8]])] }], [0, 0, 12]).shape;
  try {
    expect(k.isValid(s)).toBe(true);
    expect(k.massProps(s).volume).toBeCloseTo((40 * 30 - 16 * 14) * 12, 6);
    native = k.sectionView(s, { origin: [0, 0, 6], normal: [0, 0, 1] }, [0, 1, 0]);
    localNative = k.sectionViewLocal(s, [[0, 0, 12], [40, 0, 12], [40, 30, 12], [0, 30, 12], [0, 0, 12]], 6, { origin: [0, 0, 12], normal: [0, 0, 1] }, [0, 1, 0]);
    expect(native.cut!.length).toBeGreaterThan(0);
  } finally { k.release(s); }
});
const parent: DrawingView = { id: 'p', name: 'parent', source: 'ring.3dbx', direction: 'front' };
const section: DrawingView = { id: 's', name: 'section', kind: 'section', parent: 'p', line: [[0, 0], [40, 0]], label: 'A' };
const doc = (): DrawingDoc => applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views: [parent, section] });
const placed = (id = 's', scale = 1): PlacedView => ({ id, at: [0, 0], centre: [0, 0], w: 40 * scale, h: 30 * scale, scale });
const strokes = (v: DrawingView, lines: ViewLines, p = placed(v.id), views: DrawingView[] = [parent, section]) => viewItems(v, { ...lines, visible: [], hidden: [], tangent: [], tangentHidden: [] }, p, hatchStyleOf(v, views)).filter(i => i.style === 'thin' && i.points.length === 4);
const material = (x: number, y: number) => x >= -1e-6 && x <= 40 + 1e-6 && y >= -1e-6 && y <= 30 + 1e-6 && !(x > 12 + 1e-6 && x < 28 - 1e-6 && y > 8 + 1e-6 && y < 22 - 1e-6);
const probe = (lines: { points: number[] }[], predicate: (x: number, y: number) => boolean) => {
  expect(lines.length).toBeGreaterThan(0);
  for (const { points: p } of lines) for (let j = 0; j <= 10; j++) {
    const a = j / 10;
    expect(predicate(p[0]! + a * (p[2]! - p[0]!), p[1]! + a * (p[3]! - p[1]!)), JSON.stringify(p)).toBe(true);
  }
};

it('validates hatch ranges atomically and supports inheritance, reset, undo, redo and migration', () => {
  const h = new DrawingHistory(doc());
  const set = (spacing: number, angle: number) => h.execute({ type: 'setView', viewId: 's', patch: { hatch: { spacing, angle } } });
  const before = serializeDrawing(h.doc);
  for (const spacing of [0, -1, 0.499, 20.001, NaN, Infinity]) expect(() => set(spacing, 45)).toThrow();
  for (const angle of [-180.001, 180.001, NaN, Infinity]) expect(() => set(3, angle)).toThrow();
  expect(serializeDrawing(h.doc)).toBe(before);
  expect(() => h.execute({ type: 'setView', viewId: 'p', patch: { hatch: { spacing: 3, angle: 45 } } })).toThrow();
  set(0.5, -180); set(20, 180); set(1.25, 33.5);
  h.execute({ type: 'insertViews', views: [{ id: 'd', name: 'detail', kind: 'detail', parent: 's', centre: [10, 10], radius: 8, label: 'B' }] });
  let views = page(h.doc).views;
  expect(canHatch(views[2]!, views)).toBe(true);
  expect(hatchStyleOf(views[2]!, views)).toEqual({ spacing: 1.25, angle: 33.5 });
  h.execute({ type: 'setView', viewId: 'd', patch: { hatch: { spacing: 2, angle: -30 } } });
  expect(hatchStyleOf(page(h.doc).views[2]!, page(h.doc).views).angle).toBe(-30);
  h.execute({ type: 'setView', viewId: 'd', patch: { hatch: null } });
  expect(hatchStyleOf(page(h.doc).views[2]!, page(h.doc).views).angle).toBe(33.5);
  h.undo(); expect(page(h.doc).views[2]!.hatch!.angle).toBe(-30);
  h.redo(); expect(page(h.doc).views[2]!.hatch).toBeUndefined();
  expect(parseDrawing(serializeDrawing(h.doc))).toEqual(h.doc);
  const old = JSON.parse(serializeDrawing(doc())); old.schemaVersion = 28;
  const upgraded = parseDrawing(JSON.stringify(old));
  expect(upgraded.schemaVersion).toBe(DRAWING_SCHEMA_VERSION);
  expect(hatchStyleOf(page(upgraded).views[1]!)).toEqual({ spacing: 3, angle: 45 });
});

it('100 deterministic styles: native ring hatching stays in material with exact paper spacing and direction at two scales', () => {
  for (let i = 0; i < 100; i++) {
    const style = { spacing: 0.5 + (i * 37 % 196) / 10, angle: -180 + (i * 71 % 361) };
    const v = { ...section, hatch: style };
    const angle = style.angle * Math.PI / 180;
    for (const scale of [0.5, 2]) {
      const lines = strokes(v, native, placed('s', scale));
      probe(lines.map(l => ({ points: l.points.map(x => x / scale) })), material);
      for (const { points: p } of lines) {
        expect((p[2]! - p[0]!) * Math.sin(angle) - (p[3]! - p[1]!) * Math.cos(angle)).toBeCloseTo(0, 7);
        const row = (-p[0]! * Math.sin(angle) + p[1]! * Math.cos(angle)) / style.spacing;
        expect(row - Math.floor(row)).toBeCloseTo(0.5, 7);
      }
    }
  }
});

it('crops complete native ring hatches after generation, preserving holes through nested crop/detail', () => {
  const local: DrawingView = { id: 'l', name: 'local', kind: 'sectionLocal', parent: 'p', label: 'L', depth: 6, outline: { kind: 'rectangle', p0: [0, 0], p1: [40, 30] } };
  const crop: DrawingView = { id: 'c', name: 'crop', kind: 'crop', parent: 'l', outline: { kind: 'rectangle', p0: [5, 5], p1: [35, 25] } };
  const detail: DrawingView = { id: 'd', name: 'detail', kind: 'detail', parent: 'c', centre: [10, 15], radius: 7, label: 'B' };
  const detail2: DrawingView = { id: 'd2', name: 'detail2', kind: 'detail', parent: 'd', centre: [5, 15], radius: 5, label: 'C' };
  const d = applyDrawingCommand(doc(), { type: 'insertViews', views: [local, crop, detail, detail2] });
  const r = resolveLines(d, new Map([['l', localNative]]));
  const ls = strokes(crop, r.get('c')!);
  probe(ls, (x, y) => material(x, y) && x >= 5 - 1e-6 && x <= 35 + 1e-6 && y >= 5 - 1e-6 && y <= 25 + 1e-6);
  probe(strokes(detail, r.get('d')!), (x, y) => material(x, y) && Math.hypot(x - 10, y - 15) <= 7 + 1e-6 && x >= 5 - 1e-6);
  probe(strokes(detail2, r.get('d2')!), (x, y) => material(x, y) && Math.hypot(x - 10, y - 15) <= 7 + 1e-6 && x >= 5 - 1e-6 && Math.hypot(x - 5, y - 15) <= 5 + 1e-6);
});

it('broken sections clip hatch before compression rather than drawing across the gap', () => {
  const p: PlacedView = { ...placed(), break: { axis: 0, from: 17, to: 23, gap: 3 } };
  const out = strokes({ ...section, hatch: { spacing: 1, angle: 0 } }, native, p);
  // brokenAt keeps x<=17, moves x>=23 to x>=20; no hatch may bridge 17..20.
  for (const l of out) {
    const [x0, , x1] = l.points;
    expect(Math.max(x0!, x1!) <= 17 + 1e-6 || Math.min(x0!, x1!) >= 20 - 1e-6).toBe(true);
  }
  expect(out.length).toBeGreaterThan(0);
});

it('retains the first half-offset row in narrow regions and rejects nonfinite style inputs', () => {
  expect(hatch([[0, 0.6, 5, 0.6, 5, 2, 0, 2, 0, 0.6]], 3, 0)).toEqual([[0, 1.5, 5, 1.5]]);
  expect(hatch(native.cut!, Infinity)).toEqual([]);
  expect(hatch(native.cut!, 3, NaN)).toEqual([]);
});

it('SVG, DXF and PDF contain the same configured hatch segments', () => {
  const items = strokes({ ...section, hatch: { spacing: 2.5, angle: -30 } }, native);
  const scene: Scene = { width: 420, height: 297, items };
  const svg = toSvg(scene);
  const dxf = readDxf(toDxf(scene));
  const exported = dxf.entities.filter(e => e.type === 'LWPOLYLINE');
  expect(exported).toHaveLength(items.length);
  const pdf = new TextDecoder('latin1').decode(toPdf(scene).bytes);
  expect((svg.match(/<polyline /g) ?? []).length).toBe(items.length);
  expect((pdf.match(/ m /g) ?? []).length).toBe(items.length);
  exported.forEach((e, i) => { if (e.type === 'LWPOLYLINE') (e as DxfPolyline).points.forEach((x, j) => expect(x).toBeCloseTo(items[i]!.points[j]!, 5)); });
});
