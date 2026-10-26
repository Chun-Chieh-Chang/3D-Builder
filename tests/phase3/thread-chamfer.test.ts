/** Native investigation of threaded-bore chamfers. The multi-edge refusal is a known limitation, not a claimed repair. */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { Kernel, type Frame, type Region, type ShapeId } from '@3db/kernel';
import { applyCommand, parsePart, serializePart, type ChamferFeature } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Regenerator } from '@3db/regen';
import { build, front, line, rectangle, revolve, sketch, statuses } from '../phase1/builders';

const frame: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 0, 1], normal: [0, -1, 0] };
const axis = { origin: [0, 0, 0] as [number, number, number], dir: [0, 0, 1] as [number, number, number] };
const region = (points: [number, number][]): Region => ({
  outer: points.map((a, i) => ({ kind: 'line', a, b: points[(i + 1) % points.length]!, source: `profile:${i}` })), holes: [],
});
let kernel: Kernel;
const kept: ShapeId[] = [];
const keep = (shape: ShapeId) => { kept.push(shape); return shape; };
let tube: ShapeId, tool: ShapeId, threaded: ShapeId;
beforeAll(async () => {
  kernel = await Kernel.load();
  tube = keep(kernel.revolve(frame, [region([[3.6, 0], [7, 0], [7, 12], [3.6, 12]])], axis, 2 * Math.PI).shape);
  tool = keep(kernel.thread(frame, [region([[3.5, -0.75], [4.3, -0.35], [4.3, 0.35], [3.5, 0.75]])], {
    axis, pitch: 2.5, starts: 1, hand: 'right', from: 0, to: 8,
  }).shape);
  threaded = keep(kernel.boolean('cut', tube, tool).shape);
  expect(kernel.isValid(threaded)).toBe(true);
  expect(kernel.solidCount(threaded)).toBe(1);
});
afterAll(() => { for (const shape of kept.reverse()) kernel.release(shape); });
const rim = (shape: ShapeId) => {
  const topo = kernel.topology(shape);
  const face = topo.faces.findIndex(f => f.surface === 'plane' && Math.abs(f.center[2]) < 1e-6);
  expect(face).toBeGreaterThanOrEqual(0);
  return topo.edges.flatMap((e, edge) => e.faces.includes(face) ? [{ edge, face, info: e }] : []);
};

for (const mode of ['distanceDistance', 'angleDistance'] as const) it(`chamfers the outer rim after a real thread (${mode}), with analytic material removal`, () => {
  const edge = rim(threaded).find(e => e.info.curve === 'circle' && Math.abs(Math.hypot(...e.info.mid.slice(0, 2)) - 7) < 1e-6);
  expect(edge).toBeDefined();
  const d = 0.2;
  const result = kernel.chamfer(threaded, [edge!], mode, d, mode === 'distanceDistance' ? d : Math.PI / 4);
  const out = keep(result.shape);
  expect(kernel.isValid(out)).toBe(true);
  expect(kernel.solidCount(out)).toBe(1);
  // Triangular section, revolved about z: A=d²/2, centroid radius R-d/3.
  expect(kernel.massProps(threaded).volume - kernel.massProps(out).volume).toBeCloseTo(Math.PI * d ** 2 * (7 - d / 3), 5);
  expect(result.faceOrigins).toHaveLength(kernel.topology(out).faces.length);
});

it('chamfers a B-spline entrance edge after threading without blanket rejection of thread geometry', () => {
  const edge = rim(threaded).find(e => e.info.curve === 'bsplinecurve');
  expect(edge).toBeDefined();
  const out = keep(kernel.chamfer(threaded, [edge!], 'distanceDistance', 0.2, 0.2).shape);
  expect(kernel.isValid(out)).toBe(true);
  expect(kernel.solidCount(out)).toBe(1);
  expect(kernel.massProps(out).volume).toBeLessThan(kernel.massProps(threaded).volume);
  const points: [number, number, number][] = [[6, 0, 6], [0, 0, 6], [8, 0, 6]];
  expect(kernel.classify(out, points)).toEqual(['in', 'out', 'out']);
});

it('records the unsupported simultaneous threaded inner rim, preserves the input, and verifies chamfer-before-thread', () => {
  const inner = rim(threaded).filter(e => Math.hypot(...e.info.mid.slice(0, 2)) < 5);
  expect(inner.length).toBeGreaterThan(1);
  const before = kernel.massProps(threaded).volume;
  expect(() => kernel.chamfer(threaded, inner, 'distanceDistance', 0.2, 0.2)).toThrow(/導角|chamfer/i);
  expect(kernel.isValid(threaded)).toBe(true);
  expect(kernel.massProps(threaded).volume).toBe(before);

  // Deliberately change operation order, never silently substitute a conical cut for the requested edge chamfer.
  const plainInner = rim(tube).find(e => e.info.curve === 'circle' && Math.abs(Math.hypot(...e.info.mid.slice(0, 2)) - 3.6) < 1e-6);
  expect(plainInner).toBeDefined();
  const entrance = keep(kernel.chamfer(tube, [plainInner!], 'distanceDistance', 0.2, 0.2).shape);
  expect(kernel.classify(entrance, [[-3.65, 0, 0.02], [-3.85, 0, 0.02]])).toEqual(['out', 'in']);
  const cut = keep(kernel.boolean('cut', entrance, tool).shape);
  expect(kernel.isValid(cut)).toBe(true);
  expect(kernel.solidCount(cut)).toBe(1);
  expect(kernel.classify(cut, [[-3.65, 0, 0.02], [6, 0, 6], [0, 0, 6]])).toEqual(['out', 'in', 'out']);
  const imported = keep(kernel.importStep(kernel.exportStep(cut)).shape);
  expect(kernel.isValid(imported)).toBe(true);
  expect(kernel.solidCount(imported)).toBe(1);
  expect(kernel.massProps(imported).volume).toBeCloseTo(kernel.massProps(cut).volume, 5);
});

for (const target of ['outer-edge-default', 'back-face-default', 'spline-edge-small', 'front-face-error'] as const) it(`rebuilds persistent model references after a thread: ${target}`, async () => {
  const solver = await PlaneGcsSolver.create();
  const regen = new Regenerator(kernel, solver, new Map());
  const doc = build(
    sketch('wall', front, rectangle('w', 3.6, 0, 3.4, 12), line('axis', 0, 0, 0, 12, true)),
    revolve('tube', 'wall', 'axis'),
    sketch('tooth', front, { entities: [
      { id: 't1', type: 'point', x: 3.5, y: -0.75 }, { id: 't2', type: 'point', x: 4.3, y: -0.35 },
      { id: 't3', type: 'point', x: 4.3, y: 0.35 }, { id: 't4', type: 'point', x: 3.5, y: 0.75 },
      { id: 'l1', type: 'line', p1: 't1', p2: 't2' }, { id: 'l2', type: 'line', p1: 't2', p2: 't3' },
      { id: 'l3', type: 'line', p1: 't3', p2: 't4' }, { id: 'l4', type: 'line', p1: 't4', p2: 't1' },
    ], constraints: [] }),
    { id: 'thread', type: 'thread', name: 'thread', suppressed: false, sketch: 'tooth', axis: { kind: 'datum', name: 'axis:y' }, op: 'cut', pitch: '2.5', starts: '1', hand: 'right', length: '8' },
  );
  try {
    const base = regen.rebuild(doc);
    expect(statuses(base)).toEqual(['wall=ok', 'tube=ok', 'tooth=ok', 'thread=ok']);
    const body = base.body!;
    expect(kernel.isValid(body.shape)).toBe(true);
    const end = body.topology.faces.findIndex(f => f.surface === 'plane' && Math.abs(f.center[1] - (target === 'back-face-default' ? 12 : 0)) < 1e-6);
    expect(end).toBeGreaterThanOrEqual(0);
    const edge = body.topology.edges.findIndex(e => e.faces.includes(end) && (target === 'spline-edge-small' ? e.curve === 'bsplinecurve' : e.curve === 'circle' && Math.abs(Math.hypot(e.mid[0], e.mid[2]) - 7) < 1e-6));
    expect(edge).toBeGreaterThanOrEqual(0);
    const f: ChamferFeature = {
      id: 'chamfer', type: 'chamfer', name: 'chamfer', suppressed: false,
      edges: target.endsWith('face-default') || target === 'front-face-error' ? [] : [{ kind: 'edge', name: body.names.edges[edge]! }],
      faces: target.endsWith('face-default') || target === 'front-face-error' ? [{ kind: 'face', name: body.names.faces[end]! }] : [],
      mode: 'angleDistance', distance: target === 'spline-edge-small' || target === 'front-face-error' ? '0.2' : '1', second: '45',
    };
    const changed = parsePart(serializePart(applyCommand(doc, { type: 'insertFeature', index: doc.features.length, feature: f })));
    const beforeVolume = kernel.massProps(body.shape).volume;
    const result = regen.rebuild(changed);
    if (target === 'front-face-error') {
      const failed = result.features.find(f => f.id === 'chamfer')!;
      expect(failed.status).toBe('error');
      expect(failed.unresolved ?? []).toEqual([]);
      expect(failed.message).toMatch(/錐孔|countersink/i);
      expect(failed.message).toMatch(/切螺紋|cut threads/i);
      expect(kernel.isValid(result.body!.shape)).toBe(true);
      expect(kernel.massProps(result.body!.shape).volume).toBe(beforeVolume);
      return;
    }
    expect(statuses(result).at(-1)).toBe('chamfer=ok');
    expect(kernel.isValid(result.body!.shape)).toBe(true);
    expect(kernel.solidCount(result.body!.shape)).toBe(1);
  } finally { regen.dispose(); }
});
