# ADR 0238：AI／MCP 連到執行中的 GUI

日期：2026-11-05。狀態：已實作；全量驗收與獨立審查完成（2026-11-05）。

## 決定

- 延續 ADR 0237 的命令白名單及伺服器真實幾何試算。沿用已合併的 `LiveBridge`、`AiBridge` 與 `History.applyBatch`，不建立第二套建模路徑。
- 使用者在「工具 → AI 控制」輸入 `live_status` 回傳的連線碼。只連本機 127.0.0.1；伺服器檢查 Origin、連線碼及單一 app。每次連線的批次數從零開始。
- 狀態列提供持續可見的連線狀態與入口。關閉對話框保留連線，按「中斷連線」才結束。
- 每批為一個復原步驟。換零件後重新訂閱 History；編輯交易中、非零件或版本不一致時拒絕修改。
- 連線建立最多等待 10 秒。舊 socket 的事件不再影響新連線；連線尚未開啟時不送文件，最新文件隨 hello 傳送。
- app 傳回的文件維持 pending，下一個 MCP 工具呼叫才載入，避免與工具佇列互等。
- 不新增 Schema，不修改幾何演算法。

## 驗證與限制

- `scripts/verify-live.mjs` 啟動真正 MCP stdio 伺服器、Vite 與 headless Chrome，使用既有 verify-ui 相同的 CDP 技術，不新增 Playwright 依賴。
- 實測 GUI 輸入連線碼、AI 批次建立圓柱、特徵樹與真實體積 π·10²·5、一次復原、使用者改名同步、換文件、編輯交易拒絕、組合件／工程圖拒絕及斷線。組合件走產品的「新組合件」；工程圖以真實的 `DrawingStore` 與空白圖紙進入（「新工程圖」需要專案資料夾），兩者都由同一 `isPart()` 閘門拒絕。
- 實際連線對話框截圖已檢視。輸出為 `out/live/connected.png`；測試使用獨立暫存瀏覽器資料夾，下載不外溢至使用者下載目錄。
- 局部測試：橋接、批次 History、說明共 5 檔 60 項通過。新增真實 WebSocket Origin、第二個 app、回應逾時與非零件拒絕案例。
- 全量驗收（2026-11-05）：`npm test` 372 檔、4475 通過、26 既有略過、0 失敗；`npm run verify:ui` **270/270**；`typecheck`、`lint:rules`、`lint:deps`、`lint:i18n`、`lint:repo` 全過。第一次 `verify:ui` 被執行端的 1 小時上限中止（240/240 通過、0 失敗），之後整輪重跑取得單一完整結果，不以分段結果冒充。
- 同一輪修掉兩個既有的 Windows 測試可攜性缺陷（非本功能造成）：`apps/mcp/test/e2e.test.ts` 以 `process.execPath` 執行 Vite（`execFileSync('npx')` 在 Windows 找不到），`apps/mcp/test/session.test.ts` 以 junction 建立連結（一般使用者無權限建立符號連結）。斷言與門檻未放寬。
- 全量驗收與審查由接手的工作階段執行，該工作階段使用的模型與實作者不同；原交接指定的 GPT-6 Astra 未實際參與，文件中不宣稱它做過審查。
- 未宣稱使用者已用 Claude Code 手動驗收，也未宣稱 OCCT Heap 零洩漏。
