import type { Kernel, ProjectedView, ShapeId } from '@3db/kernel';
import { placementRows, rightOf, sheetUp, type Pose, type SectionCut, type ViewAxes } from '@3db/model';

/** A part of what a view shows: its shape as built, where it is (identity for a part drawn alone) and whether it is the mirror of the file's part. */
export interface ViewPart {
  shape: ShapeId;
  pose: Pose;
  mirrored: boolean;
}

/**
 * What a drawing's view looks like (C16.2, C16.3): the parts put where they are, seen from the view's direction as lines (exact hidden-line removal), or cut
 * by a plane first and the outlines of the faces it cut given with them. Nothing made here outlives the call.
 */
export function projectDrawingView(kernel: Kernel, parts: readonly ViewPart[], axes: ViewAxes, cut?: SectionCut): ProjectedView {
  const made: ShapeId[] = [];
  try {
    const placed = parts.map((p) => {
      const shape = kernel.transformed(p.shape, placementRows(p.pose, p.mirrored));
      made.push(shape);
      return shape;
    });
    const whole = placed.length === 1 ? placed[0]! : kernel.join(placed);
    if (placed.length !== 1) made.push(whole);
    // a stepped or aligned section (D-I5) is cut along its whole line; a straight one by the plane of its line
    if (cut?.path) return kernel.sectionViewPath(whole, { normal: cut.normal, path: cut.path, ...(cut.aligned ? { aligned: true } : {}) }, axes.up);
    return cut ? kernel.sectionView(whole, cut, axes.up) : kernel.projectView(whole, axes);
  } finally {
    for (const id of made) kernel.release(id);
  }
}

/**
 * Where each part of a view is in it (C16.6): the middle of its mass, put where the part is and seen from `axes`, in the view's coordinates (x to the right,
 * y up), in the order of `parts`. What a balloon points at. A part with no volume has its place at the origin of the view.
 */
export function drawingAnchors(kernel: Kernel, parts: readonly ViewPart[], axes: ViewAxes): [number, number][] {
  const right = rightOf(axes);
  const up = sheetUp(axes);
  return parts.map((p) => {
    const shape = kernel.transformed(p.shape, placementRows(p.pose, p.mirrored));
    try {
      const c = kernel.massProps(shape).center;
      const x = c[0] * right[0] + c[1] * right[1] + c[2] * right[2];
      const y = c[0] * up[0] + c[1] * up[1] + c[2] * up[2];
      return Number.isFinite(x) && Number.isFinite(y) ? ([x, y] as [number, number]) : ([0, 0] as [number, number]);
    } finally {
      kernel.release(shape);
    }
  });
}
