import { describe, expect, it } from 'vitest';
import { Kernel, type ShapeId } from '../src';
import { deviation, supportOf } from '../src/exactRound';

// C2.11: exact rolling-ball rounds where rounds meet (freeform-generalization.md §6c). A boss raised with a draft from a tilted plate, so that the edge
// where they meet is no line or circle and OCCT's round of it is a B-spline off the ball:
// - a lens (two arcs meeting at sharp tips): the two rounds cut each other at each tip, and the wall beyond (part-4's 20 such meetings);
// - a stadium (half circles and straight sides) or an oval (four tangent arcs): the round runs on round while the wall under it turns from one face to
//   the next, smoothly (part-3's rounds, on a torus, then a cone, ...). `cy` moves the boss over the plate's side, so that the chain is open.
const A = (c: number[], r: number, from: number[], to: number[], s: string) => ({ kind: 'arc', c, r, from, to, ccw: true, source: s });
const L = (a: number[], b: number[], s: string) => ({ kind: 'line', a, b, source: s });
function outline(kind: 'lens' | 'stadium' | 'oval') {
  if (kind === 'lens') { const x = Math.sqrt(33); return [A([0, 4], 7, [-x, 0], [x, 0], 'l0'), A([0, -4], 7, [x, 0], [-x, 0], 'l1')]; }
  if (kind === 'stadium') return [L([-5, -6], [5, -6], 's0'), A([5, 0], 6, [5, -6], [5, 6], 's1'), L([5, 6], [-5, 6], 's2'), A([-5, 0], 6, [-5, 6], [-5, -6], 's3')];
  const c = Math.sqrt(55), y = (12 * c) / 8 - c;
  return [A([0, -c], 12, [4.5, y], [-4.5, y], 'o0'), A([-3, 0], 4, [-4.5, y], [-4.5, -y], 'o1'), A([0, c], 12, [-4.5, -y], [4.5, -y], 'o2'), A([3, 0], 4, [4.5, -y], [4.5, y], 'o3')];
}
function body(kernel: Kernel, kind: 'lens' | 'stadium' | 'oval', cy = 0, tilt = 0.25, draft = 5) {
  const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } as any;
  const sq = { outer: [[-20, -20], [20, -20], [20, 20], [-20, 20]].map((a, i, p) => L(a, p[(i + 1) % 4]!, 'b' + i)), holes: [] } as any;
  const plate = kernel.extrude(XY, [sq], [0, 0, 5]).shape;
  const n = [0, -Math.sin(tilt), Math.cos(tilt)];
  const frame = { origin: [0, cy - 2 * Math.sin(tilt), 5 - 2 * Math.cos(tilt)], xDir: [1, 0, 0], yDir: [0, Math.cos(tilt), Math.sin(tilt)], normal: n } as any;
  const boss = kernel.extrude(frame, [{ outer: outline(kind), holes: [] }] as any, n.map((v) => v * 12) as any, 0, undefined, (draft * Math.PI) / 180).shape;
  const shape = kernel.boolean('fuse', plate, boss).shape;
  const t = kernel.topology(shape);
  const top = t.faces.findIndex((f) => f.geometry?.type === 'plane' && Math.abs(f.geometry.normal[2] - 1) < 1e-9 && Math.abs(f.center[2] - 5) < 1e-6);
  const edges = t.edges.flatMap((e, i) => (e.faces.length === 2 && e.faces.includes(top) && e.faces.some((f) => f !== top && t.faces[f]!.center[2] > 5 + 1e-6) ? [i] : []));
  return { shape, edges };
}
/** Each round face (generated from an edge) that is no plane, cylinder or torus: its rolling-ball deviation on its supports (smooth neighbours that are no round). */
function rounds(kernel: Kernel, res: { shape: ShapeId; faceOrigins: any[] }, r: number) {
  const k = kernel as any; const oc = k.oc; const shp = k.get(res.shape);
  const t = kernel.topology(res.shape); const sm = kernel.smoothEdges(res.shape, t.edges.map((_, i) => i));
  const faces: any[] = []; for (const ex = new oc.TopExp_Explorer(shp, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) faces.push(oc.TopoDS.Face(ex.Current()));
  const isR = (i: number) => (res.faceOrigins[i] ?? []).some((o: any) => o.rel === 'generated' && o.kind === 'edge');
  return t.faces.flatMap((f, i) => {
    if (!isR(i) || ['plane', 'cylinder', 'torus'].includes(f.surface)) return [];
    const sup = [...new Set(t.edges.flatMap((e, k2) => (sm[k2] && e.faces.includes(i) ? e.faces.filter((q) => q !== i && !isR(q)) : [])))];
    if (sup.length !== 2) return [Infinity]; const S = sup.map((q) => supportOf(oc, faces[q])); try { return [deviation(oc, faces[i], S, r, 24)]; } finally { for (const x of S) x.release(); }
  });
}
const maxTol = (kernel: Kernel, id: ShapeId) => (kernel as any).maxTolerance((kernel as any).get(id));

describe('exact rolling-ball rounds where rounds meet (C2.11)', () => {
  const cases: [string, 'lens' | 'stadium' | 'oval', number, number, number][] = [
    // name, outline, cy, r, contours made exact
    ['two rounds cutting each other at both tips', 'lens', 0, 0.381, 2],
    ['two rounds cutting each other at both tips', 'lens', 0, 1.5, 2],
    ['closed, the wall turning from cone to plane', 'stadium', 0, 0.381, 1],
    ['closed, the wall turning from cone to plane', 'stadium', 0, 1.5, 1],
    ['closed, the wall turning from cone to cone', 'oval', 0, 0.381, 1],
    ['open, the wall turning from cone to cone, ends on the plate side', 'oval', 17.5, 0.381, 1],
  ];
  for (const [name, kind, cy, r, n] of cases) {
    it(`${name} (${kind}), r = ${r}`, async () => {
      const kernel = await Kernel.load();
      const { shape, edges } = body(kernel, kind, cy);
      const occt = kernel.fillet(shape, edges, r, undefined, undefined, false);
      const exact = kernel.fillet(shape, edges, r, undefined, undefined, true);
      const log = (kernel as any).exactRoundLog as { outcome: string }[];
      expect(log.filter((x) => x.outcome === 'exact').length, JSON.stringify(log)).toBe(n);
      const dO = rounds(kernel, occt, r), dE = rounds(kernel, exact, r);
      expect(dE.length).toBe(dO.length);
      expect(Math.max(...dO)).toBeGreaterThan(1e-5); // what the exact round is for
      expect(Math.max(...dE)).toBeLessThan(1e-9);
      expect(kernel.isValid(exact.shape)).toBe(true);
      expect(kernel.topology(exact.shape).faces.length).toBe(kernel.topology(occt.shape).faces.length);
      expect(maxTol(kernel, exact.shape)).toBeLessThanOrEqual(maxTol(kernel, occt.shape));
      const v0 = kernel.massProps(occt.shape).volume, v1 = kernel.massProps(exact.shape).volume;
      expect(Math.abs(v1 - v0) / v0).toBeLessThan(5e-6);
    }, 120_000);
  }
  it('keeps OCCT body exactly as it was where a chain is refused (a round face on no stretch)', async () => {
    const kernel = await Kernel.load();
    const { shape, edges } = body(kernel, 'oval', 16);
    const occt = kernel.fillet(shape, edges, 1.5, undefined, undefined, false);
    const exact = kernel.fillet(shape, edges, 1.5, undefined, undefined, true);
    const log = (kernel as any).exactRoundLog as { outcome: string }[];
    expect(log.some((x) => x.outcome === 'exact')).toBe(false);
    expect(kernel.isValid(exact.shape)).toBe(true);
    expect(kernel.massProps(exact.shape).volume).toBe(kernel.massProps(occt.shape).volume);
    expect(maxTol(kernel, exact.shape)).toBe(maxTol(kernel, occt.shape));
  }, 120_000);
});
