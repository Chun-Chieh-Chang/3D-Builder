# Manual UI Validation SOP: Plummer Block Base

## Goal
Verify the 3D-Builder construction logic for the Plummer Block Base (Video: mOU5bb50pgs). The primary focus is verifying **Concentric**, **Mid Plane** extrusion, and **Tangent** relations in complex profiles.

## Prerequisites
- [ ] 3D-Builder Backend and Frontend are running.
- [ ] Constraint Solver is active for `CONCENTRIC` and `TANGENT` alignment.

## Step-by-Step Validation

### 1. Base Plate
1.  **Select Plane**: Click **TOP** plane.
2.  **Sketch**: Click **Sketch**.
3.  **Center Rectangle**:
    - Draw a 166mm x 46mm rectangle starting from the Origin.
4.  **Exit & Extrude**:
    - Extrude depth: **12mm**.
    - Click **OK**.

### 2. Central Housing (Mid Plane Extrude)
1.  **Select Plane**: Click **FRONT** plane (this plane should bisect the Base Plate if drawn from origin).
2.  **Sketch**: Click **Sketch**.
3.  **Draw U-Shape Profile**:
    - Draw an arc (Radius 38mm) above the base plate.
    - Draw two vertical lines down from the arc's endpoints to the top edge of the base plate.
    - Close the profile along the top edge of the base plate.
4.  **Constraints**:
    - **Concentric/Coincident**: Ensure the center of the arc lies on the vertical center axis (Y-axis).
    - **Distance**: Dimension the center of the arc to be 38mm from the bottom of the base plate.
    - **Tangent**: Apply a `TANGENT` constraint between the vertical lines and the arc.
    - **Coincident**: The bottom line of the profile must be `COINCIDENT` with the top surface of the base plate.
5.  **Exit & Extrude**:
    - Select **Mid Plane** as the End Condition.
    - Depth: **46mm**.
    - Click **OK**.

### 3. Inner Bearing Bore (Concentric Cut)
1.  **Select Face**: Click the **Front Face** of the newly created housing.
2.  **Sketch**: Click **Sketch**.
3.  **Circle**:
    - Draw a circle (Radius 19mm / Diameter 38mm).
    - **Concentric Constraint**: Select the new circle and the R38 arc of the housing, and apply `CONCENTRIC`.
4.  **Exit & Cut**:
    - Select **Extrude Cut**.
    - **End Condition**: **Through All**.
    - Click **OK**.

### 4. Mounting Slots
1.  **Select Face**: Click the Top Face of the Base Plate.
2.  **Sketch**: Click **Sketch**.
3.  **Slot Profile**:
    - Draw two slots (or rectangles), centered at +/- 64mm from the Y-axis.
    - Width: 10.5mm.
4.  **Exit & Cut**:
    - Select **Extrude Cut** -> **Through All**.
    - Click **OK**.

## Final Audit
- [ ] **Symmetry Verification**: Changing the Base Plate width to 60mm and the Mid Plane extrude to 60mm should keep the part perfectly symmetrical.
- [ ] **Concentric Integrity**: Changing the housing's vertical position (38mm) should seamlessly drag the inner cut (R19) with it due to the Concentric constraint.