/**
 * Drafted extrusions of outlines with a spline (ADR 0251), random parts (AGENTS §3.4): 120 outlines (a w × h box whose top is a spline through 1 to 3
 * random points), a random height and a draft of ±0.5° to ±8° kept small enough not to close the outline (H·tan α ≤ 0.2 of its smaller side),
 * every third with a round hole. Each must be a valid solid, narrower or wider than the straight prism as its sign says, with every face named,
 * every wall on a line exactly z·tan(α) from the outline (1e-9) and the spline's within 1e-7 mm (accepted 1e-4; measured 8.4e-10 at worst). A
 * KernelError is allowed but counted (at most 5 in 120). A refusal as closing must be borne out on the geometry itself: a round hole of a widening
 * body whose radius the inset reaches, or a spline that bends somewhere tighter than the inset; every such hole must be refused. A trap or anything
 * else fails the case. A file of its own for a fresh Emscripten heap (AGENTS §3.5); the heap is read only through `wasmMemory.buffer.byteLength`
 * and printed, not claimed flat (the Boolean of B-spline walls holds heap per call: ADR 0251).
 */
import { afterAll, expect, it } from 'vitest';
import { isTrap, Kernel, KernelError } from '@3db/kernel';
import { offDraft } from '../../packages/kernel/test/draft-spline.kit';

let kernel: Kernel;
let h0 = 0;
const heap = () => (kernel.oc as unknown as { wasmMemory?: { buffer?: { byteLength?: number } } }).wasmMemory?.buffer?.byteLength ?? NaN;
const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const L = (a: number[], b: number[], source: string) => ({ kind: 'line', a, b, source });
const stats = { cases: 0, made: 0, refused: [] as string[], closing: [] as number[], bending: [] as number[], holes: 0, narrowing: 0, widening: 0, worstSpline: 0, worstPlane: 0 };

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sample(seed: number) {
  const r = rng(seed);
  const rd = (v: number) => Math.round(v * 1000) / 1000;
  const [w, h] = [rd(15 + 25 * r()), rd(12 + 18 * r())];
  const n = 1 + Math.floor(r() * 3);
  const mids = Array.from({ length: n }, (_, i) => [rd(w * (1 - (i + 1) / (n + 1))), rd(h + (r() * 1.4 - 0.4) * h * 0.4)]);
  const sign = r() < 0.5 ? 1 : -1;
  const H = rd(3 + 22 * r());
  const deg = 0.5 + 7.5 * r();
  // keep the narrowed top open: H·tan α ≤ 0.2 · min(w, h)
  const angle = sign * Math.min((deg * Math.PI) / 180, Math.atan((0.2 * Math.min(w, h)) / H));
  const hole = seed % 3 === 0 ? { c: [rd(w / 2), rd(h / 2.5)], r: rd(Math.min(w, h) * (0.06 + 0.06 * r())) } : null;
  return { w, h, mids, H, angle, hole };
}

/** The smallest radius of curvature of the spline edges at the base of a straight extrusion (401 samples each, from OCCT's own derivatives). */
function tightestBend(shape: unknown): number {
  const oc = kernel.oc as any;
  const k = kernel as any;
  let least = Infinity;
  for (const ex = new oc.TopExp_Explorer(k.get(shape), oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
    const ad = new oc.BRepAdaptor_Curve(oc.TopoDS.Edge(ex.Current()));
    if (!String(ad.GetType()).includes('BSpline') || Math.abs(ad.Value(ad.FirstParameter()).Z()) > 1e-9) continue;
    const [P, V1, V2] = [new oc.gp_Pnt(), new oc.gp_Vec(), new oc.gp_Vec()];
    for (let i = 0; i <= 400; i++) {
      ad.D2(ad.FirstParameter() + ((ad.LastParameter() - ad.FirstParameter()) * i) / 400, P, V1, V2);
      const cross = Math.abs(V1.X() * V2.Y() - V1.Y() * V2.X());
      if (cross > 1e-12) least = Math.min(least, V1.Magnitude() ** 3 / cross);
    }
  }
  return least;
}

it('loads with a heap to measure', async () => {
  kernel = await Kernel.load();
  h0 = heap();
  expect(h0).toBeGreaterThan(0);
});

for (let seed = 1; seed <= 120; seed++) {
  it(`seed ${seed}`, () => {
    const s = sample(seed);
    const what = JSON.stringify(s);
    stats.cases++;
    const outer = [L([0, 0], [s.w, 0], 'a'), L([s.w, 0], [s.w, s.h], 'b'), { kind: 'spline', points: [[s.w, s.h], ...s.mids, [0, s.h]], source: 'c' }, L([0, s.h], [0, 0], 'd')];
    const region = { outer, holes: s.hole ? [[{ kind: 'circle', c: s.hole.c, r: s.hole.r, source: 'h' }]] : [] };
    const live = kernel.liveShapes;
    const straight = kernel.extrude(XY as never, [region] as never, [0, 0, s.H]);
    const bend = tightestBend(straight.shape);
    let drafted: ReturnType<Kernel['extrude']>;
    try {
      drafted = kernel.extrude(XY as never, [region] as never, [0, 0, s.H], 0, undefined, s.angle);
    } catch (e) {
      kernel.release(straight.shape);
      if (isTrap(e) || !(e instanceof KernelError)) throw e;
      expect(kernel.liveShapes, what).toBe(live);
      // refused as closing only when something really closes before the far end: a round hole of a widening body, which narrows by H·tan|α| on
      // each side, or a spline that bends tighter than that somewhere (offset by more than its radius of curvature, a curve ties into a loop;
      // either side is allowed here, a necessary condition measured on the curve itself, not by the code under test)
      if (/收合|closes/.test(e.message)) {
        const inset = s.H * Math.tan(Math.abs(s.angle));
        const hole = !!s.hole && s.angle < 0 && inset >= s.hole.r;
        expect(hole || bend <= inset, `${what}: refused as closing, inset ${inset}, tightest bend ${bend}`).toBe(true);
        stats.closing.push(seed);
        if (!hole) stats.bending.push(seed);
        return;
      }
      stats.refused.push(`${seed}: ${e.message}`);
      return;
    }
    try {
      stats.made++;
      if (s.hole) stats.holes++;
      if (s.angle > 0) stats.narrowing++;
      else stats.widening++;
      expect(kernel.check(drafted.shape).valid, what).toBe(true);
      expect(kernel.solidCount(drafted.shape), what).toBe(1);
      const v = kernel.massProps(drafted.shape, { eps: 1e-10 }).volume;
      const v0 = kernel.massProps(straight.shape, { eps: 1e-10 }).volume;
      if (s.angle > 0) expect(v, what).toBeLessThan(v0);
      else expect(v, what).toBeGreaterThan(v0);
      expect(drafted.faceOrigins.every((o) => o.length > 0), what).toBe(true);
      const walls = offDraft(kernel, drafted, straight, s.angle, s.H);
      // every wall measured, at many points
      expect(walls.length, what).toBe(4 + (s.hole ? 1 : 0));
      for (const wall of walls) expect(wall.n, what).toBeGreaterThan(50);
      for (const wall of walls) {
        if (wall.type === 'Plane') stats.worstPlane = Math.max(stats.worstPlane, wall.worst);
        else stats.worstSpline = Math.max(stats.worstSpline, wall.worst);
        expect(wall.worst, `${what} ${wall.type}`).toBeLessThan(wall.type === "Plane" ? 1e-9 : 1e-7);
      }
    } finally {
      kernel.release(drafted.shape);
      kernel.release(straight.shape);
    }
    expect(kernel.liveShapes, what).toBe(live);
  }, 120_000);
}

afterAll(() => {
  console.log(`draft-spline fuzz: ${JSON.stringify({ ...stats, refused: stats.refused.length })}; refused ${JSON.stringify(stats.refused)}; heap ${(h0 / 2 ** 20).toFixed(1)} -> ${(heap() / 2 ** 20).toFixed(1)} MiB`);
});

it('made nearly all of them, both ways, with and without holes', () => {
  expect(stats.cases).toBe(120);
  expect(stats.refused.length).toBeLessThanOrEqual(5);
  // every hole that the draft closes is refused as closing, never made (an independent count of those the sample makes)
  const closes = Array.from({ length: 120 }, (_, i) => sample(i + 1)).filter((x) => x.hole && x.angle < 0 && x.H * Math.tan(-x.angle) >= x.hole.r).length;
  expect(stats.closing.length - stats.bending.length).toBe(closes);
  expect(stats.narrowing).toBeGreaterThan(20);
  expect(stats.widening).toBeGreaterThan(20);
  expect(stats.holes).toBeGreaterThan(20);
});
