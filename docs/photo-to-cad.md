# 從 Agent 發起照片建模

先在 3D-Builder 專案根目錄執行 `npm run mcp:build`。在本機 Agent 附上照片和已知尺寸，並啟用本機 `3d-builder` MCP。建立獨立零件時由 Agent 回傳預覽和檔案，之後可開啟 `.3dbx` 繼續編輯。

## 給 Agent 的建模流程

1. 查看使用者附上的照片或指定的本機圖片。先列出可辨認的外形、實測尺寸與缺少的尺寸。以 mm 工作，遇到看不到的背面、孔深或無法定比例的視角，請使用者補資料。估計值須明列並經使用者同意。
2. 呼叫 `live_status` 與 `part_summary` 確認目標。預設建立獨立零件。若正在控制 CAD 視窗，請使用者先中斷連線。若獨立工作階段已有零件，先確認是否可切換，因為 `part_new` 會關閉目前零件而不儲存。
3. 用 `command_reference` 確認命令格式。以原生草圖、尺寸與特徵建模。將指令批次交給 `apply_commands`，設定 `dry_run: true`、`preview: {}`。核對 `broken`、`after.box` 與已知尺寸。若失敗，依錯誤修正，再試跑。若要選取試跑才會生成的邊面，先確認分階段建模，每階段各自預覽與確認。
4. 回傳實際產生的 PNG、量測、估計值和未知特徵。無法渲染時回報原因。收到確認後，核對目標零件，用相同指令正式套用。僅在 `committed` 為真時，用 `part_save` 存到 MCP 工作區內的相對路徑，預設使用新檔名。依要求用 `cad_export_manufacturing` 匯出並回報實際路徑。

可將下列文字與照片一起送出：

> 請讀取專案的 docs/photo-to-cad.md，使用 3d-builder MCP 依照流程建模。底板寬 60 mm、板厚 4 mm。看不清楚的孔徑、孔距與背面請先問我。先給我預覽和尺寸，確認後才儲存 .3dbx。

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
