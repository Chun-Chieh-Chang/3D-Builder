/**
 * Moving components (C15.3, A3.5): a drag or a numeric move asks a component to go somewhere; the
 * solver takes it there as far as its mates allow, moving only along the freedoms they leave.
 */
import { describe, expect, it } from 'vitest';
import { axisAngle, IDENTITY_ROTATION, relativePose, transformPoint, type Pose, type Quat, type Vec3 } from '@3db/model';
import { solve, type GoalTerm, type MateGeometry, type MateSpec, type MateType, type SolverBody } from '../src';

const at = (position: Vec3, rotation: Quat = IDENTITY_ROTATION): Pose => ({ position, rotation: [...rotation] });
const tilted = (position: Vec3) => at(position, axisAngle([0.6, 0.8, 0], 0.35));
const base: SolverBody = { id: 'base', fixed: true, pose: at([0, 0, 0]) };
const floating = (id: string, pose: Pose, size = 20, pivot: Vec3 = [10, 10, 10]): SolverBody => ({ id, fixed: false, pose, size, pivot });

const plane = (origin: Vec3, normal: Vec3): MateGeometry => ({ kind: 'plane', origin, normal });
const point = (p: Vec3): MateGeometry => ({ kind: 'point', point: p });
const cylinder = (origin: Vec3, axis: Vec3, radius: number, convex = true): MateGeometry => ({ kind: 'cylinder', origin, axis, radius, convex });

let ids = 0;
const mate = (type: MateType, a: [string | null, MateGeometry], b: [string | null, MateGeometry], extra: Partial<MateSpec> = {}): MateSpec => ({
  id: `m${++ids}`,
  type,
  a: { body: a[0], geom: a[1] },
  b: { body: b[0], geom: b[1] },
  ...extra,
});

const where = (s: ReturnType<typeof solve>, id: string, p: Vec3) => transformPoint(s.poses.get(id)!, p);
const turned = (s: ReturnType<typeof solve>, id: string, d: Vec3): Vec3 => {
  const o = where(s, id, [0, 0, 0]);
  const e = where(s, id, d);
  return [e[0] - o[0], e[1] - o[1], e[2] - o[2]];
};
const close = (a: readonly number[], b: readonly number[], digits = 6) => a.forEach((v, i) => expect(v, `component ${i}: ${a} vs ${b}`).toBeCloseTo(b[i]!, digits));
const allOk = (s: ReturnType<typeof solve>) => expect([...s.mates.values()].filter((m) => m.status !== 'ok')).toEqual([]);
const qmul = ([ax, ay, az, aw]: Quat, [bx, by, bz, bw]: Quat): Quat => [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];

// The fixed base's top face is z = 0. A 20 mm block has its bottom at its z = 0.
const TOP = plane([0, 0, 0], [0, 0, 1]);
const BOTTOM = plane([10, 10, 0], [0, 0, -1]);
// A pin: shank R4 along its z axis, the flange's underside at its z = 8; seated in the base's hole at (20, 10).
const HOLE = cylinder([20, 10, -15], [0, 0, 1], 4, false);
const SHANK = cylinder([0, 0, 0], [0, 0, 1], 4);
const FLANGE = plane([0, 0, 8], [0, 0, -1]);
const seat = () => [mate('concentric', ['base', HOLE], ['pin', SHANK], { align: 'aligned' }), mate('coincident', ['base', TOP], ['pin', FLANGE], { align: 'antiAligned' })];
const seatedPin = () => floating('pin', at([20, 10, -8]), 10, [0, 0, 5]);

/** Dragging by a point along a line (the cursor's), the orientation kept if it can be. */
const drag = (point: Vec3, origin: Vec3, dir: Vec3, rotation: Quat = IDENTITY_ROTATION): GoalTerm[] => [
  { kind: 'pointOnLine', point, origin, dir },
  { kind: 'rotation', rotation },
];

describe('dragging a component (A3.5): it moves only along the freedoms its mates leave', () => {
  it('a free component slides with the cursor, parallel to the screen, without turning', () => {
    const start = tilted([7, 5, 12]);
    const grab: Vec3 = [20, 20, 20];
    const w = transformPoint(start, grab);
    const s = solve([base, floating('block', start)], [], { goal: { body: 'block', terms: drag(grab, [w[0] + 10, w[1] - 5, 100], [0, 0, -1], start.rotation) } });
    close(s.poses.get('block')!.position, [7 + 10, 5 - 5, 12]);
    close(s.poses.get('block')!.rotation, start.rotation, 9);
    expect(s.group).toEqual(['block']);
    expect(s.bodies.get('block')).toEqual({ status: 'under', dof: 6 });
  });

  it('a block on a face slides along it to where the cursor meets it, seen from any side', () => {
    const mates = [mate('coincident', ['base', TOP], ['block', BOTTOM], { align: 'antiAligned' })];
    for (const dir of [[0, 0, -1], [1, 1, -1]] as Vec3[]) {
      const s = solve([base, floating('block', at([0, 0, 0]))], mates, { goal: { body: 'block', terms: drag([20, 20, 20], [50, 40, 20], dir) } });
      allOk(s);
      close(s.poses.get('block')!.position, [30, 20, 0]);
      close(s.poses.get('block')!.rotation, IDENTITY_ROTATION, 9);
    }
  });

  it('a pin seated in its hole turns about the hole when its flange is dragged round', () => {
    // Grabbed on the flange's rim (radius 8, pin x axis); the cursor 60° round the hole's axis, first on
    // the rim, then farther out on the same bearing: either way the rim point turns to 60°.
    for (const r of [8, 20]) {
      const target: Vec3 = [20 + r * Math.cos(Math.PI / 3), 10 + r * Math.sin(Math.PI / 3), 50];
      const s = solve([base, seatedPin()], seat(), { goal: { body: 'pin', terms: drag([8, 0, 8], target, [0, 0, -1]) } });
      allOk(s);
      close(where(s, 'pin', [0, 0, 0]), [20, 10, -8]);
      close(turned(s, 'pin', [0, 0, 1]), [0, 0, 1]);
      // Out of reach (r = 20) the least distance is flat, so its turn is found to about 1e-6 rad.
      close(turned(s, 'pin', [1, 0, 0]), [Math.cos(Math.PI / 3), Math.sin(Math.PI / 3), 0], r === 8 ? 9 : 5);
      expect(s.bodies.get('pin')).toEqual({ status: 'under', dof: 1 });
    }
  });

  it('stays put once dragged: solved again from where it went, it does not move', () => {
    const s = solve([base, seatedPin()], seat(), { goal: { body: 'pin', terms: drag([8, 0, 8], [10, 30, 50], [0, 0, -1]) } });
    const again = solve([base, floating('pin', s.poses.get('pin')!, 10, [0, 0, 5])], seat());
    close(again.poses.get('pin')!.position, s.poses.get('pin')!.position, 9);
    close(again.poses.get('pin')!.rotation, s.poses.get('pin')!.rotation, 9);
  });

  it('does not move a fully defined or a fixed component', () => {
    const corner = [
      mate('coincident', ['base', TOP], ['block', BOTTOM], { align: 'antiAligned' }),
      mate('coincident', ['base', plane([-50, 0, 0], [1, 0, 0])], ['block', plane([0, 10, 10], [-1, 0, 0])], { align: 'antiAligned' }),
      mate('coincident', ['base', plane([0, -30, 0], [0, 1, 0])], ['block', plane([10, 0, 10], [0, -1, 0])], { align: 'antiAligned' }),
    ];
    const s = solve([base, floating('block', at([-50, -30, 0]))], corner, { goal: { body: 'block', terms: drag([20, 20, 20], [40, 40, 40], [0, 0, -1]) } });
    allOk(s);
    close(s.poses.get('block')!.position, [-50, -30, 0], 9);
    expect(s.group).toEqual(['block']);
    const fixed = solve([base], [], { goal: { body: 'base', terms: drag([0, 0, 0], [40, 40, 40], [0, 0, -1]) } });
    close(fixed.poses.get('base')!.position, [0, 0, 0], 12);
    expect(fixed.group).toEqual([]);
  });

  it('takes along what is mated to it: a cap locked to a sliding block', () => {
    const block = floating('block', at([0, 0, 0]));
    const cap = floating('cap', at([5, 5, 20]), 10, [0, 0, 0]);
    const lock = mate('lock', ['block', point([0, 0, 0])], ['cap', point([0, 0, 0])], { relative: relativePose(block.pose, cap.pose) });
    const s = solve([base, block, cap], [mate('coincident', ['base', TOP], ['block', BOTTOM], { align: 'antiAligned' }), lock], { goal: { body: 'cap', terms: drag([0, 0, 0], [25, 15, 50], [0, 0, -1]) } });
    allOk(s);
    close(where(s, 'cap', [0, 0, 0]), [25, 15, 20]);
    close(where(s, 'block', [0, 0, 0]), [20, 10, 0]);
    expect([...s.group!].sort()).toEqual(['block', 'cap']);
  });

  it('turning: a free component turns about its middle; a seated pin only about its hole', () => {
    const start = tilted([7, 5, 12]);
    const middle: Vec3 = [10, 10, 10];
    const c0 = transformPoint(start, middle);
    const target = qmul(axisAngle([0, 0, 1], 0.8), start.rotation);
    const free = solve([base, floating('block', start)], [], { goal: { body: 'block', terms: [{ kind: 'rotation', rotation: target }, { kind: 'pointAt', point: middle, target: c0 }] } });
    close(free.poses.get('block')!.rotation, target, 9);
    close(where(free, 'block', middle), c0);

    // Asked to turn 0.7 rad about an axis leaning off the hole's: it turns about the hole only.
    const lean = Math.hypot(0.3, 1);
    const s = solve([base, seatedPin()], seat(), { goal: { body: 'pin', terms: [{ kind: 'rotation', rotation: axisAngle([0.3 / lean, 0, 1 / lean], 0.7) }, { kind: 'pointAt', point: [0, 0, 5], target: [20, 10, -3] }] } });
    allOk(s);
    close(turned(s, 'pin', [0, 0, 1]), [0, 0, 1]);
    close(where(s, 'pin', [0, 0, 0]), [20, 10, -8]);
    const x = turned(s, 'pin', [1, 0, 0]);
    expect(Math.atan2(x[1], x[0])).toBeGreaterThan(0.5);
  });

  it('moving by numbers: as far as the mates allow', () => {
    // Seated: it cannot slide across or along its hole.
    const across = solve([base, seatedPin()], seat(), { goal: { body: 'pin', terms: [{ kind: 'pointAt', point: [0, 0, 0], target: [30, 10, -8] }, { kind: 'rotation', rotation: IDENTITY_ROTATION }] } });
    close(across.poses.get('pin')!.position, [20, 10, -8], 9);
    // Only in the hole (no flange mate): it slides along it.
    const inHole = [seat()[0]!];
    const along = solve([base, seatedPin()], inHole, { goal: { body: 'pin', terms: [{ kind: 'pointAt', point: [0, 0, 0], target: [23, 10, -1] }, { kind: 'rotation', rotation: IDENTITY_ROTATION }] } });
    allOk(along);
    close(along.poses.get('pin')!.position, [20, 10, -1]);
    close(along.poses.get('pin')!.rotation, IDENTITY_ROTATION, 9);
  });
});

describe('dragging in a large group (blueprint §2.5)', () => {
  const cpu = () => {
    const u = process.cpuUsage();
    return (u.user + u.system) / 1000;
  };

  it('the top pin of a column of 19 turns with the cursor, the others stay', () => {
    const bodies: SolverBody[] = [base];
    const mates: MateSpec[] = [];
    for (let i = 1; i < 20; i++) {
      bodies.push({ id: `p${i}`, fixed: false, pose: at([0, 0, 10 * (i - 1)]), pivot: [0, 0, 5], size: 10 });
      const below: string = i === 1 ? 'base' : `p${i - 1}`;
      mates.push(mate('concentric', [below, cylinder([0, 0, 0], [0, 0, 1], 5, i === 1 ? false : true)], [`p${i}`, cylinder([0, 0, 0], [0, 0, 1], 5)], { align: 'aligned' }));
      mates.push(mate('coincident', [below, i === 1 ? TOP : plane([0, 0, 10], [0, 0, 1])], [`p${i}`, plane([0, 0, 0], [0, 0, -1])], { align: 'antiAligned' }));
    }
    // Grabbed on its rim (radius 5, top at z = 10); the cursor a quarter turn round.
    const run = () => solve(bodies, mates, { goal: { body: 'p19', terms: drag([5, 0, 10], [0, 5, 500], [0, 0, -1]) } });
    run();
    let best = Infinity;
    let s = run();
    for (let i = 0; i < 3; i++) {
      const t = cpu();
      for (let k = 0; k < 5; k++) s = run();
      best = Math.min(best, (cpu() - t) / 5);
    }
    allOk(s);
    close(turned(s, 'p19', [1, 0, 0]), [0, 1, 0]);
    close(turned(s, 'p18', [1, 0, 0]), [1, 0, 0], 9);
    expect(s.group).toHaveLength(19);
    console.log(`dragging the top of a column of 19: ${best < 3.2 ? 'under 3 ms' : `${best.toFixed(1)} ms`}`);
    expect(best).toBeLessThan(50);
  });
});
