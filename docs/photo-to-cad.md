# 從 Agent 發起照片建模

先在 3D-Builder 專案根目錄執行 `npm run mcp:build`。在本機 Agent 附上照片和已知尺寸，並啟用本機 `3d-builder` MCP。建立獨立零件時由 Agent 回傳預覽和檔案，之後可開啟 `.3dbx` 繼續編輯。

## 給 Agent 的建模流程

1. 查看使用者附上的照片或指定的本機圖片。先列出可辨認的外形、實測尺寸與缺少的尺寸。以 mm 工作，遇到看不到的背面、孔深或無法定比例的視角，請使用者補資料。估計值須明列並經使用者同意。
2. 呼叫 `live_status` 與 `part_summary` 確認目標。預設建立獨立零件。若正在控制 CAD 視窗，請使用者先中斷連線。若獨立工作階段已有零件，先確認是否可切換，因為 `part_new` 會關閉目前零件而不儲存。
3. 用 `command_reference` 確認命令格式。以原生草圖、尺寸與特徵建模。特徵樹要像人建的一樣好讀（[ADR 0254](adr/0254-feature-tree-names-estimates.md)）：
   - 主要尺寸寫成變數（`addVariable`），特徵的尺寸引用變數。
   - 估計值用標記，不寫進名稱：變數或特徵設 `estimate: true`（`setVariable`、`setFeatureNote`），名稱不加「估」「est」「（估）」。使用者給了實測值後改值並取消標記。
   - 相同的特徵只建一個，再用陣列（環狀陣列：`mode: 'circular'`）或鏡射複製，例如兩條排屑溝、兩組開口槽。
   - 特徵名稱不可重複；重複時命令會被拒絕並建議可用的名稱。
   - 建完用 `arrange` 的 `folders` 依區域分資料夾，例如「柄部」「排屑溝」「刀頭」。
   將指令批次交給 `apply_commands`，設定 `dry_run: true`、`preview: {}`。核對 `broken`、`after.box` 與已知尺寸。若失敗，依錯誤修正，再試跑。若要選取試跑才會生成的邊面，先確認分階段建模，每階段各自預覽與確認。
4. 回傳實際產生的 PNG、量測、估計值和未知特徵。無法渲染時回報原因。收到確認後，核對目標零件，用相同指令正式套用。僅在 `committed` 為真時，用 `part_save` 存到 MCP 工作區內的相對路徑，預設使用新檔名。依要求用 `cad_export_manufacturing` 匯出並回報實際路徑。

可將下列文字與照片一起送出：

> 請讀取專案的 docs/photo-to-cad.md，使用 3d-builder MCP 依照流程建模。底板寬 60 mm、板厚 4 mm。看不清楚的孔徑、孔距與背面請先問我。先給我預覽和尺寸，確認後才儲存 .3dbx。

## 從組件照片拆件與還原組立

準備組裝狀態的照片、不同方向的視角和一個已知實測尺寸。能安全拆開時，補交拆開的零件與接合處近照。先用視覺模型讀圖，將證據整理成零件清單，再用 [Anatomy](https://github.com/wheresryan22/anatomy) 的等角插圖呈現拆件關係。Anatomy 會依提供的規格繪製示意，精確尺寸、特徵與配合由 3D-Builder 建立及求解。

1. **建立拆件清單。** 對每個零件類型記錄 `partId`、名稱、數量、照片與對應區域、已知尺寸、未知項目。用獨立的 `instanceId` 標識每個實例，例如同一支銷的 `pin-left` 和 `pin-right`。可見的接縫列為拆件依據。遮蔽的分界、孔深、螺紋、墊片及扣件另列待核對，避免用零件外觀推定數量或規格。
2. **出拆解示意。** 若客戶端有 Anatomy skill，以拆件清單作為插圖輸入，標出零件 ID、實例 ID、方向及待核對區域。沒有安裝 Anatomy 時，仍可先交付有照片編號的拆件清單，等使用者核對後再建模。示意圖的間距僅供解說。若沒有真實拆裝順序的證據，標為「拆解示意」。
3. **逐件特徵化。** 用上節的照片建模流程，由草圖、尺寸與原生特徵建立每種已確認的零件。依據清單檢查幾何預覽和實測尺寸，將同型零件共用一份 `.3dbx`，把不同尺寸、左右手或不同孔位的零件各自建檔。估計值沿用 `estimate: true`。缺少定位或配合的關鍵尺寸時，請使用者補量或確認可採用的估值。
4. **還原組立。** 預設使用獨立的 MCP 組合件工作階段。以已知基準固定第一件，以實例 ID 指定每個配合端點。用 `assembly_query_elements` 取得實際面參照，將確認的平面貼合、平面距離或圓柱同心交給 `assembly_apply_commands` 試跑，附上 `dry_run: true`、`interference: true` 及 `preview: {"view":"isometric"}`。檢查相對位姿、配合、剩餘自由度與干涉。保留設計上預期的自由度，並回報無法判定的干涉。若某個孔位或配合方式仍有多個候選，先列出差異讓使用者確認。MCP 首版的工具範圍及路徑規則見[組裝零件指引](../apps/mcp/README.md#透過-agent-組裝零件)。
5. **儲存並重開核對。** 按使用者確認的方案套用批次，將原生 `.3dba` 與來源 `.3dbx` 保存在同一交付資料夾樹。用 `assembly_open` 重開並重新求解，核對來源檔、實例數量、配合與姿態。可依需求附組立 PNG、BOM 和 STEP。需要以真實 CAD 位姿產生互動拆解頁時，在 3D-Builder 設定爆炸步驟，再用「檔案 → 輸出互動拆解示意」。

例如，照片中看到一塊底板和兩支同型定位銷時，底板有一個 `partId`，定位銷有一個 `partId` 和兩個 `instanceId`。每支銷的配合都要指向底板上各自查到的孔壁。若照片只看見銷頭，仍需確認銷徑、有效長度、孔徑及肩部是否貼合板面。組立後沿用同一份實例對照表核對 BOM 和預覽。

> 請依 3D-Builder 的照片拆件與還原組立流程處理這組照片。先列零件、數量、照片依據與待量尺寸，並用 Anatomy 呈現拆解示意。經我確認零件與配合後，試建可編輯的 `.3dbx` 與 `.3dba`，回傳預覽、自由度、干涉及重開核對結果。

## 設定本機 MCP

在支援本機 stdio 的客戶端，加入名為 `3d-builder` 的伺服器。指令是 `node`，第一個參數是已建置的 `apps/mcp/dist/server.mjs` 絕對路徑。將 `THREEDB_WORKSPACE` 設為 `out/agent` 的絕對路徑。以下 PowerShell 指令以目前專案路徑註冊 Codex：

```powershell
$project = (Get-Location).Path
codex mcp add 3d-builder --env "THREEDB_WORKSPACE=$project/out/agent" -- node "$project/apps/mcp/dist/server.mjs"
```

- **Claude Code**：使用專案的 `.mcp.json`，附照後執行 `/photo-to-cad`。
- **Codex**：註冊後重新開啟本機工作階段，附照並使用上方提示詞。若跳出 MCP 工具核准，先核對再允許該次呼叫。[MCP 設定](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
- **OpenCode**：使用 `opencode.json` 的本機伺服器設定。1.x 將伺服器放在 `mcp` 下，V2 放在 `mcp.servers` 下。伺服器設 `type: "local"`、`command: ["node", "<server.mjs 絕對路徑>"]`，環境變數寫在 `environment`。[MCP 設定](https://opencode.ai/docs/mcp-servers)
- **TRAE、Qoder、Antigravity**：在各自的本機 MCP 設定加入相同指令、參數與環境變數。[TRAE](https://forum.trae.cn/t/topic/65) · [Qoder](https://docs.qoder.com/cli/mcp-servers) · [Antigravity](https://antigravity.google/docs/mcp)
- **WorkBuddy、Kiro、Cline、Agnes Code、MiniMax Code**：依各客戶端的本機 MCP 介面加入該伺服器。[WorkBuddy](https://open.workbuddy.cn/docs/connector) · [Kiro](https://kiro.dev/docs/mcp/configuration/) · [Cline](https://docs.cline.bot/mcp/mcp-overview) · [Agnes Code](https://agnescode.agnes-ai.cn/docs/getting-started/using-extensions/) · [MiniMax Code](https://github.com/MiniMax-AI/minimax-code/blob/main/docs/examples.md)

第一次使用可先請 Agent 呼叫 `part_summary`。接著附上實照，確認模型能讀圖、工具能回傳預覽。各客戶端的這兩項能力需要分別驗證。

如果客戶端使用 `mcpServers` 格式，可合併以下範例。請把路徑改為自己的安裝位置。

```json
{
  "mcpServers": {
    "3d-builder": {
      "command": "node",
      "args": ["D:/Self-developed_Apps/G3/3D-Builder/apps/mcp/dist/server.mjs"],
      "env": {
        "THREEDB_WORKSPACE": "D:/Self-developed_Apps/G3/3D-Builder/out/agent"
      }
    }
  }
}
```

以下是 OpenCode 1.x 的設定範例。將路徑改成安裝位置，合併到既有 `opencode.json` 的 `mcp` 設定。若為 V2，將 `3d-builder` 放入 `mcp.servers`。

```json
{
  "mcp": {
    "3d-builder": {
      "type": "local",
      "command": ["node", "D:/Self-developed_Apps/G3/3D-Builder/apps/mcp/dist/server.mjs"],
      "environment": {
        "THREEDB_WORKSPACE": "D:/Self-developed_Apps/G3/3D-Builder/out/agent"
      }
    }
  }
}
```

本機 OpenCode 1.17.4 已用隔離設定驗證連線。若目前設定執行 `opencode mcp list` 出現 `no such table: data_migration`，請先處理 OpenCode 的資料庫問題，再執行該指令確認伺服器狀態。
