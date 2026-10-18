# ADR 0159：鈑金凸折特徵（Sheet Metal Jog Feature，零件 Schema 60）

- 狀態：**設計與實作中（2026-10-18）**。
- 關聯：藍圖 Phase 7（C11.1–C11.4 鈑金製造能力）；歷史參考：[ADR 0086](0086-hem.md)、[ADR 0111](0111-mid-bend.md) 與 `tests/phase7/jog-spike.test.ts`。
- 零件 Schema 59 → **60**（遷移是空的：新種類特徵）。

---

## 1. 任務背景與第一性原理

在鈑金加工與工業設計中，**凸折（Jog / Z-Bend）** 是極為關鍵且常見的成形特徵：
在平板中間沿一條草圖線，將板件一側固定（Fixed Side），另一側朝法向階梯狀抬高或降低指定高度 $H$（Jog Offset），並在中間以兩道方向相反的折彎（Bend 1 與 Bend 2）平滑過渡連接，使移動端在完成成型後依然與固定端保持嚴格平行。

相較於單折彎（MidBend）：
- 中間折彎（MidBend）只產生 1 個折彎，移動端轉動角度 $\theta$；
- 凸折（Jog）產生 **2 個相反方向的折彎** 與一段 **中間平直腹板（Intermediate Web）**，移動端保持平行並產生垂直高度階梯。

---

## 2. 幾何演算法與數學推導

### 2.1 符號定義
- 板厚：$T$
- 內折彎半徑：$r_b$（未指定時預設使用鈑金參數 `sheet.radius`）
- 中性層因子：$K$（預設 `sheet.kFactor`）
- 凸折角度：$\theta$（預設 $90^\circ$，可選 $30^\circ \sim 90^\circ$）
- 凸折高度（步階高度）：$H$（兩平行板表面間的垂直位移）
- 草圖線方向向量：$\vec{l}$；板法向：$\vec{n}$；指向移動側的法向：$\vec{p} = \pm(\vec{n} \times \vec{l})$。

### 2.2 幾何邊界與腹板長度閉式解
在剖面平面 $(\vec{p}, \vec{n})$ 中：
- Bend 1 朝方向 $\vec{n}$ 彎曲 $\theta$ 角，外半徑為 $r_b + T$，內半徑為 $r_b$。
- 中間腹板長度為 $L_{web} \ge 0$，以角度 $\theta$ 傾斜延伸。
- Bend 2 朝相反方向反向彎曲 $\theta$ 角回到水平，內半徑為 $r_b$，外半徑為 $r_b + T$。

兩平行板表面間的總垂直位移 $H$ 為：
$$H = (2 r_b + T)(1 - \cos\theta) + L_{web} \sin\theta$$

反解腹板長度 $L_{web}$：
$$L_{web} = \frac{H - (2 r_b + T)(1 - \cos\theta)}{\sin\theta}$$

**物理幾何干涉硬約束（紅隊第一問防禦）**：
當 $L_{web} = 0$ 時，兩道折彎緊密相切；若 $L_{web} < 0$，兩折彎將在幾何上互相穿透重疊崩潰。
因此，凸折高度存在確定之理論最小值：
$$H_{min}(\theta) = (2 r_b + T)(1 - \cos\theta)$$
- 當 $\theta = 90^\circ$ 時：$H_{min} = 2 r_b + T$。若輸入之 $H < 2 r_b + T$，系統必須顯式拋出 `feature.jogTooShallow` 攔截，嚴禁交給底層布林運算造成 WASM 崩潰。

### 2.3 展開圖長度與體積嚴格守恆
每一道折彎之折彎展開裕度（Bend Allowance）為：
$$BA = \theta \cdot (r_b + K \cdot T)$$

在展開平板（Flat Pattern）中，凸折區消耗的下料長度為：
$$L_{blank} = 2 \cdot BA + L_{web}$$

在 $K = 0.5$ 下，折彎與腹板之體積嚴格滿足：
$$V_{zone} = (2 \cdot BA + L_{web}) \cdot w \cdot T = L_{blank} \cdot w \cdot T$$
成型後實體總體積嚴格等於原平板下料體積：
$$\sum V = V_{orig}$$

---

## 3. 資料模型與 Schema 遷移

升版至 `SCHEMA_VERSION = 60`。

```ts
export interface JogFeature extends FeatureBase {
  type: 'jog';
  /** 草圖 Id（內含剛好一條直線） */
  sketch: Id;
  /** 凸折高度（偏移距離） */
  offset: Expr;
  /** 凸折角度（預設 90deg） */
  angle?: Expr;
  /** 內折彎半徑（預設使用板厚半徑） */
  radius?: Expr;
  /** 是否反向凸折（往草圖法向之反方向） */
  reverse?: boolean;
  /** 是否固定草圖線右側（預設固定左側） */
  flipSide?: boolean;
}
```

遷移函數 (`serialize.ts`)：
```ts
59: (doc) => doc
```

---

## 4. 自我紅隊四問檢驗準則 (AGENTS.md §2.1)

1. **輸入破壞 (Input Corruption)**：
   - $H < H_{min}$（例如 $H = 2\text{ mm}$ 而 $2r_b + T = 5.5\text{ mm}$）：前置演算顯式拋出 `feature.jogTooShallow`，附帶最小高度數值。
   - 草圖包含 0 條線或多條線：拋出 `midBend.oneLine`（剛好一條直線）。
   - 折線未切穿板材或在板外：拋出 `midBend.lineOutside` / `midBend.noSide`。
2. **拓樸與幾何相交破壞 (Geometric Self-Intersection Defense)**：
   - 凸折產出之實體通過 `BRepCheck_Analyzer`，`kernel.isValid(shape) === true`，實體數量恆為 1。
3. **依賴鏈完整性 (Dependency Graph Integrity)**：
   - 全鏈路完整接線：`schema.ts` -> `commands.ts` -> `dag.ts` -> `kernel.ts` -> `engine.ts` -> `flatPattern.ts` -> `PropertyManager.tsx`。
4. **規格真實性與零 Mock 原則 (Zero-Mock & Ground Truth)**：
   - 體積閉式解守恆驗證：$K=0.5$ 時體積恆等於原平板體積。
   - 展開圖驗證：展開圖產生 2 條平行折彎線，方向一上（`up`）一下（`down`），展開面積等於原平板面積。
   - WASM Heap 指標真實大於 0。
