/**
 * Phase 3a-5b (C5.4): shell. A body hollowed out to a wall of even thickness, the picked faces taken away to open it, inward or outward.
 * Volumes are hand-calculated; the faces that stay keep their names, the inside of the wall is named for the face it lies against, and
 * what is built on a shelled body (a fillet of its rim) finds its edges (ADR 0028).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, type Feature, type PartDoc } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { build, circle, edge, extrude, face, fillet, front, rectangle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const rebuild = (doc: PartDoc) => new Regenerator(kernel, solver, new Map()).rebuild(doc);
const failures = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));
const volume = (r: RebuildResult) => r.bodies.reduce((v, b) => v + kernel.massProps(b.shape).volume, 0);

/** A 40 × 30 plate, 10 thick (z from 0 to 10); its top is e1:cap:end and its bottom e1:cap:start. */
const plate = (): Feature[] => [sketch('s1', front, rectangle('a', 0, 0, 40, 30)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' })];
const shell = (faces: string[], thickness: string, outward = false): Feature => ({ id: 'sh1', type: 'shell', name: 'sh1', suppressed: false, faces: faces.map(face), thickness, ...(outward ? { outward: true } : {}) }) as Feature;

describe('shell (C5.4)', () => {
  it('opens a plate at the top with a wall of 2 inward: 40 × 30 × 10 less 36 × 26 × 8', () => {
    const r = rebuild(build(...plate(), shell(['e1:cap:end'], '2')));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(12000 - 36 * 26 * 8, 6);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(r.body!.topology.faces).toHaveLength(11); // 5 outside, the rim where the top was, 5 inside
  });

  it('outward, the wall is added round the plate and the plate is hollowed: 44 × 34 × 12 less the plate', () => {
    const r = rebuild(build(...plate(), shell(['e1:cap:end'], '2', true)));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(44 * 34 * 12 - 12000, 6);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
  });

  it('takes away two faces: a tube, 40 × 30 × 10 less 36 × 26 × 10', () => {
    const r = rebuild(build(...plate(), shell(['e1:cap:end', 'e1:cap:start'], '2')));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(12000 - 36 * 26 * 10, 6);
  });

  it('names the outside as before and the inside for the face it lies against; every face has a name of its own', () => {
    const before = rebuild(build(...plate()));
    const r = rebuild(build(...plate(), shell(['e1:cap:end'], '2')));
    const names = r.body!.names.faces;
    expect(new Set(names).size).toBe(names.length);
    for (const n of before.body!.names.faces.filter((x) => x !== 'e1:cap:end')) expect(names).toContain(n); // the outside, untouched
    expect(names.filter((n) => n.startsWith('sh1:shell:'))).toHaveLength(5);
    expect(names).toContain('sh1:shell:e1:cap:start');
    expect(names).toContain('sh1:shell:e1:side:s1.al0');
  });

  it('what is built on it finds its edges: a fillet of the outer bottom edge before and a fillet of the rim after the shell', () => {
    const r0 = rebuild(build(...plate(), shell(['e1:cap:end'], '2')));
    expect(failures(r0)).toEqual([]);
    const edgesOf = r0.body!.names.edges;
    const outerBottom = edgesOf.find((n) => n === '{e1:cap:start|e1:side:s1.al0}');
    expect(outerBottom).toBeDefined();
    const rim = edgesOf.find((n) => n.includes('e1:side:s1.al0') && n.includes('sh1:shell:e1:side:s1.al0'));
    expect(rim, `rim among ${edgesOf.join(' ')}`).toBeDefined();
    const doc = build(...plate(), fillet('f0', [edge('{e1:cap:start|e1:side:s1.al0}')], '3'), shell(['e1:cap:end'], '2'), fillet('f1', [edge(rim!)], '0.5'));
    const r = rebuild(doc);
    expect(failures(r)).toEqual([]);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
  });

  it('changing the plate afterwards keeps the shell: wider plate, longer wall, nothing lost', () => {
    const doc = applyCommand(build(...plate(), shell(['e1:cap:end'], '2')), { type: 'setDimension', featureId: 's1', constraintId: 'aw', value: '50' });
    const r = rebuild(doc);
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(50 * 30 * 10 - 46 * 26 * 8, 6);
  });

  it('a plate with a hole and rounded corners still shells, valid and with every face named', () => {
    const doc = build(
      sketch('s1', front, rectangle('a', 0, 0, 40, 30), circle('h', 20, 15, 4)),
      extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }),
      shell(['e1:cap:end'], '1.5'),
    );
    const r = rebuild(doc);
    expect(failures(r)).toEqual([]);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(new Set(r.body!.names.faces).size).toBe(r.body!.names.faces.length);
    // wall volume = (outer less inner offset), hole wall included: the hole's tube is 1.5 thick too
    const expected = 40 * 30 * 10 - Math.PI * 16 * 10 - (37 * 27 * 8.5 - Math.PI * 5.5 * 5.5 * 8.5);
    expect(volume(r)).toBeCloseTo(expected, 3);
  });

  it('does not pass off an untouched body as a shell: an opened face with a fillet along its edge is a readable error', () => {
    const r = rebuild(build(...plate(), fillet('f0', [edge('{e1:cap:end|e1:side:s1.al0}')], '3'), shell(['e1:cap:end'], '1')));
    expect(failures(r)[0]).toContain('做不出來');
    // opening the other end works
    expect(failures(rebuild(build(...plate(), fillet('f0', [edge('{e1:cap:end|e1:side:s1.al0}')], '3'), shell(['e1:cap:start'], '1'))))).toEqual([]);
  });

  it('says what is wrong: nothing picked, a wall too thick, a face that is gone', () => {
    expect(failures(rebuild(build(...plate(), shell([], '2'))))[0]).toContain('尚未選擇面'); // an empty selection box, not yet filled in
    expect(failures(rebuild(build(...plate(), shell(['e1:cap:end'], '20'))))[0]).toContain('薄殼失敗');
    expect(failures(rebuild(build(...plate(), shell(['e1:nowhere'], '2'))))[0]).toContain('遺失參考');
    expect(() => build(...plate(), shell(['e1:cap:end'], '0'))).toThrow('必須大於 0');
  });
});
