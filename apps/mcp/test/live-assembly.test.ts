/**
 * The assembly over the live link (ADR 0253), end to end in Node: the MCP tools (`callTool`) with a real LiveBridge, and the app's AiBridge with a real
 * AssemblyHistory whose part files are in a project folder the server cannot see. The workspace holds no part: every source the server solves came
 * from the app.
 */
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { applyAssemblyCommand, AssemblyHistory, createEmptyAssembly, createEmptyPart, DocHistory, isFilePath, joinPath, type AssemblyDoc, type Id } from '@3db/model';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { CadSession } from '../src/session';
import { callTool } from '../src/server';
import { LiveBridge } from '../src/bridge';
import { AiBridge, type AiAssemblyHost, type AiBridgeStatus } from '../../web/src/state/aiBridge';

const wait = (ok: () => boolean) => new Promise<void>((resolve, reject) => {
  const t0 = Date.now();
  const tick = () => (ok() ? resolve() : Date.now() - t0 > 5000 ? reject(new Error('timed out waiting')) : setTimeout(tick, 10));
  tick();
});
const data = (result: CallToolResult) => JSON.parse((result.content[0] as { text: string }).text);
const text = (result: CallToolResult) => (result.content[0] as { text: string }).text;
const pose = (position: [number, number, number]) => ({ position, rotation: [0, 0, 0, 1] });

let project: string;
let workspace: string;
let session: CadSession;
beforeAll(async () => {
  // The project: parts/ holds the part files, asm/ the assembly; the assembly refers to its parts as ../parts/… (B9.4).
  project = await mkdtemp(join(tmpdir(), '3db-live-project-'));
  await mkdir(join(project, 'parts'));
  await mkdir(join(project, 'asm'));
  for (const name of ['locating-plate.3dbx', 'diamond-pin.3dbx']) {
    await writeFile(join(project, 'parts', name), await readFile(new URL(`../../../tests/golden/${name}`, import.meta.url)));
  }
  await writeFile(join(project, 'parts', 'notes.txt'), 'not a part');
  workspace = await mkdtemp(join(tmpdir(), '3db-live-workspace-'));
  session = await CadSession.create({ root: workspace, locale: 'en' });
});
afterAll(async () => {
  session?.dispose();
  for (const dir of [project, workspace]) if (dir) await rm(dir, { recursive: true, force: true });
});

let server: LiveBridge | null = null;
let app: AiBridge | null = null;
afterEach(async () => {
  app?.disconnect();
  await server?.stop();
  server = null;
  app = null;
});

/** The app's open assembly, as the store hands it to the link (assembly.ts `agentHost`), over a folder on disk. */
function assemblyHost(doc: AssemblyDoc) {
  const history = new AssemblyHistory(doc);
  const state = { busy: false, reads: [] as string[] };
  const folder = 'asm';
  const host: AiAssemblyHost = {
    history,
    busy: () => state.busy,
    sources: async (d) => {
      const out = new Map<Id, Uint8Array>();
      for (const f of d.files) {
        try {
          out.set(f.id, new Uint8Array(await readFile(join(project, joinPath(folder, f.path)))));
        } catch {
          // left out, as the store does
        }
      }
      return out;
    },
    read: async (path) => {
      state.reads.push(path);
      if (!isFilePath(path) || !path.toLowerCase().endsWith('.3dbx')) throw new Error(`only .3dbx part files are read: ${path}`);
      const full = joinPath(folder, path);
      if (full === '..' || full.startsWith('../')) throw new Error(`${path} is outside the project folder`);
      try {
        return new Uint8Array(await readFile(join(project, full)));
      } catch {
        throw new Error(`there is no part file ${path} in the project folder`);
      }
    },
  };
  return { history, host, state };
}

const plateOnly = () => applyAssemblyCommand(createEmptyAssembly(), {
  type: 'insertComponent', file: { id: 'plate-part', path: '../parts/locating-plate.3dbx' },
  component: { id: 'plate', file: 'plate-part', instance: 1, fixed: true, placement: pose([0, 0, 0]) },
} as never);

/** Links an app that shows `doc` (an assembly), or a part when `doc` is null. */
async function link(doc: AssemblyDoc | null) {
  server = new LiveBridge({});
  await server.start();
  const asm = doc ? assemblyHost(doc) : null;
  let showing = asm;
  const statuses: AiBridgeStatus[] = [];
  const part = new DocHistory(createEmptyPart());
  app = new AiBridge({ history: part, blobs: () => new Map(), isPart: () => !showing, assembly: () => showing?.host ?? null, onStatus: (s) => statuses.push(s) });
  app.connect(server.code);
  await wait(() => statuses.at(-1)?.state === 'on');
  const live = server;
  return {
    asm: asm!,
    part,
    statuses,
    call: (name: string, args: unknown = {}) => callTool(session, name, args, live),
    /** The store shows another document (store.ts calls historyReplaced). */
    show(next: ReturnType<typeof assemblyHost> | null) {
      showing = next;
      app!.historyReplaced();
    },
  };
}

it('works on the assembly open in the app: sources from the app, a trial that changes nothing, a batch kept as one undo step, undo', async () => {
  const { asm, call } = await link(plateOnly());
  expect(await readdir(workspace)).toEqual([]);

  const shown = data(await call('assembly_inspect'));
  expect(shown.components.map((c: { id: string }) => c.id)).toEqual(['plate']);
  expect(shown.valid).toBe(true);

  // a file the assembly does not use yet: the server asks the app for it, by its path from the assembly's folder
  const plate = data(await call('assembly_query_elements', { component: 'plate' }));
  const pin = data(await call('assembly_query_elements', { path: '../parts/diamond-pin.3dbx' }));
  expect(asm.state.reads).toEqual(['../parts/diamond-pin.3dbx']);
  const ref = (part: { elements: { ref: { name: string } }[] }, name: string) => part.elements.find((e) => e.ref.name === name)!.ref;
  const commands = [
    { type: 'insertComponent', file: { id: 'pin-part', path: '../parts/diamond-pin.3dbx' }, component: { id: 'pin', file: 'pin-part', instance: 1, fixed: false, placement: pose([-39, 1, 0]) } },
    { type: 'insertMate', mate: { id: 'axis', name: 'Axis', type: 'concentric', align: 'aligned', suppressed: false,
      a: { component: 'plate', ref: ref(plate, 'cut1:side:sketch2.ci6') }, b: { component: 'pin', ref: ref(pin, 'revolve1:side:sketch1.l3#1') } } },
    { type: 'insertMate', mate: { id: 'seat', name: 'Seat', type: 'coincident', align: 'antiAligned', suppressed: false,
      a: { component: 'plate', ref: ref(plate, 'extrude1:cap:end') }, b: { component: 'pin', ref: ref(pin, 'revolve1:side:sketch1.l4') } } },
  ];

  const trial = await call('assembly_apply_commands', { commands, dry_run: true, preview: { size: 96 } });
  expect(trial.isError, text(trial)).toBeFalsy();
  expect(data(trial)).toMatchObject({ committed: false, valid: true });
  expect(trial.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' });
  expect(asm.history.doc.components).toHaveLength(1);
  expect(asm.history.canUndo).toBe(false);

  const applied = await call('assembly_apply_commands', { commands });
  expect(applied.isError, text(applied)).toBeFalsy();
  expect(data(applied)).toMatchObject({ committed: true });
  // the server's solve, from the app's bytes: the pin's axis on the plate's hole and its shoulder on the plate's top
  expect(data(applied).components[1].pose.position[0]).toBeCloseTo(-40, 6);
  expect(asm.history.doc.components.map((c) => c.id)).toEqual(['plate', 'pin']);
  expect(asm.history.doc.mates.map((m) => m.id)).toEqual(['axis', 'seat']);
  expect(asm.history.doc.files).toContainEqual({ id: 'pin-part', path: '../parts/diamond-pin.3dbx' });
  // a file not in the assembly is read again by each call (the query, the trial, the batch: it may have changed in between); once the batch is
  // kept, its content is known and solving again does not ask for it
  const pinReads = ['../parts/diamond-pin.3dbx', '../parts/diamond-pin.3dbx', '../parts/diamond-pin.3dbx'];
  expect(asm.state.reads).toEqual(pinReads);
  expect(data(await call('assembly_inspect')).valid).toBe(true);
  expect(asm.state.reads).toEqual(pinReads);
  // one undo step in the app
  const sent = server!.open;
  asm.history.undo();
  expect(asm.history.doc.components).toHaveLength(1);
  asm.history.redo();
  // the user's undo and redo reach the server: the app sends the assembly it shows again (a fixed wait, not a condition, before 2026-11-26)
  await wait(() => server!.open !== sent && server!.open.kind === 'assembly' && server!.open.doc.components.length === 2);
  // the server reads its copy again from the app (the same document), and the part file it read before is the app's now
  expect(data(await call('assembly_inspect')).components.map((c: { id: string }) => c.id)).toEqual(['plate', 'pin']);

  // the agent's own undo: only while nothing happened since its batch
  const early = await call('undo');
  expect(early.isError).toBe(true);
  expect(text(early)).toMatch(/no batch of yours/);
  const again = await call('assembly_apply_commands', { commands: [{ type: 'setPlacements', placements: [{ componentId: 'pin', placement: pose([-39, 1, 0]) }] }] });
  expect(again.isError, text(again)).toBeFalsy();
  const undone = await call('undo');
  expect(undone.isError, text(undone)).toBeFalsy();
  expect(data(undone)).toMatchObject({ undone: true, components: 2, mates: 2 });
  expect(asm.history.doc.components).toHaveLength(2);
  expect((await call('undo')).isError).toBe(true);
});

it('refuses a batch when the user changed the assembly or is in the middle of something, and sends the assembly first', async () => {
  const { asm, call } = await link(plateOnly());
  expect(data(await call('assembly_inspect')).components[0].pose.position).toEqual([0, 0, 0]);
  const move = (x: number) => ({ type: 'setPlacements', placements: [{ componentId: 'plate', placement: pose([x, 0, 0]) }] });

  asm.history.execute(move(5) as never);
  const stale = await call('assembly_apply_commands', { commands: [move(9)] });
  expect(stale.isError).toBe(true);
  expect(text(stale)).toMatch(/changed the document/);
  expect(asm.history.doc.components[0]!.placement.position).toEqual([5, 0, 0]);
  // the app sent its assembly before the refusal: the next call has it
  expect(data(await call('assembly_inspect')).components[0].pose.position).toEqual([5, 0, 0]);

  asm.state.busy = true;
  const busy = await call('assembly_apply_commands', { commands: [move(9)] });
  expect(busy.isError).toBe(true);
  expect(text(busy)).toMatch(/PropertyManager/);
  asm.state.busy = false;
  expect(asm.history.doc.components[0]!.placement.position).toEqual([5, 0, 0]);
  expect(data(await call('assembly_inspect')).components[0].pose.position).toEqual([5, 0, 0]);

  const ok = await call('assembly_apply_commands', { commands: [move(9)] });
  expect(ok.isError, text(ok)).toBeFalsy();
  expect(asm.history.doc.components[0]!.placement.position).toEqual([9, 0, 0]);
});

it('reads only .3dbx files inside the project, and keeps opening, starting and saving to the user', async () => {
  const { asm, call } = await link(plateOnly());
  const insert = (path: string) => ({ commands: [{ type: 'insertComponent', file: { id: 'x-part', path }, component: { id: 'x', file: 'x-part', instance: 1, fixed: false, placement: pose([0, 0, 0]) } }] });
  const outside = await call('assembly_apply_commands', insert('../../elsewhere/locating-plate.3dbx'));
  expect(outside.isError).toBe(true);
  expect(text(outside)).toMatch(/outside the project/);
  expect(text(await call('assembly_apply_commands', insert('../parts/notes.txt')))).toMatch(/\.3dbx/);
  expect(text(await call('assembly_apply_commands', insert('../parts/missing.3dbx')))).toMatch(/no part file/);
  expect(asm.history.doc.components).toHaveLength(1);
  expect(asm.history.canUndo).toBe(false);

  for (const [name, args] of [['assembly_new', {}], ['assembly_open', { path: 'a.3dba' }], ['assembly_save', { path: 'a.3dba' }]] as const) {
    const r = await call(name, args);
    expect(r.isError, name).toBe(true);
    expect(text(r), name).toMatch(/shows an assembly/);
  }
  // part tools have no part to work on
  expect(text(await call('part_summary'))).toMatch(/assembly_\* tools/);
  // a delivery file goes to the workspace as before
  const csv = await call('assembly_export', { path: 'jig.csv', format: 'bom_csv' });
  expect(csv.isError, text(csv)).toBeFalsy();
  expect(await readdir(workspace)).toEqual(['jig.csv']);
  await rm(join(workspace, 'jig.csv'));
});

it('says why an assembly of the app cannot be solved here, and follows the app from assembly to part and off', async () => {
  const doc = applyAssemblyCommand(plateOnly(), { type: 'setComponentState', componentIds: ['plate'], state: 'suppressed', value: true } as never);
  const linked = await link(doc);
  const r = await linked.call('assembly_inspect');
  expect(r.isError).toBe(true);
  expect(text(r)).toMatch(/suppressed/);

  // the user opens a part: the assembly tools stop, the part tools work on the app's part
  linked.show(null);
  // until the server has it: a fixed 50 ms was not always enough on a macOS runner (run #379, 2026-11-24: the next call still saw the old document)
  await wait(() => server!.open.kind === 'part');
  const asPart = await linked.call('assembly_inspect');
  expect(asPart.isError).toBe(true);
  expect(text(asPart)).toMatch(/shows a part/);
  expect((await linked.call('part_summary')).isError).toBeFalsy();

  // the user opens an assembly again
  const next = assemblyHost(plateOnly());
  linked.show(next);
  await wait(() => server!.open.kind === 'assembly');
  expect(data(await linked.call('assembly_inspect')).components).toHaveLength(1);

  // the link ends: the app's assembly is not the workspace's
  app!.disconnect();
  await wait(() => !server!.connected);
  expect(data(await linked.call('assembly_inspect')).components).toEqual([]);
  expect((await linked.call('assembly_new')).isError).toBeFalsy();
});
