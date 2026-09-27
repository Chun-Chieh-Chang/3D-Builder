// Validates the full libcascade 3.0.2 build (OCCT 8.0.1) as a replacement for replicad-opencascadejs:
// closes the gaps from ADR 0003, checks API compatibility, and measures init + mesh extraction.
// Run: node spikes/occt-gaps/libcascade.mjs
import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const results = [];
const report = (id, name, pass, detail) => {
  results.push({ id, name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${id} ${name} — ${detail}`);
};
const time = (fn) => {
  const t = performance.now();
  const value = fn();
  return [value, performance.now() - t];
};

// ---------------------------------------------------------------- L0 init
const wasmPath = require.resolve('libcascade/single/wasm');
let t0 = performance.now();
const { createInstance } = await import('libcascade/single/init');
const oc = await createInstance({ print: () => {}, printErr: () => {} });
report('L0', '初始化', true, `WASM ${(statSync(wasmPath).size / 1e6).toFixed(1)} MB，初始化 ${(performance.now() - t0).toFixed(0)} ms`);

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
const box = (x, y, z, at = [0, 0, 0]) => new oc.BRepPrimAPI_MakeBox(new oc.gp_Pnt(...at), x, y, z).Shape();
const cylinder = (r, h, [x, y, z]) =>
  new oc.BRepPrimAPI_MakeCylinder(new oc.gp_Ax2(new oc.gp_Pnt(x, y, z), new oc.gp_Dir(new oc.gp_Vec(0, 0, 1))), r, h).Shape();
const boolean = (Op, a, b) => {
  const op = new Op(a, b, progress());
  op.Build(progress());
  return op;
};
const surfaceType = (f) => String(new oc.BRepAdaptor_Surface(oc.TopoDS.Face(f), true).GetType()).replace('GeomAbs_', '');

// ---------------------------------------------------------------- L1 API compatibility with @3db/kernel usage
{
  const checks = [];
  const mw = new oc.BRepBuilderAPI_MakeWire();
  const P = (x, y) => new oc.gp_Pnt(x, y, 0);
  const pts = [P(0, 0), P(20, 0), P(20, 10), P(0, 10)];
  const edges = [];
  for (let i = 0; i < 4; i++) {
    mw.Add(new oc.BRepBuilderAPI_MakeEdge(pts[i], pts[(i + 1) % 4]).Edge());
    edges.push(mw.Edge());
  }
  const face = new oc.BRepBuilderAPI_MakeFace(mw.Wire(), true).Face();
  const prism = new oc.BRepPrimAPI_MakePrism(face, new oc.gp_Vec(0, 0, 5), false, true);
  prism.Build(progress());
  const solid = prism.Shape();
  checks.push(['MakePrism + Generated', list(prism.Generated(edges[1])).length === 1]);
  checks.push(['FirstShape/LastShape', !prism.FirstShape().IsNull() && !prism.LastShape().IsNull()]);
  const eIdx = indexOf(solid, T.TopAbs_EDGE);
  checks.push(['IndexedMap + TopExp.MapShapes', eIdx.Extent() === 12]);
  const fil = new oc.BRepFilletAPI_MakeFillet(solid, oc.ChFi3d_FilletShape.ChFi3d_Rational);
  fil.Add(2, oc.TopoDS.Edge(eIdx.FindKey(1)));
  fil.Build(progress());
  checks.push(['MakeFillet', fil.IsDone()]);
  let exceptionDecoded = false;
  try {
    const bad = new oc.BRepFilletAPI_MakeFillet(solid, oc.ChFi3d_FilletShape.ChFi3d_Rational);
    bad.Add(50, oc.TopoDS.Edge(eIdx.FindKey(1)));
    bad.Build(progress());
    exceptionDecoded = !bad.IsDone();
  } catch (e) {
    exceptionDecoded = Array.isArray(oc.getExceptionMessage(e));
  }
  checks.push(['失敗的圓角可偵測', exceptionDecoded]);
  checks.push(['FS + wasmMemory 匯出', typeof oc.FS?.readFile === 'function' && oc.wasmMemory instanceof WebAssembly.Memory]);
  checks.push(['GeomAbs 列舉為字串', surfaceType(indexOf(solid, T.TopAbs_FACE).FindKey(1)) === 'Plane']);
  const failed = checks.filter(([, ok]) => !ok).map(([n]) => n);
  report('L1', '與 @3db/kernel 用法相容', failed.length === 0, failed.length ? `不相容：${failed.join('、')}` : checks.map(([n]) => n).join('、'));
}

// ---------------------------------------------------------------- G1 assembly import with names, structure, locations
{
  const doc = new oc.TDocStd_Document(new oc.TCollection_ExtendedString('MDTV-XCAF', false));
  const st = oc.XCAFDoc_DocumentTool.ShapeTool(doc.Main());
  const asm = st.NewShape();
  const name = (label, n) => oc.TDataStd_Name.Set(label, new oc.TCollection_ExtendedString(n, true));
  name(asm, '治具組合件');
  const plate = st.AddShape(box(100, 60, 10), false, true);
  name(plate, '基板');
  const pin = st.AddShape(cylinder(3, 20, [0, 0, 0]), false, true);
  name(pin, '定位銷');
  const loc = (x, y, z) => {
    const t = new oc.gp_Trsf();
    t.SetTranslation(new oc.gp_Vec(x, y, z));
    return new oc.TopLoc_Location(t);
  };
  st.AddComponent(asm, plate, loc(0, 0, 0));
  st.AddComponent(asm, pin, loc(20, 20, 10));
  st.AddComponent(asm, pin, loc(80, 40, 10));
  st.UpdateAssemblies();
  const w = new oc.STEPCAFControl_Writer();
  w.SetNameMode(true);
  w.Perform(doc, '/asm.step', progress());

  const r = new oc.STEPCAFControl_Reader();
  r.SetNameMode(true);
  r.SetColorMode(true);
  const read = r.ReadFile('/asm.step');
  const back = new oc.TDocStd_Document(new oc.TCollection_ExtendedString('MDTV-XCAF', false));
  const transferred = r.Transfer(back, progress());
  const tool = oc.XCAFDoc_DocumentTool.ShapeTool(back.Main());
  const nameOf = (label) => {
    const found = label.FindAttribute(oc.TDataStd_Name.GetID());
    // ToExtString()/Value() return char16_t (unbound); the two-argument AsciiString overload converts to UTF-8.
    return found.returnValue && typeof found.anAttribute.Get === 'function' ? new oc.TCollection_AsciiString(found.anAttribute.Get(), '\0').ToCString() : null;
  };
  const roots = new oc.NCollection_Sequence_TDF_Label();
  tool.GetFreeShapes(roots);
  const root = roots.Value(1);
  const comps = new oc.NCollection_Sequence_TDF_Label();
  oc.XCAFDoc_ShapeTool.GetComponents(root, comps, false);
  const items = [];
  for (let i = 1; i <= comps.Length(); i++) {
    const c = comps.Value(i);
    const ref = new oc.TDF_Label();
    oc.XCAFDoc_ShapeTool.GetReferredShape(c, ref);
    const xyz = oc.XCAFDoc_ShapeTool.GetLocation(c).Transformation().TranslationPart();
    items.push(`${nameOf(ref)}@(${xyz.X()},${xyz.Y()},${xyz.Z()})`);
  }
  const ok =
    String(read) === 'IFSelect_RetDone' &&
    transferred &&
    nameOf(root) === '治具組合件' &&
    oc.XCAFDoc_ShapeTool.IsAssembly(root) &&
    items.join() === '基板@(0,0,0),定位銷@(20,20,10),定位銷@(80,40,10)';
  report('G1', '組合件 STEP 輸入（STEPCAFControl_Reader）', ok, `根：${nameOf(root)}，零組件：${items.join('、')}`);
  doc.delete();
  back.delete();
}

// ---------------------------------------------------------------- G2 general healing with ShapeFix_Shape
{
  const faces = [];
  const fIdx = indexOf(box(20, 10, 5), T.TopAbs_FACE);
  for (let i = 1; i <= fIdx.Extent(); i++) faces.push(fIdx.FindKey(i));
  const shell = new oc.TopoDS_Shell();
  const builder = new oc.TopoDS_Builder();
  builder.MakeShell(shell);
  faces.forEach((f, i) => builder.Add(shell, i === 0 ? f.Reversed() : f)); // one face flipped: inconsistent shell
  const solid = new oc.TopoDS_Solid();
  builder.MakeSolid(solid);
  builder.Add(solid, shell);
  const before = valid(solid);
  const fix = new oc.ShapeFix_Shape(solid);
  fix.Perform(progress());
  const fixed = fix.Shape();
  report('G2', '整體修復（ShapeFix_Shape）', !before && valid(fixed) && Math.abs(volume(fixed) - 1000) < 1e-6, `修復前有效 ${before} → 修復後有效 ${valid(fixed)}，體積 ${volume(fixed).toFixed(3)}`);
}

// ---------------------------------------------------------------- G3 defeaturing: remove fillet face and a hole, with history
{
  const b = box(20, 10, 5);
  const eIdx = indexOf(b, T.TopAbs_EDGE);
  const fil = new oc.BRepFilletAPI_MakeFillet(b, oc.ChFi3d_FilletShape.ChFi3d_Rational);
  fil.Add(2, oc.TopoDS.Edge(eIdx.FindKey(1)));
  fil.Build(progress());
  const rounded = fil.Shape();
  const withHole = boolean(oc.BRepAlgoAPI_Cut, rounded, cylinder(1.5, 5, [10, 5, 0])).Shape();
  const fIdx = indexOf(withHole, T.TopAbs_FACE);
  const df = new oc.BRepAlgoAPI_Defeaturing();
  df.SetShape(withHole);
  df.SetToFillHistory(true);
  let removed = 0;
  for (let i = 1; i <= fIdx.Extent(); i++) {
    const f = fIdx.FindKey(i);
    if (surfaceType(f) === 'Cylinder') {
      df.AddFaceToRemove(f);
      removed++;
    }
  }
  df.Build(progress());
  const out = df.Shape();
  const modified = list(df.Modified(fIdx.FindKey(1))).length;
  report(
    'G3',
    '刪除面：圓角面與鑽孔（BRepAlgoAPI_Defeaturing）',
    !df.HasErrors() && valid(out) && Math.abs(volume(out) - 1000) < 1e-6,
    `移除 ${removed} 個圓柱面：${volume(withHole).toFixed(3)} → ${volume(out).toFixed(3)}，有歷史：${modified >= 0}`,
  );
}

// ---------------------------------------------------------------- G4 UnifySameDomain history for naming
{
  const fused = boolean(oc.BRepAlgoAPI_Fuse, box(10, 10, 5), box(10, 10, 5, [10, 0, 0])).Shape();
  const before = indexOf(fused, T.TopAbs_FACE);
  const up = new oc.ShapeUpgrade_UnifySameDomain(fused, true, true, false);
  up.Build();
  const after = indexOf(up.Shape(), T.TopAbs_FACE);
  const h = up.History();
  let mapped = 0;
  for (let i = 1; i <= before.Extent(); i++) {
    const f = before.FindKey(i);
    const mod = list(h.Modified(f));
    const target = mod.length > 0 ? mod : [f];
    if (target.every((g) => after.FindIndex(g) > 0)) mapped++;
  }
  report('G4', '合併共面後以 BRepTools_History 對應面', mapped === before.Extent() && after.Extent() === 6, `${before.Extent()} 面 → ${after.Extent()} 面，${mapped}/${before.Extent()} 由歷史對應`);
}

// ---------------------------------------------------------------- G5 IGES round trip
{
  const b = box(20, 10, 5);
  const w = new oc.IGESControl_Writer('MM', 1);
  w.AddShape(b, progress());
  w.ComputeModel();
  const written = w.Write('/part.igs', false);
  const r = new oc.IGESControl_Reader();
  const read = r.ReadFile('/part.igs');
  r.TransferRoots(progress());
  const shape = r.OneShape();
  const faces = indexOf(shape, T.TopAbs_FACE).Extent();
  report('G5', 'IGES 輸出/輸入', written && String(read) === 'IFSelect_RetDone' && faces === 6, `寫出 ${written}，讀回 ${faces} 個面（IGES 讀回為曲面，需再縫合成實體）`);
}

// ---------------------------------------------------------------- G6 sRGB color export
{
  const doc = new oc.TDocStd_Document(new oc.TCollection_ExtendedString('MDTV-XCAF', false));
  const label = oc.XCAFDoc_DocumentTool.ShapeTool(doc.Main()).AddShape(box(1, 1, 1), false, true);
  const color = new oc.Quantity_Color(0.2, 0.4, 0.8, oc.Quantity_TypeOfColor.Quantity_TOC_sRGB);
  oc.XCAFDoc_DocumentTool.ColorTool(doc.Main()).SetColor(label, color, oc.XCAFDoc_ColorType.XCAFDoc_ColorSurf);
  const w = new oc.STEPCAFControl_Writer();
  w.SetColorMode(true);
  w.Perform(doc, '/c.step', progress());
  const line = oc.FS.readFile('/c.step', { encoding: 'utf8' }).split('\n').find((l) => l.includes('COLOUR_RGB')) ?? '';
  const values = (line.match(/[\d.]+(?=[,)])/g) ?? []).map(Number).slice(-3);
  report('G6', '以 sRGB 指定顏色（Quantity_TOC_sRGB）', values.length === 3 && values.every((v, i) => Math.abs(v - [0.2, 0.4, 0.8][i]) < 1e-3), line.trim());
  doc.delete();
}

// ---------------------------------------------------------------- M1 mesh extraction: TS loop (libcascade) vs C++ bulk (replicad)
function fixturePlate(o) {
  let plate = new o.BRepPrimAPI_MakeBox(200, 150, 20).Shape();
  const holes = new o.TopoDS_Compound();
  const b = new o.TopoDS_Builder();
  b.MakeCompound(holes);
  for (let i = 0; i < 10; i++)
    for (let j = 0; j < 8; j++)
      b.Add(holes, new o.BRepPrimAPI_MakeCylinder(new o.gp_Ax2(new o.gp_Pnt(15 + i * 19, 12 + j * 18, 0), new o.gp_Dir(new o.gp_Vec(0, 0, 1))), 3, 20).Shape());
  const cut = new o.BRepAlgoAPI_Cut(plate, holes, new o.Message_ProgressRange());
  cut.Build(new o.Message_ProgressRange());
  return cut.Shape();
}
{
  const plate = fixturePlate(oc);
  const [, meshMs] = time(() => new oc.BRepMesh_IncrementalMesh(plate, 0.05, false, 0.25, false));
  const [counts, extractMs] = time(() => {
    const fIdx = indexOf(plate, T.TopAbs_FACE);
    const positions = [];
    const indices = [];
    for (let i = 1; i <= fIdx.Extent(); i++) {
      const face = oc.TopoDS.Face(fIdx.FindKey(i));
      const loc = new oc.TopLoc_Location();
      const tri = oc.BRep_Tool.Triangulation(face, loc, 0);
      if (!tri || tri.IsNull?.()) continue;
      const trsf = loc.Transformation();
      const base = positions.length / 3;
      for (let n = 1; n <= tri.NbNodes(); n++) {
        const p = tri.Node(n).Transformed(trsf);
        positions.push(p.X(), p.Y(), p.Z());
      }
      const reversed = face.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED;
      for (let k = 1; k <= tri.NbTriangles(); k++) {
        const { theN1, theN2, theN3 } = tri.Triangle(k).Get();
        indices.push(base + theN1 - 1, base + (reversed ? theN3 : theN2) - 1, base + (reversed ? theN2 : theN3) - 1);
      }
    }
    return { vertices: positions.length / 3, triangles: indices.length / 3 };
  });

  const { default: rinit } = await import(pathToFileURL(require.resolve('replicad-opencascadejs/package.json').replace('package.json', 'dist/replicad_single.js')).href);
  const rc = await rinit({ print: () => {}, printErr: () => {} });
  const rplate = fixturePlate(rc);
  const [md, rMs] = time(() => rc.ReplicadMeshExtractor.extract(rplate, 0.05, 0.25, false));
  report(
    'M1',
    '網格擷取效能：80 孔治具板',
    extractMs < 1000,
    `libcascade：網格化 ${meshMs.toFixed(0)} ms + TS 逐點擷取 ${extractMs.toFixed(0)} ms（${counts.vertices} 頂點 / ${counts.triangles} 三角形）；replicad C++ 批次擷取（含網格化）${rMs.toFixed(0)} ms（${md.getTrianglesSize() / 3} 三角形）`,
  );
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
