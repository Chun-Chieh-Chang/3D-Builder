/**
 * C4: recognition of parts whose planes and cylinders a file stores as B-splines (`recognize-analytic-faces.kit.ts`: how they are made and why what
 * they must come back as is known). Each positive case has its control: the same file with the reading of spline faces as simple ones switched off
 * is refused, so the rebuild is this capability's doing and not something recognition did before.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { RECOGNIZE_TOLERANCE, RecognizeError } from '@3db/regen';
import { moved, plate, recognizeText, splineStep, type Plate } from './recognize-analytic-faces.kit';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const CASES: Record<string, Plate> = {
  'a box': { w: 40, h: 30, t: 12, holes: [] },
  'a plate with a hole': { w: 40, h: 30, t: 12, holes: [{ c: [20, 15], r: 6 }] },
  'a plate with two holes and a boss': { w: 60, h: 40, t: 8, holes: [{ c: [12, 10], r: 3 }, { c: [45, 12], r: 4.5 }], boss: { c: [30, 28], r: 7, h: 9 } },
};

async function refusal(text: string): Promise<string> {
  try {
    await recognizeText(kernel, solver, text);
  } catch (e) {
    expect(e).toBeInstanceOf(RecognizeError);
    return (e as Error).message;
  }
  throw new Error('not refused');
}

describe('planes and cylinders stored as B-splines', () => {
  for (const [name, p] of Object.entries(CASES)) {
    it(`${name}: rebuilt as the same solid, its volume the closed-form one`, async () => {
      const made = plate(kernel, p);
      const text = splineStep(kernel, made.shape);
      kernel.release(made.shape);
      // the premise: the file has no plane or cylinder
      const read = kernel.importStep(new TextEncoder().encode(text)).shape;
      expect(kernel.topology(read).faces.every((f) => !f.geometry)).toBe(true);
      kernel.release(read);
      const live = kernel.liveShapes;
      const out = await recognizeText(kernel, solver, text);
      expect(kernel.liveShapes).toBe(live);
      expect(out.report.volumeError).toBeLessThan(RECOGNIZE_TOLERANCE);
      expect(out.report.areaError).toBeLessThan(RECOGNIZE_TOLERANCE);
      expect(out.report.difference).toBeLessThan(RECOGNIZE_TOLERANCE);
      // the truth, not the file's own figure
      expect(Math.abs(out.report.volume - made.volume) / made.volume).toBeLessThan(1e-7);
      expect(out.report.fileTolerance).toBeUndefined();
      expect(out.report.features.extrude).toBe(p.boss ? 2 : 1);
      expect(out.doc.features.some((f) => f.type === 'importedBody')).toBe(false);
    }, 120_000);

    it(`${name}: refused when spline faces are not read as simple ones (the control)`, async () => {
      const made = plate(kernel, p);
      const text = splineStep(kernel, made.shape);
      kernel.release(made.shape);
      const real = kernel.analyticFace;
      kernel.analyticFace = () => null;
      try {
        expect(await refusal(text)).toMatch(/自由曲面|不支援的曲線/);
      } finally {
        kernel.analyticFace = real;
      }
    }, 120_000);
  }

  it('a disc: turned, and its volume to 1e-7 of πr²h though OCCT has the spline original 2e-6 off', async () => {
    const d = kernel.extrude({ origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } as never, [{ outer: [{ kind: 'circle', c: [0, 0], r: 15, source: 'c' }], holes: [] }] as never, [0, 0, 8]).shape;
    const text = splineStep(kernel, d);
    kernel.release(d);
    const truth = Math.PI * 225 * 8;
    // the premise: the usual figure of the spline body is past the tolerance, so the check could not pass on it
    const read = kernel.importStep(new TextEncoder().encode(text)).shape;
    expect(Math.abs(kernel.massProps(read).volume - truth) / truth).toBeGreaterThan(RECOGNIZE_TOLERANCE);
    kernel.release(read);
    const out = await recognizeText(kernel, solver, text);
    expect(out.report.features).toMatchObject({ revolve: 1, extrude: 0 });
    expect(out.report.volumeError).toBeLessThan(1e-7);
    expect(Math.abs(out.report.volume - truth) / truth).toBeLessThan(1e-7);
    expect(out.report.difference).toBeLessThan(1e-9);
  }, 120_000);
});

describe('surfaces moved off their cylinders in the file', () => {
  const disc = () => {
    const d = kernel.extrude({ origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } as never, [{ outer: [{ kind: 'circle', c: [0, 0], r: 15, source: 'c' }], holes: [] }] as never, [0, 0, 8]).shape;
    const text = splineStep(kernel, d);
    kernel.release(d);
    return text;
  };

  // the side of a disc of radius 15 moves about 10·δ
  for (const delta of [1e-6, 1e-5]) {
    it(`a sloppy file (surface ${(10 * delta).toExponential(0)} mm off its own edges): rebuilt within the file's own gaps, and the report says so`, async () => {
      const text = moved(disc(), delta, 'surfaces');
      // the premise: the file's faces miss each other by about that much, and by nothing before
      const read = kernel.importStep(new TextEncoder().encode(text)).shape;
      const gap = kernel.fileTolerance(read).max;
      kernel.release(read);
      expect(gap).toBeGreaterThan(5 * delta);
      expect(gap).toBeLessThan(20 * delta);
      const out = await recognizeText(kernel, solver, text);
      expect(out.report.features).toMatchObject({ revolve: 1 });
      expect(out.report.fileTolerance).toBeDefined();
      expect(out.report.fileTolerance!.max).toBeCloseTo(gap, 12);
      // past each face's own allowance nothing is left; the whole difference is of the order of the gap over the side's area
      expect(out.report.difference).toBeLessThan(RECOGNIZE_TOLERANCE);
      expect(out.report.fileTolerance!.difference).toBeGreaterThan(0);
      expect(out.report.fileTolerance!.difference).toBeLessThanOrEqual(out.report.fileTolerance!.volume);
    }, 120_000);

    it(`a consistent body ${(10 * delta).toExponential(0)} mm off a cylinder: never read as one`, async () => {
      const text = moved(disc(), delta, 'both');
      const read = kernel.importStep(new TextEncoder().encode(text)).shape;
      // the premise: its faces meet (no allowance), and its side is no cylinder to the tolerance
      expect(kernel.fileTolerance(read).max).toBeLessThan(1e-7);
      const side = kernel.topology(read).faces.findIndex((f) => Math.abs(f.center[2] - 4) < 1e-2);
      expect(kernel.analyticFace(read, side, 1e-6)).toBeNull();
      kernel.release(read);
      expect(await refusal(text)).toMatch(/自由曲面|不支援的曲線|重建結果與原件不同/);
    }, 120_000);
  }
});
