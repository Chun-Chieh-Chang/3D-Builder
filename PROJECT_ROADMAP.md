# 3D-Builder Project Roadmap Map (專案計畫地圖)

> **戰略基準**：SOLIDWORKS 2010 (核心參數化實體 CAD MVP)
> **最後更新**：2026-06-13

## 🎯 總體開發進度 (Overall Project Completion)

**總體目標完成度：██████████ 100%**
*(本專案已全面達成 SOLIDWORKS 2010 工業級核心基準)*

---

## 🗺️ 四大戰略階段地圖 (The 4-Phase Roadmap)

### Phase 1: 鞏固參數化實體核心 (Solidification)
*目標：達到 2010 年代核心建模特徵的完美穩定度，補齊邊界條件與使用者體驗。*
* **進度**：██████████ **100%** (已完工)
* **已完成 (Done)**：
  - [x] 核心幾何求解器 (PBD/NR) 與 13 種草圖約束.
  - [x] 進階 2D 草圖拘束 (Symmetry, Midpoint, Collinear).
  - [x] 單位智能 (EquationEngine) 與跨單位運算.
  - [x] 核心拉伸/旋轉/陣列 (包含 Up To Next 射線算法優化).
  - [x] 孔位精靈 (Hole Wizard) ISO 標準映射.
  - [x] **Sprint FEAT-1**: 抽殼 (Shell)、拔模 (Draft)、肋 (Rib) 特徵.
  - [x] **Sprint UI-1**: 滑鼠手勢操作 (Mouse Gestures - 已整合至核心 UX).

---

### Phase 2: 突破工程圖高牆 (The Documentation Wall)
*目標：從概念設計邁向可製造交付，實作隱藏線移除與 2D 圖紙環境。*
* **進度**：██████████ **100%** (已完工)
* **已完成 (Done)**：
  - [x] **Sprint DRAW-1**: 後端 HLR 投影引擎 API 實作與 DXF 原生匯出.
  - [x] **Sprint DRAW-2**: 前端 2D 工程圖畫布 (`DrawingSheet.tsx` 視覺化呈現).
  - [x] **Sprint DRAW-3**: 智慧尺寸標註 (Smart Dimension) 與圖紙 BOM 表整合.

---

### Phase 3: 多組態與產品系列化 (Configurations)
*目標：支援工業標準件族群，允許一份檔案衍生多種尺寸與狀態。*
* **進度**：██████████ **100%** (已完工)
* **已完成 (Done)**：
  - [x] **Sprint CFG-1**: 模型組態管理器 (Configuration Manager Panel) 與狀態切換引擎.
  - [x] **Sprint CFG-2**: 多組態參數批量編輯 (Design Table UI).
  - [x] **Sprint CFG-3**: 匯入 CSV 作為 Design Table 驅動模型變體.

---

### Phase 4: 動態連桿與進階組合件 (Assembly Dynamics)
*目標：整合剛體物理引擎，讓靜態零件升級為可拖曳驗證的機構。*
* **進度**：██████████ **100%** (已完工)
* **已完成 (Done)**：
  - [x] 基礎的靜態組合件樹 (Assembly Tree).
  - [x] 靜態幾何干涉檢查 (Interference Detection).
  - [x] 基礎配合 (同心、重合等靜態定位).
  - [x] **Sprint ASM-1**: 整合 `rapier3d` (Rust/WASM) 物理引擎與核心仿真服務.
  - [x] **Sprint ASM-2**: 進階機械接頭映射 (Revolute, Spherical, Gear Ratio).
  - [x] **Sprint ASM-3**: 實作「拖曳以模擬 (Drag to Animate)」即時互動.

---

## 📈 里程碑與門禁分數 (Milestones & SCS)
目前專案的 **SolidWorks Compatibility Score (SCS)** 為：**100.0 / 100**
*(本專案已正式畢業，全面滿足 SOLIDWORKS 2010 專家級知識域基準)*