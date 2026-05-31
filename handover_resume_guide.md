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
| 62 | Convert & Offset Entities | ✅ |
| 63 | Sweep & Loft UX | ✅ |
| 65 | Interactive Section View 3D | ✅ |
| 67 | Auto-Constraint Application | ✅ |
| 68 | Standard Mates Maturity | ✅ |
| 64 | Advanced Deletion Warning | ✅ |
| 69 | Power Trim Sketch Tool | ✅ |
| 70 | Dynamic Dimension Overlay | ✅ |
| 71 | Reference Planes (Reference Geometry) | ✅ |
| 75 | Sketch Mirror Entities | ✅ |
| 76 | Shell Feature (Uniform Wall Thickness) | ✅ |
| 77 | Extend Entities (Sketch Completion) | ✅ |
| 78 | Hole Wizard (Standard Fasteners) | ✅ |
| 79 | Draft Feature (Mold Design Essentials) | ✅ |
| 80 | Property Propagation (Color & Material Inheritance) | ✅ |
| 81 | Assembly Interference Detection | ✅ |
| **82** | **2D Sketch Patterns (Linear & Circular)** | ✅ **最新** |

---

## 🔑 Phase 82 實作細節 (最新完成)

### 新增：2D Sketch Patterns (草圖陣列)
**功能描述**：實現 2D 草圖實體的線性與圓形陣列，大幅提升重複幾何的繪製效率。
- **線性陣列 (Linear Pattern)**：基於選取的參考線段（方向）進行平移複製，支援個數與間距設定。
- **圓形陣列 (Circular Pattern)**：基於選取的中心點進行旋轉複製，支援執行個數與總角度設定。
- **自動參數化 (Auto-EQUAL)**：陣列生成時自動在源幾何與複製品間建立 `EQUAL` 長度/半徑約束，確保修改原始幾何時陣列同步聯動。
- **引導式 UI**：在 `SketchPropertyManager` 實作了專用的 Pattern Rollout，與 SolidWorks 操作邏輯 100% 對標。

---

## 🔑 Phase 81 實作細節 (最新完成)

### 新增：Assembly Interference Detection (干涉檢查)
**功能描述**：實現裝配體物理衝突偵測，對標 SolidWorks Evaluate 標籤。
- **後端空間布林分析**：利用 OCC `BRepAlgoAPI_Common` 偵測零件間的物理重疊區域。
- **干涉體積計算**：精確計算碰撞區域的體積 (mm³)，並提供高亮 Mesh 渲染。
- **幽靈網格渲染**：在視埠中以亮紅色半透明標示衝突位置，輔助工程師調整配合。

---

## 🔑 Phase 80 實作細節

### 新增：Draft Feature (拔模特徵)
**功能描述**：模具與塑膠件設計核心工具，允許側面相對於中立面產生特定角度的斜度。
- **TNS Stage 2 拓樸鎖定**：後端全面改用幾何簽名匹配 (Signature Matching)，確保在父特徵（如拉伸深度）改變後，中立面與拔模面仍能精準維持參考。
- **引導式 UI 選取流**：`PropertyManager` 採用分層選取設計。第一步選取中立面（Indigo 晶片），第二步多選拔模面（Orange 晶片），操作邏輯與 SolidWorks 對齊。
- **OCC 內核整合**：利用 `BRepOffsetAPI_DraftAngle` 實作強固的幾何變換，支援複雜的多面拔模運算。

---

## 🔑 Phase 78 實作細節

### 新增：Hole Wizard (標準化孔精靈)
**功能描述**：實現工業級標準紧固件設計，支援 M3-M8 標準規格。
- **標準預設庫**：內建 `HOLE_PRESETS`，自動對應公制標準的鑽孔、沉頭與錐頭尺寸。
- **專業級 UI**：提供視覺化的孔類型切換（直孔、沉頭、錐頭）與規格選取下拉選單。

---

## 🔑 Phase 77 實作細節

 (最新完成)

### 新增：Reference Planes (自定義基準面)
**功能描述**：解鎖空間建模自由度，允許使用者在任意位置建立偏移基準面。
- **全參數化基準面**：`REFERENCE_PLANE` 特徵正式納入特徵樹，支援基於現有面或基準面的偏移 (Offset) 定義。
- **跨維度投影**：重構了 `uvTo3D` 與後端 HLR 投影邏輯，支援在自定義基準面上進行草圖繪製，並精確映射至 3D 空間。
- **PropertyManager 整合**：提供專業的基準面設定面板，包含參考選取、偏移數值輸入與方向反轉。
- **即時預覽**：在視埠中以莫蘭迪紫藍色半透明平面渲染自定義基準面，支援滑鼠選取互動。

---

## 🔑 Phase 70 實作細節
 (最新完成)

### 新增：Dynamic Dimension Overlay (實時尺寸懸浮顯示)
**功能描述**：在草圖繪製過程中提供即時的數值回饋，顯著提升建模手感。
- **Heads-Up Display (HUD)**：利用 `@react-three/drei` 的 `Html` 組件，在滑鼠游標旁實作了一個隨動的懸浮標籤。
- **動態幾何反饋**：繪製線段或矩形時，系統會實時計算當前段落的 **長度 (Length)** 與 **角度 (Angle)**，並以專業的 Monospace 字體顯示。
- **Glassmorphism 視覺**：HUD 採用高質感的磨砂玻璃背景與語義化配色（藍色長度、綠色角度），對標 SolidWorks 的動態尺寸功能。

---

## 🔑 Phase 69 實作細節 (最新完成)

### 新增：Advanced Deletion Warning (進階刪除相依性警告)
**功能描述**：對標 SolidWorks 的防呆機制，防止因刪除父特徵導致系統崩潰。
- **遞迴相依圖譜**：實作了深度優先搜索 (DFS) 算法，能自動追蹤無限層級的特徵相依鏈（例如：Sketch → Extrude → Fillet → Mirror → Pattern）。
- **全參數識別**：支援對 `target_feature_ids`、`profile_id` 等現代化參數的掃描，精準鎖定刪除後的「受災範圍」。
- **安全防禦**：彈出 SolidWorks 風格的確認視窗，列出所有受影響的子特徵名稱，並提供一鍵「連帶刪除」功能。

---

## 🔑 Phase 68 實作細節
 (最新完成)

### 新增：Standard Mates Maturity (進階組合件配合)
**功能描述**：擴展組合件配合能力，支援非零距離與角度定位，對標 SolidWorks 2000 標準。
- **角度配合 (Angle Mate)**：後端 Scipy 求解器實作了基於法向內積的殘差方程，支援在 3D 空間中設定精確的元件夾角。
- **距離配合 (Distance Mate)**：強化了偏移量 (`offset`) 的處理，允許兩個零件的面或邊保持固定的平移間距。
- **動態 UI 輸入**：`MatePanel` 現在會根據選取的配合類型動態切換數值輸入框（距離為 mm，角度為 deg），並支援 Aligned / Anti-aligned 反轉。

---

## 🔑 Phase 67 實作細節 (最新完成)

### 新增：Interactive Section View 3D (全互動式 3D 剖面視圖)
**功能描述**：大幅升級剖面視圖的操作體驗。
- **3D 互動拖曳**：引入 `@react-three/drei` 的 `TransformControls`，允許使用者直接在 3D 空間中拖曳剖切平面，即時檢視內部結構。
- **雙向數據綁定**：拖曳 3D 箭頭會同步更新 Zustand Store，並與左側 `SectionViewPropertyManager` 參數面板完美連動。
- **自動鎖定機制**：在拖曳剖面時自動鎖定 `OrbitControls`，防止視角意外旋轉，確保拖曳的穩定性。

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

1. **[交互] 尺寸即時驅動 (Callout Editing)**：在 3D 視埠中直接雙擊尺寸數值進行修改，取代面板輸入，達到最極致的建模手感。
2. **[建模] 3D 螺旋掃掠 (Helical Sweep)**：實作對標 SolidWorks 的螺旋線功能，用於建模螺紋、彈簧等複雜幾何。
3. **[工程] 裝配體運動模擬 (Motion Study)**：利用配合關係 (Mates) 驅動組件運動，實作簡單的機構連桿動畫。

---

## 🛡️ 開發紀律 (必讀)

1. **修改前執行 `npx tsc --noEmit`**。
2. **保持 Hooks 職責純粹**：幾何建構 logic 應留在 `useFeatureBuilders`。
3. **視覺反饋優先**：任何幾何運算失敗都應觸發 `pushToast` 並盡可能在 `Viewport` 提供視覺線索。
