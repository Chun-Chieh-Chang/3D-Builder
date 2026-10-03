/**
 * 3b-3b: an assembly STEP as files (F2.8). The structure of the file becomes an assembly file, sub-assembly files and a part file
 * per part product; opened again and written out as STEP it is the structure it came from: the same products, the same component names,
 * every part where the file had it, the shapes of the parts as they were.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { axisAngle, type Quat } from '@3db/model';
import { readDocumentFile, readPartFile, stepAssemblyFiles, stepAssemblyPlan, type StepAssemblyFiles } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type ShapeId } from '@3db/kernel';
import { Regenerator } from '@3db/regen';
import { readAssemblyTree } from '../support/readAssemblyStep';
import { stepRoundTrip, treeShape, worldParts } from '../support/stepRoundTrip';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const built = {} as Record<'plate' | 'pin', ShapeId>;
const kept: Regenerator[] = [];
let trip: ReturnType<typeof stepRoundTrip>;

beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
  trip = stepRoundTrip(kernel, solver, kept);
  for (const [k, file] of [['plate', 'locating-plate.3dbx'], ['pin', 'diamond-pin.3dbx']] as const) {
    const doc = (await readPartFile(new Uint8Array(readFileSync(new URL(`../golden/${file}`, import.meta.url))))).doc;
    const regen = new Regenerator(kernel, solver);
    kept.push(regen);
    built[k] = regen.rebuild(doc).body!.shape;
  }
});

const turned: Quat = axisAngle([0.6, 0.8, 0], 0.7);

/** 夾具 → 定位組 twice (once turned, once off the origin) and a 削邊銷 of its own; 定位組 → 定位板 and 削邊銷 turned. */
function source(): string {
  return kernel.exportAssemblyStep(
    '夾具',
    [{ shape: built.plate, name: '定位板' }, { shape: built.pin, name: '削邊銷' }],
    [
      { sub: 0, name: '定位組<1>', position: [30, 12, -20], rotation: turned },
      { sub: 0, name: '定位組<2>', position: [150, 5, -3], rotation: [0, 0, 0, 1] },
      { part: 1, name: '削邊銷<1>', position: [0, 40, 0], rotation: [0, 0, 0, 1] },
    ],
    'MM',
    [{ name: '定位組', instances: [{ part: 0, name: '定位板<1>', position: [0, 0, 0], rotation: [0, 0, 0, 1] }, { part: 1, name: '削邊銷<1>', position: [-40, 0, 0], rotation: [0, 0.7071067811865476, 0, 0.7071067811865476] }] }],
  );
}

const filesOf = (text: string, stem?: string) => trip.filesOf(text, stem);
const reopen = (out: StepAssemblyFiles) => trip.reopen(out);

describe('an assembly STEP as files (3b-3b)', () => {
  it('writes one assembly file, one sub-assembly file and one part file per part product', async () => {
    const { out } = await filesOf(source());
    expect(out.files.map((f) => f.path).sort()).toEqual(['夾具.3dba', '組件/定位組.3dba', '零件/削邊銷.3dbx', '零件/定位板.3dbx'].sort());
    expect(out.main).toBe('夾具.3dba');
    expect([out.parts, out.subAssemblies, out.warnings]).toEqual([2, 1, []]);
    const main = await readDocumentFile(out.files.find((f) => f.path === '夾具.3dba')!.bytes);
    expect(main.kind).toBe('assembly');
    if (main.kind !== 'assembly') return;
    // three components, two files (the sub-assembly used twice), the first fixed, the others free, no mates
    expect(main.doc.components.map((c) => [c.instance, c.fixed])).toEqual([[1, true], [2, false], [1, false]]);
    expect(main.doc.files.map((f) => f.path)).toEqual(['組件/定位組.3dba', '零件/削邊銷.3dbx']);
    expect(main.doc.mates).toEqual([]);
    const sub = await readDocumentFile(out.files.find((f) => f.path === '組件/定位組.3dba')!.bytes);
    if (sub.kind !== 'assembly') throw new Error('sub');
    expect(sub.doc.files.map((f) => f.path)).toEqual(['../零件/定位板.3dbx', '../零件/削邊銷.3dbx']); // written from its own folder
  });

  it('is the same assembly written out again: the same tree, names, and every part where the file had it (< 1e-6)', async () => {
    const original = source();
    const { out } = await filesOf(original);
    const again = trip.reexport(await reopen(out));
    const a = readAssemblyTree(kernel.oc, original);
    const b = readAssemblyTree(kernel.oc, again);
    expect(treeShape(b.nodes)).toEqual(treeShape(a.nodes));
    expect(b.usages).toBe(a.usages);
    const pa = worldParts(a.nodes);
    const pb = worldParts(b.nodes);
    expect(pb).toHaveLength(pa.length);
    pa.forEach((x, i) => {
      expect(pb[i]!.name).toBe(x.name);
      expect(pb[i]!.product).toBe(x.product);
      pb[i]!.world.origin.forEach((v, k) => expect(v).toBeCloseTo(x.world.origin[k]!, 6));
      pb[i]!.world.matrix.forEach((v, k) => expect(v).toBeCloseTo(x.world.matrix[k]!, 6));
    });
  });

  it('keeps the shapes of the parts: volume, surface area and the number of faces', async () => {
    const { out } = await filesOf(source());
    const { shapes } = await reopen(out);
    for (const [path, original] of [['零件/定位板.3dbx', built.plate], ['零件/削邊銷.3dbx', built.pin]] as const) {
      const got = shapes.get(path)!;
      expect(kernel.massProps(got).volume / kernel.massProps(original).volume).toBeCloseTo(1, 6);
      expect(kernel.massProps(got).area / kernel.massProps(original).area).toBeCloseTo(1, 6);
      expect(kernel.topology(got).faces.length).toBe(kernel.topology(original).faces.length);
    }
  });

  it('turns the colors of faces into appearances of the part, on the faces that carry them', async () => {
    const n = kernel.topology(built.pin).faces.length;
    const colors = Array.from({ length: n }, (_, i) => (i === 2 ? '#ff0000' : i === 5 ? '#00aa33' : null));
    const { out } = await filesOf(kernel.exportStep(built.pin, '銷', 'MM', { faceColors: colors }), '銷');
    expect(out.main).toBe('銷.3dbx'); // one part: it is opened as the part it is
    const part = await readPartFile(out.files[0]!.bytes);
    const found = part.doc.appearances.map((x) => [x.target.kind === 'face' ? x.target.ref.name : x.target.kind, x.color]);
    expect(found).toHaveLength(2);
    expect(found[0]![0]).toBe('import1:f3');
    expect(found[1]![0]).toBe('import1:f6');
    expect(Math.abs(parseInt((found[0]![1] as string).slice(1, 3), 16) - 255)).toBeLessThanOrEqual(1);
    // the names are real: they are faces of the part as it is rebuilt
    const regen = new Regenerator(kernel, solver, part.blobs);
    kept.push(regen);
    const names = regen.rebuild(part.doc).body!.names.faces;
    expect(names).toContain('import1:f3');
    expect(names).toContain('import1:f6');
  });

  it('keeps products with the same name apart, and names what has no name', async () => {
    const plan = stepAssemblyPlan(kernel, source());
    // two different parts called alike, and an assembly with a part that has no name
    plan.prototypes.forEach((p) => {
      if (p.part) p.name = 'x/y';
    });
    plan.prototypes.find((p) => p.children && p.name === '定位組')!.name = null;
    const out = await stepAssemblyFiles(plan, '夾具');
    expect(out.files.map((f) => f.path).sort()).toEqual(['夾具.3dba', '組件/未命名2.3dba', '零件/x_y (2).3dbx', '零件/x_y.3dbx'].sort());
  });

  it('does not stop at a component that points at a product that is not there', async () => {
    const plan = stepAssemblyPlan(kernel, source());
    plan.prototypes[plan.root]!.children!.push({ name: 'ghost', prototype: 99, rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: [0, 0, 0] });
    const out = await stepAssemblyFiles(plan, '夾具');
    const main = await readDocumentFile(out.files.find((f) => f.path === '夾具.3dba')!.bytes);
    if (main.kind !== 'assembly') throw new Error('main');
    expect(main.doc.components).toHaveLength(3);
  });
});

