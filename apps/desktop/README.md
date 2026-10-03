# 3D-Builder 桌面版（Tauri 2）

網頁版放進一個原生視窗：`apps/web` 的建置結果（`apps/web/dist`）由 Tauri 的 WebView2 載入，**不另寫原生程式**。OCCT 的 WASM（42.7 MB）隨安裝檔，離線可啟動。檔案存取走 WebView2 自己的 File System Access API（`showOpenFilePicker`、`showSaveFilePicker`、`showDirectoryPicker`，Windows 原生對話框），所以 `apps/web/src/files.ts` 沒有為桌面版改過。決定與驗證見 [ADR 0052](../../docs/adr/0052-desktop-shell.md)。

## 需要

- Rust（`winget install Rustlang.Rustup`，之後 `rustup default stable-x86_64-pc-windows-msvc`）。
- Visual Studio 2022 Build Tools 的「使用 C++ 的桌面開發」（`winget install Microsoft.VisualStudio.2022.BuildTools --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"`）。
- WebView2 Runtime（Windows 11 內建）。
- `npm install`（帶進 `@tauri-apps/cli`）。

## 指令

```bash
npm run dev -w @3db/desktop      # 開發：啟動 vite（5391）與原生視窗
npm run build -w @3db/desktop    # 安裝檔：apps/desktop/src-tauri/target/release/bundle/nsis/3D-Builder_<版本>_x64-setup.exe
```

第一次建置要編譯全部 Rust 套件（約 5 分鐘），之後約 2 分鐘。

## 設定上要知道的

- `tauri.conf.json` 的 `bundle.useLocalToolsDir: true`：Tauri 把 NSIS 工具放在 `src-tauri/target/.tauri`，而不是 `%LOCALAPPDATA%\tauri`。**在 Claude 桌面版的工作階段裡建置時，`%LOCALAPPDATA%` 被重新導向到它的套件資料夾，Tauri 要改資料夾名稱時會失敗（「系統無法將檔案移到不同的磁碟機」）；用本機工具資料夾就繞過去了**。一般的終端機兩種都可以。
- 安裝模式是 `currentUser`（不需要系統管理員），語言繁中與英文。
- `capabilities/default.json` 只開 `core:default`：視窗不向外殼要求任何額外權限。
- 解除安裝會刪掉程式、登錄項目與捷徑；**WebView2 的使用者資料**（自動儲存的還原副本、記住的專案資料夾）在 `%LOCALAPPDATA%\app.3dbuilder.desktop`，預設保留。

## 驗證

`tests/e2e/desktop-probe.mjs`：以 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` 啟動視窗後，用 Chrome DevTools Protocol 檢查視窗裡的網頁（安全環境、選擇器、OPFS、IndexedDB、核心是否載入），或用 `--run script.js:__name.method` 在視窗裡跑 `tests/e2e/` 的瀏覽器腳本（要用 `npm run dev -w @3db/desktop` 的開發版，它才提供 `/@fs/`）。

`app-icon.png` 是圖示的來源（1024 × 1024）；`npx tauri icon app-icon.png` 重新產生 `src-tauri/icons/`（行動版的 `android`、`ios` 資料夾不用，已在 `.gitignore`）。
