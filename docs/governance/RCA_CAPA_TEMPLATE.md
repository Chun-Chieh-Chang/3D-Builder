# RCA/CAPA Template

> 當 `npm run pdca:check`、型別檢查、測試、build 或 Plan 對照失敗時，將以下模板複製到 `DEV_LOG.md`，完成 Act 後再重新執行 Check。

---

## [YYYY-MM-DD] RCA/CAPA：<事件標題>

### 0. Plan 對照

- **對應 Plan 文件**：`docs/productization/PRODUCTIZATION_PLAN.md`
- **對應 Phase**：Phase <N> / <版本>
- **對應 Backlog 主線**：<核心架構 / Sketch Engine / Geometry Kernel / ...>
- **預期結果**：<Plan 中要求的行為或驗收條件>
- **實際結果**：<Do 後產出的結果>
- **偏差描述**：<實際結果與 Plan 的差異>

### 1. Investigation（根因調查）

- **重現步驟**：
  1. <步驟 1>
  2. <步驟 2>
- **觀察到的錯誤 / 證據**：
  - <錯誤訊息、log、截圖、測試輸出>
- **影響範圍**：
  - <受影響檔案、功能、使用者流程>

### 2. Pattern（模式分析）

- **正常範例**：<專案中或外部標準的正確模式>
- **異常模式**：<本次偏差呈現的錯誤模式>
- **是否曾發生類似問題**：<DEV_LOG 或歷史 issue 連結>

### 3. RCA（Root Cause Analysis）

- **直接原因**：<導致失敗的直接技術原因>
- **根本原因**：<流程、架構、測試、規格或理解層面的根因>
- **為何現有防線沒有攔截**：<缺少何種測試、hook、文件或 review>

### 4. CAPA（Corrective and Preventive Actions）

#### Corrective Actions（矯正措施）

- [ ] <立即修復項 1>
- [ ] <立即修復項 2>

#### Preventive Actions（預防措施）

- [ ] <新增測試 / hook / 文件 / schema 約束>
- [ ] <避免同類問題再次發生的流程改進>

### 5. Verification（確效）

- **已執行命令**：
  - `npm run pdca:check`
  - `npx tsc --noEmit`
  - `<其他測試命令>`
- **結果**：<通過 / 失敗 / 環境限制>
- **殘留風險**：<若有，列出後續追蹤項>

### 6. PDCA 結論

- [ ] 已重新對照 Plan。
- [ ] 已完成矯正。
- [ ] 已完成預防措施。
- [ ] 已重新 Check 並通過。
- [ ] 可進入下一輪 Plan / Do。
