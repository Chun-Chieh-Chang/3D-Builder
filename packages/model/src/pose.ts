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
