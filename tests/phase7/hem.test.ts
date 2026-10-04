/**
 * 7-3 (docs/phase7-plan.md): the hem (C11.2) on a plate 100 × 50 × 1.5 (x 0..100, y 0..50, z 0..1.5) against volumes and positions worked out by hand: a bend of 180° with the
 * inside radius half the gap, the sheet cut back by its outside radius so the fold is flush with the edge, and a flat piece folded back over the sheet. And the joggle — two
 * edge flanges the other way round — that a jog would make at an edge.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, type Feature, type PartDoc, type Ref } from '@3db/model';
import { edgeFingerprint } from '@3db/naming';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { build, front, rectangle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});
afterAll(() => kept.forEach((r) => r.dispose()));

const rebuild = (doc: PartDoc): RebuildResult => {
  const regen = new Regenerator(kernel, solver, new Map());
  kept.push(regen);
  return regen.rebuild(doc);
};
const failures = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));
const volume = (r: RebuildResult) => kernel.massProps(r.body!.shape).volume;
const T = 1.5;
const base: Feature[] = [sketch('sk', front, rectangle('r', 0, 0, 100, 50)), { id: 'bf', type: 'baseFlange', name: 'bf', suppressed: false, sketch: 'sk', thickness: '1.5', radius: '2', kFactor: '0.5' } as Feature];
const PLATE = 100 * 50 * T;

function edgeAt(r: RebuildResult, mid: [number, number, number]): Ref {
  const i = r.body!.topology.edges.findIndex((e) => e.curve === 'line' && Math.hypot(e.mid[0] - mid[0], e.mid[1] - mid[1], e.mid[2] - mid[2]) < 1e-6);
  expect(i, `an edge at ${mid}`).toBeGreaterThanOrEqual(0);
  return { kind: 'edge', name: r.body!.names.edges[i]!, fingerprint: edgeFingerprint(r.body!.topology, i) };
}
let plate: RebuildResult;
let topEdge: Ref;
beforeAll(() => {
  plate = rebuild(build(...base));
  topEdge = edgeAt(plate, [100, 25, T]);
});
const hemOf = (extra: Record<string, unknown> = {}, edge: Ref = topEdge, id = 'hm'): Feature => ({ id, type: 'hem', name: id, suppressed: false, edge, length: '10', gap: '1', ...extra }) as Feature;
const flangeOf = (extra: Record<string, unknown> = {}, edge: Ref = topEdge, id = 'ef'): Feature => ({ id, type: 'edgeFlange', name: id, suppressed: false, edge, length: '30', ...extra }) as Feature;
const make = (extra: Record<string, unknown> = {}) => rebuild(build(...base, hemOf(extra)));
const bounds = (r: RebuildResult) => kernel.bounds(r.body!.shape);
const bend180 = (rb: number, w = 50) => Math.PI * T * w * (rb + T / 2);

describe('a hem on the edge of the plate', () => {
  it('gap 1 (inside radius 0.5), 10 folded back, material inside: the plate cut back by r + T = 2, the bend π·T·w·(r + T/2) = 294.52, the leg 1.5·50·10 — 8394.52 mm³, flush with the edge, 4 high', () => {
    const r = make();
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(PLATE - 2 * 50 * T + bend180(0.5) + T * 50 * 10, 4);
    expect(volume(r)).toBeCloseTo(8394.52, 2);
    expect(kernel.solidCount(r.body!.shape)).toBe(1);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    const b = bounds(r);
    expect(b.max[0]).toBeCloseTo(100, 6);
    expect(b.max[2]).toBeCloseTo(T + 1 + T, 6); // the sheet, the gap, the leg
    const names = r.body!.names.faces;
    const end = r.body!.topology.faces[names.indexOf('hm:side:flange.flange.end')]!;
    expect(end.center[0]).toBeCloseTo(98 - 10, 6); // the bend starts at x = 98 and the leg runs back 10
    expect(end.area).toBeCloseTo(T * 50, 6);
    const inside = r.body!.topology.faces[names.indexOf('hm:side:flange.flange.in')]!;
    expect(inside.center[2]).toBeCloseTo(T + 1, 6); // a gap of 1 above the sheet
    expect(inside.area).toBeCloseTo(50 * 10, 5);
    expect(new Set(names).size).toBe(names.length);
  });

  it('what is recorded: one bend of 180°, inside radius 0.5, the allowance π(0.5 + K·T) = 3.927, and the fold (trim 2, a flat piece of 10)', () => {
    const r = make();
    const b = r.sheet!.bends[0]!;
    expect(b.angle).toBeCloseTo(Math.PI, 9);
    expect(b.radius).toBe(0.5);
    expect(b.allowance).toBeCloseTo(Math.PI * (0.5 + 0.5 * T), 9);
    expect(r.sheet!.flanges[0]).toMatchObject({ feature: 'hm', straight: 10, trim: 2 });
    expect(r.features.find((f) => f.id === 'hm')!.info).toContain('3.927');
  });

  it('bend outside: the plate is left alone, 7500 + 294.52 + 750, the fold reaches x = 100 + r + T = 102', () => {
    const r = make({ position: 'bendOutside' });
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(PLATE + bend180(0.5) + T * 50 * 10, 4);
    expect(bounds(r).max[0]).toBeCloseTo(102, 6);
  });

  it('folded under the plate (flip): the same volume, the leg 1 below the underside: down to z = −2.5', () => {
    const r = make({ flip: true });
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(8394.52, 2);
    expect(bounds(r).min[2]).toBeCloseTo(-1 - T, 6);
    expect(bounds(r).max[2]).toBeCloseTo(T, 6);
  });

  it('a larger gap is a larger bend: gap 4 (radius 2) is π·T·w·(2 + T/2) and the cut-back is 3.5', () => {
    const r = make({ gap: '4' });
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(PLATE - 3.5 * 50 * T + bend180(2) + T * 50 * 10, 4);
    expect(bounds(r).max[2]).toBeCloseTo(T + 4 + T, 6);
  });

  it('a hem on the end of a flange (a lip folded back): 9548.98 − 2·50·1.5 + 294.52 + 1.5·50·8, one valid solid, two bends', () => {
    const first = rebuild(build(...base, flangeOf()));
    const end = edgeAt(first, [98.5, 25, 30]);
    const r = rebuild(build(...base, flangeOf(), hemOf({ length: '8' }, end, 'hm')));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(volume(first) - 2 * 50 * T + bend180(0.5) + T * 50 * 8, 4);
    expect(kernel.solidCount(r.body!.shape)).toBe(1);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(r.sheet!.bends.map((b) => b.angle)).toEqual([expect.closeTo(Math.PI / 2, 9), expect.closeTo(Math.PI, 9)]);
  });

  it('a leg that runs into a flange on the other side of the plate is said, not made wrong', () => {
    const left = edgeAt(plate, [0, 25, T]);
    const r = rebuild(build(...base, flangeOf(), hemOf({ length: '99' }, left)));
    expect(r.features.find((f) => f.id === 'hm')).toMatchObject({ status: 'error', message: expect.stringContaining('撞到') });
  });
});

describe('the joggle (two flanges the other way round, what a jog does at an edge)', () => {
  it('an edge flange up 10 and on its end another the other way, 20: one valid solid, the volume by hand, and a second bend of 90° the other way round', () => {
    const first = rebuild(build(...base, flangeOf({ length: '10' })));
    const topOfFlange = edgeAt(first, [100, 25, 10]);
    const r = rebuild(build(...base, flangeOf({ length: '10' }), flangeOf({ length: '20' }, topOfFlange, 'ef2')));
    expect(failures(r)).toEqual([]);
    const Ro = 3.5;
    const bend = (Math.PI / 2) * T * 50 * (2 + T / 2);
    expect(volume(r)).toBeCloseTo(volume(first) - Ro * 50 * T + bend + T * 50 * (20 - Ro), 4);
    expect(kernel.solidCount(r.body!.shape)).toBe(1);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(r.sheet!.bends).toHaveLength(2);
  });
});

describe('the command and what is refused', () => {
  it('setHem changes the gap and the length; a gap or a length of 0, a hem on a face, a part with no base flange are refused', () => {
    let d = build(...base, hemOf());
    d = applyCommand(d, { type: 'setHem', featureId: 'hm', hem: { edge: topEdge, length: '12', gap: '2' } });
    const r = rebuild(d);
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(PLATE - (1 + T) * 50 * T + bend180(1) + T * 50 * 12, 4);
    expect(() => build(...base, hemOf({ gap: '0' }))).toThrow();
    expect(() => build(...base, hemOf({ length: '0' }))).toThrow();
    expect(() => applyCommand(d, { type: 'setHem', featureId: 'hm', hem: { edge: { kind: 'face', name: 'x' }, length: '10', gap: '1' } })).toThrow();
    expect(() => applyCommand(d, { type: 'setHem', featureId: 'bf', hem: { edge: topEdge, length: '10', gap: '1' } })).toThrow();
    const none = rebuild(build(sketch('s', front, rectangle('r', 0, 0, 10, 10)), hemOf()));
    expect(none.features.find((f) => f.id === 'hm')).toMatchObject({ status: 'error' });
  });
});
