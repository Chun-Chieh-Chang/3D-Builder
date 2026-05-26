# Google 5 大技能設計模式決策矩陣

## 1. Tool Wrapper (工具封裝模式)
- **描述**：將專業知識或工具封裝，供 AI 按需加載。
- **適用場景**：API 文檔、設計規範、法律條文、公司內部寫作風格指南。

## 2. Generator (模板生成模式)
- **描述**：強制執行特定的輸出格式。
- **適用場景**：週報生成、PRD 撰寫、代碼模版填充、標準化回信。

## 3. Reviewer (審查評估模式)
- **描述**：充當質量守門員。
- **適用場景**：代碼審查、設計稿校對、安全性檢查、文案潤色。

## 4. Inversion (需求反轉模式)
- **描述**：減少猜測，先問再做。
- **適用場景**：高複雜度代碼重構、不明確的數據分析請求、初次設置任務。

## 5. Pipeline (流程管線模式)
- **描述**：分步執行的流水線。
- **適用場景**：複雜的 SEO 優化流程、自動化部署、多模態內容產出 (文、圖、片)。

## 6. Knowledge Artifact (知識複利模式)
- **描述**：合成見解並存入持久化的 Wiki。
- **適用場景**：跨 session 的長效記憶、架構知識積累、Bug 根本原因分析 (RCA) 歸檔。

---

# Karpathy + Hermes 強化清單 (Guardrails)

## 1. 開發原則 (Karpathy Style)
- **Surgical Changes**：修改區域必須精確定位，嚴禁觸碰與任務無關的代碼或註解。
- **Simplicity First**：拒絕超出需求的 speculative features。
- **Think Before Coding**：動手前必先列出假設並驗證路徑。

## 2. 代理能力 (Hermes Style)
- **Anti-Hallucination**：在 `SKILL.md` 中包含「禁止行為」清單（例如：禁止修改通用模組、禁止刪除 pre-existing dead code）。
- **Phase-Based Workflow**：將 Pipeline 升級為階段式：
    - **Phase 1: Discovery** (掃描環境、確認依賴)
    - **Phase 2: Execution** (外科手術式實作)
    - **Phase 3: Verification** (自動化確效、回報結果)
- **Persona Alignment**：明確定義專家人格，例如「資深 SRE 專家」或「法醫分析師」。

## 3. 驗證模板 (Goal-Driven)
```markdown
## 執行計畫 (Verification Loop)
1. [任務描述] → verify: [如何驗證成功]
```
