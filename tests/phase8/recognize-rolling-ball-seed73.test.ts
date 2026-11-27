/**
 * Rolling-ball fuzz seed 73 (to-do #3, 2026-11-27): the rebuild's exact round threw Standard_ConstructionError and OCCT's round was kept (2.8e-8 off the
 * original; the kit's `rebuiltOcct`, ADR 0265 §9.5). Where it threw: moving a vertex of an edge that meets the round, the vertex 0.047 mm past the end of
 * the edge's curve was projected onto the curve, and the projection, which gives feet of perpendiculars only, gave one 15.6 mm away along the curve; the
 * edge's range was turned inside out and the pcurve's adaptor refused it. The foot is now kept only where it is nearer than the point found from the nearer
 * end. The rebuild then keeps its exact round and reads back as the original to 1e-12.
 */
import { expect, it } from 'vitest';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { recognizeStep, sample, splineBoss } from './recognize-rolling-ball.kit';

it('rebuilds seed 73 with its exact round', async () => {
  const kernel = await Kernel.load();
  const solver = await PlaneGcsSolver.create();
  const log = () => (kernel as unknown as { exactRoundLog: { outcome: string; detail?: string }[] }).exactRoundLog.filter((x) => x.outcome !== 'stretches');
  const s = sample(73);
  const m = splineBoss(kernel, s.top, s.h);
  expect(m.edges.length).toBe(1);
  const shape = kernel.fillet(m.shape, m.edges, s.radius, undefined, undefined, true).shape;
  expect(log().map((x) => x.outcome)).toEqual(['exact']);
  const r = await recognizeStep(kernel, solver, shape);
  // the rebuild's round: exact, not OCCT's kept after a throw
  expect(log(), JSON.stringify(log())).toEqual([expect.objectContaining({ outcome: 'exact' })]);
  expect(r.report.volumeError).toBeLessThan(1e-9);
  expect(r.report.difference).toBeLessThan(1e-9);
  const fillet = r.doc.features.find((f) => f.type === 'fillet');
  expect(fillet && fillet.type === 'fillet' && fillet.exact).toBe(true);
  expect(Math.abs(Number(fillet && fillet.type === 'fillet' && fillet.radius) - s.radius)).toBeLessThan(1e-6);
}, 300_000);
