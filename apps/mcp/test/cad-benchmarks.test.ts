import { beforeAll, afterAll, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readBinaryStl } from '@3db/io';
import { gearParameters } from '@3db/model';
import { gear, gearArea } from '../../../tests/phase3/gear-helpers';
import { CadSession } from '../src/session';

let s: CadSession;
const root = mkdtempSync(join(tmpdir(), 'cad-benchmark-'));
beforeAll(async () => { s = await CadSession.create({ root }); });
afterAll(() => { s?.dispose(); rmSync(root, { recursive: true, force: true }); });
it('measures an annular flange against analytic volume and bounds', async () => {
  const script = JSON.parse(readFileSync(resolve('apps/mcp/examples/disc.json'), 'utf8'));
  const commands = script.commands.slice(0, 4);
  commands[0].feature.constraints[0].value = '30';
  commands[1].feature.dir1.depth = '10';
  commands[2].feature.constraints[0].value = '5';
  expect((await s.apply(commands)).committed).toBe(true);
  const summary = s.summary(undefined, true);
  expect(Math.abs(summary.mass!.volume / (Math.PI * (30 ** 2 - 5 ** 2) * 10) - 1)).toBeLessThanOrEqual(0.0005);
  for (const [actual, expected] of summary.box!.size.map((a, i) => [a, [60, 10, 60][i]!])) expect(Math.abs(actual! - expected!)).toBeLessThanOrEqual(0.01);
});
it('exports a closed manifold STL and a valid solid STEP', async () => {
  await s.exportFile('flange.stl', 'stl', 0.005);
  const triangles = readBinaryStl(new Uint8Array(readFileSync(join(root, 'flange.stl'))));
  const edges = new Map<string, { count: number; orientation: number }>();
  for (const t of triangles) {
    const vertices = [0, 3, 6].map((i) => Array.from(t.slice(i, i + 3)).map((v) => Math.round(v * 1e5)).join(','));
    expect(new Set(vertices).size).toBe(3);
    for (let i = 0; i < 3; i++) {
      const a = vertices[i]!, b = vertices[(i + 1) % 3]!;
      const key = [a, b].sort().join('|');
      const entry = edges.get(key) ?? { count: 0, orientation: 0 };
      entry.count++; entry.orientation += a < b ? 1 : -1; edges.set(key, entry);
    }
  }
  expect(edges.size).toBeGreaterThan(0);
  for (const edge of edges.values()) expect(edge).toEqual({ count: 2, orientation: 0 });
  await s.exportFile('flange.step', 'step');
  const kernel = s.kernelForView;
  const imported = kernel.importStep(new Uint8Array(readFileSync(join(root, 'flange.step'))));
  const shape = imported.shape;
  try {
    expect(imported.diagnostics).toMatchObject({ validBefore: true, healed: false, sewn: false, looseFaces: 0 });
    expect(kernel.isValid(shape)).toBe(true); expect(kernel.solidCount(shape)).toBe(1);
    // A periodic face's seam has one distinct adjacent face but two uses. Count actual free bounds instead.
    expect(kernel.check(shape)).toMatchObject({ valid: true, freeEdges: 0, badFaces: [], solids: 1 });
  }
  finally { kernel.release(shape); }
});
it('measures a true involute gear against its analytic polar integral', async () => {
  await s.newPart();
  const feature = gear();
  expect((await s.apply([{ type: 'insertFeature', index: 0, feature }])).committed).toBe(true);
  const p = gearParameters(feature), summary = s.summary(undefined, true);
  expect(Math.abs(summary.mass!.volume / (gearArea(p) * p.width) - 1)).toBeLessThanOrEqual(0.0005);
  for (let i = 0; i < 3; i++) expect(Math.abs(summary.box!.size[i]! - [52, 52, 10][i]!)).toBeLessThanOrEqual(0.01);
});
