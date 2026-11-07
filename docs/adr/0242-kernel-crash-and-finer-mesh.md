# ADR 0242：幾何核心崩潰後換新重算，與重新網格化從頭算

日期：2026-11-07。狀態：已實作。

## 背景

OCCT 可能讓 WebAssembly 模組陷阱（trap）。已知實例：`BRepOffsetAPI_MakeOffset` 內縮同心整圓的環（`docs/design/section-clearance/regions-and-cost.md`）。使用者決定（21 題 Q07）：自動換新 Worker 並重算，並通知；連續崩潰就停下來說明，指出是哪個特徵。

## 查到的事實

**陷阱原本到不了頁面。** `Kernel.build()` 把所有例外包成 `KernelError`，引擎 `engine.ts` 再回報成特徵的 `regen.internal`，然後**繼續在已損毀的模組裡算下去**。網格、質量、量測裡的陷阱也不會換 Worker。所以只改頁面沒有用，要先讓偵測成立。

**探針（真實陷阱，`probe-trap`）：**

- `stackSave`、`stackRestore`、`_emscripten_stack_get_current`、`wasmExports`、`asm` 都不存在。原本想用「堆疊指標沒有歸位」事後偵測被吞掉的陷阱，**這個版本做不到**。
- 真實陷阱是 `RuntimeError: function signature mismatch`（瀏覽器的 V8 版本寫成 `null function`，是同一個陷阱），`instanceof WebAssembly.RuntimeError` 為真。OCCT 的一般失敗仍是 `KernelError`（`Standard_Failure: ...`）。兩者可以區分。
- 陷阱之後同一個模組在這一次檢查中仍算對（伸長體積 461.8141，與預期相同）。這只是一個樣本，不代表可靠：解構子沒有執行、堆疊指標沒有歸位。**一律換新**。

## 決定

### 1. 陷阱不得被吞掉

- `@3db/kernel` 新增 `KernelCrash`、`isTrap`、`rethrowTrap`。`isTrap` 涵蓋 `WebAssembly.RuntimeError`（含 Emscripten 的 abort）、`KernelCrash`，以及訊息含 call stack 的 `RangeError`（堆疊溢位）。
- `errorText` 遇到陷阱直接往外丟，所以向它要訊息的地方不必各自處理。其餘會「吃掉例外繼續走」的 30 處 `catch`（核心 11、引擎與 regen 13、Worker 6）第一行都是 `rethrowTrap(e)`。
- **守門測試** `tests/phase3/crash-no-swallow.test.ts` 讀 `packages/kernel/src`、`packages/regen/src`、`kernel.worker.ts` 的原始碼：之後新增的 `catch` 如果會吞掉預期之外的東西，測試就紅，並指出行號。專案的 TypeScript 7 沒有 JS 編譯器 API，所以用自己的小掃描器（遮掉字串與註解後配對大括號），它本身也有紅綠對照的測試。

### 1b. 兩處已知的陷阱仍是拒絕

全量測試推翻了第一版「陷阱一律是崩潰」：有兩處陷阱是 OCCT 平常的回答，而且使用者要的東西有答案：

- `toBSpline`：B 樣條轉換器遇到偏移曲面的某些面會陷阱，輸出 STEP 依此改寫原樣並警告（ADR 0067）。
- `importIges`：壞掉的 IGES 檔，模糊測試 200 個裡有 33 個陷阱（`memory access out of bounds`）。

一律當崩潰的話，輸出 STEP 就會失敗，壞檔也不再是「讀不了」。所以這兩處（`refusalWords`）照舊回報原本的錯誤，但計入 `Kernel.trapsAbsorbed`，守門測試鎖定只有這兩處。

模組既然受過陷阱，就要離開它：重建結果帶著這個計數，頁面先顯示結果，再換 Worker 並重算一次。文件本身會陷阱時（例如文件裡有壞的 IGES），新 Worker 也會再陷阱，同一份文件不再換第二次，避免循環；一旦有乾淨的結果，紀錄就清除。MCP 則在下一次重建前換新核心。

**限制**：換新發生在下一次重建之後。輸出 STEP 之後、下一次重建之前的查詢仍在受過陷阱的模組裡（與 ADR 0067 以來相同）；組合件沒有這個重建路徑，同樣維持原狀。模糊測試在同一個模組裡經過多次陷阱後，仍能把好檔案讀回相同體積，這是一項證據，不是保證。

### 2. 引擎停下並指出特徵

特徵的 `catch` 收到陷阱時，不再標記該特徵失敗，而是丟出帶特徵名稱的 `KernelCrash`。一般的 `FeatureError`、`KernelError` 行為不變。

### 3. 頁面換新並重算

- Comlink 只傳送錯誤的 name、message、stack，所以靠 name 辨識。Worker 的 API 全部包在 `reportingCrashes` 裡，任何呼叫（不只重建）的陷阱都標成崩潰。`apps/web/src/worker/crash.ts` 不含核心，頁面可以直接用（頁面不載入 WASM）。
- 頁面所有 Worker 呼叫都經過同一個 Proxy，崩潰只在 `watchingForCrash` 一處處理，呼叫端都不用改。呼叫端仍會收到這個拒絕，照自己的方式回報。
- 第一次崩潰：換 Worker、通知、重算（組合件是重新載入）。
- 第二次崩潰之間沒有完成過任何重建：換 Worker、通知並指出特徵，**不再自動重算**。畫面保留上一次的結果。使用者下一個動作（編輯、復原、重新計算）會再試一次。
- 完成一次重建（組合件是所有零件讀完）後計數歸零。

### 4. AI 工作階段

MCP 的工作階段同樣換新核心（`kernelRestarts` 會加一）：重建中的陷阱由 `rebuild` 自己換，其他工具的陷阱由 `callTool` 換新後重建目前的零件，並把錯誤回報給呼叫者。

### 5. 重新網格化（併入此項，使用者決定）

向已有粗網格的形狀要更細的網格時，BRepMesh 從粗網格修補。波浪樣條面實測 54 s、3312 MiB，直接算只要 2.3 s、265 MiB；工程圖或 STL 對畫面上的零件就會走到這條路。

`Kernel.mesh` 記下每個形狀要求過的最細容差：

- 要求更細：先 `BRepTools.Clean` 再網格化。修正後由粗到細為 89013 個三角形、約 2.3 s、堆 266 MiB，與直接算的三角形數及頂點座標完全相同。
- 第一次網格化但面上已經有網格（布林運算沒動到的面，帶著來源形狀的網格）：細度不明，同樣先清掉。
- 同樣細度或更粗：不動，形狀仍保留最細的網格。

**第一版被探針推翻**：原本想比較面上的 `Poly_Triangulation.Deflection()`，免得另外記錄。實測它存的是量到的偏差，不是要求的精度（要求 0.01 的波浪面存的是 0.172，要求 0.1 的存 1.29），比較的結果是同精度也清掉、由細到粗也變粗。另外 `Kernel.transformed` 的複本不帶網格，不是共用面的情況。

本決定修正 ADR 0074 第 2 點「同一個形狀的網格只做一次」：這只在由細到粗時成立。

## 刻意不做

- **換 Worker 時，其他進行中的呼叫不會收到回應**：Worker 被終止後，Comlink 的待決 promise 永遠不結束。這是 `restartWorker` 既有的行為（重建逾時也是），例如同時開著的對話框可能一直顯示計算中。本次沒有改：全部拒絕的話，`void this.api.x()` 這類不接結果的呼叫會變成未處理的拒絕。若實際遇到再處理。
- **連續崩潰時不跳過該特徵繼續算**：使用者決定的是停下來說明。代價是：開啟一個會崩潰的檔案時，第一次就沒有結果可保留，畫面會是空的，要靠抑制特徵或復原才能往下走。
- **不偵測 Worker 被瀏覽器直接殺掉**：重建逾時仍會處理（ADR 0126 的路徑）。
- PlaneGCS 求解器（`packages/sketch`）內部的 `catch` 不在守門範圍。它的陷阱只要傳到引擎或 Worker 外層，同樣會被處理。

## 驗證

- `tests/phase3/crash-real-trap.test.ts`：真實陷阱。區分一般失敗、穿過 `build`、重建停下並指名特徵（對照組：`KernelError` 只標記特徵）、穿過真實 Comlink 仍是崩潰。
- `tests/e2e/phase3-worker-crash.js`：先在**真實 Worker** 裡觸發真實陷阱並穿過真實 Comlink；頁面流程則在 Worker 呼叫的回應處交入崩潰（目前沒有已知會在真實重建的特徵裡陷阱的零件；輸出與匯入路徑上的兩處見 1b），換 Worker、重算與第二個 Worker 都是真的。
- `tests/phase3/mesh-finer.test.ts`：堆大小以唯一真實路徑量測。

**沒有驗證到的**：真實重建過程中的陷阱一路到真實頁面的完整流程，因為沒有已知能觸發它的零件；這段是分開驗證後接起來的。
