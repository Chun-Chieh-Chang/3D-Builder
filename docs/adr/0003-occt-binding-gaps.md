# ADR 0003：OCCT 綁定缺口的技術驗證與決策

- 狀態：**提議，已在 `spike/occt-gaps` 分支完成切換與驗證，待你確認後合併**
- 日期：2026-09-27
- 依據：ADR 0002 的缺口表；需求 R7（大量輸入 SW 的 STEP 並繼續修改）
- 證據：`spikes/occt-gaps/`
  - `inventory.mjs` → `inventory.md`：兩個建置的類別盤點
  - `workarounds.mjs`：在原建置上的 7 個繞道實驗
  - `libcascade.mjs`：新建置的 9 項驗證

## 結論

**把 `@3db/kernel` 從 `replicad-opencascadejs` 1.1.0 改成 `libcascade` 3.0.2**，也就是 taucad 發布的完整版 OCCT 8.0.1 WASM。

- 不自己建置 OCCT。
- 原本規劃的 Docker 自訂建置，降級為「有實測證據才做」的最佳化項目。

## 驗證過程與發現

### 1. 原建置（replicad）的缺口

藍圖需要的 46 個類別，replicad 版只有 27 個。其中阻擋 R7 的關鍵缺口：

- `STEPCAFControl_Reader`：組合件的名稱與階層
- `ShapeFix_Shape`：整體修復
- `BRepAlgoAPI_Defeaturing`：刪除面
- `BRepTools_History`：合併共面後的持久命名

7 個繞道實驗中有 6 個可行，但都有使用上限：

- 刪除面：只限平面上的貫穿孔。
- 移動面：只限側面與移動方向平行的情況。
- 命名對應：計算量是「面數 × 面數」。

組合件 STEP 輸入則沒有可靠的繞道（E7）。

### 2. 補綁定的兩條路

| 路線 | 做法 | 評估 |
|---|---|---|
| A. 完整預建版 `libcascade` | npm 安裝官方正式版 | ✅ 採用：零建置管線、有 provenance、版本號固定 |
| B. 自訂精簡建置 | `@libcascade/toolchain` + 固定 digest 的 `3.0.2-single-threaded` 映像，列出需要的類別與自己的 C++ 輔助檔 | 保留為最佳化：體積與初始化較好，但要維護建置管線 |

replicad 自己使用的 `canary-ebd263f1` 映像，官方只保留 7 天，不適合作為長期可重現建置的基礎。

### 3. libcascade 3.0.2 的驗證結果（`node spikes/occt-gaps/libcascade.mjs`，9/9 通過）

| # | 項目 | 結果 |
|---|---|---|
| L0 | 初始化 | WASM 42.7 MB（gzip 12.4 MB），Node 初始化約 700 ms |
| L1 | 與現有核心用法相容 | ✅ 伸長歷史、索引、圓角、例外、FS/wasmMemory、字串列舉 |
| G1 | 組合件 STEP 輸入 | ✅ 讀回「治具組合件 → 基板、定位銷 ×2」，名稱（中文）、階層、位置都正確 |
| G2 | `ShapeFix_Shape` | ✅ 方向錯誤的實體修成有效 |
| G3 | `BRepAlgoAPI_Defeaturing` | ✅ 同時移除圓角面與鑽孔（不限平面），並提供歷史 |
| G4 | `UnifySameDomain` 的 `BRepTools_History` | ✅ 10/10 面由歷史對應，不再需要幾何繞道 |
| G5 | IGES 輸出/輸入 | ✅（讀回為曲面，需再縫合成實體） |
| G6 | 以 sRGB 指定顏色 | ✅ 寫出值與輸入完全一致 |
| M1 | 網格擷取（80 孔治具板，1.6 萬個三角形） | 482 ms；replicad 的 C++ 批次擷取是 229 ms |

盤點：46 個類別有 44 個。缺的兩個是：

- `BRepFeat_MakeLinearForm`：不需要，肋材用伸長 + 布林即可。
- `BRepOffset_MakeOffset`：完整版同樣沒有綁定，見下方「仍未解決」。

### 4. 切換後的產品驗證

- `npm run check`：型別檢查、分層檢查、**51 個測試全部通過**，包括 Phase 0 的全部驗收，以及新增的「邊線折線涵蓋整條邊」測試。
- 瀏覽器實測：
  - 核心在 Worker 初始化 560–990 ms。
  - 改尺寸、復原、STEP 輸出（含中文產品名稱）、點選邊線加入圓角，全部正確。
- 效能：

  | 項目 | replicad 版 | libcascade 版 |
  |---|---|---|
  | 示範件重新計算 | 7.9 ms | **6.6 ms** |
  | 網格化 | 12.9 ms | 32.8 ms |
  | OCCT 初始化 | 119 ms | 678 ms |

## 實作時要避開的陷阱（libcascade）

1. **多載以參數個數分派**：`GCPnts_TangentialDeflection(curve, 角度, 弦高, 2, 1e-9, 1e-7)` 共 6 個數值參數，會被分派到「帶參數範圍」的多載，結果只離散化邊的一小段，而且切出上萬個點。要只傳 3 個參數，並用測試驗證折線長度等於邊長。
2. **UTF-16 字串沒有綁定**：`TCollection_ExtendedString.ToExtString()` 與 `Value()` 都不能用。要改用 `new TCollection_AsciiString(ext, '\0').ToCString()` 轉成 UTF-8 讀出。
3. **handle 所有權**：`BRep_Tool.Triangulation` 回傳的是有所有權的 handle 副本，刪除後不影響面上的網格，應該刪除以免洩漏。
4. **沒有批次網格擷取器**：要在 TS 端逐點讀取，並在 JS 端計算面內平滑法向。

另外，切換過程中發現並修正了三個與 OCCT 無關的前端問題：

- 拾取到的邊索引，原本會用「另一份結果」查名稱。改成一律用畫面上正在顯示的那份結果。
- 已被新請求取代的過期結果，原本仍會套用到畫面上。現在直接丟棄。
- 視窗尺寸為 0 時（隱藏分頁、最小化），「全部顯示」會算出失真的視錐。現在改成延後到取得實際尺寸再執行。

## 仍未解決

- **C10.1 移動面**：兩個建置都沒有 `BRepOffset_MakeOffset`。
  - Phase 3a 先用布林推拉處理側面與移動方向平行的常見情況（E5）。
  - 一般情況的選項：(a) Phase 3a 前用自訂建置加入這個類別；(b) 以「刪除面（Defeaturing）+ 延伸相鄰面 + 縫合」重建。
  - 在 Phase 3a 的技術驗證中決定。
- **體積與初始化時間**：瀏覽器首次下載約 12.4 MB（gzip），初始化約 1 秒。對內部工具可以接受；Phase 3b 包成桌面版後改從本機載入，影響會更小。

## 後果

| 項目 | 影響 |
|---|---|
| 授權 | libcascade 為 LGPL-2.1 + Open CASCADE 例外條款，目前定位為內部使用，符合授權 |
| 相依 | 產品程式碼不再依賴 `replicad-opencascadejs`；它只以 devDependency 形式留給驗證腳本重現本 ADR 的證據 |
| Docker | Phase 1–3 不需要 Docker。之後若要做自訂精簡建置，會使用 `@libcascade/toolchain` 固定的 `3.0.2-single-threaded` 映像，跟這次下載的 canary 映像（佔用 **12.3 GB**）無關，建議刪除 |
| 觸發路線 B 的條件 | 用你的真實檔案實測後，網格化或初始化超出藍圖 §4 的效能預算；或需要 `BRepOffset_MakeOffset` 等缺少的類別 |
