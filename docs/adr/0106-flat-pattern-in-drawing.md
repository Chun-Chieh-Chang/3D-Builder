# ADR 0106：工程圖的展平圖（S-1，工程圖 Schema 6）

- 狀態：**已實作並驗證（2026-10-07）**。計畫：[sheet-metal-drawing-plan](../sheet-metal-drawing-plan.md)。
- 工程圖 Schema 5 → **6**（遷移是空的：多一個視圖方向 `flat`）。

## 決定與做法

1. 模型視圖的方向多 `flat`（`ViewName`、`VIEW_NAMES`、`viewVectors`＝前視的座標、版面與等角視相同放在一旁）；視圖清單、新增視圖與方向下拉都用既有的介面，名稱「展平圖」。
2. **線的來源**：`DrawingViewRequest.flat` → worker 對請求的第一個零件取重算結果的 `sheet`，`flatPattern(kernel, sheet)`（ADR 0088），`flatViewLines(report)`（`packages/drawing/src/flatView.ts`）轉成 `ViewLines`：外形的線、孔與圓角的折線（圓每 5°、弧每 5° 一點，圓閉合）、**折彎線在 `center`**（新的選用欄位；`viewItems` 畫成 `center` 樣式，DXF 在 CENTER 圖層），`box` 的左下角在原點；平板型式的實體用完就釋放。
3. 展平圖沒有可標註的特徵（`requestOf` 不給 `featureId`，所以不問 worker 要特徵）；投影與剖面視圖以展平圖為母視圖時拒絕（`drawing.flatNoDerived`），細部放大可以。
4. 不是鈑金件、或平板型式做不出來時，視圖的原因就是 worker 丟出的訊息（「這個零件不是鈑金件（沒有基材凸緣）」等）。

## 驗證

- `tests/phase7/flat-view.test.ts`（6 項，手算）：平板 100 × 50 四條邊、盒 (0,0)–(100,50)、沒有折彎線；加 90° 長 30 的凸緣 → 盒 127.31969 × 50、四條邊、一條折彎線在 x = 96.5 + BA/2、y 從 0 到 50；Ø5 的孔是閉合折線、重心 (40, 20)、各點到圓心 2.5；文件接受 `direction: 'flat'`（Schema 6）；場景有 4 條 visible 與 1 條 center；DXF 讀回通過檢查、CENTER 圖層有 1 條。
- 瀏覽器（`tests/e2e/phase5-flat-view.js`，固定檔 `tests/fixtures/parts/bracket.3dbx`）：支架加展平圖：3 條折彎線、外框 157.320 × 83.507、場景裡折彎線是鏈線、投影被拒；定位板（非鈑金件）加展平圖：視圖寫「這個零件不是鈑金件」。

## 限制

- 展平圖還不能標註尺寸、沒有折彎表與折彎註記（平板型式視窗與 DXF 有）；
- 折過的基材上有凸緣時平板型式做不出來（ADR 0088 的限制），展平圖同樣。
- 折彎線全部畫成鏈線，不分往上或往下（折彎表的內容沒有進圖）。
