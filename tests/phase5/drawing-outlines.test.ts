/**
 * D-I2 (ADR 0138): a cylinder seen from the side is dimensioned from its outlines, as SolidWorks does — the lines drawn a radius off its axis. One outline picked
 * is the cylinder's diameter (between its two outlines, written with Ø); an outline with something else is measured from that outline. The numbers are the
 * model's: a pin of radius 6 is Ø12 whatever is drawn; an outline 6 off an axis at x = 20 is at 14 and 26.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyDrawingCommand, CommandError, createEmptyDrawing, viewVectors, type Dimension, type Ref, type ViewAxes } from '@3db/model';
import { Kernel } from '@3db/kernel';
import { PlaneGcsSolver } from '@3db/sketch';
import { elementFacts, Regenerator, viewFeatures, type RebuildResult } from '@3db/regen';
import { evaluateDimension, featureAt, outlinesOf, planDimension, type PlacedView, type ViewLines } from '@3db/drawing';
import { build, circle, extrude, front, sketch } from '../phase1/builders';

let kernel: Kernel;
let built: RebuildResult;
const kept: Regenerator[] = [];
beforeAll(async () => {
  kernel = await Kernel.load();
  const regen = new Regenerator(kernel, await PlaneGcsSolver.create());
  kept.push(regen);
  // a pin of radius 6 about the axis x = 20, y = 10, 30 long along z
  built = regen.rebuild(build(sketch('s1', front, circle('c', 20, 10, 6)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '30' })));
});
afterAll(() => kept.forEach((r) => r.dispose()));

function top() {
  const axes: ViewAxes = viewVectors('top');
  const body = built.body!;
  const lines = kernel.projectView(body.shape, axes) as ViewLines;
  const features = viewFeatures(body.topology, body.names, axes);
  const b = lines.box!;
  const placed: PlacedView = { id: 'v', at: [200, 150], scale: 1, w: b.max[0] - b.min[0], h: b.max[1] - b.min[1], centre: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2] };
  return { axes, lines, features, placed };
}
const facts = (refs: Ref[]) => ({ elements: refs.map((r) => elementFacts(built.body!.topology, built.body!.names, r) as never) });

describe('the outlines of a cylinder seen from the side', () => {
  it('the top view sees the pin from the side: two outlines, 6 either side of the axis at x = 20, each on a line of the view', () => {
    const { lines, features } = top();
    const outlines = outlinesOf(features);
    expect(outlines.length).toBe(2);
    expect(outlines.map((o) => o.from[0]).sort((a, b) => a - b)).toEqual([expect.closeTo(14, 6), expect.closeTo(26, 6)]);
    for (const o of outlines) {
      const got = featureAt(lines, features, [o.from[0] + 0.1, (o.from[1] + o.to[1]) / 2], 0.6);
      expect(got?.type).toBe('outline');
      expect((got as { side: number }).side).toBe(o.side);
    }
  });

  it("one outline is the pin's diameter between both: Ø12, from the model", () => {
    const { axes, lines, features, placed } = top();
    // the middle of the right outline (its ends are the corners with the end faces, where a plane seen edge-on is picked first)
    const right = outlinesOf(features).find((x) => x.from[0] > 20)!;
    const o = featureAt(lines, features, [26.1, (right.from[1] + right.to[1]) / 2], 0.6);
    expect(o?.type).toBe('outline');
    const plan = planDimension([o!], [placed.at[0], placed.at[1] + placed.h / 2 + 12], placed, axes);
    if (!('draft' in plan)) throw new Error('no draft');
    const d = { id: 'd', view: 'v', ...plan.draft } as Extract<Dimension, { kind: 'linear' }>;
    expect(d.orientation).toBe('horizontal');
    expect(d.a.name).toBe(d.b.name);
    expect(d.aSide).toBe(-d.bSide!);
    const out = evaluateDimension(d, facts([d.a, d.b]), axes, placed) as { value: number; text: string };
    expect(out.value).toBeCloseTo(12, 9);
    expect(out.text).toBe('Ø12');
  });

  it('an outline and the end face of the pin: measured from the outline, 26 − 14 = 12 again the other way round is the length, 30', () => {
    const { axes, lines, features, placed } = top();
    const left = outlinesOf(features).find((o) => o.from[0] < 20)!;
    // the end faces are planes seen edge-on across y (the pin's length runs along the view's y)
    const ends = features.filter((f): f is Extract<typeof f, { type: 'plane' }> => f.type === 'plane' && f.axis === 'y');
    expect(ends.length).toBe(2);
    const right = outlinesOf(features).find((o) => o.from[0] > 20)!;
    const across = planDimension([left, right], [placed.at[0], placed.at[1] + placed.h / 2 + 12], placed, axes);
    if (!('draft' in across)) throw new Error('no draft');
    expect((evaluateDimension({ id: 'd', view: 'v', ...across.draft } as Dimension, facts([(across.draft as { a: Ref }).a, (across.draft as { b: Ref }).b]), axes, placed) as { value: number }).value).toBeCloseTo(12, 9);
    const length = planDimension([ends[0]!, ends[1]!], [placed.at[0] + placed.w / 2 + 12, placed.at[1]], placed, axes);
    if (!('draft' in length)) throw new Error('no draft');
    expect((evaluateDimension({ id: 'd', view: 'v', ...length.draft } as Dimension, facts([(length.draft as { a: Ref }).a, (length.draft as { b: Ref }).b]), axes, placed) as { value: number }).value).toBeCloseTo(30, 9);
    void lines;
  });

  it('the commands refuse a face measured to itself from one side, and a side that is not 1 or -1, and a side on a vertex', () => {
    let doc = createEmptyDrawing();
    doc = applyDrawingCommand(doc, { type: 'insertViews', views: [{ id: 'view1', name: 'Top', source: 'pin.3dbx', direction: 'top' }] });
    const face: Ref = { kind: 'face', name: 'e1:side:s1.c' };
    const dim = (patch: object) => ({ id: 'dim1', view: 'view1', kind: 'linear', a: face, b: face, orientation: 'horizontal', offset: 10, ...patch }) as Dimension;
    expect(() => applyDrawingCommand(doc, { type: 'insertDimensions', dimensions: [dim({ aSide: 1, bSide: -1 })] })).not.toThrow();
    for (const bad of [{}, { aSide: 1, bSide: 1 }, { aSide: 2, bSide: -1 }, { a: { kind: 'vertex', name: 'v' }, aSide: 1, bSide: -1 }])
      expect(() => applyDrawingCommand(doc, { type: 'insertDimensions', dimensions: [dim(bad)] }), JSON.stringify(bad)).toThrow(CommandError);
  });

  it('seen end on (the front view, a circle), the cylinder has no outline: a dimension from its side says so', () => {
    const axes = viewVectors('front');
    const body = built.body!;
    const lines = kernel.projectView(body.shape, axes) as ViewLines;
    const b = lines.box!;
    const placed: PlacedView = { id: 'v', at: [200, 150], scale: 1, w: b.max[0] - b.min[0], h: b.max[1] - b.min[1], centre: [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2] };
    const face = viewFeatures(body.topology, body.names, axes).find((f) => f.type === 'circle')!.ref;
    const out = evaluateDimension({ id: 'd', view: 'v', kind: 'linear', a: face, b: face, aSide: 1, bSide: -1, orientation: 'horizontal', offset: 10 } as Dimension, facts([face, face]), axes, placed);
    expect('error' in out).toBe(true);
  });
});
