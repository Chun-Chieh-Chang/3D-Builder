# 舊版文件樣本

這些檔案由**舊版程式本身**寫出，不是手寫的，用來證明舊檔永遠開得起來（B9.2）。
`tests/phase1/files.test.ts` 會開啟零件樣本、遷移到目前的版本、重新計算，並與解析值比對；組合件樣本由 `tests/phase2/assembly.test.ts` 開啟，並以相對路徑找到金樣零件。

| 檔案 | Schema | 寫出它的版本 | 內容 |
|---|---|---|---|
| `v1-demo.3db.json` | 1 | `60d55b6`（Phase 0） | 示範件：20×10×5 的塊，一條 R2 圓角 |
| `v2-demo.3db.json` | 2 | `e63cfc5`（1A） | 同上 |
| `v3-demo.3db.json` | 3 | `61bac81`（1B） | 同上 |
| `v3-plate.3db.json` | 3 | `61bac81`（1B） | 40×30×10 的板、R4 貫穿孔、2×2 導角、頂面上 R3×5 的凸台 |
| `v4-refplane.3dbx` | 4 | `b5ed448`（1E） | 板、偏移 25 的基準面、從基準面「成形至某一面」長到板上的 R4 圓柱 |
| `v5-import.3dbx` | 5 | `3b80043`（1F） | 輸入 `tests/fixtures/step/plate-with-hole.step`（資料在檔案內），輸入邊線上 R2 圓角 |
| `v6-demo.3dbx` | 6 | `0c51daf`（Phase 3 計畫草案的提交，Schema 還是 6） | 示範件：20×10×5 的塊，一條 R2 圓角（v7 加入 `visibility`） |
| `v7-demo.3dbx` | 7 | `d313e19`（Schema 7 的最後一個提交） | 示範件：20×10×5 的塊，一條 R2 圓角；草圖與原點被隱藏（`visibility`） |
| `v8-expressions.3dbx` | 8 | `5e6eb6c`（Schema 8 的最後一個提交，3a-1） | 示範件：20×10×5 的塊與 R2 圓角；變數 `plate_w = 10`、寬度尺寸 `plate_w*2`、檔案屬性「板厚 = 5mm」、伸長深度 `property('板厚')`（運算式，v8 加入） |
| `v9-direct-edit.3dbx` | 9 | `4a9b09e`（Schema 9 的最後一個提交，3a-2） | 示範件：20×10×5 的塊與 R2 圓角，再加「刪除面」（刪掉圓角）與「移動面」（端面移動 3 mm）（v9 加入） |
| `v10-bodies.3dbx` | 10 | `027a70d`（Schema 10 的最後一個提交，3a-4a） | 示範件（20×10×5 的塊與 R2 圓角），加上遠處一個 10×10×3 的塊：兩個本體，第二個叫「工件」（`bodies`，v10 加入） |
| `v11-relations.3dbx` | 11 | `f774c3b`（Schema 11 的最後一個提交，3a-4b） | 示範件，加上遠處一個 10×10×3 的塊，其草圖有從動尺寸（`driving: false`）、「交錯」「同心同徑」限制條件、弧長尺寸（都在幾何建構線上，不進入輪廓）（v11 加入） |
| `v12-contours.3dbx` | 12 | `7041a21`（Schema 12 的最後一個提交，3a-4c） | 示範件，加上一個有兩個輪廓（10×10 與 15×10）的草圖，伸長只用第一個（`contours`，v12 加入），深度 3 |
| `v13-references.3dbx` | 13 | `e87249b`（Schema 13 的最後一個提交，3a-4d） | 示範件，加上一張草圖：投影了塊的一條邊線的直線（`ref`）與一個貫穿點（`pierce`，v13 加入） |
| `v14-extrude.3dbx` | 14 | `92adb71`（Schema 14 的最後一個提交，3a-5a） | 示範件，加上遠處一個 10×10 的伸長：方向 1 深度 3、拔模 2°，方向 2 深度 2（`dir2`、`draft1`，v14 加入） |
| `v15-shell.3dbx` | 15 | `bba1d3f`（Schema 15 的最後一個提交，3a-5b） | 示範件（20×10×5 的塊與 R2 圓角）加上「薄殼」：起始面開口、壁厚 1（`shell`，v15 加入） |
| `v16-draft.3dbx` | 16 | `3ec02db`（Schema 16 的最後一個提交，3a-5c） | 示範件加上「拔模」：以起始面為中立面，兩個長壁拔模 2°（`draft`，v16 加入） |
| `v17-hole.3dbx` | 17 | `8f3948c`（Schema 17 的最後一個提交，3a-6a） | 示範件加上一張面上的草圖（一個點）與「異型孔」：M3 柱孔，Ø3.4、沉頭 Ø6.5 深 3.4、總深 4（`hole`，v17 加入） |
| `v18-sweep.3dbx` | 18 | `221a0f6`（Schema 18 的最後一個提交，3a-6b） | 示範件加兩張草圖（前基準面上 30 長的一條線當路徑、右基準面上離示範件很遠的 4×4 矩形當輪廓）與「掃出」，成為第二個本體（`sweep`，v18 加入） |
| `v19-loft.3dbx` | 19 | `dee7dc8`（Schema 19 的最後一個提交，3a-6c） | 示範件加一個基準面（前基準面偏移 20）、前基準面上的 10×10 與該基準面上的 6×6 兩張草圖、與「疊層拉伸」，成為第二個本體（`loft`，v19 加入） |
| `v20-rib.3dbx` | 20 | `bde58f8`（Schema 20 的最後一個提交，3a-6d） | 前基準面上 40 × 40 的板（伸長 10）、右基準面上 x = 0 的一條線（z = 25，長 20）的草圖與「肋材」（厚 4，兩側）（`rib`，v20 加入）；不是示範件 |
| `v21-datums.3dbx` | 21 | `bbeb630`（Schema 21 的最後一個提交，3a-7a） | 60 × 20 × 5 的板、板上半徑 2 高 5 的柱，加基準軸（柱面的軸）、參考點（柱頂的中心）、基準面（垂直於該軸通過該點）、座標系統（原點在該點）（`refAxis`／`refPoint`／`coordSys` 和基準面的 `perpendicular`，v21 加入）；不是示範件 |
| `v22-pattern.3dbx` | 22 | `245f3d7`（Schema 22 的最後一個提交，3a-7b） | 60 × 20 × 5 的板、板上半徑 2 高 5 的柱，加「線性複製排列」：沿右基準面法向（x）4 個、間距 10、跳過第 2 個（`pattern`，v22 加入）；不是示範件 |
| `v23-mirror.3dbx` | 23 | `b1b00b4`（Schema 23 的最後一個提交，3a-7c） | 60 × 20 × 5 的板、板上半徑 2 高 5 的柱、x = 30 的基準面，加「鏡射」柱（特徵鏡射，`mirror`，v23 加入）；不是示範件 |
| `v25-notes.3dbx` | 25 | `ec053be`（Schema 25 的最後一個提交，4a-0 之前） | 40 × 30 × 10 的板、板內半徑 4 高 5 的圓柱（整個在板裡面，不改變體積），加底板的註解「底板」與標籤「主體」（`comment`／`tag`，v25 加入）；不是示範件 |
| `v24-material.3dbx` | 24 | `b4cea8c`（Schema 24 的最後一個提交，3a-9a） | 60 × 20 × 5 的板與柱，加材質（碳鋼）、文件設定（CNS、小數 2 位）、柱的外觀（藍色）（`material`／`settings`／外觀對象，v24 加入）；不是示範件 |
| `v5-assembly.3dba` | 組合件 5 | **不是舊版程式寫的**：組合件 Schema 6 的程式寫出，再把 `schemaVersion` 設為 5（Schema 6 只多結合的可省略欄位 `more`、`min`、`max`；產生器同上，第四個測試，`WRITE_FIXTURE_V5=1`，跑法要用只含 `spikes/` 的暫時設定檔） | 存在「組合件/」：定位板<1> 固定、削邊銷<1>、板頂與銷頂的距離結合（15）、削邊銷的爆炸步驟（沿 y 30）（組合件 Schema 6 加入 `more`／`min`／`max`） |
| `v4-assembly.3dba` | 組合件 4 | **不是舊版程式寫的**：組合件 Schema 5 的程式寫出，再把 `schemaVersion` 設為 4（Schema 5 只多一個可省略的 `explosion`；產生器同上，第三個測試，`WRITE_FIXTURE_V4=1`） | 存在「組合件/」：定位板<1> 固定、削邊銷<1>、削邊銷的線性複製排列（3 個、間距 40、跳過第 3 個）與鏡射（右基準面）（組合件 Schema 5 加入 `explosion`） |
| `v3-assembly.3dba` | 組合件 3 | **不是舊版程式寫的**：組合件 Schema 4 的程式寫出，再把 `schemaVersion` 設為 3（Schema 4 只多一個可省略的 `patterns`，所以 Schema 3 的檔案就是這段文字；產生器 `spikes/occt-gaps/phase3b-fixture-v2-assembly.test.ts` 的第二個測試，`WRITE_FIXTURE_V3=1`） | 存在專案資料夾：次組合件 `組件/定位組.3dba` 用兩次（定位組<1> 固定、定位組<2>）、一個帶路徑 `['p1']` 的重合結合、定位組<2> 透明（組合件 Schema 4 加入 `patterns`） |
| `v2-assembly.3dba` | 組合件 2 | `fa2ee17`（組合件 Schema 2 的最後一個提交，3b-0；產生器 `spikes/occt-gaps/phase3b-fixture-v2-assembly.test.ts`，在 Schema 3 之前跑的） | 存在「組合件/」：定位板<1> 固定、削邊銷<1>（轉過）、削邊銷<2>；削邊銷<1> 與定位板的「同軸心」「重合」兩個結合（組合件 Schema 3 加入 `hidden`／`suppressed`／`transparent` 與 `MateRef.path`） |
| `v1-assembly.3dba` | 組合件 1 | `7906934`（2A） | 存在「組合件/」的組合件：定位板<1> 固定在原點，削邊銷<1>、削邊銷<2>（其中一個轉 90°）；零件路徑 `../定位板.3dbx`、`../零件/削邊銷.3dbx` |

產生方式：

1. `git archive <版本> packages/model/src packages/io/src` 取出當時的模型與檔案套件；`io` 對 `@3db/model` 的引用改指向同一版本的模型。
2. 用 `rolldown` 打包一個小程式：以當時的 `createDemoPart()` 或 `applyCommand` 建立文件，再以當時的 `serializePart()`（v1–v3）或 `writePartFile()`（v4 起）寫出。組合件以當時的 `applyAssemblyCommand` 建立、`writeAssemblyFile` 寫出。
3. 以 `node` 執行並寫出。

v1–v3 是 `.3dbx` 出現之前「另存新檔」下載的文件文字；v4 起是 `.3dbx`。這些檔案不可修改；格式再升版時，另外新增該版本的樣本。
