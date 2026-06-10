/goal 啟動「影片驅動型」功能缺口偵測與自動補足閉環。
   1. [分析偵測]：解析影片 [在此輸入 YouTube 網址]，由 [SolidWorks 專家] 提取該建模流程中使用的所有特徵、拘束與 UI
      交互。
   2. [缺口審計]：啟動 [架構師] 調用 solidworks-gap-analyzer
      技能，將影片要求的技術指標與當前系統（geometry_service.py、sketchActions.ts、RibbonController.tsx）進行交叉比對，
      產出 《功能缺口審計報告 (Gap Report)》。
   3. [自動實作]：針對報告中優先級最高的「缺失能力」（例如：缺失的 Loft 參數、特定的切除演算法、或未實現的 UI
      按鈕），交由 [核心實作] 執行外科手術式代碼補齊。
   4. [確效閉環]：
      - 由 [QA] 針對新功能撰寫單元測試。
      - 由 [實作機器人] 依據混合驗證協議 (Hybrid Verification) 重新在系統中重現該影片的建模邏輯，驗證缺口是否已修補。
   5. [資產交付]：更新 gap-checklist.md 中的 SCS 分數，同步更新 DEV_LOG.md，並執行 save_checkpoint.py 產出最新交接文檔。