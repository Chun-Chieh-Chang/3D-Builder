/**
 * 3b-2d: patterns and mirrors of components in the STEP of an assembly (C15.13). The instances are written as more components of the
 * seed's product (a mirror: of the product's mirror), each by its own pose, and another reader — the one STEP carries the structure to —
 * finds every part where the screen shows it: the leaves the viewer draws and the file say the same, to a millionth.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyAssemblyCommand, ASSEMBLY_AXES, mirroredPose, rotationRows, createEmptyAssembly, leavesOf, patternLeavesOf, poseMatrix, type AssemblyDoc, type ComponentPattern, type Pose, type SourceTree } from '@3db/model';
import { exportAssemblyStep, readPartFile, stepStructure } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, solveAssemblyTree, type MatePart } from '@3db/regen';
import { readAssemblyTree, type StepNode } from '../support/readAssemblyStep';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
const built = {} as Record<'plate' | 'pin', { mate: MatePart; shape: ReturnType<Kernel['clone']> }>;

beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
  for (const [k, file] of [['plate', 'locating-plate.3dbx'], ['pin', 'diamond-pin.3dbx']] as const) {
    const doc = (await readPartFile(new Uint8Array(readFileSync(new URL(`../golden/${file}`, import.meta.url))))).doc;
    const regen = new Regenerator(kernel, solver);
    kept.push(regen);
    const r = regen.rebuild(doc);
    built[k] = { mate: { topology: r.body!.topology, names: r.body!.names, frames: r.frames }, shape: r.body!.shape };
  }
});

const at = (position: [number, number, number], rotation: Pose['rotation'] = [0, 0, 0, 1]): Pose => ({ position, rotation });
const comp = (id: string, file: string, instance: number, fixed: boolean, placement: Pose) => ({ id, file, instance, fixed, placement });

/** 定位組: the plate and a pin standing in a hole of it, both placed directly (nothing to solve: the poses are the intent). */
function pinsDoc(): AssemblyDoc {
  let doc = createEmptyAssembly();
  doc = applyAssemblyCommand(doc, { type: 'insertComponent', file: { id: 'file1', path: '../定位板.3dbx' }, component: comp('p1', 'file1', 1, true, at([0, 0, 0])) });
  doc = applyAssemblyCommand(doc, { type: 'insertComponent', file: { id: 'file2', path: '../零件/削邊銷.3dbx' }, component: comp('pa', 'file2', 1, true, at([-40, 0, 0], [0, Math.SQRT1_2, 0, Math.SQRT1_2])) });
  return doc;
}

const patterns: ComponentPattern[] = [
  { id: 'pattern1', name: '線性複製排列1', kind: 'linear', seed: 's0', axis1: { kind: 'axis', axis: 'x' }, count1: 3, spacing1: '150', skip: ['3'] },
  { id: 'pattern2', name: '環狀複製排列1', kind: 'circular', seed: 's0', axis1: { kind: 'axis', axis: 'y' }, count1: 3, spacing1: '120', equal: false },
  { id: 'pattern3', name: '鏡射零組件1', kind: 'mirror', seed: 's0', plane: 'plane:right' },
];

/** 夾具: one 定位組 placed off the origin and tilted, a part of the assembly itself, and the three patterns of the 定位組. */
function jigDoc(): AssemblyDoc {
  let doc = createEmptyAssembly();
  doc = applyAssemblyCommand(doc, { type: 'insertComponent', file: { id: 'file1', path: '組件/定位組.3dba' }, component: comp('s0', 'file1', 1, true, at([30, 12, -20], [0.2, 0.4, 0.1, Math.sqrt(1 - 0.04 - 0.16 - 0.01)])) });
  doc = applyAssemblyCommand(doc, { type: 'insertComponent', file: { id: 'file2', path: '零件/削邊銷.3dbx' }, component: comp('x1', 'file2', 1, true, at([0, 40, 0])) });
  for (const pattern of patterns) doc = applyAssemblyCommand(doc, { type: 'insertPattern', pattern });
  return doc;
}

const trees = (): Record<string, SourceTree> => ({
  s0: { kind: 'assembly', doc: pinsDoc(), children: { p1: { kind: 'part', key: 'plate' }, pa: { kind: 'part', key: 'pin' } } },
  x1: { kind: 'part', key: 'pin' },
});
const partOfKey = (key: string) => (key === 'plate' ? built.plate.mate : key === 'pin' ? built.pin.mate : null);
const axisOf = (a: { kind: string; axis?: 'x' | 'y' | 'z' }) => (a.kind === 'axis' ? ASSEMBLY_AXES[a.axis!] : null);

function exported() {
  const doc = jigDoc();
  const solved = solveAssemblyTree(doc, trees(), partOfKey);
  const structure = stepStructure(doc, '', trees(), (id) => solved.poses.get(id) ?? null, solved.inner, () => '?', { axisOf: axisOf as never });
  const shapes = structure.parts.map((p) => {
    const mirrored = p.key.endsWith(':mx');
    const base = (mirrored ? p.key.slice(0, -3) : p.key) === 'plate' ? built.plate.shape : built.pin.shape;
    return { shape: mirrored ? kernel.transformed(base, [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]) : base, name: p.name };
  });
  return { doc, solved, structure, text: exportAssemblyStep(kernel, '夾具', shapes, structure.instances, structure.subs), shapes };
}

/** `child` placed in the frame of `parent`: row-major 3×3 and origin. */
function compose(parent: { matrix: number[]; origin: number[] }, child: { matrix: number[]; origin: number[] }) {
  const p = parent.matrix;
  const c = child.matrix;
  const matrix: number[] = [];
  for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) matrix.push(p[3 * r]! * c[k]! + p[3 * r + 1]! * c[3 + k]! + p[3 * r + 2]! * c[6 + k]!);
  const origin = [0, 1, 2].map((r) => p[3 * r]! * child.origin[0]! + p[3 * r + 1]! * child.origin[1]! + p[3 * r + 2]! * child.origin[2]! + parent.origin[r]!);
  return { matrix, origin };
}

/** Every part of the file as [name, product, accumulated pose], walking the tree. */
function worldParts(nodes: StepNode[], above = { matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1], origin: [0, 0, 0] }): { name: string; product: string; world: ReturnType<typeof compose> }[] {
  return nodes.flatMap((n) => {
    const world = compose(above, n);
    return n.isAssembly ? worldParts(n.children, world) : [{ name: n.name ?? '', product: n.product ?? '', world }];
  });
}

describe('patterns and mirrors in the STEP of an assembly (3b-2d)', () => {
  it('writes the instances as more components of the seed\'s product, and the mirror as a product of its own', () => {
    const { structure, text } = exported();
    expect(structure.subs.map((s) => s.name)).toEqual(['定位組', '定位組（鏡射）']);
    expect(structure.parts.map((p) => p.name)).toEqual(['定位板', '削邊銷', '定位板（鏡射）', '削邊銷（鏡射）']);
    // top: the 定位組, the free part, the 1 instance of the linear pattern (one of its two is skipped), the 2 of the circular, and the mirror
    expect(structure.instances.map((i) => [i.sub, i.part])).toEqual([[0, undefined], [undefined, 1], [0, undefined], [0, undefined], [0, undefined], [1, undefined]]);
    expect(structure.instances.map((i) => i.name)).toEqual(['定位組<1>', '削邊銷<1>', '定位組<1> 〔線性複製排列1：2〕', '定位組<1> 〔環狀複製排列1：2〕', '定位組<1> 〔環狀複製排列1：3〕', '定位組<1> 〔鏡射零組件1：m〕']);
    const back = readAssemblyTree(kernel.oc, text);
    expect(back.nodes).toHaveLength(6);
    // 6 at the top, 2 in 定位組, 2 in its mirror
    expect(back.usages).toBe(10);
  });

  it('puts every part where the viewer draws it (< 1e-6): the seed, the instances, the mirror', () => {
    const { doc, solved, text } = exported();
    const base = leavesOf(doc, trees(), (id) => solved.poses.get(id) ?? null, solved.inner);
    const made = patternLeavesOf(doc, base, axisOf as never);
    expect(made.problems.size).toBe(0);
    const drawn = [...base, ...made.leaves].map((l) => ({ key: l.key, world: poseMatrix(l.pose) }));
    const filed = worldParts(readAssemblyTree(kernel.oc, text).nodes);
    expect(filed).toHaveLength(drawn.length);
    // each drawn part has a filed part with the same pose (order differs: the file groups by component)
    for (const d of drawn) {
      const match = filed.find((f) => f.world.origin.every((v, c) => Math.abs(v - d.world[12 + c]!) < 1e-6) && [0, 1, 2].every((r) => [0, 1, 2].every((c) => Math.abs(f.world.matrix[3 * r + c]! - d.world[4 * c + r]!) < 1e-6)));
      expect(match, `${d.key} at ${d.world.slice(12, 15)}`).toBeDefined();
      expect(match!.product.startsWith(d.key.startsWith('plate') ? '定位板' : '削邊銷')).toBe(true);
      expect(match!.product.endsWith('（鏡射）')).toBe(d.key.endsWith(':mx'));
    }
  });

  it('writes a mirrored part as the mirror of the part, with its volume and a rigid pose', () => {
    const { shapes, structure, text } = exported();
    const plate = kernel.massProps(built.plate.shape);
    const mirrored = kernel.massProps(shapes[structure.parts.findIndex((p) => p.name === '定位板（鏡射）')]!.shape);
    expect(mirrored.volume).toBeCloseTo(plate.volume, 6);
    expect(mirrored.center[0]).toBeCloseTo(-plate.center[0], 6);
    // no pose in the file is a reflection: every 3×3 has determinant +1
    const det = (m: number[]) => m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) - m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) + m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!);
    const all = (nodes: StepNode[]): StepNode[] => nodes.flatMap((n) => [n, ...all(n.children)]);
    for (const n of all(readAssemblyTree(kernel.oc, text).nodes)) expect(det(n.matrix)).toBeCloseTo(1, 9);
  });

  it('leaves out the instances of a suppressed seed and of a pattern whose axis is gone', () => {
    const doc = applyAssemblyCommand(jigDoc(), { type: 'setComponentState', componentIds: ['s0'], state: 'suppressed', value: true });
    const solved = solveAssemblyTree(doc, trees(), partOfKey);
    const structure = stepStructure(doc, '', trees(), (id) => solved.poses.get(id) ?? null, solved.inner, () => '?', { axisOf: axisOf as never });
    expect(structure.instances.map((i) => i.name)).toEqual(['削邊銷<1>']);
    const whole = jigDoc();
    const solvedWhole = solveAssemblyTree(whole, trees(), partOfKey);
    const gone = stepStructure(whole, '', trees(), (id) => solvedWhole.poses.get(id) ?? null, solvedWhole.inner, () => '?', { axisOf: () => null });
    // without axes the linear and circular patterns have no instances; the mirror needs none
    expect(gone.instances.map((i) => i.name)).toEqual(['定位組<1>', '削邊銷<1>', '定位組<1> 〔鏡射零組件1：m〕']);
  });
});

describe('the mirror is the reflection of the original (3b-2d)', () => {
  /** A pose as the 3 × 4 motion `Kernel.transformed` takes (rows). */
  const rows34 = (pose: Pose) => {
    const r = rotationRows(pose.rotation);
    return [r[0]!, r[1]!, r[2]!, pose.position[0], r[3]!, r[4]!, r[5]!, pose.position[1], r[6]!, r[7]!, r[8]!, pose.position[2]];
  };
  /** The reflection about a coordinate plane (x → −x), then the motion, as one 3 × 4: what "the original, reflected" is. */
  const reflectedAfter = (pose: Pose, plane: 'plane:right' | 'plane:top' | 'plane:front') => {
    const m = rows34(pose);
    const flip = plane === 'plane:right' ? 0 : plane === 'plane:top' ? 1 : 2;
    return m.map((v, i) => (Math.floor(i / 4) === flip ? -v : v));
  };

  it('the mirrored part at the mirrored pose and the original reflected in the plane differ by less than 1e-6 mm³ (symmetric difference), for every plane', () => {
    const poses: Pose[] = [at([10, 20, 30], [0.2, 0.4, 0.1, Math.sqrt(1 - 0.21)]), at([-5, 7, 2], [0, 0, Math.SQRT1_2, Math.SQRT1_2])];
    for (const plane of ['plane:right', 'plane:top', 'plane:front'] as const) {
      for (const pose of poses) {
        const mirror = kernel.transformed(built.pin.shape, [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
        const placed = kernel.transformed(mirror, rows34(mirroredPose(plane, pose)));
        const reflected = kernel.transformed(built.pin.shape, reflectedAfter(pose, plane));
        const volume = kernel.massProps(reflected).volume;
        expect(volume).toBeCloseTo(kernel.massProps(built.pin.shape).volume, 6);
        const outside = kernel.massProps(kernel.boolean('cut', placed, reflected).shape).volume;
        const inside = kernel.massProps(kernel.boolean('cut', reflected, placed).shape).volume;
        expect(outside + inside, `${plane} ${pose.position}`).toBeLessThan(1e-6);
        for (const id of [mirror, placed, reflected]) kernel.release(id);
      }
    }
  });
});