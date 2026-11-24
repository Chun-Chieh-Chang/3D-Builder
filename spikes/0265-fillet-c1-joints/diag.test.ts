// Probe: OCCT's own diagnosis of the Rational fillet of a rolling-ball fuzz seed's input (the boss edge, the seed's radius): Simulate (the walk of the
// ball along the spine only, its sections) timed apart from Build, then the stripe status, computed surfaces, faulty vertices. SEEDS env, comma list.
import { appendFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { sample, splineBoss } from '../../tests/phase8/recognize-rolling-ball.kit';

const LOG = 'out/prof46/diag.log';
writeFileSync(LOG, '');
const log = (s: string) => appendFileSync(LOG, `${new Date().toISOString().slice(11, 19)} ${s}\n`);
const seeds = (process.env.SEEDS ?? '96,92,46').split(',').map(Number);
let k: Kernel;
it('loads', async () => { k = await Kernel.load(); });
const radii = process.env.RADII ? process.env.RADII.split(",").map(Number) : [NaN];
for (const seed of seeds) for (const rr of radii) {
  it(`seed ${seed} r ${rr}`, () => {
    const oc = k.oc as any; const s0 = sample(seed); const s = { ...s0, radius: Number.isNaN(rr) ? s0.radius : rr }; const m = splineBoss(k, s.top, s.h);
    const shape = (k as any).get(m.shape);
    const map = new oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher(); oc.TopExp.MapShapes(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, map);
    const e = oc.TopoDS.Edge(map.FindKey(m.edges[0]! + 1));
    log(`seed ${seed} ${JSON.stringify(s)}`);
    const mk = (): any => { const f = new oc.BRepFilletAPI_MakeFillet(shape, oc.ChFi3d_FilletShape.ChFi3d_Rational); f.Add(s.radius, e); return f; };
    const sim = mk();
    log(`  contours ${sim.NbContours()} edges ${sim.NbEdges(1)} length ${sim.Length(1).toFixed(3)} closed ${sim.Closed(1)}`);
    let t0 = performance.now();
    try { sim.Simulate(1); log(`  Simulate ${((performance.now() - t0) / 1000).toFixed(2)}s surfaces ${sim.NbSurf(1)} sections ${Array.from({ length: sim.NbSurf(1) }, (_, i) => { try { const h = sim.Sect(1, i + 1); const a = h.get?.() ?? h; return a.Length(); } catch { return '?'; } }).join(',')}`); }
    catch (err) { log(`  Simulate THROW ${((performance.now() - t0) / 1000).toFixed(2)}s ${String(err).slice(0, 80)}`); }
    sim.delete();
    const b = mk();
    t0 = performance.now();
    try { b.Build(new oc.Message_ProgressRange()); } catch (err) { log(`  Build THROW ${String(err).slice(0, 80)}`); }
    const st = (() => { try { return b.StripeStatus(1); } catch { return '?'; } })();
    log(`  Build ${((performance.now() - t0) / 1000).toFixed(2)}s done ${b.IsDone()} faultyContours ${b.NbFaultyContours()} status ${typeof st === 'object' ? JSON.stringify(st) : st} computed ${(() => { try { return b.NbComputedSurfaces(1); } catch { return '?'; } })()} faultyVertices ${b.NbFaultyVertices()} hasResult ${b.HasResult()} surfaces ${b.NbSurfaces()}`);
    for (let i = 1; i <= b.NbFaultyVertices(); i++) { const v = oc.BRep_Tool.Pnt(b.FaultyVertex(i)); log(`    faulty vertex ${[v.X(), v.Y(), v.Z()].map((x: number) => x.toFixed(3))}`); }
    b.delete(); k.release(m.shape);
  }, 600_000);
}
