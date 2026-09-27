// Workaround experiments for the OCCT binding gaps found in replicad-opencascadejs (see inventory.md).
// Run: node spikes/occt-gaps/workarounds.mjs
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { default: init } = await import(pathToFileURL(require.resolve('replicad-opencascadejs/package.json').replace('package.json', 'dist/replicad_single.js')).href);
const oc = await init({ print: () => {}, printErr: () => {} });
const T = oc.TopAbs_ShapeEnum;
const results = [];
const report = (id, name, pass, detail) => {
  results.push({ id, name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id} ${name} — ${detail}`);
};

// ---------------------------------------------------------------- helpers
const progress = () => new oc.Message_ProgressRange();
const volume = (s) => {
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
const sub = (s, type) => {
  const out = [];
  const seen = [];
  for (const ex = new oc.TopExp_Explorer(s, type, T.TopAbs_SHAPE); ex.More(); ex.Next()) {
    const c = ex.Current();
    if (!seen.some((x) => x.IsSame(c))) {
      seen.push(c);
      out.push(c);
    }
  }
  return out;
};
const box = (x, y, z) => new oc.BRepPrimAPI_MakeBox(x, y, z).Shape();
const cylinder = (r, h, [x, y, z]) =>
  new oc.BRepPrimAPI_MakeCylinder(new oc.gp_Ax2(new oc.gp_Pnt(x, y, z), new oc.gp_Dir(new oc.gp_Vec(0, 0, 1))), r, h).Shape();
const cut = (a, b) => {
  const op = new oc.BRepAlgoAPI_Cut(a, b, progress());
  op.Build(progress());
  return op.Shape();
};
const fuse = (a, b) => {
  const op = new oc.BRepAlgoAPI_Fuse(a, b, progress());
  op.Build(progress());
  return op;
};
const surfaceType = (f) => String(new oc.BRepAdaptor_Surface(oc.TopoDS.Face(f), true).GetType()).replace('GeomAbs_', '');
const writeStep = (doc, path) => {
  const w = new oc.STEPCAFControl_Writer();
  w.SetNameMode(true);
  w.SetColorMode(true);
  return w.Perform(doc, path, progress());
};
const newDoc = () => new oc.TDocStd_Document(new oc.TCollection_ExtendedString('XmlXCAF', false));
const sewToSolid = (shapes, tol) => {
  const sewing = new oc.BRepBuilderAPI_Sewing(tol, true, true, true, false);
  for (const s of shapes) sewing.Add(s);
  sewing.Perform(progress());
  const sewn = sewing.SewedShape();
  const shells = sub(sewn, T.TopAbs_SHELL);
  if (shells.length !== 1) return { solid: null, freeEdges: sewing.NbFreeEdges() };
  const fix = new oc.ShapeFix_Solid();
  const solid = fix.SolidFromShell(oc.TopoDS.Shell(shells[0]));
  return { solid, freeEdges: sewing.NbFreeEdges() };
};

// ---------------------------------------------------------------- E1 color export (F1.1 / C14.2)
{
  const doc = newDoc();
  const st = oc.XCAFDoc_DocumentTool.ShapeTool(doc.Main());
  const label = st.AddShape(box(20, 10, 5), false, true);
  oc.TDataStd_Name.Set(label, new oc.TCollection_ExtendedString('色彩測試', true));
  oc.XCAFDoc_DocumentTool.ColorTool(doc.Main()).SetColor(label, new oc.Quantity_ColorRGBA(0.2, 0.4, 0.8, 1), oc.XCAFDoc_ColorType.XCAFDoc_ColorSurf);
  const ok = writeStep(doc, '/color.step');
  const text = oc.FS.readFile('/color.step', { encoding: 'utf8' });
  const rgb = text.split('\n').find((l) => l.includes('COLOUR_RGB'));
  report('E1', '顏色輸出（Quantity_ColorRGBA）', ok && !!rgb, rgb ? rgb.trim() : '沒有 COLOUR_RGB');
  doc.delete();
}

// ---------------------------------------------------------------- E2 heal: sew faces with a gap into a solid (F2.2)
{
  const faces = sub(box(20, 10, 5), T.TopAbs_FACE);
  const trsf = new oc.gp_Trsf();
  trsf.SetTranslation(new oc.gp_Vec(0, 0, 0.01)); // open a 0.01 mm gap on one face
  faces[5] = new oc.BRepBuilderAPI_Transform(faces[5], trsf, true, false).Shape();
  const { solid, freeEdges } = sewToSolid(faces, 0.05);
  const v = solid ? volume(solid) : 0;
  report('E2', '縫合有縫隙的面成實體（Sewing + ShapeFix_Solid）', !!solid && valid(solid) && Math.abs(v - 1000) < 1, `自由邊 ${freeEdges}，體積 ${v.toFixed(3)}，有效 ${solid ? valid(solid) : false}`);
}

// ---------------------------------------------------------------- E3 import a surface-only STEP and turn it into a solid (F2.1/F2.2)
{
  const faces = sub(box(20, 10, 5), T.TopAbs_FACE);
  const compound = new oc.TopoDS_Compound();
  const builder = new oc.TopoDS_Builder();
  builder.MakeCompound(compound);
  for (const f of faces) builder.Add(compound, f);
  const w = new oc.STEPControl_Writer();
  w.Transfer(compound, oc.STEPControl_StepModelType.STEPControl_AsIs, true, progress());
  w.Write('/faces.step');
  const r = new oc.STEPControl_Reader();
  r.ReadFile('/faces.step');
  r.TransferRoots(progress());
  const imported = r.OneShape();
  const solidsBefore = sub(imported, T.TopAbs_SOLID).length;
  const { solid } = sewToSolid(sub(imported, T.TopAbs_FACE), 1e-3);
  const v = solid ? volume(solid) : 0;
  report('E3', '輸入只有面的 STEP → 實體', solidsBefore === 0 && !!solid && valid(solid) && Math.abs(v - 1000) < 1e-3, `輸入時實體數 ${solidsBefore}，修復後體積 ${v.toFixed(3)}`);
}

// ---------------------------------------------------------------- E4 delete a through hole without Defeaturing (C10.2)
{
  const holed = cut(box(20, 10, 5), cylinder(2, 5, [10, 5, 0]));
  const kept = [];
  for (const f of sub(holed, T.TopAbs_FACE)) {
    if (surfaceType(f) === 'Cylinder') continue; // the hole wall
    const face = oc.TopoDS.Face(f);
    const wires = sub(face, T.TopAbs_WIRE);
    if (wires.length === 1) {
      kept.push(face);
      continue;
    }
    // Rebuild on the same surface with the outer wire only. MakeFace(face, wire) would ADD a wire,
    // so start from the underlying surface; the outer wire bounds the largest area.
    const surface = oc.BRep_Tool.Surface(face);
    const candidates = wires.map((wi) => new oc.BRepBuilderAPI_MakeFace(surface, oc.TopoDS.Wire(wi), true).Face());
    const outer = candidates.reduce((a, b) => (Math.abs(area(a)) >= Math.abs(area(b)) ? a : b));
    const fix = new oc.ShapeFix_Face(outer);
    fix.Perform(progress());
    kept.push(fix.Face());
  }
  const { solid } = sewToSolid(kept, 1e-6);
  const v = solid ? volume(solid) : 0;
  report('E4', '刪除貫穿孔（移除孔面 + 以外框重建面 + 縫合）', !!solid && valid(solid) && Math.abs(v - 1000) < 1e-6, `孔前體積 ${volume(holed).toFixed(3)} → 刪孔後 ${v.toFixed(3)}`);
}

// ---------------------------------------------------------------- E5 move a planar face by push/pull booleans (C10.1)
{
  const b = box(20, 10, 5);
  const top = sub(b, T.TopAbs_FACE).find((f) => {
    const p = new oc.GProp_GProps();
    oc.BRepGProp.SurfaceProperties(f, p, false, false);
    return Math.abs(p.CentreOfMass().Z() - 5) < 1e-9;
  });
  const pulled = fuse(b, new oc.BRepPrimAPI_MakePrism(top, new oc.gp_Vec(0, 0, 2), false, true).Shape()).Shape();
  const pushed = cut(b, new oc.BRepPrimAPI_MakePrism(top, new oc.gp_Vec(0, 0, -2), false, true).Shape());
  const up = new oc.ShapeUpgrade_UnifySameDomain(pulled, true, true, false);
  up.Build();
  const facesAfter = sub(up.Shape(), T.TopAbs_FACE).length;
  report(
    'E5',
    '移動平面（布林推拉，側面需與移動方向平行）',
    Math.abs(volume(pulled) - 1400) < 1e-6 && Math.abs(volume(pushed) - 600) < 1e-6 && facesAfter === 6,
    `+2 mm → ${volume(pulled).toFixed(3)}、−2 mm → ${volume(pushed).toFixed(3)}，合併共面後 ${facesAfter} 面`,
  );
}

// ---------------------------------------------------------------- E6 naming across UnifySameDomain without History (TNP)
{
  const op = fuse(box(10, 10, 5), new oc.BRepPrimAPI_MakeBox(new oc.gp_Pnt(10, 0, 0), 10, 10, 5).Shape());
  const fused = op.Shape();
  const before = sub(fused, T.TopAbs_FACE);
  const up = new oc.ShapeUpgrade_UnifySameDomain(fused, true, true, false);
  up.Build();
  const after = sub(up.Shape(), T.TopAbs_FACE);
  let historyUsable = false;
  try {
    const h = up.History();
    historyUsable = !!h && typeof h.Modified === 'function';
  } catch {
    historyUsable = false;
  }
  // Geometric mapping: each input face's centroid lies on exactly one output face.
  const t0 = performance.now();
  const map = before.map((f) => {
    const p = new oc.GProp_GProps();
    oc.BRepGProp.SurfaceProperties(f, p, false, false);
    const vtx = new oc.BRepBuilderAPI_MakeVertex(p.CentreOfMass()).Vertex();
    const hits = after.flatMap((g, j) => {
      const d = new oc.BRepExtrema_DistShapeShape(vtx, g); // Extrema_ExtFlag is not bound; defaults = MINMAX
      return d.IsDone() && d.Value() < 1e-6 ? [j] : [];
    });
    return hits;
  });
  const ms = performance.now() - t0;
  const unique = map.every((h) => h.length === 1);
  report(
    'E6',
    '合併共面後的面對應（UnifySameDomain 沒有可用的 History）',
    !historyUsable && unique && after.length === 6,
    `History 可用：${historyUsable}；合併前 ${before.length} 面 → 後 ${after.length} 面；以質心幾何對應全部唯一：${unique}（${ms.toFixed(1)} ms）`,
  );
}

// ---------------------------------------------------------------- E7 assembly import without STEPCAFControl_Reader (F2.8)
{
  const doc = newDoc();
  const st = oc.XCAFDoc_DocumentTool.ShapeTool(doc.Main());
  const asm = st.NewShape();
  oc.TDataStd_Name.Set(asm, new oc.TCollection_ExtendedString('治具組合件', true));
  const plate = st.AddShape(box(100, 60, 10), false, true);
  oc.TDataStd_Name.Set(plate, new oc.TCollection_ExtendedString('基板', true));
  const pin = st.AddShape(cylinder(3, 20, [0, 0, 0]), false, true);
  oc.TDataStd_Name.Set(pin, new oc.TCollection_ExtendedString('定位銷', true));
  const loc = (x, y, z) => {
    const t = new oc.gp_Trsf();
    t.SetTranslation(new oc.gp_Vec(x, y, z));
    return new oc.TopLoc_Location(t);
  };
  st.AddComponent(asm, plate, loc(0, 0, 0));
  st.AddComponent(asm, pin, loc(20, 20, 10));
  st.AddComponent(asm, pin, loc(80, 40, 10));
  st.UpdateAssemblies();
  writeStep(doc, '/asm.step');
  const text = oc.FS.readFile('/asm.step', { encoding: 'utf8' });
  const r = new oc.STEPControl_Reader();
  r.ReadFile('/asm.step');
  r.TransferRoots(progress());
  const shape = r.OneShape();
  const solids = sub(shape, T.TopAbs_SOLID).length;
  const names = [...text.matchAll(/PRODUCT\('([^']*)'/g)].map((m) => m[1]);
  const expectedVolume = 100 * 60 * 10 + 2 * Math.PI * 9 * 20;
  report(
    'E7',
    '組合件 STEP 輸入（只有 STEPControl_Reader）',
    false,
    `幾何可讀：實體 ${solids}、總體積 ${volume(shape).toFixed(1)}（應為 ${expectedVolume.toFixed(1)}）；名稱與階層不會進入形狀，只能自行解析 STEP 文字（PRODUCT：${names.join('、')}），且無法可靠對應到實例 → 需要 STEPCAFControl_Reader`,
  );
  doc.delete();
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} workarounds validated`);
