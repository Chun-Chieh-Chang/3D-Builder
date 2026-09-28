/** Phase 0 performance measurements (blueprint §4 budgets). Prints a table; asserts only the hard budgets. */
import { expect, it } from 'vitest';
import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createDemoPart } from '@3db/model';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { Regenerator } from '@3db/regen';
import { exportPartStep, partName } from '@3db/io';

const median = (xs: number[]) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

it('measures Phase 0 performance', async () => {
  let t = performance.now();
  const kernel = await Kernel.load();
  const kernelInit = performance.now() - t;
  t = performance.now();
  const solver = await PlaneGcsSolver.create();
  const solverInit = performance.now() - t;
  const regen = new Regenerator(kernel, solver);
  const doc = createDemoPart();

  regen.rebuild(doc);
  const rebuilds = Array.from({ length: 20 }, () => regen.rebuild(doc).totalMs);
  const r = regen.rebuild(doc);
  const solveMs = r.features[0]!.ms;
  t = performance.now();
  const mesh = kernel.mesh(r.body!.shape);
  const meshMs = performance.now() - t;
  t = performance.now();
  const step = exportPartStep(kernel, r.body!.shape, partName(doc, null));
  const stepMs = performance.now() - t;

  const require = createRequire(import.meta.url);
  const wasm = require.resolve('libcascade/single/wasm');
  const rows = {
    'OCCT WASM size (MB)': (statSync(wasm).size / 1e6).toFixed(1),
    'OCCT init (ms)': kernelInit.toFixed(0),
    'PlaneGCS init (ms)': solverInit.toFixed(0),
    'rebuild demo, median of 20 (ms)': median(rebuilds).toFixed(1),
    'sketch solve (ms)': solveMs.toFixed(2),
    'mesh (ms)': meshMs.toFixed(1),
    'triangles': String(mesh.indices.length / 3),
    'STEP export (ms)': stepMs.toFixed(1),
    'STEP size (KB)': (step.length / 1024).toFixed(1),
  };
  console.table(rows);
  expect(median(rebuilds)).toBeLessThan(500);
});
