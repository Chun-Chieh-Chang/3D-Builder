@./skills/core/using-superpowers/SKILL.md
@./skills/core/using-superpowers/references/gemini-tools.md


# Token Efficiency & RTK Patterns (Global Mandate)

**所有 Agent 在此專案中必須優先遵循「高信號輸出」原則：**

1. **代碼探索：** 優先使用 \python tools/rtk_ls.py\ 查看目錄結構，使用 \python tools/rtk_read.py\ 查看文件簽名。禁止在未了解結構前盲目讀取全文。
2. **日誌處理：** 執行噪聲較大的命令時，必須使用重定向到文件（Tee Recovery），並僅讀取過濾後的錯誤資訊。
3. **Context 保護：** 始終思考「我是否需要這段資訊的全文？」。如果只需要簽名或結構，務必使用優化工具。
