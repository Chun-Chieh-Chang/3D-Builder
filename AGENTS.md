# 3D-Builder Agent 自我演化與系統防禦規則庫 (AGENTS.md)

本文件依據全域規則《自主進化與錯誤萃取元規則 (Proactive Self-Evolution Meta-Rule)》建立，記錄在開發過程中萃取出的系統脆弱點、失敗模式、根因分析 (RCA) 與強制執行的防禦 SOP。所有參與本專案的 AI Agent 與開發者必須強制遵守。

---

## 1. 核心盲點萃取：構建者偏差與防禦對抗機制

### 1.1 歷史失敗案例 (2026-10-11 螺牙特徵審查事件)
- **問題現象**：
  1. 多線牙型重疊時觸發布林 Fuse 導致 WASM 記憶體暴增崩潰（`table index is out of bounds`）。
  2. 線數輸入小數（如 1.5）被代碼隱含 `Math.round` 吞掉，掩蓋錯誤。
  3. 螺牙軸支援遺漏草圖中心線，導致 DAG 與介面拋出遺失參考。
  4. 記憶體洩漏測試只計算了 JS 物件 handle 數量，宣稱無洩漏，但未實際量測 Emscripten WASM Heap。
  5. 測試門檻被放寬以規避平行多工下的超時報錯。
- **根本原因 (RCA)**：
  - **構建者偏差 (Builder's Bias)**：實作者沉浸於功能實現的 Happy Path，缺乏對抗性破壞視角。
  - **代理指標謬誤 (Surrogate Metric Fallacy)**：以廉價但無效的指標（JS handles）替代高難度的真實指標（WASM heap）。
  - **防禦性退讓**：為追求測試變綠而妥協門檻。

---

## 2. 強制執行：自我紅隊對抗 SOP (Self-Red-Teaming Protocol)

任何新功能、特徵或核心演算法在聲稱「完成」並提交前，必須強制逐項通過以下「紅隊四問」檢驗，並記錄於 `DEV_LOG.md`：

### 2.1 破壞性邊界四問 (Disruptive Edge-Case Checklist)
1. **輸入破壞 (Input Corruption)**：
   - 是否傳入極端小數、非整數、負數、零、NaN、極大值？
   - **硬性約束**：非法或不合理數值必須在命令層/模型層立即拋出顯式錯誤並說明原因，**嚴禁使用 `Math.round`、`Math.abs` 等自作主張默默篡改用戶意圖**。
2. **拓樸與幾何相交破壞 (Geometric Self-Intersection Defense)**：
   - 在多實體、多線、陣列、厚面、薄殼操作中，相鄰特徵是否可能重疊？
   - **硬性約束**：幾何自相交必須在前置階段透過包圍盒或參數解析攔截（如 $zMax - zMin \ge pitch$ 直接拋出），不得無防禦丟給底層 OCCT 求解器進行災難性布林運算。
3. **依賴鏈完整性 (Dependency Graph Integrity)**：
   - 特徵所依賴的幾何參考（面、邊、頂點、草圖中心線、基準軸、座標系）是否在全鏈路中皆有完整支援？
   - 檢查清單：`schema.ts` -> `commands.ts` -> `refs.ts` -> `dag.ts` -> `engine.ts` -> `PropertyManager.tsx`，缺一不可。
4. **規格真實性與零 Mock 原則 (Zero-Mock & Ground Truth)**：
   - 宣稱符合特定行業規範（如 ISO 80369-7、ISO 286、ISO 4762）時，參數與幾何必須從定義嚴格推導（如 6.00% 錐度在標稱截面必須精確吻合）。
   - 驗收測試必須使用實體探針（物理量測）或真實拓樸萃取（`elementFacts`），**嚴禁在測試中 hardcode 假資料冒充功能通過**。

---

## 3. 測試質量與記憶體防禦硬準則

### 3.1 零代理指標原則 (No Surrogate Metrics)
- 測試記憶體洩漏時，禁止僅以物件計數（如 `liveHandles`、`meshCount`）宣告無洩漏。涉及 WASM/C++ 底層運算者，必須監控 Emscripten Heap（`HEAPU8.length`）或提供數學封閉性證明。

### 3.2 測試門檻零妥協原則 (Zero Threshold Degradation)
- 嚴禁為了解決 CI 或本機多工平行測試偶發超時而私自放寬 `setTimeout`、數值誤差容差或將測試設為 `skip`。
- 遇效能瓶頸，必須進行 Profiling 並透過架構隔離或多工解耦解決。

### 3.3 隨機參數壓力測試 (Mandatory Fuzzing Stress Test)
- 任何參數化核心特徵，必須包含 Fuzzing 隨機測試（至少 100~200 組隨機維度組態），確保極端與退化幾何下 0 崩潰、0 記憶體暴增。

---

## 4. 歷史演化紀錄與修訂日誌

- **2026-10-11**：初始化本文件。萃取 Claude Code 審查事件之根因，建立「自我紅隊對抗 SOP」與三大防禦硬準則。
