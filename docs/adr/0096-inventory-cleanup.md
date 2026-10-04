# ADR 0096：全面盤點與清理（鞏固 H-11）

- 狀態：已實作並驗證（2026-10-04）。**沒有改變任何行為**；`npm run check` 前後測試數一致（只多了 H-10 的測試）。
- 相關：[hardening-plan](../hardening-plan.md)、[ADR 0001](0001-ssot-mece-rules.md)（SSOT／MECE 守則）。

## 做了什麼

1. **死碼**（用 `tsc --noUnusedLocals`、一支掃描「匯出了但整個專案沒人用」與「沒有人引用的模組」的腳本找）：
   - 移除 18 個檔案裡沒用到的 import（`PropertyManager`、`assembly`、`drawing`、`store`、`sketch-rules`、`ops`、測試與測試輔助）。
   - 移除 6 個沒人用的匯出：`PLANE_MODES`／`AXIS_MODES`／`POINT_MODES`、`MIRROR_IN_PART`、`PIN_CLASSES`、`isGrid`。
   - 移除 `Viewer` 三個只寫不讀的私有欄位（`section`、`overlay`、`sketches`）與兩個測試裡的死區域變數。
   - **沒動的**：剩下的「未使用的參數」（回呼參數、`elementLabel(asm, ref)` 的 `asm` 等）是簽名的一部分；`kernel.worker.ts` 看起來沒人引用，其實是用 `new Worker(new URL(...))` 載入的；`spikes/` 是各 ADR 的證據腳本；`tests/e2e/` 腳本由 handoff 與 ADR 引用。
2. **文件對齊（SSOT）**：
   - `handoff.md` 第 3 行原本是一段把 Phase 4a 到 7 全部塞在一起的狀態（與 §3 重複，而且 §3 反而沒有 Phase 6、7 與鞏固）；Phase 6、7、鞏固的摘要搬進 §3，第 3 行縮成一段，§0.0「快速接手」（停在 3b-7）改成目前的狀態與下一步；§3 的「檢查」一行去掉三十幾筆舊的測試數字（`git log` 與各 ADR 有）。
   - `README.md`：進度（原本停在 Phase 2）、結構（原本缺 drawing、library、i18n、desktop 與 tests/phase3–8）、藍圖路徑（原本指向一個不在版本庫的檔案）。
   - `docs/hardening-plan.md` 加 H-11。
3. **這個專案沒有 `DEV_LOG.md` 與 `wiki/`**：開發紀錄的單一來源是 `handoff.md`（狀態與待辦）加 `docs/adr/`（每個決策）加 `git log`；為了「對齊」而新增兩份重複的文件會違反 SSOT，所以沒建。

## 資安與數據隱私盤點（推送前）

- 追蹤中的檔案沒有金鑰、權杖、密碼或私鑰（掃過 api key／secret／password／token／private key 的樣式）；沒有電子郵件地址（除了 `noreply@anthropic.com` 的提交署名）。
- 出現使用者名稱的只有：`handoff.md`、`docs/blueprint.md` 與三個需要真實樣本的測試／腳本裡的本機路徑（`C:\Users\ws61\…`、`C:\Users\3kids\…`），是「樣本放在哪裡」的說明，不含憑證。
- 遠端是 GitHub 私人倉庫（`gh repo view` 確認 `PRIVATE`）；提交作者信箱是 git 設定的帳號信箱。
- `.gitignore` 排除 `node_modules`、`dist`、`target`、輸出目錄；`SW_SAMPLE_DIR` 的專有樣本不進版本庫。

## 跨電腦開發（使用者的要求：專案要保留在不同電腦開發的彈性）

- 專案會放在隨身碟帶著走，所以換電腦時壞掉的都是「這台電腦」的事，不是程式的事：`node_modules` 裡 npm workspaces 的連結是絕對路徑（磁碟代號變了就指到不存在的地方，exFAT／FAT 上根本做不出來）、每台電腦各自裝的工具（Node、git、Rust 與 C++ 編譯器）、git 的每個 clone 各自的設定（`npm run setup:git`）。
- 新增 `npm run doctor`（`scripts/doctor.mjs`，唯讀）：檢查 Node 版本、git 與 `.3dbx` 差異顯示設定、**每個工作區連結是否指向這個資料夾**、這個磁碟能不能做連結（用一個馬上刪掉的暫時連結測）、埠 5391、Rust 與 C++ 工具（只有桌面版需要）、`SW_SAMPLE_DIR`；每個問題附修法，只有會讓 `npm run check`／`npm run dev` 失敗的才讓結束代碼是 1。在一個暫時的專案裡驗證了「連結指到別處」「連結不存在」兩種失敗的訊息與結束代碼。
- 盤點程式與設定裡沒有寫死的本機路徑（只有兩個需要真實樣本的測試的註解範例，樣本資料夾走環境變數 `SW_SAMPLE_DIR`；e2e 腳本的黃金檔案路徑由 `import.meta.url` 推出）。
- **已做（使用者選 A）：行尾一致。** `.gitattributes` 加 `* text=auto eol=lf`（後面原有的 `binary`、`-text`、`diff=3dbx` 規則照舊）。原因：隨身碟帶著工作樹換到 `autocrlf=false` 的電腦時，上一台留下的 CRLF 檔會原樣被提交，變成整檔差異。重新正規化後索引沒有任何內容變動（版本庫本來就是 LF）；把這台 357 個 CRLF 或混合行尾的工作檔轉成 LF（等於全新 checkout 的樣子，其中 12 個混合行尾是我今天用腳本改出來的）後，`npm run check` 仍是 1985 項通過、21 項略過。
- **決定不做（使用者選 A）：讓套件解析不靠符號連結**（在 tsconfig／vite／vitest 加別名，讓 exFAT 隨身碟上也能直接跑）。理由：它用「兩套解析機制並存」換來「少一個前提」，長期維護成本高於它省下的；跨電腦的主要做法是每台電腦把專案放在自己的 NTFS 磁碟，用 git 搬原始碼。專案放在 exFAT 或 FAT 上時 `npm run doctor` 會直接說原因與修法。若日後真的需要，做法與風險見 handoff §6「工作區連結」的暫時別名，與下列：要 12 個套件加 5 個子路徑（如 `@3db/sketch/interact`）在 tsconfig（`paths` 是靜態的，要另加檢查防止漏改）、vite、vitest 三處維護，vitest 要限制平行數，桌面版打包也要驗證。

## 限制

- 掃描只找得到「靜態」沒人用的符號；經由字串或動態引用的（例如 Worker 路徑、`window.__…` 腳本入口）不會被當成死碼，也可能漏掉經由 `index.ts` 再匯出的間接用法。
- 桌面版安裝檔原本是 2026-10-03 建的，早於 Phase 4a 到 7；2026-10-04 在這台裝了 Rust 之後**重建並覆蓋**（`3D-Builder_0.1.0_x64-setup.exe`，11,673,078 位元組，SHA-256 `08c70f0e…2e4`；Rust 編譯 8 分 22 秒加打包）。用桌面版自己的探測腳本啟動新建的 `desktop.exe`：視窗載入，有「特徵、鈑金、草圖、工具、檔案、檢視」分頁與 3D 畫布。**沒有**在乾淨的帳號安裝過（那是使用者的人工驗收，清單 A1）。安裝檔不在版本庫（`target/` 被排除）。
