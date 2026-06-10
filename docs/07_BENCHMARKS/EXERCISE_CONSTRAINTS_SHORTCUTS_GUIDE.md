# SolidWorks Expert Guide: High-Efficiency Constraint Workflows

**Source**: [YouTube: Proto Tech Tip - Sketch Constraints in SolidWorks](https://www.youtube.com/watch?v=kTgbW1hrMn0)
**Reference**: Standard SOLIDWORKS 2000+ Sketch Ergonomics

## 1. Context-Sensitive Relations (鼠標右鍵關係選單)
Professional SolidWorks users rarely use the side property manager to add relations. Instead, they use the **Context Menu** (Right-Click).

### A. Selection-Based Commands
The system must analyze the `selectedEntityIds` and offer only valid geometric relations:
- **2 Lines**: Horizontal, Vertical, Collinear, Perpendicular, Parallel, Equal.
- **Line + Circle/Arc**: Tangent.
- **2 Circles**: Concentric, Coradial (Equal), Tangent.
- **Point + Line**: Coincident, Midpoint.
- **3+ Entities**: Symmetric (if a centerline is included).

### B. "Fully Define Sketch" (完全定義草圖工具)
- **Function**: Automatically applies dimensions and relations to solve all remaining degrees of freedom (DOF).
- **SolidWorks Logic**: Found under `Tools > Sketch Tools > Fully Define Sketch`. It calculates DOF and attempts to lock the sketch relative to the origin.

## 2. 專案對標缺口 (Gap Checklist)
- [ ] **Contextual Right-Click**: `ContextMenu.tsx` currently only shows static commands (Select, End Chain). It needs to dynamically inject "Add Relation" buttons based on selection.
- [ ] **Auto-Dimensioning (FDS)**: System lacks an "Auto-Define" logic to eliminate DOF.
- [ ] **Selection Filter Sync**: The context menu should also allow toggling "Construction Geometry" for the entire selection. -> *Done in previous turn.*

## 3. 預期行為 (SOP)
1. 選取兩條不平行的直線。
2. 點擊 **滑鼠右鍵**。
3. 選單中應立即出現 **「設為平行 (Make Parallel)」** 或 **「設為垂直 (Make Perpendicular)」**。
4. 點擊後，草圖立即重解並顯示圖標。
