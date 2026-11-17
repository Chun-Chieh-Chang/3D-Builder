/**
 * ADR 0255: reading a drafted wall. `faceDraftedAlong` on walls this program drafted (ADR 0251), before and after STEP; what is no drafted wall; a section
 * of one read exactly at any height (`sectionCurves`); its curve at a plane between two points (`wallCurveBetween`). The truth is the solid made here: the
 * wall is measured against itself (points of a read curve to the wall's face), the angle against the one it was made with.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Kernel, nurbsAt, type NurbsSectionEdge, type ShapeId } from '../src';
import { OUTLINE } from './draft-spline.kit';

const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const rad = (deg: number) => (deg * Math.PI) / 180;
const RECT = { u0: -20, u1: 60, v0: -20, v1: 60 };
const H = 10;

let kernel: Kernel;
beforeAll(async () => {
  kernel = await Kernel.load();
});
afterAll(() => undefined);

const release = (...ids: ShapeId[]) => ids.forEach((id) => kernel.release(id));
const drafted = (deg: number) => kernel.extrude(XY as never, [{ outer: OUTLINE, holes: [] }] as never, [0, 0, H], 0, undefined, rad(deg));
const throughStep = (id: ShapeId) => kernel.importStep(new TextEncoder().encode(kernel.exportStep(id, 'p'))).shape;
const sourceOf = (o: { rel: string; kind?: string; source?: string }[]) => o.find((x) => x.rel === 'generated' && x.kind === 'profileEdge')?.source;

/** The distance from a point to a face of `id`. */
function toFace(id: ShapeId, face: number, p: number[]): number {
  const oc = kernel.oc as any;
  const k = kernel as any;
  const faces: any[] = [];
  for (const ex = new oc.TopExp_Explorer(k.get(id), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) faces.push(ex.Current());
  const v = new oc.BRepBuilderAPI_MakeVertex(new oc.gp_Pnt(p[0], p[1], p[2])).Vertex();
  const d = new oc.BRepExtrema_DistShapeShape(v, faces[face], oc.Extrema_ExtFlag.Extrema_ExtFlag_MIN, oc.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad, new oc.Message_ProgressRange());
  const out = d.IsDone() ? d.Value() : Infinity;
  d.delete();
  return out;
}

describe('a drafted wall read back', () => {
  it('reads the spline wall at the angle it was drafted with, signed as a plane is (+ narrowing), before and after STEP; no other face', () => {
    for (const deg of [1.5, -3, 8, -0.5]) {
      const r = drafted(deg);
      const back = throughStep(r.shape);
      try {
        r.faceOrigins.forEach((o, i) => {
          const got = kernel.faceDraftedAlong(r.shape, i, [0, 0, 1], 1e-6);
          if (sourceOf(o) === 'c') {
            expect(got, `${deg}°`).not.toBeNull();
            expect(Math.abs(got!.lean - rad(deg)), `${deg}°`).toBeLessThan(1e-9);
            // the wall is made to within ~1e-8 of the exact draft (ADR 0255: its far curve approximated to 1e-8, degree 5, taken within 1e-7)
            expect(got!.deviation).toBeLessThan(1e-7);
            // asked along the other way, the sign turns
            expect(Math.abs(kernel.faceDraftedAlong(r.shape, i, [0, 0, -1], 1e-6)!.lean + rad(deg))).toBeLessThan(1e-9);
          } else expect(got, `${deg}° ${JSON.stringify(o)}`).toBeNull();
        });
        const walls = kernel.topology(back).faces.flatMap((_, i) => {
          const got = kernel.faceDraftedAlong(back, i, [0, 0, 1], 1e-6);
          return got ? [got] : [];
        });
        expect(walls.length, `${deg}° after STEP`).toBe(1);
        expect(Math.abs(walls[0]!.lean - rad(deg))).toBeLessThan(1e-9);
      } finally {
        release(r.shape, back);
      }
    }
  });

  it('is no drafted wall: a straight spline wall, a drafted one asked along another direction, a ruled face whose lean changes along it', () => {
    const straight = kernel.extrude(XY as never, [{ outer: OUTLINE, holes: [] }] as never, [0, 0, H]);
    const r = drafted(3);
    // a loft from the outline to the same outline scaled by 0.8 about (14, 14), 10 above: ruled (two sections), its spline face leaning by a different
    // angle at each ruling, so no draft of one angle
    const scaled = (OUTLINE as { kind: string; a?: number[]; b?: number[]; points?: number[][]; source: string }[]).map((s) => {
      const f = (q: number[]) => [14 + 0.8 * (q[0]! - 14), 14 + 0.8 * (q[1]! - 14)];
      return s.kind === 'spline' ? { ...s, points: s.points!.map(f) } : { ...s, a: f(s.a!), b: f(s.b!) };
    });
    const lo = kernel.loft([{ frame: XY as never, outer: OUTLINE as never }, { frame: { ...XY, origin: [0, 0, H] } as never, outer: scaled as never }]);
    try {
      kernel.topology(straight.shape).faces.forEach((_, i) => expect(kernel.faceDraftedAlong(straight.shape, i, [0, 0, 1], 1e-6)).toBeNull());
      const wall = r.faceOrigins.findIndex((o) => sourceOf(o) === 'c');
      expect(kernel.faceDraftedAlong(r.shape, wall, [1, 0, 0], 1e-6)).toBeNull();
      expect(kernel.faceDraftedAlong(r.shape, wall, [0, 1, 0], 1e-6)).toBeNull();
      const t = kernel.topology(lo.shape);
      const free = t.faces.flatMap((f, i) => (f.geometry ? [] : [i]));
      expect(free.length).toBeGreaterThan(0);
      for (const i of free) expect(kernel.faceDraftedAlong(lo.shape, i, [0, 0, 1], 1e-6), `loft face ${i}`).toBeNull();
      // a tolerance tighter than a drafted wall's own exactness refuses it: the measure is a measure
      const dev = kernel.faceDraftedAlong(r.shape, wall, [0, 0, 1], 1e-6)!.deviation;
      expect(dev).toBeGreaterThan(0);
      expect(kernel.faceDraftedAlong(r.shape, wall, [0, 0, 1], dev / 2)).toBeNull();
    } finally {
      release(straight.shape, r.shape, lo.shape);
    }
  });

  it('refuses a tolerance that is no positive finite length', () => {
    const r = drafted(2);
    try {
      for (const tol of [0, -1e-6, NaN, Infinity]) expect(() => kernel.faceDraftedAlong(r.shape, 0, [0, 0, 1], tol)).toThrow(/drafted wall|拔模牆/);
    } finally {
      release(r.shape);
    }
  });

  it('reads its section exactly at any height: one NURBS piece, every point of it on the wall to 1e-7', () => {
    for (const deg of [4, -4]) {
      const r = drafted(deg);
      const back = throughStep(r.shape);
      try {
        const wall = kernel.topology(back).faces.findIndex((_, i) => kernel.faceDraftedAlong(back, i, [0, 0, 1], 1e-6) !== null);
        for (const z of [0.7, 3.3, 5, 9.1]) {
          const pieces = kernel.sectionCurves(back, { ...XY, origin: [0, 0, z] } as never, RECT).filter((e) => e.kind === 'nurbs') as NurbsSectionEdge[];
          expect(pieces.length, `${deg}° z ${z}`).toBeGreaterThan(0);
          for (const n of pieces) for (let t = 0; t <= 1; t += 0.125) {
            const p = nurbsAt(n, t);
            expect(toFace(back, wall, [p[0], p[1], z]), `${deg}° z ${z} t ${t}`).toBeLessThan(1e-7);
          }
        }
      } finally {
        release(r.shape, back);
      }
    }
  });

  it('gives its curve at a plane between two corners, through the stretch asked; null when the stretch is not near, or the tolerance is no length', () => {
    const r = drafted(-3);
    const back = throughStep(r.shape);
    try {
      const wall = kernel.topology(back).faces.findIndex((_, i) => kernel.faceDraftedAlong(back, i, [0, 0, 1], 1e-6) !== null);
      // the bottom corners of the spline wall are where the outline's spline ends
      const a: [number, number] = [28.72, 25];
      const b: [number, number] = [0, 25];
      const got = kernel.wallCurveBetween(back, XY as never, a, b, [14, 32], 0.5);
      expect(got).not.toBeNull();
      expect(Math.hypot(got!.a[0] - a[0], got!.a[1] - a[1])).toBeLessThan(1e-5);
      expect(Math.hypot(got!.b[0] - b[0], got!.b[1] - b[1])).toBeLessThan(1e-5);
      for (let t = 0; t <= 1; t += 0.125) {
        const p = nurbsAt(got!, t);
        expect(toFace(back, wall, [p[0], p[1], 0]), `t ${t}`).toBeLessThan(1e-7);
      }
      // a point nowhere near the wall's curve: no stretch through it
      expect(kernel.wallCurveBetween(back, XY as never, a, b, [14, 10], 0.5)).toBeNull();
      // ends off the curve
      expect(kernel.wallCurveBetween(back, XY as never, [28.72, 25.1], b, [14, 32], 0.5)).toBeNull();
      for (const midTol of [0, -1, NaN]) expect(kernel.wallCurveBetween(back, XY as never, a, b, [14, 32], midTol)).toBeNull();
    } finally {
      release(r.shape, back);
    }
  });
});
