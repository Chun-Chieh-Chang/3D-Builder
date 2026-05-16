# [NEW] Skill Architect: 技能生成工具 (基於 Google 5 大模式)

此工具旨在將「技能開發知識」轉化為一個互動式的 Input-Output 流程。User 只需要描述需求，工具即可自動產出對應的 `SKILL.md`。

## User Review Required
> [!IMPORTANT]
> 此工具將作為 Antigravity 的一個新技能 (Skill) 存在。安裝後，你只需要提及「幫我設計一個 Skill」即可觸發。

## Proposed Changes

### [Antigravity Skill] Skill Architect

#### [NEW] [SKILL.md](file:///C:/Users/3kids/.gemini/antigravity/skills/skill-architect/SKILL.md)
*   **觸發條件**：監聽「設計技能」、「開發 Skill」、「Skill 建築師」等關鍵詞。
*   **核心邏輯**：使用 **Inversion (需求反轉)** 模式引導用戶提供背景。
*   **模版生成**：根據 Google 5 大模式提供結構化輸出。

#### [NEW] [patterns.md](file:///C:/Users/3kids/.gemini/antigravity/skills/skill-architect/references/patterns.md)
*   收錄 5 種模式的詳細定義、適用案例與 `SKILL.md` 程式碼片段。

## Verification Plan

### Manual Verification
1.  **測試案例 A (Tool Wrapper)**：輸入「我想要讓 AI 遵守我的 Python 編寫規範」。
    *   預期：輸出 `Tool Wrapper` 模式的 Skill 結構。
2.  **測試案例 B (Reviewer)**：輸入「幫我檢查文案是否有錯字」。
    *   預期：輸出 `Reviewer` 模式的 Skill 結構。
