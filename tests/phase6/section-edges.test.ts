/**
 * `Kernel.sectionEdges` gives a spline as exact Bézier spans, in frame coordinates, for the shared section module: the same poles feed feature recognition (which
 * still refuses them) and the line/arc approximation. Truth here does not pass through the conversion: the poles a profile was made with, de Casteljau by hand, the
 * radius of a rational quarter circle, the analytic area of an involute gear, and the area of the curve the kernel fits.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import type { TopoDS_Shape } from 'libcascade/single/init';
import { Kernel, type Frame, type HomogeneousPole, type Region, type SectionEdge, type Segment, type ShapeId } from '@3db/kernel';
import { biarcEnvelope, chainLoops, flatten, LoopError } from '@3db/regen';
import { Arena } from '../../packages/kernel/src/occt';
import { toothedProfile } from '../../packages/regen/src/gears';
import { gearArea } from '../phase3/gear-helpers';
import { bezierAt, cartesian, enclosedArea, fitted, polygonArea, type Pt } from './section-edges-helpers';

let k: Kernel;
beforeAll(async () => {
  k = await Kernel.load();
});

const flat = (z = 0): Frame => ({ origin: [0, 0, z], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] });
const WIDE = { u0: -60, u1: 60, v0: -60, v1: 60 };
const beziers = (edges: SectionEdge[]) => edges.filter((e): e is Extract<SectionEdge, { kind: 'bezier' }> => e.kind === 'bezier');

const BEZIER: Pt[] = [[0, 0], [3, 8], [7, 8], [10, 0]];
const bezierRegion = (): Region => ({
  outer: [
    { kind: 'spline', points: [BEZIER[0]!, BEZIER[3]!], closed: false, source: 'b', bezierPoles: BEZIER } as Segment,
    { kind: 'line', a: BEZIER[3]!, b: BEZIER[0]!, source: 'l' } as Segment,
  ],
  holes: [],
});
const CLOSED: Pt[] = [[10, 0], [5, 9], [-6, 8], [-10, 0], [-5, -8], [6, -9]];
const closedRegion = (): Region => ({ outer: [{ kind: 'spline', points: CLOSED, closed: true, source: 's' } as Segment], holes: [] });
const GEAR = { kind: 'gear' as const, module: 1, teeth: 24, pressureAngle: (20 * Math.PI) / 180, width: 5, bore: 0, backlash: 0, baseHeight: 0 };

/** The poles of a span, read the way they run from `from`. */
function fromEnd(poles: Pt[], from: Pt): Pt[] {
  const d = (p: Pt) => Math.hypot(p[0] - from[0], p[1] - from[1]);
  return d(poles[0]!) <= d(poles.at(-1)!) ? poles : [...poles].reverse();
}
function expectPoles(actual: Pt[], expected: Pt[], tol = 1e-9) {
  expect(actual.length).toBe(expected.length);
  fromEnd(actual, expected[0]!).forEach((p, i) => {
    expect(Math.hypot(p[0] - expected[i]![0], p[1] - expected[i]![1])).toBeLessThanOrEqual(tol);
  });
}
/** De Casteljau at t, written out for a cubic. */
function rightOf(p: Pt[], t: number): Pt[] {
  const mix = (a: Pt, b: Pt): Pt => [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  const ab = mix(p[0]!, p[1]!);
  const bc = mix(p[1]!, p[2]!);
  const cd = mix(p[2]!, p[3]!);
  const abc = mix(ab, bc);
  const bcd = mix(bc, cd);
  return [mix(abc, bcd), bcd, cd, p[3]!];
}

describe('Kernel.sectionEdges: splines', () => {
  it('gives back the poles a Bézier profile was made with, on its cap', () => {
    const s = k.extrude(flat(), [bezierRegion()], [0, 0, 5]).shape;
    const [e] = beziers(k.sectionEdges(s, flat(), WIDE));
    expect(e!.curve).toBe('beziercurve');
    expect(e!.spans.length).toBe(1);
    expectPoles(cartesian(e!.spans[0]!), BEZIER);
    for (const p of e!.spans[0]!) {
      expect(p[2]).toBe(0);
      expect(p[3]).toBe(1);
    }
    k.release(s);
  });

  it('trims a Bézier to the part of it inside the rectangle (the adaptor hands back the whole curve)', () => {
    const s = k.extrude(flat(), [bezierRegion()], [0, 0, 5]).shape;
    // x(t) on these poles crosses 5 at t = 1/2 by symmetry, and x = 8 somewhere else: both cuts checked against de Casteljau by hand
    const half = beziers(k.sectionEdges(s, flat(), { ...WIDE, u0: 5 }));
    expect(half.length).toBe(1);
    expectPoles(cartesian(half[0]!.spans[0]!), rightOf(BEZIER, 0.5), 1e-6);
    k.release(s);
  });

  it('keeps the weights: a rational quarter circle stays on its circle, and x·w is what it says', () => {
    const oc = k.oc;
    const a = new Arena();
    const raw = k as unknown as { put(s: TopoDS_Shape): ShapeId };
    let s: ShapeId | null = null;
    try {
      const r = 10;
      const poles = a.own(new oc.NCollection_Array1_gp_Pnt(1, 3));
      const weights = a.own(new oc.NCollection_Array1_double(1, 3));
      const given: [number, number, number][] = [[r, 0, 1], [r, r, Math.SQRT1_2], [0, r, 1]];
      given.forEach(([x, y, w], i) => {
        poles.SetValue(i + 1, a.own(new oc.gp_Pnt(x, y, 0)));
        weights.SetValue(i + 1, w);
      });
      const curve = a.own(new oc.Geom_BezierCurve(poles, weights));
      const pt = (x: number, y: number) => a.own(new oc.gp_Pnt(x, y, 0));
      const mw = a.own(new oc.BRepBuilderAPI_MakeWire());
      mw.Add(a.own(a.own(new oc.BRepBuilderAPI_MakeEdge(curve)).Edge()));
      mw.Add(a.own(a.own(new oc.BRepBuilderAPI_MakeEdge(pt(0, r), pt(0, 0))).Edge()));
      mw.Add(a.own(a.own(new oc.BRepBuilderAPI_MakeEdge(pt(0, 0), pt(r, 0))).Edge()));
      const face = a.own(a.own(new oc.BRepBuilderAPI_MakeFace(a.own(mw.Wire()), true)).Face());
      const prism = a.own(new oc.BRepPrimAPI_MakePrism(face, a.own(new oc.gp_Vec(0, 0, 5)), false, true));
      const shape = a.own(prism.Shape());
      s = raw.put(shape.Oriented(shape.Orientation()));
      const [e] = beziers(k.sectionEdges(s, flat(), WIDE));
      expect(e!.curve).toBe('beziercurve');
      const span = e!.spans[0]!;
      expect(span.length).toBe(3);
      const mid = span.find((p) => Math.abs(p[3] - Math.SQRT1_2) < 1e-12);
      expect(mid).toBeDefined();
      expect(mid![0]).toBeCloseTo(r * Math.SQRT1_2, 10);
      expect(mid![1]).toBeCloseTo(r * Math.SQRT1_2, 10);
      for (let i = 0; i <= 200; i++) {
        const p = bezierAt(span, i / 200);
        expect(Math.abs(Math.hypot(p[0], p[1]) - r)).toBeLessThan(1e-9);
      }
    } finally {
      if (s !== null) k.release(s);
      a.dispose();
    }
  });

  it('reads the poles in the frame, on a solid moved by a location, on a tilted plane', () => {
    const s = k.extrude(flat(), [bezierRegion()], [0, 0, 5]).shape;
    const c = Math.cos(0.7);
    const n = Math.sin(0.7);
    // rotation about x by 0.7 rad, then a shift: the copy's edges carry it, which the adaptor must apply
    const moved = k.transformed(s, [1, 0, 0, 20, 0, c, -n, -7, 0, n, c, 13]);
    const frame: Frame = { origin: [20, -7, 13], xDir: [1, 0, 0], yDir: [0, c, n], normal: [0, -n, c] };
    const [e] = beziers(k.sectionEdges(moved, frame, WIDE));
    expectPoles(cartesian(e!.spans[0]!), BEZIER, 1e-8);
    for (const p of e!.spans[0]!) expect(p[2]).toBe(0);
    k.release(moved);
    k.release(s);
  });

  it('turns the section of an extruded spline into spans that meet, enclosing the area of the fitted curve', () => {
    const h = 5;
    const s = k.extrude(flat(), [closedRegion()], [0, 0, h]).shape;
    const truth = Math.abs(polygonArea(fitted(k, CLOSED, 20000)));
    expect(truth).toBeGreaterThan(100);
    for (const z of [0, 2.5]) {
      const edges = k.sectionEdges(s, flat(z), WIDE);
      const found = beziers(edges);
      expect(found.length).toBe(edges.length);
      for (const e of found) {
        expect(e.curve).toBe('bsplinecurve');
        e.spans.forEach((span, i) => {
          for (const p of span) expect(p[3]).toBeGreaterThan(0);
          if (i === 0) return;
          const prev = e.spans[i - 1]!;
          const [x, y] = cartesian([prev.at(-1)!])[0]!;
          const [u, v] = cartesian([span[0]!])[0]!;
          expect(Math.hypot(x - u, y - v)).toBeLessThan(1e-9);
        });
      }
      expect(Math.abs(enclosedArea(edges) - truth)).toBeLessThan(1e-5 * truth);
    }
    k.release(s);
  });

  it('adds up across a cut: the two halves of a spline section make the whole', () => {
    const s = k.extrude(flat(), [closedRegion()], [0, 0, 5]).shape;
    const whole = enclosedArea(k.sectionEdges(s, flat(2.5), WIDE));
    const left = enclosedArea(k.sectionEdges(s, flat(2.5), { ...WIDE, u1: 1.25 }));
    const right = enclosedArea(k.sectionEdges(s, flat(2.5), { ...WIDE, u0: 1.25 }));
    expect(left).toBeGreaterThan(0.1 * whole);
    expect(right).toBeGreaterThan(0.1 * whole);
    expect(Math.abs(left + right - whole)).toBeLessThan(1e-5 * whole);
    k.release(s);
  });

  it('matches the analytic area of an involute gear, on the cap (Béziers) and through the middle (B-splines)', () => {
    const s = k.extrude(flat(), [toothedProfile(GEAR)], [0, 0, 5]).shape;
    const truth = gearArea(GEAR);
    expect(truth).toBeGreaterThan(100);
    const cap = k.sectionEdges(s, flat(), WIDE);
    const middle = k.sectionEdges(s, flat(2.5), WIDE);
    expect(new Set(beziers(cap).map((e) => e.curve))).toEqual(new Set(['beziercurve']));
    expect(new Set(beziers(middle).map((e) => e.curve))).toEqual(new Set(['bsplinecurve']));
    expect(beziers(cap).length).toBe(48);
    expect(beziers(middle).length).toBe(48);
    expect(Math.abs(enclosedArea(cap) - truth)).toBeLessThan(1e-3);
    expect(Math.abs(enclosedArea(middle) - truth)).toBeLessThan(1e-3);
    k.release(s);
  });

  it('still calls anything else `other`: the ellipse of a tilted cut through a cylinder', () => {
    const s = k.extrude(flat(), [{ outer: [{ kind: 'circle', c: [0, 0], r: 5, source: 'c' } as Segment], holes: [] }], [0, 0, 40]).shape;
    const c = Math.cos(0.5);
    const n = Math.sin(0.5);
    const edges = k.sectionEdges(s, { origin: [0, 0, 20], xDir: [1, 0, 0], yDir: [0, c, n], normal: [0, -n, c] }, WIDE);
    expect(edges).toEqual([{ kind: 'other', curve: 'ellipse' }]);
    k.release(s);
  });
});

describe('the shared section module', () => {
  it('feature recognition still refuses a spline, naming the same curve type as before', () => {
    const s = k.extrude(flat(), [closedRegion()], [0, 0, 5]).shape;
    let caught: unknown;
    try {
      chainLoops(k.sectionEdges(s, flat(2.5), WIDE));
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(LoopError);
    expect((caught as LoopError).curve).toBe('bsplinecurve');
    k.release(s);
  });

  it('feeds the approximation directly: the kernel spans, biarcs within the bound, the gear area kept', () => {
    const s = k.extrude(flat(), [toothedProfile(GEAR)], [0, 0, 5]).shape;
    const epsilon = 2e-6;
    const truth = gearArea(GEAR);
    const edges = k.sectionEdges(s, flat(2.5), WIDE);
    let pieces = 0;
    // Each spline replaced by its biarcs, read back as the arcs (or lines) they are, and the whole section measured again
    const replaced = edges.flatMap((e): SectionEdge[] => {
      if (e.kind !== 'bezier') return [e];
      return e.spans.flatMap((span) => {
        const out = biarcEnvelope(span, epsilon);
        expect(out.maxBound).toBeLessThanOrEqual(epsilon);
        pieces += out.pieces.length;
        return out.pieces.map((p): SectionEdge => {
          const a: Pt = [p.from[0], p.from[1]];
          const b: Pt = [p.to[0], p.to[1]];
          if (p.kind === 'line') return { kind: 'line', a, b };
          const mid: Pt = [p.mid[0], p.mid[1]];
          const c = circleThrough(a, mid, b);
          return { kind: 'arc', c, r: Math.hypot(a[0] - c[0], a[1] - c[1]), a, b, mid };
        });
      });
    });
    expect(pieces).toBeGreaterThan(48);
    expect(Math.abs(enclosedArea(replaced) - truth)).toBeLessThan(1e-3);
    k.release(s);
  });

  it('takes rational spans as the kernel writes them: flatten agrees with the Bernstein sum', () => {
    const s = k.extrude(flat(), [closedRegion()], [0, 0, 5]).shape;
    const [e] = beziers(k.sectionEdges(s, flat(2.5), WIDE));
    const span: HomogeneousPole[] = e!.spans[0]!;
    const { points, maxBound } = flatten(span, 1e-5);
    expect(maxBound).toBeLessThanOrEqual(1e-5);
    const first = bezierAt(span, 0);
    const last = bezierAt(span, 1);
    expect(Math.hypot(points[0]![0] - first[0], points[0]![1] - first[1])).toBeLessThan(1e-12);
    expect(Math.hypot(points.at(-1)![0] - last[0], points.at(-1)![1] - last[1])).toBeLessThan(1e-12);
    k.release(s);
  });
});

function circleThrough(a: Pt, m: Pt, b: Pt): Pt {
  const ux = m[0] - a[0];
  const uy = m[1] - a[1];
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const det = 2 * (ux * vy - uy * vx);
  const uu = ux * ux + uy * uy;
  const vv = vx * vx + vy * vy;
  return [a[0] + (uu * vy - vv * uy) / det, a[1] + (ux * vv - vx * uu) / det];
}
