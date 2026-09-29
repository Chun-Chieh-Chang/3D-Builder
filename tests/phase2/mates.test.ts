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
import { readDocumentFile, readPartFile, writeAssemblyFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, solveAssembly, type MatePart } from '@3db/regen';

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

  it('is saved with the assembly and solves the same after reopening', async () => {
    const doc = jig([...seat(), mate('parallel', ['plate', SIDE], ['pin', FLAT], { align: 'aligned' })]);
    const file = await readDocumentFile(await writeAssemblyFile(doc));
    expect(file.kind).toBe('assembly');
    if (file.kind !== 'assembly') return;
    expect(file.doc).toEqual(doc);
    expect(solveWith(file.doc).poses.get('pin')).toEqual(solveWith(doc).poses.get('pin'));
  });
});
