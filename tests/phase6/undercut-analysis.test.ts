/**
 * 6-2 (docs/phase6-plan.md): the undercut analysis (E3.3) of the kernel — what of each face a mold that opens along a direction can see from either end — and the
 * bounding-volume tree its rays go through, against bodies whose undercuts are known by hand: a block with a hole across it, a block with a slot cut into its side, and
 * a sphere fine enough to be a real part's size in triangles.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Feature } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { anyHit, buildBvh, Kernel, KernelError, type ShapeId, type UndercutReport } from '@3db/kernel';
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

const body = (doc: ReturnType<typeof build>): ShapeId => {
  const regen = new Regenerator(kernel, solver, new Map());
  kept.push(regen);
  const r = regen.rebuild(doc);
  expect(r.features.filter((f) => f.status !== 'ok').map((f) => f.message)).toEqual([]);
  return r.body!.shape;
};
const on = (name: string) => ({ kind: 'datum', name }) as const;
const block = () => [sketch('s', front, rectangle('r', -20, -20, 40, 40)), extrude('e', 's', 'boss', { type: 'blind', depth: '20' })];

describe('the tree the rays go through', () => {
  it('answers as the brute-force test does, for 3000 rays at a soup of 2000 triangles', () => {
    // a deterministic soup (a linear congruential generator): small triangles in a 100 cube
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const positions: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i < 2000; i++) {
      const c = [rnd() * 100, rnd() * 100, rnd() * 100];
      for (let k = 0; k < 3; k++) positions.push(c[0]! + (rnd() - 0.5) * 6, c[1]! + (rnd() - 0.5) * 6, c[2]! + (rnd() - 0.5) * 6);
      indices.push(3 * i, 3 * i + 1, 3 * i + 2);
    }
    const bvh = buildBvh(positions, indices);
    expect(bvh.nodes).toBeLessThan(4000);
    const brute = (o: number[], d: number[]) => {
      for (let t = 0; t < 2000; t++) {
        const [a, b, c] = [0, 1, 2].map((k) => positions.slice(9 * t + 3 * k, 9 * t + 3 * k + 3));
        const e1 = [b![0]! - a![0]!, b![1]! - a![1]!, b![2]! - a![2]!];
        const e2 = [c![0]! - a![0]!, c![1]! - a![1]!, c![2]! - a![2]!];
        const p = [d[1]! * e2[2]! - d[2]! * e2[1]!, d[2]! * e2[0]! - d[0]! * e2[2]!, d[0]! * e2[1]! - d[1]! * e2[0]!];
        const det = e1[0]! * p[0]! + e1[1]! * p[1]! + e1[2]! * p[2]!;
        if (Math.abs(det) < 1e-14) continue;
        const s = [o[0]! - a![0]!, o[1]! - a![1]!, o[2]! - a![2]!];
        const u = (s[0]! * p[0]! + s[1]! * p[1]! + s[2]! * p[2]!) / det;
        if (u < -1e-9 || u > 1 + 1e-9) continue;
        const q = [s[1]! * e1[2]! - s[2]! * e1[1]!, s[2]! * e1[0]! - s[0]! * e1[2]!, s[0]! * e1[1]! - s[1]! * e1[0]!];
        const v = (d[0]! * q[0]! + d[1]! * q[1]! + d[2]! * q[2]!) / det;
        if (v < -1e-9 || u + v > 1 + 1e-9) continue;
        if ((e2[0]! * q[0]! + e2[1]! * q[1]! + e2[2]! * q[2]!) / det > 1e-9) return true;
      }
      return false;
    };
    let hits = 0;
    for (let i = 0; i < 3000; i++) {
      const o: [number, number, number] = [rnd() * 100, rnd() * 100, rnd() * 100];
      const raw = [rnd() - 0.5, rnd() - 0.5, rnd() - 0.5];
      const len = Math.hypot(...raw);
      const d: [number, number, number] = [raw[0]! / len, raw[1]! / len, raw[2]! / len];
      const expected = brute(o, d);
      if (expected) hits++;
      expect(anyHit(bvh, o, d), `ray ${i}`).toBe(expected);
    }
    // the rays are not all misses or all hits: the comparison means something
    expect(hits).toBeGreaterThan(200);
    expect(hits).toBeLessThan(2800);
  });

  it('an empty mesh is hit by nothing', () => {
    expect(anyHit(buildBvh([], []), [0, 0, 0], [0, 0, 1])).toBe(false);
  });
});

describe('a block 40 × 30 × 20 with a Ø6 hole across it (along x, at z = 10), the mold opening along z', () => {
  const holed = () =>
    body(
      build(sketch('s', front, rectangle('r', -20, -15, 40, 30)), extrude('e', 's', 'boss', { type: 'blind', depth: '20' }), sketch('h', on('plane:right'), circle('c', -10, 0, 3)), {
        ...extrude('x', 'h', 'cut', { type: 'throughAll' }),
        dir2: { type: 'throughAll' },
      } as Feature),
    );
  let shape: ShapeId;
  let report: UndercutReport;
  beforeAll(() => {
    shape = holed();
    report = kernel.undercutAnalysis(shape, [0, 0, 1]);
  });

  it('the wall of the hole is an undercut (2π·3·40 = 753.98 mm² of it); the top is seen from above only, the bottom from below only, the four sides from both ends', () => {
    const topo = kernel.topology(shape);
    const kinds = report.faces.map((f) => [topo.faces[f.face]!.surface, topo.faces[f.face]!.normal?.map((v) => Math.round(v)) ?? null, f.kind] as const);
    const wall = report.faces.find((f) => topo.faces[f.face]!.surface === 'cylinder')!;
    expect(wall.kind).toBe('undercut');
    expect(wall.blocked).toBeGreaterThan(0.95);
    expect(wall.area).toBeCloseTo(2 * Math.PI * 3 * 40, 6);
    expect(report.totals.undercut).toEqual({ faces: 1, area: expect.closeTo(753.98, 1) });
    expect(report.undercutArea).toBeGreaterThan(0.95 * 753.98);
    expect(report.undercutArea).toBeLessThan(753.99);
    const planes = report.faces.filter((f) => topo.faces[f.face]!.surface === 'plane');
    for (const f of planes) {
      const nz = topo.faces[f.face]!.normal![2];
      expect(f.kind, JSON.stringify(kinds)).toBe(nz > 0.99 ? 'up' : nz < -0.99 ? 'down' : 'both');
    }
    expect(report.totals.up.faces).toBe(1);
    expect(report.totals.down.faces).toBe(1);
    expect(report.totals.both.faces).toBe(4);
  });

  it('the share seen each way: the top 1 above and 0 below, the bottom the other way', () => {
    const topo = kernel.topology(shape);
    const top = report.faces.find((f) => topo.faces[f.face]!.normal?.[2] === 1)!;
    expect([top.up, top.down, top.blocked]).toEqual([expect.closeTo(1, 9), expect.closeTo(0, 9), expect.closeTo(0, 9)]);
    const bottom = report.faces.find((f) => topo.faces[f.face]!.normal?.[2] === -1)!;
    expect([bottom.up, bottom.down]).toEqual([expect.closeTo(0, 9), expect.closeTo(1, 9)]);
  });

  it('the mold opening along the hole instead (x): the hole is seen from its ends, nothing is an undercut', () => {
    const along = kernel.undercutAnalysis(shape, [1, 0, 0]);
    expect(along.totals.undercut.faces).toBe(0);
    expect(along.totals.partial.faces).toBe(0);
    expect(along.undercutArea).toBeLessThan(1);
  });

  it('the direction does not have to be a unit vector, and the other way is the same analysis with up and down changed places', () => {
    const scaled = kernel.undercutAnalysis(shape, [0, 0, 5]);
    expect(scaled.faces.map((f) => f.kind)).toEqual(report.faces.map((f) => f.kind));
    const flipped = kernel.undercutAnalysis(shape, [0, 0, -1]);
    const swap = { up: 'down', down: 'up', both: 'both', split: 'split', partial: 'partial', undercut: 'undercut', unknown: 'unknown' } as const;
    expect(flipped.faces.map((f) => f.kind)).toEqual(report.faces.map((f) => swap[f.kind]));
  });

  it('with only a few of the triangles used (maxSamples 40) the classes are the same', () => {
    const few = kernel.undercutAnalysis(shape, [0, 0, 1], { maxSamples: 40 });
    expect(few.samples).toBeLessThan(report.samples);
    expect(few.faces.map((f) => f.kind)).toEqual(report.faces.map((f) => f.kind));
  });

  it('leaves the shape as it was', () => {
    const before = [kernel.topology(shape).faces.length, kernel.massProps(shape).volume];
    kernel.undercutAnalysis(shape, [0, 0, 1]);
    expect([kernel.topology(shape).faces.length, kernel.massProps(shape).volume]).toEqual(before);
  });
});

describe('a block 40 × 40 × 20 with a slot 10 wide, 5 high and 15 deep cut into its side at z = 5 to 10', () => {
  const slotted = () =>
    body(
      build(
        ...block(),
        { id: 'rpl', type: 'refPlane', name: 'rpl', suppressed: false, def: { mode: 'offset', plane: on('plane:right'), distance: '20' } } as Feature,
        sketch('k', on('rpl'), rectangle('q', -10, -5, 5, 10)),
        extrude('x', 'k', 'cut', { type: 'blind', depth: '15' }),
      ),
    );

  it('the five faces of the slot are undercuts, 150 + 150 + 50 + 75 + 75 = 500 mm², and nothing else is', () => {
    const shape = slotted();
    const topo = kernel.topology(shape);
    expect(kernel.massProps(shape).volume).toBeCloseTo(40 * 40 * 20 - 10 * 5 * 15, 6);
    const report = kernel.undercutAnalysis(shape, [0, 0, 1]);
    expect(report.totals.undercut.faces).toBe(5);
    expect(report.totals.undercut.area).toBeCloseTo(500, 6);
    expect(report.totals.partial.faces).toBe(0);
    // the faces that are not the slot: the top is seen from above, the bottom from below
    const top = report.faces.find((f) => topo.faces[f.face]!.normal?.[2] === 1 && topo.faces[f.face]!.center[2] > 19)!;
    expect(top.kind).toBe('up');
    expect(report.faces.find((f) => topo.faces[f.face]!.normal?.[2] === -1 && topo.faces[f.face]!.center[2] < 1)!.kind).toBe('down');
  });

  it('opened along the slot (x) it is no undercut: the slot is seen from the side it opens to', () => {
    const report = kernel.undercutAnalysis(slotted(), [1, 0, 0]);
    expect(report.totals.undercut.faces).toBe(0);
  });
});

describe('a part with many triangles', () => {
  const sphere = () => {
    const oc = (kernel as unknown as { oc: any }).oc; // eslint-disable-line @typescript-eslint/no-explicit-any
    return (kernel as unknown as { put(s: unknown): ShapeId }).put(new oc.BRepPrimAPI_MakeSphere(50).Shape());
  };

  it('a sphere of 25 000 triangles, every one a point: all seen from one side or the other (nothing blocked), in well under a second alone (the plan asked for one for 30 000)', () => {
    const report = kernel.undercutAnalysis(sphere(), [0, 0, 1], { tolerance: 0.02, angular: 0.1, maxSamples: 200000 });
    expect(report.triangles).toBeGreaterThan(20000);
    expect(report.triangles).toBeLessThan(40000);
    expect(report.samples).toBeGreaterThan(report.triangles - 10); // (the degenerate triangles at the poles are left out)
    // a sphere is seen from above where it faces up and from below where it faces down: the one face has both, so it is `split`, and none of it is blocked
    expect(report.faces[0]!.kind).toBe('split');
    expect(report.undercutArea).toBeLessThan(1e-6);
    expect(report.faces[0]!.up).toBeGreaterThan(0.45);
    expect(report.faces[0]!.up).toBeLessThan(0.55);
    if (process.env.PERF_CHECK) {
      expect(report.ms).toBeLessThan(4000); // (0.4 s alone; the room is for the suite running at once)
    }
    writeTiming(report);
  });

  it('and one of 125 000, meshed to a few microns: nothing blocked either', () => {
    const report = kernel.undercutAnalysis(sphere(), [0, 0, 1], { tolerance: 0.004, angular: 0.04, maxSamples: 200000 });
    expect(report.triangles).toBeGreaterThan(100000);
    expect(report.undercutArea).toBeLessThan(1e-6);
    // (the time is reported, not asserted: it is three seconds alone and three times that when the whole suite runs at once)
    writeTiming(report);
  });
});

function writeTiming(r: UndercutReport) {
  // kept in the test's output for the ADR: the size and the time
  process.stdout.write(`[6-2] ${r.triangles} triangles, ${r.samples} points, ${r.ms.toFixed(0)} ms\n`);
}

describe('what is refused', () => {
  it('a direction of zero length', () => {
    const shape = body(build(...block()));
    expect(() => kernel.undercutAnalysis(shape, [0, 0, 0])).toThrow(KernelError);
  });
});
