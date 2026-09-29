import type { Pose, Quat, Vec3 } from './schema';

/** Axes aligned with the assembly's, as SolidWorks inserts a component. */
export const IDENTITY_ROTATION: Quat = [0, 0, 0, 1];

/** Finite numbers, and a rotation that is a unit quaternion. */
export function isValidPose(pose: Pose): boolean {
  const { position, rotation } = pose;
  if (!Array.isArray(position) || !Array.isArray(rotation) || position.length !== 3 || rotation.length !== 4) return false;
  if (![...position, ...rotation].every(Number.isFinite)) return false;
  return Math.abs(Math.hypot(...rotation) - 1) < 1e-9;
}

/**
 * The pose as a 4×4 matrix in column-major order (three.js, OpenGL): it maps part coordinates to
 * assembly coordinates.
 */
export function poseMatrix({ position: [tx, ty, tz], rotation: [x, y, z, w] }: Pose): number[] {
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
    2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
    2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0,
    tx, ty, tz, 1,
  ];
}

/** A point of the part, in assembly coordinates. */
export function transformPoint(pose: Pose, [px, py, pz]: Vec3): Vec3 {
  const m = poseMatrix(pose);
  return [m[0]! * px + m[4]! * py + m[8]! * pz + m[12]!, m[1]! * px + m[5]! * py + m[9]! * pz + m[13]!, m[2]! * px + m[6]! * py + m[10]! * pz + m[14]!];
}

/** Rotation by `angle` (radians) about the unit axis `axis`. */
export function axisAngle([ax, ay, az]: Vec3, angle: number): Quat {
  const s = Math.sin(angle / 2);
  return [ax * s, ay * s, az * s, Math.cos(angle / 2)];
}

/** b's pose seen from a: what a lock mate keeps (a ∘ result = b). */
export function relativePose(a: Pose, b: Pose): Pose {
  const [x, y, z, w] = a.rotation;
  const inv: Quat = [-x, -y, -z, w];
  const d: Vec3 = [b.position[0] - a.position[0], b.position[1] - a.position[1], b.position[2] - a.position[2]];
  const rotation = mul(inv, b.rotation);
  return { position: turn(inv, d), rotation: rotation[3] < 0 ? [-rotation[0], -rotation[1], -rotation[2], -rotation[3]] : rotation };
}

/** `rotation`, then `turn` (both about the assembly's axes), as one unit quaternion. */
export function composeRotations(turn: Quat, rotation: Quat): Quat {
  const q = mul(turn, rotation);
  const n = Math.hypot(...q);
  const s = q[3] < 0 ? -1 / n : 1 / n; // one sign for one rotation
  return [q[0] * s, q[1] * s, q[2] * s, q[3] * s];
}

/** A point in assembly coordinates, in the part's coordinates: the inverse of transformPoint. */
export function toPartPoint(pose: Pose, p: Vec3): Vec3 {
  return relativePose(pose, { position: p, rotation: IDENTITY_ROTATION }).position;
}

function mul([ax, ay, az, aw]: Quat, [bx, by, bz, bw]: Quat): Quat {
  return [aw * bx + ax * bw + ay * bz - az * by, aw * by - ax * bz + ay * bw + az * bx, aw * bz + ax * by - ay * bx + az * bw, aw * bw - ax * bx - ay * by - az * bz];
}

function turn(q: Quat, v: Vec3): Vec3 {
  return transformPoint({ position: [0, 0, 0], rotation: q }, v);
}
