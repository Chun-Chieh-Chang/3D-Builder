/**
 * The mitre (斜接, C11.4, v47): two flanges of 90° on neighbouring edges of a plate 100 × 60 × 1.5 (inside radius 2, K 0.5, outside radius R = 3.5) meet on the vertical plane that halves
 * the corner between their outer faces. The first, on the x = 100 end (length 40: a flat piece 36.5 high), takes the whole width; the second, on the y = 60 edge (96.5 long once the first
 * has been made, length 30: a flat piece 26.5 high), is mitred at its start (the x = 100 end). Everything is worked out by hand from the profile of a flange seen along its edge — the
 * bend is the quarter of an annulus (R, rb) and the flat piece a strip T thick:
 *   - the part of the first flange beyond the plane (the triangle of the corner square, `c = s + R` from the inside of the bend, `s` half the gap across the corner) is
 *       ∫ A(u)(c − u) du + H·(c·T − (R² − rb²)/2)  with  ∫ A(u)(c − u) du = c·π(R² − rb²)/4 − (R³ − rb³)/3;
 *   - the second flange runs on to the outer face of the first and is cut back to the plane: it gains
 *       (R³ − rb³)/3 − s·π(R² − rb²)/4 + H·((R² − rb²)/2 − s·T)   (negative where the gap takes more than the strip has).
 * The face on the plane that is left in the open is the wall of the first flange above the second: √2·T × (36.5 − 26.5).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, createEmptyPart, SCHEMA_VERSION, type Feature, type PartDoc, type Ref } from '@3db/model';
import { edgeFingerprint } from '@3db/naming';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { flatPattern, Regenerator, type RebuildResult } from '@3db/regen';
import { front, rectangle, sketch, statuses } from '../phase1/builders';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});
afterAll(() => kept.forEach((r) => r.dispose()));

const rebuild = (doc: PartDoc): RebuildResult => {
  const regen = new Regenerator(kernel, solver, new Map());
  kept.push(regen);
  return regen.rebuild(doc);
};
const build = (features: Feature[]): PartDoc => features.reduce((d, feature, index) => applyCommand(d, { type: 'insertFeature', feature, index }), createEmptyPart());
const failures = (r: RebuildResult) => statuses(r).filter((s) => !s.endsWith('=ok'));
const T = 1.5;
const rb = 2;
const R = rb + T;
const K = 0.5;
const H1 = 40 - R;
const H2 = 30 - R;
const plate: Feature[] = [sketch('sk', front, rectangle('r', 0, 0, 100, 60)), { id: 'bf', type: 'baseFlange', name: 'bf', suppressed: false, sketch: 'sk', thickness: '1.5', radius: '2', kFactor: '0.5' } as Feature];
const bend = (w: number) => (Math.PI / 2) * T * w * (rb + T / 2);

function edgeAt(r: RebuildResult, mid: [number, number, number]): Ref {
  const i = r.body!.topology.edges.findIndex((e) => e.curve === 'line' && Math.hypot(e.mid[0] - mid[0], e.mid[1] - mid[1], e.mid[2] - mid[2]) < 1e-6);
  expect(i, `an edge at ${mid}`).toBeGreaterThanOrEqual(0);
  return { kind: 'edge', name: r.body!.names.edges[i]!, fingerprint: edgeFingerprint(r.body!.topology, i) };
}
let edgeA: Ref;
let edgeB: Ref;
beforeAll(() => {
  edgeA = edgeAt(rebuild(build(plate)), [100, 30, T]);
  edgeB = edgeAt(rebuild(build([...plate, flangeA()])), [48.25, 60, T]);
});
const flangeA = (extra: Record<string, unknown> = {}): Feature => ({ id: 'fa', type: 'edgeFlange', name: 'fa', suppressed: false, edge: edgeA, length: '40', ...extra }) as Feature;
const flangeB = (extra: Record<string, unknown> = {}): Feature => ({ id: 'fb', type: 'edgeFlange', name: 'fb', suppressed: false, edge: edgeB, length: '30', ...extra }) as Feature;
const make = (extra: Record<string, unknown> = {}, first: Record<string, unknown> = {}) => rebuild(build([...plate, flangeA(first), flangeB(extra)]));
const volume = (r: RebuildResult) => kernel.massProps(r.body!.shape).volume;

const annulus = (c: number) => (c * Math.PI * (R * R - rb * rb)) / 4 - (R ** 3 - rb ** 3) / 3;
const removedFromFirst = (s: number) => annulus(s + R) + H1 * ((s + R) * T - (R * R - rb * rb) / 2);
const gainedBySecond = (s: number) => (R ** 3 - rb ** 3) / 3 - (s * Math.PI * (R * R - rb * rb)) / 4 + H2 * ((R * R - rb * rb) / 2 - s * T);
const plateVolume = 100 * 60 * T - R * 60 * T - R * 96.5 * T;
const expected = (gap: number) => {
  const s = gap / Math.SQRT2;
  return plateVolume + bend(60) + T * 60 * H1 + bend(96.5) + T * 96.5 * H2 - removedFromFirst(s) + gainedBySecond(s);
};

describe('a mitre (v47)', () => {
  it('gap 0: the second flange runs on to the outer face of the first and the two are cut to the halving plane; the volume is the sum less what the plane takes from the first plus what the second gains', () => {
    const r = make({ miter: { start: '0' } });
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(expected(0), 3);
    expect(kernel.solidCount(r.body!.shape)).toBe(1);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    // without a mitre the same two flanges leave the corner open: their difference is what the hand calculation says
    const open = make();
    expect(failures(open)).toEqual([]);
    expect(volume(r) - volume(open)).toBeCloseTo(gainedBySecond(0) - removedFromFirst(0), 3);
  });

  it('the face of the mitre that is left in the open is the first flange above the second: √2 · 1.5 × 10 mm², on a plane through the corner at 45°', () => {
    const r = make({ miter: { start: '0' } });
    const h = Math.SQRT1_2;
    const faces = r.body!.topology.faces.filter((f) => f.normal && Math.abs(Math.abs(f.normal[0] * h - f.normal[1] * h) - 1) < 1e-6 && Math.abs(f.normal[2]) < 1e-6);
    expect(faces).toHaveLength(1);
    expect(faces[0]!.area).toBeCloseTo(Math.SQRT2 * T * (H1 - H2), 4);
    // the plane passes through the corner of the outer faces (100, 60): x − 100 = y − 60
    const c = faces[0]!.center;
    expect(c[0] - 100 - (c[1] - 60)).toBeCloseTo(0, 6);
    // and nothing sticks out past the outer faces
    const xs = r.body!.topology.vertices.map((v) => v.point);
    expect(Math.max(...xs.map((p) => p[0]))).toBeCloseTo(100, 6);
    expect(Math.max(...xs.map((p) => p[1]))).toBeCloseTo(60, 6);
  });

  it('a gap of 1 leaves 1 between the cut faces (s = 1/√2 each way): the hand volume with s = 0.5·gap√2', () => {
    const r = make({ miter: { start: '1' } });
    expect(failures(r)).toEqual([]);
    expect(volume(r)).toBeCloseTo(expected(1), 3);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    // two bodies are not made: the flanges stay in one piece through the plate
    expect(kernel.solidCount(r.body!.shape)).toBe(1);
    expect(volume(r)).toBeLessThan(volume(make({ miter: { start: '0' } })));
  });

  it('the flat pattern: the first flange is cut back along the curve of the plane across its bend and the second grows by the same shape; areas by hand, and the folded volume at K 0.5', () => {
    const r = make({ miter: { start: '0' } });
    const o = make();
    const [pm, po] = [r, o].map((x) => {
      const p = flatPattern(kernel, x.sheet!);
      // one piece, valid: the two flanges meet at the corner without overlapping (each is cut to its own curve)
      expect(kernel.solidCount(p.shape)).toBe(1);
      expect(kernel.isValid(p.shape)).toBe(true);
      kernel.release(p.shape);
      return p;
    }) as [ReturnType<typeof flatPattern>, ReturnType<typeof flatPattern>];
    const Rn = rb + K * T;
    const A = (Math.PI / 2) * Rn;
    const cutBack = R * A - Rn * Rn + (R - Rn) * H1; // the first flange loses, along its end
    const gain = Rn * Rn + Rn * H2; // the second gains
    expect(pm.area - po.area).toBeCloseTo(gain - cutBack, 1);
    // the unrolled neutral surface is not exactly the folded solid across a bend that is cut at an angle: the flat volume is within 0.01 % (here 0.57 mm³ of 16382, with the curve in 24 chords)
    expect(Math.abs(pm.volume - volume(r)) / volume(r)).toBeLessThan(1e-4);
    expect(pm.bends).toHaveLength(2);
    // the bend lines end on the curve, half way through the bend
    const second = pm.bends[1]!;
    const first = pm.bends[0]!;
    expect(Math.hypot(second.b[0] - second.a[0], second.b[1] - second.a[1])).toBeGreaterThan(0);
    expect(Math.hypot(first.b[0] - first.a[0], first.b[1] - first.a[1])).toBeLessThan(60);
  });

  it('records the mitre on both flanges, for the flat pattern: the second at its start, the first at its end', () => {
    const r = make({ miter: { start: '0' } });
    const [a, b] = r.sheet!.flanges;
    expect(b!.miter[0]).toEqual({ s: 0, xOuter: expect.closeTo(-96.5 / 2 - R, 9) });
    expect(b!.miter[1]).toBeNull();
    expect(a!.miter[1]).toMatchObject({ s: 0, xOuter: expect.closeTo(30, 9) });
    expect(a!.miter[0]).toBeNull();
  });

  it('says why when it cannot: no flange next to the end, the neighbour has an inset, a different radius, not 90°, a corner as well, a negative gap, the bend outside', () => {
    const why = (r: RebuildResult) => r.features.find((f) => f.id === 'fb')!;
    expect(why(make({ miter: { end: '0' } }))).toMatchObject({ status: 'error', message: expect.stringContaining('斜接') });
    expect(why(make({ miter: { start: '0' } }, { inset: { start: '0', end: '2' } }))).toMatchObject({ status: 'error', message: expect.stringContaining('斜接') });
    expect(why(make({ miter: { start: '0' } }, { radius: '3' }))).toMatchObject({ status: 'error', message: expect.stringMatching(/半徑|斜接/) });
    expect(why(make({ miter: { start: '0' } }, { angle: '60' }))).toMatchObject({ status: 'error', message: expect.stringContaining('90') });
    expect(why(make({ miter: { start: '0' }, angle: '60' }))).toMatchObject({ status: 'error', message: expect.stringContaining('90') });
    expect(why(make({ miter: { start: '0' }, corner: { start: '0.5' } }))).toMatchObject({ status: 'error', message: expect.stringContaining('同時') });
    expect(() => make({ miter: { start: '-1' } })).toThrow();
    expect(why(make({ miter: { start: '0' }, position: 'bendOutside' }))).toMatchObject({ status: 'error' });
  });

  it('the first flange has nothing to meet yet: a mitre on it is said, and the flange made later cannot be mitred against a neighbour that already has a mitre at that end', () => {
    const first = rebuild(build([...plate, flangeA({ miter: { start: '0', end: '0' } })]));
    expect(first.features.find((f) => f.id === 'fa')).toMatchObject({ status: 'error', message: expect.stringContaining('斜接') });
  });

  it('setEdgeFlange carries the mitre; the version is 47; taking it away gives the open corner back', () => {
    let d = build([...plate, flangeA(), flangeB()]);
    expect(d.schemaVersion).toBe(SCHEMA_VERSION);
    d = applyCommand(d, { type: 'setEdgeFlange', featureId: 'fb', flange: { edge: edgeB, length: '30', miter: { start: '0' } } });
    expect(failures(rebuild(d))).toEqual([]);
    expect(d.features.find((f) => f.id === 'fb')).toMatchObject({ miter: { start: '0' } });
    const open = volume(make());
    d = applyCommand(d, { type: 'setEdgeFlange', featureId: 'fb', flange: { edge: edgeB, length: '30' } });
    expect(volume(rebuild(d))).toBeCloseTo(open, 6);
  });

  it('follows the model: the plate 140 long moves the first flange, and the corner is still mitred (the volume of the longer plate and the second flange along it, the corner the same)', () => {
    const wide: Feature[] = [sketch('sk', front, rectangle('r', 0, 0, 140, 60)), plate[1]!];
    const e = rebuild(build(wide));
    const a = { ...flangeA(), edge: edgeAt(e, [140, 30, T]) } as Feature;
    const withA = rebuild(build([...wide, a]));
    const b = { ...flangeB({ miter: { start: '0' } }), edge: edgeAt(withA, [(140 - R) / 2, 60, T]) } as Feature;
    const r = rebuild(build([...wide, a, b]));
    expect(failures(r)).toEqual([]);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    expect(volume(r) - expected(0)).toBeCloseTo(40 * 60 * T - R * 40 * T + bend(40) + T * 40 * H2, 3);
  });
});

describe('mitres of other sizes, by the same hand formulas', () => {
  const cases: { T: number; rb: number; k: number; L1: number; L2: number; gap: number }[] = [
    { T: 1, rb: 1, k: 0.5, L1: 25, L2: 25, gap: 0 },
    { T: 2, rb: 3, k: 0.4, L1: 30, L2: 45, gap: 0 },
    { T: 0.8, rb: 0.8, k: 0.33, L1: 40, L2: 15, gap: 0.5 },
    { T: 2.5, rb: 2, k: 0.5, L1: 35, L2: 35, gap: 1.2 },
    { T: 1.2, rb: 4, k: 0.45, L1: 20, L2: 50, gap: 0.2 },
  ];
  for (const c of cases) {
    it(`T ${c.T}, radius ${c.rb}, flanges ${c.L1} and ${c.L2}, gap ${c.gap}: the volume is the hand formula, one valid solid, and the flat pattern is one valid piece of the area the formulas give`, () => {
      const Rc = c.rb + c.T;
      const h1 = c.L1 - Rc;
      const h2 = c.L2 - Rc;
      const s = c.gap / Math.SQRT2;
      const bendOf = (w: number) => (Math.PI / 2) * c.T * w * (c.rb + c.T / 2);
      const p: Feature[] = [sketch('sk', front, rectangle('r', 0, 0, 100, 60)), { id: 'bf', type: 'baseFlange', name: 'bf', suppressed: false, sketch: 'sk', thickness: String(c.T), radius: String(c.rb), kFactor: String(c.k) } as Feature];
      const eA = edgeAt(rebuild(build(p)), [100, 30, c.T]);
      const fa = { id: 'fa', type: 'edgeFlange', name: 'fa', suppressed: false, edge: eA, length: String(c.L1) } as Feature;
      const eB = edgeAt(rebuild(build([...p, fa])), [(100 - Rc) / 2, 60, c.T]);
      const fb = { id: 'fb', type: 'edgeFlange', name: 'fb', suppressed: false, edge: eB, length: String(c.L2), miter: { start: String(c.gap) } } as Feature;
      const r = rebuild(build([...p, fa, fb]));
      expect(failures(r)).toEqual([]);
      const ann = (cc: number) => (cc * Math.PI * (Rc * Rc - c.rb * c.rb)) / 4 - (Rc ** 3 - c.rb ** 3) / 3;
      const removed = ann(s + Rc) + h1 * ((s + Rc) * c.T - (Rc * Rc - c.rb * c.rb) / 2);
      const gained = (Rc ** 3 - c.rb ** 3) / 3 - (s * Math.PI * (Rc * Rc - c.rb * c.rb)) / 4 + h2 * ((Rc * Rc - c.rb * c.rb) / 2 - s * c.T);
      const w2 = 100 - Rc;
      const total = 100 * 60 * c.T - Rc * 60 * c.T - Rc * w2 * c.T + bendOf(60) + c.T * 60 * h1 + bendOf(w2) + c.T * w2 * h2 - removed + gained;
      expect(kernel.massProps(r.body!.shape).volume).toBeCloseTo(total, 2);
      expect(kernel.solidCount(r.body!.shape)).toBe(1);
      expect(kernel.isValid(r.body!.shape)).toBe(true);
      // the flat pattern: the first loses what its end is cut back by, the second gains by its curve, both across the neutral length of the bend
      const open = rebuild(build([...p, fa, { ...fb, miter: undefined } as Feature]));
      const [pm, po] = [r, open].map((x) => {
        const f = flatPattern(kernel, x.sheet!);
        expect(kernel.solidCount(f.shape)).toBe(1);
        expect(kernel.isValid(f.shape)).toBe(true);
        kernel.release(f.shape);
        return f;
      }) as [ReturnType<typeof flatPattern>, ReturnType<typeof flatPattern>];
      const Rn = c.rb + c.k * c.T;
      const A = (Math.PI / 2) * Rn;
      // ∫ wave dv over the bend = Rn²; the wall is constant at Rn; the first is short of the outer face by R + s − wave (bend) and R − Rn + s (wall); the second is s short of its wave
      const cutBack = (Rc + s) * A - Rn * Rn + (Rc - Rn + s) * h1;
      const gain = Rn * Rn - s * A + (Rn - s) * h2;
      expect(pm.area - po.area).toBeCloseTo(gain - cutBack, 1);
    });
  }
});

describe('a box with the four corners mitred', () => {
  it('four flanges of different heights on the four edges of the plate, each mitred against the ones before it: one valid solid, the volume the sum of the four flanges and the plate less what the eight cuts take plus what they give, by the same formulas', () => {
    const heights = { fa: 40, fb: 30, fc: 35, fd: 25 };
    const hOf = (k: keyof typeof heights) => heights[k] - R;
    const f1 = flangeA();
    const withA = rebuild(build([...plate, f1]));
    const eB = edgeAt(withA, [48.25, 60, T]);
    const f2 = { id: 'fb', type: 'edgeFlange', name: 'fb', suppressed: false, edge: eB, length: '30', miter: { start: '0' } } as Feature;
    const withB = rebuild(build([...plate, f1, f2]));
    expect(failures(withB)).toEqual([]);
    const eC = edgeAt(withB, [0, (60 - R) / 2, T]);
    const f3 = { id: 'fc', type: 'edgeFlange', name: 'fc', suppressed: false, edge: eC, length: '35', miter: { start: '0' } } as Feature;
    const withC = rebuild(build([...plate, f1, f2, f3]));
    expect(failures(withC)).toEqual([]);
    const eD = edgeAt(withC, [50, 0, T]);
    const f4 = { id: 'fd', type: 'edgeFlange', name: 'fd', suppressed: false, edge: eD, length: '25', miter: { start: '0', end: '0' } } as Feature;
    const r = rebuild(build([...plate, f1, f2, f3, f4]));
    expect(failures(r)).toEqual([]);
    const removed = (h: number) => annulus(R) + h * (R * T - (R * R - rb * rb) / 2);
    const gained = (h: number) => (R ** 3 - rb ** 3) / 3 + h * ((R * R - rb * rb) / 2);
    const widths = { fa: 60, fb: 100 - R, fc: 60 - R, fd: 100 - 2 * R };
    const flanges = (Object.keys(widths) as (keyof typeof widths)[]).reduce((a, k) => a + bend(widths[k]) + T * widths[k] * hOf(k), 0);
    const trims = R * T * (60 + (100 - R) + (60 - R) + (100 - 2 * R));
    const corners = [
      ['fa', 'fb'],
      ['fb', 'fc'],
      ['fc', 'fd'],
      ['fa', 'fd'],
    ] as const;
    const net = corners.reduce((a, [earlier, later]) => a - removed(hOf(earlier)) + gained(hOf(later)), 0);
    expect(volume(r)).toBeCloseTo(100 * 60 * T - trims + flanges + net, 2);
    expect(kernel.solidCount(r.body!.shape)).toBe(1);
    expect(kernel.isValid(r.body!.shape)).toBe(true);
    // and the flat pattern is one valid piece
    const p = flatPattern(kernel, r.sheet!);
    expect(kernel.solidCount(p.shape)).toBe(1);
    expect(kernel.isValid(p.shape)).toBe(true);
    kernel.release(p.shape);
    expect(p.bends).toHaveLength(4);
  });
});
