# ADR 0228: 草圖自由曲線 offset 探針 (G09, D2)

- 日期：2026-11-02
- 狀態：探針報告（未進入正式實作）
- 相關：G09（plan.md）、C04（acceptance.md）、ADR 0195（草圖拘束擴充）

## 1. 探針目的

G09：偏移限線／弧／圓；雙側、封口與自由曲線需額外操作或不支援。本探針評估「自由曲線（B 樣條／Bézier）offset」可行性（plan.md P5：每項探針 2–4 日）。

## 2. 現有基礎

- `offset()`（`packages/sketch/src/ops.ts`）已支援線／弧／圓：每條 offset 為平行線／同中心圓弧，驅動尺寸（distance）連結，封口以垂直線閉合。
- OCCT 綁定暴露 `Adaptor2d_OffsetCurve`（見綁定字串），且 `Geom2d_OffsetCurve` 可表達 2D 曲線的等距偏移。

## 3. 可行性分析

### 3.1 OCCT 能力

- OCCT 可計算 2D 曲線的等距偏移（`Geom2d_OffsetCurve`），結果為一個「offset curve」物件，其參數化與原曲線不同，且在高曲率處可能自交。
- 但此結果**不是 B-spline**：它是一個特殊曲線型別（offset curve），帶有對原曲線的參考。要存入本專案的草圖模型，必須：
  - (a) 以 offset-curve 物件持久化（需新增 schema 實體型別 `offsetCurve`），或
  - (b) 取樣 + B-spline 擬合（近似，失精度）。

### 3.2 模型限制

- 本專案 `SketchEntity` 僅有 line／arc／circle／spline（B-spline）／ellipse／text。沒有 offset-curve 型別。
- 驅動尺寸（distance）只能連結兩個可量測的實體；offset curve 若擬合為 spline，其控制點數與原曲線不同，尺寸驅動語意模糊。
- 幾何真值（E04：長度誤差 ≤ 1e-6 mm）無法以擬合保證。

### 3.3 結論

- **精確 offset 不可行**於現有模型（無 offset-curve 實體型別）。
- **近似 offset 可行**（取樣 + B-spline 擬合），但必須：
  - 明示「近似」並標註容差；
  - 不產生驅動尺寸（或產生距離尺寸但標「近似」）；
  - 提供自交／過小半徑偵測（與線／弧 offset 一致）。

## 4. 建議方案

1. **短期（本輪不做）**：維持線／弧／圓 offset；自由曲線 offset 列為候選。
2. **中期**：新增 `offsetCurve` 實體型別（schema 升版），儲存原曲線參考 + 偏移距離 + 方向，由 OCCT 重建幾何；驅動尺寸以距離表示。估計 8–12 工作日。
3. **長期**：若只需視覺效果，提供近似擬合版本（4–6 工作日），明示容差。

## 5. 風險

- offset curve 自交偵測需 OCCT 接口驗證。
- 持久化 offset-curve 實體需 schema migration 與 DAG/refs 支援。
- 與 trim/extend 的互動（offset curve 能否被修剪）需另行驗證。

## 6. 探針結論

- **不可行（精確）**：現有模型無 offset-curve 實體型別。
- **可行（近似）**：取樣 + B-spline 擬合，需明示容差。
- **建議**：若排入，優先做 schema 擴充（offsetCurve 實體），使 offset 精確且可驅動。估計 8–12 工作日（精確）或 4–6 工作日（近似）。

## 7. 驗收對應

- C04（acceptance.md）：探針報告已交付；自由曲線 offset 的支援範圍已列。
- G09：探針完成；精確版需 schema 擴充。
