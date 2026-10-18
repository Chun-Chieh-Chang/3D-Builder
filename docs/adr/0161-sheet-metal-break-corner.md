# ADR 0161: 鈑金斷開角落與角落修剪全鏈路架構 (Sheet Metal Break Corner Feature)

- **狀態**：已批准 (Approved)
- **日期**：2026-10-18
- **依據**：藍圖 C11.4（封閉角落、斷開角落/角落修剪、自動離隙）、AGENTS.md 自我紅隊四問準則
- **影響範圍**：`@3db/model`, `@3db/regen`, `packages/i18n`, `apps/web`, `tests/phase7`

---

## 1. 背景與第一性原理定調 (Context & First Principles)

在鈑金零件加工中，板材外邊緣轉角在雷射切割或剪切後具有銳利直角與毛刺，極易造成刮傷或在後續折彎組裝時產生干涉。
**斷開角落 (Break Corner / Corner Trim)** 是鈑金的核心加工工藝：
1. **幾何本質**：
   斷開角落是在鈑金外輪廓直角轉角（厚度邊）處，施加貫穿全板厚 $T$ 的幾何切除：
   - **倒角 (Chamfer)**：在轉角處切除直角等腰三角形柱體（邊長 $D$），消除尖角。
   - **倒圓 (Fillet / Round)**：在轉角處切除外角餘料，構造半徑為 $R$ 的相切圓柱過渡面。
2. **適用領域全覆蓋 (Universal Sheet Metal Corner Support)**：
   早期原型僅允許在 `edgeFlange` 自由端的特定兩條厚度邊上進行倒角，嚴重背離工業實務。
   第一性原理定調：凡是屬於鈑金實體外露輪廓且長度等於板厚 $T$ 的厚度邊（Thickness edge），無論其位於：
   - **基材平板 (Base Flange)** 外角；
   - **邊線凸緣 (Edge Flange)** 自由端外角；
   - **鈑金凸折 (Jog)** 或 **摺邊 (Hem)** 外角；
   皆為斷開角落的合法目標邊。
3. **展開圖自動守恆 (Flat Pattern Conservation)**：
   斷開角落作為成形特徵，由再生引擎 `recordCut` 自動擷取切除實體，並經 `flatPattern` 逆向剛體映射機制，在展平圖中精確切出倒角直線段（Line）或倒圓圓弧段（Arc），保證 3D 實體體積與 2D 展開下料面積理論閉式解 100% 吻合。

---

## 2. 幾何模型與演算邏輯 (Geometric Algorithm)

### 2.1 厚度邊識別準則 (Thickness Edge Identification)
給定選取邊 $E$ 與鈑金資訊 `sheet`（板厚 $T$）：
1. **長度與形狀檢查**：
   $E$ 必須為直線（`curve === 'line'`），且長度 $|L - T| \le 1\times 10^{-4} \cdot (1 + T)$。
2. **側面法向共面性**：
   $E$ 必須連接兩個面 $F_1, F_2$（即板材厚度側面），其法向 $n_1, n_2$ 必須與板厚方向正交（$|n_i \cdot n_{sheet}| < 1\times 10^{-4}$），且 $F_1, F_2$ 形成外轉角（凸角，非內凹退化角）。
3. **尺寸有效性硬防禦**：
   倒角尺寸 $S$ 必須滿足 $0 < S < \min(L_{adj1}, L_{adj2})$，其中 $L_{adj1}, L_{adj2}$ 為相鄰厚度邊相接的板緣長度，嚴禁輸入無效數值交由底層 OCCT 拋出未捕獲崩潰。

### 2.2 體積與面積閉式解 (Closed-form Volume & Area Solutions)
對於單一 $90^\circ$ 轉角厚度邊（板厚 $T$）：
- **倒角模式 (`kind === 'chamfer'`, 尺寸 $D$)**：
  $$\Delta V = \frac{1}{2} D^2 \cdot T, \quad \Delta A_{flat} = \frac{1}{2} D^2$$
- **倒圓模式 (`kind === 'fillet'`, 半徑 $R$)**：
  $$\Delta V = R^2 \left(1 - \frac{\pi}{4}\right) \cdot T, \quad \Delta A_{flat} = R^2 \left(1 - \frac{\pi}{4}\right)$$

---

## 3. 自我紅隊四問檢驗 (Self-Red-Teaming Verification)

1. **輸入破壞 (Input Corruption)**：
   - 尺寸 $S \le 0$、NaN、大於相鄰板邊：顯式拒絕拋出 `breakCorner.sizeInvalid`。
   - 選取非厚度邊（長度不等於 $T$ 或折彎面圓弧邊）：顯式拒絕拋出 `breakCorner.unsupported`。
   - 嚴禁使用 `Math.round` 靜默篡改輸入尺寸。
2. **拓樸相交防禦 (Geometric Self-Intersection Defense)**：
   - 基材板多角（如 4 個角）同時倒角/倒圓，多特徵順序叠加，產出實體經 `BRepCheck_Analyzer` 驗證 `kernel.isValid` 恆為 true，Solid 數量恆為 1。
3. **依賴鏈完整性 (Dependency Graph Integrity)**：
   - 全鏈路覆蓋：`schema.ts` $\to$ `commands.ts` $\to$ `dag.ts` $\to$ `engine.ts` $\to$ `flatPattern.ts` $\to$ `PropertyManager.tsx` $\to$ i18n 雙語字典，缺一不可。
4. **規格真實性與零 Mock 原則 (Zero-Mock & Ground Truth)**：
   - 體積嚴格閉式解檢驗：$100\times 60\times 1.5$ 板 4 角倒圓 $R=5$，切除體積 $\Delta V = 32.19\text{ mm}^3$；4 角倒角 $D=5$，切除體積 $\Delta V = 75.0\text{ mm}^3$，零 Mock 數據。
   - 記憶體真實指標防呆：斷言 `(kernel.oc as any).wasmMemory?.buffer?.byteLength > 0`。
