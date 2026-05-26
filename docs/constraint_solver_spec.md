# 幾何約束求解器與圖論架構 (Detailed Technical Specification)

為滿足「完全參數化 CAD」的嚴格要求，我們將捨棄平坦的陣列記錄方式，導入標準的圖論幾何約束架構。以下是詳細的架構規格書 (Spec) 與執行計畫。

---

## 1. 核心資料結構定義 (Data Structure Specification)

在 `useCadStore.ts` 中，所有草圖資料將被標準化為正規化的字典 (Normalized Record)，以提供 $O(1)$ 的查詢與修改效能。

### 1.1 `SketchNode` (節點)
```typescript
export interface SketchNode {
  id: string;      // 例如: 'node_1715423123'
  x: number;       // U 空間座標
  y: number;       // V 空間座標
  isFixed?: boolean; // 若為原點或外部參考投影點，設為 true，求解器無法移動它
}
```

### 1.2 `SketchEdge` (邊)
```typescript
export type SketchEdgeType = 'LINE' | 'ARC' | 'CIRCLE' | 'CENTER_LINE';

export interface SketchEdge {
  id: string;
  type: SketchEdgeType;
  nodeIds: string[]; // 對於 LINE: [startNodeId, endNodeId]
                     // 對於 CIRCLE: [centerNodeId, perimeterNodeId]
  isConstruction?: boolean; // 是否為建構線
}
```

### 1.3 `SketchConstraint` (約束)
```typescript
export type ConstraintType = 'COINCIDENT' | 'HORIZONTAL' | 'VERTICAL' | 'DISTANCE' | 'EQUAL';

export interface SketchConstraint {
  id: string;
  type: ConstraintType;
  nodeIds?: string[]; // COINCIDENT: [nodeId1, nodeId2]
  edgeIds?: string[]; // HORIZONTAL/VERTICAL: [edgeId]
  value?: number;     // DISTANCE 專用的固定數值
}
```

---

## 2. 幾何約束求解器規格 (Constraint Solver Engine Spec)

我們將在 `src/utils/geometry/ConstraintSolver.ts` 開發基於 **Position-Based Dynamics (PBD) 迭代鬆弛法** 的求解引擎。它的核心思想是直接修改點的座標來滿足約束，並經過多次迭代達到全局平衡。

### 2.1 求解迴圈 (Solver Loop)
```typescript
function solveConstraints(nodes, edges, constraints, iterations = 10) {
  for (let i = 0; i < iterations; i++) {
    for (const c of constraints) {
      applyConstraint(c, nodes, edges);
    }
  }
  return nodes;
}
```

### 2.2 約束投影公式 (Constraint Projections)
在每次迭代中，對每個約束計算誤差並修正座標（假設兩點權重相同，各移動 50%，若有 `isFixed` 則另一點移動 100%）：

- **COINCIDENT (共點)**:
  - 誤差：$\Delta = \mathbf{p}_B - \mathbf{p}_A$
  - 修正：$\mathbf{p}_A += 0.5 \Delta$, $\mathbf{p}_B -= 0.5 \Delta$

- **HORIZONTAL (水平)**:
  - 提取 Edge 的 `startNode` ($A$) 與 `endNode` ($B$)
  - 誤差：$\Delta y = y_B - y_A$
  - 修正：$y_A += 0.5 \Delta y$, $y_B -= 0.5 \Delta y$

- **VERTICAL (垂直)**:
  - 誤差：$\Delta x = x_B - x_A$
  - 修正：$x_A += 0.5 \Delta x$, $x_B -= 0.5 \Delta x$

- **DISTANCE (距離)**:
  - 當前距離：$L = |\mathbf{p}_B - \mathbf{p}_A|$
  - 目標距離：$d$
  - 修正向量：$\mathbf{u} = (\mathbf{p}_A - \mathbf{p}_B) / L$
  - 修正：$\mathbf{p}_A -= 0.5 (L - d) \mathbf{u}$, $\mathbf{p}_B += 0.5 (L - d) \mathbf{u}$

---

## 3. UI 互動與力學規格 (Interaction Mechanics)

### 3.1 繪製圖元 (Drawing)
在 `DatumPlanes.tsx` 中：
- 滑鼠按下 (`PointerDown`)：建立一個新 `SketchNode` ($N_1$) 作為起點。建立一條 `SketchEdge` (LINE) 連接 $N_1$ 與游標即時建立的 $N_2$。
- 滑鼠拖曳 (`PointerMove`)：持續更新 $N_2$ 的座標，並觸發 `solveConstraints`。
- 滑鼠放開 (`PointerUp`)：確定 $N_2$。

### 3.2 智慧捕捉與自動約束 (O-Snap & Auto-Constrain)
- **點捕捉 (Point Snapping)**：若游標靠近現有 Node（半徑 < 3 單位），則游標不建立新 Node，而是直接綁定到該現有 Node ID。系統**自動生成**一筆 `COINCIDENT` 約束。
- **正交鎖定 (Orthogonal Locking)**：若拖曳線段時角度接近 $0^\circ, 90^\circ$（公差 $\pm3^\circ$），或按住 `Shift`，系統自動為該 Edge 加上 `HORIZONTAL` 或 `VERTICAL` 約束。

---

## 4. 向後相容層規格 (Graph-to-Array Adapter)

為了不破壞後端 OpenCASCADE `generate_extrude` 接受 `[x,y]` 陣列的邏輯，在使用者點擊「結束草圖」時，執行以下遍歷演算法 (`GraphTraverser`)：

1. **過濾**：排除所有 `isConstruction === true` 的邊。
2. **建立相鄰矩陣 (Adjacency List)**：建立 `Map<NodeId, Edge[]>`。
3. **尋找封閉迴圈 (Closed Loop Extraction)**：
   - 尋找度數 (Degree) 為 2 的 Node 作為起點。
   - 順著 Edge 遍歷到下一個 Node，依序收集座標 `[node.x, node.y]`。
   - 直到回到起點，形成一筆完整的草圖輪廓點陣列。
4. **輸出**：將此陣列替換到 Feature Parameter 中送給後端。

---

## User Review Required
> [!IMPORTANT]
> **架構確認**
> 這份規格書完整定義了從資料結構、數學引擎、操作力學到後端相容的每一個細節。這是一個非常正統的 2D CAD 架構。若您認可此規格，我們將開始依序編寫 `ConstraintSolver.ts` 引擎，並重構 `DatumPlanes.tsx` 的繪圖邏輯。您準備好了嗎？
