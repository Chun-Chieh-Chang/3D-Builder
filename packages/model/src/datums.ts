import type { DatumPlaneName, Vec3 } from './schema';

/** Orthonormal frame of a sketch plane: sketch (x, y) maps to origin + x·xDir + y·yDir. */
export interface PlaneFrame {
  origin: Vec3;
  xDir: Vec3;
  yDir: Vec3;
  normal: Vec3;
}

/**
 * The three default planes (C3.1), oriented like SolidWorks (Y up):
 * Front = XY (+Z normal), Top = XZ (+Y normal, sketch y → −Z), Right = YZ (+X normal, sketch x → −Z).
 */
export const DATUM_PLANES: Record<DatumPlaneName, PlaneFrame> = {
  'plane:front': { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] },
  'plane:top': { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 0, -1], normal: [0, 1, 0] },
  'plane:right': { origin: [0, 0, 0], xDir: [0, 0, -1], yDir: [0, 1, 0], normal: [1, 0, 0] },
};

export function isDatumPlaneName(name: string): name is DatumPlaneName {
  return name in DATUM_PLANES;
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const reject = (a: Vec3, n: Vec3): Vec3 => {
  const d = dot(a, n);
  return unit([a[0] - d * n[0], a[1] - d * n[1], a[2] - d * n[2]]);
};

/**
 * Sketch frame on a plane through `point` with outward `normal` (sketching on a model face, C1.1).
 * The origin is where the part origin projects onto the plane; the axes follow the default planes:
 * on a non-horizontal plane y is "up" (world +Y projected), on a horizontal one x is world +X.
 * A plane parallel to Front, Top or Right therefore gets exactly that plane's axes, and the frame
 * depends only on the plane, so it stays put when upstream dimensions change.
 */
export function planeFrame(point: Vec3, normal: Vec3): PlaneFrame {
  const n = unit(normal);
  const d = dot(point, n);
  const origin: Vec3 = [n[0] * d, n[1] * d, n[2] * d];
  if (Math.abs(n[1]) < 0.9) {
    const yDir = reject([0, 1, 0], n);
    return { origin, xDir: cross(yDir, n), yDir, normal: n };
  }
  const xDir = reject([1, 0, 0], n);
  return { origin, xDir, yDir: cross(n, xDir), normal: n };
}
