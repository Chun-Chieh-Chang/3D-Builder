# Position-Based Dynamics (PBD) Constraint Solver

The 3D-Builder sketch engine utilizes a 2D **Position-Based Dynamics (PBD)** relaxation solver in `src/utils/geometry/ConstraintSolver.ts`. This solver runs iteratively on the client-side to satisfy geometric constraints dynamically during sketch editing.

---

## 1. Solver Mechanics (Iterative Relaxation)

Unlike traditional analytical or symbolic CAD solvers that use large Jacobian matrix systems (e.g. Newton-Raphson), PBD relaxes each constraint independently. 
- **Anchoring (Fixed Nodes)**: If a node has `isFixed: true`, its weight in position correction becomes 0. If one node is fixed and another is free, the free node is corrected by 100% of the displacement. If both are free, they are adjusted by 50% each.
- **Complexity**: By running multiple relaxation cycles (default = 10 iterations), the solver rapidly converges to a mathematically stable state, matching high-end CAD responsiveness (60 FPS rendering loop).

```typescript
export function solveConstraints(
  nodes: Record<string, SketchNode>,
  edges: Record<string, SketchEdge>,
  constraints: Record<string, SketchConstraint>,
  iterations: number = 10
): Record<string, SketchNode>
```

---

## 2. Supported Constraints Mathematical Formulation

### A. COINCIDENT (共點)
Forces two nodes $P_1$ and $P_2$ to share the exact same location.
- **Displacement Vector**: $\vec{d} = P_2 - P_1$.
- **Adjustment**: Move $P_1$ forward and $P_2$ backward along $\vec{d}$ proportional to their weights.

### B. HORIZONTAL (水平)
Forces a line edge (connecting $P_1$ and $P_2$) to be perfectly parallel to the local horizontal axis (X-axis).
- **Condition**: $P_1.y = P_2.y$.
- **Correction**: Calculate $\Delta y = P_2.y - P_1.y$ and relax both nodes along the Y-axis.

### C. VERTICAL (垂直)
Forces a line edge (connecting $P_1$ and $P_2$) to be perfectly parallel to the local vertical axis (Y-axis).
- **Condition**: $P_1.x = P_2.x$.
- **Correction**: Calculate $\Delta x = P_2.x - P_1.x$ and relax both nodes along the X-axis.

### D. DISTANCE (距離/標註)
Locks the absolute Euclidean distance between two nodes $P_1$ and $P_2$ to a given value $L$.
- **Formula**: $\text{dist} = ||P_2 - P_1||$.
- **Error Vector**: $\text{diff} = \text{dist} - L$.
- **Correction**: Push or pull nodes along the normalized direction vector $\hat{n} = \frac{P_2 - P_1}{||P_2 - P_1||}$ by $\text{diff}$ scaled by weights.

### E. EQUAL (等長)
Forces two edges $E_1$ (length $l_1$) and $E_2$ (length $l_2$) to have identical length.
- **Average Length**: $l_{\text{avg}} = \frac{l_1 + l_2}{2}$.
- **Relaxation**: Adjust the vertices of $E_1$ to align with $l_{\text{avg}}$, and adjust the vertices of $E_2$ to align with $l_{\text{avg}}$ independently.

---

## 3. Reference Implementation
*   **Solver Code**: [ConstraintSolver.ts](file:///C:/Users/3kids/Downloads/3D-Builder/src/utils/geometry/ConstraintSolver.ts)
*   **Integration store update**: [SketchPropertyManager.tsx](file:///C:/Users/3kids/Downloads/3D-Builder/src/ui/SketchPropertyManager.tsx) which triggers `solveConstraints` and sets the computed nodes back to Zustand.
