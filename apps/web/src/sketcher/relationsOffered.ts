import { isSketchAxis, SKETCH_ORIGIN, type Id, type SketchConstraint, type SketchFeature } from '@3db/model';
import { applicableRelations, constraintsOf, sameRelation, type RelationBody } from '@3db/sketch/interact';
import type { SketchSolvePayload } from '../worker/protocol';

/**
 * 「加入限制條件」 for what is selected in a sketch (C1.26): the entities among the selection (the sketch's origin and axes count, ADR 0170), the relations
 * they already have, and the ones that can still be added. The PropertyManager's buttons and the right-click menu (ADR 0176) offer the same list.
 */
export function relationsOffered(f: SketchFeature, solve: Pick<SketchSolvePayload, 'geometry'> | null, selection: readonly Id[]): { entityIds: Id[]; existing: SketchConstraint[]; offered: RelationBody[] } {
  const entityIds = selection.filter((id) => id === SKETCH_ORIGIN || isSketchAxis(id) || f.entities.some((e) => e.id === id));
  const existing = constraintsOf(f.constraints, entityIds);
  const offered = solve ? applicableRelations(solve.geometry, entityIds, f).filter((r) => !existing.some((c) => sameRelation(c, r))) : [];
  return { entityIds, existing, offered };
}
