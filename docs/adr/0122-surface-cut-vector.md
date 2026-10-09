# ADR 0122：以曲面除料的方向向量與保留側（C9.4，零件 Schema 51 → 52）

- 狀態：**已實作；等待完整驗證**。

## 決定

1. `CutWithSurfaceFeature.direction` 保留既有 `Ref` 格式，新增 `{ kind: 'vector', value: [x,y,z] }` 固定世界 XYZ 方向。舊檔的 Ref 仍照原平面法向解讀；51 → 52 為空轉遷移。
2. 向量每個分量須為有限數值且總長非零；kernel 以方向使用並自行正規化，數值大小不改變掃掠距離。
3. `keep` 可為 `behind` 或 `ahead`，預設 `behind`，對舊文件維持既有差集結果。`reverse` 先反轉方向，再由 `keep` 決定使用差集或交集，因此 `(+v, behind)` 與 `(-v, ahead)` 保留同一側。
4. 重用 `Kernel.surfaceTool` 和既有 `boolBodies` 命名流程；不新增局部法向或沿曲面變方向的掃掠。
5. PropertyManager 保留基準面／平面與反轉操作，新增固定 XYZ 分量及保留側控制。

## 驗證

`tests/phase4b/thicken-cut.test.ts` 覆蓋舊方向行為、向量尺度、斜向量、前後保留、反轉等價、零與非有限輸入、keep 參數和有效輸出。UI 瀏覽器檢查尚待完成。
