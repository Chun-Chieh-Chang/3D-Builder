// Drafted spline walls (part-3 type B, design doc §6l): a spline-outlined boss extruded with a draft by this program, through STEP. Per face: surface
// type, degrees; for faces with no simple surface: the angle between the outward normal and the extrusion direction at 9×9 places (constant = one
// draft). Then recognition as the app does it.
import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { PlaneGcsSolver } from '@3db/sketch';
import { Kernel } from '@3db/kernel';
import { RecognizeError } from '@3db/regen';
import { recognizeStep, XY } from '../../tests/phase8/recognize-rolling-ball.kit';

const log = (m: string) => appendFileSync('scratch/ff/c6.log', m + String.fromCharCode(10));
const L = (a: number[], b: number[], s: string) => ({ kind: 'line', a, b, source: s });

it('c6a', async () => {
  const kernel = await Kernel.load();
  const solver = await PlaneGcsSolver.create();
  const oc = (kernel as any).oc;
  for (const deg of [1.5, -3]) {
    const draft = (deg * Math.PI) / 180;
    // a free-standing boss: three lines and a spline (the C1 test outline)
    const outer = [L([0, 0], [28.72, 0], 'a'), L([28.72, 0], [28.72, 25], 'b'), { kind: 'spline', points: [[28.72, 25], [14, 32], [0, 25]], source: 'c' }, L([0, 25], [0, 0], 'd')];
    const s = kernel.extrude(XY as never, [{ outer, holes: [] }] as never, [0, 0, 10], 0, undefined, draft).shape;
    const topo = kernel.topology(s);
    log(`== draft ${deg}°: valid ${kernel.check(s).valid}, faces ${topo.faces.map((f) => f.surface).join(',')}`);
    const faces: any[] = [];
    for (const ex = new oc.TopExp_Explorer((kernel as any).get(s), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) faces.push(oc.TopoDS.Face(ex.Current()));
    topo.faces.forEach((f, i) => {
      if (f.geometry) {
        const g: any = f.geometry;
        if (g.type === 'plane') log(`  f${i} plane normal (${g.normal.map((x: number) => x.toFixed(5))}) lean ${((Math.asin(Math.min(1, Math.abs(g.normal[2]))) * 180) / Math.PI).toFixed(4)}°`);
        return;
      }
      const ad = new oc.BRepAdaptor_Surface(faces[i], true);
      const rev = faces[i].Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED;
      const [u0, u1, v0, v1] = [ad.FirstUParameter(), ad.LastUParameter(), ad.FirstVParameter(), ad.LastVParameter()];
      const P = new oc.gp_Pnt(), U = new oc.gp_Vec(), V = new oc.gp_Vec();
      let lo = Infinity, hi = -Infinity;
      for (let a = 0; a < 9; a++) for (let b = 0; b < 9; b++) {
        ad.D1(u0 + ((u1 - u0) * (a + 0.5)) / 9, v0 + ((v1 - v0) * (b + 0.5)) / 9, P, U, V);
        const n = [U.Y() * V.Z() - U.Z() * V.Y(), U.Z() * V.X() - U.X() * V.Z(), U.X() * V.Y() - U.Y() * V.X()];
        const l = Math.hypot(...n);
        const nz = ((rev ? -1 : 1) * n[2]!) / l;
        const ang = (Math.asin(nz) * 180) / Math.PI;
        lo = Math.min(lo, ang); hi = Math.max(hi, ang);
      }
      const type = String(ad.GetType()).replace('GeomAbs_', '');
      const deg2 = type === 'BSplineSurface' ? ` deg ${ad.UDegree()}x${ad.VDegree()} poles ${ad.NbUPoles()}x${ad.NbVPoles()}` : '';
      log(`  f${i} ${type}${deg2}: angle of the outward normal to the xy plane ${lo.toFixed(6)}°..${hi.toFixed(6)}° (spread ${(hi - lo).toExponential(1)}°)`);
      ad.delete(); P.delete(); U.delete(); V.delete();
    });
    try {
      const r = await recognizeStep(kernel, solver, s);
      log(`  recognized: ${JSON.stringify(r.report.features)} diff ${r.report.difference.toExponential(1)}`);
    } catch (e) {
      log(`  ${e instanceof RecognizeError ? 'refused' : 'ERROR'}: ${String((e as Error).message).slice(0, 200)}`);
    }
    kernel.release(s);
  }
}, 600_000);
