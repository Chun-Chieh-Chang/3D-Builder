/**
 * Phase 1B (handoff §9): extrude boss/cut with every P0 end condition, revolve, chamfer, sketches on
 * model faces — rebuilt from documents, with volumes checked against closed-form values.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, type Command, type Feature, type PartDoc, type Ref, type SketchConstraint, type SketchEntity } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { dependencies, Regenerator, type RebuildResult } from '@3db/regen';

let kernel: Kernel;
let regen: Regenerator;
beforeAll(async () => {
  kernel = await Kernel.load();
  regen = new Regenerator(kernel, await PlaneGcsSolver.create());
});

type Part = { entities: SketchEntity[]; constraints: SketchConstraint[] };

/** A w × h rectangle with its lower-left corner at (x, y); ids are `${id}p0…`, `${id}l0…` (l0 bottom, l1 right, l2 top, l3 left). */
function rectangle(id: string, x: number, y: number, w: number, h: number): Part {
  const corners: [number, number][] = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
  return {
    entities: [
      ...corners.map(([px, py], i) => ({ id: `${id}p${i}`, type: 'point', x: px, y: py }) as const),
      ...[0, 1, 2, 3].map((i) => ({ id: `${id}l${i}`, type: 'line', p1: `${id}p${i}`, p2: `${id}p${(i + 1) % 4}` }) as const),
    ],
    constraints: [
      { id: `${id}h0`, type: 'horizontal', a: `${id}l0` },
      { id: `${id}v1`, type: 'vertical', a: `${id}l1` },
      { id: `${id}h2`, type: 'horizontal', a: `${id}l2` },
      { id: `${id}v3`, type: 'vertical', a: `${id}l3` },
      { id: `${id}w`, type: 'distance', a: `${id}l0`, value: String(w) },
      { id: `${id}d`, type: 'distance', a: `${id}l1`, value: String(h) },
    ],
  };
}

function circle(id: string, cx: number, cy: number, r: number): Part {
  return {
    entities: [
      { id: `${id}c`, type: 'point', x: cx, y: cy },
      { id, type: 'circle', center: `${id}c`, radius: r },
    ],
    constraints: [{ id: `${id}r`, type: 'radius', circle: id, value: String(r) }],
  };
}

const sketch = (id: string, plane: Ref, ...parts: Part[]): Feature => ({
  id,
  type: 'sketch',
  name: id,
  suppressed: false,
  plane,
  entities: parts.flatMap((p) => p.entities),
  constraints: parts.flatMap((p) => p.constraints),
});

const extrude = (id: string, sketchId: string, op: 'boss' | 'cut', dir1: Extract<Feature, { type: 'extrude' }>['dir1']): Feature => ({ id, type: 'extrude', name: id, suppressed: false, sketch: sketchId, op, dir1 });

const front: Ref = { kind: 'datum', name: 'plane:front' };
const face = (name: string): Ref => ({ kind: 'face', name });

function build(...features: Feature[]): PartDoc {
  return features.reduce<PartDoc>((doc, feature, index) => applyCommand(doc, { type: 'insertFeature', feature, index } satisfies Command), createEmptyPart());
}

const status = (r: RebuildResult) => r.features.map((f) => `${f.id}=${f.status}${f.message ? `(${f.message})` : ''}`);
const volume = (r: RebuildResult) => kernel.massProps(r.body!.shape).volume;

/** A 40 × 30 × 10 plate on the front plane (z from 0 to 10). */
const plate = (): Feature[] => [sketch('s1', front, rectangle('a', 0, 0, 40, 30)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' })];

describe('extrude boss and cut (C4.1, C4.2, A1.5)', () => {
  it('merges a boss into the body and names its faces', () => {
    const r = regen.rebuild(build(...plate(), sketch('s2', front, rectangle('b', 10, 10, 20, 10)), extrude('e2', 's2', 'boss', { type: 'blind', depth: '15' })));
    expect(status(r)).toEqual(['s1=ok', 'e1=ok', 's2=ok', 'e2=ok']);
    expect(volume(r)).toBeCloseTo(40 * 30 * 10 + 20 * 10 * 5, 6); // the boss rises 5 above the plate
    expect(r.body!.names.faces).toContain('e2:cap:end');
    expect(r.body!.names.faces.filter((f) => f.startsWith('e2:side:'))).toHaveLength(4);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
  });

  it('cuts with a blind depth, through all, and reports a cut that misses', () => {
    const hole = sketch('s2', front, circle('k', 20, 15, 4));
    // sketched on the plate's bottom plane: a cut goes against the normal by default, so reverse into the plate
    const blind = regen.rebuild(build(...plate(), hole, extrude('c1', 's2', 'cut', { type: 'blind', depth: '6', reverse: true })));
    expect(status(blind).at(-1)).toBe('c1=ok');
    expect(volume(blind)).toBeCloseTo(12000 - Math.PI * 16 * 6, 6);

    const through = regen.rebuild(build(...plate(), hole, extrude('c1', 's2', 'cut', { type: 'throughAll', reverse: true })));
    expect(volume(through)).toBeCloseTo(12000 - Math.PI * 16 * 10, 6);
    expect(through.body!.names.faces).toContain('c1:side:s2.k');

    const missed = regen.rebuild(build(...plate(), hole, extrude('c1', 's2', 'cut', { type: 'blind', depth: '6' })));
    expect(missed.features.at(-1)).toMatchObject({ status: 'error', message: expect.stringContaining('反轉方向') });
  });

  it('extrudes a post up to a face of the body', () => {
    // a tall block (z 0..30) on the left of the plate; a post from the plate's top up to the block's top
    const doc = build(
      ...plate(),
      sketch('s2', front, rectangle('b', 0, 0, 10, 30)),
      extrude('e2', 's2', 'boss', { type: 'blind', depth: '30' }),
      sketch('s3', face('e1:cap:end'), circle('k', 25, 15, 3)),
      extrude('e3', 's3', 'boss', { type: 'upToFace', face: face('e2:cap:end') }),
    );
    const r = regen.rebuild(doc);
    expect(status(r)).toEqual(['s1=ok', 'e1=ok', 's2=ok', 'e2=ok', 's3=ok', 'e3=ok']);
    expect(volume(r)).toBeCloseTo(12000 + 10 * 30 * 20 + Math.PI * 9 * 20, 5);
    expect(r.body!.names.faces).toContain('e3:cap:end'); // the post's top, where the block's top plane cut it
    expect(dependencies(doc).parents.get('e3')!.sort()).toEqual(['e2', 's3']);
  });
});

describe('sketch on a model face (C1.1)', () => {
  it('places a sketch on the top face and cuts a pocket into it', () => {
    const doc = build(...plate(), sketch('s2', face('e1:cap:end'), circle('k', 10, 10, 5)), extrude('c1', 's2', 'cut', { type: 'blind', depth: '4' }));
    const r = regen.rebuild(doc);
    expect(status(r)).toEqual(['s1=ok', 'e1=ok', 's2=ok', 'c1=ok']);
    expect(r.frames.get('s2')).toMatchObject({ origin: [0, 0, expect.closeTo(10, 9)], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] });
    expect(volume(r)).toBeCloseTo(12000 - Math.PI * 25 * 4, 6); // a cut goes into the face by default
    expect(dependencies(doc).parents.get('s2')).toEqual(['e1']);
  });

  it('follows the face when an upstream dimension changes', () => {
    const doc = build(...plate(), sketch('s2', face('e1:cap:end'), circle('k', 10, 10, 5)), extrude('e2', 's2', 'boss', { type: 'blind', depth: '3' }));
    const thicker = applyCommand(doc, { type: 'setEndCondition', featureId: 'e1', dir: 'dir1', value: { type: 'blind', depth: '25' } });
    const r = regen.rebuild(thicker);
    expect(r.frames.get('s2')!.origin[2]).toBeCloseTo(25, 9);
    expect(volume(r)).toBeCloseTo(40 * 30 * 25 + Math.PI * 25 * 3, 6);
  });

  it('reports the plane of the sketch being edited even though it is rolled back', () => {
    const r = regen.rebuild(build(...plate(), sketch('s2', face('e1:cap:end'), circle('k', 10, 10, 5))), { until: 2 });
    expect(r.frames.get('s2')!.origin[2]).toBeCloseTo(10, 9);
  });

  it('refuses a sketch on a curved face', () => {
    const doc = build(...plate(), sketch('s2', front, circle('k', 20, 15, 4)), extrude('c1', 's2', 'cut', { type: 'throughAll', reverse: true }), sketch('s3', face('c1:side:s2.k'), circle('m', 0, 0, 1)));
    expect(regen.rebuild(doc).features.at(-1)).toMatchObject({ status: 'error', message: '草圖只能放在平面上' });
  });
});

describe('revolve (C4.3) and chamfer (C5.3)', () => {
  /** A 5 × 20 rectangle from x = 10 to 15 beside a vertical centerline through the origin, plus a line across it. */
  const profile = (): Feature => {
    const r = rectangle('a', 10, 0, 5, 20);
    return sketch('s1', front, {
      entities: [
        ...r.entities,
        { id: 'ax1', type: 'point', x: 0, y: 0 },
        { id: 'ax2', type: 'point', x: 0, y: 20 },
        { id: 'axis', type: 'line', p1: 'ax1', p2: 'ax2', construction: true },
        { id: 'mx1', type: 'point', x: 12, y: -5 },
        { id: 'mx2', type: 'point', x: 12, y: 25 },
        { id: 'across', type: 'line', p1: 'mx1', p2: 'mx2', construction: true },
      ],
      constraints: [...r.constraints, { id: 'ax', type: 'coincident', a: 'ax1', b: '@origin' }, { id: 'av', type: 'vertical', a: 'axis' }],
    });
  };
  const revolve = (axis: string, dir1: Extract<Feature, { type: 'revolve' }>['dir1']): Feature => ({ id: 'r1', type: 'revolve', name: 'r1', suppressed: false, sketch: 's1', axis, op: 'boss', dir1 });
  const ring = Math.PI * (15 ** 2 - 10 ** 2) * 20;

  it('revolves fully, one way and symmetrically about a centerline', () => {
    const full = regen.rebuild(build(profile(), revolve('axis', { type: 'blind', angle: '360' })));
    expect(status(full)).toEqual(['s1=ok', 'r1=ok']);
    expect(volume(full)).toBeCloseTo(ring, 5);
    const quarter = regen.rebuild(build(profile(), revolve('axis', { type: 'midPlane', angle: '90' })));
    expect(volume(quarter)).toBeCloseTo(ring / 4, 5);
    const b = kernel.bounds(quarter.body!.shape);
    expect(b.max[2]).toBeCloseTo(-b.min[2], 3); // split evenly about the sketch plane
    expect(quarter.body!.names.faces).toEqual(expect.arrayContaining(['r1:cap:start', 'r1:cap:end']));
    const oneWay = regen.rebuild(build(profile(), revolve('axis', { type: 'blind', angle: '90', reverse: true })));
    expect(volume(oneWay)).toBeCloseTo(ring / 4, 5);
  });

  it('names every face of a full revolve after the profile line that swept it, the planar ones too', () => {
    // A full revolution loses the history of faces square to the axis in OCCT (found by the 1G acceptance);
    // before the fix they were named by position ("r1:face#2") and a reference could jump to another face.
    const full = regen.rebuild(build(profile(), revolve('axis', { type: 'blind', angle: '360' })));
    expect([...full.body!.names.faces].sort()).toEqual(['r1:side:s1.al0', 'r1:side:s1.al1', 'r1:side:s1.al2', 'r1:side:s1.al3']);
    // A chamfer on the top outer edge stays there when the profile grows taller.
    const chamfer: Feature = { id: 'ch1', type: 'chamfer', name: 'ch1', suppressed: false, edges: [{ kind: 'edge', name: '{r1:side:s1.al1|r1:side:s1.al2}' }], mode: 'distanceDistance', distance: '1', second: '1' };
    const cut = Math.PI * 2 * (15 - 1 / 3) * 0.5;
    for (const height of ['20', '30']) {
      const doc = applyCommand(build(profile(), revolve('axis', { type: 'blind', angle: '360' }), chamfer), { type: 'setDimension', featureId: 's1', constraintId: 'ad', value: height });
      const r = regen.rebuild(doc);
      expect(status(r)).toEqual(['s1=ok', 'r1=ok', 'ch1=ok']);
      expect(volume(r)).toBeCloseTo(Math.PI * (15 ** 2 - 10 ** 2) * Number(height) - cut, 5);
    }
  });

  it('refuses a profile that crosses the axis', () => {
    expect(regen.rebuild(build(profile(), revolve('across', { type: 'blind', angle: '90' }))).features.at(-1)).toMatchObject({ status: 'error', message: '輪廓跨過旋轉軸' });
  });

  it('chamfers an edge by name, and flips which face gets the first distance', () => {
    const edge: Ref = { kind: 'edge', name: '{e1:cap:end|e1:side:s1.al1}' }; // top edge over the right side (x = 40)
    const chamfer = (flip: boolean): Feature => ({ id: 'ch1', type: 'chamfer', name: 'ch1', suppressed: false, edges: [edge], mode: 'distanceDistance', distance: '2', second: '4', ...(flip ? { flip: true } : {}) });
    const center = (r: RebuildResult) => r.body!.topology.faces[r.body!.names.faces.findIndex((f) => f.startsWith('ch1:chamfer:'))]!.center;
    // A rebuild releases the previous result's shapes, so each result is measured right away.
    const a = regen.rebuild(build(...plate(), chamfer(false)));
    expect(status(a)).toEqual(['s1=ok', 'e1=ok', 'ch1=ok']);
    expect(volume(a)).toBeCloseTo(12000 - 0.5 * 2 * 4 * 30, 6);
    const ca = center(a);
    const b = regen.rebuild(build(...plate(), chamfer(true)));
    expect(volume(b)).toBeCloseTo(12000 - 0.5 * 2 * 4 * 30, 6);
    expect(center(b)[0]).not.toBeCloseTo(ca[0], 3); // the same edge, chamfered the other way round
    const angled = regen.rebuild(build(...plate(), { ...chamfer(false), mode: 'angleDistance', second: '45' } as Feature));
    expect(volume(angled)).toBeCloseTo(12000 - 0.5 * 2 * 2 * 30, 6);
  });
});
