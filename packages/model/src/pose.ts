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

/** `inner` placed in the frame of `outer`, as one pose: `outer ∘ inner` (a part in a sub-assembly, the sub-assembly in its assembly). */
export function composePose(outer: Pose, inner: Pose): Pose {
  return { position: transformPoint(outer, inner.position), rotation: composeRotations(outer.rotation, inner.rotation) };
}

/** The rotation of a pose as a row-major 3 × 3 matrix. */
export function rotationRows([x, y, z, w]: Quat): number[] {
  return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
}

/** The unit quaternion (w ≥ 0) of a row-major 3 × 3 rotation matrix (determinant +1). */
export function quatFromRows(m: readonly number[]): Quat {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m as [number, number, number, number, number, number, number, number, number];
  const trace = m00 + m11 + m22;
  let q: Quat;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s];
  }
  const n = Math.hypot(...q);
  const sign = q[3] < 0 ? -1 : 1;
  return [(q[0] * sign) / n, (q[1] * sign) / n, (q[2] * sign) / n, (q[3] * sign) / n];
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

/** The pose a fraction `t` of the way from `a` to `b`: the positions blended, the rotations by normalized linear interpolation along the shorter way (small steps, as a drag takes). */
export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const flip = a.rotation[0] * b.rotation[0] + a.rotation[1] * b.rotation[1] + a.rotation[2] * b.rotation[2] + a.rotation[3] * b.rotation[3] < 0 ? -1 : 1;
  const q = [0, 1, 2, 3].map((k) => a.rotation[k]! * (1 - t) + flip * b.rotation[k]! * t);
  const n = Math.hypot(q[0]!, q[1]!, q[2]!, q[3]!) || 1;
  return { position: [0, 1, 2].map((k) => a.position[k]! * (1 - t) + b.position[k]! * t) as Vec3, rotation: [q[0]! / n, q[1]! / n, q[2]! / n, q[3]! / n] };
}

