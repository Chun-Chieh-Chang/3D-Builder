# 交接與接續工作 (Handoff for Claude Code)

更新日期：2026-11-02。接手請優先閱讀本檔、[產品現況](docs/project-state.md)、[AGENTS.md](AGENTS.md) 與 [草圖互動改善方案](docs/design/sketch-interaction/plan.md)。  
在進行任何操作前，請先執行 `git status --short --branch` 與 `git log -5 --oneline` 掌握最新狀況。

---

## 1. 接續入口與當前代碼基準 (Current Baseline)

- **目前分支**：`main`
- **最新 Commit**：`40eeec8`（`docs(manual): add nine verification items (C28-C30, D11-D13, F8-F10)`，手冊新增九項，見 §3r）；其上是 `7aebded`、`c23f22e`、`ea0b510`（交接提交）、`e577a18`、`4b867f0`（手冊待辦盤點，見 §3q）。
- **遠端狀態**：本地 `main` 比 `origin/main`（`7aebded`）多出「手冊新增九項」與本檔的交接提交（`40eeec8` 起），**尚未推送（未取得授權）**。
- **CI 狀態**：GitHub Actions integrity 三平台（`ubuntu-latest`, `windows-latest`, `macos-latest`）**全數綠燈**（`e171790`：Run `41407308974`，三平台 job 皆 `success`；`d37c4a7`：Run `41392524538`；`510f55c`：Run `41391653913`／`41391657225`／`41392269791`；`full-suite` 為夜間排程另計，`e171790` 一輪為 `skipped`；`a8e30b8` 起每次推送另跑 large-sketch solver 測試，皆通過）。**本次推送的 Repository integrity 全數綠燈（Run `104`：`ea0b510`，即手冊盤點三個提交；Run `105`：`c23f22e`，三平台 job 皆 `success`）。`40eeec8` 與本檔的交接提交尚未推送，因此還沒有它們的 CI 結果。**
- **工作區狀態**：**乾淨，無在途檔**（手冊新增九項已於 `40eeec8` 提交、本檔交接於同一批提交，見 §3r；手冊盤點的 6 個檔已於 `4b867f0` 提交，交接更新是 `e577a18`、`ea0b510`，見 §3q）。注意：worktree 一律放在專案資料夾內（`.claude/worktrees/` 慣例），`wt-gizmo` 已用畢移除。

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

## STL 輸出與輸入（分支 feat/stl-exchange）

2026-11-01：STL 輸入為網格參考（`importedMesh`，Schema 87）、輸出對話框（二進位／ASCII、mm／inch、細緻度、座標系統）、多本體各存一檔、組合件 STL，[ADR 0221](docs/adr/0221-stl-exchange.md)。分支已推送、**尚未合併 main**；main 已有 Schema 87 或 ADR 0221 時合併要改號。待辦：使用者以 eDrawings 開 `D:\3DB實機確認\STL對照` 判定。worktree 在 `.claude/worktrees/stl-exchange`（不得建在專案資料夾外）。

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

## 3m. 2026-11-01 待裁項目執行進度（A1/A2/B1/C1/C2/E1 已完成）

> **狀態：P4 4/4 完成；A1、A2、B1、C1、C2、E1 第一刀皆已完成並推送（CI 綠）。剩 D1、D5 探針與 D2/D3/D4 候選。**

### 已完成（本 session 追加）

| 編號 | 項目 | 提交 |
|---|---|---|
| E1 | G16 選邊平行/頂點朝向（第一刀：吸附到現有線的角度 + parallel 拘束） | `1899e1e` |
| C1 | CI 兩段式（PR 精選 + 夜間全量） | `84c4911` |
| C2 | PlaneGCS 預算守衛：以單一相連部分的量測上限取代拘束數門檻（2026-11-02 使用者裁決） | `f5d54c0`、本次合併 |

### 待做（依建議優先順序）

1. **D1 (G08)** 獨立 Split 與參照繼承探針 — ✅ 完成 (ADR 0222)：直線/圓弧/圓可行；樣條/Bézier 延後；外部參照阻擋。
2. **D5 (G19)** 自動尺寸配置探針 — ✅ 完成 (ADR 0223)：MVP 可行（基準+偏好+預覽+確認）；3D/樣條延後。
3. **B2** manual-asm 逾時 — 已加 Page.navigate 重試；若仍逾時，拆出單獨 CI job。
4. **D2 (G09)** 自由曲線 offset — 留候選。
5. **D3 (G11)** 交叉/分岔子區域 — 留候選（高風險）。
6. **D4 (G17)** 樣條 G2/節點權重 — 留候選。

### E1 後續（第二/三刀，未做）

- 第二刀：「平行某邊」做成真正的 parallel 拘束聯動（第一刀已加 parallel relation，但 UI 入口/解除未做）。
- 第三刀：「頂點朝向某點」（angle to a point）。

### 進行中/暫停說明

- D1/D5 是 2–4 日探針，本 session 額度不足，下一 session 從 D1 開始。
- 即時看板：http://127.0.0.1:5399。

## 3n. 2026-11-02 特徵失敗時操控器的可見退路＋除料 fuzz reverse 維度（已完成並推送，CI 綠）

> **狀態：登記待辦第 3 項的兩個子項收尾完畢，提交 `f960863`／`ee0b710`。**

- **①反向切空氣時操控器的可見退路**：反向除料重建失敗使 `${feature}:cap:end` 端面名消失，操控器舊碼 `if(!center) return null` **靜默退場**。新純函式 `extrudeHandlePlacement`：端面缺失時把手退回**草圖平面**（虛線框、`data-extrude-anchor="sketch"`），button title 以 `instantDepth.anchorLost(_With)` 如實引用失敗訊息；**不停用拖曳**（拖曳值映射以投影增量計算，不依賴錨點）。單元四態＋e2e cutDrag narrative；**反向對照**：還原靜默退場恰在「the handle stays visible and explains the failure」逾時。詳見 DEV_LOG 2026-11-02 條目、[ADR 0203 §修正之二](docs/adr/0203-floating-editor-assembly-source-and-live-extrusion.md)。
- **②除料 fuzz 補 `reverse` 維度**：`fuzz-solids` 除料家族四變體 `top/bottom/midPlane/reversed`（reversed 掛 front 基準面＋`reverse:true`），SEEDS 72→240，新增「每變體至少成功且過體積檢查一次」門檻（`stats.tags`）；`extrude-p1` 恆定釘住四向體積（1960/1960/1980/1960）與掛端面 `reverse` 的兩個如實失敗。**先探針後寫碼**：除料預設永遠朝材料內（掛端面 reverse 必切空氣）。詳見 [ADR 0094 補充](docs/adr/0094-random-tests.md)。
- **驗證**：完整 `verify:ui` **258/258**（前兩輪各 256/258 的兩案失敗為 worktree 手配 node_modules 缺 `three` 的環境缺陷，`npm ci` 修復後整輪重跑收案；教訓已錄 AGENTS §4）。typecheck、`lint:repo` 全 PASS；CI 三平台綠。
- **worktree 收尾**：`wt-gizmo` 已提交、rebase 到 `02dc7fb`、推送並移除（截圖備份 `out/gizmo-retreat/`）；主樹以 update-ref＋逐檔判定 checkout 收尾，他人未提交的在途檔未動。


## 3o. 2026-11-02 旁支合併回 main（PR #8 已 merged，旁支已刪；基準 `510f55c`）

> **狀態：`claude/busy-bhaskara-16e42c`（PR #8）已合併進 main 並刪除；`feat/stl-exchange` 驗證 0 超前後逕行刪除。GitHub 僅剩 default `main`。**

- **PR #8 內容**（他方交付，非本工作階段）：兩個 `verify:ui` 競態修復——`H.loaded` 等 assembly solve 後才算載入完成（`apps/web/src/state/assembly.ts` 公開 `solvePending`）、section-captions step 6 等 top view 的投影邊入圖再斷言（`tests/e2e/manual-assembly-section-captions.js`），＋`tests/e2e/phase2-assembly.js`。＋37/−3；聲明完整 `verify:ui` **260/260**、以實延遲重現驗證必要性、**不鬆門檻**（AGENTS §3.3）。
- **合併方式**：分支已含 main 歷史（ahead 3、behind 0），本機 `git merge --ff-only origin/claude/busy-bhaskara-16e42c` 快進 `d661b7f..510f55c` 後推送；GitHub 自動判定 PR #8 **merged**（merged_at `2026-11-02T05:08:25Z`，merge_commit_sha `510f55c`）。
- **分支清理**：遠端 `claude/busy-bhaskara-16e42c`、`feat/stl-exchange` 均已刪除；合併後本地 typecheck **0 錯**、CI 三平台全綠。
- **主樹在途（勿動）**：~~工程圖工作階段仍有 9 改＋3 新檔未提交~~ — **已於 `187e325` 提交**（見 §3p）；本節該提示已過期。


## 3p. 2026-11-02 尺寸線可以畫在視圖上（ADR 0227，已提交並推送 `187e325`）

> **狀態：功能、測試、文件、ADR 齊備並提交；已隨交接提交 `e171790` 快進推送至 `origin/main`（`d37c4a7..e171790`），CI integrity 三平台全綠（Run `41407308974`）。**

- **起因**：使用者問階梯銷的 Ø10.54（軸向水平的圓柱段）能不能標註在左右兩端面之間。實測：線性尺寸的尺寸線只能在視圖**外**（`offset` 是視圖框外的距離，正負各一側，0 不合法），故這不是位置調不準，而是根本沒有這個位置。依「面對選項一律選系統性方案」做成可複用功能，而非一次性特例。
- **做法**：線性尺寸新增 `insideAt`（視圖本身的毫米：垂直尺寸為視圖的 x、水平尺寸為視圖的 y）。畫在視圖上時箭頭尖直接接觸被量的輪廓、**不畫延伸線**（延伸線會壓在輪廓上），位置經 `toSheet` 換算，視圖縮放時跟著零件走。指標在視圖上 → `insideAt`；在視圖外 → `offset`（既有語意不變，且 `offset` 保留，拖回去時回到原處）。面板另有「尺寸線畫在視圖上」開關與「位置（視圖的毫米）」欄位。Schema 37→38（遷移為不改舊值的 no-op）。ADR：[0227](docs/adr/0227-dimension-line-on-view.md)。
- **紅隊與 RCA**：① 座標尺寸改用獨立的 handle kind（`kind: 'ordinate'`）後，被 `arrange.ts` 的 `span()`（以 `handle.kind === 'linear'` 決定是否參與疊排）整個排除，`tests/phase5/drawing-arrange.test.ts`（B2.5）紅 → `span()` 同時接受兩種 handle。**教訓：handle 的種類不只是渲染端的事，每一個讀它的消費端都要逐一列出**（與 AGENTS §4「新的本體種類不得借用既有旗標」同型）。② e2e 首版兩次紅皆為腳本斷言寫錯（挑的尺寸不在被選中的視圖上；復原的是上一個命令，狀態與腳本預期相反），非產品缺陷。③ 整輪 `verify:ui` 第一輪跨了兩棵樹（另一工作階段於中途 fast-forward `origin` 分支），雖 264/264 通過但非單一樹結果 → 穩定後整輪重跑。
- **驗證**：`tests/phase5/drawing-dimension-inside.test.ts` 15 項；全量 `npx vitest run` 364 檔／4339 通過／0 失敗；`tsc` 0 錯；`lint:rules`／`lint:deps`／`lint:i18n` 全過；瀏覽器 `tests/e2e/manual-drawing-dimension-on-view.js` 1/1 PASS（真實定位板，截圖 `out/shots/manual-drawing-dimension-on-view/`）；**完整 `npm run verify:ui` 264/264**（穩定樹重跑，日誌 `out/verify-ui-adr0227.log`）。
- **接手注意**：本提交只改工程圖尺寸線的**位置語意**，未動求解器與拓樸；`insideAt` 與 `offset` 互斥但非覆寫——拖曳與面板走同一個 `setDimension` 命令，沒有第二條真值。


## 3q. 2026-11-02 手冊待辦盤點（項目↔說明主題對齊，已提交 `4b867f0`）

> **狀態：盤點與修正完成並提交；說明守門 47/47 通過、型別與 lint 全過。手冊要新增哪些項目留給使用者決定。**

- **起因**：使用者問手冊是否還有遺漏的待辦事項。盤點分三層：手冊標示「你還要做」的項目是否真實、每個必做項目有沒有對應的程式內說明、每個有內文的說明主題是否都有手冊項目或寫明理由。
- **修正**：① 19 個手冊項目沒有對應的說明主題（D9、E2～E4、E6、F2、F5～F7、G5、H9、I4、I7～I10、K1～K3），補進 `docs/help-links.json`，**47 個必做項目全部至少有一個主題**（`docs/help-plan.md` 的 H-C 判準）；② 11 個有內文的主題沒有手冊項目，在 `_untied` 補上理由；③ `automatic-relations` 原本誤列在 `_untied`，但 C26 涵蓋它，移過去；④ **C27、D10 被誤標為「你已確認」**（`data-auto="user"`，預設隱藏且計入已處理），但項目自己的文字說只剩「看起來順不順手」，改為 `part`（部分驗過、預設仍開著）；⑤ 手冊開頭的數字（183 檔／2481 測試／UI 125）與「現在還剩（2026-10-09）」清單過期，改為 364 檔／4339 通過／26 略過／UI 264/264、程式版本對到 `187e325` 與 Schema 87・7・38，剩餘清單改為真正的 22 項（C27、D9、D10、F4、F6、F7、G5、I9、I10、J 章、K 章、L 章）；⑥ ADR 0227 的能力（尺寸線畫在視圖上）原先沒寫進說明，補進中英 `help.conceptDrawingDimensions.body`。
- **守門修正**：同步手冊說明行的守門要求每個主題都查得到「程式顯示的名稱」，但 `toggle-visibility`／`hide-component`／`transparent-component`／`suppress-component` 的名稱是程式按當下狀態選的（隱藏／顯示…），守門因此紅。改為在守門裡放一張明確對照表，並斷言這四個仍是動作、對照表裡的名稱都查得到——新增沒登記的動作仍然會紅。另對同名主題去重（手冊上原本出現「測量、測量」）。
- **驗證**：`tests/phase8/help.test.ts` 40 項、`help-manual.test.ts` 2 項、`help-examples.test.ts` 5 項，共 47/47 通過；全量 `npx vitest run` 364 檔／4339 通過／26 略過／0 失敗；`tsc` 0 錯；`lint:i18n`／`lint:repo` 全過；`npm run docs:sync` 無變更。中文以與 HEAD 基線差測掃描，新增的 573 個字元中簡體字命中 0。
- **尚未處理（交由使用者決定）**：有一類功能「有說明主題、有瀏覽器腳本，但手冊完全沒有項目」（例如從工程圖開啟零件、工程圖自己的「開啟零件」按鈕）。本次只在 `_untied` 寫明理由，沒有自行新增手冊項目——新增哪些項目屬於手冊內容的決定權。**（其後使用者指示「新增那些手冊項目」，已於 §3r 補齊。）**


## 3r. 2026-11-02 手冊新增九個實機驗證項目（C28–C30、D11–D13、F8–F10，已提交 `40eeec8`）

> **狀態：九個項目已寫入手冊並提交 `40eeec8`；說明守門 47/47 通過、全量單元 364 檔／4339 通過／26 略過／0 失敗、瀏覽器實查手冊頁 101 項。尚未推送（未取得當次明文授權）。**

- **起因**：§3q 留下的待決事項——「有說明主題、有瀏覽器腳本，但手冊完全沒有項目」的那一類功能。使用者指示「新增那些手冊項目」，於是十二項待辦收斂成九個手冊項目（F8 併「從工程圖開啟零件」與「工程圖自己的開啟零件按鈕」，D11 併「開啟零件檔」，C29 併「刪除草圖圖元」與「選取相連圖元」）。
- **九個項目與涵蓋的說明主題**：

  | 項目 | 涵蓋的說明主題 | 自動驗證到哪裡 | 剩下要人做的 |
  |---|---|---|---|
  | C28 從設計樹刪除特徵 | `delete-feature` | `packages/regen/src/dag.ts` 的 `deletion()`（哪些算子特徵、哪些算被吸收的草圖）有單元測試；設計樹右鍵有「刪除…」由 `tests/phase8/context-menus.test.ts` 檢查 | 確認對話框、刪完的畫面、Ctrl+Z 復原 |
  | C29 草圖：刪除圖元與選擇鏈 | `sketch-delete`、`sketch-select-chain` | `manual-context-menus.js` 第 12／16／17 步：圖元右鍵有這兩條、矩形一條邊按「選擇鏈」選到四條邊、對一條線按「刪除」刪掉那條線 | 尺寸與限制條件連帶刪除、三岔路口停下、圓形不延伸、Delete 鍵 |
  | C30 輸出 IGES | `export-iges` | `phase8-iges.js` 走過輸出對話框，修剪曲面（mm）與實體 (B-rep)（inch）各一次，再讀回驗體積 | 用別的軟體實際開檔 |
  | D11 從組合件開啟零件再回來 | `open-component`、`return-assembly` | `manual-context-menus.js` 檢查零組件右鍵有「開啟零件」「開啟次組合件」「重新指定零件檔…」「刪除…」 | 開啟後的畫面、「返回組合件」按鈕、存檔後回來有沒有變 |
  | D12 從組合件刪除零組件 | `delete-component` | 同上（選單有「刪除…」）；連同結合一起走的規則在 `packages/model/src/assembly.ts` 的 `deleteComponents` | 確認對話框、刪完的畫面、復原 |
  | D13 重新指定零件檔 | `relink-component` | `phase2-assembly.js` 重播「找不到參考的檔案」對話框：改名按「瀏覽…」指到新名、搬到別的資料夾按「使用 {路徑}」 | 零組件右鍵「重新指定零件檔…」那條路、選到專案資料夾外的檔案 |
  | F8 從工程圖開啟零件再回來 | `open-drawing-part`、`drw-open-part` | `manual-drawing-open-part.js`：視圖右鍵「開啟零件（{零件名}）」、工程圖樹那一列的選單、有改動先問「要儲存變更嗎？」、回來時顯示存檔後的樣子 | 功能列兩個分頁的按鈕、工程圖樹上那一列、兩種開法 |
  | F9 基準符號與幾何公差框 | `drw-datum`、`drw-fcf` | `packages/model/src/drawingAnnotations.ts` 的 `CHARACTERISTIC_RULES`（ISO 1101、ISO 2692）與 `DATUM_LABEL`，有 `tests/phase5/drawing-gdt.test.ts` | 放框的畫面、面板欄位隨公差種類換掉、錯誤訊息 |
  | F10 表面粗糙度符號 | `drw-surface` | `packages/model/src/drawing.ts` 的 `checkSurfaceFinish`（Ra 0.008～400 µm、引線長度非負、文字不超過 40 字），有 `tests/phase5/drawing-surface-finish.test.ts` | 符號的樣子、拖曳、面板欄位、錯誤訊息 |

- **誠實標示**：九項一律 `data-auto="part"`，每項開頭都有「已自動驗過哪一段」（寫出具體檔名或規則表）與「還沒有人用眼睛看過的」兩段。因此在「需人工」篩選下預設可見，並且會出現在「複製結果」的「還沒做」清單裡——不會被誤當成已完成。
- **同步**：① `docs/help-links.json` 新增九個項目鍵（81 → 90 個頂層鍵，其中項目鍵 88 個），`_untied` 由 39 條減到 26 條，移出的 13 條主題（`delete-feature`、`delete-component`、`relink-component`、`open-component`、`return-assembly`、`sketch-delete`、`sketch-select-chain`、`export-iges`、`open-drawing-part`、`drw-open-part`、`drw-datum`、`drw-fcf`、`drw-surface`）全部有了對應項目；② `tests/phase8/help-manual.test.ts` 的 `RUNTIME_LABELS` 新增 `open-component`（程式依情境顯示「開啟零件」或「開啟」，守門要查得到的名稱不只一個）；③ 手冊開頭「現在還剩」清單加 ⑩～⑬ 四條。
- **順帶修掉既有缺陷**：手冊腳本裡的 `META` 是手寫的 86 筆清單，但當下實際有 92 個項目——漏了 C23～C27 與 D10，於是那六項從未出現在「複製結果」與「還沒做」清單裡（既有問題，非本次造成，§3q 也沒發現）。改為從 DOM 逐項推導（`items.map(el => ({ id: el.dataset.id, sec: el.dataset.sec, tag: …, title: … }))`），新增項目不可能再被漏掉。
- **事實核對（對照真實程式碼，不看說明就信）**：① IGES 檔內名稱不是整個換成一條底線，而是**每個非 ASCII 字元各換一條底線**（`packages/kernel/src/kernel.ts` 的 `productName.replace(/[^\x20-\x7e]/g, '_')`），故「測試零件」寫成「____」；② 開啟零件的訊息出現在**畫面最下方的狀態列**（`.status-bar .notice`），不是畫面的右下方；③ 零件視窗右鍵選單（`apps/web/src/contextMenus.ts` 的 `partMenu`）確實沒有「刪除…」，刪除只在設計樹，故 C28 寫的是設計樹。
- **驗證**：說明守門 `help.test.ts` 40 + `help-manual.test.ts` 2 + `help-examples.test.ts` 5 = 47/47 通過；全量 `npx vitest run` 364 檔／4339 通過／26 略過／0 失敗；`tsc` 0 錯；`lint:rules`／`lint:deps`／`lint:i18n`／`lint:repo` 全過；`npm run docs:sync` 把實機清單項目數由 92 改為 101；瀏覽器實查手冊頁：101 項、META 101、進度 70/101（56 full + 14 user + 31 待做）、導覽計數 C 26/30、D 8/13、F 4/10；中文以與 HEAD 基線差測掃描，新增字元中簡體字命中 0。
- **未跑完整 `verify:ui`**：本批只改 `docs/` 下的獨立 HTML 與說明對照檔，未觸及應用程式的檢視／繪圖／點選層，故未跑整輪瀏覽器驗證。
- **尚未推送**：`40eeec8` 與本檔的交接提交都在本地 `main`（比 `origin/main` 的 `7aebded` 多出這兩個），未取得當次明文授權前不推送。


## 3l. 2026-11-01 P4 完成後待裁項目裁決與後續執行進度

> **狀態：A1、A2、B1 已完成並推送；其餘待做。額度不足時在此暫停，下個 session 依下表續做。**

### 已完成（本 session）

| 編號 | 項目 | 提交 |
|---|---|---|
| A1 | kernel `direct-edit` moveFace 訊息對齊測試期望 | `f71f0cc`（CI 綠，direct-edit 19/19） |
| A2 | 單點「固定」關係被 refusedRelations 過濾（調查結論：維持過濾，正確行為；可選加 UX 提示） | 調查完成，無程式碼變更 |
| B1 | 鏡射以草圖軸參照時 hover 預覽 | `a32f064`（CI 綠） |

### 裁決紀錄（使用者選擇，詳見 report.md「P4 完成後待裁項目裁決紀錄」）

B2 修環境與腳本、B3 記「未驗」不阻塞、C1 兩段式 CI、C2 減少方程規模+預算攔截、D1/D5 現在做探針、D2/D3/D4 留候選、E1 排入下一切片。

### 待做（依建議優先順序）

1. **E1 (G16) 第一刀**：多邊形第二點吸附到現有線的角度（Enter 鎖定）— 中型功能切片，接 G01 提供半徑/邊長與方向角。
2. **B2**：manual-asm-* / assembly-section-captures 逾時 — 修環境與腳本（加重試/等待或拆出單獨 CI job）。
3. **C1**：CI 兩段式（PR 精選 + 夜間全量）。
4. **D1 (G08)**：獨立 Split 與參照繼承探針（2–4 日）。
5. **D5 (G19)**：自動尺寸配置探針（2–4 日）。
6. **C2**：PlaneGCS ~900 拘束 OOM（減少方程規模 + 預算攔截）。
7. **B3**：E03 macOS 驗證（記「未驗」，不阻塞）。
8. **D2/D3/D4**：G09/G11/G17 留候選，探針證實可行才核定。

### 進行中/暫停說明

- E1 尚未開始（本 session 額度不足）。下一 session 從 E1 第一刀開始：調查 polygon entry/live/preview 路徑，做「吸附到現有線角度」的最小可用版本。
- 即時看板：http://127.0.0.1:5399（Review pane），config 於 `C:\\Users\\3kids\\AppData\\Local\\Temp\\opencode\\p2-board.config.json`。

## 3k. 2026-11-01 P4-4 已完成:吸附保持、尺寸候選與精確最近點(G04/14/18,P4 最後一刀)

> **狀態:完成。單元 4104 過 / 1 既有失敗(kernel moveFace,非本刀)/ 26 跳過、e2e 2/2、完整 verify:ui **257/257**、tsc 與四項 lint 全 PASS。待徵詢提交同意。**

- **先量測**(P0 任務表):橢圓最近點偏差 27–75 mm、誤選 474/483、樣條 0.25 mm;無保持時 200 次移動切換 8/40/7 次。只修量到會壞的:G18、G04;G14 量測後確認既有模式可用,只補顯示。
- **交付**:①G18 精確最近點(`interact.ts`:`closestOn` 粗掃+黃金分割;樣條改真實 Catmull-Rom 求最近,與 `sample()` 共用控制點 → 顯示不變,測試釘住)。修後位置差 ≤ 4.4e-7 mm、距離差 ≤ 7e-15 mm、誤選 0/483。②G04 保持(`snap-hold.ts` 純函式:point 3 > midpoint 2 > curve 1、其他 1.5;新候選要近 40% 才換手;離開容差/Ctrl/Esc/換工具/文件變更/實體消失皆解除;`controller` 接線 + 「保持吸附」提示只在顯示的候選≠真正最近時出現)。③G14 尺寸預覽改「值 · 量測對象」(圓/弧量到圓心時明說「圓心」;角度以 `quadrantOf` 標實際扇區,同值對頂角可分辨)。i18n 5 鍵 ×2 語。
- **確效**:新增單元 26 項(nearest-point 8 含 200k 點真值與 200+100 組 fuzz、snap-hold 9、dimension-preview 5、interact G14 段 4);全倉庫單元 **4104 過 / 1 既有失敗 / 26 跳過**;e2e `manual-sketch-snap-hold`、`manual-dimension-preview` 2/2;完整 `verify:ui` **257/257**;**E02 效能重測**:1000 圖元 select p95 0.3 ms、line snap p95 0.4 ms(門檻 8 ms,故未加空間索引);tsc + 四項 lint PASS;inventory 271 文件 / 257 瀏覽器呼叫。
- **教訓**:換手門檻只在平手區有意義——兩條相距 0.15 mm 的線在 18 px/mm 下都在 7 px 容差內,±0.01 mm 抖動才會讓「最近」跳動;e2e 第一版把「走回平手區」當換手而紅燈(情境本身要能以實測數字證明會壞)。G14 的 e2e 曾以 17.32 冒充 10·√3(標籤 59.9993°),改精確值並以數值解析比對,不放寬門檻。
- **詳情**:DEV_LOG 2026-11-01 P4-4 條目、acceptance §P4-4、report.md(P0~P5 追蹤表:切片 11/17、P4 4/4)。
- **下一刀**:P4 已完成(4/4);P5 維持**候選待立項**(每項先 2–4 日技術探針,先證實可行再核定範圍)。另案待辦:kernel moveFace 拒絕訊息與測試期望不一致;單點「固定」關係在面板被 refusedRelations 過濾(本刀未動,見 report.md 另案表);CI 只跑精選測試清單;E03 macOS 驗證;PlaneGCS ~900 拘束 OOM;`manual-asm-*` 逾時。

## 3j. 2026-11-01 P4-3 已完成:參照來源、聯動/失效與重指定(G15)

> **狀態:完成。單元 4078 過(1 既有失敗:kernel moveFace,乾淨 HEAD 已證非本刀)、e2e 8/8、完整 verify:ui 255/255、tsc 與四項 lint 全 PASS。待徵詢提交同意。**

- **交付**:草圖面板「模型參照」清單(來源/跟隨語意/狀態+失效原因+候選);失效參照的「重新指定」= 試算(withReplacedRef + controller.trial 走 worker 真實 followReferences)→ 確認才提交(replaceRef 單命令)、取消零變更;store 的 referenceProblems 按特徵保留參照問題(進入編輯器時重建至該草圖為止、rolledBack 無 unresolved,故須保留);controller 公開 trial 透傳;i18n 16 鍵 ×2 語。
- **確效**:單元 4078 過 / 1 既有失敗(kernel,非本刀);e2e `manual-reference-reassign` 8/8(D07 全流程:聯動→刪源失效定位→試算→取消零變更→確認→存讀);完整 `verify:ui` **255/255**;tsc 與四項 lint PASS。
- **應用級缺陷(已修)**:ReferencesBox 的 useStore selector 每次造新陣列 → getSnapshot 不穩定 → React 無限重渲染、整個應用白屏(連已知良好的 contour-pick 都死)——selector 必須回穩定參照,空集合用模組級常數。
- **詳情**:DEV_LOG 2026-11-01 P4-3 條目、acceptance §P4-3、report.md(P0~P5 追蹤表,新增)。
- **下一刀**:P4-4(依 P0 量測修 G04/14/18,含「固定」關係對單點被拒絕過濾的行為檢查)。P4 完成後 P5 維持候選待立項。

## 3i. 2026-11-01 P4-2 已完成:DOF 方向提示與修復前後畫布呈現(G13)

> **狀態:完成。單元 4072 過(1 既有失敗:kernel moveFace,乾淨 HEAD 已證非本刀)、e2e 6/6、完整 verify:ui 254/254、tsc 與四項 lint 全 PASS。待徵詢提交同意。**

- **視覺基準(修改前)**:分析按鈕可跑、面板有文字,畫布 0 個方向提示、0 個修復預覽(`Temp/opencode/g13-baseline/`)。
- **實作**:`overlay.ts` 的 `arrowPoints`/`arrowTip` 純函式與 `dofMotion`/`fixPreview` 繪製;`controller.fixPreview`(與 diagnose 同一修復變換、trial 真解、逐圖元取樣比較、staleness 守護);store 的 `dofMotion`/`fixPreview` 上板狀態;PM 分析按鈕結果上板、診斷列 hover 預覽(版本號防競態);Viewport 接線;`.overlay-label.motion` 樣式;i18n 三鍵 ×2 語。
- **e2e 情境的教訓(重要)**:此 app 對「製造衝突」的 UI 防護完整——過多定義尺寸**建立時自動降為從動**(C1.29)、從動翻回驅動**取量測值**、矛盾關係**拒絕**、間接矛盾求解回 **failed** 而非 over。矛盾實務上由**文件帶入**,e2e 以 `editSketch` 注入(與既有診斷測試同一做法)。另發現單一點的「固定」關係在面板被 refusedRelations 過濾,留 P4-3 檢視。
- **確效**:單元 4072 過 / 26 跳過 / 1 既有失敗(kernel,非本刀);e2e 6/6;完整 `verify:ui` **254/254**;tsc 與四項 lint PASS;inventory 254 呼叫。
- **下一刀**:P4-3(G15 參照來源/聯動/失效與重指定)、P4-4(依 P0 量測修 G04/14/18)。另案:kernel moveFace 訊息不一致;「固定」關係的面板過濾。

## 3h. 2026-11-01 P4-1 已完成:關係標記避讓與雙向高亮(G12)

> **狀態:完成。單元 4068 過(1 既有失敗,乾淨 HEAD 重現,非本刀)、e2e 6/6、完整 verify:ui 253/253、tsc 與四項 lint 全 PASS。待徵詢提交同意。**

- **視覺基準(已量測,`tests/e2e/manual-relation-labels.js` 對未修改碼跑出)**:三個 10×6 矩形(直線工具四段閉合,共 19 個關係、4 個尺寸,完全定義、0 衝突)——關係符號 **19 個中 28 對互相重疊、1 個被完全遮住無法點選**;選取邊時 **0 個標記亮起、0 個收合**。截圖在 `C:\Users\3kids\AppData\Local\Temp\opencode\g12-baseline\`。修正後同情境:0 對重疊、0 個被遮住(待 e2e 全綠確認)。
- **實作**:
  - `apps/web/src/sketcher/overlay.ts`:新增純函式 `relationLabelSize(text)`(符號在畫面上的估算外框,比 CSS 實際略大)與 `layoutRelationLabels(requests, px)`(以 anchor 為中心的環狀候選位,12px 起、每環 17px、至多 6 環 8 方向;rank 0=與選取相關者先放、佔 anchor 旁最佳位;決定性、穩定排序)。`buildOverlay` 先算雙向集合:`relationIds`(選取中的非尺寸拘束)、`about`(選取圖元 + 其端點)、`related`(引用 about 的關係 ∪ 選取的關係)、`lit`(about ∪ 選取關係所引圖元與其端點);幾何以 `lit` 亮琥珀色(`SKETCH_COLORS.hover`),軸與原點同理;關係標記類別 `selected > over > related`,其餘在有選取時加 `dim`(**衝突/冗餘永不收合**);標記位置全部改由 `layoutRelationLabels` 決定(不再同 anchor 橫排堆疊)。
  - `packages/render/src/viewer.ts`:`setOverlay` 給每個標籤 DOM 加 `data-key`(e2e 可定位單一標記)。
  - `apps/web/src/sketcher/relationsOffered.ts`:「現有限制條件」清單改以 entityIds **及其端點** 過濾(與畫布亮起同一語意);`offered` 維持只看圖元本身,不改加入關係的候選。
  - `apps/web/src/components/PropertyManager.tsx`:關係清單列可點(加入/移出選取,additive 切換;刪除鈕 stopPropagation);選中的列加 `.picked`。`app.css`:`.overlay-label.relation.related`(琥珀)、`.relation.dim`(0.4 透明)、`.relation-list li`(cursor+picked 樣式)。i18n 新增 `pm.relationRowTip`(zh-TW/en)。
- **測試**:`apps/web/test/relation-labels.test.ts`(8 項,全過:估算外框、18 個符號擠在 1.8mm 內互不重疊且 ≤114px、決定性、rank 優先、無選取無 dim/related、選邊亮 2 摺 7、選關係亮遠端圖元、衝突不摺、真實 overlay 不重疊);e2e `tests/e2e/manual-relation-labels.js`(6 步)。
- **中途發現並已修**:畫布亮起(含端點語意)與面板清單(只列直接引用)不一致 → `relationsOffered` 的 `existing` 擴及端點。
- **完成紀錄**:
  - **視覺基準(修改前)**:三個 10×6 矩形 19 關係 4 尺寸(完全定義、0 衝突)→ 符號 28 對重疊、1 個被完全遮住、選邊 0 亮 0 摺;修正後同情境 0 重疊 0 遮住。
  - **實作**:`overlay.ts` 純函式 `relationLabelSize` + `layoutRelationLabels`(環狀候選位,rank 0 相關者優先,決定性,位移 ≤114px);`buildOverlay` 雙向集合(about/related/lit,擴及端點),幾何以 lit 亮琥珀,標記類別 selected>over>related、其餘收合,**衝突永不收合**;`viewer.ts` 標籤 `data-key`;`relationsOffered` 的 existing 擴及端點(與畫布同語意,offered 不變);面板清單列可點;CSS `.related`/`.dim`/`.picked`;i18n `pm.relationRowTip` ×2。
  - **測試**:單元 `apps/web/test/relation-labels.test.ts` 8 項;e2e `tests/e2e/manual-relation-labels.js` 6 步(真實 DOM 量測 + WebGL 像素抽樣,基準與修正同法量測)。
  - **確效**:全倉庫單元 4068 過 / 26 跳過 / **1 既有失敗**(kernel direct-edit moveFace 訊息不符,stash 後乾淨 HEAD 重現相同 → 非本刀,另案);完整 `verify:ui` **253/253**;`tsc` 0 錯誤;四項 lint PASS;inventory 270 文件 / 253 呼叫。
  - **詳情**:DEV_LOG 2026-11-01 條目、acceptance §P4-1。
- **下一刀**:P4-2(G13 DOF 方向與修復前後畫布呈現)、P4-3(G15 參照來源/聯動/失效)、P4-4(依 P0 量測修 G04/14/18)。另案待辦:kernel moveFace 拒絕訊息與測試期望不一致(本次於乾淨 HEAD 重現)。

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
