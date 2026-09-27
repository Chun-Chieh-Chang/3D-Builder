# ADR 0002：Phase 0 的幾何核心、求解器與實測結果

- 狀態：已採用（Phase 0，2026-09-27）。**B-Rep 核心的選擇已由 ADR 0003 更新**：改用 `libcascade` 3.0.2。本文的缺口表與實測數據保留為 Phase 0 的歷史紀錄。
- 依據：開發藍圖 §2.1、§3 Phase 0 驗收 ④

## 決策

| 項目 | 藍圖原案 | Phase 0 採用 | 理由 |
|---|---|---|---|
| B-Rep 核心 | 自建 OCCT 7.9 WASM + C++ 門面 | `replicad-opencascadejs` 1.1.0（**OCCT 8.0**，LGPL-2.1）+ TypeScript 門面（`@3db/kernel`） | 2026-09 仍在維護；已含建模、XCAF/STEP、網格擷取與形狀雜湊；本機沒有 Emscripten，自建需要 Docker 與長時間建置 |
| 草圖求解 | PlaneGCS 編成 WASM | `@salusoft89/planegcs` 1.2.0（FreeCAD PlaneGCS，LGPL，2026-07 仍在維護） | 解除風險表第 4 項；提供 DOF 與衝突/冗餘診斷 |
| 單一 repo | pnpm workspaces | npm workspaces | 本機未安裝 pnpm，Node 26 已移除 corepack；兩者功能等價 |
| 持久命名 | 機制在 C++、政策在 TS | 機制與政策都在 TS（機制：`Kernel` 回報面來源；政策：`@3db/naming`） | 綁定層已提供 `Generated`、`Modified`、`IsDeleted`，不需要 C++ 門面 |

## 這個 WASM 建置的缺口與對策

| 缺口 | 影響 | 對策 |
|---|---|---|
| `NCollection_IndexedMap` 無法建構（基底型別未綁定） | 形狀索引 | `ShapeIndex`：`ReplicadShapeHasher` 雜湊 + `IsSame`，語意同 `TopTools_ShapeMapHasher` |
| `BRepAdaptor_Curve.Line()` 回傳型別未綁定 | 直線方向 | 由曲線兩端點計算 |
| `STEPCAFControl_Writer.Transfer` 的多檔前綴參數無法傳 null（空字串會拆出外部檔） | STEP 名稱 | 改用 `Perform(doc, path, progress)` |
| `Quantity_TypeOfColor` 未綁定 | STEP 顏色 | 隨 C14.2 外觀（Phase 3a）處理；候選：`Quantity_ColorRGBA` 或自建 |
| 缺 `ShapeFix_Shape`、`BRepAlgoAPI_Defeaturing`、`STEPCAFControl_Reader` | F2.2 修復、C10.2 刪除面、F2.8 組合件輸入 | **Phase 1 開始前做技術驗證**：(a) 向 replicad 提需求或貢獻綁定；(b) 以 Docker 自建 OCCT WASM |

## 其他設計決策

- **草圖點座標**：文件中的座標是求解初值，也是「定義不足自由度」的擺放意圖。重新計算只讀不寫。Phase 1 的草圖編輯指令，會把求解後的位置存回文件。
- **命名文法**（`@3db/naming/src/names.ts`）：
  - 面：`<特徵>:side:<草圖>.<圖元>`、`<特徵>:cap:start|end`、`<特徵>:fillet:<邊名>`。
  - 邊：`{面名|面名}`；頂點：`<面名|面名|…>`。
  - 重名時依幾何順序加上 `#k`。
  - 解析順序：完整名稱 → 去掉 `#k` 的唯一名稱 → 幾何指紋消歧；都找不到就回報遺失參考並列出候選，不猜測。
- **編輯會話**：編輯圓角時顯示「圓角之前」的模型，以便點選輸入邊線，這與 SW 的行為相同。這是介面狀態（`until`），不寫入文件。

## 實測（Windows 11、Node 26；瀏覽器為 Claude 內建瀏覽器）

| 項目 | Node | 瀏覽器（Worker） | 預算 |
|---|---|---|---|
| OCCT WASM 大小 | 23.0 MB（gzip 7.3 MB） | 同左 | — |
| OCCT 初始化 | 119 ms | 145 ms（不含下載） | — |
| PlaneGCS 初始化 | 15 ms | — | — |
| 示範件重新計算（中位數） | 7.9 ms | 首次 81.6 ms、之後約 27 ms | < 500 ms ✅ |
| 草圖求解 | 0.28 ms | — | < 16 ms ✅ |
| 網格化 | 12.9 ms | — | — |
| STEP 輸出（XCAF） | 約 50 ms | 81 ms | — |

## 後果

- Phase 0 的驗收 ①③ 已由自動化測試證明（`tests/phase0/`）。驗收 ② 需要你在 SolidWorks 核對，步驟見 `docs/phase0-verification.md`。
- 在 Phase 1 的零件布林、STEP 修復、組合件輸入之前，先解決上表缺口，並決定繼續使用 replicad 建置還是自建。
