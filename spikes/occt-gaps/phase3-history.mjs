// Phase 3a-0 item 1: can the evolution history of MakeThickSolid and DraftAngle drive persistent naming?
// For each result face we ask: which input face did it come from (Modified), or is it new (Generated)?
// A feature is "nameable" when every input face either maps to >=1 result face, or is reported deleted,
// and every result face is either mapped from an input face or generated from one.
// Run: node spikes/occt-gaps/phase3-history.mjs
import { createInstance } from 'libcascade/single/init';

const oc = await createInstance({ print: () => {}, printErr: () => {} });
const T = oc.TopAbs_ShapeEnum;
const progress = () => new oc.Message_ProgressRange();
const volume = (s) => {
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
const results = [];
const report = (id, name, pass, detail) => {
  results.push(pass);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id} ${name} — ${detail}`);
};

// Returns per-input-face description of where it went, plus which result faces nothing explains.
function mapHistory(input, output, modified, generated, isDeleted) {
  const inFaces = indexOf(input, T.TopAbs_FACE);
  const outFaces = indexOf(output, T.TopAbs_FACE);
  const explained = new Set();
  const lines = [];
  let unresolvedInputs = 0;
  for (let i = 1; i <= inFaces.Extent(); i++) {
    const f = inFaces.FindKey(i);
    const mod = list(modified(f)).map((g) => outFaces.FindIndex(g)).filter((k) => k > 0);
    const gen = list(generated(f)).map((g) => outFaces.FindIndex(g)).filter((k) => k > 0);
    const del = isDeleted(f);
    // Untouched faces come back as the very same face; Modified() is empty for them.
    const kept = outFaces.FindIndex(f);
    if (kept > 0) explained.add(kept);
    mod.forEach((k) => explained.add(k));
    gen.forEach((k) => explained.add(k));
    if (mod.length === 0 && gen.length === 0 && !del && kept === 0) unresolvedInputs++;
    lines.push(`    in#${i} ${surfaceType(f)} → modified [${mod}] generated [${gen}]${kept > 0 ? ` kept as out#${kept}` : ''}${del ? ' deleted' : ''}`);
  }
  const unexplainedOutputs = [];
  for (let k = 1; k <= outFaces.Extent(); k++) if (!explained.has(k)) unexplainedOutputs.push(`out#${k} ${surfaceType(outFaces.FindKey(k))}`);
  return { lines, unresolvedInputs, unexplainedOutputs, nOut: outFaces.Extent() };
}

const W = 40, D = 30, H = 20;
const makeBox = () => new oc.BRepPrimAPI_MakeBox(new oc.gp_Pnt(0, 0, 0), W, D, H).Shape();
const topFaceOf = (shape) => {
  const faces = indexOf(shape, T.TopAbs_FACE);
  for (let i = 1; i <= faces.Extent(); i++) {
    const f = faces.FindKey(i);
    const s = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(f), true);
    if (String(s.GetType()) !== 'GeomAbs_Plane') continue;
    const pl = s.Plane();
    const z = pl.Location().Z();
    if (Math.abs(pl.Axis().Direction().Z()) > 0.99 && Math.abs(z - H) < 1e-9) return f;
  }
  throw new Error('no top face');
};

// ---------------------------------------------------------------- S1 shell (thin-wall) — open the top, wall 2 mm inward
{
  const box = makeBox();
  const top = topFaceOf(box);
  const closing = new oc.NCollection_List_TopoDS_Shape();
  closing.Append(top);
  const mk = new oc.BRepOffsetAPI_MakeThickSolid();
  mk.MakeThickSolidByJoin(box, closing, -2, 1e-4, oc.BRepOffset_Mode.BRepOffset_Skin, false, false, oc.GeomAbs_JoinType.GeomAbs_Intersection, false, progress());
  mk.Build(progress());
  const out = mk.Shape();
  const expected = W * D * H - (W - 4) * (D - 4) * (H - 2);
  const h = mapHistory(box, out, (f) => mk.Modified(f), (f) => mk.Generated(f), (f) => mk.IsDeleted(f));
  console.log(h.lines.join('\n'));
  report(
    'S1',
    '薄殼（MakeThickSolid，開口在頂面，壁厚 2）',
    mk.IsDone() && valid(out) && Math.abs(volume(out) - expected) < 1e-6 && h.unresolvedInputs === 0 && h.unexplainedOutputs.length === 0,
    `體積 ${volume(out).toFixed(4)}（手算 ${expected}），結果 ${h.nOut} 面，輸入面沒有去處 ${h.unresolvedInputs} 個，結果面沒有來源 ${h.unexplainedOutputs.length} 個${h.unexplainedOutputs.length ? '：' + h.unexplainedOutputs.join('、') : ''}`,
  );
}

// ---------------------------------------------------------------- S2 draft — four side faces, 3 degrees, neutral plane z = 0, pull +z
{
  const box = makeBox();
  const deg = 3;
  const t = Math.tan((deg * Math.PI) / 180);
  const mk = new oc.BRepOffsetAPI_DraftAngle(box);
  const pull = new oc.gp_Dir(0, 0, 1);
  const neutral = new oc.gp_Pln(new oc.gp_Pnt(0, 0, 0), pull);
  const faces = indexOf(box, T.TopAbs_FACE);
  let added = 0, failed = 0;
  for (let i = 1; i <= faces.Extent(); i++) {
    const f = faces.FindKey(i);
    const pl = new oc.BRepAdaptor_Surface(oc.TopoDS.Face(f), true).Plane();
    if (Math.abs(pl.Axis().Direction().Z()) > 0.5) continue; // top / bottom
    mk.Add(oc.TopoDS.Face(f), pull, (deg * Math.PI) / 180, neutral, true);
    if (mk.AddDone()) added++;
    else {
      failed++;
      mk.Remove(oc.TopoDS.Face(f));
    }
  }
  mk.Build(progress());
  const out = mk.Shape();
  // cross-section (W - 2 z t)(D - 2 z t), integrated 0..H
  const a = 2 * t;
  const expected = W * D * H - (W + D) * a * (H * H) / 2 + a * a * (H * H * H) / 3;
  const h = mapHistory(box, out, (f) => mk.Modified(f), (f) => mk.Generated(f), (f) => mk.IsDeleted(f));
  console.log(h.lines.join('\n'));
  report(
    'S2',
    '拔模（DraftAngle，四個側面 3°，中性面 z=0）',
    mk.IsDone() && failed === 0 && valid(out) && Math.abs(volume(out) - expected) < 1e-6 && h.unresolvedInputs === 0 && h.unexplainedOutputs.length === 0,
    `加入 ${added} 面、失敗 ${failed}；體積 ${volume(out).toFixed(4)}（手算 ${expected.toFixed(4)}）；輸入面沒有去處 ${h.unresolvedInputs} 個，結果面沒有來源 ${h.unexplainedOutputs.length} 個`,
  );
}

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
