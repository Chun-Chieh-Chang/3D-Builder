/**
 * The MCP tools (ADR 0237), driven through `callTool` as the transport drives them. Every figure is checked against a value worked out by hand, and every
 * refusal is checked to leave the part as it was (the serialized document is compared, not a count).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { serializePart } from '@3db/model';
import { readBinaryStl, stlMeasure } from '@3db/io';
import { CadSession } from '../src/session';
import { callTool } from '../src/server';
import { COMMAND_TYPES } from '../src/commandTypes';
import { PLATE_WITH_HOLE, PLATE_WITH_HOLE_VOLUME } from '../src/examples';

let s: CadSession;
let root: string;
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), '3db-mcp-'));
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
const refusedWith = (r: CallToolResult, pattern: RegExp) => {
  expect(r.isError).toBe(true);
  expect(text(r)).toMatch(pattern);
};
async function plate() {
  data(await callTool(s, 'part_new', {}));
  return data(await callTool(s, 'apply_commands', { commands: PLATE_WITH_HOLE }));
}
const snapshot = () => serializePart(s.doc);

describe('building through the tools', () => {
  it('builds the worked example to the volume worked out by hand', async () => {
    const r = await plate();
    expect(r.committed).toBe(true);
    expect(r.broken).toEqual([]);
    expect(r.after.features.map((f: { status: string }) => f.status)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(r.after.features[0].sketch).toMatchObject({ status: 'fully', dof: 0 });
    expect(r.after.mass.volume).toBeCloseTo(PLATE_WITH_HOLE_VOLUME, 3);
    expect(r.volumeChange).toBeCloseTo(PLATE_WITH_HOLE_VOLUME, 3);
    // y is up: the plate stands 10 on the top plane
    expect(r.after.box.min).toEqual([-30, 0, -20]);
    expect(r.after.box.size).toEqual([60, 10, 40]);
  });

  it('gives references a command can use: a fillet on the four upright edges found by query', async () => {
    await plate();
    const upright = data(await callTool(s, 'query_elements', { kind: 'edge', type: 'line', direction: [0, 1, 0] }));
    // the four corners and the seam of the hole's cylinder, which is marked
    expect(upright).toHaveLength(5);
    expect(upright.filter((e: { seam?: boolean }) => e.seam)).toHaveLength(1);
    const edges = upright.filter((e: { seam?: boolean }) => !e.seam);
    expect(edges).toHaveLength(4);
    for (const e of edges) expect(e.length).toBeCloseTo(10, 6);
    const r = data(await callTool(s, 'apply_commands', { commands: [{ type: 'insertFeature', index: 4, feature: { id: 'f1', type: 'fillet', name: 'Round', suppressed: false, edges: edges.map((e: { ref: unknown }) => e.ref), radius: '3' } }] }));
    expect(r.committed).toBe(true);
    // each round takes away (r² − πr²/4)·h
    expect(r.after.mass.volume).toBeCloseTo(PLATE_WITH_HOLE_VOLUME - 4 * (9 - (Math.PI * 9) / 4) * 10, 3);
  });

  it('names every element of the body, one name for each', async () => {
    await plate();
    const faces = data(await callTool(s, 'query_elements', { kind: 'face' }));
    const edges = data(await callTool(s, 'query_elements', { kind: 'edge' }));
    const vertices = data(await callTool(s, 'query_elements', { kind: 'vertex' }));
    // a box with a hole through it: 6 + 1 faces, 12 + 2 circles + 1 seam edges
    expect(faces).toHaveLength(7);
    expect(edges).toHaveLength(15);
    for (const list of [faces, edges, vertices]) expect(new Set(list.map((x: { ref: { name: string } }) => x.ref.name)).size).toBe(list.length);
    const top = data(await callTool(s, 'query_elements', { kind: 'face', type: 'plane', direction: [0, 1, 0] }));
    expect(top).toHaveLength(1);
    expect(top[0].center[1]).toBeCloseTo(10, 6);
    expect(top[0].area).toBeCloseTo(2400 - Math.PI * 25, 3);
    const hole = data(await callTool(s, 'query_elements', { kind: 'face', type: 'cylinder' }));
    expect(hole).toHaveLength(1);
    expect(hole[0].radius).toBeCloseTo(5, 6);
  });

  it('a dry run shows the result and keeps nothing', async () => {
    data(await callTool(s, 'part_new', {}));
    const before = snapshot();
    const r = data(await callTool(s, 'apply_commands', { commands: PLATE_WITH_HOLE, dry_run: true }));
    expect(r).toMatchObject({ committed: false, dryRun: true });
    expect(r.after.mass.volume).toBeCloseTo(PLATE_WITH_HOLE_VOLUME, 3);
    expect(snapshot()).toBe(before);
    expect(data(await callTool(s, 'part_summary', {})).features).toEqual([]);
  });

  it('undo takes back the last batch kept', async () => {
    await plate();
    const before = snapshot();
    data(await callTool(s, 'apply_commands', { commands: [{ type: 'setDimension', featureId: 's1', constraintId: 'w', value: '80' }] }));
    expect(data(await callTool(s, 'part_summary', {})).box.size[0]).toBeCloseTo(80, 6);
    const back = data(await callTool(s, 'undo', {}));
    expect(back.box.size[0]).toBeCloseTo(60, 6);
    expect(snapshot()).toBe(before);
  });
});

describe('refusals leave the part as it was (red team: input)', () => {
  const cases: [string, unknown, RegExp][] = [
    ['an unknown command type', [{ type: 'explode' }], /unknown type "explode"/],
    ['a command with no type', [{ featureId: 's1' }], /unknown type undefined/],
    ['a command that is not an object', ['setDimension'], /not an object/],
    ['an empty batch', [], /non-empty array/],
    ['commands that are not an array', { type: 'undo' }, /non-empty array/],
    ['too many commands', Array.from({ length: 201 }, () => ({ type: 'setDimension' })), /at most 200/],
  ];
  for (const [what, commands, pattern] of cases) {
    it(`refuses ${what}`, async () => {
      await plate();
      const before = snapshot();
      refusedWith(await callTool(s, 'apply_commands', { commands }), pattern);
      expect(snapshot()).toBe(before);
    });
  }

  it('refuses the whole batch when one command fails, and says which', async () => {
    await plate();
    const before = snapshot();
    const r = await callTool(s, 'apply_commands', { commands: [{ type: 'setDimension', featureId: 's1', constraintId: 'w', value: '80' }, { type: 'setDimension', featureId: 's1', constraintId: 'nope', value: '5' }] });
    expect(r.isError).toBe(true);
    expect(JSON.parse(text(r))).toMatchObject({ committed: false, error: { command: 1 } });
    expect(snapshot()).toBe(before);
    expect(data(await callTool(s, 'part_summary', {})).box.size[0]).toBeCloseTo(60, 6);
  });

  it('refuses a batch that breaks a feature and keeps the part as built before', async () => {
    data(await callTool(s, 'part_new', {}));
    // the cut without `reverse` goes out of the material: the extrude stays, the cut fails
    const commands = structuredClone(PLATE_WITH_HOLE) as typeof PLATE_WITH_HOLE;
    (commands[3] as { feature: { dir1: object } }).feature.dir1 = { type: 'throughAll' };
    const r = await callTool(s, 'apply_commands', { commands });
    expect(r.isError).toBe(true);
    const report = JSON.parse(text(r));
    expect(report.committed).toBe(false);
    expect(report.broken.map((b: { id: string }) => b.id)).toEqual(['c1']);
    expect(report.broken[0].message).toBeTruthy();
    expect(data(await callTool(s, 'part_summary', {})).features).toEqual([]);
  });

  for (const value of ['NaN', '-5', '0', '1e400', 'abc', '']) {
    it(`does not keep an extrude depth of ${JSON.stringify(value)}`, async () => {
      await plate();
      const before = snapshot();
      const r = await callTool(s, 'apply_commands', { commands: [{ type: 'setEndCondition', featureId: 'e1', dir: 'dir1', value: { type: 'blind', depth: value } }] });
      expect(r.isError, text(r)).toBe(true);
      expect(snapshot()).toBe(before);
      expect(data(await callTool(s, 'part_summary', {})).mass.volume).toBeCloseTo(PLATE_WITH_HOLE_VOLUME, 3);
    });
  }

  it('refuses arguments a tool does not take, and missing ones', async () => {
    refusedWith(await callTool(s, 'apply_commands', { command: [] }), /takes no argument command/);
    refusedWith(await callTool(s, 'apply_commands', { commands: PLATE_WITH_HOLE, dry_run: 'yes' }), /dry_run must be true or false/);
    refusedWith(await callTool(s, 'query_elements', {}), /needs kind/);
    refusedWith(await callTool(s, 'query_elements', { kind: 'solid' }), /kind must be face, edge or vertex/);
    refusedWith(await callTool(s, 'query_elements', { kind: 'face', limit: 1.5 }), /limit must be a positive whole number/);
    refusedWith(await callTool(s, 'query_elements', { kind: 'face', direction: [0, 0, 0] }), /direction must not be zero/);
    refusedWith(await callTool(s, 'query_elements', { kind: 'face', direction: [0, Number.NaN, 1] }), /three finite numbers/);
    refusedWith(await callTool(s, 'no_such_tool', {}), /no tool/);
  });
});

describe('files stay inside the workspace folder', () => {
  it('saves, opens again, and exports STEP and STL that hold the same part', async () => {
    await plate();
    const saved = data(await callTool(s, 'part_save', { path: 'parts/plate.3dbx' }));
    expect(saved.path).toBe(join(root, 'parts', 'plate.3dbx'));
    data(await callTool(s, 'part_new', {}));
    const opened = data(await callTool(s, 'part_open', { path: 'parts/plate.3dbx' }));
    expect(opened.mass.volume).toBeCloseTo(PLATE_WITH_HOLE_VOLUME, 3);

    data(await callTool(s, 'export_file', { path: 'out/plate.step', format: 'step' }));
    expect(readFileSync(join(root, 'out', 'plate.step'), 'utf8')).toMatch(/^ISO-10303-21;/);
    data(await callTool(s, 'export_file', { path: 'out/plate.stl', format: 'stl' }));
    const { volume } = stlMeasure(readBinaryStl(new Uint8Array(readFileSync(join(root, 'out', 'plate.stl')))));
    // a mesh of the hole is a polygon inside the circle: a little more material, never less
    expect(volume).toBeGreaterThanOrEqual(PLATE_WITH_HOLE_VOLUME - 1e-6);
    expect(volume / PLATE_WITH_HOLE_VOLUME - 1).toBeLessThan(1e-3);
  });

  it('refuses paths outside the folder, through .. or a link', async () => {
    await plate();
    refusedWith(await callTool(s, 'part_save', { path: '../escape.3dbx' }), /outside the workspace/);
    refusedWith(await callTool(s, 'part_save', { path: '/tmp/escape.3dbx' }), /outside the workspace/);
    const outside = mkdtempSync(join(tmpdir(), '3db-outside-'));
    symlinkSync(outside, join(root, 'link'));
    refusedWith(await callTool(s, 'part_save', { path: 'link/escape.3dbx' }), /outside the workspace/);
    expect(existsSync(join(outside, 'escape.3dbx'))).toBe(false);
    rmSync(outside, { recursive: true, force: true });
    refusedWith(await callTool(s, 'part_save', { path: 'plate.json' }), /ends in \.3dbx/);
    refusedWith(await callTool(s, 'export_file', { path: 'plate.step', format: 'iges' }), /format must be step, stl, 3mf/);
    refusedWith(await callTool(s, 'part_open', { path: 'missing.3dbx' }), /ENOENT/);
  });
});

describe('the picture (S2)', () => {
  /** The RGB of pixel (x, y) of a PNG of 8-bit RGBA, filter bytes undone. */
  function pixel(png: Buffer, x: number, y: number): [number, number, number] {
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    let idat = Buffer.alloc(0);
    for (let o = 8; o < png.length; ) {
      const len = png.readUInt32BE(o);
      if (png.toString('latin1', o + 4, o + 8) === 'IDAT') idat = Buffer.concat([idat, png.subarray(o + 8, o + 8 + len)]);
      o += 12 + len;
    }
    const raw = inflateSync(idat);
    const stride = width * 4;
    const rows: Buffer[] = [];
    for (let r = 0; r < height; r++) {
      const f = raw[r * (stride + 1)]!;
      const row = Buffer.from(raw.subarray(r * (stride + 1) + 1, (r + 1) * (stride + 1)));
      const up = rows[r - 1];
      for (let i = 0; i < stride; i++) {
        const a = i >= 4 ? row[i - 4]! : 0;
        const b = up ? up[i]! : 0;
        const c = up && i >= 4 ? up[i - 4]! : 0;
        const p = a + b - c;
        const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
        row[i] = (row[i]! + pred) & 255;
      }
      rows.push(row);
    }
    const px = rows[y]!.subarray(x * 4, x * 4 + 3);
    return [px[0]!, px[1]!, px[2]!];
  }

  it('shows the plate from the top: the hole is white, the plate is shaded, the image has the plate’s proportions', async () => {
    await plate();
    const r = await callTool(s, 'render_view', { view: 'top', size: 400 });
    expect(r.isError).toBeFalsy();
    const image = r.content[0] as { type: string; data: string; mimeType: string };
    expect(image).toMatchObject({ type: 'image', mimeType: 'image/png' });
    const png = Buffer.from(image.data, 'base64');
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    const w = png.readUInt32BE(16);
    const h = png.readUInt32BE(20);
    expect(w).toBeLessThanOrEqual(404);
    // 60 × 40 plus the same margin on each side
    expect((w - 32) / (h - 32)).toBeCloseTo(1.5, 1);
    expect(pixel(png, Math.floor(w / 2), Math.floor(h / 2))).toEqual([255, 255, 255]);
    const plateColor = pixel(png, Math.floor(w / 4), Math.floor(h / 4));
    expect(plateColor).not.toEqual([255, 255, 255]);
    expect(Math.max(...plateColor) - Math.min(...plateColor)).toBeLessThan(60); // the grey-blue of the shading
  });

  it('refuses sizes and directions it cannot draw', async () => {
    await plate();
    refusedWith(await callTool(s, 'render_view', { size: 63 }), /size must be/);
    refusedWith(await callTool(s, 'render_view', { size: 2049 }), /size must be/);
    refusedWith(await callTool(s, 'render_view', { size: 400.5 }), /size must be/);
    refusedWith(await callTool(s, 'render_view', { view: 'diagonal' }), /view must be one of/);
    refusedWith(await callTool(s, 'render_view', { dir: [0, 1, 0], up: [0, 2, 0] }), /parallel/);
    refusedWith(await callTool(s, 'render_view', { view: 'top', dir: [0, 1, 0], up: [0, 0, 1] }), /not both/);
    data(await callTool(s, 'part_new', {}));
    refusedWith(await callTool(s, 'render_view', {}), /no body/);
  });
});

describe('the command reference is the source', () => {
  it('holds every command type, and the types by name', async () => {
    const commands = text(await callTool(s, 'command_reference', { topic: 'commands' }));
    expect(commands).toMatch(/^\/\*\*[\s\S]*?\*\/\nexport type Command =/);
    expect(commands.trimEnd().endsWith(';')).toBe(true);
    for (const type of Object.keys(COMMAND_TYPES)) expect(commands, type).toMatch(new RegExp(`type\\s*:\\s*'${type}'`));
    const types = text(await callTool(s, 'command_reference', { topic: 'types', names: ['ExtrudeFeature', 'EndCondition', 'Nope'] }));
    expect(types).toMatch(/export interface ExtrudeFeature/);
    expect(types).toMatch(/\| \{ type: 'throughAll'; reverse\?: boolean \}/);
    expect(types).toMatch(/Nope: no such type/);
    expect(text(await callTool(s, 'command_reference', { topic: 'example' }))).toContain('"type": "insertFeature"');
    refusedWith(await callTool(s, 'command_reference', { topic: 'types' }), /needs names/);
  });
});

describe('what the session gives back', () => {
  it('holds no more shapes after a hundred batches kept, refused and taken back', async () => {
    await plate();
    const live = s.liveShapes();
    for (let i = 0; i < 100; i++) {
      const value = String(40 + (i % 7));
      await callTool(s, 'apply_commands', { commands: [{ type: 'setDimension', featureId: 's1', constraintId: 'w', value }] });
      await callTool(s, 'apply_commands', { commands: [{ type: 'setEndCondition', featureId: 'e1', dir: 'dir1', value: { type: 'blind', depth: '-1' } }] });
      await callTool(s, 'undo', {});
    }
    expect(s.liveShapes()).toBe(live);
  });

  it('loads the kernel again when its heap has grown past the limit, and the part is the same after', async () => {
    const own = await CadSession.create({ root, heapLimit: 64 * 1024 * 1024 });
    try {
      await callTool(own, 'apply_commands', { commands: PLATE_WITH_HOLE });
      const base = own.heapBytes();
      expect(base).toBeGreaterThan(0); // AGENTS.md §3.1: the measure exists before it is relied on
      // take 256 MiB from the kernel's own allocator: the heap grows the way OCCT makes it grow (memory.grow() from outside would leave the
      // module's views of its memory stale), and it is the buffer heapOf reads, so the decision sees real growth (AGENTS.md §3.2)
      const at = (own as unknown as { kernel: { oc: { ___libc_malloc(n: number): number } } }).kernel.oc.___libc_malloc(256 * 1024 * 1024);
      expect(at).toBeGreaterThan(0);
      expect(own.heapBytes()! - base!).toBeGreaterThanOrEqual(64 * 1024 * 1024);
      const r = data(await callTool(own, 'apply_commands', { commands: [{ type: 'setDimension', featureId: 's1', constraintId: 'w', value: '70' }] }));
      expect(own.restarts).toBe(1);
      expect(own.heapBytes()!).toBeLessThan(base! + 64 * 1024 * 1024);
      expect(r.after.mass.volume).toBeCloseTo(70 * 40 * 10 - Math.PI * 25 * 10, 3);
      expect(data(await callTool(own, 'session_status', {}))).toMatchObject({ kernelRestarts: 1 });
    } finally {
      own.dispose();
    }
  });
});
