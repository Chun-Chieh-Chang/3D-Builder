import type { Kernel, ShapeId, StepExportOptions } from '@3db/kernel';
import { dirName, joinPath, type AssemblyDoc, type Id, type InnerPoses, type Pose, type SourceTree } from '@3db/model';
import { componentName, partNameOf } from './names';

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

/**
 * A component of an assembly export: an index of the parts (`part`) or of the sub-assemblies (`sub`), its name in the
 * tree, and where it is (in the frame of the assembly it is a component of).
 */
export interface StepInstance {
  part?: number;
  sub?: number;
  name: string;
  pose: Pose;
}

/** A sub-assembly of an assembly export (C15.4): written once as a product, however many components use it. May use the sub-assemblies before it. */
export interface StepSub {
  name: string;
  instances: readonly StepInstance[];
}

const component = (i: StepInstance) => ({ ...(i.part !== undefined ? { part: i.part } : {}), ...(i.sub !== undefined ? { sub: i.sub } : {}), name: i.name, position: i.pose.position, rotation: i.pose.rotation });

/** STEP AP214 export of an assembly (F1.2): one product per part and per sub-assembly, one placed component per instance, down through the sub-assemblies. */
export function exportAssemblyStep(kernel: Kernel, name: string, parts: readonly StepPart[], instances: readonly StepInstance[], subs: readonly StepSub[] = []): string {
  return kernel.exportAssemblyStep(
    name,
    parts,
    instances.map(component),
    'MM',
    subs.map((s) => ({ name: s.name, instances: s.instances.map(component) })),
  );
}

/** What an assembly export is made of, before it is written: the parts (by their content key), the sub-assemblies, the components of the top level, and files that cannot be used. */
export interface StepStructure {
  parts: { key: string; name: string }[];
  subs: StepSub[];
  instances: StepInstance[];
  /** Files (project paths) a component of the export needs and does not have, with why: nothing is left out silently. */
  unreadable: { path: string; why: string }[];
}

/**
 * The structure of an assembly's STEP (F1.2, C15.4): each part file once as a part (its product is named after the file), each
 * sub-assembly file once as a sub-assembly (its product is named after the file, its components placed where its own mates
 * left them: `inner`), each component of every level placed by its pose. Suppressed components are left out (C15.5); hidden
 * ones are in the assembly and so in its file. `trees` says what each component is (a part by its key, a sub-assembly and what is in it);
 * `fileOf` finds a component's file name: the files of `doc` start at `folder`, those of a sub-assembly at its own folder.
 */
export function stepStructure(
  doc: AssemblyDoc,
  folder: string,
  trees: Readonly<Record<Id, SourceTree>>,
  poseOf: (componentId: Id) => Pose | null,
  inner: ReadonlyMap<Id, InnerPoses> | undefined,
  status: (path: string) => string | null,
): StepStructure {
  const parts: StepStructure['parts'] = [];
  const subs: StepSub[] = [];
  const unreadable: StepStructure['unreadable'] = [];
  const partIndex = new Map<string, number>();
  const subIndex = new Map<string, number>();
  const note = (path: string) => {
    if (!unreadable.some((u) => u.path === path)) unreadable.push({ path, why: status(path) ?? '' });
  };

  /** The components of `at` (a document in the folder `where`), placed by `poses`; a sub-assembly one goes through `addSub`. */
  const components = (at: AssemblyDoc, where: string, trees: Readonly<Record<Id, SourceTree>>, pose: (id: Id) => Pose | null, below: ReadonlyMap<Id, InnerPoses> | undefined): StepInstance[] => {
    const out: StepInstance[] = [];
    for (const c of at.components) {
      if (c.suppressed) continue;
      const file = at.files.find((f) => f.id === c.file);
      const path = file ? joinPath(where, file.path) : null;
      const tree = trees[c.id];
      const placement = pose(c.id);
      if (!file || !path || !tree || !placement) {
        note(path ?? c.file);
        continue;
      }
      const name = componentName(file.path, c.instance);
      if (tree.kind === 'part') {
        let index = partIndex.get(path);
        if (index === undefined) {
          index = parts.length;
          partIndex.set(path, index);
          parts.push({ key: tree.key, name: partNameOf(file.path) });
        }
        out.push({ part: index, name, pose: placement });
      } else {
        out.push({ sub: addSub(path, tree, below?.get(c.id)), name, pose: placement });
      }
    }
    return out;
  };

  /** A sub-assembly file as a product, once: its components where its own mates put them (the same for every use of it). */
  const addSub = (path: string, tree: Extract<SourceTree, { kind: 'assembly' }>, solved: InnerPoses | undefined): number => {
    const known = subIndex.get(path);
    if (known !== undefined) return known;
    const instances = components(tree.doc, dirName(path), tree.children, (id) => solved?.poses.get(id) ?? tree.doc.components.find((c) => c.id === id)?.placement ?? null, solved?.inner);
    const index = subs.length; // after the ones it uses, which were added while its components were made
    subIndex.set(path, index);
    subs.push({ name: partNameOf(path), instances });
    return index;
  };

  const instances = components(doc, folder, trees, poseOf, inner);
  return { parts, subs, instances, unreadable };
}
