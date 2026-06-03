# 3D-Builder CAD — 開發交接指南 (Handover Resume Guide)

> 📅 最後更新：2026-06-03  
> 🏆 **版本狀態**: v1.1 (Independence & Modular UI Release)  
> ✅ TypeScript 確效: `npx tsc --noEmit` 零錯誤通過  
> 🏁 **基準對標**: SolidWorks 2000 Parity + Modular Architecture

---

## 🗂️ 專案概覽

**3D-Builder** 是一個運行於瀏覽器的工業級 CAD 應用程式，實現了 1:1 的 SolidWorks 經典建模體驗。

### 2026-06-03 最新架構變動
- **UI 模組化重構**: 
  - `page.tsx` 已完成「去中心化」，核心邏輯已抽離至 `src/ui/FeatureManagerPanel.tsx` (設計樹)、`src/hooks/useFeatureBuilders.ts` (幾何構建) 等模組。
  - 狀態管理依然由 `useCadStore.ts` 統一控管。
- **獨立性缺口優化 (Independence Gap)**:
  - 實作了「草圖與實體特徵」的完整數據鏈。每個特徵現在都會儲存其原始的 `sketchNodes`, `sketchEdges`, `sketchConstraints`。
  - 支援草圖獨立顯示/隱藏切換 (設計樹中的 👁️ 圖示)。

---

## 🏗️ 關鍵工程子系統

### 1. 拓撲持久化 (TNS 2.0)
- **原理**: 透過 `BRepAlgoAPI_History` 在重建過程中追蹤面、邊的演化。
- **位置**: `backend/app/services/geometry_service.py` 中的 `TopologicalLinker`。

### 2. 參數化草圖數據鏈 (Sketch Data Chain)
- **機制**: 在退出草圖模式時，系統會將 `sketchNodes`, `sketchEdges`, `sketchConstraints` 深度拷貝至特徵參數中。
- **顯示**: `SketchPreview.tsx` 支持渲染「被動草圖 (Passive Sketches)」，當選取特徵時，會自動高亮對應草圖並浮現智慧尺寸。

### 3. UI 交互系統
- **設計樹 (`src/ui/FeatureManagerPanel.tsx`)**: 支持拖拽重排、回退棒 (Rollback Bar)、以及特徵/草圖的巢狀結構展示。
- **快捷工具 (`src/ui/ShortcutBox.tsx`)**: 模式感知 (Mode-aware) 的 S-Key 快捷選單。

---

## 📊 目前完成的功能 (Phase 1–118)

| 子系統 | 關鍵功能 | 狀態 |
|-------|------|------|
| **草圖** | 約束求解器、樣條曲線、投影、偏移、獨立顯示控制 | ✅ 1.1 強化 |
| **特徵** | 伸長、旋轉、掃掠、疊層拉伸、圓角、倒角、薄殼 | ✅ 1.1 強化 |
| **設計樹** | 拖拽重排、歷史回退棒、巢狀草圖控制 | ✅ 1.1 強化 |
| **數據鏈** | 全參數化儲存、Legacy Fallback | ✅ 1.1 強化 |

---

## 🛡️ 開發紀律 (Agent Guardrails)

1. **PDCA 循環**: 修改代碼前必須更新 `task_plan.md`。完成後執行 `npx tsc --noEmit`。
2. **MECE 整理**: 提交前必須確保日誌與交接文檔同步。
3. **數據鏈保護**: 嚴禁在修改幾何邏輯時丟棄草圖約束數據。

---

## 🚀 未來研發建議

1. **[性能] 支援多線程重建**: 利用 Python `multiprocessing` 加速。
2. **[交互] 智慧標註 2.0**: 實作 3D 空間中的 PMI 標註與實體尺寸拖動連動。
3. **[架構] 插件化擴充**: 實作基於 WASM 的自定義幾何運算插件。

---

## 🚦 開發接續指引 (Resume Protocol)

任何新接手的 Agent 或開發者，請優先檢查 `src/ui/FeatureManagerPanel.tsx` 與 `src/hooks/useFeatureBuilders.ts` 以了解當前的交互與構建邏輯。

**3D-Builder 已完成「獨立性」與「模組化」的重大里程碑。**
