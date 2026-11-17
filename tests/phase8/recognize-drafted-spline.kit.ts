/**
 * ADR 0255: recognition of a drafted extrusion whose outline has a spline, read back through a real STEP file. The part is a boss drafted by the kernel
 * (ADR 0251) — three lines and a spline over the top, a draft of either sign, sometimes a hole and sometimes a plate under it — with, in the rounds
 * set, a round where the spline wall meets the plate and sometimes another along its top edge (the kernel's exact rolling ball, whose supports are then the
 * spline wall). The truth is the body made here.
 */
import { expect, it } from 'vitest';
import { PlaneGcsSolver } from '@3db/sketch';
import { isTrap, Kernel, KernelError, type ShapeId } from '@3db/kernel';
import { RECOGNIZE_TOLERANCE, RecognizeError } from '@3db/regen';
import { recognizeStep, XY } from './recognize-rolling-ball.kit';

const L = (a: number[], b: number[], s: string) => ({ kind: 'line', a, b, source: s });

export interface DraftedSpline {
  /** The spline over the boss's top, from its right end to its left; the boss's foot runs from x 0 to the first point's x at y 0. */
  top: number[][];
  h: number;
  /** Degrees; + narrows upward. */
  draft: number;
  /** A round hole through the boss, drafted with it. */
  hole?: { c: [number, number]; r: number };
  plate: boolean;
  /** Rounds: where the spline wall meets the plate, and along its top edge. */
  foot?: number;
  top_?: number;
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

/** A random part. `rounds`: the rounds set (a plate always, a round at the foot always, one along the top in half the cases). */
export function sample(seed: number, rounds: boolean): DraftedSpline {
  const r = rng(seed * 7919 + (rounds ? 1 : 0));
  const rd = (v: number) => Math.round(v * 1000) / 1000;
  const w = rd(18 + 14 * r());
  const base = rd(14 + 10 * r());
  const n = 3 + Math.floor(r() * 3);
  const top = Array.from({ length: n }, (_, i) => [rd(w * (1 - i / (n - 1))), rd(i === 0 || i === n - 1 ? base : base + (r() * 2 - 0.6) * 6)]);
  const h = rd(4 + 10 * r());
  const draft = rd((r() < 0.5 ? -1 : 1) * (0.5 + 7.5 * r()));
  const hole = r() < 0.3 ? { c: [rd(w / 2), rd(base / 3)] as [number, number], r: rd(1.5 + 1.5 * r()) } : undefined;
  if (!rounds) return { top, h, draft, ...(hole ? { hole } : {}), plate: r() < 0.5 };
  return { top, h, draft, ...(hole ? { hole } : {}), plate: true, foot: rd(0.3 + 1.2 * r()), ...(r() < 0.5 ? { top_: rd(0.2 + 0.6 * r()) } : {}) };
}

/**
 * The part. Throws `KernelError` when the kernel refuses it (a draft that closes the hole, a round it cannot make). `exact`, when given, is told
 * whether every round came out as the kernel's exact rolling ball (else OCCT's was kept, which is not a ball to 1e-6: C2, 2e-5 to 1e-3).
 */
export function draftedSpline(kernel: Kernel, p: DraftedSpline, exact?: { all: boolean }): ShapeId {
  const made: ShapeId[] = [];
  try {
    const outer = [L([0, 0], [p.top[0]![0]!, 0], 'a'), L([p.top[0]![0]!, 0], p.top[0]!, 'b'), { kind: 'spline', points: p.top, source: 'c' }, L(p.top[p.top.length - 1]!, [0, 0], 'd')];
    const holes = p.hole ? [[{ kind: 'circle', c: p.hole.c, r: p.hole.r, source: 'h' }]] : [];
    let shape = kernel.extrude(XY as never, [{ outer, holes }] as never, [0, 0, p.h], 0, undefined, (p.draft * Math.PI) / 180).shape;
    if (p.plate) {
      made.push(shape);
      const plate = kernel.extrude({ ...XY, origin: [-10, -10, -5] } as never, [{ outer: [[0, 0], [60, 0], [60, 62], [0, 62]].map((a, i, q) => L(a, q[(i + 1) % 4]!, 'q' + i)), holes: [] }] as never, [0, 0, 5]).shape;
      made.push(plate);
      shape = kernel.boolean('fuse', plate, shape).shape;
    }
    const round = (z: number, radius: number) => {
      const t = kernel.topology(shape);
      const wall = t.faces.findIndex((f, i) => !f.geometry && t.edges.some((e) => e.faces.includes(i) && Math.abs(e.mid[2] - z) < 1e-6));
      const edges = t.edges.flatMap((e, i) => (e.faces.includes(wall) && Math.abs(e.mid[2] - z) < 1e-6 ? [i] : []));
      // the wall's edge at that height may come in more than one piece; the round goes along all of them
      if (wall < 0 || edges.length === 0) throw new Error(`the spline wall's edge at z ${z}: ${edges.length}`);
      made.push(shape);
      shape = kernel.fillet(shape, edges, radius, undefined, undefined, true).shape;
      const log = (kernel as unknown as { exactRoundLog?: { outcome: string }[] }).exactRoundLog ?? [];
      if (exact && !(log.length > 0 && log.every((x) => x.outcome === 'exact'))) exact.all = false;
    };
    if (p.foot !== undefined) round(0, p.foot);
    if (p.top_ !== undefined) round(p.h, p.top_);
    return shape;
  } finally {
    for (const id of made) kernel.release(id);
  }
}

const heap = (kernel: Kernel) => (kernel.oc as unknown as { wasmMemory?: { buffer?: { byteLength?: number } } }).wasmMemory?.buffer?.byteLength ?? NaN;

/**
 * Seeds `from`–`to`, each its own case: rebuilt as the same solid (to the recognition tolerance; the extrusion's draft to 1e-9° and each round's radius to
 * 1e-6 of what was made) or refused for a reason, which is printed. Not made (the kernel refused the part) is counted apart. At most 5% of the parts made
 * may be refused in each file, which bounds every set of files the same way. A trap fails the case (ADR 0242). The heap is printed, not claimed flat.
 */
export function fuzzFile(from: number, to: number, rounds: boolean) {
  let kernel: Kernel;
  let solver: PlaneGcsSolver;
  let h0 = 0;
  const stats = { cases: 0, notMade: 0, notMadeWhy: {} as Record<string, number>, rebuilt: [] as number[], refused: [] as string[], occtRounds: [] as number[] };
  const why = (e: unknown) => {
    const m = isTrap(e) ? 'trap' : (e as Error).message.slice(0, 24);
    stats.notMadeWhy[m] = (stats.notMadeWhy[m] ?? 0) + 1;
  };
  it('loads with a heap to measure', async () => {
    kernel = await Kernel.load();
    solver = await PlaneGcsSolver.create();
    h0 = heap(kernel);
    expect(h0).toBeGreaterThan(0);
  });
  for (let seed = from; seed <= to; seed++) {
    it(`seed ${seed}`, async () => {
      const p = sample(seed, rounds);
      const what = JSON.stringify(p);
      stats.cases++;
      let shape: ShapeId;
      const exact = { all: true };
      try {
        shape = draftedSpline(kernel, p, exact);
      } catch (e) {
        if (isTrap(e)) {
          kernel = await Kernel.load();
          stats.notMade++;
          why(e);
          return;
        }
        if (e instanceof KernelError) {
          stats.notMade++;
          why(e);
          return;
        }
        throw e;
      }
      let r: Awaited<ReturnType<typeof recognizeStep>> | RecognizeError;
      try {
        r = await recognizeStep(kernel, solver, shape);
      } catch (e) {
        if (!(e instanceof RecognizeError)) throw e;
        r = e;
      }
      try {
        if (r instanceof RecognizeError) {
          stats.refused.push(`${seed}: ${r.message.slice(0, 160)}`);
          return;
        }
        expect(r.report.volumeError, what).toBeLessThan(RECOGNIZE_TOLERANCE);
        expect(r.report.difference, what).toBeLessThan(RECOGNIZE_TOLERANCE);
        // the report is of this body: its volume against the body made here, integrated finely. To the recognition tolerance, not tighter: both bodies'
        // spline walls are within ~1e-8 of the exact draft (ADR 0255), so their volumes differ by up to that times the walls' area (measured: 1e-9 to
        // 2e-8 relative), a difference of the walls, not of the report
        expect(Math.abs(r.report.volume - kernel.massProps(shape, { eps: 1e-10 }).volume) / r.report.volume, what).toBeLessThan(RECOGNIZE_TOLERANCE);
        // the spline boss is one drafted extrusion, its draft the one it was made with
        const drafts = r.doc.features.flatMap((f) => (f.type === 'extrude' && f.draft1 ? [parseFloat(String(f.draft1.angle))] : []));
        expect(drafts.length, what).toBe(1);
        expect(Math.abs(drafts[0]! - Math.abs(p.draft)), what).toBeLessThan(1e-9);
        const radii = r.doc.features.flatMap((f) => (f.type === 'fillet' ? [Number(f.radius)] : [])).sort((a, b) => a - b);
        const want = [p.foot, p.top_].filter((x): x is number => x !== undefined).sort((a, b) => a - b);
        expect(radii.length, what).toBe(want.length);
        // each radius as made: to 1e-6 when the kernel's rounds were exact balls (as the rolling-ball fuzz has it); else OCCT's round was kept, which is
        // a ball only to 2e-5 to 1e-3 of its radius (C2), so to 1e-3 of it. On these walls the exact round has not been seen to take (ADR 0255)
        radii.forEach((x, i) => expect(Math.abs(x - want[i]!), what).toBeLessThan(exact.all ? 1e-6 : 1e-3 * want[i]!));
        if (!exact.all) stats.occtRounds.push(seed);
        stats.rebuilt.push(seed);
      } finally {
        kernel.release(shape);
      }
    }, 300_000);
  }
  it('outcomes and heap', () => {
    const h1 = heap(kernel);
    expect(h1).toBeGreaterThan(0);
    console.log(`DRAFTED-SPLINE-FUZZ ${rounds ? 'rounds' : 'walls'} ${from}-${to} ${JSON.stringify({ ...stats, heapMiB: [+(h0 / 2 ** 20).toFixed(1), +(h1 / 2 ** 20).toFixed(1)] })}`);
    expect(stats.cases).toBe(to - from + 1);
    const made = stats.cases - stats.notMade;
    expect(made, 'every part was refused by the kernel: the file proves nothing').toBeGreaterThan(0);
    expect(stats.refused.length, stats.refused.join(' | ')).toBeLessThanOrEqual(Math.floor(0.05 * made));
  });
}
