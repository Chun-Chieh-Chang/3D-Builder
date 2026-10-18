# ADR 0166: 沿曲線/邊線複製排列特徵 (Curve-driven Pattern Feature, C6.4)

## 狀態
已核准 (Approved)

## 日期
2026-10-18

## 背景與問題陳述
在工業機械零件設計中，許多結構需要沿著非直線性或非圓周軌跡進行特徵排列（例如：輸送鏈條導槽、沿導軌均勻分佈的安裝孔、機殼散熱網孔沿造型曲率邊緣分佈、以及裝飾紋理排列）。

目前專案已具備：
1. **直線複製排列 (Linear Pattern, C6.1)**：支援沿 1~2 個方向之等距網格排列。
2. **環狀複製排列 (Circular Pattern, C6.2)**：支援沿旋轉軸之均勻角度排列。
3. **鏡射特徵 (Mirror, C6.3)**：支援平面鏡射特徵與多本體。

然而，當特徵需要跟隨**曲線軌跡（如 3D 邊線、草圖樣條/圓弧/折線）**前進並動態調整空間姿態時，現有功能無法達成。

依據藍圖 C6.4 規範，本專案實作標準的「沿曲線/邊線複製排列特徵 (Curve-driven Pattern Feature)」。

---

## 決策分析與核心第一性原理

### 1. 統一架構與 PatternDefinition 擴充
沿曲線複製排列本質上仍屬於特徵/實體的重複生成與布林疊加。因此不開闢冗餘特徵類型，而是將其納入既有的 `PatternFeature`，並在 `PatternDefinition` 聯合型別中擴充 `mode: 'curve'`：

```ts
export interface CurvePatternDefinition {
  mode: 'curve';
  /** Path reference: a 3D model edge or a sketch / sketch outline. */
  path: Ref;
  /** Number of instances counting the seed (>= 2). */
  count: Expr;
  /** Spacing along curve in mm (used when equal is false). */
  spacing?: Expr;
  /** Equal spacing along curve: instance step is length / (count - 1), or length / count if closed. Default true. */
  equal: boolean;
  /** Alignment method: 'tangent' rotates with curve tangent; 'parallel' keeps seed orientation. Default 'tangent'. */
  alignment?: 'tangent' | 'parallel';
  /** Reverse travel direction along curve. */
  reverse?: boolean;
}
```

### 2. 雙重路徑來源解析 (Dual Path Resolution)
- **3D 實體邊線 (`ref.kind === 'edge'`)**：
  - 透過 `Kernel` 內建的 OCCT `BRepAdaptor_Curve` 探測邊線拓樸，支援直線、圓弧、橢圓、B-Spline 等各類 3D 解析與自由曲面邊線。
  - 藉由數值積分獲得精確弧長 $L$，並採樣各實例位置 $P(s)$ 與切線向量 $T(s)$。
- **草圖路徑 (`ref.kind === 'sketch'`)**：
  - 支援以草圖中的幾何鏈（Chain）或幾何圖元作為引導曲線，透過草圖平面矩陣（`PlaneFrame`）投影至 3D 空間，兼具靈活性與輕量運算。

### 3. 剛體位姿變換矩陣合成 (Rigid Motion Synthesis)
給定種子點切線向量 $T_0$ 與採樣點切線向量 $T_k$，以及位置 $P_0$ 與 $P_k$：
- **保持平行模式 (`alignment: 'parallel'`)**：
  - 實例僅進行空間平移：$\vec{v}_k = P_k - P_0$。
  - 變換矩陣 $M_k = \text{slide}(\vec{v}_k)$。
- **相切對齊模式 (`alignment: 'tangent'`)**：
  - 旋轉軸向量 $\vec{u} = \text{unit}(T_0 \times T_k)$，旋轉角 $\theta = \arccos(\text{clamp}(T_0 \cdot T_k, -1, 1))$。
  - 旋轉矩陣 $R$ 作用於種子相對於 $P_0$ 的空間座標，再平移至 $P_k$：
    $$X' = R \cdot (X - P_0) + P_k$$
  - 合成 3×4 仿射變換矩陣：$M_k = [R \mid P_k - R \cdot P_0]$。

### 4. 零 WASM 洩漏與既有流程復用
- 生成之各實例 $M_k$ 直接傳遞給 `engine.ts` 的 `this.repeat(...)` 管線。
- 完整復用現有的：
  - `deltaOf`：種子增刪幾何差集分離。
  - `noOverlap`：相鄰實例與種子間的包圍盒與布林重疊快篩防禦。
  - `skip`：特定序號實例忽略跳過（`skip?: string[]`）。
  - `apply`：Boss 合併（Join）與 Cut 切除。

---

## 自我紅隊對抗檢驗 (Self-Red-Teaming Defense)

依據 `AGENTS.md §2`，必須逐項滿足破壞性邊界四問：

1. **輸入破壞 (Input Corruption)**：
   - `count < 2`：強制拋出 `t('pattern.countTooSmall')`，嚴禁靜默預設。
   - `equal: false` 且 `spacing <= 0`：顯式拋錯 `t('pattern.spacingPositive')`。
   - 退化邊線（長度為 0 或 `curve === 'degenerated'`）：拋出 `t('pattern.curveDegenerated')`。
2. **拓樸與幾何相交破壞 (Geometric Self-Intersection Defense)**：
   - 步進過密或曲線曲率半徑小於特徵厚度時，相鄰實例易發生自交。前置由 `noOverlap` 嚴格攔截並拋出 `t('pattern.overlap')`，防止拋給 OCCT 造成崩潰。
3. **依賴鏈完整性 (Dependency Graph Integrity)**：
   - `schema.ts` (CurvePatternDefinition) $\to$ `serialize.ts` (Schema 65 遷移) $\to$ `commands.ts` $\to$ `refs.ts` $\to$ `params.ts` $\to$ `dag.ts` (parentsOf 追蹤曲線路徑相依) $\to$ `engine.ts` $\to$ `PropertyManager.tsx`，全鏈路無縫打通。
4. **規格真實性與零代理指標 (Zero-Mock & Ground Truth)**：
   - 驗收測試使用真實 3D 柱體/幾何邊線與草圖樣條路徑。
   - 記憶體確效測試強制檢查 Emscripten Heap，斷言基準指標 `expect(initial).toBeGreaterThan(0)`，拒絕使用 `?? 0`。
