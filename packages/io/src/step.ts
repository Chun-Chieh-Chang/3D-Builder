import type { Kernel, ShapeId } from '@3db/kernel';
import type { Pose } from '@3db/model';

/** STEP AP214 export of a part body (F1.1), its product named after the part. Colors via XCAF arrive with F1.3. */
export function exportPartStep(kernel: Kernel, body: ShapeId, name: string): string {
  return kernel.exportStep(body, name);
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
