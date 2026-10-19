# ADR 0167: 變化半徑圓角 (Variable Radius Fillet, C5.2)

## 狀態
- 狀態: 提案通過並實作中 (Accepted & Implementing)
- 日期: 2026-10-19
- 標籤: `fillet`, `variable-radius`, `c5.2`, `rounds`

---

## 1. 背景與動機 (Context & Motivation)
依據產品藍圖 `docs/blueprint.md` 之 **C5.2 圓角：變化大小（P2 待辦池）**：目前 `FilletFeature` 只有一個 `radius: Expr`，對整條邊（或選面展開出的所有邊）套用**同一個**半徑。2026-10-06 的面圓角計畫（`docs/fillet-by-face-plan.md`，F-0～F-4）明確把「變數半徑」列為「這次不做」，留待本案：

1. **真件需求**：肋、肩部、把手類幾常見「圓角大小漸變」——端點小半徑收邊、中段較大半徑過渡，單一半徑要麼碰撞、要麼過陡。
2. **SW 比照**：SolidWorks 的變化半徑圓角以「控制點（位置＋半徑）」描述每條邊，半徑沿邊插值演化；我們已有固定／面／完整三種圓角（ADR 0097、0098），差這一塊。
3. **資料哲學一致**：資料只存使用者選的東西（邊在重算時由面展開——ADR 0097）。變化半徑沿用同一哲學：**控制點存在特徵上，綁到使用者揀的邊（持久名稱）**；面展開出的邊沒有控制點，維持 `radius`。

## 2. 幾何與數學模型 (Mathematical Foundations)

### 2.1 滾球涵包與半徑演化律
固定半徑圓角是「半徑 r 的球沿邊滾動、與兩側面相切」的涵包。變化半徑就是把球半徑換成沿邊的函數：在邊的規範化參數 $t \in [0,1]$（起點到終點）給定控制點 $\{(t_k, r_k)\}$，其間**線性插值**（OCCT `BRepFilletAPI_MakeFillet::Add(NCollection_Array1<gp_Pnt2d>, edge)` 的語意：X=相對參數、Y=半徑，插值演化）。

90° 凸邊上，半徑 $r$ 的滾球截面每單位長度去掉的材料為：

$$\Delta A(r) = r^2 - \frac{\pi r^2}{4} = \left(1 - \frac{\pi}{4}\right) r^2$$

沿邊積分即總去除體積（直邊、兩側面夾角不變時精確成立；端點處圓弧面即端半徑的角截面，無端點修正項）。

### 2.2 為什麼控制點必須含兩端
OCCT 的半徑演化律只在給定參數範圍內有定義。若控制點漏掉 $t=0$ 或 $t=1$，律在範圍外的行為未定義（向外延擺）。**每條變化邊的控制點必須以 $t=0$ 與 $t=1$ 起訖**，由指令層與引擎層雙重把關，缺一端即明確拋錯，不默默外插。

### 2.3 命名不變性
沿用固定半徑的路徑：`Kernel.fillet` 的 `faceOrigins`（新圓角面掛在來源邊上）→ `nameElements(..., { role: 'fillet' })`。變化半徑不改變命名輸入，改半徑、改控制點都不動其他面的持久名稱。

## 3. 資料模型 (Data Model)

零件 Schema **65 → 66**，`FilletFeature` 新增選用欄位：

```ts
/** A control point of a variable-radius fillet (C5.2, v66): which radius where along which picked edge.
 *  `t` is the position along the edge, 0 at its first vertex and 1 at its last; `radius` is an expression
 *  like the feature's own radius. A variable edge's points start at t = 0 and end at t = 1. */
export interface FilletVariablePoint {
  edge: string;   // the persistent name of one of the feature's `edges`
  t: number;      // 0..1 along that edge
  radius: Expr;
}
```

- `FilletFeature.variable?: FilletVariablePoint[]`——**出現即為變化半徑模式**（等同 SW 的核取方塊），不存在或空陣列＝固定半徑（舊檔照讀，行為不變）。
- 每條變化邊以 `edge` 分組；同一邊的控制點依 `t` 排序使用。
- `kind`（固定／面／完整）維持三種不變——**變化半徑只屬於固定種類**：面圓角與完整圓角的半徑由面組決定，沒有逐邊半徑可言。切到 face/full 時面板清空控制點。

### 3.1 指令
`setFilletVariable: { featureId; points: FilletVariablePoint[] }`——整包替換（面板的新增／改值／刪除都經由它，與 pattern 面板改 `def` 的慣例一致）。檢驗：
- 每點的 `edge` 必須是 `f.edges` 之一（**只綁使用者揀的邊**；面展開出的邊在重算時才存在，綁不住）；
- 每邊：`t ∈ [0,1]`、無重複 `t`、最小 `t = 0` 且最大 `t = 1`；
- `radius` 為合法長度表達式（走 `checkExprs` 同一套求值）；
- `points` 為空＝回固定半徑。

`setEdges`（增刪邊）連帶**放手**：邊被移除時，綁在它上的控制點一併刪掉（過期即放手，不猜——與 `viewPick` 不變式同律）。

### 3.2 UI（PropertyManager 圓角面板）
- 「圓角種類」不變；其下加「變化半徑」核取方塊。開啟時為每條已揀邊建兩個端點（t=0、t=1，半徑取當下 `radius`）。
- 控制點表依邊分組：位置用滑桿（0..1，step 0.01）＋數值顯示，半徑用 `ValueInput`（表達式），每點可刪；每邊一個「在中點新增控制點」。
- 提示文字：半徑沿邊在控制點之間線性變化；端點控制點決定邊兩端的半徑。

## 4. 引擎與核心 (Engine & Kernel)

- `Kernel.fillet(target, edgeIndices, radius, laws?)`：`laws` 為 `Map<edgeIndex, { t, r }[]>`；有律的邊走 `Add(UandR, edge)`，其餘走 `Add(radius, edge)`（同一 `MakeFillet` 混用兩種 Add 是 OCCT 支援的逐邊描述）。三種 fillet shape（Rational/QuasiAngular/Polynomial）與 `valid()` 檢查不變。
- 引擎 `fillet()`：把 `f.variable` 按持久名稱對回邊索引、`evalLength` 求值、按 `t` 排序後傳入；邊已不存在（遺失參考）其控制點自然無人使用。
- **不做半徑折半救援**：`roundEdges` 的折半救援是為單一半徑設計的（「最大的可行半徑是多少」）；變化半徑沒有這個問題，OCCT 失敗即拋原始錯誤。
- 引擎層二次把關（檔可能是手改的）：每邊端點齊全、`t ∈ [0,1]`、`r > 0`，缺一即 `FeatureError` 明說。

## 5. 自我紅隊四問 (Red Team Review)

1. **會不會默默做錯？** 不會：端點缺失／`t` 越界／半徑非正都在指令層與引擎層被拒；OCCT 只回答「成功」或丟擲，不靜默退化。
2. **會不會被動態模型破壞？** 控制點綁持久名稱：邊沒了就放手（連帶 `setEdges` 清理）；面新增的邊一律固定半徑（本來就沒有它的控制點）。
3. **舊檔怎麼辦？** `variable` 缺席＝固定半徑，行為位元級不變；新欄位舊程式讀到會照格式規則拒絕（升版慣例）。
4. **手算對得上嗎？** 驗收有手算真值（§6）；蒙地卡羅式「改一個數、量一次體積」不成為唯一證據。

## 6. 量化驗收 (Acceptance)

| # | 情境 | 預期 |
|---|---|---|
| 1 | 40×30×12 方塊，長邊（40）變化半徑 r(0)=2、r(1)=6 | 體積 $14400 - (1-\pi/4)\cdot\int_0^{40}(2+0.1x)^2dx = 14400 - (1-\pi/4)\cdot\frac{2080}{3} \approx 14251.209$ |
| 2 | 同一邊三控制點 t=0,0.25,1 → r=2,4,6 | $14400 - (1-\pi/4)\cdot\left[\frac{10\cdot28}{3}+\frac{30\cdot76}{3}\right] = 14400 - (1-\pi/4)\cdot\frac{2560}{3} \approx 14216.873$（檢驗插值位置） |
| 3 | 兩端同半徑（2,2） | 與 `Kernel.fillet(…, 2)` 固定半徑結果一致（律退化＝常數） |
| 4 | 漏端點／`t` 越界／`r ≤ 0`／綁到未揀邊 | 指令層 `CommandError`；手改檔過引擎層 `FeatureError`；都不動文件 |
| 5 | 移除帶控制點的邊 | 控制點一併消失，其餘邊的行為不變 |
| 6 | 舊檔（無 `variable`） | 固定半徑，體積與升版前一致 |

## 7. 參考
- OCCT `BRepFilletAPI_MakeFillet::Add(const NCollection_Array1<gp_Pnt2d>&, const TopoDS_Edge&)`（半徑演化律，X=相對參數、Y=半徑）。
- ADR 0097（面圓角驗證與滾球）、ADR 0098（面圓角／完整圓角）——命名與失敗哲學的基礎。
- `docs/fillet-by-face-plan.md` §「這次不做：變數半徑」。
