import { isDatumPlaneName } from './datums';
import type { Id } from './ids';
import type { PartDoc } from './schema';

/** The part's origin, as a key of `PartDoc.visibility` (D4.6). */
export const ORIGIN_KEY = 'origin';

/** Can this key be shown or hidden? A sketch or reference plane of the document, a default plane, or the origin. */
export function isHideable(doc: PartDoc, key: string): boolean {
  if (key === ORIGIN_KEY || isDatumPlaneName(key)) return true;
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
