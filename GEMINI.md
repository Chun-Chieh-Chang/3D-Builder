@./skills/core/using-superpowers/SKILL.md
@./skills/core/using-superpowers/references/gemini-tools.md


# Token Efficiency & RTK Patterns (Global Mandate)

**所有 Agent 在此專案中必須優先遵循「高信號輸出」原則：**

1. **代碼探索：** 優先使用 `python tools/rtk_ls.py` 查看目錄結構，使用 `python tools/rtk_read.py` 查看文件簽名。禁止在未了解結構前盲目讀取全文。
2. **日誌處理：** 執行噪聲較大的命令時，必須使用重定向到文件（Tee Recovery），並僅讀取過濾後的錯誤資訊。
3. **Context 保護：** 始終思考「我是否需要這段資訊的全文？」。如果只需要簽名或結構，務必使用優化工具。
4. **交接防護機制 (Handover Protection)：** 為了避免開發中斷導致 Context 丟失，在每個主要的任務結束時、等待使用者授權時，或 PDCA 閉環完成後，Agent **必須主動執行** `python tools/save_checkpoint.py`。這會自動將當前的開發狀態（包含 Git、未解決錯誤、DEV_LOG 日誌等）寫入根目錄的 `handover_resume_guide.md`，以便任何其他工具或帳號無縫接手。

# SkillsBuilder Multi-Agent Closed-Loop PDCA (Global Rule)

**專案專屬的子代理協同閉環機制 (Closed-Loop Workflow):**
本專案的開發必須強制依賴 `skills/dev/skills-builder-agents` 定義的子代理進行。
任何複雜功能的開發與修復，必須嚴格遵循以下循環，直到任務完成：
1. **[規劃] SolidWorks 專家**：接收用戶的建模需求（若需求為 YouTube 影片，專家需主動調用 `youtube` Skill 提取字幕與操作流程），將其轉換為精確的 CAD 操作步驟與標準。
2. **[實作] 實作機器人 (Robot Subagent)**：負責接手專家的教學步驟，透過 `browser_subagent` 實際在瀏覽器中操作 UI，驗證建模行為。
3. **[阻礙反饋]**：若機器人操作卡關（找不到按鈕、發生錯誤、不符合預期），機器人必須**立即停止**，並將錯誤拋給 **架構師代理 (Architect)**。
4. **[修正]**：架構師提出修訂方案，並交由 **核心實作代理 (Implementer)** 進行外科手術式修改，然後由 **QA 代理** 進行回歸檢查與建置驗證。
5. **[重試]**：修改完畢後，再次交由 **實作機器人** 重試。此循環將不斷往復 (Robot -> Architect -> Implementer -> QA -> Robot)，直到實作機器人能順暢無阻地完成 SolidWorks 專家所規定的所有操作步驟為止。
