// Phase 3a-0 item 1 (continued): evolution history on non-trivial geometry.
//  S3 shell and S4 draft on a filleted plate with a through hole; S5 sweep; S6 loft.
// Criterion (same as phase3-history.mjs): every input face has a destination (Modified / Generated / kept / deleted),
// every output face has a source. Sweep and loft: every profile edge yields >= 1 side face, and the caps are identifiable.
// Run: node spikes/occt-gaps/phase3-real.mjs
import { createInstance } from 'libcascade/single/init';

const oc = await createInstance({ print: () => {}, printErr: () => {} });
const T = oc.TopAbs_ShapeEnum;
const progress = () => new oc.Message_ProgressRange();
const massProps = (s) => {
  const p = new oc.GProp_GProps();
  oc.BRepGProp.VolumeProperties(s, p, false, false, false);
  return p.Mass();
};
const area = (s) => {
  const p = new oc.GProp_GProps();
  oc.BRepGProp.SurfaceProperties(s, p, false, false);
  return p.Mass();
};
const valid = (s) => new oc.BRepCheck_Analyzer(s, true, false, false).IsValid();
const indexOf = (s, type) => {
  const m = new oc.NCollection_IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher();
  oc.TopExp.MapShapes(s, type, m);
  return m;
};
const list = (l) => {
  const out = [];
  const copy = new oc.NCollection_List_TopoDS_Shape(l);
  while (!copy.IsEmpty()) {
    out.push(copy.First());
    copy.RemoveFirst();
  }
  return out;
};
const surfaceType = (f) => String(new oc.BRepAdaptor_Surface(oc.TopoDS.Face(f), true).GetType()).replace('GeomAbs_', '');
const results = [];
const report = (id, name, pass, detail) => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id} ${name} — ${detail}`);
};
const guarded = (id, name, fn) => {
  try {
    fn();
  } catch (e) {
    let msg = String(e);
    try {
      msg = oc.getExceptionMessage(e).join(' / ');
    } catch {}
    report(id, name, false, `例外：${msg}`);
  }
};
const P = (x, y, z = 0) => new oc.gp_Pnt(x, y, z);
const boolean = (Op, a, b) => {
  const op = new Op(a, b, progress());
  op.Build(progress());
  return op.Shape();
};

function mapHistory(input, output, modified, generated, isDeleted) {
  const inFaces = indexOf(input, T.TopAbs_FACE);
  const outFaces = indexOf(output, T.TopAbs_FACE);
  const explained = new Set();
  const lost = [];
  const perType = {};
  for (let i = 1; i <= inFaces.Extent(); i++) {
    const f = inFaces.FindKey(i);
    const mod = list(modified(f)).map((g) => outFaces.FindIndex(g)).filter((k) => k > 0);
    const gen = list(generated(f)).map((g) => outFaces.FindIndex(g)).filter((k) => k > 0);
    const kept = outFaces.FindIndex(f);
    const del = isDeleted(f);
    if (kept > 0) explained.add(kept);
    [...mod, ...gen].forEach((k) => explained.add(k));
    if (!mod.length && !gen.length && kept === 0 && !del) lost.push(`in#${i} ${surfaceType(f)}`);
    const how = mod.length ? 'modified' : gen.length ? 'generated' : kept > 0 ? 'kept' : del ? 'deleted' : 'LOST';
    const key = `${surfaceType(f)}:${how}`;
    perType[key] = (perType[key] ?? 0) + 1;
  }
  const orphans = [];
  for (let k = 1; k <= outFaces.Extent(); k++) if (!explained.has(k)) orphans.push(`out#${k} ${surfaceType(outFaces.FindKey(k))}`);
  return { lost, orphans, nIn: inFaces.Extent(), nOut: outFaces.Extent(), perType };
}
const summary = (h) =>
  `${h.nIn} 面 → ${h.nOut} 面；${Object.entries(h.perType).map(([k, v]) => `${k}×${v}`).join('、')}；輸入面無去處 ${h.lost.length}${h.lost.length ? '（' + h.lost.join('、') + '）' : ''}，結果面無來源 ${h.orphans.length}${h.orphans.length ? '（' + h.orphans.join('、') + '）' : ''}`;

// ---- a realistic plate: 60x40x20, four vertical edges filleted r=5, a through hole d=8 in the middle
function plate() {
  const box = new oc.BRepPrimAPI_MakeBox(P(0, 0, 0), 60, 40, 20).Shape();
  const edges = indexOf(box, T.TopAbs_EDGE);
  const fil = new oc.BRepFilletAPI_MakeFillet(box, oc.ChFi3d_FilletShape.ChFi3d_Rational);
  for (let i = 1; i <= edges.Extent(); i++) {
    const e = oc.TopoDS.Edge(edges.FindKey(i));
    const c = new oc.BRepAdaptor_Curve(e);
    const a = c.Value(c.FirstParameter()), b = c.Value(c.LastParameter());
    if (Math.abs(a.X() - b.X()) < 1e-9 && Math.abs(a.Y() - b.Y()) < 1e-9) fil.Add(5, e); // vertical
  }
  fil.Build(progress());
  const hole = new oc.BRepPrimAPI_MakeCylinder(new oc.gp_Ax2(P(30, 20, -1), new oc.gp_Dir(new oc.gp_Vec(0, 0, 1))), 4, 22).Shape();
  return boolean(oc.BRepAlgoAPI_Cut, fil.Shape(), hole);
}
const planeFaces = (shape, pred) => {
  const out = [];
  const faces = indexOf(shape, T.TopAbs_FACE);
  for (let i = 1; i <= faces.Extent(); i++) {
    const f = faces.FindKey(i);
    const s = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(f), true);
    if (String(s.GetType()) === 'GeomAbs_Plane' && pred(s.Plane())) out.push(f);
  }
  return out;
};
const base = plate();
const baseVol = massProps(base), baseArea = area(base);
console.log(`零件：${indexOf(base, T.TopAbs_FACE).Extent()} 面，體積 ${baseVol.toFixed(2)}，面積 ${baseArea.toFixed(2)}，有效 ${valid(base)}`);

// ---------------------------------------------------------------- S3 shell of the plate: open the top, wall 2 (inward)
guarded('S3', '薄殼：圓角＋通孔的板，開頂面', () => {
  const top = planeFaces(base, (p) => Math.abs(p.Axis().Direction().Z()) > 0.99 && Math.abs(p.Location().Z() - 20) < 1e-9);
  const closing = new oc.NCollection_List_TopoDS_Shape();
  closing.Append(top[0]);
  const mk = new oc.BRepOffsetAPI_MakeThickSolid();
  mk.MakeThickSolidByJoin(base, closing, -2, 1e-4, oc.BRepOffset_Mode.BRepOffset_Skin, false, false, oc.GeomAbs_JoinType.GeomAbs_Intersection, false, progress());
  mk.Build(progress());
  const out = mk.Shape();
  const h = mapHistory(base, out, (f) => mk.Modified(f), (f) => mk.Generated(f), (f) => mk.IsDeleted(f));
  const vol = massProps(out);
  // wall volume ~= (area - opening) * 2 minus corner/curvature effects: only a sanity band
  const est = (baseArea - area(top[0])) * 2;
  report('S3', '薄殼：圓角＋通孔的板，開頂面', mk.IsDone() && valid(out) && h.lost.length === 0 && h.orphans.length === 0 && vol > 0.7 * est && vol < 1.1 * est, `${summary(h)}；體積 ${vol.toFixed(2)}（面積×壁厚 ≈ ${est.toFixed(0)}）；有效 ${valid(out)}`);
});

// ---------------------------------------------------------------- S4 draft: all outer walls (4 planes + 4 fillets, tangent chain) 2 degrees, neutral z=0
guarded('S4', '拔模：圓角板的外壁（切線連續的面組）2°', () => {
  const mk = new oc.BRepOffsetAPI_DraftAngle(base);
  const pull = new oc.gp_Dir(0, 0, 1);
  const neutral = new oc.gp_Pln(P(0, 0, 0), pull);
  const faces = indexOf(base, T.TopAbs_FACE);
  let added = 0, failed = 0;
  // outer walls = side planes with normal in XY; fillet cylinders are drafted through tangent propagation from a plane
  for (const f of planeFaces(base, (p) => Math.abs(p.Axis().Direction().Z()) < 0.1)) {
    mk.Add(oc.TopoDS.Face(f), pull, (2 * Math.PI) / 180, neutral, true);
    if (mk.AddDone()) added++;
    else {
      failed++;
      mk.Remove(oc.TopoDS.Face(f));
    }
  }
  mk.Build(progress());
  const out = mk.Shape();
  const h = mapHistory(base, out, (f) => mk.Modified(f), (f) => mk.Generated(f), (f) => mk.IsDeleted(f));
  const vol = massProps(out);
  report('S4', '拔模：圓角板的外壁（切線連續的面組）2°', mk.IsDone() && failed === 0 && valid(out) && h.lost.length === 0 && h.orphans.length === 0 && vol < baseVol && vol > 0.9 * baseVol, `加入 ${added}、失敗 ${failed}；${summary(h)}；體積 ${baseVol.toFixed(2)} → ${vol.toFixed(2)}；有效 ${valid(out)}`);
});

// ---------------------------------------------------------------- S4b draft the through hole wall too (cylinder → cone)
guarded('S4b', '拔模：通孔的圓柱面 → 圓錐面', () => {
  const mk = new oc.BRepOffsetAPI_DraftAngle(base);
  const pull = new oc.gp_Dir(0, 0, 1);
  const neutral = new oc.gp_Pln(P(0, 0, 0), pull);
  const faces = indexOf(base, T.TopAbs_FACE);
  let target = null;
  for (let i = 1; i <= faces.Extent(); i++) {
    const f = faces.FindKey(i);
    const s = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(f), true);
    if (String(s.GetType()) === 'GeomAbs_Cylinder' && Math.abs(s.Cylinder().Radius() - 4) < 1e-9) target = f;
  }
  mk.Add(oc.TopoDS.Face(target), pull, (2 * Math.PI) / 180, neutral, true);
  const ok = mk.AddDone();
  mk.Build(progress());
  const out = mk.Shape();
  const h = mapHistory(base, out, (f) => mk.Modified(f), (f) => mk.Generated(f), (f) => mk.IsDeleted(f));
  const types = new Set();
  const of = indexOf(out, T.TopAbs_FACE);
  for (let i = 1; i <= of.Extent(); i++) types.add(surfaceType(of.FindKey(i)));
  report('S4b', '拔模：通孔的圓柱面 → 圓錐面', ok && mk.IsDone() && valid(out) && h.lost.length === 0 && h.orphans.length === 0 && types.has('Cone'), `${summary(h)}；結果曲面種類 ${[...types]}；有效 ${valid(out)}`);
});

// ---------------------------------------------------------------- S5 sweep: circle r=2 along a 30 mm line then a quarter arc R=10 (planar path)
guarded('S5', '掃出：圓形輪廓沿「直線 + 四分之一圓弧」', () => {
  const mw = new oc.BRepBuilderAPI_MakeWire();
  const spineEdges = [];
  const line = new oc.BRepBuilderAPI_MakeEdge(P(0, 0, 0), P(30, 0, 0)).Edge();
  mw.Add(line);
  spineEdges.push(line);
  const circ = new oc.gp_Circ(new oc.gp_Ax2(P(30, 10, 0), new oc.gp_Dir(new oc.gp_Vec(0, 0, 1)), new oc.gp_Dir(new oc.gp_Vec(0, -1, 0))), 10);
  const arc = new oc.BRepBuilderAPI_MakeEdge(circ, 0, Math.PI / 2).Edge();
  mw.Add(arc);
  spineEdges.push(arc);
  const spine = mw.Wire();
  // MakeWire.Add() re-locates edges: the edges to query history with are the ones inside the wire, not the ones passed in.
  const spineIdx = indexOf(spine, T.TopAbs_EDGE);
  const spineWireEdges = [];
  for (let i = 1; i <= spineIdx.Extent(); i++) spineWireEdges.push(spineIdx.FindKey(i));
  const pc = new oc.gp_Circ(new oc.gp_Ax2(P(0, 0, 0), new oc.gp_Dir(new oc.gp_Vec(1, 0, 0))), 2);
  const profile = new oc.BRepBuilderAPI_MakeWire(new oc.BRepBuilderAPI_MakeEdge(pc).Edge()).Wire();
  const profileEdge = indexOf(profile, T.TopAbs_EDGE).FindKey(1);
  const mk = new oc.BRepOffsetAPI_MakePipeShell(spine);
  mk.SetMode(false); // corrected Frenet not needed for a planar path; binormal-free
  mk.Add(profile, false, false);
  mk.Build(progress());
  const ok = mk.IsReady() && mk.MakeSolid();
  const out = mk.Shape();
  const expected = Math.PI * 4 * (30 + (Math.PI / 2) * 10);
  const sideOfEdge = list(mk.Generated(profileEdge));
  const sideOfSpine = spineWireEdges.map((e) => list(mk.Generated(e)).length);
  const first = mk.FirstShape(), last = mk.LastShape();
  const faces = indexOf(out, T.TopAbs_FACE);
  report(
    'S5',
    '掃出：圓形輪廓沿「直線 + 四分之一圓弧」',
    ok && valid(out) && Math.abs(massProps(out) - expected) / expected < 1e-6 && sideOfEdge.length >= 1 && !first.IsNull() && !last.IsNull(),
    `體積 ${massProps(out).toFixed(4)}（Pappus ${expected.toFixed(4)}）；${faces.Extent()} 面；輪廓邊產生 ${sideOfEdge.length} 個面；起點蓋 ${first.IsNull() ? '無' : surfaceType(indexOf(first, T.TopAbs_FACE).FindKey(1))}、終點蓋 ${last.IsNull() ? '無' : surfaceType(indexOf(last, T.TopAbs_FACE).FindKey(1))}；脊線邊各產生 ${sideOfSpine} 個面`,
  );
});

// ---------------------------------------------------------------- S6 loft: 20x10 rectangle at z=0 to 10x10 rectangle at z=20 (ruled): volume 3000
guarded('S6', '疊層拉伸：兩個矩形（直紋）', () => {
  const rect = (w, h, z) => {
    const pts = [P(0, 0, z), P(w, 0, z), P(w, h, z), P(0, h, z)];
    const mw = new oc.BRepBuilderAPI_MakeWire();
    const es = [];
    for (let i = 0; i < 4; i++) {
      const e = new oc.BRepBuilderAPI_MakeEdge(pts[i], pts[(i + 1) % 4]).Edge();
      mw.Add(e);
      es.push(e);
    }
    const wire = mw.Wire();
    const wi = indexOf(wire, T.TopAbs_EDGE);
    const wireEdges = [];
    for (let i = 1; i <= wi.Extent(); i++) wireEdges.push(wi.FindKey(i));
    return { wire, edges: wireEdges };
  };
  const a = rect(20, 10, 0), b = rect(10, 10, 20);
  const mk = new oc.BRepOffsetAPI_ThruSections(true, true, 1e-6);
  mk.AddWire(a.wire);
  mk.AddWire(b.wire);
  mk.Build(progress());
  const out = mk.Shape();
  const gen = a.edges.map((e) => list(mk.Generated(e)).length);
  const first = mk.FirstShape(), last = mk.LastShape();
  const faces = indexOf(out, T.TopAbs_FACE);
  report('S6', '疊層拉伸：兩個矩形（直紋）', valid(out) && Math.abs(massProps(out) - 3000) < 1e-6 && gen.every((n) => n >= 1) && !first.IsNull() && !last.IsNull(), `體積 ${massProps(out).toFixed(4)}（手算 3000）；${faces.Extent()} 面；起始截面每條邊產生 ${gen} 個面；首尾蓋 ${first.IsNull() ? '無' : '有'}／${last.IsNull() ? '無' : '有'}`);
});

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
