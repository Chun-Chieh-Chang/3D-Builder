# SolidWorks Expert Guide: Advanced Sketch-to-Feature Logic

**Source**: [YouTube: How to Use Sketch Constraints in SolidWorks](https://www.youtube.com/watch?v=bxaio0HCzh8)
**Reference**: Standard SOLIDWORKS 2000+ Modeling Workflow

## 1. Professional Sketch Definition Strategy
SolidWorks experts use a specific hierarchy to ensure models are robust and "edit-friendly".

### A. The "Parent-Child" Chain
1. **Sketch (Parent)**: The 2D profile defines the intent.
2. **Feature (Child)**: The 3D operation (Extrude/Revolve) consumes the sketch.
3. **Applied Features (Grandchild)**: Fillets and Chamfers depend on the 3D edges created by the parent feature.
4. **Project Gap**: Currently, if a user deletes a parent feature, 3D-Builder needs to handle "Dangling" children more gracefully (Visual Warnings).

### B. Sketch Fillet vs. Feature Fillet
- **Sketch Fillet**: Applied in 2D. Preserves constraints but can be harder to manage in complex sketches.
- **Feature Fillet**: Applied in 3D. Much more stable for TNS (Topological Naming) and design changes.
- **SolidWorks behavior**: Experts prefer 3D Fillets for most structural rounds and 2D fillets only for complex profile trimming.

## 2. 專案對標缺口 (Gap Checklist)
- [ ] **Pierce Constraint**: Crucial for Lofts and Sweeps to ensure the profile "pierces" the path/guide curve. Currently missing in `ConstraintSolver.ts`.
- [ ] **Multi-Edge Fillet UI**: `PartFeaturePropertyManager.tsx` should support "Select All Internal Edges" or "Tangent Propagation" to match SolidWorks' Fillet Expert speed.
- [ ] **Automatic Solver Re-trigger**: When a parent dimension is changed, the child applied features (Fillets) should recalculate instantly without manual mesh refresh.

## 3. 預期行為 (SOP)
1. 繪製並完全定義一個帶有內孔的草圖。
2. 擠出成實體。
3. 選取實體的邊緣並套用 **Fillet**。
4. 回到草圖修改尺寸，觀察實體與圓角如何同步更新而無錯誤。
