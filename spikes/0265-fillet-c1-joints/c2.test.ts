// Probe: is the C1 joint of the boss's spline wall (Catmull-Rom: interior knots of multiplicity 2, a curvature jump) what makes OCCT's fillet fail
// slowly? For each seed: the default wall, and the same outline as a C2 cubic (GeomAPI_Interpolate through 80 points of it; deviation measured),
// each filleted with the Rational shape alone at the seed's radius: time, status. SEEDS env.
import { appendFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { sample, XY } from '../../tests/phase8/recognize-rolling-ball.kit';

const LOG = 'out/prof46/c2.log';
writeFileSync(LOG, '');
const log = (s: string) => appendFileSync(LOG, `${new Date().toISOString().slice(11, 19)} ${s}\n`);
const L = (a: number[], b: number[], s: string) => ({ kind: 'line', a, b, source: s });
let k: Kernel;
function boss(top: number[][], h: number, spline: object) {
  const plate = k.extrude({ ...XY, origin: [-10, -10, -5] } as never, [{ outer: [[0, 0], [50, 0], [50, 52], [0, 52]].map((a, i, p) => L(a, p[(i + 1) % 4]!, 'q' + i)), holes: [] }] as never, [0, 0, 5]).shape;
  const reg = { outer: [L([0, 0], [top[0]![0]!, 0], 'a'), L([top[0]![0]!, 0], top[0]!, 'b'), { kind: 'spline', points: top, closed: false, source: 'c', ...spline }, L(top[top.length - 1]!, [0, 0], 'd')], holes: [] };
  const shape = k.boolean('fuse', plate, k.extrude({ ...XY, origin: [0, 0, -1] } as never, [reg] as never, [0, 0, h + 1]).shape).shape;
  const t = k.topology(shape);
  const wall = t.faces.findIndex((f) => !f.geometry);
  const cap = t.faces.findIndex((f, i) => f.geometry?.type === 'plane' && Math.abs(f.center[2]) < 1e-6 && t.edges.some((e) => e.faces.includes(wall) && e.faces.includes(i)));
  return { shape, edges: t.edges.flatMap((e, i) => (e.faces.includes(wall) && e.faces.includes(cap) ? [i] : [])), wall };
}
function basis(shape: unknown, wall: number) {
  const oc = k.oc as any; const map = new oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher(); oc.TopExp.MapShapes((k as any).get(shape), oc.TopAbs_ShapeEnum.TopAbs_FACE, map);
  return new oc.BRepAdaptor_Surface(oc.TopoDS.Face(map.FindKey(wall + 1)), true).BasisCurve();
}
function fillet(name: string, m: { shape: unknown; edges: number[] }, r: number) {
  const oc = k.oc as any; const shape = (k as any).get(m.shape);
  const map = new oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher(); oc.TopExp.MapShapes(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, map);
  const b = new oc.BRepFilletAPI_MakeFillet(shape, oc.ChFi3d_FilletShape.ChFi3d_Rational); b.Add(r, oc.TopoDS.Edge(map.FindKey(m.edges[0]! + 1)));
  const t0 = performance.now();
  try { b.Build(new oc.Message_ProgressRange()); } catch (e) { log(`  ${name} THROW ${String(e).slice(0, 60)}`); }
  log(`  ${name}: ${((performance.now() - t0) / 1000).toFixed(2)}s done ${b.IsDone()} status ${(() => { try { return b.StripeStatus(1); } catch { return '?'; } })()}`);
  b.delete();
}
it('loads', async () => { k = await Kernel.load(); });
for (const seed of (process.env.SEEDS ?? '96').split(',').map(Number)) {
  it(`seed ${seed}`, () => {
    const oc = k.oc as any; const s = sample(seed);
    const d = boss(s.top, s.h, {});
    const c = basis(d.shape, d.wall);
    const bs = c.BSpline().get?.() ?? c.BSpline();
    const mults = Array.from({ length: bs.NbKnots() }, (_, i) => bs.Multiplicity(i + 1));
    const [u0, u1] = [c.FirstParameter(), c.LastParameter()];
    const N = 80; const pts = new oc.NCollection_Array1_gp_Pnt(1, N + 1);
    const p = new oc.gp_Pnt(0, 0, 0), v = new oc.gp_Vec(0, 0, 0);
    for (let i = 0; i <= N; i++) { c.D1(u0 + (u1 - u0) * i / N, p, v); pts.SetValue(i + 1, new oc.gp_Pnt(p.X(), p.Y(), 0)); }
    const ip = new oc.GeomAPI_Interpolate(new oc.NCollection_HArray1_gp_Pnt(pts), false, 1e-9); ip.Perform();
    const cv = ip.Curve(); const g = cv.get?.() ?? cv;
    const nurbs = { degree: g.Degree(), poles: Array.from({ length: g.NbPoles() }, (_, i) => { const q = g.Pole(i + 1); return [q.X(), q.Y()]; }), knots: Array.from({ length: g.NbKnots() }, (_, i) => g.Knot(i + 1)), mults: Array.from({ length: g.NbKnots() }, (_, i) => g.Multiplicity(i + 1)) };
    // how far the C2 curve is from the default one: each of 2000 points of the default projected onto it
    let dev = 0;
    for (let i = 0; i <= 2000; i++) { c.D1(u0 + (u1 - u0) * i / 2000, p, v); const pr = new oc.GeomAPI_ProjectPointOnCurve(new oc.gp_Pnt(p.X(), p.Y(), 0), cv); dev = Math.max(dev, pr.LowerDistance()); pr.delete(); }
    log(`seed ${seed} r ${s.radius} default: deg ${bs.Degree()} poles ${bs.NbPoles()} mults ${mults}; C2: poles ${nurbs.poles.length} max deviation ${dev.toExponential(2)}`);
    fillet('default', d, s.radius);
    const c2 = boss(s.top, s.h, { nurbs });
    fillet('C2', c2, s.radius);
    // the default wall cut at its C1 knots (ShapeUpgrade_ShapeDivideContinuity, C2 criteria): the same geometry in C2 pieces; the edges the round takes
    // are then every edge at z = 0 between the plate's top and a piece of the wall
    const div = new oc.ShapeUpgrade_ShapeDivideContinuity((k as any).get(d.shape));
    div.SetBoundaryCriterion(oc.GeomAbs_Shape.GeomAbs_C2); div.SetPCurveCriterion(oc.GeomAbs_Shape.GeomAbs_C2); div.SetSurfaceCriterion(oc.GeomAbs_Shape.GeomAbs_C2);
    const ok = div.Perform(true);
    const split = (k as any).put(div.Result());
    const ts = k.topology(split);
    const cap = ts.faces.findIndex((f) => f.geometry?.type === 'plane' && Math.abs(f.center[2]) < 1e-6 && f.normal?.[2] > 0.9);
    const walls = ts.faces.flatMap((f, i) => (!f.geometry || (f.geometry.type !== 'plane') ? [i] : []));
    const edges = ts.edges.flatMap((e, i) => (e.faces.includes(cap) && e.faces.some((q) => walls.includes(q)) ? [i] : []));
    log(`  split: perform ${ok} faces ${ts.faces.length} (was ${k.topology(d.shape).faces.length}), wall pieces ${walls.length}, edges ${JSON.stringify(edges)}`);
    {
      const sh = (k as any).get(split); const map = new oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher(); oc.TopExp.MapShapes(sh, oc.TopAbs_ShapeEnum.TopAbs_EDGE, map);
      const b = new oc.BRepFilletAPI_MakeFillet(sh, oc.ChFi3d_FilletShape.ChFi3d_Rational);
      for (const i of edges) b.Add(s.radius, oc.TopoDS.Edge(map.FindKey(i + 1)));
      const t0 = performance.now();
      try { b.Build(new oc.Message_ProgressRange()); } catch (e) { log('  split THROW ' + String(e).slice(0, 60)); }
      let vol = '';
      if (b.IsDone()) { const id = (k as any).put(b.Shape()); vol = ` valid ${k.isValid(id)} maxTol ${(k as any).maxTolerance(b.Shape()).toExponential(2)} volume ${k.massProps(id).volume.toFixed(4)}`; }
      log(`  split: ${((performance.now() - t0) / 1000).toFixed(2)}s done ${b.IsDone()} status ${(() => { try { return b.StripeStatus(1); } catch { return '?'; } })()} contours ${b.NbContours()}${vol}`);
      b.delete();
    }
    k.release(d.shape); k.release(c2.shape);
  }, 600_000);
}
