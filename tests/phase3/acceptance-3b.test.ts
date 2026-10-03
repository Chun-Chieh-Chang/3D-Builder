/**
 * Phase 3b-7 (docs/phase3-plan.md §5, 3b ①), the part of the acceptance that needs no sample of the user's: the golden jig — fifteen components, three
 * part products, 39 mates solved — written as STEP, read into files, opened again the way the app opens a project and written out as STEP again.
 * It stands in for the assembly STEP of the user's, which has to have ≥ 10 NEXT_ASSEMBLY_USAGE_OCCURRENCE: the flat jig has 15; the nested one has 8 (3 uses of the station, 5 components in it — 15 placed parts), so it shows the hierarchy, not the size.
 *
 *  - the tree, the component names and the products come back as they went in;
 *  - every part is where it was, to within 0.01 mm (§5; the checks here are 1e-6) — in the nested one at the end of two levels of placement;
 *  - the shapes of the parts keep their volume (against the hand-calculated volumes of the golden parts), surface area and number of faces;
 *  - written again from what was read, the file is a fixed point: the same tree, the same poses.
 *
 * What it does not show, because it takes the real thing: that another CAD system's STEP — products with several shapes, units other than mm,
 * assemblies that are not rigid, names that are not ours — comes in the same way, and what eDrawings shows of either file (handoff §8).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { axisAngle, transformPoint, type Pose, type Vec3 } from '@3db/model';
import { componentName, exportAssemblyStep, partNameOf, readDocumentFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, type AssemblyResult } from '@3db/regen';
import { readAssemblyStep, readAssemblyTree, rotationMatrix, type StepNode } from '../support/readAssemblyStep';
import { jig, jigNames, loadGoldenParts, PITCH, rebuildPart, solveJig, type Jig, type Kind, type Rebuilt, FILES } from '../support/goldenJig';
import { stepRoundTrip, treeShape, worldParts } from '../support/stepRoundTrip';

/** §5: every part within this of where the file had it. */
const POSE_LIMIT_MM = 0.01;
const HAND_VOLUME: Record<string, number> = { 定位板: 137197.0207, V型塊: 108114.3364, 削邊銷: 2487.0292 }; // tests/golden/README.md

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
let trip: ReturnType<typeof stepRoundTrip>;
let rebuilt: Rebuilt;
let built: Jig;
let solved: AssemblyResult;
let flat: string;
let nested: string;

const partName = (k: Kind) => partNameOf(FILES[k]);
const kindOfFile = (built: Jig, id: string): Kind => (Object.keys(FILES) as Kind[]).find((k) => FILES[k] === built.doc.files.find((f) => f.id === id)!.path)!;

/** The flat jig: three products, fifteen components named as in the tree, each at the pose the solver found. */
function flatStep(): string {
  const doc = built.doc;
  const parts = doc.files.map((f) => ({ shape: rebuilt[kindOfFile(built, f.id)].shape, name: partNameOf(f.path) }));
  const instances = doc.components.map((c) => ({
    part: doc.files.findIndex((f) => f.id === c.file),
    name: componentName(doc.files.find((f) => f.id === c.file)?.path, c.instance),
    pose: solved.poses.get(c.id)!,
  }));
  return exportAssemblyStep(kernel, '夾具', parts, instances);
}

/** Where each station of the nested jig is put: in a row, the last one turned about the vertical. */
const stationPlacements: Pose[] = [
  { position: [0, 0, 0], rotation: [0, 0, 0, 1] },
  { position: [PITCH, 0, 0], rotation: [0, 0, 0, 1] },
  { position: [2 * PITCH + 20, 0, 35], rotation: axisAngle([0, 1, 0], 0.5) },
];

/** The nested jig: one sub-assembly 「工位」 — the plate, its pins and V-blocks, as the solver put station 0 — used three times. */
function nestedStep(): string {
  const doc = built.doc;
  const station = built.ids[0]!;
  const members = [station.plate, station.pinA, station.pinB, station.v1, station.v2].map((id) => doc.components.find((c) => c.id === id)!);
  const used = [...new Set(members.map((c) => c.file))];
  const parts = used.map((id) => ({ shape: rebuilt[kindOfFile(built, id)].shape, name: partNameOf(doc.files.find((f) => f.id === id)!.path) }));
  return exportAssemblyStep(
    kernel,
    '夾具',
    parts,
    stationPlacements.map((pose, i) => ({ sub: 0, name: `工位<${i + 1}>`, pose })),
    [
      {
        name: '工位',
        instances: members.map((c) => ({
          part: used.indexOf(c.file),
          name: componentName(doc.files.find((f) => f.id === c.file)?.path, c.instance),
          pose: solved.poses.get(c.id)!,
        })),
      },
    ],
  );
}

beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
  trip = stepRoundTrip(kernel, solver, kept);
  const docs = await loadGoldenParts();
  rebuilt = { plate: rebuildPart(kernel, solver, kept, docs.plate), pin: rebuildPart(kernel, solver, kept, docs.pin), vblock: rebuildPart(kernel, solver, kept, docs.vblock) };
  built = jig(jigNames(rebuilt));
  solved = solveJig(built.doc, rebuilt);
  flat = flatStep();
  nested = nestedStep();
});

afterAll(() => {
  kept.length = 0;
});

/** The largest distance between where two readings of an assembly put the same part, and how far their turns are from each other. */
function deviation(a: StepNode[], b: StepNode[]): { mm: number; turn: number } {
  const pa = worldParts(a);
  const pb = worldParts(b);
  expect(pb).toHaveLength(pa.length);
  let mm = 0;
  let turn = 0;
  pa.forEach((x, i) => {
    expect(pb[i]!.name).toBe(x.name);
    expect(pb[i]!.product).toBe(x.product);
    mm = Math.max(mm, Math.hypot(...x.world.origin.map((v, k) => v - pb[i]!.world.origin[k]!)));
    turn = Math.max(turn, ...x.world.matrix.map((v, k) => Math.abs(v - pb[i]!.world.matrix[k]!)));
  });
  return { mm, turn };
}

describe('the golden jig through STEP and files and STEP again (3b-7, flat: 15 components, 3 products)', () => {
  it('is a STEP file with at least 10 usages — the size of assembly the acceptance asks for — and three products', () => {
    expect(flat.match(/NEXT_ASSEMBLY_USAGE_OCCURRENCE\(/g)!.length).toBe(15);
    expect(flat.match(/MANIFOLD_SOLID_BREP/g)).toHaveLength(3);
  });

  it('becomes one assembly file and three part files, with the 15 components in the order the file has them', async () => {
    const { out } = await trip.filesOf(flat);
    expect(out.files.map((f) => f.path).sort()).toEqual(['夾具.3dba', '零件/V型塊.3dbx', '零件/定位板.3dbx', '零件/削邊銷.3dbx'].sort());
    expect([out.parts, out.subAssemblies, out.warnings]).toEqual([3, 0, []]);
    const main = await readDocumentFile(out.files.find((f) => f.path === out.main)!.bytes);
    if (main.kind !== 'assembly') throw new Error('main');
    expect(main.doc.components).toHaveLength(15);
    // three files, used 3 + 6 + 6 times: the plates, the pins, the V-blocks
    const uses = new Map<string, number>();
    for (const c of main.doc.components) uses.set(main.doc.files.find((f) => f.id === c.file)!.path, (uses.get(main.doc.files.find((f) => f.id === c.file)!.path) ?? 0) + 1);
    expect([...uses].map(([path, n]) => [path.replace(/^.*\//, ''), n]).sort()).toEqual([['V型塊.3dbx', 6], ['定位板.3dbx', 3], ['削邊銷.3dbx', 6]].sort());
  });

  it('comes back as the same tree, product by product and name by name, every part within 0.01 mm of where the file had it', async () => {
    const { out } = await trip.filesOf(flat);
    const again = trip.reexport(await trip.reopen(out));
    const a = readAssemblyTree(kernel.oc, flat);
    const b = readAssemblyTree(kernel.oc, again);
    expect(treeShape(b.nodes)).toEqual(treeShape(a.nodes));
    expect(b.rootName).toBe(a.rootName);
    expect(b.usages).toBe(a.usages);
    const d = deviation(a.nodes, b.nodes);
    console.log(`3b-7 flat jig, 15 components: largest position difference ${d.mm.toExponential(2)} mm, largest rotation-matrix difference ${d.turn.toExponential(2)}`);
    expect(d.mm).toBeLessThan(POSE_LIMIT_MM);
    expect(d.mm).toBeLessThan(1e-6);
    expect(d.turn).toBeLessThan(1e-6);
  });

  it('is also where the solver put it: the poses read from the second file against the poses of the mates', async () => {
    const { out } = await trip.filesOf(flat);
    const back = readAssemblyStep(kernel.oc, trip.reexport(await trip.reopen(out)));
    expect(back.items).toHaveLength(15);
    built.doc.components.forEach((c, k) => {
      const pose = solved.poses.get(c.id)!;
      back.items[k]!.origin.forEach((v, i) => expect(Math.abs(v - pose.position[i]!)).toBeLessThan(POSE_LIMIT_MM));
      back.items[k]!.matrix.forEach((v, i) => expect(Math.abs(v - rotationMatrix(pose.rotation)[i]!)).toBeLessThan(1e-6));
    });
  });

  it('keeps the parts: volume against the hand count of the golden parts, surface area and the number of faces against the part it came from', async () => {
    const { out } = await trip.filesOf(flat);
    const opened = await trip.reopen(out);
    for (const kind of Object.keys(FILES) as Kind[]) {
      const got = opened.shapes.get(`零件/${partName(kind)}.3dbx`)!;
      const original = rebuilt[kind].shape;
      expect(Math.abs(kernel.massProps(got).volume - HAND_VOLUME[partName(kind)]!) / HAND_VOLUME[partName(kind)]!).toBeLessThan(1e-6);
      expect(kernel.massProps(got).area / kernel.massProps(original).area).toBeCloseTo(1, 6);
      expect(kernel.topology(got).faces.length).toBe(kernel.topology(original).faces.length);
    }
    // and the second STEP file holds the same three products with the same volumes
    const back = readAssemblyStep(kernel.oc, trip.reexport(opened));
    for (const [name, volume] of back.volumes) expect(Math.abs(volume - HAND_VOLUME[name]!) / HAND_VOLUME[name]!).toBeLessThan(1e-6);
    expect([...back.volumes.keys()].sort()).toEqual(Object.keys(HAND_VOLUME).sort());
  });

  it('is a fixed point: written, read and written again, a second time round changes nothing', async () => {
    const once = trip.reexport(await trip.reopen((await trip.filesOf(flat)).out));
    const twice = trip.reexport(await trip.reopen((await trip.filesOf(once)).out));
    const a = readAssemblyTree(kernel.oc, once);
    const b = readAssemblyTree(kernel.oc, twice);
    expect(treeShape(b.nodes)).toEqual(treeShape(a.nodes));
    expect(deviation(a.nodes, b.nodes).mm).toBeLessThan(1e-6);
  });
});

describe('the golden jig as STEP with a sub-assembly used three times (3b-7, nested: 3 stations × 5 components)', () => {
  it('has 8 usages: the 3 uses of the station and the 5 components in it (15 placed parts, fewer usages than the 10 the real sample has to have)', () => {
    expect(nested.match(/NEXT_ASSEMBLY_USAGE_OCCURRENCE\(/g)!.length).toBe(3 + 5);
    expect(nested.match(/MANIFOLD_SOLID_BREP/g)).toHaveLength(3);
  });

  it('is read into one main assembly, one sub-assembly file and three part files; the sub-assembly is one file used three times', async () => {
    const { out } = await trip.filesOf(nested);
    expect(out.files.map((f) => f.path).sort()).toEqual(['夾具.3dba', '組件/工位.3dba', '零件/V型塊.3dbx', '零件/定位板.3dbx', '零件/削邊銷.3dbx'].sort());
    expect([out.parts, out.subAssemblies, out.warnings]).toEqual([3, 1, []]);
    const main = await readDocumentFile(out.files.find((f) => f.path === out.main)!.bytes);
    if (main.kind !== 'assembly') throw new Error('main');
    expect(main.doc.components).toHaveLength(3);
    expect(main.doc.files).toHaveLength(1);
    const sub = await readDocumentFile(out.files.find((f) => f.path === '組件/工位.3dba')!.bytes);
    if (sub.kind !== 'assembly') throw new Error('sub');
    expect(sub.doc.components).toHaveLength(5);
  });

  it('comes back as the same hierarchy — three stations of five components — and every part within 0.01 mm, through two levels of placement', async () => {
    const { out } = await trip.filesOf(nested);
    const again = trip.reexport(await trip.reopen(out));
    const a = readAssemblyTree(kernel.oc, nested);
    const b = readAssemblyTree(kernel.oc, again);
    expect(a.nodes).toHaveLength(3);
    a.nodes.forEach((n) => expect([n.isAssembly, n.children.length]).toEqual([true, 5]));
    expect(treeShape(b.nodes)).toEqual(treeShape(a.nodes));
    expect(b.usages).toBe(a.usages);
    const d = deviation(a.nodes, b.nodes);
    console.log(`3b-7 nested jig, 3 × 5 components: largest position difference ${d.mm.toExponential(2)} mm, largest rotation-matrix difference ${d.turn.toExponential(2)}`);
    expect(d.mm).toBeLessThan(POSE_LIMIT_MM);
    expect(d.mm).toBeLessThan(1e-6);
    expect(d.turn).toBeLessThan(1e-6);
  });

  it('puts every part where the placement of its station and its place in the station say (computed here, not read from either file)', async () => {
    const { out } = await trip.filesOf(nested);
    const parts = worldParts(readAssemblyTree(kernel.oc, trip.reexport(await trip.reopen(out))).nodes);
    const station = built.ids[0]!;
    const inner = [station.plate, station.pinA, station.pinB, station.v1, station.v2].map((id) => solved.poses.get(id)!);
    expect(parts).toHaveLength(15);
    stationPlacements.forEach((placement, s) =>
      inner.forEach((pose, k) => {
        const got = parts[s * 5 + k]!.world;
        const expected = (p: Vec3) => transformPoint(placement, transformPoint(pose, p));
        got.origin.forEach((v, i) => expect(Math.abs(v - expected([0, 0, 0])[i]!)).toBeLessThan(POSE_LIMIT_MM));
        // the turn: where the part's own x axis goes
        const ex = [got.matrix[0]!, got.matrix[3]!, got.matrix[6]!];
        const o = expected([0, 0, 0]);
        const e = expected([1, 0, 0]);
        ex.forEach((v, i) => expect(Math.abs(v - (e[i]! - o[i]!))).toBeLessThan(1e-6));
      }),
    );
  });

  it('keeps the parts, and is a fixed point', async () => {
    const opened = await trip.reopen((await trip.filesOf(nested)).out);
    for (const kind of Object.keys(FILES) as Kind[]) {
      const got = opened.shapes.get(`零件/${partName(kind)}.3dbx`)!;
      expect(Math.abs(kernel.massProps(got).volume - HAND_VOLUME[partName(kind)]!) / HAND_VOLUME[partName(kind)]!).toBeLessThan(1e-6);
      expect(kernel.topology(got).faces.length).toBe(kernel.topology(rebuilt[kind].shape).faces.length);
    }
    const once = trip.reexport(opened);
    const twice = trip.reexport(await trip.reopen((await trip.filesOf(once)).out));
    const a = readAssemblyTree(kernel.oc, once);
    const b = readAssemblyTree(kernel.oc, twice);
    expect(treeShape(b.nodes)).toEqual(treeShape(a.nodes));
    expect(deviation(a.nodes, b.nodes).mm).toBeLessThan(1e-6);
  });
});
