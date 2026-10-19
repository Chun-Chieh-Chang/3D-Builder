/**
 * The sketch's own axes (ADR 0170): a revolve about the horizontal or vertical axis of the sketch, with no centerline drawn, and relations to the axes
 * that carry through a rebuild. Volumes are Pappus by hand: area × 2π × distance of the centroid from the axis.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, parsePart, serializePart, SCHEMA_VERSION, SKETCH_AXIS_H, SKETCH_AXIS_V, type Feature, type PartDoc } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { build, front, rectangle, revolve, sketch, statuses } from './builders';

let kernel: Kernel;
let regen: Regenerator;
beforeAll(async () => {
  kernel = await Kernel.load();
  regen = new Regenerator(kernel, await PlaneGcsSolver.create());
});

const volume = (r: RebuildResult) => r.bodies.reduce((v, b) => v + kernel.massProps(b.shape).volume, 0);

describe('revolve about an axis of the sketch (ADR 0170)', () => {
  it('about the vertical axis: a 5 × 20 rectangle from x = 10 to 15 makes the ring π(15² − 10²)·20', () => {
    const r = regen.rebuild(build(sketch('s1', front, rectangle('a', 10, 0, 5, 20)), revolve('r1', 's1', SKETCH_AXIS_V)));
    expect(statuses(r)).toEqual(['s1=ok', 'r1=ok']);
    expect(volume(r)).toBeCloseTo(Math.PI * (15 ** 2 - 10 ** 2) * 20, 5);
    // turned about the part's Y axis (the front plane's vertical): symmetric in x and z
    const b = kernel.bounds(r.body!.shape);
    expect(b.max[0]).toBeCloseTo(15, 4);
    expect(b.min[2]).toBeCloseTo(-15, 4);
    expect(b.min[1]).toBeCloseTo(0, 4);
    expect(b.max[1]).toBeCloseTo(20, 4);
  });

  it('about the horizontal axis: a 20 × 5 rectangle from y = 5 to 10 makes π(10² − 5²)·20; a quarter turn makes a quarter', () => {
    const doc = build(sketch('s1', front, rectangle('a', 0, 5, 20, 5)), revolve('r1', 's1', SKETCH_AXIS_H));
    expect(volume(regen.rebuild(doc))).toBeCloseTo(Math.PI * (10 ** 2 - 5 ** 2) * 20, 5);
    expect(volume(regen.rebuild(build(sketch('s1', front, rectangle('a', 0, 5, 20, 5)), revolve('r1', 's1', SKETCH_AXIS_H, 'boss', '90'))))).toBeCloseTo((Math.PI * (10 ** 2 - 5 ** 2) * 20) / 4, 5);
  });

  it('a profile the axis passes through is refused, as with a drawn centerline', () => {
    const r = regen.rebuild(build(sketch('s1', front, rectangle('a', -5, 0, 10, 20)), revolve('r1', 's1', SKETCH_AXIS_V)));
    expect(r.features.find((f) => f.id === 'r1')?.status).toBe('error');
  });

  it('the commands take an axis of the sketch as the revolve axis, and nothing else that is not a line', () => {
    const doc = build(sketch('s1', front, rectangle('a', 10, 0, 5, 20)), revolve('r1', 's1', SKETCH_AXIS_V));
    expect((applyCommand(doc, { type: 'setRevolveAxis', featureId: 'r1', axis: SKETCH_AXIS_H }).features[1] as Extract<Feature, { type: 'revolve' }>).axis).toBe(SKETCH_AXIS_H);
    expect(() => applyCommand(doc, { type: 'setRevolveAxis', featureId: 'r1', axis: '@axisZ' })).toThrow();
    expect(() => applyCommand(doc, { type: 'setRevolveAxis', featureId: 'r1', axis: '@origin' })).toThrow();
  });
});

describe('relations to the axes in the model', () => {
  /** A 10 × 6 rectangle whose corners are held symmetric about the vertical axis and whose bottom lies on the horizontal one. */
  const centered = (): PartDoc => {
    const r = rectangle('a', 3, 2, 10, 6);
    // the rectangle builder pins a corner to the origin by dimensions; keep only its own lines' relations and the size
    // symmetry about the vertical axis makes the bottom horizontal by itself: its own horizontal relation would over-define the sketch
    const own = r.constraints.filter((c) => !JSON.stringify(c).includes('@origin') && c.id !== 'ah0');
    const [p0, p1] = [r.entities[0]!.id, r.entities[1]!.id];
    return build(
      sketch('s1', front, {
        entities: r.entities,
        constraints: [
          ...own,
          { id: 'sym', type: 'symmetric', a: p0, b: p1, axis: SKETCH_AXIS_V },
          { id: 'on', type: 'pointOnCurve', point: p0, curve: SKETCH_AXIS_H },
        ],
      }),
    );
  };

  it('the sketch is centred on the vertical axis and sits on the horizontal one', () => {
    const r = regen.rebuild(centered());
    expect(statuses(r)).toEqual(['s1=ok']);
    const s = r.sketches.get('s1')!;
    const xs = [...s.solved.geometry.values()].flatMap((g) => (g.type === 'point' ? [g.p[0]] : []));
    const ys = [...s.solved.geometry.values()].flatMap((g) => (g.type === 'point' ? [g.p[1]] : []));
    expect(Math.min(...xs)).toBeCloseTo(-Math.max(...xs), 9);
    expect(Math.min(...ys)).toBeCloseTo(0, 9);
  });

  it('a part with relations to the axes is written as the current version (68 or later) and read back the same', () => {
    const doc = centered();
    const file = serializePart(doc);
    expect(JSON.parse(file).schemaVersion).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(68);
    expect(parsePart(file).features).toEqual(doc.features);
  });
});
