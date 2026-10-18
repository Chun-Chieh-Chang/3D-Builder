# ADR 0158: 實體分割特徵 (Split Body Feature, C7.4)

- **狀態**：已批准 (Approved)
- **日期**：2026-10-18
- **依據**：藍圖 C7.4（實體分割特徵）、AI 智囊團審查結論、AGENTS.md 自我紅隊對抗 SOP
- **影響範圍**：`@3db/model` (Schema 59), `@3db/kernel`, `@3db/regen`, `@3db/i18n`, `apps/web`

---

## 1. 背景與第一性原理 (Context & First Principles)

在現代機械 CAD（SolidWorks/Inventor/Onshape）中，「實體分割（Split Body）」是多本體（Multi-body）設計體系的核心工具：
1. **設計意圖**：使用者在單一零件檔案內，利用基準面（Datum Plane）或實體平面（Planar Face）作為切割工具（Cutting Tool），將一個或多個目標本體（Target Bodies）一分為多，形成獨立實體。
2. **本質數學要求**：
   - **體積嚴格守恆 (Volume Conservation)**：切割後的各子實體體積之和，必須等於原始實體體積，相對誤差 $< 10^{-6}$：
     $$\sum_{i=1}^k V(B_i) = V(B_{original})$$
   - **拓樸封閉性與有效性 (Manifold Validity)**：分割產出的每一個實體必須是獨立的封閉流形實體（`TopoDS_Solid`），且 `BRepCheck_Analyzer.IsValid() === true`。
   - **無窮大幾何工具語意 (Infinite Plane Semantics)**：基準面在幾何語意上代表無窮大二維平面。在底層運算中，工具幾何必須自適應包覆目標實體的整個 3D 包圍盒（Bounding Box），確保實體被「完全切穿」而非僅局部劃傷。

---

## 2. 幾何演算法與底層架構選型 (Algorithm & OCCT Architecture)

### 2.1 底層求解工具選型
OpenCASCADE 提供多種布林運算工具：
- **`BRepAlgoAPI_Splitter`**：專用於以一組工具形狀（Tools）切分一組運算元形狀（Arguments）。一次性計算相交曲線、重構面拓樸並縫合出多個獨立 Solid，內部邊界面互為對偶（Seam Interface）。
- 本專案採用 `BRepAlgoAPI_Splitter` 作為分割引擎。

### 2.2 自適應工具平面覆蓋算法 (Adaptive Cutting Tool Framing)
1. 傳入目標實體 `ShapeId` 與切割平面 `Frame`（含 `origin`, `normal`, `xDir`, `yDir`）。
2. 計算實體的軸對齊包圍盒 $[min, max]$ 與對角線半徑 $R_{diag} = \frac{1}{2} \sqrt{\Delta x^2 + \Delta y^2 + \Delta z^2}$。
3. 計算包圍盒中心點 $C_{bbox} = \frac{min + max}{2}$ 在切割平面上的正交投影點 $P_{proj}$：
   $$P_{proj} = C_{bbox} - ((C_{bbox} - origin) \cdot normal) \cdot normal$$
4. 檢查包圍盒是否橫跨切割平面：若包圍盒所有 8 個頂點落在平面同側，代表切割工具未與實體相交，立即顯式拋出 `feature.splitNoIntersection`。
5. 以 $P_{proj}$ 為中心，沿 $xDir$ 與 $yDir$ 展開長寬各為 $4 \times R_{diag}$ 的大矩形面（`BRepBuilderAPI_MakeFace`），保證 100% 切穿目標實體。
6. 將實體與大切割面傳入 `BRepAlgoAPI_Splitter` 執行運算。
7. 萃取生成的所有 `TopoDS_Solid`；若產出數量 $< 2$，拋出相交無效異常。

---

## 3. 資料模型與版本演進 (Schema Evolution: Schema 59)

### 3.1 `SplitFeature` 定義
在 `packages/model/src/schema.ts` 升版至 `SCHEMA_VERSION = 59`：

```typescript
export interface SplitFeature extends FeatureBase {
  type: 'split';
  /** 切割工具：基準面或實體平面參考。 */
  tool: Ref;
  /** 目標本體列表；若為空或未指定，則預設切割所有與工具相交的本體。 */
  targets?: Ref[];
}
```

### 3.2 版本遷移保證
在 `packages/model/src/serialize.ts` 新增：
```typescript
58: (doc) => doc,
```
確保任何 Schema 58 舊檔案能平滑載入升級至 59。

---

## 4. 拓樸命名 (TNP) 與實體狀態轉換

分割特徵會將一個既有本體 $B_{orig}$ 替換為分割後的 $N$ 個新本體：
1. **本體識別 (Body Id)**：
   - 子本體識別碼命名規則：`${f.id}:b1`、`${f.id}:b2` ... `${f.id}:bN`。
2. **面拓樸繼承 (Face Origin Mapping)**：
   - 原本體的外表面依幾何重合或 OCCT `Modified` 映射繼承原有名稱。
   - 新生成的分割剖切面（內表面）命名為 `${f.id}:cut:b1` 與 `${f.id}:cut:b2`。
3. **本體狀態更新**：
   - 再生引擎更新 `set.list`，移除被切割的原實體，加入分割後的子實體群。

---

## 5. 自我紅隊四問檢驗準則 (AGENTS.md §2.1)

1. **輸入破壞 (Input Corruption)**：
   - 切割工具非平面（如選到曲面或圓柱面）：解析階段立即拋錯 `feature.splitToolNotPlanar`。
   - 切割工具未與任何本體相交：立即顯式拋錯 `feature.splitNoIntersection`，嚴禁靜默成功或產生空實體。
2. **拓樸與幾何相交破壞 (Geometric Self-Intersection Defense)**：
   - 工具平面僅擦過實體邊緣或頂點（退化切點）：拋出無實質相交錯誤。
   - 確保所有產出子實體通過 `BRepCheck_Analyzer` 且有效性為 true。
3. **依賴鏈完整性 (Dependency Graph Integrity)**：
   - 全鏈路完整接線：`schema.ts` -> `commands.ts` -> `dag.ts` -> `kernel.ts` -> `engine.ts` -> `PropertyManager.tsx`。
4. **規格真實性與零 Mock 原則 (Zero-Mock & Ground Truth)**：
   - 驗收測試必須驗證封閉解體積守恆 $\sum V_i = V_{orig}$（精度 $< 10^{-4}$）。
   - 驗證 WASM Heap 指標真實大於 0。
