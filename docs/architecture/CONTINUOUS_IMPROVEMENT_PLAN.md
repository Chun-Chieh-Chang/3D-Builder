# 3D-Builder 持續改進執行計畫 (Continuous Improvement Execution Plan)

> **目標**：針對 《SOLIDWORKS 2025 全面性操作對齊與功能缺口審計報告》中未達 100% 的項目，制定具體、可執行的技術路徑與迭代計畫 (PDCA)。

---

## 🟢 高度對齊區區段持續優化 (80% - 99%)
*此區段目標是「從可用到好用」，補齊邊界條件與進階使用者體驗。*

### 1. 使用者介面 (當前 90%) -> 目標 100%
*   **缺口**：缺乏自訂巨集快捷鍵、手勢操作 (Mouse Gestures)。
*   **執行計畫 (Sprint UI-1)**：
    *   **P (Plan)**：設計 `GestureRing.tsx` 元件。
    *   **D (Do)**：在 `Viewport.tsx` 實作滑鼠右鍵拖曳的軌跡判定 (捕捉 8 個方位的 Vector 方向)。將方向映射至最常用的指令（如：上=標註，下=矩形，左=直線，右=圓）。
    *   **C (Check)**：確保手勢判定不會與 3D 旋轉 (滑鼠中鍵) 衝突。
    *   **A (Act)**：將巨集對應表寫入 `useCadStore` 的持久化配置。

### 2. 顯示與檢視 (當前 95%) -> 目標 100%
*   **缺口**：缺乏 RealView 擬真渲染與即時陰影。
*   **執行計畫 (Sprint VIS-1)**：
    *   **P**：評估 Three.js 的 `EffectComposer` (SSAO, SMAA)。
    *   **D**：在 `SceneSetup.tsx` 中引入 `ContactShadows` 與 `Environment` (HDRI 貼圖)。
    *   **C**：監控 WebGL 的 Draw Calls，確保開啟 RealView 時 FPS > 30。

### 3. 草圖繪製 (當前 95%) -> 目標 100%
*   **缺口**：缺乏 3D 草圖與樣條曲線 (Spline) 控制把手。
*   **執行計畫 (Sprint SK-1)**：
    *   **P**：研究 `ConstraintSolver.ts` 擴充至 3D 空間 (X, Y, Z) 的幾何雅可比矩陣 (Jacobian)。
    *   **D**：利用 `Geom_BSplineCurve` 在後端實作樣條，並在前端實作可拖曳的切線向量把手 (Tangent Handles)。
    *   **C**：驗證 Spline 曲率梳 (Curvature Combs) 顯示正確性。

### 4. 零件和特徵 (當前 85%) -> 目標 100%
*   **缺口**：缺乏 3D 曲線特徵、拔模 (Draft)、抽殼 (Shell)。
*   **執行計畫 (Sprint FEAT-1)**：
    *   **P**：查閱 OpenCASCADE `BRepOffsetAPI_MakeThickSolid` 與 `BRepOffsetAPI_DraftAngle` API。
    *   **D**：在 `geometry_service.py` 封裝 Draft 與 Shell 邏輯，需處理多面選擇 (Faces to Remove / Neutral Plane)。
    *   **C**：撰寫 E2E 測試，確保薄殼在複雜曲面上不會產生拓撲自交 (Self-intersection)。

---

## 🟡 部分對齊區段補強計畫 (30% - 79%)
*此區段目標是「模組功能完整化」，確保該模組能獨立處理一個完整的工程工作流。*

### 5. 歡迎對話方塊 (當前 50%) -> 目標 90%
*   **執行計畫 (Sprint SYS-1)**：
    *   **D**：實作 `IndexedDB` 存取專案縮圖 (Base64) 與修改時間。建立 `WelcomeDialog.tsx` 顯示最近使用的檔案清單，點擊即載入。

### 6. 從 2D 到 3D (當前 60%) -> 目標 90%
*   **缺口**：缺乏 DXF/DWG 匯入與修復。
*   **執行計畫 (Sprint IO-1)**：
    *   **P**：選擇 `dxf-parser` 或後端 `ezdxf`。
    *   **D**：將 DXF 的 Line/Arc 轉換為 `SketchEdge` 格式。實作公差修復算法 (Heal Edges)，自動將端點距離 < 0.1mm 的線段閉合為 Loop。

### 7. 組合件 (當前 40%) -> 目標 80%
*   **缺口**：缺乏進階配合 (齒輪, 凸輪)、動態機構模擬。
*   **執行計畫 (Sprint ASM-1)**：
    *   **P**：評估前端引入 `rapier3d` (Rust/WASM 物理引擎) 的可行性。
    *   **D**：將 `geometry_service` 計算出的 Collision Mesh 餵給物理引擎。將現有的 Mate 轉換為物理引擎的 Joints (如 Hinge, Slider)。
    *   **C**：實作「拖動以模擬 (Drag to Animate)」，確保齒輪嚙合時不會穿模。

---

## 🔴 核心缺失區段建設計畫 (0% - 29%)
*此區段是阻礙產品化的最大瓶頸，需投入最大資源進行「從零到一」的架構建設。*

### 8. 尺寸細目與工程圖 (當前 10%) -> 目標 70% (可用基準)
*   **優先級**：🔥🔥🔥 (最高)
*   **執行計畫 (Sprint DRAW-1 to DRAW-3)**：
    *   **P (Phase 1)**：後端實作 `HLRBRep` (Hidden Line Removal)。給定一個 3D Shape 與視角 (Top/Front/Right)，輸出 2D 向量線段 (可見線與隱藏線)。
    *   **D (Phase 2)**：前端開發 `DrawingSheet.tsx` (全新的 2D SVG 畫布環境)。接收後端的向量資料並繪製。
    *   **D (Phase 3)**：實作 `Smart Dimension` 標註工具，允許在 2D 視圖上標註尺寸，並雙向連結至 3D 模型的參數。
    *   **C**：匯出工業標準的 PDF 與 DXF 圖紙。

### 9. 模型組態 / Design Table (當前 0%) -> 目標 80%
*   **優先級**：🔥🔥
*   **執行計畫 (Sprint CFG-1)**：
    *   **P**：在 Zustand Store 的 `CadState` 中，將 `features` 陣列重構為支援多版本的樹狀結構 (`configurations` dictionary)。
    *   **D**：實作 ConfigurationManager 側邊欄。允許切換組態時，套用不同的參數覆蓋表 (Parameter Overrides) 或特徵抑制狀態 (Suppression State)。
    *   **A**：支援匯入 CSV 作為 Design Table 驅動模型變體。

### 10. 鈑金 (Sheet Metal) (當前 0%) -> 目標 60% (MVP)
*   **優先級**：🔥
*   **執行計畫 (Sprint SMT-1)**：
    *   **P**：研究 OpenCASCADE 的展平算法限制。
    *   **D**：實作 `Base Flange` (基材法蘭) 特徵。實作 K-Factor (中性軸係數) 計算邏輯。
    *   **C**：能將簡單的 L 型鈑金件一鍵切換為 Flat Pattern (平坦圖樣)，並精確計算下料尺寸。

---

## 執行與追蹤機制

1.  **Issue Tracking**：以上每個 Sprint 皆需轉化為 GitHub 上的 Epics 與 Issues。
2.  **SCS 驗收門檻**：每個 Sprint 結束時，必須更新 `gap-checklist.md` 並重新計算 SCS 分數。
3.  **雙週 PDCA 循環**：由 Agent 每兩週抽取一個 Sprint 進行 [分析] -> [實作] -> [確效] -> [交付] 的閉環開發。