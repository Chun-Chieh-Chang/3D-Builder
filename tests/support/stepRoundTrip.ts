/**
 * The way an assembly STEP goes round in the tests of 3b-3 and 3b-7: written as STEP → read into files (`stepAssemblyFiles`) → opened the way the app opens
 * a project (files read, parts rebuilt, assemblies solved from their placements) → written out as STEP again. What comes back is compared with what went in
 * through `readAssemblyTree`, which reads the text the way another CAD system would.
 */
import { dirName, joinPath, type SourceTree } from '@3db/model';
import { exportAssemblyStep, readDocumentFile, stepAssemblyFiles, stepAssemblyPlan, stepStructure, type StepAssemblyFiles } from '@3db/io';
import type { PlaneGcsSolver } from '@3db/sketch';
import type { Kernel, ShapeId } from '@3db/kernel';
import { Regenerator, solveAssemblyTree } from '@3db/regen';
import type { StepNode } from './readAssemblyStep';

export type Frame = { matrix: number[]; origin: number[] };
const IDENTITY: Frame = { matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], origin: [0, 0, 0] };

/** `child` placed in the frame of `parent`. */
export function compose(parent: Frame, child: Frame): Frame {
  const p = parent.matrix;
  const c = child.matrix;
  const matrix: number[] = [];
  for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) matrix.push(p[3 * r]! * c[k]! + p[3 * r + 1]! * c[3 + k]! + p[3 * r + 2]! * c[6 + k]!);
  const origin = [0, 1, 2].map((r) => p[3 * r]! * child.origin[0]! + p[3 * r + 1]! * child.origin[1]! + p[3 * r + 2]! * child.origin[2]! + parent.origin[r]!);
  return { matrix, origin };
}

/** Every part of a read assembly tree, in file order, with its pose in the frame of the top assembly. */
export const worldParts = (nodes: StepNode[], above: Frame = IDENTITY): { name: string; product: string; world: Frame }[] =>
  nodes.flatMap((n) => {
    const world = compose(above, n);
    return n.isAssembly ? worldParts(n.children, world) : [{ name: n.name ?? '', product: n.product ?? '', world }];
  });

/** The tree without its poses: name, product, whether it is an assembly, what is in it. */
export const treeShape = (nodes: StepNode[]): unknown[] => nodes.map((n) => [n.name, n.product, n.isAssembly, treeShape(n.children)]);

export function stepRoundTrip(kernel: Kernel, solver: PlaneGcsSolver, kept: Regenerator[]) {
  async function filesOf(text: string, stem = '夾具') {
    const plan = stepAssemblyPlan(kernel, text);
    return { plan, out: await stepAssemblyFiles(plan, stem) };
  }

  /** The project as a map of path → bytes, opened the way the app opens it. */
  async function reopen(out: StepAssemblyFiles) {
    const bytes = new Map(out.files.map((f) => [f.path, f.bytes]));
    const shapes = new Map<string, ShapeId>();
    const treeOf = async (path: string): Promise<SourceTree> => {
      const file = await readDocumentFile(bytes.get(path)!);
      if (file.kind === 'part') {
        const regen = new Regenerator(kernel, solver, file.blobs);
        kept.push(regen);
        shapes.set(path, regen.rebuild(file.doc).body!.shape);
        return { kind: 'part', key: path };
      }
      const children: Record<string, SourceTree> = {};
      for (const c of file.doc.components) {
        const f = file.doc.files.find((x) => x.id === c.file)!;
        children[c.id] = await treeOf(joinPath(dirName(path), f.path));
      }
      return { kind: 'assembly', doc: file.doc, children };
    };
    const top = await treeOf(out.main);
    return { bytes, shapes, top: top as Extract<SourceTree, { kind: 'assembly' }> };
  }

  /** The reopened project written out as STEP again. */
  function reexport(opened: Awaited<ReturnType<typeof reopen>>, name = '夾具'): string {
    const { top, shapes } = opened;
    const solved = solveAssemblyTree(top.doc, top.children, () => null);
    const structure = stepStructure(top.doc, '', top.children, (id) => solved.poses.get(id) ?? null, solved.inner, () => '?');
    return exportAssemblyStep(
      kernel,
      name,
      structure.parts.map((p) => ({ shape: shapes.get(p.key)!, name: p.name })),
      structure.instances,
      structure.subs,
    );
  }

  return { filesOf, reopen, reexport };
}
