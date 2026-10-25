import { isDatumPlaneName } from './datums';
import type { Id } from './ids';
import type { Feature, PartDoc } from './schema';

/** The part's origin, as a key of `PartDoc.visibility` (D4.6). */
export const ORIGIN_KEY = 'origin';

/** A body's key in PartDoc.visibility (C7.1, D4.6): body: and its id, which cannot be mistaken for a feature's id. */
export const bodyKey = (id: Id): string => `body:${id}`;
export const isBodyKey = (key: string): boolean => key.startsWith('body:');

/**
 * The feature a body comes from. A body is named by the feature that made it (extrude1); the pieces a cut leaves are
 * <cut>#2, #3 … after the largest, which keeps the body's own id.
 */
export const bodyFeature = (id: Id): Id => id.split('#')[0]!;

/** Can this key be shown or hidden? A sketch or reference geometry of the document, a default plane, the origin, or a body. */
export function isHideable(doc: PartDoc, key: string): boolean {
  if (key === ORIGIN_KEY || isDatumPlaneName(key) || isBodyKey(key)) return true;
  const f = doc.features.find((x) => x.id === key);
  return f?.type === 'sketch' || f?.type === 'refPlane' || f?.type === 'refAxis' || f?.type === 'refPoint' || f?.type === 'coordSys';
}

/**
 * The sketches a feature absorbs: the ones it is built from, which then sit under it in the tree and are hidden by
 * default. Every feature type is listed, so a new one does not compile until it is decided here. A sketch used only
 * through a reference (a plane normal to one of its lines, a sketch following it, a helix on its circle) is not absorbed.
 */
export function absorbedSketches(f: Feature): Id[] {
  switch (f.type) {
    case 'extrude':
    case 'revolve':
    case 'hole':
    case 'rib':
    case 'vent':
    case 'splitLine':
    case 'trimSurface':
    case 'screwBoss':
    case 'baseFlange':
    case 'midBend':
    case 'jog':
    case 'snapHook':
    case 'snapCatch':
      return [f.sketch];
    case 'thread':
      return f.sketch ? [f.sketch] : [];
    case 'sweep':
      return [f.sketch, f.path];
    case 'loft':
      return [...f.sections];
    case 'sketch':
    case 'pattern':
    case 'mirror':
    case 'offsetSurface':
    case 'knit':
    case 'fillSurface':
    case 'flatSurface':
    case 'mutualTrim':
    case 'extendSurface':
    case 'thicken':
    case 'lipGroove':
    case 'edgeFlange':
    case 'breakCorner':
    case 'hem':
    case 'cutWithSurface':
    case 'fillet':
    case 'chamfer':
    case 'refPlane':
    case 'refAxis':
    case 'refPoint':
    case 'coordSys':
    case 'importedBody':
    case 'sheetUnfold':
    case 'sheetRefold':
    case 'derivedBody':
    case 'deleteFace':
    case 'moveFace':
    case 'shell':
    case 'draft':
    case 'combine':
    case 'split':
    case 'moveCopyBody':
    case 'deleteKeepBody':
    case 'knurl':
    case 'cosmeticThread':
    case 'gear':
    case 'rack':
    case 'ruledSurface':
    case 'radiatedSurface':
    case 'replaceFace':
    case 'projectedCurve':
    case 'helix':
      return [];
    default: {
      const unlisted: never = f;
      return unlisted;
    }
  }
}

/**
 * Where nothing was chosen. As in SolidWorks: a sketch a feature has absorbed is hidden (it is now part of
 * the feature), any other one is shown; reference planes and the origin are shown; the three default
 * planes are hidden, and appear only while selected or referenced.
 */
export function shownByDefault(doc: PartDoc, key: string): boolean {
  if (isDatumPlaneName(key)) return false;
  const f = doc.features.find((x) => x.id === key);
  if (f?.type === 'sketch') return !doc.features.some((g) => absorbedSketches(g).includes(key));
  return true;
}

export function isShown(doc: PartDoc, key: Id): boolean {
  return doc.visibility[key] ?? shownByDefault(doc, key);
}
