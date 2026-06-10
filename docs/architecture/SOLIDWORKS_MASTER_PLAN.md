# SOLIDWORKS_MASTER_PLAN.md - 3D-Builder 終極對標計畫 (v1.0 Baseline)

> **文件角色**：本文件是 3D-Builder 的唯一歸一化計畫 (Master Plan)。所有開發 (Do) 必須對標本文件，查核 (Check) 必須以此為準，偏差則必須執行 RCA/CAPA (Act)。
> **核心目標**：打造一個 SolidWorks 級別的 3D 建模軟體，實現引擎、邏輯、交互、數據流與前後端通連的完美復刻。

---

## 1. 引擎對標：幾何內核與約束系統 (Kernel & Solver)
*目標：實現與 SolidWorks 同等級的真 B-Rep 幾何運算與精確約束求解。*

- **B-Rep 內核 (OpenCASCADE)**：
    - 全面採用 `TopoDS_Shape` 進行運算。
    - 支援精確的幾何實體、曲面、邊緣與頂點。
- **草圖求解器 (Constraint Solver)**：
    - **PBD Preview**：用於拖拽時的即時視覺回饋 (60 FPS)。
    - **Precise Solver**：滑鼠釋放後進行 Newton-Raphson 迭代求解，確保微米級精度。
    - **狀態感知**：完全復刻「完全定義 (黑)」、「欠定義 (藍)」、「衝突 (紅)」的視覺邏輯。
- **拓撲命名 (TNS 2.0)**：
    - 利用 OpenCASCADE History API (`BRepAlgoAPI_History`) 追蹤幾何演化，確保在模型重建後下游特徵（如圓角、孔）參照依然穩定。

## 2. 邏輯與數據流對標：參數化特徵鏈 (Parametric Feature Chain)
*目標：數據流必須嚴格遵循「歷史紀錄 ➔ 參數重建 ➔ 拓撲繼承」的 SolidWorks 邏輯。*

- **全參數化數據結構**：
    - 每一特徵 (Feature) 必須封裝其原始草圖、平面定義、數值參數。
    - 存檔格式：原生 `.3dbpart` (JSON)，具備版本化 Schema。
- **設計樹 (FeatureManager)**：
    - **退回控制棒 (Rollback Bar)**：支援拖拽回溯歷史，編輯時自動隱藏後續特徵。
    - **父子關係追蹤**：支援特徵壓縮 (Suppression) 與零件變體設計。
- **動態重建 (Live Rebuild)**：
    - 150ms 防抖動態重建，修改數值時視埠即時預覽 3D 變化。

## 3. 介面交互對標：專業 CAD 工作流 (Professional UX)
*目標：交互方式與視覺細節必須讓 SolidWorks 老手「零學習成本」上手。*

- **前景視圖工具欄 (Heads-up Toolbar)**：
    - 視角旋轉、剖面、顯示模式 (Shaded with Edges)、正對面 (Normal To)。
- **S-Key 快捷選單**：
    - 模式感知 (Mode-aware)：草圖模式顯示繪圖工具，零件模式顯示特徵工具。
- **屬性管理器 (PropertyManager 2.0)**：
    - 左側面板動態顯示特徵參數，支援巢狀摺疊與標準工業參數分組。
- **空間標註 (Callouts)**：
    - 視埠內直接雙擊尺寸標籤進行即時驅動。

## 4. 前後端通連對標：高效幾何管道 (Geometry Pipeline)
*目標：實現 Electron、Next.js 與 Python 幾何服務的無縫同步。*

- **IPC 通訊協議**：
    - 基於 FastAPI 的微服務，透過 JSON 指令傳遞特徵樹。
- **非同步重建佇列**：
    - 避免 UI 阻塞，大模型重建時顯示進度條。
- **髒標記檢查 (Dirty Flagging)**：
    - 僅對受影響的特徵分支進行後端重構，優化運算耗時。

---

## 🧠 AI Agentic Capabilities (Powered by SkillsBuilder)
本專案已深度整合 **SkillsBuilder** 開發框架，任何接手的 AI Agent 必須遵循以下規範：

1. **智庫驅動**：開發前必須先 `QUERY` [wiki/index.md](wiki/index.md) 以獲取最新的架構上下文。
2. **專家角色**：針對不同任務，應主動調用 `skills/dev/` 下的對應專家（如 `skill-architect`, `bug-diagnose`）。
3. **自動化門禁**：提交代碼前會自動觸發 `pre-commit` hook 進行型別與 PDCA 完整性查核。
4. **Nexus 協議**：任務交接必須符合 `wiki/concepts/nexus-protocols.md` 規範。

---

## 🚦 PDCA 查核門禁 (Release Gates) - 嚴格版
*任何 Phase 結案前必須通過以下「實體化」驗證：*

1. **npx tsc --noEmit**：全域型別安全 (基礎門檻)。
2. **npm run pdca:check**：文件與治理規範一致。
3. **Event-Chain Reality Audit (實體化事件鏈查核)**：
    - [ ] **UI 響應同步**：點擊 Ribbon 或 S-Key 後，視埠環境 (Mode) 與 Store 狀態必須在 16ms 內達成強耦合。
    - [ ] **交互實體化**：在視埠點擊/拖拽時，必須產生具備有效 UUID 的 `SketchNode` 與 `SketchEdge`，禁止產生長度為 0 的無效圖元。
    - [ ] **渲染反饋**：所有生成的圖元必須具備「幽靈預覽 (Ghost Preview)」與「正式實體」兩階段視覺反饋。
    - [ ] **跨工具隔離**：切換草圖工具時，必須自動重置「鏈式狀態 (Chain State)」，防止 tool-bleeding 導致的圖元亂竄。
    - [ ] **數據閉環**：所有前端生成的幾何數據必須能被後端 `SketchSolver` 正確解析，不允許存在「前端有顯示但後端無數據」的空殼實體。
4. **Golden Test (黃金零件驗證)**：
    - 標準零件 (如 L-Bracket) 的幾何拓撲、體積與重心數據必須與 SolidWorks 導出結果 100% 匹配。
5. **Benchmark SOP Validation**：
    - 必須由 AI Agent 模擬或人工實際操作，完整執行 [REINFORCED_L_BRACKET_SOP.md](docs/benchmarks/REINFORCED_L_BRACKET_SOP.md) 並截圖/記錄日誌，確保無任何「點擊無效」或「顯示錯誤」。
6. **SOLIDWORKS 驗證標準對齊**（v2025 線上說明）：
    - 所有板塊的驗證標準、Golden Part 規範、RCA/CAPA 流程、自動化測試要求已統一收斂至 `docs/spec/SOLIDWORKS_VERIFICATION_STANDARD*.md`。
    - 各 Phase 的 acceptance criteria 必須符合 [SOLIDWORKS_VERIFICATION_STANDARD.md](docs/spec/SOLIDWORKS_VERIFICATION_STANDARD.md) 定義的驗證分級（L1–L4）。
    - 詳細功能板塊驗證標準：[SOLIDWORKS_VERIFICATION_STANDARD_FEATURES.md](docs/spec/SOLIDWORKS_VERIFICATION_STANDARD_FEATURES.md) 系列文件。

---

## 🛠️ RCA/CAPA 紀律 (Root Cause Analysis & Corrective Action)
*當發生「模擬通過但實際失效」時，必須執行以下 RCA 標準：*
- **Step 1 (Event Trace)**: 追蹤從 React 事件 (onClick) ➔ Store (Action) ➔ Renderer (Hook) ➔ Viewport (Primitive) 的完整路徑。
- **Step 2 (State Diff)**: 比對「預期狀態」與「實際 Zustand 快照」的差異。
- **Step 3 (Prevention)**: 修改代碼後，必須在 `DEV_LOG.md` 記錄該交互模式的「邊界條件」，並將其加入自動化測試或手動查核清單。
- **詳細 RCA/CAPA 流程**：參見 [SOLIDWORKS_VERIFICATION_STANDARD_RCA.md](docs/spec/SOLIDWORKS_VERIFICATION_STANDARD_RCA.md)，包含分類代碼與 CAPA 模板引用。

