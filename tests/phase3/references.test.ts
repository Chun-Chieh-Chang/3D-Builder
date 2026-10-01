/**
 * Phase 3a-4d (C1.18, C1.26): sketch entities that follow the model: the projection of an edge onto the sketch plane, a face's outline,
 * and the point where an edge pierces the plane. They are looked up by persistent name, so they follow the model when it changes
 * and say so when the edge is gone (ADR 0026).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, type Feature, type PartDoc, type PlaneFrame, type Ref, type SketchEntity, type SketchFeature } from '@3db/model';
import { edgeFingerprint } from '@3db/naming';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { convertEdges, faceEdges, projectEdge, Regenerator, type RebuildResult } from '@3db/regen';
import { build, extrude, front, rectangle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const rebuild = (doc: PartDoc) => new Regenerator(kernel, solver, new Map()).rebuild(doc);
const block = (): PartDoc => build(sketch('s1', front, rectangle('r', 0, 0, 20, 10)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }));

/** The edge of the block (as a persistent reference) whose midpoint is `at`, within a tolerance. */
function edgeAt(r: RebuildResult, at: [number, number, number]): Ref {
  const body = r.body!;
  const i = body.topology.edges.findIndex((e) => Math.hypot(e.mid[0] - at[0], e.mid[1] - at[1], e.mid[2] - at[2]) < 1e-6);
  expect(i, `an edge at ${at}`).toBeGreaterThanOrEqual(0);
  return { kind: 'edge', name: body.names.edges[i]!, fingerprint: edgeFingerprint(body.topology, i) };
}

/** Which way the block grew: its far face is at z = ±10. */
const depthSign = (r: RebuildResult) => (r.body!.topology.vertices.some((v) => Math.abs(v.point[2] - 10) < 1e-6) ? 1 : -1);

const onPlane = (frame: PlaneFrame, p: [number, number, number]): [number, number] => {
  const d = [p[0] - frame.origin[0], p[1] - frame.origin[1], p[2] - frame.origin[2]] as const;
  return [d[0] * frame.xDir[0] + d[1] * frame.xDir[1] + d[2] * frame.xDir[2], d[0] * frame.yDir[0] + d[1] * frame.yDir[1] + d[2] * frame.yDir[2]];
};

const refSketch = (id: string, entities: SketchEntity[]): SketchFeature => ({ id, type: 'sketch', name: id, suppressed: false, plane: front, entities, constraints: [] });
const pt = (id: string, x = 0, y = 0): Extract<SketchEntity, { type: 'point' }> => ({ id, type: 'point', x, y });
const withSketch = (doc: PartDoc, f: Feature): PartDoc => applyCommand(doc, { type: 'insertFeature', feature: f, index: doc.features.length });
const geometry = (r: RebuildResult, sketchId: string, id: string) => r.sketches.get(sketchId)!.solved.geometry.get(id)!;
const failures = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));

describe('projected edges (C1.18)', () => {
  it('an edge in the sketch plane is a line where it is, fully defined, and one far above it projects onto the same place', () => {
    const r0 = rebuild(block());
    const sign = depthSign(r0);
    const near = edgeAt(r0, [10, 0, 0]);
    const far = edgeAt(r0, [10, 0, 10 * sign]);
    const doc = withSketch(block(), refSketch('s2', [pt('a'), pt('b'), { id: 'n', type: 'line', p1: 'a', p2: 'b', ref: near }, pt('c'), pt('d'), { id: 'f', type: 'line', p1: 'c', p2: 'd', ref: far }]));
    const r = rebuild(doc);
    expect(failures(r)).toEqual([]);
    const frame = r.frames.get('s2')!;
    for (const id of ['n', 'f']) {
      const g = geometry(r, 's2', id);
      expect(g.type).toBe('line');
      if (g.type === 'line') {
        const [x0, x1] = [Math.min(g.a[0], g.b[0]), Math.max(g.a[0], g.b[0])];
        expect([x0, x1].map((v) => Math.round(Math.abs(v) * 1e6) / 1e6).sort((p, q) => p - q)[1]).toBeGreaterThan(19.99);
        expect(Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1])).toBeCloseTo(20, 6);
      }
    }
    expect(r.sketches.get('s2')!.solved.status).toBe('fully');
    expect(r.sketches.get('s2')!.solved.dof).toBe(0);
    expect(frame.normal).toBeDefined();
  });

  it('follows the model: widen the block and the projected edge gets longer, with nothing lost', () => {
    const r0 = rebuild(block());
    const doc0 = withSketch(block(), refSketch('s2', [pt('a'), pt('b'), { id: 'n', type: 'line', p1: 'a', p2: 'b', ref: edgeAt(r0, [10, 0, 0]) }]));
    const doc = applyCommand(doc0, { type: 'setDimension', featureId: 's1', constraintId: 'rw', value: '35' });
    const r = rebuild(doc);
    expect(failures(r)).toEqual([]);
    const g = geometry(r, 's2', 'n');
    expect(g.type === 'line' && Math.hypot(g.b[0] - g.a[0], g.b[1] - g.a[1])).toBeCloseTo(35, 6);
  });

  it('an edge perpendicular to the plane, an unknown edge and a model that is not there are the sketch\'s errors, each saying so', () => {
    const r0 = rebuild(block());
    const sign = depthSign(r0);
    const upright = edgeAt(r0, [0, 0, 5 * sign]);
    const bad = rebuild(withSketch(block(), refSketch('s2', [pt('a'), pt('b'), { id: 'n', type: 'line', p1: 'a', p2: 'b', ref: upright }])));
    expect(failures(bad)).toEqual([expect.stringContaining('垂直於草圖面')]);
    const lost = rebuild(withSketch(block(), refSketch('s2', [pt('a'), pt('b'), { id: 'n', type: 'line', p1: 'a', p2: 'b', ref: { kind: 'edge', name: 'gone', fingerprint: { type: 'line', size: 1, center: [0, 0, 0] } } }])));
    expect(failures(lost)[0]).toContain('遺失參考');
    expect(lost.features.find((f) => f.id === 's2')!.unresolved).toHaveLength(1);
    const none = rebuild(build(refSketch('s2', [pt('a'), pt('b'), { id: 'n', type: 'line', p1: 'a', p2: 'b', ref: upright }])));
    expect(failures(none)[0]).toContain('沒有可以引用的模型');
  });

  it('the outline of a face becomes entities that make a profile: extruding it adds 20 × 10 × 5', () => {
    const r0 = rebuild(block());
    const sign = depthSign(r0);
    const faceIndex = r0.body!.topology.faces.findIndex((f) => f.normal && Math.abs(f.center[2] - 10 * sign) < 1e-6);
    const face: Ref = { kind: 'face', name: r0.body!.names.faces[faceIndex]! };
    const scope = { names: r0.body!.names, topology: r0.body!.topology };
    const edges = faceEdges(scope, face, (i) => edgeFingerprint(r0.body!.topology, i));
    expect(edges).toHaveLength(4);
    // a sketch on that face, with its four edges as entities sharing their corners
    const frame = (rebuild(withSketch(block(), { ...refSketch('s2', []), plane: { ...face, fingerprint: undefined } as Ref })).frames.get('s2'))!;
    expect(frame).toBeDefined();
    const converted = convertEdges({ ...scope, frame }, edges, 'convert');
    expect(converted.errors).toEqual([]);
    expect(converted.items).toHaveLength(4);
    const points: SketchEntity[] = [];
    const lines: SketchEntity[] = [];
    const at = (p: [number, number]): string => {
      const found = points.find((q) => q.type === 'point' && Math.hypot(q.x - p[0], q.y - p[1]) < 1e-6);
      if (found) return found.id;
      points.push(pt(`p${points.length}`, p[0], p[1]));
      return points.at(-1)!.id;
    };
    for (const [i, c] of converted.items.entries()) {
      if (!('projected' in c) || c.projected.kind !== 'line') throw new Error('expected lines');
      lines.push({ id: `l${i}`, type: 'line', p1: at(c.projected.a), p2: at(c.projected.b), ref: c.ref });
    }
    const doc = withSketch(block(), { ...refSketch('s2', [...points, ...lines]), plane: face });
    const boss = extrude('e2', 's2', 'boss', { type: 'blind', depth: '5' });
    const r = rebuild(applyCommand(doc, { type: 'insertFeature', feature: boss, index: doc.features.length }));
    expect(failures(r)).toEqual([]);
    expect(kernel.massProps(r.body!.shape).volume).toBeCloseTo(20 * 10 * 15, 6);
    expect(r.sketches.get('s2')!.solved.status).toBe('fully');
  });
});

describe('pierce points (C1.26)', () => {
  it('a point where a straight edge passes through the sketch plane, held there and following the model', () => {
    const r0 = rebuild(block());
    const sign = depthSign(r0);
    const upright = edgeAt(r0, [20, 0, 5 * sign]);
    const doc = withSketch(block(), refSketch('s2', [{ ...pt('a', 3, 3), pierce: upright }]));
    const r = rebuild(doc);
    expect(failures(r)).toEqual([]);
    const frame = r.frames.get('s2')!;
    const g = geometry(r, 's2', 'a');
    const expected = onPlane(frame, [20, 0, 0]);
    expect(g.type === 'point' && g.p[0]).toBeCloseTo(expected[0], 6);
    expect(g.type === 'point' && g.p[1]).toBeCloseTo(expected[1], 6);
    // widen the block: the edge moves, and so does the point
    const wider = rebuild(applyCommand(doc, { type: 'setDimension', featureId: 's1', constraintId: 'rw', value: '35' }));
    const g2 = geometry(wider, 's2', 'a');
    const moved = onPlane(wider.frames.get('s2')!, [35, 0, 0]);
    expect(g2.type === 'point' && g2.p[0]).toBeCloseTo(moved[0], 6);
    expect(r.sketches.get('s2')!.solved.status).toBe('fully');
  });

  it('an edge lying in the plane or parallel to it has no pierce point', () => {
    const r0 = rebuild(block());
    const bad = rebuild(withSketch(block(), refSketch('s2', [{ ...pt('a'), pierce: edgeAt(r0, [10, 0, 0]) }])));
    expect(failures(bad)[0]).toContain('平行');
  });
});

describe('projecting arcs and circles (C1.18)', () => {
  const frame: PlaneFrame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
  const topology = (curve: Record<string, unknown>, vertices: [number, number, number][], mid: [number, number, number]) =>
    ({
      faces: [],
      vertices: vertices.map((point) => ({ point, faces: [] })),
      edges: [{ curve: 'circle', length: 1, mid, dir: null, faces: [], vertices: vertices.map((_, i) => i), geometry: { type: 'circle', center: [1, 2, 7], normal: [0, 0, 1], radius: 3, ...curve } }],
    }) as never;

  it('a full circle is a circle, a quarter is an arc counter-clockwise from the end that comes first, whichever way the edge is oriented', () => {
    expect(projectEdge(topology({}, [[4, 2, 7]], [-2, 2, 7]), 0, frame)).toEqual({ kind: 'circle', c: [1, 2], r: 3 });
    const quarter = projectEdge(topology({}, [[4, 2, 7], [1, 5, 7]], [1 + 3 * Math.SQRT1_2, 2 + 3 * Math.SQRT1_2, 7]), 0, frame);
    expect(quarter).toEqual({ kind: 'arc', c: [1, 2], r: 3, start: [4, 2], end: [1, 5] });
    // the same quarter listed from its other end: the arc still runs from (4, 2) to (1, 5) counter-clockwise
    const backwards = projectEdge(topology({}, [[1, 5, 7], [4, 2, 7]], [1 + 3 * Math.SQRT1_2, 2 + 3 * Math.SQRT1_2, 7]), 0, frame);
    expect(backwards).toEqual({ kind: 'arc', c: [1, 2], r: 3, start: [4, 2], end: [1, 5] });
    // the long way round
    const long = projectEdge(topology({}, [[4, 2, 7], [1, 5, 7]], [1 - 3 * Math.SQRT1_2, 2 - 3 * Math.SQRT1_2, 7]), 0, frame);
    expect(long).toEqual({ kind: 'arc', c: [1, 2], r: 3, start: [1, 5], end: [4, 2] });
  });

  it('refuses a circle that is not parallel to the plane (it would be an ellipse)', () => {
    expect(() => projectEdge(topology({ normal: [1, 0, 0] }, [[4, 2, 7]], [-2, 2, 7]), 0, frame)).toThrow('橢圓');
  });
});
