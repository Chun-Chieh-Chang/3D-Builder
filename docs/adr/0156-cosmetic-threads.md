# ADR 0156：裝飾螺紋線特徵與全鏈路渲染出圖（零件 Schema 56 → 57）

- 狀態：**已完成**
- 需求追溯：`docs/blueprint.md` 之 `| C4.9 | 裝飾螺紋線 | | P2 |`、`handoff.md` 接棒指引

---

## 1. 背景與定位

在機械 CAD 實務中（以 SolidWorks 為標竿），95% 的公螺牙（外螺紋）與母螺孔（內螺紋）皆不建立真實的 3D 螺旋實體幾何：
1. **真實 3D 螺旋幾何 (ADR 0123)**：透過 B-spline 掃出實體並與圓柱做布林 Fuse/Cut。計算沉重，且因 OCCT 內部處理 B-spline 運算元的已知限制，每次布林運算必定永久佔用 ~10 MiB Emscripten WASM Heap（見 `AGENTS.md §3.5`）。
2. **裝飾螺紋線 (Cosmetic Threads, C4.9)**：**絕不做 3D 實體布林螺旋幾何**！其特徵僅在零件特徵樹中登記規格資料，於 3D 視圖中繪製輕量化標示線（3/4 圈細實線圓弧與牙底/牙頂標註），並在 2D 工程圖中依照 ISO 6410 標準繪製 3/4 圈細實線圓弧、牙底線/牙頂線與孔標註。
3. **記憶體指標**：因不調用 OCCT 布林求解器，裝飾螺紋特徵的再生過程其 WASM Heap 成長量恆為 **0.00 MiB**（符合 `AGENTS.md §3.1` 零代理指標原則）。

---

## 2. 決定

### 2.1 資料模型與版本遷移 (Schema 56 → 57)
- 零件 Schema 版本由 56 升至 57，加入向前相容遷移（`56: (doc) => doc`）。
- 新增 `CosmeticThreadFeature`，繼承 `FeatureBase`：
  ```typescript
  export interface CosmeticThreadFeature extends FeatureBase {
    type: 'cosmeticThread';
    targetFace: Ref;             // 圓柱外表面 (公螺牙) 或孔內壁表面 (母螺孔)
    startEdge?: Ref;             // 起始端面或環狀邊 (選填，未指定時預設自圓柱端點推導)
    threadType: 'external' | 'internal'; // 公螺牙 (external) 或母螺孔 (internal)
    standardMode: 'standard' | 'custom';
    standardDesignation?: string; // 如 "M8", "M8x1.25", "1/4-20 UNC" (引用 threadStandards.ts)
    majorDiameter: Expr;         // 大徑 (mm)
    minorDiameter: Expr;         // 小徑 (mm)
    pitch: Expr;                 // 螺距 (mm)
    endCondition: 'blind' | 'through'; // 給定深度 或 完全貫穿
    depth: Expr;                 // 螺紋長度 (mm)
    reverse?: boolean;           // 沿軸向反向
  }
  ```
- 命令層支援：`insertFeature` 插入特徵，`setCosmeticThread` 指令修改參數。
- 參考追蹤與 DAG：`refs.ts` 的 `mapRefs` 加入 `cosmeticThread`，使模型變更時自動追蹤 `targetFace` 與 `startEdge`。

### 2.2 幾何規格與 ISO 6410 標準對齊
1. **外螺紋 (External Thread)**：
   - 實體圓柱面為大徑（Major Diameter），在 3D 與 2D 呈現為實體輪廓。
   - 端面處繪製小徑（Minor Diameter）之 **3/4 圈細實線圓弧**（ISO 6410-1，預設在第一象限處開口）。
   - 側視圖投影為兩條細實線（牙底線）。
2. **內螺紋 (Internal Thread)**：
   - 實體孔內壁為小徑（Minor Diameter，鑽孔底徑），呈現為實體輪廓。
   - 端面處呈現大徑（Major Diameter）之 **3/4 圈細實線圓弧**。
   - 側視圖投影為兩條虛線（牙頂線）。
3. **終止條件 (End Condition)**：
   - `through`：長度自動涵蓋圓柱全長。
   - `blind`：給定長度 $L$，在端點處繪製終止界線。

### 2.3 再生引擎與特徵萃取 (`@3db/regen`)
- `engine.ts` 中遇到 `cosmeticThread` 特徵時：
  - **嚴格禁止調用 `Kernel.thread` 或布林運算**。
  - 解析 `targetFace`，透過幾何探針驗證面幾何是否為圓柱面（`cylinder`）。非圓柱面顯式拋出錯誤 `feature.cosmeticThreadNotCylinder`（拒絕平面、錐面或自由曲面）。
  - 計算圓柱軸線、半徑、長度與起點。
  - 於 `RebuildResult` 與 `elementFacts` 登記 `CosmeticThreadFact`，隨零件結果輸出至 Worker 與 UI。

### 2.4 3D 渲染與 2D 工程圖 (`@3db/render`, `@3db/drawing`)
- **3D 檢視器 (`Viewer`)**：
  - 新增 `setCosmeticThreads(threads)`，於 3D 空間中在圓柱起點與深度終點繪製端面 3/4 細實線圓弧（直徑依公/母牙對應小徑/大徑）。
  - 若為盲孔，於深度 $L$ 處繪製終止線圈。
- **2D 工程圖 (`@3db/drawing`)**：
  - 端視圖（視線平行軸線）：繪製 3/4 圈細實線圓弧（`LINE_STYLES.thin`）。
  - 側視圖（視線垂直軸線）：在牙底/牙頂位置投影細線，盲孔加上垂直終止線。
  - 智慧型尺寸標註（Hole Callout）：選取帶有裝飾螺紋的孔或軸時，自動帶出標準螺紋標註（如 `M8x1.25 ↧ 15`）。

### 2.5 介面層 (`apps/web`)
- CommandManager「特徵」分頁與選單新增「裝飾螺紋線」按鈕。
- PropertyManager 建立 `CosmeticThreadPanel`：
  - 圓柱面選取槽（點選凸圓柱面或孔內壁，自動判定公/母螺牙）。
  - 起始邊/端面選取槽。
  - 標準規格下拉選單（引用 `ALL_STANDARD_THREADS` 42 種 ISO Metric / UNC 規格）與自訂選項。
  - 終止條件（給定深度、完全貫穿）與深度輸入欄。

---

## 3. 紅隊對抗與防禦硬約束（AGENTS.md §2.1 & §3.1）

1. **輸入破壞 (Input Corruption)**：
   - 點選非圓柱面（平面、球體、環面、錐面、B-spline）時，命令層顯式拋出 `feature.cosmeticThreadNotCylinder` 錯誤，絕不默默靜默或產生退化幾何。
   - 深度數值 $\le 0$、`NaN`、無限大時，命令層顯式拋出 `feature.cosmeticThreadBadDepth`，嚴禁使用 `Math.abs` 隱含篡改。
2. **零代理指標與真值存在性防呆**：
   - 記憶體確效測試監控 `(oc as any).wasmMemory?.buffer?.byteLength`，斷言基準堆存在且大於 0（`expect(initial).toBeGreaterThan(0)`），並驗證裝飾螺紋連續再生 50 次 WASM Heap 成長量為 **0.00 MiB**。
3. **依賴鏈完整性**：
   - 支援完整鏈路：`schema.ts` ➔ `commands.ts` ➔ `refs.ts` ➔ `serialize.ts` ➔ `engine.ts` ➔ `viewer.ts` ➔ `drawing` ➔ `PropertyManager.tsx`。
4. **規格真實性與零 Mock**：
   - 大徑、小徑、螺距從 ISO 68-1 / ISO 261 / ASME B1.1 標準推導，斷言真實 2D/3D 圓弧直徑與手算標準值相符。
