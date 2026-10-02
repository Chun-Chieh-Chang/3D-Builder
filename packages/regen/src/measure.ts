import { t } from '@3db/i18n';
import { KernelError, type Kernel, type ShapeId } from '@3db/kernel';
import { edgeElement, faceElement, measureReport, placementRows, vertexElement, type MeasureElement, type MeasureReport, type MeasureTarget } from '@3db/model';

/**
 * Measures one or two elements (E1.1): each part is put where the assembly has it (before anything is read from it, so every number is in the
 * assembly's frame), the element's facts are read from its topology, and for two the kernel finds the exact shortest distance between them.
 * `shapeOf` gives the part's own shape (null: it is not built); nothing is kept, what is made here is released.
 */
export function measureTargets(kernel: Kernel, shapeOf: (target: MeasureTarget) => ShapeId | null, targets: readonly MeasureTarget[]): MeasureReport {
  if (targets.length < 1 || targets.length > 2) throw new KernelError(t('measure.count'));
  const made: ShapeId[] = [];
  try {
    const subs = targets.map((target) => {
      const base = shapeOf(target);
      if (base === null) throw new KernelError(t('measure.noElement'));
      let placed = base;
      if (target.pose || target.mirrored) {
        placed = kernel.transformed(base, placementRows(target.pose ?? { position: [0, 0, 0], rotation: [0, 0, 0, 1] }, target.mirrored));
        made.push(placed);
      }
      const topology = kernel.topology(placed);
      const element: MeasureElement | null =
        target.kind === 'face' ? (topology.faces[target.index] ? faceElement(topology.faces[target.index]!) : null) : target.kind === 'edge' ? (topology.edges[target.index] ? edgeElement(topology.edges[target.index]!) : null) : topology.vertices[target.index] ? vertexElement(topology.vertices[target.index]!) : null;
      if (!element) throw new KernelError(t('measure.noElement'));
      return { element, placed };
    });
    let distance = null;
    if (subs.length === 2) {
      const [a, b] = subs.map((s, i) => {
        const sub = kernel.subShape(s.placed, targets[i]!.kind, targets[i]!.index);
        made.push(sub);
        return sub;
      });
      distance = kernel.distance(a!, b!);
    }
    return measureReport(
      subs.map((s) => s.element),
      distance,
    );
  } finally {
    for (const id of made) kernel.release(id);
  }
}
