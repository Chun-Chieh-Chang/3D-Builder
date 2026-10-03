/**
 * The fixture of the blueprint's §2.9 as the 4a acceptance builds it (docs/phase4a-plan.md): a master model of three bodies — a workpiece (a reference body), a
 * base plate with two dowel pin holes, a clamp with a screw hole — made into an assembly of derived parts, with dowel pins and a screw from the library mated into
 * the holes by persistent names. Shared by the acceptance of 4a and the drawings of Phase 5.
 */
import { applyAssemblyCommand, applyCommand, createEmptyPart, type AssemblyDoc, type Feature, type Mate, type MateRef, type PartDoc, type Pose, type Vec3 } from '@3db/model';
import { derivedAssemblyFiles, readDocumentFile, sha256Hex, writePartFile } from '@3db/io';
import type { PlaneGcsSolver } from '@3db/sketch';
import type { Kernel } from '@3db/kernel';
import { faceMateGeometry, Regenerator, solveAssembly } from '@3db/regen';
import { standardName, standardPartDoc, STANDARD_FACES, type StandardSpec } from '@3db/library';
import { build, extrude, front, rectangle, sketch } from '../phase1/builders';
import { openPart, type OpenedPart } from './derivedProject';

export interface JigContext {
  kernel: Kernel;
  solver: PlaneGcsSolver;
  kept: Regenerator[];
  /** The workpiece as a STEP file (`workpieceStep`). */
  stepBytes: Uint8Array;
}

/** The workpiece: a block of 40 × 30 × 20 standing on the base plate (z = 15 to 35), centred on x and y, as a STEP file. */
export function workpieceStep(kernel: Kernel, solver: PlaneGcsSolver, kept: Regenerator[]): Uint8Array {
  const regen = new Regenerator(kernel, solver);
  kept.push(regen);
  const block = regen.rebuild(build(sketch('s', front, rectangle('w', -20, -15, 40, 30)), extrude('e', 's', 'boss', { type: 'blind', depth: '20' }))).body!.shape;
  const lifted = kernel.transformed(block, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 15]);
  return new TextEncoder().encode(kernel.exportStep(lifted, 'workpiece'));
}

const own = (e: Feature): Feature => ({ ...e, merge: false }) as Feature;
const face = (name: string) => ({ kind: 'face' as const, name });
const points = (sketchId: string, plane: Feature extends never ? never : Parameters<typeof sketch>[1], ...pts: [string, number, number][]): Feature => ({ ...sketch(sketchId, plane), entities: pts.map(([id, x, y]) => ({ id, type: 'point', x, y })) }) as Feature;

/** The master: the workpiece as imported, a base plate 100 × 80 (x −50…50, y −40…40) `depth` thick with two Ø6 H7 dowel holes at x = ±40, a clamp 30 × 20 × 10 on it, against the workpiece's +y side (x −15…15, y 15…35), with a Ø6.6 hole. A sketch on a face has its origin where the part's origin projects onto it, so its points are in the assembly's x and y. */
export async function master(ctx: JigContext, depth = '15'): Promise<{ doc: PartDoc; blobs: Map<string, Uint8Array> }> {
  const sha256 = await sha256Hex(ctx.stepBytes);
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
  return { doc, blobs: new Map([[sha256, ctx.stepBytes]]) };
}

export const PIN: StandardSpec = { kind: 'dowelPin', size: '6', length: 20 };
export const SCREW: StandardSpec = { kind: 'socketScrew', size: 'M6', length: 10 };
export const PIN_PATH = `標準件/${standardName(PIN)}.3dbx`;
export const SCREW_PATH = `標準件/${standardName(SCREW)}.3dbx`;
export const PLATE_TOP = 'eb:cap:end';
export const HOLE_1 = 'hd:side:sh.p1.wall';
export const HOLE_2 = 'hd:side:sh.p2.wall';
export const CLAMP_TOP = 'ec:cap:end';
export const CLAMP_HOLE = 'hc:side:sk2.q1.wall';

export interface Project {
  files: Map<string, Uint8Array>;
  /** The assembly of the derived parts with the pins and the screw inserted, and their mates. */
  doc: AssemblyDoc;
}

export interface Opened {
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
export async function assemble(ctx: JigContext, depth = '15'): Promise<{ p: Project; o: Opened }> {
  const m = await master(ctx, depth);
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
  for (const f of doc.files) parts.set(f.path, await openPart(ctx.kernel, ctx.solver, ctx.kept, files, f.path));
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

export const componentsAt = (p: Project, o: Opened) => p.doc.components.map((c) => ({ id: c.id, parts: [{ part: o.pathOf(c.id), mirrored: false, pose: o.solved.poses.get(c.id)! }] }));
export const shapeOf = (o: Opened) => (key: string) => o.parts.get(key)?.shape ?? null;
