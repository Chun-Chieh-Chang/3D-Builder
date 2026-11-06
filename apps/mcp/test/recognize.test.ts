/**
 * The MCP tool `recognize_features` (F2.4, ADR 0239), driven through `callTool` as the transport drives it. The part holds an imported body (the STEP the
 * session writes of the worked example), which is replaced by native features: the volume is checked against the one worked out by hand, every sketch is
 * fully defined, undo brings the import back, and a refusal leaves the part as it was (the serialized document is compared).
 */
import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { applyCommand, createEmptyPart, serializePart } from '@3db/model';
import { sha256Hex } from '@3db/io';
import { CadSession } from '../src/session';
import { callTool } from '../src/server';
import { PLATE_WITH_HOLE, PLATE_WITH_HOLE_VOLUME } from '../src/examples';

let s: CadSession;
let root: string;
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), '3db-mcp-recognize-'));
  s = await CadSession.create({ root });
});
afterAll(() => {
  s.dispose();
  rmSync(root, { recursive: true, force: true });
});

const text = (r: CallToolResult) => (r.content[0] as { text: string }).text;
const data = (r: CallToolResult) => {
  expect(r.isError, text(r)).toBeFalsy();
  return JSON.parse(text(r));
};

/** The worked example written as STEP, read back into a new part as its only feature. */
async function importedPlate() {
  data(await callTool(s, 'part_new', {}));
  data(await callTool(s, 'apply_commands', { commands: PLATE_WITH_HOLE }));
  data(await callTool(s, 'export_file', { path: 'plate.step', format: 'step' }));
  const bytes = new Uint8Array(readFileSync(join(root, 'plate.step')));
  const sha = await sha256Hex(bytes);
  const doc = applyCommand(createEmptyPart(), { type: 'importBody', blob: { id: 'blob1', sha256: sha, kind: 'step', fileName: 'plate.step' }, feature: { id: 'import1', type: 'importedBody', name: '輸入1', suppressed: false, blob: 'blob1' }, index: 0 });
  return s.load(doc, new Map([[sha, bytes]]));
}

it('replaces the imported body by fully defined native features of the same solid, as one batch that undo takes back', async () => {
  const before = await importedPlate();
  expect(before.features.map((f) => f.type)).toEqual(['importedBody']);
  expect(Math.abs(before.mass!.volume - PLATE_WITH_HOLE_VOLUME) / PLATE_WITH_HOLE_VOLUME).toBeLessThan(1e-6);
  const r = data(await callTool(s, 'recognize_features', { feature: 'import1' }));
  expect(r.committed).toBe(true);
  expect(r.broken).toEqual([]);
  expect(r.recognized).toMatchObject({ features: { extrude: 1, hole: 1 } });
  expect(r.recognized.difference).toBeLessThanOrEqual(1e-6);
  const types = r.after.features.map((f: { type: string }) => f.type);
  expect(types).not.toContain('importedBody');
  expect(types).toEqual(expect.arrayContaining(['sketch', 'extrude', 'hole']));
  expect(r.after.features.every((f: { status: string }) => f.status === 'ok')).toBe(true);
  expect(r.after.features.filter((f: { sketch?: { status: string; dof: number } }) => f.sketch).map((f: { sketch: { status: string; dof: number } }) => `${f.sketch.status}/${f.sketch.dof}`)).toEqual(['fully/0', 'fully/0']);
  expect(Math.abs(r.after.mass.volume - PLATE_WITH_HOLE_VOLUME) / PLATE_WITH_HOLE_VOLUME).toBeLessThan(1e-6);
  const undone = data(await callTool(s, 'undo', {}));
  expect(undone.features.map((f: { type: string }) => f.type)).toEqual(['importedBody']);
  expect(Math.abs(undone.mass.volume - PLATE_WITH_HOLE_VOLUME) / PLATE_WITH_HOLE_VOLUME).toBeLessThan(1e-6);
});

it('refuses a feature that is not an imported body, or none, and leaves the part as it was', async () => {
  await importedPlate();
  const doc = serializePart(s.doc);
  for (const feature of ['nothing', '']) {
    const r = await callTool(s, 'recognize_features', { feature });
    expect(r.isError).toBe(true);
    expect(text(r)).toMatch(/輸入的本體|imported body/);
    expect(serializePart(s.doc)).toBe(doc);
  }
  const misspelt = await callTool(s, 'recognize_features', { featre: 'import1' });
  expect(misspelt.isError).toBe(true);
  expect(serializePart(s.doc)).toBe(doc);
});
