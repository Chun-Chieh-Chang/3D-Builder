import type { Vec3 } from '@3db/model';

/**
 * Where the instances of a pattern go (C6.1, C6.2): a motion of space as the 3 × 4 matrix `Kernel.transformed` takes, in rows
 * (a11 a12 a13 a14, a21 …, a31 …): its 3 × 3 part, then the slide.
 */
export type Motion = number[];

/** A slide by `v`. */
export const slide = (v: Vec3): Motion => [1, 0, 0, v[0], 0, 1, 0, v[1], 0, 0, 1, v[2]];

/** A turn of `angle` (radians, the right-hand way about `dir`) about the line through `point` along `dir` (a unit vector). */
export function turn(point: Vec3, dir: Vec3, angle: number): Motion {
  const [x, y, z] = dir;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const k = 1 - c;
  // Rodrigues: R = c·I + s·[d]× + (1 − c)·d dᵀ
  const r = [
    [c + x * x * k, x * y * k - z * s, x * z * k + y * s],
    [y * x * k + z * s, c + y * y * k, y * z * k - x * s],
    [z * x * k - y * s, z * y * k + x * s, c + z * z * k],
  ];
  // the point stays where it is: t = p − R p
  const t = r.map((row, i) => point[i]! - (row[0]! * point[0] + row[1]! * point[1] + row[2]! * point[2]));
  return [...r[0]!, t[0]!, ...r[1]!, t[1]!, ...r[2]!, t[2]!];
}

/** Reflection across the plane through `point` with unit `normal`: x′ = x − 2 (n·(x − p)) n (C6.3). */
export function mirror(point: Vec3, normal: Vec3): Motion {
  const [x, y, z] = normal;
  const d = 2 * (x * point[0] + y * point[1] + z * point[2]);
  return [1 - 2 * x * x, -2 * x * y, -2 * x * z, d * x, -2 * y * x, 1 - 2 * y * y, -2 * y * z, d * y, -2 * z * x, -2 * z * y, 1 - 2 * z * z, d * z];
}

/** The angle between neighbours of a circular pattern. With `equal`, `angle` is the sweep they share (a whole turn leaves the last one a step short of the seed). */
export function angleStep(count: number, angle: number, equal: boolean): number {
  if (!equal) return angle;
  return angle >= 2 * Math.PI - 1e-9 ? angle / count : angle / (count - 1);
}

/** The motion that puts a coordinate system's axes on the part's (its origin at 0, its X, Y, Z along x, y, z): what a file written "in" that system is moved by (C3.4). */
export function intoFrame(system: { origin: Vec3; x: Vec3; y: Vec3; z: Vec3 }): Motion {
  const { origin: o, x, y, z } = system;
  const row = (a: Vec3) => [a[0], a[1], a[2], -(a[0] * o[0] + a[1] * o[1] + a[2] * o[2])];
  return [...row(x), ...row(y), ...row(z)];
}

/**
 * Motion that maps seed instance at `p0` with tangent `t0` to target instance at `pk` with tangent `tk` (C6.4, ADR 0166).
 * With 'parallel', the instance is translated by pk - p0 without rotation.
 * With 'tangent', the instance is rotated by the angle between t0 and tk about their normal, with pivot at p0, then translated to pk.
 */
export function curveMotion(
  p0: Vec3,
  t0: Vec3,
  pk: Vec3,
  tk: Vec3,
  alignment: 'tangent' | 'parallel' = 'tangent',
): Motion {
  if (alignment === 'parallel') {
    return slide([pk[0] - p0[0], pk[1] - p0[1], pk[2] - p0[2]]);
  }

  const dt = t0[0] * tk[0] + t0[1] * tk[1] + t0[2] * tk[2];
  const c = Math.max(-1, Math.min(1, dt));
  const cx = t0[1] * tk[2] - t0[2] * tk[1];
  const cy = t0[2] * tk[0] - t0[0] * tk[2];
  const cz = t0[0] * tk[1] - t0[1] * tk[0];
  const crossLen = Math.hypot(cx, cy, cz);

  let r: number[][];
  if (crossLen > 1e-7) {
    const x = cx / crossLen;
    const y = cy / crossLen;
    const z = cz / crossLen;
    const angle = Math.acos(c);
    const s = Math.sin(angle);
    const k = 1 - c;
    r = [
      [c + x * x * k, x * y * k - z * s, x * z * k + y * s],
      [y * x * k + z * s, c + y * y * k, y * z * k - x * s],
      [z * x * k - y * s, z * y * k + x * s, c + z * z * k],
    ];
  } else if (c < 0) {
    const perp0 = Math.abs(t0[0]) < 0.9 ? 1 : 0;
    const perp1 = Math.abs(t0[0]) < 0.9 ? 0 : 1;
    const perp2 = 0;
    const ux = t0[1] * perp2 - t0[2] * perp1;
    const uy = t0[2] * perp0 - t0[0] * perp2;
    const uz = t0[0] * perp1 - t0[1] * perp0;
    const uLen = Math.hypot(ux, uy, uz);
    const x = ux / uLen;
    const y = uy / uLen;
    const z = uz / uLen;
    r = [
      [-1 + 2 * x * x, 2 * x * y, 2 * x * z],
      [2 * y * x, -1 + 2 * y * y, 2 * y * z],
      [2 * z * x, 2 * z * y, -1 + 2 * z * z],
    ];
  } else {
    r = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
  }

  // Target translation: point p0 must go to pk: pk = R * p0 + t  =>  t = pk - R * p0
  const Rp0 = [
    r[0]![0]! * p0[0] + r[0]![1]! * p0[1] + r[0]![2]! * p0[2],
    r[1]![0]! * p0[0] + r[1]![1]! * p0[1] + r[1]![2]! * p0[2],
    r[2]![0]! * p0[0] + r[2]![1]! * p0[1] + r[2]![2]! * p0[2],
  ];
  const t = [pk[0] - Rp0[0]!, pk[1] - Rp0[1]!, pk[2] - Rp0[2]!];

  return [
    r[0]![0]!, r[0]![1]!, r[0]![2]!, t[0]!,
    r[1]![0]!, r[1]![1]!, r[1]![2]!, t[1]!,
    r[2]![0]!, r[2]![1]!, r[2]![2]!, t[2]!,
  ];
}

