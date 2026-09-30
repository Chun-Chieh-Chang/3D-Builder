// Phase 3a-0: can "up to next" (成形至下一面) be resolved from geometry alone, so the feature stores only the intent?
// Method: long prism of the profile ∩ body; the body face whose Modified() piece lies nearest the sketch plane is the target.
// Run: node spikes/occt-gaps/phase3-up-to-next.mjs
import { createInstance } from 'libcascade/single/init';

const oc = await createInstance({ print: () => {}, printErr: () => {} });
const T = oc.TopAbs_ShapeEnum;
const pr = () => new oc.Message_ProgressRange();
const P = (x, y, z = 0) => new oc.gp_Pnt(x, y, z);
const idx = (s, t) => { const m = new oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher(); oc.TopExp.MapShapes(s, t, m); return m; };
const list = (l) => { const o = []; const c = new oc.NCollection_List_TopoDS_Shape(l); while (!c.IsEmpty()) { o.push(c.First()); c.RemoveFirst(); } return o; };
const vol = (s) => { const p = new oc.GProp_GProps(); oc.BRepGProp.VolumeProperties(s, p, false, false, false); return p.Mass(); };
const cz = (f) => { const p = new oc.GProp_GProps(); oc.BRepGProp.SurfaceProperties(f, p, false, false); return p.CentreOfMass().Z(); };
const valid = (s) => new oc.BRepCheck_Analyzer(s, true, false, false).IsValid();

// body: a slab 60x60x10 at z 10..20, plus a lower block 20x20x5 at z 30..35 (something further up that must NOT be the target)
const box = (x, y, z, w, d, h) => new oc.BRepPrimAPI_MakeBox(P(x, y, z), w, d, h).Shape();
const fuse = (a, b) => { const op = new oc.BRepAlgoAPI_Fuse(a, b, pr()); op.Build(pr()); return op.Shape(); };
const body = fuse(box(0, 0, 10, 60, 60, 10), box(20, 20, 30, 20, 20, 5));

// profile: 20x20 square at z=0 over (10..30, 10..30): it hits the slab's underside (z=10) first
const mw = new oc.BRepBuilderAPI_MakeWire();
const pts = [P(10, 10), P(30, 10), P(30, 30), P(10, 30)];
for (let i = 0; i < 4; i++) mw.Add(new oc.BRepBuilderAPI_MakeEdge(pts[i], pts[(i + 1) % 4]).Edge());
const face = new oc.BRepBuilderAPI_MakeFace(mw.Wire(), true).Face();
const prism = new oc.BRepPrimAPI_MakePrism(face, new oc.gp_Vec(0, 0, 1000), false, true).Shape();

const common = new oc.BRepAlgoAPI_Common(prism, body, pr());
common.Build(pr());
const faces = idx(body, T.TopAbs_FACE);
let best = null;
for (let i = 1; i <= faces.Extent(); i++) {
  const f = faces.FindKey(i);
  const mods = list(common.Modified(f));
  if (!mods.length) continue;
  const z = Math.min(...mods.map(cz));
  if (best === null || z < best.z) best = { i, z };
}
const targetIsUnderside = best && Math.abs(best.z - 10) < 1e-9;

// build the actual "up to next" result: prism to the target's plane, i.e. cut the long prism with the half-space beyond the target
const target = faces.FindKey(best.i);
const surf = oc.BRep_Tool.Surface(oc.TopoDS.Face(target));
const big = new oc.BRepBuilderAPI_MakeFace(surf, 1e-7).Face();
const keep = new oc.BRepPrimAPI_MakeHalfSpace(big, P(20, 20, 0)).Solid(); // the side containing the sketch plane
const c2 = new oc.BRepAlgoAPI_Common(prism, keep, pr());
c2.Build(pr());
const result = c2.Shape();
const ok = targetIsUnderside && valid(result) && Math.abs(vol(result) - 20 * 20 * 10) < 1e-6;
console.log(`${ok ? 'PASS' : 'FAIL'}  U1 成形至下一面 — 目標面 body#${best.i}（z=${best.z}，${targetIsUnderside ? '是板的底面' : '不是板的底面'}）；結果體積 ${vol(result).toFixed(4)}（手算 4000），有效 ${valid(result)}`);
