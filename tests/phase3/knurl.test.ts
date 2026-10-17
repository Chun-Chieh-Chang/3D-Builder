/**
 * Knurls (壓花), ADR 0124: the kernel's knurl tool (`Kernel.knurl`), cut into a plain cylinder and checked against what can be worked out by hand or by an
 * integral of the definition, never against itself.
 *
 * One call of `Kernel.knurl` is one hand of grooves, because a tool holding both hands of a diamond has its solids crossing one another and OCCT does
 * not resolve that (it hands back the body plus a solid per groove). A diamond is therefore the two hands cut in turn, which removes the same material:
 * body \ (A ∪ B) = (body \ A) \ B. Everything below is measured on that: `cut` cuts every hand the case asks for, in order.
 *
 * - Straight grooves: `count` prismatic V grooves of depth `d` and included angle α take the V's cross-section out of a cylinder of radius r along length
 *   L. On a *flat* blank that is a triangle of area `d²·tan(α/2)` and the volume is `count · d²·tan(α/2) · L`; on a cylinder it is a little less,
 *   because the flanks leave the material through the curved surface before they reach their nominal width — the removed area is the triangle clipped
 *   by the blank's own circle, which is what `straightRemoved` integrates. The flat formula is the limit as the groove gets shallow, and is checked
 *   as such.
 * - Helical grooves: a profile carried round the axis in a screw motion fills, at every height z, an angular measure `(2π / lead) · w(ρ)` of the
 *   circle of radius ρ, where `w(ρ)` is its axial chord there. Integrating ρ against that over the part of the profile below the blank gives
 *   `count · (2π / lead) · A · ρ̄ · L` (A the triangle's area, ρ̄ its centroid's radius): the closed form the thread tests use. Exact.
 * - Diamond grooves: the two hands cross, so no closed form adds up. The removed volume is instead compared with an integral of the *definition* —
 *   the angular measure the two hands cover at each (ρ, z), worked out by merging the intervals of both helix families there. That integral is first
 *   checked against the closed form in the one-hand case, so it is not taken on trust.
 * - Then: the names of the faces, the STEP round trip, and a closed mesh. The 120-case fuzz (AGENTS.md §3.4) lives in `knurl-fuzz.test.ts` — a helical
 *   sweep leaves the Emscripten heap larger every time, so the fuzz wants a heap of its own.
 *
 * A diamond is expensive — the two hands' flanks cross, and the second cut has to intersect every one of the first hand's grooves — so the diamond
 * cases here are deliberately coarse (a dozen grooves a hand, ~20 s each). That is a property of the geometry, not of the test.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type Frame, type KnurlSpec, type Region, type Segment, type ShapeId, type Vec3 } from '@3db/kernel';
import { binaryStl, readBinaryStl, stlMeasure } from '@3db/io';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await Kernel.load();
});

const TAU = Math.PI * 2;
const deg = (d: number) => (d * Math.PI) / 180;
/** The XZ plane: its x is the distance from the Z axis, its y the height. */
const XZ: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 0, 1], normal: [0, -1, 0] };
const Z_AXIS = { origin: [0, 0, 0] as Vec3, dir: [0, 0, 1] as Vec3 };

type P = [number, number]; // (r, z)
const area2 = (pts: P[]) => pts.reduce((s, [x0, y0], i) => { const [x1, y1] = pts[(i + 1) % pts.length]!; return s + x0 * y1 - x1 * y0; }, 0);
const region = (pts: P[], name = 'p'): Region => {
  const loop = area2(pts) > 0 ? pts : [...pts].reverse();
  return { outer: loop.map((a, i): Segment => ({ kind: 'line', a, b: loop[(i + 1) % loop.length]!, source: `${name}${i + 1}` })), holes: [] };
};
/** OCCT's default rule is about 1e-4 off on a knurl's B-spline flanks (Kernel.massProps). */
const volume = (id: ShapeId) => kernel.massProps(id, { eps: 1e-9 }).volume;
const cylinder = (r: number, z0: number, z1: number): ShapeId => kernel.revolve(XZ, [region([[0, z0], [r, z0], [r, z1], [0, z1]], 'b')], Z_AXIS, TAU).shape;

/** The pattern the *feature* offers; the kernel only ever makes one hand of it. */
type Pattern = 'straight' | 'helical' | 'diamond';
interface Case {
  radius: number;
  from: number;
  to: number;
  count: number;
  depth: number;
  included: number;
  pattern: Pattern;
  angle?: number;
  hand?: 'right' | 'left';
}

/** The one-hand tools a case needs: one for straight or helical, both hands for a diamond. */
const specsOf = (c: Case): KnurlSpec[] => {
  const base = { axis: Z_AXIS, radius: c.radius, count: c.count, from: c.from, to: c.to, depth: c.depth, included: c.included };
  if (c.pattern === 'straight') return [{ ...base, pattern: 'straight' }];
  const angle = c.angle ?? deg(30);
  if (c.pattern === 'helical') return [{ ...base, pattern: 'helical', angle, ...(c.hand ? { hand: c.hand } : {}) }];
  return [
    { ...base, pattern: 'helical', angle, hand: 'right' },
    { ...base, pattern: 'helical', angle, hand: 'left' },
  ];
};

/** A knurl of a plain cylinder that runs well past both ends of it, and what the knurl took away. */
const cut = (c: Case) => {
  const body = cylinder(c.radius, c.from - 5, c.to + 5);
  const specs = specsOf(c);
  const tools = specs.map((s) => kernel.knurl(s));
  const before = volume(body);
  let shape = body;
  for (const t of tools) shape = kernel.boolean('cut', shape, t.shape).shape;
  const after = volume(shape);
  return { specs, tools, shape, body, before, after, removed: before - after };
};

/** The area of a V of depth `d` and included angle α below a *flat* blank: `d²·tan(α/2)`. */
const vArea = (d: number, included: number) => d * d * Math.tan(included / 2);

/**
 * What a straight groove really takes out: the V is a prism along the axis, so its cross-section at radius ρ is a segment of half-width
 * `(ρ − (r − d))·tan(α/2)`, but the material only reaches to ρ = r and the blank's surface is a circle — near the mouth the segment is cut short by
 * `√(r² − ρ²)`, which is what the flanks of a groove on a cylinder actually end at. Integrated over ρ, so it is the definition, not a fit.
 */
const straightRemoved = (c: Case): number => {
  const k = Math.tan(c.included / 2);
  const rho0 = c.radius - c.depth;
  const n = 20000;
  const d = (c.radius - rho0) / n;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const rho = rho0 + (i + 0.5) * d;
    area += 2 * Math.min((rho - rho0) * k, Math.sqrt(Math.max(0, c.radius * c.radius - rho * rho))) * d;
  }
  return c.count * area * (c.to - c.from);
};

// ---------------------------------------------------------------- the definition, integrated

/**
 * The share of the circle of radius `rho` (radians out of 2π) that the grooves cover at height `z`, worked out from the helix equations rather than
 * from any shape: a right-hand groove of index k is centred, at height z, on `(2π/lead)(z − z0) + 2πk/count` and is `(2π/lead)·w(ρ)` wide, where
 * `w(ρ)` is its axial chord there; a left-hand one is the same mirrored. The intervals of both families are merged, which is what makes the two hands
 * of a diamond cross instead of adding up.
 */
const covered = (c: { radius: number; count: number; depth: number; included: number; angle: number }, rho: number, z: number, hands: 1 | 2): number => {
  const chord = 2 * (rho - (c.radius - c.depth)) * Math.tan(c.included / 2);
  if (!(chord > 0)) return 0;
  const lead = TAU * c.radius * Math.tan(c.angle);
  const width = (TAU / lead) * chord;
  const turn = TAU / c.count;
  const intervals: [number, number][] = [];
  for (let k = 0; k < c.count; k++) {
    for (const sign of hands === 2 ? [1, -1] : [1]) {
      const centre = sign * ((TAU / lead) * z) + k * turn;
      intervals.push([centre - width / 2, centre + width / 2]);
    }
  }
  // narrower than a turn, so they never wrap: a plain sort and sweep merges them
  intervals.sort((a, b) => a[0] - b[0]);
  let total = 0;
  let open = intervals[0]!;
  for (const next of intervals.slice(1)) {
    if (next[0] <= open[1]) open = [open[0], Math.max(open[1], next[1])];
    else {
      total += open[1] - open[0];
      open = next;
    }
  }
  return total + (open[1] - open[0]);
};

/**
 * The removed volume of a groove that winds, by integrating the definition over (ρ, z): ∫ ρ dρ ∫ covered dθ, over one turn of the pattern and then as
 * many turns as fit. A straight groove does not wind, and is worked out by `straightRemoved` instead.
 */
const removedByDefinition = (c: Case): number => {
  if (c.pattern === 'straight') throw new Error('a straight groove does not wind: use straightRemoved');
  const angle = c.angle ?? deg(30);
  const hands: 1 | 2 = c.pattern === 'diamond' ? 2 : 1;
  const at = { radius: c.radius, count: c.count, depth: c.depth, included: c.included, angle };
  // the pattern repeats every half a turn of the helix, because the two hands' offset sweeps a whole turn in that
  const period = (TAU * c.radius * Math.tan(angle)) / (2 * c.count);
  const spans = (c.to - c.from) / period;
  const whole = Math.floor(spans + 1e-9);
  const nr = 160;
  const nz = 400;
  const dr = c.depth / nr;
  let total = 0;
  for (let j = 0; j < nr; j++) {
    const rho = c.radius - c.depth + (j + 0.5) * dr;
    const over = (z0: number, z1: number) => {
      const dz = (z1 - z0) / nz;
      let sum = 0;
      for (let i = 0; i < nz; i++) sum += covered(at, rho, z0 + (i + 0.5) * dz, hands) * dz;
      return sum;
    };
    const left = c.to - c.from - whole * period;
    total += rho * dr * (whole * over(c.from, c.from + period) + (left > 0 ? over(c.from, c.from + left) : 0));
  }
  return total;
};

/** How far off a measurement is, as a share of what it should be: the way the thread tests hold the kernel to account. */
const off = (measured: number, expected: number) => Math.abs(measured - expected) / expected;

describe('knurl (ADR 0124)', () => {
  describe('1. Straight grooves against the hand formula', () => {
    it('takes the V below the blank, clipped by the blank’s own circle, out of the cylinder', () => {
      const c: Case = { radius: 9, from: 0, to: 20, count: 40, depth: 0.5, included: deg(90), pattern: 'straight' };
      const m = cut(c);
      expect(off(m.removed, straightRemoved(c))).toBeLessThan(1e-5);
      // and the clip is real: the flat-blank formula overstates it, by about the share the flanks lose at the mouth
      expect(m.removed).toBeLessThan(c.count * vArea(c.depth, c.included) * (c.to - c.from));
      expect(off(m.before, Math.PI * c.radius * c.radius * (c.to - c.from + 10))).toBeLessThan(1e-6);
      expect(kernel.isValid(m.shape)).toBe(true);
      expect(kernel.solidCount(m.shape)).toBe(1);
    });

    it('takes the flat-blank formula to within 0.5% once the groove is shallow, and squares with the depth', () => {
      const shallow: Case = { radius: 9, from: 0, to: 10, count: 30, depth: 0.05, included: deg(90), pattern: 'straight' };
      const deeper: Case = { ...shallow, depth: 0.1 };
      const wider: Case = { ...shallow, included: deg(120) };
      const a = cut(shallow);
      expect(off(a.removed, shallow.count * vArea(shallow.depth, shallow.included) * (shallow.to - shallow.from))).toBeLessThan(0.005);
      // twice the depth is four times the material, and a wider V tan(α/2) times, while the clip stays negligible
      const deeperCut = cut(deeper);
      const widerCut = cut(wider);
      expect(off(deeperCut.removed, a.removed * 4)).toBeLessThan(0.01);
      expect(off(widerCut.removed, a.removed * Math.tan(deg(60)))).toBeLessThan(0.01);
      expect(off(deeperCut.removed, straightRemoved(deeper))).toBeLessThan(1e-5);
      expect(off(widerCut.removed, straightRemoved(wider))).toBeLessThan(1e-5);
    });

    it('names each groove’s flanks after the profile edge and the groove they belong to', () => {
      const c: Case = { radius: 9, from: 0, to: 10, count: 12, depth: 0.4, included: deg(90), pattern: 'straight' };
      const sources = cut(c).tools[0]!.faceOrigins.flat().flatMap((o) => (o.rel === 'generated' && o.kind === 'profileEdge' ? [o.source] : []));
      expect(sources).toContain('knurlFlankA@groove0');
      expect(sources).toContain('knurlFlankB@groove11');
      // the root of a groove is outside the blank, so it names no face of the part after the cut
      expect(sources.some((s) => s.startsWith('knurlRoot'))).toBe(true);
    });
  });

  describe('2. Helical grooves against the screw-motion formula', () => {
    it('takes count · (2π/lead) · A · ρ̄ · L out of the cylinder', () => {
      const c: Case = { radius: 9, from: 0, to: 20, count: 40, depth: 0.3, included: deg(90), pattern: 'helical', angle: deg(30), hand: 'right' };
      const m = cut(c);
      const lead = TAU * c.radius * Math.tan(c.angle!);
      const expected = c.count * ((TAU / lead) * vArea(c.depth, c.included) * (c.radius - c.depth / 3) * (c.to - c.from));
      expect(off(m.removed, expected)).toBeLessThan(1e-5);
      expect(kernel.isValid(m.shape)).toBe(true);
    });

    it('takes the same for either hand, and less for a steeper angle', () => {
      const c: Case = { radius: 9, from: 0, to: 20, count: 40, depth: 0.2, included: deg(90), pattern: 'helical', angle: deg(30) };
      const right = cut({ ...c, hand: 'right' });
      const left = cut({ ...c, hand: 'left' });
      expect(off(left.removed, right.removed)).toBeLessThan(1e-5);
      expect(kernel.isValid(left.shape)).toBe(true);
      const shallow = cut({ ...c, angle: deg(20) });
      const steep = cut({ ...c, angle: deg(40) });
      // lead ∝ tan(angle) and the volume ∝ 1/lead
      expect(off(shallow.removed / steep.removed, Math.tan(deg(40)) / Math.tan(deg(20)))).toBeLessThan(1e-4);
    });

    it('agrees with the integral of the definition, so that integral can be trusted for a diamond', () => {
      const c: Case = { radius: 9, from: 0, to: 20, count: 40, depth: 0.3, included: deg(90), pattern: 'helical', angle: deg(30), hand: 'right' };
      const m = cut(c);
      expect(off(m.removed, removedByDefinition(c))).toBeLessThan(0.01);
    });
  });

  describe('3. Diamond grooves against the integral of the definition', () => {
    it('takes the union of the two hands: more than one hand, less than both added up', () => {
      const c: Case = { radius: 6, from: 0, to: 8, count: 12, depth: 0.25, included: deg(90), pattern: 'diamond', angle: deg(30) };
      const diamond = cut(c);
      const one = cut({ ...c, pattern: 'helical', hand: 'right' });
      expect(diamond.removed).toBeGreaterThan(one.removed);
      expect(diamond.removed).toBeLessThan(2 * one.removed);
      expect(off(diamond.removed, removedByDefinition(c))).toBeLessThan(0.01);
      expect(kernel.isValid(diamond.shape)).toBe(true);
      expect(kernel.solidCount(diamond.shape)).toBe(1);
    }, 300_000);

    it('cuts a coarse 45° diamond the same way', () => {
      const c: Case = { radius: 6, from: 0, to: 8, count: 8, depth: 0.4, included: deg(90), pattern: 'diamond', angle: deg(45) };
      const m = cut(c);
      expect(off(m.removed, removedByDefinition(c))).toBeLessThan(0.01);
    }, 300_000);
  });

  describe('4. What is refused, and why', () => {
    const base: KnurlSpec = { axis: Z_AXIS, radius: 9, count: 40, from: 0, to: 10, depth: 0.3, included: deg(90), pattern: 'straight' };
    const refuses = (patch: Partial<KnurlSpec>, why: RegExp) => expect(() => kernel.knurl({ ...base, ...patch })).toThrowError(why);

    it('refuses a count that is not a whole number, or out of range', () => {
      refuses({ count: 40.5 }, /整數/);
      refuses({ count: 2 }, /整數/);
      refuses({ count: 201 }, /整數/);
    });

    it('refuses a size, an angle or a length that makes no sense', () => {
      refuses({ depth: 0 }, /深度/);
      refuses({ depth: 9 }, /深度/);
      refuses({ included: deg(5) }, /夾角/);
      refuses({ included: deg(175) }, /夾角/);
      refuses({ angle: deg(50), pattern: 'helical' }, /螺旋角/);
      refuses({ angle: 0, pattern: 'helical' }, /螺旋角/);
      refuses({ to: 0 }, /長度/);
      refuses({ from: Number.NaN }, /長度/);
      refuses({ radius: 0 }, /外徑/);
      refuses({ axis: { origin: [0, 0, 0], dir: [0, 0, 0] } }, /軸/);
      refuses({ phase: Number.NaN }, /相位/);
    });

    it('refuses grooves so deep that neighbours would overlap, and says how deep they may be', () => {
      // a 30° helix angle puts neighbouring grooves of one hand `circular pitch · tan 30°` apart along the axis
      const spacing = ((TAU * 9) / 40) * Math.tan(deg(30));
      refuses({ pattern: 'helical', angle: deg(30), depth: (spacing / 2) * 1.01 }, /太深/);
      const ok = kernel.knurl({ ...base, pattern: 'helical', angle: deg(30), depth: spacing / 2 / 1.25 - 1e-6 });
      expect(kernel.isValid(ok.shape)).toBe(true);
      kernel.release(ok.shape);
    });

    it('refuses a helix so shallow that one groove would run more turns than a knurl ever does', () => {
      refuses({ pattern: 'helical', angle: deg(0.5), to: 200, count: 3, depth: 0.05 }, /圈/);
    });

    it('refuses a knurl that would be made of too many pieces', () => {
      refuses({ pattern: 'helical', angle: deg(2), count: 200, to: 60, depth: 0.003 }, /段/);
    });

    it('never hands back a fillet body that fails the validity check: a knurl’s wavy rim is refused, not corrupted', () => {
      // grooves reaching the end faces leave a wavy rim; a fillet there is one place OCCT can come back "done" with a body that fails BRepCheck
      const r = 9, from = 0, to = 20, count = 40, depth = 0.5;
      const body = cylinder(r, from, to);
      const k = kernel.knurl({ axis: Z_AXIS, radius: r, count, from, to, depth, included: deg(90), pattern: 'straight' });
      const shape = kernel.boolean('cut', body, k.shape).shape;
      const rim: number[] = [];
      kernel.topology(shape).edges.forEach((e, i) => { if (Math.abs(e.mid[2] - to) < 1e-3 || Math.abs(e.mid[2] - from) < 1e-3) rim.push(i); });
      const sample = rim.slice(0, 20);
      expect(sample.length).toBeGreaterThan(0);
      let refused = 0;
      for (const radius of [0.05, 0.5, 1.0]) {
        for (const i of sample) {
          let res: { shape: ShapeId } | null = null;
          try { res = kernel.fillet(shape, [i], radius); } catch { refused++; continue; }
          // a returned fillet must be a valid body: the invariant the refusal enforces (before it, some came back corrupt without throwing)
          expect(kernel.isValid(res.shape)).toBe(true);
          kernel.release(res.shape);
        }
      }
      // and the case is not vacuous: some of these really cannot be filleted and must be refused
      expect(refused).toBeGreaterThan(0);
    });
  });

  describe('5. STEP, mesh and the shape of the result', () => {
    const c: Case = { radius: 6, from: 0, to: 8, count: 12, depth: 0.3, included: deg(90), pattern: 'diamond', angle: deg(30) };

    it('writes a knurl to STEP and reads it back', () => {
      const m = cut(c);
      const back = kernel.importStep(kernel.exportStep(m.shape, 'Knurl')).shape;
      expect(kernel.isValid(back)).toBe(true);
      expect(off(volume(back), m.after)).toBeLessThan(1e-5);
    }, 300_000);

    it('meshes into a closed surface, as printing needs', () => {
      const m = cut(c);
      const mesh = kernel.mesh(m.shape, { tolerance: 0.02, angular: 0.3 });
      expect(mesh.indices.length).toBeGreaterThan(600);
      // a welded mesh is closed when every edge lies on exactly two triangles (a sliver triangle's own doubled vertex contributes no edge)
      const key = (i: number) =>
        `${Math.round(mesh.positions[i * 3]! * 1e5)},${Math.round(mesh.positions[i * 3 + 1]! * 1e5)},${Math.round(mesh.positions[i * 3 + 2]! * 1e5)}`;
      const edges = new Map<string, number>();
      for (let t = 0; t < mesh.indices.length; t += 3) {
        const v = [0, 1, 2].map((j) => key(mesh.indices[t + j]!));
        for (let j = 0; j < 3; j++) {
          const [a, b] = [v[j]!, v[(j + 1) % 3]!];
          if (a === b) continue;
          const e = a < b ? `${a}|${b}` : `${b}|${a}`;
          edges.set(e, (edges.get(e) ?? 0) + 1);
        }
      }
      expect([...edges.values()].filter((n) => n !== 2)).toEqual([]);
      // and what the closed mesh encloses is the solid's own volume: an open surface would not give it
      const measured = stlMeasure(readBinaryStl(binaryStl([mesh], 'Knurl')));
      expect(off(measured.volume, m.after)).toBeLessThan(0.01);
    }, 300_000);
  });
});
