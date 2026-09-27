// OCCT binding inventory: which classes the blueprint phases need vs. what each WASM build exposes.
// Run: node spikes/occt-gaps/inventory.mjs  (writes spikes/occt-gaps/inventory.md)
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const read = (pkg, file) => readFileSync(join(dirname(require.resolve(`${pkg}/package.json`)), file), 'utf8');

/** Each build declares bound classes differently in its .d.ts. */
const BUILDS = [
  { name: 'replicad-opencascadejs 1.1.0', dts: read('replicad-opencascadejs', 'dist/replicad_single.d.ts'), has: (d, c) => new RegExp(`^export declare class ${c}[ <]`, 'm').test(d) },
  { name: 'libcascade 3.0.2', dts: read('libcascade', 'dist/types.d.ts'), has: (d, c) => new RegExp(`^(declare class ${c}\\b|type ${c} =)`, 'm').test(d) },
];

/** [phase, catalog ids, class, purpose] */
const NEEDS = [
  ['1', 'A1.5 C4.2', 'BRepAlgoAPI_Fuse', '填料合併'],
  ['1', 'A1.5 C4.2', 'BRepAlgoAPI_Cut', '伸長/旋轉除料'],
  ['1', 'A1.5 C7.2', 'BRepAlgoAPI_Common', '共同、干涉體積'],
  ['1', 'A1.5', 'BRepAlgoAPI_Splitter', '分割'],
  ['1', 'A1.5', 'ShapeUpgrade_UnifySameDomain', '布林後合併共面/共圓柱面'],
  ['1', 'B4.1', 'BRepTools_History', '合併共面後的面演化歷史（持久命名）'],
  ['1', 'B4.1', 'TopTools_IndexedMapOfShape', '形狀索引'],
  ['1', 'B4.1', 'TopExp', 'MapShapes / 鄰接'],
  ['1', 'C4.3', 'BRepPrimAPI_MakeRevol', '旋轉'],
  ['1', 'C5.3', 'BRepFilletAPI_MakeChamfer', '導角'],
  ['1', 'F2.1', 'STEPControl_Reader', 'STEP 零件輸入（無名稱/顏色）'],
  ['1', 'F2.1 F2.8', 'STEPCAFControl_Reader', 'STEP 輸入含名稱、顏色、組合件結構'],
  ['1', 'F2.2', 'ShapeFix_Shape', '輸入修復（整體）'],
  ['1', 'F2.2', 'ShapeFix_Solid', '輸入修復（實體）'],
  ['1', 'F2.2', 'ShapeFix_Shell', '輸入修復（殼）'],
  ['1', 'F2.2', 'ShapeFix_Face', '輸入修復（面）'],
  ['1', 'F2.2', 'ShapeFix_Wire', '輸入修復（線框）'],
  ['1', 'F2.2', 'ShapeAnalysis_FreeBounds', '找開放邊界（破面診斷）'],
  ['1', 'F2.2', 'BRepBuilderAPI_Sewing', '縫合面成殼'],
  ['1', 'E1.1', 'BRepExtrema_DistShapeShape', '量測距離'],
  ['3a', 'C4.4', 'BRepOffsetAPI_MakePipeShell', '掃出'],
  ['3a', 'C4.5', 'BRepOffsetAPI_ThruSections', '疊層拉伸'],
  ['3a', 'C5.4', 'BRepOffsetAPI_MakeThickSolid', '薄殼'],
  ['3a', 'C5.5', 'BRepOffsetAPI_DraftAngle', '拔模'],
  ['3a', 'C6.1-3', 'BRepBuilderAPI_Transform', '複製排列、鏡射'],
  ['3a', 'C6.1-3', 'gp_Trsf', '變換'],
  ['3a', 'C4.7', 'BRepFeat_MakeLinearForm', '肋材（備案：伸長 + 布林）'],
  ['3a', 'C10.1', 'BRepOffset_MakeOffset', '移動/偏移面（逐面偏移）'],
  ['3a', 'C10.1', 'BRepOffsetAPI_MakeOffsetShape', '偏移'],
  ['3a', 'C10.2', 'BRepAlgoAPI_Defeaturing', '刪除面、刪除鑽孔'],
  ['3a', 'C14.2 F1.1', 'Quantity_ColorRGBA', '顏色輸出'],
  ['3a', 'C14.2 F1.1', 'Quantity_TypeOfColor', '以 sRGB 指定顏色'],
  ['3b', 'F2.8', 'XCAFDoc_ShapeTool', '組合件結構讀寫'],
  ['3b', 'E2.1', 'BRepAlgoAPI_Check', '布林前檢查'],
  ['3b', 'F4.1', 'StlAPI_Writer', 'STL 輸出'],
  ['4a', 'A3.6', 'BRepExtrema_ShapeProximity', '碰撞/接近偵測'],
  ['4b', 'C9.2', 'BRepOffsetAPI_MakeFilling', '填補曲面'],
  ['4b', 'C8.1', 'BRepFeat_SplitShape', '分割線'],
  ['4b', 'C8.1', 'BRepAlgoAPI_Section', '截交線'],
  ['5', 'A4.4', 'HLRBRep_Algo', '精確隱藏線'],
  ['5', 'A4.4', 'HLRBRep_PolyAlgo', '多邊形隱藏線（快速預覽）'],
  ['5', 'A4.4', 'HLRBRep_HLRToShape', '隱藏線結果轉邊線'],
  ['6', 'E3.2', 'BRepLProp_SLProps', '拔模分析（面法向）'],
  ['6', 'E3.5', 'IntCurvesFace_ShapeIntersector', '厚度分析（射線求交）'],
  ['P2', 'F1.4 F2.2', 'IGESControl_Writer', 'IGES 輸出'],
  ['P2', 'F1.4 F2.2', 'IGESControl_Reader', 'IGES 輸入'],
];

const rows = NEEDS.map(([phase, ids, cls, purpose]) => ({ phase, ids, cls, purpose, present: BUILDS.map((b) => b.has(b.dts, cls)) }));
const totals = BUILDS.map((b, i) => `${b.name}：${rows.filter((r) => r.present[i]).length}/${rows.length}`);
const mark = (ok) => (ok ? '有' : '**缺**');

const md = [
  '# OCCT 綁定盤點',
  '',
  ...totals.map((t) => `- ${t}`),
  '',
  `| Phase | 目錄 ID | 類別 | 用途 | ${BUILDS.map((b) => b.name).join(' | ')} |`,
  `|---|---|---|---|${BUILDS.map(() => '---').join('|')}|`,
  ...rows.map((r) => `| ${r.phase} | ${r.ids} | \`${r.cls}\` | ${r.purpose} | ${r.present.map(mark).join(' | ')} |`),
  '',
].join('\n');
writeFileSync(new URL('./inventory.md', import.meta.url), md);
for (const [i, b] of BUILDS.entries()) {
  const missing = rows.filter((r) => !r.present[i]).map((r) => r.cls);
  console.log(`${b.name}: ${rows.length - missing.length}/${rows.length} present; missing: ${missing.join(', ') || '—'}`);
}
