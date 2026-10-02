/**
 * 3b-5a: what the kernel gives the evaluation tools (E1, E2, E3): inertia against closed forms, how masses combine, exact distances, what two shapes have in common,
 * and the check of a shape, on shapes whose answers are known.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { axisAngle, combineMass, placeMass, principalMoments, scaleMass, type Pose } from '@3db/model';
import { readPartFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type ShapeId } from '@3db/kernel';
import { Regenerator } from '@3db/regen';
import { build, circle, extrude, front, rectangle, sketch } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
const golden = {} as Record<'plate' | 'pin', ShapeId>;

beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
  for (const [k, file] of [['plate', 'locating-plate.3dbx'], ['pin', 'diamond-pin.3dbx']] as const) {
    const doc = (await readPartFile(new Uint8Array(readFileSync(new URL(`../golden/${file}`, import.meta.url))))).doc;
    const regen = new Regenerator(kernel, solver);
    kept.push(regen);
    golden[k] = regen.rebuild(doc).body!.shape;
  }
});

const rebuild = (doc: ReturnType<typeof build>) => {
  const regen = new Regenerator(kernel, solver);
  kept.push(regen);
  return regen.rebuild(doc).body!.shape;
};
const box = (w: number, h: number, d: number) => rebuild(build(sketch('s', front, rectangle('r', 0, 0, w, h)), extrude('e', 's', 'boss', { type: 'blind', depth: String(d) })));
const cylinder = (r: number, h: number) => rebuild(build(sketch('s', front, circle('c', 0, 0, r)), extrude('e', 's', 'boss', { type: 'blind', depth: String(h) })));
const move = (id: ShapeId, [x, y, z]: [number, number, number]) => kernel.transformed(id, [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z]);
const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);

describe('mass properties (3b-5a)', () => {
  it('a block: the volume, the center, and the moments of inertia of the closed form', () => {
    const m = kernel.massProps(box(10, 20, 30));
    expect(m.volume).toBeCloseTo(6000, 9);
    const { moments } = principalMoments(m.inertia);
    // m/12 (b² + c²) for each axis, smallest first (the density is one: the mass is the volume)
    const want = [(20 ** 2 + 30 ** 2) / 12, (10 ** 2 + 30 ** 2) / 12, (10 ** 2 + 20 ** 2) / 12].map((v) => v * 6000).sort((a, b) => a - b);
    // the largest dimensions give the largest moment about the shortest axis
    moments.forEach((v, i) => expect(rel(v, [...want].sort((a, b) => a - b)[i]!)).toBeLessThan(1e-9));
  });

  it('a cylinder: m r²/2 about its axis, m (3 r² + h²) / 12 about the others', () => {
    const r = 7;
    const h = 25;
    const m = kernel.massProps(cylinder(r, h));
    const mass = Math.PI * r * r * h;
    expect(rel(m.volume, mass)).toBeLessThan(1e-9);
    const { moments } = principalMoments(m.inertia);
    const axial = (mass * r * r) / 2;
    const side = (mass * (3 * r * r + h * h)) / 12;
    const want = [axial, side, side].sort((a, b) => a - b);
    moments.forEach((v, i) => expect(rel(v, want[i]!), `moment ${i}`).toBeLessThan(1e-8));
  });

  it('is the same however the body is turned: placing it by a pose turns the inertia and keeps the principal moments', () => {
    const item = { mass: 6000, center: [5, 10, 15] as [number, number, number], inertia: kernel.massProps(box(10, 20, 30)).inertia };
    const before = principalMoments(item.inertia).moments;
    const pose: Pose = { position: [100, -40, 7], rotation: axisAngle([0.6, 0.8, 0], 1.2) };
    const placed = placeMass(item, pose);
    principalMoments(placed.inertia).moments.forEach((v, i) => expect(rel(v, before[i]!)).toBeLessThan(1e-9));
    // and the matrix is symmetric
    expect(placed.inertia[1]).toBeCloseTo(placed.inertia[3]!, 6);
    expect(placed.inertia[2]).toBeCloseTo(placed.inertia[6]!, 6);
  });

  it('several bodies as one: the same as the kernel gives for the shapes put together (< 1e-6)', () => {
    const a = box(10, 20, 30);
    const b = cylinder(6, 15);
    const placedB = move(b, [40, 5, -12]);
    const parts = [kernel.massProps(a), kernel.massProps(placedB)].map((m) => ({ mass: m.volume, center: m.center, inertia: m.inertia }));
    const whole = combineMass(parts);
    const direct = kernel.massProps(kernel.join([a, placedB]));
    expect(rel(whole.mass, direct.volume)).toBeLessThan(1e-9);
    whole.center.forEach((v, k) => expect(v).toBeCloseTo(direct.center[k]!, 6));
    whole.inertia.forEach((v, i) => expect(Math.abs(v - direct.inertia[i]!) / Math.max(Math.abs(direct.inertia[i]!), 1e4), `entry ${i}`).toBeLessThan(1e-6));
  });

  it('the density scales the mass and the inertia, not the center', () => {
    const m = kernel.massProps(box(10, 20, 30));
    const steel = scaleMass({ mass: m.volume, center: m.center, inertia: m.inertia }, 7.85e-6); // kg/mm³
    expect(steel.mass).toBeCloseTo(6000 * 7.85e-6, 12);
    expect(steel.center).toEqual(m.center);
    expect(steel.inertia[0]).toBeCloseTo(m.inertia[0]! * 7.85e-6, 12);
  });

  it('principal moments of a diagonal matrix, and of a full one by hand', () => {
    expect(principalMoments([3, 0, 0, 0, 1, 0, 0, 0, 2]).moments).toEqual([1, 2, 3]);
    // [[2, 1, 0], [1, 2, 0], [0, 0, 5]] has the eigenvalues 1, 3, 5
    const p = principalMoments([2, 1, 0, 1, 2, 0, 0, 0, 5]);
    p.moments.forEach((v, i) => expect(v).toBeCloseTo([1, 3, 5][i]!, 12));
    expect(Math.abs(p.axes[0]![0])).toBeCloseTo(Math.SQRT1_2, 12);
  });
});

describe('distance (3b-5a)', () => {
  it('between two blocks, and the points that make it', () => {
    const d = kernel.distance(box(10, 20, 30), move(box(5, 5, 5), [30, 0, 0]));
    expect(d.distance).toBeCloseTo(20, 9);
    expect(d.pointA[0]).toBeCloseTo(10, 9);
    expect(d.pointB[0]).toBeCloseTo(30, 9);
  });

  it('is zero for shapes that touch or overlap', () => {
    expect(kernel.distance(box(10, 10, 10), move(box(10, 10, 10), [10, 0, 0])).distance).toBeCloseTo(0, 9);
    expect(kernel.distance(box(10, 10, 10), move(box(10, 10, 10), [3, 3, 3])).distance).toBeCloseTo(0, 9);
  });

  it('from a vertex to a cylindrical face: the distance to the surface of the cylinder, by hand', () => {
    const plate = kernel.topology(golden.plate);
    const pin = kernel.topology(golden.pin);
    // the far corner of the plate, and the flange of the pin (R8, from y = 15 to 19) on the axis y: the nearest point is on the surface at the height of the corner, or on its rim
    let corner = 0;
    plate.vertices.forEach((v, i) => {
      if (Math.hypot(v.point[0], v.point[2]) > Math.hypot(plate.vertices[corner]!.point[0], plate.vertices[corner]!.point[2])) corner = i;
    });
    const [vx, vy, vz] = plate.vertices[corner]!.point;
    const flange = pin.faces.findIndex((f) => f.geometry?.type === 'cylinder' && Math.abs(f.geometry.radius - 8) < 1e-9);
    expect(flange).toBeGreaterThanOrEqual(0);
    const rho = Math.hypot(vx, vz);
    const dy = vy < 15 ? 15 - vy : vy > 19 ? vy - 19 : 0;
    const d = kernel.distance(kernel.subShape(golden.plate, 'vertex', corner), kernel.subShape(golden.pin, 'face', flange));
    expect(d.distance).toBeCloseTo(Math.hypot(rho - 8, dy), 6);
  });

  it('between two faces that are parallel, and from a point to an edge', () => {
    const b = box(10, 20, 30);
    const t = kernel.topology(b);
    const top = t.faces.findIndex((f) => f.normal && f.normal[2] === 1);
    const bottom = t.faces.findIndex((f) => f.normal && f.normal[2] === -1);
    expect(kernel.distance(kernel.subShape(b, 'face', top), kernel.subShape(b, 'face', bottom)).distance).toBeCloseTo(30, 9);
    const vertex = t.vertices.findIndex((v) => v.point[0] === 0 && v.point[1] === 0 && v.point[2] === 0);
    const edge = t.edges.findIndex((e) => Math.abs(e.mid[0] - 10) < 1e-9 && Math.abs(e.mid[1] - 20) < 1e-9);
    expect(kernel.distance(kernel.subShape(b, 'vertex', vertex), kernel.subShape(b, 'edge', edge)).distance).toBeCloseTo(Math.hypot(10, 20), 9);
  });

  it('refuses an element that is not there, in words', () => {
    expect(() => kernel.subShape(box(1, 1, 1), 'face', 99)).toThrow(/要測量的元素/);
  });
});

describe('what two shapes have in common (3b-5a)', () => {
  it('two 10 × 10 × 5 blocks overlapping by 2: 200; touching or apart: nothing', () => {
    const a = box(10, 10, 5);
    expect(kernel.common(a, move(box(10, 10, 5), [0, 0, 3])).volume).toBeCloseTo(200, 6);
    expect(kernel.common(a, move(box(10, 10, 5), [0, 0, 5])).shape).toBeNull();
    expect(kernel.common(a, move(box(10, 10, 5), [0, 0, 9])).shape).toBeNull();
  });

  it('gives the shape of the overlap, to look at', () => {
    const a = box(10, 10, 5);
    const c = kernel.common(a, move(box(10, 10, 5), [4, 3, 1]));
    expect(c.volume).toBeCloseTo(6 * 7 * 4, 6);
    const b = kernel.bounds(c.shape!);
    expect(b.min).toEqual([expect.closeTo(4, 6), expect.closeTo(3, 6), expect.closeTo(1, 6)]);
    expect(b.max).toEqual([expect.closeTo(10, 6), expect.closeTo(10, 6), expect.closeTo(5, 6)]);
    kernel.release(c.shape!);
  });
});

describe('the check of a shape (3b-5a)', () => {
  it('passes a block and the golden parts: valid, one solid, no bad face, no free edge', () => {
    for (const id of [box(10, 20, 30), golden.plate, golden.pin]) {
      const r = kernel.check(id);
      expect([r.valid, r.solids, r.badFaces, r.freeEdges]).toEqual([true, 1, [], 0]);
      expect(r.faces).toBe(kernel.topology(id).faces.length);
      expect(r.volume).toBeCloseTo(kernel.massProps(id).volume, 6);
    }
  });

  it('finds a box without its lid: no solid, the four edges of the opening are free', () => {
    const oc = kernel.oc;
    const block = new oc.BRepPrimAPI_MakeBox(new oc.gp_Pnt(0, 0, 0), 10, 10, 10).Shape();
    const shell = new oc.TopoDS_Shell();
    const builder = new oc.BRep_Builder();
    builder.MakeShell(shell);
    let n = 0;
    for (const ex = new oc.TopExp_Explorer(block, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) if (n++ < 5) builder.Add(shell, ex.Current());
    const id = (kernel as unknown as { put(s: unknown): ShapeId }).put(shell);
    const r = kernel.check(id);
    expect(r.solids).toBe(0);
    expect(r.freeEdges).toBe(4);
    expect(r.faces).toBe(5);
  });
});
