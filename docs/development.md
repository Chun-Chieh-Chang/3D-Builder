# 開發、驗證與跨平台操作

在儲存庫根目錄執行指令。開發使用Node 26與npm，鎖定套件以`package-lock.json`為準；不要把不同電腦的`node_modules`直接搬來用。工作區需要支援連結的檔案系統，例如Windows NTFS、Linux ext4、macOS APFS；exFAT／FAT搬移工作區常無法保留連結。

## 開始

```sh
npm ci
npm run doctor
npm run dev
```

Web服務預設`http://127.0.0.1:5391`，預覽5392；實值由[ Vite設定 ](../apps/web/vite.config.ts)控制。若目錄已有未提交修改先保留，乾淨時才`git pull --ff-only origin main`。`dev:auto`可在最後一頁關閉後自動結束；`DEV_AUTO_CLOSE_SECONDS`調整秒數。

Windows PowerShell／命令提示字元、Linux與macOS終端機都使用相同npm指令。不要依賴bash-only指令串或硬編磁碟代號；腳本使用`node:path`、`fileURLToPath`及結構化子程序參數。文字依[.gitattributes](../.gitattributes)固定LF，中文用UTF-8；不要用PowerShell 5.1的預設ANSI重寫檔案。WASM／STEP／金樣／圖示與授權原稿不得因行尾轉換改內容。

## 日常檢查

```sh
npm run typecheck
npm run lint:rules
npm run lint:deps
npm run lint:i18n
npm run lint:repo
npm test -- tests/phase5/drawing-hole-depth.test.ts
npm run build
```

使用者目前偏好：只跑新增／受影響案例，失敗只重試失敗項並保留報告。`npm run check`仍提供完整檢查，包含全部Vitest；不是每次小修都必跑，也不要因AGENTS的泛用全量建議忽略使用者限制。無本版全量報告時不得宣稱全部通過。`noUnusedLocals`是型別守門的一部分；不要為清警告刪掉初始化或驗證副作用。

```sh
npm run verify:ui -- --only "manual-grid-menu-datum-origin" --shots out/ui --json out/ui.json
```

需要Chrome／Edge，`CHROME_PATH`可指定實際絕對執行檔。`VERIFY_UI_ORIGIN`指定自有devserver；`VERIFY_UI_DEBUG_PORT`與`VERIFY_UI_SAMPLES_PORT`可隔離連接埠。PowerShell用`$env:CHROME_PATH = 'C:\實際路徑\chrome.exe'`，POSIX shell用`export CHROME_PATH=/實際路徑/chromium`。不要把雲端`/workspace/.cloud-setup/`當成版本庫提供的工具。UI驗收期間不得修改原始碼，避免HMR使結果作廢。呼叫發現規則共用[scripts/ui-jobs.mjs](../scripts/ui-jobs.mjs)，盤點數不是通過數。

## 文件與盤點

```sh
npm run docs:sync
npm run lint:repo
npm run audit:repo
```

`docs:sync`只重新產生[盤點](repository-inventory.md)，不改能力宣稱。`lint:repo`只讀驗證目前文件分類、本地連結（含大小寫）與盤點是否過時；不驗外部網址可用性。`audit:repo`另寫`out/repository-audit.json`，不把本機報告提交當跨平台真值。現況改[project-state.md](project-state.md)，交付／紅隊／RCA加[DEV_LOG](../DEV_LOG.md)，接手資訊保持在[handoff](../handoff.md)，歷史不要覆蓋改寫成今天的版本。

## 外部與桌面驗證

[自動驗收](automated-acceptance.md)說明STEP／FreeCAD／DXF／PDF探針。FreeCAD腳本須指定可執行檔與真實報告路徑；Python的外部套件需按實際環境安裝。FreeCAD使用OCCT，不能冒稱跨核心驗證。

Windows桌面版沿[桌面README](../apps/desktop/README.md)安裝Rust／MSVC／WebView2，再用`npm run build -w @3db/desktop`；目前Tauri打包設定為NSIS，不將Web在Linux／macOS可執行誤稱桌面安裝已驗收。

忽略的`out/`、`scratch/`、客戶檔案和使用者模型不屬於安全自動清除目標；刪追蹤項目前要核對靜態／動態載入、測試／法律／平台責任。只在測試中出現的讀取器、歷史技術驗證和多平台圖示通常仍有用途。

## 跨平台持續守門

[Repository integrity](../.github/workflows/repository-integrity.yml)在Linux／Windows／macOS以同一Node版本、lockfile與npm指令檢查型別、依賴／文字／文件規則、路徑與發現契約、右鍵選單、模型及原生幾何smoke、Web建置。雲端Linux本機結果不代表其他runner已執行通過，請查看對應提交的實際CI紀錄；最近結果與來源只在[產品現況](project-state.md)維護。桌面NSIS安裝與實機操作不在此矩陣內。
