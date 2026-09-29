import { describe, expect, it } from 'vitest';
import { axisAngle, IDENTITY_ROTATION, transformPoint, type Pose, type Vec3 } from '@3db/model';
import { solve, type MateGeometry, type MateSpec, type MateType, type SolverBody } from '../src';

// ---------------------------------------------------------------- helpers

const at = (position: Vec3, rotation = IDENTITY_ROTATION): Pose => ({ position, rotation: [...rotation] });
const tilted = (position: Vec3) => at(position, axisAngle([0.6, 0.8, 0], 0.35));
const base: SolverBody = { id: 'base', fixed: true, pose: at([0, 0, 0]) };
const floating = (id: string, pose: Pose, size = 20): SolverBody => ({ id, fixed: false, pose, size });

const plane = (origin: Vec3, normal: Vec3): MateGeometry => ({ kind: 'plane', origin, normal });
const line = (origin: Vec3, dir: Vec3): MateGeometry => ({ kind: 'line', origin, dir });
const point = (p: Vec3): MateGeometry => ({ kind: 'point', point: p });
const cylinder = (origin: Vec3, axis: Vec3, radius: number, convex = true): MateGeometry => ({ kind: 'cylinder', origin, axis, radius, convex });
const sphere = (center: Vec3, radius: number, convex = true): MateGeometry => ({ kind: 'sphere', center, radius, convex });

let ids = 0;
const mate = (type: MateType, a: [string | null, MateGeometry], b: [string | null, MateGeometry], extra: Partial<MateSpec> = {}): MateSpec => ({
  id: `m${++ids}`,
  type,
  a: { body: a[0], geom: a[1] },
  b: { body: b[0], geom: b[1] },
  ...extra,
});

/** A point / direction of body `id`'s part, where the solution put it. */
const where = (s: ReturnType<typeof solve>, id: string, p: Vec3) => transformPoint(s.poses.get(id)!, p);
const turned = (s: ReturnType<typeof solve>, id: string, d: Vec3) => {
  const o = where(s, id, [0, 0, 0]);
  const e = where(s, id, d);
  return [e[0] - o[0], e[1] - o[1], e[2] - o[2]] as Vec3;
};
const close = (a: Vec3, b: Vec3, digits = 7) => a.forEach((v, i) => expect(v, `component ${i}: ${a} vs ${b}`).toBeCloseTo(b[i]!, digits));
const allOk = (s: ReturnType<typeof solve>) => expect([...s.mates.values()].filter((m) => m.status !== 'ok')).toEqual([]);

// The fixed base: a plate whose top face is z = 0 and whose left and front faces are x = -50 and y = -30.
const TOP = plane([0, 0, 0], [0, 0, 1]);
const LEFT = plane([-50, 0, -10], [-1, 0, 0]);
const FRONT = plane([0, -30, -10], [0, -1, 0]);
// A 20 × 20 × 20 block with its corner at its origin; bottom z = 0, left x = 0, front y = 0.
const BOTTOM = plane([10, 10, 0], [0, 0, -1]);
const BLOCK_LEFT = plane([0, 10, 10], [-1, 0, 0]);
const BLOCK_FRONT = plane([10, 0, 10], [0, -1, 0]);

// ---------------------------------------------------------------- each mate against its closed form

describe('standard mates (C15.8), each against its closed-form solution', () => {
  it('重合 plane–plane: face to face, three freedoms left; the free ones keep the placement', () => {
    const block = { ...floating('block', tilted([7, 5, 12])), pivot: [10, 10, 10] as Vec3 };
    const s = solve([base, block], [mate('coincident', ['base', TOP], ['block', BOTTOM], { align: 'antiAligned' })]);
    allOk(s);
    close(turned(s, 'block', [0, 0, -1]), [0, 0, -1]);
    expect(where(s, 'block', [10, 10, 0])[2]).toBeCloseTo(0, 7);
    expect(s.bodies.get('block')).toEqual({ status: 'under', dof: 3 });
    // Moving along the face or turning about its normal breaks nothing: the pivot keeps its x and y.
    const pivot0 = transformPoint(block.pose, [10, 10, 10]);
    const pivot = where(s, 'block', [10, 10, 10]);
    expect(pivot[0]).toBeCloseTo(pivot0[0], 9);
    expect(pivot[1]).toBeCloseTo(pivot0[1], 9);
  });

  it('重合 aligned: the other way round, even from exactly the wrong way', () => {
    const s = solve([base, floating('block', at([0, 0, 30]))], [mate('coincident', ['base', TOP], ['block', plane([0, 0, 0], [0, 0, 1])], { align: 'antiAligned' })]);
    allOk(s);
    close(turned(s, 'block', [0, 0, 1]), [0, 0, -1]);
  });

  it('重合 with points and lines: one, two and three freedoms taken', () => {
    const p = solve([base, floating('pin', tilted([3, 4, 20]))], [mate('coincident', ['base', TOP], ['pin', point([0, 0, -5])])]);
    allOk(p);
    expect(where(p, 'pin', [0, 0, -5])[2]).toBeCloseTo(0, 7);
    expect(p.bodies.get('pin')!.dof).toBe(5);
    const l = solve([base, floating('rod', tilted([3, 4, 20]))], [mate('coincident', ['base', TOP], ['rod', line([0, 0, 0], [1, 0, 0])])]);
    allOk(l);
    expect(turned(l, 'rod', [1, 0, 0])[2]).toBeCloseTo(0, 7);
    expect(where(l, 'rod', [0, 0, 0])[2]).toBeCloseTo(0, 7);
    expect(l.bodies.get('rod')!.dof).toBe(4);
    const pp = solve([base, floating('ball', tilted([3, 4, 20]))], [mate('coincident', ['base', point([10, 20, 30])], ['ball', point([1, 2, 3])])]);
    allOk(pp);
    close(where(pp, 'ball', [1, 2, 3]), [10, 20, 30]);
    expect(pp.bodies.get('ball')!.dof).toBe(3);
  });

  it('同軸心 pin in hole: two freedoms (turn about and slide along the axis); with the flange on the face, one', () => {
    const hole = cylinder([20, 10, -15], [0, 0, 1], 4, false);
    const pin = { ...floating('pin', tilted([25, 14, 30])), pivot: [0, 0, 5] as Vec3 };
    const shaft = cylinder([0, 0, 0], [0, 0, 1], 4);
    const s = solve([base, pin], [mate('concentric', ['base', hole], ['pin', shaft], { align: 'aligned' })]);
    allOk(s);
    close(turned(s, 'pin', [0, 0, 1]), [0, 0, 1]);
    const axisPoint = where(s, 'pin', [0, 0, 0]);
    expect(axisPoint[0]).toBeCloseTo(20, 7);
    expect(axisPoint[1]).toBeCloseTo(10, 7);
    expect(s.bodies.get('pin')).toEqual({ status: 'under', dof: 2 });
    const flange = plane([0, 0, 8], [0, 0, -1]);
    const seated = solve([base, pin], [mate('concentric', ['base', hole], ['pin', shaft], { align: 'aligned' }), mate('coincident', ['base', TOP], ['pin', flange], { align: 'antiAligned' })]);
    allOk(seated);
    expect(where(seated, 'pin', [0, 0, 8])[2]).toBeCloseTo(0, 7);
    expect(seated.bodies.get('pin')).toEqual({ status: 'under', dof: 1 });
  });

  it('平行 and 垂直', () => {
    const par = solve([base, floating('block', tilted([0, 0, 30]))], [mate('parallel', ['base', TOP], ['block', plane([0, 0, 0], [0, 1, 0])], { align: 'aligned' })]);
    allOk(par);
    close(turned(par, 'block', [0, 1, 0]), [0, 0, 1]);
    expect(par.bodies.get('block')!.dof).toBe(4);
    const perp = solve([base, floating('block', tilted([0, 0, 30]))], [mate('perpendicular', ['base', TOP], ['block', plane([0, 0, 0], [0, 0, 1])])]);
    allOk(perp);
    expect(turned(perp, 'block', [0, 0, 1])[2]).toBeCloseTo(0, 7);
    expect(perp.bodies.get('block')!.dof).toBe(5);
    const axes = solve([base, floating('rod', tilted([0, 0, 30]))], [mate('perpendicular', ['base', TOP], ['rod', line([0, 0, 0], [1, 0, 0])])]);
    allOk(axes);
    close(turned(axes, 'rod', [1, 0, 0]).map(Math.abs) as Vec3, [0, 0, 1]);
    expect(axes.bodies.get('rod')!.dof).toBe(4);
  });

  it('相切: a shaft on a face, a shaft against a shaft, a ball in a hole', () => {
    const shaft = cylinder([0, 0, 0], [1, 0, 0], 6);
    const onFace = solve([base, floating('shaft', tilted([0, 0, 25]))], [mate('tangent', ['base', TOP], ['shaft', shaft])]);
    allOk(onFace);
    expect(where(onFace, 'shaft', [0, 0, 0])[2]).toBeCloseTo(6, 7);
    expect(turned(onFace, 'shaft', [1, 0, 0])[2]).toBeCloseTo(0, 7);
    expect(onFace.bodies.get('shaft')!.dof).toBe(4);
    const roller = cylinder([0, 20, 10], [1, 0, 0], 10);
    const outside = solve([base, floating('shaft', tilted([0, 0, 25]))], [mate('tangent', ['base', roller], ['shaft', shaft])]);
    allOk(outside);
    const c = where(outside, 'shaft', [0, 0, 0]);
    expect(Math.hypot(c[1] - 20, c[2] - 10)).toBeCloseTo(16, 7);
    const bore = cylinder([0, 0, 0], [0, 0, 1], 10, false);
    const ball = solve([base, floating('ball', at([3, 1, 5]))], [mate('tangent', ['base', bore], ['ball', sphere([0, 0, 0], 4)])]);
    allOk(ball);
    const b = where(ball, 'ball', [0, 0, 0]);
    expect(Math.hypot(b[0], b[1])).toBeCloseTo(6, 7);
  });

  it('距離 between faces, on either side; 角度 between faces', () => {
    const d = solve([base, floating('block', tilted([0, 0, 30]))], [mate('distance', ['base', TOP], ['block', BOTTOM], { value: 12, align: 'antiAligned' })]);
    allOk(d);
    expect(where(d, 'block', [10, 10, 0])[2]).toBeCloseTo(12, 7);
    close(turned(d, 'block', [0, 0, -1]), [0, 0, -1]);
    expect(d.bodies.get('block')!.dof).toBe(3);
    const below = solve([base, floating('block', tilted([0, 0, -30]))], [mate('distance', ['base', TOP], ['block', BOTTOM], { value: 12, align: 'antiAligned', flip: true })]);
    allOk(below);
    expect(where(below, 'block', [10, 10, 0])[2]).toBeCloseTo(-12, 7);
    const angle = solve([base, floating('flap', tilted([0, 0, 30]))], [mate('angle', ['base', TOP], ['flap', plane([0, 0, 0], [0, 0, 1])], { value: Math.PI / 6 })]);
    allOk(angle);
    const nz = turned(angle, 'flap', [0, 0, 1])[2];
    expect(nz).toBeCloseTo(Math.cos(Math.PI / 6), 7);
    expect(angle.bodies.get('flap')!.dof).toBe(5);
    const points = solve([base, floating('ball', tilted([9, 9, 9]))], [mate('distance', ['base', point([0, 0, 0])], ['ball', point([0, 0, 0])], { value: 25 })]);
    allOk(points);
    expect(Math.hypot(...where(points, 'ball', [0, 0, 0]))).toBeCloseTo(25, 7);
  });

  it('鎖住: the relative pose is kept; nothing is left free', () => {
    const relative = at([5, 6, 7], axisAngle([0, 0, 1], 0.5));
    const s = solve([base, floating('cap', tilted([30, 30, 30]))], [mate('lock', ['base', point([0, 0, 0])], ['cap', point([0, 0, 0])], { relative })]);
    allOk(s);
    close(where(s, 'cap', [0, 0, 0]), [5, 6, 7]);
    close(turned(s, 'cap', [1, 0, 0]), [Math.cos(0.5), Math.sin(0.5), 0]);
    expect(s.bodies.get('cap')).toEqual({ status: 'full', dof: 0 });
  });
});

// ---------------------------------------------------------------- freedoms and conflicts (A3.4)

describe('freedoms left and conflicts (A3.4)', () => {
  it('a block against three faces of a corner is fully defined', () => {
    const s = solve(
      [base, { ...floating('block', tilted([-40, -20, 15])), pivot: [10, 10, 10] }],
      [
        mate('coincident', ['base', TOP], ['block', BOTTOM], { align: 'antiAligned' }),
        mate('coincident', ['base', plane([-50, 0, 0], [1, 0, 0])], ['block', BLOCK_LEFT], { align: 'antiAligned' }),
        mate('coincident', ['base', plane([0, -30, 0], [0, 1, 0])], ['block', BLOCK_FRONT], { align: 'antiAligned' }),
      ],
    );
    allOk(s);
    expect(s.bodies.get('block')).toEqual({ status: 'full', dof: 0 });
    close(where(s, 'block', [0, 0, 0]), [-50, -30, 0]);
    void LEFT;
    void FRONT;
  });

  it('names the mate that cannot hold with the ones before it; the others still hold', () => {
    const first = mate('coincident', ['base', TOP], ['block', BOTTOM], { align: 'antiAligned' });
    const second = mate('distance', ['base', TOP], ['block', BOTTOM], { value: 10, align: 'antiAligned' });
    const s = solve([base, floating('block', tilted([0, 0, 30]))], [first, second]);
    expect(s.mates.get(first.id)).toEqual({ status: 'ok' });
    expect(s.mates.get(second.id)!.status).toBe('conflict');
    expect(where(s, 'block', [10, 10, 0])[2]).toBeCloseTo(0, 7);
    expect(s.bodies.get('block')!.status).toBe('over');
  });

  it('accepts mates that repeat what others already say', () => {
    const s = solve(
      [base, floating('block', tilted([0, 0, 30]))],
      [mate('coincident', ['base', TOP], ['block', BOTTOM], { align: 'antiAligned' }), mate('parallel', ['base', TOP], ['block', BOTTOM], { align: 'antiAligned' })],
    );
    allOk(s);
    expect(s.bodies.get('block')).toEqual({ status: 'under', dof: 3 });
  });

  it('checks mates between components that never move', () => {
    const lid: SolverBody = { id: 'lid', fixed: true, pose: at([0, 0, 5]) };
    const holds = mate('coincident', ['base', TOP], ['lid', plane([0, 0, -5], [0, 0, -1])], { align: 'antiAligned' });
    const breaks = mate('distance', ['base', TOP], ['lid', plane([0, 0, -5], [0, 0, -1])], { value: 3, align: 'antiAligned' });
    const s = solve([base, lid], [holds, breaks]);
    expect(s.mates.get(holds.id)).toEqual({ status: 'ok' });
    expect(s.mates.get(breaks.id)!.status).toBe('conflict');
    expect(s.bodies.get('lid')).toEqual({ status: 'fixed', dof: 0 });
  });

  it('says which pairs a mate cannot join, and never moves anything for them', () => {
    const m = mate('concentric', ['base', TOP], ['block', BOTTOM]);
    const s = solve([base, floating('block', at([1, 2, 3]))], [m]);
    expect(s.mates.get(m.id)).toEqual({ status: 'unsupported', message: '同軸心不適用於平面與平面' });
    close(s.poses.get('block')!.position, [1, 2, 3]);
    expect(s.bodies.get('block')).toEqual({ status: 'under', dof: 6 });
  });

  it('solves components mated to each other together', () => {
    // A slider on the base's top face, and a pin through the slider's hole.
    const slider = { ...floating('slider', tilted([10, 10, 20])), pivot: [0, 0, 5] as Vec3 };
    const pin = floating('pin', tilted([30, 0, 40]), 10);
    const s = solve(
      [base, slider, pin],
      [
        mate('coincident', ['base', TOP], ['slider', plane([0, 0, 0], [0, 0, -1])], { align: 'antiAligned' }),
        mate('concentric', ['slider', cylinder([0, 0, 0], [0, 0, 1], 3, false)], ['pin', cylinder([0, 0, 0], [0, 0, 1], 3)], { align: 'aligned' }),
        mate('coincident', ['slider', plane([0, 0, 10], [0, 0, 1])], ['pin', plane([0, 0, 2], [0, 0, -1])], { align: 'antiAligned' }),
      ],
    );
    allOk(s);
    expect(s.bodies.get('slider')!.dof).toBe(3);
    // The pin rides with the slider (along the face, turning about z) and turns in its hole, also about
    // z: three moves of its own. It can move, so it is under-defined, as in SolidWorks.
    expect(s.bodies.get('pin')).toEqual({ status: 'under', dof: 3 });
    expect(where(s, 'pin', [0, 0, 2])[2]).toBeCloseTo(10, 7);
  });

  it('leaves the freedoms the mates do not take where the placement put them', () => {
    // Parallel to the hole but beside it: the pin moves across to the axis, not along it.
    const hole = cylinder([20, 10, 0], [0, 0, 1], 4, false);
    const s = solve([base, floating('pin', at([23, 14, 37]))], [mate('concentric', ['base', hole], ['pin', cylinder([0, 0, 0], [0, 0, 1], 4)], { align: 'aligned' })]);
    allOk(s);
    close(s.poses.get('pin')!.position, [20, 10, 37], 9);
    s.poses.get('pin')!.rotation.forEach((v, i) => expect(v).toBeCloseTo(IDENTITY_ROTATION[i]!, 9));
  });

  it('moves nothing when the mates already hold', () => {
    const mates = [
      mate('concentric', ['base', cylinder([20, 10, 0], [0, 0, 1], 4, false)], ['pin', cylinder([0, 0, 0], [0, 0, 1], 4)], { align: 'aligned' }),
      mate('coincident', ['base', TOP], ['pin', plane([0, 0, 8], [0, 0, -1])], { align: 'antiAligned' }),
    ];
    const first = solve([base, floating('pin', tilted([25, 14, 30]))], mates);
    const again = solve([base, floating('pin', first.poses.get('pin')!)], mates);
    close(again.poses.get('pin')!.position, first.poses.get('pin')!.position, 9);
  });

  it('mates to the assembly itself (its planes never move)', () => {
    const s = solve(
      [floating('block', tilted([5, 5, 5]))],
      [mate('coincident', [null, plane([0, 0, 0], [0, 0, 1])], ['block', plane([0, 0, 0], [0, 0, 1])], { align: 'aligned' }), mate('coincident', [null, plane([0, 0, 0], [1, 0, 0])], ['block', plane([0, 0, 0], [1, 0, 0])], { align: 'aligned' })],
    );
    allOk(s);
    expect(where(s, 'block', [0, 0, 0])[2]).toBeCloseTo(0, 7);
    expect(where(s, 'block', [0, 0, 0])[0]).toBeCloseTo(0, 7);
    // Only sliding along the line where the two planes meet is left.
    expect(s.bodies.get('block')!.dof).toBe(1);
  });

  it('a shaft tangent inside a bore sits off its axis by the difference of the radii', () => {
    const s = solve([base, floating('shaft', tilted([1, 2, 10]))], [mate('tangent', ['base', cylinder([0, 0, 0], [0, 0, 1], 10, false)], ['shaft', cylinder([0, 0, 0], [0, 0, 1], 4)])]);
    allOk(s);
    const c = where(s, 'shaft', [0, 0, 0]);
    const d = turned(s, 'shaft', [0, 0, 1]);
    expect(Math.abs(d[2])).toBeCloseTo(1, 7);
    expect(Math.hypot(c[0], c[1])).toBeCloseTo(6, 7);
  });

  it('turns the part round when the alignment is flipped', () => {
    const hole = cylinder([0, 0, 0], [0, 0, 1], 4, false);
    const shaft = cylinder([0, 0, 0], [0, 0, 1], 4);
    const aligned = solve([base, floating('pin', at([0, 0, 20]))], [mate('concentric', ['base', hole], ['pin', shaft], { align: 'aligned' })]);
    const anti = solve([base, floating('pin', at([0, 0, 20]))], [mate('concentric', ['base', hole], ['pin', shaft], { align: 'antiAligned' })]);
    allOk(anti);
    close(turned(aligned, 'pin', [0, 0, 1]), [0, 0, 1]);
    close(turned(anti, 'pin', [0, 0, 1]), [0, 0, -1]);
  });

  it('refuses a mate between two elements of one component', () => {
    const m = mate('coincident', ['block', BOTTOM], ['block', BLOCK_LEFT]);
    expect(solve([base, floating('block', at([0, 0, 0]))], [m]).mates.get(m.id)).toEqual({ status: 'unsupported', message: '結合的兩個元素必須在不同的零組件上' });
  });

  it('gives the same answer every time', () => {
    const run = () => solve([base, floating('pin', tilted([25, 14, 30]))], [mate('concentric', ['base', cylinder([20, 10, 0], [0, 0, 1], 4, false)], ['pin', cylinder([0, 0, 0], [0, 0, 1], 4)], { id: 'fixed-id' } as Partial<MateSpec>)]);
    expect(run().poses).toEqual(run().poses);
  });
});

// ---------------------------------------------------------------- performance

describe('20 components (blueprint §2.5: 50 ms)', () => {
  /** The fastest of a few runs: other test files share the machine, and only the solver's own time counts. */
  const timed = (run: () => ReturnType<typeof solve>) => {
    run(); // warm up the JIT
    const runs = [run(), run(), run()];
    return { s: runs[0]!, ms: Math.min(...runs.map((r) => r.ms)) };
  };

  /** Pins stacked in a column: each sits concentric and flush on the one below; the first on the base. */
  function column(count: number) {
    const bodies: SolverBody[] = [base];
    const mates: MateSpec[] = [];
    for (let i = 1; i < count; i++) {
      bodies.push({ id: `p${i}`, fixed: false, pose: at([2 * i, -i, 12 * i + 3], axisAngle([1, 0, 0], 0.05 * i)), pivot: [0, 0, 5], size: 10 });
      const below: string | null = i === 1 ? 'base' : `p${i - 1}`;
      const top = i === 1 ? TOP : plane([0, 0, 10], [0, 0, 1]);
      const axis = i === 1 ? cylinder([0, 0, 0], [0, 0, 1], 5, false) : cylinder([0, 0, 0], [0, 0, 1], 5);
      mates.push(mate('concentric', [below, axis], [`p${i}`, cylinder([0, 0, 0], [0, 0, 1], 5)], { align: 'aligned' }));
      mates.push(mate('coincident', [below, top], [`p${i}`, plane([0, 0, 0], [0, 0, -1])], { align: 'antiAligned' }));
    }
    return { bodies, mates };
  }

  it('a column of 19 pins mated to each other: one group, each pin free only to turn about the common axis', () => {
    const { bodies, mates } = column(20);
    const { s, ms } = timed(() => solve(bodies, mates));
    allOk(s);
    expect(where(s, 'p19', [0, 0, 0])[2]).toBeCloseTo(18 * 10, 6);
    for (let i = 1; i < 20; i++) expect(s.bodies.get(`p${i}`)).toEqual({ status: 'under', dof: 1 });
    console.log(`column of 19: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(50);
  });

  it('names a conflict inside the column quickly, and keeps the rest', () => {
    const { bodies, mates } = column(20);
    const wrong = mate('distance', ['base', TOP], ['p19', plane([0, 0, 10], [0, 0, 1])], { value: 150, align: 'aligned' });
    const { s, ms } = timed(() => solve(bodies, [...mates, wrong]));
    expect([...s.mates].filter(([, r]) => r.status !== 'ok').map(([id]) => id)).toEqual([wrong.id]);
    expect(s.bodies.get('p19')!.status).toBe('over');
    expect(where(s, 'p19', [0, 0, 0])[2]).toBeCloseTo(180, 6);
    // Finding a conflict has no budget in the blueprint (about 65 ms here when the machine is idle); this
    // only catches a slide back to solving once per mate.
    console.log(`column of 19 with a conflict: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(1000);
  });

  it('19 pins each seated in the fixed base: nineteen small groups', () => {
    const bodies: SolverBody[] = [base];
    const mates: MateSpec[] = [];
    for (let i = 1; i < 20; i++) {
      bodies.push({ id: `p${i}`, fixed: false, pose: tilted([10 * i, 5, 20]), pivot: [0, 0, 5], size: 10 });
      mates.push(mate('concentric', ['base', cylinder([10 * i, 0, 0], [0, 0, 1], 5, false)], [`p${i}`, cylinder([0, 0, 0], [0, 0, 1], 5)], { align: 'aligned' }));
      mates.push(mate('coincident', ['base', TOP], [`p${i}`, plane([0, 0, 0], [0, 0, -1])], { align: 'antiAligned' }));
    }
    const { s, ms } = timed(() => solve(bodies, mates));
    allOk(s);
    for (let i = 1; i < 20; i++) expect(s.bodies.get(`p${i}`)!.dof).toBe(1);
    console.log(`19 seated pins: ${ms.toFixed(1)} ms`);
    expect(ms).toBeLessThan(50);
  });
});
