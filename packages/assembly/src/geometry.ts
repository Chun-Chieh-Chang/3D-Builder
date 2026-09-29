import type { Pose, Vec3 } from '@3db/model';
import { add, rotate } from './math';

/**
 * What a mate uses of a component, in its part's own coordinates (A5.2): the analytic geometry of a
 * face, an edge, a vertex, a plane or the origin. `convex` says on which side the material is: a
 * shaft or a ball (the surface's outward normal points away from its axis or center), or a hole.
 */
export type MateGeometry =
  | { kind: 'plane'; origin: Vec3; normal: Vec3 }
  | { kind: 'line'; origin: Vec3; dir: Vec3 }
  | { kind: 'point'; point: Vec3 }
  | { kind: 'circle'; center: Vec3; normal: Vec3; radius: number }
  | { kind: 'cylinder'; origin: Vec3; axis: Vec3; radius: number; convex: boolean }
  | { kind: 'cone'; apex: Vec3; axis: Vec3; halfAngle: number; convex: boolean }
  | { kind: 'sphere'; center: Vec3; radius: number; convex: boolean };

export type GeometryKind = MateGeometry['kind'];

/** SolidWorks' words for the elements, for messages. */
export const KIND_LABEL: Record<GeometryKind, string> = {
  plane: '平面',
  line: '直線',
  point: '點',
  circle: '圓形邊線',
  cylinder: '圓柱面',
  cone: '圓錐面',
  sphere: '球面',
};

/** The geometry placed by `pose` (part coordinates → assembly coordinates). */
export function placed(g: MateGeometry, pose: Pose): MateGeometry {
  const p = (v: Vec3) => add(rotate(pose.rotation, v), pose.position);
  const d = (v: Vec3) => rotate(pose.rotation, v);
  switch (g.kind) {
    case 'plane':
      return { kind: 'plane', origin: p(g.origin), normal: d(g.normal) };
    case 'line':
      return { kind: 'line', origin: p(g.origin), dir: d(g.dir) };
    case 'point':
      return { kind: 'point', point: p(g.point) };
    case 'circle':
      return { ...g, center: p(g.center), normal: d(g.normal) };
    case 'cylinder':
      return { ...g, origin: p(g.origin), axis: d(g.axis) };
    case 'cone':
      return { ...g, apex: p(g.apex), axis: d(g.axis) };
    case 'sphere':
      return { ...g, center: p(g.center) };
  }
}

/** A line through the geometry, when it has one: straight edge, axis of a cylinder or cone, axis of a circle. */
export function axisOf(g: MateGeometry): { p: Vec3; d: Vec3 } | null {
  switch (g.kind) {
    case 'line':
      return { p: g.origin, d: g.dir };
    case 'cylinder':
      return { p: g.origin, d: g.axis };
    case 'cone':
      return { p: g.apex, d: g.axis };
    case 'circle':
      return { p: g.center, d: g.normal };
    default:
      return null;
  }
}

/** A point the geometry is centered on, when it has one: a point, the center of a sphere or of a circle. */
export function centerOf(g: MateGeometry): Vec3 | null {
  switch (g.kind) {
    case 'point':
      return g.point;
    case 'sphere':
    case 'circle':
      return g.center;
    default:
      return null;
  }
}
