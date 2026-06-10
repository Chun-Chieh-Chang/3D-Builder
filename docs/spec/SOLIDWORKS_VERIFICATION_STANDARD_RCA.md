# RCA/CAPA 標準流程

> **子文件**: 接續 `SOLIDWORKS_VERIFICATION_STANDARD.md` 第 4 節。

---

## 4. RCA/CAPA 標準流程

### 4.1 觸發條件

當發生以下任一情況時，必須啟動 RCA/CAPA 流程：
- L4 驗證項目未通過
- Golden Part 比對誤差超過容忍度
- 回歸測試發現既有功能退化
- 使用者回報的生產環境 bug

### 4.2 RCA 五步驟

| Step | 名稱 | 動作 | 輸出 |
|------|------|------|------|
| 1 | Event Trace | 追蹤從 React 事件 → Store → Renderer → Viewport 的完整路徑 | `event_trace.md` |
| 2 | State Diff | 比對預期狀態與實際 Zustand 快照的差異 | `state_diff.json` |
| 3 | Root Cause | 定位根本原因（代碼層/數據層/邏輯層） | `root_cause.md` |
| 4 | Fix | 實施修復方案 | Pull Request |
| 5 | Prevent | 在 `DEV_LOG.md` 記錄邊界條件，加入自動化測試 | `DEV_LOG.md` update + test |

### 4.3 CAPA 模板

使用 `docs/governance/RCA_CAPA_TEMPLATE.md` 標準模板記錄每個 RCA。

### 4.4 RCA 分類

| 類型 | 代碼 | 說明 | 舉例 |
|------|------|------|------|
| UI | UI-01 | 前端渲染/交互問題 | 按鈕無反應、視圖不更新 |
| Solver | SOLVER-01 | 約束求解器問題 | Newton-Raphson 不收斂 |
| Kernel | KERNEL-01 | 幾何內核問題 | B-Rep 拓撲錯誤 |
| IPC | IPC-01 | 前後端通訊問題 | JSON 解析失敗 |
| I/O | IO-01 | 檔案讀寫問題 | STEP 匯出損壞 |
| Perf | PERF-01 | 效能問題 | 重建超時 |
| Data | DATA-01 | 數據持久化問題 | 存檔無法還原 |
