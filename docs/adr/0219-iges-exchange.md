# ADR 0219：IGES 輸出與輸入（F1.4、F2.2）

日期：2026-10-29。狀態：已實作；eDrawings 對照檔待使用者判定（見「未完成」）。

## 問題

藍圖 F1.4（IGES 輸出）與 F2.2（IGES 輸入）列在 P2。只讀 IGES 的舊 CAD 與模具廠仍常見。`libcascade` 3.0.2 已編入 `IGESCAFControl_Writer`／`IGESCAFControl_Reader`／`IGESControl_Reader`（ADR 0003 G5 曾驗證過一次往返），不必新增依賴；IGES 5.3 是公開的美國政府規格，沒有授權問題。

使用者決定（2026-10-29）：輸出提供兩種寫法讓使用者選；組合件這次不輸出 IGES；輸入併入原「輸入 STEP」成為「輸入 STEP／IGES」；第三方驗收用 eDrawings。

## 決策

1. **核心輸出 `Kernel.exportIges(id, name, unit, { mode, faceColors, warnings })`**：經 XCAF 文件與 `IGESCAFControl_Writer`，帶零件名稱與面顏色；`mode` 為 `faces`（修剪曲面，實體 144，預設）或 `brep`（流形實體 B-rep，實體 186）；單位 `MM`／`INCH`。寫出前與 STEP 相同經過 `seamless`（環面、球面切半）與 `portableShape`（偏移曲面轉 B 樣條，`exportPartIges` 與 `exportPartStep` 共用 `writePart`）。
   - **量到的陷阱**：`write.iges.unit`、`write.iges.brep.mode` 是全域設定，**寫出器在建構時讀取**；建構後才設，會套用到「下一個」檔案（探針：第二、三個檔的寫法互換）。因此先 `IGESControl_Controller.Init()`、設定、再建構寫出器，`finally` 還原為 MM／Faces。測試以「inch＋B-rep 之後的預設輸出仍是 mm＋修剪曲面、之後的 STEP 仍是 AP214、mm」守門。
   - IGES 文字只能是 ASCII：非 ASCII 字元每個寫成 `_`，並以警告告知（OCCT 自己會寫成 `?`、讀回成 `_`，不能默默發生）。不認得的單位或寫法直接拋錯，不改寫。
2. **核心輸入 `Kernel.importIges`**：`IGESControl_Reader` 讀檔後交給既有的 `repairImport`（必要時修復、無實體時縫合）。修剪曲面檔讀回是曲面，會被縫合成實體；B-rep 檔讀回即實體。不是 IGES、讀不完、沒有形狀各有訊息。`import.noSolid`／`import.openSurfaces` 的「STEP 檔」改為「檔案」，兩種格式共用。
3. **Schema 85**：`BlobRef.kind` 增加 `iges`（存成 `blobs/<sha256>.igs`）；`importBody` 指令只接受 `step`／`iges` 資料（原本不檢查，png 也會被接受）；重建依 `blob.kind` 分派到 `importIges`／`importStep`。舊檔不需轉換。
4. **介面**：「檔案」→「輸出 IGES」（只在零件、有本體時；對話框選寫法、單位、顏色、座標系統）；「輸入 STEP」改名「輸入 STEP／IGES」，選檔器接受兩種；「開啟舊檔」也開 `.igs`／`.iges`，開成以檔名命名的新零件。種類先看內容（`isStepData`、`isIgesData`：第一行 80 欄、第 73 欄為 `S`、序號 1），再看副檔名。說明 `help.exportIges`、`help.importStep` 更新；`docs/help-links.json` 的 `_untied` 記錄 `export-iges`（手冊尚無項目）。
5. **讀檔卡死的防禦：拋棄式 worker 限時試讀**（使用者選擇）。模糊測試發現：OCCT 的 IGES 讀取器遇到「參數記錄提早結束的實體」（例如平面 `108,0.;`、`108,-;`）會**無窮迴圈**；`108,-.,…` 這類壞數字則正常拒絕。WASM 裡的迴圈無法中斷。IGES 檔在加入文件之前，先在 `probe.worker.ts`（只載入 kernel、讀一次）試讀，時限與重建相同（`rebuildLimitMs`，60 秒），結束後一律 `terminate`。超時：告知「N 秒內沒有讀完，已停止……沒有加入零件」，文件不變。若不擋在入口，壞檔進了文件後每次重建都會卡到 60 秒的看門狗、重啟 worker、再卡。

## 驗證

- `packages/kernel/test/iges.test.ts`（10 項）：兩種寫法的實體類型與實體數、IGES 5.3 §2.2 檔案結構（80 欄 ASCII、S/G/D/P/T 順序與序號、D 成對、T 行計數）、單位旗標與全域設定還原、名稱與兩種寫法的面顏色（獨立的 XCAF 讀取）、非 ASCII 名稱警告、非法單位／寫法拋錯；輸入：縫合成實體、B-rep 不縫合、inch 換算、面順序穩定、非 IGES／空檔／STEP／截斷檔拋 `KernelError`。
- `tests/phase8/iges-exchange.test.ts`（14 項）：三個金樣零件、整圈圓角（環面）、圓球，各兩種寫法，以**測試自己的讀取器**（OCCT 讀取器＋自己的縫合，不經 `importIges`）讀回：1 個實體、體積相對誤差 ≤ 1e-6、精確包圍盒誤差 ≤ 1e-5 mm、面數等於寫出的面數（以 STEP 往返的面數為準，兩者同樣切半）；再經 `importIges`：1 個實體、體積 ≤ 1e-6、`validAfter`、修剪曲面時縫合且無自由邊。零件中：重建 10 次面名稱與位置不變、`liveShapes` 不增；存檔版本等於 `SCHEMA_VERSION` 且 ≥ 85、資料存為 iges、新程式重建同名同體積；拒絕 png 資料；IGES／STEP 內容辨識（含 CRLF）。
  - 測試讀取器的縫合容差第一版用 1e-6，讀回少了面（18／24）而失敗；`importIges` 同時量到誤差 ~1e-10。原因是修剪曲線以零件尺寸的 1e-7 寫出，1e-6 對相鄰面的邊太緊。改為 1e-4（遠小於任何特徵），驗收門檻（體積、包圍盒、面數）不變。
- `tests/phase8/iges-memory.test.ts`：每種情境各自全新 Heap，以 `wasmMemory.buffer.byteLength` 量測並先斷言基準 > 0，`liveShapes` 回到基準；成長**照實印出、不斷言為 0**（AGENTS.md §3.5）。2000 次輸出（修剪曲面）+330.88 MiB、（B-rep）+330.88 MiB；**只用 OCCT 自己的 `IGESControl_Writer`、不含本專案任何程式 2000 次 +330.88 MiB**——成長屬於程式庫；對照 2000 次 STEP 輸出 +422.69 MiB（既有）；1000 次輸入 +190.63 MiB；對照組 1000 次布林除料 +190.63 MiB。產品側由 ADR 0126 高水位重啟限制。
- `tests/phase8/iges-fuzz.test.ts`：200 個壞檔（截斷、改位元組、刪行、重複行、壞數字，固定亂數種子），以子行程逐一讀，超過 15 秒即殺掉該行程、記為「停止」並從下一個繼續——與產品的試讀 worker 同一機制。結果：63 讀入、135 以 `KernelError` 拒絕、2 停止（#46 改位元組、#187 刪行），0 個其他錯誤、0 次當機；之後同一核心讀好檔體積不變。
- 瀏覽器 `tests/e2e/phase8-iges.js`（獨立 dev server 5491）：對話框兩種寫法下載（`.igs`、實體 144／mm、實體 186／inch）、「開啟舊檔」開成「板子」新零件（資料 iges、體積 6000）、「輸入 STEP／IGES」（體積 6000）、卡死檔在 8 秒時限（測試調低）8.1 秒內停止並告知、未加入特徵、kernel worker 未受影響、零件仍可重建。對話框截圖檢查無溢出。

## 未完成

- **eDrawings 判定**：步驟 0 的對照檔已產生（方塊、整圈圓角、球，各兩種寫法），待使用者在 eDrawings 開啟判定；若 eDrawings 不能開 IGES，第三方驗收需改用其他獨立檢視器。
- **別的 CAD 寫的 IGES**：目前沒有樣本，讀入只以本程式寫出的檔與模糊測試驗證。
- **範圍外**：組合件 IGES 輸出、IGES 組合件結構、「插入零組件」接受 IGES。STEP 讀取是否有同類卡死未測。
