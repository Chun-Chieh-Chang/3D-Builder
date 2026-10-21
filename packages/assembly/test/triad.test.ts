/**
 * 以座標軸移動 (Move with Triad, ADR 0179): a handle's drag, as goal terms, through the real solver. The truth is the motion's own matrix (a translation along
 * the axis or in the plane, a turn about the axis through the middle), worked out here from the numbers given, never written down; with mates, what they
 * lock does not move and what the handle does not offer does not either.
 */
import { describe, expect, it } from 'vitest';
import { axisAngle, composeRotations, IDENTITY_ROTATION, transformPoint, type Pose, type Quat, type Vec3 } from '@3db/model';
import { solve, TRIAD_AXES, triadMotion, triadHolds, triadStepsProblem, triadTerms, type MateGeometry, type MateSpec, type MateType, type SolverBody, type TriadAxis, type TriadGrab, type TriadHandle, type TriadMotion, type TriadRay } from '../src';

const EXACT = 1e-9;
const at = (position: Vec3, rotation: Quat = IDENTITY_ROTATION): Pose => ({ position, rotation: [...rotation] });
const base: SolverBody = { id: 'base', fixed: true, pose: at([0, 0, 0]) };
const floating = (id: string, pose: Pose, size = 20, pivot: Vec3 = [10, 10, 10]): SolverBody => ({ id, fixed: false, pose, size, pivot });
const plane = (origin: Vec3, normal: Vec3): MateGeometry => ({ kind: 'plane', origin, normal });
const cylinder = (origin: Vec3, axis: Vec3, radius: number, convex = true): MateGeometry => ({ kind: 'cylinder', origin, axis, radius, convex });
let ids = 0;
const mate = (type: MateType, a: [string | null, MateGeometry], b: [string | null, MateGeometry], extra: Partial<MateSpec> = {}): MateSpec => ({ id: `m${++ids}`, type, a: { body: a[0], geom: a[1] }, b: { body: b[0], geom: b[1] }, ...extra });

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(...a.map((v, i) => v - b[i]!));
/** Two quaternions for the same rotation (q and −q). */
const sameTurn = (a: Quat, b: Quat) => Math.min(dist(a, b), dist(a, b.map((v) => -v)));
const turnOf = (pose: Pose, v: Vec3): Vec3 => sub(transformPoint(pose, v), transformPoint(pose, [0, 0, 0]));
const allOk = (s: ReturnType<typeof solve>) => expect([...s.mates.values()].filter((m) => m.status !== 'ok')).toEqual([]);

// The fixed base's top face is z = 0; a 20 mm block has its bottom at its z = 0 and its middle at (10, 10, 10).
const TOP = plane([0, 0, 0], [0, 0, 1]);
const BOTTOM = plane([10, 10, 0], [0, 0, -1]);
const CENTER: Vec3 = [10, 10, 10];
// A pin seated in the base's hole at (20, 10): shank R4 along its z, flange underside at its z = 8; its middle is (0, 0, 5).
const HOLE = cylinder([20, 10, -15], [0, 0, 1], 4, false);
const SHANK = cylinder([0, 0, 0], [0, 0, 1], 4);
const FLANGE = plane([0, 0, 8], [0, 0, -1]);
const PIN_CENTER: Vec3 = [0, 0, 5];

/** A ray of the pointer that passes through `p`, looking along `look`. */
const rayThrough = (p: Vec3, look: Vec3): TriadRay => ({ origin: sub(p, scale(look, 200)), dir: look });
/** A direction of looking that is along none of the axes (an isometric view, a little off). */
const LOOK: Vec3 = [-0.55, -0.62, -0.56];

function grabOf(handle: TriadHandle, pose: Pose, center: Vec3, size: number, start: TriadRay): TriadGrab {
  return { handle, center, centerAt: transformPoint(pose, center), rotation: pose.rotation, size, start };
}

/**
 * A drag of `handle` on `body` from its middle to where the motion would take the pointer: the solver's answer, kept only when it is a motion the handle
 * offers (`triadHolds`), as the store keeps it; otherwise the component stays where it was.
 */
function drag(bodies: SolverBody[], mates: MateSpec[], body: string, handle: TriadHandle, center: Vec3, motion: TriadMotion, size = 20) {
  const pose = bodies.find((b) => b.id === body)!.pose;
  const grab = grabOf(handle, pose, center, size, rayThrough(transformPoint(pose, center), LOOK));
  const solved = solve(bodies, mates, { goal: { body, terms: triadTerms(grab, motion) } });
  const held = triadHolds(grab, solved.poses.get(body)!);
  return { grab, held, s: held ? solved : solve(bodies, mates) };
}

/** Where a mate is solved again after the move, the poses are as close as the drag solver converges (move.test.ts checks these to 6 digits too): a layer of its own (AGENTS.md §4 "真值要分層"). */
const MATED = 1e-7;

const tilted = (position: Vec3) => at(position, axisAngle([0.6, 0.8, 0], 0.35));
const AXIS_NAMES = ['X', 'Y', 'Z'];
const axisList: TriadAxis[] = [0, 1, 2];

describe('the pointer to a motion (triadMotion)', () => {
  const pose = tilted([7, 5, 12]);
  const c = transformPoint(pose, CENTER);
  it.each(axisList)('an arrow: the distance along axis %i is where the ray passes the axis', (axis) => {
    const a = TRIAD_AXES[axis]!;
    const grab = grabOf({ kind: 'axis', axis }, pose, CENTER, 20, rayThrough(add(c, scale(a, 3)), LOOK));
    const m = triadMotion(grab, rayThrough(add(c, scale(a, 3 + 17.25)), LOOK));
    expect(m?.kind).toBe('axis');
    expect(Math.abs((m as { distance: number }).distance - 17.25)).toBeLessThan(EXACT);
  });

  it('a square: the offset is where the ray meets the plane, nothing across it', () => {
    const grab = grabOf({ kind: 'plane', normal: 2 }, pose, CENTER, 20, rayThrough(c, LOOK));
    const m = triadMotion(grab, rayThrough(add(c, [8.5, -3.25, 0]), LOOK)) as { offset: Vec3 };
    expect(dist(m.offset, [8.5, -3.25, 0])).toBeLessThan(EXACT);
  });

  it('a ring: the angle round the axis, and it goes on past half a turn', () => {
    const grab = grabOf({ kind: 'ring', axis: 2 }, pose, CENTER, 20, rayThrough(add(c, [10, 0, 0]), LOOK));
    const round = (deg: number): Vec3 => add(c, [10 * Math.cos((deg * Math.PI) / 180), 10 * Math.sin((deg * Math.PI) / 180), 0]);
    let m: TriadMotion | null = null;
    for (const deg of [40, 100, 170, 200, 260]) {
      m = triadMotion(grab, rayThrough(round(deg), LOOK), undefined, m);
      expect(Math.abs((m as { angle: number }).angle - (deg * Math.PI) / 180)).toBeLessThan(EXACT);
    }
  });

  it('snaps to the steps: 12.3 mm by 5 is 10, (7.4, 3.2) by 2 is (8, 4), 37° by 15° is 30°', () => {
    const steps = { move: 5, turn: 15 };
    const arrow = grabOf({ kind: 'axis', axis: 0 }, pose, CENTER, 20, rayThrough(c, LOOK));
    expect((triadMotion(arrow, rayThrough(add(c, [12.3, 0, 0]), LOOK), steps) as { distance: number }).distance).toBe(10);
    const square = grabOf({ kind: 'plane', normal: 2 }, pose, CENTER, 20, rayThrough(c, LOOK));
    expect((triadMotion(square, rayThrough(add(c, [7.4, 3.2, 0]), LOOK), { move: 2, turn: 0 }) as { offset: Vec3 }).offset).toEqual([8, 4, 0]);
    const ring = grabOf({ kind: 'ring', axis: 2 }, pose, CENTER, 20, rayThrough(add(c, [10, 0, 0]), LOOK));
    const a = (37 * Math.PI) / 180;
    expect(Math.abs((triadMotion(ring, rayThrough(add(c, [10 * Math.cos(a), 10 * Math.sin(a), 0]), LOOK), steps) as { angle: number }).angle - Math.PI / 6)).toBeLessThan(EXACT);
  });

  it('reads nothing when looking along the arrow or edge-on at the square or the ring (the last motion stays)', () => {
    const along = (axis: TriadAxis): TriadRay => ({ origin: sub(c, scale(TRIAD_AXES[axis]!, 100)), dir: TRIAD_AXES[axis]! });
    expect(triadMotion(grabOf({ kind: 'axis', axis: 0 }, pose, CENTER, 20, rayThrough(c, LOOK)), along(0))).toBeNull();
    const edgeOn: TriadRay = { origin: add(c, [0, 0, 50]), dir: [1, 0, 0] };
    expect(triadMotion(grabOf({ kind: 'plane', normal: 2 }, pose, CENTER, 20, rayThrough(c, LOOK)), edgeOn)).toBeNull();
    expect(triadMotion(grabOf({ kind: 'ring', axis: 2 }, pose, CENTER, 20, rayThrough(add(c, [10, 0, 0]), LOOK)), edgeOn)).toBeNull();
    expect(triadMotion(grabOf({ kind: 'axis', axis: 0 }, pose, CENTER, 20, rayThrough(c, LOOK)), { origin: [Number.NaN, 0, 0], dir: LOOK })).toBeNull();
  });

  it('refuses steps that are not 0 or a positive finite number, and says which', () => {
    for (const move of [-1, Number.NaN, Number.POSITIVE_INFINITY]) expect(triadStepsProblem({ move, turn: 0 })).toContain('移動步進');
    for (const turn of [-15, Number.NaN, Number.NEGATIVE_INFINITY]) expect(triadStepsProblem({ move: 0, turn })).toContain('旋轉步進');
    expect(triadStepsProblem({ move: 0, turn: 0 })).toBeNull();
    expect(triadStepsProblem({ move: 2.5, turn: 15 })).toBeNull();
  });
});

describe('a free component goes exactly where the handle takes it', () => {
  const start = tilted([7, 5, 12]);
  const bodies = [base, floating('block', start)];
  it.each(axisList)('arrow %i: moved by d along the axis, not turned', (axis) => {
    const d = 13.75;
    const { s } = drag(bodies, [], 'block', { kind: 'axis', axis }, CENTER, { kind: 'axis', distance: d });
    const p = s.poses.get('block')!;
    expect(dist(p.position, add(start.position, scale(TRIAD_AXES[axis]!, d)))).toBeLessThan(EXACT);
    expect(sameTurn(p.rotation, start.rotation)).toBeLessThan(EXACT);
  });

  it.each(axisList)('square %i: moved by the offset in the plane, not across it, not turned', (normal) => {
    const offset = [0, 1, 2].map((k) => (k === normal ? 0 : [6.5, -4.25, 9][k]!)) as Vec3;
    const { s } = drag(bodies, [], 'block', { kind: 'plane', normal }, CENTER, { kind: 'plane', offset });
    const p = s.poses.get('block')!;
    expect(dist(p.position, add(start.position, offset))).toBeLessThan(EXACT);
    expect(sameTurn(p.rotation, start.rotation)).toBeLessThan(EXACT);
  });

  it.each(axisList)('ring %i: turned by θ about the axis through the middle, the middle where it was', (axis) => {
    for (const angle of [0.4, -1.1, 2.6]) {
      const { grab, s } = drag(bodies, [], 'block', { kind: 'ring', axis }, CENTER, { kind: 'ring', angle });
      const p = s.poses.get('block')!;
      const want = composeRotations(axisAngle(TRIAD_AXES[axis]!, angle), start.rotation);
      expect(sameTurn(p.rotation, want)).toBeLessThan(EXACT);
      expect(dist(transformPoint(p, CENTER), grab.centerAt)).toBeLessThan(EXACT);
    }
  });
});

describe('with mates: what they lock and what the handle does not offer stay put', () => {
  const onTop = () => [mate('coincident', ['base', TOP], ['block', BOTTOM], { align: 'antiAligned' })];
  const block = () => [base, floating('block', at([5, 5, 0]))];

  it('a block on the base: the Z arrow does nothing, the X arrow moves it exactly, the mate holds', () => {
    const up = drag(block(), onTop(), 'block', { kind: 'axis', axis: 2 }, CENTER, { kind: 'axis', distance: 15 }).s;
    allOk(up);
    expect(dist(up.poses.get('block')!.position, [5, 5, 0])).toBeLessThan(MATED);
    const across = drag(block(), onTop(), 'block', { kind: 'axis', axis: 0 }, CENTER, { kind: 'axis', distance: 12 }).s;
    allOk(across);
    expect(dist(across.poses.get('block')!.position, [17, 5, 0])).toBeLessThan(MATED);
    expect(sameTurn(across.poses.get('block')!.rotation, IDENTITY_ROTATION)).toBeLessThan(MATED);
  });

  it('a block on the base: the XZ square moves it along X only; the XY square both ways', () => {
    const xz = drag(block(), onTop(), 'block', { kind: 'plane', normal: 1 }, CENTER, { kind: 'plane', offset: [8, 0, 11] }).s;
    allOk(xz);
    expect(dist(xz.poses.get('block')!.position, [13, 5, 0])).toBeLessThan(MATED);
    const xy = drag(block(), onTop(), 'block', { kind: 'plane', normal: 2 }, CENTER, { kind: 'plane', offset: [8, -3, 0] }).s;
    allOk(xy);
    expect(dist(xy.poses.get('block')!.position, [13, 2, 0])).toBeLessThan(MATED);
  });

  it('a block on the base: the Z ring turns it, the X ring does not', () => {
    const { grab, s } = drag(block(), onTop(), 'block', { kind: 'ring', axis: 2 }, CENTER, { kind: 'ring', angle: 0.9 });
    allOk(s);
    const p = s.poses.get('block')!;
    expect(sameTurn(p.rotation, axisAngle([0, 0, 1], 0.9))).toBeLessThan(MATED);
    expect(dist(transformPoint(p, CENTER), grab.centerAt)).toBeLessThan(MATED);
    const tip = drag(block(), onTop(), 'block', { kind: 'ring', axis: 0 }, CENTER, { kind: 'ring', angle: 0.9 }).s;
    allOk(tip);
    expect(dist(tip.poses.get('block')!.position, [5, 5, 0])).toBeLessThan(MATED);
    expect(sameTurn(tip.poses.get('block')!.rotation, IDENTITY_ROTATION)).toBeLessThan(MATED);
  });

  it('a turn the mates allow only about another axis is not taken: the guard refuses it and the block stays (the guard is what decides here)', () => {
    // the block is held concentric on the hole's axis through its own corner (0, 0): it can turn about that axis, never about its middle
    const held = () => [mate('concentric', ['base', HOLE], ['block', SHANK], { align: 'aligned' })];
    const bodies = () => [base, floating('block', at([20, 10, 0]))];
    const grab = grabOf({ kind: 'ring', axis: 2 }, at([20, 10, 0]), CENTER, 20, rayThrough(transformPoint(at([20, 10, 0]), CENTER), LOOK));
    const unguarded = solve(bodies(), held(), { goal: { body: 'block', terms: triadTerms(grab, { kind: 'ring', angle: 0.8 }) } });
    // what the solver alone does: turns it about the hole, so its middle moves
    expect(dist(transformPoint(unguarded.poses.get('block')!, CENTER), grab.centerAt)).toBeGreaterThan(1);
    const { held: kept, s } = drag(bodies(), held(), 'block', { kind: 'ring', axis: 2 }, CENTER, { kind: 'ring', angle: 0.8 });
    expect(kept).toBe(false);
    allOk(s);
    expect(dist(s.poses.get('block')!.position, [20, 10, 0])).toBeLessThan(MATED);
    expect(sameTurn(s.poses.get('block')!.rotation, IDENTITY_ROTATION)).toBeLessThan(MATED);
  });

  it('a pin seated in its hole: only the ring about the hole turns it; no arrow moves it', () => {
    const seat = () => [mate('concentric', ['base', HOLE], ['pin', SHANK], { align: 'aligned' }), mate('coincident', ['base', TOP], ['pin', FLANGE], { align: 'antiAligned' })];
    const pin = () => [base, floating('pin', at([20, 10, -8]), 10, [0, 0, 5])];
    for (const axis of axisList) {
      const s = drag(pin(), seat(), 'pin', { kind: 'axis', axis }, PIN_CENTER, { kind: 'axis', distance: 9 }, 10).s;
      allOk(s);
      expect(dist(s.poses.get('pin')!.position, [20, 10, -8]), `arrow ${AXIS_NAMES[axis]}`).toBeLessThan(MATED);
    }
    const { s } = drag(pin(), seat(), 'pin', { kind: 'ring', axis: 2 }, PIN_CENTER, { kind: 'ring', angle: 1.2 }, 10);
    allOk(s);
    expect(dist(turnOf(s.poses.get('pin')!, [1, 0, 0]), [Math.cos(1.2), Math.sin(1.2), 0])).toBeLessThan(MATED);
    expect(dist(s.poses.get('pin')!.position, [20, 10, -8])).toBeLessThan(MATED);
    const tip = drag(pin(), seat(), 'pin', { kind: 'ring', axis: 1 }, PIN_CENTER, { kind: 'ring', angle: 1.2 }, 10).s;
    allOk(tip);
    expect(dist(turnOf(tip.poses.get('pin')!, [0, 0, 1]), [0, 0, 1])).toBeLessThan(MATED);
  });
});

// ---------------------------------------------------------------- fuzz (AGENTS.md §3.4)

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe('fuzz: 200 random starts, mates, handles and drags (AGENTS.md §3.4)', () => {
  it('0 exceptions; the mates hold; nothing moves that the handle does not offer; free components exactly where the matrix puts them', () => {
    const r = rng(20261021);
    const u = (a: number, b: number) => a + (b - a) * r();
    let exact = 0;
    for (let i = 0; i < 200; i++) {
      const mated = r() < 0.5;
      const start = mated ? at([u(-30, 30), u(-30, 30), 0], axisAngle([0, 0, 1], u(-3, 3))) : at([u(-30, 30), u(-30, 30), u(-30, 30)], axisAngle(([u(-1, 1), u(-1, 1), u(0.1, 1)] as Vec3).map((v, _k, all) => v / Math.hypot(...all)) as Vec3, u(-3, 3)));
      const bodies = [base, floating('block', start)];
      const mates = mated ? [mate('coincident', ['base', TOP], ['block', BOTTOM], { align: 'antiAligned' })] : [];
      const kind = ['axis', 'plane', 'ring'][Math.floor(r() * 3)] as TriadHandle['kind'];
      const axis = Math.floor(r() * 3) as TriadAxis;
      const handle: TriadHandle = kind === 'plane' ? { kind, normal: axis } : { kind, axis };
      const motion: TriadMotion =
        kind === 'axis' ? { kind, distance: u(-40, 40) } : kind === 'plane' ? { kind, offset: [0, 1, 2].map((k) => (k === axis ? 0 : u(-40, 40))) as Vec3 } : { kind, angle: u(-3, 3) };
      const { grab, s } = drag(bodies, mates, 'block', handle, CENTER, motion);
      allOk(s);
      const p = s.poses.get('block')!;
      const moved = sub(transformPoint(p, CENTER), grab.centerAt);
      const a = TRIAD_AXES[axis]!;
      if (kind === 'axis') {
        expect(dist(moved, scale(a, dot(moved, a))), `case ${i}: off the axis`).toBeLessThan(1e-7);
        expect(sameTurn(p.rotation, start.rotation), `case ${i}: turned`).toBeLessThan(1e-7);
      } else if (kind === 'plane') {
        expect(Math.abs(dot(moved, a)), `case ${i}: across the plane`).toBeLessThan(1e-7);
        expect(sameTurn(p.rotation, start.rotation), `case ${i}: turned`).toBeLessThan(1e-7);
      } else {
        expect(Math.hypot(...moved), `case ${i}: the middle moved`).toBeLessThan(1e-7);
        // the ring's axis is where it was: turning about it leaves it as it is
        const partAxis = sub(transformPoint({ position: [0, 0, 0], rotation: [-start.rotation[0], -start.rotation[1], -start.rotation[2], start.rotation[3]] }, a), [0, 0, 0]);
        expect(dist(turnOf(p, partAxis), a), `case ${i}: the axis tipped`).toBeLessThan(1e-7);
      }
      if (!mated) {
        const want: Pose =
          kind === 'ring'
            ? (() => {
                const rotation = composeRotations(axisAngle(a, (motion as { angle: number }).angle), start.rotation);
                return { rotation, position: sub(grab.centerAt, sub(transformPoint({ position: [0, 0, 0], rotation }, CENTER), [0, 0, 0])) };
              })()
            : { rotation: start.rotation, position: add(start.position, kind === 'axis' ? scale(a, (motion as { distance: number }).distance) : (motion as { offset: Vec3 }).offset) };
        expect(dist(p.position, want.position), `case ${i}: position`).toBeLessThan(EXACT);
        expect(sameTurn(p.rotation, want.rotation), `case ${i}: rotation`).toBeLessThan(EXACT);
        exact++;
      }
    }
    expect(exact).toBeGreaterThan(70);
  });
});
