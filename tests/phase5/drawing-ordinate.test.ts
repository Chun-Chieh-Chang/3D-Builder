/**
 * D-I4 (ADR 0139): ordinate dimensions — the places of several elements from one origin along x or y, each on its own extension line, the origin written 0. On
 * the golden locating plate the holes' places along x and y, with the far side (so the overall size too); in a crowd of random elements, every value is the
 * distance from the origin and no two texts come closer than a text and a half, in the order of their elements.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyDrawingCommand, CommandError, createEmptyDrawing, parseDrawing, serializeDrawing, viewVectors, type Dimension, type ElementFacts, type PartDoc, type ViewFeature } from '@3db/model';
import { readPartFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { elementFacts, Regenerator, viewFeatures } from '@3db/regen';
import { autoDimensions, DIM_TEXT, evaluateDimension, outlinesOf, planOrdinate, type PlacedView, type Pickable, type SceneItem } from '@3db/drawing';

let kernel: Kernel;
let regen: Regenerator;
let doc: PartDoc;
beforeAll(async () => {
  kernel = await Kernel.load();
  regen = new Regenerator(kernel, await PlaneGcsSolver.create());
  doc = (await readPartFile(new Uint8Array(readFileSync(new URL('../golden/locating-plate.3dbx', import.meta.url))))).doc;
});
afterAll(() => regen.dispose());

const top = viewVectors('top');
const placed: PlacedView = { id: 'view1', at: [200, 150], scale: 1, w: 120, h: 80, centre: [0, 0] };
const texts = (items: SceneItem[]) => items.filter((i): i is Extract<SceneItem, { kind: 'text' }> => i.kind === 'text');

describe('ordinate dimensions on the golden locating plate', () => {
  it('the holes from the left and the bottom planes, with the far planes: one along x, one along y; the last of x is the length 120', () => {
    const body = regen.rebuild(doc).body!;
    const features = viewFeatures(body.topology, body.names, top);
    const drafts = autoDimensions(features, { overall: true, holes: false, positions: true, ordinate: true });
    const ords = drafts.filter((d) => d.kind === 'ordinate');
    expect(ords.map((d) => d.kind === 'ordinate' && d.axis)).toEqual(['x', 'y']);
    // no linear dimension for a place or for the overall size: the ordinates write them
    expect(drafts.filter((d) => d.kind === 'linear')).toEqual([]);
    const holes = features.filter((f): f is Extract<ViewFeature, { type: 'circle' }> => f.type === 'circle' && f.full);
    for (const [k, draft] of ords.entries()) {
      const d = { ...draft, id: `dim${k}`, view: 'view1' } as Extract<Dimension, { kind: 'ordinate' }>;
      const facts = [d.origin, ...d.refs].map((r) => elementFacts(body.topology, body.names, r)) as ElementFacts[];
      const out = evaluateDimension(d, { elements: facts }, top, placed);
      expect('error' in out, JSON.stringify(out)).toBe(false);
      const written = texts((out as { items: SceneItem[] }).items).map((x) => x.text);
      // by hand: the distinct places of the holes from the near side (−60 along x, −40 along y), then the far side
      const axis = d.axis === 'x' ? 0 : 1;
      const near = axis === 0 ? -60 : -40;
      const places = [...new Set(holes.map((h) => Math.round((h.centre[axis] - near) * 1e6) / 1e6))].filter((v) => v > 1e-6).sort((a, b) => a - b);
      expect(written).toEqual(['0', ...places.map(String), axis === 0 ? '120' : '80']);
    }
  });
});

describe('ordinate dimensions in a crowd', () => {
  it('100 random crowds of up to 12 points: each value the distance from the origin, the texts a text and a half apart, in order', () => {
    let seed = 3;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const right = [1, 0, 0];
    void right;
    for (let k = 0; k < 100; k++) {
      const n = 2 + Math.floor(rnd() * 11);
      // points of the front view (x right, y up), crowded into 30 mm so that many are closer than a text
      const xs = Array.from({ length: n }, () => Math.round(rnd() * 3000) / 100 - 15);
      const facts: ElementFacts[] = xs.map((x) => ({ kind: 'vertex', type: 'point', point: [x, rnd() * 20 - 10, 0] }));
      const refs = xs.map((_, i) => ({ kind: 'vertex' as const, name: `v${i}` }));
      const d = { id: 'd', view: 'v', kind: 'ordinate', axis: 'x', origin: refs[0]!, refs: refs.slice(1), offset: -10 } as Dimension;
      const out = evaluateDimension(d, { elements: facts }, viewVectors('front'), { id: 'v', at: [200, 150], scale: 1, w: 40, h: 30, centre: [0, 0] });
      expect('error' in out).toBe(false);
      const ts = texts((out as { items: SceneItem[] }).items);
      expect(ts.length).toBe(n);
      // the values, in the order of the elements
      expect(ts.slice(1).map((x) => Number(x.text))).toEqual(xs.slice(1).map((x) => Number(Math.abs(x - xs[0]!).toFixed(3))));
      // the texts along the row, sorted as their elements are, and apart
      const order = xs.map((_, i) => i).sort((a, b) => xs[a]! - xs[b]! || a - b);
      const along = order.map((i) => ts[i]!.at[0]);
      for (let j = 1; j < along.length; j++) expect(along[j]! - along[j - 1]!, `crowd ${k}`).toBeGreaterThanOrEqual(DIM_TEXT * 1.5 - 1e-9);
    }
  });
});

describe('making one', () => {
  const plane = (axis: 'x' | 'y', coord: number): Pickable => ({ type: 'plane', ref: { kind: 'face', name: `p${axis}${coord}` }, axis, coord, area: 10 });
  const circle = (x: number, y: number): Pickable => ({ type: 'circle', ref: { kind: 'face', name: `c${x},${y}` }, centre: [x, y], radius: 3, convex: false, full: true, outward: 0 });
  it('below or above the view: along x; beside it: along y; a plane the wrong way and an outline are refused', () => {
    const below = planOrdinate([plane('x', -60), circle(-50, 0), circle(50, 0)], [200, 90], placed);
    expect('draft' in below && below.draft.kind === 'ordinate' && below.draft.axis).toBe('x');
    expect('draft' in below && below.draft.kind === 'ordinate' && below.draft.offset < 0).toBe(true);
    const beside = planOrdinate([plane('y', -40), circle(0, -30), circle(0, 30)], [280, 150], placed);
    expect('draft' in beside && beside.draft.kind === 'ordinate' && beside.draft.axis).toBe('y');
    expect('error' in planOrdinate([plane('y', -40), circle(-50, 0)], [200, 90], placed)).toBe(true);
    expect(planOrdinate([plane('x', -60)], [200, 90], placed)).toEqual({ need: 'more' });
    const outline = outlinesOf([{ type: 'axis', ref: { kind: 'face', name: 'cyl' }, from: [0, -10], to: [0, 10], radius: 5 }])[0]!;
    expect('error' in planOrdinate([plane('x', -60), outline], [200, 90], placed)).toBe(true);
  });

  it('the commands refuse none measured, the same element twice, the origin measured from itself, a fit class; the file keeps it', () => {
    let d0 = createEmptyDrawing();
    d0 = applyDrawingCommand(d0, { type: 'insertViews', views: [{ id: 'view1', name: 'Top', source: 'p.3dbx', direction: 'top' }] });
    const r = (name: string) => ({ kind: 'face' as const, name });
    const ord = (patch: object) => ({ id: 'dim1', view: 'view1', kind: 'ordinate', axis: 'x', origin: r('o'), refs: [r('a'), r('b')], offset: -10, ...patch }) as Dimension;
    const ok = applyDrawingCommand(d0, { type: 'insertDimensions', dimensions: [ord({})] });
    expect(parseDrawing(serializeDrawing(ok)).dimensions).toEqual(ok.dimensions);
    for (const bad of [{ refs: [] }, { refs: [r('a'), r('a')] }, { refs: [r('o')] }, { tolerance: { type: 'fit', fit: 'H7' } }, { axis: 'z' }, { offset: 0 }])
      expect(() => applyDrawingCommand(d0, { type: 'insertDimensions', dimensions: [ord(bad)] }), JSON.stringify(bad)).toThrow(CommandError);
  });
});
