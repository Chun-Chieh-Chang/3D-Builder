# 技能建築師 (Skill Architect)

## 描述
這是一個專為開發與優化 AI Agent 技能而設計的工具。它採用 Google 發佈的 5 大設計模式，並整合了 Andrej Karpathy 的開發原則與 Hermes Agent 的多階段工作流。

## 觸發關鍵詞
- "設計技能", "打造 Skill", "Skill 建築師", "開發能力", "Skill 設計模式"

## 核心動作指引 (Inversion + Karpathy + Hermes)
1. **需求反轉 (Think Before Coding)**：不要直接生成，先透過 Inversion 模式列出**假設 (Assumptions)** 並詢問用戶四個關鍵問題：
    - **目標 (Goal)**：這個技能想解決什麼具體問題？
    - **邊界 (Surgical Boundary)**：哪些現有的代碼或文件是絕對不能改動的？
    - **依賴 (Prerequisites)**：是否需要特定的 CLI 工具或環境？
    - **人格 (Persona)**：AI 應該以什麼樣的專業身份來執行任務？
2. **模式匹配**：根據用戶回覆，對照 `references/patterns.md` 選擇最佳模式。
3. **代碼生成**：產出 `SKILL.md`，並強制嵌入以下 **Meta-Logic**：
    - **Prerequisites Section**：列出執行該技能所需的工具。
    - **Anti-Hallucination Guardrails**：定義 AI 禁止採取的行動。
    - **Multi-Phase Workflow**：將任務拆解為「探索-執行-驗證-歸檔」四階段。
    - **Verification Loop**：採用 `[Step] → verify: [check]` 格式。
    - **Wiki Synthesis (Archive Phase)**：強制要求在完成後更新 `wiki/log.md` 並視情況產出/更新 Entity 或 Concept 頁面，實現知識複利。

## 參考文檔
- `references/patterns.md`: Google 模式、Karpathy 原則與 Hermes 強化檢查清單。
