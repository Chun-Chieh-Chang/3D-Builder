/**
 * D-2 (docs/drawing-callouts-plan.md): the dimensions of a drawing are DIMENSION entities in its DXF. Each carries the definition points a CAD program measures from
 * (checked here: what they measure is the model's number, at the sheet's scale), the model's text written over what it would measure, and the anonymous block with
 * the lines and text the drawing draws it with. Worked by hand: the plate's 120 and 80, the Ø9 and R10, and the angles 45° and 135°; and a scale of 1:2.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { rightOf, viewVectors, type Dimension, type ElementFacts } from '@3db/model';
import {
  checkDxf,
  dimensionMeasure,
  drawnEntities,
  dxfOrder,
  evaluateDimension,
  readDxf,
  toDxf,
  toPdf,
  toSvg,
  type DxfDimension,
  type DxfPolyline,
  type DxfText,
  type PlacedView,
  type Scene,
  type SceneDimension,
} from '@3db/drawing';
import { plateScene } from '../support/outputScene';

let plate: Awaited<ReturnType<typeof plateScene>>;
beforeAll(async () => {
  plate = await plateScene();
});

const dimensionsOf = (text: string) => readDxf(text).entities.filter((e): e is DxfDimension => e.type === 'DIMENSION');

describe('the dimensions of the plate\'s drawing', () => {
  it('are DIMENSION entities, one for each, each with its block, and the file is as right as before', () => {
    const text = toDxf(plate.scene);
    const doc = readDxf(text);
    expect(checkDxf(doc)).toEqual([]);
    const dims = dimensionsOf(text);
    expect(plate.scene.dimensions!.length).toBe(plate.doc.dimensions.length);
    expect(dims).toHaveLength(plate.doc.dimensions.length);
    expect(doc.tables.get('DIMSTYLE')!.entries.map((e) => e.name)).toEqual(['STANDARD']);
    dims.forEach((e, i) => {
      expect(e.layer).toBe('DIMENSION');
      expect(e.block).toBe(`*D${i + 1}`);
      expect(doc.blocks).toContain(e.block);
      expect(doc.tables.get('BLOCK_RECORD')!.entries.some((r) => r.name === e.block)).toBe(true);
      expect(doc.blockEntities.get(e.block)!.length).toBeGreaterThan(1); // lines, arrows and the text
    });
  });

  it('say what the model says: the text of each is the dimension\'s own (4×Ø9, ±, H11, R10), written over what a CAD would measure', () => {
    const dims = dimensionsOf(toDxf(plate.scene));
    expect(dims.map((e) => e.text)).toEqual(plate.scene.dimensions!.map((d) => d.text));
    expect(dims.some((e) => /^4×Ø9/.test(e.text))).toBe(true);
    expect(dims.some((e) => e.text.includes('H11'))).toBe(true);
    expect(dims.some((e) => /R10$/.test(e.text))).toBe(true);
    // the same text is in the block (what a viewer shows)
    const doc = readDxf(toDxf(plate.scene));
    for (const e of dims) {
      const texts = (doc.blockEntities.get(e.block) ?? []).filter((x): x is DxfText => x.type === 'TEXT').map((x) => x.text);
      expect(texts, e.block).toContain(e.text);
    }
  });

  it('measure what the model says, at the scale of the sheet (1:1): 120, 80, the distances of the holes, Ø9 and R10 from the definition points', () => {
    const doc = readDxf(toDxf(plate.scene));
    const dims = dimensionsOf(toDxf(plate.scene));
    const values = [...plate.values.values()];
    expect(dims).toHaveLength(values.length);
    dims.forEach((e, i) => {
      const measured = dimensionMeasure(e)!;
      const d = plate.doc.dimensions[i]!;
      // a count is not part of what a CAD measures; the value of a diameter is the whole diameter, a radius the radius
      expect(measured, `${d.id} ${e.text}`).toBeCloseTo(values[i]!, 4); // a DXF is written to a millionth of a millimetre
    });
    const kinds = dims.map((e) => e.kind);
    expect(kinds).toContain(0); // horizontal or vertical
    expect(kinds).toContain(3); // diameter
    expect(kinds).toContain(4); // radius
    // the overall size: 120 wide and 80 high
    expect(dims.filter((e) => e.kind === 0).map((e) => Math.round(dimensionMeasure(e)! * 1e6) / 1e6)).toEqual(expect.arrayContaining([120, 80]));
    expect(doc.entities.some((e) => e.type === 'DIMENSION')).toBe(true);
  });

  it('leave nothing of a dimension loose in model space: the lines and text of the others are there as before, the dimensions\' are in their blocks', () => {
    const doc = readDxf(toDxf(plate.scene));
    const grouped = plate.scene.items.filter((i) => i.group !== undefined);
    const loose = plate.scene.items.filter((i) => i.group === undefined && !(i.kind === 'polyline' && i.points.length < 4));
    expect(grouped.length).toBeGreaterThan(20);
    const modelLines = doc.entities.filter((e): e is DxfPolyline => e.type === 'LWPOLYLINE');
    expect(modelLines).toHaveLength(loose.filter((i) => i.kind === 'polyline' && !i.filled).length);
    expect(drawnEntities(doc).length).toBe(doc.entities.filter((e) => e.type !== 'DIMENSION').length + [...doc.blockEntities.entries()].filter(([n]) => n.startsWith('*D')).reduce((n, [, es]) => n + es.length, 0));
    expect(dxfOrder(plate.scene)).toHaveLength(plate.scene.items.length);
  });

  it('are drawn by the SVG and the PDF as before: the same items, the group is only a mark', () => {
    expect(toSvg(plate.scene).length).toBeGreaterThan(1000);
    const pdf = toPdf(plate.scene);
    expect(pdf.warnings.filter((w) => !/font|字型/i.test(w))).toEqual([]);
    expect(plate.scene.items.every((i) => i.group === undefined || plate.scene.dimensions!.some((d) => d.id === i.group))).toBe(true);
  });
});

describe('each kind, by hand', () => {
  const axes = viewVectors('right');
  const right = rightOf(axes);
  const at3 = (x: number, y: number): [number, number, number] => [right[0] * x + axes.up[0] * y, right[1] * x + axes.up[1] * y, right[2] * x + axes.up[2] * y];
  const plane = (p: [number, number], d: [number, number], middle: [number, number]): ElementFacts => ({ kind: 'face', type: 'plane', point: at3(...p), dir: at3(-d[1], d[0]), center: at3(...middle) });
  const S = Math.SQRT1_2;
  const view = (scale: number): PlacedView => ({ id: 'view1', at: [100, 100], scale, w: 100, h: 100, centre: [0, 0] });

  /** The scene of one dimension, as `buildScene` makes it. */
  function sceneOf(d: Dimension, scale: number, ...elements: ElementFacts[]): { scene: Scene; text: string; value: number } {
    const o = evaluateDimension(d, { elements }, axes, view(scale));
    if ('error' in o) throw new Error(o.error);
    const dimension: SceneDimension = { id: d.id, text: o.text, textAt: o.dxf!.textAt, geometry: o.dxf!.geometry };
    return { scene: { width: 420, height: 297, items: o.items.map((i) => ({ ...i, group: d.id })), dimensions: [dimension] }, text: o.text, value: o.value };
  }
  const only = (scene: Scene) => {
    const text = toDxf(scene);
    expect(checkDxf(readDxf(text))).toEqual([]);
    const dims = dimensionsOf(text);
    expect(dims).toHaveLength(1);
    return dims[0]!;
  };
  const ref = (name: string) => ({ kind: 'face' as const, name });

  it('a horizontal dimension between two planes 30 apart, drawn at 1:2: the definition points are 15 apart on the sheet, and the text says 30', () => {
    const d = { id: 'd1', view: 'view1', kind: 'linear', orientation: 'horizontal', a: ref('a'), b: ref('b'), offset: 10 } as Dimension;
    const x0 = plane([0, 0], [0, 1], [0, 5]);
    const x1 = plane([30, 0], [0, 1], [30, 5]);
    const { scene, text, value } = sceneOf(d, 0.5, x0, x1);
    expect(value).toBeCloseTo(30, 9);
    expect(text).toBe('30');
    const e = only(scene);
    expect(e.kind).toBe(0);
    expect(e.rotation).toBe(0);
    expect(dimensionMeasure(e)).toBeCloseTo(15, 5);
    expect(e.text).toBe('30');
  });

  it('a vertical dimension of 40 at 1:1 is rotated 90° and measures 40', () => {
    const d = { id: 'd1', view: 'view1', kind: 'linear', orientation: 'vertical', a: ref('a'), b: ref('b'), offset: 10 } as Dimension;
    const { scene } = sceneOf(d, 1, plane([0, 0], [1, 0], [5, 0]), plane([0, 40], [1, 0], [5, 40]));
    const e = only(scene);
    expect([e.kind, e.rotation]).toEqual([0, 90]);
    expect(dimensionMeasure(e)).toBeCloseTo(40, 5);
  });

  it('an aligned dimension between two points measures their distance: 5 along a 3-4-5 slope', () => {
    const d = { id: 'd1', view: 'view1', kind: 'linear', orientation: 'aligned', a: ref('a'), b: ref('b'), offset: 10 } as Dimension;
    const p: ElementFacts = { kind: 'vertex', type: 'point', point: at3(0, 0) };
    const q: ElementFacts = { kind: 'vertex', type: 'point', point: at3(3, 4) };
    const e = only(sceneOf(d, 1, p, q).scene);
    expect(e.kind).toBe(1);
    expect(dimensionMeasure(e)).toBeCloseTo(5, 5);
  });

  it('a diameter and a radius: Ø12 and R6 of the same circle, at 1:2 they measure 6 and 3 on the sheet; the text keeps the count and the tolerance', () => {
    const circle: ElementFacts = { kind: 'face', type: 'cylinder', point: at3(10, 20), dir: axes.dir as unknown as [number, number, number], radius: 6 };
    const dia = { id: 'd1', view: 'view1', kind: 'diameter', ref: ref('c'), angle: 45, count: 4 } as Dimension;
    const a = sceneOf(dia, 0.5, circle);
    const e = only(a.scene);
    expect(e.kind).toBe(3);
    expect(e.text).toBe('4×Ø12');
    expect(dimensionMeasure(e)).toBeCloseTo(6, 4);
    expect(e.leader).toBeGreaterThan(0);
    const rad = { id: 'd2', view: 'view1', kind: 'radius', ref: ref('c'), angle: 45 } as Dimension;
    const r = only(sceneOf(rad, 0.5, circle).scene);
    expect(r.kind).toBe(4);
    expect(r.text).toBe('R6');
    expect(dimensionMeasure(r)).toBeCloseTo(3, 4);
  });

  it('an angle: 45° between a wall and a slope, 135° with the other angle, 90° between a wall and a floor; the lines run through the corner and the arc point', () => {
    const vertical = plane([0, 0], [0, 1], [0, 5]);
    const floor = plane([0, 0], [1, 0], [5, 0]);
    const slope = plane([0, 0], [S, S], [3, 3]);
    const angle = (id: string, extra: Record<string, unknown> = {}) => ({ id, view: 'view1', kind: 'angle', a: ref('a'), b: ref('b'), arc: 20, ...extra }) as Dimension;
    for (const [d, elements, want] of [
      [angle('d1'), [vertical, slope], 45],
      [angle('d1', { supplementary: true }), [vertical, slope], 135],
      [angle('d1'), [vertical, floor], 90],
    ] as const) {
      const e = only(sceneOf(d, 1, ...elements).scene);
      expect(e.kind).toBe(2);
      expect(e.text).toBe(`${want}°`);
      expect(dimensionMeasure(e)!, e.text).toBeCloseTo(want, 6);
      expect(e.points.get(16)).toBeDefined();
    }
  });

  it('a file whose DIMENSION lacks its block, its style or its points is found wrong', () => {
    const text = toDxf(sceneOf({ id: 'd1', view: 'view1', kind: 'linear', orientation: 'horizontal', a: ref('a'), b: ref('b'), offset: 10 } as Dimension, 1, plane([0, 0], [0, 1], [0, 5]), plane([30, 0], [0, 1], [30, 5])).scene);
    expect(checkDxf(readDxf(text.replace('\r\n2\r\n*D1\r\n10\r\n', '\r\n2\r\n*D9\r\n10\r\n')))).toEqual([expect.stringContaining('*D9')]);
    expect(checkDxf(readDxf(text.replace('\r\n71\r\n5\r\n3\r\nSTANDARD\r\n', '\r\n71\r\n5\r\n3\r\nOTHER\r\n')))).toEqual([expect.stringContaining('OTHER')]);
    expect(checkDxf(readDxf(text.slice(0, text.indexOf('AcDbAlignedDimension')) + text.slice(text.indexOf('AcDbAlignedDimension')).replace('\r\n14\r\n', '\r\n17\r\n'))).some((p) => p.includes('定義點'))).toBe(true);
  });
});
