# SolidWorks 檔案批次轉 STEP

3D-Builder **不直接讀寫** SolidWorks 的原生檔（`.sldprt`、`.sldasm`），決策與理由見 [blueprint.md](../../docs/blueprint.md) §1 的「SW 原生格式」一列。這個資料夾是替代做法：**在有 SolidWorks 的電腦上**把一整個資料夾的零件與組合件批次轉成 STEP，再把 STEP 拿到 3D-Builder 開。

| 檔案 | 在哪裡跑 | 做什麼 |
|---|---|---|
| [BatchExportStep.bas](BatchExportStep.bas) | SolidWorks 的 VBA（用 SW 的 API，需要 SW 已安裝） | 選一個資料夾，每個 `.sldprt`／`.sldasm` 轉成一個 STEP，寫一份紀錄檔 |
| [check-step.mjs](check-step.mjs) | Node（本專案，不需要 SW） | 檢查轉出來的 STEP：幾個產品、幾個組合件用法、幾個實體；組合件有沒有被壓成一個實體 |

> **老實說明（2026-10-07）**：`check-step.mjs` 在這裡用專案裡的 STEP 檔與假的紀錄檔測過；`BatchExportStep.bas` **沒有在 SolidWorks 裡跑過**（寫它的電腦沒有 SW）。它用的 API 呼叫（`OpenDoc6`、`ResolveAllLightWeightComponents`、`Extension.SaveAs`）都是 SW API 的標準呼叫，但第一次請先用 2 到 3 個檔案試，不要直接丟整個資料夾。不同 SW 版本若說某個方法找不到（例如 `Extension.SaveAs` 已標為過時），改成 `Extension.SaveAs3`。

## 安裝（一次）

1. 開 SolidWorks。選單「工具」→「巨集」→「新建…」，隨便取個名字存成 `批次轉STEP.swp`；SW 會打開 VBA 編輯器。
2. 在 VBA 編輯器：「檔案」→「匯入檔案…」，選 `BatchExportStep.bas`。刪掉編輯器自己產生的那個空模組（通常叫 `Module1`／`Project`），存檔。
3. 這個 `.bas` 只有 ASCII（VBA 編輯器用系統碼頁讀檔，中文會亂碼），訊息是英文。

## 轉檔前先設定 STEP 選項（SW 的設定決定輸出什麼，巨集不改它）

「工具」→「選項」→「匯出」→ 檔案格式選 STEP：

- 輸出格式選 **AP214**（或 AP242）；不要選只含曲面的設定。
- 組合件要**保留零組件結構**（每個零件一個產品、每個放置一個用法）。不同 SW 版本這個選項的名字不一樣；做完用下面的檢查確認，不要只相信選項。

## 執行

「工具」→「巨集」→「執行…」，選 `批次轉STEP.swp`，模組 `BatchExportStep`，程序 `main`。跳出選資料夾的視窗，選放 SW 檔的資料夾。

- 輸出在 `<那個資料夾>\STEP\`，子資料夾的結構照搬；`STEP\export-log.csv` 是每個檔案的結果。
- 組合件用唯讀開、先展開輕量化的零組件再輸出；零件與組合件同名時，零件的檔名加 `_part`。
- 只輸出啟用中的組態。
- STEP 比原檔新就略過；要全部重做，刪掉 `STEP` 資料夾。

## 轉完後檢查

```
node tools/solidworks/check-step.mjs "D:\你的資料夾\STEP"
```

- 每個檔案列出產品數、組合件用法數、實體數。
- **組合件的用法數是 0** 表示被壓成一個實體（沒有保留結構），回頭檢查上面的 STEP 選項。
- 紀錄檔裡有 `failed` 的檔案也會列出來。有問題時結束碼是 1。

再抽一兩個檔案做對照（藍圖的驗收方式）：在 3D-Builder 開那個 STEP，「工具」→「物質特性…」的體積和 SW 的「物質特性」比，差距應在 0.01% 以內。

## 限制

- 一定要有 SolidWorks 和它的授權；批次轉檔會一個一個開檔，大組合件很慢。
- STEP 只有幾何（和組合件的結構與位置），沒有 SW 的特徵樹、結合、組態、材質。轉進來的零件在 3D-Builder 是「輸入本體」，可以接著加特徵，但不能改原來 SW 的特徵。
- 輸出的方向（3D-Builder → SW）本來就是 STEP，SW 可以直接開，不需要巨集。
