# ADR 0153：輔助視圖（D-I6 第三部分）

- 狀態：**已完成（2026-10-19）**。**工程圖 Schema 23 → 24**（遷移空轉，舊程式拒開新檔）。
- 需求追溯：[ADR 0129](0129-drawing-interaction-roadmap.md) 的 D-I6（輔助／斷裂／裁剪視圖）。D-I6 第一部分的斷裂視圖見 [ADR 0151](0151-drawing-break-view.md)，第二部分見 [ADR 0152](0152-drawing-crop-view.md)。藍圖 `docs/blueprint.md` C16.3；規格 `docs/drawing-interaction-gap-plan.md`:63,161 與 `docs/decisions-2026-10-18.html`:164「輔助視圖（補助線法）」。使用者 2026-10-19 決定：三種全做、逐一提交；**輔助視圖採「補助線法」**（在母視圖上任意畫一條補助線，垂直於它投影），**不依賴具名邊參考**。本 ADR 涵蓋輔助視圖，是 D-I6 三種的最後一種。

## 背景

零件的斜面在六個正交視圖裡都會被壓縮、量不到真實大小。業界做法（SolidWorks 的 auxiliary view、機械製圖的「補助投影／補助線法」）是在一個已知視圖上畫一條**補助線**（折線），垂直於這條線的方向再投影一張視圖，斜面就在這張視圖上呈現真形。方向完全由那條線決定，與模型上是否有可命名的邊無關——這正是規格與使用者裁定採「補助線法」而非「以具名邊當參考」的原因（gap-plan:112、161 原本設想以具名邊當參考）。

## 決定

1. **新的視圖種類 `auxiliary`**（`packages/model/src/drawing.ts`）：

   ```ts
   export interface AuxiliaryDrawingView extends ViewCommon {
     kind: 'auxiliary';
     parent: Id;
     /** The fold line on the parent, in the parent's view coordinates at full size: two points. The view looks square to it. */
     line: [[number, number], [number, number]];
     /** The arrows point to the right of the line from its first point to its second (the left with `flip`), as a section's. */
     flip?: boolean;
     /** The letter on the fold line and over the view: 「A」 for A–A. */
     label: string;
   }
   ```

   `flip` 沿用剖視圖的語意（箭頭改指另一側＝從零件另一邊看）；`belongs['auxiliary'] = ['line', 'label']`，`flip` 走與剖視圖相同的放寬閘。

2. **視圖方向由折線決定**：`axesOf` 的 `auxiliary` 分支回 `sectionLookAxes(base, view)`（`packages/model/src/drawing.ts`）——**與剖視圖「看」的方向是同一條規則，只差沒有剖切**。折線以母視圖的框架定出：`r = rightOf(parent)`（母視圖的圖紙 x）、`u = sheetUp(parent)`（圖紙 y），`along = Δx·r + Δy·u`；`sectionArrow` 把 `along` 在母視圖座標的方向定成 right／left／up／down，`sectionLookAxes` 再回傳垂直於折線的 `dir`（母視圖法線為其 `up`）。實例（前視圖，dir −Z、up +Y）：**垂直**折線 → `dir = +X`（看到零件左側）；**水平**折線 → `dir = ±Y`（俯／仰方向）；`flip` 則反轉看的方向。紅隊測試以 200 組隨機折線驗證 `dir` 與折線的 3D 方向正交、與母視圖 `dir` 正交、且框架正交歸一，而非比對現成數字表。

3. **不切任何東西**：`sectionCut` 對 `auxiliary` 拋 `drawing.notForKind`（它是補助投影，不是剖切）；應用層 `requestOf`（`apps/web/src/state/drawing.ts`）只在 `section`／`sectionLocal` 產生 `cut`，所以輔助視圖只做該方向的投影。因此它的線由 HLR 投影而來（`resolveLines` 原樣通過，不走裁切），**可以塗彩**（與裁剪視圖不同；`viewImage` 只排除 crop 與 break）。

4. **擺放與比例比照剖視圖**：`sideOf` 對 `auxiliary` 回 `sectionSide(sectionArrow(v), doc.sheet.projection)`——放在折線箭頭**背向**的一側（第三角），與剖視圖同一個規則；`scaleOf`／`scaleTarget` 亦比照剖視圖**沿用母視圖的比例**（母視圖有自設比例時跟它，否則跟圖紙）。這一條是實作中紅隊發現後補上的（見下 §6）。

5. **繪製**（`packages/drawing/src/scene.ts`）：把剖視圖的 `sectionItems` 參數放寬為 `Pick<SectionDrawingView, 'line' | 'label' | 'flip'>`，兩者**共用同一支繪製**——在**母視圖上**畫折線（centre 線型）、兩端各一個箭頭與字母，並在視圖下方畫標題 `${label}-${label}`（即「A–A」，比照局部剖視圖）。視圖自己的 `name` 不畫：與剖視圖一致，用字母命名（ISO 128-30）。

6. **紅隊修正：折線驗證自成一體（實作中發現的真缺陷）**。第一版把輔助視圖的折線直接交給剖視圖的 `checkSectionLine`（**階梯剖面**驗證器）檢查。結果：一條畫歪的補助線（3 點以上）會拋出「**階梯剖面**：第一段跟最後一段都要是二個點的線段…」——講的是**另一個特徵**，使用者畫錯的是折線，卻被指責階梯剖面（違反 AGENTS.md §2.1「非法輸入必須顯式拋錯並**說明原因**」）。改為自成一體的 `checkAuxiliaryFold`：**恰兩點**、座標為有限數、兩點不重合，一律拋 `drawing.badAuxiliaryLine`（訊息同步補為「折線要是兩個點，點的座標要是數字，兩點不能重合」）。由 `drawing-auxiliary-view.test.ts` 的折線拒絕測試鎖定。

7. **介面**（`apps/web`）：工具列新增「輔助視圖」鈕（`drawingUi.toolAuxiliary`，`data-action="toolAuxiliary"`）。操作：在**任一視圖**上拖曳出一條補助線（`lineAcrossBox` 使折線橫貫整個視圖、拖曳方向決定角度）→ 移動游標預覽（ghost 顯示翻轉後落點）→ 點一下放置（`addAuxiliary`）；Ctrl 自由放置。`Drag`／`DrawPlacement` 各加 `auxiliary` 分支；原 `sectionGhost` 泛化為 `lineGhost`（section 與 auxiliary 共用），另外包出 `sectionGhost`／`auxiliaryGhost`。命令層 `checkView` 是最終防線（UI 只提早告知）。

8. **Schema 23 → 24**（`drawingMigrations[23]` 空轉，舊程式拒開新檔）；四處版本斷言測試（`drawing-break-view`／`drawing-local-section`／`drawing-linked`／`drawing-crop-view`）同步更新為 24。

## 驗收

| 標準 | 結果 |
|---|---|
| 輔助視圖可插入，並保留母視圖、折線、字母、`flip` | `drawing-auxiliary-view.test.ts`：插入後 `kind`／`parent`／`line`／`label` 如所設；`flip` 亦保留 |
| **視圖方向垂直於折線、且落在母視圖平面內（紅隊）** | 同一測試：**200 組隨機折線**下，`dir` 與折線 3D 方向正交（< 1e-9）、與母視圖 `dir` 正交、框架正交歸一；且樣本確實含 >150 組斜折線（非只跑軸向） |
| 方向實例：垂折線→±X、橫折線→±Y、`flip` 反轉 | 同一測試：前視圖上垂直折線 `dir = [1,0,0]`、`flip` 為 `[-1,0,0]`；水平折線 `dir` 沿 ±Y |
| **不剖切（紅隊）** | 同一測試：`sectionCut(parent, aux)` 拋 `notForKind` |
| 折線非法當場拒絕，且訊息指向折線（非階梯剖面） | 同一測試：3 點（折）、零長度、座標 NaN 皆拋 `badAuxiliaryLine`（`折線要是兩個點…`） |
| 空字母、母視圖不存在被拒 | 同一測試：空字母拋 `labelEmpty`；母視圖不存在拋 `noParent` |
| 不屬於 auxiliary 的欄位被拒；`flip` 仍限 section／auxiliary | 同一測試：`setView` 帶 `outline`／`side` 拋「不屬於」；對 `projected` 設 `flip` 仍被拒 |
| 擺放：在折線側、與母視圖**同一條線上**（slideAxis 0／1） | 同一測試：垂直折線落左右、與母視圖同高；`slideAxis` 垂折線為 0、橫折線為 1 |
| 折線、箭頭、兩端字母、標題皆繪製；視圖 `name` 不畫 | 同一測試：`buildScene` 的 centre 折線比對照組多 1 條；文字含兩個 `A` 與 `A-A`，不含視圖 `name` |
| 比例沿用母視圖 | 同一測試：母視圖自設 1:2 → 輔助視圖 `scaleOf` 為 1:2；對照組（母視圖無自設比例）→ 圖紙比例 |
| 存檔讀回與舊檔升級 | 同一測試：`parseDrawing(serializeDrawing(doc))` 保留 auxiliary；把版本改成 23 的檔讀入後為 24 且內容完整（走 `drawingMigrations[23]`） |
| typecheck 0、lint 全過、全量 vitest 0 失敗 | typecheck 0；`lint:rules`／`lint:deps`／`lint:i18n` 全過；**235 檔通過、2975 過、25 略過、0 失敗**（本項 18/18） |
| `verify:ui` | **未執行**（本機 `verify:ui` 超過 25 分鐘逾時，與 B2.6／ADR 0151／0152 相同；輔助視圖的介面操作未經瀏覽器驗證，列為後續） |

## 已知限制

- **斜補助線的擺放**落於「最近的一方側」（與 D-I5 斜剖面一致）；視圖本身的**看方向是精確的**（由 `sectionLookAxes` 決定），只有「放在圖紙哪一側」取最近側。與斜剖面的已知限制同源，屬擺放美觀問題，非幾何錯誤。
- 折線必須是**單一直線（兩點）**；階梯／對正的補助線不支援（規格未要求，`checkAuxiliaryFold` 明示拒絕）。
- 「補助線」是**任意畫的一條線**，不吸附到模型具名邊（使用者裁定採補助線法）；因此視圖的**尺寸標註**仍受既有限制（`docs/drawing-interaction-gap-plan.md`:112——沒有一條線「從模型哪條邊來」的對應），輔助視圖不會自動讓斜面上的邊可標尺寸。
- 輔助視圖不能再被當作裁剪的母視圖等（`belongs['auxiliary']` 只有 `line`／`label`）；它可作為其他衍生視圖的母視圖鏈的一員（經 `axesOf` 遞迴），但無專門支援。
- `scaleTarget` 對 **crop** 的既有不一致（`scaleOf` 沿用母視圖、`scaleTarget` 卻回 `{ sheet: true }`）為 ADR 0152 既有行為，本 ADR **未動**，另行回報使用者裁定。
