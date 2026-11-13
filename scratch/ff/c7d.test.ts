// Which single-edge draft traps on a fuzz seed: the kernel's per-edge wire (line extended, arc extended on its circle, other curves extended by their
// end polynomials through the kernel's own extendCurve), drafted alone. JOB = <seed>:<edge index>:<in|out>, one process each.
import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { isTrap, Kernel } from '@3db/kernel';

const log = (m: string) => appendFileSync('scratch/ff/c7.log', m + String.fromCharCode(10));
const XY = { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] };
const L = (a: number[], b: number[], source: string) => ({ kind: 'line', a, b, source });
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function sample(seed: number) {
  const r = rng(seed); const rd = (v: number) => Math.round(v * 1000) / 1000;
  const [w, h] = [rd(15 + 25 * r()), rd(12 + 18 * r())];
  const n = 1 + Math.floor(r() * 3);
  const mids = Array.from({ length: n }, (_, i) => [rd(w * (1 - (i + 1) / (n + 1))), rd(h + (r() * 1.4 - 0.4) * h * 0.4)]);
  const sign = r() < 0.5 ? 1 : -1; const H = rd(3 + 22 * r()); const deg = 0.5 + 7.5 * r();
  const angle = sign * Math.min((deg * Math.PI) / 180, Math.atan((0.2 * Math.min(w, h)) / H));
  const hole = seed % 3 === 0 ? { c: [rd(w / 2), rd(h / 2.5)], r: rd(Math.min(w, h) * (0.06 + 0.06 * r())) } : null;
  return { w, h, mids, H, angle, hole };
}
it('c7d', async () => {
  const [seedS, idxS, dirS] = process.env.JOB!.split(':');
  const s = sample(Number(seedS));
  const kernel = await Kernel.load(); const k = kernel as any; const oc = k.oc;
  const outer = [L([0, 0], [s.w, 0], 'a'), L([s.w, 0], [s.w, s.h], 'b'), { kind: 'spline', points: [[s.w, s.h], ...s.mids, [0, s.h]], source: 'c' }, L([0, s.h], [0, 0], 'd')];
  const st = kernel.extrude(XY as never, [{ outer, holes: [] }] as never, [0, 0, s.H]).shape;
  let face: any = null;
  for (const ex = new oc.TopExp_Explorer(k.get(st), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
    const f = oc.TopoDS.Face(ex.Current()); const p = new oc.GProp_GProps(); oc.BRepGProp.SurfaceProperties(f, p, false, false);
    if (Math.abs(p.CentreOfMass().Z()) < 1e-9 && String(new oc.BRepAdaptor_Surface(f, true).GetType()).includes('Plane')) face = f;
  }
  const inset = s.H * Math.tan(Math.abs(s.angle));
  const reach = Math.min(Math.hypot(s.w, s.h * 1.5), 4 * inset + 1);
  const edges: any[] = [];
  for (const ex = new oc.BRepTools_WireExplorer(oc.BRepTools.OuterWire(face), face); ex.More(); ex.Next()) edges.push(ex.Current());
  const e = edges[Number(idxS)];
  const ad = new oc.BRepAdaptor_Curve(oc.TopoDS.Edge(e));
  const type = String(ad.GetType()).replace('GeomAbs_', '');
  const [u0, u1] = [ad.FirstParameter(), ad.LastParameter()];
  const raw = oc.BRep_Tool.Curve(oc.TopoDS.Edge(e), 0, 0); const curve = raw?.returnValue ?? raw;
  let edge: any;
  let what = type;
  if (type === 'Line') {
    const P = new oc.gp_Pnt(), V = new oc.gp_Vec(); ad.D1(u0, P, V); const t = [V.X(), V.Y(), V.Z()].map((x) => x / V.Magnitude());
    const a = ad.Value(u0), b = ad.Value(u1);
    edge = new oc.BRepBuilderAPI_MakeEdge(new oc.gp_Pnt(a.X() - reach * t[0]!, a.Y() - reach * t[1]!, 0), new oc.gp_Pnt(b.X() + reach * t[0]!, b.Y() + reach * t[1]!, 0)).Edge();
  } else {
    const own = oc.GeomConvert.CurveToBSplineCurve(new oc.Geom_TrimmedCurve(curve, u0, u1, true, true));
    const longer = k.extendCurve(own, reach, reach, { own: (x: any) => x });
    what += ` deg ${longer.Degree()} poles ${longer.NbPoles()} knots ${longer.NbKnots()}`;
    edge = new oc.BRepBuilderAPI_MakeEdge(longer).Edge();
  }
  let out: string;
  try {
    const md = new oc.BRepOffsetAPI_MakeDraft(new oc.BRepBuilderAPI_MakeWire(edge).Wire(), new oc.gp_Dir(0, 0, 1), Math.abs(s.angle));
    md.SetOptions(oc.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RightCorner, 1e-3, Math.PI);
    md.SetDraft(dirS === 'in');
    md.Perform((1.5 * s.H) / Math.cos(s.angle) + 1);
    out = md.IsDone() ? 'ok' : 'not done';
  } catch (err) { out = isTrap(err) ? 'TRAP' : `threw ${String(err).slice(0, 50)}`; }
  log(`edge seed ${seedS} #${idxS} ${what} ${dirS}: ${out}`);
}, 300_000);
