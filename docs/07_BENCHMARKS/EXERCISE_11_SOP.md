# Manual UI Validation SOP: SolidWorks Exercise 11

## Goal
Verify the 3D-Builder construction logic for Exercise 11 (Video: -LL3eSTyWe8). The primary focus is verifying **Concentric relations**, **Circular Patterns**, and mixed-profile sketching (circle + lines) for the keyway cut.

## Prerequisites
- [ ] 3D-Builder Backend and Frontend are running.
- [ ] Constraint Solver is active for `CONCENTRIC` and `SYMMETRIC` / `DISTANCE` alignment.

## Step-by-Step Validation

### 1. Base Cylinder
1.  **Select Plane**: Click **TOP** plane.
2.  **Sketch**: Click **Sketch**.
3.  **Circle**:
    - Draw a circle starting from the **Origin**.
    - **Smart Dimension**: Set diameter to **71mm**.
4.  **Exit & Extrude**:
    - Extrude depth: **9mm**.
    - Click **OK**.

### 2. Center Keyway Cut
1.  **Select Face**: Click the **Top Face** of the cylinder.
2.  **Sketch**: Click **Sketch**.
3.  **Circle**:
    - Draw a circle from the Origin.
    - **Smart Dimension**: Diameter = **47.5mm**.
4.  **Keyway Lines**:
    - Draw two horizontal lines passing through the circle.
    - **Smart Dimension**: Set the distance between the two lines to **15mm**.
    - **Constraint**: Ensure the lines are symmetrically constrained around the horizontal origin axis.
5.  **Trim**:
    - Use the Trim tool (if available) or rely on contour selection to pick the central keyway profile.
6.  **Exit & Cut**:
    - Select **Extrude Cut**.
    - **End Condition**: **Through All**.
    - Click **OK**.

### 3. Corner Fillets
1.  **3D Fillet**:
    - Select the **Fillet** feature from the ribbon.
    - Set Radius to **4mm**.
    - Select the 4 vertical edges created by the keyway cut.
    - Click **OK**.

### 4. Circular Pattern Holes
1.  **Select Face**: Click the Top Face of the base cylinder.
2.  **Sketch**: Click **Sketch**.
3.  **Hole Profile**:
    - Draw a circle horizontally aligned with the origin.
    - **Smart Dimension**: Set diameter to **5.5mm**.
    - **Smart Dimension**: Set distance from the origin to the circle center to **59mm**.
4.  **Exit & Cut**:
    - Select **Extrude Cut** -> **Through All**. Click **OK**.
5.  **Circular Pattern**:
    - Select the **Pattern** feature (Circular Pattern mode).
    - **Target Feature**: Select the hole cut feature.
    - **Axis**: Select the outer circular edge of the base cylinder.
    - **Count**: Set to **4** or **6** (depending on the specific exercise drawing).
    - Click **OK**.

## Final Audit
- [ ] **Pattern Verification**: Changing the instance count in the Circular Pattern from 4 to 6 should immediately update the geometry.
- [ ] **Fillet Integrity**: The 4mm fillets should smoothly blend the intersections of the keyway.