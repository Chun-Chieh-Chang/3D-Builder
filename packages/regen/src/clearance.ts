import { KernelError, type Kernel, type ShapeId } from '@3db/kernel';
import { MIN_INTERFERENCE_VOLUME, placementRows, type InterferenceComponent, type Pose, type Vec3 } from '@3db/model';

/** How far apart two components are, where (the closest points, in the assembly's frame): one row of the clearance check. */
export interface ClearanceRow {
  a: string;
  b: string;
  distance: number;
  pointA: Vec3;
  pointB: Vec3;
  /** They share volume, not just touch (distance 0 either way). */
  interferes: boolean;
}

export interface ClearanceFound {
  /** The pairs closer than the least clearance asked for, the closest first. */
  rows: ClearanceRow[];
  /** How many pairs of parts the kernel measured (the others are further apart than the clearance: their boxes are). */
  checked: number;
  unknown: string[];
  failed: { a: string; b: string; message: string }[];
}

type Box = { min: number[]; max: number[] };
const apart = (p: Box, q: Box, gap: number) => [0, 1, 2].some((k) => p.min[k]! > q.max[k]! + gap || q.min[k]! > p.max[k]! + gap);
const grow = (p: Box, q: Box): Box => ({ min: [0, 1, 2].map((k) => Math.min(p.min[k]!, q.min[k]!)), max: [0, 1, 2].map((k) => Math.max(p.max[k]!, q.max[k]!)) });

/** The parts of each component put where the assembly has them; the caller releases `made`. */
function place(kernel: Kernel, components: readonly InterferenceComponent[], shapeOf: (part: string) => ShapeId | null, made: ShapeId[], unknown: string[]) {
  return components.map((c) => {
    const parts: { shape: ShapeId; box: Box }[] = [];
    let missing = false;
    for (const p of c.parts) {
      const base = shapeOf(p.part);
      if (base === null) {
        missing = true;
        continue;
      }
      const shape = kernel.transformed(base, placementRows(p.pose, p.mirrored));
      made.push(shape);
      parts.push({ shape, box: kernel.bounds(shape) });
    }
    if (missing) unknown.push(c.id);
    return { id: c.id, parts };
  });
}

/**
 * Clearance verification (E2.2): for every two components, the shortest distance between their parts, exactly, where it is smaller than `least`. Two parts
 * are only measured when their boxes are less than `least` apart. Parts of one component are not compared with each other. With `only`, just the pairs
 * with one of those components.
 */
export function findClearance(kernel: Kernel, components: readonly InterferenceComponent[], shapeOf: (part: string) => ShapeId | null, least: number, only?: ReadonlySet<string>): ClearanceFound {
  const made: ShapeId[] = [];
  const found: ClearanceFound = { rows: [], checked: 0, unknown: [], failed: [] };
  try {
    const placed = place(kernel, components, shapeOf, made, found.unknown);
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const a = placed[i]!;
        const b = placed[j]!;
        if (only && !only.has(a.id) && !only.has(b.id)) continue;
        let best: ClearanceRow | null = null;
        try {
          for (const pa of a.parts) {
            for (const pb of b.parts) {
              if (apart(pa.box, pb.box, least)) continue;
              found.checked++;
              const d = kernel.distance(pa.shape, pb.shape);
              if (!best || d.distance < best.distance) best = { a: a.id, b: b.id, distance: d.distance, pointA: d.pointA, pointB: d.pointB, interferes: false };
            }
          }
          if (best && best.distance < least) {
            if (best.distance < 1e-9) {
              // a distance of nothing is touching or sharing volume: which, is the interference's question
              for (const pa of a.parts) {
                for (const pb of b.parts) {
                  if (best.interferes || apart(pa.box, pb.box, 0)) continue;
                  const common = kernel.common(pa.shape, pb.shape, MIN_INTERFERENCE_VOLUME);
                  if (common.shape !== null) {
                    kernel.release(common.shape);
                    best.interferes = true;
                  }
                }
              }
            }
            found.rows.push(best);
          }
        } catch (e) {
          found.failed.push({ a: a.id, b: b.id, message: e instanceof Error ? e.message : String(e) });
        }
      }
    }
    found.rows.sort((x, y) => x.distance - y.distance);
    return found;
  } finally {
    for (const id of made) kernel.release(id);
  }
}

export interface SweepResult {
  /** How far the component can move along the direction before it meets something (mm), at most the length asked. */
  travel: number;
  /** It met something before the length: what, and (the least of) the others it would meet there. */
  blocker: string | null;
  /** It was in contact with something it would go into at the start, so it cannot move at all that way. */
  startsInside: boolean;
  /** The kernel was asked about a position this many times. */
  steps: number;
  /** The search stopped before it was sure (too many steps): `travel` is a position known to be free, the contact is further. */
  approximate: boolean;
}

/**
 * Space to take a component out (E2.2): how far it can move along a direction before it hits another component. It moves in steps as long as its distance
 * to the others (which no move shorter than that can close) and never less than `length / 200`, and where a step would take it into something the contact is
 * found by halving. A part that only touches, sliding along a face, is free; a thin obstacle (under the least step) can be passed when the part
 * is touching something else all the way.
 */
export function sweepClearance(kernel: Kernel, components: readonly InterferenceComponent[], mover: string, dir: Vec3, length: number, shapeOf: (part: string) => ShapeId | null, tolerance = 1e-4): SweepResult {
  const made: ShapeId[] = [];
  const unknown: string[] = [];
  const result: SweepResult = { travel: length, blocker: null, startsInside: false, steps: 0, approximate: false };
  try {
    const norm = Math.hypot(...dir);
    if (!(norm > 0) || !(length > 0)) return { ...result, travel: 0 };
    const u: Vec3 = [dir[0] / norm, dir[1] / norm, dir[2] / norm];
    const moving = components.find((c) => c.id === mover);
    if (!moving) throw new KernelError(`no component ${mover}`);
    const others = place(kernel, components.filter((c) => c.id !== mover), shapeOf, made, unknown).flatMap((c) => c.parts.map((p) => ({ id: c.id, ...p })));
    const at = (s: number): { shape: ShapeId; box: Box }[] =>
      moving.parts.flatMap((p) => {
        const base = shapeOf(p.part);
        if (base === null) return [];
        const pose: Pose = { position: [p.pose.position[0] + u[0] * s, p.pose.position[1] + u[1] * s, p.pose.position[2] + u[2] * s], rotation: p.pose.rotation };
        const shape = kernel.transformed(base, placementRows(pose, p.mirrored));
        made.push(shape);
        return [{ shape, box: kernel.bounds(shape) }];
      });
    const first = at(0);
    const last = at(length);
    // what the part can meet along the way: the others whose boxes meet the box it sweeps
    const sweep = first.length === 0 ? null : first.map((f, i) => grow(f.box, last[i]!.box)).reduce(grow);
    const relevant = sweep ? others.filter((o) => !apart(o.box, sweep, 0)) : [];
    if (relevant.length === 0) return result;
    /** The first other the part at `s` goes into, or null. */
    const penetrates = (parts: { shape: ShapeId; box: Box }[]): string | null => {
      for (const o of relevant) {
        for (const p of parts) {
          if (apart(o.box, p.box, 0)) continue;
          const common = kernel.common(p.shape, o.shape, MIN_INTERFERENCE_VOLUME);
          if (common.shape !== null) {
            kernel.release(common.shape);
            return o.id;
          }
        }
      }
      return null;
    };
    const nearest = (parts: { shape: ShapeId; box: Box }[]): number => {
      let d = Infinity;
      for (const o of relevant) for (const p of parts) if (!apart(o.box, p.box, d)) d = Math.min(d, kernel.distance(p.shape, o.shape).distance);
      return d;
    };
    const inside = penetrates(first);
    if (inside) return { ...result, travel: 0, blocker: inside, startsInside: true };
    const minStep = length / 200;
    let s = 0;
    for (let i = 0; i < 400; i++) {
      result.steps++;
      const parts = i === 0 ? first : at(s);
      const d = nearest(parts);
      if (s + d >= length - tolerance) return { ...result, travel: length };
      const next = Math.min(length, s + Math.max(d, minStep));
      const there = at(next);
      const hit = penetrates(there);
      if (hit) {
        // the contact is between `s` (free) and `next` (inside)
        let lo = s;
        let hi = next;
        while (hi - lo > tolerance) {
          const mid = (lo + hi) / 2;
          if (penetrates(at(mid))) hi = mid;
          else lo = mid;
          result.steps++;
        }
        return { ...result, travel: lo, blocker: hit };
      }
      s = next;
      if (s >= length - tolerance) return { ...result, travel: length };
    }
    return { ...result, travel: s, approximate: true };
  } finally {
    for (const id of made) kernel.release(id);
  }
}
