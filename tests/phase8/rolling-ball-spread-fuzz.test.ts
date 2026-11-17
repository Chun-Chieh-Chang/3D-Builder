/**
 * ARC_SPREAD 1e-3 → 1e-2 (roundRecognition.ts; design doc freeform-generalization §6o-B). part-3's r 0.127 edge breaks have section radii spread 1.62e-3 and 5.39e-3 and are
 * rolling balls to within 2τ, so the first gate (the sections' radii within ARC_SPREAD) refused real rounds. What stops a corner that is NOT a round in the widened band is the
 * deviation gate and, after it, the comparison of the rebuilt body (ADR 0249): fuzzed here on 150 exact elliptical corners (a rational quadratic, tangent to both walls) of
 * semi-axes a and a + e, e log-uniform over 1e-5…0.3 of a, a in 1…5.
 *   - every corner, through a STEP file, is recognized (never refused, never wrong): the raw difference of the rebuilt solid is < 1e-9;
 *   - in the band the old gate refused (measured section spread in (1e-3, 1e-2]) `rollingBall` now answers (a ball with its deviation), above 2e-2 it still answers null;
 *   - what the product nominates (deviation within the nomination gate) is only ever a corner whose own deviation is within it: nothing off the ball by more is.
 * Mutation (recorded in DEV_LOG): ARC_SPREAD back to 1e-3 makes the band assertion fail; ARC_SPREAD at 1 makes the "above 2e-2" assertion fail.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { ROLLING_BALL_TOLERANCE } from '@3db/regen';
import { NOMINATE_BALL_RELATIVE } from '../../packages/regen/src/recognize/analyze';
import { recognizeStep } from './recognize-rolling-ball.kit';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
const circum = (a: V3, b: V3, c: V3) => { const area = len(cross(sub(b, a), sub(c, a))) / 2; return area > 1e-14 ? (len(sub(a, b)) * len(sub(b, c)) * len(sub(c, a))) / (4 * area) : Infinity; };

/** The relative spread of the corner's section radii as `arcSections` reads them (four points at nine places, both directions tried; the smaller spread). */
function spreadOf(face: unknown): number {
  const oc = (kernel as unknown as { oc: any }).oc;
  const ad = new oc.BRepAdaptor_Surface(face, true);
  const [u0, u1, v0, v1] = [ad.FirstUParameter(), ad.LastUParameter(), ad.FirstVParameter(), ad.LastVParameter()];
  const P = (u: number, v: number): V3 => { const p = ad.Value(u, v); const o: V3 = [p.X(), p.Y(), p.Z()]; p.delete(); return o; };
  let best = Infinity;
  for (const across of ['v', 'u'] as const) {
    const rs: number[] = [];
    for (let s = 0; s <= 8; s++) {
      const t = s / 8;
      const q = [0, 0.37, 0.71, 1].map((w) => (across === 'v' ? P(u0 + (u1 - u0) * t, v0 + (v1 - v0) * w) : P(u0 + (u1 - u0) * w, v0 + (v1 - v0) * t)));
      rs.push(circum(q[0]!, q[1]!, q[2]!), circum(q[1]!, q[2]!, q[3]!));
    }
    const m = rs.reduce((x, y) => x + y, 0) / rs.length;
    if (Number.isFinite(m)) best = Math.min(best, (Math.max(...rs) - Math.min(...rs)) / m);
  }
  ad.delete();
  return best;
}

function mulberry(seed: number) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

describe('the widened section-spread gate (ARC_SPREAD 1e-2), fuzzed on elliptical corners', () => {
  it('150 corners: all recognized exactly; the old-refused band is answered, far above it is not; nothing off the ball is nominated', async () => {
    const rnd = mulberry(20261117);
    let band = 0;
    let far = 0;
    let nominated = 0;
    for (let n = 0; n < 150; n++) {
      const a = 1 + 4 * rnd();
      const e = a * Math.exp(Math.log(1e-5) + (Math.log(0.3) - Math.log(1e-5)) * rnd());
      const b = a + e;
      const w = Math.SQRT1_2;
      const outer = [
        { kind: 'line', a: [0, 0], b: [40, 0], source: 'l0' },
        { kind: 'line', a: [40, 0], b: [40, 30 - b], source: 'l1' },
        { kind: 'spline', points: [[40, 30 - b], [40 - a, 30]], closed: false, source: 'e', nurbs: { poles: [[40, 30 - b], [40, 30], [40 - a, 30]], degree: 2, knots: [0, 1], mults: [3, 3], weights: [1, w, 1] } },
        { kind: 'line', a: [40 - a, 30], b: [0, 30], source: 'l2' },
        { kind: 'line', a: [0, 30], b: [0, 0], source: 'l3' },
      ];
      const box = kernel.extrude(XY as never, [{ outer, holes: [] }] as never, [0, 0, 10]).shape;
      try {
        const t = kernel.topology(box);
        const corner = t.faces.findIndex((f) => !f.geometry);
        expect(corner).toBeGreaterThanOrEqual(0);
        const walls = t.faces.flatMap((f, i) => (f.geometry?.type === 'plane' && Math.abs(f.geometry.normal[2]) < 0.5 && (Math.abs(f.center[0] - 40) < 1e-9 || Math.abs(f.center[1] - 30) < 1e-9) ? [i] : [])) as [number, number];
        expect(walls.length).toBe(2);
        // the spread through the product's own face (the topology's face handle is not exposed: the kernel's shape is re-read)
        const oc = (kernel as unknown as { oc: any }).oc;
        const faces: unknown[] = [];
        for (const ex = new oc.TopExp_Explorer((kernel as unknown as { get(s: unknown): unknown }).get(box), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) faces.push(oc.TopoDS.Face(ex.Current()));
        const spread = spreadOf(faces[corner]);
        const ball = kernel.rollingBall(box, corner, walls, Infinity);
        if (spread > 1e-3 && spread <= 1e-2) { band++; expect(ball, `a ${a} e ${e} spread ${spread}`).not.toBeNull(); }
        if (spread > 2e-2) { far++; expect(ball, `a ${a} e ${e} spread ${spread}`).toBeNull(); }
        if (ball && ball.deviation <= Math.max(ROLLING_BALL_TOLERANCE, NOMINATE_BALL_RELATIVE * ball.radius)) {
          nominated++;
          // a nominated corner is within the gate by its own measured deviation, and by an independent bound: an ellipse of semi-axes a, a + e is off the ball of radius ~a by at most ~e
          expect(ball.deviation).toBeLessThanOrEqual(e * 1.5 + 1e-9);
        } else if (ball) {
          expect(ball.deviation).toBeGreaterThan(Math.max(ROLLING_BALL_TOLERANCE, NOMINATE_BALL_RELATIVE * ball.radius));
        }
        const out = await recognizeStep(kernel, solver, box);
        expect(out.report.difference, `a ${a} e ${e}`).toBeLessThan(1e-9);
      } finally {
        kernel.release(box);
      }
    }
    // the branches really ran (a fuzz that never reaches the widened band proves nothing)
    expect(band).toBeGreaterThanOrEqual(10);
    expect(far).toBeGreaterThanOrEqual(10);
    expect(nominated).toBeGreaterThanOrEqual(10);
  }, 900_000);
});
