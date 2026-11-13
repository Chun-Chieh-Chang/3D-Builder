import { it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CadSession } from '../src/session';
import { featureCommands, type CadFeature } from '../src/cadFeatures';

it('builds 100 seeded primitive configurations with independently computed volumes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cad-fuzz-'));
  const s = await CadSession.create({ root });
  let seed = 251;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2 ** 32; };
  const initial = s.heapBytes();
  expect(initial).toBeGreaterThan(0);
  let boxes = 0, cylinders = 0;
  try {
    for (let i = 0; i < 100; i++) {
      await s.newPart();
      const a = 0.1 + random() * 30, b = 0.1 + random() * 30, h = 0.1 + random() * 20;
      const feature: CadFeature = i % 2 ? { operation: 'create_primitive', shape: 'box', id: 'p', width: a, depth: b, height: h } : { operation: 'create_primitive', shape: 'cylinder', id: 'p', radius: a, height: h };
      const report = await s.apply(featureCommands(s, feature));
      expect(report.committed, JSON.stringify(report.error)).toBe(true);
      expect(Math.abs(s.summary().mass!.volume / (i % 2 ? a * b * h : Math.PI * a * a * h) - 1)).toBeLessThan(0.0005);
      if (i % 2) boxes++; else cylinders++;
    }
    expect(boxes).toBe(50); expect(cylinders).toBe(50);
    const final = s.heapBytes();
    expect(final).toBeGreaterThan(0);
    expect(final! - initial!).toBeLessThanOrEqual(512 * 1024 * 1024);
    console.info('CAD primitive fuzz heap bytes (not a zero-leak claim)', { initial, final: s.heapBytes() });
  } finally { s.dispose(); rmSync(root, { recursive: true, force: true }); }
});
