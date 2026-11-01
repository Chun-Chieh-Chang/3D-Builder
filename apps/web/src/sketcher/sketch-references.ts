import { mapRefs, modelRefOf, type Id, type Ref, type SketchEntity, type SketchFeature } from '@3db/model';
import type { Candidate } from '@3db/naming';

/**
 * The model references of a sketch as a list (G15, P4): what each follows, what following it means, and — when the rebuild could
 * not resolve it — why, with the candidates the resolver found near where the reference used to be. Pure: the same inputs say the same.
 */
export interface UnresolvedRef {
  ref: Ref;
  reason: 'missing' | 'ambiguous';
  candidates: Candidate[];
}

export interface ReferenceRow {
  entityId: Id;
  ref: Ref;
  /** The i18n key of what following this reference means (聯動/貫穿/投影). */
  semantic: 'reference.semantic.pierce' | 'reference.semantic.vertex' | 'reference.semantic.edge' | 'reference.semantic.datum' | 'reference.semantic.sketch' | 'reference.semantic.silhouette';
  state: 'ok' | 'failed';
  reason?: 'missing' | 'ambiguous';
  candidates?: Candidate[];
}

/** What following one reference means (G15): the key the panel renders for it. */
function semanticOf(e: SketchEntity, ref: Ref): ReferenceRow['semantic'] {
  if (e.type === 'point' && e.pierce) return 'reference.semantic.pierce';
  if (ref.kind === 'vertex') return 'reference.semantic.vertex';
  if (ref.kind === 'datum') return 'reference.semantic.datum';
  if (ref.kind === 'sketch') return 'reference.semantic.sketch';
  if (ref.kind === 'face') return 'reference.semantic.silhouette';
  return 'reference.semantic.edge';
}

export function referenceRows(sketch: SketchFeature, unresolved: readonly UnresolvedRef[]): ReferenceRow[] {
  const byRef = new Map(unresolved.map((u) => [u.ref.name, u]));
  return sketch.entities.flatMap((e) => {
    const ref = modelRefOf(e);
    if (!ref) return [];
    const broken = byRef.get(ref.name);
    return [
      {
        entityId: e.id,
        ref,
        semantic: semanticOf(e, ref),
        state: broken ? 'failed' : 'ok',
        ...(broken ? { reason: broken.reason, candidates: broken.candidates } : {}),
      },
    ];
  });
}

/** The same reference, as `replaceRef` (B4.3) stores it. */
const sameRef = (a: Ref, b: Ref): boolean => a.kind === b.kind && a.name === b.name && a.silhouette === b.silhouette;

/**
 * The sketch with one reference replaced (G15): what a trial solve runs on before anything is committed.
 * The replacement keeps the lost reference's kind (the candidates are that kind of element); everything
 * else — entities, relations, dimensions — is untouched.
 */
export function withReplacedRef(sketch: SketchFeature, from: Ref, candidate: { name: string; fingerprint?: unknown }): SketchFeature {
  const next = { kind: from.kind, name: candidate.name, ...(typeof candidate.fingerprint === 'object' && candidate.fingerprint !== null ? { fingerprint: candidate.fingerprint } : {}) } as Ref;
  return mapRefs(sketch, (ref) => (sameRef(ref, from) ? next : ref)).feature as SketchFeature;
}
