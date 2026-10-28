/** P0 baseline: real PlaneGCS geometry; measures controller CPU, not DOM/render or Worker round trips. */
import { beforeAll, expect, it } from 'vitest';
import { cpus } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
const reports: unknown[] = [];
import { applyCommand, createEmptyPart, resolveSketch, type SketchEntity, type SketchFeature } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { SketchController, type SketchHost } from '../src/sketcher/controller';
let solver: PlaneGcsSolver;
beforeAll(async () => { solver = await PlaneGcsSolver.create(); });
for (const count of [100, 1000]) it(`records selection and snapping on ${count} native-solved sketch entities`, () => {
  const entities: SketchEntity[] = [];
  for (let i = 0; i < count / 2; i++) entities.push(
    { id: `p${i}`, type: 'point', x: (i % 25) * 10, y: Math.floor(i / 25) * 10 },
    { id: `c${i}`, type: 'circle', center: `p${i}`, radius: 3 },
  );
  const sketch: SketchFeature = { id: 's', name: 'baseline', type: 'sketch', suppressed: false, plane: { kind: 'datum', name: 'plane:front' }, entities, constraints: [] };
  const doc = applyCommand(createEmptyPart(), { type: 'insertFeature', index: 0, feature: sketch });
  const start = performance.now();
  const solved = solver.solve(resolveSketch(sketch, doc), { analyze: false });
  const solveMs = performance.now() - start;
  expect(solved.status).not.toBe('failed');
  expect(solved.geometry.size).toBe(count);
  const unavailable = (): never => { throw new Error('read-only pointer benchmark must not edit'); };
  const host: SketchHost = { featureId: 's', doc: () => doc, solved: () => ({ ...solved, seq: 0, problems: [], ms: solveMs }), execute: unavailable, trial: unavailable, dragPreview: unavailable, notify: unavailable, editDimension: unavailable };
  const c = new SketchController(host);
  for (const tool of ['select', 'line'] as const) {
    c.setTool(tool);
    const run = (i: number) => c.pointerMove({ p: [(i % 25) * 10 + 3.1, Math.floor((i % (count / 2)) / 25) * 10 + 0.7], px: 0.1, ctrl: false, shift: false }, false);
    for (let i = 0; i < 100; i++) run(i);
    const times = Array.from({ length: 300 }, (_, i) => { const t = performance.now(); run(i); return performance.now() - t; }).sort((a,b) => a-b);
    const p95 = times[Math.floor(times.length * .95)]!;
    reports.push({ entities: count, circles: count / 2, tool, samples: times.length, warmup: 100, pixelSize: .1, p50: times[150], p95, solveMs, cpu: cpus()[0]?.model, node: process.version, platform: process.platform, renderer: 'none', times });
    mkdirSync('out', { recursive: true });
    writeFileSync('out/sketch-p0-pointer-baseline.json', JSON.stringify(reports, null, 2));
    expect(p95).toBeLessThanOrEqual(8);
    expect(host.doc()).toBe(doc);
  }
});
