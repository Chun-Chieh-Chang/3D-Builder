/**
 * C4: a round on a drafted support, on a part whose other round is no simple surface. The part of `recognize-rolling-ball.kit.ts` (a spline-walled
 * boss on a plate, the wall's foot rounded with the exact rolling ball, so recognition leaves every round in the body and reads each off where it is)
 * with a tapered round boss on top of the spline boss, its foot rounded: a torus between a plane and a cone. The sharp edge of that round has no
 * closed form in `analyticSharpOf` (which knows two planes, and a plane with a cylinder about its normal), so before C4 the part was refused ("no edge
 * for the round"); now it is where the two supports' surfaces meet (`Kernel.sharpEdge`), as a free round's is. The truth is the body made here.
 */
import { expect, it } from 'vitest';
import { PlaneGcsSolver } from '@3db/sketch';
import { isTrap, Kernel, KernelError, type ShapeId } from '@3db/kernel';
import { RECOGNIZE_TOLERANCE, RecognizeError } from '@3db/regen';
import { recognizeStep, splineBoss } from './recognize-rolling-ball.kit';

const L = (a: number[], b: number[], s: string) => ({ kind: 'line', a, b, source: s });

export interface Tapered {
  /** Where the tapered boss stands on the spline boss's top. */
  at: [number, number];
  /** Its radius at the foot and at the top, and its height. */
  foot: number;
  top: number;
  height: number;
  /** The round at its foot, and the round at the spline wall's foot. */
  round: number;
  wallRound: number;
}

export const TAPERED: Tapered = { at: [12, 10], foot: 3, top: 2.2, height: 6, round: 0.8, wallRound: 1 };

/** The part. Throws `KernelError` when a round cannot be made on it. */
export function taperedOnSplineBoss(kernel: Kernel, p: Tapered): ShapeId {
  const made: ShapeId[] = [];
  try {
    const m = splineBoss(kernel);
    made.push(m.shape);
    const withRound = kernel.fillet(m.shape, m.edges, p.wallRound, undefined, undefined, true).shape;
    made.push(withRound);
    // the spline boss's top is at z = 10; the tapered boss starts 1 inside it
    const half = { outer: [L([0, -1], [p.foot, -1], 'a'), L([p.foot, -1], [p.foot, 0], 'b'), L([p.foot, 0], [p.top, p.height], 'c'), L([p.top, p.height], [0, p.height], 'd'), L([0, p.height], [0, -1], 'e')], holes: [] };
    const origin = [p.at[0], p.at[1], 10];
    const boss = kernel.revolve({ origin, xDir: [1, 0, 0], yDir: [0, 0, 1], normal: [0, -1, 0] } as never, [half] as never, { origin: origin as never, dir: [0, 0, 1] }, 2 * Math.PI).shape;
    made.push(boss);
    const fused = kernel.boolean('fuse', withRound, boss).shape;
    made.push(fused);
    const edges = kernel.topology(fused).edges.flatMap((e, i) => (e.geometry?.type === 'circle' && Math.abs(e.mid[2] - 10) < 1e-9 && Math.abs(e.geometry.radius - p.foot) < 1e-9 ? [i] : []));
    if (edges.length !== 1) throw new Error(`the tapered boss's foot: ${edges.length} edges`);
    return kernel.fillet(fused, edges, p.round).shape;
  } finally {
    for (const id of made) kernel.release(id);
  }
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random tapered boss well inside the spline boss's top (x 6–20, y 6–16 lies inside the default outline), narrowing or widening by up to 12°. */
export function sample(seed: number): Tapered {
  const r = rng(seed);
  const rd = (v: number) => Math.round(v * 1000) / 1000;
  const foot = rd(1.8 + 1.4 * r());
  const height = rd(3 + 5 * r());
  const lean = (r() * 2 - 1) * 12 * (Math.PI / 180);
  const top = rd(Math.max(0.6, foot - height * Math.tan(lean)));
  return { at: [rd(7 + 12 * r()), rd(7 + 8 * r())], foot, top, height, round: rd(0.2 + 0.5 * r()), wallRound: rd(0.4 + 0.8 * r()) };
}

/**
 * Seeds `from`–`to`, each its own case: rebuilt as the same solid with three extrusions and two rounds, or refused for a reason that is the part's
 * (a round OCCT cannot make on the rebuilt edge; a rebuild that is not the same solid, when the round on the cone is OCCT's and not a ball to the
 * tolerance). "No edge for the round" is what C4 took away and fails the case; so does a trap or a timeout. Printed by outcome with the heap.
 */
export function fuzzFile(from: number, to: number) {
  let kernel: Kernel;
  let solver: PlaneGcsSolver;
  let h0 = 0;
  const heap = () => (kernel.oc as unknown as { wasmMemory?: { buffer?: { byteLength?: number } } }).wasmMemory?.buffer?.byteLength ?? NaN;
  const stats = { cases: 0, notMade: 0, rebuilt: [] as number[], differs: [] as number[], filletOnRebuild: [] as number[], straight: 0 };
  it('loads with a heap to measure', async () => {
    kernel = await Kernel.load();
    solver = await PlaneGcsSolver.create();
    h0 = heap();
    expect(h0).toBeGreaterThan(0);
  });
  for (let seed = from; seed <= to; seed++) {
    it(`seed ${seed}`, async () => {
      const p = sample(seed);
      const what = JSON.stringify(p);
      stats.cases++;
      let shape: ShapeId;
      try {
        shape = taperedOnSplineBoss(kernel, p);
      } catch (e) {
        if (isTrap(e)) {
          kernel = await Kernel.load();
          stats.notMade++;
          return;
        }
        if (e instanceof KernelError) {
          stats.notMade++;
          return;
        }
        throw e;
      }
      if (Math.abs(p.top - p.foot) < 1e-9) stats.straight++;
      let r: Awaited<ReturnType<typeof recognizeStep>> | RecognizeError;
      try {
        r = await recognizeStep(kernel, solver, shape);
      } catch (e) {
        if (!(e instanceof RecognizeError)) throw e;
        r = e;
      } finally {
        kernel.release(shape);
      }
      if (r instanceof RecognizeError) {
        const kind = /^重建結果與原件不同/.test(r.message) ? 'differs' : /^重建的特徵無法成立：圓角/.test(r.message) ? 'filletOnRebuild' : null;
        if (!kind) throw new Error(`${what}: refused: ${r.message}`);
        stats[kind].push(seed);
        return;
      }
      expect(r.report.volumeError, what).toBeLessThan(RECOGNIZE_TOLERANCE);
      expect(r.report.difference, what).toBeLessThan(RECOGNIZE_TOLERANCE);
      expect(r.report.features, what).toMatchObject({ extrude: 3, fillet: 2 });
      const radii = r.doc.features.flatMap((f) => (f.type === 'fillet' ? [Number(f.radius)] : [])).sort((a, b) => a - b);
      const want = [p.round, p.wallRound].sort((a, b) => a - b);
      expect(Math.abs(radii[0]! - want[0]!), what).toBeLessThan(1e-6);
      expect(Math.abs(radii[1]! - want[1]!), what).toBeLessThan(1e-6);
      stats.rebuilt.push(seed);
    }, 120_000);
  }
  it('most were rebuilt', () => {
    console.log(`drafted-rounds fuzz ${from}-${to}: ${JSON.stringify(stats)}; heap ${(h0 / 2 ** 20).toFixed(1)} -> ${(heap() / 2 ** 20).toFixed(1)} MiB`);
    expect(stats.cases).toBe(to - from + 1);
    // the capability, not the refusals: at least 7 in 10 of the parts that could be made
    expect(stats.rebuilt.length).toBeGreaterThanOrEqual(Math.ceil(0.7 * (stats.cases - stats.notMade)));
    expect(stats.rebuilt.length).toBeGreaterThan(0);
  });
}
