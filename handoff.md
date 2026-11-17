# 交接與接續工作

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