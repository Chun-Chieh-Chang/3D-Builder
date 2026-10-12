# 交接文件

- 最後更新：2026-10-12 晚（**筆電工作整合進 main、C19 設計樹修正，見下一段**；**【線架構剖面交線與 SolidWorks 級動態側影輪廓線 (Silhouette Edges) 全套落實驗收完畢】**；**【Codex 任務接棒指南：裝飾用公螺牙與母螺孔 (Cosmetic Threads, C4.9 / ADR 0129) 架構與落地 SOP】**；全套 TypeCheck 0 錯誤、Lint 規則全綠、`acceptance.test.ts` 通過；其他狀態見「最新存檔點」）。


- **【2026-10-12 晚：筆電工作已整合進 `main`（Claude）】**
  - **整合**：F: 筆電的 `laptop-work`（`1ce9501`「work from laptop」）合併進這台的 `main`（`c7f46be`），合併提交 `d1b793c`，**已推送**。筆電那台要 `git pull`，之後 `laptop-work` 分支可刪（本機遠端名 `laptop` 指向 `F:\Self-developed_Apps\G3\3D-Builder`）。筆電提交裡 42 個檔案中 26 個與 `c7f46be` 相同（同步帶過去的草圖平面工作）；筆電真正新增的是設計樹階層模式與從屬標記、右鍵選單、工程圖與草圖改動、拖曳草圖尺寸標籤（`setDimensionPosition`、`labelPosition`）。
  - **沒合進來的**：`tests/` 根目錄 18 個零斷言診斷測試（副本在 `scratch/diagnostics/`，不進版本庫）；客戶零件 `apps/web/public/*part1*.json`（已取消追蹤、檔案仍在磁碟，筆電的 `.gitignore` 擋著）。**`c7f46be` 的歷史裡仍有這 3 個客戶零件檔**（私有倉庫）；要徹底清除需改寫歷史並強制推送，**待使用者決定**。
  - **補上筆電提交漏掉的**：`viewer.ts` 的 `ViewerEvents.onLabelDrag`（筆電的 `Viewport.tsx` 已呼叫，原本編譯不過；放開滑鼠時寫入一次＝一個復原步驟，拖曳中標籤不即時跟隨）；`redefineSketchPlane` 用 `planeRef()` 校驗（筆電 DEV_LOG 說有、提交裡沒有）；`cmd.dimensionPositionNotFinite` 進 i18n；e2e 輔助（`manual-support.js`、`phase1-demo-parts.js`）改讀設計樹列的 `.name`（列裡多了 ▲/▼、↳、└── 裝飾）。
  - **C19 修正（設計樹）**：階層模式下，草圖只有和使用它的特徵在同一個資料夾（或都不在）時才顯示在特徵底下，否則留在自己的資料夾、跟著折疊（`FeatureTree.tsx` 的 `sketchesUnder`）。原本資料夾裡的草圖會跑到資料夾外、折疊後仍看得到。
  - **驗證**：`npm run check` 2620 過、22 略過、0 失敗；`verify:ui`：C19、C12、草圖平面、尺寸標籤拖曳、螺牙通過（全量結果見提交訊息）。注意：5391 埠上若有從前一天一直開著的 `vite`，可能送出舊模組（這次就遇到），驗證前先重啟開發伺服器。
  - **尺寸標籤拖曳即時跟隨**（使用者 10-12 決定）：拖曳中只在畫面上移動標籤（`viewer.ts` 標籤的 `offset`／`held`），放開時寫入一次（一次拖曳＝一個復原步驟）；寫入被拒絕時約 0.4 秒後退回。
  - **10-12 晚的驗證**：`tsc`、lint:deps、lint:i18n 通過；vitest 2623 過、22 略過、0 失敗；`verify:ui` 相關 32 支（C10–C26、草圖平面、尺寸標籤、螺牙、phase3-sketch-*、phase5-dimensions）全過；全部 126 支這次沒有跑完（使用者中止）。開發伺服器又出現送舊模組的情況，重啟後才跑。
  - **零件 Schema 54→55**（使用者 10-12 決定）：`labelPosition` 是檔案的新欄位，升版讓舊程式拒絕而不是默默丟掉；遷移 54→55 空轉；測試 `tests/phase8/dimension-label-position.test.ts`。
  - **螺牙**：審查發現的問題已由 10-11 的 `d1dc276` 修掉，其後有標準螺紋規格庫（`c4de3ba`）與 `f832934`；本次沒有再動螺牙。
  - **待使用者決定**：① 客戶零件是否從歷史清除；（尺寸標籤拖曳已改成即時跟隨，見上）。
---

## ⚡ 今日任務總結 (2026-10-12)

### 1. 線架構 (Wireframe) 剖面交線即時動態提取 (ADR 0042 / A4.3 / D4.4)
- **問題根因 (RCA)**：在開啟剖面 (Section Cut) 時，線架構模式僅渲染實體原始網格之特徵邊界 (B-Rep feature edges)；而剖面切過實體內部處並無原始特徵邊線，導致截面兩端懸空斷開，幾何輪廓完全失真。
- **解決方案**：
  - 在 [`packages/render/src/viewer.ts`](file:///e:/Self-developed_Apps/G3/3D-Builder/packages/render/src/viewer.ts) 實作 `sliceMeshByPlane(geometry, plane, matrixWorld?)`。
  - 對三角形各邊與剖切平面進行空間線段截交運算，萃取閉合截面線段。
  - 建立專屬 `sectionEdges: THREE.LineSegments`，賦予高對比實線材質，設定 `polygonOffset` 與 `renderOrder: 999` 根治切面 Stencil Cap 與交線的 Z-fighting。
  - 整合進 `Viewer` 生命週期（`setSection`, `applyDisplay`, `clear`, `paintEdges`）。
- **驗證成果**：[`tests/phase3/section-edges.test.ts`](file:///e:/Self-developed_Apps/G3/3D-Builder/tests/phase3/section-edges.test.ts) **5/5 PASS**（立方體截面 4 線段、傾斜 45° 截面、平移模型矩陣、空交集與生命週期更新皆精確驗證）。

### 2. 比照 SolidWorks 標準之曲面動態側影輪廓線 (View-Dependent Silhouette Edges)
- **問題根因 (RCA)**：圓柱面、圓錐面、球體等平滑解析曲面缺乏內部幾何銳邊，在線架構模式下只看得到頂底封閉圓環，缺乏外側母線（側影線），導致在 3D 視角下形體不可辨識。
- **解決方案**：
  - 在 [`packages/render/src/viewer.ts`](file:///e:/Self-developed_Apps/G3/3D-Builder/packages/render/src/viewer.ts) 實作 `buildSilhouetteIndex(geometry)` 與 `extractSilhouettes(index, pos, viewDir, matrixWorld?)`。
  - **空間量化 (Spatial Quantization)**：以 `Math.round(val * 1000)` 克服旋轉體在 UV 接縫處 ($u=0$ 與 $u=2\pi$) 頂點索引不同但座標重合導致被誤判為開放邊的缺陷。
  - **智慧特徵過濾**：排除內部共面三角形（`dot > 0.9999`）與銳角邊（`dot < 0.25`，銳角已由靜態 B-Rep 邊處理），專注於 $1^\circ \sim 75^\circ$ 平滑過渡面。
  - **視角動態判定**：依相機視線向量 $\mathbf{v}$ 與兩側三角面法向量判定跨零邊界 $(\mathbf{n}_A \cdot \mathbf{v}) \cdot (\mathbf{n}_B \cdot \mathbf{v}) \le 0$。
  - 於 `render()` 迴圈與相機旋轉聯動，並套用 `clippingPlanes`，使側影線在線架構與剖面開啟時皆可正確被裁切。
- **驗證成果**：[`tests/phase3/silhouettes.test.ts`](file:///e:/Self-developed_Apps/G3/3D-Builder/tests/phase3/silhouettes.test.ts) **4/4 PASS**（圓柱前後視角萃取側邊母線、俯視角排除母線、透視模型矩陣支援、與靜態邊互補）。

### 3. 全局質量守門驗收
- `npm run typecheck`：**0 錯誤**。
- `npm run lint:rules && npm run lint:deps && npm run lint:i18n`：**全數通過**。
- `acceptance.test.ts`：**8/8 PASS**，無任何 Regression。
- 開發日誌更新：[`DEV_LOG.md`](file:///e:/Self-developed_Apps/G3/3D-Builder/DEV_LOG.md)。

---

## 🚀 接棒指引：裝飾用公螺牙與母螺孔 (Cosmetic Threads, Blueprint C4.9 / ADR 0129)

> **致接手 Agent（Codex 或後續架構師）：**
> 本章節為延續未竟任務之完整技術規格、架構設計藍圖與防禦約束。請直接依此 SOP 推進落地。

### 1. 任務核心定位與價值
- **需求追溯**：`docs/blueprint.md` 之 `| C4.9 | 裝飾螺紋線 | | P2 |`。
- **與真實螺牙 (ADR 0123) 的關鍵差別**：
  - **真實螺牙 (ADR 0123)**：建立真實 3D 螺旋實體並與圓柱做布林運算（Fuse/Cut）。優點是 3D 列印與真實干涉檢驗需要；但計算極度沉重，且因 OCCT 內部處理 B-spline 面的已知限制，每次布林運算必定洩漏 ~10MB Emscripten WASM Heap（見 `AGENTS.md §3.5`）。
  - **裝飾螺紋線 (Cosmetic Threads, C4.9)**：**絕不做 3D 布林螺旋幾何**！它是機械 CAD（SolidWorks / Inventor）中 95% 場合使用的標準做法：僅在特徵樹登記裝飾資訊，於 3D 視圖渲染輕量化虛擬牙線/貼圖，並在 2D 工程圖中依照 ISO 標準繪製 3/4 圈細實線圓弧與孔標註。

### 2. 行業標準幾何規格 (SolidWorks Benchmark & ISO 6410)
接手 Agent 實作時必須符合以下規範，不可隨意創造非標樣式：
1. **公螺紋 (External Cosmetic Thread，在凸圓柱面上)**：
   - 圓柱外表面為「大徑 (Major Diameter)」，顯示為模型實體邊界。
   - 螺紋區間在 3D 視圖中呈現虛擬螺紋面（或半透明牙紋）；端面或剖面處呈現「小徑 (Minor Diameter)」之 **3/4 圈細線圓弧**。
   - 側視圖投影為兩條細實線（牙底線）。
2. **母螺孔 (Internal Cosmetic Thread，在圓柱孔內壁上)**：
   - 孔壁為「小徑 (Minor Diameter，即鑽孔底徑)」，顯示為實體邊界。
   - 孔口端面呈現「大徑 (Major Diameter)」之 **3/4 圈細實線圓弧**（開口朝向通常約在右上或第 1/4 象限開口）。
   - 側視圖投影為兩條虛線（牙頂線）。
3. **尺寸標準庫對齊**：
   - 直接引用現成之 [`packages/model/src/threadStandards.ts`](file:///e:/Self-developed_Apps/G3/3D-Builder/packages/model/src/threadStandards.ts)（42 種 ISO Metric / UNC 標準規格）。
   - 支援 `standardDesignation`（如 `"M8x1.25"`、`"1/4-20 UNC"`）與 `custom`（自訂大徑、小徑、螺距）。
4. **終止條件 (End Condition)**：
   - `blind`（給定深度）：深度 $L$，附帶可選的退刀槽或不完全牙長度。
   - `through`（完全貫穿）：螺紋長度自動匹配圓柱面或孔全長。

### 3. 全鏈路代碼架構接線清單 (Implementation Checklist)

#### Step 1: 建立 ADR 規格文件
- 建立 [`docs/adr/0129-cosmetic-threads.md`](file:///e:/Self-developed_Apps/G3/3D-Builder/docs/adr/0129-cosmetic-threads.md)。
- 明確聲明：需求追溯為藍圖 C4.9，與 ADR 0123（真實螺牙）互斥，不觸發布林求解器，0 WASM 記憶體負擔。

#### Step 2: 模型與命令層 (`@3db/model`)
- 檔案：[`packages/model/src/schema.ts`](file:///e:/Self-developed_Apps/G3/3D-Builder/packages/model/src/schema.ts)
  - 新增特徵定義 `CosmeticThreadFeature`：
    ```typescript
    export interface CosmeticThreadFeature {
      kind: 'cosmeticThread';
      id: Id;
      name: string;
      suppressed?: boolean;
      targetFace: Id;          // 圓柱外表面 (公) 或孔內表面 (母)
      startRef: Id;           // 起始端面或環狀邊
      threadType: 'external' | 'internal';
      standardMode: 'standard' | 'custom';
      standardDesignation?: string; // e.g. "M8x1.25"
      majorDiameter: number;   // 大徑 (mm)
      minorDiameter: number;   // 小徑 (mm)
      pitch: number;           // 螺距 (mm)
      endCondition: 'blind' | 'through';
      depth: number;           // 螺紋深度
    }
    ```
- 檔案：[`packages/model/src/commands.ts`](file:///e:/Self-developed_Apps/G3/3D-Builder/packages/model/src/commands.ts)
  - 新增 `addCosmeticThread` 與 `setCosmeticThread` 命令。
  - 補齊 DAG 依賴收集（`targetFace`、`startRef` 遺失時標記黃色警告）。

#### Step 3: 再生引擎層 (`@3db/regen`)
- 檔案：[`packages/regen/src/engine.ts`](file:///e:/Self-developed_Apps/G3/3D-Builder/packages/regen/src/engine.ts)
  - 遇到 `cosmeticThread` 特徵時：
    - **禁止**調用 `Kernel.thread` 或布林運算！
    - 透過幾何探針萃取 `targetFace` 的圓柱半徑 $R$、軸心直線 $\mathbf{L} = \mathbf{P} + t \mathbf{D}$、起始參考位置。
    - 驗證半徑是否與標準規格吻合（若外圓柱面半徑與規格大徑誤差過大，回報溫和警示但允許強制覆蓋）。
    - 產生純幾何中繼資料 `CosmeticThreadAnnotation`，掛載於 `ViewMesh.annotations` 或模型裝飾清單：
      ```typescript
      export interface CosmeticThreadAnnotation {
        featureId: Id;
        type: 'external' | 'internal';
        axisPoint: [number, number, number];
        axisDir: [number, number, number];
        majorRadius: number;
        minorRadius: number;
        startOffset: number;
        length: number;
      }
      ```

#### Step 4: 3D 檢視器渲染 (`@3db/render`)
- 檔案：[`packages/render/src/viewer.ts`](file:///e:/Self-developed_Apps/G3/3D-Builder/packages/render/src/viewer.ts)
  - 實作 `setCosmeticThreads(threads: CosmeticThreadAnnotation[])`：
  - 在圓柱面上繪製端部 3/4 圈細線圓弧（Dash/Thin line），線寬 1px，顏色依主題（淺色模式 `#4B5563`，深色模式 `#9CA3AF`）。
  - （選配）圓柱面貼上輕量化半透明螺紋程序紋理（Procedural Normal/Alpha Map Shader）。

#### Step 5: 2D 工程圖整合 (`@3db/drawing`)
- 檔案：[`packages/drawing/src/views.ts`](file:///e:/Self-developed_Apps/G3/3D-Builder/packages/drawing/src/views.ts) / [`packages/drawing/src/dimension.ts`](file:///e:/Self-developed_Apps/G3/3D-Builder/packages/drawing/src/dimension.ts)
  - 在生成正投影視圖時，偵測實體上的裝飾螺紋：
    - 端視圖（投影方向平行於螺紋軸線）：投影為同心圓，外圈或內圈繪製 3/4 圈細實線（ISO 6410 標準）。
    - 側視圖（投影方向垂直於螺紋軸線）：在牙頂或牙底位置繪製兩條平行細實線。
  - 智慧型尺寸標註（Hole Callout）：選取帶有裝飾母螺紋的孔時，自動帶出螺紋規格呼出（如 `M8x1.25 ↧ 15`，對齊 ADR 0101）。

#### Step 6: 前端 PropertyManager 面板 (`apps/web`)
- 檔案：[`apps/web/src/components/PropertyManager.tsx`](file:///e:/Self-developed_Apps/G3/3D-Builder/apps/web/src/components/PropertyManager.tsx)
  - 面板佈局：
    1. **圓柱面選取槽**（支援點選凸圓柱面或孔內壁，自動判定公/母螺牙）。
    2. **起始邊/面選取槽**。
    3. **標準牙型下拉選單**（列出 42 種 Metric/UNC 規格，引用 `threadStandards.ts`）。
    4. **終止條件與深度**（成形至完全貫穿 / 給定深度）。

---

## 🛡️ 紅隊防禦與硬約束審查 (AGENTS.md Compliance Checklist)

接手 Agent 在聲明完成前，必須強制逐項通過以下自檢：
1. **輸入破壞防呆 (AGENTS.md §2.1)**：
   - 選取平面、錐面、自由曲面時，必須直接拋出錯誤並拒絕建立，不可默默退化。
   - 深度傳入 $\le 0$、`NaN`、極端數值時，立即攔截。
   - 深度大於圓柱長度時，明確提示但不崩潰。
2. **零代理指標原則 (AGENTS.md §3.1)**：
   - 測試記憶體指標時，若有調用底層，強制使用 `(oc as any).wasmMemory?.buffer?.byteLength` 且斷言 `initial > 0`。
   - 裝飾螺紋因為不調用 OCCT 實體布林，其記憶體成長應為 **0.00 MiB**，此點亦應在單元測試中被證實！
3. **禁止防禦性空轉閘控 (AGENTS.md §3.2)**：
   - 新增的裝飾線參數不可只留在 Schema 或未接線的 UI 中，全鏈路（Schema -> DAG -> Regen -> Render -> Drawing -> UI）必須 100% 打通。
4. **驗收測試門檻**：
   - 撰寫單元測試覆蓋公/母螺牙幾何推導、標準規格對齊、工程圖 3/4 圓弧投影產出。
   - `npm run check` 與 `npm run typecheck` 保持 0 報錯。

---

- 最後更新：2026-10-12（**借鑑 FreeCAD 深度對比分析、SSOT/MECE「小而精」架構優化方案、實機零件 `零件1.3dbx` 凸耳圓角 45° 方案 1 根治、底層 BRepCheck 破面剛性防禦與 UI 預防機制**）。
- **【2026-10-12：借鑑 FreeCAD 深度對照、SSOT/MECE「小而精」架構優化與破面預防機制落實】**
  - **核心哲學（使用者指示）**：本專案堅持「小而精、小而巧、極致實用」，反對 FreeCAD 介面過載、入口多頭、臃腫繁複的毛病。秉持 **SSOT (單一真值來源)** 與 **MECE (相互獨立、完全窮盡)** 原則，以**最短路徑、最單純入口**達成目標，同時針對目前廣度、深度、彈性不夠的地方借鑑 FreeCAD 進行外科手術式完善。
  - **FreeCAD 深度對比與「小而精」優化架構方案**：
    1. **旋轉特徵起始方位（Phase / Seam Angle）**：借鑑 FreeCAD AttachmentOffset 但避免其深奧選單，直接在旋轉特徵 PropertyManager 提供單一「起始相位角 (預設 0°)」，遇接縫衝突時直接輸入角度即旋轉接縫線，1 步完成，免手動建基準面。
    2. **零破面剛性防禦 (Hard BRepCheck Defense)**：底層 `Kernel.fillet` 強制執行 `BRepCheck_Analyzer` 確效；檢測到 `badFaces > 0` 立即拒絕，杜絕「表面看起來成功、模型實已破損」的隱性假綠。
    3. **圓角面板精準防呆引導**：當遭遇接縫衝突時，UI 明確指出接縫衝突根因並引導旋轉 45° 或草圖 2D 倒圓，二分搜尋僅在完全無破面區間尋找最大無損半徑。
    4. **基準幾何單一入口自動推斷**：統整為單一參考幾何入口，依點選對象（面/軸/圓柱）自動推斷偏移、角度或相切，消除選擇性障礙。
    5. **智慧幾何健康檢查 (Smart Health Inspector)**：幾何破損時特徵樹醒目標示、3D 畫布以警示色高亮破面輪廓，提供一鍵處方指引。
  - **實機零件 1（C3C6 檢具）驗證**：
    - `D:\3DB實機確認\C3C6檢具\零件1.3dbx` 完整 24 特徵重建通過（`tests/test-full-real-part1.test.ts`），基準模型無錯誤。
    - 45° 方案 1 實機量測：旋轉基準面轉移至 45° 避開接縫後，凸耳 4 條豎直邊均可完美施作 0.3 mm 圓角，體積 149.705 mm³，0 破面、0 變異。
- **【2026-10-11：螺牙特徵第二階段（D1: T-6 至 T-8）全套落實、審查校正與桌面版 0.2.2】**
  - **T-6 標準螺牙庫與 60° 基本牙型幾何推導器 (`@3db/model`)**：
    - 內建 42 種標準規格（公制粗牙 M2~M30、公制細牙 M8x1.0~M24x2.0、美制粗牙 UNC #4-40~3/4-10、美制細牙 UNF #10-32~1/2-20）。
    - 嚴格依 ISO 68-1 幾何解析推導 60° 牙型（牙側角 30.000°），支援外螺紋切除、外螺紋長出、內螺紋切除；平行外延區間 Margin 在數學上保證軸向跨度 $zMax - zMin < P$；校正註解與測試（牙頂槽寬 0.875P、牙根寬度 P/6）（`threadStandards.test.ts` 10/10 PASS）。
  - **T-7 核心兩端漸縮收尾演算法 (`@3db/kernel`)**：
    - `Kernel.thread` 實作旋轉包絡實體（Revolved Tapered Envelope Solid）裁剪，使牙高在端點平滑收攏歸零淡入淡出，消除 90° 刃口階梯（`thread-fade.test.ts` 4/4 PASS）。
  - **T-8 特徵與前端整合 (`@3db/regen`, `PropertyManager.tsx`)**：
    - Schema 擴充 `profileMode?: 'standard' | 'custom'`、`standardDesignation`、`standardTarget`、`fadeTurnsIn/Out`；標準模式免手繪草圖。
    - `engine.ts` 支援圓柱面端點邊界自適應對齊切入；`commands.ts` 補齊 `setThread` 分支。
    - `PropertyManager.tsx` 完整提供規格模式切換、標準下拉選單與漸縮圈數輸入。
    - 端到端整合與自我紅隊測試全過（`thread-standard-feature.test.ts` 7/7 PASS；STEP 往返體積偏差 $< 10^{-4}$）。
  - **全套螺牙測試狀態**：7 套件 61/61 PASS（`threadStandards` 10、`thread-fade` 4、`thread-ui` 4、`thread-feature` 7、`thread-standard-feature` 7、`thread` 24、`thread-fuzz` 5，含 200 組 Fuzz 壓力測試 0 崩潰）。
  - **審查深度校正（Workbuddy Audit CAPA）**：
    1. A1 自適應高精度 `massProps` 預設開啟（`adaptive ?? true`），`kernel.test.ts` 補齊螺牙真實曲面自適應高精度對照測試。
    2. A2 `direct-edit.test.ts` 改用真實 Emscripten WASM Heap `wasmMemory.buffer.byteLength` 並強制基準值 `> 0` 防呆，消除恆真式假綠。
    3. `AGENTS.md` 寫入「真值存在性防呆」與「禁止防禦性空轉閘控」自我演化準則。
  - **全域 RSI 自回歸進化系統落成**：於 `C:/Users/3kids/.gemini/config/rsi` 建立跨專案的四大元模組（活躍卡片庫、結晶退休庫、睡眠壓縮器、動態反饋器），並在本專案接入 `scripts/check-anti-patterns.mjs`（`npm run lint:rules`），實現 100% 物理剛性防禦。
  - **桌面版升級 0.2.2**：已重新建置產出最新可執行檔 `apps/desktop/src-tauri/target/release/desktop.exe`（13.15 MB）與 NSIS 安裝包 `apps/desktop/src-tauri/target/release/bundle/nsis/3D-Builder_0.2.2_x64-setup.exe`（11.32 MB，2026/10/11 12:01:10），完整內嵌最新 42 種規格庫、漸縮淡入淡出核心與自適應質量特性。
- **【2026-10-11：落實選擇題決策 A1~A3、B1~B2，說明系統更新與桌面版 0.2.1 打包】**
  - **使用者裁決結果落實（全部採用架構師建議）**：
    1. **A1 質量特性自適應高精度**：`hasComplexSurfaces` 偵測 B-spline/螺牙/自由曲面自動切換至 `eps: 1e-6`，初等幾何維持快速積分與手算基準吻合（`kernel.test.ts` 10/10 PASS）。
    2. **A2 moveFace 記憶體重構**：`insidePoint` 面分類器及時 `delete()` 釋放，`direct-edit.test.ts` 加入真實 WASM Heap（`HEAPU8.byteLength`）守恆驗證（20 次重建 0 洩漏）。
    3. **A3 效能計時門檻隔離**：建立獨立腳本 `scripts/check-perf.mjs`（`npm run check:perf`），常態跑測與計時解耦，杜絕平行負載誤報。
    4. **B1 說明系統 10 大主題更新與 SW 2010 繁中對照**：完成量測、螺牙、鈑金邊線凸緣/離隙/封閉角落/斷開角落、工程圖標註/剖面拖曳/號球之繁中對照（`help.test.ts` 40/40 PASS）。
    5. **B2 桌面版 0.2.1 打包**：升級版本號至 0.2.1，產出 `apps/desktop/src-tauri/target/release/bundle/nsis/3D-Builder_0.2.1_x64-setup.exe`（11.32 MiB）。
    6. **C1/C2/D1 確認**：孔標註維持現有用語；外部程式檢視等使用者有空再測；下一階段啟動「螺牙特徵第二階段（Metric / UNC 標準規格牙庫、直徑規格下拉選單與兩端漸縮收尾）」。
- **【2026-10-11：螺牙（真實螺紋實體）— 經 Claude Code 嚴格審查與全面確效修復（T-1 至 T-5 全數真實驗證通過）】**
  - **需求（使用者）**：要能建出真的螺牙實體（3D 列印、STEP、工程圖剖面），參數要有彈性；第一個驗收對象是 ISO 80369-7 參考件（兩個零件：中間有中心孔的錐形體＝只用旋轉與圓角；外面有內螺紋的鎖緊環＝要新功能，右旋、雙線、自訂牙型，Ø8／Ø7.2、螺距 2.5、導程 5、非對稱 30° 牙側）。使用者指正：**公差不影響建模**（工程圖要能標對稱、單向、不對稱公差：`DimensionTolerance` 的 `upper`／`lower` 已支援，T-4 用此圖驗證），**螺距、導程等都是參數**，不要再問。
  - **計畫與驗收**：[docs/thread-plan.md](docs/thread-plan.md)（T-1 核心、T-2 特徵與再生、T-3 介面、T-4 參考件與工程圖、T-5 鞏固）。
  - **Claude Code 審查揪出的問題與矯正確效（CAPA 全部根治）**：
    1. **多線牙型重疊導致 WASM 崩潰根治**：當牙型寬度 $\ge$ 單線螺距時（相鄰牙在空間中重疊），過往使用 `Fuse` 每次消耗 100~250 MB 記憶體不釋放且致崩潰。修復：核心在 `kernel.ts` 嚴格限制 `zMax - zMin < pitch`，超出時明確拋出 `feature.threadProfileTooWide`；多線各 start 彼此不接觸，改用 `TopoDS_Compound` 組合，彻底杜絕記憶體洩漏與崩潰。
    2. **軸線支援草圖中心線**：草圖中心線作為軸（`axis: Id`）支援，在 `schema.ts`、`commands.ts`、`refs.ts`、`dag.ts`、`engine.ts` 與 `PropertyManager.tsx` 完整打通，整合測試不再報「遺失參考」。
    3. **線數整數校驗**：輸入 1.5 條線保留原值傳入核心，直接拒絕並說明原因（`feature.threadBadStarts`），不再默默取整為 2。
    4. **ISO 80369-7 參考件真實 6.00% 錐度與實體量測**：
       - 公錐體：修正為真正 6.00% 錐度（$(4.315 - 4.021) / (5.65 - 0.75) = 0.060$），頂端 $y=7.5$（$r=1.9880$）、底端 $y=0$（$r=2.2130$），頂端外緣實作真實 0.2 mm 圓角特徵（`fl_tip`）。
       - 鎖緊環：內螺紋從入口 $y=8.0$ 切入至 $y=1.0$ 退刀槽，切入入口倒角；探針容差收緊至 $\le 0.005$ mm（實測 $\pm 0.003$ mm 通過）；以實體探針直接量測 3D 實體齒形牙側角（30.000°）。
       - 工程圖：剖面視圖呈現鋸齒齒形；標註元素 100% 透過 `elementFacts` 從實際實體動態解析（無 mock 假資料）；對稱（±0.025）、單向（0/-0.005）、不對稱（+0.001/-0.004）極限公差 DXF/PDF 輸出驗證全過。
    5. **Fuzz 隨機測試改寫與全過**：200 組隨機幾何參數測試（`thread-fuzz.test.ts`）0 崩潰，100+ 組生成有效實體，極限自相交幾何精準防禦性攔截。
  - **全套確效狀態**：
    - `tests/phase3/thread.test.ts`（24/24 PASS）
    - `tests/phase3/thread-feature.test.ts`（7/7 PASS）
    - `tests/phase3/thread-ui.test.ts`（4/4 PASS）
    - `tests/phase3/iso-80369-7-thread.test.ts`（7/7 PASS）
    - `tests/phase3/thread-fuzz.test.ts`（5/5 PASS，含 200 組 Fuzz）
    - `manual-thread.js`（無頭瀏覽器 UI 重播 1/1 PASS，11.1s）
    - `npm run check:perf`（PASS）
    - `npm run typecheck`（0 錯誤）、`npm run lint:deps`（OK）、`npm run lint:i18n`（OK）。
- **【2026-10-09 深夜：圓角失敗的說明】** 使用者回報選一個面做圓角失敗（只顯示「圓角失敗」）。重現：孔離邊太近時，外緣與孔緣的圓角在中間的窄條互相重疊（窄條寬度要大於兩倍半徑，例如板 80×50、Ø24 孔、窄條 13，半徑 7 起失敗），核心拒絕。已改：`engine.ts` 的 `roundEdges` 在失敗時用折半法找出同樣的邊可用的最大半徑，訊息改成「半徑 X 對選到的邊太大…半徑 Y 以下可以」（`edit.filletTooBig`）；`fillet-by-face.test.ts` 加測試。**使用者那個零件（未存檔的「零件1」）的實際半徑與錯誤我沒看到，是依重現推論；若訊息不是這個原因，請貼「錯誤為何？」的內文。**
- **【2026-10-09 晚：使用者在選擇題頁面的決定（全部採用建議）與桌面版 0.2.0】** 桌面版版本升到 **0.2.0**（`tauri.conf.json`、`Cargo.toml`、`Cargo.lock`），安裝檔 `apps/desktop/src-tauri/target/release/bundle/nsis/3D-Builder_0.2.0_x64-setup.exe`（11.31 MiB，不在版本庫；含到 `291c0c7` 的程式；**說明視窗還是舊內容**；只看了建置輸出，沒有安裝或啟動過，**另一台電腦的安裝測試（ADR 0052 驗收第 3、7 項）由使用者找機會做並回報**）。決定：A1 版本號提交並推送（已做）；**A2 說明視窗內容更新、A2b 用 SW 2010 繁中線上說明對照：10/12 重置後做，範圍只有這輪動過、SW 有對應的約 10 個主題**（測量、工程圖標註與剖面、零件號球、鈑金離隙、凸緣、斷開角落、以曲面除料等；`https://help.solidworks.com/2010/chinese/SolidWorks/help_list.htm?id=0` 讀得到，內容頁在 `/2010/chinese/SolidWorks/sldworks/LegacyHelp/...`，頁面有 Cookie 橫幅，不必點；比較行為與名詞後用我們自己的話寫，不照抄；SW 2010 沒有的功能對照不到），改完再重建安裝檔（0.2.1）；A4 簽章與自動更新不做；A5 圖示維持暫用圖；B1 圓角導角其餘功能、B2 號球引線彎折不做，等回饋；B3 草圖吸附 S-5 結案（SW 說明沒寫那四件事，也沒有 SW）；B4 先不開新功能；**B5 平板型式 DXF 折彎註記上下顛倒：已修**（`flatDxf.ts`：沿折彎線的角度超過 90 度到 270 度時改從另一端讀，測試在 `flat-dxf.test.ts`）；B6 可製造性檢查先用預設比例；C1 繼續用公開樣本；C2 不評估 openswx 等工具；C3 死碼清理清單全部保留。手冊實機驗證仍擱置（先用目前結果，遇問題再回報）。
- **【最新存檔點 2026-10-11：目前主線 commit `c4de3ba`；桌面版 0.2.2 已建置】** 本輪工作已提交、推送並快轉合併到 GitHub `main`；完成項目：① 螺牙特徵第二階段（42 種 ISO Metric/UNC 標準規格庫、60° 牙型解析推導、兩端漸縮收尾 Revolved Tapered Envelope 消除 90° 刃口、PropertyManager 面板整合，Schema 53）；② 選擇題決策 A1~A3、B1~B2 全部落實（massProps 自適應高精度、moveFace 記憶體守恆、check:perf 計時隔離、說明系統 10 大主題繁中對照）；全套測試 52/52 全綠。桌面版版本號由 0.2.1 升至 0.2.2，並於 12:01:10 重新打包產出 `3D-Builder_0.2.2_x64-setup.exe`。
- **【歷史存檔點 2026-10-09：主線 commit `1a2dd3b`】** 本輪工作已提交、推送並快轉合併到 GitHub `main`；本機 `main` 與 `origin/main` 指向同一 commit。完成項目：① 鈑金「斷開角落」獨立特徵，支援凸緣自由端外角倒角／倒圓，折疊與平板型式一致（零件 Schema 51，ADR 0121）；② 曲面除料方向支援任意有限非零 XYZ 向量及保留方向前側／後側，舊平面參考相容（零件 Schema 52，ADR 0122）；③ 量測已保留項目可在同一文件工作階段中關閉／重開工具後保留，切換／載入文件時清除；頂點以 persistent name 跨再生追蹤，失效會提示；組合件可選各元件座標系並套用位姿／鏡射；④ 取得 OSF 公開樣本 6 個 GPL-3.0 STEP 與 3 個對應 SLDPRT，來源、雜湊、授權與測試資料記於 fixture README。拓樸追蹤目前僅支援具名頂點；圓心、中點、邊上及面上抓點仍存固定座標。
- **【歷史存檔點 2026-10-09：主線 commit `1a2dd3b`】** 本輪工作已提交、推送並快轉合併到 GitHub `main`；本機 `main` 與 `origin/main` 指向同一 commit。完成項目：① 鈑金「斷開角落」獨立特徵，支援凸緣自由端外角倒角／倒圓，折疊與平板型式一致（零件 Schema 51，ADR 0121）；② 曲面除料方向支援任意有限非零 XYZ 向量及保留方向前側／後側，舊平面參考相容（零件 Schema 52，ADR 0122）；③ 量測已保留項目可在同一文件工作階段中關閉／重開工具後保留，切換／載入文件時清除；頂點以 persistent name 跨再生追蹤，失效會提示；組合件可選各元件座標系並套用位姿／鏡射；④ 取得 OSF 公開樣本 6 個 GPL-3.0 STEP 與 3 個對應 SLDPRT，來源、雜湊、授權與測試資料記於 fixture README。拓樸追蹤目前僅支援具名頂點；圓心、中點、邊上及面上抓點仍存固定座標。
  驗證：`npm run verify:ui` **125/125 通過**；`npm run check` **183 個測試檔通過、3 個略過；2481 項通過、22 項略過**；`npm run build` 成功（Vite 有兩項警告）。選看過 D9 量測截圖；無頭 UI 使用合成指標事件，不等於實體滑鼠驗證。
  **下一步以實機／人工待辦為主：** I10 真人完成鈑金支架流程；F7、D9 用實體滑鼠檢查標註／剖面／量測標籤與抓點；D9 的 375／390／768 視口未驗（本機頁面被已保存的瀏覽器權限設定阻擋，未嘗試繞過）；F6 用外部程式開 PDF；F4／K2 確認公司孔標註用語；G5、I9 用其他 CAD／雷射軟體檢查（I9 已在 eDrawings 開過，沒有其他軟體可略過）；J 樣本已取得並完成 STEP 匯入測試，但 SolidWorks 特徵樹／分析／製造數據對照仍待可用環境；K 章標準與功能範圍待使用者決定；L 章含需許可的資料夾清理。號球引線彎折仍是選做。下面按 Phase 記載的清單含歷史描述，若與本存檔點衝突，以本段與 `docs/manual-verification.html`、`docs/verification-coverage.md` 為準。
  用量約定：session／weekly／overall 任一可用讀值達 97.5% 時更新本檔並推送。用量工具最新提供的是 Codex 30 日視窗 **98%（整數）**，session／weekly／overall 個別數值及小數讀值未提供；此讀值已超過 97.5% 更新門檻。工具回報此 30 日視窗於 2026-11-08 08:43:56 UTC 重置。先前記錄的 2026-10-12 09:00 UTC 是另一項重置時間，不能由目前可用量資料確認。
- **【存檔點 2026-10-09，每週用量 90% 時留的（使用者要求：session／weekly／overall 用到 97.5% 時要更新本檔）】** 使用者 10-09 說「先推送」，下面三個提交（加上本檔的這次更新）已推上 `origin/main`；`6514826`（手冊）、`3a242be`（剖面位置左鍵拖動、A1／D3／D8 記為通過）、`b4c4365`（工程圖標註／剖面線在圖上做、圖頁單位英寸、測量像 eDrawings、作者資訊；工作區當時乾淨）。推送前要跑的都已跑過：完整 `npm run verify:ui` **123 支全過、0 個失敗**（2026-10-09，在 `b4c4365` 上），`npm run check` 2448 項過。**【10-09 稍晚：測量第二段（點選位置、保留多筆、拖標籤、座標系）已做完並驗過】** `npm run check` 2461 項過；`manual-measure-view.js` 18 步在無頭瀏覽器 0 個主控台錯誤（先前的 NaN 錯誤是點選位置的挑選被當成「頂點 -1」去畫高亮，`Viewport.tsx`／`AssemblyViewport.tsx` 現在略過有 `point` 的選取）；相關瀏覽器腳本（measure、manual-d6、manual-asm、manual-drawing、phase5、manual-section）19 支全過。手冊 D9 與覆蓋表已補。座標系另有瀏覽器步驟 17b（`manual-measure-view.js` 19 步）。 改動：`Kernel.makeVertex`；`MeasureTarget.point`、`placePoint`、`measureTargets` 把點做成頂點；`packages/render/src/snap.ts`（`polylinesOf`、`middleOf`、`circleCentre`）與 `viewer.ts` 的 `snapAt`／`setSnapPicking`／`setSnapMarker`／`setMeasureLabelDrag`；`measureView.ts` 的 `MeasureFrame`、`MeasureContext`（座標系、標籤前綴、使用者偏移）、`components`；`store.ts` 的 `MeasureState.mode／saved／offsets`、`measurePickPlace`、`saveMeasure`、`removeSavedMeasure`、`moveMeasureLabel`、`clearAllMeasures`、`setMeasureMode`、`runMeasure` 連已保留的一起重算；`MeasurePanel` 的「選取：元素／點」、座標系下拉（只有零件的座標系統特徵，組合件只有世界）、「保留這筆」、已保留清單與複製全部。**限制**：保留的量測離開測量工具就沒了；點的位置存零件本地座標，零件重建後點不會跟著拓樸移動；座標系的選擇存 `3db-measure-options`。以下是當初的設計（供對照）：① 點任意位置量測——`Kernel.makeVertex(p)`（核心裡已有 `BRepBuilderAPI_MakeVertex`，加一個公開方法即可），`MeasureTarget` 加 `kind: 'point'` 與 `point`（顯示座標；組合件的點要存零件本地座標再乘姿態，免得零件移動後點留在原地），`measureTargets` 把點做成頂點形狀再用現成的精確 `kernel.distance`；視窗端用網格算吸附（頂點 10 px > 邊的中點（弧長中點）> 圓或弧的圓心（三點外接圓，且各點到心的距離相等才算）> 邊上最近點 > 面上射線命中點），`viewer` 發 `onSnapHover`／`onSnapPick`，懸停畫標記與種類標籤（端點、中點、圓心、邊上、面上）；面板加「選取：元素／點」。② 保留多筆——`measure.saved[]`（picks、report、offsets），模型變動時全部重算，面板列表可刪、複製全部，圖上全畫。③ 標籤可拖——`measureLabels` 開 `pointer-events`，拖動存畫面偏移（`offset` 已在 `MeasureGraphics.labels`），存在 saved／目前量測的 `offsets`。④ 座標系——`viewMeasure` 加 `frame`（原點與三軸），dX／dY／dZ 沿該座標系的軸，階梯線也沿它；面板列出零件的座標系統特徵（組合件只有世界座標）。每一項都要有單元測試（純計算部分）加 `manual-measure-view.js` 的步驟，手冊 D9 補寫。

- **2026-10-08：減少人工實機驗證（使用者要求「既然你能自動測試，就減少我的人工項目」）——已完成，等使用者看結果。**做法：`npm run verify:ui`（`scripts/verify-ui.mjs`，無頭 Chrome 跑 `tests/e2e/*.js`，`--shots <資料夾>` 存截圖、`--only <正規式>`）；手冊每項照步驟重播成 `tests/e2e/manual-<項目>.js`（共用 `manual-support.js`；組合件的用 `phase2-assembly.js` 的 `__ui2`）；我看截圖判斷「看畫面」。**覆蓋表、找到的缺陷、手冊要改的字都在 [docs/verification-coverage.md](docs/verification-coverage.md)**（先讀它）。手冊 [docs/manual-verification.html](docs/manual-verification.html) 已更新：56 項標「已自動重播驗過」並預設隱藏（上方篩選「需人工」是預設、「全部」可看全部），2 項（C17 要 eDrawings、F4 孔標註用語）有黃框寫明還剩什麼（**C17 的 eDrawings 開 STEP 看顏色，使用者 2026-10-08 實機確認通過**）。**工程圖視圖連動（使用者無意中發現，2026-10-08，未提交）**：三視圖原本是三個互不相干的視圖，拖一個其他不動、拖掉前視圖還會因排版基準換了而跳位，視圖也不能用滑鼠縮放。現在：圖紙檔 Schema 7（`sheet.shift`＝整組排版的位移、視圖的 `slide`＝沿對齊軸的位移，都可有可無，舊檔照開；`DRAWING_SCHEMA_VERSION` 7、migration 6→7 空轉）；`layout.ts` 的 `arrangementBase`／`slideAxis`／`scaleFromRatio`／`scaleTarget`；`DrawingViewport.tsx`：拖前視圖＝整組（shift）、拖其他三視圖＝只沿對齊軸（slide，距離可調）、Shift＝脫離對齊（at）、選取視圖右下角把手＝改比例（改它名下的比例：自己的、母視圖的或圖頁的，所以連動視圖一起縮放；吸附標準比例，否則 n:d 分數，如 6:5）；「自動排版」對前視圖是整組放回中央。**「最適比例」已把標註算進去（`packages/drawing/src/fit.ts` 的 `fitViews`：逐一試標準比例，量視圖加標註加中心記號與剖面字母的範圍，放得下才選；並算出整組要平移多少才在圖紙範圍正中，寫進 `sheet.shift`；只算沒有自己比例與位置的視圖；標註線離視圖的距離是圖紙上的固定毫米數，所以有標註時最適比例會比只看視圖框更小）**；**還沒做**：標準三視圖仍是三個獨立的 model 視圖（不是 SolidWorks 那種投影視圖），方向由視圖自己決定，改投影法（第一角／第三角）時位置會跟著換，這是刻意保留的。重播腳本 `manual-drawing-linked.js`，單元測試 `tests/phase5/drawing-linked.test.ts`；`npm run check` 通過 2387 項。****測量像 eDrawings、英制、作者資訊（2026-10-09，使用者要求，未提交）**：使用者貼 eDrawings 的測量畫面問能否比照；回答「畫在圖上」缺的只是繪製，資料已有；使用者要求按建議做，並說明「圖面標註有時用英制」。做了：`packages/model/src/units.ts`（`formatLength` 毫米／英寸／分數、`formatAngle`）；`measure.ts` 加 `relation`（平行／垂直／夾角）、`total`（|dx|+|dy|+|dz|）、`round`（圓、弧、圓柱、球的中心到中心與最大距離；軸要平行才有最大；kernel 回報圓心與軸）；`measureView.ts` 把報告變成「要畫的線與標籤」與「結果文字」（純函式，有測試）；`viewer.ts` 的 `setMeasureGraphics`（`LineSegments2` 粗線、點、標籤，標籤可有畫面偏移）；`MeasurePanel` 的單位、分數、分母、最近分數、角度單位、弧圓量法、結果與複製（選項存 `localStorage` 的 `3db-measure-options`）；工程圖圖頁新增 `sheet.unit`（Schema 8，`mm`／`in`，缺省毫米；尺寸數字、公差、孔註、孔表換成英寸，檔案與圖紙仍是毫米；公差欄用圖頁單位輸入）；**作者資訊「Created & Developed by Wesley Chang, Oct-2026. All Rights Reserved.」在狀態列右側（視窗寬度小於 1100 px 時隱藏）與說明視窗底部**（`apps/web/src/credit.ts`）。重播腳本 `manual-measure-view.js`、單元測試 `measure-units.test.ts`（23 項）、`drawing-units.test.ts`（11 項）；手冊新增 D9。**限制**：點任意位置（端點、中點、面上任一點）量測、多筆量測保留、標籤可拖、改座標系 這些是第二段，沒做；工程圖面板列出元素的文字（「面 x = −40」）仍是毫米；分數只做英寸。

**工程圖：在圖上標註、搬標註、畫剖面線（2026-10-09，使用者要求「標註位置寫死無法搬移、無法編輯、無法自由決定如何標註與剖面位置，請參考 SW」，未提交）**：圖紙檔 **Schema 8**（標註可有可無的 `precision`／`prefix`／`suffix`／`text`（覆寫，`<DIM>` 代表原文）／`slide`（線性與角度：文字沿線位移）／`leader`（直徑與半徑的引線長度）；migration 7→8 空轉）。`packages/drawing/src/pick.ts`（純計算：`featureAt` 從畫出來的線找出被點到的元素、`dimensionAt`、`planDimension` 由點選的元素與位置決定標註種類與位置、`dragDimension`、`factsOf` 讓預覽不必等 worker）；`dimension.ts` 的 `handle`、`offsetAt`、`leaderAt` 等；`DrawingViewport.tsx` 整份改寫（智慧型尺寸工具、剖面與細部圓的畫線工具、點選與拖曳標註、拖剖面線、雙擊到面板的文字欄、Esc 與 Delete；其他按鍵照舊平移）；`DimensionPanel`／`DrawingPanel` 加工具按鈕與編輯欄位；SVG 輸出的標註文字有白色邊。面板原有的下拉與數字欄都還在。重播腳本 `tests/e2e/manual-drawing-annotate.js`（13 步）、單元測試 `drawing-pick.test.ts`（19 項）；手冊新增 F7。**限制**：預覽用的元素資料是由視圖的線推出來的（`factsOf`），孔的標註（貫穿、深度）只有放下後才完整；標註不自動避讓（只能手動搬）；點選以畫出來的線為準，被隱藏線擋住或沒畫出來的元素點不到；組合件視圖仍無法標註（原本就如此）。**使用者 2026-10-09 實機確認通過：A1（桌面版安裝）、D3（輸入 STEP 組合件）、D8（輸出 STEP 組合件）**，已寫進手冊（`data-auto="user"`，現在共 14 項）；手冊剩下要人做的：I10、F6（PDF）、F4（用語）、G5／I9（認可 10-05 的 eDrawings 結果）、J 章樣本、K 章決定、L 章清理。**剖面位置可用滑鼠左鍵拖動（2026-10-09，使用者要求）**：剖面開著時，游標在橘色切面上變成手，左鍵按住沿切面的垂直方向拖，位置依該軸在畫面上的投影長度換算（軸正對視線時改用上下拖），停在模型範圍的盡頭；`viewer.ts` 的 `sectionHit`（切面與實體內部的判斷：切面平面與滑鼠射線的交點，射線方向不沿軸的探針穿過實體表面的奇偶，且沒有被保留的表面擋在前面）、`onSectionDown`（capture 階段攔下，所以不會同時選取或拖元件）、`setSectionDrag`；`ViewOptions` 把 `setCut` 接上去。重播腳本 `tests/e2e/manual-section-drag.js`（8 步，組合件與零件）；這個改動在 `viewer.ts`，要跑 `npm run verify:ui`（相關 20 支已過）。**H9（外殼加蓋子：實際走一遍）使用者 2026-10-08 實機確認通過**（走的過程提出的問題都已修，見下）。**H9 實機走到「新組合件」時發現：專案資料夾一旦選過（本次或瀏覽器記住的）就沒有地方可換，面板固定顯示舊資料夾（使用者看到 `test`，選不到 `塑膠件`）；已修：插入面板加「更換資料夾…」（只在新做、還沒放零組件的組合件出現；`store.changeProjectFolder`、`AssemblyStore.canChangeProject/setProject`），重播腳本 `tests/e2e/manual-h9-folder.js`，`npm run check` 通過 2370 項**。**H9 走到結合時又發現兩件事**：① 使用者選外殼與蓋「直立角落邊」重合報矛盾——不是缺陷：外殼有 1° 拔模，四條直立邊往內傾斜且互相不平行，蓋的直立邊是垂直的，兩組不可能同時共線（求解器對）；可行做法是「開口面重合＋兩條互相垂直的開口外緣水平邊重合」，已用真實檔案驗過三個都成立，寫進手冊 H9；邊線與邊線的「重合」就是共線（`equations.ts` line+line），沒有另開「共線」選項。② 組合件沒有剖面與顯示類型 → 已加（`Viewport.tsx` 的 `ViewOptions` 加 `assembly` 參數、`AssemblyViewport.tsx` 掛上、`viewer.ts` 的 `styleInstance` 讓每個零組件吃剖面平面與顯示類型、點選略過被切掉的部分、新放的零組件自動被切；組合件沒有「顯示隱藏線」虛線；`.view-options ~ .flyout-tree` 讓結合的飛出樹往下讓開），重播腳本 `tests/e2e/manual-asm-section.js`。**使用者看過之後又提三點（都已做，`manual-asm-section.js`／`manual-asm-menu.js` 通過）**：③ 剖面切開後實體像空心 → 切面現在用模板緩衝（stencil）填滿（`viewer.ts` 的 `updateCap`：每個實體各一組、互相不抵消；渲染器要 `stencil: true`；零件視窗也一併有填滿），沒填滿時看到的是殼內壁；剖面位置的數字可直接輸入（`Viewport.tsx` 的 `SectionValue`，Enter／離開欄位套用、Esc 取消、非數字還原，不限滑桿範圍；測試抓到 Esc 之後的 blur 會提交舊草稿，已修）；**填滿第一版有缺陷（使用者拖滑桿發現橘色截面不跟實體切口對齊，已修）：模板材質建立時抓住當時的剖面平面，`setSection` 每次換新平面卻沒更新它們；現在 `updateCap` 每次都重設，`manual-asm-section.js` 步驟 3b 拖三個位置檢查（拿掉修正會失敗）**；注意：本來就是空心的殼（壁 2）切開就是一圈壁的截面，那是對的；④ 設計樹的零組件列沒有「眼睛」→ 加了（`AssemblyTree.tsx`，同零件樹的 `vis-toggle`，抑制中的不顯示）；⑤ 3D 視窗右鍵沒有選單 → 加了：右鍵點零組件出與設計樹同一份選單（`ComponentMenu`，開啟零件／浮動固定／隱藏／透明／抑制／刪除；`viewer.ts` 的 `onComponentContextMenu`），右鍵拖曳（轉動零組件）結束時不跳選單（`swallowContext`），結合中（點面／邊）不出選單，H9、I10 加註機械步驟已驗、留給人走一遍；A1、D3、D8、F6、G5、I9、J、K、L 沒動（要別台電腦、別的軟體、你的樣本或你的決定）。**驗證結果**：`npm run verify:ui` 全部通過、0 個 Console 錯誤（沒有 KNOWN 了）；`npm run check` 通過（acceptance-4a、undercut-analysis 兩個計時測試只有機器忙時才會超時，單獨跑會過）。**這個階段修掉的缺陷**：C6 修復草圖（ops.ts）、C19 資料夾拖放與 moveFeature（FeatureTree.tsx、store.ts）、C26 草圖右鍵「快速抓取」選單根本出不來（viewer.ts 新增 onToolContextMenu、Viewport.tsx）、爆炸步驟清單欄寬與「剖面視圖／細部放大圖」按鈕直排字（app.css）、工程圖零件表／孔表的中文欄寬（bomTable.ts、annotation.ts，有回歸測試）、曲面本體只畫正面（viewer.ts applyDisplay 一律雙面，manual-g3.js 有檢查）。**三個待決缺陷，使用者已選建議的做法並做完**：C11 掃出折返太急 → 擋下並說明原因（packages/kernel/src/sweepFloor.ts 依 Pappus 量體積，低於 70% 拒絕；tests/phase3/sweep.test.ts）；E4 距離結合停在上限拉不離開 → 修好（solver.ts 的 blocks 對剛好在限制上的列不算，tests/phase4/advanced-mates.test.ts）；F3／F4 孔標註互相蓋住 → 面板出黃字建議改用孔表（packages/drawing/src/overlap.ts、DimensionPanel.tsx；tests/phase5/overlap.test.ts），圖面不自動改，等 K2 確認用語後再考慮自動改成只標代號。**注意**：另一個工作階段（或使用者）會在中途把工作區整批提交（commit 561d3b8 就含了我的檔案）；我不自行提交、不推送（使用者說「推」才推）。執行環境：`npm run dev` 要開著（verify:ui 沒有伺服器時會自己起）；內建瀏覽器窗格要 `resize_window 1280×720` 才能手動除錯。
- 用途：讓下一個工作階段（人或 AI）不讀對話紀錄也能接手。
- 本文件只記錄「目前狀態、待辦、下一步、工作約定」。範圍與設計以藍圖、ADR、程式碼為準；若有衝突，以它們為準並更新本文件。

## 0. 換電腦之前，先讀這裡

### 0.0 快速接手（2026-10-04，H-11 之後，換電腦先看這段）

**狀態（2026-10-09 更新）**：Phase 0 到 7 開發完成，之後的功能到 ADR 0122；`npm run check` **2482 項通過、22 項略過**；零件 Schema **52**、組合件 Schema 7、工程圖 Schema **9**。已經沒有「進行中」的里程碑，**等使用者的實機驗證結果**。鞏固 H-1 到 H-11 已做完（[hardening-plan](docs/hardening-plan.md)）。2026-10-07 使用者用選擇題決定了後續的項目，做完的與還沒做的在下面「2026-10-07 的選擇」。每個里程碑的 ADR、驗收表與限制在對應的 ADR，§3 有一行摘要。

**2026-10-07 的選擇（使用者在選擇題頁面選的；做完的都已提交並推送，ADR 在 §2 文件地圖）**
- **已做**：折彎之後才切的孔進平板型式（ADR 0113）；厚面遇尖角拒絕並說明根因（ADR 0112）；曲面互相修剪補測自由曲面（ADR 0109 的補充，沒有發現問題）；折過的基材上的凸緣的平板型式（ADR 0114）；3D 視窗顯示展開的狀態（ADR 0115）；`make:kit` 加了新功能的範例檔（`曲面/`、`鈑金/` 的互相修剪、厚面兩側、斜接、中間折彎、折過基材加凸緣、折彎後的孔；**使用者要再跑一次 `npm run make:kit`**，手冊的步驟已寫「範例檔」）；刪除舊分支 `spike/occt-gaps`（已與 main 合併）。
- **選了但前提已經過時**：「摺邊的最小半徑規則」——ADR 0093 已決定摺邊不參加最小半徑檢查，沒有摺邊專屬規則（沒有可靠的數值，等工廠的規定）；§8 Phase 7 C 的那句舊話已更正。**要做就要先有工廠的數值。**
- **選「先不做」或「等回饋」**：圓角與導角的其餘功能（變數半徑、選特徵與迴路、不相鄰面的面圓角、兩側不平行的完整圓角）；工程圖號球與表格拖曳（等 F 章驗證）；以曲面除料的任意向量方向；下一個大功能（組態與設計表格、由上而下設計、IGES、腳本 API）——**驗證到 H 章再選**；桌面版圖示、自動更新、簽章——**驗證結束重建安裝檔時一起處理**。
- **SW 原生檔（使用者沒有 SolidWorks，2026-10-07 再次強調：不要要求他使用 SW）**：決定在 blueprint §1；輸出原生檔放棄；輸入靠別人給的 STEP。我曾寫過在 SW 裡跑的批次轉 STEP 巨集，使用者說不需要，已刪除。找到兩個開源專案：openswx（MIT，只讀屬性與組合件零件參照，沒有幾何）與 open-sld-to-step（Apache-2.0，NIST 比對面只吻合約 52%）；要不要用它們評估，等使用者決定（他手上的 `.SLDASM` 樣本放在 `<使用者資料夾>\Downloads\SW樣本`）。
- **2026-10-07 的清理（使用者用選擇題決定）**：個人路徑換成 `<使用者資料夾>`、`<檢出路徑>`（git 歷史裡仍有舊的）；`sync.ffs_db` 進 `.gitignore`；`tests/e2e/phase2-assembly.js` 的 STEP 路徑改由檔案位置推出；死碼與無效資源只列清單（`docs/cleanup-candidates.md`），使用者勾選後才刪（已刪 `conjugate`、`DOWEL_STANDARD_SOURCE` 與 17 個沒被引用的文字鍵；其餘保留）；文件只對齊現有的，不新建 DEV_LOG.md 與 wiki/；**重新打包等實機驗證做完才做，形式選安裝檔（NSIS）**（已於 2026-10-09 重打：桌面版 0.2.0；舊的 0.1.0 安裝檔已刪）；推送要使用者說「推」才推。

**換電腦（本專案要能在不同電腦開發，下面都是每台電腦自己的事，程式與文件不依賴任何一台）**：`git pull`（私人專案）→ **`npm run doctor`**（唯讀診斷：Node、git、`node_modules` 的工作區連結是否指向這個資料夾、這個磁碟能不能做連結、埠 5391、Rust 與 C++ 工具；每個問題都附修法）→ 有問題照它說的做（多半是 `npm install`）→ `npm run check`（應全過）→ `npm run dev`。**只用網頁版不需要 Rust 與 MSVC**；要建桌面版才裝（`apps/desktop/README.md` 的「需要」）。

**在另一台電腦繼續「實機驗證」（2026-10-05 起的任務，照這個順序做）**
- **進度（2026-10-06，使用者在 `D:\Self-developed_Apps\G3\3D-Builder` 這台做完 C5）**：[docs/manual-verification.html](docs/manual-verification.html) 的 84 項，**P1 到 P3、B1、C1、C2、C3、C4、C5 通過**（共 9 項；B1 與 P 系列是 10-05 在 先前使用的那台電腦做的）；**下一個是 C6**，接著 C7 到 C22，再 D、E、F、G、H、I（標「必做」的優先，「需樣本」「需你決定」的先不做）。狀態存在使用者的瀏覽器 localStorage，**不會跟著 git 換電腦**：換電腦後手冊會全部顯示「未做」，請照這一行把上面已通過的項目在手冊裡選「通過」（或直接從 C6 開始，不必補），做完一個段落按「複製結果」貼給 Claude。
- **手冊改寫（2026-10-06，使用者說「怎麼做」很不清楚，要小白也看得懂）**：[manual-verification.html](docs/manual-verification.html) 的 C1 到 I10 已改寫成「先準備＋一步一個動作＋每步下面『→』接預期畫面」，最前面加了「先看這裡」（畫面怎麼認、滑鼠鍵盤、共用做法 A 到 H、名詞表）；A、B、J、K、L 與 0 章維持原樣。寫的時候每個按鈕與欄位名稱都對過動作清單與 `packages/i18n/src/zh-TW`，C1、C6、C8、G1、鈑金（基材凸緣、邊線凸緣、摺邊、平板型式）、薄殼盒與三個塑膠分析在內建瀏覽器實際走過，數字對得上。**走的時候發現而寫進手冊的事實**：編輯草圖時「方程式」「檔案屬性」是灰的；過多定義用手做不出來（尺寸工具會把多的尺寸變成從動尺寸）；間隙要調「間隙容差」才看得到；分割線的圓要整個落在面內；鈑金用上基準面做時預設值（板厚 1.5、半徑 1.5、K 0.5）直接可用。**沒有預跑、手冊標「選做，沒有預跑」的**：旋轉的薄件、掃出的空心管／弧形路徑／錯誤情境、疊層拉伸除料與方形對圓形、肋材階梯板、相切基準面、拔模（塑膠）、卡榫與窗、排氣口、曲面的延伸／修剪／縫織／填補、量規表以外的鈑金檢查（孔到折彎）；組合件與工程圖的步驟（D、E、F）依程式的面板與腳本寫成，沒有在真正的資料夾選擇視窗走過。這次也修了一個顯示問題：「成形至本體」把本體接起來之後，面板誤顯示「（遺失參考）」（`PropertyManager.tsx` 的 `EndRef`，改成看特徵自己的報告）。
- **2026-10-06 的進度（C1 到 C5 的發現，都已處理並提交）**：
  - **手冊**：C1 的步驟做不下去（編輯草圖時「方程式」「檔案屬性」是灰的），改成離開草圖後用方程式視窗的「草圖尺寸」表改；C3 的「診斷報告」要**雙擊**「輸入1」才看得到（單擊只是選取）；C5 與 C6 的「先準備」改成逐步寫；手冊「先看這裡」補了：單擊與雙擊、沒有關閉檔案按鈕（用「新零件」）、復原按鈕在哪、草圖吸附現況。
  - **程式**：① **復原／重做變成每個分頁都看得到的按鈕**（原本只在特徵與組合件分頁，藏在 40 個按鈕的最尾端，`CommandBar.tsx`）；② **設計樹的本體列縮排**在「實體(N)」底下；③ 「成形至本體」把本體接起來後不再誤顯示「（遺失參考）」；④ **偏移圖元、鏡射圖元、幾何建構線沒選取就按**，左邊面板最上方會顯示提示（`ControllerView.message`），原本只在最下方狀態列閃一行。
  - **待決定的新功能**：草圖吸附與推斷（虛線對齊線、吸附到模型的邊與頂點、快速抓取）——[sketch-snapping-plan.md](docs/sketch-snapping-plan.md)，依 SW 2010 繁中說明寫成，使用者決定 C 章走完再排優先序。**後面的草圖項目（C6、C7）若因為沒有吸附而做不下去，請告訴使用者並評估提前做 S-2。**
  - **這台的開發伺服器**：Claude 桌面版的預覽會定時停掉它，所以後來改用獨立的背景程式（`Start-Process npm.cmd run dev -w @3db/web`）；換電腦後在新電腦開自己的終端機執行 `npm run dev` 即可。
- **步驟**：① `git pull` → `npm run doctor` → 有問題照它說的做（多半是 `npm install`）→ `npm run check`（應 **2370 項通過、22 項略過**；`undercut-analysis` 的 4 秒門檻與 4a 驗收在機器忙時可能失敗，單獨跑會過）。② **產生驗證用的檔案**：它們在版本庫之外，每台電腦要自己產生。PowerShell：`$env:KIT_OUT = 'C:\3DB實機確認'; npm run make:kit`（沒設 `KIT_OUT` 時寫到 `D:\3DB實機確認`，這個磁碟不存在就會失敗；清單 P2 說的 4 個檔案就在這個資料夾的根目錄，另有夾具組、塑膠件、鈑金、`STEP替身/`、`輸出/`）。PDF 的中文要這台有 `C:\Windows\Fonts\msjh.ttc`，沒有時 PDF 的中文是 `?`。③ `npm run dev`，用 **Edge 或 Chrome** 開 http://127.0.0.1:5391（要用瀏覽器的檔案系統存取）；在**同一個瀏覽器**直接開 `docs/manual-verification.html`（檔案路徑）填寫。④ 做完（或做到一半要換電腦）按頁面上方的「複製結果」，**把文字貼進對話**：狀態與備註只存在那個瀏覽器的 localStorage，不跨電腦、不進 git。⑤ 對 Claude 說：「讀取 handoff.md，接手實機驗證」。
- **B1 的發現（2026-10-05，已處理）**：① 原點預設是顯示、三個基準面隱藏（程式照設計，與 SW 一致），清單原本寫錯，已改。② 「關掉再開」的做法清單沒寫，已補（儲存檔案 → 新零件 → 開啟舊檔）。③ 清單說「刪掉伸長」會讓圓角的邊遺失參考，實際只會得到「圓角之前沒有本體」，沒有「改用最接近的」；這個功能用 `tests/phase1/repair.test.ts` 與瀏覽器裡的腳本驗過（按下後體積 991.416 mm³），清單的這一步標為略過。④ 在設計樹按右鍵會出瀏覽器的原生選單：根因是程式選單本身、原點與基準面列、「實體」列、空白處都沒有攔右鍵，右鍵落在開著的程式選單上時原生選單蓋上來（擴充功能不是原因，InPrivate 視窗一樣）；修法是整個頁面統一攔下，只放過文字輸入（`apps/web/src/nativeMenu.ts`，`tests/phase8/native-menu.test.ts`），使用者確認連按右鍵不再出現。
- **預跑（2026-10-05，使用者要求「驗證速度太慢」之後）**：39 項必做裡，有 `tests/e2e/` 瀏覽器腳本的項目（C2 到 I8）全部在內建瀏覽器（視窗 1280×720）跑過，都過；C1 方程式用頁面手動走過。每一項的結果與「腳本沒涵蓋」的步驟寫在清單的「預跑」一行；H9、I10 是真人走一遍，沒有預跑。預跑時修了 6 個過時的腳本（`phase3-shell`、`phase3-subassembly`、`phase3-step-import`、`phase3-component-pattern`、`phase5-dimensions`、`phase5-views`，加 `phase2-assembly.js` 的 `H.decodeStep`；原因：STEP 輸出回傳 `{text}`、名稱改成 `\X2\` 逃脫碼、孔標註帶「貫穿」、剖面避開被佔住的一側、薄殼多了提示列）；清單修了檔案名稱（D1 的次組合件要由 `金樣夾具_巢狀.step` 匯入得到 `工位.3dba`）、D4 的數量、C2 的體積、D2 的按鈕名稱、F1 的路徑。**預跑不能代替人**：腳本驗的是功能與數字，視覺、手感、原生對話框、外部軟體仍要使用者做。跑這些腳本的做法：每支在剛載入的頁面 `await import('/@fs/F:/…/tests/e2e/<檔>.js?'+Date.now())` 再呼叫它的 `run()`；上一支沒收尾會留下自動存檔副本，下一次載入會跳出「找到沒有儲存的零件」，要按「捨棄」。
- **驗證檔案的位置**：這台放在版本庫根目錄的 `3DB實機確認/`（已加進 `.gitignore`，不會被提交）；`make:kit` 的 `KIT_OUT` 可以指到這裡。
- **Claude 接手時**：使用者貼回結果後，逐項判讀；有問題的按 PDCA 修（先給計畫與量化驗收，修完 `npm run check` 全過、更新 ADR 與本文件、使用者同意才提交與推送）；修好的在重新產生的驗證檔案上再確認。**eDrawings 檢查不必重做**（0b 已做完）。**桌面版安裝檔等驗證結束再重建一次**（要 Rust 與 MSVC，`npm run doctor` 會說這台有沒有）。
- **這些替身不是真實 SolidWorks 檔案**：J 章（真實零件、組合件 STEP、沖壓件、塑膠件與 SW 分析對照、鈑金平板型式對照）仍要使用者提供樣本，`SW_SAMPLE_DIR` 沒設時相關測試略過。

**下一步（建議順序）**
0. **驗證用的檔案（2026-10-05）**：`npm run make:kit` 產生 `D:\3DB實機確認`（可用環境變數 `KIT_OUT` 改位置）：金樣零件、夾具組、15 個零組件的金樣組合件、塑膠外殼與蓋、鈑金支架、STEP 替身，另有 `輸出/`（每個零件與夾具組合件的 STEP、基板加工圖的 DXF 與 PDF、支架的平板型式 DXF）與 `輸出/看圖清單.md`（用 eDrawings 或 CAD 開時每個檔案要看什麼、核心算的數字）。這些是程式自己做的替身，**不是真實的 SolidWorks 檔案**，不能代替 J 章。產生器在 `tests/kit/`，不在 `npm test` 裡；金樣定義是從驗收測試複製的（它們沒有匯出），驗收測試改了要跟著改。**程式啟動時現在是空白零件**（原本開示範件），示範件是「檔案 → 新示範件」；桌面版安裝檔**還沒用這個改動重建**，等實機驗證完再一次打（`npm run build -w @3db/desktop`）。用 eDrawings 開 `輸出/` 的檔案的檢查**已在 2026-10-05 做完**（結果在 0b），不必重做。
0b. **eDrawings 驗證的結果與待決定（2026-10-05）**：用 eDrawings 2026 逐一開 `輸出/` 與 `STEP替身/` 的檔案（形狀、孔、圓角、凸緣、組合件位置都對；細節在 `看圖清單.md`）。已修：STEP 的中文名稱原本寫成原始 UTF-8，eDrawings 讀成亂碼，現在寫成 `\X2\…\X0\`（`kernel/src/stepText.ts`）；剖面視圖的那一側被別的視圖佔住時（第一角的上視圖正好在前視的下方）改放到母視圖的旁邊，原本兩者疊在一起（`layout.ts`）。**使用者決定之後再處理（已記錄、未做；2026-10-05 使用者對 (a)、(b) 的決定是「不處理」，除非日後有需要）**：(a) 巢狀組合件（`金樣夾具_巢狀.step`）的子組合件名稱「工位」在 eDrawings 的零件樹仍是亂碼，檔案內容合法、我們自己的讀取器讀得回，原因不明（平的組合件與單件都正常）；(b) 工程圖 DXF 在 eDrawings 裡 `×` 與中文顯示成 `?`（標題圖塊、孔表標題、「貫穿」；Ø 正常），不知道是 eDrawings 的字型還是 DXF 的文字寫法；(c) 平板型式 DXF 的折彎註記「UP 135° R2」是上下顛倒的（文字方向跟著折彎線的方向）；(d) 「量測」在 eDrawings 沒量出數值、STEP 沒有質量特性，所以尺寸只用像素比例目視核對，沒有精確比對。PDF 沒用 eDrawings 看（它不開 PDF），要用 Chrome。
1. **使用者的實機驗證**：[docs/manual-verification.html](docs/manual-verification.html)（85 項，每項有步驟、預期結果、回報格式；做完按「複製結果」貼回來）。這是現在最大的缺口：3a、3b、4a、4b、5、6、7 的閘門都只是「有條件通過」。
2. **真實樣本**（卡在使用者提供）：3 個真實 SW 零件（3a-10）、保留結構的組合件 STEP（3b-7 B 段）、真實夾具案例（4a）、真實沖壓件或塑膠件（4b）、真實塑膠件與 SW 分析對照（6）、真實鈑金與 SW 平板型式對照（7）；用到它們的測試靠環境變數 `SW_SAMPLE_DIR`，沒設就略過。
3. **要使用者許可才能動的**：刪檔（全域規則）。目前沒有待決定的（`%LOCALAPPDATA%` 下桌面版的使用者資料夾 `app.3dbuilder.desktop` 已在 2026-10-04 經使用者許可刪除；它是 WebView2 的網頁暫存與自動存檔的還原副本，之後執行桌面版會重新產生）。
4. **要使用者決定的下一個功能**（§8 與清單的 K4）：**草圖吸附與推斷（參照 SolidWorks）**：吸附到模型的邊與頂點、虛線對齊線、快速抓取。2026-10-06 手動驗證 C3 時使用者提出並要求規劃；**計畫與驗收在 [docs/sketch-snapping-plan.md](docs/sketch-snapping-plan.md)**（SW 的行為已依 SW 2010 繁中說明寫進計畫（推斷、14 種草圖抓取、快速抓取）；里程碑 S-0 到 S-5：S-0 請使用者用 SW 確認說明沒寫的 4 件事，S-2 吸附到模型幾何最有感，S-1 水平／垂直推斷虛線）；藍圖目錄 D5.3a 到 D5.3c；手冊 K4 有勾選項。使用者決定 C 章走完再排優先序，現在不做；Phase 7 的凸折、斷開角落、長圓與撕裂離隙、折過的基材上的凸緣的平板型式、平板型式進工程圖；卡榫「鉤下面的窗」做成選項；檢具的曲面相互修剪；工程圖的螺紋孔標註、角度尺寸、DXF 的 DIMENSION 圖元；桌面版自動更新與簽章；（次組合件內部的干涉檢查已做：干涉檢查視窗的「也檢查子組合件裡面的零件」，手冊 D7，`__interference.within`。）
4a. **草圖吸附（2026-10-06，已完成 S-1 到 S-4）**：水平點／垂直點虛線、共線／平行／垂直推斷、吸附模型的邊與頂點、交點、四分之一點、切點、垂足、網格、角度、Shift 長度、系統選項的「草圖抓取」開關與右鍵的「快速抓取」；[sketch-snapping-plan](docs/sketch-snapping-plan.md)、[ADR 0099](docs/adr/0099-sketch-snapping.md)；手冊 C26 與 K4。**剩下 S-5**：使用者在 SW 與本程式各做同一張草圖，描述差異。
4b. **說明系統（2026-10-06，未提交）**：使用者要求比照 SW 的說明按鈕，且基於 SSOT（驗證後修正，說明跟著改）。已實作 H-A：說明文字只在 i18n 目錄 `help.<主題>.*`（[help.ts](packages/i18n/src/zh-TW/help.ts)），主題 id = `ACTIONS` 的 id（草圖工具 `tool-<tool>`）或 `concept.*`；工具提示、說明窗（功能列「說明」或 F1，依目前的工具／特徵／草圖開對的主題，有搜尋與目錄）、「這是什麼？」（點任何帶 `data-help` 的按鈕或面板）都讀同一份。**防漏**：`tests/phase8/help.test.ts` 在新增動作或草圖工具卻沒有一句話時失敗；[docs/help-links.json](docs/help-links.json) 記每個手冊項目驗證哪些主題。**工作約定（加進 §7）：加指令必須同時加 `help.<id>.summary`；手冊項目標「有問題」並修好時，依 help-links.json 同步改對應主題的文字。** 計畫與驗收見 [help-plan.md](docs/help-plan.md)；待補：其餘主題的內文（H-B）、英文（H-D）、手冊項目下顯示對應主題（H-C）。
4c. **工程圖角度尺寸與下拉選單（2026-10-07，ADR 0100）**：工程圖 Schema 5 的 `angle` 尺寸（兩個面、弧半徑、補角；尺寸面板列出斜面）、手冊 F3 多一步、瀏覽器腳本 `tests/e2e/phase5-angle.js`；命令列各分頁改成下拉選單（按需展開）。同日完成：子組合件內部的干涉檢查（勾選「也檢查子組合件裡面的零件」）。說明主題內文（123 個主題裡 122 個）與手冊顯示主題（H-C）也已完成，見 [help-plan](docs/help-plan.md)（內文待使用者審稿）；**下一步**：使用者選的四組待辦已做完兩組（工程圖：ADR 0101、0102；組合件：ADR 0103 到 0105）；剩鈑金（凸折、斜接、平板型式進工程圖）與塑膠／檢具（卡榫窗選項 ADR 0107 與厚面兩側、保留曲面 ADR 0108 已做；曲面互相修剪 ADR 0109 已做；鈑金的斜接與中間折彎 ADR 0110、0111 已做）。四組待辦全部完成。
5. **圓角與導角可以選面、面圓角、完整圓角（2026-10-06，已完成）**：[fillet-by-face-plan](docs/fillet-by-face-plan.md)、[ADR 0097](docs/adr/0097-fillet-by-face-validation.md)（驗證）、[ADR 0098](docs/adr/0098-fillet-by-face.md)（實作）；手冊 C23 到 C25；UI 腳本 `tests/e2e/phase3-fillet-face.js`（`__ff.constant／chamfer／face／full`）。**沒做、日後可列**：不相鄰面之間的面圓角、兩側不平行的完整圓角、變數半徑、選特徵與迴路。

**工作約定提醒**（完整在 §7）：動手前先給計畫、量化驗收標準、反向提問；刪檔先問；限制與沒做的驗收要誠實寫出；每個里程碑更新 ADR、本文件與對應的計畫文件；推送前先確認（使用者在 H-11 要求推送前做資安與數據隱私盤點、取得許可）。

### 0.1 藍圖（已完成）

- 藍圖曾經只存在家裡電腦，從來沒進過 git，是單點故障（2026-09-30 在另一台電腦上找不到它，Phase 3 的規劃因此卡住）。
- **2026-09-30 已放進版本庫**：[docs/blueprint.md](docs/blueprint.md)（提交 `80964b6`，與原檔 SHA-256 相同）。原檔 `<使用者資料夾>\.claude\plans\solidworks-3d-solidworks-solidworks-3d-serene-crayon.md` 是同一份的舊副本；**之後只改 `docs/blueprint.md`**，不要兩邊各改。
- `.claude/plans/` 裡沒有這個專案的其他計畫檔。
- 藍圖有幾處技術描述已過時，範圍不受影響：OCCT 7.9.x（實際是 libcascade 3.0.2 的 OCCT 8.0.1）、pnpm（實際是 npm workspaces）、「現況為空目錄」。
- §11 是藍圖遺失時用的備援摘要；現在藍圖在版本庫，有衝突時以藍圖為準。

### 0.2 接手藍圖之後的工作

1. §2 文件地圖的藍圖那一列已改成 [docs/blueprint.md](docs/blueprint.md)。
2. **Phase 3 的里程碑與驗收標準**：[docs/phase3-plan.md](docs/phase3-plan.md)。§6 的決定 1–6 使用者都已決定（2026-09-30）；**§5 的驗收數值（對稱差體積 < 1e-6 等）是我的建議值，使用者暫時認定為 Pass（2026-10-01）**：先照做，3a-10 之前若樣本顯示不合理再調整。3a-0、3a-pre、3a-i18n、3a-1、3a-2、3a-3 已完成並推送；3a-4 草圖工具 P1 分 4a 繪圖與編輯工具（已實作）、4b 限制條件與從動尺寸（已實作，Schema 11）、4c 衝突診斷、草圖檢查與輪廓選取（已實作，Schema 12）、4d 跟著模型走的參考圖元與「貫穿」（已實作，Schema 13）；3a-4 完成。3a-5 特徵 I（5a 伸長／旋轉 P1、5b 薄殼、5c 拔模）與 3a-6 特徵 II（6a 異型孔、6b 掃出、6c 疊層拉伸、6d 肋材）也已完成並推送；**下一個是 3a-7 參考幾何與複製排列**（phase3-plan §3），已確認分 7a 參考幾何、7b 直線與環狀複製排列、7c 鏡射，**都已實作**，見 §10。3a-8 材質、屬性與輸出（8a/8b/8c）也已實作；3a-9 分 9a／9b／9c，9a、9b 已實作，9c-1 檢視（顯示類型、視角選擇方塊、剖面）已實作（ADR 0042），9c-2 選取（濾器、選擇其他、迴圈與相切、BVH）已實作（ADR 0043），9c-3 系統選項與英文（ADR 0044）已實作，**3a-9 全部做完**；3a-10 驗收的工具與不需樣本的部分已完成（ADR 0045）；**需要使用者 3 個真實零件的部分，使用者於 2026-10-02 決定先跳過**（3a 閘門因此是「有條件通過」：自動化全過，真實零件的對照與實機點選驗收未做；樣本到手時用 `tests/support/acceptance.ts` 補做）。組合件介面的 183 行中文還沒搬。

### 0.3 不在版本庫、只存在某台電腦的東西

| 東西 | 在哪裡 | 換電腦時 |
|---|---|---|
| ~~藍圖~~ | 已在版本庫 `docs/blueprint.md`（0.1） | 不用做什麼 |
| 使用者的全域規則 `CLAUDE.md`（SkillsBuilder 開發標準、反向提問、智囊團審查、檔案刪除保護） | 每台電腦各自的 `C:\Users\<使用者>\.claude\CLAUDE.md` | 從舊電腦複製，或依那份檔案最後一行的說明執行 SkillsBuilder 的 `INSTALL.ps1 -Global`。沒有它，§7 的工作約定不會自動生效 |
| 桌面版的建置環境（Rust 1.99、rustup、VS 2022 Build Tools 的 C++ 工作負載、`@tauri-apps/cli`） | **每台電腦各自裝**（`npm run doctor` 會說這台有沒有）：Rust（`winget install Rustlang.Rustup`，在 `%USERPROFILE%\.cargo\bin`，新終端機要把它加進 PATH）；C++ 編譯器 VS Build Tools（2022 或 2026 都行，MSVC 14.44 與 14.50 都有人用過，Tauri 認得；若 winget 對 2022 版說「已安裝」卻失敗，是有一個不完整的舊實例，改用 `setup.exe modify` 補 C++ 工作負載，或直接用已有的 2026 版）與 Windows SDK。2026-10-04 在先前使用的那台電腦裝好並用 Phase 4a–7 的程式重建了安裝檔（安裝檔在 `target/`，不在版本庫，各電腦自己建）；`node_modules` 之外都不在版本庫 | 新電腦要建桌面版：照 `apps/desktop/README.md` 的「需要」裝；只用網頁版不需要 |
| SolidWorks 樣本（專有檔案，不進版本庫） | `<使用者資料夾>\Downloads\SW樣本`：`T1405001.SLDASM`、兩個單一實體的 STEP | 看 §8 第 1 項；用到它的測試靠環境變數 `SW_SAMPLE_DIR`，沒設就略過 |
| 實機測試用的專案資料夾 | `<使用者資料夾>\Downloads\3DB實機確認` | 只是金樣零件的複本，可從 `tests/golden/` 重建（三個檔案：`定位板.3dbx`、`V型塊.3dbx`、`零件\削邊銷.3dbx`） |
| 對話紀錄與 Claude 的記憶 | 各電腦本機，不同步 | 沒有：**本文件是唯一的交接** |
| `node_modules` | 各電腦自己 `npm install` | 見 0.4 |

### 0.4 在新電腦接手

1. 安裝 Node（開發用 26）與 git。
2. `git clone https://github.com/Chun-Chieh-Chang/3D-Builder`（私人專案，需要 GitHub 登入）。
3. **專案要放在支援符號連結的磁碟**（NTFS，例如 `C:`），不要放在 exFAT 或 FAT 的 USB 隨身碟：npm workspaces 靠符號連結，在 USB 上 `node_modules/@3db` 是空的，`npm run check`、`npm run dev`、`npm run build` 都會失敗（另一台電腦就是這樣，繞法見 §6「工作區連結」）。
4. `npm run doctor`（診斷這台電腦；搬過專案或換過磁碟代號時，`node_modules` 裡的連結是絕對路徑，會指到不存在的地方，它會說，修法是 `npm install`），然後 `npm run check`（型別、分層、全部測試，應全過），`npm run dev`，用 Chrome 或 Edge 開 http://127.0.0.1:5391。
5. 行尾：`.gitattributes` 規定文字檔一律以 LF 存、LF 檢出，不管這台電腦的 `core.autocrlf`；若隨身碟帶來的工作檔是 CRLF，`git status` 不會因此變髒，提交時也會自動轉成 LF。
6. 確認 `docs/blueprint.md` 在；不在的話，先 `git pull`。
7. 對 Claude 說：「讀取 handoff.md，接手開發任務」。

## 1. 專案

類 SolidWorks（下稱 SW）的參數式 3D CAD：

- Web 先行，一人 + AI 開發。
- 對標 SW 早期的基礎建模能力，之後延伸到夾治具 → 工程圖 → 塑膠件 → 鈑金。
- 模具不做。

## 2. 文件地圖

每份文件各管一件事：

| 文件 | 內容 |
|---|---|
| [藍圖 docs/blueprint.md](docs/blueprint.md) | 範圍、架構、階段與驗收標準。範圍以附錄 C 目錄與 §3 階段規則為準（§0.1）。備援摘要：§11 |
| [README.md](README.md) | 快速開始、套件結構 |
| [ADR 0001](docs/adr/0001-ssot-mece-rules.md) | SSOT/MECE 程式碼守則，各套件擁有的目錄 ID |
| [ADR 0002](docs/adr/0002-phase0-kernel-and-solvers.md) | Phase 0 的求解器決策、持久命名文法 |
| [ADR 0003](docs/adr/0003-occt-binding-gaps.md) | OCCT 綁定缺口驗證，改用 libcascade 3.0.2 |
| [ADR 0004](docs/adr/0004-sketch-editing.md) | 草圖編輯：可讀且不重用的 ID、Schema v2、拖曳、逐圖元狀態、端點相切、推斷規則 |
| [ADR 0005](docs/adr/0005-features-and-booleans.md) | 特徵與布林：布林後的命名、合併共面、分割面的解析、終止型態、旋轉、導角、模型平面上的草圖、Schema v3 |
| [ADR 0006](docs/adr/0006-feature-tree-operations.md) | 設計樹操作：連帶抑制、刪除與相依、指紋解析的警告、錯誤為何、雙向選取同步、回溯選單 |
| [ADR 0007](docs/adr/0007-reference-planes.md) | 基準面：Schema v4、基準面參考的命名、框架規則、頂點持久命名、拾取優先順序、圖面顯示 |
| [ADR 0008](docs/adr/0008-part-file.md) | 零件檔 `.3dbx`：ZIP 內容、自寫 ZIP、固定輸出、輸入資料以雜湊命名、舊檔相容、本機檔案、已修改標記 |
| [ADR 0009](docs/adr/0009-step-import.md) | STEP 輸入：Schema v5、只在需要時修復、輸入面的命名與金樣、讀取快取、兩個入口 |
| [ADR 0010](docs/adr/0010-phase1-acceptance-fixes.md) | Phase 1 驗收的修正：整圈旋轉面的命名、角度尺寸量放置那一側（Schema v6）、零件名稱就是檔名 |
| [ADR 0011](docs/adr/0011-assembly-skeleton.md) | 組合件骨架：組合件文件與版本線、相對路徑的參考（不存雜湊）、專案資料夾、另存到別的資料夾時改寫路徑與復原記錄、`.3dba`、Worker 依內容快取零件 |
| [ADR 0012](docs/adr/0012-mate-solver.md) | 結合求解器：`@3db/assembly`、組合件 Schema 2（結合）、LM 從擺放位置解起、分組、依設計樹順序找衝突、自由度、支援的結合、零件的解析幾何、旋轉件平面法向的修正 |
| [ADR 0013](docs/adr/0013-mate-ui.md) | 結合的介面：Worker 求解與預覽、結合 PropertyManager、零組件上的拾取與浮出樹、設計樹的狀態與結合資料夾、錯誤為何、開始組合件、STEP 零組件 |
| [ADR 0014](docs/adr/0014-moving-and-reference-files.md) | 移動零組件與參考檔：求解器的移動目標、拖曳與數值移動、放開時寫入整組擺放位置、重新指定零件檔、找不到的檔案、零件改過後更新、開啟零件與返回組合件、記住專案資料夾 |
| [ADR 0015](docs/adr/0015-step-assembly-export.md) | STEP 組合件輸出：XCAF 單層結構、寫出圖面上的位姿、位姿由四元數與平移組成的原因、非單位四元數與讀不到的零件檔一律拒絕 |
| [ADR 0016](docs/adr/0016-component-mesh-and-load-progress.md) | 零組件的網格（容差 1‰、角度 0.5 rad，比編輯零件粗）與載入進度（階段、秒數）、沒有本體的零件檔視為錯誤、量到的時間分佈 |
| [ADR 0017](docs/adr/0017-phase3a-technical-validation.md) | Phase 3a-0 技術驗證：薄殼、拔模、掃出、疊層拉伸的演化歷史夠命名、移動面的「延伸板」做法、重算時間量測、Phase 1 遺留 P0 的盤點、成形至下一面（**驗證結果，決策待確認**） |
| [ADR 0018](docs/adr/0018-visibility-and-reference-repair.md) | 顯示/隱藏（D4.6，Schema v7 `visibility`，存進檔案）與遺失參考的修復（B4.3，`replaceRef`、候選帶指紋、「改用這個」按鈕） |
| [ADR 0019](docs/adr/0019-i18n-mechanism.md) | 多語系的機制（D9.1）：`@3db/i18n`、語意鍵加編譯期檢查的佔位、zh-TW 為來源語言、`npm run lint:i18n` 的「只減不增」基準（639 行待搬）、Worker 語言同步 |
| [phase0-verification.md](docs/phase0-verification.md) | Phase 0 驗收紀錄與 SW 人工核對步驟 |
| [phase1-verification.md](docs/phase1-verification.md) | Phase 1 驗收紀錄：三個示範零件、金樣與 TNP、驗收中發現的問題 |
| [phase3-plan.md](docs/phase3-plan.md) | Phase 3 的里程碑、驗收標準、需要的樣本與決定（決定 1–6 已確認；§5 數值暫時認定為 Pass） |
| [ADR 0050](docs/adr/0050-parts-list-and-exploded-view.md) | 零件表與爆炸視圖（3b-4，C15.16、C15.14，**組合件 Schema 5**）：`buildBom`（扁平／縮排、次組合件展開、排列與鏡射算數量、廠商／料號取自零件檔屬性）、CSV（BOM、引號）、`explosion`（步驟只存意圖，位移相加，展開／收合只是顯示，爆炸中不能動、STEP 仍是組裝位置） |
| [ADR 0051](docs/adr/0051-evaluation-tools.md) | 評估工具（3b-5，E1.1、E1.2、E2.1、E3.1，Schema 不變）：物質特性（慣性矩、主慣性矩、零件合成）、測量（精確距離、銳角、位姿與鏡射）、干涉檢查（頂層零組件、接觸不算、紅色重疊）、檢查模型幾何；7 項驗收與限制 |
| [phase4a-plan.md](docs/phase4a-plan.md) | Phase 4a 的里程碑、量化驗收（金樣）、預設假設（使用者沒有 SW 與真實工件，2026-10-03 決定先走完開發）、設計取捨與風險 |
| [phase5-plan.md](docs/phase5-plan.md) | Phase 5 工程圖的里程碑、預設假設（第一角、A3、ISO 128、PDF 中文字型內嵌）、量化驗收、風險 |
| [ADR 0068](docs/adr/0068-surface-bodies.md) | 曲面本體與核心的曲面方法（4b-1，零件 **Schema 28**）：`Kernel` 的偏移／縫織／填補／厚面／以曲面除料／投影分割（都量測間隙，0.05 mm）；曲面本體不是零件（質量、零件表、干涉、工程圖不算，STEP 當殼）；`offsetSurface` 特徵（核心；介面在 4b-3）；限制：轉 B 樣條在自由曲面邊的接合面會失敗、衍生零件與組合件顯示曲面本體還沒決定 |
| [ADR 0069](docs/adr/0069-split-line.md) | 分割線特徵（4b-2，零件 **Schema 29**）：草圖的封閉外圈沿法向投影到一個面，面被切成區域；區域面叫 `<特徵>:side:<草圖>.<圈>`、其餘保留原名，改草圖後名字不變；投影不到、面不見、草圖沒封閉都說原因；限制：沒有介面（4b-3）、線貼著週期面接縫會失敗、只投影外圈與封閉線 |
| [ADR 0070](docs/adr/0070-gauge-ui.md) | 分割線與偏移曲面的介面（4b-3）：功能區指令、PropertyManager 面板、編輯時顯示自己的結果（訊息框看得到失敗原因）、偏移曲面的量測間隙顯示（`FeatureResult.info`）、特徵自己的面不能選；限制：只用腳本驗證、視覺與畫布點選待使用者 |
| [ADR 0071](docs/adr/0071-surface-editing.md) | 縫織／填補／平坦／修剪／延伸曲面（4b-4，零件 **Schema 30**）：五個特徵與介面；縫織保留面名、結果是第一個本體；填補只有單一相鄰面的邊才相切，相切與 G0 都量測、不相切被拒；修剪＝投影分割＋保留一側（`keepFaces`）；延伸用 `BRepLib::ExtendFace`（試驗穩定，只限單一面的曲面本體）；限制：延伸限單一面、修剪只用外圈與草圖、清單是快照、只用腳本驗證 |
| [ADR 0072](docs/adr/0072-thicken-cut.md) | 厚面與以曲面除料（4b-5，零件 **Schema 31**）：厚面取代曲面本體成為實體、面名跟著模型；除料以曲面掃成刀具、曲面不變；STEP 輸出把偏移曲面轉成 B 樣條（轉換器中止時照原樣輸出並警告）；衍生本體保留曲面標記；組合件裡的曲面本體畫出來但不算零件；限制：厚面不保留曲面、除料只用平面法向、轉換後別的 CAD 讀不讀得進沒有試過 |
| [ADR 0073](docs/adr/0073-acceptance-4b.md) | Phase 4b 驗收 A 段（4b-6）：金樣工件（放樣自由曲面、含圓角的方塊，STEP 讀進來）做型面塊，間隙偏差 5e-5 mm、體積對辛普森與手算、接進 4a 夾具無干涉且塊到工件 3.000、剖面積手算；限制：**真實的沖壓件或塑膠件 STEP 待使用者**、剖面弧是折線、別的 CAD 讀 B 樣條沒試過 |
| [ADR 0074](docs/adr/0074-plastic-validation.md) | 塑膠件的技術驗證（6-0）：拔模角用**曲面本身在網格節點的法向**（網格平均法向在 5° 錐面差 0.1°、三角形法向差 0.38°、曲面法向 2e-15°）；底切＝沿拔模方向兩端的射線都被擋住（側孔壁 0%、沿拔模方向的孔 100% 可見）；厚度＝沿內法向的射線（均勻殼每面 2.000、楔形對手算、邊緣面量到整面牆高）；不等殼厚＝殼加 `moveFace`（地板 4 的盒子 19584）；唇溝＝`BRepOffsetAPI_MakeOffset` 的環（192 mm²）；發現：同一形狀的網格只做一次、暴力射線只夠小件 |
| [ADR 0075](docs/adr/0075-draft-analysis.md) | 拔模分析（6-1）：核心的 `draftAnalysis`（曲面法向在網格複本的節點上求值，每面最小與最大角、四類）、「工具」頁的分析視窗（方向、要求角度、各類面數與面積、各面角度、圖面上色）；分析不進文件、模型改了自動重算；限制：取樣只在節點、沒有連續色階與分模線、方向只有六軸與平面法向；教訓：`useStore` 的選擇器不能建新物件 |
| [ADR 0076](docs/adr/0076-undercut-analysis.md) | 底切分析（6-2）：包圍盒樹的射線（`buildBvh`/`anyHit`，對暴力法逐條相同）、核心的 `undercutAnalysis`（每個三角形一個取樣點，沿拔模方向兩端各射一條線，上方／下方／都看不到的比例，七類）、「工具」頁視窗與顏色；射線起點偏出網格容差的 0.75 倍（球赤道 5.6 mm² 的錯）；2.5 萬個三角形 0.4 秒；限制：只取三角形中心、門檻是我定的、只有一個拔模方向 |
| [ADR 0077](docs/adr/0077-thickness-analysis.md) | 厚度分析（6-3）：核心的 `thicknessAnalysis`（沿內法向射線、只算迎面的面、每面最小／**中位數**／最大、最薄最厚的地方、五類）、「工具」頁視窗與顏色（三個分析一次只開一個）；**拔模與底切共用的取樣 `forEachSample`**（每個面至少 400 個點，平的大面不再只有兩個點）；發現：邊角附近射線沿鄰牆走完全程所以最大與平均不可靠；空心球中位數誤差 0.15%、4.9 萬個三角形 0.85 秒；限制：定義與 SW 是否相同不知道、沒有連續色階、肋根的縮水風險沒做 |
| [ADR 0078](docs/adr/0078-unequal-shell.md) | 不等殼厚（6-4，零件 **Schema 32**）：薄殼的 `faceThickness`（先均勻做殼，再把由指定面長出的內側平面移動 `指定 − 壁厚`，用名稱追蹤，每步檢查位置與外包）、PropertyManager 的「壁厚不同的面」模式與清單、`setShell` 的選用參數；地板 4 的盒子 19584、加一面壁 3 是 20520；發現：地板厚過頭時 `moveFace` 回有效的本體（板長到本體外）所以要檢查外包；限制：只限平面的壁、結果在 ✔ 之後才看得到 |
| [ADR 0079](docs/adr/0079-lip-groove.md) | 唇與溝槽（6-5，零件 **Schema 33**）：`lipGroove`（平面、種類、離邊緣、寬度、高度）；核心的 `ringTool`（外輪廓向內偏移兩次的環，沿法向長出或切入，環要整個在面上否則拒絕）；面以輪廓的邊命名（外側 `side:ring.<邊>`、內側加 `~`）；環 192 mm²、唇 230.4、圓角矩形 185.13；限制：環只跟外輪廓、沒有自動的蓋子配合、`Intersection` 接合 |
| [ADR 0095](docs/adr/0095-closed-corner.md) | 封閉角落（H-6，C11.4，零件 **Schema 42**）：邊線凸緣的 `corner: {start?, end?}`（與鄰接凸緣的間隙）：折彎不變（仍由縮短躲開），折彎之後的平直段繼續長到離鄰接凸緣的內側剩這個間隙；找面向這一端並蓋住平直段中間的凸緣；平板型式的折彎窄、平直段寬；只做垂直於邊的鄰接凸緣，斜接／重疊／斷開角落沒做 |
| [ADR 0118](docs/adr/0118-dev-auto-close.md) | `npm run dev:auto`：最後一個連著的瀏覽器分頁關掉 30 秒後，開發伺服器自己結束（Schema 不變；`apps/web/dev/autoClose.ts`，`--mode autoclose`）；`npm run dev` 不變 |
| [ADR 0119](docs/adr/0119-movable-balloons-and-tables.md) | 號球與表格可以用滑鼠拖（工程圖 Schema 9：`balloonAt`；`buildScene` 回傳 `tableBoxes` 與 `balloons`；面板「號球自動排列」） |
| [ADR 0120](docs/adr/0120-relief-shapes.md) | 離隙的形狀：長圓（底端半圓）與撕裂（0.05 mm 細縫）（零件 Schema 50：`relief.shape`；平板型式共用 `relief.ts`） |
| [ADR 0121](docs/adr/0121-sheet-break-corner.md) | 鈑金斷開角落（零件 Schema 51）：獨立 `breakCorner` 特徵，凸緣自由端外角倒角或倒圓，折疊與平板型式同步 |
| [ADR 0122](docs/adr/0122-surface-cut-vector.md) | 以曲面除料的方向向量與保留側（零件 Schema 52）：任意 XYZ 向量、保留前側或後側，舊的平面方向相容 |
| [ADR 0117](docs/adr/0117-select-edges-idle.md) | 沒有在編輯時也能選邊線與頂點（Schema 不變）：`UiState.selectedElements`，Ctrl 加選；選擇濾器三個勾選平常也生效；圓角、導角、邊線凸緣、摺邊與三個曲面邊線指令開始時帶入已選的邊（預先選取） |
| [ADR 0116](docs/adr/0116-sketch-picture.md) | 草圖圖片（零件 **Schema 49**）：草圖上放 PNG／JPEG 當描圖底圖（`pictures`，資料是 `blobs/<sha>.png`／`.jpg`），不參加輪廓與關係，只在編輯那張草圖時顯示；以兩點校正比例；三個指令都能復原；eDrawings 存圖 → 描圖是沒有 SW 時的重建做法 |
| [ADR 0115](docs/adr/0115-flat-in-3d-view.md) | 在 3D 視窗顯示展開的狀態（Schema 不變）：平板型式視窗的勾選，worker 一起傳平板型式的網格，3D 視窗換成它，顯示時不能點選；沒有動畫 |
| [ADR 0114](docs/adr/0114-bent-base-flange-flat.md) | 折過的基材上的凸緣的平板型式（Schema 不變）：基材記路徑的每一段直線與它在條裡的起點，凸緣記 `host`；每一段有自己的運動，凸緣的運算沿用；六種擺法的長度與面積手算 |
| [ADR 0113](docs/adr/0113-cuts-in-flat-pattern.md) | 折彎之後才切的孔進平板型式（Schema 不變）：重算時記下基材凸緣之後各特徵拿走的材料（`SheetInfo.cuts`），平板型式用每一塊板的運動放回去；折彎裡、跨部分、折過的基材做不到的列在 `notIncluded` 並在視窗說明；孔位置與面積手算 |
| [ADR 0112](docs/adr/0112-thicken-sharp-edge.md) | 厚面遇到尖角時拒絕（Schema 不變）：根因是 OCCT 簡單厚面不在尖角算交線；用面與網格各算一次體積，差超過 0.5% 就拒絕並說明 |
| [ADR 0111](docs/adr/0111-mid-bend.md) | 中間折彎（S-3，零件 **Schema 48**）：`midBend`（草圖一條線、角度、半徑、固定側、方向）；三塊（不動、折彎區、轉的）＋剛體運動，折彎區必須是單純長條；平板型式＝原來的板加一條折彎線；限制：只對封閉輪廓的板、前後都不能有凸緣、一個零件一個、折彎區不能有孔 |
| [ADR 0110](docs/adr/0110-miter.md) | 邊線凸緣的斜接（S-2，零件 **Schema 47**）：`miter`＝兩凸緣的間隙；45° 垂直面，鄰居切回、這個凸緣延長再切回；平板型式在角落是折彎中立層的曲線（24 段）；只做兩個 90°、同半徑、材料在內、垂直相鄰的凸緣；體積與面積都對手算 |
| [ADR 0109](docs/adr/0109-mutual-trim.md) | 互相修剪曲面（P-3，零件 **Schema 46**）：`mutualTrim`（`a`、`b`、`discard`）；核心 `trimSurfaces`（一般融合＋合併同曲面的面）；片沿用原面名、分成幾片加 `#k`；點一片去掉；限制：兩個自由曲面互相相交沒測、片數變了名字可能對不上；順手記下：厚面在尖銳折彎的體積（924 vs 手算 1140）未解 |
| [ADR 0108](docs/adr/0108-thicken-both-keep.md) | 厚面的「兩側」與「保留曲面」（零件 **Schema 45**）：`both`、`keepSurface`；兩側＝偏移半厚再加厚（不做融合）；保留曲面時實體是新本體、面名前加 `copy`；限制：只有對稱、急彎曲面未測 |
| [ADR 0107](docs/adr/0107-snap-hook-window.md) | 卡榫的「鉤下面的窗」做成選項（零件 **Schema 44**）：`windowClearance`、`windowDepth`；窗從樑前面到鉤尖再加間隙、兩側加間隙，尺寸從鉤算出；底切分析確認有窗時卡面不是底切；面板勾選；限制：窗只有矩形、深度手填 |
| [ADR 0106](docs/adr/0106-flat-pattern-in-drawing.md) | 工程圖的展平圖（S-1，**工程圖 Schema 6**）：視圖方向 `flat`，worker 用 `sheet` 做 `flatPattern` 轉成視圖線（外形與孔實線、折彎線 `center` 鏈線），不能再投影或剖面（細部放大可以）、還不能標註尺寸；非鈑金件寫原因；手冊 I6；限制：沒有折彎表與註記 |
| [ADR 0105](docs/adr/0105-form-sub-assembly.md) | 形成次組合件（E-3，Schema 不變）：選的零組件與兩端都在其中的結合進新的 `.3dba`（位置取解出來的、裡面沒有固定的就固定第一個），組合件留一個代表它的零組件在原點（零件都不動）；一端在外面的結合改成通過次組合件（`path`）、爆炸步驟改名；排列／鏡射用到的拒絕；指令 `formSubAssembly` 一步復原、`FormSubPanel`、檔寫在組合件旁邊；金樣夾具手算 < 1e-6；限制：不能選資料夾、沒有解散 |
| [ADR 0104](docs/adr/0104-several-exploded-views.md) | 多組爆炸（E-2，**組合件 Schema 7**）：`explosions: ExplodeView[]`（id、名稱、步驟）與 `activeExplosion`；舊的 `explosion` 在 6 → 7 遷移成「爆炸視圖1」；既有的步驟指令作用在顯示中的那一組（沒有時建第一組）；新指令 `insertExplosion`／`renameExplosion`／`deleteExplosion`／`setActiveExplosion`；刪除零組件清掉各組的步驟；面板「爆炸視圖組」（下拉、新增、刪除、改名）；限制：只能移動頂層零組件 |
| [ADR 0103](docs/adr/0103-explode-lines-animation.md) | 爆炸線與動畫（E-1，檔案格式不變）：每個被爆炸的零組件一條深藍虛線（從組裝位置的包圍盒中心經過每個步驟之後的位置，`explosionOffsets.paths`、`leavesCentre`、`Viewer.setGuides`）；爆炸與收合半秒緩入緩出（`explodeT`、`EXPLODE_MS`，`exploded` 仍是目標）；面板「顯示爆炸線」；限制：背景分頁時動畫暫停、每段是直線 |
| [ADR 0102](docs/adr/0102-dxf-dimension-entities.md) | DXF 的 DIMENSION 圖元（D-2）：每個尺寸一個 DIMENSION＋匿名圖塊 `*D<n>`（原來的線、箭頭、字，看圖軟體照畫）；字用 `1` 蓋寫成模型算好的字；種類 線性（旋轉／對齊）、直徑、半徑、二線角度，定義點取自繪圖時算好的紙面座標；DIMSTYLE `STANDARD`；`Scene.dimensions` 與項目的 `group`（SVG／PDF 不變）；`readDxf`／`checkDxf`／`dimensionMeasure`／`drawnEntities`；**沒有真正的 CAD 開過**（手冊 F6） |
| [ADR 0101](docs/adr/0101-hole-callouts-thread-countersink.md) | 螺紋孔與錐孔的孔標註（D-1）：錐孔讀形狀（孔口的圓錐：口徑與夾角）、螺紋讀特徵（`holeFeatures`，包括衍生本體的主模型；形狀上它只是底孔）；`M6 貫穿（底孔 Ø5）`、`錐孔 Ø12 90°`；定位銷入口的導角在有特徵時不當錐孔；自動尺寸有孔標註時只併註記相同的孔；孔表同字；`孔標註.3dbx` 進驗證包；限制：螺紋深＝鑽孔深、匯入模型的導角讀成錐孔 |
| [ADR 0100](docs/adr/0100-drawing-angle-dimension.md) | 工程圖的角度尺寸（工程圖 **Schema 5**）：`angle`（兩個面或直線邊、弧半徑、補角）；夾角是從兩線交點朝各元素中間伸出的射線所夾的角；視圖特徵加 `slant`（斜面）；弧畫成折線、延伸線、箭頭；手冊 F3 加一步；同日命令列改成下拉選單（按需展開）；限制：介面只列平面、DXF 仍不是 DIMENSION 圖元 |
| [ADR 0099](docs/adr/0099-sketch-snapping.md) | 草圖吸附與推斷（S-1 到 S-4）：一個決定點 `updateSnap`、優先順序（點與中點 → 模型點 → 交點 → 四分之一點 → 切點與垂足 → 圖元上 → 模型邊 → 推斷 → 對齊 → 長度／角度／網格）、按下去加的關係、`SnapSettings`（總開關、逐項、網格與角度預設不啟用）與快速抓取；限制：沒有「平行」抓取（用推斷）、網格不畫格線 |
| [ADR 0098](docs/adr/0098-fillet-by-face.md) | 圓角與導角選面、面圓角、完整圓角（零件 **Schema 43**）：存面不存邊、每次重算展開（略過接縫、單鄰面與相切的邊）；導角距離 1 量在選的面上；面圓角＝兩組面相接的邊（不相接明確拒絕）；完整圓角用布林切除半圓柱外的條狀區域並檢查體積（中央面要長方形、側面平行且不比半徑矮）；介面的圓角種類與面組；手冊 C23 到 C25；限制：不相鄰的面圓角、兩側不平行的完整圓角、變數半徑、選特徵與迴路沒做 |
| [ADR 0097](docs/adr/0097-fillet-by-face-validation.md) | 圓角與導角選面的技術驗證（F-0，[計畫](docs/fillet-by-face-plan.md)）：對面的所有邊倒圓角的頂點是斜接（手算與 OCCT 差 2e-10）、導角距離 1 量在選的面上、`Kernel.smoothEdges` 找相切邊、完整圓角不能用兩個圓角（R=w/2 失敗、略小留細條）所以用布林切除（精確）、凹邊補料、不相鄰的面沒有做法（明確拒絕） |
| [ADR 0096](docs/adr/0096-inventory-cleanup.md) | 鞏固 H-11 全面盤點與清理：移除沒用到的 import／匯出／只寫不讀的欄位（不改行為）、handoff 與 README 對齊現況、資安與隱私盤點（私人倉庫、無金鑰）；沒有 DEV_LOG.md 與 wiki/（單一來源是 handoff＋ADR＋git log）；跨電腦開發（`npm run doctor`、行尾規則 `eol=lf`）；桌面版安裝檔已用 4a–7 重建（2026-10-04） |
| [ADR 0094](docs/adr/0094-random-tests.md) | 鞏固 H-5：種子固定的隨機零件測試（鈑金溫和 36＋嚴苛 60、鏈 24、折過的基材 24、塑膠 40、一般零件 40）檢查任意參數都必須成立的性質；找到並修了兩個真問題：自己穿過自己的鈑金輪廓做出無效實體卻說成功、螺柱的肋四片以上面名重複；限制：只證明沒找到反例，引擎仍不檢查每個特徵的結果是否有效；補充 H-9：隨機組合件（疊塊、結合位置、3 自由度、干涉體積）與隨機工程圖（視圖、剖面、標註、SVG／DXF／PDF 讀回）也通過，沒有新問題；補充 H-10：距離加齊平、銷插孔、有圓角倒角的工程圖也通過 |
| [ADR 0093](docs/adr/0093-hole-draft-hem-rule.md) | 鞏固 H-4（零件 **Schema 41**）：螺柱 `holeDraft`（孔往孔底縮小，孔徑指孔口，空白＝直孔，不遷移；「同外壁」鈕；金樣的螺柱孔 +1.000° 不再需要拔模）；`sheetChecks` 的最小半徑略過摺邊（180°），金樣九項檢查全過 |
| [ADR 0092](docs/adr/0092-naming-merge.md) | 鞏固 H-1：併面時舊面保留原名（`faceBaseName` 同種來源取索引小的，本體在前）；修好 ADR 0085 的缺口：凸緣可以以任何順序做、在板上點的邊不再因別的凸緣併面而遺失；9 項測試（三種順序、塊上兩個共面凸台、前面插入基準面、壓抑再恢復） |
| [ADR 0091](docs/adr/0091-acceptance-7.md) | Phase 7 驗收 A 段（7-8）：金樣支架（板 120 × 60 × 1.5 加兩個孔、90° 凸緣縮短加離隙、135° 凸緣、摺邊）；摺疊的體積、平板大小與面積、折彎線、DXF 讀回、檢查全對手算；K 0.4（量規）、板長 140、板厚 2 全部跟著；找到：摺邊的內側半徑 0.5 在起始比例下不過檢查、相鄰邊的凸緣要手動縮短 |
| [ADR 0090](docs/adr/0090-gauge-checks.md) | 量規表與可製造性檢查（7-7，零件 **Schema 40**）：`PartDoc.sheetGauges`（名稱、板厚、內側半徑、K；沒有預設列，套用 = 複製數字進基材凸緣，不連動）；`sheetChecks`：內側半徑、折彎後平直段、孔到折彎區、縮短沒離隙，比例在平板型式視窗裡改（預設是我的起點，不是標準），每個檢查都回報過不過；孔距 4.0／2.0／1.0 對手算；限制：孔只認圓、規則不隨材料變 |
| [ADR 0089](docs/adr/0089-flat-pattern-dxf.md) | 平板型式的 DXF（7-6）：`flatPatternDxf`（`OUTLINE` 層的真 LINE／ARC／CIRCLE、`BEND` 層的虛線折彎線加註記 `UP 90° R2`、`T=… K=…`，移到原點）；`toDxf` 多 `extras`、`readDxf`／`checkDxf` 認得 LINE／ARC／CIRCLE；平板型式視窗的「輸出 DXF」；限制：沒有用真的 CAD／CAM 開過、沒有折彎表、沒有進工程圖 |
| [ADR 0088](docs/adr/0088-flat-pattern.md) | 平板型式（7-5，檔案格式不變）：`flatPattern(kernel, sheet)` 從折彎資料算（不展開實體）：基材放著、每個凸緣用剛體運動（折彎轉回去 + 移一個裕度）接在長出它的那一片上，核心做一片薄實體，輪廓與折彎線從它讀；127.3197 長（90° 凸緣）、摺邊 111.927、45° 129.2604、U 形槽展開 94.639 × 40；K 0.5 體積守恆；視窗（SVG、尺寸、折彎表）；限制：折過的基材上的凸緣沒做、沒有 3D 視圖的展開切換 |
| [ADR 0087](docs/adr/0087-insets-reliefs.md) | 凸緣縮短與離隙（7-4，零件 **Schema 39**）：邊線凸緣與摺邊的 `inset`（兩端各縮短，起端 = 面在前方外側在右手時開始的那端）與 `relief`（縮短處旁的矩形缺口）；相鄰邊的凸緣在角落留縫不再相貼；缺口 11.25 mm³ 對手算；限制：沒有封閉／斷開角落、離隙只有矩形、自動離隙要手填 |
| [ADR 0086](docs/adr/0086-hem.md) | 摺邊（7-3，零件 **Schema 38**）：`hem`（180° 折彎、間隙 = 兩層內側面的距離、回折的平直段；閉合摺邊就是很小的間隙）；與邊線凸緣共用 `foldEdge`（7-2 測試不改全過）；間隙 1 長 10 材料在內 8394.52 mm³；**凸折（板中間）沒做**——需要切開實體並移動一半的新核心操作，邊上的凸折用兩個邊線凸緣組成；限制：沒有淚滴與捲邊 |
| [ADR 0085](docs/adr/0085-edge-flange.md) | 邊線凸緣（7-2，零件 **Schema 37**）：`edgeFlange`（點板端面的一條直邊；長度從外側／內側虛擬交點或折彎之後量、角度、半徑、材料在內或折彎在外、往另一面折）；折彎是端面斷面繞中心旋轉、凸緣是同一斷面沿切線拉伸；板切掉的與加上去的體積逐步檢查；板 100 × 50 × 1.5 90° 長 30 材料在內 9548.98 mm³、45° 外側角在虛擬交點 + 30；凸緣上的凸緣；限制：只有直邊整條寬度、併面改名使邊線參考在重排特徵後會遺失、編輯時看不到結果 |
| [ADR 0084](docs/adr/0084-base-flange.md) | 鈑金參數與基材凸緣（7-1，零件 **Schema 36**）：`baseFlange`（板厚、內側半徑、K 因子；封閉輪廓是平板、開放折線是折過的板，轉角自動倒圓：轉向板厚那邊倒 r+T、轉離倒 r，內側半徑永遠是 r）；折彎資料 `RebuildResult.sheet`（裕度 θ(r+K·T)、展開長度 = 直段 + 裕度）；U 形槽 5678.3 mm³、展開長度 94.639、K 0.5 體積守恆；功能區新增「鈑金」頁；限制：只有基材凸緣、折線只能是直線、半徑整個零件一個 |
| [ADR 0083](docs/adr/0083-sheet-metal-validation.md) | 鈑金的技術驗證（7-0）：折彎是旋轉的矩形（45°–180° 體積 θ·T·w·(r + T/2)）、板＋折彎＋凸緣一個有效實體 10073.98 mm³、K = 0.5 的體積守恆是平板長度唯一獨立的檢查、折過的輪廓一次拉伸、角落留缺口；決定特徵原生、不展開任意實體；沒有改產品程式 |
| [ADR 0082](docs/adr/0082-acceptance-6.md) | Phase 6 驗收 A 段（6-8）：金樣外殼（壁 2、底 3 為變數、拔模 1°、唇、兩個螺柱、卡榫與底窗）與蓋；體積對手算積分、拔模 ±1.000°、底切恰好 187.2 mm²（卡榫自己）、厚度 2.000／3.000、蓋進 4a 的干涉（無；缺窗時 36 mm³）；找到：卡榫站在底上是底切（要在底開窗）、螺柱的孔沒有拔模；e2e 加 `H.tidy()` |
| [ADR 0081](docs/adr/0081-snap-hook-catch-vent.md) | 卡榫、窗、排氣口（6-7，零件 **Schema 35**）：`snapHook`（懸臂樑加楔形鉤，一個截面拉出寬度）、`snapCatch`（矩形窗）、`vent`（一排槽，可圓頭）都取草圖的自由點；窗與槽共用一個方法；面以點與槽號命名（蓋面改名成 `floor`／`lid`）；窗在殼的開口方向上被底切分析找到；限制：深度手填、沒有穿過第一道壁就停、不算樑的應變 |
| [ADR 0080](docs/adr/0080-screw-boss.md) | 螺柱（6-6，零件 **Schema 34**）：`screwBoss`（草圖的自由點上各一根柱：外徑、先導孔、高度、孔深、外壁拔模、三角形肋）；柱是旋轉的截面（埋進本體 0.5 mm 以接上，沒接到本體就是錯誤）、肋是通過軸的平面上的三角形、面以點與部位命名，殼的底厚改了螺柱跟著；柱 233.656 mm³、肋對數值積分；限制：孔徑手填、只長一個方向、只有三角形肋 |
| [sketch-snapping-plan.md](docs/sketch-snapping-plan.md) | 草圖吸附與推斷（參照 SW，**已規劃、未排入開發**）：現況與缺口、SW 的行為（出處是 SW 2010 繁中說明）、做法、里程碑 S-0 到 S-5 與量化驗收、風險與預設假設 |
| [phase7-plan.md](docs/phase7-plan.md) | Phase 7 鈑金的里程碑、預設假設（K 因子 0.5、半徑 = 厚度、外側虛擬交點、特徵原生不展開實體…）、驗收、風險 |
| [phase6-plan.md](docs/phase6-plan.md) | Phase 6 塑膠件的里程碑 6-0 到 6-8、預設假設（分析不是特徵、拔模四類、底切＝兩端被擋、厚度定義、不等殼厚只限平面、卡榫是簡化版）、驗收用金樣（與手算一致，SW 對照待使用者）、風險 |
| [ADR 0067](docs/adr/0067-surface-validation.md) | 檢具曲面的技術驗證（4b-0）：偏移（誤差 1e-6 到 3e-5 mm）、縫織、填補、厚面、投影分割、以曲面除料都可行；**偏移失敗時給有效但錯的形狀，必須量測結果**；整體偏移要包成實體、厚面要檢查反向、偏移曲面輸出轉 B 樣條 |
| [phase4b-plan.md](docs/phase4b-plan.md) | Phase 4b 檢具的里程碑、預設假設（間隙檢查 0.05 mm、曲面本體不是零件…）、驗收、風險 |
| [ADR 0066](docs/adr/0066-acceptance-5.md) | Phase 5 驗收 A 段（5-6）：4a 夾具的基板加工圖（過兩個 Ø6 H7 孔的剖面 1319.5 mm²、孔表、尺寸與公差）與組合圖（零件表、四個號球），手算、DXF／PDF 讀回；改主模型後圖跟著變；修正有倒角的孔被當成盲孔 |
| [ADR 0065](docs/adr/0065-dxf-and-pdf-output.md) | DXF（AC1015，`\U+XXXX`）與 PDF（向量、Helvetica、可內嵌 TrueType 子集）輸出（5-5，F3.1、F3.2）：三種輸出同一個場景；自寫的 DXF／PDF／TrueType 讀取器與檢查；限制：**尺寸是線與文字不是 DIMENSION 圖元**、**尚未在真實 CAD 與 PDF 檢視器開過（使用者待辦）**、PDF 字型每次要重選 |
| [ADR 0064](docs/adr/0064-assembly-drawing.md) | 組合件工程圖（5-4b，C16.6，Schema 4 不變）：組合件當視圖來源（讀齊零件、解結合、去掉隱藏與參考本體）；零件表（3b-4 的 BOM 畫成表）；零件號球（質心、沿視圖外緣滑開）；「新工程圖」從開啟的組合件；限制：號球不能拖、組合件視圖沒有尺寸與孔表 |
| [ADR 0063](docs/adr/0063-annotations-and-hole-table.md) | 中心記號與中心線、孔標註、孔表（5-4a，C16.5、C16.6，**工程圖 Schema 4**）：由零件算出不存；`holeInfo`（貫穿、盲孔、深度、沉頭）；孔表（字母分組、從左下平面量起、公差等級）；限制：不看螺紋與錐形沉孔、隱藏的孔也畫中心記號 |
| [ADR 0062](docs/adr/0062-dimensions.md) | 尺寸與公差（5-3，C16.4，**工程圖 Schema 3**）：尺寸存持久名稱不存數值（零件改了跟著走）；線性／直徑／半徑；自動尺寸（總長寬、孔徑與圓弧、孔位置）；ISO 286 公差（`H7`、`m6`…，IT5–IT12、500 mm 內）；畫法（箭頭、延伸線、導線）；限制：不能在畫布點選元素、沒有角度與孔深標註 |
| [ADR 0061](docs/adr/0061-derived-drawing-views.md) | 投影、剖面與細部放大視圖（5-2，C16.3，**工程圖 Schema 2**）：視圖四種聯集（衍生視圖不存來源與視角）；投影視圖的視角與對齊；剖面線箭頭、切平面、`Kernel.sectionView`（布林切除＋HLR＋切面外框）；45° 剖面線（奇偶規則）；細部圓裁切；面板數字輸入；限制：只有單一水平或垂直剖面、沒有畫布拖曳 |
| [ADR 0060](docs/adr/0060-drawing-document-and-views.md) | 工程圖文件 `.3dbd`（5-1，C16.1、C16.2，**工程圖 Schema 1**）：只存圖頁、標題、視圖；`Kernel.projectView`（精確 HLR，被可見線蓋住的隱藏線拿掉）；`@3db/drawing`（圖頁、第一角排版、場景、SVG）；`DrawingStore` 與畫布；限制：只畫零件、沒有剖面與尺寸與 DXF／PDF |
| [ADR 0059](docs/adr/0059-acceptance-4a.md) | 4a 驗收 A 段（不需樣本）：自製方塊工件的夾具從主模型到衍生零件、圖庫的銷與螺絲結合、干涉／餘隙／取放空間、零件表、STEP 往返、改基板厚度；B 段待使用者；面上草圖的原點是零件原點的投影 |
| [ADR 0058](docs/adr/0058-clearance-and-collision.md) | 餘隙確認、取放空間與拖曳碰撞偵測（4a-5，E2.2、A3.6，Schema 不變）：精確距離、保守前進＋二分找接觸、拖曳停在接觸前並標紅、`involving` 篩選、20 零組件 4–7 ms |
| [ADR 0057](docs/adr/0057-standard-parts-library.md) | 標準件圖庫（4a-4，F6.1，Schema 不變）：新套件 `@3db/library`，內六角螺絲／定位銷／平墊圈（ISO 4762／8734／7089）用變數做成零件檔，插入面板的「標準件圖庫」；廠商 STEP＝專案資料夾；沒有螺紋 |
| [ADR 0056](docs/adr/0056-dowel-pin-holes.md) | 定位銷孔（4a-3，C4.8，**零件 Schema 27**）：異型孔第五種 `dowel`（公差等級 H6／H7／H8、入口導角）、ISO 286-1 表（`dowel.ts`）、孔以標稱直徑做出（壓入的銷不被當成干涉）、面板顯示配合 |
| [ADR 0055](docs/adr/0055-advanced-mates.md) | 進階結合（4a-2，C15.9，**組合件 Schema 6**）：寬度、相互對稱、距離／角度的限制；求解器的結合泛化成 N 個端點；限制是「超出範圍的量」的殘差（距離剛好落在界線、角度可能在界線內側）；介面的進階結合與最小／最大欄位 |
| [ADR 0054](docs/adr/0054-derived-bodies.md) | 衍生本體與從本體產生組合件（4a-1，C7.5，**零件 Schema 26**）：`derivedBody`（只存來源與本體 id）、`SourceProvider`、名稱沿用主模型、內容鍵含主模型、零件表排除參考零件；限制：不即時更新、跨零件不共用主模型重算 |
| [ADR 0053](docs/adr/0053-acceptance-3b.md) | 3b 驗收 A 段（3b-7，不需樣本）：金樣夾具 STEP → 檔案 → 再輸出，平的與巢狀；B、C 段待使用者；測試支援 `goldenJig.ts`、`stepRoundTrip.ts` |
| [ADR 0052](docs/adr/0052-desktop-shell.md) | 桌面版（3b-6，F8.1）：Tauri 2 包網頁版，`files.ts` 不改（WebView2 的選擇器可用）、NSIS、離線；驗收第 3、7 項待使用者；`useLocalToolsDir` 的坑 |
| [ADR 0049](docs/adr/0049-step-assembly-import.md) | STEP 組合件輸入（3b-3，F2.8，Schema 不變）：`Kernel.readAssemblyStep`（階層、名稱、剛體位置、零件形狀、面顏色）、`stepAssemblyPlan`／`stepAssemblyFiles`（一個產品一個檔案：`.3dba`、`組件/`、`零件/`）、「檔案」→「輸入 STEP 組合件…」（每次選資料夾，寫入模式）、組合件輸出帶面顏色、顏色往返；金樣夾具 15 個零組件匯入 129 ms |
| [ADR 0048](docs/adr/0048-component-patterns-and-mirrors.md) | 零組件的複製排列與鏡射（3b-2，**組合件 Schema 4**）：只存定義（`patterns`，可省略）、實例是衍生位姿跟著種子、方向與軸可選組合件軸或零組件的元素、鏡射件在載入時由原件算出（不另存檔，取代決定 4）、`mirroredPose`、STEP 的鏡射產品；2a–2d 都做完 |
| [ADR 0047](docs/adr/0047-rigid-sub-assemblies.md) | 剛性次組合件與零組件隱藏／抑制／透明（3b-1，**組合件 Schema 3**）：次組合件是 `.3dba` 檔的零組件、`MateRef.path` 帶路徑的參考、父層視為一個剛體、旗標是可省略欄位、`findReferenceCycle` 讀檔偵測循環；1a–1e 都做完（巢狀 STEP 輸出、帶路徑的結合、抑制／隱藏／透明） |
| [ADR 0046](docs/adr/0046-phase3b-technical-validation.md) | 3b-0 技術驗證（2026-10-02）：鏡射零組件＝鏡射零件檔加剛體位姿（面序不變，OCCT 雖寫得出 det −1 的位姿但只有它自己讀過）、干涉檢查（20 個小零件 190 對 1.0 s，包圍盒先濾 0.5 s，Worker 內按需執行）、STEP 巢狀組合件讀回的結構對應（原型→零件檔、組合件原型→次組合件、只取每層相對位姿）、桌面版只做了調查（缺 Rust 與 MSVC，等使用者決定安裝）；證據 `spikes/occt-gaps/phase3b-validation.test.ts` |
| [ADR 0045](docs/adr/0045-acceptance-3a.md) | 3a 驗收（3a-10）不需樣本的部分：`tests/support/acceptance.ts`（對稱差、與參考形狀比對、關鍵尺寸 50%–200% 掃描）、`tests/phase3/acceptance.test.ts`（工具自測、三個金樣與兩類合成零件共 15 個關鍵尺寸 × 5 值全過）；§5 逐項狀態；等使用者的 3 個零件 |
| [ADR 0044](docs/adr/0044-system-options-english.md) | 系統選項與英文（3a-9c-3，Schema 不變）：`options.ts`（localStorage `3db.options`、`parseOptions`）、`OptionsDialog`、`Autosaver.enabled/delayMs/cancel`、`packages/i18n/src/en/`（860 多個文字全翻）；零件側文字已搬，程式碼裡剩 183 行（組合件） |
| [ADR 0043](docs/adr/0043-selection.md) | 選取（3a-9c-2，Schema 不變）：`three-mesh-bvh`（indirect，一條射線 10 ms → 0.13 ms）、`pickFilter`、右鍵選單（選取其他、相切邊線／面、迴圈）、`selectionSets.ts` 的 `Topology`（由名稱＋網格，10° 門檻）、`store.pickMany` |
| [ADR 0042](docs/adr/0042-view-options.md) | 顯示類型、視角選擇方塊、剖面視圖（3a-9c-1，Schema 不變）：`DisplayMode` 五種、`Viewer.cubeMatrix`／`subscribeView`、軸向剖面（裁切平面）、`contentBounds`；透視（D4.5）未做；順便修了指令列撐寬畫面 |
| [ADR 0041](docs/adr/0041-tree-order-folders-templates-shortcuts.md) | 設計樹的順序與資料夾與註解、範本、快速鍵（3a-9b，**Schema 25**）：`arrange` 指令（整個新順序加資料夾，一個復原步驟）、`orderProblem` 由父子關係檢查、拖放、資料夾要連續、註解／標籤／過濾、重新命名、`createPartFromTemplate`、`shortcuts.ts`（localStorage 覆寫） |
| [ADR 0040](docs/adr/0040-autosave-and-text-tools.md) | 自動存檔與當機復原（3a-9a）：存零件檔位元組進 IndexedDB、最後一次變更後 5 秒、頁面藏起來立刻存、下次開啟問復原或捨棄；`scripts/3dbx.mjs`（cat／unpack／pack）與 `npm run setup:git` 讓 `git diff` 看得到 `.3dbx` 裡的文字；B3.2／B3.4 量過不需要（53 個特徵 0.85 秒） |
| [ADR 0039](docs/adr/0039-output.md) | 輸出（3a-8c）：自寫二進位 STL（用文件設定的網格品質）、STEP 先問選項（AP214／AP242、顏色、座標系統）、座標系統當輸出座標系（`intoFrame`）、影像輸出（PNG）、AP242 設定要等第一個寫入器做出來才存在的陷阱 |
| [ADR 0038](docs/adr/0038-appearance.md) | 外觀與顏色（3a-8b）：零件／本體／特徵／面四種對象與優先序、`faceColors` 一處算出畫面與 STEP 用的顏色、STEP 面色以 sRGB 寫入、參考本體不輸出 |
| [ADR 0037](docs/adr/0037-material-and-settings.md) | 材質、質量與文件設定（3a-8a，**Schema 24**）：材質存名稱與密度（內建表複製進文件）、質量＝體積×密度、製圖標準／尺寸小數位數／顯示與輸出品質 |
| [ADR 0036](docs/adr/0036-mirror.md) | 鏡射（3a-7c，**Schema 23**）：`mirror` 特徵（對象是特徵或本體）、特徵的鏡射就是只有一個實例的排列（共用 `repeat`）、本體鏡射走既有的 `apply`（合併或獨立本體）、面名稱 `<鏡射>:mirror:<原名>`、鏡射面是任何平面、3a-7 驗收標準逐項 |
| [ADR 0035](docs/adr/0035-patterns.md) | 線性與環狀複製排列（3a-7b，**Schema 22**）：排列的是種子特徵對本體加上與移除的材料（幾何圖樣：之前與之後的本體相減）、實例的面名稱 `<排列>:inst<標籤>:<原名>`、`count` 型別的運算式、`Kernel.transformed`（3 × 4 矩陣）、要跳過的實例、三種可讀的錯誤（沒碰到本體、成了分開的一塊、互相重疊） |
| [ADR 0034](docs/adr/0034-reference-geometry.md) | 參考幾何（3a-7a，**Schema 21**）：基準面的平行／垂直／中間／相切、`refAxis` 基準軸、`refPoint` 參考點、`coordSys` 座標系統（永遠右手系）；`kind: 'datum'` 的參考指向基準特徵 ID；`defRefs`／`mapDefRefs` 一處管所有定義的參考；選取方塊的一張表 `datumSlots.ts`；屬性管理員的基準按鈕（開著屬性管理員時設計樹被蓋住）；圖面顯示 |
| [ADR 0033](docs/adr/0033-rib.md) | 肋材（3a-6d，**Schema 20**）：`rib` 特徵（草圖裡一條直線＋厚度＋厚度的位置＋反轉）、牆在草圖面內垂直於線長到本體（既有的「伸長至本體」加接合）、不自動選方向而是說明要反轉、面名稱 `<肋材>:side:<草圖>.<線>.neg／pos／end1／end2` 與 `cap:start` |
| [ADR 0032](docs/adr/0032-loft.md) | 疊層拉伸（3a-6c，**Schema 19**）：`loft` 特徵（截面草圖依序，每張一個封閉輪廓、沒有洞）、`ThruSections` 平滑通過（兩個截面時是直紋，不提供直紋選項與原因）、截面對齊交給 OCCT、面用第一個截面的邊命名、結果必須是有效實體、`Kernel.bounds` 對平滑曲面偏大的觀察 |
| [ADR 0031](docs/adr/0031-sweep.md) | 掃出（3a-6b，**Schema 18**）：`sweep` 特徵（輪廓草圖＋路徑草圖，路徑一條開放的線與圓弧）、從路徑落在輪廓平面上的那一端開始、跟隨路徑（修正的 Frenet）、封閉路徑 OCCT 給體積 0 所以拒絕、面名稱 `<掃出>:side:<輪廓草圖>.<輪廓圖元>@<路徑圖元>`（兩個產生清單的交集）、有洞的輪廓＝外輪廓掃出減洞掃出、結果必須是有效實體 |
| [ADR 0030](docs/adr/0030-hole-wizard.md) | 異型孔精靈（3a-6a，**Schema 17**）：`hole` 特徵（草圖的每個單獨點、四種孔、內建 ISO 表只存運算式）、旋轉刀具＋除料、面名稱 `<孔>:side:<草圖>.<點>.<部位>`、`includedAngle` |
| [ADR 0029](docs/adr/0029-draft-feature.md) | 拔模特徵（3a-5c，**Schema 16**）：`draft` 特徵（中立面＋面＋角度＋反轉）、方向規則（離中立面越遠越窄）、與伸長拔模共用 `Kernel.draftFaces`、`ModifiedShape` 讓名稱不變、切線相連的面要一起選、薄殼「OCCT 回報完成卻原封不動」的防呆 |
| [ADR 0028](docs/adr/0028-shell.md) | 薄殼（3a-5b，**Schema 15**）：`shell` 特徵（移除面＋壁厚＋向外）、MakeThickSolid、面的演化（保留 same／開口環 modified／內側 generated from face）、命名 `<薄殼>:shell:<原面>` 與一個曾踩到的命名錯誤、壁厚太大是可讀的錯誤 |
| [ADR 0027](docs/adr/0027-extrude-revolve-p1.md) | 伸長與旋轉的 P1（3a-5a，**Schema 14**）：成形到下一面（從幾何決定）／至頂點（只是深度）／至本體／從曲面偏移（只做平行平面）、方向 2（遠端蓋叫 `cap:start`）、拔模（先伸長再 DraftAngle，面靠 `ModifiedShape` 找回，名稱不變）、薄件（自己的精確偏移，環與帶，面名加後綴） |
| [ADR 0026](docs/adr/0026-sketch-entities-that-follow-the-model.md) | 跟著模型走的草圖圖元（3a-4d，**Schema 13**）：參考圖元是帶 `ref` 的一般圖元、重算時依模型移動並固定（圓弧固定圓心、起點與弦長）、只轉直線與平行於草圖面的圓／圓弧、面的外框、貫穿、遺失參考是草圖的錯誤、投影在 Worker 做 |
| [ADR 0025](docs/adr/0025-sketch-diagnosis-check-and-contours.md) | 草圖的衝突診斷、檢查與修復、輪廓選取（3a-4c，**Schema 12**）：診斷只列求解器證實有效的處理、六種檢查問題與只做不需要決定的修復、輪廓用外圈圖元 ID 記住並以共用一半以上找回、沒有選擇就是全部 |
| [ADR 0024](docs/adr/0024-sketch-relations-and-driven-dimensions.md) | 草圖 P1 限制條件與從動尺寸（3a-4b，**Schema 11**）：同心同徑與交錯是一個限制條件、合併是操作（兩點之間有尺寸就拒絕）、弧長尺寸、從動尺寸（`driving: false`）的建立／改回與被運算式引用時的拒絕、過多定義的尺寸改成從動、從動顯示量到的值 |
| [ADR 0023](docs/adr/0023-sketch-tools-p1.md) | 草圖工具 P1（3a-4a，Schema 不變）：每個工具是一個回傳 `SketchEdit` 的純函式、`editSketch` 指令的順序、圓角／導角的虛擬交點、狹槽／多邊形的自由度、靜態鏡射加對稱、修剪／延伸／偏移的規則與拒絕的情形、相切接續偏移的冗餘 |
| [ADR 0022](docs/adr/0022-multiple-bodies.md) | 多本體（3a-3，Schema 10）：本體的身分與切開的編號、名稱不加本體前綴、合併結果與除料切開的行為、組合特徵、參考本體、合併視圖讓其餘程式不必知道有幾個本體、本體的隱藏要重算 |
| [ADR 0021](docs/adr/0021-direct-editing-and-import-repair.md) | 直接編輯與輸入修復（3a-2，Schema 9）：刪除面（Defeaturing）與「刪除鑽孔」的意圖、移動面的兩種做法（掃出／延伸板）與拒絕的情形、只重新分組鄰面、輸入診斷與縫合（容差存在特徵上）、置換面未做 |
| [ADR 0020](docs/adr/0020-expressions-and-variables.md) | 運算式、全域變數與檔案屬性（3a-1，Schema 8）：帶量綱的求值、`D1@草圖1` 引用、循環偵測、先解析成數字再交給求解器、改名連動、由運算式推導父子關係、方程式與檔案屬性對話框 |
| 本文件 | 狀態、待辦、下一步、約定 |

## 3. 目前狀態

- **Phase 0 行走骨架**：驗收全部通過。① ③ ④ 由自動化測試證明；② 使用者已在 SW 核對通過（2026-09-27）。
- **OCCT 缺口技術驗證**：完成，幾何核心已改用 `libcascade` 3.0.2（OCCT 8.0.1）。
  - 仍缺 `BRepOffset_MakeOffset`（C10.1 移動面），Phase 3a 前決定做法。
- **Phase 1A 草圖編輯器**：完成並已提交。細節見 ADR 0004 與 §9。
- **Phase 1B 特徵與布林**：完成，已提交並推送（`61bac81`）。細節見 ADR 0005 與 §9。
- **Phase 1D 樹狀結構操作**：完成，已提交並推送（`ca85736`）。細節見 ADR 0006 與 §9。
- **Phase 1C 基準面**：完成並提交。細節見 ADR 0007 與 §9。
- **Phase 1E 檔案**：完成並提交。細節見 ADR 0008 與 §9。系統檔案對話框已由使用者實機確認（2026-09-28）。
- **Phase 1F STEP 輸入**：完成並提交。細節見 ADR 0009 與 §9。使用者以自己的 SW 樣本驗收通過（2026-09-28）；輸入特徵的名稱「輸入1」已確認。
- **Phase 1G 驗收**：藍圖 Phase 1 驗收 ①②③ 都已完成，**閘門已由使用者確認通過（2026-09-28）**。細節見 [phase1-verification.md](docs/phase1-verification.md)。
  - 驗收中發現的 3 個問題都已修正，見 ADR 0010：整圈旋轉平面的命名、角度尺寸的量測側、零件名稱不隨檔名。
- **Phase 1 零件 MVP**：完成。
- **Phase 2 組合件 MVP**：完成（里程碑 2A–2F，§10）。**閘門已由使用者確認通過（2026-09-30）**，但驗收範圍低於藍圖原文：使用者沒有 SW，改以金樣夾具（15 個零組件、39 個結合）的自動測試、輸出 STEP 在 eDrawings 的目測與兩個真實 STEP 的部分驗收取代「用 SW 樣本重組」與「在 SW 開啟」。
  - **2A 組合件骨架**：完成並已提交推送（`7906934`）。細節見 ADR 0011 與 §10。系統的資料夾與存檔對話框已由使用者實機確認（2026-09-30，§8）。
  - **2B 結合求解器**：完成並已提交推送（`d10c2ad`）。細節見 ADR 0012 與 §10。另修正一個 Phase 1 的問題：旋轉件平面的法向（ADR 0012「修正」）。
  - **2C 結合的介面與管理**：完成並已提交推送（`c3f3860`）。細節見 ADR 0013 與 §10。驗收：只用 UI 把三個金樣零件組成小夾具並完全定義，矛盾的結合被正確指出。STEP 檔可直接當零組件插入。
  - **2D 移動零組件與參考檔**：完成並已提交推送。細節見 ADR 0014 與 §10。驗收：拖曳部分定義的零組件只沿剩餘自由度移動；零件檔改名後開啟組合件會詢問並可重新指定；從組合件開啟零件改尺寸、返回後結合仍成立。
  - **2E STEP 組合件輸出**：已實作並通過自動與瀏覽器驗證，已提交推送（`49e93c7`）。細節見 ADR 0015 與 §10。「檔案」→「輸出 STEP」在組合件中可用，寫出一個組合件，每個零件檔一個原型、每個零組件一個帶位姿的實例。金樣夾具的輸出檔已由使用者在 eDrawings 開啟確認（§8）。
  - **2F 驗收**：見 §10。金樣組合件測試（15 個零組件）、兩個真實 STEP 的部分驗收，閘門通過。
- **分支與遠端**：只在 `main` 開發。遠端 `origin` = https://github.com/Chun-Chieh-Chang/3D-Builder（私人），`main` 追蹤 `origin/main`。`spike/occt-gaps` 已合併、未推送，可以刪除。
- **2F 之後的收尾（2026-09-30，已提交推送 `92a434d`）**：零組件的網格變粗（三角形約減六成）、載入進度提示（階段與秒數）、壞的 STEP 檔顯示錯誤。細節見 ADR 0016。
- **Phase 1 遺留的 P0 已補（2026-09-30，ADR 0018，已提交推送）**：D4.6 顯示/隱藏（基準面、草圖、原點；本體與軸要等 3a-3、3a-7）與 B4.3 遺失參考的「改用這個」。**Schema 升為 7**（`visibility`），所以 Phase 3a-1 的 Schema 是 v8，不是 v7。
- **多語系機制已完成（2026-09-30，ADR 0019）**：新套件 `@3db/i18n`（**在新電腦或 pull 之後要再 `npm install`，工作區才會連上它；開發伺服器也要重啟**）。新的使用者可見文字一律 `t()`，寫進 `packages/i18n/src/zh-TW/`；`npm run check` 多一道 `lint:i18n`，既有的 639 行中文字串記在 `scripts/i18n-baseline.json`，只能減少。英文翻譯與設定畫面留到 3a-9。
- **3a-1 運算式與變數已完成（2026-09-30，ADR 0020）**：**Schema 升為 8**（v7 是 D4.6 的 `visibility`）。`packages/model/src/expr/`（解析器與求值）、`params.ts`（變數與尺寸的分析、解析、相依、改名連動）；`Regenerator.rebuild` 與草圖求解前先把運算式解析成數字，PlaneGCS 與 OCCT 沒有改。新的介面文字都走 `t()`。
- **3a-2 輸入修復與直接編輯已實作（2026-10-01，ADR 0021，`78e0cad`）**：**Schema 升為 9**。「特徵」分頁多了「刪除面」（`BRepAlgoAPI_Defeaturing`，含「刪除鑽孔」勾選，存成意圖 `hole`，重算時由模型找出孔壁的另一半、孔底、孔口倒角）與「移動面」（平面，沿外法向；鄰面都垂直時掃出該面，否則延伸板；相切、非凸又有斜鄰面、往內移超過厚度都拒絕並說明）；輸入本體的屬性管理員多了診斷報告與「縫合容差」（只有曲面的檔案縫成實體，縫不起來就說還有幾條邊沒接上）。置換面使用者決定先不做。實作在 `packages/kernel/src/kernel.ts`（`deleteFaces`、`moveFace`、`repairImport`）、`packages/regen/src/engine.ts`（`deleteFace`、`moveFace`、`holeFaces`、匯入快取以雜湊加容差為鍵）、`packages/model`（兩種特徵、`setFaces`、`setMoveFace`、`setImportOptions`）。
- **3a-3 多本體已實作（2026-10-01，ADR 0022，已提交推送）**：**Schema 升為 10**。重算的狀態是一串本體（`packages/regen/src/bodies.ts` 的 `Bodies`），`RebuildResult.body` 仍是「所有本體接起來的視圖」（只有一個本體時就是它），另有 `RebuildResult.bodies`；填料的「合併結果」（預設合併接觸的本體，沒接觸就成為新本體）、除料作用於碰到的所有本體並把切開的幾塊各成一個本體、「組合」特徵（加入／減除／共同）、參考本體（不計質量與零件 STEP）、本體的隱藏／重新命名；輸入的多實體 STEP 每個實體一個本體。名稱沒有加本體前綴（ADR 0022 決策 2）。`kernel.splitSolids／join／clone／solidCount`、`naming.nameFromFaces` 是新的。
- **3a-7a 參考幾何已實作（2026-10-01，ADR 0034，Schema 21，提交後推送）**：基準面多了平行、垂直、中間、相切四種；新增基準軸、參考點、座標系統三種特徵（「特徵」分頁的新按鈕）。實作在 `packages/regen/src/engine.ts`（`refPlane`、`refAxis`、`refPoint`、`coordSys`）、`packages/model`（定義型別、`setRefAxis`／`setRefPoint`／`setCoordSys`、`defRefs`／`mapDefRefs`）、`apps/web/src/state/datumSlots.ts`、`packages/render` 的 `setDatums`。
- **3a-7b 線性與環狀複製排列已實作（2026-10-01，ADR 0035，Schema 22，提交後推送）**：「特徵」分頁的「線性複製排列」「環狀複製排列」。實作在 `packages/regen/src/engine.ts`（`planPatterns`、`snapshot`、`captureDelta`、`placements`、`pattern`、`noOverlap`）、`packages/regen/src/placements.ts`（平移／轉動／鏡射矩陣）、`packages/kernel`（`transformed`）、`packages/model`（`PatternFeature`、`setPattern`、`patterns.ts`、`count` 型別運算式）、`apps/web`（`PatternPanel`、`datumSlots` 的方向與旋轉軸格子）。
- **3a-7c 鏡射已實作（2026-10-01，ADR 0036，Schema 23，提交後推送）；3a-7 到此完成**：「特徵」分頁的「鏡射」。實作在 `packages/regen/src/engine.ts`（`mirror`、`mirrorFeatures`、`mirrorBodies`、與排列共用的 `repeat`）、`packages/model`（`MirrorFeature`、`setMirror`）、`apps/web`（`MirrorPanel`）。
- **3a-8 材質、屬性與輸出已實作（2026-10-01，ADR 0037–0039，Schema 24，提交後推送）；3a-8 到此完成**：「工具」分頁的「檔案屬性」多了材質與文件設定、「外觀」；「檔案」分頁的「輸出 STEP」先問選項、多了「輸出 STL」「輸出影像」。範圍是使用者 2026-10-01 確認的：材質與質量、外觀與顏色、STL、AP242 與影像輸出，加上座標系統當 STEP 輸出座標系。
- **3a-9a 自動存檔與文字化格式工具已實作（2026-10-01，ADR 0040，Schema 不變，提交後推送）**：有未存檔的變更時 5 秒後在瀏覽器留一份；下次開啟會問「復原」或「捨棄」。`node scripts/3dbx.mjs cat|unpack|pack`；每個 clone 跑一次 `npm run setup:git` 後 `git diff` 看得到零件檔裡的變更。
- **3a-9b 設計樹與範本與快速鍵已實作（2026-10-01，ADR 0041，Schema 25，提交後推送）**：設計樹的列可以拖放調整順序（受父子關係約束）、有資料夾、註解與標籤、過濾、重新命名；「檔案」→「新零件（範本）…」；「工具」→「快速鍵…」。
- **3b-0 技術驗證進行中（2026-10-02，ADR 0046）**：② 鏡射零組件、③ 干涉檢查效能、④ STEP 組合件結構對應已量測並有決定；**① 桌面版（Tauri）卡在這台沒有 Rust 與 MSVC 建置工具**（`rustc`、`cargo`、`vswhere` 都找不到，WebView2 154 有、`winget` 有），安裝要使用者許可；檔案存取集中在 `apps/web/src/files.ts` 一個模組。**使用者 2026-10-02 決定先跳過 ①（3b-6 桌面版開工時再裝 Rust 與 MSVC 並驗證 File System Access、WASM 本機載入）；下一步是 3b-1 剛性次組合件。**
- **3b-1 剛性次組合件進行中（2026-10-02，ADR 0047，**組合件 Schema 升為 3**）**：使用者確認的範圍：只做插入現有 `.3dba`（不做「形成新次組合件」）、父層結合可選次組合件內零件的面與邊（`MateRef.path`）、每個子步驟提交後也推送。計畫與 12 項驗收標準見該次對話（摘要在 ADR 0047）。步驟：**1a 資料格式與循環偵測（已完成）**→ **1b 求解（已完成：`solveSubAssembly`、`mateGeometryIn` 沿路徑走，不合併幾何；與攤平版本位姿差 < 1e-6、內部相對位姿變化 < 1e-9）**→ **1c Store／Worker／介面（已完成：插入 `.3dba`、設計樹展開、帶路徑的結合、開啟次組合件與返回、巢狀缺檔會說檔名；瀏覽器腳本 `tests/e2e/phase3-subassembly.js`：`await __sub.open()`／`move()`／`insert()`；與驗收標準 9 的出入見 ADR 0047 決定 11）**→ **1d 隱藏／抑制／透明（已完成：`setComponentState` 指令、抑制不求解且結合跟著抑制、隱藏不畫、透明改材質；設計樹右鍵選單；`__sub.states()`）**→ **1e 巢狀 STEP 輸出（已完成：`Kernel.exportAssemblyStep` 的 `subs`、`stepStructure`；`__sub.step()`）。3b-1 全部做完；只剩驗收標準第 11 項的 eDrawings 目測要使用者做（ADR 0047 最後一節）。下一個是 3b-2 複製排列與鏡射零組件（phase3-plan §4）。**
- **3b-2 零組件複製排列與鏡射進行中（2026-10-02，ADR 0048，組合件 Schema 升為 4）**：使用者確認：實例是衍生位姿（不能再加結合）、鏡射件載入時由原件算出不另存檔、驗收標準 1–9（見 ADR 0048；其中第 5 項「面名稱對得上」改為「鏡射件的面與原件逐面對得上」，因為實例不當結合對象）。**3b-2 全部做完（2a 資料格式、2b 葉子與 Worker 的鏡射網格、2c 屬性管理員與設計樹、2d STEP）**；瀏覽器腳本 `tests/e2e/phase3-component-pattern.js`（`await __pat.run()`、`__pat.step()`）。驗收 5 部分通過（實例不能當結合對象，見 ADR 0048 決定 11）；限制：次組合件自己檔案裡的排列在上一層不顯示、鏡射面只有組合件的前上右基準面。**下一個是 3b-3 STEP 組合件輸入（F2.8）。**
- **3b-3 STEP 組合件輸入已完成（2026-10-02，ADR 0049，Schema 不變）**：使用者確認：每次選資料夾、顏色一起做。命令「檔案」→「輸入 STEP 組合件…」；瀏覽器腳本 `tests/e2e/phase3-step-import.js`（`await __imp.run()`）。限制：零組件名稱用「檔名＋編號」不沿用 STEP 的；沒有真實的（別家軟體輸出的）保留結構的組合件 STEP 可驗，要補需要使用者提供（§8）；寫入失敗時的清除沒有測試。**下一個是 3b-4 零件表與爆炸視圖（phase3-plan §4）。**
- **3b-4 零件表與爆炸視圖已完成（2026-10-02，ADR 0050，組合件 Schema 升為 5）**：使用者確認：零件表兩種結構可切換、爆炸方向用軸或任一元素。命令列「組合件」→「零件表…」「爆炸視圖」；瀏覽器腳本 `tests/e2e/phase3-bom.js`（`await __bom.run()`）、`tests/e2e/phase3-explode.js`（`await __exp.run()`）。限制：爆炸只能動頂層零組件、沒有爆炸線與動畫、只有一組爆炸視圖；CSV 不防公式注入；廠商／料號從真實零件檔屬性到零件表沒用真實檔走過一次。**下一個是 3b-5 評估（測量、物質特性、檢查模型幾何、干涉檢查，phase3-plan §4）。**
- **3b-5 評估已完成（2026-10-03，ADR 0051，Schema 不變）**：使用者確認：干涉的比對單位是頂層零組件（次組合件一個，排列與鏡射的複製品各一個）、結果是清單加圖面紅色重疊體積。命令：零件「工具」→「測量」「物質特性…」「檢查幾何…」；組合件「組合件」→「測量」「干涉檢查」「物質特性…」「檢查幾何…」。瀏覽器腳本 `tests/e2e/phase3-physical.js`（`await __physical.run()`）、`phase3-measure.js`（`__measure.assembly()`／`.part()`）、`phase3-interference.js`（`__interference.run()`）、`phase3-check.js`（`__check.assembly()`／`.part()`）。核心新增 `inertia`、`distance`、`common`、`check`、`subShape`；model 的 `mass.ts`、`measure.ts`、`interference.ts`；regen 的 `measure.ts`、`interference.ts`；`Viewer.setHighlights`。限制：次組合件內部的干涉不查（**夾具裡削邊銷的 r=5 本體站在板的 r=4 孔裡，約 405 mm³ 一支，是夾具本身的幾何**）；接觸不算干涉，重疊 < 1e-3 mm³ 不報；夾角是銳角；表面積是各零件的總和；20 個零組件單獨跑 1.04 s 牆上時間，整套平行時測試改量 CPU 時間（預算 4 s，只擋退步）；紅色重疊是用 Viewer 物件驗證的，沒有用眼睛看截圖（截圖在這台機器上不穩）；沒用第三方零件檔驗證。**下一個是 3b-6 桌面版（Tauri，需要裝 Rust 與 MSVC，先問使用者許可）。**
- **3b-6 桌面版已完成（2026-10-03，ADR 0052，Schema 不變）**：使用者確認：用 winget 裝 Rust 與 VS Build Tools、先驗證 WebView2 再決定要不要原生外掛、NSIS。`apps/desktop`（Tauri 2.12）只是載入 `apps/web/dist` 的視窗，**`files.ts` 沒動**（WebView2 裡三個選擇器、OPFS、IndexedDB 都可用，來源 `http://tauri.localhost` 是安全環境）。`npm run build -w @3db/desktop` 產生 `apps/desktop/src-tauri/target/release/bundle/nsis/3D-Builder_0.1.0_x64-setup.exe`（首次建置 11.02 MiB；2026-10-04 用 4a–7 重建後 11.13 MiB）；`tests/e2e/desktop-probe.mjs` 用 DevTools Protocol 檢查視窗並在裡面跑瀏覽器腳本（9 個全過）。**驗收 7 項裡第 3 項（原生對話框開啟、儲存）與第 7 項（沒裝過開發工具的帳號安裝）沒做，要使用者做（ADR 0052 有步驟）；第 2 項斷網沒真的拔網路。** 限制：沒有自動更新、安裝檔沒簽章、圖示是暫用的、解除安裝留下 `%LOCALAPPDATA%\app.3dbuilder.desktop`（使用者資料）。坑：在 Claude 桌面版的工作階段裡建置，`%LOCALAPPDATA%` 被重新導向，Tauri 改 NSIS 工具資料夾名稱會失敗，所以設了 `bundle.useLocalToolsDir`。**下一個是 3b-7 驗收（phase3-plan §4，需要真實樣本，見 §8）。**
- **3b-7 A 段已完成（2026-10-03，ADR 0053）**：`tests/phase3/acceptance-3b.test.ts` 11 項。金樣夾具（15 零組件、39 結合）輸出 STEP → `stepAssemblyFiles` → 重新開啟 → 再輸出，平的與巢狀（次組合件用 3 次）樹、名稱、位姿（差 0 mm，標準 < 0.01）、零件體積（對手算）都一致，且為不動點。**沒做：**真實第三方 STEP（B 段）、eDrawings 目測、桌面版人工驗收（C 段）。3b 閘門因此是「有條件通過」。這台電腦要先 `npm install` 才有 `node_modules/@3db` 連結。
- **Phase 4a 開發完成（2026-10-03，ADR 0054–0059），閘門是有條件通過**：4a-1 衍生本體與從本體產生組合件、4a-2 進階結合、4a-3 定位銷孔、4a-4 標準件圖庫（`@3db/library`）、4a-5 餘隙與取放空間與拖曳碰撞、4a-6 A 段驗收（金樣夾具）。B 段（真實工件與廠商件、eDrawings／SW）待使用者（§8）。
- **Phase 5 工程圖進行中（2026-10-03，使用者決定先做 5 再做 4b；計畫見 [phase5-plan](docs/phase5-plan.md)，驗收用金樣）**：
  - **5-0／5-1（ADR 0060）**：`Kernel.projectView`（精確隱藏線）、工程圖文件 `.3dbd`（第三種文件 `drawing`）、圖頁與標題圖塊、標準三視圖（第一角）、`@3db/drawing`（場景、SVG）、App 的工程圖模式。
  - **5-2（ADR 0061，Schema 2）**：投影、剖面（`Kernel.sectionView`、45° 剖面線）、細部放大視圖。
  - **5-3（ADR 0062，Schema 3）**：尺寸指到零件元素的持久名稱（不存數值）、自動尺寸、ISO 286 公差。
  - **5-4a（ADR 0063，Schema 4）**：中心記號與中心線、孔標註、孔表。**5-4b（ADR 0064）**：組合件當視圖來源、零件表、零件號球；「新工程圖」也能從開啟的組合件。
  - **5-5（ADR 0065）**：DXF（AC1015）與 PDF（Helvetica、可內嵌 TrueType 子集）輸出，附自寫的讀取器與檢查。**尚未在真實 CAD 與 PDF 檢視器開過（§8）。**
  - **5-6（ADR 0066）**：驗收 A 段：4a 的夾具出兩張圖（基板加工圖：三視圖、過兩個定位銷孔的剖面 1319.5 mm²、孔表、尺寸與 H7 公差；組合圖：零件表與四個號球），每個數字手算，輸出 DXF／PDF 讀回；改主模型後圖跟著變。**Phase 5 開發完成，閘門有條件通過。** 驗收中修了一個問題：有倒角的孔被當成盲孔。
  - **4b 檢具開發完成（2026-10-03），閘門有條件通過**：使用者說「接著做 4b 檢具」。[phase4b-plan](docs/phase4b-plan.md)（型面塊＝工件型面退一個間隙再加厚；預設假設、里程碑 4b-0 到 4b-6、驗收用金樣）。
    - **4b-0 已做（ADR 0067，`tests/phase4b/surface-spike.test.ts` 17 項）**：偏移自由曲面（含圓角的區域、整個實體、向內）間隙誤差 1e-6 到 3e-5 mm，遠小於 0.05 mm；縫織、填補（相切 0.02 mm）、厚面、投影分割（區域面積對手算積分 1e-5）、以曲面除料（2e-6 mm）都可行。**發現：偏移失敗時 OCCT 給「有效但錯」的形狀（間隙誤差 1.99 mm），所以每個曲面特徵都要量測結果**；整個實體的偏移是殼要包成實體；厚面可能整個反向；偏移曲面輸出前轉 B 樣條。
    - **4b-1 已做（ADR 0068，零件 Schema 28）**：`Kernel` 的 `gapReport`、`offsetFaces`、`offsetSolid`、`knit`、`fillSurface`、`flatSurface`、`thicken`、`cutWithSurface`、`splitByProjection`、`toBSpline`（每個都有手算測試，結果都量測間隙、超過 0.05 mm 就失敗並說出量到的誤差）；**曲面本體**（沒有實體，不是零件：實體特徵不碰它、質量與零件表與干涉與工程圖不算它、STEP 當殼、設計樹標「（曲面）」）；`offsetSurface` 特徵與 `setOffsetSurface` 指令（沒有介面）。發現：OCCT 的偏移結果要連幾何複製才能在建構物件釋放後使用；已是 B 樣條的接合面轉 B 樣條會中止。
    - **4b-2 已做（ADR 0069，零件 Schema 29）**：`splitLine` 特徵（草圖、面、方向、穿透全部）與 `setSplitLine` 指令（沒有介面）；核心的 `splitByProjection` 改成收多個圈並回傳每個區域是哪一圈；區域面叫 `<特徵>:side:<草圖>.<圈>`（圈＝最小的實體編號），其餘的面保留原名；區域面積對手算積分、選區域做偏移曲面也對手算。發現：投影的線貼著週期面的接縫會讓結果無效（退化情形，未處理）。
    - **4b-3 已做（ADR 0070，檔案格式不變）**：功能區「特徵」頁的「分割線」「偏移曲面」；PropertyManager 面板（面選擇框、距離、接合、草圖下拉、反轉、穿透全部）；編輯時顯示特徵自己的結果，失敗原因在訊息框；偏移曲面的**量測間隙**經 `FeatureResult.info` 顯示；特徵自己做出的面不能選回去。只用腳本驗證（`tests/e2e/phase4b-gauge-ui.js`），畫布上真的點選與視覺待使用者看。
    - **4b-4 已做（ADR 0071，零件 Schema 30）**：`knit`、`fillSurface`、`flatSurface`、`trimSurface`、`extendSurface` 五個特徵（指令、重算、命名、介面）；核心的 `knit` 回傳面的來源、新增 `keepFaces`、`extendFace`。延伸先驗證（`BRepLib::ExtendFace` 穩定，只限單一面的曲面本體）。**發現**：圓柱壁上的相切填補 OCCT 給平面圓盤（離邊線很近、切線差 90°），所以填補的相切也量測並拒絕（0.02 弧度）；只有「恰好一個相鄰面」的邊才能相切。縫織的曲面本體清單是開始時的快照。只用腳本驗證（`tests/e2e/phase4b-surface-edit-ui.js`）。
    - **4b-5 已做（ADR 0072，零件 Schema 31）**：`thicken`（結果取代曲面本體、成為實體；面保留名、新面 `<特徵>:thicken:…`）與 `cutWithSurface`（曲面沿平面法向掃成刀具除料，曲面不變，新面 `<特徵>:cut:…`）的特徵、指令、重算、介面；核心的 `thicken` 回傳面的來源、新增 `surfaceTool`。**決定了三件事**：STEP 輸出把偏移曲面型別轉成 B 樣條（`portableShape`；轉換器中止時照原樣輸出並警告，worker 的輸出改回傳 `{ text, warnings }`）；衍生本體是曲面時仍是曲面（修了漏帶標記）；組合件裡的曲面本體和參考本體一樣畫出來、不算零件。縫織用的清單改成所有本體的快照（`bodyPool`）。只用腳本驗證（`tests/e2e/phase4b-thicken-cut-ui.js`，兩段各載入一次頁面再跑）。
    - **4b-6 已做（ADR 0073）**：驗收 A 段：金樣工件（放樣自由曲面、含圓角的方塊，輸出成 STEP 再讀進來）→ 分割線 → 偏移 3 → 厚面 → 型面塊；**間隙偏差 5e-5 mm（容許 0.05）**、厚面體積對辛普森積分（把區域偏移 3、7、11 量面積）差 1.2e-5、圓角件的塊 31631.86 mm³（手算）；接進 4a 的夾具（衍生零件、組合件）無干涉、塊到工件 3.000 mm；塊的剖面積 790.8 mm²（手算，剖面弧是折線差 0.24）；工件改了塊跟著更新、名稱不變。`tests/support/sectionArea.ts` 是 5 與 4b 共用的剖面積讀法。**B 段（真實的沖壓件或塑膠件 STEP）待使用者（§8）。**
- **Phase 6 塑膠件開發完成（2026-10-04，ADR 0074–0082），閘門是有條件通過**：[phase6-plan](docs/phase6-plan.md)。6-0 計畫與技術驗證、6-1 拔模分析、6-2 底切分析、6-3 厚度分析、6-4 不等殼厚（零件 Schema 32）、6-5 唇與溝槽（33）、6-6 螺柱（34）、6-7 卡榫與窗與排氣口（35）、6-8 驗收 A 段（金樣外殼，每個數字手算）。B 段（真實塑膠件與 SW 的分析對照、真人走一遍）待使用者（§8）。
- **Phase 7 鈑金開發完成（2026-10-04，ADR 0083–0091），閘門是有條件通過**：[phase7-plan](docs/phase7-plan.md)。「特徵原生」做法：建立時記錄折彎資料，平板型式由它算出（不展開實體）。7-1 基材凸緣（Schema 36）、7-2 邊線凸緣（37）、7-3 摺邊（38）、7-4 縮短與離隙（39）、7-5 平板型式、7-6 平板型式 DXF、7-7 量規表（40）與可製造性檢查、7-8 驗收 A 段。沒做：凸折、斷開角落、長圓與撕裂離隙、折過的基材上的凸緣的平板型式、平板型式進工程圖。B 段（真實支架與 SW 的平板型式對照、真的 CAD 開 DXF）待使用者（§8）。
- **鞏固 H-1 到 H-11（2026-10-04，使用者採納「先鞏固再加功能」）**：[hardening-plan](docs/hardening-plan.md)。H-1 併面時舊面保留原名（ADR 0092）、H-2 畫面小修、H-3 效能、H-4 螺柱孔拔模（Schema 41）與摺邊不算最小半徑（ADR 0093）、H-5 到 H-10 種子固定的隨機測試（ADR 0094：零件、鈑金、STEP 來回、疊層拉伸與掃出與旋轉、組合件的結合與干涉、工程圖的視圖與剖面與輸出，共找到並修了 2 個真問題）、H-6 封閉角落（Schema 42，ADR 0095）、H-11 全面盤點清理（移除沒用到的 import 與沒人用的匯出與只寫不讀的欄位、文件對齊、資安與隱私盤點）與跨電腦開發（使用者要求專案能在不同電腦開發：`npm run doctor` 診斷這台電腦、`.gitattributes` 的 `* text=auto eol=lf`；套件解析不靠符號連結的做法評估後決定不做，見 ADR 0096）；桌面版安裝檔 2026-10-04 用 Phase 4a–7 的程式重建（11,673,078 位元組，SHA-256 開頭 `08c70f0e`，探測腳本確認視窗載入且有「鈑金」分頁；沒有在乾淨帳號安裝過）；註解與 handoff 裡被反斜線吃掉的字還原。逐項的實機驗證清單（84 項）：[docs/manual-verification.html](docs/manual-verification.html)。
- **檢查**：**1996 項測試通過、21 項略過**（`npm run check`：型別、分層、i18n、測試；2026-10-05 STEP 名稱與剖面版面修正之後）；每個里程碑的數字見對應的 ADR 與 `git log`。`tests/phase3/rebuild-speed.test.ts` 與草圖效能預算測試在機器同時有別的負載時可能超過時間預算，單獨跑會過（§6「效能測試」）。`F:` 磁碟（USB，不支援符號連結）上的做法見 §6「工作區連結」。

## 4. 如何執行

```bash
npm install          # 第一次
npm run dev          # 自動開啟 http://127.0.0.1:5391
npm run dev:auto     # 同上；最後一個分頁關掉 30 秒後伺服器自己結束（ADR 0118）
npm run check        # 型別檢查 + 分層檢查 + 全部測試
npm run build        # 正式版建置
npm run build -w @3db/desktop   # 桌面版安裝檔（要 Rust 與 MSVC，見 apps/desktop/README.md）
```

- 內建瀏覽器的預覽伺服器設定在 `.claude/launch.json`，名稱是 `web`。
- `spikes/occt-gaps/` 是 ADR 0003 的證據腳本，不屬於產品程式碼。

## 5. 架構速覽

資料流：

1. UI 送出 `Command`。
2. `DocHistory`（Immer patches）更新文件，並處理復原/重做。
3. Worker 重新計算：草圖求解 → 輪廓 → OCCT 特徵 → 持久命名。
4. Worker 回傳網格、名稱、指紋、物質特性。
5. `Viewer` 顯示結果。

必須維持的不變式：

1. 文件只存設計意圖。B-Rep、網格、名稱、DOF 等衍生資料一律不寫回文件。
2. 參考 = 持久名稱 + 幾何指紋，不存拓撲索引。命名文法見 ADR 0002。
3. UI 只能送 `Command`。一次編輯會話 = 一次交易，✔ 提交、✖ 還原。
4. 分層由 `scripts/check-deps.mjs` 強制。主執行緒不得在執行期匯入 kernel、regen、sketch、io；例外只有 `@3db/regen/dag`、`@3db/io`、`@3db/sketch/interact`（純 TS）。
5. 拾取到的索引（頂點、邊線、面），一律對照「畫面上正在顯示的那份結果」解析（`Viewport` 的 `displayed`）。
6. 草圖點座標是「擺放意圖」，只在畫圖與拖曳時寫入；求解結果不寫回（ADR 0004）。
7. 新物件的 ID 由 UI 用 `IdAllocator` 發放並放進指令；ID 永不重用。
8. 布林結果的名稱，依「目標在前、工具在後」的來源繼承；合併共面時，保留較早特徵的名稱（ADR 0005）。
9. 輸入的資料（STEP）以 SHA-256 識別，隨 `.3dbx` 存放；Worker 在執行使用它的指令之前就要拿到資料（ADR 0009）。
10. 零件名稱只有一個來源：存檔或開檔後就是檔名（`partName`）。「新零件」不把名稱寫進文件（ADR 0010）。
11. 角度尺寸記錄放置的扇形（`flip`）；沒有 `flip` 的舊尺寸意義不變（ADR 0010）。
12. 組合件以「相對於組合件檔所在資料夾」的路徑引用零件檔，每個檔案只存一筆；不存零件的雜湊值。組合件存到別的資料夾時，路徑與復原記錄一起改寫（`History.rebase`，ADR 0011）。
13. 一次開一份文件。組合件的狀態在 `AssemblyStore`（每開一份就建一個）；`AppStore` 依目前文件轉送檔案、復原/重做、重新計算（ADR 0011）。
14. 結合只存設計意圖。零組件的位置、狀態、自由度都是求解出來的衍生資料；每次都從擺放位置解起，結合沒拘束的自由度保持擺放的樣子；衝突依設計樹順序判定（ADR 0012）。
15. 面的外法向由曲面本身的偏導數決定，不用 OCCT `Plane()` 等回報的座標系方向（ADR 0012）。
16. 結合草稿不寫進文件：它和文件一起求解做預覽，✓ 之後才成為指令（ADR 0013）。
17. 移動零組件（拖曳、數值）只在放開或「套用」時寫入文件：與它一起求解的零組件，位置改變的擺放位置一起改為目前位置，一個指令、一個復原步驟；拖曳中的位置是衍生資料（ADR 0014）。
18. 零件檔的路徑只在 `FileRef` 一處：重新指定、搬移都只改它；零組件以 ID 引用檔案，結合以持久名稱引用元素（ADR 0014）。
19. 工程圖文件只存意圖（圖頁、標題、視圖、尺寸、表格）；**線條、尺寸的數值、孔表的列、零件表的列都由模型重算**，不存（ADR 0060–0064）。視圖的來源是零件或組合件檔的相對路徑。
20. 尺寸指到零件的面、邊、頂點的持久名稱加指紋；元素不見時說「找不到」，不悄悄改接（ADR 0062）。
21. `buildScene` 的場景（圖紙座標 mm、y 向上的折線與文字）是 SVG、DXF、PDF 的唯一來源；`@3db/drawing` 只依賴 model 與 i18n，不用核心（ADR 0060、0065）。

## 6. 已知陷阱

**libcascade（詳見 ADR 0003）**

- 多載以參數個數分派。例如 `BRepPrimAPI_MakeRevol` 一律傳 4 個參數。
- 沒有綁定 UTF-16 字串。
- handle 需要手動 `delete()`，用 `Arena` 管理。
- 例外要用 `getExceptionMessage` 解碼。
- `BRepAlgoAPI_Fuse`/`Cut` 的建構子本身就會執行運算，不要再呼叫 `Build()`。
- `BRepPrimAPI_MakeHalfSpace` 只以傳入的面為界。要以整個曲面為界，先用 `BRep_Tool.Surface` 加上 `MakeFace(surface, tol)` 做出無界的面。
- `BRepPrimAPI_MakeRevol` 旋轉整圈時，`Generated(edge)` 對與軸垂直的輪廓線回傳空集合，但它們掃出的平面確實在結果中。要同時查 `mk.Revol().Shape(edge)`，否則這些面會失去名稱（1G 發現）。
- `Regenerator.rebuild()` 會釋放上一次結果的形狀。測試必須先量完這次的結果，才能再做下一次 rebuild。
- 旋轉特徵掃出的平面，`BRepAdaptor_Surface.Plane()` 的法向不一定與曲面參數化一致；只看它與面的 Orientation 會把部分平面算成朝內（2B 發現）。外法向要用 `EvalD1` 的 ∂u × ∂v。圓柱等的 `Direct()` 同理不可靠。

**libcascade（3a-2 發現，細節見 ADR 0021）**

- `BRep_Tool.CurveOnSurface(edge, face, …)` 的綁定壞了（丟 `Cannot read properties of undefined (reading 'name')`）。要在鄰面上找邊線對應的曲面點，用 `GeomLib_Tool.Parameters(曲面, 點, 容差)` 取 (u, v)，再 `BRepAdaptor_Surface.EvalD1`。
- `BRepClass_FaceClassifier(face, gp_Pnt, 容差, true, 0.1).State()` 可以判斷點在不在面內（`TopAbs_IN`）。
- `ShapeUpgrade_UnifySameDomain` 預設會把**整個本體**的共面合起來；在 2004 個面的輸入件上只動一個小面，就會合掉 48 個不相干的面、改掉別人在用的名稱。用 `KeepShape(邊)` 保護不該合的邊（`kernel.moveFace`）。
- `BRepAlgoAPI_Defeaturing` 不能中斷，對某些面（產品件的 `import1:f254`）永遠不回來。核心沒有綁定可中斷的進度指示器，所以由 `store.ts` 的重算時間上限保護。
- STEP 讀入器自己會修好小缺陷（移動過的頂點、沒共用邊的面再組成實體），所以做不出「讀進來就無效」的檔案；`Kernel.repairImport(shape)` 是公開的，測試在記憶體裡做缺陷再交給它。
- 對曲面（沒有實體）的 STEP 用 `BRepBuilderAPI_Sewing` + `ShapeFix_Solid.SolidFromShell`；縫合後的面序固定，所以 `imp:f<k>` 的名稱成立。
- 2000 面的本體，體積積分只準到約 1e-6 倍整體體積：比對體積變化時要以整體的比例為容差，不能以變化量的比例。

**屬性管理員與設計樹（3a-7a 發現）**

- 開著屬性管理員時，左邊的設計樹被它整個換掉（`App.tsx`），所以 ADR 0007 決定 8 說的「在設計樹點選基準面當參考」其實點不到；3a-7a 在屬性管理員裡加了基準按鈕（ADR 0034 決定 9）。瀏覽器腳本要在屬性管理員開著時選基準，用 `.property-manager .datum-picker button`，不要用 `H.treeClick`。
- 自動化瀏覽器（雲端工作階段）：預裝的 Chromium 在 `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`，Playwright 在 `/opt/node22/lib/node_modules/playwright`；用 `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader` 才有 WebGL。載入腳本用 `import('/@fs/<檢出路徑>/tests/e2e/…js')`。唯一會出現的主控台錯誤是 favicon 的 404。

**3a-8 發現的陷阱**

- `useStore((s) => s.result?.bodies ?? [])` 每次都回傳新陣列，React 以為狀態一直在變而無限重繪（整個畫面當掉，只有瀏覽器才看得到）：選擇器要回傳穩定的值，預設值放在 `useStore(...)` 外面（`useStore((s) => s.result?.bodies) ?? []`）。
- OCCT 的 STEP 輸出設定（`write.step.schema`、`write.step.unit`）是全函式庫共用的，而且要等第一個 `STEPCAFControl_Writer` 做出來才存在；先做寫入器再設，輸出完設回預設（ADR 0039 決定 3）。
- 顏色以 `Quantity_TOC_sRGB` 建立，否則 STEP 裡的灰色會變亮（ADR 0038 決定 4）。
- 一個形狀會保留給過它的最細網格：測不同網格品質要各重算一個形狀。
- 零件的「輸出 STEP」現在會先開對話框；`tests/e2e/phase1-demo-parts.js` 的 `H.exportStep` 已改成按對話框的「輸出」。

**開發與測試環境**

- **i18n 的鍵不能跨區域重名**：各區域的目錄用 `...spread` 合併，後面的悄悄蓋掉前面的，不會有任何警告（3b-2 撞到零件排列的 `pattern.count`、`pattern.direction1`、`pattern.instanceName`，差點把零件排列的文字蓋掉）。新增鍵之前先 grep 一下，或用新的前綴（組合件的零組件排列用 `pattern.comp…`／`pattern.step…`）。
- **Node 25.8 的 `fs.cpSync` 在 Windows 上，目的地資料夾名稱含非 ASCII 字元時會讓整個程序崩潰**（vitest 顯示 `Worker exited unexpectedly with exit code 3221226505`，沒有任何測試輸出）。測試複製資料夾時目的地用 ASCII 名稱（`tests/phase3/subassembly-files.test.ts`）。
- **推送**：這台（`D:`）沒有 `gh`，直接 `git push` 即可（Git 的憑證管理員有登入）；上面 §7 的 `gh` 憑證指令是另一台電腦的。
- **PowerShell 工具的兩個陷阱**：雙引號字串會吃掉 `${…}`（改用單引號的 here-string 或 Edit 工具）；`Set-Content -Encoding utf8` 在 Windows PowerShell 5.1 會加 BOM。指令中同時有 `Remove-Item` 與某些字串（例如 `//`、`\n`）時，工具會當成「刪除系統路徑」而拒絕整個指令：刪檔單獨一個指令。
- **暫時用的樣本伺服器**：真實 STEP 不複製、不進版本庫；要在瀏覽器測就起一個只讀、只綁 127.0.0.1 的小型靜態伺服器，用完停掉（做法見下面「Vite 對別的磁碟的檔案」）。

- **工作區連結（`F:` 磁碟）**：專案在 `F:\Self-developed_Apps\G3\3D-Builder`（USB 磁碟，不支援符號連結），`node_modules/@3db` 是空的，所以 `npm run typecheck`、`npm test`、`npm run build`、`npm run dev` 都找不到 `@3db/*`。在支援符號連結的磁碟（例如 C:）上 `npm install` 就正常。在 `F:` 上驗證的做法（2E 用過）：在暫存區放三個設定檔，各自加上 `@3db/<套件>` → `packages/<套件>/src/index.ts` 的別名（另有 `@3db/regen/dag`、`@3db/sketch/interact`），專案內不留檔案：
  - tsc：`extends` 專案的 `tsconfig.json`，加 `paths`、`typeRoots`（`node_modules/@types` 與 `node_modules`）與絕對路徑的 `include`；`baseUrl` 已被移除，不能用；
  - vitest：`root` 指向專案，`resolve.alias` 用正規表示式（`/` 要跳脫），執行 `vitest run --config … --maxWorkers=4`。並行 worker 太多（預設約 26 個）會耗盡 WASM 記憶體而崩潰；
  - vite：設定檔用 `file:///…/node_modules/vite/dist/node/index.js` 匯入 `defineConfig` 與 react 外掛，`root` 設成 `apps/web`，`build.outDir` 指向暫存區。開發伺服器用背景程序啟動（`npx vite --config …`），再以 `preview_start` 的 `url` 開分頁；用完停掉。
- **e2e 腳本的路徑**：`tests/e2e/*.js` 的 `H.GOLDEN` 已改成由 `import.meta.url` 推出，不再寫死使用者路徑。載入腳本時用實際的檢出位置，例如 `await import('/@fs/F:/Self-developed_Apps/G3/3D-Builder/tests/e2e/phase2-assembly.js?' + Date.now())`。本文件其他處的 `<檢出路徑>` 是舊機器上的路徑。Vite 會把 `new URL('字面值', import.meta.url)` 當成資源匯入而改寫，所以腳本裡用字串處理。
- **Vite 對別的磁碟的檔案**：開發伺服器在 `F:`，`/@fs/C:/…` 的請求會拿到首頁（HTML，內容 560 位元組），不是檔案，e2e 存進 OPFS 的就是那份 HTML，載入時會報「檔案不是有效的 JSON」。要在瀏覽器測放在別的磁碟的樣本，起一個只讀、只綁 127.0.0.1 的小型靜態伺服器（Node `http`，加 `Access-Control-Allow-Origin: *`，只提供該資料夾的 `.step`），`H.project` 用它的網址取檔；用完停掉。不要為了測試複製使用者的檔案。
- **頁面沒有繪製時的 e2e**：瀏覽器窗格隱藏、Claude 視窗被擋住時截圖逾時，依游標拾取的流程（`H.pickOn`，例如 `__asm.fixture()` 的結合）會失敗（「could not get the cursor onto face …」）。這種情況改用指令加入結合；`__asm.exportStep()` 就是這樣做的。
- **連接埠**：5173 是本機其他 Vite 專案在用的預設埠。本專案固定使用 `127.0.0.1:5391`，並開啟 strictPort；埠被占用時直接報錯，不會換埠。
- **預覽伺服器**：app 可能在回合之間停掉它。請使用者開網址前，先用 `preview_list` 和 curl 確認。Phase 0 驗收 ② 第一次失敗就是因為沒有確認。
- **Vite 設定檔的相對匯入要自帶副檔名**：`apps/web/vite.config.ts` 寫成 `./dev/autoClose.ts`（含 `.ts`），因為 Vite 下一大版本預設的 `configLoader: 'native'` 不解析無副檔名的路徑；啟動時那句 `(!) Your Vite config uses features that are unsupported by configLoader: 'native'` 就是在講這件事，加了副檔名之後 `npm run dev` 與 `npm run dev:auto` 都不再出現。TypeScript 端要跟著開 `tsconfig.json` 的 `allowImportingTsExtensions`（已有 `noEmit: true` 才合法，否則 `tsc` 報 TS5097）。其餘 763 處無副檔名的相對匯入（分布在 312 個檔案）使用者 2026-10-08 決定不跟著改，見 §8 第 7 項。
- **別的工作階段的開發伺服器**：
  - 如果 5391 已被另一個工作階段的 Vite 佔用，用 `preview_start` 加 `url: http://127.0.0.1:5391` 開分頁，就能使用它。
  - 它的檔案監看可能漏掉修改，症狀是「does not provide an export named …」，或 curl 取回的模組是舊內容。這時對來源檔執行 `touch`，再重新載入頁面。
- **內建瀏覽器**：
  - 窗格隱藏時頁面是 0×0，視角與拾取都會算錯。測試前先 `resize_window` 1280×720，測完用 `desktop` 預設值還原。
  - Claude 視窗最小化時頁面不繪製，座標點擊與截圖都會失敗。改用 JS 觸發 DOM 的 `click()`，並對畫布送 `PointerEvent`。畫布座標用 `store.viewer.screenOf(frame, p)` 換算。
  - 在 console 裡動態 `import` store 會載入第二個實例。要用 `performance.getEntriesByType('resource')` 裡的確切網址。
- **PlaneGCS**：
  - 共用端點的相切必須用 `angle_via_point`，否則會被誤判為冗餘。
  - 它的法向慣例：直線為方向逆時針轉 90°，圓指向圓心。
- **系統檔案對話框**：`showOpenFilePicker`、`showSaveFilePicker`、`showDirectoryPicker` 必須由真人點擊觸發；腳本的 `click()` 不算，非同步流程中途也不能再開（所以專案資料夾用一個對話框承接點擊）。自動測試時以替身取代它們，真正的對話框請使用者確認。
- **組合件的瀏覽器測試**（`tests/e2e/phase2-assembly.js`）：
  - 專案資料夾用瀏覽器的私有檔案系統（OPFS，`navigator.storage.getDirectory()`）。它的控制代碼是真的，`resolve()`、讀寫都走瀏覽器本身的程式；對話框替身回傳其中的檔案。
  - 用法：在剛載入的頁面 `await import('/@fs/<檢出路徑>/tests/e2e/phase2-assembly.js?' + Date.now())`（路徑見上），再 `await __asm.all()`、`await __asm.extras()`；2C：`__asm.fixture()`、`__asm.mateExtras()`；STEP：`__asm.step()`；2D：`__asm.move()`、`__asm.files()`，重新載入後 `__asm.remembered()`；2E：`__asm.exportStep()`（自己組夾具，不必先跑 `fixture()`）；載入進度：`__asm.progress('http://127.0.0.1:5393/')`（要有提供 `CIV0000467治具_step.STEP` 的只讀伺服器，見上面「Vite 對別的磁碟的檔案」；約 15 秒，工具逾時 45 秒，要在背景跑並輪詢 `window.__result`）。
  - 專案資料夾會記在 IndexedDB（2D）。要測「第一次選資料夾」的流程（`__asm.openFresh()`），先 `await __asm.forget()` 再重新載入頁面。OPFS 的資料夾讀取權限永遠是「已允許」，所以記住的資料夾會直接使用；`__asm.remembered()` 以替身讓它回報「要再詢問」，測試對話框的「使用「X」」按鈕。
  - 每個流程開頭都會「新組合件」：上一個流程留下未存的組合件時會跳出「要儲存變更嗎？」而卡住，先重新載入頁面。流程超過 45 秒時，在背景執行並輪詢 `window.__result`。
  - 拖曳用 `H.drag(path, 'left' | 'right')`：合成的 PointerEvent 帶 `buttons`；`setPointerCapture` 對合成事件會拋錯（已忽略）。找零組件上的點用 `H.onComponent`（確認游標真的落在它上面）；等角視圖中被其他零件擋住時改用上視圖。
- **效能測試**：全部測試同時跑時（約 26 個 worker），加上開發伺服器與瀏覽器，牆上時間可能是實際工作的好幾倍。求解器的預算測試改量 CPU 時間（`process.cpuUsage`，Windows 以約 15.6 ms 為單位，所以每次量五次取平均，三批取最小；見 `packages/assembly/test/solver.test.ts`）。
- **瀏覽器腳本的指標座標要取整數**：`MouseEvent` 的 `clientX/Y` 是整數，`PointerEvent` 可以有小數；懸停用小數、點擊被取整，兩者就可能落在不同元素上（2C 遇到：懸停在面上，點擊卻選到 10 px 內的頂點）。真實滑鼠沒有這個問題。
- **在組合件中點選元素**：`tests/e2e/phase2-assembly.js` 的 `H.pickOn` 把游標移到元素上的點，確認圖面認得是那個元素才按下；看不到時轉視角、放大。被別的零件蓋住的面（例如坐在板上的底面）點不到，改選看得到的邊線，同 SW 的做法。
- **看不到畫面時檢查繪圖**：視窗隱藏時截圖會逾時，WebGL 畫布的 `toDataURL`、`drawImage` 也只得到背景。在同一段 JS 裡先呼叫 `store.viewer.render()`，再用 `gl.readPixels` 讀回像素，就能確認畫了什麼。
- **UI 驗收腳本**（`tests/e2e/phase1-demo-parts.js`）：
  - 用法：在頁面中 `await import('/@fs/<檢出路徑>/tests/e2e/phase1-demo-parts.js?' + Date.now())`，再 `await __demo.plate()`（或 `vblock()`、`pin()`）。
  - 規則：點擊一律落在畫布可見範圍內；先用滾輪縮放、Ctrl+中鍵平移到合適比例（空草圖按「全部顯示」會放大到約 700 px/mm）。
  - 被擋住的邊線點不到，要先轉動視角或換標準視角。
  - 短線要點中段，因為 7 px 內有點時會選到點。
  - 瀏覽器窗格隱藏時重新載入的頁面不會繪製，畫布的 ResizeObserver 不觸發，畫布停在 300×150。腳本在每個零件開始時呼叫 `store.viewer.resize()`（`H.ready()`）。
- **舊版樣本檔**：`tests/fixtures/old-versions/` 由舊版程式寫出，不可修改（產生方式見該目錄的 README）。
- **STEP 金樣**：`tests/fixtures/step/` 的檔案固定輸入面的順序；升級幾何核心後若這個測試失敗，代表輸入面的名稱會變，要先處理遷移。
- **ShapeFix**：對乾淨的檔案也會回報「已修改」，所以只在有效性檢查失敗時才修復（ADR 0009）。
- **網路工具**：WebSearch/WebFetch 在此環境會失敗，改用內建瀏覽器查資料。SW 2010 的線上說明可以讀：`https://help.solidworks.com/2010/english/SolidWorks/help_list.htm?id=18.5.13`（伸長）這類頁面，網址從左側目錄的連結取得；第一次會有 cookie 橫幅，選「只用必要的 cookies」。
- **開發伺服器的快取**：新增工作區套件（要先 `npm install`）、搬動或刪除原始檔（例如 `expr.ts` 變成 `expr/`）之後，Vite 會記著舊的解析結果而回 500／404；重啟開發伺服器（`preview_stop` 再 `preview_start`）。
- **Windows**：
  - Git 的 LF→CRLF 警告無害。
  - 沒有 pnpm，使用 npm workspaces。
  - Node 26。
- **這一輪（3b-5、3b-6）踩到的坑**（2026-10-03）：
  - **PowerShell 5.1 與中文**：`.ps1` 檔沒有 BOM 時會以 ANSI 讀，裡面的中文會變亂碼而解析失敗。要改含中文的檔案：把中文放進 UTF-8 的 JSON 或文字檔，腳本只有 ASCII，用 `[IO.File]::ReadAllText(路徑, (New-Object Text.UTF8Encoding($false)))` 讀；直接寫在命令列裡的中文沒問題。多行修改用 Edit 工具，不要在 PowerShell 字串裡用反引號、`${`、`\n`。`handoff.md` 是 CRLF、**沒有 BOM**，不要用 `Get-Content | Set-Content`。
  - **Claude 桌面版把 `%LOCALAPPDATA%` 重新導向到它的套件資料夾**（`C:\WpSystem\…\Claude_*\LocalCache\Local`）：Rust 的 `fs::rename` 在那裡會失敗（「系統無法將檔案移到不同的磁碟機」）。Tauri 的 NSIS 工具因此要設 `bundle.useLocalToolsDir`（已設）；環境變數 `TAURI_BUNDLER_TOOLS_PATH`、改 `LOCALAPPDATA` 都沒用。別的 Rust 工具若遇到同樣的錯，也是這個原因。Claude 的「終端機」面板的 shell 整合在這台壞了（`claude-desktop.ps1` 找不到），`run_in_terminal` 打不出命令。
  - **計時型測試會隨負載波動**：`rebuild-speed`、`interference` 在整套平行跑時時間會變成三倍以上。`rebuild-speed` 量 CPU 時間（預算 5000 ms）；`interference` 以「比對的零件對數」把關（37 對，不是 190 對），時間只留寬鬆的上限；真正的時間要在安靜時單獨跑量（20 個零組件約 1.0 s 牆上時間）。
  - **預覽伺服器的埠 5391 是 `strictPort`**：`npm run dev -w @3db/desktop`（`tauri dev`）會自己開 vite，要先 `preview_stop` 內建瀏覽器的伺服器。
  - **內建瀏覽器**：視窗約 1024 × 768，截圖常逾時，改用 `read_page`、`javascript_tool` 驗證；`computer` 的座標是縮放後的截圖座標（800 × 600），不是頁面座標。要模擬畫布上的點擊，對 `canvas` 派發 `click` 事件（`MouseEvent`，帶 `clientX`、`clientY`；先 `mousemove`），Viewer 聽的是 `click`。舊的 `tests/e2e/phase2-assembly.js`（`__asm.all`）假設 1280 × 720，在這個視窗和桌面視窗都失敗，不要拿它當證據。
  - **干涉與測量的資料**：夾具裡削邊銷的 r = 5 本體站在板的 r = 4 孔裡（每支約 405 mm³），是夾具本身的幾何；次組合件內部不比對，所以頂層檢查看不到。
- **Docker**：canary 映像已刪，但 `docker_data.vhdx` 仍佔 25 GB（非稀疏檔）。要把空間還給 C 槽，需要壓縮這個檔案：要系統管理員權限，並會暫停 Docker/WSL。

## 7. 與使用者的工作約定

- **語言**：
  - 回覆與文件用繁體中文，術語採 SW 2010 繁中版。
  - 程式碼識別名稱用英文。
- **全域規則**（`~/.claude/CLAUDE.md`）：
  - 第一性原理，不迎合。
  - 需求模糊先問，做了假設要明說。
  - 使用者提出方案或決策時，用五位顧問組成的智囊團審查，再由主席結論。結論要包含：
    - 值得做 / 需要改 / 應該放棄；
    - 最大風險；
    - 最缺的證據；
    - 今天最小的一步；
    - 可信度。
- **Git**：
  - 使用者要求時才提交。
  - 提交訊息結尾加 `Co-Authored-By: <當次工作階段的模型名稱> <noreply@anthropic.com>`（3a-6b 之後是 Claude Sonnet 5.5）。
  - 3a-5、3a-6 的每個子里程碑都是做完就提交推送（使用者在驗收標準第 7 項確認）；推送用 gh 的憑證：`GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never git -c credential.helper= -c "credential.helper=!gh auth git-credential" push`。
- **說明（單一來源，2026-10-06）**：UI 的使用說明只存在 i18n 目錄的 `help.<主題>.*`（主題 id = `ACTIONS` 的 id、草圖工具 `tool-<tool>` 或 `concept.*`）。**新增指令或草圖工具必須同時寫 `help.<id>.summary`**（`tests/phase8/help.test.ts` 會擋）；驗證手冊的項目標為「有問題」並修好後，依 [docs/help-links.json](docs/help-links.json) 同步改它對應主題的文字；說明裡的數字取自驗證過的預期值。
- **需要先徵求同意的動作**：下載、刪除/覆寫、對外動作。
- **階段閘門**：每個階段由使用者在 SW 對照驗收，通過後才進下一階段。

## 8. 使用者的待辦

### 最新狀態（2026-10-09；以下 Phase 分項保留歷史參考）

- 程式與自動驗證已完成並推送到 `main`（commit `1a2dd3b`）。最近完整驗證：`verify:ui` 125/125；`npm run check` 183 檔通過、3 檔略過，2481 項通過、22 項略過；`npm run build` 成功，伴隨兩項 Vite 警告。
- 尚待實機／外部確認：I10、F7、D9 實體操作；D9 375／390／768 視口；F6 外部 PDF 開啟；F4／K2 標註用語；G5／I9 外部 CAD 檢視；J 樣本與 SolidWorks 對照；K 標準決定；L 項目的許可與選做收尾。
- 瀏覽器對 localhost 權限被阻擋時不得改走其他瀏覽器路徑繞過。自動化截圖／合成事件不能標成實機通過。
- 公開樣本已從 OSF 取得並測試匯入；真正的 SolidWorks 特徵樹、分析及製造結果比對尚未完成。

**逐項的實機驗證清單（88 項，含步驟、預期結果、回報格式）：[docs/manual-verification.html](docs/manual-verification.html)**，用瀏覽器開，狀態與備註存在瀏覽器裡，做完按「複製結果」貼回來。以下是各階段的原始待辦。

**Phase 7 鈑金的待辦（2026-10-04；ADR 0091 的最後一節有完整版）**

- A. **一個真實的鈑金支架**：用同一個板厚、半徑、K 因子在 SW 看平板型式的外包尺寸與折彎線位置，與這裡的「平板型式」視窗對（差距多半來自定義：凸緣長度量到外側／內側虛擬交點、K 因子）；把輸出的 DXF 用你的 CAD 或雷射切割軟體開，看輪廓、`BEND` 層與註記。
- B. 真人走一遍：「鈑金」頁的基材凸緣（平板、折過的板）、邊線凸緣、摺邊、縮短與離隙、平板型式、量規表、檢查，回報不順的地方。
- C. **你要決定**：沒做的——凸折（板中間，需要切開並移動一半實體的新核心操作）、（封閉角落已在 H-6 做完，ADR 0095）、斷開角落、長圓與撕裂離隙、折過的基材上的凸緣的平板型式、3D 視圖的展開／摺疊切換、除料特徵進平板型式（折彎之後才切的孔）、平板型式進工程圖；（2026-10-09：長圓與撕裂離隙 ADR 0120 已做。）（2026-10-07 之後：斜接 ADR 0110、中間折彎 ADR 0111、折彎後的孔進平板型式 ADR 0113、折過基材上的凸緣的平板型式 ADR 0114、3D 視窗展開 ADR 0115 都已做完；平板型式進工程圖 ADR 0106。）摺邊的最小半徑：ADR 0093 已決定不另訂規則（金樣的假警報已消除），等有工廠的數值再加。
- D. 檢查的預設比例（半徑 1 倍板厚、平直段 4 倍、孔到折彎 2 倍）是我的起點，不是標準——請改成你工廠的規定；量規表沒有預設列。

**Phase 6 塑膠件的待辦（2026-10-04；ADR 0082 的最後一節有完整版）**

- A. **一個真實的塑膠件**（STEP 或你的零件檔）：各跑拔模、底切、厚度分析，與 SW 的同一種分析對顏色與數字（厚度的定義我不知道 SW 用哪個；真實件的曲面壁、肋、圓角的取樣行為沒試過）。
- B. 真人走一遍：開零件 → 工具頁的三種分析（方向、要求角度、厚度上下限）→ 特徵頁的唇與溝槽、螺柱、卡榫、卡榫的窗、排氣口、不等殼厚的薄殼，回報不順的地方。
- C. **你要決定**：（螺柱孔的拔模已在 H-4 做完，ADR 0093：選項 A，孔有自己的拔模角）；卡榫站在底上要開窗：已做成卡榫的選項（ADR 0107）。
- D. 瀏覽器裡殘留的「找到沒有儲存的零件」是舊的測試副本，按「捨棄」；之後的 e2e 腳本會自己收尾（`H.tidy()`）。

**Phase 4b 檢具的待辦（2026-10-03；ADR 0073 的最後一節有完整版）**

- A. **一個真實的沖壓件或塑膠件 STEP**：放進主模型（輸入修復會先處理），畫草圖投影到要做型面的面，偏移 3 mm（看 PropertyManager 說的間隙），厚面，回報哪裡失敗（曲面是修剪過的 B 樣條、面多又小時，偏移、縫織、分割線的穩定度只有真實檔案知道）。
- B. 真人走一遍：開零件 → 分割線 → 偏移曲面 → 延伸／修剪／縫織 → 厚面或以曲面除料，回報不順的地方；畫布上真的點選與曲面的顯示（雙面）我沒有人眼確認。
- C. 輸出的 STEP（型面塊）用別的 CAD 開：偏移曲面已轉成 B 樣條（ADR 0072），讀不讀得進沒有試過；轉換器中止時輸出會警告。
- D. 已做：曲面之間的「互相修剪」（ADR 0109）、厚面「兩側」與保留曲面（ADR 0108）；厚面遇到尖角會拒絕（ADR 0112）。還沒做：除料用任意向量當方向。

**Phase 5 工程圖的待辦（2026-10-03；ADR 0065 的最後一節有完整版）**

- A. **用真實的程式開輸出**：用 Chrome 開一張夾具圖的 PDF、用你的 CAD（AutoCAD、DraftSight…）開同一張的 DXF：看線寬、虛線、箭頭、中文、尺寸文字的位置。PDF 要中文請先在工程圖面板的「PDF 字型…」選一個字型檔（例如 `C:\Windows\Fonts\msjh.ttc`）。這是 Phase 5 驗收②的 B 段。
- B. 真人走一遍：開零件或組合件 →「新工程圖」→ 自動尺寸、孔表、剖面、零件表與號球 → 輸出，回報不順的地方（尺寸堆疊太擠、號球位置、孔表欄寬）。
- C. 對照你的標準：公差表（ISO 286，`packages/model/src/tolerance.ts`，表值是手打的）、孔標註的用語（貫穿、深、沉頭）、標題圖塊的欄位與位置。
- D. 號球與表格的拖曳（2026-10-09，ADR 0119，工程圖 Schema 9）已做。（螺紋孔與錐孔的孔標註 2026-10-07 已做，ADR 0101；角度尺寸 ADR 0100；DXF 的 DIMENSION 圖元 ADR 0102，沒有真正的 CAD 開過。）

**Phase 4a 的待辦（2026-10-03，使用者決定先走完開發、對接時再修正；ADR 0059 的最後一節有完整版）**

- A. **一個真實的夾具案例**：工件 STEP（含曲面更好）、你在 SW 做的夾具截圖、你常用的廠商定位銷與螺絲的 STEP。第一步：把真實工件放進主模型（輸入本體、標為參考本體），走 `tests/phase4/acceptance-4a.test.ts` 同一條流程，看輸入修復、衍生零件、結合、干涉與餘隙的實況。
- B. 用 eDrawings（或 SW）開輸出的組合件 STEP，目測階層、位置與顏色。
- C. 真人走一遍：新零件做主模型 →「從本體產生組合件」→ 插入零組件的「標準件圖庫」→ 結合（含進階結合）→ 干涉／餘隙 → 改主模型，回報不順的地方。
- D. 對照你的標準：圖庫的尺寸表（ISO 4762／8734／7089）、定位銷孔的公差表（ISO 286-1），都在 `packages/library`、`packages/model/src/dowel.ts`，表值是手打的。
- 還有：Phase 3 的補驗收（下面的 0–6 項）仍然順延。



0. **桌面版的人工驗收（3b-6 第 3、7 項，2026-10-03）**：在沒裝過開發工具的 Windows 帳號（或另一台電腦）安裝 `3D-Builder_0.1.0_x64-setup.exe`，斷網啟動，用**原生對話框**存、開 `.3dbx` 與 `.3dba`，開一個真的專案資料夾，最後解除安裝；步驟在 [ADR 0052](docs/adr/0052-desktop-shell.md)「要使用者做的」。安裝檔不在版本庫，在這台 `npm run build -w @3db/desktop` 重做就有。
1. **Phase 2 驗收樣本（已結案，範圍降低）**：藍圖要的是使用者的一個 SW 組合件（10–20 個零組件）。
   - **使用者沒有 SW，只有 eDrawings（2026-09-30）**：所以藍圖驗收 ③「在 SW 開啟」與「用 SW 樣本重組」都無法照原文做。改為把金樣夾具（15 個零組件）輸出成 `<使用者資料夾>\Downloads\金樣夾具-15零組件.step`（`STEP_OUT_DIR=<資料夾>` 跑 `tests/phase2/golden-assembly.test.ts` 產生），用 eDrawings 開啟目測。**使用者已開啟，看到的與下述一致**（eDrawings 不是 OCCT，是獨立於我們的讀取器），並**明確接受這個較低的範圍作為 Phase 2 閘門（2026-09-30）**。該檔案有：3 塊定位板並排（x = 0、120、240）、每塊 2 支削邊銷插在孔中（x ± 40）、2 個疊起來的 V 型塊在板的正中央（底面在 y = 15 與 55）。
   - **之後若有人有 SW**：可補做原本的驗收，需要一個保留結構的組合件 STEP（下面的說明）。不阻擋 Phase 3。
   - **目前狀態（2026-09-30）**：`<使用者資料夾>\Downloads\SW樣本` 有 `CIV0000467治具_step.STEP`、`3D_MT17203_CIV0000467_Porduct.STEP` 與 `T1405001.SLDASM`，**都不能用來驗收**：兩個 STEP 各只有 1 個 `PRODUCT`、1 個實體、0 個 `NEXT_ASSEMBLY_USAGE_OCCURRENCE`（AP203，組合件被併成單一實體；治具 2004 個面、130×100×10 mm，產品件 340 個面）；`.SLDASM` 是 SW 的專有壓縮格式，讀不出零件參照，我們沒有讀取器，它的零件檔（`.SLDPRT`）也沒給。需要重新輸出：每個不同的零件各一個 STEP，外加一個保留組合件結構的組合件 STEP（檢查：搜尋 `NEXT_ASSEMBLY_USAGE_OCCURRENCE`，應有 10 次以上）。
   - （2026-10-01）樣本資料夾多了 `組合件1.step`（16 MB）：檔頭是 Open CASCADE 8.0、2 個實體、2 個 `NEXT_ASSEMBLY_USAGE_OCCURRENCE`，是本工具自己輸出的（治具加產品件），不是 SW 的輸出，不能當 3b 的樣本。
   - 每個不同的零件各自輸出 STEP；重複使用的零件只要一份。這些檔案輸入後當零件用。
   - 整個組合件的 STEP，或各零組件位置的截圖，用來比對位置。組合件 STEP 輸入是 Phase 3b，所以只拿來對照。
   - 最晚在 2F 前提供；越早越好，2E 的 STEP 組合件輸出也能拿它對照。
2. **2A–2E 實機確認（已完成，2026-09-30）**：使用者用自己的瀏覽器走完下面五組（建立與存檔、結合、移動與參考檔、輸出 STEP、載入進度），系統的資料夾與存檔對話框都確認過。過程中發現右鍵旋轉沒有任何提示，已補上圖面提示（`f14d266`）。測試用的專案資料夾是 `<使用者資料夾>\Downloads\3DB實機確認`（金樣零件的複本）。伺服器是用背景程序加暫存設定啟動的（`F:` 磁碟不能 `npm run dev`，見 §6「工作區連結」）。以下是當時的步驟，留作日後再測的清單：
   - 先建立一個專案資料夾（例如「文件\CIV0000467」），把 STEP 檔（或 .3dbx）放進去；不建議直接選「下載」。
   - 「檔案」→「新組合件」：直接進入「開始組合件」，先選這個專案資料夾（Windows 的選資料夾視窗只顯示資料夾，看不到檔案是正常的；瀏覽器會詢問是否允許讀取）；清單會列出資料夾裡的 .3dbx 與 STEP 檔；
   - 在清單點一個零件、按 ✓ 放在原點（固定）；再用「組合件」→「插入零組件」插入零件，其中一個插入兩次，在圖面點一下放置；
   - 「儲存檔案」存進這個資料夾（或它的子資料夾）→「新零件」→「開啟舊檔」開回組合件，位置應該不變。
   - （2C）「組合件」→「結合」：點孔的內壁與銷的柄（小孔要先用滾輪放大），PropertyManager 會建議「同軸心」，按 ✓；再點板面與凸緣的底邊 → 「重合」→ ✓。設計樹的結合資料夾會列出它們，零組件前的 (-) 表示還能動。
   - （2D）用左鍵拖曳還能動的零組件：沒有結合的會跟著游標平移；插在孔裡的銷只會繞孔轉。右鍵拖曳是旋轉。固定或完全定義的零組件拖不動，狀態列會說明。「組合件」→「移動零組件」可以輸入 Delta XYZ、至 XYZ 位置，「旋轉零組件」輸入角度。
   - （2D）設計樹在零組件上按右鍵 →「開啟零件」：改一個尺寸、存檔，再按零件設計樹上方的「返回組合件」，組合件會顯示改過的零件，結合仍成立。
   - （2D）在檔案總管把一個零件檔改名，再開啟組合件：會出現「找不到參考的檔案」，按「瀏覽…」選改名後的檔案。
   - （2D）重新整理頁面後開啟組合件：資料夾對話框會有「使用「資料夾名稱」」，瀏覽器會再問一次是否允許讀取（可以選「每次造訪都允許」，之後就不再問）。
   - （2E）在有零組件的組合件按「檔案」→「輸出 STEP」，會下載 `<組合件名>.step`。用 SW 開啟：應該是一個組合件，零件名稱是檔名，零組件名稱如「削邊銷<2>」，位置與畫面一致（結合移動過的零件是移動後的位置）。若零件檔遺失，會顯示檔名並中止，不產生檔案。
3. **Phase 3 驗收樣本**：3 個真實零件的 SW 輸出 STEP、特徵清單、關鍵尺寸；沒有 SW 的替代驗收**使用者已接受（2026-09-30）**；還缺哪 3 個零件。給同事的說明已寫在 `docs/sw-export-request.md`（未追蹤，使用者決定先擱置）。細節見 [docs/phase3-plan.md](docs/phase3-plan.md) §5、§6。
4. Phase 4 樣本：1–2 個夾治具案例、常用廠商標準件的 STEP。
5. （可選）壓縮 Docker 虛擬磁碟；刪除 `spike/occt-gaps` 分支。
6. **3a-1 到 3a-6 的實機確認（使用者 2026-10-01 決定先保留）**：各項要驗收的步驟寫在 §10 對應的段落（運算式、輸入修復與直接編輯、多本體、草圖工具、特徵 I、異型孔、掃出——尤其「直線加圓弧」的路徑、疊層拉伸、肋材）。自動化測試與瀏覽器腳本都已通過，但還沒有人用滑鼠走過一遍；3a-10 驗收前要補。
7. **2026-10-08 已裁的兩項，不要重複提出**：
   - ① **推送**：2026-10-08 已推，`origin/main` 現在是 `92f3476`（這台電腦之前未推的四個提交都上去了：`9e9f617` 組合件的資料夾／剖面／眼睛／右鍵選單、`f5e8377` Vite 設定檔的 `.ts` 副檔名、`2270fd9` 與 `92f3476` 兩版本文件）。**要留意的**：推的時候 H9 的人工實機項目還沒走完（使用者要自己走一遍）。`9e9f617` 那版沒有動任何 `*.test.ts`，只加了三個瀏覽器重播腳本（`tests/e2e/manual-h9-folder.js`、`manual-asm-section.js`、`manual-asm-menu.js`），所以 `packages/render/src/viewer.ts` 的 124 行改動（新增 116、刪除 8）與 `AssemblyViewport.tsx`、`Viewport.tsx` 的渲染改動**不在 `npm run check` 的保護範圍內**——之後再碰這些地方，驗法要用 `npm run verify:ui`（它重播手冊並抓 Console 錯誤），只跑 `npm run check` 擋不住渲染回歸。
   - ①b **推送（2026-10-09）**：`bf25dcf`（工程圖視圖連動：前視圖整組移動、上視／右視沿對齊方向滑動、右下角把手改比例、`sheet.shift` 與視圖 `slide`，圖紙檔 Schema 7）與 `0bd7031`（「最適比例」把標註算進去，`fit.ts`）。這兩版與 `9e9f617` 不同：**有單元測試**（`tests/phase5/drawing-linked.test.ts` 17 項、`drawing-fit.test.ts` 8 項），所以排版與格式部分受 `npm run check` 保護；視窗互動（拖曳、把手）仍只有瀏覽器腳本 `manual-drawing-linked.js`。推送前依上一條的要求跑了：`npm run check` 2395 項通過；完整 `npm run verify:ui` **120 支全過、0 個 Console 錯誤**（包含 `9e9f617` 那三支剖面／眼睛／右鍵／資料夾重播）。
   - ② **「import 一律自帶副檔名」的全倉庫統一：不做。**帶副檔名的只有兩處——`apps/web/vite.config.ts`（Vite 的硬性要求）與 `tests/phase8/auto-close.test.ts`（跟著統一）；剩下 763 處／312 個檔案維持無副檔名。要重開這件事的時機：Vite 真的把 `configLoader` 改成 `native` 預設，或還有別的設定檔需要帶副檔名時；屆時單獨一版，不要混進功能提交。


## 9. 歷史存檔紀錄

Phase 1、Phase 2 及藍圖歷史紀錄已依 2026-10-10 決策歸檔至 [docs/handoff-history.md](docs/handoff-history.md)（維持內容完全一致）。

