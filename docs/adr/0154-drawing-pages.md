# ADR 0154：工程圖多圖頁——資料模型與遷移（B2.8 第一部分）

- 狀態：**已完成（2026-10-17）**。**工程圖 Schema 24 → 25**（本專案第一個**結構性**遷移：把單張圖紙的欄位搬進 `pages[0]`，不是加欄位）。
- 需求追溯：藍圖 `docs/blueprint.md`:458,694（一張圖多張圖紙）；規格 `docs/drawing-interaction-gap-plan.md`:35,63,164 與 `docs/decisions-2026-10-18.html`:164,180（多圖頁）。相關：D-I6（標題集／多圖頁）見 [ADR 0129](0129-drawing-interaction-roadmap.md)；本 ADR 只做 **B2.8 第一部分：資料模型＋遷移**。使用者 2026-10-17 裁定：「**先做資料模型＋遷移，UI 頁籤後做**」。

## 背景

一張工程圖長久以來只有**一張圖紙**：`DrawingDoc` 直接把 `sheet`（圖紙設定）、`title`（標題欄）、`views`／`dimensions`／`tables`／`surfaceFinishes`／`annotations`（圖紙上的內容）掛在文件的根上。業界（SolidWorks 的 sheet、AutoCAD 的 layout）都是「一份圖檔＝多張圖紙」，每張圖紙各自有圖紙設定、標題欄與內容，共用同一份零件的參考。B2.8 要把資料模型改成多圖頁。

關鍵設計問題有三個：

1. **什麼放「頁」、什麼留「文件」**：內容（含圖紙設定與標題欄）屬頁；而 `properties`（`$PRP:` 運算式、`names.ts`、BOM 解析用的自訂屬性）是**整份文件共用**的，必須留在文件層。
2. **id 的唯一性範圍**：`idCounters` 是「下一個可用的 id」，若每頁各自計數，兩頁可能出現同一個 view id，會破壞「id 在文件內唯一」的既有保證（`drawingIdsInUse`、命令層的重複檢查）。故 `idCounters` 留在**文件層**，計數涵蓋所有頁。
3. **遷移的性質改變**：此前 24 個 drawing 遷移**全是加欄位**（`x ?? []`）或空轉；24 → 25 是第一次**搬動既有欄位**，因此舊程式必須被版本擋下（它會在根上找 `sheet`／`views`，找不到就當成空白圖）。

## 決定

1. **新的 `DrawingPage`（`packages/model/src/drawing.ts`）**：

   ```ts
   export interface DrawingPage {
     id: Id;
     name: string;
     sheet: SheetSetup;
     title: TitleBlock;
     views: DrawingView[];
     dimensions: Dimension[];
     tables: DrawingTable[];
     surfaceFinishes: SurfaceFinish[];
     annotations: DrawingAnnotation[];
   }
   ```

2. **`DrawingDoc` 只留文件層欄位**：`{ kind, schemaVersion, pages: DrawingPage[], properties, idCounters }`。`createEmptyDrawing()` 回**一頁**（`id: 'page1'`、`name: ''`、A3 橫放 1:1 第一角），欄位內容與舊版完全相同。

3. **Schema 24 → 25**：`drawingMigrations[24]` 把根上的 `sheet`／`title`／`views`／`dimensions`／`tables`／`surfaceFinishes`／`annotations` 收進 `pages: [{ id: 'page1', name: '', … }]`，`properties`／`idCounters` 不動。舊程式拒開新檔（版本閘）。

4. **三個存取協助函式**（同檔）：
   - `page(doc, index = 0)`：取第 index 頁（目前只有第 0 頁）。
   - `withPage(doc, p)`：以 `p` 換掉第 0 頁（其餘頁保留）。
   - `drawingFromPage(p, properties = {})`：由一頁＋屬性重建一份完整的 `DrawingDoc`（合成臨時文件用）。
   - **命名注意**：`packages/model/src/measureView.ts`:105 已有一支 `drawingOf`，新函式若同名會造成 `export *` 的 TS2308 衝突，故命名為 `drawingFromPage`。

5. **呼叫端改動面壓在最小**：`buildScene`／`layoutViews`／`fitViews` 等**保留 `DrawingDoc` 參數**，函式內以 `const pg = page(doc)` 取頁，所以外部呼叫點（Worker、`state/drawing.ts`、面板）**不必改簽名**；只有幾個小 helper（`scaleOf`／`scaleTarget`／`resolveLines`／`sideOf`／`arrangementBase`／`slideAxis`）的參數收窄為 `Pick<DrawingDoc, 'pages'>`。需要「造一份臨時文件」的地方（`suggestScale`、`previewDerived`、`fit.arrangedBox`）改用 `drawingFromPage`／`withPage`。

6. **`parseDrawing` 改成驗 `pages`**：`raw.pages` 必須是**非空陣列**、且**每一頁的 `sheet` 是物件**；每頁補上空的 `title`／`views`／`dimensions`／`tables`／`surfaceFinishes`／`annotations`；id 計數走**所有頁**的內容。

7. **UI 尚未動**：本次不含頁籤、新增／刪除頁、跨頁拖拉（使用者裁定的 shape 1）。所有既有介面仍只操作 `pages[0]`，功能與 B2.8 之前完全一致。

## 紅隊與驗證中抓到的事（本次最花時間的部分）

### A. 真缺陷：`fit.ts` 的「最適比例」框被當前 shift 汙染（實作中被測試抓到）

重寫 `arrangedBox`（`packages/drawing/src/fit.ts`）時，我把「算框用的臨時文件」的 `sheet` 取自 `page(doc).sheet`——**它含目前的 `sheet.shift`**；而 HEAD 的原文是 `{ ...own, sheet: { ...own.sheet, scale } }`，`own.sheet` 的 `shift` 已被設為 `undefined`。後果：算框時整組視圖先被現有位移搬走，`shiftToCentre` 再把位移補回去，於是 `fitViews().shift` **多減了一次當前 shift**。實測 `18.5 → −31.5`（差 50 ＝測試設定的 shift）。由 `drawing-fit.test.ts` 三個測試抓到。修法：改回以**未位移**的那一頁算框（`page(own)`）。

### B. 測試假資料被揪出：13 個測試用「改版本號」偽造舊檔，在結構性遷移下不再是舊檔

這是本次最隱蔽的問題。13 個測試以「把本版 `serializeDrawing` 寫出的檔的 `schemaVersion` 改小」來偽造舊檔（例：`old.schemaVersion = 3`）。這在**加欄位式**遷移下可行；但 v25 是**結構性**遷移，偽造檔已是 v25 的形狀（有 `pages`、根上沒有 `sheet`），`drawingMigrations[24]` 取 `doc.sheet` 得到 `undefined`，於是每頁缺 `sheet` → `FormatError`（`format.noViews`）。

**判定：這不是產品缺陷，是測試在說謊。** 真實的舊檔 `sheet` 確實在根上；產品讀真實舊檔沒問題。修法：新增 `tests/support/drawingVersion.ts` 的 `olderDrawingFile(doc, version)`——把 `pages[0]` 的欄位還原到根、刪掉 `pages`，且**只放該版本真的有的欄位**（`dimensions` 自 v3、`tables` 自 v4、`surfaceFinishes` 自 v10、`annotations` 自 v12），使假檔成為「那個版本的程式真的會寫出來的檔」。13 個測試改用它；另 **7 處版本斷言由 24 改為 25**（5 處「schema 版本為 24」＋2 處「舊檔讀入後為 24」）。

此修法**加強**了覆蓋：現在是在驗證 v25 遷移對**真正舊檔**的處理，而不是讓一段假的舊檔碰巧通過。（依 AGENTS.md §2.4「嚴禁 hardcode 假資料冒充功能通過」。）

### C. 呼叫端 codemod 兩次失手（記錄以免重蹈）

把 `doc.<頁欄位>` 改成 `page(doc).<頁欄位>` 有 600+ 處。三次嘗試：

- **v1（盲目 `replaceAll`）**：誤改非 `DrawingDoc` 的接收者（DXF 測試的 `DxfDocument.tables`、`PlateDrawing`、`any` 接收者、`buildScene` 的回傳值）。已 `git checkout -- tests` **全數還原**。
- **v2（由 typecheck 錯誤位置驅動）**：方向正確，但**接收者左掃**把 `)` 與擴展運算子 `...` 一起吞掉，產生 `page(.doc)`／`page(...doc)` 等 7 個語法錯誤，且語法錯誤會**抑制該檔的語意錯誤**，使真正的問題被藏住。
- **v3（加入括號配對與引號跳脫的左掃）**：一次改寫 43 處呼叫運算式接收者，收斂到 typecheck 0。

教訓：大量改呼叫端必須由**編譯器位置**驅動；接收者解析必須處理**呼叫運算式／索引／擴展**，不能只掃識別字。

### D. 人工處理的少數站點

3 處型別位置（`Partial<DrawingDoc['sheet']>` → `Partial<DrawingPage['sheet']>`＋補 `DrawingPage` 匯入）與 5 處「以物件字面值偽造文件」（`{ ...doc, views }` → `withPage(doc, { ...page(doc), views })`）無法自動改，逐一人工處理。

## 驗收

| 標準 | 結果 |
|---|---|
| 每張圖紙各有自己的圖紙設定、標題欄與內容；文件層只留 `properties`／`idCounters` | `drawing-document.test.ts`：`createEmptyDrawing()` 的形狀＝`pages: [{ id: 'page1', sheet: { A3 橫放 1:1 第一角 }, views: [], title: {} }]` |
| 存檔讀回同構、且穩定可重現 | 同上：`serializeDrawing(parseDrawing(text)) === text`；`page(back)` 與原文件相等 |
| **遷移 24 → 25 對真實舊檔有效**（紅隊：13 個測試改餵真舊檔） | `olderDrawingFile(doc, version)` 造出 v1／v2／v3／v4／v6／v8／v9／v11／v18／v19／v21／v22／v23 真舊檔；`parseDrawing` 皆升為 25 且保留原有內容（如 v3 無 tables → `[]`、v9 無表面粗糙度 → `[]`、v18 的 `hidden: boolean` 轉為 `display`、v19 無 `titleStyle`） |
| 舊程式被版本擋下 | v25 檔的版本閘（`upgrade`：`version > current` 拋錯）；`drawing-document.test.ts` 以 `schemaVersion: 99` 驗證 |
| **「最適比例」不再被當前 shift 汙染（紅隊：真缺陷）** | `drawing-fit.test.ts`：`sheet.shift` 為 `[0,0]` 與 `[50,50]` 兩種文件，`fitViews().shift` 必須相同；修正後三項測試通過 |
| id 仍全文件唯一（不因多頁而重號） | `idCounters` 留在文件層；`parseDrawing` 的計數走所有頁；既有 id 唯一性測試不變 |
| 功能與 B2.8 前一致（UI 未動） | `packages/drawing` 全部與 `apps/web` 標的檔在 typecheck 0 下行為不變 |
| typecheck 0、lint 全過、全量測試 0 失敗 | typecheck **0**；`lint:rules`（exit 0）／`lint:deps`（Layering OK）／`lint:i18n`（181 行，未逾基準）全過；**全量 vitest 239 檔（235 過／4 略）、2977 過／25 略、0 失敗**；`tests/phase5` **47/47 檔通過** |
| `verify:ui` | **未執行**（本機 `verify:ui` 超過 25 分鐘逾時，與 B2.6／ADR 0151／0152／0153 相同；且本次無新介面，見下） |

## 已知限制

- **只做完 shape 1**：目前 `pages` 永遠只有一頁；**頁籤 UI、新增／刪除頁、跨頁拖放、列印多頁**均**未實作**。所有既有操作仍只作用於 `pages[0]`。
- **`withPage` 只換第 0 頁**（`pages: [p, ...doc.pages.slice(1)]`）；多頁的選取／排序語意待 shape 2。
- `properties` 與 `idCounters` 是**整份文件共用**：跨頁共用自訂屬性，且 id 全文件唯一（這是刻意的，見背景 2）；若日後要「每頁各自的圖號」，需另立一個**頁層**欄位，不要把 `title` 往上搬。
- 舊程式（schema ≤ 24）**拒開** v25 檔（結構性變更，無法回寫）。
- B2.8 的 schema 與**另一工作階段的 B2.2** 可能同時改到 `DRAWING_SCHEMA_VERSION` 與 `DrawingViewport.tsx`／`drawing.ts`，合併時可能要重新編號或解衝突。
