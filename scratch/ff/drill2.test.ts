// The drill point's cone face: is a point at a known (u, v) of the face classified IN at that (u, v)? and where does Newton go?
import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { Kernel } from '@3db/kernel';
const log = (m: string) => appendFileSync('scratch/ff/drill2.log', m + String.fromCharCode(10));
it('drill2', async () => {
  const kernel = await Kernel.load(); const k = kernel as any; const oc = k.oc;
  const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
  const XZ = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 0, 1], normal: [0, -1, 0] };
  const poly = (pts: number[][]) => ({ outer: pts.map((a, i) => ({ kind: 'line', a, b: pts[(i + 1) % pts.length], source: 'e' + i })), holes: [] });
  const plate = kernel.extrude(XY as any, [poly([[-30, -20], [30, -20], [30, 20], [-30, 20]])] as any, [0, 0, 10]).shape;
  const point = 3 / Math.tan((59 * Math.PI) / 180);
  const tool = kernel.revolve(XZ as any, [poly([[0, 11], [3, 11], [3, 6], [0, 6 - point]])] as any, { origin: [0, 0, 0], dir: [0, 0, 1] } as any, 2 * Math.PI).shape;
  const a = kernel.boolean('cut', plate, tool).shape;
  let cone: any;
  for (const ex = new oc.TopExp_Explorer(k.get(a), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) { const f = oc.TopoDS.Face(ex.Current()); const ad = new oc.BRepAdaptor_Surface(f, true); if (String(ad.GetType().value ?? ad.GetType()).includes('Cone') || ad.GetType() === oc.GeomAbs_SurfaceType.GeomAbs_Cone) cone = f; }
  const ad = new oc.BRepAdaptor_Surface(cone, true);
  log(`u ${ad.FirstUParameter()}..${ad.LastUParameter()} v ${ad.FirstVParameter()}..${ad.LastVParameter()}`);
  const cl = new oc.BRepClass_FaceClassifier(); const p2 = new oc.gp_Pnt2d(0, 0);
  const st = (u: number, v: number) => { p2.SetX(u); p2.SetY(v); cl.Perform(cone, p2, 1e-9); const s = cl.State(); return String(s?.value ?? s); };
  const [u0, u1, v0, v1] = [ad.FirstUParameter(), ad.LastUParameter(), ad.FirstVParameter(), ad.LastVParameter()];
  const counts: Record<string, number> = {};
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) {
    const u = u0 + ((u1 - u0) * (i + 0.5)) / 11.0, v = v0 + ((v1 - v0) * (j + 0.5)) / 11.0;
    const s = st(u, v); counts[s] = (counts[s] ?? 0) + 1;
    if (!s.includes('IN')) { const q = ad.Value(u, v); log(`  OUT? u ${u.toFixed(3)} v ${v.toFixed(4)} -> ${s} at (${q.X().toFixed(3)}, ${q.Y().toFixed(3)}, ${q.Z().toFixed(3)})`); q.delete(); }
  }
  log(JSON.stringify(counts));
  const tri = oc.BRep_Tool.Triangulation(cone, new oc.TopLoc_Location(), 0);
  log(`tri ${!!tri} uv ${tri?.HasUVNodes?.()}`);
}, 600_000);
