/**
 * Phase 4a-6 (docs/phase4a-plan.md §驗收), the part of the acceptance that needs no sample of the user's. The fixture of the blueprint's §2.9 end to end, on a
 * workpiece made here (a block, as a STEP file): a master model of three bodies — the workpiece (a reference body), a base plate with two dowel pin holes, a
 * clamp with a screw hole — made into an assembly of derived parts; dowel pins (ISO 8734) and a screw (ISO 4762) from the library mated into the holes by
 * persistent names; interference and clearance checked against what is known by hand; the base plate made thicker in the master; the STEP of the assembly
 * through the whole round again.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAssemblyCommand, applyCommand, buildBom, createEmptyPart, type AssemblyDoc, type Feature, type Mate, type MateRef, type PartDoc, type Pose, type SourceTree, type Vec3 } from '@3db/model';
import { componentName, derivedAssemblyFiles, exportAssemblyStep, partNameOf, readDocumentFile, sha256Hex, writePartFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { faceMateGeometry, findClearance, findInterference, Regenerator, solveAssembly, sweepClearance } from '@3db/regen';
import { standardName, standardPartDoc, STANDARD_FACES, type StandardSpec } from '@3db/library';
import { build, extrude, front, rectangle, sketch } from '../phase1/builders';
import { openPart, type OpenedPart } from '../support/derivedProject';
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
  // the workpiece: a block of 40 × 30 × 20 standing on the base plate (z = 15 to 35), centred on x and y, as a STEP file
  const regen = new Regenerator(kernel, solver);
  kept.push(regen);
  const block = regen.rebuild(build(sketch('s', front, rectangle('w', -20, -15, 40, 30)), extrude('e', 's', 'boss', { type: 'blind', depth: '20' }))).body!.shape;
  const lifted = kernel.transformed(block, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 15]);
  stepBytes = new TextEncoder().encode(kernel.exportStep(lifted, 'workpiece'));
});
afterAll(() => kept.forEach((r) => r.dispose()));

const own = (e: Feature): Feature => ({ ...e, merge: false }) as Feature;
const face = (name: string) => ({ kind: 'face' as const, name });
const points = (sketchId: string, plane: Feature extends never ? never : Parameters<typeof sketch>[1], ...pts: [string, number, number][]): Feature => ({ ...sketch(sketchId, plane), entities: pts.map(([id, x, y]) => ({ id, type: 'point', x, y })) }) as Feature;

/** The master: the workpiece as imported, a base plate 100 × 80 (x −50…50, y −40…40) `depth` thick with two Ø6 H7 dowel holes at x = ±40, a clamp 30 × 20 × 10 on it, against the workpiece's +y side (x −15…15, y 15…35), with a Ø6.6 hole. A sketch on a face has its origin where the part's origin projects onto it, so its points are in the assembly's x and y. */
async function master(depth = '15'): Promise<{ doc: PartDoc; blobs: Map<string, Uint8Array> }> {
  const sha256 = await sha256Hex(stepBytes);
  let doc = applyCommand(createEmptyPart(), { type: 'importBody', blob: { id: 'blob1', sha256, kind: 'step', fileName: '工件.step' }, feature: { id: 'import1', type: 'importedBody', name: '輸入1', suppressed: false, blob: 'blob1' }, index: 0 });
  const features: Feature[] = [
    sketch('sp', front, rectangle('a', -50, -40, 100, 80)),
    own(extrude('eb', 'sp', 'boss', { type: 'blind', depth })),
    { id: 'rp1', type: 'refPlane', name: 'rp1', suppressed: false, def: { mode: 'offset', plane: { kind: 'datum', name: 'plane:front' }, distance: '15' } } as Feature,
    sketch('sc', { kind: 'datum', name: 'rp1' }, rectangle('c', -15, 15, 30, 20)),
    own(extrude('ec', 'sc', 'boss', { type: 'blind', depth: '10' })),
    points('sh', face('eb:cap:end'), ['p1', -40, 0], ['p2', 40, 0]),
    { id: 'hd', type: 'hole', name: 'hd', suppressed: false, sketch: 'sh', kind: 'dowel', diameter: '6', fit: 'H7', chamfer: '0.5', end: { type: 'throughAll' } } as Feature,
    points('sk2', face('ec:cap:end'), ['q1', 0, 25]),
    { id: 'hc', type: 'hole', name: 'hc', suppressed: false, sketch: 'sk2', kind: 'straight', diameter: '6.6', end: { type: 'blind', depth: '10' } } as Feature,
  ];
  features.forEach((feature, i) => {
    doc = applyCommand(doc, { type: 'insertFeature', feature, index: i + 1 });
  });
  doc = applyCommand(doc, { type: 'setBody', bodyId: 'import1', name: '工件', reference: true });
  doc = applyCommand(doc, { type: 'setBody', bodyId: 'eb', name: '基板' });
  doc = applyCommand(doc, { type: 'setBody', bodyId: 'ec', name: '壓板' });
  return { doc, blobs: new Map([[sha256, stepBytes]]) };
}

const PIN: StandardSpec = { kind: 'dowelPin', size: '6', length: 20 };
const SCREW: StandardSpec = { kind: 'socketScrew', size: 'M6', length: 10 };
const PIN_PATH = `標準件/${standardName(PIN)}.3dbx`;
const SCREW_PATH = `標準件/${standardName(SCREW)}.3dbx`;
const PLATE_TOP = 'eb:cap:end';
const HOLE_1 = 'hd:side:sh.p1.wall';
const HOLE_2 = 'hd:side:sh.p2.wall';
const CLAMP_TOP = 'ec:cap:end';
const CLAMP_HOLE = 'hc:side:sk2.q1.wall';

interface Project {
  files: Map<string, Uint8Array>;
  /** The assembly of the derived parts with the pins and the screw inserted, and their mates. */
  doc: AssemblyDoc;
}

interface Opened {
  parts: Map<string, OpenedPart>;
  pathOf: (componentId: string) => string;
  solved: ReturnType<typeof solveAssembly>;
}

/** The sign of the angle between the axis of a cylindrical face and the normal of a plane face of a part: +1 along it, −1 against it. */
function axisSign(part: OpenedPart, cylinder: string, plane: string): number {
  const geometry = (name: string) => faceMateGeometry(part.mate.topology.faces[part.mate.names.faces.indexOf(name)]!);
  const c = geometry(cylinder);
  const n = geometry(plane);
  if (c?.kind !== 'cylinder' || n?.kind !== 'plane') throw new Error(`${cylinder} or ${plane} is not what the mate needs`);
  return Math.sign(c.axis[0] * n.normal[0] + c.axis[1] * n.normal[1] + c.axis[2] * n.normal[2]);
}

/**
 * The fixture made into files, as the app makes them — the derived parts and their assembly from the master's bodies, the library parts — and mated. Which
 * way round a concentric mate goes is what the user picks with 「同向對齊／反向對齊」; here it is worked out from the faces, so that the pin's top and the plate's
 * top face the same way and the screw's head underside faces the clamp's top.
 */
async function assemble(depth = '15'): Promise<{ p: Project; o: Opened }> {
  const m = await master(depth);
  const made = await derivedAssemblyFiles({ masterFile: '夾具.3dbx', stem: '夾具', bodies: [{ id: 'import1', name: '工件' }, { id: 'eb', name: '基板' }, { id: 'ec', name: '壓板' }] });
  const files = new Map<string, Uint8Array>([['夾具.3dbx', await writePartFile(m.doc, m.blobs)], ...made.files.map((f) => [f.path, f.bytes] as const)]);
  files.set(PIN_PATH, await writePartFile(standardPartDoc(PIN)));
  files.set(SCREW_PATH, await writePartFile(standardPartDoc(SCREW)));
  const main = await readDocumentFile(files.get(made.main)!);
  if (main.kind !== 'assembly') throw new Error('main');
  let doc = main.doc;
  const at = (position: Vec3): Pose => ({ position, rotation: [0, 0, 0, 1] });
  const add = (id: string, file: string, path: string, instance: number, position: Vec3) => {
    doc = applyAssemblyCommand(doc, { type: 'insertComponent', ...(instance === 1 ? { file: { id: file, path } } : {}), component: { id, file, instance, fixed: false, placement: at(position) } });
  };
  add('pin1', 'file4', PIN_PATH, 1, [-37, 4, 3]);
  add('pin2', 'file4', PIN_PATH, 2, [38, -5, 12]);
  add('screw1', 'file5', SCREW_PATH, 1, [4, 30, 2]);
  const parts = new Map<string, OpenedPart>();
  for (const f of doc.files) parts.set(f.path, await openPart(kernel, solver, kept, files, f.path));
  const pathOf = (id: string) => doc.files.find((f) => f.id === doc.components.find((c) => c.id === id)!.file)!.path;
  const [workpiece, plate, clamp] = doc.components.slice(0, 3).map((c) => c.id) as [string, string, string];
  void workpiece;
  const ref = (component: string, name: string): MateRef => ({ component, ref: { kind: 'face', name } });
  let n = 0;
  const mate = (type: Mate['type'], a: MateRef, b: MateRef, align?: Mate['align']) => {
    doc = applyAssemblyCommand(doc, { type: 'insertMate', mate: { id: `mate${++n}`, name: `結合${n}`, type, a, b, suppressed: false, ...(align ? { align } : {}) } });
  };
  const platePart = parts.get(pathOf(plate))!;
  const pinPart = parts.get(PIN_PATH)!;
  const clampPart = parts.get(pathOf(clamp))!;
  const screwPart = parts.get(SCREW_PATH)!;
  // the pin's top faces the way the plate's top does: its axis runs along the hole's when the two signs agree
  const pinAlign: Mate['align'] = axisSign(platePart, HOLE_1, PLATE_TOP) * axisSign(pinPart, STANDARD_FACES.dowelPin.side, STANDARD_FACES.dowelPin.top) > 0 ? 'aligned' : 'antiAligned';
  for (const [pin, hole] of [['pin1', HOLE_1], ['pin2', HOLE_2]] as const) {
    mate('concentric', ref(plate, hole), ref(pin, STANDARD_FACES.dowelPin.side), pinAlign);
    mate('coincident', ref(plate, PLATE_TOP), ref(pin, STANDARD_FACES.dowelPin.top), 'aligned');
  }
  // the screw's head underside faces against the clamp's top
  const screwAlign: Mate['align'] = -axisSign(clampPart, CLAMP_HOLE, CLAMP_TOP) * axisSign(screwPart, STANDARD_FACES.socketScrew.shank, STANDARD_FACES.socketScrew.under) > 0 ? 'aligned' : 'antiAligned';
  mate('concentric', ref(clamp, CLAMP_HOLE), ref('screw1', STANDARD_FACES.socketScrew.shank), screwAlign);
  mate('coincident', ref(clamp, CLAMP_TOP), ref('screw1', STANDARD_FACES.socketScrew.under), 'antiAligned');
  const solved = solveAssembly(doc, (id) => parts.get(pathOf(id))!.mate);
  return { p: { files, doc }, o: { parts, pathOf, solved } };
}

const componentsAt = (p: Project, o: Opened) => p.doc.components.map((c) => ({ id: c.id, parts: [{ part: o.pathOf(c.id), mirrored: false, pose: o.solved.poses.get(c.id)! }] }));
const shapeOf = (o: Opened) => (key: string) => o.parts.get(key)?.shape ?? null;

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
