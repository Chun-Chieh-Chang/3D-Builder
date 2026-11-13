// Why a seed's exact round is not read as a rolling ball: supports, arc sections, deviation (SEED).
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
import { arcSections, rollingBall } from '../../packages/kernel/src/roundRecognition';
import { sample, splineBoss } from '../../tests/phase8/recognize-rolling-ball.kit';
it('seed', async () => {
  const kernel = await Kernel.load();
  const s = sample(Number(process.env.SEED ?? 4));
  const m = splineBoss(kernel, s.top, s.h);
  const f = kernel.fillet(m.shape, m.edges, s.radius, undefined, undefined, true);
  console.log('log', JSON.stringify((kernel as any).exactRoundLog));
  const id = kernel.importStep(new TextEncoder().encode(kernel.exportStep(f.shape, 'p'))).shape;
  for (const [how, sh] of [['in process', f.shape], ['step', id]] as const) {
    const t = kernel.topology(sh); const sm = kernel.smoothEdges(sh, t.edges.map((_, i) => i));
    const odd = t.faces.flatMap((x, i) => (x.geometry ? [] : [i]));
    for (const i of odd) {
      const tan = [...new Set(t.edges.flatMap((e, k) => (sm[k] && e.faces.includes(i) ? e.faces.filter((q) => q !== i) : [])))];
      const k = kernel as any; const oc = k.oc; const faces: any[] = []; for (const ex = new oc.TopExp_Explorer(k.get(sh), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) faces.push(oc.TopoDS.Face(ex.Current()));
      const arc = arcSections(oc, faces[i]);
      // spread of the radii, both ways
      const ad = new oc.BRepAdaptor_Surface(faces[i], true); const u0 = ad.FirstUParameter(), u1 = ad.LastUParameter(), v0 = ad.FirstVParameter(), v1 = ad.LastVParameter();
      console.log(how, 'face', i, t.faces[i]!.surface, 'tangent', tan.map((q) => t.faces[q]!.surface), 'arc', JSON.stringify(arc), 'box', [u0, u1, v0, v1].map((x) => x.toFixed(4)));
      if (tan.length >= 2 && !arc) {
        const P = (u: number, v: number) => { const p = ad.Value(u, v); return [p.X(), p.Y(), p.Z()]; };
        const circ = (a: number[], b: number[], c: number[]) => { const ab = Math.hypot(...a.map((x, q) => x - b[q]!)), bc = Math.hypot(...b.map((x, q) => x - c[q]!)), ca = Math.hypot(...c.map((x, q) => x - a[q]!)); const cr = [(b[1]! - a[1]!) * (c[2]! - a[2]!) - (b[2]! - a[2]!) * (c[1]! - a[1]!), (b[2]! - a[2]!) * (c[0]! - a[0]!) - (b[0]! - a[0]!) * (c[2]! - a[2]!), (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!)]; return (ab * bc * ca) / (2 * Math.hypot(...cr)); };
        for (const across of ['v', 'u']) { const rs: number[] = []; for (let q = 0; q <= 8; q++) { const tt = q / 8; const pts = [0, 0.37, 0.71, 1].map((w) => (across === 'v' ? P(u0 + (u1 - u0) * tt, v0 + (v1 - v0) * w) : P(u0 + (u1 - u0) * w, v0 + (v1 - v0) * tt))); rs.push(circ(pts[0]!, pts[1]!, pts[2]!), circ(pts[1]!, pts[2]!, pts[3]!)); } console.log('  across', across, 'radii min/max', Math.min(...rs), Math.max(...rs)); }
      }
      if (tan.length === 2 && arc) console.log('  rollingBall loose', JSON.stringify(rollingBall(oc, faces[i], faces[tan[0]!], faces[tan[1]!], 1)));
    }
  }
}, 300000);
