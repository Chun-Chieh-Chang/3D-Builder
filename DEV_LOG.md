# DEV_LOG (開發日誌)

## 2026-06-04 系統架構重構 (Soul Evolution)

### 問題背景 (Background)
1. **事件冒泡衝突**：修復點擊穿透 (`e.stopPropagation`) 導致連續畫線中斷。
2. **狀態機混亂**：原本 `DatumPlanes.tsx` 的 `handlePlaneClick` 龐大無比，導致使用 `SELECT` 或 `TRIM` 時會意外在點擊處產生孤立節點 (Floating Nodes)。
3. **資料殘留**：使用 `TRIM` 工具刪除線段時，依賴該線段的尺寸約束沒有連帶刪除 (Cascading Delete)，導致畫面與邏輯脫節。
4. **NaN 洪水崩潰**：因為產生了孤立的髒資料 (Dirty Nodes)，傳遞給 Three.js 的 `LineSegmentsGeometry` 時引發大量 `NaN` 錯誤，導致效能驟降與渲染失效。

### 解決方案 (The Path Forward)
進行了底層核心的重構 (Architecture Refactor)，導入更嚴謹的設計模式：
1. **Command Pattern (`sketchActions.ts`)**：
   - 所有對 `useCadStore` 的草圖變更（如 `addNode`, `deleteEdges`）必須統一收斂於此。
   - `deleteEdges` 與 `deleteNodes` 已內建強制 Cascading Delete（連帶刪除約束與孤立線段）。
2. **State Machine (`ToolHandlers`)**：
   - 新增 `src/utils/sketch/ToolHandlers/BaseTool.ts`。
   - 建立 `LineToolHandler`, `TrimToolHandler`, `SelectToolHandler`。
   - 成功將這三項工具從 `DatumPlanes.tsx` 的 `handlePlaneClick` 龐大 if/else 樹中抽出。
3. **Data Integrity 護城河**：
   - 建立 `DataIntegrity.ts`，在 `sketchActions.ts` 寫入節點前進行 `isValidPoint` 驗證，若有 `NaN` 直接捨棄，從源頭根絕 `LineSegmentsGeometry` 崩潰問題。
   - 在 `Viewport.tsx` 對 `EXTRUDE` 產生的輪廓線加裝防護網 `filter(p => !isNaN(p.x))`。

### 狀態 (Status)
- [x] LINE, TRIM, SELECT, ARC, SPLINE, RECTANGLE, CIRCLE 工具重構完成。
- [x] DatumPlanes.tsx 胖邏輯已清空。

---

### [2026-06-04]：語法錯誤與修剪後懸空標註 (Dangling Dimensions) 處理
* **問題現象 (Issue)**：
  1. 修改程式碼時，造成 Next.js 伺服器因為 Syntax Error (`v is defined multiple times`) 而崩潰。
  2. 使用 `TRIM` 工具修剪線段後，原本附著在該線段端點上的尺寸標註 (Dimensions) 沒有消失，變成懸浮在畫面上的幽靈標註。
  3. `Line` 工具失去原有的 `HORIZONTAL`/`VERTICAL` 磁吸標記，且無法使用 `Shift` 鍵解鎖格線限制。
* **原因分析 (RCA)**：
  1. **Syntax Error**：我在重構 `DatumPlanes.tsx` 時，沒有精準確認變數作用域的上下文 (Context)，直接使用盲目的正則或片段替換，導致同一區塊內重複宣告變數。
  2. **懸空標註**：原本的 `TRIM` 邏輯與初版的 `sketchActions.deleteEdges` 只刪除了「線段 (Edge)」，卻忽略了構成該線段的「孤立端點 (Orphan Nodes)」並未被刪除。尺寸標註如果綁定在端點上，就會因為端點仍存在而繼續顯示。
  3. **磁吸丟失**：將邏輯抽離到 `ToolHandlers` 時，漏傳了 `cursorState.type`，導致狀態機不知道使用者已經觸發了幾何對齊。
* **矯正與預防措施 (CAPA)**：
  1. **防禦性程式碼設計 (GC 引擎)**：在 `sketchActions.ts` 導入 `gc()` (Garbage Collection) 函數。未來所有 `deleteEdges` 或 `deleteNodes` 操作，都會在最後執行 `gc()`，自動找出沒有線段連接的孤立端點並將其刪除，同時連帶銷毀綁定在該端點上的標註。
  2. **上下文保護 (Context Awareness)**：在執行任何 `multi_replace_file_content` 之前，必須強制自己先 `view_file` 閱讀該行前後 50 行的邏輯，嚴禁在不清楚變數作用域的情況下強行替換。
  3. **自我進化警醒**：這是一個慘痛的教訓，身為 Agent 必須將每次的 Bug 化為系統級的防禦機制 (如 GC)，而不是只做表面修補。這已成為我的進化準則。

### [2026-06-04]：全局快捷鍵繞過架構導致的記憶體洩漏 (Residual Elements)
* **問題現象 (Issue)**：使用者回報畫面上依然有殘留的懸空標註與孤立端點無法清空。
* **原因分析 (RCA)**：我在 `sketchActions.ts` 中設計了完美的 `gc()` 引擎，**但我忽略了 UI 綁定的全域快捷鍵 (Global Keyboard Listener)**。在 `useAppIntegrations.ts` 中，`Delete` 和 `Backspace` 鍵的觸發邏輯，直接繞過了 `sketchActions` 去操作 State，導致刪除線段時 `gc()` 根本沒有被呼叫，留下了大量的孤立端點 (Orphan Nodes) 與幽靈標註！
* **矯正與預防措施 (CAPA)**：
  1. **收斂操作入口**：在 `sketchActions.ts` 中新增通用的 `deleteEntities`，取代了原本在 `useAppIntegrations.ts` 中龐大且危險的狀態修改邏輯。
  2. **架構紀律 (Architectural Discipline)**：任何元件 (UI, Hook, API) 都不允許直接對 `useCadStore` 的草圖陣列進行解構與刪除，必須 100% 透過 `sketchActions`，確保每一次的 Mutation 都有受到 GC 護城河的保護。

### [2026-06-04]：浮動工具列拖曳、尺寸標註拖曳反向與重疊增生問題
* **問題現象 (Issue)**：
  1. 浮動工具列 (HeadsUpToolbar) 固定在正上方無法移動，遮擋畫布。
  2. 拖拉距離尺寸標註時，手感異常，往下拉反而數字標註往上跑 (方向相反)。
  3. 畫圓時，標註「愈來愈多」，在同一個地方長出大量重疊的尺寸線。
* **原因分析 (RCA)**：
  1. **工具列固定**：原先只是單純絕對定位 (absolute)，缺乏拖曳邏輯與 Pointer Events 捕捉。
  2. **拖曳反向**：拖曳算法過於簡陋，單純比較 `dx` 和 `dy` 的絕對值來加減，完全沒有考量到尺寸標註在 2D 平面上的「幾何法向量 (Normal Vector)」，加上視窗的 `clientY` 座標軸與世界座標系方向相反，導致只要拖曳朝向左或朝下的尺寸，方向必然顛倒。
  3. **隱形繪圖與無腦疊加**：
     - **隱形繪圖地雷**：重構時雖然將 `handlePlaneClick` 的邏輯轉移到了 `ToolHandlers`，但由於提早 `return`，錯過了設定給繪圖預覽線使用的狀態，導致 `CIRCLE`、`LINE`、`RECTANGLE` 在畫第一筆時完全沒有畫面預覽。使用者以為沒點到，於是重複點擊，在原地畫了三個一模一樣重疊的圓。
     - **無腦疊加**：`SMART_DIMENSION` 的點擊邏輯在偵測到邊緣時，會無條件建立一個新的距離約束，如果點擊同一個圓 3 次，就會產生 3 條指向同一個圓的標註。
* **矯正與預防措施 (CAPA)**：
  1. **工業級拖曳 (HeadsUpToolbar)**：在最左側實作了支援原生 `setPointerCapture` 的拖拉把手，使用 CSS `calc()` 動態計算 offset，保證快速拖動時不會脫落。
  2. **投影內積算法 (Dot Product Projection)**：重構 `SketchPreview.tsx` 的標註拖拉邏輯。現在按下時會擷取該尺寸線的法向量 `(nx, ny)`，並在 `pointerMove` 時將滑鼠位移量 `(dx, dy)` 投影到該法向量上 `(dx * nx - dy * ny)`，徹底解決任何角度的拖拉反向問題。
  3. **預覽綁定與防呆鎖 (Deduplication Lock)**：
     - **預覽重構**：廢棄單點的 `lastClickedUV`，改用全局統一的 `lastClickedNodeId` 作為所有草圖工具是否正在繪製中的判定標準 (Source of Truth)，確保預覽線永遠正確顯示。
     - **防重疊鎖**：在 `handleEntityClick` 中新增了 `existingDim` 檢查，如果選中的兩個端點間「已經存在」距離約束，則直接 return，拒絕產生無限堆疊的幽靈標註。
