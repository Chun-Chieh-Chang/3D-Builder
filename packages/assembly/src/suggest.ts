import type { MateType, Vec3 } from '@3db/model';
import { axisOf, centerOf, type MateGeometry } from './geometry';
import { compileMate, type MateSpec } from './equations';
import { across, dot, norm, sub } from './math';

/**
 * What the mate PropertyManager offers for two selected elements (C15.8), all from the elements as
 * they are placed now: which mates can join them, which one SolidWorks would pick, which way round,
 * and the distance or angle between them.
 */

const TYPES: MateType[] = ['coincident', 'parallel', 'perpendicular', 'tangent', 'concentric', 'lock', 'distance', 'angle'];
const ORIGIN = { position: [0, 0, 0] as Vec3, rotation: [0, 0, 0, 1] as [number, number, number, number] };

/** The mates that can join the two elements (lock only between two components: `bothComponents`). */
export function supportedTypes(a: MateGeometry, b: MateGeometry, bothComponents = true): MateType[] {
  return TYPES.filter((type) => {
    if (type === 'lock') return bothComponents;
    const spec: MateSpec = { id: 'probe', type, a: { body: 'a', geom: a }, b: { body: 'b', geom: b }, ...(type === 'distance' ? { value: 1 } : type === 'angle' ? { value: 0.5 } : {}), relative: ORIGIN };
    return !('unsupported' in compileMate(spec, [a, b]));
  });
}

const round = (g: MateGeometry) => g.kind === 'cylinder' || g.kind === 'cone' || g.kind === 'circle' || g.kind === 'sphere';

/** The mate SolidWorks offers first: concentric for two round elements, tangent for a face and a shaft, else coincident. */
export function defaultType(a: MateGeometry, b: MateGeometry, bothComponents = true): MateType | null {
  const offered = supportedTypes(a, b, bothComponents);
  const has = (t: MateType) => offered.includes(t);
  const faceAndRound = (p: MateGeometry, q: MateGeometry) => p.kind === 'plane' && (q.kind === 'cylinder' || q.kind === 'sphere');
  if (round(a) && round(b) && has('concentric')) return 'concentric';
  if ((faceAndRound(a, b) || faceAndRound(b, a)) && has('tangent')) return 'tangent';
  if (((a.kind === 'line' && round(b)) || (b.kind === 'line' && round(a))) && has('concentric')) return 'concentric';
  if (has('coincident')) return 'coincident';
  return offered.find((t) => t !== 'lock') ?? null;
}

const direction = (g: MateGeometry): Vec3 | null => (g.kind === 'plane' ? g.normal : (axisOf(g)?.d ?? null));

/** Mates whose alignment means something: they join a direction of each element. */
export function hasAlignment(type: MateType, a: MateGeometry, b: MateGeometry): boolean {
  if (!direction(a) || !direction(b)) return false;
  if (type === 'coincident' || type === 'parallel' || type === 'distance') return (a.kind === 'plane') === (b.kind === 'plane');
  return type === 'concentric';
}

/** The alignment the elements are closer to now: the mate then turns the part the least. */
export function closerAlignment(a: MateGeometry, b: MateGeometry): 'aligned' | 'antiAligned' {
  const u = direction(a);
  const v = direction(b);
  return u && v && dot(u, v) < 0 ? 'antiAligned' : 'aligned';
}

/**
 * The distance (mm) or angle (radians) between the elements now, and whether it lies on the flipped
 * side, in the solver's terms: a distance from a plane is signed along its normal; an angle from a
 * plane to a line is signed the same way. Null when the mate has no value or the pair none.
 */
export function currentValue(type: MateType, a: MateGeometry, b: MateGeometry): { value: number; flip: boolean } | null {
  if (type !== 'distance' && type !== 'angle') return null;
  // Below this the side is rounding noise (e.g. faces a solve made coincident): the plain side, not flipped.
  const NOISE = 1e-6;
  // As the solver writes the pair: a plane first.
  const [A, B] = b.kind === 'plane' && a.kind !== 'plane' ? [b, a] : [a, b];
  const u = direction(A);
  const v = direction(B);
  if (type === 'angle') {
    if (!u || !v) return null;
    const c = Math.max(-1, Math.min(1, dot(u, v)));
    if (A.kind === 'plane' && B.kind !== 'plane') return { value: Math.asin(Math.abs(c)), flip: c < -NOISE };
    return { value: Math.acos(c), flip: false };
  }
  const point = (g: MateGeometry) => (g.kind === 'plane' ? g.origin : (axisOf(g)?.p ?? centerOf(g)));
  if (A.kind === 'plane') {
    const p = B.kind === 'circle' || B.kind === 'sphere' || B.kind === 'point' ? centerOf(B)! : point(B)!;
    const s = dot(A.normal, sub(p, A.origin));
    return { value: Math.abs(s), flip: s < -NOISE };
  }
  const axisA = A.kind === 'circle' ? null : axisOf(A);
  const axisB = B.kind === 'circle' ? null : axisOf(B);
  if (axisA) return { value: norm(across(sub(axisB?.p ?? centerOf(B)!, axisA.p), axisA.d)), flip: false };
  if (axisB) return { value: norm(across(sub(centerOf(A)!, axisB.p), axisB.d)), flip: false };
  const ca = centerOf(A);
  const cb = centerOf(B);
  return ca && cb ? { value: norm(sub(cb, ca)), flip: false } : null;
}
