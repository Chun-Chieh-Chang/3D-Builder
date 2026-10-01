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
| `v1-assembly.3dba` | 組合件 1 | `7906934`（2A） | 存在「組合件/」的組合件：定位板<1> 固定在原點，削邊銷<1>、削邊銷<2>（其中一個轉 90°）；零件路徑 `../定位板.3dbx`、`../零件/削邊銷.3dbx` |

產生方式：

1. `git archive <版本> packages/model/src packages/io/src` 取出當時的模型與檔案套件；`io` 對 `@3db/model` 的引用改指向同一版本的模型。
2. 用 `rolldown` 打包一個小程式：以當時的 `createDemoPart()` 或 `applyCommand` 建立文件，再以當時的 `serializePart()`（v1–v3）或 `writePartFile()`（v4 起）寫出。組合件以當時的 `applyAssemblyCommand` 建立、`writeAssemblyFile` 寫出。
3. 以 `node` 執行並寫出。

v1–v3 是 `.3dbx` 出現之前「另存新檔」下載的文件文字；v4 起是 `.3dbx`。這些檔案不可修改；格式再升版時，另外新增該版本的樣本。
