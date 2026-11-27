/**
 * A revolve's profile may hold an arc whose centre lies across the axis when the arc itself stays on one side: a blend wider than the shaft it rounds
 * (R1-16148, Rev 02: R.23 joining a Ø.20 spike to its 25° point). The axis check used to count the centre as a point of the profile and refused it.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, type Command, type Feature, type PartDoc } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { arcSideExtremes, Regenerator } from '@3db/regen';

let kernel: Kernel;
let regen: Regenerator;
beforeAll(async () => {
  kernel = await Kernel.load();
  regen = new Regenerator(kernel, await PlaneGcsSolver.create());
});

const build = (...features: Feature[]): PartDoc => features.reduce<PartDoc>((doc, feature, index) => applyCommand(doc, { type: 'insertFeature', feature, index } satisfies Command), createEmptyPart());

/** On the front plane, about the x axis: points fixed, lines between them, one arc of radius `r` centred at (5, cy) from `from` to `to`. */
function profile(points: [string, number, number][], lines: [string, string][], cy: number, r: number, from: string, to: string): Feature[] {
  const entities = [
    ...points.map(([id, x, y]) => ({ id, type: 'point', x, y }) as const),
    ...lines.map(([p1, p2], i) => ({ id: `l${i}`, type: 'line', p1, p2 }) as const),
    { id: 'c', type: 'point', x: 5, y: cy } as const,
    { id: 'arc', type: 'arc', center: 'c', start: from, end: to } as const,
    { id: 'ax1', type: 'point', x: -2, y: 0 } as const,
    { id: 'ax2', type: 'point', x: 12, y: 0 } as const,
    { id: 'axis', type: 'line', p1: 'ax1', p2: 'ax2', construction: true } as const,
  ];
  const constraints = [
    ...[...points.map(([id]) => id), 'ax1', 'ax2'].map((id) => ({ id: `f_${id}`, type: 'fix', point: id }) as const),
    { id: 'r', type: 'radius', circle: 'arc', value: String(r) } as const,
  ];
  return [
    { id: 's1', type: 'sketch', name: 's1', suppressed: false, plane: { kind: 'datum', name: 'plane:front' }, entities, constraints } as Feature,
    { id: 'r1', type: 'revolve', name: 'r1', suppressed: false, sketch: 's1', axis: 'axis', op: 'boss', dir1: { type: 'blind', angle: '360' } } as Feature,
  ];
}

describe('arcSideExtremes', () => {
  const arc = (from: [number, number], to: [number, number], ccw: boolean) => ({ kind: 'arc' as const, c: [5, -10] as [number, number], r: 13, from, to, ccw, source: 'a' });
  it('gives the ends, and the circle points across the axis only where the arc passes them; never the centre', () => {
    // from (10, 2) to (0, 2) the short way over the top: passes (5, 3), not (5, −23)
    expect(arcSideExtremes(arc([10, 2], [0, 2], true), [1, 0]).map((p) => p.map((v) => +v.toFixed(12)))).toEqual([[10, 2], [0, 2], [5, 3]]);
    // the same ends the long way round: passes (5, −23) under the axis, not the top
    const long = arcSideExtremes(arc([0, 2], [10, 2], true), [1, 0]);
    expect(long).toHaveLength(3);
    expect(long[2]![0]).toBeCloseTo(5, 12);
    expect(long[2]![1]).toBeCloseTo(-23, 12);
    // clockwise is the reverse sense
    expect(arcSideExtremes(arc([0, 2], [10, 2], false), [1, 0]).map((p) => p.map((v) => +v.toFixed(12)))).toEqual([[0, 2], [10, 2], [5, 3]]);
  });
});

describe('revolve: an arc whose centre is across the axis', () => {
  it('revolves an arc that stays on one side, with the volume of its closed form', () => {
    const r = regen.rebuild(build(...profile([['p0', 0, 0], ['p1', 10, 0], ['p2', 10, 2], ['p3', 0, 2]], [['p0', 'p1'], ['p1', 'p2'], ['p3', 'p0']], -10, 13, 'p2', 'p3')));
    expect(r.features.map((f) => `${f.id}=${f.status}${f.message ? `(${f.message})` : ''}`)).toEqual(['s1=ok', 'r1=ok']);
    // y(x) = √(169 − (x − 5)²) − 10 on [0, 10]; π ∫ y² dx with u = x − 5: π [2690 − 250/3 − 20 (60 + 169 asin(5/13))]
    const exact = Math.PI * (2690 - 250 / 3 - 20 * (60 + 169 * Math.asin(5 / 13)));
    expect(kernel.massProps(r.body!.shape).volume).toBeCloseTo(exact, 6);
    expect(kernel.check(r.body!.shape).valid).toBe(true);
    expect(kernel.bounds(r.body!.shape).max[1]).toBeCloseTo(3, 3); // the arc's top, (5, 3), not its ends at 2
  });

  it('still refuses an arc that dips across the axis between ends on one side', () => {
    // centre (5, 4), radius √29: from (0, 2) the short way to (10, 2) passes (5, 4 − √29) = (5, −1.39), under the axis
    const r = regen.rebuild(build(...profile([['p0', 0, 2], ['p1', 10, 2]], [['p1', 'p0']], 4, Math.sqrt(29), 'p0', 'p1')));
    expect(r.features.at(-1)).toMatchObject({ status: 'error', message: '輪廓跨過旋轉軸' });
  });
});
