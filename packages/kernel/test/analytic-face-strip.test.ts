/**
 * ADR 0258: `Kernel.analyticFace` reads a ruled B-spline strip between two coaxial circle arcs as the cone (or cylinder) its rails define, where
 * OCCT's `GeomConvert_SurfToAnaSurf` misses it (its rulings fan: null) or proposes a surface that fits the face but not its edges (a cylinder on a tilted
 * axis; a cylinder of another radius).
 *
 * The real faces are customer parts and stay out of the repository: REAL_STEP_DIR names the folder with E13-999-421.STEP and
 * 3D_MT17203_CIV0000467_Porduct.STEP (D:\3DB實機確認 on the machine they were measured on). Without it those tests are skipped, and the run says so.
 * Their truth does not come from the code under test. MT17203: probe c13f (three-point circles through the rails, 49.8496°) and every point of the
 * face's own edges (the B-rep curves). E13: its design (r 4.25 at x −39.55 to r 3.675 at x −1.8, on the x axis) and the sag of the surface's straight
 * end rulings from it — 3.78e-5, so at the file's own gap (3e-7, asked as 1e-6) these faces are rightly refused: they are cones only to 3.78e-5.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Kernel, type ShapeId, type SurfaceGeometry, type Vec3 } from '../src';
import { coaxialRails, fitArc } from '../src/coaxialStrip';

let kernel: Kernel;
beforeAll(async () => {
  kernel = await Kernel.load();
});

const dir = process.env.REAL_STEP_DIR;
const deg = (r: number) => (r * 180) / Math.PI;
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.hypot(...a);

/** How far `p` is from the cone `g`: the distance to its nearest ruling, by plane geometry (not the product's equation). */
function offCone(g: Extract<SurfaceGeometry, { type: 'cone' }>, p: Vec3): number {
  const w = sub(p, g.apex);
  const z = dot(w, g.axis);
  const rho = len(sub(w, [g.axis[0] * z, g.axis[1] * z, g.axis[2] * z]));
  // the ruling in the (z, rho) half-plane through the apex at the half-angle: the distance of (z, rho) from the line rho = z·tan
  return Math.abs(rho * Math.cos(g.halfAngle) - z * Math.sin(g.halfAngle));
}

/** Points of every edge of face `face`, 21 along each, from the edge's own B-rep curve. */
function edgePoints(shape: ShapeId, face: number): Vec3[] {
  const k = kernel as any;
  const oc = k.oc;
  const pts: Vec3[] = [];
  const map = new oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher();
  oc.TopExp.MapShapes(k.get(shape), oc.TopAbs_ShapeEnum.TopAbs_FACE, map);
  const f = map.FindKey(face + 1);
  for (const ex = new oc.TopExp_Explorer(f, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
    const c = new oc.BRepAdaptor_Curve(oc.TopoDS.Edge(ex.Current()));
    for (let i = 0; i <= 20; i++) {
      const p = c.Value(c.FirstParameter() + ((c.LastParameter() - c.FirstParameter()) * i) / 20);
      pts.push([p.X(), p.Y(), p.Z()]);
      p.delete();
    }
    c.delete();
  }
  map.delete();
  return pts;
}

/** The surface's points at the four corners of the face's parameter box: the ends of the end rulings, which are straight (degree 1 that way). */
function uvCorners(shape: ShapeId, face: number): Vec3[] {
  const k = kernel as any;
  const oc = k.oc;
  const map = new oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher();
  oc.TopExp.MapShapes(k.get(shape), oc.TopAbs_ShapeEnum.TopAbs_FACE, map);
  const ad = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(map.FindKey(face + 1)), true);
  const out: Vec3[] = [];
  for (const u of [ad.FirstUParameter(), ad.LastUParameter()]) {
    for (const v of [ad.FirstVParameter(), ad.LastVParameter()]) {
      const p = ad.Value(u, v);
      out.push([p.X(), p.Y(), p.Z()]);
      p.delete();
    }
  }
  ad.delete();
  map.delete();
  return out;
}

describe.skipIf(!dir)('real strips OCCT does not read (REAL_STEP_DIR)', () => {
  it('3D_MT17203 faces 274, 276, 278, 281: cones of 49.85°, within the file\'s own gap', () => {
    const shape = kernel.importStep(new Uint8Array(readFileSync(join(dir!, '3D_MT17203_CIV0000467_Porduct.STEP')))).shape;
    try {
      const topo = kernel.topology(shape);
      const tau = kernel.fileTolerance(shape).faces;
      for (const i of [274, 276, 278, 281]) {
        expect(topo.faces[i]!.geometry, `f${i} has no simple surface of its own`).toBeUndefined();
        const tol = Math.max(1e-6, tau[i] ?? 0);
        // the premise: OCCT alone does not read it at this tolerance (the strip is what reads it)
        const k = kernel as any;
        const map = new k.oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher();
        k.oc.TopExp.MapShapes(k.get(shape), k.oc.TopAbs_ShapeEnum.TopAbs_FACE, map);
        const found = new k.oc.GeomConvert_SurfToAnaSurf(k.oc.BRep_Tool.Surface(k.oc.TopoDS.Face(map.FindKey(i + 1)))).ConvertToAnalytical(tol);
        expect(!found || found.isNull(), `f${i}: OCCT reads it on its own`).toBe(true);
        map.delete();
        const read = kernel.analyticFace(shape, i, tol);
        console.log(`MT17203 f${i}: τ ${tau[i]?.toExponential(1)} → ${read?.geometry.type} ${read?.geometry.type === 'cone' ? deg(read.geometry.halfAngle).toFixed(6) + '°' : ''} deviation ${read?.deviation.toExponential(2)}`);
        expect(read?.geometry.type, `f${i}`).toBe('cone');
        const g = read!.geometry as Extract<SurfaceGeometry, { type: 'cone' }>;
        expect(read!.deviation, `f${i} deviation ≤ the file's gap`).toBeLessThanOrEqual(tol);
        // the face's own edges lie on the cone read, to within the file's gap
        expect(Math.max(...edgePoints(shape, i).map((p) => offCone(g, p))), `f${i} edges`).toBeLessThanOrEqual(tol);
        // probe c13f (three-point circles through the rails at the face's bounds, 0.7972 mm apart): 49.8496°, printed to 4 decimals. The surface itself
        // is a cone only to the deviation measured, which leaves its angle open by about 2 · deviation / height.
        const open = (5e-5 * Math.PI) / 180 + (2 * read!.deviation) / 0.7972;
        expect(Math.abs(g.halfAngle - (49.8496 * Math.PI) / 180), `f${i} half-angle`).toBeLessThan(open);
      }
    } finally {
      kernel.release(shape);
    }
  }, 120_000);

  it('E13 faces 71, 73, 74, 75: ruled between coaxial arcs, but twisted 0.5° — refused at the file\'s gap, the cone of the design read at 1e-4', () => {
    const shape = kernel.importStep(new Uint8Array(readFileSync(join(dir!, 'E13-999-421.STEP')))).shape;
    // the design: r 4.25 at x −39.55 to r 3.675 at x −1.8, on the x axis
    const half = Math.atan((4.25 - 3.675) / 37.75);
    const designR = (x: number) => 3.675 + (-1.8 - x) * Math.tan(half);
    try {
      const tau = kernel.fileTolerance(shape).faces;
      for (const i of [71, 73, 74, 75]) {
        // The truth from the design and the end rulings, not from the code under test: the surface is degree 1 across, so its rulings at the ends of the
        // face's parameter box are straight lines, and their ends sit at angles 0.5° apart about the axis (±2.473° on the wide rail, ±2.975° on the
        // narrow). Such a line passes inside the design cone; its middle is off it by the sag below. (Not the B-rep vertices: they sit up to 6.6e-4 off
        // the surface, at ±2.370°, within their own tolerance, and the long edges are 1.9e-5 off straight; probe c13o.)
        const vs = uvCorners(shape, i);
        expect(vs.length).toBe(4);
        const [wide, narrow] = [vs.filter((p) => Math.abs(p[0] + 39.55) < 1e-6), vs.filter((p) => Math.abs(p[0] + 1.8) < 1e-6)];
        expect([wide.length, narrow.length]).toEqual([2, 2]);
        const sags = wide.map((w) => {
          const n = narrow.reduce((best, q) => (len(sub(q, w)) < len(sub(best, w)) ? q : best));
          const m: Vec3 = [(w[0] + n[0]) / 2, (w[1] + n[1]) / 2, (w[2] + n[2]) / 2];
          return (designR(m[0]) - Math.hypot(m[1], m[2])) * Math.cos(half);
        });
        const sag = Math.max(...sags);
        const tol = Math.max(1e-6, tau[i] ?? 0);
        // the premise of the refusal: the face misses its design cone by more than the tolerance asked
        expect(sag).toBeGreaterThan(10 * tol);
        expect(kernel.analyticFace(shape, i, tol), `f${i} at ${tol}`).toBeNull();
        const read = kernel.analyticFace(shape, i, 1e-4);
        console.log(`E13 f${i}: τ ${tau[i]?.toExponential(1)}; ruling sag ${sag.toExponential(2)}; at 1e-4 → ${read?.geometry.type} ${read?.geometry.type === 'cone' ? deg(read.geometry.halfAngle).toFixed(6) + '°' : ''} deviation ${read?.deviation.toExponential(2)}`);
        expect(read?.geometry.type, `f${i} at 1e-4`).toBe('cone');
        const g = read!.geometry as Extract<SurfaceGeometry, { type: 'cone' }>;
        expect(Math.abs(g.halfAngle - half), `f${i} half-angle`).toBeLessThan(1e-6);
        expect(Math.abs(Math.abs(g.axis[0]) - 1)).toBeLessThan(1e-9);
        expect(Math.abs(g.apex[0] - (-1.8 + 3.675 / Math.tan(half)))).toBeLessThan(1e-3);
        expect(Math.hypot(g.apex[1], g.apex[2])).toBeLessThan(1e-5);
        // the deviation reported is that sag: the cone read is the design's (above), and the 13 rows across the face pass the middle of each ruling
        expect(Math.abs(read!.deviation / sag - 1)).toBeLessThan(0.02);
      }
    } finally {
      kernel.release(shape);
    }
  }, 120_000);

  it('E13 f71 at 1e-3, where OCCT proposes a cylinder on a tilted axis: read as the cone, never that cylinder', () => {
    const shape = kernel.importStep(new Uint8Array(readFileSync(join(dir!, 'E13-999-421.STEP')))).shape;
    try {
      const k = kernel as any;
      const oc = k.oc;
      const map = new oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher();
      oc.TopExp.MapShapes(k.get(shape), oc.TopAbs_ShapeEnum.TopAbs_FACE, map);
      const found = new oc.GeomConvert_SurfToAnaSurf(oc.BRep_Tool.Surface(oc.TopoDS.Face(map.FindKey(72)))).ConvertToAnalytical(1e-3);
      // the premise: OCCT's answer at this tolerance is a cylinder
      expect(String(new oc.GeomAdaptor_Surface(found).GetType())).toContain('Cylinder');
      map.delete();
      for (const tol of [1e-4, 1e-3]) expect(kernel.analyticFace(shape, 71, tol)?.geometry.type, `tol ${tol}`).toBe('cone');
    } finally {
      kernel.release(shape);
    }
  }, 120_000);
});

describe('the rails (fitArc, coaxialRails)', () => {
  const arc = (c: Vec3, r: number, a0: number, a1: number, z = 0, n = 25): Vec3[] =>
    Array.from({ length: n }, (_, i) => {
      const a = a0 + ((a1 - a0) * i) / (n - 1);
      return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a), c[2] + z];
    });

  it('a narrow arc: centre and radius from all its points, to 1e-9 where three of them miss by more', () => {
    for (const span of [1, 5, 10]) {
      const s = (span * Math.PI) / 180;
      const pts = arc([3, -2, 7], 4.25, 1.1, 1.1 + s);
      const f = fitArc(pts)!;
      expect(Math.abs(f.radius - 4.25)).toBeLessThan(1e-9);
      expect(len(sub(f.centre, [3, -2, 7]))).toBeLessThan(1e-9);
      expect(f.residual).toBeLessThan(1e-12);
      expect(f.flat).toBeLessThan(1e-12);
      expect(Math.abs(Math.abs(f.normal[2]) - 1)).toBeLessThan(1e-12);
    }
  });

  it('a full circle (first point = last) is no special case', () => {
    const f = fitArc(arc([0, 0, 0], 2, 0, 2 * Math.PI))!;
    expect(Math.abs(f.radius - 2)).toBeLessThan(1e-12);
    expect(len(f.centre)).toBeLessThan(1e-12);
  });

  it('points on a line are no arc', () => {
    expect(fitArc(Array.from({ length: 9 }, (_, i) => [i, 2 * i, 0] as Vec3))).toBeNull();
    expect(fitArc([[0, 0, 0], [1, 1, 1], [2, 2, 2]])).toBeNull();
  });

  it('every refusal, each from a pair of rails made to fail that gate alone', () => {
    const s = (5 * Math.PI) / 180;
    const a = arc([0, 0, 0], 4, 0.3, 0.3 + s);
    const tol = 1e-6;
    expect(coaxialRails(a, arc([0, 0, 0], 3.5, 0.3, 0.3 + s, 10), tol).ok).toBe(true);
    const reason = (b: Vec3[]) => {
      const r = coaxialRails(a, b, tol);
      return r.ok ? 'ok' : r.reason;
    };
    expect(reason(arc([1e-2, 0, 0], 3.5, 0.3, 0.3 + s, 10))).toBe('not-coaxial');
    expect(reason(arc([0, 0, 0], 3.5, 0.3, 0.3 + s, 0))).toBe('one-plane');
    // the second rail turned 0.01° about the x axis through its centre: no longer parallel
    const tilt = (1e-2 * Math.PI) / 180;
    expect(reason(arc([0, 0, 0], 3.5, 0.3, 0.3 + s, 10).map(([x, y, z]) => [x, y * Math.cos(tilt) - (z - 10) * Math.sin(tilt), 10 + y * Math.sin(tilt) + (z - 10) * Math.cos(tilt)] as Vec3))).toBe('planes-not-parallel');
    // an ellipse: x stretched by 1.5 about the centre
    expect(reason(arc([0, 0, 0], 3.5, 0.3, 0.3 + 4 * s, 10).map(([x, y, z]) => [1.5 * x, y, z] as Vec3))).toBe('not-a-circle');
    // a bow of 1e-7 over a radius of 1e5: within tol of a straight line, no radius to speak of
    expect(reason(arc([0, 0, 0], 1e5, 0, 2e-6, 10))).toBe('straight');
    expect(reason(arc([0, 0, 0], 3.5, 0.3, 0.3 + s, 10).map(([x, y, z], i) => [x, y, z + (i % 2) * 1e-5] as Vec3))).toBe('not-flat');
    expect(reason([[0, 0, 10], [1, 0, 10], [2, 0, 10], [3, 0, 10], [4, 0, 10]])).toBe('not-an-arc');
  });
});

describe('a cone strip is never returned as a cylinder', () => {
  it('E13 f71 made from its definition (0.8727°, rails ±2.473° and ±2.975°): OCCT proposes a cylinder at 1e-3; the cone is read wherever the face is within tol of it', async () => {
    const { stripFace } = await import('./analytic-face-strip.kit');
    const made = stripFace(kernel, { r0: 4.25, half: -Math.atan(0.575 / 37.75), height: 37.75, span: (4.946 * Math.PI) / 180, degree: 3, widen: 2.975 / 2.473 });
    try {
      // the premise of the guard: OCCT on its own proposes the wrong type
      expect(made.occt(1e-3)).toBe('cylinder');
      // below the sag of its rulings (3.78e-5, as the real face) no surface is read; above it, up to the bow of its arcs (4e-3), the cone
      for (const tol of [1e-6, 1e-5]) expect(kernel.analyticFace(made.shape, 0, tol), `tol ${tol}`).toBeNull();
      for (const tol of [1e-4, 1e-3, 2e-3]) {
        const read = kernel.analyticFace(made.shape, 0, tol);
        expect(read?.geometry.type, `tol ${tol} (OCCT: ${made.occt(tol)})`).toBe('cone');
        expect(read!.deviation).toBeGreaterThan(3.7e-5);
        expect(read!.deviation).toBeLessThan(3.9e-5);
      }
    } finally {
      made.release();
    }
  });
});

describe('the rails decide, not a surface that only fits the face', () => {
  it('a fanned 2.7° strip of a cylinder of radius 70.72 (fuzz seed 89): OCCT proposes radius 70.67, within tol of the face; the radius of the rails is read', async () => {
    const { stripFace } = await import('./analytic-face-strip.kit');
    const spec = { r0: 70.72012803783211, half: 0, height: 15.14630833209958, span: 0.04667822613459162, start: 4.670045289102841, degree: 2 as const, widen: 1.0710248198197223 };
    const made = stripFace(kernel, spec);
    try {
      // the premise: OCCT's own cylinder is another one, by more than 1e-2 in radius
      const occt = made.occtCylinderRadius(1e-4);
      expect(occt).not.toBeNull();
      expect(Math.abs(occt! - spec.r0)).toBeGreaterThan(1e-2);
      const read = kernel.analyticFace(made.shape, 0, 1e-4);
      expect(read?.geometry.type).toBe('cylinder');
      const g = read!.geometry as Extract<SurfaceGeometry, { type: 'cylinder' }>;
      expect(Math.abs(g.radius - spec.r0)).toBeLessThan(1e-8);
      expect(Math.hypot(g.origin[0], g.origin[1])).toBeLessThan(1e-8);
      expect(Math.abs(Math.abs(g.axis[2]) - 1)).toBeLessThan(1e-12);
      expect(read!.deviation).toBeLessThanOrEqual(1e-4);
    } finally {
      made.release();
    }
  });
});

describe('analyticFace with the strip reading leaves nothing behind', () => {
  it('liveShapes equal across repeated calls', async () => {
    const { stripFace } = await import('./analytic-face-strip.kit');
    const made = stripFace(kernel, { r0: 4.25, half: (0.8727 * Math.PI) / 180, height: 37.75, span: (5 * Math.PI) / 180, degree: 3 });
    try {
      expect(kernel.analyticFace(made.shape, 0, 1e-6)?.geometry.type).toBe('cone');
      const live = kernel.liveShapes;
      for (let i = 0; i < 50; i++) kernel.analyticFace(made.shape, 0, 1e-6);
      expect(kernel.liveShapes).toBe(live);
    } finally {
      made.release();
    }
  });
});
