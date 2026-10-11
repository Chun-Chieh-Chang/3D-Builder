# ADR 0123：真實螺牙特徵資料結構與再生管道（零件 Schema 52 → 53）

- 狀態：**已完成（經過 Claude Code 嚴格審查與全面修復确效）**。

## 決定

1. 零件 Schema 版本由 52 升至 53，為空轉向前相容遷移（`52: (doc) => doc`）。舊檔照常開啟，不受任何影響。
2. 新增 `ThreadFeature`，繼承 `FeatureBase`，包含草圖（`sketch: Id`）、軸線（`axis: Id | Ref`，支援草圖中心線 ID 或實體面／邊／基準軸）、運算方式（`op: 'boss' | 'cut'`，相容 `operation`）、螺距（`pitch: Expr`）、線數（`starts: Expr`，預設 1）、旋向（`hand: 'right' | 'left'`）、長度（`length: Expr`）、錐度半角（`taper?: Expr`）、起始角偏移（`phase?: Expr`）與反向（`reverse?: boolean`）。
3. 軸線支援：
   - 引用草圖中心線 ID（`typeof axis === 'string'`），由草圖解算二維幾何投影至三維空間座標軸，如同旋轉特徵做法。
   - 引用圓柱面／錐面／圓環面（取其旋轉軸）、直線邊、或基準軸（`typeof axis === 'object'`），由再生引擎之 `axisOfRef` 自動解析並於模型變更時自動追蹤。
4. 牙型草圖必須畫在通過螺牙軸的平面上。螺牙軸向起始位置由草圖牙型輪廓之中心位置決定，並由 `length` 與 `reverse` 決定終止截面。兩端平切（第一版約定）。
5. 線數校驗：線數必須為正整數（1 至 16）。非整數（如 1.5）直接拒絕並說明原因（`feature.threadBadStarts`），禁止默默取整四捨五入。
6. 多線重疊防禦與消除崩潰：牙型沿軸向寬度若大於等於單線螺距（`zMax - zMin >= pitch`），相鄰牙在空間中會互相重疊。此類幾何物理上自相交，且過往透過 `BRepAlgoAPI_Fuse` 融合重疊螺旋體每次消耗 100~250 MB 堆記憶體且不釋放，易造成 WASM 記憶體越界崩潰。核心嚴格限制 `zMax - zMin < pitch`，超出時明確拒絕（`feature.threadProfileTooWide`）；多線各 start 彼此不接觸，直接組裝為 `TopoDS_Compound`，彻底杜絕記憶體外溢與崩潰。
7. 面命名遵循 `@3db/naming` 的 `profileEdge` 螺旋面名（`side:<sketchId>.<edge>@helix<start>:<turn>`）與兩端 `cap`。
8. 接線涵蓋 `schema.ts`、`commands.ts`（`setThread` 指令與建立驗證）、`params.ts`（運算式與全域變數驅動）、`refs.ts`（參考重寫）、`visibility.ts`（牙型草圖用後預設隱藏）、`patterns.ts`（可作為複製排列種子）、`serialize.ts`（版本升級遷移）、`regen/dag.ts`（父子關係依賴圖）、`regen/engine.ts`（特徵再生）與 `apps/web` PropertyManager 面板。

## 待使用者決定事項（由 T-1 繼承恢復）

1. **質量特性積分精度**：產品的質量特性要不要全面改用精確自適應積分（`massProps` 預設 `eps: 1e-6`；22 個呼叫處；平面零件 0.6 → 2.5 ms，螺牙零件 49 → 52 ms）。目前只有顯式傳入 `eps` 才使用，一般顯示的質量特性對長 B-spline 螺牙零件約有 1e-4 數值誤差。
2. **`moveFace` 記憶體洩漏疑點**：`kernel.ts` 約 1390 行（`moveFace` 附近）亦存在每點新建 `BRepClass3d_SolidClassifier` 的情況，是否比照 `Kernel.classify` 批次分類器重構，待在複雜曲面情境下專門驗證。
3. **效能計時測試門檻與環境變數處理**：`check:perf` 與計時門檻在全套平行跑時因 CPU 負載可能出現波動，是否將計時測試抽離為獨立單元跑測檔，或以環境變數專用門檻控管，待使用者定奪。

## 審查發現與矯正確效（CAPA）

- **T-1 核心幾何驗證**（`tests/phase3/thread.test.ts`，24/24 PASS）：
  體積解析積分比對誤差 < 1e-6、多線不重疊 compound 組合、探測驗證（左右旋、多線相位、錐度、牙側角）、STEP 匯出匯入往返一致、STL 網格封閉無孔洞、入口倒角與階梯面布林風險驗證。
- **T-2 特徵再生與持久命名**（`tests/phase3/thread-feature.test.ts`，7/7 PASS）：
  特徵除料/結合、草圖中心線作為軸線支援、運算式與全域變數驅動、遺失參考安全報錯、螺旋面持久命名映射。
- **T-3 介面與說明**（`tests/phase3/thread-ui.test.ts` 4/4 PASS、`tests/e2e/manual-thread.js` 1/1 PASS, 11.1s）：
  `ThreadPanel` 支援完整參數控制項，下拉選單相容草圖中心線與基準軸，動作列掛載特徵按鈕，說明主題與中英 i18n 對齊。
- **T-4 ISO 80369-7 參考件與工程圖**（`tests/phase3/iso-80369-7-thread.test.ts`，7/7 PASS）：
  1. 公錐體：真實 6.00% 錐度（$(4.315 - 4.021) / (5.65 - 0.75) = 0.060$），頂端 $y=7.5$（$r=1.9880$）、底端 $y=0$（$r=2.2130$），頂端外緣實作真實 0.2 mm 圓角特徵（`fl_tip`）。
  2. 鎖緊環：內螺紋從入口 $y=8.0$ 切入至 $y=1.0$ 退刀槽，切入入口倒角；探針容差收緊至 $\le 0.005$ mm（實測 $\pm 0.003$ mm 通過）；以實體探針直接量測 3D 實體齒形牙側角（30.000°）。
  3. 工程圖：剖面視圖呈現鋸齒齒形；標註元素 100% 透過 `elementFacts` 從實際實體動態解析（無 mock 假資料）；對稱（±0.025）、單向（0/-0.005）、不對稱（+0.001/-0.004）極限公差 DXF/PDF 輸出驗證全過。
- **T-5 鞏固與收尾**（`tests/phase3/thread-fuzz.test.ts`，5/5 PASS）：
  1. 擴大布林集成：螺牙切除後續打穿橫向孔（採用草圖中心線為軸）及外圓柱倒角結合，實體保持 manifold 有效。
  2. 效能基準：M3 × 0.5 mm 細牙 30 圈再生實測 2.2 秒（滿足 ≤ 5 秒預算上限）。
  3. 隨機幾何測試 (Fuzz Testing)：200 組隨機參數（線數 1~4、螺距、錐度、相位、長度、牙型寬高）全數執行完成，0 崩潰、0 核心異常，合法幾何生成有效實體，極端自相交幾何精準防禦性攔截。
