/**
 * The server as Claude Code uses it (ADR 0237): the built `dist/server.mjs` started as a child process, spoken to over stdio by the official MCP client,
 * and the built `dist/cli.mjs` run as a user runs it. Nothing of either is imported: what passes is what a real client sees. Both are in this one file
 * so that `vite build` (which empties `dist`) runs once: two files building at once would delete each other's output while it is in use.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { LoggingMessageNotificationSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { PLATE_WITH_HOLE, PLATE_WITH_HOLE_VOLUME } from '../src/examples';

const here = resolve(__dirname, '..');
let root: string;
let client: Client;
const logs: unknown[] = [];

beforeAll(async () => {
  execFileSync(process.execPath, [resolve(here, '../../node_modules/vite/bin/vite.js'), 'build'], { cwd: here, stdio: 'ignore' });
  root = mkdtempSync(join(tmpdir(), '3db-e2e-'));
  client = new Client({ name: 'e2e', version: '1' });
  client.setNotificationHandler(LoggingMessageNotificationSchema, (n) => {
    logs.push(n.params.data);
  });
  await client.connect(new StdioClientTransport({ command: 'node', args: [join(here, 'dist', 'server.mjs')], env: { ...process.env, THREEDB_WORKSPACE: root } as Record<string, string>, stderr: 'ignore' }));
}, 120_000);
afterAll(async () => {
  await client?.close();
  rmSync(root, { recursive: true, force: true });
});

const call = async (name: string, args: Record<string, unknown> = {}) => (await client.callTool({ name, arguments: args })) as CallToolResult;
const json = (r: CallToolResult) => JSON.parse((r.content[0] as { text: string }).text);

it('tells the client how to work, and lists its tools', async () => {
  expect(client.getInstructions()).toMatch(/apply_commands/);
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name).sort()).toEqual(['apply_commands', 'command_reference', 'export_file', 'live_status', 'part_new', 'part_open', 'part_save', 'part_summary', 'query_elements', 'rebuild_events', 'render_view', 'session_status', 'undo']);
});

it('builds, previews, checks, looks at and writes a part', async () => {
  // preview first: nothing kept, a picture to show the user
  const dry = await call('apply_commands', { commands: PLATE_WITH_HOLE, dry_run: true, preview: { view: 'isometric', size: 300 } });
  expect(json(dry)).toMatchObject({ committed: false, dryRun: true });
  expect(dry.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' });
  expect(json(await call('part_summary')).features).toEqual([]);

  const r = json(await call('apply_commands', { commands: PLATE_WITH_HOLE }));
  expect(r.committed).toBe(true);
  expect(r.after.mass.volume).toBeCloseTo(PLATE_WITH_HOLE_VOLUME, 3);

  const top = json(await call('query_elements', { kind: 'face', direction: [0, 1, 0] }));
  expect(top).toHaveLength(1);
  const picture = await call('render_view', { view: 'top', size: 200 });
  expect(picture.content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });

  expect(json(await call('part_save', { path: 'plate.3dbx' })).bytes).toBeGreaterThan(0);
  json(await call('export_file', { path: 'plate.3mf', format: '3mf' }));
  expect(existsSync(join(root, 'plate.3dbx')) && existsSync(join(root, 'plate.3mf'))).toBe(true);

  const refused = await call('apply_commands', { commands: [{ type: 'explode' }] });
  expect(refused.isError).toBe(true);

  const events = json(await call('rebuild_events', { limit: 5 }));
  expect(events.map((e: { cause: string; committed: boolean; dryRun?: boolean }) => [e.cause, e.committed, !!e.dryRun])).toEqual([['apply', false, true], ['apply', true, false]]);
  // the same events came as notifications, as they happened
  await new Promise((r) => setTimeout(r, 50));
  expect(logs.length).toBeGreaterThanOrEqual(2);
  expect(json(await call('session_status')).heapBytes).toBeGreaterThan(0);
}, 120_000);

/** As in script.test.ts: a disc with a hole and an equal-distance chamfer on its top rim (Pappus for the chamfer). */
const discVolume = (r: number, t: number, h: number, c: number) => Math.PI * r * r * t - Math.PI * h * h * t - Math.PI * (r - c / 3) * c * c;

describe('the CLI', () => {
  it('runs the disc script without a window and exits 0', () => {
    const out = mkdtempSync(join(tmpdir(), '3db-cli-'));
    try {
      const r = spawnSync('node', [join(here, 'dist', 'cli.mjs'), 'run', join(here, 'examples', 'disc.json'), '--set', 'T=12', '--out', out], { encoding: 'utf8' });
      expect(r.status, r.stderr).toBe(0);
      const report = JSON.parse(r.stdout);
      expect(report.committed).toBe(true);
      expect(report.summary.mass.volume).toBeCloseTo(discVolume(30, 12, 5, 1), 3);
      expect(existsSync(join(out, 'disc.3mf'))).toBe(true);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 60_000);

  it('exits 1 for a script it refuses and 2 for a wrong command line', () => {
    const out = mkdtempSync(join(tmpdir(), '3db-cli-'));
    try {
      const refused = spawnSync('node', [join(here, 'dist', 'cli.mjs'), 'run', join(here, 'examples', 'disc.json'), '--set', 'NOPE=1', '--out', out], { encoding: 'utf8' });
      expect(refused.status).toBe(1);
      expect(refused.stderr).toMatch(/no variable NOPE/);
      const wrong = spawnSync('node', [join(here, 'dist', 'cli.mjs'), 'build'], { encoding: 'utf8' });
      expect(wrong.status).toBe(2);
      expect(wrong.stderr).toMatch(/usage/);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 60_000);
});
