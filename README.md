# 3D-Builder

類 SolidWorks 的參數式 3D CAD（Web 先行，另有 Windows 桌面版）。設計意圖是唯一真相（SSOT）：幾何、網格、STEP 都由文件重新計算而來；參考一律用持久名稱，不用拓撲索引。

目前進度：**Phase 0 到 7 的開發都完成**（零件、組合件、夾治具、檢具、工程圖、塑膠件、鈑金）。Phase 0、1、2 的閘門已通過；3a、3b、4a、4b、5、6、7 是「有條件通過」：只用手算的金樣與種子固定的隨機測試驗過，**還沒有用真實檔案對照**（使用者沒有 SolidWorks，改用 eDrawings 看輸出的 STEP 與手算的數字，見 `npm run make:kit`）。逐階段的狀態在 [handoff.md](handoff.md) §3，待使用者做的實機驗證在 [docs/manual-verification.html](docs/manual-verification.html)（90 項，用瀏覽器開）。

## 快速開始

```bash
npm install
npm run doctor     # 換電腦時先跑：診斷這台電腦（Node、git、node_modules 的連結、磁碟、埠、Rust），每個問題附修法
npm run dev        # 自動開啟 http://127.0.0.1:5391（用 Edge 或 Chrome）
npm run dev:auto   # 同上，但最後一個瀏覽器分頁關掉 30 秒後伺服器自己結束（DEV_AUTO_CLOSE_SECONDS 可改秒數）
npm run check      # 型別檢查 + 分層檢查 + i18n 檢查 + 全部測試
npm run build      # 網頁版正式建置
npm run build -w @3db/desktop   # 桌面版安裝檔（要 Rust 與 MSVC，見 apps/desktop/README.md）
```

專案要放在支援符號連結的磁碟（NTFS）：npm workspaces 靠符號連結，在 USB 隨身碟上 `node_modules/@3db` 會是空的（見 handoff.md §6「工作區連結」）。

## 文件

| 文件 | 內容 |
|---|---|
| [handoff.md](handoff.md) | 目前狀態、待辦、下一步、工作約定、已知陷阱（換電腦先讀 §0） |
| [docs/blueprint.md](docs/blueprint.md) | 範圍、架構、階段與驗收標準 |
| [docs/adr/](docs/adr) | 架構決策紀錄（至 0201；0196 已撤回），每個里程碑一份，含驗收表與限制；全部列在 handoff.md §2 |
| [選單與圖示預覽](docs/design/menu-redesign/preview.html) | 參照SolidCraft的選單規劃與205指令圖示總覽（獨立設計稿） |
| [DEV_LOG.md](DEV_LOG.md) | 每次交付的做法、紅隊四問、測試與 RCA（新的在最上面） |
| [AGENTS.md](AGENTS.md) | 從過去錯誤萃取的強制規則（紅隊四問、記憶體量測、測試門檻） |
| `docs/phase*-plan.md` | 各階段的里程碑與驗收標準；[docs/hardening-plan.md](docs/hardening-plan.md) 為鞏固（H-1 到 H-11） |
| [docs/manual-verification.html](docs/manual-verification.html) | 逐項實機驗證清單 |

## 結構

```
packages/model     SSOT：零件、組合件、工程圖的 schema、文件指令、復原/重做、序列化、檔案路徑與位姿（零內部相依）
packages/sketch    草圖求解（PlaneGCS WASM）、封閉輪廓偵測、折彎路徑；/interact 為拾取、吸附、推斷、智慧型尺寸
packages/naming    持久命名（TNP）與參考解析
packages/kernel    OCCT 8.0.1（libcascade WASM）門面：特徵、布林、圓角、拓撲、網格、曲面、投影與剖面、物質特性、STEP
packages/assembly  結合求解器（純 TS）：標準與進階結合、LM 求解、衝突與自由度
packages/regen     確定性的重新計算引擎（零件特徵、鈑金、塑膠分析、平板型式）、組合件求解接線、干涉與餘隙
packages/io        檔案層：零件 .3dbx、組合件 .3dba、工程圖 .3dbd（同一個自寫 ZIP 容器）、STEP 輸出命名
packages/drawing   工程圖場景：視圖、尺寸、孔表、零件表，輸出 SVG、DXF、PDF（含讀取器與檢查）
packages/library   標準件圖庫（螺絲、定位銷、墊圈）
packages/render    Three.js 圖面：視圖操作、拾取、基準顯示、草圖疊加層、零組件、分析著色
packages/i18n      介面文字目錄（zh-TW 與 en）
apps/web           React 介面：CommandManager、FeatureManager、PropertyManager、狀態列；Worker 跑幾何核心
apps/desktop       Tauri 2 桌面版：載入 apps/web 的建置結果（NSIS 安裝檔）
tests/phase0–8     各階段的驗收、回歸與隨機測試（phase8 是鞏固的種子固定隨機測試）
tests/support      測試共用的夾具與輔助
tests/fixtures     舊版程式寫出的文件樣本（證明舊檔可開啟）、STEP 金樣
tests/golden       只用 UI 做出的三個示範零件
tests/e2e          在瀏覽器中只用 UI 操作的驗收腳本（`npm run verify:ui` 在無頭 Chrome 跑）
tests/kit          `make:kit`／`make:drawing`：產生給使用者實機驗證的檔案組
scripts            分層檢查、反模式檢查、i18n 檢查、效能檢查、環境診斷（doctor）、瀏覽器驗收（verify-ui）、文字化檔案工具
spikes             技術驗證腳本（ADR 的證據，不屬於產品程式碼）
```

分層規則由 `scripts/check-deps.mjs` 定義並強制執行。模組與藍圖目錄 ID 的對應見 `docs/adr/0001-ssot-mece-rules.md`。

## 授權說明

本專案使用 LGPL 元件，包括 OCCT（經 `libcascade`，LGPL-2.1 + Open CASCADE 例外條款）與 PlaneGCS（經 `@salusoft89/planegcs`）。目前定位為個人/公司內部使用。日後若要對外散佈，需要遵守 LGPL 的可替換要求。
