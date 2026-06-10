# Manual UI Validation SOP: SolidWorks Exercise 5 (CADable)

## Goal
Verify the 3D-Builder construction logic for the CADable Exercise 5 (Video: soEP5_cBqMI). The primary focus is verifying symmetric slots, sketch fillets (or their 3D feature equivalent), and collinear constraint mapping.

## Prerequisites
- [ ] 3D-Builder Backend and Frontend are running.
- [ ] Constraint Solver is active for Coincident (Collinear) and Symmetric alignment.

## Step-by-Step Validation

### 1. Base Plate & Fillets
1.  **Select Plane**: Click **TOP** plane.
2.  **Sketch**: Click **Sketch**.
3.  **Center Rectangle**:
    - Draw a 100mm x 80mm rectangle starting from the Origin.
4.  **Exit & Extrude**:
    - Extrude depth: **20mm**.
    - Click **OK**.
5.  **3D Fillet** *(Adaptation of Sketch Fillet)*:
    - Select the **Fillet** feature.
    - Set Radius to **15mm**.
    - Select the 4 vertical corner edges of the base block.
    - Click **OK**.

### 2. Mirrored Slots (Cut)
1.  **Select Face**: Click the **Top Face** of the base.
2.  **Sketch**: Click **Sketch**.
3.  **Draw Slot**:
    - Draw a slot shape (or a rectangle) on the left side.
    - **Smart Dimension**: Offset it 16mm from the left edge.
4.  **Mirror Entities**:
    - Use a Centerline and **Mirror Entities** to copy the slot to the right side.
5.  **Exit & Cut**:
    - Select **Extrude Cut**.
    - **End Condition**: **Through All**.
    - Click **OK**.

### 3. Side Boss (Collinear Constraint)
1.  **Select Face**: Click the Top Face of the base.
2.  **Sketch**: Click **Sketch**.
3.  **Corner Rectangle**:
    - Draw a rectangle along the back edge.
    - **Constraints**: Apply **Coincident/Collinear** constraint between the left/right edges of the rectangle and the outer edges of the base block.
4.  **Exit & Extrude**:
    - Set appropriate height.
    - Click **OK**.

### 4. Concentric/Symmetric Holes
1.  **Select Face**: Click the Top Face of the newly created Side Boss.
2.  **Sketch**: Click **Sketch**.
3.  **Circles**:
    - Draw two circles.
    - Apply **Equal** constraint between them.
    - **Smart Dimension**: Set diameter to **24mm**.
    - **Concentric**: If applicable, select the circle center and the fillet arc, applying a Concentric constraint (or position symmetrically).
4.  **Exit & Cut**:
    - **End Condition**: **Through All**.
    - Click **OK**.

## Final Audit
- [ ] **Through All Verification**: Check that all cuts fully pierce the geometry without leaving zero-thickness walls.
- [ ] **Constraint Verification**: Editing the Base Plate width from 100mm to 120mm should properly update the Collinear Side Boss without breaking the model.