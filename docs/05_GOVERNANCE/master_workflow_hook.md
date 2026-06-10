# ⚓ SkillsBuilder 記憶鉤子 (Master Workflow Hook)

本文件定義了如何快速觸發 Antigravity 的「資深開發模式」，確保你在新專案中不會遺忘任何核心準則。

## 🎯 觸發指令 (The Hook)
當你對我說出以下任何一句話時，我將立即進入 **SkillsBuilder 運作狀態**：

> **「Antigravity，啟動 SkillsBuilder 開發模式」**
> 或
> **「SkillsBuilder: 啟動新專案」**

---

## 🛠️ 觸發後的自動化流程 (SOP)

當指令被觸發，我會執行以下動作：

### 1. 環境診斷與規則注入
- **動作**：我會主動詢問新專案的路徑。
- **產出**：自動建立或更新 `.cursorrules` / `CLAUDE.md`，內容整合 **Karpathy + Superpowers** 資深準則，強調「設計硬門檻 (Design Hard Gate)」與「零佔位符計畫 (Zero-Placeholder Plans)」。

### 2. 蘇格拉底式需求反轉 (Socratic Inversion)
- **動作**：進入 **Brainstorming** 模式，暫停所有實作。我會一次向你提出一個關鍵問題，直至釐清所有潛在假設與邊界。
- **目標**：確認技術棧、性能要求、安全性需求與 UI 風格，並產出經過核准的設計文件 (`BRAINSTORMING.md`)。

### 3. 技能體系構建
- **動作**：載入對抗 Vibe Coding 的核心技能 (`tdd-enforcer`, `systematic-debugging`, `grill-requirements`)，以最高紀律規範後續開發。

### 4. 產出「Superpowers」開發計畫
- **動作**：產出顆粒度為 2-5 分鐘的任務計畫。
- **格式**：每一項任務必須包含精確檔案路徑、完整代碼實現、以及明確的驗證命令。嚴禁出現 "TBD" 或 "TODO"。


---

## 💡 快速切換指南
如果你在開發中途覺得我變得「太草率」或「太複雜」，你可以隨時喊出：
> **「回歸 Karpathy 準則」**

這會強迫我重新進行 **Surgical Changes** 與 **Simplicity First** 的自我審查。
