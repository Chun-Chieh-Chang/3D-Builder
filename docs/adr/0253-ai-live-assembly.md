# ADR 0253：AI／MCP 即時操作視窗中的組合件

日期：2026-11-14。狀態：已實作。

延伸 [ADR 0238](0238-ai-live-gui.md)（零件的即時連線）到組合件。組合件 MCP 的工具契約見[組合件 MCP 計畫](../design/ai-cad-control/assembly-mcp-plan.md)。

## 背景

組合件 MCP（`assembly_*`）首版只操作 MCP 工作區內的獨立組合件，使用者要等 Agent 存檔後自己開檔才看得到。零件已有即時連線：App 把開著的零件傳給 MCP，Agent 的批次先在伺服器試算，可行才送到視窗，套用成一筆可復原的步驟。組合件沿用同一條連線。

## 決定

使用者於 2026-11-14 選定：

1. **伺服器先試算**（比照 ADR 0238）。App 把開著的組合件與它用到的零件檔內容一起傳給 MCP；Agent 的批次在伺服器重建零件、求解、可選干涉與預覽圖，可行且不是試跑時才送到視窗。不採「App 直接套用」：那樣 Agent 無法先試算或取得預覽，只能真的改使用者的畫面再復原。
2. **只改目前開著的組合件**。Agent 不能透過連線開檔、新建或切換文件；開哪個檔由使用者決定。
3. **新零件檔由 App 讀**。伺服器讀不到 App 的專案資料夾（網頁版在瀏覽器裡），所以 Agent 插入組合件裡還沒有的零件檔時，伺服器請 App 讀「組合件所在資料夾下的相對路徑」並傳回內容，先試算再套用。App 只讀專案資料夾內的 `.3dbx`；路徑跳出專案、副檔名不符、讀不到都明確拒絕。

細節：

- **協定 v2**（`LIVE_PROTOCOL = 2`，舊版 App 與新伺服器互相拒絕，不誤讀）。App 送出的 `hello`／`doc` 帶「開著的文件」：零件（`PartDoc`）、組合件（`AssemblyDoc` 加上每個來源檔 id 對應的內容雜湊）或其他（工程圖等）。零件檔內容沿用既有的 blob 傳送：以 SHA-256 為名、只送沒送過的、伺服器逐一核對雜湊。伺服器送出的 `apply`／`undo` 帶目標（零件或組合件）；與開著的文件不符時，App 以 `wrongDocument` 拒絕。
- **伺服器**：連線中、App 開著組合件時，`assembly_*` 工具操作的是 App 的組合件，零件來源取自 App 傳來的內容，不讀工作區。`assembly_apply_commands` 在伺服器求解；可行且不是試跑時送 App 套用，App 回覆成功才算數。`assembly_new`、`assembly_open`、`assembly_save` 在此時拒絕（存檔由使用者在 App 做）。`assembly_export` 照常寫到 MCP 工作區。既有的 `undo` 工具在開著組合件時收回 Agent 的上一批。零件工具在開著組合件時拒絕，反之亦然。
- **App**：組合件的批次用 `AssemblyHistory.applyBatch` 套用成一筆復原步驟。使用者正在插入、配合、移動、陣列、拖曳、座標軸或確認刪除時拒絕（`busy`）；組合件版本與伺服器所知不同時拒絕（`conflict`），並先送出最新組合件。使用者的修改與零件相同，停 300 ms 後送出；換成零件或組合件時立即送出新的文件。
- **範圍**：伺服器能試算的組合件與 `assembly_*` 首版相同：直接引用的零件、重合／同心／距離配合，無陣列、鏡射、次組合件，元件沒有隱藏、透明、抑制。超出時明確拒絕並說明原因，不默默略過；App 端照常可用。
- 不新增 Schema，不改幾何或求解演算法。
- **讀檔的次數**：組合件還沒用到的檔案，每次呼叫（查詢、試算、套用）都向 App 重讀一次，因為呼叫之間檔案可能被改過；批次套用後該檔以內容雜湊記住，之後不再讀。讀檔逾時只讓該次呼叫失敗，不關閉連線（讀檔不改任何東西）；套用或復原逾時才關閉，與 ADR 0238 相同。
- **App 的「忙碌」**：插入、配合（含智慧配合）、移動、拖曳、座標軸、確認刪除、找不到檔案、陣列、爆炸視圖（編輯或已爆炸顯示）、形成次組合件的 PropertyManager 或對話框開著時。

## 實作

- 協定：`packages/io/src/liveBridge.ts`（`LiveOpen`、`LiveBatch`、`read`／`file`）。伺服器：`apps/mcp/src/bridge.ts`（`readFile` 核對雜湊）、`assemblySession.ts`（`follow`、`liveBytes`、`undoLive`、`subsetProblem`）、`assemblyTools.ts`、`server.ts`（呼叫開頭先收 App 的文件，再依開著的文件分派）。App：`apps/web/src/state/aiBridge.ts`（訊息依序送出，組合件的零件檔讀取與雜湊在送出前完成）、`assembly.ts` 的 `agentHost`、`store.ts` 在顯示組合件與工程圖時呼叫 `historyReplaced`。
- `live_status` 多回報 `open`（App 開著的文件種類）。

## 驗證結果（2026-11-14）

- Node：`apps/mcp/test/live-assembly.test.ts` 4 項（工作區沒有任何零件檔，來源全部來自 App）、`live-bridge.test.ts` 新增 2 項（偽造雜湊、讀檔逾時不斷線、缺 `open` 斷線、`wrongDocument`）。突變 16 項（`scratch/ci/mutate-0253.mjs`）全部轉紅；第一輪「讀檔不核對雜湊」與「讀檔逾時就斷線」存活，補測後轉紅。
- 真瀏覽器：`scripts/verify-live.mjs` 以瀏覽器私有檔案系統建專案（`parts/`、`asm/`），在實際 App 開組合件、Agent 試算（畫面不變）、插入 PropertyManager 開著時被拒、套用後 App 自己求解出銷 x = −40 mm 並列在特徵管理員、App 的一次復原收回整批、Agent 的 `undo`、拒絕存檔／新建／零件工具／專案外路徑、輸出 BOM。截圖 `out/live/assembly.png`。

## 驗證計畫

- Node：真的 `LiveBridge` 伺服器加上模擬 App（沿用 `apps/mcp/test/live-bridge.test.ts` 的做法），涵蓋試算不送出、套用成一筆復原、使用者先改了組合件的衝突、忙碌、文件不符、超出範圍的拒絕、收回上一批，以及突變測試。
- 真瀏覽器：擴充 `scripts/verify-live.mjs`，在實際的 App 開組合件、輸入連線碼，由 Agent 批次插入元件與配合，核對特徵管理員、求解位置與一次復原。
- 完整 `npm run verify:ui`、typecheck、四項 lint、相關單元測試。
