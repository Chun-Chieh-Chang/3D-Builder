import { t } from '@3db/i18n';
import type { MateType, Pose, Vec3 } from '@3db/model';
import { axisOf, centerOf, KIND_LABEL, type GeometryKind, type MateGeometry } from './geometry';
import { across, add, cross, dot, norm, qmul, rotate, scale, sub } from './math';

export type { MateType };

export const MATE_LABEL: Record<MateType, string> = {
  coincident: '重合',
  parallel: '平行',
  perpendicular: '垂直',
  tangent: '相切',
  concentric: '同軸心',
  lock: '鎖住',
  distance: '距離',
  angle: '角度',
  get width() {
    return t('mate.label.width');
  },
  get symmetric() {
    return t('mate.label.symmetric');
  },
};

/** One side of a mate: an element of a component, or of the assembly itself (`body` null: never moves). */
export interface MateEnd {
  body: string | null;
  geom: MateGeometry;
}

export interface MateSpec {
  id: string;
  type: MateType;
  a: MateEnd;
  b: MateEnd;
  /**
   * Whether b's direction (normal or axis) runs with a's (SolidWorks 「同向對齊」) or against it
   * (「反向對齊」). Left out, the one closer to where the components start is taken.
   */
  align?: 'aligned' | 'antiAligned';
  /** Distance in mm, or angle in radians. */
  value?: number;
  /** The distance on the other side of a; the angle measured from b's reversed direction (「反轉尺寸」). */
  flip?: boolean;
  /** Lock: b's pose relative to a's, kept as it was when locked. */
  relative?: Pose;
  /**
   * Further elements (C15.9). Width: [the other width face, on a's component; the other tab face, on b's]. Symmetric: [the plane a and b mirror
   * each other in].
   */
  more?: MateEnd[];
  /** Limits of a distance (mm) or an angle (radians): where the value may be, as a range, instead of a value it must be (C15.9). Either may be left out. */
  min?: number;
  max?: number;
}

/**
 * The equations of one mate between two elements: all zero when it holds. Lengths are in mm; differences of directions
 * are multiplied by the length `L`, so that turning and moving weigh alike.
 */
export type Residual = (a: MateGeometry, b: MateGeometry, pa: Pose, pb: Pose, L: number) => number[];

/** The equations of a mate of any number of elements: their geometry as placed and the poses of their components, in the order a, b, `more`. */
export type ResidualN = (g: readonly MateGeometry[], p: readonly Pose[], L: number) => number[];

type Compiled2 = { residual: Residual } | { unsupported: string };
export type Compiled = { residual: ResidualN } | { unsupported: string };

/** The order pairs are written in: a mate between a point and a plane is the plane–point case. */
const ORDER: GeometryKind[] = ['plane', 'line', 'circle', 'cylinder', 'cone', 'sphere', 'point'];
const ROUND: GeometryKind[] = ['circle', 'cylinder', 'cone'];
const STRAIGHT_AXIS: GeometryKind[] = ['line', 'cylinder', 'cone'];

const EPS = 1e-9;
const side = (g: MateGeometry) => ('convex' in g && !g.convex ? -1 : 1);
const radius = (g: MateGeometry) => ('radius' in g ? g.radius : 0);
/** Direction equations: u = s·v, or only parallel (either way) when s is null. Rank 2 where they hold. */
const directions = (u: Vec3, v: Vec3, s: number | null, L: number): number[] => scale(s === null ? cross(u, v) : sub(u, scale(v, s)), L);
/** Distance between the axes of two round elements that touch: outside each other, or one inside the other. */
const touching = (a: MateGeometry, b: MateGeometry) => (side(a) > 0 && side(b) > 0 ? radius(a) + radius(b) : Math.abs(radius(a) - radius(b)));

function unsupported(type: MateType, a: MateGeometry, b: MateGeometry): Compiled2 {
  return { unsupported: `${MATE_LABEL[type]}不適用於${KIND_LABEL[a.kind]}與${KIND_LABEL[b.kind]}` };
}

/** Which way b's direction must run: as given, or the closer one at the start. */
function alignment(m: MateSpec, u0: Vec3 | null, v0: Vec3 | null): number {
  if (m.align) return m.align === 'aligned' ? 1 : -1;
  return u0 && v0 && dot(u0, v0) < 0 ? -1 : 1;
}

const directionOf = (g: MateGeometry): Vec3 | null => (g.kind === 'plane' ? g.normal : (axisOf(g)?.d ?? null));

/**
 * The equations of a mate between two elements (C15.8, A3.2), or why the pair has none. `a0`, `b0`
 * are the elements where the components start, which settles an alignment the mate leaves open.
 */
export function compileMate(m: MateSpec, starts: readonly MateGeometry[]): Compiled {
  if (m.type === 'width') return width(starts);
  if (m.type === 'symmetric') return symmetric(m, starts);
  const two = compilePair(m, starts[0]!, starts[1]!);
  return 'unsupported' in two ? two : { residual: (g, p, L) => two.residual(g[0]!, g[1]!, p[0]!, p[1]!, L) };
}

function compilePair(m: MateSpec, a0: MateGeometry, b0: MateGeometry): Compiled2 {
  if (m.type === 'lock') return lock(m);
  const swap = ORDER.indexOf(a0.kind) > ORDER.indexOf(b0.kind);
  const [A0, B0] = swap ? [b0, a0] : [a0, b0];
  const s = alignment(m, directionOf(A0), directionOf(B0));
  const inner = equations(m, A0, B0, s);
  if ('unsupported' in inner) return inner;
  return swap ? { residual: (a, b, pa, pb, L) => inner.residual(b, a, pb, pa, L) } : inner;
}

const X: Vec3 = [1, 0, 0];
const Y: Vec3 = [0, 1, 0];

/** Lock (C15.8): b keeps the pose relative to a that it had when it was locked. */
function lock(m: MateSpec): Compiled2 {
  const rel = m.relative;
  if (!rel) return { unsupported: '鎖住結合缺少相對位置' };
  return {
    residual: (_a, _b, pa, pb, L) => {
      const q = qmul(pa.rotation, rel.rotation);
      const t = add(rotate(pa.rotation, rel.position), pa.position);
      return [...sub(pb.position, t), ...scale(sub(rotate(pb.rotation, X), rotate(q, X)), L), ...scale(sub(rotate(pb.rotation, Y), rotate(q, Y)), L)];
    },
  };
}

function equations(m: MateSpec, A: MateGeometry, B: MateGeometry, s: number): Compiled2 {
  const pair = `${A.kind}+${B.kind}`;
  const no = () => unsupported(m.type, A, B);
  const value = m.value ?? 0;
  const sign = m.flip ? -1 : 1;
  switch (m.type) {
    case 'coincident':
      switch (pair) {
        // Coplanar, facing each other unless aligned.
        case 'plane+plane':
          return { residual: (a, b, _pa, _pb, L) => [dot(n(a), sub(o(b), o(a))), ...directions(n(a), n(b), s, L)] };
        case 'plane+line':
          return { residual: (a, b, _pa, _pb, L) => [dot(n(a), sub(o(b), o(a))), L * dot(n(a), d(b))] };
        // The circle lies in the plane.
        case 'plane+circle':
          return { residual: (a, b, _pa, _pb, L) => [dot(n(a), sub(c(b), o(a))), ...directions(n(a), d(b), null, L)] };
        case 'plane+point':
          return { residual: (a, b) => [dot(n(a), sub(c(b), o(a)))] };
        // Collinear.
        case 'line+line':
          return { residual: (a, b, _pa, _pb, L) => [...across(sub(o(b), o(a)), d(a)), ...directions(d(a), d(b), s, L)] };
        case 'line+point':
          return { residual: (a, b) => across(sub(c(b), o(a)), d(a)) };
        // The line lies on the cylinder.
        case 'line+cylinder':
          return { residual: (a, b, _pa, _pb, L) => [...directions(d(a), d(b), null, L), norm(across(sub(o(a), o(b)), d(b))) - radius(b)] };
        case 'cylinder+point':
          return { residual: (a, b) => [norm(across(sub(c(b), o(a)), d(a))) - radius(a)] };
        case 'sphere+point':
          return { residual: (a, b) => [norm(sub(c(b), c(a))) - radius(a)] };
        case 'point+point':
          return { residual: (a, b) => sub(c(a), c(b)) };
      }
      return no();

    case 'concentric': {
      const roundAxis = (g: MateGeometry) => ROUND.includes(g.kind);
      if (axisOf(A) && axisOf(B) && (roundAxis(A) || roundAxis(B))) {
        return { residual: (a, b, _pa, _pb, L) => [...across(sub(o(b), o(a)), d(a)), ...directions(d(a), d(b), s, L)] };
      }
      // A center on an axis: a ball or a point in a hole or on a shaft's axis.
      if (axisOf(A) && centerOf(B) && (roundAxis(A) || B.kind === 'sphere')) return { residual: (a, b) => across(sub(c(b), o(a)), d(a)) };
      if (A.kind === 'sphere' && centerOf(B) && B.kind !== 'circle') return { residual: (a, b) => sub(c(a), c(b)) };
      return no();
    }

    case 'parallel':
      if (pair === 'plane+plane') return { residual: (a, b, _pa, _pb, L) => directions(n(a), n(b), s, L) };
      if (A.kind === 'plane' && STRAIGHT_AXIS.includes(B.kind)) return { residual: (a, b, _pa, _pb, L) => [L * dot(n(a), d(b))] };
      if (STRAIGHT_AXIS.includes(A.kind) && STRAIGHT_AXIS.includes(B.kind)) return { residual: (a, b, _pa, _pb, L) => directions(d(a), d(b), s, L) };
      return no();

    case 'perpendicular':
      if (pair === 'plane+plane') return { residual: (a, b, _pa, _pb, L) => [L * dot(n(a), n(b))] };
      if (A.kind === 'plane' && STRAIGHT_AXIS.includes(B.kind)) return { residual: (a, b, _pa, _pb, L) => directions(n(a), d(b), null, L) };
      if (STRAIGHT_AXIS.includes(A.kind) && STRAIGHT_AXIS.includes(B.kind)) return { residual: (a, b, _pa, _pb, L) => [L * dot(d(a), d(b))] };
      return no();

    case 'tangent':
      switch (pair) {
        // A shaft lying on a face; a hole wrapped around a face's edge would be on the inner side.
        case 'plane+cylinder':
          return { residual: (a, b, _pa, _pb, L) => [L * dot(n(a), d(b)), dot(n(a), sub(o(b), o(a))) - side(b) * radius(b)] };
        case 'plane+sphere':
          return { residual: (a, b) => [dot(n(a), sub(c(b), o(a))) - side(b) * radius(b)] };
        case 'line+cylinder':
          return { residual: (a, b, _pa, _pb, L) => [...directions(d(a), d(b), null, L), norm(across(sub(o(a), o(b)), d(b))) - radius(b)] };
        case 'cylinder+cylinder':
        case 'cylinder+sphere':
        case 'sphere+sphere': {
          const r = touching(A, B);
          if (r < EPS) return { unsupported: `兩個${KIND_LABEL[A.kind]}的半徑相同、一個在另一個之內：請用同軸心` };
          if (pair === 'cylinder+cylinder') return { residual: (a, b, _pa, _pb, L) => [...directions(d(a), d(b), null, L), norm(across(sub(o(b), o(a)), d(a))) - r] };
          if (pair === 'cylinder+sphere') return { residual: (a, b) => [norm(across(sub(c(b), o(a)), d(a))) - r] };
          return { residual: (a, b) => [norm(sub(c(b), c(a))) - r] };
        }
      }
      if (A.kind === 'cone' || B.kind === 'cone') return { unsupported: '圓錐面的相切尚未支援' };
      return no();

    case 'distance': {
      if (!(value >= 0) || !Number.isFinite(value)) return { unsupported: '距離必須是 0 或正數' };
      // With limits (C15.9) the distance is right anywhere between them, and only what is outside counts; the value is then only where it starts.
      const limited = m.min !== undefined || m.max !== undefined;
      const off = (v: number) => v - Math.min(Math.max(v, m.min ?? -Infinity), m.max ?? Infinity);
      const zero = value < EPS && !limited;
      const dist = (alongNormal: number) => (limited ? off(sign * alongNormal) : alongNormal - sign * value);
      const apart = (norm_: number) => (limited ? off(norm_) : norm_ - value);
      const centerLike = (g: MateGeometry) => g.kind === 'point' || g.kind === 'sphere' || g.kind === 'circle';
      if (pair === 'plane+plane') return { residual: (a, b, _pa, _pb, L) => [...directions(n(a), n(b), s, L), dist(dot(n(a), sub(o(b), o(a))))] };
      if (A.kind === 'plane' && STRAIGHT_AXIS.includes(B.kind)) return { residual: (a, b, _pa, _pb, L) => [L * dot(n(a), d(b)), dist(dot(n(a), sub(o(b), o(a))))] };
      if (A.kind === 'plane' && centerLike(B)) return { residual: (a, b) => [dist(dot(n(a), sub(c(b), o(a))))] };
      if (STRAIGHT_AXIS.includes(A.kind) && STRAIGHT_AXIS.includes(B.kind)) {
        return zero
          ? { residual: (a, b, _pa, _pb, L) => [...across(sub(o(b), o(a)), d(a)), ...directions(d(a), d(b), null, L)] }
          : { residual: (a, b, _pa, _pb, L) => [...directions(d(a), d(b), null, L), apart(norm(across(sub(o(b), o(a)), d(a))))] };
      }
      if (STRAIGHT_AXIS.includes(A.kind) && centerLike(B)) {
        return zero ? { residual: (a, b) => across(sub(c(b), o(a)), d(a)) } : { residual: (a, b) => [apart(norm(across(sub(c(b), o(a)), d(a))))] };
      }
      // A circle comes before the axes in ORDER, but plays a center here.
      if (A.kind === 'circle' && STRAIGHT_AXIS.includes(B.kind)) {
        return zero ? { residual: (a, b) => across(sub(c(a), o(b)), d(b)) } : { residual: (a, b) => [apart(norm(across(sub(c(a), o(b)), d(b))))] };
      }
      if (centerLike(A) && centerLike(B)) return zero ? { residual: (a, b) => sub(c(a), c(b)) } : { residual: (a, b) => [apart(norm(sub(c(b), c(a))))] };
      return no();
    }

    case 'angle': {
      if (!(value >= 0 && value <= Math.PI + EPS)) return { unsupported: '角度必須在 0° 到 180° 之間' };
      // With limits (C15.9) the cosine (or, for a line and a plane, the sine) of the angle may be anywhere between those of the limits.
      const limited = m.min !== undefined || m.max !== undefined;
      const between = (x: number, lo: number, hi: number) => x - Math.min(Math.max(x, lo), hi);
      const byCos = (x: number) => (limited ? between(x, m.max !== undefined ? Math.cos(m.max) : -1, m.min !== undefined ? Math.cos(m.min) : 1) : x - Math.cos(value));
      const bySin = (x: number) => (limited ? between(x, m.min !== undefined ? Math.sin(m.min) : -1, m.max !== undefined ? Math.sin(m.max) : 1) : x - Math.sin(value));
      if (pair === 'plane+plane') return { residual: (a, b, _pa, _pb, L) => [L * byCos(sign * dot(n(a), n(b)))] };
      // Between a line and a plane: 90° less the angle to the plane's normal.
      if (A.kind === 'plane' && STRAIGHT_AXIS.includes(B.kind)) return { residual: (a, b, _pa, _pb, L) => [L * bySin(sign * dot(n(a), d(b)))] };
      if (STRAIGHT_AXIS.includes(A.kind) && STRAIGHT_AXIS.includes(B.kind)) return { residual: (a, b, _pa, _pb, L) => [L * byCos(sign * dot(d(a), d(b)))] };
      return no();
    }
  }
  return no();
}

const reflectPoint = (p: Vec3, plane: Extract<MateGeometry, { kind: 'plane' }>): Vec3 => sub(p, scale(plane.normal, 2 * dot(plane.normal, sub(p, plane.origin))));
const reflectDir = (v: Vec3, plane: Extract<MateGeometry, { kind: 'plane' }>): Vec3 => sub(v, scale(plane.normal, 2 * dot(v, plane.normal)));

/**
 * Width (C15.9): the tab (b's two faces, with `more[1]`) is centred between the width faces (a's two faces, with `more[0]`), whose planes it lies
 * parallel to. Ends in the order a (width face), b (tab face), the other width face, the other tab face. Three freedoms stay: along the
 * faces in two ways, and the turn about their normal.
 */
function width(starts: readonly MateGeometry[]): Compiled {
  if (starts.length !== 4 || starts.some((g) => g.kind !== 'plane')) return { unsupported: t('mate.widthPlanes') };
  return {
    residual: (g, _p, L) => {
      const [a1, b1, a2, b2] = g as [MateGeometry, MateGeometry, MateGeometry, MateGeometry];
      const middle = (p: MateGeometry, q: MateGeometry): Vec3 => scale(add(o(p), o(q)), 0.5);
      return [...directions(n(a1), n(b1), null, L), dot(n(a1), sub(middle(b1, b2), middle(a1, a2)))];
    },
  };
}

/**
 * Symmetric (C15.9): b is a's mirror image in the plane `more[0]`: two planes (facing as their mirror images face), two points (or centres), or two
 * lines and axes. The plane is the third end.
 */
function symmetric(m: MateSpec, starts: readonly MateGeometry[]): Compiled {
  const [A0, B0, P0] = starts;
  if (starts.length !== 3 || P0!.kind !== 'plane') return { unsupported: t('mate.symmetricPlane') };
  const both = (f: (g: MateGeometry) => unknown) => !!f(A0!) && !!f(B0!);
  if (A0!.kind === 'plane' && B0!.kind === 'plane') {
    const s = alignment(m, reflectDir(n(A0!), P0 as Extract<MateGeometry, { kind: 'plane' }>), n(B0!));
    return {
      residual: (g, _p, L) => {
        const P = g[2] as Extract<MateGeometry, { kind: 'plane' }>;
        const na = reflectDir(n(g[0]!), P);
        return [dot(na, sub(o(g[1]!), reflectPoint(o(g[0]!), P))), ...directions(na, n(g[1]!), s, L)];
      },
    };
  }
  if (both(centerOf) && !both(axisOf)) {
    return { residual: (g) => sub(c(g[1]!), reflectPoint(c(g[0]!), g[2] as Extract<MateGeometry, { kind: 'plane' }>)) };
  }
  if (both(axisOf)) {
    return {
      residual: (g, _p, L) => {
        const P = g[2] as Extract<MateGeometry, { kind: 'plane' }>;
        const da = reflectDir(d(g[0]!), P);
        return [...across(sub(o(g[1]!), reflectPoint(o(g[0]!), P)), da), ...directions(da, d(g[1]!), null, L)];
      },
    };
  }
  return { unsupported: t('mate.symmetricPair') };
}

// Accessors for the placed elements (the kinds are checked when the mate is compiled).
const n = (g: MateGeometry): Vec3 => (g as Extract<MateGeometry, { kind: 'plane' }>).normal;
const o = (g: MateGeometry): Vec3 => (g.kind === 'plane' ? g.origin : axisOf(g)!.p);
const d = (g: MateGeometry): Vec3 => axisOf(g)!.d;
const c = (g: MateGeometry): Vec3 => centerOf(g)!;
