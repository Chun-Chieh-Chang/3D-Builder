/**
 * Phase 2E (handoff §10): the assembly written as STEP (F1.2). The golden parts are put together the
 * way the app does it (solved mates, poses as shown), written, and read back the way another CAD
 * system would: the structure, the names of the products and components, and where every component
 * is. What was written is what was on screen, not what was stored as the placements.
 */
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyAssemblyCommand, axisAngle, createEmptyAssembly, transformPoint, type AssemblyDoc, type Mate, type PartDoc, type Pose, type Vec3 } from '@3db/model';
import { componentName, exportAssemblyStep, partNameOf, readPartFile, type StepInstance, type StepPart } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator, solveAssembly, type MatePart } from '@3db/regen';
import { readAssemblyStep, rotationMatrix } from '../support/readAssemblyStep';

let kernel: Kernel;
let solver: PlaneGcsSolver;
const docs: Record<string, PartDoc> = {};
const FILES: Record<string, string> = { '定位板.3dbx': 'locating-plate.3dbx', '零件/削邊銷.3dbx': 'diamond-pin.3dbx', 'V型塊.3dbx': 'v-block.3dbx' };

beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
  for (const [path, golden] of Object.entries(FILES)) {
    docs[path] = (await readPartFile(new Uint8Array(readFileSync(new URL(`../golden/${golden}`, import.meta.url))))).doc;
  }
});

const at = (position: Vec3, rotation: Pose['rotation'] = [0, 0, 0, 1]): Pose => ({ position, rotation });
const face = (name: string) => ({ kind: 'face' as const, name });
// Persistent names in the golden parts, as in mates.test.ts.
const HOLE = 'cut1:side:sketch2.ci6';
const TOP = 'extrude1:cap:end';
const SHANK = 'revolve1:side:sketch1.l3#1';
const FLANGE_UNDERSIDE = 'revolve1:side:sketch1.l4';

const mates: Mate[] = [
  { id: 'm1', name: '同軸心1', type: 'concentric', a: { component: 'plate', ref: face(HOLE) }, b: { component: 'pin1', ref: face(SHANK) }, align: 'aligned', suppressed: false },
  { id: 'm2', name: '重合1', type: 'coincident', a: { component: 'plate', ref: face(TOP) }, b: { component: 'pin1', ref: face(FLANGE_UNDERSIDE) }, align: 'antiAligned', suppressed: false },
];

/** 定位板 fixed; 削邊銷<1> dropped above it and tilted, seated by two mates; 削邊銷<2> and 定位板's neighbour V型塊 floating, unmated. */
function jig(): AssemblyDoc {
  let doc = createEmptyAssembly();
  const insert = (fileId: string, path: string, id: string, instance: number, fixed: boolean, placement: Pose, fresh: boolean) => {
    doc = applyAssemblyCommand(doc, { type: 'insertComponent', ...(fresh ? { file: { id: fileId, path } } : {}), component: { id, file: fileId, instance, fixed, placement } } as never);
  };
  insert('file1', '定位板.3dbx', 'plate', 1, true, at([0, 0, 0]), true);
  insert('file2', '零件/削邊銷.3dbx', 'pin1', 1, false, at([-30, 40, 12], axisAngle([0.6, 0, 0.8], 0.4)), true);
  insert('file2', '零件/削邊銷.3dbx', 'pin2', 2, false, at([55.5, -12.25, 80.125], axisAngle([0, 0.6, 0.8], 2.2)), false);
  insert('file3', 'V型塊.3dbx', 'vblock', 1, false, at([-90, 20, 40], axisAngle([1, 0, 0], -0.7)), true);
  for (const m of mates) doc = applyAssemblyCommand(doc, { type: 'insertMate', mate: m });
  return doc;
}

interface Built {
  doc: AssemblyDoc;
  poses: Map<string, Pose>;
  parts: StepPart[];
  instances: StepInstance[];
  volumes: number[];
}

/** What the app does when the user exports: rebuild each part file once, solve, place every component as shown. */
function build(doc: AssemblyDoc): Built {
  const rebuilt = new Map<string, ReturnType<Regenerator['rebuild']>>();
  for (const f of doc.files) rebuilt.set(f.id, new Regenerator(kernel, solver).rebuild(docs[f.path]!));
  const partOf = (componentId: string): MatePart | null => {
    const c = doc.components.find((x) => x.id === componentId);
    const r = c && rebuilt.get(c.file)?.body;
    return r ? { topology: r.topology, names: r.names, frames: rebuilt.get(c.file)!.frames } : null;
  };
  const solved = solveAssembly(doc, partOf);
  const parts: StepPart[] = doc.files.map((f) => ({ shape: rebuilt.get(f.id)!.body!.shape, name: partNameOf(f.path) }));
  const instances: StepInstance[] = doc.components.map((c) => ({
    part: doc.files.findIndex((f) => f.id === c.file),
    name: componentName(doc.files.find((f) => f.id === c.file)?.path, c.instance),
    pose: solved.poses.get(c.id)!,
  }));
  return { doc, poses: solved.poses, parts, instances, volumes: parts.map((p) => kernel.massProps(p.shape).volume) };
}

describe('the fixture as STEP (F1.2)', () => {
  let built: Built;
  let back: ReturnType<typeof readAssemblyStep>;
  beforeAll(() => {
    built = build(jig());
    back = readAssemblyStep(kernel.oc, exportAssemblyStep(kernel, '夾具', built.parts, built.instances));
  });

  it('is one assembly of three products and four components, named after the files and the tree', () => {
    expect(back.root).toBe('夾具');
    expect(back.isAssembly).toBe(true);
    expect([...back.volumes.keys()].sort()).toEqual(['V型塊', '定位板', '削邊銷'].sort());
    expect(back.items.map((i) => i.product)).toEqual(['定位板', '削邊銷', '削邊銷', 'V型塊']);
    expect(back.items.map((i) => i.name)).toEqual(['定位板<1>', '削邊銷<1>', '削邊銷<2>', 'V型塊<1>']);
  });

  it('keeps every part\'s volume', () => {
    built.parts.forEach((p, i) => {
      const read = back.volumes.get(p.name)!;
      expect(Math.abs(read - built.volumes[i]!) / built.volumes[i]!).toBeLessThan(1e-9);
    });
  });

  it('places every component where the solver put it, to within 1e-6', () => {
    built.instances.forEach((inst, i) => {
      const got = back.items[i]!;
      inst.pose.position.forEach((v, j) => expect(got.origin[j], `${inst.name} origin ${j}`).toBeCloseTo(v, 6));
      rotationMatrix(inst.pose.rotation).forEach((v, j) => expect(got.matrix[j], `${inst.name} rotation ${j}`).toBeCloseTo(v, 6));
    });
  });

  it('writes the poses as solved, not the placements stored: the seated pin has moved from where it was dropped', () => {
    const stored = built.doc.components.find((c) => c.id === 'pin1')!.placement;
    const solved = built.poses.get('pin1')!;
    expect(Math.hypot(...solved.position.map((v, i) => v - stored.position[i]!))).toBeGreaterThan(10);
    // the unmated pin keeps its placement
    expect(built.poses.get('pin2')).toEqual(built.doc.components.find((c) => c.id === 'pin2')!.placement);
  });

  it('puts the seated pin\'s flange on the plate\'s top over the hole, as read from the file', () => {
    const pin = back.items[1]!;
    const m = pin.matrix;
    // a point of the pin (its flange, on its axis: y = 15) in assembly coordinates
    const p: Vec3 = [0, 15, 0];
    const world = [0, 1, 2].map((r) => m[r * 3]! * p[0] + m[r * 3 + 1]! * p[1] + m[r * 3 + 2]! * p[2] + pin.origin[r]!);
    world.forEach((v, i) => expect(v).toBeCloseTo([-40, 15, 0][i]!, 6));
    // and the same as the app's own transform
    transformPoint(built.poses.get('pin1')!, p).forEach((v, i) => expect(world[i]).toBeCloseTo(v, 6));
  });
});
