# 交接文件

- **【2026-10-19 下午交棒：變化半徑圓角（C5.2，[ADR 0167](docs/adr/0167-variable-radius-fillet.md)）——模型層已提交 `feb4c05`（未推送）、核心／再生層在工作區未提交且全綠、UI／help 未動 — 下一個 agent 從「下一步」接手】**
  - **背景與目標**：藍圖 C5.2——圓角半徑沿一條「揀選的邊線」由一端走到另一端（例：R2→R6），兩個控制點之間線性內插；`t` 是沿邊位置（0＝第一端、1＝最後端，錨定規則見下），半徑是表達式（可掛參數）。只有「固定半徑」種類可用：面圓角／完整圓角的半徑由面組決定，指令會在種類切換時把控制點收走。從「選面」算出的邊沒有自己的點，一律吃固定半徑（多條邊可與有控制點的邊混用）。
  - **已完成①（已提交 `feb4c05`，本地領先 origin/main 一筆；推送前等使用者說「推」）**：零件 Schema **66** 新增 `FilletVariablePoint { edge, t, radius }` 與 `FilletFeature.variable`（選填欄位，舊檔照開）；指令 `setFilletVariable` 整套替換控制點（驗證：點只能綁本特徵揀選的邊、t∈[0,1]、同邊同位不可重複、半徑為正、每條邊的點必含 t=0 與 t=1；空清單＝刪除，回到固定半徑）；`setEdges` 把邊移出時一併放掉繫結它的點，`setFilletSets` 改變種類時清空；`refs.ts` 讓 `mapRefs`／`replaceRef` 追蹤邊線更名（更名的邊，點跟著改名走）；模型層 5 項測試。
  - **已完成②（工作區未提交，驗證全綠——勿丟）**：
    - `packages/kernel/src/kernel.ts`：`Kernel.fillet(target, edges, radius, laws?)` 多一個選用 `laws?: Map<邊序號, {t, r}[]>`；新私有 `radiusLaw()` 組出 `NCollection_Array1_gp_Pnt2d`（含 `LAW_STRETCH_SAMPLES = 64` 密化常數）。
    - `packages/regen/src/engine.ts`：`fillet()`（`engine.ts` 約 4196 行）檢查 `f.variable`，非空走新私有 `filletLaws()`（約 4214 行：永續邊名→邊序號、半徑求值、三項驗證），並**直接呼叫 `kernel.fillet`**——變化半徑不走 `roundEdges` 的「半徑減半重試」後路（ADR 0167：法律失敗就是失敗，並說明原因）。
    - `packages/i18n/src/{zh-TW,en}/edit.ts`：3 個鍵 `edit.filletVariableEdge`／`edit.filletVariablePositive`／`edit.filletVariableEnds`。
    - `packages/kernel/test/kernel.test.ts`：4 項（體積積分手值、控制點半徑精確、常數法律等價、混合常數＋變化）。
    - `tests/phase3/variable-fillet.test.ts`：**新檔（未追蹤，勿丟）** 5 項（R2→R6 斜坡體積 14251.209393、控制點非本特徵邊、負半徑、缺端點、與常數邊混用）。
    - `tests/phase1/builders.ts`：`fillet()` 加第四個選用參數 `variable?: { edge, t, radius }[]`。
  - **關鍵實作須知（三個坑，接手必讀）**：
    1. **OCCT 的 `Add(UandR, E)` 是平滑內插，不是線性**：兩個控制點 (0,2)→(1,6) 會跑出 S 形（四分點偏差幾個 %），三個點會在折角過衝。解法：每段直線密化成 `LAW_STRETCH_SAMPLES = 64` 個樣本，量測半徑與直線差 1e-5、體積與積分差 1e-4。**不要改成 `Add(Law_Function, E)`**——libcascade WASM 的 Law_Function 全部失效（任何 law 型別都「圓角失敗」），已試過。
    2. **`t` 的錨點不是 OCCT 的參數方向**：邊的參數方向取決於它所在 wire 的朝向，同一個歷史重建後可能反轉；`t=0` 一律錨在「座標較小的端點」（先比 x，再 y，再 z，用 `BRep_Tool.Parameter` 取該端點在邊上的參數）。閉合邊沒有這種端點，沿用曲線自身方向。
    3. **WASM 綁定簽名坑**：`BRep_Tool.Degenerated` 只吃 `TopoDS_Edge`，傳 `TopoDS_Vertex` 會報 `BindingError: invalid signature`。
  - **體積計算公式（改測試時的依據）**：90° 凸緣每單位長度去料 `(1 − π/4)·r²`；40×30×12 方塊（體積 14400）頂邊 R2→R6 走 40 mm：`∫₀⁴⁰ (1−π/4)(2+0.1x)² dx ＝ 148.7906` → **14251.209393**（測試斷言到 3 位小數）。
  - **下一步（任務 #14 UI＋雙語＋help，未開始）**：
    1. **面板**（`apps/web/src/components/PropertyManager.tsx` 的 `FilletPanel`，約 **1529 行**）：種類選「固定半徑」時加「變化半徑」核取方塊；勾選後列出**每條揀選邊的控制點表**（邊名、t、半徑、新增／移除）。寫入一律走既有指令 `{ type: 'setFilletVariable', featureId, points }`（指令已做完所有驗證；取消勾選＝送空陣列）。**store 還沒有對應 helper**，可直接 `store.execute(...)` 或仿 `setFilletKind`（`state/store.ts` 約 2421 行）加一個。`store.toggleEdge` 已因 `setEdges` 放掉離散點，不用動。半徑值輸入沿用 `ValueInput`（走表達式）。以 `f.variable` 為單一真相（改種類會被指令清空，表格要跟著清）。
    2. **雙語**：UI 新字串鍵放 `packages/i18n/src/{zh-TW,en}/pmpanels.ts`（`pm.fillet.*` 一帶）；英文冊不得出現中文（`lint:i18n` 會查 CJK）。
    3. **help**：`packages/i18n/src/{zh-TW,en}/help.ts` 的 `help.fillet.body` 補一段變化半徑說明＋「驗證過的例子」體積數字（照該檔既有體例：手動步驟＋條列＋驗證數字）。
  - **下一步（任務 #15 測試與全閘門，未開始）**：
    1. e2e：為新面板寫重播腳本（`tests/e2e/manual-*.js`，照 `manual-sidebar-tabs.js` 體例），`npm run verify:ui` 跑相關批次，並做反向對照。
    2. 全閘門：`npm run check`（typecheck＋三支 linter＋全量 vitest；基線 **3106 過 0 敗**，本次新增 5 支應為 **3111 過 0 敗**）＋`npm run make:drawing`（不在 `npm test` 內，單獨跑）。
    3. **提交拆兩個**：① `feat(kernel/regen)`：kernel、regen、i18n edit 鍵、兩支測試與 builders；② `feat(web)`：面板＋pmpanels＋help＋e2e。每個提交都要能獨立編譯（提交慣例見 `.workbuddy-ai/memory/MEMORY.md`）。
    4. 收尾：`DEV_LOG.md` 開頭加本條目、`handoff.md` 把本條目改寫成「已完成」、`.workbuddy-ai/memory/2026-10-19.md` 追加紀錄。
    5. **推送等使用者說「推」**（origin 已可走 HTTPS＋Git Credential Manager，不再需要 SSH URL 變通）。
  - **確效現況（2026-10-19 15:2x，工作區現狀）**：`npm run typecheck` **0 錯**；`packages/kernel/test/kernel.test.ts` **14/14 過**（含 4 項變化半徑）；`tests/phase3/variable-fillet.test.ts` **5/5 過**。尚未跑：全量 vitest、`lint:rules`／`lint:deps`／`lint:i18n`、`verify:ui`。
  - **環境小提醒**：vitest 5 在 Windows 會因 cwd 磁碟機代號大小寫不同而無法 externalize 自己（跑任何 vitest 前先 `cd /e/Self-developed_Apps/G3/3D-Builder`，大寫 E:）；其餘沙箱限制見 `.workbuddy-ai/memory/MEMORY.md`（execFileSync EBUSY→`stdio: ['ignore','pipe','pipe']`、MSYS `ln -s` 建空目錄、`bash -e` 吃反引號）。

- **【2026-10-19：特徵參數群組框——屬性頁直接顯示並編輯特徵參數（E1 §2.2 最後一項共同待辦）— 已推送 `478a422`（origin/main）】**
  - **背景與目標**：零件在 FeatureManager 樹上點選特徵時，屬性頁原本只有識別群組＋「編輯特徵」——看參數非得先開工作階段。本次讓屬性頁**直接排出該特徵的參數群組框**（extrude／revolve／fillet／hole／pattern…40+ 特徵型別全覽），且**不開工作階段就能改**：改動走 immediate command，一步一 undo，Ctrl+Z 可復原。草圖維持識別＋「編輯特徵」（其參數群組屬於草圖編輯器，SKetchPlane/SKetch 面板需要 sketcher session）。
  - **關鍵設計——面板自足性**：所有 ~50 個 `<XxxPanel f={f}/>` 本就只吃 `{ f }`、透過 `store.execute(...)` 寫入（ValueInput 的 Enter/blur、select/checkbox 的 onChange 全是 immediate command），不讀 `editing`、不開 transaction、不觸發揀取模式（`RefItem` 只能清除參考，指派參考是進 session 時在圖面點選）。session 只是用 `beginEdit`/`commitEdit` 把這些包成一步；沒有 session 時每一步自成一 undo。**抽取不改變 session 的 DOM 與行為**——e2e 第 1～3 步（session 開合、隱藏不卸載）原式通過。
  - **完成項目**：
    1. **參數分派（`PropertyManager.tsx`）**：50 行的 `{f.type === … && <XxxPanel f={f}/>}` 鏈抽成 `export function FeatureParams({ f }: { f: Feature })`，sketch 提前 `return null`；`PropertyManager()` 本體改為「sketch 分支自己渲染（`SketchPlanePanel`/`SketchPanel`）＋其餘用 `<FeatureParams f={f}/>`」。
    2. **屬性頁接線（`SelectionPanel.tsx`）**：`PartSelection` 訂閱 `result`；非草圖特徵在識別群組後排 `<FeatureParams f={feature} />`，並在標頭下顯示與 session 同樣的 rebuild 錯誤訊息（`pm-message error-text`）；草圖因 `FeatureParams` 回 null 自動維持原狀。
    3. **e2e（`manual-sidebar-tabs.js` 第 6 步）**：樹點 `eb`（擠出、blind depth 15）→屬性頁出現「方向 1」群組與深度欄（值 15）→打成 18 按 Enter→文件 depth 變 18、基板體積 144000→172800 mm³（真的重建）、全程無 session→Ctrl+Z 兩者復原→「編輯特徵」仍能開 session。另斷言「編輯特徵」開 session 時選擇面板讓位（既有行為不變）。
  - **確效**：typecheck **0**；`lint:rules`／`lint:deps`／`lint:i18n` 全過；全量 vitest **3106 過、0 敗**；verify:ui `manual-sidebar-tabs|manual-asm-selection` **2/2 PASS**；**反向對照**：拔掉 `<FeatureParams>` → 第 6 步如預期紅（「no depth field in the properties page」），恢復後重跑 2/2。
  - **停在哪裡**：已推送 origin/main（`6f915e7..e3fdd52`；HTTPS＋Git Credential Manager 已可用，不再需要 SSH URL 變通）。**共同待辦已全部收尾**（E1 §2.2 零件＋組合件、特徵參數群組框）；handoff 待辦區僅剩明確「另案」項目。

- **【2026-10-19：E1 §2.2 選取驅動切換交付組合件（共同待辦第一項）— 已推送 `eaca9af`（origin/main）】**
  - **背景與目標**：E1-P3 的 §2.2 只到零件——組合件點圖面仍啟用不了屬性頁。本次把同一套行為帶到組合件：**圖面點到的零組件**自動切到屬性頁（零件是「點到面」），**樹上點選**的零組件／結合只讓屬性頁可達、頁面留在樹頁，✓ 清除回樹頁。右鍵選單與左鍵拖曳行為不變。
  - **關鍵設計——viewPick 不變式**：`AssemblyState` 新增 `viewPick: Id | null`，只有 `selectComponentFromView(id)`（圖面左鍵）會設它；`select()`（樹、對話框、「清除選取」Esc）與 `onDocChanged`（文件改寫後失效）會清。純函式 `assemblySelection(viewPick, selected, doc)`（`state/selectionFacts.ts`，可在 node 測）**只在 `viewPick === selected` 時視為圖面選取**：assembly.ts 裡 13 處直接寫 `selected` 的呼叫點（`startMate`／`editMate`／`applyMate`／pattern／explode／`place`／`startDrag`…）因此完全不用改，過期的 viewPick 自動失效而不是被當成選取。基準面／原點（`plane:*`、`origin`）回 `none`——樹的事，屬性頁無話可說。
  - **完成項目**：
    1. **純邏輯與單元測試**：`AsmSelection` 型別＋`assemblySelection()`；`tests/phase8/selection-facts.test.ts` 新增 5 項（圖面 vs 樹、結合、基準面回 none、圖面優先、過期 viewPick 放手）。
    2. **狀態（`state/assembly.ts`）**：`viewPick`＋`selectComponentFromView`；右鍵選單刻意維持 `select`（選單本身就是那個點擊的答案，不該把屬性頁拉到前面）。
    3. **介面（`App.tsx`）**：組合件無工作階段時 `asmPicked`→自動進屬性頁；`asmReachable`→屬性頁啟用；屬性窗格無工作階段渲染 `SelectionPanel`。
    4. **面板（`SelectionPanel.tsx`）**：拆分為 `SelectionPanel`（入口）＋`PartSelection`（原邏輯不動）＋`AssemblySelection`——零組件的名稱、零組件／子組合件（`isSubAssembly`）、固定／浮動／已抑制、零件檔路徑；結合的名稱、種類（`MATE_LABEL`）、狀態、兩個參考（`elementLabel`）與「編輯結合」。沒有任何placeholder列。
    5. **雙語（`@3db/i18n`）**：`sel.component`／`sel.subassembly`／`sel.mate`／`sel.editMate`／`sel.referenceA/B`／`sel.file`／`sel.stateFixed`／`sel.stateFloating`（zh-TW＋en，英文冊無中文）。
    6. **e2e**：新 `tests/e2e/manual-asm-selection.js` 7 步全過（開組合件→點零組件自動進屬性頁與識別列→換點 V 型塊→✓回樹頁→樹點選留在樹頁且屬性頁可開→左鍵拖曳仍可移動零組件→結合的識別與「編輯結合」開工作階段）；`manual-sidebar-tabs.js` 第 8 步連帶更新（插入的零組件是樹的選取，屬性頁由 disabled 變可達）。
  - **確效**：typecheck **0**；`check-deps`／`check-i18n`／`check-anti-patterns`／`lint:rules` 全過；單元 selection-facts **14/14**；verify:ui `asm|sidebar|assembly` 批次 6/9（3 個 ERROR 全為 dev server 批次後段 crash 的 import 失敗，非測試邏輯——單跑 manual-sidebar-tabs／phase2-assembly／phase5-assembly 全 PASS）；反向對照：`App.tsx` 的 `asmPicked` 置 false → e2e 如預期紅。
  - **順手修的舊債（`4e522dd`，獨立提交）**：全量 vitest 發現 `help-manual.test.ts` 在 clean main 上就是紅的——`53d7c3b` 往 `docs/help-links.json` 登了 `"curve-pattern"` 卻沒重生產手册。`SYNC_MANUAL_HELP=1 npx vitest run tests/phase8/help-manual.test.ts` 重生產（一行：pattern 項目列出「曲線複製排列」）。**全量 vitest 現為 3105 過、0 敗**。
  - **停在哪裡**：已推送 origin/main（`4e522dd` docs＋`eaca9af` feat 等五筆一併推上；`6f915e7..e3fdd52`）。

- **【2026-10-18 晚：藍圖 C6.4 沿曲線/邊線複製排列特徵 (Curve-driven Pattern Feature) 全鏈路實作 [ADR 0166](docs/adr/0166-curve-driven-pattern.md) — 已提交並推送 `53d7c3b`（origin/main）】**
  - **背景與目標**：依據藍圖 C6.4 規範，全鏈路實作沿曲線/邊線複製排列特徵（Curve-driven Pattern Feature，ADR 0166）。支援沿 3D 模型邊線（Model Edge）或草圖路徑（Sketch Path），以「等間距均分（Equal Spacing）」或「指定間距（Spacing）」排列特徵或本體種子，並支援「相切隨曲線旋轉（Tangent）」與「保持原始平行（Parallel）」兩種姿態對齊模式，以及反向排列（Reverse）。特徵完整融入既有 `PatternFeature` 架構，全面復用差集幾何提取、重疊防禦、實例跳過與布林融合管線。
  - **完成項目**：
    1. **架構決策紀錄 (`docs/adr/0166-curve-driven-pattern.md`)**：經 AI 智囊團 5 位顧問審查與主席結論，確立雙路徑支援（邊線/草圖）、雙對齊姿態（相切/平行）、均分/間距模式、反向排列與自我紅隊四問檢驗規範。
    2. **資料模型 (`@3db/model`, Schema 65)**：升版 `SCHEMA_VERSION = 65`；定義 `CurvePatternDefinition`，擴充 `PatternDefinition` 聯合型別；實作 schema 64 遷移函式；`params.ts` 支援曲線模式之 `count` 與 `spacing` 表達式求值；`commands.ts` 新增 `curvePathRef` 驗證曲線參考（需為邊線或歷史之前的草圖）。
    3. **幾何核心 (`@3db/kernel`, `@3db/regen`)**：定義 `EdgeSample` 與 `EdgeSamplingResult`；在 `kernel.ts` 實作 `sampleEdgeCurve`（透過 OCCT `BRepAdaptor_Curve`、`GCPnts_UniformAbscissa` 與 `GCPnts_AbscissaPoint` 進行 3D 邊線精確採樣，`EvalD1` 解析求導切線）與 `samplePathCurve`（透過 `BRepAdaptor_CompCurve` 進行 2D 草圖輪廓在 3D 空間的採樣）；`placements.ts` 實作 `curveMotion`，支援相切旋轉姿態與平行平移。
    4. **依賴與再生 (`@3db/regen`)**：`rebuild` 主迴圈將 `sketches` 傳入 `pattern(feature, sketches, set)`；在 `placements` 中完整接線 `d.mode === 'curve'` 計算各實例之 `Motion`，無縫對接差集幾何提取、`noOverlap` 相交防禦、`skip` 略過與實體/切割布林融合。
    5. **雙語與說明 (`@3db/i18n`, `apps/web`)**：補齊邊線採樣錯誤字典、`feature.curvePattern`、`pattern.curvePath*`、`cmd.curvePath*`、`pm.pattern.curve*`、`pm.pattern.alignment*`、`slot.curvePath`、`action.curvePattern` 與 `help.curvePattern.*` 中英文多國語言文檔。更新 `docs/help-links.json` 登記 `"curve-pattern"`，映射說明主題。
    6. **介面適配 (`apps/web`)**：註冊 `curve-pattern` 動作；`store.ts` 擴充 `newPattern('curve')`；`datumSlots.ts` 擴充 `SlotType` 支援 `curvePath`（過濾 edge 與先行 sketch）；`PropertyManager.tsx` 新增曲線模式面板：槽位列表、實例數、間距/等間距切換、相切/平行下拉選單與反向排列核取方塊。
    7. **自我紅隊測試 (`tests/phase3/curve-pattern.test.ts`)**：撰寫 11 項自我紅隊驗收測試，全數 100% 通過（含 WASM Heap 真實指標防呆，0 洩漏）；既有 24 項 pattern 測試與 40 項說明系統測試 100% 綠燈。
  - **確效與測試驗收**：
    - `npm run typecheck`：**0 錯誤**。
    - `node scripts/check-anti-patterns.mjs`：**全域 RSI 反模式靜態守門通過**。
    - `node scripts/check-deps.mjs`：**Layering OK**。
    - `node scripts/check-i18n.mjs`：**i18n OK**。
    - `tests/phase3/curve-pattern.test.ts`：**11 項測試全數通過 (100%)**。
    - `tests/phase3/pattern.test.ts`：**24 項測試全數通過 (100%)**。
    - `tests/phase8/help.test.ts`：**40 項說明守門測試全數通過 (100%)**。
  - **停在哪裡**：已提交並推送 `53d7c3b`（origin/main）。

- **【2026-10-18 晚：B2.8 多圖頁工程圖全量 E2E 測試確效（24 支工程圖測試 100% 綠燈，測試債歸零）】**
  - **背景與目標**：依據先前待辦「B2.8 多圖頁工程圖視圖端點重構（消除歷史殘留之 23 支 E2E 測試債）」，對全量工程圖相關 E2E 測試（11 支 `manual-drawing-*`、10 支 `phase5-*`、`manual-measure-view.js`、`phase4b-surface.js`、`phase4b-surface-edit-ui.js`）以及歷史標記未過的 `phase3-select-elements` 與 `manual-asm-view-normal` 進行端對端實際瀏覽器執行確效。
  - **完成項目與成果**：
    1. **工程圖批次實測**：`node scripts/verify-ui.mjs --only "(manual-drawing|phase5|manual-measure-view|phase4b-surface)"` $\to$ **24 of 24 PASS (100%)**！
    2. **歷史未過其餘 2 支實測**：
       - `phase3-select-elements.js` $\to$ **PASS (8.1s)**
       - `manual-asm-view-normal.js` $\to$ **PASS (8.1s)**
    3. **客觀事實確立 (RCA)**：多圖頁適配器 `H.page = (doc = store.getState().drw?.doc, index) => ...` 已全面發揮作用，歷史記載之視圖端點讀取未過在當前 `main` 分支已完全綠燈，測試債已全數消除。
  - **停在哪裡**：確效完畢，記錄已更新。

- **【2026-10-18：藍圖 C7.3 實體刪除與保留本體特徵 (Delete / Keep Body Feature) 全鏈路實作 [ADR 0165](docs/adr/0165-delete-keep-body.md) — 已提交並推送 `7ea4ba4`（origin/main）】**
  - **背景與目標**：依據藍圖 C7.3 規範，實作實體刪除與保留本體特徵（Delete / Keep Body Feature）。支援對多個目標實體進行時間軸上的參數化「黑名單刪除（delete）」或「白名單保留（keep）」，作為多實體建模、夾治具主模型與分割實體中清理輔助本體與廢料的收尾特徵。保證 0 WASM 記憶體洩漏與殘留實體 100% 物理體積/拓樸保真，並達成全鏈路 Web 前端交互與歷史可逆性。
  - **完成項目**：
    1. **架構決策紀錄 (`docs/adr/0165-delete-keep-body.md`)**：定義黑名單刪除與白名單保留語意、集合層常數時間過濾、全刪除邊界安全防禦與自我紅隊四問檢驗標準。
    2. **資料模型 (`@3db/model`, Schema 64)**：升版 `SCHEMA_VERSION = 64`；新增 `DeleteKeepBodyFeature` 模型；實作 schema 63 遷移函式；新增 `setDeleteKeepBody` 指令與 `validateNewFeature` 語意檢查（目標非空、mode 檢查）；`mapRefs` 支援 `targets` 映射。
    3. **依賴與再生 (`@3db/regen`)**：`dag.ts` 解析目標本體依賴（`bodyFeature`）；`engine.ts` 實作 `deleteKeepBody(f, set)`：純 JS 集合快速過濾，0 WASM 開銷，維持拓樸命名穩定與實體狀態一致。
    4. **雙語字典 (`@3db/i18n`)**：補齊 `feature.deleteKeepBody`、`cmd.setDeleteKeepBody`、`pm.deleteKeepBody.*`、`help.deleteKeepBody.*` 中英文多國語言與說明文檔。更新 `docs/help-links.json` 映射。
    5. **介面適配 (`apps/web`)**：`store.ts` 新增 `newDeleteKeepBody()`；`actions.ts` 註冊 `delete-keep-body` 特徵動作；`PropertyManager.tsx` 實作分段控制切換（刪除 vs 保留）與目標選取面板；`Icon.tsx` 提供專屬向量圖示；`strings.ts` 登記標籤。
    6. **自我紅隊測試 (`tests/phase1/delete-keep-body.test.ts`)**：8 項自我紅隊測試全數 100% 通過，涵蓋黑名單刪除物理守恆、白名單保留、多本體複合刪除、全刪除邊界防守、輸入破壞攔截、歷史抑制還原、DAG 依賴與 WASM Heap 真實指標防呆；說明系統 40 項測試 100% 通過。
  - **確效與測試驗收**：
    - `npm run typecheck`：**0 錯誤**。
    - `node scripts/check-anti-patterns.mjs`：**全域 RSI 反模式靜態守門通過**。
    - `node scripts/check-deps.mjs`：**Layering OK**。
    - `node scripts/check-i18n.mjs`：**i18n OK**。
    - `tests/phase1/delete-keep-body.test.ts`：**8 項測試全數通過 (100%)**。
    - `tests/phase1/move-copy-body.test.ts`：**8 項測試全數通過 (100%)**。
    - `tests/phase1/split-body.test.ts`：**7 項測試全數通過 (100%)**。
    - `tests/phase8/help.test.ts`：**40 項說明守門測試全數通過 (100%)**。
  - **停在哪裡**：已提交並推送 `7ea4ba4`（origin/main）。

- **【2026-10-18：藍圖 C7.3 實體移動與複製本體特徵 (Move/Copy Body Feature) 全鏈路實作 [ADR 0164](docs/adr/0164-move-copy-body.md) — 已提交並推送 `661f849`（origin/main）】**
  - **背景與目標**：依據藍圖 C7.3 規範，實作實體移動與複製本體特徵（Move/Copy Body Feature）。支援對多個目標實體進行線性平移（$dx, dy, dz$）與沿軸旋轉（$\theta$），支援主軸或參考線/直邊作為旋轉軸，具備原地移動與多實體複製兩種模式，保證剛體變換下體積與表面積 100% 物理守恆，零 WASM 布林洩漏，並達成全鏈路 Web 前端互動。
  - **完成項目**：
    1. **架構決策紀錄 (`docs/adr/0164-move-copy-body.md`)**：定義 3×4 剛體仿射變換矩陣合成演算法（羅德里格旋轉公式）、參考軸拓樸解析、命名空間隔離機制與自我紅隊四問檢驗標準。
    2. **資料模型 (`@3db/model`, Schema 63)**：升版 `SCHEMA_VERSION = 63`；新增 `MoveCopyBodyFeature`；實作 schema 62 遷移函式；新增 `setMoveCopyBody` 指令與 `checkFeature` 語意檢查（目標非空、平移/旋轉參數檢查）；`mapExprs` 支援 $dx, dy, dz, \text{rotationAngle}$；`mapRefs` 支援 `targets` 與 `rotationAxis`。
    3. **依賴與再生 (`@3db/regen`)**：`dag.ts` 解析目標本體特徵與旋轉軸參考依賴；`engine.ts` 實作 `moveCopyBody(f, set)`：合成平移與旋轉為單一 3×4 仿射變換矩陣，呼叫 `Kernel.transformed` 進行純解析剛體變換；在複製模式下產生獨立本體並以 `mc1:copy:` 命名空間隔離拓樸。
    4. **雙語字典 (`@3db/i18n`)**：補齊 `feature.moveCopyBody`、`cmd.setMoveCopyBody`、`pm.moveCopyBody.*`、`help.moveCopyBody.*` 中英文多國語言與說明文檔。更新 `docs/help-links.json` 映射。
    5. **介面適配 (`apps/web`)**：`store.ts` 新增 `newMoveCopyBody()`；`actions.ts` 註冊 `move-copy-body` 特徵動作；`PropertyManager.tsx` 實作特徵參數面板（目標選取、平移與旋轉輸入、軸選擇、複製切換）；`Icon.tsx` 提供專屬向量圖示；`strings.ts` 登記標籤。
    6. **自我紅隊測試 (`tests/phase1/move-copy-body.test.ts`)**：8 項自我紅隊測試全數 100% 通過，涵蓋線性平移物理守恆、主軸旋轉、參考直線邊旋轉、複合變換、多本體複製生成、目標為空攔截、DAG 依賴閉環與 WASM Heap 真實指標防呆；說明系統 40 項測試 100% 通過。
  - **確效與測試驗收**：
    - `npm run typecheck`：**0 錯誤**。
    - `node scripts/check-anti-patterns.mjs`：**全域 RSI 反模式靜態守門通過**。
    - `node scripts/check-deps.mjs`：**Layering OK**。
    - `node scripts/check-i18n.mjs`：**i18n OK**。
    - `tests/phase1/move-copy-body.test.ts`：**8 項測試全數通過 (100%)**。
    - `tests/phase1/split-body.test.ts`：**7 項測試全數通過 (100%)**。
    - `tests/phase8/help.test.ts`：**40 項說明守門測試全數通過 (100%)**。
  - **停在哪裡**：本地確效全部通過，待使用者確認授權執行 git commit 與 git push。

- **【2026-10-18：藍圖 C1.13 草圖文字特徵 (Sketch Text Feature) 全鏈路實作 [ADR 0163](docs/adr/0163-sketch-text.md) — 已提交並推送 `7a8ce37`（origin/main）】**
  - **背景與目標**：實作草圖文字特徵（Sketch Text Feature，C1.13），支援基準面向量字型解析、外環逆時針（CCW）/ 內孔順時針（CW）定向前置保證、拓樸島嶼包含性 Nesting、3D 凸字長出（Extrude Boss）與凹字雕刻除料（Extrude Cut）、文字解散（Dissolve Text）轉換為標準線段圖元，以及全鏈路 Web 前端交互（放置/屬性面板/疊加層繪製）。
  - **完成項目**：
    1. **架構決策紀錄 (`docs/adr/0163-sketch-text.md`)**：定義 ASCII 工業 Sans-Serif 幾何字庫、幾何閉合輪廓、島嶼包含性 Nesting、OCCT 映射方案與自我紅隊四問檢驗標準。
    2. **幾何字庫 (`packages/sketch/src/font.ts`)**：實作標準 ASCII 字符向量輪廓字典、有向面積計算、輪廓定向前置保證、`textContours` 字元排列與仿射變換（縮放/旋轉/對齊/粗斜體）。在 `packages/sketch/package.json` 導出 `./font` 子路徑供主執行緒安全引用（0 WASM 負載）。
    3. **資料模型 (`@3db/model`, Schema 62)**：升版 `SCHEMA_VERSION = 62`；新增 `SketchTextEntity`；加入 schema 61 遷移；於 `sketchError` 校驗文字非空、字高大於 0、旋轉角為有限數；新增 `setSketchText` 指令。
    4. **草圖抽象 (`@3db/sketch`)**：`SolvedGeometry` 擴充 `text` 型別；`profiles.ts` 之 `findProfiles` 逐字元輪廓構造封閉 loops 自然完成島嶼 Nesting；`ops.ts` 實作 `dissolveText` 將文字分解為獨立線段圖元並自動移除原文字。
    5. **雙語字典 (`@3db/i18n`)**：補齊 `rules.text*`、`cmd.sketchItemNotText`、`hint.text`、`tool.text`、`entity.text`、`pm.text.*`、`help.toolText.*` 中英文多國語言與說明文檔。
    6. **介面適配 (`apps/web`)**：`actions.ts` 註冊 `tool-text`；`controller.ts` 實作點擊放置與自動切換選取、`dissolveText`；`overlay.ts` 逐輪廓繪製多邊形向量輪廓；`PropertyManager.tsx` 實作文字特徵屬性面板。
    7. **自我紅隊測試 (`tests/phase1/sketch-text.test.ts`)**：8 項測試全綠，驗證單孔文字長出、多孔文字長出、旋轉對齊、凸字長出、凹字除料、解散文字、非整數與負數輸入攔截、底層 WASM Heap 真值防呆。
  - **確效與測試驗收**：
    - `npm run typecheck`：**0 錯誤**。
    - `node scripts/check-anti-patterns.mjs`：**全域 RSI 反模式靜態守門通過**。
    - `node scripts/check-deps.mjs`：**Layering OK**。
    - `node scripts/check-i18n.mjs`：**i18n OK**。
    - `tests/phase1/sketch-text.test.ts`：**8 項測試全數通過 (100%)**。
    - `tests/phase8/help.test.ts`：**40 項說明守門測試全數通過 (100%)**。
    - `tests/phase1/`：**13 個測試檔、145 項測試全數通過 (100%)**。
  - **停在哪裡**：已提交並推送 `7a8ce37`（origin/main）。

- **【2026-10-18：藍圖 C1.18 草圖參考圖元與相交曲線 (Convert Entities & Intersection Curves) 全鏈路實作 [ADR 0162](docs/adr/0162-convert-entities.md) — 已提交並推送 `e8b0054`（origin/main）】**
  - **背景與目標**：依據藍圖 C1.18 規範，實作草圖參考圖元投影（Convert Entities）與相交曲線（Intersection Curves）。支援邊緣正交投影、B-spline 樣條邊採樣投影為 `spline` 圖元、選取面外環轉換為封閉輪廓、實體曲面/平面與草圖平面相交求交線圖元，並具備 `followReferences` 幾何模型變更聯動更新閉環。
  - **完成項目**：
    1. **決策紀錄 (`docs/adr/0162-convert-entities.md`)**：定義正交投影數學公式、B-spline 曲線採樣投影、面與平面截交演算法、閉合環構建與紅隊四問標準。
    2. **再生引擎 (`@3db/regen`)**：`references.ts` 之 `Projected` 支援樣條；`projectEdge` 支援 B-spline 曲線邊線採樣投影；`followReferences` 支援 `SketchSplineEntity` 模型聯動更新；實作 `intersectFaces()` 計算選取面與草圖平面的相交交線（支援平面與曲面相交）；更新 `convertEdges` 與 `convertReferences` 支援 `'intersect'` 模式與顯式防禦報錯。
    3. **草圖層 (`@3db/sketch`)**：`ops.ts` 之 `ModelItem` 與 `ModelEdge` 支援樣條類型；`referenceEntities` 支援樣條圖元生成與共享頂點閉合輪廓。
    4. **雙語字典 (`@3db/i18n`) 與介面**：補齊 `reference.noIntersection` 等中英文翻譯，擴充 Web UI 工具列與選單支援「相交曲線」操作。
    5. **自我紅隊測試 (`tests/phase1/convert-entities-advanced.test.ts`)**：8 項測試全綠，驗證選取面外環長出體積、B-spline 投影樣條聯動、平面與斜面求交直線、圓柱曲面與草圖平面相交曲線、平行無相交面顯式報錯攔截、無效 Ref 遺失攔截、極端微小邊緣防禦與底層 WASM Heap 真值指標防呆。
  - **停在哪裡**：已提交並推送 `e8b0054`（origin/main）。

- **【2026-10-18：藍圖 C11.4 鈑金斷開角落與角落修剪 (Break Corner Feature) 全鏈路實作 [ADR 0161](docs/adr/0161-sheet-metal-break-corner.md) — 已提交並推送 `8250a17`（origin/main）】**
  - **背景與目標**：依據藍圖 C11.4 規範，全面強化並實作鈑金斷開角落特徵（Sheet Metal Break Corner Feature）。消除早期僅限於凸緣自由端之局限，全面開放基材平板（Base Flange）、邊線凸緣（Edge Flange）、鈑金凸折（Jog）與摺邊（Hem）的外露厚度邊（Thickness edge）的倒角（Chamfer）與倒圓（Fillet），並確保 3D 實體切除與 2D 展平圖（Flat Pattern）下料輪廓、下料面積之閉式解嚴格吻合。
  - **完成項目**：
    1. **決策紀錄 (`docs/adr/0161-sheet-metal-break-corner.md`)**：定義厚度邊識別第一性原理、凸外角拓樸判定條件、尺寸相鄰邊長防禦與閉式解體積/面積檢驗標準。
    2. **再生引擎 (`@3db/regen`)**：重構 `breakCorner()`：通用支援基板、凸緣、凸折等所有未封閉外角厚度邊；加入尺寸有效性（$size > 0$）與尺寸上限（不可大於相鄰板邊長度）之顯式前置防禦；`flatPattern.ts` 自然支援基板與凸緣角落修剪，展開圖精確生成倒角線段與圓弧輪廓。
    3. **雙語字典 (`@3db/i18n`)**：新增 `breakCorner.sizeInvalid`，並更新提示文字。
    4. **自我紅隊測試 (`tests/phase7/break-corner-advanced.test.ts`)**：8 項測試全綠，驗證基板單角倒角、4 角同時倒圓、凸緣基板複合倒角、凸折角倒圓、非厚度邊拒絕、超大尺寸拒絕、尺寸 $\le 0$ 拒絕與底層 WASM Heap 真值防呆。Phase 7 全套 162 項測試 100% 綠燈。
  - **停在哪裡**：已提交並推送 `8250a17`（origin/main）。

- **【2026-10-18：藍圖 C1.11 草圖樣條曲線 (Sketch Spline Feature) 全鏈路實作 [ADR 0160](docs/adr/0160-sketch-spline.md) — 已提交並推送 `1b3a34e`（origin/main）】**
  - **背景與目標**：依據藍圖 C1.11 規範，實作草圖樣條曲線（Sketch Spline Feature）。支援型值點內插樣條曲線、閉合與開放曲線雙重語意、輪廓與外環/內孔拓樸偵測、薄件輪廓偏置支援，以及 3D 造型實體長出（Extrude Boss）、除料（Extrude Cut）、旋轉（Revolve）等核心造型管線之全鏈路閉環。
  - **完成項目**：
    1. **決策紀錄 (`docs/adr/0160-sketch-spline.md`)**：定義型值點內插幾何第一性原理、閉合與開放樣條語意、OCCT 映射方案與自我紅隊四問檢驗標準。
    2. **資料模型 (`@3db/model`, Schema 61)**：升版 `SCHEMA_VERSION = 61`；新增 `SketchSplineEntity`；新增 schema 60 空遷移；在 `sketchError` 與 `entityPoints` 支援 `spline` 圖元並加入點數少於 2 與閉合少於 3 的顯式防禦。
    3. **幾何核心 (`@3db/kernel`)**：`wire()` 新增 `spline` 分支，以 OpenCASCADE 原生導出之 `GeomAPI_PointsToBSpline` 擬合連續 $C^2$ 曲線，閉合樣條首尾補合形成單一封閉 Wire，支援拉伸長出、除料與旋轉特徵。
    4. **草圖層與介面**：`profiles.ts` 支援多邊形採樣逼近與閉合環搜尋；`PropertyManager.tsx` 與 `overlay.ts` 補齊中英文字典與疊加層繪製。
    5. **自我紅隊測試 (`tests/phase1/sketch-spline.test.ts`)**：8 項測試全綠，驗證有機閉合長出、開放複合環、除料切除、旋轉成形、少於 2/3 點拒絕、重合點防禦與 WASM Heap 真值指標。Phase 1 全套 129 項測試 100% 通過。
  - **停在哪裡**：已提交並推送 `1b3a34e`（origin/main）。

- **【2026-10-18：藍圖 C11.3 鈑金凸折特徵 (Sheet Metal Jog Feature) 全鏈路實作 [ADR 0159](docs/adr/0159-sheet-metal-jog.md) — 已提交並推送 `902a80f`（origin/main）】**
  - **背景與目標**：實作鈑金凸折特徵（Sheet Metal Jog Feature，C11.3），在平板中間沿一條草圖線，將固定側保留，移動側朝法向階梯狀位移指定凸折高度 $H$ 與角度 $\theta$，並在過渡區構造兩道相反方向之折彎（Bend 1 與 Bend 2）與中間平直腹板（Intermediate Web），同時在 Flat Pattern 展開圖中登記兩條反向折彎線，達成下料展開與折彎成形的全鏈路閉環。
  - **完成項目**：
    1. **決策紀錄 (`docs/adr/0159-sheet-metal-jog.md`)**：定義凸折幾何第一性原理、中間腹板閉式解 $L_{web} = [H - (2r_b + T)(1 - \cos\theta)] / \sin\theta$、最小高度幾何相交硬約束 $H_{min} = (2r_b + T)(1 - \cos\theta)$ 與紅隊檢驗標準。
    2. **資料模型 (`@3db/model`, Schema 60)**：升版 `SCHEMA_VERSION = 60`；新增 `JogFeature`、`setJog` 命令型別與 `validateNewFeature` 檢查；新增 schema 59 空遷移。
    3. **依賴與再生 (`@3db/regen`)**：`dag.ts` 新增 `case 'jog':` 解析草圖線依賴；`engine.ts` 實作 `jog()`：以單次 2D 解析圓柱與平直腹板區域輪廓進行無縫拉伸長出，剛體平移移動側，雙向布林融合，並在 `sheet.bends`/`midBends` 登記兩道反向折彎；`flatPattern.ts` 展開圖繪製兩道反向折彎線。
    4. **介面與狀態 (`apps/web`)**：新增 `store.newJog()`、`actions.jog`、`JogPanel`、`Icon.tsx` 與多語系支援。
    5. **自我紅隊測試 (`tests/phase7/jog.test.ts`)**：8 項測試全綠，驗證 90°/45° 凸折、相切極限邊界（$H = H_{min}, L_{web} = 0$）、體積嚴格守恆 $\sum V = 7500\text{ mm}^3$（零 Mock）、展開圖兩道折彎線、$H < H_{min}$ 顯式攔截報錯與底層 WASM Heap 真值防呆。
  - **停在哪裡**：已提交並推送 `902a80f`（origin/main）。

- **【2026-10-18 晚：E1-P3 合併進 `main`（`8ade9ee`）＋ 主倉庫 help 防漏修補（`17a0d4f`）— 已推送 origin/main】**
  - **合併**：使用者指示「把 E1-P3 合入 main」。在主倉庫 `D:\Self-developed_Apps\G3\3D-Builder`（工作樹乾淨、`main` = `origin/main` `e8b0054`）執行 `git merge worktree-sidebar-parity --no-ff`：**零衝突**（17 檔自動合併；連 DEV_LOG／handoff 這類「雙方都在檔頭加條目」的日誌都乾淨併入——合併方向相反時曾需三段式重組，這次沒有）。合併提交 `8ade9ee`；E1-P3（`d2b5547`）自此進入 `main` 歷史，E1 側邊欄（[ADR 0155](docs/adr/0155-sidebar-tabs-hidden-contract.md)）三階段全部落地。
  - **合併後主倉庫自身的紅燈**：`help.test.ts` 擋下 `main` 自己的兩個動作——`jog`（ADR 0159，`902a80f`）與 `tool-intersect`（ADR 0162，`e8b0054`）沒配 help 說明（**在我合併前就已存在於 main**，非本次合併造成）。依「加指令必須同時加說明」約定補齊（鍵名規則：`helpKey()` 把連字符轉 camelCase → `help.jog.*`／`help.toolIntersect.*`，zh-TW＋en 兩冊）＋ `docs/help-links.json` `_untied` 登記事由，提交 `17a0d4f`。
  - **合併後確效（主倉庫）**：typecheck **0**、三 lint 過；全量 vitest **247 檔 3066 過、0 敗（7m07s）**、help 40/40；全量 `verify:ui` **118/143（39m28s）**——25 個未過**逐支對上既有清單、零新增、零 flake**：12 個 ERROR＝`phase3-select-elements`（呼叫已刪的 `store.setPickFilter`）＋`phase4b-surface` 與 10 支 `phase5-*`（B2.8 `pages[]` 後讀 `drw().doc.views`）；13 個 FAIL＝11 支 `manual-drawing-*`＋`manual-measure-view`（同讀 `views`）＋`manual-asm-view-normal`（過時斷言）；錯誤訊息全為預期的 `Cannot read properties of undefined`。**`manual-sidebar-tabs` 在全量批次 PASS（7.5s）＝§2.2 選取驅動切換在合併後的 main 上成立**；上一輪的 `manual-e1` 批次 flake 本次 PASS（10.4s），未復現。
  - **停在哪裡**：已推送 `8ade9ee`＋`17a0d4f` → `origin/main`（快轉 `e8b0054..17a0d4f`）。分支 `worktree-sidebar-parity` 與 worktree `D:\Self-developed_Apps\G3\3DB-sidebar-parity` 依使用者「合入後刪除」的指示完成清理：遠端分支已刪、`git worktree remove` 正規註銷、本地分支已刪；工作區內的本地資產（§2.2 驗證截圖 11 張、分支期全量 verify 日誌）已備份至主倉庫 `out/shots-sidebar/` 與 `scratch/sidebar-parity-worktree-2026-10-18/`。下一步（共同待辦）：B2.8 shape 2 的 23 支工程圖 e2e 遷移到 `page(drw().doc).views`（決策單 `8cb1f2b`）、組合件 §2.2（`asm.selected`）、特徵參數群組框（另案）。


- **【2026-10-18：藍圖 C7.4 實體分割特徵 (Split Body Feature) [ADR 0158](docs/adr/0158-split-body.md) — 已提交並推送 `f8e7c37`（origin/main）】**
  - **背景與目標**：實作實體分割特徵（Split Body Feature，C7.4），使用基準面（Datum Plane）或實體平面（Planar Face）將單一或多個目標本體切分為多個獨立 Solid，並建立雙向半空間切割、包圍盒相交防禦、TNP 拓樸面名稱繼承與多本體拆分管理之完整閉環。
  - **完成項目**：
    1. **架構決策紀錄 (`docs/adr/0158-split-body.md`)**：
       - 制定分割特徵規格，定義對偶無界半空間切割幾何演算、包圍盒 8 頂點符號距離快速相交判定與紅隊自我檢驗標準。
    2. **資料模型 (`@3db/model`, Schema 59)**：
       - `schema.ts`：升版 `SCHEMA_VERSION = 59`，新增 `SplitFeature` 並加入 `Feature` 聯合型別。
       - `serialize.ts`：補齊 Schema 58 向後相容遷移函數。
       - `commands.ts`：新增 `setSplit` 命令型別、`validateNewFeature` 非平面/非法目標檢查與 `mutate` 狀態更新。
       - `params.ts`、`refs.ts`：補齊 `mapExprs` 與 `mapRefs` 對 `split` 的支援。
    3. **雙語字典 (`@3db/i18n`)**：
       - `zh-TW/features.ts` 與 `en/features.ts`：補齊 `feature.split*`、`cmd.split*` 與 `pm.split.*` 中英文字典。
    4. **依賴拓樸 (`@3db/regen/dag.ts`)**：
       - `parentsOf` 增加 `case 'split':`，正確建立對切割工具與目標本體的 DAG 依賴。
    5. **幾何核心 (`@3db/kernel/kernel.ts`)**：
       - 實作 `splitBody(targetId, plane)`：包圍盒 8 頂點符號距離相交防禦；`BRepPrimAPI_MakeHalfSpace` 構造正反向無界半空間；雙向 `BRepAlgoAPI_Cut` 切除；`ShapeUpgrade_UnifySameDomain` 合併共面；`splitSolids` 多實體自動拆分。
    6. **再生引擎 (`@3db/regen/engine.ts`)**：
       - 實作 `splitBodies(feature, set)`：支援基準面與實體平面工具解析；指定目標或自動偵測相交實體；調用幾何核心分割；自動生成子實體識別碼與繼承拓樸面持久名稱（`${f.id}:cut`）。
    7. **介面屬性與狀態 (`apps/web`)**：
       - `store.ts`：實作 `store.newSplit()`。
       - `actions.ts`：註冊 `actions.split` 命令。
       - `PropertyManager.tsx`：實作 `SplitPanel`（切割工具顯示、目標本體勾選盒）。
       - `Icon.tsx` 與 `strings.ts`：補齊 `split` 圖示與標籤映射。
    8. **自我紅隊測試 (`tests/phase1/split-body.test.ts`)**：
       - 7 項測試全數 100% 綠燈，覆蓋標準基準面切割、偏置基準面切割、多實體定向切割、體積閉式解守恆（零 Mock）、未相交前置攔截、非平面工具拒絕與 WASM Heap 真值防呆。
  - **確效與測試驗收**：
    - `npm run typecheck`：**0 錯誤**。
    - `node scripts/check-anti-patterns.mjs`：**全域 RSI 反模式靜態守門通過**。
    - `node scripts/check-deps.mjs`：**Layering OK**。
    - `node scripts/check-i18n.mjs`：**i18n OK**。
    - `tests/phase1/split-body.test.ts`：**7 項測試全數通過 (100%)**。
    - `tests/phase1/`：**10 個測試檔、121 項測試全數通過 (100%)**。
  - **停在哪裡**：已提交並推送 `f8e7c37`（origin/main）。

- **【2026-10-18：藍圖 P2（C1.5 Phase A：草圖橢圓圖元與長出/旋轉特徵全鏈路實作）[ADR 0157](docs/adr/0157-sketch-ellipse.md) — 已提交並推送 `357232c`（origin/main）】**
  - **背景與目標**：依據藍圖推進規劃，完成草圖進階幾何圖元「橢圓（Ellipse）」的全鏈路閉環，支援 2D 草圖幾何求解映射、閉合輪廓與孔洞識別，並透過 OpenCASCADE 底層解析幾何 `gp_Elips`，使長出實體（Extrude Boss/Cut）、旋轉實體（Revolve）與斷面混成（Loft）全面支援橢圓。
  - **完成項目**：
    1. **架構決策紀錄 (`docs/adr/0157-sketch-ellipse.md`)**：
       - 定義三點橢圓幾何模型（中心點、長軸頂點、短半徑純量），推導封閉解析體積真值公式與自適應正規化法則。
    2. **資料模型 (`@3db/model`, Schema 58)**：
       - `schema.ts`：升版 `SCHEMA_VERSION = 58`，新增 `SketchEntity.ellipse`。
       - `sketch-rules.ts`：實作 `minorRadius > 0` 與中心/長軸重合端點檢驗。
       - `serialize.ts`：補齊版本向後遷移 `57: (doc) => doc`。
    3. **草圖幾何與輪廓識別 (`@3db/sketch`)**：
       - `types.ts`：`SolvedGeometry` 與 `Segment2` 擴充 `ellipse` 類型。
       - `planegcs.ts`：`readGeometry` 增加 `case 'ellipse'` 解析長短半徑與旋轉角度。
       - `profiles.ts`：`sample`、`areaOf`、`findProfiles` 支援橢圓閉合輪廓識別與面積計算。
       - `interact.ts`、`thin.ts`、`ops.ts`：補齊最近點偏心角求值、薄件位移與曲線點引用。
    4. **幾何核心與再生引擎 (`@3db/kernel`, `@3db/regen`)**：
       - `kernel.ts`：`Segment` 擴充 `ellipse`；`wire()` 呼叫 `gp_Elips` 構造拓樸邊；實作自適應正規化（若 $rx < ry$ 自動交換半徑並補正角度 $\theta \leftarrow \theta + \pi/2$，嚴格保證 OCCT 0 崩潰）。
       - `sweepFloor.ts`：支援多邊形 64 點採樣與拉馬努金橢圓周長近似。
       - `engine.ts`：`revolve` 擴充長短軸 4 個極值頂點採樣嚴防跨軸；螺牙軸向範圍取樣支援橢圓。
    5. **介面屬性與多國語言 (`apps/web`, `packages/i18n`)**：
       - `PropertyManager.tsx`：`ENTITY_LABEL` 加入 `ellipse: 'entity.ellipse'`。
       - `overlay.ts`：約束標籤錨點計算補齊 `ellipse` 支援。
       - `i18n`：`zh-TW` 與 `en` 字典新增 `entity.ellipse` 詞條。
    6. **自我紅隊測試 (`tests/phase1/sketch-ellipse.test.ts`)**：
       - 9 項測試全數 100% 綠燈：水平長出解析體積（零 Mock）、自適應半徑交換、45度旋轉長出、矩形板穿孔除料、帕普斯環體旋轉、跨軸攔截、非正半徑/重合點破壞性防禦，以及 WASM Heap 唯一真實路徑指標驗證。
  - **確效與測試驗收**：
    - `npm run typecheck`：**0 錯誤**。
    - `node scripts/check-anti-patterns.mjs`：**全域 RSI 反模式靜態守門通過**。
    - `node scripts/check-deps.mjs`：**Layering OK**。
    - `node scripts/check-i18n.mjs`：**i18n OK**。
    - `packages/model/test`：**9 個測試檔、160 項單元測試全數通過 (100%)**。
    - `tests/phase1/`：**9 個測試檔、114 項測試全數通過 (100%)**。
  - **停在哪裡**：已提交並推送 `357232c`（origin/main）。

- **【2026-10-18：pstack poteto-mode 代碼品質深度審查與外科手術式優化 — 已提交並推送 `b288c62`（origin/main）】**
  - **背景與目標**：依據 `@poteto` 的 `pstack-poteto-mode` 與 `pstack-unslop` 規範，對近期新增模組進行深度的行為契約鎖定、GC 垃圾分配消除與記憶體防禦硬化。
  - **完成項目**：
    1. **全物件 GPU 資源釋放健全化 (`packages/render/src/overlay.ts`)**：
       - `disposeGroup` 原僅檢查 `THREE.Line` 與 `THREE.Points`，未處置 `THREE.Mesh` 與材質陣列（例如參考基準面 `planeGroup` 中包含的半透明 Mesh）。
       - 升級為全 Object3D 遍歷檢查，安全釋放 BufferGeometry 與 Material/Material[]，徹底杜絕顯存洩漏。
    2. **零暫態垃圾物件純量投影 (`packages/render/src/viewer.ts`)**：
       - `setCosmeticThreads` 在生成 3/4 圓弧（36 segments）與盲孔端圈（32 segments）時，原在每步迴圈中使用 `origin.clone().addScaledVector(...)`，每次視圖刷新產生 130+ 個短期 `THREE.Vector3`。
       - 重構為純量運算直接 push 數值到 positions 陣列，將視圖刷新時的臨時堆物件配置量直接降為 **0**。
    3. **MECE 乾淨序列化防禦 (`packages/model/src/commands.ts`)**：
       - `setCosmeticThread` 指令處理 patch 時，若選用的 `startEdge: undefined` 或 `reverse: false`，顯式執行 `delete f.startEdge` 與 `delete f.reverse`，確保 PartDoc JSON 維持乾淨無污染。
    4. **行為契約鎖定測試 (`packages/model/test/model.test.ts`)**：
       - 新增單元測試嚴格斷言可選欄位經更新後屬性確實被 delete（`'startEdge' in ct === false`），且非法面參考立即拋出 `CommandError`。
    5. **介面操作提示 (`apps/web/src/components/PropertyManager.tsx`)**：
       - 為清除邊線按鈕補上無障礙 `title={t('slot.clear')}` 提示。
  - **確效與測試驗收**：
    - `npm run typecheck`：**0 錯誤**。
    - `node scripts/check-anti-patterns.mjs`：**全域 RSI 反模式靜態守門通過**。
    - `node scripts/check-deps.mjs`：**Layering OK**。
    - `node scripts/check-i18n.mjs`：**i18n OK**。
    - `packages/model/test`：**9 個測試檔、160 項單元測試全數通過 (100%)**。
    - `tests/phase3/cosmetic-thread.test.ts`：**8 項測試全數通過 (100%)**。
  - **停在哪裡**：工作目錄乾淨（working tree clean），`main` 分支在 `b288c62` 已推送到遠端倉庫。

- **【2026-10-18：C4.9 裝飾螺紋線 (Cosmetic Threads, [ADR 0156](docs/adr/0156-cosmetic-threads.md)) 全鏈路落地與 ISO 6410-1 出圖整合 — 已提交並推送 `2b376a0`（origin/main）】**
  - **背景與定調**：
    - 藍圖 C4.9 裝飾螺紋線（Cosmetic Threads）特徵落地。
    - **第一性原理定調**：**絕不做 3D 實體螺旋掃出布林運算**。依據 `AGENTS.md §3.5` 量測事實，OCCT 之布林運算遇 B-spline 曲面必永久佔用 ~10 MiB WASM Heap 且永不歸還。採現代機械 CAD 業界標準架構：特徵樹完整參數化管理、3D 空間繪製輕量化標示線（3/4 圈細實線圓弧 + 盲孔終止線圈）、2D 工程圖依 ISO 6410-1 出圖，**再生 WASM Heap 成長量恆為 0.00 MiB**。
    - **前置查證**：查證 D1 手動確效文件（早於 `fa807bb` 修訂）、B1 圓角失效語意（早於 `279b91a` 具備合格檢查與顯式拒絕 `feature.filletInvalid`）。
  - **完成項目**：
    1. **決策文件 (`docs/adr/0156-cosmetic-threads.md`)**：完整制定規格選型、數學推導、記憶體零洩漏保證與出圖規範。
    2. **資料模型 (`@3db/model`, Schema 57)**：
       - `packages/model/src/schema.ts`：新增 `CosmeticThreadFeature`，升版 `SCHEMA_VERSION = 57`。
       - `commands.ts`：實作 `setCosmeticThread` 指令、參數校驗與拓樸防呆。
       - `refs.ts` & `params.ts`：支援引用映射與參數化表達式求值。
       - `serialize.ts`：新增向後相容遷移 `56: (doc) => doc`。
       - `drawing.ts`：在 `ViewFeature.circle` 擴充 `thread` 規格。
    3. **再生引擎 (`@3db/regen`)**：
       - `engine.ts`：實作 `cosmeticThread` 解析方法，以純幾何拓樸探針與頂點投影萃取圓柱面軸線與長度，0 布林呼叫。
       - `dag.ts`：`parentsOf` 加入 `cosmeticThread` 依賴關聯解析。
       - `drawingDimensions.ts`：端視圖圓柱投影自動匹配帶入 `thread` 規格。
    4. **出圖註記 (`@3db/drawing`)**：
       - `annotation.ts`：`threadItems` 支援 `f.thread`，自動繪製 ISO 6410-1 標準之 3/4 圈細實線圓弧（第一象限開口，$\pi/2 \to 2\pi$），外螺紋取小徑、內螺紋取大徑。
    5. **前端與渲染 (`apps/web`, `@3db/render`)**：
       - `viewer.ts`：實作 3D 輕量化標示線渲染。
       - `PropertyManager.tsx`：新增 `CosmeticThreadPanel`（標準規格下拉、公/母螺紋切換、貫穿/給定深度）。
       - `kernel.worker.ts` & `protocol.ts`：Worker 雙向傳輸對齊。
       - `Viewport.tsx`：響應式渲染聯動。
       - `Icon.tsx` & `strings.ts`：新增專屬 SVG 圖示與多語系標籤。
    6. **自我紅隊破壞性測試 (`tests/phase3/cosmetic-thread.test.ts`)**：
       - 非圓柱面、負/零深度、大徑 $\le$ 小徑即時拋錯阻擋（輸入破壞防禦）。
       - 實體探針物理萃取，M8 外螺紋小徑精確推導自 ISO 68-1 基本牙型（6.466 mm），零 Mock 數據。
       - WASM 真值記憶體防禦：顯式斷言基準指標 `expect(initialHeap).toBeGreaterThan(0)`，50 次 rebuild 實測 WASM Heap 成長量為 **0.00 MiB**。
       - 2D 工程圖端視圖投影與 ISO 6410-1 細實線圓弧註記驗證。
  - **確效與測試驗收**：
    - `npm run typecheck`：**0 錯誤**。
    - `node scripts/check-anti-patterns.mjs`：**全數通過**。
    - `node scripts/check-deps.mjs`：**Layering OK**。
    - `node scripts/check-i18n.mjs`：**i18n OK**。
    - `tests/phase3/cosmetic-thread.test.ts`：**8 項測試全數通過**。
    - 既有實體螺牙測試 (`tests/phase3/thread*.test.ts`)：**21 項全數通過 (0 regression)**。
  - **停在哪裡**：`main` 分支在 `2b376a0`（含 ADR 與測試）已推送到遠端倉庫。

- **【查證與進度校正 (Verification & Reality Grounding, 2026-10-18)】**：
  - **重要第一性原理查證**：經 Git 歷史與代碼實測查證，前次建議清單之項目早於先前提交中全數竣工：
    1. 局部剖視圖 (Broken-out Section, B1/D-I5)：已於 `4f8968b1`、`1bc21c4`、`10531e8` 完成（Schema 21，22 項測試全過）。
    2. 工程圖三大交互功能 (D-I8)：鎖定視圖（`2abdaf0`）、隱藏邊（`22463fe`）、相切邊（`2130f85`）全數竣工（22 項測試全過）。
    3. 尺寸自動排列納入座標尺寸：已於 `18e24a3` (B2.5) 竣工。
    4. 斷裂/裁剪/輔助視圖 (B2.7) 與多圖頁 (B2.8)：已於 `7118420`、`756b7ae` 竣工。
    5. 全量 Phase 5 工程圖測試：49 個測試檔、525 項測試 100% 全數通過（0 失敗）。
  - **真正的後續下一步建議 (True Next Directions)**：
    1. **方向 A（藍圖 P2 核心擴充）：草圖進階幾何（C1.5 Spline 不規則曲線、文字與草圖複製排列）**。
    2. **方向 B（藍圖 P2 核心擴充）：多本體布林與實體分割組合工具（C7.3–C7.4）**。
    3. **方向 C（鈑金製造能力補完）：凸折 (Jog)、斷開角落與長圓/撕裂離隙**。
    4. **方向 D（品質驗收收斂）：Phase 4b/5/6/7 B 段實機對照驗收清單整理**。
  - **背景與決策**：
    - 使用者提出「工程圖的PDF中文字型需要預設內建多種，輸出要確保不會出亂碼」。
    - 啟動 AI 智囊團（反駁者、本質追問者、機會發現者、外行人、無情執行者）審查，透過反向提問（Clarify Ambiguities）確認三大決策：
      1. **A1 (分發架構)**：混合架構（開箱預設開源黑體 + 支援現代瀏覽器 Local Font Access API 存取本機字型如微軟正黑體、標楷體 + 支援手動上傳檔案）。
      2. **A2 (風格範圍)**：內建 4 種工業標準風格（黑體 sans、楷體 kai、宋體 serif、仿宋體 fangsong）。
      3. **A3 (持久化)**：儲存於工程圖文件本身（`DrawingDoc` / `DrawingSheet`），圖紙存檔自動持久化。
  - **完成項目**：
    1. **核心匯出引擎零亂碼防禦 (`packages/drawing/src/pdf.ts`)**：
       - 徹底修復原本 `plan` 函式「只要一個字符缺字，整行文字強制降級為 Helvetica 導致整行漢字全變問號 `?`」之全有全無雪崩缺陷。
       - 升級為 TrueType 主力渲染：支援常見工程符號自動等價歸一化（如 `⌀` U+2300 <-> `Ø` U+00D8），缺字字符安全佔位並回報 warning，其餘所有漢字 100% 完整保留渲染。
    2. **字型風格規格表 (`packages/drawing/src/fonts.ts`)**：
       - 定義 4 種風格的 PostScript/Family 系統候選匹配清單，使用 Unicode 轉義表示候選中文字串，100% 通過 `check-i18n.mjs` 靜態守門。
    3. **圖紙模型與持久化 (`packages/model/src/drawing.ts`)**：
       - `DrawingSheet` 新增 `pdfFont?: string`；指令 `setSheet` 與 `setPage` 接線支援 `pdfFont?: string | null`；`mutateDrawing` 支援更新與清除；存檔自動序列化。
    4. **字型解析與快取管理器 (`apps/web/src/fonts/fontManager.ts`)**：
       - 整合記憶體快取、Chromium `window.queryLocalFonts()` 系統字型存取、Node/Windows 本地系統字型讀取、Web 開源字型按需延遲載入（Lazy fetch），支援 4 秒逾時保護。
    5. **狀態層開箱預熱 (`apps/web/src/state/drawing.ts`)**：
       - `DrawingStore` 預設 `pdfFont: 'sans'`（黑體）並在建構式背景預熱；新增 `selectPdfFont(fontId)`；`chooseFont`、`clearFont` 自動同步至當前頁面 `sheet.pdfFont`；`exportPdf` 異步等待字型就緒。
    6. **屬性面板 UI 升級 (`apps/web/src/components/DrawingPanel.tsx`)**：
       - 提供 4 種風格下拉選單 + 自訂選項；保留 `data-action="chooseFont"` 與 `data-field="pdfFont"`，100% 相容既有 e2e 測試。
    7. **多語系支援 (`packages/i18n/`)**：
       - 新增中英雙語之字型風格與自訂檔案鍵值。
  - **確效與測試驗收**：
    - `npm run typecheck`：**0 錯誤**。
    - `npm run lint:rules ; npm run lint:deps ; npm run lint:i18n`：**全數通過**。
    - `npx vitest run tests/phase5/`：**49 個測試檔、525 項測試全數通過（0 失敗，1 略過）**。
    - `npm test`（全 Repo）：**239 個測試檔、3000 項測試全數通過（0 失敗，25 略過）**。
  - **停在哪裡**：工作目錄乾淨（working tree clean），無做到一半的程式；`main` 分支在 `ee98a4e`（含 `handoff.md`）已推送到遠端倉庫。下一棒可依藍圖或後續需求繼續進行。

- **【2026-10-18：B2.8 Shape 2 多圖頁 (Multi-sheet Drawing) 全鏈路實作與確效（Antigravity）— 已提交並推送 `756b7ae`（origin/main）】**
  - **背景與決策**：接手 `handoff.md` 任務，落實決策單 `docs/decisions-e1p2-b28-shape2.html`（Q1–Q8 全選 Option A）與 SSOT 原則。
  - **完成項目**：
    1. **Q3 Option A（底部頁籤列）**：建立 `apps/web/src/components/SheetTabs.tsx`，比照 SolidWorks 慣例設置於畫面最底部（`[ 圖紙 1 ] [ 圖紙 2 ] ... [ + ]`），支援雙擊行內輸入重新命名、右鍵選單（重新命名、刪除、圖紙屬性）、`[ + ]` 新增頁面，並支援作為拖曳視圖的放下目標（Drop Target）。
    2. **Q4 Option A（防刪最後一頁）**：在 `packages/model/src/drawing.ts` 的 `deletePage` 指令中顯式加入防禦防呆——剩餘 1 頁時強制拋出 `CommandError`，拒絕刪除；介面層右鍵選單在剩 1 頁時禁用「刪除圖紙」選項。
    3. **Q5 Option A（跨頁搬移視圖無孤兒參考）**：模型層實作 `moveViewToPage` 指令，將所選視圖身上的尺寸（`dimensions`）、註記（`annotations`）、表格（`tables`）、表面符號（`surfaceFinishes`）隨同移轉至目標頁面，原頁面徹底清除，杜絕懸空/孤兒參考崩潰；右鍵選單提供「移動至圖紙」子選單；Viewport 拖放視圖至分頁頁籤放開直接跨頁轉移並切換至該頁。
    4. **Q6 Option A（單一多頁 PDF 匯出）**：升級 `packages/drawing/src/pdf.ts` 之 `toPdf(sceneOrScenes, options)`，重構 Catalog/Pages 樹結構（`/Kids`, `/Count`），逐頁配置獨立的 `MediaBox` 與 `/Contents`，跨頁共用 Type 1/CID 內嵌字型及 XObject 圖像資源。
    5. **Q7 Option A（逐頁圖紙屬性獨立設定）**：`DrawingPanel`、`DimensionPanel`、`AnnotationPanel`、`DrawingViewport` 全面對齊當前活動頁面（`curPage = page(drw.doc, activePageIndex)`），圖紙大小、方向、比例、投影視角、單位、標題欄與標註樣式開放逐頁獨立設定。
    6. **狀態層全域預算快取 (`state/drawing.ts`)**：`activePageIndex` 集中管理；`loadSources`、`computeLines`、`computeDimensionData`、`refreshBoms` 遍歷所有圖紙視圖（`allViews`）進行預算快取，切換圖紙零延遲；`scene(pageIndex)` 隔離單頁渲染；`exportPdf` 匯出全圖紙單一多頁 PDF。
  - **確效與測試**：
    - 新增 `tests/phase5/drawing-pages-multisheet.test.ts`（4 項全過，涵蓋逐頁設定、防刪最後一頁拋錯、無孤兒跨頁轉移、多頁 PDF 真實結構與 MediaBox 解析驗證）。
    - `npm run typecheck`：**0 錯誤**。
    - `npm run lint:rules; npm run lint:deps; npm run lint:i18n`：**全數通過**。
    - `npx vitest run tests/phase5/`：**49 個測試檔案、523 項測試全數通過（0 失敗，1 略過）**。
  - **停在哪裡**：工作目錄乾淨（working tree clean），無做到一半的程式；`main` 分支在 `756b7ae` 已推送到遠端倉庫。下一棒可依藍圖或後續需求繼續進行。

- **【2026-10-18：E1 側邊欄收尾——補上瀏覽器驗證，並落地 §2.2 選取切換（E1-P3，[ADR 0155](docs/adr/0155-sidebar-tabs-hidden-contract.md)）— 已合併進 `main`（`8ade9ee`，見本檔最上方條目）】** 使用者指示「把 verify:ui 跑起來補上瀏覽器驗證，並開始動 §2.2 的選取切換」。在 worktree `D:\Self-developed_Apps\G3\3DB-sidebar-parity`（分支 `worktree-sidebar-parity`）完成。背景：E1-P1（`4ba2765`）與 E1-P2（`6831a44`、`db7432b`）已併入 `main`（`0e8ba1c`）；本次是「補驗證＋§2.2（零件範圍）」。
  - **verify:ui（補上 E1 的瀏覽器驗證）**：全量 **143 支腳本 → 118 過／25 敗**。新增 `tests/e2e/manual-sidebar-tabs.js`（**10 步全過、0 Console 錯誤**）：兩分頁存在與 aria 狀態、切換只隱藏不卸載（隱藏窗格內 `data-field` 仍可達）、工作階段自動進屬性頁且 FeatureManager 仍可點、✓ 提交後回樹頁、**圖面點面→自動進屬性頁**（名稱／所屬特徵／實測面積／中心，全部讀自畫面與 store）、✓ 清除→回樹頁、樹內點選留在樹頁、特徵屬性頁＋「編輯特徵」進入工作階段、Ctrl 多選兩邊逐邊長度、組合件兩分頁與搜尋列過濾。
  - **§2.2 選取驅動切換（零件，已完成並驗證）**：點圖面（面／邊／頂點）→ 側邊欄自動切到 PropertyManager，顯示標題列（圖示＋種類＋名稱＋✓）與兩個可收合群組框（識別／量測）；無選取時回樹頁；`✓` 清除選取回樹頁；樹內點選留在樹頁。新檔：`apps/web/src/state/selectionFacts.ts`（純邏輯：選取互斥、`pickKey`、同名以指紋消歧——不能分辨回 null 不猜、`measureTargetsOf`）、`SelectionPanel.tsx`、`PMGroup.tsx`（自 DrawingPanel 抽出，兩邊共用）、`tests/phase8/selection-facts.test.ts` 9 項。改動：`store.ts`（`selectionFacts` 狀態，`api.measure` 量開放中零件的**真實**資料，`selectionFactsSeq` 丟棄過期回答）、`App.tsx`（切換 effect 與分頁啟用條件）、`MeasurePanel.tsx`（匯出 `writer`/`typeName` 供共用）、`DrawingPanel.tsx`、i18n `sel.*` 14 鍵（zh-TW／en）。檔案格式與 Schema 不動。
  - **驗收**：typecheck **0**；`lint:rules`／`lint:deps`／`lint:i18n` 全過；全量 vitest **237 檔 2993 過／0 敗（425s）**；`verify:ui --only manual-sidebar-tabs` **10/10**。
  - **全量 verify:ui 的 25 個失敗是既有的（B2.8 遺留，非本次造成）**：逐支根因——① **B2.8 多圖頁（`432bb1f`，10-17）把 `DrawingDoc` 改為 `pages[]` 後讀不到頂層 `views` 的共 23 支**（11 支 `manual-drawing-*`、10 支 `phase5-*` 於 step 0 即 `Cannot read properties of undefined (reading 'length')`；`manual-measure-view:325` 讀 `drw.doc.views.length`；`phase4b-surface:44` 讀 `drw.doc.views.find`）；② `phase3-select-elements` 呼叫已不存在的 `store.setPickFilter`（現名 `setPickFilterKind`）；③ `manual-asm-view-normal` 為視角方塊的過時斷言。單獨重跑一樣失敗（不是批次干擾），typecheck 0，根因逐檔比對確認；`manual-sidebar-tabs` 在同一全量批次 **PASS（7.7 s）** 為直接證據。**後續**：B2.8 shape 2 把這 23 支改成 `page(drw().doc).views`（決策單已由使用者回覆並提交 `8cb1f2b` `docs/decisions-e1p2-b28-shape2.html`）後重跑全量。
  - **已知限制**：① §2.2 本次只到**零件**——組合件點選（`asm.selected`）仍啟用不了屬性頁（依計畫 §8「先零件再做組合件」），6 個模式面板維持浮動。② 特徵屬性頁只顯示識別（名稱／類型／狀態）＋編輯入口，**未**把 40 多種特徵的參數收進群組框（要動 3262 行的 `PropertyManager.tsx`，另案評估）。③ 元件不存在（同名不能分辨）時明說「找不到元素」，不顯示別顆面的資料。
  - **環境坑（沿用並證實）**：本機 5391 上的 dev server 根目錄是**主倉庫** `D:\Self-developed_Apps\G3\3D-Builder`（別的工作階段留的），驗本 worktree 必須自起（本次用 5395＋`VERIFY_UI_ORIGIN`，debug/samples 埠 9415/5415）；自起 server 觸發 Vite dep 再最佳化時，清 `node_modules/.vite/deps_temp_*`（61 檔）會被環境的 safe-delete 守衛攔截並 crash server——解法是先用 Bash `rm -rf` 清掉殘留 temp 再冷啟動。
  - **停在哪裡**：已提交並推送（經使用者許可）：`d2b5547`（E1-P3）→ `b5b4068`（合併 `origin/main`：程式碼全自動合併，DEV_LOG／handoff 採雙方條目並記、B1 條目頭自 base 恢復）→ `0d635b5`（help 修補，見 DEV_LOG §5）。**合併後確效（使用者裁定「先併入本分支驗證再推」的執行結果）**：typecheck 0、三 lint 過；全量 vitest **242 檔 3033 過、0 敗**；全量 `verify:ui` **117/143**——26 支失敗＝上述 25 支既有缺口＋`manual-e1` 的批次載入 flake（同碼單跑 10.4s 過、小批次 3/3 過，與 10-12 記過的批次敏感性同型）；`manual-sidebar-tabs` 在全量批次 **PASS（8.8s）**，§2.2 在 main 最新碼上成立。下一步：主倉庫快轉 main 或開 PR（使用者決定時機）、B2.8 shape 2 的 23 支工程圖 e2e 遷移（**main 與本分支共同待辦**——`756b7ae` 只遷了產品碼與單測）、組合件 §2.2、特徵參數群組框（另案）。


- **【2026-10-15 夜：桌面版安裝檔重建、整合 F: 的檔案（Claude）】**
  - **重建**：以 `main` 的 `10249a5`（含 F: 全部提交）執行 `npm run build -w @3db/desktop`，更新 `apps/desktop/src-tauri/target/release/desktop.exe`（13,885,952 位元組）與 `bundle/nsis/3D-Builder_0.2.2_x64-setup.exe`（11,965,187 位元組）；版本號維持 0.2.2，舊的 0.2.0、0.2.1 安裝檔未動。新版網頁打包的雜湊檔名（`index-C2ELDDv0.js` 等七個）都確實嵌在 exe 裡；啟動後 10 秒仍存活、視窗標題 `3D-Builder`。這兩個檔案被 git 忽略（`target/`），不在版本庫裡。
  - **整合 F:**：F: 的 git 內容早已全部在這邊的 `main`（`laptop/main` 是它的祖先，F: 的所有分支都沒有這邊沒有的提交，F: 工作樹乾淨）。F: 獨有、被 git 忽略的檔案已複製過來，沒有覆蓋任何既有檔案：`3DB實機確認/`（53 個）、`scratch/`（116 個，其中 `drawing-parts/凸緣襯套.3dbx` 以 F: 較新的版本為準）、`.workbuddy-ai/memory/`、`dev.log`。F: 本身沒有動，仍停在 `d19b9af`，落後 3 個提交，且它的 `desktop.exe` 與安裝檔仍是 10-11 的舊版；要同步請在 F: 執行 `git pull origin main`，並重建或複製這邊的安裝檔。

- **【2026-10-15 晚六：使用者以第二份選擇題裁定八項工程圖細節（Claude）— 只記錄決定，程式尚未動】** 選擇題頁：https://claude.ai/artifact/LSQnMc5vqjga3xgNo6dUMt。每週額度已用 98%（2026-10-19 重置），所以只寫下決定，沒有開始實作。全部採我的建議。
  - **局部剖視（D-I5，先做）**：
    1. 範圍形狀：**矩形、圓、多邊形**（不做自由曲線）。
    2. 深度：**先做輸入數值**，點孔中心或邊的深度**之後再加**（不要推翻第一步的資料結構：深度欄位要能之後接受一個參照）。
    - 需要新的視圖種類（或剖面的一種）與工程圖 Schema 升版（目前 19）；做法參考 [ADR 0143](docs/adr/0143-drawing-stepped-aligned-section.md)。紅隊重點：範圍必須是封閉、不自相交的圖形；深度不合理（零、負、超出零件）明確拋錯，不默默修正；局部剖視不能自己當父視圖以外的來源。
  - **小功能（D-I8）**：
    3. 相切邊：**新視圖預設不畫**，視圖屬性裡可以打開（現有圖完全不變；新增視圖欄位，缺省＝不畫）。**→ 2026-10-19 使用者裁定修訂：改為預設繪製（`showTangentEdges: false` 才不畫），以滿足「現有圖完全不變」；見文末 〈2026-10-17〉 日誌。**
    4. 鎖定視圖：**鎖位置與比例**；尺寸與註記照常可編輯；拖動或改比例被擋時要說明「這個視圖已鎖定」。
    5. 隱藏個別的邊：**只在選的那個視圖**；以邊的持久名稱記錄，零件改了只要邊還在就仍然藏著；要有取消隱藏的清單。
  - **尺寸**：
    6. 右鍵選單：**只做公差子選單**（捷徑，不改檔案格式）；「反轉箭頭」先不做。
    7. 自動排列：**把座標尺寸也排進去**（同一側和線性尺寸往外排，不互蓋），其他種類維持現狀。
  - **小項目（四項要做）**：組合件選整個零組件按「正視於」看向它的前基準面；工程圖頂端頁籤加「工具」頁籤（選項、快速鍵）；孔表與零件表有自己的右鍵選單；剖面「依數值」新增時加角度欄位。**不做**：塗彩讀零件外觀顏色、從工程圖開子組合件再開零件時一路返回到工程圖。
  - **建議順序**：(1) 局部剖視；(2) 鎖定視圖、隱藏個別的邊、相切邊顯示；(3) 尺寸：公差子選單、自動排列含座標尺寸；(4) 四個小項目；(5) 輔助、斷裂、裁剪視圖；(6) D-I6 多圖頁。
  - **停在哪裡**：`main` 在 `b0367cb` 之後只有這一段文件變更；沒有做到一半的程式。

- **【2026-10-15 晚五：使用者以選擇題裁定六項待決事項；「正視於」改轉到最近的標準視角、視角方塊加翻面鈕（Claude，[ADR 0149](docs/adr/0149-view-normal-nearest-and-cube-flip.md)）】** 選擇題頁：https://claude.ai/artifact/VN3DNuNfpVuQu2Vdc4DMMx。
  - **使用者的裁定**（全部採我的建議）：
    1. 工程圖剖面與視圖：**局部剖視先**，再輔助、斷裂、裁剪視圖（尚未做）。
    2. 小功能：**鎖定視圖、隱藏個別的邊、相切邊顯示**（旋轉視圖延後；尚未做）。
    3. 視角方塊：首頁與翻面（首頁鈕早就有，只補翻面；已完成）。
    4. 「正視於」：沒有選取時轉到最近的標準視角，再按翻面（已完成）。
    5. 草圖吸附：平面外的邊**手動轉換**（工具已存在，不做自動投影）。
    6. 客戶零件檔在 git 歷史：**保留，不改寫**。
  - **完成**：`nearestView`（純函數）、`Viewer.nearestPrincipalView()`、`lookAtNormal` 沒有平面時轉到最近標準視角（正對時翻另一側；等角平手取前視）；視角方塊右下角 ⇄ 翻面鈕（180°，正好相反的一側）；說明文字中、英更新。
  - **順手修正**：`manual-c20.js` 窄視窗步驟在 pull 進來的 `main` 上就是紅的（heads-up 工具列隨指令變多已長到 124 px，方塊寫死 `top: 100px` 蓋在上面）。改由 `ResizeObserver` 量工具列實際底部；斷言從寫死的 `top === 100` 改為「在工具列下面且沒被蓋住」，沒有被蓋住（`covered === 0`）的斷言未放寬。
  - **驗證**：單元 phase8 651 過（新增 `nearestView` 與翻面共 6 項）；`verify:ui` c20、c21、c22、asm-view-normal 6/6；把 9b、13c 預期改錯時兩步都判定失敗；help 測試過。全量 vitest **2870 過、25 略過、0 失敗**。
  - **更正**：選擇題頁上我寫「目前看不到首頁鈕」是錯的，⌂ 一直在方塊左下角。
  - **下一步**：(1) 局部剖視（D-I5）；(2) D-I8：鎖定視圖、隱藏個別的邊、相切邊顯示；(3) 輔助、斷裂、裁剪視圖；(4) D-I6 多圖頁。
  - **使用額度規則**：額度（工作階段／每週／整體）到 99% 時要更新本檔（使用者 2026-10-15 指示，原為 97.5%）。
  - **停在哪裡**：每週額度已用 98%（2026-10-19 重置），所以下一步（局部剖視、D-I8 三項小功能）**都還沒開始，沒有做到一半的東西**；`main` 的 `81b13f4` 已推送，工作樹乾淨。局部剖視要新增視圖種類與工程圖 Schema 版本（目前 19），先看 [ADR 0143](docs/adr/0143-drawing-stepped-aligned-section.md) 的剖面做法與 `packages/model/src/drawing.ts` 的視圖種類。

- **【2026-10-15 晚四：組合件的「正視於」與選擇濾器（Claude，[ADR 0148](docs/adr/0148-assembly-view-normal-and-filter.md)）— 見 `git log`】** 使用者回報組合件無法用「正視於」，濾器亦同。原因：兩者都限定零件（`partIdle`、濾器列與 F5／F6 限零件），且組合件挑元素的 `Viewer.pickElement` 根本沒讀濾器。
  - **完成**：`AssemblyStore.normalFrame()`（結合中取第二個、否則第一個元素；否則樹上最後挑的基準；平面→正對，其餘→等角視圖；元件平面已套姿態）；組合件顯示濾器列、F5／F6 可用；`pickElement` 依濾器略過頂點／邊線／面，改變時清懸停；說明文字更正；ADR 0145 的「組合件無此列」加註修訂。
  - **驗收**：單元 6 項、新 e2e `manual-asm-view-normal.js` 9 步（還原原始碼時步驟 1～3 失敗）；typecheck 0、三項 lint 過；全量 vitest **2865 過、25 略過、0 失敗**；相關 e2e（asm／assembly／c21／c22／sketch-plane／mate／measure）**16/16**。
  - **已知限制**：組合件沒有「濾掉的面變半透明、邊線變淡」的視覺提示（行為已生效）；選整個零組件按「正視於」回等角視圖（SW 會看向其前基準面）。
  - **環境**：直接在主資料夾工作（worktree 已清理），只提交自己的檔案。

- **【2026-10-15 晚三：新工程圖在「最適比例」前存檔（Claude，[ADR 0147](docs/adr/0147-drawing-fit-before-save.md)）— 已提交並推送 `b966d26`（origin/main）】** ADR 0146 確效時發現的既有行為：存檔後最適比例才發生，工程圖變成未存檔、開零件被「要儲存變更嗎？」擋住。使用者以選擇題裁定「等候＋併入同一步」（建議選項）。
  - **完成**：`History.amend`（併入最後一步；無步驟時成為起始狀態）；自動最適比例改用它，使用者按的「最適比例」仍是一步；存檔對話框照常立即開，寫入前 `fitSettled()`——等到最適比例發生，或沒有任何零件讀取、線條、特徵請求在進行（不用逾時，核心失敗不會卡住）。移除 ADR 0146 在 `manual-drawing-open-part.js`、`manual-drawing-sw-parity.js` 加的「存檔前等 features」。
  - **驗收**：新 `drawing-fit-save.test.ts` 11 項、新 e2e `manual-drawing-save-before-fit.js` 5 步（攔住核心的特徵回覆，確定重現慢核心）；還原修正時單元 4 項、e2e 4 步失敗。typecheck 0、三項 lint 過；全量 vitest **2856 過、25 略過、0 失敗**；`verify:ui --only "drawing|section|phase5"` **20/20**。
  - **工作環境**：在 worktree `.claude/worktrees/drawing-autoscale-save`（分支 `worktree-drawing-autoscale-save`，自 `origin/main` `ebb3e3a`）完成，推送為 `HEAD:main`。主資料夾的本地 `main` 仍在 `482a816`，落後 origin/main 3 個提交（`159b1bd`、`ebb3e3a`、`b966d26`），本工作階段未動它（別的工作階段可能在用）。
  - **工具**：`verify-ui.mjs` 現在依 `VERIFY_UI_ORIGIN` 的埠啟動開發伺服器（`scripts/verify-ui-args.mjs` 的 `devServerArgs`，預設 5391 不變；沒有埠或非 http(s) 的 origin 直接報錯；`tests/phase5/verify-ui-args.test.ts` 3 項；實跑：5481 沒有預先開伺服器，腳本自己啟動並在結束後關掉）。注意回報只列前三個失敗步驟（`bad.slice(0, 3)`），反向對照時要看完整結果。
  - **已知限制（使用者 10-15 裁定維持現況）**：最適比例到來前使用者若又做了別的改動（例如拖動視圖），最適比例併入**那一步**而非放視圖那一步；核心失敗時存檔寫入未置中的版面，之後重算成功仍會最適比例並變成未存檔（版面確實變了，提示正確）；等候期間無額外進度提示。
  - **待裁事項**：無（四項皆已由使用者裁定：清理 worktree、主資料夾快轉、併入維持現況、verify-ui 自動啟動——後三者已執行）。
- **【2026-10-15 晚二：選擇濾器比照 SolidWorks 工具列（Claude，[ADR 0145](docs/adr/0145-selection-filter-sw-toolbar.md)）— 見 `git log`】** 使用者要求「把專案的工具列交互設計比照 SW」，批准方案後動工；修訂 ADR 0043 決定 2 的**呈現**，語意核心（只縮小不放大）不變。
  - **完成**：濾器列預設隱藏（`SystemOptions.pickFilterBar` 記住），F5 顯示／隱藏、F6 清除（皆走 D3.3 registry，view 群、part 限定、可重綁）；面／邊線／頂點／基準面改**單選**（再點已選者不取消，比照 SW 按鈕保持按下）；列首 ✕（＝F5）與「清除」（＝F6）比照 SW 工具列；「開始時可以點選的元素」改 radio（全部＋四種），新增「顯示選擇濾器列」勾選。傳輸結構不變：`pickFilter` 四布林，viewer 協議與 picking() 交集未動；舊混合種子值保留，第一次點選收斂單選。
  - **驗收**：options.test 9/9；help 40/40；help-manual 同步；typecheck 0、三項 lint 過；全量 vitest **2814 過、25 略、0 失敗**；`verify:ui` **5/5**（manual-c21 步 2 重寫、manual-c22 optionOff／startedOff 改種「邊線」、manual-sketch-plane 步 11 用 radio 證雙向閘門）。全量 `verify:ui` 未跑（組合件、工程圖未改動）。
  - **工具**：`verify-ui.mjs` 的 9333／5393 改為 `VERIFY_UI_DEBUG_PORT`／`VERIFY_UI_SAMPLES_PORT` 環境可覆蓋（預設不變），樣本 URL 以 `window.__samplesOrigin` 注入——**兩個工作階段現在可以同時跑 verify:ui**（取代前一段「寫死不能同時跑」的警告）。
  - **已知差異**：輸入框聚焦時 F5＝瀏覽器重新整理；舊混合種子值過渡顯示（列上無按下的種類，第一次點選收斂）。
- **【2026-10-15 晚二：工程圖六項與 SolidWorks 對齊（Claude，[ADR 0146](docs/adr/0146-drawing-sw-parity-six.md)，工程圖 Schema 19）— 已提交並推送（見 `git log`）】** 使用者在「零件1」工程圖回報六項，驗收標準與四個設計選擇經使用者確認（全採建議）。在 worktree `D:\Self-developed_Apps\G3\3DB-drawing-fixes`（分支 `drawing-fixes`，rebase 到 `origin/main` `482a816`）完成。
  - **完成**：①設計樹最上方常駐「開啟零件：<檔名>」，檔案與視圖配置選單也有；②視圖顯示樣式五種（線架構／隱藏線可見／移除隱藏線／帶邊線塗彩／塗彩），塗彩以深度緩衝光柵化，螢幕、SVG、PDF 都有，DXF 只有線；新等角視圖預設帶邊線塗彩；③投影與剖面視圖右鍵「解除對齊」「預設對齊」；④⑤圖面尺寸樣式與單一尺寸覆寫（字高、箭頭長、實心／空心／斜線／圓點／無、線寬），超出範圍拒絕；⑥往斜角拖出的是該角的等角投影（第一／第三角法分開），跟著母視圖轉。Schema 18→19（`hidden` 遷移為 `display`）。
  - **驗收**：typecheck 0、三項 lint 過；全量 vitest **2845 過、25 略過、0 失敗**；`verify:ui --only "drawing|section|phase5"` **19/19**（新 `manual-drawing-sw-parity.js` 14 步）；兩個突變各自讓單元與 e2e 失敗。全量 `verify:ui` 未跑。
  - **記憶體**：塗彩一張視圖比不塗彩多約 0.015 MiB Heap（全新 Heap 各 2000 次隔離量測）；不宣稱 0。並更正 AGENTS.md §3.5「`projectView` 單獨 0」為被餘裕吸收（實測 2000 次 +25.6 MiB）。
  - **事故（已處理，請知悉）**：本工作階段曾以相對路徑誤寫主資料夾 5 檔（14:0x），已還原；但主資料夾的另一工作階段在那之間提交推送了其中 4 檔（`4309412`，kernel `mesh?` 參數＋三個測試），又以 `c2d7cd0` 撤回測試部分。本提交包含完整版本，無衝突。AGENTS.md §4 已加「worktree 中 .NET 檔案 API 一律絕對路徑」。
  - **ADR 編號**：主資料夾另有未提交的 `0145-selection-filter-sw-toolbar.md`（別的工作階段），本項用 0146。
  - **測試修正**：`manual-drawing-menus.js` 第 6 步改用顯示樣式；`manual-drawing-open-part.js` 存檔前等視圖特徵——它在 origin/main 上與其他腳本同批跑就會失敗（新工程圖的「最適比例」在存檔後才發生，工程圖又變成未存檔）。
  - **後續**：~~新工程圖剛建好就存檔，之後被自動「最適比例」改成未存檔~~（已由 [ADR 0147](docs/adr/0147-drawing-fit-before-save.md) 修正）；塗彩顏色固定不讀零件外觀；尺寸樣式不含註解／公差框／表格；`D:\Self-developed_Apps\G3\3DB-baseline`、`3DB-drawing-fixes` 兩個 worktree（10-15 晚三確認：兩個路徑都已不存在，`git worktree list` 也沒有，已清理）。

- **【2026-10-15 晚：組合件設計樹展開零件——零件自己的原點、基準面與特徵，拿來做結合（Claude，[ADR 0144](docs/adr/0144-assembly-component-datums-in-tree.md)，檔案格式不變）— 已提交並推送（見 `git log`）】** 使用者截圖回報「零件下沒有可展開的基準面」。Qoder 在 `docs/decisions-2026-10-14b.html` 列為 A1／A2，**之前沒有任何實作**；本次照兩題的建議選項做（頂層零件；座標系統只列出不結合）。在乾淨的 worktree（`origin/main` `718a57a`）完成。
  - **完成**：零件列有 ▸，展開＝原點、前／上／右基準面、零件特徵（參考基準面可選，其餘唯讀；失敗標紅、抑制變淡）；樹上點選（Ctrl 加選）的基準面與原點畫在圖面；按「結合」時帶入前兩個並建議類型；組合件自己的原點也可選；Esc 清空；展開狀態在結合面板關掉後仍在。命令層拒絕不合法的結合參考（`body`、未知種類、`plane:back`）。Worker 的零件資料多了特徵清單。
  - **原本就有、這次沒動**：求解器與模型參考本來就支援零件基準面；結合時圖面左上的浮出樹仍可用（次組合件內部零件的基準面請從那裡選）。
  - **驗收**：`tests/phase2/component-datums.test.ts` 13/13（定位板偏離原點且轉過、銷傾斜開始，重合／平行／垂直／距離／原點／參考基準面／三面完全定義，全部以求解後姿態量測）；`manual-asm-component-datums.js` PASS；兩個反向對照（拿掉命令檢查、拿掉預選帶入）各自失敗；typecheck 0、三項 lint 過；全量 vitest **2813 過、24 略過、0 失敗**；組合件相關 `verify:ui`（`--only "asm|manual-d\d|manual-e\d|h9|section-drag|measure|phase2|bom|component-pattern|explode|form-sub|interference|physical|clearance|derived|dowel|phase4-mates|phase5-assembly|library"`）**32/32**，Console 0 錯誤；全量 `verify:ui` 未跑（零件模式、工程圖未改動）。
  - **已知限制**：次組合件內部零件不從主樹展開；座標系統不能結合；圖面上畫出的基準面不能在圖面點選；唯讀特徵沒有右鍵選單。
  - **注意**：本機 5391 常被別的工作階段的 dev server 佔用，另一個 worktree 驗證時要自己開 port（例：`npx vite --port 5491`）並設 `VERIFY_UI_ORIGIN`；`verify-ui.mjs` 的 9333、5393 是寫死的，兩個工作階段不能同時跑。

- **【2026-10-15 下午：D-I5 第一部分之二——階梯剖面與對正剖面（Claude，[ADR 0143](docs/adr/0143-drawing-stepped-aligned-section.md)，工程圖 Schema 18）— 已提交並推送（見 `git log`）】** 同一個 D-I5 worktree，沿用第一部分的驗收標準。
  - **完成**：剖面線可為折線（階梯：剖切段同向平行、轉折段垂直、首尾為剖切）或三點對正（`aligned`）；核心 `Kernel.sectionViewPath`（區域稜柱切割、對正的角平分切開＋繞轉折軸旋轉、只填剖切面、不畫轉折線）；剖面工具「階梯剖面」「對正剖面」（點選、折線預覽、最後一點再點一下或 Enter 完成）；母視圖上畫整條折線、兩端箭頭各自垂直；拖曳整條平移；Schema 17→18。
  - **驗收**：含兩孔方塊——階梯 336（直線會是 408）、對正 (14＋20√2−6)×12、隨機階梯／對正各 100 組，全數 < 1e-3；三個突變各自讓測試失敗；typecheck 0、三項 lint 過；全量 vitest **2800 過、24 略過、0 失敗**；`verify:ui` 工程圖／剖面 **9/9**（新 `manual-drawing-stepped-section.js` 6/6）。全量 `verify:ui` 未跑。
  - **重要發現（記憶體）**：OCCT 布林每次呼叫都佔用 Emscripten Heap——裸 `BRepAlgoAPI_Cut` 約 0.14 MiB、**既有的直線剖面約 0.25 MiB**、階梯約 0.42、對正約 1.0；前 100 次會被 Heap 餘裕吸收成 0，要量到上千次才看得到。已寫入 AGENTS.md §3.5（並指出該節「兩顆圓柱 Common 0.000 MiB」是 100 次量測，可能同樣被吸收）。產品側仍靠 ADR 0126 的 worker 高水位重啟。**沒有**為此寫「Heap 不成長」的測試（會是假綠燈）；改以 `liveShapes` 驗證本專案自己的釋放。
  - **已知限制**：轉折線剔除可能誤刪恰好重合的真實邊；對正剖面在切面外框外可能看到角平分切開的線；斜線與折線不吸附孔中心；側邊欄「依數值」只有水平／垂直。
  - **下一步**：依 ADR 0129，D-I5 剩相切邊、輔助視圖、斷裂視圖，再來 D-I8、D-I6。
- **【2026-10-15：D-I5 第一部分——任意角度的剖面線（Claude，[ADR 0142](docs/adr/0142-drawing-slanted-section.md)，工程圖 Schema 17）— 已提交並推送（見 `git log`）】** 使用者確認驗收標準後開工，在乾淨的 worktree（`origin/main` `ff4f8ae`）完成。
  - **完成**：剖面線可為任意角度（`sectionLookAxes`、`sectionDirection`；軸向線行為不變）；剖面工具第三個選項「斜向剖面線」（拖曳或點兩下，線延伸穿過整個視圖）；斜方向的放置預覽（向 worker 要投影並快取）；剖面線沒切到零件時，視圖問題顯示「沒有切到零件」，核心不再丟 `Bnd_Box is void`；Schema 16→17 讓舊程式拒開。
  - **驗收**：OCCT 實切面積 vs 解析值（對角線、30°、100 條隨機斜線）< 1e-3；反向對照（改回舊平面 3 項失敗）；typecheck 0、三項 lint 過；全量 vitest **2782 過、24 略過、0 失敗**；`verify:ui` 工程圖／剖面 8/8（新 `manual-drawing-slanted-section.js` 5/5）。全量 `verify:ui` 未跑。
  - **階梯剖面、對正剖面**：已於同日下午完成（見上一段，ADR 0143）。另外：斜線不吸附孔中心、側邊欄「依數值」新增剖面沒有角度欄位、拖曳既有斜線是沿 x／y 平移。
  - **這台的主檢出**：本機 `main` 仍是 `d650c05`（與遠端 `ff4f8ae` 同內容的重複提交）且落後遠端，另有主題重構工作階段的未提交檔；同步前請先處理那批檔案（不要 `reset --hard`）。
- **【2026-10-15：C3 角落點到模型邊不再轉成草圖線（Claude）— 已提交並推送 `d650c05`（rebase 到遠端之後為新的 hash，見 `git log`）】** 使用者裁定「改成不轉」。`packages/sketch/src/ops.ts` `anchorModel`：點到的模型邊一律成為建構線（原本只有平面外的投影邊是建構線），不進輪廓，伸長填料不再以「分支點」拒絕。`snap-model.test.ts` 同一斷言改寫（平面內的邊也要 `construction: true`）；`manual-c13.js` 第一角拿掉 Ctrl，**PASS 28.9s**；手冊 C13 與覆蓋表已改。`typecheck`、`lint:deps`、`lint:rules` 過；全量 vitest（改動前）**2744 過、24 略過、0 失敗**。注意：點到的板邊若原本是要當輪廓用，現在要自己「轉換實體引用」。
- 最後更新：2026-10-15 晚二（**選擇濾器比照 SolidWorks 工具列：預設隱藏、F5／F6、單選（[ADR 0145](docs/adr/0145-selection-filter-sw-toolbar.md)）；verify-ui.mjs 埠號可環境覆蓋**）；2026-10-15 晚（**組合件設計樹展開零件：零件的原點、基準面與特徵可選、可拿來結合（[ADR 0144](docs/adr/0144-assembly-component-datums-in-tree.md)）**）；2026-10-15（**D-I1b 完成：工程圖的 CommandManager 頁籤、右鍵選單、特徵樹的尺寸與註記資料夾（[ADR 0141](docs/adr/0141-drawing-commands-menus-tree.md)）；下一步 D-I5**）；2026-10-15（**D-I7(a) 完成：視圖右鍵「開啟零件」**）；2026-10-15（**D-I4 完成：座標尺寸、尺寸對正與自動排列，Schema 16**）；2026-10-15（**D-I2 全部完成：註記附著到模型，Schema 15**）；2026-10-15（**D-I2 第二部分（二）：組合件視圖可標尺寸，Schema 14**）；2026-10-15（**D-I2 第二部分（一）：細部放大圖點選、垂直距離、圓柱輪廓線，Schema 13，見下一段**）；2026-10-14 晚三（**D-I2 第一部分：頂點、邊、等角視圖可標尺寸（[ADR 0138](docs/adr/0138-drawing-named-view-edges.md)），rebase 到遠端 26 個提交之後推送，見下一段**）；2026-10-14 晚二（**10-14b 決策頁執行：B1 方塊首頁鈕、B2「正視於」全套比照 SW（正對／再按翻面／無選取回等角視）、C2① 爆炸後「全部顯示」、C3 c13 階梯板＋肋邊圓角（發現「角落點到模型邊會整條轉成草圖」待裁）、C1 手冊 11 處、D2 刪 vui.txt；vitest 2744 過；已推送 `fa807bb`；A 組歸 Claude Code 工作階段；見最上方**）；2026-10-14 晚（**B1 根因＝「重建不是文件的純函式」，違反藍圖 B3.1（P0）：求解器參數排序依記憶體位址、OCCT 對重合面的合併不決定；修法＝求解輸出十進位網格＋每次重建全新求解器＋布林結果面來源繼承（[ADR 0137](docs/adr/0137-deterministic-rebuilds.md)）；vitest 2743 過、B1 實檔測試 2/2、全量 verify:ui **131/131**；已推送 `acfc99e`**）；2026-10-14（**螺牙改從牙型前緣起算 `5872480`；「關閉伺服器」按鈕（ADR 0135）`817fdf2`；皆已推送，見下兩段**）；2026-10-14（**鍵盤視角比照 SolidWorks（方向鍵、Shift／Alt／Ctrl、Z、Ctrl+Shift+Z、空白鍵「視角方位」）與後／左／下視，已 rebase 到遠端工程圖工作之後並推送，見下一段**）；2026-10-14（**新工程圖改為先選主視圖、尺寸按需標註（ADR 0134）；`drawing-interaction` 已合併進 `main`、其他分支已刪除，見下兩段**）；2026-10-13（**工程圖交互比照 SolidWorks：差距分析與使用者決定、D-I1a 多重選取、D-V 在圖紙上產生視圖和剖面、D-I3 註記（Schema 12）、側邊欄，分支 `drawing-interaction` 已推送，見下一段**）；2026-10-12 晚（**筆電工作整合、C19、Schema 55、尺寸標籤即時拖曳，已推送 `a96321f`，見下一段**；**【線架構剖面交線與 SolidWorks 級動態側影輪廓線 (Silhouette Edges) 全套落實驗收完畢】**；**【Codex 任務接棒指南：裝飾用公螺牙與母螺孔 (Cosmetic Threads, C4.9 / ADR 0129) 架構與落地 SOP】**；全套 TypeCheck 0 錯誤、Lint 規則全綠、`acceptance.test.ts` 通過；其他狀態見「最新存檔點」）。；2026-10-13 下午（**草圖磁吸對照 SW／FreeCAD 補齊 4 項、零件 Schema 56；全量測試平行負載失敗修正（CPU 計時、`maxWorkers: 4`）；見下一段；已推送 `8a9d2a1`**；早上：**10-12 成果審查與修正：`verify:ui` 129/129、vitest 2629 過，已推送 `335b46c`**；以下為 10-12 晚的狀態：**筆電工作整合、C19、Schema 55、尺寸標籤即時拖曳，已推送 `a96321f`**；**【線架構剖面交線與 SolidWorks 級動態側影輪廓線 (Silhouette Edges) 全套落實驗收完畢】**；**【Codex 任務接棒指南：裝飾用公螺牙與母螺孔 (Cosmetic Threads, C4.9 / ADR 0129) 架構與落地 SOP】**；全套 TypeCheck 0 錯誤、Lint 規則全綠、`acceptance.test.ts` 通過；其他狀態見「最新存檔點」）。

- **【2026-10-15：D-I1b — 工程圖的頁籤、右鍵選單、特徵樹（Claude）— 已提交並推送到 `main`】**（[ADR 0141](docs/adr/0141-drawing-commands-menus-tree.md)，純介面）
  - **頂端頁籤**：
    - 開著工程圖時，CommandManager 換成「視圖配置、註記、檔案」三個頁籤，不再顯示零件的頁籤。
    - 工具類的按鈕再按一次就關閉。「檔案」多了輸出 PDF、DXF、SVG。
    - 側邊欄的指令列已移除。
  - **右鍵選單**：
    - 圖紙上按到什麼，就打開什麼的選單：尺寸、註記、表面粗糙度、視圖或空白圖紙。
    - 按到已經選取的東西時，選取不變，指令作用在全部選取上；刪除是一步復原。
  - **特徵樹**：每個視圖下面有「尺寸（n）」和「註記（n）」兩個資料夾，預設收合。點一下選取，右鍵打開同樣的選單。
  - **驗證**：
    - 新的 `manual-drawing-menus.js` 8 步全部通過；把預期故意改錯時，腳本確實判定失敗。
    - 全量 `verify:ui` 133/133。
    - 全量 vitest 2775 過，包含說明測試：每個新指令都有說明。
  - **限制**：
    - 還沒有「反轉箭頭」和「公差」子選單。
    - 表格還沒有自己的選單。
    - 工程圖沒有「工具」頁籤。
  - **下一步（定案順序）**：
    1. D-I5 任意角度、階梯、對正剖面，以及輔助、斷裂、裁剪、局部剖視圖。
    2. D-I8 小功能。
    3. D-I6 多圖頁。
- **【2026-10-15：D-I7(a) — 從視圖開啟零件、返回後自動更新（Claude）— 已提交並推送到 `main`】**（[ADR 0140](docs/adr/0140-drawing-open-part.md)，檔案格式不變）
  - **右鍵選單**：
    - 在圖紙上，右鍵在原處放開，就打開游標下視圖的選單；右鍵拖曳仍然是平移。工程圖樹的視圖列也有同樣的選單。
    - 選單項目是「開啟零件」或「開啟組合件」。組合件視圖裡，游標下點得到零件的元素時，多一項「開啟這個零件」。
  - **開啟與返回**：
    - 和組合件共用同一套流程。工程圖有變更時，先問是否儲存。
    - 開啟後，特徵樹上方出現「返回工程圖」；返回時重新讀取工程圖，視圖會顯示零件存檔後的樣子。
    - 工程圖從沒存過檔時，照樣開啟零件，並說明沒有返回。
    - `returnTo` 改成 `{ name, kind }`。
  - **驗證**：
    - 新的 `manual-drawing-open-part.js` 8 步全部通過：板寬 120 → 150，返回後前視圖寬 150。反向檢查確認預期改錯時腳本會失敗。
    - `phase5-assembly.js` 新增組合件視圖的選單和葉節點對應檢查。
    - 工程圖與組合件相關的瀏覽器腳本 20/20；phase5 和 app 狀態相關的 vitest 348 過。
  - **限制**：「開啟這個零件」只驗證了葉節點對應正確，還沒有 e2e 實際點到零件元素再開啟。
  - **下一步（定案順序）**：
    1. D-I1b 剩下的部分：右鍵選單補齊（尺寸、註記、圖紙）；指令列移到頂端。
    2. D-I5 任意角度、階梯、對正剖面，以及輔助、斷裂、裁剪、局部剖視圖。
    3. D-I8 小功能。
    4. D-I6 多圖頁。
- **【2026-10-15：D-I4 — 座標尺寸、尺寸對正與自動排列（Claude）— 已提交並推送到 `main`】**（[ADR 0139](docs/adr/0139-drawing-ordinate-arrange.md)，**工程圖 Schema 15 → 16**）
  - **座標尺寸**：
    - 「尺寸」群組新增「座標尺寸」工具：先點原點，再點要量的元素，最後點一下圖紙空白處。游標在視圖上方或下方就是 x 方向，在旁邊就是 y 方向。
    - 文字太擠時，延伸線會折一下，讓文字相隔至少 1.5 倍字高。
    - 「從模型標註」新增「座標尺寸」選項：孔位改用 x、y 兩個座標尺寸，取代線性的位置尺寸和總尺寸。
  - **自動排列尺寸**：依跨距由短到長往外排；只改位置，不改數值；排第二次沒有變化。
  - **共線對正**：選取的尺寸套用第一個的位置。
  - **平行對正**：對選取的尺寸做自動排列。
  - 每一次排列或對正都是一步復原。
  - **驗證**：
    - `drawing-arrange.test.ts`：隨機打亂 100 次，排列後 0 交疊、數值不變。
    - `drawing-ordinate.test.ts`：黃金定位板的值和手算一致；100 組擠在一起的點都正確。
    - 瀏覽器實測：
      - 座標尺寸工具得到 `0 / 10 / 110`。
      - 自動標註的 y 方向得到 `0 / 10 / 40 / 70 / 80`，同原點的 x 方向不重複加入。
    - 全量 vitest 2775 過；工程圖瀏覽器腳本 17/17。
  - **已知限制**：自動排列目前只處理水平與垂直的線性尺寸。斜向尺寸、直徑和半徑尺寸，以及座標尺寸的排與排之間，都還不排列。
  - **下一步（定案順序）**：
    1. D-I7(a) 在視圖上右鍵開啟零件。
    2. D-I1b 剩下的部分：右鍵選單；指令列移到頂端。
    3. D-I5 任意角度、階梯、對正剖面，以及輔助、斷裂、裁剪、局部剖視圖。
    4. D-I8 小功能。
    5. D-I6 多圖頁。
- **【2026-10-15：D-I2 全部完成 — 第二部分（三）註記附著到模型（Claude）— 已提交並推送到 `main`】**（ADR 0138 第二部分三，**工程圖 Schema 14 → 15**）
  - **附著**：基準的三角形、註解和公差框的引線端點、中心符號線的圓心，可以附著到頂點、直線邊上的位置，或一個圓。零件改變時跟著移動；元素不見了就留在原位，並在面板標示。
  - **驗證**：
    - `drawing-attach.test.ts` 3 項：板寬 40 → 60 時，附著點從 20 → 30、從 (40, 30) → (60, 30)；孔拿掉後列為「已失去附著」。
    - 全量 vitest 2768 過；工程圖瀏覽器腳本 17/17。
  - **D-I2 的成果總覽**（ADR 0138）：
    - 可以標在頂點和邊上，等角視圖也行。
    - 細部放大圖可以點選。
    - 點到斜線、兩條平行斜線之間的垂直距離。
    - 圓柱側面輪廓線，單選就是 Ø。
    - 組合件視圖可以標尺寸。
    - 註記附著到模型。
    - 工程圖 Schema 從 12 升到 15。
  - **下一步（定案順序）**：
    1. D-I4 座標尺寸、尺寸對正與自動排列。
    2. D-I7(a) 在視圖上右鍵開啟零件。
    3. D-I1b 剩下的部分：右鍵選單；指令列移到頂端。
    4. D-I5 任意角度、階梯、對正剖面，以及輔助、斷裂、裁剪、局部剖視圖。
    5. D-I8 小功能。
    6. D-I6 多圖頁。
- **【2026-10-15：D-I2 第二部分（二）— 組合件視圖可以標尺寸（Claude）— 已提交並推送到 `main`】**（ADR 0138 第二部分二，**工程圖 Schema 13 → 14**）
  - **做法**：
    - 尺寸的元素參照多一個 `in`（葉節點 id）。
    - worker 的 `drawingAssemblyEdges` 依零件實例投影邊和頂點，套用 `placementRows`。
    - 元素事實用 `placeElementFacts` 放到組合件座標，旋轉和鏡射都正確。
  - **驗證**：
    - `drawing-assembly-dims.test.ts` 4 項（移動、旋轉、鏡射的手算值）。
    - 瀏覽器：治具前視圖點兩支銷的頂點得到 207，與手算相同。
    - 工程圖瀏覽器腳本 17/17。
  - **D-I2 剩下的**：註記綁定模型邊（下一步）。
- **【2026-10-15：D-I2 第二部分（一）— 細部放大圖的點選、垂直距離、圓柱輪廓線（Claude）— 已提交並推送到 `main`】**（[ADR 0138](docs/adr/0138-drawing-named-view-edges.md) 第二部分一，**工程圖 Schema 12 → 13**）
  - **細部放大圖**：可以點選元素標註（用細部圓裁切後的母視圖線條）。
  - **垂直距離**：點到斜線、兩條平行斜線之間，都標成對齊尺寸。面板的「對齊」在平面之間的語意改成垂直距離（原本量的是原點距離，對平行平面沒有意義）。
  - **圓柱輪廓線**：側看的圓柱兩側輪廓線可以點選；單選一條就是直徑，自動加「Ø」；新增 `aSide`／`bSide`，所以升版到 13。
  - **驗證**：
    - 新增 `drawing-outlines.test.ts` 5 項；`drawing-pick.test.ts` 的舊規格改為手算值（8、12）。
    - 全量 vitest 2761 過；工程圖瀏覽器腳本 17/17。
    - 瀏覽器實測：削邊銷得到 Ø10；5:1 細部放大圖裡可以點選。
  - **D-I2 剩下的**：組合件視圖的尺寸（`Ref` 要加零組件路徑）、註記綁定模型邊。
- **【2026-10-14：D-I2 第一部分 — 視圖的邊與頂點有名字，尺寸可標在頂點與邊上，等角視圖也行（Claude）— 已提交並推送到 `main`；ADR 原編 0135，因遠端已用 0135～0137，改為 0138】**（[ADR 0138](docs/adr/0138-drawing-named-view-edges.md)）
  - **做法**（依 spike 的結論，不重新編譯 WASM）：
    - worker 的 `viewEdges`（`@3db/regen`）依持久名稱投影每條邊與頂點，附上深度和端點名稱。網格每個零件只算一次。
    - `visibleElements`（`@3db/drawing`）用視圖自己的 HLR 可見線決定哪些看得見；重合的只留離觀看者最近的那條。
  - **點選**：頂點優先；直線邊和平面平手時平面勝，所以舊行為不變。整圓的接縫頂點和曲面的接縫邊不提供點選。
  - **標註**：單選一條邊就是它的長度；兩個點依游標位置標水平、垂直或對齊；水平或垂直的邊視同側看成線的平面；**等角視圖可以標（投影長度）**；不在圖紙平面的邊之間的角度會被拒絕。
  - **順手修正的既有錯誤**：`sheetUp` 是 HLR 畫的 y。等角視圖的 `up` 不和視線垂直，以前多處把 `up` 當 y；組合件等角視圖的號球引線起點也因此偏掉，現在一併修正。
  - **驗證**：
    - `tests/phase5/drawing-edges.test.ts` 10 項，真實核心：重合點取近的、等角視圖藏住最遠的角、名稱解析、與逐一比對法一致、200 個隨機點 0 誤選、長度手算、接縫回歸。
    - 全量 vitest 2690 過。
    - 全量 `verify:ui` 第一次 128/129，抓到接縫頂點問題；修正後工程圖相關腳本 17/17。
    - **rebase 到遠端 26 個提交（視角方塊、正視於、B3.1 決定性重建、草圖投影磁吸等）之後重驗**：全量 vitest **2754 過、0 失敗**；工程圖相關瀏覽器腳本 **17/17**。衝突兩處：worker 的 import（遠端把 `planarEdgeItems` 換成 `modelSnapItems`，這邊加上 `viewEdges`）和本檔。
    - 瀏覽器實測：等角視圖點兩個頂點，標出 127.279，與手算相同。
  - **D-I2 剩下的（第二部分）**：
    - 組合件視圖的尺寸（`Ref` 要加零組件路徑）。
    - 註記綁定模型邊（ADR 0132 的限制）。
    - 曲面輪廓線對應到面。
    - 斜線之間或點到斜線的垂直距離。
    - 細部放大圖上的點選。
- **【2026-10-14 晚：10-14b 決策頁執行——B1 視角方塊首頁鈕、B2「正視於」全套比照 SolidWorks、C1 手冊 11 處、C2① 爆炸後「全部顯示」、C3 c13 階梯板＋肋邊圓角、D2 刪 vui.txt（Claude）— 已提交並推送 `fa807bb`；A1／A2／A3 歸 Claude Code 工作階段】** 決策原文與選擇見 `docs/decisions-2026-10-14b.html`（本段記 B、C、D 組）。
  - **B1 首頁鈕**（方塊後續四項只做這項；翻面 180°、右鍵選單、拖曳旋轉不排）：`Viewport.tsx` 的 ViewCube 左下加 ⌂ 小鈕，點了 `setView('iso')`；i18n 新增 `cube.home`（「回等角視」／"Home (isometric view)"）。
  - **B2「正視於」全套比照 SolidWorks**（選「①＋無選取時回等角視」）：`actions.ts` 的 `lookAtNormal()` 重寫——編輯草圖時正對草圖面（`store.frameOf`），建模時對所選平面／基準面正對（`normalFrame()`）；**再按一次翻面**＝只有當相機正看向近平面側（`viewDirection()` 與面法向點積 < −0.999）才取反法向，從遠側再按是用面自己的法向轉回來；**無選取**（或選到曲面）＝回等角視。`viewer.ts` 新增 `viewDirection()`（`camera.getWorldDirection()`）；啟用條件改為 `sketching || partIdle`。法向取反把 0 映成 0（避免 −0 讓測試的 Object.is 失敗）。說明主題 `help.viewNormal` 三種行為寫齊（zh-TW＋en，see-id 用 kebab）。
  - **B2 驗證**：`tests/phase8/view-normal.test.ts` 6 項（stub viewer 錄 `lookAt`／`setView`／`viewDirection`）：無選取→iso；正對再按→翻面、再按→翻回、斜視角不翻；曲面可按但執行回 iso。`manual-c20.js` 步驟 9b 在真實瀏覽器經 `.heads-up` 正視於鈕按四次（前三次選 `plane:front`、第四次清選取），方向依序 [0,0,1]、[0,0,-1]、[0,0,1]、[0.577,0.577,0.577]，**PASS**。手冊 C20 新步驟 10b。
  - **C2① 爆炸步驟後重新「全部顯示」**（角度欄雙單位不修，使用者裁決）：`assembly.ts` 的 `animateExplode` 兩條完成路徑（無影格直接跳、動畫跑完）都 `fitRequest + 1`，`AssemblyViewport` 的 effect 收到變號就 `fitAll()`。`phase3-explode.js` 在收合後與再爆炸後各量 `camera.top − camera.bottom`，斷言爆炸後視野高度 > 收合後 ×1.05；**反向對照**：拿掉 bump 斷言以「309.5 vs 309.5」失敗，還原後過。手冊 D5 標已自動重播驗過。
  - **C3 c13 階梯板＋肋邊圓角**（號球引線彎折維持選做不排）：`manual-c13.js` 新步驟 6——40×30×10 板上，於上基準面畫 20×30 邊角矩形（**兩個角都按 Ctrl**：第一角不按會把板自身的邊整條轉成草圖參考線，與矩形自己的邊重疊，伸長填料以「分支點」拒絕——**發現的潛在缺陷，行為未改、待裁**，覆蓋表有記），標 20／30，從上基準面伸長 20（下 10 是板原有料、上 10 是階梯，計 18000）；右基準面畫 v=25 的 16 長線（尺寸 16、25）→「肋材」→ 體積 18640（＝18000＋2·16·5＋2·16·15，每片 2 mm 半厚乘自己那片的高度：牆停在第一個碰到的面）。步驟 7：肋頂 16 長邊「圓角」R2 → 體積 18626.2655（−16×(4−π)）、`edges` 恰 1 條；**PASS 37.8s**。手冊 C13 步驟 6 補配方與 Ctrl 警告。
  - **C1 手冊 11 處一次全改**：C10（孔要放遠）、C12（截面清單順序）、C15（方向 2 先換上基準面）、C16（訊息字面）、C21（相切邊線要圓角開著）、C22（寫錯：「開始時」＝下次載入頁面才套用）、C26（角度與 Shift 離線 3° 以上）、D1（「工位」→「定位組」）、D6（同元素再點＝取消）、E4（寫錯：不是停在 5 mm）、E6（移動面板開著時復原停用）；覆蓋表「手冊要補」註記銷帳。
  - **D2**：根目錄 `vui.txt`（git 未追蹤的驗證殘留輸出）已刪。
  - **D1（第三個測試已寫好，等使用者存檔）**：`tests/phase3/real-part1-fillet.test.ts` 已加第三個測試——修好後 `fillet_lugs` 必成（`problems` 空）、體積回到 149.705286 mm³（6 位小數）、同檔二次重建體積逐位元一致。修好 sketch6 後請存成 **`D:\3DB實機確認\C3C6檢具\零件1_45度基準面圓角完成_sketch6修好.3dbx`**（新檔名，勿覆蓋原檔——第二個測試鎖的是原檔的確定性失敗）；該檔不存在時第三個測試自己報 skipped，存檔當下轉綠。反向對照已驗：把未修的原檔放在該檔名下，第三個測試以「fillet_lugs=error 圓角失敗」失敗（斷言有牙）。10-15 已驗：有檢具目錄時 2 過 1 略、無 `REAL_PART1_DIR` 時全略、typecheck 0 錯誤。**尚未提交**。
  - **驗證**：`typecheck` 0 錯誤、`lint:deps`／`lint:rules`／`lint:i18n` 全過；全量 vitest **2744 過、24 略過、0 失敗**（210 檔過、4 檔略過）；`verify:ui` 本批三支改動腳本各自重跑全過（c20、phase3-explode、c13），**全量未跑**——本批不動共用腳本，上一輪全量 131/131（15:52）之後僅這三支變動。
  - **工作區邊界**：另有主題重構工作階段的未提交檔（`app.css`、`DrawingViewport.tsx`、`theme.ts`、`main.tsx`、`FlatPanel.tsx`、`PropertyManager.tsx`、`sketcher/overlay.ts`、兩張決策頁的配色、`viewer.ts` 的 COLORS/`setPalette`），本批一律不碰；`viewer.ts` 兩邊都有改動，提交時我只含 `viewDirection()` 那一段。

- **【2026-10-14 下午～晚：B1 查出「重建不是文件的純函式」——已完成決定性修復（B3.1，[ADR 0137](docs/adr/0137-deterministic-rebuilds.md)）；C1、D1 結果（Claude）— C1、B1 已推送 `fd2268e`、`cb06d66`；決定性修復已推送 `ce182d5`…`acfc99e`】**
  - **C1 草圖吸附平面外的模型邊（[ADR 0136](docs/adr/0136-sketch-snap-projected-edges.md)）**：使用者選「做自動投影」並加選「也加貫穿點」。`modelSnapItems`（regen）＝平面上的邊（無 `off`）＋平面外的邊沿法向投影（直線不含垂直者；平行的圓／圓弧；`off`＝離平面多近，穿過為 0）＋直線邊嚴格穿過平面的貫穿點；投影重疊只留最近的，與平面上的重疊則剔除，落在既有角點的貫穿點不列，接縫邊不列。`snapModel` 次序：平面上的點 → 投影邊的點與貫穿點 → 平面上的邊 → 投影邊。**投影邊吸上後成為建構線**（避免把模型邊拉進輪廓）；貫穿點成為帶 `pierce` 的點。驗證：regen 手算 4 項（反向對照 3 項失敗）、snap-model、sketcher、e2e `manual-sketch-projected-snap.js` 4/4；全量 vitest 2733 過、26 略過、0 失敗。
  - **B1 的發現與修復（`D:\3DB實機確認\` 已放回）**：原現象「開檔第一次圓角『遺失參考』、再開一次就好」＝**重建不是文件的純函式**（違反 B3.1，P0）。根因兩層：① 求解器 planegcs 依參數在記憶體中的位址排序，同一張草圖的輸出在最後幾位漂移（達其收斂門檻 1e-10 mm）；② cut2 的圓弧落在 revolve1 的 R 3.125 圓柱面上（重合面），OCCT 的 `ShapeUpgrade_UnifySameDomain` 併不併它們隨內部順序（記憶體狀態）而異——面來源因此第一次只報工具面 `cut2:side:sketch6.a3`。排除過的假設（皆無效）：`SetNonDestructive`、`SetFuzzyValue`、放寬合併公差、調緊收斂門檻（`clear_data()` 會重置）、重建間快取（無快取）。
  - **修法**（使用者裁決：先決定性重建、再修草圖）：① 求解輸出上**十進位**網格（`canon`，1e-10 mm／1e-12 rad，≪核心公差 1e-7；打字值原樣保留、−0 歸 0）；② 每次重建前 `await solver.fresh()`（重載求解器模組，約 4 ms；worker 四個重建入口都接上，編輯中的互動求解不受影響）；③ 布林結果中「工具做出、貼在本體面同曲面且相接」的面繼承本體面來源（`sameSurface.ts` `inheritBodySurface`；平面／圓柱／球，軸向反向算同一；圓錐／環面／自由曲面不比較）；④ `mergeGroups` 補「點在曲線上而該點已是該曲線端點→移除」（合併點後避免過度定義）。紅隊四問與量測細節在 DEV_LOG 最上方、架構決定在 ADR 0137。
  - **驗證**：typecheck 0 錯誤、三項 lint 全過、全量 vitest **2743 過、24 略過、0 失敗**；`real-part1-fillet.test.ts` **2/2**——四次重建＋穿插其他草圖求解後，問題清單、面名稱、體積、所有草圖解**逐位元一致**；存檔現狀為**確定性「圓角失敗」**（凸耳邊參考都找得到、`unresolved` 空；sketch6 有 11 條 `pointOnCurve` 成對角落）。反向對照：拿掉 `canon` 或 `fresh()`，測試即失敗。全量 `verify:ui`：**131/131 通過**（131 列、0 已知缺陷；含修好的 `manual-c8`）。
  - **零件1 的草圖修補（使用者手動；修好前 `fillet_lugs` 必失敗）**：sketch6 的 8 個凸耳角落各有兩個相距約 1e-10 的端點（直線端與圓弧端各一、彼此有「在…上」關係）。每個角落用「合併點」合成一點——**保留圓弧側端點**（弧側儲存位置近真解；直線側有幾個點離很遠，留它會不收斂；合併保留**先選**的點）或改用「修剪」；8 組做完後，面板會把若干關係列為冗餘（探索時見到：點重合到圓弧、兩條等長、一組對稱——其中一半已被合併後的條件涵蓋），**逐一刪除面板標示為冗餘者直到完全定義**（關係糾纏，需自行判斷；自動刪會刪錯）。完成後圓角應可成立；修復前圓角成功時體積 149.705286 mm³（＝DEV_LOG 夜間四）。
  - **D1 全量 `verify:ui`（13:30 起、14:07 完成，含 C1 的版本）**：**130/131**，唯一失敗 `manual-c8.js`——C1 的角落吸附讓腳本畫在同尺寸模型上方的矩形吸到下方模型的角，加上兩個尺寸後草圖過度定義、尺寸框不再出現（逾時）。**修正為腳本**：`manual-support.js` 的 `rectSketch` 第二個角**按住 Ctrl** 點（如真人暫停吸附）。原結果檔 `%TEMP%\claude\…\scratchpad\verify-ui-final.{txt,json}`；修好後的全量重跑結果見上方「驗證」。
  - **`ffa13a7`（平行工作階段，UI 重構：樹篩選改搜尋框、檢視選項浮動工具列）**：已隨本段一起推送；由本段重跑的全量 `verify:ui` 一併覆蓋。
  - **推送憑證（這台電腦）**：`origin` 現在連讀取都要憑證（2026-10-14 實測 `fetch`／`ls-remote` 都被要求登入）。經使用者選擇，本 repo 設了**本機** `credential.helper=manager`（Qoder 自帶的 Git Credential Manager），`git push` 隨即通過——之後的推送不用再處理；**新 clone 不會帶這個設定**，要重設一次。
  - **A1、A2、B2、D2** 見下一段（另一工作階段記錄）。

- **【2026-10-14：10-11 進度審查的 7 項處置完成、A1/A2 執行結果（Claude）— 已提交並推送 `52bcb47`】** 使用者以選擇題裁決 8 項（`docs/decisions-2026-10-14.html`）。本段記 A、B、D；C1／C2 的實作另起段落。
  - **A1（推送）**：`52bcb47`（`main.tsx` 的兩道 `import.meta.env.DEV` 閘控）已推送。**推送前 fetch 時發現 `origin/main` 已含它**——並行開發者已先推送，且遠端最上方是 `b0df5d2`（視角方塊）。本機與遠端已一致，`git push` 回報 `Everything up-to-date`，無需動作。
  - **A2（驗證視角方塊那批改動）**：對象從「15 個未提交檔」變成**已提交的 `b0df5d2`**。結果：`typecheck` 0 錯誤、`lint:rules`／`lint:deps`／`lint:i18n` 全過。全量 vitest 第一次 **2714 過 1 失敗**（`tests/phase3/thread.test.ts`），**單獨跑 1 passed、第二次全量 2715 過 0 失敗**——未重現，判定為全量平行負載下的間歇逾時（`testTimeout: 60_000`、`maxWorkers: 4`），非功能破壞，**未調門檻（AGENTS.md §3.3）**。注意：`thread.test.ts` 的 `it` 多半已自行宣告 `timeout: 120_000`。
  - **B2（客戶零件歷史）**：維持現狀。已複查 `apps/web/public/*part1*.json` 確實不被 git 追蹤（`ls-files` 報 not known to git）、`.gitignore:19` 擋著；歷史副本留在 `c7f46be` 不處理。
  - **D2（筆電收尾）**：使用者稍後自行到筆電 `git pull` 並刪 `laptop-work` 分支。
  - **7 項處置（承接 10-11 審查）**：18 個零斷言診斷檔移至 `scratch/diagnostics/`；`redefineSketchPlane` 補 `planeRef()` 校驗＋3 斷言；`.gitignore` 加 `*part1*.json`；`SketchPlanePanel` 補 `coordSys`；`main.tsx` 閘控補回；DEV_LOG／覆蓋表標註證據鏈；`check-anti-patterns.mjs` 新增「零斷言測試檔案」規則（已實測會 fail）。



- **【2026-10-14：視角方塊比照 FreeCAD 導覽方塊（Claude）— 已提交並推送】**
  - **使用者指正**：先前做的「每面九格」是錯的；FreeCAD 是切角方塊，有 8 個頂角面（空間 45°）與 12 個 45° 稜邊面。
  - **現在**：`packages/render/src/viewNav.ts` 的 `cubeFacets()`（切角 `CUBE_CHAMFER = 0.24`＝FreeCAD 的 0.12）以平面裁切算出 26 個面：6 個八角形主面、12 個矩形稜邊面、8 個正六角形頂角面，各對應 `cubeDirection` 的一個方向。`Viewport.tsx` 的 `ViewCube` 改用 SVG 依 `cubeMatrix` 正投影畫出朝向觀看者的面（凸多面體不需排序），主面文字以同一線性映射貼在面上；點主面＝標準視角，其他＝`lookFrom`。四周旋轉／滾轉箭頭（系統選項 `viewCubeStep`，預設 45°）保留。
  - **驗證**：`view-keys.test.ts` 新增 7 項幾何測試（形狀、平面且朝外、45°／54.74°、尺寸、48 頂點各屬 3 面且 V−E+F=2、拒絕不合理切角）；`manual-c20.js` 第 4、12 步改為在面中心以 `elementFromPoint` 點擊，26 個面都從偏 20°／10° 的視角點到正確方向（< 1e-6°），**14/14 通過**（在瀏覽器面板內跑，因 5393 被另一個 `verify-ui` 佔用）；`typecheck`、三項 lint、`tests/phase8` + `apps/web/test` 728 過。未跑全量 vitest 與全量 `verify:ui`。
  - **仍待使用者決定**：FreeCAD 方塊的首頁鈕、翻面 180°、選單、拖曳方塊旋轉要不要做；「正視於」要補哪一種（見下方鍵盤視角段的②）。
- **【2026-10-14：螺牙起始處缺半顆牙、整條沿軸向偏移（Claude）— 已提交並推送 `5872480`】**
  - **現象**：以草圖牙型建立的螺牙，草圖牙型完整，但模型起始處的第一顆牙缺了一半，整條螺牙看似沿軸向偏移半個牙寬。
  - **根因**：`packages/regen/src/engine.ts` 的 `thread()`（草圖牙型模式）以牙型沿軸向的**中點** `zc = (zMin + zMax) / 2` 當起點，核心再以 `from`～`to` 平切，起始截面切在牙型正中，畫在起始端的牙型後半部沒被切除。這是 ADR 0123 §4 原本的規定，不是寫錯。另一個問題：軸向範圍的取樣，圓弧只取圓心與兩端點、圓只取圓心，圓形牙型的範圍是 0。
  - **修正**：起點改為牙型**前緣**（正向 `zMin`、`reverse` 取 `zMax`），`length` 從前緣量起；圓弧／圓改用與核心相同的 64 點取樣。ADR 0123 §4 已改寫並記下原因。標準牙型模式（`standard`，起點取所選面的端點）不受影響。
  - **驗證**：`tests/phase3/thread-feature.test.ts` 新增 3 個實體探針測試（正向、反向、圓形牙型）；**舊碼 3/3 失敗、新碼 3/3 通過**。全套 vitest 2703 過、22 略過（`PERF_CHECK` 閘控的效能測試）、0 失敗；`typecheck` 0 錯誤。未在瀏覽器以使用者的零件3 重現。
  - **相容性注意**：既有檔案中以草圖牙型建立的螺牙，重建後會**往起始端移半個牙寬**，長度改從前緣起算；要與原終點對齊需把長度加上半個牙寬。
- **【2026-10-14：「關閉伺服器」按鈕（[ADR 0135](docs/adr/0135-dev-shutdown-button.md)）— 已提交並推送 `817fdf2`】**
  - **用途**：開發伺服器啟動後，按一下就結束整套系統。只在 dev 出現（`import.meta.env.DEV`），正式 build 與 Tauri 版沒有此按鈕。與 ADR 0118（無人連線時自動結束）互補。
  - **做法**：Vite 外掛 `apps/web/dev/shutdown.ts`（`apply: 'serve'`）只接受 `POST /__3db/shutdown`：先回 200，再斷開所有熱更新 WebSocket，然後 `server.close()`、`process.exit(0)`。頁面端 `store.shutdown()` 先設 `shuttingDown`、`worker.terminate()`，再送請求。`ShutdownButton` 放在指令列說明按鈕旁；`ShutdownOverlay`（z-index 1000）顯示「本系統已關閉」。i18n 四個鍵 `shutdown.*`。
  - **驗證**（依 ADR 0135 記載）：`tests/phase8/shutdown.test.ts` 5 項（只認 `POST` 到該路徑）；`typecheck`、`lint:rules`、`lint:deps`、`lint:i18n` 全綠。
  - **限制**：關閉後分頁失效，要重新 `npm run dev`；進行中的重建會中斷。
- **【2026-10-14：鍵盤視角比照 SolidWorks（Claude，這台電腦）— 已提交並推送到 `main`】** 兩個提交原本在 10-13 晚做好（rebase 前 `a870852`、`2f38b6a`；**在 `main` 上是 `f739e56`、`99c68f4`**），推送時遠端已有工程圖的 8 個提交（`627dee8`…`6ac4e97`），**rebase 到其後**（重疊檔 `App.tsx`、`app.css`、`store.ts` 自動合併無衝突），合併後重新驗證：`typecheck`、三項 lint 通過，vitest **2695 過 0 失敗**，全量 `verify:ui` **129/129**。注意：用開了近 20 小時、經過 rebase 的 vite（5391）跑全量時兩次在 `manual-c10` 後換頁卡住（`no answer to Page.navigate in 120s`），小範圍重跑不重現；經使用者同意結束那個 vite 後，`verify:ui` 自己啟動的新伺服器跑出 129/129。**大量改檔或 rebase 之後，驗證前先重啟開發伺服器。**
  - **按鍵（固定，不在快速鍵對話框；在輸入框、工程圖、對話框開著時不作用）**：← → ↑ ↓ 以模型中心沿螢幕軸轉「方向鍵旋轉視角的角度」（系統選項，預設 15°，1–90）；Shift＋方向鍵 90°；Alt＋← → 螢幕平面內滾轉（Alt＋→ 順時針）；Ctrl＋方向鍵平移畫面 1/10；Shift+Z 放大／Z 縮小 1.25 倍；Ctrl+Shift+Z 上一個視角（記 10 個：鍵盤、滑鼠拖曳與滾輪、標準視角、全部顯示、正視於）；空白鍵開「視角方位」對話框（`ViewOrientationDialog.tsx`，依 SW Ctrl+1～8 次序）。新增動作 Ctrl+2 後視、Ctrl+3 左視、Ctrl+6 下視（標頭工具列多三顆鈕，800 px 寬仍一列）。
  - **設計重點**：相機運算是純函式 `packages/render/src/viewNav.ts`（可單元測試，NaN 等非有限輸入明確拒絕）；`ViewState` 含視野框（「全部顯示」會改它），還原後依目前視窗長寬比校正；`fitAll`（使用者）與 `fitView`（內部步驟，不記歷史）分開，避免「上一個視角」停在半成品。按鍵在快速鍵迴圈之前處理，因為 `matchesShortcut` 不寫 Shift 時也吃 Shift（`Ctrl+Z` 會吃掉 `Ctrl+Shift+Z`）。
  - **驗證**：`tests/phase8/view-keys.test.ts`（方向、15° 到 1e-9、24 步回原點、90° 精確、滾轉不改方向、平移量、縮放上下限、NaN 拒絕、歷史順序／上限／複本、按鍵對應、快速鍵不衝突）；`manual-c20.js` 新增步驟 6–11 在真實瀏覽器驗（含 Ctrl+Shift+Z 不是復原、輸入框內不轉）；手冊 C20、`help-links.json`、新說明主題「檢視模型：滑鼠與鍵盤」（`concept.view`）。
  - **待使用者決定（10-13 晚提出；① 的 26 個面與箭頭已在 10-14 完成，見最上方）**：① 視角方塊比照 FreeCAD 導覽方塊（26 個可點區域：面／邊／角；旋轉與滾轉箭頭，FreeCAD 預設 45°；翻到背面 180°；首頁；選單；拖曳旋轉）要做哪些；② 「正視於」目前只在編輯草圖時可用，使用者要補的是哪一種（草圖外對所選平面或基準面、再按一次翻面、無選取時轉到最近的標準視角、草圖介面內的按鈕）。
- **【2026-10-14：新工程圖從空白圖頁開始，先選主視圖，尺寸按需標註（Claude）— 已提交並推送到 `main`】**（[ADR 0134](docs/adr/0134-drawing-main-view-first.md)）
  - **使用者要求**：尺寸按需標註；工程圖保留更多自由度；比照 SW，先選定主視圖，再從主視圖按需拉出其他視圖。
  - **事實核對**：新工程圖本來就不會自動產生尺寸，但會自動放三視圖。
  - **現在的行為**：
    - 新工程圖是空白圖頁（零件和組合件都一樣），視埠和屬性面板都提示「先選主視圖」。
    - 從右側調色盤拖出主視圖 → 自動進入投影模式，按需求拉出其他視圖。
    - 「標準三視圖」改成調色盤下方的按需指令。
    - 組合件的零件表改成放好視圖後，從註記群組加入。
    - 尺寸群組以「智慧型尺寸」為主；自動標註收進「依模型自動標註（模型項次）」。
  - **e2e**：共用工具新增 `H.newDrawing(directions?)`，不帶參數時按下真正的「標準三視圖」按鈕；13 支腳本已改用它。
  - **驗證**：
    - 全量 vitest 2681 過、0 失敗；受影響的 17 支瀏覽器腳本 17/17；typecheck 與三項 lint 通過。
    - 瀏覽器實測：空白圖頁 → 拖出前視 → 往下拉出上視；主視圖不動，尺寸 0 個。
  - **已知限制**：空白圖頁的零件來源不存進檔案；空白圖頁存檔再打開時，調色盤是空的，要重新從零件建立。
  - **工作方式**：使用者 10-14 指示一律直接在 `main` 上提交與推送，不再建立旁支。合併與分支清理見下一段；被刪除的 Codex worktree 裡未追蹤的 4 個檔案，備份在 `scratch/codex-worktree-sheet-metal-break-corner-2026-10-14/`（scratch 不進版本庫）。
- **【2026-10-13：工程圖交互比照 SolidWorks — 差距分析、使用者決定、D-I1a、D-V、D-I3、側邊欄，2026-10-14 已合併進 `main`（`3fb1520`）（Claude）】**
  - **分析與決定**：
    - [docs/drawing-interaction-gap-plan.md](docs/drawing-interaction-gap-plan.md)：與 SW、FreeCAD TechDraw 逐層比較，歸納出 4 個根因，規劃 D-I1～D-I8。
    - §9 是使用者在選擇題頁回答的 14 個決定（幾何公差採 ISO 1101，藍圖的 P2 全部提前，不做驅動尺寸，多圖頁排最後）。
    - §10 是 D-I2 的技術驗證結果，§11 記錄後來插入的 D-V。
    - 決策紀錄 [ADR 0129](docs/adr/0129-drawing-interaction-roadmap.md)；藍圖 C16.1、C16.3～C16.6 已改寫。
    - 選擇題頁：https://claude.ai/artifact/Ns9jkdh2xdi4vcCpkatyUt
  - **D-I2 技術驗證**（`tests/phase5/hlr-trace-spike.test.ts`）：
    - `replicad-opencascadejs` 沒有開放 `CompoundOfEdges(…, In3d)` 和 `HLRBRep_Data`，無法直接追溯每條線來自哪條邊。
    - 改用幾何回推可行：正視圖裡幾乎都能唯一對應，或對到在圖上重合的幾條邊（取哪條數值都一樣）；真正分不清的線很少，要用射線測試排除；沒有對應的線是曲面的輪廓線，要對應到面。
    - 不需要重新編譯 WASM。
  - **已完成**（每項都有 ADR、單元測試，並在瀏覽器用真實 pointer 事件驗證）：
    - `5460810` **D-I1a 多重選取**（[ADR 0130](docs/adr/0130-drawing-multi-selection.md)）：
      - Ctrl＋點選；窗選與交叉選；Delete 刪除全部所選。
      - `batch` 指令讓一次修改成為一個復原步驟，而且全做或全不做。
      - 選多個尺寸時可一次修改。
      - **行為變更**：左鍵拖曳空白處改為框選，平移改用中鍵或右鍵拖曳。
    - `e596772` **D-V 在圖紙上產生視圖和剖面**（[ADR 0131](docs/adr/0131-drawing-views-by-pointer.md)）：
      - 視圖調色盤：拖曳或點選放到圖紙上。
      - 投影視圖的預覽跟著游標；斜角放等角視圖。
      - 剖面：切割線會貼齊；放在哪一側就決定箭頭方向；Ctrl 可以放在任意位置。
      - 放新視圖時其他視圖不動，靠補償的 shift 達成。
    - `5a206e2` **D-I3 註記**（[ADR 0132](docs/adr/0132-drawing-annotations-gdt.md)，**工程圖 Schema 11 → 12**）：
      - 註解（可帶引線、`$PRP:`）、基準（ISO 5459）、ISO 1101 公差框（14 個符號，畫成向量線條）、手動中心線與中心符號線、3/4 圈螺紋線。
      - 不合 ISO 規則的組合，由命令層明確拒絕。
      - 基準與公差框的引用一致性：改名會連動；被引用的基準不能刪。
    - `5a206e2` **側邊欄比照 SW**（[ADR 0133](docs/adr/0133-drawing-sidebar-like-solidworks.md)）：
      - 工程圖樹與屬性兩個分頁；屬性依選取內容切換標題和可收合的群組框。
      - 常駐指令列；視圖調色盤移到右側工作窗格。
      - 所有欄位只用 `hidden` 隱藏，留在 DOM 裡，所以既有 e2e 腳本都還找得到。
    - 這次的最後一個提交：補上 `manual-drawing-annotate.js` 缺的 `choose`（10-12 筆電漏掉的），並把步驟 10、11 改成 D-V 的放置規則（剖面對齊母視圖、沿線滑到游標處）。**這支腳本現在通過。**
  - **驗證（合併進 `main` 之後，2026-10-14）**：typecheck 0 錯誤，三項 lint 通過；全量 vitest **2681 過、22 略過、0 失敗**；全量 `verify:ui` **129/129**。分支上記錄過的 `manual-drawing-linked`、`phase5-angle` 失敗，已由 `main` 在 10-13 的提交修好（`335b46c`、`536b57c`）。`drawing-linked.test.ts` 釘住的 schema 版本號因刻意升版，從 11 改成 12。
  - **合併（`3fb1520`）**：`main` 在 10-13 另有 19 個提交，合併時有 3 處衝突：
    - `state/drawing.ts`：import 取聯集；`ensurePalette()` 之後接 `main` 的 `autoScaleWhenReady()`。
    - `DrawingPanel.tsx`：沿用 `main` 的 `centreArrangement()`，換成新的變數名稱 `view`。
    - 本檔：兩邊的條目都保留。
    - `manual-drawing-annotate.js` 由 git 自動合併：用 `main` 的 `setField` 和這邊的 D-V 放置規則；這邊多餘的 `choose` 已刪除。
    - 已刪除其他分支：本機的 `drawing-interaction`、`integrate-laptop`、`laptop-work`、`codex/sheet-metal-break-corner`（連同它的 Codex worktree），以及 `origin` 上的 `drawing-interaction`、`codex/sheet-metal-break-corner`。它們的提交都已經在 `main` 裡。`laptop` 遠端（F: 磁碟）沒有連上，那邊的分支沒有動。
    - 之後一律直接在 `main` 上工作（使用者 10-14 的指示）。
  - **已知限制**（細節在各 ADR）：
    - 註記記在視圖座標，沒有綁定模型邊，要等 D-I2。
    - 剖面預覽用的是沒切開的零件外形；剖面外框比較小時，其他視圖可能小幅移動（外框不同的零件還沒量測）。
    - 切割線只有垂直和水平。
    - 零件與組合件的側邊欄還是舊樣式。
  - **編號衝突（要注意）**：下方「接棒指引：裝飾用公螺牙與母螺孔」原本預定用 ADR 0129，但 0129～0133 已被這次的工作用掉。裝飾螺紋要寫 ADR 時，請用 **0134 之後**的編號。另外 D-I3 已經在工程圖上畫 3/4 圈螺紋線（從孔特徵的規格讀大徑），那份指引的 Step 5 可以直接沿用 `threadItems`。
  - **下一步（定案順序，見規劃 §9）**：
    1. 合併 `drawing-interaction` 到 `main`（使用者決定時機）。
    2. D-I2 有名字的視圖邊（約 2～2.5 週）：做完才能標頂點、邊、等角視圖、組合件視圖的尺寸，註記也才能綁定模型。
    3. D-I4 座標尺寸與自動排列。
    4. D-I7(a) 在視圖上右鍵開啟零件。
    5. D-I1b 剩下的部分：右鍵選單；把指令列移到頂端的 CommandBar。
    6. D-I5 任意角度、階梯、對正剖面，以及輔助、斷裂、裁剪、局部剖視圖。
    7. D-I8 小功能。
    8. D-I6 多圖頁。

    零件與組合件的側邊欄要不要比照工程圖重做，待使用者確認。
- **【2026-10-13 下午：草圖磁吸對照 SolidWorks／FreeCAD，補齊 4 項（Claude）— 全部已提交並推送】** `main` = `origin/main` = `8a9d2a1`（`df5e7de` 之後還有：`1651857` 本檔更正、`bf06b6d` CPU 計時、`8a9d2a1` `maxWorkers: 4`）。這次推送的：`c129ec3`（剖面交線略過 NaN 頂點）、`54f838c`、`d7838d8`、`8c2c2c6`、`73669b7`、`df5e7de`（本檔／DEV_LOG）。**筆電要先 `git pull`，才能開這台以 Schema 56 存的零件檔。**
  - **對照依據**：SolidWorks 說明（草圖抓取、自動關係、Ctrl）、FreeCAD 原始碼 `SnapManager.cpp`、`DrawSketchHandler.cpp`。對照表與「不是缺失」的項目（例如 FreeCAD 的多餘自動限制過濾：探針隨機畫 300 次，0 次過度定義）見 `DEV_LOG.md` 最上面一段。
  - **① Ctrl 暫停磁吸與自動關係（`54f838c`，SW）**：按住 Ctrl 點下去就在游標處，不吸附、不加關係，放開恢復。
  - **② 直線延長線磁吸（`d7838d8`，FreeCAD）**：端點之外接近延長方向時吸上去、畫虛線導引、加「在圖元上」；排在所有磁吸與推斷之後，不和水平／垂直／對齊同時加。新設定 `extension`（預設開）。
  - **③ 網格顯示（`8c2c2c6`，SW＋FreeCAD）**：網格磁吸開啟時畫出格線（每 5 格較深）；縮小到格線 < 8 px 時格線與磁吸一起改為 2、5、10…倍（`visibleGridSpacing`），抓到的點一定在畫出來的線上。已在瀏覽器實測。
  - **④ 圓弧中點（`73669b7`，SW＋FreeCAD，使用者選「真正的中點關係」）**：`midpoint.line` 可為圓弧，**零件 Schema 55→56**（遷移空轉，舊程式拒開新檔）。求解器用「點在圓上＋圓心→點 到 起點→終點 的有號角 +90°」；最初的中垂線寫法在隨機 200 次大改圓弧中有 3 次跳到補弧中點，改用有號角後 200 次 0、1000 次（更嚴苛）0。圓弧中點不得是圓弧自己的端點或圓心（只限圓弧：直線舊行為不收緊，避免舊草圖變得無法編輯）。
  - **驗證**：`typecheck`、三項 lint 通過；vitest 全量 2648 過、1 失敗＝`tests/phase3/silhouettes.test.ts` 的效能計時（建索引 < 25 ms）在全量平行負載下量到 61 ms；單獨跑 5/5 過，實測中位數 3.6 ms、最慢 9 ms，新舊共面門檻一樣快，**與今天修改無關，未調門檻（§3.3）**。全量 `verify:ui`（`73669b7`，沿用使用者開的 5391 vite，先確認它送出的 `planegcs.ts`、`interact.ts` 是新版）：**129/129**。
  - **（已修）全量測試在平行負載下失敗**：① 毫秒級計時（側影 25／5 ms、剖面 15 ms）改量 CPU 時間（`tests/support/cpuTime.ts`，門檻不變；24 個忙碌程序下由 3/3 失敗變 3/3 通過，真正變慢 10 倍仍抓得到）`bf06b6d`；② 60 秒逾時（knurl「either hand」、4a-6 ②、fillet-by-face）是 vitest 預設 15 個 worker 在 10 實體核心上互搶：交錯量測 15／8／6／4 個 worker 後設 `maxWorkers: 4`（`vitest.config.ts` 註解有數據），該測試由 147–157 s 降到 29 s，全量 324 s、2649 過 0 失敗（`8a9d2a1`；筆電核心數不同，4 應仍安全但未在筆電上驗證）。**不得用調高逾時處理（§3.3）**。
  - **待處理**：② 草圖磁吸目前只吸「草圖平面上」的模型邊，平面外的模型幾何要用「轉換參考圖元／穿透點」，要不要做自動投影待使用者決定。
- **【2026-10-13：10-12 成果審查與修正 — 全部已提交並推送（Claude）】** 目前 `main` = `origin/main` = `335b46c`（本檔與 DEV_LOG 的更新另有一個提交，見 `git log`）。細節與紅隊四問見 `DEV_LOG.md` 最上面一段。
  - **下面 10-12 那段列的 6 項 `verify:ui` 失敗都已解決**：`choose` 未定義（`4ee52a1`）；設計樹列比對改讀 `.name`（`58267d9`，`phase2-assembly`、`manual-e1`、`phase6-snap-ui`）；`phase5-angle` 是這台缺 `3DB實機確認/`，已改讀進版本庫的 `tests/fixtures/parts/bracket.3dbx`（內容與套件的 `支架.3dbx` 相同），不再依賴套件資料夾；`manual-drawing-linked` 是 `a7d5c50` 視圖名稱帶出的置中差 4 mm，**使用者裁定**「自動排版」改為與新工程圖相同方式置中（`335b46c`，`centreViews`）。
  - **審查另外修掉的**：組合件移動元件後側影線不更新、`push(...)` 在大量線段時拋 `RangeError`（`96b853d`，都先證明「拿掉修正會失敗」）。
  - **驗證（`335b46c`）**：全量 `verify:ui` **129/129**（多了 `manual-asm-silhouettes.js`），vitest **2629 過、22 略過、0 失敗**，`typecheck`、三項 lint 全過。
  - **已知、未修（要不要處理待決定）**：①（已修）`phase5-angle` 改讀進版本庫的固定檔。②（已修）新工程圖的最適比例改為等線條**和**各視圖的 features（孔的中心線由此畫出）都到齊才執行（`autoScaleWhenReady`），不再差 1 mm。③（已修）側影線的共面門檻由 0.81° 改為依 OCCT 網格實測雜訊訂定的 1−10⁻⁷（約 0.026°），大半徑淺曲面不再沒有側影線。④（已修）`sliceMeshByPlane` 略過頂點非有限（NaN、±∞、索引超出）的三角形，不再輸出非有限值線段。**10-13 審查記下的 4 項已知問題全部修完。**
  - **仍待使用者決定（沿用 10-12）**：客戶零件 `real-part1*.json`、`part1-demo.json` 在已推送的 `c7f46be` 歷史裡；筆電要 `git pull`，之後 `laptop-work` 分支可刪。
  - **（已確認全綠）** 10-13 修側影線門檻後重跑全量 vitest：**2631 過、22 略過、0 失敗**（303 秒，機器速度大致恢復），`knurl.test.ts`、`acceptance-4a.test.ts` 都通過。以下為當時的紀錄：
  - **未確認：全部單元測試在 `bf35d98` 時沒有全綠**：10-13 下午這台機器跑全量 vitest 變成 385～414 秒（早上 189～211 秒），`tests/phase3/knurl.test.ts`「takes the same for either hand…」與 `tests/phase4/acceptance-4a.test.ts`「4a-6 ②」兩個測試超過 60 秒逾時。**對照組**：把 `bf35d98` 的 `drawing.ts` 修改暫存後重跑，同樣這兩個逾時，所以和該修改無關；`knurl.test.ts` 單獨跑 15/15 通過（該測試 25 秒）。CPU 閒置、沒有殘留的 headless Chrome、電源計畫正常，變慢原因不明。**不得調高逾時門檻（AGENTS.md §3.3）**；下一步：機器恢復正常速度（如重開機）後重跑 `npx vitest run`，確認 2651 個全綠。
  - **PowerShell 5.1 提交訊息陷阱**：`git commit -m @'…'@` 的內容若有雙引號會被拆成多個參數而提交失敗（已暫存的檔案會混進下一個提交）；含引號的訊息改寫成檔案用 `git commit -F <檔案>`。
- **【2026-10-12 晚：筆電工作整合、C19、Schema 55、尺寸標籤即時拖曳 — 全部已提交並推送（Claude）】** 目前 `main` = `origin/main` = `a96321f`，工作區乾淨（`docs/plans/` 等未追蹤檔不是這次的）。
  - **整合（`d1b793c`）**：F: 筆電的 `laptop-work`（`1ce9501`「work from laptop」）合併進這台的 `main`（`c7f46be`）。筆電提交 42 個檔案中 26 個與 `c7f46be` 相同（檔案同步帶過去的草圖平面工作）；筆電真正新增的：設計樹階層模式與從屬標記、右鍵選單、工程圖與草圖改動、拖曳草圖尺寸標籤（`setDimensionPosition`）。本機遠端 `laptop` 指向 `F:\Self-developed_Apps\G3\3D-Builder`。**筆電那台要 `git pull`，之後 `laptop-work` 分支可刪。**

- **【2026-10-16 夜：B1 局部剖视（local section）全鏈路竣工，提交 `4f8968b1`（使用者）** 已完成：模型層（`LocalSectionDrawingView`、`SectionCut.local`、`sectionCut`、`checkView`、migration v20→v21）、核心層（`sectionViewLocal`：從可見面往內量 depth、`colHi - colLo` 拒絕超出零件、`opFailed` 明確拋錯）、流程層（`projectDrawingView` 處理 `cut?.local`、`requestOf`、`addLocalSection`）、圖面層（`sectionLocal` 斜影線、`localSectionItems` 封閉輪廓＋字母＋A-A 標題）、介面層（`DrawingPanel.tsx` 按鍵＋深度欄、`DrawingViewport.tsx` 矩形拖曳、i18n 全檔、8 項核對）。測試：`tests/phase5/drawing-local-section.test.ts` 14 項、`tests/phase5/drawing-local-section-kernel.test.ts` 8 項（深度 5=50、深度 8=100、平面位置不變、反向對照、擋截）、回歸 67 項，全過；`npm run typecheck` 0 新錯誤；`lint:deps`、`lint:i18n` 過。
  **尚未收尾的 UI：**工具面板「局部剖视」按鍵＋深度欄、`DrawingViewport.tsx` 拖曳連接、e2e 驗收——視使用者裁定。
- **【2026-10-17：使用者以選擇題裁定 15 項待決事項，頁面 `docs/decisions-2026-10-18.html` 為可點選清單（使用者裁定）** 每項包含「白話說明＋為什麼要你點＋可選項＋建議」。選擇後按 `Alt+S` 複製結果。
  - **B2.1 鎖定視圖**：做（建議）。
  - **B2.2 隱藏個別的邊**：做（建議）。
  - **B2.3 相切邊顯示**：做（建議）。
  - **B2.4 尺寸—公差子選單**：做「公差子選單」；反轉箭頭不做。
  - **B2.5 尺寸—自動排列含座標尺寸**：做（建議）。
  - **B2.6 四個小項目**：全部做四項（建議）。
  - **B2.7 輔助、斷裂、裁剪視圖**：做（建議）。
  - **B2.8 D-I6 多圖頁**：做（建議）。
  - **C1 壓花波浪邊下圓角 WASM 錯誤**：先重現與量化（建議），否則立案修復。
  - **D2 本地 dev server**：留著到 B2 實機確認做完；跑 `verify:ui` 時自備別的埠。
  - **D3 零件1 sketch6 修補**：我寫 e2e 自動修＋另存新檔；測試鎖「圓角成功＋逐位元相同重建」，體積只印出不斷言。
  - **Q1 手冊兩處「寫錯」文字**：改這兩處（建議）。
  - **Q2 ADR 0145 三項「要不要您實機」矛盾**：以清單為準（三項 e2e 已覆蓋）。
  - **Q3 F6 的 PDF 那半件**：這週就點（建議）。

  - **沒合進來的**：`tests/` 根目錄 18 個零斷言診斷測試（副本在 `scratch/diagnostics/`，不進版本庫）；客戶零件 `apps/web/public/*part1*.json`（已取消追蹤，檔案仍在磁碟，筆電的 `.gitignore` 擋著）。
  - **補上筆電提交漏掉的**：`viewer.ts` 的 `ViewerEvents.onLabelDrag`（筆電的 `Viewport.tsx` 已呼叫，原本編譯不過）；`redefineSketchPlane` 用 `planeRef()` 校驗（筆電 DEV_LOG 說有、提交裡沒有）；`cmd.dimensionPositionNotFinite` 進 i18n；e2e 輔助（`manual-support.js`、`phase1-demo-parts.js`）改讀設計樹列的 `.name`（列裡多了 ▲/▼、↳、└── 裝飾）。
  - **之後的修改（`a96321f`）**：① **C19**：階層模式下，草圖只有和使用它的特徵在同一個資料夾（或都不在）時才顯示在特徵底下，否則留在自己的資料夾、跟著折疊（`FeatureTree.tsx` 的 `sketchesUnder`）。② **零件 Schema 54→55**（使用者決定）：`labelPosition` 是檔案的新欄位，升版讓舊程式拒絕而不是默默丟掉；遷移空轉；測試 `tests/phase8/dimension-label-position.test.ts`。③ **尺寸標籤拖曳即時跟隨**（使用者決定）：拖曳中只在畫面上移動標籤（`viewer.ts` 標籤的 `offset`／`held`），放開時寫入一次（一次拖曳＝一個復原步驟）；寫入被拒絕時約 0.4 秒後退回。
  - **驗證（`a96321f`）**：`tsc`、lint:deps、lint:i18n 通過；vitest **2623 過、22 略過、0 失敗**；`verify:ui` 相關 32 支（C10–C26、草圖平面、尺寸標籤、螺牙、phase3-sketch-*、phase5-dimensions）**32/32**。全量見下一點。
  - **全量 `npm run verify:ui`（2026-10-12 深夜，`47e743a`，開發伺服器剛重啟）：122/128 通過，6 項失敗（10-13 已全部解決，見上一段）：**
    - `manual-drawing-annotate.js` 步驟 10、11：`choose is not defined`。**確定是筆電 10-12 改腳本時寫錯**（`1ce9501` 加了兩處 `choose(panel('[data-field="sectionAxis"]'), …)`，`choose` 從未定義）；要補上這個輔助函式或改用既有的下拉選取方式。
    - `manual-drawing-linked.js` 步驟 2、7（整組平移與置中的座標不對）、`manual-e1.js` 步驟 3、4（點不到元素）、`phase2-assembly.js`（`no PM field 深度`）、`phase5-angle.js`（等 `支架.3dbx` 開啟逾時）、`phase6-snap-ui.js`（`no tree row sk`）：這 5 支腳本自 10-07～10-09 後沒改過，**10-09 的全量是 125/125**，所以是 10-09 之後的產品改動造成（嫌疑：筆電的設計樹階層模式、PropertyManager、工程圖改動，或 10-10～10-12 的其他工作），**未逐一查明**。
  - **驗證前要注意（這次踩到兩次）**：① 5391 埠上若有長時間開著的 `vite`，可能送出舊模組（合併或大量改檔後監看漏掉），結果不可信；驗證前先重啟開發伺服器，可用 `curl http://127.0.0.1:5391/@fs/<檢出路徑>/packages/render/src/viewer.ts` 找剛改的識別字確認（註解會被轉譯拿掉，要找程式碼本身）。② 被中止的 `verify:ui` 可能留下 `node scripts/verify-ui.mjs` 程序佔住 5393 埠，下一次會 `EADDRINUSE`，先結束那個程序。③ 單元測試與 `verify:ui` 同時跑時，無頭 Chrome 可能 12 秒內起不來（9333 `ECONNREFUSED`），要依序跑。
  - **螺牙**：審查發現的問題已由 10-11 的 `d1dc276` 修掉，其後有標準螺紋規格庫（`c4de3ba`）與 `f832934`；這次沒有再動螺牙。
  - **待使用者決定**：客戶零件 `real-part1.json`、`real-part1-fixed.json`、`part1-demo.json` 仍在已推送的 `c7f46be` 歷史裡（私有倉庫）；要徹底清除需改寫歷史並強制推送，無法復原。
  - **下一步建議**：① 筆電 `git pull`；② 修上面 6 項 `verify:ui` 失敗（先修 `choose`，其餘先用 `--only <腳本>` 單獨重現、二分到是哪個提交造成）；③ 決定客戶零件歷史的處理。

- **【2026-10-17：未做/待裁選擇題重整、8 項裁定執行、B1 壓花/螺牙圓角修正；側邊欄 E1-P1＋工程圖 B2.3 在 worktree（`kernel.ts` 已還原並重寫、驗證通過）（Claude）】**
  - **已提交並推送**：`76c4081..2abdaf0`（3 個，含 B2.1 鎖定視圖）、`279b91a`（圓角結果過 `BRepCheck` 才收，不再回傳無效實體）、`6a56951`（文件）。目前 `main` = `origin/main` = `6a56951`，主資料夾工作樹乾淨（除了別的工作階段見下）。
  - **新增文件（`6a56951`）**：`docs/decisions-2026-10-19.html`（8 題：A1／B1／B2／C1／D1／D2／E1／E2，全部採建議）、`docs/verify-user-list.html`（20 項「使用者必做」實機驗證清單，取自 `manual-verification.html` 的 `data-auto=user/part`）、`docs/sidebar-parity-plan.md`（E1 側邊欄比照 ADR 0133 的範圍與方案）。
  - **裁定執行**：**A1** 已推送；**B1** 重現壓花/螺牙波浪邊下圓角——**沒有 WASM 崩潰**，而是 `Kernel.fillet` 只檢查 `mk.IsDone()`、缺 `BRepCheck`，**靜默回傳無效實體**；已加合格檢查、`feature.filletInvalid` i18n（中/英）、`tests/phase3/knurl.test.ts` 回歸（67 過，含反向對照）；**B2** 已於 Chrome 開 `3DB實機確認/輸出/基板加工圖.pdf` 供三項目視檢查；**D1** 查證 C22（`482a816`）、E4（`fa807bb`）早已修正、無需再改；**D2** ADR 0145 三項以清單為準、無需再改；**E2** 視角方塊不動。
  - **E1 方向（使用者 2026-10-19 裁定）**：指令維持在側邊欄；組合件只換外框成兩分頁、6 個模式面板維持浮動；先零件（P1）通過驗證再做組合件。
  - **worktree**：`D:\Self-developed_Apps\G3\3DB-sidebar-parity`（分支 `worktree-sidebar-parity`）。**E1-P1 與 B2.3–B2.7（斷裂視圖、裁剪視圖、輔助視圖）皆已提交並推送**（`4ba2765` E1-P1、`2130f85` B2.3、`dd17e91` B2.4、`18e24a3` B2.5、`d2fb890` B2.6、`19840f1` B2.7 斷裂視圖、`dc0945d` B2.7 裁剪視圖、`7118420` B2.7 輔助視圖、`1fdaa91` 修裁剪視圖縮放、`432bb1f` B2.8 多圖頁（shape 1）、`6831a44` E1-P2 側邊欄兩分頁、`db7432b` E1-P2 補完（組合件樹搜尋列）；`origin/worktree-sidebar-parity` = `db7432b`）。
  - **✅ B2.3 相切邊：已還原並重寫完成（2026-10-19）**。先前 worktree 的 `packages/kernel/src/kernel.ts` 曾被截斷成 2669 行（`projectView` 之後全失，含 `sectionView`）；已 `git checkout --` 還原為 HEAD 的 4540 行，再乾淨重寫（**未使用 `as any` 等型別抑制**）。做法：`Kernel.projectView` 把 HLR 的 `Rg1LineVCompound`／`Rg1LineHCompound`（相切邊，**含隱藏者**）自 `visible`／`hidden` 移出，放進新的 `ProjectedView.tangent`（僅非空時附上）；`ViewLines.tangent` 承接（detail 視圖會裁圓）；`scene.ts` 以細線繪製（塗彩視圖不畫）；`ViewCommon.showTangentEdges?`＋`ViewPatch`＋`mutateDrawing` 分支（修正前一版的 broken `else if` 鏈）；`DrawingPanel.tsx` 勾選框。
  - **決定修訂（2026-10-19，使用者裁定）**：相切邊**預設改為繪製**（`showTangentEdges` 缺省＝畫，即變更前的行為；設 `false` 才不畫），以滿足「現有圖完全不變」。此**推翻**先前的「缺省＝不畫」（本檔第 13 行第 3 項）。唯一副作用：原本混在 `hidden` 的隱藏相切邊，由「虛線」改為「細實線」。
  - **驗證（worktree）**：`npm run typecheck` = 0；`lint:rules`／`lint:deps`／`lint:i18n` 全過；新測試 `tests/phase5/drawing-tangent-edges.test.ts` **7/7**（實體真值：有圓角的板有相切邊、純方塊沒有、且不與 `visible` 重複）；`tests/phase5` 全套 **43 檔、454 過、1 略過、0 失敗**（塗彩記憶體量測 56.38 MiB／對照 366.31 MiB 與 §3.5 基準一致，未新增洩漏）；受影響的 phase3／4b／7／8 檔 **52 過**。
  - **主資料夾未提交**：另一工作階段的 **B2.2 隱藏個別的邊**（9 個檔案），使主資料夾 `npm run typecheck` 在 `apps/web/src/components/DrawingViewport.tsx` 的 `hideEdge`（448／642／1038）紅燈；非本工作階段造成、**未動**。（worktree 不含 B2.2，故其上列驗證不受此影響。）
  - **已知測試問題**：worktree 的 `npm run verify:ui` 曾在 25 分鐘逾時；`manual-drawing-title-style.js` 單獨跑即失敗（既存、與本次無關，待乾淨 worktree 重現確認）。原暫存腳本 `fix_drawing.ts` 已移出 worktree 至 `C:\Users\3kids\AppData\Local\Temp\opencode\fix_drawing.scratch.ts`（未刪除）。
  - **✅ B2.4／B2.5／B2.6 已完成並推送（2026-10-19，Claude）**：
    - **B2.4（`dd17e91`）尺寸公差子選單**：尺寸右鍵只加「公差」子選單（無／上下限／MAX／MIN／配合），沿用既有 `DimensionTolerance` 格式、不改檔案格式；「反轉箭頭」依裁定不做。新增 `packages/drawing/src/dimension.ts` 的 `toleranceForChoice`／`fitAllowed`（角度與座標尺寸**在模型層**拒絕配合＝真值）。子選單**內嵌**而非飛出（`.context-menu` 有 `overflow-y:auto`，飛出會被裁掉）。測試 `tests/phase5/drawing-menu-tolerance.test.ts` 5/5（含模型拒絕訊息真值）。
    - **B2.5（`18e24a3`）自動排列納入座標尺寸**：`arrange.ts` 新增 `way`／`span`；座標尺寸與線性尺寸依「視圖｜方向｜邊」同組往外排、步距一致不互蓋；對正（aligned）不排；座標尺寸只改 `offset`（模型拒絕無關的 `slide`）。其餘尺寸種類行為不變。測試 `tests/phase5/drawing-arrange.test.ts` 4/4（含 25 組種子固定隨機）。
    - **B2.6（`d2fb890`）四項全部**：① 組合件「正視於」在**選整個零組件**時看向該零組件自己的前基準面（`assembly.ts` `normalFrame`，含它的位姿；空選＝維持等角視圖）；② 工程圖頂端新增「工具」頁籤（選項／快速鍵），快速鍵清單取自 `ACTIONS` 的 drawing 群組（與快速鍵對話框同一份登錄檔，所見即生效）；③ 孔表與零件表有自己的右鍵選單（零件表多「氣球」兩項，皆用既有指令）；④ 剖面「依數值」新增角度欄位（0° 走原本路徑＝零回歸，非 0° 以 `lineAcrossBox` 建旋轉割線）。
    - **驗證（worktree）**：`npm run typecheck` = 0；`lint:rules`／`lint:deps`／`lint:i18n` 全過（B2.6 期間一處 i18n 違規已修：**JSX 註解 `{/* 工具 … */}` 內的中文被 ratchet 計為內文**，因它不以 `/*` 開頭；改為英文即可）；全部單元測試 **232 檔、2926 過、25 略過、0 失敗**（此為新增下列 phase8 測試之前的一次全量）；`tests/phase5`＋`tests/phase8` **66 檔、1115 過、1 略過**。
    - **B2.6 的組合件個案（尚缺視覺確認）**：另加 `tests/phase8/asm-view-normal-filter.test.ts` 邊界測試（選零組件的路徑不得回**組合件自己**的基準面、已選的基準面優先）與 e2e `manual-asm-view-normal.js` 第 10 步（以模型算出的「該零組件前基準面」比對相機方向）。該腳本屬**手動**驗收，**待 `verify:ui`／實機跑過才算視覺確認**。
    - **✅ B2.7 斷裂視圖：已完成並推送（`19840f1`，2026-10-19）**——D-I6 三種視圖的第一種（使用者裁定：三種全做、逐一提交，並**先升 Schema v21 → v22**）。**不是新的視圖種類，而是擺放方式的分段映射**：`ViewCommon.break?: { axis: 'x'|'y'; from; to; gap? }`（`BREAK_GAP = 2`），`layout.ts` 以純函式 `brokenAt`／`unbrokenAt` 讓 `toSheet`／`fromSheet` 分段，**圖上長度 = 模型長度 −（to − from）+ gap**。因為每個視圖的每個項目都經過 `toSheet`，線／剖面線／尺寸／註記／表格／氣球**自動一起跟隨**，沒有第二套座標。跨越帶的線以新的 `geometry.ts` `clipToBand` 在帶的兩端精確切斷（不橫跨缺口）；帶的兩端各畫一條細**斷裂線**（之字，ISO 128-30）。`checkBreak` 在命令層當場拒絕非 x/y、`to ≤ from`、NaN／Infinity、`gap < 0`（顯式錯誤，不夾取、不四捨五入）。**紅隊防呆**：尺寸數值取自 `elements`（`own` 只管畫在哪），且帶外 `fromSheet(toSheet(v)) = v` 精確成立，測試直接鎖定「**圖上是 32、模型是 40**」。**Schema 21 → 22**（遷移空轉、舊程式拒開新檔），並同步 `drawing-local-section.test.ts`／`drawing-linked.test.ts` 的版本斷言。介面：視圖屬性多一列（方向／從／到／缺口）＋「斷裂視圖」「取消斷裂」兩個按鈕。ADR [0151](docs/adr/0151-drawing-break-view.md)。
    - **B2.7 驗證（worktree）**：`npm run typecheck` = 0；`lint:rules`／`lint:deps`／`lint:i18n` 全過；新測試 `tests/phase5/drawing-break-view.test.ts` **15/15**（含存檔讀回、v21→v22 升級、切斷座標 84／94／96／116、斷裂線、塗彩降級）；全量 vitest **233 檔、2942 過、25 略過、0 失敗**。**未執行**：`verify:ui`（本機逾時，與 B2.6 相同）→ 斷裂的**介面操作未經瀏覽器驗證**。
    - **B2.7 已知限制（明示，非默默降級）**：斷裂視圖**不塗彩**（塗彩是整張零件的一張圖，`SceneImage` 只有一個圓形裁切欄位、無法沿帶切開；照舊以壓縮後外框貼圖會得到變形的錯圖，故 `viewImage` 回 `null`）；每個視圖只有**一個**斷裂帶；帶內座標吸附到帶的近端。
    - **✅ B2.7 裁剪視圖：已完成並推送（`dc0945d`，2026-10-19）**——D-I6 三種視圖的第二種。**新的視圖種類 `crop`**：`CropDrawingView { kind: 'crop'; parent: Id; outline: ClosedOutline }`，其中 `ClosedOutline`（矩形／圓／封閉多邊形）自局部剖視的輪廓**抽出共用**（兩者驗證共用 `checkOutline`）。**母視圖必須是局部剖視圖**（紅隊：`checkView` 的 crop 分支要求 `parent.kind === 'sectionLocal'`，否則命令層拋 `drawing.cropNeedsLocalSection`；母視圖根本不存在則由既有的 `drawing.noParent` 先攔截）。**不切任何東西**：`resolveLines` 的 crop 分支把母視圖**已解析的線**（visible／hidden／cut／center／tangent）以新的 `geometry.ts` `clipToOutline` 裁到輪廓內、`box` 取 `outlineBox(輪廓)`，故**視圖大小＝輪廓大小**（與母視圖多大無關），而母視圖的剖切面帶過來，所以裁剪視圖內**照樣畫剖面線**。比例沿用母視圖（`scaleOf` 加 `crop` 分支），擺放與母視圖對齊（`sideOf` 回 `'right'`、走 `section` 那條 `spot` 分支，**非** detail 的齊平規則）。**不塗彩**（`viewImage` 對 crop 回 `null`，且 `resolveLines` 不把母視圖的 `shade` 帶過來）。`scene.ts` 新增 `cropItems` 在**母視圖上**以細封閉折線畫輪廓；局部剖視的輪廓繪製改為共用 `outlinePoints`（兩者同源）。介面：工具列加「裁剪視圖」鈕（`drawingUi.toolCrop`），在局部剖視圖上拖矩形→移動預覽→點一下放置（`Drag`／`DrawPlacement` 各加 `crop` 分支、`addCrop`），母視圖不對時即時提示 `drawingUi.hint.cropParent`（命令層仍是最終防線）。**Schema 22 → 23**（遷移空轉、舊程式拒開新檔），並同步三處版本斷言測試為 23。ADR [0152](docs/adr/0152-drawing-crop-view.md)。
    - **裁剪視圖驗證（worktree）**：`npm run typecheck` = 0；`lint:rules`／`lint:deps`／`lint:i18n` 全過；新測試 `tests/phase5/drawing-crop-view.test.ts` **16/16**（含母視圖限局部剖的三類拒絕、輪廓裁切 y=5 線 0…40 → 0…20、外框＝輪廓、比例 1:2 → 圖上 10×10、塗彩對照組（同一組線在 section 上有圖／在 crop 上為 null）、剖切面帶過來會加剖面線、buildScene 細封閉折線比對照組多 1 條、v22→v23 升級）；`tests/phase5` **46 檔、491 過、1 略過、0 失敗**；全量 vitest **234 檔、2958 過、25 略過、0 失敗**。**未執行**：`verify:ui`（本機逾時）→ 裁剪的**介面操作未經瀏覽器驗證**。
    - **裁剪視圖已知限制**：不塗彩；母視圖**只能是局部剖視圖**（不能裁一般視圖或一般剖視圖，規格如此）；裁剪視圖不能再被裁剪、也不能當其他衍生視圖的母視圖；介面目前只提供**矩形**拖曳（圓／多邊形的輪廓在模型層與繪製層已支援、未接工具列）；無自己的標題字母（僅以視圖名稱標示）。
    - **✅ B2.7 輔助視圖：已完成並推送（`7118420`，2026-10-19）**——D-I6 三種視圖的**第三種（最後一種）**，採使用者 2026-10-19 裁定的**補助線法**（在母視圖上任意畫一條補助線／折線、垂直於它投影，**不依賴具名邊參考**；與 gap-plan 原先「以具名邊當參考」的設想不同）。**新的視圖種類 `auxiliary`**：`AuxiliaryDrawingView { kind: 'auxiliary'; parent: Id; line: [[number,number],[number,number]]; flip?: boolean; label: string }`。**看的方向由折線決定**：`axesOf` 的 auxiliary 分支回 `sectionLookAxes(base, view)`（與剖視圖「看」同一條規則、**只差沒有剖切**）；折線以母視圖框架定出（`rightOf`／`sheetUp`），前視圖上**垂直**折線 → 看 ±X、**水平**折線 → 看 ±Y、`flip` 反轉。**不切任何東西**（`sectionCut` 對 auxiliary 拋 `notForKind`；app 層 `requestOf` 只在 section／sectionLocal 產生 cut），故它是純投影、**可塗彩**（`viewImage` 只排除 crop 與 break）。**擺放與比例比照剖視圖**：`sideOf` 回 `sectionSide(sectionArrow(v), projection)`（第三角置於箭頭背向側）、`scaleOf`／`scaleTarget` 沿用母視圖比例。**繪製共用剖視圖的 `sectionItems`**（參數放寬為 `Pick<SectionDrawingView,'line'|'label'|'flip'>`）：在母視圖上畫折線（centre 線型）、兩端各一箭頭與字母，視圖下方畫標題 `{A}-{A}`（比照局部剖視）；視圖 `name` 不畫（ISO 128-30 以字母命名）。介面：工具列加「輔助視圖」鈕（`drawingUi.toolAuxiliary`），在任一視圖拖曳出補助線（`lineAcrossBox` 橫貫整個視圖、拖曳方向決定角度）→ 移動預覽 → 點一下放置（`addAuxiliary`）；`Drag`／`DrawPlacement` 各加分支，`sectionGhost` 泛化為 `lineGhost`（section／auxiliary 共用）。**紅隊修正（實作中發現的真缺陷）**：第一版把折線交給剖視圖的 `checkSectionLine`（**階梯剖面**驗證器），導致畫歪的補助線拋出「**階梯剖面**：…」——講的是**另一個特徵**（違反 AGENTS.md §2.1「顯式拋錯並說明原因」）；已改為自成一體的 `checkAuxiliaryFold`（恰兩點、有限數、不重合 → `drawing.badAuxiliaryLine`，訊息補上「點的座標要是數字，兩點不能重合」）。**Schema 23 → 24**（遷移空轉、舊程式拒開新檔），四處版本斷言（break／local-section／linked／crop）同步為 24。ADR [0153](docs/adr/0153-drawing-auxiliary-view.md)。
    - **輔助視圖驗證（worktree）**：`npm run typecheck` = 0；`lint:rules`／`lint:deps`／`lint:i18n` 全過；新測試 `tests/phase5/drawing-auxiliary-view.test.ts` **18/18**（**200 組隨機折線**驗證看的方向垂直於折線且落在母視圖平面內、方向實例、不剖切、折線三類拒絕、`setView` 欄位、母視圖鏈比例 1:2、存檔讀回、v23→v24 升級、擺放同高、`buildScene` 折線／字母／標題）；全量 vitest **235 檔、2975 過、25 略過、0 失敗**。**未執行**：`verify:ui`（本機逾時）→ 輔助視圖的**介面操作未經瀏覽器驗證**。
    - **輔助視圖已知限制**：折線必須是**單一直線（兩點）**（階梯／對正不支援）；**斜補助線的擺放**落於最近的一方側（與斜剖面同源，屬擺放美觀、非幾何錯誤——看方向本身精確）；補助線不吸附具名邊，故斜面上尺寸標註仍受既有 gap-plan:112 限制；另在紅隊掃描中一併發現並修掉一個既有缺陷（見下一條）。
    - **✅ 修 B2.7 裁剪視圖縮放（`1fdaa91`，2026-10-19）**：紅隊掃描發現 ADR 0152 的既有缺陷——`scaleOf` 對 `crop` 沿用母視圖比例，`scaleTarget` 卻回 `{ sheet: true }`，拖曳**裁剪視圖**的角落會改到**整張圖紙**的比例、而裁剪視圖本身畫在母視圖比例、不動。已把 `crop` 補進 `scaleTarget`（與 `scaleOf` **同進退**：母視圖有自設比例時，縮放裁剪視圖改的是母視圖的比例），`tests/phase5/drawing-crop-view.test.ts` 加 `scaleTarget` 測試鎖定；ADR 0152 決定 4 與 ADR 0153 已知限制同步更新。驗證：typecheck 0；`lint:rules`／`lint:deps`／`lint:i18n` 全過；全量 vitest **235 檔、2977 過、25 略過、0 失敗**。
  - **✅ B2.8 多圖頁（第一部分：資料模型＋遷移）已完成並推送（`432bb1f`，2026-10-17，ADR [0154](docs/adr/0154-drawing-pages.md)）**——使用者裁定「先做資料模型＋遷移、UI 頁籤後做」。`DrawingDoc` 改為 `{ kind, schemaVersion, pages: DrawingPage[], properties, idCounters }`，`DrawingPage` 擁有 `id／name／sheet／title／views／dimensions／tables／surfaceFinishes／annotations`；**`properties` 與 `idCounters` 留在文件層**（跨頁共用自訂屬性、id 全文件唯一，否則兩頁可能出現同一個 view id）。**Schema 24 → 25，是本專案第一個結構性遷移**（此前 24 個都是加欄位或空轉）：`drawingMigrations[24]` 把根上的 `sheet`／`title`／`views`／… 收進 `pages[0]`，舊程式拒開新檔。新增存取函式 `page(doc, i=0)`／`withPage(doc, p)`／`drawingFromPage(p, props)`（命名避開 `measureView.ts:105` 既有的 `drawingOf`，否則 `export *` 會 TS2308）。**呼叫面壓到最小**：`buildScene`／`layoutViews`／`fitViews` **仍收 `DrawingDoc`**、函式內 `const pg = page(doc)`，故 Worker／`state/drawing.ts`／面板的呼叫點不必改簽名；只有幾個小 helper（`scaleOf`／`scaleTarget`／`resolveLines`／`sideOf`／`arrangementBase`／`slideAxis`）收窄為 `Pick<DrawingDoc,'pages'>`。`createEmptyDrawing()` 內容與變更前完全相同、只是收進一頁（`id: 'page1'`、A3 橫放 1:1 第一角）。`parseDrawing` 改驗 `raw.pages`（非空陣列、每頁 `sheet` 為物件）、逐頁補空清單、id 計數走**所有頁**。**UI 未動**（頁籤等屬 shape 2）。
  - **B2.8 紅隊與驗證抓到的三件事**：① **真缺陷**：`fit.ts` 的 `arrangedBox` 一度用 `page(doc).sheet`（含當前 `shift`）算框，使 `fitViews().shift` 多減一次當前位移（實測 `18.5 → −31.5`，差 50＝設定的 shift）；已改回以**未位移**頁面算框，`drawing-fit.test.ts` 三項測試鎖定。② **13 個測試的假舊檔被揪出**：它們以「把版本號改小」偽造舊檔，在加欄位式遷移下可行，但在**結構性**遷移下該檔已是 v25 形狀（有 `pages`、根上無 `sheet`），遷移 24 取不到 `sheet` → 檔被拒。判定為**測試在說謊**（真舊檔的 `sheet` 確在根上），新增 `tests/support/drawingVersion.ts` 的 `olderDrawingFile(doc, version)` 造**真**舊檔（只放該版本真有的清單：`dimensions` ≥3、`tables` ≥4、`surfaceFinishes` ≥10、`annotations` ≥12），13 個測試改用它、另 **7 處版本斷言 24 → 25**；此修法**加強**覆蓋（真的在驗 v25 遷移，而非讓假檔碰巧通過——AGENTS.md §2.4）。③ **codemod 兩次失手**：v1 盲目 `replaceAll` 誤改非 `DrawingDoc` 接收者（DXF `DxfDocument.tables`、`PlateDrawing`…）→ **全數 `git checkout -- tests` 還原**；v2 改由 typecheck 錯誤位置驅動（方向正確），但接收者左掃把 `)`／`...` 一起吞掉 → `page(.doc)`／`page(...doc)` 等 7 個語法錯誤，而語法錯誤會**抑制同檔的語意錯誤**；v3 加入**括號配對與引號跳脫**的左掃才一次到位（43 處呼叫運算式）。教訓：改大量呼叫端要由**編譯器位置**驅動，接收者解析必須涵蓋呼叫運算式／索引／擴展。
  - **B2.8 驗證（worktree）**：`npm run typecheck` = **0**；`lint:rules`（exit 0）／`lint:deps`（Layering OK）／`lint:i18n`（181 行，未逾基準）全過；`tests/phase5` **47/47 檔通過**；全量 vitest **239 檔（235 過／4 略）、2977 過／25 略、0 失敗**。**未執行** `verify:ui`（本次無新介面）。
  - **✅ E1-P2 側邊欄兩分頁與「切換只隱藏」契約已完成並推送（`6831a44`，2026-10-17，ADR [0155](docs/adr/0155-sidebar-tabs-hidden-contract.md)）**——E1-P1（`4ba2765`）已把零件／組合件外框換成可點的 `.sw-tabs`，但切換是**條件渲染**（會卸載另一頁），與計畫 §2.4「切換只用 `hidden`、所有 `data-field`／`data-action` 留在 DOM（129 支 e2e 不動的前提）」不符。本次把 `App.tsx` 的兩個 pane 都改成**無條件輸出、只加 `hidden`**：`<div className="sw-pane" hidden={panel !== 'tree'}>{assembly ? <AssemblyTree/> : <FeatureTree/>}</div>` 與 `<div className="sw-pane" hidden={panel !== 'properties'}>…</div>`；`.sw-panel [hidden] { display:none !important }`（`app.css`:669）確保生效。**組合件依使用者裁定只換外框**（計畫 §8.2：6 個模式面板維持浮動、內部一律不動，故**不**收斂成 PM 群組）；模式面板對工作階段狀態用**非空斷言**（`asm.mate!`…）**不能同時掛載**，故只掛當前那一個、切到樹頁時它仍在 DOM。另移除死 CSS `.panel-tabs`（`app.css` 舊 148–150 行，全 repo 已無引用）。**第一版漏做了「AssemblyTree 比照 FeatureTree」的搜尋列**（只交付外框），已補完為第二個提交 **`db7432b`**：`AssemblyTree` 補上與 `FeatureTree` 相同的 `div.tree-filter`（`.search-field` 搜尋框＋`tree.filterNone` 無結果提示），判定規則抽成**共用純模組** `apps/web/src/components/treeFilter.ts`（`treeNeedle`／`treeFilterMatches`；`FeatureTree` 原本自己的一份 `matches` 一併收斂過去），由 `tests/phase8/tree-filter.test.ts`（7 項）在 `node` 環境直接驗證——這正是原先「此邏輯無法單元測試」一說的反證；**未做**階層／平面檢視切換（`FeatureTree` 用它把草圖收進消耗它的特徵，組合件沒有這個概念，加了會是空轉控制項）。驗證：typecheck **0**；`lint:rules`／`lint:deps`／`lint:i18n`（181 行）全過；全量 vitest **240 檔（236 過／4 略）、0 失敗**。**未執行** `verify:ui`（逾時）→ 介面未經瀏覽器驗證。
  - **E1-P2 的已知差異（明示，非默默降級）**：① 組合件樹**仍缺** `FeatureTree` 的階層／平面檢視切換（搜尋列已於 `db7432b` 補上）——**刻意不做**：`treeMode` 只影響「草圖要不要收進消耗它的特徵」，組合件的零組件沒有這個概念，放一顆切換鈕只會是空轉控制項（AGENTS.md §3.2）。② PropertyManager 仍由「工作階段（editing）」驅動，**尚未**做到計畫 §2.2「點選圖面→自動切到屬性、依選取切換群組框」，屬後續。
  - **下一步**：① **B2.2（隱藏個別的邊）已完成收尾與全鏈路確效**（新測試 `tests/phase5/drawing-hide-edge.test.ts` 9/9 PASS、typecheck 0 錯誤、三項 lint 全綠、`tests/phase5` 43 檔 456 項全過），提交後進行雙分支合併；② **雙分支合併**：將主資料夾之 B2.2 與 `worktree-sidebar-parity` 分支合併，對齊 Schema 25 與 `DrawingDoc.pages` 資料結構；③ **B2.8 shape 2＝多圖頁 UI**（頁籤、新增／刪除頁、跨頁拖放、列印多頁）於合併後正式開工；④ B2.6／B2.7 與 E1-P1／E1-P2 介面變更待實機驗收。
---

## ⚡ 今日任務總結 (2026-10-12)

### 1. 線架構 (Wireframe) 剖面交線即時動態提取 (ADR 0042 / A4.3 / D4.4)
- **問題根因 (RCA)**：在開啟剖面 (Section Cut) 時，線架構模式僅渲染實體原始網格之特徵邊界 (B-Rep feature edges)；而剖面切過實體內部處並無原始特徵邊線，導致截面兩端懸空斷開，幾何輪廓完全失真。
- **解決方案**：
  - 在 [`packages/render/src/viewer.ts`](file:///e:/Self-developed_Apps/G3/3D-Builder/packages/render/src/viewer.ts) 實作 `sliceMeshByPlane(geometry, plane, matrixWorld?)`。
  - 對三角形各邊與剖切平面進行空間線段截交運算，萃取閉合截面線段。
  - 建立專屬 `sectionEdges: THREE.LineSegments`，賦予高對比實線材質，設定 `polygonOffset` 與 `renderOrder: 999` 根治切面 Stencil Cap 與交線的 Z-fighting。
  - 整合進 `Viewer` 生命週期（`setSection`, `applyDisplay`, `clear`, `paintEdges`）。
- **驗證成果**：[`tests/phase3/section-edges.test.ts`](file:///e:/Self-developed_Apps/G3/3D-Builder/tests/phase3/section-edges.test.ts) **5/5 PASS**（立方體截面 4 線段、傾斜 45° 截面、平移模型矩陣、空交集與生命週期更新皆精確驗證）。

### 2. 比照 SolidWorks 標準之曲面動態側影輪廓線 (View-Dependent Silhouette Edges)
- **問題根因 (RCA)**：圓柱面、圓錐面、球體等平滑解析曲面缺乏內部幾何銳邊，在線架構模式下只看得到頂底封閉圓環，缺乏外側母線（側影線），導致在 3D 視角下形體不可辨識。
- **解決方案**：
  - 在 [`packages/render/src/viewer.ts`](file:///e:/Self-developed_Apps/G3/3D-Builder/packages/render/src/viewer.ts) 實作 `buildSilhouetteIndex(geometry)` 與 `extractSilhouettes(index, pos, viewDir, matrixWorld?)`。
  - **空間量化 (Spatial Quantization)**：以 `Math.round(val * 1000)` 克服旋轉體在 UV 接縫處 ($u=0$ 與 $u=2\pi$) 頂點索引不同但座標重合導致被誤判為開放邊的缺陷。
  - **智慧特徵過濾**：排除內部共面三角形（`dot > 0.9999`）與銳角邊（`dot < 0.25`，銳角已由靜態 B-Rep 邊處理），專注於 $1^\circ \sim 75^\circ$ 平滑過渡面。
  - **視角動態判定**：依相機視線向量 $\mathbf{v}$ 與兩側三角面法向量判定跨零邊界 $(\mathbf{n}_A \cdot \mathbf{v}) \cdot (\mathbf{n}_B \cdot \mathbf{v}) \le 0$。
  - 於 `render()` 迴圈與相機旋轉聯動，並套用 `clippingPlanes`，使側影線在線架構與剖面開啟時皆可正確被裁切。
- **驗證成果**：[`tests/phase3/silhouettes.test.ts`](file:///e:/Self-developed_Apps/G3/3D-Builder/tests/phase3/silhouettes.test.ts) **4/4 PASS**（圓柱前後視角萃取側邊母線、俯視角排除母線、透視模型矩陣支援、與靜態邊互補）。

### 3. 全局質量守門驗收
- `npm run typecheck`：**0 錯誤**。
- `npm run lint:rules && npm run lint:deps && npm run lint:i18n`：**全數通過**。
- `acceptance.test.ts`：**8/8 PASS**，無任何 Regression。
- 開發日誌更新：[`DEV_LOG.md`](file:///e:/Self-developed_Apps/G3/3D-Builder/DEV_LOG.md)。

---

## 🚀 接棒指引：裝飾用公螺牙與母螺孔 (Cosmetic Threads, Blueprint C4.9 / ADR 0129)

> **致接手 Agent（Codex 或後續架構師）：**
> 本章節為延續未竟任務之完整技術規格、架構設計藍圖與防禦約束。請直接依此 SOP 推進落地。

### 1. 任務核心定位與價值
- **需求追溯**：`docs/blueprint.md` 之 `| C4.9 | 裝飾螺紋線 | | P2 |`。
- **與真實螺牙 (ADR 0123) 的關鍵差別**：
  - **真實螺牙 (ADR 0123)**：建立真實 3D 螺旋實體並與圓柱做布林運算（Fuse/Cut）。優點是 3D 列印與真實干涉檢驗需要；但計算極度沉重，且因 OCCT 內部處理 B-spline 面的已知限制，每次布林運算必定洩漏 ~10MB Emscripten WASM Heap（見 `AGENTS.md §3.5`）。
  - **裝飾螺紋線 (Cosmetic Threads, C4.9)**：**絕不做 3D 布林螺旋幾何**！它是機械 CAD（SolidWorks / Inventor）中 95% 場合使用的標準做法：僅在特徵樹登記裝飾資訊，於 3D 視圖渲染輕量化虛擬牙線/貼圖，並在 2D 工程圖中依照 ISO 標準繪製 3/4 圈細實線圓弧與孔標註。

### 2. 行業標準幾何規格 (SolidWorks Benchmark & ISO 6410)
接手 Agent 實作時必須符合以下規範，不可隨意創造非標樣式：
1. **公螺紋 (External Cosmetic Thread，在凸圓柱面上)**：
   - 圓柱外表面為「大徑 (Major Diameter)」，顯示為模型實體邊界。
   - 螺紋區間在 3D 視圖中呈現虛擬螺紋面（或半透明牙紋）；端面或剖面處呈現「小徑 (Minor Diameter)」之 **3/4 圈細線圓弧**。
   - 側視圖投影為兩條細實線（牙底線）。
2. **母螺孔 (Internal Cosmetic Thread，在圓柱孔內壁上)**：
   - 孔壁為「小徑 (Minor Diameter，即鑽孔底徑)」，顯示為實體邊界。
   - 孔口端面呈現「大徑 (Major Diameter)」之 **3/4 圈細實線圓弧**（開口朝向通常約在右上或第 1/4 象限開口）。
   - 側視圖投影為兩條虛線（牙頂線）。
3. **尺寸標準庫對齊**：
   - 直接引用現成之 [`packages/model/src/threadStandards.ts`](file:///e:/Self-developed_Apps/G3/3D-Builder/packages/model/src/threadStandards.ts)（42 種 ISO Metric / UNC 標準規格）。
   - 支援 `standardDesignation`（如 `"M8x1.25"`、`"1/4-20 UNC"`）與 `custom`（自訂大徑、小徑、螺距）。
4. **終止條件 (End Condition)**：
   - `blind`（給定深度）：深度 $L$，附帶可選的退刀槽或不完全牙長度。
   - `through`（完全貫穿）：螺紋長度自動匹配圓柱面或孔全長。

### 3. 全鏈路代碼架構接線清單 (Implementation Checklist)

#### Step 1: 建立 ADR 規格文件
- 建立 [`docs/adr/0129-cosmetic-threads.md`](file:///e:/Self-developed_Apps/G3/3D-Builder/docs/adr/0129-cosmetic-threads.md)。
- 明確聲明：需求追溯為藍圖 C4.9，與 ADR 0123（真實螺牙）互斥，不觸發布林求解器，0 WASM 記憶體負擔。

#### Step 2: 模型與命令層 (`@3db/model`)
- 檔案：[`packages/model/src/schema.ts`](file:///e:/Self-developed_Apps/G3/3D-Builder/packages/model/src/schema.ts)
  - 新增特徵定義 `CosmeticThreadFeature`：
    ```typescript
    export interface CosmeticThreadFeature {
      kind: 'cosmeticThread';
      id: Id;
      name: string;
      suppressed?: boolean;
      targetFace: Id;          // 圓柱外表面 (公) 或孔內表面 (母)
      startRef: Id;           // 起始端面或環狀邊
      threadType: 'external' | 'internal';
      standardMode: 'standard' | 'custom';
      standardDesignation?: string; // e.g. "M8x1.25"
      majorDiameter: number;   // 大徑 (mm)
      minorDiameter: number;   // 小徑 (mm)
      pitch: number;           // 螺距 (mm)
      endCondition: 'blind' | 'through';
      depth: number;           // 螺紋深度
    }
    ```
- 檔案：[`packages/model/src/commands.ts`](file:///e:/Self-developed_Apps/G3/3D-Builder/packages/model/src/commands.ts)
  - 新增 `addCosmeticThread` 與 `setCosmeticThread` 命令。
  - 補齊 DAG 依賴收集（`targetFace`、`startRef` 遺失時標記黃色警告）。

#### Step 3: 再生引擎層 (`@3db/regen`)
- 檔案：[`packages/regen/src/engine.ts`](file:///e:/Self-developed_Apps/G3/3D-Builder/packages/regen/src/engine.ts)
  - 遇到 `cosmeticThread` 特徵時：
    - **禁止**調用 `Kernel.thread` 或布林運算！
    - 透過幾何探針萃取 `targetFace` 的圓柱半徑 $R$、軸心直線 $\mathbf{L} = \mathbf{P} + t \mathbf{D}$、起始參考位置。
    - 驗證半徑是否與標準規格吻合（若外圓柱面半徑與規格大徑誤差過大，回報溫和警示但允許強制覆蓋）。
    - 產生純幾何中繼資料 `CosmeticThreadAnnotation`，掛載於 `ViewMesh.annotations` 或模型裝飾清單：
      ```typescript
      export interface CosmeticThreadAnnotation {
        featureId: Id;
        type: 'external' | 'internal';
        axisPoint: [number, number, number];
        axisDir: [number, number, number];
        majorRadius: number;
        minorRadius: number;
        startOffset: number;
        length: number;
      }
      ```

#### Step 4: 3D 檢視器渲染 (`@3db/render`)
- 檔案：[`packages/render/src/viewer.ts`](file:///e:/Self-developed_Apps/G3/3D-Builder/packages/render/src/viewer.ts)
  - 實作 `setCosmeticThreads(threads: CosmeticThreadAnnotation[])`：
  - 在圓柱面上繪製端部 3/4 圈細線圓弧（Dash/Thin line），線寬 1px，顏色依主題（淺色模式 `#4B5563`，深色模式 `#9CA3AF`）。
  - （選配）圓柱面貼上輕量化半透明螺紋程序紋理（Procedural Normal/Alpha Map Shader）。

#### Step 5: 2D 工程圖整合 (`@3db/drawing`)
- 檔案：[`packages/drawing/src/views.ts`](file:///e:/Self-developed_Apps/G3/3D-Builder/packages/drawing/src/views.ts) / [`packages/drawing/src/dimension.ts`](file:///e:/Self-developed_Apps/G3/3D-Builder/packages/drawing/src/dimension.ts)
  - 在生成正投影視圖時，偵測實體上的裝飾螺紋：
    - 端視圖（投影方向平行於螺紋軸線）：投影為同心圓，外圈或內圈繪製 3/4 圈細實線（ISO 6410 標準）。
    - 側視圖（投影方向垂直於螺紋軸線）：在牙頂或牙底位置繪製兩條平行細實線。
  - 智慧型尺寸標註（Hole Callout）：選取帶有裝飾母螺紋的孔時，自動帶出螺紋規格呼出（如 `M8x1.25 ↧ 15`，對齊 ADR 0101）。

#### Step 6: 前端 PropertyManager 面板 (`apps/web`)
- 檔案：[`apps/web/src/components/PropertyManager.tsx`](file:///e:/Self-developed_Apps/G3/3D-Builder/apps/web/src/components/PropertyManager.tsx)
  - 面板佈局：
    1. **圓柱面選取槽**（支援點選凸圓柱面或孔內壁，自動判定公/母螺牙）。
    2. **起始邊/面選取槽**。
    3. **標準牙型下拉選單**（列出 42 種 Metric/UNC 規格，引用 `threadStandards.ts`）。
    4. **終止條件與深度**（成形至完全貫穿 / 給定深度）。

---

## 🛡️ 紅隊防禦與硬約束審查 (AGENTS.md Compliance Checklist)

接手 Agent 在聲明完成前，必須強制逐項通過以下自檢：
1. **輸入破壞防呆 (AGENTS.md §2.1)**：
   - 選取平面、錐面、自由曲面時，必須直接拋出錯誤並拒絕建立，不可默默退化。
   - 深度傳入 $\le 0$、`NaN`、極端數值時，立即攔截。
   - 深度大於圓柱長度時，明確提示但不崩潰。
2. **零代理指標原則 (AGENTS.md §3.1)**：
   - 測試記憶體指標時，若有調用底層，強制使用 `(oc as any).wasmMemory?.buffer?.byteLength` 且斷言 `initial > 0`。
   - 裝飾螺紋因為不調用 OCCT 實體布林，其記憶體成長應為 **0.00 MiB**，此點亦應在單元測試中被證實！
3. **禁止防禦性空轉閘控 (AGENTS.md §3.2)**：
   - 新增的裝飾線參數不可只留在 Schema 或未接線的 UI 中，全鏈路（Schema -> DAG -> Regen -> Render -> Drawing -> UI）必須 100% 打通。
4. **驗收測試門檻**：
   - 撰寫單元測試覆蓋公/母螺牙幾何推導、標準規格對齊、工程圖 3/4 圓弧投影產出。
   - `npm run check` 與 `npm run typecheck` 保持 0 報錯。

---

- 最後更新：2026-10-12（**借鑑 FreeCAD 深度對比分析、SSOT/MECE「小而精」架構優化方案、實機零件 `零件1.3dbx` 凸耳圓角 45° 方案 1 根治、底層 BRepCheck 破面剛性防禦與 UI 預防機制**）。
- **【2026-10-12：借鑑 FreeCAD 深度對照、SSOT/MECE「小而精」架構優化與破面預防機制落實】**
  - **核心哲學（使用者指示）**：本專案堅持「小而精、小而巧、極致實用」，反對 FreeCAD 介面過載、入口多頭、臃腫繁複的毛病。秉持 **SSOT (單一真值來源)** 與 **MECE (相互獨立、完全窮盡)** 原則，以**最短路徑、最單純入口**達成目標，同時針對目前廣度、深度、彈性不夠的地方借鑑 FreeCAD 進行外科手術式完善。
  - **FreeCAD 深度對比與「小而精」優化架構方案**：
    1. **旋轉特徵起始方位（Phase / Seam Angle）**：借鑑 FreeCAD AttachmentOffset 但避免其深奧選單，直接在旋轉特徵 PropertyManager 提供單一「起始相位角 (預設 0°)」，遇接縫衝突時直接輸入角度即旋轉接縫線，1 步完成，免手動建基準面。
    2. **零破面剛性防禦 (Hard BRepCheck Defense)**：底層 `Kernel.fillet` 強制執行 `BRepCheck_Analyzer` 確效；檢測到 `badFaces > 0` 立即拒絕，杜絕「表面看起來成功、模型實已破損」的隱性假綠。
    3. **圓角面板精準防呆引導**：當遭遇接縫衝突時，UI 明確指出接縫衝突根因並引導旋轉 45° 或草圖 2D 倒圓，二分搜尋僅在完全無破面區間尋找最大無損半徑。
    4. **基準幾何單一入口自動推斷**：統整為單一參考幾何入口，依點選對象（面/軸/圓柱）自動推斷偏移、角度或相切，消除選擇性障礙。
    5. **智慧幾何健康檢查 (Smart Health Inspector)**：幾何破損時特徵樹醒目標示、3D 畫布以警示色高亮破面輪廓，提供一鍵處方指引。
  - **實機零件 1（C3C6 檢具）驗證**：
    - `D:\3DB實機確認\C3C6檢具\零件1.3dbx` 完整 24 特徵重建通過（`tests/test-full-real-part1.test.ts`），基準模型無錯誤。
    - 45° 方案 1 實機量測：旋轉基準面轉移至 45° 避開接縫後，凸耳 4 條豎直邊均可完美施作 0.3 mm 圓角，體積 149.705 mm³，0 破面、0 變異。
- **【2026-10-11：螺牙特徵第二階段（D1: T-6 至 T-8）全套落實、審查校正與桌面版 0.2.2】**
  - **T-6 標準螺牙庫與 60° 基本牙型幾何推導器 (`@3db/model`)**：
    - 內建 42 種標準規格（公制粗牙 M2~M30、公制細牙 M8x1.0~M24x2.0、美制粗牙 UNC #4-40~3/4-10、美制細牙 UNF #10-32~1/2-20）。
    - 嚴格依 ISO 68-1 幾何解析推導 60° 牙型（牙側角 30.000°），支援外螺紋切除、外螺紋長出、內螺紋切除；平行外延區間 Margin 在數學上保證軸向跨度 $zMax - zMin < P$；校正註解與測試（牙頂槽寬 0.875P、牙根寬度 P/6）（`threadStandards.test.ts` 10/10 PASS）。
  - **T-7 核心兩端漸縮收尾演算法 (`@3db/kernel`)**：
    - `Kernel.thread` 實作旋轉包絡實體（Revolved Tapered Envelope Solid）裁剪，使牙高在端點平滑收攏歸零淡入淡出，消除 90° 刃口階梯（`thread-fade.test.ts` 4/4 PASS）。
  - **T-8 特徵與前端整合 (`@3db/regen`, `PropertyManager.tsx`)**：
    - Schema 擴充 `profileMode?: 'standard' | 'custom'`、`standardDesignation`、`standardTarget`、`fadeTurnsIn/Out`；標準模式免手繪草圖。
    - `engine.ts` 支援圓柱面端點邊界自適應對齊切入；`commands.ts` 補齊 `setThread` 分支。
    - `PropertyManager.tsx` 完整提供規格模式切換、標準下拉選單與漸縮圈數輸入。
    - 端到端整合與自我紅隊測試全過（`thread-standard-feature.test.ts` 7/7 PASS；STEP 往返體積偏差 $< 10^{-4}$）。
  - **全套螺牙測試狀態**：7 套件 61/61 PASS（`threadStandards` 10、`thread-fade` 4、`thread-ui` 4、`thread-feature` 7、`thread-standard-feature` 7、`thread` 24、`thread-fuzz` 5，含 200 組 Fuzz 壓力測試 0 崩潰）。
  - **審查深度校正（Workbuddy Audit CAPA）**：
    1. A1 自適應高精度 `massProps` 預設開啟（`adaptive ?? true`），`kernel.test.ts` 補齊螺牙真實曲面自適應高精度對照測試。
    2. A2 `direct-edit.test.ts` 改用真實 Emscripten WASM Heap `wasmMemory.buffer.byteLength` 並強制基準值 `> 0` 防呆，消除恆真式假綠。
    3. `AGENTS.md` 寫入「真值存在性防呆」與「禁止防禦性空轉閘控」自我演化準則。
  - **全域 RSI 自回歸進化系統落成**：於 `C:/Users/3kids/.gemini/config/rsi` 建立跨專案的四大元模組（活躍卡片庫、結晶退休庫、睡眠壓縮器、動態反饋器），並在本專案接入 `scripts/check-anti-patterns.mjs`（`npm run lint:rules`），實現 100% 物理剛性防禦。
  - **桌面版升級 0.2.2**：已重新建置產出最新可執行檔 `apps/desktop/src-tauri/target/release/desktop.exe`（13.15 MB）與 NSIS 安裝包 `apps/desktop/src-tauri/target/release/bundle/nsis/3D-Builder_0.2.2_x64-setup.exe`（11.32 MB，2026/10/11 12:01:10），完整內嵌最新 42 種規格庫、漸縮淡入淡出核心與自適應質量特性。
- **【2026-10-11：落實選擇題決策 A1~A3、B1~B2，說明系統更新與桌面版 0.2.1 打包】**
  - **使用者裁決結果落實（全部採用架構師建議）**：
    1. **A1 質量特性自適應高精度**：`hasComplexSurfaces` 偵測 B-spline/螺牙/自由曲面自動切換至 `eps: 1e-6`，初等幾何維持快速積分與手算基準吻合（`kernel.test.ts` 10/10 PASS）。
    2. **A2 moveFace 記憶體重構**：`insidePoint` 面分類器及時 `delete()` 釋放，`direct-edit.test.ts` 加入真實 WASM Heap（`HEAPU8.byteLength`）守恆驗證（20 次重建 0 洩漏）。
    3. **A3 效能計時門檻隔離**：建立獨立腳本 `scripts/check-perf.mjs`（`npm run check:perf`），常態跑測與計時解耦，杜絕平行負載誤報。
    4. **B1 說明系統 10 大主題更新與 SW 2010 繁中對照**：完成量測、螺牙、鈑金邊線凸緣/離隙/封閉角落/斷開角落、工程圖標註/剖面拖曳/號球之繁中對照（`help.test.ts` 40/40 PASS）。
    5. **B2 桌面版 0.2.1 打包**：升級版本號至 0.2.1，產出 `apps/desktop/src-tauri/target/release/bundle/nsis/3D-Builder_0.2.1_x64-setup.exe`（11.32 MiB）。
    6. **C1/C2/D1 確認**：孔標註維持現有用語；外部程式檢視等使用者有空再測；下一階段啟動「螺牙特徵第二階段（Metric / UNC 標準規格牙庫、直徑規格下拉選單與兩端漸縮收尾）」。
- **【2026-10-11：螺牙（真實螺紋實體）— 經 Claude Code 嚴格審查與全面確效修復（T-1 至 T-5 全數真實驗證通過）】**
  - **需求（使用者）**：要能建出真的螺牙實體（3D 列印、STEP、工程圖剖面），參數要有彈性；第一個驗收對象是 ISO 80369-7 參考件（兩個零件：中間有中心孔的錐形體＝只用旋轉與圓角；外面有內螺紋的鎖緊環＝要新功能，右旋、雙線、自訂牙型，Ø8／Ø7.2、螺距 2.5、導程 5、非對稱 30° 牙側）。使用者指正：**公差不影響建模**（工程圖要能標對稱、單向、不對稱公差：`DimensionTolerance` 的 `upper`／`lower` 已支援，T-4 用此圖驗證），**螺距、導程等都是參數**，不要再問。
  - **計畫與驗收**：[docs/thread-plan.md](docs/thread-plan.md)（T-1 核心、T-2 特徵與再生、T-3 介面、T-4 參考件與工程圖、T-5 鞏固）。
  - **Claude Code 審查揪出的問題與矯正確效（CAPA 全部根治）**：
    1. **多線牙型重疊導致 WASM 崩潰根治**：當牙型寬度 $\ge$ 單線螺距時（相鄰牙在空間中重疊），過往使用 `Fuse` 每次消耗 100~250 MB 記憶體不釋放且致崩潰。修復：核心在 `kernel.ts` 嚴格限制 `zMax - zMin < pitch`，超出時明確拋出 `feature.threadProfileTooWide`；多線各 start 彼此不接觸，改用 `TopoDS_Compound` 組合，彻底杜絕記憶體洩漏與崩潰。
    2. **軸線支援草圖中心線**：草圖中心線作為軸（`axis: Id`）支援，在 `schema.ts`、`commands.ts`、`refs.ts`、`dag.ts`、`engine.ts` 與 `PropertyManager.tsx` 完整打通，整合測試不再報「遺失參考」。
    3. **線數整數校驗**：輸入 1.5 條線保留原值傳入核心，直接拒絕並說明原因（`feature.threadBadStarts`），不再默默取整為 2。
    4. **ISO 80369-7 參考件真實 6.00% 錐度與實體量測**：
       - 公錐體：修正為真正 6.00% 錐度（$(4.315 - 4.021) / (5.65 - 0.75) = 0.060$），頂端 $y=7.5$（$r=1.9880$）、底端 $y=0$（$r=2.2130$），頂端外緣實作真實 0.2 mm 圓角特徵（`fl_tip`）。
       - 鎖緊環：內螺紋從入口 $y=8.0$ 切入至 $y=1.0$ 退刀槽，切入入口倒角；探針容差收緊至 $\le 0.005$ mm（實測 $\pm 0.003$ mm 通過）；以實體探針直接量測 3D 實體齒形牙側角（30.000°）。
       - 工程圖：剖面視圖呈現鋸齒齒形；標註元素 100% 透過 `elementFacts` 從實際實體動態解析（無 mock 假資料）；對稱（±0.025）、單向（0/-0.005）、不對稱（+0.001/-0.004）極限公差 DXF/PDF 輸出驗證全過。
    5. **Fuzz 隨機測試改寫與全過**：200 組隨機幾何參數測試（`thread-fuzz.test.ts`）0 崩潰，100+ 組生成有效實體，極限自相交幾何精準防禦性攔截。
  - **全套確效狀態**：
    - `tests/phase3/thread.test.ts`（24/24 PASS）
    - `tests/phase3/thread-feature.test.ts`（7/7 PASS）
    - `tests/phase3/thread-ui.test.ts`（4/4 PASS）
    - `tests/phase3/iso-80369-7-thread.test.ts`（7/7 PASS）
    - `tests/phase3/thread-fuzz.test.ts`（5/5 PASS，含 200 組 Fuzz）
    - `manual-thread.js`（無頭瀏覽器 UI 重播 1/1 PASS，11.1s）
    - `npm run check:perf`（PASS）
    - `npm run typecheck`（0 錯誤）、`npm run lint:deps`（OK）、`npm run lint:i18n`（OK）。
- **【2026-10-09 深夜：圓角失敗的說明】** 使用者回報選一個面做圓角失敗（只顯示「圓角失敗」）。重現：孔離邊太近時，外緣與孔緣的圓角在中間的窄條互相重疊（窄條寬度要大於兩倍半徑，例如板 80×50、Ø24 孔、窄條 13，半徑 7 起失敗），核心拒絕。已改：`engine.ts` 的 `roundEdges` 在失敗時用折半法找出同樣的邊可用的最大半徑，訊息改成「半徑 X 對選到的邊太大…半徑 Y 以下可以」（`edit.filletTooBig`）；`fillet-by-face.test.ts` 加測試。**使用者那個零件（未存檔的「零件1」）的實際半徑與錯誤我沒看到，是依重現推論；若訊息不是這個原因，請貼「錯誤為何？」的內文。**
- **【2026-10-09 晚：使用者在選擇題頁面的決定（全部採用建議）與桌面版 0.2.0】** 桌面版版本升到 **0.2.0**（`tauri.conf.json`、`Cargo.toml`、`Cargo.lock`），安裝檔 `apps/desktop/src-tauri/target/release/bundle/nsis/3D-Builder_0.2.0_x64-setup.exe`（11.31 MiB，不在版本庫；含到 `291c0c7` 的程式；**說明視窗還是舊內容**；只看了建置輸出，沒有安裝或啟動過，**另一台電腦的安裝測試（ADR 0052 驗收第 3、7 項）由使用者找機會做並回報**）。決定：A1 版本號提交並推送（已做）；**A2 說明視窗內容更新、A2b 用 SW 2010 繁中線上說明對照：10/12 重置後做，範圍只有這輪動過、SW 有對應的約 10 個主題**（測量、工程圖標註與剖面、零件號球、鈑金離隙、凸緣、斷開角落、以曲面除料等；`https://help.solidworks.com/2010/chinese/SolidWorks/help_list.htm?id=0` 讀得到，內容頁在 `/2010/chinese/SolidWorks/sldworks/LegacyHelp/...`，頁面有 Cookie 橫幅，不必點；比較行為與名詞後用我們自己的話寫，不照抄；SW 2010 沒有的功能對照不到），改完再重建安裝檔（0.2.1）；A4 簽章與自動更新不做；A5 圖示維持暫用圖；B1 圓角導角其餘功能、B2 號球引線彎折不做，等回饋；B3 草圖吸附 S-5 結案（SW 說明沒寫那四件事，也沒有 SW）；B4 先不開新功能；**B5 平板型式 DXF 折彎註記上下顛倒：已修**（`flatDxf.ts`：沿折彎線的角度超過 90 度到 270 度時改從另一端讀，測試在 `flat-dxf.test.ts`）；B6 可製造性檢查先用預設比例；C1 繼續用公開樣本；C2 不評估 openswx 等工具；C3 死碼清理清單全部保留。手冊實機驗證仍擱置（先用目前結果，遇問題再回報）。
- **【最新存檔點 2026-10-11：目前主線 commit `c4de3ba`；桌面版 0.2.2 已建置】** 本輪工作已提交、推送並快轉合併到 GitHub `main`；完成項目：① 螺牙特徵第二階段（42 種 ISO Metric/UNC 標準規格庫、60° 牙型解析推導、兩端漸縮收尾 Revolved Tapered Envelope 消除 90° 刃口、PropertyManager 面板整合，Schema 53）；② 選擇題決策 A1~A3、B1~B2 全部落實（massProps 自適應高精度、moveFace 記憶體守恆、check:perf 計時隔離、說明系統 10 大主題繁中對照）；全套測試 52/52 全綠。桌面版版本號由 0.2.1 升至 0.2.2，並於 12:01:10 重新打包產出 `3D-Builder_0.2.2_x64-setup.exe`。
- **【歷史存檔點 2026-10-09：主線 commit `1a2dd3b`】** 本輪工作已提交、推送並快轉合併到 GitHub `main`；本機 `main` 與 `origin/main` 指向同一 commit。完成項目：① 鈑金「斷開角落」獨立特徵，支援凸緣自由端外角倒角／倒圓，折疊與平板型式一致（零件 Schema 51，ADR 0121）；② 曲面除料方向支援任意有限非零 XYZ 向量及保留方向前側／後側，舊平面參考相容（零件 Schema 52，ADR 0122）；③ 量測已保留項目可在同一文件工作階段中關閉／重開工具後保留，切換／載入文件時清除；頂點以 persistent name 跨再生追蹤，失效會提示；組合件可選各元件座標系並套用位姿／鏡射；④ 取得 OSF 公開樣本 6 個 GPL-3.0 STEP 與 3 個對應 SLDPRT，來源、雜湊、授權與測試資料記於 fixture README。拓樸追蹤目前僅支援具名頂點；圓心、中點、邊上及面上抓點仍存固定座標。
- **【歷史存檔點 2026-10-09：主線 commit `1a2dd3b`】** 本輪工作已提交、推送並快轉合併到 GitHub `main`；本機 `main` 與 `origin/main` 指向同一 commit。完成項目：① 鈑金「斷開角落」獨立特徵，支援凸緣自由端外角倒角／倒圓，折疊與平板型式一致（零件 Schema 51，ADR 0121）；② 曲面除料方向支援任意有限非零 XYZ 向量及保留方向前側／後側，舊平面參考相容（零件 Schema 52，ADR 0122）；③ 量測已保留項目可在同一文件工作階段中關閉／重開工具後保留，切換／載入文件時清除；頂點以 persistent name 跨再生追蹤，失效會提示；組合件可選各元件座標系並套用位姿／鏡射；④ 取得 OSF 公開樣本 6 個 GPL-3.0 STEP 與 3 個對應 SLDPRT，來源、雜湊、授權與測試資料記於 fixture README。拓樸追蹤目前僅支援具名頂點；圓心、中點、邊上及面上抓點仍存固定座標。
  驗證：`npm run verify:ui` **125/125 通過**；`npm run check` **183 個測試檔通過、3 個略過；2481 項通過、22 項略過**；`npm run build` 成功（Vite 有兩項警告）。選看過 D9 量測截圖；無頭 UI 使用合成指標事件，不等於實體滑鼠驗證。
  **下一步以實機／人工待辦為主：** I10 真人完成鈑金支架流程；F7、D9 用實體滑鼠檢查標註／剖面／量測標籤與抓點；D9 的 375／390／768 視口未驗（本機頁面被已保存的瀏覽器權限設定阻擋，未嘗試繞過）；F6 用外部程式開 PDF；F4／K2 確認公司孔標註用語；G5、I9 用其他 CAD／雷射軟體檢查（I9 已在 eDrawings 開過，沒有其他軟體可略過）；J 樣本已取得並完成 STEP 匯入測試，但 SolidWorks 特徵樹／分析／製造數據對照仍待可用環境；K 章標準與功能範圍待使用者決定；L 章含需許可的資料夾清理。號球引線彎折仍是選做。下面按 Phase 記載的清單含歷史描述，若與本存檔點衝突，以本段與 `docs/manual-verification.html`、`docs/verification-coverage.md` 為準。
  用量約定：session／weekly／overall 任一可用讀值達 97.5% 時更新本檔並推送。用量工具最新提供的是 Codex 30 日視窗 **98%（整數）**，session／weekly／overall 個別數值及小數讀值未提供；此讀值已超過 97.5% 更新門檻。工具回報此 30 日視窗於 2026-11-08 08:43:56 UTC 重置。先前記錄的 2026-10-12 09:00 UTC 是另一項重置時間，不能由目前可用量資料確認。
- **【存檔點 2026-10-09，每週用量 90% 時留的（使用者要求：session／weekly／overall 用到 97.5% 時要更新本檔）】** 使用者 10-09 說「先推送」，下面三個提交（加上本檔的這次更新）已推上 `origin/main`；`6514826`（手冊）、`3a242be`（剖面位置左鍵拖動、A1／D3／D8 記為通過）、`b4c4365`（工程圖標註／剖面線在圖上做、圖頁單位英寸、測量像 eDrawings、作者資訊；工作區當時乾淨）。推送前要跑的都已跑過：完整 `npm run verify:ui` **123 支全過、0 個失敗**（2026-10-09，在 `b4c4365` 上），`npm run check` 2448 項過。**【10-09 稍晚：測量第二段（點選位置、保留多筆、拖標籤、座標系）已做完並驗過】** `npm run check` 2461 項過；`manual-measure-view.js` 18 步在無頭瀏覽器 0 個主控台錯誤（先前的 NaN 錯誤是點選位置的挑選被當成「頂點 -1」去畫高亮，`Viewport.tsx`／`AssemblyViewport.tsx` 現在略過有 `point` 的選取）；相關瀏覽器腳本（measure、manual-d6、manual-asm、manual-drawing、phase5、manual-section）19 支全過。手冊 D9 與覆蓋表已補。座標系另有瀏覽器步驟 17b（`manual-measure-view.js` 19 步）。 改動：`Kernel.makeVertex`；`MeasureTarget.point`、`placePoint`、`measureTargets` 把點做成頂點；`packages/render/src/snap.ts`（`polylinesOf`、`middleOf`、`circleCentre`）與 `viewer.ts` 的 `snapAt`／`setSnapPicking`／`setSnapMarker`／`setMeasureLabelDrag`；`measureView.ts` 的 `MeasureFrame`、`MeasureContext`（座標系、標籤前綴、使用者偏移）、`components`；`store.ts` 的 `MeasureState.mode／saved／offsets`、`measurePickPlace`、`saveMeasure`、`removeSavedMeasure`、`moveMeasureLabel`、`clearAllMeasures`、`setMeasureMode`、`runMeasure` 連已保留的一起重算；`MeasurePanel` 的「選取：元素／點」、座標系下拉（只有零件的座標系統特徵，組合件只有世界）、「保留這筆」、已保留清單與複製全部。**限制**：保留的量測離開測量工具就沒了；點的位置存零件本地座標，零件重建後點不會跟著拓樸移動；座標系的選擇存 `3db-measure-options`。以下是當初的設計（供對照）：① 點任意位置量測——`Kernel.makeVertex(p)`（核心裡已有 `BRepBuilderAPI_MakeVertex`，加一個公開方法即可），`MeasureTarget` 加 `kind: 'point'` 與 `point`（顯示座標；組合件的點要存零件本地座標再乘姿態，免得零件移動後點留在原地），`measureTargets` 把點做成頂點形狀再用現成的精確 `kernel.distance`；視窗端用網格算吸附（頂點 10 px > 邊的中點（弧長中點）> 圓或弧的圓心（三點外接圓，且各點到心的距離相等才算）> 邊上最近點 > 面上射線命中點），`viewer` 發 `onSnapHover`／`onSnapPick`，懸停畫標記與種類標籤（端點、中點、圓心、邊上、面上）；面板加「選取：元素／點」。② 保留多筆——`measure.saved[]`（picks、report、offsets），模型變動時全部重算，面板列表可刪、複製全部，圖上全畫。③ 標籤可拖——`measureLabels` 開 `pointer-events`，拖動存畫面偏移（`offset` 已在 `MeasureGraphics.labels`），存在 saved／目前量測的 `offsets`。④ 座標系——`viewMeasure` 加 `frame`（原點與三軸），dX／dY／dZ 沿該座標系的軸，階梯線也沿它；面板列出零件的座標系統特徵（組合件只有世界座標）。每一項都要有單元測試（純計算部分）加 `manual-measure-view.js` 的步驟，手冊 D9 補寫。

- **2026-10-08：減少人工實機驗證（使用者要求「既然你能自動測試，就減少我的人工項目」）——已完成，等使用者看結果。**做法：`npm run verify:ui`（`scripts/verify-ui.mjs`，無頭 Chrome 跑 `tests/e2e/*.js`，`--shots <資料夾>` 存截圖、`--only <正規式>`）；手冊每項照步驟重播成 `tests/e2e/manual-<項目>.js`（共用 `manual-support.js`；組合件的用 `phase2-assembly.js` 的 `__ui2`）；我看截圖判斷「看畫面」。**覆蓋表、找到的缺陷、手冊要改的字都在 [docs/verification-coverage.md](docs/verification-coverage.md)**（先讀它）。手冊 [docs/manual-verification.html](docs/manual-verification.html) 已更新：56 項標「已自動重播驗過」並預設隱藏（上方篩選「需人工」是預設、「全部」可看全部），2 項（C17 要 eDrawings、F4 孔標註用語）有黃框寫明還剩什麼（**C17 的 eDrawings 開 STEP 看顏色，使用者 2026-10-08 實機確認通過**）。**工程圖視圖連動（使用者無意中發現，2026-10-08，未提交）**：三視圖原本是三個互不相干的視圖，拖一個其他不動、拖掉前視圖還會因排版基準換了而跳位，視圖也不能用滑鼠縮放。現在：圖紙檔 Schema 7（`sheet.shift`＝整組排版的位移、視圖的 `slide`＝沿對齊軸的位移，都可有可無，舊檔照開；`DRAWING_SCHEMA_VERSION` 7、migration 6→7 空轉）；`layout.ts` 的 `arrangementBase`／`slideAxis`／`scaleFromRatio`／`scaleTarget`；`DrawingViewport.tsx`：拖前視圖＝整組（shift）、拖其他三視圖＝只沿對齊軸（slide，距離可調）、Shift＝脫離對齊（at）、選取視圖右下角把手＝改比例（改它名下的比例：自己的、母視圖的或圖頁的，所以連動視圖一起縮放；吸附標準比例，否則 n:d 分數，如 6:5）；「自動排版」對前視圖是整組放回中央。**「最適比例」已把標註算進去（`packages/drawing/src/fit.ts` 的 `fitViews`：逐一試標準比例，量視圖加標註加中心記號與剖面字母的範圍，放得下才選；並算出整組要平移多少才在圖紙範圍正中，寫進 `sheet.shift`；只算沒有自己比例與位置的視圖；標註線離視圖的距離是圖紙上的固定毫米數，所以有標註時最適比例會比只看視圖框更小）**；**還沒做**：標準三視圖仍是三個獨立的 model 視圖（不是 SolidWorks 那種投影視圖），方向由視圖自己決定，改投影法（第一角／第三角）時位置會跟著換，這是刻意保留的。重播腳本 `manual-drawing-linked.js`，單元測試 `tests/phase5/drawing-linked.test.ts`；`npm run check` 通過 2387 項。****測量像 eDrawings、英制、作者資訊（2026-10-09，使用者要求，未提交）**：使用者貼 eDrawings 的測量畫面問能否比照；回答「畫在圖上」缺的只是繪製，資料已有；使用者要求按建議做，並說明「圖面標註有時用英制」。做了：`packages/model/src/units.ts`（`formatLength` 毫米／英寸／分數、`formatAngle`）；`measure.ts` 加 `relation`（平行／垂直／夾角）、`total`（|dx|+|dy|+|dz|）、`round`（圓、弧、圓柱、球的中心到中心與最大距離；軸要平行才有最大；kernel 回報圓心與軸）；`measureView.ts` 把報告變成「要畫的線與標籤」與「結果文字」（純函式，有測試）；`viewer.ts` 的 `setMeasureGraphics`（`LineSegments2` 粗線、點、標籤，標籤可有畫面偏移）；`MeasurePanel` 的單位、分數、分母、最近分數、角度單位、弧圓量法、結果與複製（選項存 `localStorage` 的 `3db-measure-options`）；工程圖圖頁新增 `sheet.unit`（Schema 8，`mm`／`in`，缺省毫米；尺寸數字、公差、孔註、孔表換成英寸，檔案與圖紙仍是毫米；公差欄用圖頁單位輸入）；**作者資訊「Created & Developed by Wesley Chang, Oct-2026. All Rights Reserved.」在狀態列右側（視窗寬度小於 1100 px 時隱藏）與說明視窗底部**（`apps/web/src/credit.ts`）。重播腳本 `manual-measure-view.js`、單元測試 `measure-units.test.ts`（23 項）、`drawing-units.test.ts`（11 項）；手冊新增 D9。**限制**：點任意位置（端點、中點、面上任一點）量測、多筆量測保留、標籤可拖、改座標系 這些是第二段，沒做；工程圖面板列出元素的文字（「面 x = −40」）仍是毫米；分數只做英寸。

**工程圖：在圖上標註、搬標註、畫剖面線（2026-10-09，使用者要求「標註位置寫死無法搬移、無法編輯、無法自由決定如何標註與剖面位置，請參考 SW」，未提交）**：圖紙檔 **Schema 8**（標註可有可無的 `precision`／`prefix`／`suffix`／`text`（覆寫，`<DIM>` 代表原文）／`slide`（線性與角度：文字沿線位移）／`leader`（直徑與半徑的引線長度）；migration 7→8 空轉）。`packages/drawing/src/pick.ts`（純計算：`featureAt` 從畫出來的線找出被點到的元素、`dimensionAt`、`planDimension` 由點選的元素與位置決定標註種類與位置、`dragDimension`、`factsOf` 讓預覽不必等 worker）；`dimension.ts` 的 `handle`、`offsetAt`、`leaderAt` 等；`DrawingViewport.tsx` 整份改寫（智慧型尺寸工具、剖面與細部圓的畫線工具、點選與拖曳標註、拖剖面線、雙擊到面板的文字欄、Esc 與 Delete；其他按鍵照舊平移）；`DimensionPanel`／`DrawingPanel` 加工具按鈕與編輯欄位；SVG 輸出的標註文字有白色邊。面板原有的下拉與數字欄都還在。重播腳本 `tests/e2e/manual-drawing-annotate.js`（13 步）、單元測試 `drawing-pick.test.ts`（19 項）；手冊新增 F7。**限制**：預覽用的元素資料是由視圖的線推出來的（`factsOf`），孔的標註（貫穿、深度）只有放下後才完整；標註不自動避讓（只能手動搬）；點選以畫出來的線為準，被隱藏線擋住或沒畫出來的元素點不到；組合件視圖仍無法標註（原本就如此）。**使用者 2026-10-09 實機確認通過：A1（桌面版安裝）、D3（輸入 STEP 組合件）、D8（輸出 STEP 組合件）**，已寫進手冊（`data-auto="user"`，現在共 14 項）；手冊剩下要人做的：I10、F6（PDF）、F4（用語）、G5／I9（認可 10-05 的 eDrawings 結果）、J 章樣本、K 章決定、L 章清理。**剖面位置可用滑鼠左鍵拖動（2026-10-09，使用者要求）**：剖面開著時，游標在橘色切面上變成手，左鍵按住沿切面的垂直方向拖，位置依該軸在畫面上的投影長度換算（軸正對視線時改用上下拖），停在模型範圍的盡頭；`viewer.ts` 的 `sectionHit`（切面與實體內部的判斷：切面平面與滑鼠射線的交點，射線方向不沿軸的探針穿過實體表面的奇偶，且沒有被保留的表面擋在前面）、`onSectionDown`（capture 階段攔下，所以不會同時選取或拖元件）、`setSectionDrag`；`ViewOptions` 把 `setCut` 接上去。重播腳本 `tests/e2e/manual-section-drag.js`（8 步，組合件與零件）；這個改動在 `viewer.ts`，要跑 `npm run verify:ui`（相關 20 支已過）。**H9（外殼加蓋子：實際走一遍）使用者 2026-10-08 實機確認通過**（走的過程提出的問題都已修，見下）。**H9 實機走到「新組合件」時發現：專案資料夾一旦選過（本次或瀏覽器記住的）就沒有地方可換，面板固定顯示舊資料夾（使用者看到 `test`，選不到 `塑膠件`）；已修：插入面板加「更換資料夾…」（只在新做、還沒放零組件的組合件出現；`store.changeProjectFolder`、`AssemblyStore.canChangeProject/setProject`），重播腳本 `tests/e2e/manual-h9-folder.js`，`npm run check` 通過 2370 項**。**H9 走到結合時又發現兩件事**：① 使用者選外殼與蓋「直立角落邊」重合報矛盾——不是缺陷：外殼有 1° 拔模，四條直立邊往內傾斜且互相不平行，蓋的直立邊是垂直的，兩組不可能同時共線（求解器對）；可行做法是「開口面重合＋兩條互相垂直的開口外緣水平邊重合」，已用真實檔案驗過三個都成立，寫進手冊 H9；邊線與邊線的「重合」就是共線（`equations.ts` line+line），沒有另開「共線」選項。② 組合件沒有剖面與顯示類型 → 已加（`Viewport.tsx` 的 `ViewOptions` 加 `assembly` 參數、`AssemblyViewport.tsx` 掛上、`viewer.ts` 的 `styleInstance` 讓每個零組件吃剖面平面與顯示類型、點選略過被切掉的部分、新放的零組件自動被切；組合件沒有「顯示隱藏線」虛線；`.view-options ~ .flyout-tree` 讓結合的飛出樹往下讓開），重播腳本 `tests/e2e/manual-asm-section.js`。**使用者看過之後又提三點（都已做，`manual-asm-section.js`／`manual-asm-menu.js` 通過）**：③ 剖面切開後實體像空心 → 切面現在用模板緩衝（stencil）填滿（`viewer.ts` 的 `updateCap`：每個實體各一組、互相不抵消；渲染器要 `stencil: true`；零件視窗也一併有填滿），沒填滿時看到的是殼內壁；剖面位置的數字可直接輸入（`Viewport.tsx` 的 `SectionValue`，Enter／離開欄位套用、Esc 取消、非數字還原，不限滑桿範圍；測試抓到 Esc 之後的 blur 會提交舊草稿，已修）；**填滿第一版有缺陷（使用者拖滑桿發現橘色截面不跟實體切口對齊，已修）：模板材質建立時抓住當時的剖面平面，`setSection` 每次換新平面卻沒更新它們；現在 `updateCap` 每次都重設，`manual-asm-section.js` 步驟 3b 拖三個位置檢查（拿掉修正會失敗）**；注意：本來就是空心的殼（壁 2）切開就是一圈壁的截面，那是對的；④ 設計樹的零組件列沒有「眼睛」→ 加了（`AssemblyTree.tsx`，同零件樹的 `vis-toggle`，抑制中的不顯示）；⑤ 3D 視窗右鍵沒有選單 → 加了：右鍵點零組件出與設計樹同一份選單（`ComponentMenu`，開啟零件／浮動固定／隱藏／透明／抑制／刪除；`viewer.ts` 的 `onComponentContextMenu`），右鍵拖曳（轉動零組件）結束時不跳選單（`swallowContext`），結合中（點面／邊）不出選單，H9、I10 加註機械步驟已驗、留給人走一遍；A1、D3、D8、F6、G5、I9、J、K、L 沒動（要別台電腦、別的軟體、你的樣本或你的決定）。**驗證結果**：`npm run verify:ui` 全部通過、0 個 Console 錯誤（沒有 KNOWN 了）；`npm run check` 通過（acceptance-4a、undercut-analysis 兩個計時測試只有機器忙時才會超時，單獨跑會過）。**這個階段修掉的缺陷**：C6 修復草圖（ops.ts）、C19 資料夾拖放與 moveFeature（FeatureTree.tsx、store.ts）、C26 草圖右鍵「快速抓取」選單根本出不來（viewer.ts 新增 onToolContextMenu、Viewport.tsx）、爆炸步驟清單欄寬與「剖面視圖／細部放大圖」按鈕直排字（app.css）、工程圖零件表／孔表的中文欄寬（bomTable.ts、annotation.ts，有回歸測試）、曲面本體只畫正面（viewer.ts applyDisplay 一律雙面，manual-g3.js 有檢查）。**三個待決缺陷，使用者已選建議的做法並做完**：C11 掃出折返太急 → 擋下並說明原因（packages/kernel/src/sweepFloor.ts 依 Pappus 量體積，低於 70% 拒絕；tests/phase3/sweep.test.ts）；E4 距離結合停在上限拉不離開 → 修好（solver.ts 的 blocks 對剛好在限制上的列不算，tests/phase4/advanced-mates.test.ts）；F3／F4 孔標註互相蓋住 → 面板出黃字建議改用孔表（packages/drawing/src/overlap.ts、DimensionPanel.tsx；tests/phase5/overlap.test.ts），圖面不自動改，等 K2 確認用語後再考慮自動改成只標代號。**注意**：另一個工作階段（或使用者）會在中途把工作區整批提交（commit 561d3b8 就含了我的檔案）；我不自行提交、不推送（使用者說「推」才推）。執行環境：`npm run dev` 要開著（verify:ui 沒有伺服器時會自己起）；內建瀏覽器窗格要 `resize_window 1280×720` 才能手動除錯。
- 用途：讓下一個工作階段（人或 AI）不讀對話紀錄也能接手。
- 本文件只記錄「目前狀態、待辦、下一步、工作約定」。範圍與設計以藍圖、ADR、程式碼為準；若有衝突，以它們為準並更新本文件。

## 0. 換電腦之前，先讀這裡

### 0.0 快速接手（2026-10-04，H-11 之後，換電腦先看這段）

**狀態（2026-10-19 更新）**：Phase 0 到 7 開發完成，之後的功能到 ADR 0167；全量 vitest **3106 過、0 敗**（2026-10-19 基線；C5.2 又新增 5 支，全量尚未重跑）；零件 Schema **66**、組合件 Schema 7、工程圖 Schema **25**。**進行中的功能：C5.2 變化半徑圓角**——見本檔最上方條目（模型層已提交 `feb4c05`，核心／再生層在工作區未提交且全綠，UI／help 未動；下一個 agent 照最上方條目的「下一步」接手）。除此之外沒有其他進行中的里程碑，**等使用者的實機驗證結果**。鞏固 H-1 到 H-11 已做完（[hardening-plan](docs/hardening-plan.md)）。2026-10-07 使用者用選擇題決定了後續的項目，做完的與還沒做的在下面「2026-10-07 的選擇」。每個里程碑的 ADR、驗收表與限制在對應的 ADR，§3 有一行摘要。

**2026-10-07 的選擇（使用者在選擇題頁面選的；做完的都已提交並推送，ADR 在 §2 文件地圖）**
- **已做**：折彎之後才切的孔進平板型式（ADR 0113）；厚面遇尖角拒絕並說明根因（ADR 0112）；曲面互相修剪補測自由曲面（ADR 0109 的補充，沒有發現問題）；折過的基材上的凸緣的平板型式（ADR 0114）；3D 視窗顯示展開的狀態（ADR 0115）；`make:kit` 加了新功能的範例檔（`曲面/`、`鈑金/` 的互相修剪、厚面兩側、斜接、中間折彎、折過基材加凸緣、折彎後的孔；**使用者要再跑一次 `npm run make:kit`**，手冊的步驟已寫「範例檔」）；刪除舊分支 `spike/occt-gaps`（已與 main 合併）。
- **選了但前提已經過時**：「摺邊的最小半徑規則」——ADR 0093 已決定摺邊不參加最小半徑檢查，沒有摺邊專屬規則（沒有可靠的數值，等工廠的規定）；§8 Phase 7 C 的那句舊話已更正。**要做就要先有工廠的數值。**
- **選「先不做」或「等回饋」**：圓角與導角的其餘功能（~~變數半徑~~→**2026-10-19 使用者改做，C5.2 進行中，見本檔最上方條目**；尚餘選特徵與迴路、不相鄰面的面圓角、兩側不平行的完整圓角）；工程圖號球與表格拖曳（等 F 章驗證）；以曲面除料的任意向量方向；下一個大功能（組態與設計表格、由上而下設計、IGES、腳本 API）——**驗證到 H 章再選**；桌面版圖示、自動更新、簽章——**驗證結束重建安裝檔時一起處理**。
- **SW 原生檔（使用者沒有 SolidWorks，2026-10-07 再次強調：不要要求他使用 SW）**：決定在 blueprint §1；輸出原生檔放棄；輸入靠別人給的 STEP。我曾寫過在 SW 裡跑的批次轉 STEP 巨集，使用者說不需要，已刪除。找到兩個開源專案：openswx（MIT，只讀屬性與組合件零件參照，沒有幾何）與 open-sld-to-step（Apache-2.0，NIST 比對面只吻合約 52%）；要不要用它們評估，等使用者決定（他手上的 `.SLDASM` 樣本放在 `<使用者資料夾>\Downloads\SW樣本`）。
- **2026-10-07 的清理（使用者用選擇題決定）**：個人路徑換成 `<使用者資料夾>`、`<檢出路徑>`（git 歷史裡仍有舊的）；`sync.ffs_db` 進 `.gitignore`；`tests/e2e/phase2-assembly.js` 的 STEP 路徑改由檔案位置推出；死碼與無效資源只列清單（`docs/cleanup-candidates.md`），使用者勾選後才刪（已刪 `conjugate`、`DOWEL_STANDARD_SOURCE` 與 17 個沒被引用的文字鍵；其餘保留）；文件只對齊現有的，不新建 DEV_LOG.md 與 wiki/；**重新打包等實機驗證做完才做，形式選安裝檔（NSIS）**（已於 2026-10-09 重打：桌面版 0.2.0；舊的 0.1.0 安裝檔已刪）；推送要使用者說「推」才推。

**換電腦（本專案要能在不同電腦開發，下面都是每台電腦自己的事，程式與文件不依賴任何一台）**：`git pull`（私人專案）→ **`npm run doctor`**（唯讀診斷：Node、git、`node_modules` 的工作區連結是否指向這個資料夾、這個磁碟能不能做連結、埠 5391、Rust 與 C++ 工具；每個問題都附修法）→ 有問題照它說的做（多半是 `npm install`）→ `npm run check`（應全過）→ `npm run dev`。**只用網頁版不需要 Rust 與 MSVC**；要建桌面版才裝（`apps/desktop/README.md` 的「需要」）。

**在另一台電腦繼續「實機驗證」（2026-10-05 起的任務，照這個順序做）**
- **進度（2026-10-06，使用者在 `D:\Self-developed_Apps\G3\3D-Builder` 這台做完 C5）**：[docs/manual-verification.html](docs/manual-verification.html) 的 84 項，**P1 到 P3、B1、C1、C2、C3、C4、C5 通過**（共 9 項；B1 與 P 系列是 10-05 在 先前使用的那台電腦做的）；**下一個是 C6**，接著 C7 到 C22，再 D、E、F、G、H、I（標「必做」的優先，「需樣本」「需你決定」的先不做）。狀態存在使用者的瀏覽器 localStorage，**不會跟著 git 換電腦**：換電腦後手冊會全部顯示「未做」，請照這一行把上面已通過的項目在手冊裡選「通過」（或直接從 C6 開始，不必補），做完一個段落按「複製結果」貼給 Claude。
- **手冊改寫（2026-10-06，使用者說「怎麼做」很不清楚，要小白也看得懂）**：[manual-verification.html](docs/manual-verification.html) 的 C1 到 I10 已改寫成「先準備＋一步一個動作＋每步下面『→』接預期畫面」，最前面加了「先看這裡」（畫面怎麼認、滑鼠鍵盤、共用做法 A 到 H、名詞表）；A、B、J、K、L 與 0 章維持原樣。寫的時候每個按鈕與欄位名稱都對過動作清單與 `packages/i18n/src/zh-TW`，C1、C6、C8、G1、鈑金（基材凸緣、邊線凸緣、摺邊、平板型式）、薄殼盒與三個塑膠分析在內建瀏覽器實際走過，數字對得上。**走的時候發現而寫進手冊的事實**：編輯草圖時「方程式」「檔案屬性」是灰的；過多定義用手做不出來（尺寸工具會把多的尺寸變成從動尺寸）；間隙要調「間隙容差」才看得到；分割線的圓要整個落在面內；鈑金用上基準面做時預設值（板厚 1.5、半徑 1.5、K 0.5）直接可用。**沒有預跑、手冊標「選做，沒有預跑」的**：旋轉的薄件、掃出的空心管／弧形路徑／錯誤情境、疊層拉伸除料與方形對圓形、肋材階梯板、相切基準面、拔模（塑膠）、卡榫與窗、排氣口、曲面的延伸／修剪／縫織／填補、量規表以外的鈑金檢查（孔到折彎）；組合件與工程圖的步驟（D、E、F）依程式的面板與腳本寫成，沒有在真正的資料夾選擇視窗走過。這次也修了一個顯示問題：「成形至本體」把本體接起來之後，面板誤顯示「（遺失參考）」（`PropertyManager.tsx` 的 `EndRef`，改成看特徵自己的報告）。
- **2026-10-06 的進度（C1 到 C5 的發現，都已處理並提交）**：
  - **手冊**：C1 的步驟做不下去（編輯草圖時「方程式」「檔案屬性」是灰的），改成離開草圖後用方程式視窗的「草圖尺寸」表改；C3 的「診斷報告」要**雙擊**「輸入1」才看得到（單擊只是選取）；C5 與 C6 的「先準備」改成逐步寫；手冊「先看這裡」補了：單擊與雙擊、沒有關閉檔案按鈕（用「新零件」）、復原按鈕在哪、草圖吸附現況。
  - **程式**：① **復原／重做變成每個分頁都看得到的按鈕**（原本只在特徵與組合件分頁，藏在 40 個按鈕的最尾端，`CommandBar.tsx`）；② **設計樹的本體列縮排**在「實體(N)」底下；③ 「成形至本體」把本體接起來後不再誤顯示「（遺失參考）」；④ **偏移圖元、鏡射圖元、幾何建構線沒選取就按**，左邊面板最上方會顯示提示（`ControllerView.message`），原本只在最下方狀態列閃一行。
  - **待決定的新功能**：草圖吸附與推斷（虛線對齊線、吸附到模型的邊與頂點、快速抓取）——[sketch-snapping-plan.md](docs/sketch-snapping-plan.md)，依 SW 2010 繁中說明寫成，使用者決定 C 章走完再排優先序。**後面的草圖項目（C6、C7）若因為沒有吸附而做不下去，請告訴使用者並評估提前做 S-2。**
  - **這台的開發伺服器**：Claude 桌面版的預覽會定時停掉它，所以後來改用獨立的背景程式（`Start-Process npm.cmd run dev -w @3db/web`）；換電腦後在新電腦開自己的終端機執行 `npm run dev` 即可。
- **步驟**：① `git pull` → `npm run doctor` → 有問題照它說的做（多半是 `npm install`）→ `npm run check`（應 **2370 項通過、22 項略過**；`undercut-analysis` 的 4 秒門檻與 4a 驗收在機器忙時可能失敗，單獨跑會過）。② **產生驗證用的檔案**：它們在版本庫之外，每台電腦要自己產生。PowerShell：`$env:KIT_OUT = 'C:\3DB實機確認'; npm run make:kit`（沒設 `KIT_OUT` 時寫到 `D:\3DB實機確認`，這個磁碟不存在就會失敗；清單 P2 說的 4 個檔案就在這個資料夾的根目錄，另有夾具組、塑膠件、鈑金、`STEP替身/`、`輸出/`）。PDF 的中文要這台有 `C:\Windows\Fonts\msjh.ttc`，沒有時 PDF 的中文是 `?`。③ `npm run dev`，用 **Edge 或 Chrome** 開 http://127.0.0.1:5391（要用瀏覽器的檔案系統存取）；在**同一個瀏覽器**直接開 `docs/manual-verification.html`（檔案路徑）填寫。④ 做完（或做到一半要換電腦）按頁面上方的「複製結果」，**把文字貼進對話**：狀態與備註只存在那個瀏覽器的 localStorage，不跨電腦、不進 git。⑤ 對 Claude 說：「讀取 handoff.md，接手實機驗證」。
- **B1 的發現（2026-10-05，已處理）**：① 原點預設是顯示、三個基準面隱藏（程式照設計，與 SW 一致），清單原本寫錯，已改。② 「關掉再開」的做法清單沒寫，已補（儲存檔案 → 新零件 → 開啟舊檔）。③ 清單說「刪掉伸長」會讓圓角的邊遺失參考，實際只會得到「圓角之前沒有本體」，沒有「改用最接近的」；這個功能用 `tests/phase1/repair.test.ts` 與瀏覽器裡的腳本驗過（按下後體積 991.416 mm³），清單的這一步標為略過。④ 在設計樹按右鍵會出瀏覽器的原生選單：根因是程式選單本身、原點與基準面列、「實體」列、空白處都沒有攔右鍵，右鍵落在開著的程式選單上時原生選單蓋上來（擴充功能不是原因，InPrivate 視窗一樣）；修法是整個頁面統一攔下，只放過文字輸入（`apps/web/src/nativeMenu.ts`，`tests/phase8/native-menu.test.ts`），使用者確認連按右鍵不再出現。
- **預跑（2026-10-05，使用者要求「驗證速度太慢」之後）**：39 項必做裡，有 `tests/e2e/` 瀏覽器腳本的項目（C2 到 I8）全部在內建瀏覽器（視窗 1280×720）跑過，都過；C1 方程式用頁面手動走過。每一項的結果與「腳本沒涵蓋」的步驟寫在清單的「預跑」一行；H9、I10 是真人走一遍，沒有預跑。預跑時修了 6 個過時的腳本（`phase3-shell`、`phase3-subassembly`、`phase3-step-import`、`phase3-component-pattern`、`phase5-dimensions`、`phase5-views`，加 `phase2-assembly.js` 的 `H.decodeStep`；原因：STEP 輸出回傳 `{text}`、名稱改成 `\X2\` 逃脫碼、孔標註帶「貫穿」、剖面避開被佔住的一側、薄殼多了提示列）；清單修了檔案名稱（D1 的次組合件要由 `金樣夾具_巢狀.step` 匯入得到 `工位.3dba`）、D4 的數量、C2 的體積、D2 的按鈕名稱、F1 的路徑。**預跑不能代替人**：腳本驗的是功能與數字，視覺、手感、原生對話框、外部軟體仍要使用者做。跑這些腳本的做法：每支在剛載入的頁面 `await import('/@fs/F:/…/tests/e2e/<檔>.js?'+Date.now())` 再呼叫它的 `run()`；上一支沒收尾會留下自動存檔副本，下一次載入會跳出「找到沒有儲存的零件」，要按「捨棄」。
- **驗證檔案的位置**：這台放在版本庫根目錄的 `3DB實機確認/`（已加進 `.gitignore`，不會被提交）；`make:kit` 的 `KIT_OUT` 可以指到這裡。
- **Claude 接手時**：使用者貼回結果後，逐項判讀；有問題的按 PDCA 修（先給計畫與量化驗收，修完 `npm run check` 全過、更新 ADR 與本文件、使用者同意才提交與推送）；修好的在重新產生的驗證檔案上再確認。**eDrawings 檢查不必重做**（0b 已做完）。**桌面版安裝檔等驗證結束再重建一次**（要 Rust 與 MSVC，`npm run doctor` 會說這台有沒有）。
- **這些替身不是真實 SolidWorks 檔案**：J 章（真實零件、組合件 STEP、沖壓件、塑膠件與 SW 分析對照、鈑金平板型式對照）仍要使用者提供樣本，`SW_SAMPLE_DIR` 沒設時相關測試略過。

**下一步（建議順序）**
0. **驗證用的檔案（2026-10-05）**：`npm run make:kit` 產生 `D:\3DB實機確認`（可用環境變數 `KIT_OUT` 改位置）：金樣零件、夾具組、15 個零組件的金樣組合件、塑膠外殼與蓋、鈑金支架、STEP 替身，另有 `輸出/`（每個零件與夾具組合件的 STEP、基板加工圖的 DXF 與 PDF、支架的平板型式 DXF）與 `輸出/看圖清單.md`（用 eDrawings 或 CAD 開時每個檔案要看什麼、核心算的數字）。這些是程式自己做的替身，**不是真實的 SolidWorks 檔案**，不能代替 J 章。產生器在 `tests/kit/`，不在 `npm test` 裡；金樣定義是從驗收測試複製的（它們沒有匯出），驗收測試改了要跟著改。**程式啟動時現在是空白零件**（原本開示範件），示範件是「檔案 → 新示範件」；桌面版安裝檔**還沒用這個改動重建**，等實機驗證完再一次打（`npm run build -w @3db/desktop`）。用 eDrawings 開 `輸出/` 的檔案的檢查**已在 2026-10-05 做完**（結果在 0b），不必重做。
0b. **eDrawings 驗證的結果與待決定（2026-10-05）**：用 eDrawings 2026 逐一開 `輸出/` 與 `STEP替身/` 的檔案（形狀、孔、圓角、凸緣、組合件位置都對；細節在 `看圖清單.md`）。已修：STEP 的中文名稱原本寫成原始 UTF-8，eDrawings 讀成亂碼，現在寫成 `\X2\…\X0\`（`kernel/src/stepText.ts`）；剖面視圖的那一側被別的視圖佔住時（第一角的上視圖正好在前視的下方）改放到母視圖的旁邊，原本兩者疊在一起（`layout.ts`）。**使用者決定之後再處理（已記錄、未做；2026-10-05 使用者對 (a)、(b) 的決定是「不處理」，除非日後有需要）**：(a) 巢狀組合件（`金樣夾具_巢狀.step`）的子組合件名稱「工位」在 eDrawings 的零件樹仍是亂碼，檔案內容合法、我們自己的讀取器讀得回，原因不明（平的組合件與單件都正常）；(b) 工程圖 DXF 在 eDrawings 裡 `×` 與中文顯示成 `?`（標題圖塊、孔表標題、「貫穿」；Ø 正常），不知道是 eDrawings 的字型還是 DXF 的文字寫法；(c) 平板型式 DXF 的折彎註記「UP 135° R2」是上下顛倒的（文字方向跟著折彎線的方向）；(d) 「量測」在 eDrawings 沒量出數值、STEP 沒有質量特性，所以尺寸只用像素比例目視核對，沒有精確比對。PDF 沒用 eDrawings 看（它不開 PDF），要用 Chrome。
1. **使用者的實機驗證**：[docs/manual-verification.html](docs/manual-verification.html)（85 項，每項有步驟、預期結果、回報格式；做完按「複製結果」貼回來）。這是現在最大的缺口：3a、3b、4a、4b、5、6、7 的閘門都只是「有條件通過」。
2. **真實樣本**（卡在使用者提供）：3 個真實 SW 零件（3a-10）、保留結構的組合件 STEP（3b-7 B 段）、真實夾具案例（4a）、真實沖壓件或塑膠件（4b）、真實塑膠件與 SW 分析對照（6）、真實鈑金與 SW 平板型式對照（7）；用到它們的測試靠環境變數 `SW_SAMPLE_DIR`，沒設就略過。
3. **要使用者許可才能動的**：刪檔（全域規則）。目前沒有待決定的（`%LOCALAPPDATA%` 下桌面版的使用者資料夾 `app.3dbuilder.desktop` 已在 2026-10-04 經使用者許可刪除；它是 WebView2 的網頁暫存與自動存檔的還原副本，之後執行桌面版會重新產生）。
4. **要使用者決定的下一個功能**（§8 與清單的 K4）：**草圖吸附與推斷（參照 SolidWorks）**：吸附到模型的邊與頂點、虛線對齊線、快速抓取。2026-10-06 手動驗證 C3 時使用者提出並要求規劃；**計畫與驗收在 [docs/sketch-snapping-plan.md](docs/sketch-snapping-plan.md)**（SW 的行為已依 SW 2010 繁中說明寫進計畫（推斷、14 種草圖抓取、快速抓取）；里程碑 S-0 到 S-5：S-0 請使用者用 SW 確認說明沒寫的 4 件事，S-2 吸附到模型幾何最有感，S-1 水平／垂直推斷虛線）；藍圖目錄 D5.3a 到 D5.3c；手冊 K4 有勾選項。使用者決定 C 章走完再排優先序，現在不做；Phase 7 的凸折、斷開角落、長圓與撕裂離隙、折過的基材上的凸緣的平板型式、平板型式進工程圖；卡榫「鉤下面的窗」做成選項；檢具的曲面相互修剪；工程圖的螺紋孔標註、角度尺寸、DXF 的 DIMENSION 圖元；桌面版自動更新與簽章；（次組合件內部的干涉檢查已做：干涉檢查視窗的「也檢查子組合件裡面的零件」，手冊 D7，`__interference.within`。）
4a. **草圖吸附（2026-10-06，已完成 S-1 到 S-4）**：水平點／垂直點虛線、共線／平行／垂直推斷、吸附模型的邊與頂點、交點、四分之一點、切點、垂足、網格、角度、Shift 長度、系統選項的「草圖抓取」開關與右鍵的「快速抓取」；[sketch-snapping-plan](docs/sketch-snapping-plan.md)、[ADR 0099](docs/adr/0099-sketch-snapping.md)；手冊 C26 與 K4。**剩下 S-5**：使用者在 SW 與本程式各做同一張草圖，描述差異。
4b. **說明系統（2026-10-06，未提交）**：使用者要求比照 SW 的說明按鈕，且基於 SSOT（驗證後修正，說明跟著改）。已實作 H-A：說明文字只在 i18n 目錄 `help.<主題>.*`（[help.ts](packages/i18n/src/zh-TW/help.ts)），主題 id = `ACTIONS` 的 id（草圖工具 `tool-<tool>`）或 `concept.*`；工具提示、說明窗（功能列「說明」或 F1，依目前的工具／特徵／草圖開對的主題，有搜尋與目錄）、「這是什麼？」（點任何帶 `data-help` 的按鈕或面板）都讀同一份。**防漏**：`tests/phase8/help.test.ts` 在新增動作或草圖工具卻沒有一句話時失敗；[docs/help-links.json](docs/help-links.json) 記每個手冊項目驗證哪些主題。**工作約定（加進 §7）：加指令必須同時加 `help.<id>.summary`；手冊項目標「有問題」並修好時，依 help-links.json 同步改對應主題的文字。** 計畫與驗收見 [help-plan.md](docs/help-plan.md)；待補：其餘主題的內文（H-B）、英文（H-D）、手冊項目下顯示對應主題（H-C）。
4c. **工程圖角度尺寸與下拉選單（2026-10-07，ADR 0100）**：工程圖 Schema 5 的 `angle` 尺寸（兩個面、弧半徑、補角；尺寸面板列出斜面）、手冊 F3 多一步、瀏覽器腳本 `tests/e2e/phase5-angle.js`；命令列各分頁改成下拉選單（按需展開）。同日完成：子組合件內部的干涉檢查（勾選「也檢查子組合件裡面的零件」）。說明主題內文（123 個主題裡 122 個）與手冊顯示主題（H-C）也已完成，見 [help-plan](docs/help-plan.md)（內文待使用者審稿）；**下一步**：使用者選的四組待辦已做完兩組（工程圖：ADR 0101、0102；組合件：ADR 0103 到 0105）；剩鈑金（凸折、斜接、平板型式進工程圖）與塑膠／檢具（卡榫窗選項 ADR 0107 與厚面兩側、保留曲面 ADR 0108 已做；曲面互相修剪 ADR 0109 已做；鈑金的斜接與中間折彎 ADR 0110、0111 已做）。四組待辦全部完成。
5. **圓角與導角可以選面、面圓角、完整圓角（2026-10-06，已完成）**：[fillet-by-face-plan](docs/fillet-by-face-plan.md)、[ADR 0097](docs/adr/0097-fillet-by-face-validation.md)（驗證）、[ADR 0098](docs/adr/0098-fillet-by-face.md)（實作）；手冊 C23 到 C25；UI 腳本 `tests/e2e/phase3-fillet-face.js`（`__ff.constant／chamfer／face／full`）。**沒做、日後可列**：不相鄰面之間的面圓角、兩側不平行的完整圓角、變數半徑、選特徵與迴路。

**工作約定提醒**（完整在 §7）：動手前先給計畫、量化驗收標準、反向提問；刪檔先問；**全文禁用簡體字（回覆、程式註解、文件、提交訊息一律繁體中文或英文；使用者 2026-10-18 明定，已寫入 user-level MEMORY.md）**；限制與沒做的驗收要誠實寫出；每個里程碑更新 ADR、本文件與對應的計畫文件；推送前先確認（使用者在 H-11 要求推送前做資安與數據隱私盤點、取得許可）。

### 0.1 藍圖（已完成）

- 藍圖曾經只存在家裡電腦，從來沒進過 git，是單點故障（2026-09-30 在另一台電腦上找不到它，Phase 3 的規劃因此卡住）。
- **2026-09-30 已放進版本庫**：[docs/blueprint.md](docs/blueprint.md)（提交 `80964b6`，與原檔 SHA-256 相同）。原檔 `<使用者資料夾>\.claude\plans\solidworks-3d-solidworks-solidworks-3d-serene-crayon.md` 是同一份的舊副本；**之後只改 `docs/blueprint.md`**，不要兩邊各改。
- `.claude/plans/` 裡沒有這個專案的其他計畫檔。
- 藍圖有幾處技術描述已過時，範圍不受影響：OCCT 7.9.x（實際是 libcascade 3.0.2 的 OCCT 8.0.1）、pnpm（實際是 npm workspaces）、「現況為空目錄」。
- §11 是藍圖遺失時用的備援摘要；現在藍圖在版本庫，有衝突時以藍圖為準。

### 0.2 接手藍圖之後的工作

1. §2 文件地圖的藍圖那一列已改成 [docs/blueprint.md](docs/blueprint.md)。
2. **Phase 3 的里程碑與驗收標準**：[docs/phase3-plan.md](docs/phase3-plan.md)。§6 的決定 1–6 使用者都已決定（2026-09-30）；**§5 的驗收數值（對稱差體積 < 1e-6 等）是我的建議值，使用者暫時認定為 Pass（2026-10-01）**：先照做，3a-10 之前若樣本顯示不合理再調整。3a-0、3a-pre、3a-i18n、3a-1、3a-2、3a-3 已完成並推送；3a-4 草圖工具 P1 分 4a 繪圖與編輯工具（已實作）、4b 限制條件與從動尺寸（已實作，Schema 11）、4c 衝突診斷、草圖檢查與輪廓選取（已實作，Schema 12）、4d 跟著模型走的參考圖元與「貫穿」（已實作，Schema 13）；3a-4 完成。3a-5 特徵 I（5a 伸長／旋轉 P1、5b 薄殼、5c 拔模）與 3a-6 特徵 II（6a 異型孔、6b 掃出、6c 疊層拉伸、6d 肋材）也已完成並推送；**下一個是 3a-7 參考幾何與複製排列**（phase3-plan §3），已確認分 7a 參考幾何、7b 直線與環狀複製排列、7c 鏡射，**都已實作**，見 §10。3a-8 材質、屬性與輸出（8a/8b/8c）也已實作；3a-9 分 9a／9b／9c，9a、9b 已實作，9c-1 檢視（顯示類型、視角選擇方塊、剖面）已實作（ADR 0042），9c-2 選取（濾器、選擇其他、迴圈與相切、BVH）已實作（ADR 0043），9c-3 系統選項與英文（ADR 0044）已實作，**3a-9 全部做完**；3a-10 驗收的工具與不需樣本的部分已完成（ADR 0045）；**需要使用者 3 個真實零件的部分，使用者於 2026-10-02 決定先跳過**（3a 閘門因此是「有條件通過」：自動化全過，真實零件的對照與實機點選驗收未做；樣本到手時用 `tests/support/acceptance.ts` 補做）。組合件介面的 183 行中文還沒搬。

### 0.3 不在版本庫、只存在某台電腦的東西

| 東西 | 在哪裡 | 換電腦時 |
|---|---|---|
| ~~藍圖~~ | 已在版本庫 `docs/blueprint.md`（0.1） | 不用做什麼 |
| 使用者的全域規則 `CLAUDE.md`（SkillsBuilder 開發標準、反向提問、智囊團審查、檔案刪除保護） | 每台電腦各自的 `C:\Users\<使用者>\.claude\CLAUDE.md` | 從舊電腦複製，或依那份檔案最後一行的說明執行 SkillsBuilder 的 `INSTALL.ps1 -Global`。沒有它，§7 的工作約定不會自動生效 |
| 桌面版的建置環境（Rust 1.99、rustup、VS 2022 Build Tools 的 C++ 工作負載、`@tauri-apps/cli`） | **每台電腦各自裝**（`npm run doctor` 會說這台有沒有）：Rust（`winget install Rustlang.Rustup`，在 `%USERPROFILE%\.cargo\bin`，新終端機要把它加進 PATH）；C++ 編譯器 VS Build Tools（2022 或 2026 都行，MSVC 14.44 與 14.50 都有人用過，Tauri 認得；若 winget 對 2022 版說「已安裝」卻失敗，是有一個不完整的舊實例，改用 `setup.exe modify` 補 C++ 工作負載，或直接用已有的 2026 版）與 Windows SDK。2026-10-04 在先前使用的那台電腦裝好並用 Phase 4a–7 的程式重建了安裝檔（安裝檔在 `target/`，不在版本庫，各電腦自己建）；`node_modules` 之外都不在版本庫 | 新電腦要建桌面版：照 `apps/desktop/README.md` 的「需要」裝；只用網頁版不需要 |
| SolidWorks 樣本（專有檔案，不進版本庫） | `<使用者資料夾>\Downloads\SW樣本`：`T1405001.SLDASM`、兩個單一實體的 STEP | 看 §8 第 1 項；用到它的測試靠環境變數 `SW_SAMPLE_DIR`，沒設就略過 |
| 實機測試用的專案資料夾 | `<使用者資料夾>\Downloads\3DB實機確認` | 只是金樣零件的複本，可從 `tests/golden/` 重建（三個檔案：`定位板.3dbx`、`V型塊.3dbx`、`零件\削邊銷.3dbx`） |
| 對話紀錄與 Claude 的記憶 | 各電腦本機，不同步 | 沒有：**本文件是唯一的交接** |
| `node_modules` | 各電腦自己 `npm install` | 見 0.4 |

### 0.4 在新電腦接手

1. 安裝 Node（開發用 26）與 git。
2. `git clone https://github.com/Chun-Chieh-Chang/3D-Builder`（私人專案，需要 GitHub 登入）。
3. **專案要放在支援符號連結的磁碟**（NTFS，例如 `C:`），不要放在 exFAT 或 FAT 的 USB 隨身碟：npm workspaces 靠符號連結，在 USB 上 `node_modules/@3db` 是空的，`npm run check`、`npm run dev`、`npm run build` 都會失敗（另一台電腦就是這樣，繞法見 §6「工作區連結」）。
4. `npm run doctor`（診斷這台電腦；搬過專案或換過磁碟代號時，`node_modules` 裡的連結是絕對路徑，會指到不存在的地方，它會說，修法是 `npm install`），然後 `npm run check`（型別、分層、全部測試，應全過），`npm run dev`，用 Chrome 或 Edge 開 http://127.0.0.1:5391。
5. 行尾：`.gitattributes` 規定文字檔一律以 LF 存、LF 檢出，不管這台電腦的 `core.autocrlf`；若隨身碟帶來的工作檔是 CRLF，`git status` 不會因此變髒，提交時也會自動轉成 LF。
6. 確認 `docs/blueprint.md` 在；不在的話，先 `git pull`。
7. 對 Claude 說：「讀取 handoff.md，接手開發任務」。

## 1. 專案

類 SolidWorks（下稱 SW）的參數式 3D CAD：

- Web 先行，一人 + AI 開發。
- 對標 SW 早期的基礎建模能力，之後延伸到夾治具 → 工程圖 → 塑膠件 → 鈑金。
- 模具不做。

## 2. 文件地圖

每份文件各管一件事：

| 文件 | 內容 |
|---|---|
| [藍圖 docs/blueprint.md](docs/blueprint.md) | 範圍、架構、階段與驗收標準。範圍以附錄 C 目錄與 §3 階段規則為準（§0.1）。備援摘要：§11 |
| [README.md](README.md) | 快速開始、套件結構 |
| [ADR 0001](docs/adr/0001-ssot-mece-rules.md) | SSOT/MECE 程式碼守則，各套件擁有的目錄 ID |
| [ADR 0002](docs/adr/0002-phase0-kernel-and-solvers.md) | Phase 0 的求解器決策、持久命名文法 |
| [ADR 0003](docs/adr/0003-occt-binding-gaps.md) | OCCT 綁定缺口驗證，改用 libcascade 3.0.2 |
| [ADR 0004](docs/adr/0004-sketch-editing.md) | 草圖編輯：可讀且不重用的 ID、Schema v2、拖曳、逐圖元狀態、端點相切、推斷規則 |
| [ADR 0005](docs/adr/0005-features-and-booleans.md) | 特徵與布林：布林後的命名、合併共面、分割面的解析、終止型態、旋轉、導角、模型平面上的草圖、Schema v3 |
| [ADR 0006](docs/adr/0006-feature-tree-operations.md) | 設計樹操作：連帶抑制、刪除與相依、指紋解析的警告、錯誤為何、雙向選取同步、回溯選單 |
| [ADR 0007](docs/adr/0007-reference-planes.md) | 基準面：Schema v4、基準面參考的命名、框架規則、頂點持久命名、拾取優先順序、圖面顯示 |
| [ADR 0008](docs/adr/0008-part-file.md) | 零件檔 `.3dbx`：ZIP 內容、自寫 ZIP、固定輸出、輸入資料以雜湊命名、舊檔相容、本機檔案、已修改標記 |
| [ADR 0009](docs/adr/0009-step-import.md) | STEP 輸入：Schema v5、只在需要時修復、輸入面的命名與金樣、讀取快取、兩個入口 |
| [ADR 0010](docs/adr/0010-phase1-acceptance-fixes.md) | Phase 1 驗收的修正：整圈旋轉面的命名、角度尺寸量放置那一側（Schema v6）、零件名稱就是檔名 |
| [ADR 0011](docs/adr/0011-assembly-skeleton.md) | 組合件骨架：組合件文件與版本線、相對路徑的參考（不存雜湊）、專案資料夾、另存到別的資料夾時改寫路徑與復原記錄、`.3dba`、Worker 依內容快取零件 |
| [ADR 0012](docs/adr/0012-mate-solver.md) | 結合求解器：`@3db/assembly`、組合件 Schema 2（結合）、LM 從擺放位置解起、分組、依設計樹順序找衝突、自由度、支援的結合、零件的解析幾何、旋轉件平面法向的修正 |
| [ADR 0013](docs/adr/0013-mate-ui.md) | 結合的介面：Worker 求解與預覽、結合 PropertyManager、零組件上的拾取與浮出樹、設計樹的狀態與結合資料夾、錯誤為何、開始組合件、STEP 零組件 |
| [ADR 0014](docs/adr/0014-moving-and-reference-files.md) | 移動零組件與參考檔：求解器的移動目標、拖曳與數值移動、放開時寫入整組擺放位置、重新指定零件檔、找不到的檔案、零件改過後更新、開啟零件與返回組合件、記住專案資料夾 |
| [ADR 0015](docs/adr/0015-step-assembly-export.md) | STEP 組合件輸出：XCAF 單層結構、寫出圖面上的位姿、位姿由四元數與平移組成的原因、非單位四元數與讀不到的零件檔一律拒絕 |
| [ADR 0016](docs/adr/0016-component-mesh-and-load-progress.md) | 零組件的網格（容差 1‰、角度 0.5 rad，比編輯零件粗）與載入進度（階段、秒數）、沒有本體的零件檔視為錯誤、量到的時間分佈 |
| [ADR 0017](docs/adr/0017-phase3a-technical-validation.md) | Phase 3a-0 技術驗證：薄殼、拔模、掃出、疊層拉伸的演化歷史夠命名、移動面的「延伸板」做法、重算時間量測、Phase 1 遺留 P0 的盤點、成形至下一面（**驗證結果，決策待確認**） |
| [ADR 0018](docs/adr/0018-visibility-and-reference-repair.md) | 顯示/隱藏（D4.6，Schema v7 `visibility`，存進檔案）與遺失參考的修復（B4.3，`replaceRef`、候選帶指紋、「改用這個」按鈕） |
| [ADR 0019](docs/adr/0019-i18n-mechanism.md) | 多語系的機制（D9.1）：`@3db/i18n`、語意鍵加編譯期檢查的佔位、zh-TW 為來源語言、`npm run lint:i18n` 的「只減不增」基準（639 行待搬）、Worker 語言同步 |
| [phase0-verification.md](docs/phase0-verification.md) | Phase 0 驗收紀錄與 SW 人工核對步驟 |
| [phase1-verification.md](docs/phase1-verification.md) | Phase 1 驗收紀錄：三個示範零件、金樣與 TNP、驗收中發現的問題 |
| [phase3-plan.md](docs/phase3-plan.md) | Phase 3 的里程碑、驗收標準、需要的樣本與決定（決定 1–6 已確認；§5 數值暫時認定為 Pass） |
| [ADR 0050](docs/adr/0050-parts-list-and-exploded-view.md) | 零件表與爆炸視圖（3b-4，C15.16、C15.14，**組合件 Schema 5**）：`buildBom`（扁平／縮排、次組合件展開、排列與鏡射算數量、廠商／料號取自零件檔屬性）、CSV（BOM、引號）、`explosion`（步驟只存意圖，位移相加，展開／收合只是顯示，爆炸中不能動、STEP 仍是組裝位置） |
| [ADR 0051](docs/adr/0051-evaluation-tools.md) | 評估工具（3b-5，E1.1、E1.2、E2.1、E3.1，Schema 不變）：物質特性（慣性矩、主慣性矩、零件合成）、測量（精確距離、銳角、位姿與鏡射）、干涉檢查（頂層零組件、接觸不算、紅色重疊）、檢查模型幾何；7 項驗收與限制 |
| [phase4a-plan.md](docs/phase4a-plan.md) | Phase 4a 的里程碑、量化驗收（金樣）、預設假設（使用者沒有 SW 與真實工件，2026-10-03 決定先走完開發）、設計取捨與風險 |
| [phase5-plan.md](docs/phase5-plan.md) | Phase 5 工程圖的里程碑、預設假設（第一角、A3、ISO 128、PDF 中文字型內嵌）、量化驗收、風險 |
| [ADR 0068](docs/adr/0068-surface-bodies.md) | 曲面本體與核心的曲面方法（4b-1，零件 **Schema 28**）：`Kernel` 的偏移／縫織／填補／厚面／以曲面除料／投影分割（都量測間隙，0.05 mm）；曲面本體不是零件（質量、零件表、干涉、工程圖不算，STEP 當殼）；`offsetSurface` 特徵（核心；介面在 4b-3）；限制：轉 B 樣條在自由曲面邊的接合面會失敗、衍生零件與組合件顯示曲面本體還沒決定 |
| [ADR 0069](docs/adr/0069-split-line.md) | 分割線特徵（4b-2，零件 **Schema 29**）：草圖的封閉外圈沿法向投影到一個面，面被切成區域；區域面叫 `<特徵>:side:<草圖>.<圈>`、其餘保留原名，改草圖後名字不變；投影不到、面不見、草圖沒封閉都說原因；限制：沒有介面（4b-3）、線貼著週期面接縫會失敗、只投影外圈與封閉線 |
| [ADR 0070](docs/adr/0070-gauge-ui.md) | 分割線與偏移曲面的介面（4b-3）：功能區指令、PropertyManager 面板、編輯時顯示自己的結果（訊息框看得到失敗原因）、偏移曲面的量測間隙顯示（`FeatureResult.info`）、特徵自己的面不能選；限制：只用腳本驗證、視覺與畫布點選待使用者 |
| [ADR 0071](docs/adr/0071-surface-editing.md) | 縫織／填補／平坦／修剪／延伸曲面（4b-4，零件 **Schema 30**）：五個特徵與介面；縫織保留面名、結果是第一個本體；填補只有單一相鄰面的邊才相切，相切與 G0 都量測、不相切被拒；修剪＝投影分割＋保留一側（`keepFaces`）；延伸用 `BRepLib::ExtendFace`（試驗穩定，只限單一面的曲面本體）；限制：延伸限單一面、修剪只用外圈與草圖、清單是快照、只用腳本驗證 |
| [ADR 0072](docs/adr/0072-thicken-cut.md) | 厚面與以曲面除料（4b-5，零件 **Schema 31**）：厚面取代曲面本體成為實體、面名跟著模型；除料以曲面掃成刀具、曲面不變；STEP 輸出把偏移曲面轉成 B 樣條（轉換器中止時照原樣輸出並警告）；衍生本體保留曲面標記；組合件裡的曲面本體畫出來但不算零件；限制：厚面不保留曲面、除料只用平面法向、轉換後別的 CAD 讀不讀得進沒有試過 |
| [ADR 0073](docs/adr/0073-acceptance-4b.md) | Phase 4b 驗收 A 段（4b-6）：金樣工件（放樣自由曲面、含圓角的方塊，STEP 讀進來）做型面塊，間隙偏差 5e-5 mm、體積對辛普森與手算、接進 4a 夾具無干涉且塊到工件 3.000、剖面積手算；限制：**真實的沖壓件或塑膠件 STEP 待使用者**、剖面弧是折線、別的 CAD 讀 B 樣條沒試過 |
| [ADR 0074](docs/adr/0074-plastic-validation.md) | 塑膠件的技術驗證（6-0）：拔模角用**曲面本身在網格節點的法向**（網格平均法向在 5° 錐面差 0.1°、三角形法向差 0.38°、曲面法向 2e-15°）；底切＝沿拔模方向兩端的射線都被擋住（側孔壁 0%、沿拔模方向的孔 100% 可見）；厚度＝沿內法向的射線（均勻殼每面 2.000、楔形對手算、邊緣面量到整面牆高）；不等殼厚＝殼加 `moveFace`（地板 4 的盒子 19584）；唇溝＝`BRepOffsetAPI_MakeOffset` 的環（192 mm²）；發現：同一形狀的網格只做一次、暴力射線只夠小件 |
| [ADR 0075](docs/adr/0075-draft-analysis.md) | 拔模分析（6-1）：核心的 `draftAnalysis`（曲面法向在網格複本的節點上求值，每面最小與最大角、四類）、「工具」頁的分析視窗（方向、要求角度、各類面數與面積、各面角度、圖面上色）；分析不進文件、模型改了自動重算；限制：取樣只在節點、沒有連續色階與分模線、方向只有六軸與平面法向；教訓：`useStore` 的選擇器不能建新物件 |
| [ADR 0076](docs/adr/0076-undercut-analysis.md) | 底切分析（6-2）：包圍盒樹的射線（`buildBvh`/`anyHit`，對暴力法逐條相同）、核心的 `undercutAnalysis`（每個三角形一個取樣點，沿拔模方向兩端各射一條線，上方／下方／都看不到的比例，七類）、「工具」頁視窗與顏色；射線起點偏出網格容差的 0.75 倍（球赤道 5.6 mm² 的錯）；2.5 萬個三角形 0.4 秒；限制：只取三角形中心、門檻是我定的、只有一個拔模方向 |
| [ADR 0077](docs/adr/0077-thickness-analysis.md) | 厚度分析（6-3）：核心的 `thicknessAnalysis`（沿內法向射線、只算迎面的面、每面最小／**中位數**／最大、最薄最厚的地方、五類）、「工具」頁視窗與顏色（三個分析一次只開一個）；**拔模與底切共用的取樣 `forEachSample`**（每個面至少 400 個點，平的大面不再只有兩個點）；發現：邊角附近射線沿鄰牆走完全程所以最大與平均不可靠；空心球中位數誤差 0.15%、4.9 萬個三角形 0.85 秒；限制：定義與 SW 是否相同不知道、沒有連續色階、肋根的縮水風險沒做 |
| [ADR 0078](docs/adr/0078-unequal-shell.md) | 不等殼厚（6-4，零件 **Schema 32**）：薄殼的 `faceThickness`（先均勻做殼，再把由指定面長出的內側平面移動 `指定 − 壁厚`，用名稱追蹤，每步檢查位置與外包）、PropertyManager 的「壁厚不同的面」模式與清單、`setShell` 的選用參數；地板 4 的盒子 19584、加一面壁 3 是 20520；發現：地板厚過頭時 `moveFace` 回有效的本體（板長到本體外）所以要檢查外包；限制：只限平面的壁、結果在 ✔ 之後才看得到 |
| [ADR 0079](docs/adr/0079-lip-groove.md) | 唇與溝槽（6-5，零件 **Schema 33**）：`lipGroove`（平面、種類、離邊緣、寬度、高度）；核心的 `ringTool`（外輪廓向內偏移兩次的環，沿法向長出或切入，環要整個在面上否則拒絕）；面以輪廓的邊命名（外側 `side:ring.<邊>`、內側加 `~`）；環 192 mm²、唇 230.4、圓角矩形 185.13；限制：環只跟外輪廓、沒有自動的蓋子配合、`Intersection` 接合 |
| [ADR 0095](docs/adr/0095-closed-corner.md) | 封閉角落（H-6，C11.4，零件 **Schema 42**）：邊線凸緣的 `corner: {start?, end?}`（與鄰接凸緣的間隙）：折彎不變（仍由縮短躲開），折彎之後的平直段繼續長到離鄰接凸緣的內側剩這個間隙；找面向這一端並蓋住平直段中間的凸緣；平板型式的折彎窄、平直段寬；只做垂直於邊的鄰接凸緣，斜接／重疊／斷開角落沒做 |
| [ADR 0118](docs/adr/0118-dev-auto-close.md) | `npm run dev:auto`：最後一個連著的瀏覽器分頁關掉 30 秒後，開發伺服器自己結束（Schema 不變；`apps/web/dev/autoClose.ts`，`--mode autoclose`）；`npm run dev` 不變 |
| [ADR 0119](docs/adr/0119-movable-balloons-and-tables.md) | 號球與表格可以用滑鼠拖（工程圖 Schema 9：`balloonAt`；`buildScene` 回傳 `tableBoxes` 與 `balloons`；面板「號球自動排列」） |
| [ADR 0120](docs/adr/0120-relief-shapes.md) | 離隙的形狀：長圓（底端半圓）與撕裂（0.05 mm 細縫）（零件 Schema 50：`relief.shape`；平板型式共用 `relief.ts`） |
| [ADR 0121](docs/adr/0121-sheet-break-corner.md) | 鈑金斷開角落（零件 Schema 51）：獨立 `breakCorner` 特徵，凸緣自由端外角倒角或倒圓，折疊與平板型式同步 |
| [ADR 0122](docs/adr/0122-surface-cut-vector.md) | 以曲面除料的方向向量與保留側（零件 Schema 52）：任意 XYZ 向量、保留前側或後側，舊的平面方向相容 |
| [ADR 0117](docs/adr/0117-select-edges-idle.md) | 沒有在編輯時也能選邊線與頂點（Schema 不變）：`UiState.selectedElements`，Ctrl 加選；選擇濾器三個勾選平常也生效；圓角、導角、邊線凸緣、摺邊與三個曲面邊線指令開始時帶入已選的邊（預先選取） |
| [ADR 0116](docs/adr/0116-sketch-picture.md) | 草圖圖片（零件 **Schema 49**）：草圖上放 PNG／JPEG 當描圖底圖（`pictures`，資料是 `blobs/<sha>.png`／`.jpg`），不參加輪廓與關係，只在編輯那張草圖時顯示；以兩點校正比例；三個指令都能復原；eDrawings 存圖 → 描圖是沒有 SW 時的重建做法 |
| [ADR 0115](docs/adr/0115-flat-in-3d-view.md) | 在 3D 視窗顯示展開的狀態（Schema 不變）：平板型式視窗的勾選，worker 一起傳平板型式的網格，3D 視窗換成它，顯示時不能點選；沒有動畫 |
| [ADR 0114](docs/adr/0114-bent-base-flange-flat.md) | 折過的基材上的凸緣的平板型式（Schema 不變）：基材記路徑的每一段直線與它在條裡的起點，凸緣記 `host`；每一段有自己的運動，凸緣的運算沿用；六種擺法的長度與面積手算 |
| [ADR 0113](docs/adr/0113-cuts-in-flat-pattern.md) | 折彎之後才切的孔進平板型式（Schema 不變）：重算時記下基材凸緣之後各特徵拿走的材料（`SheetInfo.cuts`），平板型式用每一塊板的運動放回去；折彎裡、跨部分、折過的基材做不到的列在 `notIncluded` 並在視窗說明；孔位置與面積手算 |
| [ADR 0112](docs/adr/0112-thicken-sharp-edge.md) | 厚面遇到尖角時拒絕（Schema 不變）：根因是 OCCT 簡單厚面不在尖角算交線；用面與網格各算一次體積，差超過 0.5% 就拒絕並說明 |
| [ADR 0111](docs/adr/0111-mid-bend.md) | 中間折彎（S-3，零件 **Schema 48**）：`midBend`（草圖一條線、角度、半徑、固定側、方向）；三塊（不動、折彎區、轉的）＋剛體運動，折彎區必須是單純長條；平板型式＝原來的板加一條折彎線；限制：只對封閉輪廓的板、前後都不能有凸緣、一個零件一個、折彎區不能有孔 |
| [ADR 0110](docs/adr/0110-miter.md) | 邊線凸緣的斜接（S-2，零件 **Schema 47**）：`miter`＝兩凸緣的間隙；45° 垂直面，鄰居切回、這個凸緣延長再切回；平板型式在角落是折彎中立層的曲線（24 段）；只做兩個 90°、同半徑、材料在內、垂直相鄰的凸緣；體積與面積都對手算 |
| [ADR 0109](docs/adr/0109-mutual-trim.md) | 互相修剪曲面（P-3，零件 **Schema 46**）：`mutualTrim`（`a`、`b`、`discard`）；核心 `trimSurfaces`（一般融合＋合併同曲面的面）；片沿用原面名、分成幾片加 `#k`；點一片去掉；限制：兩個自由曲面互相相交沒測、片數變了名字可能對不上；順手記下：厚面在尖銳折彎的體積（924 vs 手算 1140）未解 |
| [ADR 0108](docs/adr/0108-thicken-both-keep.md) | 厚面的「兩側」與「保留曲面」（零件 **Schema 45**）：`both`、`keepSurface`；兩側＝偏移半厚再加厚（不做融合）；保留曲面時實體是新本體、面名前加 `copy`；限制：只有對稱、急彎曲面未測 |
| [ADR 0107](docs/adr/0107-snap-hook-window.md) | 卡榫的「鉤下面的窗」做成選項（零件 **Schema 44**）：`windowClearance`、`windowDepth`；窗從樑前面到鉤尖再加間隙、兩側加間隙，尺寸從鉤算出；底切分析確認有窗時卡面不是底切；面板勾選；限制：窗只有矩形、深度手填 |
| [ADR 0106](docs/adr/0106-flat-pattern-in-drawing.md) | 工程圖的展平圖（S-1，**工程圖 Schema 6**）：視圖方向 `flat`，worker 用 `sheet` 做 `flatPattern` 轉成視圖線（外形與孔實線、折彎線 `center` 鏈線），不能再投影或剖面（細部放大可以）、還不能標註尺寸；非鈑金件寫原因；手冊 I6；限制：沒有折彎表與註記 |
| [ADR 0105](docs/adr/0105-form-sub-assembly.md) | 形成次組合件（E-3，Schema 不變）：選的零組件與兩端都在其中的結合進新的 `.3dba`（位置取解出來的、裡面沒有固定的就固定第一個），組合件留一個代表它的零組件在原點（零件都不動）；一端在外面的結合改成通過次組合件（`path`）、爆炸步驟改名；排列／鏡射用到的拒絕；指令 `formSubAssembly` 一步復原、`FormSubPanel`、檔寫在組合件旁邊；金樣夾具手算 < 1e-6；限制：不能選資料夾、沒有解散 |
| [ADR 0104](docs/adr/0104-several-exploded-views.md) | 多組爆炸（E-2，**組合件 Schema 7**）：`explosions: ExplodeView[]`（id、名稱、步驟）與 `activeExplosion`；舊的 `explosion` 在 6 → 7 遷移成「爆炸視圖1」；既有的步驟指令作用在顯示中的那一組（沒有時建第一組）；新指令 `insertExplosion`／`renameExplosion`／`deleteExplosion`／`setActiveExplosion`；刪除零組件清掉各組的步驟；面板「爆炸視圖組」（下拉、新增、刪除、改名）；限制：只能移動頂層零組件 |
| [ADR 0103](docs/adr/0103-explode-lines-animation.md) | 爆炸線與動畫（E-1，檔案格式不變）：每個被爆炸的零組件一條深藍虛線（從組裝位置的包圍盒中心經過每個步驟之後的位置，`explosionOffsets.paths`、`leavesCentre`、`Viewer.setGuides`）；爆炸與收合半秒緩入緩出（`explodeT`、`EXPLODE_MS`，`exploded` 仍是目標）；面板「顯示爆炸線」；限制：背景分頁時動畫暫停、每段是直線 |
| [ADR 0102](docs/adr/0102-dxf-dimension-entities.md) | DXF 的 DIMENSION 圖元（D-2）：每個尺寸一個 DIMENSION＋匿名圖塊 `*D<n>`（原來的線、箭頭、字，看圖軟體照畫）；字用 `1` 蓋寫成模型算好的字；種類 線性（旋轉／對齊）、直徑、半徑、二線角度，定義點取自繪圖時算好的紙面座標；DIMSTYLE `STANDARD`；`Scene.dimensions` 與項目的 `group`（SVG／PDF 不變）；`readDxf`／`checkDxf`／`dimensionMeasure`／`drawnEntities`；**沒有真正的 CAD 開過**（手冊 F6） |
| [ADR 0101](docs/adr/0101-hole-callouts-thread-countersink.md) | 螺紋孔與錐孔的孔標註（D-1）：錐孔讀形狀（孔口的圓錐：口徑與夾角）、螺紋讀特徵（`holeFeatures`，包括衍生本體的主模型；形狀上它只是底孔）；`M6 貫穿（底孔 Ø5）`、`錐孔 Ø12 90°`；定位銷入口的導角在有特徵時不當錐孔；自動尺寸有孔標註時只併註記相同的孔；孔表同字；`孔標註.3dbx` 進驗證包；限制：螺紋深＝鑽孔深、匯入模型的導角讀成錐孔 |
| [ADR 0100](docs/adr/0100-drawing-angle-dimension.md) | 工程圖的角度尺寸（工程圖 **Schema 5**）：`angle`（兩個面或直線邊、弧半徑、補角）；夾角是從兩線交點朝各元素中間伸出的射線所夾的角；視圖特徵加 `slant`（斜面）；弧畫成折線、延伸線、箭頭；手冊 F3 加一步；同日命令列改成下拉選單（按需展開）；限制：介面只列平面、DXF 仍不是 DIMENSION 圖元 |
| [ADR 0099](docs/adr/0099-sketch-snapping.md) | 草圖吸附與推斷（S-1 到 S-4）：一個決定點 `updateSnap`、優先順序（點與中點 → 模型點 → 交點 → 四分之一點 → 切點與垂足 → 圖元上 → 模型邊 → 推斷 → 對齊 → 長度／角度／網格）、按下去加的關係、`SnapSettings`（總開關、逐項、網格與角度預設不啟用）與快速抓取；限制：沒有「平行」抓取（用推斷）、網格不畫格線 |
| [ADR 0098](docs/adr/0098-fillet-by-face.md) | 圓角與導角選面、面圓角、完整圓角（零件 **Schema 43**）：存面不存邊、每次重算展開（略過接縫、單鄰面與相切的邊）；導角距離 1 量在選的面上；面圓角＝兩組面相接的邊（不相接明確拒絕）；完整圓角用布林切除半圓柱外的條狀區域並檢查體積（中央面要長方形、側面平行且不比半徑矮）；介面的圓角種類與面組；手冊 C23 到 C25；限制：不相鄰的面圓角、兩側不平行的完整圓角、變數半徑、選特徵與迴路沒做 |
| [ADR 0097](docs/adr/0097-fillet-by-face-validation.md) | 圓角與導角選面的技術驗證（F-0，[計畫](docs/fillet-by-face-plan.md)）：對面的所有邊倒圓角的頂點是斜接（手算與 OCCT 差 2e-10）、導角距離 1 量在選的面上、`Kernel.smoothEdges` 找相切邊、完整圓角不能用兩個圓角（R=w/2 失敗、略小留細條）所以用布林切除（精確）、凹邊補料、不相鄰的面沒有做法（明確拒絕） |
| [ADR 0096](docs/adr/0096-inventory-cleanup.md) | 鞏固 H-11 全面盤點與清理：移除沒用到的 import／匯出／只寫不讀的欄位（不改行為）、handoff 與 README 對齊現況、資安與隱私盤點（私人倉庫、無金鑰）；沒有 DEV_LOG.md 與 wiki/（單一來源是 handoff＋ADR＋git log）；跨電腦開發（`npm run doctor`、行尾規則 `eol=lf`）；桌面版安裝檔已用 4a–7 重建（2026-10-04） |
| [ADR 0094](docs/adr/0094-random-tests.md) | 鞏固 H-5：種子固定的隨機零件測試（鈑金溫和 36＋嚴苛 60、鏈 24、折過的基材 24、塑膠 40、一般零件 40）檢查任意參數都必須成立的性質；找到並修了兩個真問題：自己穿過自己的鈑金輪廓做出無效實體卻說成功、螺柱的肋四片以上面名重複；限制：只證明沒找到反例，引擎仍不檢查每個特徵的結果是否有效；補充 H-9：隨機組合件（疊塊、結合位置、3 自由度、干涉體積）與隨機工程圖（視圖、剖面、標註、SVG／DXF／PDF 讀回）也通過，沒有新問題；補充 H-10：距離加齊平、銷插孔、有圓角倒角的工程圖也通過 |
| [ADR 0093](docs/adr/0093-hole-draft-hem-rule.md) | 鞏固 H-4（零件 **Schema 41**）：螺柱 `holeDraft`（孔往孔底縮小，孔徑指孔口，空白＝直孔，不遷移；「同外壁」鈕；金樣的螺柱孔 +1.000° 不再需要拔模）；`sheetChecks` 的最小半徑略過摺邊（180°），金樣九項檢查全過 |
| [ADR 0092](docs/adr/0092-naming-merge.md) | 鞏固 H-1：併面時舊面保留原名（`faceBaseName` 同種來源取索引小的，本體在前）；修好 ADR 0085 的缺口：凸緣可以以任何順序做、在板上點的邊不再因別的凸緣併面而遺失；9 項測試（三種順序、塊上兩個共面凸台、前面插入基準面、壓抑再恢復） |
| [ADR 0091](docs/adr/0091-acceptance-7.md) | Phase 7 驗收 A 段（7-8）：金樣支架（板 120 × 60 × 1.5 加兩個孔、90° 凸緣縮短加離隙、135° 凸緣、摺邊）；摺疊的體積、平板大小與面積、折彎線、DXF 讀回、檢查全對手算；K 0.4（量規）、板長 140、板厚 2 全部跟著；找到：摺邊的內側半徑 0.5 在起始比例下不過檢查、相鄰邊的凸緣要手動縮短 |
| [ADR 0090](docs/adr/0090-gauge-checks.md) | 量規表與可製造性檢查（7-7，零件 **Schema 40**）：`PartDoc.sheetGauges`（名稱、板厚、內側半徑、K；沒有預設列，套用 = 複製數字進基材凸緣，不連動）；`sheetChecks`：內側半徑、折彎後平直段、孔到折彎區、縮短沒離隙，比例在平板型式視窗裡改（預設是我的起點，不是標準），每個檢查都回報過不過；孔距 4.0／2.0／1.0 對手算；限制：孔只認圓、規則不隨材料變 |
| [ADR 0089](docs/adr/0089-flat-pattern-dxf.md) | 平板型式的 DXF（7-6）：`flatPatternDxf`（`OUTLINE` 層的真 LINE／ARC／CIRCLE、`BEND` 層的虛線折彎線加註記 `UP 90° R2`、`T=… K=…`，移到原點）；`toDxf` 多 `extras`、`readDxf`／`checkDxf` 認得 LINE／ARC／CIRCLE；平板型式視窗的「輸出 DXF」；限制：沒有用真的 CAD／CAM 開過、沒有折彎表、沒有進工程圖 |
| [ADR 0088](docs/adr/0088-flat-pattern.md) | 平板型式（7-5，檔案格式不變）：`flatPattern(kernel, sheet)` 從折彎資料算（不展開實體）：基材放著、每個凸緣用剛體運動（折彎轉回去 + 移一個裕度）接在長出它的那一片上，核心做一片薄實體，輪廓與折彎線從它讀；127.3197 長（90° 凸緣）、摺邊 111.927、45° 129.2604、U 形槽展開 94.639 × 40；K 0.5 體積守恆；視窗（SVG、尺寸、折彎表）；限制：折過的基材上的凸緣沒做、沒有 3D 視圖的展開切換 |
| [ADR 0087](docs/adr/0087-insets-reliefs.md) | 凸緣縮短與離隙（7-4，零件 **Schema 39**）：邊線凸緣與摺邊的 `inset`（兩端各縮短，起端 = 面在前方外側在右手時開始的那端）與 `relief`（縮短處旁的矩形缺口）；相鄰邊的凸緣在角落留縫不再相貼；缺口 11.25 mm³ 對手算；限制：沒有封閉／斷開角落、離隙只有矩形、自動離隙要手填 |
| [ADR 0086](docs/adr/0086-hem.md) | 摺邊（7-3，零件 **Schema 38**）：`hem`（180° 折彎、間隙 = 兩層內側面的距離、回折的平直段；閉合摺邊就是很小的間隙）；與邊線凸緣共用 `foldEdge`（7-2 測試不改全過）；間隙 1 長 10 材料在內 8394.52 mm³；**凸折（板中間）沒做**——需要切開實體並移動一半的新核心操作，邊上的凸折用兩個邊線凸緣組成；限制：沒有淚滴與捲邊 |
| [ADR 0085](docs/adr/0085-edge-flange.md) | 邊線凸緣（7-2，零件 **Schema 37**）：`edgeFlange`（點板端面的一條直邊；長度從外側／內側虛擬交點或折彎之後量、角度、半徑、材料在內或折彎在外、往另一面折）；折彎是端面斷面繞中心旋轉、凸緣是同一斷面沿切線拉伸；板切掉的與加上去的體積逐步檢查；板 100 × 50 × 1.5 90° 長 30 材料在內 9548.98 mm³、45° 外側角在虛擬交點 + 30；凸緣上的凸緣；限制：只有直邊整條寬度、併面改名使邊線參考在重排特徵後會遺失、編輯時看不到結果 |
| [ADR 0084](docs/adr/0084-base-flange.md) | 鈑金參數與基材凸緣（7-1，零件 **Schema 36**）：`baseFlange`（板厚、內側半徑、K 因子；封閉輪廓是平板、開放折線是折過的板，轉角自動倒圓：轉向板厚那邊倒 r+T、轉離倒 r，內側半徑永遠是 r）；折彎資料 `RebuildResult.sheet`（裕度 θ(r+K·T)、展開長度 = 直段 + 裕度）；U 形槽 5678.3 mm³、展開長度 94.639、K 0.5 體積守恆；功能區新增「鈑金」頁；限制：只有基材凸緣、折線只能是直線、半徑整個零件一個 |
| [ADR 0083](docs/adr/0083-sheet-metal-validation.md) | 鈑金的技術驗證（7-0）：折彎是旋轉的矩形（45°–180° 體積 θ·T·w·(r + T/2)）、板＋折彎＋凸緣一個有效實體 10073.98 mm³、K = 0.5 的體積守恆是平板長度唯一獨立的檢查、折過的輪廓一次拉伸、角落留缺口；決定特徵原生、不展開任意實體；沒有改產品程式 |
| [ADR 0082](docs/adr/0082-acceptance-6.md) | Phase 6 驗收 A 段（6-8）：金樣外殼（壁 2、底 3 為變數、拔模 1°、唇、兩個螺柱、卡榫與底窗）與蓋；體積對手算積分、拔模 ±1.000°、底切恰好 187.2 mm²（卡榫自己）、厚度 2.000／3.000、蓋進 4a 的干涉（無；缺窗時 36 mm³）；找到：卡榫站在底上是底切（要在底開窗）、螺柱的孔沒有拔模；e2e 加 `H.tidy()` |
| [ADR 0081](docs/adr/0081-snap-hook-catch-vent.md) | 卡榫、窗、排氣口（6-7，零件 **Schema 35**）：`snapHook`（懸臂樑加楔形鉤，一個截面拉出寬度）、`snapCatch`（矩形窗）、`vent`（一排槽，可圓頭）都取草圖的自由點；窗與槽共用一個方法；面以點與槽號命名（蓋面改名成 `floor`／`lid`）；窗在殼的開口方向上被底切分析找到；限制：深度手填、沒有穿過第一道壁就停、不算樑的應變 |
| [ADR 0080](docs/adr/0080-screw-boss.md) | 螺柱（6-6，零件 **Schema 34**）：`screwBoss`（草圖的自由點上各一根柱：外徑、先導孔、高度、孔深、外壁拔模、三角形肋）；柱是旋轉的截面（埋進本體 0.5 mm 以接上，沒接到本體就是錯誤）、肋是通過軸的平面上的三角形、面以點與部位命名，殼的底厚改了螺柱跟著；柱 233.656 mm³、肋對數值積分；限制：孔徑手填、只長一個方向、只有三角形肋 |
| [sketch-snapping-plan.md](docs/sketch-snapping-plan.md) | 草圖吸附與推斷（參照 SW，**已規劃、未排入開發**）：現況與缺口、SW 的行為（出處是 SW 2010 繁中說明）、做法、里程碑 S-0 到 S-5 與量化驗收、風險與預設假設 |
| [phase7-plan.md](docs/phase7-plan.md) | Phase 7 鈑金的里程碑、預設假設（K 因子 0.5、半徑 = 厚度、外側虛擬交點、特徵原生不展開實體…）、驗收、風險 |
| [phase6-plan.md](docs/phase6-plan.md) | Phase 6 塑膠件的里程碑 6-0 到 6-8、預設假設（分析不是特徵、拔模四類、底切＝兩端被擋、厚度定義、不等殼厚只限平面、卡榫是簡化版）、驗收用金樣（與手算一致，SW 對照待使用者）、風險 |
| [ADR 0067](docs/adr/0067-surface-validation.md) | 檢具曲面的技術驗證（4b-0）：偏移（誤差 1e-6 到 3e-5 mm）、縫織、填補、厚面、投影分割、以曲面除料都可行；**偏移失敗時給有效但錯的形狀，必須量測結果**；整體偏移要包成實體、厚面要檢查反向、偏移曲面輸出轉 B 樣條 |
| [phase4b-plan.md](docs/phase4b-plan.md) | Phase 4b 檢具的里程碑、預設假設（間隙檢查 0.05 mm、曲面本體不是零件…）、驗收、風險 |
| [ADR 0066](docs/adr/0066-acceptance-5.md) | Phase 5 驗收 A 段（5-6）：4a 夾具的基板加工圖（過兩個 Ø6 H7 孔的剖面 1319.5 mm²、孔表、尺寸與公差）與組合圖（零件表、四個號球），手算、DXF／PDF 讀回；改主模型後圖跟著變；修正有倒角的孔被當成盲孔 |
| [ADR 0065](docs/adr/0065-dxf-and-pdf-output.md) | DXF（AC1015，`\U+XXXX`）與 PDF（向量、Helvetica、可內嵌 TrueType 子集）輸出（5-5，F3.1、F3.2）：三種輸出同一個場景；自寫的 DXF／PDF／TrueType 讀取器與檢查；限制：**尺寸是線與文字不是 DIMENSION 圖元**、**尚未在真實 CAD 與 PDF 檢視器開過（使用者待辦）**、PDF 字型每次要重選 |
| [ADR 0064](docs/adr/0064-assembly-drawing.md) | 組合件工程圖（5-4b，C16.6，Schema 4 不變）：組合件當視圖來源（讀齊零件、解結合、去掉隱藏與參考本體）；零件表（3b-4 的 BOM 畫成表）；零件號球（質心、沿視圖外緣滑開）；「新工程圖」從開啟的組合件；限制：號球不能拖、組合件視圖沒有尺寸與孔表 |
| [ADR 0063](docs/adr/0063-annotations-and-hole-table.md) | 中心記號與中心線、孔標註、孔表（5-4a，C16.5、C16.6，**工程圖 Schema 4**）：由零件算出不存；`holeInfo`（貫穿、盲孔、深度、沉頭）；孔表（字母分組、從左下平面量起、公差等級）；限制：不看螺紋與錐形沉孔、隱藏的孔也畫中心記號 |
| [ADR 0062](docs/adr/0062-dimensions.md) | 尺寸與公差（5-3，C16.4，**工程圖 Schema 3**）：尺寸存持久名稱不存數值（零件改了跟著走）；線性／直徑／半徑；自動尺寸（總長寬、孔徑與圓弧、孔位置）；ISO 286 公差（`H7`、`m6`…，IT5–IT12、500 mm 內）；畫法（箭頭、延伸線、導線）；限制：不能在畫布點選元素、沒有角度與孔深標註 |
| [ADR 0061](docs/adr/0061-derived-drawing-views.md) | 投影、剖面與細部放大視圖（5-2，C16.3，**工程圖 Schema 2**）：視圖四種聯集（衍生視圖不存來源與視角）；投影視圖的視角與對齊；剖面線箭頭、切平面、`Kernel.sectionView`（布林切除＋HLR＋切面外框）；45° 剖面線（奇偶規則）；細部圓裁切；面板數字輸入；限制：只有單一水平或垂直剖面、沒有畫布拖曳 |
| [ADR 0060](docs/adr/0060-drawing-document-and-views.md) | 工程圖文件 `.3dbd`（5-1，C16.1、C16.2，**工程圖 Schema 1**）：只存圖頁、標題、視圖；`Kernel.projectView`（精確 HLR，被可見線蓋住的隱藏線拿掉）；`@3db/drawing`（圖頁、第一角排版、場景、SVG）；`DrawingStore` 與畫布；限制：只畫零件、沒有剖面與尺寸與 DXF／PDF |
| [ADR 0059](docs/adr/0059-acceptance-4a.md) | 4a 驗收 A 段（不需樣本）：自製方塊工件的夾具從主模型到衍生零件、圖庫的銷與螺絲結合、干涉／餘隙／取放空間、零件表、STEP 往返、改基板厚度；B 段待使用者；面上草圖的原點是零件原點的投影 |
| [ADR 0058](docs/adr/0058-clearance-and-collision.md) | 餘隙確認、取放空間與拖曳碰撞偵測（4a-5，E2.2、A3.6，Schema 不變）：精確距離、保守前進＋二分找接觸、拖曳停在接觸前並標紅、`involving` 篩選、20 零組件 4–7 ms |
| [ADR 0057](docs/adr/0057-standard-parts-library.md) | 標準件圖庫（4a-4，F6.1，Schema 不變）：新套件 `@3db/library`，內六角螺絲／定位銷／平墊圈（ISO 4762／8734／7089）用變數做成零件檔，插入面板的「標準件圖庫」；廠商 STEP＝專案資料夾；沒有螺紋 |
| [ADR 0056](docs/adr/0056-dowel-pin-holes.md) | 定位銷孔（4a-3，C4.8，**零件 Schema 27**）：異型孔第五種 `dowel`（公差等級 H6／H7／H8、入口導角）、ISO 286-1 表（`dowel.ts`）、孔以標稱直徑做出（壓入的銷不被當成干涉）、面板顯示配合 |
| [ADR 0055](docs/adr/0055-advanced-mates.md) | 進階結合（4a-2，C15.9，**組合件 Schema 6**）：寬度、相互對稱、距離／角度的限制；求解器的結合泛化成 N 個端點；限制是「超出範圍的量」的殘差（距離剛好落在界線、角度可能在界線內側）；介面的進階結合與最小／最大欄位 |
| [ADR 0054](docs/adr/0054-derived-bodies.md) | 衍生本體與從本體產生組合件（4a-1，C7.5，**零件 Schema 26**）：`derivedBody`（只存來源與本體 id）、`SourceProvider`、名稱沿用主模型、內容鍵含主模型、零件表排除參考零件；限制：不即時更新、跨零件不共用主模型重算 |
| [ADR 0053](docs/adr/0053-acceptance-3b.md) | 3b 驗收 A 段（3b-7，不需樣本）：金樣夾具 STEP → 檔案 → 再輸出，平的與巢狀；B、C 段待使用者；測試支援 `goldenJig.ts`、`stepRoundTrip.ts` |
| [ADR 0052](docs/adr/0052-desktop-shell.md) | 桌面版（3b-6，F8.1）：Tauri 2 包網頁版，`files.ts` 不改（WebView2 的選擇器可用）、NSIS、離線；驗收第 3、7 項待使用者；`useLocalToolsDir` 的坑 |
| [ADR 0049](docs/adr/0049-step-assembly-import.md) | STEP 組合件輸入（3b-3，F2.8，Schema 不變）：`Kernel.readAssemblyStep`（階層、名稱、剛體位置、零件形狀、面顏色）、`stepAssemblyPlan`／`stepAssemblyFiles`（一個產品一個檔案：`.3dba`、`組件/`、`零件/`）、「檔案」→「輸入 STEP 組合件…」（每次選資料夾，寫入模式）、組合件輸出帶面顏色、顏色往返；金樣夾具 15 個零組件匯入 129 ms |
| [ADR 0048](docs/adr/0048-component-patterns-and-mirrors.md) | 零組件的複製排列與鏡射（3b-2，**組合件 Schema 4**）：只存定義（`patterns`，可省略）、實例是衍生位姿跟著種子、方向與軸可選組合件軸或零組件的元素、鏡射件在載入時由原件算出（不另存檔，取代決定 4）、`mirroredPose`、STEP 的鏡射產品；2a–2d 都做完 |
| [ADR 0047](docs/adr/0047-rigid-sub-assemblies.md) | 剛性次組合件與零組件隱藏／抑制／透明（3b-1，**組合件 Schema 3**）：次組合件是 `.3dba` 檔的零組件、`MateRef.path` 帶路徑的參考、父層視為一個剛體、旗標是可省略欄位、`findReferenceCycle` 讀檔偵測循環；1a–1e 都做完（巢狀 STEP 輸出、帶路徑的結合、抑制／隱藏／透明） |
| [ADR 0046](docs/adr/0046-phase3b-technical-validation.md) | 3b-0 技術驗證（2026-10-02）：鏡射零組件＝鏡射零件檔加剛體位姿（面序不變，OCCT 雖寫得出 det −1 的位姿但只有它自己讀過）、干涉檢查（20 個小零件 190 對 1.0 s，包圍盒先濾 0.5 s，Worker 內按需執行）、STEP 巢狀組合件讀回的結構對應（原型→零件檔、組合件原型→次組合件、只取每層相對位姿）、桌面版只做了調查（缺 Rust 與 MSVC，等使用者決定安裝）；證據 `spikes/occt-gaps/phase3b-validation.test.ts` |
| [ADR 0045](docs/adr/0045-acceptance-3a.md) | 3a 驗收（3a-10）不需樣本的部分：`tests/support/acceptance.ts`（對稱差、與參考形狀比對、關鍵尺寸 50%–200% 掃描）、`tests/phase3/acceptance.test.ts`（工具自測、三個金樣與兩類合成零件共 15 個關鍵尺寸 × 5 值全過）；§5 逐項狀態；等使用者的 3 個零件 |
| [ADR 0044](docs/adr/0044-system-options-english.md) | 系統選項與英文（3a-9c-3，Schema 不變）：`options.ts`（localStorage `3db.options`、`parseOptions`）、`OptionsDialog`、`Autosaver.enabled/delayMs/cancel`、`packages/i18n/src/en/`（860 多個文字全翻）；零件側文字已搬，程式碼裡剩 183 行（組合件） |
| [ADR 0043](docs/adr/0043-selection.md) | 選取（3a-9c-2，Schema 不變）：`three-mesh-bvh`（indirect，一條射線 10 ms → 0.13 ms）、`pickFilter`、右鍵選單（選取其他、相切邊線／面、迴圈）、`selectionSets.ts` 的 `Topology`（由名稱＋網格，10° 門檻）、`store.pickMany` |
| [ADR 0042](docs/adr/0042-view-options.md) | 顯示類型、視角選擇方塊、剖面視圖（3a-9c-1，Schema 不變）：`DisplayMode` 五種、`Viewer.cubeMatrix`／`subscribeView`、軸向剖面（裁切平面）、`contentBounds`；透視（D4.5）未做；順便修了指令列撐寬畫面 |
| [ADR 0041](docs/adr/0041-tree-order-folders-templates-shortcuts.md) | 設計樹的順序與資料夾與註解、範本、快速鍵（3a-9b，**Schema 25**）：`arrange` 指令（整個新順序加資料夾，一個復原步驟）、`orderProblem` 由父子關係檢查、拖放、資料夾要連續、註解／標籤／過濾、重新命名、`createPartFromTemplate`、`shortcuts.ts`（localStorage 覆寫） |
| [ADR 0040](docs/adr/0040-autosave-and-text-tools.md) | 自動存檔與當機復原（3a-9a）：存零件檔位元組進 IndexedDB、最後一次變更後 5 秒、頁面藏起來立刻存、下次開啟問復原或捨棄；`scripts/3dbx.mjs`（cat／unpack／pack）與 `npm run setup:git` 讓 `git diff` 看得到 `.3dbx` 裡的文字；B3.2／B3.4 量過不需要（53 個特徵 0.85 秒） |
| [ADR 0039](docs/adr/0039-output.md) | 輸出（3a-8c）：自寫二進位 STL（用文件設定的網格品質）、STEP 先問選項（AP214／AP242、顏色、座標系統）、座標系統當輸出座標系（`intoFrame`）、影像輸出（PNG）、AP242 設定要等第一個寫入器做出來才存在的陷阱 |
| [ADR 0038](docs/adr/0038-appearance.md) | 外觀與顏色（3a-8b）：零件／本體／特徵／面四種對象與優先序、`faceColors` 一處算出畫面與 STEP 用的顏色、STEP 面色以 sRGB 寫入、參考本體不輸出 |
| [ADR 0037](docs/adr/0037-material-and-settings.md) | 材質、質量與文件設定（3a-8a，**Schema 24**）：材質存名稱與密度（內建表複製進文件）、質量＝體積×密度、製圖標準／尺寸小數位數／顯示與輸出品質 |
| [ADR 0036](docs/adr/0036-mirror.md) | 鏡射（3a-7c，**Schema 23**）：`mirror` 特徵（對象是特徵或本體）、特徵的鏡射就是只有一個實例的排列（共用 `repeat`）、本體鏡射走既有的 `apply`（合併或獨立本體）、面名稱 `<鏡射>:mirror:<原名>`、鏡射面是任何平面、3a-7 驗收標準逐項 |
| [ADR 0035](docs/adr/0035-patterns.md) | 線性與環狀複製排列（3a-7b，**Schema 22**）：排列的是種子特徵對本體加上與移除的材料（幾何圖樣：之前與之後的本體相減）、實例的面名稱 `<排列>:inst<標籤>:<原名>`、`count` 型別的運算式、`Kernel.transformed`（3 × 4 矩陣）、要跳過的實例、三種可讀的錯誤（沒碰到本體、成了分開的一塊、互相重疊） |
| [ADR 0034](docs/adr/0034-reference-geometry.md) | 參考幾何（3a-7a，**Schema 21**）：基準面的平行／垂直／中間／相切、`refAxis` 基準軸、`refPoint` 參考點、`coordSys` 座標系統（永遠右手系）；`kind: 'datum'` 的參考指向基準特徵 ID；`defRefs`／`mapDefRefs` 一處管所有定義的參考；選取方塊的一張表 `datumSlots.ts`；屬性管理員的基準按鈕（開著屬性管理員時設計樹被蓋住）；圖面顯示 |
| [ADR 0033](docs/adr/0033-rib.md) | 肋材（3a-6d，**Schema 20**）：`rib` 特徵（草圖裡一條直線＋厚度＋厚度的位置＋反轉）、牆在草圖面內垂直於線長到本體（既有的「伸長至本體」加接合）、不自動選方向而是說明要反轉、面名稱 `<肋材>:side:<草圖>.<線>.neg／pos／end1／end2` 與 `cap:start` |
| [ADR 0032](docs/adr/0032-loft.md) | 疊層拉伸（3a-6c，**Schema 19**）：`loft` 特徵（截面草圖依序，每張一個封閉輪廓、沒有洞）、`ThruSections` 平滑通過（兩個截面時是直紋，不提供直紋選項與原因）、截面對齊交給 OCCT、面用第一個截面的邊命名、結果必須是有效實體、`Kernel.bounds` 對平滑曲面偏大的觀察 |
| [ADR 0031](docs/adr/0031-sweep.md) | 掃出（3a-6b，**Schema 18**）：`sweep` 特徵（輪廓草圖＋路徑草圖，路徑一條開放的線與圓弧）、從路徑落在輪廓平面上的那一端開始、跟隨路徑（修正的 Frenet）、封閉路徑 OCCT 給體積 0 所以拒絕、面名稱 `<掃出>:side:<輪廓草圖>.<輪廓圖元>@<路徑圖元>`（兩個產生清單的交集）、有洞的輪廓＝外輪廓掃出減洞掃出、結果必須是有效實體 |
| [ADR 0030](docs/adr/0030-hole-wizard.md) | 異型孔精靈（3a-6a，**Schema 17**）：`hole` 特徵（草圖的每個單獨點、四種孔、內建 ISO 表只存運算式）、旋轉刀具＋除料、面名稱 `<孔>:side:<草圖>.<點>.<部位>`、`includedAngle` |
| [ADR 0029](docs/adr/0029-draft-feature.md) | 拔模特徵（3a-5c，**Schema 16**）：`draft` 特徵（中立面＋面＋角度＋反轉）、方向規則（離中立面越遠越窄）、與伸長拔模共用 `Kernel.draftFaces`、`ModifiedShape` 讓名稱不變、切線相連的面要一起選、薄殼「OCCT 回報完成卻原封不動」的防呆 |
| [ADR 0028](docs/adr/0028-shell.md) | 薄殼（3a-5b，**Schema 15**）：`shell` 特徵（移除面＋壁厚＋向外）、MakeThickSolid、面的演化（保留 same／開口環 modified／內側 generated from face）、命名 `<薄殼>:shell:<原面>` 與一個曾踩到的命名錯誤、壁厚太大是可讀的錯誤 |
| [ADR 0027](docs/adr/0027-extrude-revolve-p1.md) | 伸長與旋轉的 P1（3a-5a，**Schema 14**）：成形到下一面（從幾何決定）／至頂點（只是深度）／至本體／從曲面偏移（只做平行平面）、方向 2（遠端蓋叫 `cap:start`）、拔模（先伸長再 DraftAngle，面靠 `ModifiedShape` 找回，名稱不變）、薄件（自己的精確偏移，環與帶，面名加後綴） |
| [ADR 0026](docs/adr/0026-sketch-entities-that-follow-the-model.md) | 跟著模型走的草圖圖元（3a-4d，**Schema 13**）：參考圖元是帶 `ref` 的一般圖元、重算時依模型移動並固定（圓弧固定圓心、起點與弦長）、只轉直線與平行於草圖面的圓／圓弧、面的外框、貫穿、遺失參考是草圖的錯誤、投影在 Worker 做 |
| [ADR 0025](docs/adr/0025-sketch-diagnosis-check-and-contours.md) | 草圖的衝突診斷、檢查與修復、輪廓選取（3a-4c，**Schema 12**）：診斷只列求解器證實有效的處理、六種檢查問題與只做不需要決定的修復、輪廓用外圈圖元 ID 記住並以共用一半以上找回、沒有選擇就是全部 |
| [ADR 0024](docs/adr/0024-sketch-relations-and-driven-dimensions.md) | 草圖 P1 限制條件與從動尺寸（3a-4b，**Schema 11**）：同心同徑與交錯是一個限制條件、合併是操作（兩點之間有尺寸就拒絕）、弧長尺寸、從動尺寸（`driving: false`）的建立／改回與被運算式引用時的拒絕、過多定義的尺寸改成從動、從動顯示量到的值 |
| [ADR 0023](docs/adr/0023-sketch-tools-p1.md) | 草圖工具 P1（3a-4a，Schema 不變）：每個工具是一個回傳 `SketchEdit` 的純函式、`editSketch` 指令的順序、圓角／導角的虛擬交點、狹槽／多邊形的自由度、靜態鏡射加對稱、修剪／延伸／偏移的規則與拒絕的情形、相切接續偏移的冗餘 |
| [ADR 0022](docs/adr/0022-multiple-bodies.md) | 多本體（3a-3，Schema 10）：本體的身分與切開的編號、名稱不加本體前綴、合併結果與除料切開的行為、組合特徵、參考本體、合併視圖讓其餘程式不必知道有幾個本體、本體的隱藏要重算 |
| [ADR 0021](docs/adr/0021-direct-editing-and-import-repair.md) | 直接編輯與輸入修復（3a-2，Schema 9）：刪除面（Defeaturing）與「刪除鑽孔」的意圖、移動面的兩種做法（掃出／延伸板）與拒絕的情形、只重新分組鄰面、輸入診斷與縫合（容差存在特徵上）、置換面未做 |
| [ADR 0020](docs/adr/0020-expressions-and-variables.md) | 運算式、全域變數與檔案屬性（3a-1，Schema 8）：帶量綱的求值、`D1@草圖1` 引用、循環偵測、先解析成數字再交給求解器、改名連動、由運算式推導父子關係、方程式與檔案屬性對話框 |
| 本文件 | 狀態、待辦、下一步、約定 |

## 3. 目前狀態

- **Phase 0 行走骨架**：驗收全部通過。① ③ ④ 由自動化測試證明；② 使用者已在 SW 核對通過（2026-09-27）。
- **OCCT 缺口技術驗證**：完成，幾何核心已改用 `libcascade` 3.0.2（OCCT 8.0.1）。
  - 仍缺 `BRepOffset_MakeOffset`（C10.1 移動面），Phase 3a 前決定做法。
- **Phase 1A 草圖編輯器**：完成並已提交。細節見 ADR 0004 與 §9。
- **Phase 1B 特徵與布林**：完成，已提交並推送（`61bac81`）。細節見 ADR 0005 與 §9。
- **Phase 1D 樹狀結構操作**：完成，已提交並推送（`ca85736`）。細節見 ADR 0006 與 §9。
- **Phase 1C 基準面**：完成並提交。細節見 ADR 0007 與 §9。
- **Phase 1E 檔案**：完成並提交。細節見 ADR 0008 與 §9。系統檔案對話框已由使用者實機確認（2026-09-28）。
- **Phase 1F STEP 輸入**：完成並提交。細節見 ADR 0009 與 §9。使用者以自己的 SW 樣本驗收通過（2026-09-28）；輸入特徵的名稱「輸入1」已確認。
- **Phase 1G 驗收**：藍圖 Phase 1 驗收 ①②③ 都已完成，**閘門已由使用者確認通過（2026-09-28）**。細節見 [phase1-verification.md](docs/phase1-verification.md)。
  - 驗收中發現的 3 個問題都已修正，見 ADR 0010：整圈旋轉平面的命名、角度尺寸的量測側、零件名稱不隨檔名。
- **Phase 1 零件 MVP**：完成。
- **Phase 2 組合件 MVP**：完成（里程碑 2A–2F，§10）。**閘門已由使用者確認通過（2026-09-30）**，但驗收範圍低於藍圖原文：使用者沒有 SW，改以金樣夾具（15 個零組件、39 個結合）的自動測試、輸出 STEP 在 eDrawings 的目測與兩個真實 STEP 的部分驗收取代「用 SW 樣本重組」與「在 SW 開啟」。
  - **2A 組合件骨架**：完成並已提交推送（`7906934`）。細節見 ADR 0011 與 §10。系統的資料夾與存檔對話框已由使用者實機確認（2026-09-30，§8）。
  - **2B 結合求解器**：完成並已提交推送（`d10c2ad`）。細節見 ADR 0012 與 §10。另修正一個 Phase 1 的問題：旋轉件平面的法向（ADR 0012「修正」）。
  - **2C 結合的介面與管理**：完成並已提交推送（`c3f3860`）。細節見 ADR 0013 與 §10。驗收：只用 UI 把三個金樣零件組成小夾具並完全定義，矛盾的結合被正確指出。STEP 檔可直接當零組件插入。
  - **2D 移動零組件與參考檔**：完成並已提交推送。細節見 ADR 0014 與 §10。驗收：拖曳部分定義的零組件只沿剩餘自由度移動；零件檔改名後開啟組合件會詢問並可重新指定；從組合件開啟零件改尺寸、返回後結合仍成立。
  - **2E STEP 組合件輸出**：已實作並通過自動與瀏覽器驗證，已提交推送（`49e93c7`）。細節見 ADR 0015 與 §10。「檔案」→「輸出 STEP」在組合件中可用，寫出一個組合件，每個零件檔一個原型、每個零組件一個帶位姿的實例。金樣夾具的輸出檔已由使用者在 eDrawings 開啟確認（§8）。
  - **2F 驗收**：見 §10。金樣組合件測試（15 個零組件）、兩個真實 STEP 的部分驗收，閘門通過。
- **分支與遠端**：只在 `main` 開發。遠端 `origin` = https://github.com/Chun-Chieh-Chang/3D-Builder（私人），`main` 追蹤 `origin/main`。`spike/occt-gaps` 已合併、未推送，可以刪除。
- **2F 之後的收尾（2026-09-30，已提交推送 `92a434d`）**：零組件的網格變粗（三角形約減六成）、載入進度提示（階段與秒數）、壞的 STEP 檔顯示錯誤。細節見 ADR 0016。
- **Phase 1 遺留的 P0 已補（2026-09-30，ADR 0018，已提交推送）**：D4.6 顯示/隱藏（基準面、草圖、原點；本體與軸要等 3a-3、3a-7）與 B4.3 遺失參考的「改用這個」。**Schema 升為 7**（`visibility`），所以 Phase 3a-1 的 Schema 是 v8，不是 v7。
- **多語系機制已完成（2026-09-30，ADR 0019）**：新套件 `@3db/i18n`（**在新電腦或 pull 之後要再 `npm install`，工作區才會連上它；開發伺服器也要重啟**）。新的使用者可見文字一律 `t()`，寫進 `packages/i18n/src/zh-TW/`；`npm run check` 多一道 `lint:i18n`，既有的 639 行中文字串記在 `scripts/i18n-baseline.json`，只能減少。英文翻譯與設定畫面留到 3a-9。
- **3a-1 運算式與變數已完成（2026-09-30，ADR 0020）**：**Schema 升為 8**（v7 是 D4.6 的 `visibility`）。`packages/model/src/expr/`（解析器與求值）、`params.ts`（變數與尺寸的分析、解析、相依、改名連動）；`Regenerator.rebuild` 與草圖求解前先把運算式解析成數字，PlaneGCS 與 OCCT 沒有改。新的介面文字都走 `t()`。
- **3a-2 輸入修復與直接編輯已實作（2026-10-01，ADR 0021，`78e0cad`）**：**Schema 升為 9**。「特徵」分頁多了「刪除面」（`BRepAlgoAPI_Defeaturing`，含「刪除鑽孔」勾選，存成意圖 `hole`，重算時由模型找出孔壁的另一半、孔底、孔口倒角）與「移動面」（平面，沿外法向；鄰面都垂直時掃出該面，否則延伸板；相切、非凸又有斜鄰面、往內移超過厚度都拒絕並說明）；輸入本體的屬性管理員多了診斷報告與「縫合容差」（只有曲面的檔案縫成實體，縫不起來就說還有幾條邊沒接上）。置換面使用者決定先不做。實作在 `packages/kernel/src/kernel.ts`（`deleteFaces`、`moveFace`、`repairImport`）、`packages/regen/src/engine.ts`（`deleteFace`、`moveFace`、`holeFaces`、匯入快取以雜湊加容差為鍵）、`packages/model`（兩種特徵、`setFaces`、`setMoveFace`、`setImportOptions`）。
- **3a-3 多本體已實作（2026-10-01，ADR 0022，已提交推送）**：**Schema 升為 10**。重算的狀態是一串本體（`packages/regen/src/bodies.ts` 的 `Bodies`），`RebuildResult.body` 仍是「所有本體接起來的視圖」（只有一個本體時就是它），另有 `RebuildResult.bodies`；填料的「合併結果」（預設合併接觸的本體，沒接觸就成為新本體）、除料作用於碰到的所有本體並把切開的幾塊各成一個本體、「組合」特徵（加入／減除／共同）、參考本體（不計質量與零件 STEP）、本體的隱藏／重新命名；輸入的多實體 STEP 每個實體一個本體。名稱沒有加本體前綴（ADR 0022 決策 2）。`kernel.splitSolids／join／clone／solidCount`、`naming.nameFromFaces` 是新的。
- **3a-7a 參考幾何已實作（2026-10-01，ADR 0034，Schema 21，提交後推送）**：基準面多了平行、垂直、中間、相切四種；新增基準軸、參考點、座標系統三種特徵（「特徵」分頁的新按鈕）。實作在 `packages/regen/src/engine.ts`（`refPlane`、`refAxis`、`refPoint`、`coordSys`）、`packages/model`（定義型別、`setRefAxis`／`setRefPoint`／`setCoordSys`、`defRefs`／`mapDefRefs`）、`apps/web/src/state/datumSlots.ts`、`packages/render` 的 `setDatums`。
- **3a-7b 線性與環狀複製排列已實作（2026-10-01，ADR 0035，Schema 22，提交後推送）**：「特徵」分頁的「線性複製排列」「環狀複製排列」。實作在 `packages/regen/src/engine.ts`（`planPatterns`、`snapshot`、`captureDelta`、`placements`、`pattern`、`noOverlap`）、`packages/regen/src/placements.ts`（平移／轉動／鏡射矩陣）、`packages/kernel`（`transformed`）、`packages/model`（`PatternFeature`、`setPattern`、`patterns.ts`、`count` 型別運算式）、`apps/web`（`PatternPanel`、`datumSlots` 的方向與旋轉軸格子）。
- **3a-7c 鏡射已實作（2026-10-01，ADR 0036，Schema 23，提交後推送）；3a-7 到此完成**：「特徵」分頁的「鏡射」。實作在 `packages/regen/src/engine.ts`（`mirror`、`mirrorFeatures`、`mirrorBodies`、與排列共用的 `repeat`）、`packages/model`（`MirrorFeature`、`setMirror`）、`apps/web`（`MirrorPanel`）。
- **3a-8 材質、屬性與輸出已實作（2026-10-01，ADR 0037–0039，Schema 24，提交後推送）；3a-8 到此完成**：「工具」分頁的「檔案屬性」多了材質與文件設定、「外觀」；「檔案」分頁的「輸出 STEP」先問選項、多了「輸出 STL」「輸出影像」。範圍是使用者 2026-10-01 確認的：材質與質量、外觀與顏色、STL、AP242 與影像輸出，加上座標系統當 STEP 輸出座標系。
- **3a-9a 自動存檔與文字化格式工具已實作（2026-10-01，ADR 0040，Schema 不變，提交後推送）**：有未存檔的變更時 5 秒後在瀏覽器留一份；下次開啟會問「復原」或「捨棄」。`node scripts/3dbx.mjs cat|unpack|pack`；每個 clone 跑一次 `npm run setup:git` 後 `git diff` 看得到零件檔裡的變更。
- **3a-9b 設計樹與範本與快速鍵已實作（2026-10-01，ADR 0041，Schema 25，提交後推送）**：設計樹的列可以拖放調整順序（受父子關係約束）、有資料夾、註解與標籤、過濾、重新命名；「檔案」→「新零件（範本）…」；「工具」→「快速鍵…」。
- **3b-0 技術驗證進行中（2026-10-02，ADR 0046）**：② 鏡射零組件、③ 干涉檢查效能、④ STEP 組合件結構對應已量測並有決定；**① 桌面版（Tauri）卡在這台沒有 Rust 與 MSVC 建置工具**（`rustc`、`cargo`、`vswhere` 都找不到，WebView2 154 有、`winget` 有），安裝要使用者許可；檔案存取集中在 `apps/web/src/files.ts` 一個模組。**使用者 2026-10-02 決定先跳過 ①（3b-6 桌面版開工時再裝 Rust 與 MSVC 並驗證 File System Access、WASM 本機載入）；下一步是 3b-1 剛性次組合件。**
- **3b-1 剛性次組合件進行中（2026-10-02，ADR 0047，**組合件 Schema 升為 3**）**：使用者確認的範圍：只做插入現有 `.3dba`（不做「形成新次組合件」）、父層結合可選次組合件內零件的面與邊（`MateRef.path`）、每個子步驟提交後也推送。計畫與 12 項驗收標準見該次對話（摘要在 ADR 0047）。步驟：**1a 資料格式與循環偵測（已完成）**→ **1b 求解（已完成：`solveSubAssembly`、`mateGeometryIn` 沿路徑走，不合併幾何；與攤平版本位姿差 < 1e-6、內部相對位姿變化 < 1e-9）**→ **1c Store／Worker／介面（已完成：插入 `.3dba`、設計樹展開、帶路徑的結合、開啟次組合件與返回、巢狀缺檔會說檔名；瀏覽器腳本 `tests/e2e/phase3-subassembly.js`：`await __sub.open()`／`move()`／`insert()`；與驗收標準 9 的出入見 ADR 0047 決定 11）**→ **1d 隱藏／抑制／透明（已完成：`setComponentState` 指令、抑制不求解且結合跟著抑制、隱藏不畫、透明改材質；設計樹右鍵選單；`__sub.states()`）**→ **1e 巢狀 STEP 輸出（已完成：`Kernel.exportAssemblyStep` 的 `subs`、`stepStructure`；`__sub.step()`）。3b-1 全部做完；只剩驗收標準第 11 項的 eDrawings 目測要使用者做（ADR 0047 最後一節）。下一個是 3b-2 複製排列與鏡射零組件（phase3-plan §4）。**
- **3b-2 零組件複製排列與鏡射進行中（2026-10-02，ADR 0048，組合件 Schema 升為 4）**：使用者確認：實例是衍生位姿（不能再加結合）、鏡射件載入時由原件算出不另存檔、驗收標準 1–9（見 ADR 0048；其中第 5 項「面名稱對得上」改為「鏡射件的面與原件逐面對得上」，因為實例不當結合對象）。**3b-2 全部做完（2a 資料格式、2b 葉子與 Worker 的鏡射網格、2c 屬性管理員與設計樹、2d STEP）**；瀏覽器腳本 `tests/e2e/phase3-component-pattern.js`（`await __pat.run()`、`__pat.step()`）。驗收 5 部分通過（實例不能當結合對象，見 ADR 0048 決定 11）；限制：次組合件自己檔案裡的排列在上一層不顯示、鏡射面只有組合件的前上右基準面。**下一個是 3b-3 STEP 組合件輸入（F2.8）。**
- **3b-3 STEP 組合件輸入已完成（2026-10-02，ADR 0049，Schema 不變）**：使用者確認：每次選資料夾、顏色一起做。命令「檔案」→「輸入 STEP 組合件…」；瀏覽器腳本 `tests/e2e/phase3-step-import.js`（`await __imp.run()`）。限制：零組件名稱用「檔名＋編號」不沿用 STEP 的；沒有真實的（別家軟體輸出的）保留結構的組合件 STEP 可驗，要補需要使用者提供（§8）；寫入失敗時的清除沒有測試。**下一個是 3b-4 零件表與爆炸視圖（phase3-plan §4）。**
- **3b-4 零件表與爆炸視圖已完成（2026-10-02，ADR 0050，組合件 Schema 升為 5）**：使用者確認：零件表兩種結構可切換、爆炸方向用軸或任一元素。命令列「組合件」→「零件表…」「爆炸視圖」；瀏覽器腳本 `tests/e2e/phase3-bom.js`（`await __bom.run()`）、`tests/e2e/phase3-explode.js`（`await __exp.run()`）。限制：爆炸只能動頂層零組件、沒有爆炸線與動畫、只有一組爆炸視圖；CSV 不防公式注入；廠商／料號從真實零件檔屬性到零件表沒用真實檔走過一次。**下一個是 3b-5 評估（測量、物質特性、檢查模型幾何、干涉檢查，phase3-plan §4）。**
- **3b-5 評估已完成（2026-10-03，ADR 0051，Schema 不變）**：使用者確認：干涉的比對單位是頂層零組件（次組合件一個，排列與鏡射的複製品各一個）、結果是清單加圖面紅色重疊體積。命令：零件「工具」→「測量」「物質特性…」「檢查幾何…」；組合件「組合件」→「測量」「干涉檢查」「物質特性…」「檢查幾何…」。瀏覽器腳本 `tests/e2e/phase3-physical.js`（`await __physical.run()`）、`phase3-measure.js`（`__measure.assembly()`／`.part()`）、`phase3-interference.js`（`__interference.run()`）、`phase3-check.js`（`__check.assembly()`／`.part()`）。核心新增 `inertia`、`distance`、`common`、`check`、`subShape`；model 的 `mass.ts`、`measure.ts`、`interference.ts`；regen 的 `measure.ts`、`interference.ts`；`Viewer.setHighlights`。限制：次組合件內部的干涉不查（**夾具裡削邊銷的 r=5 本體站在板的 r=4 孔裡，約 405 mm³ 一支，是夾具本身的幾何**）；接觸不算干涉，重疊 < 1e-3 mm³ 不報；夾角是銳角；表面積是各零件的總和；20 個零組件單獨跑 1.04 s 牆上時間，整套平行時測試改量 CPU 時間（預算 4 s，只擋退步）；紅色重疊是用 Viewer 物件驗證的，沒有用眼睛看截圖（截圖在這台機器上不穩）；沒用第三方零件檔驗證。**下一個是 3b-6 桌面版（Tauri，需要裝 Rust 與 MSVC，先問使用者許可）。**
- **3b-6 桌面版已完成（2026-10-03，ADR 0052，Schema 不變）**：使用者確認：用 winget 裝 Rust 與 VS Build Tools、先驗證 WebView2 再決定要不要原生外掛、NSIS。`apps/desktop`（Tauri 2.12）只是載入 `apps/web/dist` 的視窗，**`files.ts` 沒動**（WebView2 裡三個選擇器、OPFS、IndexedDB 都可用，來源 `http://tauri.localhost` 是安全環境）。`npm run build -w @3db/desktop` 產生 `apps/desktop/src-tauri/target/release/bundle/nsis/3D-Builder_0.1.0_x64-setup.exe`（首次建置 11.02 MiB；2026-10-04 用 4a–7 重建後 11.13 MiB）；`tests/e2e/desktop-probe.mjs` 用 DevTools Protocol 檢查視窗並在裡面跑瀏覽器腳本（9 個全過）。**驗收 7 項裡第 3 項（原生對話框開啟、儲存）與第 7 項（沒裝過開發工具的帳號安裝）沒做，要使用者做（ADR 0052 有步驟）；第 2 項斷網沒真的拔網路。** 限制：沒有自動更新、安裝檔沒簽章、圖示是暫用的、解除安裝留下 `%LOCALAPPDATA%\app.3dbuilder.desktop`（使用者資料）。坑：在 Claude 桌面版的工作階段裡建置，`%LOCALAPPDATA%` 被重新導向，Tauri 改 NSIS 工具資料夾名稱會失敗，所以設了 `bundle.useLocalToolsDir`。**下一個是 3b-7 驗收（phase3-plan §4，需要真實樣本，見 §8）。**
- **3b-7 A 段已完成（2026-10-03，ADR 0053）**：`tests/phase3/acceptance-3b.test.ts` 11 項。金樣夾具（15 零組件、39 結合）輸出 STEP → `stepAssemblyFiles` → 重新開啟 → 再輸出，平的與巢狀（次組合件用 3 次）樹、名稱、位姿（差 0 mm，標準 < 0.01）、零件體積（對手算）都一致，且為不動點。**沒做：**真實第三方 STEP（B 段）、eDrawings 目測、桌面版人工驗收（C 段）。3b 閘門因此是「有條件通過」。這台電腦要先 `npm install` 才有 `node_modules/@3db` 連結。
- **Phase 4a 開發完成（2026-10-03，ADR 0054–0059），閘門是有條件通過**：4a-1 衍生本體與從本體產生組合件、4a-2 進階結合、4a-3 定位銷孔、4a-4 標準件圖庫（`@3db/library`）、4a-5 餘隙與取放空間與拖曳碰撞、4a-6 A 段驗收（金樣夾具）。B 段（真實工件與廠商件、eDrawings／SW）待使用者（§8）。
- **Phase 5 工程圖進行中（2026-10-03，使用者決定先做 5 再做 4b；計畫見 [phase5-plan](docs/phase5-plan.md)，驗收用金樣）**：
  - **5-0／5-1（ADR 0060）**：`Kernel.projectView`（精確隱藏線）、工程圖文件 `.3dbd`（第三種文件 `drawing`）、圖頁與標題圖塊、標準三視圖（第一角）、`@3db/drawing`（場景、SVG）、App 的工程圖模式。
  - **5-2（ADR 0061，Schema 2）**：投影、剖面（`Kernel.sectionView`、45° 剖面線）、細部放大視圖。
  - **5-3（ADR 0062，Schema 3）**：尺寸指到零件元素的持久名稱（不存數值）、自動尺寸、ISO 286 公差。
  - **5-4a（ADR 0063，Schema 4）**：中心記號與中心線、孔標註、孔表。**5-4b（ADR 0064）**：組合件當視圖來源、零件表、零件號球；「新工程圖」也能從開啟的組合件。
  - **5-5（ADR 0065）**：DXF（AC1015）與 PDF（Helvetica、可內嵌 TrueType 子集）輸出，附自寫的讀取器與檢查。**尚未在真實 CAD 與 PDF 檢視器開過（§8）。**
  - **5-6（ADR 0066）**：驗收 A 段：4a 的夾具出兩張圖（基板加工圖：三視圖、過兩個定位銷孔的剖面 1319.5 mm²、孔表、尺寸與 H7 公差；組合圖：零件表與四個號球），每個數字手算，輸出 DXF／PDF 讀回；改主模型後圖跟著變。**Phase 5 開發完成，閘門有條件通過。** 驗收中修了一個問題：有倒角的孔被當成盲孔。
  - **4b 檢具開發完成（2026-10-03），閘門有條件通過**：使用者說「接著做 4b 檢具」。[phase4b-plan](docs/phase4b-plan.md)（型面塊＝工件型面退一個間隙再加厚；預設假設、里程碑 4b-0 到 4b-6、驗收用金樣）。
    - **4b-0 已做（ADR 0067，`tests/phase4b/surface-spike.test.ts` 17 項）**：偏移自由曲面（含圓角的區域、整個實體、向內）間隙誤差 1e-6 到 3e-5 mm，遠小於 0.05 mm；縫織、填補（相切 0.02 mm）、厚面、投影分割（區域面積對手算積分 1e-5）、以曲面除料（2e-6 mm）都可行。**發現：偏移失敗時 OCCT 給「有效但錯」的形狀（間隙誤差 1.99 mm），所以每個曲面特徵都要量測結果**；整個實體的偏移是殼要包成實體；厚面可能整個反向；偏移曲面輸出前轉 B 樣條。
    - **4b-1 已做（ADR 0068，零件 Schema 28）**：`Kernel` 的 `gapReport`、`offsetFaces`、`offsetSolid`、`knit`、`fillSurface`、`flatSurface`、`thicken`、`cutWithSurface`、`splitByProjection`、`toBSpline`（每個都有手算測試，結果都量測間隙、超過 0.05 mm 就失敗並說出量到的誤差）；**曲面本體**（沒有實體，不是零件：實體特徵不碰它、質量與零件表與干涉與工程圖不算它、STEP 當殼、設計樹標「（曲面）」）；`offsetSurface` 特徵與 `setOffsetSurface` 指令（沒有介面）。發現：OCCT 的偏移結果要連幾何複製才能在建構物件釋放後使用；已是 B 樣條的接合面轉 B 樣條會中止。
    - **4b-2 已做（ADR 0069，零件 Schema 29）**：`splitLine` 特徵（草圖、面、方向、穿透全部）與 `setSplitLine` 指令（沒有介面）；核心的 `splitByProjection` 改成收多個圈並回傳每個區域是哪一圈；區域面叫 `<特徵>:side:<草圖>.<圈>`（圈＝最小的實體編號），其餘的面保留原名；區域面積對手算積分、選區域做偏移曲面也對手算。發現：投影的線貼著週期面的接縫會讓結果無效（退化情形，未處理）。
    - **4b-3 已做（ADR 0070，檔案格式不變）**：功能區「特徵」頁的「分割線」「偏移曲面」；PropertyManager 面板（面選擇框、距離、接合、草圖下拉、反轉、穿透全部）；編輯時顯示特徵自己的結果，失敗原因在訊息框；偏移曲面的**量測間隙**經 `FeatureResult.info` 顯示；特徵自己做出的面不能選回去。只用腳本驗證（`tests/e2e/phase4b-gauge-ui.js`），畫布上真的點選與視覺待使用者看。
    - **4b-4 已做（ADR 0071，零件 Schema 30）**：`knit`、`fillSurface`、`flatSurface`、`trimSurface`、`extendSurface` 五個特徵（指令、重算、命名、介面）；核心的 `knit` 回傳面的來源、新增 `keepFaces`、`extendFace`。延伸先驗證（`BRepLib::ExtendFace` 穩定，只限單一面的曲面本體）。**發現**：圓柱壁上的相切填補 OCCT 給平面圓盤（離邊線很近、切線差 90°），所以填補的相切也量測並拒絕（0.02 弧度）；只有「恰好一個相鄰面」的邊才能相切。縫織的曲面本體清單是開始時的快照。只用腳本驗證（`tests/e2e/phase4b-surface-edit-ui.js`）。
    - **4b-5 已做（ADR 0072，零件 Schema 31）**：`thicken`（結果取代曲面本體、成為實體；面保留名、新面 `<特徵>:thicken:…`）與 `cutWithSurface`（曲面沿平面法向掃成刀具除料，曲面不變，新面 `<特徵>:cut:…`）的特徵、指令、重算、介面；核心的 `thicken` 回傳面的來源、新增 `surfaceTool`。**決定了三件事**：STEP 輸出把偏移曲面型別轉成 B 樣條（`portableShape`；轉換器中止時照原樣輸出並警告，worker 的輸出改回傳 `{ text, warnings }`）；衍生本體是曲面時仍是曲面（修了漏帶標記）；組合件裡的曲面本體和參考本體一樣畫出來、不算零件。縫織用的清單改成所有本體的快照（`bodyPool`）。只用腳本驗證（`tests/e2e/phase4b-thicken-cut-ui.js`，兩段各載入一次頁面再跑）。
    - **4b-6 已做（ADR 0073）**：驗收 A 段：金樣工件（放樣自由曲面、含圓角的方塊，輸出成 STEP 再讀進來）→ 分割線 → 偏移 3 → 厚面 → 型面塊；**間隙偏差 5e-5 mm（容許 0.05）**、厚面體積對辛普森積分（把區域偏移 3、7、11 量面積）差 1.2e-5、圓角件的塊 31631.86 mm³（手算）；接進 4a 的夾具（衍生零件、組合件）無干涉、塊到工件 3.000 mm；塊的剖面積 790.8 mm²（手算，剖面弧是折線差 0.24）；工件改了塊跟著更新、名稱不變。`tests/support/sectionArea.ts` 是 5 與 4b 共用的剖面積讀法。**B 段（真實的沖壓件或塑膠件 STEP）待使用者（§8）。**
- **Phase 6 塑膠件開發完成（2026-10-04，ADR 0074–0082），閘門是有條件通過**：[phase6-plan](docs/phase6-plan.md)。6-0 計畫與技術驗證、6-1 拔模分析、6-2 底切分析、6-3 厚度分析、6-4 不等殼厚（零件 Schema 32）、6-5 唇與溝槽（33）、6-6 螺柱（34）、6-7 卡榫與窗與排氣口（35）、6-8 驗收 A 段（金樣外殼，每個數字手算）。B 段（真實塑膠件與 SW 的分析對照、真人走一遍）待使用者（§8）。
- **Phase 7 鈑金開發完成（2026-10-04，ADR 0083–0091），閘門是有條件通過**：[phase7-plan](docs/phase7-plan.md)。「特徵原生」做法：建立時記錄折彎資料，平板型式由它算出（不展開實體）。7-1 基材凸緣（Schema 36）、7-2 邊線凸緣（37）、7-3 摺邊（38）、7-4 縮短與離隙（39）、7-5 平板型式、7-6 平板型式 DXF、7-7 量規表（40）與可製造性檢查、7-8 驗收 A 段。沒做：凸折、斷開角落、長圓與撕裂離隙、折過的基材上的凸緣的平板型式、平板型式進工程圖。B 段（真實支架與 SW 的平板型式對照、真的 CAD 開 DXF）待使用者（§8）。
- **鞏固 H-1 到 H-11（2026-10-04，使用者採納「先鞏固再加功能」）**：[hardening-plan](docs/hardening-plan.md)。H-1 併面時舊面保留原名（ADR 0092）、H-2 畫面小修、H-3 效能、H-4 螺柱孔拔模（Schema 41）與摺邊不算最小半徑（ADR 0093）、H-5 到 H-10 種子固定的隨機測試（ADR 0094：零件、鈑金、STEP 來回、疊層拉伸與掃出與旋轉、組合件的結合與干涉、工程圖的視圖與剖面與輸出，共找到並修了 2 個真問題）、H-6 封閉角落（Schema 42，ADR 0095）、H-11 全面盤點清理（移除沒用到的 import 與沒人用的匯出與只寫不讀的欄位、文件對齊、資安與隱私盤點）與跨電腦開發（使用者要求專案能在不同電腦開發：`npm run doctor` 診斷這台電腦、`.gitattributes` 的 `* text=auto eol=lf`；套件解析不靠符號連結的做法評估後決定不做，見 ADR 0096）；桌面版安裝檔 2026-10-04 用 Phase 4a–7 的程式重建（11,673,078 位元組，SHA-256 開頭 `08c70f0e`，探測腳本確認視窗載入且有「鈑金」分頁；沒有在乾淨帳號安裝過）；註解與 handoff 裡被反斜線吃掉的字還原。逐項的實機驗證清單（84 項）：[docs/manual-verification.html](docs/manual-verification.html)。
- **檢查**：**1996 項測試通過、21 項略過**（`npm run check`：型別、分層、i18n、測試；2026-10-05 STEP 名稱與剖面版面修正之後）；每個里程碑的數字見對應的 ADR 與 `git log`。`tests/phase3/rebuild-speed.test.ts` 與草圖效能預算測試在機器同時有別的負載時可能超過時間預算，單獨跑會過（§6「效能測試」）。`F:` 磁碟（USB，不支援符號連結）上的做法見 §6「工作區連結」。

## 4. 如何執行

```bash
npm install          # 第一次
npm run dev          # 自動開啟 http://127.0.0.1:5391
npm run dev:auto     # 同上；最後一個分頁關掉 30 秒後伺服器自己結束（ADR 0118）
npm run check        # 型別檢查 + 分層檢查 + 全部測試
npm run build        # 正式版建置
npm run build -w @3db/desktop   # 桌面版安裝檔（要 Rust 與 MSVC，見 apps/desktop/README.md）
```

- 內建瀏覽器的預覽伺服器設定在 `.claude/launch.json`，名稱是 `web`。
- `spikes/occt-gaps/` 是 ADR 0003 的證據腳本，不屬於產品程式碼。

## 5. 架構速覽

資料流：

1. UI 送出 `Command`。
2. `DocHistory`（Immer patches）更新文件，並處理復原/重做。
3. Worker 重新計算：草圖求解 → 輪廓 → OCCT 特徵 → 持久命名。
4. Worker 回傳網格、名稱、指紋、物質特性。
5. `Viewer` 顯示結果。

必須維持的不變式：

1. 文件只存設計意圖。B-Rep、網格、名稱、DOF 等衍生資料一律不寫回文件。
2. 參考 = 持久名稱 + 幾何指紋，不存拓撲索引。命名文法見 ADR 0002。
3. UI 只能送 `Command`。一次編輯會話 = 一次交易，✔ 提交、✖ 還原。
4. 分層由 `scripts/check-deps.mjs` 強制。主執行緒不得在執行期匯入 kernel、regen、sketch、io；例外只有 `@3db/regen/dag`、`@3db/io`、`@3db/sketch/interact`（純 TS）。
5. 拾取到的索引（頂點、邊線、面），一律對照「畫面上正在顯示的那份結果」解析（`Viewport` 的 `displayed`）。
6. 草圖點座標是「擺放意圖」，只在畫圖與拖曳時寫入；求解結果不寫回（ADR 0004）。
7. 新物件的 ID 由 UI 用 `IdAllocator` 發放並放進指令；ID 永不重用。
8. 布林結果的名稱，依「目標在前、工具在後」的來源繼承；合併共面時，保留較早特徵的名稱（ADR 0005）。
9. 輸入的資料（STEP）以 SHA-256 識別，隨 `.3dbx` 存放；Worker 在執行使用它的指令之前就要拿到資料（ADR 0009）。
10. 零件名稱只有一個來源：存檔或開檔後就是檔名（`partName`）。「新零件」不把名稱寫進文件（ADR 0010）。
11. 角度尺寸記錄放置的扇形（`flip`）；沒有 `flip` 的舊尺寸意義不變（ADR 0010）。
12. 組合件以「相對於組合件檔所在資料夾」的路徑引用零件檔，每個檔案只存一筆；不存零件的雜湊值。組合件存到別的資料夾時，路徑與復原記錄一起改寫（`History.rebase`，ADR 0011）。
13. 一次開一份文件。組合件的狀態在 `AssemblyStore`（每開一份就建一個）；`AppStore` 依目前文件轉送檔案、復原/重做、重新計算（ADR 0011）。
14. 結合只存設計意圖。零組件的位置、狀態、自由度都是求解出來的衍生資料；每次都從擺放位置解起，結合沒拘束的自由度保持擺放的樣子；衝突依設計樹順序判定（ADR 0012）。
15. 面的外法向由曲面本身的偏導數決定，不用 OCCT `Plane()` 等回報的座標系方向（ADR 0012）。
16. 結合草稿不寫進文件：它和文件一起求解做預覽，✓ 之後才成為指令（ADR 0013）。
17. 移動零組件（拖曳、數值）只在放開或「套用」時寫入文件：與它一起求解的零組件，位置改變的擺放位置一起改為目前位置，一個指令、一個復原步驟；拖曳中的位置是衍生資料（ADR 0014）。
18. 零件檔的路徑只在 `FileRef` 一處：重新指定、搬移都只改它；零組件以 ID 引用檔案，結合以持久名稱引用元素（ADR 0014）。
19. 工程圖文件只存意圖（圖頁、標題、視圖、尺寸、表格）；**線條、尺寸的數值、孔表的列、零件表的列都由模型重算**，不存（ADR 0060–0064）。視圖的來源是零件或組合件檔的相對路徑。
20. 尺寸指到零件的面、邊、頂點的持久名稱加指紋；元素不見時說「找不到」，不悄悄改接（ADR 0062）。
21. `buildScene` 的場景（圖紙座標 mm、y 向上的折線與文字）是 SVG、DXF、PDF 的唯一來源；`@3db/drawing` 只依賴 model 與 i18n，不用核心（ADR 0060、0065）。

## 6. 已知陷阱

**libcascade（詳見 ADR 0003）**

- 多載以參數個數分派。例如 `BRepPrimAPI_MakeRevol` 一律傳 4 個參數。
- 沒有綁定 UTF-16 字串。
- handle 需要手動 `delete()`，用 `Arena` 管理。
- 例外要用 `getExceptionMessage` 解碼。
- `BRepAlgoAPI_Fuse`/`Cut` 的建構子本身就會執行運算，不要再呼叫 `Build()`。
- `BRepPrimAPI_MakeHalfSpace` 只以傳入的面為界。要以整個曲面為界，先用 `BRep_Tool.Surface` 加上 `MakeFace(surface, tol)` 做出無界的面。
- `BRepPrimAPI_MakeRevol` 旋轉整圈時，`Generated(edge)` 對與軸垂直的輪廓線回傳空集合，但它們掃出的平面確實在結果中。要同時查 `mk.Revol().Shape(edge)`，否則這些面會失去名稱（1G 發現）。
- `Regenerator.rebuild()` 會釋放上一次結果的形狀。測試必須先量完這次的結果，才能再做下一次 rebuild。
- 旋轉特徵掃出的平面，`BRepAdaptor_Surface.Plane()` 的法向不一定與曲面參數化一致；只看它與面的 Orientation 會把部分平面算成朝內（2B 發現）。外法向要用 `EvalD1` 的 ∂u × ∂v。圓柱等的 `Direct()` 同理不可靠。

**libcascade（3a-2 發現，細節見 ADR 0021）**

- `BRep_Tool.CurveOnSurface(edge, face, …)` 的綁定壞了（丟 `Cannot read properties of undefined (reading 'name')`）。要在鄰面上找邊線對應的曲面點，用 `GeomLib_Tool.Parameters(曲面, 點, 容差)` 取 (u, v)，再 `BRepAdaptor_Surface.EvalD1`。
- `BRepClass_FaceClassifier(face, gp_Pnt, 容差, true, 0.1).State()` 可以判斷點在不在面內（`TopAbs_IN`）。
- `ShapeUpgrade_UnifySameDomain` 預設會把**整個本體**的共面合起來；在 2004 個面的輸入件上只動一個小面，就會合掉 48 個不相干的面、改掉別人在用的名稱。用 `KeepShape(邊)` 保護不該合的邊（`kernel.moveFace`）。
- `BRepAlgoAPI_Defeaturing` 不能中斷，對某些面（產品件的 `import1:f254`）永遠不回來。核心沒有綁定可中斷的進度指示器，所以由 `store.ts` 的重算時間上限保護。
- STEP 讀入器自己會修好小缺陷（移動過的頂點、沒共用邊的面再組成實體），所以做不出「讀進來就無效」的檔案；`Kernel.repairImport(shape)` 是公開的，測試在記憶體裡做缺陷再交給它。
- 對曲面（沒有實體）的 STEP 用 `BRepBuilderAPI_Sewing` + `ShapeFix_Solid.SolidFromShell`；縫合後的面序固定，所以 `imp:f<k>` 的名稱成立。
- 2000 面的本體，體積積分只準到約 1e-6 倍整體體積：比對體積變化時要以整體的比例為容差，不能以變化量的比例。

**屬性管理員與設計樹（3a-7a 發現）**

- 開著屬性管理員時，左邊的設計樹被它整個換掉（`App.tsx`），所以 ADR 0007 決定 8 說的「在設計樹點選基準面當參考」其實點不到；3a-7a 在屬性管理員裡加了基準按鈕（ADR 0034 決定 9）。瀏覽器腳本要在屬性管理員開著時選基準，用 `.property-manager .datum-picker button`，不要用 `H.treeClick`。
- 自動化瀏覽器（雲端工作階段）：預裝的 Chromium 在 `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`，Playwright 在 `/opt/node22/lib/node_modules/playwright`；用 `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` 才有 WebGL。載入腳本用 `import('/@fs/<檢出路徑>/tests/e2e/…js')`。唯一會出現的主控台錯誤是 favicon 的 404。

**3a-8 發現的陷阱**

- `useStore((s) => s.result?.bodies ?? [])` 每次都回傳新陣列，React 以為狀態一直在變而無限重繪（整個畫面當掉，只有瀏覽器才看得到）：選擇器要回傳穩定的值，預設值放在 `useStore(...)` 外面（`useStore((s) => s.result?.bodies) ?? []`）。
- OCCT 的 STEP 輸出設定（`write.step.schema`、`write.step.unit`）是全函式庫共用的，而且要等第一個 `STEPCAFControl_Writer` 做出來才存在；先做寫入器再設，輸出完設回預設（ADR 0039 決定 3）。
- 顏色以 `Quantity_TOC_sRGB` 建立，否則 STEP 裡的灰色會變亮（ADR 0038 決定 4）。
- 一個形狀會保留給過它的最細網格：測不同網格品質要各重算一個形狀。
- 零件的「輸出 STEP」現在會先開對話框；`tests/e2e/phase1-demo-parts.js` 的 `H.exportStep` 已改成按對話框的「輸出」。

**開發與測試環境**

- **i18n 的鍵不能跨區域重名**：各區域的目錄用 `...spread` 合併，後面的悄悄蓋掉前面的，不會有任何警告（3b-2 撞到零件排列的 `pattern.count`、`pattern.direction1`、`pattern.instanceName`，差點把零件排列的文字蓋掉）。新增鍵之前先 grep 一下，或用新的前綴（組合件的零組件排列用 `pattern.comp…`／`pattern.step…`）。
- **Node 25.8 的 `fs.cpSync` 在 Windows 上，目的地資料夾名稱含非 ASCII 字元時會讓整個程序崩潰**（vitest 顯示 `Worker exited unexpectedly with exit code 3221226505`，沒有任何測試輸出）。測試複製資料夾時目的地用 ASCII 名稱（`tests/phase3/subassembly-files.test.ts`）。
- **推送**：這台（`D:`）沒有 `gh`，直接 `git push` 即可（Git 的憑證管理員有登入）；上面 §7 的 `gh` 憑證指令是另一台電腦的。
- **PowerShell 工具的兩個陷阱**：雙引號字串會吃掉 `${…}`（改用單引號的 here-string 或 Edit 工具）；`Set-Content -Encoding utf8` 在 Windows PowerShell 5.1 會加 BOM。指令中同時有 `Remove-Item` 與某些字串（例如 `//`、`\n`）時，工具會當成「刪除系統路徑」而拒絕整個指令：刪檔單獨一個指令。
- **暫時用的樣本伺服器**：真實 STEP 不複製、不進版本庫；要在瀏覽器測就起一個只讀、只綁 127.0.0.1 的小型靜態伺服器，用完停掉（做法見下面「Vite 對別的磁碟的檔案」）。

- **工作區連結（`F:` 磁碟）**：專案在 `F:\Self-developed_Apps\G3\3D-Builder`（USB 磁碟，不支援符號連結），`node_modules/@3db` 是空的，所以 `npm run typecheck`、`npm test`、`npm run build`、`npm run dev` 都找不到 `@3db/*`。在支援符號連結的磁碟（例如 C:）上 `npm install` 就正常。在 `F:` 上驗證的做法（2E 用過）：在暫存區放三個設定檔，各自加上 `@3db/<套件>` → `packages/<套件>/src/index.ts` 的別名（另有 `@3db/regen/dag`、`@3db/sketch/interact`），專案內不留檔案：
  - tsc：`extends` 專案的 `tsconfig.json`，加 `paths`、`typeRoots`（`node_modules/@types` 與 `node_modules`）與絕對路徑的 `include`；`baseUrl` 已被移除，不能用；
  - vitest：`root` 指向專案，`resolve.alias` 用正規表示式（`/` 要跳脫），執行 `vitest run --config … --maxWorkers=4`。並行 worker 太多（預設約 26 個）會耗盡 WASM 記憶體而崩潰；
  - vite：設定檔用 `file:///…/node_modules/vite/dist/node/index.js` 匯入 `defineConfig` 與 react 外掛，`root` 設成 `apps/web`，`build.outDir` 指向暫存區。開發伺服器用背景程序啟動（`npx vite --config …`），再以 `preview_start` 的 `url` 開分頁；用完停掉。
- **e2e 腳本的路徑**：`tests/e2e/*.js` 的 `H.GOLDEN` 已改成由 `import.meta.url` 推出，不再寫死使用者路徑。載入腳本時用實際的檢出位置，例如 `await import('/@fs/F:/Self-developed_Apps/G3/3D-Builder/tests/e2e/phase2-assembly.js?' + Date.now())`。本文件其他處的 `<檢出路徑>` 是舊機器上的路徑。Vite 會把 `new URL('字面值', import.meta.url)` 當成資源匯入而改寫，所以腳本裡用字串處理。
- **Vite 對別的磁碟的檔案**：開發伺服器在 `F:`，`/@fs/C:/…` 的請求會拿到首頁（HTML，內容 560 位元組），不是檔案，e2e 存進 OPFS 的就是那份 HTML，載入時會報「檔案不是有效的 JSON」。要在瀏覽器測放在別的磁碟的樣本，起一個只讀、只綁 127.0.0.1 的小型靜態伺服器（Node `http`，加 `Access-Control-Allow-Origin: *`，只提供該資料夾的 `.step`），`H.project` 用它的網址取檔；用完停掉。不要為了測試複製使用者的檔案。
- **頁面沒有繪製時的 e2e**：瀏覽器窗格隱藏、Claude 視窗被擋住時截圖逾時，依游標拾取的流程（`H.pickOn`，例如 `__asm.fixture()` 的結合）會失敗（「could not get the cursor onto face …」）。這種情況改用指令加入結合；`__asm.exportStep()` 就是這樣做的。
- **連接埠**：5173 是本機其他 Vite 專案在用的預設埠。本專案固定使用 `127.0.0.1:5391`，並開啟 strictPort；埠被占用時直接報錯，不會換埠。
- **預覽伺服器**：app 可能在回合之間停掉它。請使用者開網址前，先用 `preview_list` 和 curl 確認。Phase 0 驗收 ② 第一次失敗就是因為沒有確認。
- **Vite 設定檔的相對匯入要自帶副檔名**：`apps/web/vite.config.ts` 寫成 `./dev/autoClose.ts`（含 `.ts`），因為 Vite 下一大版本預設的 `configLoader: 'native'` 不解析無副檔名的路徑；啟動時那句 `(!) Your Vite config uses features that are unsupported by configLoader: 'native'` 就是在講這件事，加了副檔名之後 `npm run dev` 與 `npm run dev:auto` 都不再出現。TypeScript 端要跟著開 `tsconfig.json` 的 `allowImportingTsExtensions`（已有 `noEmit: true` 才合法，否則 `tsc` 報 TS5097）。其餘 763 處無副檔名的相對匯入（分布在 312 個檔案）使用者 2026-10-08 決定不跟著改，見 §8 第 7 項。
- **別的工作階段的開發伺服器**：
  - 如果 5391 已被另一個工作階段的 Vite 佔用，用 `preview_start` 加 `url: http://127.0.0.1:5391` 開分頁，就能使用它。
  - 它的檔案監看可能漏掉修改，症狀是「does not provide an export named …」，或 curl 取回的模組是舊內容。這時對來源檔執行 `touch`，再重新載入頁面。
- **內建瀏覽器**：
  - 窗格隱藏時頁面是 0×0，視角與拾取都會算錯。測試前先 `resize_window` 1280×720，測完用 `desktop` 預設值還原。
  - Claude 視窗最小化時頁面不繪製，座標點擊與截圖都會失敗。改用 JS 觸發 DOM 的 `click()`，並對畫布送 `PointerEvent`。畫布座標用 `store.viewer.screenOf(frame, p)` 換算。
  - 在 console 裡動態 `import` store 會載入第二個實例。要用 `performance.getEntriesByType('resource')` 裡的確切網址。
- **PlaneGCS**：
  - 共用端點的相切必須用 `angle_via_point`，否則會被誤判為冗餘。
  - 它的法向慣例：直線為方向逆時針轉 90°，圓指向圓心。
- **系統檔案對話框**：`showOpenFilePicker`、`showSaveFilePicker`、`showDirectoryPicker` 必須由真人點擊觸發；腳本的 `click()` 不算，非同步流程中途也不能再開（所以專案資料夾用一個對話框承接點擊）。自動測試時以替身取代它們，真正的對話框請使用者確認。
- **組合件的瀏覽器測試**（`tests/e2e/phase2-assembly.js`）：
  - 專案資料夾用瀏覽器的私有檔案系統（OPFS，`navigator.storage.getDirectory()`）。它的控制代碼是真的，`resolve()`、讀寫都走瀏覽器本身的程式；對話框替身回傳其中的檔案。
  - 用法：在剛載入的頁面 `await import('/@fs/<檢出路徑>/tests/e2e/phase2-assembly.js?' + Date.now())`（路徑見上），再 `await __asm.all()`、`await __asm.extras()`；2C：`__asm.fixture()`、`__asm.mateExtras()`；STEP：`__asm.step()`；2D：`__asm.move()`、`__asm.files()`，重新載入後 `__asm.remembered()`；2E：`__asm.exportStep()`（自己組夾具，不必先跑 `fixture()`）；載入進度：`__asm.progress('http://127.0.0.1:5393/')`（要有提供 `CIV0000467治具_step.STEP` 的只讀伺服器，見上面「Vite 對別的磁碟的檔案」；約 15 秒，工具逾時 45 秒，要在背景跑並輪詢 `window.__result`）。
  - 專案資料夾會記在 IndexedDB（2D）。要測「第一次選資料夾」的流程（`__asm.openFresh()`），先 `await __asm.forget()` 再重新載入頁面。OPFS 的資料夾讀取權限永遠是「已允許」，所以記住的資料夾會直接使用；`__asm.remembered()` 以替身讓它回報「要再詢問」，測試對話框的「使用「X」」按鈕。
  - 每個流程開頭都會「新組合件」：上一個流程留下未存的組合件時會跳出「要儲存變更嗎？」而卡住，先重新載入頁面。流程超過 45 秒時，在背景執行並輪詢 `window.__result`。
  - 拖曳用 `H.drag(path, 'left' | 'right')`：合成的 PointerEvent 帶 `buttons`；`setPointerCapture` 對合成事件會拋錯（已忽略）。找零組件上的點用 `H.onComponent`（確認游標真的落在它上面）；等角視圖中被其他零件擋住時改用上視圖。
- **效能測試**：全部測試同時跑時（約 26 個 worker），加上開發伺服器與瀏覽器，牆上時間可能是實際工作的好幾倍。求解器的預算測試改量 CPU 時間（`process.cpuUsage`，Windows 以約 15.6 ms 為單位，所以每次量五次取平均，三批取最小；見 `packages/assembly/test/solver.test.ts`）。
- **瀏覽器腳本的指標座標要取整數**：`MouseEvent` 的 `clientX/Y` 是整數，`PointerEvent` 可以有小數；懸停用小數、點擊被取整，兩者就可能落在不同元素上（2C 遇到：懸停在面上，點擊卻選到 10 px 內的頂點）。真實滑鼠沒有這個問題。
- **在組合件中點選元素**：`tests/e2e/phase2-assembly.js` 的 `H.pickOn` 把游標移到元素上的點，確認圖面認得是那個元素才按下；看不到時轉視角、放大。被別的零件蓋住的面（例如坐在板上的底面）點不到，改選看得到的邊線，同 SW 的做法。
- **看不到畫面時檢查繪圖**：視窗隱藏時截圖會逾時，WebGL 畫布的 `toDataURL`、`drawImage` 也只得到背景。在同一段 JS 裡先呼叫 `store.viewer.render()`，再用 `gl.readPixels` 讀回像素，就能確認畫了什麼。
- **UI 驗收腳本**（`tests/e2e/phase1-demo-parts.js`）：
  - 用法：在頁面中 `await import('/@fs/<檢出路徑>/tests/e2e/phase1-demo-parts.js?' + Date.now())`，再 `await __demo.plate()`（或 `vblock()`、`pin()`）。
  - 規則：點擊一律落在畫布可見範圍內；先用滾輪縮放、Ctrl+中鍵平移到合適比例（空草圖按「全部顯示」會放大到約 700 px/mm）。
  - 被擋住的邊線點不到，要先轉動視角或換標準視角。
  - 短線要點中段，因為 7 px 內有點時會選到點。
  - 瀏覽器窗格隱藏時重新載入的頁面不會繪製，畫布的 ResizeObserver 不觸發，畫布停在 300×150。腳本在每個零件開始時呼叫 `store.viewer.resize()`（`H.ready()`）。
- **舊版樣本檔**：`tests/fixtures/old-versions/` 由舊版程式寫出，不可修改（產生方式見該目錄的 README）。
- **STEP 金樣**：`tests/fixtures/step/` 的檔案固定輸入面的順序；升級幾何核心後若這個測試失敗，代表輸入面的名稱會變，要先處理遷移。
- **ShapeFix**：對乾淨的檔案也會回報「已修改」，所以只在有效性檢查失敗時才修復（ADR 0009）。
- **網路工具**：WebSearch/WebFetch 在此環境會失敗，改用內建瀏覽器查資料。SW 2010 的線上說明可以讀：`https://help.solidworks.com/2010/english/SolidWorks/help_list.htm?id=18.5.13`（伸長）這類頁面，網址從左側目錄的連結取得；第一次會有 cookie 橫幅，選「只用必要的 cookies」。
- **開發伺服器的快取**：新增工作區套件（要先 `npm install`）、搬動或刪除原始檔（例如 `expr.ts` 變成 `expr/`）之後，Vite 會記著舊的解析結果而回 500／404；重啟開發伺服器（`preview_stop` 再 `preview_start`）。
- **Windows**：
  - Git 的 LF→CRLF 警告無害。
  - 沒有 pnpm，使用 npm workspaces。
  - Node 26。
- **這一輪（3b-5、3b-6）踩到的坑**（2026-10-03）：
  - **PowerShell 5.1 與中文**：`.ps1` 檔沒有 BOM 時會以 ANSI 讀，裡面的中文會變亂碼而解析失敗。要改含中文的檔案：把中文放進 UTF-8 的 JSON 或文字檔，腳本只有 ASCII，用 `[IO.File]::ReadAllText(路徑, (New-Object Text.UTF8Encoding($false)))` 讀；直接寫在命令列裡的中文沒問題。多行修改用 Edit 工具，不要在 PowerShell 字串裡用反引號、`${`、`\n`。`handoff.md` 是 CRLF、**沒有 BOM**，不要用 `Get-Content | Set-Content`。
  - **Claude 桌面版把 `%LOCALAPPDATA%` 重新導向到它的套件資料夾**（`C:\WpSystem\…\Claude_*\LocalCache\Local`）：Rust 的 `fs::rename` 在那裡會失敗（「系統無法將檔案移到不同的磁碟機」）。Tauri 的 NSIS 工具因此要設 `bundle.useLocalToolsDir`（已設）；環境變數 `TAURI_BUNDLER_TOOLS_PATH`、改 `LOCALAPPDATA` 都沒用。別的 Rust 工具若遇到同樣的錯，也是這個原因。Claude 的「終端機」面板的 shell 整合在這台壞了（`claude-desktop.ps1` 找不到），`run_in_terminal` 打不出命令。
  - **計時型測試會隨負載波動**：`rebuild-speed`、`interference` 在整套平行跑時時間會變成三倍以上。`rebuild-speed` 量 CPU 時間（預算 5000 ms）；`interference` 以「比對的零件對數」把關（37 對，不是 190 對），時間只留寬鬆的上限；真正的時間要在安靜時單獨跑量（20 個零組件約 1.0 s 牆上時間）。
  - **預覽伺服器的埠 5391 是 `strictPort`**：`npm run dev -w @3db/desktop`（`tauri dev`）會自己開 vite，要先 `preview_stop` 內建瀏覽器的伺服器。
  - **內建瀏覽器**：視窗約 1024 × 768，截圖常逾時，改用 `read_page`、`javascript_tool` 驗證；`computer` 的座標是縮放後的截圖座標（800 × 600），不是頁面座標。要模擬畫布上的點擊，對 `canvas` 派發 `click` 事件（`MouseEvent`，帶 `clientX`、`clientY`；先 `mousemove`），Viewer 聽的是 `click`。舊的 `tests/e2e/phase2-assembly.js`（`__asm.all`）假設 1280 × 720，在這個視窗和桌面視窗都失敗，不要拿它當證據。
  - **干涉與測量的資料**：夾具裡削邊銷的 r = 5 本體站在板的 r = 4 孔裡（每支約 405 mm³），是夾具本身的幾何；次組合件內部不比對，所以頂層檢查看不到。
- **Docker**：canary 映像已刪，但 `docker_data.vhdx` 仍佔 25 GB（非稀疏檔）。要把空間還給 C 槽，需要壓縮這個檔案：要系統管理員權限，並會暫停 Docker/WSL。

## 7. 與使用者的工作約定

- **語言**：
  - 回覆與文件用繁體中文，術語採 SW 2010 繁中版。
  - 程式碼識別名稱用英文。
- **全域規則**（`~/.claude/CLAUDE.md`）：
  - 第一性原理，不迎合。
  - 需求模糊先問，做了假設要明說。
  - 使用者提出方案或決策時，用五位顧問組成的智囊團審查，再由主席結論。結論要包含：
    - 值得做 / 需要改 / 應該放棄；
    - 最大風險；
    - 最缺的證據；
    - 今天最小的一步；
    - 可信度。
- **Git**：
  - 使用者要求時才提交。
  - 提交訊息結尾加 `Co-Authored-By: <當次工作階段的模型名稱> <noreply@anthropic.com>`（3a-6b 之後是 Claude Sonnet 5.5）。
  - 3a-5、3a-6 的每個子里程碑都是做完就提交推送（使用者在驗收標準第 7 項確認）；推送用 gh 的憑證：`GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never git -c credential.helper= -c "credential.helper=!gh auth git-credential" push`。
- **說明（單一來源，2026-10-06）**：UI 的使用說明只存在 i18n 目錄的 `help.<主題>.*`（主題 id = `ACTIONS` 的 id、草圖工具 `tool-<tool>` 或 `concept.*`）。**新增指令或草圖工具必須同時寫 `help.<id>.summary`**（`tests/phase8/help.test.ts` 會擋）；驗證手冊的項目標為「有問題」並修好後，依 [docs/help-links.json](docs/help-links.json) 同步改它對應主題的文字；說明裡的數字取自驗證過的預期值。
- **需要先徵求同意的動作**：下載、刪除/覆寫、對外動作。
- **階段閘門**：每個階段由使用者在 SW 對照驗收，通過後才進下一階段。

## 8. 使用者的待辦

### 最新狀態（2026-10-09；以下 Phase 分項保留歷史參考）

- 程式與自動驗證已完成並推送到 `main`（commit `1a2dd3b`）。最近完整驗證：`verify:ui` 125/125；`npm run check` 183 檔通過、3 檔略過，2481 項通過、22 項略過；`npm run build` 成功，伴隨兩項 Vite 警告。
- 尚待實機／外部確認：I10、F7、D9 實體操作；D9 375／390／768 視口；F6 外部 PDF 開啟；F4／K2 標註用語；G5／I9 外部 CAD 檢視；J 樣本與 SolidWorks 對照；K 標準決定；L 項目的許可與選做收尾。
- 瀏覽器對 localhost 權限被阻擋時不得改走其他瀏覽器路徑繞過。自動化截圖／合成事件不能標成實機通過。
- 公開樣本已從 OSF 取得並測試匯入；真正的 SolidWorks 特徵樹、分析及製造結果比對尚未完成。

**逐項的實機驗證清單（88 項，含步驟、預期結果、回報格式）：[docs/manual-verification.html](docs/manual-verification.html)**，用瀏覽器開，狀態與備註存在瀏覽器裡，做完按「複製結果」貼回來。以下是各階段的原始待辦。

**Phase 7 鈑金的待辦（2026-10-04；ADR 0091 的最後一節有完整版）**

- A. **一個真實的鈑金支架**：用同一個板厚、半徑、K 因子在 SW 看平板型式的外包尺寸與折彎線位置，與這裡的「平板型式」視窗對（差距多半來自定義：凸緣長度量到外側／內側虛擬交點、K 因子）；把輸出的 DXF 用你的 CAD 或雷射切割軟體開，看輪廓、`BEND` 層與註記。
- B. 真人走一遍：「鈑金」頁的基材凸緣（平板、折過的板）、邊線凸緣、摺邊、縮短與離隙、平板型式、量規表、檢查，回報不順的地方。
- C. **你要決定**：沒做的——凸折（板中間，需要切開並移動一半實體的新核心操作）、（封閉角落已在 H-6 做完，ADR 0095）、斷開角落、長圓與撕裂離隙、折過的基材上的凸緣的平板型式、3D 視圖的展開／摺疊切換、除料特徵進平板型式（折彎之後才切的孔）、平板型式進工程圖；（2026-10-09：長圓與撕裂離隙 ADR 0120 已做。）（2026-10-07 之後：斜接 ADR 0110、中間折彎 ADR 0111、折彎後的孔進平板型式 ADR 0113、折過基材上的凸緣的平板型式 ADR 0114、3D 視窗展開 ADR 0115 都已做完；平板型式進工程圖 ADR 0106。）摺邊的最小半徑：ADR 0093 已決定不另訂規則（金樣的假警報已消除），等有工廠的數值再加。
- D. 檢查的預設比例（半徑 1 倍板厚、平直段 4 倍、孔到折彎 2 倍）是我的起點，不是標準——請改成你工廠的規定；量規表沒有預設列。

**Phase 6 塑膠件的待辦（2026-10-04；ADR 0082 的最後一節有完整版）**

- A. **一個真實的塑膠件**（STEP 或你的零件檔）：各跑拔模、底切、厚度分析，與 SW 的同一種分析對顏色與數字（厚度的定義我不知道 SW 用哪個；真實件的曲面壁、肋、圓角的取樣行為沒試過）。
- B. 真人走一遍：開零件 → 工具頁的三種分析（方向、要求角度、厚度上下限）→ 特徵頁的唇與溝槽、螺柱、卡榫、卡榫的窗、排氣口、不等殼厚的薄殼，回報不順的地方。
- C. **你要決定**：（螺柱孔的拔模已在 H-4 做完，ADR 0093：選項 A，孔有自己的拔模角）；卡榫站在底上要開窗：已做成卡榫的選項（ADR 0107）。
- D. 瀏覽器裡殘留的「找到沒有儲存的零件」是舊的測試副本，按「捨棄」；之後的 e2e 腳本會自己收尾（`H.tidy()`）。

**Phase 4b 檢具的待辦（2026-10-03；ADR 0073 的最後一節有完整版）**

- A. **一個真實的沖壓件或塑膠件 STEP**：放進主模型（輸入修復會先處理），畫草圖投影到要做型面的面，偏移 3 mm（看 PropertyManager 說的間隙），厚面，回報哪裡失敗（曲面是修剪過的 B 樣條、面多又小時，偏移、縫織、分割線的穩定度只有真實檔案知道）。
- B. 真人走一遍：開零件 → 分割線 → 偏移曲面 → 延伸／修剪／縫織 → 厚面或以曲面除料，回報不順的地方；畫布上真的點選與曲面的顯示（雙面）我沒有人眼確認。
- C. 輸出的 STEP（型面塊）用別的 CAD 開：偏移曲面已轉成 B 樣條（ADR 0072），讀不讀得進沒有試過；轉換器中止時輸出會警告。
- D. 已做：曲面之間的「互相修剪」（ADR 0109）、厚面「兩側」與保留曲面（ADR 0108）；厚面遇到尖角會拒絕（ADR 0112）。還沒做：除料用任意向量當方向。

**Phase 5 工程圖的待辦（2026-10-03；ADR 0065 的最後一節有完整版）**

- A. **用真實的程式開輸出**：用 Chrome 開一張夾具圖的 PDF、用你的 CAD（AutoCAD、DraftSight…）開同一張的 DXF：看線寬、虛線、箭頭、中文、尺寸文字的位置。PDF 要中文請先在工程圖面板的「PDF 字型…」選一個字型檔（例如 `C:\Windows\Fonts\msjh.ttc`）。這是 Phase 5 驗收②的 B 段。
- B. 真人走一遍：開零件或組合件 →「新工程圖」→ 自動尺寸、孔表、剖面、零件表與號球 → 輸出，回報不順的地方（尺寸堆疊太擠、號球位置、孔表欄寬）。
- C. 對照你的標準：公差表（ISO 286，`packages/model/src/tolerance.ts`，表值是手打的）、孔標註的用語（貫穿、深、沉頭）、標題圖塊的欄位與位置。
- D. 號球與表格的拖曳（2026-10-09，ADR 0119，工程圖 Schema 9）已做。（螺紋孔與錐孔的孔標註 2026-10-07 已做，ADR 0101；角度尺寸 ADR 0100；DXF 的 DIMENSION 圖元 ADR 0102，沒有真正的 CAD 開過。）

**Phase 4a 的待辦（2026-10-03，使用者決定先走完開發、對接時再修正；ADR 0059 的最後一節有完整版）**

- A. **一個真實的夾具案例**：工件 STEP（含曲面更好）、你在 SW 做的夾具截圖、你常用的廠商定位銷與螺絲的 STEP。第一步：把真實工件放進主模型（輸入本體、標為參考本體），走 `tests/phase4/acceptance-4a.test.ts` 同一條流程，看輸入修復、衍生零件、結合、干涉與餘隙的實況。
- B. 用 eDrawings（或 SW）開輸出的組合件 STEP，目測階層、位置與顏色。
- C. 真人走一遍：新零件做主模型 →「從本體產生組合件」→ 插入零組件的「標準件圖庫」→ 結合（含進階結合）→ 干涉／餘隙 → 改主模型，回報不順的地方。
- D. 對照你的標準：圖庫的尺寸表（ISO 4762／8734／7089）、定位銷孔的公差表（ISO 286-1），都在 `packages/library`、`packages/model/src/dowel.ts`，表值是手打的。
- 還有：Phase 3 的補驗收（下面的 0–6 項）仍然順延。



0. **桌面版的人工驗收（3b-6 第 3、7 項，2026-10-03）**：在沒裝過開發工具的 Windows 帳號（或另一台電腦）安裝 `3D-Builder_0.1.0_x64-setup.exe`，斷網啟動，用**原生對話框**存、開 `.3dbx` 與 `.3dba`，開一個真的專案資料夾，最後解除安裝；步驟在 [ADR 0052](docs/adr/0052-desktop-shell.md)「要使用者做的」。安裝檔不在版本庫，在這台 `npm run build -w @3db/desktop` 重做就有。
1. **Phase 2 驗收樣本（已結案，範圍降低）**：藍圖要的是使用者的一個 SW 組合件（10–20 個零組件）。
   - **使用者沒有 SW，只有 eDrawings（2026-09-30）**：所以藍圖驗收 ③「在 SW 開啟」與「用 SW 樣本重組」都無法照原文做。改為把金樣夾具（15 個零組件）輸出成 `<使用者資料夾>\Downloads\金樣夾具-15零組件.step`（`STEP_OUT_DIR=<資料夾>` 跑 `tests/phase2/golden-assembly.test.ts` 產生），用 eDrawings 開啟目測。**使用者已開啟，看到的與下述一致**（eDrawings 不是 OCCT，是獨立於我們的讀取器），並**明確接受這個較低的範圍作為 Phase 2 閘門（2026-09-30）**。該檔案有：3 塊定位板並排（x = 0、120、240）、每塊 2 支削邊銷插在孔中（x ± 40）、2 個疊起來的 V 型塊在板的正中央（底面在 y = 15 與 55）。
   - **之後若有人有 SW**：可補做原本的驗收，需要一個保留結構的組合件 STEP（下面的說明）。不阻擋 Phase 3。
   - **目前狀態（2026-09-30）**：`<使用者資料夾>\Downloads\SW樣本` 有 `CIV0000467治具_step.STEP`、`3D_MT17203_CIV0000467_Porduct.STEP` 與 `T1405001.SLDASM`，**都不能用來驗收**：兩個 STEP 各只有 1 個 `PRODUCT`、1 個實體、0 個 `NEXT_ASSEMBLY_USAGE_OCCURRENCE`（AP203，組合件被併成單一實體；治具 2004 個面、130×100×10 mm，產品件 340 個面）；`.SLDASM` 是 SW 的專有壓縮格式，讀不出零件參照，我們沒有讀取器，它的零件檔（`.SLDPRT`）也沒給。需要重新輸出：每個不同的零件各一個 STEP，外加一個保留組合件結構的組合件 STEP（檢查：搜尋 `NEXT_ASSEMBLY_USAGE_OCCURRENCE`，應有 10 次以上）。
   - （2026-10-01）樣本資料夾多了 `組合件1.step`（16 MB）：檔頭是 Open CASCADE 8.0、2 個實體、2 個 `NEXT_ASSEMBLY_USAGE_OCCURRENCE`，是本工具自己輸出的（治具加產品件），不是 SW 的輸出，不能當 3b 的樣本。
   - 每個不同的零件各自輸出 STEP；重複使用的零件只要一份。這些檔案輸入後當零件用。
   - 整個組合件的 STEP，或各零組件位置的截圖，用來比對位置。組合件 STEP 輸入是 Phase 3b，所以只拿來對照。
   - 最晚在 2F 前提供；越早越好，2E 的 STEP 組合件輸出也能拿它對照。
2. **2A–2E 實機確認（已完成，2026-09-30）**：使用者用自己的瀏覽器走完下面五組（建立與存檔、結合、移動與參考檔、輸出 STEP、載入進度），系統的資料夾與存檔對話框都確認過。過程中發現右鍵旋轉沒有任何提示，已補上圖面提示（`f14d266`）。測試用的專案資料夾是 `<使用者資料夾>\Downloads\3DB實機確認`（金樣零件的複本）。伺服器是用背景程序加暫存設定啟動的（`F:` 磁碟不能 `npm run dev`，見 §6「工作區連結」）。以下是當時的步驟，留作日後再測的清單：
   - 先建立一個專案資料夾（例如「文件\CIV0000467」），把 STEP 檔（或 .3dbx）放進去；不建議直接選「下載」。
   - 「檔案」→「新組合件」：直接進入「開始組合件」，先選這個專案資料夾（Windows 的選資料夾視窗只顯示資料夾，看不到檔案是正常的；瀏覽器會詢問是否允許讀取）；清單會列出資料夾裡的 .3dbx 與 STEP 檔；
   - 在清單點一個零件、按 ✓ 放在原點（固定）；再用「組合件」→「插入零組件」插入零件，其中一個插入兩次，在圖面點一下放置；
   - 「儲存檔案」存進這個資料夾（或它的子資料夾）→「新零件」→「開啟舊檔」開回組合件，位置應該不變。
   - （2C）「組合件」→「結合」：點孔的內壁與銷的柄（小孔要先用滾輪放大），PropertyManager 會建議「同軸心」，按 ✓；再點板面與凸緣的底邊 → 「重合」→ ✓。設計樹的結合資料夾會列出它們，零組件前的 (-) 表示還能動。
   - （2D）用左鍵拖曳還能動的零組件：沒有結合的會跟著游標平移；插在孔裡的銷只會繞孔轉。右鍵拖曳是旋轉。固定或完全定義的零組件拖不動，狀態列會說明。「組合件」→「移動零組件」可以輸入 Delta XYZ、至 XYZ 位置，「旋轉零組件」輸入角度。
   - （2D）設計樹在零組件上按右鍵 →「開啟零件」：改一個尺寸、存檔，再按零件設計樹上方的「返回組合件」，組合件會顯示改過的零件，結合仍成立。
   - （2D）在檔案總管把一個零件檔改名，再開啟組合件：會出現「找不到參考的檔案」，按「瀏覽…」選改名後的檔案。
   - （2D）重新整理頁面後開啟組合件：資料夾對話框會有「使用「資料夾名稱」」，瀏覽器會再問一次是否允許讀取（可以選「每次造訪都允許」，之後就不再問）。
   - （2E）在有零組件的組合件按「檔案」→「輸出 STEP」，會下載 `<組合件名>.step`。用 SW 開啟：應該是一個組合件，零件名稱是檔名，零組件名稱如「削邊銷<2>」，位置與畫面一致（結合移動過的零件是移動後的位置）。若零件檔遺失，會顯示檔名並中止，不產生檔案。
3. **Phase 3 驗收樣本**：3 個真實零件的 SW 輸出 STEP、特徵清單、關鍵尺寸；沒有 SW 的替代驗收**使用者已接受（2026-09-30）**；還缺哪 3 個零件。給同事的說明已寫在 `docs/sw-export-request.md`（未追蹤，使用者決定先擱置）。細節見 [docs/phase3-plan.md](docs/phase3-plan.md) §5、§6。
4. Phase 4 樣本：1–2 個夾治具案例、常用廠商標準件的 STEP。
5. （可選）壓縮 Docker 虛擬磁碟；刪除 `spike/occt-gaps` 分支。
6. **3a-1 到 3a-6 的實機確認（使用者 2026-10-01 決定先保留）**：各項要驗收的步驟寫在 §10 對應的段落（運算式、輸入修復與直接編輯、多本體、草圖工具、特徵 I、異型孔、掃出——尤其「直線加圓弧」的路徑、疊層拉伸、肋材）。自動化測試與瀏覽器腳本都已通過，但還沒有人用滑鼠走過一遍；3a-10 驗收前要補。
7. **2026-10-08 已裁的兩項，不要重複提出**：
   - ① **推送**：2026-10-08 已推，`origin/main` 現在是 `92f3476`（這台電腦之前未推的四個提交都上去了：`9e9f617` 組合件的資料夾／剖面／眼睛／右鍵選單、`f5e8377` Vite 設定檔的 `.ts` 副檔名、`2270fd9` 與 `92f3476` 兩版本文件）。**要留意的**：推的時候 H9 的人工實機項目還沒走完（使用者要自己走一遍）。`9e9f617` 那版沒有動任何 `*.test.ts`，只加了三個瀏覽器重播腳本（`tests/e2e/manual-h9-folder.js`、`manual-asm-section.js`、`manual-asm-menu.js`），所以 `packages/render/src/viewer.ts` 的 124 行改動（新增 116、刪除 8）與 `AssemblyViewport.tsx`、`Viewport.tsx` 的渲染改動**不在 `npm run check` 的保護範圍內**——之後再碰這些地方，驗法要用 `npm run verify:ui`（它重播手冊並抓 Console 錯誤），只跑 `npm run check` 擋不住渲染回歸。
   - ①b **推送（2026-10-09）**：`bf25dcf`（工程圖視圖連動：前視圖整組移動、上視／右視沿對齊方向滑動、右下角把手改比例、`sheet.shift` 與視圖 `slide`，圖紙檔 Schema 7）與 `0bd7031`（「最適比例」把標註算進去，`fit.ts`）。這兩版與 `9e9f617` 不同：**有單元測試**（`tests/phase5/drawing-linked.test.ts` 17 項、`drawing-fit.test.ts` 8 項），所以排版與格式部分受 `npm run check` 保護；視窗互動（拖曳、把手）仍只有瀏覽器腳本 `manual-drawing-linked.js`。推送前依上一條的要求跑了：`npm run check` 2395 項通過；完整 `npm run verify:ui` **120 支全過、0 個 Console 錯誤**（包含 `9e9f617` 那三支剖面／眼睛／右鍵／資料夾重播）。
   - ② **「import 一律自帶副檔名」的全倉庫統一：不做。**帶副檔名的只有兩處——`apps/web/vite.config.ts`（Vite 的硬性要求）與 `tests/phase8/auto-close.test.ts`（跟著統一）；剩下 763 處／312 個檔案維持無副檔名。要重開這件事的時機：Vite 真的把 `configLoader` 改成 `native` 預設，或還有別的設定檔需要帶副檔名時；屆時單獨一版，不要混進功能提交。


## 9. 歷史存檔紀錄

Phase 1、Phase 2 及藍圖歷史紀錄已依 2026-10-10 決策歸檔至 [docs/handoff-history.md](docs/handoff-history.md)（維持內容完全一致）。

