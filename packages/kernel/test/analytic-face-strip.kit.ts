/**
 * ADR 0258 test kit: a lone face whose surface is an exact rational B-spline strip between two circle arcs — a cone strip, or a cylinder strip when
 * `half` is 0 — made from its definition, not by any code under test. Each arc is the rational quadratic of the circle (end poles on it, the middle pole
 * where the end tangents meet, weight cos(span/2)), so the strip IS the surface, not an approximation; the arc direction can be raised to degree 3 and
 * given knots, and the two directions exchanged, the way files store it. `widen` makes the second arc span more about the same middle, as both real files
 * do (E13 f71: ±2.975° against ±2.473°): the rulings fan, and the strip is off its cone by the sag of the end rulings — a near cone, not an exact one.
 * The near misses move the second rail: off the axis (`offset`), out of parallel
 * (`tilt`), turned about the axis (`twist`: a hyperboloid's strip), or both rails stretched across the axis (`ellipse`: an elliptic cone's strip).
 */
import type { Kernel, ShapeId, Vec3 } from '../src';

export interface StripSpec {
  /** Radius of the first rail. */
  r0: number;
  /** The cone's half-angle (rad), signed: + the radius grows from the first rail to the second. 0: a cylinder. */
  half: number;
  /** How far apart the rails' planes are. */
  height: number;
  /** The arcs' angle (rad). */
  span: number;
  /** Where the arcs start (rad), about the local x axis. */
  start?: number;
  /** 2: the conic as it is; 3: raised (as E13 stores it). */
  degree?: 2 | 3;
  /** Knots inserted along the arcs (equally spaced). */
  knots?: number;
  /** The ruled direction is u, not v. */
  swap?: boolean;
  /** Where the strip is: its axis through `origin` along `axis`, the arcs' angle 0 toward `ref`. */
  frame?: { origin: Vec3; axis: Vec3; ref: Vec3 };
  /** The second arc's span over the first's (1: an exact strip). */
  widen?: number;
  /** Near misses (on the second rail, in its plane's local terms). */
  offset?: [number, number];
  tilt?: number;
  twist?: number;
  ellipse?: number;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => mul(a, 1 / Math.hypot(...a));

/** The local frame (axis = z) of `spec`, as a map to world points. */
function framer(spec: StripSpec): (p: Vec3) => Vec3 {
  const f = spec.frame ?? { origin: [0, 0, 0], axis: [0, 0, 1], ref: [1, 0, 0] };
  const z = unit(f.axis);
  const x = unit(sub(f.ref, mul(z, dot(f.ref, z))));
  const y = cross(z, x);
  return ([a, b, c]) => [f.origin[0] + a * x[0] + b * y[0] + c * z[0], f.origin[1] + a * x[1] + b * y[1] + c * z[1], f.origin[2] + a * x[2] + b * y[2] + c * z[2]];
}

/** The rails' poles and weights in local terms: [rail][pole] (3 poles a rail), the second rail widened and moved by the near misses. */
export function railPoles(spec: StripSpec): { poles: Vec3[][]; weights: number[][] } {
  const a0 = spec.start ?? 0;
  const s = spec.span;
  const conic = (r: number, z: number, sb = s): Vec3[] => {
    const [lo, w] = [a0 + (s - sb) / 2, Math.cos(sb / 2)];
    return [
      [r * Math.cos(lo), r * Math.sin(lo), z],
      [(r / w) * Math.cos(lo + sb / 2), (r / w) * Math.sin(lo + sb / 2), z],
      [r * Math.cos(lo + sb), r * Math.sin(lo + sb), z],
    ];
  };
  const r1 = spec.r0 + spec.height * Math.tan(spec.half);
  const sb = s * (spec.widen ?? 1);
  let b = conic(r1, spec.height, sb);
  let a = conic(spec.r0, 0);
  if (spec.twist) b = b.map(([x, y, z]) => [x * Math.cos(spec.twist!) - y * Math.sin(spec.twist!), x * Math.sin(spec.twist!) + y * Math.cos(spec.twist!), z]);
  if (spec.tilt) {
    // about the local x axis through the rail's centre
    const t = spec.tilt;
    b = b.map(([x, y, z]) => [x, y * Math.cos(t) - (z - spec.height) * Math.sin(t), spec.height + y * Math.sin(t) + (z - spec.height) * Math.cos(t)]);
  }
  if (spec.offset) b = b.map(([x, y, z]) => [x + spec.offset![0], y + spec.offset![1], z]);
  if (spec.ellipse) {
    // stretched across the axis at 45° to the arcs' middle (an affine map, so each conic is an exact ellipse arc): along a principal direction the
    // middle would sit on the ellipse's vertex, where a narrow arc is closest to a circle
    const m: Vec3 = [Math.cos(a0 + s / 2 + Math.PI / 4), Math.sin(a0 + s / 2 + Math.PI / 4), 0];
    const stretch = (p: Vec3): Vec3 => {
      const k = dot(p, m) * (spec.ellipse! - 1);
      return [p[0] + m[0] * k, p[1] + m[1] * k, p[2]];
    };
    a = a.map(stretch);
    b = b.map(stretch);
  }
  return { poles: [a, b], weights: [[1, Math.cos(s / 2), 1], [1, Math.cos(sb / 2), 1]] };
}

export interface MadeStrip {
  shape: ShapeId;
  /** What OCCT's GeomConvert_SurfToAnaSurf alone proposes for the surface at `tol`: its type ('cylinder', 'cone', …) or null. */
  occt(tol: number): string | null;
  /** The radius of the cylinder OCCT on its own proposes at `tol`, or null when it proposes none. */
  occtCylinderRadius(tol: number): number | null;
  release(): void;
}

/** A face (`shape`, face 0) on the strip of `spec`. */
export function stripFace(kernel: Kernel, spec: StripSpec): MadeStrip {
  const k = kernel as any;
  const oc = k.oc;
  const place = framer(spec);
  const { poles, weights } = railPoles(spec);
  const keep: any[] = [];
  const own = <T>(x: T): T => (keep.push(x), x);
  // u along the arcs (3 poles), v across (the 2 rails)
  const P = own(new oc.NCollection_Array2_gp_Pnt(1, 3, 1, 2));
  const W = own(new oc.NCollection_Array2_double(1, 3, 1, 2));
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 2; j++) {
      const [x, y, z] = place(poles[j]![i]!);
      P.SetValue(i + 1, j + 1, own(new oc.gp_Pnt(x, y, z)));
      W.SetValue(i + 1, j + 1, weights[j]![i]!);
    }
  }
  const UK = own(new oc.NCollection_Array1_double(1, 2));
  const UM = own(new oc.NCollection_Array1_int(1, 2));
  const VK = own(new oc.NCollection_Array1_double(1, 2));
  const VM = own(new oc.NCollection_Array1_int(1, 2));
  UK.SetValue(1, 0);
  UK.SetValue(2, 1);
  UM.SetValue(1, 3);
  UM.SetValue(2, 3);
  VK.SetValue(1, 0);
  VK.SetValue(2, 1);
  VM.SetValue(1, 2);
  VM.SetValue(2, 2);
  const surf = new oc.Geom_BSplineSurface(P, W, UK, VK, UM, VM, 2, 1, false, false);
  if (spec.degree === 3) surf.IncreaseDegree(3, 1);
  for (let i = 1; i <= (spec.knots ?? 0); i++) surf.InsertUKnot(i / ((spec.knots ?? 0) + 1), 1, 1e-12, true);
  if (spec.swap) surf.ExchangeUV();
  const make = own(new oc.BRepBuilderAPI_MakeFace(surf, 1e-7));
  if (!make.IsDone()) throw new Error('the strip face was not made');
  const face = make.Face();
  const shape = k.put(face) as ShapeId;
  for (const x of keep) x.delete();
  return {
    shape,
    occt(tol: number) {
      const conv = new oc.GeomConvert_SurfToAnaSurf(surf);
      try {
        const found = conv.ConvertToAnalytical(tol);
        if (!found || found.isNull()) return null;
        const ga = new oc.GeomAdaptor_Surface(found);
        const type = String(ga.GetType()).replace('GeomAbs_', '').toLowerCase();
        ga.delete();
        found.delete();
        return type;
      } finally {
        conv.delete();
      }
    },
    occtCylinderRadius(tol: number) {
      const conv = new oc.GeomConvert_SurfToAnaSurf(surf);
      try {
        const found = conv.ConvertToAnalytical(tol);
        if (!found || found.isNull()) return null;
        const ga = new oc.GeomAdaptor_Surface(found);
        const radius = String(ga.GetType()).includes('Cylinder') ? ga.Cylinder().Radius() : null;
        ga.delete();
        found.delete();
        return radius;
      } finally {
        conv.delete();
      }
    },
    release() {
      kernel.release(shape);
      surf.delete();
    },
  };
}
