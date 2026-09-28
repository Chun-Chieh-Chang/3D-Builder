/**
 * Phase 0 acceptance (blueprint §3):
 *  ① the fillet stays on the same edge across 10 scripted variations
 *  ② STEP round-trips with identical volume (manual check in SolidWorks: see docs/phase0-verification.md)
 *  ③ rebuild of the demo part < 500 ms
 * plus the error-isolation, suppression, rollback and dependency behaviour the blueprint requires.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createDemoPart, type Command, type PartDoc } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { dependencies, descendants, Regenerator, type RebuildResult } from '@3db/regen';
import { exportPartStep } from '@3db/io';

let kernel: Kernel;
let regen: Regenerator;

beforeAll(async () => {
  kernel = await Kernel.load();
  regen = new Regenerator(kernel, await PlaneGcsSolver.create());
});

const FILLET_FACE = 'fillet1:fillet:{extrude1:cap:end|extrude1:side:sketch1.l2}';

function demo(w: number, h: number, d: number, r: number): PartDoc {
  const cmds: Command[] = [
    { type: 'setDimension', featureId: 'sketch1', constraintId: 'd1', value: String(w) },
    { type: 'setDimension', featureId: 'sketch1', constraintId: 'd2', value: String(h) },
    { type: 'setEndCondition', featureId: 'extrude1', dir: 'dir1', value: { type: 'blind', depth: String(d) } },
    { type: 'setFilletRadius', featureId: 'fillet1', value: String(r) },
  ];
  return cmds.reduce(applyCommand, createDemoPart());
}

const statusOf = (r: RebuildResult, id: string) => r.features.find((f) => f.id === id)!;

describe('Phase 0 acceptance', () => {
  it('rebuilds the demo part with every feature OK and the sketch fully defined', () => {
    const r = regen.rebuild(createDemoPart());
    expect(r.features.map((f) => f.status)).toEqual(['ok', 'ok', 'ok']);
    expect(statusOf(r, 'sketch1').sketch).toMatchObject({ status: 'fully', dof: 0 });
    expect(r.body!.names.faces).toContain(FILLET_FACE);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
  });

  // Top plane: sketch x → world X, sketch y → world −Z; extrude along +Y.
  // Line l2 lies at X = W, so the filleted edge is X = W, Y = D, running along Z.
  const variations: [number, number, number, number][] = [
    [10, 10, 5, 2],
    [12.5, 10, 5, 2],
    [15, 8, 5, 2],
    [17.5, 12, 6, 2],
    [20, 10, 5, 1],
    [22.5, 15, 7, 3],
    [25, 6, 4, 1.5],
    [27.5, 20, 10, 4],
    [30, 10, 5, 2],
    [30, 30, 30, 9],
  ];

  it.each(variations)('W=%s H=%s D=%s r=%s keeps the fillet on the same edge with exact volume', (w, h, d, r) => {
    const res = regen.rebuild(demo(w, h, d, r));
    expect(res.features.map((f) => f.status)).toEqual(['ok', 'ok', 'ok']);
    const body = res.body!;
    const i = body.names.faces.indexOf(FILLET_FACE);
    expect(i).toBeGreaterThanOrEqual(0);
    const face = body.topology.faces[i]!;
    expect(face.surface).toBe('cylinder');
    expect(face.center[0]).toBeGreaterThan(w - r);
    expect(face.center[0]).toBeLessThan(w);
    expect(face.center[1]).toBeGreaterThan(d - r);
    expect(face.center[1]).toBeLessThan(d);
    const expected = w * h * d - (1 - Math.PI / 4) * r * r * h;
    expect(kernel.massProps(body.shape).volume).toBeCloseTo(expected, 6);
  });

  it('round-trips STEP with identical volume', () => {
    const doc = demo(30, 10, 5, 2);
    const res = regen.rebuild(doc);
    const step = exportPartStep(kernel, res.body!.shape, doc);
    expect(step).toMatch(/^ISO-10303-21;/);
    expect(step).toContain("PRODUCT('行走骨架示範件'");
    expect(step).toMatch(/SI_UNIT\(\.MILLI\.,\.METRE\.\)/);
    const back = kernel.importStep(step).shape;
    try {
      const a = kernel.massProps(res.body!.shape).volume;
      const b = kernel.massProps(back).volume;
      expect(Math.abs(a - b) / a).toBeLessThan(1e-9);
    } finally {
      kernel.release(back);
    }
  });

  it('rebuilds the demo part in under 500 ms', () => {
    regen.rebuild(createDemoPart()); // warm-up
    const times = Array.from({ length: 5 }, () => regen.rebuild(createDemoPart()).totalMs);
    expect(Math.min(...times)).toBeLessThan(500);
  });
});

describe('Phase 0 behaviour', () => {
  it('isolates a missing reference: fillet errors with candidates, the extrude body survives', () => {
    const doc = applyCommand(createDemoPart(), {
      type: 'setEdges',
      featureId: 'fillet1',
      edges: [{ kind: 'edge', name: '{extrude1:cap:end|extrude1:side:sketch1.l9}', fingerprint: { type: 'line', size: 10, center: [20, 5, -5], dir: [0, 0, -1] } }],
    });
    const r = regen.rebuild(doc);
    const f = statusOf(r, 'fillet1');
    expect(f.status).toBe('error');
    expect(f.unresolved![0]!.candidates[0]!.name).toBe('{extrude1:cap:end|extrude1:side:sketch1.l2}');
    expect(kernel.massProps(r.body!.shape).volume).toBeCloseTo(1000, 6);
  });

  it('suppresses the fillet', () => {
    const r = regen.rebuild(applyCommand(createDemoPart(), { type: 'setSuppressed', featureIds: ['fillet1'], value: true }));
    expect(statusOf(r, 'fillet1').status).toBe('suppressed');
    expect(kernel.massProps(r.body!.shape).volume).toBeCloseTo(1000, 6);
  });

  it('honours the rollback bar and edit-session limits', () => {
    const r = regen.rebuild(applyCommand(createDemoPart(), { type: 'setRollback', index: 2 }));
    expect(statusOf(r, 'fillet1').status).toBe('rolledBack');
    const s = regen.rebuild(createDemoPart(), { until: 1 });
    expect(s.body).toBeNull();
    expect(statusOf(s, 'extrude1').status).toBe('rolledBack');
  });

  it('propagates an over-defined sketch as errors down the tree', () => {
    const doc = createDemoPart();
    const sketch = doc.features[0]!;
    if (sketch.type !== 'sketch') throw new Error('unexpected');
    const bad: PartDoc = {
      ...doc,
      features: [{ ...sketch, constraints: [...sketch.constraints, { id: 'bad', type: 'distance', a: 'p1', b: 'p3', value: '5' }] }, ...doc.features.slice(1)],
    };
    const r = regen.rebuild(bad);
    expect(r.features.map((f) => f.status)).toEqual(['error', 'error', 'error']);
    expect(statusOf(r, 'sketch1').sketch!.conflicting).toContain('bad');
    expect(r.body).toBeNull();
  });

  it('derives parent/child relations from references', () => {
    const deps = dependencies(createDemoPart());
    expect(deps.parents.get('extrude1')).toEqual(['sketch1']);
    expect(deps.parents.get('fillet1')).toEqual(['extrude1']);
    expect(descendants(deps, 'sketch1').sort()).toEqual(['extrude1', 'fillet1']);
  });

  it('does not leak kernel shapes across rebuilds', () => {
    regen.rebuild(createDemoPart());
    const before = kernel.liveShapes;
    for (let i = 0; i < 5; i++) regen.rebuild(demo(20 + i, 10, 5, 2));
    expect(kernel.liveShapes).toBe(before);
  });
});
