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

## Phase 126 Details: Smart Dimension Arc Condition (Line-to-Circle)
- [x] Backend: Implement Line-to-Circle PBD projection logic in `ConstraintSolver.ts`.
- [x] UI: Implement `Tabs` and `Tab` components for PropertyManager.
- [x] UI: Refactor `SketchPropertyManager.tsx` to include "Leaders" tab and Arc Condition selection.
- [x] Verification: Automated test `test_line_to_circle_distance.ts` passes with high precision.

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

## Current Phase
All high-priority SolidWorks alignment and structural cleanup phases completed. Arc Condition (Line-to-Circle) implemented and verified. v1.1 established.
