# ADR 0137：重建的決定性（B3.1）——求解輸出上網格、每次重建全新求解器、布林結果面命名繼承

- 狀態：**已實作並驗證**。來源：藍圖 B3.1（P0，「同輸入 → 同輸出」）。B1 驗收（`tests/phase3/real-part1-fillet.test.ts`）在零件1 上發現同一份文件兩次重建的結果不同：核心剛載入的第一次重建把凸耳所在圓柱面命名為 `cut2:side:sketch6.a3`（圓角「遺失參考」），之後的重建命名為 `revolve1:side:sketch4.l6`（圓角成立、149.705286 mm³）。使用者 2026-10-14 裁決：**先做決定性重建，草圖修補其次**。

## 背景與根因（RCA）

兩層不決定疊加：

1. **planegcs 求解不決定**：FreeCAD 的 planegcs 以參數**在記憶體中的位址順序**建立內部 `std::map`，浮點運算順序隨堆積佈局變動。實測：同一張（完全定義的）合成草圖連續 8 次求解得到 4 種位元級答案；與草圖內容無關（縮放副本、無模型參考的草圖同樣重現）。漂移量可達其收斂門檻 1e-10 mm。每個 solve 用全新的 `GcsSystem` 也一樣——排序在模組內。
2. **OCCT 對重合面的合併不決定**：零件1 的 cut2 圓弧恰好落在 revolve1 的 R 3.125 圓柱面上；`ShapeUpgrade_UnifySameDomain` 合併與否取決於 OCCT 內部相遇順序（記憶體狀態）：第一次重建留 7 片（來源只報工具面），之後併成 4 片（其中一片帶本體面來源）。1e-10 級的草圖差正好決定走哪條路，於是「開檔第一次圓角失敗、再開一次就好」。

排除過的假設（皆以探針量測否定，記錄以免重走）：`SetNonDestructive(true)`、`SetFuzzyValue`、放寬 `UnifySameDomain` 公差、調緊 planegcs 收斂門檻（`set_covergence_threshold`，`clear_data()` 每次重置）、重建間的快取或殘留狀態（經查無快取，每次皆從頭重解）。

## 決定

1. **求解輸出上十進位網格**（`packages/sketch/src/planegcs.ts` `canon`）：長度 1e-10 mm、角度 1e-12 rad（約核心公差 1e-7 的千分之一）。刻意用十進位：打 12.4 回 12.4（二進位網格實測會回 12.400000000023283）、−0 歸 +0。網格線附近的值仍可能落兩側，但殘餘差已遠低於核心任何判定門檻。
2. **每次重建以全新求解器開始**（`PlaneGcsSolver.fresh()`，約 4 ms）：worker 的四個重建入口（`build`／`rebuild`／`exportStep`／`exportStl`）重建前 `await solver.fresh()`；編輯中的互動求解沿用現有模組。兩者缺一不可：合成測試（同一求解器連續求解）證明 `canon` 的必要；重建決定性測試證明 `fresh` 的必要（拿掉任一，對應測試失敗）。
3. **布林結果面命名繼承**（`packages/kernel/src/sameSurface.ts`，`kernel.boolean` 接上）：工具做出、貼在本體面同一張解析曲面上**且相接**的面，繼承該本體面的來源——即「合併若發生時它會得到的名字」，不管 OCCT 這次併不併。同一張曲面＝平面／圓柱／球（軸向反向算同一；圓錐／環面／自由曲面不比較）。已有本體來源的面與不相接者不動（窄規則，不誤改真正的凹槽壁）。
4. **`mergeGroups` 補一規則**（`packages/sketch/src/ops.ts`）：「點在線上／弧上」而該點已是該曲線**自己的端點**時移除——合併點把角落合成一點後，這條「在…上」說的就是角落本身，留著求解器判冗餘（過度定義）。

## 驗證

- `typecheck` 0 錯誤；`lint:rules`／`lint:deps`／`lint:i18n` 全過；全量 vitest **2743 過、24 略過、0 失敗**。
- `tests/phase3/real-part1-fillet.test.ts`（`REAL_PART1_DIR`）：四次重建＋穿插其他草圖求解後，問題清單、面名稱、體積、所有草圖解**逐位元一致**；存檔狀態＝確定性「圓角失敗」（凸耳邊參考都找得到、`unresolved` 空；sketch6 有 11 條 `pointOnCurve` 成對角落）。
- 新測試：`packages/sketch/test/solve-determinism.test.ts`、`packages/kernel/test/same-surface.test.ts`（6 項正反例）、`relations.test.ts` 線接弧角落的合併新例。
- 反向對照：拿掉 `canon` 或 `fresh()`，對應的決定性測試即失敗。
- 全量 `npm run verify:ui`：**131/131 通過**（131 列、0 已知缺陷、0 失敗；含修好受 C1 影響的 `manual-c8` 腳本後的全量重跑）。

## 影響與限制

- 每個重建多約 4 ms（重載求解器模組）。
- 求解值可能與先前相差至多 5e-11 mm（等值化；≪ 核心公差，幾何判定不受影響）。
- **零件1（客戶檔）開檔後 `fillet_lugs` 必失敗**——先前的「再開一次就好」是不確定性的僥倖。修補 sketch6（8 個成對角落「合併點」＋刪除面板標為冗餘的關係）是回復圓角的前置，留給使用者手動完成；詳見 handoff.md。
- 命名繼承只認平面／圓柱／球；圓錐／環面／自由曲面上的重合面仍依賴 OCCT 的合併運氣。
- 若日後換 planegcs 或 OCCT 版本，`canon`／`fresh`／命名繼承三個緩解都須重新評估。

## 相關

- AGENTS.md §3.5（OCCT 布林遇 B-spline 必洩漏）是同類「底層函式庫不確定性、以緩解而非根治處理」的先例（[ADR 0126](0126-worker-heap-recycling.md)）；本 ADR 為求解與命名面的緩解。
- 藍圖 B3.1；B1 選擇題（`docs/decisions-2026-10-14.html`）。
