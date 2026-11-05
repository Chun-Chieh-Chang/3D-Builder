# @3db/mcp — 讓 AI 代理操作 3D-Builder（ADR 0237）

這個套件提供兩種用法：
- **MCP 伺服器**：給 Claude Code 等 AI 代理使用。
- **無頭 CLI**：執行 JSON 建模腳本，不需要視窗。

兩者都用應用程式本身的命令（`Command`）與幾何核心。兩者都不能執行任意程式碼。

## 建置

```bash
npm run mcp:build
```

產生 `apps/mcp/dist/server.mjs` 與 `apps/mcp/dist/cli.mjs`。

## 在 Claude Code 中使用

專案根目錄的 `.mcp.json` 已登記伺服器 `3d-builder`：
1. 先建置。
2. 在專案根目錄啟動 Claude Code。
3. 核准 `3d-builder` 伺服器。

零件只會讀寫在 `out/agent/`（`THREEDB_WORKSPACE`）。

建議的工作流程：
1. 讀 `command_reference`（`commands`、`types`、`example`）。
2. 用 `apply_commands` 加 `dry_run: true` 與 `preview: {}` 試跑。把截圖給使用者確認。
3. 確認後，不加 `dry_run` 再送一次。整批全部成功才保留。
4. 讀回答中的 `broken`、`after.mass`、`after.box`，與預期值比較。
5. 要選面或邊時，用 `query_elements` 查詢，再把 `ref` 原樣放進命令。
6. 用 `render_view` 看結果。用 `part_save` 存成 `.3dbx`，或用 `export_file` 輸出 STEP、STL、3MF。

## 連到開啟中的零件（S3）

建置並啟動本機 MCP 伺服器後，呼叫 `live_status` 取得連線碼。在本機 3D-Builder 選「工具 → AI 控制」，貼上連線碼並按「連線」。狀態列會顯示連線與批次數。每批可一次復原，開啟另一零件後改為追蹤新文件。編輯中、版本不符或非零件狀態會拒絕修改。關閉對話框不會斷線；請按「中斷連線」。

GUI 整合檢查：`npm run mcp:build` 後執行 `node scripts/verify-live.mjs`。另需完整 `npm run check` 與 `npm run verify:ui`；局部腳本不能代替全量驗收。

## 無頭 CLI 使用

```bash
npm run mcp:run -- apps/mcp/examples/disc.json --set R=40 --out out/disc
```

- 腳本的 `variables` 會變成文件變數。`--set` 依名稱替換；腳本沒有的名稱會被拒絕。
- `outputs` 可寫出報告（JSON）、截圖（PNG）、STL／STEP／3MF，以及 `.3dbx`。
- 結束碼：0 成功；1 腳本被拒絕（原因在 stderr）；2 命令列錯誤。

## 注意

- 單位是 mm 與度，模型的 y 軸朝上。
- 在基準面上的除料，要加 `reverse: true` 才會切進材料。
- 3MF 會把模型的 y 轉成檔案的 z，使零件在切片軟體中以相同方向站立。
- OCCT 的布林運算會持續佔用 heap（AGENTS.md §3.5）。伺服器超過門檻時會重新載入 kernel（ADR 0126）。
