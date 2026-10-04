/**
 * Hardening H-9: assemblies made at random — a stack of blocks, each seated on the one below by a coincident mate of its bottom face on the top face below: the solver puts each at the
 * sum of the heights under it, square to the stack, keeps 3 freedoms for it (two slides and a turn), and says ok for every mate; the blocks that touch are not interference; the same
 * stack with one block pressed down by δ interferes by the overlap of the two footprints × δ, from the poses the solver gave; a mate to a face that is not there is said, not bound.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAssemblyCommand, applyCommand, createEmptyAssembly, createEmptyPart, transformPoint, type AssemblyDoc, type Feature, type Mate, type PartDoc, type Pose, type Vec3 } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type ShapeId } from '@3db/kernel';
import { findInterference, Regenerator, solveAssembly, type MatePart } from '@3db/regen';
import { extrude, front, rectangle, sketch } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});
afterAll(() => kept.forEach((r) => r.dispose()));

const build = (features: Feature[]): PartDoc => features.reduce((d, feature, index) => applyCommand(d, { type: 'insertFeature', feature, index }), createEmptyPart());

function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const between = (lo: number, hi: number) => lo + (hi - lo) * next();
  const round = (v: number, step = 0.5) => Math.round(v / step) * step;
  return { next, between, round };
}

interface Block {
  L: number;
  W: number;
  H: number;
  part: MatePart;
  shape: ShapeId;
}
function block(L: number, W: number, H: number): Block {
  const regen = new Regenerator(kernel, solver, new Map());
  kept.push(regen);
  const r = regen.rebuild(build([sketch('s', front, rectangle('r', 0, 0, L, W)), extrude('e', 's', 'boss', { type: 'blind', depth: String(H) })]));
  expect(r.features.every((f) => f.status === 'ok')).toBe(true);
  return { L, W, H, part: { topology: r.body!.topology, names: r.body!.names, frames: r.frames }, shape: r.body!.shape };
}

const TOP = 'e:cap:end';
const BOTTOM = 'e:cap:start';
const at = (position: Vec3): Pose => ({ position, rotation: [0, 0, 0, 1] });

function stack(blocks: Block[], r: ReturnType<typeof rng>, mates: (i: number) => Mate[] = (i) => [seat(i)]) {
  let doc: AssemblyDoc = createEmptyAssembly();
  blocks.forEach((b, i) => {
    doc = applyAssemblyCommand(doc, {
      type: 'insertComponent',
      file: { id: `file${i}`, path: `block${i}.3dbx` },
      // the first block is fixed at the origin; the others start anywhere above it
      component: { id: `c${i}`, file: `file${i}`, instance: 1, fixed: i === 0, placement: i === 0 ? at([0, 0, 0]) : at([r.between(-30, 30), r.between(-30, 30), r.between(5, 90)]) },
    });
  });
  blocks.forEach((_, i) => {
    if (i > 0) for (const m of mates(i)) doc = applyAssemblyCommand(doc, { type: 'insertMate', mate: m });
  });
  return doc;
}
const seat = (i: number): Mate => ({
  id: `m${i}`,
  name: `結合${i}`,
  type: 'coincident',
  a: { component: `c${i - 1}`, ref: { kind: 'face', name: TOP } },
  b: { component: `c${i}`, ref: { kind: 'face', name: BOTTOM } },
  suppressed: false,
  align: 'antiAligned',
});

let pressedCount = 0;
const SEEDS = Array.from({ length: 24 }, (_, i) => 9000 + i * 11);

describe('stacks of blocks made at random', () => {
  it.each(SEEDS)('seed %i: seated at the sum of the heights, 3 freedoms each, touching is not interference, pressed in is the overlap × depth', (seed) => {
    const r = rng(seed);
    const n = 2 + Math.floor(r.next() * 3);
    const blocks = Array.from({ length: n }, () => block(r.round(r.between(20, 80), 1), r.round(r.between(20, 80), 1), r.round(r.between(5, 25), 0.5)));
    const why = `assembly seed ${seed}: ${blocks.map((b) => `${b.L}×${b.W}×${b.H}`).join(' on ')}`;
    const doc = stack(blocks, r);
    const solved = solveAssembly(doc, (id) => blocks[Number(id.slice(1))]?.part ?? null);
    expect([...solved.mates.values()].map((m) => m.status), `${why}: mates`).toEqual(blocks.slice(1).map(() => 'ok'));
    expect(solved.components.get('c0'), why).toEqual({ status: 'fixed', dof: 0 });
    let floor = 0;
    const placed = blocks.map((b, i) => {
      const pose = solved.poses.get(`c${i}`)!;
      expect(pose, `${why}: c${i} placed`).toBeTruthy();
      // bottom corner and the point straight above it: z is the sum of the heights below, and the block stands square
      const lo = transformPoint(pose, [0, 0, 0]);
      const hi = transformPoint(pose, [0, 0, b.H]);
      const side = transformPoint(pose, [b.L, 0, 0]);
      expect(lo[2], `${why}: c${i} bottom`).toBeCloseTo(floor, 6);
      expect(hi[2], `${why}: c${i} top`).toBeCloseTo(floor + b.H, 6);
      expect(side[2], `${why}: c${i} level`).toBeCloseTo(floor, 6);
      if (i > 0) expect(solved.components.get(`c${i}`), `${why}: c${i} freedoms`).toEqual({ status: 'under', dof: 3 });
      floor += b.H;
      // the footprint in the plane, as a box (a quarter turn about z swaps the sides, other turns are not boxes: the corner tells which)
      const turn = Math.atan2(side[1] - lo[1], side[0] - lo[0]);
      return { pose, lo, turn };
    });

    // touching: no interference
    const parts = (poses: Pose[]) => blocks.map((b, i) => ({ id: `c${i}`, parts: [{ part: `b${i}`, mirrored: false, pose: poses[i]! }] }));
    const shapeOf = (key: string) => blocks[Number(key.slice(1))]?.shape ?? null;
    const touching = findInterference(kernel, parts(placed.map((p) => p.pose)), shapeOf);
    expect(touching.overlaps, `${why}: touching`).toHaveLength(0);

    // press the top block into the one below by δ: the overlap is the common footprint × δ
    const delta = r.round(r.between(0.5, 3), 0.5);
    const poses = placed.map((p) => p.pose);
    const k = n - 1;
    poses[k] = { ...poses[k]!, position: [poses[k]!.position[0], poses[k]!.position[1], poses[k]!.position[2] - delta] };
    const pressed = findInterference(kernel, parts(poses), shapeOf);
    try {
      // the footprints from the corners the solver gave, turned by its angle; the overlap in the plane by clipping one by the other
      const lower = blocks[k - 1]!;
      const upper = blocks[k]!;
      const a = placed[k - 1]!;
      const b = placed[k]!;
      const common = overlapArea(footprint(a.lo, a.turn, lower.L, lower.W), footprint(b.lo, b.turn, upper.L, upper.W));
      const expected = common * delta;
      if (common < 1e-6) expect(pressed.overlaps, `${why}: pressed beside`).toHaveLength(0);
      else {
        expect(pressed.overlaps, `${why}: pressed`).toHaveLength(1);
        expect(Math.abs(pressed.overlaps[0]!.volume - expected) / expected, `${why}: pressed volume ${pressed.overlaps[0]!.volume} vs ${expected}`).toBeLessThan(1e-4);
        pressedCount++;
      }
    } finally {
      pressed.overlaps.forEach((o) => kernel.release(o.shape));
    }
  }, 120000);

  it('most of the stacks were pressed into an overlap that was measured', () => {
    expect(pressedCount).toBeGreaterThanOrEqual(Math.ceil(SEEDS.length * 0.5));
  });

  it('a mate to a face that is not there is said, and the block is not moved to another face', () => {
    const r = rng(1);
    const blocks = [block(40, 30, 10), block(30, 30, 10)];
    const lost: Mate = { ...seat(1), id: 'lost', a: { component: 'c0', ref: { kind: 'face', name: 'e:cap:nowhere' } } };
    const solved = solveAssembly(stack(blocks, r, () => [lost]), (id) => blocks[Number(id.slice(1))]?.part ?? null);
    expect(solved.mates.get('lost')!.status).toBe('missing');
  });
});

type Corner = [number, number];
/** The four corners of a footprint: the corner the block starts at, its turn about z, its sides. */
function footprint(lo: Vec3, turn: number, L: number, W: number): Corner[] {
  const c = Math.cos(turn);
  const s = Math.sin(turn);
  return ([[0, 0], [L, 0], [L, W], [0, W]] as Corner[]).map(([x, y]) => [lo[0] + x * c - y * s, lo[1] + x * s + y * c]);
}

/** Area shared by two convex polygons (Sutherland–Hodgman clip of one by the other). */
function overlapArea(subject: Corner[], clip: Corner[]): number {
  const area = (p: Corner[]) => Math.abs(p.reduce((a, q, i) => a + q[0] * p[(i + 1) % p.length]![1] - p[(i + 1) % p.length]![0] * q[1], 0)) / 2;
  const sign = Math.sign(clip.reduce((a, q, i) => a + q[0] * clip[(i + 1) % clip.length]![1] - clip[(i + 1) % clip.length]![0] * q[1], 0));
  let out = subject;
  for (let i = 0; i < clip.length && out.length > 0; i++) {
    const a = clip[i]!;
    const b = clip[(i + 1) % clip.length]!;
    const inside = (p: Corner) => sign * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) >= 0;
    const cross = (p: Corner, q: Corner): Corner => {
      const dp = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
      const dq = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
      const t = dp / (dp - dq);
      return [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])];
    };
    const input = out;
    out = [];
    input.forEach((p, j) => {
      const q = input[(j + 1) % input.length]!;
      if (inside(p)) {
        out.push(p);
        if (!inside(q)) out.push(cross(p, q));
      } else if (inside(q)) out.push(cross(p, q));
    });
  }
  return out.length < 3 ? 0 : area(out);
}
