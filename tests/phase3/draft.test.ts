/**
 * Phase 3a-5c (C5.5): the draft feature. The picked walls lean about a neutral plane; the volume is the integral of the cross-section, the faces
 * keep their names, a chain of walls joined by fillets leans as one, and what cannot lean says why (ADR 0029).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, type Feature, type PartDoc } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type RebuildResult } from '@3db/regen';
import { build, extrude, face, fillet, edge, front, rectangle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const rebuild = (doc: PartDoc) => new Regenerator(kernel, solver, new Map()).rebuild(doc);
const failures = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));
const volume = (r: RebuildResult) => r.bodies.reduce((v, b) => v + kernel.massProps(b.shape).volume, 0);

const [W, D, H] = [20, 10, 10];
const t = Math.tan((3 * Math.PI) / 180);
const block = (): Feature[] => [sketch('s1', front, rectangle('a', 0, 0, W, D)), extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' })];
const sides = ['e1:side:s1.al0', 'e1:side:s1.al1', 'e1:side:s1.al2', 'e1:side:s1.al3'];
const draft = (neutral: string, faces: string[], angle = '3deg', reverse = false): Feature =>
  ({ id: 'd1', type: 'draft', name: 'd1', suppressed: false, neutral: face(neutral), faces: faces.map(face), angle, ...(reverse ? { reverse: true } : {}) }) as Feature;

describe('draft (C5.5)', () => {
  it('leans the four walls about the bottom face so that they narrow upwards: the integral of (W − 2zt)(D − 2zt)', () => {
    const r = rebuild(build(...block(), draft('e1:cap:start', sides)));
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(W * D * H - (W + D) * t * H * H + (4 / 3) * t * t * H ** 3, 6);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
  });

  it('reversed they widen away from the neutral face; about the top face they narrow downwards (always narrower away from it)', () => {
    const wider = W * D * H + (W + D) * t * H * H + (4 / 3) * t * t * H ** 3;
    expect(volume(rebuild(build(...block(), draft('e1:cap:start', sides, '3deg', true))))).toBeCloseTo(wider, 6);
    expect(volume(rebuild(build(...block(), draft('e1:cap:end', sides))))).toBeCloseTo(W * D * H - (W + D) * t * H * H + (4 / 3) * t * t * H ** 3, 6);
  });

  it('keeps the names of every face, and only some walls lean when only some are picked', () => {
    const plain = rebuild(build(...block()));
    const r = rebuild(build(...block(), draft('e1:cap:start', sides)));
    expect(r.body!.names.faces).toEqual(plain.body!.names.faces);
    const two = rebuild(build(...block(), draft('e1:cap:start', [sides[0]!, sides[2]!])));
    expect(failures(two)).toEqual([]);
    // two opposite walls lean: the cross-section is (W − 2zt) wide in one direction only… for the 10 mm walls: D − 2zt
    expect(volume(two)).toBeCloseTo(W * D * H - W * t * H * H, 6);
  });

  it('leans a wall chain with its fillets and still lets a later fillet find its edge', () => {
    const doc = build(
      ...block(),
      fillet('f1', [edge('{e1:side:s1.al0|e1:side:s1.al1}')], '3'),
    );
    const r0 = rebuild(doc);
    expect(failures(r0)).toEqual([]);
    const walls = r0.body!.names.faces.filter((n) => n.includes('e1:side') || n.includes('f1:fillet'));
    expect(walls).toHaveLength(5); // 4 walls and the round between two of them
    const r = rebuild(build(...block(), fillet('f1', [edge('{e1:side:s1.al0|e1:side:s1.al1}')], '3'), draft('e1:cap:start', walls, '2deg')));
    expect(failures(r)).toEqual([]);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(r.body!.names.faces).toEqual(r0.body!.names.faces);
    const later = rebuild(build(...block(), fillet('f1', [edge('{e1:side:s1.al0|e1:side:s1.al1}')], '3'), draft('e1:cap:start', walls, '2deg'), fillet('f2', [edge('{e1:cap:end|e1:side:s1.al2}')], '0.5')));
    expect(failures(later)).toEqual([]);
  });

  it('follows a change to the block: wider, the draft is the same angle', () => {
    const doc = applyCommand(build(...block(), draft('e1:cap:start', sides)), { type: 'setDimension', featureId: 's1', constraintId: 'aw', value: '30' });
    const r = rebuild(doc);
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(30 * D * H - (30 + D) * t * H * H + (4 / 3) * t * t * H ** 3, 6);
  });

  it('says what is wrong: nothing to lean, a wall parallel to the pull, a neutral face that is not flat or not there, an angle past 90°', () => {
    expect(failures(rebuild(build(...block(), draft('e1:cap:start', []))))[0]).toContain('尚未選擇面');
    expect(failures(rebuild(build(...block(), draft('e1:cap:start', ['e1:cap:end']))))[0]).toContain('拔模');
    expect(failures(rebuild(build(...block(), draft('e1:nowhere', sides))))[0]).toContain('遺失參考');
    expect(() => build(...block(), draft('e1:cap:start', sides, '95deg'))).toThrow('90°');
  });
});
