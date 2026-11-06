# ADR 0237：AI 代理以 MCP 操作 3D-Builder（無頭建模、量測、截圖、輸出）

日期：2026-11-04。狀態：**S0–S2 與附加項已實作並通過測試**（`apps/mcp`，41 項）。藍圖 F5.1「對外腳本 API」（P2）的第一步。

## 背景

使用者提供兩部影片與兩份提示詞：
- AI 透過 MCP 操作 FreeCAD（`execute_code` 執行 Python，`get_view` 擷取畫面）。
- SolidCraft 內建 MCP：介面上的每個操作都是帶 JSON 參數的命令，桌面版、命令列與 MCP 共用同一組命令。

使用者裁決（2026-11-04）：
- 先做 S0–S2（不開瀏覽器），用戶端是 Claude Code。
- FreeCAD 與 SolidCraft 只作參考，一律轉換成 3D-Builder 自己的系統。

## 決定

1. **只開放有型別的命令，不執行任意程式碼**。代理送的是 `@3db/model` 的 `Command`，與介面送的相同。本專案沒有 Python。執行任意程式碼也會失去「確定性」與命令層的檢查。
2. **整批交易**（`CadSession.apply`）：
   - 每個命令都套用成功，而且重建後沒有新壞掉的特徵（新特徵，或原本正常的特徵），才保留。
   - 否則文件回到原狀。測試比對序列化後的文件，不比對數量。
   - `dry_run` 永遠不保留。
3. **命令種類白名單**（`commandTypes.ts`）：`mutate` 的 `switch` 沒有 `default`，未知的命令會被默默忽略。白名單以 `satisfies Record<Command['type'], true>` 由編譯器雙向檢查。開發期間它抓到一個漏掉的 `editSketch`。
4. **命令參考就是原始碼**：`command_reference` 回傳 `commands.ts`／`schema.ts` 的型別宣告（以 `?raw` 在建置時取得）。TypeScript 7 沒有提供給 JavaScript 的編譯器 API，所以不產生 JSON Schema。這樣也不會有第二份需要同步的說明。
5. **回饋以真實數值為主**：每次回答都附上每個特徵的狀態與訊息、草圖自由度、體積、面積、質心、包圍盒（由網格計算，誤差 0.01 mm 以內）。
6. **以幾何查詢取代點選**：`query_elements` 依種類、類型、方向（1° 以內）、本體篩選，回傳可直接放進命令的 `ref`（含指紋）。圓柱的接縫邊標為 `seam: true`。
7. **截圖不開瀏覽器**（S2）：工程圖的精確隱藏線投影（`projectDrawingView`）加上 ADR 0146 的深度緩衝塗彩（`rasterizeShade`），在白底上畫可見邊，輸出 PNG。所以代理看到的就是工程圖會畫出來的樣子。
8. **檔案只在工作資料夾內**：拒絕 `..`、絕對路徑，以及指到外面的符號連結。
9. **Heap 高水位重新載入**：沿用 ADR 0126 的 `shouldRestartHeap`。超過門檻就重新載入 kernel 並重建。
10. **附加項**（使用者的第二份提示詞）：
    - 3MF 輸出（`packages/io/src/threeMf.ts`）：頂點焊接成封閉網格；build item 帶轉換，使模型的 y 對應 3MF 的 z（切片軟體以 z 為上）。
    - 重建事件：MCP log 通知，另有 `rebuild_events` 工具。
    - 預覽：`apply_commands` 加 `preview`，附上結果截圖，給使用者確認後再保留。
    - 無頭 CLI：`npm run mcp:run -- <script.json> --set R=40 --out <folder>`。
    - 圓盤範例：`apps/mcp/examples/disc.json`。
11. **不做**：
    - 自己呼叫 LLM 的「agent_controller」：Claude Code 本身就是生成、執行、看圖、修正的迴圈。
    - 連到執行中的 GUI、依參考物件自動產生外殼、2D 工程圖轉 3D、經 MCP 操作組合件：留到 S3 以後。
12. **說明字典**：MCP 伺服器不在應用程式介面中，不加 `help.*`。使用方法寫在 `apps/mcp/README.md`，伺服器連線時也會以 `instructions` 傳給代理。

## 工具

`part_new`、`part_open`、`part_save`、`part_summary`、`command_reference`、`apply_commands`、`undo`、`query_elements`、`render_view`、`export_file`（STEP／STL／3MF）、`rebuild_events`、`session_status`；2026-11-06 加 `recognize_features`（見 ADR 0239）。

## 紅隊四問

1. **輸入破壞**：
   - 未知或缺少的命令種類、非物件、空批次、超過 200 個、拼錯的參數名稱：一律拒絕，文件不變。
   - 伸長深度 `NaN`、`-5`、`0`、`1e400`、`abc`、空字串：皆不保留。
   - `limit: 1.5`、方向零向量或含 NaN、圖片尺寸 63／2049／400.5：一律以明確錯誤拒絕，沒有任何 `Math.round`。
2. **幾何相交**：倒角大於圓盤厚度（`C=11`）由重建報錯，整批拒絕，不寫出任何檔案。
3. **依賴鏈**：`Command` → `applyCommand` → `Regenerator` → `elementFacts`／拓樸 → 名稱與指紋 → `query_elements` 的 `ref` → `setEdges`／圓角。測試以查到的邊做圓角，體積吻合。
4. **零 Mock**：
   - 真實 OCCT 與 PlaneGCS。
   - 端到端測試啟動建好的 `dist/server.mjs`，用官方 MCP SDK Client 經 stdio 連線。
   - 截圖檢查真實像素：孔中心是白色，板面是塗彩色，長寬比 1.5。

## 驗證

- 平板帶孔：60·40·10 − π·5²·10，誤差 1e-3 以內。
- 四角圓角：再減 4·(r² − πr²/4)·h。
- 圓盤：π·R²·T − π·h²·T − π(R − c/3)·c²（Pappus），R=30 時相差 4e-5。`--set R=40, C=2` 結果同樣吻合。
- 3MF：每條有向邊恰好出現一次，反向邊也恰好一次，代表網格封閉且方向一致。散度定理算出的體積與解析值相差 2e-3 以內。
- STL 體積不小於解析值，相差 1e-3 以內。
- Heap：先斷言基準 > 0。以 kernel 自己的配置器（`___libc_malloc`）真實撐大 heap，確認觸發重新載入且零件不變。外部直接 `memory.grow()` 會讓 Emscripten 的記憶體視圖失效，所以不採用。
- `liveShapes`：100 輪「保留、拒絕、復原」後與開始時相同。
- Fuzz：200 組、10 種變體，每種都出現且結果正確。heap 成長量印出，不斷言為 0（AGENTS §3.5）。
