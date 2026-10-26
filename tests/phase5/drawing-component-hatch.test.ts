import { beforeAll, afterAll, expect, it } from 'vitest';
import { Kernel, type ShapeId } from '@3db/kernel';
import { projectDrawingView, type DrawingProjection } from '@3db/regen';
import { applyDrawingCommand, createEmptyDrawing, hatchStyleOf, type DrawingView, type SectionCut } from '@3db/model';
import { readDxf, toDxf, toSvg, toPdf, resolveLines, viewItems, type DxfPolyline, type PlacedView, type ViewLines } from '@3db/drawing';
let k: Kernel;
let outer: ShapeId;
let inner: ShapeId;
const axes = { dir: [0, 0, -1] as [number, number, number], up: [0, 1, 0] as [number, number, number] };
const frame = { origin: [0, 0, 0] as [number, number, number], xDir: [1, 0, 0] as [number, number, number], yDir: [0, 1, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number] };
const ring = (x: number, y: number) => { const pts: [number, number][] = [[-x, -y], [x, -y], [x, y], [-x, y]]; return pts.map((a, i) => ({ kind: 'line' as const, a, b: pts[(i + 1) % 4]!, source: `e${i}` })); };
const parts = () => [outer, inner].map((shape, i) => ({ shape, component: ['sleeve', 'shaft'][i]!, pose: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number] }, mirrored: false }));
const cut: SectionCut = { origin: [0, 0, 6], normal: [0, 0, 1] };
const parent: DrawingView = { id: 'p', name: 'assembly', source: 'assembly.3dba', direction: 'top' };
const section: DrawingView = { id: 's', kind: 'section', name: 'section', parent: 'p', label: 'A', line: [[-20, 0], [20, 0]] };
const placed = (id: string, scale = 1): PlacedView => ({ id, at: [0, 0], centre: [0, 0], w: 24 * scale, h: 20 * scale, scale });
const strokes = (lines: ViewLines, angle = 45, spacing = 3, scale = 1) => viewItems(section, { ...lines, visible: [], hidden: [], tangent: [], tangentHidden: [] }, placed('s', scale), { angle, spacing });
beforeAll(async () => {
  k = await Kernel.load();
  outer = k.extrude(frame, [{ outer: ring(12, 10), holes: [ring(5, 4).reverse().map(e => ({ ...e, a: e.b, b: e.a }))] }], [0, 0, 12]).shape;
  inner = k.extrude(frame, [{ outer: ring(5, 4), holes: [ring(2, 1).reverse().map(e => ({ ...e, a: e.b, b: e.a }))] }], [0, 0, 12]).shape;
  expect(k.isValid(outer)).toBe(true); expect(k.isValid(inner)).toBe(true);
  expect(k.massProps(outer).volume).toBeCloseTo(4800, 6); expect(k.massProps(inner).volume).toBeCloseTo(864, 6);
});
afterAll(() => { k.release(outer); k.release(inner); });
const probe = (lines: number[][], material: (x: number, y: number) => boolean) => {
  expect(lines.length).toBeGreaterThan(0);
  for (const l of lines) for (let j = 0; j <= 10; j++) { const t = j / 10; expect(material(l[0]! + (l[2]! - l[0]!) * t, l[1]! + (l[3]! - l[1]!) * t), JSON.stringify(l)).toBe(true); }
};
it('100 native-backed styles keep touching components and the central void separate at two scales', () => {
  const baseline = (k as any).oc.wasmMemory.buffer.byteLength;
  expect(baseline).toBeGreaterThan(0);
  const live = k.liveShapes;
  const v = projectDrawingView(k, parts(), axes, cut);
  expect(v.cutRegions?.map(r => r.component)).toEqual(['sleeve', 'shaft']);
  expect(k.liveShapes).toBe(live);
  for (let i = 0; i < 100; i++) {
    const angle = i * 71 % 360 - 180;
    const spacing = 0.5 + (i * 13 % 16) / 10;
    for (const scale of [0.5, 2]) {
      const lines = strokes(v, angle, spacing, scale).map(l => l.points.map(x => x / scale));
      const u = [Math.cos(angle * Math.PI / 180), Math.sin(angle * Math.PI / 180)];
      const sleeve = lines.filter(l => Math.abs((l[2]! - l[0]!) * u[1]! - (l[3]! - l[1]!) * u[0]!) < 1e-7);
      const shaft = lines.filter(l => !sleeve.includes(l));
      const inBox = (x: number, y: number, a: number, b: number) => Math.abs(x) <= a + 1e-6 && Math.abs(y) <= b + 1e-6;
      probe(sleeve, (x, y) => inBox(x, y, 12, 10) && !(Math.abs(x) < 5 - 1e-6 && Math.abs(y) < 4 - 1e-6));
      probe(shaft, (x, y) => inBox(x, y, 5, 4) && !(Math.abs(x) < 2 - 1e-6 && Math.abs(y) < 1 - 1e-6));
      for (const l of shaft) expect((l[2]! - l[0]!) * u[0]! + (l[3]! - l[1]!) * u[1]!).toBeCloseTo(0, 7);
    }
  }
  console.log('assembly hatch native heap bytes', baseline, (k as any).oc.wasmMemory.buffer.byteLength);
});

it('straight, stepped, aligned and local sections retain ownership and stable pattern orders', () => {
  const cuts: SectionCut[] = [cut, { ...cut, path: [[-20, 0, 6], [0, 0, 6], [0, 0, 7], [20, 0, 7]] }, { ...cut, path: [[-20, 0, 6], [0, 0, 6], [20, 0, 8]], aligned: true }, { origin: [0, 0, 12], normal: [0, 0, 1], local: { outline: [[-20, -15, 12], [20, -15, 12], [20, 15, 12], [-20, 15, 12], [-20, -15, 12]], depth: 6 } }];
  for (const c of cuts) {
    const before = k.liveShapes;
    const v = projectDrawingView(k, parts(), axes, c);
    expect(v.cutRegions?.map(r => [r.component, r.order])).toEqual([['sleeve', 0], ['shaft', 1]]);
    expect(v.cutRegions!.every(r => r.cut.length > 0)).toBe(true);
    expect(strokes(v).length).toBeGreaterThan(0);
    expect(k.liveShapes).toBe(before);
  }
});

it('nested detail/crop keep component boundaries, style and holes from the section', () => {
  const v = projectDrawingView(k, parts(), axes, { origin: [0, 0, 12], normal: [0, 0, 1], local: { outline: [[-20, -15, 12], [20, -15, 12], [20, 15, 12], [-20, 15, 12], [-20, -15, 12]], depth: 6 } });
  const local: DrawingView = { id: 'l', kind: 'sectionLocal', name: 'local', parent: 'p', label: 'L', depth: 6, outline: { kind: 'rectangle', p0: [-15, -15], p1: [15, 15] } };
  const detail: DrawingView = { id: 'd', kind: 'detail', name: 'detail', parent: 'c', centre: [0, 0], radius: 9, label: 'B', scale: [5, 1] };
  const crop: DrawingView = { id: 'c', kind: 'crop', name: 'crop', parent: 'l', outline: { kind: 'rectangle', p0: [-8, -8], p1: [8, 8] } };
  const doc = applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views: [parent, local, crop, detail] });
  const resolved = resolveLines(doc, new Map<string, DrawingProjection>([['l', v]]));
  for (const id of ['d', 'c']) {
    expect(resolved.get(id)!.cutRegions).toEqual(v.cutRegions);
    expect(hatchStyleOf(id === 'd' ? detail : crop, [parent, local, crop, detail])).toEqual({ angle: 45, spacing: 3 });
    const lines = strokes(resolved.get(id)!).map(l => l.points);
    probe(lines, (x, y) => Math.abs(x) <= 8 + 1e-6 && Math.abs(y) <= 8 + 1e-6 && (id === 'c' || x * x + y * y <= 81 + 1e-6) && !(Math.abs(x) < 2 - 1e-6 && Math.abs(y) < 1 - 1e-6));
  }
});

it('uncut and single-part projections retain the existing path', () => {
  expect(projectDrawingView(k, parts(), axes).cutRegions).toBeUndefined();
  expect(projectDrawingView(k, parts().slice(0, 1), axes, cut).cutRegions).toBeUndefined();
});


it('all three exports retain the separated native component hatch segments', () => {
  const v = projectDrawingView(k, parts(), axes, cut);
  const items = strokes(v);
  const scene = { width: 420, height: 297, items };
  const exported = readDxf(toDxf(scene)).entities.filter(e => e.type === 'LWPOLYLINE');
  expect(exported).toHaveLength(items.length);
  exported.forEach((e, i) => { if (e.type === 'LWPOLYLINE') (e as DxfPolyline).points.forEach((x, j) => expect(x).toBeCloseTo(items[i]!.points[j]!, 5)); });
  expect((toSvg(scene).match(/<polyline /g) ?? []).length).toBe(items.length);
  expect((new TextDecoder('latin1').decode(toPdf(scene).bytes).match(/ m /g) ?? []).length).toBe(items.length);
});


it('empty cuts do not renumber later components; the third pattern has its own paper spacing', () => {
  const third = { ...parts()[1]!, component: 'third', pose: { position: [30, 0, 30] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number] } };
  const low = projectDrawingView(k, [...parts(), third], axes, cut);
  expect(low.cutRegions?.map(r => r.order)).toEqual([0, 1, 2]);
  expect(low.cutRegions![2]!.cut).toHaveLength(0);
  const high = projectDrawingView(k, [...parts(), third], axes, { origin: [0, 0, 36], normal: [0, 0, 1] });
  expect(high.cutRegions![0]!.cut).toHaveLength(0);
  expect(high.cutRegions![1]!.cut).toHaveLength(0);
  expect(high.cutRegions![2]!.order).toBe(2);
  const items = strokes(high);
  expect(items.length).toBeGreaterThan(0);
  for (const { points: p } of items) {
    expect((p[2]! - p[0]!) - (p[3]! - p[1]!)).toBeCloseTo(0, 7);
    const row = (-p[0]! + p[1]!) * Math.SQRT1_2 / 3.75;
    expect(row - Math.floor(row)).toBeCloseTo(0.5, 7);
  }
});
