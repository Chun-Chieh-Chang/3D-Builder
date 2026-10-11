# ADR 0124：壓花特徵（零件 Schema 53 → 54）

- 狀態：**已完成**。
- 需求追溯：**本 ADR**。藍圖 `docs/blueprint.md` 之 `C4.9` 為「裝飾螺紋線」（僅顯示用之虛擬牙線，P2），**與本特徵無關**，不得作為追溯編號；比照螺牙特徵之慣例（ADR 0123，不佔用藍圖編號）。

## 背景

工程圖上出現 Ø10 對邊六角、Ø7.73 凸耳、Ø6.25 短肩、Ø2.71 防轉凸塊等「需要握持面／防滑面」的零件，而本專案對「壓花（knurl，滾花）」**完全沒有幾何能力**——全庫唯一的螺旋體僅存在於 `Kernel.thread()` 內部。經評估為真實能力缺口，本 ADR 補齊。

## 決定

1. **零件 Schema 版本由 53 升至 54**，為空轉向前相容遷移（`53: (doc) => doc`）。舊檔照常開啟。
2. **新增 `KnurlFeature`**（`schema.ts`），繼承 `FeatureBase`：
   `axis: Id | Ref`（圓柱／錐面、直線邊、基準軸或草圖中心線）、`diameter: Expr`（胚料外徑）、`length: Expr`、`count: Expr`（圓周上的溝數）、`depth: Expr`（溝深）、`pattern: 'straight' | 'helical' | 'diamond'`、`angle?: Expr`（螺旋角，僅 helical／diamond）、`included?: Expr`（V 溝夾角，預設 90°）、`hand?: 'right' | 'left'`、`phase?: Expr`、`reverse?: boolean`。
3. **核心 `Kernel.knurl(spec): OpResult` 一次只做「一隻手」**（`pattern: 'straight' | 'helical'`）。**菱形（diamond）＝兩隻手依序各切一次**，因為單一工具同時容納兩隻手時，兩手的實體互相交錯，OCCT 無法解析（見下方量測證據）。
   - 數學依據：`body \ (A ∪ B) = (body \ A) \ B`，兩次依序切除與一次聯集後切除結果完全相同，但前者是 OCCT 能正確處理的形態。
4. **菱形成本護欄**：`RegenEngine` 對 `pattern === 'diamond'` 且 `count > KNURL_MAX_DIAMOND_GROOVES (= 40)` 直接拒絕（`feature.knurlDiamondTooFine`）。理由：第二隻手的每個牙側都要與第一隻手的每一道溝相交，成本約隨溝數平方成長（實測 6→5.7 s、12→22.5 s、18→53.4 s、24→103.3 s）。此為**前置攔截**，不將災難性布林運算丟給 OCCT（AGENTS.md §2.1 第 2 問）。
5. **幾何自相交前置攔截（AGENTS.md §2.1 第 2 問）**：以胚料圓周節距與 V 的幾何寬度比較，
   `spacing = pattern === 'straight' ? 2πr/count : (2πr/count)·tan(angle)`，
   `half = (depth + KNURL_OVERSHOOT·depth)·tan(included/2)`；
   若 `!(2·half < spacing)` 即拒絕（`feature.knurlTooDeep`），並以
   `deepest = spacing / (2·(1 + KNURL_OVERSHOOT)·tan(included/2))` 明確告知使用者可用的最大深度。相鄰溝若重疊，幾何上互為自相交，物理上不是壓花。
6. **直紋路徑與螺旋路徑分離**：
   - 直紋：V 斷面沿軸向 `BRepPrimAPI_MakePrism` 長出（**無布林運算**）。
   - 螺旋：沿用螺牙的螺桿運動——在圓柱參數空間放一條 `Geom2d_Line`，每整圈一個 `MakeEdge` + `BuildCurves3d`，`BRepOffsetAPI_MakePipeShell` 以 binormal 固定為軸向掃出，再與圓柱取 `common` 切齊兩端。
   - 一份 V 斷面只掃出一次，其餘 `count − 1` 道以 `gp_Trsf.SetRotation` 複製（`BRepBuilderAPI_Transform`），避免重複昂貴掃出。
7. **持久命名**：螺旋面 `@knurl<hand><groove>:<turn>`（`<hand>` 為 `L`／`R` 或空字串，`<turn>` 0 為斷面所在圈）；直紋面 `@groove<n>`；兩端平面為 `cap`。命名隨複製一併改寫，使 TNP 於參數變更後仍可追蹤。
8. **接線涵蓋**：`schema.ts`、`params.ts`（`knurlCount` 角色，`MIN_GROOVES = 3`／`MAX_GROOVES = 200`）、`refs.ts`（軸向參考重寫）、`dag.ts`（`parentsOf`）、`commands.ts`（`setKnurl` 與建立驗證）、`regen/engine.ts`（`knurl()` 分派、成本護欄、錯誤訊息轉譯）、`kernel.ts`、`PropertyManager.tsx`（`KnurlPanel`）、`Icon.tsx`、`strings.ts`、`actions.ts`、`store.ts`（`newKnurl()`）、`help/topics.ts` 與 i18n `help.ts`、`patterns.ts`（`SEED_TYPES`）、`serialize.ts`（版本遷移）、中英 i18n `features.ts`／`ui.ts`／`model.ts`。

## 量測證據（紅隊對抗所依據）

1. **「單一工具含兩隻手」不可行**：菱形以單一工具（48 個實體）布林時，結果 `valid=true` 但 `solidCount = 25`、B-rep 體積 **恰等於未切除的圓柱**（2261.9467），即**什麼都沒切掉**。改用 `BRepAlgoAPI_Cut(body, compound)` 亦同。多運算元 BOP（`SetArguments`／`SetTools`）嘗試亦失敗（48 工具耗時 574.6 s 且退化為 `tris=236`；2 工具直接 FAILED），已回退。
2. **兩次依序切除正確且流形**：單隻手切一次焊接後 `hist=[[2,6405]]`（封閉流形）；再切第二隻手 `hist=[[2,12294]]`。
3. **逐溝依序切除（48 次單實體）會撐爆 WASM Heap**（`除料失敗：memory access out of bounds`），故採「一次掃出 + 複製 + 兩次整手切除」。

## 已決定事項（原「待使用者決定事項」）

1. **OCCT 布林運算遇 B-spline 運算元必洩漏 Emscripten Heap**：實測每次布林 2.5~8.3 MiB 永不歸還（隔離實驗與完整數據見 `AGENTS.md` §3.5）。此為 T-1 起既有之限制，`Kernel.knurl`（螺旋）每次再生約 11.6 MiB、`Kernel.thread` 約 10.0 MiB、`Kernel.knurl`（直紋）為 0.00 MiB。
   → **已決定（2026-10-11）**：於 Worker 層導入 Heap 高水位回收，見 **ADR 0126**。此為產品層緩解，未改動幾何。
2. **螺旋路徑可否免去「切齊兩端」的布林**：理論上若掃出 spine 恰好跨 `[from, to]`（非整圈），掃出體兩端自然平切於該二平面，即可省去一次 `common`（同時省去該次洩漏與大部分耗時）。此變更會改動溝的角相位與 `<turn>` 命名，屬行為變更，未經使用者同意不動。
   → **已決定（2026-10-11）：不做。** 先以驗證腳本 `spikes/occt-gaps/knurl-trim.test.ts` 確認兩者是否等價，結論是**不等價**，見下節。

### A2c 驗證結論：兩種做法**不等價**，維持現行「掃整圈 + 切齊」

腳本 `spikes/occt-gaps/knurl-trim.test.ts`（4 個測試，離線 spike，不入 `npm test`）。先在**同一環境**複製現行路徑，確認複製品與正式 `Kernel.knurl` 的體積相對誤差 **3.86e-13**，再據此比較。

| 量測 | 數值 | 意義 |
|---|---|---|
| 中間段 `[from+1, to−1]` 的 `Common(a,b)/volume(a)` | **1.000000000** | 兩條路的溝在中段**完全同一** |
| 同上，spine 細分 18／36／72 段 | **1.000000000**（三者相同） | 殘差**不是**離散化誤差 |
| 整體 `[from, to]` | 0.984292944 | 差異全部落在兩端 1 mm 內 |
| 起端窗 `[from, from+1]` | 0.937171852 | 起端不同 |
| 末端窗 `[to−1, to]` | 0.937171749 | 末端不同（與起端**對稱**） |
| 負控制：不加相位修正 | 0.027103 | 相位修正是**對的**（`θ = +2π·from/lead`） |
| 負控制：偏半個節距 | 0.000000 | 比較法有鑑別力 |
| 全體積 a／b | 23.187830203／23.187830275 mm³ | 體積相同到 **3.1e-9** 相對 |
| `[from, to]` 內體積 a／b | 23.187830／22.823618 mm³ | b 在帶內**少切** 0.364 mm³，該量落在帶外 |

**判讀**：新路徑**體積守恆**但**分佈改變**——溝的 V 斷面越過兩端，而非被切齊；且掃出的起點正好落在 `from`，會把 `MakePipeShell` 起點的退化段（斷面平面含 spine 切線）**顯露出來**，而現行路徑靠「退後整圈再切齊」把它裁掉。

**後果（決定性）**：現行做法讓壓花帶恰好是 `from..to`；新做法會讓帶長多出約 `half = (depth + 0.25·depth)·tan(included/2)`（本案 0.375 mm）。對照工程圖的「20±0.1 壓花」，新做法**直接超出公差**。

**因此**：省下的一次 `common` 雖然實測占單手建構 **110 ms / 118 ms（94 %）**、並省去一次 8.16 MiB 洩漏（`AGENTS.md` §3.5），但那是**幾何變更**而非最佳化。**不做。**

## 驗收成果

- `tests/phase3/knurl.test.ts`：**15/15 PASS**（直紋對「被胚料圓截斷的 V 截面」之積分 1e-5、淺溝退化的平面公式 <0.5%、螺旋對 `count·(2π/lead)·A·ρ̄·L` 閉式解 1e-5、菱形對「兩隻手角度區間聯集」之定義積分 <1%、單手 < 菱形 < 兩手相加、九類拒絕訊息、STEP 往返 <1e-5、封閉網格體積 <1%）。
- `tests/phase3/knurl-fuzz.test.ts`：**1/1 PASS**，120 組隨機組態 0 崩潰（`made + refused === 120`，`made > 60`）。
