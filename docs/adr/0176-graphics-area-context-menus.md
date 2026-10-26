# ADR 0176：零件、草圖、組合件畫面的右鍵選單

## 1. 背景

2026-10-20 使用者反映「很多功能都可以加進滑鼠右鍵選單」，並要求以 SolidWorks／FreeCAD 公開文件為準審查交互。審查報告 `docs/ui-interaction-audit.md` §8 第 1 批即本 ADR：3D 畫面的右鍵統一，比照 ADR 0177（工程圖）的作法。

**開工前讀碼的現況**：

- 零件 3D 畫面（`Viewport.tsx` `onContextMenu`）：只在 PropertyManager 中有「相切邊線、迴圈、相切面、選取其他」；沒有任何特徵指令。沒有網格（新零件）時連選單都不開。
- 草圖：選取工具時右鍵**完全沒有選單**；畫圖工具開著時只有「快速抓取」。
- 組合件 3D 畫面：**審查報告寫「沒有選單」有誤**——`AssemblyViewport` 早已在零組件上開 `ComponentMenu`（與設計樹同一個元件）。缺的是結合、移動、旋轉；選單文字（開啟零件、浮動、固定、刪除…）寫死中文，違反 i18n。空白處沒有選單。
- 設計樹的特徵右鍵各自呼叫 `store.beginEdit`／`store.suppress`／`store.requestDelete`，和畫面若再寫一套就會是兩份實作。

## 2. 決策

1. **一份命令定義**（`actions.ts`）。新增只在右鍵出現的命令，以 `menuOnly: true` 標記（`CommandBar` 不畫它們的按鈕，快捷鍵對話框與說明照常列出）：
   - 零件：`edit-feature`（特徵是草圖時名稱為「編輯草圖」）、`edit-feature-sketch`、`suppress-feature`、`toggle-visibility`（本體時為「隱藏本體／顯示本體」）、`delete-feature`。
   - 組合件：`open-component`、`relink-component`、`hide-component`、`transparent-component`、`suppress-component`、`delete-component`。
   - 草圖：`sketch-delete`、`sketch-select-chain`、`sketch-end-tool`。
   - 其餘直接沿用既有命令：`sketch`（在面上畫草圖）、`fillet`、`chamfer`、`measure-part`、`tool-dimension`、`construction`、`exit-sketch`、`view-normal`、`fit`、標準視角、`filter-bar`、`mate`、`move-component`、`rotate-component`、`fix-component`／`float-component`、`insert-component`。
2. **命令作用在「選取的東西」上**，右鍵先選取指標下的東西（ADR 0177 同一原則）：指標下的若已在選取之中，選取保持不變。
   - `contextFeature(s)`：設計樹選取的特徵，否則選取的面／邊／頂點的名稱經 `ownerFeatures` 得到的特徵。
   - `contextVisibilityKey(s)`：設計樹選取的本體；否則選取的面所在本體（依 `bodies[].face0/faces` 範圍）、選取的邊兩側的面所在本體（`topologyOf(r).edgeFaces`）；否則設計樹選取、可隱藏的草圖或參考幾何。
   - 草圖：`SketchController.contextPick` 先找圖元、再找草圖的軸（ADR 0170），選取規則同上；沒點到東西時選取不變。
3. **選單內容是純函式**（`apps/web/src/contextMenus.ts`）：`partMenu`、`sketchMenu`、`assemblyMenu` 傳回 `MenuEntry[]`（命令、分隔線、子選單）。命令的名稱與可否執行一律取自 `ACTIONS`（`command(s, id, run?)`；`run` 只在需要右鍵當下的上下文時才另給，例如量測要帶入指標下的頂點）。分隔線由 `tidy` 統一整理。
   - 面：編輯特徵、編輯草圖、草圖（非平面時反灰）、隱藏本體、抑制、量測。
   - 邊：編輯特徵、編輯草圖、圓角、倒角、隱藏本體、抑制、量測（圓角、倒角本來就以選取的邊為預選，`preselectedEdges`）。
   - 頂點：編輯特徵、量測。
   - 空白處：全部顯示、正視於、標準視角 ▸、選擇濾器。
   - PropertyManager 或量測中：只有原本的選取工具（相切、迴圈、選取其他），不出特徵指令。
   - 草圖圖元：加入限制條件 ▸（與 PropertyManager 相同的清單：抽出 `relationsOffered`，兩處共用）、智慧型尺寸（`startDimension`：選取的一或兩個圖元當作工具的前幾次點選）、構造線、選擇鏈、刪除、正視於、離開草圖。
   - 草圖空白處：直線、邊角矩形、圓、圓弧、智慧型尺寸、正視於、離開草圖。
   - 畫圖工具中：結束目前的工具；會放點的工具另有快速抓取 ▸（S-4 原有）。
   - 零組件：開啟零件、重新指定零件檔、結合、移動、旋轉、固定或浮動（依現況擇一）、隱藏、透明、抑制、刪除。
   - 組合件空白處：插入零組件、結合、全部顯示、正視於、標準視角 ▸、選擇濾器。
4. **畫面與設計樹共用**：`FeatureTree` 的編輯、抑制、隱藏、刪除與本體的隱藏改用同一批命令（`MenuEntries` 把 `MenuEntry` 畫成設計樹的 `<li>`）；`ComponentMenu` 整個改成 `assemblyMenu`。畫面上的選單由 `GraphicsMenu` 繪製（沿用 `.ctx-menu` 樣式，每一行帶 `data-action`，選單本身帶 `data-graphics-menu`，供 e2e 判斷）。
5. **共用的小模組**：`state/featureSketches.ts`（特徵用到的草圖，原在 `FeatureTree`；2026-10-21 併入 `@3db/model` 的 `absorbedSketches`，見 ADR 0018 補充）、`selectionSets.topologyOf`（原在 `Viewport`）、`sketcher/relationsOffered.ts`（原在 `PropertyManager`）。

## 3. 驗證

| 檔案 | 內容 | 結果 |
|---|---|---|
| `tests/phase8/context-menus.test.ts` | `contextFeature`／`contextVisibilityKey` 的對象；面、邊、頂點、空白、編輯中、量測中的零件選單；零組件與空白的組合件選單（PropertyManager 開著時全部反灰）；草圖 `contextPick`（圖元、已選取保持、空白保持、軸）、`selectChain`、`startDimension`（真實 PlaneGCS，標出 20）、加入水平關係後不再提供；所有選單命令都在 `ACTIONS` 中、設計樹不再自行呼叫 store、`menuOnly` 清單與說明 | 21/21 PASS |
| `tests/e2e/manual-context-menus.js`（瀏覽器，真實右鍵事件） | 零件 18 步：空白（標準視角 ▸ 前視）、頂點→量測、邊→圓角（邊已帶入）、圓角中保留選取工具、面（含「選取其他」）、隱藏本體與設計樹顯示本體、抑制＋復原、編輯特徵／編輯草圖、面上畫草圖、工具中結束工具、圖元選單、加入水平、構造線、智慧型尺寸＝線長、選擇鏈＝四邊、刪除、離開草圖。組合件 7 步：零組件選單、設計樹同一份、隱藏／顯示、抑制＋復原、結合、移動、空白處插入零組件 | 2/2 PASS |
| 完整 `npm run verify:ui`（自有埠 5491／9433／5493） | 全部 155 支 | 155/155 PASS，0 Console 錯誤 |
| 全量 vitest | 269 檔 | 265 PASS、4 skipped（原有），3265 tests 0 失敗 |
| typecheck、lint:rules、lint:deps、lint:i18n | | 全部通過（i18n 基準 AssemblyTree 16 → 12） |

### 3.1 使用者裁決後的補充（2026-10-20，`docs/pending-decisions.html`）

- **選擇濾器**：右鍵本來就遵守選擇濾器（`elementsAt` 用的是已套用濾器的 `edgesOn`／`facesOn`／`verticesOn`，與左鍵相同）。裁決時的說明「右鍵不遵守」是讀碼錯誤，未改程式碼，改以 e2e 證明：只開「面」時，在同時有邊與面的位置按右鍵得到面的選單、沒有選到邊；濾器全開時同一點得到邊的選單。
- **外觀**：面的選單加入既有的 `appearance` 命令；「外觀」對話框打開時改為停在所選的最窄對象（面 → 本體 → 特徵 → 零件），從面的右鍵開啟即作用在那個面。
- **寫死的中文**：`MovePanel`、`AssemblyViewport` 的提示與面板文字移到 i18n（`asmui.*`、`movepm.*`；zh-TW 字面不變），i18n 基準 177 → 145 行。
- 不做：頂點的「隱藏本體」、「孤立」。草圖空白處右鍵維持保留選取。

## 4. 已知限制

- SolidWorks 的「孤立」不做（使用者裁決）。
- 頂點沒有「隱藏本體」（使用者裁決不補）：頂點到本體沒有現成的對照（網格只給面的範圍與邊兩側的面）；要做得先在 rebuild 結果帶出頂點所在的本體。
- 草圖空白處按右鍵不會清掉既有選取（與 SolidWorks 相同）；空白處的選單只列畫圖工具，要對既有選取下指令請在選取的圖元上按右鍵。


### 2026-10-26：共用顯示網格開關

零件／草圖／組合件圖形區與零組件右鍵經`withGrid`加入「顯示網格」，為原`options.showGrid`偏好的checkbox入口；不是新的CAD命令，不新增action registry項。`MenuEntry.checked`由圖形區button與樹li共用渲染，狀態以勾號及`aria-checked`表達；執行時讀最新store狀態，透過原`setOptions`持久化，與系統選項同步，不影響草圖工具／選取／交易／抓取。

圖形區menu依自己的viewport限制邊界、內容與子選單尺寸改變時重新定位，避免新增的末列在畫面底部不可見。原`partMenu`／`sketchMenu`／`assemblyMenu`的CAD指令與啟用判定保留。5項新UI及原右鍵2項各有通過結果，詳[ADR0202補充](0202-viewport-grid-and-hidden-recovery.md)。原menu預期只加入toggle-grid，保留原模型與工具斷言；未重跑整套。已知兩項舊context-menus單元基準失敗仍見ADR0201，未在本批混修。
