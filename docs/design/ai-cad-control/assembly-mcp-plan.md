# AI 組合件 MCP 實施計畫

**目標**是讓使用者從已設定 3D-Builder MCP 的 Agent 發起組裝，以現有零件檔建立可編輯組合件，在確認預覽、配合與干涉後儲存 `.3dba`。

**架構**沿用 TypeScript 的 `AssemblyDoc`、`applyAssemblyCommand`、`solveAssembly`、`findInterference` 和 `writeAssemblyFile`。MCP 加入獨立的組合件工作階段，調用現有核心並管理來源文件、候選變更與檔案輸出。第一階段透過 stdio 操作獨立組合件，之後才擴充現有視窗同步與照片入口。

## 1. 使用與交付流程

1. 使用者把底板、支架、軸等 `.3dbx` 放入 MCP 工作區，在已接入的 Agent 指定來源檔、元件及已知配合。Codex 與 Claude Code 是預設入口。
2. Agent 查詢可選的平面與圓柱面，若有多個孔符合條件就把候選交給使用者選擇。以同心、重合或距離配合試建。
3. 3D-Builder 回傳 PNG、配合狀態、各元件剩餘自由度、干涉元件對與共享體積。必要時回報無法檢查的元件與原因。
4. 使用者確認後套用同一組變更，存成 `.3dba`。使用者以 3D-Builder 開啟組合件與來源零件，可接續修改。

### Agent 接入範圍

使用同一套 MCP 工具契約、驗收案例與提示詞。依客戶端的執行位置、傳輸方式與權限設定接入，測試記錄以實際客戶端和版本為單位。

| 驗收對象 | 接入起點 |
|---|---|
| Codex、Claude Code | 預設驗收入口，沿用現有本機 MCP 設定與工具核准。 |
| Agnes Code、Antigravity、Cline、Kiro、MiniMax Code、OpenCode、Qoder、TRAE、WorkBuddy AI | 先依[現有照片建模指引](../../photo-to-cad.md)確認各版本的接法，用同一組合件案例逐一驗收。 |
| ChatGPT Classic、DeepSeek Harness、KiroCrew | 開工時先辨識捷徑對應的產品、版本與執行環境，再查該環境的本機或遠端 MCP 能力。截圖只用於確定驗收對象。 |

每個客戶端記錄四項證據：

1. 能列出組合件工具及讀取參數格式。
2. 能查詢零件參照、試建及取得診斷，並能向使用者呈現預覽或提供可開啟的 PNG。
3. 確認後能套用並儲存 `.3dba`，用 3D-Builder 重開後核對來源零件、配合及姿態。
4. 到照片階段時，再分別驗證附圖、關鍵尺寸追問及照片到模型的完整流程。

若該版本只能使用遠端 MCP，記錄需要的傳輸方式、身分驗證與檔案存取，另行評估受控的遠端接入。測試結果標為已驗證、待驗證或受阻，並附原因與證據。

## 2. 第一階段工具契約

| MCP 工具 | 輸入與結果 |
|---|---|
| `assembly_new` | 建立空白組合件。已有未儲存變更時回傳拒絕原因，避免清掉工作。 |
| `assembly_open` | 重開工作區內首版子集的 `.3dba`，依檔案目錄解析來源並先求解，通過後才切換。 |
| `assembly_query_elements` | 接受已有的元件 ID 或工作區內的零件路徑。回傳候選面及基準的持久參照、幾何類型與局部座標。零件路徑查詢可用於尚未插入的元件。 |
| `assembly_apply_commands` | 接受 `commands`、`dry_run`，以及可選的 `preview`。首批命令限 `insertComponent`、`setFixed`、`setPlacements`、`insertMate`。配合限平面重合／距離及圓柱同心。回傳 `committed`、配合診斷、元件姿態、自由度與選用的 PNG。 |
| `assembly_inspect` | 回傳目前已套用的元件、配合狀態、剩餘自由度，並可要求干涉報告與 PNG。 |
| `assembly_save` | 接受工作區內的新 `.3dba` 路徑，回傳儲存路徑及來源檔清單。 |

命令 JSON Schema 與執行期驗證使用同一份定義。求解結果中的 Map 明確轉成 JSON 陣列或物件。配合端點保留元件 ID 與持久幾何參照，測試要證明同一零件的兩個實例可分別選取。姿態使用原生 `Pose`，距離用 mm，非法數值與不適用的配合類型須明確拒絕。

試跑、求解失敗與來源檔失效均保留先前的組合件。自由度未歸零可代表預期運動，例如定位銷保留自轉。干涉報告顯示真實重疊，也可供使用者確認刻意設計的過盈。求解成功與干涉狀態分別回報，存在未知或失敗的對時不得顯示「無干涉」。

## 3. 實施順序

### A. 來源零件與組合件交易

- [ ] 先在 `apps/mcp/test/assembly.test.ts` 新增實體測試。用測試套件既有的真實零件樣本，先查詢面參照，再批次插入兩個零件。驗證試跑後組合件仍為空白，正式套用後有兩個元件，插入缺檔或錯誤引用後原快照相同。
- [ ] 新增 `apps/mcp/src/assemblySession.ts`。依現有 `CadSession.inside()` 的路徑與連結限制，共用檔案系統防線。零件用 `readPartFile` 載入，連同原始 blob 重建。候選變更用 `applyAssemblyCommand` 依序產生，重建並求解通過後才替換快照。
- [ ] 在 `apps/mcp/src/assemblyTools.ts` 定義 Schema 與執行入口，從 `apps/mcp/src/server.ts` 接入原有序列化工具佇列。組合件和現有零件各自管理狀態及幾何生命週期。
- [ ] 來源檔先支援直接插入 `.3dbx`。嵌套 `.3dba`、路徑越界、缺檔及不能重建的來源，回傳具體原因。首次實施時依核心資源與真實樣本量測決定批次上限。

### B. 配合、量測及干涉

- [ ] 使用 `packages/regen/src/assembly.ts` 的真實拓撲與 `solveAssembly`，對照 `packages/model/src/assembly.ts` 命令及 `packages/assembly/src/solver.ts` 的配合結果。配合失敗、未解析或衝突均拒絕套用。選取歧義回傳候選及幾何量測。
- [ ] 以 10 mm 立方體建立三個干涉驗收姿態。沿 X 位移 11 mm 為分離，10 mm 為接觸，8 mm 為重疊，預期共享體積為 200 mm³。用 `packages/regen/src/interference.ts` 的 `findInterference` 驗證，沿用包圍盒預篩，將重疊形狀轉成純資料後在 `finally` 釋放。測試明確斷言體積、元件 ID 及缺件診斷。
- [ ] 用 `tests/support/goldenJig.ts` 的底板及定位銷建立同心與端面重合案例。以實件幾何核對軸線位置、貼合平面及保留一個旋轉自由度，並用相反配合驗證交易拒絕。需要新增參數化核心特徵時，加入 100–200 組 fuzz，取實際 Emscripten heap 並先斷言基準大於零。

### C. 預覽、儲存及 Agent 發起

- [ ] 重用 `apps/mcp/src/render.ts` 的 PNG 渲染。在共用投影入口傳入求解後的零件與姿態，透過 `projectDrawingView` 渲染候選或當前組合件。測試用偏心配置驗證位置與方向，並核對結果含可解碼的 PNG。
- [ ] 使用 `packages/io/src/assemblyFile.ts` 的 `writeAssemblyFile`。來源檔參照按組合件所在目錄重算相對路徑，符合現有原生路徑規則。以獨占建立方式避免覆蓋已有檔案。測試寫入子目錄後，用原生讀檔器重開並解析來源，重求解後核對元件 ID、配合及姿態。
- [ ] 擴充 `apps/mcp/test/e2e.test.ts`，用正式建置產物與 SDK stdio 驗證「查參照 → 試建 → 量測／預覽 → 套用 → 儲存」。擴充 `apps/mcp/README.md`，加入共用提示詞、幾何參照範例及各 Agent 的實測相容表。預設客戶端通過後，用相同案例驗證截圖所列工具。

### D. 接入現有視窗及照片

- [ ] 第一階段完整工作流通過後，再接 GUI 即時連線。沿用現有版本與編輯衝突處理，將一次確認的批次做成一筆 undo。增加畫面驗收並依專案規則執行全量 `verify:ui`。
- [ ] 在已驗證的組合件能力上擴充 Agent 指引。先從已知零件清單與使用者確認的配合開始，再讓 Agent 依多張照片提出拆件候選。驗收一組有實測尺寸的底板、支架、軸，要求先確認遮蔽特徵、接觸方式與預期自由度，最後重開及量測組合件。
- [ ] 後續依需求評估 BOM、組合件 STEP、圖面與交付檔雜湊。第一階段的交付證據採原生重開、重求解與實際量測。
  - 2026-11-14 排序（Claude Code，使用者同意依建議順序）：① 交付輸出 BOM／組合件 STEP（重用 GUI 的 `buildBom`／`bomCsv` 與 `stepStructure`／`exportAssemblyStep`，風險最低，完成後 Agent 可從建組合件一路做到交付）→ ② GUI 即時連線 → ③ 多張照片建組合件（需使用者提供實物照片與實測尺寸）→ ④ 各客戶端驗收（需使用者在各客戶端核准工具）。圖面牽涉工程圖模組，① 完成後另行評估。
  - ① 工具契約 `assembly_export { path, format: 'step' | 'bom_csv' }`：輸出工作階段內目前的組合件（不必先存檔）。拒絕：沒有元件、任一配合未解；副檔名與格式不符（`.step`／`.stp`、`.csv`）；路徑在工作區外或目的資料夾不存在；檔案已存在（與 `assembly_save` 相同的獨占建立，不覆寫）。STEP：每個來源零件寫一次、每個元件依求解後的位姿放置、保留面顏色，產品名稱取自檔名。BOM：與 GUI 相同的平面零件表（項次、名稱、數量、廠商、料號、檔案），標題用工作階段語言；檔案欄是工作區內的來源路徑。
  - ① 已實作（2026-11-14）：`AssemblySession.export`，與 `evaluate` 共用載入、參照檢查與求解（`solve`）。驗收見 `apps/mcp/test/assembly.test.ts`「exports the solved assembly…」：STEP 以 `Kernel.readAssemblyStep` 讀回（非寫入端），各零件體積對照測試內獨立重建的來源（比值 1 ± 1e-6）、面數相同；四個元件的位置對照求解結果，旋轉矩陣對照位姿四元數（含一個繞 z 轉 90° 的元件，轉置後的真值會失敗，確認行列方向）；上色零件的六面都是 `#ff0000`。BOM 以手寫的期望列比對（同檔兩個實例數量為 2）。七種突變皆轉紅。e2e 經正式建置的 stdio 伺服器呼叫一次兩種格式。**未涵蓋**：配合未解的拒絕無法經工具觸發（只有可解的批次才會套用），只在來源零件於套用後被改動時才會發生，屬防禦。

## 4. 驗收及交接

- [x] 2026-11-14 首輪基線：`npm test -- tests/phase2/golden-assembly.test.ts tests/phase3/interference.test.ts packages/io/test/assemblyFile.test.ts --maxWorkers 1`，3 檔、29 項通過。
- [ ] 實施後執行 `npm test -- apps/mcp/test packages/model/test/assembly.test.ts packages/io/test/assemblyFile.test.ts tests/phase2/golden-assembly.test.ts tests/phase3/interference.test.ts --maxWorkers 2`。通過上述測例後執行 typecheck、四個 lint、docs:sync 與 GitHub CI。CI 失敗依 AGENTS §3.6 查證並修復。
- [ ] 在 `DEV_LOG.md` 記錄紅隊四問及可查證結果，在 `handoff.md` 記錄工具範圍、實測案例及待辦。實施時查現有 ADR 與 schema 編號，依實際變更決定是否新增。

## 5. 2026-11-14 實施紀錄

- A 至 C 已在 `codex/assembly-mcp` 工作樹實作。首版採 32 元件與 64 配合的工作範圍，並保留獨立零件工作階段。
- 以真實零件驗證配合、試跑回滾、衝突拒絕與重開求解。以兩個立方體量到 200 mm³ 干涉，另測接觸和分離。
- Codex 已探索到五個工具，OpenCode 1.17.4 隔離設定已連線，Claude Code 工作樹設定等待互動核准。完整 stdio 案例由 MCP SDK 驗證，客戶端互動驗收及 D 階段待續。
- 15 檔、126 項相關回歸通過。型別、四個 lint、文件盤點與差異檢查均通過。
- Claude Code 2.1.325 已完成一次隔離 Agent 建模與交付，產物經 `assembly_open` 獨立重新求解，確認位置、配合、干涉量及 PNG。Codex 暫待互動核准，其餘客戶端待驗。
