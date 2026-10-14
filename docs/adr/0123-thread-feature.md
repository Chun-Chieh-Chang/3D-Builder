# ADR 0123：真實螺牙特徵資料結構與再生管道（零件 Schema 52 → 53）

- 狀態：**已完成（經過 Claude Code 嚴格審查與全面修復确效）**。

## 決定

1. 零件 Schema 版本由 52 升至 53，為空轉向前相容遷移（`52: (doc) => doc`）。舊檔照常開啟，不受任何影響。
2. 新增 `ThreadFeature`，繼承 `FeatureBase`，包含草圖（`sketch: Id`）、軸線（`axis: Id | Ref`，支援草圖中心線 ID 或實體面／邊／基準軸）、運算方式（`op: 'boss' | 'cut'`，相容 `operation`）、螺距（`pitch: Expr`）、線數（`starts: Expr`，預設 1）、旋向（`hand: 'right' | 'left'`）、長度（`length: Expr`）、錐度半角（`taper?: Expr`）、起始角偏移（`phase?: Expr`）與反向（`reverse?: boolean`）。
3. 軸線支援：
   - 引用草圖中心線 ID（`typeof axis === 'string'`），由草圖解算二維幾何投影至三維空間座標軸，如同旋轉特徵做法。
   - 引用圓柱面／錐面／圓環面（取其旋轉軸）、直線邊、或基準軸（`typeof axis === 'object'`），由再生引擎之 `axisOfRef` 自動解析並於模型變更時自動追蹤。
4. 牙型草圖必須畫在通過螺牙軸的平面上。螺牙軸向起始位置為草圖牙型輪廓沿軸向的**前緣**（正向取 `zMin`，`reverse` 取 `zMax`；圓弧／圓以取樣求真實範圍，不以圓心代表），再由 `length` 與 `reverse` 決定終止截面。兩端平切（第一版約定）。
   - **2026-10-14 修正**：原約定以輪廓「中心」為起點，起始截面因而切在牙型正中，畫在起始端的牙型後半部不被切除，模型起始處出現殘缺的半牙，整條螺牙看似沿軸向偏移半個牙寬。改以前緣起算後，草圖所畫的牙型完整切出；`length` 自前緣量起。迴歸測試：`tests/phase3/thread-feature.test.ts`「the thread starts at the leading edge of the profile」（舊碼 3/3 失敗、新碼 3/3 通過）。
5. 線數校驗：線數必須為正整數（1 至 16）。非整數（如 1.5）直接拒絕並說明原因（`feature.threadBadStarts`），禁止默默取整四捨五入。
6. 多線重疊防禦與消除崩潰：牙型沿軸向寬度若大於等於單線螺距（`zMax - zMin >= pitch`），相鄰牙在空間中會互相重疊。此類幾何物理上自相交，且過往透過 `BRepAlgoAPI_Fuse` 融合重疊螺旋體每次消耗 100~250 MB 堆記憶體且不釋放，易造成 WASM 記憶體越界崩潰。核心嚴格限制 `zMax - zMin < pitch`，超出時明確拒絕（`feature.threadProfileTooWide`）；多線各 start 彼此不接觸，直接組裝為 `TopoDS_Compound`，彻底杜絕記憶體外溢與崩潰。
7. 面命名遵循 `@3db/naming` 的 `profileEdge` 螺旋面名（`side:<sketchId>.<edge>@helix<start>:<turn>`）與兩端 `cap`。
8. 接線涵蓋 `schema.ts`、`commands.ts`（`setThread` 指令與建立驗證）、`params.ts`（運算式與全域變數驅動）、`refs.ts`（參考重寫）、`visibility.ts`（牙型草圖用後預設隱藏）、`patterns.ts`（可作為複製排列種子）、`serialize.ts`（版本升級遷移）、`regen/dag.ts`（父子關係依賴圖）、`regen/engine.ts`（特徵再生）與 `apps/web` PropertyManager 面板。

## 待使用者決定事項（由 T-1 繼承恢復）

**2026-10-11 結案：以下三項皆已由第一波次（commit `dc84eeb` 的 A1／A2／A3）處理完畢，逐項查證如下。**

1. **質量特性積分精度** → **已解決（A1）**。
   `Kernel.massProps` 已改為 `const adaptive = options.adaptive ?? true`（`packages/kernel/src/kernel.ts:2328`），
   並於 `eps` 未指定時對含複雜曲面（自由曲面／螺牙 B-spline）的形狀自動以 `eps = 1e-6` 自適應積分
   （`kernel.ts:2329` 之 `this.hasComplexSurfaces(shape, arena)`）。
   `packages/kernel/test/kernel.test.ts` 以**真實螺牙形狀**斷言預設呼叫與顯式 `eps: 1e-6` 一致（誤差 < 1e-8），
   且與非自適應粗略積分存在 > 1e-5 的實質改善——滿足 AGENTS.md §3.2「驗收測試必須使用能實質觸發該分支的邊界對象」。
2. **`moveFace` 記憶體疑點** → **已解決（A2）**。
   原疑點的描述（「每點新建 `BRepClass3d_SolidClassifier`」）與程式碼實況不符：`moveFace` 用的是**面的**二維分類器
   `BRepClass_FaceClassifier`（`kernel.ts:1938`，位於 `insidePoint` 內），不是三維實體分類器；全檔唯一的
   `BRepClass3d_SolidClassifier` 只在 `Kernel.classify`（`kernel.ts:2446`），而它本來就是**一個分類器服務所有點**的批次形態。
   真正的缺陷是 `insidePoint` 的分類器**沒有被刪除**，現已改為 `try { … } finally { c.delete() }`（`kernel.ts:1938–1944`）。
   驗收以真實 Emscripten heap 為指標：`tests/phase3/direct-edit.test.ts` 的
   「do not leak shapes and preserve WASM heap across repeated moveFace rebuilds」跑 20 次 moveFace 重建，
   先以 `expect(initialHeapBytes).toBeGreaterThan(0)` 做真值存在性防呆，再斷言 `finalHeapBytes === initialHeapBytes`（零增長）。
3. **效能計時測試門檻與環境變數處理** → **已解決（A3）**。
   計時斷言已抽離為獨立單元：`scripts/check-perf.mjs`（`npm run check:perf`）以 `PERF_CHECK=1` 閘控
   `tests/phase3/thread.test.ts`、`tests/phase6/undercut-analysis.test.ts`、`tests/phase3/thread-fuzz.test.ts` 三檔，
   與一般 `npm test` 的全套平行執行脫鉤，消除 CPU 負載造成的門檻波動。門檻本身未放寬（AGENTS.md §3.3）。

## 結案後的既有核心限制（非本 ADR 範圍，另行記載）

螺牙的布林運算遇 B-spline 運算元必洩漏 Emscripten Heap（每次 2.5~8.3 MiB，永不歸還；`Kernel.thread` 約 10.0 MiB／次再生）。
此限制非本 ADR 所引入，已量測並記載於 `AGENTS.md` §3.5；其產品側緩解（Worker 記憶體高水位自動重啟）見 ADR 0126。

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
