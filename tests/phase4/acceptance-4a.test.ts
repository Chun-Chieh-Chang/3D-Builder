/**
 * Phase 4a-6 (docs/phase4a-plan.md §驗收), the part of the acceptance that needs no sample of the user's. The fixture of the blueprint's §2.9 end to end, on a
 * workpiece made here (a block, as a STEP file): a master model of three bodies — the workpiece (a reference body), a base plate with two dowel pin holes, a
 * clamp with a screw hole — made into an assembly of derived parts; dowel pins (ISO 8734) and a screw (ISO 4762) from the library mated into the holes by
 * persistent names; interference and clearance checked against what is known by hand; the base plate made thicker in the master; the STEP of the assembly
 * through the whole round again.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildBom, type SourceTree, type Vec3 } from '@3db/model';
import { componentName, exportAssemblyStep, partNameOf, readDocumentFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { findClearance, findInterference, Regenerator, sweepClearance } from '@3db/regen';
import { openPart } from '../support/derivedProject';
import { assemble as jigAssemble, componentsAt, master as jigMaster, PIN_PATH, SCREW_PATH, shapeOf, workpieceStep, type Opened, type Project } from '../support/jigFixture';
import { readAssemblyTree } from '../support/readAssemblyStep';
import { stepRoundTrip, treeShape, worldParts } from '../support/stepRoundTrip';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const kept: Regenerator[] = [];
let trip: ReturnType<typeof stepRoundTrip>;
let stepBytes: Uint8Array;

beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
  trip = stepRoundTrip(kernel, solver, kept);
  stepBytes = workpieceStep(kernel, solver, kept);
});
afterAll(() => kept.forEach((r) => r.dispose()));

const ctx = () => ({ kernel, solver, kept, stepBytes });
const assemble = (depth = '15') => jigAssemble(ctx(), depth);
const master = (depth = '15') => jigMaster(ctx(), depth);
void master;

describe('the fixture of the blueprint\'s §2.9, on a workpiece made here (4a-6)', () => {
  let p: Project;
  let o: Opened;
  beforeAll(async () => {
    ({ p, o } = await assemble());
  });

  it('① the master has three bodies — the workpiece a reference body — and an assembly of derived parts is made from them', async () => {
    const m = await openPart(kernel, solver, kept, p.files, '夾具.3dbx');
    expect(m.problems).toEqual([]);
    expect(m.reference).toEqual([true, false, false]);
    expect([...o.parts].map(([path, part]) => [path, part.problems])).toEqual([...o.parts].map(([path]) => [path, []]));
    expect(p.doc.components).toHaveLength(6);
    expect(p.doc.files.map((f) => f.path)).toEqual(['零件/工件.3dbx', '零件/基板.3dbx', '零件/壓板.3dbx', PIN_PATH, SCREW_PATH]);
    // the volumes of the derived parts, by hand: the workpiece 40 × 30 × 20; the plate 100 × 80 × 15 less two Ø6 holes and their 0.5 chamfers; the clamp 30 × 20 × 10 less a Ø6.6 hole
    const chamfer = (R: number, c: number) => (Math.PI * c * ((R + c) ** 2 + (R + c) * R + R ** 2)) / 3 - Math.PI * R * R * c;
    expect(o.parts.get('零件/工件.3dbx')!.volume).toBeCloseTo(40 * 30 * 20, 6);
    expect(o.parts.get('零件/基板.3dbx')!.volume).toBeCloseTo(100 * 80 * 15 - 2 * (Math.PI * 9 * 15 + chamfer(3, 0.5)), 6);
    expect(o.parts.get('零件/壓板.3dbx')!.volume).toBeCloseTo(30 * 20 * 10 - Math.PI * 3.3 * 3.3 * 10, 6);
  });

  it('① the pins and the screw from the library are mated into the holes by persistent names, and every mate holds', () => {
    expect([...o.solved.mates.values()].map((m) => m.status)).toEqual(Array(6).fill('ok'));
    const at = (id: string, q: Vec3 = [0, 0, 0]) => {
      const pose = o.solved.poses.get(id)!;
      const [x, y, z, w] = pose.rotation;
      const r = [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
      return [0, 1, 2].map((i) => r[3 * i]! * q[0] + r[3 * i + 1]! * q[1] + r[3 * i + 2]! * q[2] + pose.position[i]!) as Vec3;
    };
    // a pin hangs from its top: the top is on the plate's top (z = 15), in the middle of the hole (x = ±40, y = 0)
    for (const [id, x] of [['pin1', -40], ['pin2', 40]] as const) {
      const top = at(id);
      expect([top[0], top[1], top[2]]).toEqual([expect.closeTo(x, 5), expect.closeTo(0, 5), expect.closeTo(15, 5)]);
      const bottom = at(id, [0, -20, 0]);
      expect(bottom[2]).toBeCloseTo(-5, 5); // 20 long, the pin goes 5 below the plate (15 thick)
    }
    // the screw's head underside is on the clamp's top (z = 25), in the middle of its hole (x = 0, y = 25)
    const head = at('screw1');
    expect([head[0], head[1], head[2]]).toEqual([expect.closeTo(0, 5), expect.closeTo(25, 5), expect.closeTo(25, 5)]);
    expect(o.solved.components.get('pin1')).toEqual({ status: 'under', dof: 1 }); // a pin can still turn about its hole
  });

  it('② interference: none — what touches (the workpiece on the plate, the clamp, the pins in their holes, the screw) shares no volume', () => {
    const found = findInterference(kernel, componentsAt(p, o), shapeOf(o));
    expect(found.failed).toEqual([]);
    expect(found.unknown).toEqual([]);
    expect(found.overlaps.map((x) => [x.a, x.b])).toEqual([]);
  });

  it('② clearance: the workpiece to a pin is 17.03 mm (17 across, 1 down to the pin side below its chamfered top); everything that touches is 0, none of it interference', () => {
    const rows = findClearance(kernel, componentsAt(p, o), shapeOf(o), 30).rows;
    expect(rows.every((r) => !r.interferes)).toBe(true);
    const between = (a: string, b: string) => rows.find((r) => (r.a === a && r.b === b) || (r.a === b && r.b === a));
    const compOf = (body: number) => p.doc.components[body]!.id;
    // the pin's top edge is chamfered 1 mm, so its nearest point to the workpiece's bottom edge is the side of the pin 1 mm below the top: sqrt(17^2 + 1^2)
    expect(between(compOf(0), 'pin1')!.distance).toBeCloseTo(Math.hypot(17, 1), 6);
    expect(between(compOf(0), 'pin2')!.distance).toBeCloseTo(Math.hypot(17, 1), 6);
    expect(between(compOf(0), compOf(1))!.distance).toBeCloseTo(0, 9); // the workpiece stands on the plate
    expect(between(compOf(1), 'pin1')!.distance).toBeCloseTo(0, 9);
    expect(between('screw1', compOf(2))!.distance).toBeCloseTo(0, 9);
  });

  it('② room to take the pieces out: the pins and the clamp go straight up, the workpiece up and away from the clamp, and not down into the plate or toward the clamp', () => {
    const comps = componentsAt(p, o);
    const compOf = (body: number) => p.doc.components[body]!.id;
    const room = (id: string, dir: Vec3, length = 80) => sweepClearance(kernel, comps, id, dir, length, shapeOf(o));
    expect(room('pin1', [0, 0, 1])).toMatchObject({ travel: 80, blocker: null });
    expect(room('pin2', [0, 0, 1])).toMatchObject({ travel: 80, blocker: null });
    expect(room('screw1', [0, 0, 1])).toMatchObject({ travel: 80, blocker: null });
    // the clamp cannot come up with the screw in it: the head is in the way, at once
    const clampUp = room(compOf(2), [0, 0, 1]);
    expect(clampUp.travel).toBeLessThan(0.01);
    expect(clampUp.blocker).toBe('screw1');
    expect(room(compOf(0), [0, 0, 1])).toMatchObject({ travel: 80, blocker: null });
    expect(room(compOf(0), [0, -1, 0])).toMatchObject({ travel: 80, blocker: null }); // slides off the plate, away from the clamp
    const down = room(compOf(0), [0, 0, -1]);
    expect(down.travel).toBeLessThan(0.01);
    expect(down.blocker).toBe(compOf(1));
    const toward = room(compOf(0), [0, 1, 0]);
    expect(toward.travel).toBeLessThan(0.01);
    expect(toward.blocker).toBe(compOf(2));
  });

  it('the parts list: the base plate, the clamp, two pins and a screw; the workpiece is a reference body and is left out', async () => {
    const trees: Record<string, SourceTree> = {};
    for (const c of p.doc.components) trees[c.id] = { kind: 'part', key: o.pathOf(c.id), path: o.pathOf(c.id) };
    const props = new Map<string, Record<string, string>>();
    for (const f of p.doc.files) {
      const file = await readDocumentFile(p.files.get(f.path)!);
      props.set(f.path, file.kind === 'part' ? file.doc.properties : {});
    }
    const bom = buildBom({ doc: p.doc, trees, propsOf: (key) => props.get(key), isReference: (key) => o.parts.get(key)!.reference.every(Boolean) });
    expect(bom.flat.map((r) => [r.name, r.qty, r.partNo])).toEqual([['基板', 1, ''], ['壓板', 1, ''], ['ISO 8734 6m6x20', 2, 'ISO 8734 6m6x20'], ['ISO 4762 M6x10', 1, 'ISO 4762 M6x10']]);
  });

  it('④ the STEP of the assembly goes round — written, read into files, opened, written again — with every part within 0.01 mm of where it was and the same tree', async () => {
    const doc = p.doc;
    const parts = doc.files.map((f) => ({ shape: o.parts.get(f.path)!.shape, name: partNameOf(f.path) }));
    const instances = doc.components.map((c) => ({ part: doc.files.findIndex((f) => f.id === c.file), name: componentName(doc.files.find((f) => f.id === c.file)?.path, c.instance), pose: o.solved.poses.get(c.id)! }));
    const text = exportAssemblyStep(kernel, '夾具', parts, instances);
    expect(text.match(/NEXT_ASSEMBLY_USAGE_OCCURRENCE\(/g)).toHaveLength(6);
    expect(text.match(/MANIFOLD_SOLID_BREP/g)).toHaveLength(5);
    const { out } = await trip.filesOf(text);
    const again = trip.reexport(await trip.reopen(out));
    const a = readAssemblyTree(kernel.oc, text);
    const b = readAssemblyTree(kernel.oc, again);
    expect(treeShape(b.nodes)).toEqual(treeShape(a.nodes));
    const pa = worldParts(a.nodes);
    const pb = worldParts(b.nodes);
    expect(pb).toHaveLength(6);
    pa.forEach((x, i) => {
      expect(pb[i]!.name).toBe(x.name);
      expect(Math.hypot(...x.world.origin.map((v, k) => v - pb[i]!.world.origin[k]!))).toBeLessThan(0.01);
    });
  });
});

describe('③ the base plate made 20 thick in the master (4a-6)', () => {
  it('the derived plate, the pins and the screw follow: every mate holds, the pins stand on the new top (z = 20), and the workpiece and the clamp, which the master leaves where they were, now go into the plate', async () => {
    const { p, o } = await assemble('20');
    const compOf = (body: number) => p.doc.components[body]!.id;
    expect([...o.parts].map(([path, part]) => [path, part.problems])).toEqual([...o.parts].map(([path]) => [path, []]));
    expect([...o.solved.mates.values()].map((m) => m.status)).toEqual(Array(6).fill('ok'));
    // the plate is 20 thick: 100 × 80 × 20 less the holes (the same chamfers) — the derived part is the master's body, not a copy of the old one
    const chamfer = (R: number, c: number) => (Math.PI * c * ((R + c) ** 2 + (R + c) * R + R ** 2)) / 3 - Math.PI * R * R * c;
    // (the clamp's hole is cut into every body it reaches, and now reaches the plate's top 5 mm: Ø6.6 × 5 more)
    expect(o.parts.get('零件/基板.3dbx')!.volume).toBeCloseTo(100 * 80 * 20 - 2 * (Math.PI * 9 * 20 + chamfer(3, 0.5)) - Math.PI * 3.3 * 3.3 * 5, 6);
    const pin = o.solved.poses.get('pin1')!;
    expect(pin.position[2]).toBeCloseTo(20, 5); // the pin's top, where its origin is, on the new top of the plate
    expect(o.solved.poses.get('pin2')!.position[2]).toBeCloseTo(20, 5);
    // what was fitted now overlaps: interference finds the plate with the workpiece and with the clamp (z = 15…20 of each is in the plate)
    const found = findInterference(kernel, componentsAt(p, o), shapeOf(o));
    const pairs = found.overlaps.map((x) => [x.a, x.b].sort().join('|')).sort();
    expect(pairs).toEqual([[compOf(0), compOf(1)].sort().join('|'), [compOf(1), compOf(2)].sort().join('|')].sort());
    const volume = Object.fromEntries(found.overlaps.map((x) => [[x.a, x.b].sort().join('|'), x.volume]));
    expect(volume[[compOf(0), compOf(1)].sort().join('|')]).toBeCloseTo(40 * 30 * 5, 3);
    for (const x of found.overlaps) kernel.release(x.shape);
  });
});
