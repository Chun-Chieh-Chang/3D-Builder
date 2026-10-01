// Closed path variants for MakePipeShell: why is the volume 0? Run: node spikes/occt-gaps/phase3-sweep-closed.mjs
import { createInstance } from 'libcascade/single/init';
const oc = await createInstance({ print: () => {}, printErr: () => {} });
const T = oc.TopAbs_ShapeEnum;
const progress = () => new oc.Message_ProgressRange();
const volume = (s) => { const p = new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(s, p, false, false, false); return p.Mass(); };
const valid = (s) => new oc.BRepCheck_Analyzer(s, true, false, false).IsValid();
const P = (x, y, z = 0) => new oc.gp_Pnt(x, y, z);
const D = (x, y, z) => new oc.gp_Dir(new oc.gp_Vec(x, y, z));
const edge = new oc.BRepBuilderAPI_MakeEdge(new oc.gp_Circ(new oc.gp_Ax2(P(0, 0, 0), D(0, 0, 1), D(1, 0, 0)), 15)).Edge();
const spine = new oc.BRepBuilderAPI_MakeWire(edge).Wire();
const pts = [[-2, -2], [2, -2], [2, 2], [-2, 2]];
const mw = new oc.BRepBuilderAPI_MakeWire();
pts.forEach((p, i) => { const q = pts[(i + 1) % 4]; mw.Add(new oc.BRepBuilderAPI_MakeEdge(P(15, p[0], p[1]), P(15, q[0], q[1])).Edge()); });
const profile = mw.Wire();
const show = (label, mk) => {
  const out = mk.Shape();
  console.log(label, 'type', String(out.ShapeType()), 'valid', valid(out), 'volume', volume(out).toFixed(4));
  return out;
};
for (const mode of ['none', 'corrected', 'frenet']) {
  const mk = new oc.BRepOffsetAPI_MakePipeShell(spine);
  if (mode === 'corrected') mk.SetMode(false);
  if (mode === 'frenet') mk.SetMode(true);
  mk.Add(profile, false, false);
  mk.Build(progress());
  const made = mk.MakeSolid();
  console.log(mode, 'ready', mk.IsReady(), 'makeSolid', made);
  show('  ' + mode, mk);
}
// profile reversed (the other way round)
{
  const mk = new oc.BRepOffsetAPI_MakePipeShell(spine);
  mk.SetMode(false);
  mk.Add(oc.TopoDS.Wire(profile.Reversed()), false, false);
  mk.Build(progress());
  mk.MakeSolid();
  show('  reversed profile', mk);
}
// shape fix: shell -> solid
{
  const mk = new oc.BRepOffsetAPI_MakePipeShell(spine);
  mk.SetMode(false);
  mk.Add(profile, false, false);
  mk.Build(progress());
  const raw = mk.Shape();
  console.log('  raw type', String(raw.ShapeType()));
  const exp = new oc.TopExp_Explorer(raw, T.TopAbs_SHELL, T.TopAbs_SHAPE);
  console.log('  has shell', exp.More());
  if (exp.More()) {
    const fix = new oc.ShapeFix_Solid();
    const solid = fix.SolidFromShell(oc.TopoDS.Shell(exp.Current()));
    console.log('  SolidFromShell volume', volume(solid).toFixed(4), 'valid', valid(solid));
  }
}
