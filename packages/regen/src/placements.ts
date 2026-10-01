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
