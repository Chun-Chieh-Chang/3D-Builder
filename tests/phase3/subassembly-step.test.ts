/**
 * 3b-1e: an assembly with sub-assemblies as STEP (F1.2, C15.4). Each part file is one product, each sub-assembly file is one product
 * (written once, used by as many components as use the file), every component carries its own pose in the frame of the assembly it is in,
 * and another reader — the one STEP carries the structure to — finds the same tree, the same names and the same positions.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyAssemblyCommand, createEmptyAssembly, leavesOf, poseMatrix, type AssemblyDoc, type Pose, type SourceTree } from '@3db/model';
import { exportAssemblyStep, readPartFile, stepStructure } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, solveAssemblyTree, type MatePart } from '@3db/regen';
import { readAssemblyTree, type StepNode } from '../support/readAssemblyStep';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
const built = {} as Record<'plate' | 'pin', { mate: MatePart; shape: ReturnType<Kernel['clone']> }>;

const GOLDEN = { plate: 'locating-plate.3dbx', pin: 'diamond-pin.3dbx' } as const;
const face = (name: string) => ({ kind: 'face' as const, name });
const TOP = 'extrude1:cap:end';
const HOLE_LEFT = 'cut1:side:sketch2.ci6';
const HOLE_RIGHT = 'cut1:side:sketch2.ci5';
const SHANK = 'revolve1:side:sketch1.l3#1';
const FLANGE_UNDERSIDE = 'revolve1:side:sketch1.l4';
const FLAT = 'cut1:cap:start';
const PLATE_RIGHT_SIDE = 'extrude1:side:sketch1.l4';

beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
  for (const k of ['plate', 'pin'] as const) {
    const doc = (await readPartFile(new Uint8Array(readFileSync(new URL(`../golden/${GOLDEN[k]}`, import.meta.url))))).doc;
    const regen = new Regenerator(kernel, solver);
    kept.push(regen);
    const r = regen.rebuild(doc);
    const body = r.body!;
    built[k] = { mate: { topology: body.topology, names: body.names, frames: r.frames }, shape: body.shape };
  }
});

const at = (position: [number, number, number], rotation: Pose['rotation'] = [0, 0, 0, 1]): Pose => ({ position, rotation });
const comp = (id: string, file: string, instance: number, fixed: boolean, placement: Pose) => ({ id, file, instance, fixed, placement });

/** 定位組 (組件/定位組.3dba): the plate fixed, a pin in each hole, all defined. */
function pinsDoc(): AssemblyDoc {
  let doc = createEmptyAssembly();
  doc = applyAssemblyCommand(doc, { type: 'insertComponent', file: { id: 'file1', path: '../定位板.3dbx' }, component: comp('p1', 'file1', 1, true, at([0, 0, 0])) });
  doc = applyAssemblyCommand(doc, { type: 'insertComponent', file: { id: 'file2', path: '../零件/削邊銷.3dbx' }, component: comp('pa', 'file2', 1, false, at([-36, 33, -5])) });
  doc = applyAssemblyCommand(doc, { type: 'insertComponent', component: comp('pb', 'file2', 2, false, at([44, 36, 4])) });
  let n = 0;
  for (const [pin, hole] of [['pa', HOLE_LEFT], ['pb', HOLE_RIGHT]] as const) {
    for (const [type, a, b, align] of [
      ['concentric', hole, SHANK, 'aligned'],
      ['coincident', TOP, FLANGE_UNDERSIDE, 'antiAligned'],
      ['parallel', PLATE_RIGHT_SIDE, FLAT, 'aligned'],
    ] as const) {
      doc = applyAssemblyCommand(doc, { type: 'insertMate', mate: { id: `m${++n}`, name: `結合${n}`, type, a: { component: 'p1', ref: face(a) }, b: { component: pin, ref: face(b) }, align, suppressed: false } });
    }
  }
  return doc;
}

/** 夾具 (in the project folder): 定位組 three times, the first fixed, the others free in space (they keep where they are put). */
function jigDoc(): AssemblyDoc {
  let doc = createEmptyAssembly();
  doc = applyAssemblyCommand(doc, { type: 'insertComponent', file: { id: 'file1', path: '組件/定位組.3dba' }, component: comp('s0', 'file1', 1, true, at([0, 0, 0])) });
  doc = applyAssemblyCommand(doc, { type: 'insertComponent', component: comp('s1', 'file1', 2, false, at([120, 0, 0], [0, Math.SQRT1_2, 0, Math.SQRT1_2])) });
  doc = applyAssemblyCommand(doc, { type: 'insertComponent', component: comp('s2', 'file1', 3, false, at([240, 15, -30])) });
  return doc;
}

const trees = (): Record<string, SourceTree> => {
  const sub = pinsDoc();
  const one = (): SourceTree => ({ kind: 'assembly', doc: sub, children: { p1: { kind: 'part', key: 'plate' }, pa: { kind: 'part', key: 'pin' }, pb: { kind: 'part', key: 'pin' } } });
  return { s0: one(), s1: one(), s2: one() };
};
const partOfKey = (key: string) => (key === 'plate' ? built.plate.mate : key === 'pin' ? built.pin.mate : null);
const status = () => 'status';

function request(doc: AssemblyDoc, solved: ReturnType<typeof solveAssemblyTree>) {
  const structure = stepStructure(doc, '', trees(), (id) => solved.poses.get(id) ?? null, solved.inner, status);
  const shapes = structure.parts.map((p) => ({ shape: p.key === 'plate' ? built.plate.shape : built.pin.shape, name: p.name }));
  return { structure, text: exportAssemblyStep(kernel, '夾具', shapes, structure.instances, structure.subs) };
}

describe('an assembly with sub-assemblies as STEP (3b-1e)', () => {
  it('writes each part file and each sub-assembly file once, as products, and every use as a placed component', () => {
    const doc = jigDoc();
    const solved = solveAssemblyTree(doc, trees(), partOfKey);
    const { structure, text } = request(doc, solved);
    expect(structure.parts.map((p) => p.name)).toEqual(['定位板', '削邊銷']);
    expect(structure.subs.map((s) => [s.name, s.instances.map((i) => i.name)])).toEqual([['定位組', ['定位板<1>', '削邊銷<1>', '削邊銷<2>']]]);
    expect(structure.instances.map((i) => [i.sub, i.name])).toEqual([[0, '定位組<1>'], [0, '定位組<2>'], [0, '定位組<3>']]);
    expect(structure.unreadable).toEqual([]);
    const back = readAssemblyTree(kernel.oc, text);
    expect(back.rootName).toBe('夾具');
    // three uses at the top, three components inside the one sub-assembly: six usages, not twelve
    expect(back.usages).toBe(6);
    expect([...new Set([...text.matchAll(/PRODUCT\('([^']*)'/g)].map((m) => m[1]))].sort()).toEqual(['夾具', '定位板', '定位組', '削邊銷'].sort());
  });

  it('reads back as the same tree, with the same names and poses (< 1e-6): every part where the assembly puts it', () => {
    const doc = jigDoc();
    const solved = solveAssemblyTree(doc, trees(), partOfKey);
    const { text } = request(doc, solved);
    const back = readAssemblyTree(kernel.oc, text);
    expect(back.nodes.map((n) => [n.name, n.product, n.isAssembly])).toEqual([['定位組<1>', '定位組', true], ['定位組<2>', '定位組', true], ['定位組<3>', '定位組', true]]);
    const leaves = leavesOf(doc, trees(), (id) => solved.poses.get(id) ?? null, solved.inner);
    back.nodes.forEach((node, i) => {
      const top = ['s0', 's1', 's2'][i]!;
      expect(node.children.map((c) => [c.name, c.product, c.isAssembly])).toEqual([['定位板<1>', '定位板', false], ['削邊銷<1>', '削邊銷', false], ['削邊銷<2>', '削邊銷', false]]);
      // the pose a reader gets for a part is the sub-assembly's pose, then the part's inside it
      ['p1', 'pa', 'pb'].forEach((id, k) => {
        const child = node.children[k]!;
        const world = composeMatrix(node, child);
        const leaf = leaves.find((l) => l.id === `${top}/${id}`)!;
        const want = poseMatrix(leaf.pose);
        // origin (column 3 of the 4×4) and the 3×3, to a micron / a millionth
        expect(world.origin.map((v, c) => v - want[12 + c]!).every((d) => Math.abs(d) < 1e-6), `${top}/${id} origin ${world.origin} vs ${want.slice(12, 15)}`).toBe(true);
        const m = world.matrix; // row-major
        const wantRows = [want[0], want[4], want[8], want[1], want[5], want[9], want[2], want[6], want[10]] as number[];
        expect(m.every((v, c) => Math.abs(v - wantRows[c]!) < 1e-6), `${top}/${id} rotation`).toBe(true);
      });
    });
  });

  it('the three uses of the sub-assembly share one product: its inside is the same each time', () => {
    const doc = jigDoc();
    const solved = solveAssemblyTree(doc, trees(), partOfKey);
    const back = readAssemblyTree(kernel.oc, request(doc, solved).text);
    const inside = back.nodes.map((n) => JSON.stringify(n.children.map((c) => [c.name, c.origin.map((v) => +v.toFixed(6)), c.matrix.map((v) => +v.toFixed(6))])));
    expect(new Set(inside).size).toBe(1);
  });

  it('leaves out what is suppressed, at any level, and keeps what is hidden', () => {
    const doc = applyAssemblyCommand(applyAssemblyCommand(jigDoc(), { type: 'setComponentState', componentIds: ['s1'], state: 'suppressed', value: true }), { type: 'setComponentState', componentIds: ['s2'], state: 'hidden', value: true });
    const inner = pinsDoc();
    const withoutPin: AssemblyDoc = { ...inner, components: inner.components.map((c) => (c.id === 'pb' ? { ...c, suppressed: true } : c)) };
    const t = trees();
    for (const id of ['s0', 's2']) t[id] = { kind: 'assembly', doc: withoutPin, children: (t[id] as { children: Record<string, SourceTree> }).children };
    const solved = solveAssemblyTree(doc, t, partOfKey);
    const structure = stepStructure(doc, '', t, (id) => solved.poses.get(id) ?? null, solved.inner, status);
    expect(structure.instances.map((i) => i.name)).toEqual(['定位組<1>', '定位組<3>']); // s1 is left out; the hidden s2 is in the file
    expect(structure.subs[0]!.instances.map((i) => i.name)).toEqual(['定位板<1>', '削邊銷<1>']); // the pin that is suppressed inside it is not there
  });

  it('says which files it cannot use instead of leaving them out', () => {
    const doc = jigDoc();
    const t = trees();
    // 削邊銷<2> inside the sub-assembly was not read (the sub-assembly's contents are the first use's), and the whole of 定位組<3> has no tree
    t.s0 = { kind: 'assembly', doc: pinsDoc(), children: { p1: { kind: 'part', key: 'plate' }, pa: { kind: 'part', key: 'pin' } } };
    delete t.s2;
    const solved = solveAssemblyTree(doc, t, partOfKey);
    const structure = stepStructure(doc, '', t, (id) => solved.poses.get(id) ?? null, solved.inner, (path) => `找不到 ${path}`);
    // the paths are the project's: the sub-assembly's own parts are found from its folder, 組件/
    expect(structure.unreadable).toEqual([{ path: '零件/削邊銷.3dbx', why: '找不到 零件/削邊銷.3dbx' }, { path: '組件/定位組.3dba', why: '找不到 組件/定位組.3dba' }]);
  });
});
/** `child` placed in the frame of `parent`: the child's pose seen from the assembly above (row-major 3×3 and origin). */
function composeMatrix(parent: StepNode, child: StepNode): { matrix: number[]; origin: number[] } {
  const p = parent.matrix;
  const c = child.matrix;
  const matrix: number[] = [];
  for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) matrix.push(p[3 * r]! * c[k]! + p[3 * r + 1]! * c[3 + k]! + p[3 * r + 2]! * c[6 + k]!);
  const o = child.origin;
  const origin = [0, 1, 2].map((r) => p[3 * r]! * o[0]! + p[3 * r + 1]! * o[1]! + p[3 * r + 2]! * o[2]! + parent.origin[r]!);
  return { matrix, origin };
}
