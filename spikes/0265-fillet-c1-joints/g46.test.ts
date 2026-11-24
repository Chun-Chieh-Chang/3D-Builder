// Probe: the faces and edge each fillet of seed 46 works on (type, B-spline degrees and poles), and the rebuilt body written to out/prof46/rebuilt.step.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { Kernel } from '@3db/kernel';
import { fuzzFile } from '../../tests/phase8/recognize-rolling-ball.kit';

mkdirSync('out/prof46', { recursive: true });
const LOG = 'out/prof46/g46.log';
writeFileSync(LOG, '');
const log = (s: string) => appendFileSync(LOG, s + '\n');
const P = Kernel.prototype as any;
const orig = P.fillet;
let n = 0;
P.fillet = function (this: any, ...args: any[]) {
  n++;
  if (n <= 2) {
    const oc = this.oc; const shape = this.get(args[0]); const topo = this.topology(args[0]);
    log(`fillet #${n} edges=${JSON.stringify(args[1])} r=${args[2]} faces=${topo.faces.length} edges=${topo.edges.length}`);
    const FACE = oc.TopAbs_ShapeEnum.TopAbs_FACE, EDGE = oc.TopAbs_ShapeEnum.TopAbs_EDGE;
    const list = (T: any) => { const a: any[] = []; for (const ex = new oc.TopExp_Explorer(shape, T, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) a.push(ex.Current()); return a; };
    const faces = list(FACE); const edges = list(EDGE);
    const seen = new Set<string>();
    const ef: any[] = [];
    for (const e of edges) { const k = String(e.HashCode?.(1 << 30) ?? ''); ef.push(e); }
    for (const [i, f] of topo.faces.entries()) {
      const ad = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(faces[i]), true);
      const kind = String(ad.GetType().constructor?.name ?? ad.GetType());
      let extra = '';
      try { const t = String(oc.GeomAbs_SurfaceType && Object.entries(oc.GeomAbs_SurfaceType).find(([, v]) => v === ad.GetType())?.[0]); extra = t; if (/BSpline/.test(t)) { const s = ad.BSpline().get?.() ?? ad.BSpline(); extra += ` deg ${s.UDegree()}x${s.VDegree()} poles ${s.NbUPoles()}x${s.NbVPoles()} knots ${s.NbUKnots()}x${s.NbVKnots()}`; } if (/Extrusion/.test(t)) { const c = ad.BasisCurve(); const ct = Object.entries(oc.GeomAbs_CurveType).find(([, v]) => v === c.GetType())?.[0]; extra += ` basis ${ct}`; if (/BSpline/.test(String(ct))) { const b = c.BSpline().get?.() ?? c.BSpline(); extra += ` deg ${b.Degree()} poles ${b.NbPoles()} knots ${b.NbKnots()}`; } } } catch (e) { extra += ' ?' + String(e).slice(0, 60); }
      const touches = args[1].some((ei: number) => topo.edges[ei].faces.includes(i));
      log(`  face ${i}${touches ? ' *' : ''} ${extra} center ${f.center.map((x: number) => x.toFixed(2))}`);
    }
    for (const ei of args[1]) {
      const e = topo.edges[ei];
      const ad = new oc.BRepAdaptor_Curve(oc.TopoDS.Edge(edges[ei]));
      const ct = Object.entries(oc.GeomAbs_CurveType).find(([, v]) => v === ad.GetType())?.[0];
      let extra = String(ct);
      try { if (/BSpline/.test(extra)) { const b = ad.BSpline().get?.() ?? ad.BSpline(); extra += ` deg ${b.Degree()} poles ${b.NbPoles()} knots ${b.NbKnots()}`; } } catch (e) { extra += ' ?'; }
      log(`  edge ${ei} faces ${JSON.stringify(e.faces)} ${extra} tol ${oc.BRep_Tool.Tolerance_2?.(oc.TopoDS.Edge(edges[ei]))}`);
    }
    if (n === 2) { writeFileSync('out/prof46/rebuilt.step', this.exportStep(args[0], 'rebuilt')); log('wrote rebuilt.step'); throw new (require('@3db/kernel').KernelError)('probe stop'); }
  }
  return orig.apply(this, args);
};
fuzzFile(46, 46);
