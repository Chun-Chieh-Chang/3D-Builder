# SOLIDWORKS_FEATURE_ROADMAP.md - 3D-Builder 開發藍圖

> **身分聲明**：本專案由「資深全端 CAD 架構師」主導，對標 SolidWorks 工業標準，採用 OpenCASCADE (OCCT) 核心，並深度融合 `SkillsBuilder` 的 PDCA 雙層智庫與工程確效規範。

---

## 📅 開發階段規劃 (Phased Development Roadmap)

### Phase 1: B-Rep 內核與參數化管道 (已完成/加固) ✅
- [x] **重型引擎轉向**：建立 FastAPI + PythonOCC (OCCT) 伺服器端架構。
- [x] **拓撲內核實作**：放棄幾何體 API，改為基於 Edge/Wire/Face/Solid 的拓撲構造邏輯。
- [x] **布林運算序列**：實作長出 (Join) 與除料 (Cut) 的歷史樹運算。
- [x] **基礎 UI**：建立 Glass Order 風格介面與實時渲染視口。

### Phase 2: 圖論草圖引擎與 PBD 約束系統 (已完成/重構) ✅
- [x] **基準面系統 (Datum Planes)**：Front (XY), Top (XZ), Right (YZ) 三大預設基準面與動態雙向 Normal To 相機。
- [x] **Graph-based 數據結構**：捨棄舊數組，全面重構為 `sketchNodes`、`sketchEdges` 與 `sketchConstraints` 圖論模型。
- [x] **PBD (Position-Based Dynamics) 約束求解器**：實作 `COINCIDENT`、`HORIZONTAL`、`VERTICAL`、`DISTANCE`、`EQUAL` 約束鬆弛。
- [x] **智慧繪圖力學**：Click-Drag (單條繪製) 與 Click-Click (連續線) 雙重力學、對稱中點直線、A-Arc 懸停/按鍵熱切換、構造中心線複合解析。
- [x] **捕捉吸附 (O-Snap)**：精準捕捉原點、端點、特徵頂點、網格並提供黃金級橘色磁吸視覺反饋。

### Phase 3: 拓撲選取與面基草圖 (已完成) ✅
- [x] **精密拾取系統 (Picking System)**：實作 `TopologySelector`，支援穿透與 preserve-selection 機制，精確拾取 3D 面 (Face) 與邊 (Edge)。
- [x] **面上草圖 (Sketch on Face)**：選取任意 3D 平面，動態建立正交局部座標系 (LCS)，實現滑鼠 3D 座標投影與面上二次特徵起草。
- [x] **雙向連動與高亮**：3D 視埠點擊與 FeatureManager 設計樹節點雙向高亮，提供 Indigo/Magenta/Amber 高階 Morandi 視覺效果。
- [x] **關係動態視覺化**：懸停設計樹節點自動計算「父特徵 (Parents)」與「子特徵 (Children)」依賴關係，並於 3D 視埠以紅/綠/藍高亮鏈條渲染。

### Phase 4: 高階引用與特徵複製 (已完成) ✅
- [x] **實體引用工具鏈**：實作轉換實體引用 (Convert)、偏置實體引用 (Offset, 呼叫 OCCT `BRepOffsetAPI_MakeOffset` 核心)、剖面交叉曲線 (Section)。
- [x] **特徵陣列複製 (Patterns)**：支援線性 (Linear) 與環形 (Circular) 陣列，呼叫後端 OCC 進行分身投影與布林 Fuse/Cut 拓撲重建。
- [x] **PropertyManager 工具鏈**：提供 SolidWorks 風格的左側 PropertyManager 卡片式屬性管理器，引導用戶操作。

### Phase 5: 圖論剖析與 OCCT 生成對接 (當前任務/規劃中) 🚀
- [ ] **最小循環圖論演算法 (Minimum Cycle Basis)**：實作圖論閉合面自動提取，將 `sketchNodes`/`sketchEdges` 的 Graph 結構解析成封閉迴圈，通過 Electron IPC 送至 OCCT 進行 3D Extrusion/Boolean。
- [ ] **PBD 約束求解器擴展**：實作 `ANGLE` (固定角度)、`DISTANCE_VAL` (點線/線線距離) 與 `TANGENT` (圓弧相切)。
- [ ] **三維配合與裝配體 (Assembly Mates)**：支援多組件 (Components) 載入，並實作重合、同軸心、平行等裝配配合 (Mates)。

### Phase 6: 工程確效與分析 (規劃中) 🔍
- [ ] **質量屬性量測**：透過 OCCT `GProp_GProps` 計算精確體積、表面積、重心位置與慣性矩。
- [ ] **干涉檢查**：自動計算裝配體中的碰撞與重疊區域。
- [ ] **工業級文件匯出**：支援 STEP, IGES, STL 高精度 CAD 標準格式匯出。
