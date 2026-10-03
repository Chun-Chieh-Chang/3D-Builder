# ADR 0052：桌面版——Tauri 2 包網頁版（Phase 3b-6，F8.1）

- 狀態：已實作並驗證，**但驗收第 3、7 項沒做、第 2 項有一半沒做**（見最後的表），2026-10-03
- 相關：[phase3-plan](../phase3-plan.md) §4 的 3b-6、[ADR 0046](0046-phase3b-technical-validation.md) §4（調查）。使用者 2026-10-03 確認：用 winget 安裝 Rust 與 VS Build Tools；先驗證 WebView2，不行才改原生；NSIS 的 `.exe`。

## 決定

1. **殼只是一個視窗。** `apps/desktop`（Tauri 2.12）載入 `apps/web/dist`；Rust 只有 `main.rs` 十行，沒有指令、沒有外掛。網頁版與桌面版是同一份程式，行為不會分岔。
2. **檔案存取不改。** 在 WebView2（Chromium 154）裡實測：`isSecureContext` 為真（來源 `http://tauri.localhost`）、`showOpenFilePicker`／`showSaveFilePicker`／`showDirectoryPicker` 都是函式、OPFS 與 IndexedDB 可用、核心 1.1 秒載入、頁面所有資源都來自 `tauri.localhost`。ADR 0046 備案（Tauri 的 dialog／fs 外掛、真實路徑）因此**不需要**，`files.ts` 沒動。若之後發現選擇器在某些情況（例如記住的資料夾要重新授權）行為不同，再接外掛。
3. **離線。** WASM 與所有資產都在安裝檔裡（NSIS 11.02 MiB，WASM 壓縮約 12 MB）；程式不連網。
4. **安裝檔：NSIS，`currentUser`**（不需要系統管理員）、繁中與英文、解除安裝由 NSIS 做。
5. **能力最小：** `capabilities/default.json` 只有 `core:default`；`csp` 設為 `null`（本機資產、無外部載入，核心的 Worker 與 WASM 需要 `wasm-unsafe-eval`，先不設限制，之後有需要再收緊）。
6. **在 Claude 桌面版的工作階段裡建置的一個坑：** 該環境把 `%LOCALAPPDATA%` 重新導向到它的套件資料夾，Tauri 下載並解開 NSIS 後要改資料夾名稱，會失敗：「系統無法將檔案移到不同的磁碟機（os error 17）」。環境變數（`TAURI_BUNDLER_TOOLS_PATH`、改 `LOCALAPPDATA`）沒用；**`bundle.useLocalToolsDir: true`** 讓 Tauri 把工具放在 `src-tauri/target/.tauri`，就繞過去了。另外那個環境的「終端機」面板的 shell 整合壞了（`claude-desktop.ps1` 找不到），所以沒用它。

## 環境（這台，2026-10-03）

Rust 1.99.0（rustup 1.29.1，msvc）、VS 2022 Build Tools（C++ 工作負載，winget）、`@tauri-apps/cli` 2.12.1。第一次建置約 5 分鐘（編譯全部 Rust 套件），之後約 2 分鐘。

## 驗證（證據）

- **建置：** `tauri build` 0 錯誤；Rust 編譯 0 警告、`cargo clippy --release` 0 警告；產出 `3D-Builder_0.1.0_x64-setup.exe`（11.02 MiB）。
- **視窗裡的網頁（`tests/e2e/desktop-probe.mjs`，安裝版與開發版都量過）：** 見決定 2；安裝版狀態列「核心載入 1110 ms」「重新計算 72.2 ms」「體積 991.416 mm³」。
- **在視窗裡跑的瀏覽器腳本：** `phase3-subassembly`（開啟）、`phase3-bom`、`phase3-physical`、`phase3-measure`（組合件）、`phase3-interference`、`phase3-check`（組合件）、`phase3-step-import`、`phase3-explode`、`phase3-component-pattern` 共 9 個**全部通過**（開發版，頁面和 Chrome 預覽同一份）。
- **安裝與解除安裝（靜默，`/S /D=D:\3db-install-test`）：** 安裝後只有 `desktop.exe` 與 `uninstall.exe`（12.9 MB）、登錄一筆解除安裝項目（3D-Builder 0.1.0）；安裝後的程式能啟動；解除安裝後資料夾不見、登錄項目不見、開始功能表與桌面沒有捷徑。**留下 `%LOCALAPPDATA%\app.3dbuilder.desktop`（WebView2 的使用者資料）**，是預設行為，沒有刪（刪檔要使用者許可）。

## 驗收標準與結果（7 項）

| # | 標準 | 結果 |
|---|---|---|
| 1 | `tauri build` 0 錯誤、0 編譯警告，產出安裝檔 | 通過 |
| 2 | 安裝後**斷網**啟動，核心載入，能建零件、重建、存檔 | **部分**：安裝版啟動、核心載入、重建都正常，頁面資源只有 `tauri.localhost` 一個來源（沒有對外請求）；**沒有真的拔網路**，存檔是用腳本的選擇器替身走 OPFS，沒走真的對話框 |
| 3 | 用**原生對話框**開啟與儲存 `.3dbx`、`.3dba`，存後重開內容相同 | **沒做**：原生對話框要人按；選擇器函式存在，且腳本替身下的存檔後重開（`phase3-component-pattern` 的 `saveReopen`）與寫出檔案（`phase3-step-import`）通過。要使用者做（見下） |
| 4 | 開專案資料夾後組合件讀得到資料夾內的零件（含次組合件） | 通過（在視窗裡，OPFS 專案資料夾，`phase3-subassembly` 等；**不是真的磁碟資料夾**） |
| 5 | 網頁版 `npm run check` 照樣全過 | 通過（933 項，見提交） |
| 6 | 解除安裝後程式資料夾與捷徑清掉 | 通過；使用者資料夾 `%LOCALAPPDATA%\app.3dbuilder.desktop` 預設保留 |
| 7 | 在**沒裝過開發工具的 Windows 使用者帳號**安裝並啟動 | **沒做**，要使用者做 |

## 要使用者做的（第 3、7 項）

1. 到另一個沒有開發工具的 Windows 帳號（或另一台電腦），執行 `apps/desktop/src-tauri/target/release/bundle/nsis/3D-Builder_0.1.0_x64-setup.exe`（安裝檔不在版本庫；在這台建置得到，或再 `npm run build -w @3db/desktop`）。
2. 斷網啟動；新零件、畫草圖、伸長、存成 `.3dbx`（會出現 Windows 的存檔對話框）；關掉再開，用「開啟」選回。
3. 「開啟專案資料夾」選一個真的資料夾，開一個 `.3dba`，看零件都讀到、存檔。
4. 解除安裝，確認程式資料夾與捷徑都清掉。

## 已知限制

- **沒有自動更新**（F8.1 的「更新」那一半沒做；需要簽章金鑰與更新伺服器，是另一個決定）。
- **安裝檔沒有簽章**：Windows SmartScreen 會警告「不明發行者」。
- 圖示是我用程式畫的暫用圖（藍底白字「3D」）。
- 只建了 Windows x64、只有 NSIS（沒有 MSI）。
- `csp` 是 `null`（見決定 5）。
- 解除安裝不清使用者資料（自動儲存的還原副本、記住的資料夾）；NSIS 解除安裝程式在互動模式有「刪除應用程式資料」的勾選，靜默模式預設不刪。
- 舊的 `phase2-assembly.js` 腳本（`__asm.all`）在桌面視窗和 Chrome 預覽**都失敗**（失敗的步驟不同），它假設 1280 × 720 的視窗大小；沒有用它當證據，也沒有修它。
