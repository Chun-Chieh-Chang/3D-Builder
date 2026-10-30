import { KernelError, type IgesExportOptions, type Kernel, type ShapeId, type StepExportOptions } from '@3db/kernel';
import { t } from '@3db/i18n';
import { componentPatternInstances, composePose, dirName, joinPath, mirrorKey, mirroredInside, mirroredPose, type AssemblyDoc, type Id, type InnerPoses, type PatternAxis, type PatternLine, type Pose, type SourceTree } from '@3db/model';
import { componentName, partNameOf } from './names';

/**
 * A shape fit to be written (4b-5): the offset surfaces OCCT makes (an offset of a face or a solid) are a type other CAD programs may not read, so a shape that has
 * them is converted to B-splines (the same to 1e-4 mm, the faces in the order they were). If the converter stops (ADR 0067: an offset round a freeform edge) the shape is
 * written as it is: `failed` says so, for the caller to tell the user. `shape` is the caller's to release when `converted`.
 */
export function portableShape(kernel: Kernel, shape: ShapeId): { shape: ShapeId; converted: boolean; failed: boolean } {
  const faces = kernel.topology(shape).faces;
  if (!faces.some((f) => f.surface === 'offsetsurface')) return { shape, converted: false, failed: false };
  try {
    const nurbs = kernel.toBSpline(shape);
    if (kernel.topology(nurbs).faces.length === faces.length) return { shape: nurbs, converted: true, failed: false };
    kernel.release(nurbs);
  } catch (e) {
    if (!(e instanceof KernelError)) throw e;
  }
  return { shape, converted: false, failed: true };
}

/**
 * STEP export of a part (F1.1, F1.3): one body or the bodies that count put together, its product named after the part, AP214 or AP242, with the colors
 * of its faces. `place` moves the shape first (a coordinate system's frame to the origin, C3.4): a 3 × 4 motion as `Kernel.transformed` takes it.
 */
export function exportPartStep(kernel: Kernel, bodies: ShapeId | readonly ShapeId[], name: string, options: StepExportOptions & { place?: readonly number[]; warnings?: string[] } = {}): string {
  const { place, ...step } = options;
  return writePart(kernel, bodies, place, options.warnings, (shape) => kernel.exportStep(shape, name, 'MM', step));
}

/** IGES export of a part (F1.4): the bodies as for `exportPartStep`, written as trimmed surfaces or a B-rep solid, in millimetres or inches. */
export function exportPartIges(kernel: Kernel, bodies: ShapeId | readonly ShapeId[], name: string, options: IgesExportOptions & { unit?: 'MM' | 'INCH'; place?: readonly number[] } = {}): string {
  const { place, unit, ...iges } = options;
  return writePart(kernel, bodies, place, options.warnings, (shape) => kernel.exportIges(shape, name, unit ?? 'MM', iges));
}

/** The bodies made portable (`portableShape`), put together and placed, handed to `write`; what was made on the way is released after. */
function writePart(kernel: Kernel, bodies: ShapeId | readonly ShapeId[], place: readonly number[] | undefined, warnings: string[] | undefined, write: (shape: ShapeId) => string): string {
  const given = Array.isArray(bodies) ? (bodies as readonly ShapeId[]) : [bodies as ShapeId];
  const made: ShapeId[] = [];
  try {
    const fit = given.map((s) => portableShape(kernel, s));
    for (const f of fit) if (f.converted) made.push(f.shape);
    const stuck = fit.filter((f) => f.failed).length;
    if (stuck > 0) warnings?.push(t('export.offsetKept', { n: String(stuck) }));
    const list = fit.map((f) => f.shape);
    let shape = list.length === 1 ? list[0]! : kernel.join([...list]);
    if (list.length !== 1) made.push(shape);
    if (place) {
      shape = kernel.transformed(shape, place);
      made.push(shape);
    }
    return write(shape);
  } finally {
    for (const id of made) kernel.release(id);
  }
}

/** A part of an assembly export: its body and the name of its product (the file's name). */
export interface StepPart {
  shape: ShapeId;
  name: string;
  /** "#rrggbb" or null for each face of the shape, in the order of Kernel.topology (F1.3). */
  faceColors?: readonly (string | null)[];
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
export function exportAssemblyStep(kernel: Kernel, name: string, parts: readonly StepPart[], instances: readonly StepInstance[], subs: readonly StepSub[] = [], warnings?: string[]): string {
  return kernel.exportAssemblyStep(
    name,
    parts,
    instances.map(component),
    'MM',
    subs.map((s) => ({ name: s.name, instances: s.instances.map(component) })),
    warnings,
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
  /** Finds a pattern's direction or axis in the assembly (null: it is gone). Without it linear and circular patterns have no instances. */
  patterns?: { axisOf: (axis: PatternAxis) => PatternLine | null },
): StepStructure {
  const parts: StepStructure['parts'] = [];
  const subs: StepSub[] = [];
  const unreadable: StepStructure['unreadable'] = [];
  const partIndex = new Map<string, number>();
  const subIndex = new Map<string, number>();
  const note = (path: string) => {
    if (!unreadable.some((u) => u.path === path)) unreadable.push({ path, why: status(path) ?? '' });
  };

  /** The product a component's file stands for: its part (or the part's mirror), or its sub-assembly (or the sub-assembly's mirror), made once. */
  const protoOf = (file: { path: string }, path: string, tree: SourceTree, solved: InnerPoses | undefined, mirrored: boolean): { part?: number; sub?: number } => {
    if (tree.kind === 'part') {
      const at = mirrored ? `${path}:mx` : path;
      let index = partIndex.get(at);
      if (index === undefined) {
        index = parts.length;
        partIndex.set(at, index);
        parts.push(mirrored ? { key: mirrorKey(tree.key), name: `${partNameOf(file.path)}${t('pattern.mirrorSuffix')}` } : { key: tree.key, name: partNameOf(file.path) });
      }
      return { part: index };
    }
    return { sub: addSub(path, tree, solved, mirrored) };
  };

  /** The components of `at` (a document in the folder `where`), placed by `pose`; a mirrored sub-assembly has every part mirrored, at its pose seen through the mirror. */
  const components = (at: AssemblyDoc, where: string, trees: Readonly<Record<Id, SourceTree>>, pose: (id: Id) => Pose | null, below: ReadonlyMap<Id, InnerPoses> | undefined, mirrored = false): StepInstance[] => {
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
      out.push({ ...protoOf(file, path, tree, below?.get(c.id), mirrored), name: componentName(file.path, c.instance), pose: mirrored ? mirroredInside(placement) : placement });
    }
    return out;
  };

  /** A sub-assembly file as a product, once: its components where its own mates put them (the same for every use of it). */
  const addSub = (path: string, tree: Extract<SourceTree, { kind: 'assembly' }>, solved: InnerPoses | undefined, mirrored = false): number => {
    const at = mirrored ? `${path}:mx` : path;
    const known = subIndex.get(at);
    if (known !== undefined) return known;
    const instances = components(tree.doc, dirName(path), tree.children, (id) => solved?.poses.get(id) ?? tree.doc.components.find((c) => c.id === id)?.placement ?? null, solved?.inner, mirrored);
    const index = subs.length; // after the ones it uses, which were added while its components were made
    subIndex.set(at, index);
    subs.push({ name: `${partNameOf(path)}${mirrored ? t('pattern.mirrorSuffix') : ''}`, instances });
    return index;
  };

  const instances = components(doc, folder, trees, poseOf, inner);

  // The instances of the patterns and mirrors (C15.13): more uses of the seed's product, moved; a mirror uses the product's mirror.
  for (const p of doc.patterns ?? []) {
    const c = doc.components.find((x) => x.id === p.seed);
    const file = c && doc.files.find((f) => f.id === c.file);
    const tree = c && trees[c.id];
    const seedPose = c && poseOf(c.id);
    if (!c || c.suppressed || !file || !tree || !seedPose) continue;
    const path = joinPath(folder, file.path);
    const seedName = componentName(file.path, c.instance);
    const name = (label: string) => t('pattern.stepInstanceName', { seed: seedName, pattern: p.name, label });
    if (p.kind === 'mirror') {
      if (!p.plane) continue;
      instances.push({ ...protoOf(file, path, tree, inner?.get(c.id), true), name: name('m'), pose: mirroredPose(p.plane, seedPose) });
      continue;
    }
    const axis1 = p.axis1 && patterns?.axisOf(p.axis1);
    const axis2 = p.axis2 && patterns?.axisOf(p.axis2);
    if (!axis1 || (p.axis2 && !axis2)) continue; // the axis is gone: the pattern has no instances, as on the screen
    const made = componentPatternInstances(p, { axis1, ...(axis2 ? { axis2 } : {}) });
    if (typeof made === 'string') continue;
    const proto = protoOf(file, path, tree, inner?.get(c.id), false);
    for (const inst of made) instances.push({ ...proto, name: name(inst.label), pose: composePose(inst.motion, seedPose) });
  }
  return { parts, subs, instances, unreadable };
}
