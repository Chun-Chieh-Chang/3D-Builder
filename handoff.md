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

## 3b. 2026-10-30 P1 第一批已完成：繪製時輸入尺寸（直線／中心線、圓、矩形）

- 依使用者確認的四項設計完成並驗收（見[驗收表 P1](docs/design/sketch-interaction/acceptance.md) 與 DEV_LOG 同日條目）：角度 0°～180° 由游標側定方向；部分鎖值 Enter 即完成；鎖值優先於吸附並提示；槽／多邊形留下一批。
- 變更：`apps/web/src/sketcher/controller.ts`（entry 狀態、`lockSnap`、提交時加驅動尺寸）、`apps/web/src/components/Viewport.tsx` `EntryBoxes`、`apps/web/src/actions.ts`（數字鍵起始輸入、Tab）、`app.css`、i18n `sketch.entry.*`；新測試 `apps/web/test/sketch-entry.test.ts`（32 項）、`tests/e2e/manual-sketch-entry.js`；`apps/web/test/sketch-collapse.test.ts` 的 host 改為每文件只求解一次（RCA 見 DEV_LOG，門檻未改）。
- **下一步**：
  1. P1 第二批：槽與多邊形（G16、B06）——多邊形半徑／邊長、方向角、頂點朝向或邊平行；沿用 `entryFields`／`lockedPoint`／`Builder.dimension`。
  2. 既有限制另案：PlaneGCS 對約 900 個拘束、大多已定義的草圖 `Aborted(OOM)`（150 個標尺寸矩形可重現，100 個 52 ms；對照程式在工作階段暫存區，不在版本庫）。
  3. E03：P1 輸入框在 macOS 鍵盤與 DPR2／不同縮放尚未驗證。

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
