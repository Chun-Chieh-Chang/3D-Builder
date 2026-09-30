/**
 * Phase 2F, on the user's own SolidWorks files (handoff §8). The files are not in the repository:
 * point SW_SAMPLE_DIR at the folder that holds them and this runs; without it, it is skipped.
 *
 *   $env:SW_SAMPLE_DIR = 'C:\Users\ws61\Downloads\SW樣本'; npm test -- tests/phase2/real-sample.test.ts
 *
 * The sample given first was two single-body STEP files (a fixture of 2004 faces, a product of 340) with
 * no assembly structure, so this is the partial acceptance: the two taken as the parts of a small
 * assembly, the way "插入零組件" takes a STEP file. It shows how large real files behave — read,
 * meshed, mated on their imported faces (persistent names `import1:f<n>`), solved, written as STEP,
 * saved and reopened — but it is not the acceptance of a 10–20 component assembly, which needs the
 * parts as separate files and the assembly's structure (blueprint §3, Phase 2).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyAssemblyCommand, axisAngle, createEmptyAssembly, transformPoint, type AssemblyDoc, type Mate, type Pose, type Vec3 } from '@3db/model';
import { componentName, exportAssemblyStep, partNameOf, readDocumentFile, readComponentFile, writeAssemblyFile } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { COMPONENT_MESH, Kernel, type FaceInfo } from '@3db/kernel';
import { edgeMateGeometry, faceMateGeometry, Regenerator, solveAssembly, type MatePart } from '@3db/regen';
import { edgeFingerprint, faceFingerprint, vertexFingerprint } from '@3db/naming';
import { readAssemblyStep, rotationMatrix } from '../support/readAssemblyStep';

const dir = process.env.SW_SAMPLE_DIR;
const BASE = 'CIV0000467治具_step.STEP';
const PIECE = '3D_MT17203_CIV0000467_Porduct.STEP';
const ready = !!dir && existsSync(join(dir, BASE)) && existsSync(join(dir, PIECE));

const ms = () => performance.now();
const cpu = () => {
  const u = process.cpuUsage();
  return (u.user + u.system) / 1000;
};
const facesOf = (part: MatePart) => part.topology.faces.map((f, i) => ({ f, name: part.names.faces[i]! }));
const largest = (part: MatePart, test: (f: FaceInfo) => boolean) => facesOf(part).filter(({ f }) => test(f)).sort((a, b) => b.f.area - a.f.area)[0];
const facing = (f: FaceInfo, n: Vec3) => f.geometry?.type === 'plane' && f.geometry.normal.every((v, k) => Math.abs(v - n[k]!) < 1e-9);
const alongZ = (axis: Vec3) => Math.abs(Math.abs(axis[2]) - 1) < 1e-9;

describe.skipIf(!ready)('two real SolidWorks STEP files as the parts of a small assembly (2F, partial)', () => {
  let kernel: Kernel;
  let solver: PlaneGcsSolver;
  const summary: Record<string, unknown> = {};
  let parts: { base: Built; piece: Built };
  let doc: AssemblyDoc;
  let picked: { baseTop: string; pieceBottom: string; hole: string; pin: string; holeRadius: number; pinRadius: number };

  interface Built {
    mate: MatePart;
    shape: import('@3db/kernel').ShapeId;
    name: string;
  }

  async function build(file: string): Promise<Built> {
    const bytes = new Uint8Array(readFileSync(join(dir!, file)));
    const t = ms();
    const part = await readComponentFile(bytes, file);
    const regen = new Regenerator(kernel, solver, part.blobs);
    const r = regen.rebuild(part.doc);
    summary[`${file} read + rebuilt (ms)`] = Math.round(ms() - t);
    expect(r.features.filter((f) => f.status !== 'ok')).toEqual([]);
    const body = r.body!;
    const m = ms();
    const mesh = kernel.mesh(body.shape, COMPONENT_MESH); // as the worker meshes a component
    summary[`${file} meshed (ms)`] = Math.round(ms() - m);
    summary[`${file} triangles`] = mesh.indices.length / 3;
    return { mate: { topology: body.topology, names: body.names, frames: r.frames }, shape: body.shape, name: partNameOf(file) };
  }

  beforeAll(async () => {
    kernel = await Kernel.load();
    solver = await PlaneGcsSolver.create();
    parts = { base: await build(BASE), piece: await build(PIECE) };

    const baseTop = largest(parts.base.mate, (f) => facing(f, [0, 0, 1]))!;
    const pieceBottom = largest(parts.piece.mate, (f) => facing(f, [0, 0, -1]))!;
    // The hole and the pin closest in size: a concave cylinder of the base and a convex one of the piece, both along z.
    const holes = facesOf(parts.base.mate).filter(({ f }) => f.geometry?.type === 'cylinder' && !f.geometry.convex && alongZ(f.geometry.axis));
    const pins = facesOf(parts.piece.mate).filter(({ f }) => f.geometry?.type === 'cylinder' && f.geometry.convex && alongZ(f.geometry.axis));
    let pair: { hole: (typeof holes)[number]; pin: (typeof pins)[number]; gap: number } | null = null;
    for (const hole of holes) for (const pin of pins) {
      const gap = Math.abs((hole.f.geometry as { radius: number }).radius - (pin.f.geometry as { radius: number }).radius);
      if (!pair || gap < pair.gap) pair = { hole, pin, gap };
    }
    summary['base planes facing +z / holes along z'] = `${facesOf(parts.base.mate).filter(({ f }) => facing(f, [0, 0, 1])).length} / ${holes.length}`;
    summary['piece planes facing -z / pins along z'] = `${facesOf(parts.piece.mate).filter(({ f }) => facing(f, [0, 0, -1])).length} / ${pins.length}`;
    if (!baseTop || !pieceBottom || !pair) throw new Error('the sample has no face pair to mate: ' + JSON.stringify(summary));
    picked = {
      baseTop: baseTop.name,
      pieceBottom: pieceBottom.name,
      hole: pair.hole.name,
      pin: pair.pin.name,
      holeRadius: (pair.hole.f.geometry as { radius: number }).radius,
      pinRadius: (pair.pin.f.geometry as { radius: number }).radius,
    };
    summary['mated faces'] = picked;

    doc = applyAssemblyCommand(createEmptyAssembly(), {
      type: 'insertComponent',
      file: { id: 'file1', path: BASE },
      component: { id: 'base', file: 'file1', instance: 1, fixed: true, placement: { position: [0, 0, 0], rotation: [0, 0, 0, 1] } },
    });
    doc = applyAssemblyCommand(doc, {
      type: 'insertComponent',
      file: { id: 'file2', path: PIECE },
      component: { id: 'piece', file: 'file2', instance: 1, fixed: false, placement: { position: [12, -9, 40], rotation: axisAngle([0.6, 0.8, 0], 0.3) } },
    });
    const mate = (id: string, type: Mate['type'], a: string, b: string, align: Mate['align']): Mate => ({
      id, name: id, type, a: { component: 'base', ref: { kind: 'face', name: a } }, b: { component: 'piece', ref: { kind: 'face', name: b } }, align, suppressed: false,
    });
    doc = applyAssemblyCommand(doc, { type: 'insertMate', mate: mate('seat', 'coincident', picked.baseTop, picked.pieceBottom, 'antiAligned') });
    // Same direction or opposite, from the two axes as the parts define them: the piece stands as it is, seated on the top.
    const axisOf = (part: MatePart, name: string) => (part.topology.faces[part.names.faces.indexOf(name)]!.geometry as { axis: Vec3 }).axis;
    const [ha, pa] = [axisOf(parts.base.mate, picked.hole), axisOf(parts.piece.mate, picked.pin)];
    summary['axes hole / pin'] = [ha, pa];
    const align = ha[0] * pa[0] + ha[1] * pa[1] + ha[2] * pa[2] > 0 ? 'aligned' : 'antiAligned';
    doc = applyAssemblyCommand(doc, { type: 'insertMate', mate: mate('axis', 'concentric', picked.hole, picked.pin, align) });
  }, 300_000);

  const partOf = (id: string): MatePart | null => (id === 'base' ? parts.base.mate : id === 'piece' ? parts.piece.mate : null);
  const world = (pose: Pose, p: Vec3) => transformPoint(pose, p);

  it('mates on the imported faces: the piece seats on the top and turns about the hole', () => {
    const t = cpu();
    const r = solveAssembly(doc, partOf);
    summary['solve (cpu ms)'] = +(cpu() - t).toFixed(1);
    expect([...r.mates.values()]).toEqual([{ status: 'ok' }, { status: 'ok' }]);
    expect(r.components.get('base')).toEqual({ status: 'fixed', dof: 0 });
    expect(r.components.get('piece')).toEqual({ status: 'under', dof: 1 });
    // The piece's bottom plane lies in the base's top plane.
    const top = parts.base.mate.topology.faces[parts.base.mate.names.faces.indexOf(picked.baseTop)]!.geometry as { origin: Vec3 };
    const bottom = parts.piece.mate.topology.faces[parts.piece.mate.names.faces.indexOf(picked.pieceBottom)]!.geometry as { origin: Vec3 };
    expect(world(r.poses.get('piece')!, bottom.origin)[2]).toBeCloseTo(top.origin[2], 6);
  });

  it('written as STEP and read back: 2 products, 2 components, poses within 1e-6, volumes unchanged', () => {
    const r = solveAssembly(doc, partOf);
    const stepParts = doc.files.map((f, i) => ({ shape: i === 0 ? parts.base.shape : parts.piece.shape, name: partNameOf(f.path) }));
    const instances = doc.components.map((c) => ({
      part: doc.files.findIndex((f) => f.id === c.file),
      name: componentName(doc.files.find((f) => f.id === c.file)?.path, c.instance),
      pose: r.poses.get(c.id)!,
    }));
    const t = ms();
    const text = exportAssemblyStep(kernel, '治具組合', stepParts, instances);
    summary['STEP export (ms) / size (MB)'] = `${Math.round(ms() - t)} / ${(text.length / 1e6).toFixed(2)}`;
    const back = readAssemblyStep(kernel.oc, text);
    expect(back.root).toBe('治具組合');
    expect(back.isAssembly).toBe(true);
    expect(back.items.map((i) => i.name)).toEqual(instances.map((i) => i.name));
    expect(back.volumes.size).toBe(2);
    // Free-form faces do not come back to the last digit (see the round-trip test below): 1e-5 of the volume.
    stepParts.forEach((p) => {
      const want = kernel.massProps(p.shape).volume;
      expect(Math.abs(back.volumes.get(p.name)! - want) / want).toBeLessThan(1e-5);
    });
    instances.forEach((inst, k) => {
      inst.pose.position.forEach((v, j) => expect(back.items[k]!.origin[j]).toBeCloseTo(v, 6));
      rotationMatrix(inst.pose.rotation).forEach((v, j) => expect(back.items[k]!.matrix[j]).toBeCloseTo(v, 6));
    });
  });

  it('volumes across a STEP round trip: how far the assembly export is from the part export', () => {
    const r = solveAssembly(doc, partOf);
    const stepParts = [parts.base, parts.piece];
    const both = readAssemblyStep(kernel.oc, exportAssemblyStep(kernel, 'A', stepParts.map((p) => ({ shape: p.shape, name: p.name })), doc.components.map((c, i) => ({ part: i, name: c.id, pose: r.poses.get(c.id)! }))));
    for (const p of stepParts) {
      const v0 = kernel.massProps(p.shape).volume;
      const single = kernel.importStep(kernel.exportStep(p.shape, p.name));
      const v1 = kernel.massProps(single.shape).volume;
      kernel.release(single.shape);
      const v2 = both.volumes.get(p.name)!;
      summary[`${p.name} volume: original / part round trip / assembly round trip (rel. drift)`] = `${v0.toFixed(6)} / ${v1.toFixed(6)} / ${v2.toFixed(6)} (${((v1 - v0) / v0).toExponential(2)} / ${((v2 - v0) / v0).toExponential(2)})`;
      // The assembly writer must add nothing to what the part writer does.
      expect(Math.abs(v2 - v1) / v0).toBeLessThan(1e-9);
    }
  });

  it('saved and reopened to the same poses', async () => {
    const file = await readDocumentFile(await writeAssemblyFile(doc));
    expect(file.kind).toBe('assembly');
    if (file.kind !== 'assembly') return;
    expect(file.doc).toEqual(doc);
    expect(solveAssembly(file.doc, partOf).poses.get('piece')).toEqual(solveAssembly(doc, partOf).poses.get('piece'));
  });

  it('meshes a component with at most half the triangles of the part mesh (2F)', () => {
    // A shape keeps the finest mesh it has had (BRepMesh never coarsens one), so each setting meshes a fresh import.
    const rows: string[] = [];
    for (const [label, file] of [['base', BASE], ['piece', PIECE]] as const) {
      const bytes = new Uint8Array(readFileSync(join(dir!, file)));
      const count = (options?: Parameters<Kernel['mesh']>[1]) => {
        const shape = kernel.importStep(bytes).shape;
        const t = ms();
        const n = kernel.mesh(shape, options).indices.length / 3;
        const took = Math.round(ms() - t);
        kernel.release(shape);
        return { n, took };
      };
      const part = count();
      const component = count(COMPONENT_MESH);
      rows.push(`${label}: ${part.n} triangles (${part.took} ms) as a part, ${component.n} (${component.took} ms) as a component`);
      expect(component.n, label).toBeLessThanOrEqual(part.n / 2);
    }
    summary['mesh: part / component'] = rows;
  });


  it('report', () => {
    console.log('REAL SAMPLE ' + JSON.stringify(summary, null, 1));
  });
});
