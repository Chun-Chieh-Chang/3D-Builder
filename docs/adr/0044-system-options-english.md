# ADR 0044：系統選項與英文（Phase 3a-9c-3）

- 狀態：已實作（2026-10-01）。9c-3a：系統選項、英文目錄；9c-3b：把零件側介面與核心訊息的文字從程式碼搬進目錄（程式碼裡的中文從 589 行降到 183 行）。
- 對應：D8.1 系統選項、D9.1 多語系（繁中、英），見 [phase3-plan](../phase3-plan.md) §3 的 3a-9c；機制在 [ADR 0019](0019-i18n-mechanism.md)。
- **Schema 不變**（選項屬於這個瀏覽器與使用者，不屬於零件檔）。

## 決定

| # | 決定 | 理由 |
|---|---|---|
| 1 | **系統選項**（「工具」→「系統選項…」，`OptionsDialog`）：介面語言、自動存檔開關與等待秒數（2–600）、「新零件」使用的範本、開始時可點選的元素（面／邊線／頂點）。存在瀏覽器的 `localStorage` 的 `3db.options`（`apps/web/src/options.ts`）；語言仍存在原本的 `locale`，因為工作執行緒開機時就要用。 | D8.1。快速鍵已經是這個做法（ADR 0041），一致。 |
| 2 | **`parseOptions` 把存的東西當不可信的**：缺的、型別不對的、不認得的範本，都回到預設；秒數四捨五入並夾在範圍內。 | 舊版本或手改的 `localStorage` 不該讓程式起不來。 |
| 3 | **自動存檔可以關**：`Autosaver.enabled`、`delayMs` 可改；關掉時等著存的變更作廢（`cancel`），**已經存的那一份不動**，直到零件被儲存。 | 關掉不該讓使用者失去已經救得回的東西。 |
| 4 | **「新零件」用選項裡的範本**（`newPart`）；「新零件（範本）…」仍可臨時選別的。 | 常做鋁件的人不用每次選。 |
| 5 | **英文目錄**（`packages/i18n/src/en/`，與 `zh-TW` 逐檔對應，目前 860 多個文字全部有）。術語照 SolidWorks 英文版（Fillet、Chamfer、Boss/Base、Mid Plane、Up To Surface、Smart Dimension…）。測試：英文的每個鍵都在來源目錄裡、來源的每個鍵都有英文、佔位符一個不少、英文裡沒有中文（語言名稱除外）。缺的鍵顯示來源文字的機制不變（測試用 `registerTranslation('en', { key: undefined })` 做出缺的狀態）。 | D9.1。 |
| 6 | **`lint:i18n` 不算英文目錄**，和中文目錄一樣。 | 目錄本來就是放文字的地方。 |
| 7 | **9c-3b 搬了什麼**（`app`、`viewport`、`tree`、`pmpanels`、`dialogs`、`storemsg`、`sketchtools`、`core`、`lowlevel` 九個目錄檔，中英各一）：指令列的分頁與所有指令的名稱、狀態列、屬性管理員的草圖／伸長／旋轉／圓角／導角面板、確認刪除／錯誤為何／儲存變更／專案資料夾／重新指定檔案各對話框、設計樹的右鍵選單與父子關係、`store` 的訊息、草圖工具的提示與推論標籤、`regen` 與 `kernel` 的錯誤訊息、ZIP／文件格式／草圖規則／檔案挑選視窗的文字。 | 英文介面的零件工作流程不再中英混雜。 |
| 8 | **新建特徵與零件的預設名稱跟著當時的語言**（`Sketch1`、`Extrude1`、`Part1`）：名稱寫進文件，是使用者的資料，建好之後不隨語言變。 | 和 SolidWorks 一樣。 |
| 9 | **模型層在建立後才讀的文字用 getter**（`get label()`、`labelsOf`、`PENDING_VERB`、檔案挑選的 `description`）：模組載入時算出來的字串不會跟著語言變。草圖工具的「推論」改成記種類（`'tangent'`…），顯示時才翻譯，不再拿中文字串比較。 | 切換語言要立刻生效。 |

## 驗證

- `apps/web/test/options.test.ts`（5 項）：預設、壞資料、秒數範圍與取整、存取一致、瀏覽器拒絕儲存。`apps/web/test/autosave.test.ts` 加 2 項：關掉後不存、等待時間可改。`packages/i18n/test/i18n.test.ts` 加 3 項（上面第 5 點）。
- 瀏覽器（無頭 Chromium）：開「系統選項」，切到 English，設定存進 `localStorage`，介面中已進目錄的部分變成英文（設計樹的「Origin／Front Plane」、工具列、選擇濾器、視角方塊「Top／Front／Right」、顯示類型）；取消自動存檔後 `3db.options` 的 `autosave` 為 false；0 個頁面錯誤。

## 還沒做

- **程式碼裡還有 183 行中文**（`i18n-baseline.json`），幾乎都是組合件（`state/assembly.ts`、`model/assembly.ts`、移動／結合／插入面板、組合件樹、`assembly/*`、`regen/assembly.ts`）和示範件的內容。切到英文時組合件介面仍是中文；由「只減不增」的基準逐步搬。
- 文件裡存的名稱（「伸長1」「草圖1」）是使用者的資料，不隨語言變。
- 其他語言；系統選項的其他項目（預設單位、滑鼠操作、顯示的刷新）等有對應功能再加。
