# 交接與接續工作

## 2026-11-21（17:33 交接）— 3D→2D 拔模分組、出圖加速 5.3×、中心線全修復（已推送 `30d7cc06`）與 5 項標註遺漏補齊計畫

- **已推送至 `origin/main`**：
  1. **`8a2a7f33` — 拔模斜角合併標註（`N×θ`）**：`≤ 5°` 拔模平面同視圖合併為單一計數角度標註（保留 `45°` 結構斜面個別標註），`R1-9035` 雜亂 `75 → 8`、耗時 `162.6s → 33.4s`、`A2 2:1`。
  2. **`30d7cc06` — 自動出圖加速（`5.3×`）＋ 中心線與 5 類同類遺漏全面修復**：
     - `overlap.ts` AABB 預過濾與零配置相交、`arrowHitsView` 早停、`steerLeaders` 跳過未命中角度：`R1-9035(auto)` `120.4s → 22.8s`、`R1-9035(A2)` `33.4s → 9.53s`。
     - 修復 5 類遺漏：截斷／斜切圓柱中心線、圓錐／拔模圓柱／拆分圓錐側視中心線與正視中心記號（`ViewFeature.centre`）、球面中心記號、`detail`/`crop`/`sectionLocal` 繼承母視圖 `features` 與 `crop` 輪廓裁切、斷裂視圖（`placed.break`）中心線與螺紋線斷裂帶裁切。
  3. **`c0cb3991` — 3D→2D 標註遺漏高優先 5 項補齊**：側視／剖視螺紋細實線（#1）、無端視圖圓柱補標側視 `Ø`（#2）、割面線兩端與轉折粗段（#8）、球面 `SØ`/`SR`（#4）、結構斜錐解析與標註（#3）。
- **本輪已完成（待使用者核准提交與推送）**：
  - 3D→2D 中優先 3 項全部實作並通過 67/67 測試與四項靜態檢查：
    1. **#7 孔陣列節圓中心線（PCD）**：`annotation.ts` `centreItems()` 辨識等角距圓孔陣列繪製節圓中心線（防矩形四孔板誤判）。
    2. **#6 B-spline／曲面外形總長寬包絡**：`projectionRefs.ts` `projectionExtrema()` ＋ `autoDrawing.ts` 針對超出解析特徵之自由曲面補標總長／總高。
    3. **#5 非正交斜孔輔助視圖（`auxiliary`）**：`drawingDimensions.ts` `obliqueHoleAxes()` ＋ `autoDrawing.ts` `adviseAuxiliary()` ＋ `drawingSession.ts` 自動建立輔助視圖並納入 `dimensionViews()` 真形標註。

## 2026-11-21（16:38 交接）— `sds-plus-bit` 雜亂收斂（`7 → 1`）、CNS 3 `A2` 線寬與 `R1-9035` 正向建模＋2D 出圖閉環

- **今日下午完成**：
  1. **工程圖微調收斂（已推送 `c1f738d1`）**：
     - `packages/regen/src/drawingDimensions.ts`：`isSketchTextFace()` 移至 `viewFeatures()` 面入口守門，排除所有草圖刻字筆劃面；`sds-plus-bit.3dbx` 雜亂由 **`7 → 1`**（交叉歸 `0`、第 2 頁維持 `0`）。
     - `packages/model/src/drawing.ts`、`tests/phase5/drawing-standard.test.ts`：CNS 3 `A2` 細線寬由 `0.18` 調為 `0.25 mm`（62/62 測試、typecheck 與四項 lint 全過）。
  2. **`part-4`（`R1-9035`）探針突破與正向建模閉環（產物於 `out/R1-9035/`，未改產品碼）**：
     - 讀取 `D:\Self-developed_Apps\3DB實機確認\R1-9035-MC_05_mdx.pdf`（3 頁全尺寸）對照 STEP `part-4`（295 面），以探針證明 `f171–f174` 有界填補體零干涉（`0.000000 mm³`）、無刪面癒合（B-spline `30 → 28`）且重切 `diff = 7.43e-8`。
     - 依使用者裁定採正向參數化建模產出 `out/R1-9035/R1-9035.3dbx`（33/33 特徵 `ok`、128 面、體積 `4199.7 mm³`、與原 STEP 差 `2.2%`，含針尖斜切側孔與左右兩段放樣瓶頸閃避槽）。
     - 以 `drawing_create({ sheet: 'A2' })` 自動產出 `out/R1-9035/R1-9035.3dbd` 與 `R1-9035.pdf`（`162.6 s`、`layout.pass: true`、淨空 `7.502 mm`）。
- **核心雙向目標備忘（使用者明確要求）**：
  - 本系統核心目標之一為 **雙向互通**：(1) 任意 2D 工程圖 → 3D 參數化模型（建議以「AI 讀圖規劃特徵樹 ＋ 原生 CAD 正向建模 ＋ 2D 投影反比對驗算閉環」推進）；(2) 任意 3D 模型 → 2D 工程圖（後續可優化：`0.5°` 拔模面產生大量 `89.5°/90.5°` 重複斜角標註造成之雜亂，以及 `sheet: 'auto'` 對多面射出件的 HLR 耗時）。
- **既有擱置項目（維持擱置）**：`E13-999-421.STEP`、`MT17203`、`CIV0000467治具_step.STEP`、`part-3(R1-10226)`。

## 2026-11-21（12:05 交接）— 主線 A（`push_turn` 4 件交叉孔）與工程圖微調 1–3 全數完成並推送

- **今日完成並已推送至 `origin/main`**：
  1. **主線 A：`push_turn` 夾具 4 件交叉孔與曲面交界圓柱孔（`21cd594e`）**：
     - `packages/regen/src/recognize/analyze.ts`：新增 `curvedRimHole()`，以無縱向平行直線邊排除部分圓弧圓角／槽，支援雙側貫穿（`P03`）、單側徑向孔（`P07`/`P09`）與平面入口破入內部圓孔盲孔（`P05`）。
     - `packages/regen/src/recognize/reconstruct.ts`：當 `areaError` 與 `difference` 皆達標、僅 `volumeError` 超標時，補做 `{ eps: 1e-10 }` 自適應積分確認真值。
     - `tests/phase8/recognize-cross-holes.test.ts`：新增 4 項測試（含 30 組隨機參數 Fuzz 與 WASM Heap 監控）；`P03`/`P05`/`P07`/`P09` 單件及 `assembly.step` **24/24 單一實體全數重建成功**（僅 `part-25(cords)` 為 8 實體依規範拒絕）。
  2. **工程圖微調 1–3（`06f0d347`）**：
     - **微調 1（`diamond-pin`）**：診斷剩餘 2 處交叉為 `dim13|dim3` 與 `dim13|dim4`（`view2` `6 mm` 寬度延伸線與內圓徑向引線受鄰近視圖幾何互斥），枚舉 42 組角度無法再降，維持現狀並通過 `drawing-clearance.test.ts`（4/4）。
     - **微調 2（`R1-8032` 與 `steerLeaders`）**：`arrowHitsView()` 預設容差改為依視圖比例放寬 `Math.max(0.2, Math.min(0.6, 0.03 * ratio(scale)))`；`steerLeaders()` 對 `detail` 視圖不可達圓弧（`Math.abs(dist - radius) > rSheet + 0.5`）直接剪枝，並對 `fineAngles` 去重。實測 `out/R1-8032-Rev08-剖面修訂/R1-8032_Rev08_2D_完整修訂.3dbd` 未命中箭頭由 **17 處降至 9 處**。
     - **微調 3（CNS 3 核對）**：網路查核 CNS 3（B1001）線寬與最小字高表，確認 `DRAWING_PROFILES.CNS` 之 `A0/A1`（`0.7/0.5/0.25 mm`）與 `A3/A4`（`0.5/0.35/0.18 mm`）及目前尺度最小字高 `3.5 mm` 皆符合規範。
  3. **SVG 即時進度儀表板**：更新 `out/progress/index.html`、`state.js` 與 `out/pending-choices.html`（已於無頭 Chrome 驗證）。
- **目前驗證狀況**：
  - `tests/phase8/recognize-cross-holes.test.ts`（4/4）、`tests/phase8/feature-recognition.test.ts`（32/32）、`apps/mcp/test/drawing-clearance.test.ts`（4/4）、`npm run typecheck`、`lint:rules`、`lint:deps`、`lint:repo` 全數通過。
- **既有擱置項目（使用者維持擱置）**：
  - `E13-999-421.STEP`（缺錐形螺紋）、`MT17203`（80 個雙三次曲面片）、`CIV0000467治具_step.STEP`（512 MiB `BudgetError`）、`part-3(R1-10226)` / `part-4(R1-9035)`（`§6o-B` / 缺 2D 工程圖）。

## 2026-11-20（16:50 下班交接）— 自動出圖改善計畫四期全數完成並推送（ADR 0260～0263）

- **今日完成並已推送至 `origin/main`**：
  1. **第一期（ADR 0260）**：CNS 3 預設標準設定檔與線寬／線型／圖框（`33ac36f7`）。
  2. **第二期（ADR 0261）**：視圖淨空、受限方向填滿、放大詳圖配置、多頁一致性、回轉件主視圖與 `layout` 自檢（`6785fdca`，5 基準零件 7 頁全數 `layout.pass: true`）。
  3. **第三期（ADR 0262）**：標註的佈置與內容 `D1`–`D10` / `C1`–`C4` / `L1`–`L2`（`76007fcd`，5 零件 `3-1/3-2/3-5/3-6/3-7/3-8/3-9/3-10` 全數歸 0、`rounds` 覆蓋率 100%、7/7 突變測試全紅、99/99 測試檔通過）。
  4. **第四期（ADR 0263）**：品質閘門 `Q1`, `Q2`, `C5`, `C7`, `Q3`（`packages/drawing/src/qualityGate.ts`、`apps/mcp/src/drawingSession.ts`、`drawingTools.ts`）。`drawing_inspect`／`drawing_create` 回報 16 項規則之 `quality` 閘門；草稿匯出自動加蓋 `PRELIMINARY`（PDF／SVG／DXF 一致）；`drawing_export({ release: true })` 阻擋未達標圖面並列出未通過規則；單元測試＋MCP 端到端＋4/4 突變測試全紅。
- **本輪後續已推進（待使用者核准提交與推送）**：
  - 完整 `npm run verify:ui -- --checkpoint out/ui.jsonl`：**280 / 280 PASS**（已推送 `87cc838d`）；修復 GitHub Actions `Repository integrity #309` `stepText.ts:46` `crash-no-swallow` 失敗（已推送 `b094c20d`）。
  - **斜面（`coverage.slants`）自動標註與刻字斜邊排除完成**：`autoDrawing.ts` 支援圓錐 `chamfer` 與最近結構基準面（`p.area >= f.area`）`angle` 規劃及覆蓋讀取；`drawingDimensions.ts` 新增 `sketchTextPrefixes` / `sketchesTextPrefixes` 於 `viewFeatures()` 排除草圖文字實體（`entity.type === 'text'`）之刻字筆劃斜邊（全鏈路接線至 `drawingSession.ts` 與 `kernel.worker.ts`）；4 黃金零件 `slants` 覆蓋率達 **100%**（`locating-plate`、`v-block` 維持 `clutter = 0`）。
- **下次接手可選後續項目**：
  1. 於有 `R1-8032` `.3dbx` 的機器重測局部環面圓角 3 處引線（`3-4 = 3`）與高密度視圖剩餘雜亂（`R1-8032` `10/2`）。
  2. 取得 CNS 3 原文後核對第一期（ADR 0260）之線寬與最小字高表。

## 2026-11-20（傍晚）— ADR 0262 第三期（標註的佈置與內容）完成，準備進入第四期（品質閘門）

- **本輪已完成（`main` 上未提交，待使用者核准提交與推送）**：
  - 詳見 [ADR 0262](docs/adr/0262-drawing-dimension-placement-and-content.md) 與 `DEV_LOG.md`。
  - 完成第三期規則 `3-1`～`3-11`（`D1`, `D3`, `D5`, `D6`, `D7`, `D9`, `D10`, `C1`, `C2`, `C4`, `L1`, `L2`）：
    - `packages/model/src/drawing.ts`、`packages/regen/src/drawingDimensions.ts`：`ViewFeature.surface`、同軸拆分圓柱與環面圓角歸併、`MIN_DIMENSION_FACE_AREA = 0.01` 碎面過濾、收斂圓錐/環面盲孔偵測（`D9`）、側面拆分圓柱與圓錐軸線輸出（`L1`）。
    - `packages/drawing/src/annotation.ts`：同心整圓單一中心十字（歐氏距 `≤ 1e-2` mm 取最大半徑，`L2`）、共線軸線合併為單一連續軸線（`L1`）。
    - `packages/drawing/src/dimension.ts`、`autoDrawing.ts`、`autoDimension.ts`：`contourAttach` `clearCut()` 避開剖面線區（`D1`）、座標標註文字淨距 `2.0` mm 與同座標去重（`D3`/`D5`）、拆分圓遠端單箭頭退路（`D6`）、三階段圓尺寸配置（含側面線性 `Ø`）與 `surfacesSized` 覆蓋率修復（`C1`/`C2`）。
    - `apps/mcp/src/drawingSession.ts`：自動剖面啟用 `centreMarks: true`、`arrowHitsView()` 錯誤/空箭頭顯式回傳 `false`、`steerLeaders()` 雙階段角度搜尋不劣化命中箭頭、`offloadMicroDetails()` 圓弧實際附著點群聚（半徑 `≤ 3.5` mm）、`tidy()` 於 `clearViews()` 後重算 `placeCaptions()`。
  - **5 個基準零件實測**：全數維持 `layout.pass: true`、`rounds` 覆蓋率 100%（`R1-8032` 102/102、`sds-plus-bit` 16/16），`3-1/3-2/3-5/3-6/3-7/3-8/3-9/3-10` 全數歸 **0**；`R1-8032` 雜亂 `38/5 → 10/2`、箭頭偏離 `21 → 3`；`sds-plus-bit` 雜亂 `39/1 → 7/2`、箭頭偏離 `2 → 0`。
  - **測試與突變**：`tests/phase5/drawing-dimension-content.test.ts`（11 項單元測試）＋ **7/7 突變測試全紅**。
- **下一步**：提交並推送第三期（ADR 0262）後，進入第四期（品質閘門 `Q1`, `Q2`, `C5`, `C7`，未來 ADR 0263）。

## 2026-11-20（下午）— ADR 0261 第二期（視圖配置）規則 2-1～2-9 全數完成，正在執行全量關門測試

- **使用者裁示（2026-11-20）**：
  1. `Q1=A`：切換至 `wip/adr-0261-phase2` 並整合 `main` 最新提交 `dcc52c9a`（已完成合併）。
  2. `Q2=A`：核准 `MIN_DETAIL_INK = 0.25` 作為規則 `2-4` 放大詳圖最低內容門檻。
  3. `Q3=A`：核准多頁共用最大圖紙時，單頁或決定圖紙大小的主導頁受限方向填滿率須在 `0.60–0.95`，配合同圖紙放大的從屬頁只要求不超出可繪區（`≤ 1.00`）。
  4. `Q4=A`：實測 5 個基準零件（4 個黃金零件＋`out/R1-8032-Rev08-剖面修訂/R1-8032_Rev08_2D_完整修訂.3dbx`）的同軸回轉面面積佔比，訂定 `REVOLVED_PART_SHARE = 0.50`（回轉件 `54.7%–65.3%`、非回轉件 `1.5%–2.5%`），完成規則 `2-8`（回轉件以軸線側面視圖為主視圖）。
  5. `Q5=A`：完成規則 `2-9`，在 `DrawingSession.checks` 與 `drawing_inspect` 新增結構化 `layout: DrawingLayoutInspection` 報告。
  6. `Q6=A`：第二期完成並合入 `main` 後，下一步接續「工程圖第三期（標註的佈置與內容）」。
- **本輪已完成（`wip/adr-0261-phase2`）**：
  - `packages/drawing/src/autoDrawing.ts`：新增 `REVOLVED_PART_SHARE = 0.5`、`revolutionAxis`、`rankMainViews(stats, axis)`（規則 `2-8`）。
  - `packages/drawing/src/layoutMetrics.ts`：新增 `FILL_RANGE = [0.6, 0.95]`、`PageLayoutInspection`、`DrawingLayoutInspection`。
  - `packages/drawing/src/detailPlacement.ts` 與 `apps/mcp/src/drawingSession.ts`：修正 `placeDetails` 未擺放詳圖在預設座標 `[280, 150]` 的幽靈佔位，並將 `nearestFreeSpot` 視線遮擋障礙物與 `layoutMetrics` 對齊為非詳圖視圖本體框 `box`，嘗試 `30, 20, 10, 0` mm 留白使詳圖距離落在 `maxDistance` 內；`checks()` 與 `inspect()` 回報完整 `layout` 檢驗結果（規則 `2-9`）。
  - **5 個基準零件共 7 頁實測全數通過（`layout.pass: true`）**：
    - `diamond-pin`（回轉面 `61.4%`，主視 `right`）：A3 2:1、填滿 `0.727`、淨空 `8.00 mm`、PASS。
    - `locating-plate`（回轉面 `2.5%`，主視 `top`）：A3 1:1、填滿 `0.798`、淨空 `9.66 mm`、PASS。
    - `v-block`（回轉面 `1.5%`，主視 `right`）：A4 1:1、填滿 `0.823`、淨空 `7.53 mm`、PASS。
    - `sds-plus-bit`（回轉面 `54.7%`，主視 `front`）：兩頁同為 A2（1:1／1:2）、填滿 `0.831／0.675`、淨空 `14.53／7.46 mm`、PASS。
    - `R1-8032`（回轉面 `65.3%`，主視由 `bottom` 改為 `right`）：兩頁同為 A0（20:1／2:1）、填滿 `0.608／0.549`、淨空 `198.23／7.545 mm`、第 2 頁 5 個詳圖無遮擋且距離 `12.4–38.6 mm` 全在上限 `56–81.2 mm` 內、PASS。
  - 文件與測試：新增 [ADR 0261](docs/adr/0261-drawing-view-layout.md)、更新 `docs/drawing-improvement-plan.md`、`packages/i18n/src/{zh-TW,en}/help.ts`、`DEV_LOG.md`；新增 `2-8`、`2-9` 單元測試與 4 項突變測試全紅；`typecheck`、`docs:sync`、四項 lint、`help.test.ts` 全過。

## 2026-11-20 — ADR 0260 第二期（視圖配置）進行中，因每週額度 97% 提前交接（給別台電腦的 agent）

**先做這三件事**：`git fetch`；`git switch wip/adr-0261-phase2`（第二期的程式與測試在這個分支，**尚未合併進 main**）；讀完本節與 `docs/drawing-improvement-plan.md`。main 只有本交接文件與規則文件，因為全量單元測試與完整 `verify:ui` 還沒跑，不能把未驗證的程式放進 main。

- **背景**：第一期（製圖標準 CNS／ISO，預設 CNS）已在 main（`33ac36f7`，ADR 0260）。第二期要讓自動出圖的視圖配置合乎製圖規範。規則全文：`docs/design/drawing-rules-cns.md`；四期計畫、現況基準、驗收標準：`docs/drawing-improvement-plan.md`。兩份是 2026-11-19／20 由 R1-8032 的審查整理出來的，數值多取自 CNS 教材（淡江《機械畫》第 1 章），**尚未對照 CNS 3 原文**。
- **使用者的決定**：預設 CNS 3、ISO 可切換；沒有 `standard` 欄位的舊圖視為 ISO；系統預設只寫在 `DEFAULT_DRAWING_STANDARD`；`manual-browser-projects.js` 的間歇失敗已同意延後（2026-11-19，乾淨 `db051b9a` 也會 4 次失敗 1 次）；第二期驗收標準已確認（2-1 淨空 ≥ 7 mm、2-2 受限方向填滿 0.60–0.95 且不超出可繪區、2-3 詳圖不被擋且距離 ≤ 母視圖對角線、2-5 標準比例等，詳見計畫文件）。**提交前一律先問使用者**；刪任何檔案前先說明並取得同意；不得放寬測試門檻（AGENTS §3.3）。

### 分支上已完成（程式與測試都在分支裡）

1. `packages/drawing/src/layoutMetrics.ts`：純函式，量一頁的配置（填滿率、相鄰視圖連同尺寸與標題的淨空、詳圖到母視圖的距離與是否被擋、詳圖的線長／圓周、非標準比例）。`minViewClearance`＝2 × 字高、`MIN_DETAIL_INK`＝0.25。測試 `tests/phase5/drawing-layout-metrics.test.ts`（11 項，突變 7 種、1 種為等價突變）。
2. `DrawingSession.layout()`（公開）把上面的量測接到場景；`clearViews`／`slideApart`（`apps/mcp/src/drawingSession.ts`）依量到的淨空，沿 `DrawingView.slide` 拉開視圖（取代只看雜亂分數的 `spreadViews` 作為最後一步，`spreadViews` 仍在）；`fitWithRoom`（拉開後重新貼合圖紙與比例）；`tidyFitted`（`tidy` 之後頁面仍超出可繪區就再貼合，最多兩次）；`tidy(…, 'keep')` 給編輯路徑（`drawing_text_size`、`drawing_complete`）：**編輯不改圖紙與比例**，只在放得下時拉開。
3. `create()`：自動選圖紙後，**在選定的圖紙上再排一次**（避免「經由較小圖紙拉開再貼合」留下的路徑相依雜亂）。
4. `steerLeaders` 的引線長度多試 46、64 mm（比例大或字大時，標註要能擺到零件外面）。
5. 詳圖：`DETAIL_SCALES` 只用標準比例（20、10、5、2、1:1，原本有 15、8、4）；`nearestFreeSpot`（`packages/drawing/src/detailPlacement.ts`，6 項測試、6 種突變全紅）找離母視圖最近、視線不被擋的空位；`placeDetails` 取代原本「放進最大的兩塊空白」；`dropEmptyDetails` 把沒有內容的詳圖拿掉（尺寸還給原視圖、字母重新連號）。測試 `apps/mcp/test/drawing-details.test.ts`（2 項，突變 4 種全紅）。
6. 量測 kit：`tests/kit/layout-baseline.kit.ts`（`npx vitest run --config tests/kit/vitest.kit.config.ts layout-baseline`；`LAYOUT_BASELINE_EXTRA` 可加檔案、`LAYOUT_BASELINE_ONLY` 用正規式篩選）；`apps/mcp/test/drawing-clearance.test.ts`（三個黃金零件每頁淨空 ≥ 7 mm；sds-plus-bit 要 200 秒，只由 kit 量）。

### 驗證狀況（誠實版）

- 已過（2026-11-20，含詳圖步驟的最終程式）：`apps/mcp/test` 與 `tests/phase5` 共 91 檔 892 項通過、1 略過；typecheck 過；`lint:repo` 過。
- **還沒跑**：全量 `npm run check`（單元測試約 1 小時，用 `npx vitest run --reporter=verbose > scratch/test.log` 才看得到進度）；完整 `npm run verify:ui`（280 列，執行期間不得改原始碼）。
- 量測（5 個零件，原電腦 `scratch/layout-step2d.json`）：淨空 7 頁中 6 頁 ≥ 7 mm（diamond-pin 8、R1-8032 p1 7.5、sds-plus-bit p2 7.45，其餘原本就 ≥ 9）；R1-8032 第 2 頁仍是 −42 mm（詳圖互相重疊，第三步要解的）。詳圖步驟後的量測（2026-11-20，原電腦）：R1-8032 第 2 頁 A3 5:1 → A3 2:1、受限方向填滿 1.161 → 0.833（不再超出可繪區）、淨空 −42 → −0.18 mm（仍差一點點）；詳圖 6 → 5 個（空的那個被拿掉，字母已重新連號）、非標準比例 4 → 0、被擋 5／6 → 1／5、線長比 0.81–7.8；其餘 4 個零件與第 1 頁沒有變。**2-3 已達標（R1-8032 第 2 頁）**：使用者已同意放寬距離上限（2026-11-20）為 max（母視圖對角線，2 × 詳圖直徑）；有詳圖的頁改成從 A3、A2、A1 依序試，取第一張「不擠」的（`layoutFaults` ＝ 淨空不足 ＋ 被擋或超過上限的詳圖 ＋ 超出可繪區 為 0）。結果：第 2 頁 A3 2:1 → **A2 2:1**，淨空 15 mm、填滿 0.47／0.73、5 個詳圖距離 22–69 mm（上限 56–82）全在上限內、0 個被擋、0 個非標準比例。**但第 1 頁是 A1、第 2 頁是 A2，違反 2-6（各頁圖紙相同）**——下一步處理。**R1-8032 的 `.3dbx` 不在 repo**（原電腦 `D:\Self-developed_Apps\3DB實機確認\塑膠件\R1-8032-Rev08-剖面修訂\R1-8032_Rev08_2D_完整修訂.3dbx`），別台電腦只能量 4 個黃金零件。

### 我改過、尚未請使用者確認的事

- **`MIN_DETAIL_INK` 從計畫中的 1.0 改成 0.25**：板件實測詳圖（轉角帶圓角）的線長／圓周是 0.39，一條直線橫過圓是 0.32，真正空的是 0。1.0 會把合理的詳圖全拿掉（與 AGENTS「標準要建立在量到的基準上」同一教訓）。請在下次對話跟使用者說明並確認。
- 拉開視圖會改變圖紙／比例：diamond-pin A4 1:1 → A3 2:1；R1-8032 第 1 頁 A3 5:1 → A1 20:1；sds-plus-bit 第 2 頁 A2 1:1（視圖重疊）→ A3 1:5（比例很小，來自 `fitSheet` 只試 A4～A2 的既有後備）。這是否可接受要問使用者；建議在「圖紙與比例一起選」的步驟處理。

### 2-6 階段 A 完成：各頁用同一種圖紙（2026-11-20）

第 2 頁（以及沒有詳圖的後續頁）從第 1 頁的圖紙大小開始試，取第一張 `layoutFaults`＝0 的（有詳圖的頁至少 A3，最大試到 A0）；詳圖放好、尺寸定稿後若仍有問題，再放一次詳圖（`placeDetails` 第二輪）。量測（原電腦）：R1-8032 兩頁都是 A1（第 2 頁 A1 2:1，淨空 15 mm、5 個詳圖全在上限內、0 被擋、0 非標準比例）；sds-plus-bit 兩頁都是 A2，第 2 頁 A3 1:5 → A2 1:2（比例變好）；其餘 3 個零件只有一頁，沒有變。`apps/mcp/test`＋`tests/phase5` 91 檔 893 項通過。**取捨**：R1-8032 第 2 頁共用 A1，受限方向填滿只有 0.43，低於 2-2 的下限 0.60（與「同一種圖紙」互相拉扯）；下限在多頁圖上可能要放寬，請與使用者討論。階段 B（剖面與詳圖代號整份圖唯一）、階段 C（同一視圖不在兩頁重畫）未做。

### 2-6 階段 B 完成：A-A 整個搬到第 2 頁；各頁一律用「各頁需要的最大圖紙」（2026-11-20）

使用者決定（2026-11-20）：第 2 頁的 A-A 不再是複製，而是**整個搬過去**（連同尺寸），第 1 頁不再畫 A-A（`offloadMicroDetails`；與 B-B 的做法相同），所以剖面代號整份圖只出現一次。副作用：R1-8032 的第 1 頁只剩主視圖與等角圖，會縮成很小的圖紙；因此 `create()` 最後把第 1 頁在「各頁中最大的圖紙」上重排一次（先拿掉等角圖再重放）。量測（原電腦，R1-8032）：第 1 頁 A2 20:1、填滿 0.68／0.80、淨空 50.9 mm；第 2 頁 A2 2:1、填滿 0.52／0.78、淨空 7.5 mm、5 個詳圖全在上限內、0 被擋、0 非標準比例；**兩頁同為 A2**。sds-plus-bit 兩頁 A2 不變。新增測試：各頁圖紙相同、剖面與詳圖代號整份圖唯一（板件）。`apps/mcp/test`＋`tests/phase5` 91 檔 894 項通過。**搬動剖面本身只有 kit 量過（R1-8032）**，沒有單元測試（板件沒有剖面）。**階段 C 的結果**：同一個視圖不在兩頁重畫——主視圖仍在兩頁都有（第 2 頁的主視圖是 B-B、A-A 的母視圖，剖切線畫在它上面，詳圖也要附在母視圖旁），這一項沒有解決，要與使用者討論（例如只在第 2 頁畫剖切線與詳圖、或把這個主視圖標為「參考」）。

### 2-6 階段 C 完成：第 2 頁重畫的主視圖標為「參考」；2-6 全部完成（2026-11-20）

使用者決定（2026-11-20）：第 2 頁為了放 B-B、A-A 與詳圖而重畫的主視圖，標題標為「參考」。`offloadMicroDetails` 把它的名稱改成 `drawing.view.reference`（中文「{name}（參考，同第 1 頁）」、英文「{name} (reference, as on page 1)」），標題取自名稱，所以圖上看得到。測試（`drawing-details.test.ts`）：第 2 頁的主視圖名稱為「第 1 頁主視圖名稱＋參考」，第 1 頁沒有「參考」；突變（名稱不改）轉紅。**2-6 的三項都有了結論**：各頁同圖紙（階段 A、B）、代號整份圖唯一（階段 B）、同一視圖重畫者明確標為參考（階段 C）。`apps/mcp/test`＋`tests/phase5` 91 檔 895 項通過。

### 2-7 完成：視圖標題標出比例、標題不被壓到（2026-11-20）

`viewCaptionItem` 多一個參數 `sheetScale`：視圖比例與圖紙不同、且標題是預設範本（使用者沒自己寫字）、且範本裡還沒有 `<SCALE>` 時，在標題後加「 (<SCALE>)」，所以等角圖寫成「等角投影 (1:2)」、比例不同的剖面寫成「A-A (5:1)」；詳圖本來就寫比例，不會重複；使用者自己寫的標題不動。測試 `tests/phase5/drawing-caption-scale.test.ts`（6 項，突變 3 種全紅）。標題不被壓到：量測 4 個零件共 7 頁（`tests/kit/layout-baseline.kit.ts` 新增 `captionClutter`）沒有任何標題在雜亂清單裡，並把這個檢查加進 `apps/mcp/test/drawing-clearance.test.ts`（三個黃金零件）。**sds-plus-bit 沒有重量這項**（每次 200 秒）。整份圖還有的雜亂（座標尺寸數字互相擠、引線交叉：diamond-pin 3、sds-plus-bit 39、R1-8032 47）不是標題，是第三期（標註佈置）的項目。`apps/mcp/test`＋`tests/phase5` 92 檔 901 項通過。

### 未完成（照這個順序）

1. 2-6：各頁用同一張圖紙（取各頁需要的最大者，其餘頁在該圖紙上重排一次）、剖面與詳圖代號整份圖唯一（R1-8032 的代號 A 出現兩次）、同一個視圖不在兩頁重畫（下視圖兩頁都畫）。
2. 計畫 2-7（視圖標題不與尺寸重疊、比例不同的視圖標比例）、2-8（回轉件以軸線水平的視圖為主視圖；回轉面比例門檻 X 須先量 5 個零件再訂）、2-9（`drawing_inspect` 回報配置量測）。
3. 全量單元測試、完整 `verify:ui`、ADR 0261（取號前先 `git log origin/main` 與 `ls docs/adr` 確認；目前最後是 0260）、說明文件（`help.*` 中英）、DEV_LOG，然後問使用者能否提交與合併進 main。

### 不要提交／本機才有的東西

`.claude/launch.json` 的 `progress` 設定、`out/progress/`（進度頁，127.0.0.1:5480，每 3 分鐘更新，`/live.json` 即時讀日誌）、`out/agent/`、`scratch/`、`tests/kit/standard-baseline.kit.ts`、`tests/kit/debug-p2.kit.ts`、根目錄的 `probe.txt`（我的暫存，需使用者同意才刪）、`.claude/worktrees/p1-baseline`（乾淨 commit 的 worktree，含 `npm ci`，供重現 flaky 用；刪除前先 `cmd /c rmdir <path>\node_modules` 不加 `/s`，見記憶）。

### 額度

2026-11-20 本週（全模型）額度已用 97%，下週重置時間 2026-11-23 09:00 UTC。這一節是依全域規則 §9 在 97% 時寫的；若額度耗盡，以本節與分支為準，不要依賴原電腦的對話。

## 2026-11-19（夜）— ADR 0260 第二期（視圖配置）開工：只讀程式與量測規劃，**尚未改任何程式**

- **第一期已提交並推送**：`33ac36f7`（main 與 origin/main 同步）。細節見下一節。
- **本期目標**（`out/agent/自動出圖改善計畫.md` 第二期，規則編號 P／V 見 `out/agent/工程圖標註與配置通則.md`；`out/` 不入庫）：視圖間距依兩側尺寸區推算、圖紙大小與比例與排法一起選、回轉件以縱向視圖為主視圖、詳圖靠近母視圖且不產生空詳圖、視圖標題與等角圖、多頁同圖紙且不重複視圖。
- **已讀程式得到的事實**（未動手修改）：
  1. `VIEW_GAP = 25` 是定值（`packages/drawing/src/layout.ts:152`），`offsets()` 與衍生視圖的 `spot()` 都用它；不看兩側有幾排尺寸。
  2. 已有「讓出空間」的機制，但它依雜亂分數而不是量到的淨空：`DrawingSession.tidy` → `spreadViews` 以 5 mm 為步長沿視圖所在的線滑動（`DrawingView.slide`，`slideAxis`）。R1-8032 淨空 0 mm 就是這條路徑沒擋住。**建議沿用 `slide`（已入檔、使用者可再調），不新增圖面欄位。**
  3. 圖紙與比例：`fitSheet`（`apps/mcp/src/drawingSession.ts`）先試 A4、A3、A2 找第一個比例 ≥ 1:1 的，`create` 再依雜亂分數往 A1 升；`fitViews`（`packages/drawing/src/fit.ts`）取放得下的最大標準比例並置中。沒有填滿率目標，也不比較排法。
  4. 詳圖：`offloadMicroDetails` 把微圓角尺寸移到第 2 頁並建詳圖，`create` 再在空白矩形（≥ 65 mm）擺放；詳圖距母視圖沒有限制。
  5. 主視圖：`rankMainViews` 依投影面積評分，不辨認回轉件。
- **風險／待確認（使用者確認驗收標準前不動手）**：計畫中的「視圖連同尺寸在可繪區寬、高佔比皆 60–85%」對細長件不可能達成（R1-8032 在 A1 寬向已 85%、高向只有 56%）。要先量 5 個零件（R1-8032 與 `tests/golden` 的 4 件：diamond-pin、locating-plate、sds-plus-bit、v-block）的現況基準，再提出改過的、可達成的標準（例如只要求受限方向落在 60–85%、淨空 ≥ 7 mm、詳圖距離），請使用者確認。
- **下一步**：
  1. 寫配置量測函式（純函式，`packages/drawing`；輸入場景與已擺放的視圖，輸出每頁填滿率、相鄰視圖淨空、詳圖到母視圖的距離與是否隔著別的視圖、空詳圖數、非標準比例），單元測試用合成場景。
  2. 以它量 5 個零件的現況（kit 暫存於 `tests/kit/`，不入庫；`DrawingSession.build` 目前是公開方法，可直接取 `scene` 與 `placed`）。
  3. 把基準與建議的標準交給使用者確認，再實作。ADR 編號開工時以 `git log origin/main` 與 `docs/adr` 確認（目前最後是 0260，下一個 0261）。
- **本機暫存（未入庫，用完要停或清）**：進度頁伺服器（`.claude/launch.json` 的 `progress`，127.0.0.1:5480，`out/progress/`）；`.claude/worktrees/p1-baseline`（乾淨 `db051b9a` 的 worktree，含 `npm ci`）；`scratch/` 的測試與 verify:ui 日誌、`scratch/standard-baseline-*.json`；`tests/kit/standard-baseline.kit.ts`（未追蹤）。刪除前須使用者同意（全域規則第 8 條）。
- **已知延後**：`tests/e2e/manual-browser-projects.js` 間歇失敗（乾淨 `db051b9a` 也會，4 次 1 次），2026-11-19 使用者同意延後。

## 2026-11-19（傍晚）— ADR 0260 第一期：製圖標準設定檔（CNS 預設）——已驗證並提交

- **任務 ID**：ADR-0260-P1。來源：R1-8032 工程圖審查 →《工程圖標註與配置通則》（`out/agent/工程圖標註與配置通則.md`）→ 四期改善計畫（`out/agent/自動出圖改善計畫.md`）。`out/` 不入庫。
- **使用者決定（2026-11-19）**：
  1. 預設 CNS 3，ISO 可切換；整份工程圖一個標準（設一頁即全部頁）。
  2. 沒有 `standard` 欄位的舊圖視為 ISO，外觀不變。
  3. SSOT：系統預設只寫在 `DEFAULT_DRAWING_STANDARD`（`packages/model/src/drawing.ts`）；所有標準數值集中在 `DRAWING_PROFILES`。
  4. 「選項」加入「新工程圖的製圖標準」（`SystemOptions.drawingStandard`，初值取上述常數）。
  5. 第二到第四期（視圖配置、標註佈置與內容、品質閘門）待第一期提交後再開工，各自一份 ADR。
- **已完成**：
  - 模型：`sheet.standard`、圖面結構版本 38 → 39（`serialize.ts` 遷移＋讀檔驗證）、`DRAWING_PROFILES`／`profileOf`／`lineGroupOf`／`frameMarginsOf`／`baseDimStyle`、`createEmptyDrawing(standard = DEFAULT_DRAWING_STANDARD)`、`setSheet` 驗證並套用到全部頁。
  - 繪圖：`LINE_STYLES` 與 `lineStylesFor` 由設定表推出、`Scene.lines`（ISO 不帶）、`sceneLines`；`sheetMetrics` 圖框取自設定表；SVG／PDF／DXF（圖層線寬與 `CENTER_CNS` 線型）／PNG 預覽都讀場景線型；CNS 尺寸線預設為細線寬。
  - MCP：`drawing_create` 新增 `standard`，說明文字讀常數。網頁：圖紙設定「製圖標準」選單、「選項」預設、兩個尺寸樣式面板的基準改用 `baseDimStyle`、新圖讀選項。
  - 文件：ADR `docs/adr/0260-drawing-standard-profile.md`、`help.conceptDrawingDimensions.body`（中英）、i18n 字串、`docs/repository-inventory.md`（docs:sync）、DEV_LOG。
  - 測試：新增 `tests/phase5/drawing-standard.test.ts` 44 項；7 種突變全部轉紅。既有 7 檔 12 項以 ISO 手算的測試改用 `createEmptyDrawing('ISO')`（含 `tests/support/outputScene.ts`），期望值與容差未改。
  - 舊檔不變（驗收 1-4）：4 個 golden 零件以 ISO 出圖匯出 SVG／DXF／PDF，14/14 與 `db051b9a` 逐位元組相同；改版前連跑兩次相同；以 CNS 跑則 14/14 不同。kit 在 `tests/kit/standard-baseline.kit.ts`（暫存、**不提交**），比對腳本 `scratch/cmp-baseline.cjs`。
- **驗證結果**：
  1. 驗收 1-8 通過：typecheck、四項 lint、單元測試 496 檔通過、5 略過，6270 項通過、30 略過、0 失敗。
  2. 驗收 1-9：完整 `verify:ui` 280 列，278 通過。`manual-drawing-linked.js` 是本次造成（置中檢查以 ISO A3 手算，CNS 圖框右移 5 mm），已改該腳本的新圖為 ISO（一行），單獨重跑通過。**`manual-browser-projects.js` 間歇失敗：單獨 4 次，在變更後的樹 2 次 ERROR、在乾淨 `db051b9a` worktree 1 次 ERROR，每次卡的步驟不同（計時競爭）。不是本次造成，但沒有修好；依 AGENTS §3.6 須使用者同意延後，尚未取得（見下）。**
- **未完成**：
  1. **`manual-browser-projects.js` 已獲使用者同意延後（2026-11-19）**：間歇失敗（乾淨 `db051b9a` 同樣 4 次中 1 次失敗），不是本次造成，另案處理（計時競爭，每次卡的步驟不同）。下次動 e2e 或專案管理時修掉。
  2. 修正後以 `npm run verify:ui -- --only "manual-drawing-linked"` 單獨通過（已做）；其餘 277 列在改腳本前後程式碼未變，不重跑。
  3. 使用者已同意提交（2026-11-19）；不提交：`tests/kit/standard-baseline.kit.ts`、`.claude/launch.json` 的 progress 設定。
  4. 清理：`.claude/worktrees/p1-baseline`（乾淨 commit 的 worktree，含 `npm ci` 的 node_modules，供重現用）與 `scratch/` 的日誌；刪除前須使用者同意（AGENTS 全域規則第 8 條）。
- **已修改（已隨 `33ac36f7` 提交並推送）**：`apps/mcp/src/drawingSession.ts`、`apps/mcp/src/drawingTools.ts`、`apps/web/src/components/{DimensionPanel,DrawingPanel,ParametersDialogs}.tsx`、`apps/web/src/options.ts`、`apps/web/src/state/store.ts`、`packages/drawing/src/{dxf,pdf,scene,sheet,sheetRaster,svg}.ts`、`packages/i18n/src/{en,zh-TW}/{drawing,help,output}.ts`、`packages/model/src/{drawing,serialize}.ts`、`tests/phase5/drawing-{annotations,derived,document,layout,linked}.test.ts`、`tests/support/outputScene.ts`、`docs/repository-inventory.md`、`DEV_LOG.md`、`handoff.md`；新增 `tests/phase5/drawing-standard.test.ts`、`docs/adr/0260-drawing-standard-profile.md`。`.claude/launch.json` 多了 `progress` 設定（本機用，不提交）。
- **未解決／注意**：
  - CNS 數值取自 CNS 教材（淡江《機械畫》第 1 章），未讀 CNS 3 原文；A0、A2、A3 的線寬組教材未給（暫取 A1／A4 組）；CNS 最小字高表未讀到。
  - 本期未改：割面線兩端粗線、字高、標題欄（屬後續各期）。
- **進度頁**：`out/progress/`（`index.html`、`state.json`、`server.mjs`），以 `.claude/launch.json` 的 `progress` 設定啟動（127.0.0.1:5480，每 3 分鐘更新；`/live.json` 即時讀 `state.json` 中 `live` 指定的日誌）。用完要停掉，不要留著佔埠。
- **下一步**：開第二期（視圖配置，ADR 另取號：開工時以 `git log origin/main` 確認）。

## 2026-11-19（午）— 「3D 模型自動轉工程圖」審查與修正（ADR 0256 後續，已推送）

- **審查**：讀根目錄「將 3D 模型檔案自動轉為工程圖.txt」對照程式。單頁流程有測試支撐；`71290bc0`／`56a97b3b` 的多頁與局部放大圖延伸不完整，且文件多處與程式不符。審查文件已更正並一併提交。
- **第一批（`f6211bb3`，已推送）**：`drawing_complete` 不再於第 1 頁重複標註已移到第 2 頁的尺寸；DXF／SVG 每頁一個檔（`名稱-n.ext`，回傳 `files`）；公差、註記、字高、`drawing_inspect` 看得到每一頁，`drawing_apply` 有 `pageIndex`；詳圖取父視圖在圓內的特徵。
- **第二批（本次提交）**：頁名與詳圖名經 `t()`；詳圖比例保證圖紙直徑 ≤ 52 mm，並由 `enlargeDetails` 確保大於所在頁比例；B-B 無剖切位置時不建；App 的 DXF／SVG 輸出顯示中的頁，多頁時檔名帶頁碼並提示；ADR 0256 補記多頁行為。
- **驗證**：`apps/mcp/test/drawing-pages.test.ts`（修正前紅、修正後綠；6 項突變皆轉紅）、單元測試 57 檔 535 過 1 略過、typecheck、四項 lint、`mcp:build`、完整 `verify:ui` 280／280 PASS。
- **仍未處理（已寫入 ADR 0256 補記）**：
  1. 詳圖直徑 ≤ 52 mm 的斷言在測試零件上成立，但沒走到舊程式超出的分支，無突變證據。
  2. 隱藏線移除只看比例（≥ 35%），不判斷剖面是否真的揭露該視圖的隱藏特徵。
  3. 第 2 頁觸發條件是微圓角「計數 ≥ 4」，不是密集度；未被選入群的微圓角留在第 1 頁。
  4. `R1-8032_Rev08_2D_完整修訂.3dbx` 的實機數字不在 repo，未重現。
  5. App 的 DXF／SVG 一次只輸出一頁（避免瀏覽器連續下載的權限詢問），其他頁需切換後再輸出。
- **下一步建議**：若要驗證 R1-8032 數字，請提供該 `.3dbx`，以 `drawing_create` 重跑並把 `checks` 存進 repo。

## 2026-11-19 — 「保留輪廓內」已交付並推送；pull 後新基準完整關門全綠

- **功能**：伸長除料多一個「保留輪廓內」勾選框——只在終止型態掃到的範圍內留下輪廓內的材料、拿掉範圍內輪廓外的材料；**範圍外的材料完全不動**（草圖平面另一側不動）。範圍隨終止型態自動對上（給定深度／完全貫通／成形至某一面／成形至下一面／頂點／本體／平面對稱／雙向）。拔模供給錐度：拔模在 `Kernel.sweep` 內施加，早於任何布林，只歪牆、不改掃描軸上的長度，所以範圍不變而範圍內留下的是斜出來的那一塊。
- **位置**：命令層 `setKeepInside`；引擎層 `Engine.keepInside`／`Engine.extentOf`（`packages/regen/src/engine.ts`）。ADR [0231](docs/adr/0231-keep-inside-extrude-cut.md)（語意已被取代，保留為當時的決策紀錄）與 [0232](docs/adr/0232-keep-inside-reach.md)（現行語意）；說明文字 `help.extrudeCut.body`，介面提示在 PropertyManager 的除料選項。
- **驗證**：交付基準上整輪 `npm run check` exit 0（361 個測試檔通過、4 個略過），完整 `npm run verify:ui` 266/266 PASS（私有埠 5395，含 `tests/e2e/manual-keep-inside-extrude.js`）。pull 後新基準 `bb9eb8d3` 再跑整輪 check：494 檔通過、5 略過、6225 項通過、30 略過、exit 0。
- **狀態**：兩個提交（`440eaf6` 功能、`0e78483` 文件與現況）已推送，main 與 origin/main 同在 `bb9eb8d3`。本次只補文件，未改產品程式。

## 2026-11-19 — 剩下 5 件能否以「照片／工程圖＋Agent 協作」解決（討論結論，程式未改）

- **使用者目標**：35 件中一直無法完成的 5 件（part-3、part-4、E13、MT17203、治具）要能完成。
- **照片（多視角拍 STEP）：不採用。** 精確的 B-rep 拍成照片只會丟資訊；Agent 要看模型時，用 `render_view` 就能算圖。5 件的阻擋都不是「看不出是什麼」。
- **Agent 讀工程圖、提出特徵順序 → kernel 以精確偏差比對裁決**（不放寬 τ）：
  - **part-4：最適合。** 每一面牆都已精確讀出（≤ 7.6e-13），缺的是「哪幾個特徵、以什麼順序互相裁切出那個斜向孔」（設計文件 §6q，兩種已核准的構造都失敗）。工程圖可能直接畫出這個孔。可信度約 50%：圖面可能沒畫到，OCCT 也可能建不出來。
  - **part-3：部分。** 可協助推出蓋子缺口區；r0.127 倒角是 OCCT 的極限（§6t），依 2026-11-18 的「選項 2」不重現。
  - **E13（缺 C3 錐形螺紋）、MT17203（變半徑面＋48 張雙三次曲面片，需 C5）、治具（記憶體容量）：幫不上**，缺的是能力或容量。
- **工程圖本身**：照現行驗收（與 STEP 的誤差 ≤ τ）救不了 E13、MT17203、治具。它的價值是設計意圖（例如圖上寫 R0.4，證明 0.3862～0.3871 是匯出雜訊；螺紋規格），以及另一種驗收標準「**符合工程圖尺寸與公差**」。改用這個標準時，E13（標準錐形螺紋，須先確認螺紋特徵支援錐度）、MT17203 的圓角大概可行；沒有標註的曲面片仍無依據；治具仍不行。**這是推測，尚未看過任何一件的圖面。**
- 改驗收標準等於改寫 2026-11-10「1e-6、不放寬」的裁定，代價是：重建模型與 STEP 有可量到的差異，要逐項列出；35 件會分成兩種驗收。**須使用者明確同意，尚未裁定。**
- **使用者決定（2026-11-19）：等另一台電腦的 STEP 特徵化任務結束後再討論。** 屆時待決：
  1. 要不要用 part-4（R1-9035）＋它的工程圖試做「Agent 提出特徵順序 → 探針精確比對」（只寫探針、不改產品程式；驗收：各面 ≤ 該面 τ、體積差在 τ 級、35 件中 30 件不退步，失敗就停並回報卡在哪一面）。需使用者提供圖面。
  2. E13、MT17203 要不要改為「符合工程圖公差」驗收。需先看這兩件的圖面。

## 2026-11-18（夜）— part-3 Stage 0′ 重試停在第 1 步（探針，產品程式未改，未提交）

- 銳邊窗口本體做不出來：f80 拔模工具精確（牆誤差 1.13e-6），但「f80 工具 ∩ f79 半空間」不是真實窗口空處（f81 離重建圓角 1.11 mm；邊跨 z 20.598–15.687，原件只 15.478–17.005）。窗口空處由 f15／f75／f77／f69／f68 等面界定。沒有 OCCT 圓角重建與逐面比對的結果，故 part-3 倒角能否重建仍未知。
- 代理量測：45° 薄板加拔模樣條窗口，OCCT 圓角 r 0.127 成功率 37／40 與 35／40，只說明 OCCT 圓角在樣條牆邊緣鏈上多數能做。
- 詳見 DEV_LOG 同日條目；探針 `scratch/ff/c14a|c14b|c14c.test.ts`、`c14lib.ts`（不追蹤）。part-3 STEP 在 `D:DB實機確認	mp\`。Stage 1 未開始，等使用者決定。

## 2026-11-18（傍晚）— S3 使用者端 Claude Code 實測完成（ADR 0238 收尾）

- 使用者在自己的電腦用 Claude Code 2.1.325 連上執行中的 App（`npm run dev`），**手動實測通過**：貼連線碼後狀態列顯示「AI 已連線」；AI 用 `apply_commands` 建圓柱 r=10、h=20，特徵樹出現 `Cylinder sketch`＋`Cylinder`，GUI 體積 6283.185 mm³（π·10²·20）；GUI 按一次復原，草圖與伸長整批撤回，`part_summary` 回報零件為空；重做後圓柱回來；GUI 改名後 `part_summary` 顯示新名稱。
- **拒絕路徑（編輯中、組合件、工程圖）沒有手動實測，只由 `scripts/verify-live.mjs` 自動驗證**：同日在使用者的 Windows 電腦上執行，PASS（GUI 連線、真實幾何與特徵樹、整批復原、使用者編輯、新文件、編輯中／工程圖被拒、組合件即時操作、BOM、中斷連線）。
- 使用者裁定（2026-11-18）：S3 標為「使用者端已驗收」，並註明拒絕路徑僅自動驗證。
- `apps/mcp/dist` 已用 main `e96953ef` 重建（Linux 沙盒內以暫存設定打包；舊版備份在 `scratch/mcp-dist-20261117`，`dist/` 與 `scratch/` 皆不追蹤）。此版若在 Windows 出問題，執行 `npm run mcp:build` 重建即可。
- 待辦表第 1 項已完成；下一項是第 2 項（推進 part-3），開工前須先核准設計文件 §6o-B 的驗收清單。

## 2026-11-18 — 工程圖多頁輸出與多頁細節視圖（ADR 0256 後續，已合併進 main）

- `71290bc0` feat(mcp-drawing)：多頁細節視圖與 A3 配置。細節視圖所在頁若有 detail 視圖則改用 A3，細節視圖以空白矩形自動排版（欄／列計算、等距分佈）；A-A 剖面若有 ≥2 個微半徑，於 Page 2 建立參考副本；細節視圖尺寸被整理掉時自動刪除該視圖。只改 `apps/mcp/src/drawingSession.ts`。
- `56a97b3b` feat(drawing)：平衡多頁版面、隱藏線隱藏、輪廓附著的標尺。修改 `apps/mcp/src/drawingSession.ts`、`packages/drawing/src/dimension.ts`。
- 兩個 commit 已推遠端，main 與 origin/main 同步（`56a97b3b`），新電腦 `git pull` 後即可直接使用。

## 2026-11-18（稍後）— `analyticFace` 讀同軸圓弧直紋條（ADR 0258，分支 `claude/frosty-swartz-ff451c`，PR 待使用者合併）

- 已做：先由軌線讀「單向直紋、兩條軌線是同軸圓弧」的面為圓錐／圓柱（`packages/kernel/src/coaxialStrip.ts`、`Kernel.coaxialArcStrip`），成立就不再問 OCCT。實件、fuzz（160 讀＋60 近似失誤）、錯型別防呆、heap、突變都通過；詳見 ADR 0258 與 DEV_LOG。
- **更正上一條**：E13 的四片不是精確圓錐，是扇開的近似圓錐（只在 3.78e-5 內），在檔案縫隙 3e-7 下被拒是對的，所以 E13 不會 7 → 3（要放寬容差才會，不做）。MT17203 的四片在 τ 內，已讀到（84 → 80）。
- 35 件稽核：30／35 不變，0 退步；E13 7 → 5 是兩片螺紋收尾細片在其大縫隙下被讀成圓錐（證據薄弱、結果不變，已記錄）。
- 細片在大 τ 下的讀取：使用者 2026-11-18 決定**維持現狀**，不另加門檻。實件測試需 `REAL_STEP_DIR=D:/3DB實機確認`；暫存乾淨基準 worktree `.claude/worktrees/c13-base`（`9fac7668`，含 `npm ci` 的 node_modules）待使用者同意後移除。

### 待辦任務總結（可點選項目，新電腦接手時優先從上面開始）

下列項目依建議優先順序排列，可直接對照 `scratch/pending-choices.html`（本機，git-ignored）點選確認。

| # | 任務 | 狀態 | 建議 |
|---|------|------|------|
| 1 | **S3 使用者端 Claude Code 實測**<br>在另一台電腦用 Claude Code 連上 GUI，確認 AI 能真正操作零件（建模、復原、改名、拒絕非零件／組合件／工程圖）。操作見 `docs/handoff-s3-prompt.md`。 | ✅ 已完成（2026-11-18）：手動實測通過，拒絕路徑僅由 verify-live 自動驗證 | 🟢 已完成，使用者端已驗收。不需再做。 |
| 2 | **推進 part-3（拔模樣條牆＋滾球辨識）**<br>利用「拔模樣條牆辨識」與「以樣條牆為支撐的滾球辨識」推進 part-3（設計文件 §6l B 型區域）。實件稽核 30/35，0 退步。 | 進行中 | 🟢 若要繼續做特徵辨識，這是最自然的下一步。 |
| 3 | **核定 PR #11：圓角截面散度閘門 1e-3 → 1e-2**<br>PR #11 把閘門放寬，還沒核定、未合併。part-3 仍被拒絕，部分與此閘門相關。 | 待核定 | 🟡 建議先不要匆促合併。先用真實零件驗證，或至少看 PR #11 測試數據後再核定。 |
| 4 | **維持擱置：part-4、MT17203、E13、C5**<br>part-4（C4-2／C4-3 不刪面的多方向分解）已裁定先擱置；MT17203 接合誤差未量；E13 需 C3 螺紋；C5「控制點可編輯曲面片」未開工。 | 已擱置 / 未開工 | 🔴 建議維持擱置，把精力放在項目 1 與 2 上。恢復 part-4 前先做 C4-3 可行性閘門探針。 |
| 5 | **工程圖多頁輸出與多頁細節視圖（ADR 0256 後續）**<br>已合併進 main：<br>• `71290bc0` feat(mcp-drawing)：多頁細節視圖，A3 配置、特徵凝聚（同一特徵的尺寸放在同一視圖）、細節視圖尺寸被整理掉時自動刪除該視圖。<br>• `56a97b3b` feat(drawing)：平衡多頁版面、隱藏線隱藏、輪廓附著的標尺。<br>修改檔：`apps/mcp/src/drawingSession.ts`、`packages/drawing/src/dimension.ts`。 | 已合併進 main（`56a97b3b`）；2026-11-19 審查修正多頁缺陷（見最上方） | 🟢 已完成，新電腦直接從 main 開工即可。 |
| 6 | **組合件 MCP 後續：③ 多張照片建組合件、④ 各客戶端驗收**<br>順序：① 交付輸出 BOM／組合件 STEP（已完成）→ ② GUI 即時連線（ADR 0253）→ ③ 多張照片建組合件 → ④ 各客戶端驗收。③ 需使用者提供實物照片與實測尺寸；④ 需在各客戶端核准工具。 | ①② 已完成，③④ 待使用者配合 | 🔴 需等 S3 實測完成後，再視需要啟動。 |

**接手守則**：開始前執行 `git status --short --branch`、`git fetch origin`、`git log -8 --oneline`；工作區不乾淨時先辨識在途變更，不直接 pull 或覆寫。實件 STEP 位於 `D:\3DB實機確認` 根目錄；`scratch/` 進度頁與稽核腳本另存於 `handoff/scratch-tools` 分支。

## 2026-11-18 — E13-999-421 與窄圓錐條讀取缺口（設計文件 §6r，產品程式未改）

- E13 的 7 個被拒面：f22／f23／f24 是**錐形螺紋**（辨識沒有螺紋特徵）；f71／f73／f74／f75 是同一個 0.8727° 圓錐的窄條，OCCT `GeomConvert_SurfToAnaSurf` 讀不到（1e-3 時還錯讀成圓柱）。MT17203 也有 4 片同樣的窄圓錐條（49.85°）。
- 未修：修了也沒有任何一件會通過。建議作為獨立工作：`analyticFace` 在 OCCT 回 null 時，直接判斷「兩條軌線是同軸圓弧的直紋面」→ 圓錐／圓柱；需 fuzz、35 件稽核不退步、錯型別防呆。
- 35 件現況 30 通過；剩下 5 件各有不同阻擋（多方向互切特徵、錐形螺紋、90 多個自由面、記憶體預算），沒有單一能力可讓任何一件通過。

## 2026-11-17（晚）— part-3 Stage 0′ 與 part-4 的探針：都在關卡停下，產品程式未改

- PR #11（`ARC_SPREAD` 1e-2 等）已合併到 main（`3a26a3c4`）。
- **part-3**（設計文件 §6p）：B 區七個 r 0.127 邊緣倒角都是球，但刪面做不出銳邊本體（f152 單獨 70.8 s 拋出）；局部盒測試因盒端面連對照組都失敗，無法回答。停止。
- **part-4**（§6q）：f11、f173、f174 都是直伸長牆（產品的 `faceExtrudedAlong` 認得），被拒是因為方向不是任何平面的法向；f171–f174 是一個圓（r 10.731434）固定平面方向沿兩段搬移、左右鏡像（≤ 7.6e-13）。但使用者核准的 A1 兩種構造都不成立（沒有端蓋；孔工具與本體重疊 322／225 mm³）：孔的範圍由其他特徵界定。依停止條件結束，未動產品程式。
- **下一步建議**：part-3、part-4 都需要「多個方向不同、互相裁切的特徵」的辨識，不是單一能力；開工前先決定要不要投入這個方向，或改看 E13-999-421（7 面，`c11a` 在 300 s 內未完成，卡在哪個呼叫尚未追）與 MT17203（84 面）。
- 探針在 `scratch/ff/c10a`–`c12e`（不追蹤）；實件在 `D:/3DB實機確認`，跑探針前 `export STEP_DIR=...`，以 `scratch/ff/c5a-run.mjs` 各自一個行程執行。

## 2026-11-17 — AI 協作出工程圖（ADR 0256，Claude 對話，**未提交，額度用完中止**）

- 需求（使用者原話整理）：借鑒 CADCraft 優化工程圖；與 AI agent 協作，指定 3D 模型後以簡單互動自動完成工程圖；公差與標註可任意追加；原則是 **fully determine 所有特徵尺寸**、滿足用戶標註、自主建立剖面與視圖；標註須符合機械設計規範、**不可重疊干涉、不可亂碼**；**字體大小適中，可統一也可個別調整**。決策與範圍見 [ADR 0256](docs/adr/0256-ai-drawing-collaboration.md)。
- CADCraft 是純 2D 製圖軟體，沒有 3D→工程圖；借用的是 QDIM（基線／座標尺寸）、MCP 自檢（selfCheck）、`render` 算圖讓 agent 看圖。
- **程式碼在雲端工作副本，以 GitHub main `c57e935` 為基底**（本機 `2372331` 落後 5 個提交，ADR 0255 已被使用，所以本案是 0256）。全部變更寫成 `scratch/claude-takeover/ai-drawing-0256.patch`。接續步驟：
  1. 本機 `git checkout -- handoff.md DEV_LOG.md`（本段與 DEV_LOG 條目也在 patch 內），`git pull`。
  2. `git apply --index scratch/claude-takeover/ai-drawing-0256.patch`，`npm ci`（若 package-lock 有變），`npm run typecheck`。
  3. 跑 `npx vitest run apps/mcp/test/drawing.test.ts tests/phase5/auto-drawing-plan.test.ts apps/mcp/test/e2e.test.ts`，再跑**全量** `npm test`（雲端全量在額度用完前未跑完，結果未知）。
  4. `npm run mcp:build` 後在 Claude Code 實際走一次：part_save → drawing_plan → drawing_create → drawing_tolerance／drawing_annotate／drawing_text_size → drawing_export，開 `.3dbd` 於 App 目視。
- 新增／修改的檔案：
  - `packages/drawing/src/autoDrawing.ts`：主視圖評分 `rankMainViews`、投影視圖 `chooseProjections`、剖面建議 `adviseSection`（切線沿被隱藏孔軸）、**完全定義圖** `planDrawingDimensions`／`dimensionCoverage`（每個軸向的位置以尺寸串到基準、每個孔／弧／圓角大小各一次、`n×Ø` 涵蓋同尺寸、隱藏線上不標）。
  - `packages/drawing/src/sheetRaster.ts`：無瀏覽器整張圖紙 PNG，TrueType `glyf` 字形輪廓（含複合字形），缺字規則與 PDF 相同。
  - `packages/drawing/src/overlap.ts`：`clutterOf`（文字壓字、文字被他線穿過、尺寸數字被自身延伸線穿過、尺寸線／引線互穿、尺寸線穿入他視圖、視圖標題落入他視圖；延伸線互穿依 ISO 129-1 不計）。
  - `packages/drawing/src/scene.ts`：圖元加 `owner`（只供檢查）；表面粗糙度、幾何公差框、基準、未指定字高的註記依全圖字高縮放。`arrange.ts`：行距可依字高調整。
  - `packages/model/src/drawing.ts`：`ViewCaption.height`（1.8–20 mm，選填）。
  - `apps/mcp/src/drawingSession.ts`、`drawingTools.ts`：13 個工具 `drawing_plan／create／inspect／tolerance／annotate／text_size／complete／apply／undo／picture／save／export／open`；`session.ts` 加 `drawingSource()`、`root` 改 public；`server.ts` 註冊；`reference.ts` 的 INSTRUCTIONS 加協作流程；`apps/mcp/README.md` 加說明。
  - 測試：`apps/mcp/test/drawing.test.ts`（平板 3 孔、階梯塊＋盲孔自動剖 A-A；公差、Ra、平面度、註記、字高統一／個別／越界拒絕、刪尺寸後自檢與補回、PDF 無缺字）、`tests/phase5/auto-drawing-plan.test.ts`（200 個隨機零件 fuzz＋檢查規則）、`apps/mcp/test/e2e.test.ts` 工具清單；`tests/kit/auto-drawing-golden.kit.ts`（金樣零件實測，**尚未跑**）。
- 已驗證（接續至 2026-11-17 晚，基底 `c44f977a`）：`docs:sync`、`typecheck`、四項 lint（`rules`/`deps`/`i18n`/`repo`）、`npm run mcp:build` 通過；`drawing.test` 4/4、`auto-drawing-plan` 7/7、`e2e` 8/8；`packages/drawing`、`packages/model`、`apps/mcp`、`tests/phase5` 共 96/96 檔通過；金樣零件 `auto-drawing-golden` 4/4 出圖通過（153s）；全量 `npm test` 446/452 過 + 5 檔沙盒限制於非沙盒 50/50 過 + `iges-fuzz` 單獨重跑過（781.9s）。兩張測試圖目視確認無重疊、中文正常（Linux 需 CJK TrueType 字型，雲端裝了文泉驛；Windows 用微軟正黑體）。
- **未完成**：35 個 STEP 目標實測、App 端一鍵按鈕、斜面／倒角自動標註（目前自檢列為缺漏）、局部放大圖、符號（Ra／框／基準）的個別字高、進度頁本階段最後幾項。

## 2026-11-17 — 除料陣列與鑽頭樣本重建（ADR 0257，Claude 對話）

- 完成 [ADR 0257](docs/adr/0257-pattern-of-cuts.md)：除料特徵可以陣列（以工具計算與除料），算不出種子做了什麼時錯誤歸陣列。鑽頭樣本依 ADR 0254 指引重建：參考軸、溝與柄槽各一再環狀陣列、估計值標記、四個資料夾，形狀不變。
- 驗證：typecheck、四項 lint、golden 3 檔 13 項、突變 5/5、含陣列／鏡射的既有測試 15 檔、真瀏覽器樹驗收 8 步；CI 清單與 MCP、packages、apps/web、tests/phase3 的結果見 DEV_LOG。全套 `tests/` 由夜間 CI 跑。
- **狀態（2026-11-17 晚）**：遠端 main 已有 PR #11 等新提交（含另一份 ADR 0255「拔模樣條牆辨識」），本次改動已 rebase 到 `c57e935e` 之上，ADR 改號為 0257（0255 為拔模樣條牆，0256 為另一個對話的 AI 工程圖）；已提交在本機 main，**尚未推送**（Cowork 只能 fetch、不能 push）：在 Windows 終端機執行 `git push`。
- rebase 後已通過：typecheck、四項 lint（`docs:sync` 已重算清單）。golden 3 檔、含陣列／鏡射的既有測試、MCP 測試在 rebase 後的重跑沒有等到結果（額度用完）；遠端的新提交沒有改 `engine.ts`，但改了 kernel 的圓角關卡與辨識。接手先跑：`npx vitest run tests/golden tests/phase3/pattern.test.ts tests/phase3/mirror.test.ts tests/phase3/curve-pattern.test.ts` 與 `npm test -- apps/mcp/test --maxWorkers 1`，推送後看 CI。
- MCP 已在雲端副本建置後換進 `apps/mcp/dist`（rebase 前的內容，MCP 說明文字與 rebase 後相同）。
- 已知限制：圓角／導角等可能同時加減材料的種子，在共面很多的本體上陣列仍失敗。若要處理，需要另一種取得種子結果的方法（例如保存圓角前後的局部面），另開工作。

## 2026-11-17 — part-3 不經刪面的探針與圓角關卡放寬（PR #11，含 ADR 0255）

- **ADR 0255**（拔模樣條牆辨識，`aaf17800`）與本次 `1cd6c71c` 同在 PR #11；設計文件 §6n、§6o、§6o-A、§6o-B，DEV_LOG 2026-11-16／11-17。
- **已做**：`ARC_SPREAD` 1e-3 → 1e-2（f152／f154 邊緣倒角是球，偏差 7.9e-4／3.6e-4，在 2τ 內）；fuzz 150 組、突變 2/2；實件 30/35、0 退步；part-3 自由面 16 → 12。
- **探針結論（產品程式未改其餘部分）**：B 型牆的拔模工具牆離原檔 ≤ 4.0e-7 mm，A 型牆 f97 以放樣工具 3.91e-5 mm（使用者已接受，門檻須隨 τ）；填回窗口只要秒級，但圓角會變成溝，part-3 仍被拒。
- **下一步（需使用者先核准驗收清單）**：銳邊還原（`sharpCurve`）＋放樣／拔模工具除料＋圓角於最終本體重建，複合路徑要接受放樣除料。建議驗收清單見設計文件 §6o-B。
- 探針在 `scratch/ff/c9a`–`c9i`（`scratch/` 不追蹤）；在新工作樹跑要先 `npm ci`。

## 2026-11-17 — 拔模樣條牆辨識（ADR 0255）

- 從 STEP 讀回 ADR 0251 的拔模樣條伸長，重建為同一拔模角的一次伸長；沿樣條牆的圓角一併重建。詳見 [ADR 0255](docs/adr/0255-recognition-reads-drafted-spline-walls.md) 與 [開發日誌](DEV_LOG.md)。
- 驗證：fuzz 牆 115/115、圓角 92/92 重建；突變 12/14 轉紅（2 項存活防禦已移除）；實件稽核 30/35、0 退步；完整 `verify:ui` 280/280；typecheck 與 lint 0 錯。
- 未完成：part-3 仍被拒絕（拔模牆不在主伸長方向，需要不經刪面的路徑，設計文件 §6l、§6m）。PR #11 把圓角截面散度閘門由 1e-3 放寬到 1e-2，尚未核定，未合併。

## 2026-11-16 — PropertyManager 窄欄與版面調整

- 遠端 `0ec2e32c` 已保存核准的實作順位和驗收條件。P0/P1/P2 已提交並推送至 `main`（`23723317`），實作位於 `WorkspaceLayout.tsx`、`PropertyManager.tsx` 和 `app.css`，回歸納入 `manual-sidebar-tabs.js`。實測見 [開發日誌](DEV_LOG.md#2026-11-16--propertymanager-窄欄改善決策)。
- 使用者已確認先推送此開發決策，再依 P0 → P1 → P2 實作。首輪以 `Front-Frame.3dbx` 鼻橋草圖的尺寸列作驗收。
- **P0** 在 `PropertyManager.tsx` 和 `app.css` 讓尺寸列依容器寬度換行。公式、單位與結果維持可讀，「設為從動／驅動」有完整的操作目標，內部拘束 ID 可於詳細資訊查看。原 290 px 不應有水平捲動。
- **P1** 在 `App.tsx` 工作區加入可拖曳和鍵盤操作的分隔線。預設以 360 px 試驗，雙擊還原，記住使用者寬度，以必要的模型區寬度限制拖曳範圍。版面寫入使用者偏好，不改變文件歷程。
- **P2** 並排空間不足時使用可收合覆蓋面板。保持同一份面板內容，驗證收合與重開後的未提交公式、捲動位置、草圖選取和相機。驗收含 375、390、768 px。
- 基準參考 [SolidWorks 側欄分隔線與浮窗](https://help.solidworks.com/2023/english/solidworks/sldworks/r_pm_overview.htm)、[FreeCAD 停靠面板覆蓋與收合](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Std_View_Menu.md)、[SolidCraft 欄寬記憶](https://github.com/tangency-labs/solidcraft/blob/main/docs/agent-chat.md#the-panel)。

## 2026-11-15 — 特徵樹改善（ADR 0254，Claude 對話）

- 依使用者對照 SW／FreeCAD／SolidCraft 的要求完成 [ADR 0254](docs/adr/0254-feature-tree-names-estimates.md)：特徵名稱唯一（新增與改名遇重名即拒絕並建議可用名稱）、估計值標記（特徵與變數 `estimate`，schema v96）、曲線與實體分開、「參數(n)」節點、估計值徽章與快速過濾、螺旋不再出現兩次、↳ 標籤不重複、隱藏眼睛平時不顯示、方程式對話框的估計值欄。Agent 指引（MCP `INSTRUCTIONS`、`docs/photo-to-cad.md`）要求變數化、估計值用標記、相同特徵用陣列／鏡射、依區域分資料夾。
- Windows 工作區已用 `npm run mcp:build` 重建 MCP。其他工作區若仍有舊的 `apps/mcp/dist`，也要重建才能使用 `estimate` 標記與新指引。
- **桌面 0.6.0 已發行**。Windows 已從 0.5.0 覆蓋安裝，桌面實測開啟 v96 及舊格式檔案，完整瀏覽器驗收 279/279。0.5.0 仍會拒開 v96。[桌面版版本履歷](docs/desktop-release-history.md#0602026-11-15)
- 鑽頭樣本 `tests/golden/sds-plus-bit.3dbx` 未改：仍用 `est_` 字首與「（估）」名稱、兩條排屑溝各建一次。要不要依新指引重建，等使用者決定。
- 進度頁本工作的階段「特徵樹改善…（2026-11-15，Claude 對話）」已達 15/15。SVG 全貌頁 `scratch/claude-takeover/dev/plan-0254.html` 僅在開啟或重新整理時讀取 `data.js`。
- **Codex 接手驗證**：原來尚待重跑的 6 檔（拔模圓角 fuzz 3／4、滾球圓角 fuzz 2／5／10、截面偏移成本）各自重跑，共 87/87。MCP 重建後單 worker 79/79，模型與說明 224/224，TypeScript、四項 lint 與 Web 建置通過。Windows Chrome 桌面 7 個流程通過，鑽頭腳本八步通過；375／390／768 px 可操作估計值篩選與方程式標記。驗證數字與全量測試原始狀態見 [DEV_LOG](DEV_LOG.md) 本日條目。
- 交付提交為 `feat(tree): unique feature names, estimate marks, curves folder and parameters node (ADR 0254)`。以該提交的 GitHub Actions 推送 run 核對跨平台 CI，並以 `scratch/ci/phase11.mjs` 回填進度。

## 2026-11-14 深夜 — 組合件 MCP 後續 ②：組合件即時連線（Claude Code）

- 完成 [ADR 0253](docs/adr/0253-ai-live-assembly.md)：App 開著組合件並連上 AI 控制時，Agent 的 `assembly_*` 工具操作該組合件；伺服器先試算，新零件檔請 App 從專案資料夾讀取；開檔、新建、存檔留給使用者。協定升為 v2，舊版 App 與新伺服器互相拒絕，**桌面版與 MCP 要一起更新**。
- 驗證：Node 14 項即時連線測試、突變 16/16、`verify-live` 真瀏覽器組合件情境、完整 `verify:ui` 278/278、typecheck、四項 lint（細節 DEV_LOG）。
- 下一步 ③ 多張照片建組合件：需要使用者提供實物照片與實測尺寸。④ 各客戶端驗收需使用者在各客戶端核准工具。
- 進度頁本工作的階段「組合件 MCP 後續 2：組合件即時視窗控制（ADR 0253，2026-11-14）」只用 `scratch/ci/phase10.mjs` 更新。

## 2026-11-14 晚 — 組合件 MCP 後續 ①：交付輸出（Claude Code）

- 使用者同意依建議順序做組合件 MCP 後續：① 交付輸出 BOM／組合件 STEP → ② GUI 即時連線 → ③ 多張照片建組合件 → ④ 各客戶端驗收（理由與契約見[組合件 MCP 計畫](docs/design/ai-cad-control/assembly-mcp-plan.md) D 節）。
- ① 完成：新工具 `assembly_export { path, format: 'step' | 'bom_csv' }`，重用 GUI 的 `stepStructure`／`exportAssemblyStep` 與 `buildBom`／`bomCsv`。MCP 現有 25 個工具。驗收與突變見計畫與 DEV_LOG。
- 圖面（工程圖）未做，① 之後另行評估。下一步 ②：組合件的 GUI 即時連線，延伸零件的 ADR 0238 橋接，需要新 ADR 與完整 `verify:ui`。
- 進度頁另有本工作的階段「組合件 MCP 後續 1：交付輸出 BOM／組合件 STEP（2026-11-14）」，只用 `scratch/ci/phase9.mjs` 更新。
- 本日桌面版發佈為 0.5.0（Release `v0.5.0`，Latest）；0.4.1 只建置未發佈，見[桌面版版本履歷](docs/desktop-release-history.md)。

## 2026-11-14 — 無視窗組合件 MCP

- 18:20 更新：Claude Code 2.1.325 以隔離設定查詢、試組、預覽、套用並儲存 `out/assembly-agent-smoke/claude/claude-jig.3dba`。用新增的 `assembly_open` 獨立重開並求解，兩配合成立，銷 x = −40 mm、保留 1 DOF，干涉 405.396352 mm³，回傳 PNG。Ø10 銷與 Ø8 孔的同心配合成立但會干涉，這是測試特意保留的結果。
- 同時段 Codex 隔離自動測試停在工具核准，尚未儲存。接續驗證 OpenCode 與其他客戶端，再做 GUI 版本衝突及原生歷史批次操作。

- 隔離分支 `codex/assembly-mcp` 完成首批五個工具，支援直接插入 `.3dbx`、固定／放置元件、平面重合／距離與圓柱同心、試建 PNG、自由度及干涉，以及儲存 `.3dba`。操作見 [MCP 說明](apps/mcp/README.md)。
- Codex App Server 已從工作樹建置產物列出五個工具，OpenCode 已於隔離設定連線，Claude Code 已發現設定並等待互動核准。MCP SDK 已跑完整 stdio 工作流。
- 15 檔、126 項相關測試通過，typecheck 與四個 lint 通過。這批實作保留於隔離工作樹。
- 後續以同一實例完成各 Agent 互動驗收，再進入 GUI 即時組合件及照片拆件。各客戶端範圍與驗收條件見 [組合件 MCP 計畫](docs/design/ai-cad-control/assembly-mcp-plan.md)。

更新日期 2026-11-14。請先讀最新的照片建模工作。下方舊盤點與「27/30」等數字保留供追溯。

## 2026-11-14 晚 — 組合件互動拆解 HTML 匯出（Codex 實作，Claude Code 接手整合）

- 「檔案 → 輸出互動拆解示意」：作用中爆炸視圖＋BOM 匯出成離線單檔 HTML（`apps/web/src/disassembly/`）。Codex 中斷後由 Claude Code 驗證：typecheck、四項 lint、help 相關 42 項（補 `help-manual` 同步）、完整 `verify:ui` 278/278。細節見 DEV_LOG。
- 使用者裁定（2026-11-14）：先整合互動拆解與組合件 MCP 兩個首版，再發桌面版 0.4.1。組合件 MCP（worktree `codex/assembly-mcp`）接手驗證：typecheck、四項 lint、相關 25 檔 297 項全過，rebase 到互動拆解之後合併進 `main`。
- Codex 以 0.4.0 版號建的驗收包曾覆寫本機正式安裝檔，已從 Release 還原（桌面版版本履歷）。

## 2026-11-14 — 從各 Agent 發起照片建模

- 使用入口與各 Agent 設定見 [照片建模指引](docs/photo-to-cad.md)。Claude Code 使用 `/photo-to-cad`，其他 Agent 附圖後請它依共用指引操作。
- 本機 Codex 已註冊 `3d-builder`，App Server 已找到四個必要工具。自動呼叫受核准閘控。OpenCode 1.17.4 原設定有 `data_migration` 錯誤，隔離設定連線成功。
- 儲存庫維護與 MCP stdio／CLI 測試共 12 項通過。下一步用規則零件的實照及已知尺寸，在互動工作階段驗證辨識、追問、預覽與儲存。其餘 Agent 依設定指引逐一驗證。

## 2026-11-13 深夜 — 修 Nightly：`recognize-approximate` OOM（已提交並推送）

修正提交 `2074f4b4` 已推送至 `origin/main`。截至 2026-11-14 本節更新，三平台推送檢查已通過，[手動觸發的全量 CI](https://github.com/Chun-Chieh-Chang/3D-Builder/actions/runs/43538157639) 仍在執行。

使用者裁定：這不是「既有問題」，本次必須修掉；**commit 前先問使用者**；commit／push 後以 workflow_dispatch 觸發 Repository integrity 確認轉綠。AGENTS.md 已加 §3.6「CI 失敗不得標為『既有』後跳過」與 §4 本次紀錄。下方 22:30 段與 DEV_LOG 的 MCP 條目稱此兩項「既有」**是錯的**，DEV_LOG 已加更正。

- **根因**：C1（`3b1ba1f6`）的 `define()` 改為整批試＋對半，嘗試大小一路遞減，每個都在求解器 overflow 記號之下而 abort，第二次 abort 用掉備用模組後所有求解失敗（C1 前的乾淨 worktree `fb4a966d` 此檔 21/21 過）。底層上限：planegcs 固定 16 MiB（94 段圓弧）。細節與量測見 DEV_LOG 同日（night）條目，探針 `scratch/ci/`。
- **修正**：planegcs 載入時記憶體改 32 MiB（`withHeap`，151 段）；`SOLVER_SAFE_SIZE = 1100`（實測最小失敗 1143）求解前預檢拒絕；`define()` 不送超過剩餘自由度或 1100 的嘗試、第一次 `tooLarge` 即停；說明「100 段」改實測 120；THIRD_PARTY_NOTICES 註明記憶體改寫（版面不符時照原樣載入，保 LGPL 可替換）。
- **驗收**：approximate 22/22；phase8 全部＋兩 fuzz＋MCP recognize 67 檔 1417 過 0 失敗；sketch 套件 264；新測試 `packages/sketch/test/solver-heap.test.ts`、`tests/phase8/recognize-approximate-capacity.test.ts`；35 件稽核 30/35、0 退步（`scratch/ci/audit-nightly-fix.jsonl` 對 `scratch/ff/audit-c41b.jsonl`）；突變 6/6 轉紅；typecheck／4 lint／docs:sync 過。
- **CI 已轉綠**：手動觸發 #202（run 43538157639）全部 job 通過，full-suite 448 檔過、4 檔略過（與 #187 相同的實樣本檔），5463 項通過，耗時 61.6 分。
- **夜間 11→80 分鐘（以 #187、#202 日誌逐檔比對，細節見 DEV_LOG）**：主步驟 27.5 → 59 分；C1 之後新增的 47 個測試檔共 4448 s（其中 27 個 fuzz 檔 3914 s），原有檔案反而 3336 → 2639 s。最慢：drafted-rounds fuzz 五檔各約 300 s、approximate-fuzz-2 301 s、rolling-ball-fuzz-10 280 s。#198 的 80 分（比 #202 多約 18 分）因日誌已 404 無法證實原因。先前本機 `CI=true` 全量因記憶體不足中斷（440 個 worker 啟動錯誤），**沒有**產出逐檔耗時。
- **full-suite 分 8 片平行（使用者同意，2026-11-14）**：`vitest --shard=i/8`，每片仍 `--maxWorkers 2`，`section-offset-cost` 仍單獨跑在第 1 片；第一步印出核心數與記憶體。門檻、逾時、檔案都沒改。vitest 依路徑雜湊分片、不依時間，以 #202 耗時模擬最慢一片約 11.6 分（4 片 20.5、6 片 15.2）。本機 47 個新檔逐一計時已跑完、全過（`scratch/ci/timing/times.tsv`），CI／本機整體 1.32 倍（0.83–1.57）。
- **分片版首輪（run 43549138821）**：7／8 片綠、整輪約 22.7 分；runner 4 核（EPYC 7763）、16 GB。第 2 片「a closed spline」60 s 逾時：是 `2074f4b4` 把它從 2.3 s 拖到 28.7 s（加大記憶體後 `define()` 一路定義到底，631 次求解、467 次多餘）。已修：候選順序把弧心排在其他點之後，同案 4 次求解、約 2 s；新測試鎖「≤ 10 次求解」（突變改回舊順序 632 次轉紅）。phase8＋MCP 68 檔過、35 件稽核 30/35 0 退步；使用者 2026-11-14 同意後 commit 為 `db5a4af0` 並推送。逾時 60 s 未動。
- **分片版確認全綠（run 43561427221，`db5a4af0`，workflow_dispatch）**：integrity 三平台＋full-suite 8 片全過；452 檔、略過同為 4 個實樣本檔；「a closed spline」2.6 s、新容量測試 2.8 s；整輪約 15.1 分（最慢第 7 片）。
- **`--maxWorkers 4` 試跑作廢（run 43563208784）**：我改 workflow 時漏了空格，指令成了 `--maxWorkers 4--shard=…`，`--shard` 失效，8 片各跑整套（取消時 196–401／452 檔、0 失敗、無記憶體不足）。對 4 worker 什麼也沒證明；未合併，main 仍為 2。已加 `timeout-minutes`：integrity 15、full-suite 40。使用者同意（2026-11-14）刪除 `ci/max-workers-4`，並在新分支改正後重試 4 worker、印出記憶體用量。
- **`--maxWorkers 4` 重試，不採用（run 43565198967，`ci/max-workers-4b`，已刪）**：指令與分片正確；記憶體高峰 8.1／16 GB，不是記憶體。第 3、7 片三項逾時（兩個 section 測試的第一項 35 → > 60 s、`recognize-rolling-ball-fuzz-5` seed 46 151 → > 300 s），沒有斷言失敗；最慢的第 7 片反而變慢，整輪 17.8 分（2 worker 15.1）。要用 4 就得放寬逾時（§3.3 不准），故 main 維持 2。重測試變慢的原因未量（推測 4 vCPU＝2 核×2 執行緒，未印 `lscpu`）。
- **待辦（使用者 2026-11-14 裁定先記下，未處理）**：2 worker 下，`tests/phase6/section-spline-isolation.test.ts` 的 smooth=false、`tests/phase6/section-clearance-probe.test.ts` 的 gap 0 各約 35 s（上限 60 s，59%），`tests/phase8/recognize-rolling-ball-fuzz-5.test.ts` seed 46 為 151 s（上限 300 s，50%）。runner 慢 1.72 倍時會到 85–100%，Nightly 可能變紅。處理方式是 profile 後讓測試本身變快，不得放寬逾時（§3.3）。（先前跟使用者說 section 測試 87%，是拿整檔時間比單項上限，錯了，已更正。）
- **依實測耗時分片（使用者選擇，2026-11-14）**：`scripts/test-shards.ts`（最長的先放、放進目前最輕的一片）、`vitest.config.ts` 的 `DurationSequencer`（只在 `--shard` 時生效，本機不變）、耗時表 `scripts/test-durations.json`（以 `node scripts/test-durations.mjs <run id>` 更新）。`section-offset-cost` 改為獨立 job；分片步驟印 `lscpu`。本機空跑 8 片：453 檔不重不漏、每片 882 s 檔案時間（雜湊分片為 381–1501 s）。已 commit 為 `ff6e2db6`。**CI 實測（run 43575495682）全綠，整輪 14.2 → 9.7 分**，最慢一片 833 → 559 s（−33%），但各片 262–559 s 並不平均（檔案時間每輪都在變）。`lscpu`：2 實體核心×2 執行緒，證實 4 worker 變慢的原因。耗時表已改用三輪 CI 各檔最大值（7039 → 7998 s；重型 fuzz 檔各輪差到 1.5–1.8 倍）。
- **下一步**：加新的重型測試檔後，用該晚的 run 更新耗時表（`node scripts/test-durations.mjs <run id>...`；log 會列出沒有實測時間的檔）。

## 2026-11-13 22:30 — Claude Code 接手 Codex：MCP 驗收完成

- **最終驗收（Codex 最後修改之後）**：MCP 全套以全新行程重跑 **10 檔／68 項全過**（`out/mcp-rerun.log`）；`typecheck`、`lint:rules/deps/i18n/repo`、`docs:sync`、`git diff --check` 全 exit 0；ADR 0252 在 `origin/main` 未被佔用。
- **全量測試**（Codex 21:20 啟動，3148.9 s，`out/ai-cad-full-tests.log`）：444/451 檔、5453/5483 項過，4 項失敗。MCP 的 2 項（`cad-tools` 修復耗盡實得 8 次、`e2e` 事件混入前一案例）是該輪早於 21:46 的缺邊防禦與事件隔離修正，vitest 整輪沿用舊的 `cadTools.ts` 轉換；上述全新重跑通過。`recognize-approximate` 2 項單跑同訊息（草圖求解器記憶體不足，68／82 段圓弧），與 2026-11-10 起的既有紀錄一致；本批未動 `packages/regen` 與求解器，lockfile 只新增兩個 workspace 套件。本機未跑乾淨 HEAD 對照，但 CI 排程 Nightly（run 43399671973，2026-11-13 09:14 UTC，跑的是 MCP 修改前的 `a97b0dd1`）同樣只有這 2 項失敗（441/446 檔、5433/5460 項過），可作為對照：此 2 項為既有失敗，與本批無關。
- **使用者裁定（2026-11-13）**：MCP 這批驗收後單獨 commit（不 push）；**STEP 特徵辨識（C4-2／C4-3）先擱置**。擱置前的審查結論：設計文件 §6j 指出 C4-3（不刪面的多方向分解）是最大風險，若恢復，建議先做 C4-3 可行性閘門（scratch 探針量 part-4 正向建構耗時／heap），再寫產品碼。
- **進度頁**：`scratch/claude-takeover/dev/dashboard.html`（SVG 儀表板，30 秒刷新）與原 `index.html` 共用 `data.js`。實件目標依稽核更正為 30/35（治具：可精確重建但 heap 793 MiB 超過 512 MiB 預算）。

## 2026-11-13 — AI 參數化 CAD／MCP 閉環控制（ADR 0252，已完成）

- 已由 `c0d1a704` 併入 `main`：新增 `@3db/cad-protocol`、四個 `cad_*` 工具（診斷＋PNG 回饋、參數修復重試）與無 GUI CLI 指令（`headless` / `render` / `export`），支援 `meshTolerance` 與孔壁持久 `ref` 量測。詳見 [ADR 0252](docs/adr/0252-ai-cad-structured-control.md)、[apps/mcp/README.md](apps/mcp/README.md) 與上方驗收紀錄。
- 實作能力邊界：新工具是明確的數值子集（基本體 box／cylinder、等距倒角、直孔、線性陣列）；進階草圖、表達式及其他特徵仍透過原有 `apply_commands`。請勿把它描述成涵蓋全部 CAD 特徵或能自行判斷所有視覺缺陷。

## Claude Code 接手入口（STEP 35/35 通則化）

- **目前在 `main` 已交付的能力**：C1 精確 NURBS 草圖輪廓（`3b1ba1f6`）、C2 精確滾球圓角核心與雙向曲面偏差積分（[ADR 0248](docs/adr/0248-recognition-compares-by-surface-deviation.md)、[ADR 0249](docs/adr/0249-recognition-allows-the-file-precision.md)）、C4-1 解析面還原通則（[ADR 0250](docs/adr/0250-recognition-reads-spline-faces-as-analytic.md)）、樣條輪廓拔模伸長（[ADR 0251](docs/adr/0251-drafted-extrusion-of-spline-outlines.md)，`088f251c`）。實件稽核目前 **30/35** 可編輯，0 退步（詳見[自由曲面特徵化通則](docs/design/feature-recognition/freeform-generalization.md)）。
- **待辦與擱置項**：
  - `part-4`（C4-2／C4-3 不刪面的多方向分解）：依 2026-11-13 使用者裁定**先擱置**；若恢復，建議先做 C4-3 可行性閘門探針再寫產品碼。
  - `part-3`：可透過「拔模樣條牆辨識」與「以樣條牆為支撐的滾球辨識」推進（設計文件 §6l B 型區域）。
  - `MT17203`（接合誤差未量）、`E13`（需 C3 螺紋）、C5「控制點可編輯曲面片」（設計文件 §6f，未開工）。
- **新電腦／本機實件與工具**：
  - 實件 STEP 位於 `D:\3DB實機確認` 根目錄（非 `tmp/` 子資料夾）。
  - `scratch/` 進度頁與稽核腳本另存於 `handoff/scratch-tools` 分支，可在乾淨工作區以 `git fetch origin handoff/scratch-tools && git checkout origin/handoff/scratch-tools -- scratch && git reset scratch` 取回。

---

## 歷史交接封存

- **2026-11-08 及更早**（含 P1～P4 草圖互動、ADR 0218 移動面、ADR 0220 IGES、ADR 0221 STL、ADR 0227/0228 與早期 STEP 紀錄）：已封存至 [截至 2026-11-08 的交接快照](docs/archive/handoff-through-2026-11-08.md)。
- **2026-10-26 及更早**：見 [截至 2026-10-26 的交接快照](docs/archive/handoff-through-2026-10-26.md) 與 [交接歷史](docs/handoff-history.md)。

---

## 5. 架構規範與嚴格防禦守則 (AGENTS.md Compliance)

接手開發必須強制遵守 [AGENTS.md](AGENTS.md) 中的紅隊對抗與品質準則：
1. **零代理指標原則 (No Surrogate Metrics)**：
   - 測試底層記憶體時，禁止使用 JS Handle 數量；唯一真實指標為 `(oc as any).wasmMemory?.buffer?.byteLength`。
2. **真值存在性防呆 (Ground Truth Existence Defense)**：
   - 監控底層指標時，必須強制斷言基準存在且大於 0（`expect(initial).toBeGreaterThan(0)`），嚴禁使用 `?? 0` 產生恆真式假綠。
3. **門檻零妥協**：
   - 嚴禁放寬數值容差、拉長超時限制或使用 `.skip` 規避錯誤。
4. **主執行緒 0 WASM 架構防禦**：
   - UI 與主執行緒禁止直接載入或執行重量級求解器；幾何求解必須維持在 Web Worker 內執行。
5. **Windows / Worktree 檔案操作守則**：
   - 讀寫檔案一律使用絕對路徑，防範 PowerShell 跨目錄解析異常。
   - 執行 `verify:ui` 期間切勿修改原始碼，避免 Vite 熱重載破壞 E2E 執行。

---

## 6. 常用指令速查 (Quick Reference)

```bash
# 檢查工作區狀態
git status --short --branch

# 靜態檢查（型別、架構依賴、i18n、檔案規範）
npm run typecheck
npm run lint:rules
npm run lint:deps
npm run lint:i18n
npm run lint:repo

# 執行 Smoke 測試套件
npm test -- tests/phase5/repository-maintenance.test.ts tests/phase5/verify-ui-args.test.ts tests/phase8/context-menus.test.ts tests/phase8/view-normal.test.ts packages/sketch/test/solve-options.test.ts apps/web/test/sketcher.test.ts apps/web/test/sketch-pointer-baseline.test.ts tests/phase3/entrance-tool.test.ts tests/phase5/drawing-component-hatch.test.ts tests/phase5/drawing-view-caption.test.ts tests/phase5/drawing-dimension-modes.test.ts tests/phase5/drawing-cone-chamfer.test.ts tests/phase5/drawing-projection-refs.test.ts tests/phase5/drawing-hole-depth.test.ts tests/phase5/drawing-annotations.test.ts tests/phase5/acceptance-5.test.ts packages/model/test/model.test.ts packages/kernel/test/bodies.test.ts

# 建置生產版本
npm run build
```

- **2026-11-18（夜，Stage 0′ 續：旋轉底座＋舌狀材料＋r0.127 倒角鏈；探針 `scratch/ff/c14o.test.ts`，未改產品碼）**：
  1. 底座＝由圓邊量得的輪廓（f65/f15/f70/f77/f69/f68/f67/f76/f66/f74/f73）繞 y 旋轉，取 z>7 的部分；體積 1615.29；(0,8,18.5) 在內、(0,8,12) 在外，兩點與原件一致。圓弧端點需先貼到圓上（量到的值離圓最多約 3e-4 mm），否則無法成線框。
  2. 空處＝f80 牆工具（往下 14 mm 加往上 4 mm，兩段拔模符號相反）∪ f79 半空間 ∪ f72 牆工具 ∪ f71 半空間；r19.05 圓角成功且有效；底座減空處有效，體積 598.89、22 個面。
  3. **阻擋點**：r0.127 倒角鏈在這個本體上**沒有任何一條邊能單獨倒成功**。12～16 條候選邊逐一試（半徑 0.127／0.05／0.02），全部丟出「圓角後的結果不是有效的實體」或「容差 39.7 mm」。逐步二分：底座減 f79 半空間，5 條邊都成功；再減 f80 牆工具，直線邊成功、與樣條牆相接的邊（e34～e39）失敗；之後每加一個牆工具都多一批失敗。
  4. 第一個版本的牆工具在尖端（3.702, −2.759, 20.598）造成容差 39.7 mm 的頂點（工具的角正好落在底座的邊緣上）；改成上下兩段後降為 1e-4，但倒角仍失敗。所以失敗**不是**只由那個頂點造成。
  5. 堆積：128 → 551 MiB（B-spline 布林，§3.5 已知行為，未下結論）。
  6. 沒有做到的比對：七個原件倒角面（f149 f150 f152 f154 f156 f158 f160）的距離、面數、倒角數、體積差。**因為倒角建不出來，這些都是「未驗證」，不是通過。**
  7. 還原：先前試的 `ybox`（以 y 截底座）讓底座變空，與假設無關，已刪除，未下結論。
- **Stage 0′ 判定：未通過。** 阻擋步驟是第 3 步（以 OCCT 倒角重建 r0.127），依 §6s 停止，不繞路。

- **2026-11-18（夜）使用者裁定**：接受 Stage 0′ 結論（OCCT 倒角在此路徑走不通），回頭改設計，不走「還原尖邊再倒角」。Stage 1 原案作廢；設計見 design doc §6t。未提交。

- **2026-11-18（夜）方向 1 量測（`scratch/ff/c14s.test.ts`，只讀原件，未改產品碼）**：原件中倒角面 f149～f160 的 22 條共邊，邊上 25 點到兩側面的距離皆 ≤ 8e-12 mm（邊確實在兩面上）；接縫以邊容差表示。與樣條牆相接的兩條最鬆：e304（f80|f152）邊容差 8.0e-4，為 f80 的 τ 8.8e-4 的 0.90；e305（f81|f154）3.8e-4，為 τ 4.1e-4 的 0.93。其餘 ≤ 0.71 τ。**注意**：ratio 1.000 的幾列（e288、e290、e291）是定義造成的（面的 τ 取自其邊容差），不是量到的貼合，不能當證據。**這只證明原件自身一致；重建的牆（f80 工具離原牆 1.13e-6）與原倒角面的接縫尚未量。**

- **2026-11-18（夜）方向 1 第 2 步（`scratch/ff/c14t.test.ts`，探針，未改產品碼）**：四個窗口（f80、f72、f106、f115）各自以其樣條邊建拔模牆工具（牆誤差皆 1.13e-6，與 c14h 一致），量原件接縫邊（25 點）到重建牆的最大距離。四個窗口數值完全相同：與 f150 的邊 3.83e-5（0.043 τ）、與 f149 的邊 5.3e-8、與圓角面的邊 2.2e-8、**與 f152 的邊 7.97e-4（0.901 τ，τ 8.8e-4）**。全部 < τ，但 f152 邊只剩約 10% 裕度。注意：`wallError` 只取面內部 1/9～8/9 的格點，不含邊界，所以 1.13e-6 不代表邊界附近也這麼準；f152 邊的 7.97e-4 幾乎等於原邊容差 8.0e-4，表示原檔 f80 在該邊附近本身偏離精確拔模面約此值。**未量**：f81|f154 接縫（圓角面的重建）、面數、倒角數、體積差；故仍不是完整驗收。

- **2026-11-18（夜）方向 1 第 3 步（`scratch/ff/c14u.test.ts`，探針）**：r19.05 圓角面（f81、f78、f112、f113）以「牆工具 ∪ 平面半空間，再圓角」重建，量原件接縫（圓角面｜倒角面，e305、e294、e420、e422）25 點到重建圓角的最大距離：四窗口皆 **3.85e-4 = 0.930 τ**（τ 4.1e-4）；兩個有效的牆工具組合結果相同，另兩個組合圓角失敗。首次以「交集」建模得 0.395 mm（955 τ），是模型錯（空處是聯集，見前述更正），已改。距離取「到重建本體任一面」的最小值，可能低估，若別的面更近；接縫點在圓角上，風險低但未獨立驗證。
- **方向 1 目前累計**：四窗口的所有量過的接縫（f149、f150、f152、圓角面）皆 < τ；最緊兩條 0.901 τ（f152）與 0.930 τ（圓角面｜f154）。**仍未量**：面數、倒角數、體積差、蓋子缺口區（f158、f160）。

- **2026-11-18（夜）使用者裁定**：採用選項 2（只辨識到銳邊窗口，r0.127 倒角不重現並在報告列出）。§6s 驗收修訂見設計文件 §6u，待使用者確認後生效；Stage 1 需另行同意。體積差僅有粗估（≤ 約 0.1 mm³／窗口，估算非量測）。未提交。

- **2026-11-18（夜）Stage 1 開工**：ADR 編號 0259（origin/main 最高為 0258）；草案 `docs/adr/0259-part-3-sharp-edge-windows.md`（Proposed）。讀碼結果：複合路徑 `baseOf` 只以 `extrudeBase` 辨識附加塊（analyze.ts:1440），`loftBase` 只收同軸圓形放樣；故切片 2 需新做，不只是放寬型別。尚未寫產品碼或測試。未提交，`docs:sync` 待加檔後跑。

- **2026-11-18（夜）切片 1 的第一個失敗測試**：`tests/phase8/recognize-revolved-window.test.ts`（旋轉杯 r18.5、壁厚 1，穿壁的拔模 1.5° 樣條窗口）。現況失敗：`RecognizeError: 有 1 個面是自由曲面，無法辨識`。讀碼（analyze.ts:1717–1728）找出原因與缺口：
  1. 自由牆的方向只從「平面法向」候選（`planeDirs`）找；杯的窗口拔模軸 z 不是任何平面的法向，所以 `along(d)` 不成立。
  2. 即使放寬方向，後面 `revolveAxis` 路徑會把「含窗口的本體」整個交給 `revolveBase`，旋轉剖面會被窗口切壞。複合路徑 `baseOf` 的附加塊辨識（`extrudeBase`）需要垂直於拔模方向的平面端面，窗口除去的料在杯壁上是圓柱／圓錐端面，不符。
  3. 所以切片 1 需要的是新的演算法，不是放寬條件：**由窗口的自由牆面恢復工具**（拔模軸＝與旋轉軸垂直的候選；牆斷面＝樣條軌線；空處＝工具∪鄰接平面半空間，見 c14e/c14k），旋轉底座取窗口之外的完整剖面，窗口以工具除料。這等於把 c14 探針的配方做成產品程式。
  尚未寫產品碼。測試已入檔（未提交）。`docs:sync` 待收尾時一併跑。

- **2026-11-18（夜）ADR 0259 切片 1 實作（未提交）**：
  1. 產品碼：`analyze.ts` 新增 `revolvedWindow`（`recognize` 原本丟「自由曲面無法辨識」之前先試；不成立回 null，照舊拒絕）；`revolveAxis` 加可略過的面集合。`kernel.ts` 新增 `Kernel.wallRail`：讀牆的「檔案自身軌線」（拔模牆取 `draftedWallOf` 的第一條軌線；直牆取 `extrudedCurveOf`），以封住牆端的平面切回原長，再以 1e-9 去掉多餘節點。
  2. 第一版取牆的剖面當軌線：剖面是近似曲線（105～402 極點），每件辨識堆積增 200～500 MiB，fuzz 中 seed 14、23 撞 512 MiB 預算，累積後 OCCT 陷阱（seed 23、71），之後全數連帶失敗。改用檔案軌線後，軌線 19～35 極點，單件辨識堆積 +0.0（被餘裕吸收，§3.5 陷阱，不據此宣稱無成長）。
  3. 檔案軌線本身是「原曲線＋延長段」再近似（seed 1：386 極點、度 5），端點超出原弦；以弦平面切回後端點與原輪廓一致到 1e-15。未去節點時，重建的拔模伸長在 `curveWall` 的偏移近似失敗（「拔模會讓輪廓收合」），去節點後通過。
  4. 拔模方向：工具沿 d 收窄 ⇔ `lean < 0`（以三個種子的探測伸長實測，探測已移除以省堆積）。
  5. 測試：`recognize-revolved-window.test.ts` 4 項（+1.5°、−2°、直牆、歪斜 0.5°）全過，改動前全被拒；突變（拔模方向反轉）3/4 轉紅（直牆無拔模，不受影響，符合預期）。fuzz 100 組（兩檔）：83 件可建者 **83 件全部重建**、0 拒絕、0 陷阱；17 件為測試件本身建不出（產生器的拔模收合）。三種拔模（無／正／負）各至少一次。
  6. 堆積（`recognize-revolved-window-heap.test.ts`，各自全新堆）：40 次拔模 +1391.9 MiB（約 35 MiB／次），直牆對照 +190.6 MiB；`liveShapes` 不變。窗口本身不做布林，成長屬 OCCT 對 B-spline 運算元（重建與比對），§3.5 類，由 ADR 0126 限制；未宣稱為 0。
  7. phase8 辨識回歸 13 檔 115 項全過（第一版時跑）；`typecheck`、`lint:rules`、`lint:deps`、`lint:i18n`、`lint:repo` 過，`docs:sync` 已跑。35 件稽核進行中。
  8. 範圍限制（照實）：只收「一張自由牆＋至多兩張斜平面」的單一窗口、旋轉軸與拔模方向互相垂直、拔模方向是預設三軸之一；牆端以弦封閉。part-3 的多窗口、圓角 r19.05、f79 平面、A 型放樣牆都還不在此路徑。

- **2026-11-18（夜）切片 1 的 35 件稽核**（`scratch/ff/run-audit-0259.mjs`：`run-audit.mjs` 的副本，不動共用進度頁；結果 `scratch/ff/audit-0259.jsonl`）：實件資料夾已重整（部分檔移入 `tmp\`，並新增檔案，現共 49 檔、84 件，69 件重建）。對基準 `audit-0255.jsonl` 的 35 件：29 件依原鍵、6 件依檔名對上（移入 `tmp\` 者），**狀態全部相同，0 退步**（30/35 重建維持）。唯一差異：MT17203 拒絕訊息中的自由面數 90 → 80；新路徑只在自由面數算完、要拒絕時才嘗試，不改這個數，推斷來自 audit-0255 之後合併的 ADR 0258（未在乾淨 commit 重現，屬推斷）。part-3 仍拒絕（12 個自由面），符合切片 1 範圍。

- **2026-11-18（夜）ADR 0259 補記與切片 2（未提交）**：
  1. 補上 ADR 0259 決定 2 要求、切片 1 漏做的測試：`recognize-part3-default.test.ts`，預設選項下 part-3 仍被拒（「自由曲面」訊息）。實件不入庫，以 `REAL_PART3_STEP` 指定；未設定時略過並顯示。本機以實件跑過：通過。ADR 狀態行改為 Accepted。
  2. 切片 2：`revolvedWindow` 增加直紋牆（兩條軌線各在自己的平面上，平面方向任意）＝一個放樣除料。新增 `Kernel.ruledRails`（軌線、擬合平面、牆對直紋面的逐點偏差）、`Kernel.flatFace`（平的 B-spline 面算窗口的平面；放樣在兩條弦之間做出的就是這種面）、`SectionsRecord`／`Reconstructor.lofted`。
  3. 閘門：牆的偏差 ≤ 原檔在該面的精度／6（下限 1e-7）。實測：拿掉閘門時，軌線彎 1e-2 mm（牆偏 8.98e-4 mm，約 600 τ）仍以體積誤差 2.68e-8 重建成功——整件比對看不到這種偏差，此閘門是唯一的把關。測試含彎曲 1e-5、1e-3 必拒，未彎曲對照必重建。
  4. 突變：關掉放樣路徑 → 3 項轉紅；拿掉閘門 → 彎曲項轉紅。「兩條軌線一起反轉」的突變存活（只反第二條仍全綠：放樣自己對齊截面），依 AGENTS 11-18 第 4 條刪掉該段，並刪掉 kernel 中對應的法向翻轉與其說法。
  5. fuzz 100（兩檔）：100 件全部重建、0 拒絕、0 陷阱，兩個轉向各有（+47／−53）；堆積每檔 50 件 128 → 661 MiB（約 10.7 MiB／件，§3.5，未宣稱為 0）。
  6. 未證實：part-3 的 A 牆能否過閘門。§6o-A 量到放樣離 f97 3.91e-5 mm、τ 約 2.3e-4（τ/6 約 3.8e-5），餘裕很小或為負，且量法不同；留待切片 4 在實件上量。

- **2026-11-18（夜）ADR 0259 切片 3 量測（c17a、c17b；產品程式未改）**：
  1. 「蓋子缺口」是 4 個對稱的缺口（f133～f136，圓柱 r 3.81，軸平行 y，中心 (x ±10.67…13.02, z ±9.525)），只在蓋板 y 17.526（f65）～19.05（f64）之間。y 18.3 的剖面：f92 的直線（z 5.715）→ 相切圓弧 r 3.81（f135）→ 相切直線（f79，法向 (0.996, 0, 0.087)）。y 17.3 以下沒有這段圓弧。所以它是沿 y 穿過蓋板的除料，輪廓為「線－相切弧－線」。
  2. f79 是 B 窗口的側平面，往上延伸成缺口的一面牆；f92 是 A 區的平面，延伸成缺口的另一面。缺口連接 A、B 兩區，不是獨立的特徵。
  3. f135 的軸不在旋轉軸上，旋轉底座做不出來；必須是額外的除料。
  4. 缺口上緣與 f79 一帶的 f155、f157（圓柱、環面 r 0.127）、f159（圓柱 r 0.127）、f158、f160（滾球 r 0.127，偏差 1.48e-4、5.1e-5，約等於當地 τ）都是邊緣倒角，依選項 2 不重現。
  5. f135 周圍三層內 102 面：旋轉面 22、沿 y 的牆 16、y 向平面 2、倒角 33、其他 29（其他為 A、B 窗口的自由面、A 區的斜平面與 r 1.27／0.508 圓柱等，屬切片 4）。
  6. 待使用者裁定設計（見 handoff）：缺口的辨識方式。

- **2026-11-18（夜）切片 3 量測 c17c（蓋板高度剖面的全部邊）**：
  1. 蓋板（y 17.526～19.05）的外形是十字形：沿 ±z 的兩臂寬 |x| < 約 9（端為 r 17.80 的錐面圓弧，即 B 窗口上方），沿 ±x 的兩臂寬 |z| < 5.715（端為 A 區的自由面）；四個內角是 r 3.81 的凹圓柱（f133～f136）。所謂「缺口」就是旋轉底座的圓盤減去這個十字形後剩下的四個象限區。
  2. 每個象限區的邊界：f92 類平面（z = ±5.715）的直線 → r 3.81 相切圓弧 → f79 類平面的直線，兩端再經過 A 牆、B 窗口圓角的自由曲線（bezier）接回外圓。
  3. 對已採納的「剖面差」做法的影響：差異區的邊界含窗口的自由曲線，而窗口牆有拔模、隨高度變，所以「直接把差異區當輪廓、沿軸伸長」不是棱柱，會在其他高度多切或少切。可行的修正：只取差異區中落在平行於軸的牆（直線、圓弧，精確）上的那一段鏈，兩端沿牆延伸到底座外緣之外再封閉；伸長範圍取那些牆沿軸的範圍；最後照常以整件比對驗證。剖面差仍用來找出哪裡有軸向除料、決定高度範圍。

- **2026-11-18（夜）ADR 0259 切片 3 實作（未提交）**：
  1. 使用者先採納「剖面差」，量測（c17c）後同意修正：輪廓取剖面中落在平行於軸的牆上的鏈（線、弧，精確），兩端延伸到底座外緣兩倍外再封閉；剖面差的整個差異區不直接用（它沿窗口的自由牆走，隨高度變，不是棱柱）。
  2. `revolvedWindow`：旋轉軸改取「面積最大的同軸旋轉面群」；平行於軸的牆（含軸方向的平面、平行但不同軸的圓柱）為軸向除料；窗口的面＝牆、平的 B-spline 面、與牆相鄰且傾斜的平面。不論是否找到伸長方向都先試（缺口的平面讓整件走了伸長路徑而被拒）。
  3. `axialCuts`：以邊相連的牆為一組；在所有牆共有高度的中間取剖面（只取組內全部高度會切到蓋板下方，那裡只剩兩段平面殘段，圓角在空腔中）；剖面的邊必須在組內牆面上且在該面頂點的外框內（兩個缺口共用同一個平面，第一版因此串到隔壁象限的線）。範圍取組的高度，端點若有落在輪廓內的底面就停在該處，否則多 1 mm。
  4. 底座半平面：改為「與窗口牆、軸向牆在軸周的角度範圍至少差 2°」；舊的「離面中心與邊中點 30°」對缺口平面無效（平面一路延伸到預設方向附近，中心看不出它到哪裡），四個候選全被拒。
  5. 測試：`recognize-lid-notch.test.ts` 3/3（改前全拒）；突變「不加軸向除料」「端點一律延伸」各使 3 項全紅；切片 1、2 仍 8/8。fuzz 100：可建 87 件全部重建、0 拒絕、0 陷阱，13 件為產生器拔模收合；堆積每檔 50 件 128 → 2288 MiB（約 43 MiB／件，§3.5，未宣稱為 0）。
  6. 未涵蓋：缺口與窗口共用平面（part-3 的 f79）。f79 含 y 方向（法向 (0.996, 0, 0.087)），且不直接與 B 牆 f80 相鄰（中間隔 r 19.05 圓角 f81），依現行規則算缺口的牆：它所在的組（與 f135、f92）高度範圍會涵蓋窗口高度，做出的除料會沿窗口旁往下。這在 part-3 上是否正確，須在切片 4 以實件量測。（初稿寫成「f79 與 B 牆相鄰、屬窗口的面」，與 c17a 的鄰接資料不符，已更正。）

- **2026-11-18（夜）ADR 0259 切片 4 開工：part-3 實件量測 c18a–c18c**：
  1. 現行路徑在 `revolvedWindow` 第一關停下（只接受 1 面非平自由牆，part-3 有 12 面）。
  2. 12 面的身分：B 牆 f72/80/106/115 為直紋面（`ruledRails` 偏差約 3e-14）；A 窗口下段 f97/f129 為直紋面（4.6e-14／9.7e-14）；A 窗口上段 f98/f130 是蓋頂平面 f64 與 A 牆之間的 r 3.048 滾球圓角（v 向 2 次有理、3 極點＝圓弧；每個截面圓半徑 3.04800、圓心到蓋頂 3.04800、到牆 3.0478–3.0480，最大差 2.3e-4；兩端到牆 3.138，因圓角超出牆面的曲面範圍，`rollingBall` 回報的 7.0e-3 即來自兩端）；f145/154/169/181 為疊在 r 19.05 圓角上的 r 0.127 滾球（量到 0.1272）。
  3. 小圓角（r 0.127 類）約 44 面、脊線約 149 mm、材料約 0.5 mm³（由面積反推的估計，非重建量測），為體積 4420.8 mm³ 的 0.012%。
  4. 使用者決定 d3b（ADR 0259 Decision 3）：選項名「略過小圓角（不重建，差異列於報告）」；門檻＝重建件與原件最大面距離 ≤ 略過圓角的最大半徑；體積差只報告不設門檻；任何件可用。
  5. c18d：part-3 的圓角能否先刪除（`deleteFaces`，每個半徑類別各自全新行程）：共 73 面（r0.127×48、r0.508×8、r0.457×2、r1.257×2、r1.270×4、r1.600×3、r3.048×2、r19.05×4）。一次全刪→陷阱（memory access out of bounds）；r0.127、r0.508 各自 600 s 內沒有結果（逾時終止）；r0.457、r1.257、r1.600、r3.048、r19.05 皆回「周圍的面無法延伸補合」；只有 r1.270 成功。結論：「先刪圓角得到銳邊件、再走窗口路徑」不可行；窗口路徑必須在圓角留在本體內的情況下運作（現行 `revolvedWindow` 在圓角處理之前就返回，圓角不會重建）。
- **2026-11-18（夜）ADR 0259 切片 4a 多窗口（`104ab473`）**：
  1. 使用者選擇拆成子切片：4a 多窗口（合成件、無圓角）→ 4b 圓角留在本體內 → 4c 略過小圓角 → 4d part-3。
  2. `revolvedWindow` 接受任意數量的自由牆，每面牆各自一個窗口（拔模或直紋）；窗口的面依牆收集（每牆最多 3 面）；底座半平面須與所有牆與軸向除料保持 2°；預設方向都不清時（part-3 的 ±x、±z 窗口配置），改取繞軸每 1° 中最清的一個。
  3. 測試：`recognize-multi-window.test.ts` 3/3（改前全拒）；突變「只用預設方向」使 2 項轉紅、「只切第一面牆」使 3 項全紅；切片 1–3 仍 11/11。fuzz 100：可建 79 件中 78 件重建、1 件拒絕（seed 57）、0 陷阱；21 件為產生器拔模收合；堆積每檔 128 → 3056／3313 MiB（§3.5，未宣稱為 0）。phase8 辨識回歸 15 檔通過；實件稽核 69/84，與先前相同。
  4. **一次錯誤的修正（已撤回）**：seed 57 被拒在體積差 6.72e-6，但面積差 4.5e-11、對稱差 1.9e-12。單看 seed 57，以 eps 1e-10 積分體積差降為 2.6e-8，我據此把「窗口件比對改用 1e-10」寫進產品碼；全量 fuzz 重跑後拒絕變成 15 件（體積差 1.7e-6～1.4e-4，對稱差皆 ≤ 7.5e-12）。這正是 AGENTS 11-07「樣條伸長 eps 越緊越糟」與「從一類形狀量到的不能照抄」：以一個案例下結論。已撤回（`reconstruct.ts` 與 HEAD 相同）；seed 57 列為已知限制（拒絕是安全側），樣條牆上準到 1e-6 的體積積分另案處理。
- **2026-11-19 ADR 0259 切片 4b 圓角留在本體內**：
  1. 有圓角時，窗口路徑延到圓角讀完之後才跑，圓角留在本體內，最後變成重建窗口邊上的 fillet。`revolvedWindow` 新增參數 `rounds`（要略過的面）；只有在便宜的版面檢查通過時才延後；延後的路徑失敗時，拋出原本的自由曲面拒絕。OCCT 拆成多面、但支撐面相同的圓角，合併成一筆 fillet。
  2. 測試：`recognize-window-rounds.test.ts` 3/3（HEAD 全拒）；突變「不傳 rounds」全紅、「不合併拆開的圓角」loft 案轉紅；`onCuts` 圓角範圍的突變存活，所以把那段刪掉。phase8 辨識回歸 16 檔通過；實件稽核 69/84，拒絕原因與先前相同；part-4 8.0 → 9.5 s（版面檢查的成本；沒有檢查時是 20.2 s，且 4 件拒絕原因改變）。
  3. fuzz 100（25 檔×4 組，產生器最多重試 5 次，使用者選擇）：做出 83 件，**重建 31 件（37%）**、拒絕 37、預算停止 15；0 陷阱、0 錯誤接受；單檔堆積最高 2808 MiB（10 組一檔會到 4 GiB 而陷阱）。
  4. **門檻改變（使用者 2026-11-19 選擇）**：「每檔至少重建 1 件」在 6／25 檔失敗；它量的是產品的重建率，不是 fuzz 有沒有空跑。改為「每檔至少 1 件做出來並走完辨識（重建或拒絕）」；每一件仍須重建成同一實體、被拒絕或被預算停止，陷阱或其他錯誤即失敗。重建率照實記在 ADR，不當門檻。
  5. 已知限制（量到，未修）：OCCT 自己的圓角在隨機窗口邊上多數失敗（c19f）；−15° 傾斜 loft 牆的圓角偏離滾球 9.9e-4，超過提名上限；圓角留在本體內時堆積約 4 倍（seed 85：138 → 562 MiB）；拒絕中約 20 件是圓角沒被提名，約 10 件是重建的 fillet 做不出來。下一步提高重建率，從最多的一類開始。
- **2026-11-19 ADR 0259 切片 4d 第一次量測（4b 之後的 part-3；未提交）**：
  1. 使用者選擇先在 part-3 量現況，再做 4c。part-3 仍以「12 個自由曲面」拒絕。探針 `scratch/ff/c20a`（在 `analyze.ts` 暫時加追蹤，跑完以 `git checkout` 還原，已核對沒有殘留）與 `c20b`（只讀）。
  2. 窗口路徑沒有被採用：版面檢查停在旋轉軸（`revolveAxis`，圓角與圓角候選已略過）。沒被略過的面中，**19 面是繞別的軸的迴轉面**：10 個圓錐繞 y 25.65 處沿 z 的線（半角 0.25°–1°，合計 1226.8 mm²，是主軸以外最大的一群），即橫過主軸的拔模除料；9 個圓錐沿主軸方向但偏離 0.1–0.99 mm（半角 0.06°、0.5°、17.5°），即沿軸的拔模除料。切片 3 的沿軸除料只讀平面與圓柱。
  3. 另有一些不在主軸上、這次被當成圓角候選而略過的面：沿 z 的 r 1.27、r 0.508 圓柱，沿 x 的 r 3.81 圓柱，以及 r 0.127 類。它們是圓角還是除料，尚未量。
  4. 結論：原計畫的 4c（略過小圓角）與 4d 到不了 part-3；還缺「非窗口的除料」：沿軸的拔模除料（圓錐）與橫過主軸的拔模除料。這就是 ADR 0259 風險欄的「Slice 4 may show more missing pieces」，現在量到了。下一步範圍等使用者決定。
  5. 第二次量測（使用者選「先量完整缺口」；`scratch/ff/c20c`，每輪把擋住旋轉軸的面略過再跑一次，只為找下一個停點、不重建；追蹤碼已以 `git checkout` 還原並核對）：
     - 第 0 輪擋住的面共 77 個（兩次辨識嘗試合計）。除上述 19 個圓錐，還有：軸附近 2 個球面（f4、f197）與 7 個傾斜平面（f35、f202、f204、f208、f210、f217、f220；與偏軸圓錐合成軸附近一個小的拔模凹穴，x ±1.3、y −6～24）；±x 側 12 個與主軸既不垂直也不平行的平面（如法向 (0.99, 0.139, 0)、(0.866, −0.5, 0)；f91、f124 各 100.6 mm²）；±x 沿 z 的 r 1.27、r 0.508 圓柱，軸附近沿 x 的 r 3.81 圓柱；r 0.127 類。
     - 第 1 輪（略過那 77 面）：停在底座剖面半平面，**繞軸一圈沒有任何方向有 2° 淨空**。橫向除料旁的平面佔很寬的角度（f192 171.4°、f45 76.2°、f44 與 f191 約 29°），其餘由窗口與沿軸除料佔滿。底座是從一個過軸的剖面讀出來的；part-3 沒有不穿過除料的剖面。
     - 半平面之後（剖面、工具、比對）看不到：要先有另一種讀底座的方法才到得了。
     - part-3 還缺的能力（每一項都是新能力，不是修正）：(1) 沿軸的拔模除料（偏軸圓錐、球面、傾斜平面）；(2) 橫過主軸的拔模除料；(3) ±x 側傾斜平面的除料；(4) 沿別的軸的圓柱（是除料還是圓角，未量）；(5) 小圓角（4c）；(6) 沒有淨空剖面時讀旋轉底座（例如只用同軸面）。遠超過原計畫的 4c、4d。
- **2026-11-19 part-3 的用途（使用者）與不經辨識直接使用的驗證**：
  1. 使用者說明：part-3 只需要在組合件裡使用、量測、出工程圖，不需要可改參數的特徵樹。因此 ADR 0259 不再為 part-3 加切片（切片 1–4b 已推送，對其他零件仍有用）；上面量到的 6 項缺口記錄備查，不排入工作。
  2. 驗證（`scratch/ff/c21a` 以產品的 `stepAssemblyPlan`＋`stepAssemblyFiles` 把組合 STEP 拆成 4 個 `.3dbx` 與 1 個 `.3dba`，寫到 MCP 工作區 `out/agent/part3-use/`；再以 MCP 操作）：
     - 開啟 `R1-10226.3dbx`：匯入本體 227 面，重建 1.2 s，體積 4420.7624、面積 6152.4247。
     - 量測（`cad_inspect_geometry`）：質量性質與上面相同；列出 18 個圓柱孔候選（含 r 1.27、r 0.508、r 3.81 等）。
     - 出圖（`drawing_create`）：2 頁（A2 5:1、A3 2:1），上視、剖面 A-A、B-B、局部 C／D／E、等角；27 個尺寸，X／Y／Z 位置與 56 個圓角都標到，27 個斜面沒有標（自檢 `complete: false`）。
     - 組合件（`assembly_open` `組合圖.3dba`）：4 個零件依檔案位置放好，`valid: true`，第一個固定、其餘 6 自由度，沒有配合。
  3. 順帶看到、未處理的問題（照實記錄，另案）：
     - 包圍盒兩個工具不一致：`part_summary` 為 39.35 × 43.33 × 42.10，`cad_inspect_geometry` 為 40.54 × 43.33 × 53.22（z 多 11 mm）；頂點包圍盒（c20b）z 為 ±21.05，與 `part_summary` 相符。
     - 另兩個零件的檔名是亂碼（`§¨¨.3dbx`、`§¨¨ (2).3dbx`）：STEP 內的產品名稱沒有正確解碼。
     - 工程圖版面：第 2 頁 B-B 標籤超出圖框上緣、「上視」與剖切符號 A 重疊、第 2 頁標題欄空白；第 1 頁有兩個浮在空處的半徑標註（2×R5.08、4×R2.54）。
- **2026-11-19 `cad_inspect_geometry` 的包圍盒偏大（`34f54ba6`）**：
  1. 根因：`Kernel.bounds` 用 `BRepBndLib.Add(shape, box, false)`。在 B-spline 面上它取控制點（極點）再加容差，是給快速判斷用的保守外框，不是本體的範圍。part-3 量到 40.54 × 43.33 × 53.22，實際是 39.35 × 43.33 × 42.10（z 多 11.1 mm）；part-4 46.82 → 48.46。`part_summary` 用網格點，所以兩個工具不一致。
  2. 修正：新增 `Kernel.extent`（`BRepBndLib.AddOptimal`，不加形狀容差），`cad_inspect_geometry` 改用它。part-3 量到 39.349 × 43.332 × 42.105，與網格包圍盒差 < 1e-4。`bounds` 不動：它另有 25 個呼叫端是保守外框（剖面矩形、干涉預篩、貫穿深度、射線長度），偏大是安全的；`extent` 在 part-3／part-4 約 0.4 s，`bounds` 約 2 ms，不適合拿來做快速判斷。
  3. 測試：`tests/phase3/kernel-extent.test.ts`（三種圓柱，解析與 B-spline 面；B-spline 的外框須比本體大 10% 以上，證明測到的是會出錯的情況；旋轉平移後的件；隨機 100 組圓柱，任意旋轉與位移，與解析範圍差 < 1e-6，堆積 128 MiB）；`apps/mcp/test/cad-tools.test.ts` 新增一項（B-spline 圓柱經 STEP 匯入成零件，`inspectBodies` 的包圍盒 = 解析值）。突變：`extent` 改回 `Add` → kernel 測試 2 項轉紅；MCP 改回 `bounds` → 新增項轉紅。
  4. 一次測試順序的問題：新增項第一次放在檔案中間，之後的截圖測試改渲染 B-spline 圓柱，在全資料夾平行執行時 60 s 逾時（單獨跑通過）。沒有放寬逾時，把新增項移到檔案最後，其他測試看到的狀態與改動前相同；全資料夾連跑兩次 86/86。
  5. MCP 伺服器（`apps/mcp/dist`，不入庫）要重新建置並重啟，才會用到新程式；本次沒有用重啟後的伺服器再驗一次。
- **2026-11-19 組合 STEP 的產品名稱亂碼（`ee92e53d`）**：
  1. 根因：`組合圖(R1-10226+R1-10134).STEP` 由 SolidWorks 2020 寫出，字串直接存 Big5 位元組（夾具A ＝ A7 A8 A8 E3 41）。ISO 10303-21 只允許 ASCII，其他字元必須寫成 `\X2\` 跳脫。OCCT 把位元組當成別的字元讀進來，夾具A 與 夾具B 都變成「§¨¨」，兩個零件因此寫成 `§¨¨.3dbx` 與 `§¨¨ (2).3dbx`，分不出誰是誰。探針 `scratch/ff/c23a`：同一個檔案先把字串改寫成 `\X2\` 跳脫，名稱就完全正確，所以讀名稱的程式（`nameOf`）沒有問題。
  2. 修正：`readAssemblyStep` 交給 OCCT 之前，先以新的 `stepBytesAsAscii`（`packages/kernel/src/stepText.ts`）把整個檔案解碼，再用既有的 `escapeStepText` 改寫成跳脫。解碼規則：位元組是合法 UTF-8 就當 UTF-8；否則用介面語言的字碼頁（中文 Big5、英文 Windows-1252），並且回報。整個檔案先解碼再找字串，因為 Big5 字的第二個位元組可能是反斜線（許 ＝ B3 5C）。用了推定的字碼頁時，`StepAssemblyContents.nameEncoding` 記下它，匯入結果加一條警告（中英文字串 `stepasm.nameEncoding`）。
  3. 網頁版的匯入完成通知原本只因為有警告而變成錯誤顏色，警告文字沒有顯示（「組合件沒有零組件」也一樣）；改成把警告文字接在完成訊息後面。這部分沒有自動測試，也沒有在瀏覽器實際操作過。
  4. 測試 `tests/phase3/step-names-codepage.test.ts`：測試用的 Big5 位元組先以平台的 Big5 解碼器核對；Big5 檔在中文介面讀對且回報 big5；同一檔在英文介面依規則讀成 Windows-1252 並回報；原始 UTF-8 在兩種語言都讀對、不回報；標準檔（只有跳脫）與以前相同；匯入產生 `夾具A.3dbx`、`夾具B.3dbx`、`許A.3dbx` 且有一條提到 Big5 的警告；隨機 200 組原始 UTF-8 文字（含引號、反斜線、BMP 以外的字）轉出全為 ASCII，讀回與原文相同。突變 4 種（不轉換、不看語言、不試 UTF-8、不加警告）各使 3／2／2／1 項轉紅。相關回歸 24 檔（STEP、組合件、io）與說明測試通過；typecheck、lint 通過。
  5. 真實檔案（c21a 重跑）：產生 `零件/夾具A.3dbx`、`零件/夾具B.3dbx`，警告「檔案裡的名稱沒有依 STEP 標準編碼，已當作 Big5 讀取……」。
  6. 已知限制：檔案沒有宣告編碼時只能推定。英文介面讀這個檔仍會得到 Windows-1252 的字元（但會回報，且兩個零件的名稱不再相同）。只處理組合件讀取；單一零件的 STEP 不讀產品名稱，沒有改。
- **2026-11-19 待裁決清單（使用者在頁面上逐題選擇，全部採建議）**：工程圖版面問題交給 ADR 0260 工作線（清單見下）；MCP 伺服器重建後重量 part-3；在瀏覽器實際看一次匯入警告；step-100-plan 第 30、31 號改為「不重建（以匯入本體使用）」；教訓寫進 AGENTS.md §4；4c、部分結果模式、4b 重建率、樣條牆體積精度都擱置（ADR 0259 Decision 5）；STEP 名稱編碼規則維持。
  - **給 ADR 0260 工作線的工程圖問題（part-3，`out/agent/part3-use/零件/R1-10226.3dbd`，以 `drawing_create` 產生）**：27 個斜面沒有尺寸（自檢 `slants` 0/27，`complete: false`）；第 2 頁 B-B 剖面標籤超出圖框上緣；第 2 頁「上視」與剖切符號 A 重疊；第 2 頁標題欄空白（第 1 頁有圖名 R1-10226）；第 1 頁「2×R5.08」「4×R2.54」兩個半徑標註浮在空白處，沒有指到圖形；第 2 頁局部 C 的引線起點在圖框外。
  - **瀏覽器實際驗證匯入警告（webwarn）**：以暫時的 e2e 腳本（客戶檔不入庫，跑完已刪）在 `verify:ui` 的無頭 Chrome 匯入真實的 `組合圖(R1-10226+R1-10134).STEP`：樹狀圖顯示「夾具A<1>」「夾具B<1>」，產生 `零件/夾具A.3dbx`、`零件/夾具B.3dbx`；通知文字含 Big5 的警告。**但狀態列寬度不夠，通知在畫面上被截成「……0 個次組合件，…」，警告那一句看不到**（第一次的檢查讀的是元素文字，所以通過了；截圖才看出來）。修正：狀態列的通知加 `title`，滑鼠移上去顯示全文（零件與組合件兩個狀態列）。暫時腳本加了「title 含 Big5」與「通知比狀態列長」兩項檢查並通過；拿掉 `title` 的突變轉紅。既有的 `tests/e2e/phase3-step-import.js` 加一項「通知全文在 title」；`verify:ui --only "step-import|subassembly|phase2-assembly"` 2/2 通過。沒有跑完整的 `verify:ui`（只改狀態列一個屬性，不涉及繪圖層、疊加層、檢視或點選）。
  - **MCP（mcp）**：`apps/mcp` 已重新建置（`npm run build -w @3db/mcp`）。重新連線前 `cad_inspect_geometry` 仍回 z 53.22（舊程式）；使用者以 `/mcp` 重新連線後，part-3 量到 39.349 × 43.332 × 42.105 mm，與 `part_open` 的外框一致（z 42.10）。
  - **清理（使用者要求「清除過時與無效的檔案」）**：
    - 刪除 `scratch/ff` 中未被 git 追蹤、也未被任何追蹤檔（含 AGENTS.md、ADR、DEV_LOG、handoff）以 `ff/<名稱>` 或檔名引用、且不被仍在用的探針引用的 262 個檔（約 13 MB；11-10～11-19 的探針、日誌、`.bak`，含暫存的客戶 STEP 副本）。保留：被引用的工具與基準（`run-audit*.mjs`、`audit-compare.mjs`、`wasm-map.mjs`、`ff.config.mts`、各 `audit-*.jsonl` 基準）、最新稽核 `audit-0259e.jsonl/.out`。`scratch/ff` 17 MB → 1.1 MB。
    - **失誤與還原**：第一版的清單只看「有沒有被引用」，沒先排除 git 追蹤的檔，連帶刪了 `scratch/ff` 內 79 個追蹤檔；`git status` 立刻顯示，已以 `git checkout -- scratch/ff` 全數還原，工作樹乾淨。教訓：刪除 `scratch/` 之前先 `git ls-files` 排除追蹤檔（`scratch/` 並非整個被忽略）。
    - 刪除 `scratch/worktree-0256`（已移除 worktree 留下的空殼；其 `node_modules/@3db/*` junction 指向自身不存在的 `packages/*`，先以 `cmd /c rmdir` 逐一移除連結，再刪資料夾；主資料夾的 `packages/` 與 `apps/mcp/dist` 確認仍在）與 `scratch/mcp-dist-20261117`（11-17 的 MCP 舊建置備份；新建置已在連線中驗證）。
    - 保留 `out/agent/part3-use`（工程圖問題清單指向它，ADR 0260 工作線要用）、`scratch/claude-takeover`（多台電腦共用的進度頁）、根目錄 `Claude outputs/`（非本輪產生，來源不明，未動）。
    - 背景進度儀表板 `plan-dashboard.mjs` 已停止；part-3 進度頁標為「本輪結束」，e1～e7 標「不適用」（ADR 0259 Decision 4／5）。
