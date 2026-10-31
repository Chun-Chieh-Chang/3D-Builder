# 交接與接續工作 (Handoff for Claude Code)

更新日期：2026-10-30。接手請優先閱讀本檔、[產品現況](docs/project-state.md)、[AGENTS.md](AGENTS.md) 與 [草圖互動改善方案](docs/design/sketch-interaction/plan.md)。  
在進行任何操作前，請先執行 `git status --short --branch` 與 `git log -5 --oneline` 掌握最新狀況。

---

## 1. 接續入口與當前代碼基準 (Current Baseline)

- **目前分支**：`main`
- **最新 Commit**：`5594208` (`perf(sketch): eliminate Map allocation in snap curve hit testing`)
- **遠端狀態**：本地 `main` 已與 `origin/main`（`5594208`）同步。
- **CI 狀態**：GitHub Actions 三平台矩陣（`ubuntu-latest`, `windows-latest`, `macos-latest`）**`✔ 3 / 3` 全數綠燈通過**（Run `40989457377`）。
- **工作區狀態**：乾淨無任何未追蹤或未提交修改。

---

## 2. CI 異常診斷與根治紀錄 (CI Failure RCA & Solution)

### 現象說明與精準定位
- **Commit `5360fda` (`❌ 0 / 3`)**：修改文件與測試但漏同步 `docs/repository-inventory.md`，導致 CI 在第 29 步 `npm run lint:repo` 被守門腳本攔截（Exit Code 1），三平台全數未進測試即中斷。
- **Commit `d66cabb` (`❌ 1 / 3`)**：補齊盤點後 `ubuntu-latest` 全綠通過；但 `windows-latest` 與 `macos-latest` 在 `Smoke test suite` 的 `apps/web/test/sketch-pointer-baseline.test.ts` 報錯：
  - Windows：`AssertionError: expected 10.6264 to be less than or equal to 8`
  - macOS：`AssertionError: expected 9.4315 to be less than or equal to 8`

### 根因分析 (RCA)
`apps/web/test/sketch-pointer-baseline.test.ts` 評測 1000 圖元畫線模式下的指標移動延遲。在無空間剪枝下，每一次移動皆對全部 1000 圖元逐一計算曲線最近點與三角函數，單次呼叫累積數千次浮點運算。本地 10 核心 CPU 測得約 0.63 ms，但 GitHub Actions 雲端虛擬機僅 2 vCPU 且 Vitest 4 workers 同時執行重型 OCCT 運算，CPU 飽和排程延遲導致 p95 溢出 8.0 ms 門檻。

### 矯正措施 (CAPA)
遵守 [AGENTS.md](AGENTS.md) 零門檻妥協原則（不放寬門檻、不 skip），進行架構演算法級優化：
1. **AABB 快速包圍盒剪枝**：
   - 在 `packages/sketch/src/interact.ts`（`hitCandidates`、`snap`）加入點、線、圓之常數時間 AABB 剪枝。
   - 在 `packages/sketch/src/snaps.ts`（`intersectionSnap`、`quadrantSnap`）加入 AABB 剪枝，過濾非游標容差範圍之圖元。
2. **確效結果**：
   - 1000 圖元 `tool: 'select'`：p95 由 0.208 ms 降至 **0.024 ms**（提速 8.7 倍）。
   - 1000 圖元 `tool: 'line'`：p95 由 0.637 ms 降至 **0.146 ms**（提速 4.4 倍）。
   - 18 檔 257 項 Smoke Tests 全數通過（耗時 11.3s）。

## IGES 輸出與輸入（分支 claude/iges-exchange）

最新交付（2026-10-30，分支 `claude/iges-exchange` 已合併 main `d66cabb`）：IGES 輸出（修剪曲面／B-rep，mm／inch）與輸入（「開啟舊檔」及「輸入 STEP／IGES」），Schema 86，[ADR0220](docs/adr/0220-iges-exchange.md)。原取 Schema 85／ADR 0219，與 main 的移動面（Schema 85）及 DXF 匯入（ADR 0219）撞號，合併時改號。壞檔會讓 OCCT 讀取器無窮迴圈，輸入先在拋棄式 worker 限時試讀。eDrawings：OCCT 直接寫出的 6 個檔與 `exportIges` 寫出的 6 個檔（含切半與顏色），使用者皆確認正確。沒有他牌 CAD 的 IGES 樣本。合併後的驗證見 DEV_LOG。

---

## 3. 本批次已完成並確效：圓錐/柱面接縫線消除 (Cone/Cylinder Seam Suppression)

### 需求背景與使用者反饋
使用者回報在多實體/放樣軸模型上（如使用者附圖 `TM0002138.3dbx`），出現了非外形輪廓的「接縫線」（Seam Edges）。
- **目標**：參考 SolidWorks / FreeCAD / SolidCraft 的做法，在 3D 視圖與工程圖投影邊線萃取中，消除同一封閉曲面（如圓錐面、圓柱面）自身 UV 閉合形成的退化接縫線，或相鄰連續同曲面之間的過渡線條。

### 核心實作架構與變更
- `packages/kernel/src/kernel.ts`：
  1. 圓錐端面移動面延伸時，將原圓錐面薄層對齊原圓錐之 `XDirection()`，使延伸後維持單一連續圓錐面，避免分裂為 `#1`、`#2` 兩片曲面產生圓弧切分線。
  2. `Kernel.mesh()` 中過濾封閉週期曲面（圓錐、圓柱、球面、圓環）的自身 UV seam 邊（`adj.length === 1 && oc.BRep_Tool.IsClosed(edge, face)`），同時保留開放自由邊界。
- `packages/kernel/src/sameSurface.ts`：補齊同圓錐面判別（同頂點、同軸向、同頂角與凹凸性）。
- `packages/regen/src/drawingEdges.ts`：工程圖視圖投影中，同步過濾同圓錐面間的共軸圓形過渡線。
- `tests/phase3/direct-edit.test.ts` & `packages/kernel/test/same-surface.test.ts`：加入 `TM0002138` 階梯軸真實幾何測試，斷言僅輸出 6 條輪廓邊，0 條縱向接縫與 0 條切分線（135 項測試全部 PASS）。

---

## 3b. 2026-10-30 P1 第一批與第二批已完成：繪製時輸入尺寸（直線／中心線、圓、矩形、狹槽、多邊形）

- **第一批（直線／中心線、圓、邊角／中心矩形）**：
  - 依使用者確認的四項設計完成並驗收（見[驗收表 P1](docs/design/sketch-interaction/acceptance.md) 與 DEV_LOG 同日條目）：角度 0°～180° 由游標側定方向；部分鎖值 Enter 即完成；鎖值優先於吸附並提示。
  - 變更：`apps/web/src/sketcher/controller.ts`（entry 狀態、`lockSnap`、提交時加驅動尺寸）、`apps/web/src/components/Viewport.tsx` `EntryBoxes`、`apps/web/src/actions.ts`（數字鍵起始輸入、Tab）、`app.css`、i18n `sketch.entry.*`。
- **第二批（狹槽 B05、多邊形 B06 / G16）**：
  - 狹槽（Slot，B05）：第一階段輸入中心線長度與角度，Tab 切換，Enter 前進到第二階段；第二階段輸入槽寬，Enter 完成狹槽；自動建立 `distance`、`angle`、`diameter` 3 個驅動尺寸；幾何圓弧半徑精確相符；單步 Undo 清空實體與尺寸，單步 Redo 恢復；Esc 多階段分層回退。純滑鼠繪製時加真值防呆，按 Esc 即時清除預覽線。
  - 多邊形（Polygon，B06 / G16）：支援外接圓半徑模式（`radius`）與邊長模式（`edge`）數值輸入與切換按鈕；輸入角度時自動建立中心至第 1 頂點構造射線並標註相對於水平軸之驅動角度尺寸；無角度或角度 0° 時支援頂點或邊水平拘束；自動標註外接圓半徑或邊長尺寸；單步 Undo/Redo 原子復原。
  - 變更：`packages/sketch/src/ops.ts`（`SlotEntry`、`PolygonEntry`）、`apps/web/src/sketcher/controller.ts`（多階段狀態競爭修復、`setPolygonEntry` early-return 修正、純滑鼠真值防呆）、`apps/web/src/components/Viewport.tsx`（切換按鈕）、`packages/i18n`（中英字典擴充）、`tests/e2e/manual-sketch-entry.js`（B05 與 B06 端到端實機步驟）。
- **確效結果**：
  - `apps/web/test/sketch-entry.test.ts`：**37/37 PASS**（含 180 組全隨機幾何 Fuzzing 壓力測試）。
  - `apps/web/test/sketcher.test.ts`：**75/75 PASS**。
  - `apps/web/test/*`：**29 檔 305 項全數 PASS**。
  - `npm run build`：構建通過。
- **下一步**:
  1. E03：P1 輸入框在 macOS 鍵盤與 DPR2／不同縮放待 CI／實機驗證。
  2. 既有限制另案：PlaneGCS 對約 900 個拘束、大多已定義的草圖 `Aborted(OOM)`（150 個標尺寸矩形可重現，100 個 52 ms）。
  3. 接續推進草圖互動方案 Phase P2。（已開工，見 §3c）

## 3c. 2026-10-30/31 P2 進行中:P2-1/P2-2 已提交,P2-3 偏移兩側與封口

- **P2-1(G06 管道,`925378a`)**:此前修剪/延伸/圓角/倒角/偏移/鏡射六個 PICK 工具點擊即提交、無最終結果預覽;P2-1 建立共用管道——hover 以**與提交同一純 op** 算候選 `SketchEdit`,預覽以 `remove`/`change`/`add` 三角色畫在發生位置,確認才試解提交,取消零文件變更、預覽不產生 Undo。Schema 未變更。
- **P2-2(六工具鋪開,已提交 `7a9b808`)**:`operationPlan()` 擴為全部 PICK 工具;抽出 `cornerPair()` 供 hover 與 `operationClick` 共用(角落行為逐項保持原樣);偏移特例 hover 無命中也出計畫(點擊本就不做 hitTest,游標僅決定邊);鏡射 hover 需在映軸曲線上。測試 8 項、全庫 313 項。**已知缺口**:鏡射以草圖軸參照時 hover 無預覽(點擊可提交)。
- **P2-3(偏移兩側與封口,本批未提交的部分即此刀)**:`packages/sketch/src/ops.ts` 新增 `OffsetEntry { both?, caps? }`,`offset()` 主體收斂為 `runSide(forced: 1|-1|null)`(`null` 由 `toward` 決定=原行為;`both` 跑 `[1,-1]` 兩趟,各側自己的驅動距離;`caps` 於非環狀鏈兩端加直線接回原端點、直線腿加 `perpendicular`)。`apps/web` 的 `ToolOptions` 增 `offsetBoth`/`offsetCaps`(預設 false)+PropertyManager 兩個核取方塊+i18n;`operationPlan()`/`operationClick` 傳同一 `entry`(預覽自動獲得);`setOption()` 丟棄並在游標仍在時重算 `opPlan`。測試 4 項(`ops.test.ts` 2、`sketch-op-preview.test.ts` 2),全量 `apps/web`+`packages/sketch` **50 檔 550 項**。**已知缺口**:曲線(自由曲線)offset 留 P5 探針。
- **接法**(續作 P2-4 的人必讀):`apps/web/src/sketcher/controller.ts` 的 `operationPlan()`(在 `updateSnap` 的 PICK 分支以暫存 `IdAllocator` 呼叫純 op)+模組層 `editPreviewShapes(edit, geometry)`(新增圖元用 op 在 `Parts.point` 攜帶的暫存座標渲染);`PreviewShape.role` → `overlay.ts previewCurves` 著色 → `theme.ts`/`app.css` 的 `--sketch-op-{add,change,remove}`。計畫在文件版本變更後由 `snapshot()` 丟棄(`candidateDoc` 同一模式),`leave()`/`resetTool()` 也清。
- **確效**:P2-1/P2-2 完整 `verify:ui` 皆 **249/250**——唯一失敗 `manual-drawing-linked` 已以乾淨 HEAD `--only` 對照+DEV_LOG 2026-10-29 先例(同一 `centred:false` 在 `bca2d80` 重現)判定為**既有/環境性失敗**,非本工作線造成,另案追蹤(同 E03 macOS);P2-3、P2-4 同為 **249/250**(唯一失敗 `manual-drawing-linked`,既有/環境性,已定案為測試側問題;P2-4 為 250 列、0 新增失敗)。P2-3 已提交 `d5adf65`、P2-4 已提交 `baad645`,CI 皆綠。修好 `manual-drawing-linked`後(`f92164c`)基準為 **250/250**。
- **下一刀**:P2-4 拖曳掃掠修剪(掃過多段一次復原、重複穿越去重、Esc 清預覽);之後 P2-5 延伸選邊界、P2-6 相切弧接續。

## 3d. 2026-10-31 P2-4 進行中:拖曳掃掠修剪(G07)

- **目標(C02/G07)**:拖曳修剪工具底下一筆畫過多段——同一片段只處理一次;三段一次 Undo/Redo 完整復原;空拖曳不加 Undo;Esc 取消不改原圖。
- **現況**:程式已寫入工作樹、typecheck 乾淨、新增 4 項測試通過(`apps/web`+`packages/sketch` 50 檔 **554 項**)、lint:rules/deps/repo/i18n 全 PASS、完整 `verify:ui` **249/250**(唯一失敗 `manual-drawing-linked`,既有/環境性、已定案),徵得使用者同意後提交。改動檔:`apps/web/src/sketcher/controller.ts` + `apps/web/test/sketch-op-preview.test.ts` + `handoff.md`。
- **實作(全在 `apps/web/src/sketcher/controller.ts`)**
  - 新欄位 `trimSweep: { at: Map<Id, P2>; cancelled: boolean } | null`。
  - `pointerDown`:tool==='trim' 時初始化空 sweep。
  - `pointerMove`:else 分支在 `press.moved` 後呼叫 `sweepTrim(e)`。
  - `sweepTrim(e)`:對 press 起點與當前點各 `hitTest`,非 point 且未收錄者收錄;以 `mergedTrims` 更新 `opPlan` 供預覽。
  - `mergedTrims(at)`:對每個 (id, 點) 呼叫同一個純 `trim()`,跳過 error,用 `mergeEdits` 折成一個 `SketchEdit`。
  - `pointerUp`:若 `trimSweep` 存在且(moved 或 cancelled) → cancelled 不改;否則(moved) 以單一 `{ edit: merged }` 呼叫 `run()`(一次 Undo);未移動則落回既有單擊路徑。
  - `escape()`:sweep 存在 → `cancelled = true`、清 `opPlan`、返回。
  - `resetTool()` / `leave()` 清 `trimSweep`。
  - 模組層新 `mergeEdits(edits)`:entities/constraints 串接、remove 去重、add 合併。
- **待驗風險**
  1. 兩相鄰段同時被修剪時,`trim()` 內部 `dropEnd` 以「原始草圖」判斷端點是否他處仍被引用,可能留下孤立點;需以測試確認(必要時改為修剪後再判斷)。
  2. sweep 期間覆寫 `opPlan`;需測「放開後無殘留預覽」「Esc 後無殘留」。
  3. 既有限制:穿過與曲線重疊的「點」(如原點)時 `hitTest` 會回該點,該曲線不被修剪——與既有單擊 trim 同行為,非本刀新增(驗證場景已避開原點)。
- **下一步**:P2-4 已提交並推送(`baad645`,CI 綠);`tests/e2e/manual-drawing-linked.js` 的方案 A 修正也已另開 `test:` 提交(`f92164c`,`--only` 1/1 通過,基準回到 **250/250**)。接著進 P2-5 延伸選邊界(每刀提交前徵詢),P2-6 相切弧接續。測試在 `apps/web/test/sketch-op-preview.test.ts` 新增 describe「拖曳掃掠修剪 (G07, P2-4)」4 項。

### 另案已修並提交:`manual-drawing-linked` 換投影後最適比例不屬於該步(方案 A)

- **根因(2026-10-31 定位;非產品錯、亦非「環境性」)**:該腳本 step 1 先 `H.newDrawing()`(第三角)才 `setSheet({projection:'first'})`。新圖的「最適比例」在該圖 views 的 lines 與 features 都齊時即套用一次(ADR 0147),而調色盤預覽(`ensurePalette`)與檔案三視圖**共用同一個請求 id**(`keyOf()` 回零件 key;`requestOf()` 的 `id`/`featureId` = `key|JSON.stringify(axes)`),所以快取幾乎立刻可用、fit 常在 `H.newDrawing()` 內就已套用。`autoScalePending` 用掉後,換投影會重排三視圖(`packages/drawing/src/layout.ts` 的 `cell(direction, projection)`)並產生新 axes 的請求,但**不會重算 fit**,圖紙因此留著第三角的 shift;第一角內容量到的中心 `[215,173.5]` 與 A3 可繪區中心 `[215,172.5]` 固定差 1.0 mm → `box.centred:false`;`centreViews()` 仍回非 null → 「自動排版」可按下 → `nothingToDo:false`。
- **反證**:同一輪 step 7(按「自動排版」後斷言 `box.centred && panelButton().disabled`)通過,`verify:ui` 每腳本最多印 3 個失敗步驟而只出現 `.steps.0` → 置中邏輯本身正確,壞的只是「測試自己換了投影、而 fit 不屬於那一步」。
- **修法(方案 A,測試側,已選定)**:在**空圖紙**上先 `setSheet({projection:'first'})`,再按「標準三視圖」——空圖紙 `views.length===0` 時 `autoScaleWhenReady()` 會等待,加視圖後 fit 只用第一角跑一次,無競態;step 1 語意(「新圖已置中、自動排版無事可做」)原樣保留。驗證以 `npm run verify:ui -- --only manual-drawing-linked`,另開 `test:` 提交。**結果**:已提交 `f92164c`(CI 綠),單腳本驗證 `npm run verify:ui -- --only manual-drawing-linked` **1/1 通過**。
- **方案 B(產品側,未採用)**:換投影時若圖仍是全新(無 `at`/`scale`、shift 未被動過)就重跑最適比例;與「使用者放過的視圖保留原位」相衝,需 ADR,暫擱置。

## 3e. 2026-10-31 P2-5 已提交:延伸明示邊界(G08 部分)

- **目標(C03/G08)**:延伸工具可先選一條曲線作為邊界,延伸跨過中間的曲線直達所選邊界;未預選時維持「取該方向首個有效交點」的預設;邊界在端點後方或不在延伸路徑上時明確拒絕(不縮短、不靜默改目標)。
- **實作**:
  - `packages/sketch/src/ops.ts`:`extend(..., boundary?: Id)` 在既有 ahead 命中中改取該邊界的命中;取不到回 `sketch.extendBoundaryMissed`;「邊界 = 本體」視同未指定;「重疊」仍由 `extensionOverlaps` 把關。
  - `apps/web/src/sketcher/controller.ts`:`setTool('extend')` 以 `extendBoundaryTargets()` 把當前選取的第一條非點/非文字圖元種入 `picks`(與 offset/mirror 同模式,但未預選不阻止進入);`operationPlan()`/`operationClick` 傳 `picks[0]`,預覽與提交同一 pure op;`picks` 非空時提示改顯 `sketch.hint.extendBoundary`。
  - i18n:`sketch.extendBoundaryMissed`、`sketch.hint.extendBoundary`;`help.toolExtend` 的 summary/body/keywords 補「預選即邊界」(zh/en,並遵循該檔的全形標點)。
  - 測試:`ops.test.ts` +1、`sketch-op-preview.test.ts` +2(describe「extend to a chosen boundary (G08, P2-5)」);e2e `manual-extend-rectangle.js` 加「選遠線 → 跨過近線直達 x=40」。
- **確效**:`apps/web`+`packages/sketch` 50 檔 **557 項**;`verify:ui -- --only manual-extend-rectangle` 1/1;完整 `verify:ui` **250/250**;typecheck、lint:rules/deps/repo/i18n 全 PASS;`help.test.ts` 40 項。提交 `2e5887f`,CI 綠。
- **已知缺口**:獨立 Split 需定義 ID/尺寸/外部參照繼承(P5);以自由曲線為邊界留 P5。
- **下一刀**:P2-6 相切弧接續(提交前徵詢)。

## 3f. 2026-10-31 P2-6 進行中:線與相切弧互換仍保留鏈(G05 部分)

- **目標(G05)**:直線、中心線、相切弧互相切換時保留鏈與鏈端;相切仍由既有推斷決定,不偷偷加錯相切;Esc 無半成品。對應 T03:「直線→相切弧→直線,跨工具仍保留切向;中途 Esc 與取消無半成品、無多餘關係」。
- **實作**(`apps/web/src/sketcher/controller.ts`):
  - `CHAIN_TOOLS`(line/centerline/tangentArc);`setTool` 只在舊、新皆為鏈工具時帶過 `chain`。
  - `chainSnap()` 把鏈端當吸附點;`tangentArc` 的 click/preview 以 `clicks[0] ?? chainSnap()` 為起點,單擊即終點;`snapshot` 的 `step` 在有鏈時視為 1,提示改問終點。
  - `finishTwoClick` 的 tangentArc 以 `this.commit(b)` 成功為前提才設 `nextChain`;`end === chainFirst` 時收鏈。
  - 重合判定:在 `lineClick`/`finishTwoClick` 以 `dist(起點, 落點) < 1e-9` 直接返回,不建零長段。
- **交付前紅隊抓到的回歸**:第一版守門用 `PICK_PX * px`(7px 拾取半徑)判「同一個點」,吞掉被對齊吸附拉近鏈端的合法點 → `manual-thread` 由 PASS 變 FAIL(乾淨 HEAD 單跑通過,證明是本刀造成)。改為 1e-9 重合判定並補回歸測試(`draws on when a snapped click lands near the chain end`)。
- **確效**:`apps/web` + `packages/sketch` 50 檔 **562 項**;typecheck、lint:rules/deps/repo/i18n 全 PASS;完整 `verify:ui` **251/251**;新增 e2e `manual-tangent-chain.js` 1/1。**提交前徵詢**。
- **下一刀**:P3 區域式建模入口(G10)。

## 3g. 2026-10-31 P3-1 進行中:畫布選區與清單同步(G10)

- **目標(G10)**:伸長/旋轉/掃出的草圖,合法閉合輪廓在畫布淡填色、hover 與清單同亮、單擊單選 / Ctrl 加減(永不為零),沿用既有 contour IDs 與 `setContours`,不改 Schema。對應 P3 驗收出口「矩形帶圓孔 / 多個分離輪廓畫布選區、清單同步;實體體積、取消、存讀正確」。G11(交叉/分岔子區域)不在本階段。
- **實作**:
  - `packages/sketch/src/profiles.ts`:`regionOutline` / `outlineContains`(孔洞內不算命中)/ `sameContour`(共享一半圖元;清單的 inline 版抽出共用)/ `pickContourSelection`(單擊、Ctrl 加減、至少留一個、選滿回 `null`);`findProfiles` 第二參數放寬為 `Pick<SolvedSketch,'geometry'>`,主執行緒可直接用 Worker 的 `sketchGeometry`。
  - `packages/render/src/overlay.ts`:`SketchOverlay.fills` + `OverlayFill`;`THREE.Shape`(孔洞為 `Path.holes`)+ `ShapeGeometry` + 平面矩陣,`renderOrder=-1`,有填色時線/點材質改 `transparent` 以維持排序。
  - `apps/web/src/state/store.ts`:`contourPick`/`contourHover`;`startContourPick` 少於 2 個合法區域即提示 `contour.pickNone`;`contourAt`/`setContourHover`/`contourPickClick`;`leaveSession` 清除。
  - `apps/web/src/components/Viewport.tsx`:選取期間強制顯示該草圖(即使被特徵隱藏)並加填色;tool handler 只接管左鍵,以 `planePoint` 取平面座標判定。
  - `apps/web/src/components/PropertyManager.tsx`:「在畫布選取 / 結束選取」按鈕、hover 列高亮、卸載即停;`actions.ts` 的 Esc 先停選取再關閉面板;i18n 4 條 × 2 語。
- **紅隊抓到(測試設計,非產品缺陷)**:① 俯視圖用「同一點螢幕位移」證明中鍵旋轉是錯的(量到 1.27 px),改以 `cubeMatrix()` + 全畫面像素差 >2000。② e2e 必須先把草圖平移到 PropertyManager 沒遮住的區域(約 32% 寬),否則點擊落在面板底下。
- **確效**:`apps/web` + `packages/sketch` **51 檔 567 項**;typecheck PASS;完整 `verify:ui` **252/252**;新增 e2e `manual-contour-pick.js` 1/1(10 步)。**提交前徵詢**。
- **下一刀**:P3 到此完成;進入 P4「診斷、關係與參照」,建議先 G12(關係標記跨 anchor 避讓與雙向高亮)、再 G13、G15,P4-4 依 P0 量測修 G04/14/18。

## 4. 下一階段核心計畫：草圖互動改善方案 (P1 即時尺寸輸入)

參考規劃文檔：[草圖互動方案規劃 (docs/design/sketch-interaction/plan.md)](docs/design/sketch-interaction/plan.md) 與 [P0 驗收紀錄 (docs/design/sketch-interaction/acceptance.md)](docs/design/sketch-interaction/acceptance.md)。

### P0 已完成成果
- 輸入法 IME 防誤觸（`isComposing` / `keyCode 229` 攔截）。
- 吸附提示來源圖元 ID（如 `端點 · 重合 (p1, l1)`）。
- 右鍵 contextPick 保留現有多選狀態。
- 草圖狀態列顯示工作平面名稱。
- 1000 圖元自由度診斷 fast-path（從超時降至 23.3 ms）。
- 瀏覽器 E2E 3/3 通過（`manual-sketch-plane.js`, `manual-sketch-selection-candidates.js`, `manual-sketch-session-rollback.js`）。

### P1 實作範圍（即時尺寸輸入）
1. **輸入框呼叫與呈現**：
   - 繪製直線時：即時顯示「長度」與「角度」輸入框。
   - 繪製圓/圓弧時：即時顯示「半徑」或「直徑」輸入框。
   - 繪製矩形時：即時顯示「寬度」與「高度」輸入框。
2. **鍵盤與焦點流轉**：
   - 使用者鍵入數字即自動聚焦。
   - `Tab` 鍵在多個參數欄位之間切換（如 長度 ↔ 角度）。
   - `Enter` 鍵確認輸入，並**自動建立對應的驅動拘束 (Driving Constraints)**。
   - `Esc` 取消輸入或退出當前工具。
3. **交易與復原**：
   - 建立之圖元與驅動拘束必須屬於同一交易，一次 `Undo` 完整復原。

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
