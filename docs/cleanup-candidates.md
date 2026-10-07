# 清理候選清單（2026-10-07）

使用者的決定：**只列清單，由使用者勾選後才刪**。這份是掃描的結果，**還沒刪任何東西**。勾選的結果由使用者貼回對話，之後才動手；做完把這份更新成「已處理」或移除。

掃描方法與限制：

- 沒被引用的匯出：把 `packages/*/src` 與 `apps/web/src` 的每個 `export const/function/class/interface/type/enum`（共 1282 個）拿去對整個版本庫的程式、測試、腳本、文件做整詞搜尋。動態組出來的名稱（`` `x.${y}` ``）與只在文件裡提到的名稱，這個方法看不出來。
- 沒被引用的介面文字鍵：zh-TW 目錄 2901 個鍵，去掉 `help.*`（由說明系統讀）與動態組鍵的前綴後，剩下沒有字面引用的。

## A. 沒有任何引用的匯出（2 個）

| 名稱 | 檔案 | 說明 |
|---|---|---|
| `conjugate` | `packages/assembly/src/math.ts:19` | 四元數共軛。同檔的其他四元數函式都有人用，這個沒有。 |
| `DOWEL_STANDARD_SOURCE` | `packages/model/src/dowel.ts:17` | 常數字串 `'ISO 286-1 / ISO 8734'`，沒有人讀。 |

## B. 只有測試用到的匯出（11 個，建議保留）

這些是驗收用的「讀取器與量測」，用來證明輸出的 DXF、PDF、STL 讀回來是對的（`readPdf`、`checkPdf`、`pathsInMm`、`dxfOrder`、`dimensionMeasure`、`drawnEntities`、`readBinaryStl`、`stlMeasure`），加上 `standardTolerance`（`tolerance.ts`）、`resetHelp`（`help/state.ts`）、`pictureCorners`（`picture.ts`，ADR 0116 的驗收用）。產品程式不呼叫它們，但驗證要靠它們。**刪了測試就沒有東西驗證輸出**，所以預設保留。

## C. 沒有被引用的介面文字鍵（17 個）

刪的時候 zh-TW 與 en 兩邊都要刪。`sketch.hint.slot1/2/3` 是動態組出來的（`controller.ts:272`），**不算**，已排除。

`drawingUi.sectionAt`、`edit.deleteFace`、`flat.volume`、`eq.dimensionName`、`measure.empty`、`check.badFaces`、`explode.exploded`、`helpui.pickHint`、`helpui.noTopic`、`matePanel.limits`、`mate.limitNeedsValue`、`pattern.seedLeftOut`、`pattern.folder`、`pm.edges.hint`（已被 `pm.edges.hintFaces` 取代）、`contour.none`、`reference.nothingPicked`、`stepasm.failedWhy`。

## D. 檔案與資料夾

| 項目 | 說明 | 建議 |
|---|---|---|
| 檢出目錄裡的 `3DB實機確認/` | 被 `.gitignore` 排除的舊檔案組（10-05 產生，42 個檔）。現在的檔案組在 `D:\3DB實機確認`。裡面有一個 `零件1.3dbx`（10-06 20:15），**可能是你自己存的**。 | 先確認 `零件1.3dbx` 是不是你要的，再決定 |
| `apps/desktop/src-tauri/target/release/desktop.exe` | 10-04 建的舊桌面版，早於 ADR 0108。重新打包時（等實機驗證做完）會被新版取代。 | 不刪，打包時一起處理 |
| `spikes/occt-gaps` | 技術驗證腳本，是 ADR 的證據（README 說明「不屬於產品程式碼」）。 | 保留 |

## E. 文件完整性（掃描無問題，不需處理）

- `docs/` 底下每份文件都被別處連結；`handoff.md` 與 `README.md` 的相對連結沒有失效。
- 117 份 ADR 都有出現在 `handoff.md` 的文件地圖。
