import type { Quat, Vec3 } from '@3db/model';

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: Vec3): Vec3 => scale(a, 1 / (norm(a) || 1));
/** The part of `v` across the unit direction `d`. */
export const across = (v: Vec3, d: Vec3): Vec3 => sub(v, scale(d, dot(v, d)));

export function qmul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}

export const conjugate = ([x, y, z, w]: Quat): Quat => [-x, -y, -z, w];

export function qnormalize(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  // One sign for one rotation (w ≥ 0), so equal rotations compare equal.
  const s = q[3] < 0 ? -1 / n : 1 / n;
  return [q[0] * s, q[1] * s, q[2] * s, q[3] * s];
}

/** `v` turned by the unit quaternion `q`. */
export function rotate(q: Quat, v: Vec3): Vec3 {
  const u: Vec3 = [q[0], q[1], q[2]];
  const t = scale(cross(u, v), 2);
  return add(add(v, scale(t, q[3])), cross(u, t));
}

/** The rotation by the rotation vector `w` (axis × angle in radians). */
export function expRotation(w: Vec3): Quat {
  const angle = norm(w);
  if (angle < 1e-12) return qnormalize([w[0] / 2, w[1] / 2, w[2] / 2, 1]);
  const s = Math.sin(angle / 2) / angle;
  return [w[0] * s, w[1] * s, w[2] * s, Math.cos(angle / 2)];
}
