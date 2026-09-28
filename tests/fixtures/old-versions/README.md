# 舊版文件樣本

這些檔案由**舊版程式本身**寫出，不是手寫的，用來證明舊檔永遠開得起來（B9.2）。
`tests/phase1/files.test.ts` 會開啟它們、遷移到目前的版本、重新計算，並與解析值比對。

| 檔案 | Schema | 寫出它的版本 | 內容 |
|---|---|---|---|
| `v1-demo.3db.json` | 1 | `60d55b6`（Phase 0） | 示範件：20×10×5 的塊，一條 R2 圓角 |
| `v2-demo.3db.json` | 2 | `e63cfc5`（1A） | 同上 |
| `v3-demo.3db.json` | 3 | `61bac81`（1B） | 同上 |
| `v3-plate.3db.json` | 3 | `61bac81`（1B） | 40×30×10 的板、R4 貫穿孔、2×2 導角、頂面上 R3×5 的凸台 |

產生方式：

1. `git archive <版本> packages/model/src` 取出當時的模型套件。
2. 用 `rolldown` 打包一個呼叫 `createDemoPart()`（板件則用當時的 `applyCommand` 逐一插入特徵）與 `serializePart()` 的小程式。
3. 以 `node` 執行並寫出。

`.3dbx` 之前，「另存新檔」下載的就是這種文件文字。這些檔案不可修改；格式再升版時，另外新增該版本的樣本。
