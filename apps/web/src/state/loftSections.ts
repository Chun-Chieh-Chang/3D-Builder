import type { Id, PartDoc, SketchFeature } from '@3db/model';

/** Earlier, unsuppressed sketches with profile curves; closed-outline validity is checked by regeneration. */
export function loftSectionCandidates(doc: PartDoc): SketchFeature[] {
  return doc.features.filter((feature, index): feature is SketchFeature => index < (doc.rollbackIndex ?? doc.features.length) && feature.type === 'sketch' && !feature.suppressed && feature.entities.some(entity => entity.type !== 'point' && entity.type !== 'text' && !entity.construction));
}

/** Keep the selected sketch as the last section; without one use the latest two in feature order. */
export function initialLoftSections(doc: PartDoc, selected: Id | null): Id[] {
  const candidates = loftSectionCandidates(doc);
  const last = candidates.find(sketch => sketch.id === selected) ?? candidates.at(-1);
  if (!last) return [];
  const first = candidates.slice().reverse().find(sketch => sketch.id !== last.id);
  return first ? [first.id, last.id] : [last.id];
}
