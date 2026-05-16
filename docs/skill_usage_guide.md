# AI Agent Skills 使用手冊 (快速入門)

這份手冊根據你提供的知識庫截圖整理而成，分為「使用現有技能」與「開發自定義技能」兩個部分。

---

## 🚀 第一部分：如何使用現有的技能 (Users)

這些技能通常透過終端機指令安裝到你的 AI Agent 環境中。

### 1. 安裝指令 (CLI)
根據截圖，你可以使用 `npx` 指令來新增功能。例如：

*   **搜尋與研究**：
    ```bash
    npx skills add tavily-ai/skills@search
    npx skills add tavily-ai/skills@research
    ```
*   **開發與效率**：
    ```bash
    npx skills add github/awesome-copilot@web-coder  # 網頁開發專家
    npx skills add steipete/clawdis@summarize         # 內容摘要專家
    ```
*   **安全與審核**：
    ```bash
    npx skills add hugomrtz/skill-vetting-clawhub@clawhub-skill-vetting
    ```

### 2. 如何觸發 (Triggering)
一旦安裝成功，你不需要手動呼叫它們。Skill 運作的邏輯是 **「關鍵詞監聽」**：
*   當你在對話中提到「幫我搜尋...」或「這段代碼的安全性如何？」。
*   Agent 會自動匹配背後的 `SKILL.md` 規則。
*   自動加載相關的專業知識或工具來回答你。

---

## 🛠️ 第二部分：如何開發自己的技能 (Developers)

根據 Google 的 5 種設計模式，你可以建立自己的專業技能。

### 1. 核心結構
一個 Skill 通常由一個資料夾組成，包含：
*   `SKILL.md`：定義技能的名稱、描述、關鍵詞觸發條件。
*   `references/`：存放專業文檔、標準、規範。
*   `scripts/` (選配)：存放自動化腳本。

### 2. 模式示例：工具封裝器 (Tool Wrapper)
如果你想讓 AI 遵守公司的設計手冊，你可以這樣寫：

**SKILL.md 範例：**
```markdown
# 品牌設計專家 (Brand Design Specialist)

## 描述
當用戶請求製作網頁、UI 或設計相關內容時，確保遵守公司品牌規範。

## 觸發關鍵詞
- "設計網頁", "UI 設計", "品牌配色", "調整樣式"

## 指令
- 加載 `references/brand_guide.md` 中的色階與字體規範。
- 所有的 CSS 修改必須優先參考 `references/tokens.json`。
```

### 3. Google 推薦的 5 大套路總結
*   **工具封裝 (Wrapper)**：給 AI 一本書 (知識庫)，讓它按書辦事。
*   **生成器 (Generator)**：給 AI 一個模版，讓它填空。
*   **審閱者 (Reviewer)**：讓 AI 當裁判，檢查產出的品質。
*   **反轉 (Inversion)**：讓 AI 先「反問」你細節，不要直接動手。
*   **流水線 (Pipeline)**：拆解複雜任務成 A -> B -> C 步驟。

---

## 💡 實戰小技巧
如果你現在想嘗試，可以對我說：
> 「幫我用 **『反轉模式』** 創造一個 Skill，目標是幫我寫高品質的 Python 代碼。」

我會示範如何先問你需求（環境、庫、性能要求），再開始寫代碼！
