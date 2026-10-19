# ADR 0168: 螺旋曲線與渦捲線特徵 (Helix / Spiral Curve Feature, C8.3)

## 1. 背景與動機 (Context & Motivation)
依據藍圖 C8.3 規範，實作「螺旋曲線與渦捲線」（Helix and Spiral Curve Feature）。
在機械設計與夾治具、模具與塑膠件工程中，螺旋線（Helix）與渦捲線（Spiral）是構造螺簧（Compression/Tension Spring）、螺紋傳動、螺旋滑道、渦卷彈簧（Clockwork/Power Spring）以及沿曲線導引複製排列（ADR 0166）的關鍵基礎空間幾何圖元。

SolidWorks 傳統上將螺旋曲線作為獨立特徵（Curve Feature）提供，由圓形草圖或圓形邊線驅動，支援以下 4 種定義方式：
1. **螺距和圈數 (Pitch and Revolution)**：給定螺距 $P$ 與圈數 $N$，求得高度 $H = P \times N$。
2. **高度和圈數 (Height and Revolution)**：給定總高度 $H$ 與圈數 $N$，求得螺距 $P = H / N$。
3. **高度和螺距 (Height and Pitch)**：給定總高度 $H$ 與螺距 $P$，求得圈數 $N = H / P$。
4. **渦捲線 (Spiral)**：在平面上以螺距 $P$（每圈徑向擴展量）與圈數 $N$ 展開阿基米德螺旋線 ($H = 0$)。

本特徵保證全鏈路整合進 `@3db/model`、`@3db/kernel`、`@3db/regen` 與 Web UI，具備可參數化（全域變數與表達式求值）、零 WASM 記憶體洩漏與物理真值精確驗證。

---

## 2. 第一性原理與幾何數學推導 (First Principles & Mathematical Ground Truth)

### 2.1 圓柱螺旋線 (Cylindrical Helix, $\alpha = 0$)
- 設基準圓半徑為 $R$，中心為 $O$，軸向單位向量為 $\vec{Z}$，參考徑向基準軸為 $\vec{X}$，旋向因子 $h \in \{+1, -1\}$（$+1$ 為順時針 CW，$-1$ 為逆時針 CCW）。
- 參數化角度 $\theta \in [0, 2\pi N]$，起始角為 $\theta_0$：
  $$\vec{P}(\theta) = O + R [\cos(\theta_0 + h\theta)\vec{X} + \sin(\theta_0 + h\theta)\vec{Y}] + \left(\frac{P}{2\pi}\theta\right) \vec{Z}$$
- **弧長閉式真值解 (Arc Length Closed-Form Ground Truth)**：
  每一圈旋轉對應的周長展開為 $2\pi R$，高度上升 $P$。微元弧長 $ds = \sqrt{R^2 d\theta^2 + dz^2} = \sqrt{R^2 + (P/2\pi)^2} d\theta$。
  全曲線精確總長度為：
  $$L = N \times \sqrt{(2\pi R)^2 + P^2} = \sqrt{(2\pi N R)^2 + H^2}$$

### 2.2 錐形螺旋線 (Conical Helix, $\alpha \neq 0$)
- 設錐角為 $\alpha$（度數），半徑隨高度線性變化：
  $$r(z) = R + z \tan\alpha = R + \left(\frac{P}{2\pi}\theta\right) \tan\alpha$$
- 微元弧長：
  $$ds = \sqrt{r(\theta)^2 d\theta^2 + dr^2 + dz^2}$$

### 2.3 平面渦捲線 (Flat Archimedean Spiral, $H = 0$)
- 在基準面上半徑隨角度線性增加：
  $$r(\theta) = R_0 + \left(\frac{P}{2\pi}\right) \theta$$
- 微元弧長：
  $$ds = \sqrt{r(\theta)^2 + \left(\frac{dr}{d\theta}\right)^2} d\theta = \sqrt{\left(R_0 + \frac{P}{2\pi}\theta\right)^2 + \left(\frac{P}{2\pi}\right)^2} d\theta$$

---

## 3. 架構設計與實作策略 (System Architecture & Pipeline)

### 3.1 資料模型 (`@3db/model`, Schema 67)
- 升版 `SCHEMA_VERSION = 67`。
- 新增 `HelixFeature` 介面：
  ```ts
  export type HelixDefinedBy = 'pitchAndRev' | 'heightAndRev' | 'heightAndPitch' | 'spiral';

  export interface HelixFeature extends FeatureBase {
    type: 'helix';
    /** Reference circular sketch or circular model edge providing base center, radius, and axis normal. */
    circle: Ref | Id;
    /** Definition mode. Default 'pitchAndRev'. */
    definedBy: HelixDefinedBy;
    /** Pitch in mm (used in pitchAndRev, heightAndPitch, spiral). */
    pitch?: Expr;
    /** Revolutions count (used in pitchAndRev, heightAndRev, spiral). */
    revolutions?: Expr;
    /** Total height in mm (used in heightAndRev, heightAndPitch). */
    height?: Expr;
    /** Starting angle (e.g. '0deg', '90deg'). Default '0deg'. */
    startAngle?: Expr;
    /** Whether winding is clockwise. Default true. */
    clockwise?: boolean;
    /** Reverse along axis direction. Default false. */
    reverse?: boolean;
    /** Optional taper angle (e.g. '5deg'). */
    taperAngle?: Expr;
    /** Taper expands outward (true) or narrows inward (false). Default false. */
    taperOutward?: boolean;
  }
  ```
- 指令層：新增 `setHelix` 指令，並於 `commands.ts`、`params.ts`、`refs.ts` 完整接線。

### 3.2 幾何核心 (`@3db/kernel`)
- 實作 `Kernel.helixCurve(params: HelixParams): WireResult`:
  - 圓柱螺旋線：透過 `Geom_CylindricalSurface` + `Geom2d_Line`，使用 `BRepBuilderAPI_MakeEdge` 與 `BRepLib.BuildCurves3d` 建構精密空間邊線。
  - 錐形螺旋線：透過 `Geom_ConicalSurface` + `Geom2d_Line` 建構。
  - 渦捲線：透過精確阿基米德多段採樣構造 `Geom2d_BSplineCurve` 或 `Geom_Plane` 2D 曲線投影。
  - 每整圈或不滿一圈切分 Edge 並以 `BRepBuilderAPI_MakeWire` 合成單一拓樸 Wire。
  - 記憶體生命週期：所有暫存 `gp_Ax3`, `Geom_Surface`, `Geom2d_Line` 均經 `Arena.own` 託管並於 `finally` 釋放。

### 3.3 再生引擎 (`@3db/regen`)
- `dag.ts`: 註冊 `case 'helix':`，依賴基準圓草圖或實體邊。
- `engine.ts`: 實作 `helix(f, set)`：
  - 求值各數值表達式，解析圓形中心、半徑與法向軸。
  - 呼叫 `Kernel.helixCurve`，產生純曲線特徵本體（Wire body），登記拓樸邊名 `${f.id}:helix`。

### 3.4 介面與雙語 (`apps/web`, `packages/i18n`)
- `PropertyManager.tsx`: 新增 `HelixPanel`，提供定義依據下拉選單、圓形槽位、螺距/高度/圈數輸入框、起始角、順逆時針與反向開關、錐角設定。
- 雙語字典：補齊 `feature.helix`、`pm.helix.*`、`cmd.setHelix` 等中英文詞條。
- 說明文檔與手冊映射：`docs/help-links.json` 註冊 `"helix"`。

---

## 4. 自我紅隊四問檢驗標準 (Self-Red-Teaming Defense Checklist)

1. **輸入破壞 (Input Corruption)**：
   - 螺距 $P \le 0$、高度 $H \le 0$、圈數 $N \le 0$、半徑 $R \le 0$ 必須在模型/命令層立即拋出顯式錯誤並說明原因，嚴禁靜默修正。
   - 錐形螺旋線若內縮導致頂端半徑 $\le 0$，必須顯式攔截報錯。
2. **拓樸相交與退化防禦 (Geometric Self-Intersection Defense)**：
   - 圈數為小數（如 0.25 圈、2.75 圈）時，尾段截斷必須精確無退化。
3. **依賴鏈完整性 (Dependency Graph Integrity)**：
   - `schema.ts` -> `commands.ts` -> `refs.ts` -> `dag.ts` -> `engine.ts` -> `PropertyManager.tsx`，缺一不可。
4. **規格真實性與零 Mock 原則 (Zero-Mock & Ground Truth)**：
   - 驗收測試必須使用真實拓樸曲線長度物理量測，並與閉式解 $L = \sqrt{(2\pi N R)^2 + H^2}$ 嚴格吻合到 $10^{-4}$。
   - 監控底層 WASM Heap 真實指標 `(oc as any).wasmMemory?.buffer?.byteLength`，且強制 `expect(initial).toBeGreaterThan(0)`，驗證 0 記憶體洩漏。
