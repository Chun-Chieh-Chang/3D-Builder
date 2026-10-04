/**
 * Hardening H-10: assemblies made at random with the other mates —
 *  (1) a block set on another by a distance mate and held flush with two of its sides (coincident, aligned): it is fully defined (0 freedoms), its corner is where the flush sides put
 *      it (the origin side or the far side) and its bottom is the gap above the top of the one below; shifted into it the overlap is the common footprint × the depth;
 *  (2) a pin in a hole by a concentric mate and its end on the plate: the axis is the hole's axis at the top of the plate, one freedom (the turn); pushed down by δ the pin interferes by
 *      the ring between the two radii × δ when it is the larger, and not at all when it is the smaller.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAssemblyCommand, applyCommand, createEmptyAssembly, createEmptyPart, transformPoint, type AssemblyDoc, type Feature, type Mate, type PartDoc, type Pose, type Vec3 } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type ShapeId } from '@3db/kernel';
import { faceMateGeometry, findInterference, Regenerator, solveAssembly, type MatePart } from '@3db/regen';
import { circle, extrude, front, rectangle, sketch } from '../phase1/builders';

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

interface Made {
  part: MatePart;
  shape: ShapeId;
}
function make(features: Feature[]): Made {
  const regen = new Regenerator(kernel, solver, new Map());
  kept.push(regen);
  const r = regen.rebuild(build(features));
  expect(r.features.every((f) => f.status === 'ok')).toBe(true);
  return { part: { topology: r.body!.topology, names: r.body!.names, frames: r.frames }, shape: r.body!.shape };
}

const at = (position: Vec3): Pose => ({ position, rotation: [0, 0, 0, 1] });
const face = (name: string) => ({ kind: 'face' as const, name });
let ids = 0;
const mate = (type: Mate['type'], a: [string, string], b: [string, string], extra: Partial<Mate> = {}): Mate => ({ id: `m${++ids}`, name: `結合${ids}`, type, a: { component: a[0], ref: face(a[1]) }, b: { component: b[0], ref: face(b[1]) }, suppressed: false, ...extra });

function assembly(files: string[], mates: Mate[], r: ReturnType<typeof rng>): AssemblyDoc {
  let doc: AssemblyDoc = createEmptyAssembly();
  files.forEach((path, i) => {
    doc = applyAssemblyCommand(doc, {
      type: 'insertComponent',
      file: { id: `file${i}`, path },
      component: { id: `c${i}`, file: `file${i}`, instance: 1, fixed: i === 0, placement: i === 0 ? at([0, 0, 0]) : at([r.between(-30, 30), r.between(-30, 30), r.between(5, 90)]) },
    });
  });
  for (const m of mates) doc = applyAssemblyCommand(doc, { type: 'insertMate', mate: m });
  return doc;
}

/** Which side face of a rectangle block (names `<prefix>l0` to `l3`) is the one at the least x, the greatest x, the least y, the greatest y. */
function sides(m: Made, prefix: string): { minX: string; maxX: string; minY: string; maxY: string } {
  const found: Record<string, string> = {};
  m.part.topology.faces.forEach((f, i) => {
    const g = faceMateGeometry(f);
    const name = m.part.names.faces[i]!;
    if (g?.kind !== 'plane' || !name.startsWith(`e:side:s.${prefix}`)) return;
    const [nx, ny] = g.normal;
    if (nx < -0.9) found.minX = name;
    else if (nx > 0.9) found.maxX = name;
    else if (ny < -0.9) found.minY = name;
    else if (ny > 0.9) found.maxY = name;
  });
  return found as never;
}

const overlapOfBoxes = (a: [number, number, number, number], b: [number, number, number, number]) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));

const FLUSH = Array.from({ length: 20 }, (_, i) => 9500 + i * 17);
let shifted = 0;

describe('a block set on another by a distance and held flush (made at random)', () => {
  it.each(FLUSH)('seed %i: fully defined, at the corner the flush sides give and the gap above', (seed) => {
    const r = rng(seed);
    const L1 = r.round(r.between(40, 90), 1);
    const W1 = r.round(r.between(40, 90), 1);
    const H1 = r.round(r.between(5, 20), 0.5);
    const L2 = r.round(r.between(15, L1), 1);
    const W2 = r.round(r.between(15, W1), 1);
    const H2 = r.round(r.between(5, 20), 0.5);
    const gap = r.round(r.between(0, 12), 0.5);
    const far = r.next() < 0.5;
    const a = make([sketch('s', front, rectangle('r', 0, 0, L1, W1)), extrude('e', 's', 'boss', { type: 'blind', depth: String(H1) })]);
    const b = make([sketch('s', front, rectangle('r', 0, 0, L2, W2)), extrude('e', 's', 'boss', { type: 'blind', depth: String(H2) })]);
    const sa = sides(a, 'r');
    const sb = sides(b, 'r');
    const why = `flush seed ${seed}: ${L1}×${W1}×${H1} under ${L2}×${W2}×${H2}, gap ${gap}, flush at the ${far ? 'far' : 'origin'} sides`;
    expect(Object.keys(sa).length, `${why}: the sides of the block were found`).toBe(4);
    const flushX: [string, string] = far ? [sa.maxX, sb.maxX] : [sa.minX, sb.minX];
    const flushY: [string, string] = far ? [sa.maxY, sb.maxY] : [sa.minY, sb.minY];
    const mates = [
      mate('distance', ['c0', 'e:cap:end'], ['c1', 'e:cap:start'], { value: String(gap), align: 'antiAligned' }),
      mate('coincident', ['c0', flushX[0]], ['c1', flushX[1]], { align: 'aligned' }),
      mate('coincident', ['c0', flushY[0]], ['c1', flushY[1]], { align: 'aligned' }),
    ];
    const doc = assembly(['a.3dbx', 'b.3dbx'], mates, r);
    const parts: Record<string, Made> = { c0: a, c1: b };
    const solved = solveAssembly(doc, (id) => parts[id]?.part ?? null);
    expect([...solved.mates.values()].map((m) => m.status), `${why}: mates`).toEqual(['ok', 'ok', 'ok']);
    expect(solved.components.get('c1'), `${why}: freedoms`).toEqual({ status: 'full', dof: 0 });
    const pose = solved.poses.get('c1')!;
    const lo = transformPoint(pose, [0, 0, 0]);
    const expected: Vec3 = far ? [L1 - L2, W1 - W2, H1 + gap] : [0, 0, H1 + gap];
    lo.forEach((v, i) => expect(v, `${why}: corner ${i}`).toBeCloseTo(expected[i]!, 6));
    // square to the first block: its sides point along the axes
    const side = transformPoint(pose, [L2, 0, 0]);
    expect([side[0] - lo[0], side[1] - lo[1], side[2] - lo[2]].map((v, i) => Math.abs(v - [L2, 0, 0][i]!)).every((v) => v < 1e-6), `${why}: square`).toBe(true);

    // nothing in common while it is set on; pressed through the gap and δ more it shares the common footprint × δ
    const shapeOf = (key: string) => parts[key === 'a' ? 'c0' : 'c1']!.shape;
    const comps = (p1: Pose) => [{ id: 'c0', parts: [{ part: 'a', mirrored: false, pose: at([0, 0, 0]) }] }, { id: 'c1', parts: [{ part: 'b', mirrored: false, pose: p1 }] }];
    const seated = findInterference(kernel, comps(pose), shapeOf);
    expect(seated.overlaps, `${why}: seated`).toHaveLength(0);
    const delta = Math.min(r.round(r.between(0.5, 4), 0.5), H1, H2);
    const pressed = findInterference(kernel, comps({ ...pose, position: [pose.position[0], pose.position[1], pose.position[2] - gap - delta] }), shapeOf);
    try {
      expect(pressed.overlaps, `${why}: pressed`).toHaveLength(1);
      const common = overlapOfBoxes([0, 0, L1, W1], [lo[0], lo[1], lo[0] + L2, lo[1] + W2]);
      expect(Math.abs(pressed.overlaps[0]!.volume - common * delta) / (common * delta), `${why}: pressed volume`).toBeLessThan(1e-6);
      shifted++;
    } finally {
      pressed.overlaps.forEach((o) => kernel.release(o.shape));
    }
  }, 120000);

  it('every one was pressed into an overlap that was measured', () => {
    expect(shifted).toBe(FLUSH.length);
  });
});

const PINS = Array.from({ length: 20 }, (_, i) => 9700 + i * 19);

describe('a pin in a hole (made at random)', () => {
  it.each(PINS)('seed %i: on the hole\'s axis, on the plate, one freedom, the ring it fills when the larger', (seed) => {
    const r = rng(seed);
    const L = r.round(r.between(50, 100), 1);
    const W = r.round(r.between(50, 100), 1);
    const H = r.round(r.between(6, 20), 0.5);
    const hx = r.round(r.between(20, L - 20), 1);
    const hy = r.round(r.between(20, W - 20), 1);
    const rh = r.round(r.between(2, 8), 0.5);
    const larger = r.next() < 0.5;
    const rp = larger ? rh + r.round(r.between(0.5, 4), 0.5) : rh - r.round(r.between(0.25, 1.5), 0.25);
    const h = r.round(r.between(8, 30), 1);
    const plate = make([sketch('s', front, rectangle('r', 0, 0, L, W)), extrude('e', 's', 'boss', { type: 'blind', depth: String(H) }), sketch('s2', front, circle('k', hx, hy, rh)), extrude('c', 's2', 'cut', { type: 'throughAll', reverse: true })]);
    const pin = make([sketch('s', front, circle('c0', 0, 0, rp)), extrude('e', 's', 'boss', { type: 'blind', depth: String(h) })]);
    const why = `pin seed ${seed}: plate ${L}×${W}×${H}, hole R${rh} at (${hx}, ${hy}), pin R${rp} × ${h}`;
    const doc = assembly(['plate.3dbx', 'pin.3dbx'], [mate('concentric', ['c0', 'c:side:s2.k'], ['c1', 'e:side:s.c0'], { align: 'aligned' }), mate('coincident', ['c0', 'e:cap:end'], ['c1', 'e:cap:start'], { align: 'antiAligned' })], r);
    const parts: Record<string, Made> = { c0: plate, c1: pin };
    const solved = solveAssembly(doc, (id) => parts[id]?.part ?? null);
    expect([...solved.mates.values()].map((m) => m.status), `${why}: mates`).toEqual(['ok', 'ok']);
    expect(solved.components.get('c1'), `${why}: freedoms`).toEqual({ status: 'under', dof: 1 });
    const pose = solved.poses.get('c1')!;
    const foot = transformPoint(pose, [0, 0, 0]);
    const tip = transformPoint(pose, [0, 0, h]);
    [hx, hy, H].forEach((v, i) => expect(foot[i], `${why}: foot ${i}`).toBeCloseTo(v, 6));
    [hx, hy, H + h].forEach((v, i) => expect(tip[i], `${why}: tip ${i}`).toBeCloseTo(v, 6));

    const shapeOf = (key: string) => (key === 'plate' ? plate.shape : pin.shape);
    const comps = (p: Pose) => [{ id: 'c0', parts: [{ part: 'plate', mirrored: false, pose: at([0, 0, 0]) }] }, { id: 'c1', parts: [{ part: 'pin', mirrored: false, pose: p }] }];
    expect(findInterference(kernel, comps(pose), shapeOf).overlaps, `${why}: standing on the plate`).toHaveLength(0);
    const delta = r.round(r.between(1, Math.min(H, h)), 0.5);
    const sunk = findInterference(kernel, comps({ ...pose, position: [pose.position[0], pose.position[1], pose.position[2] - delta] }), shapeOf);
    try {
      if (!larger) expect(sunk.overlaps, `${why}: a smaller pin goes in`).toHaveLength(0);
      else {
        expect(sunk.overlaps, `${why}: a larger pin cannot`).toHaveLength(1);
        const ring = Math.PI * (rp * rp - rh * rh) * delta;
        expect(Math.abs(sunk.overlaps[0]!.volume - ring) / ring, `${why}: ring volume ${sunk.overlaps[0]!.volume} vs ${ring}`).toBeLessThan(1e-6);
      }
    } finally {
      sunk.overlaps.forEach((o) => kernel.release(o.shape));
    }
  }, 120000);
});
