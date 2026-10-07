/**
 * E-3 (docs/assembly-explode-plan.md): forming a sub-assembly from some components of an assembly. The golden jig is the check: the five components of its middle station
 * (a plate, two pins, two V-blocks, 11 mates among them) are formed into a sub-assembly; every part must end exactly where it was (< 1e-6), every mate of the assembly
 * and of the sub-assembly must still hold, and what reached into the station from outside (the plate-to-plate mates) must now go through it. Counts by hand: 15 components
 * and 39 mates (11 for the first station, 14 for each of the others: 3 to the plate before, 3 + 2 for the pins, 3 + 3 for the V-blocks).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  applyAssemblyCommand,
  AssemblyHistory,
  composePose,
  formSubAssembly,
  formSubAssemblyProblem,
  parseAssembly,
  poseMatrix,
  serializeAssembly,
  assemblyIdsInUse,
  type AssemblyDoc,
  type Id,
  type Pose,
} from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, solveAssembly, solveSubAssembly, type MateSource } from '@3db/regen';
import { FILES, jig, jigNames, loadGoldenParts, rebuildPart, type Jig, type Kind, type Rebuilt } from '../support/goldenJig';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
let rebuilt: Rebuilt;
let flat: Jig;

beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
  const docs = await loadGoldenParts();
  rebuilt = { plate: rebuildPart(kernel, solver, kept, docs.plate), pin: rebuildPart(kernel, solver, kept, docs.pin), vblock: rebuildPart(kernel, solver, kept, docs.vblock) };
  flat = jig(jigNames(rebuilt));
});

const SUB_PATH = '工位2.3dba';
const FILE: { id: Id; path: string } = { id: 'file9', path: SUB_PATH };
const kindOfPath = (path: string): Kind => (Object.keys(FILES) as Kind[]).find((k) => FILES[k] === path)!;

/** The part or sub-assembly of each component of `doc`, as the app finds them: a part file by its kind, a sub-assembly by solving its document. */
function sourceOf(doc: AssemblyDoc, subs: Record<string, AssemblyDoc>): (id: Id) => MateSource | null {
  const cache = new Map<string, MateSource>();
  return (id) => {
    const c = doc.components.find((x) => x.id === id);
    const path = c && doc.files.find((f) => f.id === c.file)?.path;
    if (!path) return null;
    const sub = subs[path];
    if (!sub) return rebuilt[kindOfPath(path)].mate;
    if (!cache.has(path)) cache.set(path, solveSubAssembly(sub, sourceOf(sub, subs)).part);
    return cache.get(path)!;
  };
}

const solveFlat = () => solveAssembly(flat.doc, sourceOf(flat.doc, {}));
const closeMatrix = (a: Pose, b: Pose, digits: number) => poseMatrix(a).forEach((v, i) => expect(v, `entry ${i}`).toBeCloseTo(poseMatrix(b)[i]!, digits));
const station = () => flat.ids[1]!;
const members = () => [station().plate, station().pinA, station().pinB, station().v1, station().v2];
const form = (extra: { placements?: boolean } = {}) => {
  const solved = solveFlat();
  return formSubAssembly(flat.doc, members(), { file: FILE, componentId: 'comp99', ...(extra.placements === false ? {} : { placements: solved.poses }) });
};

describe('what forming a sub-assembly makes of the golden jig (E-3)', () => {
  it('starts as the jig is: 15 components, 39 mates, all of which hold', () => {
    expect(flat.doc.components).toHaveLength(15);
    expect(flat.doc.mates).toHaveLength(39);
    expect([...solveFlat().mates.values()].filter((m) => m.status !== 'ok')).toEqual([]);
  });

  it('takes the five components out of the assembly and puts one in the place of the first: 11 components, the new one fifth, at the origin, floating (nothing in it was fixed)', () => {
    const { parent } = form();
    expect(parent.components).toHaveLength(11);
    expect(parent.components.map((c) => c.id).indexOf('comp99')).toBe(5);
    const stand = parent.components[5]!;
    expect(stand).toMatchObject({ id: 'comp99', file: 'file9', instance: 1, fixed: false });
    expect(stand.placement).toEqual({ position: [0, 0, 0], rotation: [0, 0, 0, 1] });
    for (const id of members()) expect(parent.components.some((c) => c.id === id)).toBe(false);
    expect(parent.files.map((f) => f.path)).toEqual(expect.arrayContaining([SUB_PATH, FILES.plate, FILES.pin, FILES.vblock]));
    expect(parent.files.find((f) => f.id === 'file9')).toEqual(FILE);
    expect(assemblyIdsInUse(parent)).toEqual(expect.arrayContaining(['file9', 'comp99']));
    expect(parent.idCounters.comp).toBeGreaterThanOrEqual(99);
    expect(parent.idCounters.file).toBeGreaterThanOrEqual(9);
  });

  it('gives the sub-assembly its five components at the poses the mates put them at (the first fixed), its three kinds of file and the 11 mates among them', () => {
    const solved = solveFlat();
    const { sub } = form();
    expect(sub.components.map((c) => c.id)).toEqual(members());
    expect(sub.components.filter((c) => c.fixed).map((c) => c.id)).toEqual([station().plate]);
    for (const c of sub.components) closeMatrix(c.placement, solved.poses.get(c.id)!, 12);
    expect(sub.files.map((f) => f.path).sort()).toEqual([FILES.pin, FILES.plate, FILES.vblock].sort());
    expect(sub.mates).toHaveLength(11);
    expect(sub.mates.every((m) => [m.a, m.b].every((r) => r.component !== null && members().includes(r.component)))).toBe(true);
    expect(sub.kind).toBe('assembly');
    expect(parseAssembly(serializeAssembly(sub))).toEqual(sub);
  });

  it('keeps the 28 other mates in the assembly, and what reached into the station now goes through the sub-assembly by the id of the plate (the 3 + 3 plate-to-plate mates)', () => {
    const { parent } = form();
    expect(parent.mates).toHaveLength(28);
    const through = parent.mates.flatMap((m) => [m.a, m.b]).filter((r) => r.component === 'comp99');
    expect(through).toHaveLength(6);
    expect(through.every((r) => JSON.stringify(r.path) === JSON.stringify([station().plate]))).toBe(true);
    // the mates of the other stations did not change
    const before = flat.doc.mates.filter((m) => ![m.a, m.b].some((r) => r.component !== null && members().includes(r.component)));
    for (const m of before) expect(parent.mates.find((x) => x.id === m.id)).toEqual(m);
    expect(parent.mates.map((m) => m.id)).not.toEqual(expect.arrayContaining(sub_ids()));
  });

  it('puts every part where it was, and every mate of the assembly and the sub-assembly holds (the parts < 1e-6)', () => {
    const { parent, sub } = form();
    const solvedFlat = solveFlat();
    const alone = solveSubAssembly(sub, sourceOf(sub, {}));
    expect([...alone.result.mates.values()].filter((m) => m.status !== 'ok')).toEqual([]);
    expect(alone.result.mates.size).toBe(11);
    const nested = solveAssembly(parent, sourceOf(parent, { [SUB_PATH]: sub }));
    expect([...nested.mates.values()].filter((m) => m.status !== 'ok')).toEqual([]);
    expect(nested.mates.size).toBe(28);
    // a part with a freedom left (a pin can still turn about its own axis) may come out turned differently from another start; the others are where they were
    const off = parent.components.filter((c) => c.id !== 'comp99' && nested.components.get(c.id)?.dof === 0).map((c) => [c.id, Math.max(...poseMatrix(nested.poses.get(c.id)!).map((v, i) => Math.abs(v - poseMatrix(solvedFlat.poses.get(c.id)!)[i]!)))] as const).filter(([, d]) => d > 1e-6);
    expect(off).toEqual([]);
    for (const id of members()) closeMatrix(composePose(nested.poses.get('comp99')!, alone.part.poses.get(id)!), solvedFlat.poses.get(id)!, 6);
  });

  it('is fixed in the assembly when one of the components was, and then the first of the others is not made fixed: the first station with its plate fixed', () => {
    const first = flat.ids[0]!;
    const ids = [first.plate, first.pinA, first.pinB, first.v1, first.v2];
    const { parent, sub } = formSubAssembly(flat.doc, ids, { file: FILE, componentId: 'comp99', placements: solveFlat().poses });
    expect(parent.components[0]).toMatchObject({ id: 'comp99', fixed: true });
    expect(sub.components.filter((c) => c.fixed).map((c) => c.id)).toEqual([first.plate]);
    const nested = solveAssembly(parent, sourceOf(parent, { [SUB_PATH]: sub }));
    expect([...nested.mates.values()].filter((m) => m.status !== 'ok')).toEqual([]);
    const solvedFlat = solveFlat();
    const alone = solveSubAssembly(sub, sourceOf(sub, {}));
    for (const id of ids) closeMatrix(composePose(nested.poses.get('comp99')!, alone.part.poses.get(id)!), solvedFlat.poses.get(id)!, 6);
  });

  it('renames the components of the exploded views: a step that moved the plate and a pin of the station moves the sub-assembly once, its direction through it', () => {
    let d = flat.doc;
    d = applyAssemblyCommand(d, {
      type: 'insertExplodeStep',
      step: { id: 'explode1', name: '爆炸步驟1', components: [station().plate, flat.ids[0]!.v1, station().pinA], axis: { kind: 'ref', ref: { component: station().plate, ref: { kind: 'edge', name: 'e' } } }, distance: '30' },
    });
    const { parent } = formSubAssembly(d, members(), { file: FILE, componentId: 'comp99' });
    const step = parent.explosions![0]!.steps[0]!;
    expect(step.components).toEqual(['comp99', flat.ids[0]!.v1]);
    expect(step.axis).toEqual({ kind: 'ref', ref: { component: 'comp99', path: [station().plate], ref: { kind: 'edge', name: 'e' } } });
  });
});

function sub_ids(): Id[] {
  return form().sub.mates.map((m) => m.id);
}

describe('what cannot be formed', () => {
  it('fewer than two, a component that is not there, an id that is in use', () => {
    expect(formSubAssemblyProblem(flat.doc, [station().plate])).toMatch(/至少要選兩個/);
    expect(formSubAssemblyProblem(flat.doc, [station().plate, 'nope'])).toMatch(/找不到零組件/);
    expect(formSubAssemblyProblem(flat.doc, [])).toMatch(/至少要選兩個/);
    expect(formSubAssemblyProblem(flat.doc, members())).toBeNull();
    expect(() => formSubAssembly(flat.doc, members(), { file: { id: 'file1', path: 'x.3dba' }, componentId: 'comp99' })).toThrow(/ID 已被使用/);
    expect(() => formSubAssembly(flat.doc, members(), { file: FILE, componentId: 'comp1' })).toThrow(/ID 已被使用/);
    expect(() => formSubAssembly(flat.doc, [station().plate], { file: FILE, componentId: 'comp99' })).toThrow(/至少要選兩個/);
  });

  it('a pattern or mirror made of one of them, or whose direction is an element of one', () => {
    const withPattern = applyAssemblyCommand(flat.doc, { type: 'insertPattern', pattern: { id: 'pattern1', name: '線性複製排列1', kind: 'linear', seed: station().pinA, axis1: { kind: 'axis', axis: 'x' }, count1: 2, spacing1: '10' } });
    expect(formSubAssemblyProblem(withPattern, members())).toMatch(/線性複製排列1/);
    expect(formSubAssemblyProblem(withPattern, [flat.ids[0]!.plate, flat.ids[0]!.v1])).toBeNull(); // one that does not touch the seed is fine
    const byElement = applyAssemblyCommand(flat.doc, { type: 'insertPattern', pattern: { id: 'pattern1', name: '環狀複製排列1', kind: 'circular', seed: flat.ids[2]!.pinA, axis1: { kind: 'ref', ref: { component: station().plate, ref: { kind: 'edge', name: 'e' } } }, count1: 3, spacing1: '120' } });
    expect(formSubAssemblyProblem(byElement, members())).toMatch(/環狀複製排列1/);
  });
});

describe('the command', () => {
  it('forms the same assembly as the function, in one undo step that gives the old assembly back, and writes and reads back', () => {
    const solved = solveFlat();
    const h = new AssemblyHistory(flat.doc);
    h.execute({ type: 'formSubAssembly', componentIds: members(), file: FILE, componentId: 'comp99', placements: members().map((id) => ({ componentId: id, placement: solved.poses.get(id)! })) });
    expect(h.doc).toEqual(form().parent);
    expect(parseAssembly(serializeAssembly(h.doc))).toEqual(h.doc);
    h.undo();
    expect(h.doc).toEqual(flat.doc);
    h.redo();
    expect(h.doc.components).toHaveLength(11);
  });

  it('refuses what the function refuses, and changes nothing', () => {
    expect(() => applyAssemblyCommand(flat.doc, { type: 'formSubAssembly', componentIds: [station().plate], file: FILE, componentId: 'comp99', placements: [] })).toThrow(/至少要選兩個/);
  });
});
