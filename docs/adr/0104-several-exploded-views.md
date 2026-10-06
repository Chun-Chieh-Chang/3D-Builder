# ADR 0104：多組爆炸（E-2，組合件 Schema 7）

- 狀態：**已實作並驗證（2026-10-07）**。計畫：[assembly-explode-plan](../assembly-explode-plan.md) §3。
- 組合件 Schema 6 → **7**。

## 決定與做法

1. **資料**：`AssemblyDoc.explosions?: ExplodeView[]`（`{id, name, steps}`）與 `activeExplosion?: Id`；舊的 `explosion?: ExplodeStep[]` 欄位移除。一組爆炸＝一份步驟清單，多組只是多幾份，單一來源（步驟的語意、`explosionOffsets` 都不變，只是讀「顯示中那一組」的步驟：`activeExplosion(doc)`、`explosionSteps(doc)`；沒有 `activeExplosion` 或指到不存在的 id 時取第一組，手寫的檔也不會壞）。
2. **遷移 6 → 7**：有步驟的舊檔 → `explosions: [{ id: 'explosion1', name: '爆炸視圖1', steps }]`、`activeExplosion: 'explosion1'`，`explosion` 拿掉；沒有步驟的檔不變。名稱取自目錄（`explode.viewName`，載入時的語言）。載入時的計數器涵蓋各組與各步驟的 id。
3. **指令**：既有的 `insertExplodeStep`／`setExplodeStep`／`deleteExplodeSteps`／`moveExplodeStep` 作用在顯示中的那一組，沒有任何一組時第一個步驟建出「爆炸視圖1」（id 由 `IdAllocator` 取 `explosion` 序號）；新增 `insertExplosion`（成為顯示中的）、`renameExplosion`（去頭尾空白、不可空白）、`deleteExplosion`（顯示中的被刪，顯示它的位置上的下一組；最後一組刪掉時兩個欄位都拿掉）、`setActiveExplosion`；每個指令一個復原步驟；id 不重用（計數器）。刪除零組件時各組的步驟都清掉該零組件，空了的步驟刪掉、組留著。
4. **介面**：面板最上方「爆炸視圖組」：下拉（顯示與編輯的那一組）、「新增一組」、「刪除這一組」、名稱欄（Enter 或離開欄位時改名）；換組、新增、刪除之後正在做的步驟重新開始（屬於舊那一組的草稿不帶過去）。設計樹的「爆炸視圖」資料夾在有一組以上時寫出顯示中那組的名稱。爆炸線、動畫、爆炸位置都只看顯示中的那一組。

## 驗證

- 單元（`packages/model/test/explosion.test.ts`，手算）：兩組（沿 Z 爆 50 的銷、沿 X 爆 30 的定位組）切換後位移各自正確；步驟加在顯示中的那一組；沒有任何一組時第一個步驟建出「爆炸視圖1」；改名、空名稱被拒、找不到的 id 被拒；刪除顯示中的那一組顯示下一組、刪最後一組拿掉欄位、`explosion` 與 `explode` 的計數器；重複的 id 被拒；刪零組件清掉各組的步驟、組留著；版本 6 的檔（一份步驟）讀成第一組、位移 30 不變、沒有步驟的 6 版檔等於空組合件；寫出再讀回相同、五個指令的復原回到空組合件。`tests/phase2/assembly.test.ts` 的 v5 舊檔讀成 `explosion1`。
- 瀏覽器（`tests/e2e/phase3-explode.js`，金樣夾具）：面板按「新增一組」得到空的第二組，視圖回到組裝位置；步驟加進顯示中的那組、第一組仍是兩步；第二組讓定位組<1> 沿 x 走 25、定位組<2> 不動；改名；下拉換回第一組，位置回到它的步驟所擺的位置；復原取消切換；刪除顯示中的那組，另一組顯示、復原帶回；存檔重開後各組與顯示中的是哪一組都在，設計樹列出該組的步驟。

## 限制

- 每組爆炸各自只能移動頂層零組件，沒有「組合在一起的步驟」或「依另一組繼承」。
- 工程圖與 STEP 輸出不用爆炸（輸出永遠是組裝位置，不變）。
- 載入舊檔時名稱取自載入時的介面語言。
