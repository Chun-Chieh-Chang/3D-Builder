/**
 * 7-2 (docs/phase7-plan.md): the edge flange (C11.2) on a plate 100 × 50 × 1.5 (x 0..100, y 0..50, z 0..1.5; inside radius 2, K 0.5) against volumes and positions worked out by
 * hand: the bend θ·T·w·(r + T/2), the flange T·w·(length less the setback of the virtual sharp, (r + T)·tan(θ/2) from the outside), the strip cut back from the sheet.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, SCHEMA_VERSION, type Feature, type PartDoc, type Ref } from '@3db/model';
import { edgeFingerprint } from '@3db/naming';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { build, extrude, front, rectangle, sketch, statuses } from '../phase1/builders';

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
const r0 = 2;
const Ro = r0 + T;
const base: Feature[] = [sketch('sk', front, rectangle('r', 0, 0, 100, 50)), { id: 'bf', type: 'baseFlange', name: 'bf', suppressed: false, sketch: 'sk', thickness: '1.5', radius: '2', kFactor: '0.5' } as Feature];
const PLATE = 100 * 50 * T;
const bendVolume = (theta: number) => theta * T * 50 * (r0 + T / 2);

/** The edge of the body (a line along `along`) whose middle is at `mid`. */
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
const flange = (extra: Record<string, unknown> = {}, edge: Ref = topEdge): Feature => ({ id: 'ef', type: 'edgeFlange', name: 'ef', suppressed: false, edge, length: '30', ...extra }) as Feature;
const make = (extra: Record<string, unknown> = {}, edge: Ref = topEdge) => rebuild(build(...base, flange(extra, edge)));
const bounds = (r: RebuildResult) => kernel.bounds(r.body!.shape);

describe('a flange on the edge of the plate', () => {
  it('material inside, 90°, 30 from the outside virtual sharp: the plate cut back by r + T = 3.5, the bend, a flat piece of 26.5 — 9548.98 mm³, one valid solid, flush with the edge and 30 high', () => {
    const r = make();
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(PLATE - Ro * 50 * T + bendVolume(Math.PI / 2) + T * 50 * (30 - Ro), 4);
    expect(volume(r)).toBeCloseTo(9548.98, 2);
    expect(kernel.solidCount(r.body!.shape)).toBe(1);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    const b = bounds(r);
    expect(b.max[0]).toBeCloseTo(100, 6); // the outside of the flange is on the edge
    expect(b.max[2]).toBeCloseTo(30, 6); // 30 from the outside of the plate (z = 0)
    expect(b.min[2]).toBeCloseTo(0, 6);
    // the flange is 1.5 thick: its inside face at x = 98.5
    const names = r.body!.names.faces;
    expect(names.filter((n) => n.startsWith('ef:'))).toEqual(expect.arrayContaining(['ef:side:flange.bend.in', 'ef:side:flange.bend.out', 'ef:side:flange.flange.in', 'ef:side:flange.flange.out']));
    const inside = r.body!.topology.faces[names.indexOf('ef:side:flange.flange.in')]!;
    expect(inside.center[0]).toBeCloseTo(98.5, 6);
    expect(inside.area).toBeCloseTo(50 * (30 - Ro), 5);
    expect(new Set(names).size).toBe(names.length);
  });

  it('what is recorded: one bend of 90°, inside radius 2, 50 wide, the allowance (π/2)(2 + K·T), and the flange (trim 3.5, flat piece 26.5)', () => {
    const r = make();
    const sheet = r.sheet!;
    expect(sheet.bends).toHaveLength(1);
    expect(sheet.bends[0]).toMatchObject({ feature: 'ef', radius: r0, width: 50, thickness: T });
    expect(sheet.bends[0]!.allowance).toBeCloseTo((Math.PI / 2) * (r0 + 0.5 * T), 9);
    expect(sheet.flanges).toHaveLength(1);
    expect(sheet.flanges[0]).toMatchObject({ feature: 'ef', width: 50 });
    expect(sheet.flanges[0]!.trim).toBeCloseTo(Ro, 9);
    expect(sheet.flanges[0]!.straight).toBeCloseTo(30 - Ro, 9);
    expect(r.features.find((f) => f.id === 'ef')!.info).toContain('26.500');
  });

  it('bend outside: the plate is left alone and the bend starts at the edge — 7500 + 323.98 + 1987.5, the outside of the flange at x = 100 + r + T, still 30 high', () => {
    const r = make({ position: 'bendOutside' });
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(PLATE + bendVolume(Math.PI / 2) + T * 50 * (30 - Ro), 4);
    const b = bounds(r);
    expect(b.max[0]).toBeCloseTo(100 + Ro, 6);
    expect(b.max[2]).toBeCloseTo(30, 6);
  });

  it('the length from the inside virtual sharp (28, the top is 1.5 + 30) or from the end of the bend (30, the top is 3.5 + 30)', () => {
    const inner = make({ lengthFrom: 'inner' });
    expect(volume(inner)).toBeCloseTo(PLATE - Ro * 50 * T + bendVolume(Math.PI / 2) + T * 50 * (30 - r0), 4);
    expect(bounds(inner).max[2]).toBeCloseTo(T + 30, 6);
    const tangent = make({ lengthFrom: 'tangent' });
    expect(volume(tangent)).toBeCloseTo(PLATE - Ro * 50 * T + bendVolume(Math.PI / 2) + T * 50 * 30, 4);
    expect(bounds(tangent).max[2]).toBeCloseTo(T + r0 + 30, 6);
  });

  it('bent the other way (flip): the same volume, the flange goes down 30 from the outside (the top of the plate): to z = 1.5 − 30', () => {
    const r = make({ flip: true });
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(9548.98, 2);
    const b = bounds(r);
    expect(b.min[2]).toBeCloseTo(T - 30, 6);
    expect(b.max[2]).toBeCloseTo(T, 6);
    expect(b.max[0]).toBeCloseTo(100, 6);
  });

  it('45°: the setback (r + T)·tan 22.5° = 1.4497, a flat piece of 28.5503, the outside corner of the end at the virtual sharp + 30 along the flange (121.2132, 21.2132) and the inside corner 1.5 square to it', () => {
    const theta = Math.PI / 4;
    const setback = Ro * Math.tan(theta / 2);
    const r = make({ angle: '45deg' });
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(PLATE - setback * 50 * T + bendVolume(theta) + T * 50 * (30 - setback), 4);
    const b = bounds(r);
    expect(b.max[0]).toBeCloseTo(100 + 30 * Math.SQRT1_2, 4);
    expect(b.max[2]).toBeCloseTo(30 * Math.SQRT1_2 + T * Math.SQRT1_2, 4);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
  });

  it('another radius for this bend: r = 4 — the setback is (4 + 1.5) and the bend (π/2)·T·w·(4 + T/2)', () => {
    const r = make({ radius: '4' });
    expect(failures(r)).toEqual([]);
    const R = 4 + T;
    expect(volume(r)).toBeCloseTo(PLATE - R * 50 * T + (Math.PI / 2) * T * 50 * (4 + T / 2) + T * 50 * (30 - R), 4);
    expect(r.sheet!.bends[0]!.radius).toBe(4);
  });
});

describe('a flange on a flange', () => {
  it('a return lip: on the end of the first flange, bent back toward the plate — each flange cuts back the one before it, and the sheet gets two bends and two flanges', () => {
    const first = make();
    const lipEdge = edgeAt(first, [98.5, 25, 30]);
    const r = rebuild(build(...base, flange(), { ...flange({ length: '10' }, lipEdge), id: 'ef2', name: 'ef2' } as Feature));
    expect(failures(r)).toEqual([]);
    const lip = (30 - 0) * 0; // the second flange is 10 from the outside virtual sharp: a flat piece of 10 − 3.5
    void lip;
    expect(volume(r)).toBeCloseTo(volume(first) - Ro * 50 * T + bendVolume(Math.PI / 2) + T * 50 * (10 - Ro), 4);
    expect(kernel.solidCount(r.body!.shape)).toBe(1);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(r.sheet!.bends).toHaveLength(2);
    expect(r.sheet!.flanges.map((f) => f.feature)).toEqual(['ef', 'ef2']);
    // the lip points back toward the plate: it reaches x = 100 − 10 from the outside of the first flange, at the top (z up to 30)
    const faces = r.body!.names.faces.filter((n) => n.startsWith('ef2:side:flange.flange.'));
    expect(faces.length).toBeGreaterThanOrEqual(2);
    const out = r.body!.topology.faces[r.body!.names.faces.indexOf('ef2:side:flange.flange.out')]!;
    expect(out.center[2]).toBeCloseTo(30, 6);
    expect(out.center[0]).toBeCloseTo(100 - (3.5 + (10 - Ro) / 2), 6);
  });
});

describe('it follows the model', () => {
  it('the length, the plate and the base flange changed: the same names, the volumes by hand', () => {
    const r = make();
    const names = r.body!.names.faces.filter((n) => n.startsWith('ef:')).sort();
    let d = build(...base, flange());
    d = applyCommand(d, { type: 'setEdgeFlange', featureId: 'ef', flange: { edge: topEdge, length: '40' } });
    const longer = rebuild(d);
    expect(failures(longer)).toEqual([]);
    expect(volume(longer)).toBeCloseTo(PLATE - Ro * 50 * T + bendVolume(Math.PI / 2) + T * 50 * (40 - Ro), 4);
    expect(longer.body!.names.faces.filter((n) => n.startsWith('ef:')).sort()).toEqual(names);
    // the base flange 2 thick with radius 3: the flange is still 30 from the outside and flush with the edge
    d = applyCommand(d, { type: 'setBaseFlange', featureId: 'bf', flange: { thickness: '2', radius: '3', kFactor: '0.5' } });
    const thick = rebuild(d);
    expect(failures(thick)).toEqual([]);
    const R = 5;
    expect(volume(thick)).toBeCloseTo(100 * 50 * 2 - R * 50 * 2 + (Math.PI / 2) * 2 * 50 * (3 + 1) + 2 * 50 * (40 - R), 4);
    expect(kernel.bounds(thick.body!.shape).max[0]).toBeCloseTo(100, 6);
    expect(kernel.bounds(thick.body!.shape).max[2]).toBeCloseTo(40, 6);
  });
});

describe('what is refused', () => {
  const message = (...features: Feature[]) => rebuild(build(...features)).features.find((f) => f.id === 'ef')!;

  it('a flange too short for its bend (says how long it has to be), no edge picked, an edge that is not the end of the sheet, a part with no base flange', () => {
    expect(message(...base, flange({ length: '3' }))).toMatchObject({ status: 'error', message: expect.stringContaining('3.500') });
    expect(message(...base, flange({}, { kind: 'edge', name: '' }))).toMatchObject({ status: 'error' });
    const short = edgeAt(plate, [100, 0, T / 2]); // the 1.5 edge between the end and the side
    expect(message(...base, flange({}, short))).toMatchObject({ status: 'error', message: expect.stringContaining('端面') });
    const block = [sketch('s', front, rectangle('r', 0, 0, 100, 50)), extrude('e', 's', 'boss', { type: 'blind', depth: '1.5' })];
    const m = rebuild(build(...block, flange({}, { kind: 'edge', name: 'e:edge:x' }))).features.find((f) => f.id === 'ef')!;
    expect(m).toMatchObject({ status: 'error', message: expect.stringContaining('基材凸緣') });
  });

  it('a lip on a flange too short to be cut back by its bend (the first flange is 5 long, 1.5 flat; the lip needs 3.5) is said, not made wrong', () => {
    const first = make({ length: '5' });
    expect(failures(first)).toEqual([]);
    const lipEdge = edgeAt(first, [98.5, 25, 5]);
    const r = rebuild(build(...base, flange({ length: '5' }), { ...flange({ length: '10' }, lipEdge), id: 'ef2', name: 'ef2' } as Feature));
    expect(r.features.find((f) => f.id === 'ef2')).toMatchObject({ status: 'error', message: expect.stringContaining('放不下') });
  });

  it('flanges on two edges that meet at a corner: the second is made on what is left of its edge (96.5 long) and the two touch along a line at the corner — one valid solid (the relief that a real corner needs is 7-4)', () => {
    const W = 100 - Ro;
    const next = edgeAt(make(), [W / 2, 50, T]); // picked in the model as it is after the first flange: the edge is 96.5 long now
    const r = rebuild(build(...base, flange(), { ...flange({}, next), id: 'ef2', name: 'ef2' } as Feature));
    expect(failures(r)).toEqual([]);
    const bend = (w: number) => (Math.PI / 2) * T * w * (r0 + T / 2);
    expect(volume(r)).toBeCloseTo(PLATE - Ro * 50 * T - Ro * W * T + bend(50) + bend(W) + T * 50 * (30 - Ro) + T * W * (30 - Ro), 3);
    expect(kernel.solidCount(r.body!.shape)).toBe(1);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(r.sheet!.flanges.map((f) => f.width)).toEqual([50, W]);
  });

  it('an angle of 0 or 180° and a length that is not above 0 are refused where they are given; setEdgeFlange refuses a face', () => {
    expect(() => build(...base, flange({ length: '0' }))).toThrow();
    expect(() => build(...base, flange({ angle: '180deg' }))).toThrow();
    expect(() => build(...base, flange({ angle: '0deg' }))).toThrow();
    const d = build(...base, flange());
    expect(() => applyCommand(d, { type: 'setEdgeFlange', featureId: 'ef', flange: { edge: { kind: 'face', name: 'x' }, length: '30' } })).toThrow();
    expect(d.schemaVersion).toBe(SCHEMA_VERSION);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(37);
  });
});
