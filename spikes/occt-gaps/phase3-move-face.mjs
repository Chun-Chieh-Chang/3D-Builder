// Phase 3a-0 item 2: C10.1 "move face" without BRepOffset_MakeOffset (ADR 0003).
// Approach under test ("extended slab"): to move planar face F by d along its outward normal n,
//   slab = (big face on F's plane, swept by d along n)  ∩  half-space(inner side) of every face adjacent to F, each extended to its full surface.
//   d > 0: result = solid ∪ slab;  d < 0: result = solid − slab.
// The neighbours are extended (or trimmed) along their own surfaces, so slanted walls stay slanted.
// Run: node spikes/occt-gaps/phase3-move-face.mjs
import { createInstance } from 'libcascade/single/init';

const oc = await createInstance({ print: () => {}, printErr: () => {} });
const T = oc.TopAbs_ShapeEnum;
const progress = () => new oc.Message_ProgressRange();
const vol = (s) => {
  const p = new oc.GProp_GProps();
  oc.BRepGProp.VolumeProperties(s, p, false, false, false);
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
const P = (x, y, z = 0) => new oc.gp_Pnt(x, y, z);
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
const bool = (Op, a, b) => {
  const op = new Op(a, b, progress());
  op.Build(progress());
  return op;
};

// Faces sharing an edge with `face`
function neighbours(shape, face) {
  const edgeToFaces = new oc.NCollection_IndexedDataMap_TopoDS_Shape_NCollection_List_TopoDS_Shape_TopTools_ShapeMapHasher();
  oc.TopExp.MapShapesAndAncestors(shape, T.TopAbs_EDGE, T.TopAbs_FACE, edgeToFaces);
  const out = [];
  const seen = new Set();
  const edges = indexOf(face, T.TopAbs_EDGE);
  const faces = indexOf(shape, T.TopAbs_FACE);
  for (let i = 1; i <= edges.Extent(); i++) {
    const idx = edgeToFaces.FindIndex(edges.FindKey(i));
    if (idx === 0) continue;
    for (const g of list(edgeToFaces.FindFromIndex(idx))) {
      const k = faces.FindIndex(g);
      if (k > 0 && !g.IsSame(face) && !seen.has(k)) {
        seen.add(k);
        out.push(g);
      }
    }
  }
  return out;
}

// unbounded half-space of face g's surface that contains `inside`
function halfSpace(g, inside) {
  const surf = oc.BRep_Tool.Surface(oc.TopoDS.Face(g));
  const big = new oc.BRepBuilderAPI_MakeFace(surf, 1e-7).Face();
  return new oc.BRepPrimAPI_MakeHalfSpace(big, inside).Solid();
}

function moveFace(shape, face, d) {
  // The slab lies next to F, so it is on F's side of every neighbour surface: correct for convex edges (F on the material side)
  // and for concave edges (F on the far side). A point of F itself picks that side.
  const props = new oc.GProp_GProps();
  oc.BRepGProp.SurfaceProperties(face, props, false, false);
  const inside = props.CentreOfMass();
  const s = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(face), true);
  const pl = s.Plane();
  // outward normal from the surface derivatives (ADR 0012: never trust the reported axis direction)
  const p = new oc.gp_Pnt(), du = new oc.gp_Vec(), dv = new oc.gp_Vec();
  const u = (s.FirstUParameter() + s.LastUParameter()) / 2, v = (s.FirstVParameter() + s.LastVParameter()) / 2;
  s.D1(u, v, p, du, dv);
  let n = du.Crossed(dv);
  n.Normalize();
  if (face.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED) n = n.Reversed();
  const L = 1000;
  const bigPlane = new oc.BRepBuilderAPI_MakeFace(pl, -L, L, -L, L).Face();
  const dir = n.Multiplied(d);
  const slab0 = new oc.BRepPrimAPI_MakePrism(bigPlane, dir, false, true).Shape();
  let slab = slab0;
  for (const g of neighbours(shape, face)) slab = bool(oc.BRepAlgoAPI_Common, slab, halfSpace(g, inside)).Shape();
  const op = bool(d > 0 ? oc.BRepAlgoAPI_Fuse : oc.BRepAlgoAPI_Cut, shape, slab);
  const merged = new oc.ShapeUpgrade_UnifySameDomain(op.Shape(), true, true, false);
  merged.Build();
  return merged.Shape();
}

const faceAt = (shape, pred) => {
  const faces = indexOf(shape, T.TopAbs_FACE);
  for (let i = 1; i <= faces.Extent(); i++) {
    const f = faces.FindKey(i);
    const s = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(f), true);
    if (String(s.GetType()) === 'GeomAbs_Plane' && pred(s.Plane())) return f;
  }
  throw new Error('face not found');
};
const isTop = (z) => (pl) => Math.abs(pl.Axis().Direction().Z()) > 0.99 && Math.abs(pl.Location().Z() - z) < 1e-6;
const W = 40, D = 30, H = 20;

// ---------------------------------------------------------------- M1 box, perpendicular neighbours: move the top by +5 and −5
for (const d of [5, -5]) {
  guarded(`M1${d > 0 ? 'a' : 'b'}`, `方塊頂面移動 ${d > 0 ? '+' : ''}${d}`, () => {
    const box = new oc.BRepPrimAPI_MakeBox(P(0, 0, 0), W, D, H).Shape();
    const out = moveFace(box, faceAt(box, isTop(H)), d);
    const expected = W * D * (H + d);
    const nf = indexOf(out, T.TopAbs_FACE).Extent();
    report(`M1${d > 0 ? 'a' : 'b'}`, `方塊頂面移動 ${d > 0 ? '+' : ''}${d}`, valid(out) && Math.abs(vol(out) - expected) < 1e-6 && nf === 6, `體積 ${vol(out).toFixed(4)}（手算 ${expected}），${nf} 面，有效 ${valid(out)}`);
  });
}

// ---------------------------------------------------------------- M2 drafted box (walls slanted 3°): moving the top must keep the slant
{
  const deg = 3, t = Math.tan((deg * Math.PI) / 180);
  const mkDraftBox = () => {
    const box = new oc.BRepPrimAPI_MakeBox(P(0, 0, 0), W, D, H).Shape();
    const mk = new oc.BRepOffsetAPI_DraftAngle(box);
    const pull = new oc.gp_Dir(0, 0, 1);
    const neutral = new oc.gp_Pln(P(0, 0, 0), pull);
    const faces = indexOf(box, T.TopAbs_FACE);
    for (let i = 1; i <= faces.Extent(); i++) {
      const f = faces.FindKey(i);
      if (Math.abs(new oc.BRepAdaptor_Surface(oc.TopoDS.Face(f), true).Plane().Axis().Direction().Z()) > 0.5) continue;
      mk.Add(oc.TopoDS.Face(f), pull, (deg * Math.PI) / 180, neutral, true);
    }
    mk.Build(progress());
    return mk.Shape();
  };
  const volAt = (h) => {
    // ∫0..h (W − 2zt)(D − 2zt) dz
    const a = 2 * t;
    return W * D * h - ((W + D) * a * h * h) / 2 + (a * a * h * h * h) / 3;
  };
  for (const d of [5, -5]) {
    guarded(`M2${d > 0 ? 'a' : 'b'}`, `拔模方塊頂面移動 ${d > 0 ? '+' : ''}${d}`, () => {
      const dbox = mkDraftBox();
      const top = faceAt(dbox, isTop(H));
      const out = moveFace(dbox, top, d);
      const expected = volAt(H + d);
      const nf = indexOf(out, T.TopAbs_FACE).Extent();
      report(`M2${d > 0 ? 'a' : 'b'}`, `拔模方塊頂面移動 ${d > 0 ? '+' : ''}${d}`, valid(out) && Math.abs(vol(out) - expected) < 1e-4 && nf === 6, `體積 ${vol(out).toFixed(4)}（手算 ${expected.toFixed(4)}），${nf} 面，有效 ${valid(out)}`);
    });
  }
}

// ---------------------------------------------------------------- M3 moving a side face of an L-shaped block (concave corner): neighbours on both sides
guarded('M3', 'L 形塊：移動內側的立面 +3（凹角）', () => {
  // L = 40x30x20 block minus a 20x15x20 corner
  const box = new oc.BRepPrimAPI_MakeBox(P(0, 0, 0), 40, 30, 20).Shape();
  const notch = new oc.BRepPrimAPI_MakeBox(P(20, 15, -1), 30, 20, 22).Shape();
  const L = bool(oc.BRepAlgoAPI_Cut, box, notch).Shape();
  // the inner wall facing +x at x = 20 (normal +x, i.e. the notch's left wall) — moving it +3 in its outward normal (+x) removes material? outward normal of the L there points +x (into the notch), so +3 GROWS the block
  const wall = faceAt(L, (pl) => Math.abs(Math.abs(pl.Axis().Direction().X()) - 1) < 1e-9 && Math.abs(pl.Location().X() - 20) < 1e-6);
  const out = moveFace(L, wall, 3);
  const expected = 40 * 30 * 20 - 20 * 15 * 20 + 3 * 15 * 20;
  report('M3', 'L 形塊：移動內側的立面 +3（凹角）', valid(out) && Math.abs(vol(out) - expected) < 1e-6, `體積 ${vol(out).toFixed(4)}（手算 ${expected}），${indexOf(out, T.TopAbs_FACE).Extent()} 面，有效 ${valid(out)}`);
});

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
