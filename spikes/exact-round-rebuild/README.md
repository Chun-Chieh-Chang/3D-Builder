# 精確圓角重建時拋例外（待辦 #3，2026-11-27）

rolling-ball fuzz 的 seed 73、52：辨識後重建時，精確圓角被拒絕，只好保留 OCCT 的圓角。

## 檔案

| 檔案 | 用途 |
|---|---|
| `repro.test.ts` | 照 fuzz 的做法建件、經 STEP 辨識，寫出原件與重建的 `exactRoundLog`（`SEEDS=73,52`） |
| `locate.test.ts` | 把 `kernel.oc` 包一層 Proxy：哪個 OCCT 建構子或靜態函式拋例外，就記下名稱與當下的 JS 堆疊 |
| `vitest.mts` | `npx vitest run --config spikes/exact-round-rebuild/vitest.mts <檔名>` |
| `data/` | 輸出 |

## 結果

- **seed 52**：ADR 0265 的切開路徑上線後，重建已是精確圓角（體積誤差 1.6e-13），不再是缺口，只是待辦沒同步。
- **seed 73**：重建的 `exactify` 拋 `Standard_ConstructionError`，位置在 `exactRound.ts` 的 `new BRepAdaptor_Curve2d(ed, mf)`。
  - 前一段把與圓角相接的邊上的頂點移到新位置（最大 0.047 mm），再把它投影回邊的曲線取參數。
  - `GeomAPI_ProjectPointOnCurve` 只回傳垂足；頂點落在曲線端點之外時，最近點是端點，它卻回傳了曲線另一處的垂足，距離 15.6 mm（參數 42.62，邊的範圍 29.25–39.19）。
  - 範圍因此變成起點大於終點，建 2D 曲線轉接器時被拒。
- **修正**：垂足只在比「從較近端點找的最近點」更近時才採用。seed 73 重建改為精確圓角，讀回體積誤差 9.9e-13（原為 2.8e-8）。
- 另把 `exactRoundLog` 的 `threw` 改記 OCCT 的例外型別與訊息（原本只記 `[object WebAssembly.Exception]`）。
