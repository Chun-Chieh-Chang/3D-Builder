import type { Translation } from '../index';

/** viewport: wording of the app that used to be in the code (D9.1). */
export const viewport: Translation = {
  'pick.edges': 'Pick edges to add to the {what}',
  'pick.filletGroups': 'Pick faces; they go into the group selected in the panel on the left (click a picked face again to take it away)',
  'pick.edgesOrFaces': 'Pick edges or faces to add to the {what} (a face stands for all its edges)',
  'sketch.exitKeep': 'Exit sketch (keep the changes)',
  'sketch.pictureFailed': 'Could not add the picture: {why}',
  'sketch.pictureNotImage': '"{name}" is not a PNG or a JPEG image (a sketch picture takes those two)',
  'sketch.pictureScaleBad': 'The two points cannot be the same point, and the real distance has to be more than 0',
  'sketch.exitDiscard': 'Discard the changes and exit the sketch',
  'boot.failed': 'The geometry kernel failed to load: {why}',
  'boot.loading': 'Loading the geometry kernel (OCCT WASM, about 43 MB)…',
  'hover.name': 'Persistent name:',
  'hover.face': 'Face:',
  'hover.selected': 'Face selected:',
  'hover.canSketch': 'Press Sketch on the Sketch tab to draw on this face.',
  'hover.notPlanar': '(not planar; a sketch cannot go on it)',
};
