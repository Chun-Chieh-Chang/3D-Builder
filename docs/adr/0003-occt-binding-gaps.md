# ADR 0003：OCCT 綁定缺口的技術驗證與決策

- 狀態：**提議**（自訂建置需要你啟動 Docker Desktop，並同意下載 2.37 GB 映像）
- 日期：2026-09-27
- 依據：ADR 0002 的缺口表；需求 R7（大量輸入 SW 的 STEP 並繼續修改）
- 證據：`spikes/occt-gaps/`（`inventory.mjs` → `inventory.md`；`workarounds.mjs`，共 7 個實驗）

## 背景

Phase 0 使用 `replicad-opencascadejs` 1.1.0（OCCT 8.0）。這份建置只綁定 replicad 需要的類別。在 Phase 1 之前，要確認藍圖各階段需要的 OCCT 功能有哪些缺口、能不能繞過，以及補上它們的實際成本。

## 發現

### 1. 盤點：46 個需要的類別中有 29 個、缺 17 個

| 缺口 | 影響 | 繞道 |
|---|---|---|
| `STEPCAFControl_Reader` | 輸入時的名稱、顏色、組合件階層（F2.1 名稱、F2.8） | ❌ 無可靠繞道（E7） |
| `ShapeFix_Shape`、`ShapeFix_Shell`、`ShapeAnalysis_FreeBounds` | 整體修復、破面診斷（F2.2） | ⚠️ 部分可行：`Sewing` + `ShapeFix_Solid/Face/Wire`（E2、E3） |
| `BRepAlgoAPI_Defeaturing`、`BOPAlgo_RemoveFeatures` | 刪除面、刪除鑽孔（C10.2） | ⚠️ 平面上的貫穿孔可以處理（E4）；一般曲面不行 |
| `BRepOffset_MakeOffset` | 移動/偏移面（C10.1） | ⚠️ 只限側面與移動方向平行的情況（E5）；斜面相鄰時結果錯誤 |
| `BRepTools_History`（盤點後新發現） | 布林後合併共面時沒有歷史，持久命名只能用幾何方式對應（E6） | ⚠️ 可行，但計算量是「面數×面數」，需要空間索引，並改用面內點（質心可能落在孔裡） |
| `NCollection_IndexedMap`（無法建構） | 形狀索引 | ✅ Phase 0 已用 `ShapeIndex` 解決 |
| `HLRBRep_PolyAlgo`（Ph5）、`BRepLProp_SLProps`（Ph6）、`IntCurvesFace_ShapeIntersector`（Ph6）、`BRepFeat_SplitShape`（Ph4b）、`BRepLib_MakeFace`、`BRepAlgoAPI_Check`、`BRepExtrema_ShapeProximity`、`BRepFeat_MakeLinearForm` | 後期階段 | ✅ 都有替代方案：精確 HLR、`EvalD1` 外積算法向、網格射線、`BRepAlgoAPI_Splitter`、`BRepBuilderAPI_MakeFace`、`DistShapeShape`、伸長 + 布林 |
| `IGESControl_Reader/Writer` | IGES（P2，待辦池） | ❌ 需要自訂建置 |

### 2. 繞道實驗（`node spikes/occt-gaps/workarounds.mjs`）

| # | 實驗 | 結果 |
|---|---|---|
| E1 | 以 `Quantity_ColorRGBA` 輸出 STEP 顏色 | ✅ 寫出 `COLOUR_RGB`；OCCT 以線性 RGB 儲存、以 sRGB 寫出，輸入的 sRGB 顏色要先轉成線性 |
| E2 | 有 0.01 mm 縫隙的六個面 → 縫合 → 實體 | ✅ 自由邊 0、實體有效 |
| E3 | 只有面的 STEP 輸入 → 實體 | ✅ 體積 1000.000（精確） |
| E4 | 刪除貫穿孔（移除孔壁、以曲面 + 外框線重建面、縫合） | ✅ 937.168 → 1000.000 |
| E5 | 以布林推拉移動平面 ±2 mm，並合併共面 | ✅ 1400 / 600，合併後 6 面 |
| E6 | 布林 + `UnifySameDomain` 後，以幾何方式做面對應 | ✅ 10 面 → 6 面，全部唯一（13 ms） |
| E7 | 只用 `STEPControl_Reader` 輸入組合件 | ❌ 幾何正確（3 個實體、體積正確），但名稱與階層遺失 |

### 3. 補綁定的成本：replicad 的建置方式可以直接沿用

- 建置指令：`docker run … ghcr.io/taucad/opencascade.js:canary-ebd263f1-single-threaded link custom_build_single.yml`
- 映像裡已有預先編譯的 OCCT 8.0，所以**補綁定 = 在 YAML 清單加一行 `- symbol: 類別名`，再重新連結**，不需要從原始碼編譯 OCCT。
- 需要的檔案：
  - replicad 的綁定清單（約 270 個 symbol）
  - Emscripten 建置參數
  - 6 個 C++ 輔助檔：形狀雜湊、網格擷取、邊線擷取、BRep 讀寫等（LGPL-2.1）
- 映像大小：amd64 壓縮後 **2.37 GB**（31 層）。本機已安裝 Docker Desktop，但目前沒有啟動。
- 建置時間未知，第一次建置時實測。

### 4. 實作時要避開的陷阱

- `BRepBuilderAPI_MakeFace(face, wire)` 是在原面上「加一條線框」，不是取代邊界。要重建面，應該用 `BRep_Tool.Surface(face)` 取曲面再建構。
- `Extrema_ExtFlag` 沒有綁定。`BRepExtrema_DistShapeShape` 請用兩參數的建構子。
- 布林合併後，以幾何方式做面對應時，取樣點要用「面內一點」（例如三角網格的某個三角形重心），不能用質心。

## 決策（建議）

1. **Phase 1 照常開始**，繼續使用 `replicad-opencascadejs` 1.1.0 加上 E1–E6 的繞道。Phase 1 的範圍（布林、旋轉、導角、STEP 零件輸入、基本修復）都沒有阻擋。
2. **建立我們自己的 OCCT WASM 建置管線**，工具鏈與 replicad 相同：
   - 設定放在 `tools/occt-wasm/`：replicad 的清單，加上下面的補充清單，再加上 C++ 輔助檔。
   - 映像固定到 digest，不使用浮動的 canary 標籤。
   - 產物放在 `vendor/occt-wasm/`，以 Git LFS 管理。
   - `@3db/kernel` 透過 `LoadOptions` 切換模組，API 維持不變（同一個綁定產生器，型別相容）。
   - **最晚在 Phase 3a（C10 直接編輯）與 Phase 3b（F2.8 組合件輸入）之前完成**。建議在 Phase 1 期間完成，讓持久命名可以及早改用 `BRepTools_History`。
3. **補充綁定清單**：
   - STEP 輸入：`STEPCAFControl_Reader`
   - 修復與診斷：`ShapeFix_Shape`、`ShapeFix_Shell`、`ShapeAnalysis_FreeBounds`
   - 刪除面：`BRepAlgoAPI_Defeaturing`
   - 移動/偏移面：`BRepOffset_MakeOffset`
   - 形狀歷史與索引：`BRepTools_History`、`TopTools_IndexedMapOfShape`、`NCollection_BaseMap`、`TopExp`
   - 缺漏的列舉：`Extrema_ExtFlag`、`Quantity_TypeOfColor`
   - 工程圖：`HLRBRep_PolyAlgo`、`HLRBRep_PolyHLRToShape`
   - 分析：`BRepLProp_SLProps`、`IntCurvesFace_ShapeIntersector`
   - 分割線：`BRepFeat_SplitShape`
   - IGES：`IGESControl_Reader`、`IGESControl_Writer`（需確認映像是否含 IGES 函式庫）

## 後果與風險

| 風險 | 對策 |
|---|---|
| 映像是 canary 標籤，日後可能消失 | 固定 digest；必要時匯出映像保存 |
| 補充的類別會讓 WASM 變大 | 建置後實測；目前 23 MB，gzip 後 7.3 MB |
| 新綁定的方法若參數型別沒有綁定，會被產生器略過 | 用 `inventory.mjs` 逐一檢查方法簽章，必要時補上相依型別 |
| 授權 | OCCT 與輔助檔皆為 LGPL-2.1，目前定位為內部使用，符合授權 |

## 下一步

1. 你：啟動 Docker Desktop，並同意下載 `ghcr.io/taucad/opencascade.js:canary-ebd263f1-single-threaded`（約 2.37 GB）。
2. 我：
   1. 建立 `tools/occt-wasm/`。
   2. 第一次建置時實測時間與大小。
   3. 用新建置跑盤點腳本與全部測試。
   4. 通過後切換 `@3db/kernel`，並把本 ADR 改為「已採用」。
