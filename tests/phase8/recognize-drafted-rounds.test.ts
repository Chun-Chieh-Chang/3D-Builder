/**
 * C4: a round on a drafted support beside a round with no simple surface (`recognize-drafted-rounds.kit.ts`: the part and why it was refused before).
 * The control asks for the sharp edge only of rounds with no simple surface, as before C4: the same part is then refused with "no edge for the round".
 */
import { beforeAll, expect, it } from 'vitest';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { RECOGNIZE_TOLERANCE, RecognizeError } from '@3db/regen';
import { recognizeStep } from './recognize-rolling-ball.kit';
import { TAPERED, taperedOnSplineBoss } from './recognize-drafted-rounds.kit';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

it('a round between a plane and a cone, on a part with a round of no simple surface: rebuilt, both rounds with their radii', async () => {
  const shape = taperedOnSplineBoss(kernel, TAPERED);
  try {
    // the premise: a torus between a plane and a cone, and a round with no simple surface
    const faces = kernel.topology(shape).faces;
    expect(faces.some((f) => f.geometry?.type === 'torus')).toBe(true);
    expect(faces.some((f) => f.geometry?.type === 'cone')).toBe(true);
    expect(faces.some((f) => f.surface === 'bsplinesurface')).toBe(true);
    const r = await recognizeStep(kernel, solver, shape);
    expect(r.report.features).toMatchObject({ extrude: 3, fillet: 2 });
    expect(r.report.volumeError).toBeLessThan(RECOGNIZE_TOLERANCE);
    expect(r.report.difference).toBeLessThan(RECOGNIZE_TOLERANCE);
    const radii = r.doc.features.flatMap((f) => (f.type === 'fillet' ? [Number(f.radius)] : [])).sort((a, b) => a - b);
    expect(Math.abs(radii[0]! - TAPERED.round)).toBeLessThan(1e-6);
    expect(Math.abs(radii[1]! - TAPERED.wallRound)).toBeLessThan(1e-6);
  } finally {
    kernel.release(shape);
  }
}, 120_000);

it('refused as before when the sharp edge is asked only for rounds of no simple surface (the control)', async () => {
  const shape = taperedOnSplineBoss(kernel, TAPERED);
  const real = kernel.sharpEdge.bind(kernel);
  kernel.sharpEdge = (s, face, supports, n) => (kernel.topology(s).faces[face]!.geometry ? null : real(s, face, supports, n));
  try {
    await expect(recognizeStep(kernel, solver, shape)).rejects.toThrow(RecognizeError);
    await expect(recognizeStep(kernel, solver, shape)).rejects.toThrow(/尖角邊/);
  } finally {
    kernel.sharpEdge = real;
    kernel.release(shape);
  }
}, 120_000);
