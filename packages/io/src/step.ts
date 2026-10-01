import type { Kernel, ShapeId, StepExportOptions } from '@3db/kernel';
import type { Pose } from '@3db/model';

/**
 * STEP export of a part (F1.1, F1.3): one body or the bodies that count put together, its product named after the part, AP214 or AP242, with the colors
 * of its faces. `place` moves the shape first (a coordinate system's frame to the origin, C3.4): a 3 × 4 motion as `Kernel.transformed` takes it.
 */
export function exportPartStep(kernel: Kernel, bodies: ShapeId | readonly ShapeId[], name: string, options: StepExportOptions & { place?: readonly number[] } = {}): string {
  const list = Array.isArray(bodies) ? (bodies as readonly ShapeId[]) : [bodies as ShapeId];
  const made: ShapeId[] = [];
  try {
    let shape = list.length === 1 ? list[0]! : kernel.join([...list]);
    if (list.length !== 1) made.push(shape);
    if (options.place) {
      shape = kernel.transformed(shape, options.place);
      made.push(shape);
    }
    const { place: _place, ...step } = options;
    return kernel.exportStep(shape, name, 'MM', step);
  } finally {
    for (const id of made) kernel.release(id);
  }
}

/** A part of an assembly export: its body and the name of its product (the file's name). */
export interface StepPart {
  shape: ShapeId;
  name: string;
}

/** A component of an assembly export: an index of the parts, its name in the tree, and where it is. */
export interface StepInstance {
  part: number;
  name: string;
  pose: Pose;
}

/** STEP AP214 export of an assembly (F1.2): one product per part, one placed component per instance, one level. */
export function exportAssemblyStep(kernel: Kernel, name: string, parts: readonly StepPart[], instances: readonly StepInstance[]): string {
  return kernel.exportAssemblyStep(
    name,
    parts,
    instances.map((i) => ({ part: i.part, name: i.name, position: i.pose.position, rotation: i.pose.rotation })),
  );
}
