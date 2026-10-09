import { placePoint, type CoordSystem, type MeasureFrame, type Pose, type Vec3 } from '@3db/model';

const clean = (v: number): number => (Math.abs(v) < 1e-12 ? 0 : Math.round(v * 1e12) / 1e12);
const difference = (a: Vec3, b: Vec3): Vec3 => [clean(a[0] - b[0]), clean(a[1] - b[1]), clean(a[2] - b[2])];

/** A component's datum frame in assembly coordinates, including the x reflection of a mirrored instance. */
export function placeMeasureFrame(system: CoordSystem, pose: Pose, mirrored: boolean): MeasureFrame {
  const origin = placePoint(pose, mirrored, system.origin).map(clean) as Vec3;
  const endpoint = (axis: Vec3): Vec3 => placePoint(pose, mirrored, [system.origin[0] + axis[0], system.origin[1] + axis[1], system.origin[2] + axis[2]]);
  return { origin, axes: [difference(endpoint(system.x), origin), difference(endpoint(system.y), origin), difference(endpoint(system.z), origin)] };
}
