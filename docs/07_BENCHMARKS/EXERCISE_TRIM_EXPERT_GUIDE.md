# SolidWorks Expert Guide: Power Trim & Select Chain Logic

**Source**: [YouTube: SOLIDWORKS 3D Modeling Tutorials - Cable Holder](https://www.youtube.com/watch?v=8ICAprtYpJg) (Applied Context)
**Reference**: Standard SOLIDWORKS 2000+ Trim Entities Logic

## 1. Power Trim (強力修剪) 數學邏輯
Power Trim 不是單連的「刪除」，而是一個動態的**拓撲切割**與**重新縫合**過程。

### A. 動態交點映射 (Dynamic Intersection Mapping)
當滑鼠（刷子）劃過某個草圖實體 $E_{target}$ 時：
1. **交點搜尋**：系統立即計算 $E_{target}$ 與畫布上所有其他非構造線 (Non-construction) 實體的幾何交點。
2. **區段化 (Segmentation)**：將 $E_{target}$ 依據所有找到的交點 $I_1, I_2, ..., I_n$ 拆分為多個子區段。
3. **鄰近判定**：判定滑鼠劃過點 $P_{brush}$ 落在線段的哪一個子區段 $[I_j, I_{j+1}]$。
4. **切割與刪除**：
   - 刪除 $[I_j, I_{j+1}]$。
   - 保留剩餘段，並在交點處自動產生新的**端點 (Vertex)**。
   - **自動約束**：在新的端點與交叉實體之間自動建立「重合 (Coincident)」約束。

### B. 角落修剪 (Corner Trim)
1. 選取兩條不相連或相交的實體。
2. 系統計算它們的虛擬交點。
3. 將兩實體各自縮減或延伸至該交點，並建立重合約束，形成完美的直角或轉角。

## 2. 選取鏈 (Select Chain) 邏輯
1. **起始實體**：使用者右鍵點選一個實體 $E_1$。
2. **深度優先搜尋 (DFS)**：
   - 遍歷 $E_1$ 的兩個端點。
   - 尋找與端點相連的其他實體 $E_2, E_3...$。
   - 若遇到分叉點（Degree > 2），則停止或依據切線連續性 (G1) 優先選取。
3. **終止條件**：直到遇到開放端點或形成閉合迴路。

## 3. 繪製體驗優化
- **自動閉合 (Auto-closure)**：在 `LineTool` 中，當連續繪製的最後一個點與該鏈的 `firstChainNodeId` 重合時，應：
  1. 建立最後一條閉合線段。
  2. 自動選取整個閉合鏈。
  3. **結束繪製狀態**（切換回選擇模式），這符合工業軟體的快速建模直覺。

---
**專案對標缺口 (Gap Checklist)**:
- [ ] `TrimTool.ts` 目前僅支持刪除整條邊，缺乏交點分割邏輯。
- [ ] `sketchActions.ts` 缺乏連通圖遍歷功能，無法實現一鍵選取鏈。
- [ ] `LineTool.ts` 雖然有閉合檢測，但不會自動切換模式或進行全鏈高亮。
