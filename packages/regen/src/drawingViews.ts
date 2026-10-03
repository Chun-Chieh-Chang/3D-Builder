import type { Kernel, ProjectedView, ShapeId } from '@3db/kernel';
import { placementRows, type Pose, type ViewAxes } from '@3db/model';

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
export function projectDrawingView(kernel: Kernel, parts: readonly ViewPart[], axes: ViewAxes, cut?: { origin: [number, number, number]; normal: [number, number, number] }): ProjectedView {
  const made: ShapeId[] = [];
  try {
    const placed = parts.map((p) => {
      const shape = kernel.transformed(p.shape, placementRows(p.pose, p.mirrored));
      made.push(shape);
      return shape;
    });
    const whole = placed.length === 1 ? placed[0]! : kernel.join(placed);
    if (placed.length !== 1) made.push(whole);
    return cut ? kernel.sectionView(whole, cut, axes.up) : kernel.projectView(whole, axes);
  } finally {
    for (const id of made) kernel.release(id);
  }
}
