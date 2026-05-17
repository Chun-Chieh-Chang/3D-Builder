# DEV_LOG.md - Skill Architect 開發日誌

> **⚠️ Anti-Vibe Coding 紀律宣告**
> 所有 Bug 修復與系統變更，必須在此日誌留下 RCA (Root Cause Analysis) 與 CAPA (Corrective and Preventive Actions) 的結構化紀錄。禁止「猜測性」的盲目修復。
> 
> **標準診斷模板 (Standard Diagnostic Template)：**
> - **Phase 1: Investigation (根因調查)** - 錯誤重現路徑與證據蒐集
> - **Phase 2: Pattern (模式分析)** - 正常範例對比與參考文件查閱
> - **Phase 3: Hypothesis (假設分析 RCA)** - 根本原因假設與驗證結果
> - **Phase 4: Fix & Verify (精準修復 CAPA)** - 修復邏輯、驗證結果與預防策略






---

## 🛑 專案開發鐵律 (Core Development Principles)
1. **不重複造輪子 (Don't Reinvent the Wheel)**: 凡是有現成、穩定、工業標準的開源工具（如 OpenCASCADE, SolveSpace, React Three Fiber），必須直接引進並封裝對接，嚴禁從零自行開發底層數學或圖形邏輯。

---

## [2026-05-16] 建立 SolidWorks 全功能藍圖 (Master Feature Roadmap)


### 任務內容

- **戰略規劃**：暫緩程式開發，根據使用者要求，對標 SolidWorks 的全域功能（Part, Assembly, Drawing, Analysis）進行 Top-Down 的優先級排序。
- **文檔產出**：建立 `SOLIDWORKS_FEATURE_ROADMAP.md`。
- **關鍵需求寫入**：將「量測 (Measurement) 與質量屬性 (Mass Properties)」正式納入 Phase 3，並強調其對底層拓撲選擇 (Topology Selection) 的依賴性。

### 診斷 (Diagnosis)

- **現狀**：缺乏總體功能檢視，容易導致底層架構無法支撐未來的高階功能（如面與面的夾角測量）。
- **對策**：確立六大階段 (Phase 1 ~ Phase 6) 的開發順序，強制要求所有功能開發必須遵循：後端 API -> OCCT 邏輯 -> 前端 UI 綁定的流程。

---

## [2026-05-16] 系統架構重構：工業級微服務轉向 (Architecture Pivot)


### 任務內容

- **戰略決策**：放棄前端 `opencascade.js` Wasm 方案，全面轉向 **Python FastAPI + PythonOCC** 的 Client-Server 架構。
- **目標**：解決瀏覽器記憶體限制 (OOM)，並支援龐大的 SolidWorks 輸出格式 (STEP/IGES) 的載入與深度幾何運算。
- **文檔重構**：重寫 `SYSTEM_DESIGN.md`，定義「瘦客戶端 (Thin Client)」與「重後端 (Heavy Engine)」的職責分離。

### 診斷 (Diagnosis)

- **現狀**：Wasm 在處理大型組合件或複雜拓撲時，受限於單一分頁 2GB RAM 限制。
- **風險**：缺乏原生的作業系統檔案讀寫能力，無法實現真實的 CAD 存檔。
- **對策**：將幾何運算引擎剝離為獨立的 Python 服務，前端僅負責 UI 狀態與 Three.js 網格渲染。

---

## [2026-05-16] 3D Modeler 專案啟動 (Project Initialization)


### 任務內容

- **目標確立**：開發簡易 3D 建模軟體，對標 SolidWorks。
- **技術棧選定 (Proposed)**：Next.js + Three.js + OpenCascade.js + Glass Order UI。
- **環境準備**：初始化 `docs/plans/2026-05-16-3d-modeler-bootstrap.md`。
- **SOP 宣告**：強制執行 Socratic Brainstorming 與 PDCA 循環，杜絕 Vibe Coding。

### 診斷 (Diagnosis)

- **現狀**：僅有 SkillsBuilder 治理框架，無應用層代碼。
- **風險**：3D Kernel (Wasm) 的加載效能與 React 狀態同步的複雜度。
- **對策**：第一階段僅實現「立方體生成與即時尺寸連動 (Parametric Box)」。

---

## [2026-05-16] 全文件一致性同步 (Doc Sync & Alignment)


### 任務內容

- **命名空間清理**：將 `skills/core/superpowers` 更名為 `skill-onboarding`，確保 `Superpowers` 術語專屬於高紀律工程方法論。
- **術語對齊 (Semantic Sync)**：統一 `DEV_LOG.md` 與 `bug-diagnose` 的診斷術語為 **Phase 1-4 (Investigation, Pattern, Hypothesis, Fix)**。
- **策略對齊**：在 `skill_usage_guide.md` 與 `grill-requirements` 中統一執行「蘇格拉底一次一問」原則。
- **路徑標準化**：建立 `docs/plans/` 目錄，並在 `planning` 技能中強制執行 `YYYY-MM-DD-feature-plan.md` 的命名規範。
- **環境清理**：同步更新 `README.md` 與 `wiki/log.md` 中的過時技能名稱。

---

## [2026-05-16] Superpowers 紀律深度整合 (Superpowers Integration)

### 任務內容

- **標準再升級**：更新 `karpathy_coding_standards.md`，納入 Superpowers 的「設計硬門檻 (Hard Gate)」、「蘇格拉底式探索」與「三修法則 (3-Fix Rule)」。
- **工作流鉤子強化**：升級 `master_workflow_hook.md`，使新專案自動進入 Brainstorming 模式並產出「零佔位符 (Zero-Placeholder)」開發計畫。
- **技能邏輯重構**：
    - **`bug-diagnose`**：引入系統化除錯 4 階段與架構審查機制。
    - **`grill-requirements`**：轉型為 Socratic Brainstorming 模式，強制執行「一次一問」與「核准後實作」。
- **方法論閉環**：正式將 `obra/superpowers` 的工程紀律內化為 `SkillsBuilder` 的核心標準，杜絕一切 Vibe Coding 可能性。

---

## [2026-05-16] Anti-Vibe Coding 紀律整合 (Anti-Vibe Coding Integration)

### 任務內容

- **哲學升級**：更新 `karpathy_coding_standards.md`，納入「拒絕 Vibe Coding」的第 5 條準則。
- **實戰防禦技能**：在 `skills/dev/` 新增 `tdd-enforcer`、`bug-diagnose`、`grill-requirements`，強制 AI 遵守垂直切片與測試驅動開發。
- **鉤子自動化**：升級 `master_workflow_hook.md`，使未來新專案自動宣告拒絕 Vibe Coding 並載入相關防禦技能。
- **日誌規範化**：重構 `DEV_LOG.md` 頂部結構，納入標準診斷模板 (Standard Diagnostic Template)，根除盲目修復的惡習。

---
## [2026-05-13] 里程碑發布與歷史重寫 (v1.0.0 Release & History Rewrite)

### 任務內容

- **專案門面升級**：更新 `README.md`，正式將專案定位升級為「全球最大的 AI-Agentic Skill 開源圖書館 (ClawHub All-Star Library)」。
- **文件指引優化**：在 `README.md` 中新增「核心能力（本專案能做什麼）」、「操作指南（如何使用）」以及「新專案應用方式」段落，提升新用戶的閱讀與使用體驗。
- **歷史淨化 (Squash/Rewrite)**：將專案初期的所有零碎 commit 進行 squash，重寫為單一整潔的 `v1.0.0` 初始化 commit，確保 Git 歷史乾淨易讀。
- **版本標記 (Tagging)**：建立 `v1.0.0` Git Tag，標誌著 SkillsBuilder 核心架構、Wiki 模式與 ClawHub 技能庫整合的正式完成。
- **架構優化與衛生清理**：
    - 將 `skills/dev/github` 更名為 `skills/dev/github-manager` 以對齊文件。
    - 將 `PROJECT_DEVELOPMENT_SOP.html` 移至 `raw/` 目錄，進一步淨化根目錄。
    - 在 `README.md` 中補完 `superpowers` 與 `vetter` 技能介紹。
    - 完成 27 張原始截圖 `.jpg` 檔案的清理，達成 100% 潔淨度。

---

## [2026-05-03] ClawHub 全明星技能儲備 (All-Star Skills Ingest)

### 任務內容

- **技能解析**：從 `resource/` 資料夾中的 27 張截圖中提取社區最熱門的技能資訊。
- **全庫補完**：正式儲備 15+ 個工業級技能，包括安全審查 (Vetter)、深研 (Last30days)、GitHub 管理等。
- **分類歸檔**：將技能精確劃分為 `core` (生產力) 與 `dev` (開發) 兩大類。
- **能力閉環**：現在 `SkillsBuilder` 已具備與 ClawHub 社區同步的完整能力矩陣。

---

## [2026-05-03] 全域技能圖書館轉型 (Skill Library Transformation)

### 任務內容

- **目錄重構**：建立 `skills/core` 與 `skills/dev` 分層結構。
- **技能儲備**：將 Tavily, Summarize, Planning, YouTube 等核心技能正式收錄進本專案。
- **安裝腳本升級**：更新 `INSTALL.ps1`，實現遞迴式 Symbolic Link 連結。
- **智慧資產化**：建立 `skill-library.md`，定義技能的管理、部署與版本控制規範。

---

## [2026-05-03] 全域文檔一致性同步 (Doc Sync)

### 任務內容

- **中樞同步**：更新 `antigravity-ide.md`，將圖譜智慧列為核心標配。
- **門面同步**：更新 `README.md`，正式對外展示 GitNexus 的「上帝視角」。
- **SOP 迭代**：在 `PROJECT_DEVELOPMENT_SOP.html` 插入 STEP 05，引導使用者建立代碼圖譜。
- **規範對齊**：將 GDD 納入 `skills-builder.md` 的工業級開發標準。

---

## [2026-05-03] Antigravity 本機圖譜強化 (Native Graph Boost)

### 任務內容

- **人格對齊**：修正 Wiki 文檔，將 GitNexus 的核心協作對象從 Claude Code 修正為 **Antigravity**。
- **技能封裝**：建立 `skills/gitnexus/SKILL.md`，實現 Antigravity 對圖譜查詢的直接調用能力。
- **流程優化**：定義了基於 CLI 的「探索-執行-驗證-歸檔」GDD 工作流，擺脫對外部終端的依賴。

---

## [2026-05-03] 圖譜驅動開發整合 (Graph-Driven Dev Integration)

### 任務內容

- **GitNexus 建模**：建立 `gitnexus.md`，定義其 7 大 MCP 工具與上帝視角操作。
- **GDD 概念確立**：建立 `graph-driven-dev.md`，定義「爆炸半徑 (Blast Radius)」分析工作流。
- **Wiki 同步**：將視頻中的 AI 最佳實踐轉化為本專案的持久化知識。
- **策略升級**：將圖譜意識 (Structural Awareness) 納入 SkillsBuilder 的核心哲學。

---

## [2026-05-03] 跨設備移植性 (Cross-Device Portability)

### 任務內容

- **自動化安裝腳本**：產出 `INSTALL.ps1`，實現新電腦上的「一鍵喚醒」。
- **遷移哲學確立**：建立 `migration.md`，定義 Git + Symbolic Link 的同步策略。
- **README 指引**：在首頁加入快速安裝手冊，降低遷移門檻。
- **便攜式大腦**：正式實現「知識隨人走，技能全同步」的開發目標。

---

## [2026-05-03] 專案門面優化 (Storefront Polish)

### 任務內容

- **README 升級**：重寫 `README.md`，納入 LLM Wiki 模式、4 階段生命週期與全域 KI 角色說明。
- **Entity 同步**：更新 `skills-builder.md` 與 `skill-architect.md`，對齊最新的歸檔 (Archive) 流程。
- **環境清理**：優化 `.gitignore`，隱藏 IDE 殘留檔案，保持 Git Tree 潔淨。
- **中樞角色確認**：正式確立本專案為 Antigravity 的「智慧中樞」。

---

## [2026-05-03] 系統級整合 (Antigravity Core Integration)

### 任務內容

- **Knowledge Item (KI) 註冊**：正式將 `SkillsBuilder` 註冊至 Antigravity 系統知識庫 (`C:\Users\3kids\.gemini\antigravity\knowledge\skills_builder`)。
- **全域規則鎖定**：將 Wiki SCHEMA 與 PDCA 流程轉化為「全域規則手冊 (Global Rulebook)」，實現跨專案智慧聯動。
- **Skill 核心同步**：更新系統級 `skills-builder` 技能，將本專案路徑設為 Source of Truth。
- **複利效應啟動**：現在 Antigravity 在任何會話中都能自動識別並建議應用 `SkillsBuilder` 邏輯。

---

## [2026-05-02] 複利知識庫整合與可靠性強化 (Compounding Wiki & Reliability Boost)

### 任務內容

- **Wiki 體系建立**：成功將 Karpathy 的「LLM Wiki」模式整合，建立 `wiki/` (合成知識) 與 `raw/` (原始素材) 的分層架構。
- **治理準則 (SCHEMA)**：定義了 Ingest (吸收)、Query (查詢)、Lint (健康檢查) 的標準流程。
- **跨專案 SOP**：產出了精美的 `PROJECT_DEVELOPMENT_SOP.html`，並特別針對「小白使用者」優化了對話關鍵詞與操作步驟。
- **全域參考模式 (Global Reference)**：確立了新專案無需完整複製 `SkillsBuilder` 資料夾，僅需透過「路徑參考」即可繼承智慧的開發邏輯。
- **MECE 清理**：歸檔舊文檔，達成根目錄 100% 潔淨度。

### 問題分析 (RCA) 與 矯正預防 (CAPA)

- **問題 1**：Agent 在多步驟任務中出現「口頭回報與實際執行不同步」的情況。
  - **RCA**：Agent 過於依賴心智模型，跳過了工具執行的實質驗證步驟。
- **問題 2**：在修改 `DEV_LOG.md` 時出現目標行數偏移，導致內容誤刪。
  - **RCA**：一次性替換過大區塊，且未在修改後立即重新載入檔案進行二次驗證。
- **矯正措施 (CAPA)**：
  - **驗證循環 (Verification Loop)**：強制要求在所有寫入/刪除操作後執行 `ls` 或 `view` 確認。
  - **原子化修改 (Atomic Edits)**：將大型修改拆解為小區塊，減少計算誤差。
  - **可靠性護欄**：將上述規則寫入 `wiki/SCHEMA.md`，成為 Agent 的強制性行為準則。

---

## [2026-05-01] 殭屍程序清理 (Zombie Process Cleanup)

### 任務內容

- 識別並關閉殘留的背景進程 (PID 17396, 8668, 180, 17252)。
- 釋放 8082 埠位衝突。

---

## [2026-04-30] 核心能力整合

- 整合 Karpathy 原則與 Hermes 代理能力（反幻覺、多階段工作流）。
- 推送至 GitHub (chun-chieh-chang)。

---

## [2026-05-16] 後端重型引擎轉型 (Heavy Engine Transition)

### 任務內容

- **架構升級**：正式放棄前端 `opencascade.js` (Wasm)，建立基於 `FastAPI + PythonOCC` 的伺服器端幾何運算架構。
- **環境建立**：下載並安裝 Miniforge，配置 Python 3.11 環境。
- **代碼重構**：
    - 建立 `backend/` 目錄與 FastAPI 腳本。
    - 實作 `HeavyEngineClient.ts` 取代舊有的 Wasm Context。
    - 重構 `DocumentManager.ts` 以支援遠端幾何重建 (Rebuild)。

### 診斷 (Diagnosis)

- **Phase 1: Investigation**：在 Windows 環境下建立 Conda 環境時，遇到 `InvalidArchiveError`。
- **Phase 3: Hypothesis (RCA)**：Windows 的 260 字元路徑限制導致 `viskores` 等深度巢狀套件安裝失敗。
- **Phase 4: Fix & Verify (CAPA)**：將環境安裝路徑從專案目錄遷移至淺層路徑 `C:\3d_venv` 以避開路徑過長問題。

### 進度

- [x] 下載 Miniforge 執行檔
- [x] 建立 FastAPI 基礎架構
- [x] 重構前端數據流
- [x] 完成 PythonOCC 環境安裝
- [x] 驗證第一個參數化立方體 (Parametric Box) 生成
- [x] 實作組合件 (Assembly) 支援 (Phase 2)
- [ ] 實作量測 (Measurement) 與質量屬性 (Phase 3)

---

## [2026-05-16] 組合件架構實作：多零件同步渲染 (Assembly Architecture)


### 任務內容

- **後端擴充**：
    - 修復 `geometry.py` 中 `BoxParams` 缺失的問題。
    - 新增 `/rebuild` 路由，支援一次處理多個幾何特徵 (Features)。
    - 在 `geometry_service` 實作 `process_assembly`，支援 BOX, CYLINDER, SPHERE 的生成與位移 (Translation)。
- **前端重構**：
    - 升級 `HeavyEngineClient` 與 `DocumentManager`，支援全特徵樹的同步重建。
    - 更新 `useCadStore` 以管理多零件網格數據 (`meshData` 陣列)。
    - 優化 `page.tsx` UI，新增快速工具欄 (Toolbar) 支援一鍵新增不同幾何體。
- **UI/UX 優化**：
    - 實作毛玻璃 (Glass Order) 加載遮罩，提升運算時的視覺回饋。
    - 修正 Viewport 中的 `Stage` 組件屬性，消除 TS 編譯錯誤。

### 診斷 (Diagnosis)
- **哲學升級**：更新 `karpathy_coding_standards.md`，納入「拒絕 Vibe Coding」的第 5 條準則。
- **實戰防禦技能**：在 `skills/dev/` 新增 `tdd-enforcer`、`bug-diagnose`、`grill-requirements`，強制 AI 遵守垂直切片與測試驅動開發。
- **鉤子自動化**：升級 `master_workflow_hook.md`，使未來新專案自動宣告拒絕 Vibe Coding 並載入相關防禦技能。
- **日誌規範化**：重構 `DEV_LOG.md` 頂部結構，納入標準診斷模板 (Standard Diagnostic Template)，根除盲目修復的惡習。

---
## [2026-05-13] 里程碑發布與歷史重寫 (v1.0.0 Release & History Rewrite)

### 任務內容

- **專案門面升級**：更新 `README.md`，正式將專案定位升級為「全球最大的 AI-Agentic Skill 開源圖書館 (ClawHub All-Star Library)」。
- **文件指引優化**：在 `README.md` 中新增「核心能力（本專案能做什麼）」、「操作指南（如何使用）」以及「新專案應用方式」段落，提升新用戶的閱讀與使用體驗。
- **歷史淨化 (Squash/Rewrite)**：將專案初期的所有零碎 commit 進行 squash，重寫為單一整潔的 `v1.0.0` 初始化 commit，確保 Git 歷史乾淨易讀。
- **版本標記 (Tagging)**：建立 `v1.0.0` Git Tag，標誌著 SkillsBuilder 核心架構、Wiki 模式與 ClawHub 技能庫整合的正式完成。
- **架構優化與衛生清理**：
    - 將 `skills/dev/github` 更名為 `skills/dev/github-manager` 以對齊文件。
    - 將 `PROJECT_DEVELOPMENT_SOP.html` 移至 `raw/` 目錄，進一步淨化根目錄。
    - 在 `README.md` 中補完 `superpowers` 與 `vetter` 技能介紹。
    - 完成 27 張原始截圖 `.jpg` 檔案的清理，達成 100% 潔淨度。

---

## [2026-05-03] ClawHub 全明星技能儲備 (All-Star Skills Ingest)

### 任務內容

- **技能解析**：從 `resource/` 資料夾中的 27 張截圖中提取社區最熱門的技能資訊。
- **全庫補完**：正式儲備 15+ 個工業級技能，包括安全審查 (Vetter)、深研 (Last30days)、GitHub 管理等。
- **分類歸檔**：將技能精確劃分為 `core` (生產力) 與 `dev` (開發) 兩大類。
- **能力閉環**：現在 `SkillsBuilder` 已具備與 ClawHub 社區同步的完整能力矩陣。

---

## [2026-05-03] 全域技能圖書館轉型 (Skill Library Transformation)

### 任務內容

- **目錄重構**：建立 `skills/core` 與 `skills/dev` 分層結構。
- **技能儲備**：將 Tavily, Summarize, Planning, YouTube 等核心技能正式收錄進本專案。
- **安裝腳本升級**：更新 `INSTALL.ps1`，實現遞迴式 Symbolic Link 連結。
- **智慧資產化**：建立 `skill-library.md`，定義技能的管理、部署與版本控制規範。

---

## [2026-05-03] 全域文檔一致性同步 (Doc Sync)

### 任務內容

- **中樞同步**：更新 `antigravity-ide.md`，將圖譜智慧列為核心標配。
- **門面同步**：更新 `README.md`，正式對外展示 GitNexus 的「上帝視角」。
- **SOP 迭代**：在 `PROJECT_DEVELOPMENT_SOP.html` 插入 STEP 05，引導使用者建立代碼圖譜。
- **規範對齊**：將 GDD 納入 `skills-builder.md` 的工業級開發標準。

---

## [2026-05-03] Antigravity 本機圖譜強化 (Native Graph Boost)

### 任務內容

- **人格對齊**：修正 Wiki 文檔，將 GitNexus 的核心協作對象從 Claude Code 修正為 **Antigravity**。
- **技能封裝**：建立 `skills/gitnexus/SKILL.md`，實現 Antigravity 對圖譜查詢的直接調用能力。
- **流程優化**：定義了基於 CLI 的「探索-執行-驗證-歸檔」GDD 工作流，擺脫對外部終端的依賴。

---

## [2026-05-03] 圖譜驅動開發整合 (Graph-Driven Dev Integration)

### 任務內容

- **GitNexus 建模**：建立 `gitnexus.md`，定義其 7 大 MCP 工具與上帝視角操作。
- **GDD 概念確立**：建立 `graph-driven-dev.md`，定義「爆炸半徑 (Blast Radius)」分析工作流。
- **Wiki 同步**：將視頻中的 AI 最佳實踐轉化為本專案的持久化知識。
- **策略升級**：將圖譜意識 (Structural Awareness) 納入 SkillsBuilder 的核心哲學。

---

## [2026-05-03] 跨設備移植性 (Cross-Device Portability)

### 任務內容

- **自動化安裝腳本**：產出 `INSTALL.ps1`，實現新電腦上的「一鍵喚醒」。
- **遷移哲學確立**：建立 `migration.md`，定義 Git + Symbolic Link 的同步策略。
- **README 指引**：在首頁加入快速安裝手冊，降低遷移門檻。
- **便攜式大腦**：正式實現「知識隨人走，技能全同步」的開發目標。

---

## [2026-05-03] 專案門面優化 (Storefront Polish)

### 任務內容

- **README 升級**：重寫 `README.md`，納入 LLM Wiki 模式、4 階段生命週期與全域 KI 角色說明。
- **Entity 同步**：更新 `skills-builder.md` 與 `skill-architect.md`，對齊最新的歸檔 (Archive) 流程。
- **環境清理**：優化 `.gitignore`，隱藏 IDE 殘留檔案，保持 Git Tree 潔淨。
- **中樞角色確認**：正式確立本專案為 Antigravity 的「智慧中樞」。

---

## [2026-05-03] 系統級整合 (Antigravity Core Integration)

### 任務內容

- **Knowledge Item (KI) 註冊**：正式將 `SkillsBuilder` 註冊至 Antigravity 系統知識庫 (`C:\Users\3kids\.gemini\antigravity\knowledge\skills_builder`)。
- **全域規則鎖定**：將 Wiki SCHEMA 與 PDCA 流程轉化為「全域規則手冊 (Global Rulebook)」，實現跨專案智慧聯動。
- **Skill 核心同步**：更新系統級 `skills-builder` 技能，將本專案路徑設為 Source of Truth。
- **複利效應啟動**：現在 Antigravity 在任何會話中都能自動識別並建議應用 `SkillsBuilder` 邏輯。

---

## [2026-05-02] 複利知識庫整合與可靠性強化 (Compounding Wiki & Reliability Boost)

### 任務內容

- **Wiki 體系建立**：成功將 Karpathy 的「LLM Wiki」模式整合，建立 `wiki/` (合成知識) 與 `raw/` (原始素材) 的分層架構。
- **治理準則 (SCHEMA)**：定義了 Ingest (吸收)、Query (查詢)、Lint (健康檢查) 的標準流程。
- **跨專案 SOP**：產出了精美的 `PROJECT_DEVELOPMENT_SOP.html`，並特別針對「小白使用者」優化了對話關鍵詞與操作步驟。
- **全域參考模式 (Global Reference)**：確立了新專案無需完整複製 `SkillsBuilder` 資料夾，僅需透過「路徑參考」即可繼承智慧的開發邏輯。
- **MECE 清理**：歸檔舊文檔，達成根目錄 100% 潔淨度。

### 問題分析 (RCA) 與 矯正預防 (CAPA)

- **問題 1**：Agent 在多步驟任務中出現「口頭回報與實際執行不同步」的情況。
  - **RCA**：Agent 過於依賴心智模型，跳過了工具執行的實質驗證步驟。
- **問題 2**：在修改 `DEV_LOG.md` 時出現目標行數偏移，導致內容誤刪。
  - **RCA**：一次性替換過大區塊，且未在修改後立即重新載入檔案進行二次驗證。
- **矯正措施 (CAPA)**：
  - **驗證循環 (Verification Loop)**：強制要求在所有寫入/刪除操作後執行 `ls` 或 `view` 確認。
  - **原子化修改 (Atomic Edits)**：將大型修改拆解為小區塊，減少計算誤差。
  - **可靠性護欄**：將上述規則寫入 `wiki/SCHEMA.md`，成為 Agent 的強制性行為準則。

---

## [2026-05-01] 殭屍程序清理 (Zombie Process Cleanup)

### 任務內容

- 識別並關閉殘留的背景進程 (PID 17396, 8668, 180, 17252)。
- 釋放 8082 埠位衝突。

---

## [2026-04-30] 核心能力整合

- 整合 Karpathy 原則與 Hermes 代理能力（反幻覺、多階段工作流）。
- 推送至 GitHub (chun-chieh-chang)。

---

## [2026-05-16] 後端重型引擎轉型 (Heavy Engine Transition)

### 任務內容

- **架構升級**：正式放棄前端 `opencascade.js` (Wasm)，建立基於 `FastAPI + PythonOCC` 的伺服器端幾何運算架構。
- **環境建立**：下載並安裝 Miniforge，配置 Python 3.11 環境。
- **代碼重構**：
    - 建立 `backend/` 目錄與 FastAPI 腳本。
    - 實作 `HeavyEngineClient.ts` 取代舊有的 Wasm Context。
    - 重構 `DocumentManager.ts` 以支援遠端幾何重建 (Rebuild)。

### 診斷 (Diagnosis)

- **Phase 1: Investigation**：在 Windows 環境下建立 Conda 環境時，遇到 `InvalidArchiveError`。
- **Phase 3: Hypothesis (RCA)**：Windows 的 260 字元路徑限制導致 `viskores` 等深度巢狀套件安裝失敗。
- **Phase 4: Fix & Verify (CAPA)**：將環境安裝路徑從專案目錄遷移至淺層路徑 `C:\3d_venv` 以避開路徑過長問題。

### 進度

- [x] 下載 Miniforge 執行檔
- [x] 建立 FastAPI 基礎架構
- [x] 重構前端數據流
- [x] 完成 PythonOCC 環境安裝
- [x] 驗證第一個參數化立方體 (Parametric Box) 生成
- [x] 實作組合件 (Assembly) 支援 (Phase 2)
- [ ] 實作量測 (Measurement) 與質量屬性 (Phase 3)

---

## [2026-05-16] 組合件架構實作：多零件同步渲染 (Assembly Architecture)


### 任務內容

- **後端擴充**：
    - 修復 `geometry.py` 中 `BoxParams` 缺失的問題。
    - 新增 `/rebuild` 路由，支援一次處理多個幾何特徵 (Features)。
    - 在 `geometry_service` 實作 `process_assembly`，支援 BOX, CYLINDER, SPHERE 的生成與位移 (Translation)。
- **前端重構**：
    - 升級 `HeavyEngineClient` 與 `DocumentManager`，支援全特徵樹的同步重建。
    - 更新 `useCadStore` 以管理多零件網格數據 (`meshData` 陣列)。
    - 優化 `page.tsx` UI，新增快速工具欄 (Toolbar) 支援一鍵新增不同幾何體。
- **UI/UX 優化**：
    - 實作毛玻璃 (Glass Order) 加載遮罩，提升運算時的視覺回饋。
    - 修正 Viewport 中的 `Stage` 組件屬性，消除 TS 編譯錯誤。

### 診斷 (Diagnosis)

- **Phase 1: Investigation**：嘗試新增多個零件時，發現前端僅能顯示最後一個 BOX。
- **Phase 3: Hypothesis (RCA)**：原先的 `DocumentManager` 與後端 API 僅設計為「單一幾何體」模式，無法傳遞完整的特徵鏈。
- **Phase 4: Fix & Verify (CAPA)**：將通訊協議改為 `AssemblyRequest` 模式，後端遍歷特徵樹並返回網格清單。

### 進度確認 (Verification)
- [x] 支援 BOX/CYLINDER/SPHERE 同時顯示。
- [x] 支援每個零件獨立的 X/Y/Z 位移參數。
- [x] TS 編譯通過 (Zero Error)。

---

## [2026-05-17] 幾何核心整合、語法修復與特徵樹重構 (Geometry Service Integration & Fixes)

### 任務內容

- **幾何核心修復**：
    - 修正 `geometry_service.py` 中的 `elif` 語法錯誤（將第 66 行無前置 `if` 的 `elif` 改為正統 `if` 判斷）。
    - 修正 OpenCascade 的 `gp_Trsf.SetTransformation()` C++ 重載簽名相容性問題（藉由導入並呼叫 `gp_Ax3(ax2)` 來將 `gp_Ax2` 的局部基準面座標系隱式轉換為右手法則的 `gp_Ax3` 座標系）。
- **特徵樹功能擴充**：
    - 在 `process_features` 核心重構中，完整實作對 `BOX`、`CYLINDER` 與 `SPHERE` 幾何體特徵的參數化解析。
    - 在遍歷計算中導入 Boolean `ADD` (長出) 與 `CUT` (除料) 的完整歷史特徵序列運算，支持對 `BOX`、`CYLINDER`、`SPHERE` 的動態幾何挖孔或聯集。
- **遺留端點對接**：
    - 補全 `geometry_service.py` 中缺失 `generate_box`、`generate_cylinder` 與 `generate_sphere` 遺留 helper 函數，確保 FastAPI 端點路由與舊版通訊 100% 相容。

### 診斷 (Diagnosis)

- **Phase 1: Investigation (根因調查)**：
    - 啟動並驗證 `/rebuild` API 時，Python 直譯器回報 `SyntaxError: invalid syntax`。
    - 修正語法後，執行 `Invoke-RestMethod` 傳遞特徵樹，OCCT 核心回報 `TypeError: Wrong number or type of arguments for overloaded function 'gp_Trsf_SetTransformation'`。
- **Phase 2: Pattern (模式分析)**：
    - OCCT 官方 C++ 簽名中，`gp_Trsf::SetTransformation` 需要 `gp_Ax3` 做為三維坐標系定位參照，而我們在基準面系統中僅生成了二維平面投影專用的 `gp_Ax2`。
- **Phase 3: Hypothesis (RCA 根因分析)**：
    - `geometry_service.py` 在之前的特徵切分中，遺漏了 `if` 宣告而直接使用 `elif`，且未對 `gp_Ax2` 進行 `gp_Ax3` 封裝，導致 C++ 接口重載匹配失敗。
- **Phase 4: Fix & Verify (CAPA 矯正預防)**：
    - **矯正措施**：導入 `gp_Ax3` 並使用 `gp_Ax3(ax2)` 封裝變換矩陣參照，同時完整補齊 `BOX/CYLINDER/SPHERE` 的 Boolean ADD/CUT 支援與 legacy 端點函式。
    - **驗證結果**：啟動 `C:\3D_ENV_FINAL` 微服務，呼叫 `/rebuild` 回報 200 OK，成功將 `Base Plate`（長出）與 `Top Cut-out`（除料）轉化為 Three.js 的 `vertices` 和 `indices` 網格數據！

### 進度確認 (Verification)
- [x] 修正 Python 語法解析錯誤 (Syntax Clean)。
- [x] 解決 `gp_Trsf_SetTransformation` 重載簽名崩潰問題。
- [x] `/rebuild` 路由完整支援 `BOX/CYLINDER/SPHERE` 幾何。
- [x] 成功執行 parametric JOIN/CUT 混合運算。

---

### CI/CD 確效修正與 Pages 自動化部署

#### 問題描述
- **現象**：推送至 GitHub 後，首個 GitHub Actions 工作流執行失敗，Next.js 編譯步驟崩潰，回報 `Process completed with exit code 2`，且上傳 Artifact 找不到 `out` 目錄。

#### 診斷 (Diagnosis - RCA)
- **RCA (根因分析)**：`actions/configure-pages@v4` 行動在設定 `static_site_generator: next` 時，會在 Runner 根目錄動態注入過時參數並生成 `next.config.js`，這會覆蓋我們手動配置的 TypeScript 設定 [next.config.ts](file:///c:/Users/3kids/Downloads/3D-Builder/next.config.ts)。這導致 Next.js 無法執行靜態導出，也就沒有生成 `./out` 目錄，進而使上傳 artifact 步驟因找不到目錄而崩潰。

#### 矯正與預防措施 (CAPA)
- **矯正措施**：
    1. 編輯 [.github/workflows/deploy.yml](file:///c:/Users/3kids/Downloads/3D-Builder/.github/workflows/deploy.yml)，移除 `static_site_generator: next` 的配置，保留純淨的 Pages 初始化環境。
    2. 本地執行 `npm run build` 進行編譯與靜態導出測試，確認在 Turbopack 環境下以 exit code 0 完美生成 `./out` 靜態目錄。
    3. 提交並推送修復。
- **預防措施**：未來凡涉及 CI/CD 自動化建置的修改，必須手動透過 GitHub REST API 或網頁監控工具，確信 Actions 回報 100% 成功（Completed - Success）後，方可宣告任務完成，嚴禁「只管 Push，不顧 Actions」的 vibe coding。

#### 最終確效結果 (Verification)
- [x] 本地模擬 Next.js 16 靜態編譯成功，無 TS/ESLint 錯誤。
- [x] 移除 Actions 冗餘的 `static_site_generator` 重置參數。
- [x] GitHub API 查詢與 GitHub Actions 工作流 #2 回報 **completed - success** 🟢。
- [x] 網頁正式部署上線且資源無 404 加載異常：[3D-Builder Live Pages](https://chun-chieh-chang.github.io/3D-Builder/) 🟢。

---

## [2026-05-17] SolidWorks 級草圖長出功能與定量尺寸設計 (SolidWorks-grade Sketch-to-Extrude & Parametric Dimensioning)

### 任務內容
- **二維幾何與圓弧內核擴充**：
    - 在後端幾何微服務導入 OpenCascade 的 `GC_MakeArcOfCircle` 幾何算子。
    - 重構 B-Rep 線框建構模組，支援直線段 (`Line`) 與三點圓弧 (`Arc`) 混合拓撲線框（Wire）的解析。當端點序列中偵測到 `ARC_CONTROL` 頂點時，會自動在空間中插補三點圓弧，若點位共線則自動降級為直線以進行防禦防禦。
- **草圖繪製狀態升級**：
    - Zustand 狀態庫新增 `sketchTool` 狀態，支援 `LINE`（直線段）與 `ARC`（三點圓弧）工具的自由切換。
    - 滑鼠點擊基準面時，動態判斷選用工具：在圓弧模式下，將點擊點自動標記為 `ARC_CONTROL` 控制頂點，與起迄端點配對。
- **三維實時草圖預覽**：
    - 重構 Three.js 視埠中的 `SketchPreview.tsx`。
    - 導入 `THREE.CatmullRomCurve3` 用於三維空間中插補草圖弧線，實時渲染高精度的黃色曲率預覽線，取代單調的折線預覽。
- **定量尺寸編輯器**：
    - 精緻化左側的「草圖屬性編輯面板」，動態標示點位為「端點 (P_n)」或「弧頂 Ctrl」，並為座標輸入框提供 U 與 V 指示標誌。設計師在畫布定位後，能在此定量修改數值，實現尺寸設定。

### 診斷 (Diagnosis & RCA)
- **RCA (根因分析)**：原先的幾何建構流程只支援 3D 幾何體的直接融合，忽略了 CAD 行業中「草圖面定義 -> 繪製輪廓 -> 拉伸特徵」的標準拓撲關係。為此需要解耦頂點表示，以 `ARC_CONTROL` 語意標籤將直線與曲線段進行拓撲分離。

### 最終確效結果 (Verification)
- [x] 後端導入 `GC_MakeArcOfCircle`，本地測試案例編譯退出碼 0。
- [x] 三點圓弧草圖在 FRONT/TOP/RIGHT 基準面上順利渲染，Catmull-Rom 曲線插補順暢。
- [x] 草圖點位輸入框能完美定量編輯並觸發 Recompute B-Rep 長出。
- [x] 成功整合 SolidWorks 風格的 Viewport HUD 控制面版與網格吸附功能。
- [x] 本地生產環境 `npm run build` TypeScript 編譯順利成功 🟢。

---

## [2026-05-17] SolidWorks 使用者體驗優化與視埠指令 HUD (SolidWorks UX Optimization & Viewport HUD)

### 任務內容
- **網格精準鎖點與自動吸附 (Grid Snapping)**：
    - Zustand 狀態庫新增 `gridSnap`（預設為啟用）開關。
    - 當設計師使用滑鼠在基準面上進行點擊定位時，[DatumPlanes.tsx](file:///c:/Users/3kids/Downloads/3D-Builder/src/renderer/DatumPlanes.tsx) 會自動將點擊座標值四捨五入吸附至最近的整數網格（如 10.0, -5.0），避免產生小數點碎屑座標，大幅提升滑鼠點擊粗定位時的幾何整潔度。
- **視埠中央懸浮 HUD (Heads-Up Display)**：
    - 借鑒 SolidWorks 經典的草圖 Heads-Up 功能，在 3D 畫布頂部中央設計了高階毛玻璃（Glassmorphism）懸浮 HUD。
    - **HUD 模組內容**：
        1. **狀態與工具指示**：實時顯示當前正在繪製直線段或圓弧。
        2. **自動吸附開關**：提供 `🧲 網格吸附: 已啟用/已關閉` 切換按鈕，允許使用者在自由繪圖與吸附鎖點間實時切換。
        3. **節點計數**：即時回饋當前草圖已繪製的端點數量。
        4. **快速指令按鈕**：提供 **`✓ 離開並拉伸 (Extrude)`** 與 **`✗ 捨棄 (Discard)`** 快捷按鈕。
- **閉合草圖並長出 (Direct Exit & Extrude)**：
    - 在視埠中點擊 `✓ 離開並拉伸` 時，系統會自動在草圖節點大於 3 時，閉合輪廓並退出草圖模式，自動生成 Extrude 特徵並帶入 10mm 的初始厚度，同時呼叫後端進行 B-Rep 特徵重構，實現「草圖面 $\to$ 實體拉伸」的一體化流暢體驗！

### 最終確效結果 (Verification)
- [x] 成功實現 `gridSnap` Zustand 狀態與座標吸附邏輯，定位點全部完美落在網格交叉點上。
- [x] 懸浮 HUD 設計符合 Approchable Luxury 的莫蘭迪灰色調，並具備高級毛玻璃陰影，保證極致的視覺美學。
- [x] `✓ 離開並拉伸 (Extrude)` 功能測試通過，直接生成 Custom Extrude 特徵並觸發 Heavy Engine Rebuild 🟢。
- [x] 本地編譯無任何錯誤，成功推送至 Git 倉庫 🟢。
