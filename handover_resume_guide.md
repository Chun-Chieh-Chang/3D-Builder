# 3D Builder - 續寫與開發交接指南 (Handover & Resume Guide)

## 1. 專案當前狀態 (Current Project State)
**[2026-05-23] Phase 14: 基準面交互深度優化與自動化防禦實裝**

本專案已成功打通「基準面 (Datum Planes) ➔ 選取表面 (Face) ➔ 草圖啟動」的完整交互鏈路，並建立了基於 Git Hooks 的型別安全自動化門禁。

### 核心技術棧 (Tech Stack)
- **前端**: Next.js 15+, Three.js (React Three Fiber), Zustand (狀態管理), GSAP (動畫).
- **後端**: Python 3.10+, FastAPI, OpenCASCADE (pythonOCC) 幾何核心.
- **桌面端**: Electron (提供原生檔案系統存取與 PDF 輸出).
- **智庫**: SkillsBuilder (整合 193+ 專家角色與 Nexus 協作協議).

### 關鍵功能實現
- **智慧平面選取**: 點擊基準面或實體表面可立即高亮並設為「活動平面」，支援「正對面 (Normal To)」相機自動轉正。
- **全參數化數據鏈**: 特徵持久化儲存 `sketchNodes`、`sketchEdges` 與 `sketchConstraints`，確保 100% 編輯回溯。
- **SolidWorks 對標 UI/UX**:
  - **前景視圖工具欄 (Heads-up Toolbar)**：新增 Normal To 與視角切換。
  - **設計樹退回控制棒 (Rollback Bar)**.
  - **S-Key 模式感知快捷選單**.
  - **草圖狀態視覺化**: 完全定義 (黑)、欠定義 (藍)、衝突 (紅).
- **自動化門禁**: 實裝 Git `pre-commit` hook，強制執行 `npx tsc --noEmit`，從源頭杜絕型別錯誤。

## 2. 開發紀律與核心原則 (Core Principles)
- **PDCA 循環**: 所有任務必須遵循 Plan (計畫) -> Do (執行) -> Check (確效) -> Act (優化) 流程。
- **Anti-Vibe Coding**: 嚴禁猜測性修復。所有 Bug 必須在 `DEV_LOG.md` 留下 RCA (根因分析) 與 CAPA (預防措施) 紀錄。
- **MECE 代碼清掃**: 定期執行代碼清掃（如已徹底移除 demo/可樂瓶相關代碼），保持專案純淨。
- **型別守衛**: 提交前必須通過 `npx tsc --noEmit`，確保全域型別安全。

## 3. 續寫者必讀：如何接手 (How to Resume)
### 步驟 1: 環境同步
執行 `powershell .\INSTALL.ps1`。這會自動同步 SkillsBuilder 技能、配置 Git Hooks 並檢查 Python 環境。

### 步驟 2: 理解 Wiki
查閱 `wiki/index.md`。專案大腦已將「幾何約束數學」、「圖論模型」與「渲染管線」實體化。

### 步驟 3: 遵守 PDCA
1. 讀取 `docs/productization/PRODUCTIZATION_PLAN.md` 作為產品化 Plan of Record。
2. 讀取 `DEV_LOG.md` 最後一筆記錄，確認上一個 Phase 的閉環狀態。
3. 開始新的開發循環前，先列出待解決的「缺口 (Gaps)」，並遵循「介面先行」原則進行型別定義。
4. 完成每次開發或修訂後，執行 `npx tsc --noEmit` 或嘗試 `git commit`（會自動觸發檢查）。
5. 若檢查不通過，依 `docs/governance/RCA_CAPA_TEMPLATE.md` 在 `DEV_LOG.md` 執行 RCA/CAPA，再修正。

## 4. 下一步開發藍圖 (Roadmap)
1. **進階組合件約束 (Advanced Assembly Mates)**:
   - 目前僅支援基本 Mate。需要實作路徑約束與機械連動。
2. **性能優化 (Smart Rebuild)**:
   - 實作「髒標記 (Dirty Flag)」機制，避免無關特徵的重複重構。
3. **雲端協作預備**:
   - 將目前的 Zustand 狀態部分遷移至 Nexus 協議支持的 CRDT 結構，為未來多人協作鋪路。

---
*本文件由 AI Agent 在 2026-05-23 自動更新，確保開發上下文無縫傳承。*
