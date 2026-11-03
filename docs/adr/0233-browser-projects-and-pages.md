# ADR 0233：瀏覽器內專案（Firefox、Safari 可用組合件與工程圖）與 GitHub Pages 部署

日期：2026-11-03。狀態：已實作。

## 問題

使用者要把系統部署到 GitHub Pages，並要求 Firefox、Safari 也能用組合件與工程圖，同時克服這個做法的風險。

組合件與工程圖用相對路徑找零件（B9.4），所以必須能讀寫**一整個專案資料夾**。網頁讀寫電腦上的資料夾只有 `showDirectoryPicker`，Firefox 與 Safari 基於隱私考量不提供；原本這兩種瀏覽器只會出現「組合件需要能存取資料夾的瀏覽器」。這是瀏覽器的限制，任何程式都無法讓它們直接讀寫電腦上的資料夾。

## 決定

### 1. 專案存在瀏覽器自己的儲存空間（origin private file system）

所有現行瀏覽器都有 `navigator.storage.getDirectory()`。它給的 `FileSystemDirectoryHandle`／`FileSystemFileHandle` 與使用者選的資料夾**是同一種介面**：`getDirectoryHandle`、`getFileHandle`、`entries`、`resolve`、`removeEntry`。所以專案資料夾的程式（`files.ts` 的 `fileIn`、`pathIn`、`listFiles`、`writeFilesInto`，組合件、工程圖、零件來源）**完全不改**：瀏覽器內專案對它們就是一個專案資料夾。

- 全部放在儲存空間的 `3d-builder-projects/` 之下，一個專案一個資料夾（`apps/web/src/browserProjects.ts`）。**只有**這個資料夾下一層的才算瀏覽器內專案：e2e 一向把測試專案放在儲存空間根目錄的 `3db-e2e/`，那個仍被當成「使用者選的資料夾」，既有 267 個瀏覽器腳本的系統對話框替身照常運作。
- 記住上次的專案時存**名稱**而不是 handle（`rememberFolder`），因為不是每個瀏覽器都能把 handle 存進 IndexedDB；專案已刪除時就當作沒有記住。

### 2. 程式自己的開檔／存檔視窗

系統的開檔、存檔視窗只看得到電腦，看不到瀏覽器內的專案。挑檔函式（`pick`、`pickSaveTarget`、`pickAssemblySaveTarget`、`pickDrawingSaveTarget`）發現起始資料夾是瀏覽器內專案時，改由 `projectFileDialog.ts` 發出請求，`ProjectFileDialog` 回答：

- 開檔：列出專案內符合副檔名的檔案（含子資料夾）。「從電腦開啟…」直接開啟電腦上的檔案、不複製；「插入零組件 → 瀏覽」的是「從電腦加入專案…」，會先把檔案複製進專案（零組件必須在專案之內），同名時改成「名稱 (2)」。
- 存檔：檔名可含子資料夾；同名時先問「要取代嗎？」。
- 零件存檔：目前的專案（或記住的專案）是瀏覽器內專案時存進它；否則照舊（Chrome 用系統視窗，其他瀏覽器下載）。

專案資料夾視窗在沒有 `showDirectoryPicker` 的瀏覽器不顯示「選擇資料夾…」，並說明原因；兩種瀏覽器都列出瀏覽器內專案供「使用」。另有「檔案 → 瀏覽器內專案…」管理：使用、建立、匯入、匯出、刪除。

### 3. 風險與對策

| 風險 | 對策 |
|---|---|
| 清除網站資料會連同專案刪除；換電腦、換瀏覽器看不到 | 「匯出」把整個專案打包成 .zip 下載（解壓縮就是同樣的資料夾結構，Chrome／Edge 也能當一般專案資料夾開啟）；「匯入專案（.zip）…」把 .zip 變回專案。兩個視窗都明白寫出這個風險。 |
| 儲存空間不足時瀏覽器自動清除 | 第一次使用瀏覽器內專案時呼叫 `navigator.storage.persist()`（Firefox 會詢問使用者）；拒絕時提示要定期匯出。管理視窗顯示是否已同意保留、已用與可用空間。 |
| 使用者忘了備份 | 每個專案記住上次匯出時間；存檔到超過 7 天（`EXPORT_REMINDER_DAYS`）沒有匯出或從未匯出的專案時，每個工作階段提醒一次。匯入的專案視為已在電腦上。 |
| 較舊的 Safari 的 handle 沒有 `createWritable`（只有 worker 裡的 `createSyncAccessHandle`） | `writeFile` 偵測到沒有 `createWritable` 時改經 `worker/opfsWrite.worker.ts` 寫入：先完整寫進同資料夾的暫存檔（空間不足會在這一步失敗，原檔不動），再寫進目標並刪掉暫存檔；匯出時略過殘留的暫存檔。 |
| 匯入惡意或損壞的 .zip | 每個路徑都檢查：不得有 `..`、`.`、空段、開頭的 `/`、`\` 或 Windows 不允許的字元；任一不合格就整個拒絕，已建的專案刪掉不留半個。Windows／macOS 壓縮資料夾時最上層的那一層資料夾自動拿掉，`__MACOSX/`、`.DS_Store` 略過。 |
| 誤刪 | 「刪除」要再按「永久刪除」；開著的組合件、工程圖或零件所在的專案拒絕刪除。 |

### 4. GitHub Pages

- `vite.config.ts` 的 `base` 取自 `PAGES_BASE`，未設定時仍是 `/`：dev server、`verify:ui`、本機建置不受影響。
- 部署併在 [`repository-integrity.yml`](../../.github/workflows/repository-integrity.yml) 裡：Linux 那一路的建置以 `PAGES_BASE=/<repository>/` 建置（其他系統為空，仍是 `/`），推送到 main 時上傳成 Pages 產物；`deploy-pages` job `needs: integrity`，**三個系統的所有檢查都通過才發布**，網站只建置一次。第一版另開 `pages.yml`，每次推送多一個 workflow、重複 `npm ci` 與建置，且部署不等檢查（41 秒就上線、檢查還在跑），故併入。同時 `push` 只觸發 main：分支由它的 pull request 檢查，推送分支不再讓同一份程式碼跑兩輪。
- 不需要伺服器：OCCT 與 PlaneGCS 是頁面旁的 WebAssembly 檔，以單執行緒版本執行，不需要 `SharedArrayBuffer`，也就不需要 Pages 無法設定的 COOP／COEP 標頭。「關閉伺服器」按鈕在正式建置中本來就不出現。
- 首次載入約 47 MB（OCCT 的 wasm 42.7 MB），之後由瀏覽器快取。

## 沒有選的做法

- **`<input webkitdirectory>` 讀進整個資料夾**：只能讀、不能寫回，改了零件組合件也看不到，存檔只能下載。
- **單一打包檔格式**（組合件連同零件包成一個檔）：要新增檔案格式與其讀寫，工作量最大；而 .zip 匯出入已經提供了「帶著走」的能力。

## 驗證

- 單元測試 `apps/web/test/browser-projects.test.ts`（14 項，以記憶體中的儲存空間替身）：名稱與路徑規則、取名、只有容器下一層算專案、匯出入往返、zip 頂層資料夾、拒絕跳出專案的路徑且不留殘骸、保留請求、匯出提醒、無 localStorage。突變測試：拿掉 zip 路徑檢查、或把「下一層」放寬為「任一層」，各有測試轉紅。
- 瀏覽器 `tests/e2e/manual-browser-projects.js`：把三個系統對話框拿掉（等同 Firefox／Safari），全程不呼叫任何系統對話框，完成：建立專案、插入兩個零件、存組合件（含同名取代）、存工程圖到子資料夾、從專案重新開啟組合件且零件全部讀到、**刪掉 `createWritable` 後經 worker 存零件**並確認寫入完整且無暫存檔殘留、匯出 zip 並核對內容、匯入後檔案相同、使用中專案拒絕刪除、另一個刪除成功、專案資料夾視窗沒有「選擇資料夾…」。

## 尚未驗證

- 開發機是 Windows，沒有實際在 **Firefox 與 Safari** 執行；上面的瀏覽器驗證是在 Chrome 中移除對應 API 來模擬。`createSyncAccessHandle` 備用路徑在 Chrome 的 worker 中實際執行過，但 Safari 的實作沒有測過。部署到 GitHub Pages 後應在這兩種瀏覽器各開一次（建立專案、存一個零件、重新整理後開啟、匯出）。
