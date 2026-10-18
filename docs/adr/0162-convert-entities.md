# ADR 0162: 草圖參考圖元與相交曲線全鏈路實作 (Sketch Convert Entities & Intersection Curves)

## 狀態
- 狀態: 提案通過並實作中 (Accepted & Implementing)
- 日期: 2026-10-18
- 標籤: `sketch`, `convert-entities`, `intersection-curves`, `references`, `c1.18`

---

## 1. 背景與動機 (Context & Motivation)
依據產品藍圖 `docs/blueprint.md` 之 **C1.18 參考圖元、相交曲線（投影模型邊線進草圖，夾治具以工件輪廓為基準的關鍵工具，P1）**：
在機械結構、夾治具（Jigs & Fixtures）與模具設計中，工件的外觀幾何形狀多樣，常包含平面、曲面、樣條邊緣或傾斜輪廓。現有系統（ADR 0026 初版）僅支援直線段（`line`）與平行圓/圓弧（`circle`/`arc`）的投影，存在以下關鍵瓶頸：
1. **自由曲面與樣條邊緣無法引用**：當模型邊線為 B-spline 樣條邊或非平行投影曲線時，系統直接報錯 `reference.notSimple`，導致複雜工件無法隨形開槽或取樣輪廓。
2. **缺乏相交曲線 (Intersection Curves) 能力**：當工件斜切面、曲面本體穿過草圖平面時，工程師無法求出實體與草圖平面的截交交線，難以建立隨形密封槽、配合凸台或配合基板。
3. **輪廓閉合性與再生聯動**：選取面轉換時，必須保證邊緣頂點嚴格共享重合，形成閉合環以供直接長出/除料，且當模型母體尺寸變更時，草圖中的樣條與所有引用圖元必須精確保持幾何聯動。

---

## 2. 幾何數學模型與第一性原理推導 (Mathematical Foundations)

### 2.1 正交幾何投影公式 (Orthogonal Projection)
草圖平面由局部座標系定義：
- 原點 $O \in \mathbb{R}^3$
- 基準向量 $\vec{u}, \vec{v} \in \mathbb{R}^3$（相互正交且 $\|\vec{u}\| = \|\vec{v}\| = 1$）
- 法向量 $\vec{n} = \vec{u} \times \vec{v}$

對於 3D 空間任意一點 $P \in \mathbb{R}^3$：
$$u = (P - O) \cdot \vec{u}, \quad v = (P - O) \cdot \vec{v}$$
點到草圖平面的有符號距離為：
$$d = (P - O) \cdot \vec{n}$$

### 2.2 樣條曲線 (Spline) 邊線投影
若模型邊緣為 B-spline 曲線或高階空間曲線：
1. 沿曲線參數 $t \in [0, 1]$ 進行自適應採樣，提取 $N \ge 3$ 個關鍵型值點 $\{P_k\}_{k=0}^{N-1}$。
2. 投影至草圖平面座標系：$(u_k, v_k) = ((P_k - O) \cdot \vec{u}, (P_k - O) \cdot \vec{v})$。
3. 在草圖中建立 `SketchSplineEntity`：
   `{ id, type: 'spline', points: [p0, p1, ..., pN-1], ref: item.ref }`。
4. 在模型再生時，`followReferences` 重新採樣該邊線，精確同步更新型值點座標並施加 `fix` 限制。

### 2.3 面與平面相交曲線求解 (Intersection Curve Calculation)
給定草圖平面 $\Pi_s: (P - O) \cdot \vec{n}_s = 0$：
1. **平面面與草圖平面相交 (Plane-Plane Intersection)**：
   - 模型平面面 $\Pi_f: (P - Q) \cdot \vec{n}_f = 0$。
   - 交線方向 $\vec{d} = \vec{n}_f \times \vec{n}_s$。
   - 若 $\|\vec{d}\| < 10^{-6}$：
     - 若 $|(Q - O) \cdot \vec{n}_s| > 10^{-6}$，兩平面嚴格平行無交線，拋出顯式錯誤 `reference.noIntersection`。
     - 若兩平面重合，則交線退化為重合面（由面輪廓處理）。
   - 若不平行：計算交線上的一基準點 $P_{line}$，與該面的 3D 邊界多邊形進行裁剪，得到有效的交線段 $[P_{start}, P_{end}]$。
   - 投影至草圖平面，生成 `kind: 'line'` 圖元。
2. **曲面/圓柱面與草圖平面相交**：
   - 圓柱軸線與草圖平面交角若為 $90^\circ$（垂直），截面為圓（`circle`）；
   - 若為傾斜或自由曲面，採樣截交線點集，生成平滑樣條 (`spline`) 或圓弧 (`arc`) 圖元。

---

## 3. 系統架構與全鏈路流程 (System Architecture)

```
[UI / Controller]
   │
   ├─► store.convertReferences({ sketchId, edges, faces, mode: 'convert' | 'intersect' | 'pierce' })
   │
[Worker / Kernel]
   │
   ├─► references.ts:
   │      - convertEdges() / projectEdge() (支援 line, circle, arc, spline)
   │      - intersectFaces() (計算面與草圖平面交線)
   │
   ├─► 回傳 Converted[] / ModelItem[]
   │
[Sketcher / Controller]
   │
   ├─► ops.ts: referenceEntities()
   │      - 共享角點 corner(at)
   │      - 自動建立 closed outline 輪廓
   │      - 產生 editSketch 指令
   │
[Regenerator (Rebuild)]
   │
   └─► followReferences():
          - 模型變更時自動更新 line, circle, arc, spline 之幾何點位與約束
```

---

## 4. 自我紅隊四問與防禦約束 (Self-Red-Teaming Protocol)

1. **輸入破壞 (Input Corruption)**：
   - 無效或遺失的 `Ref`：拋出 `reference.lost`。
   - 平行且不相交的面請求相交曲線：拋出顯式錯誤 `reference.noIntersection`，嚴禁靜默失敗或回傳空陣列假綠。
2. **拓樸相交破壞 (Geometric Self-Intersection Defense)**：
   - 極短交線或退化線段（長度 $< 10^{-6}$）：防禦性過濾，避免向求解器注入零長度圖元。
3. **依賴鏈完整性 (Dependency Graph Integrity)**：
   - 全鏈路完整接線：`references.ts` -> `ops.ts` -> `kernel.worker.ts` -> `controller.ts` -> `engine.ts`。
4. **真值存在性防呆與零 Mock (Zero-Mock & Ground Truth)**：
   - 自我紅隊測試使用真實幾何實體、真實長出 Extrude Boss 驗證閉合輪廓體積，底層 WASM Heap 監控斷言 `byteLength > 0`。
