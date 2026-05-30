# 3D-Builder CAD — 開發交接指南 (Handover Resume Guide)

> 📅 最後更新：2026-05-30  
> ✅ TypeScript 確效: `npx tsc --noEmit` 零錯誤通過  
> 🧩 本文件旨在讓任何工具或帳號讀取後，能無縫繼續開發工作。

---

## 🗂️ 專案概覽

**3D-Builder** 是一個運行於瀏覽器的工業級 CAD 應用程式，類似簡化版 SolidWorks。

- **前端**: Next.js 14 (App Router) + React Three Fiber (3D) + Zustand (狀態)
- **後端**: Python FastAPI + PythonOCC (OpenCASCADE B-Rep 幾何核)
- **部署**: GitHub Pages (前端 Static Export) + 使用者本地啟動 Python 後端

---

## 🏗️ 核心架構圖 (Phase 55+ 模組化後)

```
src/
├── app/page.tsx            ← 核心組合入口
├── hooks/
│   ├── useFeatureBuilders.ts    ← 幾何特徵構建邏輯 (Extrude, Revolve, etc.)
│   ├── useAppIntegrations.ts   ← Electron IPC, 快捷鍵 (S-key), 系統整合
│   ├── usePartRebuild.ts       ← 後端重建管線
│   └── usePartDocument.ts      ← 檔案讀寫
├── store/useCadStore.ts    ← Zustand 全域狀態 (已清理 legacy 屬性)
├── ui/
│   ├── RibbonBar/          ← 頂部工具欄組件
│   ├── Modals/             ← 質量分析、轉換引導等彈窗
│   ├── CadToast.tsx        ← 專業 CAD 通知系統
│   └── ShortcutBox.tsx     ← S-Key 快捷選單
└── renderer/
    ├── Viewport.tsx        ← Three.js 場景與射線檢測
    └── OcctShape.tsx       ← 實體網格渲染
```

---

## 📊 目前完成的功能 (Phases 1–57)

| Phase | 功能 | 狀態 |
|-------|------|------|
| 1–54  | 建模、渲染、S-Key、TNS、工程圖等 | ✅ 完成 |
| 55 | Architecture Decoupling (page.tsx Refactoring) | ✅ |
| 56 | Sketch Validation UX & Toast System | ✅ |
| 57 | Advanced 3D Mirror Feature | ✅ |
| 58-60 | Patterning, Guidance, TNS 3.0 | ✅ |
| 61 | STEP Import UI Workflow | ✅ |
| 62 | Convert & Offset Entities | ✅ |
| **63** | **Sweep & Loft UX** | ✅ **最新** |

---

## 🔑 Phase 63 實作細節 (最新完成)

### 新增：Sweep & Loft UX (掃掠與疊層拉伸介面升級)
**功能描述**：對標 SolidWorks 2000 的進階曲面建模交互，徹底解決原先 PropertyManager 的硬編碼限制。
- **Sweep (掃掠)**：明確區分「輪廓 (Profile)」與「路徑 (Path)」選單，並附帶圖形化的標籤，加入選取防呆機制 (未選滿無法建構)。
- **Loft (疊層拉伸)**：捨棄只能選取 2 個草圖的限制，改用多選晶片 (Multi-select Chip) 介面。支援無限多個斷面草圖，並具備上移、下移、刪除按鈕，精確控制疊層拉伸的拓撲順序。

---

## 🔑 Phase 62 實作細節 (最新完成)

### 新增：Convert & Offset Entities (轉換與偏移實體)
**功能描述**：對標 SolidWorks 2000 的核心草圖工具，允許復用現有 3D 幾何或草圖輪廓。
- **Convert Entities (轉換實體)**：支援選取 3D 面或邊界，一鍵投影至當前草圖平面，並自動生成 `sketchNodes` 與 `sketchEdges`。
- **Offset Entities (偏移實體)**：自動識別草圖中的閉合/開放路徑，根據使用者輸入的距離等距偏移生成新線段。
- **全端對接**：打通了前端 `ShortcutBox` UI 到後端 `HeavyEngineClient` 的 HTTP API 呼叫，並完成 Graph 拓樸的動態註入。

---

## 🔑 Phase 61 實作細節

### 新增：Frontend STEP Import Workflow (前端 STEP 匯入工作流)
**功能描述**：補齊後端 `import_step_file` API 的前端 UI 入口，支援標準件/外購件的直接匯入，並作為 `DUMB_SOLID` 掛載於特徵樹中，完成 CAD 生態系的閉環。

---

## 🔑 Phase 57 實作細節 (最新完成)

### 新增：Advanced 3D Mirror Feature (進階特徵鏡射)
**功能描述**：升級鏡射功能至工業級標準，支援針對多個特定特徵進行鏡射。
- **多特徵支援**：後端支援 `target_feature_ids` 列表，允許同時鏡射一組孔、筋或凸台，而不再僅限於整體實體。
- **高精度幾何核**：採用 `BRepBuilderAPI_Transform` 進行非破壞性鏡射變換，確保幾何精度。
- **晶片式選取 UI**：在 `PartFeaturePropertyManager` 實作「多選晶片 (Multi-select Chip)」介面，提供直觀的特徵管理體驗。

---

## 🔑 Phase 56 實作細節

### 新增：Sketch Validation UX & Toast System (草圖驗證優化)
**功能描述**：提升草圖錯誤診斷的專業度。使用 `CadToast` 取代 `alert`，並以紅色脈衝標記標示懸空端點 (Dangling Nodes)。

---

## 🔑 Phase 55 實作細節

### 新增：Architecture Decoupling & Refactoring (架構解耦與重構)
**功能描述**：將 3,400+ 行的 `page.tsx` 進行外科手術式拆解，消滅「上帝物件」。

---

## 🚀 接下來開發建議 (Next Agent Actions)

如果您接手本專案，建議從以下任務開始：

1. **健全 TNS 3.0**：支援面與面的父子繼承，處理更複雜的拓撲重映射（例如鏡射後的面選取）。
2. **動態約束引導 (Dynamic Constraint Guidance)**：在草圖模式下，當滑鼠靠近可建立約束的位置時，顯示虛擬約束圖示（如水平、垂直）。
3. **手機/平板響應式優化**：針對觸控環境優化 S-Key 菜單與 PropertyManager。
4. **多特徵陣列 (Multi-feature Pattern)**：比照 Phase 57 的模式，讓 Pattern 也能支援選取多個特徵進行環形或線性陣列。

---

## 🛡️ 開發紀律 (必讀)

1. **修改前執行 `npx tsc --noEmit`**。
2. **保持 Hooks 職責純粹**：幾何建構 logic 應留在 `useFeatureBuilders`。
3. **視覺反饋優先**：任何幾何運算失敗都應觸發 `pushToast` 並盡可能在 `Viewport` 提供視覺線索。
