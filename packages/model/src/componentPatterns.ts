import { t } from '@3db/i18n';
import { evalAngle, evalLength, ExprError } from './expr';
import { axisAngle, quatFromRows, rotationRows } from './pose';
import type { ComponentPattern, MirrorPlane, Pose, Vec3 } from './schema';

/**
 * Component patterns and mirrors (C15.13). Only the arithmetic lives here: given what a pattern's axes are (found by whoever can
 * see the geometry) this says where each instance goes. The instances are derived and never stored.
 */

/** A straight line in the assembly: a point on it and a unit direction. */
export interface PatternLine {
  origin: Vec3;
  dir: Vec3;
}

/** The most instances one pattern may make: more is a mistake, and every instance is drawn. */
export const MAX_PATTERN_INSTANCES = 500;

/** The patterns' axes of the assembly itself. */
export const ASSEMBLY_AXES: Record<'x' | 'y' | 'z', PatternLine> = {
  x: { origin: [0, 0, 0], dir: [1, 0, 0] },
  y: { origin: [0, 0, 0], dir: [0, 1, 0] },
  z: { origin: [0, 0, 0], dir: [0, 0, 1] },
};

/** The normals of the planes a component can be mirrored about (the assembly's front, top and right planes). */
export const MIRROR_NORMAL: Record<MirrorPlane, Vec3> = {
  'plane:front': [0, 0, 1],
  'plane:top': [0, 1, 0],
  'plane:right': [1, 0, 0],
};

export interface PatternInstance {
  /** "2", "3" …, or "2x1" in a grid. */
  label: string;
  /** How the seed is moved to this instance: a turn or a slide of space (assembly coordinates), applied to the seed's pose. */
  motion: Pose;
}

const unit = (v: Vec3): Vec3 => {
  const n = Math.hypot(...v);
  return [v[0] / n, v[1] / n, v[2] / n];
};

/** The slide by `distance` along a line. */
const slide = (line: PatternLine, distance: number): Pose => ({ position: [line.dir[0] * distance, line.dir[1] * distance, line.dir[2] * distance], rotation: [0, 0, 0, 1] });

/** The turn by `angle` (radians) about a line: the pose that takes a point p to origin + q(p − origin). */
function turn(line: PatternLine, angle: number): Pose {
  const d = unit(line.dir);
  const rotation = axisAngle(d, angle);
  const r = rotationRows(rotation);
  const o = line.origin;
  const moved: Vec3 = [r[0]! * o[0] + r[1]! * o[1] + r[2]! * o[2], r[3]! * o[0] + r[4]! * o[1] + r[5]! * o[2], r[6]! * o[0] + r[7]! * o[1] + r[8]! * o[2]];
  return { position: [o[0] - moved[0], o[1] - moved[1], o[2] - moved[2]], rotation };
}

/** The labels of a pattern's instances, the seed excluded: "2" … "n", or "i x j" for a grid. */
export function componentPatternLabels(p: ComponentPattern): string[] {
  const n1 = p.count1 ?? 1;
  if (p.kind === 'linear' && p.axis2 && (p.count2 ?? 1) > 1) {
    const out: string[] = [];
    for (let j = 1; j <= p.count2!; j++) for (let i = 1; i <= n1; i++) if (i !== 1 || j !== 1) out.push(`${i}x${j}`);
    return out;
  }
  return Array.from({ length: Math.max(0, n1 - 1) }, (_, k) => String(k + 2));
}

/** Why a pattern's definition cannot be used (its numbers and labels, not its geometry); null when it can. */
export function componentPatternProblem(p: ComponentPattern): string | null {
  if (p.kind === 'mirror') return p.plane && p.plane in MIRROR_NORMAL ? null : t('pattern.noPlane');
  if (p.kind !== 'linear' && p.kind !== 'circular') return t('pattern.badKind', { kind: String(p.kind) });
  const whole = (n: number | undefined) => Number.isInteger(n) && n! >= 2;
  if (!p.axis1) return t('pattern.noAxis');
  if (!whole(p.count1)) return t('pattern.badCount');
  const grid = p.kind === 'linear' && !!p.axis2;
  if (p.axis2 && p.kind !== 'linear') return t('pattern.circularOneAxis');
  if (grid && !whole(p.count2)) return t('pattern.badCount');
  const total = grid ? p.count1! * p.count2! : p.count1!;
  if (total > MAX_PATTERN_INSTANCES) return t('pattern.tooMany', { max: MAX_PATTERN_INSTANCES });
  try {
    const eval1 = p.kind === 'linear' ? evalLength(p.spacing1 ?? '') : evalAngle(p.spacing1 ?? '');
    if (!(eval1 > 0)) return t('pattern.badSpacing');
    if (grid && !(evalLength(p.spacing2 ?? '') > 0)) return t('pattern.badSpacing');
  } catch (e) {
    return e instanceof ExprError ? e.message : String(e);
  }
  const labels = new Set(componentPatternLabels(p));
  for (const s of p.skip ?? []) if (!labels.has(s)) return t('pattern.badSkip', { label: s });
  return null;
}

/**
 * Where each instance of a linear or circular pattern is, as a motion of the seed. `lines` are the pattern's axes found in the
 * assembly (the first, and for a grid the second). Returns a message when the definition cannot be used. The skipped ones are not in the result.
 */
export function componentPatternInstances(p: ComponentPattern, lines: { axis1: PatternLine; axis2?: PatternLine }): PatternInstance[] | string {
  const problem = componentPatternProblem(p);
  if (problem) return problem;
  if (p.kind === 'mirror') return [];
  const skip = new Set(p.skip ?? []);
  const sign1 = p.flip1 ? -1 : 1;
  const sign2 = p.flip2 ? -1 : 1;
  const out: PatternInstance[] = [];
  if (p.kind === 'linear') {
    const d1 = evalLength(p.spacing1!);
    const grid = !!p.axis2 && !!lines.axis2;
    const d2 = grid ? evalLength(p.spacing2!) : 0;
    for (let j = 0; j < (grid ? p.count2! : 1); j++) {
      for (let i = 0; i < p.count1!; i++) {
        if (i === 0 && j === 0) continue;
        const label = grid ? `${i + 1}x${j + 1}` : String(i + 1);
        if (skip.has(label)) continue;
        const a = slide(lines.axis1, sign1 * d1 * i);
        const b = grid ? slide(lines.axis2!, sign2 * d2 * j) : slide(lines.axis1, 0);
        out.push({ label, motion: { position: [a.position[0] + b.position[0], a.position[1] + b.position[1], a.position[2] + b.position[2]], rotation: [0, 0, 0, 1] } });
      }
    }
    return out;
  }
  const spacing = evalAngle(p.spacing1!);
  const step = p.equal ? (spacing >= Math.PI * 2 - 1e-9 ? spacing / p.count1! : spacing / (p.count1! - 1)) : spacing;
  for (let i = 1; i < p.count1!; i++) {
    const label = String(i + 1);
    if (skip.has(label)) continue;
    out.push({ label, motion: turn(lines.axis1, sign1 * step * i) });
  }
  return out;
}

/**
 * A mirrored component's pose (C15.13): the component at `pose`, reflected in the assembly plane. Its part is mirrored in the part's own x = 0 plane
 * (`mirroredPart`), so the pose that puts that part where the reflection of the original is is R · pose · M, where R is the reflection in the
 * assembly and M the one in the part: two reflections make a rotation, so a mirrored component is still placed by a rigid pose.
 */
export function mirroredPose(plane: MirrorPlane, pose: Pose): Pose {
  const n = MIRROR_NORMAL[plane];
  const refl = [1 - 2 * n[0] * n[0], -2 * n[0] * n[1], -2 * n[0] * n[2], -2 * n[1] * n[0], 1 - 2 * n[1] * n[1], -2 * n[1] * n[2], -2 * n[2] * n[0], -2 * n[2] * n[1], 1 - 2 * n[2] * n[2]];
  const w = rotationRows(pose.rotation);
  const rw: number[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) rw.push(refl[3 * r]! * w[c]! + refl[3 * r + 1]! * w[3 + c]! + refl[3 * r + 2]! * w[6 + c]!);
  // right-multiplying by M = diag(−1, 1, 1) negates the first column
  const rows = rw.map((v, i) => (i % 3 === 0 ? -v : v));
  const p = pose.position;
  const position: Vec3 = [refl[0]! * p[0] + refl[1]! * p[1] + refl[2]! * p[2], refl[3]! * p[0] + refl[4]! * p[1] + refl[5]! * p[2], refl[6]! * p[0] + refl[7]! * p[1] + refl[8]! * p[2]];
  return { position, rotation: quatFromRows(rows) };
}

/** A pose seen through the part-side reflection M = diag(−1, 1, 1) on both sides: where a part of a mirrored sub-assembly goes inside it. */
export function mirroredInside(pose: Pose): Pose {
  const w = rotationRows(pose.rotation);
  // M · R · M negates the first row and the first column (the (0,0) entry twice)
  const rows = w.map((v, i) => (i === 0 ? v : i < 3 || i % 3 === 0 ? -v : v));
  return { position: [-pose.position[0], pose.position[1], pose.position[2]], rotation: quatFromRows(rows) };
}

/** The 4 × 4 reflection (column-major, for the viewer) that makes a part's mirror: x → −x in the part's own coordinates. */
export const MIRROR_IN_PART = [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] as const;
