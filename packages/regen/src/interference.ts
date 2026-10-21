import { KernelError, type Kernel, type ShapeId } from '@3db/kernel';
import { MIN_INTERFERENCE_VOLUME, placementRows, type InterferenceComponent, type Vec3 } from '@3db/model';

/**
 * Where two components share volume: the part of it that two of their parts share, as a shape of its own (in the assembly's frame) that the caller releases,
 * with where it is: its centre of mass and the box round it, and the pieces it is made of that are apart, each with a point on it (ADR 0180).
 */
export interface Overlap {
  a: string;
  b: string;
  volume: number;
  center: Vec3;
  min: Vec3;
  max: Vec3;
  regions: OverlapRegion[];
  shape: ShapeId;
}

/** A piece of an overlap apart from the others: the centre of a ring is in its empty middle, so `anchor` is a point on the piece itself (Kernel.regions). */
export interface OverlapRegion {
  volume: number;
  center: Vec3;
  min: Vec3;
  max: Vec3;
  anchor: Vec3;
}

export interface InterferenceFound {
  overlaps: Overlap[];
  /** How many pairs of parts the kernel was asked about (the others are apart: their boxes do not meet). */
  checked: number;
  /** Components with a part that is not built: they could not be compared. */
  unknown: string[];
  /** Pairs of components the kernel could not work out, and why. */
  failed: { a: string; b: string; message: string }[];
}

const EPS = 1e-6;
const meet = (p: { min: number[]; max: number[] }, q: { min: number[]; max: number[] }) => [0, 1, 2].every((k) => p.min[k]! <= q.max[k]! + EPS && q.min[k]! <= p.max[k]! + EPS);

/**
 * The interference of components (E2.1): for every two components, the volume their parts have in common. A part is put where the assembly has it
 * first (`shapeOf` gives the part's own shape by its key), and two parts are only compared when their boxes meet. Parts of one component are not
 * compared with each other. Two parts that only touch share no volume (see MIN_INTERFERENCE_VOLUME). Everything made here but the overlaps is released.
 * With `involving`, only the pairs that have one of those components are compared (what a drag asks, A3.6).
 */
export function findInterference(kernel: Kernel, components: readonly InterferenceComponent[], shapeOf: (part: string) => ShapeId | null, minVolume = MIN_INTERFERENCE_VOLUME, involving?: ReadonlySet<string>): InterferenceFound {
  const made: ShapeId[] = [];
  const found: InterferenceFound = { overlaps: [], checked: 0, unknown: [], failed: [] };
  try {
    const placed = components.map((c) => {
      const parts: { shape: ShapeId; box: { min: number[]; max: number[] } }[] = [];
      let unknown = false;
      for (const p of c.parts) {
        const base = shapeOf(p.part);
        if (base === null) {
          unknown = true;
          continue;
        }
        const shape = kernel.transformed(base, placementRows(p.pose, p.mirrored));
        made.push(shape);
        parts.push({ shape, box: kernel.bounds(shape) });
      }
      if (unknown) found.unknown.push(c.id);
      return { id: c.id, parts };
    });
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i]!;
        const b = placed[j]!;
        if (involving && !involving.has(a.id) && !involving.has(b.id)) continue; // only what moves is asked about (a drag, A3.6)
        const first = found.overlaps.length;
        try {
          for (const pa of a.parts) {
            for (const pb of b.parts) {
              if (!meet(pa.box, pb.box)) continue;
              found.checked++;
              const common = kernel.common(pa.shape, pb.shape, minVolume);
              if (common.shape !== null) {
                // kept before it is measured: should bounds or regions throw, the catch below releases it with the pair's others
                const at = found.overlaps.push({ a: a.id, b: b.id, volume: common.volume, center: common.center!, min: [0, 0, 0], max: [0, 0, 0], regions: [], shape: common.shape }) - 1;
                const box = kernel.bounds(common.shape);
                found.overlaps[at] = { ...found.overlaps[at]!, min: box.min, max: box.max, regions: kernel.regions(common.shape) };
              }
            }
          }
        } catch (e) {
          // what was found of this pair before it failed is not a result: part of its volume would read as all of it
          for (const o of found.overlaps.splice(first)) kernel.release(o.shape);
          found.failed.push({ a: a.id, b: b.id, message: e instanceof KernelError || e instanceof Error ? e.message : String(e) });
        }
      }
    }
    return found;
  } catch (e) {
    for (const o of found.overlaps) kernel.release(o.shape); // nothing is handed over when it fails as a whole
    throw e;
  } finally {
    for (const id of made) kernel.release(id);
  }
}
