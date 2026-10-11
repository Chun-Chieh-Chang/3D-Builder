/**
 * 5-4b (docs/phase5-plan.md): the surface finish (C16.5, ISO 1302). The document and what its commands refuse, and the symbol: the V of 60° whose legs are equal
 * and whose height is 1.4 times the text height, the bar the values are written over, the bar that closes the V (machined) or the circle in it (unmachined), the
 * Ra over the bar and the note under it. Every number worked out by hand, not against the drawing itself.
 */
import { describe, expect, it } from 'vitest';
import { applyDrawingCommand, createEmptyDrawing, parseDrawing, serializeDrawing, type DrawingDoc, type SurfaceFinish } from '@3db/model';
import { FINISH_HEIGHT, buildScene, raText, surfaceFinishBox, surfaceFinishItems, toSheet, type PlacedView, type SceneItem, type ScenePolyline, type ViewLines } from '@3db/drawing';

const view = { id: 'view1', name: '前視', source: 'a.3dbx', direction: 'front' as const };
const withViews = (): DrawingDoc => applyDrawingCommand(createEmptyDrawing(), { type: 'insertViews', views: [view] });
const finish = (id: string, extra: Partial<SurfaceFinish> = {}): SurfaceFinish => ({ id, view: 'view1', at: [10, 20], ...extra });

/** A view placed at (200, 150) on the sheet at 1:1, the middle of its box at (0, 0) of its own coordinates. */
const placed: PlacedView = { id: 'view1', at: [200, 150], scale: 1, w: 120, h: 80, centre: [0, 0] };
/** The point of the symbol of the finish at the view's (10, 20), on the sheet. */
const apex = toSheet(placed, 10, 20);

const polys = (items: readonly SceneItem[]): ScenePolyline[] => items.filter((i): i is ScenePolyline => i.kind === 'polyline');
const texts = (items: readonly SceneItem[]) => items.filter((i): i is Extract<SceneItem, { kind: 'text' }> => i.kind === 'text');
const at = (l: ScenePolyline, k: number): [number, number] => [l.points[2 * k]!, l.points[2 * k + 1]!];
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);

describe('the surface finish in the document', () => {
  it('is inserted with its own id, and refuses what ISO 1302 does not allow', () => {
    const d = applyDrawingCommand(withViews(), { type: 'insertSurfaceFinishes', finishes: [finish('fin1', { ra: 1.6 })] });
    expect(d.surfaceFinishes).toHaveLength(1);
    expect(d.idCounters).toMatchObject({ fin: 1 });
    const insert = (f: SurfaceFinish) => applyDrawingCommand(withViews(), { type: 'insertSurfaceFinishes', finishes: [f] });
    expect(() => insert(finish('fin1', { ra: 1.6, view: 'zzz' }))).toThrow(/找不到尺寸所在的視圖/);
    expect(() => insert(finish('fin1', { ra: 0 }))).toThrow(/Ra/);
    expect(() => insert(finish('fin1', { ra: 401 }))).toThrow(/Ra/);
    expect(() => insert(finish('fin1', { ra: 1.6, kind: 'polished' as never }))).toThrow(/加工方式/);
    expect(() => insert(finish('fin1', { ra: 1.6, angle: NaN }))).toThrow(/方向/);
    expect(() => insert(finish('fin1', { ra: 1.6, leader: -1 }))).toThrow(/引線/);
    expect(() => insert(finish('fin1', { ra: 1.6, method: 'x'.repeat(41) }))).toThrow(/40 字/);
    expect(() => insert(finish('fin1', { ra: 1.6, at: [0, NaN] }))).toThrow(/位置/);
    expect(insert(finish('fin1', { ra: 0.8, kind: 'unmachined', method: '鑄造', note: '不加工' })).surfaceFinishes).toHaveLength(1);
    expect(() => applyDrawingCommand(d, { type: 'insertSurfaceFinishes', finishes: [finish('fin1')] })).toThrow(/已被使用/);
  });

  it('changes one: the Ra, the method, the note, the kind, the direction and the leader, and takes them away again', () => {
    let d = applyDrawingCommand(withViews(), { type: 'insertSurfaceFinishes', finishes: [finish('fin1')] });
    d = applyDrawingCommand(d, { type: 'setSurfaceFinish', finishId: 'fin1', patch: { ra: 3.2, method: '銑削', note: 'Ra 3.2 以下', kind: 'basic', angle: 0, leader: 4, at: [1, 2] } });
    expect(d.surfaceFinishes[0]).toMatchObject({ ra: 3.2, method: '銑削', note: 'Ra 3.2 以下', kind: 'basic', angle: 0, leader: 4, at: [1, 2] });
    d = applyDrawingCommand(d, { type: 'setSurfaceFinish', finishId: 'fin1', patch: { ra: null, method: null, note: null, kind: null, angle: null, leader: null } });
    expect(d.surfaceFinishes[0]).toEqual({ id: 'fin1', view: 'view1', at: [1, 2] });
    expect(() => applyDrawingCommand(d, { type: 'setSurfaceFinish', finishId: 'zzz', patch: { ra: 1.6 } })).toThrow(/找不到表面粗糙度/);
    expect(() => applyDrawingCommand(d, { type: 'setSurfaceFinish', finishId: 'fin1', patch: { ra: 999 } })).toThrow(/Ra/);
  });

  it('deletes them, and goes with a view that is deleted', () => {
    let d = applyDrawingCommand(withViews(), { type: 'insertSurfaceFinishes', finishes: [finish('fin1'), finish('fin2')] });
    d = applyDrawingCommand(d, { type: 'deleteSurfaceFinishes', finishIds: ['fin2'] });
    expect(d.surfaceFinishes.map((f) => f.id)).toEqual(['fin1']);
    expect(() => applyDrawingCommand(d, { type: 'deleteSurfaceFinishes', finishIds: ['zzz'] })).toThrow(/找不到表面粗糙度/);
    // a view takes what is drawn on it with it
    d = applyDrawingCommand(d, { type: 'deleteViews', viewIds: ['view1'] });
    expect(d.surfaceFinishes).toEqual([]);
  });

  it('is saved and read back as the same document', () => {
    const d = applyDrawingCommand(withViews(), { type: 'insertSurfaceFinishes', finishes: [finish('fin1', { ra: 1.6, method: '研磨', kind: 'machined' })] });
    expect(parseDrawing(serializeDrawing(d))).toEqual(d);
  });
});

describe('the symbol of a surface finish (ISO 1302)', () => {
  it('is a V of two equal legs at 60°, 1.4 times the text height, with its point at the view\'s point', () => {
    expect(FINISH_HEIGHT).toBeCloseTo(1.4 * 3.5, 9);
    const legs = polys(surfaceFinishItems([finish('f1')], placed)).filter((l) => dist(at(l, 0), apex) < 1e-9);
    expect(legs).toHaveLength(2);
    const [a, b] = legs as [ScenePolyline, ScenePolyline];
    const la = dist(at(a, 0), at(a, 1));
    const lb = dist(at(b, 0), at(b, 1));
    expect(la).toBeCloseTo(lb, 9); // equal legs
    const u = [(at(a, 1)[0] - apex[0]) / la, (at(a, 1)[1] - apex[1]) / la];
    const v = [(at(b, 1)[0] - apex[0]) / lb, (at(b, 1)[1] - apex[1]) / lb];
    expect((Math.acos(u[0]! * v[0]! + u[1]! * v[1]!) * 180) / Math.PI).toBeCloseTo(60, 6);
    // drawn up the sheet when nothing is said: the tops are FINISH_HEIGHT over the point
    for (const l of legs) expect(at(l, 1)[1] - apex[1]).toBeCloseTo(FINISH_HEIGHT, 9);
  });

  it('has a bar from the top of the right leg, and closes the V (machined) or holds a circle (unmachined)', () => {
    const basic = polys(surfaceFinishItems([finish('f1', { kind: 'basic' })], placed));
    const machined = polys(surfaceFinishItems([finish('f1', { kind: 'machined' })], placed));
    const unmachined = polys(surfaceFinishItems([finish('f1', { kind: 'unmachined' })], placed));
    // the default is machined: the material is removed
    expect(polys(surfaceFinishItems([finish('f1')], placed))).toHaveLength(machined.length);
    expect(basic).toHaveLength(3);
    expect(machined).toHaveLength(4); // the two legs, the bar, and the bar that closes the V
    expect(unmachined).toHaveLength(4); // the two legs, the bar, and the circle
    expect(unmachined.filter((l) => l.closed)).toHaveLength(1);
    expect(machined.filter((l) => l.closed)).toHaveLength(0);

    const legs = basic.filter((l) => dist(at(l, 0), apex) < 1e-9);
    const rightTop = legs.map((l) => at(l, 1)).sort((p, q) => q[0]! - p[0]!)[0]!;
    const bar = basic.find((l) => dist(at(l, 0), rightTop) < 1e-9)!;
    expect(bar).toBeDefined();
    expect(at(bar, 1)[1]).toBeCloseTo(rightTop[1]!, 9); // the bar is horizontal
    expect(at(bar, 1)[0] - rightTop[0]!).toBeGreaterThan(0); // and runs away from the V
    // the bar that closes the V runs from the left top to the right one, at the same height
    const closing = machined.find((l) => Math.abs(at(l, 0)[1] - rightTop[1]!) < 1e-9 && Math.abs(at(l, 1)[1] - rightTop[1]!) < 1e-9 && Math.abs(at(l, 1)[0] - at(l, 0)[0]) > 1)!;
    expect(closing).toBeDefined();
  });

  it('writes the Ra over the bar and the method after it, and the note under the bar', () => {
    expect(raText(1.6)).toBe('Ra 1.6');
    expect(raText(12.5)).toBe('Ra 12.5');
    expect(raText(0.8)).toBe('Ra 0.8');
    expect(texts(surfaceFinishItems([finish('f1', { ra: 1.6 })], placed)).map((i) => i.text)).toEqual(['Ra 1.6']);
    expect(texts(surfaceFinishItems([finish('f1', { ra: 1.6, method: '銑削' })], placed)).map((i) => i.text)).toEqual(['Ra 1.6  銑削']);
    expect(texts(surfaceFinishItems([finish('f1', { method: '銑削' })], placed)).map((i) => i.text)).toEqual(['銑削']);
    const both = texts(surfaceFinishItems([finish('f1', { ra: 1.6, note: 'Ra 1.6 以下' })], placed));
    expect(both.map((i) => i.text)).toEqual(['Ra 1.6', 'Ra 1.6 以下']);
    expect(both[0]!.height).toBeCloseTo(3.5, 9);
    // the Ra is over the bar, the note under it
    const basic = polys(surfaceFinishItems([finish('f1', { kind: 'basic' })], placed));
    const barTop = basic.filter((l) => dist(at(l, 0), apex) < 1e-9).map((l) => at(l, 1)).sort((p, q) => q[0]! - p[0]!)[0]!;
    const bar = basic.find((l) => dist(at(l, 0), barTop) < 1e-9)!;
    const barY = at(bar, 1)[1]!;
    expect(both[0]!.at[1]).toBeGreaterThan(barY);
    expect(both[1]!.at[1]).toBeLessThan(barY);
  });

  it('leans away from the surface along its angle, and stands off it by its leader', () => {
    // 0 degrees: the symbol lies on its side, its V opening to the right of the point
    const flat = polys(surfaceFinishItems([finish('f1', { angle: 0, kind: 'basic' })], placed));
    const tops = flat.filter((l) => dist(at(l, 0), apex) < 1e-9).map((l) => at(l, 1));
    expect(tops).toHaveLength(2);
    for (const t of tops) expect(t[0]! - apex[0]).toBeGreaterThan(0);
    // a leader: a line from the surface to the point of the symbol, which moves up by it
    const led = polys(surfaceFinishItems([finish('f1', { leader: 5, kind: 'basic' })], placed));
    expect(led).toHaveLength(4); // the leader and the three of the symbol
    const leader = led.find((l) => dist(at(l, 0), apex) < 1e-9)!;
    expect(leader).toBeDefined();
    expect(at(leader, 1)[1]).toBeCloseTo(apex[1] + 5, 9);
    expect(polys(surfaceFinishItems([finish('f1', { leader: 5, kind: 'basic' })], placed)).filter((l) => dist(at(l, 0), at(leader, 1)) < 1e-9)).toHaveLength(2);
  });

  it('is a fixed size on the sheet whatever the view is drawn at, standing where the view puts it', () => {
    const half: PlacedView = { ...placed, scale: 0.5 };
    const one = polys(surfaceFinishItems([finish('f1', { kind: 'basic' })], placed));
    const two = polys(surfaceFinishItems([finish('f1', { kind: 'basic' })], half));
    const size = (ls: ScenePolyline[]) => dist(at(ls[0]!, 0), at(ls[0]!, 1));
    expect(size(two)).toBeCloseTo(size(one), 9);
    // the point follows the view: at half scale it is half as far from the middle of the view
    const atHalf = toSheet(half, 10, 20);
    expect(atHalf[0] - half.at[0]).toBeCloseTo((apex[0] - placed.at[0]) / 2, 9);
    expect(surfaceFinishBox(finish('f1', { ra: 1.6, note: 'x' })).h).toBeGreaterThan(FINISH_HEIGHT);
  });

  it('is drawn on the sheet with the view it is on', () => {
    const doc = applyDrawingCommand(withViews(), { type: 'insertSurfaceFinishes', finishes: [finish('fin1', { ra: 1.6 })] });
    const lines: ViewLines = { visible: [[0, 0, 40, 0, 40, 30, 0, 30, 0, 0]], hidden: [], box: { min: [0, 0], max: [40, 30] } };
    const built = buildScene(doc, new Map([['view1', lines]]));
    const where = built.placed.get('view1')!;
    const wanted = toSheet(where, 10, 20);
    const symbol = built.scene.items.filter((i) => i.kind === 'polyline' && dist([i.points[0]!, i.points[1]!], wanted) < 1e-9);
    expect(symbol).toHaveLength(2); // the two legs start at the point of the symbol
    expect(built.scene.items.some((i) => i.kind === 'text' && i.text === 'Ra 1.6')).toBe(true);
    // and nothing is drawn when the view has no lines yet
    expect(buildScene(doc, new Map()).scene.items.some((i) => i.kind === 'text' && i.text === 'Ra 1.6')).toBe(false);
  });
});
