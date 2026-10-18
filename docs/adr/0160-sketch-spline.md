# ADR 0160: 草圖樣條曲線圖元與造型實體全鏈路架構 (Sketch Spline Feature)

- **狀態**：已批准 (Approved)
- **日期**：2026-10-18
- **依據**：藍圖 C1.11（不規則曲線 / Spline）、AI 智囊團審查結論、AGENTS.md 自我紅隊四問準則
- **影響範圍**：`@3db/model` (Schema 61), `@3db/sketch`, `@3db/regen`, `@3db/kernel`, `@3db/render`, `apps/web`

---

## 1. 背景與第一性原理定調 (Context & First Principles)

在工業機械與產品外觀造型中，樣條曲線（Spline / B-spline）廣泛應用於曲面過渡、葉片截面、流線外殼、手柄人體工學與凸輪運動輪廓。
前期草圖圖元僅支援點（Point）、直線（Line）、圓（Circle）、圓弧（Arc）、橢圓（Ellipse）。

依據第一性原理與 CAD 造型架構：
1. **參數式型值點內插 (Through-point Interpolation)**：
   樣條曲線由一系列有序的型值點 ID 列表（`points: Id[]`）定義。在草圖求解器與約束圖中，型值點作為獨立的點圖元存在，可被標註尺寸、套用幾何約束（重合、水平、垂直、固定）。
2. **閉合與開放雙重語意支援 (Closed & Open Curves)**：
   - 閉合樣條（`closed: true`）：首尾型值點自動閉合，在草圖中直接構成單一封閉輪廓（Loop2），可直接用於長出（Extrude Boss）、除料（Extrude Cut）、旋轉（Revolve）等特徵。
   - 開放樣條（`closed: false`）：起點與終點可與草圖中的其他直線、圓弧或樣條相接，共同構成複合閉合輪廓環。
3. **OCCT 工業級幾何求解映射**：
   使用 OpenCASCADE 之 `GeomAPI_PointsToBSpline` 演算法構建 $C^2$ 平滑連續之 `Geom_BSplineCurve`。由於 Emscripten JS 綁定對 C++ 智慧指標 Handle（如 `Handle(TColgp_HArray1OfPnt)&`）存在 ABI 例外風險，選用直接接受 `NCollection_Array1_gp_Pnt` 值型別之 `GeomAPI_PointsToBSpline`，在閉合模式時以首點補合形成封閉曲線，保證拉伸成型後曲面無縫且幾何精確。
4. **記憶體防禦與隔離意識 (AGENTS.md §3.5)**：
   依據已知限制，B-spline 曲面在布林運算中會佔用底層 Heap，系統依賴 Worker 高水位自動重啟（ADR 0126）進行保護；測試套件必須包含真實 WASM Heap 指標防呆（`> 0`）。

---

## 2. 幾何模型設計 (Geometric Model Design)

### 2.1 草圖資料模型 (`@3db/model`, Schema 61)
```ts
export interface SketchSplineEntity {
  id: Id;
  type: 'spline';
  points: Id[];        // 依序通過的 point entity ID 列表 (至少 2 個)
  closed?: boolean;    // 是否閉合（首尾相接成為封閉環）
  construction?: boolean;
  ref?: Ref;
}
```

### 2.2 輪廓偵測與拓樸閉合 (`@3db/sketch`)
- **取樣多邊形逼近 (`sample`)**：
  在相鄰型值點間進行細分內插取樣，計算 `signedArea` 與 `contains`，支援外外廓與巢狀內孔偵測。
- **封閉與開放多邊形環構造 (`findProfiles`)**：
  - `closed: true`：獨立推進至 `loops` 作為單一封閉環。
  - `closed: false`：以 `points[0]` 為起點、`points[points.length - 1]` 為終點登記至 `edges`，自然參與複合輪廓搜尋。

### 2.3 核心幾何與 OCCT 映射 (`@3db/kernel`)
- 在草圖平面 3D 空間中，計算型值點的 3D 坐標序列：
  $$P_i = Origin + u_i \cdot X_{dir} + v_i \cdot Y_{dir}$$
- 建立 `NCollection_Array1_gp_Pnt(1, totalPts)` 並裝填 $P_i$（閉合曲線於末尾填入首點 $P_0$）。
- 呼叫 `GeomAPI_PointsToBSpline(arr)` 進行 B-spline 擬合。
- 生成 `BRepBuilderAPI_MakeEdge(approx.Curve())`，並支援反向面與內孔方向反轉。

---

## 3. 自我紅隊四問檢驗 (Self-Red-Teaming Verification)

1. **輸入破壞 (Input Corruption)**：
   - 點數小於 2 個：顯式拒絕拋出 `spline.pointsMin`。
   - 閉合曲線點數小於 3 個：顯式拒絕拋出 `spline.closedMinPoints`。
   - 相鄰連續點重合（歐氏距離 $< 1\times 10^{-6}$）：顯式拒絕拋出 `spline.duplicatePoints`，避免 OCCT 奇異矩陣崩潰。
   - 嚴禁使用 `Math.round` 或靜默忽略無效點。
2. **拓樸相交防禦 (Geometric Self-Intersection Defense)**：
   - 開放樣條未接合報 `profile.openEnd`，多路分支報 `profile.branch`。
   - 實體拉伸成型後經 `BRepCheck_Analyzer` 驗證 `kernel.isValid` 為 true。
3. **依賴鏈完整性 (Dependency Graph Integrity)**：
   - 全鏈路路徑：`schema.ts` (Entity) $\to$ `serialize.ts` (Migration 61) $\to$ `sketch-rules.ts` $\to$ `types.ts` $\to$ `ops.ts` $\to$ `planegcs.ts` $\to$ `profiles.ts` $\to$ `kernel.ts` (wire) $\to$ `engine.ts` (Extrude/Cut/Revolve) $\to$ `overlay.ts` $\to$ i18n 雙語字典，缺一不可。
4. **規格真實性與零 Mock 原則 (Zero-Mock & Ground Truth)**：
   - 驗收測試以真實 OCCT 核心拉伸實體，量測實體體積、邊數、面數，零 Mock 數據。
   - 記憶體真實指標防呆：斷言 `(kernel.oc as any).wasmMemory?.buffer?.byteLength > 0`。
