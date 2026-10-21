import type { MeshData } from '@3db/kernel';
import type { Vec3 } from '@3db/model';

/**
 * How the result of 「干涉檢查」 (E2.1) is looked at (ADR 0180): the overlaps put together by pair of components, where each pair's overlap is, which pairs
 * the user set aside (「忽略」), and going from one shown pair to the next. Pure, so it is checked without a screen or a kernel.
 */

/** What the other components look like while a pair is chosen (SolidWorks' 「非干涉零組件」). */
export const INTERFERENCE_OTHERS = ['transparent', 'wireframe', 'hidden', 'current'] as const;
export type InterferenceOthers = (typeof INTERFERENCE_OTHERS)[number];

/** A piece of an overlap apart from the others, with a point on the piece itself (the centre of a ring is in its empty middle). */
export interface OverlapRegion {
  volume: number;
  center: Vec3;
  min: Vec3;
  max: Vec3;
  anchor: Vec3;
}

/** One overlap as the worker gives it: in the assembly's frame, with its centre of mass, box and pieces. */
export interface OverlapFound {
  a: string;
  b: string;
  volume: number;
  center: Vec3;
  min: Vec3;
  max: Vec3;
  regions: OverlapRegion[];
  mesh: MeshData;
}

/** Two components that share volume, and what they share (one overlap for each pair of their parts that meet). */
export interface InterferencePair {
  a: string;
  b: string;
  aName: string;
  bName: string;
  /** The components of the assembly they are (what is shown as selected). */
  aTop: string;
  bTop: string;
  /** mm³, the overlaps together. */
  volume: number;
  /** The centre of mass of the overlaps together (each weighted by its volume), mm. */
  center: Vec3;
  /** The box round all of them, mm. */
  min: Vec3;
  max: Vec3;
  /** The pieces of all of them, the biggest first: where the rings go, and the first one's anchor is where the list says the pair is. */
  regions: OverlapRegion[];
  overlaps: MeshData[];
}

/** What a pair is known by while the window is open, whatever its place in the list (a check again may reorder it). */
export const pairKey = (p: { a: string; b: string }): string => `${p.a}|${p.b}`;

/**
 * The overlaps put together by pair of components, the biggest first. `names` and `tops` say what each component is called and which component of the assembly it is;
 * one that is not in them is called by its id.
 */
export function groupOverlaps(overlaps: readonly OverlapFound[], names: ReadonlyMap<string, string>, tops: ReadonlyMap<string, string>): InterferencePair[] {
  const pairs = new Map<string, InterferencePair & { moment: Vec3 }>();
  for (const o of overlaps) {
    const key = pairKey(o);
    let p = pairs.get(key);
    if (!p) {
      p = { a: o.a, b: o.b, aName: names.get(o.a) ?? o.a, bName: names.get(o.b) ?? o.b, aTop: tops.get(o.a) ?? o.a, bTop: tops.get(o.b) ?? o.b, volume: 0, center: [0, 0, 0], min: [o.min[0], o.min[1], o.min[2]], max: [o.max[0], o.max[1], o.max[2]], regions: [], overlaps: [], moment: [0, 0, 0] };
      pairs.set(key, p);
    }
    p.volume += o.volume;
    for (let k = 0; k < 3; k++) {
      p.moment[k] = p.moment[k]! + o.volume * o.center[k]!;
      p.min[k] = Math.min(p.min[k]!, o.min[k]!);
      p.max[k] = Math.max(p.max[k]!, o.max[k]!);
    }
    p.overlaps.push(o.mesh);
    p.regions.push(...o.regions);
  }
  return [...pairs.values()]
    .map(({ moment, ...p }): InterferencePair => ({ ...p, center: [moment[0] / p.volume, moment[1] / p.volume, moment[2] / p.volume], regions: [...p.regions].sort((x, y) => y.volume - x.volume) }))
    .sort((x, y) => y.volume - x.volume);
}

/** The places in `pairs` of the ones the list shows: all of them with `showIgnored`, else those not set aside. */
export function shownPairs(pairs: readonly InterferencePair[], ignored: readonly string[], showIgnored: boolean): number[] {
  const off = new Set(ignored);
  return pairs.flatMap((p, i) => (showIgnored || !off.has(pairKey(p)) ? [i] : []));
}

/**
 * The pair chosen after a step down (`by` 1) or up (−1) the shown list, round from the end to the start. With none chosen, down takes the first and up the last;
 * with none shown, none.
 */
export function stepPair(pairs: readonly InterferencePair[], ignored: readonly string[], showIgnored: boolean, selected: number | null, by: 1 | -1): number | null {
  const shown = shownPairs(pairs, ignored, showIgnored);
  if (shown.length === 0) return null;
  const at = selected === null ? -1 : shown.indexOf(selected);
  if (at < 0) return by === 1 ? shown[0]! : shown[shown.length - 1]!;
  return shown[(at + by + shown.length) % shown.length]!;
}

/**
 * What the list says of where a pair is, mm to two places: a point on its biggest piece (not the centre of mass, which for a ring or pieces round an axis is
 * in empty space; with no pieces, the centre), how many pieces there are, and the size of the box round them all.
 */
export function pairPlace(p: Pick<InterferencePair, 'center' | 'min' | 'max' | 'regions'>): { at: string; pieces: number; size: string } {
  const f = (v: number) => (Math.round(v * 100) / 100 + 0).toFixed(2);
  return { at: (p.regions[0]?.anchor ?? p.center).map(f).join(', '), pieces: p.regions.length, size: [0, 1, 2].map((k) => f(p.max[k]! - p.min[k]!)).join(' × ') };
}
