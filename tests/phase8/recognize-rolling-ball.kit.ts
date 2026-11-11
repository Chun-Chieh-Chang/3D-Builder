/**
 * C2.8–C2.10: parts whose round is no simple surface, read back as a rolling ball through a real STEP file. A plate with a boss on it, the boss's
 * outline three lines and a spline (an exact extrusion, read exactly by C1); the edge where the spline wall meets the plate is rounded with the exact
 * rolling ball (`Kernel.fillet(…, exact)`), which comes out as a B-spline surface between a plane and a surface of extrusion, and `deleteFaces` cannot
 * take it off (the wall cannot be stretched back down to the plate).
 */
import { expect, it } from 'vitest';
import { applyCommand, createEmptyPart, type PartDoc } from '@3db/model';
import { sha256Hex } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { isTrap, Kernel, KernelError, type ShapeId } from '@3db/kernel';
import { reconstructImported, RECOGNIZE_TOLERANCE, RecognizeError, Regenerator } from '@3db/regen';

export const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } as const;
const L = (a: number[], b: number[], s: string) => ({ kind: 'line', a, b, source: s });
export const GENTLE = [[28.72, 25], [14, 32], [0, 25]];

/** The boss on the plate (its outline three lines and a spline through `top`), and the edge where the spline wall meets the plate's top. */
export function splineBoss(kernel: Kernel, top: number[][] = GENTLE, h = 10): { shape: ShapeId; edges: number[] } {
  const plate = kernel.extrude({ ...XY, origin: [-10, -10, -5] } as never, [{ outer: [[0, 0], [50, 0], [50, 52], [0, 52]].map((a, i, p) => L(a, p[(i + 1) % 4]!, 'q' + i)), holes: [] }] as never, [0, 0, 5]).shape;
  const reg = { outer: [L([0, 0], [top[0]![0]!, 0], 'a'), L([top[0]![0]!, 0], top[0]!, 'b'), { kind: 'spline', points: top, source: 'c' }, L(top[top.length - 1]!, [0, 0], 'd')], holes: [] };
  const shape = kernel.boolean('fuse', plate, kernel.extrude({ ...XY, origin: [0, 0, -1] } as never, [reg] as never, [0, 0, h + 1]).shape).shape;
  const t = kernel.topology(shape);
  const wall = t.faces.findIndex((f) => !f.geometry);
  const cap = t.faces.findIndex((f, i) => f.geometry?.type === 'plane' && Math.abs(f.center[2]) < 1e-6 && t.edges.some((e) => e.faces.includes(wall) && e.faces.includes(i)));
  return { shape, edges: t.edges.flatMap((e, i) => (e.faces.includes(wall) && e.faces.includes(cap) ? [i] : [])) };
}

/** Recognition of a shape through a STEP file it is written to, as the app does it. */
export async function recognizeStep(kernel: Kernel, solver: PlaneGcsSolver, s: ShapeId) {
  const bytes = new TextEncoder().encode(kernel.exportStep(s, 'p'));
  const sha = await sha256Hex(bytes);
  const doc: PartDoc = applyCommand(createEmptyPart(), { type: 'importBody', blob: { id: 'blob1', sha256: sha, kind: 'step', fileName: 'f.step' }, feature: { id: 'imp1', type: 'importedBody', name: 'i', suppressed: false, blob: 'blob1' }, index: 0 });
  const regen = new Regenerator(kernel, solver, new Map([[sha, bytes]]));
  try {
    return reconstructImported(kernel, regen, doc, 'imp1', solver);
  } finally {
    regen.dispose();
  }
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** A random boss: width, three to five spline points rising and falling over the top, height, and the round's radius. */
export function sample(seed: number) {
  const r = rng(seed); const rd = (v: number) => Math.round(v * 1000) / 1000;
  const w = rd(18 + 14 * r()), base = rd(14 + 10 * r()), n = 3 + Math.floor(r() * 3);
  const top = Array.from({ length: n }, (_, i) => [rd(w * (1 - i / (n - 1))), rd(i === 0 || i === n - 1 ? base : base + (r() * 2 - 0.6) * 6)]);
  return { top, h: rd(4 + 10 * r()), radius: rd(0.2 + 1.6 * r()) };
}

/**
 * Seeds `from`–`to`, each its own case. Every case is either rebuilt as the same solid (to the recognition tolerance; the kernel's own exact round to
 * 1e-9 and its radius) or refused whole for an allowed reason; a trap, a timeout or an edge not found again fails it. The outcomes are printed by
 * kind (the kernel's exact round or OCCT's) and reason. The heap is read only through
 * `wasmMemory.buffer.byteLength` and printed, not claimed to be flat (AGENTS §3.5).
 */
export function fuzzFile(from: number, to: number) {
  let kernel: Kernel; let solver: PlaneGcsSolver; let h0 = 0;
  const outcomes = () => ({ cases: 0, rebuilt: [] as number[], freeform: [] as number[], differs: [] as number[], filletOnRebuild: [] as number[] });
  const stats = { cases: 0, notMade: 0, exact: outcomes(), occt: outcomes(), worst: 0 };
  it('loads with a heap to measure', async () => {
    kernel = await Kernel.load(); solver = await PlaneGcsSolver.create();
    h0 = (kernel.oc as unknown as { wasmMemory?: { buffer?: { byteLength?: number } } }).wasmMemory?.buffer?.byteLength ?? NaN;
    expect(h0).toBeGreaterThan(0);
  });
  for (let seed = from; seed <= to; seed++) {
    it(`seed ${seed}`, async () => {
      const s = sample(seed); stats.cases++;
      const what = JSON.stringify(s);
      let shape: ShapeId;
      try {
        const m = splineBoss(kernel, s.top, s.h);
        expect(m.edges.length, what).toBe(1);
        shape = kernel.fillet(m.shape, m.edges, s.radius, undefined, undefined, true).shape;
      } catch (e) {
        if (isTrap(e)) { kernel = await Kernel.load(); stats.notMade++; return; }
        if (e instanceof KernelError) { stats.notMade++; return; }
        throw e;
      }
      const exact = ((kernel as unknown as { exactRoundLog: { outcome: string }[] }).exactRoundLog ?? []).every((x) => x.outcome === 'exact');
      if (exact) stats.exact.cases++; else stats.occt.cases++;
      // a trap is no outcome: it fails the case (ADR 0242)
      let r: Awaited<ReturnType<typeof recognizeStep>> | RecognizeError;
      try { r = await recognizeStep(kernel, solver, shape); } catch (e) { if (e instanceof RecognizeError) r = e; else throw e; }
      if (r instanceof RecognizeError) {
        // Honest, whole refusals. Neither "the kernel's round is exact" nor "it is OCCT's" says whether the file's round is a rolling ball to
        // recognition's tolerance (measured: exact 4e-13 to 1.85e-6 off the ball when the build ran out of sections, OCCT's 9e-7 to 5.1e-5), so only the
        // comparison after the rebuild decides. Allowed: a freeform face; a rebuild not the same solid; OCCT's fillet failing on the rebuilt edge (a known
        // gap: seed 52's rebuilt edge is on its faces to 3.6e-15 and OCCT's own round of it fails too). Not allowed: an edge not found again (what C2.10
        // claims), or anything else.
        const kind = /自由曲面|freeform/.test(r.message) ? 'freeform' : /^重建結果與原件不同/.test(r.message) ? 'differs' : /^重建的特徵無法成立：圓角/.test(r.message) ? 'filletOnRebuild' : null;
        if (!kind) throw new Error(`${what}: refused: ${r.message}`);
        (exact ? stats.exact : stats.occt)[kind].push(seed);
        return;
      }
      // rebuilt: never anything but the same solid (the report is the comparison's; the volume is checked again here from the shape made above)
      expect(r.report.volumeError, what).toBeLessThan(RECOGNIZE_TOLERANCE);
      expect(r.report.difference, what).toBeLessThan(RECOGNIZE_TOLERANCE);
      expect(Math.abs(r.report.volume - kernel.massProps(shape).volume) / r.report.volume, what).toBeLessThan(1e-12);
      const fillets = r.doc.features.filter((f) => f.type === 'fillet');
      expect(fillets.length, what).toBe(1);
      expect(fillets[0]!.type === 'fillet' && fillets[0]!.exact, what).toBe(true);
      if (exact) {
        // the kernel's own round, read back: its radius and the solid to 1e-9
        expect(r.report.volumeError, what).toBeLessThan(1e-9);
        expect(Math.abs(Number(fillets[0]!.type === 'fillet' && fillets[0]!.radius) - s.radius), what).toBeLessThan(1e-6);
      }
      (exact ? stats.exact : stats.occt).rebuilt.push(seed);
      stats.worst = Math.max(stats.worst, r.report.volumeError);
    }, 300_000);
  }
  it('outcomes and heap', () => {
    const h1 = (kernel.oc as unknown as { wasmMemory?: { buffer?: { byteLength?: number } } }).wasmMemory?.buffer?.byteLength ?? NaN;
    expect(h1).toBeGreaterThan(0);
    console.log(`ROLLING-BALL-FUZZ ${from}-${to} ${JSON.stringify({ ...stats, heapMiB: [+(h0 / 2 ** 20).toFixed(1), +(h1 / 2 ** 20).toFixed(1)] })}`);
    expect(stats.cases).toBe(to - from + 1);
    // the kernel's exact rounds are read back, or the file proves nothing about recognition
    expect(stats.exact.rebuilt.length, 'no exact round was rebuilt').toBeGreaterThan(0);
  });
}
