# ADR 0123：真實螺牙特徵資料結構與再生管道（零件 Schema 52 → 53）

- 狀態：**已實作；等待完整驗證**。

## 決定

1. 零件 Schema 版本由 52 升至 53，為空轉向前相容遷移（`52: (doc) => doc`）。舊檔照常開啟，不受任何影響。
2. 新增 `ThreadFeature`，繼承 `FeatureBase`，包含草圖（`sketch: Id`）、軸線（`axis: Ref`）、運算方式（`op: 'boss' | 'cut'`，相容 `operation`）、螺距（`pitch: Expr`）、線數（`starts: Expr`，預設 1）、旋向（`hand: 'right' | 'left'`）、長度（`length: Expr`）、錐度半角（`taper?: Expr`）、起始角偏移（`phase?: Expr`）與反向（`reverse?: boolean`）。
3. 軸線以 `Ref` 格式引用圓柱面／錐面／圓環面（取其旋轉軸）、直線邊、或基準軸，由再生引擎之 `axisOfRef` 自動解析並於模型變更時自動追蹤。
4. 牙型草圖必須畫在通過螺牙軸的平面上。螺牙軸向起始位置由草圖牙型輪廓之中心位置決定，並由 `length` 與 `reverse` 決定終止截面。兩端平切（第一版約定）。
5. 核心調用 `Kernel.thread` 產出工具實體，由 `this.apply` 進行布林切除或結合，面命名遵循 `@3db/naming` 的 `profileEdge` 螺旋面名（`side:<sketchId>.<edge>@helix<start>:<turn>`）與兩端 `cap`。
6. 接線涵蓋 `schema.ts`、`commands.ts`（`setThread` 指令與建立驗證）、`params.ts`（運算式與全域變數驅動）、`refs.ts`（參考重寫）、`visibility.ts`（牙型草圖用後預設隱藏）、`patterns.ts`（可作為複製排列種子）、`serialize.ts`（版本升級遷移）、`regen/dag.ts`（父子關係依賴圖）與 `regen/engine.ts`（特徵再生）。

## 驗證

- T-1 核心驗證已全數通過（`tests/phase3/thread.test.ts`）：包含體積誤差 < 1e-6、探測驗證、STEP 匯出匯入、網格封閉性、邊界倒角與階梯面布林風險驗證。
- T-2 特徵級再生與持久命名驗收測試於 `tests/phase3/thread-feature.test.ts` 驗證。
