# ADR 0152：裁剪視圖（D-I6 第二部分）

- 狀態：**已完成（2026-10-19）**。**工程圖 Schema 22 → 23**（遷移空轉，舊程式拒開新檔）。
- 需求追溯：[ADR 0129](0129-drawing-interaction-roadmap.md) 的 D-I6（輔助／斷裂／裁剪視圖）。D-I6 第一部分的斷裂視圖見 [ADR 0151](0151-drawing-break-view.md)。藍圖 `docs/blueprint.md` C16.3；規格 `docs/drawing-interaction-gap-plan.md`（輔助／斷裂／裁剪三節）與 `docs/decisions-2026-10-18.html`:165「裁剪視圖（partial section，需要局部剖视作為父視圖）」。使用者 2026-10-19 決定：三種全做、逐一提交。本 ADR 只涵蓋**裁剪視圖**；輔助視圖接續實作，另立 ADR。

## 背景

一張圖上的某一小區（例如一個局部剖視圖所剖出的溝槽）常需要單獨放出來看，或標上更多尺寸。業界做法（SolidWorks 的 cropped view）是把該區**之外**的部分略去，只留框住的那一塊，畫成一張自己的視圖。規格把母視圖限定為**局部剖視圖**：裁剪的用意是「把剖切範圍另外放一張」，而不是去裁一張完整的視圖。

## 決定

1. **新的視圖種類 `crop`**。先把局部剖視圖既有的輪廓型別抽出來共用（矩形／圓／封閉多邊形）：

   ```ts
   export type ClosedOutline =
     | { kind: 'rectangle'; p0: [number, number]; p1: [number, number] }
     | { kind: 'circle'; centre: [number, number]; radius: number }
     | { kind: 'polygon'; points: [number, number][] };

   export interface CropDrawingView extends ViewCommon {
     kind: 'crop';
     parent: Id;
     outline: ClosedOutline; // 母視圖自己的座標，full size
   }
   ```

2. **母視圖必須是局部剖視圖（紅隊防呆）**：`checkView` 的 `crop` 分支要求 `parent` 的種類是 `sectionLocal`，否則在命令層立即拋出 `drawing.cropNeedsLocalSection`（母視圖根本不存在則由既有的 `drawing.noParent` 先攔截）。輪廓驗證與局部剖視共用抽出的 `checkOutline(outline, 'drawing.badOutline')`（封閉、不自相交、半徑為正、多邊形兩段不得重疊）。違反者一律**顯式拋錯**，不默默夾取（AGENTS.md §2.1）。

3. **不切任何東西**：`layout.ts` 的 `resolveLines` 新增 `crop` 分支，把**母視圖已解析的線**（`visible`／`hidden`／`cut`／`center`／`tangent`）以新的 `clipToOutline`（`geometry.ts`：圓用既有的 `clipToCircle`，矩形／多邊形在邊的交點切開、以中點判內外）裁到輪廓內，`box` 取 `outlineBox(輪廓)`。因此**視圖大小＝輪廓大小**，與母視圖多大無關；母視圖的剖切面帶過來，所以裁剪視圖內照樣畫**剖面線**，與母視圖一致。

4. **比例沿用母視圖、擺放與母視圖對齊**：`scaleOf` 加入 `crop` 分支（與 `projected`／`section` 同一條規則：自己沒設比例就往上找母視圖）。擺放走既有的「衍生視圖在母視圖某一側向外堆疊」機制（`sideOf` 對 crop 回 `'right'`，`spot` 走與 `section` 相同的「模型原點對齊」分支），**不是** detail 那種「與母視圖齊平」的規則。

5. **不塗彩（明確限制，非默默降級）**：`viewImage` 對 `crop` 回 `null`，且 `resolveLines` 也不把母視圖的 `shade` 帶過來。理由與 [ADR 0151](0151-drawing-break-view.md) 決定 6 相同：`SceneImage` 只有一個**圓形**裁切欄位，無法沿輪廓把一張整零件的圖切開，硬貼會得到錯誤的圖。寧可不畫，不畫錯。

6. **繪製**（`scene.ts`）：`cropItems` 在**母視圖上**把輪廓畫成細的封閉折線（`outlinePoints`），指出裁剪視圖看的是哪一塊；裁剪視圖本身不加任何記號或字母。局部剖視圖的輪廓繪製改為共用 `outlinePoints`（原先自行展開），兩者從此同源。

7. **介面**（`apps/web`）：工具列的局部剖視圖鈕旁新增「裁剪視圖」鈕（`drawingUi.toolCrop`）。操作：在**局部剖視圖**上拖曳出一個矩形 → 移動游標預覽 → 點一下放置（`Drag`／`DrawPlacement` 各加 `crop` 分支，`addCrop` 執行 `insertViews`）。拖曳時若游標下的視圖不是局部剖視圖，立刻提示（`drawingUi.hint.cropParent`）；`makeDrawPlacement` 的 crop 分支再擋一次；命令層的 `checkView` 是最終防線（UI 只是提早告知，不取代驗證）。

8. **Schema 22 → 23**（`drawingMigrations[22]` 空轉，舊程式拒開新檔）；三處版本斷言測試（`drawing-break-view`／`drawing-local-section`／`drawing-linked`）同步更新為 23。

## 驗收

| 標準 | 結果 |
|---|---|
| 裁剪視圖可插入，並保留母視圖與輪廓（矩形／圓／封閉多邊形三種輪廓皆可） | `drawing-crop-view.test.ts`：插入後 `kind="crop"`、`parent`、`outline` 皆如所設；圓與多邊形輪廓亦通過 |
| **母視圖必須是局部剖視圖（紅隊）** | 同一測試：母視圖為 model、為一般 section、為不存在者，三類皆拋顯式錯誤（前兩者 `cropNeedsLocalSection`，後者 `noParent`） |
| 輪廓非法當場拒絕 | 同一測試：缺輪廓、未封閉多邊形（首尾不相接）、圓半徑 0 皆拋錯 |
| 不屬於 crop 的欄位被拒 | 同一測試：`setView` 帶 `line` 拋「不屬於」 |
| 線被裁到輪廓內、外框＝輪廓（不隨母視圖大小） | 同一測試：母視圖 y=5 的線原為 0…40，裁成 0…20；`box` 為 (0,0)-(20,20)（母視圖寬 40）；母視圖的兩個剖切面帶過來（`cut` 長度 2） |
| 比例沿用母視圖 | 同一測試：母視圖 1:2、輪廓 20×20 → 圖上為 10×10，且小於 40 寬的母視圖 |
| 不塗彩，且不是「線本身沒有圖」使然 | 同一測試：母視圖的 `shade` 不會帶到 crop；**同一組線**在 `display: 'shaded'` 的 section 上 `viewImage` 有值，在 crop 上為 `null`（對照組證明 null 是 crop 造成的） |
| 剖面線照畫、輪廓畫在母視圖上 | 同一測試：帶入剖切面後 `viewItems` 條數增加；`buildScene` 中「細封閉折線」比不含裁剪視圖的對照組多 1 條（輪廓） |
| 存檔讀回與舊檔升級 | 同一測試：`parseDrawing(serializeDrawing(doc))` 保留 crop；把版本改成 22 的檔讀入後為 23 且內容完整（走 `drawingMigrations[22]`） |
| typecheck 0、lint 全過、全量 vitest 0 失敗 | typecheck 0；`lint:rules`／`lint:deps`／`lint:i18n` 全過；**234 檔通過、2958 過、25 略過、0 失敗**（本項 16/16；`tests/phase5` 491 過、1 略過） |
| `verify:ui` | **未執行**（本機 `verify:ui` 超過 25 分鐘逾時，與 B2.6／ADR 0151 相同；裁剪的介面操作未經瀏覽器驗證，列為後續） |

## 已知限制

- 裁剪視圖不塗彩（見決定 5）。
- 母視圖**只能是局部剖視圖**（不能裁一般視圖或一般剖視圖）。若日後要放寬，須改 `checkView` 的 crop 分支，並重新定義「裁一般視圖」的輪廓從何而來——規格目前不要求。
- 裁剪視圖不能再被裁剪，也不能作為其他衍生視圖的母視圖（`belongs[ 'crop' ]` 只有 `outline`；衍生鏈僅到局部剖視圖）。
- 介面目前只提供**矩形**拖曳；圓與多邊形的輪廓在模型層與繪製層已支援，尚未接到工具列。
- 裁剪視圖沒有自己的標題字母（不像局部剖視圖的「A–A」），僅以視圖名稱標示於視圖下方。
