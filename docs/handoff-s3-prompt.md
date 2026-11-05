# 接手指令：3D-Builder S3 收尾（使用者端 Claude Code 實測）

把本檔整段貼給另一台電腦上的 Claude Code，作為第一則訊息。

---

你要接手 3D-Builder 專案的 S3 **收尾**：讓使用者在執行中的 GUI 用 Claude Code 實際試一次 AI 連線建模。S3 的功能與驗收都已合併到 `main`，你負責的是「使用者端實測」這一段。請用 ASD-STE100 的方式回覆：句子短、一句一件事、主動語態、用詞一致，大約做到 80% 就好，以繁體中文回答。

## 1. 先做這些，再動手

1. 從最新 main 接續；S3 的功能分支 `codex/s3-live-ui` 已刪除，不要再 checkout：

```bash
git status --short --branch
git fetch origin
git switch main
git pull --ff-only
git log -8 --oneline
```

    工作區有在途變更時，先確認歸屬並保留，不直接切換或覆寫。

2. 安裝並建置：

```bash
npm install
npm run mcp:build
```

3. 依序閱讀：
   - `handoff.md` §0：S3 已完成項目與剩餘待辦。
   - `AGENTS.md`：強制規則，必須遵守。
   - `docs/adr/0238-ai-live-gui.md`：S3 的設計與驗收紀錄。
   - `apps/mcp/README.md`：MCP 伺服器如何跑。

## 2. 已完成（都在 `main`）

- `apps/mcp`：MCP 伺服器與 13 個工具（`live_status` 是 S3 新增）。
- 無頭 CLI、3MF 輸出、命令白名單、整批交易。
- S3 全部實作與驗收（PR #10，`aecf1a1` 合併）：
  - `History.applyBatch`（`packages/model/src/history.ts`）：整批一個復原步驟，全有或全無。
  - 協定（`packages/io/src/liveBridge.ts`）、伺服器端連線橋（`apps/mcp/src/bridge.ts`：127.0.0.1、連線碼、Origin 檢查、5 次錯碼鎖定、單一 app）。
  - app 端 `AiBridge`（`apps/web/src/state/aiBridge.ts`）與 store 接線（`store.ai`、`connectAi`／`disconnectAi`、`UiState.ai`）。
  - 使用者介面 `apps/web/src/components/AiControlDialog.tsx`：工具選單「AI 控制」、狀態列連線狀態、中英說明。
  - GUI 整合腳本 `scripts/verify-live.mjs`（真實 MCP stdio＋Vite＋headless Chrome，非 Playwright）。
- 驗收：`npm test` 372 檔、4,475 通過、26 既有略過、0 失敗；`npm run verify:ui` 270/270；CI 三平台 `integrity` 全 success。

## 3. 你要做：使用者端 Claude Code 實測

1. 啟動：dev server（`npm run dev` 或專案既有腳本）與 MCP 伺服器（`npm run mcp:run` 或 `node apps/mcp/dist/server.mjs`，依 README）。
2. 在 GUI 的「工具 → AI 控制」貼上 `live_status` 印出的連線碼，確認狀態列顯示連線中。
3. 讓 Claude Code 透過 MCP 批次建立一個圓柱（`apply_commands`），確認特徵樹出現該特徵、`part_summary` 的體積對得上 π·r²·h。
4. 在 GUI 復原一次，確認整批撤回。
5. 在 GUI 改名該特徵，確認 Claude Code 端的 `part_summary` 同步到新名字。
6. 拒絕路徑各試一次：切換到組合件／工程圖、編輯交易進行中，確認 AI 修改被拒。
7. 完成後把結果（哪些通過、哪些失敗、截圖路徑）回報給使用者，**不要自己把「使用者端已驗收」寫成既成事實**；取得使用者確認前，`handoff.md` §1b 的 S3 行維持「使用者手動試用未確認」。

## 4. 已知陷阱（沿用）

- **不要讓 app 的訊息等待工具佇列**：app 送來的零件記為待載入（`bridge.takePending()`），下一個工具呼叫開頭才載入；改回直接載入會死結。
- `mutate` 沒有 `default` 分支：未知命令會被默默忽略，一律先經 `isCommandType` 檢查。
- 改 UI 後提交前跑完整 `npm run verify:ui`，執行期間不可修改原始碼（AGENTS §4）。
- 雲端 4 核心容器上兩項鈑金測試整批逾時為既有現象，不可放寬期限（AGENTS §3.3）。
- 新增檔案後執行 `npm run docs:sync`，否則 `lint:repo` 會紅。

## 5. 歷史外部進度頁

https://claude.ai/artifact/NVyEoWMcUva3EPvJ56Koqt

- 資料存在 db 集合 `tasks`（t01–t19）與文件 `meta/run`。
- 用 `ArtifactData` 工具更新；每次寫入都要帶上次讀到的 `if_version`。
- 若沒有該服務的存取權，不必等待或假稱已更新。repo 的 handoff／DEV_LOG 與實際測試為交接依據。
