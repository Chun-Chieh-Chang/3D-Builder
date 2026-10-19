/**
 * A sketch point that follows a model vertex (G2, ADR 0171). The model is a cone turned about the front sketch's vertical axis (ADR 0170), seen from the
 * right plane: its apex (0, h, 0) and the point where the seam meets the base (10, 0, 0) are vertices no snap item reached before (the base circle is
 * tilted to that plane, the seam is left out as a seam), so they are snapped to, converted and followed as points of their own. Seen from the front
 * plane the seam lies in it, and its ends are already corners: nothing more is offered. Truth by hand: the projections of those two points.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, mapRefs, parsePart, SCHEMA_VERSION, serializePart, sketchError, SKETCH_AXIS_V, type Feature, type PartDoc, type Ref, type SketchEntity, type SketchFeature } from '@3db/model';
import { edgeFingerprint } from '@3db/naming';
import { PlaneGcsSolver } from '@3db/sketch';
import { anchorModel, referenceEntities } from '@3db/sketch/ops';
import { IdAllocator } from '@3db/model';
import { Kernel } from '@3db/kernel';
import { convertEdges, modelSnapItems, Regenerator, type SnapItem } from '@3db/regen';
import { build, front, revolve, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

/** A right triangle (0, 0), (10, 0), (0, h) on the front plane, every corner fixed, turned 360° about the sketch's vertical axis: a cone, apex up. */
const triangle = (h: number): Feature =>
  sketch('s1', front, {
    entities: [
      { id: 'a', type: 'point', x: 0, y: 0 },
      { id: 'b', type: 'point', x: 10, y: 0 },
      { id: 'c', type: 'point', x: 0, y: h },
      { id: 'ab', type: 'line', p1: 'a', p2: 'b' },
      { id: 'bc', type: 'line', p1: 'b', p2: 'c' },
      { id: 'ca', type: 'line', p1: 'c', p2: 'a' },
    ],
    constraints: [
      { id: 'fa', type: 'fix', point: 'a' },
      { id: 'fb', type: 'fix', point: 'b' },
      { id: 'fc', type: 'fix', point: 'c' },
    ],
  } as never);
const right: Ref = { kind: 'datum', name: 'plane:right' };
const cone = (h: number, plane: Ref = right): PartDoc => build(triangle(h), revolve('r1', 's1', SKETCH_AXIS_V), sketch('s3', plane));
const regen = () => new Regenerator(kernel, solver, new Map());

function seenFrom(doc: PartDoc) {
  const r = regen().rebuild(doc, { until: doc.features.findIndex((f) => f.id === 's3') });
  if (!r.body) throw new Error('no body: ' + statuses(r).join(' '));
  const scope = { names: r.body.names, topology: r.body.topology, frame: r.frames.get('s3')! };
  return { r, scope, items: modelSnapItems(scope, (i) => edgeFingerprint(scope.topology, i)) };
}
const vertexItems = (items: SnapItem[]) => items.filter((i): i is Extract<SnapItem, { vertex: unknown }> => 'vertex' in i);
const near = (p: [number, number], x: number, y: number) => Math.hypot(p[0] - x, p[1] - y) < 1e-6;
/** A model point in the sketch's own coordinates (the frame of s3). */
function onPlane(doc: PartDoc, p: [number, number, number]): [number, number] {
  const f = seenFrom(doc).scope.frame;
  const d = [p[0] - f.origin[0], p[1] - f.origin[1], p[2] - f.origin[2]];
  return [d[0]! * f.xDir[0] + d[1]! * f.xDir[1] + d[2]! * f.xDir[2], d[0]! * f.yDir[0] + d[1]! * f.yDir[1] + d[2]! * f.yDir[2]];
}

describe('model vertices the cursor could not reach before (ADR 0171)', () => {
  it('the apex is a snap item: a vertex ref at its projection, on the plane (off 0); the foot of the seam on the base circle is not (only a loop starts there)', () => {
    const doc = cone(20);
    const vs = vertexItems(seenFrom(doc).items);
    expect(vs, JSON.stringify(vs.map((i) => i.vertex))).toHaveLength(1);
    const apex = vs[0]!;
    expect(near(apex.vertex, ...onPlane(doc, [0, 20, 0]))).toBe(true);
    expect(apex.ref.kind).toBe('vertex');
    expect(apex.off).toBeCloseTo(0, 9);
    expect(apex.ref.fingerprint).toBeDefined();
  });

  it('a plate with a hole through it: the seam vertex on the rim of the hole is not offered', () => {
    const doc = build(
      sketch('s1', front, { entities: [{ id: 'a', type: 'point', x: 0, y: 0 }, { id: 'b', type: 'point', x: 40, y: 0 }, { id: 'c', type: 'point', x: 40, y: 30 }, { id: 'd', type: 'point', x: 0, y: 30 }, { id: 'ab', type: 'line', p1: 'a', p2: 'b' }, { id: 'bc', type: 'line', p1: 'b', p2: 'c' }, { id: 'cd', type: 'line', p1: 'c', p2: 'd' }, { id: 'da', type: 'line', p1: 'd', p2: 'a' }, { id: 'o', type: 'point', x: 20, y: 15 }, { id: 'h', type: 'circle', center: 'o', radius: 5 }], constraints: ['a', 'b', 'c', 'd', 'o'].map((p) => ({ id: `f${p}`, type: 'fix', point: p })) } as never),
      { id: 'e1', type: 'extrude', name: 'e1', suppressed: false, sketch: 's1', op: 'boss', dir1: { type: 'blind', depth: '10' } } as Feature,
      sketch('s3', { kind: 'datum', name: 'plane:top' }),
    );
    expect(vertexItems(seenFrom(doc).items)).toEqual([]);
  });

  it('seen from the front plane the seam lies in it: its ends are corners already, so no vertex is offered twice', () => {
    expect(vertexItems(seenFrom(cone(20, front)).items)).toEqual([]);
  });

  it('a plate seen from its own face: every corner is the end of an edge in the plane, no vertex item at all', () => {
    // a 40 × 30 plate seen from its own face: every corner is the end of an edge in the plane, so no vertex item at all
    const { items } = seenFrom(
      build(
        sketch('s1', front, { entities: [{ id: 'a', type: 'point', x: 0, y: 0 }, { id: 'b', type: 'point', x: 40, y: 0 }, { id: 'c', type: 'point', x: 40, y: 30 }, { id: 'd', type: 'point', x: 0, y: 30 }, { id: 'ab', type: 'line', p1: 'a', p2: 'b' }, { id: 'bc', type: 'line', p1: 'b', p2: 'c' }, { id: 'cd', type: 'line', p1: 'c', p2: 'd' }, { id: 'da', type: 'line', p1: 'd', p2: 'a' }], constraints: ['a', 'b', 'c', 'd'].map((p) => ({ id: `f${p}`, type: 'fix', point: p })) } as never),
        { id: 'e1', type: 'extrude', name: 'e1', suppressed: false, sketch: 's1', op: 'boss', dir1: { type: 'blind', depth: '10' } } as Feature,
        sketch('s3', front),
      ),
    );
    expect(vertexItems(items)).toEqual([]);
  });
});

describe('a point that follows a vertex', () => {
  const apexRef = (doc: PartDoc): Ref => vertexItems(seenFrom(doc).items).find((i) => near(i.vertex, ...onPlane(doc, [0, 20, 0])))!.ref;

  it('「轉換實體引用」 of a vertex gives a point there; a pierce of a vertex is refused', () => {
    const { scope } = seenFrom(cone(20));
    const ref = apexRef(cone(20));
    const r = convertEdges(scope, [ref], 'convert');
    expect(r.errors).toEqual([]);
    expect(r.items).toHaveLength(1);
    expect('vertex' in r.items[0]! && near(r.items[0].vertex, ...onPlane(cone(20), [0, 20, 0]))).toBe(true);
    expect(convertEdges(scope, [ref], 'pierce').items).toEqual([]);
  });

  it('follows the apex when the cone grows taller: (0, 20) → (0, 25), and the sketch stays solved', () => {
    const ref = apexRef(cone(20));
    const point: SketchEntity = { id: 'v', type: 'point', x: 0, y: 20, ref };
    const at = (h: number) => {
      const r = regen().rebuild(build(triangle(h), revolve('r1', 's1', SKETCH_AXIS_V), sketch('s3', right, { entities: [point], constraints: [] } as never)));
      expect(statuses(r)).toEqual(['s1=ok', 'r1=ok', 's3=ok']);
      const g = r.sketches.get('s3')!.solved.geometry.get('v');
      return g?.type === 'point' ? g.p : null;
    };
    expect(near(at(20)!, ...onPlane(cone(20), [0, 20, 0]))).toBe(true);
    expect(near(at(25)!, ...onPlane(cone(25), [0, 25, 0]))).toBe(true);
    expect(near(at(25)!, ...onPlane(cone(20), [0, 20, 0]))).toBe(false); // it did move
  });

  it('a point follows one model element of the right kind only', () => {
    const vertex: Ref = { kind: 'vertex', name: 'x' };
    const edge: Ref = { kind: 'edge', name: 'y' };
    expect(sketchError({ entities: [{ id: 'v', type: 'point', x: 0, y: 0, ref: vertex }], constraints: [] })).toBeNull();
    expect(sketchError({ entities: [{ id: 'v', type: 'point', x: 0, y: 0, ref: edge }], constraints: [] })).toMatch(/v/);
    expect(sketchError({ entities: [{ id: 'v', type: 'point', x: 0, y: 0, ref: vertex, pierce: edge }], constraints: [] })).toMatch(/v/);
  });

  it('repairing references rewrites a vertex point too (mapRefs)', () => {
    const f = { id: 's3', type: 'sketch', name: 's3', suppressed: false, plane: front, entities: [{ id: 'v', type: 'point', x: 0, y: 0, ref: { kind: 'vertex', name: 'old' } }], constraints: [] } as SketchFeature;
    const r = mapRefs(f, (ref) => (ref.name === 'old' ? { ...ref, name: 'new' } : ref));
    expect(r.replaced).toBe(1);
    expect(((r.feature as SketchFeature).entities[0] as { ref: Ref }).ref.name).toBe('new');
  });

  it('converting the same vertex twice adds nothing; snapping to it reuses the point', () => {
    const ref: Ref = { kind: 'vertex', name: 'apex' };
    const item = { ref, vertex: [0, 20] as [number, number] };
    const ids = new IdAllocator({}, []);
    const first = referenceEntities({ entities: [] }, ids, [item]);
    if ('error' in first) throw new Error(first.error);
    const made = first.edit.add!.entities!;
    expect(made).toEqual([expect.objectContaining({ type: 'point', x: 0, y: 20, ref })]);
    expect(referenceEntities({ entities: made }, ids, [item])).toHaveProperty('error');
    const maker = { ids, entities: [] as SketchEntity[], constraints: [] };
    expect(anchorModel({ entities: made }, new Map(), maker, item, 'vertex', [0, 20])).toBe(made[0]!.id);
    expect(maker.entities).toEqual([]);
  });

  it('is written as the current version (69 or later) and read back with its vertex', () => {
    const doc = applyCommand(cone(20), { type: 'addSketchItems', featureId: 's3', entities: [{ id: 'v', type: 'point', x: 0, y: 20, ref: { kind: 'vertex', name: 'apex' } }], constraints: [] });
    const file = serializePart(doc);
    expect(JSON.parse(file).schemaVersion).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(69);
    const back = parsePart(file).features.find((f) => f.id === 's3') as SketchFeature;
    expect(back.entities[0]).toMatchObject({ id: 'v', ref: { kind: 'vertex', name: 'apex' } });
  });
});
