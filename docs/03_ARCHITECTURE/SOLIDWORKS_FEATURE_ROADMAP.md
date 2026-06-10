# SolidWorks-Clone: Feature Master Roadmap

這份藍圖列出了 SolidWorks 的核心功能板塊，並依照「系統相依性」與「架構輕重緩急」排序，作為後續所有開發迭代 (PDCA) 的最高指導原則。

---

## 🟥 Phase 1: 基礎設施與核心內核 (Infrastructure & Core Kernel)
*這是所有功能的根基，沒有它，後續功能都是空中樓閣。*
- [x] **Thin Client UI (Next.js)**: 屬性管理器、特徵樹、玻璃質感設計。
- [x] **Render Engine (Three.js)**: 3D 視口、光影與基礎網格顯示。
- [ ] **PythonOCC Backend Server**: FastAPI 微服務架構建置。
- [ ] **B-Rep to Mesh Pipeline**: 後端高階幾何轉三角形網格通訊。
- [ ] **File I/O (Import/Export)**: 支援 STEP / IGES 檔案格式解析與輸出。

## 🟧 Phase 2: 基礎零件建模 (Basic Part Modeling)
*建立從 2D 到 3D 的基本能力。*
- [ ] **2D Sketch Engine (草圖引擎)**: 直線、圓、弧、矩形繪製。
- [ ] **Geometric Constraints (草圖求解器)**: 平行、垂直、重合、相切、尺寸標註。
- [ ] **Base Features (基礎成型)**: Extrude (拉伸)、Revolve (旋轉)。
- [ ] **Boolean Operations (布林運算)**: Cut (切除)、Intersect (交集)。

## 🟨 Phase 3: 選擇機制與量測分析 (Selection & Measurement)
*⭐ [使用者指定重點] 必須精確抓取拓撲實體 (TopoDS) 才能進行量測。*
- [ ] **Topology Selection (拓撲選取)**: 在 3D 視口精確點選 Face (面)、Edge (邊)、Vertex (點)。
- [ ] **Measurement Tool (量測工具)**: 計算點距、邊長、夾角、面積。
- [ ] **Mass Properties (質量屬性)**: 計算體積、表面積、質心 (Center of Gravity)、慣性矩。
- [ ] **Cross Section (剖面視圖)**: 即時剖切模型內部結構。

## 🟩 Phase 4: 進階特徵工程 (Advanced Feature Engineering)
*考驗幾何內核極限的複雜操作。*
- [ ] **Applied Features (應用特徵)**: Fillet (圓角)、Chamfer (倒角)。
- [ ] **Complex Features (複雜成型)**: Sweep (掃出)、Loft (疊層拉伸)、Shell (薄殼)。
- [ ] **Patterning (陣列)**: 線性陣列、環狀陣列、鏡射。

## 🟦 Phase 5: 組合件架構 (Assembly Architecture)
*考驗系統記憶體與矩陣運算能力。*
- [ ] **Assembly Tree (組合件結構)**: 處理子組合件與零件實例 (Instances)。
- [ ] **Mates (結合條件)**: Coincident (重合)、Concentric (同心)、Distance (距離限制)。
- [ ] **Collision/Interference Detection (干涉檢查)**: 計算零件間的碰撞體積。

## 🟪 Phase 6: 2D 工程圖 (2D Drafting & Detailing)
*將 3D 模型投影至製造規格書。*
- [ ] **Orthographic Projection (正交投影)**: 三視圖、等角視圖自動生成。
- [ ] **Hidden Line Removal (HLR)**: 隱藏線消除演算法。
- [ ] **Smart Dimensions (智慧標註)**: 連結 3D 參數的 2D 尺寸線。
- [ ] **BOM (材料清單)**: 自動匯出零件表。

---

## 🚦 執行戰略 (Execution Strategy)
所有的開發都將嚴格遵守：
**Backend API 定義 -> PythonOCC 邏輯實作 -> Next.js UI 綁定 -> Three.js 渲染驗證**
