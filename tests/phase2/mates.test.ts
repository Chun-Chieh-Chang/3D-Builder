/**
 * Phase 2B (handoff §10): mates on real parts. The diamond pin goes into the locating plate by
 * persistent names (B4), the solver places it (A3.2) and counts its freedoms (A3.4): a pin in a hole
 * keeps one turn, and its flat squared to the plate's side takes that too. Conflicts are named; the
 * mates survive a change of the part's dimensions.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  applyAssemblyCommand,
  applyCommand,
  axisAngle,
  createEmptyAssembly,
  transformPoint,
  type AssemblyDoc,
  type Mate,
  type MateType,
  type PartDoc,
  type Pose,
  type Vec3,
} from '@3db/model';
import { readDocumentFile, readPartFile, stepAsPart, writeAssemblyFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { faceMateGeometry, Regenerator, solveAssembly, type MatePart } from '@3db/regen';

let kernel: Kernel;
let solver: PlaneGcsSolver;
let plateDoc: PartDoc;
let pinDoc: PartDoc;

beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
  const read = async (name: string) => (await readPartFile(new Uint8Array(readFileSync(new URL(`../golden/${name}`, import.meta.url))))).doc;
  plateDoc = await read('locating-plate.3dbx');
  pinDoc = await read('diamond-pin.3dbx');
});

/** A part rebuilt for mating; its regenerator is kept alive for as long as the test uses it. */
function part(doc: PartDoc): MatePart {
  const r = new Regenerator(kernel, solver).rebuild(doc);
  return { topology: r.body!.topology, names: r.body!.names, frames: r.frames };
}

const at = (position: Vec3, rotation: Pose['rotation'] = [0, 0, 0, 1]): Pose => ({ position, rotation });
const face = (name: string) => ({ kind: 'face' as const, name });
let mateIds = 0;
const mate = (type: MateType, a: [string | null, string], b: [string | null, string], extra: Partial<Mate> = {}): Mate => ({
  id: `mate${++mateIds}`,
  name: `結合${mateIds}`,
  type,
  a: { component: a[0], ref: face(a[1]) },
  b: { component: b[0], ref: face(b[1]) },
  suppressed: false,
  ...extra,
});

// Persistent names in the golden parts (tests/golden): the plate's R4 hole at x = −40, its top face
// and its side face at x = +60; the pin's R5 shank, the underside of its flange and one of its flats.
const HOLE = 'cut1:side:sketch2.ci6';
const TOP = 'extrude1:cap:end';
const SIDE = 'extrude1:side:sketch1.l4';
const SHANK = 'revolve1:side:sketch1.l3#1';
const FLANGE_UNDERSIDE = 'revolve1:side:sketch1.l4';
const FLAT = 'cut1:cap:start';

/** 定位板 fixed at the origin; 削邊銷 floating, dropped somewhere above it and tilted. */
function jig(mates: Mate[]): AssemblyDoc {
  let doc = applyAssemblyCommand(createEmptyAssembly(), {
    type: 'insertComponent',
    file: { id: 'file1', path: '定位板.3dbx' },
    component: { id: 'plate', file: 'file1', instance: 1, fixed: true, placement: at([0, 0, 0]) },
  });
  doc = applyAssemblyCommand(doc, {
    type: 'insertComponent',
    file: { id: 'file2', path: '削邊銷.3dbx' },
    component: { id: 'pin', file: 'file2', instance: 1, fixed: false, placement: at([-30, 40, 12], axisAngle([0.6, 0, 0.8], 0.4)) },
  });
  for (const m of mates) doc = applyAssemblyCommand(doc, { type: 'insertMate', mate: m });
  return doc;
}

const seat = () => [mate('concentric', ['plate', HOLE], ['pin', SHANK], { align: 'aligned' }), mate('coincident', ['plate', TOP], ['pin', FLANGE_UNDERSIDE], { align: 'antiAligned' })];

function solveWith(doc: AssemblyDoc, pin: MatePart = part(pinDoc)) {
  const parts: Record<string, MatePart> = { plate: part(plateDoc), pin };
  return solveAssembly(doc, (id) => parts[id] ?? null);
}

const where = (r: ReturnType<typeof solveAssembly>, p: Vec3) => transformPoint(r.poses.get('pin')!, p);
const close = (a: Vec3, b: Vec3) => a.forEach((v, i) => expect(v, `${a} vs ${b}`).toBeCloseTo(b[i]!, 6));

describe('the diamond pin in the locating plate (A3.2, A3.4)', () => {
  it('seated in the hole on the flange: one freedom left, turning about the hole', () => {
    const r = solveWith(jig(seat()));
    expect([...r.mates.values()]).toEqual([{ status: 'ok' }, { status: 'ok' }]);
    // The pin's axis (its y axis) is the hole's axis; its flange (at y = 15 in the pin) sits on the top (y = 15).
    close(where(r, [0, 0, 0]), [-40, 0, 0]);
    close(where(r, [0, 15, 0]), [-40, 15, 0]);
    expect(r.components.get('pin')).toEqual({ status: 'under', dof: 1 });
    expect(r.components.get('plate')).toEqual({ status: 'fixed', dof: 0 });
  });

  it('its flat squared to the plate side: fully defined', () => {
    const r = solveWith(jig([...seat(), mate('parallel', ['plate', SIDE], ['pin', FLAT], { align: 'aligned' })]));
    expect([...r.mates.values()].every((m) => m.status === 'ok')).toBe(true);
    expect(r.components.get('pin')).toEqual({ status: 'full', dof: 0 });
    // The flat's normal (+x in the pin) now points along +x of the plate.
    const x = where(r, [1, 0, 0]);
    const o = where(r, [0, 0, 0]);
    close([x[0] - o[0], x[1] - o[1], x[2] - o[2]], [1, 0, 0]);
  });

  it('names the mate that over-defines it; the pin stays seated', () => {
    const extra = mate('distance', ['plate', TOP], ['pin', FLANGE_UNDERSIDE], { value: '5', align: 'antiAligned' });
    const r = solveWith(jig([...seat(), extra]));
    expect(r.mates.get(extra.id)!.status).toBe('conflict');
    expect(r.components.get('pin')!.status).toBe('over');
    close(where(r, [0, 15, 0]), [-40, 15, 0]);
  });

  it('reports a mate whose face is gone, never binding it to another; and leaves suppressed mates out', () => {
    const lost = mate('coincident', ['plate', 'cut1:side:sketch2.ci99'], ['pin', SHANK]);
    const off = mate('distance', ['plate', TOP], ['pin', FLANGE_UNDERSIDE], { value: '5', align: 'antiAligned', suppressed: true });
    const r = solveWith(jig([...seat(), lost, off]));
    expect(r.mates.get(lost.id)).toEqual({ status: 'missing', message: '遺失參考：第一個元素「cut1:side:sketch2.ci99」找不到' });
    expect(r.mates.get(off.id)).toEqual({ status: 'suppressed' });
    expect(r.components.get('pin')).toEqual({ status: 'under', dof: 1 });
  });

  it('keeps its mates when the pin is changed: a shorter shank sits higher', () => {
    const shorter = applyCommand(pinDoc, { type: 'setDimension', featureId: 'sketch1', constraintId: 'd3', value: '13' });
    const r = solveWith(jig(seat()), part(shorter));
    expect([...r.mates.values()]).toEqual([{ status: 'ok' }, { status: 'ok' }]);
    close(where(r, [0, 0, 0]), [-40, 2, 0]);
    close(where(r, [0, 13, 0]), [-40, 15, 0]);
  });

  it('says so when a change of the pin takes away a mated face', () => {
    // At 20 mm the flats (cut from fixed heights, y 20–31) start right at the flange's underside and
    // reshape it: that face is gone, and the mate on it reports it rather than picking another face.
    const longer = applyCommand(pinDoc, { type: 'setDimension', featureId: 'sketch1', constraintId: 'd3', value: '20' });
    const r = solveWith(jig(seat()), part(longer));
    expect([...r.mates.values()].map((m) => m.status)).toEqual(['ok', 'missing']);
  });

  it('mates to a STEP file taken as a part, by the imported faces\' names', async () => {
    // tests/fixtures/step: a 40 × 30 × 10 plate with an R4 hole through it along z.
    const file = await stepAsPart(new Uint8Array(readFileSync(new URL('../fixtures/step/plate-with-hole.step', import.meta.url))), 'plate-with-hole.step');
    const r = new Regenerator(kernel, solver, file.blobs).rebuild(file.doc);
    const plate: MatePart = { topology: r.body!.topology, names: r.body!.names, frames: r.frames };
    const faceWhere = (test: (g: NonNullable<ReturnType<typeof faceMateGeometry>>) => boolean) => r.body!.names.faces[r.body!.topology.faces.findIndex((f) => { const g = faceMateGeometry(f); return !!g && test(g); })]!;
    const hole = faceWhere((g) => g.kind === 'cylinder' && !g.convex);
    const top = faceWhere((g) => g.kind === 'plane' && g.normal[2] > 0.99);
    expect([hole, top].every((n) => /^import1:f\d+$/.test(n))).toBe(true);
    const doc = jig([mate('concentric', ['plate', hole], ['pin', SHANK]), mate('coincident', ['plate', top], ['pin', FLANGE_UNDERSIDE], { align: 'antiAligned' })]);
    const result = solveAssembly(doc, (id) => (id === 'plate' ? plate : id === 'pin' ? part(pinDoc) : null));
    expect([...result.mates.values()]).toEqual([{ status: 'ok' }, { status: 'ok' }]);
    expect(result.components.get('pin')).toEqual({ status: 'under', dof: 1 });
    // The flange (y = 15 in the pin) on the plate's top (z = 10), over the hole's axis at (20, 15).
    close(where(result, [0, 15, 0]), [20, 15, 10]);
  });

  it('turns about its hole when dragged by its flange (A3.5); it cannot be moved off the hole', () => {
    const doc = jig(seat());
    const parts: Record<string, MatePart> = { plate: part(plateDoc), pin: part(pinDoc) };
    const partOf = (id: string) => parts[id] ?? null;
    const seated = solveAssembly(doc, partOf);
    // A point 10 mm off the pin's axis, level with the flange's underside; the cursor a quarter turn
    // round the hole (about +y), seen from above.
    const rim: Vec3 = [10, 15, 0];
    const w = transformPoint(seated.poses.get('pin')!, rim);
    const target: Vec3 = [-40 + w[2], 100, -(w[0] + 40)];
    const dragged = solveAssembly(doc, partOf, {
      start: seated.poses,
      goal: { body: 'pin', terms: [{ kind: 'pointOnLine', point: rim, origin: target, dir: [0, -1, 0] }, { kind: 'rotation', rotation: seated.poses.get('pin')!.rotation }] },
    });
    expect([...dragged.mates.values()]).toEqual([{ status: 'ok' }, { status: 'ok' }]);
    close(where(dragged, [0, 0, 0]), [-40, 0, 0]);
    close(where(dragged, [0, 15, 0]), [-40, 15, 0]);
    const moved = where(dragged, rim);
    close([moved[0], 15, moved[2]], [target[0], 15, target[2]]);
    expect(dragged.group).toEqual(['pin']);
    const across = solveAssembly(doc, partOf, { start: seated.poses, goal: { body: 'pin', terms: [{ kind: 'pointAt', point: [0, 0, 0], target: [0, 0, 30] }] } });
    close(where(across, [0, 0, 0]), [-40, 0, 0]);
  });

  it('mates on the part\'s own reference planes and default planes, by the feature they are', () => {
    // 基準面1 of the pin: made in the part, offset from its right plane. The mate names it by its feature.
    const ref = pinDoc.features.find((f) => f.type === 'refPlane' && f.name === '基準面1')!;
    expect(ref).toBeDefined();
    const datum = (name: string) => ({ kind: 'datum' as const, name });
    const onRef = (align: 'aligned' | 'antiAligned'): Mate => ({
      id: 'onRef',
      name: '平行',
      type: 'parallel',
      a: { component: 'plate', ref: face(SIDE) },
      b: { component: 'pin', ref: datum(ref.id) },
      align,
      suppressed: false,
    });
    const pin = part(pinDoc);
    const frame = pin.frames.get(ref.id)!;
    expect(frame).toBeDefined();
    // Seated in the hole, it turns about the hole; squared to the plate's side by its reference plane instead of the flat: fully defined.
    for (const align of ['aligned', 'antiAligned'] as const) {
      const r = solveWith(jig([...seat(), onRef(align)]), pin);
      expect([...r.mates.values()].every((m) => m.status === 'ok'), align).toBe(true);
      expect(r.components.get('pin'), align).toEqual({ status: 'full', dof: 0 });
      // Where the plane is now: its normal runs along x, with the plate side's (+x) or against it.
      const o = where(r, frame.origin);
      const n = where(r, [frame.origin[0] + frame.normal[0], frame.origin[1] + frame.normal[1], frame.origin[2] + frame.normal[2]]);
      close([n[0] - o[0], n[1] - o[1], n[2] - o[2]], [align === 'aligned' ? 1 : -1, 0, 0]);
    }

    // The default planes of a component are its own, in its own frame, not the assembly's: the pin's front
    // plane (normal z in the pin) parallel to the plate's front plane (normal z in the plate).
    const front: Mate = { id: 'front', name: '平行', type: 'parallel', a: { component: 'plate', ref: datum('plane:front') }, b: { component: 'pin', ref: datum('plane:front') }, align: 'aligned', suppressed: false };
    const r2 = solveWith(jig([...seat(), front]), pin);
    expect([...r2.mates.values()].every((m) => m.status === 'ok')).toBe(true);
    expect(r2.components.get('pin')).toEqual({ status: 'full', dof: 0 });
    const zero = where(r2, [0, 0, 0]);
    const z = where(r2, [0, 0, 1]);
    close([z[0] - zero[0], z[1] - zero[1], z[2] - zero[2]], [0, 0, 1]);
  });

  it('is saved with the assembly and solves the same after reopening', async () => {
    const doc = jig([...seat(), mate('parallel', ['plate', SIDE], ['pin', FLAT], { align: 'aligned' })]);
    const file = await readDocumentFile(await writeAssemblyFile(doc));
    expect(file.kind).toBe('assembly');
    if (file.kind !== 'assembly') return;
    expect(file.doc).toEqual(doc);
    expect(solveWith(file.doc).poses.get('pin')).toEqual(solveWith(doc).poses.get('pin'));
  });
});
