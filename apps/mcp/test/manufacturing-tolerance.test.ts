import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CadSession } from '../src/session';
import { PLATE_WITH_HOLE } from '../src/examples';

let session: CadSession;
const root = mkdtempSync(join(tmpdir(), 'cad-tolerance-'));
beforeAll(async () => {
  session = await CadSession.create({ root });
  expect((await session.apply(PLATE_WITH_HOLE)).committed).toBe(true);
});
afterAll(() => { session?.dispose(); rmSync(root, { recursive: true, force: true }); });

it('rejects invalid tolerances before writing a file', async () => {
  for (const tolerance of [0, -1, NaN, Infinity, 1e-300, 0.00001]) {
    await expect(session.exportFile('invalid.stl', 'stl', tolerance)).rejects.toThrow(/meshTolerance/);
  }
  expect(existsSync(join(root, 'invalid.stl'))).toBe(false);
});

it('uses the supplied absolute tolerance in the real tessellation', async () => {
  await session.exportFile('fine.stl', 'stl', 0.001);
  // OCCT may reuse a finer existing triangulation. Compare independently built shapes.
  await session.newPart();
  expect((await session.apply(PLATE_WITH_HOLE)).committed).toBe(true);
  await session.exportFile('coarse.stl', 'stl', 0.5);
  const triangles = (file: string) => readFileSync(join(root, file)).readUInt32LE(80);
  expect(triangles('fine.stl')).toBeGreaterThan(triangles('coarse.stl'));
});
