// C5 feasibility: what the faces of part-3's two region kinds are (regions 0 and 2 stand for 0–1 and 2–5). Per face: surface type, degrees, poles,
// rational, closed; ruled (degree 1 in one direction: then the rulings' directions, whether they are parallel = an extrusion, and whether the two
// boundary curves are planar = a ruled surface between two plane curves); its boundary edges' curve types; area and file gap.
import { appendFileSync, readFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { part3 } from './c5a.test';

const log = (m: string) => appendFileSync('scratch/ff/c5.log', m + String.fromCharCode(10));

it('c5c', async () => {
  const kernel = await Kernel.load();
  const k = kernel as any;
  const oc = k.oc;
  const id = part3(kernel);
  const topo = kernel.topology(id);
  const tau = kernel.fileTolerance(id).faces;
  const { regions } = JSON.parse(readFileSync('scratch/ff/c5-regions.json', 'utf8'));
  const faces: any[] = [];
  for (const ex = new oc.TopExp_Explorer(k.get(id), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) faces.push(oc.TopoDS.Face(ex.Current()));
  const P = (p: any) => [p.X(), p.Y(), p.Z()];
  const sub = (a: number[], b: number[]) => a.map((x, i) => x - b[i]!);
  const unit = (a: number[]) => { const l = Math.hypot(...a) || 1; return a.map((x) => x / l); };
  const dot = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);
  // the largest distance of points from their best plane (by the normal of the first three non-collinear ones; enough to tell planar from not)
  const offPlane = (pts: number[][]) => {
    const c = pts.reduce((a, p) => a.map((x, i) => x + p[i]! / pts.length), [0, 0, 0]);
    let best = Infinity;
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
      const n = (() => { const u = sub(pts[i]!, c), v = sub(pts[j]!, c); return [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!]; })();
      if (Math.hypot(...n) < 1e-6) continue;
      const nn = unit(n);
      best = Math.min(best, Math.max(...pts.map((p) => Math.abs(dot(sub(p, c), nn)))));
    }
    return best;
  };
  for (const r of [0, 2]) {
    log(`== region ${r} (kind of ${r === 0 ? '0,1' : '2,3,4,5'})`);
    for (const f of regions[r].faces) {
      const ad = new oc.BRepAdaptor_Surface(faces[f], true);
      const type = String(ad.GetType()).replace('GeomAbs_', '');
      let s = `  f${f} ${type} area ${topo.faces[f]!.area.toFixed(2)} τ ${(tau[f] ?? 0).toExponential(1)}`;
      if (type === 'BSplineSurface') {
        const [du, dv, nu, nv] = [ad.UDegree(), ad.VDegree(), ad.NbUPoles(), ad.NbVPoles()];
        s += ` deg ${du}x${dv} poles ${nu}x${nv} rat ${ad.IsURational()}/${ad.IsVRational()}`;
        const ruledIn = du === 1 ? 'u' : dv === 1 ? 'v' : null;
        if (ruledIn) {
          const [u0, u1, v0, v1] = [ad.FirstUParameter(), ad.LastUParameter(), ad.FirstVParameter(), ad.LastVParameter()];
          const rails: number[][][] = [[], []];
          const rulings: number[][] = [];
          for (let i = 0; i <= 12; i++) {
            const t = ruledIn === 'v' ? u0 + ((u1 - u0) * i) / 12 : v0 + ((v1 - v0) * i) / 12;
            const a = P(ruledIn === 'v' ? ad.Value(t, v0) : ad.Value(u0, t));
            const b = P(ruledIn === 'v' ? ad.Value(t, v1) : ad.Value(u1, t));
            rails[0]!.push(a); rails[1]!.push(b); rulings.push(unit(sub(b, a)));
          }
          const par = Math.max(...rulings.map((d) => 1 - Math.abs(dot(d, rulings[0]!))));
          s += ` | ruled in ${ruledIn}: rulings parallel to ${par.toExponential(1)}; rails off a plane ${offPlane(rails[0]!).toExponential(1)} / ${offPlane(rails[1]!).toExponential(1)}`;
        }
      }
      // boundary edges
      const kinds: Record<string, number> = {};
      for (const e of topo.edges) if (e.faces.includes(f)) kinds[e.curve] = (kinds[e.curve] ?? 0) + 1;
      s += ` | edges ${JSON.stringify(kinds)}`;
      log(s);
      ad.delete();
    }
  }
}, 600_000);
