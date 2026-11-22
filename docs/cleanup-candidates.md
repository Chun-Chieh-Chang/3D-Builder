# 清理盤點與保留政策

更新日期：2026-11-22。舊盤點已封存於[2026-10-07至10-20紀錄](archive/cleanup-through-2026-10-20.md)，其中當時的刪除限制、數量和本機路徑不作今天的清理判定。

## 2026-11-22：封存接手文件與清理本機工作副本

- S3 使用者端實測已結案，part-3 精確自動辨識仍擱置。兩份接手指令移到封存區，保留原始步驟與歷史引用。現行清單見 [handoff](../handoff.md)。
- PR #15 已合併至 `main`。本機副本 `out/codex-drawing-pr` 無待提交變更或 stash，補丁的 patch ID 與 `dcd67d38` 一致，PR 說明也與 GitHub 相同。拆除隔離副本內由 npm 產生的 junction 後，將副本、補丁和 PR 說明移入資源回收筒。
- 清理 `out/chrome-verify/Default` 的五個可再生快取目錄，保留瀏覽器設定和工作階段資料。本機移出的檔案合計約 365 MiB。
- 保留實機模型、工程圖審閱稿、測試證據、在途修改與歷史備份。

## 本輪可證明的處置

- TypeScript證明未使用的匯入綁定、私有`pickPlane`包裝方法與死的區域接收變數已移除；`noUnusedLocals`阻擋新增同類問題。
- 保留有可能執行驗證／原生運算／初始化的呼叫；例如`sectionCut`、原生投影與探針仍執行，不因回傳值沒讀就刪掉。
- 未使用參數不等於可任意更改呼叫契約；本輪未啟用`noUnusedParameters`或以改參數數量來清警告。
- 此次追蹤資源逐位元掃描未發現相同內容的重複群組。動態圖示、桌面各平台圖示／來源、WASM依賴、金樣、第三方授權與歷史研究證據仍有責任，因此保留。
- 不清除忽略的`out/`／`scratch/`、使用者模型與私有樣本；證據不是垃圾。沒有本地wiki，也沒有假稱遠端wiki已盤點。

## 2026-11-19：本機忽略檔清理（使用者逐項勾選後刪除）

上一節「不清除忽略的`out/`／`scratch/`」是預設；本次由使用者逐項勾選同意後例外刪除，全部是未追蹤、無 junction、無程序佔用的本機檔，約 3.57 GB：

| 項目 | 大小 | 理由 |
|---|---|---|
| `apps/desktop/src-tauri/target` | 3.5 GB | Rust 建置快取，可再生；下次桌面版建置需完整重新編譯 |
| `apps/web/dist` | 47 MB | 11-04 的建置產物，舊於原始碼；建置會重產 |
| `.claude/worktrees/frosty-swartz-ff451c` | 1.5 MB | git 已未登記的 worktree 殘留（11-18 進度頁）；其分支已不存在、ADR 0258 已在 main |
| `scratch/` 10-11～10-20 的 `archived-worktrees`、`codex-worktree-sheet-metal-break-corner-2026-10-14`、`sidebar-parity-worktree-2026-10-18`、`diagnostics`、`drawing-parts`，以及 `decisions-2026-10-11.html`、`drawing-feasibility-2026-10-11.md`、`fix-fillet4.test.ts`、`real-part1.json`、`review-2026-10-11-antigravity-audit.md`、`test-full-real-part1.test.ts`、`vitest-full-2026-10-14-late2.txt` | 約 3 MB | 一個多月前的探針與備份 |
| `out/dimtfac`、`out/section-clearance`、`out/shots-sidebar`、`out/verify-dxf-20261029.json`、`out/verify-integrated-20261029.json` | 1.9 MB | 舊輸出；`section-clearance` 由測試重產 |
| `scratch/ff/worktree-copies` | 1.1 MB | 已不存在分支的日誌複本，無任何引用 |
| `scratch/ff` 的 14 個 `*.wip-0252／0255`、`*.before-*` | — | ADR 0252／0255 突變測試前的備份，對應版本已提交 |
| `scratch/review-drawing-20261119` | 258 KB | 工程圖審查的重現測試與進度頁；結論已寫入 DEV_LOG、handoff、ADR 0256 |

**影響**：DEV_LOG、ADR 與 `docs/archive/` 中引用上表 `scratch/`、`out/` 路徑的紀錄，其證據檔已不在本機（文字紀錄仍在）。**保留**：`apps/mcp/dist`（`.mcp.json` 的 MCP 伺服器）、`out/agent`（MCP 工作區）、`out/sketch-p0-pointer-baseline.json`（測試讀取，刪除後測試 2/2 通過確認）、`scratch/` 中受追蹤的 `ff`／`claude-takeover`、`.omo`、`.workbuddy-ai`、Tauri 的 `gen`／`icons`、`zz-hlr-spike.test.ts`（多份 ADR 引用）。

## 保留不是死碼的項目

讀回DXF／PDF／STL的驗證工具、翻譯註冊／測試機制、只供測試驗證的標準公式，以及尚未接UI但有測試／公開套件契約的函式，不只憑「產品沒引用」刪除。`replicad-opencascadejs`仍供`spikes/occt-gaps/`重現早期選型證據；SolidCraft原稿由manifest與授權檔管理，不能只搜尋SVG字面引用就刪。

全面掃描是候選證據，TypeScript／字面搜尋不是動態載入與外部契約的完整證明。每次移除仍須讀實際呼叫與副作用。可重跑事實與文件分類見[盤點](repository-inventory.md)，本批驗證與清理中的失敗萃取見[DEV_LOG](../DEV_LOG.md)。
