# STEP 樣本

| 檔案 | 來源 | 用途 |
|---|---|---|
| `plate-with-hole.step` | 本程式輸出（2026-09-28，OCCT 8.0.1）：40×30×10 的板，R4 貫穿孔 | `tests/phase1/import.test.ts` 的金樣：固定這個檔案輸入後每個面的名稱與幾何 |

| `faces-only.step` | `tests/support/stepSamples.ts` 的 `facesOnly()`（2026-10-08）：20×10×5 方塊的六個面，沒有實體 | 瀏覽器腳本 `tests/e2e/phase3-direct-edit.js` 的「輸入修復」（`npm run verify:ui` 在 5393 埠提供） |
| `gapped.step` | 同上的 `gapped(0.05)`：頂面抬高 0.05 mm，與側面接不上 | 同上：預設容差縫不起來、縫合容差 0.1 縫得起來 |

輸入的面依「檔案讀進來的順序」命名（`<特徵>:f<k>`）。如果日後升級幾何核心改變了這個順序，金樣測試會先失敗，
而不是讓使用者零件裡的參考默默指到別的面。這些檔案不可修改；需要新情境時另外新增。

使用者提供的 SolidWorks STEP 樣本（1F 驗收用）之後也放在這裡。
