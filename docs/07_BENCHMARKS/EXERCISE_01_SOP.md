# Manual UI Validation SOP: SolidWorks Exercise 1

## Goal
Verify the 3D-Builder construction logic for Exercise 1, focusing on rectangular feature stacking and angular cut constraints.

## Prerequisites
- [ ] 3D-Builder Backend and Frontend are running.
- [ ] Precision Solver (Newton-Raphson) is active in the sketcher.

## Step-by-Step Validation

### 1. Base Plate
1.  **Select Plane**: Click **TOP** plane.
2.  **Sketch**: Click **Sketch**.
3.  **Center Rectangle**:
    - Draw a rectangle from the **Origin**.
    - **Smart Dimension**: Length = **80mm**, Width = **50mm**.
4.  **Exit & Extrude**:
    - **Depth** = **18mm**.
    - Click **OK**.
5.  **Verify**: Solid base block created.

### 2. Vertical Wall
1.  **Select Face**: Click the **Top Face** of the base.
2.  **Sketch**: Click **Sketch**.
3.  **Corner Rectangle**:
    - Draw a rectangle along the back edge.
    - **Smart Dimension**: Width = **80mm**, Thickness = **12mm**.
    - **Constraints**: Ensure edges are **Collinear** with the base plate edges.
4.  **Exit & Extrude**:
    - **Depth** = **38mm**.
    - Click **OK**.
5.  **Verify**: L-shaped part formed.

### 3. Slanted Cut (Angular Constraint)
1.  **Select Face**: Click the **Front Face** of the vertical wall.
2.  **Sketch**: Click **Sketch**.
3.  **Triangle Profile**:
    - Use the **Line** tool to draw a closed triangle at the top-right corner.
    - **Constraint 1 (Vertical Distance)**: Top vertex to top edge = **10mm**.
    - **Constraint 2 (Horizontal Distance)**: Side vertex to side edge = **12mm**.
    - **Constraint 3 (Angle)**: Slanted line to vertical edge = **45°**.
4.  **Check Definition**: The triangle sketch should turn **BLACK** (Fully Defined).
5.  **Exit & Cut**:
    - Select **Extrude Cut**.
    - **End Condition** = **Through All**.
    - Click **OK**.
6.  **Verify**: A precise 45-degree slanted cut is removed from the corner.

## Final Audit
- [ ] Check for **Geometric Continuity**: No gaps between base and wall.
- [ ] Check **Constraint Persistence**: Changing the wall height should move the cut but keep the 45° angle (if constraints are correctly linked).
- [ ] Verify **Through All** behavior: The cut should not leave a "thin skin" on the back face.
