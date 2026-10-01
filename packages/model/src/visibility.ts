import { isDatumPlaneName } from './datums';
import type { Id } from './ids';
import type { PartDoc } from './schema';

/** The part's origin, as a key of `PartDoc.visibility` (D4.6). */
export const ORIGIN_KEY = 'origin';

/** A body's key in PartDoc.visibility (C7.1, D4.6): ody: and its id, which cannot be mistaken for a feature's id. */
export const bodyKey = (id: Id): string => `body:${id}`;
export const isBodyKey = (key: string): boolean => key.startsWith('body:');

/**
 * The feature a body comes from. A body is named by the feature that made it (extrude1); the pieces a cut leaves are
 * <cut>#2, #3 … after the largest, which keeps the body's own id.
 */
export const bodyFeature = (id: Id): Id => id.split('#')[0]!;

/** Can this key be shown or hidden? A sketch or reference plane of the document, a default plane, the origin, or a body. */
export function isHideable(doc: PartDoc, key: string): boolean {
  if (key === ORIGIN_KEY || isDatumPlaneName(key) || isBodyKey(key)) return true;
  const f = doc.features.find((x) => x.id === key);
  return f?.type === 'sketch' || f?.type === 'refPlane';
}

/**
 * Where nothing was chosen. As in SolidWorks: a sketch a feature has used is hidden (it is now part of
 * the feature), an unused one is shown; reference planes and the origin are shown; the three default
 * planes are hidden, and appear only while selected or referenced.
 */
export function shownByDefault(doc: PartDoc, key: string): boolean {
  if (isDatumPlaneName(key)) return false;
  const f = doc.features.find((x) => x.id === key);
  if (f?.type === 'sketch') return !doc.features.some((g) => (g.type === 'extrude' || g.type === 'revolve') && g.sketch === key);
  return true;
}

export function isShown(doc: PartDoc, key: Id): boolean {
  return doc.visibility[key] ?? shownByDefault(doc, key);
}
