/**
 * Limits that are not 「±」 are written as two deviations stacked after the number (the user's reference drawing, 2026-10-27): 「1.2」 with 「+0」 over 「-0.01」,
 * 「25°」 with 「+4°」 over 「-0」. Each deviation signed, a zero too; both of the same decimals unless one is zero; smaller than the number, left-aligned one
 * over the other, turned with the text; 「±」 drawn as it always was. Every number here is worked out by hand from the constants of the layout.
 */
import { describe, expect, it } from 'vitest';
import { rightOf, viewVectors, type Dimension, type ElementFacts, type Ref } from '@3db/model';
import { checkDxf, deviationTexts, dimensionText, dimensionTextItems, dimensionWords, evaluateDimension, readDxf, STACK_GAP, STACK_LOWER, STACK_SCALE, STACK_UPPER, textWidthMm, toDxf, toleranceText, type DxfText, type PlacedView, type SceneItem, type SceneText } from '@3db/drawing';

const bilateral = (upper: number, lower: number) => ({ type: 'bilateral' as const, upper, lower });

describe('the deviations as written', () => {
  it('the reference drawing: +0 over -0.01, and +4° over -0 for an angle (the degree sign only on the one that is not zero)', () => {
    expect(deviationTexts(0, -0.01)).toEqual(['+0', '-0.01']);
    expect(deviationTexts(4, 0, 'mm', true)).toEqual(['+4°', '-0']);
  });

  it('a zero takes the sign of its place, either side, and both zero is +0 over -0', () => {
    expect(deviationTexts(0.1, 0)).toEqual(['+0.1', '-0']);
    expect(deviationTexts(0, -0.05)).toEqual(['+0', '-0.05']);
    expect(deviationTexts(0, 0)).toEqual(['+0', '-0']);
    expect(deviationTexts(0, -1.5, 'mm', true)).toEqual(['+0', '-1.5°']);
  });

  it('both deviations of the same decimals, the longer of the two (ISO 129-1); a zero keeps none', () => {
    expect(deviationTexts(0.1, -0.05)).toEqual(['+0.10', '-0.05']);
    expect(deviationTexts(0.2, -0.125)).toEqual(['+0.200', '-0.125']);
    expect(deviationTexts(1, -0.5)).toEqual(['+1.0', '-0.5']);
    expect(deviationTexts(0.5, -0.25, 'mm', true)).toEqual(['+0.50°', '-0.25°']);
    expect(deviationTexts(0.5, 0, 'mm', true)).toEqual(['+0.5°', '-0']);
  });

  it('both of the same sign: above (+0.03 over +0.01) or below (-0.01 over -0.03); the sign is the value\'s, not the place\'s', () => {
    expect(deviationTexts(0.03, 0.01)).toEqual(['+0.03', '+0.01']);
    expect(deviationTexts(-0.01, -0.03)).toEqual(['-0.01', '-0.03']);
    expect(deviationTexts(-2, -3, 'mm', true)).toEqual(['-2°', '-3°']);
  });

  it('up to four decimals in the unit, rounded: 0.1 mm is 0.0039 in, 0.05 mm 0.0020 in beside it', () => {
    expect(deviationTexts(0.1, -0.05, 'in')).toEqual(['+0.0039', '-0.0020']);
    expect(deviationTexts(0.00001, -0.01)).toEqual(['+0', '-0.01']); // rounds to nothing: a zero, signed by its place
  });

  it('the decimals of the number do not reach the deviations: one decimal on the number still writes -0.01', () => {
    const d = { id: 'd', view: 'v', kind: 'linear', a: { kind: 'face', name: 'a' }, b: { kind: 'face', name: 'b' }, orientation: 'horizontal', offset: 10, precision: 1, tolerance: bilateral(0, -0.01) } as Dimension;
    expect(dimensionText(d, 1.2)).toBe('1.2 +0/-0.01');
  });

  it('±: equal and opposite limits are written on the line as before, never stacked', () => {
    expect(toleranceText(bilateral(0.05, -0.05), 20)).toBe('±0.05');
    const d = { id: 'd', view: 'v', kind: 'linear', a: { kind: 'face', name: 'a' }, b: { kind: 'face', name: 'b' }, orientation: 'horizontal', offset: 10, tolerance: bilateral(0.05, -0.05) } as Dimension;
    expect(dimensionWords(d, 20)).toEqual({ text: '20 ±0.05', parts: ['20 ±0.05'] });
  });
});

const lin = (extra: Partial<Dimension> = {}): Dimension => ({ id: 'd', view: 'v', kind: 'linear', a: { kind: 'face', name: 'a' }, b: { kind: 'face', name: 'b' }, orientation: 'horizontal', offset: 10, ...extra }) as Dimension;

describe('what is stacked and what is written around it', () => {
  it('a reference dimension\'s parentheses close after the stack; a prefix and a suffix stand outside it', () => {
    expect(dimensionWords(lin({ tolerance: bilateral(0, -0.01), reference: true }), 1.2).parts).toEqual(['(1.2 ', { upper: '+0', lower: '-0.01' }, ')']);
    expect(dimensionWords(lin({ tolerance: bilateral(0, -0.01), prefix: '2× ', suffix: ' (兩處)' }), 1.2).parts).toEqual(['2× 1.2 ', { upper: '+0', lower: '-0.01' }, ' (兩處)']);
  });

  it('a text of the user\'s own: each <DIM> carries its stack, and the characters that mark a stack are taken out of what they typed', () => {
    const w = dimensionWords(lin({ tolerance: bilateral(0.1, 0), text: '\u0001約 <DIM>\u0003' }), 5);
    expect(w.parts).toEqual(['約 5 ', { upper: '+0.1', lower: '-0' }]);
    expect(w.text).toBe('約 5 +0.1/-0');
  });

  it('an angle: 25° with +4° over -0, and the one-line text the panel lists', () => {
    const angle = { id: 'd', view: 'v', kind: 'angle', a: { kind: 'face', name: 'a' }, b: { kind: 'face', name: 'b' }, arc: 20, tolerance: bilateral(4, 0) } as Dimension;
    expect(dimensionWords(angle, 25)).toEqual({ text: '25° +4°/-0', parts: ['25° ', { upper: '+4°', lower: '-0' }] });
  });
});

describe('how the stack is laid out', () => {
  const h = 3.5;
  /** Helvetica's widths (1/1000 em) of what is used here, an em being h / 0.718 of the cap height. */
  const W = (k: number, height: number) => (k / 718) * height;
  const wMain = W(556 + 278 + 556, h); // 「1.2」
  const wStack = W(333 + 556 + 278 + 556 + 556, h * STACK_SCALE); // 「-0.01」, the wider of the two

  it('the reference: 1.2 ends where the gap before the stack begins, +0 over -0.01 start at one x, half as tall, the stack reaching a tenth over the capitals', () => {
    const { items, width } = dimensionTextItems(['1.2 ', { upper: '+0', lower: '-0.01' }], [100, 50], h, 'center');
    expect(width).toBeCloseTo(wMain + STACK_GAP * h + wStack, 9);
    expect(items.map((i) => i.text)).toEqual(['1.2', '+0', '-0.01']);
    const [main, upper, lower] = items as [SceneText, SceneText, SceneText];
    const left = 100 - width / 2;
    expect(main).toMatchObject({ anchor: 'right', height: h });
    expect(main.at[0]).toBeCloseTo(left + wMain, 9);
    expect(main.at[1]).toBe(50);
    for (const s of [upper, lower]) {
      expect(s.anchor).toBe('left');
      expect(s.height).toBeCloseTo(0.52 * h, 12);
      expect(s.at[0]).toBeCloseTo(left + wMain + STACK_GAP * h, 9);
    }
    expect(upper.at[1]).toBeCloseTo(50 + STACK_UPPER * h, 12);
    expect(lower.at[1]).toBeCloseTo(50 + STACK_LOWER * h, 12);
    // the upper one's capitals end a tenth of the height over the number's; the lower one's baseline a tenth under, and the two do not touch
    expect(upper.at[1] + upper.height).toBeCloseTo(50 + 1.1 * h, 12);
    expect(lower.at[1]).toBeCloseTo(50 - 0.1 * h, 12);
    expect(upper.at[1] - (lower.at[1] + lower.height)).toBeGreaterThan(0.1 * h);
  });

  it('turned with the text: every piece at the angle, the stack where the turned row puts it', () => {
    const a = 30, r = (a * Math.PI) / 180;
    const { items, width } = dimensionTextItems(['1.2 ', { upper: '+0', lower: '-0.01' }], [0, 0], h, 'center', a);
    for (const i of items) expect(i.angle).toBe(a);
    const x = -width / 2 + wMain + STACK_GAP * h;
    const turn = (u: number, v: number) => [u * Math.cos(r) - v * Math.sin(r), u * Math.sin(r) + v * Math.cos(r)];
    const [, upper, lower] = items as [SceneText, SceneText, SceneText];
    const [ux, uy] = turn(x, STACK_UPPER * h);
    const [lx, ly] = turn(x, STACK_LOWER * h);
    expect(upper.at[0]).toBeCloseTo(ux!, 9);
    expect(upper.at[1]).toBeCloseTo(uy!, 9);
    expect(lower.at[0]).toBeCloseTo(lx!, 9);
    expect(lower.at[1]).toBeCloseTo(ly!, 9);
  });

  it('anchored at its left or right end, the whole row starts or ends there; what follows the stack comes after its wider deviation', () => {
    const right = dimensionTextItems(['(1.2 ', { upper: '+0', lower: '-0.01' }, ')'], [10, 0], h, 'right');
    const close = right.items[3]!;
    expect(close).toMatchObject({ text: ')', anchor: 'left' });
    const wOpen = W(333 + 556 + 278 + 556, h);
    expect(close.at[0]).toBeCloseTo(10 - right.width + wOpen + STACK_GAP * h + wStack + 0.1 * h, 9);
    expect(close.at[0] + W(333, h)).toBeCloseTo(10, 9);
  });

  it('nothing stacked is one text, as it always was', () => {
    expect(dimensionTextItems(['20 ±0.05'], [5, 6], h, 'center')).toEqual({ items: [{ kind: 'text', at: [5, 6], text: '20 ±0.05', height: h, anchor: 'center' }], width: 8 * h * 0.62 });
    expect(dimensionTextItems(['20'], [5, 6], h, 'left', 90).items[0]).toEqual({ kind: 'text', at: [5, 6], text: '20', height: h, anchor: 'left', angle: 90 });
  });
});

describe('the dimensions drawn with it', () => {
  const axes = viewVectors('front');
  const right = rightOf(axes);
  const at3 = (x: number, y: number): [number, number, number] => [right[0] * x + axes.up[0] * y, right[1] * x + axes.up[1] * y, right[2] * x + axes.up[2] * y];
  const placed: PlacedView = { id: 'v', at: [100, 100], scale: 1, w: 40, h: 40, centre: [0, 0] };
  const wall = (x: number): ElementFacts => ({ kind: 'face', type: 'plane', point: at3(x, 0), dir: at3(1, 0) });
  const texts = (items: SceneItem[]) => items.filter((i): i is SceneText => i.kind === 'text');
  const ok = (o: ReturnType<typeof evaluateDimension>) => {
    if ('error' in o) throw new Error(o.error);
    return o;
  };

  it('a linear dimension: 1.2 and the stack over the line, the outcome\'s parts for the DXF; ± stays one text with no parts', () => {
    const o = ok(evaluateDimension(lin({ tolerance: bilateral(0, -0.01) }), { elements: [wall(0), wall(1.2)] }, axes, placed));
    expect(o.text).toBe('1.2 +0/-0.01');
    expect(o.parts).toEqual(['1.2 ', { upper: '+0', lower: '-0.01' }]);
    const t = texts(o.items);
    expect(t.map((i) => i.text)).toEqual(['1.2', '+0', '-0.01']);
    expect(t[1]!.at[0]).toBeCloseTo(t[2]!.at[0], 12);
    expect(t[1]!.at[1]).toBeGreaterThan(t[2]!.at[1]);
    const sym = ok(evaluateDimension(lin({ tolerance: bilateral(0.05, -0.05) }), { elements: [wall(0), wall(1.2)] }, axes, placed));
    expect(sym).not.toHaveProperty('parts');
    expect(texts(sym.items)).toEqual([{ kind: 'text', at: expect.any(Array), text: '1.2 ±0.05', height: 3.5, anchor: 'center' }]);
  });

  it('the DXF\'s dimension style gives the stack the height the drawing draws it with (DIMTFAC × DIMTXT), so a CAD program that draws it again matches', () => {
    const o = ok(evaluateDimension(lin({ tolerance: bilateral(0, -0.01) }), { elements: [wall(0), wall(1.2)] }, axes, placed));
    const items = o.items.map((i) => ({ ...i, group: 'd' }));
    const doc = readDxf(toDxf({ width: 200, height: 200, items, dimensions: [{ id: 'd', text: o.text, parts: o.parts, ...o.dxf! }] }));
    expect(checkDxf(doc)).toEqual([]);
    const style = doc.tables.get('DIMSTYLE')!.entries.find((e) => e.name === 'STANDARD')!;
    const code = (c: number) => Number(style.pairs.find((p) => p[0] === c)?.[1]);
    expect(code(146)).toBe(STACK_SCALE);
    // the deviations in the dimension's block (what a viewer shows) against the style's own number (what a CAD program draws again)
    const drawn = doc.blockEntities.get('*D1')!.filter((e): e is DxfText => e.type === 'TEXT');
    const [main, upper, lower] = ['1.2', '+0', '-0.01'].map((s) => drawn.find((e) => e.text === s)!);
    expect(main!.height).toBe(code(140));
    expect(upper!.height).toBeCloseTo(code(146) * code(140), 6);
    expect(lower!.height).toBeCloseTo(code(146) * code(140), 6);
    expect(upper!.height).toBeLessThan(main!.height);
    // where each starts (10) for a reader that does not align (eDrawings drew 1.2 from the stack's x, over it): its width before the point it is aligned at (11)
    const at = (e: DxfText, c: number) => Number(e.pairs.find((p) => p[0] === c)?.[1]);
    expect(main!.align).toBe(2);
    expect(at(main!, 10)).toBeCloseTo(at(main!, 11) - textWidthMm('1.2', main!.height), 5);
    expect(at(main!, 10) + textWidthMm('1.2', main!.height)).toBeLessThanOrEqual(at(upper!, 10) + 1e-6);
    expect(at(upper!, 10)).toBeCloseTo(at(lower!, 10), 6);
    const font = doc.tables.get('STYLE')!.entries.find((e) => e.name === 'STANDARD')!;
    expect(font.pairs.find((p) => p[0] === 3)?.[1]).toBe('arial.ttf');
  });

  it('a diameter on a shelf: the shelf runs under the whole row, stack and all', () => {
    const hole: ElementFacts = { kind: 'face', type: 'cylinder', point: at3(0, 0), dir: [axes.dir[0], axes.dir[1], axes.dir[2]], radius: 5 };
    const d = { id: 'd', view: 'v', kind: 'diameter', ref: { kind: 'face', name: 'c' } as Ref, angle: 45, tolerance: bilateral(0.012, 0) } as Dimension;
    const o = ok(evaluateDimension(d, { elements: [hole] }, axes, placed));
    const t = texts(o.items);
    expect(t.map((i) => i.text)).toEqual(['Ø10', '+0.012', '-0']);
    // the line through the circle: far side, the knee of the leader, the end of the shelf
    const leader = o.items.find((i): i is Extract<SceneItem, { kind: 'polyline' }> => i.kind === 'polyline' && !i.filled && i.points.length === 6)!;
    const [kneeX, , endX] = [leader.points[2]!, leader.points[3]!, leader.points[4]!];
    const row = dimensionTextItems(o.parts!, [0, 0], 3.5).width;
    // the shelf is the row's width and two millimetres longer, from the knee; the last deviation ends inside it
    expect(endX - kneeX).toBeCloseTo(row + 2, 9);
    expect(row).toBeGreaterThan(dimensionTextItems(['Ø10'], [0, 0], 3.5).width);
    expect(t[1]!.at[0] + (6 * 556 / 718) * 3.5 * STACK_SCALE).toBeLessThan(endX);
  });
});
