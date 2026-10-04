/**
 * The golden jig of Phase 2F, shared by the tests that put it through other things (STEP, 3b acceptance): fifteen components of the three
 * golden parts — three locating plates in a row, each with two pins and a stack of two V-blocks — put together by 39 mates on persistent names.
 * Its hand count (components defined, poses, mates) is checked in `tests/phase2/golden-assembly.test.ts`; here it is only built.
 */
import { readFileSync } from 'node:fs';
import { applyAssemblyCommand, axisAngle, createEmptyAssembly, type AssemblyDoc, type Mate, type MateType, type PartDoc, type Pose, type Vec3 } from '@3db/model';
import { readPartFile } from '@3db/io';
import type { PlaneGcsSolver } from '@3db/sketch';
import type { Kernel } from '@3db/kernel';
import { faceMateGeometry, Regenerator, solveAssembly, type AssemblyResult, type MatePart } from '@3db/regen';

export const FILES = { plate: '定位板.3dbx', pin: '零件/削邊銷.3dbx', vblock: 'V型塊.3dbx' } as const;
export type Kind = keyof typeof FILES;
const GOLDEN: Record<Kind, string> = { plate: 'locating-plate.3dbx', pin: 'diamond-pin.3dbx', vblock: 'v-block.3dbx' };

export async function loadGoldenParts(): Promise<Record<Kind, PartDoc>> {
  const docs = {} as Record<Kind, PartDoc>;
  for (const k of Object.keys(FILES) as Kind[]) docs[k] = (await readPartFile(new Uint8Array(readFileSync(new URL(`../golden/${GOLDEN[k]}`, import.meta.url))))).doc;
  return docs;
}

/** A part rebuilt for mating and for export; the caller keeps `kept` alive as long as the shapes are used. */
export function rebuildPart(kernel: Kernel, solver: PlaneGcsSolver, kept: Regenerator[], doc: PartDoc) {
  const regen = new Regenerator(kernel, solver);
  kept.push(regen);
  const r = regen.rebuild(doc);
  const body = r.body!;
  return { mate: { topology: body.topology, names: body.names, frames: r.frames } as MatePart, shape: body.shape };
}

// ---------------------------------------------------------------- the elements the mates use, by persistent name

export const face = (name: string) => ({ kind: 'face' as const, name });
const datum = (name: 'plane:right' | 'plane:front') => ({ kind: 'datum' as const, name });
const TOP = 'extrude1:cap:end';
const HOLE_LEFT = 'cut1:side:sketch2.ci6'; // R4 through hole at x = −40
const HOLE_RIGHT = 'cut1:side:sketch2.ci5'; // at x = +40
const SHANK = 'revolve1:side:sketch1.l3#1';
const FLANGE_UNDERSIDE = 'revolve1:side:sketch1.l4';
const FLAT = 'cut1:cap:start';
const PLATE_RIGHT_SIDE = 'extrude1:side:sketch1.l4';

/** The name of the plane face of a part with this normal that lies furthest along it (the top, a side …). */
export function outermostPlane(part: MatePart, normal: Vec3): string {
  let best: { name: string; d: number } | null = null;
  part.topology.faces.forEach((f, i) => {
    const g = faceMateGeometry(f);
    if (g?.kind !== 'plane' || g.normal.some((v, k) => Math.abs(v - normal[k]!) > 1e-9)) return;
    const d = g.origin[0] * normal[0] + g.origin[1] * normal[1] + g.origin[2] * normal[2];
    if (!best || d > best.d) best = { name: part.names.faces[i]!, d };
  });
  if (!best) throw new Error(`no plane face with normal ${normal}`);
  return (best as { name: string }).name;
}

// ---------------------------------------------------------------- the assembly

const at = (position: Vec3, rotation: Pose['rotation'] = [0, 0, 0, 1]): Pose => ({ position, rotation });
export const PITCH = 120; // the plates are 120 wide
export const stations = [0, 1, 2];

export interface Jig {
  doc: AssemblyDoc;
  /** Component ids by role, per station. */
  ids: { plate: string; pinA: string; pinB: string; v1: string; v2: string }[];
}

/** Built once from the parts' names; the placements are where a user would drop the parts: near, and not square. */
export function jig(names: { plateRight: string; plateLeft: string; plateBack: string; vTop: string; vBottom: string }): Jig {
  let doc = createEmptyAssembly();
  const fileIds: Record<Kind, string> = { plate: 'file1', pin: 'file2', vblock: 'file3' };
  const used = new Set<Kind>();
  const instances: Record<Kind, number> = { plate: 0, pin: 0, vblock: 0 };
  const ids: Jig['ids'] = [];
  let n = 0;
  const insert = (kind: Kind, fixed: boolean, placement: Pose) => {
    const id = `comp${++n}`;
    doc = applyAssemblyCommand(doc, {
      type: 'insertComponent',
      ...(used.has(kind) ? {} : { file: { id: fileIds[kind], path: FILES[kind] } }),
      component: { id, file: fileIds[kind], instance: ++instances[kind], fixed, placement },
    });
    used.add(kind);
    return id;
  };
  let mates = 0;
  const mate = (type: MateType, a: [string, ReturnType<typeof face> | ReturnType<typeof datum>], b: [string, ReturnType<typeof face> | ReturnType<typeof datum>], align?: Mate['align']) => {
    const m: Mate = { id: `mate${++mates}`, name: `結合${mates}`, type, a: { component: a[0], ref: a[1] }, b: { component: b[0], ref: b[1] }, suppressed: false, ...(align ? { align } : {}) };
    doc = applyAssemblyCommand(doc, { type: 'insertMate', mate: m });
  };
  const drop = (x: number, y: number, z: number, s: number): Pose => at([x + 4 * s, y + 3 * s, z - 5 * s], axisAngle([0.6, 0.8, 0], 0.2 + 0.05 * s));

  for (const s of stations) {
    const x = s * PITCH;
    const plate = insert('plate', s === 0, s === 0 ? at([0, 0, 0]) : drop(x, 0, 0, s));
    if (s > 0) {
      const before = ids[s - 1]!.plate;
      mate('coincident', [before, face(names.plateRight)], [plate, face(names.plateLeft)], 'antiAligned');
      mate('coincident', [before, face(names.plateBack)], [plate, face(names.plateBack)], 'aligned');
      mate('coincident', [before, face(TOP)], [plate, face(TOP)], 'aligned');
    }
    const pinA = insert('pin', false, drop(x - 40, 30, 0, s + 1));
    mate('concentric', [plate, face(HOLE_LEFT)], [pinA, face(SHANK)], 'aligned');
    mate('coincident', [plate, face(TOP)], [pinA, face(FLANGE_UNDERSIDE)], 'antiAligned');
    mate('parallel', [plate, face(PLATE_RIGHT_SIDE)], [pinA, face(FLAT)], 'aligned');
    const pinB = insert('pin', false, drop(x + 40, 30, 0, s + 2));
    mate('concentric', [plate, face(HOLE_RIGHT)], [pinB, face(SHANK)], 'aligned');
    mate('coincident', [plate, face(TOP)], [pinB, face(FLANGE_UNDERSIDE)], 'antiAligned');
    const v1 = insert('vblock', false, drop(x, 30, 0, s + 3));
    mate('coincident', [plate, face(TOP)], [v1, face(names.vBottom)], 'antiAligned');
    mate('coincident', [plate, datum('plane:right')], [v1, datum('plane:right')], 'aligned');
    mate('coincident', [plate, datum('plane:front')], [v1, datum('plane:front')], 'aligned');
    const v2 = insert('vblock', false, drop(x, 80, 0, s + 4));
    mate('coincident', [v1, face(names.vTop)], [v2, face(names.vBottom)], 'antiAligned');
    mate('coincident', [v1, datum('plane:right')], [v2, datum('plane:right')], 'aligned');
    mate('coincident', [v1, datum('plane:front')], [v2, datum('plane:front')], 'aligned');
    ids.push({ plate, pinA, pinB, v1, v2 });
  }
  return { doc, ids };
}

export type Rebuilt = Record<Kind, ReturnType<typeof rebuildPart>>;

/** What the app does to show the assembly: each component's part, then the mates solved. */
export function solveJig(doc: AssemblyDoc, rebuilt: Rebuilt): AssemblyResult {
  const kindOf = (fileId: string): Kind => (Object.keys(FILES) as Kind[]).find((k) => FILES[k] === doc.files.find((f) => f.id === fileId)!.path)!;
  return solveAssembly(doc, (componentId) => {
    const c = doc.components.find((x) => x.id === componentId);
    return c ? rebuilt[kindOf(c.file)].mate : null;
  });
}


/** The names the jig's mates need from the plate and the V-block, found by geometry. */
export function jigNames(rebuilt: Rebuilt) {
  return {
    plateRight: outermostPlane(rebuilt.plate.mate, [1, 0, 0]),
    plateLeft: outermostPlane(rebuilt.plate.mate, [-1, 0, 0]),
    plateBack: outermostPlane(rebuilt.plate.mate, [0, 0, 1]),
    vTop: outermostPlane(rebuilt.vblock.mate, [0, 1, 0]),
    vBottom: outermostPlane(rebuilt.vblock.mate, [0, -1, 0]),
  };
}
