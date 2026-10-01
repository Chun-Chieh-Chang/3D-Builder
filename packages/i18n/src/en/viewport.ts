import type { Translation } from '../index';

/** viewport: wording of the app that used to be in the code (D9.1). */
export const viewport: Translation = {
  'pick.edges': 'Pick edges to add to the {what}',
  'sketch.exitKeep': 'Exit sketch (keep the changes)',
  'sketch.exitDiscard': 'Discard the changes and exit the sketch',
  'boot.failed': 'The geometry kernel failed to load: {why}',
  'boot.loading': 'Loading the geometry kernel (OCCT WASM, about 43 MB)…',
  'hover.name': 'Persistent name:',
  'hover.face': 'Face:',
  'hover.selected': 'Face selected:',
  'hover.canSketch': 'Press Sketch on the Sketch tab to draw on this face.',
  'hover.notPlanar': '(not planar; a sketch cannot go on it)',
};
