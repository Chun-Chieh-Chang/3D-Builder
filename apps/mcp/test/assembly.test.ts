import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { readDocumentFile } from '@3db/io';
import { Regenerator, solveAssembly, type MatePart } from '@3db/regen';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { CadSession } from '../src/session';
import { callTool } from '../src/server';

let root: string;
let real: string;
let session: CadSession;
beforeAll(async () => {
  // The workspace is reached through a link, as on CI runners (macOS /var -> /private/var, Windows 8.3 names):
  // checks that resolve links must still treat the files in it as inside.
  real = await mkdtemp(join(tmpdir(), '3db-assembly-'));
  root = real + '-link';
  await symlink(real, root, process.platform === 'win32' ? 'junction' : 'dir');
  session = await CadSession.create({ root, locale: 'en' });
  for (const name of ['locating-plate.3dbx', 'diamond-pin.3dbx']) {
    await writeFile(join(root, name), await readFile(new URL(`../../../tests/golden/${name}`, import.meta.url)));
  }
});
afterAll(async () => {
  session?.dispose();
  if (root) await rm(root, { force: true });
  if (real) await rm(real, { recursive: true, force: true });
});

const data = (result: CallToolResult) => JSON.parse((result.content[0] as { text: string }).text);
const call = (name: string, args = {}) => callTool(session, name, args);
const pose = (position: [number, number, number]) => ({ position, rotation: [0, 0, 0, 1] });

it('queries actual mating faces, previews a batch, preserves state on refusal and writes a native assembly', async () => {
  expect((await call('assembly_new')).isError).toBeFalsy();
  const plate = data(await call('assembly_query_elements', { path: 'locating-plate.3dbx' }));
  const pin = data(await call('assembly_query_elements', { path: 'diamond-pin.3dbx' }));
  const ref = (part: { elements: { ref: { name: string } }[] }, name: string) => {
    const match = part.elements.find((element) => element.ref.name === name);
    expect(match, name).toBeDefined();
    return match!.ref;
  };
  const component = (id: string, file: string, placement: ReturnType<typeof pose>, fixed: boolean) => ({
    type: 'insertComponent', file: { id: file, path: file + '.3dbx' }, component: { id, file, instance: 1, fixed, placement },
  });
  const commands = [
    component('plate', 'locating-plate', pose([0, 0, 0]), true),
    component('pin', 'diamond-pin', pose([-39, 1, 0]), false),
    { type: 'insertMate', mate: { id: 'axis', name: 'Axis', type: 'concentric', align: 'aligned', suppressed: false,
      a: { component: 'plate', ref: ref(plate, 'cut1:side:sketch2.ci6') },
      b: { component: 'pin', ref: ref(pin, 'revolve1:side:sketch1.l3#1') } } },
    { type: 'insertMate', mate: { id: 'seat', name: 'Seat', type: 'coincident', align: 'antiAligned', suppressed: false,
      a: { component: 'plate', ref: ref(plate, 'extrude1:cap:end') },
      b: { component: 'pin', ref: ref(pin, 'revolve1:side:sketch1.l4') } } },
  ];
  const trial = await call('assembly_apply_commands', { commands, dry_run: true, preview: { size: 128 } });
  expect(trial.isError, JSON.stringify(trial.content[0])).toBeFalsy();
  expect(data(trial)).toMatchObject({ committed: false });
  expect(trial.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' });
  expect(data(await call('assembly_inspect')).components).toEqual([]);

  const applied = await call('assembly_apply_commands', { commands });
  expect(applied.isError, JSON.stringify(applied.content[0])).toBeFalsy();
  expect(data(applied)).toMatchObject({ committed: true });
  const before = data(await call('assembly_inspect', { interference: true }));
  expect(before.components[1]).toMatchObject({ id: 'pin', dof: 1 });
  expect(before.components[1].pose.position[0]).toBeCloseTo(-40, 6);
  expect(before.mates.map((mate: { status: string }) => mate.status)).toEqual(['ok', 'ok']);
  expect(before.interference, JSON.stringify(before.interference)).toMatchObject({ status: 'overlap', unknown: [], failed: [], overlaps: [{ a: 'plate', b: 'pin' }] });
  expect(before.interference.overlaps[0].volume).toBeGreaterThan(0);
  expect((await call('assembly_new')).isError).toBe(true);
  expect((await call('assembly_apply_commands', { commands: [{ type: 'insertComponent', file: { id: 'missing', path: 'missing.3dbx' }, component: { id: 'missing', file: 'missing', instance: 1, fixed: false, placement: pose([0, 0, 0]) } }] })).isError).toBe(true);
  const conflict = await call('assembly_apply_commands', {
    commands: [{ type: 'insertMate', mate: { id: 'offset', name: 'Offset', type: 'distance', align: 'antiAligned', value: '5',
      a: { component: 'plate', ref: ref(plate, 'extrude1:cap:end') },
      b: { component: 'pin', ref: ref(pin, 'revolve1:side:sketch1.l4') } } }],
  });
  expect(conflict.isError).toBe(true);
  expect(data(conflict)).toMatchObject({ committed: false, mates: [{ status: 'ok' }, { status: 'ok' }, { id: 'offset', status: 'conflict' }] });
  expect(data(await call('assembly_inspect', { interference: true }))).toEqual(before);

  await mkdir(join(root, 'assemblies'));
  const path = 'assemblies/jig.3dba';
  expect((await call('assembly_save', { path })).isError).toBeFalsy();
  const reopened = await readDocumentFile(await readFile(join(root, path)));
  expect(reopened.kind).toBe('assembly');
  if (reopened.kind !== 'assembly') throw new Error('expected assembly');
  expect(reopened.doc.files.map((file) => file.path)).toEqual(['../locating-plate.3dbx', '../diamond-pin.3dbx']);
  expect(reopened.doc.mates.map((mate) => mate.id)).toEqual(['axis', 'seat']);
  const parts = new Map<string, MatePart>();
  const { kernel, solver } = await session.assemblyGeometry();
  const regen: Regenerator[] = [];
  try {
    for (const file of reopened.doc.files) {
      const source = await readDocumentFile(await readFile(resolve(dirname(join(root, path)), file.path)));
      if (source.kind !== 'part') throw new Error('expected a part source');
      const builder = new Regenerator(kernel, solver, source.blobs);
      regen.push(builder);
      await solver.fresh();
      const result = builder.rebuild(source.doc);
      expect(result.body).not.toBeNull();
      parts.set(file.id, { names: result.body!.names, topology: result.body!.topology, frames: result.frames });
    }
    const solved = solveAssembly(reopened.doc, (id) => parts.get(reopened.doc.components.find((c) => c.id === id)!.file) ?? null);
    expect([...solved.mates.values()].map((mate) => mate.status)).toEqual(['ok', 'ok']);
    expect(solved.poses.get('pin')).toEqual(before.components[1].pose);
  } finally {
    for (const builder of regen) builder.dispose();
  }
  expect((await call('assembly_save', { path })).isError).toBe(true);
  expect((await call('assembly_new')).isError).toBeFalsy();
  const restored = await call('assembly_open', { path });
  expect(restored.isError, JSON.stringify(restored.content[0])).toBeFalsy();
  expect(data(await call('assembly_inspect', { interference: true }))).toEqual(before);
});

it('exports the solved assembly as STEP and as the parts list, and keeps existing files', async () => {
  // The plate and pin of the previous test, reopened from its file, with a second plate: the parts list must count that file twice.
  // A third part painted red, so the STEP must carry face colors (the two golden parts have none).
  expect(data(await call('assembly_inspect')).components.map((c: { id: string }) => c.id)).toEqual(['plate', 'pin']);
  expect((await call('part_new')).isError).toBeFalsy();
  expect((await call('cad_execute_feature', { feature: { operation: 'create_primitive', shape: 'box', id: 'tint', width: 8, depth: 6, height: 4 } })).isError).toBeFalsy();
  expect((await call('apply_commands', { commands: [{ type: 'setAppearance', target: { kind: 'part' }, color: '#ff0000' }] })).isError).toBeFalsy();
  expect((await call('part_save', { path: 'tinted.3dbx' })).isError).toBeFalsy();
  expect((await call('part_new')).isError).toBeFalsy();
  const extra = await call('assembly_apply_commands', {
    commands: [
      { type: 'insertComponent', component: { id: 'plate2', file: 'locating-plate', instance: 2, fixed: true, placement: pose([0, 0, 50]) } },
      { type: 'insertComponent', file: { id: 'tinted', path: 'tinted.3dbx' }, component: { id: 'red', file: 'tinted', instance: 1, fixed: true,
        // turned 90° about z: a rotation that is not its own transpose, so the matrix check below tells rows from columns
        placement: { position: [0, 80, 0], rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] } } },
    ],
  });
  expect(extra.isError, JSON.stringify(extra.content[0])).toBeFalsy();
  const solved = data(await call('assembly_inspect'));
  const poseOf = new Map<string, { position: number[]; rotation: number[] }>(solved.components.map((c: { id: string; pose: never }) => [c.id, c.pose]));
  expect(poseOf.get('pin')!.position[0]).toBeCloseTo(-40, 6); // where the mates put the pin (first test), known from the parts' geometry
  await mkdir(join(root, 'deliver'));

  // STEP: read back by the kernel, not by the writer; each part's volume against its own source rebuilt here.
  const step = await call('assembly_export', { path: 'deliver/jig.step', format: 'step' });
  expect(step.isError, JSON.stringify(step.content[0])).toBeFalsy();
  const stepBytes = await readFile(join(root, 'deliver', 'jig.step'));
  expect(data(step)).toMatchObject({ format: 'step', parts: 3, instances: 4, warnings: [], bytes: stepBytes.length });
  const { kernel, solver } = await session.assemblyGeometry();
  const volumeOf = new Map<string, { volume: number; faces: number }>();
  const regen: Regenerator[] = [];
  try {
    for (const name of ['locating-plate', 'diamond-pin', 'tinted']) {
      const source = await readDocumentFile(await readFile(join(root, `${name}.3dbx`)));
      if (source.kind !== 'part') throw new Error('expected a part source');
      const builder = new Regenerator(kernel, solver, source.blobs);
      regen.push(builder);
      await solver.fresh();
      const body = builder.rebuild(source.doc).body!;
      volumeOf.set(name, { volume: kernel.massProps(body.shape).volume, faces: body.topology.faces.length });
    }
  } finally {
    for (const builder of regen) builder.dispose();
  }
  const contents = kernel.readAssemblyStep(stepBytes);
  try {
    const top = contents.prototypes[contents.root]!;
    expect(top.children).toHaveLength(4);
    const parts = contents.prototypes.filter((p) => p.shape);
    expect(parts.map((p) => p.name).sort()).toEqual(['diamond-pin', 'locating-plate', 'tinted']);
    for (const part of parts) {
      const truth = volumeOf.get(part.name!)!;
      expect(kernel.massProps(part.shape!).volume / truth.volume, part.name!).toBeCloseTo(1, 6);
      expect(kernel.topology(part.shape!).faces.length, part.name!).toBe(truth.faces);
    }
    const red = parts.find((p) => p.name === 'tinted')!;
    expect(kernel.massProps(red.shape!).volume).toBeCloseTo(8 * 6 * 4, 6); // the box as drawn
    expect(red.faceColors ?? (red.color ? Array(6).fill(red.color) : null), JSON.stringify({ faceColors: red.faceColors, color: red.color })).toEqual(Array(6).fill('#ff0000'));
    for (const plain of parts.filter((p) => p.name !== 'tinted')) expect((plain.faceColors ?? []).every((c) => c === null), plain.name!).toBe(true);
    // Each component where the solver put it: positions in mm; rotations come back as 3x3 matrices, compared with the solved quaternion's matrix.
    const placed = top.children!.map((c) => ({ part: contents.prototypes[c.prototype]!.name, position: c.translation, rotation: c.rotation }));
    const want = [['plate', 'locating-plate'], ['pin', 'diamond-pin'], ['plate2', 'locating-plate'], ['red', 'tinted']] as const;
    for (const [id, file] of want) {
      const pose = poseOf.get(id)!;
      const match = placed.find((p) => p.part === file && p.position.every((v, i) => Math.abs(v - pose.position[i]!) < 1e-6));
      expect(match, `${id} at ${pose.position}`).toBeDefined();
      const [x, y, z, w] = pose.rotation as [number, number, number, number];
      const matrix = [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
      expect(match!.rotation, id).toHaveLength(9);
      match!.rotation.forEach((v, i) => expect(v, `${id} rotation[${i}]`).toBeCloseTo(matrix[i]!, 9));
    }
  } finally {
    for (const p of contents.prototypes) if (p.shape) kernel.release(p.shape);
  }

  // The parts list: one row per file, the second plate counted, columns as the app writes them.
  const bom = await call('assembly_export', { path: 'deliver/jig.csv', format: 'bom_csv' });
  expect(bom.isError, JSON.stringify(bom.content[0])).toBeFalsy();
  const csvBytes = await readFile(join(root, 'deliver', 'jig.csv'));
  expect([...csvBytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // the byte order mark Excel needs to read UTF-8 (TextDecoder drops it)
  const lines = new TextDecoder().decode(csvBytes).split('\r\n').filter((line) => line !== '');
  expect(lines[0]).toBe('Item No.,Name,Qty.,Vendor,Part Number,File');
  expect(lines.slice(1).map((line) => line.split(',')).sort((a, b) => a[1]!.localeCompare(b[1]!))).toEqual([
    ['2', 'diamond-pin', '1', '', '', 'diamond-pin.3dbx'],
    ['1', 'locating-plate', '2', '', '', 'locating-plate.3dbx'],
    ['3', 'tinted', '1', '', '', 'tinted.3dbx'],
  ]);
  expect(data(bom).rows).toHaveLength(3);

  // Refusals: nothing is written and existing files keep their bytes.
  const refused = [
    { path: 'deliver/jig.step', format: 'step' }, // already there
    { path: 'deliver/jig.csv', format: 'bom_csv' },
    { path: 'deliver/other.csv', format: 'step' }, // extension of another format
    { path: 'deliver/other.step', format: 'bom_csv' },
    { path: 'nowhere/jig.step', format: 'step' }, // a folder that does not exist
    { path: '../jig.step', format: 'step' },
  ];
  for (const args of refused) expect((await call('assembly_export', args)).isError, JSON.stringify(args)).toBe(true);
  expect((await readFile(join(root, 'deliver', 'jig.step'))).equals(stepBytes)).toBe(true);
  expect((await readdir(join(root, 'deliver'))).sort()).toEqual(['jig.csv', 'jig.step']);

  // Save, so the next test can start a new assembly.
  expect((await call('assembly_save', { path: 'deliver/jig2.3dba' })).isError).toBeFalsy();
  expect((await call('assembly_new')).isError).toBeFalsy();
  // An empty assembly has nothing to deliver: no header-only parts list, no empty STEP.
  for (const args of [{ path: 'deliver/empty.step', format: 'step' }, { path: 'deliver/empty.csv', format: 'bom_csv' }]) {
    const empty = await call('assembly_export', args);
    expect(empty.isError, args.format).toBe(true);
    expect((empty.content[0] as { text: string }).text).toMatch(/no components/);
  }
  expect((await readdir(join(root, 'deliver'))).sort()).toEqual(['jig.csv', 'jig.step', 'jig2.3dba']);
});

it('distinguishes separation, touching and known overlap between two instances of one solid', async () => {
  expect((await call('assembly_new')).isError).toBeFalsy();
  expect((await call('cad_execute_feature', { feature: { operation: 'create_primitive', shape: 'box', id: 'cube', width: 10, depth: 10, height: 10 } })).isError).toBeFalsy();
  expect((await call('part_save', { path: 'cube.3dbx' })).isError).toBeFalsy();
  const commands = [
    { type: 'insertComponent', file: { id: 'cube', path: 'cube.3dbx' }, component: { id: 'a', file: 'cube', instance: 1, fixed: true, placement: pose([0, 0, 0]) } },
    { type: 'insertComponent', component: { id: 'b', file: 'cube', instance: 2, fixed: false, placement: pose([11, 0, 0]) } },
  ];
  const applied = await call('assembly_apply_commands', { commands, interference: true });
  expect(applied.isError, JSON.stringify(applied.content[0])).toBeFalsy();
  const before = data(applied);
  expect(before.interference).toMatchObject({ status: 'clear', checked: 0, overlaps: [] });
  const a = data(await call('assembly_query_elements', { component: 'a' }));
  const b = data(await call('assembly_query_elements', { component: 'b' }));
  expect(a.component).toBe('a');
  expect(b.component).toBe('b');
  expect(a.elements).toEqual(b.elements);
  for (const x of [10, 8]) {
    const trial = await call('assembly_apply_commands', {
      commands: [{ type: 'setPlacements', placements: [{ componentId: 'b', placement: pose([x, 0, 0]) }] }],
      dry_run: true, interference: true,
    });
    expect(trial.isError, JSON.stringify(trial.content[0])).toBeFalsy();
    const report = data(trial);
    expect(report.committed).toBe(false);
    expect(report.interference.checked).toBe(1);
    if (x === 10) expect(report.interference).toMatchObject({ status: 'clear', overlaps: [] });
    else {
      expect(report.interference).toMatchObject({ status: 'overlap', overlaps: [{ a: 'a', b: 'b' }] });
      expect(report.interference.overlaps[0].volume).toBeCloseTo(200, 6);
    }
  }
  expect(data(await call('assembly_inspect', { interference: true })).components).toEqual(before.components);
});

it('refuses escaped paths and malformed inputs without mutating either session', async () => {
  const before = data(await call('assembly_inspect'));
  const part = data(await call('part_summary'));
  for (const path of ['../outside.3dbx', 'assemblies/jig.3dba']) {
    expect((await call('assembly_query_elements', { path })).isError).toBe(true);
  }
  expect((await call('assembly_query_elements', { path: 'cube.3dbx', component: 'a' })).isError).toBe(true);
  expect((await call('assembly_save', { path: '../outside.3dba' })).isError).toBe(true);
  expect((await call('assembly_open', { path: 'assemblies/jig.3dba' })).isError).toBe(true);
  // The real name of the workspace is inside; its neighbours and links out of it are not, by either name.
  const outside = real + '-outside';
  // A third spelling of the workspace, as on CI where tmpdir() itself is reached through a link.
  const other = real + '-other';
  const link = process.platform === 'win32' ? 'junction' : 'dir';
  await mkdir(outside, { recursive: true });
  try {
    await symlink(real, other, link);
    await writeFile(join(outside, 'locating-plate.3dbx'), await readFile(join(root, 'locating-plate.3dbx')));
    await symlink(outside, join(root, 'escape'), link);
    // Saving creates missing folders: a link out of the workspace followed by a folder that does not exist yet must not
    // let a save or an export write outside.
    const escapes = [
      ['part_save', { path: 'escape/new/x.3dbx' }], ['export_file', { path: 'escape/new/x.step', format: 'step' }],
      ['part_save', { path: join(real, 'escape', 'new', 'x.3dbx') }], ['export_file', { path: join(real, 'escape', 'new', 'x.step'), format: 'step' }],
    ] as const;
    for (const [tool, args] of escapes) {
      const refused = await call(tool, args);
      expect(refused.isError, `${tool} ${args.path}`).toBe(true);
      expect((refused.content[0] as { text: string }).text).toMatch(/outside the workspace/);
    }
    expect(await readdir(outside)).toEqual(['locating-plate.3dbx']);
    for (const spelling of [real, other]) {
      expect(await session.inside(join(spelling, 'locating-plate.3dbx'))).toBe(join(spelling, 'locating-plate.3dbx'));
      expect(await session.workspaceRelative(join(spelling, 'locating-plate.3dbx'))).toBe('locating-plate.3dbx');
    }
    // Folders that do not exist cannot be resolved: only the check on the name itself stands between them and the outside.
    const missing = [join(outside, 'missing', 'x.3dbx'), '../3db-nowhere/x.3dbx', join(real, '..', 'nowhere', 'x.3dbx')];
    for (const path of [...missing, join(outside, 'locating-plate.3dbx'), real, root,join(root, 'escape', 'locating-plate.3dbx'), join(real, 'escape', 'locating-plate.3dbx')]) {
      await expect(session.inside(path), path).rejects.toThrow(/outside the workspace/);
    }
    const escaped = await call('assembly_query_elements', { path: 'escape/locating-plate.3dbx' });
    expect(escaped.isError).toBe(true);
    expect((escaped.content[0] as { text: string }).text).toMatch(/outside the workspace/);
  } finally {
    await rm(join(root, 'escape'), { force: true });
    await rm(other, { force: true });
    await rm(outside, { recursive: true, force: true });
  }
  for (const placement of [pose([NaN, 0, 0]), { ...pose([0, 0, 0]), rotation: [0, 0, 0, 0] }]) {
    expect((await call('assembly_apply_commands', {
      commands: [{ type: 'setPlacements', placements: [{ componentId: 'b', placement }] }],
    })).isError).toBe(true);
  }
  expect(data(await call('assembly_inspect'))).toEqual(before);
  expect(data(await call('part_summary'))).toEqual(part);
});
