# Task Plan - SW2000 Industrial Parity (Phases 92-100)

## Goal
Transform 3D-Builder from a functional prototype into a 1:1 SolidWorks 2000 industrial-grade modeling software. This includes professionalizing the UI (PropertyManager 2.0), completing the feature set (Sweep, Loft, Draft), and ensuring high engineering robustness (TNS 2.0).

## Phases
| Phase | Title | Status | Description |
|-------|-------|--------|-------------|
| 92 | PropertyManager 2.0 | complete | Rollout-based wizard UI for features |
| 93 | Reference Geometry | complete | Standard industrial reference planes and axes |
| 94 | Sweep & Loft | complete | Advanced geometry construction |
| 95 | TNS 2.0 (Persistence) | complete | Robust topological naming system |
| 96 | Engineering Drawing | complete | Automatic BOM and professional annotations |
| 97 | Configuration Manager | complete | Part variations and feature suppression |
| 98 | Equations & Variables | complete | Parametric formulas and global variables |
| 99 | Mechanical Mates | complete | Gear, Screw, and dynamic assembly constraints |
| 100 | Final Polish & Toolbox | complete | Standard library and SW2000 aesthetic finish |
| 101 | Industrial Reinforcements | complete | Integrated Draft, Advanced Surfacing, and Surfaces Tab |
| 118 | UI 模組化與交接基準點建立 | complete | 拆解 `page.tsx` 冗餘邏輯，建立 v1.1 交接文檔與開發日誌 |
| 119 | Project Cleanup & MECE | complete | 移除冗餘腳本、資產與中間產物，歸檔架構文件，建立 v1.1 乾淨基準點 |
| 120 | SkillsBuilder: Exercise 6 | complete | 解析影片 6XyeGEqHrjI 並透過 Hybrid Verification 完成建模驗證 |
| 121 | SkillsBuilder: Exercise 1 | complete | 解析影片 FqK9rs50upg 並完成帶有角度約束之幾何驗證 |
| 122 | SkillsBuilder: CADable Ex 5 | complete | 解析影片 soEP5_cBqMI 並完成替代方案 (Sketch Fillet -> 3D Fillet) 驗證 |
| 123 | SkillsBuilder: Beginner Tutorial | complete | 解析影片 cWWP_-QRdkg，驗證基礎約束與等效旋轉特徵 |
| 124 | SkillsBuilder: Exercise 11 | complete | 解析影片 -LL3eSTyWe8，驗證圓柱特徵、同心約束與環狀陣列 |
| 125 | SkillsBuilder: Plummer Block Base | complete | 解析影片 mOU5bb50pgs，驗證相切約束與多重輪廓擠出 |
| 126 | SkillsBuilder: Arc Condition | complete | 解析影片 COsyShU3l3g，實現直線到圓弧的距離約束與分頁 UI |
| 127 | SkillsBuilder: Fillet Order | complete | 解析影片 Index 61，實現特徵管理員重排與 UI 優化 |
| 128 | Loft Industrial Reinforcement | complete | 升級 Loft 演算法支援導引曲線與多斷面選取 |
| 129 | Thin Feature (Extrude) | complete | 實現薄件特徵，支援從 2D 草圖生成中空管狀或薄壁實體 |
| 130 | 2D Linear Pattern | complete | 升級排列特徵支援 Direction 2，實現工業級網格/矩陣生成能力 |
| 131 | Unit Intelligence | complete | 實現多單位 (mm, in, cm) 自動換算與數學表達式評估 |
| 132 | Circular Pattern Reinforcement | complete | 實現等間距 (Equal Spacing) 與排除執行個體 (Skip Instances) |
| 133 | Fill Pattern | complete | 實現邊界填入排列，支援 Square/Hex 佈局與邊距控制 |
| 134 | Surface Cut | complete | 實現曲面除料，支援使用曲面或基準面作為刀具切割實體 |

## Phase 134 Details: Surface Cut (Advanced Solid Trimming)
- [x] Backend: Implemented `SURFACE_CUT` logic using `BRepPrimAPI_MakeHalfSpace`.
- [x] UI: Added "Surface Cut" action in `RibbonController.tsx`.
- [x] UI: Added "Surface Cut" tool selector and flip toggle in `PartFeaturePropertyManager.tsx`.
- [x] Data: Ensured `tool_feature_id` properly links to offset/knit/plane features.

## Phase 133 Details: Fill Pattern (Boundary-Based Filling)
- [x] Backend: Implemented `BRepTopAdaptor_FClass2d` based containment logic.
- [x] Backend: Developed grid generation algorithms for Square, Perforation, and Hexagonal layouts.
- [x] UI: Added "Fill Boundary" selection and layout control rollouts to `PartFeaturePropertyManager.tsx`.
- [x] UX: Integrated rotation angle and margin controls for precise area filling.

## Phase 132 Details: Circular Pattern Reinforcement
- [x] Backend: Implemented `equalSpacing` logic and `instancesToSkip` filter.
- [x] Backend: Enhanced axis resolution to support Face (Cylindrical) and Edge (Circular) types.
- [x] UI: Added dedicated rollout with skip management and spacing toggles.

## Phase 131 Details: Unit Intelligence (Multi-Unit Evaluation)
- [x] Logic: Upgraded `EquationEngine` with automated unit suffix preprocessing.
- [x] UI: Implemented `SmartNumericInput` for seamless 2D/3D dimension conversion.
- [x] UX: Followed SolidWorks safety protocols for immediate unit normalization.

## Phase 130 Details: 2D Linear Pattern (Direction 2)
- [x] Backend: Upgraded `PATTERN` handler with nested loops and dual-vector translation.
- [x] UI: Added "Direction 2" rollout to `PartFeaturePropertyManager.tsx` with Enable toggle and independent spacing/count.
- [x] Architecture: Verified orthogonal direction defaults and edge-based direction resolution.

## Phase 129 Details: Thin Feature (Extrude)
- [x] Backend: Integrated `BRepOffsetAPI_MakeOffset` into the EXTRUDE workflow.
- [x] UI: Added "Thin Feature" rollout to `PartFeaturePropertyManager.tsx`.
- [x] State: Extended `CADFeature` parameters to include thin-wall properties.

## Phase 128 Details: Loft Industrial Reinforcement
- [x] Backend: Upgraded to `BRepFill_PipeShell` for guided surface interpolation.
- [x] UI: Implemented "Guide Curves" rollout in `PartFeaturePropertyManager.tsx`.
- [x] Data: Fixed loop indexing and multi-sketch point extraction.

## Phase 127 Details: Fillet Order & Feature Reordering
- [x] UI: Added visual Drag Handles to `FeatureManagerPanel.tsx`.
- [x] UI: Optimized `ShortcutBox.tsx` with premium SVG icons for Fillet/Chamfer.
- [x] Architecture: Verified that reordering triggers a full B-Rep rebuild in history order.

## Phase 118 Details: UI 模組化與交接基準點建立
- [x] Plan: 拆解 `page.tsx` 冗餘邏輯，建立 v1.1 交接文檔與開發日誌。
- [x] Do: 
  - 實作 `FeatureManagerPanel.tsx` 模組化。
  - 更新 `handover_resume_guide.md` 與 `DEV_LOG.md`。
  - 清理冗餘狀態與代碼。
- [x] Check: `npx tsc --noEmit` 通過。
- [x] Act: 準備推送至 Github。

---

## Current Status
- [x] Phase 92-101: SW2000 Industrial Parity
- [x] Phase 118: UI Modularization & Baseline
- [x] Phase 119: Project Cleanup & MECE
- [x] Phase 120-125: SkillsBuilder Video Verification Series
- [x] Phase 126: SkillsBuilder: Arc Condition (Line-to-Circle)
- [x] Phase 127: SkillsBuilder: Fillet Order
- [x] Phase 128: Loft Industrial Reinforcement
- [x] Phase 129: Thin Feature (Extrude)
- [x] Phase 130: 2D Linear Pattern (Direction 2)
- [x] Phase 131: Unit Intelligence (Multi-Unit Evaluation)
- [x] Phase 132: Circular Pattern Reinforcement
- [x] Phase 133: Fill Pattern (Boundary-Based)
- [x] Phase 134: Surface Cut (Advanced Solid Trimming)

## Current Phase
All high-priority SolidWorks alignment and structural cleanup phases completed. Surface Cut with arbitrary boundary clipping implemented. v1.10 established.
