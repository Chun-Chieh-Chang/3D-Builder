/**
 * Phase 3a-4 (C5.2): variable-radius fillet. The radius evolves along a picked edge, interpolating
 * linearly between control points. Only edges picked directly (`edges`) can carry points; edges
 * worked out from faces take the constant radius.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, type Feature } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { build, edge, extrude, fillet, front, rectangle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const rebuild = (doc: Parameters<typeof Regenerator.prototype.rebuild>[0]) => new Regenerator(kernel, solver).rebuild(doc);
const ok = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));
const volume = (r: RebuildResult) => Math.round(kernel.massProps(r.body!.shape).volume * 1e6) / 1e6;
const add = (doc: ReturnType<typeof build>, ...features: Feature[]) => features.reduce((d, feature) => applyCommand(d, { type: 'insertFeature', feature, index: d.features.length }), doc);

/** A 40 × 30 × 12 block with its lower-left corner at the origin. */
const box = () => build(
  sketch('s1', front, rectangle('r1', 0, 0, 40, 30)),
  extrude('e1', 's1', 'boss', { type: 'blind', depth: '12' }),
);

describe('variable-radius fillet (C5.2)', () => {
  it('ramps radius linearly along a 40 mm edge', () => {
    const probe = rebuild(box());
    // Top edge running along x (length 40): z ≈ 12, direction along x.
    const i = probe.body!.topology.edges.findIndex((e) => e.curve === 'line' && e.length > 39.9 && e.length < 40.1 && e.mid[2] > 11.9 && Math.abs(e.dir![0]!) > 0.9);
    expect(i).toBeGreaterThanOrEqual(0);
    const edgeName = probe.body!.names.edges[i]!;
    const doc = add(box(), fillet('f1', [edge(edgeName)], '2', [
      { edge: edgeName, t: 0, radius: '2' },
      { edge: edgeName, t: 1, radius: '6' },
    ]));
    const r = rebuild(doc);
    expect(ok(r)).toEqual([]);
    // Hand-computed volume for (1−π/4)·r² removed along a 40 mm edge, r = 2→6:
    // ∫₀⁴⁰ (1−π/4)(2 + 0.1x)² dx = (1−π/4)·693⅓ ≈ 148.7906
    // 14400 − 148.7906 = 14251.2094
    expect(volume(r)).toBeCloseTo(14251.209393, 3);
  });

  it('rejects a control point on an edge the fillet did not pick', () => {
    const probe = rebuild(box());
    const edges = probe.body!.topology.edges;
    const names = probe.body!.names.edges;
    // Pick two different top edges: one along x (40 mm), one along y (30 mm).
    const i = edges.findIndex((e) => e.curve === 'line' && e.length > 39.9 && e.length < 40.1 && e.mid[2] > 11.9 && Math.abs(e.dir![0]!) > 0.9);
    const j = edges.findIndex((e) => e.curve === 'line' && e.length > 29.9 && e.length < 30.1 && e.mid[2] > 11.9 && Math.abs(e.dir![1]!) > 0.9);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(j).toBeGreaterThanOrEqual(0);
    const picked = names[i]!;
    const other = names[j]!;
    const doc = add(box(), fillet('f1', [edge(picked)], '2', [
      { edge: other, t: 0, radius: '2' },
      { edge: other, t: 1, radius: '6' },
    ]));
    const r = rebuild(doc);
    expect(r.features.find((f) => f.id === 'f1')).toMatchObject({ status: 'error', message: expect.stringContaining('只能綁在這個圓角揀選的邊線上') });
  });

  it('rejects a negative radius', () => {
    const probe = rebuild(box());
    const i = probe.body!.topology.edges.findIndex((e) => e.curve === 'line' && e.length > 39.9 && e.length < 40.1 && e.mid[2] > 11.9 && Math.abs(e.dir![0]!) > 0.9);
    expect(i).toBeGreaterThanOrEqual(0);
    const edgeName = probe.body!.names.edges[i]!;
    const doc = add(box(), fillet('f1', [edge(edgeName)], '2', [
      { edge: edgeName, t: 0, radius: '-1' },
      { edge: edgeName, t: 1, radius: '2' },
    ]));
    const r = rebuild(doc);
    expect(r.features.find((f) => f.id === 'f1')).toMatchObject({ status: 'error', message: expect.stringContaining('大於 0') });
  });

  it('rejects missing endpoints (t = 0 or t = 1)', () => {
    const probe = rebuild(box());
    const i = probe.body!.topology.edges.findIndex((e) => e.curve === 'line' && e.length > 39.9 && e.length < 40.1 && e.mid[2] > 11.9 && Math.abs(e.dir![0]!) > 0.9);
    expect(i).toBeGreaterThanOrEqual(0);
    const edgeName = probe.body!.names.edges[i]!;
    const doc = add(box(), fillet('f1', [edge(edgeName)], '2', [
      { edge: edgeName, t: 0, radius: '2' },
      { edge: edgeName, t: 0.5, radius: '4' },
      // t = 1 is missing on purpose
    ]));
    const r = rebuild(doc);
    expect(r.features.find((f) => f.id === 'f1')).toMatchObject({ status: 'error', message: expect.stringContaining('位置 0 與 1') });
  });

  it('mixes a variable edge with a constant edge on the same body', () => {
    const probe = rebuild(box());
    const edges = probe.body!.topology.edges;
    const names = probe.body!.names.edges;
    // One 40 mm edge along x (variable) and one 30 mm edge along y (constant) both at the top.
    const i40 = edges.findIndex((e) => e.curve === 'line' && e.length > 39.9 && e.length < 40.1 && e.mid[2] > 11.9 && Math.abs(e.dir![0]!) > 0.9);
    const i30 = edges.findIndex((e) => e.curve === 'line' && e.length > 29.9 && e.length < 30.1 && e.mid[2] > 11.9 && Math.abs(e.dir![1]!) > 0.9);
    expect(i40).toBeGreaterThanOrEqual(0);
    expect(i30).toBeGreaterThanOrEqual(0);
    const e40 = names[i40]!;
    const e30 = names[i30]!;
    const doc = add(box(), fillet('f1', [edge(e40), edge(e30)], '2', [
      { edge: e40, t: 0, radius: '2' },
      { edge: e40, t: 1, radius: '6' },
    ]));
    const r = rebuild(doc);
    expect(ok(r)).toEqual([]);
    // Volume should be less than the constant-only fillet on both edges.
    const constantOnly = rebuild(add(box(), fillet('f2', [edge(e40), edge(e30)], '2')));
    expect(volume(r)).toBeLessThan(volume(constantOnly));
    // And greater than a constant fillet with radius 6 on both (the maximum variable reached).
    const maxConstant = rebuild(add(box(), fillet('f3', [edge(e40), edge(e30)], '6')));
    expect(volume(r)).toBeGreaterThan(volume(maxConstant));
  });
});
