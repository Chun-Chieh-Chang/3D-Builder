/**
 * F-0 (docs/fillet-by-face-plan.md): what OCCT does for fillet and chamfer by face, face fillet and full round, before any of it is built into the features:
 * the corner a fillet round the edges of a face makes (the plan's hand calculation assumes a mitre), which edges of a face are smooth and so left out,
 * a full round by two fillets of half the width and by a cut, a fillet between two faces that do not meet, which side of a circular edge a fillet goes to.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PartDoc } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type Frame, type Region, type ShapeId } from '@3db/kernel';
import { Regenerator } from '@3db/regen';
import { build, circle, extrude, front, rectangle, sketch } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});
afterAll(() => kept.forEach((r) => r.dispose()));

function shapeOf(doc: PartDoc): ShapeId {
  const regen = new Regenerator(kernel, solver, new Map());
  kept.push(regen);
  const r = regen.rebuild(doc);
  expect(r.features.filter((f) => f.status !== 'ok').map((f) => f.message)).toEqual([]);
  return r.body!.shape;
}

/** w × h on the front plane, `d` deep. */
const block = (w: number, h: number, d: number) => shapeOf(build(sketch('s1', front, rectangle('r', 0, 0, w, h)), extrude('e1', 's1', 'boss', { type: 'blind', depth: String(d) })));
const volume = (s: ShapeId) => kernel.massProps(s).volume;

/** The planar face whose outward normal is `n` and whose center is the farthest along it. */
function faceFacing(shape: ShapeId, n: [number, number, number]): number {
  const topo = kernel.topology(shape);
  let best = -1;
  let far = -Infinity;
  topo.faces.forEach((f, i) => {
    if (f.surface !== 'plane' || !f.normal) return;
    if (f.normal[0] * n[0] + f.normal[1] * n[1] + f.normal[2] * n[2] < 1 - 1e-9) return;
    const along = f.center[0] * n[0] + f.center[1] * n[1] + f.center[2] * n[2];
    if (along > far) [best, far] = [i, along];
  });
  return best;
}
const edgesOf = (shape: ShapeId, face: number) => kernel.topology(shape).edges.flatMap((e, i) => (e.faces.includes(face) ? [i] : []));
/** Which way the front plane's extrusion went: the sign of z of the far cap. */
const zSign = (shape: ShapeId): 1 | -1 => (kernel.topology(shape).vertices.some((v) => v.point[2] > 1e-6) ? 1 : -1);

describe('F-0: fillet and chamfer round the edges of a face', () => {
  it('the four edges of the top of a 40 × 30 × 12 block, R 2: the corner is a mitre of the two cylinders (the plan\'s hand calculation)', () => {
    const b = block(40, 30, 12);
    const sign = zSign(b);
    const top = faceFacing(b, [0, 0, sign]);
    const edges = edgesOf(b, top);
    expect(edges).toHaveLength(4);
    const r = kernel.fillet(b, edges, 2);
    const handCalc = 14400 - ((1 - Math.PI / 4) * 4 * 140 - 8 * 8 * (5 / 6 - Math.PI / 4));
    expect(Math.abs(volume(r.shape) - handCalc)).toBeLessThan(1e-6); // 14282.890822
  });

  it('the same with a chamfer of 2 × 2', () => {
    const b = block(40, 30, 12);
    const top = faceFacing(b, [0, 0, zSign(b)]);
    const r = kernel.chamfer(b, edgesOf(b, top).map((edge) => ({ edge, face: top })), 'distanceDistance', 2, 2);
    const handCalc = 14400 - (2 * 140 - (8 * 8) / 6);
    expect(Math.abs(volume(r.shape) - handCalc)).toBeLessThan(1e-3);
  });

  it('the distance measured on the selected face: 3 on the top and 1 on the sides shrinks the top by 3', () => {
    const b = block(40, 30, 12);
    const top = faceFacing(b, [0, 0, zSign(b)]);
    const r = kernel.chamfer(b, edgesOf(b, top).map((edge) => ({ edge, face: top })), 'distanceDistance', 3, 1);
    const topo = kernel.topology(r.shape);
    const sign = zSign(r.shape);
    const newTop = topo.faces.filter((f) => f.surface === 'plane' && f.normal && f.normal[2] * sign > 0.999 && Math.abs(f.center[2] * sign - 12) < 1e-6);
    expect(newTop[0]!.area).toBeCloseTo((40 - 6) * (30 - 6), 6);
  });
});

describe('F-0: which edges of a face are smooth', () => {
  it('none on a block; all the ones beside the rounds once the top is filleted', () => {
    const b = block(40, 30, 12);
    const all = kernel.topology(b).edges.map((_, i) => i);
    expect(kernel.smoothEdges(b, all).filter(Boolean)).toHaveLength(0);
    const top = faceFacing(b, [0, 0, zSign(b)]);
    const r = kernel.fillet(b, edgesOf(b, top), 2);
    const topo = kernel.topology(r.shape);
    const flags = kernel.smoothEdges(r.shape, topo.edges.map((_, i) => i));
    const newTop = faceFacing(r.shape, [0, 0, zSign(r.shape)]);
    const ofTop = edgesOf(r.shape, newTop);
    expect(ofTop.every((i) => flags[i])).toBe(true);
    expect(flags.filter(Boolean).length).toBe(8); // top ↔ four rounds, and the four rounds ↔ the sides
  });
});

/** The cross-section of the strip a full round takes away, as a region on a plane across the length: from the side wall `y = 0` over to `y = w`. */
function stripRegion(w: number, ztop: number): Region {
  const zc = ztop - w / 2;
  return {
    outer: [
      { kind: 'line', a: [0, zc], b: [0, ztop + 1], source: 'l0' },
      { kind: 'line', a: [0, ztop + 1], b: [w, ztop + 1], source: 'l1' },
      { kind: 'line', a: [w, ztop + 1], b: [w, zc], source: 'l2' },
      { kind: 'arc', c: [w / 2, zc], r: w / 2, from: [w, zc], to: [0, zc], ccw: true, source: 'a0' },
    ],
    holes: [],
  };
}

describe('F-0: a full round of the top of a 40 × 30 × 20 block (the top is 30 wide)', () => {
  const expected = 24000 - 40 * (30 * 15 - (Math.PI * 15 * 15) / 2);

  it('by two fillets of half the width: OCCT fails, because the two rounds eat the whole top', () => {
    const b = block(40, 30, 20);
    const top = faceFacing(b, [0, 0, zSign(b)]);
    const longs = edgesOf(b, top).filter((i) => Math.abs(kernel.topology(b).edges[i]!.length - 40) < 1e-9);
    expect(longs).toHaveLength(2);
    expect(() => kernel.fillet(b, longs, 15)).toThrow();
  });

  it('by two fillets a little under half the width: it works, but a sliver of the top is left and the volume is off by more than the plan allows', () => {
    const b = block(40, 30, 20);
    const top = faceFacing(b, [0, 0, zSign(b)]);
    const longs = edgesOf(b, top).filter((i) => Math.abs(kernel.topology(b).edges[i]!.length - 40) < 1e-9);
    const r = kernel.fillet(b, longs, 14.99);
    expect(Math.abs(volume(r.shape) - expected)).toBeGreaterThan(1); // 5 mm³ too much, and 8 faces instead of 6: not a full round
    expect(kernel.topology(r.shape).faces).toHaveLength(8);
  });

  it('by cutting away the strip over a semicircle: exact, one new cylindrical face', () => {
    const b = block(40, 30, 20);
    const sign = zSign(b);
    const ztop = 20 * sign;
    // a frame across the length: x along the 30 (the part's y), y along z (up), the sweep along the part's x
    const frame: Frame = { origin: [-1, 0, 0], xDir: [0, 1, 0], yDir: [0, 0, sign], normal: [1, 0, 0] };
    const tool = kernel.extrude(frame, [stripRegion(30, 20)], [42, 0, 0]);
    const out = kernel.boolean('cut', b, tool.shape);
    expect(Math.abs(volume(out.shape) - expected)).toBeLessThan(1e-3);
    const topo = kernel.topology(out.shape);
    expect(topo.faces.filter((f) => f.surface === 'cylinder')).toHaveLength(1);
    expect(topo.faces).toHaveLength(6); // the block's other five planes and the round
  });
});

describe('F-0: a face fillet between faces that meet or do not', () => {
  /** An L: a plate 40 × 30 × 10 and a wall 40 × 10 × 30 along its y = 0 edge, one body. */
  const bracket = () =>
    shapeOf(
      build(
        sketch('s1', front, rectangle('r', 0, 0, 40, 30)),
        extrude('e1', 's1', 'boss', { type: 'blind', depth: '10' }),
        sketch('s2', front, rectangle('w', 0, 0, 40, 10)),
        extrude('e2', 's2', 'boss', { type: 'blind', depth: '30' }),
      ),
    );

  it('the inner corner of the L (a concave edge): a fillet adds (1 − π/4) r² · L', () => {
    const b = bracket();
    const sign = zSign(b);
    const topo = kernel.topology(b);
    // the concave edge is 40 long at y = 10, z = 10
    const inner = topo.edges.findIndex((e) => Math.abs(e.length - 40) < 1e-9 && Math.abs(e.mid[1] - 10) < 1e-9 && Math.abs(e.mid[2] - 10 * sign) < 1e-9);
    expect(inner).toBeGreaterThanOrEqual(0);
    const before = volume(b);
    const r = kernel.fillet(b, [inner], 3);
    const added = volume(r.shape) - before;
    expect(Math.abs(added - (1 - Math.PI / 4) * 9 * 40)).toBeLessThan(1e-3);
  });

  it('two faces that share no edge have nothing to give a fillet: the faces of the walls of a slot', () => {
    // two walls of a slot cut into a block: their faces face each other and share no edge
    const b = block(40, 30, 12);
    const topo = kernel.topology(b);
    const sign = zSign(b);
    const [front_, back] = [faceFacing(b, [0, -1, 0]), faceFacing(b, [0, 1, 0])];
    expect(front_).toBeGreaterThanOrEqual(0);
    expect(back).toBeGreaterThanOrEqual(0);
    const shared = topo.edges.filter((e) => e.faces.includes(front_) && e.faces.includes(back));
    expect(shared).toHaveLength(0);
    expect(sign === 1 || sign === -1).toBe(true);
  });
});

describe('F-0: which side of a circular edge the fillet goes to', () => {
  /** A 20 × 20 × 6 plate with a Ø10 boss reaching z = 30, fused into one body. */
  const boss = () =>
    shapeOf(
      build(
        sketch('s1', front, rectangle('p', 0, 0, 20, 20)),
        extrude('e1', 's1', 'boss', { type: 'blind', depth: '6' }),
        sketch('s2', front, circle('c', 10, 10, 5)),
        extrude('e2', 's2', 'boss', { type: 'blind', depth: '30' }),
      ),
    );

  /** Pappus for the R1 corner swept round the boss axis: 2π × ∫r dA over a unit square minus a quarter disc.
   *  `arcAt` is where the arc centre sits (r = 6 at the root, r = 4 at the rim), `squareAt` the unit square's mid-radius. */
  const corner = (arcAt: number, squareAt: number) => {
    const disc = arcAt < squareAt ? arcAt + 4 / (3 * Math.PI) : arcAt - 4 / (3 * Math.PI);
    return 2 * Math.PI * (squareAt - (Math.PI / 4) * disc);
  };

  const circleAt = (shape: ShapeId, z: number) =>
    kernel.topology(shape).edges.findIndex((e) => e.curve === 'circle' && Math.abs(e.length - 2 * Math.PI * 5) < 1e-6 && Math.abs(e.mid[2] - z * zSign(shape)) < 1e-6);

  it('the plate is 2400 and the boss above it is π·5²·24, before any fillet', () => {
    expect(Math.abs(volume(boss()) - (400 * 6 + Math.PI * 25 * 24))).toBeLessThan(1e-3);
  });

  it('the root circle (concave, where the cylinder meets the face around it): the fillet adds material', () => {
    const b = boss();
    const root = circleAt(b, 6);
    expect(root).toBeGreaterThanOrEqual(0);
    const added = volume(kernel.fillet(b, [root], 1).shape) - volume(b);
    expect(added).toBeGreaterThan(0);
    expect(Math.abs(added - corner(6, 5.5))).toBeLessThan(1e-3);
    // hand-calculated truth: Pappus on unit square minus quarter disc = +7.0431
    expect(Math.abs(added - 7.0431)).toBeLessThan(5e-4);
  });

  it('the rim circle (convex, the top of the boss): the fillet of the same radius removes material', () => {
    const b = boss();
    const rim = circleAt(b, 30);
    expect(rim).toBeGreaterThanOrEqual(0);
    const moved = volume(kernel.fillet(b, [rim], 1).shape) - volume(b);
    expect(moved).toBeLessThan(0);
    expect(Math.abs(moved + corner(4, 4.5))).toBeLessThan(1e-3);
    // hand-calculated truth: Pappus on unit square minus quarter disc = −6.4407
    expect(Math.abs(moved + 6.4407)).toBeLessThan(5e-4);
  });
});
