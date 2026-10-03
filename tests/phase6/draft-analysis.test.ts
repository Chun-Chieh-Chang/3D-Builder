/**
 * 6-1 (docs/phase6-plan.md): the draft analysis (E3.2) of the kernel — the angle of every face to the way a mold opens, and which of the four classes it is — against bodies
 * whose angles are known by hand: a block drawn with 3° on its walls, a cylinder, a cone of 5°, a sphere, a block with a rounded edge.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Feature } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, KernelError, type DraftFace, type ShapeId } from '@3db/kernel';
import { Regenerator } from '@3db/regen';
import { build, circle, edge, extrude, fillet, front, rectangle, sketch } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});
afterAll(() => kept.forEach((r) => r.dispose()));

const body = (doc: ReturnType<typeof build>): ShapeId => {
  const regen = new Regenerator(kernel, solver, new Map());
  kept.push(regen);
  const r = regen.rebuild(doc);
  expect(r.features.filter((f) => f.status !== 'ok').map((f) => f.message)).toEqual([]);
  return r.body!.shape;
};
const deg = (rad: number) => (rad * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;
const drafted = (angle: string) =>
  body(build(sketch('s', front, rectangle('r', -20, -15, 40, 30)), { ...extrude('e', 's', 'boss', { type: 'blind', depth: '20' }), draft1: { angle, inward: true } } as Feature));
const wallsOf = (shape: ShapeId, faces: DraftFace[]) => faces.filter((f) => Math.abs(kernel.topology(shape).faces[f.face]!.normal?.[2] ?? 0) < 0.5);

describe('the draft of a block drawn with 3° on its walls, the mold opening along +z', () => {
  let shape: ShapeId;
  let up: ReturnType<Kernel['draftAnalysis']>;
  beforeAll(() => {
    shape = drafted('3deg');
    up = kernel.draftAnalysis(shape, [0, 0, 1], rad(1));
  });

  it('the four walls are 3.000° and positive, the top is 90° and positive, the bottom −90° and negative', () => {
    const topo = kernel.topology(shape);
    const walls = wallsOf(shape, up.faces);
    expect(walls).toHaveLength(4);
    for (const w of walls) {
      expect(deg(w.min)).toBeCloseTo(3, 9);
      expect(deg(w.max)).toBeCloseTo(3, 9);
      expect(w.kind).toBe('positive');
      expect(w.samples).toBeGreaterThan(0);
    }
    const top = up.faces.find((f) => topo.faces[f.face]!.normal![2] > 0.99)!;
    const bottom = up.faces.find((f) => topo.faces[f.face]!.normal![2] < -0.99)!;
    expect([deg(top.min), top.kind]).toEqual([expect.closeTo(90, 9), 'positive']);
    expect([deg(bottom.min), bottom.kind]).toEqual([expect.closeTo(-90, 9), 'negative']);
  });

  it('the totals add up: five positive faces and one negative, and their areas are the area of the body', () => {
    const area = kernel.topology(shape).faces.reduce((a, f) => a + f.area, 0);
    expect(up.totals.positive.faces).toBe(5);
    expect(up.totals.negative.faces).toBe(1);
    expect(up.totals.required.faces + up.totals.straddle.faces + up.totals.unknown.faces).toBe(0);
    const sum = Object.values(up.totals).reduce((a, v) => a + v.area, 0);
    expect(sum).toBeCloseTo(area, 9);
    expect(up.totals.negative.area).toBeCloseTo(40 * 30, 6);
  });

  it('asking for 5° makes the 3° walls draft required; the other way (−z) they are negative and the top and bottom change places', () => {
    const strict = kernel.draftAnalysis(shape, [0, 0, 1], rad(5));
    for (const w of wallsOf(shape, strict.faces)) expect(w.kind).toBe('required');
    const down = kernel.draftAnalysis(shape, [0, 0, -1], rad(1));
    const topo = kernel.topology(shape);
    for (const w of wallsOf(shape, down.faces)) {
      expect(w.kind).toBe('negative');
      expect(deg(w.max)).toBeCloseTo(-3, 9);
    }
    expect(down.faces.find((f) => topo.faces[f.face]!.normal![2] > 0.99)!.kind).toBe('negative');
    expect(down.faces.find((f) => topo.faces[f.face]!.normal![2] < -0.99)!.kind).toBe('positive');
    // the direction does not have to be a unit vector
    expect(kernel.draftAnalysis(shape, [0, 0, 7], rad(1)).faces.map((f) => f.kind)).toEqual(up.faces.map((f) => f.kind));
  });

  it('a direction along x sees the walls at 90° − 3° on one side and −(90° − 3°) on the other, and the two walls along it at 0°: draft required', () => {
    const topo = kernel.topology(shape);
    const side = kernel.draftAnalysis(shape, [1, 0, 0], rad(1));
    const walls = wallsOf(shape, side.faces);
    const facing = walls.filter((w) => topo.faces[w.face]!.normal![0] > 0.5);
    const away = walls.filter((w) => topo.faces[w.face]!.normal![0] < -0.5);
    expect(facing).toHaveLength(1);
    expect(away).toHaveLength(1);
    expect(deg(facing[0]!.min)).toBeCloseTo(90 - 3, 6);
    expect(deg(away[0]!.min)).toBeCloseTo(-(90 - 3), 6);
    const along = walls.filter((w) => Math.abs(topo.faces[w.face]!.normal![0]) <= 0.5);
    expect(along).toHaveLength(2);
    for (const w of along) expect(w.kind).toBe('required'); // the ±y walls lean in y only: square to x
  });
});

describe('curved faces', () => {
  it('a cylinder along the pull has 0° walls: draft required; a cone of 5° half angle is 5.000° and positive, whatever the shape was meshed at before', () => {
    const cylinder = body(build(sketch('s', front, circle('c', 0, 0, 10)), extrude('e', 's', 'boss', { type: 'blind', depth: '20' })));
    const wall = kernel.draftAnalysis(cylinder, [0, 0, 1], rad(1)).faces.find((f) => kernel.topology(cylinder).faces[f.face]!.surface === 'cylinder')!;
    expect(Math.abs(wall.min)).toBeLessThan(1e-9);
    expect(Math.abs(wall.max)).toBeLessThan(1e-9);
    expect(wall.kind).toBe('required');
    const cone = drafted('5deg');
    kernel.mesh(cone, { tolerance: 0.5, angular: 0.6 }); // a coarse mesh of the shape on show: the analysis meshes a copy as fine as it needs
    const side = body(build(sketch('s', front, circle('c', 0, 0, 10)), { ...extrude('e', 's', 'boss', { type: 'blind', depth: '20' }), draft1: { angle: '5deg', inward: true } } as Feature));
    kernel.mesh(side, { tolerance: 0.5, angular: 0.6 });
    const face = kernel.draftAnalysis(side, [0, 0, 1], rad(1)).faces.find((f) => kernel.topology(side).faces[f.face]!.surface === 'cone')!;
    expect(deg(face.min)).toBeCloseTo(5, 9);
    expect(deg(face.max)).toBeCloseTo(5, 9);
    expect(face.kind).toBe('positive');
  });

  it('a sphere straddles: some of it leans each way (from near −90° to near 90°)', () => {
    const oc = (kernel as unknown as { oc: any }).oc; // eslint-disable-line @typescript-eslint/no-explicit-any
    const sphere = (kernel as unknown as { put(s: unknown): ShapeId }).put(new oc.BRepPrimAPI_MakeSphere(15).Shape());
    const face = kernel.draftAnalysis(sphere, [0, 0, 1], rad(1)).faces[0]!;
    expect(face.kind).toBe('straddle');
    expect(deg(face.min)).toBeLessThan(-80);
    expect(deg(face.max)).toBeGreaterThan(80);
  });

  it('the rounded top edge of a block (R5, along y): the fillet runs from 0° (where it meets the wall) to 90° (the top): draft required, then the wall and the top', () => {
    const rounded = body(
      build(sketch('s', front, rectangle('w', -30, -20, 60, 40)), extrude('e', 's', 'boss', { type: 'blind', depth: '30' }), fillet('f1', [edge('{e:cap:end|e:side:s.wl1}')], '5')),
    );
    const topo = kernel.topology(rounded);
    const round = kernel.draftAnalysis(rounded, [0, 0, 1], rad(1)).faces.find((f) => topo.faces[f.face]!.surface === 'cylinder')!;
    expect(Math.abs(round.min)).toBeLessThan(1e-6);
    expect(deg(round.max)).toBeCloseTo(90, 6);
    expect(round.kind).toBe('required');
  });
});

describe('what is refused', () => {
  it('a direction of zero length, and a required angle that is negative', () => {
    const shape = drafted('3deg');
    expect(() => kernel.draftAnalysis(shape, [0, 0, 0], rad(1))).toThrow(KernelError);
    expect(() => kernel.draftAnalysis(shape, [0, 0, 1], -1)).toThrow(/拔模角/);
  });

  it('leaves the shape as it was: the same faces, the same volume', () => {
    const shape = drafted('3deg');
    const before = [kernel.topology(shape).faces.length, kernel.massProps(shape).volume];
    kernel.draftAnalysis(shape, [0, 0, 1], rad(1));
    expect([kernel.topology(shape).faces.length, kernel.massProps(shape).volume]).toEqual(before);
  });
});
