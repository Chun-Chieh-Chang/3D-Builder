/**
 * A spline outline made of biarcs (ADR 0243), random parts (AGENTS §3.4): 120 walls of a random spline, straight to within the check but no exact extrusion (C1), in two files, half of them with a hole, made with the kernel, sent through STEP and recognized
 * with the approximation on. Each is refused with a RecognizeError or comes back within the bound it claims, which is checked here by the circle's formula on the rebuilt arcs, not by the
 * comparison the product uses. In a file of its own for a fresh Emscripten heap (AGENTS §3.5); the heap's growth is printed, not claimed to be zero.
 */
import { beforeAll, expect, it } from 'vitest';
import { applyCommand, createEmptyPart } from '@3db/model';
import { sha256Hex } from '@3db/io';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel, type Frame, type Region, type SectionEdge, type ShapeId } from '@3db/kernel';
import { reconstructImported, RecognizeError, Regenerator, SPLINE_TOLERANCE } from '@3db/regen';

let kernel: Kernel;
let solver: PlaneGcsSolver;
beforeAll(async () => {
  kernel = await Kernel.load();
  solver = await PlaneGcsSolver.create();
});

const heap = () => (kernel.oc as unknown as { wasmMemory?: { buffer?: { byteLength?: number } } }).wasmMemory?.buffer?.byteLength;
const XY: Frame = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
type P = [number, number];

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bezierPoint(span: readonly (readonly number[])[], t: number): P {
  const q = span.map((p) => [p[0]!, p[1]!, p[3]!]);
  for (let n = q.length - 1; n > 0; n--) for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) q[i]![k] = q[i]![k]! * (1 - t) + q[i + 1]![k]! * t;
  return [q[0]![0]! / q[0]![2]!, q[0]![1]! / q[0]![2]!];
}
function toArc(p: P, e: Extract<SectionEdge, { kind: 'arc' }>): number {
  const norm = (x: number) => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const ang = (q: readonly number[]) => Math.atan2(q[1]! - e.c[1], q[0]! - e.c[0]);
  const ccw = norm(ang(e.mid) - ang(e.a)) < norm(ang(e.b) - ang(e.a));
  const inside = ccw ? norm(ang(p) - ang(e.a)) <= norm(ang(e.b) - ang(e.a)) : norm(ang(e.a) - ang(p)) <= norm(ang(e.a) - ang(e.b));
  if (inside) return Math.abs(Math.hypot(p[0] - e.c[0], p[1] - e.c[1]) - e.r);
  return Math.min(Math.hypot(p[0] - e.a[0], p[1] - e.a[1]), Math.hypot(p[0] - e.b[0], p[1] - e.b[1]));
}

/** Seeds 61 to 120 here, 1 to 60 in recognize-approximate-fuzz: the near-straight lofted walls (C1) take about 4 s a part, two files keep each well within its time. */
export const FIRST = 61;
export const LAST = 120;

it(`random near-straight spline walls ${FIRST}..${LAST}: each refused or within the bound it says, nothing crashes`, async () => {
  const h0 = heap();
  expect(h0).toBeGreaterThan(0);
  let [rebuilt, refused, holes, worstRatio, worstBound] = [0, 0, 0, 0, 0];
  const refusals = new Map<string, number>();
  for (let seed = FIRST; seed <= LAST; seed++) {
    const r = rng(seed);
    const round = (v: number) => Math.round(v * 100) / 100;
    const [w, y, h] = [round(20 + r() * 40), round(20 + r() * 20), round(4 + r() * 20)];
    // the middle points well above the bottom, moving no more than the width over the number of points: a gentle curve, the kind of outline this is for
    const n = 3 + Math.floor(r() * 2);
    const top: P[] = Array.from({ length: n }, (_, i) => [round(w - (w * i) / (n - 1)), i === 0 || i === n - 1 ? y : round(y + (r() - 0.3) * (w / n))]);
    const region = { outer: [{ kind: 'line', a: [0, 0], b: [w, 0], source: 'a' }, { kind: 'line', a: [w, 0], b: top[0], source: 'b' }, { kind: 'spline', points: top, closed: false, source: 'c' }, { kind: 'line', a: top[n - 1], b: [0, 0], source: 'd' }], holes: [] } as Region;
    const made: ShapeId[] = [];
    const own = (id: ShapeId) => (made.push(id), id);
    try {
      // the spline wall straight to well within what is asked of it but no exact extrusion (one inner point 1e-8 mm off at the top, ruled between):
      // an exact extrusion is rebuilt exactly instead, with no approximation (C1)
      const nudged = region.outer.map((g) => (g.kind === 'spline' ? { ...g, points: g.points.map((p, i) => (i === 1 ? ([p[0], p[1] + 1e-8] as [number, number]) : p)) } : g));
      let s = own(kernel.loft([{ frame: XY, outer: region.outer }, { frame: { ...XY, origin: [0, 0, h] }, outer: nudged }]).shape);
      const hole = r() < 0.5;
      if (hole) {
        s = own(kernel.boolean('cut', s, own(kernel.extrude({ ...XY, origin: [0, 0, -1] }, [{ outer: [{ kind: 'circle', c: [w / 2, y / 2], r: round(1 + r() * (y / 6)), source: 'h' }], holes: [] }], [0, 0, h + 2]).shape)).shape);
        holes++;
      }
      const bytes = new TextEncoder().encode(kernel.exportStep(s, `fuzz-${seed}`));
      const sha = await sha256Hex(bytes);
      const doc = applyCommand(createEmptyPart(), { type: 'importBody', blob: { id: 'blob1', sha256: sha, kind: 'step', fileName: 'f.step' }, feature: { id: 'imp1', type: 'importedBody', name: 'i', suppressed: false, blob: 'blob1' }, index: 0 });
      const regen = new Regenerator(kernel, solver, new Map([[sha, bytes]]));
      try {
        let out;
        try {
          out = reconstructImported(kernel, regen, doc, 'imp1', solver, undefined, { approximateSplines: true });
        } catch (e) {
          if (!(e instanceof RecognizeError)) throw new Error(`seed ${seed}: ${(e as Error).message}`);
          refused++;
          const key = e.message.replace(/[\d.,e+-]+/g, '#').slice(0, 60);
          refusals.set(key, (refusals.get(key) ?? 0) + 1);
          continue;
        }
        const a = out.report.approximation;
        expect(a, `seed ${seed}`).toBeDefined();
        expect(a!.bound, `seed ${seed}`).toBeGreaterThan(0);
        expect(a!.bound, `seed ${seed}`).toBeLessThanOrEqual(SPLINE_TOLERANCE);
        const res = regen.rebuild(out.doc);
        expect(res.features.every((f) => f.status === 'ok'), `seed ${seed}`).toBe(true);
        // the spline against the arcs, by formula, at a height no recognition step looked at
        const frame = { ...XY, origin: [0, 0, h * 0.37] as [number, number, number] };
        const rect = { u0: -100, u1: 100, v0: -100, v1: 100 };
        const arcs = kernel.sectionEdges(res.body!.shape, frame, rect).filter((e): e is Extract<SectionEdge, { kind: 'arc' }> => e.kind === 'arc');
        expect(arcs.length, `seed ${seed}`).toBeGreaterThan(0);
        let farthest = 0;
        for (const e of kernel.sectionEdges(s, frame, rect)) {
          if (e.kind !== 'bezier') continue;
          for (const span of e.spans) for (let i = 0; i <= 12; i++) {
            const p = bezierPoint(span, i / 12);
            farthest = Math.max(farthest, Math.min(...arcs.map((c) => toArc(p, c))));
          }
        }
        expect(farthest, `seed ${seed}`).toBeLessThanOrEqual(a!.bound);
        worstRatio = Math.max(worstRatio, farthest / a!.bound);
        worstBound = Math.max(worstBound, a!.bound);
        rebuilt++;
      } finally {
        regen.dispose();
      }
    } finally {
      for (const id of made) kernel.release(id);
    }
  }
  const h1 = heap()!;
  console.log(`approximate fuzz: ${rebuilt} rebuilt, ${refused} refused, ${holes} with a hole; worst bound ${worstBound.toFixed(5)} mm, worst measured/bound ${worstRatio.toFixed(3)}; heap ${(h0! / 1048576).toFixed(0)} -> ${(h1 / 1048576).toFixed(0)} MiB\n${[...refusals].map(([k, v]) => `${v} × ${k}`).join('\n')}`);
  // gentle outlines are what this is for: most of them must get through, or the test proves only that refusing is safe
  expect(rebuilt).toBeGreaterThanOrEqual(45);
}, 590_000);
