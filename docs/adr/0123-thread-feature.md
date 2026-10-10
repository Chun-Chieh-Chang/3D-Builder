# ADR 0123：真實螺牙特徵資料結構與再生管道（零件 Schema 52 → 53）

- 狀態：**已完成（T-1 至 T-5 全部通過）**。

## 決定

1. 零件 Schema 版本由 52 升至 53，為空轉向前相容遷移（`52: (doc) => doc`）。舊檔照常開啟，不受任何影響。
2. 新增 `ThreadFeature`，繼承 `FeatureBase`，包含草圖（`sketch: Id`）、軸線（`axis: Ref`）、運算方式（`op: 'boss' | 'cut'`，相容 `operation`）、螺距（`pitch: Expr`）、線數（`starts: Expr`，預設 1）、旋向（`hand: 'right' | 'left'`）、長度（`length: Expr`）、錐度半角（`taper?: Expr`）、起始角偏移（`phase?: Expr`）與反向（`reverse?: boolean`）。
3. 軸線以 `Ref` 格式引用圓柱面／錐面／圓環面（取其旋轉軸）、直線邊、或基準軸，由再生引擎之 `axisOfRef` 自動解析並於模型變更時自動追蹤。
4. 牙型草圖必須畫在通過螺牙軸的平面上。螺牙軸向起始位置由草圖牙型輪廓之中心位置決定，並由 `length` 與 `reverse` 決定終止截面。兩端平切（第一版約定）。
5. 核心調用 `Kernel.thread` 產出工具實體，由 `this.apply` 進行布林切除或結合，面命名遵循 `@3db/naming` 的 `profileEdge` 螺旋面名（`side:<sketchId>.<edge>@helix<start>:<turn>`）與兩端 `cap`。
6. 接線涵蓋 `schema.ts`、`commands.ts`（`setThread` 指令與建立驗證）、`params.ts`（運算式與全域變數驅動）、`refs.ts`（參考重寫）、`visibility.ts`（牙型草圖用後預設隱藏）、`patterns.ts`（可作為複製排列種子）、`serialize.ts`（版本升級遷移）、`regen/dag.ts`（父子關係依賴圖）與 `regen/engine.ts`（特徵再生）。

## 驗證

- **T-1 核心幾何驗證**（`tests/phase3/thread.test.ts`）：
  體積解析積分比對誤差 < 1e-6、探測驗證（左右旋、多線相位、錐度、牙側角）、STEP 匯出匯入往返一致、STL 網格封閉無孔洞、入口倒角與階梯面布林風險驗證。
- **T-2 特徵再生與持久命名**（`tests/phase3/thread-feature.test.ts`）：
  7/7 通過，包含特徵除料/結合、運算式與全域變數驅動、遺失參考安全報錯、螺旋面持久命名映射。
- **T-3 介面與說明**（`tests/phase3/thread-ui.test.ts`、`tests/e2e/manual-thread.js`）：
  `ThreadPanel` 支援完整參數控制項，動作列掛載特徵按鈕，說明主題與中英 i18n 對齊，無頭瀏覽器 UI 實測 PASS (11s)。
- **T-4 ISO 80369-7 參考件與工程圖**（`tests/phase3/iso-80369-7-thread.test.ts`）：
  公接頭錐體（6% 錐度、Ø4.021/Ø4.315、中心孔 Ø2.0）與雙線內螺紋鎖緊環（Ø7.2/Ø8.0、螺距 2.5、導程 5.0、30° 牙側角）幾何探針 100% 吻合，同軸組合件軸向剖面呈現鋸齒截面，三類獨立極限公差 DXF/PDF 輸出無亂碼/遺漏。
- **T-5 鞏固與收尾**（`tests/phase3/thread-fuzz.test.ts`）：
  1. 擴大布林集成：螺牙切除後續打穿橫向孔（cross hole）及外緣倒角/圓角結合，實體保持 manifold 有效。
  2. 效能基準：M3 × 0.5 mm 細牙 30 圈再生耗時 2.2 秒（遠低於 5 秒預算上限）。
  3. 隨機幾何測試 (Fuzz Testing)：200 組隨機參數（線數 1~4、螺距、錐度、相位、長度、牙型寬高）全數執行完成，0 崩潰、0 核心異常，合法幾何生成有效實體，極端自相交幾何精準防禦性攔截。
