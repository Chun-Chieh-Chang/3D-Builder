# 3D-Builder Agent 自我演化與系統防禦規則庫 (AGENTS.md)

本文件依據全域規則《自主進化與錯誤萃取元規則 (Proactive Self-Evolution Meta-Rule)》建立，記錄在開發過程中萃取出的系統脆弱點、失敗模式、根因分析 (RCA) 與強制執行的防禦 SOP。所有參與本專案的 AI Agent 與開發者必須強制遵守。

---

## 1. 核心盲點萃取：構建者偏差與防禦對抗機制

### 1.1 歷史失敗案例 (2026-10-11 螺牙特徵審查事件)
- **問題現象**：
  1. 多線牙型重疊時觸發布林 Fuse 導致 WASM 記憶體暴增崩潰（`table index is out of bounds`）。
  2. 線數輸入小數（如 1.5）被代碼隱含 `Math.round` 吞掉，掩蓋錯誤。
  3. 螺牙軸支援遺漏草圖中心線，導致 DAG 與介面拋出遺失參考。
  4. 記憶體洩漏測試只計算了 JS 物件 handle 數量，宣稱無洩漏，但未實際量測 Emscripten WASM Heap。
  5. 測試門檻被放寬以規避平行多工下的超時報錯。
- **根本原因 (RCA)**：
  - **構建者偏差 (Builder's Bias)**：實作者沉浸於功能實現的 Happy Path，缺乏對抗性破壞視角。
  - **代理指標謬誤 (Surrogate Metric Fallacy)**：以廉價但無效的指標（JS handles）替代高難度的真實指標（WASM heap）。
  - **防禦性退讓**：為追求測試變綠而妥協門檻。

---

## 2. 強制執行：自我紅隊對抗 SOP (Self-Red-Teaming Protocol)

任何新功能、特徵或核心演算法在聲稱「完成」並提交前，必須強制逐項通過以下「紅隊四問」檢驗，並記錄於 `DEV_LOG.md`：

### 2.1 破壞性邊界四問 (Disruptive Edge-Case Checklist)
1. **輸入破壞 (Input Corruption)**：
   - 是否傳入極端小數、非整數、負數、零、NaN、極大值？
   - **硬性約束**：非法或不合理數值必須在命令層/模型層立即拋出顯式錯誤並說明原因，**嚴禁使用 `Math.round`、`Math.abs` 等自作主張默默篡改用戶意圖**。
2. **拓樸與幾何相交破壞 (Geometric Self-Intersection Defense)**：
   - 在多實體、多線、陣列、厚面、薄殼操作中，相鄰特徵是否可能重疊？
   - **硬性約束**：幾何自相交必須在前置階段透過包圍盒或參數解析攔截（如 $zMax - zMin \ge pitch$ 直接拋出），不得無防禦丟給底層 OCCT 求解器進行災難性布林運算。
3. **依賴鏈完整性 (Dependency Graph Integrity)**：
   - 特徵所依賴的幾何參考（面、邊、頂點、草圖中心線、基準軸、座標系）是否在全鏈路中皆有完整支援？
   - 檢查清單：`schema.ts` -> `commands.ts` -> `refs.ts` -> `dag.ts` -> `engine.ts` -> `PropertyManager.tsx`，缺一不可。
4. **規格真實性與零 Mock 原則 (Zero-Mock & Ground Truth)**：
   - 宣稱符合特定行業規範（如 ISO 80369-7、ISO 286、ISO 4762）時，參數與幾何必須從定義嚴格推導（如 6.00% 錐度在標稱截面必須精確吻合）。
   - 驗收測試必須使用實體探針（物理量測）或真實拓樸萃取（`elementFacts`），**嚴禁在測試中 hardcode 假資料冒充功能通過**。

---

## 3. 測試質量與記憶體防禦硬準則

### 3.1 零代理指標原則 (No Surrogate Metrics) 與真值存在性防呆 (Ground Truth Existence Defense)
- 測試記憶體洩漏時，禁止僅以物件計數（如 `liveHandles`、`meshCount`）宣告無洩漏。涉及 WASM/C++ 底層運算者，必須監控 Emscripten Heap，且**唯一真實指標路徑為 `(oc as any).wasmMemory?.buffer?.byteLength`**。
- **真值存在性防呆**：任何監控底層指標的測試，必須強制先斷言「基準指標存在且大於 0（`expect(initial).toBeGreaterThan(0)`）」，**嚴禁使用 `?? 0` 等靜默退化語意將未定義屬性退化為 0 造成 `expect(0).toBe(0)` 恆真式假綠**。

### 3.2 禁止防禦性空轉閘控 (No Unwired Defensive Gating)
- 核心演算法或精確度升級（如 `massProps` 自適應積分），若引入條件參數（如 `options.adaptive`），必須明確預設值語意（`options.adaptive ?? true`），或在全 repo 呼叫端（Worker、Engine、UI）完整接線。
- 驗收測試必須使用**能實質觸發該分支的邊界對象**（如螺牙 B-spline 自由曲面），並對照「開啟 vs 關閉」的實質數值差異，嚴禁僅以初等退化幾何冒充覆蓋。

### 3.3 測試門檻零妥協原則 (Zero Threshold Degradation)
- 嚴禁為了解決 CI 或本機多工平行測試偶發超時而私自放寬 `setTimeout`、數值誤差容差或將測試設為 `skip`。
- 遇效能瓶頸，必須進行 Profiling 並透過架構隔離或多工解耦解決。

### 3.4 隨機參數壓力測試 (Mandatory Fuzzing Stress Test)
- 任何參數化核心特徵，必須包含 Fuzzing 隨機測試（至少 100~200 組隨機維度組態），確保極端與退化幾何下 0 崩潰、0 記憶體暴增。

### 3.5 底層布林運算之 B-spline 記憶體洩漏（已知限制，以量測為證）
- **量測事實（2026-10-11，壓花 C4.9 開發期間隔離量測）**：`BRepAlgoAPI_Common` / `BRepAlgoAPI_Cut` 只要**任一個運算元帶有 B-spline 面**（例如螺旋掃出實體），每次呼叫即永久佔用 Emscripten Heap：

  | 隔離實驗（各 100 次，每次獨立 Arena 並 `dispose`） | 每次洩漏 |
  |---|---|
  | 圓柱面 + `Geom2d_Line` + `MakeEdge(line, surface)` + `BuildCurves3d` | 0.000 MiB |
  | 6 圈螺旋 spine wire | 0.000 MiB |
  | `BRepOffsetAPI_MakePipeShell`（含 `MakeSolid`） | 0.000 MiB |
  | **掃出實體 ∩ 圓柱（`Common`）** | **8.156 MiB** |
  | **掃出實體自圓柱切除（`Cut`）** | **8.324 MiB** |
  | **掃出實體 ∩ 方塊（`Common`）** | **2.561 MiB** |
  | 兩顆純解析圓柱互 `Common`（對照組） | **0.000 MiB** |

- **結論**：洩漏位於 OCCT 布林運算對 B-spline 運算元的內部處理，**不在本專案的資源所有權**——所有暫存物件皆經 `arena.own()` 且 `finally { arena.dispose() }` 釋放；對照組（純解析幾何）為 0 即為此結論的直接證據。
- **影響範圍**：`Kernel.thread` 每次再生洩漏約 10.0 MiB、`Kernel.knurl`（螺旋）約 11.6 MiB；`Kernel.knurl`（直紋，走 `BRepPrimAPI_MakePrism` 且不與掃出體布林）為 0.00 MiB。此為 T-1 起既有之限制（`kernel.ts` 螺牙 `threadProfileTooWide` 註解已記載「融合重疊螺旋體每次消耗 100~250 MB 且永不歸還」）。
- **現行緩解**：
  1. **產品側**：Worker 記憶體高水位自動重啟（ADR 0126）。`apps/web/src/worker/heap.ts` 以唯一真實路徑讀取堆大小，啟動時取基準；成長超過 `HEAP_GROWTH_LIMIT = 512 MiB` 即由頁面替換 Worker 並重新計算，並通知使用者。決策函式 `shouldRestartHeap` 的門檻以參數提供，使其能在真實量測值上被實質觸發（AGENTS.md §3.2）。
  2. **測試側**：建立數百個螺旋工具的 Fuzz 測試必須獨立成檔（`tests/phase3/thread-fuzz.test.ts`、`tests/phase3/knurl-fuzz.test.ts`），使其取得全新 Emscripten Heap，避免與同套件其他已配置記憶體疊加而越界。
- **量測陷阱（必須遵守）**：洩漏不是從第一次呼叫就線性可見。小螺牙（單線、10 mm）的前十次重建成長為 **+0.0 MiB**，因為洩漏先被堆的既有餘裕吸收；必須以夠大的螺牙（例如 4 線 6 圈）量測，才能看到 +283 MiB／5 次這種真實成長。任何以此為據的門檻或測試都必須先確認「量到的成長不是 0」。
- **補充量測（2026-10-15，D-I5 剖面開發期間）：純平面的布林也會佔用 Heap，只是要量夠久才看得到**。每種情境各自一個全新 Heap、各 1000 次，以唯一真實路徑量測（括號內為 128 MiB 起點的終值）：
  - `BRepAlgoAPI_Cut`（半空間方塊切 40×30×12 方塊，不經 `Kernel.boolean` 的歷史與合併）：約 **0.14 MiB／次**（→ 266 MiB）。
  - 既有的直線剖面 `Kernel.sectionView`：約 **0.25 MiB／次**（→ 382 MiB）；**前 100 次為 +0.0 MiB**——被 Heap 餘裕吸收，正是上方「量測陷阱」。
  - 階梯剖面 `Kernel.sectionViewPath`：約 0.42 MiB／次；對正剖面（多兩次布林）約 1.0 MiB／次。
  - 對照組：`Kernel.topology`、`Kernel.projectView` 單獨 1000 次：**0**；新路徑建立的形狀以 `liveShapes` 驗證全數釋放。
  - 結論：上表「兩顆純解析圓柱互 Common：0.000 MiB」是 100 次的量測，可能同樣被餘裕吸收；**宣稱某運算 0 洩漏前，必須量到超過餘裕（數百至上千次），並附一個量得到成長的對照**。剖面視圖在產品側同樣由 ADR 0126 的高水位重啟限制。
- **補充量測（2026-10-15，ADR 0146 工程圖塗彩）**：每種情境各自全新 Heap、各 **2000 次**等角視圖（40×30×20 板，`transformed` 複本後釋放）：
  - `Kernel.projectView`（隱藏線）單獨：**+25.6 MiB**（約 0.013 MiB／次）——**更正**上一段「`projectView` 單獨 1000 次為 0」：那是被餘裕吸收的結果；零件事先網格化與否結果相同。
  - `Kernel.mesh` 單獨：+0.0；`projectView` 加 `mesh`（塗彩）：**+56.4 MiB**，比單純隱藏線多約 0.015 MiB／次。對照組 1000 次剖面 +366 MiB。
  - 塗彩每次視圖變更只算一次並快取；產品側同樣由 ADR 0126 限制。`tests/phase5/drawing-shade-memory.test.ts` 只斷言 `liveShapes` 與對照組 > 0，成長量印出、**不斷言為 0**。
- **禁止事項**：不得以放寬門檻的方式把此洩漏「測成綠燈」（§3.3）；不得以 JS handle 計數宣稱「無洩漏」（§3.1）。任何未來的架構性解法（例如 Worker Heap 高水位回收）必須以 `(oc as any).wasmMemory?.buffer?.byteLength` 為唯一驗收指標，並附 `expect(initial).toBeGreaterThan(0)` 防呆。

---

## 4. 歷史演化紀錄與修訂日誌

- **2026-10-11（上午）**：初始化本文件。萃取螺牙特徵審查之根因，建立「自我紅隊對抗 SOP」與三大防禦硬準則。
- **2026-10-11（下午）**：萃取 Workbuddy 審查事件（`review-2026-10-11-antigravity-audit.md`）之根因：
  1. 根治 `(kernel.oc as any).HEAPU8?.byteLength ?? 0` 恆真式假綠，確立 Emscripten WASM Heap 真實路徑為 `wasmMemory.buffer.byteLength` 並強制「真值存在性防呆（`> 0`）」。
  2. 根治 `massProps` 防禦性空轉閘控，確立核心精度自適應預設啟用（`adaptive ?? true`），並補齊螺牙實體自適應覆蓋測試。
  3. 更正 `threadStandards.ts` 註解常數，落實 ISO 68-1 牙頂牙根寬度斷言。
- **2026-10-11（壓花 C4.9 開發）**：新增 §3.5。以隔離實驗量測並確立「OCCT 布林運算遇 B-spline 運算元必洩漏 Emscripten Heap」為已知限制，載明量測數據、影響範圍、現行緩解（Fuzz 獨立成檔）與禁止事項，避免後續以代理指標或放寬門檻掩蓋。
- **2026-10-15（D-I5 階梯／對正剖面，ADR 0143）**：§3.5 補充量測。新功能的記憶體測試第一版在測試檔內量到「200 次 +190 MiB」，追查後以全新 Heap、1000 次的隔離實驗確立：成長來自 OCCT 布林本身（裸 `BRepAlgoAPI_Cut` 亦然），既有直線剖面同樣有，且前 100 次會被 Heap 餘裕吸收成 0。據此**未**寫「Heap 不成長」的測試（那會是假綠燈），改以 `liveShapes` 驗證本專案的釋放責任，並把量測寫進 §3.5 與 ADR 0143。
- **2026-10-15（工程圖六項，ADR 0146）**：
  1. §3.5 補充塗彩的隔離量測，並更正「`projectView` 單獨 0」為被餘裕吸收的結果（全新 Heap 2000 次為 +25.6 MiB）。同一 Heap 依序量多種情境會互相干擾（第一版量到「塗彩 +165 MiB」），**比較不同情境時必須各自全新 Heap**。
  2. **多工作階段共用主資料夾的事故**：在 worktree 工作時以 PowerShell 呼叫 .NET `[IO.File]` 並給**相對路徑**，.NET 以行程的目錄（主資料夾）解析，不是 `Set-Location` 的位置，結果改到主資料夾；另一工作階段隨即把那些檔案提交推送。**硬性約束**：在 worktree 中以 .NET 或任何非 PowerShell cmdlet 的 API 讀寫檔案，**一律使用絕對路徑**；改完以 `git status` 同時檢查 worktree 與主資料夾。
  3. 跑整批 e2e 前先確認 9333／5393 沒有被其他工作階段的 `verify-ui` 佔用（同時跑會互相干擾，結果作廢）；單獨過、整批不過的腳本，要先在**不含自己變更的乾淨 worktree** 重現，才能判斷是否為自己造成。
- **2026-10-11（壓花 C4.9 開發）**：更正需求追溯錯誤。`docs/blueprint.md` 之 `C4.9` 實為「裝飾螺紋線」（僅顯示用之虛擬牙線，P2），與真實幾何的壓花特徵無關。本專案對「藍圖外之新增特徵」之既有慣例為**撰寫 ADR**（如螺牙特徵之 ADR 0123，未佔用任何藍圖編號），壓花特徵比照辦理並改以 ADR 0124 追溯。
