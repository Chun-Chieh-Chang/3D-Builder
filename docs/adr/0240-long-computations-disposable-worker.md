# ADR 0240：長時間計算放在用完即丟的 Worker

日期：2026-11-07。狀態：已實作（特徵辨識）；截面間隙接入時沿用（handoff §0b 第 7 項）。

## 背景

使用者要求辨識與截面間隙共用一套「超時停止、可按取消」。OCCT 是同步的 WASM，無法中斷；一個正在計算的 Worker 不會處理任何訊息。所以只有兩種可停止的方式，也都需要：

- **在 OCCT 的呼叫之間詢問**：能說出停止的原因，但擋不住單一呼叫卡死。
- **終止 Worker**：什麼都擋得住，但原因只能由頁面判定，而且 Worker 裡的一切都沒了。

辨識原本和畫面上的零件共用同一個 Worker，於是取消要連零件一起重建，崩潰與 Heap 成長（AGENTS §3.5）也都由那個 Worker 承擔。

## 決定

1. **辨識在專用 Worker 跑（`worker/job.worker.ts`），每次一個，結束就終止**（`worker/job.ts` 的 `startJob`）。取消、超時、崩潰都只終止它：文件、結果、主 Worker 完全不動（`workerGeneration` 不變，瀏覽器腳本斷言）。它成長的 Heap 隨它消失。
2. **兩層上限**：
   - `@3db/regen` 的 `startBudget`（`RECOGNIZE_LIMITS`：120 秒、Heap 成長 512 MiB，以唯一真實路徑量測），在每個截面與重建之間詢問，超過丟 `BudgetError`，訊息說明原因。預設開啟，所以沒有 Worker 的 MCP 伺服器同樣受保護。
   - 頁面的 `recognizeLimitMs`（130 秒），比前者晚，專門處理單一 OCCT 呼叫不返回。載入 43 MB WASM 不計入，比照既有的 `withinLimit`。
3. **取消鈕放在狀態列**，因為辨識可以從設計樹右鍵啟動，那時面板不一定開著。

## 取捨

- **代價**：每次辨識多載入一次 WASM。由瀏覽器腳本的總時間推估約 1 秒，加上一份模組的記憶體（計算期間）。辨識不是常用操作，換來隔離值得。
- **不做的**：不把一般重算搬過去。重算已有 `rebuildLimitMs`、`restartWorker` 與 ADR 0126；重算結果必須留在主 Worker 供點選與量測。第 7 項若需要取消重算，要另外決定取消之後文件如何處理。
- **MCP 擋不住單一呼叫卡死**：它沒有可終止的 Worker。這是已知限制，未解。
- **上限是本機實測值，不是證明。**

## 實作時的陷阱

對同一個 Worker 呼叫兩次 `Comlink.wrap` 會讓辨識永遠等不到回應：第一個 proxy 在 WASM 載入期間沒有參照而被回收，`proxyCounter` 歸零，Comlink 就送 `RELEASE`，Worker 端移除監聽（`comlink.mjs` 第 140、205 行）。單元測試用假 Worker 測不到，只有瀏覽器腳本抓得到。一個 Job 只 wrap 一次，並持有到結束。

## 驗證

- `apps/web/test/job.test.ts`（7）：回答、拒絕、載入不計時、超時、載入中與計算中取消、Worker 死亡、結束後取消。
- `tests/phase8/recognize-budget.test.ts`（4）：非法上限拒絕、時間上限、每個截面都詢問、在真實成長的 Heap 上觸發記憶體上限（§3.1、§3.2）。
- `tests/e2e/phase8-feature-recognition.js`：真實瀏覽器裡按取消、超時，文件／結果／Worker 不變，之後仍能辨識。
- 突變 8 項全部轉紅。
