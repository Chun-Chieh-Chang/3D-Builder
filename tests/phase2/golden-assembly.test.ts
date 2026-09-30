/**
 * Phase 2F, the golden assembly (handoff §10): fifteen components of the three golden parts, three
 * locating plates in a row, each with two pins and a stack of two V-blocks, all put together by mates
 * on persistent names. It stands in for the SolidWorks assembly of the acceptance (which needs the
 * user's sample) on the parts of it that can be checked without one: every component is defined as
 * the hand count says, the solve is fast, the assembly saves and reopens to the same poses, follows a
 * change of a part, and is written as STEP with every component where it is.
 *
 *   plate 1 (fixed) ─ right side ─ plate 2 ─ right side ─ plate 3   (sides, back and top flush)
 *   each plate: pin A in the left hole (concentric, flange on the top, flat squared to the side) → fully defined
 *               pin B in the right hole (concentric, flange on the top) → turns about the hole: 1 freedom
 *               V-block 1: bottom on the top, centred on the plate's right and front planes → fully defined
 *               V-block 2: bottom on V-block 1's top, centred on its planes → fully defined
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyAssemblyCommand, applyCommand, axisAngle, createEmptyAssembly, transformPoint, type AssemblyDoc, type Mate, type MateType, type PartDoc, type Pose, type Vec3 } from '@3db/model';
import { componentName, exportAssemblyStep, partNameOf, readDocumentFile, readPartFile, writeAssemblyFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { faceMateGeometry, Regenerator, solveAssembly, type AssemblyResult, type MatePart } from '@3db/regen';
import { readAssemblyStep, rotationMatrix } from '../support/readAssemblyStep';

const FILES = { plate: '定位板.3dbx', pin: '零件/削邊銷.3dbx', vblock: 'V型塊.3dbx' } as const;
type Kind = keyof typeof FILES;
const GOLDEN: Record<Kind, string> = { plate: 'locating-plate.3dbx', pin: 'diamond-pin.3dbx', vblock: 'v-block.3dbx' };

let kernel: Kernel;
let solver: PlaneGcsSolver;
const docs = {} as Record<Kind, PartDoc>;
const kept: Regenerator[] = [];

/** A part rebuilt for mating and for export; its regenerator lives as long as the test file. */
function rebuild(doc: PartDoc) {
  const regen = new Regenerator(kernel, solver);
  kept.push(regen);
  const r = regen.rebuild(doc);
  const body = r.body!;
  return { mate: { topology: body.topology, names: body.names, frames: r.frames } as MatePart, shape: body.shape };
}

beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
  for (const k of Object.keys(FILES) as Kind[]) docs[k] = (await readPartFile(new Uint8Array(readFileSync(new URL(`../golden/${GOLDEN[k]}`, import.meta.url))))).doc;
});

// ---------------------------------------------------------------- the elements the mates use, by persistent name

const face = (name: string) => ({ kind: 'face' as const, name });
const datum = (name: 'plane:right' | 'plane:front') => ({ kind: 'datum' as const, name });
const TOP = 'extrude1:cap:end';
const HOLE_LEFT = 'cut1:side:sketch2.ci6'; // R4 through hole at x = −40
const HOLE_RIGHT = 'cut1:side:sketch2.ci5'; // at x = +40
const SHANK = 'revolve1:side:sketch1.l3#1';
const FLANGE_UNDERSIDE = 'revolve1:side:sketch1.l4';
const FLAT = 'cut1:cap:start';
const PLATE_RIGHT_SIDE = 'extrude1:side:sketch1.l4';

/** The name of the plane face of a part with this normal that lies furthest along it (the top, a side …). */
function outermostPlane(part: MatePart, normal: Vec3): string {
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
const PITCH = 120; // the plates are 120 wide
const stations = [0, 1, 2];

interface Jig {
  doc: AssemblyDoc;
  /** Component ids by role, per station. */
  ids: { plate: string; pinA: string; pinB: string; v1: string; v2: string }[];
}

/** Built once from the parts' names; the placements are where a user would drop the parts: near, and not square. */
function jig(names: { plateRight: string; plateLeft: string; plateBack: string; vTop: string; vBottom: string }): Jig {
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

type Rebuilt = Record<Kind, ReturnType<typeof rebuild>>;

/** What the app does to show the assembly: each component's part, then the mates solved. */
function solve(doc: AssemblyDoc, rebuilt: Rebuilt): AssemblyResult {
  const kindOf = (fileId: string): Kind => (Object.keys(FILES) as Kind[]).find((k) => FILES[k] === doc.files.find((f) => f.id === fileId)!.path)!;
  return solveAssembly(doc, (componentId) => {
    const c = doc.components.find((x) => x.id === componentId);
    return c ? rebuilt[kindOf(c.file)].mate : null;
  });
}

const close = (a: readonly number[], b: readonly number[], digits = 6) => a.forEach((v, i) => expect(v, `${a} vs ${b}`).toBeCloseTo(b[i]!, digits));

describe('the golden assembly: 3 plates × (2 pins + 2 V-blocks) = 15 components (2F)', () => {
  let rebuilt: Rebuilt;
  let names: Parameters<typeof jig>[0];
  let built: Jig;
  let solved: AssemblyResult;

  beforeAll(() => {
    rebuilt = { plate: rebuild(docs.plate), pin: rebuild(docs.pin), vblock: rebuild(docs.vblock) };
    names = {
      plateRight: outermostPlane(rebuilt.plate.mate, [1, 0, 0]),
      plateLeft: outermostPlane(rebuilt.plate.mate, [-1, 0, 0]),
      plateBack: outermostPlane(rebuilt.plate.mate, [0, 0, 1]),
      vTop: outermostPlane(rebuilt.vblock.mate, [0, 1, 0]),
      vBottom: outermostPlane(rebuilt.vblock.mate, [0, -1, 0]),
    };
    built = jig(names);
    solved = solve(built.doc, rebuilt);
  });

  it('is fifteen components of three part files, with 39 mates on persistent names', () => {
    expect(built.doc.components).toHaveLength(15);
    expect(built.doc.files.map((f) => f.path)).toEqual(Object.values(FILES));
    expect(built.doc.mates).toHaveLength(6 + 3 * (3 + 2 + 6));
    // The sides found by geometry are real persistent names of extruded sides, not position numbers.
    for (const n of [names.plateRight, names.plateLeft, names.plateBack]) expect(n).toMatch(/^extrude1:side:sketch1\./);
  });

  it('holds every mate', () => {
    expect([...solved.mates.values()].filter((m) => m.status !== 'ok')).toEqual([]);
    expect(solved.mates.size).toBe(39);
  });

  it('defines each component as the hand count says: 1 fixed, 11 fully defined, 3 pins with one turn left', () => {
    const status = (id: string) => solved.components.get(id)!;
    expect(status(built.ids[0]!.plate)).toEqual({ status: 'fixed', dof: 0 });
    for (const s of stations) {
      const i = built.ids[s]!;
      if (s > 0) expect(status(i.plate)).toEqual({ status: 'full', dof: 0 });
      expect(status(i.pinA)).toEqual({ status: 'full', dof: 0 });
      expect(status(i.pinB)).toEqual({ status: 'under', dof: 1 });
      expect(status(i.v1)).toEqual({ status: 'full', dof: 0 });
      expect(status(i.v2)).toEqual({ status: 'full', dof: 0 });
    }
    const all = [...solved.components.values()];
    expect(all.filter((c) => c.status === 'fixed')).toHaveLength(1);
    expect(all.filter((c) => c.status === 'full')).toHaveLength(11);
    expect(all.filter((c) => c.status === 'under')).toHaveLength(3);
  });

  it('puts every component where the mates say', () => {
    const pos = (id: string, p: Vec3 = [0, 0, 0]) => transformPoint(solved.poses.get(id)!, p);
    for (const s of stations) {
      const i = built.ids[s]!;
      const x = s * PITCH;
      close(pos(i.plate), [x, 0, 0]); // plates edge to edge, flush
      close(pos(i.pinA), [x - 40, 0, 0]); // in the left hole, the flange on the top (y = 15)
      close(pos(i.pinA, [0, 15, 0]), [x - 40, 15, 0]);
      close(pos(i.pinB), [x + 40, 0, 0]);
      close(pos(i.v1), [x, 15, 0]); // V-block 1 on the top (15), centred on the plate
      close(pos(i.v2), [x, 55, 0]); // V-block 2 on its top (15 + 40)
      // pin A's flat squared to the plate's side: the flat's normal along +x
      const o = pos(i.pinA);
      const e = pos(i.pinA, [1, 0, 0]);
      close([e[0] - o[0], e[1] - o[1], e[2] - o[2]], [1, 0, 0]);
    }
  });

  it('solves in under 50 ms of CPU time (blueprint §2.5)', () => {
    // As in packages/assembly/test/solver.test.ts: CPU time, the least of three batches of five.
    const cpu = () => {
      const u = process.cpuUsage();
      return (u.user + u.system) / 1000;
    };
    solve(built.doc, rebuilt);
    let best = Infinity;
    for (let b = 0; b < 3; b++) {
      const t = cpu();
      for (let k = 0; k < 5; k++) solve(built.doc, rebuilt);
      best = Math.min(best, (cpu() - t) / 5);
    }
    console.log(`golden assembly, 15 components / 39 mates: ${best < 3.2 ? 'under 3 ms' : `${best.toFixed(1)} ms`}`);
    expect(best).toBeLessThan(50);
  });

  it('is saved and reopened to the same poses', async () => {
    const file = await readDocumentFile(await writeAssemblyFile(built.doc));
    expect(file.kind).toBe('assembly');
    if (file.kind !== 'assembly') return;
    expect(file.doc).toEqual(built.doc);
    const again = solve(file.doc, rebuilt);
    for (const c of built.doc.components) expect(again.poses.get(c.id)).toEqual(solved.poses.get(c.id));
    expect([...again.components]).toEqual([...solved.components]);
  });

  it('follows a change of a part: a plate 20 thick lifts pins, V-blocks and the plates beside it, and every mate still holds', () => {
    const thicker = applyCommand(docs.plate, { type: 'setEndCondition', featureId: 'extrude1', dir: 'dir1', value: { type: 'blind', depth: '20' } });
    const changed = solve(built.doc, { ...rebuilt, plate: rebuild(thicker) });
    expect([...changed.mates.values()].filter((m) => m.status !== 'ok')).toEqual([]);
    expect([...changed.components].map(([id, c]) => [id, c.status, c.dof])).toEqual([...solved.components].map(([id, c]) => [id, c.status, c.dof]));
    for (const s of stations) {
      const i = built.ids[s]!;
      const at = (id: string, p: Vec3 = [0, 0, 0]) => transformPoint(changed.poses.get(id)!, p);
      close(at(i.pinA, [0, 15, 0]), [s * PITCH - 40, 20, 0]); // the flange on the new top (20)
      close(at(i.v1), [s * PITCH, 20, 0]);
      close(at(i.v2), [s * PITCH, 60, 0]);
    }
  });

  it('is written as STEP: 3 products, 15 components named as in the tree, every one where it is', () => {
    const doc = built.doc;
    const kindOfFile = (id: string) => (Object.keys(FILES) as Kind[]).find((k) => FILES[k] === doc.files.find((f) => f.id === id)!.path)!;
    const parts = doc.files.map((f) => ({ shape: rebuilt[kindOfFile(f.id)].shape, name: partNameOf(f.path) }));
    const instances = doc.components.map((c) => ({
      part: doc.files.findIndex((f) => f.id === c.file),
      name: componentName(doc.files.find((f) => f.id === c.file)?.path, c.instance),
      pose: solved.poses.get(c.id)!,
    }));
    const text = exportAssemblyStep(kernel, '夾具', parts, instances);
    // Not through OCCT's reader: what a program that only reads the text finds.
    expect(text.match(/NEXT_ASSEMBLY_USAGE_OCCURRENCE/g)).toHaveLength(15);
    expect(text.match(/MANIFOLD_SOLID_BREP/g)).toHaveLength(3);
    expect(text.match(/PRODUCT\s*\(/g)).toHaveLength(4); // the assembly and its three parts
    // To open the assembly in another program: STEP_OUT_DIR=<folder> writes it there.
    if (process.env.STEP_OUT_DIR) writeFileSync(join(process.env.STEP_OUT_DIR, '金樣夾具-15零組件.step'), text);
    const back = readAssemblyStep(kernel.oc, text);
    expect(back.root).toBe('夾具');
    expect(back.isAssembly).toBe(true);
    expect([...back.volumes.keys()].sort()).toEqual(['V型塊', '定位板', '削邊銷'].sort());
    expect(back.items).toHaveLength(15);
    expect(back.items.map((i) => i.name)).toEqual(instances.map((i) => i.name));
    expect(back.items.map((i) => i.product)).toEqual(instances.map((i) => parts[i.part]!.name));
    instances.forEach((inst, k) => {
      close(back.items[k]!.origin, inst.pose.position);
      close(back.items[k]!.matrix, rotationMatrix(inst.pose.rotation));
    });
    // Three plates at 120 mm pitch, as the mates put them, and no instance at the origin but the first plate.
    const plates = back.items.filter((i) => i.product === '定位板').map((i) => i.origin);
    close(plates.flat(), [0, 0, 0, PITCH, 0, 0, 2 * PITCH, 0, 0]);
  });
});
