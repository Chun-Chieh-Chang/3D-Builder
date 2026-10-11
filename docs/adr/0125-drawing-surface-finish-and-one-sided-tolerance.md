# ADR 0125：工程圖表面粗糙度標註與單向極限公差（工程圖 Schema 9 → 10）

- 狀態：**已完成**。
- 需求追溯：`docs/blueprint.md` **C16.5**（註記——「表面加工符號」，ISO 1302）與 **C16.4**（工程圖尺寸——「尺寸公差」）。

## 背景

以 `scratch/drawing-feasibility-2026-10-11.md` 之工程圖評估為依據，該圖上出現兩項本專案原本不支援的標註：

1. **表面粗糙度符號**（如 `Ra 1.6`、`Ra 3.2`，ISO 1302）：本專案完全沒有此標註型別，工程圖只能畫尺寸、表格與零件號球。
2. **單向極限公差**（如 `10 MAX`、`10 MIN`）：`DimensionTolerance` 原僅有 `bilateral`（對稱／不對稱雙向）與 `fit`（配合等級），無法表達「只給單邊極限」的標法。

## 決定

1. **工程圖 Schema 版本由 9 升至 10**，遷移 `9: (doc) => ({ ...doc, surfaceFinishes: doc.surfaceFinishes ?? [] })`。舊檔照常開啟（缺欄位補空陣列）。
2. **新增 `SurfaceFinish`**（`packages/model/src/drawing.ts`，C16.5／ISO 1302）：
   `view: Id`、`at: [number, number]`（符號 V 的尖端，視圖全尺寸座標）、`angle?`（背離表面的方向，預設 90°）、`kind?: 'basic' | 'machined' | 'unmachined'`（預設 `machined`）、`ra?: number`（算術平均粗糙度，µm）、`method?`（加工方法，寫在橫槓上）、`note?`（寫在橫槓下，例如 Ra 範圍或熱處理）、`leader?`（引線長度）。
   - `RA_MIN = 0.008`、`RA_MAX = 400`（ISO 1302 的數列範圍）；`kind` 必須在 `SURFACE_FINISH_KINDS` 內，`ra` 必須有限且落在範圍內，否則拋出 `drawing.badFinishKind`／`drawing.badRa` 並說明可接受範圍。
3. **`DrawingDoc.surfaceFinishes: SurfaceFinish[]`** 為一等欄位（與 `views`／`dimensions`／`tables` 並列），並納入 `drawingIdsInUse`（刪除視圖時連帶清除其上之符號、ID 計數器同步）。
4. **三條指令**：`insertSurfaceFinishes`、`setSurfaceFinish`（`SurfaceFinishPatch`，`null` 表示把欄位拿掉、回到預設）、`deleteSurfaceFinishes`。
5. **新增繪製模組 `packages/drawing/src/surfaceFinish.ts`**：依 ISO 1302 繪製 60° V 符號、橫槓、引線與文字；`layout.ts`（`fromSheet`）與 `scene.ts` 納入版面與場景，`DrawingViewport.tsx` 負責命中測試與選取，`AnnotationPanel.tsx` 提供編輯面板。
6. **`DimensionTolerance` 新增 `{ type: 'max' }` 與 `{ type: 'min' }`**（C16.4）：表達「標稱值即為最大／最小允許值」。`toleranceText` 對二者分別輸出 i18n 字串 `drawing.tolMax`／`drawing.tolMin`（「MAX」／「MIN」）。
   - **角度標註的度符號**：單向極限的寫法是「數字 + 文字」，不像雙向公差那樣緊接數值，故 `toleranceText` 於單向極限時抑制尾隨的 `°`，避免產生 `10° MAX` 這種把文字讀成角度單位的錯誤寫法。
7. **`DimensionPanel.tsx`** 提供雙向／配合／MAX／MIN 四種公差模式的切換與輸入。
8. **i18n**：`drawing.tolMax`／`drawing.tolMin`／`drawing.badFinishKind`／`drawing.badRa`／`drawing.noSurfaceFinish` 等鍵，中英（`zh-TW`／`en`）對齊。

## 驗收成果

- `tests/phase5/drawing-surface-finish.test.ts`：**10/10 PASS**——符號與 Ra 的指令往返、`ra` 與 `kind` 的範圍拒絕、刪除視圖時連帶清除、`drawingIdsInUse` 一致性、版面配置與場景產生。
- `tests/phase5/drawing-dimensions.test.ts`／`drawing-document.test.ts`：MAX／MIN 公差文字輸出與既有雙向／配合公差之迴歸維持全綠。

