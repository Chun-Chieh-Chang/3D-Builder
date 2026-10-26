# 清理歷史：2026-10-07至2026-10-20

> 封存原盤點與當時處置，不是目前刪除授權或未使用資源清單。最新盤點見[清理紀錄](../cleanup-candidates.md)。

# 清理候選清單（2026-10-07）

使用者的決定：**只列清單，由使用者勾選後才刪**。**處理結果（2026-10-07）**：A 的 2 個（`conjugate`、`DOWEL_STANDARD_SOURCE`）與 C 的 17 個文字鍵（中英文各一份）已刪；B 的 11 個與 D 的三項使用者沒有勾，**保留**（B 是輸出驗證用的讀取器，D 是不在版本庫的檔案）。下面是掃描當時的清單，留作紀錄。

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

## F. 2026-10-09 的第二輪（使用者決定：不保留）

重新掃描（同一種方法）：沒被引用的匯出 2 個（`slideAt`、`arcSlideAt`，工程圖尺寸改成在圖上拖之後留下的）、沒被引用的文字鍵 2 個（`drawingUi.dimTolUnit`、`measure.units`；`sketch.hint.slot1/2/3` 是動態組出來的，不算）——**已刪**。檢出目錄裡的舊檔案組 `3DB實機確認/`（被 `.gitignore` 排除，與 `D:\3DB實機確認` 重複）已刪，其中使用者可能自己存的 `零件1.3dbx` 先複製到 `D:\3DB實機確認` 才刪；舊的桌面版安裝檔 `3D-Builder_0.1.0_x64-setup.exe` 已刪（`desktop.exe` 在 2026-10-09 重打時已更新）。

**沒刪的與原因**：B 的 11 個「只有測試用到的匯出」是 DXF、PDF、STL 的讀取器與量測，驗收測試靠它們證明輸出是對的，不是死碼；`spikes/occt-gaps` 是 ADR 0017 等的證據，刪了文件會指到不存在的檔案。這兩項如果要刪，要連測試或 ADR 一起改。

## G. 2026-10-20 的第三輪（使用者決定：刪掉沒有引用的，只有測試用到的保留並記錄）

掃描方法同上：
- **匯出**：278 個原始檔，比對整個版本庫，排除定義所在的那一行。
- **介面文字鍵**：3859 個 zh-TW 鍵。排除 `help.*`；排除 47 個在執行期組出鍵名的前綴；再對每個候選以 `` `prefix.${…}` `` 形式逐一人工確認。

**已刪**：
- 沒有任何引用的匯出 3 個：
  - `PRESET_FONT_IDS`（`packages/drawing/src/fonts.ts`）；
  - `threadEngagementHeight`、`externalThreadDepth`（`packages/model/src/threadStandards.ts`），以及只說明它們的註解。
- 沒有引用的介面文字鍵 28 個，中英文各一份，共 56 行：
  - `pm.pattern.curveHint`、`pm.pattern.modeLinear`、`pm.pattern.modeCircular`、`pm.pattern.modeCurve`；
  - `drawingUi.titleBlock`、`drawingUi.views`、`drawingUi.breakFrom`、`drawingUi.breakTo`、`drawingUi.derived`、`drawingUi.selectParent`、`drawing.dimAssembly`、`drawingUi.pdfFontPreset`、`drawingUi.annList`；
  - `drawingUi.cmd.projected`、`.dimension`、`.note`、`.datum`、`.fcf`、`.centreMark`、`.centreLine`、`.surface`、`drawingUi.taskPane`；
  - `pm.thread.autoLength`、`pm.knurl.axisEmpty`、`pm.split.title`、`pm.moveCopyBody.title`、`pm.deleteKeepBody.title`、`pm.jog.title`。

  另外 `sketch.hint.slot1/2/3` 是在執行期組出的，不算。

**保留（只有測試用到）**：
- B 類 11 個：讀取器與量測，加上 `standardTolerance`、`resetHelp`、`pictureCorners`。
- `registerTranslation`、`placeholdersOf`：翻譯測試的機制。
- `fundamentalTriangleHeight`：刪掉上面兩個之後，只剩 ISO 68-1 的測試用到它。
- 4 個產品沒有呼叫、只有測試覆蓋的功能函式：
  - `suggestScale`（工程圖比例建議，C16.1）；
  - `balloonItems`（組合件視圖的號球）；
  - `listThreadsBySystem`；
  - `valueIn`。

  它們是「寫好、測過，但沒有接到畫面」的功能，要嘛接線，要嘛連測試一起刪，**留給使用者決定**。

**本機、不在版本庫的檔案**：已移到資源回收筒，可以還原。
- `dev.log`、`thread-solo.log`、`selection-board.html`、`task_plan.md`、`findings.md`、`progress.md`、`test-output/`；
- `scratch/` 中沒有被任何追蹤檔案提到的 110 項、`out/` 的 41 項。

**有被 ADR、DEV_LOG 或 handoff 提到的證據**都留著：
- `scratch/`：`drawing-feasibility-2026-10-11.md`、審查報告、決策頁、`diagnostics/`、兩份 worktree 備份、`drawing-parts/`、客戶零件等 11 項；
- `out/shots-sidebar/`。

`sync.ffs_db`（FreeFileSync）沒有動。
