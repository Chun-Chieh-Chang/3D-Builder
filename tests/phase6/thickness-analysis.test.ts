/**
 * 6-3 (docs/phase6-plan.md): the thickness analysis (E3.5) of the kernel — how thick the wall is at every point, by a ray along the inward normal — and the points it is
 * measured at, against bodies whose walls are known by hand: a box shelled 2, one with a floor of 4, a plate, a wedge going from 2 to 6, a hollow sphere, a sheet.
 * The partly shadowed face of the undercut analysis is here too: the sampler they share is what makes it possible.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Feature } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { buildBvh, forEachSample, Kernel, KernelError, nearestHit, nearestHitAt, triangleNormal, type ShapeId } from '@3db/kernel';
import { Regenerator } from '@3db/regen';
import { build, extrude, front, rectangle, sketch } from '../phase1/builders';

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
const on = (name: string) => ({ kind: 'datum', name }) as const;
const box = (w: number, d: number, h: number) => body(build(sketch('s', front, rectangle('r', -w / 2, -d / 2, w, d)), extrude('e', 's', 'boss', { type: 'blind', depth: String(h) })));
/** A box 60 × 40 × 30 shelled open at the top, 2 thick (the floor too). */
function shelled() {
  const b = box(60, 40, 30);
  const top = kernel.topology(b).faces.findIndex((f) => f.normal && f.normal[2] > 0.99);
  return kernel.shell(b, [top], 2, false);
}

describe('the points a face is measured at', () => {
  it('a flat face of two triangles gets at least 400 points, standing for its whole area; a face of many triangles keeps one point to a triangle', () => {
    const positions = [0, 0, 0, 10, 0, 0, 10, 5, 0, 0, 5, 0];
    const mesh = { positions, indices: [0, 1, 2, 0, 2, 3], faceRanges: [0, 6, 0] };
    let area = 0;
    const normals = new Set<string>();
    const count = forEachSample(mesh, { maxSamples: 100000 }, (face, triangle, p, n, w) => {
      area += w;
      normals.add(n.map((v) => v.toFixed(6)).join(','));
      expect(face).toBe(0);
      expect(p[0]).toBeGreaterThanOrEqual(0);
      expect(p[0]).toBeLessThanOrEqual(10);
      expect(p[1]).toBeGreaterThanOrEqual(0);
      expect(p[1]).toBeLessThanOrEqual(5);
      expect(triangle).toBeLessThan(2);
    });
    expect(count).toBeGreaterThanOrEqual(400);
    expect(area).toBeCloseTo(50, 9);
    expect(normals.size).toBe(1); // the one normal, +z (the winding is counter-clockwise seen from above)
    expect([...normals][0]).toBe('0.000000,0.000000,1.000000');
    // a face of many triangles: one point to each
    const fan: number[] = [0, 0, 0];
    const idx: number[] = [];
    for (let i = 0; i <= 600; i++) fan.push(Math.cos(i / 100), Math.sin(i / 100), 0);
    for (let i = 1; i <= 600; i++) idx.push(0, i, i + 1);
    expect(forEachSample({ positions: fan, indices: idx, faceRanges: [0, idx.length, 0] }, { maxSamples: 100000 }, () => {})).toBe(600);
  });

  it('never more than maxSamples: the divisions come down, and then every few triangles are used', () => {
    const positions = [0, 0, 0, 10, 0, 0, 10, 5, 0, 0, 5, 0];
    const mesh = { positions, indices: [0, 1, 2, 0, 2, 3], faceRanges: [0, 6, 0] };
    expect(forEachSample(mesh, { maxSamples: 50 }, () => {})).toBeLessThanOrEqual(50);
    expect(forEachSample(mesh, { maxSamples: 1 }, () => {})).toBeLessThanOrEqual(2);
  });

  it('the nearest hit of the tree is the brute-force nearest hit: a unit square at z = 3 and one at z = 7, rays from the origin up', () => {
    const positions = [0, 0, 3, 1, 0, 3, 1, 1, 3, 0, 1, 3, 0, 0, 7, 1, 0, 7, 1, 1, 7, 0, 1, 7];
    const bvh = buildBvh(positions, [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    expect(nearestHit(bvh, [0.5, 0.4, 0], [0, 0, 1])).toBeCloseTo(3, 12);
    expect(nearestHit(bvh, [0.5, 0.4, 5], [0, 0, 1])).toBeCloseTo(2, 12);
    expect(nearestHit(bvh, [0.5, 0.4, 5], [0, 0, -1])).toBeCloseTo(2, 12);
    expect(nearestHit(bvh, [0.5, 0.4, 9], [0, 0, 1])).toBe(Infinity);
    expect(nearestHitAt(bvh, [0.5, 0.4, 0], [0, 0, 1])).toEqual({ distance: expect.closeTo(3, 12), triangle: 0 });
    expect(nearestHitAt(bvh, [0.5, 0.4, 9], [0, 0, 1])).toEqual({ distance: Infinity, triangle: -1 });
    expect(triangleNormal(bvh, 0)).toEqual([0, 0, 1]);
    // triangle 0 is the half of the lower square that (0.5, 0.4) is in: skipped, the ray goes on to the upper square
    expect(nearestHit(bvh, [0.5, 0.4, 0], [0, 0, 1], 0)).toBeCloseTo(7, 12);
  });
});

describe('a box 60 × 40 × 30 shelled open at the top, 2 thick', () => {
  it('every wall, inside and out, and the floor, is 2 thick at its median and its least (to 1e-5), the thinnest place is 2; the rim, seen along its normal, is the whole wall: 30', () => {
    const { shape } = shelled();
    const report = kernel.thicknessAnalysis(shape, { min: 1.5, max: 10 });
    const topo = kernel.topology(shape);
    for (const f of report.faces) {
      const rim = topo.faces[f.face]!.normal![2] > 0.99 && Math.abs(topo.faces[f.face]!.center[2] - 30) < 1e-6;
      expect(f.min, `face ${f.face}`).toBeCloseTo(rim ? 30 : 2, 5);
      expect(f.median).toBeCloseTo(rim ? 30 : 2, 5);
      expect(f.kind).toBe(rim ? 'thick' : 'ok');
      // (the greatest is not asserted: near a corner the ray runs down the wall next to this one, 40 or 60 long — which is why the median is what is reported)
      expect(f.max).toBeGreaterThanOrEqual(f.min);
    }
    expect(report.totals.ok.faces).toBe(10);
    expect(report.totals.thick.faces).toBe(1);
    expect(report.thinnest!.thickness).toBeCloseTo(2, 5);
    expect(report.samples).toBeGreaterThan(400);
  });

  it('asking for at least 3 makes every wall thin (ten faces) and leaves the rim; asking for at least 2.5 and at most 1.5 is refused', () => {
    const report = kernel.thicknessAnalysis(shelled().shape, { min: 3 });
    expect(report.totals.thin.faces).toBe(10);
    expect(report.totals.thin.area).toBeGreaterThan(0);
    // (most of each wall; not all: near a corner the ray runs down the wall next to it and is not thin)
    expect(report.faces.filter((f) => f.kind === 'thin').every((f) => f.thinShare > 0.7)).toBe(true);
    expect(() => kernel.thicknessAnalysis(shelled().shape, { min: 2.5, max: 1.5 })).toThrow(/下限/);
    expect(() => kernel.thicknessAnalysis(shelled().shape, { min: -1 })).toThrow(KernelError);
  });

  it('with no limits asked, nothing is thin or thick: everything with a wall is ok', () => {
    const report = kernel.thicknessAnalysis(shelled().shape);
    expect(report.least).toBeNull();
    expect(report.greatest).toBeNull();
    expect(report.totals.ok.faces).toBe(11);
  });
});

describe('the same box with its floor 4 thick (the inner floor moved up 2): the walls 2, the floor 4', () => {
  it('the thinnest place is a wall (2), the two faces of the floor are 4 thick, and with at least 3 asked the eight walls are thin and the floor is not', () => {
    const b = box(60, 40, 30);
    const topo = kernel.topology(b);
    const top = topo.faces.findIndex((f) => f.normal && f.normal[2] > 0.99);
    const bottom = topo.faces.findIndex((f) => f.normal && f.normal[2] < -0.99);
    const uniform = kernel.shell(b, [top], 2, false);
    const inner = uniform.faceOrigins.findIndex((o) => o.some((x) => x.rel === 'generated' && x.kind === 'face' && x.index === bottom));
    const thick = kernel.moveFace(uniform.shape, inner, 2).shape;
    const report = kernel.thicknessAnalysis(thick, { min: 3 });
    const faces = kernel.topology(thick).faces;
    const floors = report.faces.filter((f) => faces[f.face]!.normal![2] < -0.99 || (faces[f.face]!.normal![2] > 0.99 && faces[f.face]!.center[2] < 10));
    expect(floors).toHaveLength(2);
    for (const f of floors) {
      expect(f.min).toBeCloseTo(4, 5);
      expect(f.median).toBeCloseTo(4, 5);
      expect(f.kind).toBe('ok');
    }
    expect(report.thinnest!.thickness).toBeCloseTo(2, 5);
    expect(report.totals.thin.faces).toBe(8);
  });
});

describe('a plate and a wedge', () => {
  it('a plate 40 × 30 × 3: the two big faces are 3 thick, and the four edges of it are measured across the plate: 40 and 30', () => {
    const plate = box(40, 30, 3);
    const report = kernel.thicknessAnalysis(plate);
    const topo = kernel.topology(plate);
    for (const f of report.faces) {
      const n = topo.faces[f.face]!.normal!;
      const expected = Math.abs(n[2]) > 0.99 ? 3 : Math.abs(n[0]) > 0.99 ? 40 : 30;
      expect(f.min, `face ${f.face}`).toBeCloseTo(expected, 5);
      expect(f.max).toBeCloseTo(expected, 5);
    }
    expect(report.thinnest!.thickness).toBeCloseTo(3, 5);
  });

  it('a wedge from 2 to 6 along 40: the thinnest place found is within 0.1 of the thin end, 2 + 0.1·x there (√1.01 times that from the sloping side), and the thickest is within 0.1 of 6', () => {
    const pts: [number, number][] = [[0, 0], [40, 0], [40, 6], [0, 2]];
    const wedge = body(
      build(
        {
          id: 'w',
          type: 'sketch',
          name: 'w',
          suppressed: false,
          plane: front,
          entities: [...pts.map(([x, y], i) => ({ id: `p${i}`, type: 'point', x, y }) as const), ...pts.map((_, i) => ({ id: `l${i}`, type: 'line', p1: `p${i}`, p2: `p${(i + 1) % 4}` }) as const)],
          constraints: [],
        } as Feature,
        extrude('e', 'w', 'boss', { type: 'blind', depth: '20' }),
      ),
    );
    const report = kernel.thicknessAnalysis(wedge);
    const topo = kernel.topology(wedge);
    const flat = report.faces.find((f) => topo.faces[f.face]!.normal![1] < -0.99)!;
    // from the flat side the ray is up: the height there, 2 + 0.1·x, over the face from x = 0 to 40
    expect(flat.min).toBeGreaterThanOrEqual(2);
    expect(flat.min).toBeLessThan(2.1);
    expect(flat.max).toBeGreaterThan(5.9);
    expect(flat.max).toBeLessThanOrEqual(6);
    expect(flat.median).toBeCloseTo(4, 1);
    const spot = report.thinnest!;
    const slope = topo.faces[spot.face]!.normal![1] > -0.99;
    expect(spot.thickness).toBeCloseTo((2 + 0.1 * spot.point[0]) * (slope ? Math.sqrt(1.01) : 1), 3);
    expect(spot.thickness).toBeLessThan(2.2);
    expect(report.thickest!.thickness).toBeGreaterThan(5.9);
  });
});

describe('curved walls and a sheet', () => {
  it('a hollow sphere, R20 outside and R18 inside: 2 thick all round (median within 0.01, least and greatest within 0.05 of that)', () => {
    const oc = (kernel as unknown as { oc: any }).oc; // eslint-disable-line @typescript-eslint/no-explicit-any
    const put = (s: unknown) => (kernel as unknown as { put(s: unknown): ShapeId }).put(s);
    const outer = put(new oc.BRepPrimAPI_MakeSphere(20).Shape());
    const inner = put(new oc.BRepPrimAPI_MakeSphere(18).Shape());
    const hollow = kernel.boolean('cut', outer, inner).shape;
    const report = kernel.thicknessAnalysis(hollow);
    expect(report.faces).toHaveLength(2);
    for (const f of report.faces) {
      expect(f.median).toBeCloseTo(2, 2);
      expect(Math.abs(f.min - 2)).toBeLessThan(0.05);
      expect(Math.abs(f.max - 2)).toBeLessThan(0.05);
    }
  });

  it('a sheet (one face, nothing on the other side) is open: nothing to measure, and no thinnest place', () => {
    const b = box(40, 30, 10);
    const sheet = kernel.subShape(b, 'face', kernel.topology(b).faces.findIndex((f) => f.normal && f.normal[2] > 0.99));
    const report = kernel.thicknessAnalysis(sheet, { min: 1 });
    expect(report.faces[0]!.kind).toBe('open');
    expect(report.faces[0]!.openShare).toBeCloseTo(1, 9);
    expect(Number.isNaN(report.faces[0]!.min)).toBe(true);
    expect(report.thinnest).toBeNull();
    expect(report.thickest).toBeNull();
    expect(report.totals.open.faces).toBe(1);
  });

  it('leaves the shape as it was', () => {
    const { shape } = shelled();
    const before = [kernel.topology(shape).faces.length, kernel.massProps(shape).volume];
    kernel.thicknessAnalysis(shape);
    expect([kernel.topology(shape).faces.length, kernel.massProps(shape).volume]).toEqual(before);
  });
});

describe('the undercut of a face that is partly in the shadow (what the sampler is for)', () => {
  it('a base 60 × 60 × 10 with a column and an overhanging plate: the top of the base and the underside of the plate are partly blocked, 0.31 and 0.73 of them, and three walls of the column are undercuts: 2800 mm² in all', () => {
    const plane = (id: string, z: number): Feature => ({ id, type: 'refPlane', name: id, suppressed: false, def: { mode: 'offset', plane: front, distance: String(z) } }) as Feature;
    const shape = body(
      build(
        sketch('s', front, rectangle('b', -30, -30, 60, 60)),
        extrude('e', 's', 'boss', { type: 'blind', depth: '10' }),
        plane('pla', 10),
        sketch('c', on('pla'), rectangle('q', 20, -5, 10, 10)),
        extrude('f', 'c', 'boss', { type: 'blind', depth: '20' }),
        plane('plb', 30),
        sketch('p', on('plb'), rectangle('w', 0, -20, 40, 40)),
        extrude('g', 'p', 'boss', { type: 'blind', depth: '5' }),
      ),
    );
    const report = kernel.undercutAnalysis(shape, [0, 0, 1]);
    const topo = kernel.topology(shape);
    const baseTop = report.faces.find((f) => topo.faces[f.face]!.normal?.[2] === 1 && Math.abs(topo.faces[f.face]!.center[2] - 10) < 1e-6)!;
    const underside = report.faces.find((f) => topo.faces[f.face]!.normal?.[2] === -1 && Math.abs(topo.faces[f.face]!.center[2] - 30) < 1e-6)!;
    expect(baseTop.kind).toBe('partial');
    expect(underside.kind).toBe('partial');
    expect(Math.abs(baseTop.blocked - 1100 / 3500)).toBeLessThan(0.03);
    expect(Math.abs(underside.blocked - 1100 / 1500)).toBeLessThan(0.03);
    // the column's walls are in the shadow of the plate too: three of them whole (the fourth is flush with the base's side, which is seen from below), 3 × 200
    expect(report.totals.undercut.faces).toBe(3);
    expect(report.totals.undercut.area).toBeCloseTo(600, 6);
    expect(Math.abs(report.undercutArea - (1100 + 1100 + 600))).toBeLessThan(80);
  });
});
