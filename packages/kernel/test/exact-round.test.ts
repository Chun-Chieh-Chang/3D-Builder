import { describe, expect, it } from 'vitest';
import { Kernel, type ShapeId } from '../src';
import { deviation, supportOf } from '../src/exactRound';

// A drafted boss on a plate, tilted: the edge where they meet is no line or circle, so OCCT's round of it is a B-spline that is not the rolling ball
// (C2, freeform-generalization.md §6b). `cy` moves the boss to the plate's side so the round ends on it; `seamOnPlate` keeps the boss's own seam on
// the plate, which cuts the edge in two and makes the round a chain of two faces.
async function body(kernel: Kernel, tilt: number, draft: number, cy: number, seamOnPlate: boolean) {
  const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] } as any;
  const sq = { outer: [[-20, -20], [20, -20], [20, 20], [-20, 20]].map((a, i, p) => ({ kind: 'line', a, b: p[(i + 1) % 4], source: 'b' + i })), holes: [] } as any;
  const plate = kernel.extrude(XY, [sq], [0, 0, 5]).shape;
  const n = [0, -Math.sin(tilt), Math.cos(tilt)];
  const s = Math.sign(cy) || 1;
  const frame = (seamOnPlate ? { xDir: [1, 0, 0], yDir: [0, Math.cos(tilt), Math.sin(tilt)] } : { xDir: [0, s * Math.cos(tilt), s * Math.sin(tilt)], yDir: [-s, 0, 0] }) as any;
  const boss = kernel.extrude({ ...frame, normal: n, origin: [0, cy - 2 * Math.sin(tilt), 5 - 2 * Math.cos(tilt)] }, [{ outer: [{ kind: 'circle', c: [0, 0], r: 6, source: 'c' }], holes: [] }] as any, n.map((x) => x * 12) as any, 0, undefined, (draft * Math.PI) / 180).shape;
  const shape = kernel.boolean('fuse', plate, boss).shape;
  const t = kernel.topology(shape);
  const top = t.faces.findIndex((f: any) => f.geometry?.type === 'plane' && Math.abs(f.geometry.normal[2] - 1) < 1e-9 && Math.abs(f.center[2] - 5) < 1e-6);
  const side = t.faces.findIndex((f: any) => f.geometry?.type === 'cone' || f.geometry?.type === 'cylinder');
  const edges = t.edges.flatMap((e: any, i: number) => (e.faces.includes(top) && e.faces.includes(side) ? [i] : []));
  return { shape, edges };
}

/** The largest rolling-ball deviation of the round faces of `id` (those not plane, cone or cylinder that touch the plate's top and the boss). */
function roundDeviation(kernel: Kernel, id: ShapeId, r: number) {
  const k = kernel as any; const oc = k.oc; const shp = k.get(id);
  const t = kernel.topology(id);
  const top = t.faces.findIndex((f: any) => f.geometry?.type === 'plane' && Math.abs(f.geometry.normal[2] - 1) < 1e-9 && Math.abs(f.center[2] - 5) < 1e-6);
  const side = t.faces.findIndex((f: any) => f.geometry?.type === 'cone' || f.geometry?.type === 'cylinder');
  const faces: any[] = []; for (const ex = new oc.TopExp_Explorer(shp, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) faces.push(oc.TopoDS.Face(ex.Current()));
  const rounds = t.faces.flatMap((f: any, i: number) => (!['plane', 'cone', 'cylinder'].includes(f.geometry?.type ?? f.surface) && t.edges.some((e: any) => e.faces.includes(i) && e.faces.includes(top)) && t.edges.some((e: any) => e.faces.includes(i) && e.faces.includes(side)) ? [i] : []));
  const sup = [faces[top], faces[side]].map((f) => supportOf(oc, f));
  try { return { rounds: rounds.length, dev: Math.max(...rounds.map((i: number) => deviation(oc, faces[i], sup, r))) }; } finally { for (const x of sup) x.release(); }
}

describe('exact rolling-ball rounds (C2)', () => {
  const cases: [string, number, number, number, boolean][] = [
    ['closed, tilted', 0.25, 5, 0, true],
    ['open, ends on the plate side', 0.25, 5, 17, false],
    ['open, the other side', 0.25, 5, -17, false],
    ['a chain of two faces', 0.25, 5, 17, true],
  ];
  for (const [name, tilt, draft, cy, seam] of cases) for (const r of [0.381, 1.5]) {
    it(`${name}, r = ${r}`, async () => {
      const kernel = await Kernel.load();
      const { shape, edges } = await body(kernel, tilt, draft, cy, seam);
      const occt = kernel.fillet(shape, edges, r, undefined, undefined, false);
      const exact = kernel.fillet(shape, edges, r, undefined, undefined, true);
      const dO = roundDeviation(kernel, occt.shape, r), dE = roundDeviation(kernel, exact.shape, r);
      expect(dE.rounds).toBe(dO.rounds);
      expect(dO.dev).toBeGreaterThan(1e-5); // what the exact round is for
      expect(dE.dev).toBeLessThan(1e-9);
      expect(kernel.isValid(exact.shape)).toBe(true);
      // same faces in the same places: the history holds
      expect(kernel.topology(exact.shape).faces.length).toBe(kernel.topology(occt.shape).faces.length);
      expect(exact.faceOrigins.length).toBe(kernel.topology(exact.shape).faces.length);
      // the body moves only by OCCT's deviation over the round
      const v0 = kernel.massProps(occt.shape).volume, v1 = kernel.massProps(exact.shape).volume;
      expect(Math.abs(v1 - v0) / v0).toBeLessThan(5e-6);
    }, 120_000);
  }
  it('leaves an exact OCCT round (a torus) as it is', async () => {
    const kernel = await Kernel.load();
    const { shape, edges } = await body(kernel, 0, 0, 0, true);
    const a = kernel.fillet(shape, edges, 1.5, undefined, undefined, false), b = kernel.fillet(shape, edges, 1.5, undefined, undefined, true);
    expect(kernel.massProps(b.shape).volume).toBe(kernel.massProps(a.shape).volume);
    expect(roundDeviation(kernel, b.shape, 1.5).dev).toBeLessThan(1e-12);
  }, 120_000);
});
