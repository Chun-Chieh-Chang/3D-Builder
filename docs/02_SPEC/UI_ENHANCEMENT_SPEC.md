# UI Enhancement Specification: SolidWorks Alignment

## 1. 前景視圖工具欄 (Heads-up View Toolbar)

### 1.1 視覺設計 (Plan)
- **位置**：3D Viewport 正上方中央。
- **樣式**：半透明毛玻璃背景 (Glassmorphism)，Slate-800 文字/圖示。
- **按鈕清單**：
    - `Zoom to Fit` (整頁縮放)：將模型置中並調整縮放比例。
    - `View Orientation` (視圖定向)：快速切換 Front, Top, Right, Isometric。
    - `Display Style` (顯示樣式)：切換 Shaded with Edges / Wireframe。
    - `Section View` (剖面視圖)：切換 3D 剖切顯示（初步僅需 UI 佔位）。

### 1.2 實作細節 (Do)
- 建立 `src/ui/HeadsUpToolbar.tsx` 組件。
- 使用 Tailwind CSS 的 `backdrop-blur-md` 與 `bg-white/50`。
- 對接 `useCadStore` 中的相機控制與顯示狀態。

---

## 2. 2D 空間尺寸標註 (Dimension Callouts)

### 2.1 視覺設計 (Plan)
- **位置**：草圖模式下，顯示在被約束線段的中點旁。
- **樣式**：典型的 CAD 尺寸線（雙向箭頭 + 數值標籤）。
- **互動**：點擊標籤彈出小視窗修改數值。

### 2.2 實作細節 (Do)
- 在 `src/renderer/SketchPreview.tsx` 或新建立的 `src/renderer/DimensionRenderer.tsx` 中實作。
- 使用 `@react-three/drei` 的 `<Html />` 或 `<Text />` 進行空間渲染。
- 對接 `sketchConstraints` 中的 `DISTANCE` 類型數據。

---

## 3. PDCA 循環流程 (PDCA Cycle)

### [P] Plan (規劃)
- 根據 SolidWorks 截圖定義 UI 比例與色彩規範。
- 定義資料狀態結構（如何存儲當前視圖樣式）。

### [D] Do (執行)
- 開發組件並整合進 `Viewport.tsx`。
- 連結 PBD Solver 的輸出至 3D Callouts。

### [C] Check (檢查)
- 驗證點擊工具欄按鈕後相機是否正確移動。
- 驗證修改 Callout 數值後，草圖是否根據 PBD Solver 實時變形。

### [A] Act (行動/收尾)
- 根據檢查結果調整 UI 抖動或 Z-fighting 問題。
- 將最終變更記錄至 `wiki/log.md`。
