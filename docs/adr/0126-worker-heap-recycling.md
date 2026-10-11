# ADR 0126：幾何核心的記憶體高水位自動重啟（Worker Heap Recycling）

- 狀態：**已完成**。
- 需求追溯：本 ADR。為 `AGENTS.md` §3.5 所載「已知核心限制」的產品側緩解。

## 背景

底層 OCCT 的布林運算，只要任一個運算元帶有 B-spline 面（螺旋掃出的螺牙或壓花實體，以及把它切齊到長度的那一次 `common`），
每次呼叫即永久佔用 Emscripten Heap **2.5~8.3 MiB 且永不歸還**。以本專案的特徵計：
`Kernel.thread` 每次再生約 **10.0 MiB**、螺旋 `Kernel.knurl` 約 **11.6 MiB**、直紋 `Kernel.knurl` 為 **0.00 MiB**。

隔離實驗（各 100 次、每次獨立 `Arena` 並 `dispose`）已確立洩漏位於 OCCT 內部而非本專案的資源所有權：同樣的布林運算，
換成兩顆純解析圓柱互 `Common` 即為 **0.000 MiB**（對照組）。完整量測見 `AGENTS.md` §3.5。

後果：一個含螺牙或螺旋壓花的零件被連續編輯數十次之後，核心會把堆記憶體用盡，Worker 在重新計算途中直接崩潰
（實測 `RuntimeError: memory access out of bounds`）。

## 決定

1. **量測指標只採唯一真實路徑**（AGENTS.md §3.1）：`(kernel.oc as any).wasmMemory?.buffer?.byteLength`，
   由 `apps/web/src/worker/heap.ts` 的 `heapOf(oc)` 讀取；讀不到時回傳 `null`，**不以 0 或任何代理值代替**。
2. **在 Worker 啟動時取基準**：`boot()` 於 `Kernel.load()` 之後、任何幾何運算之前記錄 `heapBase`。
   決策以「相對基準的成長量」為準，而非絕對值——這正是「漏了多少」的直接量度，且不受不同初始堆大小影響。
3. **門檻 `HEAP_GROWTH_LIMIT = 512 MiB`**：以實測 10~12 MiB／次計約為四十次重新計算；128 MiB（啟動時的堆）加上此值仍遠低於模組可成長的上限，
   因此核心永遠不會是先耗盡的一方。不設得更小，是因為重啟並非免費（要重新載入 43 MB WASM 並重建零件）。
4. **門檻以參數形式提供**：`shouldRestartHeap(current, base, limit = HEAP_GROWTH_LIMIT)`。
   產品走預設值；測試得以用「真實量測到的成長量」搭配一個測試可觸及的門檻，實質觸發該分支（AGENTS.md §3.2）。
5. **讀不到或不可信的數字一律不動**：`current`／`base` 為 `null`、非有限數、或 `base ≤ 0` 時回傳 `false`，
   避免在核心尚未啟動（堆未知）時誤殺一個健康的 Worker。
6. **由頁面側執行重啟**：`RebuildPayload` 新增 `heapBytes` 與 `heapBase` 兩個欄位（與 `totalMs` 同一時機取樣，不增加來回），
   `store.ts` 的 `run()` 在**結果已顯示之後**呼叫 `recycleIfHeapHigh()`；一旦超標即
   `restartWorker()`（既有機制，原用於逾時卡住的重新計算）並**立刻重新計算**，使視窗不會空著，並以
   `worker.heapRecycled` 通知使用者。
   - 之所以在結果之後而非之前：文件在頁面上，重啟只損失時間；先顯示結果再重建，使用者不會看到空白畫面。
   - 之所以不會無限迴圈：重啟後 `heapBase` 重新取樣，而一次重新計算的洩漏遠低於 512 MiB。

## 為何不是其他做法

| 做法 | 為何不採 |
|---|---|
| 修好洩漏本身 | 洩漏在 OCCT 的布林運算內部（對照組證明非本專案所有權問題），無 API 可關閉 |
| 避免使用布林（改寫螺旋路徑） | 螺牙的兩端漸縮包絡與壓花的切齊都需要它；改寫屬行為變更（另見 ADR 0124 待決事項第 2 點） |
| 以 JS handle 計數或 `liveShapes` 代替 | AGENTS.md §3.1 明文禁止的代理指標；先前正是以 `HEAPU8 ?? 0` 造成恆真式假綠 |
| 放寬／跳過會觸發洩漏的測試 | AGENTS.md §3.3 明文禁止的門檻妥協 |
| 每次重新計算都重啟 | 43 MB WASM 重載的延遲會蓋過一切；洩漏量與重啟成本相比不值得 |

## 驗收

`apps/web/test/heap.test.ts`（3/3 PASS）：

1. **指標真實性與防呆**：對真實 `Kernel` 斷言 `heapOf(kernel.oc) > 0`（真值存在性防呆），
   並逐一拒絕 `null`、`undefined`、`{}`、`{wasmMemory:{}}`、`{wasmMemory:{buffer:{}}}`、`byteLength: 0`、`NaN`、字串。
2. **門檻邊界**：超標為 `true`、**恰等於門檻為 `false`**、未達為 `false`；`null`／`NaN`／`base = 0`／`limit = 0` 一律 `false`。
3. **以真實洩漏觸發**：以 4 線 6 圈的螺牙實測 5 次重新計算，量得真實堆成長 **+283 MiB**
   （斷言 `> 64 MiB`），並在此**實際量測值**上斷言「以 `delta/2` 為門檻時，成長後觸發、基準時不觸發」。
   同檔並記錄：單線小螺牙的前十次重建成長為 **+0.0 MiB**（被堆的既有餘裕吸收），故門檻必須以夠大的螺牙量測——
   這也說明為何此測試不能只用小螺牙。

**未涵蓋**：真正替換 Web Worker 的那一步需要瀏覽器環境（Comlink + `new Worker`），現有測試框架不含 Worker 執行環境，
故以「決策函式在真實量測值上的行為」作為驗收，接線本身（`run()` → `recycleIfHeapHigh()` → `restartWorker()`）以程式碼審閱確認。
此為本 ADR 明確的驗證邊界，不以任何代理指標宣稱已端到端驗證。
