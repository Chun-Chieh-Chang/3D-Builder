# Global Development Rulebook (SkillsBuilder)

This rulebook is the source of truth for all projects managed by Antigravity.

---

## 1. The Wiki Standard (Karpathy Pattern)
Every project should ideally maintain a `wiki/` directory with the following structure:
- `SCHEMA.md`: Governance rules.
- `index.md`: Map of all entities and concepts.
- `log.md`: Chronological activity log.
- `entities/`: Technical components.
- `concepts/`: High-level design patterns.

### The INGEST Workflow
When information enters the project (files, requirements, chat history):
1. **Analyze**: Identify key entities and concepts.
2. **Update**: Link new data to existing wiki pages.
3. **Log**: Record the action in `log.md`.

---

## 2. PDCA Execution SOP (Industrial Grade)
No code change should be made without following these steps:
- **[Plan]**: Deep diagnosis using First Principles. Scan project fragility and UI dissonance.
- **[Do]**: Surgical edits (MECE) + `DEV_LOG.md` entry documenting RCA (Root Cause) and CAPA (Corrective Action).
- **[Check]**: **Mandatory Multi-Skill Verification**. You MUST execute all project-specific "Anti-Error" skills (e.g., `encoding_guard`, `api_health_check`) before declaring completion. Zero errors in Console is the baseline.
- **[Act]**: Regression scan across dependencies + User approval + Git push. Record failure lessons to prevent recurrence.

---

## 3. UI/UX Design System (4-Dimension Framework)

> 📐 完整規範請參閱 Skill: `premium-ui-design` (SKILL.md v2)

所有專案的 UI 決策必須通過以下 4 個維度審查：
1. **色彩**: Morandi colors + watercolor wash + monochromatic (飽和度 S < 40%)
2. **佈局**: Card-based + layered elements + 4px grid
3. **風格**: 根據內容氣質匹配 Content Archetype (科技/人文/生活/金融/工業)
4. **哲學**: Approachable Luxury — 留白夠、細節克制、保有人味

### Default Palette: Refreshing Sea Salt Blue
- **Background (Base)**: #F0F7FB (Sea Salt Blue)
- **Surface**: #FFFFFF (Pure White)
- **Primary Text**: #1A3A5F (Deep Marine)
- **Secondary Text**: #5A7D9A (Muted Slate)
- **Accent/Brand**: #3A7CA8 (Ocean Blue)
- **Accent Hover**: #73A8C2 (Sky Wash)
- **Success/Safe**: #10B981 (Emerald)
- **Warning/Error**: #EF4444 (Red)
- **Border**: #B4D8E7 (Light Sky) — 4px/8px multiples

---

## 4. Superpowers 紀律護欄 (Superpowers Discipline Guardrails)

本專案已深度整合 `superpowers` 軟體工程方法論，將極致的紀律與工具調用強制內化為系統級規則：

### 4.1 全域技能強制喚醒原則 (The 1% Rule)
*   **規則**：只要你（AI 助理）判斷有**高於 1% 的機率**某個技能適用於當前任務，你**必須強制調用該技能**（透過 `activate_skill` 或對應工具）。
*   **不容合理化藉口**：禁止一切「這只是個簡單問題」、「我先 explore 代碼看看」等自我妥協的藉口。一旦有技能適用，必須立即加載執行。

### 4.2 反直覺與反偷懶防禦 (Anti-Rationalization Red Flags)
嚴格警惕以下「Vibe Coding」的心態起點，並立即停止與修正：
*   ❌ *「我需要先獲取更多上下文」* ➔ **正解**：技能會指導你如何系統化獲取上下文，必須先加載技能。
*   ❌ *「這個任務不需要正式技能」* ➔ **正解**：只要存在對應技能，就必須依照技能規格執行。
*   ❌ *「我記得這個技能的內容」* ➔ **正解**：技能是不斷迭代更新的，必須重新加載並核對最新步驟。

### 4.3 多 IDE 原生插件引導與上下文注入
*   SkillsBuilder 現已完全支援作為跨 IDE 的原生插件加載（Claude Code, Cursor, OpenCode, Gemini CLI）。
*   在每次會話啟動時，系統會自動通過 `session-start` 鉤子或 `superpowers.js` 插件將 `using-superpowers` 紀律護欄作為 `<EXTREMELY_IMPORTANT>` 上下文注入首條訊息，確保全生命週期均在超能力紀律保護下運行。

### 4.4 階段式計畫與高頻審查循環
*   **需求共識**：在動手前，強制調用 `grill-requirements` 進行蘇格拉底式「一次一問」需求釐清，獲得明確許可後才開始設計。
*   **精細計畫**：利用 `writing-plans` 產出對應的 `implementation_plan.md`，並在獲取使用者 Explicit Approval 後，使用 `executing-plans` 與 `task.md` 進行精準的外科手術式修復。
*   **測試驅動與系統調試**：開發中強制以 `tdd-enforcer`（測試驅動）與 `bug-diagnose`（系統化調試 4 階段）進行代碼安全隔離與根因排除，杜絕猜測性修改。
*   **完工驗證與代碼審查**：完成時必須通過 `verification-before-completion` 的 100% 零錯誤與確效審查，並調用 `requesting-code-review` / `receiving-code-review` 閉環修正，最後由 `finishing-a-development-branch` 進行 Git Commit 規範整理與 Push。

### 4.5 本地圖譜高效節流 (Graphifyy Low-Token Query Mandate)
*   **71.5 倍 Token 節流原則**：當專案規模擴大（涉及超過 3 個不同模組或組件深度大於 3 層）時，AI 助理**強制禁止**遞迴讀取大量代碼檔案或進行盲目全域正則表達式掃描。
*   **圖譜查詢優先**：AI 必須首先使用 `graphify query` 對本地圖譜進行語義查詢，以最低的 Token 預算精確獲取跨組件的依賴路徑與「爆炸半徑 (Blast Radius)」。
*   **同步維護**：在每一次 Git 變更 (Commit/Checkout/Merge) 或執行 `INSTALL.ps1` 後，AI 助理必須調用 `graphify . --update` 增量同步本地圖譜，確保大腦記憶庫 (`wiki/`) 與實體代碼拓撲 100% 同步。

---

## 5. PythonOCC / CAD Geometry Kernel Rules (幾何核心開發守則)
When modifying the CAD backend geometry services (such as `geometry_service.py`):
- **Never Direct `.HashCode()` Calls**: Never call `.HashCode(...)` directly on OpenCASCADE shapes (`TopoDS_Face`, `TopoDS_Edge`, etc.) as newer PythonOCC versions have removed this method. Always use the version-independent wrapper `get_shape_hash(shape, upper_bound)`.
- **Defensive Variable Definition**: Inside topological loop structures (like `TopExp_Explorer(shape, TopAbs_FACE)`), always explicitly extract the variable (e.g., `face = topods.Face(explorer.Current())`) immediately at the start of the loop before referencing it.
- **Local Regression Validation**: Before executing any git commit or push, you MUST run `npm run test:regression` locally to ensure that both the frontend golden tests and the backend unit tests pass 100%.

## 6. Clean CI Environment Defense (乾淨環境防禦)
When configuring package scripts or lifecycle hooks (like `postinstall`):
- **Conditional Hook Execution**: Never write hardcoded install hook scripts that depend on local development directories (e.g., `vendor/SkillsBuilder`) without verifying their existence. Always use conditional node commands (e.g., `fs.existsSync`) to prevent blocking clean/isolated CI containers.

---

## 7. Activation
在任何專案目錄對我說：**「啟動 SkillsBuilder 開發模式」**，或在系統中調用全域 `skills_builder` 知識項（Knowledge Item）以喚醒此規則手冊。
