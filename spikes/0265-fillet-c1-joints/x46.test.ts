// Probe: OCCT's Rational fillet alone (BRepFilletAPI_MakeFillet.Build), timed, on seed 46's original body and on its rebuilt body read from
// out/prof46/rebuilt.step, at the file's radius and at the rebuild's. Also the edge's curve and tolerance on each.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import { Kernel } from '@3db/kernel';
import { splineBoss, sample } from '../../tests/phase8/recognize-rolling-ball.kit';

const LOG = 'out/prof46/x46.log';
writeFileSync(LOG, '');
const log = (s: string) => appendFileSync(LOG, `${new Date().toISOString().slice(11, 19)} ${s}\n`);
let k: Kernel; let orig: any; let rebuilt: any;
const edgeOf = (id: any) => { const t = k.topology(id); const wall = t.faces.findIndex((f) => !f.geometry); const cap = t.faces.findIndex((f, i) => f.geometry?.type === 'plane' && Math.abs(f.center[2]) < 1e-6 && t.edges.some((e) => e.faces.includes(wall) && e.faces.includes(i))); return t.edges.flatMap((e, i) => (e.faces.includes(wall) && e.faces.includes(cap) ? [i] : [])); };
function describe(name: string, id: any, edge: number) {
  const oc = k.oc as any; const shape = (k as any).get(id);
  const map = new oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher(); oc.TopExp.MapShapes(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, map);
  const e = oc.TopoDS.Edge(map.FindKey(edge + 1));
  const ad = new oc.BRepAdaptor_Curve(e);
  const ct = Object.entries(oc.GeomAbs_CurveType).find(([, v]) => v === ad.GetType())?.[0];
  let extra = '';
  if (/BSpline/.test(String(ct))) { const b = ad.BSpline().get?.() ?? ad.BSpline(); extra = ` deg ${b.Degree()} poles ${b.NbPoles()} knots ${b.NbKnots()} periodic ${b.IsPeriodic()}`; }
  log(`${name}: edge ${edge} ${ct}${extra} range ${ad.FirstParameter().toFixed(6)}..${ad.LastParameter().toFixed(6)} tol ${oc.BRep_Tool.Tolerance(e)} maxTol ${(k as any).maxTolerance(shape)}`);
  return { shape, e };
}
function time(name: string, id: any, edge: number, r: number) {
  const oc = k.oc as any; const { shape, e } = describe(name, id, edge);
  const mk = new oc.BRepFilletAPI_MakeFillet(shape, oc.ChFi3d_FilletShape.ChFi3d_Rational);
  mk.Add(r, e);
  const t0 = performance.now();
  try { mk.Build(new oc.Message_ProgressRange()); } catch (err) { log(`${name} r=${r}: THROW ${String(err).slice(0, 80)}`); }
  const done = mk.IsDone();
  log(`${name} r=${r}: ${((performance.now() - t0) / 1000).toFixed(2)}s done=${done}${done ? ' maxTol ' + (k as any).maxTolerance(mk.Shape()) : ''}`);
  mk.delete();
}
it('loads', async () => {
  k = await Kernel.load(); const s = sample(46);
  orig = splineBoss(k, s.top, s.h);
  const rb = k.importStep(readFileSync('out/prof46/rebuilt.step'));
  rebuilt = { shape: rb.shape, edges: edgeOf(rb.shape) };
  log(`orig edges ${JSON.stringify(orig.edges)} rebuilt edges ${JSON.stringify(rebuilt.edges)} warnings ${JSON.stringify(rb.warnings)}`);
  expect(rebuilt.edges.length).toBe(1);
});
it('original 1.184', () => time('orig', orig.shape, orig.edges[0], 1.184), 300_000);
it('original 1.1839999717', () => time('orig', orig.shape, orig.edges[0], 1.1839999717), 300_000);
it('rebuilt 1.184', () => time('rebuilt', rebuilt.shape, rebuilt.edges[0], 1.184), 300_000);
it('rebuilt 1.1839999717', () => time('rebuilt', rebuilt.shape, rebuilt.edges[0], 1.1839999717), 300_000);
