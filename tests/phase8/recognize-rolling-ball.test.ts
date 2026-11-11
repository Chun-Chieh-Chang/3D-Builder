/**
 * C2.8–C2.10: a round that is no simple surface (a B-spline in the file) read back as a rolling ball, without taking it off. The part: a boss whose
 * outline has a spline, on a plate, the spline wall's foot rounded with the exact rolling ball. `deleteFaces` cannot take that round off (the wall
 * cannot be stretched back down to the plate), which is why the sharp edge comes from the supports' surfaces met (C2.8), is kept as points (C2.9) and
 * is found on the rebuilt body by those points lying on it (C2.10). Each claim has its control: OCCT's own round of the same edge is no rolling ball
 * to ROLLING_BALL_TOLERANCE (nominated within 1e-3 of its radius, it is the comparison that accepts its exact rebuild), a corner near a ball that is
 * no round is still rebuilt without one (ADR 0249), and a point past an edge or off it is not on it.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, KernelError, type ShapeId } from '@3db/kernel';
import { ROLLING_BALL_TOLERANCE } from '@3db/regen';
import { recognizeStep, splineBoss } from './recognize-rolling-ball.kit';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

/** The round of `shape` (the face made from the edge) and the two faces it is tangent to. */
function roundOf(made: { shape: ShapeId; faceOrigins: { rel: string; kind?: string }[][] }) {
  const t = kernel.topology(made.shape);
  const smooth = kernel.smoothEdges(made.shape, t.edges.map((_, i) => i));
  const round = t.faces.findIndex((_, i) => (made.faceOrigins[i] ?? []).some((o) => o.rel === 'generated' && o.kind === 'edge'));
  const supports = [...new Set(t.edges.flatMap((e, k) => (smooth[k] && e.faces.includes(round) ? e.faces.filter((q) => q !== round) : [])))];
  expect(supports.length).toBe(2);
  return { round, supports: supports as [number, number], surface: t.faces[round]!.surface };
}

describe('a round that is no simple surface, read as a rolling ball (C2)', () => {
  it('the exact round of a spline wall on a plate: its radius, on an inside edge, on the ball to 1e-7; OCCT\'s own round of that edge is not one', () => {
    for (const r of [0.5, 1.2]) {
      const plain = splineBoss(kernel);
      const exact = kernel.fillet(plain.shape, plain.edges, r, undefined, undefined, true);
      expect((kernel as unknown as { exactRoundLog: { outcome: string }[] }).exactRoundLog.map((x) => x.outcome)).toEqual(['exact']);
      const e = roundOf(exact);
      expect(e.surface).toBe('bsplinesurface');
      const ball = kernel.rollingBall(exact.shape, e.round, e.supports, ROLLING_BALL_TOLERANCE)!;
      expect(ball).not.toBeNull();
      expect(Math.abs(ball.radius - r)).toBeLessThan(1e-9);
      expect(ball.convex).toBe(false);
      // the exact round's surface is itself a B-spline fitted to the ball's sweep: measured 4e-13 to 1.5e-8 on these, OCCT's 1.3e-5 and up
      expect(ball.deviation).toBeLessThan(1e-7);
      // the control: OCCT's round of the same edge is off the ball by more than the tolerance (measured 1.3e-5 and 2.3e-5), so it is not read as one
      const occt = kernel.fillet(plain.shape, plain.edges, r, undefined, undefined, false);
      const o = roundOf(occt);
      expect(kernel.rollingBall(occt.shape, o.round, o.supports, ROLLING_BALL_TOLERANCE)).toBeNull();
      expect(kernel.rollingBall(occt.shape, o.round, o.supports, 1)!.deviation).toBeGreaterThan(ROLLING_BALL_TOLERANCE);
    }
  });

  // the points are put on both supports exactly (OCCT's intersection curve alone was up to 6.9e-6 off the wall: fuzz seeds 51, 99, 45); measured
  // ≤ 2.7e-13 from the plain body's faces at that edge
  it('C2.8: the sharp edge, the supports\' surfaces met, lies on the edge of the body before the round to 1e-11, every point inside it', () => {
    const plain = splineBoss(kernel);
    const exact = kernel.fillet(plain.shape, plain.edges, 0.8, undefined, undefined, true);
    const e = roundOf(exact);
    const sharp = kernel.sharpEdge(exact.shape, e.round, e.supports)!;
    expect(sharp.closed).toBe(false);
    expect(sharp.points.length).toBe(33);
    const ds = kernel.distancesToEdge(plain.shape, plain.edges[0]!, sharp.points);
    expect(ds.every((d) => d !== null && d <= 1e-11)).toBe(true);
    // the points run along the edge, not bunched at one place: from end to end they span most of it
    const span = Math.hypot(...sharp.points[0]!.map((x, k) => x - sharp.points[32]![k]!));
    expect(span).toBeGreaterThan(20);
  });

  it('C2.10: a point past an edge\'s end has no foot inside it; one off the edge by 0.01 is 0.01 from it', () => {
    const plain = splineBoss(kernel);
    const exact = kernel.fillet(plain.shape, plain.edges, 0.8, undefined, undefined, true);
    const e = roundOf(exact);
    const p = kernel.sharpEdge(exact.shape, e.round, e.supports)!.points;
    const first = p[0]!, next = p[1]!;
    const back = first.map((x, k) => x - 40 * (next[k]! - x)) as [number, number, number];
    const up: [number, number, number] = [p[16]![0], p[16]![1], p[16]![2] + 0.01];
    const [past, off] = kernel.distancesToEdge(plain.shape, plain.edges[0]!, [back, up]);
    expect(past).toBeNull();
    expect(Math.abs(off! - 0.01)).toBeLessThan(1e-9);
    expect(() => kernel.distancesToEdge(plain.shape, 10_000, [up])).toThrow(KernelError);
  });
});

describe('recognized through a STEP file', () => {
  for (const r of [0.5, 1.2]) {
    it(`radius ${r}: the outline\'s sketch and extrusions, then one exact round of that radius on the edge found again; the same solid`, async () => {
      const plain = splineBoss(kernel);
      const exact = kernel.fillet(plain.shape, plain.edges, r, undefined, undefined, true);
      const out = await recognizeStep(kernel, solver, exact.shape);
      expect(out.report.features).toMatchObject({ extrude: 2, fillet: 1, hole: 0, chamfer: 0 });
      const fillet = out.doc.features.find((f) => f.type === 'fillet');
      expect(fillet?.type === 'fillet' && fillet.exact).toBe(true);
      expect(fillet?.type === 'fillet' && fillet.edges.length).toBe(1);
      expect(Math.abs(Number(fillet?.type === 'fillet' && fillet.radius) - r)).toBeLessThan(1e-9);
      expect(out.report.volumeError).toBeLessThan(1e-9);
      // the outline is the exact spline (C1), not arcs
      expect(out.doc.features.some((f) => f.type === 'sketch' && f.entities.some((x) => x.type === 'spline' && x.nurbs))).toBe(true);
    }, 120_000);
  }

  // Until ADR 0249 this was refused: off the ball by more than ROLLING_BALL_TOLERANCE, it was not nominated. Nominated now (within 1e-3 of its radius),
  // it is rebuilt as an exact round, and that is the same solid to 2e-9 to 6e-9 of the volume before any allowance is taken off: the comparison, not the
  // nomination, is what says so (the raw difference is asserted, so OCCT's 5.5e-6 joint gaps there are not what lets it through).
  it('OCCT\'s own round of that edge, no rolling ball but within 1e-3 of its radius: rebuilt as an exact round, the same solid before any allowance', async () => {
    const plain = splineBoss(kernel);
    const occt = kernel.fillet(plain.shape, plain.edges, 0.8, undefined, undefined, false);
    const out = await recognizeStep(kernel, solver, occt.shape);
    expect(out.report.features).toMatchObject({ extrude: 2, fillet: 1 });
    const fillet = out.doc.features.find((f) => f.type === 'fillet');
    expect(fillet?.type === 'fillet' && fillet.exact).toBe(true);
    expect(out.report.fileTolerance).toBeDefined();
    expect(out.report.fileTolerance!.difference).toBeLessThan(1e-7);
    expect(out.report.volumeError).toBeLessThan(1e-7);
  }, 120_000);

  // A nomination is only a proposal (ADR 0249). An exact elliptical quarter (a rational quadratic) at the corner of a box, semi-axes 2 and 2 + e, is
  // tangent to both walls and within 1e-3 of a ball of its radius, so it is nominated; but it is no round, and the exact round of that corner does
  // not rebuild it. Before the retry the part was refused ('no edge for the round'), though without the nomination it is an extrusion of its exact
  // outline (C1). e = 0, a true round drawn as a spline, was refused even before ADR 0249: a round at the corner of an extrusion is in its outline.
  for (const e of [0, 2e-4, 1e-3]) {
    it(`an elliptical corner (semi-axes 2 and ${2 + e}) near a ball: nominated, refused as a round, then rebuilt as one extrusion of its exact outline`, async () => {
      const [a, b, w] = [2, 2 + e, Math.SQRT1_2];
      const outer = [
        { kind: 'line', a: [0, 0], b: [40, 0], source: 'l0' },
        { kind: 'line', a: [40, 0], b: [40, 30 - b], source: 'l1' },
        { kind: 'spline', points: [[40, 30 - b], [40 - a, 30]], closed: false, source: 'e', nurbs: { poles: [[40, 30 - b], [40, 30], [40 - a, 30]], degree: 2, knots: [0, 1], mults: [3, 3], weights: [1, w, 1] } },
        { kind: 'line', a: [40 - a, 30], b: [0, 30], source: 'l2' },
        { kind: 'line', a: [0, 30], b: [0, 0], source: 'l3' },
      ];
      const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
      const box = kernel.extrude(XY as never, [{ outer, holes: [] }] as never, [0, 0, 10]).shape;
      const t = kernel.topology(box);
      const corner = t.faces.findIndex((f) => !f.geometry);
      // the premise: the corner is nominated (near a ball, within the relative term)
      const ball = kernel.rollingBall(box, corner, t.faces.flatMap((f, i) => (f.geometry?.type === 'plane' && Math.abs(f.geometry.normal[2]) < 0.5 && (Math.abs(f.center[0] - 40) < 1e-9 || Math.abs(f.center[1] - 30) < 1e-9) ? [i] : [])) as [number, number], Infinity);
      expect(ball).not.toBeNull();
      expect(ball!.deviation).toBeLessThanOrEqual(1e-3 * ball!.radius);
      const out = await recognizeStep(kernel, solver, box);
      expect(out.report.features).toMatchObject({ extrude: 1, fillet: 0 });
      expect(out.report.difference).toBeLessThan(1e-12);
    }, 120_000);
  }

  it('the same boss without the round is rebuilt as before, with no round', async () => {
    const out = await recognizeStep(kernel, solver, splineBoss(kernel).shape);
    expect(out.report.features).toMatchObject({ extrude: 2, fillet: 0 });
    expect(out.report.volumeError).toBeLessThan(1e-9);
  }, 120_000);
});
