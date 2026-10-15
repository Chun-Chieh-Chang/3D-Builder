# ADR 0142：任意角度的剖面線（D-I5 第一部分）

- 狀態：**已完成（2026-10-15）**。**工程圖 Schema 16 → 17**（遷移空轉，舊程式拒開新檔）。
- 需求追溯：[ADR 0129](0129-drawing-interaction-roadmap.md) 的 D-I5（使用者決定 Q9：剖面線要「任意角度＋階梯剖面＋對正剖面」）；計畫書 [drawing-interaction-gap-plan.md](../drawing-interaction-gap-plan.md) §D-I5；使用者 2026-10-15 確認第一部分的驗收標準。
- 範圍：本 ADR 只做**任意角度**。階梯剖面與對正剖面見 [ADR 0143](0143-drawing-stepped-aligned-section.md)。

## 背景

[ADR 0061](0061-derived-drawing-views.md) 規定剖面線只能水平或垂直（`drawing.sectionAxisOnly`），[ADR 0131](0131-drawing-views-by-pointer.md) 的指標放置也只畫水平和垂直線。夾治具板常要剖過斜排或錯開的孔，SolidWorks 的輔助剖面線可以是任意角度。

## 決定

1. **模型層**（`packages/model/src/drawing.ts`）：
   - `checkView` 不再拒絕斜線；端點重合仍拒絕（`drawing.badSectionLine`）。i18n 鍵 `drawing.sectionAxisOnly` 刪除。
   - `sectionDirection(v)`：剖面線箭頭在母視圖上的單位方向（從第一點走向第二點的右手邊，`flip` 取左手邊）。`sectionArrow` 改由它取最接近的軸，用途不變（放在母視圖哪一側、第一角／第三角）。
   - `sectionLookAxes(parent, v)`：剖面視圖的看法。水平或垂直的線與原本的 `sectionAxes` **完全相同**（直接呼叫它，既有圖面不變）。斜線：沿箭頭方向看（在母視圖平面內，與母視圖的視向垂直）；箭頭比較接近上下時，視圖的「上」是母視圖的視向（與 `up`／`down` 的規則相同）；比較接近左右時，視圖的「上」是圖紙的上方轉同樣的角度（與 `right`／`left` 的規則相同）。四個軸向的情況在各自那一側連續。
   - `sectionPlane`、`axesOf` 改用 `sectionLookAxes`：切平面通過剖面線、與母視圖的視向平行、法向朝觀看者。
2. **Schema 16 → 17**：`parseDrawing` 不檢查視圖，舊程式會把斜剖面當成最接近的軸向剖面，**默默畫錯方向**。比照 v5、v7、v13 的慣例升版，讓舊程式拒開。
3. **核心**（`Kernel.sectionView`）：切割後若整個零件都在觀看者那一側（被切光），以前 HLR 會丟出「`Bnd_Box is void`」；現在回傳空的視圖與空的 `cut`。
4. **沒切到零件要明說**：`sectionMissed(lines)`（`packages/drawing`）＝有 `cut` 但為空。工程圖狀態把它列為該視圖的問題「剖面 A 的剖面線沒有切到零件：移動剖面線使它穿過零件」，不畫成一個空的剖面。
5. **介面**（`DrawingViewport.tsx`）：剖面工具的第三個選項「斜向剖面線」（`data-action="sectionSlant"`，工具狀態 `slant: true`）。在視圖上**拖曳**決定方向，或**點兩下**（線上一點、方向點）；`lineAcrossBox` 把線延伸穿過整個視圖（外框再放 5 mm，與水平／垂直線相同）。拖曳中畫虛線預覽（`data-slant-preview`）。放置：線比較接近垂直時放在母視圖左右，否則上下；Ctrl 放在任意位置。
6. **預覽**：`linesForAxes` 原本只能把調色盤的標準視圖轉 90° 倍數；斜方向沒有對應的標準視圖，改為第一次用到時向 worker 要這個方向的投影並快取，回來後重畫預覽。

## 驗收（使用者確認的標準）

| 標準 | 結果 |
|---|---|
| 30° 斜剖面的切面面積與解析值相對誤差 < 1e-3 | `drawing-slanted-section.test.ts`：40×30×12 方塊，對角線 600、30° 為 40/cos30°×12，以切面外框鏈成封閉迴圈後的鞋帶公式計算（不是剖面線填充估算） |
| 至少 100 組隨機角度，0 崩潰 | 同檔：固定種子 100 條隨機斜線（離軸向至少 2°），每條面積＝線在 40×30 面內的長度 ×12，誤差 < 1e-3 |
| 剖面線沒切到零件時明確提示 | 核心不再丟例外；`sectionMissed`；e2e 步驟 4 在真實 worker 下顯示「沒有切到零件」 |
| 反向對照 | 把 `sectionPlane` 改回最接近軸向的舊平面：對角線、30°、隨機 100 條 3 項測試失敗；還原後通過 |
| typecheck 0、lint 全過、全量 vitest 0 失敗 | 2782 過、24 略過、0 失敗 |
| 一支新的 `verify:ui` 腳本 PASS | `manual-drawing-slanted-section.js` 5/5；另重跑工程圖與剖面相關 7 支，全過 |

## 已知限制

- 階梯剖面、對正剖面：已由 [ADR 0143](0143-drawing-stepped-aligned-section.md) 完成。
- 剖面預覽仍是沒切開的零件外形（ADR 0131 的既有限制）。
- 拖曳既有的斜剖面線時，沿 x 或 y 平移（與軸向線相同的拖曳方式），不是沿法向。
- 「依數值」新增剖面（側邊欄）仍只有水平和垂直，沒有角度欄位。
- 斜線不會吸附到孔中心或邊（水平／垂直線的 `snapCut` 吸附不適用於斜線）。
