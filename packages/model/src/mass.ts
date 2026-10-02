import { rotationRows, transformPoint } from './pose';
import type { Pose, Vec3 } from './schema';

/**
 * Mass properties (E1.2) and how they combine: a body with its mass, the center of mass, and the matrix of inertia about that center (row-major 3 × 3,
 * in the axes it is given in). A part's come from the kernel for a density of one (mass = volume, mm³; inertia in mm⁵) and are scaled by the density;
 * an assembly's are the parts', each placed by its pose, put together.
 */
export interface MassItem {
  mass: number;
  center: Vec3;
  inertia: number[];
}

const mul = (a: readonly number[], b: readonly number[]): number[] => {
  const out: number[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out.push(a[3 * r]! * b[c]! + a[3 * r + 1]! * b[3 + c]! + a[3 * r + 2]! * b[6 + c]!);
  return out;
};
const transpose = (a: readonly number[]): number[] => [a[0]!, a[3]!, a[6]!, a[1]!, a[4]!, a[7]!, a[2]!, a[5]!, a[8]!];

/** The same body with its mass multiplied (a density applied to a shape's volume). */
export const scaleMass = (item: MassItem, factor: number): MassItem => ({ mass: item.mass * factor, center: item.center, inertia: item.inertia.map((v) => v * factor) });

/** The body in the frame of `pose` (part coordinates → assembly coordinates): its center carried by the pose, its inertia turned by the rotation (R · I · Rᵀ). */
export function placeMass(item: MassItem, pose: Pose): MassItem {
  const r = rotationRows(pose.rotation);
  return { mass: item.mass, center: transformPoint(pose, item.center), inertia: mul(mul(r, item.inertia), transpose(r)) };
}

/** Bodies as one: the center is the mass-weighted mean, the inertia about it is each body's own plus its mass times the parallel-axis term (m (|d|² E − d dᵀ)). */
export function combineMass(items: readonly MassItem[]): MassItem {
  const mass = items.reduce((n, i) => n + i.mass, 0);
  if (!(mass > 0)) return { mass: 0, center: [0, 0, 0], inertia: [0, 0, 0, 0, 0, 0, 0, 0, 0] };
  const center: Vec3 = [0, 1, 2].map((k) => items.reduce((n, i) => n + i.center[k]! * i.mass, 0) / mass) as Vec3;
  const inertia = new Array<number>(9).fill(0);
  for (const i of items) {
    const d = [i.center[0] - center[0], i.center[1] - center[1], i.center[2] - center[2]];
    const dd = d[0]! * d[0]! + d[1]! * d[1]! + d[2]! * d[2]!;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) inertia[3 * r + c]! += i.inertia[3 * r + c]! + i.mass * ((r === c ? dd : 0) - d[r]! * d[c]!);
  }
  return { mass, center, inertia };
}

/** The principal moments of inertia (smallest first) and the axes they are about (unit vectors, the i-th for the i-th moment): the eigenvalues of the matrix, by Jacobi rotations. */
export function principalMoments(inertia: readonly number[]): { moments: [number, number, number]; axes: [Vec3, Vec3, Vec3] } {
  const a = [inertia.slice(0, 3), inertia.slice(3, 6), inertia.slice(6, 9)];
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 60; sweep++) {
    const off = Math.abs(a[0]![1]!) + Math.abs(a[0]![2]!) + Math.abs(a[1]![2]!);
    if (off < 1e-15 * (Math.abs(a[0]![0]!) + Math.abs(a[1]![1]!) + Math.abs(a[2]![2]!) + 1e-300)) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]] as const) {
      const apq = a[p]![q]!;
      if (Math.abs(apq) < 1e-300) continue;
      const theta = (a[q]![q]! - a[p]![p]!) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k]![p]!;
        const akq = a[k]![q]!;
        a[k]![p] = c * akp - s * akq;
        a[k]![q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p]![k]!;
        const aqk = a[q]![k]!;
        a[p]![k] = c * apk - s * aqk;
        a[q]![k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k]![p]!;
        const vkq = v[k]![q]!;
        v[k]![p] = c * vkp - s * vkq;
        v[k]![q] = s * vkp + c * vkq;
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[i]![i]! - a[j]![j]!);
  const pick = (i: number): Vec3 => [v[0]![i]!, v[1]![i]!, v[2]![i]!];
  return { moments: [a[order[0]!]![order[0]!]!, a[order[1]!]![order[1]!]!, a[order[2]!]![order[2]!]!], axes: [pick(order[0]!), pick(order[1]!), pick(order[2]!)] };
}

/** A part's mass properties from the kernel (density one: mass = volume), and the density of its material in g/cm³ (null: it has none). */
export interface PartMass {
  volume: number;
  area: number;
  center: Vec3;
  inertia: number[];
  density: number | null;
}

/** Grams for a volume in mm³ of a density in g/cm³: the mass of a part, and (the same factor) the inertia in g·mm² from the kernel's mm⁵. */
export const GRAMS_PER_MM3_PER_DENSITY = 1 / 1000;

/** A part as a body of the assembly: its mass in grams, center in mm, inertia in g·mm² about the center. Null when the part has no material (its mass is not known). */
export function partBody(p: PartMass): MassItem | null {
  if (p.density === null) return null;
  return scaleMass({ mass: p.volume, center: p.center, inertia: p.inertia }, p.density * GRAMS_PER_MM3_PER_DENSITY);
}

/** The mirror of a body in the part's own x = 0 plane (a mirrored part, C15.13): its center and inertia seen through x → −x. */
export function mirrorBody(b: MassItem): MassItem {
  const flip = (r: number, c: number) => ((r === 0 ? 1 : 0) + (c === 0 ? 1 : 0)) % 2 === 1; // one index is x: the entry changes sign
  return { mass: b.mass, center: [-b.center[0], b.center[1], b.center[2]], inertia: b.inertia.map((v, i) => (flip(Math.floor(i / 3), i % 3) ? -v : v)) };
}

/** What the mass properties of an assembly are made of. */
export interface PhysicalPart {
  /** What the part is called in the report. */
  name: string;
  /** Where it is in the assembly (its leaf's pose). */
  pose: Pose;
  mirrored: boolean;
  mass: PartMass | undefined;
}

export interface Physical {
  /** Grams, mm, g·mm²: the parts with a material, put together. */
  total: MassItem;
  /** mm³ and mm²: of every part, whether it has a material or not (the area is the sum of the parts' surfaces, not of the assembly's skin). */
  volume: number;
  area: number;
  /** One line per distinct part: how many, the mass of one (null: no material), in the order they first appear. */
  lines: { name: string; qty: number; mass: number | null; volume: number }[];
  /** Parts without a material: their mass is not in `total`. */
  withoutMaterial: string[];
  /** Parts whose properties are not known yet (not built). */
  unknown: string[];
}

/** The mass properties of an assembly (E1.2): each part's body put in its place by its pose and all of them combined (see `combineMass`). */
export function assemblyPhysical(parts: readonly PhysicalPart[]): Physical {
  const bodies: MassItem[] = [];
  const lines = new Map<string, { name: string; qty: number; mass: number | null; volume: number }>();
  const without = new Set<string>();
  const unknown = new Set<string>();
  let volume = 0;
  let area = 0;
  for (const p of parts) {
    if (!p.mass) {
      unknown.add(p.name);
      continue;
    }
    volume += p.mass.volume;
    area += p.mass.area;
    const body = partBody(p.mass);
    const key = p.name;
    const line = lines.get(key) ?? { name: p.name, qty: 0, mass: body ? body.mass : null, volume: p.mass.volume };
    line.qty += 1;
    lines.set(key, line);
    if (!body) {
      without.add(p.name);
      continue;
    }
    bodies.push(placeMass(p.mirrored ? mirrorBody(body) : body, p.pose));
  }
  return { total: combineMass(bodies), volume, area, lines: [...lines.values()], withoutMaterial: [...without], unknown: [...unknown] };
}