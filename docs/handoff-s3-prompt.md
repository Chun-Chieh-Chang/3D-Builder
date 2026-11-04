# 接手指令：3D-Builder S3（AI 連到執行中的 GUI）

把本檔整段貼給另一台電腦上的 Claude Code，作為第一則訊息。

---

你要接手 3D-Builder 專案的 S3：讓 AI 代理經 MCP 連到執行中的 GUI。請用 ASD-STE100 的方式回覆：句子短、一句一件事、主動語態、用詞一致，大約做到 80% 就好，以繁體中文回答。

## 1. 先做這些，再動手

1. 取得分支並確認狀態：

```bash
git fetch origin claude/eager-ramanujan-n20v0i
```

```bash
git checkout claude/eager-ramanujan-n20v0i
```

```bash
git status --short --branch
```

```bash
git log -5 --oneline
```

   最新提交應為 `ba879af docs(handoff): S3 status after PR #9 merged…`，其下是 `264a7fb`（PR #9 合併到 `main`）。

2. 安裝並建置：

```bash
npm install
```

```bash
npm run mcp:build
```

3. 依序閱讀：
   - `handoff.md` §0：S3 的設計、已完成項目、待辦、陷阱。
   - `AGENTS.md`：強制規則，必須遵守。
   - `docs/adr/0237-ai-agent-mcp-server.md`：S0–S2 的設計。
   - `apps/mcp/README.md`。

## 2. 已完成（都在 `main`）

- `apps/mcp`：MCP 伺服器，有 13 個工具。其中 `live_status` 是 S3 新增的。
- 無頭 CLI、3MF 輸出、命令白名單、整批交易。
- S3 已完成的部分：
  - `History.applyBatch`（`packages/model/src/history.ts`）：整批命令只算一個復原步驟，全有或全無。
  - 協定（`packages/io/src/liveBridge.ts`）。
  - 伺服器端連線橋（`apps/mcp/src/bridge.ts`）：只綁 127.0.0.1、需要連線碼、檢查 Origin、5 次錯碼鎖定、一次只接一個 app。
  - app 端 `AiBridge`（`apps/web/src/state/aiBridge.ts`）：開啟零件時會跟著換掉的 history。
  - store 接線：`store.ai`、`connectAi`、`disconnectAi`、`UiState.ai`。
- 測試：`apps/mcp` 與 `packages/io` 共 90 項，S3 共 7 項（`apps/mcp/test/live-bridge.test.ts`、`packages/model/test/history-batch.test.ts`），全部通過。

## 3. 待辦（依序）

1. **「AI 控制」對話框**
   - `UiState.dialog` 加入 `'aiControl'`。
   - 對話框內容：連線碼輸入欄、「連線」與「中斷」按鈕，以及狀態文字。
   - 狀態取自 `store.getState().ai`，有四種：`off`、`connecting`、`on`（含批次數）、`error`（`format`、`port`、`refused`、`closed`）。
   - 參考 `apps/web/src/components/PhysicalDialog.tsx` 的寫法。
2. **狀態列標示**：在 `apps/web/src/components/StatusBar.tsx` 顯示「AI 已連線（N 批）」，讓使用者隨時知道 AI 可以改零件。
3. **登記新功能**：
   - action `ai-control`：放在 `apps/web/src/actions.ts` 的 tools 群組。
   - 圖示對應：`apps/web/src/icons/solidcraft/manifest.json`。
   - 中英文字：`packages/i18n/src/zh-TW` 與 `packages/i18n/src/en`。
   - 說明：`help.*` 主題，以及 `docs/help-links.json` 的 `_untied`。`tests/phase8/help.test.ts` 會檢查這兩項。
4. **GUI 實機驗證**：寫 `scripts/verify-live.mjs`（Playwright）：
   1. 啟動 dev server 與 `apps/mcp/dist/server.mjs`。
   2. 在 GUI 輸入 `live_status` 給的連線碼。
   3. AI 用 `apply_commands` 加一個特徵，確認特徵樹出現它。
   4. 在 GUI 復原一次，確認整批撤回。
   5. 在 GUI 修改零件，確認 `part_summary` 看得到這個修改。
5. **收尾**：
   1. 撰寫 ADR 0238，以及 DEV_LOG 的紅隊四問。
   2. 執行 `npm run docs:sync`。
   3. 執行 `npm run check`，再推送並開**新的 PR**。#9 已合併，不可再用。

## 4. 已知陷阱

- **不要讓 app 的訊息等待工具佇列。** app 送來的零件只記為待載入（`bridge.takePending()`），在下一個工具呼叫開頭才載入。改回直接載入會造成死結。
- **`mutate` 沒有 `default` 分支**：未知命令會被默默忽略，所以一律先經 `isCommandType` 檢查。
- **新增檔案後要執行 `npm run docs:sync`**，否則 CI 的 `lint:repo` 會失敗。PR #9 就發生過一次。
- **改到 UI 時，提交前要跑完整的 `npm run verify:ui`**，而且執行期間不可修改原始碼（AGENTS §4）。
- **在雲端的 4 核心容器上**，兩項鈑金測試（`tests/phase7/sequential-bends.test.ts`、`sheet-unfold-refold.test.ts`）在整批執行時會逾時。乾淨的基準版本也一樣，所以不是新變更造成的。不可放寬時間限制（AGENTS §3.3）。
- **額度不知道還剩多少**：每完成一個里程碑，就更新 `handoff.md` §0、提交並推送。

## 5. 進度頁

https://claude.ai/artifact/NVyEoWMcUva3EPvJ56Koqt

- 資料存在 db 集合 `tasks`（t01–t19）與文件 `meta/run`。
- 用 `ArtifactData` 工具更新；每次寫入都要帶上次讀到的 `if_version`。
- 每完成一步，就更新對應的 task 與 `meta/run`。
