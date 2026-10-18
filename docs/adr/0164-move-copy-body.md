# ADR 0164: 實體移動與複製本體特徵 (Move/Copy Body Feature, C7.3)

- **狀態**：已批准 (Approved)
- **日期**：2026-10-18
- **依據**：藍圖 C7.3（移動/複製本體）、AI 智囊團審查結論、AGENTS.md 自我紅隊對抗 SOP
- **影響範圍**：`@3db/model` (Schema 63), `@3db/kernel`, `@3db/regen`, `@3db/i18n`, `apps/web`

---

## 1. 背景與第一性原理 (Context & First Principles)

在現代機械 CAD（SolidWorks/Inventor/Onshape）中，多本體設計體系與夾治具（Jigs & Fixtures）建模極度依賴「移動/複製本體（Move/Copy Bodies）」：
1. **設計意圖**：
   - 使用者在單一零件檔案內，選取一個或多個 Solid 本體，施加 3D 空間平移（Translation: $\Delta x, \Delta y, \Delta z$）或繞軸旋轉（Rotation: 旋轉軸與旋轉角 $\theta$）。
   - 支援「純移動（Move）」與「保留原實體之複製（Copy）」。
2. **第一性原理與數學守恆**：
   - **剛體變換 (Rigid Motion)**：移動與旋轉皆屬於保距、保角之正交剛體變換（$SO(3)$ 旋轉群與 $\mathbb{R}^3$ 平移群之半直積 $SE(3)$）。
   - **體積與面面積絕對守恆**：變換前後各子實體體積與表面積維持 100% 數值不變，相對誤差 $< 10^{-9}$：
     $$V(B_{transformed}) = V(B_{original})$$
   - **拓樸對偶結構完好保持 (Topological Isomorphism)**：剛體變換不引入任何新的布林相交、縫合或逼近，形狀的面、邊、頂點數量與拓樸順序完全不變。
   - **零布林記憶體洩漏 (Zero-Leakage Assurance, AGENTS.md §3.5)**：因不調用 OCCT 的 B-spline 布林 Fuse/Cut 算子，剛體變換形狀在 WASM Heap 中的增量恆為 0.00 MiB。

---

## 2. 幾何演算法與矩陣合成 (Geometric Algorithm & Matrix Composition)

### 2.1 剛體變換 3 × 4 矩陣
傳入平移向量 $T = [dx, dy, dz]$ 與旋轉設定（旋轉軸方向單位向量 $u = [u_x, u_y, u_z]$，軸上中心點 $p_0 = [x_0, y_0, z_0]$，角度 $\theta$）：
1. 若 $\theta = 0$，旋轉矩陣 $R = I_3$。
2. 若 $\theta \ne 0$，依羅德里格旋轉公式（Rodrigues' Rotation Formula）：
   $$c = \cos\theta, \quad s = \sin\theta, \quad v = 1 - c$$
   $$R = \begin{bmatrix}
   c + u_x^2 v & u_x u_y v - u_z s & u_x u_z v + u_y s \\
   u_y u_x v + u_z s & c + u_y^2 v & u_y u_z v - u_x s \\
   u_z u_x v - u_y s & u_z u_y v + u_x s & c + u_z^2 v
   \end{bmatrix}$$
3. 繞任意中心點 $p_0$ 旋轉後平移 $T$：
   $$P' = R(P - p_0) + p_0 + T = R P + (p_0 - R p_0 + T)$$
   平移部分為：
   $$T_{final} = p_0 - R p_0 + T$$
4. 合成為 12 個純量元素的列優先矩陣陣列：
   $$M = [R_{11}, R_{12}, R_{13}, T_{final, x}, R_{21}, R_{22}, R_{23}, T_{final, y}, R_{31}, R_{32}, R_{33}, T_{final, z}]$$
5. 調用底層 `@3db/kernel` 的 `Kernel.transformed(target.shape, M)` 完成形狀變換。

### 2.2 旋轉軸參考解析
旋轉軸可為：
- 主軸字串：`'x'`（$[1,0,0]$）、`'y'`（$[0,1,0]$）、`'z'`（$[0,0,1]$）。
- 基準軸 Ref：解析其 `origin` 與 `dir`。
- 直線邊 Ref：解析其邊線直線幾何的端點與方向。
- 基準面或平面 Ref：解析其平面法向量與中心。

---

## 3. 資料模型與版本演進 (Schema Evolution: Schema 63)

### 3.1 `MoveCopyBodyFeature` 定義
在 `packages/model/src/schema.ts` 升版至 `SCHEMA_VERSION = 63`：

```typescript
export interface MoveCopyBodyFeature extends FeatureBase {
  type: 'moveCopyBody';
  /** 目標本體參考列表。 */
  targets: Ref[];
  /** X 軸平移 (mm)，支援表達式。 */
  dx?: Expr;
  /** Y 軸平移 (mm)，支援表達式。 */
  dy?: Expr;
  /** Z 軸平移 (mm)，支援表達式。 */
  dz?: Expr;
  /** 旋轉軸：主軸 'x' | 'y' | 'z' 或參考 Ref。 */
  rotationAxis?: Ref | 'x' | 'y' | 'z';
  /** 旋轉角度，支援表達式 (例如 '90deg')。 */
  rotationAngle?: Expr;
  /** 複製開關：true = 保留原實體並產出新本體；false = 原本體位置被取代。預設 false。 */
  copy?: boolean;
}
```

### 3.2 版本遷移
在 `packages/model/src/serialize.ts` 新增：
```typescript
62: (doc) => doc,
```

---

## 4. 自我紅隊四問對抗檢驗 (AGENTS.md §2.1)

1. **輸入破壞 (Input Corruption)**：
   - 目標本體列表為空且模型超過一個本體時，立即顯式拋錯 `feature.moveCopyNoTarget`。
   - 非法或無法解析之數值（NaN、Infinity）透過 `evalLength` 與 `evalAngle` 顯式攔截，嚴禁靜默使用預設值。
   - 旋轉軸若指定為曲面或曲線邊線，顯式拋錯 `feature.moveCopyBadAxis`。
2. **拓樸與幾何相交破壞 (Geometric Self-Intersection Defense)**：
   - 剛體變換為同胚映射，嚴格保持流形自相交性不變。
   - 複製模式產生多本體，多本體允許空間重疊，不進行破壞性布林 Fuse，杜絕 WASM 堆記憶體耗盡。
3. **依賴鏈完整性 (Dependency Graph Integrity)**：
   - 完整鏈路覆蓋：`schema.ts` -> `commands.ts` -> `refs.ts` -> `params.ts` -> `dag.ts` -> `engine.ts` -> `PropertyManager.tsx` -> `i18n` -> `help`。
4. **規格真實性與零 Mock 原則 (Zero-Mock & Ground Truth)**：
   - 測試使用真實 Kernel 生成的長方體（$40 \times 30 \times 20$ mm），實體探針驗證頂點坐標精確位移、體積 $24000\text{ mm}^3$ 零誤差、複製模式總體積精確翻倍為 $48000\text{ mm}^3$。
   - 底層 WASM Heap 唯一真實路徑指標驗證，斷言 `expect(initial).toBeGreaterThan(0)`，50 次變換 Heap 成長量為 0.00 MiB。
