# Manual UI Validation SOP: SolidWorks Beginner Tutorial (The Skills Factory)

## Goal
Verify the 3D-Builder core workflow functionality as introduced in the 13-minute beginner crash course (Video: cWWP_-QRdkg). The primary focus is verifying **Smart Dimensioning (DISTANCE constraints)**, robust face selection, and the transition from 2D sketches to 3D Extruded and Revolved features.

## Prerequisites
- [ ] 3D-Builder Backend and Frontend are running.
- [ ] The `ConstraintSolver.ts` is active and capable of handling `DISTANCE` and `COINCIDENT` relations.

## Step-by-Step Validation

### 1. Base Block (Smart Dimension Verification)
1.  **Select Plane**: Click **TOP** plane.
2.  **Sketch**: Click **Sketch**.
3.  **Center Rectangle**:
    - Draw a rectangle starting from the Origin.
4.  **Smart Dimension**:
    - Select the top horizontal edge. Set distance to **120mm**.
    - Select the right vertical edge. Set distance to **80mm**.
    - *Verification*: The rectangle should adapt symmetrically around the origin. The lines should turn **Black** (Fully Defined).
5.  **Extrude**:
    - Exit Sketch.
    - Set Depth to **30mm**. Click **OK**.

### 2. Face Selection & Circular Cut
1.  **Select Face**: Click the **Top Face** of the newly created block.
2.  **Sketch**: Click **Sketch**.
3.  **Circle Tool**:
    - Click on the **Origin** (ensure the cursor snaps, creating an automatic `COINCIDENT` constraint).
    - Drag to create a circle.
4.  **Smart Dimension**:
    - Select the circle edge.
    - Set Diameter to **40mm** (or Radius to 20mm).
    - *Verification*: The circle turns **Black**.
5.  **Extrude Cut**:
    - Exit Sketch.
    - Choose **Extrude Cut**.
    - Set End Condition to **Through All**. Click **OK**.
    - *Verification*: A hole goes completely through the block.

### 3. Revolve Feature (Optional/Advanced)
1.  **Select Plane**: Click **FRONT** plane.
2.  **Sketch**: Click **Sketch**.
3.  **Centerline & Profile**:
    - Draw a vertical **Centerline** passing through the origin.
    - Draw a small rectangle (e.g., 10x20) floating to the right of the centerline.
4.  **Smart Dimension**:
    - Set the distance from the centerline to the inner edge of the rectangle to **70mm**.
5.  **Revolve Boss/Base**:
    - Exit Sketch.
    - Select **Revolve** from the Ribbon (if available in UI, otherwise skip).
    - Select the centerline as the Axis of Revolution.
    - Set Angle to **360°**.
    - *Verification*: A ring/flange is generated around the main block.

## Final Audit
- [ ] **Smart Dimension Resilience**: Double-click the 120mm dimension in the viewport/feature tree and change it to 150mm. The block should rebuild automatically without breaking the central hole's concentricity.
- [ ] **Through All Integrity**: Check the bottom face of the block to ensure the hole cleanly breaks the surface with no residual artifacts.