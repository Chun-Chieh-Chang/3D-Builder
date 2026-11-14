import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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
  await mkdir(outside, { recursive: true });
  try {
    await writeFile(join(outside, 'locating-plate.3dbx'), await readFile(join(root, 'locating-plate.3dbx')));
    await symlink(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(await session.inside(join(real, 'locating-plate.3dbx'))).toBe(join(real, 'locating-plate.3dbx'));
    expect(await session.workspaceRelative(join(real, 'locating-plate.3dbx'))).toBe('locating-plate.3dbx');
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
