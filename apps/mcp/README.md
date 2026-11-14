# @3db/mcp — 讓 AI 代理操作 3D-Builder（ADR 0237）

## 標準 CAD 工具（ADR 0252）

`cad_execute_feature` 接受 `{ feature, repair? }`。尺寸為有限正數 mm（上限 100000），不接受未知欄位，也不自動四捨五入。操作如下：

| operation | 必要參數（另需唯一 `id`） |
|---|---|
| create_primitive | `shape: "box"`, `width`, `depth`, `height`；或 `shape: "cylinder"`, `radius`, `height` |
| extrude | `sketch`, `depth`；選填 `mode: "boss" / "cut"`, `reverse` |
| fillet | `edges`, `radius` |
| chamfer | `edges`, `distance`（等距） |
| hole | `sketch`（獨立孔位點）, `diameter`；選填 `depth`, `reverse` |
| boolean | `mode: "add" / "subtract" / "common"`, `main`, `tools`（本體參照） |
| pattern | `seeds`, `direction`（參照）, `count`（2–200 整數）, `spacing` |

基本體在 top 平面居中，向 +y 伸長，各自成為本體。`edges` 可直接使用 `query_elements` 回傳的 `ref`。需要額外草圖、不同陣列或表達式時，使用既有 `apply_commands`／`command_reference`。

```json
{"feature":{"operation":"create_primitive","shape":"box","id":"base","width":40,"depth":30,"height":10}}
```

每次特徵回覆包含文字 JSON 與實體渲染 PNG。`current` 是目前保留模型；`attempts` 記錄每次嘗試的值、錯誤與失敗特徵。無實體可渲染時回傳 `imageError`，不偽造圖片。

修復必須明確傳入，例如 `repair: {"maxAttempts":6,"factor":0.5,"minValue":0.1}`。僅對幾何重建失敗的圓角／倒角縮小數值，最多 8 次，成功才保留一筆 undo；耗盡後保留原件。外部 LLM 可讀圖片與診斷後改用其他構建指令。此處沒有內建視覺 LLM，也不保證所有設計皆可修復。

- `cad_get_viewport_screenshot`: `camera` 為 `isometric/top/front/right/custom`；custom 必須提供三維 `dir` 與 `up`。選填 `size`（64–2048）。回傳診斷及 Base64 PNG 的 MCP image block。
- `cad_inspect_geometry`: 選填 `body` ID。每個本體回傳體積、面積、質心、包絡盒、凹圓柱孔壁軸線及圓形孔口中心；包含參考本體。幾何孔位不代表已判定安裝用途。
- `cad_export_manufacturing`: `path`, `format: "step"/"stl"/"3mf"`，選填有限 `meshTolerance`（mm，至少 0.0001；過密網格的資源防護下限，越界明確拒絕）；STEP 不使用網格容差。

## 透過 Agent 組裝零件

先把來源 `.3dbx` 放進 MCP 工作區。Agent 可用獨立的組合件工作階段，不必開啟 CAD 視窗。

1. 呼叫 `assembly_new`，再用 `assembly_query_elements` 依來源路徑取得參照。插入後可用 `component` 查詢特定實例。
2. 依工具公布的 JSON Schema 準備 `insertComponent`、`setFixed`、`setPlacements` 或 `insertMate`。配合支援平面重合、平面距離及圓柱同心。將查到的 `ref` 原樣傳入配合端點，並指定元件 ID。
3. 用 `assembly_apply_commands` 傳入 `dry_run: true`、`interference: true`、`preview: {"view":"isometric"}`。核對 PNG、姿態、自由度與干涉，再以相同命令正式套用。
4. 用 `assembly_inspect` 查詢已套用的結果，最後用 `assembly_save` 儲存新 `.3dba`。目的資料夾須已存在，來源 `.3dbx` 仍由組合件相對路徑參照。
5. 用 `assembly_open` 重新開啟同一工作區內的 `.3dba`，核對來源、配合與自由度。它會先重建零件及求解，通過後才切換工作階段。先儲存目前未儲存的組合件。

> 請用 3D-Builder MCP 把定位板固定，將定位銷與左側孔設為同心，讓銷肩貼合板面。先查詢真實參照，再試建給我預覽、自由度及干涉結果。我確認後才儲存成 jig.3dba。

第一版最多 32 個元件、64 個配合，來源為直接引用的實體零件。若干涉結果是 `incomplete`，檢查其中的 `unknown` 或 `failed`。配合成立後仍可能有干涉。各 Agent 的連線說明見[共用建模指引](../../docs/photo-to-cad.md)。

## 新 CLI

先 `npm install` 及 `npm run mcp:build`，再使用：

```sh
npx 3d-builder headless --input script.json --inspect --output metrics.json
npx 3d-builder render --input script.json --camera isometric --output preview.png
npx 3d-builder export --input script.json --format step --output model.step
npx 3d-builder export --input script.json --format stl --meshTolerance 0.01 --output model.stl
```

`script.json` 是 `{ "commands": [...], "variables": {...} }`，與舊 CLI 共用原生命令。新 CLI 的輸出由 `--output` 決定，腳本不得另含 `outputs`。成功結束碼 0，失敗非 0。現有帶 `outputs` 的腳本仍使用下方舊 CLI。

驗證：`npm test -- apps/mcp/test --maxWorkers 1`；CI 在三個作業系統執行同套測試。

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

### 從照片建模

使用其他 Agent 時，請參考[共用照片建模流程與 MCP 設定](../../docs/photo-to-cad.md)。

在 Claude Code 桌面版開啟本機的 3D-Builder 專案，附上物件的正面、側面或斜角照，接著在訊息開頭輸入 `/photo-to-cad`，再填上零件名稱與已知尺寸，例如：

```text
/photo-to-cad L 型支架，底板寬 60 mm、板厚 4 mm
```

Claude 會依照片與實測尺寸提出特徵，遇到無法判定的尺寸會請你確認。它會試跑並回傳模型預覽與量測。確認後才套用並儲存可編輯的 `.3dbx`，也可依要求匯出 STEP、STL 或 3MF。預設輸出在 `out/agent/`，可稍後再用 3D-Builder 開啟。只做獨立零件時，Claude Code 視窗就足夠。

先從板件、法蘭或支架開始。單張照片適合建立近似初稿，遮蔽的孔深、背面與製造公差需要另外提供。[Claude Code 指令定義](../../.claude/skills/photo-to-cad/SKILL.md)

### 手動呼叫 MCP 工具
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
