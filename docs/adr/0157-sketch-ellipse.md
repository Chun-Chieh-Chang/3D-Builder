# ADR 0157: 草圖橢圓圖元與長出實體全鏈路架構 (Sketch Ellipse Feature)

- **狀態**：已批准 (Approved)
- **日期**：2026-10-18
- **依據**：藍圖 C1.5（草圖進階幾何）、AI 智囊團審查結論、AGENTS.md 自我紅隊四問準則
- **影響範圍**：`@3db/model` (Schema 58), `@3db/sketch`, `@3db/regen`, `@3db/kernel`, `@3db/render`, `apps/web`

---

## 1. 背景與第一性原理定調 (Context & First Principles)

在參數式 CAD 建模中，橢圓（Ellipse）廣泛應用於凸輪輪廓、長圓導角過渡、密封槽與流體截面。
前期草圖圖元僅支援點（Point）、直線（Line）、圓（Circle）、圓弧（Arc）。
依據 AI 智囊團 5 位顧問審查：
1. **拒絕將自由 Spline 與解析橢圓混為一談**：PlaneGCS 求解器原生具備 `SketchEllipse` 解析幾何抽象，OCCT 核心具備閉式 `gp_Elips` 解析表達式；
2. **零 Mock 數值推導**：橢圓面積解析解為 $A = \pi \cdot a \cdot b$，長出實體體積為 $V = \pi \cdot a \cdot b \cdot h$，完全無需依賴數值逼近或多邊形離散近似；
3. **記憶體防禦**：純解析二次曲線（Conic Section）拉伸長出在 OCCT 拓樸中為解析圓柱面變換，再生 WASM Heap 洩漏量恆為 0.00 MiB（相較於 B-spline 自由曲面布林的已知限制）。

---

## 2. 幾何模型設計 (Geometric Model Design)

### 2.1 草圖資料模型 (`@3db/model`, Schema 58)
比照 SolidWorks 幾何定義與 PlaneGCS 映射：
- 橢圓由中心點、長軸端點與短半徑決定：
  ```ts
  export interface SketchEllipseEntity {
    id: Id;
    type: 'ellipse';
    center: Id;         // 中心點 point entity ID
    major: Id;          // 長軸頂點 point entity ID (決定長半徑 a 與傾角 theta)
    minorRadius: number; // 短半徑 b
    construction?: boolean;
    ref?: Ref;
  }
  ```
- 當用戶拖曳 `major` 頂點時，即時響應旋轉與長半徑伸縮；當拖曳 `minorRadius` 時，縮放短軸長度。

### 2.2 核心幾何與 OCCT 映射 (`@3db/kernel`)
- `gp_Elips` 構造式嚴格要求長半徑 $a \ge b \ge 0$。
- **防禦性自適應正規化 (Adaptive Normalization)**：
  若短半徑計算大於長半徑（$b > a$），演算法自動交換長短半徑並將坐標軸法向轉向 $90^\circ$（$\theta \leftarrow \theta + \pi/2$），確保 OCCT 底層 0 拋錯。
- 3D 空間幾何構造：
  $$Center_{3D} = Origin + x \cdot X_{dir} + y \cdot Y_{dir}$$
  $$MajorDir_{3D} = \cos(\theta) \cdot X_{dir} + \sin(\theta) \cdot Y_{dir}$$
  $$gp\_Elips(Ax2(Center_{3D}, Normal_{3D}, MajorDir_{3D}), a, b)$$

---

## 3. 自我紅隊四問檢驗 (Self-Red-Teaming Verification)

1. **輸入破壞 (Input Corruption)**：
   - 負數半徑、零半徑（$a \le 0$ 或 $b \le 0$）即時在命令層與求解前置攔截，拋出明確錯誤，嚴禁隱含篡改。
   - 重合點（`center === major`）視為退化幾何顯式拒絕。
2. **拓樸相交防禦 (Geometric Self-Intersection Defense)**：
   - 閉合輪廓環由單一封閉橢圓邊構成，`BRepBuilderAPI_MakeWire` 自動驗證 `IsDone()`。
   - 作為外輪廓（Outer）或內孔（Holes）時，方向分別維持逆時針（CCW）與順時針（CW）。
3. **依賴鏈完整性 (Dependency Graph Integrity)**：
   - 全鏈路路徑：`schema.ts` (Entity) $\to$ `serialize.ts` (Migration 58) $\to$ `planegcs.ts` (Solver) $\to$ `profiles.ts` (Loop2) $\to$ `kernel.ts` (gp_Elips Wire) $\to$ `engine.ts` (Extrude)。
4. **零 Mock 真值驗證 (Zero-Mock Ground Truth)**：
   - 驗收測試以手算解析值為唯一標準：
     長半徑 $a = 30$, 短半徑 $b = 15$, 伸長深度 $h = 20$：
     理論體積 $V = \pi \times 30 \times 15 \times 20 = 9000\pi \approx 28274.333882\text{ mm}^3$。
     測試斷言容差 $|V_{calc} - V_{exact}| < 1e-4\text{ mm}^3$。
