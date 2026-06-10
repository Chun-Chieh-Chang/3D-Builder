# SolidWorks Expert Guide: Foundational Sketch Constraints

**Source**: [YouTube: SolidWorks Sketch Constraints](https://www.youtube.com/watch?v=Oy_UvF0RwPs)
**Reference**: Standard SOLIDWORKS 2000+ Sketch Methodology

## 1. Design Intent & Constraint Priority
SolidWorks modeling follows a "Shape first, Size second" philosophy. Establishing design intent through geometric constraints is the "mistake-free" path.

### A. The "Fully Defined" Workflow
1. **Anchor to Origin**: Every sketch must be anchored to the origin (Coincident) to eliminate translational degrees of freedom.
2. **Geometric Relations**: 
   - Use **Horizontal/Vertical** for orientation.
   - Use **Collinear** to align multiple edges.
   - Use **Concentric** for holes and rounds.
   - Use **Tangent** for smooth transitions between lines and arcs.
3. **Smart Dimensions**: Only add dimensions once the "behavior" of the sketch is locked by relations.

### B. Visual Feedback
- **Blue**: Under-defined (Missing constraints or dimensions).
- **Black**: Fully defined (Stable, won't move accidentally).
- **Red/Yellow**: Over-defined or No Solution (Conflicting constraints).

## 2. UI/UX Standard: The "Add Relations" Workflow
In SolidWorks, selecting two or more entities automatically triggers the **PropertyManager** to show applicable relations (e.g., selecting two lines shows Parallel, Perpendicular, Collinear, Equal).

## 3. Project 对標缺口 (Gap Checklist)
- [x] **Constraint Icons**: Implemented & Interactive.
- [x] **Color Coding**: Implemented (Blue/Black/Red).
- [x] **Multi-Selection Relations**: Implemented in `SketchPropertyManager.tsx`.
- [ ] **Orientation Shortcut**: `Spacebar` listener exists but the **View Selector Cube/Panel** is missing. This is crucial for switching between Front/Top/Right during sketching.
- [ ] **Over-defined Resolution**: Lacks a "SketchXpert" or similar tool to suggest which constraint to delete when red.

## 4. 預期行為 (SOP)
1. 繪製幾何圖形。
2. 選取多個實體。
3. 在側邊欄點選產生的關係。
4. 觀察顏色從藍變黑。
