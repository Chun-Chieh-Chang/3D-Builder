/**
 * A drafted extrusion of an outline with a spline (ADR 0251): `DraftAngle` cannot lean a spline's wall, so such a profile is drafted edge by edge, each
 * wall made on its own (a line's an exact plane, an arc's an exact cone, a curve's the ruled surface to its offset) and the corners left to a Boolean
 * of the walls (`BOPAlgo_MakerVolume`). The truth is the draft's own definition, not the code under test: a point of a wall at height z is z·tan(α)
 * from the outline, measured horizontally (inward for a positive angle). The user accepted 1e-4 mm on a spline's wall (2026-11-13, when OCCT's
 * MakeDraft was to make it); made here it measures 8.4e-10 at worst over 120 fuzz parts, and is held to `WALL` so that gain is not lost unnoticed.
 * The controls with a closed form or another path: an outline whose sides are splines through collinear points goes down the new path and is the
 * box, or the L that DraftAngle drafts, so its volume is theirs.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { Kernel, KernelError, type ShapeId } from '../src';
import { OUTLINE, offDraft } from './draft-spline.kit';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await Kernel.load();
});

const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } as const;
const L = (a: [number, number], b: [number, number], source: string) => ({ kind: 'line' as const, a, b, source });
/** A straight side drawn as a spline through three collinear points: OCCT gives it a B-spline wall, so a profile with it goes down the new path. */
const S = (a: [number, number], b: [number, number], source: string) => ({ kind: 'spline', points: [a, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], b], source });
const rad = (deg: number) => (deg * Math.PI) / 180;
const vol = (id: ShapeId) => kernel.massProps(id, { eps: 1e-10 }).volume;
/** How far a spline's wall may be from the draft (mm): accepted 1e-4, measured 8.4e-10 at worst. */
const WALL = 1e-7;
/** The area of the walls with no simple surface: where a drafted body may differ from the draft by `WALL`. */
const splineArea = (id: ShapeId) => kernel.topology(id).faces.reduce((a, f) => a + (f.geometry ? 0 : f.area), 0);
const release = (...ids: ShapeId[]) => {
  for (const id of ids) kernel.release(id);
};

describe('a drafted extrusion of an outline with a spline', () => {
  for (const [H, deg] of [[10, 1.5], [10, -3], [30, 5]] as const) {
    it(`H ${H}, ${deg}°: a valid solid, every wall z·tan(α) from the outline (planes exactly, the spline within ${WALL} mm), named as a plain extrusion`, () => {
      const plain = kernel.extrude(XY as never, [{ outer: OUTLINE, holes: [] }] as never, [0, 0, H]);
      const r = kernel.extrude(XY as never, [{ outer: OUTLINE, holes: [] }] as never, [0, 0, H], 0, undefined, rad(deg));
      try {
        expect(kernel.check(r.shape).valid).toBe(true);
        expect(kernel.solidCount(r.shape)).toBe(1);
        // narrower or wider than the straight prism, as the sign says
        if (deg > 0) expect(vol(r.shape)).toBeLessThan(vol(plain.shape));
        else expect(vol(r.shape)).toBeGreaterThan(vol(plain.shape));
        const walls = offDraft(kernel, r, plain, rad(deg), H);
        // the premise: four walls, one of them the spline's, measured at many points
        expect(walls.map((w) => w.type).sort()).toEqual(['BSplineSurface', 'Plane', 'Plane', 'Plane']);
        for (const w of walls) expect(w.n).toBeGreaterThan(100);
        for (const w of walls) expect(w.worst, w.type).toBeLessThan(w.type === 'Plane' ? 1e-9 : WALL);
        // names: each wall from its profile edge, and the two caps, as a plain extrusion has them, one face each
        const names = (o: typeof r.faceOrigins) => o.map((x) => x.map((y) => (y.rel === 'cap' ? `cap:${y.which}` : y.rel === 'generated' && y.kind === 'profileEdge' ? y.source : '?')).join('+')).sort();
        expect(names(r.faceOrigins)).toEqual(names(plain.faceOrigins));
        expect(names(r.faceOrigins)).toEqual(['a', 'b', 'c', 'cap:end', 'cap:start', 'd']);
      } finally {
        release(r.shape, plain.shape);
      }
    });
  }

  it('the control with a closed form: a side drawn as a spline through collinear points is the drafted box', () => {
    const [W, D, H, t] = [20, 10, 10, Math.tan(rad(3))];
    const outer = [L([0, 0], [W, 0], 'a'), L([W, 0], [W, D], 'b'), S([W, D], [0, D], 'c'), L([0, D], [0, 0], 'd')];
    for (const sign of [1, -1]) {
      const r = kernel.extrude(XY as never, [{ outer, holes: [] }] as never, [0, 0, H], 0, undefined, sign * rad(3));
      try {
        // the premise: the spline's side is not a plane to OCCT, so this is the new path
        const straight = kernel.extrude(XY as never, [{ outer, holes: [] }] as never, [0, 0, H]);
        expect(kernel.topology(straight.shape).faces.some((f) => !f.geometry)).toBe(true);
        release(straight.shape);
        expect(vol(r.shape)).toBeCloseTo(W * D * H - sign * (W + D) * t * H * H + (4 / 3) * t * t * H ** 3, 6);
      } finally {
        release(r.shape);
      }
    }
  });

  it('corners, concave ones and a hole included, come out as DraftAngle makes them: an L drawn with splines against the L drawn with lines', () => {
    const corners: [number, number][] = [[0, 0], [30, 0], [30, 12], [12, 12], [12, 25], [0, 25]];
    const sides = (mk: typeof L | typeof S) => corners.map((p, i) => mk(p, corners[(i + 1) % corners.length]!, `e${i}`));
    for (const hole of [[], [[{ kind: 'circle', c: [6, 6], r: 3, source: 'h' }]]]) {
      for (const deg of [3, -3]) {
        const byLines = kernel.extrude(XY as never, [{ outer: sides(L), holes: hole }] as never, [0, 0, 10], 0, undefined, rad(deg));
        const bySplines = kernel.extrude(XY as never, [{ outer: sides(S as never), holes: hole }] as never, [0, 0, 10], 0, undefined, rad(deg));
        try {
          // the premise: the L drawn with splines has no plane wall, so its corners are all this path's
          expect(kernel.topology(bySplines.shape).faces.filter((f) => !f.geometry).length).toBeGreaterThanOrEqual(6);
          expect(kernel.check(bySplines.shape).valid).toBe(true);
          // the walls drawn as splines are ruled surfaces to a curve approximated to 1e-9 mm, so the two agree to WALL over them (measured 2.9e-12
          // of the volume, 1.4e-8 mm³), plus the volume integral's own noise
          expect(Math.abs(vol(bySplines.shape) - vol(byLines.shape)), `hole ${hole.length} ${deg}°`).toBeLessThan(WALL * splineArea(bySplines.shape) + 1e-9 * vol(byLines.shape));
        } finally {
          release(byLines.shape, bySplines.shape);
        }
      }
    }
  });

  it('a hole leans the other way, and several regions are a compound of solids', () => {
    const hole = [{ kind: 'circle', c: [12, 10], r: 4, source: 'h' }];
    const H = 10;
    const a = rad(2);
    const withHole = kernel.extrude(XY as never, [{ outer: OUTLINE, holes: [hole] }] as never, [0, 0, H], 0, undefined, a);
    const solid = kernel.extrude(XY as never, [{ outer: OUTLINE, holes: [] }] as never, [0, 0, H], 0, undefined, a);
    try {
      // the hole, a narrowing body's, widens upward: what it takes is the frustum π∫(r + z t)² dz (its wall an exact cone; the spline's within WALL)
      const t = Math.tan(a);
      const frustum = Math.PI * (16 * H + 4 * t * H * H + (t * t * H ** 3) / 3);
      expect(Math.abs(vol(solid.shape) - vol(withHole.shape) - frustum)).toBeLessThan(WALL * splineArea(solid.shape) + 1e-9 * vol(solid.shape));
      expect(kernel.check(withHole.shape).valid).toBe(true);
      expect(kernel.topology(withHole.shape).faces.some((f) => f.geometry?.type === 'cone')).toBe(true);
      expect(withHole.faceOrigins.flat().some((o) => o.rel === 'generated' && o.kind === 'profileEdge' && o.source === 'h')).toBe(true);
    } finally {
      release(withHole.shape, solid.shape);
    }
    const second = [L([40, 0], [50, 0], 'p'), L([50, 0], [50, 10], 'q'), { kind: 'spline', points: [[50, 10], [45, 14], [40, 10]], source: 'r' }, L([40, 10], [40, 0], 's')];
    const two = kernel.extrude(XY as never, [{ outer: OUTLINE, holes: [] }, { outer: second, holes: [] }] as never, [0, 0, H], 0, undefined, a);
    const one = kernel.extrude(XY as never, [{ outer: second, holes: [] }] as never, [0, 0, H], 0, undefined, a);
    const first = kernel.extrude(XY as never, [{ outer: OUTLINE, holes: [] }] as never, [0, 0, H], 0, undefined, a);
    try {
      expect(kernel.solidCount(two.shape)).toBe(2);
      // each region's spline wall is made again in each, within WALL of the draft; the rest is the volume integral's own noise
      expect(Math.abs(vol(two.shape) - (vol(one.shape) + vol(first.shape)))).toBeLessThan(WALL * splineArea(two.shape) + 1e-9 * vol(two.shape));
      expect(two.faceOrigins.every((o) => o.length > 0)).toBe(true);
    } finally {
      release(two.shape, one.shape, first.shape);
    }
  });

  it('refuses, as closing, a draft that closes something before the far end, and makes one that just does not', () => {
    const closes = /收合|closes/;
    // a round hole of a widening body narrows by H·tan|α| on each side: radius 2 against 10·tan 12° = 2.13 closes, against 10·tan 10° = 1.76 does not
    const holed = (deg: number) => kernel.extrude(XY as never, [{ outer: OUTLINE, holes: [[{ kind: 'circle', c: [12, 10], r: 2, source: 'h' }]] }] as never, [0, 0, 10], 0, undefined, rad(deg));
    expect(() => holed(-12)).toThrow(closes);
    release(holed(-10).shape);
    // a round corner of radius 1 shrinks to its apex: inward 10·tan 6° = 1.05 closes it, 10·tan 5° = 0.87 does not
    const rounded = (deg: number) => {
      const outer = [L([0, 0], [20, 0], 'a'), L([20, 0], [20, 14], 'b'), { kind: 'arc', c: [19, 14], r: 1, from: [20, 14], to: [19, 15], ccw: true, source: 'r' }, S([19, 15], [0, 15], 'c'), L([0, 15], [0, 0], 'd')];
      return kernel.extrude(XY as never, [{ outer, holes: [] }] as never, [0, 0, 10], 0, undefined, rad(deg));
    };
    expect(() => rounded(6)).toThrow(closes);
    release(rounded(5).shape);
    // a spline that bends tighter than it moves: a dip of radius about 0.5 mm (measured on the curve below) moved 10·tan 8° = 1.4 mm into it
    const dipped = [L([0, 0], [20, 0], 'a'), L([20, 0], [20, 15], 'b'), { kind: 'spline', points: [[20, 15], [10.5, 15], [10, 13], [9.5, 15], [0, 15]], source: 'c' }, L([0, 15], [0, 0], 'd')];
    const straight = kernel.extrude(XY as never, [{ outer: dipped, holes: [] }] as never, [0, 0, 10]);
    try {
      // the premise, on the curve itself: its tightest bend is under the move
      const oc = kernel.oc as any;
      let least = Infinity;
      for (const ex = new oc.TopExp_Explorer((kernel as any).get(straight.shape), oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
        const ad = new oc.BRepAdaptor_Curve(oc.TopoDS.Edge(ex.Current()));
        if (!String(ad.GetType()).includes('BSpline') || Math.abs(ad.Value(ad.FirstParameter()).Z()) > 1e-9) continue;
        const [P, V1, V2] = [new oc.gp_Pnt(), new oc.gp_Vec(), new oc.gp_Vec()];
        for (let i = 0; i <= 400; i++) {
          ad.D2(ad.FirstParameter() + ((ad.LastParameter() - ad.FirstParameter()) * i) / 400, P, V1, V2);
          const c = Math.abs(V1.X() * V2.Y() - V1.Y() * V2.X());
          if (c > 1e-12) least = Math.min(least, V1.Magnitude() ** 3 / c);
        }
      }
      expect(least).toBeLessThan(10 * Math.tan(rad(8)));
    } finally {
      release(straight.shape);
    }
    // moved into the dip (narrowing: the material is below the top curve, the dip bends toward it) it closes; a gentle 1° it does not
    expect(() => kernel.extrude(XY as never, [{ outer: dipped, holes: [] }] as never, [0, 0, 10], 0, undefined, rad(8))).toThrow(closes);
    // a square hole of a widening body (its walls planes, no apex to find): 3 mm wide, it closes once each side moves in 1.5, at 10·tan 9° = 1.58,
    // not at 10·tan 8° = 1.41
    const squared = (deg: number) => {
      const hole = [L([10, 8], [13, 8], 'h0'), L([13, 8], [13, 11], 'h1'), L([13, 11], [10, 11], 'h2'), L([10, 11], [10, 8], 'h3')];
      return kernel.extrude(XY as never, [{ outer: OUTLINE, holes: [hole] }] as never, [0, 0, 10], 0, undefined, rad(deg));
    };
    expect(() => squared(-9)).toThrow(closes);
    release(squared(-8).shape);
    // an outline 6 mm wide whose top is a spline, narrowing: it closes once each side moves in 3, at 10·tan 17° = 3.06, not at 10·tan 16° = 2.87
    const narrow = (deg: number) => {
      const outer = [L([0, 0], [6, 0], 'a'), L([6, 0], [6, 20], 'b'), { kind: 'spline', points: [[6, 20], [3, 20.5], [0, 20]], source: 'c' }, L([0, 20], [0, 0], 'd')];
      return kernel.extrude(XY as never, [{ outer, holes: [] }] as never, [0, 0, 10], 0, undefined, rad(deg));
    };
    expect(() => narrow(17)).toThrow(closes);
    release(narrow(16).shape);
  });

  it('where an arc runs into a line tangent there is no corner: each edge is one wall, its arc an exact cone, no name twice', () => {
    // extended past a tangent join, the cone and the plane lie almost on each other and were cut into three faces named after the arc
    const outer = [L([0, 0], [20, 0], 'a'), { kind: 'arc', c: [20, 8], r: 8, from: [20, 0], to: [28, 8], ccw: true, source: 'b' }, L([28, 8], [28, 25], 'e'), { kind: 'spline', points: [[28, 25], [14, 32], [0, 25]], source: 'c' }, L([0, 25], [0, 0], 'd')];
    for (const deg of [2, -2]) {
      const r = kernel.extrude(XY as never, [{ outer, holes: [] }] as never, [0, 0, 10], 0, undefined, rad(deg));
      try {
        expect(kernel.check(r.shape).valid).toBe(true);
        const names = r.faceOrigins.map((o) => o.map((y) => (y.rel === 'cap' ? `cap:${y.which}` : y.rel === 'generated' && y.kind === 'profileEdge' ? y.source : '?')).join('+')).sort();
        expect(names, `${deg}°`).toEqual(['a', 'b', 'c', 'cap:end', 'cap:start', 'd', 'e']);
        expect(kernel.topology(r.shape).faces.filter((f) => f.geometry?.type === 'cone')).toHaveLength(1);
      } finally {
        release(r.shape);
      }
    }
  });

  it('an outline of lines and arcs alone keeps the DraftAngle path: the same solid as before, faces, volume and names', () => {
    // the arc's wall is a cylinder, which DraftAngle leans into a cone; nothing of this goes through the new path
    const outer = [L([0, 0], [20, 0], 'a'), { kind: 'arc', c: [20, 8], r: 8, from: [20, 0], to: [28, 8], ccw: true, source: 'b' }, L([28, 8], [28, 25], 'e'), L([28, 25], [0, 25], 'c'), L([0, 25], [0, 0], 'd')];
    const r = kernel.extrude(XY as never, [{ outer, holes: [] }] as never, [0, 0, 10], 0, undefined, rad(2));
    try {
      const types = kernel.topology(r.shape).faces.map((f) => f.surface).sort();
      expect(types).toEqual(['cone', 'plane', 'plane', 'plane', 'plane', 'plane', 'plane']);
      expect(r.faceOrigins.every((o) => o.length > 0)).toBe(true);
    } finally {
      release(r.shape);
    }
  });

  it('refuses a draft that is no angle, and leaves no shape behind', () => {
    const live = kernel.liveShapes;
    for (const bad of [rad(90), rad(-90), NaN, Infinity]) {
      expect(() => kernel.extrude(XY as never, [{ outer: OUTLINE, holes: [] }] as never, [0, 0, 10], 0, undefined, bad)).toThrow(KernelError);
    }
    expect(kernel.liveShapes).toBe(live);
    const r = kernel.extrude(XY as never, [{ outer: OUTLINE, holes: [] }] as never, [0, 0, 10], 0, undefined, rad(2));
    release(r.shape);
    expect(kernel.liveShapes).toBe(live);
  });
});
