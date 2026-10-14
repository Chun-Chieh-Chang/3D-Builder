# ADR 0135：「關閉伺服器」按鈕徹底結束開發中的系統（Schema 不變）

- 狀態：**已實作並驗證**。來源：使用者要求「新增關閉伺服器按鈕，系統啟動後按下此按鈕即可徹底關閉本系統、斷開本系統所有的連結」。與 [ADR 0118](0118-dev-auto-close.md)（無人連線時自動結束）互補：那個是伺服器自己走，這個是使用者按一下就整套停。

## 範圍與前提

- 這是**開發工具**，不是產品功能：只有在開發伺服器（`npm run dev`、`npm run dev:auto`）才有意義。正式 build（`vite build`）與 Tauri 桌面版沒有要停的 Node 伺服器，按鈕不出現（`import.meta.env.DEV` 為 false 時 `ShutdownButton` 回傳 null）。

## 做法

1. **伺服器端**：`apps/web/dev/shutdown.ts` 是只在開發伺服器載入的 Vite 外掛（`apply: 'serve'`）。它攔一個 `POST /__3db/shutdown`（路徑是頁面與外掛共用的契約）：先回 200，再逐條 `terminate()` Vite 為每個開著的分頁留的熱更新 WebSocket（`server.ws.clients`，底層 `client.socket`），然後 `server.close()` 並 `process.exit(0)`——與 ADR 0118 相同的「關閉再結束行程」，只是由頁面請求觸發而非寬限逾時。
   - 只用 `POST`：連結、預取、重整都不會誤觸。是否為關閉請求是純函式 `isShutdownRequest(method, url)`，可在無伺服器下單元測試。
2. **頁面端**：`store.shutdown()`（`store.ts`）先設 `shuttingDown` 狀態（畫面隨即顯示關閉覆蓋層），再 `worker.terminate()` 斷開幾何核心 worker 的連線，最後 `fetch('/__3db/shutdown', { method: 'POST' })`。fetch 被拒是預期的——伺服器正在關閉、已無人回應；已用 try/catch 收掉。
3. **介面**：`ShutdownButton` 放在指令列的說明按鈕旁（僅 dev 顯示）；按下後 `ShutdownOverlay` 以高於所有對話框的覆蓋層（z-index 1000）蓋住整個畫面，顯示「本系統已關閉」，分頁不再可互動，直到使用者關掉分頁並重新 `npm run dev`。
4. **i18n**：四個鍵 `shutdown.button/tip/closedTitle/closedBody` 進 `packages/i18n/src/zh-TW/ui.ts` 與 `en/ui.ts`，符合 D9.1（介面文字走 `t()`，`check-i18n` 綠燈）。

## 驗證

- 單元測試 `tests/phase8/shutdown.test.ts`（5 項）：`POST` 到關閉路徑（含查詢字串）算；僅 `GET`/其他方法不算（連結、預取、重整不觸發）；`POST` 到別的路徑或只是前綴相同都不算；缺 method 或 URL 不算（防禦）。
- 靜態：`npm run typecheck`、`lint:rules`、`lint:deps`、`lint:i18n` 全綠；i18n 目錄測試（placeholder 一致性）通過。

## 限制

- 只管 Vite 開發伺服器；桌面版（Tauri）自帶畫面，不用伺服器，按鈕不出現。
- 伺服器結束後還開著的分頁是死的（顯示關閉覆蓋層），要重新 `npm run dev`；與 ADR 0118 相同。
- 徹底關閉包含幾何核心 worker：正在進行中的重建隨之中斷，但文件在頁面上，重啟後仍在（未儲存的內容受既有的 autosave/復原機制保護，與此按鈕無關）。
- 斷的是「這個 dev server 與它的 worker」；同一台機器上跑的其他專案或服務不受影響。
