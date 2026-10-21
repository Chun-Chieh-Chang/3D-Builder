import { t } from '@3db/i18n';
import { axisAngle, composeRotations, type Quat, type Vec3 } from '@3db/model';
import type { GoalTerm } from './solver';

/**
 * 「以座標軸移動」(Move with Triad, ADR 0179): what a drag of one of the triad's handles asks of the component, as goal terms for the solver. The triad sits at
 * the component's middle (the point a right drag turns it about) and points along the assembly's X, Y and Z. A handle allows one kind of motion and nothing
 * else: an arrow, moving along its axis; a square, moving in its plane; a ring, turning about its axis through the middle. The terms come most important
 * first (the solver meets each as far as the mates and the terms before it allow): first what the handle keeps (the middle on the axis or in the plane, or
 * where it is; the orientation, or the ring's axis), then where the drag asks it to go. So a direction a mate locks stays where it is, and a free one the
 * handle does not offer does not move either.
 */

export type TriadAxis = 0 | 1 | 2;

export type TriadHandle = { kind: 'axis'; axis: TriadAxis } | { kind: 'plane'; normal: TriadAxis } | { kind: 'ring'; axis: TriadAxis };

/** A ray of the pointer, in the assembly's coordinates (`dir` need not be a unit). */
export interface TriadRay {
  origin: Vec3;
  dir: Vec3;
}

/** 「步進」: a move snaps to multiples of `move` (mm), a turn to multiples of `turn` (degrees); 0 does not snap. */
export interface TriadSteps {
  move: number;
  turn: number;
}

export const TRIAD_NO_STEPS: TriadSteps = { move: 0, turn: 0 };

/** Where a triad drag began: the handle, the component's middle (in the part's coordinates and where it is in the assembly), its orientation, its size, and the ray then. */
export interface TriadGrab {
  handle: TriadHandle;
  center: Vec3;
  centerAt: Vec3;
  rotation: Quat;
  /** About the size of the component (mm): how far along the ring's axis a second point is kept on it. */
  size: number;
  start: TriadRay;
}

/** How far the drag has gone: along the axis (mm), across the plane (mm, a vector in it), or round the ring (radians, counter-clockwise looking down the axis). */
export type TriadMotion = { kind: 'axis'; distance: number } | { kind: 'plane'; offset: Vec3 } | { kind: 'ring'; angle: number };

export const TRIAD_AXES: readonly Vec3[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const finite = (v: readonly number[]) => v.every(Number.isFinite);

/** Why the steps cannot be used, or null. Nothing is turned into a usable value (AGENTS.md §2.1): a negative, infinite or missing step is refused. */
export function triadStepsProblem(steps: TriadSteps): string | null {
  if (!Number.isFinite(steps.move) || steps.move < 0) return t('triad.moveStepInvalid');
  if (!Number.isFinite(steps.turn) || steps.turn < 0) return t('triad.turnStepInvalid');
  return null;
}

/** The parameter on the line `c + s·a` (a a unit) nearest the ray; null when the ray runs along the line (looking straight down the arrow). */
function alongLine(c: Vec3, a: Vec3, r: TriadRay): number | null {
  const dd = dot(r.dir, r.dir);
  const b = dot(a, r.dir);
  const denom = dd - b * b;
  if (!(denom > 1e-9 * dd)) return null;
  const w = sub(c, r.origin);
  return (b * dot(r.dir, w) - dd * dot(a, w)) / denom;
}

/** Where the ray meets the plane through `c` square to `n`; null when it runs along the plane (the square seen edge-on). */
function onPlane(c: Vec3, n: Vec3, r: TriadRay): Vec3 | null {
  const d = dot(r.dir, n);
  if (!(Math.abs(d) > 1e-9 * Math.sqrt(dot(r.dir, r.dir)))) return null;
  return add(r.origin, scale(r.dir, dot(sub(c, r.origin), n) / d));
}

const snap = (v: number, step: number) => (step > 0 ? Math.round(v / step) * step : v);

/**
 * How far the drag from `grab.start` to `ray` has gone, snapped to the steps. `previous` is the motion of the last pointer position: a ring's angle goes on
 * past half a turn instead of jumping back. Null when the pointer looks along what the handle moves in (nothing can be read from it): keep the last motion.
 */
export function triadMotion(grab: TriadGrab, ray: TriadRay, steps: TriadSteps = TRIAD_NO_STEPS, previous: TriadMotion | null = null): TriadMotion | null {
  if (!finite([...ray.origin, ...ray.dir])) return null;
  const c = grab.centerAt;
  switch (grab.handle.kind) {
    case 'axis': {
      const a = TRIAD_AXES[grab.handle.axis]!;
      const s0 = alongLine(c, a, grab.start);
      const s = alongLine(c, a, ray);
      if (s0 === null || s === null) return null;
      return { kind: 'axis', distance: snap(s - s0, steps.move) };
    }
    case 'plane': {
      const normal = grab.handle.normal;
      const n = TRIAD_AXES[normal]!;
      const p0 = onPlane(c, n, grab.start);
      const p = onPlane(c, n, ray);
      if (!p0 || !p) return null;
      // snapped along each of the plane's two axes; nothing across it
      const d = sub(p, p0);
      const offset = [0, 1, 2].map((k) => (k === normal ? 0 : snap(d[k]!, steps.move))) as Vec3;
      return { kind: 'plane', offset };
    }
    case 'ring': {
      const a = TRIAD_AXES[grab.handle.axis]!;
      const p0 = onPlane(c, a, grab.start);
      const p = onPlane(c, a, ray);
      if (!p0 || !p) return null;
      const [v0, v] = [sub(p0, c), sub(p, c)];
      const tiny = 1e-9 * Math.max(1, grab.size);
      if (Math.hypot(...v0) < tiny || Math.hypot(...v) < tiny) return null;
      let angle = Math.atan2(dot(a, cross(v0, v)), dot(v0, v));
      if (previous?.kind === 'ring') angle += 2 * Math.PI * Math.round((previous.angle - angle) / (2 * Math.PI));
      const step = (steps.turn * Math.PI) / 180;
      return { kind: 'ring', angle: snap(angle, step) };
    }
  }
}

/** The rotation the component has after the drag: turned about the ring's axis, or as it was. */
export function triadRotation(grab: TriadGrab, motion: TriadMotion): Quat {
  return motion.kind === 'ring' && grab.handle.kind === 'ring' ? composeRotations(axisAngle(TRIAD_AXES[grab.handle.axis]!, motion.angle), grab.rotation) : grab.rotation;
}

/** The goal terms of the motion, most important first (see the top of this file). */
export function triadTerms(grab: TriadGrab, motion: TriadMotion): GoalTerm[] {
  const c = grab.centerAt;
  const keepTurn: GoalTerm = { kind: 'rotation', rotation: grab.rotation };
  switch (grab.handle.kind) {
    case 'axis': {
      const a = TRIAD_AXES[grab.handle.axis]!;
      const distance = motion.kind === 'axis' ? motion.distance : 0;
      return [{ kind: 'pointOnLine', point: grab.center, origin: c, dir: a }, keepTurn, { kind: 'pointAt', point: grab.center, target: add(c, scale(a, distance)) }];
    }
    case 'plane': {
      const n = TRIAD_AXES[grab.handle.normal]!;
      const offset = motion.kind === 'plane' ? motion.offset : ([0, 0, 0] as Vec3);
      return [{ kind: 'pointOnPlane', point: grab.center, origin: c, normal: n }, keepTurn, { kind: 'pointAt', point: grab.center, target: add(c, offset) }];
    }
    case 'ring':
      // The turn first, then the middle back where it was (as a right drag turns a component). A turn that keeps the middle is not a straight line in the
      // solver's variables, so a term that held the middle first would be broken a hair by every step and every step refused; what is not a turn about the
      // ring's axis is caught afterwards instead (`triadHolds`).
      return [
        { kind: 'rotation', rotation: triadRotation(grab, motion) },
        { kind: 'pointAt', point: grab.center, target: c },
      ];
  }
}

/**
 * Whether `pose` is a motion the handle offers, from where the drag began: along the arrow's axis without turning, in the square's plane without turning, or
 * turned about the ring's axis through the middle. A mate may leave the component no such motion and the solver then finds the nearest pose it can reach,
 * which may be another motion (turned about another axis, or with its middle moved): that pose is not taken, the drag stays where it last held (ADR 0179).
 * `tolerance` is in mm, an angle counted as that much at the size of the component.
 */
export function triadHolds(grab: TriadGrab, pose: { position: Vec3; rotation: Quat }, tolerance = 1e-6 * Math.max(1, grab.size)): boolean {
  const middle = add(rotateBy(pose.rotation, grab.center), pose.position);
  const moved = sub(middle, grab.centerAt);
  const size = Math.max(1, grab.size);
  // where the part's own axes point now, against where they pointed: unchanged for a move, the ring's turn for a ring
  const [x, y, z, w] = grab.rotation;
  const inverse: Quat = [-x, -y, -z, w];
  switch (grab.handle.kind) {
    case 'axis': {
      const a = TRIAD_AXES[grab.handle.axis]!;
      const across = sub(moved, scale(a, dot(moved, a)));
      return Math.hypot(...across) <= tolerance && turnedBy(grab.rotation, pose.rotation) * size <= tolerance;
    }
    case 'plane': {
      const n = TRIAD_AXES[grab.handle.normal]!;
      return Math.abs(dot(moved, n)) <= tolerance && turnedBy(grab.rotation, pose.rotation) * size <= tolerance;
    }
    case 'ring': {
      const a = TRIAD_AXES[grab.handle.axis]!;
      const partAxis = rotateBy(inverse, a);
      const axisNow = rotateBy(pose.rotation, partAxis);
      return Math.hypot(...moved) <= tolerance && Math.hypot(...sub(axisNow, a)) * size <= tolerance;
    }
  }
}

/** The angle (radians) between two orientations: of a⁻¹·b, read with atan2 so that a hair of a turn is not lost (acos near 1 would be). */
function turnedBy([ax, ay, az, aw]: Quat, [bx, by, bz, bw]: Quat): number {
  // the conjugate of a times b
  const x = aw * bx - ax * bw - ay * bz + az * by;
  const y = aw * by + ax * bz - ay * bw - az * bx;
  const z = aw * bz - ax * by + ay * bx - az * bw;
  const w = aw * bw + ax * bx + ay * by + az * bz;
  return 2 * Math.atan2(Math.hypot(x, y, z), Math.abs(w));
}

/** `v` turned by the unit quaternion `q`. */
function rotateBy([x, y, z, w]: Quat, v: Vec3): Vec3 {
  const u: Vec3 = [x, y, z];
  const uv = cross(u, v);
  const uuv = cross(u, uv);
  return add(v, add(scale(uv, 2 * w), scale(uuv, 2)));
}
