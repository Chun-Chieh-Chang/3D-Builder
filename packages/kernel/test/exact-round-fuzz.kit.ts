import { expect, it } from 'vitest';
import { isTrap, Kernel, KernelError, type ShapeId } from '../src';
import { deviation, supportOf } from '../src/exactRound';

/**
 * C2.14: random exact rolling-ball rounds (AGENTS §3.4). Each seed raises a boss with a random outline (circle, stadium, oval of four tangent arcs, lens
 * of two arcs with sharp tips), size, draft and turn from a plate tilted at random, now and then over the plate's side, and rounds the edges where the
 * boss meets the plate with a random radius. OCCT's round and the exact one are made of the same body; the exact one must be a valid solid with the same
 * faces, its volume within what OCCT's rounds were off the ball, its tolerances no larger, and every round of a chain made exact on the ball to 1e-9.
 * Chains it cannot make exact keep OCCT's round (a stated reason in `exactRoundLog`). The files run 20 seeds each, so that each gets a fresh Emscripten
 * heap (AGENTS §3.5), read only through `wasmMemory.buffer.byteLength`, its growth printed, not claimed to be zero.
 */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
type Kind = 'circle' | 'stadium' | 'oval' | 'lens';
const A = (c: number[], r: number, from: number[], to: number[], s: string) => ({ kind: 'arc', c, r, from, to, ccw: true, source: s });
const L = (a: number[], b: number[], s: string) => ({ kind: 'line', a, b, source: s });
function outline(kind: Kind, k: number) {
  const m = (p: number[]) => p.map((x) => x * k);
  if (kind === 'circle') return [{ kind: 'circle', c: [0, 0], r: 6 * k, source: 'c' }];
  if (kind === 'lens') { const x = Math.sqrt(33); return [A(m([0, 4]), 7 * k, m([-x, 0]), m([x, 0]), 'l0'), A(m([0, -4]), 7 * k, m([x, 0]), m([-x, 0]), 'l1')]; }
  if (kind === 'stadium') return [L(m([-5, -6]), m([5, -6]), 's0'), A(m([5, 0]), 6 * k, m([5, -6]), m([5, 6]), 's1'), L(m([5, 6]), m([-5, 6]), 's2'), A(m([-5, 0]), 6 * k, m([-5, 6]), m([-5, -6]), 's3')];
  const c = Math.sqrt(55), y = (12 * c) / 8 - c;
  return [A(m([0, -c]), 12 * k, m([4.5, y]), m([-4.5, y]), 'o0'), A(m([-3, 0]), 4 * k, m([-4.5, y]), m([-4.5, -y]), 'o1'), A(m([0, c]), 12 * k, m([-4.5, -y]), m([4.5, -y]), 'o2'), A(m([3, 0]), 4 * k, m([4.5, -y]), m([4.5, y]), 'o3')];
}
export function sample(seed: number) {
  const r = rng(seed); const rd = (v: number) => Math.round(v * 1000) / 1000;
  const kind = (['circle', 'stadium', 'oval', 'lens'] as const)[Math.floor(r() * 4)]!;
  const k = rd(0.7 + 0.6 * r()), tilt = rd(0.05 + 0.3 * r()), draft = rd(8 * r()), turn = rd(2 * Math.PI * r());
  const over = r() < 0.3; const reach = { circle: 6, stadium: 11, oval: 7.5, lens: 5.8 }[kind] * k;
  const cy = rd(over ? 20 - reach * (0.2 + 0.6 * r()) : 8 * r() - 4);
  const small = { circle: 6, stadium: 6, oval: 4, lens: 7 }[kind] * k;
  const rad = rd(0.2 + Math.min(1.6, 0.25 * small) * r());
  return { kind, k, tilt, draft, turn, cy, r: rad };
}
export function __body(kernel: Kernel, s: ReturnType<typeof sample>) { return body(kernel, s); }
function body(kernel: Kernel, s: ReturnType<typeof sample>) {
  const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } as any;
  const sq = { outer: [[-20, -20], [20, -20], [20, 20], [-20, 20]].map((a, i, p) => L(a, p[(i + 1) % 4]!, 'b' + i)), holes: [] } as any;
  const plate = kernel.extrude(XY, [sq], [0, 0, 5]).shape;
  const n = [0, -Math.sin(s.tilt), Math.cos(s.tilt)];
  const u = [1, 0, 0], v = [0, Math.cos(s.tilt), Math.sin(s.tilt)];
  const xd = u.map((x, i) => Math.cos(s.turn) * x + Math.sin(s.turn) * v[i]!), yd = v.map((x, i) => Math.cos(s.turn) * x - Math.sin(s.turn) * u[i]!);
  const frame = { origin: [0, s.cy - 2 * Math.sin(s.tilt), 5 - 2 * Math.cos(s.tilt)], xDir: xd, yDir: yd, normal: n } as any;
  const boss = kernel.extrude(frame, [{ outer: outline(s.kind, s.k), holes: [] }] as any, n.map((x) => x * 12) as any, 0, undefined, (s.draft * Math.PI) / 180).shape;
  const shape = kernel.boolean('fuse', plate, boss).shape;
  const t = kernel.topology(shape);
  const top = t.faces.findIndex((f) => f.geometry?.type === 'plane' && Math.abs(f.geometry.normal[2] - 1) < 1e-9 && Math.abs(f.center[2] - 5) < 1e-6);
  const edges = t.edges.flatMap((e, i) => (e.faces.length === 2 && e.faces.includes(top) && e.faces.some((f) => f !== top && t.faces[f]!.center[2] > 5 + 1e-6) ? [i] : []));
  return { shape, edges };
}
function roundDevs(kernel: Kernel, res: { shape: ShapeId; faceOrigins: any[] }, r: number) {
  const k = kernel as any; const oc = k.oc; const shp = k.get(res.shape);
  const t = kernel.topology(res.shape); const sm = kernel.smoothEdges(res.shape, t.edges.map((_, i) => i));
  const faces: any[] = []; for (const ex = new oc.TopExp_Explorer(shp, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) faces.push(oc.TopoDS.Face(ex.Current()));
  const isR = (i: number) => (res.faceOrigins[i] ?? []).some((o: any) => o.rel === 'generated' && o.kind === 'edge');
  return t.faces.flatMap((f, i) => {
    if (!isR(i) || ['plane', 'cylinder', 'torus'].includes(f.surface)) return [];
    const sup = [...new Set(t.edges.flatMap((e, k2) => (sm[k2] && e.faces.includes(i) ? e.faces.filter((q) => q !== i && !isR(q)) : [])))];
    return sup.length === 2 ? [(() => { const S = sup.map((q) => supportOf(oc, faces[q])); try { return deviation(oc, faces[i], S, r, 16); } finally { for (const x of S) x.release(); } })()] : [];
  });
}
const KEPT = new Set(['analytic', 'occt exact', 'stretches']);
export function fuzzFile(from: number, to: number) {
  let kernel: Kernel; let h0 = 0; const stats = { cases: 0, occtRefused: 0, occtTrapped: 0, allExact: 0, someKept: 0, reasons: {} as Record<string, number>, ms: 0 };
  it('loads with a heap to measure', async () => { kernel = await Kernel.load(); h0 = (kernel.oc as unknown as { wasmMemory?: { buffer?: { byteLength?: number } } }).wasmMemory?.buffer?.byteLength ?? NaN; expect(h0).toBeGreaterThan(0); });
  for (let seed = from; seed <= to; seed++) {
    it(`seed ${seed}`, async () => {
      const s = sample(seed); stats.cases++;
      let made: { shape: ShapeId; edges: number[] };
      try { made = body(kernel, s); } catch (e) { if (e instanceof KernelError) { stats.occtRefused++; return; } throw e; }
      if (made.edges.length === 0) { stats.occtRefused++; return; }
      let occt: any;
      // OCCT's own round crashing the module (seen: seed 89, a WebAssembly trap inside BRepFilletAPI_MakeFillet.Build) is OCCT's, before any exact work:
      // counted, not swallowed as a pass of the exact round, and the module is replaced (ADR 0242) so that the next seeds run on a sound one
      try { occt = kernel.fillet(made.shape, made.edges, s.r, undefined, undefined, false); } catch (e) { if (isTrap(e)) { stats.occtTrapped++; kernel = await Kernel.load(); return; } if (e instanceof KernelError) { stats.occtRefused++; expect(() => kernel.fillet(made.shape, made.edges, s.r, undefined, undefined, true)).toThrow(KernelError); return; } throw e; }
      const t0 = performance.now(); const exact = kernel.fillet(made.shape, made.edges, s.r, undefined, undefined, true); stats.ms += performance.now() - t0;
      const log = (kernel as any).exactRoundLog as { outcome: string; detail?: string }[];
      const what = JSON.stringify({ s, log });
      expect(kernel.isValid(exact.shape), what).toBe(true);
      expect(kernel.topology(exact.shape).faces.length, what).toBe(kernel.topology(occt.shape).faces.length);
      expect(exact.faceOrigins.length, what).toBe(occt.faceOrigins.length);
      const mt = (id: ShapeId) => (kernel as any).maxTolerance((kernel as any).get(id));
      expect(mt(exact.shape), what).toBeLessThanOrEqual(mt(occt.shape) * (1 + 1e-12));
      const v0 = kernel.massProps(occt.shape).volume, v1 = kernel.massProps(exact.shape).volume;
      expect(Math.abs(v1 - v0) / v0, what).toBeLessThan(5e-6);
      const kept = log.filter((x) => x.outcome !== 'exact' && !KEPT.has(x.outcome));
      for (const x of kept) { const key = x.outcome + (x.outcome === 'threw' ? ': ' + (x.detail ?? '').replace(/\(.*$/, '').trim() : ''); stats.reasons[key] = (stats.reasons[key] ?? 0) + 1; }
      if (kept.length === 0) {
        stats.allExact++;
        const d = roundDevs(kernel, exact, s.r);
        if (d.length) expect(Math.max(...d), what).toBeLessThan(1e-9);
      } else stats.someKept++;
    }, 150_000);
  }
  it('heap and outcomes', () => {
    const h1 = (kernel.oc as unknown as { wasmMemory?: { buffer?: { byteLength?: number } } }).wasmMemory?.buffer?.byteLength ?? NaN;
    expect(h1).toBeGreaterThan(0);
    console.log(`EXACT-ROUND-FUZZ ${from}-${to} ${JSON.stringify({ ...stats, ms: Math.round(stats.ms), heapMiB: [+(h0 / 2 ** 20).toFixed(1), +(h1 / 2 ** 20).toFixed(1)] })}`);
    expect(stats.cases).toBe(to - from + 1);
  });
}
