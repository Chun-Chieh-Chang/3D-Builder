// Where MakeDraft traps on the fuzz seeds: Perform(plane) (draft and trim to the plane, as the kernel does) against Perform(length) (the draft
// surfaces alone, nothing trimmed). JOB = <seed>:<mode>, one process each (a trap leaves the module unusable).
import { appendFileSync } from 'node:fs';
import { it } from 'vitest';
import { isTrap, Kernel } from '@3db/kernel';
const log = (m: string) => appendFileSync('scratch/ff/c6.log', m + String.fromCharCode(10));
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
  return { w, h, mids, H, angle };
}
it('c6n', async () => {
  const [seedS, mode] = process.env.JOB!.split(':');
  const s = sample(Number(seedS));
  const outer = [L([0, 0], [s.w, 0], 'a'), L([s.w, 0], [s.w, s.h], 'b'), { kind: 'spline', points: [[s.w, s.h], ...s.mids, [0, s.h]], source: 'c' }, L([0, s.h], [0, 0], 'd')];
  const kernel = await Kernel.load(); const k = kernel as any; const oc = k.oc;
  const st = kernel.extrude(XY as never, [{ outer, holes: [] }] as never, [0, 0, s.H]).shape;
  let bottom: any = null;
  for (const ex = new oc.TopExp_Explorer(k.get(st), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
    const f = oc.TopoDS.Face(ex.Current()); const p = new oc.GProp_GProps(); oc.BRepGProp.SurfaceProperties(f, p, false, false);
    if (Math.abs(p.CentreOfMass().Z()) < 1e-9 && String(new oc.BRepAdaptor_Surface(f, true).GetType()).includes('Plane')) bottom = f;
  }
  let wire = oc.BRepTools.OuterWire(bottom);
  if (mode === 'edge') {
    // the spline's edge alone, as an open wire: no corner for MakeDraft to trim
    for (const ex = new oc.TopExp_Explorer(wire, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) {
      const e = oc.TopoDS.Edge(ex.Current());
      if (String(new oc.BRepAdaptor_Curve(e).GetType()).includes('BSpline')) wire = new oc.BRepBuilderAPI_MakeWire(e).Wire();
    }
  }
  let out: string;
  try {
    const md = new oc.BRepOffsetAPI_MakeDraft(wire, new oc.gp_Dir(0, 0, 1), Math.abs(s.angle));
    md.SetOptions(oc.BRepBuilderAPI_TransitionMode.BRepBuilderAPI_RightCorner, 1e-3, Math.PI);
    md.SetDraft(s.angle > 0);
    if (mode === 'plane') md.Perform(new oc.Geom_Plane(new oc.gp_Pnt(0, 0, s.H), new oc.gp_Dir(0, 0, 1)), false);
    else md.Perform((1.5 * s.H) / Math.cos(s.angle));
    if (!md.IsDone()) out = 'not done';
    else {
      let n = 0; for (const ex = new oc.TopExp_Explorer(md.Shape(), oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE); ex.More(); ex.Next()) n++;
      out = `ok, ${n} faces`;
    }
  } catch (e) { out = isTrap(e) ? 'TRAP' : `threw ${String(e).slice(0, 60)}`; }
  log(`perform seed ${seedS} ${mode}: ${out}`);
}, 300_000);
