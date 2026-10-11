import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, parsePart, serializePart, shownByDefault, SCHEMA_VERSION, type Command, type Feature, type PartDoc, type Ref, type SketchEntity, type ThreadFeature } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { build, front, rectangle, sketch, statuses, type SketchParts } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const rebuild = (doc: PartDoc) => new Regenerator(kernel, solver, new Map()).rebuild(doc);
const failures = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));
const volume = (r: RebuildResult) => r.bodies.reduce((v, b) => v + kernel.massProps(b.shape).volume, 0);

const point = (id: string, x: number, y: number): SketchEntity => ({ id, type: 'point', x, y });
const line = (id: string, p1: string, p2: string, construction = false): SketchEntity => ({ id, type: 'line', p1, p2, construction });
const parts = (...entities: SketchEntity[]): SketchParts => ({ entities, constraints: [] });

/** Tooth profile: trapezoidal tooth on the Front plane, along Y axis */
const toothProfile = (id: string, r: number, y0: number, wb: number, h: number): SketchParts => {
  const p1 = point(`${id}p1`, r, y0 - wb / 2);
  const p2 = point(`${id}p2`, r + h, y0 - wb / 4);
  const p3 = point(`${id}p3`, r + h, y0 + wb / 4);
  const p4 = point(`${id}p4`, r, y0 + wb / 2);
  return {
    entities: [
      p1, p2, p3, p4,
      line(`${id}l1`, `${id}p1`, `${id}p2`),
      line(`${id}l2`, `${id}p2`, `${id}p3`),
      line(`${id}l3`, `${id}p3`, `${id}p4`),
      line(`${id}l4`, `${id}p4`, `${id}p1`),
    ],
    constraints: [],
  };
};

describe('Thread Feature (T-2, Schema 53)', () => {
  it('thread cut into a revolved bore regenerates, produces valid solid, and creates persistent face names', () => {
    // 1. Revolved bore: r=3.6 to 7.0, y=0 to 12.0
    // Centerline along Y axis: (0, 0) to (0, 12)
    const boreSketch = sketch(
      'sk_bore',
      front,
      parts(
        point('bp1', 3.6, 0), point('bp2', 7.0, 0), point('bp3', 7.0, 12), point('bp4', 3.6, 12),
        line('bl1', 'bp1', 'bp2'), line('bl2', 'bp2', 'bp3'), line('bl3', 'bp3', 'bp4'), line('bl4', 'bp4', 'bp1'),
        point('ax1', 0, 0), point('ax2', 0, 12),
        line('axis', 'ax1', 'ax2', true),
      ),
    );
    const revolveBore: Feature = {
      id: 'rv_bore',
      type: 'revolve',
      name: 'rv_bore',
      suppressed: false,
      sketch: 'sk_bore',
      axis: 'axis',
      op: 'boss',
      dir1: { type: 'blind', angle: '360deg' },
    };

    // 2. Tooth profile sketch on front plane at r=3.6, y=2.0 (lead=5, pitch=2.5, starts=2)
    const tooth = sketch('sk_tooth', front, toothProfile('t', 3.6, 2.0, 1.5, 1.0));

    // 3. Thread feature cut
    const threadFeat: ThreadFeature = {
      id: 'th1',
      type: 'thread',
      name: 'th1',
      suppressed: false,
      sketch: 'sk_tooth',
      axis: { kind: 'face', name: 'rv_bore:side:sk_bore.bl4' }, // inner bore cylinder face
      op: 'cut',
      pitch: '2.5',
      starts: '2',
      hand: 'right',
      length: '8',
    };

    const doc = build(boreSketch, revolveBore, tooth, threadFeat);
    const r = rebuild(doc);

    expect(failures(r)).toEqual([]);
    expect(r.bodies.length).toBe(1);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(kernel.solidCount(r.body!.shape)).toBe(1);

    // Verify face names include thread flank faces and caps
    const faceNames = r.body!.names.faces;
    const threadFaces = faceNames.filter((n) => n.startsWith('th1:'));
    expect(threadFaces.length).toBeGreaterThan(0);
    expect(threadFaces.some((n) => n.includes('side:sk_tooth.tl'))).toBe(true);

    // Verify tooth sketch is hidden by default after being used by thread feature
    expect(shownByDefault(doc, 'sk_tooth')).toBe(false);
    expect(shownByDefault(doc, 'sk_bore')).toBe(false);
  });

  it('modifying thread parameters via setThread command updates model and regenerates cleanly', () => {
    const boreSketch = sketch(
      'sk_bore',
      front,
      parts(
        point('bp1', 3.6, 0), point('bp2', 7.0, 0), point('bp3', 7.0, 12), point('bp4', 3.6, 12),
        line('bl1', 'bp1', 'bp2'), line('bl2', 'bp2', 'bp3'), line('bl3', 'bp3', 'bp4'), line('bl4', 'bp4', 'bp1'),
        point('ax1', 0, 0), point('ax2', 0, 12),
        line('axis', 'ax1', 'ax2', true),
      ),
    );
    const revolveBore: Feature = {
      id: 'rv_bore',
      type: 'revolve',
      name: 'rv_bore',
      suppressed: false,
      sketch: 'sk_bore',
      axis: 'axis',
      op: 'boss',
      dir1: { type: 'blind', angle: '360deg' },
    };
    const tooth = sketch('sk_tooth', front, toothProfile('t', 3.6, 2.0, 1.5, 1.0));
    const threadFeat: ThreadFeature = {
      id: 'th1',
      type: 'thread',
      name: 'th1',
      suppressed: false,
      sketch: 'sk_tooth',
      axis: { kind: 'face', name: 'rv_bore:side:sk_bore.bl4' },
      op: 'cut',
      pitch: '2.5',
      starts: '1',
      hand: 'right',
      length: '6',
    };

    let doc = build(boreSketch, revolveBore, tooth, threadFeat);
    const r1 = rebuild(doc);
    expect(failures(r1)).toEqual([]);
    const v1 = volume(r1);

    // Change to left hand and longer length
    doc = applyCommand(doc, {
      type: 'setThread',
      featureId: 'th1',
      params: { hand: 'left', length: '8' },
    });
    const r2 = rebuild(doc);
    expect(failures(r2)).toEqual([]);
    const v2 = volume(r2);
    // Longer cut removes more volume
    expect(v2).toBeLessThan(v1);
    expect(kernel.isValid(r2.body!.shape)).toBe(true);
  });

  it('reports missing reference when sketch or axis is gone', () => {
    const boreSketch = sketch(
      'sk_bore',
      front,
      parts(
        point('bp1', 3.6, 0), point('bp2', 7.0, 0), point('bp3', 7.0, 12), point('bp4', 3.6, 12),
        line('bl1', 'bp1', 'bp2'), line('bl2', 'bp2', 'bp3'), line('bl3', 'bp3', 'bp4'), line('bl4', 'bp4', 'bp1'),
        point('ax1', 0, 0), point('ax2', 0, 12),
        line('axis', 'ax1', 'ax2', true),
      ),
    );
    const revolveBore: Feature = {
      id: 'rv_bore',
      type: 'revolve',
      name: 'rv_bore',
      suppressed: false,
      sketch: 'sk_bore',
      axis: 'axis',
      op: 'boss',
      dir1: { type: 'blind', angle: '360deg' },
    };
    const tooth = sketch('sk_tooth', front, toothProfile('t', 3.6, 2.0, 1.5, 1.0));
    const badAxisThread: ThreadFeature = {
      id: 'th1',
      type: 'thread',
      name: 'th1',
      suppressed: false,
      sketch: 'sk_tooth',
      axis: { kind: 'face', name: 'non_existent_face' },
      op: 'cut',
      pitch: '2.5',
      starts: '1',
      hand: 'right',
      length: '6',
    };

    const doc = build(boreSketch, revolveBore, tooth, badAxisThread);
    const r = rebuild(doc);
    expect(r.features.find((f) => f.id === 'th1')?.status).toBe('error');
  });

  it('boss thread adds material to an outer cylinder and fuses into a single valid solid', () => {
    // Outer cylinder r=4.0, length 12 along Y
    const cylSketch = sketch(
      'sk_cyl',
      front,
      parts(
        point('cp1', 0, 0), point('cp2', 4.0, 0), point('cp3', 4.0, 12), point('cp4', 0, 12),
        line('cl1', 'cp1', 'cp2'), line('cl2', 'cp2', 'cp3'), line('cl3', 'cp3', 'cp4'), line('cl4', 'cp4', 'cp1'),
        point('ax1', 0, 0), point('ax2', 0, 12),
        line('axis', 'ax1', 'ax2', true),
      ),
    );
    const revolveCyl: Feature = {
      id: 'rv_cyl',
      type: 'revolve',
      name: 'rv_cyl',
      suppressed: false,
      sketch: 'sk_cyl',
      axis: 'axis',
      op: 'boss',
      dir1: { type: 'blind', angle: '360deg' },
    };
    // Tooth outside r=4.0
    const tooth = sketch('sk_tooth', front, toothProfile('t', 4.0, 2.0, 1.2, 0.8));
    const threadFeat: ThreadFeature = {
      id: 'th1',
      type: 'thread',
      name: 'th1',
      suppressed: false,
      sketch: 'sk_tooth',
      axis: { kind: 'face', name: 'rv_cyl:side:sk_cyl.cl2' }, // outer cylinder face
      op: 'boss',
      pitch: '2.0',
      starts: '1',
      hand: 'right',
      length: '8',
    };

    const doc = build(cylSketch, revolveCyl, tooth, threadFeat);
    const r = rebuild(doc);
    expect(failures(r)).toEqual([]);
    expect(r.bodies.length).toBe(1);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(kernel.solidCount(r.body!.shape)).toBe(1);

    const vCylOnly = Math.PI * 4.0 * 4.0 * 12;
    expect(volume(r)).toBeGreaterThan(vCylOnly);
  });

  it('parameters driven by expressions and part variables evaluate and regenerate correctly', () => {
    const boreSketch = sketch(
      'sk_bore',
      front,
      parts(
        point('bp1', 3.6, 0), point('bp2', 7.0, 0), point('bp3', 7.0, 12), point('bp4', 3.6, 12),
        line('bl1', 'bp1', 'bp2'), line('bl2', 'bp2', 'bp3'), line('bl3', 'bp3', 'bp4'), line('bl4', 'bp4', 'bp1'),
        point('ax1', 0, 0), point('ax2', 0, 12),
        line('axis', 'ax1', 'ax2', true),
      ),
    );
    const revolveBore: Feature = {
      id: 'rv_bore',
      type: 'revolve',
      name: 'rv_bore',
      suppressed: false,
      sketch: 'sk_bore',
      axis: 'axis',
      op: 'boss',
      dir1: { type: 'blind', angle: '360deg' },
    };
    const tooth = sketch('sk_tooth', front, toothProfile('t', 3.6, 2.0, 1.5, 1.0));
    const threadFeat: ThreadFeature = {
      id: 'th1',
      type: 'thread',
      name: 'th1',
      suppressed: false,
      sketch: 'sk_tooth',
      axis: { kind: 'face', name: 'rv_bore:side:sk_bore.bl4' },
      op: 'cut',
      pitch: 'p_pitch',
      starts: 'p_starts',
      hand: 'right',
      length: 'p_len * 2',
    };

    let doc = build(boreSketch, revolveBore, tooth);
    doc = applyCommand(doc, { type: 'addVariable', variable: { id: 'v1', name: 'p_pitch', expr: '2.5' } });
    doc = applyCommand(doc, { type: 'addVariable', variable: { id: 'v2', name: 'p_starts', expr: '1' } });
    doc = applyCommand(doc, { type: 'addVariable', variable: { id: 'v3', name: 'p_len', expr: '3.5' } });
    doc = applyCommand(doc, { type: 'insertFeature', feature: threadFeat, index: 3 });

    const r = rebuild(doc);
    expect(failures(r)).toEqual([]);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(kernel.solidCount(r.body!.shape)).toBe(1);
  });

  it('serializes to JSON and round-trips with Schema 53+, migrating Schema 52 cleanly', () => {
    const boreSketch = sketch('sk_bore', front, parts(point('p1', 0, 0)));
    const doc = build(boreSketch);
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);

    // Round-trip
    const serialized = serializePart(doc);
    const parsed = parsePart(serialized);
    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION);

    // Schema 52 migration test
    const v52Json = JSON.stringify({ ...doc, schemaVersion: 52 });
    const migrated = parsePart(v52Json);
    expect(migrated.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('saving to JSON and reading back yields identical rebuild volume (< 1e-9 error) and identical face names', () => {
    const boreSketch = sketch(
      'sk_bore',
      front,
      parts(
        point('bp1', 3.6, 0), point('bp2', 7.0, 0), point('bp3', 7.0, 12), point('bp4', 3.6, 12),
        line('bl1', 'bp1', 'bp2'), line('bl2', 'bp2', 'bp3'), line('bl3', 'bp3', 'bp4'), line('bl4', 'bp4', 'bp1'),
        point('ax1', 0, 0), point('ax2', 0, 12),
        line('axis', 'ax1', 'ax2', true),
      ),
    );
    const revolveBore: Feature = {
      id: 'rv_bore',
      type: 'revolve',
      name: 'rv_bore',
      suppressed: false,
      sketch: 'sk_bore',
      axis: 'axis',
      op: 'boss',
      dir1: { type: 'blind', angle: '360deg' },
    };
    const tooth = sketch('sk_tooth', front, toothProfile('t', 3.6, 2.0, 1.5, 1.0));
    const threadFeat: ThreadFeature = {
      id: 'th1',
      type: 'thread',
      name: 'th1',
      suppressed: false,
      sketch: 'sk_tooth',
      axis: { kind: 'face', name: 'rv_bore:side:sk_bore.bl4' },
      op: 'cut',
      pitch: '2.5',
      starts: '2',
      hand: 'right',
      length: '8',
    };

    const doc = build(boreSketch, revolveBore, tooth, threadFeat);
    const r1 = rebuild(doc);
    const v1 = volume(r1);

    const json = serializePart(doc);
    const loadedDoc = parsePart(json);
    const r2 = rebuild(loadedDoc);
    const v2 = volume(r2);

    expect(Math.abs(v1 - v2) / v1).toBeLessThan(1e-9);
    expect(r2.body!.names.faces).toEqual(r1.body!.names.faces);
  });
});
