# 3D-Builder 開發交接指南 (Handover Resume Guide)

此文檔專為後續接手的 AI Agent 或開發者設計。當您讀取到此文檔時，請務必嚴格遵循以下架構規範與開發守則，以確保系統穩定性並無縫接軌。

---

## 1. 專案現況與核心技術棧 (Project Overview)
- **核心架構**：Next.js + React Three Fiber (R3F) + Zustand (狀態管理)。
- **當前目標**：打造工業級的 3D CAD 建模軟體網頁版，目前已完成基礎草圖 (Sketch) 引擎的重構，具備智能約束 (Constraints)、標註 (Dimensions) 與完整的繪圖工具。

## 2. 核心架構指南 (Core Architecture Guide)
為了避免程式碼腐化，專案採用了嚴格的職責分離設計：

*   **`src/store/useCadStore.ts`**：全局狀態庫。定義了所有的模型介面 (Nodes, Edges, Constraints)。
*   **`src/store/sketchActions.ts` (最高指令原則)**：
    *   **唯一合法入口**：所有牽涉到新增、刪除、修改草圖拓撲 (Topology) 的行為，**絕對不允許**在 UI 元件中直接調用 `setSketchNodes` 等底層 API。必須強制透過 `sketchActions` (例如 `addNode`, `deleteEntities`)。
    *   **垃圾回收機制 (GC)**：刪除線段後，會自動觸發 `gc()` 尋找並清除孤立端點 (Orphan Nodes) 與懸空標註，確保資料庫乾淨，防止 `NaN` 錯誤導致 WebGL 渲染崩潰。
*   **`src/utils/sketch/ToolHandlers/*`**：
    *   負責所有滑鼠繪圖狀態機 (State Machine)。如 `CircleTool.ts`, `LineTool.ts`。所有邏輯已從 `DatumPlanes.tsx` 抽離。
*   **`src/renderer/DatumPlanes.tsx`**：
    *   僅負責基礎環境、攝影機控制、3D 空間的滑鼠射線 (Raycaster) 捕捉，以及繪圖過程中的**幽靈預覽線 (Drafting Ghost Preview)**。預覽線的判定基準為全局的 `useCadStore.getState().lastClickedNodeId`。
*   **`src/renderer/SketchPreview.tsx`**：
    *   負責將 `sketchNodes`, `sketchEdges`, `sketchConstraints` 渲染成 WebGL 畫面與 `@react-three/drei` 的 `Html` 互動標籤。處理如：尺寸標註拖拉、端點拖拉解算等。

## 3. 最新開發進展與地雷區防禦 (Recent Milestones & CAPA)
如果您準備修改現有邏輯，請注意以下已修復的痛點，**請勿重蹈覆轍**：
1.  **尺寸標註反向拖拉問題**：已在 `SketchPreview.tsx` 實作了工業級的**投影內積算法 (Dot Product Projection)**，利用標註的幾何法向量與滑鼠位移量作內積，請勿改回單純比較 `dx` / `dy` 的絕對值邏輯。
2.  **預覽盲繪與無限重疊維度**：曾發生過因為沒畫出預覽線，導致使用者在同一個點畫出三個完全重疊的圓，進而引發尺寸標註不斷堆疊的問題。現在：
    *   所有草圖工具的預覽已嚴格綁定 `lastClickedNodeId`。
    *   `SMART_DIMENSION` 點擊時，已加入防呆鎖 (Deduplication Lock)，會掃描是否已有相同端點的 `DISTANCE` 約束。
3.  **浮動工具列 (HeadsUpToolbar)**：已實作基於 `setPointerCapture` 的原生拖曳把手，可自由在畫布上移動。

## 4. 接手開發紀律 (Agent Directives)
身為接下來接手的 Agent，您必須嚴格遵守：
1.  **Context Awareness (上下文感知)**：在執行 `multi_replace_file_content` 或 `replace_file_content` 之前，**強制必須先使用 `view_file` 閱讀該檔案的上下文 (至少前後 50 行)**。嚴禁盲目替換導致語法錯誤 (如變數重複宣告)。
2.  **禁用 Shell 腳本修改檔案**：絕對禁止使用 `cat` 或 `sed` 在 `run_command` 中修改檔案。強制使用系統提供的原生檔案修改 Tools。
3.  **零錯誤驗證**：宣告任務完成前，必須確保您的修改不會在瀏覽器 Console 噴出紅色 Error。
4.  **維持檔案 MECE 原則**：代碼必須模組化，相互獨立、完全窮盡，遇到垃圾代碼請隨手清理，不要讓檔案無限膨脹。

## 5. 未來開發方向 (Next Steps / Roadmap)
1.  **幾何約束解算器優化 (Constraint Solver)**：目前 `solveConstraints` 的疊代穩定性可以進一步加強，支援更多類型的幾何約束 (如相切、平行拖拉)。
2.  **3D 特徵引擎 (3D Feature Engine)**：確保從 2D 草圖生成 3D 特徵 (Extrude, Revolve) 的邊界運算與孔洞挖空 (Holes) 能夠正確解析 `sketchNodes` 的多邊形環。
3.  **UI/UX 藝術總監視角**：隨時保持「色彩大師規範」與「懸浮感排版」，不要寫出呆板的預設 HTML 樣式，任何新增的 UI 都必須具備微動畫與優雅的漸層質感。

---
*當您閱讀完此份文檔，代表您已經載入了最新的 3D-Builder 開發心智模型。請繼續我們未竟的偉大工程。*
