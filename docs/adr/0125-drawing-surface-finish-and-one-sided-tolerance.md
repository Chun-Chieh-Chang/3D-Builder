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

## 補記：B3a 端到端驗證發現的圓角半徑缺口（2026-10-11）

決策頁 **B3a「兩件各出一張圖」** 的建議理由之一，是「順手把 Ra 標註與 MAX／MIN 公差這兩個缺口做掉端到端驗證」。實際把工件 2（凸緣襯套）出圖時，端到端路徑暴露了一個**兩個缺口都沒預期到的真缺陷**：

### 症狀

工件 2 的兩處孔口圓角（`R0.2`、`R0.5`）以 `kind: 'radius'` + `tolerance: { type: 'max' }` 標註時，`buildScene` 回傳：

```
ERROR 這個元素沒有半徑，不能標直徑或半徑
ERROR 這個元素沒有半徑，不能標直徑或半徑
```

### 根因（實測，非推測）

1. `packages/regen/src/drawingDimensions.ts` 的 `elementFacts` 只認 `plane`、`cylinder`、`sphere` 三種面；圓角面在 OCCT 是 **torus**，落到最後的 `return { error: t('drawing.refKind', …) }`。
2. 但核心層**早就有**這份資料：`packages/kernel/src/kernel.ts` 對 torus 面建出 `{ type: 'torus', center, axis, major, minor, convex }`，型別亦已在 `packages/kernel/src/types.ts` 宣告。也就是說這是**消費端漏接**，不是核心缺料。
3. 補上之後還有第二層問題：`circle()` 的「真形」判準是為圓柱寫的——**軸沿視線方向**才是真圓。圓角恰恰相反：**軸躺在圖面內**（管被剖開，剖面才是那段圓弧）；順著軸看只是一個環，沒有弧可量。此外半徑引線的箭頭必須落在弧心（距軸 `major`）而非圓環中心，否則箭頭會指進孔裡。

### 修正

1. `packages/model/src/drawing.ts`：`ElementFacts` 新增選用欄位 `major?`（管中心圓半徑），並把 `type` 的註解補上 `"torus"`。
2. `packages/regen/src/drawingDimensions.ts`：`elementFacts` 新增 `torus` 分支 → `{ kind: 'face', type: 'torus', point: g.center, dir: g.axis, radius: g.minor, major: g.major }`。
3. `packages/drawing/src/dimension.ts`：新增 `circleCentre()`，把「圓心在視圖座標何處」抽出來：
   - 圓柱／球／邊：維持原判準（軸沿視線）與原圓心。
   - torus：判準反轉（`|dir·axes.dir| ≤ PERPENDICULAR`，軸躺在圖面內）；弧心取 `at ± major × across`，方向由引線傾斜方向 `u` 對「軸的橫向」投影之正負決定。
   - **退化情形明確拒絕**：引線若正好沿軸（`|lean| < 1e-9`），兩個弧一樣近，不猜——回 `drawing.dimNotTrueShape`。
4. `tests/phase5/drawing-dimensions.test.ts` 新增 3 個測試（`R0.2 最大` 文字與弧心／箭頭座標逐點驗算、順軸視圖拒絕、引線沿軸拒絕、另一橫軸視圖的弧心落點）。

### 一併確認（非新缺口）

- 工件 2 出圖實測圖面文字：`0.75、8、R0.2 最大、R0.5 最大、Ø3.97、Ø4.247、Ø6.25、Ø7.73`，`errors` 為空。MAX 單向極限確實端到端成立。
- 工件 1 的 `Ra 0.8` 與壓花註記 `壓花 20±0.1` 都在**場景**（`Scene.items` 的 text）中，不在尺寸文字集合裡——原本的驗收斷言取錯了集合，已更正。
- **觀察（未變更設計）**：`toleranceText` 走 i18n，因此 zh-TW 介面出圖會寫「最大」，英文介面寫「MAX」。原圖寫的是 `MAX`。若將來要出給英語系現場，需要「圖面語言」獨立於介面的機制，目前**沒有**這個欄位。
