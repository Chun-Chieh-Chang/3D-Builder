# 3D-Builder

類 SolidWorks 的參數式 3D CAD（Web 先行）。設計意圖是唯一真相（SSOT）：幾何、網格、STEP 都由文件重新計算而來；參考一律用持久名稱，不用拓撲索引。

目前進度：**Phase 0 完成並已驗收；Phase 1A 草圖編輯器、1B 特徵與布林、1C 基準面、1D 設計樹操作、1E 零件檔完成**。Phase 0 的流程是：

1. 草圖（PlaneGCS 求解）
2. 伸長
3. 圓角（以持久名稱參考邊線）
4. 改尺寸後重新計算
5. STEP 輸出

開發藍圖見 `C:\Users\3kids\.claude\plans\solidworks-3d-solidworks-solidworks-3d-serene-crayon.md`。目前狀態、待辦與下一步見 [handoff.md](handoff.md)。

## 快速開始

```bash
npm install
npm run dev        # 自動開啟 http://127.0.0.1:5391
npm run check      # 型別檢查 + 分層檢查 + 全部測試
```

## 結構

```
packages/model     SSOT：文件 schema、文件指令、復原/重做、序列化（零內部相依）
packages/sketch    草圖求解（PlaneGCS WASM：拖曳、逐圖元定義狀態）、封閉輪廓偵測；/interact 為拾取、吸附、推斷、智慧型尺寸
packages/naming    持久命名（TNP）與參考解析
packages/kernel    OCCT 8.0.1（libcascade WASM）門面：伸長、旋轉、布林（含合併共面）、圓角、導角、拓撲、網格、物質特性、STEP
packages/regen     確定性的重新計算引擎、父子關係推導
packages/io        檔案層：零件檔 .3dbx（自寫 ZIP）、STEP 輸出命名
packages/render    Three.js 圖面：SW 式視圖操作、頂點/邊線/面拾取、基準面顯示、三度空間參考、草圖疊加層
apps/web           React 介面：CommandManager、FeatureManager、PropertyManager、狀態列；src/sketcher 為草圖工具
tests/phase0       Phase 0 驗收與效能量測
tests/phase1       Phase 1 回歸：特徵與布林後的持久命名（TNP）、設計樹操作、基準面、零件檔
tests/fixtures     舊版程式寫出的文件樣本（證明舊檔可開啟）
docs/adr           架構決策紀錄
```

分層規則由 `scripts/check-deps.mjs` 定義並強制執行。模組與藍圖目錄 ID 的對應見 `docs/adr/0001-ssot-mece-rules.md`。

## 授權說明

本專案使用 LGPL 元件，包括 OCCT（經 `libcascade`，LGPL-2.1 + Open CASCADE 例外條款）與 PlaneGCS（經 `@salusoft89/planegcs`）。目前定位為個人/公司內部使用。日後若要對外散佈，需要遵守 LGPL 的可替換要求。
