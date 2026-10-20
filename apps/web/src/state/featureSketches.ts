import type { Feature, Id } from '@3db/model';

/**
 * The sketches a feature uses to build its geometry: the tree shows them under it, and 「編輯草圖」 of the feature's right-click menu (in the tree or on its
 * faces in the graphics area, ADR 0176) opens the first of them.
 */
export function consumedSketchesOf(f: Feature): Id[] {
  switch (f.type) {
    case 'extrude':
    case 'revolve':
    case 'hole':
    case 'rib':
    case 'vent':
    case 'splitLine':
    case 'trimSurface':
    case 'baseFlange':
    case 'midBend':
    case 'jog':
    case 'snapHook':
    case 'snapCatch':
      return f.sketch ? [f.sketch] : [];
    case 'sweep':
      return [f.sketch, f.path].filter((x): x is Id => !!x);
    case 'thread':
      return f.sketch ? [f.sketch] : [];
    case 'loft':
      return [...f.sections];
    default:
      return [];
  }
}
