import { entityPoints, SKETCH_AXIS_H, SKETCH_ORIGIN, type DimensionConstraint, type Id, type IdAllocator, type SketchFeature } from '@3db/model';
import { add, angleRays, cross, dist, geometryOf, pointOf, smartDimension, sub, unit } from './interact';
import type { SolvedSketch } from './types';

export interface AutoDimensionPreferences {
  x: boolean;
  y: boolean;
  radial: boolean;
  angle: boolean;
}

export interface AutoDimensionRow {
  dimension: DimensionConstraint;
  accepted: boolean;
}

type Solve = Pick<SolvedSketch, 'geometry' | 'status' | 'dof' | 'entityFreedom' | 'conflicting' | 'redundant'>;
const TOLERANCE = 1e-7;
export const AUTO_DIMENSION_LIMIT = 48;

export function autoDimensionDatums(sketch: SketchFeature, geometry: Solve['geometry']): Id[] {
  return [SKETCH_ORIGIN, ...sketch.entities.flatMap((e) => {
    if (e.type !== 'line' || !e.construction) return [];
    const g = geometry.get(e.id);
    if (g?.type !== 'line' || dist(g.a, g.b) <= TOLERANCE) return [];
    const direction = unit(sub(g.b, g.a));
    return Math.min(Math.abs(direction[0]), Math.abs(direction[1])) <= TOLERANCE ? [e.id] : [];
  })];
}

export function autoDimensionCandidates(
  sketch: SketchFeature, solved: Solve, datum: Id, preferences: AutoDimensionPreferences, ids: IdAllocator,
): DimensionConstraint[] {
  if (solved.status !== 'under' || !solved.entityFreedom || !autoDimensionDatums(sketch, solved.geometry).includes(datum)) return [];
  const geometry = solved.geometry;
  const referenceId = datum === SKETCH_ORIGIN ? SKETCH_AXIS_H : datum;
  const reference = geometryOf(geometry, referenceId);
  if (reference?.type !== 'line') return [];
  const anchor = datum === SKETCH_ORIGIN ? datum : reference.p1;
  const origin = pointOf(geometry, anchor);
  if (!origin) return [];
  const result: DimensionConstraint[] = [];
  const seen = new Set<Id>();
  const standalone = new Set(sketch.entities.filter(e => e.type === 'point').map(e => e.id));
  for (const e of sketch.entities) if (e.type !== 'point') for (const id of entityPoints(e)) standalone.delete(id);
  for (const e of sketch.entities) {
    if (result.length >= AUTO_DIMENSION_LIMIT) break;
    if (e.type !== 'line' && e.type !== 'arc' && e.type !== 'circle' && !standalone.has(e.id)) continue;
    const free = solved.entityFreedom.get(e.id);
    if (!free) continue;
    const g = geometry.get(e.id);
    const append = (proposal: ReturnType<typeof smartDimension>) => {
      if (proposal && Number.isFinite(proposal.value) && proposal.value > TOLERANCE) {
        result.push({ ...proposal.body, id: ids.take('d'), value: String(proposal.value) });
      }
    };
    if (preferences.radial && free.radius && (g?.type === 'arc' || g?.type === 'circle')) append(smartDimension(geometry, [e.id], g.c));
    if (preferences.angle && g?.type === 'line' && e.id !== datum) {
      const a = unit(sub(reference.b, reference.a)), b = unit(sub(g.b, g.a));
      if (Math.abs(cross(a, b)) >= 1e-6) {
        const { vertex } = angleRays(reference, g, undefined);
        append(smartDimension(geometry, [referenceId, e.id], add(vertex, add(a, b))));
      }
    }
    for (const { id } of free.points) {
      if (id === anchor || seen.has(id)) continue;
      seen.add(id);
      const point = pointOf(geometry, id);
      if (!point) continue;
      for (const axis of [0, 1] as const) {
        const value = Math.abs(point[axis] - origin[axis]);
        if ((axis === 0 ? preferences.x : preferences.y) && value > TOLERANCE && Number.isFinite(value)) {
          result.push({ id: ids.take('d'), type: axis === 0 ? 'distanceX' : 'distanceY', a: anchor, b: id, value: String(value) });
        }
      }
    }
  }
  return result.slice(0, AUTO_DIMENSION_LIMIT);
}

export function acceptsAutoDimensions(baseline: Solve, result: Solve, before = baseline.dof): boolean {
  if ((result.status !== 'under' && result.status !== 'fully') || result.dof >= before || result.conflicting.length || result.redundant.length) return false;
  for (const [id, original] of baseline.geometry) {
    const g = result.geometry.get(id);
    if (g?.type !== original.type) return false;
    if (original.type === 'point' && g.type === 'point' && dist(g.p, original.p) > TOLERANCE) return false;
    if (original.type === 'circle' && g.type === 'circle' && Math.abs(g.r - original.r) > TOLERANCE) return false;
  }
  return true;
}

export async function trialAutoDimensions(
  candidates: DimensionConstraint[], baseline: Solve, trial: (constraints: DimensionConstraint[]) => Promise<Solve>,
  active: () => boolean = () => true,
): Promise<AutoDimensionRow[]> {
  const rows: AutoDimensionRow[] = [];
  const chosen: DimensionConstraint[] = [];
  let dof = baseline.dof;
  for (const dimension of candidates) {
    if (!active()) return [];
    if (dof === 0) break;
    const result = await trial([...chosen, dimension]);
    const accepted = acceptsAutoDimensions(baseline, result, dof);
    if (accepted) {
      dof = result.dof;
      chosen.push(dimension);
    }
    rows.push({ dimension, accepted });
  }
  return active() ? rows : [];
}
